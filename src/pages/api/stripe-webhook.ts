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
    'contractSchemaVersion',
    'slotPublicId',
    'firstClassAt',
    'renewalAnchorAt',
    'initialPriceId',
    'recurringPriceId',
] as const;

const CHECKOUT_V2_CONTRACT_SCHEMA_VERSION = '2';
const CHECKOUT_V2_AMOUNT_CENTS = 25_900;
const CHECKOUT_V2_INTERVAL_HOURS = 672;
const CHECKOUT_V2_INTERVAL_SECONDS = CHECKOUT_V2_INTERVAL_HOURS * 60 * 60;

function isCheckoutV2Metadata(metadata: Stripe.Metadata | null | undefined): boolean {
    return metadata?.contractSchemaVersion === CHECKOUT_V2_CONTRACT_SCHEMA_VERSION;
}

function requireStripeTimestamp(value: string | undefined, field: string): number {
    if (!value) throw new Error(`Checkout V2 metadata is missing ${field}`);
    const milliseconds = Date.parse(value);
    if (!Number.isFinite(milliseconds) || milliseconds % 1000 !== 0) {
        throw new Error(`Checkout V2 metadata has invalid ${field}`);
    }
    return milliseconds / 1000;
}

function localDateForInstant(instant: Date, timezone: string): string {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).formatToParts(instant);
    const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    if (!value.year || !value.month || !value.day) {
        throw new Error('Checkout V2 first-class date could not be localized');
    }
    return `${value.year}-${value.month}-${value.day}`;
}

function addUtcDaysToDate(date: string, days: number): string {
    const parsed = new Date(`${date}T00:00:00.000Z`);
    if (Number.isNaN(parsed.getTime())) throw new Error('Checkout V2 local contract date is invalid');
    parsed.setUTCDate(parsed.getUTCDate() + days);
    return parsed.toISOString().slice(0, 10);
}

type StripeInvoiceLineCompat = Stripe.InvoiceLineItem & {
    price?: Stripe.Price | null;
    proration?: boolean;
    discount_amounts?: unknown[];
    discounts?: unknown[];
    pretax_credit_amounts?: unknown[];
    taxes?: unknown[];
    pricing?: {
        price_details?: {
            price?: string | Stripe.Price | null;
        } | null;
    } | null;
    parent?: {
        subscription_item_details?: {
            proration?: boolean;
        } | null;
    } | null;
};

function invoiceLinePriceId(line: StripeInvoiceLineCompat): string | null {
    const price = line.pricing?.price_details?.price ?? line.price;
    return stripeObjectId(price);
}

function expandedInvoiceLinePrice(line: StripeInvoiceLineCompat): Stripe.Price | null {
    const price = line.pricing?.price_details?.price ?? line.price;
    return price && typeof price !== 'string' ? price : null;
}

function invoiceLineIsProration(line: StripeInvoiceLineCompat): boolean {
    return line.parent?.subscription_item_details?.proration === true || line.proration === true;
}

function invoiceLineHasAdjustments(line: StripeInvoiceLineCompat): boolean {
    return (line.discount_amounts?.length ?? 0) > 0
        || (line.discounts?.length ?? 0) > 0
        || (line.pretax_credit_amounts?.length ?? 0) > 0
        || (line.taxes?.length ?? 0) > 0;
}

function stripePriceMatchesCheckoutV2(input: {
    price: Stripe.Price | null;
    priceId: string;
    productId: string;
    livemode: boolean;
    recurring: boolean;
}): boolean {
    const { price } = input;
    if (
        !price
        || price.id !== input.priceId
        || price.unit_amount !== CHECKOUT_V2_AMOUNT_CENTS
        || price.currency !== PACKAGE_CURRENCY
        || price.livemode !== input.livemode
        || stripePriceProductId(price) !== input.productId
    ) return false;

    return input.recurring
        ? price.recurring?.interval === 'day' && price.recurring.interval_count === 28
        : price.recurring === null;
}

function exactCheckoutV2InitialInvoiceLines(input: {
    lines: StripeInvoiceLineCompat[];
    initialPriceId: string;
    recurringPriceId: string;
    productId: string;
    renewalAnchorAt: number;
    livemode: boolean;
}): boolean {
    if (input.lines.length < 1 || input.lines.length > 2) return false;
    const initialLines = input.lines.filter((line) => invoiceLinePriceId(line) === input.initialPriceId);
    const recurringLines = input.lines.filter((line) => invoiceLinePriceId(line) === input.recurringPriceId);
    if (initialLines.length !== 1 || recurringLines.length > 1) return false;
    if (initialLines.length + recurringLines.length !== input.lines.length) return false;

    const initialLine = initialLines[0];
    if (
        initialLine.quantity !== 1
        || initialLine.amount !== CHECKOUT_V2_AMOUNT_CENTS
        || initialLine.currency !== PACKAGE_CURRENCY
        || invoiceLineIsProration(initialLine)
        || invoiceLineHasAdjustments(initialLine)
        || !stripePriceMatchesCheckoutV2({
            price: expandedInvoiceLinePrice(initialLine),
            priceId: input.initialPriceId,
            productId: input.productId,
            livemode: input.livemode,
            recurring: false,
        })
    ) return false;

    const recurringLine = recurringLines[0];
    if (!recurringLine) return true;
    const periodStart = recurringLine.period?.start;
    const periodEnd = recurringLine.period?.end;
    return recurringLine.quantity === 1
        && recurringLine.amount === 0
        && recurringLine.currency === PACKAGE_CURRENCY
        && !invoiceLineIsProration(recurringLine)
        && !invoiceLineHasAdjustments(recurringLine)
        && Number.isInteger(periodStart)
        && Number.isInteger(periodEnd)
        && (periodStart as number) < (periodEnd as number)
        && periodEnd === input.renewalAnchorAt
        && stripePriceMatchesCheckoutV2({
            price: expandedInvoiceLinePrice(recurringLine),
            priceId: input.recurringPriceId,
            productId: input.productId,
            livemode: input.livemode,
            recurring: true,
        });
}

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

type CheckoutV2Subscription = Pick<
    Database['public']['Tables']['subscriptions']['Row'],
    'id' | 'student_id' | 'package_id' | 'package_price_id' | 'checkout_intent_id'
    | 'contract_schema_version' | 'duration_months' | 'billing_interval_unit'
    | 'billing_interval_count' | 'class_duration_minutes' | 'starts_at' | 'ends_at'
    | 'sessions_total' | 'contracted_sessions_per_period' | 'sessions_used'
    | 'status' | 'stripe_subscription_id' | 'stripe_invoice_id'
>;

async function findOrCreateCheckoutV2Subscription(
    supabaseAdmin: SupabaseClient<Database>,
    input: SubscriptionInsert & { stripe_subscription_id: string; checkout_intent_id: string }
): Promise<CheckoutV2Subscription> {
    const selection = 'id, student_id, package_id, package_price_id, checkout_intent_id, contract_schema_version, duration_months, billing_interval_unit, billing_interval_count, class_duration_minutes, starts_at, ends_at, sessions_total, contracted_sessions_per_period, sessions_used, status, stripe_subscription_id, stripe_invoice_id';
    const { data: existing, error: lookupError } = await supabaseAdmin
        .from('subscriptions')
        .select(selection)
        .eq('stripe_subscription_id', input.stripe_subscription_id)
        .limit(1)
        .maybeSingle();

    if (lookupError) throw lookupError;
    if (existing) {
        const expected = input as Required<Pick<
            SubscriptionInsert,
            'student_id' | 'package_id' | 'package_price_id' | 'checkout_intent_id'
            | 'contract_schema_version' | 'duration_months' | 'billing_interval_unit'
            | 'billing_interval_count' | 'class_duration_minutes' | 'starts_at' | 'ends_at'
            | 'sessions_total' | 'contracted_sessions_per_period' | 'sessions_used'
            | 'status' | 'stripe_subscription_id' | 'stripe_invoice_id'
        >>;
        if (
            existing.student_id !== expected.student_id
            || existing.package_id !== expected.package_id
            || existing.package_price_id !== expected.package_price_id
            || existing.checkout_intent_id !== expected.checkout_intent_id
            || existing.contract_schema_version !== expected.contract_schema_version
            || existing.duration_months !== expected.duration_months
            || existing.billing_interval_unit !== expected.billing_interval_unit
            || existing.billing_interval_count !== expected.billing_interval_count
            || existing.class_duration_minutes !== expected.class_duration_minutes
            || existing.starts_at !== expected.starts_at
            || existing.ends_at !== expected.ends_at
            || existing.sessions_total !== expected.sessions_total
            || existing.contracted_sessions_per_period !== expected.contracted_sessions_per_period
            || existing.stripe_subscription_id !== expected.stripe_subscription_id
            || existing.stripe_invoice_id !== expected.stripe_invoice_id
            || ![0, 4].includes(existing.sessions_used ?? -1)
            || existing.status !== 'active'
        ) {
            throw new Error('Stripe subscription is already linked to incompatible Checkout V2 data');
        }
        return existing as CheckoutV2Subscription;
    }

    const { data, error } = await supabaseAdmin
        .from('subscriptions')
        .insert(input)
        .select(selection)
        .single();
    if (error || !data) throw error ?? new Error('Checkout V2 subscription insert returned no row');
    return data as CheckoutV2Subscription;
}

async function listAllCheckoutLineItems(sessionId: string): Promise<Stripe.LineItem[]> {
    const items: Stripe.LineItem[] = [];
    let startingAfter: string | undefined;
    for (let page = 0; page < 2; page += 1) {
        const response = await stripe.checkout.sessions.listLineItems(sessionId, {
            limit: 100,
            expand: ['data.price.product'],
            ...(startingAfter ? { starting_after: startingAfter } : {}),
        });
        items.push(...response.data);
        if (!response.has_more) return items;
        startingAfter = response.data.at(-1)?.id;
        if (!startingAfter) throw new Error('Checkout V2 line-item pagination cannot advance');
    }
    throw new Error('Checkout V2 has unexpectedly many line items');
}

async function listAllInvoiceLines(invoice: Stripe.Invoice): Promise<StripeInvoiceLineCompat[]> {
    const initialLines = invoice.lines?.data as StripeInvoiceLineCompat[] | undefined;
    if (!invoice.lines?.has_more) return initialLines ?? [];

    const lines: StripeInvoiceLineCompat[] = [];
    let startingAfter: string | undefined;
    for (let page = 0; page < 10; page += 1) {
        const response = await stripe.invoices.listLineItems(invoice.id, {
            limit: 100,
            expand: ['data.pricing.price_details.price'],
            ...(startingAfter ? { starting_after: startingAfter } : {}),
        });
        lines.push(...response.data as StripeInvoiceLineCompat[]);
        if (!response.has_more) return lines;
        startingAfter = response.data.at(-1)?.id;
        if (!startingAfter) throw new Error('Stripe invoice line pagination cannot advance');
    }
    throw new Error('Stripe invoice line pagination exceeded the bounded limit');
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
async function handleCheckoutV2Completed(
    supabaseAdmin: SupabaseClient<Database>,
    session: Stripe.Checkout.Session,
    stripeSubscription: Stripe.Subscription,
    metadata: Stripe.Metadata,
    context: APIContext,
    stripeRuntime: StripeRuntimeContext
) {
    const userId = metadata.userId;
    const packageId = metadata.packageId;
    const packagePriceId = metadata.packagePriceId;
    const crmOpportunityId = metadata.crmOpportunityId;
    const checkoutIntentId = metadata.checkoutIntentId;
    const slotPublicId = metadata.slotPublicId;
    const initialPriceId = metadata.initialPriceId;
    const recurringPriceId = metadata.recurringPriceId;
    if (
        !isUuid(userId) || !isUuid(packageId) || !isUuid(packagePriceId)
        || !isUuid(crmOpportunityId) || !isUuid(checkoutIntentId) || !isUuid(slotPublicId)
        || !isStripePriceId(initialPriceId) || !isStripePriceId(recurringPriceId)
        || initialPriceId === recurringPriceId
    ) {
        throw new Error('Checkout V2 is missing immutable purchase metadata');
    }

    if (session.mode !== 'subscription' || session.payment_status !== 'paid') {
        throw new Error('Checkout V2 must be a paid subscription-mode Session');
    }
    if (typeof session.livemode !== 'boolean' || session.livemode !== stripeRuntime.livemode) {
        throw new Error('Checkout V2 Session mode does not match this runtime');
    }
    const stripeSubscriptionId = stripeObjectId(session.subscription);
    const stripeInvoiceId = stripeObjectId(session.invoice);
    const sessionCustomerId = stripeObjectId(session.customer);
    const subscriptionCustomerId = stripeObjectId(stripeSubscription.customer);
    if (!stripeSubscriptionId || stripeSubscription.id !== stripeSubscriptionId || !stripeInvoiceId) {
        throw new Error('Checkout V2 has incomplete Stripe subscription or invoice identity');
    }
    if (
        !isStripeCustomerId(sessionCustomerId)
        || sessionCustomerId !== subscriptionCustomerId
        || stripeSubscription.status !== 'trialing'
        || stripeSubscription.livemode !== stripeRuntime.livemode
    ) {
        throw new Error('Checkout V2 Customer, mode or technical-trial state is invalid');
    }

    const firstClassAt = requireStripeTimestamp(metadata.firstClassAt, 'firstClassAt');
    const renewalAnchorAt = requireStripeTimestamp(metadata.renewalAnchorAt, 'renewalAnchorAt');
    if (renewalAnchorAt !== firstClassAt + CHECKOUT_V2_INTERVAL_SECONDS) {
        throw new Error('Checkout V2 renewal anchor is not exactly 672 hours after the first class');
    }
    const subscriptionItem = stripeSubscription.items.data[0];
    if (
        stripeSubscription.items.data.length !== 1
        || subscriptionItem?.quantity !== 1
        || subscriptionItem.price.id !== recurringPriceId
        || subscriptionItem.price.unit_amount !== CHECKOUT_V2_AMOUNT_CENTS
        || subscriptionItem.price.currency !== PACKAGE_CURRENCY
        || subscriptionItem.price.livemode !== stripeRuntime.livemode
        || subscriptionItem.price.recurring?.interval !== 'day'
        || subscriptionItem.price.recurring.interval_count !== 28
        || stripeSubscription.trial_end !== renewalAnchorAt
        || subscriptionItem.current_period_end !== renewalAnchorAt
    ) {
        throw new Error('Checkout V2 subscription Price or renewal anchor is invalid');
    }

    const [lineItems, authoritativeInvoice, packagePriceResult, snapshotResult, slotResult] = await Promise.all([
        listAllCheckoutLineItems(session.id),
        stripe.invoices.retrieve(stripeInvoiceId, {
            expand: ['lines.data.pricing.price_details.price'],
        }),
        supabaseAdmin
            .from('package_prices')
            .select('*')
            .eq('id', packagePriceId)
            .single(),
        supabaseAdmin
            .from('checkout_v2_price_snapshots')
            .select('*')
            .eq('package_price_id', packagePriceId)
            .single(),
        supabaseAdmin
            .from('bookable_slots')
            .select('id, public_id, package_id, first_occurrence_at, timezone_name, status, sold_subscription_id')
            .eq('public_id', slotPublicId)
            .single(),
    ]);
    const packagePrice = packagePriceResult.data;
    const snapshot = snapshotResult.data;
    const slot = slotResult.data;
    if (packagePriceResult.error || !packagePrice || snapshotResult.error || !snapshot || slotResult.error || !slot) {
        throw new Error('Checkout V2 local offer, price snapshot or slot could not be loaded');
    }
    if (
        packagePrice.id !== packagePriceId
        || packagePrice.package_id !== packageId
        || packagePrice.contract_schema_version !== 2
        || packagePrice.amount_cents !== CHECKOUT_V2_AMOUNT_CENTS
        || packagePrice.currency !== PACKAGE_CURRENCY
        || packagePrice.sessions_per_period !== 4
        || packagePrice.billing_interval_unit !== 'day'
        || packagePrice.billing_interval_count !== 28
        || packagePrice.class_duration_minutes !== 50
        || packagePrice.stripe_price_id !== recurringPriceId
        || packagePrice.stripe_account_id !== stripeRuntime.accountId
        || packagePrice.stripe_livemode !== stripeRuntime.livemode
        || snapshot.package_price_id !== packagePriceId
        || snapshot.initial_stripe_price_id !== initialPriceId
        || snapshot.recurring_stripe_price_id !== recurringPriceId
        || snapshot.initial_amount_cents !== CHECKOUT_V2_AMOUNT_CENTS
        || snapshot.recurring_amount_cents !== CHECKOUT_V2_AMOUNT_CENTS
        || snapshot.currency !== PACKAGE_CURRENCY
        || snapshot.recurring_interval_unit !== 'day'
        || snapshot.recurring_interval_count !== 28
        || snapshot.stripe_account_id !== stripeRuntime.accountId
        || snapshot.stripe_livemode !== stripeRuntime.livemode
        || !isUuid(slot.id)
        || slot.public_id !== slotPublicId
        || slot.package_id !== packageId
        || !['available', 'sold'].includes(slot.status)
        || Date.parse(slot.first_occurrence_at) / 1000 !== firstClassAt
    ) {
        throw new Error('Checkout V2 Stripe purchase does not match its immutable local snapshot');
    }

    if (lineItems.length !== 2) throw new Error('Checkout V2 must contain exactly two line items');
    const prices = lineItems.map((line) => line.price);
    const initialPrice = prices.find((price) => price?.id === initialPriceId);
    const recurringPrice = prices.find((price) => price?.id === recurringPriceId);
    if (
        lineItems.some((line) => line.quantity !== 1)
        || !initialPrice || !recurringPrice
        || initialPrice.recurring !== null
        || initialPrice.unit_amount !== CHECKOUT_V2_AMOUNT_CENTS
        || initialPrice.currency !== PACKAGE_CURRENCY
        || initialPrice.livemode !== stripeRuntime.livemode
        || stripePriceProductId(initialPrice) !== packagePrice.stripe_product_id
        || recurringPrice.recurring?.interval !== 'day'
        || recurringPrice.recurring.interval_count !== 28
        || recurringPrice.unit_amount !== CHECKOUT_V2_AMOUNT_CENTS
        || recurringPrice.currency !== PACKAGE_CURRENCY
        || recurringPrice.livemode !== stripeRuntime.livemode
        || stripePriceProductId(recurringPrice) !== packagePrice.stripe_product_id
        || session.amount_total !== CHECKOUT_V2_AMOUNT_CENTS
        || session.currency !== PACKAGE_CURRENCY
    ) {
        throw new Error('Checkout V2 line items do not match the immutable Price pair');
    }

    const initialInvoiceLines = await listAllInvoiceLines(authoritativeInvoice);
    if (
        authoritativeInvoice.id !== stripeInvoiceId
        || authoritativeInvoice.status !== 'paid'
        || authoritativeInvoice.billing_reason !== 'subscription_create'
        || authoritativeInvoice.amount_paid !== CHECKOUT_V2_AMOUNT_CENTS
        || authoritativeInvoice.amount_due !== CHECKOUT_V2_AMOUNT_CENTS
        || authoritativeInvoice.amount_remaining !== 0
        || authoritativeInvoice.amount_overpaid !== 0
        || authoritativeInvoice.starting_balance !== 0
        || authoritativeInvoice.subtotal !== CHECKOUT_V2_AMOUNT_CENTS
        || authoritativeInvoice.subtotal_excluding_tax !== CHECKOUT_V2_AMOUNT_CENTS
        || authoritativeInvoice.total !== CHECKOUT_V2_AMOUNT_CENTS
        || authoritativeInvoice.total_excluding_tax !== CHECKOUT_V2_AMOUNT_CENTS
        || authoritativeInvoice.pre_payment_credit_notes_amount !== 0
        || authoritativeInvoice.post_payment_credit_notes_amount !== 0
        || (authoritativeInvoice.total_discount_amounts?.length ?? 0) !== 0
        || (authoritativeInvoice.total_pretax_credit_amounts?.length ?? 0) !== 0
        || (authoritativeInvoice.total_taxes?.length ?? 0) !== 0
        || authoritativeInvoice.currency !== PACKAGE_CURRENCY
        || authoritativeInvoice.livemode !== stripeRuntime.livemode
        || invoiceSubscriptionId(authoritativeInvoice) !== stripeSubscriptionId
        || stripeObjectId(authoritativeInvoice.customer) !== sessionCustomerId
        || !exactCheckoutV2InitialInvoiceLines({
            lines: initialInvoiceLines,
            initialPriceId,
            recurringPriceId,
            productId: packagePrice.stripe_product_id,
            renewalAnchorAt,
            livemode: stripeRuntime.livemode,
        })
    ) {
        throw new Error('Checkout V2 initial invoice is not the exact paid 259 EUR invoice');
    }

    const paymentIntentId = await requirePaidInvoicePaymentIntentId(stripeInvoiceId);
    const { data: completedIntent, error: completedIntentError } = await supabaseAdmin.rpc('complete_checkout_intent', {
        p_intent_id: checkoutIntentId,
        p_opportunity_id: crmOpportunityId,
        p_student_id: userId,
        p_package_price_id: packagePriceId,
        p_stripe_checkout_session_id: session.id,
        p_stripe_customer_id: sessionCustomerId,
    });
    if (
        completedIntentError || !completedIntent || completedIntent.id !== checkoutIntentId
        || completedIntent.stripe_checkout_session_id !== session.id
        || completedIntent.stripe_customer_id !== sessionCustomerId
    ) {
        throw new Error('Checkout V2 does not match its authorized checkout intent');
    }

    const contractStartsAt = localDateForInstant(new Date(firstClassAt * 1000), slot.timezone_name);
    const contractEndsAt = addUtcDaysToDate(contractStartsAt, 28);
    const subscription = await findOrCreateCheckoutV2Subscription(supabaseAdmin, {
        student_id: userId,
        package_id: packageId,
        package_price_id: packagePriceId,
        checkout_intent_id: checkoutIntentId,
        contract_schema_version: 2,
        status: 'active',
        duration_months: null,
        billing_interval_unit: 'day',
        billing_interval_count: 28,
        class_duration_minutes: 50,
        starts_at: contractStartsAt,
        ends_at: contractEndsAt,
        sessions_total: 4,
        contracted_sessions_per_period: 4,
        sessions_used: 0,
        stripe_subscription_id: stripeSubscriptionId,
        stripe_invoice_id: stripeInvoiceId,
    });
    if (slot.status === 'sold' && slot.sold_subscription_id !== subscription.id) {
        throw new Error('Checkout V2 sold slot belongs to a different subscription');
    }
    const paymentDescription = `${packagePrice.package_key} - Initial Checkout V2 cycle`;
    const payment = await persistInvoicePayment(supabaseAdmin, {
        student_id: userId,
        subscription_id: subscription.id,
        amount: CHECKOUT_V2_AMOUNT_CENTS,
        currency: PACKAGE_CURRENCY,
        status: 'succeeded',
        stripe_invoice_id: stripeInvoiceId,
        stripe_payment_intent_id: paymentIntentId,
        description: paymentDescription,
    });

    const { data: consumedHold, error: consumeError } = await supabaseAdmin.rpc('consume_bookable_slot_hold', {
        p_checkout_intent_id: checkoutIntentId,
        p_subscription_id: subscription.id,
    });
    if (consumeError || !consumedHold || consumedHold.slot_id !== slot.id || consumedHold.status !== 'consumed') {
        throw consumeError ?? new Error('Checkout V2 slot hold could not be consumed safely');
    }
    const { data: materializedSlot, error: materializeError } = await supabaseAdmin.rpc('materialize_bookable_slot_sessions', {
        p_slot_id: slot.id,
        p_subscription_id: subscription.id,
    });
    if (
        materializeError || !materializedSlot || materializedSlot.id !== slot.id
        || materializedSlot.status !== 'sold' || materializedSlot.sold_subscription_id !== subscription.id
        || !materializedSlot.sessions_materialized_at
    ) {
        throw materializeError ?? new Error('Checkout V2 initial sessions could not be materialized safely');
    }
    const { data: firstOccurrence, error: firstOccurrenceError } = await supabaseAdmin
        .from('bookable_slot_occurrences')
        .select('session_id, starts_at')
        .eq('slot_id', slot.id)
        .eq('occurrence_index', 1)
        .single();
    if (
        firstOccurrenceError || !firstOccurrence || !isUuid(firstOccurrence.session_id)
        || Date.parse(firstOccurrence.starts_at) / 1000 !== firstClassAt
    ) {
        throw new Error('Checkout V2 first materialized session is invalid');
    }
    const { data: billingState, error: billingError } = await supabaseAdmin.rpc('initialize_checkout_v2_billing', {
        p_subscription_id: subscription.id,
        p_first_session_id: firstOccurrence.session_id,
        p_initial_payment_id: payment.id,
        p_initial_stripe_price_id: initialPriceId,
        p_stripe_renewal_anchor_at: new Date(renewalAnchorAt * 1000).toISOString(),
    });
    if (
        billingError || !billingState || billingState.subscription_id !== subscription.id
        || billingState.first_session_id !== firstOccurrence.session_id
        || Date.parse(billingState.stripe_renewal_anchor_at) / 1000 !== renewalAnchorAt
    ) {
        throw billingError ?? new Error('Checkout V2 billing foundation could not be initialized safely');
    }

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
        .eq('preferred_package_id', packageId)
        .is('converted_subscription_id', null)
        .select('id')
        .maybeSingle();
    if (opportunityError) throw opportunityError;
    if (!convertedOpportunity) {
        const { data: alreadyConverted, error: lookupError } = await supabaseAdmin
            .from('crm_opportunities')
            .select('id')
            .eq('id', crmOpportunityId)
            .eq('converted_subscription_id', subscription.id)
            .maybeSingle();
        if (lookupError || !alreadyConverted) throw new Error('Checkout V2 could not consume its CRM approval');
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
            contract_schema_version: 2,
            amount: CHECKOUT_V2_AMOUNT_CENTS,
            currency: PACKAGE_CURRENCY,
            subscription_id: subscription.id,
            stripe_invoice_id: stripeInvoiceId,
            stripe_payment_intent_id: paymentIntentId,
        },
    });

    const { data: existingWelcomeJob, error: welcomeJobLookupError } = await supabaseAdmin
        .from('fulfillment_jobs')
        .select('id')
        .eq('job_type', 'welcome_fulfillment')
        .eq('subscription_id', subscription.id)
        .limit(1)
        .maybeSingle();
    if (welcomeJobLookupError) throw welcomeJobLookupError;
    const queued = existingWelcomeJob ? true : await enqueueWelcomeFulfillment(supabaseAdmin, {
        userId,
        packageId,
        packageKey: packagePrice.package_key,
        packageDisplayName: packagePrice.display_name,
        subscriptionId: subscription.id,
        startsAt: contractStartsAt,
        endsAt: contractEndsAt,
        sessionsTotal: 4,
        amountTotal: CHECKOUT_V2_AMOUNT_CENTS,
        currency: PACKAGE_CURRENCY,
        legalPolicyVersion: completedIntent.legal_policy_version,
        policyAcceptedAt: completedIntent.policy_accepted_at,
    });
    if (!queued) throw new Error('Checkout V2 welcome fulfillment could not be queued');
    triggerFulfillmentProcessing(context, 5);
}

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

    if (isCheckoutV2Metadata(metadata)) {
        if (!stripeSubscription) throw new Error('Checkout V2 could not retrieve its Stripe subscription');
        await handleCheckoutV2Completed(
            supabaseAdmin,
            session,
            stripeSubscription,
            metadata,
            context,
            stripeRuntime
        );
        return;
    }

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
    const checkoutV2 = isCheckoutV2Metadata(metadata);
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
    if (intent.status === 'expired' && !checkoutV2) {
        console.log(`[Webhook] Checkout intent ${intent.id} was already released`);
        return;
    }

    if (intent.status !== 'expired') {
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

    if (checkoutV2) {
        const metadataSlotPublicId = metadata.slotPublicId;
        if (!isUuid(metadataSlotPublicId)) throw new Error('Expired Checkout V2 is missing its slot binding');
        const { data: slot, error: slotError } = await supabaseAdmin
            .from('bookable_slots')
            .select('id, public_id')
            .eq('public_id', metadataSlotPublicId)
            .single();
        if (slotError || !slot || !isUuid(slot.id) || slot.public_id !== metadataSlotPublicId) {
            throw slotError ?? new Error('Expired Checkout V2 slot binding could not be resolved');
        }
        const { data: releasedHold, error: holdError } = await supabaseAdmin.rpc('release_bookable_slot_hold', {
            p_checkout_intent_id: intent.id,
            p_reason: 'stripe_checkout_session_expired',
        });
        if (
            holdError || !releasedHold || releasedHold.checkout_intent_id !== intent.id
            || releasedHold.slot_id !== slot.id
            || !['expired', 'released'].includes(releasedHold.status)
        ) {
            throw holdError ?? new Error('Expired Checkout V2 slot hold could not be released safely');
        }
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

    if (subscription.contract_schema_version === 2) {
        const { packagePrice } = await loadCheckoutV2RecurringSnapshot(
            supabaseAdmin,
            subscription,
            stripeSubscription,
            stripeRuntime
        );
        const subscriptionItem = stripeSubscription.items.data[0];
        const periodEnd = Number.isInteger(subscriptionItem?.current_period_end)
            && (subscriptionItem?.current_period_end ?? 0) > 0
            ? subscriptionItem.current_period_end
            : invoice.period_end;
        const amountDue = invoice.amount_due ?? invoice.total ?? 0;
        if (
            !Number.isInteger(periodEnd) || (periodEnd ?? 0) <= 0
            || invoice.currency !== PACKAGE_CURRENCY
            || amountDue !== CHECKOUT_V2_AMOUNT_CENTS
        ) {
            throw new Error('Upcoming Checkout V2 invoice does not match the exact 28-day renewal');
        }
        const renewalAt = new Date((periodEnd as number) * 1000).toISOString();
        const queued = await enqueueRenewalNotice(supabaseAdmin, {
            stripeEventId: event.id,
            stripeInvoiceId: typeof invoice.id === 'string' && invoice.id ? invoice.id : undefined,
            stripeSubscriptionId,
            userId: subscription.student_id,
            packageId: subscription.package_id,
            packageKey: packagePrice.package_key,
            packageDisplayName: packagePrice.display_name,
            subscriptionId: subscription.id,
            renewalAt,
            cancelBy: renewalAt,
            billingIntervalUnit: 'day',
            billingIntervalCount: 28,
            amountTotal: CHECKOUT_V2_AMOUNT_CENTS,
            currency: PACKAGE_CURRENCY,
        });
        if (!queued) throw new Error('Checkout V2 renewal notice fulfillment could not be queued');
        triggerFulfillmentProcessing(context, 5);
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
async function loadCheckoutV2RecurringSnapshot(
    supabaseAdmin: SupabaseClient<Database>,
    subscription: ManagedSubscription,
    stripeSubscription: Stripe.Subscription,
    stripeRuntime: StripeRuntimeContext
) {
    if (
        subscription.contract_schema_version !== 2
        || !subscription.package_price_id
        || subscription.duration_months !== null
        || subscription.billing_interval_unit !== 'day'
        || subscription.billing_interval_count !== 28
        || subscription.class_duration_minutes !== 50
        || subscription.sessions_total !== 4
        || subscription.contracted_sessions_per_period !== 4
    ) {
        throw new Error('Managed Checkout V2 subscription contract is invalid');
    }
    const [{ data: packagePrice, error: packagePriceError }, { data: snapshot, error: snapshotError }] = await Promise.all([
        supabaseAdmin
            .from('package_prices')
            .select('*')
            .eq('id', subscription.package_price_id)
            .single(),
        supabaseAdmin
            .from('checkout_v2_price_snapshots')
            .select('*')
            .eq('package_price_id', subscription.package_price_id)
            .single(),
    ]);
    if (packagePriceError || !packagePrice || snapshotError || !snapshot) {
        throw new Error('Checkout V2 recurring price snapshot could not be loaded');
    }
    const item = stripeSubscription.items.data[0];
    const price = item?.price;
    if (
        packagePrice.contract_schema_version !== 2
        || packagePrice.package_id !== subscription.package_id
        || packagePrice.stripe_price_id !== snapshot.recurring_stripe_price_id
        || packagePrice.amount_cents !== CHECKOUT_V2_AMOUNT_CENTS
        || packagePrice.currency !== PACKAGE_CURRENCY
        || packagePrice.stripe_account_id !== stripeRuntime.accountId
        || packagePrice.stripe_livemode !== stripeRuntime.livemode
        || snapshot.package_price_id !== subscription.package_price_id
        || snapshot.recurring_amount_cents !== CHECKOUT_V2_AMOUNT_CENTS
        || snapshot.currency !== PACKAGE_CURRENCY
        || snapshot.recurring_interval_unit !== 'day'
        || snapshot.recurring_interval_count !== 28
        || snapshot.stripe_account_id !== stripeRuntime.accountId
        || snapshot.stripe_livemode !== stripeRuntime.livemode
        || stripeSubscription.items.data.length !== 1
        || item?.quantity !== 1
        || !price
        || price.id !== snapshot.recurring_stripe_price_id
        || price.unit_amount !== CHECKOUT_V2_AMOUNT_CENTS
        || price.currency !== PACKAGE_CURRENCY
        || price.livemode !== stripeRuntime.livemode
        || price.recurring?.interval !== 'day'
        || price.recurring.interval_count !== 28
        || stripePriceProductId(price) !== packagePrice.stripe_product_id
    ) {
        throw new Error('Stripe Checkout V2 recurring offer does not match the immutable snapshot');
    }
    return { packagePrice, snapshot };
}

async function handleCheckoutV2InvoicePaid(
    supabaseAdmin: SupabaseClient<Database>,
    eventInvoice: Stripe.Invoice,
    subscription: ManagedSubscription,
    stripeSubscription: Stripe.Subscription,
    stripeRuntime: StripeRuntimeContext
) {
    if (eventInvoice.billing_reason === 'subscription_create') {
        console.log('[Webhook] Skipping Checkout V2 initial invoice (handled by checkout.session.completed)');
        return;
    }
    if (eventInvoice.billing_reason !== 'subscription_cycle') {
        throw new Error('Checkout V2 paid invoice is not an exact subscription cycle');
    }
    if (!['active', 'trialing'].includes(stripeSubscription.status)) {
        throw new Error('Checkout V2 paid renewal belongs to an inactive Stripe subscription');
    }
    const stripeSubscriptionId = invoiceSubscriptionId(eventInvoice);
    if (!stripeSubscriptionId || stripeSubscriptionId !== subscription.stripe_subscription_id) {
        throw new Error('Checkout V2 invoice subscription identity is invalid');
    }
    const { snapshot } = await loadCheckoutV2RecurringSnapshot(
        supabaseAdmin,
        subscription,
        stripeSubscription,
        stripeRuntime
    );
    const invoice = await stripe.invoices.retrieve(eventInvoice.id, {
        expand: ['lines.data.pricing.price_details.price'],
    });
    if (
        invoice.id !== eventInvoice.id
        || invoice.status !== 'paid'
        || invoice.billing_reason !== 'subscription_cycle'
        || invoiceSubscriptionId(invoice) !== stripeSubscriptionId
        || invoice.livemode !== stripeRuntime.livemode
        || invoice.currency !== PACKAGE_CURRENCY
        || invoice.amount_paid !== CHECKOUT_V2_AMOUNT_CENTS
        || invoice.amount_due !== CHECKOUT_V2_AMOUNT_CENTS
        || invoice.total !== CHECKOUT_V2_AMOUNT_CENTS
        || stripeObjectId(invoice.customer) !== stripeObjectId(stripeSubscription.customer)
    ) {
        throw new Error('Checkout V2 renewal invoice is not the exact paid 259 EUR cycle');
    }

    const lines = await listAllInvoiceLines(invoice);
    const recurringLines = lines.filter((line) => invoiceLinePriceId(line) === snapshot.recurring_stripe_price_id);
    if (
        recurringLines.length !== 1
        || lines.some((line) => invoiceLineIsProration(line))
        || lines.some((line) => {
            const amount = line.amount ?? 0;
            return line !== recurringLines[0] && amount !== 0;
        })
    ) {
        throw new Error('Checkout V2 renewal invoice lines are ambiguous or prorated');
    }
    const recurringLine = recurringLines[0];
    const periodStart = recurringLine.period?.start;
    const periodEnd = recurringLine.period?.end;
    if (
        recurringLine.quantity !== 1
        || recurringLine.amount !== CHECKOUT_V2_AMOUNT_CENTS
        || recurringLine.currency !== PACKAGE_CURRENCY
        || !Number.isInteger(periodStart) || !Number.isInteger(periodEnd)
        || (periodEnd as number) - (periodStart as number) !== CHECKOUT_V2_INTERVAL_SECONDS
    ) {
        throw new Error('Checkout V2 renewal line has an invalid amount, quantity or 672-hour period');
    }

    const paymentIntentId = await requirePaidInvoicePaymentIntentId(invoice.id);
    const paymentDescription = 'Checkout V2 renewal - 28 days';
    const payment = await persistInvoicePayment(supabaseAdmin, {
        student_id: subscription.student_id,
        subscription_id: subscription.id,
        amount: CHECKOUT_V2_AMOUNT_CENTS,
        currency: PACKAGE_CURRENCY,
        status: 'succeeded',
        stripe_invoice_id: invoice.id,
        stripe_payment_intent_id: paymentIntentId,
        description: paymentDescription,
    });

    const { data: billingState, error: billingLookupError } = await supabaseAdmin
        .from('checkout_v2_billing_state')
        .select('subscription_id, first_class_at, anchor_state')
        .eq('subscription_id', subscription.id)
        .single();
    if (billingLookupError || !billingState) {
        throw billingLookupError ?? new Error('Checkout V2 billing state could not be loaded');
    }
    if (billingState.anchor_state === 'provisional') {
        const firstClassAt = Date.parse(billingState.first_class_at);
        if (!Number.isFinite(firstClassAt) || Date.now() < firstClassAt) {
            throw new Error('Checkout V2 renewal arrived before its billing anchor could be fixed');
        }
        const { data: fixedState, error: fixError } = await supabaseAdmin.rpc('fix_checkout_v2_billing_anchor', {
            p_subscription_id: subscription.id,
            p_fixed_at: new Date(firstClassAt).toISOString(),
        });
        if (fixError || !fixedState || fixedState.anchor_state !== 'fixed') {
            throw fixError ?? new Error('Checkout V2 billing anchor could not be fixed before renewal');
        }
    } else if (billingState.anchor_state !== 'fixed') {
        throw new Error('Checkout V2 billing anchor has an unsupported state');
    }

    const renewalArgs = {
        p_subscription_id: subscription.id,
        p_stripe_subscription_id: stripeSubscriptionId,
        p_stripe_invoice_id: invoice.id,
        p_payment_id: payment.id,
        p_recurring_stripe_price_id: snapshot.recurring_stripe_price_id,
        p_period_start: new Date((periodStart as number) * 1000).toISOString(),
        p_period_end: new Date((periodEnd as number) * 1000).toISOString(),
    };
    const { data: applied, error: renewalError } = await supabaseAdmin.rpc('apply_checkout_v2_renewal', renewalArgs);
    if (renewalError || typeof applied !== 'boolean') {
        throw renewalError ?? new Error('Checkout V2 renewal update failed');
    }

    // A replay can observe the cycle already inserted while its four sessions
    // are still pending. Always invoke the idempotent materializer, even when
    // apply_checkout_v2_renewal returns false.
    const materializeRpc = supabaseAdmin.rpc as unknown as (
        name: 'materialize_checkout_v2_cycle_sessions',
        args: { p_subscription_id: string; p_stripe_invoice_id: string }
    ) => Promise<{ data: { id?: string; materialization_state?: string } | null; error: { message?: string } | null }>;
    const { data: materializedCycle, error: materializeError } = await materializeRpc(
        'materialize_checkout_v2_cycle_sessions',
        {
            p_subscription_id: subscription.id,
            p_stripe_invoice_id: invoice.id,
        }
    );
    if (materializeError || !materializedCycle || materializedCycle.materialization_state !== 'ready') {
        throw materializeError ?? new Error('Checkout V2 renewal sessions could not be materialized');
    }

    if (applied) {
        await recordCrmActivityForProfileSafe(supabaseAdmin, {
            profileId: subscription.student_id,
            lifecycleStage: 'customer',
            source: 'stripe',
            activityType: 'payment',
            subject: 'Renovacion pagada',
            body: paymentDescription,
            relatedEntityType: 'payment',
            relatedEntityId: payment.id,
            metadata: {
                contract_schema_version: 2,
                amount: CHECKOUT_V2_AMOUNT_CENTS,
                currency: PACKAGE_CURRENCY,
                subscription_id: subscription.id,
                stripe_invoice_id: invoice.id,
                stripe_payment_intent_id: paymentIntentId,
                period_start: renewalArgs.p_period_start,
                period_end: renewalArgs.p_period_end,
            },
        });
    }
    console.log(`[Webhook] Checkout V2 renewal ${invoice.id} reconciled and materialized`);
}

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

    if (subscription.contract_schema_version === 2) {
        await handleCheckoutV2InvoicePaid(
            supabaseAdmin,
            invoice,
            subscription,
            stripeSubscription,
            stripeRuntime
        );
        return;
    }

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
    const checkoutV2Failure = subscription.contract_schema_version === 2;
    if (checkoutV2Failure) {
        await loadCheckoutV2RecurringSnapshot(
            supabaseAdmin,
            subscription,
            stripeSubscription,
            stripeRuntime
        );
        const amountDue = invoice.amount_due ?? invoice.amount_remaining ?? invoice.total ?? 0;
        if (invoice.currency !== PACKAGE_CURRENCY || amountDue !== CHECKOUT_V2_AMOUNT_CENTS) {
            throw new Error('Failed Checkout V2 invoice does not match the exact 28-day renewal');
        }
    } else {
        await assertManagedSubscriptionOffer(supabaseAdmin, subscription, stripeSubscription, stripeRuntime);
    }

    const failureMonths = checkoutV2Failure
        ? null
        : stripeSubscription.items.data[0]?.price.recurring?.interval === 'month'
            ? stripeSubscription.items.data[0]?.price.recurring?.interval_count ?? 1
            : subscription.duration_months ?? 1;
    const paymentIntentId = await invoicePaymentIntentId(invoice.id);

    const paymentDescription = checkoutV2Failure
        ? '28-day payment failed'
        : `${failureMonths}-month payment failed`;

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
            ...(checkoutV2Failure
                ? { billing_interval_unit: 'day', billing_interval_count: 28 }
                : { failure_months: failureMonths }),
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
    'id' | 'student_id' | 'package_id' | 'package_price_id' | 'sessions_total'
    | 'contracted_sessions_per_period' | 'duration_months' | 'ends_at' | 'status'
    | 'stripe_subscription_id' | 'stripe_invoice_id' | 'contract_schema_version'
    | 'billing_interval_unit' | 'billing_interval_count' | 'class_duration_minutes'
>;

const MANAGED_SUBSCRIPTION_SELECTION = 'id, student_id, package_id, package_price_id, sessions_total, contracted_sessions_per_period, duration_months, ends_at, status, stripe_subscription_id, stripe_invoice_id, contract_schema_version, billing_interval_unit, billing_interval_count, class_duration_minutes';

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
            .select(MANAGED_SUBSCRIPTION_SELECTION)
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
        .select(MANAGED_SUBSCRIPTION_SELECTION)
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
