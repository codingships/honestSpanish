import type { APIRoute } from 'astro';
import { stripe } from '../../lib/stripe';
import { createClient } from '@supabase/supabase-js';

// Use service role key for webhook (bypasses RLS)
const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL;
const supabaseServiceKey = import.meta.env.SUPABASE_SERVICE_ROLE_KEY;

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

export const POST: APIRoute = async ({ request }) => {
    const webhookSecret = import.meta.env.STRIPE_WEBHOOK_SECRET;

    if (!webhookSecret) {
        console.error('Missing STRIPE_WEBHOOK_SECRET');
        return new Response('Webhook secret not configured', { status: 500 });
    }

    // Get raw body as text (NOT JSON parsed)
    const payload = await request.text();
    const signature = request.headers.get('stripe-signature');

    if (!signature) {
        return new Response('Missing stripe-signature header', { status: 400 });
    }

    let event;

    try {
        event = stripe.webhooks.constructEvent(payload, signature, webhookSecret);
    } catch (err: any) {
        console.error('Webhook signature verification failed:', err.message);
        return new Response(`Webhook Error: ${err.message}`, { status: 400 });
    }

    // Handle the event
    if (event.type === 'checkout.session.completed') {
        const session = event.data.object;

        try {
            await handleCheckoutCompleted(session);
        } catch (error) {
            console.error('Error processing checkout:', error);
            // Still return 200 to acknowledge receipt
        }
    }

    return new Response(JSON.stringify({ received: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
    });
};

async function handleCheckoutCompleted(session: any) {
    const { userId, priceId, lang } = session.metadata || {};

    if (!userId || !priceId) {
        console.error('Missing metadata in checkout session');
        return;
    }

    // Find the package that matches the priceId
    const { data: pkg, error: pkgError } = await supabaseAdmin
        .from('packages')
        .select('*')
        .or(`stripe_price_1m.eq.${priceId},stripe_price_3m.eq.${priceId},stripe_price_6m.eq.${priceId}`)
        .single();

    if (pkgError || !pkg) {
        console.error('Package not found for priceId:', priceId);
        return;
    }

    // Determine duration based on which price column matched
    let durationMonths = 1;
    if (pkg.stripe_price_3m === priceId) {
        durationMonths = 3;
    } else if (pkg.stripe_price_6m === priceId) {
        durationMonths = 6;
    }

    // Calculate dates
    const startsAt = new Date();
    const endsAt = new Date();
    endsAt.setMonth(endsAt.getMonth() + durationMonths);

    const sessionsTotal = pkg.sessions_per_month * durationMonths;

    // Create subscription
    const { data: subscription, error: subError } = await supabaseAdmin
        .from('subscriptions')
        .insert({
            student_id: userId,
            package_id: pkg.id,
            status: 'active',
            duration_months: durationMonths,
            starts_at: startsAt.toISOString().split('T')[0],
            ends_at: endsAt.toISOString().split('T')[0],
            sessions_total: sessionsTotal,
            sessions_used: 0,
            stripe_invoice_id: session.invoice,
        })
        .select()
        .single();

    if (subError) {
        console.error('Error creating subscription:', subError);
        return;
    }

    // Create payment record
    const { error: paymentError } = await supabaseAdmin
        .from('payments')
        .insert({
            student_id: userId,
            subscription_id: subscription.id,
            amount: session.amount_total,
            currency: session.currency,
            status: 'succeeded',
            stripe_payment_intent_id: session.payment_intent,
            description: `${pkg.name} - ${durationMonths} month(s)`,
        });

    if (paymentError) {
        console.error('Error creating payment:', paymentError);
    }

    console.log(`Successfully processed payment for user ${userId}, subscription ${subscription.id}`);
}
