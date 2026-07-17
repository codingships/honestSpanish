import type { APIRoute } from 'astro';
import { hasAcceptedAdultPolicy, LEGAL_POLICY_VERSION } from '../../../lib/legal-policy';
import { createSupabaseAdminClient } from '../../../lib/supabase-admin';
import { createSupabaseServerClient } from '../../../lib/supabase-server';

function json(body: Record<string, unknown>, status: number) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

function sameOriginRequest(request: Request): boolean {
    const origin = request.headers.get('Origin');
    if (!origin) return true;

    try {
        return new URL(origin).origin === new URL(request.url).origin;
    } catch {
        return false;
    }
}

export const POST: APIRoute = async (context) => {
    if (!sameOriginRequest(context.request)) {
        return json({ error: 'Forbidden' }, 403);
    }

    let body: { adultConfirmed?: unknown };
    try {
        body = await context.request.json() as { adultConfirmed?: unknown };
    } catch {
        return json({ error: 'Invalid JSON body' }, 400);
    }

    if (!hasAcceptedAdultPolicy(body.adultConfirmed)) {
        return json({ error: 'You must explicitly confirm that you are at least 18.' }, 400);
    }

    const supabase = createSupabaseServerClient(context);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return json({ error: 'Unauthorized' }, 401);

    const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('id, role')
        .eq('id', user.id)
        .single();

    if (profileError || !profile) return json({ error: 'Profile not found' }, 404);
    if (profile.role !== 'student') return json({ error: 'Adult confirmation is only required for student accounts.' }, 409);

    const adultConfirmedAt = new Date().toISOString();
    const supabaseAdmin = createSupabaseAdminClient();
    const { data: updatedProfile, error: updateError } = await supabaseAdmin
        .from('profiles')
        .update({
            adult_confirmed: true,
            adult_confirmed_at: adultConfirmedAt,
            age_policy_version: LEGAL_POLICY_VERSION,
        })
        .eq('id', user.id)
        .eq('role', 'student')
        .select('id, adult_confirmed, adult_confirmed_at, age_policy_version')
        .maybeSingle();

    if (updateError || !updatedProfile) {
        console.error('[ConfirmAdult] Could not persist adult account attestation:', updateError);
        return json({ error: 'Could not save adult confirmation' }, 500);
    }

    return json({
        success: true,
        adultConfirmedAt: updatedProfile.adult_confirmed_at,
        agePolicyVersion: updatedProfile.age_policy_version,
    }, 200);
};
