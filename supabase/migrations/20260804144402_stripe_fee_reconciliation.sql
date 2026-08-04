-- Authoritative Stripe fee reconciliation for Checkout V2 payments.
-- Balance transactions are immutable evidence. Reconciliation state can move
-- back to pending when a later refund changes the local payment snapshot.

CREATE TABLE public.stripe_payment_fee_reconciliations (
    payment_id UUID PRIMARY KEY REFERENCES public.payments(id) ON DELETE RESTRICT,
    stripe_payment_intent_id TEXT NOT NULL CHECK (
        stripe_payment_intent_id ~ '^pi_[A-Za-z0-9_]+$'
    ),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'reconciled')),
    stripe_account_id TEXT CHECK (
        stripe_account_id IS NULL OR stripe_account_id ~ '^acct_[A-Za-z0-9_]+$'
    ),
    stripe_livemode BOOLEAN,
    reconciled_amount_refunded_cents INTEGER NOT NULL DEFAULT 0 CHECK (
        reconciled_amount_refunded_cents >= 0
    ),
    reconciled_transaction_count SMALLINT NOT NULL DEFAULT 0 CHECK (
        reconciled_transaction_count BETWEEN 0 AND 1001
    ),
    last_error_code TEXT CHECK (
        last_error_code IS NULL OR last_error_code ~ '^[a-z0-9_]{3,80}$'
    ),
    last_attempted_at TIMESTAMPTZ,
    reconciled_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT stripe_payment_fee_runtime_pair CHECK (
        (stripe_account_id IS NULL) = (stripe_livemode IS NULL)
    ),
    CONSTRAINT stripe_payment_fee_reconciled_shape CHECK (
        status <> 'reconciled' OR (
            stripe_account_id IS NOT NULL
            AND stripe_livemode IS NOT NULL
            AND reconciled_transaction_count >= 1
            AND last_error_code IS NULL
            AND last_attempted_at IS NOT NULL
            AND reconciled_at IS NOT NULL
        )
    ),
    CONSTRAINT stripe_payment_fee_timestamps CHECK (
        (last_attempted_at IS NULL OR (
            pg_catalog.isfinite(last_attempted_at)
            AND date_trunc('second', last_attempted_at) = last_attempted_at
        ))
        AND (reconciled_at IS NULL OR (
            pg_catalog.isfinite(reconciled_at)
            AND date_trunc('second', reconciled_at) = reconciled_at
            AND last_attempted_at IS NOT NULL
            AND reconciled_at = last_attempted_at
        ))
        AND pg_catalog.isfinite(created_at)
        AND pg_catalog.isfinite(updated_at)
    )
);

CREATE TABLE public.stripe_payment_balance_transactions (
    stripe_account_id TEXT NOT NULL CHECK (
        stripe_account_id ~ '^acct_[A-Za-z0-9_]+$'
    ),
    stripe_livemode BOOLEAN NOT NULL,
    stripe_balance_transaction_id TEXT NOT NULL CHECK (
        stripe_balance_transaction_id ~ '^txn_[A-Za-z0-9_]+$'
    ),
    payment_id UUID NOT NULL REFERENCES public.payments(id) ON DELETE RESTRICT,
    stripe_payment_intent_id TEXT NOT NULL CHECK (
        stripe_payment_intent_id ~ '^pi_[A-Za-z0-9_]+$'
    ),
    source_kind TEXT NOT NULL CHECK (source_kind IN ('charge', 'refund')),
    source_id TEXT NOT NULL,
    amount_cents BIGINT NOT NULL CHECK (
        amount_cents BETWEEN -1000000000000 AND 1000000000000
        AND amount_cents <> 0
    ),
    fee_cents BIGINT NOT NULL CHECK (
        fee_cents BETWEEN -1000000000000 AND 1000000000000
    ),
    net_cents BIGINT NOT NULL CHECK (
        net_cents BETWEEN -1000000000000 AND 1000000000000
        AND net_cents = amount_cents - fee_cents
    ),
    currency TEXT NOT NULL CHECK (currency ~ '^[a-z]{3}$'),
    stripe_type TEXT NOT NULL CHECK (
        char_length(stripe_type) BETWEEN 1 AND 80
        AND stripe_type = btrim(stripe_type)
        AND stripe_type !~ '[[:cntrl:]]'
    ),
    reporting_category TEXT NOT NULL CHECK (
        char_length(reporting_category) BETWEEN 1 AND 80
        AND reporting_category = btrim(reporting_category)
        AND reporting_category !~ '[[:cntrl:]]'
    ),
    balance_type TEXT NOT NULL CHECK (
        char_length(balance_type) BETWEEN 1 AND 80
        AND balance_type = btrim(balance_type)
        AND balance_type !~ '[[:cntrl:]]'
    ),
    stripe_created_at TIMESTAMPTZ NOT NULL CHECK (
        pg_catalog.isfinite(stripe_created_at)
        AND date_trunc('second', stripe_created_at) = stripe_created_at
    ),
    observed_at TIMESTAMPTZ NOT NULL CHECK (
        pg_catalog.isfinite(observed_at)
        AND date_trunc('second', observed_at) = observed_at
        AND stripe_created_at <= observed_at + INTERVAL '5 minutes'
    ),
    PRIMARY KEY (
        stripe_account_id, stripe_livemode, stripe_balance_transaction_id
    ),
    CONSTRAINT stripe_payment_balance_transaction_source_unique
        UNIQUE (payment_id, source_kind, source_id),
    CONSTRAINT stripe_payment_balance_transaction_source_shape CHECK (
        (
            source_kind = 'charge'
            AND source_id ~ '^ch_[A-Za-z0-9_]+$'
            AND amount_cents > 0
        ) OR (
            source_kind = 'refund'
            AND source_id ~ '^re_[A-Za-z0-9_]+$'
            AND amount_cents < 0
        )
    )
);

CREATE INDEX stripe_payment_balance_transactions_payment_idx
    ON public.stripe_payment_balance_transactions(payment_id, source_kind, stripe_created_at);

ALTER TABLE public.stripe_payment_fee_reconciliations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stripe_payment_balance_transactions ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION private.guard_stripe_payment_balance_transaction_immutable()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    RAISE EXCEPTION 'stripe_payment_balance_transaction_is_immutable'
        USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER guard_stripe_payment_balance_transaction_update
    BEFORE UPDATE ON public.stripe_payment_balance_transactions
    FOR EACH ROW EXECUTE FUNCTION private.guard_stripe_payment_balance_transaction_immutable();
CREATE TRIGGER guard_stripe_payment_balance_transaction_delete
    BEFORE DELETE ON public.stripe_payment_balance_transactions
    FOR EACH ROW EXECUTE FUNCTION private.guard_stripe_payment_balance_transaction_immutable();

CREATE OR REPLACE FUNCTION private.ensure_stripe_payment_fee_reconciliation_pending()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    reconciliation_row public.stripe_payment_fee_reconciliations%ROWTYPE;
BEGIN
    IF NEW.checkout_v2_cycle_id IS NULL
       OR NEW.stripe_payment_intent_id IS NULL
       OR NEW.status NOT IN (
            'succeeded'::public.payment_status,
            'refunded'::public.payment_status
       ) THEN
        RETURN NEW;
    END IF;

    IF NEW.stripe_payment_intent_id !~ '^pi_[A-Za-z0-9_]+$' THEN
        RAISE EXCEPTION 'invalid_stripe_payment_fee_payment_intent'
            USING ERRCODE = '22023';
    END IF;

    SELECT * INTO reconciliation_row
    FROM public.stripe_payment_fee_reconciliations
    WHERE payment_id = NEW.id
    FOR UPDATE;

    IF NOT FOUND THEN
        INSERT INTO public.stripe_payment_fee_reconciliations (
            payment_id, stripe_payment_intent_id
        ) VALUES (
            NEW.id, NEW.stripe_payment_intent_id
        );
        RETURN NEW;
    END IF;

    IF reconciliation_row.stripe_payment_intent_id
        IS DISTINCT FROM NEW.stripe_payment_intent_id THEN
        RAISE EXCEPTION 'stripe_payment_fee_payment_intent_conflicts'
            USING ERRCODE = '40001';
    END IF;

    IF reconciliation_row.reconciled_amount_refunded_cents
        IS DISTINCT FROM NEW.amount_refunded THEN
        UPDATE public.stripe_payment_fee_reconciliations
        SET status = 'pending',
            last_error_code = NULL,
            reconciled_at = NULL,
            updated_at = clock_timestamp()
        WHERE payment_id = NEW.id;
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER ensure_stripe_payment_fee_reconciliation_pending_trigger
    AFTER INSERT OR UPDATE OF
        checkout_v2_cycle_id, stripe_payment_intent_id, amount_refunded, status
    ON public.payments
    FOR EACH ROW
    EXECUTE FUNCTION private.ensure_stripe_payment_fee_reconciliation_pending();

INSERT INTO public.stripe_payment_fee_reconciliations (
    payment_id, stripe_payment_intent_id
)
SELECT payment.id, payment.stripe_payment_intent_id
FROM public.checkout_v2_cycles AS cycle
JOIN public.subscriptions AS subscription
  ON subscription.id = cycle.subscription_id
 AND subscription.contract_schema_version = 2
JOIN public.payments AS payment
  ON payment.id = cycle.payment_id
 AND payment.checkout_v2_cycle_id = cycle.id
 AND payment.subscription_id = subscription.id
 AND payment.student_id = subscription.student_id
WHERE payment.status IN (
        'succeeded'::public.payment_status,
        'refunded'::public.payment_status
    )
  AND payment.stripe_payment_intent_id ~ '^pi_[A-Za-z0-9_]+$'
ON CONFLICT (payment_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.mark_stripe_payment_fee_reconciliation_pending(
    p_payment_id UUID,
    p_stripe_account_id TEXT,
    p_stripe_livemode BOOLEAN,
    p_error_code TEXT,
    p_attempted_at TIMESTAMPTZ
)
RETURNS public.stripe_payment_fee_reconciliations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    payment_row public.payments%ROWTYPE;
    reconciliation_row public.stripe_payment_fee_reconciliations%ROWTYPE;
BEGIN
    IF p_payment_id IS NULL
       OR p_stripe_account_id IS NULL
       OR p_stripe_account_id !~ '^acct_[A-Za-z0-9_]+$'
       OR p_stripe_livemode IS NULL
       OR p_error_code IS NULL
       OR p_error_code !~ '^[a-z0-9_]{3,80}$'
       OR p_attempted_at IS NULL
       OR NOT pg_catalog.isfinite(p_attempted_at)
       OR date_trunc('second', p_attempted_at) IS DISTINCT FROM p_attempted_at
       OR p_attempted_at > clock_timestamp() + INTERVAL '5 minutes' THEN
        RAISE EXCEPTION 'invalid_stripe_payment_fee_pending_observation'
            USING ERRCODE = '22023';
    END IF;

    SELECT payment.* INTO payment_row
    FROM public.payments AS payment
    JOIN public.checkout_v2_cycles AS cycle
      ON cycle.id = payment.checkout_v2_cycle_id
     AND cycle.payment_id = payment.id
    JOIN public.subscriptions AS subscription
      ON subscription.id = cycle.subscription_id
     AND subscription.id = payment.subscription_id
     AND subscription.student_id = payment.student_id
     AND subscription.contract_schema_version = 2
    WHERE payment.id = p_payment_id
      AND payment.status IN (
            'succeeded'::public.payment_status,
            'refunded'::public.payment_status
      )
    FOR UPDATE OF payment;

    IF NOT FOUND OR payment_row.stripe_payment_intent_id IS NULL THEN
        RAISE EXCEPTION 'stripe_payment_fee_payment_not_found'
            USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.stripe_payment_fee_reconciliations (
        payment_id, stripe_payment_intent_id
    ) VALUES (
        payment_row.id, payment_row.stripe_payment_intent_id
    ) ON CONFLICT (payment_id) DO NOTHING;

    SELECT * INTO reconciliation_row
    FROM public.stripe_payment_fee_reconciliations
    WHERE payment_id = payment_row.id
    FOR UPDATE;

    IF reconciliation_row.stripe_payment_intent_id
            IS DISTINCT FROM payment_row.stripe_payment_intent_id
       OR (
            reconciliation_row.stripe_account_id IS NOT NULL
            AND reconciliation_row.stripe_account_id IS DISTINCT FROM p_stripe_account_id
       )
       OR (
            reconciliation_row.stripe_livemode IS NOT NULL
            AND reconciliation_row.stripe_livemode IS DISTINCT FROM p_stripe_livemode
       ) THEN
        RAISE EXCEPTION 'stripe_payment_fee_runtime_conflicts'
            USING ERRCODE = '40001';
    END IF;

    UPDATE public.stripe_payment_fee_reconciliations
    SET status = 'pending',
        stripe_account_id = p_stripe_account_id,
        stripe_livemode = p_stripe_livemode,
        last_error_code = p_error_code,
        last_attempted_at = p_attempted_at,
        reconciled_at = NULL,
        updated_at = clock_timestamp()
    WHERE payment_id = payment_row.id
    RETURNING * INTO reconciliation_row;

    RETURN reconciliation_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.reconcile_stripe_payment_fees(
    p_payment_id UUID,
    p_stripe_account_id TEXT,
    p_stripe_livemode BOOLEAN,
    p_charge_id TEXT,
    p_amount_refunded_cents INTEGER,
    p_transactions JSONB,
    p_observed_at TIMESTAMPTZ
)
RETURNS public.stripe_payment_fee_reconciliations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    payment_row public.payments%ROWTYPE;
    reconciliation_row public.stripe_payment_fee_reconciliations%ROWTYPE;
    transaction_row public.stripe_payment_balance_transactions%ROWTYPE;
    existing_transaction public.stripe_payment_balance_transactions%ROWTYPE;
    transaction_json JSONB;
    transaction_keys TEXT[];
    expected_keys CONSTANT TEXT[] := ARRAY[
        'amount_cents', 'balance_type', 'currency', 'fee_cents', 'net_cents',
        'reporting_category', 'source_id', 'source_kind',
        'stripe_balance_transaction_id', 'stripe_created_at', 'stripe_type'
    ];
    input_transaction_count INTEGER := 0;
    input_charge_count INTEGER := 0;
    input_refund_amount_cents BIGINT := 0;
    recorded_transaction_count INTEGER;
    recorded_charge_count INTEGER;
    recorded_refund_amount_cents BIGINT;
BEGIN
    IF p_payment_id IS NULL
       OR p_stripe_account_id IS NULL
       OR p_stripe_account_id !~ '^acct_[A-Za-z0-9_]+$'
       OR p_stripe_livemode IS NULL
       OR p_charge_id IS NULL
       OR p_charge_id !~ '^ch_[A-Za-z0-9_]+$'
       OR p_amount_refunded_cents IS NULL
       OR p_amount_refunded_cents < 0
       OR p_transactions IS NULL
       OR jsonb_typeof(p_transactions) IS DISTINCT FROM 'array'
       OR jsonb_array_length(p_transactions) NOT BETWEEN 1 AND 1001
       OR p_observed_at IS NULL
       OR NOT pg_catalog.isfinite(p_observed_at)
       OR date_trunc('second', p_observed_at) IS DISTINCT FROM p_observed_at
       OR p_observed_at > clock_timestamp() + INTERVAL '5 minutes' THEN
        RAISE EXCEPTION 'invalid_stripe_payment_fee_snapshot'
            USING ERRCODE = '22023';
    END IF;

    SELECT payment.* INTO payment_row
    FROM public.payments AS payment
    JOIN public.checkout_v2_cycles AS cycle
      ON cycle.id = payment.checkout_v2_cycle_id
     AND cycle.payment_id = payment.id
    JOIN public.subscriptions AS subscription
      ON subscription.id = cycle.subscription_id
     AND subscription.id = payment.subscription_id
     AND subscription.student_id = payment.student_id
     AND subscription.contract_schema_version = 2
    WHERE payment.id = p_payment_id
      AND payment.status IN (
            'succeeded'::public.payment_status,
            'refunded'::public.payment_status
      )
    FOR UPDATE OF payment;

    IF NOT FOUND
       OR payment_row.stripe_payment_intent_id IS NULL
       OR payment_row.stripe_payment_intent_id !~ '^pi_[A-Za-z0-9_]+$'
       OR payment_row.amount <= 0
       OR lower(payment_row.currency) <> 'eur'
       OR payment_row.amount_refunded IS DISTINCT FROM p_amount_refunded_cents THEN
        RAISE EXCEPTION 'stripe_payment_fee_payment_conflicts'
            USING ERRCODE = '40001';
    END IF;

    INSERT INTO public.stripe_payment_fee_reconciliations (
        payment_id, stripe_payment_intent_id
    ) VALUES (
        payment_row.id, payment_row.stripe_payment_intent_id
    ) ON CONFLICT (payment_id) DO NOTHING;

    SELECT * INTO reconciliation_row
    FROM public.stripe_payment_fee_reconciliations
    WHERE payment_id = payment_row.id
    FOR UPDATE;

    IF reconciliation_row.stripe_payment_intent_id
            IS DISTINCT FROM payment_row.stripe_payment_intent_id
       OR (
            reconciliation_row.stripe_account_id IS NOT NULL
            AND reconciliation_row.stripe_account_id IS DISTINCT FROM p_stripe_account_id
       )
       OR (
            reconciliation_row.stripe_livemode IS NOT NULL
            AND reconciliation_row.stripe_livemode IS DISTINCT FROM p_stripe_livemode
       ) THEN
        RAISE EXCEPTION 'stripe_payment_fee_runtime_conflicts'
            USING ERRCODE = '40001';
    END IF;

    FOR transaction_json IN
        SELECT value FROM jsonb_array_elements(p_transactions)
    LOOP
        IF jsonb_typeof(transaction_json) IS DISTINCT FROM 'object' THEN
            RAISE EXCEPTION 'invalid_stripe_payment_fee_transaction'
                USING ERRCODE = '22023';
        END IF;

        SELECT array_agg(key ORDER BY key) INTO transaction_keys
        FROM jsonb_object_keys(transaction_json) AS key_name(key);
        IF transaction_keys IS DISTINCT FROM expected_keys THEN
            RAISE EXCEPTION 'invalid_stripe_payment_fee_transaction_keys'
                USING ERRCODE = '22023';
        END IF;

        IF jsonb_typeof(transaction_json->'amount_cents') IS DISTINCT FROM 'number'
           OR jsonb_typeof(transaction_json->'fee_cents') IS DISTINCT FROM 'number'
           OR jsonb_typeof(transaction_json->'net_cents') IS DISTINCT FROM 'number'
           OR (transaction_json->>'amount_cents') !~ '^-?[0-9]+$'
           OR (transaction_json->>'fee_cents') !~ '^-?[0-9]+$'
           OR (transaction_json->>'net_cents') !~ '^-?[0-9]+$'
           OR jsonb_typeof(transaction_json->'stripe_created_at') IS DISTINCT FROM 'string' THEN
            RAISE EXCEPTION 'invalid_stripe_payment_fee_transaction_values'
                USING ERRCODE = '22023';
        END IF;

        transaction_row := NULL;
        transaction_row.stripe_account_id := p_stripe_account_id;
        transaction_row.stripe_livemode := p_stripe_livemode;
        transaction_row.stripe_balance_transaction_id :=
            transaction_json->>'stripe_balance_transaction_id';
        transaction_row.payment_id := payment_row.id;
        transaction_row.stripe_payment_intent_id :=
            payment_row.stripe_payment_intent_id;
        transaction_row.source_kind := transaction_json->>'source_kind';
        transaction_row.source_id := transaction_json->>'source_id';
        transaction_row.amount_cents := (transaction_json->>'amount_cents')::BIGINT;
        transaction_row.fee_cents := (transaction_json->>'fee_cents')::BIGINT;
        transaction_row.net_cents := (transaction_json->>'net_cents')::BIGINT;
        transaction_row.currency := lower(transaction_json->>'currency');
        transaction_row.stripe_type := transaction_json->>'stripe_type';
        transaction_row.reporting_category := transaction_json->>'reporting_category';
        transaction_row.balance_type := transaction_json->>'balance_type';
        transaction_row.stripe_created_at :=
            (transaction_json->>'stripe_created_at')::TIMESTAMPTZ;
        transaction_row.observed_at := p_observed_at;

        IF transaction_row.stripe_balance_transaction_id
                !~ '^txn_[A-Za-z0-9_]+$'
           OR transaction_row.source_kind NOT IN ('charge', 'refund')
           OR transaction_row.source_id IS NULL
           OR transaction_row.amount_cents NOT BETWEEN -1000000000000 AND 1000000000000
           OR transaction_row.amount_cents = 0
           OR transaction_row.fee_cents NOT BETWEEN -1000000000000 AND 1000000000000
           OR transaction_row.net_cents NOT BETWEEN -1000000000000 AND 1000000000000
           OR transaction_row.net_cents IS DISTINCT FROM
                transaction_row.amount_cents - transaction_row.fee_cents
           OR transaction_row.currency IS DISTINCT FROM lower(payment_row.currency)
           OR transaction_row.stripe_type IS NULL
           OR char_length(transaction_row.stripe_type) NOT BETWEEN 1 AND 80
           OR transaction_row.stripe_type IS DISTINCT FROM btrim(transaction_row.stripe_type)
           OR transaction_row.stripe_type ~ '[[:cntrl:]]'
           OR transaction_row.reporting_category IS NULL
           OR char_length(transaction_row.reporting_category) NOT BETWEEN 1 AND 80
           OR transaction_row.reporting_category
                IS DISTINCT FROM btrim(transaction_row.reporting_category)
           OR transaction_row.reporting_category ~ '[[:cntrl:]]'
           OR transaction_row.balance_type IS NULL
           OR char_length(transaction_row.balance_type) NOT BETWEEN 1 AND 80
           OR transaction_row.balance_type IS DISTINCT FROM btrim(transaction_row.balance_type)
           OR transaction_row.balance_type ~ '[[:cntrl:]]'
           OR transaction_row.stripe_created_at IS NULL
           OR NOT pg_catalog.isfinite(transaction_row.stripe_created_at)
           OR date_trunc('second', transaction_row.stripe_created_at)
                IS DISTINCT FROM transaction_row.stripe_created_at
           OR transaction_row.stripe_created_at > p_observed_at + INTERVAL '5 minutes' THEN
            RAISE EXCEPTION 'invalid_stripe_payment_fee_transaction'
                USING ERRCODE = '22023';
        END IF;

        IF transaction_row.source_kind = 'charge' THEN
            IF transaction_row.source_id IS DISTINCT FROM p_charge_id
               OR transaction_row.source_id !~ '^ch_[A-Za-z0-9_]+$'
               OR transaction_row.amount_cents IS DISTINCT FROM payment_row.amount THEN
                RAISE EXCEPTION 'stripe_payment_fee_charge_conflicts'
                    USING ERRCODE = '40001';
            END IF;
            input_charge_count := input_charge_count + 1;
        ELSE
            IF transaction_row.source_id !~ '^re_[A-Za-z0-9_]+$'
               OR transaction_row.amount_cents >= 0 THEN
                RAISE EXCEPTION 'stripe_payment_fee_refund_conflicts'
                    USING ERRCODE = '40001';
            END IF;
            input_refund_amount_cents := input_refund_amount_cents
                - transaction_row.amount_cents;
        END IF;
        input_transaction_count := input_transaction_count + 1;

        BEGIN
            INSERT INTO public.stripe_payment_balance_transactions
            VALUES (transaction_row.*);
        EXCEPTION WHEN unique_violation THEN
            NULL;
        END;

        SELECT * INTO existing_transaction
        FROM public.stripe_payment_balance_transactions
        WHERE stripe_account_id = p_stripe_account_id
          AND stripe_livemode = p_stripe_livemode
          AND stripe_balance_transaction_id =
                transaction_row.stripe_balance_transaction_id;

        -- observed_at records when immutable evidence was first captured. A
        -- later webhook/admin retry may observe the same Stripe object again;
        -- that must be idempotent without rewriting the original timestamp.
        IF FOUND THEN
            transaction_row.observed_at := existing_transaction.observed_at;
        END IF;

        IF NOT FOUND
           OR to_jsonb(existing_transaction) IS DISTINCT FROM to_jsonb(transaction_row) THEN
            RAISE EXCEPTION 'stripe_payment_fee_transaction_identity_conflicts'
                USING ERRCODE = '40001';
        END IF;
    END LOOP;

    IF input_charge_count <> 1
       OR input_refund_amount_cents IS DISTINCT FROM p_amount_refunded_cents::BIGINT THEN
        RAISE EXCEPTION 'stripe_payment_fee_snapshot_is_incomplete'
            USING ERRCODE = '55000';
    END IF;

    SELECT
        COUNT(*)::INTEGER,
        COUNT(*) FILTER (WHERE source_kind = 'charge')::INTEGER,
        COALESCE(-SUM(amount_cents) FILTER (WHERE source_kind = 'refund'), 0)::BIGINT
    INTO
        recorded_transaction_count,
        recorded_charge_count,
        recorded_refund_amount_cents
    FROM public.stripe_payment_balance_transactions
    WHERE payment_id = payment_row.id
      AND stripe_account_id = p_stripe_account_id
      AND stripe_livemode = p_stripe_livemode;

    IF recorded_transaction_count IS DISTINCT FROM input_transaction_count
       OR recorded_charge_count IS DISTINCT FROM 1
       OR recorded_refund_amount_cents
            IS DISTINCT FROM p_amount_refunded_cents::BIGINT THEN
        RAISE EXCEPTION 'stripe_payment_fee_ledger_conflicts'
            USING ERRCODE = '40001';
    END IF;

    UPDATE public.stripe_payment_fee_reconciliations
    SET status = 'reconciled',
        stripe_account_id = p_stripe_account_id,
        stripe_livemode = p_stripe_livemode,
        reconciled_amount_refunded_cents = p_amount_refunded_cents,
        reconciled_transaction_count = input_transaction_count,
        last_error_code = NULL,
        last_attempted_at = p_observed_at,
        reconciled_at = p_observed_at,
        updated_at = clock_timestamp()
    WHERE payment_id = payment_row.id
    RETURNING * INTO reconciliation_row;

    RETURN reconciliation_row;
END;
$$;

CREATE VIEW public.stripe_payment_fee_status
WITH (security_invoker = true)
AS
SELECT
    reconciliation.payment_id,
    payment.student_id,
    payment.subscription_id,
    payment.checkout_v2_cycle_id,
    reconciliation.stripe_payment_intent_id,
    reconciliation.status AS reconciliation_status,
    payment.amount AS gross_amount_cents,
    payment.amount_refunded AS amount_refunded_cents,
    lower(payment.currency) AS currency,
    CASE WHEN reconciliation.status = 'reconciled'
        THEN COALESCE(SUM(transaction.fee_cents), 0)::BIGINT
        ELSE NULL::BIGINT
    END AS stripe_fee_cents,
    reconciliation.reconciled_transaction_count,
    reconciliation.last_error_code,
    reconciliation.last_attempted_at,
    reconciliation.reconciled_at
FROM public.stripe_payment_fee_reconciliations AS reconciliation
JOIN public.payments AS payment ON payment.id = reconciliation.payment_id
LEFT JOIN public.stripe_payment_balance_transactions AS transaction
  ON transaction.payment_id = reconciliation.payment_id
 AND transaction.stripe_account_id = reconciliation.stripe_account_id
 AND transaction.stripe_livemode = reconciliation.stripe_livemode
GROUP BY
    reconciliation.payment_id,
    payment.student_id,
    payment.subscription_id,
    payment.checkout_v2_cycle_id,
    reconciliation.stripe_payment_intent_id,
    reconciliation.status,
    payment.amount,
    payment.amount_refunded,
    payment.currency,
    reconciliation.reconciled_transaction_count,
    reconciliation.last_error_code,
    reconciliation.last_attempted_at,
    reconciliation.reconciled_at;

DROP VIEW public.portfolio_unit_economics;
DROP VIEW public.acquisition_campaign_unit_economics;
DROP VIEW public.student_unit_economics;

CREATE VIEW public.student_unit_economics
WITH (security_invoker = true)
AS
WITH paid_cycles AS (
    SELECT
        payment.student_id,
        COUNT(DISTINCT subscription.id)::INTEGER AS subscription_count,
        COUNT(*)::INTEGER AS paid_cycle_count,
        SUM(payment.amount)::BIGINT AS gross_revenue_cents,
        SUM(payment.amount_refunded)::BIGINT AS refunds_cents,
        SUM(payment.amount - payment.amount_refunded)::BIGINT AS net_revenue_cents,
        COUNT(*) FILTER (
            WHERE fee.reconciliation_status IS DISTINCT FROM 'reconciled'
        )::INTEGER AS unreconciled_payment_count,
        CASE WHEN bool_and(fee.reconciliation_status = 'reconciled')
            THEN SUM(fee.stripe_fee_cents)::BIGINT
            ELSE NULL::BIGINT
        END AS stripe_fee_cents,
        MIN(payment.created_at) AS first_paid_at
    FROM public.checkout_v2_cycles AS cycle
    JOIN public.subscriptions AS subscription
      ON subscription.id = cycle.subscription_id
     AND subscription.contract_schema_version = 2
    JOIN public.payments AS payment
      ON payment.id = cycle.payment_id
     AND payment.checkout_v2_cycle_id = cycle.id
     AND payment.subscription_id = subscription.id
     AND payment.student_id = subscription.student_id
     AND payment.status IN ('succeeded'::public.payment_status,
                            'refunded'::public.payment_status)
     AND payment.amount = cycle.amount_cents
     AND lower(payment.currency) = cycle.currency
    LEFT JOIN public.stripe_payment_fee_status AS fee
      ON fee.payment_id = payment.id
    GROUP BY payment.student_id
), first_paid_cycle AS (
    SELECT DISTINCT ON (subscription.student_id)
        subscription.student_id, cycle.id AS first_cycle_id
    FROM public.checkout_v2_cycles AS cycle
    JOIN public.subscriptions AS subscription
      ON subscription.id = cycle.subscription_id
     AND subscription.contract_schema_version = 2
    JOIN public.payments AS payment
      ON payment.id = cycle.payment_id
     AND payment.checkout_v2_cycle_id = cycle.id
     AND payment.status IN ('succeeded'::public.payment_status,
                            'refunded'::public.payment_status)
    WHERE cycle.cycle_number = 1 AND cycle.cycle_kind = 'initial'
    ORDER BY subscription.student_id, payment.created_at, cycle.id
), teacher_costs AS (
    SELECT student_id, SUM(amount_cents)::BIGINT AS amount_cents
    FROM public.teacher_compensation_ledger GROUP BY student_id
), direct_costs AS (
    SELECT student_id, SUM(balance_amount_cents)::BIGINT AS amount_cents
    FROM public.operational_cost_balances
    WHERE student_id IS NOT NULL GROUP BY student_id
), active_allocation AS (
    SELECT allocation.student_id, allocation.first_cycle_id,
        allocation.campaign_id, campaign.name AS campaign_name,
        allocation.basis, allocation.balance_amount_cents
    FROM public.acquisition_cost_allocation_balances AS allocation
    JOIN public.acquisition_campaigns AS campaign
      ON campaign.id = allocation.campaign_id
    WHERE allocation.balance_amount_cents > 0
)
SELECT
    paid.student_id,
    profile.full_name AS student_full_name,
    profile.email AS student_email,
    paid.first_paid_at,
    COALESCE(allocation.first_cycle_id, first_cycle.first_cycle_id) AS first_cycle_id,
    allocation.campaign_id AS active_campaign_id,
    allocation.campaign_name AS active_campaign_name,
    allocation.basis AS acquisition_basis,
    paid.subscription_count,
    paid.paid_cycle_count,
    paid.gross_revenue_cents,
    paid.refunds_cents,
    paid.net_revenue_cents,
    paid.unreconciled_payment_count,
    CASE WHEN paid.unreconciled_payment_count = 0
        THEN 'reconciled' ELSE 'pending'
    END::TEXT AS stripe_fee_reconciliation_status,
    paid.stripe_fee_cents,
    COALESCE(teacher.amount_cents, 0)::BIGINT AS teacher_compensation_cents,
    COALESCE(direct.amount_cents, 0)::BIGINT AS direct_operational_cost_cents,
    COALESCE(allocation.balance_amount_cents, 0)::BIGINT AS acquisition_cost_cents,
    CASE WHEN paid.unreconciled_payment_count = 0 THEN (
        paid.net_revenue_cents - paid.stripe_fee_cents
        - COALESCE(teacher.amount_cents, 0)
        - COALESCE(direct.amount_cents, 0)
        - COALESCE(allocation.balance_amount_cents, 0)
    )::BIGINT ELSE NULL::BIGINT END AS provisional_contribution_cents,
    'eur'::TEXT AS currency
FROM paid_cycles AS paid
JOIN public.profiles AS profile ON profile.id = paid.student_id
JOIN first_paid_cycle AS first_cycle ON first_cycle.student_id = paid.student_id
LEFT JOIN teacher_costs AS teacher ON teacher.student_id = paid.student_id
LEFT JOIN direct_costs AS direct ON direct.student_id = paid.student_id
LEFT JOIN active_allocation AS allocation ON allocation.student_id = paid.student_id;

CREATE VIEW public.acquisition_campaign_unit_economics
WITH (security_invoker = true)
AS
WITH campaign_spend AS (
    SELECT campaign_id, SUM(balance_amount_cents)::BIGINT AS amount_cents
    FROM public.operational_cost_balances
    WHERE cost_kind = 'acquisition_spend' GROUP BY campaign_id
), positive_allocations AS (
    SELECT campaign_id, student_id, balance_amount_cents
    FROM public.acquisition_cost_allocation_balances
    WHERE balance_amount_cents > 0
), acquired AS (
    SELECT
        allocation.campaign_id,
        COUNT(*)::INTEGER AS acquired_student_count,
        SUM(student.gross_revenue_cents)::BIGINT AS gross_revenue_cents,
        SUM(student.refunds_cents)::BIGINT AS refunds_cents,
        SUM(student.net_revenue_cents)::BIGINT AS net_revenue_cents,
        SUM(student.unreconciled_payment_count)::INTEGER AS unreconciled_payment_count,
        CASE WHEN SUM(student.unreconciled_payment_count) = 0
            THEN SUM(student.stripe_fee_cents)::BIGINT
            ELSE NULL::BIGINT
        END AS stripe_fee_cents,
        SUM(student.teacher_compensation_cents)::BIGINT AS teacher_compensation_cents,
        SUM(student.direct_operational_cost_cents)::BIGINT AS direct_cost_cents,
        SUM(allocation.balance_amount_cents)::BIGINT AS allocated_cents
    FROM positive_allocations AS allocation
    JOIN public.student_unit_economics AS student
      ON student.student_id = allocation.student_id
    GROUP BY allocation.campaign_id
)
SELECT
    campaign.id AS campaign_id,
    campaign.name AS campaign_name,
    campaign.provider,
    CASE WHEN campaign.utm_source IS NULL THEN 'manual' ELSE 'observed_utm' END
        AS attribution_mode,
    campaign.utm_source,
    campaign.utm_medium,
    campaign.utm_campaign,
    campaign.utm_term,
    campaign.utm_content,
    campaign.created_at,
    COALESCE(acquired.acquired_student_count, 0)::INTEGER AS acquired_student_count,
    COALESCE(acquired.gross_revenue_cents, 0)::BIGINT AS gross_revenue_cents,
    COALESCE(acquired.refunds_cents, 0)::BIGINT AS refunds_cents,
    COALESCE(acquired.net_revenue_cents, 0)::BIGINT AS net_revenue_cents,
    COALESCE(acquired.unreconciled_payment_count, 0)::INTEGER
        AS unreconciled_payment_count,
    CASE WHEN COALESCE(acquired.unreconciled_payment_count, 0) = 0
        THEN 'reconciled' ELSE 'pending'
    END::TEXT AS stripe_fee_reconciliation_status,
    CASE WHEN COALESCE(acquired.unreconciled_payment_count, 0) = 0
        THEN COALESCE(acquired.stripe_fee_cents, 0)::BIGINT
        ELSE NULL::BIGINT
    END AS stripe_fee_cents,
    COALESCE(acquired.teacher_compensation_cents, 0)::BIGINT
        AS teacher_compensation_cents,
    COALESCE(acquired.direct_cost_cents, 0)::BIGINT
        AS direct_operational_cost_cents,
    COALESCE(acquired.allocated_cents, 0)::BIGINT
        AS allocated_acquisition_cost_cents,
    COALESCE(spend.amount_cents, 0)::BIGINT AS campaign_spend_cents,
    GREATEST(
        COALESCE(spend.amount_cents, 0) - COALESCE(acquired.allocated_cents, 0), 0
    )::BIGINT AS unallocated_spend_cents,
    CASE WHEN COALESCE(acquired.unreconciled_payment_count, 0) = 0 THEN (
        COALESCE(acquired.net_revenue_cents, 0)
        - COALESCE(acquired.stripe_fee_cents, 0)
        - COALESCE(acquired.teacher_compensation_cents, 0)
        - COALESCE(acquired.direct_cost_cents, 0)
        - COALESCE(spend.amount_cents, 0)
    )::BIGINT ELSE NULL::BIGINT END AS provisional_contribution_cents,
    'eur'::TEXT AS currency
FROM public.acquisition_campaigns AS campaign
LEFT JOIN campaign_spend AS spend ON spend.campaign_id = campaign.id
LEFT JOIN acquired ON acquired.campaign_id = campaign.id;

CREATE VIEW public.portfolio_unit_economics
WITH (security_invoker = true)
AS
WITH students AS (
    SELECT
        COUNT(*)::INTEGER AS student_count,
        COALESCE(SUM(gross_revenue_cents), 0)::BIGINT AS gross_revenue_cents,
        COALESCE(SUM(refunds_cents), 0)::BIGINT AS refunds_cents,
        COALESCE(SUM(net_revenue_cents), 0)::BIGINT AS net_revenue_cents,
        COALESCE(SUM(unreconciled_payment_count), 0)::INTEGER
            AS unreconciled_payment_count,
        CASE WHEN COALESCE(SUM(unreconciled_payment_count), 0) = 0
            THEN COALESCE(SUM(stripe_fee_cents), 0)::BIGINT
            ELSE NULL::BIGINT
        END AS stripe_fee_cents,
        COALESCE(SUM(teacher_compensation_cents), 0)::BIGINT
            AS teacher_compensation_cents,
        COALESCE(SUM(direct_operational_cost_cents), 0)::BIGINT
            AS direct_operational_cost_cents
    FROM public.student_unit_economics
), campaign_totals AS (
    SELECT
        COALESCE(SUM(campaign_spend_cents), 0)::BIGINT AS campaign_spend_cents,
        COALESCE(SUM(allocated_acquisition_cost_cents), 0)::BIGINT
            AS allocated_acquisition_cost_cents
    FROM public.acquisition_campaign_unit_economics
)
SELECT
    'all'::TEXT AS portfolio_key,
    students.student_count,
    students.gross_revenue_cents,
    students.refunds_cents,
    students.net_revenue_cents,
    students.unreconciled_payment_count,
    CASE WHEN students.unreconciled_payment_count = 0
        THEN 'reconciled' ELSE 'pending'
    END::TEXT AS stripe_fee_reconciliation_status,
    students.stripe_fee_cents,
    students.teacher_compensation_cents,
    students.direct_operational_cost_cents,
    campaigns.campaign_spend_cents,
    campaigns.allocated_acquisition_cost_cents,
    GREATEST(
        campaigns.campaign_spend_cents - campaigns.allocated_acquisition_cost_cents,
        0
    )::BIGINT AS unallocated_acquisition_cost_cents,
    CASE WHEN students.unreconciled_payment_count = 0 THEN (
        students.net_revenue_cents - students.stripe_fee_cents
        - students.teacher_compensation_cents
        - students.direct_operational_cost_cents - campaigns.campaign_spend_cents
    )::BIGINT ELSE NULL::BIGINT END AS provisional_contribution_cents,
    'eur'::TEXT AS currency
FROM students CROSS JOIN campaign_totals AS campaigns;

REVOKE ALL ON TABLE public.stripe_payment_fee_reconciliations,
    public.stripe_payment_balance_transactions,
    public.stripe_payment_fee_status,
    public.student_unit_economics,
    public.acquisition_campaign_unit_economics,
    public.portfolio_unit_economics
FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT ON TABLE public.stripe_payment_fee_reconciliations,
    public.stripe_payment_balance_transactions,
    public.stripe_payment_fee_status,
    public.student_unit_economics,
    public.acquisition_campaign_unit_economics,
    public.portfolio_unit_economics
TO service_role;

REVOKE ALL ON FUNCTION public.mark_stripe_payment_fee_reconciliation_pending(
    UUID, TEXT, BOOLEAN, TEXT, TIMESTAMPTZ
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_stripe_payment_fee_reconciliation_pending(
    UUID, TEXT, BOOLEAN, TEXT, TIMESTAMPTZ
) TO service_role;

REVOKE ALL ON FUNCTION public.reconcile_stripe_payment_fees(
    UUID, TEXT, BOOLEAN, TEXT, INTEGER, JSONB, TIMESTAMPTZ
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_stripe_payment_fees(
    UUID, TEXT, BOOLEAN, TEXT, INTEGER, JSONB, TIMESTAMPTZ
) TO service_role;

REVOKE ALL ON FUNCTION
    private.guard_stripe_payment_balance_transaction_immutable(),
    private.ensure_stripe_payment_fee_reconciliation_pending()
FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON TABLE public.stripe_payment_fee_reconciliations IS
    'Per-payment completeness state for authoritative Stripe fee reconciliation; pending is never interpreted as zero fees.';
COMMENT ON TABLE public.stripe_payment_balance_transactions IS
    'Immutable Stripe charge/refund balance transactions linked to Checkout V2 payments.';
COMMENT ON VIEW public.stripe_payment_fee_status IS
    'Service-only payment fee status and reconciled net Stripe fee in the charged currency.';
COMMENT ON VIEW public.student_unit_economics IS
    'Provisional operating contribution by paid Checkout V2 student; contribution is NULL until every Stripe fee is reconciled and still excludes tax, reserves, payouts and distributable profit.';
COMMENT ON VIEW public.portfolio_unit_economics IS
    'Single-row provisional portfolio contribution; contribution is NULL while any Stripe fee is pending and total campaign spend is subtracted once.';
