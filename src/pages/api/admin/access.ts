import type { APIRoute } from 'astro';
import { z } from 'zod';
import {
    ADMIN_ACCESS_ROLES,
    requireAdminCapability,
    type AdminAccessRole,
} from '../../../lib/admin-access';
import { createSupabaseAdminClient } from '../../../lib/supabase-admin';

export const config = {
    runtime: 'nodejs',
};

const mutationSchema = z.object({
    action: z.enum(['grant', 'revoke']),
    profileId: z.string().uuid(),
    accessRole: z.enum(ADMIN_ACCESS_ROLES),
});

const jsonHeaders = { 'Content-Type': 'application/json' };

function jsonResponse(payload: unknown, status = 200): Response {
    return new Response(JSON.stringify(payload), {
        status,
        headers: jsonHeaders,
    });
}

function sortedRoles(roles: AdminAccessRole[]): AdminAccessRole[] {
    return [...roles].sort(
        (left, right) => ADMIN_ACCESS_ROLES.indexOf(left) - ADMIN_ACCESS_ROLES.indexOf(right),
    );
}

async function loadAccessRoster(
    supabaseAdmin: ReturnType<typeof createSupabaseAdminClient>,
) {
    const [{ data: profiles, error: profilesError }, { data: assignments, error: assignmentsError }] = await Promise.all([
        supabaseAdmin
            .from('profiles')
            .select('id, email, full_name')
            .eq('role', 'admin')
            .order('created_at', { ascending: true })
            .limit(200),
        supabaseAdmin
            .from('admin_role_assignments')
            .select('profile_id, access_role, granted_at, granted_by')
            .order('profile_id', { ascending: true })
            .order('access_role', { ascending: true }),
    ]);

    if (profilesError || assignmentsError) {
        throw new Error('admin_access_roster_unavailable');
    }

    const rolesByProfile = new Map<string, AdminAccessRole[]>();
    for (const assignment of assignments ?? []) {
        const roles = rolesByProfile.get(assignment.profile_id) ?? [];
        roles.push(assignment.access_role);
        rolesByProfile.set(assignment.profile_id, roles);
    }

    return (profiles ?? []).map((profile) => ({
        id: profile.id,
        email: profile.email,
        fullName: profile.full_name,
        roles: sortedRoles(rolesByProfile.get(profile.id) ?? []),
    }));
}

export const GET: APIRoute = async (context) => {
    const auth = await requireAdminCapability(context, 'access.read');
    if (auth.error || !auth.user) return auth.error;

    try {
        const admins = await loadAccessRoster(createSupabaseAdminClient());
        const currentAdmin = admins.find((admin) => admin.id === auth.user.id);
        return jsonResponse({
            admins,
            canWrite: currentAdmin?.roles.includes('owner') ?? false,
        });
    } catch {
        return jsonResponse({ error: 'Could not load administrator access' }, 500);
    }
};

export const POST: APIRoute = async (context) => {
    const auth = await requireAdminCapability(context, 'access.write');
    if (auth.error || !auth.user) return auth.error;

    let rawBody: unknown;
    try {
        rawBody = await context.request.json();
    } catch {
        return jsonResponse({ error: 'Invalid JSON body' }, 400);
    }

    const parsed = mutationSchema.safeParse(rawBody);
    if (!parsed.success) {
        return jsonResponse({ error: 'Invalid administrator access payload' }, 400);
    }

    const payload = parsed.data;
    const supabaseAdmin = createSupabaseAdminClient();
    const rpcName = payload.action === 'grant'
        ? 'admin_grant_access_role'
        : 'admin_revoke_access_role';
    const { data, error } = await supabaseAdmin.rpc(rpcName, {
        p_actor_id: auth.user.id,
        p_profile_id: payload.profileId,
        p_access_role: payload.accessRole,
    });

    if (error) {
        if (error.code === '42501') {
            return jsonResponse({ error: 'Forbidden' }, 403);
        }
        if (error.code === '23514') {
            const message = error.message.includes('admin_access_last_owner')
                ? 'At least one owner must remain'
                : 'The target profile is not an administrator';
            return jsonResponse({ error: message }, 409);
        }
        return jsonResponse({ error: 'Could not change administrator access' }, 500);
    }

    try {
        const admins = await loadAccessRoster(supabaseAdmin);
        const currentAdmin = admins.find((admin) => admin.id === auth.user.id);
        return jsonResponse({
            admins,
            canWrite: currentAdmin?.roles.includes('owner') ?? false,
            result: data,
        });
    } catch {
        return jsonResponse({
            error: 'Access changed but the updated roster could not be loaded',
            result: data,
        }, 503);
    }
};
