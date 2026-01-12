import type { APIRoute } from 'astro';
import { createSupabaseServerClient } from '../../../lib/supabase-server';
import { stripe } from '../../../lib/stripe';

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
        const { data: profile } = await supabase
            .from('profiles')
            .select('stripe_customer_id')
            .eq('id', user.id)
            .single();

        if (!profile?.stripe_customer_id) {
            return new Response(JSON.stringify({ error: 'No Stripe customer found' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        // Get origin for return URL
        const origin = context.request.headers.get('origin') || 'http://localhost:4321';

        // Create Stripe Customer Portal session
        const portalSession = await stripe.billingPortal.sessions.create({
            customer: profile.stripe_customer_id,
            return_url: `${origin}/es/campus/account`,
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
