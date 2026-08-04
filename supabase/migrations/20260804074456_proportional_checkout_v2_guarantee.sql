-- Proportional Checkout V2 guarantee for every paid cycle and every
-- contractually allocated session. Existing operations keep their legacy
-- four-session columns for compatibility, while the normalized immutable
-- session snapshot becomes authoritative for all new work.

ALTER TABLE public.checkout_v2_cycles
    DROP CONSTRAINT IF EXISTS checkout_v2_cycles_sessions_total_check,
    DROP CONSTRAINT IF EXISTS checkout_v2_cycles_amount_cents_check,
    DROP CONSTRAINT IF EXISTS checkout_v2_cycles_currency_check,
    DROP CONSTRAINT IF EXISTS checkout_v2_cycles_exact_period;

ALTER TABLE public.checkout_v2_cycles
    ADD CONSTRAINT checkout_v2_cycles_sessions_total_check CHECK (
        sessions_total BETWEEN 1 AND 200
    ),
    ADD CONSTRAINT checkout_v2_cycles_amount_cents_check CHECK (
        amount_cents > 0
    ),
    ADD CONSTRAINT checkout_v2_cycles_currency_check CHECK (
        currency ~ '^[a-z]{3}$'
    ),
    ADD CONSTRAINT checkout_v2_cycles_period_check CHECK (
        ends_at > starts_at
        AND ends_at <= starts_at + INTERVAL '3 years'
    );

ALTER TABLE public.sessions
    DROP CONSTRAINT IF EXISTS sessions_checkout_v2_cycle_session_index_check;
ALTER TABLE public.sessions
    ADD CONSTRAINT sessions_checkout_v2_cycle_session_index_check CHECK (
        checkout_v2_cycle_session_index BETWEEN 1 AND 200
    );

ALTER TABLE public.checkout_v2_session_credit_adjustments
    DROP CONSTRAINT IF EXISTS checkout_v2_session_credit_adjustments_session_index_check;
ALTER TABLE public.checkout_v2_session_credit_adjustments
    ADD CONSTRAINT checkout_v2_session_credit_adjustments_session_index_check CHECK (
        session_index BETWEEN 1 AND 200
    );

ALTER TABLE public.checkout_v2_session_incident_resolutions
    DROP CONSTRAINT IF EXISTS checkout_v2_session_incident_resolutions_session_index_check;
ALTER TABLE public.checkout_v2_session_incident_resolutions
    ADD CONSTRAINT checkout_v2_session_incident_resolutions_session_index_check CHECK (
        session_index BETWEEN 1 AND 200
    );

ALTER TABLE public.checkout_v2_guarantee_operations
    DROP CONSTRAINT IF EXISTS checkout_v2_guarantee_operations_gross_amount_cents_check,
    DROP CONSTRAINT IF EXISTS checkout_v2_guarantee_operations_refund_amount_cents_check,
    DROP CONSTRAINT IF EXISTS checkout_v2_guarantee_operations_currency_check;

ALTER TABLE public.checkout_v2_guarantee_operations
    ALTER COLUMN third_session_id DROP NOT NULL,
    ALTER COLUMN fourth_session_id DROP NOT NULL,
    ADD COLUMN package_price_id UUID
        REFERENCES public.package_prices(id) ON DELETE RESTRICT,
    ADD COLUMN cycle_number INTEGER,
    ADD COLUMN sessions_total SMALLINT,
    ADD COLUMN sessions_consumed SMALLINT,
    ADD COLUMN session_base_amount_cents INTEGER,
    ADD COLUMN session_remainder_units SMALLINT;

UPDATE public.checkout_v2_guarantee_operations AS operation
SET
    package_price_id = subscription.package_price_id,
    cycle_number = cycle.cycle_number,
    sessions_total = cycle.sessions_total,
    sessions_consumed = 1,
    session_base_amount_cents = snapshot.session_base_amount_cents,
    session_remainder_units = snapshot.session_remainder_units
FROM public.subscriptions AS subscription
JOIN public.checkout_v2_price_snapshots AS snapshot
  ON snapshot.package_price_id = subscription.package_price_id
JOIN public.checkout_v2_cycles AS cycle
  ON cycle.subscription_id = subscription.id
WHERE operation.subscription_id = subscription.id
  AND operation.cycle_id = cycle.id;

ALTER TABLE public.checkout_v2_guarantee_operations
    ALTER COLUMN package_price_id SET NOT NULL,
    ALTER COLUMN cycle_number SET NOT NULL,
    ALTER COLUMN sessions_total SET NOT NULL,
    ALTER COLUMN sessions_consumed SET NOT NULL,
    ALTER COLUMN session_base_amount_cents SET NOT NULL,
    ALTER COLUMN session_remainder_units SET NOT NULL,
    ADD CONSTRAINT checkout_v2_guarantee_operations_amount_shape_check CHECK (
        gross_amount_cents > 0
        AND refund_amount_cents > 0
        AND refund_amount_cents < gross_amount_cents
        AND currency ~ '^[a-z]{3}$'
        AND sessions_total BETWEEN 2 AND 200
        AND sessions_consumed BETWEEN 1 AND sessions_total - 1
        AND session_base_amount_cents > 0
        AND session_remainder_units BETWEEN 0 AND sessions_total - 1
        AND gross_amount_cents = session_base_amount_cents * sessions_total
            + session_remainder_units
        AND refund_amount_cents =
            session_base_amount_cents * (sessions_total - sessions_consumed)
            + GREATEST(session_remainder_units - sessions_consumed, 0)
    ),
    ADD CONSTRAINT checkout_v2_guarantee_operations_cycle_number_check CHECK (
        cycle_number > 0
    );

CREATE INDEX checkout_v2_guarantee_operations_cycle_lookup_idx
    ON public.checkout_v2_guarantee_operations(subscription_id, cycle_number DESC);

CREATE TABLE public.checkout_v2_guarantee_operation_sessions (
    operation_id UUID NOT NULL
        REFERENCES public.checkout_v2_guarantee_operations(id) ON DELETE RESTRICT,
    session_id UUID NOT NULL UNIQUE
        REFERENCES public.sessions(id) ON DELETE RESTRICT,
    cycle_id UUID NOT NULL
        REFERENCES public.checkout_v2_cycles(id) ON DELETE RESTRICT,
    session_index SMALLINT NOT NULL CHECK (session_index BETWEEN 1 AND 200),
    amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
    was_consumed BOOLEAN NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT date_trunc('second', clock_timestamp()),
    PRIMARY KEY (operation_id, session_index),
    UNIQUE (operation_id, session_id)
);

INSERT INTO public.checkout_v2_guarantee_operation_sessions (
    operation_id,
    session_id,
    cycle_id,
    session_index,
    amount_cents,
    was_consumed,
    created_at
)
SELECT
    operation.id,
    legacy.session_id,
    operation.cycle_id,
    legacy.session_index,
    operation.session_base_amount_cents
        + CASE
            WHEN legacy.session_index <= operation.session_remainder_units THEN 1
            ELSE 0
          END,
    legacy.session_index <= operation.sessions_consumed,
    operation.created_at
FROM public.checkout_v2_guarantee_operations AS operation
CROSS JOIN LATERAL (
    VALUES
        (1::SMALLINT, operation.first_session_id),
        (2::SMALLINT, operation.second_session_id),
        (3::SMALLINT, operation.third_session_id),
        (4::SMALLINT, operation.fourth_session_id)
) AS legacy(session_index, session_id)
WHERE legacy.session_id IS NOT NULL;

CREATE INDEX checkout_v2_guarantee_operation_sessions_cycle_idx
    ON public.checkout_v2_guarantee_operation_sessions(cycle_id, session_index);

ALTER TABLE public.checkout_v2_guarantee_operation_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.checkout_v2_guarantee_operation_sessions
    FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.checkout_v2_guarantee_operation_sessions TO service_role;

CREATE OR REPLACE FUNCTION private.guard_checkout_v2_guarantee_operation_session()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    operation_row public.checkout_v2_guarantee_operations%ROWTYPE;
    session_row public.sessions%ROWTYPE;
    expected_amount INTEGER;
BEGIN
    IF TG_OP <> 'INSERT' THEN
        RAISE EXCEPTION 'checkout_v2_guarantee_operation_session_is_immutable'
            USING ERRCODE = '23514';
    END IF;

    SELECT * INTO operation_row
    FROM public.checkout_v2_guarantee_operations
    WHERE id = NEW.operation_id;
    SELECT * INTO session_row
    FROM public.sessions
    WHERE id = NEW.session_id;

    expected_amount := operation_row.session_base_amount_cents
        + CASE
            WHEN NEW.session_index <= operation_row.session_remainder_units THEN 1
            ELSE 0
          END;

    IF operation_row.id IS NULL
       OR operation_row.status IS DISTINCT FROM 'requested'
       OR session_row.id IS NULL
       OR NEW.cycle_id IS DISTINCT FROM operation_row.cycle_id
       OR session_row.subscription_id IS DISTINCT FROM operation_row.subscription_id
       OR session_row.checkout_v2_cycle_id IS DISTINCT FROM operation_row.cycle_id
       OR session_row.checkout_v2_cycle_session_index IS DISTINCT FROM NEW.session_index
       OR NEW.session_index > operation_row.sessions_total
       OR NEW.amount_cents IS DISTINCT FROM expected_amount
       OR NEW.was_consumed IS DISTINCT FROM (
            NEW.session_index <= operation_row.sessions_consumed
       ) THEN
        RAISE EXCEPTION 'checkout_v2_guarantee_operation_session_snapshot_is_invalid'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER guard_checkout_v2_guarantee_operation_session_trigger
    BEFORE INSERT OR UPDATE OR DELETE
    ON public.checkout_v2_guarantee_operation_sessions
    FOR EACH ROW EXECUTE FUNCTION private.guard_checkout_v2_guarantee_operation_session();

REVOKE ALL ON FUNCTION private.guard_checkout_v2_guarantee_operation_session()
    FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON TABLE public.checkout_v2_guarantee_operation_sessions IS
    'Immutable per-session cent allocation and consumed/refundable snapshot for one guarantee operation.';

CREATE OR REPLACE FUNCTION private.guard_checkout_v2_guarantee_operation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    snapshot_count INTEGER;
    snapshot_amount INTEGER;
    snapshot_consumed INTEGER;
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'checkout_v2_guarantee_operation_cannot_be_deleted'
            USING ERRCODE = '23514';
    END IF;

    IF ROW(
        NEW.id,
        NEW.request_id,
        NEW.subscription_id,
        NEW.cycle_id,
        NEW.payment_id,
        NEW.actor_id,
        NEW.first_session_id,
        NEW.second_session_id,
        NEW.third_session_id,
        NEW.fourth_session_id,
        NEW.package_price_id,
        NEW.cycle_number,
        NEW.sessions_total,
        NEW.sessions_consumed,
        NEW.session_base_amount_cents,
        NEW.session_remainder_units,
        NEW.stripe_customer_id,
        NEW.stripe_subscription_id,
        NEW.stripe_invoice_id,
        NEW.stripe_payment_intent_id,
        NEW.gross_amount_cents,
        NEW.refund_amount_cents,
        NEW.currency,
        NEW.created_at
    ) IS DISTINCT FROM ROW(
        OLD.id,
        OLD.request_id,
        OLD.subscription_id,
        OLD.cycle_id,
        OLD.payment_id,
        OLD.actor_id,
        OLD.first_session_id,
        OLD.second_session_id,
        OLD.third_session_id,
        OLD.fourth_session_id,
        OLD.package_price_id,
        OLD.cycle_number,
        OLD.sessions_total,
        OLD.sessions_consumed,
        OLD.session_base_amount_cents,
        OLD.session_remainder_units,
        OLD.stripe_customer_id,
        OLD.stripe_subscription_id,
        OLD.stripe_invoice_id,
        OLD.stripe_payment_intent_id,
        OLD.gross_amount_cents,
        OLD.refund_amount_cents,
        OLD.currency,
        OLD.created_at
    ) THEN
        RAISE EXCEPTION 'checkout_v2_guarantee_snapshot_is_immutable'
            USING ERRCODE = '23514';
    END IF;

    SELECT
        COUNT(*)::INTEGER,
        COALESCE(SUM(amount_cents), 0)::INTEGER,
        COUNT(*) FILTER (WHERE was_consumed)::INTEGER
    INTO snapshot_count, snapshot_amount, snapshot_consumed
    FROM public.checkout_v2_guarantee_operation_sessions
    WHERE operation_id = NEW.id;

    IF snapshot_count IS DISTINCT FROM NEW.sessions_total
       OR snapshot_amount IS DISTINCT FROM NEW.gross_amount_cents
       OR snapshot_consumed IS DISTINCT FROM NEW.sessions_consumed THEN
        RAISE EXCEPTION 'checkout_v2_guarantee_session_snapshot_is_incomplete'
            USING ERRCODE = '23514';
    END IF;

    NEW.updated_at := date_trunc('second', clock_timestamp());
    RETURN NEW;
END;
$$;

-- Keep the durable terminal lock proportional as well. The original guard
-- named four columns explicitly; the immutable operation/session snapshot is
-- now the single authority for every package size.
CREATE OR REPLACE FUNCTION private.guard_checkout_v2_guarantee_locked_state()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    target_subscription_ids UUID[];
    target_subscription_id UUID;
    bypass_operation_id TEXT := NULLIF(
        pg_catalog.current_setting('app.checkout_v2_guarantee_operation_id', TRUE),
        ''
    );
    blocking_operation_id UUID;
    terminal_operation public.checkout_v2_guarantee_operations%ROWTYPE;
BEGIN
    IF TG_OP = 'UPDATE' AND NEW IS NOT DISTINCT FROM OLD THEN
        RETURN NEW;
    END IF;

    IF TG_TABLE_NAME = 'sessions' THEN
        IF TG_OP = 'UPDATE'
           AND ROW(
                NEW.scheduled_at,
                NEW.status,
                NEW.completed_at,
                NEW.cancelled_at,
                NEW.cancelled_by,
                NEW.cancellation_reason,
                NEW.subscription_id,
                NEW.student_id,
                NEW.teacher_id,
                NEW.duration_minutes,
                NEW.checkout_v2_cycle_id,
                NEW.checkout_v2_cycle_session_index
           ) IS NOT DISTINCT FROM ROW(
                OLD.scheduled_at,
                OLD.status,
                OLD.completed_at,
                OLD.cancelled_at,
                OLD.cancelled_by,
                OLD.cancellation_reason,
                OLD.subscription_id,
                OLD.student_id,
                OLD.teacher_id,
                OLD.duration_minutes,
                OLD.checkout_v2_cycle_id,
                OLD.checkout_v2_cycle_session_index
           ) THEN
            RETURN NEW;
        END IF;

        target_subscription_ids := CASE TG_OP
            WHEN 'INSERT' THEN ARRAY[NEW.subscription_id]
            WHEN 'DELETE' THEN ARRAY[OLD.subscription_id]
            ELSE ARRAY[OLD.subscription_id, NEW.subscription_id]
        END;
    ELSIF TG_TABLE_NAME = 'subscriptions' THEN
        target_subscription_ids := CASE TG_OP
            WHEN 'INSERT' THEN ARRAY[NEW.id]
            WHEN 'DELETE' THEN ARRAY[OLD.id]
            ELSE ARRAY[OLD.id, NEW.id]
        END;
    ELSE
        target_subscription_ids := CASE TG_OP
            WHEN 'INSERT' THEN ARRAY[NEW.subscription_id]
            WHEN 'DELETE' THEN ARRAY[OLD.subscription_id]
            ELSE ARRAY[OLD.subscription_id, NEW.subscription_id]
        END;
    END IF;

    FOREACH target_subscription_id IN ARRAY target_subscription_ids
    LOOP
        IF target_subscription_id IS NOT NULL THEN
            PERFORM pg_catalog.pg_advisory_xact_lock(
                pg_catalog.hashtextextended(target_subscription_id::TEXT, 42854)
            );
        END IF;
    END LOOP;

    SELECT operation.id INTO blocking_operation_id
    FROM public.checkout_v2_guarantee_operations AS operation
    WHERE operation.subscription_id = ANY(target_subscription_ids)
      AND operation.status <> 'refunded'
      AND operation.id::TEXT IS DISTINCT FROM bypass_operation_id
    ORDER BY operation.created_at, operation.id
    LIMIT 1;

    IF blocking_operation_id IS NOT NULL THEN
        RAISE EXCEPTION 'checkout_v2_guarantee_state_is_locked'
            USING ERRCODE = '40001';
    END IF;

    IF TG_TABLE_NAME = 'sessions' THEN
        SELECT operation.* INTO terminal_operation
        FROM public.checkout_v2_guarantee_operations AS operation
        WHERE operation.status = 'refunded'
          AND operation.subscription_id = ANY(target_subscription_ids)
        ORDER BY operation.created_at, operation.id
        LIMIT 1;

        IF terminal_operation.id IS NOT NULL THEN
            IF TG_OP = 'INSERT' THEN
                RAISE EXCEPTION 'checkout_v2_guarantee_terminal_state_is_locked'
                    USING ERRCODE = '40001';
            ELSIF TG_OP = 'DELETE'
               AND EXISTS (
                    SELECT 1
                    FROM public.checkout_v2_guarantee_operation_sessions AS snapshot
                    WHERE snapshot.operation_id = terminal_operation.id
                      AND snapshot.session_id = OLD.id
               ) THEN
                RAISE EXCEPTION 'checkout_v2_guarantee_terminal_state_is_locked'
                    USING ERRCODE = '40001';
            ELSIF TG_OP = 'UPDATE'
               AND EXISTS (
                    SELECT 1
                    FROM public.checkout_v2_guarantee_operation_sessions AS snapshot
                    WHERE snapshot.operation_id = terminal_operation.id
                      AND snapshot.session_id IN (OLD.id, NEW.id)
               ) THEN
                RAISE EXCEPTION 'checkout_v2_guarantee_terminal_state_is_locked'
                    USING ERRCODE = '40001';
            END IF;
        END IF;
    ELSIF TG_TABLE_NAME = 'subscriptions' THEN
        SELECT operation.* INTO terminal_operation
        FROM public.checkout_v2_guarantee_operations AS operation
        WHERE operation.status = 'refunded'
          AND operation.subscription_id = ANY(target_subscription_ids)
        ORDER BY operation.created_at, operation.id
        LIMIT 1;

        IF terminal_operation.id IS NOT NULL THEN
            IF TG_OP = 'DELETE'
               OR (
                    TG_OP = 'UPDATE'
                    AND (
                        NEW.status IS DISTINCT FROM 'cancelled'
                        OR NEW.sessions_used IS DISTINCT FROM terminal_operation.sessions_consumed
                        OR NEW.student_id IS DISTINCT FROM terminal_operation.actor_id
                        OR NEW.stripe_subscription_id IS DISTINCT FROM
                            terminal_operation.stripe_subscription_id
                    )
               ) THEN
                RAISE EXCEPTION 'checkout_v2_guarantee_terminal_state_is_locked'
                    USING ERRCODE = '40001';
            END IF;
        END IF;
    ELSIF TG_TABLE_NAME = 'payments' THEN
        SELECT operation.* INTO terminal_operation
        FROM public.checkout_v2_guarantee_operations AS operation
        WHERE operation.status = 'refunded'
          AND operation.payment_id = CASE
                WHEN TG_OP = 'DELETE' THEN OLD.id
                ELSE NEW.id
              END
        LIMIT 1;

        IF terminal_operation.id IS NOT NULL
           AND (
                TG_OP = 'DELETE'
                OR NEW.status IS DISTINCT FROM 'succeeded'
                OR NEW.amount IS DISTINCT FROM terminal_operation.gross_amount_cents
                OR lower(NEW.currency) IS DISTINCT FROM terminal_operation.currency
                OR NEW.amount_refunded IS DISTINCT FROM terminal_operation.refund_amount_cents
                OR NEW.stripe_refund_id IS DISTINCT FROM terminal_operation.stripe_refund_id
                OR NEW.stripe_payment_intent_id IS DISTINCT FROM
                    terminal_operation.stripe_payment_intent_id
                OR NEW.stripe_invoice_id IS DISTINCT FROM terminal_operation.stripe_invoice_id
                OR NEW.student_id IS DISTINCT FROM terminal_operation.actor_id
                OR NEW.subscription_id IS DISTINCT FROM terminal_operation.subscription_id
                OR NEW.checkout_v2_cycle_id IS DISTINCT FROM terminal_operation.cycle_id
           ) THEN
            RAISE EXCEPTION 'checkout_v2_guarantee_terminal_state_is_locked'
                USING ERRCODE = '40001';
        END IF;
    ELSIF TG_TABLE_NAME = 'checkout_v2_cycles' THEN
        IF EXISTS (
            SELECT 1
            FROM public.checkout_v2_guarantee_operations AS operation
            WHERE operation.status = 'refunded'
              AND operation.subscription_id = ANY(target_subscription_ids)
        ) THEN
            RAISE EXCEPTION 'checkout_v2_guarantee_terminal_state_is_locked'
                USING ERRCODE = '40001';
        END IF;
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$;

DROP FUNCTION private.evaluate_checkout_v2_guarantee(UUID, UUID, BOOLEAN);

CREATE FUNCTION private.evaluate_checkout_v2_guarantee(
    p_subscription_id UUID,
    p_actor_id UUID,
    p_lock_rows BOOLEAN DEFAULT FALSE
)
RETURNS TABLE (
    eligibility_state TEXT,
    eligibility_reason TEXT,
    subscription_id UUID,
    cycle_id UUID,
    payment_id UUID,
    first_session_id UUID,
    second_session_id UUID,
    third_session_id UUID,
    fourth_session_id UUID,
    package_price_id UUID,
    cycle_number INTEGER,
    sessions_total SMALLINT,
    sessions_consumed SMALLINT,
    session_base_amount_cents INTEGER,
    session_remainder_units SMALLINT,
    stripe_customer_id TEXT,
    stripe_subscription_id TEXT,
    stripe_invoice_id TEXT,
    stripe_payment_intent_id TEXT,
    gross_amount_cents INTEGER,
    refund_amount_cents INTEGER,
    currency TEXT
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    evaluated_at TIMESTAMPTZ := date_trunc('second', clock_timestamp());
    actor_role public.user_role;
    subscription_row public.subscriptions%ROWTYPE;
    cycle_row public.checkout_v2_cycles%ROWTYPE;
    payment_row public.payments%ROWTYPE;
    intent_row public.checkout_intents%ROWTYPE;
    price_snapshot public.checkout_v2_price_snapshots%ROWTYPE;
    session_fact RECORD;
    materialized_count INTEGER;
    distinct_positions INTEGER;
    minimum_position INTEGER;
    maximum_position INTEGER;
    consumed_count INTEGER := 0;
    encountered_refundable BOOLEAN := FALSE;
    credit_restored BOOLEAN;
    late_student_cancellation BOOLEAN;
    session_consumed BOOLEAN;
    expected_amount INTEGER;
    expected_price_id TEXT;
    expected_ends_at TIMESTAMPTZ;
BEGIN
    IF p_subscription_id IS NULL OR p_actor_id IS NULL THEN
        RAISE EXCEPTION 'invalid_checkout_v2_guarantee_request'
            USING ERRCODE = '22023';
    END IF;

    SELECT profile.role INTO actor_role
    FROM public.profiles AS profile
    WHERE profile.id = p_actor_id;

    IF p_lock_rows THEN
        PERFORM pg_catalog.pg_advisory_xact_lock(
            pg_catalog.hashtextextended(p_subscription_id::TEXT, 42854)
        );
        SELECT * INTO subscription_row
        FROM public.subscriptions AS subscription
        WHERE subscription.id = p_subscription_id
        FOR UPDATE;
    ELSE
        SELECT * INTO subscription_row
        FROM public.subscriptions AS subscription
        WHERE subscription.id = p_subscription_id;
    END IF;

    IF subscription_row.id IS NULL THEN
        RAISE EXCEPTION 'checkout_v2_guarantee_subscription_not_found'
            USING ERRCODE = 'P0002';
    END IF;

    IF actor_role IS NULL
       OR NOT (
            actor_role = 'admin'::public.user_role
            OR (
                actor_role = 'student'::public.user_role
                AND p_actor_id = subscription_row.student_id
            )
       ) THEN
        RAISE EXCEPTION 'checkout_v2_guarantee_forbidden'
            USING ERRCODE = '42501';
    END IF;

    IF p_lock_rows THEN
        SELECT * INTO cycle_row
        FROM public.checkout_v2_cycles AS cycle
        WHERE cycle.subscription_id = p_subscription_id
        ORDER BY cycle.cycle_number DESC
        LIMIT 1
        FOR UPDATE;
    ELSE
        SELECT * INTO cycle_row
        FROM public.checkout_v2_cycles AS cycle
        WHERE cycle.subscription_id = p_subscription_id
        ORDER BY cycle.cycle_number DESC
        LIMIT 1;
    END IF;

    IF cycle_row.id IS NOT NULL THEN
        IF p_lock_rows THEN
            SELECT * INTO payment_row
            FROM public.payments AS payment
            WHERE payment.id = cycle_row.payment_id
            FOR UPDATE;
            PERFORM 1
            FROM public.sessions AS session
            WHERE session.checkout_v2_cycle_id = cycle_row.id
            ORDER BY session.checkout_v2_cycle_session_index, session.id
            FOR UPDATE;
            PERFORM 1
            FROM public.checkout_v2_session_incident_resolutions AS resolution
            WHERE resolution.cycle_id = cycle_row.id
            ORDER BY resolution.session_index, resolution.id
            FOR UPDATE;
            PERFORM 1
            FROM public.checkout_v2_session_credit_adjustments AS adjustment
            WHERE adjustment.cycle_id = cycle_row.id
            ORDER BY adjustment.session_index, adjustment.id
            FOR UPDATE;
        ELSE
            SELECT * INTO payment_row
            FROM public.payments AS payment
            WHERE payment.id = cycle_row.payment_id;
        END IF;
    END IF;

    IF subscription_row.checkout_intent_id IS NOT NULL THEN
        SELECT * INTO intent_row
        FROM public.checkout_intents AS intent
        WHERE intent.id = subscription_row.checkout_intent_id;
    END IF;

    IF subscription_row.package_price_id IS NOT NULL THEN
        SELECT * INTO price_snapshot
        FROM public.checkout_v2_price_snapshots AS snapshot
        WHERE snapshot.package_price_id = subscription_row.package_price_id;
    END IF;

    subscription_id := subscription_row.id;
    cycle_id := cycle_row.id;
    payment_id := payment_row.id;
    package_price_id := subscription_row.package_price_id;
    cycle_number := cycle_row.cycle_number;
    sessions_total := cycle_row.sessions_total;
    session_base_amount_cents := price_snapshot.session_base_amount_cents;
    session_remainder_units := price_snapshot.session_remainder_units::SMALLINT;
    stripe_customer_id := intent_row.stripe_customer_id;
    stripe_subscription_id := subscription_row.stripe_subscription_id;
    stripe_invoice_id := payment_row.stripe_invoice_id;
    stripe_payment_intent_id := payment_row.stripe_payment_intent_id;
    gross_amount_cents := cycle_row.amount_cents;
    currency := lower(cycle_row.currency);

    IF subscription_row.contract_schema_version IS DISTINCT FROM 2
       OR subscription_row.status NOT IN (
            'active'::public.subscription_status,
            'paused'::public.subscription_status
       ) THEN
        eligibility_state := 'closed';
        eligibility_reason := 'subscription_not_active';
        RETURN NEXT;
        RETURN;
    END IF;

    expected_amount := CASE cycle_row.cycle_kind
        WHEN 'initial' THEN price_snapshot.initial_amount_cents
        WHEN 'renewal' THEN price_snapshot.recurring_amount_cents
        ELSE NULL
    END;
    expected_price_id := CASE cycle_row.cycle_kind
        WHEN 'initial' THEN price_snapshot.initial_stripe_price_id
        WHEN 'renewal' THEN price_snapshot.recurring_stripe_price_id
        ELSE NULL
    END;
    expected_ends_at := cycle_row.starts_at + CASE price_snapshot.recurring_interval_unit
        WHEN 'day' THEN pg_catalog.make_interval(days => price_snapshot.recurring_interval_count)
        WHEN 'week' THEN pg_catalog.make_interval(weeks => price_snapshot.recurring_interval_count)
        WHEN 'month' THEN pg_catalog.make_interval(months => price_snapshot.recurring_interval_count)
        WHEN 'year' THEN pg_catalog.make_interval(years => price_snapshot.recurring_interval_count)
        ELSE NULL
    END;

    IF cycle_row.id IS NULL
       OR cycle_row.materialization_state IS DISTINCT FROM 'ready'
       OR cycle_row.sessions_materialized_at IS NULL
       OR payment_row.id IS NULL
       OR intent_row.id IS NULL
       OR intent_row.status IS DISTINCT FROM 'completed'
       OR intent_row.student_id IS DISTINCT FROM subscription_row.student_id
       OR intent_row.package_price_id IS DISTINCT FROM subscription_row.package_price_id
       OR intent_row.stripe_customer_id IS NULL
       OR price_snapshot.package_price_id IS NULL
       OR price_snapshot.package_price_id IS DISTINCT FROM subscription_row.package_price_id
       OR price_snapshot.sessions_per_period IS DISTINCT FROM cycle_row.sessions_total::INTEGER
       OR price_snapshot.session_base_amount_cents <= 0
       OR price_snapshot.session_remainder_units < 0
       OR expected_amount IS DISTINCT FROM cycle_row.amount_cents
       OR expected_price_id IS DISTINCT FROM cycle_row.stripe_price_id
       OR expected_ends_at IS DISTINCT FROM cycle_row.ends_at
       OR lower(price_snapshot.currency) IS DISTINCT FROM lower(cycle_row.currency)
       OR payment_row.subscription_id IS DISTINCT FROM subscription_row.id
       OR payment_row.checkout_v2_cycle_id IS DISTINCT FROM cycle_row.id
       OR payment_row.status IS DISTINCT FROM 'succeeded'::public.payment_status
       OR payment_row.amount IS DISTINCT FROM cycle_row.amount_cents
       OR lower(payment_row.currency) IS DISTINCT FROM lower(cycle_row.currency)
       OR payment_row.amount_refunded IS DISTINCT FROM 0
       OR payment_row.stripe_invoice_id IS DISTINCT FROM cycle_row.stripe_invoice_id
       OR payment_row.stripe_payment_intent_id IS NULL
       OR subscription_row.stripe_subscription_id IS NULL
       OR (
            cycle_row.cycle_kind = 'initial'
            AND payment_row.stripe_invoice_id IS DISTINCT FROM subscription_row.stripe_invoice_id
       ) THEN
        eligibility_state := 'closed';
        eligibility_reason := 'contract_snapshot_invalid';
        RETURN NEXT;
        RETURN;
    END IF;

    SELECT
        COUNT(*)::INTEGER,
        COUNT(DISTINCT session.checkout_v2_cycle_session_index)::INTEGER,
        MIN(session.checkout_v2_cycle_session_index)::INTEGER,
        MAX(session.checkout_v2_cycle_session_index)::INTEGER
    INTO materialized_count, distinct_positions, minimum_position, maximum_position
    FROM private.checkout_v2_effective_cycle_sessions(cycle_row.id) AS session
    WHERE session.subscription_id = subscription_row.id;

    IF materialized_count IS DISTINCT FROM cycle_row.sessions_total::INTEGER
       OR distinct_positions IS DISTINCT FROM cycle_row.sessions_total::INTEGER
       OR minimum_position IS DISTINCT FROM 1
       OR maximum_position IS DISTINCT FROM cycle_row.sessions_total::INTEGER THEN
        eligibility_state := 'closed';
        eligibility_reason := 'cycle_sessions_invalid';
        RETURN NEXT;
        RETURN;
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.checkout_v2_reschedule_operations AS reschedule
        WHERE reschedule.subscription_id = p_subscription_id
          AND reschedule.cycle_id = cycle_row.id
          AND reschedule.status IN ('requested', 'manual_review')
    ) THEN
        eligibility_state := 'closed';
        eligibility_reason := 'reschedule_pending';
        RETURN NEXT;
        RETURN;
    END IF;

    FOR session_fact IN
        SELECT
            session.*,
            EXISTS (
                SELECT 1
                FROM public.checkout_v2_session_incident_resolutions AS resolution
                WHERE resolution.session_id = session.id
                  AND resolution.subscription_id = subscription_row.id
                  AND resolution.cycle_id = cycle_row.id
                  AND resolution.session_index = session.checkout_v2_cycle_session_index
                  AND resolution.resolution = 'excused'
            ) AS incident_excused,
            EXISTS (
                SELECT 1
                FROM public.checkout_v2_session_credit_adjustments AS adjustment
                WHERE adjustment.session_id = session.id
                  AND adjustment.subscription_id = subscription_row.id
                  AND adjustment.cycle_id = cycle_row.id
                  AND adjustment.session_index = session.checkout_v2_cycle_session_index
                  AND adjustment.effect = 'restored'
            ) AS adjustment_restored
        FROM private.checkout_v2_effective_cycle_sessions(cycle_row.id) AS session
        WHERE session.subscription_id = subscription_row.id
        ORDER BY session.checkout_v2_cycle_session_index
    LOOP
        IF session_fact.checkout_v2_cycle_session_index = 1 THEN
            first_session_id := session_fact.id;
        ELSIF session_fact.checkout_v2_cycle_session_index = 2 THEN
            second_session_id := session_fact.id;
        ELSIF session_fact.checkout_v2_cycle_session_index = 3 THEN
            third_session_id := session_fact.id;
        ELSIF session_fact.checkout_v2_cycle_session_index = 4 THEN
            fourth_session_id := session_fact.id;
        END IF;

        credit_restored := session_fact.incident_excused
            OR session_fact.adjustment_restored;
        late_student_cancellation := session_fact.status = 'cancelled'
            AND session_fact.scheduled_at IS NOT NULL
            AND session_fact.cancelled_at IS NOT NULL
            AND session_fact.cancelled_by = session_fact.student_id
            AND session_fact.scheduled_at
                < session_fact.cancelled_at + INTERVAL '24 hours';
        session_consumed := session_fact.status = 'completed'
            OR (
                (session_fact.status = 'no_show' OR late_student_cancellation)
                AND NOT credit_restored
            );

        IF session_fact.status = 'completed'
           AND (
                session_fact.scheduled_at IS NULL
                OR session_fact.completed_at IS NULL
                OR session_fact.completed_at < session_fact.scheduled_at
                    + pg_catalog.make_interval(mins => session_fact.duration_minutes)
                OR session_fact.completed_at > evaluated_at
           ) THEN
            eligibility_state := 'closed';
            eligibility_reason := 'completed_class_invalid';
            RETURN NEXT;
            RETURN;
        END IF;

        IF session_fact.status = 'scheduled'
           AND (
                session_fact.scheduled_at IS NULL
                OR evaluated_at >= session_fact.scheduled_at
           ) THEN
            eligibility_state := 'closed';
            eligibility_reason := 'next_class_started_or_state_stale';
            RETURN NEXT;
            RETURN;
        END IF;

        IF session_consumed THEN
            IF encountered_refundable THEN
                eligibility_state := 'closed';
                eligibility_reason := 'consumption_is_not_contiguous';
                RETURN NEXT;
                RETURN;
            END IF;
            consumed_count := consumed_count + 1;
        ELSE
            encountered_refundable := TRUE;
        END IF;
    END LOOP;

    sessions_consumed := consumed_count::SMALLINT;

    IF consumed_count = 0 THEN
        eligibility_state := 'not_started';
        eligibility_reason := 'no_class_consumed';
        refund_amount_cents := 0;
        RETURN NEXT;
        RETURN;
    END IF;

    IF consumed_count >= cycle_row.sessions_total THEN
        eligibility_state := 'closed';
        eligibility_reason := 'all_classes_consumed';
        refund_amount_cents := 0;
        RETURN NEXT;
        RETURN;
    END IF;

    refund_amount_cents := price_snapshot.session_base_amount_cents
        * (cycle_row.sessions_total - consumed_count)
        + GREATEST(price_snapshot.session_remainder_units - consumed_count, 0);

    IF refund_amount_cents <= 0
       OR refund_amount_cents >= cycle_row.amount_cents THEN
        eligibility_state := 'closed';
        eligibility_reason := 'refund_allocation_invalid';
        RETURN NEXT;
        RETURN;
    END IF;

    eligibility_state := 'eligible';
    eligibility_reason := 'eligible';
    RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION private.evaluate_checkout_v2_guarantee(UUID, UUID, BOOLEAN)
    FROM PUBLIC, anon, authenticated, service_role;

DROP FUNCTION public.get_checkout_v2_guarantee_state(UUID, UUID);

CREATE FUNCTION public.get_checkout_v2_guarantee_state(
    p_subscription_id UUID,
    p_actor_id UUID
)
RETURNS TABLE (
    subscription_id UUID,
    state TEXT,
    refund_amount_cents INTEGER,
    currency TEXT,
    operation_id UUID,
    reason TEXT,
    updated_at TIMESTAMPTZ,
    cycle_id UUID,
    sessions_total SMALLINT,
    sessions_consumed SMALLINT,
    sessions_refundable SMALLINT
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    subscription_row public.subscriptions%ROWTYPE;
    actor_role public.user_role;
    operation_row public.checkout_v2_guarantee_operations%ROWTYPE;
    evaluation RECORD;
BEGIN
    SELECT * INTO subscription_row
    FROM public.subscriptions AS subscription
    WHERE subscription.id = p_subscription_id;

    IF subscription_row.id IS NULL THEN
        RAISE EXCEPTION 'checkout_v2_guarantee_subscription_not_found'
            USING ERRCODE = 'P0002';
    END IF;

    SELECT profile.role INTO actor_role
    FROM public.profiles AS profile
    WHERE profile.id = p_actor_id;

    IF actor_role IS NULL
       OR NOT (
            actor_role = 'admin'::public.user_role
            OR (
                actor_role = 'student'::public.user_role
                AND p_actor_id = subscription_row.student_id
            )
       ) THEN
        RAISE EXCEPTION 'checkout_v2_guarantee_forbidden'
            USING ERRCODE = '42501';
    END IF;

    SELECT * INTO operation_row
    FROM public.checkout_v2_guarantee_operations AS operation
    WHERE operation.subscription_id = p_subscription_id;

    IF operation_row.id IS NOT NULL THEN
        subscription_id := operation_row.subscription_id;
        state := CASE operation_row.status
            WHEN 'requested' THEN 'processing'
            ELSE operation_row.status
        END;
        refund_amount_cents := operation_row.refund_amount_cents;
        currency := operation_row.currency;
        operation_id := operation_row.id;
        reason := COALESCE(operation_row.last_error, operation_row.status);
        updated_at := operation_row.updated_at;
        cycle_id := operation_row.cycle_id;
        sessions_total := operation_row.sessions_total;
        sessions_consumed := operation_row.sessions_consumed;
        sessions_refundable := (
            operation_row.sessions_total - operation_row.sessions_consumed
        )::SMALLINT;
        RETURN NEXT;
        RETURN;
    END IF;

    SELECT * INTO evaluation
    FROM private.evaluate_checkout_v2_guarantee(
        p_subscription_id,
        p_actor_id,
        FALSE
    );

    subscription_id := p_subscription_id;
    state := evaluation.eligibility_state;
    refund_amount_cents := COALESCE(evaluation.refund_amount_cents, 0);
    currency := COALESCE(evaluation.currency, 'eur');
    operation_id := NULL;
    reason := evaluation.eligibility_reason;
    updated_at := date_trunc('second', clock_timestamp());
    cycle_id := evaluation.cycle_id;
    sessions_total := evaluation.sessions_total;
    sessions_consumed := COALESCE(evaluation.sessions_consumed, 0)::SMALLINT;
    sessions_refundable := CASE
        WHEN evaluation.sessions_total IS NULL THEN 0
        ELSE GREATEST(
            evaluation.sessions_total - COALESCE(evaluation.sessions_consumed, 0),
            0
        )::SMALLINT
    END;
    RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.get_checkout_v2_guarantee_state(UUID, UUID)
    FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_checkout_v2_guarantee_state(UUID, UUID)
    TO service_role;

CREATE OR REPLACE FUNCTION public.prepare_checkout_v2_guarantee(
    p_request_id UUID,
    p_subscription_id UUID,
    p_actor_id UUID
)
RETURNS public.checkout_v2_guarantee_operations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    existing_operation public.checkout_v2_guarantee_operations%ROWTYPE;
    subscription_row public.subscriptions%ROWTYPE;
    actor_role public.user_role;
    evaluation RECORD;
    inserted_sessions INTEGER;
BEGIN
    IF p_request_id IS NULL OR p_subscription_id IS NULL OR p_actor_id IS NULL THEN
        RAISE EXCEPTION 'invalid_checkout_v2_guarantee_request'
            USING ERRCODE = '22023';
    END IF;

    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(p_subscription_id::TEXT, 42854)
    );

    SELECT * INTO subscription_row
    FROM public.subscriptions AS subscription
    WHERE subscription.id = p_subscription_id
    FOR UPDATE;

    IF subscription_row.id IS NULL THEN
        RAISE EXCEPTION 'checkout_v2_guarantee_subscription_not_found'
            USING ERRCODE = 'P0002';
    END IF;

    SELECT profile.role INTO actor_role
    FROM public.profiles AS profile
    WHERE profile.id = p_actor_id;

    IF actor_role IS DISTINCT FROM 'student'::public.user_role
       OR p_actor_id IS DISTINCT FROM subscription_row.student_id THEN
        RAISE EXCEPTION 'checkout_v2_guarantee_forbidden'
            USING ERRCODE = '42501';
    END IF;

    SELECT * INTO existing_operation
    FROM public.checkout_v2_guarantee_operations AS operation
    WHERE operation.request_id = p_request_id
    FOR UPDATE;

    IF existing_operation.id IS NOT NULL THEN
        IF existing_operation.subscription_id IS DISTINCT FROM p_subscription_id
           OR existing_operation.actor_id IS DISTINCT FROM p_actor_id THEN
            RAISE EXCEPTION 'checkout_v2_guarantee_request_id_conflicts'
                USING ERRCODE = '23505';
        END IF;
        RETURN existing_operation;
    END IF;

    SELECT * INTO existing_operation
    FROM public.checkout_v2_guarantee_operations AS operation
    WHERE operation.subscription_id = p_subscription_id
    FOR UPDATE;

    IF existing_operation.id IS NOT NULL THEN
        RETURN existing_operation;
    END IF;

    SELECT * INTO evaluation
    FROM private.evaluate_checkout_v2_guarantee(
        p_subscription_id,
        p_actor_id,
        TRUE
    );

    IF evaluation.eligibility_state IS DISTINCT FROM 'eligible' THEN
        RAISE EXCEPTION 'checkout_v2_guarantee_not_eligible:%',
            evaluation.eligibility_reason
            USING ERRCODE = '23514';
    END IF;

    INSERT INTO public.checkout_v2_guarantee_operations (
        request_id,
        subscription_id,
        cycle_id,
        payment_id,
        actor_id,
        first_session_id,
        second_session_id,
        third_session_id,
        fourth_session_id,
        package_price_id,
        cycle_number,
        sessions_total,
        sessions_consumed,
        session_base_amount_cents,
        session_remainder_units,
        stripe_customer_id,
        stripe_subscription_id,
        stripe_invoice_id,
        stripe_payment_intent_id,
        gross_amount_cents,
        refund_amount_cents,
        currency
    ) VALUES (
        p_request_id,
        evaluation.subscription_id,
        evaluation.cycle_id,
        evaluation.payment_id,
        p_actor_id,
        evaluation.first_session_id,
        evaluation.second_session_id,
        evaluation.third_session_id,
        evaluation.fourth_session_id,
        evaluation.package_price_id,
        evaluation.cycle_number,
        evaluation.sessions_total,
        evaluation.sessions_consumed,
        evaluation.session_base_amount_cents,
        evaluation.session_remainder_units,
        evaluation.stripe_customer_id,
        evaluation.stripe_subscription_id,
        evaluation.stripe_invoice_id,
        evaluation.stripe_payment_intent_id,
        evaluation.gross_amount_cents,
        evaluation.refund_amount_cents,
        evaluation.currency
    )
    RETURNING * INTO existing_operation;

    INSERT INTO public.checkout_v2_guarantee_operation_sessions (
        operation_id,
        session_id,
        cycle_id,
        session_index,
        amount_cents,
        was_consumed
    )
    SELECT
        existing_operation.id,
        session.id,
        existing_operation.cycle_id,
        session.checkout_v2_cycle_session_index,
        existing_operation.session_base_amount_cents
            + CASE
                WHEN session.checkout_v2_cycle_session_index
                    <= existing_operation.session_remainder_units THEN 1
                ELSE 0
              END,
        session.checkout_v2_cycle_session_index
            <= existing_operation.sessions_consumed
    FROM private.checkout_v2_effective_cycle_sessions(existing_operation.cycle_id) AS session
    WHERE session.subscription_id = existing_operation.subscription_id
    ORDER BY session.checkout_v2_cycle_session_index;

    GET DIAGNOSTICS inserted_sessions = ROW_COUNT;
    IF inserted_sessions IS DISTINCT FROM existing_operation.sessions_total::INTEGER THEN
        RAISE EXCEPTION 'checkout_v2_guarantee_session_snapshot_failed'
            USING ERRCODE = '40001';
    END IF;

    RETURN existing_operation;
END;
$$;

CREATE OR REPLACE FUNCTION public.excuse_checkout_v2_guarantee_incident(
    p_session_id UUID,
    p_admin_id UUID,
    p_reason TEXT
)
RETURNS public.checkout_v2_session_incident_resolutions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    discovered_subscription_id UUID;
    session_row public.sessions%ROWTYPE;
    subscription_row public.subscriptions%ROWTYPE;
    cycle_row public.checkout_v2_cycles%ROWTYPE;
    resolution_row public.checkout_v2_session_incident_resolutions%ROWTYPE;
    incident_at TIMESTAMPTZ;
BEGIN
    IF p_session_id IS NULL
       OR p_admin_id IS NULL
       OR NULLIF(btrim(p_reason), '') IS NULL
       OR char_length(btrim(p_reason)) NOT BETWEEN 5 AND 2000 THEN
        RAISE EXCEPTION 'invalid_checkout_v2_guarantee_incident_resolution'
            USING ERRCODE = '22023';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM public.profiles AS profile
        WHERE profile.id = p_admin_id
          AND profile.role = 'admin'::public.user_role
    ) THEN
        RAISE EXCEPTION 'checkout_v2_guarantee_incident_resolution_forbidden'
            USING ERRCODE = '42501';
    END IF;

    SELECT session.subscription_id INTO discovered_subscription_id
    FROM public.sessions AS session
    WHERE session.id = p_session_id;

    IF discovered_subscription_id IS NULL THEN
        RAISE EXCEPTION 'checkout_v2_guarantee_incident_session_not_found'
            USING ERRCODE = 'P0002';
    END IF;

    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(discovered_subscription_id::TEXT, 42854)
    );

    SELECT * INTO subscription_row
    FROM public.subscriptions AS subscription
    WHERE subscription.id = discovered_subscription_id
    FOR UPDATE;
    SELECT * INTO session_row
    FROM public.sessions AS session
    WHERE session.id = p_session_id
    FOR UPDATE;
    SELECT * INTO cycle_row
    FROM public.checkout_v2_cycles AS cycle
    WHERE cycle.id = session_row.checkout_v2_cycle_id
    FOR UPDATE;

    SELECT * INTO resolution_row
    FROM public.checkout_v2_session_incident_resolutions AS resolution
    WHERE resolution.session_id = p_session_id;

    IF resolution_row.id IS NOT NULL THEN
        RETURN resolution_row;
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.checkout_v2_guarantee_operations AS operation
        WHERE operation.subscription_id = discovered_subscription_id
    ) THEN
        RAISE EXCEPTION 'checkout_v2_guarantee_incident_resolution_after_request'
            USING ERRCODE = '23514';
    END IF;

    IF subscription_row.contract_schema_version IS DISTINCT FROM 2
       OR cycle_row.id IS NULL
       OR cycle_row.subscription_id IS DISTINCT FROM subscription_row.id
       OR cycle_row.materialization_state IS DISTINCT FROM 'ready'
       OR session_row.checkout_v2_cycle_id IS DISTINCT FROM cycle_row.id
       OR session_row.checkout_v2_cycle_session_index IS NULL
       OR session_row.checkout_v2_cycle_session_index > cycle_row.sessions_total
       OR NOT (
            session_row.status = 'no_show'
            OR (
                session_row.status = 'cancelled'
                AND session_row.cancelled_at IS NOT NULL
                AND session_row.cancelled_by = session_row.student_id
                AND session_row.scheduled_at
                    < session_row.cancelled_at + INTERVAL '24 hours'
            )
       ) THEN
        RAISE EXCEPTION 'checkout_v2_guarantee_incident_cannot_be_excused'
            USING ERRCODE = '23514';
    END IF;

    incident_at := CASE
        WHEN session_row.status = 'cancelled' THEN session_row.cancelled_at
        ELSE COALESCE(session_row.no_show_at, session_row.updated_at)
    END;

    INSERT INTO public.checkout_v2_session_incident_resolutions (
        session_id,
        subscription_id,
        cycle_id,
        session_index,
        original_status,
        original_scheduled_at,
        incident_at,
        admin_id,
        reason
    ) VALUES (
        session_row.id,
        subscription_row.id,
        cycle_row.id,
        session_row.checkout_v2_cycle_session_index,
        session_row.status,
        session_row.scheduled_at,
        incident_at,
        p_admin_id,
        btrim(p_reason)
    )
    RETURNING * INTO resolution_row;

    RETURN resolution_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_checkout_v2_guarantee_termination(
    p_operation_id UUID,
    p_worker_token UUID,
    p_stripe_cancelled_at TIMESTAMPTZ
)
RETURNS public.checkout_v2_guarantee_operations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    operation_row public.checkout_v2_guarantee_operations%ROWTYPE;
    subscription_row public.subscriptions%ROWTYPE;
    target_snapshot RECORD;
    applied_at TIMESTAMPTZ := date_trunc('second', clock_timestamp());
    job_payload JSONB;
    job_row public.fulfillment_jobs%ROWTYPE;
    snapshot_count INTEGER;
    snapshot_amount INTEGER;
    snapshot_consumed INTEGER;
BEGIN
    IF p_operation_id IS NULL
       OR p_worker_token IS NULL
       OR p_stripe_cancelled_at IS NULL
       OR NOT pg_catalog.isfinite(p_stripe_cancelled_at)
       OR date_trunc('second', p_stripe_cancelled_at) IS DISTINCT FROM p_stripe_cancelled_at THEN
        RAISE EXCEPTION 'invalid_checkout_v2_guarantee_termination'
            USING ERRCODE = '22023';
    END IF;

    operation_row := private.lock_checkout_v2_guarantee_operation(p_operation_id);

    IF operation_row.terminated_at IS NOT NULL THEN
        RETURN operation_row;
    END IF;

    IF operation_row.status IS DISTINCT FROM 'processing'
       OR operation_row.lease_token IS DISTINCT FROM p_worker_token
       OR operation_row.lease_expires_at <= applied_at
       OR operation_row.cancellation_started_at IS NULL
       OR p_stripe_cancelled_at
            < operation_row.cancellation_started_at - INTERVAL '5 minutes'
       OR p_stripe_cancelled_at > applied_at + INTERVAL '5 minutes' THEN
        RAISE EXCEPTION 'checkout_v2_guarantee_termination_state_conflicts'
            USING ERRCODE = '40001';
    END IF;

    SELECT * INTO subscription_row
    FROM public.subscriptions AS subscription
    WHERE subscription.id = operation_row.subscription_id;

    SELECT
        COUNT(*)::INTEGER,
        COALESCE(SUM(snapshot.amount_cents), 0)::INTEGER,
        COUNT(*) FILTER (WHERE snapshot.was_consumed)::INTEGER
    INTO snapshot_count, snapshot_amount, snapshot_consumed
    FROM public.checkout_v2_guarantee_operation_sessions AS snapshot
    WHERE snapshot.operation_id = operation_row.id;

    IF subscription_row.id IS NULL
       OR subscription_row.contract_schema_version IS DISTINCT FROM 2
       OR subscription_row.stripe_subscription_id IS DISTINCT FROM
            operation_row.stripe_subscription_id
       OR snapshot_count IS DISTINCT FROM operation_row.sessions_total::INTEGER
       OR snapshot_amount IS DISTINCT FROM operation_row.gross_amount_cents
       OR snapshot_consumed IS DISTINCT FROM operation_row.sessions_consumed::INTEGER
       OR EXISTS (
            SELECT 1
            FROM public.checkout_v2_guarantee_operation_sessions AS snapshot
            JOIN public.sessions AS session ON session.id = snapshot.session_id
            WHERE snapshot.operation_id = operation_row.id
              AND (
                    session.subscription_id IS DISTINCT FROM operation_row.subscription_id
                    OR session.checkout_v2_cycle_id IS DISTINCT FROM operation_row.cycle_id
                    OR session.checkout_v2_cycle_session_index IS DISTINCT FROM snapshot.session_index
              )
       ) THEN
        RAISE EXCEPTION 'checkout_v2_guarantee_termination_state_conflicts'
            USING ERRCODE = '40001';
    END IF;

    PERFORM pg_catalog.set_config(
        'app.checkout_v2_guarantee_operation_id',
        operation_row.id::TEXT,
        TRUE
    );

    FOR target_snapshot IN
        SELECT
            snapshot.session_id,
            snapshot.session_index,
            snapshot.was_consumed,
            session.status,
            session.student_id,
            session.scheduled_at,
            session.cancelled_at,
            session.cancelled_by
        FROM public.checkout_v2_guarantee_operation_sessions AS snapshot
        JOIN public.sessions AS session ON session.id = snapshot.session_id
        WHERE snapshot.operation_id = operation_row.id
          AND NOT snapshot.was_consumed
        ORDER BY snapshot.session_index
    LOOP
        IF target_snapshot.status = 'scheduled' THEN
            UPDATE public.sessions
            SET
                status = 'cancelled',
                cancelled_at = applied_at,
                cancelled_by = operation_row.actor_id,
                cancellation_reason = 'guarantee_refund',
                updated_at = applied_at
            WHERE id = target_snapshot.session_id
              AND status = 'scheduled';

            IF NOT FOUND THEN
                RAISE EXCEPTION 'checkout_v2_guarantee_session_state_conflicts'
                    USING ERRCODE = '40001';
            END IF;

            job_payload := pg_catalog.jsonb_build_object(
                'sessionId', target_snapshot.session_id,
                'cancelledBy', 'guarantee',
                'reason', 'guarantee_refund',
                'sendEmail', FALSE
            );

            INSERT INTO public.fulfillment_jobs (
                job_type,
                session_id,
                subscription_id,
                student_id,
                dedupe_key,
                payload
            ) VALUES (
                'session_cancellation',
                target_snapshot.session_id,
                operation_row.subscription_id,
                subscription_row.student_id,
                'session_cancellation:' || target_snapshot.session_id::TEXT,
                job_payload
            )
            ON CONFLICT (job_type, dedupe_key)
                WHERE dedupe_key IS NOT NULL
                DO NOTHING;

            SELECT * INTO job_row
            FROM public.fulfillment_jobs AS job
            WHERE job.job_type = 'session_cancellation'
              AND job.dedupe_key =
                    'session_cancellation:' || target_snapshot.session_id::TEXT;

            IF job_row.id IS NULL
               OR job_row.session_id IS DISTINCT FROM target_snapshot.session_id
               OR job_row.subscription_id IS DISTINCT FROM operation_row.subscription_id
               OR job_row.student_id IS DISTINCT FROM subscription_row.student_id
               OR job_row.payload IS DISTINCT FROM job_payload THEN
                RAISE EXCEPTION 'checkout_v2_guarantee_cancellation_job_conflicts'
                    USING ERRCODE = '23505';
            END IF;
        ELSIF target_snapshot.status IN ('cancelled', 'no_show')
          AND (
                EXISTS (
                    SELECT 1
                    FROM public.checkout_v2_session_incident_resolutions AS resolution
                    WHERE resolution.session_id = target_snapshot.session_id
                      AND resolution.resolution = 'excused'
                )
                OR EXISTS (
                    SELECT 1
                    FROM public.checkout_v2_session_credit_adjustments AS adjustment
                    WHERE adjustment.session_id = target_snapshot.session_id
                      AND adjustment.effect = 'restored'
                )
                OR (
                    target_snapshot.status = 'cancelled'
                    AND target_snapshot.cancelled_at IS NOT NULL
                    AND (
                        target_snapshot.cancelled_by IS DISTINCT FROM target_snapshot.student_id
                        OR target_snapshot.scheduled_at
                            >= target_snapshot.cancelled_at + INTERVAL '24 hours'
                    )
                )
          ) THEN
            NULL;
        ELSE
            RAISE EXCEPTION 'checkout_v2_guarantee_session_state_conflicts'
                USING ERRCODE = '40001';
        END IF;
    END LOOP;

    UPDATE public.subscriptions
    SET
        status = 'cancelled'::public.subscription_status,
        sessions_used = operation_row.sessions_consumed,
        updated_at = applied_at
    WHERE id = operation_row.subscription_id
      AND status IN (
            'active'::public.subscription_status,
            'paused'::public.subscription_status,
            'cancelled'::public.subscription_status
      );

    IF NOT FOUND THEN
        RAISE EXCEPTION 'checkout_v2_guarantee_subscription_state_conflicts'
            USING ERRCODE = '40001';
    END IF;

    UPDATE public.checkout_v2_guarantee_operations
    SET
        stripe_cancelled_at = p_stripe_cancelled_at,
        terminated_at = applied_at
    WHERE id = p_operation_id
    RETURNING * INTO operation_row;

    RETURN operation_row;
END;
$$;

CREATE OR REPLACE FUNCTION private.guard_checkout_v2_guarantee_refund_provenance()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    guarantee_operation_id TEXT := NULLIF(
        pg_catalog.current_setting('app.checkout_v2_guarantee_operation_id', TRUE),
        ''
    );
BEGIN
    IF NEW.cancellation_reason IS DISTINCT FROM 'guarantee_refund' THEN
        RETURN NEW;
    END IF;

    IF TG_OP IS DISTINCT FROM 'UPDATE' THEN
        RAISE EXCEPTION 'checkout_v2_guarantee_refund_provenance_is_invalid'
            USING ERRCODE = '23514';
    END IF;

    IF OLD.status IS DISTINCT FROM 'scheduled'
       OR NEW.status IS DISTINCT FROM 'cancelled'
       OR NEW.cancelled_at IS NULL
       OR NEW.cancelled_by IS DISTINCT FROM NEW.student_id
       OR guarantee_operation_id IS NULL
       OR NOT EXISTS (
            SELECT 1
            FROM public.checkout_v2_guarantee_operations AS operation
            JOIN public.checkout_v2_guarantee_operation_sessions AS snapshot
              ON snapshot.operation_id = operation.id
             AND snapshot.session_id = NEW.id
             AND NOT snapshot.was_consumed
            WHERE operation.id::TEXT = guarantee_operation_id
              AND operation.subscription_id = NEW.subscription_id
              AND operation.cycle_id = NEW.checkout_v2_cycle_id
              AND operation.actor_id = NEW.student_id
              AND operation.status = 'processing'
              AND operation.cancellation_started_at IS NOT NULL
              AND operation.terminated_at IS NULL
       ) THEN
        RAISE EXCEPTION 'checkout_v2_guarantee_refund_provenance_is_invalid'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

CREATE OR REPLACE VIEW public.checkout_v2_session_consumption
WITH (security_invoker = true)
AS
SELECT
    session.id AS session_id,
    session.subscription_id,
    session.checkout_v2_cycle_id AS cycle_id,
    cycle.cycle_number,
    session.checkout_v2_cycle_session_index AS session_index,
    session.status AS session_status,
    session.scheduled_at,
    session.completed_at,
    session.no_show_at,
    session.cancelled_at,
    session.cancelled_by,
    session.cancellation_reason,
    CASE
        WHEN guarantee_operation.id IS NOT NULL THEN 'guarantee_refund_cancellation'
        WHEN COALESCE(incident.status, session.status) = 'completed' THEN 'completed'
        WHEN COALESCE(incident.status, session.status) = 'no_show' THEN 'no_show'
        WHEN COALESCE(incident.status, session.status) = 'cancelled'
             AND COALESCE(incident.cancelled_by, session.cancelled_by)
                 = COALESCE(incident.student_id, session.student_id)
             AND COALESCE(incident.scheduled_at, session.scheduled_at)
                 < COALESCE(incident.cancelled_at, session.cancelled_at) + INTERVAL '24 hours'
            THEN 'late_student_cancellation'
        WHEN COALESCE(incident.status, session.status) = 'cancelled'
             AND COALESCE(incident.cancelled_by, session.cancelled_by)
                 = COALESCE(incident.student_id, session.student_id)
            THEN 'timely_student_cancellation'
        WHEN COALESCE(incident.status, session.status) = 'cancelled'
            THEN 'non_student_cancellation'
        ELSE 'scheduled'
    END AS original_consumption_kind,
    guarantee_operation.id IS NULL AND (
        COALESCE(incident.status, session.status) IN ('completed', 'no_show') OR (
            COALESCE(incident.status, session.status) = 'cancelled'
            AND COALESCE(incident.cancelled_by, session.cancelled_by)
                = COALESCE(incident.student_id, session.student_id)
            AND COALESCE(incident.scheduled_at, session.scheduled_at)
                < COALESCE(incident.cancelled_at, session.cancelled_at) + INTERVAL '24 hours'
        )
    ) AS original_student_credit_consumed,
    adjustment.id AS credit_adjustment_id,
    adjustment.request_id AS credit_adjustment_request_id,
    adjustment.created_at AS credit_restored_at,
    adjustment.id IS NOT NULL AS credit_restored,
    guarantee_operation.id IS NULL AND (
        session.status IN ('completed', 'no_show') OR (
            session.status = 'cancelled'
            AND session.cancelled_by = session.student_id
            AND session.scheduled_at < session.cancelled_at + INTERVAL '24 hours'
        )
    ) AND NOT (
        adjustment.id IS NOT NULL
        AND adjustment.session_id = session.id
    ) AS student_credit_consumed,
    CASE
        WHEN guarantee_operation.id IS NOT NULL
            THEN 'guarantee_refund_cancellation'
        WHEN adjustment.id IS NOT NULL
             AND adjustment.session_id = session.id
             AND session.status = 'no_show'
            THEN 'restored_no_show'
        WHEN adjustment.id IS NOT NULL
             AND adjustment.session_id = session.id
            THEN 'restored_late_student_cancellation'
        WHEN session.status = 'completed' THEN 'completed'
        WHEN session.status = 'no_show' THEN 'no_show'
        WHEN session.status = 'cancelled' AND session.cancelled_by = session.student_id
             AND session.scheduled_at < session.cancelled_at + INTERVAL '24 hours'
            THEN 'late_student_cancellation'
        WHEN session.status = 'cancelled' AND session.cancelled_by = session.student_id
            THEN 'timely_student_cancellation'
        WHEN session.status = 'cancelled' THEN 'non_student_cancellation'
        ELSE 'scheduled'
    END AS consumption_kind
FROM public.checkout_v2_cycles AS cycle
CROSS JOIN LATERAL private.checkout_v2_effective_cycle_sessions(cycle.id) AS session
LEFT JOIN LATERAL (
    WITH RECURSIVE ancestry AS (
        SELECT
            session.id,
            session.checkout_v2_replaces_session_id,
            session.checkout_v2_replacement_credit_adjustment_id,
            0 AS ancestor_depth

        UNION ALL

        SELECT
            predecessor.id,
            predecessor.checkout_v2_replaces_session_id,
            predecessor.checkout_v2_replacement_credit_adjustment_id,
            ancestry.ancestor_depth + 1
        FROM ancestry
        JOIN public.sessions AS predecessor
          ON predecessor.id = ancestry.checkout_v2_replaces_session_id
    )
    SELECT adjustment_row.*
    FROM ancestry
    JOIN public.checkout_v2_session_credit_adjustments AS adjustment_row
      ON adjustment_row.id = ancestry.checkout_v2_replacement_credit_adjustment_id
      OR adjustment_row.session_id = ancestry.id
    ORDER BY
        (adjustment_row.id = ancestry.checkout_v2_replacement_credit_adjustment_id) DESC,
        ancestry.ancestor_depth ASC,
        adjustment_row.created_at DESC,
        adjustment_row.id DESC
    LIMIT 1
) AS adjustment ON TRUE
LEFT JOIN public.sessions AS predecessor
  ON predecessor.id = session.checkout_v2_replaces_session_id
LEFT JOIN public.sessions AS incident
  ON incident.id = COALESCE(adjustment.session_id, predecessor.id)
LEFT JOIN public.checkout_v2_guarantee_operation_sessions AS guarantee_snapshot
  ON guarantee_snapshot.session_id = session.id
 AND NOT guarantee_snapshot.was_consumed
LEFT JOIN public.checkout_v2_guarantee_operations AS guarantee_operation
  ON guarantee_operation.id = guarantee_snapshot.operation_id
 AND guarantee_operation.subscription_id = session.subscription_id
 AND guarantee_operation.cycle_id = session.checkout_v2_cycle_id
 AND guarantee_operation.actor_id = session.student_id
 AND guarantee_operation.terminated_at IS NOT NULL;

CREATE OR REPLACE FUNCTION public.observe_checkout_v2_guarantee_refund(
    p_operation_id UUID,
    p_stripe_refund_id TEXT,
    p_refund_status TEXT,
    p_refund_created_at TIMESTAMPTZ,
    p_amount_cents INTEGER,
    p_currency TEXT,
    p_stripe_payment_intent_id TEXT
)
RETURNS public.checkout_v2_guarantee_operations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    operation_row public.checkout_v2_guarantee_operations%ROWTYPE;
    payment_row public.payments%ROWTYPE;
    observed_at TIMESTAMPTZ := date_trunc('second', clock_timestamp());
    job_payload JSONB;
    job_row public.fulfillment_jobs%ROWTYPE;
    ticket_id UUID;
BEGIN
    IF p_operation_id IS NULL
       OR p_stripe_refund_id IS NULL
       OR p_stripe_refund_id !~ '^re_[A-Za-z0-9_]+$'
       OR p_refund_status NOT IN (
            'pending', 'requires_action', 'succeeded', 'failed', 'canceled'
       )
       OR p_refund_created_at IS NULL
       OR NOT pg_catalog.isfinite(p_refund_created_at)
       OR date_trunc('second', p_refund_created_at) IS DISTINCT FROM p_refund_created_at
       OR p_refund_created_at > observed_at + INTERVAL '5 minutes'
       OR p_amount_cents IS NULL
       OR p_amount_cents <= 0
       OR lower(p_currency) !~ '^[a-z]{3}$'
       OR p_stripe_payment_intent_id IS NULL
       OR p_stripe_payment_intent_id !~ '^pi_[A-Za-z0-9_]+$' THEN
        RAISE EXCEPTION 'invalid_checkout_v2_guarantee_refund_observation'
            USING ERRCODE = '22023';
    END IF;

    operation_row := private.lock_checkout_v2_guarantee_operation(p_operation_id);

    IF operation_row.refund_amount_cents IS DISTINCT FROM p_amount_cents
       OR operation_row.currency IS DISTINCT FROM lower(p_currency)
       OR operation_row.stripe_payment_intent_id IS DISTINCT FROM
            p_stripe_payment_intent_id THEN
        RAISE EXCEPTION 'checkout_v2_guarantee_refund_state_conflicts'
            USING ERRCODE = '40001';
    END IF;

    IF operation_row.status = 'refunded' THEN
        IF operation_row.stripe_refund_id IS DISTINCT FROM p_stripe_refund_id
           OR operation_row.refund_created_at IS DISTINCT FROM p_refund_created_at THEN
            RAISE EXCEPTION 'checkout_v2_guarantee_refund_replay_conflicts'
                USING ERRCODE = '23505';
        END IF;
        RETURN operation_row;
    END IF;

    IF operation_row.status = 'manual_review'
       AND operation_row.refund_status IN ('failed', 'canceled')
       AND p_refund_status IN ('pending', 'requires_action') THEN
        IF operation_row.stripe_refund_id IS DISTINCT FROM p_stripe_refund_id
           OR operation_row.refund_created_at IS DISTINCT FROM p_refund_created_at THEN
            RAISE EXCEPTION 'checkout_v2_guarantee_refund_replay_conflicts'
                USING ERRCODE = '23505';
        END IF;
        RETURN operation_row;
    END IF;

    IF operation_row.terminated_at IS NULL
       OR operation_row.refund_started_at IS NULL
       OR (
            operation_row.stripe_refund_id IS NOT NULL
            AND operation_row.stripe_refund_id IS DISTINCT FROM p_stripe_refund_id
       ) THEN
        RAISE EXCEPTION 'checkout_v2_guarantee_refund_state_conflicts'
            USING ERRCODE = '40001';
    END IF;

    IF p_refund_status IN ('pending', 'requires_action') THEN
        UPDATE public.checkout_v2_guarantee_operations
        SET
            status = 'refund_pending',
            stripe_refund_id = p_stripe_refund_id,
            refund_status = p_refund_status,
            refund_created_at = p_refund_created_at,
            lease_token = NULL,
            lease_expires_at = NULL,
            last_error = NULL
        WHERE id = p_operation_id
        RETURNING * INTO operation_row;
        RETURN operation_row;
    END IF;

    IF p_refund_status IN ('failed', 'canceled') THEN
        ticket_id := private.ensure_checkout_v2_guarantee_support_ticket(
            p_operation_id,
            'stripe_refund_' || p_refund_status
        );

        UPDATE public.checkout_v2_guarantee_operations
        SET
            status = 'manual_review',
            stripe_refund_id = p_stripe_refund_id,
            refund_status = p_refund_status,
            refund_created_at = p_refund_created_at,
            support_ticket_id = ticket_id,
            lease_token = NULL,
            lease_expires_at = NULL,
            last_error = 'stripe_refund_' || p_refund_status
        WHERE id = p_operation_id
        RETURNING * INTO operation_row;
        RETURN operation_row;
    END IF;

    SELECT * INTO payment_row
    FROM public.payments AS payment
    WHERE payment.id = operation_row.payment_id;

    IF payment_row.id IS NULL
       OR payment_row.stripe_payment_intent_id IS DISTINCT FROM
            operation_row.stripe_payment_intent_id
       OR payment_row.amount IS DISTINCT FROM operation_row.gross_amount_cents
       OR lower(payment_row.currency) IS DISTINCT FROM operation_row.currency
       OR payment_row.amount_refunded NOT IN (0, operation_row.refund_amount_cents) THEN
        RAISE EXCEPTION 'checkout_v2_guarantee_payment_reconciliation_conflicts'
            USING ERRCODE = '40001';
    END IF;

    PERFORM pg_catalog.set_config(
        'app.checkout_v2_guarantee_operation_id',
        operation_row.id::TEXT,
        TRUE
    );

    PERFORM public.reconcile_stripe_refund(
        operation_row.payment_id,
        operation_row.refund_amount_cents,
        p_stripe_refund_id,
        p_refund_created_at
    );

    job_payload := pg_catalog.jsonb_build_object(
        'operationId', operation_row.id,
        'refundAmount', operation_row.refund_amount_cents,
        'currency', operation_row.currency,
        'cycleNumber', operation_row.cycle_number,
        'sessionsTotal', operation_row.sessions_total,
        'sessionsConsumed', operation_row.sessions_consumed,
        'sessionsRefundable',
            operation_row.sessions_total - operation_row.sessions_consumed,
        'sendEmail', TRUE
    );

    INSERT INTO public.fulfillment_jobs (
        job_type,
        subscription_id,
        student_id,
        dedupe_key,
        payload
    )
    SELECT
        'guarantee_refund',
        operation_row.subscription_id,
        subscription.student_id,
        'guarantee_refund:' || operation_row.id::TEXT,
        job_payload
    FROM public.subscriptions AS subscription
    WHERE subscription.id = operation_row.subscription_id
    ON CONFLICT (job_type, dedupe_key)
        WHERE dedupe_key IS NOT NULL
        DO NOTHING;

    SELECT * INTO job_row
    FROM public.fulfillment_jobs AS job
    WHERE job.job_type = 'guarantee_refund'
      AND job.dedupe_key = 'guarantee_refund:' || operation_row.id::TEXT;

    IF job_row.id IS NULL
       OR job_row.subscription_id IS DISTINCT FROM operation_row.subscription_id
       OR job_row.student_id IS DISTINCT FROM operation_row.actor_id
       OR job_row.payload IS DISTINCT FROM job_payload THEN
        RAISE EXCEPTION 'checkout_v2_guarantee_refund_job_conflicts'
            USING ERRCODE = '23505';
    END IF;

    UPDATE public.checkout_v2_guarantee_operations
    SET
        status = 'refunded',
        stripe_refund_id = p_stripe_refund_id,
        refund_status = 'succeeded',
        refund_created_at = p_refund_created_at,
        refunded_at = observed_at,
        lease_token = NULL,
        lease_expires_at = NULL,
        last_error = NULL
    WHERE id = p_operation_id
    RETURNING * INTO operation_row;

    RETURN operation_row;
END;
$$;
