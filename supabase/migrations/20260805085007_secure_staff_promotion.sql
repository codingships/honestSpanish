-- Keep staff onboarding inside the product without trusting browser metadata.
-- Teacher activation remains handled by activate_teacher_profile(); this
-- migration adds the equivalent explicit, verified and audited transition for
-- administrator accounts.

CREATE UNIQUE INDEX admin_audit_log_staff_invitation_request_key
    ON public.admin_audit_log(action, entity_id)
    WHERE action = 'staff.invitation.requested'
      AND entity_type = 'staff_invitation';

CREATE UNIQUE INDEX admin_audit_log_admin_promotion_request_key
    ON public.admin_audit_log((after ->> 'request_id'))
    WHERE action = 'admin_access.promote'
      AND entity_type = 'profile'
      AND after ? 'request_id';

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
        IS NOT DISTINCT FROM OLD.id::TEXT THEN
        IF OLD.role IS DISTINCT FROM 'student'::public.user_role
           OR NEW.role IS DISTINCT FROM 'teacher'::public.user_role THEN
            RAISE EXCEPTION 'profile_role_transition_is_invalid'
                USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
    END IF;

    IF current_setting('app.admin_profile_promotion_profile_id', TRUE)
        IS NOT DISTINCT FROM OLD.id::TEXT THEN
        IF OLD.role IS DISTINCT FROM 'student'::public.user_role
           OR NEW.role IS DISTINCT FROM 'admin'::public.user_role THEN
            RAISE EXCEPTION 'profile_role_transition_is_invalid'
                USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
    END IF;

    RAISE EXCEPTION 'profile_role_requires_managed_activation'
        USING ERRCODE = '42501';
END;
$$;

CREATE OR REPLACE FUNCTION public.promote_admin_profile(
    p_request_id UUID,
    p_profile_id UUID,
    p_access_role public.admin_access_role,
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
    existing_audit public.admin_audit_log%ROWTYPE;
    before_snapshot JSONB;
    auth_email TEXT;
    auth_email_confirmed_at TIMESTAMPTZ;
    trimmed_reason TEXT := btrim(p_reason);
BEGIN
    IF p_request_id IS NULL
       OR p_profile_id IS NULL
       OR p_access_role IS NULL
       OR p_admin_id IS NULL
       OR p_reason IS NULL
       OR char_length(trimmed_reason) NOT BETWEEN 5 AND 1000 THEN
        RAISE EXCEPTION 'admin_profile_promotion_invalid'
            USING ERRCODE = '22023';
    END IF;

    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(p_request_id::TEXT, 58176)
    );
    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(p_profile_id::TEXT, 58174)
    );

    IF NOT private.admin_has_capability(
        p_admin_id,
        'access.write'::public.admin_capability
    ) THEN
        RAISE EXCEPTION 'admin_profile_promotion_forbidden'
            USING ERRCODE = '42501';
    END IF;

    SELECT * INTO profile_row
    FROM public.profiles
    WHERE id = p_profile_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'admin_profile_promotion_not_found'
            USING ERRCODE = 'P0002';
    END IF;

    SELECT * INTO existing_audit
    FROM public.admin_audit_log
    WHERE action = 'admin_access.promote'
      AND entity_type = 'profile'
      AND after ->> 'request_id' = p_request_id::TEXT
    ORDER BY created_at, id
    LIMIT 1;
    IF existing_audit.id IS NOT NULL THEN
        IF existing_audit.entity_id IS DISTINCT FROM p_profile_id::TEXT
           OR profile_row.role IS DISTINCT FROM 'admin'::public.user_role
           OR existing_audit.admin_id IS DISTINCT FROM p_admin_id
           OR existing_audit.after ->> 'access_role' IS DISTINCT FROM p_access_role::TEXT
           OR existing_audit.after ->> 'reason' IS DISTINCT FROM trimmed_reason
           OR NOT EXISTS (
                SELECT 1
                FROM public.admin_role_assignments AS assignment
                WHERE assignment.profile_id = p_profile_id
                  AND assignment.access_role = p_access_role
           ) THEN
            RAISE EXCEPTION 'admin_profile_promotion_request_conflicts'
                USING ERRCODE = '40001';
        END IF;

        RETURN pg_catalog.jsonb_build_object(
            'profile_id', profile_row.id,
            'profile_role', profile_row.role,
            'access_role', p_access_role,
            'changed', FALSE
        );
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
        RAISE EXCEPTION 'admin_profile_promotion_requires_verified_auth_identity'
            USING ERRCODE = '23514';
    END IF;

    IF profile_row.role IS DISTINCT FROM 'student'::public.user_role
       OR NULLIF(btrim(profile_row.email), '') IS NULL
       OR NULLIF(btrim(profile_row.full_name), '') IS NULL
       OR NOT profile_row.adult_confirmed
       OR profile_row.adult_confirmed_at IS NULL
       OR NULLIF(btrim(profile_row.age_policy_version), '') IS NULL THEN
        RAISE EXCEPTION 'admin_profile_promotion_requires_clean_student'
            USING ERRCODE = '23514';
    END IF;

    IF EXISTS (SELECT 1 FROM public.subscriptions WHERE student_id = p_profile_id)
       OR EXISTS (SELECT 1 FROM public.checkout_intents WHERE student_id = p_profile_id)
       OR EXISTS (SELECT 1 FROM public.payments WHERE student_id = p_profile_id)
       OR EXISTS (SELECT 1 FROM public.sessions WHERE student_id = p_profile_id)
       OR EXISTS (SELECT 1 FROM public.student_teachers WHERE student_id = p_profile_id)
       OR EXISTS (SELECT 1 FROM public.fulfillment_jobs WHERE student_id = p_profile_id) THEN
        RAISE EXCEPTION 'admin_profile_promotion_has_student_dependencies'
            USING ERRCODE = '23514';
    END IF;

    before_snapshot := pg_catalog.jsonb_build_object(
        'role', profile_row.role
    );
    PERFORM set_config(
        'app.admin_profile_promotion_profile_id',
        p_profile_id::TEXT,
        TRUE
    );

    UPDATE public.profiles
    SET role = 'admin'::public.user_role
    WHERE id = p_profile_id
    RETURNING * INTO profile_row;

    PERFORM set_config('app.admin_profile_promotion_profile_id', '', TRUE);

    INSERT INTO public.admin_role_assignments (
        profile_id,
        access_role,
        granted_by
    ) VALUES (
        p_profile_id,
        p_access_role,
        p_admin_id
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
        'admin_access.promote',
        'profile',
        p_profile_id::TEXT,
        before_snapshot,
        pg_catalog.jsonb_build_object(
            'role', profile_row.role,
            'request_id', p_request_id,
            'access_role', p_access_role,
            'reason', trimmed_reason
        )
    );

    RETURN pg_catalog.jsonb_build_object(
        'profile_id', profile_row.id,
        'profile_role', profile_row.role,
        'access_role', p_access_role,
        'changed', TRUE
    );
END;
$$;

REVOKE ALL ON FUNCTION public.promote_admin_profile(
    UUID,
    UUID,
    public.admin_access_role,
    UUID,
    TEXT
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.promote_admin_profile(
    UUID,
    UUID,
    public.admin_access_role,
    UUID,
    TEXT
) TO service_role;

COMMENT ON FUNCTION public.promote_admin_profile(
    UUID,
    UUID,
    public.admin_access_role,
    UUID,
    TEXT
) IS 'Promotes one verified, dependency-free invited account to administrator and grants its first audited access role.';
