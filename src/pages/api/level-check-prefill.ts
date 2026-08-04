import type { APIRoute } from 'astro';
import { verifyLeadEmailToken } from '../../lib/lead-email-token';
import { createSupabaseAdminClient } from '../../lib/supabase-admin';

const LEAD_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function response(payload: unknown, status: number): Response {
    return new Response(JSON.stringify(payload), {
        status,
        headers: {
            'Cache-Control': 'private, no-store',
            'Content-Type': 'application/json',
            'Referrer-Policy': 'no-referrer',
        },
    });
}

function inviteValue(value: unknown, maxLength: number): string | null {
    if (typeof value !== 'string') return null;
    const normalized = value.trim();
    return normalized && normalized.length <= maxLength ? normalized : null;
}

export const POST: APIRoute = async ({ request }) => {
    let payload: Record<string, unknown>;
    try {
        payload = await request.json() as Record<string, unknown>;
    } catch {
        return response({ error: 'Invalid diagnostic link' }, 404);
    }

    const leadId = inviteValue(payload.leadId, 80);
    const token = inviteValue(payload.token, 180);
    if (!leadId || !LEAD_ID_PATTERN.test(leadId) || !token) {
        return response({ error: 'Invalid diagnostic link' }, 404);
    }

    const { data: lead, error } = await createSupabaseAdminClient()
        .from('leads')
        .select('id, email')
        .eq('id', leadId)
        .maybeSingle();

    if (error) {
        console.error('[LevelCheckPrefill] Could not load diagnostic invite');
        return response({ error: 'Diagnostic link unavailable' }, 503);
    }

    const email = lead?.email?.trim().toLowerCase() ?? '';
    const valid = email
        ? await verifyLeadEmailToken({ leadId, email, token })
        : false;
    if (!valid || lead?.id !== leadId) {
        return response({ error: 'Invalid diagnostic link' }, 404);
    }

    return response({ email }, 200);
};
