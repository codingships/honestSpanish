-- Granular administrator access without changing the academic user-role model.
-- Existing administrators are promoted to owner exactly once so deployment is
-- backward-compatible. All later changes go through service-only, audited RPCs.

CREATE TYPE public.admin_access_role AS ENUM (
    'owner',
    'content_editor',
    'catalog_editor',
    'operator',
    'finance',
    'viewer'
);

CREATE TYPE public.admin_capability AS ENUM (
    'dashboard.read',
    'content.read',
    'content.write',
    'catalog.read',
    'catalog.write',
    'operations.read',
    'operations.write',
    'finance.read',
    'finance.write',
    'access.read',
    'access.write'
);

CREATE TABLE public.admin_role_assignments (
    profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    access_role public.admin_access_role NOT NULL,
    granted_by UUID REFERENCES public.profiles(id) ON DELETE RESTRICT,
    granted_at TIMESTAMPTZ NOT NULL DEFAULT date_trunc('second', clock_timestamp()),
    PRIMARY KEY (profile_id, access_role)
);

CREATE INDEX admin_role_assignments_role_profile_idx
    ON public.admin_role_assignments(access_role, profile_id);

ALTER TABLE public.admin_role_assignments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.admin_role_assignments
    FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.admin_role_assignments TO service_role;

INSERT INTO public.admin_role_assignments (
    profile_id,
    access_role,
    granted_by
)
SELECT
    profile.id,
    'owner'::public.admin_access_role,
    NULL
FROM public.profiles AS profile
WHERE profile.role = 'admin'::public.user_role
ON CONFLICT (profile_id, access_role) DO NOTHING;

CREATE OR REPLACE FUNCTION private.admin_role_has_capability(
    p_access_role public.admin_access_role,
    p_capability public.admin_capability
)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
SECURITY INVOKER
SET search_path = ''
AS $$
    SELECT CASE p_access_role
        WHEN 'owner'::public.admin_access_role THEN TRUE
        WHEN 'viewer'::public.admin_access_role THEN p_capability IN (
            'dashboard.read'::public.admin_capability,
            'content.read'::public.admin_capability,
            'catalog.read'::public.admin_capability,
            'operations.read'::public.admin_capability,
            'finance.read'::public.admin_capability,
            'access.read'::public.admin_capability
        )
        WHEN 'content_editor'::public.admin_access_role THEN p_capability IN (
            'content.read'::public.admin_capability,
            'content.write'::public.admin_capability
        )
        WHEN 'catalog_editor'::public.admin_access_role THEN p_capability IN (
            'catalog.read'::public.admin_capability,
            'catalog.write'::public.admin_capability
        )
        WHEN 'operator'::public.admin_access_role THEN p_capability IN (
            'operations.read'::public.admin_capability,
            'operations.write'::public.admin_capability
        )
        WHEN 'finance'::public.admin_access_role THEN p_capability IN (
            'finance.read'::public.admin_capability,
            'finance.write'::public.admin_capability
        )
        ELSE FALSE
    END
$$;

CREATE OR REPLACE FUNCTION private.admin_has_capability(
    p_profile_id UUID,
    p_capability public.admin_capability
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.profiles AS profile
        JOIN public.admin_role_assignments AS assignment
          ON assignment.profile_id = profile.id
        WHERE profile.id = p_profile_id
          AND profile.role = 'admin'::public.user_role
          AND private.admin_role_has_capability(
              assignment.access_role,
              p_capability
          )
    )
$$;

CREATE OR REPLACE FUNCTION public.has_my_admin_capability(
    p_capability public.admin_capability
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT COALESCE(
        private.admin_has_capability(auth.uid(), p_capability),
        FALSE
    )
$$;

CREATE OR REPLACE FUNCTION public.get_my_admin_capabilities()
RETURNS SETOF public.admin_capability
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT capability
    FROM pg_catalog.unnest(
        pg_catalog.enum_range(NULL::public.admin_capability)
    ) AS capability
    WHERE private.admin_has_capability(auth.uid(), capability)
    ORDER BY capability::TEXT
$$;

CREATE OR REPLACE FUNCTION public.admin_grant_access_role(
    p_actor_id UUID,
    p_profile_id UUID,
    p_access_role public.admin_access_role
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    target_role public.user_role;
    assignment_created BOOLEAN := FALSE;
BEGIN
    IF p_actor_id IS NULL OR p_profile_id IS NULL OR p_access_role IS NULL THEN
        RAISE EXCEPTION 'admin_access_invalid_grant'
            USING ERRCODE = '22023';
    END IF;

    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(p_profile_id::TEXT, 58175)
    );

    IF NOT private.admin_has_capability(
        p_actor_id,
        'access.write'::public.admin_capability
    ) THEN
        RAISE EXCEPTION 'admin_access_forbidden'
            USING ERRCODE = '42501';
    END IF;

    SELECT profile.role
    INTO target_role
    FROM public.profiles AS profile
    WHERE profile.id = p_profile_id
    FOR UPDATE;

    IF target_role IS DISTINCT FROM 'admin'::public.user_role THEN
        RAISE EXCEPTION 'admin_access_target_must_be_admin'
            USING ERRCODE = '23514';
    END IF;

    INSERT INTO public.admin_role_assignments (
        profile_id,
        access_role,
        granted_by
    ) VALUES (
        p_profile_id,
        p_access_role,
        p_actor_id
    )
    ON CONFLICT (profile_id, access_role) DO NOTHING;
    assignment_created := FOUND;

    IF assignment_created THEN
        INSERT INTO public.admin_audit_log (
            admin_id,
            action,
            entity_type,
            entity_id,
            before,
            after
        ) VALUES (
            p_actor_id,
            'admin_access.grant',
            'admin_access',
            p_profile_id::TEXT,
            NULL,
            pg_catalog.jsonb_build_object('access_role', p_access_role)
        );
    END IF;

    RETURN pg_catalog.jsonb_build_object(
        'changed', assignment_created,
        'profile_id', p_profile_id,
        'access_role', p_access_role
    );
END
$$;

CREATE OR REPLACE FUNCTION public.admin_revoke_access_role(
    p_actor_id UUID,
    p_profile_id UUID,
    p_access_role public.admin_access_role
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    assignment_removed BOOLEAN := FALSE;
    owner_count INTEGER;
BEGIN
    IF p_actor_id IS NULL OR p_profile_id IS NULL OR p_access_role IS NULL THEN
        RAISE EXCEPTION 'admin_access_invalid_revoke'
            USING ERRCODE = '22023';
    END IF;

    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended('admin-access-owners', 58175)
    );
    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(p_profile_id::TEXT, 58175)
    );

    IF NOT private.admin_has_capability(
        p_actor_id,
        'access.write'::public.admin_capability
    ) THEN
        RAISE EXCEPTION 'admin_access_forbidden'
            USING ERRCODE = '42501';
    END IF;

    IF p_access_role = 'owner'::public.admin_access_role
       AND EXISTS (
           SELECT 1
           FROM public.admin_role_assignments AS assignment
           WHERE assignment.profile_id = p_profile_id
             AND assignment.access_role = 'owner'::public.admin_access_role
       ) THEN
        SELECT count(*)::INTEGER
        INTO owner_count
        FROM public.admin_role_assignments AS assignment
        JOIN public.profiles AS profile ON profile.id = assignment.profile_id
        WHERE assignment.access_role = 'owner'::public.admin_access_role
          AND profile.role = 'admin'::public.user_role;

        IF owner_count <= 1 THEN
            RAISE EXCEPTION 'admin_access_last_owner'
                USING ERRCODE = '23514';
        END IF;
    END IF;

    DELETE FROM public.admin_role_assignments
    WHERE profile_id = p_profile_id
      AND access_role = p_access_role;
    assignment_removed := FOUND;

    IF assignment_removed THEN
        INSERT INTO public.admin_audit_log (
            admin_id,
            action,
            entity_type,
            entity_id,
            before,
            after
        ) VALUES (
            p_actor_id,
            'admin_access.revoke',
            'admin_access',
            p_profile_id::TEXT,
            pg_catalog.jsonb_build_object('access_role', p_access_role),
            NULL
        );
    END IF;

    RETURN pg_catalog.jsonb_build_object(
        'changed', assignment_removed,
        'profile_id', p_profile_id,
        'access_role', p_access_role
    );
END
$$;

-- The browser/API middleware is not a security boundary for Supabase's Data
-- API. Replace the historical all-admin policies with the same capability
-- model so a restricted administrator cannot bypass the application by using
-- their authenticated session directly.

DROP POLICY IF EXISTS "Admins can manage leads" ON public.leads;
DROP POLICY IF EXISTS "Admins can view leads" ON public.leads;
CREATE POLICY "Admin operations readers can view leads"
    ON public.leads FOR SELECT TO authenticated
    USING ((SELECT public.has_my_admin_capability(
        'operations.read'::public.admin_capability
    )));
CREATE POLICY "Admin operations writers can manage leads"
    ON public.leads FOR ALL TO authenticated
    USING ((SELECT public.has_my_admin_capability(
        'operations.write'::public.admin_capability
    )))
    WITH CHECK ((SELECT public.has_my_admin_capability(
        'operations.write'::public.admin_capability
    )));

DROP POLICY IF EXISTS "Admins can manage crm contacts" ON public.crm_contacts;
DROP POLICY IF EXISTS "Admins can manage crm opportunities" ON public.crm_opportunities;
DROP POLICY IF EXISTS "Admins can manage crm tasks" ON public.crm_tasks;
DROP POLICY IF EXISTS "Admins can manage crm activities" ON public.crm_activities;
DROP POLICY IF EXISTS "Admins can manage crm consents" ON public.crm_consents;

CREATE POLICY "Admin operations readers can view crm contacts"
    ON public.crm_contacts FOR SELECT TO authenticated
    USING ((SELECT public.has_my_admin_capability(
        'operations.read'::public.admin_capability
    )));
CREATE POLICY "Admin operations writers can manage crm contacts"
    ON public.crm_contacts FOR ALL TO authenticated
    USING ((SELECT public.has_my_admin_capability(
        'operations.write'::public.admin_capability
    )))
    WITH CHECK ((SELECT public.has_my_admin_capability(
        'operations.write'::public.admin_capability
    )));

CREATE POLICY "Admin operations readers can view crm opportunities"
    ON public.crm_opportunities FOR SELECT TO authenticated
    USING ((SELECT public.has_my_admin_capability(
        'operations.read'::public.admin_capability
    )));
CREATE POLICY "Admin operations writers can manage crm opportunities"
    ON public.crm_opportunities FOR ALL TO authenticated
    USING ((SELECT public.has_my_admin_capability(
        'operations.write'::public.admin_capability
    )))
    WITH CHECK ((SELECT public.has_my_admin_capability(
        'operations.write'::public.admin_capability
    )));

CREATE POLICY "Admin operations readers can view crm tasks"
    ON public.crm_tasks FOR SELECT TO authenticated
    USING ((SELECT public.has_my_admin_capability(
        'operations.read'::public.admin_capability
    )));
CREATE POLICY "Admin operations writers can manage crm tasks"
    ON public.crm_tasks FOR ALL TO authenticated
    USING ((SELECT public.has_my_admin_capability(
        'operations.write'::public.admin_capability
    )))
    WITH CHECK ((SELECT public.has_my_admin_capability(
        'operations.write'::public.admin_capability
    )));

CREATE POLICY "Admin operations readers can view crm activities"
    ON public.crm_activities FOR SELECT TO authenticated
    USING ((SELECT public.has_my_admin_capability(
        'operations.read'::public.admin_capability
    )));
CREATE POLICY "Admin operations writers can manage crm activities"
    ON public.crm_activities FOR ALL TO authenticated
    USING ((SELECT public.has_my_admin_capability(
        'operations.write'::public.admin_capability
    )))
    WITH CHECK ((SELECT public.has_my_admin_capability(
        'operations.write'::public.admin_capability
    )));

CREATE POLICY "Admin operations readers can view crm consents"
    ON public.crm_consents FOR SELECT TO authenticated
    USING ((SELECT public.has_my_admin_capability(
        'operations.read'::public.admin_capability
    )));
CREATE POLICY "Admin operations writers can manage crm consents"
    ON public.crm_consents FOR ALL TO authenticated
    USING ((SELECT public.has_my_admin_capability(
        'operations.write'::public.admin_capability
    )))
    WITH CHECK ((SELECT public.has_my_admin_capability(
        'operations.write'::public.admin_capability
    )));

DROP POLICY IF EXISTS "Admins can manage packages" ON public.packages;
CREATE POLICY "Admin catalog readers can view packages"
    ON public.packages FOR SELECT TO authenticated
    USING ((SELECT public.has_my_admin_capability(
        'catalog.read'::public.admin_capability
    )));
CREATE POLICY "Admin catalog writers can manage packages"
    ON public.packages FOR ALL TO authenticated
    USING ((SELECT public.has_my_admin_capability(
        'catalog.write'::public.admin_capability
    )))
    WITH CHECK ((SELECT public.has_my_admin_capability(
        'catalog.write'::public.admin_capability
    )));

DROP POLICY IF EXISTS "Admins can manage payments" ON public.payments;
CREATE POLICY "Admin finance readers can view payments"
    ON public.payments FOR SELECT TO authenticated
    USING ((SELECT public.has_my_admin_capability(
        'finance.read'::public.admin_capability
    )));
CREATE POLICY "Admin finance writers can manage payments"
    ON public.payments FOR ALL TO authenticated
    USING ((SELECT public.has_my_admin_capability(
        'finance.write'::public.admin_capability
    )))
    WITH CHECK ((SELECT public.has_my_admin_capability(
        'finance.write'::public.admin_capability
    )));

DROP POLICY IF EXISTS "Admins can do everything on profiles" ON public.profiles;
DROP POLICY IF EXISTS "Admins can manage profiles_private" ON public.profiles_private;
DROP POLICY IF EXISTS "Admins can manage sessions" ON public.sessions;
DROP POLICY IF EXISTS "Admins can manage assignments" ON public.student_teachers;
DROP POLICY IF EXISTS "Admins can manage subscriptions" ON public.subscriptions;
DROP POLICY IF EXISTS "Admins can manage all availability" ON public.teacher_availability;

CREATE POLICY "Admin operations readers can view profiles"
    ON public.profiles FOR SELECT TO authenticated
    USING ((SELECT public.has_my_admin_capability(
        'operations.read'::public.admin_capability
    )));
CREATE POLICY "Admin operations writers can manage profiles"
    ON public.profiles FOR ALL TO authenticated
    USING ((SELECT public.has_my_admin_capability(
        'operations.write'::public.admin_capability
    )))
    WITH CHECK ((SELECT public.has_my_admin_capability(
        'operations.write'::public.admin_capability
    )));

CREATE POLICY "Admin operations readers can view profiles private"
    ON public.profiles_private FOR SELECT TO authenticated
    USING ((SELECT public.has_my_admin_capability(
        'operations.read'::public.admin_capability
    )));
CREATE POLICY "Admin operations writers can manage profiles private"
    ON public.profiles_private FOR ALL TO authenticated
    USING ((SELECT public.has_my_admin_capability(
        'operations.write'::public.admin_capability
    )))
    WITH CHECK ((SELECT public.has_my_admin_capability(
        'operations.write'::public.admin_capability
    )));

CREATE POLICY "Admin operations readers can view sessions"
    ON public.sessions FOR SELECT TO authenticated
    USING ((SELECT public.has_my_admin_capability(
        'operations.read'::public.admin_capability
    )));
CREATE POLICY "Admin operations writers can manage sessions"
    ON public.sessions FOR ALL TO authenticated
    USING ((SELECT public.has_my_admin_capability(
        'operations.write'::public.admin_capability
    )))
    WITH CHECK ((SELECT public.has_my_admin_capability(
        'operations.write'::public.admin_capability
    )));

CREATE POLICY "Admin operations readers can view assignments"
    ON public.student_teachers FOR SELECT TO authenticated
    USING ((SELECT public.has_my_admin_capability(
        'operations.read'::public.admin_capability
    )));
CREATE POLICY "Admin operations writers can manage assignments"
    ON public.student_teachers FOR ALL TO authenticated
    USING ((SELECT public.has_my_admin_capability(
        'operations.write'::public.admin_capability
    )))
    WITH CHECK ((SELECT public.has_my_admin_capability(
        'operations.write'::public.admin_capability
    )));

CREATE POLICY "Admin operations readers can view subscriptions"
    ON public.subscriptions FOR SELECT TO authenticated
    USING ((SELECT public.has_my_admin_capability(
        'operations.read'::public.admin_capability
    )));
CREATE POLICY "Admin operations writers can manage subscriptions"
    ON public.subscriptions FOR ALL TO authenticated
    USING ((SELECT public.has_my_admin_capability(
        'operations.write'::public.admin_capability
    )))
    WITH CHECK ((SELECT public.has_my_admin_capability(
        'operations.write'::public.admin_capability
    )));

CREATE POLICY "Admin operations readers can view availability"
    ON public.teacher_availability FOR SELECT TO authenticated
    USING ((SELECT public.has_my_admin_capability(
        'operations.read'::public.admin_capability
    )));
CREATE POLICY "Admin operations writers can manage availability"
    ON public.teacher_availability FOR ALL TO authenticated
    USING ((SELECT public.has_my_admin_capability(
        'operations.write'::public.admin_capability
    )))
    WITH CHECK ((SELECT public.has_my_admin_capability(
        'operations.write'::public.admin_capability
    )));

DROP POLICY IF EXISTS "Admins can view processed webhook events"
    ON public.processed_webhook_events;
CREATE POLICY "Admin operations readers can view processed webhook events"
    ON public.processed_webhook_events FOR SELECT TO authenticated
    USING ((SELECT public.has_my_admin_capability(
        'operations.read'::public.admin_capability
    )));

DROP POLICY IF EXISTS "Admins can manage fulfillment jobs"
    ON public.fulfillment_jobs;
DROP POLICY IF EXISTS "Admins can view fulfillment jobs"
    ON public.fulfillment_jobs;
CREATE POLICY "Admin operations readers can view fulfillment jobs"
    ON public.fulfillment_jobs FOR SELECT TO authenticated
    USING ((SELECT public.has_my_admin_capability(
        'operations.read'::public.admin_capability
    )));

DROP POLICY IF EXISTS "Admins can view audit log" ON public.admin_audit_log;
CREATE POLICY "Admin access readers can view audit log"
    ON public.admin_audit_log FOR SELECT TO authenticated
    USING ((SELECT public.has_my_admin_capability(
        'access.read'::public.admin_capability
    )));

DROP POLICY IF EXISTS "Admins can read support ticket history"
    ON public.support_ticket_events;
CREATE POLICY "Admin operations readers can read support ticket history"
    ON public.support_ticket_events FOR SELECT TO authenticated
    USING ((SELECT public.has_my_admin_capability(
        'operations.read'::public.admin_capability
    )));

CREATE OR REPLACE FUNCTION private.can_read_support_ticket_event(
    p_ticket_id UUID,
    p_visibility TEXT
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT (SELECT public.has_my_admin_capability(
        'operations.read'::public.admin_capability
    ))
        OR (
            p_visibility = 'public'
            AND EXISTS (
                SELECT 1 FROM public.support_tickets AS ticket
                WHERE ticket.id = p_ticket_id
                  AND ticket.user_id = (SELECT auth.uid())
            )
        );
$$;

-- Authenticated users, including administrators, cannot mutate academic roles,
-- login identities, or adult attestation through a direct profile update. Those
-- transitions remain server-only and therefore independently auditable.
CREATE OR REPLACE FUNCTION private.protect_profile_role()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_temp
AS $$
BEGIN
    IF auth.uid() IS NULL THEN
        RETURN NEW;
    END IF;

    IF NEW.adult_confirmed IS DISTINCT FROM OLD.adult_confirmed
        OR NEW.adult_confirmed_at IS DISTINCT FROM OLD.adult_confirmed_at
        OR NEW.age_policy_version IS DISTINCT FROM OLD.age_policy_version THEN
        RAISE EXCEPTION 'Cannot modify adult account attestation';
    END IF;

    IF NEW.role IS DISTINCT FROM OLD.role THEN
        RAISE EXCEPTION 'Cannot modify role';
    END IF;

    IF NEW.email IS DISTINCT FROM OLD.email THEN
        RAISE EXCEPTION 'Cannot modify profile email';
    END IF;

    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION private.guard_admin_audit_log_immutable()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
    -- Preserve the existing ON DELETE SET NULL contract for administrator
    -- profile erasure. Only the nested foreign-key action may pseudonymize the
    -- actor; every direct update and every content change remains forbidden.
    IF TG_OP = 'UPDATE'
       AND pg_catalog.pg_trigger_depth() > 1
       AND OLD.admin_id IS NOT NULL
       AND NEW.admin_id IS NULL
       AND (
           pg_catalog.to_jsonb(NEW) - 'admin_id'
       ) = (
           pg_catalog.to_jsonb(OLD) - 'admin_id'
       ) THEN
        RETURN NEW;
    END IF;

    RAISE EXCEPTION 'admin_audit_log_is_immutable'
        USING ERRCODE = '23514';
END
$$;

CREATE TRIGGER guard_admin_audit_log_immutable_trigger
    BEFORE UPDATE OR DELETE ON public.admin_audit_log
    FOR EACH ROW EXECUTE FUNCTION private.guard_admin_audit_log_immutable();

REVOKE ALL ON FUNCTION private.admin_role_has_capability(
    public.admin_access_role,
    public.admin_capability
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.admin_has_capability(
    UUID,
    public.admin_capability
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.guard_admin_audit_log_immutable()
    FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.has_my_admin_capability(
    public.admin_capability
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_my_admin_capability(
    public.admin_capability
) TO authenticated;

REVOKE ALL ON FUNCTION public.get_my_admin_capabilities()
    FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_my_admin_capabilities()
    TO authenticated;

REVOKE ALL ON FUNCTION public.admin_grant_access_role(
    UUID,
    UUID,
    public.admin_access_role
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_grant_access_role(
    UUID,
    UUID,
    public.admin_access_role
) TO service_role;

REVOKE ALL ON FUNCTION public.admin_revoke_access_role(
    UUID,
    UUID,
    public.admin_access_role
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_revoke_access_role(
    UUID,
    UUID,
    public.admin_access_role
) TO service_role;

COMMENT ON TABLE public.admin_role_assignments IS
    'Server-managed, cumulative operational roles for profiles whose academic role is admin.';
COMMENT ON FUNCTION public.has_my_admin_capability(public.admin_capability) IS
    'Returns only whether the authenticated user owns one requested administrative capability.';
COMMENT ON FUNCTION public.get_my_admin_capabilities() IS
    'Returns the effective administrative capabilities of only the authenticated user.';
COMMENT ON FUNCTION public.admin_grant_access_role(
    UUID,
    UUID,
    public.admin_access_role
) IS 'Idempotently grants one administrative role and records an immutable audit event.';
COMMENT ON FUNCTION public.admin_revoke_access_role(
    UUID,
    UUID,
    public.admin_access_role
) IS 'Idempotently revokes one administrative role, preserving at least one owner, and records an immutable audit event.';
