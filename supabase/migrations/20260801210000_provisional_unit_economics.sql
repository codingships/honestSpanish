-- Provisional operational unit economics. These records describe internal
-- operating facts only; they do not represent tax, reserves, payouts or
-- distributable profit.

ALTER TABLE public.crm_contacts
    ADD CONSTRAINT crm_contacts_id_profile_id_key UNIQUE (id, profile_id);
ALTER TABLE public.subscriptions
    ADD CONSTRAINT subscriptions_id_student_checkout_key
    UNIQUE (id, student_id, checkout_intent_id);
ALTER TABLE public.checkout_v2_cycles
    ADD CONSTRAINT checkout_v2_cycles_id_subscription_key
    UNIQUE (id, subscription_id);
ALTER TABLE public.acquisition_attribution_events
    ADD CONSTRAINT acquisition_attribution_event_identity_key
    UNIQUE (id, contact_id, checkout_intent_id);

CREATE TABLE public.acquisition_campaigns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id UUID NOT NULL UNIQUE,
    name TEXT NOT NULL CHECK (char_length(btrim(name)) BETWEEN 2 AND 200),
    provider TEXT NOT NULL CHECK (
        char_length(provider) BETWEEN 2 AND 100
        AND provider = btrim(provider)
        AND provider !~ '[[:cntrl:]]'
    ),
    external_reference TEXT CHECK (
        external_reference IS NULL OR (
            char_length(external_reference) BETWEEN 1 AND 200
            AND external_reference = btrim(external_reference)
            AND external_reference !~ '[[:cntrl:]]'
        )
    ),
    utm_source TEXT,
    utm_medium TEXT,
    utm_campaign TEXT,
    utm_term TEXT,
    utm_content TEXT,
    created_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT acquisition_campaign_attribution_shape CHECK (
        (
            utm_source IS NULL AND utm_medium IS NULL AND utm_campaign IS NULL
            AND utm_term IS NULL AND utm_content IS NULL
        ) OR (
            utm_source IS NOT NULL AND utm_medium IS NOT NULL
            AND utm_campaign IS NOT NULL
        )
    ),
    CONSTRAINT acquisition_campaign_utm_shape CHECK (
        (utm_source IS NULL OR (
            char_length(utm_source) BETWEEN 1 AND 100
            AND utm_source ~ '^[A-Za-z0-9._~-]+$'
        ))
        AND (utm_medium IS NULL OR (
            char_length(utm_medium) BETWEEN 1 AND 100
            AND utm_medium ~ '^[A-Za-z0-9._~-]+$'
        ))
        AND (utm_campaign IS NULL OR (
            char_length(utm_campaign) BETWEEN 1 AND 100
            AND utm_campaign ~ '^[A-Za-z0-9._~-]+$'
        ))
        AND (utm_term IS NULL OR (
            char_length(utm_term) BETWEEN 1 AND 100
            AND utm_term ~ '^[A-Za-z0-9._~-]+$'
        ))
        AND (utm_content IS NULL OR (
            char_length(utm_content) BETWEEN 1 AND 100
            AND utm_content ~ '^[A-Za-z0-9._~-]+$'
        ))
        AND COALESCE(char_length(utm_source), 0)
            + COALESCE(char_length(utm_medium), 0)
            + COALESCE(char_length(utm_campaign), 0)
            + COALESCE(char_length(utm_term), 0)
            + COALESCE(char_length(utm_content), 0) <= 500
    )
);

CREATE UNIQUE INDEX acquisition_campaigns_observed_utm_unique_idx
    ON public.acquisition_campaigns (
        utm_source, utm_medium, utm_campaign,
        COALESCE(utm_term, ''), COALESCE(utm_content, '')
    ) WHERE utm_source IS NOT NULL;
CREATE UNIQUE INDEX acquisition_campaigns_external_reference_unique_idx
    ON public.acquisition_campaigns(provider, external_reference)
    WHERE external_reference IS NOT NULL;

CREATE TABLE public.operational_cost_ledger (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id UUID NOT NULL UNIQUE,
    entry_kind TEXT NOT NULL CHECK (entry_kind IN ('original', 'adjustment')),
    original_cost_id UUID REFERENCES public.operational_cost_ledger(id) ON DELETE RESTRICT,
    cost_kind TEXT NOT NULL CHECK (cost_kind IN (
        'acquisition_spend', 'delivery_material', 'student_tool', 'other_direct'
    )),
    campaign_id UUID REFERENCES public.acquisition_campaigns(id) ON DELETE RESTRICT,
    student_id UUID REFERENCES public.profiles(id) ON DELETE RESTRICT,
    amount_delta_cents BIGINT NOT NULL CHECK (
        amount_delta_cents BETWEEN -1000000000000 AND 1000000000000
        AND amount_delta_cents <> 0
    ),
    currency TEXT NOT NULL DEFAULT 'eur' CHECK (currency = 'eur'),
    incurred_at TIMESTAMPTZ NOT NULL CHECK (pg_catalog.isfinite(incurred_at)),
    description TEXT NOT NULL CHECK (char_length(btrim(description)) BETWEEN 5 AND 1000),
    recorded_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT operational_cost_entry_shape CHECK (
        (entry_kind = 'original' AND original_cost_id IS NULL AND amount_delta_cents > 0)
        OR (entry_kind = 'adjustment' AND original_cost_id IS NOT NULL)
    ),
    CONSTRAINT operational_cost_scope_shape CHECK (
        (cost_kind = 'acquisition_spend' AND campaign_id IS NOT NULL AND student_id IS NULL)
        OR (
            cost_kind IN ('delivery_material', 'student_tool', 'other_direct')
            AND campaign_id IS NULL AND student_id IS NOT NULL
        )
    )
);

CREATE INDEX operational_cost_campaign_incurred_idx
    ON public.operational_cost_ledger(campaign_id, incurred_at, id)
    WHERE campaign_id IS NOT NULL;
CREATE INDEX operational_cost_student_incurred_idx
    ON public.operational_cost_ledger(student_id, incurred_at, id)
    WHERE student_id IS NOT NULL;
CREATE INDEX operational_cost_original_idx
    ON public.operational_cost_ledger(original_cost_id, created_at, id)
    WHERE original_cost_id IS NOT NULL;

CREATE TABLE public.acquisition_cost_allocation_ledger (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id UUID NOT NULL UNIQUE,
    entry_kind TEXT NOT NULL CHECK (entry_kind IN ('original', 'adjustment')),
    original_allocation_id UUID
        REFERENCES public.acquisition_cost_allocation_ledger(id) ON DELETE RESTRICT,
    campaign_id UUID NOT NULL REFERENCES public.acquisition_campaigns(id) ON DELETE RESTRICT,
    student_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    contact_id UUID NOT NULL,
    first_subscription_id UUID NOT NULL,
    first_cycle_id UUID NOT NULL,
    checkout_intent_id UUID NOT NULL,
    checkout_attribution_event_id UUID,
    basis TEXT NOT NULL CHECK (basis IN ('observed_checkout', 'manual')),
    amount_delta_cents BIGINT NOT NULL CHECK (
        amount_delta_cents BETWEEN -1000000000000 AND 1000000000000
        AND amount_delta_cents <> 0
    ),
    currency TEXT NOT NULL DEFAULT 'eur' CHECK (currency = 'eur'),
    reason TEXT CHECK (
        reason IS NULL OR char_length(btrim(reason)) BETWEEN 5 AND 1000
    ),
    allocated_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT acquisition_allocation_entry_shape CHECK (
        (
            entry_kind = 'original' AND original_allocation_id IS NULL
            AND amount_delta_cents > 0
        ) OR (
            entry_kind = 'adjustment' AND original_allocation_id IS NOT NULL
            AND reason IS NOT NULL
        )
    ),
    CONSTRAINT acquisition_allocation_basis_shape CHECK (
        (
            basis = 'observed_checkout'
            AND checkout_attribution_event_id IS NOT NULL
        ) OR (
            basis = 'manual'
            AND checkout_attribution_event_id IS NULL
            AND reason IS NOT NULL
        )
    ),
    CONSTRAINT acquisition_allocation_contact_student_fkey
        FOREIGN KEY (contact_id, student_id)
        REFERENCES public.crm_contacts(id, profile_id) ON DELETE RESTRICT,
    CONSTRAINT acquisition_allocation_subscription_identity_fkey
        FOREIGN KEY (first_subscription_id, student_id, checkout_intent_id)
        REFERENCES public.subscriptions(id, student_id, checkout_intent_id)
        ON DELETE RESTRICT,
    CONSTRAINT acquisition_allocation_cycle_subscription_fkey
        FOREIGN KEY (first_cycle_id, first_subscription_id)
        REFERENCES public.checkout_v2_cycles(id, subscription_id) ON DELETE RESTRICT,
    CONSTRAINT acquisition_allocation_attribution_identity_fkey
        FOREIGN KEY (
            checkout_attribution_event_id, contact_id, checkout_intent_id
        ) REFERENCES public.acquisition_attribution_events(
            id, contact_id, checkout_intent_id
        ) ON DELETE RESTRICT
);

CREATE INDEX acquisition_allocation_campaign_idx
    ON public.acquisition_cost_allocation_ledger(campaign_id, created_at, id);
CREATE INDEX acquisition_allocation_student_idx
    ON public.acquisition_cost_allocation_ledger(student_id, created_at, id);
CREATE INDEX acquisition_allocation_original_idx
    ON public.acquisition_cost_allocation_ledger(original_allocation_id, created_at, id)
    WHERE original_allocation_id IS NOT NULL;

ALTER TABLE public.acquisition_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.operational_cost_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.acquisition_cost_allocation_ledger ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.acquisition_campaigns,
    public.operational_cost_ledger,
    public.acquisition_cost_allocation_ledger
FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.acquisition_campaigns,
    public.operational_cost_ledger,
    public.acquisition_cost_allocation_ledger
TO service_role;

CREATE OR REPLACE FUNCTION private.guard_provisional_unit_economics_immutable()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    RAISE EXCEPTION 'provisional_unit_economics_entry_is_immutable'
        USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER guard_acquisition_campaign_immutable
    BEFORE UPDATE OR DELETE ON public.acquisition_campaigns
    FOR EACH ROW EXECUTE FUNCTION private.guard_provisional_unit_economics_immutable();
CREATE TRIGGER guard_operational_cost_immutable
    BEFORE UPDATE OR DELETE ON public.operational_cost_ledger
    FOR EACH ROW EXECUTE FUNCTION private.guard_provisional_unit_economics_immutable();
CREATE TRIGGER guard_acquisition_allocation_immutable
    BEFORE UPDATE OR DELETE ON public.acquisition_cost_allocation_ledger
    FOR EACH ROW EXECUTE FUNCTION private.guard_provisional_unit_economics_immutable();

CREATE OR REPLACE FUNCTION private.validate_operational_cost_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    original_row public.operational_cost_ledger%ROWTYPE;
BEGIN
    IF NEW.entry_kind = 'adjustment' THEN
        SELECT * INTO original_row
        FROM public.operational_cost_ledger
        WHERE id = NEW.original_cost_id AND entry_kind = 'original';
        IF original_row.id IS NULL
           OR ROW(NEW.cost_kind, NEW.campaign_id, NEW.student_id, NEW.currency,
                  NEW.incurred_at)
              IS DISTINCT FROM
              ROW(original_row.cost_kind, original_row.campaign_id,
                  original_row.student_id, original_row.currency,
                  original_row.incurred_at) THEN
            RAISE EXCEPTION 'operational_cost_adjustment_identity_conflicts'
                USING ERRCODE = '23514';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER validate_operational_cost_insert_trigger
    BEFORE INSERT ON public.operational_cost_ledger
    FOR EACH ROW EXECUTE FUNCTION private.validate_operational_cost_insert();

CREATE OR REPLACE FUNCTION private.validate_acquisition_allocation_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    original_row public.acquisition_cost_allocation_ledger%ROWTYPE;
BEGIN
    IF NEW.entry_kind = 'adjustment' THEN
        SELECT * INTO original_row
        FROM public.acquisition_cost_allocation_ledger
        WHERE id = NEW.original_allocation_id AND entry_kind = 'original';
        IF original_row.id IS NULL
           OR ROW(NEW.campaign_id, NEW.student_id, NEW.contact_id,
                  NEW.first_subscription_id, NEW.first_cycle_id,
                  NEW.checkout_intent_id, NEW.checkout_attribution_event_id,
                  NEW.basis, NEW.currency)
              IS DISTINCT FROM
              ROW(original_row.campaign_id, original_row.student_id,
                  original_row.contact_id, original_row.first_subscription_id,
                  original_row.first_cycle_id, original_row.checkout_intent_id,
                  original_row.checkout_attribution_event_id,
                  original_row.basis, original_row.currency) THEN
            RAISE EXCEPTION 'acquisition_allocation_adjustment_identity_conflicts'
                USING ERRCODE = '23514';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER validate_acquisition_allocation_insert_trigger
    BEFORE INSERT ON public.acquisition_cost_allocation_ledger
    FOR EACH ROW EXECUTE FUNCTION private.validate_acquisition_allocation_insert();

CREATE VIEW public.operational_cost_balances
WITH (security_invoker = true)
AS
SELECT
    original.id AS original_cost_id,
    original.request_id,
    original.cost_kind,
    original.campaign_id,
    original.student_id,
    original.incurred_at,
    original.amount_delta_cents AS original_amount_cents,
    COALESCE(adjustments.amount_cents, 0)::BIGINT AS adjustment_amount_cents,
    (original.amount_delta_cents + COALESCE(adjustments.amount_cents, 0))::BIGINT
        AS balance_amount_cents,
    original.currency,
    original.description,
    original.recorded_by,
    original.created_at,
    adjustments.last_adjusted_at
FROM public.operational_cost_ledger AS original
LEFT JOIN LATERAL (
    SELECT
        SUM(adjustment.amount_delta_cents)::BIGINT AS amount_cents,
        MAX(adjustment.created_at) AS last_adjusted_at
    FROM public.operational_cost_ledger AS adjustment
    WHERE adjustment.original_cost_id = original.id
) AS adjustments ON TRUE
WHERE original.entry_kind = 'original';

CREATE VIEW public.acquisition_cost_allocation_balances
WITH (security_invoker = true)
AS
SELECT
    original.id AS original_allocation_id,
    original.request_id,
    original.campaign_id,
    original.student_id,
    original.contact_id,
    original.first_subscription_id,
    original.first_cycle_id,
    original.checkout_intent_id,
    original.checkout_attribution_event_id,
    original.basis,
    original.amount_delta_cents AS original_amount_cents,
    COALESCE(adjustments.amount_cents, 0)::BIGINT AS adjustment_amount_cents,
    (original.amount_delta_cents + COALESCE(adjustments.amount_cents, 0))::BIGINT
        AS balance_amount_cents,
    original.currency,
    original.reason,
    original.allocated_by,
    original.created_at,
    adjustments.last_adjusted_at
FROM public.acquisition_cost_allocation_ledger AS original
LEFT JOIN LATERAL (
    SELECT
        SUM(adjustment.amount_delta_cents)::BIGINT AS amount_cents,
        MAX(adjustment.created_at) AS last_adjusted_at
    FROM public.acquisition_cost_allocation_ledger AS adjustment
    WHERE adjustment.original_allocation_id = original.id
) AS adjustments ON TRUE
WHERE original.entry_kind = 'original';

CREATE OR REPLACE FUNCTION public.create_acquisition_campaign(
    p_request_id UUID,
    p_name TEXT,
    p_provider TEXT,
    p_external_reference TEXT,
    p_utm_source TEXT,
    p_utm_medium TEXT,
    p_utm_campaign TEXT,
    p_utm_term TEXT,
    p_utm_content TEXT,
    p_admin_id UUID
)
RETURNS public.acquisition_campaigns
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    existing_row public.acquisition_campaigns%ROWTYPE;
    campaign_row public.acquisition_campaigns%ROWTYPE;
BEGIN
    IF p_request_id IS NULL OR p_admin_id IS NULL
       OR p_name IS NULL OR char_length(btrim(p_name)) NOT BETWEEN 2 AND 200
       OR p_provider IS NULL OR char_length(p_provider) NOT BETWEEN 2 AND 100
       OR p_provider IS DISTINCT FROM btrim(p_provider)
       OR p_provider ~ '[[:cntrl:]]'
       OR (p_external_reference IS NOT NULL AND (
            char_length(p_external_reference) NOT BETWEEN 1 AND 200
            OR p_external_reference IS DISTINCT FROM btrim(p_external_reference)
            OR p_external_reference ~ '[[:cntrl:]]'
       ))
       OR NOT (
            (p_utm_source IS NULL AND p_utm_medium IS NULL
             AND p_utm_campaign IS NULL AND p_utm_term IS NULL
             AND p_utm_content IS NULL)
            OR (p_utm_source IS NOT NULL AND p_utm_medium IS NOT NULL
                AND p_utm_campaign IS NOT NULL)
       )
       OR (p_utm_source IS NOT NULL AND (
            char_length(p_utm_source) NOT BETWEEN 1 AND 100
            OR p_utm_source !~ '^[A-Za-z0-9._~-]+$'))
       OR (p_utm_medium IS NOT NULL AND (
            char_length(p_utm_medium) NOT BETWEEN 1 AND 100
            OR p_utm_medium !~ '^[A-Za-z0-9._~-]+$'))
       OR (p_utm_campaign IS NOT NULL AND (
            char_length(p_utm_campaign) NOT BETWEEN 1 AND 100
            OR p_utm_campaign !~ '^[A-Za-z0-9._~-]+$'))
       OR (p_utm_term IS NOT NULL AND (
            char_length(p_utm_term) NOT BETWEEN 1 AND 100
            OR p_utm_term !~ '^[A-Za-z0-9._~-]+$'))
       OR (p_utm_content IS NOT NULL AND (
            char_length(p_utm_content) NOT BETWEEN 1 AND 100
            OR p_utm_content !~ '^[A-Za-z0-9._~-]+$')) THEN
        RAISE EXCEPTION 'invalid_acquisition_campaign' USING ERRCODE = '22023';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = p_admin_id AND role = 'admin'::public.user_role
    ) THEN
        RAISE EXCEPTION 'acquisition_campaign_forbidden' USING ERRCODE = '42501';
    END IF;

    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(p_request_id::TEXT, 58161)
    );
    SELECT * INTO existing_row FROM public.acquisition_campaigns
    WHERE request_id = p_request_id;
    IF FOUND THEN
        IF ROW(existing_row.name, existing_row.provider,
               existing_row.external_reference, existing_row.utm_source,
               existing_row.utm_medium, existing_row.utm_campaign,
               existing_row.utm_term, existing_row.utm_content,
               existing_row.created_by)
           IS DISTINCT FROM
           ROW(btrim(p_name), p_provider, p_external_reference, p_utm_source,
               p_utm_medium, p_utm_campaign, p_utm_term, p_utm_content,
               p_admin_id) THEN
            RAISE EXCEPTION 'acquisition_campaign_request_id_conflicts'
                USING ERRCODE = '40001';
        END IF;
        RETURN existing_row;
    END IF;

    INSERT INTO public.acquisition_campaigns (
        request_id, name, provider, external_reference, utm_source, utm_medium,
        utm_campaign, utm_term, utm_content, created_by
    ) VALUES (
        p_request_id, btrim(p_name), p_provider, p_external_reference,
        p_utm_source, p_utm_medium, p_utm_campaign, p_utm_term, p_utm_content,
        p_admin_id
    ) RETURNING * INTO campaign_row;

    INSERT INTO public.admin_audit_log(admin_id, action, entity_type, entity_id, after)
    VALUES (p_admin_id, 'create_acquisition_campaign', 'acquisition_campaign',
        campaign_row.id::TEXT, pg_catalog.to_jsonb(campaign_row));
    RETURN campaign_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_operational_cost(
    p_request_id UUID,
    p_cost_kind TEXT,
    p_campaign_id UUID,
    p_student_id UUID,
    p_amount_cents INTEGER,
    p_incurred_at TIMESTAMPTZ,
    p_admin_id UUID,
    p_description TEXT
)
RETURNS public.operational_cost_ledger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    existing_row public.operational_cost_ledger%ROWTYPE;
    cost_row public.operational_cost_ledger%ROWTYPE;
BEGIN
    IF p_request_id IS NULL OR p_admin_id IS NULL OR p_amount_cents IS NULL
       OR p_amount_cents <= 0 OR p_incurred_at IS NULL
       OR NOT pg_catalog.isfinite(p_incurred_at)
       OR p_description IS NULL
       OR char_length(btrim(p_description)) NOT BETWEEN 5 AND 1000
       OR p_cost_kind NOT IN (
            'acquisition_spend', 'delivery_material', 'student_tool', 'other_direct'
       )
       OR (p_cost_kind = 'acquisition_spend'
           AND (p_campaign_id IS NULL OR p_student_id IS NOT NULL))
       OR (p_cost_kind <> 'acquisition_spend'
           AND (p_campaign_id IS NOT NULL OR p_student_id IS NULL)) THEN
        RAISE EXCEPTION 'invalid_operational_cost' USING ERRCODE = '22023';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = p_admin_id AND role = 'admin'::public.user_role
    ) THEN
        RAISE EXCEPTION 'operational_cost_forbidden' USING ERRCODE = '42501';
    END IF;
    IF p_campaign_id IS NOT NULL THEN
        PERFORM pg_catalog.pg_advisory_xact_lock(
            pg_catalog.hashtextextended('campaign:' || p_campaign_id::TEXT, 58162)
        );
        IF NOT EXISTS (SELECT 1 FROM public.acquisition_campaigns WHERE id = p_campaign_id) THEN
            RAISE EXCEPTION 'operational_cost_campaign_not_found' USING ERRCODE = '23503';
        END IF;
    ELSIF NOT EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = p_student_id AND role = 'student'::public.user_role
    ) THEN
        RAISE EXCEPTION 'operational_cost_student_not_found' USING ERRCODE = '23503';
    ELSIF NOT EXISTS (
        SELECT 1
        FROM public.checkout_v2_cycles AS cycle
        JOIN public.subscriptions AS subscription
          ON subscription.id = cycle.subscription_id
         AND subscription.student_id = p_student_id
         AND subscription.contract_schema_version = 2
        JOIN public.payments AS payment
          ON payment.id = cycle.payment_id
         AND payment.checkout_v2_cycle_id = cycle.id
         AND payment.student_id = p_student_id
         AND payment.subscription_id = subscription.id
         AND payment.status IN ('succeeded'::public.payment_status,
                                'refunded'::public.payment_status)
         AND payment.amount = cycle.amount_cents
         AND lower(payment.currency) = cycle.currency
        WHERE cycle.cycle_number = 1 AND cycle.cycle_kind = 'initial'
    ) THEN
        RAISE EXCEPTION 'operational_cost_first_paid_cycle_not_found'
            USING ERRCODE = '23503';
    END IF;

    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(p_request_id::TEXT, 58163)
    );
    SELECT * INTO existing_row FROM public.operational_cost_ledger
    WHERE request_id = p_request_id;
    IF FOUND THEN
        IF ROW(existing_row.entry_kind, existing_row.original_cost_id,
               existing_row.cost_kind, existing_row.campaign_id,
               existing_row.student_id, existing_row.amount_delta_cents,
               existing_row.incurred_at, existing_row.description,
               existing_row.recorded_by)
           IS DISTINCT FROM
           ROW('original', NULL::UUID, p_cost_kind, p_campaign_id, p_student_id,
               p_amount_cents::BIGINT, p_incurred_at, btrim(p_description),
               p_admin_id) THEN
            RAISE EXCEPTION 'operational_cost_request_id_conflicts'
                USING ERRCODE = '40001';
        END IF;
        RETURN existing_row;
    END IF;

    INSERT INTO public.operational_cost_ledger (
        request_id, entry_kind, cost_kind, campaign_id, student_id,
        amount_delta_cents, incurred_at, description, recorded_by
    ) VALUES (
        p_request_id, 'original', p_cost_kind, p_campaign_id, p_student_id,
        p_amount_cents, p_incurred_at, btrim(p_description), p_admin_id
    ) RETURNING * INTO cost_row;
    INSERT INTO public.admin_audit_log(admin_id, action, entity_type, entity_id, after)
    VALUES (p_admin_id, 'record_operational_cost', 'operational_cost',
        cost_row.id::TEXT, pg_catalog.to_jsonb(cost_row));
    RETURN cost_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.adjust_operational_cost(
    p_request_id UUID,
    p_original_cost_id UUID,
    p_amount_delta_cents INTEGER,
    p_admin_id UUID,
    p_reason TEXT
)
RETURNS public.operational_cost_ledger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    original_row public.operational_cost_ledger%ROWTYPE;
    existing_row public.operational_cost_ledger%ROWTYPE;
    adjustment_row public.operational_cost_ledger%ROWTYPE;
    current_balance BIGINT;
    campaign_spend BIGINT;
    campaign_allocated BIGINT;
BEGIN
    IF p_request_id IS NULL OR p_original_cost_id IS NULL OR p_admin_id IS NULL
       OR p_amount_delta_cents IS NULL OR p_amount_delta_cents = 0
       OR p_reason IS NULL OR char_length(btrim(p_reason)) NOT BETWEEN 5 AND 1000 THEN
        RAISE EXCEPTION 'invalid_operational_cost_adjustment' USING ERRCODE = '22023';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = p_admin_id AND role = 'admin'::public.user_role
    ) THEN
        RAISE EXCEPTION 'operational_cost_adjustment_forbidden' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO original_row FROM public.operational_cost_ledger
    WHERE id = p_original_cost_id AND entry_kind = 'original';
    IF NOT FOUND THEN
        RAISE EXCEPTION 'operational_cost_original_not_found' USING ERRCODE = '23503';
    END IF;
    IF original_row.campaign_id IS NOT NULL THEN
        PERFORM pg_catalog.pg_advisory_xact_lock(
            pg_catalog.hashtextextended('campaign:' || original_row.campaign_id::TEXT, 58162)
        );
    END IF;
    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended('operational-cost:' || original_row.id::TEXT, 58166)
    );
    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(p_request_id::TEXT, 58163)
    );
    SELECT * INTO existing_row FROM public.operational_cost_ledger
    WHERE request_id = p_request_id;
    IF FOUND THEN
        IF ROW(existing_row.entry_kind, existing_row.original_cost_id,
               existing_row.amount_delta_cents, existing_row.recorded_by,
               existing_row.description)
           IS DISTINCT FROM
           ROW('adjustment', p_original_cost_id, p_amount_delta_cents::BIGINT,
               p_admin_id, btrim(p_reason)) THEN
            RAISE EXCEPTION 'operational_cost_request_id_conflicts'
                USING ERRCODE = '40001';
        END IF;
        RETURN existing_row;
    END IF;

    SELECT COALESCE(SUM(amount_delta_cents), 0) INTO current_balance
    FROM public.operational_cost_ledger
    WHERE id = p_original_cost_id OR original_cost_id = p_original_cost_id;
    IF current_balance + p_amount_delta_cents < 0 THEN
        RAISE EXCEPTION 'operational_cost_balance_cannot_be_negative'
            USING ERRCODE = '23514';
    END IF;
    IF original_row.campaign_id IS NOT NULL THEN
        SELECT COALESCE(SUM(amount_delta_cents), 0) + p_amount_delta_cents
        INTO campaign_spend
        FROM public.operational_cost_ledger
        WHERE campaign_id = original_row.campaign_id;
        SELECT COALESCE(SUM(amount_delta_cents), 0) INTO campaign_allocated
        FROM public.acquisition_cost_allocation_ledger
        WHERE campaign_id = original_row.campaign_id;
        IF campaign_spend < campaign_allocated THEN
            RAISE EXCEPTION 'campaign_spend_cannot_fall_below_allocations'
                USING ERRCODE = '23514';
        END IF;
    END IF;

    INSERT INTO public.operational_cost_ledger (
        request_id, entry_kind, original_cost_id, cost_kind, campaign_id,
        student_id, amount_delta_cents, incurred_at, description, recorded_by
    ) VALUES (
        p_request_id, 'adjustment', original_row.id, original_row.cost_kind,
        original_row.campaign_id, original_row.student_id, p_amount_delta_cents,
        original_row.incurred_at, btrim(p_reason), p_admin_id
    ) RETURNING * INTO adjustment_row;
    INSERT INTO public.admin_audit_log(admin_id, action, entity_type, entity_id, after)
    VALUES (p_admin_id, 'adjust_operational_cost', 'operational_cost_adjustment',
        adjustment_row.id::TEXT, pg_catalog.to_jsonb(adjustment_row));
    RETURN adjustment_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_acquisition_cost_allocation(
    p_request_id UUID,
    p_campaign_id UUID,
    p_student_id UUID,
    p_amount_cents INTEGER,
    p_basis TEXT,
    p_checkout_attribution_event_id UUID,
    p_admin_id UUID,
    p_reason TEXT
)
RETURNS public.acquisition_cost_allocation_ledger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    campaign_row public.acquisition_campaigns%ROWTYPE;
    event_row public.acquisition_attribution_events%ROWTYPE;
    existing_row public.acquisition_cost_allocation_ledger%ROWTYPE;
    allocation_row public.acquisition_cost_allocation_ledger%ROWTYPE;
    first_subscription_id UUID;
    first_cycle_id UUID;
    first_payment_id UUID;
    checkout_intent_id UUID;
    contact_id UUID;
    payment_created_at TIMESTAMPTZ;
    campaign_spend BIGINT;
    campaign_allocated BIGINT;
BEGIN
    IF p_request_id IS NULL OR p_campaign_id IS NULL OR p_student_id IS NULL
       OR p_amount_cents IS NULL OR p_amount_cents <= 0 OR p_admin_id IS NULL
       OR p_basis NOT IN ('observed_checkout', 'manual')
       OR (p_basis = 'observed_checkout' AND p_checkout_attribution_event_id IS NULL)
       OR (p_basis = 'manual' AND (
            p_checkout_attribution_event_id IS NOT NULL OR p_reason IS NULL
            OR char_length(btrim(p_reason)) NOT BETWEEN 5 AND 1000
       ))
       OR (p_reason IS NOT NULL AND char_length(btrim(p_reason)) NOT BETWEEN 5 AND 1000) THEN
        RAISE EXCEPTION 'invalid_acquisition_cost_allocation' USING ERRCODE = '22023';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = p_admin_id AND role = 'admin'::public.user_role
    ) THEN
        RAISE EXCEPTION 'acquisition_cost_allocation_forbidden' USING ERRCODE = '42501';
    END IF;

    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended('campaign:' || p_campaign_id::TEXT, 58162)
    );
    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended('student:' || p_student_id::TEXT, 58164)
    );
    SELECT * INTO campaign_row FROM public.acquisition_campaigns
    WHERE id = p_campaign_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'acquisition_campaign_not_found' USING ERRCODE = '23503';
    END IF;

    SELECT cycle.subscription_id, cycle.id, payment.id,
           subscription.checkout_intent_id, intent.contact_id, payment.created_at
    INTO first_subscription_id, first_cycle_id, first_payment_id,
         checkout_intent_id, contact_id, payment_created_at
    FROM public.checkout_v2_cycles AS cycle
    JOIN public.subscriptions AS subscription
      ON subscription.id = cycle.subscription_id
     AND subscription.student_id = p_student_id
     AND subscription.contract_schema_version = 2
    JOIN public.payments AS payment
      ON payment.id = cycle.payment_id
     AND payment.checkout_v2_cycle_id = cycle.id
     AND payment.student_id = p_student_id
     AND payment.subscription_id = subscription.id
     AND payment.status IN ('succeeded'::public.payment_status,
                            'refunded'::public.payment_status)
     AND payment.amount = cycle.amount_cents
     AND lower(payment.currency) = cycle.currency
    JOIN public.checkout_intents AS intent
      ON intent.id = subscription.checkout_intent_id
     AND intent.student_id = p_student_id
    WHERE cycle.cycle_number = 1 AND cycle.cycle_kind = 'initial'
    ORDER BY payment.created_at, cycle.id
    LIMIT 1;
    IF first_cycle_id IS NULL THEN
        RAISE EXCEPTION 'first_paid_checkout_v2_cycle_not_found' USING ERRCODE = '23503';
    END IF;

    IF p_basis = 'observed_checkout' THEN
        IF campaign_row.utm_source IS NULL THEN
            RAISE EXCEPTION 'observed_allocation_requires_observed_campaign'
                USING ERRCODE = '23514';
        END IF;
        SELECT * INTO event_row FROM public.acquisition_attribution_events
        WHERE id = p_checkout_attribution_event_id;
        IF event_row.id IS NULL
           OR event_row.event_kind IS DISTINCT FROM 'checkout_start'
           OR event_row.checkout_intent_id IS DISTINCT FROM checkout_intent_id
           OR event_row.contact_id IS DISTINCT FROM contact_id
           OR event_row.captured_at > payment_created_at
           OR ROW(event_row.utm_source, event_row.utm_medium,
                  event_row.utm_campaign, event_row.utm_term,
                  event_row.utm_content)
              IS DISTINCT FROM
              ROW(campaign_row.utm_source, campaign_row.utm_medium,
                  campaign_row.utm_campaign, campaign_row.utm_term,
                  campaign_row.utm_content) THEN
            RAISE EXCEPTION 'observed_allocation_attribution_conflicts'
                USING ERRCODE = '23514';
        END IF;
    END IF;

    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(p_request_id::TEXT, 58165)
    );
    SELECT * INTO existing_row FROM public.acquisition_cost_allocation_ledger
    WHERE request_id = p_request_id;
    IF FOUND THEN
        IF ROW(existing_row.entry_kind, existing_row.original_allocation_id,
               existing_row.campaign_id, existing_row.student_id,
               existing_row.contact_id, existing_row.first_subscription_id,
               existing_row.first_cycle_id, existing_row.checkout_intent_id,
               existing_row.checkout_attribution_event_id, existing_row.basis,
               existing_row.amount_delta_cents, existing_row.reason,
               existing_row.allocated_by)
           IS DISTINCT FROM
           ROW('original', NULL::UUID, p_campaign_id, p_student_id, contact_id,
               first_subscription_id, first_cycle_id, checkout_intent_id,
               p_checkout_attribution_event_id, p_basis, p_amount_cents::BIGINT,
               CASE WHEN p_reason IS NULL THEN NULL ELSE btrim(p_reason) END,
               p_admin_id) THEN
            RAISE EXCEPTION 'acquisition_allocation_request_id_conflicts'
                USING ERRCODE = '40001';
        END IF;
        RETURN existing_row;
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.acquisition_cost_allocation_balances
        WHERE student_id = p_student_id AND balance_amount_cents > 0
    ) THEN
        RAISE EXCEPTION 'student_already_has_positive_acquisition_allocation'
            USING ERRCODE = '23505';
    END IF;
    SELECT COALESCE(SUM(amount_delta_cents), 0) INTO campaign_spend
    FROM public.operational_cost_ledger
    WHERE campaign_id = p_campaign_id;
    SELECT COALESCE(SUM(amount_delta_cents), 0) INTO campaign_allocated
    FROM public.acquisition_cost_allocation_ledger
    WHERE campaign_id = p_campaign_id;
    IF campaign_allocated + p_amount_cents > campaign_spend THEN
        RAISE EXCEPTION 'acquisition_allocation_exceeds_campaign_spend'
            USING ERRCODE = '23514';
    END IF;

    INSERT INTO public.acquisition_cost_allocation_ledger (
        request_id, entry_kind, campaign_id, student_id, contact_id,
        first_subscription_id, first_cycle_id, checkout_intent_id,
        checkout_attribution_event_id, basis, amount_delta_cents, reason,
        allocated_by
    ) VALUES (
        p_request_id, 'original', p_campaign_id, p_student_id, contact_id,
        first_subscription_id, first_cycle_id, checkout_intent_id,
        p_checkout_attribution_event_id, p_basis, p_amount_cents,
        CASE WHEN p_reason IS NULL THEN NULL ELSE btrim(p_reason) END,
        p_admin_id
    ) RETURNING * INTO allocation_row;
    INSERT INTO public.admin_audit_log(admin_id, action, entity_type, entity_id, after)
    VALUES (p_admin_id, 'record_acquisition_cost_allocation',
        'acquisition_cost_allocation', allocation_row.id::TEXT,
        pg_catalog.to_jsonb(allocation_row));
    RETURN allocation_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.adjust_acquisition_cost_allocation(
    p_request_id UUID,
    p_original_allocation_id UUID,
    p_amount_delta_cents INTEGER,
    p_admin_id UUID,
    p_reason TEXT
)
RETURNS public.acquisition_cost_allocation_ledger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    original_row public.acquisition_cost_allocation_ledger%ROWTYPE;
    existing_row public.acquisition_cost_allocation_ledger%ROWTYPE;
    adjustment_row public.acquisition_cost_allocation_ledger%ROWTYPE;
    current_balance BIGINT;
    campaign_spend BIGINT;
    campaign_allocated BIGINT;
BEGIN
    IF p_request_id IS NULL OR p_original_allocation_id IS NULL
       OR p_amount_delta_cents IS NULL OR p_amount_delta_cents = 0
       OR p_admin_id IS NULL OR p_reason IS NULL
       OR char_length(btrim(p_reason)) NOT BETWEEN 5 AND 1000 THEN
        RAISE EXCEPTION 'invalid_acquisition_allocation_adjustment'
            USING ERRCODE = '22023';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = p_admin_id AND role = 'admin'::public.user_role
    ) THEN
        RAISE EXCEPTION 'acquisition_allocation_adjustment_forbidden'
            USING ERRCODE = '42501';
    END IF;
    SELECT * INTO original_row FROM public.acquisition_cost_allocation_ledger
    WHERE id = p_original_allocation_id AND entry_kind = 'original';
    IF NOT FOUND THEN
        RAISE EXCEPTION 'acquisition_allocation_original_not_found'
            USING ERRCODE = '23503';
    END IF;

    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended('campaign:' || original_row.campaign_id::TEXT, 58162)
    );
    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended('student:' || original_row.student_id::TEXT, 58164)
    );
    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(
            'acquisition-allocation:' || original_row.id::TEXT,
            58167
        )
    );
    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(p_request_id::TEXT, 58165)
    );
    SELECT * INTO existing_row FROM public.acquisition_cost_allocation_ledger
    WHERE request_id = p_request_id;
    IF FOUND THEN
        IF ROW(existing_row.entry_kind, existing_row.original_allocation_id,
               existing_row.amount_delta_cents, existing_row.allocated_by,
               existing_row.reason)
           IS DISTINCT FROM
           ROW('adjustment', p_original_allocation_id,
               p_amount_delta_cents::BIGINT, p_admin_id, btrim(p_reason)) THEN
            RAISE EXCEPTION 'acquisition_allocation_request_id_conflicts'
                USING ERRCODE = '40001';
        END IF;
        RETURN existing_row;
    END IF;

    SELECT COALESCE(SUM(amount_delta_cents), 0) INTO current_balance
    FROM public.acquisition_cost_allocation_ledger
    WHERE id = p_original_allocation_id
       OR original_allocation_id = p_original_allocation_id;
    IF current_balance + p_amount_delta_cents < 0 THEN
        RAISE EXCEPTION 'acquisition_allocation_balance_cannot_be_negative'
            USING ERRCODE = '23514';
    END IF;
    IF current_balance = 0 AND p_amount_delta_cents > 0 AND EXISTS (
        SELECT 1 FROM public.acquisition_cost_allocation_balances
        WHERE student_id = original_row.student_id
          AND original_allocation_id <> original_row.id
          AND balance_amount_cents > 0
    ) THEN
        RAISE EXCEPTION 'student_already_has_positive_acquisition_allocation'
            USING ERRCODE = '23505';
    END IF;
    SELECT COALESCE(SUM(amount_delta_cents), 0) INTO campaign_spend
    FROM public.operational_cost_ledger
    WHERE campaign_id = original_row.campaign_id;
    SELECT COALESCE(SUM(amount_delta_cents), 0) + p_amount_delta_cents
    INTO campaign_allocated
    FROM public.acquisition_cost_allocation_ledger
    WHERE campaign_id = original_row.campaign_id;
    IF campaign_allocated > campaign_spend THEN
        RAISE EXCEPTION 'acquisition_allocation_exceeds_campaign_spend'
            USING ERRCODE = '23514';
    END IF;

    INSERT INTO public.acquisition_cost_allocation_ledger (
        request_id, entry_kind, original_allocation_id, campaign_id, student_id,
        contact_id, first_subscription_id, first_cycle_id, checkout_intent_id,
        checkout_attribution_event_id, basis, amount_delta_cents, reason,
        allocated_by
    ) VALUES (
        p_request_id, 'adjustment', original_row.id, original_row.campaign_id,
        original_row.student_id, original_row.contact_id,
        original_row.first_subscription_id, original_row.first_cycle_id,
        original_row.checkout_intent_id,
        original_row.checkout_attribution_event_id, original_row.basis,
        p_amount_delta_cents, btrim(p_reason), p_admin_id
    ) RETURNING * INTO adjustment_row;
    INSERT INTO public.admin_audit_log(admin_id, action, entity_type, entity_id, after)
    VALUES (p_admin_id, 'adjust_acquisition_cost_allocation',
        'acquisition_cost_allocation_adjustment', adjustment_row.id::TEXT,
        pg_catalog.to_jsonb(adjustment_row));
    RETURN adjustment_row;
END;
$$;

CREATE VIEW public.acquisition_allocation_candidates
WITH (security_invoker = true)
AS
WITH first_paid AS (
    SELECT DISTINCT ON (subscription.student_id)
        subscription.student_id,
        profile.full_name AS student_full_name,
        profile.email AS student_email,
        intent.contact_id,
        subscription.id AS first_subscription_id,
        cycle.id AS first_cycle_id,
        payment.id AS first_payment_id,
        payment.created_at AS first_paid_at,
        intent.id AS checkout_intent_id
    FROM public.checkout_v2_cycles AS cycle
    JOIN public.subscriptions AS subscription
      ON subscription.id = cycle.subscription_id
     AND subscription.contract_schema_version = 2
    JOIN public.payments AS payment
      ON payment.id = cycle.payment_id
     AND payment.checkout_v2_cycle_id = cycle.id
     AND payment.status IN ('succeeded'::public.payment_status,
                            'refunded'::public.payment_status)
     AND payment.amount = cycle.amount_cents
     AND lower(payment.currency) = cycle.currency
    JOIN public.checkout_intents AS intent
      ON intent.id = subscription.checkout_intent_id
     AND intent.student_id = subscription.student_id
    JOIN public.profiles AS profile ON profile.id = subscription.student_id
    WHERE cycle.cycle_number = 1 AND cycle.cycle_kind = 'initial'
    ORDER BY subscription.student_id, payment.created_at, cycle.id
)
SELECT
    first_paid.student_id,
    first_paid.student_full_name,
    first_paid.student_email,
    first_paid.contact_id,
    first_paid.first_subscription_id,
    first_paid.first_cycle_id,
    first_paid.first_payment_id,
    first_paid.first_paid_at,
    first_paid.checkout_intent_id,
    attribution.id AS checkout_attribution_event_id,
    attribution.utm_source,
    attribution.utm_medium,
    attribution.utm_campaign,
    attribution.utm_term,
    attribution.utm_content,
    campaign.id AS matched_campaign_id,
    campaign.name AS matched_campaign_name,
    CASE WHEN campaign.id IS NULL THEN 'manual' ELSE 'observed_checkout' END
        AS basis_candidate,
    (active_allocation.original_allocation_id IS NOT NULL) AS has_active_allocation,
    active_allocation.campaign_id AS active_campaign_id,
    active_campaign.name AS active_campaign_name
FROM first_paid
LEFT JOIN public.acquisition_attribution_events AS attribution
  ON attribution.checkout_intent_id = first_paid.checkout_intent_id
 AND attribution.contact_id = first_paid.contact_id
 AND attribution.event_kind = 'checkout_start'
LEFT JOIN public.acquisition_campaigns AS campaign
  ON campaign.utm_source IS NOT DISTINCT FROM attribution.utm_source
 AND campaign.utm_medium IS NOT DISTINCT FROM attribution.utm_medium
 AND campaign.utm_campaign IS NOT DISTINCT FROM attribution.utm_campaign
 AND campaign.utm_term IS NOT DISTINCT FROM attribution.utm_term
 AND campaign.utm_content IS NOT DISTINCT FROM attribution.utm_content
 AND campaign.utm_source IS NOT NULL
LEFT JOIN public.acquisition_cost_allocation_balances AS active_allocation
  ON active_allocation.student_id = first_paid.student_id
 AND active_allocation.balance_amount_cents > 0
LEFT JOIN public.acquisition_campaigns AS active_campaign
  ON active_campaign.id = active_allocation.campaign_id;

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
    COALESCE(teacher.amount_cents, 0)::BIGINT AS teacher_compensation_cents,
    COALESCE(direct.amount_cents, 0)::BIGINT AS direct_operational_cost_cents,
    COALESCE(allocation.balance_amount_cents, 0)::BIGINT AS acquisition_cost_cents,
    (
        paid.net_revenue_cents - COALESCE(teacher.amount_cents, 0)
        - COALESCE(direct.amount_cents, 0)
        - COALESCE(allocation.balance_amount_cents, 0)
    )::BIGINT AS provisional_contribution_cents,
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
    (
        COALESCE(acquired.net_revenue_cents, 0)
        - COALESCE(acquired.teacher_compensation_cents, 0)
        - COALESCE(acquired.direct_cost_cents, 0)
        - COALESCE(spend.amount_cents, 0)
    )::BIGINT AS provisional_contribution_cents,
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
    students.teacher_compensation_cents,
    students.direct_operational_cost_cents,
    campaigns.campaign_spend_cents,
    campaigns.allocated_acquisition_cost_cents,
    GREATEST(
        campaigns.campaign_spend_cents - campaigns.allocated_acquisition_cost_cents,
        0
    )::BIGINT AS unallocated_acquisition_cost_cents,
    (
        students.net_revenue_cents - students.teacher_compensation_cents
        - students.direct_operational_cost_cents - campaigns.campaign_spend_cents
    )::BIGINT AS provisional_contribution_cents,
    'eur'::TEXT AS currency
FROM students CROSS JOIN campaign_totals AS campaigns;

REVOKE ALL ON TABLE public.operational_cost_balances,
    public.acquisition_cost_allocation_balances,
    public.acquisition_allocation_candidates,
    public.student_unit_economics,
    public.acquisition_campaign_unit_economics,
    public.portfolio_unit_economics
FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.operational_cost_balances,
    public.acquisition_cost_allocation_balances,
    public.acquisition_allocation_candidates,
    public.student_unit_economics,
    public.acquisition_campaign_unit_economics,
    public.portfolio_unit_economics
TO service_role;

REVOKE ALL ON FUNCTION public.create_acquisition_campaign(
    UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_acquisition_campaign(
    UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID
) TO service_role;
REVOKE ALL ON FUNCTION public.record_operational_cost(
    UUID, TEXT, UUID, UUID, INTEGER, TIMESTAMPTZ, UUID, TEXT
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_operational_cost(
    UUID, TEXT, UUID, UUID, INTEGER, TIMESTAMPTZ, UUID, TEXT
) TO service_role;
REVOKE ALL ON FUNCTION public.adjust_operational_cost(
    UUID, UUID, INTEGER, UUID, TEXT
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.adjust_operational_cost(
    UUID, UUID, INTEGER, UUID, TEXT
) TO service_role;
REVOKE ALL ON FUNCTION public.record_acquisition_cost_allocation(
    UUID, UUID, UUID, INTEGER, TEXT, UUID, UUID, TEXT
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_acquisition_cost_allocation(
    UUID, UUID, UUID, INTEGER, TEXT, UUID, UUID, TEXT
) TO service_role;
REVOKE ALL ON FUNCTION public.adjust_acquisition_cost_allocation(
    UUID, UUID, INTEGER, UUID, TEXT
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.adjust_acquisition_cost_allocation(
    UUID, UUID, INTEGER, UUID, TEXT
) TO service_role;

REVOKE ALL ON FUNCTION private.guard_provisional_unit_economics_immutable(),
    private.validate_operational_cost_insert(),
    private.validate_acquisition_allocation_insert()
FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON TABLE public.acquisition_campaigns IS
    'Append-only operational campaign identities; all-null UTM is manual and source/medium/campaign is observed UTM.';
COMMENT ON TABLE public.operational_cost_ledger IS
    'Append-only acquisition spend and student-scoped direct operating costs with compensating adjustments.';
COMMENT ON TABLE public.acquisition_cost_allocation_ledger IS
    'Append-only explicit acquisition-cost allocations to the first paid Checkout V2 cycle.';
COMMENT ON VIEW public.student_unit_economics IS
    'Provisional operating contribution by paid Checkout V2 student; excludes tax, reserves, payouts and distributable profit.';
COMMENT ON VIEW public.portfolio_unit_economics IS
    'Single-row provisional portfolio contribution that subtracts total campaign spend once, including unallocated spend.';
