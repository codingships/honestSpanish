-- Immutable monthly settlement snapshots for teacher compensation obligations.
-- Settlements record what is payable and whether an operator documented the
-- corresponding manual payment. They do not initiate transfers or determine
-- tax/invoice treatment.

CREATE TABLE public.teacher_compensation_settlements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id UUID NOT NULL UNIQUE,
    teacher_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    period_month DATE NOT NULL,
    period_start_at TIMESTAMPTZ NOT NULL,
    period_end_at TIMESTAMPTZ NOT NULL,
    timezone TEXT NOT NULL DEFAULT 'Europe/Madrid'
        CHECK (timezone = 'Europe/Madrid'),
    currency TEXT NOT NULL CHECK (currency = 'eur'),
    class_amount_cents INTEGER NOT NULL CHECK (class_amount_cents >= 0),
    mandatory_work_amount_cents INTEGER NOT NULL
        CHECK (mandatory_work_amount_cents >= 0),
    adjustment_amount_cents INTEGER NOT NULL,
    total_amount_cents INTEGER NOT NULL CHECK (total_amount_cents >= 0),
    line_count INTEGER NOT NULL CHECK (line_count > 0),
    closed_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    close_note TEXT NOT NULL CHECK (char_length(btrim(close_note)) BETWEEN 5 AND 1000),
    closed_at TIMESTAMPTZ NOT NULL DEFAULT date_trunc('second', clock_timestamp()),
    CONSTRAINT teacher_compensation_settlement_month_shape CHECK (
        period_month = date_trunc('month', period_month::TIMESTAMP)::DATE
        AND period_start_at
            = period_month::TIMESTAMP AT TIME ZONE 'Europe/Madrid'
        AND period_end_at
            = (period_month + INTERVAL '1 month')::TIMESTAMP
                AT TIME ZONE 'Europe/Madrid'
        AND period_end_at > period_start_at
    ),
    CONSTRAINT teacher_compensation_settlement_total_shape CHECK (
        total_amount_cents
            = class_amount_cents
            + mandatory_work_amount_cents
            + adjustment_amount_cents
    ),
    CONSTRAINT teacher_compensation_settlement_closed_after_period CHECK (
        closed_at >= period_end_at
    ),
    CONSTRAINT teacher_compensation_settlement_id_teacher_key UNIQUE (
        id, teacher_id
    ),
    UNIQUE (teacher_id, period_month)
);

CREATE TABLE public.teacher_compensation_settlement_lines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    settlement_id UUID NOT NULL,
    teacher_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    source_kind TEXT NOT NULL CHECK (
        source_kind IN ('class', 'mandatory_work', 'work_adjustment')
    ),
    source_id UUID NOT NULL,
    student_id UUID REFERENCES public.profiles(id) ON DELETE RESTRICT,
    source_occurred_at TIMESTAMPTZ NOT NULL
        CHECK (pg_catalog.isfinite(source_occurred_at)),
    quantity_minutes SMALLINT,
    description TEXT NOT NULL
        CHECK (char_length(btrim(description)) BETWEEN 1 AND 1000),
    amount_cents INTEGER NOT NULL,
    currency TEXT NOT NULL CHECK (currency = 'eur'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT date_trunc('second', clock_timestamp()),
    CONSTRAINT teacher_compensation_settlement_line_identity_fkey
        FOREIGN KEY (settlement_id, teacher_id)
        REFERENCES public.teacher_compensation_settlements(id, teacher_id)
        ON DELETE RESTRICT,
    CONSTRAINT teacher_compensation_settlement_line_shape CHECK (
        (
            source_kind = 'class'
            AND student_id IS NOT NULL
            AND quantity_minutes IS NULL
            AND amount_cents IN (2000, 2500, 4000)
        ) OR (
            source_kind = 'mandatory_work'
            AND student_id IS NULL
            AND quantity_minutes BETWEEN 1 AND 720
            AND amount_cents = quantity_minutes * 25
        ) OR (
            source_kind = 'work_adjustment'
            AND student_id IS NULL
            AND quantity_minutes BETWEEN -720 AND 720
            AND quantity_minutes <> 0
            AND amount_cents = quantity_minutes * 25
        )
    ),
    UNIQUE (source_kind, source_id)
);

CREATE INDEX teacher_compensation_settlement_lines_settlement_idx
    ON public.teacher_compensation_settlement_lines(
        settlement_id, source_occurred_at, source_kind, source_id
    );
CREATE INDEX teacher_compensation_settlements_teacher_period_idx
    ON public.teacher_compensation_settlements(teacher_id, period_month DESC);

CREATE TABLE public.teacher_compensation_settlement_payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id UUID NOT NULL UNIQUE,
    settlement_id UUID NOT NULL,
    teacher_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
    currency TEXT NOT NULL CHECK (currency = 'eur'),
    paid_at TIMESTAMPTZ NOT NULL CHECK (pg_catalog.isfinite(paid_at)),
    payment_reference TEXT NOT NULL
        CHECK (char_length(btrim(payment_reference)) BETWEEN 3 AND 200),
    invoice_reference TEXT CHECK (
        invoice_reference IS NULL
        OR char_length(btrim(invoice_reference)) BETWEEN 1 AND 200
    ),
    note TEXT NOT NULL CHECK (char_length(btrim(note)) BETWEEN 5 AND 1000),
    recorded_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT date_trunc('second', clock_timestamp()),
    CONSTRAINT teacher_compensation_settlement_payment_identity_fkey
        FOREIGN KEY (settlement_id, teacher_id)
        REFERENCES public.teacher_compensation_settlements(id, teacher_id)
        ON DELETE RESTRICT,
    CONSTRAINT teacher_compensation_settlement_payment_event_key UNIQUE (
        id, settlement_id, teacher_id
    )
);

CREATE INDEX teacher_compensation_settlement_payments_settlement_created_idx
    ON public.teacher_compensation_settlement_payments(
        settlement_id, created_at DESC, id DESC
    );

CREATE TABLE public.teacher_compensation_settlement_payment_voids (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id UUID NOT NULL UNIQUE,
    payment_id UUID NOT NULL UNIQUE,
    settlement_id UUID NOT NULL,
    teacher_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    reason TEXT NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 5 AND 1000),
    voided_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT date_trunc('second', clock_timestamp()),
    CONSTRAINT teacher_compensation_settlement_payment_void_identity_fkey
        FOREIGN KEY (payment_id, settlement_id, teacher_id)
        REFERENCES public.teacher_compensation_settlement_payments(
            id, settlement_id, teacher_id
        ) ON DELETE RESTRICT
);

ALTER TABLE public.teacher_compensation_settlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teacher_compensation_settlement_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teacher_compensation_settlement_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teacher_compensation_settlement_payment_voids ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE
    public.teacher_compensation_settlements,
    public.teacher_compensation_settlement_lines,
    public.teacher_compensation_settlement_payments,
    public.teacher_compensation_settlement_payment_voids
FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT ON TABLE
    public.teacher_compensation_settlements,
    public.teacher_compensation_settlement_lines,
    public.teacher_compensation_settlement_payments,
    public.teacher_compensation_settlement_payment_voids
TO service_role;

CREATE TRIGGER guard_teacher_compensation_settlements_immutable
    BEFORE UPDATE OR DELETE ON public.teacher_compensation_settlements
    FOR EACH ROW EXECUTE FUNCTION private.guard_teacher_compensation_immutable();
CREATE TRIGGER guard_teacher_compensation_settlement_lines_immutable
    BEFORE UPDATE OR DELETE ON public.teacher_compensation_settlement_lines
    FOR EACH ROW EXECUTE FUNCTION private.guard_teacher_compensation_immutable();
CREATE TRIGGER guard_teacher_compensation_settlement_payments_immutable
    BEFORE UPDATE OR DELETE ON public.teacher_compensation_settlement_payments
    FOR EACH ROW EXECUTE FUNCTION private.guard_teacher_compensation_immutable();
CREATE TRIGGER guard_teacher_compensation_settlement_payment_voids_immutable
    BEFORE UPDATE OR DELETE ON public.teacher_compensation_settlement_payment_voids
    FOR EACH ROW EXECUTE FUNCTION private.guard_teacher_compensation_immutable();

-- Reconciliation and mandatory-work recording already take this same teacher
-- advisory lock. Rejecting a source whose business timestamp belongs to a
-- closed month prevents a late backfill from silently escaping that snapshot.
CREATE OR REPLACE FUNCTION private.guard_teacher_compensation_closed_period()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    source_at TIMESTAMPTZ;
BEGIN
    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(NEW.teacher_id::TEXT, 58131)
    );

    IF TG_TABLE_NAME = 'teacher_compensation_ledger' THEN
        source_at := NEW.source_occurred_at;
    ELSIF TG_TABLE_NAME = 'teacher_compensation_work_ledger' THEN
        source_at := NEW.started_at;
    ELSE
        RAISE EXCEPTION 'teacher_compensation_closed_period_guard_misconfigured';
    END IF;

    IF source_at IS NOT NULL AND EXISTS (
        SELECT 1
        FROM public.teacher_compensation_settlements AS settlement
        WHERE settlement.teacher_id = NEW.teacher_id
          AND source_at >= settlement.period_start_at
          AND source_at < settlement.period_end_at
    ) THEN
        RAISE EXCEPTION 'teacher_compensation_settlement_period_closed'
            USING ERRCODE = '40001';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER guard_teacher_compensation_class_closed_period
    BEFORE INSERT ON public.teacher_compensation_ledger
    FOR EACH ROW EXECUTE FUNCTION private.guard_teacher_compensation_closed_period();
CREATE TRIGGER guard_teacher_compensation_work_closed_period
    BEFORE INSERT ON public.teacher_compensation_work_ledger
    FOR EACH ROW EXECUTE FUNCTION private.guard_teacher_compensation_closed_period();

-- Adjustment created_at remains the audit timestamp, but its accounting period
-- is the Europe/Madrid month of the immutable work started_at. Once that month
-- is settled, further adjustment is rejected. The shared teacher lock prevents
-- a close from racing an adjustment into or out of its snapshot.
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
    work_teacher_id UUID;
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

    SELECT teacher_id INTO work_teacher_id
    FROM public.teacher_compensation_work_ledger
    WHERE id = p_work_entry_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'teacher_compensation_precondition_missing'
            USING ERRCODE = '55000';
    END IF;

    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(work_teacher_id::TEXT, 58131)
    );

    SELECT * INTO work_row
    FROM public.teacher_compensation_work_ledger
    WHERE id = p_work_entry_id
    FOR UPDATE;
    IF NOT FOUND OR work_row.teacher_id IS DISTINCT FROM work_teacher_id THEN
        RAISE EXCEPTION 'teacher_compensation_precondition_missing'
            USING ERRCODE = '55000';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.teacher_compensation_settlements AS settlement
        WHERE settlement.teacher_id = work_row.teacher_id
          AND work_row.started_at >= settlement.period_start_at
          AND work_row.started_at < settlement.period_end_at
    ) THEN
        RAISE EXCEPTION 'teacher_compensation_settlement_period_closed'
            USING ERRCODE = '40001';
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
        request_id, work_entry_id, teacher_id, minutes_delta, policy_version,
        rate_cents_per_minute, amount_delta_cents, currency, reason, recorded_by
    ) VALUES (
        p_request_id, work_row.id, work_row.teacher_id, p_minutes_delta,
        policy_row.version, policy_row.mandatory_work_rate_cents_per_minute,
        p_minutes_delta * policy_row.mandatory_work_rate_cents_per_minute,
        policy_row.currency, trimmed_reason, p_recorded_by
    ) RETURNING * INTO adjustment_row;

    INSERT INTO public.admin_audit_log (
        admin_id, action, entity_type, entity_id, after
    ) VALUES (
        p_recorded_by, 'adjust_teacher_compensation_work',
        'teacher_compensation_work_adjustments', adjustment_row.id::TEXT,
        pg_catalog.to_jsonb(adjustment_row)
    );

    RETURN adjustment_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.close_teacher_compensation_settlement(
    p_request_id UUID,
    p_teacher_id UUID,
    p_period_month DATE,
    p_admin_id UUID,
    p_close_note TEXT
)
RETURNS public.teacher_compensation_settlements
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    existing_row public.teacher_compensation_settlements%ROWTYPE;
    settlement_row public.teacher_compensation_settlements%ROWTYPE;
    period_start TIMESTAMPTZ;
    period_end TIMESTAMPTZ;
    trimmed_note TEXT := btrim(p_close_note);
    class_total INTEGER;
    work_total INTEGER;
    adjustment_total INTEGER;
    class_lines INTEGER;
    work_lines INTEGER;
    adjustment_lines INTEGER;
    expected_lines INTEGER;
    inserted_lines INTEGER;
    inserted_total BIGINT;
BEGIN
    IF p_request_id IS NULL
       OR p_teacher_id IS NULL
       OR p_period_month IS NULL
       OR p_admin_id IS NULL
       OR p_close_note IS NULL
       OR char_length(trimmed_note) NOT BETWEEN 5 AND 1000
       OR p_period_month
            IS DISTINCT FROM date_trunc('month', p_period_month::TIMESTAMP)::DATE
    THEN
        RAISE EXCEPTION 'invalid_teacher_compensation_settlement'
            USING ERRCODE = '22023';
    END IF;

    period_start := p_period_month::TIMESTAMP AT TIME ZONE 'Europe/Madrid';
    period_end := (p_period_month + INTERVAL '1 month')::TIMESTAMP
        AT TIME ZONE 'Europe/Madrid';
    IF period_end > clock_timestamp() THEN
        RAISE EXCEPTION 'teacher_compensation_settlement_period_open'
            USING ERRCODE = '22023';
    END IF;

    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(p_request_id::TEXT, 58151)
    );
    SELECT * INTO existing_row
    FROM public.teacher_compensation_settlements
    WHERE request_id = p_request_id
    FOR UPDATE;
    IF FOUND THEN
        IF ROW(
            existing_row.teacher_id,
            existing_row.period_month,
            existing_row.closed_by,
            existing_row.close_note
        ) IS DISTINCT FROM ROW(
            p_teacher_id,
            p_period_month,
            p_admin_id,
            trimmed_note
        ) THEN
            RAISE EXCEPTION 'teacher_compensation_settlement_request_conflicts'
                USING ERRCODE = '40001';
        END IF;
        RETURN existing_row;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = p_admin_id AND role = 'admin'::public.user_role
    ) THEN
        RAISE EXCEPTION 'teacher_compensation_settlement_forbidden'
            USING ERRCODE = '42501';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = p_teacher_id AND role = 'teacher'::public.user_role
    ) THEN
        RAISE EXCEPTION 'teacher_compensation_settlement_requires_teacher'
            USING ERRCODE = '23514';
    END IF;

    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(p_teacher_id::TEXT, 58131)
    );

    IF EXISTS (
        SELECT 1 FROM public.teacher_compensation_settlements
        WHERE teacher_id = p_teacher_id AND period_month = p_period_month
    ) THEN
        RAISE EXCEPTION 'teacher_compensation_settlement_period_conflicts'
            USING ERRCODE = '40001';
    END IF;

    -- Do not close around an outcome that should already have an obligation.
    IF EXISTS (
        SELECT 1
        FROM public.sessions AS session
        JOIN public.subscriptions AS subscription
          ON subscription.id = session.subscription_id
        WHERE session.teacher_id = p_teacher_id
          AND subscription.contract_schema_version = 2
          AND session.checkout_v2_cycle_id IS NOT NULL
          AND NOT EXISTS (
              SELECT 1 FROM public.teacher_compensation_ledger AS ledger
              WHERE ledger.session_id = session.id
          )
          AND COALESCE(session.completed_at, session.no_show_at, session.cancelled_at)
                >= period_start
          AND COALESCE(session.completed_at, session.no_show_at, session.cancelled_at)
                < period_end
          AND (
              session.status IN ('completed', 'no_show')
              OR (
                  session.status = 'cancelled'
                  AND session.cancelled_by = session.student_id
                  AND session.scheduled_at
                        < session.cancelled_at + INTERVAL '24 hours'
                  AND session.cancellation_reason
                        IS DISTINCT FROM 'guarantee_refund'
              )
          )
    ) THEN
        RAISE EXCEPTION 'teacher_compensation_settlement_reconciliation_required'
            USING ERRCODE = '55000';
    END IF;

    -- Periods are closed chronologically. No older unassigned obligation may
    -- disappear merely because an operator selected a later month first.
    IF EXISTS (
        SELECT 1 FROM public.teacher_compensation_ledger AS source
        WHERE source.teacher_id = p_teacher_id
          AND source.source_occurred_at < period_start
          AND NOT EXISTS (
              SELECT 1 FROM public.teacher_compensation_settlement_lines AS line
              WHERE line.source_kind = 'class' AND line.source_id = source.id
          )
        UNION ALL
        SELECT 1 FROM public.teacher_compensation_work_ledger AS source
        WHERE source.teacher_id = p_teacher_id
          AND source.started_at < period_start
          AND NOT EXISTS (
              SELECT 1 FROM public.teacher_compensation_settlement_lines AS line
              WHERE line.source_kind = 'mandatory_work' AND line.source_id = source.id
          )
        UNION ALL
        SELECT 1
        FROM public.teacher_compensation_work_adjustments AS source
        JOIN public.teacher_compensation_work_ledger AS work
          ON work.id = source.work_entry_id
        WHERE source.teacher_id = p_teacher_id
          AND work.started_at < period_start
          AND NOT EXISTS (
              SELECT 1 FROM public.teacher_compensation_settlement_lines AS line
              WHERE line.source_kind = 'work_adjustment' AND line.source_id = source.id
          )
    ) THEN
        RAISE EXCEPTION 'teacher_compensation_settlement_prior_period_required'
            USING ERRCODE = '55000';
    END IF;

    SELECT COALESCE(SUM(source.amount_cents), 0)::INTEGER, COUNT(*)::INTEGER
    INTO class_total, class_lines
    FROM public.teacher_compensation_ledger AS source
    WHERE source.teacher_id = p_teacher_id
      AND source.source_occurred_at >= period_start
      AND source.source_occurred_at < period_end
      AND NOT EXISTS (
          SELECT 1 FROM public.teacher_compensation_settlement_lines AS line
          WHERE line.source_kind = 'class' AND line.source_id = source.id
      );

    SELECT COALESCE(SUM(source.amount_cents), 0)::INTEGER, COUNT(*)::INTEGER
    INTO work_total, work_lines
    FROM public.teacher_compensation_work_ledger AS source
    WHERE source.teacher_id = p_teacher_id
      AND source.started_at >= period_start
      AND source.started_at < period_end
      AND NOT EXISTS (
          SELECT 1 FROM public.teacher_compensation_settlement_lines AS line
          WHERE line.source_kind = 'mandatory_work' AND line.source_id = source.id
      );

    SELECT COALESCE(SUM(source.amount_delta_cents), 0)::INTEGER, COUNT(*)::INTEGER
    INTO adjustment_total, adjustment_lines
    FROM public.teacher_compensation_work_adjustments AS source
    JOIN public.teacher_compensation_work_ledger AS work
      ON work.id = source.work_entry_id
    WHERE source.teacher_id = p_teacher_id
      AND work.started_at >= period_start
      AND work.started_at < period_end
      AND NOT EXISTS (
          SELECT 1 FROM public.teacher_compensation_settlement_lines AS line
          WHERE line.source_kind = 'work_adjustment' AND line.source_id = source.id
      );

    expected_lines := class_lines + work_lines + adjustment_lines;
    IF expected_lines = 0 THEN
        RAISE EXCEPTION 'teacher_compensation_settlement_has_no_obligations'
            USING ERRCODE = '55000';
    END IF;
    IF class_total + work_total + adjustment_total < 0 THEN
        RAISE EXCEPTION 'teacher_compensation_settlement_negative_balance'
            USING ERRCODE = '23514';
    END IF;

    INSERT INTO public.teacher_compensation_settlements (
        request_id, teacher_id, period_month, period_start_at, period_end_at,
        currency, class_amount_cents, mandatory_work_amount_cents,
        adjustment_amount_cents, total_amount_cents, line_count, closed_by,
        close_note
    ) VALUES (
        p_request_id, p_teacher_id, p_period_month, period_start, period_end,
        'eur', class_total, work_total, adjustment_total,
        class_total + work_total + adjustment_total, expected_lines,
        p_admin_id, trimmed_note
    ) RETURNING * INTO settlement_row;

    INSERT INTO public.teacher_compensation_settlement_lines (
        settlement_id, teacher_id, source_kind, source_id, student_id,
        source_occurred_at, quantity_minutes, description, amount_cents, currency
    )
    SELECT settlement_row.id, source.teacher_id, 'class', source.id,
        source.student_id, source.source_occurred_at, NULL,
        source.event_kind, source.amount_cents, source.currency
    FROM public.teacher_compensation_ledger AS source
    WHERE source.teacher_id = p_teacher_id
      AND source.source_occurred_at >= period_start
      AND source.source_occurred_at < period_end
      AND NOT EXISTS (
          SELECT 1 FROM public.teacher_compensation_settlement_lines AS line
          WHERE line.source_kind = 'class' AND line.source_id = source.id
      );

    INSERT INTO public.teacher_compensation_settlement_lines (
        settlement_id, teacher_id, source_kind, source_id, student_id,
        source_occurred_at, quantity_minutes, description, amount_cents, currency
    )
    SELECT settlement_row.id, source.teacher_id, 'mandatory_work', source.id,
        NULL, source.started_at, source.duration_minutes, source.description,
        source.amount_cents, source.currency
    FROM public.teacher_compensation_work_ledger AS source
    WHERE source.teacher_id = p_teacher_id
      AND source.started_at >= period_start
      AND source.started_at < period_end
      AND NOT EXISTS (
          SELECT 1 FROM public.teacher_compensation_settlement_lines AS line
          WHERE line.source_kind = 'mandatory_work' AND line.source_id = source.id
      );

    INSERT INTO public.teacher_compensation_settlement_lines (
        settlement_id, teacher_id, source_kind, source_id, student_id,
        source_occurred_at, quantity_minutes, description, amount_cents, currency
    )
    SELECT settlement_row.id, source.teacher_id, 'work_adjustment', source.id,
        NULL, work.started_at, source.minutes_delta, source.reason,
        source.amount_delta_cents, source.currency
    FROM public.teacher_compensation_work_adjustments AS source
    JOIN public.teacher_compensation_work_ledger AS work
      ON work.id = source.work_entry_id
    WHERE source.teacher_id = p_teacher_id
      AND work.started_at >= period_start
      AND work.started_at < period_end
      AND NOT EXISTS (
          SELECT 1 FROM public.teacher_compensation_settlement_lines AS line
          WHERE line.source_kind = 'work_adjustment' AND line.source_id = source.id
      );

    SELECT COUNT(*)::INTEGER, COALESCE(SUM(amount_cents), 0)
    INTO inserted_lines, inserted_total
    FROM public.teacher_compensation_settlement_lines
    WHERE settlement_id = settlement_row.id;
    IF inserted_lines IS DISTINCT FROM settlement_row.line_count
       OR inserted_total IS DISTINCT FROM settlement_row.total_amount_cents::BIGINT
    THEN
        RAISE EXCEPTION 'teacher_compensation_settlement_state_conflicts'
            USING ERRCODE = '40001';
    END IF;

    INSERT INTO public.admin_audit_log (
        admin_id, action, entity_type, entity_id, after
    ) VALUES (
        p_admin_id, 'close_teacher_compensation_settlement',
        'teacher_compensation_settlement', settlement_row.id::TEXT,
        pg_catalog.to_jsonb(settlement_row)
    );
    RETURN settlement_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_teacher_compensation_settlement_payment(
    p_request_id UUID,
    p_settlement_id UUID,
    p_paid_at TIMESTAMPTZ,
    p_payment_reference TEXT,
    p_invoice_reference TEXT,
    p_admin_id UUID,
    p_note TEXT
)
RETURNS public.teacher_compensation_settlement_payments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    existing_row public.teacher_compensation_settlement_payments%ROWTYPE;
    settlement_row public.teacher_compensation_settlements%ROWTYPE;
    payment_row public.teacher_compensation_settlement_payments%ROWTYPE;
    trimmed_payment_reference TEXT := btrim(p_payment_reference);
    trimmed_invoice_reference TEXT := NULLIF(btrim(p_invoice_reference), '');
    trimmed_note TEXT := btrim(p_note);
BEGIN
    IF p_request_id IS NULL
       OR p_settlement_id IS NULL
       OR p_paid_at IS NULL
       OR NOT pg_catalog.isfinite(p_paid_at)
       OR p_paid_at > clock_timestamp()
       OR p_payment_reference IS NULL
       OR char_length(trimmed_payment_reference) NOT BETWEEN 3 AND 200
       OR (trimmed_invoice_reference IS NOT NULL
            AND char_length(trimmed_invoice_reference) > 200)
       OR p_admin_id IS NULL
       OR p_note IS NULL
       OR char_length(trimmed_note) NOT BETWEEN 5 AND 1000
    THEN
        RAISE EXCEPTION 'invalid_teacher_compensation_settlement_payment'
            USING ERRCODE = '22023';
    END IF;

    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(p_request_id::TEXT, 58152)
    );
    SELECT * INTO existing_row
    FROM public.teacher_compensation_settlement_payments
    WHERE request_id = p_request_id
    FOR UPDATE;
    IF FOUND THEN
        IF ROW(
            existing_row.settlement_id,
            existing_row.paid_at,
            existing_row.payment_reference,
            existing_row.invoice_reference,
            existing_row.recorded_by,
            existing_row.note
        ) IS DISTINCT FROM ROW(
            p_settlement_id,
            p_paid_at,
            trimmed_payment_reference,
            trimmed_invoice_reference,
            p_admin_id,
            trimmed_note
        ) THEN
            RAISE EXCEPTION 'teacher_compensation_settlement_payment_request_conflicts'
                USING ERRCODE = '40001';
        END IF;
        RETURN existing_row;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = p_admin_id AND role = 'admin'::public.user_role
    ) THEN
        RAISE EXCEPTION 'teacher_compensation_settlement_forbidden'
            USING ERRCODE = '42501';
    END IF;

    SELECT * INTO settlement_row
    FROM public.teacher_compensation_settlements
    WHERE id = p_settlement_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'teacher_compensation_settlement_not_found'
            USING ERRCODE = '55000';
    END IF;
    IF p_paid_at < settlement_row.period_end_at THEN
        RAISE EXCEPTION 'invalid_teacher_compensation_settlement_payment'
            USING ERRCODE = '22023';
    END IF;
    IF EXISTS (
        SELECT 1
        FROM public.teacher_compensation_settlement_payments AS payment
        WHERE payment.settlement_id = settlement_row.id
          AND NOT EXISTS (
              SELECT 1
              FROM public.teacher_compensation_settlement_payment_voids AS void
              WHERE void.payment_id = payment.id
          )
    ) THEN
        RAISE EXCEPTION 'teacher_compensation_settlement_already_paid'
            USING ERRCODE = '40001';
    END IF;

    INSERT INTO public.teacher_compensation_settlement_payments (
        request_id, settlement_id, teacher_id, amount_cents, currency, paid_at,
        payment_reference, invoice_reference, note, recorded_by
    ) VALUES (
        p_request_id, settlement_row.id, settlement_row.teacher_id,
        settlement_row.total_amount_cents, settlement_row.currency, p_paid_at,
        trimmed_payment_reference, trimmed_invoice_reference, trimmed_note,
        p_admin_id
    ) RETURNING * INTO payment_row;

    INSERT INTO public.admin_audit_log (
        admin_id, action, entity_type, entity_id, after
    ) VALUES (
        p_admin_id, 'record_teacher_compensation_settlement_payment',
        'teacher_compensation_settlement_payment', payment_row.id::TEXT,
        pg_catalog.to_jsonb(payment_row)
    );
    RETURN payment_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.void_teacher_compensation_settlement_payment(
    p_request_id UUID,
    p_payment_id UUID,
    p_admin_id UUID,
    p_reason TEXT
)
RETURNS public.teacher_compensation_settlement_payment_voids
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    existing_row public.teacher_compensation_settlement_payment_voids%ROWTYPE;
    payment_row public.teacher_compensation_settlement_payments%ROWTYPE;
    void_row public.teacher_compensation_settlement_payment_voids%ROWTYPE;
    target_settlement_id UUID;
    trimmed_reason TEXT := btrim(p_reason);
BEGIN
    IF p_request_id IS NULL
       OR p_payment_id IS NULL
       OR p_admin_id IS NULL
       OR p_reason IS NULL
       OR char_length(trimmed_reason) NOT BETWEEN 5 AND 1000
    THEN
        RAISE EXCEPTION 'invalid_teacher_compensation_settlement_payment_void'
            USING ERRCODE = '22023';
    END IF;

    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(p_request_id::TEXT, 58153)
    );
    SELECT * INTO existing_row
    FROM public.teacher_compensation_settlement_payment_voids
    WHERE request_id = p_request_id
    FOR UPDATE;
    IF FOUND THEN
        IF ROW(existing_row.payment_id, existing_row.voided_by, existing_row.reason)
            IS DISTINCT FROM ROW(p_payment_id, p_admin_id, trimmed_reason)
        THEN
            RAISE EXCEPTION 'teacher_compensation_settlement_payment_void_request_conflicts'
                USING ERRCODE = '40001';
        END IF;
        RETURN existing_row;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = p_admin_id AND role = 'admin'::public.user_role
    ) THEN
        RAISE EXCEPTION 'teacher_compensation_settlement_forbidden'
            USING ERRCODE = '42501';
    END IF;

    SELECT settlement_id INTO target_settlement_id
    FROM public.teacher_compensation_settlement_payments
    WHERE id = p_payment_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'teacher_compensation_settlement_payment_not_found'
            USING ERRCODE = '55000';
    END IF;

    PERFORM 1
    FROM public.teacher_compensation_settlements
    WHERE id = target_settlement_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'teacher_compensation_settlement_not_found'
            USING ERRCODE = '55000';
    END IF;

    SELECT * INTO payment_row
    FROM public.teacher_compensation_settlement_payments
    WHERE id = p_payment_id
      AND settlement_id = target_settlement_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'teacher_compensation_settlement_payment_not_found'
            USING ERRCODE = '55000';
    END IF;
    IF EXISTS (
        SELECT 1
        FROM public.teacher_compensation_settlement_payment_voids
        WHERE payment_id = payment_row.id
    ) THEN
        RAISE EXCEPTION 'teacher_compensation_settlement_payment_already_void'
            USING ERRCODE = '40001';
    END IF;

    INSERT INTO public.teacher_compensation_settlement_payment_voids (
        request_id, payment_id, settlement_id, teacher_id, reason, voided_by
    ) VALUES (
        p_request_id, payment_row.id, payment_row.settlement_id,
        payment_row.teacher_id, trimmed_reason, p_admin_id
    ) RETURNING * INTO void_row;

    INSERT INTO public.admin_audit_log (
        admin_id, action, entity_type, entity_id, before, after
    ) VALUES (
        p_admin_id, 'void_teacher_compensation_settlement_payment',
        'teacher_compensation_settlement_payment_void', void_row.id::TEXT,
        pg_catalog.to_jsonb(payment_row), pg_catalog.to_jsonb(void_row)
    );
    RETURN void_row;
END;
$$;

CREATE VIEW public.teacher_compensation_settlement_balances
WITH (security_invoker = true)
AS
SELECT
    settlement.id,
    settlement.request_id,
    settlement.teacher_id,
    settlement.period_month,
    settlement.period_start_at,
    settlement.period_end_at,
    settlement.timezone,
    settlement.currency,
    settlement.class_amount_cents,
    settlement.mandatory_work_amount_cents,
    settlement.adjustment_amount_cents,
    settlement.total_amount_cents,
    settlement.line_count,
    settlement.closed_by,
    settlement.close_note,
    settlement.closed_at,
    CASE WHEN payment.id IS NULL THEN 'closed' ELSE 'paid' END AS status,
    payment.id AS payment_id,
    payment.paid_at,
    payment.payment_reference,
    payment.invoice_reference,
    payment.note AS payment_note,
    payment.recorded_by AS payment_recorded_by
FROM public.teacher_compensation_settlements AS settlement
LEFT JOIN LATERAL (
    SELECT candidate.*
    FROM public.teacher_compensation_settlement_payments AS candidate
    WHERE candidate.settlement_id = settlement.id
      AND NOT EXISTS (
          SELECT 1
          FROM public.teacher_compensation_settlement_payment_voids AS void
          WHERE void.payment_id = candidate.id
      )
    ORDER BY candidate.created_at DESC, candidate.id DESC
    LIMIT 1
) AS payment ON TRUE;

REVOKE ALL ON TABLE public.teacher_compensation_settlement_balances
    FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.teacher_compensation_settlement_balances
    TO service_role;

REVOKE ALL ON FUNCTION private.guard_teacher_compensation_closed_period()
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.close_teacher_compensation_settlement(
    UUID, UUID, DATE, UUID, TEXT
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.close_teacher_compensation_settlement(
    UUID, UUID, DATE, UUID, TEXT
) TO service_role;
REVOKE ALL ON FUNCTION public.record_teacher_compensation_settlement_payment(
    UUID, UUID, TIMESTAMPTZ, TEXT, TEXT, UUID, TEXT
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_teacher_compensation_settlement_payment(
    UUID, UUID, TIMESTAMPTZ, TEXT, TEXT, UUID, TEXT
) TO service_role;
REVOKE ALL ON FUNCTION public.void_teacher_compensation_settlement_payment(
    UUID, UUID, UUID, TEXT
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.void_teacher_compensation_settlement_payment(
    UUID, UUID, UUID, TEXT
) TO service_role;

COMMENT ON TABLE public.teacher_compensation_settlements IS
    'Immutable monthly snapshots of teacher compensation obligations; no transfer is executed.';
COMMENT ON TABLE public.teacher_compensation_settlement_lines IS
    'Immutable source-level class, mandatory-work and adjustment lines captured by one settlement.';
COMMENT ON TABLE public.teacher_compensation_settlement_payments IS
    'Append-only evidence that an operator documented one manual settlement payment.';
COMMENT ON TABLE public.teacher_compensation_settlement_payment_voids IS
    'Append-only corrections that void erroneous payment evidence without deleting history.';
