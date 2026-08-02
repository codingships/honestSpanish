BEGIN;

INSERT INTO public.crm_contacts (id, primary_email, lifecycle_stage)
VALUES ('00000000-0000-4000-8000-000000000901', 'no-show-idempotency@example.test', 'customer');

-- Historical duplicates deliberately have no key. Reapplying the additive
-- migration must select one canonical row without deleting the others.
INSERT INTO public.crm_tasks (
    id, contact_id, title, task_type, priority, status,
    related_entity_type, related_entity_id, metadata, created_at
)
VALUES
(
    '00000000-0000-4000-8000-000000000910',
    '00000000-0000-4000-8000-000000000901',
    'Old completed follow-up', 'email', 'high', 'done',
    'session_no_show', '00000000-0000-4000-8000-000000000919',
    '{"action":"no_show_follow_up"}'::JSONB, '2026-07-01T10:00:00Z'
),
(
    '00000000-0000-4000-8000-000000000911',
    '00000000-0000-4000-8000-000000000901',
    'Pending follow-up', 'email', 'high', 'open',
    'session_no_show', '00000000-0000-4000-8000-000000000919',
    '{"action":"no_show_follow_up"}'::JSONB, '2026-07-02T10:00:00Z'
);

INSERT INTO public.crm_activities (
    id, contact_id, activity_type, subject, occurred_at,
    related_entity_type, related_entity_id, metadata, created_at
)
VALUES
(
    '00000000-0000-4000-8000-000000000920',
    '00000000-0000-4000-8000-000000000901',
    'class', 'Historical completion', '2026-07-01T10:55:00Z',
    'session_completed', '00000000-0000-4000-8000-000000000929',
    '{}'::JSONB, '2026-07-01T10:55:00Z'
),
(
    '00000000-0000-4000-8000-000000000921',
    '00000000-0000-4000-8000-000000000901',
    'class', 'Duplicate historical completion', '2026-07-01T10:56:00Z',
    'session_completed', '00000000-0000-4000-8000-000000000929',
    '{}'::JSONB, '2026-07-01T10:56:00Z'
),
(
    '00000000-0000-4000-8000-000000000930',
    '00000000-0000-4000-8000-000000000901',
    'system', 'First class completed', '2026-07-01T10:55:00Z',
    'subscription_activation', '00000000-0000-4000-8000-000000000939',
    '{"activation_goal":"first_class_completed","session_id":"session-a"}'::JSONB,
    '2026-07-01T10:55:00Z'
),
(
    '00000000-0000-4000-8000-000000000931',
    '00000000-0000-4000-8000-000000000901',
    'system', 'Duplicate first class completed', '2026-07-08T10:55:00Z',
    'subscription_activation', '00000000-0000-4000-8000-000000000939',
    '{"activation_goal":"first_class_completed","session_id":"session-b"}'::JSONB,
    '2026-07-08T10:55:00Z'
);

\ir ../../supabase/migrations/20260802034445_add_crm_no_show_idempotency.sql

DO $$
BEGIN
    IF (
        SELECT id
        FROM public.crm_tasks
        WHERE idempotency_key = 'crm:no-show-follow-up:task:00000000-0000-4000-8000-000000000919'
    ) IS DISTINCT FROM '00000000-0000-4000-8000-000000000911'::UUID THEN
        RAISE EXCEPTION 'crm_no_show_backfill_did_not_prefer_open_task';
    END IF;

    IF (
        SELECT COUNT(*)
        FROM public.crm_activities
        WHERE related_entity_type = 'session_completed'
          AND related_entity_id = '00000000-0000-4000-8000-000000000929'
    ) <> 2 OR (
        SELECT COUNT(*)
        FROM public.crm_activities
        WHERE idempotency_key = 'crm:session-outcome:activity:complete:00000000-0000-4000-8000-000000000929'
    ) <> 1 THEN
        RAISE EXCEPTION 'crm_session_outcome_backfill_is_not_canonical_and_non_destructive';
    END IF;

    IF (
        SELECT COUNT(*)
        FROM public.crm_activities
        WHERE related_entity_type = 'subscription_activation'
          AND related_entity_id = '00000000-0000-4000-8000-000000000939'
    ) <> 2 OR (
        SELECT COUNT(*)
        FROM public.crm_activities
        WHERE idempotency_key = 'crm:first-class-completed:activity:subscription_activation:00000000-0000-4000-8000-000000000939'
    ) <> 1 THEN
        RAISE EXCEPTION 'crm_first_class_completion_backfill_is_not_canonical_and_non_destructive';
    END IF;
END;
$$;

INSERT INTO public.crm_tasks (
    id,
    contact_id,
    title,
    task_type,
    priority,
    related_entity_type,
    related_entity_id,
    idempotency_key,
    metadata
)
VALUES (
    '00000000-0000-4000-8000-000000000902',
    '00000000-0000-4000-8000-000000000901',
    'Follow up after missed class',
    'email',
    'high',
    'session_no_show',
    '00000000-0000-4000-8000-000000000900',
    'crm:no-show-follow-up:task:00000000-0000-4000-8000-000000000900',
    '{"action":"no_show_follow_up"}'::JSONB
)
ON CONFLICT (idempotency_key) DO NOTHING;

INSERT INTO public.crm_tasks (
    id,
    contact_id,
    title,
    task_type,
    priority,
    related_entity_type,
    related_entity_id,
    idempotency_key,
    metadata
)
VALUES (
    '00000000-0000-4000-8000-000000000903',
    '00000000-0000-4000-8000-000000000901',
    'Duplicate replay',
    'email',
    'high',
    'session_no_show',
    '00000000-0000-4000-8000-000000000900',
    'crm:no-show-follow-up:task:00000000-0000-4000-8000-000000000900',
    '{"action":"no_show_follow_up"}'::JSONB
)
ON CONFLICT (idempotency_key) DO NOTHING;

DO $$
DECLARE
    alarm_refreshed BOOLEAN;
BEGIN
    IF has_function_privilege(
        'anon',
        'public.refresh_crm_no_show_contact_alarm(uuid,uuid,timestamptz,timestamptz)',
        'EXECUTE'
    ) OR has_function_privilege(
        'authenticated',
        'public.refresh_crm_no_show_contact_alarm(uuid,uuid,timestamptz,timestamptz)',
        'EXECUTE'
    ) OR NOT has_function_privilege(
        'service_role',
        'public.refresh_crm_no_show_contact_alarm(uuid,uuid,timestamptz,timestamptz)',
        'EXECUTE'
    ) THEN
        RAISE EXCEPTION 'crm_no_show_contact_alarm_privileges_are_not_service_role_only';
    END IF;

    alarm_refreshed := public.refresh_crm_no_show_contact_alarm(
        '00000000-0000-4000-8000-000000000902',
        '00000000-0000-4000-8000-000000000901',
        '2026-07-03T10:15:00Z',
        '2026-07-02T10:15:00Z'
    );

    IF alarm_refreshed IS DISTINCT FROM TRUE OR (
        SELECT next_follow_up_at
        FROM public.crm_contacts
        WHERE id = '00000000-0000-4000-8000-000000000901'
    ) IS DISTINCT FROM '2026-07-03T10:15:00Z'::TIMESTAMPTZ THEN
        RAISE EXCEPTION 'crm_no_show_open_task_did_not_refresh_contact_alarm';
    END IF;

    UPDATE public.crm_tasks
    SET status = 'snoozed'
    WHERE id = '00000000-0000-4000-8000-000000000902';

    UPDATE public.crm_contacts
    SET next_follow_up_at = '2026-07-04T10:15:00Z'
    WHERE id = '00000000-0000-4000-8000-000000000901';

    alarm_refreshed := public.refresh_crm_no_show_contact_alarm(
        '00000000-0000-4000-8000-000000000902',
        '00000000-0000-4000-8000-000000000901',
        '2026-07-05T10:15:00Z',
        '2026-07-02T10:20:00Z'
    );

    IF alarm_refreshed IS DISTINCT FROM FALSE OR (
        SELECT next_follow_up_at
        FROM public.crm_contacts
        WHERE id = '00000000-0000-4000-8000-000000000901'
    ) IS DISTINCT FROM '2026-07-04T10:15:00Z'::TIMESTAMPTZ OR (
        SELECT status
        FROM public.crm_tasks
        WHERE id = '00000000-0000-4000-8000-000000000902'
    ) IS DISTINCT FROM 'snoozed' THEN
        RAISE EXCEPTION 'crm_no_show_manual_task_state_was_not_preserved';
    END IF;
END;
$$;

INSERT INTO public.crm_activities (
    id,
    contact_id,
    activity_type,
    subject,
    related_entity_type,
    related_entity_id,
    idempotency_key,
    metadata
)
VALUES (
    '00000000-0000-4000-8000-000000000904',
    '00000000-0000-4000-8000-000000000901',
    'system',
    'No-show follow-up task created',
    'session_no_show',
    '00000000-0000-4000-8000-000000000900',
    'crm:no-show-follow-up:activity:00000000-0000-4000-8000-000000000900',
    '{"action":"no_show_follow_up"}'::JSONB
)
ON CONFLICT (idempotency_key) DO NOTHING;

INSERT INTO public.crm_activities (
    id,
    contact_id,
    activity_type,
    subject,
    related_entity_type,
    related_entity_id,
    idempotency_key,
    metadata
)
VALUES (
    '00000000-0000-4000-8000-000000000905',
    '00000000-0000-4000-8000-000000000901',
    'system',
    'Duplicate replay',
    'session_no_show',
    '00000000-0000-4000-8000-000000000900',
    'crm:no-show-follow-up:activity:00000000-0000-4000-8000-000000000900',
    '{"action":"no_show_follow_up"}'::JSONB
)
ON CONFLICT (idempotency_key) DO NOTHING;

DO $$
BEGIN
    IF (
        SELECT COUNT(*)
        FROM public.crm_tasks
        WHERE idempotency_key = 'crm:no-show-follow-up:task:00000000-0000-4000-8000-000000000900'
    ) <> 1 THEN
        RAISE EXCEPTION 'crm_no_show_task_idempotency_failed';
    END IF;

    IF (
        SELECT COUNT(*)
        FROM public.crm_activities
        WHERE idempotency_key = 'crm:no-show-follow-up:activity:00000000-0000-4000-8000-000000000900'
    ) <> 1 THEN
        RAISE EXCEPTION 'crm_no_show_activity_idempotency_failed';
    END IF;
END;
$$;

ROLLBACK;
