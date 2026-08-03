\set ON_ERROR_STOP on

BEGIN;

SET LOCAL session_replication_role = replica;
INSERT INTO auth.users (id, email, email_confirmed_at) VALUES (
    '99500000-0000-4000-8000-000000000001',
    'catalog-v2-owner@example.test',
    clock_timestamp()
);
INSERT INTO public.profiles (
    id,
    email,
    role,
    adult_confirmed,
    adult_confirmed_at,
    age_policy_version
) VALUES (
    '99500000-0000-4000-8000-000000000001',
    'catalog-v2-owner@example.test',
    'admin',
    TRUE,
    clock_timestamp(),
    'test'
);
INSERT INTO public.admin_role_assignments (profile_id, access_role, granted_by)
VALUES (
    '99500000-0000-4000-8000-000000000001',
    'owner',
    NULL
);
SET LOCAL session_replication_role = origin;

DO $$
BEGIN
    IF pg_catalog.has_table_privilege(
        'authenticated',
        'public.package_catalog_drafts',
        'SELECT,INSERT,UPDATE,DELETE'
    ) THEN
        RAISE EXCEPTION 'catalog_drafts_are_exposed_to_authenticated';
    END IF;
    IF pg_catalog.has_table_privilege(
        'authenticated',
        'public.packages',
        'INSERT,UPDATE,DELETE'
    ) THEN
        RAISE EXCEPTION 'catalog_package_writes_are_exposed_to_authenticated';
    END IF;
    IF NOT pg_catalog.has_table_privilege(
        'service_role',
        'public.package_catalog_drafts',
        'SELECT'
    ) OR pg_catalog.has_table_privilege(
        'service_role',
        'public.package_catalog_drafts',
        'INSERT,UPDATE,DELETE'
    ) THEN
        RAISE EXCEPTION 'catalog_draft_service_role_boundary_is_invalid';
    END IF;
    IF pg_catalog.has_function_privilege(
        'authenticated',
        'public.publish_package_catalog_draft(uuid,bigint,text,boolean,text,text,text,uuid)',
        'EXECUTE'
    ) OR NOT pg_catalog.has_function_privilege(
        'service_role',
        'public.publish_package_catalog_draft(uuid,bigint,text,boolean,text,text,text,uuid)',
        'EXECUTE'
    ) THEN
        RAISE EXCEPTION 'catalog_publish_rpc_grant_is_invalid';
    END IF;
END
$$;

DO $$
DECLARE
    actor_id CONSTANT UUID := '99500000-0000-4000-8000-000000000001';
    package_row public.packages%ROWTYPE;
    first_draft public.package_catalog_drafts%ROWTYPE;
    updated_draft public.package_catalog_drafts%ROWTYPE;
    second_draft public.package_catalog_drafts%ROWTYPE;
    discarded_draft public.package_catalog_drafts%ROWTYPE;
    first_publish JSONB;
    replay_publish JSONB;
    second_publish JSONB;
    retire_result JSONB;
    first_price public.package_prices%ROWTYPE;
    second_price public.package_prices%ROWTYPE;
    second_snapshot public.checkout_v2_price_snapshots%ROWTYPE;
    audit_count INTEGER;
BEGIN
    SELECT * INTO package_row
    FROM public.packages
    WHERE name = 'individual_4x50_28d';

    IF NOT FOUND OR package_row.contract_schema_version <> 2 THEN
        RAISE EXCEPTION 'catalog_v2_seed_package_is_missing';
    END IF;

    first_draft := public.create_package_catalog_draft(
        p_actor_id => actor_id,
        p_package_id => package_row.id
    );
    IF first_draft.status <> 'draft'
       OR first_draft.base_catalog_version <> package_row.catalog_version
       OR first_draft.amount_cents <> package_row.amount_cents THEN
        RAISE EXCEPTION 'catalog_draft_did_not_snapshot_package';
    END IF;

    updated_draft := public.update_package_catalog_draft(
        first_draft.id,
        first_draft.revision,
        '{"es":"Plan flexible","en":"Flexible plan","ru":"Гибкий план"}'::JSONB,
        26003,
        'week',
        4::SMALLINT,
        5,
        55::SMALLINT,
        FALSE,
        FALSE,
        TRUE,
        actor_id
    );
    IF updated_draft.revision <> first_draft.revision + 1
       OR updated_draft.amount_cents <> 26003
       OR updated_draft.sessions_per_period <> 5 THEN
        RAISE EXCEPTION 'catalog_draft_update_was_not_versioned';
    END IF;

    BEGIN
        PERFORM public.update_package_catalog_draft(
            first_draft.id,
            first_draft.revision,
            updated_draft.display_name,
            updated_draft.amount_cents,
            updated_draft.billing_interval_unit,
            updated_draft.billing_interval_count,
            updated_draft.sessions_per_period,
            updated_draft.class_duration_minutes,
            updated_draft.has_group_session,
            updated_draft.has_dual_teacher,
            updated_draft.is_publicly_listed,
            actor_id
        );
        RAISE EXCEPTION 'stale_catalog_draft_revision_was_accepted';
    EXCEPTION
        WHEN serialization_failure THEN NULL;
    END;

    first_publish := public.publish_package_catalog_draft(
        updated_draft.id,
        updated_draft.revision,
        'acct_catalog_v2_test',
        FALSE,
        'prod_catalog_v2_test',
        'price_catalog_v2_initial_2',
        'price_catalog_v2_recurring_2',
        actor_id
    );
    IF (first_publish ->> 'changed')::BOOLEAN IS DISTINCT FROM TRUE THEN
        RAISE EXCEPTION 'first_catalog_publish_was_not_applied';
    END IF;

    SELECT * INTO package_row
    FROM public.packages
    WHERE id = updated_draft.package_id;
    IF package_row.catalog_version <> updated_draft.base_catalog_version + 1
       OR package_row.amount_cents <> updated_draft.amount_cents
       OR package_row.sessions_per_period <> updated_draft.sessions_per_period
       OR package_row.is_active IS DISTINCT FROM TRUE
       OR package_row.is_publicly_listed IS DISTINCT FROM TRUE THEN
        RAISE EXCEPTION 'published_package_contract_is_incoherent';
    END IF;

    SELECT * INTO first_price
    FROM public.package_prices
    WHERE id = (first_publish #>> '{package_price,id}')::UUID;
    IF first_price.status <> 'active'
       OR first_price.catalog_version <> package_row.catalog_version
       OR first_price.stripe_price_id <> 'price_catalog_v2_recurring_2' THEN
        RAISE EXCEPTION 'first_catalog_price_snapshot_is_incoherent';
    END IF;

    replay_publish := public.publish_package_catalog_draft(
        updated_draft.id,
        updated_draft.revision,
        'acct_catalog_v2_test',
        FALSE,
        'prod_catalog_v2_test',
        'price_catalog_v2_initial_2',
        'price_catalog_v2_recurring_2',
        actor_id
    );
    IF (replay_publish ->> 'changed')::BOOLEAN IS DISTINCT FROM FALSE
       OR replay_publish #>> '{package_price,id}' <> first_price.id::TEXT THEN
        RAISE EXCEPTION 'catalog_publish_replay_is_not_idempotent';
    END IF;

    second_draft := public.create_package_catalog_draft(
        p_actor_id => actor_id,
        p_package_id => package_row.id
    );
    second_draft := public.update_package_catalog_draft(
        second_draft.id,
        second_draft.revision,
        '{"es":"Plan flexible 2","en":"Flexible plan 2","ru":"Гибкий план 2"}'::JSONB,
        27107,
        'day',
        28::SMALLINT,
        6,
        50::SMALLINT,
        FALSE,
        FALSE,
        TRUE,
        actor_id
    );
    second_publish := public.publish_package_catalog_draft(
        second_draft.id,
        second_draft.revision,
        'acct_catalog_v2_test',
        FALSE,
        'prod_catalog_v2_test',
        'price_catalog_v2_initial_3',
        'price_catalog_v2_recurring_3',
        actor_id
    );

    SELECT * INTO second_price
    FROM public.package_prices
    WHERE id = (second_publish #>> '{package_price,id}')::UUID;
    SELECT * INTO second_snapshot
    FROM public.checkout_v2_price_snapshots
    WHERE package_price_id = second_price.id;

    IF second_price.status <> 'active'
       OR second_price.catalog_version <> first_price.catalog_version + 1
       OR second_snapshot.initial_amount_cents <> 27107
       OR second_snapshot.recurring_amount_cents <> 27107
       OR second_snapshot.sessions_per_period <> 6
       OR second_snapshot.class_duration_minutes <> 50
       OR second_snapshot.session_base_amount_cents <> 4517
       OR second_snapshot.session_remainder_units <> 5 THEN
        RAISE EXCEPTION 'generic_checkout_price_snapshot_is_incoherent';
    END IF;
    IF (SELECT status FROM public.package_prices WHERE id = first_price.id) <> 'retired' THEN
        RAISE EXCEPTION 'previous_catalog_price_was_not_retired';
    END IF;

    retire_result := public.retire_versioned_package(package_row.id, actor_id);
    SELECT * INTO package_row FROM public.packages WHERE id = package_row.id;
    IF (retire_result ->> 'changed')::BOOLEAN IS DISTINCT FROM TRUE
       OR package_row.is_active IS DISTINCT FROM FALSE
       OR package_row.is_publicly_listed IS DISTINCT FROM FALSE
       OR (SELECT status FROM public.package_prices WHERE id = second_price.id) <> 'retired' THEN
        RAISE EXCEPTION 'catalog_package_retirement_is_incoherent';
    END IF;

    discarded_draft := public.create_package_catalog_draft(
        p_actor_id => actor_id,
        p_package_id => package_row.id
    );
    discarded_draft := public.discard_package_catalog_draft(
        discarded_draft.id,
        discarded_draft.revision,
        actor_id
    );
    IF discarded_draft.status <> 'discarded'
       OR discarded_draft.discarded_at IS NULL THEN
        RAISE EXCEPTION 'catalog_draft_discard_is_incoherent';
    END IF;

    SELECT count(*) INTO audit_count
    FROM public.admin_audit_log
    WHERE admin_id = actor_id
      AND action IN (
          'catalog_v2.draft_create',
          'catalog_v2.draft_update',
          'catalog_v2.publish',
          'catalog_v2.retire',
          'catalog_v2.draft_discard'
      );
    IF audit_count <> 9 THEN
        RAISE EXCEPTION 'catalog_audit_history_is_incomplete: %', audit_count;
    END IF;
END
$$;

ROLLBACK;
