-- Checkout V2 guarantee: durable eligibility, Stripe saga and local termination.
-- Every mutation is mediated by service-role-only RPCs. The immutable sale
-- snapshot lets retries verify Stripe without consulting mutable identities.

ALTER TABLE public.fulfillment_jobs
    DROP CONSTRAINT IF EXISTS fulfillment_jobs_job_type_check;

ALTER TABLE public.fulfillment_jobs
    ADD CONSTRAINT fulfillment_jobs_job_type_check
    CHECK (job_type IN (
        'session_fulfillment',
        'bulk_session_fulfillment',
        'welcome_fulfillment',
        'session_cancellation',
        'session_reschedule',
        'guarantee_refund',
        'renewal_notice'
    ));

CREATE TABLE public.checkout_v2_guarantee_operations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id UUID NOT NULL UNIQUE,
    subscription_id UUID NOT NULL UNIQUE
        REFERENCES public.subscriptions(id) ON DELETE RESTRICT,
    cycle_id UUID NOT NULL UNIQUE
        REFERENCES public.checkout_v2_cycles(id) ON DELETE RESTRICT,
    payment_id UUID NOT NULL UNIQUE
        REFERENCES public.payments(id) ON DELETE RESTRICT,
    actor_id UUID NOT NULL
        REFERENCES public.profiles(id) ON DELETE RESTRICT,
    first_session_id UUID NOT NULL UNIQUE
        REFERENCES public.sessions(id) ON DELETE RESTRICT,
    second_session_id UUID NOT NULL UNIQUE
        REFERENCES public.sessions(id) ON DELETE RESTRICT,
    third_session_id UUID NOT NULL UNIQUE
        REFERENCES public.sessions(id) ON DELETE RESTRICT,
    fourth_session_id UUID NOT NULL UNIQUE
        REFERENCES public.sessions(id) ON DELETE RESTRICT,
    stripe_customer_id TEXT NOT NULL
        CHECK (stripe_customer_id ~ '^cus_[A-Za-z0-9_]+$'),
    stripe_subscription_id TEXT NOT NULL
        CHECK (stripe_subscription_id ~ '^sub_[A-Za-z0-9_]+$'),
    stripe_invoice_id TEXT NOT NULL
        CHECK (stripe_invoice_id ~ '^in_[A-Za-z0-9_]+$'),
    stripe_payment_intent_id TEXT NOT NULL
        CHECK (stripe_payment_intent_id ~ '^pi_[A-Za-z0-9_]+$'),
    gross_amount_cents INTEGER NOT NULL CHECK (gross_amount_cents = 25900),
    refund_amount_cents INTEGER NOT NULL CHECK (refund_amount_cents = 19425),
    currency TEXT NOT NULL CHECK (currency = 'eur'),
    status TEXT NOT NULL DEFAULT 'requested'
        CHECK (status IN (
            'requested',
            'processing',
            'refund_pending',
            'refunded',
            'retryable',
            'manual_review'
        )),
    lease_token UUID,
    lease_expires_at TIMESTAMPTZ,
    claimed_at TIMESTAMPTZ,
    cancellation_started_at TIMESTAMPTZ,
    stripe_cancelled_at TIMESTAMPTZ,
    terminated_at TIMESTAMPTZ,
    refund_started_at TIMESTAMPTZ,
    stripe_refund_id TEXT UNIQUE CHECK (
        stripe_refund_id IS NULL OR stripe_refund_id ~ '^re_[A-Za-z0-9_]+$'
    ),
    refund_status TEXT CHECK (
        refund_status IS NULL
        OR refund_status IN ('pending', 'requires_action', 'succeeded', 'failed', 'canceled')
    ),
    refund_created_at TIMESTAMPTZ,
    refunded_at TIMESTAMPTZ,
    support_ticket_id UUID UNIQUE
        REFERENCES public.support_tickets(id) ON DELETE RESTRICT,
    last_error TEXT CHECK (
        last_error IS NULL OR char_length(last_error) BETWEEN 1 AND 2000
    ),
    created_at TIMESTAMPTZ NOT NULL DEFAULT date_trunc('second', clock_timestamp()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT date_trunc('second', clock_timestamp()),
    CONSTRAINT checkout_v2_guarantee_distinct_sessions CHECK (
        first_session_id <> second_session_id
        AND first_session_id <> third_session_id
        AND first_session_id <> fourth_session_id
        AND second_session_id <> third_session_id
        AND second_session_id <> fourth_session_id
        AND third_session_id <> fourth_session_id
    ),
    CONSTRAINT checkout_v2_guarantee_refund_shape CHECK (
        (stripe_refund_id IS NULL AND refund_status IS NULL AND refund_created_at IS NULL)
        OR
        (stripe_refund_id IS NOT NULL AND refund_status IS NOT NULL AND refund_created_at IS NOT NULL)
    ),
    CONSTRAINT checkout_v2_guarantee_lease_shape CHECK (
        (lease_token IS NULL AND lease_expires_at IS NULL)
        OR (lease_token IS NOT NULL AND lease_expires_at IS NOT NULL AND claimed_at IS NOT NULL)
    ),
    CONSTRAINT checkout_v2_guarantee_external_order CHECK (
        (stripe_cancelled_at IS NULL OR cancellation_started_at IS NOT NULL)
        AND (terminated_at IS NULL OR stripe_cancelled_at IS NOT NULL)
        AND (refund_started_at IS NULL OR terminated_at IS NOT NULL)
        AND (refunded_at IS NULL OR refund_started_at IS NOT NULL)
    ),
    CONSTRAINT checkout_v2_guarantee_terminal_shape CHECK (
        status <> 'refunded'
        OR (
            refund_status = 'succeeded'
            AND stripe_refund_id IS NOT NULL
            AND refund_created_at IS NOT NULL
            AND refunded_at IS NOT NULL
            AND terminated_at IS NOT NULL
            AND refund_started_at IS NOT NULL
            AND lease_token IS NULL
            AND lease_expires_at IS NULL
            AND last_error IS NULL
        )
    ),
    CONSTRAINT checkout_v2_guarantee_pending_shape CHECK (
        status <> 'refund_pending'
        OR (
            refund_status IN ('pending', 'requires_action')
            AND refund_started_at IS NOT NULL
            AND terminated_at IS NOT NULL
            AND lease_token IS NULL
            AND lease_expires_at IS NULL
        )
    ),
    CONSTRAINT checkout_v2_guarantee_review_shape CHECK (
        status NOT IN ('retryable', 'manual_review') OR last_error IS NOT NULL
    ),
    CONSTRAINT checkout_v2_guarantee_timestamp_order CHECK (
        updated_at >= created_at
        AND (claimed_at IS NULL OR claimed_at >= created_at)
        AND (cancellation_started_at IS NULL OR cancellation_started_at >= created_at)
        AND (
            stripe_cancelled_at IS NULL
            OR stripe_cancelled_at >= created_at - INTERVAL '5 minutes'
        )
        AND (terminated_at IS NULL OR terminated_at >= created_at)
        AND (refund_started_at IS NULL OR refund_started_at >= created_at)
        AND (
            refund_created_at IS NULL
            OR refund_created_at >= created_at - INTERVAL '5 minutes'
        )
        AND (refunded_at IS NULL OR refunded_at >= created_at)
    )
);

CREATE INDEX checkout_v2_guarantee_operations_status_idx
    ON public.checkout_v2_guarantee_operations(status, updated_at, id)
    WHERE status <> 'refunded';

ALTER TABLE public.checkout_v2_guarantee_operations ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.checkout_v2_session_incident_resolutions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL UNIQUE
        REFERENCES public.sessions(id) ON DELETE RESTRICT,
    subscription_id UUID NOT NULL
        REFERENCES public.subscriptions(id) ON DELETE RESTRICT,
    cycle_id UUID NOT NULL
        REFERENCES public.checkout_v2_cycles(id) ON DELETE RESTRICT,
    session_index SMALLINT NOT NULL CHECK (session_index = 2),
    original_status TEXT NOT NULL CHECK (original_status IN ('cancelled', 'no_show')),
    original_scheduled_at TIMESTAMPTZ NOT NULL,
    incident_at TIMESTAMPTZ NOT NULL,
    resolution TEXT NOT NULL DEFAULT 'excused' CHECK (resolution = 'excused'),
    admin_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    reason TEXT NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 5 AND 2000),
    created_at TIMESTAMPTZ NOT NULL DEFAULT date_trunc('second', clock_timestamp())
);

CREATE INDEX checkout_v2_session_incident_resolutions_subscription_idx
    ON public.checkout_v2_session_incident_resolutions(subscription_id, created_at DESC);

ALTER TABLE public.checkout_v2_session_incident_resolutions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.checkout_v2_guarantee_operations
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.checkout_v2_session_incident_resolutions
    FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.checkout_v2_guarantee_operations TO service_role;
GRANT SELECT ON TABLE public.checkout_v2_session_incident_resolutions TO service_role;

CREATE OR REPLACE FUNCTION private.guard_checkout_v2_guarantee_operation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
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

    NEW.updated_at := date_trunc('second', clock_timestamp());
    RETURN NEW;
END;
$$;

CREATE TRIGGER guard_checkout_v2_guarantee_operation_trigger
    BEFORE UPDATE OR DELETE ON public.checkout_v2_guarantee_operations
    FOR EACH ROW EXECUTE FUNCTION private.guard_checkout_v2_guarantee_operation();

CREATE OR REPLACE FUNCTION private.guard_checkout_v2_incident_resolution()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    RAISE EXCEPTION 'checkout_v2_incident_resolution_is_immutable'
        USING ERRCODE = '23514';
END;
$$;

CREATE TRIGGER guard_checkout_v2_incident_resolution_trigger
    BEFORE UPDATE OR DELETE ON public.checkout_v2_session_incident_resolutions
    FOR EACH ROW EXECUTE FUNCTION private.guard_checkout_v2_incident_resolution();

CREATE OR REPLACE FUNCTION private.lock_checkout_v2_guarantee_operation(
    p_operation_id UUID
)
RETURNS public.checkout_v2_guarantee_operations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    operation_row public.checkout_v2_guarantee_operations%ROWTYPE;
BEGIN
    SELECT * INTO operation_row
    FROM public.checkout_v2_guarantee_operations AS guarantee_operation
    WHERE guarantee_operation.id = p_operation_id;

    IF operation_row.id IS NULL THEN
        RAISE EXCEPTION 'checkout_v2_guarantee_operation_not_found'
            USING ERRCODE = 'P0002';
    END IF;

    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(operation_row.subscription_id::TEXT, 42854)
    );

    PERFORM 1 FROM public.subscriptions AS subscription
    WHERE subscription.id = operation_row.subscription_id FOR UPDATE;
    PERFORM 1 FROM public.checkout_v2_billing_state AS billing_state
    WHERE billing_state.subscription_id = operation_row.subscription_id FOR UPDATE;
    PERFORM 1 FROM public.checkout_v2_cycles AS cycle
    WHERE cycle.id = operation_row.cycle_id FOR UPDATE;
    PERFORM 1 FROM public.payments AS payment
    WHERE payment.id = operation_row.payment_id FOR UPDATE;
    PERFORM 1
    FROM public.sessions
    WHERE checkout_v2_cycle_id = operation_row.cycle_id
    ORDER BY checkout_v2_cycle_session_index, id
    FOR UPDATE;

    SELECT * INTO operation_row
    FROM public.checkout_v2_guarantee_operations AS guarantee_operation
    WHERE guarantee_operation.id = p_operation_id
    FOR UPDATE;

    RETURN operation_row;
END;
$$;

CREATE OR REPLACE FUNCTION private.evaluate_checkout_v2_guarantee(
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
    billing_row public.checkout_v2_billing_state%ROWTYPE;
    cycle_row public.checkout_v2_cycles%ROWTYPE;
    payment_row public.payments%ROWTYPE;
    first_session public.sessions%ROWTYPE;
    second_session public.sessions%ROWTYPE;
    third_session public.sessions%ROWTYPE;
    fourth_session public.sessions%ROWTYPE;
    intent_row public.checkout_intents%ROWTYPE;
    price_snapshot public.checkout_v2_price_snapshots%ROWTYPE;
    second_excused BOOLEAN := FALSE;
    third_consumed BOOLEAN := TRUE;
    fourth_consumed BOOLEAN := TRUE;
BEGIN
    IF p_subscription_id IS NULL OR p_actor_id IS NULL THEN
        RAISE EXCEPTION 'invalid_checkout_v2_guarantee_request'
            USING ERRCODE = '22023';
    END IF;

    SELECT role INTO actor_role
    FROM public.profiles
    WHERE id = p_actor_id;

    IF p_lock_rows THEN
        PERFORM pg_catalog.pg_advisory_xact_lock(
            pg_catalog.hashtextextended(p_subscription_id::TEXT, 42854)
        );
        SELECT * INTO subscription_row
        FROM public.subscriptions
        WHERE id = p_subscription_id
        FOR UPDATE;
    ELSE
        SELECT * INTO subscription_row
        FROM public.subscriptions
        WHERE id = p_subscription_id;
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
        SELECT * INTO billing_row
        FROM public.checkout_v2_billing_state AS billing_state
        WHERE billing_state.subscription_id = p_subscription_id
        FOR UPDATE;

        SELECT * INTO cycle_row
        FROM public.checkout_v2_cycles AS cycle
        WHERE cycle.subscription_id = p_subscription_id
          AND cycle.cycle_number = 1
        FOR UPDATE;

        IF cycle_row.id IS NOT NULL THEN
            SELECT * INTO payment_row
            FROM public.payments
            WHERE id = cycle_row.payment_id
            FOR UPDATE;

            SELECT * INTO first_session
            FROM public.sessions
            WHERE checkout_v2_cycle_id = cycle_row.id
              AND checkout_v2_cycle_session_index = 1
            FOR UPDATE;
            SELECT * INTO second_session
            FROM public.sessions
            WHERE checkout_v2_cycle_id = cycle_row.id
              AND checkout_v2_cycle_session_index = 2
            FOR UPDATE;
            SELECT * INTO third_session
            FROM public.sessions
            WHERE checkout_v2_cycle_id = cycle_row.id
              AND checkout_v2_cycle_session_index = 3
            FOR UPDATE;
            SELECT * INTO fourth_session
            FROM public.sessions
            WHERE checkout_v2_cycle_id = cycle_row.id
              AND checkout_v2_cycle_session_index = 4
            FOR UPDATE;
        END IF;
    ELSE
        SELECT * INTO billing_row
        FROM public.checkout_v2_billing_state AS billing_state
        WHERE billing_state.subscription_id = p_subscription_id;

        SELECT * INTO cycle_row
        FROM public.checkout_v2_cycles AS cycle
        WHERE cycle.subscription_id = p_subscription_id
          AND cycle.cycle_number = 1;

        IF cycle_row.id IS NOT NULL THEN
            SELECT * INTO payment_row
            FROM public.payments
            WHERE id = cycle_row.payment_id;
            SELECT * INTO first_session
            FROM public.sessions
            WHERE checkout_v2_cycle_id = cycle_row.id
              AND checkout_v2_cycle_session_index = 1;
            SELECT * INTO second_session
            FROM public.sessions
            WHERE checkout_v2_cycle_id = cycle_row.id
              AND checkout_v2_cycle_session_index = 2;
            SELECT * INTO third_session
            FROM public.sessions
            WHERE checkout_v2_cycle_id = cycle_row.id
              AND checkout_v2_cycle_session_index = 3;
            SELECT * INTO fourth_session
            FROM public.sessions
            WHERE checkout_v2_cycle_id = cycle_row.id
              AND checkout_v2_cycle_session_index = 4;
        END IF;
    END IF;

    IF subscription_row.checkout_intent_id IS NOT NULL THEN
        SELECT * INTO intent_row
        FROM public.checkout_intents
        WHERE id = subscription_row.checkout_intent_id;
    END IF;

    IF subscription_row.package_price_id IS NOT NULL THEN
        SELECT * INTO price_snapshot
        FROM public.checkout_v2_price_snapshots
        WHERE package_price_id = subscription_row.package_price_id;
    END IF;

    subscription_id := subscription_row.id;
    cycle_id := cycle_row.id;
    payment_id := payment_row.id;
    first_session_id := first_session.id;
    second_session_id := second_session.id;
    third_session_id := third_session.id;
    fourth_session_id := fourth_session.id;
    stripe_customer_id := intent_row.stripe_customer_id;
    stripe_subscription_id := subscription_row.stripe_subscription_id;
    stripe_invoice_id := payment_row.stripe_invoice_id;
    stripe_payment_intent_id := payment_row.stripe_payment_intent_id;
    gross_amount_cents := price_snapshot.initial_amount_cents;
    refund_amount_cents := CASE
        WHEN price_snapshot.initial_amount_cents IS NOT NULL
         AND price_snapshot.initial_amount_cents % 4 = 0
        THEN price_snapshot.initial_amount_cents / 4 * 3
        ELSE NULL
    END;
    currency := lower(price_snapshot.currency);

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

    IF billing_row.subscription_id IS NULL
       OR cycle_row.id IS NULL
       OR cycle_row.cycle_kind IS DISTINCT FROM 'initial'
       OR cycle_row.materialization_state IS DISTINCT FROM 'ready'
       OR cycle_row.sessions_materialized_at IS NULL
       OR billing_row.first_session_id IS DISTINCT FROM first_session.id
       OR payment_row.id IS NULL
       OR intent_row.id IS NULL
       OR intent_row.status IS DISTINCT FROM 'completed'
       OR intent_row.student_id IS DISTINCT FROM subscription_row.student_id
       OR intent_row.package_price_id IS DISTINCT FROM subscription_row.package_price_id
       OR intent_row.stripe_customer_id IS NULL
       OR price_snapshot.package_price_id IS NULL
       OR price_snapshot.initial_amount_cents IS DISTINCT FROM 25900
       OR price_snapshot.initial_amount_cents % 4 <> 0
       OR refund_amount_cents IS DISTINCT FROM 19425
       OR lower(price_snapshot.currency) IS DISTINCT FROM 'eur'
       OR payment_row.subscription_id IS DISTINCT FROM subscription_row.id
       OR payment_row.checkout_v2_cycle_id IS DISTINCT FROM cycle_row.id
       OR payment_row.status IS DISTINCT FROM 'succeeded'::public.payment_status
       OR payment_row.amount IS DISTINCT FROM 25900
       OR lower(payment_row.currency) IS DISTINCT FROM 'eur'
       OR payment_row.amount_refunded IS DISTINCT FROM 0
       OR payment_row.stripe_invoice_id IS DISTINCT FROM cycle_row.stripe_invoice_id
       OR payment_row.stripe_invoice_id IS DISTINCT FROM subscription_row.stripe_invoice_id
       OR payment_row.stripe_payment_intent_id IS NULL
       OR subscription_row.stripe_subscription_id IS NULL
       OR first_session.id IS NULL
       OR second_session.id IS NULL
       OR third_session.id IS NULL
       OR fourth_session.id IS NULL THEN
        eligibility_state := 'closed';
        eligibility_reason := 'contract_snapshot_invalid';
        RETURN NEXT;
        RETURN;
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.checkout_v2_cycles AS renewal_cycle
        WHERE renewal_cycle.subscription_id = p_subscription_id
          AND renewal_cycle.cycle_number > 1
    ) THEN
        eligibility_state := 'closed';
        eligibility_reason := 'renewal_already_exists';
        RETURN NEXT;
        RETURN;
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.payments AS later_payment
        WHERE later_payment.subscription_id = p_subscription_id
          AND later_payment.id IS DISTINCT FROM payment_row.id
          AND (
                later_payment.status IN (
                    'succeeded'::public.payment_status,
                    'pending'::public.payment_status,
                    'refunded'::public.payment_status
                )
                OR later_payment.amount_refunded > 0
                OR later_payment.stripe_refund_id IS NOT NULL
          )
    ) THEN
        eligibility_state := 'closed';
        eligibility_reason := 'renewal_payment_exists';
        RETURN NEXT;
        RETURN;
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.checkout_v2_reschedule_operations AS reschedule_operation
        WHERE reschedule_operation.subscription_id = p_subscription_id
          AND reschedule_operation.status IN ('requested', 'manual_review')
    ) THEN
        eligibility_state := 'closed';
        eligibility_reason := 'reschedule_pending';
        RETURN NEXT;
        RETURN;
    END IF;

    IF first_session.status = 'scheduled'
       AND first_session.scheduled_at IS NOT NULL
       AND evaluated_at < first_session.scheduled_at
            + pg_catalog.make_interval(mins => first_session.duration_minutes) THEN
        eligibility_state := 'not_started';
        eligibility_reason := 'first_class_not_completed';
        RETURN NEXT;
        RETURN;
    END IF;

    IF first_session.status IS DISTINCT FROM 'completed'
       OR first_session.scheduled_at IS NULL
       OR first_session.completed_at IS NULL
       OR first_session.completed_at < first_session.scheduled_at
            + pg_catalog.make_interval(mins => first_session.duration_minutes)
       OR evaluated_at < first_session.scheduled_at
            + pg_catalog.make_interval(mins => first_session.duration_minutes)
       OR first_session.completed_at > evaluated_at THEN
        eligibility_state := 'closed';
        eligibility_reason := 'first_class_completion_invalid';
        RETURN NEXT;
        RETURN;
    END IF;

    SELECT EXISTS (
        SELECT 1
        FROM public.checkout_v2_session_incident_resolutions AS resolution_row
        WHERE resolution_row.session_id = second_session.id
          AND resolution_row.subscription_id = subscription_row.id
          AND resolution_row.cycle_id = cycle_row.id
          AND resolution_row.session_index = 2
          AND resolution_row.resolution = 'excused'
    ) INTO second_excused;

    IF NOT (
        (
            second_session.status = 'scheduled'
            AND second_session.scheduled_at IS NOT NULL
            AND evaluated_at < second_session.scheduled_at
        )
        OR (
            second_session.status IN ('cancelled', 'no_show')
            AND second_excused
        )
    ) THEN
        eligibility_state := 'closed';
        eligibility_reason := CASE
            WHEN second_session.status = 'cancelled'
             AND second_session.cancelled_at IS NOT NULL
             AND second_session.cancelled_by = second_session.student_id
             AND second_session.scheduled_at < second_session.cancelled_at + INTERVAL '24 hours'
                THEN 'second_class_late_cancellation'
            WHEN second_session.status = 'no_show'
                THEN 'second_class_no_show'
            WHEN second_session.status = 'cancelled'
                THEN 'second_class_cancellation_requires_support'
            ELSE 'second_class_started_or_consumed'
        END;
        RETURN NEXT;
        RETURN;
    END IF;

    third_consumed := NOT (
        third_session.status = 'scheduled'
        OR (
            third_session.status = 'cancelled'
            AND third_session.cancelled_at IS NOT NULL
            AND (
                third_session.cancelled_by IS DISTINCT FROM third_session.student_id
                OR third_session.scheduled_at >= third_session.cancelled_at + INTERVAL '24 hours'
            )
        )
    );
    fourth_consumed := NOT (
        fourth_session.status = 'scheduled'
        OR (
            fourth_session.status = 'cancelled'
            AND fourth_session.cancelled_at IS NOT NULL
            AND (
                fourth_session.cancelled_by IS DISTINCT FROM fourth_session.student_id
                OR fourth_session.scheduled_at >= fourth_session.cancelled_at + INTERVAL '24 hours'
            )
        )
    );

    IF third_consumed OR fourth_consumed THEN
        eligibility_state := 'closed';
        eligibility_reason := 'remaining_class_consumed';
        RETURN NEXT;
        RETURN;
    END IF;

    eligibility_state := 'eligible';
    eligibility_reason := 'eligible';
    RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_checkout_v2_guarantee_state(
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
    updated_at TIMESTAMPTZ
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
    FROM public.subscriptions
    WHERE id = p_subscription_id;

    IF subscription_row.id IS NULL THEN
        RAISE EXCEPTION 'checkout_v2_guarantee_subscription_not_found'
            USING ERRCODE = 'P0002';
    END IF;

    SELECT role INTO actor_role
    FROM public.profiles
    WHERE id = p_actor_id;

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
    FROM public.checkout_v2_guarantee_operations AS guarantee_operation
    WHERE guarantee_operation.subscription_id = p_subscription_id;

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
    refund_amount_cents := COALESCE(evaluation.refund_amount_cents, 19425);
    currency := COALESCE(evaluation.currency, 'eur');
    operation_id := NULL;
    reason := evaluation.eligibility_reason;
    updated_at := date_trunc('second', clock_timestamp());
    RETURN NEXT;
END;
$$;

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
BEGIN
    IF p_request_id IS NULL OR p_subscription_id IS NULL OR p_actor_id IS NULL THEN
        RAISE EXCEPTION 'invalid_checkout_v2_guarantee_request'
            USING ERRCODE = '22023';
    END IF;

    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(p_subscription_id::TEXT, 42854)
    );

    SELECT * INTO subscription_row
    FROM public.subscriptions
    WHERE id = p_subscription_id
    FOR UPDATE;

    IF subscription_row.id IS NULL THEN
        RAISE EXCEPTION 'checkout_v2_guarantee_subscription_not_found'
            USING ERRCODE = 'P0002';
    END IF;

    SELECT role INTO actor_role
    FROM public.profiles
    WHERE id = p_actor_id;

    IF actor_role IS DISTINCT FROM 'student'::public.user_role
       OR p_actor_id IS DISTINCT FROM subscription_row.student_id THEN
        RAISE EXCEPTION 'checkout_v2_guarantee_forbidden'
            USING ERRCODE = '42501';
    END IF;

    SELECT * INTO existing_operation
    FROM public.checkout_v2_guarantee_operations
    WHERE request_id = p_request_id
    FOR UPDATE;

    IF existing_operation.id IS NOT NULL THEN
        IF existing_operation.subscription_id IS DISTINCT FROM p_subscription_id
           OR existing_operation.actor_id IS DISTINCT FROM p_actor_id THEN
            RAISE EXCEPTION 'checkout_v2_guarantee_request_id_conflicts'
                USING ERRCODE = '23505';
        END IF;
        RETURN existing_operation;
    END IF;

    -- A new client request ID recovers the one durable operation instead of
    -- ever creating a second refund for the same subscription.
    SELECT * INTO existing_operation
    FROM public.checkout_v2_guarantee_operations
    WHERE subscription_id = p_subscription_id
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
        evaluation.stripe_customer_id,
        evaluation.stripe_subscription_id,
        evaluation.stripe_invoice_id,
        evaluation.stripe_payment_intent_id,
        evaluation.gross_amount_cents,
        evaluation.refund_amount_cents,
        evaluation.currency
    )
    RETURNING * INTO existing_operation;

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
    billing_row public.checkout_v2_billing_state%ROWTYPE;
    payment_row public.payments%ROWTYPE;
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
        SELECT 1 FROM public.profiles
        WHERE id = p_admin_id AND role = 'admin'::public.user_role
    ) THEN
        RAISE EXCEPTION 'checkout_v2_guarantee_incident_resolution_forbidden'
            USING ERRCODE = '42501';
    END IF;

    SELECT subscription_id INTO discovered_subscription_id
    FROM public.sessions
    WHERE id = p_session_id;

    IF discovered_subscription_id IS NULL THEN
        RAISE EXCEPTION 'checkout_v2_guarantee_incident_session_not_found'
            USING ERRCODE = 'P0002';
    END IF;

    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(discovered_subscription_id::TEXT, 42854)
    );

    SELECT * INTO subscription_row FROM public.subscriptions
    WHERE id = discovered_subscription_id FOR UPDATE;
    SELECT * INTO billing_row FROM public.checkout_v2_billing_state
    WHERE subscription_id = discovered_subscription_id FOR UPDATE;
    SELECT * INTO cycle_row FROM public.checkout_v2_cycles
    WHERE subscription_id = discovered_subscription_id AND cycle_number = 1
    FOR UPDATE;
    SELECT * INTO payment_row FROM public.payments
    WHERE id = cycle_row.payment_id FOR UPDATE;
    PERFORM 1 FROM public.sessions
    WHERE checkout_v2_cycle_id = cycle_row.id
    ORDER BY checkout_v2_cycle_session_index, id FOR UPDATE;
    SELECT * INTO session_row FROM public.sessions WHERE id = p_session_id;

    SELECT * INTO resolution_row
    FROM public.checkout_v2_session_incident_resolutions
    WHERE session_id = p_session_id;

    IF resolution_row.id IS NOT NULL THEN
        RETURN resolution_row;
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.checkout_v2_guarantee_operations
        WHERE subscription_id = discovered_subscription_id
    ) THEN
        RAISE EXCEPTION 'checkout_v2_guarantee_incident_resolution_after_request'
            USING ERRCODE = '23514';
    END IF;

    IF subscription_row.contract_schema_version IS DISTINCT FROM 2
       OR billing_row.subscription_id IS NULL
       OR cycle_row.id IS NULL
       OR cycle_row.cycle_number IS DISTINCT FROM 1
       OR session_row.checkout_v2_cycle_id IS DISTINCT FROM cycle_row.id
       OR session_row.checkout_v2_cycle_session_index IS DISTINCT FROM 2
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
        ELSE session_row.updated_at
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
        2,
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

CREATE OR REPLACE FUNCTION public.claim_checkout_v2_guarantee(
    p_operation_id UUID,
    p_worker_token UUID
)
RETURNS public.checkout_v2_guarantee_operations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    operation_row public.checkout_v2_guarantee_operations%ROWTYPE;
    v_claimed_at TIMESTAMPTZ := date_trunc('second', clock_timestamp());
BEGIN
    IF p_operation_id IS NULL OR p_worker_token IS NULL THEN
        RAISE EXCEPTION 'invalid_checkout_v2_guarantee_claim'
            USING ERRCODE = '22023';
    END IF;

    operation_row := private.lock_checkout_v2_guarantee_operation(p_operation_id);

    IF operation_row.status = 'refunded' THEN
        RETURN operation_row;
    END IF;

    IF operation_row.status = 'manual_review' THEN
        RAISE EXCEPTION 'checkout_v2_guarantee_requires_manual_review'
            USING ERRCODE = '55000';
    END IF;

    IF operation_row.status = 'processing'
       AND operation_row.lease_expires_at > v_claimed_at
       AND operation_row.lease_token IS DISTINCT FROM p_worker_token THEN
        RAISE EXCEPTION 'checkout_v2_guarantee_is_already_claimed'
            USING ERRCODE = '55P03';
    END IF;

    IF operation_row.status = 'processing'
       AND operation_row.lease_expires_at > v_claimed_at
       AND operation_row.lease_token = p_worker_token THEN
        RETURN operation_row;
    END IF;

    IF operation_row.status NOT IN (
        'requested', 'processing', 'refund_pending', 'retryable'
    ) THEN
        RAISE EXCEPTION 'checkout_v2_guarantee_is_not_claimable'
            USING ERRCODE = '23514';
    END IF;

    UPDATE public.checkout_v2_guarantee_operations
    SET
        status = 'processing',
        lease_token = p_worker_token,
        lease_expires_at = v_claimed_at + INTERVAL '5 minutes',
        claimed_at = v_claimed_at,
        last_error = NULL
    WHERE id = p_operation_id
    RETURNING * INTO operation_row;

    RETURN operation_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.begin_checkout_v2_guarantee_cancellation(
    p_operation_id UUID,
    p_worker_token UUID
)
RETURNS public.checkout_v2_guarantee_operations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    operation_row public.checkout_v2_guarantee_operations%ROWTYPE;
    evaluation RECORD;
    mutation_started_at TIMESTAMPTZ := date_trunc('second', clock_timestamp());
BEGIN
    IF p_operation_id IS NULL OR p_worker_token IS NULL THEN
        RAISE EXCEPTION 'invalid_checkout_v2_guarantee_cancellation_boundary'
            USING ERRCODE = '22023';
    END IF;

    operation_row := private.lock_checkout_v2_guarantee_operation(p_operation_id);

    IF operation_row.terminated_at IS NOT NULL THEN
        RETURN operation_row;
    END IF;

    IF operation_row.status IS DISTINCT FROM 'processing'
       OR operation_row.lease_token IS DISTINCT FROM p_worker_token
       OR operation_row.lease_expires_at <= mutation_started_at THEN
        RAISE EXCEPTION 'checkout_v2_guarantee_claim_is_not_active'
            USING ERRCODE = '55P03';
    END IF;

    SELECT * INTO evaluation
    FROM private.evaluate_checkout_v2_guarantee(
        operation_row.subscription_id,
        operation_row.actor_id,
        TRUE
    );

    IF evaluation.eligibility_state IS DISTINCT FROM 'eligible'
       OR ROW(
            evaluation.subscription_id,
            evaluation.cycle_id,
            evaluation.payment_id,
            evaluation.first_session_id,
            evaluation.second_session_id,
            evaluation.third_session_id,
            evaluation.fourth_session_id,
            evaluation.stripe_customer_id,
            evaluation.stripe_subscription_id,
            evaluation.stripe_invoice_id,
            evaluation.stripe_payment_intent_id,
            evaluation.gross_amount_cents,
            evaluation.refund_amount_cents,
            evaluation.currency
       ) IS DISTINCT FROM ROW(
            operation_row.subscription_id,
            operation_row.cycle_id,
            operation_row.payment_id,
            operation_row.first_session_id,
            operation_row.second_session_id,
            operation_row.third_session_id,
            operation_row.fourth_session_id,
            operation_row.stripe_customer_id,
            operation_row.stripe_subscription_id,
            operation_row.stripe_invoice_id,
            operation_row.stripe_payment_intent_id,
            operation_row.gross_amount_cents,
            operation_row.refund_amount_cents,
            operation_row.currency
       ) THEN
        RAISE EXCEPTION 'checkout_v2_guarantee_state_changed:%',
            evaluation.eligibility_reason
            USING ERRCODE = '40001';
    END IF;

    IF operation_row.cancellation_started_at IS NULL THEN
        UPDATE public.checkout_v2_guarantee_operations
        SET cancellation_started_at = mutation_started_at
        WHERE id = p_operation_id
        RETURNING * INTO operation_row;
    END IF;

    RETURN operation_row;
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
    first_session public.sessions%ROWTYPE;
    target_session public.sessions%ROWTYPE;
    applied_at TIMESTAMPTZ := date_trunc('second', clock_timestamp());
    job_payload JSONB;
    job_row public.fulfillment_jobs%ROWTYPE;
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
    FROM public.subscriptions
    WHERE id = operation_row.subscription_id;
    SELECT * INTO first_session
    FROM public.sessions
    WHERE id = operation_row.first_session_id;

    IF subscription_row.id IS NULL
       OR subscription_row.contract_schema_version IS DISTINCT FROM 2
       OR subscription_row.stripe_subscription_id IS DISTINCT FROM
            operation_row.stripe_subscription_id
       OR first_session.status IS DISTINCT FROM 'completed'
       OR first_session.completed_at IS NULL
       OR first_session.scheduled_at IS NULL
       OR first_session.completed_at < first_session.scheduled_at
            + pg_catalog.make_interval(mins => first_session.duration_minutes)
       OR first_session.id IS DISTINCT FROM operation_row.first_session_id THEN
        RAISE EXCEPTION 'checkout_v2_guarantee_termination_state_conflicts'
            USING ERRCODE = '40001';
    END IF;

    PERFORM pg_catalog.set_config(
        'app.checkout_v2_guarantee_operation_id',
        operation_row.id::TEXT,
        TRUE
    );

    FOR target_session IN
        SELECT *
        FROM public.sessions
        WHERE id IN (
            operation_row.second_session_id,
            operation_row.third_session_id,
            operation_row.fourth_session_id
        )
        ORDER BY checkout_v2_cycle_session_index, id
    LOOP
        IF target_session.status = 'scheduled' THEN
            UPDATE public.sessions
            SET
                status = 'cancelled',
                cancelled_at = applied_at,
                cancelled_by = operation_row.actor_id,
                cancellation_reason = 'guarantee_refund',
                updated_at = applied_at
            WHERE id = target_session.id
              AND status = 'scheduled';

            IF NOT FOUND THEN
                RAISE EXCEPTION 'checkout_v2_guarantee_session_state_conflicts'
                    USING ERRCODE = '40001';
            END IF;

            job_payload := pg_catalog.jsonb_build_object(
                'sessionId', target_session.id,
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
                target_session.id,
                operation_row.subscription_id,
                subscription_row.student_id,
                'session_cancellation:' || target_session.id::TEXT,
                job_payload
            )
            ON CONFLICT (job_type, dedupe_key)
                WHERE dedupe_key IS NOT NULL
                DO NOTHING;

            SELECT * INTO job_row
            FROM public.fulfillment_jobs
            WHERE job_type = 'session_cancellation'
              AND dedupe_key = 'session_cancellation:' || target_session.id::TEXT;

            IF job_row.id IS NULL
               OR job_row.session_id IS DISTINCT FROM target_session.id
               OR job_row.subscription_id IS DISTINCT FROM operation_row.subscription_id
               OR job_row.student_id IS DISTINCT FROM subscription_row.student_id
               OR job_row.payload IS DISTINCT FROM job_payload THEN
                RAISE EXCEPTION 'checkout_v2_guarantee_cancellation_job_conflicts'
                    USING ERRCODE = '23505';
            END IF;
        ELSIF target_session.id = operation_row.second_session_id
          AND target_session.status IN ('cancelled', 'no_show')
          AND EXISTS (
                SELECT 1
                FROM public.checkout_v2_session_incident_resolutions AS resolution_row
                WHERE resolution_row.session_id = target_session.id
                  AND resolution_row.resolution = 'excused'
          ) THEN
            NULL;
        ELSIF target_session.status = 'cancelled'
          AND target_session.cancelled_at IS NOT NULL
          AND (
                target_session.cancelled_by IS DISTINCT FROM target_session.student_id
                OR target_session.scheduled_at
                    >= target_session.cancelled_at + INTERVAL '24 hours'
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
        sessions_used = 1,
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

CREATE OR REPLACE FUNCTION public.begin_checkout_v2_guarantee_refund(
    p_operation_id UUID,
    p_worker_token UUID
)
RETURNS public.checkout_v2_guarantee_operations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    operation_row public.checkout_v2_guarantee_operations%ROWTYPE;
    mutation_started_at TIMESTAMPTZ := date_trunc('second', clock_timestamp());
BEGIN
    IF p_operation_id IS NULL OR p_worker_token IS NULL THEN
        RAISE EXCEPTION 'invalid_checkout_v2_guarantee_refund_boundary'
            USING ERRCODE = '22023';
    END IF;

    operation_row := private.lock_checkout_v2_guarantee_operation(p_operation_id);

    IF operation_row.status = 'refunded'
       OR operation_row.refund_started_at IS NOT NULL THEN
        RETURN operation_row;
    END IF;

    IF operation_row.status IS DISTINCT FROM 'processing'
       OR operation_row.lease_token IS DISTINCT FROM p_worker_token
       OR operation_row.lease_expires_at <= mutation_started_at
       OR operation_row.terminated_at IS NULL
       OR operation_row.stripe_cancelled_at IS NULL THEN
        RAISE EXCEPTION 'checkout_v2_guarantee_refund_state_conflicts'
            USING ERRCODE = '40001';
    END IF;

    UPDATE public.checkout_v2_guarantee_operations
    SET refund_started_at = mutation_started_at
    WHERE id = p_operation_id
    RETURNING * INTO operation_row;

    RETURN operation_row;
END;
$$;

CREATE OR REPLACE FUNCTION private.ensure_checkout_v2_guarantee_support_ticket(
    p_operation_id UUID,
    p_error TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    operation_row public.checkout_v2_guarantee_operations%ROWTYPE;
    ticket_row public.support_tickets%ROWTYPE;
    student_id UUID;
    ticket_id UUID;
BEGIN
    SELECT * INTO operation_row
    FROM public.checkout_v2_guarantee_operations
    WHERE id = p_operation_id
    FOR UPDATE;

    IF operation_row.id IS NULL THEN
        RAISE EXCEPTION 'checkout_v2_guarantee_operation_not_found'
            USING ERRCODE = 'P0002';
    END IF;

    IF operation_row.support_ticket_id IS NOT NULL THEN
        SELECT * INTO ticket_row
        FROM public.support_tickets AS support_ticket
        WHERE support_ticket.id = operation_row.support_ticket_id
        FOR UPDATE;

        IF ticket_row.id IS NULL THEN
            RAISE EXCEPTION 'checkout_v2_guarantee_support_ticket_not_found'
                USING ERRCODE = 'P0002';
        END IF;

        IF ticket_row.status = 'closed' THEN
            UPDATE public.support_tickets
            SET
                status = 'open',
                message = left(
                    ticket_row.message
                    || E'\n\nReopened after a new guarantee failure: '
                    || p_error,
                    2000
                ),
                context = ticket_row.context || pg_catalog.jsonb_build_object(
                    'last_error', left(p_error, 1500),
                    'reopened_at', date_trunc('second', clock_timestamp())
                ),
                updated_at = date_trunc('second', clock_timestamp())
            WHERE id = ticket_row.id;
        END IF;

        RETURN operation_row.support_ticket_id;
    END IF;

    SELECT subscription.student_id INTO student_id
    FROM public.subscriptions AS subscription
    WHERE subscription.id = operation_row.subscription_id;

    INSERT INTO public.support_tickets (
        user_id,
        issue_type,
        issue_title,
        message,
        context
    ) VALUES (
        student_id,
        'guarantee_review',
        'Checkout V2 guarantee requires review',
        'Guarantee operation requires human review: ' || left(p_error, 1500),
        pg_catalog.jsonb_build_object(
            'operation_id', operation_row.id,
            'subscription_id', operation_row.subscription_id,
            'payment_id', operation_row.payment_id
        )
    )
    RETURNING id INTO ticket_id;

    UPDATE public.checkout_v2_guarantee_operations
    SET support_ticket_id = ticket_id
    WHERE id = operation_row.id;

    RETURN ticket_id;
END;
$$;

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
       OR p_amount_cents IS DISTINCT FROM 19425
       OR lower(p_currency) IS DISTINCT FROM 'eur'
       OR p_stripe_payment_intent_id IS NULL
       OR p_stripe_payment_intent_id !~ '^pi_[A-Za-z0-9_]+$' THEN
        RAISE EXCEPTION 'invalid_checkout_v2_guarantee_refund_observation'
            USING ERRCODE = '22023';
    END IF;

    operation_row := private.lock_checkout_v2_guarantee_operation(p_operation_id);

    IF operation_row.status = 'refunded' THEN
        IF operation_row.stripe_refund_id IS DISTINCT FROM p_stripe_refund_id
           OR operation_row.refund_created_at IS DISTINCT FROM p_refund_created_at
           OR operation_row.refund_amount_cents IS DISTINCT FROM p_amount_cents
           OR operation_row.currency IS DISTINCT FROM lower(p_currency)
           OR operation_row.stripe_payment_intent_id IS DISTINCT FROM
                p_stripe_payment_intent_id THEN
            RAISE EXCEPTION 'checkout_v2_guarantee_refund_replay_conflicts'
                USING ERRCODE = '23505';
        END IF;
        RETURN operation_row;
    END IF;

    IF operation_row.status = 'manual_review'
       AND operation_row.refund_status IN ('failed', 'canceled')
       AND p_refund_status IN ('pending', 'requires_action') THEN
        IF operation_row.stripe_refund_id IS DISTINCT FROM p_stripe_refund_id
           OR operation_row.refund_created_at IS DISTINCT FROM p_refund_created_at
           OR operation_row.refund_amount_cents IS DISTINCT FROM p_amount_cents
           OR operation_row.currency IS DISTINCT FROM lower(p_currency)
           OR operation_row.stripe_payment_intent_id IS DISTINCT FROM
                p_stripe_payment_intent_id THEN
            RAISE EXCEPTION 'checkout_v2_guarantee_refund_replay_conflicts'
                USING ERRCODE = '23505';
        END IF;
        RETURN operation_row;
    END IF;

    IF operation_row.terminated_at IS NULL
       OR operation_row.refund_started_at IS NULL
       OR operation_row.refund_amount_cents IS DISTINCT FROM p_amount_cents
       OR operation_row.currency IS DISTINCT FROM lower(p_currency)
       OR operation_row.stripe_payment_intent_id IS DISTINCT FROM
            p_stripe_payment_intent_id
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
    FROM public.payments
    WHERE id = operation_row.payment_id;

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
    FROM public.fulfillment_jobs
    WHERE job_type = 'guarantee_refund'
      AND dedupe_key = 'guarantee_refund:' || operation_row.id::TEXT;

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

CREATE OR REPLACE FUNCTION public.mark_checkout_v2_guarantee_outcome(
    p_operation_id UUID,
    p_worker_token UUID,
    p_status TEXT,
    p_error TEXT
)
RETURNS public.checkout_v2_guarantee_operations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    operation_row public.checkout_v2_guarantee_operations%ROWTYPE;
    ticket_id UUID;
    evaluated_at TIMESTAMPTZ := date_trunc('second', clock_timestamp());
BEGIN
    IF p_operation_id IS NULL
       OR p_worker_token IS NULL
       OR p_status NOT IN ('retryable', 'manual_review')
       OR NULLIF(btrim(p_error), '') IS NULL
       OR char_length(btrim(p_error)) > 2000 THEN
        RAISE EXCEPTION 'invalid_checkout_v2_guarantee_outcome'
            USING ERRCODE = '22023';
    END IF;

    operation_row := private.lock_checkout_v2_guarantee_operation(p_operation_id);

    IF operation_row.status = 'refunded' THEN
        RETURN operation_row;
    END IF;

    IF operation_row.status IS DISTINCT FROM 'processing'
       OR operation_row.lease_token IS DISTINCT FROM p_worker_token
       OR operation_row.lease_expires_at <= evaluated_at THEN
        RAISE EXCEPTION 'checkout_v2_guarantee_claim_is_not_active'
            USING ERRCODE = '40001';
    END IF;

    IF p_status = 'manual_review' THEN
        ticket_id := private.ensure_checkout_v2_guarantee_support_ticket(
            p_operation_id,
            btrim(p_error)
        );
    ELSE
        ticket_id := operation_row.support_ticket_id;
    END IF;

    UPDATE public.checkout_v2_guarantee_operations
    SET
        status = p_status,
        support_ticket_id = ticket_id,
        lease_token = NULL,
        lease_expires_at = NULL,
        last_error = btrim(p_error)
    WHERE id = p_operation_id
    RETURNING * INTO operation_row;

    RETURN operation_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.resolve_checkout_v2_guarantee_review(
    p_operation_id UUID,
    p_admin_id UUID,
    p_reason TEXT
)
RETURNS public.checkout_v2_guarantee_operations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    operation_row public.checkout_v2_guarantee_operations%ROWTYPE;
    ticket_row public.support_tickets%ROWTYPE;
    before_snapshot JSONB;
    trimmed_reason TEXT := btrim(p_reason);
BEGIN
    IF p_operation_id IS NULL
       OR p_admin_id IS NULL
       OR NULLIF(trimmed_reason, '') IS NULL
       OR char_length(trimmed_reason) NOT BETWEEN 5 AND 2000 THEN
        RAISE EXCEPTION 'invalid_checkout_v2_guarantee_review_resolution'
            USING ERRCODE = '22023';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM public.profiles AS admin_profile
        WHERE admin_profile.id = p_admin_id
          AND admin_profile.role = 'admin'::public.user_role
    ) THEN
        RAISE EXCEPTION 'checkout_v2_guarantee_review_resolution_forbidden'
            USING ERRCODE = '42501';
    END IF;

    operation_row := private.lock_checkout_v2_guarantee_operation(p_operation_id);

    IF operation_row.status = 'retryable' THEN
        IF EXISTS (
            SELECT 1
            FROM public.admin_audit_log AS audit_entry
            WHERE audit_entry.admin_id = p_admin_id
              AND audit_entry.action = 'resolve_checkout_v2_guarantee_review'
              AND audit_entry.entity_type = 'checkout_v2_guarantee_operation'
              AND audit_entry.entity_id = p_operation_id::TEXT
              AND audit_entry.after ->> 'resolution_reason' = trimmed_reason
        ) THEN
            RETURN operation_row;
        END IF;

        RAISE EXCEPTION 'checkout_v2_guarantee_review_resolution_conflicts'
            USING ERRCODE = '40001';
    END IF;

    IF operation_row.status IS DISTINCT FROM 'manual_review'
       OR operation_row.support_ticket_id IS NULL THEN
        RAISE EXCEPTION 'checkout_v2_guarantee_review_is_not_releasable'
            USING ERRCODE = '23514';
    END IF;

    SELECT * INTO ticket_row
    FROM public.support_tickets AS support_ticket
    WHERE support_ticket.id = operation_row.support_ticket_id
    FOR UPDATE;

    IF ticket_row.id IS NULL
       OR ticket_row.issue_type IS DISTINCT FROM 'guarantee_review'
       OR ticket_row.status IS DISTINCT FROM 'closed'
       OR ticket_row.user_id IS DISTINCT FROM operation_row.actor_id THEN
        RAISE EXCEPTION 'checkout_v2_guarantee_review_ticket_is_not_closed'
            USING ERRCODE = '23514';
    END IF;

    IF operation_row.stripe_refund_id IS NOT NULL
       OR operation_row.refund_status IS NOT NULL
       OR operation_row.refund_created_at IS NOT NULL
       OR operation_row.refunded_at IS NOT NULL THEN
        RAISE EXCEPTION 'checkout_v2_guarantee_review_has_refund_evidence'
            USING ERRCODE = '23514';
    END IF;

    before_snapshot := pg_catalog.to_jsonb(operation_row);

    UPDATE public.checkout_v2_guarantee_operations
    SET
        status = 'retryable',
        lease_token = NULL,
        lease_expires_at = NULL
    WHERE id = p_operation_id
    RETURNING * INTO operation_row;

    INSERT INTO public.admin_audit_log (
        admin_id,
        action,
        entity_type,
        entity_id,
        before,
        after
    ) VALUES (
        p_admin_id,
        'resolve_checkout_v2_guarantee_review',
        'checkout_v2_guarantee_operation',
        operation_row.id::TEXT,
        before_snapshot,
        pg_catalog.to_jsonb(operation_row) || pg_catalog.jsonb_build_object(
            'resolution_reason', trimmed_reason,
            'support_ticket_id', operation_row.support_ticket_id
        )
    );

    RETURN operation_row;
END;
$$;

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
        current_setting('app.checkout_v2_guarantee_operation_id', TRUE),
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
               AND OLD.id IN (
                    terminal_operation.first_session_id,
                    terminal_operation.second_session_id,
                    terminal_operation.third_session_id,
                    terminal_operation.fourth_session_id
               ) THEN
                RAISE EXCEPTION 'checkout_v2_guarantee_terminal_state_is_locked'
                    USING ERRCODE = '40001';
            ELSIF TG_OP = 'UPDATE'
               AND (
                    OLD.id IN (
                        terminal_operation.first_session_id,
                        terminal_operation.second_session_id,
                        terminal_operation.third_session_id,
                        terminal_operation.fourth_session_id
                    )
                    OR NEW.id IN (
                        terminal_operation.first_session_id,
                        terminal_operation.second_session_id,
                        terminal_operation.third_session_id,
                        terminal_operation.fourth_session_id
                    )
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
                        OR NEW.sessions_used IS DISTINCT FROM 1
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

CREATE TRIGGER guard_checkout_v2_guarantee_session_state
    BEFORE INSERT OR DELETE OR UPDATE OF
        scheduled_at,
        status,
        completed_at,
        cancelled_at,
        cancelled_by,
        cancellation_reason,
        subscription_id,
        student_id,
        teacher_id,
        duration_minutes,
        checkout_v2_cycle_id,
        checkout_v2_cycle_session_index
    ON public.sessions
    FOR EACH ROW EXECUTE FUNCTION private.guard_checkout_v2_guarantee_locked_state();

CREATE TRIGGER guard_checkout_v2_guarantee_subscription_state
    BEFORE INSERT OR DELETE OR UPDATE OF
        student_id,
        package_id,
        package_price_id,
        status,
        duration_months,
        starts_at,
        ends_at,
        sessions_total,
        contracted_sessions_per_period,
        sessions_used,
        stripe_subscription_id,
        stripe_invoice_id,
        contract_schema_version,
        billing_interval_unit,
        billing_interval_count,
        class_duration_minutes
    ON public.subscriptions
    FOR EACH ROW EXECUTE FUNCTION private.guard_checkout_v2_guarantee_locked_state();

CREATE TRIGGER guard_checkout_v2_guarantee_billing_state
    BEFORE INSERT OR UPDATE OR DELETE ON public.checkout_v2_billing_state
    FOR EACH ROW EXECUTE FUNCTION private.guard_checkout_v2_guarantee_locked_state();

CREATE TRIGGER guard_checkout_v2_guarantee_cycle_state
    BEFORE INSERT OR UPDATE OR DELETE ON public.checkout_v2_cycles
    FOR EACH ROW EXECUTE FUNCTION private.guard_checkout_v2_guarantee_locked_state();

CREATE TRIGGER guard_checkout_v2_guarantee_payment_state
    BEFORE INSERT OR DELETE OR UPDATE OF
        student_id,
        subscription_id,
        amount,
        amount_refunded,
        currency,
        status,
        stripe_payment_intent_id,
        stripe_invoice_id,
        stripe_refund_id,
        refunded_at,
        checkout_v2_cycle_id
    ON public.payments
    FOR EACH ROW EXECUTE FUNCTION private.guard_checkout_v2_guarantee_locked_state();

CREATE OR REPLACE FUNCTION private.guard_reschedule_against_checkout_v2_guarantee()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF NEW.status IN ('requested', 'manual_review') THEN
        PERFORM pg_catalog.pg_advisory_xact_lock(
            pg_catalog.hashtextextended(NEW.subscription_id::TEXT, 42854)
        );

        IF EXISTS (
            SELECT 1
            FROM public.checkout_v2_guarantee_operations AS guarantee_operation
            WHERE guarantee_operation.subscription_id = NEW.subscription_id
        ) THEN
            RAISE EXCEPTION 'checkout_v2_guarantee_state_is_locked'
                USING ERRCODE = '40001';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER guard_reschedule_against_checkout_v2_guarantee_trigger
    BEFORE INSERT OR UPDATE OF status, subscription_id
    ON public.checkout_v2_reschedule_operations
    FOR EACH ROW EXECUTE FUNCTION private.guard_reschedule_against_checkout_v2_guarantee();

REVOKE ALL ON FUNCTION private.guard_checkout_v2_guarantee_operation()
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.guard_checkout_v2_incident_resolution()
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.lock_checkout_v2_guarantee_operation(UUID)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.evaluate_checkout_v2_guarantee(UUID, UUID, BOOLEAN)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.ensure_checkout_v2_guarantee_support_ticket(UUID, TEXT)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.guard_checkout_v2_guarantee_locked_state()
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.guard_reschedule_against_checkout_v2_guarantee()
    FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.get_checkout_v2_guarantee_state(UUID, UUID)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_checkout_v2_guarantee_state(UUID, UUID)
    TO service_role;
REVOKE ALL ON FUNCTION public.prepare_checkout_v2_guarantee(UUID, UUID, UUID)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_checkout_v2_guarantee(UUID, UUID, UUID)
    TO service_role;
REVOKE ALL ON FUNCTION public.claim_checkout_v2_guarantee(UUID, UUID)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_checkout_v2_guarantee(UUID, UUID)
    TO service_role;
REVOKE ALL ON FUNCTION public.begin_checkout_v2_guarantee_cancellation(UUID, UUID)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.begin_checkout_v2_guarantee_cancellation(UUID, UUID)
    TO service_role;
REVOKE ALL ON FUNCTION public.apply_checkout_v2_guarantee_termination(UUID, UUID, TIMESTAMPTZ)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_checkout_v2_guarantee_termination(UUID, UUID, TIMESTAMPTZ)
    TO service_role;
REVOKE ALL ON FUNCTION public.begin_checkout_v2_guarantee_refund(UUID, UUID)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.begin_checkout_v2_guarantee_refund(UUID, UUID)
    TO service_role;
REVOKE ALL ON FUNCTION public.observe_checkout_v2_guarantee_refund(
    UUID, TEXT, TEXT, TIMESTAMPTZ, INTEGER, TEXT, TEXT
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.observe_checkout_v2_guarantee_refund(
    UUID, TEXT, TEXT, TIMESTAMPTZ, INTEGER, TEXT, TEXT
) TO service_role;
REVOKE ALL ON FUNCTION public.mark_checkout_v2_guarantee_outcome(UUID, UUID, TEXT, TEXT)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_checkout_v2_guarantee_outcome(UUID, UUID, TEXT, TEXT)
    TO service_role;
REVOKE ALL ON FUNCTION public.resolve_checkout_v2_guarantee_review(UUID, UUID, TEXT)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_checkout_v2_guarantee_review(UUID, UUID, TEXT)
    TO service_role;
REVOKE ALL ON FUNCTION public.excuse_checkout_v2_guarantee_incident(UUID, UUID, TEXT)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.excuse_checkout_v2_guarantee_incident(UUID, UUID, TEXT)
    TO service_role;

COMMENT ON TABLE public.checkout_v2_guarantee_operations IS
    'Durable single-use Checkout V2 guarantee and Stripe cancellation/refund saga.';
COMMENT ON TABLE public.checkout_v2_session_incident_resolutions IS
    'Immutable admin decisions excusing a Checkout V2 second-session late cancellation or no-show.';
COMMENT ON FUNCTION public.observe_checkout_v2_guarantee_refund(
    UUID, TEXT, TEXT, TIMESTAMPTZ, INTEGER, TEXT, TEXT
) IS 'Reconciles one authoritative Stripe refund observation without requiring a worker lease.';
