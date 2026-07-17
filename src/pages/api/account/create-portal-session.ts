import type { APIRoute } from 'astro';
import { getPrivateProfile } from '../../../lib/profiles-private';
import { createSupabaseServerClient } from '../../../lib/supabase-server';
import { stripe } from '../../../lib/stripe';
import { assertStripeRuntimeAccount } from '../../../lib/stripe-runtime-guard';
import { getSiteUrl } from '../../../lib/site-url';
import { requireRuntimeEnv } from '../../../lib/runtime-env';
import { validatedStripeCustomerId } from '../../../lib/stripe-customer';

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

        const stripeAccount = await stripe.accounts.retrieve();
        const stripeRuntime = assertStripeRuntimeAccount(context, stripeAccount);

        // Get and validate the customer for this exact Stripe account/mode.
        const profile = await getPrivateProfile(user.id);
        const stripeCustomerId = user.email
            ? await validatedStripeCustomerId({
                profile,
                userId: user.id,
                confirmedEmail: user.email,
                runtime: stripeRuntime,
            })
            : null;
        if (!stripeCustomerId) {
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

        const portalConfigurationId = requireRuntimeEnv('STRIPE_PORTAL_CONFIGURATION_ID', context);
        const portalConfiguration = await stripe.billingPortal.configurations.retrieve(portalConfigurationId);
        if (
            !portalConfiguration.active
            || !portalConfiguration.features.payment_method_update.enabled
            || !portalConfiguration.features.invoice_history.enabled
            || !portalConfiguration.features.subscription_cancel.enabled
            || portalConfiguration.features.subscription_cancel.mode !== 'at_period_end'
            || portalConfiguration.features.subscription_update.enabled
        ) {
            throw new Error('Stripe Customer Portal configuration is not launch-safe');
        }

        // Create Stripe Customer Portal session
        const portalSession = await stripe.billingPortal.sessions.create({
            customer: stripeCustomerId,
            configuration: portalConfigurationId,
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
