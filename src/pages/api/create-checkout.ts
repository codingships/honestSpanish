import type { APIRoute } from 'astro';
import { stripe } from '../../lib/stripe';
import { getPrivateProfile, upsertPrivateProfile } from '../../lib/profiles-private';
import { createSupabaseServerClient } from '../../lib/supabase-server';
import { getSiteUrl } from '../../lib/site-url';
import { hasAcceptedCheckoutPolicies, LEGAL_POLICY_VERSION } from '../../lib/legal-policy';
import { isCheckoutEnabled } from '../../lib/checkout-enabled';

const supportedCheckoutLangs = new Set(['es', 'en', 'ru']);

function normalizeCheckoutLang(value: unknown): 'es' | 'en' | 'ru' {
    return typeof value === 'string' && supportedCheckoutLangs.has(value)
        ? value as 'es' | 'en' | 'ru'
        : 'es';
}

function isStripePriceId(value: unknown): value is string {
    return typeof value === 'string' && /^price_[A-Za-z0-9_]+$/.test(value);
}

type CheckoutRequest = {
    priceId?: unknown;
    lang?: unknown;
    adultConfirmed?: unknown;
    termsAccepted?: unknown;
    serviceStartRequested?: unknown;
    withdrawalLossAcknowledged?: unknown;
};

export const POST: APIRoute = async (context) => {
    try {
        if (!isCheckoutEnabled(context)) {
            return new Response(JSON.stringify({ error: 'Checkout is disabled' }), {
                status: 403,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        // Parse request body
        const body = await context.request.json() as CheckoutRequest;
        const { priceId } = body;
        const lang = normalizeCheckoutLang(body.lang);

        if (!hasAcceptedCheckoutPolicies(body)) {
            return new Response(JSON.stringify({ error: 'Adult confirmation and policy acceptance are required' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        if (!priceId) {
            return new Response(JSON.stringify({ error: 'priceId is required' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        if (!isStripePriceId(priceId)) {
            return new Response(JSON.stringify({ error: 'Invalid price ID' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        // Verify Supabase session
        const supabase = createSupabaseServerClient(context);
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
            return new Response(JSON.stringify({ error: 'Unauthorized' }), {
                status: 401,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        const { data: profile, error: profileError } = await supabase
            .from('profiles')
            .select('id')
            .eq('id', user.id)
            .single();

        if (profileError || !profile) {
            return new Response(JSON.stringify({ error: 'Profile not found' }), {
                status: 404,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        // Check for existing active subscription to prevent double-charging
        const { data: activeSub } = await supabase
            .from('subscriptions')
            .select('id')
            .eq('student_id', user.id)
            .eq('status', 'active')
            .maybeSingle();

        if (activeSub) {
            return new Response(JSON.stringify({ error: 'Ya tienes una suscripción activa' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        // Validate priceId belongs to an active package in our system
        const { data: activePackages, error: packagesError } = await supabase
            .from('packages')
            .select('id, stripe_price_1m, stripe_price_3m, stripe_price_6m')
            .eq('is_active', true);

        if (packagesError) {
            return new Response(JSON.stringify({ error: 'Internal server error' }), {
                status: 500,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        const validPackage = activePackages?.find((pkg) => (
            pkg.stripe_price_1m === priceId ||
            pkg.stripe_price_3m === priceId ||
            pkg.stripe_price_6m === priceId
        ));

        if (!validPackage) {
            return new Response(JSON.stringify({ error: 'Invalid price ID' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        const stripePrice = await stripe.prices.retrieve(priceId);
        if (!stripePrice.active || !stripePrice.recurring) {
            return new Response(JSON.stringify({ error: 'This price is not configured for subscriptions' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        const profilePrivate = await getPrivateProfile(user.id);
        let stripeCustomerId = profilePrivate?.stripe_customer_id;

        // Create Stripe customer if doesn't exist
        if (!stripeCustomerId) {
            const customer = await stripe.customers.create({
                email: user.email,
                metadata: {
                    supabase_user_id: user.id,
                },
            });

            stripeCustomerId = customer.id;

            // Persist in the server-only private profile store so billing state
            // never depends on broad client-visible profile access.
            try {
                await upsertPrivateProfile(user.id, { stripe_customer_id: stripeCustomerId });
            } catch (profileUpdateError) {
                console.error('Failed to persist stripe_customer_id:', profileUpdateError);
                return new Response(JSON.stringify({ error: 'Failed to prepare checkout' }), {
                    status: 500,
                    headers: { 'Content-Type': 'application/json' },
                });
            }
        }

        // Get site URL for redirects
        const siteUrl = getSiteUrl();
        const policyAcceptedAt = new Date().toISOString();
        const policyMetadata = {
            adultConfirmed: 'true',
            adultConfirmedAt: policyAcceptedAt,
            termsAccepted: 'true',
            termsAcceptedAt: policyAcceptedAt,
            serviceStartRequested: 'true',
            serviceStartRequestedAt: policyAcceptedAt,
            withdrawalLossAcknowledged: 'true',
            withdrawalLossAcknowledgedAt: policyAcceptedAt,
            legalPolicyVersion: LEGAL_POLICY_VERSION,
        };

        // Create Checkout Session (subscription mode for recurring billing)
        const session = await stripe.checkout.sessions.create({
            mode: 'subscription',
            payment_method_types: ['card'],
            customer: stripeCustomerId,
            line_items: [
                {
                    price: priceId,
                    quantity: 1,
                },
            ],
            success_url: `${siteUrl}/${lang}/campus?payment=success`,
            cancel_url: `${siteUrl}/${lang}/#pricing`,
            // Launch contract and renewal emails assume the reviewed package amount.
            // Promotions can be introduced later with matching contractual copy/tests.
            allow_promotion_codes: false,
            subscription_data: {
                metadata: {
                    userId: user.id,
                    priceId,
                    lang,
                    ...policyMetadata,
                },
            },
            metadata: {
                userId: user.id,
                priceId,
                lang,
                ...policyMetadata,
            },
        });

        return new Response(JSON.stringify({ url: session.url }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        });
    } catch (error) {
        console.error('Checkout error:', error);
        return new Response(JSON.stringify({ error: 'Internal server error' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }
};
