import type { APIContext, APIRoute } from 'astro';
import { stripe } from '../../lib/stripe';
import { recordCrmActivityForProfileSafe } from '../../lib/crm/activity-sync';
import { createSupabaseAdminClient } from '../../lib/supabase-admin';
import { enqueueRenewalNotice, enqueueWelcomeFulfillment } from '../../lib/fulfillment/queue';
import { triggerFulfillmentProcessing } from '../../lib/internal-job-service';
import { readRuntimeEnv } from '../../lib/runtime-env';
import { isRequiredStripeWebhookEvent } from '../../lib/stripe-webhook-events';
import { assertStripeRuntimeAccount, type StripeRuntimeContext } from '../../lib/stripe-runtime-guard';
import { isPackageDuration, PACKAGE_CURRENCY } from '../../lib/package-pricing';
import type Stripe from 'stripe';
import type { Database } from '../../types/database.types';
import type { SupabaseClient } from '@supabase/supabase-js';

function isStripePriceId(value: unknown): value is string {
    return typeof value === 'string' && /^price_[A-Za-z0-9_]+$/.test(value);
}

function isStripeCustomerId(value: unknown): value is string {
    return typeof value === 'string' && /^cus_[A-Za-z0-9_]+$/.test(value);
}

function isUuid(value: unknown): value is string {
    return typeof value === 'string'
        && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function stripePriceProductId(price: Stripe.Price): string {
    return typeof price.product === 'string' ? price.product : price.product.id;
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

const APP_BILLING_METADATA_KEYS = [
    'userId',
    'packageId',
    'packagePriceId',
    'crmOpportunityId',
    'checkoutIntentId',
    'priceId',
    'catalogVersion',
    'durationMonths',
    'sessionsPerPeriod',
    'legalPolicyVersion',
] as const;

function containsAppBillingMetadata(metadata: Stripe.Metadata | null | undefined): boolean {
    return APP_BILLING_METADATA_KEYS.some((key) => (
        typeof metadata?.[key] === 'string' && metadata[key].length > 0
    ));
}

function invoiceBillingMetadata(
    invoice: Stripe.Invoice,
    stripeSubscription: Stripe.Subscription
): Stripe.Metadata[] {
    return [
        invoice.metadata,
        invoice.parent?.subscription_details?.metadata,
        stripeSubscription.metadata,
    ].filter((metadata): metadata is Stripe.Metadata => Boolean(metadata));
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
type PaymentUpdate = Database['public']['Tables']['payments']['Update'];
type ExistingInvoicePayment = Pick<
    Database['public']['Tables']['payments']['Row'],
    'id' | 'student_id' | 'subscription_id' | 'amount' | 'currency' | 'status' | 'stripe_payment_intent_id'
>;

async function persistInvoicePayment(
    supabaseAdmin: SupabaseClient<Database>,
    input: PaymentInsert & { stripe_invoice_id: string }
): Promise<{ id: string }> {
    const { data: existingPayment, error: lookupError } = await supabaseAdmin
        .from('payments')
        .select('id, student_id, subscription_id, amount, currency, status, stripe_payment_intent_id')
        .eq('stripe_invoice_id', input.stripe_invoice_id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

    if (lookupError) throw lookupError;
    if (existingPayment) {
        const existing = existingPayment as ExistingInvoicePayment;
        const incomingCurrency = input.currency ?? null;
        const incomingStatus = input.status ?? null;
        const incomingPaymentIntentId = input.stripe_payment_intent_id ?? null;
        if (
            existing.student_id !== input.student_id
            || existing.subscription_id !== (input.subscription_id ?? null)
            || existing.amount !== input.amount
            || existing.currency !== incomingCurrency
        ) {
            throw new Error('Stripe invoice is already linked to incompatible local payment data');
        }
        if (
            existing.stripe_payment_intent_id
            && incomingPaymentIntentId
            && existing.stripe_payment_intent_id !== incomingPaymentIntentId
        ) {
            throw new Error('Stripe invoice PaymentIntent conflicts with the existing local payment');
        }
        const statusIsUnchanged = existing.status === incomingStatus;
        const statusIsCoherentRetry = existing.status === 'failed' && incomingStatus === 'succeeded';
        if (!statusIsUnchanged && !statusIsCoherentRetry) {
            throw new Error('Stripe invoice payment status transition is not allowed');
        }

        const safeUpdate: PaymentUpdate = {
            description: input.description,
        };
        if (!existing.stripe_payment_intent_id && incomingPaymentIntentId) {
            safeUpdate.stripe_payment_intent_id = incomingPaymentIntentId;
        }
        if (statusIsCoherentRetry) {
            safeUpdate.status = 'succeeded';
        }
        const { error: updateError } = await supabaseAdmin
            .from('payments')
            .update(safeUpdate)
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
    'id' | 'student_id' | 'package_id' | 'package_price_id' | 'starts_at' | 'ends_at' | 'sessions_total' | 'contracted_sessions_per_period'
>;

async function findOrCreateCheckoutSubscription(
    supabaseAdmin: SupabaseClient<Database>,
    input: SubscriptionInsert & { stripe_subscription_id: string }
): Promise<CheckoutSubscription> {
    const { data: existingSubscription, error: lookupError } = await supabaseAdmin
        .from('subscriptions')
        .select('id, student_id, package_id, package_price_id, starts_at, ends_at, sessions_total, contracted_sessions_per_period')
        .eq('stripe_subscription_id', input.stripe_subscription_id)
        .limit(1)
        .maybeSingle();

    if (lookupError) throw lookupError;
    if (existingSubscription) {
        if (
            existingSubscription.student_id !== input.student_id
            || existingSubscription.package_id !== input.package_id
            || (existingSubscription.package_price_id && existingSubscription.package_price_id !== input.package_price_id)
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
type WebhookEventClaimResult = {
    status: WebhookEventClaim;
    leaseToken: string | null;
};
const WEBHOOK_PROCESSING_LEASE_MS = 10 * 60 * 1000;

function webhookProcessingErrorMessage(error: unknown): string {
    return (error instanceof Error ? error.message : 'Unknown webhook processing error').slice(0, 1000);
}

async function duplicateWebhookEventState(
    supabaseAdmin: SupabaseClient<Database>,
    event: Stripe.Event
): Promise<WebhookEventClaimResult> {
    const { data, error } = await supabaseAdmin
        .from('processed_webhook_events')
        .select('processing_status, created_at')
        .eq('stripe_event_id', event.id)
        .maybeSingle();

    if (error) {
        console.error('[Webhook] Error checking duplicate event state:', error);
        return { status: 'failed', leaseToken: null };
    }

    const status = data?.processing_status as WebhookEventProcessingStatus | null | undefined;
    if (status === 'failed') {
        return reclaimWebhookEvent(supabaseAdmin, event, 'failed', data?.created_at ?? null);
    }
    if (status === 'processing') {
        const claimedAt = data?.created_at ? Date.parse(data.created_at) : Number.NaN;
        const leaseExpired = !Number.isFinite(claimedAt)
            || Date.now() - claimedAt >= WEBHOOK_PROCESSING_LEASE_MS;
        if (!leaseExpired) return { status: 'processing', leaseToken: null };
        return reclaimWebhookEvent(supabaseAdmin, event, 'processing', data?.created_at ?? null);
    }
    return { status: 'duplicate', leaseToken: null };
}

async function reclaimWebhookEvent(
    supabaseAdmin: SupabaseClient<Database>,
    event: Stripe.Event,
    expectedStatus: 'failed' | 'processing',
    observedCreatedAt: string | null
): Promise<WebhookEventClaimResult> {
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
        return { status: 'failed', leaseToken: null };
    }
    if (data) return { status: 'recorded', leaseToken: reclaimedAt };
    return {
        status: expectedStatus === 'failed' ? 'previously_failed' : 'processing',
        leaseToken: null,
    };
}

async function markWebhookEventProcessed(
    supabaseAdmin: SupabaseClient<Database>,
    event: Stripe.Event
): Promise<WebhookEventClaimResult> {
    const claimedAt = new Date().toISOString();
    const { error } = await supabaseAdmin
        .from('processed_webhook_events')
        .insert({
            stripe_event_id: event.id,
            event_type: event.type,
            processing_status: 'processing',
            processing_error: null,
            processed_at: null,
            created_at: claimedAt,
        });

    if (!error) return { status: 'recorded', leaseToken: claimedAt };
    if (error.code === '23505') return duplicateWebhookEventState(supabaseAdmin, event);

    console.error('[Webhook] Error recording event ID:', error);
    return { status: 'failed', leaseToken: null };
}

async function markWebhookEventSucceeded(
    supabaseAdmin: SupabaseClient<Database>,
    event: Stripe.Event,
    leaseToken: string
): Promise<'recorded' | 'failed'> {
    const { data, error } = await supabaseAdmin
        .from('processed_webhook_events')
        .update({
            processing_status: 'succeeded',
            processing_error: null,
            processed_at: new Date().toISOString(),
        })
        .eq('stripe_event_id', event.id)
        .eq('processing_status', 'processing')
        .eq('created_at', leaseToken)
        .select('stripe_event_id')
        .maybeSingle();

    if (!error && data) return 'recorded';

    console.error('[Webhook] Error marking event succeeded or lease was lost:', error);
    return 'failed';
}

async function markWebhookEventFailed(
    supabaseAdmin: SupabaseClient<Database>,
    event: Stripe.Event,
    leaseToken: string,
    processingError: unknown
): Promise<void> {
    const { data, error } = await supabaseAdmin
        .from('processed_webhook_events')
        .update({
            processing_status: 'failed',
            processing_error: webhookProcessingErrorMessage(processingError),
            processed_at: null,
        })
        .eq('stripe_event_id', event.id)
        .eq('processing_status', 'processing')
        .eq('created_at', leaseToken)
        .select('stripe_event_id')
        .maybeSingle();

    if (error || !data) {
        console.error('[Webhook] Error marking event failed or lease was lost:', error);
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
        event = await stripe.webhooks.constructEventAsync(payload, signature, webhookSecret);
    } catch (err) {
        // Manejo de error tipado
        const errorMessage = err instanceof Error ? err.message : 'Unknown Error';
        console.error('Webhook signature verification failed:', errorMessage);
        return new Response(`Webhook Error: ${errorMessage}`, { status: 400 });
    }

    let stripeRuntime: StripeRuntimeContext;
    try {
        const stripeAccount = await stripe.accounts.retrieve();
        stripeRuntime = assertStripeRuntimeAccount(context, stripeAccount);
        if (typeof event.livemode === 'boolean' && event.livemode !== stripeRuntime.livemode) {
            throw new Error('Stripe webhook event mode does not match this runtime');
        }
    } catch (error) {
        console.error('[Webhook] Stripe runtime isolation failed:', error);
        return new Response(JSON.stringify({ error: 'Stripe runtime isolation failed' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    const markProcessed = await markWebhookEventProcessed(supabaseAdmin, event);
    if (markProcessed.status === 'duplicate') {
        console.log(`[Webhook] Duplicate event ${event.id} ignored`);
        return new Response(JSON.stringify({ received: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        });
    }
    if (markProcessed.status === 'processing' || markProcessed.status === 'previously_failed') {
        console.warn(`[Webhook] Event ${event.id} is not eligible for duplicate processing: ${markProcessed.status}`);
        return new Response(JSON.stringify({ error: 'Webhook event is already processing or failed' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }
    if (markProcessed.status === 'failed' || !markProcessed.leaseToken) {
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
                await handleCheckoutCompleted(supabaseAdmin, session, context, stripeRuntime);
                break;
            }

            case 'checkout.session.expired': {
                const session = event.data.object as Stripe.Checkout.Session;
                await handleCheckoutExpired(supabaseAdmin, session, stripeRuntime);
                break;
            }

            case 'invoice.paid': {
                // Recurring monthly payment succeeded
                const invoice = event.data.object as Stripe.Invoice;
                await handleInvoicePaid(supabaseAdmin, invoice, stripeRuntime);
                break;
            }

            case 'invoice.payment_failed': {
                const invoice = event.data.object as Stripe.Invoice;
                await handleInvoicePaymentFailed(supabaseAdmin, invoice, stripeRuntime);
                break;
            }

            case 'invoice.upcoming': {
                const invoice = event.data.object as Stripe.Invoice;
                await handleInvoiceUpcoming(supabaseAdmin, event, invoice, context, stripeRuntime);
                break;
            }

            case 'charge.refunded': {
                const charge = event.data.object as Stripe.Charge;
                await handleChargeRefunded(supabaseAdmin, charge, stripeRuntime);
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
        await markWebhookEventFailed(supabaseAdmin, event, markProcessed.leaseToken, error);
        console.error(`[Webhook] Error processing ${event.type}:`, error);
        return new Response(JSON.stringify({ error: 'Webhook processing failed' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    const markSucceeded = await markWebhookEventSucceeded(supabaseAdmin, event, markProcessed.leaseToken);
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
    context: APIContext,
    stripeRuntime: StripeRuntimeContext
) {
    const stripeSubscriptionId = stripeObjectId(session.subscription);
    const stripeSubscription = typeof session.subscription === 'object'
        ? session.subscription
        : stripeSubscriptionId
            ? await stripe.subscriptions.retrieve(stripeSubscriptionId)
            : null;
    const stripeInvoiceId = stripeObjectId(session.invoice);
    const metadata = {
        ...(stripeSubscription?.metadata ?? {}),
        ...(session.metadata ?? {}),
    };
    const userId = metadata.userId;
    const metadataPriceId = metadata.priceId;
    const packagePriceId = metadata.packagePriceId;
    const crmOpportunityId = metadata.crmOpportunityId;
    const checkoutIntentId = metadata.checkoutIntentId;

    if (session.payment_status !== 'paid') {
        console.log(`[Webhook] Checkout session ${session.id} is not paid; skipping activation`);
        return;
    }

    if (!stripeSubscriptionId) {
        throw new Error('Paid subscription checkout has no Stripe subscription');
    }
    if (!stripeSubscription) {
        throw new Error('Paid subscription checkout could not retrieve its Stripe subscription');
    }
    const sessionCustomerId = stripeObjectId(session.customer);
    const subscriptionCustomerId = stripeObjectId(stripeSubscription.customer);
    if (
        !isStripeCustomerId(sessionCustomerId)
        || !isStripeCustomerId(subscriptionCustomerId)
        || subscriptionCustomerId !== sessionCustomerId
    ) {
        throw new Error('Paid checkout Customer does not match the Stripe subscription Customer');
    }
    if (!['active', 'trialing'].includes(stripeSubscription.status)) {
        throw new Error('Paid checkout Stripe subscription is not active');
    }
    if (!stripeInvoiceId) {
        throw new Error('Paid subscription checkout has no Stripe invoice');
    }
    if (!userId || !isUuid(userId)) {
        throw new Error('Paid checkout has invalid user metadata');
    }
    if (!isUuid(packagePriceId) || !isUuid(crmOpportunityId) || !isUuid(checkoutIntentId)) {
        throw new Error('Paid checkout is missing its immutable authorization metadata');
    }

    const subscriptionItem = stripeSubscription.items.data[0];
    if (stripeSubscription.items.data.length !== 1 || subscriptionItem?.quantity !== 1) {
        throw new Error('Paid checkout must contain exactly one subscription item');
    }
    const actualStripePrice = subscriptionItem?.price;
    if (!actualStripePrice || !isStripePriceId(actualStripePrice.id)) {
        throw new Error('Paid subscription has no valid Stripe Price');
    }
    const actualPriceId = actualStripePrice.id;
    if (metadataPriceId && metadataPriceId !== actualPriceId) {
        throw new Error('Checkout metadata Price does not match the paid subscription Price');
    }

    const packagePriceQuery = supabaseAdmin
        .from('package_prices')
        .select('*')
        .eq('id', packagePriceId);
    const { data: packagePrice, error: packagePriceError } = await packagePriceQuery.single();
    if (packagePriceError || !packagePrice || !isPackageDuration(packagePrice.duration_months)) {
        throw new Error('Paid Stripe Price is not present in package price history');
    }

    const durationMonths = packagePrice.duration_months;
    if (
        packagePrice.stripe_price_id !== actualPriceId
        || packagePrice.stripe_product_id !== stripePriceProductId(actualStripePrice)
        || packagePrice.amount_cents !== actualStripePrice.unit_amount
        || packagePrice.currency !== actualStripePrice.currency
        || packagePrice.currency !== PACKAGE_CURRENCY
        || packagePrice.stripe_livemode !== actualStripePrice.livemode
        || packagePrice.stripe_account_id !== stripeRuntime.accountId
        || actualStripePrice.recurring?.interval !== 'month'
        || actualStripePrice.recurring.interval_count !== durationMonths
        || session.amount_total !== packagePrice.amount_cents
        || session.currency !== packagePrice.currency
    ) {
        throw new Error('Paid Stripe offer does not match the immutable package price');
    }

    const { data: pkg, error: pkgError } = await supabaseAdmin
        .from('packages')
        .select('id, name')
        .eq('id', packagePrice.package_id)
        .single();
    if (pkgError || !pkg) throw new Error('Package lookup failed for paid checkout');

    const startsAt = Number.isInteger(subscriptionItem.current_period_start)
        ? new Date(subscriptionItem.current_period_start * 1000)
        : new Date();
    const endsAt = Number.isInteger(subscriptionItem.current_period_end)
        ? new Date(subscriptionItem.current_period_end * 1000)
        : new Date(startsAt);
    if (!Number.isInteger(subscriptionItem.current_period_end)) {
        endsAt.setMonth(endsAt.getMonth() + durationMonths);
    }

    const paymentIntentId = await requirePaidInvoicePaymentIntentId(stripeInvoiceId);
    const sessionsTotal = packagePrice.sessions_per_period;

    const { data: completedIntent, error: completedIntentError } = await supabaseAdmin
        .rpc('complete_checkout_intent', {
            p_intent_id: checkoutIntentId,
            p_opportunity_id: crmOpportunityId,
            p_student_id: userId,
            p_package_price_id: packagePrice.id,
            p_stripe_checkout_session_id: session.id,
            p_stripe_customer_id: sessionCustomerId,
        });
    if (
        completedIntentError
        || !completedIntent
        || completedIntent.id !== checkoutIntentId
        || completedIntent.stripe_checkout_session_id !== session.id
        || completedIntent.stripe_customer_id !== sessionCustomerId
    ) {
        throw new Error('Paid checkout does not match an authorized checkout intent');
    }

    // Create or recover the subscription record if a prior webhook attempt stopped mid-flight.
    const subscription = await findOrCreateCheckoutSubscription(supabaseAdmin, {
            student_id: userId,
            package_id: pkg.id,
            package_price_id: packagePrice.id,
            status: 'active',
            duration_months: durationMonths,
            starts_at: startsAt.toISOString().split('T')[0],
            ends_at: endsAt.toISOString().split('T')[0],
            sessions_total: sessionsTotal,
            contracted_sessions_per_period: sessionsTotal,
            sessions_used: 0,
            stripe_subscription_id: stripeSubscriptionId,
            stripe_invoice_id: stripeInvoiceId,
    });
    const contractStartsAt = subscription.starts_at;
    const contractEndsAt = subscription.ends_at;
    const contractSessionsTotal = subscription.sessions_total;

    const paymentDescription = `${packagePrice.package_key} - ${durationMonths} month(s) - Initial`;

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

    const { data: convertedOpportunity, error: opportunityError } = await supabaseAdmin
        .from('crm_opportunities')
        .update({
            stage: 'won',
            converted_subscription_id: subscription.id,
            checkout_approved_at: null,
            closed_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
        })
        .eq('id', crmOpportunityId)
        .eq('preferred_package_id', pkg.id)
        .is('converted_subscription_id', null)
        .select('id')
        .maybeSingle();

    if (opportunityError) throw opportunityError;
    if (!convertedOpportunity) {
        const { data: alreadyConverted, error: convertedLookupError } = await supabaseAdmin
            .from('crm_opportunities')
            .select('id')
            .eq('id', crmOpportunityId)
            .eq('converted_subscription_id', subscription.id)
            .maybeSingle();
        if (convertedLookupError || !alreadyConverted) {
            throw new Error('Paid checkout could not consume its CRM approval');
        }
    }

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
            packageKey: packagePrice.package_key,
            packageDisplayName: packagePrice.display_name,
            subscriptionId: subscription.id,
            durationMonths,
            startsAt: contractStartsAt,
            endsAt: contractEndsAt,
            sessionsTotal: contractSessionsTotal,
            amountTotal: session.amount_total ?? 0,
            currency: session.currency ?? 'eur',
            legalPolicyVersion: completedIntent.legal_policy_version,
            policyAcceptedAt: completedIntent.policy_accepted_at,
        });

    if (!fulfillmentQueued) {
        console.error('[Webhook] Welcome fulfillment could not be queued');
        throw new Error('Welcome fulfillment could not be queued');
    }

    triggerFulfillmentProcessing(context, 5);
}

type CheckoutIntentForExpiration = Pick<
    Database['public']['Tables']['checkout_intents']['Row'],
    'id' | 'opportunity_id' | 'student_id' | 'package_price_id' | 'stripe_checkout_session_id' | 'status'
>;

async function handleCheckoutExpired(
    supabaseAdmin: SupabaseClient<Database>,
    session: Stripe.Checkout.Session,
    stripeRuntime: StripeRuntimeContext
) {
    if (typeof session.id !== 'string' || !/^cs_[A-Za-z0-9_]+$/.test(session.id)) {
        throw new Error('Expired checkout has no valid Stripe Session ID');
    }
    if (typeof session.livemode !== 'boolean' || session.livemode !== stripeRuntime.livemode) {
        throw new Error('Expired checkout mode does not match this runtime');
    }

    const metadata = session.metadata ?? {};
    const checkoutIntentId = metadata.checkoutIntentId;
    const opportunityId = metadata.crmOpportunityId;
    const studentId = metadata.userId;
    const packagePriceId = metadata.packagePriceId;
    const hasAnyAppMetadata = [checkoutIntentId, opportunityId, studentId, packagePriceId]
        .some((value) => typeof value === 'string' && value.length > 0);
    const hasCompleteValidMetadata = [checkoutIntentId, opportunityId, studentId, packagePriceId]
        .every(isUuid);

    let intentQuery = supabaseAdmin
        .from('checkout_intents')
        .select('id, opportunity_id, student_id, package_price_id, stripe_checkout_session_id, status');
    intentQuery = isUuid(checkoutIntentId)
        ? intentQuery.eq('id', checkoutIntentId)
        : intentQuery.eq('stripe_checkout_session_id', session.id);
    const { data: matchingIntent, error: intentError } = await intentQuery.maybeSingle();
    if (intentError) throw intentError;

    if (!matchingIntent) {
        if (!hasAnyAppMetadata) {
            console.log(`[Webhook] Ignoring expired Checkout Session ${session.id} with no local intent or app metadata`);
            return;
        }
        throw new Error('Expired checkout carries app metadata but has no local checkout intent');
    }

    const intent = matchingIntent as CheckoutIntentForExpiration;
    if (!hasCompleteValidMetadata) {
        throw new Error('Expired local checkout is missing immutable authorization metadata');
    }
    if (
        intent.id !== checkoutIntentId
        || intent.opportunity_id !== opportunityId
        || intent.student_id !== studentId
        || intent.package_price_id !== packagePriceId
        || (
            intent.stripe_checkout_session_id !== null
            && intent.stripe_checkout_session_id !== session.id
        )
    ) {
        throw new Error('Expired checkout metadata does not match its local checkout intent');
    }
    if (intent.status === 'expired') {
        console.log(`[Webhook] Checkout intent ${intent.id} was already released`);
        return;
    }

    const { data: releasedIntent, error: releaseError } = await supabaseAdmin
        .rpc('release_expired_checkout_intent', {
            p_intent_id: intent.id,
            p_stripe_checkout_session_id: session.id,
        });
    if (
        releaseError
        || !releasedIntent
        || releasedIntent.id !== intent.id
        || releasedIntent.status !== 'expired'
    ) {
        throw releaseError ?? new Error('Expired checkout intent could not be released safely');
    }
}

// ============================================
// HANDLER: Upcoming recurring invoice notice
// ============================================
async function assertManagedSubscriptionOffer(
    supabaseAdmin: SupabaseClient<Database>,
    subscription: ManagedSubscription,
    stripeSubscription: Stripe.Subscription,
    stripeRuntime: StripeRuntimeContext
) {
    if (!subscription.package_price_id) {
        throw new Error('Managed Stripe subscription has no immutable package price');
    }
    const { data: packagePrice, error } = await supabaseAdmin
        .from('package_prices')
        .select('id, package_key, display_name, stripe_price_id, stripe_product_id, stripe_account_id, amount_cents, currency, stripe_livemode, duration_months')
        .eq('id', subscription.package_price_id)
        .single();
    if (error || !packagePrice) {
        throw new Error('Managed subscription package price could not be loaded');
    }

    const item = stripeSubscription.items.data[0];
    const price = item?.price;
    if (
        stripeSubscription.items.data.length !== 1
        || item?.quantity !== 1
        || !price
        || price.id !== packagePrice.stripe_price_id
        || stripePriceProductId(price) !== packagePrice.stripe_product_id
        || price.unit_amount !== packagePrice.amount_cents
        || price.currency !== packagePrice.currency
        || price.livemode !== packagePrice.stripe_livemode
        || packagePrice.stripe_account_id !== stripeRuntime.accountId
        || price.recurring?.interval !== 'month'
        || price.recurring.interval_count !== subscription.duration_months
        || packagePrice.duration_months !== subscription.duration_months
    ) {
        throw new Error('Stripe subscription offer does not match the immutable local contract');
    }
    return packagePrice;
}

async function resolveManagedInvoiceSubscription(
    supabaseAdmin: SupabaseClient<Database>,
    invoice: Stripe.Invoice,
    stripeSubscriptionId: string,
    eventDescription: string
): Promise<{
    subscription: ManagedSubscription;
    stripeSubscription: Stripe.Subscription;
} | null> {
    // The local Stripe subscription link is the identity authority. Looking it
    // up before reading Stripe metadata prevents mutable metadata from selecting
    // a different student record.
    const subscription = await findManagedSubscription(supabaseAdmin, {
        stripeSubscriptionId,
    });
    const stripeSubscription = await stripe.subscriptions.retrieve(stripeSubscriptionId);
    const metadataSources = invoiceBillingMetadata(invoice, stripeSubscription);
    const hasAppMetadata = metadataSources.some(containsAppBillingMetadata);

    if (!subscription) {
        if (hasAppMetadata) {
            throw new Error(`No managed subscription found for ${eventDescription} ${stripeSubscriptionId}`);
        }
        console.log(`[Webhook] Ignoring unrelated ${eventDescription} without app metadata`);
        return null;
    }

    const metadataUserIds = metadataSources
        .map((metadata) => metadata.userId)
        .filter((userId): userId is string => typeof userId === 'string' && userId.length > 0);
    if (metadataUserIds.some((userId) => userId !== subscription.student_id)) {
        throw new Error(`Stripe ${eventDescription} user metadata contradicts the local subscription owner`);
    }

    return { subscription, stripeSubscription };
}

async function handleInvoiceUpcoming(
    supabaseAdmin: SupabaseClient<Database>,
    event: Stripe.Event,
    invoice: Stripe.Invoice,
    context: APIContext,
    stripeRuntime: StripeRuntimeContext
) {
    const stripeSubscriptionId = invoiceSubscriptionId(invoice);
    if (!stripeSubscriptionId) {
        console.log('[Webhook] Upcoming invoice without subscription, skipping');
        return;
    }

    const resolved = await resolveManagedInvoiceSubscription(
        supabaseAdmin,
        invoice,
        stripeSubscriptionId,
        'upcoming invoice'
    );
    if (!resolved) return;
    const { subscription, stripeSubscription } = resolved;
    if (
        stripeSubscription.cancel_at_period_end
        || !['active', 'trialing'].includes(stripeSubscription.status)
    ) {
        console.log(`[Webhook] Subscription ${stripeSubscriptionId} is not renewing; skipping upcoming notice`);
        return;
    }

    const contractPrice = await assertManagedSubscriptionOffer(supabaseAdmin, subscription, stripeSubscription, stripeRuntime);

    const subscriptionItem = stripeSubscription.items.data[0];
    const periodEnd = Number.isInteger(subscriptionItem?.current_period_end)
        && (subscriptionItem?.current_period_end ?? 0) > 0
        ? subscriptionItem?.current_period_end
        : invoice.period_end;
    if (!Number.isInteger(periodEnd) || (periodEnd ?? 0) <= 0) {
        throw new Error('Upcoming Stripe invoice has no renewal date');
    }

    const durationMonths = subscription.duration_months;
    if (
        subscriptionItem?.price.recurring?.interval !== 'month'
        || subscriptionItem.price.recurring.interval_count !== durationMonths
    ) {
        throw new Error('Stripe upcoming invoice interval does not match the immutable subscription contract');
    }
    const renewalAt = new Date((periodEnd as number) * 1000).toISOString();
    const queued = await enqueueRenewalNotice(supabaseAdmin, {
        stripeEventId: event.id,
        stripeInvoiceId: typeof invoice.id === 'string' && invoice.id ? invoice.id : undefined,
        stripeSubscriptionId,
        userId: subscription.student_id,
        packageId: subscription.package_id,
        packageKey: contractPrice.package_key,
        packageDisplayName: contractPrice.display_name,
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
async function handleInvoicePaid(
    supabaseAdmin: SupabaseClient<Database>,
    invoice: Stripe.Invoice,
    stripeRuntime: StripeRuntimeContext
) {
    const stripeSubscriptionId = invoiceSubscriptionId(invoice);
    if (!stripeSubscriptionId) {
        console.log('[Webhook] Invoice without subscription, skipping');
        return;
    }

    const resolved = await resolveManagedInvoiceSubscription(
        supabaseAdmin,
        invoice,
        stripeSubscriptionId,
        'paid invoice'
    );
    if (!resolved) return;
    const { subscription, stripeSubscription } = resolved;
    const userId = subscription.student_id;

    // The initial invoice is provisioned atomically by checkout.session.completed,
    // but it still has to resolve to the same local subscription first.
    if (invoice.billing_reason === 'subscription_create') {
        console.log('[Webhook] Skipping initial invoice (handled by checkout.session.completed)');
        return;
    }

    if (!['active', 'trialing'].includes(stripeSubscription.status)) {
        throw new Error('Paid renewal belongs to a Stripe subscription that is not active');
    }
    const contractPrice = await assertManagedSubscriptionOffer(supabaseAdmin, subscription, stripeSubscription, stripeRuntime);
    const isCycleRenewal = invoice.billing_reason === 'subscription_cycle';
    if (
        isCycleRenewal
        && (
            invoice.currency !== contractPrice.currency
            || invoice.total !== contractPrice.amount_cents
        )
    ) {
        throw new Error('Stripe renewal invoice total does not match the immutable contract');
    }

    const paymentIntentId = (invoice.amount_paid ?? 0) > 0
        ? await requirePaidInvoicePaymentIntentId(invoice.id)
        : await paidInvoicePaymentIntentId(invoice.id);

    const subscriptionItem = stripeSubscription.items.data[0];
    const renewalMonths = subscription.duration_months;
    if (
        subscriptionItem?.price.recurring?.interval !== 'month'
        || subscriptionItem.price.recurring.interval_count !== renewalMonths
    ) {
        throw new Error('Stripe renewal interval does not match the immutable subscription contract');
    }
    const additionalSessions = subscription.contracted_sessions_per_period;
    const paymentDescription = isCycleRenewal
        ? `${renewalMonths}-month renewal`
        : `Subscription payment (${invoice.billing_reason ?? 'unknown reason'})`;

    // Reconcile the immutable invoice identity before changing quota. A corrupt
    // or conflicting local invoice row must fail closed without provisioning.
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

    let renewalApplied = false;
    let newEndsAt: Date | null = null;
    if (isCycleRenewal) {
        const currentPeriodEnd = subscriptionItem?.current_period_end;
        if (!Number.isInteger(currentPeriodEnd) || (currentPeriodEnd ?? 0) <= 0) {
            throw new Error('Stripe renewal subscription item has no current period end');
        }
        // Stripe is the deterministic billing-period source; the RPC applies it
        // only when it advances the local contract.
        newEndsAt = new Date((currentPeriodEnd as number) * 1000);
        const { data: applied, error: renewalError } = await supabaseAdmin.rpc('apply_subscription_renewal', {
            p_subscription_id: subscription.id,
            p_stripe_subscription_id: stripeSubscriptionId,
            p_stripe_invoice_id: invoice.id,
            p_new_ends_at: newEndsAt.toISOString().split('T')[0],
        });
        if (renewalError) {
            console.error('[Webhook] Error applying subscription renewal:', renewalError);
            throw new Error('Subscription renewal update failed');
        }
        renewalApplied = applied === true;
    }

    if (!isCycleRenewal || !renewalApplied || !newEndsAt) {
        console.log(`[Webhook] Invoice ${invoice.id} reconciled without resetting subscription quota`);
        return;
    }

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
async function handleInvoicePaymentFailed(
    supabaseAdmin: SupabaseClient<Database>,
    invoice: Stripe.Invoice,
    stripeRuntime: StripeRuntimeContext
) {
    const stripeSubscriptionId = invoiceSubscriptionId(invoice);
    if (!stripeSubscriptionId) {
        console.log('[Webhook] Failed invoice without subscription, skipping');
        return;
    }

    const resolved = await resolveManagedInvoiceSubscription(
        supabaseAdmin,
        invoice,
        stripeSubscriptionId,
        'failed invoice'
    );
    if (!resolved) return;
    const { subscription, stripeSubscription } = resolved;
    const userId = subscription.student_id;

    if (!['past_due', 'unpaid', 'incomplete', 'paused'].includes(stripeSubscription.status)) {
        console.log(`[Webhook] Ignoring stale payment-failed event; Stripe subscription is ${stripeSubscription.status}`);
        return;
    }
    await assertManagedSubscriptionOffer(supabaseAdmin, subscription, stripeSubscription, stripeRuntime);

    const failureMonths =
        stripeSubscription.items.data[0]?.price.recurring?.interval === 'month'
            ? stripeSubscription.items.data[0]?.price.recurring?.interval_count ?? 1
            : subscription.duration_months ?? 1;
    const paymentIntentId = await invoicePaymentIntentId(invoice.id);

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
    'id' | 'student_id' | 'subscription_id' | 'amount' | 'amount_refunded' | 'currency' | 'status'
>;

async function findLocalRefundPayment(
    supabaseAdmin: SupabaseClient<Database>,
    column: 'stripe_payment_intent_id' | 'stripe_invoice_id',
    value: string
): Promise<RefundPayment | null> {
    const { data, error } = await supabaseAdmin
        .from('payments')
        .select('id, student_id, subscription_id, amount, amount_refunded, currency, status')
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

const STRIPE_REFUND_PAGE_SIZE = 100;
const STRIPE_REFUND_MAX_PAGES = 10;

async function listAuthoritativeChargeRefunds(chargeId: string): Promise<Stripe.Refund[]> {
    const refunds: Stripe.Refund[] = [];
    const refundIds = new Set<string>();
    let startingAfter: string | undefined;

    for (let pageNumber = 0; pageNumber < STRIPE_REFUND_MAX_PAGES; pageNumber += 1) {
        const page = await stripe.refunds.list({
            charge: chargeId,
            limit: STRIPE_REFUND_PAGE_SIZE,
            ...(startingAfter ? { starting_after: startingAfter } : {}),
        });

        for (const refund of page.data) {
            if (!refund.id || refundIds.has(refund.id)) {
                throw new Error('Stripe refund list contains an ambiguous duplicate identifier');
            }
            refundIds.add(refund.id);
            refunds.push(refund);
        }

        if (!page.has_more) return refunds;

        const lastRefundId = page.data.at(-1)?.id;
        if (!lastRefundId) {
            throw new Error('Stripe refund pagination cannot advance deterministically');
        }
        startingAfter = lastRefundId;
    }

    throw new Error('Stripe refund pagination exceeded the bounded reconciliation limit');
}

async function resolveAuthoritativeRefund(
    charge: Stripe.Charge,
    paymentIntentId: string,
    requestedAmountRefunded: number,
    stripeRuntime: StripeRuntimeContext
): Promise<Stripe.Refund> {
    if (charge.livemode !== stripeRuntime.livemode) {
        throw new Error('Stripe refunded charge mode does not match this runtime');
    }

    const chargeCurrency = charge.currency?.toLowerCase();
    if (!charge.id || !chargeCurrency) {
        throw new Error('Stripe refunded charge identity is incomplete');
    }

    const authoritativeRefunds = await listAuthoritativeChargeRefunds(charge.id);
    const succeededRefunds: Stripe.Refund[] = [];

    for (const refund of authoritativeRefunds) {
        const refundChargeId = stripeObjectId(refund.charge);
        const refundPaymentIntentId = stripeObjectId(refund.payment_intent);
        const refundCurrency = refund.currency?.toLowerCase();

        if (refundChargeId !== charge.id) {
            throw new Error(`Stripe refund ${refund.id} belongs to an incompatible charge`);
        }
        if (refundPaymentIntentId !== paymentIntentId) {
            throw new Error(`Stripe refund ${refund.id} belongs to an incompatible PaymentIntent`);
        }
        if (refundCurrency !== chargeCurrency) {
            throw new Error(`Stripe refund ${refund.id} uses an incompatible currency`);
        }

        // Failed, canceled and still-pending refunds do not contribute to the
        // authoritative amount_refunded total. Their identities are still
        // checked above so an incoherent API response always fails closed.
        if (refund.status !== 'succeeded') continue;

        if (!Number.isSafeInteger(refund.amount) || refund.amount <= 0) {
            throw new Error(`Stripe refund ${refund.id} has an invalid amount`);
        }
        if (!Number.isSafeInteger(refund.created) || refund.created <= 0) {
            throw new Error(`Stripe refund ${refund.id} has an invalid creation timestamp`);
        }
        succeededRefunds.push(refund);
    }

    succeededRefunds.sort((left, right) => (
        left.created - right.created
        || left.id.localeCompare(right.id, 'en')
    ));

    let cumulativeAmount = 0;
    for (let cohortStart = 0; cohortStart < succeededRefunds.length;) {
        const cohortCreated = succeededRefunds[cohortStart].created;
        let cohortEnd = cohortStart;
        let cohortAmount = 0;

        while (
            cohortEnd < succeededRefunds.length
            && succeededRefunds[cohortEnd].created === cohortCreated
        ) {
            cohortAmount += succeededRefunds[cohortEnd].amount;
            cohortEnd += 1;
        }

        const cohortBoundaryAmount = cumulativeAmount + cohortAmount;
        if (requestedAmountRefunded === cohortBoundaryAmount) {
            // IDs give a deterministic representative only after the complete
            // timestamp cohort has been accounted for.
            return succeededRefunds[cohortEnd - 1];
        }
        if (
            requestedAmountRefunded > cumulativeAmount
            && requestedAmountRefunded < cohortBoundaryAmount
        ) {
            throw new Error('Stripe refund amount lands inside an ambiguous same-second cohort');
        }
        if (requestedAmountRefunded < cohortBoundaryAmount) break;

        cumulativeAmount = cohortBoundaryAmount;
        cohortStart = cohortEnd;
    }

    throw new Error('Stripe succeeded refunds do not exactly match charge.amount_refunded');
}

// ============================================
// HANDLER: Full or partial refund synchronized from Stripe
// ============================================
async function handleChargeRefunded(
    supabaseAdmin: SupabaseClient<Database>,
    charge: Stripe.Charge,
    stripeRuntime: StripeRuntimeContext
) {
    const paymentIntentId = stripeObjectId(charge.payment_intent);

    if (!paymentIntentId) {
        console.log('[Webhook] Refunded charge has no payment intent; skipping payment reconciliation');
        return;
    }

    const payment = await findRefundPaymentByPaymentIntent(supabaseAdmin, paymentIntentId);
    if (!payment) {
        throw new Error(`No local payment found for refunded PaymentIntent ${paymentIntentId}`);
    }

    const requestedAmountRefunded = charge.amount_refunded;
    const chargeCurrency = charge.currency?.toLowerCase();
    const paymentCurrency = payment.currency?.toLowerCase();
    if (
        !Number.isSafeInteger(charge.amount)
        || charge.amount <= 0
        || charge.amount !== payment.amount
        || !Number.isSafeInteger(requestedAmountRefunded)
        || requestedAmountRefunded <= 0
        || requestedAmountRefunded > charge.amount
        || chargeCurrency !== paymentCurrency
    ) {
        throw new Error('Stripe refunded charge conflicts with the local payment');
    }

    // charge.refunds is only a compatibility expansion and can be empty or
    // truncated. The charge-filtered Refunds API is the verified authority.
    const authoritativeRefund = await resolveAuthoritativeRefund(
        charge,
        paymentIntentId,
        requestedAmountRefunded,
        stripeRuntime
    );
    const refundedAt = new Date(authoritativeRefund.created * 1000).toISOString();

    const { data: reconciledPayment, error: updateError } = await supabaseAdmin
        .rpc('reconcile_stripe_refund', {
            p_payment_id: payment.id,
            p_amount_refunded: requestedAmountRefunded,
            p_stripe_refund_id: authoritativeRefund.id,
            p_refunded_at: refundedAt,
        });
    if (updateError || !reconciledPayment) throw updateError ?? new Error('Refund reconciliation returned no payment');

    const amountRefunded = reconciledPayment.amount_refunded ?? 0;
    const fullyRefunded = reconciledPayment.status === 'refunded';

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
            stripe_refund_id: reconciledPayment.stripe_refund_id,
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
        if (userId) {
            throw new Error(`No managed subscription found for deleted Stripe subscription ${stripeSubscriptionId}`);
        }
        console.log('[Webhook] Ignoring unrelated deleted subscription without app metadata');
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
    const currentSubscription = await stripe.subscriptions.retrieve(stripeSubscriptionId);
    const userId = currentSubscription.metadata?.userId;

    if (!userId && !stripeSubscriptionId) {
        console.error('[Webhook] No identifiers in subscription update payload');
        return;
    }

    const managedSubscription = await findManagedSubscription(supabaseAdmin, {
        stripeSubscriptionId,
        userId,
    });

    if (!managedSubscription) {
        if (userId) {
            throw new Error(`No managed subscription found for Stripe update ${stripeSubscriptionId}`);
        }
        console.log('[Webhook] Ignoring unrelated subscription update without app metadata');
        return;
    }

    const mappedStatus = mapStripeSubscriptionStatus(currentSubscription.status);
    if (!mappedStatus) {
        console.log(`[Webhook] Ignoring unmapped subscription status: ${currentSubscription.status}`);
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

    console.log(`[Webhook] Subscription ${managedSubscription.id} mapped from Stripe status ${currentSubscription.status} to ${mappedStatus}`);
}

type ManagedSubscription = Pick<
    Database['public']['Tables']['subscriptions']['Row'],
    'id' | 'student_id' | 'package_id' | 'package_price_id' | 'sessions_total' | 'contracted_sessions_per_period' | 'duration_months' | 'ends_at' | 'status' | 'stripe_subscription_id' | 'stripe_invoice_id'
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
            .select('id, student_id, package_id, package_price_id, sessions_total, contracted_sessions_per_period, duration_months, ends_at, status, stripe_subscription_id, stripe_invoice_id')
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

        // A Stripe event carrying a subscription ID must never fall back to a
        // different local subscription merely because the user metadata matches.
        return null;
    }

    if (!options.userId) {
        return null;
    }

    const { data, error } = await supabaseAdmin
        .from('subscriptions')
        .select('id, student_id, package_id, package_price_id, sessions_total, contracted_sessions_per_period, duration_months, ends_at, status, stripe_subscription_id, stripe_invoice_id')
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
