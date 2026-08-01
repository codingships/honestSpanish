-- Materializing a paid Checkout V2 cycle and scheduling its external
-- Calendar/Meet work are one database outcome. The deferred trigger runs at
-- the end of the RPC transaction, after all four cycle positions are bound.

CREATE OR REPLACE FUNCTION private.ensure_checkout_v2_cycle_fulfillment(
    p_cycle_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    cycle_row public.checkout_v2_cycles%ROWTYPE;
    cycle_student_id UUID;
    session_ids UUID[];
    session_positions SMALLINT[];
    session_count INTEGER;
    exact_binding BOOLEAN;
    cycle_dedupe_key TEXT;
    cycle_payload JSONB;
    job_row public.fulfillment_jobs%ROWTYPE;
BEGIN
    SELECT * INTO cycle_row
    FROM public.checkout_v2_cycles AS target_cycle
    WHERE target_cycle.id = p_cycle_id;

    IF cycle_row.id IS NULL
       OR cycle_row.materialization_state IS DISTINCT FROM 'ready' THEN
        RAISE EXCEPTION 'checkout_v2_cycle_is_not_ready_for_fulfillment'
            USING ERRCODE = '23514';
    END IF;

    SELECT subscription_row.student_id
    INTO cycle_student_id
    FROM public.subscriptions AS subscription_row
    WHERE subscription_row.id = cycle_row.subscription_id;

    SELECT
        COUNT(*),
        ARRAY_AGG(
            session_row.id
            ORDER BY session_row.checkout_v2_cycle_session_index
        ),
        ARRAY_AGG(
            session_row.checkout_v2_cycle_session_index
            ORDER BY session_row.checkout_v2_cycle_session_index
        ),
        COALESCE(BOOL_AND(
            session_row.subscription_id = cycle_row.subscription_id
            AND session_row.student_id = cycle_student_id
            AND session_row.checkout_v2_cycle_id = cycle_row.id
        ), FALSE)
    INTO
        session_count,
        session_ids,
        session_positions,
        exact_binding
    FROM public.sessions AS session_row
    WHERE session_row.checkout_v2_cycle_id = cycle_row.id;

    IF cycle_student_id IS NULL
       OR session_count IS DISTINCT FROM 4
       OR session_positions IS DISTINCT FROM ARRAY[1, 2, 3, 4]::SMALLINT[]
       OR NOT exact_binding THEN
        RAISE EXCEPTION 'checkout_v2_cycle_fulfillment_requires_four_exact_sessions'
            USING ERRCODE = '23514';
    END IF;

    cycle_dedupe_key := 'checkout_v2_cycle:' || cycle_row.id::TEXT;
    cycle_payload := pg_catalog.jsonb_build_object(
        'checkoutV2CycleId', cycle_row.id,
        'sessionIds', pg_catalog.to_jsonb(session_ids),
        'autoCreateMeeting', TRUE,
        'sendEmail', TRUE
    );

    INSERT INTO public.fulfillment_jobs (
        job_type,
        subscription_id,
        student_id,
        dedupe_key,
        payload
    ) VALUES (
        'bulk_session_fulfillment',
        cycle_row.subscription_id,
        cycle_student_id,
        cycle_dedupe_key,
        cycle_payload
    )
    ON CONFLICT (job_type, dedupe_key)
        WHERE dedupe_key IS NOT NULL
        DO NOTHING;

    SELECT * INTO job_row
    FROM public.fulfillment_jobs AS existing_job
    WHERE existing_job.job_type = 'bulk_session_fulfillment'
      AND existing_job.dedupe_key = cycle_dedupe_key;

    IF job_row.id IS NULL
       OR job_row.subscription_id IS DISTINCT FROM cycle_row.subscription_id
       OR job_row.student_id IS DISTINCT FROM cycle_student_id
       OR job_row.payload IS DISTINCT FROM cycle_payload THEN
        RAISE EXCEPTION 'checkout_v2_cycle_fulfillment_job_conflicts'
            USING ERRCODE = '23505';
    END IF;

    RETURN;
END;
$$;

CREATE OR REPLACE FUNCTION private.enqueue_checkout_v2_cycle_fulfillment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF NEW.materialization_state = 'ready' THEN
        IF TG_OP = 'INSERT'
           OR (
                TG_OP = 'UPDATE'
                AND OLD.materialization_state IS DISTINCT FROM 'ready'
           ) THEN
            PERFORM private.ensure_checkout_v2_cycle_fulfillment(NEW.id);
        END IF;
    END IF;

    RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION private.ensure_checkout_v2_cycle_fulfillment(UUID)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.enqueue_checkout_v2_cycle_fulfillment()
    FROM PUBLIC, anon, authenticated, service_role;

CREATE CONSTRAINT TRIGGER enqueue_checkout_v2_cycle_fulfillment_trigger
    AFTER INSERT OR UPDATE ON public.checkout_v2_cycles
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW
    EXECUTE FUNCTION private.enqueue_checkout_v2_cycle_fulfillment();

-- Checkout V2 remained closed while this path was built, so a pre-existing
-- ready cycle is unexpected. Never infer that missing outbox state means its
-- external Calendar/Meet/email effects have not already happened elsewhere.
-- Fail closed and require explicit reconciliation instead of replaying them.
CREATE OR REPLACE FUNCTION private.assert_checkout_v2_cycle_fulfillment_upgrade_safe()
RETURNS VOID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM public.checkout_v2_cycles AS cycle_row
        JOIN public.subscriptions AS subscription_row
          ON subscription_row.id = cycle_row.subscription_id
        CROSS JOIN LATERAL (
            SELECT
                COUNT(session_row.id) AS session_count,
                ARRAY_AGG(
                    session_row.id
                    ORDER BY session_row.checkout_v2_cycle_session_index
                ) FILTER (WHERE session_row.id IS NOT NULL) AS session_ids,
                ARRAY_AGG(
                    session_row.checkout_v2_cycle_session_index
                    ORDER BY session_row.checkout_v2_cycle_session_index
                ) FILTER (WHERE session_row.id IS NOT NULL) AS session_positions
            FROM public.sessions AS session_row
            WHERE session_row.checkout_v2_cycle_id = cycle_row.id
        ) AS cycle_sessions
        WHERE cycle_row.materialization_state = 'ready'
          AND (
                cycle_sessions.session_count IS DISTINCT FROM 4
                OR cycle_sessions.session_positions
                    IS DISTINCT FROM ARRAY[1, 2, 3, 4]::SMALLINT[]
                OR NOT EXISTS (
                    SELECT 1
                    FROM public.fulfillment_jobs AS job_row
                    WHERE job_row.job_type = 'bulk_session_fulfillment'
                      AND job_row.subscription_id = cycle_row.subscription_id
                      AND job_row.student_id = subscription_row.student_id
                      AND job_row.dedupe_key =
                          'checkout_v2_cycle:' || cycle_row.id::TEXT
                      AND job_row.payload IS NOT DISTINCT FROM
                          pg_catalog.jsonb_build_object(
                              'checkoutV2CycleId', cycle_row.id,
                              'sessionIds',
                                  pg_catalog.to_jsonb(cycle_sessions.session_ids),
                              'autoCreateMeeting', TRUE,
                              'sendEmail', TRUE
                          )
                )
          )
    ) THEN
        RAISE EXCEPTION
            'checkout_v2_cycle_fulfillment_upgrade_requires_exact_ready_cycle_jobs'
            USING ERRCODE = '55000';
    END IF;

    RETURN;
END;
$$;

REVOKE ALL ON FUNCTION private.assert_checkout_v2_cycle_fulfillment_upgrade_safe()
    FROM PUBLIC, anon, authenticated, service_role;

SELECT private.assert_checkout_v2_cycle_fulfillment_upgrade_safe();

COMMENT ON FUNCTION private.ensure_checkout_v2_cycle_fulfillment(UUID) IS
    'Idempotently persists the exact Calendar/Meet outbox for one ready Checkout V2 cycle.';
COMMENT ON FUNCTION private.enqueue_checkout_v2_cycle_fulfillment() IS
    'Atomically enqueues exactly one durable Calendar/Meet batch for each ready Checkout V2 cycle.';
COMMENT ON FUNCTION private.assert_checkout_v2_cycle_fulfillment_upgrade_safe() IS
    'Fails a migration safely when historical ready cycles need explicit external-effect reconciliation.';
