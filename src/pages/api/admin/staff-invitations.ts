import type { APIRoute } from 'astro';
import { z } from 'zod';
import { requireAdminCapability } from '../../../lib/admin-access';
import { readRuntimeEnv } from '../../../lib/runtime-env';
import { createSupabaseAdminClient } from '../../../lib/supabase-admin';

export const config = {
    runtime: 'nodejs',
};

const invitationSchema = z.object({
    requestId: z.string().uuid(),
    target: z.enum(['teacher', 'admin']),
    email: z.string().trim().toLowerCase().email().max(320),
    fullName: z.string().trim().min(2).max(120),
    lang: z.enum(['es', 'en', 'ru']),
    reason: z.string().trim().min(5).max(1000),
});

const headers = {
    'Cache-Control': 'private, no-store',
    'Content-Type': 'application/json; charset=utf-8',
};

function json(payload: unknown, status = 200): Response {
    return new Response(JSON.stringify(payload), { status, headers });
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

async function invitationFingerprint(input: z.infer<typeof invitationSchema>): Promise<string> {
    const identity = [input.target, input.email, input.fullName, input.lang].join('\u0000');
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(identity));
    return Array.from(new Uint8Array(digest))
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('');
}

function redirectOrigin(request: Request): string | null {
    const configured = readRuntimeEnv('PUBLIC_SITE_URL') ?? new URL(request.url).origin;
    try {
        const url = new URL(configured);
        if (url.origin !== new URL(request.url).origin) return null;
        return url.origin;
    } catch {
        return null;
    }
}

export const POST: APIRoute = async (context) => {
    if (!sameOriginRequest(context.request)) {
        return json({ error: 'Forbidden' }, 403);
    }

    let body: unknown;
    try {
        body = await context.request.json();
    } catch {
        return json({ error: 'Invalid JSON body' }, 400);
    }

    const parsed = invitationSchema.safeParse(body);
    if (!parsed.success) {
        return json({ error: 'Invalid staff invitation payload' }, 400);
    }

    const input = parsed.data;
    const auth = await requireAdminCapability(
        context,
        input.target === 'admin' ? 'access.write' : 'operations.write',
    );
    if (auth.error || !auth.user) return auth.error;

    const origin = redirectOrigin(context.request);
    if (!origin) {
        return json({ error: 'Invitation redirect is not configured for this environment' }, 503);
    }

    const admin = createSupabaseAdminClient();
    const identityFingerprint = await invitationFingerprint(input);
    const requestSnapshot = {
        request_id: input.requestId,
        target: input.target,
        reason: input.reason,
        identity_fingerprint: identityFingerprint,
    };

    const { data: previousRequests, error: previousRequestError } = await admin
        .from('admin_audit_log')
        .select('id, admin_id, after')
        .eq('action', 'staff.invitation.requested')
        .eq('entity_type', 'staff_invitation')
        .eq('entity_id', input.requestId)
        .limit(2);
    if (previousRequestError) {
        return json({ error: 'Invitation audit is unavailable' }, 503);
    }

    const previousRequest = previousRequests?.[0];
    const previousSnapshot = previousRequest?.after
        && typeof previousRequest.after === 'object'
        && !Array.isArray(previousRequest.after)
        ? previousRequest.after
        : null;
    if (previousRequest) {
        if (
            previousRequests.length !== 1
            || previousRequest.admin_id !== auth.user.id
            || previousSnapshot?.target !== input.target
            || previousSnapshot?.reason !== input.reason
            || previousSnapshot?.identity_fingerprint !== identityFingerprint
        ) {
            return json({ error: 'Invitation request conflicts with recorded state' }, 409);
        }
    } else {
        const { error: requestAuditError } = await admin
            .from('admin_audit_log')
            .insert({
                admin_id: auth.user.id,
                action: 'staff.invitation.requested',
                entity_type: 'staff_invitation',
                entity_id: input.requestId,
                after: requestSnapshot,
            });
        if (requestAuditError) {
            if (requestAuditError.code === '23505') {
                return json({ error: 'Invitation request is already being processed' }, 409);
            }
            return json({ error: 'Invitation audit is unavailable' }, 503);
        }
    }

    const { data: matchingProfiles, error: profileError } = await admin
        .from('profiles')
        .select('id, email, full_name, role')
        .ilike('email', escapeIlikePattern(input.email))
        .limit(2);
    if (profileError || (matchingProfiles?.length ?? 0) > 1) {
        return json({ error: 'Account identity could not be resolved safely' }, 503);
    }

    const existingProfile = matchingProfiles?.[0];
    if (existingProfile) {
        const { data: authAccount, error: authAccountError } = await admin.auth.admin
            .getUserById(existingProfile.id);
        if (
            authAccountError
            || !authAccount.user?.email
            || authAccount.user.email.toLowerCase() !== input.email
        ) {
            return json({ error: 'Account identity could not be resolved safely' }, 503);
        }

        if (authAccount.user.email_confirmed_at) {
            await admin.from('admin_audit_log').insert({
                admin_id: auth.user.id,
                action: 'staff.invitation.existing_verified',
                entity_type: 'profile',
                entity_id: existingProfile.id,
                after: requestSnapshot,
            });
            return json({
                state: 'existing_verified',
                profileId: existingProfile.id,
                profileRole: existingProfile.role,
            });
        }

        await admin.from('admin_audit_log').insert({
            admin_id: auth.user.id,
            action: 'staff.invitation.existing_pending',
            entity_type: 'profile',
            entity_id: existingProfile.id,
            after: requestSnapshot,
        });
        return json({
            state: 'existing_pending',
            profileId: existingProfile.id,
            profileRole: existingProfile.role,
        });
    }

    const { data: invitation, error: invitationError } = await admin.auth.admin
        .inviteUserByEmail(input.email, {
            data: { full_name: input.fullName },
            redirectTo: `${origin}/${input.lang}/login`,
        });

    if (invitationError || !invitation.user?.id) {
        await admin.from('admin_audit_log').insert({
            admin_id: auth.user.id,
            action: 'staff.invitation.failed',
            entity_type: 'staff_invitation',
            entity_id: input.requestId,
            after: {
                ...requestSnapshot,
                failure_code: invitationError?.code ?? 'provider_result_invalid',
            },
        });
        return json({
            error: 'The invitation provider rejected the request',
        }, 502);
    }

    const { error: sentAuditError } = await admin
        .from('admin_audit_log')
        .insert({
            admin_id: auth.user.id,
            action: 'staff.invitation.sent',
            entity_type: 'profile',
            entity_id: invitation.user.id,
            after: requestSnapshot,
        });

    if (sentAuditError) {
        console.error('[StaffInvitation] Provider accepted invitation but completion audit failed', {
            requestId: input.requestId,
            code: sentAuditError.code ?? 'unknown',
        });
    }

    return json({
        state: 'sent',
        profileId: invitation.user.id,
        auditDegraded: Boolean(sentAuditError),
    }, 202);
};
