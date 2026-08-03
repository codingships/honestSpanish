\set ON_ERROR_STOP on

BEGIN;

SET LOCAL session_replication_role = replica;
INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
    ('99900000-0000-4000-8000-000000000001', 'cms-editor@example.test', clock_timestamp()),
    ('99900000-0000-4000-8000-000000000002', 'cms-student@example.test', clock_timestamp());
INSERT INTO public.profiles (
    id,
    email,
    role,
    adult_confirmed,
    adult_confirmed_at,
    age_policy_version
) VALUES
    (
        '99900000-0000-4000-8000-000000000001',
        'cms-editor@example.test',
        'admin',
        TRUE,
        clock_timestamp(),
        'test'
    ),
    (
        '99900000-0000-4000-8000-000000000002',
        'cms-student@example.test',
        'student',
        TRUE,
        clock_timestamp(),
        'test'
    );
INSERT INTO public.admin_role_assignments (profile_id, access_role, granted_by)
VALUES (
    '99900000-0000-4000-8000-000000000001',
    'content_editor',
    NULL
);
SET LOCAL session_replication_role = origin;

DO $$
BEGIN
    IF pg_catalog.has_table_privilege('anon', 'public.cms_documents', 'SELECT')
       OR pg_catalog.has_table_privilege('authenticated', 'public.cms_documents', 'SELECT')
       OR pg_catalog.has_table_privilege('authenticated', 'public.cms_content_drafts', 'SELECT')
       OR pg_catalog.has_table_privilege('authenticated', 'public.cms_content_versions', 'SELECT') THEN
        RAISE EXCEPTION 'cms_tables_are_exposed_to_public_clients';
    END IF;

    IF NOT pg_catalog.has_table_privilege('service_role', 'public.cms_documents', 'SELECT')
       OR NOT pg_catalog.has_table_privilege('service_role', 'public.cms_content_drafts', 'SELECT')
       OR NOT pg_catalog.has_table_privilege('service_role', 'public.cms_content_versions', 'SELECT')
       OR pg_catalog.has_table_privilege('service_role', 'public.cms_documents', 'INSERT')
       OR pg_catalog.has_table_privilege('service_role', 'public.cms_content_drafts', 'UPDATE')
       OR pg_catalog.has_table_privilege('service_role', 'public.cms_content_versions', 'DELETE') THEN
        RAISE EXCEPTION 'cms_service_role_table_boundary_is_invalid';
    END IF;

    IF pg_catalog.has_function_privilege(
        'authenticated',
        'public.publish_cms_content_draft(uuid,uuid,integer)',
        'EXECUTE'
    ) OR NOT pg_catalog.has_function_privilege(
        'service_role',
        'public.publish_cms_content_draft(uuid,uuid,integer)',
        'EXECUTE'
    ) THEN
        RAISE EXCEPTION 'cms_publish_rpc_boundary_is_invalid';
    END IF;
END
$$;

DO $$
DECLARE
    actor_id CONSTANT UUID := '99900000-0000-4000-8000-000000000001';
    student_id CONSTANT UUID := '99900000-0000-4000-8000-000000000002';
    rollback_operation CONSTANT UUID := '99910000-0000-4000-8000-000000000001';
    first_draft public.cms_content_drafts%ROWTYPE;
    replay_draft public.cms_content_drafts%ROWTYPE;
    second_draft public.cms_content_drafts%ROWTYPE;
    open_draft public.cms_content_drafts%ROWTYPE;
    document_row public.cms_documents%ROWTYPE;
    rolled_back public.cms_documents%ROWTYPE;
    first_payload JSONB := '{"title":"First publication","faq":[1]}'::JSONB;
    second_payload JSONB := '{"title":"Second publication","faq":[1,2]}'::JSONB;
    audit_count INTEGER;
BEGIN
    first_draft := public.create_cms_content_draft(
        actor_id,
        'homepage',
        'en',
        first_payload
    );
    replay_draft := public.create_cms_content_draft(
        actor_id,
        'homepage',
        'en',
        '{"ignored":true}'::JSONB
    );
    IF replay_draft.id <> first_draft.id
       OR replay_draft.payload <> first_payload
       OR first_draft.base_version <> 0
       OR first_draft.revision <> 1 THEN
        RAISE EXCEPTION 'cms_open_draft_creation_is_not_idempotent';
    END IF;

    first_draft := public.update_cms_content_draft(
        actor_id,
        first_draft.id,
        first_draft.revision,
        first_payload || '{"edited":true}'::JSONB
    );
    IF first_draft.revision <> 2 OR first_draft.payload ->> 'edited' <> 'true' THEN
        RAISE EXCEPTION 'cms_draft_update_is_not_versioned';
    END IF;

    BEGIN
        PERFORM public.update_cms_content_draft(
            actor_id,
            first_draft.id,
            1,
            first_payload
        );
        RAISE EXCEPTION 'cms_stale_revision_was_accepted';
    EXCEPTION
        WHEN serialization_failure THEN NULL;
    END;

    first_draft := public.publish_cms_content_draft(
        actor_id,
        first_draft.id,
        first_draft.revision
    );
    replay_draft := public.publish_cms_content_draft(
        actor_id,
        first_draft.id,
        first_draft.revision
    );
    IF first_draft.status <> 'published'
       OR first_draft.published_version <> 1
       OR replay_draft.id <> first_draft.id THEN
        RAISE EXCEPTION 'cms_first_publication_is_not_idempotent';
    END IF;

    SELECT * INTO document_row
    FROM public.cms_documents
    WHERE id = first_draft.document_id;
    IF document_row.current_version <> 1
       OR document_row.published_payload <> first_draft.payload THEN
        RAISE EXCEPTION 'cms_document_projection_is_incoherent';
    END IF;

    second_draft := public.create_cms_content_draft(
        actor_id,
        'homepage',
        'en',
        '{"ignored":true}'::JSONB
    );
    IF second_draft.base_version <> 1
       OR second_draft.payload <> document_row.published_payload THEN
        RAISE EXCEPTION 'cms_new_draft_did_not_start_from_publication';
    END IF;
    second_draft := public.update_cms_content_draft(
        actor_id,
        second_draft.id,
        second_draft.revision,
        second_payload
    );
    second_draft := public.publish_cms_content_draft(
        actor_id,
        second_draft.id,
        second_draft.revision
    );
    IF second_draft.published_version <> 2 THEN
        RAISE EXCEPTION 'cms_second_publication_did_not_advance_version';
    END IF;

    open_draft := public.create_cms_content_draft(
        actor_id,
        'homepage',
        'en',
        '{"ignored":true}'::JSONB
    );
    BEGIN
        PERFORM public.rollback_cms_content_document(
            actor_id,
            document_row.id,
            1,
            2,
            rollback_operation
        );
        RAISE EXCEPTION 'cms_rollback_ignored_open_draft';
    EXCEPTION
        WHEN SQLSTATE '23514' THEN
            IF SQLERRM <> 'cms_content_open_draft_blocks_rollback' THEN
                RAISE;
            END IF;
    END;
    open_draft := public.discard_cms_content_draft(
        actor_id,
        open_draft.id,
        open_draft.revision
    );
    IF open_draft.status <> 'discarded' OR open_draft.discarded_at IS NULL THEN
        RAISE EXCEPTION 'cms_draft_discard_is_incoherent';
    END IF;

    rolled_back := public.rollback_cms_content_document(
        actor_id,
        document_row.id,
        1,
        2,
        rollback_operation
    );
    IF rolled_back.current_version <> 3
       OR rolled_back.published_payload <> first_draft.payload THEN
        RAISE EXCEPTION 'cms_rollback_did_not_republish_source_as_new_version';
    END IF;
    rolled_back := public.rollback_cms_content_document(
        actor_id,
        document_row.id,
        1,
        2,
        rollback_operation
    );
    IF rolled_back.current_version <> 3 THEN
        RAISE EXCEPTION 'cms_rollback_replay_created_another_version';
    END IF;

    BEGIN
        UPDATE public.cms_content_versions
        SET payload = '{"tampered":true}'::JSONB
        WHERE document_id = document_row.id
          AND version = 1;
        RAISE EXCEPTION 'cms_version_history_is_mutable';
    EXCEPTION
        WHEN SQLSTATE '23514' THEN
            IF SQLERRM <> 'cms_content_versions_are_immutable' THEN
                RAISE;
            END IF;
    END;

    BEGIN
        PERFORM public.create_cms_content_draft(
            student_id,
            'homepage',
            'es',
            first_payload
        );
        RAISE EXCEPTION 'cms_student_created_a_draft';
    EXCEPTION
        WHEN insufficient_privilege THEN NULL;
    END;

    SELECT count(*) INTO audit_count
    FROM public.admin_audit_log
    WHERE admin_id = actor_id
      AND action LIKE 'cms_content.%';
    IF audit_count <> 9 THEN
        RAISE EXCEPTION 'cms_audit_history_is_incomplete: %', audit_count;
    END IF;

    IF (SELECT count(*) FROM public.cms_content_versions WHERE document_id = document_row.id) <> 3 THEN
        RAISE EXCEPTION 'cms_version_history_count_is_wrong';
    END IF;
END
$$;

ROLLBACK;
