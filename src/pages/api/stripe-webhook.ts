import type { APIContext, APIRoute } from 'astro';
import { stripe } from '../../lib/stripe';
import { recordCrmActivityForProfileSafe } from '../../lib/crm/activity-sync';
import { createSupabaseAdminClient } from '../../lib/supabase-admin';
import { enqueueRenewalNotice, enqueueWelcomeFulfillment } from '../../lib/fulfillment/queue';
import { triggerFulfillmentProcessing } from '../../lib/internal-job-service';
import { readRuntimeEnv } from '../../lib/runtime-env';
import { isRequiredStripeWebhookEvent } from '../../lib/stripe-webhook-events';
import type Stripe from 'stripe';
import type { Database } from '../../types/database.types';
import type { SupabaseClient } from '@supabase/supabase-js';

function isStripePriceId(value: unknown): value is string {
    return typeof value === 'string' && /^price_[A-Za-z0-9_]+$/.test(value);
}

function stripeObjectId(value: string | { id: string } | null | undefined): string | null {
    if (typeof value === 'string') return value;
    return value?.id ?? null;
}

function invoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
    const cloverSubscription = invoice.parent?.subscription_details?.subscription;
    if (cloverSubscription) return stripeObjectId(cloverSubscription);

    // Compatibility with invoices created under an older Stripe API version.
    const legacySubscription = (invoice as unknown as {
        subscription?: string | Stripe.Subscription | null;
    }).subscription;
    return stripeObjectId(legacySubscription);
}

async function paidInvoicePaymentIntentId(invoiceId: string): Promise<string | null> {
    const invoicePayments = await stripe.invoicePayments.list({
        invoice: invoiceId,
        status: 'paid',
    });
    const invoicePayment = invoicePayments.data.find((candidate) => (
        candidate.status === 'paid'
        && candidate.payment.type === 'payment_intent'
        && candidate.payment.payment_intent
    ));

    return stripeObjectId(invoicePayment?.payment.payment_intent);
}

async function invoicePaymentIntentId(invoiceId: string): Promise<string | null> {
    const invoicePayments = await stripe.invoicePayments.list({ invoice: invoiceId });
    const invoicePayment = invoicePayments.data.find((candidate) => (
        candidate.payment.type === 'payment_intent'
        && candidate.payment.payment_intent
    ));

    return stripeObjectId(invoicePayment?.payment.payment_intent);
}

async function requirePaidInvoicePaymentIntentId(invoiceId: string): Promise<string> {
    const paymentIntentId = await paidInvoicePaymentIntentId(invoiceId);
    if (!paymentIntentId) {
        throw new Error(`Paid Stripe invoice ${invoiceId} has no PaymentIntent mapping`);
    }
    return paymentIntentId;
}

type PaymentInsert = Database['public']['Tables']['payments']['Insert'];

async function persistInvoicePayment(
    supabaseAdmin: SupabaseClient<Database>,
    input: PaymentInsert & { stripe_invoice_id: string }
): Promise<{ id: string }> {
    const { data: existingPayment, error: lookupError } = await supabaseAdmin
        .from('payments')
        .select('id')
        .eq('stripe_invoice_id', input.stripe_invoice_id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

    if (lookupError) throw lookupError;
    if (existingPayment) {
        const { error: updateError } = await supabaseAdmin
            .from('payments')
            .update(input)
            .eq('id', existingPayment.id);
        if (updateError) throw updateError;
        return existingPayment;
    }

    const { data: payment, error: insertError } = await supabaseAdmin
        .from('payments')
        .insert(input)
        .select('id')
        .single();

    if (insertError || !payment) {
        throw insertError ?? new Error('Stripe invoice payment insert returned no row');
    }
    return payment;
}

type SubscriptionInsert = Database['public']['Tables']['subscriptions']['Insert'];
type CheckoutSubscription = Pick<
    Database['public']['Tables']['subscriptions']['Row'],
    'id' | 'student_id' | 'package_id' | 'starts_at' | 'ends_at' | 'sessions_total'
>;

async function findOrCreateCheckoutSubscription(
    supabaseAdmin: SupabaseClient<Database>,
    input: SubscriptionInsert & { stripe_subscription_id: string }
): Promise<CheckoutSubscription> {
    const { data: existingSubscription, error: lookupError } = await supabaseAdmin
        .from('subscriptions')
        .select('id, student_id, package_id, starts_at, ends_at, sessions_total')
        .eq('stripe_subscription_id', input.stripe_subscription_id)
        .limit(1)
        .maybeSingle();

    if (lookupError) throw lookupError;
    if (existingSubscription) {
        if (
            existingSubscription.student_id !== input.student_id
            || existingSubscription.package_id !== input.package_id
        ) {
            throw new Error('Stripe subscription is already linked to a different local purchase');
        }
        return existingSubscription;
    }

    const { data: subscription, error: insertError } = await supabaseAdmin
        .from('subscriptions')
        .insert(input)
        .select()
        .single();

    if (insertError || !subscription) {
        throw insertError ?? new Error('Stripe checkout subscription insert returned no row');
    }
    return subscription;
}

type WebhookEventProcessingStatus = 'processing' | 'succeeded' | 'failed';
type WebhookEventClaim = 'recorded' | 'duplicate' | 'processing' | 'previously_failed' | 'failed';
const WEBHOOK_PROCESSING_LEASE_MS = 10 * 60 * 1000;

function webhookProcessingErrorMessage(error: unknown): string {
    return (error instanceof Error ? error.message : 'Unknown webhook processing error').slice(0, 1000);
}

async function duplicateWebhookEventState(
    supabaseAdmin: SupabaseClient<Database>,
    event: Stripe.Event
): Promise<WebhookEventClaim> {
    const { data, error } = await supabaseAdmin
        .from('processed_webhook_events')
        .select('processing_status, created_at')
        .eq('stripe_event_id', event.id)
        .maybeSingle();

    if (error) {
        console.error('[Webhook] Error checking duplicate event state:', error);
        return 'failed';
    }

    const status = data?.processing_status as WebhookEventProcessingStatus | null | undefined;
    if (status === 'failed') {
        return reclaimWebhookEvent(supabaseAdmin, event, 'failed', data?.created_at ?? null);
    }
    if (status === 'processing') {
        const claimedAt = data?.created_at ? Date.parse(data.created_at) : Number.NaN;
        const leaseExpired = !Number.isFinite(claimedAt)
            || Date.now() - claimedAt >= WEBHOOK_PROCESSING_LEASE_MS;
        if (!leaseExpired) return 'processing';
        return reclaimWebhookEvent(supabaseAdmin, event, 'processing', data?.created_at ?? null);
    }
    return 'duplicate';
}

async function reclaimWebhookEvent(
    supabaseAdmin: SupabaseClient<Database>,
    event: Stripe.Event,
    expectedStatus: 'failed' | 'processing',
    observedCreatedAt: string | null
): Promise<WebhookEventClaim> {
    const reclaimedAt = new Date().toISOString();
    let claim = supabaseAdmin
        .from('processed_webhook_events')
        .update({
            processing_status: 'processing',
            processing_error: null,
            processed_at: null,
            created_at: reclaimedAt,
        })
        .eq('stripe_event_id', event.id)
        .eq('processing_status', expectedStatus);

    if (expectedStatus === 'processing') {
        claim = observedCreatedAt
            ? claim.eq('created_at', observedCreatedAt)
            : claim.is('created_at', null);
    }

    const { data, error } = await claim
        .select('stripe_event_id')
        .maybeSingle();

    if (error) {
        console.error(`[Webhook] Error reclaiming ${expectedStatus} event:`, error);
        return 'failed';
    }
    if (data) return 'recorded';
    return expectedStatus === 'failed' ? 'previously_failed' : 'processing';
}

async function markWebhookEventProcessed(
    supabaseAdmin: SupabaseClient<Database>,
    event: Stripe.Event
): Promise<WebhookEventClaim> {
    const { error } = await supabaseAdmin
        .from('processed_webhook_events')
        .insert({
            stripe_event_id: event.id,
            event_type: event.type,
            processing_status: 'processing',
            processing_error: null,
            processed_at: null,
            created_at: new Date().toISOString(),
        });

    if (!error) return 'recorded';
    if (error.code === '23505') return duplicateWebhookEventState(supabaseAdmin, event);

    console.error('[Webhook] Error recording event ID:', error);
    return 'failed';
}

async function markWebhookEventSucceeded(
    supabaseAdmin: SupabaseClient<Database>,
    event: Stripe.Event
): Promise<'recorded' | 'failed'> {
    const { error } = await supabaseAdmin
        .from('processed_webhook_events')
        .update({
            processing_status: 'succeeded',
            processing_error: null,
            processed_at: new Date().toISOString(),
        })
        .eq('stripe_event_id', event.id);

    if (!error) return 'recorded';

    console.error('[Webhook] Error marking event succeeded:', error);
    return 'failed';
}

async function markWebhookEventFailed(
    supabaseAdmin: SupabaseClient<Database>,
    event: Stripe.Event,
    processingError: unknown
): Promise<void> {
    const { error } = await supabaseAdmin
        .from('processed_webhook_events')
        .update({
            processing_status: 'failed',
            processing_error: webhookProcessingErrorMessage(processingError),
            processed_at: null,
        })
        .eq('stripe_event_id', event.id);

    if (error) {
        console.error('[Webhook] Error marking event failed:', error);
    }
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

    const markProcessed = await markWebhookEventProcessed(supabaseAdmin, event);
    if (markProcessed === 'duplicate') {
        console.log(`[Webhook] Duplicate event ${event.id} ignored`);
        return new Response(JSON.stringify({ received: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        });
    }
    if (markProcessed === 'processing' || markProcessed === 'previously_failed') {
        console.warn(`[Webhook] Event ${event.id} is not eligible for duplicate processing: ${markProcessed}`);
        return new Response(JSON.stringify({ error: 'Webhook event is already processing or failed' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }
    if (markProcessed === 'failed') {
        return new Response(JSON.stringify({ error: 'Webhook event could not be claimed for processing' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
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

            case 'invoice.upcoming': {
                const invoice = event.data.object as Stripe.Invoice;
                await handleInvoiceUpcoming(supabaseAdmin, event, invoice, context);
                break;
            }

            case 'charge.refunded': {
                const charge = event.data.object as Stripe.Charge;
                await handleChargeRefunded(supabaseAdmin, charge);
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
                if (isRequiredStripeWebhookEvent(event.type)) {
                    throw new Error(`Required Stripe webhook event has no handler: ${event.type}`);
                }
                console.log(`[Webhook] Unhandled event type: ${event.type}`);
        }
    } catch (error) {
        await markWebhookEventFailed(supabaseAdmin, event, error);
        console.error(`[Webhook] Error processing ${event.type}:`, error);
        return new Response(JSON.stringify({ error: 'Webhook processing failed' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    const markSucceeded = await markWebhookEventSucceeded(supabaseAdmin, event);
    if (markSucceeded === 'failed') {
        return new Response(JSON.stringify({ error: 'Webhook event could not be recorded as processed' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
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
    const stripeSubscriptionId = stripeObjectId(session.subscription);
    const stripeSubscription = typeof session.subscription === 'object'
        ? session.subscription
        : stripeSubscriptionId
            ? await stripe.subscriptions.retrieve(stripeSubscriptionId)
            : null;
    const stripeInvoiceId = stripeObjectId(session.invoice);
    const userId = session.metadata?.userId || stripeSubscription?.metadata?.userId;
    const priceId = session.metadata?.priceId || stripeSubscription?.metadata?.priceId;

    if (session.payment_status !== 'paid') {
        console.log(`[Webhook] Checkout session ${session.id} is not paid; skipping activation`);
        return;
    }

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

    if (pkgError) {
        throw new Error('Package lookup failed for checkout session');
    }

    if (!pkg) {
        console.error('[Webhook] Package not found for priceId:', priceId);
        return;
    }

    if (!stripeSubscriptionId) {
        throw new Error('Paid subscription checkout has no Stripe subscription');
    }
    if (!stripeInvoiceId) {
        throw new Error('Paid subscription checkout has no Stripe invoice');
    }
    const paymentIntentId = await requirePaidInvoicePaymentIntentId(stripeInvoiceId);

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

    // Create or recover the subscription record if a prior webhook attempt stopped mid-flight.
    const subscription = await findOrCreateCheckoutSubscription(supabaseAdmin, {
            student_id: userId,
            package_id: pkg.id,
            status: 'active',
            duration_months: durationMonths,
            starts_at: startsAt.toISOString().split('T')[0],
            ends_at: endsAt.toISOString().split('T')[0],
            sessions_total: sessionsTotal,
            sessions_used: 0,
            stripe_subscription_id: stripeSubscriptionId,
            stripe_invoice_id: stripeInvoiceId,
    });
    const contractStartsAt = subscription.starts_at;
    const contractEndsAt = subscription.ends_at;
    const contractSessionsTotal = subscription.sessions_total;

    const paymentDescription = `${pkg.name} - ${durationMonths} month(s) - Initial`;

    // Create or update by Stripe invoice so a reclaimed webhook cannot duplicate the payment.
    const payment = await persistInvoicePayment(supabaseAdmin, {
            student_id: userId,
            subscription_id: subscription.id,
            amount: session.amount_total ?? 0,
            currency: session.currency ?? 'eur',
            status: 'succeeded',
            stripe_invoice_id: stripeInvoiceId,
            stripe_payment_intent_id: paymentIntentId,
            description: paymentDescription,
    });

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
            stripe_invoice_id: stripeInvoiceId,
            stripe_payment_intent_id: paymentIntentId,
        },
    });

    console.log(`[Webhook] Successfully processed initial payment for user ${userId}, subscription ${subscription.id}`);

    const { data: existingWelcomeJob, error: welcomeJobLookupError } = await supabaseAdmin
        .from('fulfillment_jobs')
        .select('id')
        .eq('job_type', 'welcome_fulfillment')
        .eq('subscription_id', subscription.id)
        .limit(1)
        .maybeSingle();
    if (welcomeJobLookupError) throw welcomeJobLookupError;

    const fulfillmentQueued = existingWelcomeJob
        ? true
        : await enqueueWelcomeFulfillment(supabaseAdmin, {
            userId,
            packageId: pkg.id,
            subscriptionId: subscription.id,
            durationMonths,
            startsAt: contractStartsAt,
            endsAt: contractEndsAt,
            sessionsTotal: contractSessionsTotal,
            amountTotal: session.amount_total ?? 0,
            currency: session.currency ?? 'eur',
            legalPolicyVersion: session.metadata?.legalPolicyVersion || 'unknown',
            policyAcceptedAt: session.metadata?.termsAcceptedAt
                || new Date((session.created ?? Math.floor(Date.now() / 1000)) * 1000).toISOString(),
        });

    if (!fulfillmentQueued) {
        console.error('[Webhook] Welcome fulfillment could not be queued');
        throw new Error('Welcome fulfillment could not be queued');
    }

    triggerFulfillmentProcessing(context, 5);
}

// ============================================
// HANDLER: Upcoming recurring invoice notice
// ============================================
async function handleInvoiceUpcoming(
    supabaseAdmin: SupabaseClient<Database>,
    event: Stripe.Event,
    invoice: Stripe.Invoice,
    context: APIContext
) {
    const stripeSubscriptionId = invoiceSubscriptionId(invoice);
    if (!stripeSubscriptionId) {
        console.log('[Webhook] Upcoming invoice without subscription, skipping');
        return;
    }

    const stripeSubscription = await stripe.subscriptions.retrieve(stripeSubscriptionId);
    if (
        stripeSubscription.cancel_at_period_end
        || !['active', 'trialing'].includes(stripeSubscription.status)
    ) {
        console.log(`[Webhook] Subscription ${stripeSubscriptionId} is not renewing; skipping upcoming notice`);
        return;
    }
    const userId = stripeSubscription.metadata?.userId
        || invoice.parent?.subscription_details?.metadata?.userId;
    const subscription = await findManagedSubscription(supabaseAdmin, {
        stripeSubscriptionId,
        userId,
    });

    if (!subscription) {
        console.error('[Webhook] No managed subscription found for upcoming invoice:', stripeSubscriptionId, userId);
        return;
    }

    const subscriptionItem = stripeSubscription.items.data[0];
    const periodEnd = Number.isInteger(subscriptionItem?.current_period_end)
        && (subscriptionItem?.current_period_end ?? 0) > 0
        ? subscriptionItem?.current_period_end
        : invoice.period_end;
    if (!Number.isInteger(periodEnd) || (periodEnd ?? 0) <= 0) {
        throw new Error('Upcoming Stripe invoice has no renewal date');
    }

    const durationMonths = subscriptionItem?.price.recurring?.interval === 'month'
        ? subscriptionItem.price.recurring.interval_count ?? 1
        : subscription.duration_months ?? 1;
    const renewalAt = new Date((periodEnd as number) * 1000).toISOString();
    const queued = await enqueueRenewalNotice(supabaseAdmin, {
        stripeEventId: event.id,
        stripeInvoiceId: typeof invoice.id === 'string' && invoice.id ? invoice.id : undefined,
        stripeSubscriptionId,
        userId: subscription.student_id,
        packageId: subscription.package_id,
        subscriptionId: subscription.id,
        renewalAt,
        cancelBy: renewalAt,
        durationMonths,
        amountTotal: Math.max(0, invoice.amount_due ?? invoice.total ?? 0),
        currency: invoice.currency ?? 'eur',
    });

    if (!queued) {
        throw new Error('Renewal notice fulfillment could not be queued');
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

    const stripeSubscriptionId = invoiceSubscriptionId(invoice);
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
    const { data: pkg, error: packageError } = await supabaseAdmin
        .from('packages')
        .select('sessions_per_month')
        .eq('id', subscription.package_id)
        .single();

    if (packageError || !pkg) {
        throw new Error('Package lookup failed for paid renewal invoice');
    }

    const paymentIntentId = await requirePaidInvoicePaymentIntentId(invoice.id);

    const subscriptionItem = stripeSubscription.items.data[0];
    const renewalMonths =
        subscriptionItem?.price.recurring?.interval === 'month'
            ? subscriptionItem.price.recurring?.interval_count ?? 1
            : subscription.duration_months ?? 1;
    const currentPeriodEnd = subscriptionItem?.current_period_end;
    if (!Number.isInteger(currentPeriodEnd) || (currentPeriodEnd ?? 0) <= 0) {
        throw new Error('Stripe renewal subscription item has no current period end');
    }
    // Stripe is the deterministic billing-period source, so webhook retries set the same end date.
    const newEndsAt = new Date((currentPeriodEnd as number) * 1000);

    const additionalSessions = pkg.sessions_per_month * renewalMonths;

    const renewalAlreadyApplied = subscription.stripe_invoice_id === invoice.id;
    if (!renewalAlreadyApplied) {
        const { error: updateError } = await supabaseAdmin
            .from('subscriptions')
            .update({
                ends_at: newEndsAt.toISOString().split('T')[0],
                sessions_total: additionalSessions, // Fresh quota for this billing period
                sessions_used: 0,
                status: 'active',
                stripe_subscription_id: stripeSubscriptionId,
                stripe_invoice_id: invoice.id,
            })
            .eq('id', subscription.id);

        if (updateError) {
            console.error('[Webhook] Error extending subscription:', updateError);
            throw new Error('Subscription renewal update failed');
        }
    }

    const paymentDescription = `${renewalMonths}-month renewal`;

    // Record or update by invoice so a retry cannot create a duplicate payment row.
    const payment = await persistInvoicePayment(supabaseAdmin, {
            student_id: userId,
            subscription_id: subscription.id,
            amount: invoice.amount_paid ?? 0,
            currency: invoice.currency ?? 'eur',
            status: 'succeeded',
            stripe_invoice_id: invoice.id,
            stripe_payment_intent_id: paymentIntentId,
            description: paymentDescription,
    });

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
            stripe_payment_intent_id: paymentIntentId,
            renewal_months: renewalMonths,
            additional_sessions: additionalSessions,
        },
    });

    console.log(`[Webhook] Renewal processed for user ${userId}: +${additionalSessions} sessions for ${renewalMonths} month(s), extended to ${newEndsAt.toISOString().split('T')[0]}`);
}

// ============================================
// HANDLER: Invoice payment failed
// ============================================
async function handleInvoicePaymentFailed(supabaseAdmin: SupabaseClient<Database>, invoice: Stripe.Invoice) {
    const stripeSubscriptionId = invoiceSubscriptionId(invoice);
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
    const paymentIntentId = await invoicePaymentIntentId(invoice.id);

    const { error: updateError } = await supabaseAdmin
        .from('subscriptions')
        .update({
            status: 'paused',
            stripe_subscription_id: stripeSubscriptionId,
        })
        .eq('id', subscription.id);

    if (updateError) {
        console.error('[Webhook] Error pausing subscription after failed payment:', updateError);
        throw new Error('Subscription payment-failure update failed');
    }

    const paymentDescription = `${failureMonths}-month payment failed`;

    const payment = await persistInvoicePayment(supabaseAdmin, {
            student_id: userId,
            subscription_id: subscription.id,
            amount: invoice.amount_due ?? invoice.amount_remaining ?? invoice.total ?? 0,
            currency: invoice.currency ?? 'eur',
            status: 'failed',
            stripe_invoice_id: invoice.id,
            stripe_payment_intent_id: paymentIntentId,
            description: paymentDescription,
    });

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
            stripe_payment_intent_id: paymentIntentId,
            failure_months: failureMonths,
        },
    });

    console.log(`[Webhook] Payment failed for user ${userId}; subscription ${subscription.id} paused`);
}

type RefundPayment = Pick<
    Database['public']['Tables']['payments']['Row'],
    'id' | 'student_id' | 'subscription_id' | 'amount' | 'amount_refunded' | 'status'
>;

async function findLocalRefundPayment(
    supabaseAdmin: SupabaseClient<Database>,
    column: 'stripe_payment_intent_id' | 'stripe_invoice_id',
    value: string
): Promise<RefundPayment | null> {
    const { data, error } = await supabaseAdmin
        .from('payments')
        .select('id, student_id, subscription_id, amount, amount_refunded, status')
        .eq(column, value)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

    if (error) throw error;
    return data;
}

async function findRefundPaymentByPaymentIntent(
    supabaseAdmin: SupabaseClient<Database>,
    paymentIntentId: string
): Promise<RefundPayment | null> {
    const directPayment = await findLocalRefundPayment(
        supabaseAdmin,
        'stripe_payment_intent_id',
        paymentIntentId
    );
    if (directPayment) return directPayment;

    // Older subscription payments may only have stored the Stripe invoice ID.
    // InvoicePayment is the Clover API mapping between that invoice and its PaymentIntent.
    const invoicePayments = await stripe.invoicePayments.list({
        status: 'paid',
        payment: {
            type: 'payment_intent',
            payment_intent: paymentIntentId,
        },
    });
    const invoiceIds = [...new Set(
        invoicePayments.data
            .map((invoicePayment) => stripeObjectId(invoicePayment.invoice))
            .filter((invoiceId): invoiceId is string => Boolean(invoiceId))
    )];

    for (const invoiceId of invoiceIds) {
        const payment = await findLocalRefundPayment(
            supabaseAdmin,
            'stripe_invoice_id',
            invoiceId
        );
        if (payment) return payment;
    }

    return null;
}

// ============================================
// HANDLER: Full or partial refund synchronized from Stripe
// ============================================
async function handleChargeRefunded(supabaseAdmin: SupabaseClient<Database>, charge: Stripe.Charge) {
    const paymentIntentId = stripeObjectId(charge.payment_intent);

    if (!paymentIntentId) {
        console.log('[Webhook] Refunded charge has no payment intent; skipping payment reconciliation');
        return;
    }

    const payment = await findRefundPaymentByPaymentIntent(supabaseAdmin, paymentIntentId);
    if (!payment) {
        console.log('[Webhook] No local payment found for refunded charge');
        return;
    }

    const amountRefunded = Math.max(0, Math.min(charge.amount_refunded ?? 0, payment.amount));
    const fullyRefunded = amountRefunded >= payment.amount;
    const latestRefund = [...(charge.refunds?.data ?? [])]
        .sort((left, right) => (right.created ?? 0) - (left.created ?? 0))[0];
    const refundedAt = new Date((latestRefund?.created ?? Math.floor(Date.now() / 1000)) * 1000).toISOString();

    const { error: updateError } = await supabaseAdmin
        .from('payments')
        .update({
            amount_refunded: amountRefunded,
            stripe_refund_id: latestRefund?.id ?? null,
            refunded_at: refundedAt,
            status: fullyRefunded ? 'refunded' : payment.status ?? 'succeeded',
        })
        .eq('id', payment.id);

    if (updateError) throw updateError;

    await recordCrmActivityForProfileSafe(supabaseAdmin, {
        profileId: payment.student_id,
        lifecycleStage: 'customer',
        source: 'stripe',
        activityType: 'payment',
        subject: fullyRefunded ? 'Pago reembolsado' : 'Reembolso parcial',
        body: fullyRefunded ? 'Stripe refund synchronized in full.' : 'Stripe partial refund synchronized.',
        relatedEntityType: 'payment',
        relatedEntityId: payment.id,
        metadata: {
            status: fullyRefunded ? 'refunded' : 'partially_refunded',
            amount_refunded: amountRefunded,
            amount_original: payment.amount,
            subscription_id: payment.subscription_id,
            stripe_payment_intent_id: paymentIntentId,
            stripe_refund_id: latestRefund?.id ?? null,
        },
    });

    console.log(`[Webhook] Refund synchronized (${fullyRefunded ? 'full' : 'partial'})`);
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
        throw new Error('Subscription cancellation update failed');
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
        throw new Error('Subscription status update failed');
    }

    console.log(`[Webhook] Subscription ${managedSubscription.id} mapped from Stripe status ${subscription.status} to ${mappedStatus}`);
}

type ManagedSubscription = Pick<
    Database['public']['Tables']['subscriptions']['Row'],
    'id' | 'student_id' | 'package_id' | 'sessions_total' | 'duration_months' | 'ends_at' | 'status' | 'stripe_subscription_id' | 'stripe_invoice_id'
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
            .select('id, student_id, package_id, sessions_total, duration_months, ends_at, status, stripe_subscription_id, stripe_invoice_id')
            .eq('stripe_subscription_id', options.stripeSubscriptionId)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();

        if (error) {
            console.error('[Webhook] Error looking up subscription by stripe_subscription_id:', error);
            throw error;
        } else if (data) {
            return data;
        }
    }

    if (!options.userId) {
        return null;
    }

    const { data, error } = await supabaseAdmin
        .from('subscriptions')
        .select('id, student_id, package_id, sessions_total, duration_months, ends_at, status, stripe_subscription_id, stripe_invoice_id')
        .eq('student_id', options.userId)
        .in('status', ['active', 'paused', 'pending'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

    if (error) {
        console.error('[Webhook] Error looking up subscription by user:', error);
        throw error;
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
