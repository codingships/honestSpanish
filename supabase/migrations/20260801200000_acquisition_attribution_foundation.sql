-- Minimal, privacy-preserving acquisition attribution. Events are immutable
-- operational facts, not analytics exhaust: no IP address, user agent, raw URL,
-- query string, click identifier, or browser fingerprint is stored here.

ALTER TABLE public.leads
    ADD CONSTRAINT leads_id_crm_contact_id_key UNIQUE (id, crm_contact_id);

ALTER TABLE public.checkout_intents
    ADD CONSTRAINT checkout_intents_id_contact_id_key UNIQUE (id, contact_id);

CREATE TABLE public.acquisition_attribution_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id UUID NOT NULL UNIQUE,
    event_kind TEXT NOT NULL CHECK (
        event_kind IN ('application_submit', 'level_check_submit', 'checkout_start')
    ),
    contact_id UUID NOT NULL
        REFERENCES public.crm_contacts(id) ON DELETE RESTRICT,
    lead_id UUID,
    checkout_intent_id UUID,
    landing_path TEXT NOT NULL CHECK (
        char_length(landing_path) BETWEEN 1 AND 200
        AND landing_path = btrim(landing_path)
        AND landing_path LIKE '/%'
        AND landing_path NOT LIKE '//%'
        AND landing_path !~ '[?#]'
        AND landing_path !~ '[[:cntrl:]]'
        AND position(chr(92) IN landing_path) = 0
    ),
    referrer_kind TEXT NOT NULL CHECK (
        referrer_kind IN ('direct', 'internal', 'external')
    ),
    referrer_host TEXT,
    referrer_path TEXT,
    entry_language TEXT NOT NULL CHECK (entry_language IN ('es', 'en', 'ru')),
    utm_source TEXT,
    utm_medium TEXT,
    utm_campaign TEXT,
    utm_term TEXT,
    utm_content TEXT,
    captured_at TIMESTAMPTZ NOT NULL
        DEFAULT clock_timestamp(),
    created_at TIMESTAMPTZ NOT NULL
        DEFAULT clock_timestamp(),
    CONSTRAINT acquisition_attribution_event_reference_shape CHECK (
        (
            event_kind IN ('application_submit', 'level_check_submit')
            AND lead_id IS NOT NULL
            AND checkout_intent_id IS NULL
        ) OR (
            event_kind = 'checkout_start'
            AND lead_id IS NULL
            AND checkout_intent_id IS NOT NULL
        )
    ),
    CONSTRAINT acquisition_attribution_event_lead_contact_fkey
        FOREIGN KEY (lead_id, contact_id)
        REFERENCES public.leads(id, crm_contact_id) ON DELETE RESTRICT,
    CONSTRAINT acquisition_attribution_event_checkout_contact_fkey
        FOREIGN KEY (checkout_intent_id, contact_id)
        REFERENCES public.checkout_intents(id, contact_id) ON DELETE RESTRICT,
    CONSTRAINT acquisition_attribution_event_referrer_shape CHECK (
        (
            referrer_kind = 'direct'
            AND referrer_host IS NULL
            AND referrer_path IS NULL
        ) OR (
            referrer_kind = 'internal'
            AND referrer_host IS NULL
            AND referrer_path IS NOT NULL
            AND char_length(referrer_path) BETWEEN 1 AND 200
            AND referrer_path = btrim(referrer_path)
            AND referrer_path LIKE '/%'
            AND referrer_path NOT LIKE '//%'
            AND referrer_path !~ '[?#]'
            AND referrer_path !~ '[[:cntrl:]]'
            AND position(chr(92) IN referrer_path) = 0
        ) OR (
            referrer_kind = 'external'
            AND referrer_host IS NOT NULL
            AND referrer_path IS NULL
            AND char_length(referrer_host) BETWEEN 1 AND 253
            AND referrer_host = lower(referrer_host)
            AND referrer_host = btrim(referrer_host)
            AND referrer_host ~ '^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$'
            AND referrer_host !~ '\.\.'
        )
    ),
    CONSTRAINT acquisition_attribution_event_utm_shape CHECK (
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
    ),
    CONSTRAINT acquisition_attribution_event_timestamps CHECK (
        pg_catalog.isfinite(captured_at)
        AND pg_catalog.isfinite(created_at)
        AND captured_at <= created_at
    )
);

CREATE INDEX acquisition_attribution_events_contact_captured_idx
    ON public.acquisition_attribution_events(contact_id, captured_at, id);
CREATE INDEX acquisition_attribution_events_checkout_idx
    ON public.acquisition_attribution_events(checkout_intent_id)
    WHERE checkout_intent_id IS NOT NULL;
CREATE UNIQUE INDEX acquisition_attribution_events_checkout_once_idx
    ON public.acquisition_attribution_events(checkout_intent_id)
    WHERE event_kind = 'checkout_start';

ALTER TABLE public.acquisition_attribution_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.acquisition_attribution_events
    FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.acquisition_attribution_events TO service_role;

CREATE OR REPLACE FUNCTION private.guard_acquisition_attribution_event_immutable()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    RAISE EXCEPTION 'acquisition_attribution_event_is_immutable'
        USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER guard_acquisition_attribution_event_immutable
    BEFORE UPDATE OR DELETE ON public.acquisition_attribution_events
    FOR EACH ROW EXECUTE FUNCTION private.guard_acquisition_attribution_event_immutable();

CREATE OR REPLACE FUNCTION public.record_acquisition_attribution_event(
    p_request_id UUID,
    p_event_kind TEXT,
    p_lead_id UUID,
    p_checkout_intent_id UUID,
    p_landing_path TEXT,
    p_referrer_kind TEXT,
    p_referrer_host TEXT,
    p_referrer_path TEXT,
    p_entry_language TEXT,
    p_utm_source TEXT,
    p_utm_medium TEXT,
    p_utm_campaign TEXT,
    p_utm_term TEXT,
    p_utm_content TEXT
)
RETURNS public.acquisition_attribution_events
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    existing_row public.acquisition_attribution_events%ROWTYPE;
    event_row public.acquisition_attribution_events%ROWTYPE;
    derived_contact_id UUID;
    event_timestamp TIMESTAMPTZ := clock_timestamp();
BEGIN
    IF p_request_id IS NULL
       OR p_event_kind IS NULL
       OR p_event_kind NOT IN (
           'application_submit', 'level_check_submit', 'checkout_start'
       )
       OR p_landing_path IS NULL
       OR char_length(p_landing_path) NOT BETWEEN 1 AND 200
       OR p_landing_path IS DISTINCT FROM btrim(p_landing_path)
       OR p_landing_path NOT LIKE '/%'
       OR p_landing_path LIKE '//%'
       OR p_landing_path ~ '[?#]'
       OR p_landing_path ~ '[[:cntrl:]]'
       OR position(chr(92) IN p_landing_path) <> 0
       OR p_referrer_kind IS NULL
       OR p_referrer_kind NOT IN ('direct', 'internal', 'external')
       OR p_entry_language IS NULL
       OR p_entry_language NOT IN ('es', 'en', 'ru')
       OR (
           p_event_kind IN ('application_submit', 'level_check_submit')
           AND (p_lead_id IS NULL OR p_checkout_intent_id IS NOT NULL)
       )
       OR (
           p_event_kind = 'checkout_start'
           AND (p_lead_id IS NOT NULL OR p_checkout_intent_id IS NULL)
       )
       OR (
           p_referrer_kind = 'direct'
           AND (p_referrer_host IS NOT NULL OR p_referrer_path IS NOT NULL)
       )
       OR (
           p_referrer_kind = 'internal'
           AND (
               p_referrer_host IS NOT NULL
               OR p_referrer_path IS NULL
               OR char_length(p_referrer_path) NOT BETWEEN 1 AND 200
               OR p_referrer_path IS DISTINCT FROM btrim(p_referrer_path)
               OR p_referrer_path NOT LIKE '/%'
               OR p_referrer_path LIKE '//%'
               OR p_referrer_path ~ '[?#]'
               OR p_referrer_path ~ '[[:cntrl:]]'
               OR position(chr(92) IN p_referrer_path) <> 0
           )
       )
       OR (
           p_referrer_kind = 'external'
           AND (
               p_referrer_host IS NULL
               OR p_referrer_path IS NOT NULL
               OR char_length(p_referrer_host) NOT BETWEEN 1 AND 253
               OR p_referrer_host IS DISTINCT FROM lower(p_referrer_host)
               OR p_referrer_host IS DISTINCT FROM btrim(p_referrer_host)
               OR p_referrer_host !~ '^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$'
               OR p_referrer_host ~ '\.\.'
           )
       )
       OR (p_utm_source IS NOT NULL AND (
           char_length(p_utm_source) NOT BETWEEN 1 AND 100
           OR p_utm_source !~ '^[A-Za-z0-9._~-]+$'
       ))
       OR (p_utm_medium IS NOT NULL AND (
           char_length(p_utm_medium) NOT BETWEEN 1 AND 100
           OR p_utm_medium !~ '^[A-Za-z0-9._~-]+$'
       ))
       OR (p_utm_campaign IS NOT NULL AND (
           char_length(p_utm_campaign) NOT BETWEEN 1 AND 100
           OR p_utm_campaign !~ '^[A-Za-z0-9._~-]+$'
       ))
       OR (p_utm_term IS NOT NULL AND (
           char_length(p_utm_term) NOT BETWEEN 1 AND 100
           OR p_utm_term !~ '^[A-Za-z0-9._~-]+$'
       ))
       OR (p_utm_content IS NOT NULL AND (
           char_length(p_utm_content) NOT BETWEEN 1 AND 100
           OR p_utm_content !~ '^[A-Za-z0-9._~-]+$'
       ))
       OR COALESCE(char_length(p_utm_source), 0)
            + COALESCE(char_length(p_utm_medium), 0)
            + COALESCE(char_length(p_utm_campaign), 0)
            + COALESCE(char_length(p_utm_term), 0)
            + COALESCE(char_length(p_utm_content), 0) > 500 THEN
        RAISE EXCEPTION 'invalid_acquisition_attribution_event'
            USING ERRCODE = '22023';
    END IF;

    IF p_lead_id IS NOT NULL THEN
        SELECT crm_contact_id INTO derived_contact_id
        FROM public.leads
        WHERE id = p_lead_id
        FOR KEY SHARE;
    ELSE
        SELECT contact_id INTO derived_contact_id
        FROM public.checkout_intents
        WHERE id = p_checkout_intent_id
        FOR KEY SHARE;
    END IF;
    IF derived_contact_id IS NULL THEN
        RAISE EXCEPTION 'acquisition_attribution_reference_not_found'
            USING ERRCODE = '23503';
    END IF;

    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(p_request_id::TEXT, 58151)
    );

    SELECT * INTO existing_row
    FROM public.acquisition_attribution_events
    WHERE request_id = p_request_id
    FOR UPDATE;
    IF FOUND THEN
        IF ROW(
            existing_row.event_kind,
            existing_row.contact_id,
            existing_row.lead_id,
            existing_row.checkout_intent_id,
            existing_row.landing_path,
            existing_row.referrer_kind,
            existing_row.referrer_host,
            existing_row.referrer_path,
            existing_row.entry_language,
            existing_row.utm_source,
            existing_row.utm_medium,
            existing_row.utm_campaign,
            existing_row.utm_term,
            existing_row.utm_content
        ) IS DISTINCT FROM ROW(
            p_event_kind,
            derived_contact_id,
            p_lead_id,
            p_checkout_intent_id,
            p_landing_path,
            p_referrer_kind,
            p_referrer_host,
            p_referrer_path,
            p_entry_language,
            p_utm_source,
            p_utm_medium,
            p_utm_campaign,
            p_utm_term,
            p_utm_content
        ) THEN
            RAISE EXCEPTION 'acquisition_attribution_request_id_conflicts'
                USING ERRCODE = '40001';
        END IF;
        RETURN existing_row;
    END IF;

    INSERT INTO public.acquisition_attribution_events (
        request_id,
        event_kind,
        contact_id,
        lead_id,
        checkout_intent_id,
        landing_path,
        referrer_kind,
        referrer_host,
        referrer_path,
        entry_language,
        utm_source,
        utm_medium,
        utm_campaign,
        utm_term,
        utm_content,
        captured_at,
        created_at
    ) VALUES (
        p_request_id,
        p_event_kind,
        derived_contact_id,
        p_lead_id,
        p_checkout_intent_id,
        p_landing_path,
        p_referrer_kind,
        p_referrer_host,
        p_referrer_path,
        p_entry_language,
        p_utm_source,
        p_utm_medium,
        p_utm_campaign,
        p_utm_term,
        p_utm_content,
        event_timestamp,
        event_timestamp
    ) RETURNING * INTO event_row;

    RETURN event_row;
END;
$$;

REVOKE ALL ON FUNCTION public.record_acquisition_attribution_event(
    UUID, TEXT, UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT,
    TEXT, TEXT, TEXT, TEXT, TEXT
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_acquisition_attribution_event(
    UUID, TEXT, UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT,
    TEXT, TEXT, TEXT, TEXT, TEXT
) TO service_role;

REVOKE ALL ON FUNCTION private.guard_acquisition_attribution_event_immutable()
    FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON TABLE public.acquisition_attribution_events IS
    'Append-only, minimized acquisition touchpoints linked to CRM conversion records.';
