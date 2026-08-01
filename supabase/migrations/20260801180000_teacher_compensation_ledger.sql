-- Immutable teacher-compensation policy, cycle terms and session accruals.
-- This ledger records obligations only. It does not execute payouts, invoices,
-- transfers, tax treatment, founder distributions or later accounting entries.

ALTER TABLE public.sessions
    ADD COLUMN no_show_at TIMESTAMPTZ;

-- Stable source-time bootstrap only; this does not create compensation rows.
UPDATE public.sessions
SET no_show_at = CASE
    WHEN scheduled_at IS NOT NULL THEN GREATEST(
        COALESCE(updated_at, scheduled_at + INTERVAL '15 minutes'),
        scheduled_at + INTERVAL '15 minutes'
    )
    ELSE COALESCE(updated_at, created_at, date_trunc('second', clock_timestamp()))
END
WHERE status = 'no_show';

ALTER TABLE public.sessions
    ADD CONSTRAINT sessions_no_show_lifecycle_check CHECK (
        (status = 'no_show' AND no_show_at IS NOT NULL)
        OR (status <> 'no_show' AND no_show_at IS NULL)
    );

CREATE TABLE public.teacher_compensation_policy_versions (
    version SMALLINT PRIMARY KEY CHECK (version = 1),
    currency TEXT NOT NULL CHECK (currency = 'eur'),
    founder_class_rate_cents INTEGER NOT NULL CHECK (founder_class_rate_cents = 4000),
    external_initial_class_rate_cents INTEGER NOT NULL
        CHECK (external_initial_class_rate_cents = 2000),
    external_raised_class_rate_cents INTEGER NOT NULL
        CHECK (external_raised_class_rate_cents = 2500),
    mandatory_work_rate_cents_per_hour INTEGER NOT NULL
        CHECK (mandatory_work_rate_cents_per_hour = 1500),
    mandatory_work_rate_cents_per_minute INTEGER NOT NULL
        CHECK (mandatory_work_rate_cents_per_minute = 25),
    active_student_threshold SMALLINT NOT NULL CHECK (active_student_threshold = 10),
    elapsed_day_threshold SMALLINT NOT NULL CHECK (elapsed_day_threshold = 90),
    created_at TIMESTAMPTZ NOT NULL DEFAULT date_trunc('second', clock_timestamp())
);

INSERT INTO public.teacher_compensation_policy_versions (
    version,
    currency,
    founder_class_rate_cents,
    external_initial_class_rate_cents,
    external_raised_class_rate_cents,
    mandatory_work_rate_cents_per_hour,
    mandatory_work_rate_cents_per_minute,
    active_student_threshold,
    elapsed_day_threshold
) VALUES (1, 'eur', 4000, 2000, 2500, 1500, 25, 10, 90);

-- Engagement is an append-only sequence of effective classification events.
-- The latest event at a point in time is authoritative; no end-date mutation is
-- needed when a later event changes a teacher's classification.
CREATE TABLE public.teacher_compensation_engagements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id UUID NOT NULL UNIQUE,
    teacher_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    engagement_kind TEXT NOT NULL CHECK (engagement_kind IN ('founder', 'external')),
    effective_from TIMESTAMPTZ NOT NULL CHECK (pg_catalog.isfinite(effective_from)),
    configured_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    reason TEXT NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 5 AND 1000),
    created_at TIMESTAMPTZ NOT NULL DEFAULT date_trunc('second', clock_timestamp()),
    UNIQUE (teacher_id, effective_from)
);

CREATE INDEX teacher_compensation_engagements_effective_idx
    ON public.teacher_compensation_engagements(teacher_id, effective_from DESC);
CREATE INDEX teacher_compensation_engagements_configured_by_idx
    ON public.teacher_compensation_engagements(configured_by);

CREATE TABLE public.teacher_compensation_milestones (
    policy_version SMALLINT PRIMARY KEY
        REFERENCES public.teacher_compensation_policy_versions(version) ON DELETE RESTRICT,
    first_ready_initial_cycle_id UUID UNIQUE
        REFERENCES public.checkout_v2_cycles(id) ON DELETE RESTRICT,
    first_ready_initial_at TIMESTAMPTZ,
    ten_active_trigger_cycle_id UUID UNIQUE
        REFERENCES public.checkout_v2_cycles(id) ON DELETE RESTRICT,
    ten_active_reached_at TIMESTAMPTZ,
    ten_active_students_count SMALLINT CHECK (ten_active_students_count >= 10),
    ten_active_history_state TEXT NOT NULL
        CHECK (ten_active_history_state IN ('tracking', 'requires_confirmation')),
    ten_active_bootstrap_request_id UUID UNIQUE,
    ten_active_confirmed_by UUID REFERENCES public.profiles(id) ON DELETE RESTRICT,
    ten_active_history_confirmation TEXT CHECK (
        ten_active_history_confirmation IS NULL
        OR ten_active_history_confirmation IN ('not_reached', 'reached')
    ),
    ten_active_confirmation_reason TEXT CHECK (
        ten_active_confirmation_reason IS NULL
        OR char_length(btrim(ten_active_confirmation_reason)) BETWEEN 5 AND 1000
    ),
    created_at TIMESTAMPTZ NOT NULL DEFAULT date_trunc('second', clock_timestamp()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT date_trunc('second', clock_timestamp()),
    CONSTRAINT teacher_compensation_first_sale_shape CHECK (
        (first_ready_initial_cycle_id IS NULL) = (first_ready_initial_at IS NULL)
    ),
    CONSTRAINT teacher_compensation_ten_active_shape CHECK (
        (ten_active_trigger_cycle_id IS NULL)
        = (ten_active_reached_at IS NULL)
        AND (ten_active_trigger_cycle_id IS NULL)
        = (ten_active_students_count IS NULL)
    ),
    CONSTRAINT teacher_compensation_ten_active_confirmation_shape CHECK (
        (
            ten_active_history_state = 'requires_confirmation'
            AND ten_active_trigger_cycle_id IS NULL
            AND ten_active_reached_at IS NULL
            AND ten_active_students_count IS NULL
            AND ten_active_bootstrap_request_id IS NULL
            AND ten_active_confirmed_by IS NULL
            AND ten_active_history_confirmation IS NULL
            AND ten_active_confirmation_reason IS NULL
        ) OR (
            ten_active_history_state = 'tracking'
            AND ten_active_bootstrap_request_id IS NULL
            AND ten_active_confirmed_by IS NULL
            AND ten_active_history_confirmation IS NULL
            AND ten_active_confirmation_reason IS NULL
        ) OR (
            ten_active_history_state = 'tracking'
            AND ten_active_bootstrap_request_id IS NOT NULL
            AND ten_active_confirmed_by IS NOT NULL
            AND ten_active_history_confirmation = 'not_reached'
            AND ten_active_confirmation_reason IS NOT NULL
        ) OR (
            ten_active_history_state = 'tracking'
            AND ten_active_bootstrap_request_id IS NOT NULL
            AND ten_active_confirmed_by IS NOT NULL
            AND ten_active_history_confirmation = 'reached'
            AND ten_active_confirmation_reason IS NOT NULL
            AND ten_active_trigger_cycle_id IS NOT NULL
            AND ten_active_reached_at IS NOT NULL
            AND ten_active_students_count >= 10
        )
    )
);

-- Incremental bootstrap of historical business milestones only. This does not
-- create cycle terms or session obligations. Only the oldest complete initial
-- cycle can be reconstructed exactly. Historical simultaneous active count is
-- intentionally not inferred from current survivors and requires explicit,
-- audited confirmation through the service-only bootstrap RPC below.
WITH all_ready_initials AS (
    SELECT
        cycle.id,
        cycle.created_at
    FROM public.checkout_v2_cycles AS cycle
    JOIN public.subscriptions AS subscription
      ON subscription.id = cycle.subscription_id
    WHERE cycle.cycle_number = 1
      AND cycle.cycle_kind = 'initial'
      AND cycle.materialization_state = 'ready'
      AND subscription.contract_schema_version = 2
),
first_ready AS (
    SELECT id, created_at
    FROM all_ready_initials
    ORDER BY created_at, id
    LIMIT 1
)
INSERT INTO public.teacher_compensation_milestones (
    policy_version,
    first_ready_initial_cycle_id,
    first_ready_initial_at,
    ten_active_history_state
)
SELECT
    1,
    (SELECT id FROM first_ready),
    (SELECT created_at FROM first_ready),
    CASE WHEN EXISTS (SELECT 1 FROM all_ready_initials)
        THEN 'requires_confirmation'
        ELSE 'tracking'
    END;

CREATE TABLE public.teacher_compensation_cycle_terms (
    cycle_id UUID PRIMARY KEY
        REFERENCES public.checkout_v2_cycles(id) ON DELETE RESTRICT,
    policy_version SMALLINT NOT NULL DEFAULT 1
        REFERENCES public.teacher_compensation_policy_versions(version) ON DELETE RESTRICT
        CHECK (policy_version = 1),
    founder_class_rate_cents INTEGER NOT NULL CHECK (founder_class_rate_cents = 4000),
    external_class_rate_cents INTEGER NOT NULL
        CHECK (external_class_rate_cents IN (2000, 2500)),
    currency TEXT NOT NULL CHECK (currency = 'eur'),
    rate_basis TEXT NOT NULL CHECK (rate_basis IN ('initial', 'ten_active', 'ninety_days')),
    threshold_effective_at TIMESTAMPTZ,
    active_students_observed SMALLINT NOT NULL CHECK (active_students_observed >= 0),
    snapshotted_at TIMESTAMPTZ NOT NULL DEFAULT date_trunc('second', clock_timestamp()),
    CONSTRAINT teacher_compensation_cycle_terms_rate_shape CHECK (
        (
            external_class_rate_cents = 2000
            AND rate_basis = 'initial'
            AND threshold_effective_at IS NULL
        ) OR (
            external_class_rate_cents = 2500
            AND rate_basis IN ('ten_active', 'ninety_days')
            AND threshold_effective_at IS NOT NULL
        )
    )
);

CREATE TABLE public.teacher_compensation_ledger (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    idempotency_key TEXT NOT NULL UNIQUE CHECK (
        idempotency_key ~ '^session:[0-9a-f-]{36}$'
    ),
    session_id UUID NOT NULL UNIQUE REFERENCES public.sessions(id) ON DELETE RESTRICT,
    teacher_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    student_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    subscription_id UUID NOT NULL REFERENCES public.subscriptions(id) ON DELETE RESTRICT,
    cycle_id UUID NOT NULL REFERENCES public.checkout_v2_cycles(id) ON DELETE RESTRICT,
    cycle_terms_id UUID NOT NULL REFERENCES public.teacher_compensation_cycle_terms(cycle_id)
        ON DELETE RESTRICT,
    engagement_id UUID NOT NULL REFERENCES public.teacher_compensation_engagements(id)
        ON DELETE RESTRICT,
    engagement_kind TEXT NOT NULL CHECK (engagement_kind IN ('founder', 'external')),
    event_kind TEXT NOT NULL CHECK (
        event_kind IN ('class_completed', 'student_late_cancellation', 'student_no_show')
    ),
    session_status TEXT NOT NULL CHECK (session_status IN ('completed', 'cancelled', 'no_show')),
    scheduled_at TIMESTAMPTZ NOT NULL,
    source_occurred_at TIMESTAMPTZ NOT NULL,
    completed_at TIMESTAMPTZ,
    no_show_at TIMESTAMPTZ,
    cancelled_at TIMESTAMPTZ,
    cancelled_by UUID REFERENCES public.profiles(id) ON DELETE RESTRICT,
    cancellation_reason TEXT,
    class_rate_cents INTEGER NOT NULL CHECK (class_rate_cents IN (2000, 2500, 4000)),
    amount_cents INTEGER NOT NULL CHECK (amount_cents IN (2000, 2500, 4000)),
    currency TEXT NOT NULL CHECK (currency = 'eur'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT date_trunc('second', clock_timestamp()),
    CONSTRAINT teacher_compensation_ledger_amount_matches_rate CHECK (
        amount_cents = class_rate_cents
    ),
    CONSTRAINT teacher_compensation_ledger_outcome_shape CHECK (
        (
            event_kind = 'class_completed'
            AND session_status = 'completed'
            AND completed_at IS NOT NULL
            AND no_show_at IS NULL
            AND cancelled_at IS NULL
            AND cancelled_by IS NULL
        ) OR (
            event_kind = 'student_no_show'
            AND session_status = 'no_show'
            AND completed_at IS NULL
            AND no_show_at IS NOT NULL
            AND source_occurred_at = no_show_at
            AND cancelled_at IS NULL
            AND cancelled_by IS NULL
        ) OR (
            event_kind = 'student_late_cancellation'
            AND session_status = 'cancelled'
            AND completed_at IS NULL
            AND no_show_at IS NULL
            AND cancelled_at IS NOT NULL
            AND cancelled_by = student_id
            AND scheduled_at < cancelled_at + INTERVAL '24 hours'
            AND cancellation_reason IS DISTINCT FROM 'guarantee_refund'
        )
    )
);

CREATE INDEX teacher_compensation_ledger_teacher_created_idx
    ON public.teacher_compensation_ledger(teacher_id, created_at, id);
CREATE INDEX teacher_compensation_ledger_student_idx
    ON public.teacher_compensation_ledger(student_id, created_at, id);
CREATE INDEX teacher_compensation_ledger_subscription_idx
    ON public.teacher_compensation_ledger(subscription_id, created_at, id);
CREATE INDEX teacher_compensation_ledger_cycle_idx
    ON public.teacher_compensation_ledger(cycle_id, created_at, id);
CREATE INDEX teacher_compensation_ledger_engagement_idx
    ON public.teacher_compensation_ledger(engagement_id);

ALTER TABLE public.teacher_compensation_policy_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teacher_compensation_engagements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teacher_compensation_milestones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teacher_compensation_cycle_terms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teacher_compensation_ledger ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE
    public.teacher_compensation_policy_versions,
    public.teacher_compensation_engagements,
    public.teacher_compensation_milestones,
    public.teacher_compensation_cycle_terms,
    public.teacher_compensation_ledger
FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT ON TABLE
    public.teacher_compensation_policy_versions,
    public.teacher_compensation_engagements,
    public.teacher_compensation_milestones,
    public.teacher_compensation_cycle_terms,
    public.teacher_compensation_ledger
TO service_role;

CREATE OR REPLACE FUNCTION private.guard_teacher_compensation_immutable()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    RAISE EXCEPTION 'teacher_compensation_state_conflicts'
        USING ERRCODE = '40001';
END;
$$;

CREATE TRIGGER guard_teacher_compensation_policy_immutable
    BEFORE UPDATE OR DELETE ON public.teacher_compensation_policy_versions
    FOR EACH ROW EXECUTE FUNCTION private.guard_teacher_compensation_immutable();
CREATE TRIGGER guard_teacher_compensation_engagement_immutable
    BEFORE UPDATE OR DELETE ON public.teacher_compensation_engagements
    FOR EACH ROW EXECUTE FUNCTION private.guard_teacher_compensation_immutable();
CREATE TRIGGER guard_teacher_compensation_cycle_terms_immutable
    BEFORE UPDATE OR DELETE ON public.teacher_compensation_cycle_terms
    FOR EACH ROW EXECUTE FUNCTION private.guard_teacher_compensation_immutable();
CREATE TRIGGER guard_teacher_compensation_ledger_immutable
    BEFORE UPDATE OR DELETE ON public.teacher_compensation_ledger
    FOR EACH ROW EXECUTE FUNCTION private.guard_teacher_compensation_immutable();

CREATE OR REPLACE FUNCTION private.guard_teacher_compensation_milestones()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'teacher_compensation_state_conflicts'
            USING ERRCODE = '40001';
    END IF;

    IF current_setting('app.teacher_compensation_milestone_write', TRUE)
            IS DISTINCT FROM 'on'
       OR NEW.policy_version IS DISTINCT FROM OLD.policy_version
       OR NEW.created_at IS DISTINCT FROM OLD.created_at
       OR (OLD.first_ready_initial_cycle_id IS NOT NULL AND ROW(
            NEW.first_ready_initial_cycle_id,
            NEW.first_ready_initial_at
       ) IS DISTINCT FROM ROW(
            OLD.first_ready_initial_cycle_id,
            OLD.first_ready_initial_at
       ))
       OR (OLD.ten_active_trigger_cycle_id IS NOT NULL AND ROW(
            NEW.ten_active_trigger_cycle_id,
            NEW.ten_active_reached_at,
            NEW.ten_active_students_count,
            NEW.ten_active_history_state,
            NEW.ten_active_bootstrap_request_id,
            NEW.ten_active_confirmed_by,
            NEW.ten_active_history_confirmation,
            NEW.ten_active_confirmation_reason
       ) IS DISTINCT FROM ROW(
            OLD.ten_active_trigger_cycle_id,
            OLD.ten_active_reached_at,
            OLD.ten_active_students_count,
            OLD.ten_active_history_state,
            OLD.ten_active_bootstrap_request_id,
            OLD.ten_active_confirmed_by,
            OLD.ten_active_history_confirmation,
            OLD.ten_active_confirmation_reason
       ))
       OR NEW.updated_at < OLD.updated_at THEN
        RAISE EXCEPTION 'teacher_compensation_state_conflicts'
            USING ERRCODE = '40001';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER guard_teacher_compensation_milestones_immutable
    BEFORE UPDATE OR DELETE ON public.teacher_compensation_milestones
    FOR EACH ROW EXECUTE FUNCTION private.guard_teacher_compensation_milestones();

CREATE OR REPLACE FUNCTION public.confirm_teacher_compensation_ten_active_history(
    p_request_id UUID,
    p_confirmation TEXT,
    p_trigger_cycle_id UUID,
    p_observed_count INTEGER,
    p_admin_id UUID,
    p_reason TEXT
)
RETURNS public.teacher_compensation_milestones
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    milestone_row public.teacher_compensation_milestones%ROWTYPE;
    trigger_cycle_row public.checkout_v2_cycles%ROWTYPE;
    trigger_subscription_row public.subscriptions%ROWTYPE;
    active_student_count INTEGER;
    trimmed_reason TEXT := btrim(p_reason);
    before_snapshot JSONB;
BEGIN
    IF p_request_id IS NULL
       OR p_admin_id IS NULL
       OR p_confirmation IS NULL
       OR p_confirmation NOT IN ('not_reached', 'reached')
       OR p_reason IS NULL
       OR char_length(trimmed_reason) NOT BETWEEN 5 AND 1000
       OR (
            p_confirmation = 'not_reached'
            AND (p_trigger_cycle_id IS NOT NULL OR p_observed_count IS NOT NULL)
       )
       OR (
            p_confirmation = 'reached'
            AND (
                p_trigger_cycle_id IS NULL
                OR p_observed_count IS NULL
                OR p_observed_count NOT BETWEEN 10 AND 32767
            )
       ) THEN
        RAISE EXCEPTION 'invalid_teacher_compensation_history_confirmation'
            USING ERRCODE = '22023';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = p_admin_id AND role = 'admin'::public.user_role
    ) THEN
        RAISE EXCEPTION 'teacher_compensation_reconciliation_forbidden'
            USING ERRCODE = '42501';
    END IF;

    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended('teacher-compensation-policy-v1', 58131)
    );
    SELECT * INTO milestone_row
    FROM public.teacher_compensation_milestones
    WHERE policy_version = 1
    FOR UPDATE;

    IF milestone_row.ten_active_history_state = 'tracking' THEN
        IF milestone_row.ten_active_bootstrap_request_id = p_request_id
           AND milestone_row.ten_active_history_confirmation = p_confirmation
           AND milestone_row.ten_active_confirmed_by = p_admin_id
           AND milestone_row.ten_active_confirmation_reason = trimmed_reason
           AND (
                p_confirmation = 'not_reached'
                OR (
                    milestone_row.ten_active_trigger_cycle_id = p_trigger_cycle_id
                    AND milestone_row.ten_active_students_count = p_observed_count
                )
           ) THEN
            RETURN milestone_row;
        END IF;
        RAISE EXCEPTION 'teacher_compensation_state_conflicts'
            USING ERRCODE = '40001';
    END IF;

    IF milestone_row.ten_active_history_state IS DISTINCT FROM 'requires_confirmation' THEN
        RAISE EXCEPTION 'teacher_compensation_state_conflicts'
            USING ERRCODE = '40001';
    END IF;

    IF p_confirmation = 'not_reached' THEN
        SELECT COUNT(DISTINCT active_subscription.student_id)::INTEGER
        INTO active_student_count
        FROM public.subscriptions AS active_subscription
        JOIN public.checkout_v2_cycles AS initial_cycle
          ON initial_cycle.subscription_id = active_subscription.id
         AND initial_cycle.cycle_number = 1
         AND initial_cycle.cycle_kind = 'initial'
         AND initial_cycle.materialization_state = 'ready'
        WHERE active_subscription.contract_schema_version = 2
          AND active_subscription.status = 'active'::public.subscription_status;

        IF COALESCE(active_student_count, 0) >= 10 THEN
            RAISE EXCEPTION 'invalid_teacher_compensation_history_confirmation'
                USING ERRCODE = '23514';
        END IF;
    END IF;

    IF p_confirmation = 'reached' THEN
        SELECT * INTO trigger_cycle_row
        FROM public.checkout_v2_cycles
        WHERE id = p_trigger_cycle_id
        FOR UPDATE;
        SELECT * INTO trigger_subscription_row
        FROM public.subscriptions
        WHERE id = trigger_cycle_row.subscription_id;

        IF trigger_cycle_row.id IS NULL
           OR trigger_cycle_row.cycle_number IS DISTINCT FROM 1
           OR trigger_cycle_row.cycle_kind IS DISTINCT FROM 'initial'
           OR trigger_cycle_row.materialization_state IS DISTINCT FROM 'ready'
           OR trigger_subscription_row.contract_schema_version IS DISTINCT FROM 2
           OR milestone_row.first_ready_initial_at IS NULL
           OR ROW(trigger_cycle_row.created_at, trigger_cycle_row.id)
                < ROW(
                    milestone_row.first_ready_initial_at,
                    milestone_row.first_ready_initial_cycle_id
                ) THEN
            RAISE EXCEPTION 'invalid_teacher_compensation_history_confirmation'
                USING ERRCODE = '23514';
        END IF;
    END IF;

    before_snapshot := pg_catalog.to_jsonb(milestone_row);
    PERFORM set_config('app.teacher_compensation_milestone_write', 'on', TRUE);
    UPDATE public.teacher_compensation_milestones
    SET ten_active_history_state = 'tracking',
        ten_active_trigger_cycle_id = CASE
            WHEN p_confirmation = 'reached' THEN p_trigger_cycle_id ELSE NULL
        END,
        ten_active_reached_at = CASE
            WHEN p_confirmation = 'reached' THEN trigger_cycle_row.created_at ELSE NULL
        END,
        ten_active_students_count = CASE
            WHEN p_confirmation = 'reached' THEN p_observed_count::SMALLINT ELSE NULL
        END,
        ten_active_bootstrap_request_id = p_request_id,
        ten_active_confirmed_by = p_admin_id,
        ten_active_history_confirmation = p_confirmation,
        ten_active_confirmation_reason = trimmed_reason,
        updated_at = date_trunc('second', clock_timestamp())
    WHERE policy_version = 1
    RETURNING * INTO milestone_row;

    INSERT INTO public.admin_audit_log (
        admin_id,
        action,
        entity_type,
        entity_id,
        before,
        after
    ) VALUES (
        p_admin_id,
        'confirm_teacher_compensation_ten_active_history',
        'teacher_compensation_milestones',
        '1',
        before_snapshot,
        pg_catalog.to_jsonb(milestone_row)
    );

    RETURN milestone_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.configure_teacher_compensation_engagement(
    p_request_id UUID,
    p_teacher_id UUID,
    p_engagement_kind TEXT,
    p_effective_from TIMESTAMPTZ,
    p_configured_by UUID,
    p_reason TEXT
)
RETURNS public.teacher_compensation_engagements
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    existing_row public.teacher_compensation_engagements%ROWTYPE;
    engagement_row public.teacher_compensation_engagements%ROWTYPE;
    latest_effective_from TIMESTAMPTZ;
    trimmed_reason TEXT := btrim(p_reason);
BEGIN
    IF p_request_id IS NULL
       OR p_teacher_id IS NULL
       OR p_configured_by IS NULL
       OR p_engagement_kind NOT IN ('founder', 'external')
       OR p_effective_from IS NULL
       OR NOT pg_catalog.isfinite(p_effective_from)
       OR p_reason IS NULL
       OR char_length(trimmed_reason) NOT BETWEEN 5 AND 1000 THEN
        RAISE EXCEPTION 'invalid_teacher_compensation_engagement'
            USING ERRCODE = '22023';
    END IF;

    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(p_request_id::TEXT, 58132)
    );

    SELECT * INTO existing_row
    FROM public.teacher_compensation_engagements
    WHERE request_id = p_request_id
    FOR UPDATE;

    IF FOUND THEN
        IF ROW(
            existing_row.teacher_id,
            existing_row.engagement_kind,
            existing_row.effective_from,
            existing_row.configured_by,
            existing_row.reason
        ) IS DISTINCT FROM ROW(
            p_teacher_id,
            p_engagement_kind,
            p_effective_from,
            p_configured_by,
            trimmed_reason
        ) THEN
            RAISE EXCEPTION 'teacher_compensation_state_conflicts'
                USING ERRCODE = '40001';
        END IF;
        RETURN existing_row;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = p_configured_by AND role = 'admin'::public.user_role
    ) THEN
        RAISE EXCEPTION 'teacher_compensation_engagement_forbidden'
            USING ERRCODE = '42501';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = p_teacher_id AND role = 'teacher'::public.user_role
    ) THEN
        RAISE EXCEPTION 'teacher_compensation_engagement_requires_teacher'
            USING ERRCODE = '23514';
    END IF;

    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(p_teacher_id::TEXT, 58131)
    );

    SELECT effective_from INTO latest_effective_from
    FROM public.teacher_compensation_engagements
    WHERE teacher_id = p_teacher_id
    ORDER BY effective_from DESC
    LIMIT 1;

    IF latest_effective_from IS NOT NULL
       AND p_effective_from <= latest_effective_from THEN
        RAISE EXCEPTION 'teacher_compensation_state_conflicts'
            USING ERRCODE = '40001';
    END IF;

    IF p_effective_from <= COALESCE((
        SELECT MAX(source_occurred_at)
        FROM public.teacher_compensation_ledger
        WHERE teacher_id = p_teacher_id
    ), '-infinity'::TIMESTAMPTZ) THEN
        RAISE EXCEPTION 'teacher_compensation_state_conflicts'
            USING ERRCODE = '40001';
    END IF;

    INSERT INTO public.teacher_compensation_engagements (
        request_id,
        teacher_id,
        engagement_kind,
        effective_from,
        configured_by,
        reason
    ) VALUES (
        p_request_id,
        p_teacher_id,
        p_engagement_kind,
        p_effective_from,
        p_configured_by,
        trimmed_reason
    ) RETURNING * INTO engagement_row;

    RETURN engagement_row;
END;
$$;

CREATE OR REPLACE FUNCTION private.ensure_teacher_compensation_cycle_terms(
    p_cycle_id UUID
)
RETURNS public.teacher_compensation_cycle_terms
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    cycle_row public.checkout_v2_cycles%ROWTYPE;
    subscription_row public.subscriptions%ROWTYPE;
    payment_row public.payments%ROWTYPE;
    policy_row public.teacher_compensation_policy_versions%ROWTYPE;
    milestone_row public.teacher_compensation_milestones%ROWTYPE;
    trigger_cycle_row public.checkout_v2_cycles%ROWTYPE;
    terms_row public.teacher_compensation_cycle_terms%ROWTYPE;
    session_count INTEGER;
    active_student_count INTEGER;
    raised_by_ten BOOLEAN := FALSE;
    raised_by_days BOOLEAN := FALSE;
    ten_effective_at TIMESTAMPTZ;
    ninety_effective_at TIMESTAMPTZ;
    rate_basis TEXT := 'initial';
    threshold_effective_at TIMESTAMPTZ := NULL;
    external_rate INTEGER;
BEGIN
    IF p_cycle_id IS NULL THEN
        RETURN NULL;
    END IF;

    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended('teacher-compensation-policy-v1', 58131)
    );

    SELECT * INTO cycle_row
    FROM public.checkout_v2_cycles
    WHERE id = p_cycle_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'teacher_compensation_precondition_missing'
            USING ERRCODE = '55000';
    END IF;

    SELECT * INTO subscription_row
    FROM public.subscriptions
    WHERE id = cycle_row.subscription_id;
    SELECT * INTO payment_row
    FROM public.payments
    WHERE id = cycle_row.payment_id;
    SELECT COUNT(*) INTO session_count
    FROM public.sessions
    WHERE checkout_v2_cycle_id = cycle_row.id
      AND checkout_v2_cycle_session_index BETWEEN 1 AND 4
      AND teacher_id IS NOT NULL
      AND student_id = subscription_row.student_id
      AND subscription_id = subscription_row.id;

    IF session_count < 4 THEN
        RETURN NULL;
    END IF;

    IF session_count <> 4
       OR subscription_row.id IS NULL
       OR subscription_row.contract_schema_version IS DISTINCT FROM 2
       OR payment_row.id IS NULL
       OR payment_row.subscription_id IS DISTINCT FROM subscription_row.id
       OR payment_row.checkout_v2_cycle_id IS NOT NULL
            AND payment_row.checkout_v2_cycle_id IS DISTINCT FROM cycle_row.id
       OR payment_row.status IS DISTINCT FROM 'succeeded'::public.payment_status
       OR payment_row.amount IS DISTINCT FROM cycle_row.amount_cents
       OR lower(payment_row.currency) IS DISTINCT FROM cycle_row.currency
       OR cycle_row.amount_cents IS DISTINCT FROM 25900
       OR cycle_row.currency IS DISTINCT FROM 'eur' THEN
        RAISE EXCEPTION 'teacher_compensation_state_conflicts'
            USING ERRCODE = '40001';
    END IF;

    SELECT * INTO policy_row
    FROM public.teacher_compensation_policy_versions
    WHERE version = 1;
    SELECT * INTO milestone_row
    FROM public.teacher_compensation_milestones
    WHERE policy_version = 1
    FOR UPDATE;

    IF policy_row.version IS NULL OR milestone_row.policy_version IS NULL THEN
        RAISE EXCEPTION 'teacher_compensation_precondition_missing'
            USING ERRCODE = '55000';
    END IF;
    IF milestone_row.ten_active_history_state = 'requires_confirmation' THEN
        RAISE EXCEPTION 'teacher_compensation_precondition_missing'
            USING ERRCODE = '55000';
    END IF;

    SELECT * INTO terms_row
    FROM public.teacher_compensation_cycle_terms
    WHERE cycle_id = cycle_row.id
    FOR UPDATE;
    IF FOUND THEN
        IF terms_row.policy_version IS DISTINCT FROM policy_row.version
           OR terms_row.founder_class_rate_cents IS DISTINCT FROM policy_row.founder_class_rate_cents
           OR terms_row.external_class_rate_cents NOT IN (
                policy_row.external_initial_class_rate_cents,
                policy_row.external_raised_class_rate_cents
           )
           OR terms_row.currency IS DISTINCT FROM policy_row.currency THEN
            RAISE EXCEPTION 'teacher_compensation_state_conflicts'
                USING ERRCODE = '40001';
        END IF;
        RETURN terms_row;
    END IF;

    SELECT COUNT(DISTINCT active_subscription.student_id)::INTEGER
    INTO active_student_count
    FROM public.subscriptions AS active_subscription
    JOIN public.checkout_v2_cycles AS initial_cycle
      ON initial_cycle.subscription_id = active_subscription.id
     AND initial_cycle.cycle_number = 1
     AND initial_cycle.cycle_kind = 'initial'
     AND initial_cycle.materialization_state = 'ready'
    WHERE active_subscription.contract_schema_version = 2
      AND active_subscription.status = 'active'::public.subscription_status;

    active_student_count := COALESCE(active_student_count, 0);

    IF milestone_row.ten_active_trigger_cycle_id IS NOT NULL THEN
        SELECT * INTO trigger_cycle_row
        FROM public.checkout_v2_cycles
        WHERE id = milestone_row.ten_active_trigger_cycle_id;
        IF trigger_cycle_row.id IS NULL THEN
            RAISE EXCEPTION 'teacher_compensation_state_conflicts'
                USING ERRCODE = '40001';
        END IF;
        -- A live milestone is serialized after its trigger cycle terms. Any
        -- subsequently snapshotted cycle is therefore economically later even
        -- when application timestamps tie (or UUID ordering points backwards).
        -- Historical confirmations lack that live ordering proof and retain the
        -- deterministic (created_at, id) chronology used during reconciliation.
        IF milestone_row.ten_active_history_confirmation IS NULL
           AND EXISTS (
                SELECT 1 FROM public.teacher_compensation_cycle_terms
                WHERE cycle_id = milestone_row.ten_active_trigger_cycle_id
           ) THEN
            raised_by_ten := TRUE;
        ELSE
            raised_by_ten := ROW(cycle_row.created_at, cycle_row.id)
                > ROW(trigger_cycle_row.created_at, trigger_cycle_row.id);
        END IF;
        ten_effective_at := milestone_row.ten_active_reached_at;
    END IF;

    IF milestone_row.first_ready_initial_at IS NOT NULL THEN
        ninety_effective_at := milestone_row.first_ready_initial_at
            + make_interval(days => policy_row.elapsed_day_threshold);
        raised_by_days := cycle_row.created_at >= ninety_effective_at;
    END IF;

    IF raised_by_ten AND raised_by_days THEN
        IF ten_effective_at <= ninety_effective_at THEN
            rate_basis := 'ten_active';
            threshold_effective_at := ten_effective_at;
        ELSE
            rate_basis := 'ninety_days';
            threshold_effective_at := ninety_effective_at;
        END IF;
    ELSIF raised_by_ten THEN
        rate_basis := 'ten_active';
        threshold_effective_at := ten_effective_at;
    ELSIF raised_by_days THEN
        rate_basis := 'ninety_days';
        threshold_effective_at := ninety_effective_at;
    END IF;

    external_rate := CASE
        WHEN rate_basis = 'initial' THEN policy_row.external_initial_class_rate_cents
        ELSE policy_row.external_raised_class_rate_cents
    END;

    INSERT INTO public.teacher_compensation_cycle_terms (
        cycle_id,
        policy_version,
        founder_class_rate_cents,
        external_class_rate_cents,
        currency,
        rate_basis,
        threshold_effective_at,
        active_students_observed
    ) VALUES (
        cycle_row.id,
        policy_row.version,
        policy_row.founder_class_rate_cents,
        external_rate,
        policy_row.currency,
        rate_basis,
        threshold_effective_at,
        active_student_count
    ) RETURNING * INTO terms_row;

    IF cycle_row.cycle_kind = 'initial'
       AND cycle_row.cycle_number = 1
       AND cycle_row.materialization_state = 'ready' THEN
        PERFORM set_config('app.teacher_compensation_milestone_write', 'on', TRUE);

        IF milestone_row.first_ready_initial_cycle_id IS NULL THEN
            UPDATE public.teacher_compensation_milestones
            SET first_ready_initial_cycle_id = cycle_row.id,
                first_ready_initial_at = cycle_row.created_at,
                updated_at = date_trunc('second', clock_timestamp())
            WHERE policy_version = 1
            RETURNING * INTO milestone_row;
        ELSIF ROW(cycle_row.created_at, cycle_row.id)
                < ROW(milestone_row.first_ready_initial_at,
                    milestone_row.first_ready_initial_cycle_id) THEN
            RAISE EXCEPTION 'teacher_compensation_state_conflicts'
                USING ERRCODE = '40001';
        END IF;

    END IF;

    -- A renewal can be the first serialized observation of ten active students
    -- after reactivation or historical recovery. It keeps the prior rate because
    -- the milestone is persisted only after this cycle's terms are immutable.
    IF milestone_row.ten_active_trigger_cycle_id IS NULL
       AND active_student_count >= policy_row.active_student_threshold THEN
        IF EXISTS (
            SELECT 1
            FROM public.subscriptions AS historical_subscription
            JOIN public.checkout_v2_cycles AS historical_cycle
              ON historical_cycle.subscription_id = historical_subscription.id
             AND historical_cycle.materialization_state = 'ready'
            LEFT JOIN public.teacher_compensation_cycle_terms AS historical_terms
              ON historical_terms.cycle_id = historical_cycle.id
            WHERE historical_subscription.contract_schema_version = 2
              AND historical_terms.cycle_id IS NULL
        ) THEN
            RAISE EXCEPTION 'teacher_compensation_precondition_missing'
                USING ERRCODE = '55000';
        END IF;
        PERFORM set_config('app.teacher_compensation_milestone_write', 'on', TRUE);
        UPDATE public.teacher_compensation_milestones
        SET ten_active_trigger_cycle_id = cycle_row.id,
            ten_active_reached_at = cycle_row.created_at,
            ten_active_students_count = active_student_count::SMALLINT,
            updated_at = date_trunc('second', clock_timestamp())
        WHERE policy_version = 1;
    END IF;

    RETURN terms_row;
END;
$$;

CREATE OR REPLACE FUNCTION private.capture_teacher_compensation_cycle_terms()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF NEW.checkout_v2_cycle_id IS NOT NULL THEN
        PERFORM private.ensure_teacher_compensation_cycle_terms(
            NEW.checkout_v2_cycle_id
        );
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER capture_teacher_compensation_cycle_terms_on_session_insert
    AFTER INSERT ON public.sessions
    FOR EACH ROW EXECUTE FUNCTION private.capture_teacher_compensation_cycle_terms();
CREATE TRIGGER capture_teacher_compensation_cycle_terms_on_session_binding
    AFTER UPDATE OF checkout_v2_cycle_id, checkout_v2_cycle_session_index
    ON public.sessions
    FOR EACH ROW EXECUTE FUNCTION private.capture_teacher_compensation_cycle_terms();

CREATE OR REPLACE FUNCTION private.accrue_teacher_compensation_for_session(
    p_session_id UUID
)
RETURNS public.teacher_compensation_ledger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    session_row public.sessions%ROWTYPE;
    subscription_row public.subscriptions%ROWTYPE;
    cycle_row public.checkout_v2_cycles%ROWTYPE;
    payment_row public.payments%ROWTYPE;
    terms_row public.teacher_compensation_cycle_terms%ROWTYPE;
    engagement_row public.teacher_compensation_engagements%ROWTYPE;
    existing_entry public.teacher_compensation_ledger%ROWTYPE;
    ledger_row public.teacher_compensation_ledger%ROWTYPE;
    event_kind TEXT;
    source_occurred_at TIMESTAMPTZ;
    class_rate INTEGER;
BEGIN
    SELECT * INTO session_row
    FROM public.sessions
    WHERE id = p_session_id
    FOR UPDATE;
    IF NOT FOUND OR session_row.checkout_v2_cycle_id IS NULL THEN
        RETURN NULL;
    END IF;

    IF session_row.status = 'completed' THEN
        IF session_row.completed_at IS NULL
           OR session_row.scheduled_at IS NULL
           OR session_row.completed_at
                < session_row.scheduled_at
                    + make_interval(mins => session_row.duration_minutes)
           OR session_row.completed_at > clock_timestamp() THEN
            RAISE EXCEPTION 'teacher_compensation_state_conflicts'
                USING ERRCODE = '40001';
        END IF;
        event_kind := 'class_completed';
        source_occurred_at := session_row.completed_at;
    ELSIF session_row.status = 'no_show' THEN
        IF session_row.scheduled_at IS NULL
           OR session_row.no_show_at IS NULL
           OR session_row.no_show_at
                < session_row.scheduled_at + INTERVAL '15 minutes'
           OR session_row.no_show_at > clock_timestamp() THEN
            RAISE EXCEPTION 'teacher_compensation_state_conflicts'
                USING ERRCODE = '40001';
        END IF;
        event_kind := 'student_no_show';
        source_occurred_at := session_row.no_show_at;
    ELSIF session_row.status = 'cancelled'
       AND session_row.cancelled_at IS NOT NULL
       AND session_row.cancelled_by = session_row.student_id
       AND session_row.scheduled_at < session_row.cancelled_at + INTERVAL '24 hours'
       AND session_row.cancellation_reason IS DISTINCT FROM 'guarantee_refund' THEN
        IF session_row.cancelled_at > clock_timestamp() THEN
            RAISE EXCEPTION 'teacher_compensation_state_conflicts'
                USING ERRCODE = '40001';
        END IF;
        event_kind := 'student_late_cancellation';
        source_occurred_at := session_row.cancelled_at;
    ELSE
        RETURN NULL;
    END IF;

    SELECT * INTO subscription_row
    FROM public.subscriptions
    WHERE id = session_row.subscription_id;
    SELECT * INTO cycle_row
    FROM public.checkout_v2_cycles
    WHERE id = session_row.checkout_v2_cycle_id;
    SELECT * INTO payment_row
    FROM public.payments
    WHERE id = cycle_row.payment_id;
    SELECT * INTO terms_row
    FROM public.teacher_compensation_cycle_terms
    WHERE cycle_id = cycle_row.id;

    IF session_row.teacher_id IS NULL
       OR session_row.student_id IS NULL
       OR session_row.scheduled_at IS NULL
       OR session_row.duration_minutes IS DISTINCT FROM 50
       OR subscription_row.id IS NULL
       OR subscription_row.contract_schema_version IS DISTINCT FROM 2
       OR cycle_row.id IS NULL
       OR cycle_row.materialization_state IS DISTINCT FROM 'ready'
       OR payment_row.id IS NULL
       OR payment_row.checkout_v2_cycle_id IS DISTINCT FROM cycle_row.id
       OR payment_row.status IS DISTINCT FROM 'succeeded'::public.payment_status
       OR payment_row.amount IS DISTINCT FROM cycle_row.amount_cents
       OR lower(payment_row.currency) IS DISTINCT FROM cycle_row.currency
       OR terms_row.cycle_id IS NULL THEN
        RAISE EXCEPTION 'teacher_compensation_precondition_missing'
            USING ERRCODE = '55000';
    END IF;

    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(session_row.teacher_id::TEXT, 58131)
    );

    SELECT * INTO existing_entry
    FROM public.teacher_compensation_ledger
    WHERE session_id = session_row.id
    FOR UPDATE;
    IF FOUND THEN
        SELECT * INTO engagement_row
        FROM public.teacher_compensation_engagements
        WHERE id = existing_entry.engagement_id;
        IF engagement_row.id IS NULL
           OR engagement_row.teacher_id IS DISTINCT FROM existing_entry.teacher_id
           OR engagement_row.engagement_kind IS DISTINCT FROM existing_entry.engagement_kind
           OR engagement_row.effective_from > existing_entry.source_occurred_at THEN
            RAISE EXCEPTION 'teacher_compensation_state_conflicts'
                USING ERRCODE = '40001';
        END IF;
        class_rate := CASE engagement_row.engagement_kind
            WHEN 'founder' THEN terms_row.founder_class_rate_cents
            WHEN 'external' THEN terms_row.external_class_rate_cents
        END;

        IF ROW(
            existing_entry.idempotency_key,
            existing_entry.teacher_id,
            existing_entry.student_id,
            existing_entry.subscription_id,
            existing_entry.cycle_id,
            existing_entry.cycle_terms_id,
            existing_entry.engagement_id,
            existing_entry.engagement_kind,
            existing_entry.event_kind,
            existing_entry.session_status,
            existing_entry.scheduled_at,
            existing_entry.source_occurred_at,
            existing_entry.completed_at,
            existing_entry.no_show_at,
            existing_entry.cancelled_at,
            existing_entry.cancelled_by,
            existing_entry.cancellation_reason,
            existing_entry.class_rate_cents,
            existing_entry.amount_cents,
            existing_entry.currency
        ) IS DISTINCT FROM ROW(
            'session:' || session_row.id::TEXT,
            session_row.teacher_id,
            session_row.student_id,
            session_row.subscription_id,
            cycle_row.id,
            terms_row.cycle_id,
            engagement_row.id,
            engagement_row.engagement_kind,
            event_kind,
            session_row.status,
            session_row.scheduled_at,
            source_occurred_at,
            session_row.completed_at,
            session_row.no_show_at,
            session_row.cancelled_at,
            session_row.cancelled_by,
            session_row.cancellation_reason,
            class_rate,
            class_rate,
            terms_row.currency
        ) THEN
            RAISE EXCEPTION 'teacher_compensation_state_conflicts'
                USING ERRCODE = '40001';
        END IF;
        RETURN existing_entry;
    END IF;

    SELECT * INTO engagement_row
    FROM public.teacher_compensation_engagements
    WHERE teacher_id = session_row.teacher_id
      AND effective_from <= source_occurred_at
    ORDER BY effective_from DESC
    LIMIT 1;
    IF engagement_row.id IS NULL THEN
        RAISE EXCEPTION 'teacher_compensation_precondition_missing'
            USING ERRCODE = '55000';
    END IF;

    class_rate := CASE engagement_row.engagement_kind
        WHEN 'founder' THEN terms_row.founder_class_rate_cents
        WHEN 'external' THEN terms_row.external_class_rate_cents
    END;

    INSERT INTO public.teacher_compensation_ledger (
        idempotency_key,
        session_id,
        teacher_id,
        student_id,
        subscription_id,
        cycle_id,
        cycle_terms_id,
        engagement_id,
        engagement_kind,
        event_kind,
        session_status,
        scheduled_at,
        source_occurred_at,
        completed_at,
        no_show_at,
        cancelled_at,
        cancelled_by,
        cancellation_reason,
        class_rate_cents,
        amount_cents,
        currency
    ) VALUES (
        'session:' || session_row.id::TEXT,
        session_row.id,
        session_row.teacher_id,
        session_row.student_id,
        session_row.subscription_id,
        cycle_row.id,
        terms_row.cycle_id,
        engagement_row.id,
        engagement_row.engagement_kind,
        event_kind,
        session_row.status,
        session_row.scheduled_at,
        source_occurred_at,
        session_row.completed_at,
        session_row.no_show_at,
        session_row.cancelled_at,
        session_row.cancelled_by,
        session_row.cancellation_reason,
        class_rate,
        class_rate,
        terms_row.currency
    ) RETURNING * INTO ledger_row;

    RETURN ledger_row;
END;
$$;

CREATE OR REPLACE FUNCTION private.capture_teacher_compensation_session_outcome()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    PERFORM private.accrue_teacher_compensation_for_session(NEW.id);
    RETURN NEW;
END;
$$;

CREATE TRIGGER capture_teacher_compensation_session_outcome
    AFTER UPDATE OF status, completed_at, no_show_at, cancelled_at, cancelled_by,
        cancellation_reason
    ON public.sessions
    FOR EACH ROW EXECUTE FUNCTION private.capture_teacher_compensation_session_outcome();

CREATE OR REPLACE FUNCTION private.guard_teacher_compensation_session_source()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM public.teacher_compensation_ledger
        WHERE session_id = OLD.id
    ) AND ROW(
        NEW.id,
        NEW.subscription_id,
        NEW.student_id,
        NEW.teacher_id,
        NEW.scheduled_at,
        NEW.duration_minutes,
        NEW.status,
        NEW.completed_at,
        NEW.no_show_at,
        NEW.cancelled_at,
        NEW.cancelled_by,
        NEW.cancellation_reason,
        NEW.checkout_v2_cycle_id,
        NEW.checkout_v2_cycle_session_index
    ) IS DISTINCT FROM ROW(
        OLD.id,
        OLD.subscription_id,
        OLD.student_id,
        OLD.teacher_id,
        OLD.scheduled_at,
        OLD.duration_minutes,
        OLD.status,
        OLD.completed_at,
        OLD.no_show_at,
        OLD.cancelled_at,
        OLD.cancelled_by,
        OLD.cancellation_reason,
        OLD.checkout_v2_cycle_id,
        OLD.checkout_v2_cycle_session_index
    ) THEN
        RAISE EXCEPTION 'teacher_compensation_state_conflicts'
            USING ERRCODE = '40001';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER guard_teacher_compensation_session_source
    BEFORE UPDATE ON public.sessions
    FOR EACH ROW EXECUTE FUNCTION private.guard_teacher_compensation_session_source();

CREATE OR REPLACE FUNCTION private.guard_teacher_compensation_slot()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF NEW.status IN ('available', 'sold')
       AND NOT EXISTS (
            SELECT 1
            FROM public.teacher_compensation_engagements AS engagement
            WHERE engagement.teacher_id = NEW.teacher_id
              AND engagement.effective_from <= clock_timestamp()
       ) THEN
        RAISE EXCEPTION 'teacher_compensation_engagement_required'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER guard_teacher_compensation_slot
    BEFORE INSERT OR UPDATE ON public.bookable_slots
    FOR EACH ROW EXECUTE FUNCTION private.guard_teacher_compensation_slot();

CREATE OR REPLACE FUNCTION private.guard_teacher_compensation_hold()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    slot_row public.bookable_slots%ROWTYPE;
BEGIN
    IF TG_OP = 'INSERT' AND NEW.status = 'held' THEN
        SELECT * INTO slot_row
        FROM public.bookable_slots
        WHERE id = NEW.slot_id;
        IF slot_row.id IS NULL
           OR NOT EXISTS (
                SELECT 1
                FROM public.teacher_compensation_engagements AS engagement
                WHERE engagement.teacher_id = slot_row.teacher_id
                  AND engagement.effective_from <= NEW.held_at
           ) THEN
            RAISE EXCEPTION 'teacher_compensation_engagement_required'
                USING ERRCODE = '23514';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER guard_teacher_compensation_hold
    BEFORE INSERT ON public.bookable_slot_holds
    FOR EACH ROW EXECUTE FUNCTION private.guard_teacher_compensation_hold();

CREATE OR REPLACE FUNCTION public.reconcile_teacher_compensation_session(
    p_session_id UUID,
    p_admin_id UUID
)
RETURNS public.teacher_compensation_ledger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    session_row public.sessions%ROWTYPE;
    ledger_row public.teacher_compensation_ledger%ROWTYPE;
    existed_before BOOLEAN;
BEGIN
    IF p_session_id IS NULL OR p_admin_id IS NULL THEN
        RAISE EXCEPTION 'invalid_teacher_compensation_reconciliation'
            USING ERRCODE = '22023';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = p_admin_id AND role = 'admin'::public.user_role
    ) THEN
        RAISE EXCEPTION 'teacher_compensation_reconciliation_forbidden'
            USING ERRCODE = '42501';
    END IF;

    SELECT * INTO session_row
    FROM public.sessions
    WHERE id = p_session_id
    FOR UPDATE;
    IF NOT FOUND OR session_row.checkout_v2_cycle_id IS NULL THEN
        RAISE EXCEPTION 'teacher_compensation_precondition_missing'
            USING ERRCODE = '55000';
    END IF;

    existed_before := EXISTS (
        SELECT 1 FROM public.teacher_compensation_ledger
        WHERE session_id = p_session_id
    );

    PERFORM private.ensure_teacher_compensation_cycle_terms(
        session_row.checkout_v2_cycle_id
    );
    ledger_row := private.accrue_teacher_compensation_for_session(p_session_id);

    IF ledger_row.id IS NULL THEN
        RAISE EXCEPTION 'teacher_compensation_reconciliation_not_liquidatable'
            USING ERRCODE = '23514';
    END IF;

    IF NOT existed_before THEN
        INSERT INTO public.admin_audit_log (
            admin_id,
            action,
            entity_type,
            entity_id,
            after
        ) VALUES (
            p_admin_id,
            'reconcile_teacher_compensation_session',
            'teacher_compensation_ledger',
            ledger_row.id::TEXT,
            pg_catalog.to_jsonb(ledger_row)
        );
    END IF;

    RETURN ledger_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.reconcile_teacher_compensation_cycle(
    p_cycle_id UUID,
    p_admin_id UUID
)
RETURNS public.teacher_compensation_cycle_terms
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    terms_row public.teacher_compensation_cycle_terms%ROWTYPE;
    existed_before BOOLEAN;
BEGIN
    IF p_cycle_id IS NULL OR p_admin_id IS NULL THEN
        RAISE EXCEPTION 'invalid_teacher_compensation_reconciliation'
            USING ERRCODE = '22023';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = p_admin_id AND role = 'admin'::public.user_role
    ) THEN
        RAISE EXCEPTION 'teacher_compensation_reconciliation_forbidden'
            USING ERRCODE = '42501';
    END IF;

    existed_before := EXISTS (
        SELECT 1 FROM public.teacher_compensation_cycle_terms
        WHERE cycle_id = p_cycle_id
    );

    terms_row := private.ensure_teacher_compensation_cycle_terms(p_cycle_id);
    IF terms_row.cycle_id IS NULL THEN
        RAISE EXCEPTION 'teacher_compensation_precondition_missing'
            USING ERRCODE = '55000';
    END IF;

    IF NOT existed_before THEN
        INSERT INTO public.admin_audit_log (
            admin_id,
            action,
            entity_type,
            entity_id,
            after
        ) VALUES (
            p_admin_id,
            'reconcile_teacher_compensation_cycle',
            'teacher_compensation_cycle_terms',
            terms_row.cycle_id::TEXT,
            pg_catalog.to_jsonb(terms_row)
        );
    END IF;

    RETURN terms_row;
END;
$$;

REVOKE ALL ON FUNCTION public.configure_teacher_compensation_engagement(
    UUID, UUID, TEXT, TIMESTAMPTZ, UUID, TEXT
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.configure_teacher_compensation_engagement(
    UUID, UUID, TEXT, TIMESTAMPTZ, UUID, TEXT
) TO service_role;

REVOKE ALL ON FUNCTION public.confirm_teacher_compensation_ten_active_history(
    UUID, TEXT, UUID, INTEGER, UUID, TEXT
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_teacher_compensation_ten_active_history(
    UUID, TEXT, UUID, INTEGER, UUID, TEXT
) TO service_role;

REVOKE ALL ON FUNCTION public.reconcile_teacher_compensation_session(UUID, UUID)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_teacher_compensation_session(UUID, UUID)
    TO service_role;

REVOKE ALL ON FUNCTION public.reconcile_teacher_compensation_cycle(UUID, UUID)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_teacher_compensation_cycle(UUID, UUID)
    TO service_role;

REVOKE ALL ON FUNCTION private.guard_teacher_compensation_immutable()
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.guard_teacher_compensation_milestones()
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.ensure_teacher_compensation_cycle_terms(UUID)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.capture_teacher_compensation_cycle_terms()
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.accrue_teacher_compensation_for_session(UUID)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.capture_teacher_compensation_session_outcome()
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.guard_teacher_compensation_session_source()
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.guard_teacher_compensation_slot()
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.guard_teacher_compensation_hold()
    FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON TABLE public.teacher_compensation_engagements IS
    'Append-only effective founder/external classification events for teachers.';
COMMENT ON TABLE public.teacher_compensation_cycle_terms IS
    'Immutable monetary terms selected once per complete Checkout V2 cycle.';
COMMENT ON TABLE public.teacher_compensation_ledger IS
    'Append-only teacher obligations for liquidatable Checkout V2 session outcomes.';
