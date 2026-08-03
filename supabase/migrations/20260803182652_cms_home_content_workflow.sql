-- Versioned, server-managed public content. The browser never writes these
-- tables directly: administrators use capability-checked RPCs and public pages
-- read only the currently published payload through server-only code.

CREATE TYPE public.cms_content_locale AS ENUM ('es', 'en', 'ru');
CREATE TYPE public.cms_content_draft_status AS ENUM (
    'draft',
    'published',
    'discarded'
);

CREATE TABLE public.cms_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    content_key TEXT NOT NULL,
    locale public.cms_content_locale NOT NULL,
    current_version INTEGER NOT NULL DEFAULT 0,
    published_payload JSONB,
    published_at TIMESTAMPTZ,
    published_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT date_trunc('second', clock_timestamp()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT date_trunc('second', clock_timestamp()),
    CONSTRAINT cms_documents_identity_unique UNIQUE (content_key, locale),
    CONSTRAINT cms_documents_content_key_check CHECK (
        content_key ~ '^[a-z0-9][a-z0-9_-]{1,63}$'
    ),
    CONSTRAINT cms_documents_version_check CHECK (current_version >= 0),
    CONSTRAINT cms_documents_publication_check CHECK (
        (
            current_version = 0
            AND published_payload IS NULL
            AND published_at IS NULL
        ) OR (
            current_version > 0
            AND published_payload IS NOT NULL
            AND jsonb_typeof(published_payload) = 'object'
            AND octet_length(published_payload::TEXT) BETWEEN 2 AND 131072
            AND published_at IS NOT NULL
        )
    )
);

CREATE TABLE public.cms_content_drafts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL REFERENCES public.cms_documents(id) ON DELETE CASCADE,
    base_version INTEGER NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1,
    status public.cms_content_draft_status NOT NULL DEFAULT 'draft',
    payload JSONB NOT NULL,
    created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    updated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT date_trunc('second', clock_timestamp()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT date_trunc('second', clock_timestamp()),
    published_at TIMESTAMPTZ,
    discarded_at TIMESTAMPTZ,
    published_version INTEGER,
    CONSTRAINT cms_content_drafts_base_version_check CHECK (base_version >= 0),
    CONSTRAINT cms_content_drafts_revision_check CHECK (revision > 0),
    CONSTRAINT cms_content_drafts_payload_check CHECK (
        jsonb_typeof(payload) = 'object'
        AND octet_length(payload::TEXT) BETWEEN 2 AND 131072
    ),
    CONSTRAINT cms_content_drafts_lifecycle_check CHECK (
        (
            status = 'draft'
            AND published_at IS NULL
            AND discarded_at IS NULL
            AND published_version IS NULL
        ) OR (
            status = 'published'
            AND published_at IS NOT NULL
            AND discarded_at IS NULL
            AND published_version IS NOT NULL
            AND published_version > 0
        ) OR (
            status = 'discarded'
            AND published_at IS NULL
            AND discarded_at IS NOT NULL
            AND published_version IS NULL
        )
    )
);

CREATE UNIQUE INDEX cms_content_drafts_one_open_per_document_idx
    ON public.cms_content_drafts(document_id)
    WHERE status = 'draft';
CREATE INDEX cms_content_drafts_document_history_idx
    ON public.cms_content_drafts(document_id, created_at DESC, id DESC);

CREATE TABLE public.cms_content_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL REFERENCES public.cms_documents(id) ON DELETE CASCADE,
    version INTEGER NOT NULL,
    payload JSONB NOT NULL,
    operation_id UUID NOT NULL UNIQUE,
    source_draft_id UUID REFERENCES public.cms_content_drafts(id) ON DELETE SET NULL,
    published_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    published_at TIMESTAMPTZ NOT NULL DEFAULT date_trunc('second', clock_timestamp()),
    CONSTRAINT cms_content_versions_document_version_unique UNIQUE (
        document_id,
        version
    ),
    CONSTRAINT cms_content_versions_version_check CHECK (version > 0),
    CONSTRAINT cms_content_versions_payload_check CHECK (
        jsonb_typeof(payload) = 'object'
        AND octet_length(payload::TEXT) BETWEEN 2 AND 131072
    )
);

CREATE INDEX cms_content_versions_document_history_idx
    ON public.cms_content_versions(document_id, version DESC);

ALTER TABLE public.cms_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cms_content_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cms_content_versions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.cms_documents
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.cms_content_drafts
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.cms_content_versions
    FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.cms_documents TO service_role;
GRANT SELECT ON TABLE public.cms_content_drafts TO service_role;
GRANT SELECT ON TABLE public.cms_content_versions TO service_role;

CREATE OR REPLACE FUNCTION private.guard_cms_content_versions_immutable()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
    RAISE EXCEPTION 'cms_content_versions_are_immutable'
        USING ERRCODE = '23514';
END
$$;

CREATE TRIGGER guard_cms_content_versions_immutable_trigger
    BEFORE UPDATE OR DELETE ON public.cms_content_versions
    FOR EACH ROW EXECUTE FUNCTION private.guard_cms_content_versions_immutable();

CREATE OR REPLACE FUNCTION public.create_cms_content_draft(
    p_actor_id UUID,
    p_content_key TEXT,
    p_locale public.cms_content_locale,
    p_initial_payload JSONB
)
RETURNS public.cms_content_drafts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    document_row public.cms_documents%ROWTYPE;
    draft_row public.cms_content_drafts%ROWTYPE;
    draft_payload JSONB;
BEGIN
    IF p_actor_id IS NULL
       OR p_content_key IS NULL
       OR p_locale IS NULL
       OR p_initial_payload IS NULL
       OR p_content_key !~ '^[a-z0-9][a-z0-9_-]{1,63}$'
       OR jsonb_typeof(p_initial_payload) <> 'object'
       OR octet_length(p_initial_payload::TEXT) NOT BETWEEN 2 AND 131072 THEN
        RAISE EXCEPTION 'cms_content_invalid_draft'
            USING ERRCODE = '22023';
    END IF;

    IF NOT private.admin_has_capability(
        p_actor_id,
        'content.write'::public.admin_capability
    ) THEN
        RAISE EXCEPTION 'cms_content_forbidden'
            USING ERRCODE = '42501';
    END IF;

    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(p_content_key || ':' || p_locale::TEXT, 78129)
    );

    INSERT INTO public.cms_documents (content_key, locale)
    VALUES (p_content_key, p_locale)
    ON CONFLICT (content_key, locale) DO NOTHING;

    SELECT document.*
    INTO STRICT document_row
    FROM public.cms_documents AS document
    WHERE document.content_key = p_content_key
      AND document.locale = p_locale
    FOR UPDATE;

    SELECT draft.*
    INTO draft_row
    FROM public.cms_content_drafts AS draft
    WHERE draft.document_id = document_row.id
      AND draft.status = 'draft'::public.cms_content_draft_status
    LIMIT 1;

    IF FOUND THEN
        RETURN draft_row;
    END IF;

    draft_payload := COALESCE(document_row.published_payload, p_initial_payload);
    IF jsonb_typeof(draft_payload) <> 'object'
       OR octet_length(draft_payload::TEXT) NOT BETWEEN 2 AND 131072 THEN
        RAISE EXCEPTION 'cms_content_invalid_payload'
            USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.cms_content_drafts (
        document_id,
        base_version,
        payload,
        created_by,
        updated_by
    ) VALUES (
        document_row.id,
        document_row.current_version,
        draft_payload,
        p_actor_id,
        p_actor_id
    )
    RETURNING * INTO draft_row;

    INSERT INTO public.admin_audit_log (
        admin_id,
        action,
        entity_type,
        entity_id,
        before,
        after
    ) VALUES (
        p_actor_id,
        'cms_content.draft.create',
        'cms_document',
        document_row.id::TEXT,
        NULL,
        pg_catalog.jsonb_build_object(
            'content_key', p_content_key,
            'locale', p_locale,
            'draft_id', draft_row.id,
            'base_version', draft_row.base_version,
            'revision', draft_row.revision
        )
    );

    RETURN draft_row;
END
$$;

CREATE OR REPLACE FUNCTION public.update_cms_content_draft(
    p_actor_id UUID,
    p_draft_id UUID,
    p_expected_revision INTEGER,
    p_payload JSONB
)
RETURNS public.cms_content_drafts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    draft_row public.cms_content_drafts%ROWTYPE;
BEGIN
    IF p_actor_id IS NULL
       OR p_draft_id IS NULL
       OR p_expected_revision IS NULL
       OR p_expected_revision <= 0
       OR p_payload IS NULL
       OR jsonb_typeof(p_payload) <> 'object'
       OR octet_length(p_payload::TEXT) NOT BETWEEN 2 AND 131072 THEN
        RAISE EXCEPTION 'cms_content_invalid_update'
            USING ERRCODE = '22023';
    END IF;

    IF NOT private.admin_has_capability(
        p_actor_id,
        'content.write'::public.admin_capability
    ) THEN
        RAISE EXCEPTION 'cms_content_forbidden'
            USING ERRCODE = '42501';
    END IF;

    SELECT draft.*
    INTO draft_row
    FROM public.cms_content_drafts AS draft
    WHERE draft.id = p_draft_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'cms_content_draft_not_found'
            USING ERRCODE = 'P0002';
    END IF;
    IF draft_row.status <> 'draft'::public.cms_content_draft_status THEN
        RAISE EXCEPTION 'cms_content_draft_closed'
            USING ERRCODE = '23514';
    END IF;
    IF draft_row.revision <> p_expected_revision THEN
        RAISE EXCEPTION 'cms_content_stale_revision'
            USING ERRCODE = '40001';
    END IF;

    UPDATE public.cms_content_drafts AS draft
    SET payload = p_payload,
        revision = draft.revision + 1,
        updated_by = p_actor_id,
        updated_at = date_trunc('second', clock_timestamp())
    WHERE draft.id = p_draft_id
    RETURNING * INTO draft_row;

    INSERT INTO public.admin_audit_log (
        admin_id,
        action,
        entity_type,
        entity_id,
        before,
        after
    ) VALUES (
        p_actor_id,
        'cms_content.draft.update',
        'cms_document',
        draft_row.document_id::TEXT,
        pg_catalog.jsonb_build_object('revision', p_expected_revision),
        pg_catalog.jsonb_build_object(
            'draft_id', draft_row.id,
            'revision', draft_row.revision
        )
    );

    RETURN draft_row;
END
$$;

CREATE OR REPLACE FUNCTION public.discard_cms_content_draft(
    p_actor_id UUID,
    p_draft_id UUID,
    p_expected_revision INTEGER
)
RETURNS public.cms_content_drafts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    draft_row public.cms_content_drafts%ROWTYPE;
BEGIN
    IF p_actor_id IS NULL
       OR p_draft_id IS NULL
       OR p_expected_revision IS NULL
       OR p_expected_revision <= 0 THEN
        RAISE EXCEPTION 'cms_content_invalid_discard'
            USING ERRCODE = '22023';
    END IF;

    IF NOT private.admin_has_capability(
        p_actor_id,
        'content.write'::public.admin_capability
    ) THEN
        RAISE EXCEPTION 'cms_content_forbidden'
            USING ERRCODE = '42501';
    END IF;

    SELECT draft.*
    INTO draft_row
    FROM public.cms_content_drafts AS draft
    WHERE draft.id = p_draft_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'cms_content_draft_not_found'
            USING ERRCODE = 'P0002';
    END IF;
    IF draft_row.status = 'discarded'::public.cms_content_draft_status THEN
        RETURN draft_row;
    END IF;
    IF draft_row.status <> 'draft'::public.cms_content_draft_status THEN
        RAISE EXCEPTION 'cms_content_draft_closed'
            USING ERRCODE = '23514';
    END IF;
    IF draft_row.revision <> p_expected_revision THEN
        RAISE EXCEPTION 'cms_content_stale_revision'
            USING ERRCODE = '40001';
    END IF;

    UPDATE public.cms_content_drafts AS draft
    SET status = 'discarded'::public.cms_content_draft_status,
        discarded_at = date_trunc('second', clock_timestamp()),
        updated_by = p_actor_id,
        updated_at = date_trunc('second', clock_timestamp())
    WHERE draft.id = p_draft_id
    RETURNING * INTO draft_row;

    INSERT INTO public.admin_audit_log (
        admin_id,
        action,
        entity_type,
        entity_id,
        before,
        after
    ) VALUES (
        p_actor_id,
        'cms_content.draft.discard',
        'cms_document',
        draft_row.document_id::TEXT,
        pg_catalog.jsonb_build_object(
            'draft_id', draft_row.id,
            'revision', draft_row.revision
        ),
        NULL
    );

    RETURN draft_row;
END
$$;

CREATE OR REPLACE FUNCTION public.publish_cms_content_draft(
    p_actor_id UUID,
    p_draft_id UUID,
    p_expected_revision INTEGER
)
RETURNS public.cms_content_drafts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    draft_row public.cms_content_drafts%ROWTYPE;
    document_row public.cms_documents%ROWTYPE;
    next_version INTEGER;
BEGIN
    IF p_actor_id IS NULL
       OR p_draft_id IS NULL
       OR p_expected_revision IS NULL
       OR p_expected_revision <= 0 THEN
        RAISE EXCEPTION 'cms_content_invalid_publish'
            USING ERRCODE = '22023';
    END IF;

    IF NOT private.admin_has_capability(
        p_actor_id,
        'content.write'::public.admin_capability
    ) THEN
        RAISE EXCEPTION 'cms_content_forbidden'
            USING ERRCODE = '42501';
    END IF;

    SELECT draft.*
    INTO draft_row
    FROM public.cms_content_drafts AS draft
    WHERE draft.id = p_draft_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'cms_content_draft_not_found'
            USING ERRCODE = 'P0002';
    END IF;
    IF draft_row.status = 'published'::public.cms_content_draft_status THEN
        RETURN draft_row;
    END IF;
    IF draft_row.status <> 'draft'::public.cms_content_draft_status THEN
        RAISE EXCEPTION 'cms_content_draft_closed'
            USING ERRCODE = '23514';
    END IF;
    IF draft_row.revision <> p_expected_revision THEN
        RAISE EXCEPTION 'cms_content_stale_revision'
            USING ERRCODE = '40001';
    END IF;

    SELECT document.*
    INTO STRICT document_row
    FROM public.cms_documents AS document
    WHERE document.id = draft_row.document_id
    FOR UPDATE;

    IF document_row.current_version <> draft_row.base_version THEN
        RAISE EXCEPTION 'cms_content_stale_base_version'
            USING ERRCODE = '40001';
    END IF;

    next_version := document_row.current_version + 1;

    INSERT INTO public.cms_content_versions (
        document_id,
        version,
        payload,
        operation_id,
        source_draft_id,
        published_by
    ) VALUES (
        document_row.id,
        next_version,
        draft_row.payload,
        draft_row.id,
        draft_row.id,
        p_actor_id
    );

    UPDATE public.cms_documents AS document
    SET current_version = next_version,
        published_payload = draft_row.payload,
        published_at = date_trunc('second', clock_timestamp()),
        published_by = p_actor_id,
        updated_at = date_trunc('second', clock_timestamp())
    WHERE document.id = document_row.id;

    UPDATE public.cms_content_drafts AS draft
    SET status = 'published'::public.cms_content_draft_status,
        published_at = date_trunc('second', clock_timestamp()),
        published_version = next_version,
        updated_by = p_actor_id,
        updated_at = date_trunc('second', clock_timestamp())
    WHERE draft.id = draft_row.id
    RETURNING * INTO draft_row;

    INSERT INTO public.admin_audit_log (
        admin_id,
        action,
        entity_type,
        entity_id,
        before,
        after
    ) VALUES (
        p_actor_id,
        'cms_content.publish',
        'cms_document',
        document_row.id::TEXT,
        pg_catalog.jsonb_build_object(
            'version', document_row.current_version,
            'draft_id', draft_row.id
        ),
        pg_catalog.jsonb_build_object(
            'version', next_version,
            'draft_id', draft_row.id
        )
    );

    RETURN draft_row;
END
$$;

CREATE OR REPLACE FUNCTION public.rollback_cms_content_document(
    p_actor_id UUID,
    p_document_id UUID,
    p_source_version INTEGER,
    p_expected_current_version INTEGER,
    p_operation_id UUID
)
RETURNS public.cms_documents
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    document_row public.cms_documents%ROWTYPE;
    source_payload JSONB;
    existing_version public.cms_content_versions%ROWTYPE;
    next_version INTEGER;
BEGIN
    IF p_actor_id IS NULL
       OR p_document_id IS NULL
       OR p_source_version IS NULL
       OR p_source_version <= 0
       OR p_expected_current_version IS NULL
       OR p_expected_current_version <= 0
       OR p_operation_id IS NULL THEN
        RAISE EXCEPTION 'cms_content_invalid_rollback'
            USING ERRCODE = '22023';
    END IF;

    IF NOT private.admin_has_capability(
        p_actor_id,
        'content.write'::public.admin_capability
    ) THEN
        RAISE EXCEPTION 'cms_content_forbidden'
            USING ERRCODE = '42501';
    END IF;

    SELECT version_row.*
    INTO existing_version
    FROM public.cms_content_versions AS version_row
    WHERE version_row.operation_id = p_operation_id;

    IF FOUND THEN
        IF existing_version.document_id <> p_document_id THEN
            RAISE EXCEPTION 'cms_content_operation_conflict'
                USING ERRCODE = '23505';
        END IF;
        SELECT document.*
        INTO STRICT document_row
        FROM public.cms_documents AS document
        WHERE document.id = p_document_id;
        RETURN document_row;
    END IF;

    SELECT document.*
    INTO document_row
    FROM public.cms_documents AS document
    WHERE document.id = p_document_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'cms_content_document_not_found'
            USING ERRCODE = 'P0002';
    END IF;
    IF document_row.current_version <> p_expected_current_version THEN
        RAISE EXCEPTION 'cms_content_stale_current_version'
            USING ERRCODE = '40001';
    END IF;
    IF EXISTS (
        SELECT 1
        FROM public.cms_content_drafts AS draft
        WHERE draft.document_id = p_document_id
          AND draft.status = 'draft'::public.cms_content_draft_status
    ) THEN
        RAISE EXCEPTION 'cms_content_open_draft_blocks_rollback'
            USING ERRCODE = '23514';
    END IF;

    SELECT version_row.payload
    INTO source_payload
    FROM public.cms_content_versions AS version_row
    WHERE version_row.document_id = p_document_id
      AND version_row.version = p_source_version;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'cms_content_version_not_found'
            USING ERRCODE = 'P0002';
    END IF;

    next_version := document_row.current_version + 1;

    INSERT INTO public.cms_content_versions (
        document_id,
        version,
        payload,
        operation_id,
        source_draft_id,
        published_by
    ) VALUES (
        document_row.id,
        next_version,
        source_payload,
        p_operation_id,
        NULL,
        p_actor_id
    );

    UPDATE public.cms_documents AS document
    SET current_version = next_version,
        published_payload = source_payload,
        published_at = date_trunc('second', clock_timestamp()),
        published_by = p_actor_id,
        updated_at = date_trunc('second', clock_timestamp())
    WHERE document.id = document_row.id
    RETURNING * INTO document_row;

    INSERT INTO public.admin_audit_log (
        admin_id,
        action,
        entity_type,
        entity_id,
        before,
        after
    ) VALUES (
        p_actor_id,
        'cms_content.rollback',
        'cms_document',
        document_row.id::TEXT,
        pg_catalog.jsonb_build_object(
            'version', p_expected_current_version
        ),
        pg_catalog.jsonb_build_object(
            'version', next_version,
            'source_version', p_source_version,
            'operation_id', p_operation_id
        )
    );

    RETURN document_row;
END
$$;

REVOKE ALL ON FUNCTION private.guard_cms_content_versions_immutable()
    FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.create_cms_content_draft(
    UUID,
    TEXT,
    public.cms_content_locale,
    JSONB
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_cms_content_draft(
    UUID,
    TEXT,
    public.cms_content_locale,
    JSONB
) TO service_role;

REVOKE ALL ON FUNCTION public.update_cms_content_draft(
    UUID,
    UUID,
    INTEGER,
    JSONB
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_cms_content_draft(
    UUID,
    UUID,
    INTEGER,
    JSONB
) TO service_role;

REVOKE ALL ON FUNCTION public.discard_cms_content_draft(
    UUID,
    UUID,
    INTEGER
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.discard_cms_content_draft(
    UUID,
    UUID,
    INTEGER
) TO service_role;

REVOKE ALL ON FUNCTION public.publish_cms_content_draft(
    UUID,
    UUID,
    INTEGER
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.publish_cms_content_draft(
    UUID,
    UUID,
    INTEGER
) TO service_role;

REVOKE ALL ON FUNCTION public.rollback_cms_content_document(
    UUID,
    UUID,
    INTEGER,
    INTEGER,
    UUID
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rollback_cms_content_document(
    UUID,
    UUID,
    INTEGER,
    INTEGER,
    UUID
) TO service_role;

COMMENT ON TABLE public.cms_documents IS
    'Stable public-content identity and its only currently published payload.';
COMMENT ON TABLE public.cms_content_drafts IS
    'Server-managed editable proposals; at most one open draft per document.';
COMMENT ON TABLE public.cms_content_versions IS
    'Immutable publication history. Rollback creates a new version instead of rewriting history.';
COMMENT ON FUNCTION public.create_cms_content_draft(
    UUID,
    TEXT,
    public.cms_content_locale,
    JSONB
) IS 'Creates or returns the single open content draft after capability validation.';
COMMENT ON FUNCTION public.publish_cms_content_draft(UUID, UUID, INTEGER) IS
    'Atomically publishes one validated draft as the next immutable content version.';
COMMENT ON FUNCTION public.rollback_cms_content_document(
    UUID,
    UUID,
    INTEGER,
    INTEGER,
    UUID
) IS 'Idempotently republishes an older payload as a new immutable version.';
