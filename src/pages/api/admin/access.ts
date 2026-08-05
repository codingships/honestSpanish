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

const mutationSchema = z.discriminatedUnion('action', [
    z.object({
        action: z.enum(['grant', 'revoke']),
        profileId: z.string().uuid(),
        accessRole: z.enum(ADMIN_ACCESS_ROLES),
    }),
    z.object({
        action: z.literal('promote'),
        requestId: z.string().uuid(),
        email: z.string().trim().toLowerCase().email().max(320),
        accessRole: z.enum(ADMIN_ACCESS_ROLES),
        reason: z.string().trim().min(5).max(1000),
    }),
]);

const jsonHeaders = {
    'Cache-Control': 'private, no-store',
    'Content-Type': 'application/json',
};

function jsonResponse(payload: unknown, status = 200): Response {
    return new Response(JSON.stringify(payload), {
        status,
        headers: jsonHeaders,
    });
}

function sameOriginRequest(request: Request): boolean {
    const origin = request.headers.get('Origin');
    if (!origin) return false;
    try {
        return new URL(origin).origin === new URL(request.url).origin;
    } catch {
        return false;
    }
}

function escapeIlikePattern(value: string): string {
    return value
        .replaceAll('\\', '\\\\')
        .replaceAll('%', '\\%')
        .replaceAll('_', '\\_');
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
    if (!sameOriginRequest(context.request)) {
        return jsonResponse({ error: 'Forbidden' }, 403);
    }

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

    if (payload.action === 'promote') {
        const { data: profiles, error: profilesError } = await supabaseAdmin
            .from('profiles')
            .select('id')
            .ilike('email', escapeIlikePattern(payload.email))
            .limit(2);
        if (profilesError) {
            return jsonResponse({ error: 'Could not resolve the invited account' }, 503);
        }
        if ((profiles?.length ?? 0) === 0) {
            return jsonResponse({ error: 'The invited account does not exist yet' }, 404);
        }
        if ((profiles?.length ?? 0) !== 1) {
            return jsonResponse({ error: 'The invited account is ambiguous' }, 409);
        }

        const { data, error } = await supabaseAdmin.rpc('promote_admin_profile', {
            p_request_id: payload.requestId,
            p_profile_id: profiles![0].id,
            p_access_role: payload.accessRole,
            p_admin_id: auth.user.id,
            p_reason: payload.reason,
        });
        if (error) {
            if (error.code === '42501') {
                return jsonResponse({ error: 'Forbidden' }, 403);
            }
            if (error.code === 'P0002') {
                return jsonResponse({ error: 'The invited account no longer exists' }, 404);
            }
            if (error.code === '40001') {
                return jsonResponse({ error: 'The promotion conflicts with recorded state' }, 409);
            }
            if (error.code === '22023' || error.code === '23514') {
                return jsonResponse({
                    error: 'The account must be verified, complete and free of student activity before promotion',
                }, 409);
            }
            return jsonResponse({ error: 'Could not promote the administrator account' }, 500);
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
                error: 'Account promoted but the updated roster could not be loaded',
                result: data,
            }, 503);
        }
    }

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
