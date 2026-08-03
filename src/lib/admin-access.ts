import type { User } from '@supabase/supabase-js';
import type { APIContext } from 'astro';
import { createSupabaseServerClient } from './supabase-server';
import type { AdminCapability } from './admin-access-contract';

export {
    ADMIN_ACCESS_ROLES,
    type AdminAccessRole,
    type AdminCapability,
} from './admin-access-contract';

type AdminAuthorization =
    | { error: null; user: User }
    | { error: Response; user: null };

const jsonHeaders = { 'Content-Type': 'application/json' };

function authorizationError(message: string, status: number): Response {
    return new Response(JSON.stringify({ error: message }), {
        status,
        headers: jsonHeaders,
    });
}

/**
 * Fail-closed authorization for administrative server routes.
 *
 * Identity remains in Supabase Auth and profiles.role. Operational access is
 * resolved by PostgreSQL from server-managed role assignments; it is never
 * trusted from user metadata, cookies or a browser-provided role.
 */
export async function requireAdminCapability(
    context: APIContext,
    capability: AdminCapability,
): Promise<AdminAuthorization> {
    const supabase = createSupabaseServerClient(context);
    const { data: { user }, error: userError } = await supabase.auth.getUser();

    if (userError || !user) {
        return {
            error: authorizationError('Unauthorized', 401),
            user: null,
        };
    }

    const { data: allowed, error: capabilityError } = await supabase.rpc(
        'has_my_admin_capability',
        { p_capability: capability },
    );

    if (capabilityError) {
        console.error('[AdminAccess] Capability check unavailable', {
            code: capabilityError.code ?? 'unknown',
        });
        return {
            error: authorizationError('Authorization unavailable', 503),
            user: null,
        };
    }

    if (allowed !== true) {
        return {
            error: authorizationError('Forbidden', 403),
            user: null,
        };
    }

    return { error: null, user };
}

/**
 * Shared teacher/student routes call this from middleware. Non-admin users are
 * left to the route's existing ownership checks; an admin actor must also own
 * the requested operational capability.
 */
export async function requireCapabilityForAdminActor(
    context: APIContext,
    capability: AdminCapability,
): Promise<Response | null> {
    const supabase = createSupabaseServerClient(context);
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (!user) {
        return userError
            ? authorizationError('Authorization unavailable', 503)
            : null;
    }

    const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .maybeSingle();

    if (profileError) {
        console.error('[AdminAccess] Actor role check unavailable', {
            code: profileError.code ?? 'unknown',
        });
        return authorizationError('Authorization unavailable', 503);
    }
    if (profile?.role !== 'admin') return null;

    const { data: allowed, error: capabilityError } = await supabase.rpc(
        'has_my_admin_capability',
        { p_capability: capability },
    );
    if (capabilityError) {
        console.error('[AdminAccess] Actor capability check unavailable', {
            code: capabilityError.code ?? 'unknown',
        });
        return authorizationError('Authorization unavailable', 503);
    }

    return allowed === true ? null : authorizationError('Forbidden', 403);
}
