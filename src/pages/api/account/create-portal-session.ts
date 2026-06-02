import type { APIRoute } from 'astro';
import { getPrivateProfile } from '../../../lib/profiles-private';
import { createSupabaseServerClient } from '../../../lib/supabase-server';
import { stripe } from '../../../lib/stripe';
import { getSiteUrl } from '../../../lib/site-url';

export const POST: APIRoute = async (context) => {
    try {
        // Get Supabase client and verify user
        const supabase = createSupabaseServerClient(context);
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
            return new Response(JSON.stringify({ error: 'Unauthorized' }), {
                status: 401,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        // Get user's stripe_customer_id
        const profile = await getPrivateProfile(user.id);

        if (!profile?.stripe_customer_id) {
            return new Response(JSON.stringify({ error: 'No Stripe customer found' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        // Use configured site URL, never trust the Origin header (open redirect risk)
        const siteOrigin = getSiteUrl();
        const referer = context.request.headers.get('referer') || '';
        const langMatch = referer.match(/\/(es|en|ru)\//);
        const lang = langMatch?.[1] || 'es';

        // Create Stripe Customer Portal session
        const portalSession = await stripe.billingPortal.sessions.create({
            customer: profile.stripe_customer_id,
            return_url: `${siteOrigin}/${lang}/campus/account`,
        });

        return new Response(JSON.stringify({ url: portalSession.url }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        });
    } catch (error) {
        console.error('Create portal session error:', error);
        return new Response(JSON.stringify({ error: 'Internal server error' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }
};
