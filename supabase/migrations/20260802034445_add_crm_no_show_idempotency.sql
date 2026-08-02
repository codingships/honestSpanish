ALTER TABLE public.crm_tasks
    ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

ALTER TABLE public.crm_activities
    ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

WITH ranked_tasks AS (
    SELECT
        id,
        ROW_NUMBER() OVER (
            PARTITION BY related_entity_id
            ORDER BY
                CASE
                    WHEN status = 'open' THEN 0
                    WHEN status = 'snoozed' THEN 1
                    ELSE 2
                END,
                created_at NULLS LAST,
                id
        ) AS canonical_rank
    FROM public.crm_tasks
    WHERE related_entity_type = 'session_no_show'
      AND related_entity_id IS NOT NULL
      AND metadata ->> 'action' = 'no_show_follow_up'
      AND idempotency_key IS NULL
)
UPDATE public.crm_tasks AS task
SET idempotency_key = 'crm:no-show-follow-up:task:' || task.related_entity_id
FROM ranked_tasks
WHERE task.id = ranked_tasks.id
  AND ranked_tasks.canonical_rank = 1;

WITH ranked_activities AS (
    SELECT
        id,
        ROW_NUMBER() OVER (
            PARTITION BY related_entity_id
            ORDER BY created_at NULLS LAST, id
        ) AS canonical_rank
    FROM public.crm_activities
    WHERE related_entity_type = 'session_no_show'
      AND related_entity_id IS NOT NULL
      AND activity_type = 'system'
      AND metadata ->> 'action' = 'no_show_follow_up'
      AND idempotency_key IS NULL
)
UPDATE public.crm_activities AS activity
SET idempotency_key = 'crm:no-show-follow-up:activity:' || activity.related_entity_id
FROM ranked_activities
WHERE activity.id = ranked_activities.id
  AND ranked_activities.canonical_rank = 1;

WITH ranked_session_outcomes AS (
    SELECT
        id,
        related_entity_type,
        related_entity_id,
        ROW_NUMBER() OVER (
            PARTITION BY related_entity_type, related_entity_id
            ORDER BY occurred_at NULLS LAST, created_at NULLS LAST, id
        ) AS canonical_rank
    FROM public.crm_activities
    WHERE activity_type = 'class'
      AND related_entity_type IN ('session_completed', 'session_no_show')
      AND related_entity_id IS NOT NULL
      AND idempotency_key IS NULL
)
UPDATE public.crm_activities AS activity
SET idempotency_key = 'crm:session-outcome:activity:'
    || CASE ranked_session_outcomes.related_entity_type
        WHEN 'session_completed' THEN 'complete'
        ELSE 'no_show'
    END
    || ':' || ranked_session_outcomes.related_entity_id
FROM ranked_session_outcomes
WHERE activity.id = ranked_session_outcomes.id
  AND ranked_session_outcomes.canonical_rank = 1;

WITH ranked_first_class_completions AS (
    SELECT
        id,
        related_entity_type,
        related_entity_id,
        ROW_NUMBER() OVER (
            PARTITION BY related_entity_type, related_entity_id
            ORDER BY occurred_at NULLS LAST, created_at NULLS LAST, id
        ) AS canonical_rank
    FROM public.crm_activities
    WHERE activity_type = 'system'
      AND metadata ->> 'activation_goal' = 'first_class_completed'
      AND related_entity_type IS NOT NULL
      AND related_entity_id IS NOT NULL
      AND idempotency_key IS NULL
)
UPDATE public.crm_activities AS activity
SET idempotency_key = 'crm:first-class-completed:activity:'
    || ranked_first_class_completions.related_entity_type
    || ':' || ranked_first_class_completions.related_entity_id
FROM ranked_first_class_completions
WHERE activity.id = ranked_first_class_completions.id
  AND ranked_first_class_completions.canonical_rank = 1;

CREATE UNIQUE INDEX IF NOT EXISTS crm_tasks_idempotency_key_unique_idx
    ON public.crm_tasks (idempotency_key);

CREATE UNIQUE INDEX IF NOT EXISTS crm_activities_idempotency_key_unique_idx
    ON public.crm_activities (idempotency_key);

COMMENT ON COLUMN public.crm_tasks.idempotency_key IS
    'Optional durable key for retry-safe task creation. Null preserves unrelated and historical workflows.';

COMMENT ON COLUMN public.crm_activities.idempotency_key IS
    'Optional durable key for retry-safe activity creation. Null preserves unrelated and historical workflows.';

CREATE OR REPLACE FUNCTION public.refresh_crm_no_show_contact_alarm(
    p_task_id UUID,
    p_contact_id UUID,
    p_due_at TIMESTAMPTZ,
    p_occurred_at TIMESTAMPTZ
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    task_status TEXT;
BEGIN
    IF p_task_id IS NULL
       OR p_contact_id IS NULL
       OR p_due_at IS NULL
       OR p_occurred_at IS NULL THEN
        RAISE EXCEPTION 'crm_no_show_contact_alarm_arguments_required'
            USING ERRCODE = '22004';
    END IF;

    SELECT task.status
    INTO task_status
    FROM public.crm_tasks AS task
    WHERE task.id = p_task_id
      AND task.contact_id = p_contact_id
    FOR UPDATE;

    IF NOT FOUND OR task_status <> 'open' THEN
        RETURN FALSE;
    END IF;

    UPDATE public.crm_contacts
    SET lifecycle_stage = 'customer',
        next_follow_up_at = p_due_at,
        updated_at = p_occurred_at
    WHERE id = p_contact_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'crm_no_show_contact_missing'
            USING ERRCODE = 'P0002';
    END IF;

    RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_crm_no_show_contact_alarm(UUID, UUID, TIMESTAMPTZ, TIMESTAMPTZ)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_crm_no_show_contact_alarm(UUID, UUID, TIMESTAMPTZ, TIMESTAMPTZ)
TO service_role;

COMMENT ON FUNCTION public.refresh_crm_no_show_contact_alarm(UUID, UUID, TIMESTAMPTZ, TIMESTAMPTZ) IS
    'Refreshes the CRM contact alarm only while the locked no-show task still belongs to that contact and remains open.';
