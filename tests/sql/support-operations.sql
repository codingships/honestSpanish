\set ON_ERROR_STOP on
SET TIME ZONE 'UTC';
SET lock_timeout = '5s';
SET statement_timeout = '30s';

BEGIN;
SET LOCAL session_replication_role = replica;
DELETE FROM public.admin_audit_log WHERE entity_type = 'support_ticket' AND entity_id LIKE '99110000-%';
DELETE FROM public.support_ticket_operations WHERE ticket_id::TEXT LIKE '99110000-%';
DELETE FROM public.support_ticket_events WHERE ticket_id::TEXT LIKE '99110000-%';
DELETE FROM public.support_tickets WHERE id::TEXT LIKE '99110000-%';
DELETE FROM public.profiles WHERE id::TEXT LIKE '99100000-%';
DELETE FROM auth.users WHERE id::TEXT LIKE '99100000-%';
COMMIT;

INSERT INTO auth.users (id, email) VALUES
    ('99100000-0000-4000-8000-000000000001', 'support-admin@test.invalid'),
    ('99100000-0000-4000-8000-000000000002', 'support-admin-two@test.invalid'),
    ('99100000-0000-4000-8000-000000000003', 'support-student@test.invalid'),
    ('99100000-0000-4000-8000-000000000004', 'support-other@test.invalid'),
    ('99100000-0000-4000-8000-000000000005', 'support-delete-admin@test.invalid'),
    ('99100000-0000-4000-8000-000000000006', 'support-delete-student@test.invalid');
BEGIN;
ALTER TABLE public.profiles
    DISABLE TRIGGER guard_managed_profile_role_transition_trigger;
UPDATE public.profiles SET full_name = 'Support Admin', role = 'admin'
WHERE id = '99100000-0000-4000-8000-000000000001';
UPDATE public.profiles SET full_name = 'Support Admin Two', role = 'admin'
WHERE id = '99100000-0000-4000-8000-000000000002';
UPDATE public.profiles SET full_name = 'Support Student', role = 'student'
WHERE id = '99100000-0000-4000-8000-000000000003';
UPDATE public.profiles SET full_name = 'Other Student', role = 'student'
WHERE id = '99100000-0000-4000-8000-000000000004';
UPDATE public.profiles SET full_name = 'Admin To Delete', role = 'admin'
WHERE id = '99100000-0000-4000-8000-000000000005';
UPDATE public.profiles SET full_name = 'Student To Delete', role = 'student'
WHERE id = '99100000-0000-4000-8000-000000000006';
ALTER TABLE public.profiles
    ENABLE TRIGGER guard_managed_profile_role_transition_trigger;
COMMIT;

INSERT INTO public.support_tickets (
    id, user_id, issue_type, issue_title, message
) VALUES
    (
        '99110000-0000-4000-8000-000000000001',
        '99100000-0000-4000-8000-000000000003',
        'payment', 'Payment question', 'I need help with my payment.'
    ),
    (
        '99110000-0000-4000-8000-000000000002',
        '99100000-0000-4000-8000-000000000004',
        'class', 'Other request', 'This belongs to another student.'
    );

DO $$
BEGIN
    IF (SELECT COUNT(*) FROM public.support_ticket_events
        WHERE ticket_id::TEXT LIKE '99110000-%' AND event_type = 'created') <> 2
       OR NOT EXISTS (
            SELECT 1 FROM public.support_ticket_events
            WHERE ticket_id = '99110000-0000-4000-8000-000000000001'
              AND visibility = 'public'
              AND sequence = 1
              AND body = 'I need help with my payment.'
       ) THEN
        RAISE EXCEPTION 'support_ticket_creation_history_is_wrong';
    END IF;
END
$$;

SELECT updated_at AS initial_updated_at
FROM public.support_tickets
WHERE id = '99110000-0000-4000-8000-000000000001'
\gset

CREATE TEMP TABLE support_test_results (label TEXT PRIMARY KEY, result JSONB);

INSERT INTO support_test_results (label, result)
SELECT 'first', public.admin_mutate_support_ticket(
    '99120000-0000-4000-8000-000000000001',
    '99110000-0000-4000-8000-000000000001',
    '99100000-0000-4000-8000-000000000001',
    'open', :'initial_updated_at'::TIMESTAMPTZ, 'triaged', 'high', TRUE,
    '99100000-0000-4000-8000-000000000002',
    'internal_note', 'Verify the billing provider before replying.'
);

INSERT INTO support_test_results (label, result)
SELECT 'replay', public.admin_mutate_support_ticket(
    '99120000-0000-4000-8000-000000000001',
    '99110000-0000-4000-8000-000000000001',
    '99100000-0000-4000-8000-000000000001',
    'open', :'initial_updated_at'::TIMESTAMPTZ, 'triaged', 'high', TRUE,
    '99100000-0000-4000-8000-000000000002',
    'internal_note', 'Verify the billing provider before replying.'
);

DO $$
BEGIN
    IF (SELECT (result->>'replayed')::BOOLEAN FROM support_test_results WHERE label = 'first')
       OR NOT (SELECT (result->>'replayed')::BOOLEAN FROM support_test_results WHERE label = 'replay')
       OR (SELECT COUNT(*) FROM public.support_ticket_operations
           WHERE request_id = '99120000-0000-4000-8000-000000000001') <> 1
       OR (SELECT COUNT(*) FROM public.support_ticket_events
           WHERE ticket_id = '99110000-0000-4000-8000-000000000001'
             AND event_type = 'internal_note' AND sequence = 2) <> 1
       OR (SELECT COUNT(*) FROM public.admin_audit_log
           WHERE entity_type = 'support_ticket'
             AND entity_id = '99110000-0000-4000-8000-000000000001') <> 1
       OR NOT EXISTS (
           SELECT 1 FROM public.support_tickets
           WHERE id = '99110000-0000-4000-8000-000000000001'
             AND status = 'triaged' AND priority = 'high'
             AND assigned_admin_id = '99100000-0000-4000-8000-000000000002'
       ) THEN
        RAISE EXCEPTION 'support_ticket_idempotent_mutation_is_wrong';
    END IF;
END
$$;

SELECT public.admin_mutate_support_ticket(
    '99120000-0000-4000-8000-000000000002',
    '99110000-0000-4000-8000-000000000001',
    '99100000-0000-4000-8000-000000000001',
    'triaged', (SELECT updated_at FROM public.support_tickets
        WHERE id = '99110000-0000-4000-8000-000000000001'),
    NULL, NULL, FALSE, NULL,
    'public_reply', 'We checked your account and will contact you shortly.'
);

DO $$
BEGIN
    IF (SELECT array_agg(sequence ORDER BY sequence)
        FROM public.support_ticket_events
        WHERE ticket_id = '99110000-0000-4000-8000-000000000001')
       IS DISTINCT FROM ARRAY[1::BIGINT, 2::BIGINT, 3::BIGINT] THEN
        RAISE EXCEPTION 'support_ticket_event_sequence_is_wrong';
    END IF;
END
$$;

DO $$
BEGIN
    IF (SELECT COUNT(*) FROM public.admin_audit_log
        WHERE entity_type = 'support_ticket'
          AND entity_id = '99110000-0000-4000-8000-000000000001') <> 2
       OR EXISTS (
            SELECT 1 FROM public.admin_audit_log AS audit
            WHERE audit.entity_type = 'support_ticket'
              AND audit.entity_id = '99110000-0000-4000-8000-000000000001'
              AND (
                audit.before ?| ARRAY[
                    'user_id', 'message', 'page_url', 'user_agent', 'context',
                    'admin_notes', 'issue_title', 'issue_type', 'ticket'
                ]
                OR audit.after ?| ARRAY[
                    'user_id', 'message', 'page_url', 'user_agent', 'context',
                    'admin_notes', 'issue_title', 'issue_type', 'ticket'
                ]
                OR NOT (audit.before ?& ARRAY[
                    'status', 'priority', 'assigned', 'updated_at'
                ])
                OR NOT (audit.after ?& ARRAY[
                    'status', 'priority', 'assigned', 'updated_at',
                    'event_id', 'request_id'
                ])
              )
       ) THEN
        RAISE EXCEPTION 'support_ticket_audit_snapshot_contains_content_or_pii';
    END IF;
END
$$;

DO $$
DECLARE
    stale_updated_at TIMESTAMPTZ := (
        SELECT (result->'ticket'->>'updated_at')::TIMESTAMPTZ
        FROM support_test_results WHERE label = 'first'
    );
BEGIN
    IF (SELECT updated_at FROM public.support_tickets
        WHERE id = '99110000-0000-4000-8000-000000000001') <= stale_updated_at THEN
        RAISE EXCEPTION 'support_ticket_version_did_not_advance';
    END IF;

    PERFORM public.admin_mutate_support_ticket(
        gen_random_uuid(), '99110000-0000-4000-8000-000000000001',
        '99100000-0000-4000-8000-000000000001',
        'triaged', stale_updated_at,
        NULL, 'low', FALSE, NULL, NULL, NULL
    );
    RAISE EXCEPTION 'support_ticket_stale_version_was_accepted';
EXCEPTION WHEN serialization_failure THEN
    IF SQLERRM <> 'support_ticket_state_conflict' THEN RAISE; END IF;
END
$$;

DO $$
BEGIN
    PERFORM public.admin_mutate_support_ticket(
        '99120000-0000-4000-8000-000000000001',
        '99110000-0000-4000-8000-000000000001',
        '99100000-0000-4000-8000-000000000001',
        'open', (SELECT expected_updated_at FROM public.support_ticket_operations
            WHERE request_id = '99120000-0000-4000-8000-000000000001'),
        'closed', 'high', TRUE,
        '99100000-0000-4000-8000-000000000002',
        'internal_note', 'Changed replay payload.'
    );
    RAISE EXCEPTION 'support_ticket_changed_replay_was_accepted';
EXCEPTION WHEN unique_violation THEN
    IF SQLERRM <> 'support_ticket_request_id_conflicts' THEN RAISE; END IF;
END
$$;

DO $$
BEGIN
    PERFORM public.admin_mutate_support_ticket(
        gen_random_uuid(), '99110000-0000-4000-8000-000000000001',
        '99100000-0000-4000-8000-000000000001',
        'open', (SELECT expected_updated_at FROM public.support_ticket_operations
            WHERE request_id = '99120000-0000-4000-8000-000000000001'),
        'closed', NULL, FALSE, NULL, NULL, NULL
    );
    RAISE EXCEPTION 'support_ticket_stale_state_was_accepted';
EXCEPTION WHEN serialization_failure THEN
    IF SQLERRM <> 'support_ticket_state_conflict' THEN RAISE; END IF;
END
$$;

DO $$
BEGIN
    PERFORM public.admin_mutate_support_ticket(
        gen_random_uuid(), '99110000-0000-4000-8000-000000000001',
        '99100000-0000-4000-8000-000000000003',
        'triaged', (SELECT updated_at FROM public.support_tickets
            WHERE id = '99110000-0000-4000-8000-000000000001'),
        'closed', NULL, FALSE, NULL, NULL, NULL
    );
    RAISE EXCEPTION 'support_ticket_non_admin_actor_was_accepted';
EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM <> 'support_ticket_actor_is_not_admin' THEN RAISE; END IF;
END
$$;

DO $$
BEGIN
    PERFORM public.admin_mutate_support_ticket(
        gen_random_uuid(), '99110000-0000-4000-8000-000000000001',
        '99100000-0000-4000-8000-000000000001',
        'triaged', (SELECT updated_at FROM public.support_tickets
            WHERE id = '99110000-0000-4000-8000-000000000001'),
        NULL, NULL, TRUE,
        '99100000-0000-4000-8000-000000000003', NULL, NULL
    );
    RAISE EXCEPTION 'support_ticket_non_admin_assignee_was_accepted';
EXCEPTION WHEN check_violation THEN
    IF SQLERRM <> 'support_ticket_assignee_is_not_admin' THEN RAISE; END IF;
END
$$;

DO $$
BEGIN
    UPDATE public.support_ticket_events SET body = body
    WHERE ticket_id = '99110000-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'support_ticket_event_was_mutated';
EXCEPTION WHEN check_violation THEN
    IF SQLERRM <> 'support_ticket_history_is_immutable' THEN RAISE; END IF;
END
$$;

DO $$
BEGIN
    UPDATE public.support_ticket_operations SET message_body = message_body
    WHERE request_id = '99120000-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'support_ticket_operation_was_mutated';
EXCEPTION WHEN check_violation THEN
    IF SQLERRM <> 'support_ticket_history_is_immutable' THEN RAISE; END IF;
END
$$;

DO $$
BEGIN
    IF NOT has_function_privilege(
        'service_role',
        'public.admin_mutate_support_ticket(uuid,uuid,uuid,text,timestamptz,text,text,boolean,uuid,text,text)',
        'EXECUTE'
    ) OR has_function_privilege(
        'authenticated',
        'public.admin_mutate_support_ticket(uuid,uuid,uuid,text,timestamptz,text,text,boolean,uuid,text,text)',
        'EXECUTE'
    ) OR has_table_privilege('service_role', 'public.support_tickets', 'UPDATE')
       OR has_table_privilege('authenticated', 'public.support_tickets', 'SELECT')
       OR has_table_privilege('authenticated', 'public.support_tickets', 'INSERT')
       OR has_table_privilege('authenticated', 'public.support_ticket_events', 'INSERT')
       OR NOT has_column_privilege('authenticated', 'public.support_tickets', 'user_id', 'INSERT')
       OR NOT has_column_privilege('authenticated', 'public.support_tickets', 'message', 'INSERT')
       OR has_column_privilege('authenticated', 'public.support_tickets', 'status', 'INSERT')
       OR has_column_privilege('authenticated', 'public.support_tickets', 'priority', 'INSERT')
       OR has_column_privilege('authenticated', 'public.support_tickets', 'assigned_admin_id', 'INSERT')
       OR has_column_privilege('authenticated', 'public.support_tickets', 'admin_notes', 'INSERT')
       OR has_column_privilege('authenticated', 'public.support_tickets', 'created_at', 'INSERT')
       OR has_column_privilege('authenticated', 'public.support_tickets', 'updated_at', 'INSERT') THEN
        RAISE EXCEPTION 'support_ticket_privileges_are_wrong';
    END IF;
END
$$;

INSERT INTO public.support_tickets (
    id, user_id, issue_type, issue_title, message
) VALUES (
    '99110000-0000-4000-8000-000000000003',
    '99100000-0000-4000-8000-000000000006',
    'account', 'Disposable ticket', 'This ticket verifies retention-safe deletion.'
);

SELECT public.admin_mutate_support_ticket(
    '99120000-0000-4000-8000-000000000003',
    '99110000-0000-4000-8000-000000000003',
    '99100000-0000-4000-8000-000000000005',
    'open', (SELECT updated_at FROM public.support_tickets
        WHERE id = '99110000-0000-4000-8000-000000000003'),
    'triaged', 'normal', TRUE,
    '99100000-0000-4000-8000-000000000005',
    'internal_note', 'This actor will be anonymized.'
);

DELETE FROM public.profiles
WHERE id = '99100000-0000-4000-8000-000000000005';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.support_tickets
        WHERE id = '99110000-0000-4000-8000-000000000003'
          AND assigned_admin_id IS NULL
    ) OR NOT EXISTS (
        SELECT 1 FROM public.support_ticket_events
        WHERE ticket_id = '99110000-0000-4000-8000-000000000003'
          AND event_type = 'internal_note' AND actor_id IS NULL
    ) OR NOT EXISTS (
        SELECT 1 FROM public.support_ticket_operations
        WHERE request_id = '99120000-0000-4000-8000-000000000003'
          AND admin_id IS NULL AND requested_assigned_admin_id IS NULL
    ) OR EXISTS (
        SELECT 1 FROM public.support_ticket_events
        WHERE ticket_id = '99110000-0000-4000-8000-000000000003'
          AND position('99100000-0000-4000-8000-000000000005' IN metadata::TEXT) > 0
    ) OR EXISTS (
        SELECT 1 FROM public.support_ticket_operations
        WHERE ticket_id = '99110000-0000-4000-8000-000000000003'
          AND position('99100000-0000-4000-8000-000000000005' IN result::TEXT) > 0
    ) OR EXISTS (
        SELECT 1 FROM public.admin_audit_log
        WHERE entity_type = 'support_ticket'
          AND entity_id = '99110000-0000-4000-8000-000000000003'
          AND (
            position('99100000-0000-4000-8000-000000000005' IN before::TEXT) > 0
            OR position('99100000-0000-4000-8000-000000000005' IN after::TEXT) > 0
          )
    ) THEN
        RAISE EXCEPTION 'support_ticket_actor_anonymization_is_wrong';
    END IF;
END
$$;

DELETE FROM auth.users
WHERE id = '99100000-0000-4000-8000-000000000006';

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM public.support_tickets
        WHERE id = '99110000-0000-4000-8000-000000000003'
    ) OR EXISTS (
        SELECT 1 FROM public.support_ticket_events
        WHERE ticket_id = '99110000-0000-4000-8000-000000000003'
    ) OR EXISTS (
        SELECT 1 FROM public.support_ticket_operations
        WHERE ticket_id = '99110000-0000-4000-8000-000000000003'
    ) OR NOT EXISTS (
        SELECT 1 FROM public.admin_audit_log AS audit
        WHERE audit.entity_type = 'support_ticket'
          AND audit.entity_id = '99110000-0000-4000-8000-000000000003'
          AND audit.admin_id IS NULL
          AND NOT (audit.before ?| ARRAY[
              'user_id', 'message', 'page_url', 'user_agent', 'context',
              'admin_notes', 'issue_title', 'issue_type', 'ticket'
          ])
          AND NOT (audit.after ?| ARRAY[
              'user_id', 'message', 'page_url', 'user_agent', 'context',
              'admin_notes', 'issue_title', 'issue_type', 'ticket'
          ])
    ) THEN
        RAISE EXCEPTION 'support_ticket_owner_deletion_was_blocked';
    END IF;
END
$$;

BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '99100000-0000-4000-8000-000000000003', TRUE);

DO $$
BEGIN
    IF (SELECT COUNT(*) FROM public.get_my_support_tickets(50, 0)) <> 1
       OR EXISTS (
           SELECT 1 FROM public.get_my_support_tickets(50, 0)
           WHERE id <> '99110000-0000-4000-8000-000000000001'
       )
       OR (SELECT COUNT(*) FROM public.get_my_support_ticket_events(
            '99110000-0000-4000-8000-000000000001', 100, NULL
       )) <> 2
       OR EXISTS (
           SELECT 1 FROM public.get_my_support_ticket_events(
                '99110000-0000-4000-8000-000000000001', 100, NULL
           )
           WHERE event_type = 'internal_note'
              OR body = 'Verify the billing provider before replying.'
       )
       OR (SELECT sequence FROM public.get_my_support_ticket_events(
            '99110000-0000-4000-8000-000000000001', 1, NULL
       )) <> 3
       OR (SELECT sequence FROM public.get_my_support_ticket_events(
            '99110000-0000-4000-8000-000000000001', 1, 3
       )) <> 1
       THEN
        RAISE EXCEPTION 'student_support_history_exposed_wrong_rows';
    END IF;

    BEGIN
        PERFORM 1 FROM public.get_my_support_ticket_events(
            '99110000-0000-4000-8000-000000000002', 20, NULL
        );
        RAISE EXCEPTION 'student_support_history_exposed_another_ticket';
    EXCEPTION WHEN no_data_found THEN
        IF SQLERRM <> 'support_ticket_not_found' THEN RAISE; END IF;
    END;
END
$$;

DO $$
BEGIN
    INSERT INTO public.support_tickets (
        id, user_id, issue_type, issue_title, message, status
    ) VALUES (
        '99110000-0000-4000-8000-000000000004',
        '99100000-0000-4000-8000-000000000003',
        'account', 'Forbidden state', 'A student must not set administrative state.', 'closed'
    );
    RAISE EXCEPTION 'student_support_insert_set_administrative_state';
EXCEPTION WHEN insufficient_privilege THEN
    NULL;
END
$$;

INSERT INTO public.support_tickets (
    id, user_id, issue_type, issue_title, message
) VALUES (
    '99110000-0000-4000-8000-000000000004',
    '99100000-0000-4000-8000-000000000003',
    'account', 'Allowed request', 'A student can still submit an ordinary support request.'
);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.support_ticket_events
        WHERE ticket_id = '99110000-0000-4000-8000-000000000004'
          AND sequence = 1 AND event_type = 'created'
    ) THEN
        RAISE EXCEPTION 'student_support_insert_did_not_create_history';
    END IF;
END
$$;
ROLLBACK;

BEGIN;
SET LOCAL session_replication_role = replica;
DELETE FROM public.admin_audit_log WHERE entity_type = 'support_ticket' AND entity_id LIKE '99110000-%';
DELETE FROM public.support_ticket_operations WHERE ticket_id::TEXT LIKE '99110000-%';
DELETE FROM public.support_ticket_events WHERE ticket_id::TEXT LIKE '99110000-%';
DELETE FROM public.support_tickets WHERE id::TEXT LIKE '99110000-%';
DELETE FROM public.profiles WHERE id::TEXT LIKE '99100000-%';
DELETE FROM auth.users WHERE id::TEXT LIKE '99100000-%';
COMMIT;
