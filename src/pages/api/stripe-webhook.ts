import type { APIContext, APIRoute } from 'astro';
import { stripe } from '../../lib/stripe';
import { recordCrmActivityForProfileSafe } from '../../lib/crm/activity-sync';
import { createSupabaseAdminClient } from '../../lib/supabase-admin';
import { enqueueWelcomeFulfillment } from '../../lib/fulfillment/queue';
import { triggerFulfillmentProcessing } from '../../lib/internal-job-service';
import { readRuntimeEnv } from '../../lib/runtime-env';
import type Stripe from 'stripe';
import type { Database } from '../../types/database.types';
import type { SupabaseClient } from '@supabase/supabase-js';

function isStripePriceId(value: unknown): value is string {
    return typeof value === 'string' && /^price_[A-Za-z0-9_]+$/.test(value);
}

export const POST: APIRoute = async (context) => {
    const { request } = context;
    // Lazy init inside handler to avoid module-level env var issues on Cloudflare Workers cold start.
    const supabaseAdmin = createSupabaseAdminClient();
    const webhookSecret = readRuntimeEnv('STRIPE_WEBHOOK_SECRET');

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

    let event: Stripe.Event;

    try {
        event = stripe.webhooks.constructEvent(payload, signature, webhookSecret);
    } catch (err) {
        // Manejo de error tipado
        const errorMessage = err instanceof Error ? err.message : 'Unknown Error';
        console.error('Webhook signature verification failed:', errorMessage);
        return new Response(`Webhook Error: ${errorMessage}`, { status: 400 });
    }

    // Idempotency check: ignore duplicate Stripe retries
    const { error: idempotencyError } = await supabaseAdmin
        .from('processed_webhook_events')
        .insert({ stripe_event_id: event.id, event_type: event.type });

    if (idempotencyError) {
        if (idempotencyError.code === '23505') {
            // Primary key violation = event already processed
            console.log(`[Webhook] Duplicate event ${event.id} ignored`);
            return new Response(JSON.stringify({ received: true }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            });
        }
        // Any other DB error: log but continue; better to risk a duplicate than miss a payment.
        console.error('[Webhook] Error recording event ID:', idempotencyError);
    }

    // Handle the event
    try {
        switch (event.type) {
            case 'checkout.session.completed': {
                // First-time subscription checkout
                const session = event.data.object as Stripe.Checkout.Session;
                await handleCheckoutCompleted(supabaseAdmin, session, context);
                break;
            }

            case 'invoice.paid': {
                // Recurring monthly payment succeeded
                const invoice = event.data.object as Stripe.Invoice;
                await handleInvoicePaid(supabaseAdmin, invoice);
                break;
            }

            case 'invoice.payment_failed': {
                const invoice = event.data.object as Stripe.Invoice;
                await handleInvoicePaymentFailed(supabaseAdmin, invoice);
                break;
            }

            case 'customer.subscription.deleted': {
                // Subscription cancelled (expired or cancelled by admin/customer)
                const subscription = event.data.object as Stripe.Subscription;
                await handleSubscriptionDeleted(supabaseAdmin, subscription);
                break;
            }

            case 'customer.subscription.updated': {
                // Subscription updated (e.g. payment failed, trial ended)
                const subscription = event.data.object as Stripe.Subscription;
                await handleSubscriptionUpdated(supabaseAdmin, subscription);
                break;
            }

            default:
                console.log(`[Webhook] Unhandled event type: ${event.type}`);
        }
    } catch (error) {
        console.error(`[Webhook] Error processing ${event.type}:`, error);
        // Still return 200 to acknowledge receipt
    }

    return new Response(JSON.stringify({ received: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
    });
};

// ============================================
// HANDLER: First-time checkout completed
// ============================================
async function handleCheckoutCompleted(
    supabaseAdmin: SupabaseClient<Database>,
    session: Stripe.Checkout.Session,
    context: APIContext
) {
    // For subscription mode, metadata is on the subscription, not the session
    const stripeSubscription = session.subscription
        ? await stripe.subscriptions.retrieve(session.subscription as string)
        : null;
    const userId = session.metadata?.userId || stripeSubscription?.metadata?.userId;
    const priceId = session.metadata?.priceId || stripeSubscription?.metadata?.priceId;

    if (!userId || !priceId) {
        console.error('[Webhook] Missing metadata in checkout session');
        return;
    }

    if (!isStripePriceId(priceId)) {
        console.error('[Webhook] Invalid Stripe price ID in checkout session metadata');
        return;
    }

    // Find the package that matches the priceId
    const { data: packages, error: pkgError } = await supabaseAdmin
        .from('packages')
        .select('*');

    const pkg = packages?.find((candidate) => (
        candidate.stripe_price_1m === priceId ||
        candidate.stripe_price_3m === priceId ||
        candidate.stripe_price_6m === priceId
    ));

    if (pkgError || !pkg) {
        console.error('[Webhook] Package not found for priceId:', priceId);
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

    // Create subscription record
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
            stripe_subscription_id: session.subscription as string | null,
            stripe_invoice_id: session.invoice as string | null,
        })
        .select()
        .single();

    if (subError) {
        console.error('[Webhook] Error creating subscription:', subError);
        return;
    }

    const paymentDescription = `${pkg.name} - ${durationMonths} month(s) - Initial`;

    // Create payment record
    const { data: payment, error: paymentError } = await supabaseAdmin
        .from('payments')
        .insert({
            student_id: userId,
            subscription_id: subscription.id,
            amount: session.amount_total ?? 0,
            currency: session.currency ?? 'eur',
            status: 'succeeded',
            stripe_invoice_id: session.invoice as string | null,
            stripe_payment_intent_id: session.payment_intent as string | null,
            description: paymentDescription,
        })
        .select('id')
        .single();

    if (paymentError) {
        console.error('[Webhook] Error creating payment:', paymentError);
    } else if (payment) {
        await recordCrmActivityForProfileSafe(supabaseAdmin, {
            profileId: userId,
            lifecycleStage: 'customer',
            source: 'stripe',
            activityType: 'payment',
            subject: 'Pago inicial recibido',
            body: paymentDescription,
            relatedEntityType: 'payment',
            relatedEntityId: payment.id,
            metadata: {
                status: 'succeeded',
                amount: session.amount_total ?? 0,
                currency: session.currency ?? 'eur',
                subscription_id: subscription.id,
                stripe_invoice_id: session.invoice as string | null,
                stripe_payment_intent_id: session.payment_intent as string | null,
            },
        });
    }

    // Save Stripe subscription ID in our subscription record for future reference
    if (session.subscription) {
        await supabaseAdmin
            .from('subscriptions')
            .update({ stripe_subscription_id: session.subscription as string })
            .eq('id', subscription.id);
    }

    console.log(`[Webhook] Successfully processed initial payment for user ${userId}, subscription ${subscription.id}`);

    const fulfillmentQueued = await enqueueWelcomeFulfillment(supabaseAdmin, {
        userId,
        packageId: pkg.id,
        subscriptionId: subscription.id,
    });

    if (!fulfillmentQueued) {
        console.error('[Webhook] Welcome fulfillment could not be queued');
        return;
    }

    triggerFulfillmentProcessing(context, 5);
}

// ============================================
// HANDLER: Recurring invoice paid (monthly renewal)
// ============================================
async function handleInvoicePaid(supabaseAdmin: SupabaseClient<Database>, invoice: Stripe.Invoice) {
    // Skip the first invoice (already handled by checkout.session.completed)
    if (invoice.billing_reason === 'subscription_create') {
        console.log('[Webhook] Skipping initial invoice (handled by checkout.session.completed)');
        return;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stripeSubscriptionId = (invoice as any).subscription as string;
    if (!stripeSubscriptionId) {
        console.log('[Webhook] Invoice without subscription, skipping');
        return;
    }

    // Get subscription metadata to find our user
    const stripeSubscription = await stripe.subscriptions.retrieve(stripeSubscriptionId);
    const userId = stripeSubscription.metadata?.userId;

    if (!userId) {
        console.error('[Webhook] No userId in subscription metadata for:', stripeSubscriptionId);
        return;
    }

    const subscription = await findManagedSubscription(supabaseAdmin, {
        stripeSubscriptionId,
        userId,
    });

    if (!subscription) {
        console.error('[Webhook] No managed subscription found for paid invoice:', stripeSubscriptionId, userId);
        return;
    }

    // Get the package to know sessions_per_month
    const { data: pkg } = await supabaseAdmin
        .from('packages')
        .select('sessions_per_month')
        .eq('id', subscription.package_id)
        .single();

    const renewalMonths =
        stripeSubscription.items.data[0]?.price.recurring?.interval === 'month'
            ? stripeSubscription.items.data[0]?.price.recurring?.interval_count ?? 1
            : subscription.duration_months ?? 1;

    // Extend from the later of "today" or the current subscription end date.
    const now = new Date();
    const currentEndsAt = subscription.ends_at ? new Date(`${subscription.ends_at}T00:00:00.000Z`) : now;
    const extensionBase = currentEndsAt > now ? currentEndsAt : now;
    const newEndsAt = new Date(extensionBase);
    newEndsAt.setMonth(newEndsAt.getMonth() + renewalMonths);

    const additionalSessions = (pkg?.sessions_per_month ?? 0) * renewalMonths;

    const { error: updateError } = await supabaseAdmin
        .from('subscriptions')
        .update({
            ends_at: newEndsAt.toISOString().split('T')[0],
            sessions_total: additionalSessions, // Fresh quota for this billing period
            sessions_used: 0,
            status: 'active',
            stripe_subscription_id: stripeSubscriptionId,
        })
        .eq('id', subscription.id);

    if (updateError) {
        console.error('[Webhook] Error extending subscription:', updateError);
    }

    const paymentDescription = `${renewalMonths}-month renewal`;

    // Record the payment
    const { data: payment, error: paymentError } = await supabaseAdmin
        .from('payments')
        .insert({
            student_id: userId,
            subscription_id: subscription.id,
            amount: invoice.amount_paid ?? 0,
            currency: invoice.currency ?? 'eur',
            status: 'succeeded',
            stripe_invoice_id: invoice.id,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            stripe_payment_intent_id: (invoice as any).payment_intent as string | null,
            description: paymentDescription,
        })
        .select('id')
        .single();

    if (paymentError) {
        console.error('[Webhook] Error creating renewal payment:', paymentError);
    } else if (payment) {
        await recordCrmActivityForProfileSafe(supabaseAdmin, {
            profileId: userId,
            lifecycleStage: 'customer',
            source: 'stripe',
            activityType: 'payment',
            subject: 'Renovacion pagada',
            body: paymentDescription,
            relatedEntityType: 'payment',
            relatedEntityId: payment.id,
            metadata: {
                status: 'succeeded',
                amount: invoice.amount_paid ?? 0,
                currency: invoice.currency ?? 'eur',
                subscription_id: subscription.id,
                stripe_invoice_id: invoice.id,
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                stripe_payment_intent_id: (invoice as any).payment_intent as string | null,
                renewal_months: renewalMonths,
                additional_sessions: additionalSessions,
            },
        });
    }

    console.log(`[Webhook] Renewal processed for user ${userId}: +${additionalSessions} sessions for ${renewalMonths} month(s), extended to ${newEndsAt.toISOString().split('T')[0]}`);
}

// ============================================
// HANDLER: Invoice payment failed
// ============================================
async function handleInvoicePaymentFailed(supabaseAdmin: SupabaseClient<Database>, invoice: Stripe.Invoice) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stripeSubscriptionId = (invoice as any).subscription as string | null;
    if (!stripeSubscriptionId) {
        console.log('[Webhook] Failed invoice without subscription, skipping');
        return;
    }

    const stripeSubscription = await stripe.subscriptions.retrieve(stripeSubscriptionId);
    const userId = stripeSubscription.metadata?.userId;

    if (!userId) {
        console.error('[Webhook] No userId in failed invoice subscription metadata for:', stripeSubscriptionId);
        return;
    }

    const subscription = await findManagedSubscription(supabaseAdmin, {
        stripeSubscriptionId,
        userId,
    });

    if (!subscription) {
        console.error('[Webhook] No managed subscription found for failed invoice:', stripeSubscriptionId, userId);
        return;
    }

    const failureMonths =
        stripeSubscription.items.data[0]?.price.recurring?.interval === 'month'
            ? stripeSubscription.items.data[0]?.price.recurring?.interval_count ?? 1
            : subscription.duration_months ?? 1;

    const { error: updateError } = await supabaseAdmin
        .from('subscriptions')
        .update({
            status: 'paused',
            stripe_subscription_id: stripeSubscriptionId,
        })
        .eq('id', subscription.id);

    if (updateError) {
        console.error('[Webhook] Error pausing subscription after failed payment:', updateError);
    }

    const paymentDescription = `${failureMonths}-month payment failed`;

    const { data: payment, error: paymentError } = await supabaseAdmin
        .from('payments')
        .insert({
            student_id: userId,
            subscription_id: subscription.id,
            amount: invoice.amount_due ?? invoice.amount_remaining ?? invoice.total ?? 0,
            currency: invoice.currency ?? 'eur',
            status: 'failed',
            stripe_invoice_id: invoice.id,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            stripe_payment_intent_id: (invoice as any).payment_intent as string | null,
            description: paymentDescription,
        })
        .select('id')
        .single();

    if (paymentError) {
        console.error('[Webhook] Error recording failed payment:', paymentError);
    } else if (payment) {
        await recordCrmActivityForProfileSafe(supabaseAdmin, {
            profileId: userId,
            lifecycleStage: 'customer',
            source: 'stripe',
            activityType: 'payment',
            subject: 'Pago fallido',
            body: paymentDescription,
            relatedEntityType: 'payment',
            relatedEntityId: payment.id,
            metadata: {
                status: 'failed',
                amount: invoice.amount_due ?? invoice.amount_remaining ?? invoice.total ?? 0,
                currency: invoice.currency ?? 'eur',
                subscription_id: subscription.id,
                stripe_invoice_id: invoice.id,
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                stripe_payment_intent_id: (invoice as any).payment_intent as string | null,
                failure_months: failureMonths,
            },
        });
    }

    console.log(`[Webhook] Payment failed for user ${userId}; subscription ${subscription.id} paused`);
}

// ============================================
// HANDLER: Subscription deleted/cancelled
// ============================================
async function handleSubscriptionDeleted(supabaseAdmin: SupabaseClient<Database>, subscription: Stripe.Subscription) {
    const stripeSubscriptionId = subscription.id;
    const userId = subscription.metadata?.userId;

    if (!userId && !stripeSubscriptionId) {
        console.error('[Webhook] No identifiers in deleted subscription payload');
        return;
    }

    const managedSubscription = await findManagedSubscription(supabaseAdmin, {
        stripeSubscriptionId,
        userId,
    });

    if (!managedSubscription) {
        console.error('[Webhook] No managed subscription found for deleted subscription:', stripeSubscriptionId, userId);
        return;
    }

    const { error: updateError } = await supabaseAdmin
        .from('subscriptions')
        .update({
            status: 'cancelled',
            stripe_subscription_id: stripeSubscriptionId,
        })
        .eq('id', managedSubscription.id);

    if (updateError) {
        console.error('[Webhook] Error cancelling subscription:', updateError);
    }

    console.log(`[Webhook] Subscription cancelled for user ${managedSubscription.student_id}`);
}

// ============================================
// HANDLER: Subscription updated (e.g. past_due)
// ============================================
async function handleSubscriptionUpdated(supabaseAdmin: SupabaseClient<Database>, subscription: Stripe.Subscription) {
    const stripeSubscriptionId = subscription.id;
    const userId = subscription.metadata?.userId;

    if (!userId && !stripeSubscriptionId) {
        console.error('[Webhook] No identifiers in subscription update payload');
        return;
    }

    const managedSubscription = await findManagedSubscription(supabaseAdmin, {
        stripeSubscriptionId,
        userId,
    });

    if (!managedSubscription) {
        console.error('[Webhook] No managed subscription found for update:', stripeSubscriptionId, userId);
        return;
    }

    const mappedStatus = mapStripeSubscriptionStatus(subscription.status);
    if (!mappedStatus) {
        console.log(`[Webhook] Ignoring unmapped subscription status: ${subscription.status}`);
        return;
    }

    const { error: updateError } = await supabaseAdmin
        .from('subscriptions')
        .update({
            status: mappedStatus,
            stripe_subscription_id: stripeSubscriptionId,
        })
        .eq('id', managedSubscription.id);

    if (updateError) {
        console.error('[Webhook] Error updating subscription status:', updateError);
        return;
    }

    console.log(`[Webhook] Subscription ${managedSubscription.id} mapped from Stripe status ${subscription.status} to ${mappedStatus}`);
}

type ManagedSubscription = Pick<
    Database['public']['Tables']['subscriptions']['Row'],
    'id' | 'student_id' | 'package_id' | 'sessions_total' | 'duration_months' | 'ends_at' | 'status' | 'stripe_subscription_id'
>;

async function findManagedSubscription(
    supabaseAdmin: SupabaseClient<Database>,
    options: {
        stripeSubscriptionId?: string | null;
        userId?: string | null;
    }
): Promise<ManagedSubscription | null> {
    if (options.stripeSubscriptionId) {
        const { data, error } = await supabaseAdmin
            .from('subscriptions')
            .select('id, student_id, package_id, sessions_total, duration_months, ends_at, status, stripe_subscription_id')
            .eq('stripe_subscription_id', options.stripeSubscriptionId)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();

        if (error) {
            console.error('[Webhook] Error looking up subscription by stripe_subscription_id:', error);
        } else if (data) {
            return data;
        }
    }

    if (!options.userId) {
        return null;
    }

    const { data, error } = await supabaseAdmin
        .from('subscriptions')
        .select('id, student_id, package_id, sessions_total, duration_months, ends_at, status, stripe_subscription_id')
        .eq('student_id', options.userId)
        .in('status', ['active', 'paused', 'pending'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

    if (error) {
        console.error('[Webhook] Error looking up subscription by user:', error);
        return null;
    }

    return data;
}

function mapStripeSubscriptionStatus(
    status: Stripe.Subscription.Status
): Database['public']['Enums']['subscription_status'] | null {
    switch (status) {
        case 'active':
        case 'trialing':
            return 'active';
        case 'past_due':
        case 'unpaid':
        case 'paused':
            return 'paused';
        case 'canceled':
        case 'incomplete_expired':
            return 'cancelled';
        case 'incomplete':
            return 'pending';
        default:
            return null;
    }
}
