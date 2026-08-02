-- Atomic, auditable administration for teacher activation and sellable slots.
-- Auth-account creation remains outside this migration: a teacher first creates
-- and verifies a normal account, then an administrator activates that clean
-- profile and its compensation engagement in one database transaction.

CREATE TABLE public.bookable_slot_admin_operations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id UUID NOT NULL UNIQUE,
    slot_id UUID NOT NULL REFERENCES public.bookable_slots(id) ON DELETE RESTRICT,
    action TEXT NOT NULL CHECK (
        action IN ('create', 'publish', 'resume', 'pause', 'retire')
    ),
    admin_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    reason TEXT NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 5 AND 1000),
    normalized_payload JSONB NOT NULL,
    before_snapshot JSONB,
    after_snapshot JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT date_trunc('second', clock_timestamp()),
    CONSTRAINT bookable_slot_admin_operations_snapshot_shape CHECK (
        (action = 'create' AND before_snapshot IS NULL)
        OR (action <> 'create' AND before_snapshot IS NOT NULL)
    )
);

CREATE INDEX bookable_slot_admin_operations_slot_created_idx
    ON public.bookable_slot_admin_operations(slot_id, created_at, id);
CREATE INDEX bookable_slot_admin_operations_admin_created_idx
    ON public.bookable_slot_admin_operations(admin_id, created_at, id);

ALTER TABLE public.bookable_slot_admin_operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.bookable_slot_admin_operations
    FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.bookable_slot_admin_operations TO service_role;

CREATE OR REPLACE FUNCTION private.guard_bookable_slot_admin_operation_immutable()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
    RAISE EXCEPTION 'bookable_slot_admin_operation_is_immutable'
        USING ERRCODE = '23514';
END;
$$;

CREATE TRIGGER guard_bookable_slot_admin_operation_immutable_trigger
    BEFORE UPDATE OR DELETE ON public.bookable_slot_admin_operations
    FOR EACH ROW EXECUTE FUNCTION private.guard_bookable_slot_admin_operation_immutable();

-- All ordinary role transitions go through the activation RPC. A database
-- owner can still perform exceptional maintenance by explicitly disabling the
-- trigger, making that bypass visible instead of implicit in every session.
CREATE OR REPLACE FUNCTION private.guard_managed_profile_role_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
    IF NEW.role IS NOT DISTINCT FROM OLD.role THEN
        RETURN NEW;
    END IF;

    IF current_setting('app.teacher_profile_activation_profile_id', TRUE)
        IS DISTINCT FROM OLD.id::TEXT THEN
        RAISE EXCEPTION 'profile_role_requires_managed_activation'
            USING ERRCODE = '42501';
    END IF;

    IF OLD.role IS DISTINCT FROM 'student'::public.user_role
       OR NEW.role IS DISTINCT FROM 'teacher'::public.user_role THEN
        RAISE EXCEPTION 'profile_role_transition_is_invalid'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER guard_managed_profile_role_transition_trigger
    BEFORE UPDATE OF role ON public.profiles
    FOR EACH ROW EXECUTE FUNCTION private.guard_managed_profile_role_transition();

CREATE OR REPLACE FUNCTION public.activate_teacher_profile(
    p_request_id UUID,
    p_profile_id UUID,
    p_engagement_kind TEXT,
    p_effective_from TIMESTAMPTZ,
    p_admin_id UUID,
    p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    profile_row public.profiles%ROWTYPE;
    engagement_row public.teacher_compensation_engagements%ROWTYPE;
    existing_audit public.admin_audit_log%ROWTYPE;
    engagement_request_id UUID;
    trimmed_reason TEXT := btrim(p_reason);
    before_snapshot JSONB;
    auth_email TEXT;
    auth_email_confirmed_at TIMESTAMPTZ;
BEGIN
    IF p_request_id IS NULL
       OR p_profile_id IS NULL
       OR p_admin_id IS NULL
       OR p_engagement_kind NOT IN ('founder', 'external')
       OR p_effective_from IS NULL
       OR NOT pg_catalog.isfinite(p_effective_from)
       OR p_reason IS NULL
       OR char_length(trimmed_reason) NOT BETWEEN 5 AND 1000 THEN
        RAISE EXCEPTION 'invalid_teacher_profile_activation'
            USING ERRCODE = '22023';
    END IF;

    engagement_request_id := (
        substr(md5(p_request_id::TEXT || ':teacher-compensation-engagement'), 1, 8)
        || '-' || substr(md5(p_request_id::TEXT || ':teacher-compensation-engagement'), 9, 4)
        || '-' || substr(md5(p_request_id::TEXT || ':teacher-compensation-engagement'), 13, 4)
        || '-' || substr(md5(p_request_id::TEXT || ':teacher-compensation-engagement'), 17, 4)
        || '-' || substr(md5(p_request_id::TEXT || ':teacher-compensation-engagement'), 21, 12)
    )::UUID;

    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(p_request_id::TEXT, 58171)
    );

    IF NOT EXISTS (
        SELECT 1
        FROM public.profiles AS admin_profile
        WHERE admin_profile.id = p_admin_id
          AND admin_profile.role = 'admin'::public.user_role
    ) THEN
        RAISE EXCEPTION 'teacher_profile_activation_forbidden'
            USING ERRCODE = '42501';
    END IF;

    SELECT * INTO profile_row
    FROM public.profiles
    WHERE id = p_profile_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'teacher_profile_not_found'
            USING ERRCODE = 'P0002';
    END IF;

    SELECT user_account.email, user_account.email_confirmed_at
    INTO auth_email, auth_email_confirmed_at
    FROM auth.users AS user_account
    WHERE user_account.id = p_profile_id
    FOR SHARE;

    IF NOT FOUND
       OR auth_email_confirmed_at IS NULL
       OR NULLIF(btrim(auth_email), '') IS NULL
       OR lower(btrim(auth_email)) IS DISTINCT FROM lower(btrim(profile_row.email)) THEN
        RAISE EXCEPTION 'teacher_profile_activation_requires_verified_auth_identity'
            USING ERRCODE = '23514';
    END IF;

    SELECT * INTO engagement_row
    FROM public.teacher_compensation_engagements
    WHERE request_id = engagement_request_id;

    IF FOUND THEN
        SELECT * INTO existing_audit
        FROM public.admin_audit_log
        WHERE action = 'activate_teacher_profile'
          AND entity_type = 'profile'
          AND entity_id = p_profile_id::TEXT
          AND after ->> 'request_id' = p_request_id::TEXT
        ORDER BY created_at, id
        LIMIT 1;

        IF profile_row.role IS DISTINCT FROM 'teacher'::public.user_role
           OR engagement_row.teacher_id IS DISTINCT FROM p_profile_id
           OR engagement_row.engagement_kind IS DISTINCT FROM p_engagement_kind
           OR engagement_row.effective_from IS DISTINCT FROM p_effective_from
           OR engagement_row.configured_by IS DISTINCT FROM p_admin_id
           OR engagement_row.reason IS DISTINCT FROM trimmed_reason
           OR existing_audit.id IS NULL
           OR existing_audit.admin_id IS DISTINCT FROM p_admin_id THEN
            RAISE EXCEPTION 'teacher_profile_activation_request_conflicts'
                USING ERRCODE = '40001';
        END IF;

        RETURN pg_catalog.jsonb_build_object(
            'profile', pg_catalog.to_jsonb(profile_row),
            'engagement', pg_catalog.to_jsonb(engagement_row)
        );
    END IF;

    IF profile_row.role IS DISTINCT FROM 'student'::public.user_role THEN
        RAISE EXCEPTION 'teacher_profile_activation_requires_clean_student'
            USING ERRCODE = '23514';
    END IF;

    IF NULLIF(btrim(profile_row.email), '') IS NULL
       OR NULLIF(btrim(profile_row.full_name), '') IS NULL
       OR NOT profile_row.adult_confirmed
       OR profile_row.adult_confirmed_at IS NULL
       OR NULLIF(btrim(profile_row.age_policy_version), '') IS NULL THEN
        RAISE EXCEPTION 'teacher_profile_activation_requires_complete_profile'
            USING ERRCODE = '23514';
    END IF;

    IF EXISTS (SELECT 1 FROM public.subscriptions WHERE student_id = p_profile_id)
       OR EXISTS (SELECT 1 FROM public.checkout_intents WHERE student_id = p_profile_id)
       OR EXISTS (SELECT 1 FROM public.payments WHERE student_id = p_profile_id)
       OR EXISTS (SELECT 1 FROM public.sessions WHERE student_id = p_profile_id)
       OR EXISTS (SELECT 1 FROM public.student_teachers WHERE student_id = p_profile_id)
       OR EXISTS (SELECT 1 FROM public.fulfillment_jobs WHERE student_id = p_profile_id) THEN
        RAISE EXCEPTION 'teacher_profile_activation_has_student_dependencies'
            USING ERRCODE = '23514';
    END IF;

    before_snapshot := pg_catalog.to_jsonb(profile_row);
    PERFORM set_config(
        'app.teacher_profile_activation_profile_id',
        p_profile_id::TEXT,
        TRUE
    );

    UPDATE public.profiles
    SET role = 'teacher'::public.user_role
    WHERE id = p_profile_id
    RETURNING * INTO profile_row;

    PERFORM set_config('app.teacher_profile_activation_profile_id', '', TRUE);

    engagement_row := public.configure_teacher_compensation_engagement(
        engagement_request_id,
        p_profile_id,
        p_engagement_kind,
        p_effective_from,
        p_admin_id,
        trimmed_reason
    );

    INSERT INTO public.admin_audit_log (
        admin_id,
        action,
        entity_type,
        entity_id,
        before,
        after
    ) VALUES (
        p_admin_id,
        'activate_teacher_profile',
        'profile',
        p_profile_id::TEXT,
        before_snapshot,
        pg_catalog.to_jsonb(profile_row) || pg_catalog.jsonb_build_object(
            'request_id', p_request_id,
            'engagement_id', engagement_row.id,
            'engagement_kind', engagement_row.engagement_kind,
            'engagement_effective_from', engagement_row.effective_from,
            'reason', trimmed_reason
        )
    );

    RETURN pg_catalog.jsonb_build_object(
        'profile', pg_catalog.to_jsonb(profile_row),
        'engagement', pg_catalog.to_jsonb(engagement_row)
    );
END;
$$;

-- The existing compensation guard used wall-clock time, which rejected a
-- valid future engagement even when it was effective before the first class.
-- Align it with the sellable-slot contract; the early trigger below retains
-- the per-teacher lock before availability validation.
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
              AND engagement.effective_from <= NEW.first_occurrence_at
       ) THEN
        RAISE EXCEPTION 'teacher_compensation_engagement_required'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

-- Publishing must fail closed if the teacher has no economic classification
-- effective by the first class. Keeping this as a trigger also protects any
-- trusted legacy caller that still invokes publish_bookable_slot internally.
CREATE OR REPLACE FUNCTION private.guard_bookable_slot_teacher_engagement()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
    IF NEW.status = 'available'
       AND OLD.status IS DISTINCT FROM 'available' THEN
        -- This is the same per-teacher transaction lock used by availability
        -- mutation. It closes the publish-versus-disable race for every caller,
        -- including trusted callers of the raw internal publish function.
        PERFORM pg_catalog.pg_advisory_xact_lock(
            pg_catalog.hashtextextended(NEW.teacher_id::TEXT, 58173)
        );

        IF NOT EXISTS (
            SELECT 1
            FROM public.teacher_compensation_engagements AS engagement
            WHERE engagement.teacher_id = NEW.teacher_id
              AND engagement.effective_from <= NEW.first_occurrence_at
        ) THEN
            RAISE EXCEPTION 'bookable_slot_requires_teacher_engagement'
                USING ERRCODE = '23514';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

-- PostgreSQL fires triggers with the same timing/event alphabetically. The
-- `a_` prefix is contractual: this lock must be acquired before
-- guard_bookable_slot_contract_trigger reads teacher_availability.
CREATE TRIGGER a_lock_and_guard_bookable_slot_teacher_engagement_trigger
    BEFORE UPDATE OF status ON public.bookable_slots
    FOR EACH ROW EXECUTE FUNCTION private.guard_bookable_slot_teacher_engagement();

-- Removing availability must not leave a published or deliberately paused
-- sellable place without the weekly coverage that allowed its publication.
CREATE OR REPLACE FUNCTION private.guard_availability_covering_bookable_slots()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    slot_row RECORD;
    replacement_covers BOOLEAN;
    first_teacher_id UUID;
    second_teacher_id UUID;
BEGIN
    IF TG_OP = 'UPDATE'
       AND NEW.teacher_id IS DISTINCT FROM OLD.teacher_id THEN
        IF OLD.teacher_id::TEXT < NEW.teacher_id::TEXT THEN
            first_teacher_id := OLD.teacher_id;
            second_teacher_id := NEW.teacher_id;
        ELSE
            first_teacher_id := NEW.teacher_id;
            second_teacher_id := OLD.teacher_id;
        END IF;

        PERFORM pg_catalog.pg_advisory_xact_lock(
            pg_catalog.hashtextextended(first_teacher_id::TEXT, 58173)
        );
        PERFORM pg_catalog.pg_advisory_xact_lock(
            pg_catalog.hashtextextended(second_teacher_id::TEXT, 58173)
        );
    ELSE
        PERFORM pg_catalog.pg_advisory_xact_lock(
            pg_catalog.hashtextextended(OLD.teacher_id::TEXT, 58173)
        );
    END IF;

    IF NOT OLD.is_active THEN
        IF TG_OP = 'DELETE' THEN
            RETURN OLD;
        END IF;
        RETURN NEW;
    END IF;

    IF TG_OP = 'UPDATE'
       AND ROW(NEW.teacher_id, NEW.day_of_week, NEW.start_time, NEW.end_time, NEW.is_active)
           IS NOT DISTINCT FROM
           ROW(OLD.teacher_id, OLD.day_of_week, OLD.start_time, OLD.end_time, OLD.is_active) THEN
        RETURN NEW;
    END IF;

    FOR slot_row IN
        SELECT sellable.teacher_id, sellable.weekday, sellable.local_start_time
        FROM public.bookable_slots AS sellable
        WHERE sellable.teacher_id = OLD.teacher_id
          AND sellable.status IN ('available', 'paused')
          AND sellable.weekday = OLD.day_of_week
          AND OLD.start_time <= sellable.local_start_time
          AND OLD.end_time >= sellable.local_start_time + INTERVAL '50 minutes'
    LOOP
        replacement_covers := FALSE;

        IF TG_OP = 'UPDATE' THEN
            replacement_covers := NEW.is_active
                AND NEW.teacher_id = slot_row.teacher_id
                AND NEW.day_of_week = slot_row.weekday
                AND NEW.start_time <= slot_row.local_start_time
                AND NEW.end_time >= slot_row.local_start_time + INTERVAL '50 minutes'
                AND slot_row.local_start_time + INTERVAL '50 minutes' > slot_row.local_start_time;
        END IF;

        IF NOT replacement_covers THEN
            SELECT EXISTS (
            SELECT 1
            FROM public.teacher_availability AS alternative
            WHERE alternative.id <> OLD.id
              AND alternative.is_active
              AND alternative.teacher_id = slot_row.teacher_id
              AND alternative.day_of_week = slot_row.weekday
              AND alternative.start_time <= slot_row.local_start_time
              AND alternative.end_time >= slot_row.local_start_time + INTERVAL '50 minutes'
              AND slot_row.local_start_time + INTERVAL '50 minutes' > slot_row.local_start_time
            ) INTO replacement_covers;
        END IF;

        IF NOT replacement_covers THEN
            RAISE EXCEPTION 'teacher_availability_covers_sellable_slot'
                USING ERRCODE = '23514';
        END IF;
    END LOOP;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER guard_availability_covering_bookable_slots_trigger
    BEFORE UPDATE OR DELETE ON public.teacher_availability
    FOR EACH ROW EXECUTE FUNCTION private.guard_availability_covering_bookable_slots();

CREATE OR REPLACE FUNCTION public.admin_create_bookable_slot(
    p_request_id UUID,
    p_teacher_id UUID,
    p_package_id UUID,
    p_timezone_name TEXT,
    p_occurrences TIMESTAMPTZ[],
    p_admin_id UUID,
    p_reason TEXT
)
RETURNS public.bookable_slots
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    operation_row public.bookable_slot_admin_operations%ROWTYPE;
    slot_row public.bookable_slots%ROWTYPE;
    trimmed_reason TEXT := btrim(p_reason);
    normalized_payload JSONB;
BEGIN
    IF p_request_id IS NULL
       OR p_teacher_id IS NULL
       OR p_package_id IS NULL
       OR p_admin_id IS NULL
       OR p_reason IS NULL
       OR char_length(trimmed_reason) NOT BETWEEN 5 AND 1000
       OR NULLIF(btrim(p_timezone_name), '') IS NULL
       OR p_timezone_name <> 'Europe/Madrid'
       OR cardinality(p_occurrences) <> 4
       OR array_position(p_occurrences, NULL) IS NOT NULL
       OR EXISTS (
           SELECT 1 FROM unnest(p_occurrences) AS occurrence(starts_at)
           WHERE NOT pg_catalog.isfinite(occurrence.starts_at)
       ) THEN
        RAISE EXCEPTION 'invalid_admin_bookable_slot_creation'
            USING ERRCODE = '22023';
    END IF;

    normalized_payload := pg_catalog.jsonb_build_object(
        'teacher_id', p_teacher_id,
        'package_id', p_package_id,
        'timezone_name', p_timezone_name,
        'occurrences', pg_catalog.to_jsonb(p_occurrences)
    );

    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(p_request_id::TEXT, 58172)
    );
    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(p_teacher_id::TEXT, 58173)
    );

    SELECT * INTO operation_row
    FROM public.bookable_slot_admin_operations
    WHERE request_id = p_request_id
    FOR UPDATE;

    IF FOUND THEN
        IF operation_row.action IS DISTINCT FROM 'create'
           OR operation_row.admin_id IS DISTINCT FROM p_admin_id
           OR operation_row.reason IS DISTINCT FROM trimmed_reason
           OR operation_row.normalized_payload IS DISTINCT FROM normalized_payload THEN
            RAISE EXCEPTION 'bookable_slot_admin_request_conflicts'
                USING ERRCODE = '40001';
        END IF;

        SELECT populated.* INTO slot_row
        FROM pg_catalog.jsonb_populate_record(
            NULL::public.bookable_slots,
            operation_row.after_snapshot
        ) AS populated;
        RETURN slot_row;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = p_admin_id AND role = 'admin'::public.user_role
    ) THEN
        RAISE EXCEPTION 'admin_bookable_slot_creation_forbidden'
            USING ERRCODE = '42501';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.bookable_slots AS existing_slot
        WHERE existing_slot.teacher_id = p_teacher_id
          AND existing_slot.package_id = p_package_id
          AND existing_slot.first_occurrence_at = p_occurrences[1]
          AND existing_slot.status IN ('draft', 'available', 'paused')
    ) THEN
        RAISE EXCEPTION 'duplicate_nonterminal_bookable_slot'
            USING ERRCODE = '23505';
    END IF;

    slot_row := public.create_bookable_slot(
        p_package_id,
        p_teacher_id,
        p_timezone_name,
        p_occurrences,
        p_admin_id
    );

    INSERT INTO public.bookable_slot_admin_operations (
        request_id, slot_id, action, admin_id, reason,
        normalized_payload, before_snapshot, after_snapshot
    ) VALUES (
        p_request_id, slot_row.id, 'create', p_admin_id, trimmed_reason,
        normalized_payload, NULL, pg_catalog.to_jsonb(slot_row)
    );

    INSERT INTO public.admin_audit_log (
        admin_id, action, entity_type, entity_id, before, after
    ) VALUES (
        p_admin_id,
        'admin_create_bookable_slot',
        'bookable_slot',
        slot_row.id::TEXT,
        NULL,
        pg_catalog.to_jsonb(slot_row) || pg_catalog.jsonb_build_object(
            'request_id', p_request_id,
            'reason', trimmed_reason
        )
    );

    RETURN slot_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_transition_bookable_slot(
    p_request_id UUID,
    p_slot_id UUID,
    p_transition TEXT,
    p_admin_id UUID,
    p_reason TEXT
)
RETURNS public.bookable_slots
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    operation_row public.bookable_slot_admin_operations%ROWTYPE;
    slot_row public.bookable_slots%ROWTYPE;
    before_snapshot JSONB;
    trimmed_reason TEXT := btrim(p_reason);
    normalized_payload JSONB;
BEGIN
    IF p_request_id IS NULL
       OR p_slot_id IS NULL
       OR p_admin_id IS NULL
       OR p_transition NOT IN ('publish', 'resume', 'pause', 'retire')
       OR p_reason IS NULL
       OR char_length(trimmed_reason) NOT BETWEEN 5 AND 1000 THEN
        RAISE EXCEPTION 'invalid_admin_bookable_slot_transition'
            USING ERRCODE = '22023';
    END IF;

    normalized_payload := pg_catalog.jsonb_build_object(
        'slot_id', p_slot_id,
        'transition', p_transition
    );

    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(p_request_id::TEXT, 58172)
    );

    SELECT * INTO operation_row
    FROM public.bookable_slot_admin_operations
    WHERE request_id = p_request_id
    FOR UPDATE;

    IF FOUND THEN
        IF operation_row.action IS DISTINCT FROM p_transition
           OR operation_row.admin_id IS DISTINCT FROM p_admin_id
           OR operation_row.reason IS DISTINCT FROM trimmed_reason
           OR operation_row.normalized_payload IS DISTINCT FROM normalized_payload THEN
            RAISE EXCEPTION 'bookable_slot_admin_request_conflicts'
                USING ERRCODE = '40001';
        END IF;

        SELECT populated.* INTO slot_row
        FROM pg_catalog.jsonb_populate_record(
            NULL::public.bookable_slots,
            operation_row.after_snapshot
        ) AS populated;
        RETURN slot_row;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = p_admin_id AND role = 'admin'::public.user_role
    ) THEN
        RAISE EXCEPTION 'admin_bookable_slot_transition_forbidden'
            USING ERRCODE = '42501';
    END IF;

    SELECT * INTO slot_row
    FROM public.bookable_slots
    WHERE id = p_slot_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'bookable_slot_not_found'
            USING ERRCODE = 'P0002';
    END IF;

    IF (p_transition = 'publish' AND slot_row.status <> 'draft')
       OR (p_transition = 'resume' AND slot_row.status <> 'paused')
       OR (p_transition = 'pause' AND slot_row.status <> 'available')
       OR (p_transition = 'retire' AND slot_row.status NOT IN ('draft', 'available', 'paused')) THEN
        RAISE EXCEPTION 'bookable_slot_admin_transition_is_invalid'
            USING ERRCODE = '23514';
    END IF;

    IF p_transition IN ('pause', 'retire')
       AND EXISTS (
           SELECT 1
           FROM public.bookable_slot_holds
           WHERE slot_id = p_slot_id AND status = 'held'
       ) THEN
        RAISE EXCEPTION 'held_bookable_slot_cannot_be_paused_or_retired'
            USING ERRCODE = '23514';
    END IF;

    before_snapshot := pg_catalog.to_jsonb(slot_row);

    IF p_transition IN ('publish', 'resume') THEN
        slot_row := public.publish_bookable_slot(p_slot_id, p_admin_id);
    ELSIF p_transition = 'pause' THEN
        UPDATE public.bookable_slots
        SET status = 'paused'
        WHERE id = p_slot_id
        RETURNING * INTO slot_row;
    ELSE
        UPDATE public.bookable_slots
        SET status = 'retired'
        WHERE id = p_slot_id
        RETURNING * INTO slot_row;
    END IF;

    INSERT INTO public.bookable_slot_admin_operations (
        request_id, slot_id, action, admin_id, reason,
        normalized_payload, before_snapshot, after_snapshot
    ) VALUES (
        p_request_id, p_slot_id, p_transition, p_admin_id, trimmed_reason,
        normalized_payload, before_snapshot, pg_catalog.to_jsonb(slot_row)
    );

    INSERT INTO public.admin_audit_log (
        admin_id, action, entity_type, entity_id, before, after
    ) VALUES (
        p_admin_id,
        'admin_' || p_transition || '_bookable_slot',
        'bookable_slot',
        p_slot_id::TEXT,
        before_snapshot,
        pg_catalog.to_jsonb(slot_row) || pg_catalog.jsonb_build_object(
            'request_id', p_request_id,
            'reason', trimmed_reason
        )
    );

    RETURN slot_row;
END;
$$;

REVOKE ALL ON FUNCTION public.activate_teacher_profile(
    UUID, UUID, TEXT, TIMESTAMPTZ, UUID, TEXT
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.activate_teacher_profile(
    UUID, UUID, TEXT, TIMESTAMPTZ, UUID, TEXT
) TO service_role;

REVOKE ALL ON FUNCTION public.admin_create_bookable_slot(
    UUID, UUID, UUID, TEXT, TIMESTAMPTZ[], UUID, TEXT
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_create_bookable_slot(
    UUID, UUID, UUID, TEXT, TIMESTAMPTZ[], UUID, TEXT
) TO service_role;

REVOKE ALL ON FUNCTION public.admin_transition_bookable_slot(
    UUID, UUID, TEXT, UUID, TEXT
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_transition_bookable_slot(
    UUID, UUID, TEXT, UUID, TEXT
) TO service_role;

-- Raw slot mutation entry points are now internal implementation details.
REVOKE EXECUTE ON FUNCTION public.create_bookable_slot(
    UUID, UUID, TEXT, TIMESTAMPTZ[], UUID
) FROM service_role;
REVOKE EXECUTE ON FUNCTION public.publish_bookable_slot(UUID, UUID)
    FROM service_role;

REVOKE ALL ON FUNCTION
    private.guard_bookable_slot_admin_operation_immutable(),
    private.guard_managed_profile_role_transition(),
    private.guard_bookable_slot_teacher_engagement(),
    private.guard_availability_covering_bookable_slots()
FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON TABLE public.bookable_slot_admin_operations IS
    'Append-only idempotency and audit snapshots for administrator-managed sellable slot lifecycle transitions.';
COMMENT ON FUNCTION public.activate_teacher_profile(
    UUID, UUID, TEXT, TIMESTAMPTZ, UUID, TEXT
) IS 'Atomically activates a clean adult student profile as a teacher and creates its initial compensation engagement.';
COMMENT ON FUNCTION public.admin_create_bookable_slot(
    UUID, UUID, UUID, TEXT, TIMESTAMPTZ[], UUID, TEXT
) IS 'Idempotent audited administrator wrapper for draft sellable-slot creation.';
COMMENT ON FUNCTION public.admin_transition_bookable_slot(
    UUID, UUID, TEXT, UUID, TEXT
) IS 'Idempotent audited administrator transition for publish, resume, pause or retire.';
