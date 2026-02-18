import type { APIRoute } from 'astro';
import { stripe } from '../../lib/stripe';
import { createSupabaseServerClient } from '../../lib/supabase-server';

export const POST: APIRoute = async (context) => {
    try {
        // Parse request body
        const body = await context.request.json();
        const { priceId, lang = 'es' } = body;

        if (!priceId) {
            return new Response(JSON.stringify({ error: 'priceId is required' }), {
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

        // Get user profile
        const { data: profile, error: profileError } = await supabase
            .from('profiles')
            .select('id, email, stripe_customer_id')
            .eq('id', user.id)
            .single();

        if (profileError || !profile) {
            return new Response(JSON.stringify({ error: 'Profile not found' }), {
                status: 404,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        let stripeCustomerId = profile.stripe_customer_id;

        // Create Stripe customer if doesn't exist
        if (!stripeCustomerId) {
            const customer = await stripe.customers.create({
                email: profile.email || user.email,
                metadata: {
                    supabase_user_id: user.id,
                },
            });

            stripeCustomerId = customer.id;

            // Save stripe_customer_id to profile
            await supabase
                .from('profiles')
                .update({ stripe_customer_id: stripeCustomerId })
                .eq('id', user.id);
        }

        // Get site URL for redirects
        const siteUrl = import.meta.env.SITE || 'http://localhost:4321';

        // Create Checkout Session (subscription mode for recurring billing)
        const session = await stripe.checkout.sessions.create({
            mode: 'subscription',
            customer: stripeCustomerId,
            line_items: [
                {
                    price: priceId,
                    quantity: 1,
                },
            ],
            success_url: `${siteUrl}/${lang}/campus?payment=success`,
            cancel_url: `${siteUrl}/${lang}/#pricing`,
            allow_promotion_codes: true,
            subscription_data: {
                metadata: {
                    userId: profile.id,
                    priceId,
                    lang,
                },
            },
            metadata: {
                userId: profile.id,
                priceId,
                lang,
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
