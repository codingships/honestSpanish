-- Mandatory teacher work obligations and their append-only corrections.
-- This surface records internal obligations only: it neither closes periods nor
-- represents invoices, payments, transfers, taxes, or distributable profit.

ALTER TABLE public.teacher_compensation_engagements
    ADD CONSTRAINT teacher_compensation_engagements_identity_key
    UNIQUE (id, teacher_id, engagement_kind);

CREATE TABLE public.teacher_compensation_work_ledger (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id UUID NOT NULL UNIQUE,
    teacher_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    engagement_id UUID NOT NULL,
    engagement_kind TEXT NOT NULL CHECK (engagement_kind IN ('founder', 'external')),
    work_kind TEXT NOT NULL
        CHECK (work_kind IN ('mandatory_training', 'mandatory_meeting')),
    started_at TIMESTAMPTZ NOT NULL CHECK (pg_catalog.isfinite(started_at)),
    ended_at TIMESTAMPTZ NOT NULL CHECK (pg_catalog.isfinite(ended_at)),
    duration_minutes SMALLINT NOT NULL CHECK (duration_minutes BETWEEN 1 AND 720),
    policy_version SMALLINT NOT NULL DEFAULT 1
        REFERENCES public.teacher_compensation_policy_versions(version) ON DELETE RESTRICT
        CHECK (policy_version = 1),
    rate_cents_per_minute INTEGER NOT NULL CHECK (rate_cents_per_minute = 25),
    amount_cents INTEGER NOT NULL CHECK (amount_cents BETWEEN 25 AND 18000),
    currency TEXT NOT NULL CHECK (currency = 'eur'),
    description TEXT NOT NULL CHECK (char_length(btrim(description)) BETWEEN 5 AND 1000),
    recorded_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT date_trunc('second', clock_timestamp()),
    CONSTRAINT teacher_compensation_work_interval_shape CHECK (
        ended_at > started_at
        AND MOD(EXTRACT(EPOCH FROM (ended_at - started_at)), 60) = 0
        AND duration_minutes
            = (EXTRACT(EPOCH FROM (ended_at - started_at)) / 60)::INTEGER
    ),
    CONSTRAINT teacher_compensation_work_amount_matches_duration CHECK (
        amount_cents = duration_minutes * rate_cents_per_minute
    ),
    CONSTRAINT teacher_compensation_work_id_teacher_key UNIQUE (id, teacher_id),
    CONSTRAINT teacher_compensation_work_engagement_identity_fkey
        FOREIGN KEY (engagement_id, teacher_id, engagement_kind)
        REFERENCES public.teacher_compensation_engagements(
            id, teacher_id, engagement_kind
        ) ON DELETE RESTRICT
);

CREATE INDEX teacher_compensation_work_teacher_started_idx
    ON public.teacher_compensation_work_ledger(teacher_id, started_at, id);
CREATE INDEX teacher_compensation_work_engagement_idx
    ON public.teacher_compensation_work_ledger(engagement_id);
CREATE INDEX teacher_compensation_work_recorded_by_idx
    ON public.teacher_compensation_work_ledger(recorded_by, created_at, id);

ALTER TABLE public.teacher_compensation_work_ledger
    ADD CONSTRAINT teacher_compensation_work_no_overlap
    EXCLUDE USING gist (
        teacher_id WITH =,
        tstzrange(started_at, ended_at, '[)') WITH &&
    );

CREATE TABLE public.teacher_compensation_work_adjustments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id UUID NOT NULL UNIQUE,
    work_entry_id UUID NOT NULL,
    teacher_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    minutes_delta SMALLINT NOT NULL CHECK (
        minutes_delta BETWEEN -720 AND 720 AND minutes_delta <> 0
    ),
    policy_version SMALLINT NOT NULL DEFAULT 1
        REFERENCES public.teacher_compensation_policy_versions(version) ON DELETE RESTRICT
        CHECK (policy_version = 1),
    rate_cents_per_minute INTEGER NOT NULL CHECK (rate_cents_per_minute = 25),
    amount_delta_cents INTEGER NOT NULL CHECK (
        amount_delta_cents BETWEEN -18000 AND 18000
        AND amount_delta_cents <> 0
    ),
    currency TEXT NOT NULL CHECK (currency = 'eur'),
    reason TEXT NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 5 AND 1000),
    recorded_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT date_trunc('second', clock_timestamp()),
    CONSTRAINT teacher_compensation_work_adjustment_amount_matches_minutes CHECK (
        amount_delta_cents = minutes_delta * rate_cents_per_minute
    ),
    CONSTRAINT teacher_compensation_work_adjustment_identity_fkey
        FOREIGN KEY (work_entry_id, teacher_id)
        REFERENCES public.teacher_compensation_work_ledger(id, teacher_id)
        ON DELETE RESTRICT
);

CREATE INDEX teacher_compensation_work_adjustments_entry_created_idx
    ON public.teacher_compensation_work_adjustments(work_entry_id, created_at, id);
CREATE INDEX teacher_compensation_work_adjustments_teacher_created_idx
    ON public.teacher_compensation_work_adjustments(teacher_id, created_at, id);
CREATE INDEX teacher_compensation_work_adjustments_recorded_by_idx
    ON public.teacher_compensation_work_adjustments(recorded_by, created_at, id);

CREATE VIEW public.teacher_compensation_session_reconciliation_candidates
WITH (security_invoker = true)
AS
SELECT
    session.id AS session_id,
    session.subscription_id,
    session.checkout_v2_cycle_id AS cycle_id,
    session.teacher_id,
    session.student_id,
    teacher.full_name AS teacher_full_name,
    teacher.email AS teacher_email,
    student.full_name AS student_full_name,
    student.email AS student_email,
    session.status,
    CASE
        WHEN session.status = 'completed' THEN 'class_completed'
        WHEN session.status = 'no_show' THEN 'student_no_show'
        WHEN session.status = 'cancelled' THEN 'student_late_cancellation'
    END AS event_kind,
    session.scheduled_at,
    session.duration_minutes,
    CASE
        WHEN session.status = 'completed' THEN session.completed_at
        WHEN session.status = 'no_show' THEN session.no_show_at
        WHEN session.status = 'cancelled' THEN session.cancelled_at
    END AS source_occurred_at,
    session.completed_at,
    session.no_show_at,
    session.cancelled_at,
    session.cancelled_by,
    session.cancellation_reason
FROM public.sessions AS session
JOIN public.subscriptions AS subscription
  ON subscription.id = session.subscription_id
JOIN public.checkout_v2_cycles AS cycle
  ON cycle.id = session.checkout_v2_cycle_id
JOIN public.payments AS payment
  ON payment.id = cycle.payment_id
JOIN public.teacher_compensation_cycle_terms AS cycle_terms
  ON cycle_terms.cycle_id = cycle.id
JOIN LATERAL (
    SELECT engagement.id
    FROM public.teacher_compensation_engagements AS engagement
    WHERE engagement.teacher_id = session.teacher_id
      AND engagement.effective_from <= CASE
          WHEN session.status = 'completed' THEN session.completed_at
          WHEN session.status = 'no_show' THEN session.no_show_at
          WHEN session.status = 'cancelled' THEN session.cancelled_at
      END
    ORDER BY engagement.effective_from DESC
    LIMIT 1
) AS applicable_engagement ON TRUE
JOIN public.profiles AS teacher
  ON teacher.id = session.teacher_id
JOIN public.profiles AS student
  ON student.id = session.student_id
WHERE subscription.contract_schema_version = 2
  AND session.checkout_v2_cycle_id IS NOT NULL
  AND session.teacher_id IS NOT NULL
  AND session.duration_minutes = 50
  AND cycle.materialization_state = 'ready'
  AND payment.checkout_v2_cycle_id = cycle.id
  AND payment.status = 'succeeded'::public.payment_status
  AND payment.amount = cycle.amount_cents
  AND lower(payment.currency) = cycle.currency
  AND NOT EXISTS (
      SELECT 1
      FROM public.teacher_compensation_ledger AS ledger
      WHERE ledger.session_id = session.id
  )
  AND (
      (
          session.status = 'completed'
          AND session.completed_at IS NOT NULL
          AND session.scheduled_at IS NOT NULL
          AND session.completed_at
              >= session.scheduled_at
                  + make_interval(mins => session.duration_minutes)
          AND session.completed_at <= clock_timestamp()
      ) OR (
          session.status = 'no_show'
          AND session.scheduled_at IS NOT NULL
          AND session.no_show_at IS NOT NULL
          AND session.no_show_at >= session.scheduled_at + INTERVAL '15 minutes'
          AND session.no_show_at <= clock_timestamp()
      ) OR (
          session.status = 'cancelled'
          AND session.cancelled_at IS NOT NULL
          AND session.cancelled_by = session.student_id
          AND session.scheduled_at < session.cancelled_at + INTERVAL '24 hours'
          AND session.cancellation_reason IS DISTINCT FROM 'guarantee_refund'
          AND session.cancelled_at <= clock_timestamp()
      )
  );

CREATE VIEW public.teacher_compensation_work_balances
WITH (security_invoker = true)
AS
SELECT
    work_entry.id,
    work_entry.request_id,
    work_entry.teacher_id,
    work_entry.engagement_id,
    work_entry.engagement_kind,
    work_entry.work_kind,
    work_entry.started_at,
    work_entry.ended_at,
    work_entry.duration_minutes,
    work_entry.policy_version,
    work_entry.rate_cents_per_minute,
    work_entry.amount_cents,
    work_entry.currency,
    work_entry.description,
    work_entry.recorded_by,
    work_entry.created_at,
    COALESCE(adjustment_totals.minutes, 0)::INTEGER AS adjustment_minutes,
    (
        work_entry.duration_minutes
        + COALESCE(adjustment_totals.minutes, 0)
    )::INTEGER AS adjusted_minutes,
    COALESCE(adjustment_totals.amount_cents, 0)::INTEGER
        AS adjustment_amount_cents,
    (
        work_entry.amount_cents
        + COALESCE(adjustment_totals.amount_cents, 0)
    )::INTEGER AS adjusted_amount_cents
FROM public.teacher_compensation_work_ledger AS work_entry
LEFT JOIN LATERAL (
    SELECT
        SUM(adjustment.minutes_delta) AS minutes,
        SUM(adjustment.amount_delta_cents) AS amount_cents
    FROM public.teacher_compensation_work_adjustments AS adjustment
    WHERE adjustment.work_entry_id = work_entry.id
) AS adjustment_totals ON TRUE;

ALTER TABLE public.teacher_compensation_work_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teacher_compensation_work_adjustments ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE
    public.teacher_compensation_work_ledger,
    public.teacher_compensation_work_adjustments
FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT ON TABLE
    public.teacher_compensation_work_ledger,
    public.teacher_compensation_work_adjustments
TO service_role;

REVOKE ALL ON TABLE public.teacher_compensation_session_reconciliation_candidates
    FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.teacher_compensation_session_reconciliation_candidates
    TO service_role;

REVOKE ALL ON TABLE public.teacher_compensation_work_balances
    FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.teacher_compensation_work_balances
    TO service_role;

CREATE TRIGGER guard_teacher_compensation_work_immutable
    BEFORE UPDATE OR DELETE ON public.teacher_compensation_work_ledger
    FOR EACH ROW EXECUTE FUNCTION private.guard_teacher_compensation_immutable();
CREATE TRIGGER guard_teacher_compensation_work_adjustment_immutable
    BEFORE UPDATE OR DELETE ON public.teacher_compensation_work_adjustments
    FOR EACH ROW EXECUTE FUNCTION private.guard_teacher_compensation_immutable();

-- Once work has been frozen against an engagement, a later classification
-- event cannot be inserted inside that work history. A new event at the exact
-- end of the last interval is valid because work intervals are half-open.
CREATE OR REPLACE FUNCTION private.guard_teacher_compensation_engagement_work_history()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF NEW.effective_from < COALESCE((
        SELECT MAX(work_entry.ended_at)
        FROM public.teacher_compensation_work_ledger AS work_entry
        WHERE work_entry.teacher_id = NEW.teacher_id
    ), '-infinity'::TIMESTAMPTZ) THEN
        RAISE EXCEPTION 'teacher_compensation_state_conflicts'
            USING ERRCODE = '40001';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER guard_teacher_compensation_engagement_work_history
    BEFORE INSERT ON public.teacher_compensation_engagements
    FOR EACH ROW EXECUTE FUNCTION private.guard_teacher_compensation_engagement_work_history();

CREATE OR REPLACE FUNCTION public.record_teacher_compensation_work(
    p_request_id UUID,
    p_teacher_id UUID,
    p_work_kind TEXT,
    p_started_at TIMESTAMPTZ,
    p_ended_at TIMESTAMPTZ,
    p_description TEXT,
    p_recorded_by UUID
)
RETURNS public.teacher_compensation_work_ledger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    existing_row public.teacher_compensation_work_ledger%ROWTYPE;
    engagement_row public.teacher_compensation_engagements%ROWTYPE;
    policy_row public.teacher_compensation_policy_versions%ROWTYPE;
    work_row public.teacher_compensation_work_ledger%ROWTYPE;
    duration_seconds NUMERIC;
    duration_minutes INTEGER;
    trimmed_description TEXT := btrim(p_description);
BEGIN
    IF p_request_id IS NULL
       OR p_teacher_id IS NULL
       OR p_recorded_by IS NULL
       OR p_work_kind IS NULL
       OR p_work_kind NOT IN ('mandatory_training', 'mandatory_meeting')
       OR p_started_at IS NULL
       OR p_ended_at IS NULL
       OR NOT pg_catalog.isfinite(p_started_at)
       OR NOT pg_catalog.isfinite(p_ended_at)
       OR p_ended_at <= p_started_at
       OR p_description IS NULL
       OR char_length(trimmed_description) NOT BETWEEN 5 AND 1000 THEN
        RAISE EXCEPTION 'invalid_teacher_compensation_work'
            USING ERRCODE = '22023';
    END IF;

    duration_seconds := EXTRACT(EPOCH FROM (p_ended_at - p_started_at));
    IF duration_seconds % 60 <> 0
       OR duration_seconds / 60 NOT BETWEEN 1 AND 720
       OR p_ended_at > clock_timestamp() THEN
        RAISE EXCEPTION 'invalid_teacher_compensation_work'
            USING ERRCODE = '22023';
    END IF;
    duration_minutes := (duration_seconds / 60)::INTEGER;

    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(p_request_id::TEXT, 58141)
    );

    SELECT * INTO existing_row
    FROM public.teacher_compensation_work_ledger
    WHERE request_id = p_request_id
    FOR UPDATE;
    IF FOUND THEN
        IF ROW(
            existing_row.teacher_id,
            existing_row.work_kind,
            existing_row.started_at,
            existing_row.ended_at,
            existing_row.duration_minutes,
            existing_row.description,
            existing_row.recorded_by
        ) IS DISTINCT FROM ROW(
            p_teacher_id,
            p_work_kind,
            p_started_at,
            p_ended_at,
            duration_minutes::SMALLINT,
            trimmed_description,
            p_recorded_by
        ) THEN
            RAISE EXCEPTION 'teacher_compensation_state_conflicts'
                USING ERRCODE = '40001';
        END IF;
        RETURN existing_row;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = p_recorded_by AND role = 'admin'::public.user_role
    ) THEN
        RAISE EXCEPTION 'teacher_compensation_work_forbidden'
            USING ERRCODE = '42501';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = p_teacher_id AND role = 'teacher'::public.user_role
    ) THEN
        RAISE EXCEPTION 'teacher_compensation_work_requires_teacher'
            USING ERRCODE = '23514';
    END IF;

    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(p_teacher_id::TEXT, 58131)
    );

    SELECT * INTO engagement_row
    FROM public.teacher_compensation_engagements
    WHERE teacher_id = p_teacher_id
      AND effective_from <= p_started_at
    ORDER BY effective_from DESC
    LIMIT 1;
    IF engagement_row.id IS NULL THEN
        RAISE EXCEPTION 'teacher_compensation_precondition_missing'
            USING ERRCODE = '55000';
    END IF;
    IF EXISTS (
        SELECT 1
        FROM public.teacher_compensation_engagements AS later_engagement
        WHERE later_engagement.teacher_id = p_teacher_id
          AND later_engagement.effective_from > p_started_at
          AND later_engagement.effective_from < p_ended_at
    ) THEN
        RAISE EXCEPTION 'teacher_compensation_state_conflicts'
            USING ERRCODE = '40001';
    END IF;

    SELECT * INTO policy_row
    FROM public.teacher_compensation_policy_versions
    WHERE version = 1;
    IF policy_row.version IS NULL
       OR policy_row.mandatory_work_rate_cents_per_minute IS DISTINCT FROM 25
       OR policy_row.currency IS DISTINCT FROM 'eur' THEN
        RAISE EXCEPTION 'teacher_compensation_precondition_missing'
            USING ERRCODE = '55000';
    END IF;

    BEGIN
        INSERT INTO public.teacher_compensation_work_ledger (
            request_id,
            teacher_id,
            engagement_id,
            engagement_kind,
            work_kind,
            started_at,
            ended_at,
            duration_minutes,
            policy_version,
            rate_cents_per_minute,
            amount_cents,
            currency,
            description,
            recorded_by
        ) VALUES (
            p_request_id,
            p_teacher_id,
            engagement_row.id,
            engagement_row.engagement_kind,
            p_work_kind,
            p_started_at,
            p_ended_at,
            duration_minutes,
            policy_row.version,
            policy_row.mandatory_work_rate_cents_per_minute,
            duration_minutes * policy_row.mandatory_work_rate_cents_per_minute,
            policy_row.currency,
            trimmed_description,
            p_recorded_by
        ) RETURNING * INTO work_row;
    EXCEPTION WHEN exclusion_violation THEN
        RAISE EXCEPTION 'teacher_compensation_state_conflicts'
            USING ERRCODE = '40001';
    END;

    INSERT INTO public.admin_audit_log (
        admin_id, action, entity_type, entity_id, after
    ) VALUES (
        p_recorded_by,
        'record_teacher_compensation_work',
        'teacher_compensation_work_ledger',
        work_row.id::TEXT,
        pg_catalog.to_jsonb(work_row)
    );

    RETURN work_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.adjust_teacher_compensation_work(
    p_request_id UUID,
    p_work_entry_id UUID,
    p_minutes_delta INTEGER,
    p_reason TEXT,
    p_recorded_by UUID
)
RETURNS public.teacher_compensation_work_adjustments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    existing_row public.teacher_compensation_work_adjustments%ROWTYPE;
    work_row public.teacher_compensation_work_ledger%ROWTYPE;
    policy_row public.teacher_compensation_policy_versions%ROWTYPE;
    adjustment_row public.teacher_compensation_work_adjustments%ROWTYPE;
    adjusted_minutes INTEGER;
    trimmed_reason TEXT := btrim(p_reason);
BEGIN
    IF p_request_id IS NULL
       OR p_work_entry_id IS NULL
       OR p_recorded_by IS NULL
       OR p_minutes_delta IS NULL
       OR p_minutes_delta = 0
       OR p_minutes_delta NOT BETWEEN -720 AND 720
       OR p_reason IS NULL
       OR char_length(trimmed_reason) NOT BETWEEN 5 AND 1000 THEN
        RAISE EXCEPTION 'invalid_teacher_compensation_work_adjustment'
            USING ERRCODE = '22023';
    END IF;

    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(p_request_id::TEXT, 58142)
    );

    SELECT * INTO existing_row
    FROM public.teacher_compensation_work_adjustments
    WHERE request_id = p_request_id
    FOR UPDATE;
    IF FOUND THEN
        IF ROW(
            existing_row.work_entry_id,
            existing_row.minutes_delta,
            existing_row.reason,
            existing_row.recorded_by
        ) IS DISTINCT FROM ROW(
            p_work_entry_id,
            p_minutes_delta::SMALLINT,
            trimmed_reason,
            p_recorded_by
        ) THEN
            RAISE EXCEPTION 'teacher_compensation_state_conflicts'
                USING ERRCODE = '40001';
        END IF;
        RETURN existing_row;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = p_recorded_by AND role = 'admin'::public.user_role
    ) THEN
        RAISE EXCEPTION 'teacher_compensation_work_forbidden'
            USING ERRCODE = '42501';
    END IF;

    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(p_work_entry_id::TEXT, 58143)
    );
    SELECT * INTO work_row
    FROM public.teacher_compensation_work_ledger
    WHERE id = p_work_entry_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'teacher_compensation_precondition_missing'
            USING ERRCODE = '55000';
    END IF;

    SELECT * INTO policy_row
    FROM public.teacher_compensation_policy_versions
    WHERE version = work_row.policy_version;
    IF policy_row.version IS NULL
       OR policy_row.mandatory_work_rate_cents_per_minute
            IS DISTINCT FROM work_row.rate_cents_per_minute
       OR policy_row.currency IS DISTINCT FROM work_row.currency THEN
        RAISE EXCEPTION 'teacher_compensation_precondition_missing'
            USING ERRCODE = '55000';
    END IF;

    SELECT work_row.duration_minutes
        + COALESCE(SUM(existing_adjustment.minutes_delta), 0)::INTEGER
        + p_minutes_delta
    INTO adjusted_minutes
    FROM public.teacher_compensation_work_adjustments AS existing_adjustment
    WHERE existing_adjustment.work_entry_id = p_work_entry_id;
    IF adjusted_minutes NOT BETWEEN 0 AND 720 THEN
        RAISE EXCEPTION 'teacher_compensation_work_adjustment_balance_out_of_range'
            USING ERRCODE = '23514';
    END IF;

    INSERT INTO public.teacher_compensation_work_adjustments (
        request_id,
        work_entry_id,
        teacher_id,
        minutes_delta,
        policy_version,
        rate_cents_per_minute,
        amount_delta_cents,
        currency,
        reason,
        recorded_by
    ) VALUES (
        p_request_id,
        work_row.id,
        work_row.teacher_id,
        p_minutes_delta,
        policy_row.version,
        policy_row.mandatory_work_rate_cents_per_minute,
        p_minutes_delta * policy_row.mandatory_work_rate_cents_per_minute,
        policy_row.currency,
        trimmed_reason,
        p_recorded_by
    ) RETURNING * INTO adjustment_row;

    INSERT INTO public.admin_audit_log (
        admin_id, action, entity_type, entity_id, after
    ) VALUES (
        p_recorded_by,
        'adjust_teacher_compensation_work',
        'teacher_compensation_work_adjustments',
        adjustment_row.id::TEXT,
        pg_catalog.to_jsonb(adjustment_row)
    );

    RETURN adjustment_row;
END;
$$;

REVOKE ALL ON FUNCTION public.record_teacher_compensation_work(
    UUID, UUID, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, UUID
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_teacher_compensation_work(
    UUID, UUID, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, UUID
) TO service_role;

REVOKE ALL ON FUNCTION public.adjust_teacher_compensation_work(
    UUID, UUID, INTEGER, TEXT, UUID
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.adjust_teacher_compensation_work(
    UUID, UUID, INTEGER, TEXT, UUID
) TO service_role;

REVOKE ALL ON FUNCTION private.guard_teacher_compensation_engagement_work_history()
    FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON TABLE public.teacher_compensation_work_ledger IS
    'Append-only obligations for actual mandatory teacher training and meetings.';
COMMENT ON TABLE public.teacher_compensation_work_adjustments IS
    'Append-only minute corrections linked to mandatory-work obligations.';
