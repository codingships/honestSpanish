-- Durable, provider-agnostic checkpoints for Google/Resend fulfillment effects.
-- External calls happen outside these RPC transactions. An expired processing
-- lease is quarantined as ambiguous instead of being replayed automatically.

CREATE TABLE public.fulfillment_effects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID NOT NULL REFERENCES public.fulfillment_jobs(id) ON DELETE CASCADE,
    effect_key TEXT NOT NULL CHECK (
        char_length(effect_key) BETWEEN 1 AND 200
        AND effect_key ~ '^[a-z0-9][a-z0-9_.:/-]*$'
    ),
    effect_type TEXT NOT NULL CHECK (
        char_length(effect_type) BETWEEN 1 AND 80
        AND effect_type ~ '^[a-z][a-z0-9_.:-]*$'
    ),
    payload_sha256 TEXT NOT NULL CHECK (payload_sha256 ~ '^[a-f0-9]{64}$'),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (
        status IN ('pending', 'processing', 'succeeded', 'failed', 'ambiguous', 'manual_review')
    ),
    attempt_generation BIGINT NOT NULL DEFAULT 0 CHECK (attempt_generation >= 0),
    lease_owner TEXT CHECK (
        lease_owner IS NULL
        OR (
            char_length(lease_owner) BETWEEN 1 AND 200
            AND lease_owner ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]*$'
        )
    ),
    lease_expires_at TIMESTAMPTZ,
    provider_id TEXT CHECK (provider_id IS NULL OR char_length(provider_id) BETWEEN 1 AND 512),
    error JSONB CHECK (error IS NULL OR jsonb_typeof(error) = 'object'),
    result JSONB CHECK (result IS NULL OR jsonb_typeof(result) = 'object'),
    first_attempt_at TIMESTAMPTZ,
    last_attempt_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT fulfillment_effects_job_effect_unique UNIQUE (job_id, effect_key),
    CONSTRAINT fulfillment_effects_lease_state_check CHECK (
        (
            status = 'processing'
            AND lease_owner IS NOT NULL
            AND lease_expires_at IS NOT NULL
        )
        OR (
            status <> 'processing'
            AND lease_owner IS NULL
            AND lease_expires_at IS NULL
        )
    ),
    CONSTRAINT fulfillment_effects_attempt_state_check CHECK (
        (
            status = 'pending'
            AND attempt_generation = 0
            AND first_attempt_at IS NULL
            AND last_attempt_at IS NULL
        )
        OR (
            status <> 'pending'
            AND attempt_generation > 0
            AND first_attempt_at IS NOT NULL
            AND last_attempt_at IS NOT NULL
        )
    ),
    CONSTRAINT fulfillment_effects_error_state_check CHECK (
        (
            status IN ('failed', 'ambiguous', 'manual_review')
            AND error IS NOT NULL
        )
        OR (
            status IN ('pending', 'processing', 'succeeded')
            AND error IS NULL
        )
    ),
    CONSTRAINT fulfillment_effects_completion_state_check CHECK (
        (
            status = 'succeeded'
            AND completed_at IS NOT NULL
        )
        OR (
            status <> 'succeeded'
            AND completed_at IS NULL
        )
    ),
    CONSTRAINT fulfillment_effects_processing_payload_check CHECK (
        status <> 'processing'
        OR (provider_id IS NULL AND result IS NULL)
    ),
    CONSTRAINT fulfillment_effects_failed_provider_check CHECK (
        status <> 'failed'
        OR provider_id IS NULL
    )
);

CREATE INDEX fulfillment_effects_claimable_lease_idx
    ON public.fulfillment_effects(status, lease_expires_at, created_at)
    WHERE status IN ('pending', 'failed', 'processing');

ALTER TABLE public.fulfillment_effects ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.fulfillment_effects FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.fulfillment_effects TO service_role;

-- The UUID primary key deliberately creates no sequence, so there are no
-- fulfillment_effects sequence privileges to expose or grant.

CREATE OR REPLACE FUNCTION public.claim_fulfillment_effect(
    p_job_id UUID,
    p_effect_key TEXT,
    p_effect_type TEXT,
    p_payload_sha256 TEXT,
    p_lease_owner TEXT,
    p_lease_seconds INTEGER DEFAULT 120
)
RETURNS TABLE (
    effect_id UUID,
    claimed BOOLEAN,
    effect_status TEXT,
    attempt_generation BIGINT,
    provider_id TEXT,
    result JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_now TIMESTAMPTZ := pg_catalog.clock_timestamp();
    v_effect public.fulfillment_effects%ROWTYPE;
BEGIN
    IF p_job_id IS NULL
       OR p_effect_key IS NULL
       OR pg_catalog.char_length(p_effect_key) NOT BETWEEN 1 AND 200
       OR p_effect_key !~ '^[a-z0-9][a-z0-9_.:/-]*$'
       OR p_effect_type IS NULL
       OR pg_catalog.char_length(p_effect_type) NOT BETWEEN 1 AND 80
       OR p_effect_type !~ '^[a-z][a-z0-9_.:-]*$'
       OR p_payload_sha256 IS NULL
       OR p_payload_sha256 !~ '^[a-f0-9]{64}$'
       OR p_lease_owner IS NULL
       OR pg_catalog.char_length(p_lease_owner) NOT BETWEEN 1 AND 200
       OR p_lease_owner !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]*$'
       OR p_lease_seconds IS NULL
       OR p_lease_seconds NOT BETWEEN 30 AND 900 THEN
        RAISE EXCEPTION 'fulfillment_effect_claim_invalid' USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.fulfillment_effects (
        job_id,
        effect_key,
        effect_type,
        payload_sha256
    ) VALUES (
        p_job_id,
        p_effect_key,
        p_effect_type,
        p_payload_sha256
    )
    ON CONFLICT (job_id, effect_key) DO NOTHING;

    SELECT effect.*
    INTO v_effect
    FROM public.fulfillment_effects AS effect
    WHERE effect.job_id = p_job_id
      AND effect.effect_key = p_effect_key
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'fulfillment_effect_not_found' USING ERRCODE = 'P0001';
    END IF;

    IF v_effect.effect_type IS DISTINCT FROM p_effect_type
       OR v_effect.payload_sha256 IS DISTINCT FROM p_payload_sha256 THEN
        RAISE EXCEPTION 'fulfillment_effect_identity_mismatch' USING ERRCODE = 'P0001';
    END IF;

    IF v_effect.status IN ('succeeded', 'ambiguous', 'manual_review') THEN
        RETURN QUERY SELECT
            v_effect.id,
            FALSE,
            v_effect.status,
            v_effect.attempt_generation,
            v_effect.provider_id,
            v_effect.result;
        RETURN;
    END IF;

    IF v_effect.status = 'processing' THEN
        IF v_effect.lease_expires_at > v_now THEN
            RETURN QUERY SELECT
                v_effect.id,
                FALSE,
                v_effect.status,
                v_effect.attempt_generation,
                v_effect.provider_id,
                v_effect.result;
            RETURN;
        END IF;

        UPDATE public.fulfillment_effects AS effect
        SET status = 'ambiguous',
            lease_owner = NULL,
            lease_expires_at = NULL,
            error = pg_catalog.jsonb_build_object(
                'code', 'lease_expired_before_finalization',
                'expired_at', v_effect.lease_expires_at,
                'detected_at', v_now
            ),
            updated_at = v_now
        WHERE effect.id = v_effect.id
          AND effect.status = 'processing'
          AND effect.attempt_generation = v_effect.attempt_generation
          AND effect.lease_owner IS NOT DISTINCT FROM v_effect.lease_owner
        RETURNING effect.* INTO v_effect;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'fulfillment_effect_claim_conflict' USING ERRCODE = 'P0001';
        END IF;

        RETURN QUERY SELECT
            v_effect.id,
            FALSE,
            v_effect.status,
            v_effect.attempt_generation,
            v_effect.provider_id,
            v_effect.result;
        RETURN;
    END IF;

    IF v_effect.status NOT IN ('pending', 'failed') THEN
        RAISE EXCEPTION 'fulfillment_effect_not_claimable' USING ERRCODE = 'P0001';
    END IF;

    UPDATE public.fulfillment_effects AS effect
    SET status = 'processing',
        attempt_generation = v_effect.attempt_generation + 1,
        lease_owner = p_lease_owner,
        lease_expires_at = v_now + pg_catalog.make_interval(secs => p_lease_seconds),
        provider_id = NULL,
        error = NULL,
        result = NULL,
        first_attempt_at = COALESCE(v_effect.first_attempt_at, v_now),
        last_attempt_at = v_now,
        completed_at = NULL,
        updated_at = v_now
    WHERE effect.id = v_effect.id
      AND effect.status = v_effect.status
      AND effect.attempt_generation = v_effect.attempt_generation
      AND effect.lease_owner IS NOT DISTINCT FROM v_effect.lease_owner
    RETURNING effect.* INTO v_effect;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'fulfillment_effect_claim_conflict' USING ERRCODE = 'P0001';
    END IF;

    RETURN QUERY SELECT
        v_effect.id,
        TRUE,
        v_effect.status,
        v_effect.attempt_generation,
        v_effect.provider_id,
        v_effect.result;
END;
$$;

CREATE OR REPLACE FUNCTION public.finalize_fulfillment_effect(
    p_effect_id UUID,
    p_lease_owner TEXT,
    p_attempt_generation BIGINT,
    p_outcome TEXT,
    p_provider_id TEXT DEFAULT NULL,
    p_error JSONB DEFAULT NULL,
    p_result JSONB DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_now TIMESTAMPTZ := pg_catalog.clock_timestamp();
    v_updated_count BIGINT;
BEGIN
    IF p_effect_id IS NULL
       OR p_lease_owner IS NULL
       OR pg_catalog.char_length(p_lease_owner) NOT BETWEEN 1 AND 200
       OR p_lease_owner !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]*$'
       OR p_attempt_generation IS NULL
       OR p_attempt_generation < 1
       OR p_outcome IS NULL
       OR p_outcome NOT IN ('succeeded', 'failed', 'ambiguous', 'manual_review')
       OR (
           p_provider_id IS NOT NULL
           AND pg_catalog.char_length(p_provider_id) NOT BETWEEN 1 AND 512
       )
       OR (p_error IS NOT NULL AND pg_catalog.jsonb_typeof(p_error) <> 'object')
       OR (p_result IS NOT NULL AND pg_catalog.jsonb_typeof(p_result) <> 'object') THEN
        RAISE EXCEPTION 'fulfillment_effect_finalize_invalid' USING ERRCODE = '22023';
    END IF;

    IF (p_outcome = 'succeeded' AND p_error IS NOT NULL)
       OR (p_outcome <> 'succeeded' AND p_error IS NULL)
       OR (p_outcome = 'failed' AND p_provider_id IS NOT NULL) THEN
        RAISE EXCEPTION 'fulfillment_effect_finalize_incoherent' USING ERRCODE = '22023';
    END IF;

    UPDATE public.fulfillment_effects AS effect
    SET status = p_outcome,
        lease_owner = NULL,
        lease_expires_at = NULL,
        provider_id = p_provider_id,
        error = p_error,
        result = p_result,
        completed_at = CASE WHEN p_outcome = 'succeeded' THEN v_now ELSE NULL END,
        updated_at = v_now
    WHERE effect.id = p_effect_id
      AND effect.status = 'processing'
      AND effect.lease_owner = p_lease_owner
      AND effect.attempt_generation = p_attempt_generation
      AND effect.lease_expires_at > v_now;

    GET DIAGNOSTICS v_updated_count = ROW_COUNT;
    RETURN v_updated_count = 1;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_fulfillment_effect(UUID, TEXT, TEXT, TEXT, TEXT, INTEGER)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_fulfillment_effect(UUID, TEXT, TEXT, TEXT, TEXT, INTEGER)
    TO service_role;

REVOKE ALL ON FUNCTION public.finalize_fulfillment_effect(UUID, TEXT, BIGINT, TEXT, TEXT, JSONB, JSONB)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_fulfillment_effect(UUID, TEXT, BIGINT, TEXT, TEXT, JSONB, JSONB)
    TO service_role;

DROP TRIGGER IF EXISTS update_fulfillment_effects_updated_at ON public.fulfillment_effects;
CREATE TRIGGER update_fulfillment_effects_updated_at
    BEFORE UPDATE ON public.fulfillment_effects
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

COMMENT ON TABLE public.fulfillment_effects IS
    'Durable, fenced checkpoints for one external side effect of a fulfillment job.';
COMMENT ON FUNCTION public.claim_fulfillment_effect(UUID, TEXT, TEXT, TEXT, TEXT, INTEGER) IS
    'Creates or atomically claims one exact effect; expired processing leases become ambiguous and are never replayed blindly.';
COMMENT ON FUNCTION public.finalize_fulfillment_effect(UUID, TEXT, BIGINT, TEXT, TEXT, JSONB, JSONB) IS
    'Finalizes only the exact unexpired lease owner and attempt generation for a fulfillment effect.';
