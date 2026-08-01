import type { APIRoute } from 'astro';
import type Stripe from 'stripe';
import {
    createCheckoutHoldFingerprint,
    normalizeCheckoutClientAddress,
} from './checkout-hold-fingerprint';
import { CHECKOUT_TERMS_VERSION, hasAcceptedCheckoutPolicies } from './legal-policy';
import {
    INITIAL_INDIVIDUAL_OFFER,
    isInitialIndividualOfferSnapshot,
    PACKAGE_CURRENCY,
} from './package-pricing';
import { getPrivateProfile, upsertPrivateProfile } from './profiles-private';
import { readRuntimeEnv } from './runtime-env';
import { getSiteUrl } from './site-url';
import { stripe } from './stripe';
import { validatedStripeCustomerId } from './stripe-customer';
import { assertStripePaymentReadiness, assertStripeRuntimeAccount } from './stripe-runtime-guard';
import { createSupabaseAdminClient } from './supabase-admin';
import { createSupabaseServerClient } from './supabase-server';
import { verifyCheckoutTurnstile } from './turnstile';
import type { Database } from '../types/database.types';

type CheckoutContext = Parameters<APIRoute>[0];
type CheckoutIntent = Database['public']['Tables']['checkout_intents']['Row'];
type BookableSlotHold = Database['public']['Tables']['bookable_slot_holds']['Row'];
type BookableSlot = Pick<
    Database['public']['Tables']['bookable_slots']['Row'],
    'id' | 'public_id' | 'package_id' | 'teacher_id' | 'status' | 'contract_schema_version'
    | 'first_occurrence_at' | 'timezone_name' | 'weekday' | 'local_start_time' | 'published_at'
    | 'sold_subscription_id'
>;
type PackagePrice = Database['public']['Tables']['package_prices']['Row'];
type PackageRow = Database['public']['Tables']['packages']['Row'];
type PriceSnapshot = Database['public']['Tables']['checkout_v2_price_snapshots']['Row'];

type CheckoutV2Request = {
    slotPublicId?: unknown;
    'cf-turnstile-response'?: unknown;
    lang?: unknown;
    adultConfirmed?: unknown;
    termsAccepted?: unknown;
    serviceStartRequested?: unknown;
    withdrawalLossAcknowledged?: unknown;
};

type DirectCheckoutClaimArgs = {
    p_student_id: string;
    p_primary_email: string;
    p_full_name: string | null;
    p_package_price_id: string;
    p_lang: string;
    p_legal_policy_version: string;
    p_site_url: string;
    p_slot_public_id: string;
    p_hold_fingerprint: string;
};

const jsonHeaders = { 'Content-Type': 'application/json' };
const supportedCheckoutLangs = new Set(['es', 'en', 'ru']);
const maxCheckoutSessionRecoveryPages = 100;
const checkoutV2ContractVersion = '2';
const renewalPeriodMs = 28 * 24 * 60 * 60 * 1000;
const stripeMinimumSessionLifetimeSeconds = 30 * 60;

function jsonResponse(payload: unknown, status: number): Response {
    return new Response(JSON.stringify(payload), { status, headers: jsonHeaders });
}

function normalizeCheckoutLang(value: unknown): 'es' | 'en' | 'ru' {
    return typeof value === 'string' && supportedCheckoutLangs.has(value)
        ? value as 'es' | 'en' | 'ru'
        : 'es';
}

function isUuid(value: unknown): value is string {
    return typeof value === 'string'
        && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function readCheckoutClientAddress(context: CheckoutContext): string | null {
    try {
        return normalizeCheckoutClientAddress(context.clientAddress);
    } catch {
        return null;
    }
}

function stripeProductId(product: string | Stripe.Product | Stripe.DeletedProduct): string {
    return typeof product === 'string' ? product : product.id;
}

function stripeCustomerId(customer: Stripe.Checkout.Session['customer']): string | null {
    if (!customer) return null;
    return typeof customer === 'string' ? customer : customer.id;
}

function allBalancesAreZero(balances: Record<string, number> | null | undefined): boolean {
    return Object.values(balances ?? {}).every((amount) => amount === 0);
}

async function stripeCustomerHasNoApplicableBalance(input: {
    customerId: string;
    runtimeLivemode: boolean;
}): Promise<boolean> {
    const [customer, cashBalance] = await Promise.all([
        stripe.customers.retrieve(input.customerId),
        stripe.customers.retrieveCashBalance(input.customerId),
    ]);

    return !customer.deleted
        && customer.id === input.customerId
        && customer.livemode === input.runtimeLivemode
        && customer.balance === 0
        && allBalancesAreZero(customer.invoice_credit_balance)
        && cashBalance.customer === input.customerId
        && cashBalance.livemode === input.runtimeLivemode
        && allBalancesAreZero(cashBalance.available);
}

function renewalAnchorFor(firstOccurrenceAt: string): { iso: string; unix: number } | null {
    const firstClassMs = Date.parse(firstOccurrenceAt);
    if (!Number.isFinite(firstClassMs) || firstClassMs % 1000 !== 0) return null;
    const anchorMs = firstClassMs + renewalPeriodMs;
    return { iso: new Date(anchorMs).toISOString(), unix: Math.floor(anchorMs / 1000) };
}

function checkoutSessionMatchesV2(input: {
    session: Stripe.Checkout.Session;
    runtimeLivemode: boolean;
    customerId: string;
    studentId: string;
    packageId: string;
    packagePriceId: string;
    opportunityId: string;
    checkoutIntentId: string;
    slotPublicId: string;
    initialPriceId: string;
    recurringPriceId: string;
    firstClassAt: string;
    renewalAnchorAt: string;
}): boolean {
    const { session } = input;
    const lineItems = session.line_items?.data ?? [];
    const expectedPriceIds = [input.initialPriceId, input.recurringPriceId].sort();
    const actualPriceIds = lineItems
        .filter((item) => item.quantity === 1 && item.price?.id)
        .map((item) => item.price!.id)
        .sort();

    return session.mode === 'subscription'
        && session.livemode === input.runtimeLivemode
        && stripeCustomerId(session.customer) === input.customerId
        && session.client_reference_id === input.studentId
        && session.amount_subtotal === INITIAL_INDIVIDUAL_OFFER.amountCents
        && session.amount_total === INITIAL_INDIVIDUAL_OFFER.amountCents
        && session.currency === PACKAGE_CURRENCY
        && (session.discounts?.length ?? 0) === 0
        && session.total_details?.amount_discount === 0
        && (session.total_details.amount_shipping ?? 0) === 0
        && session.total_details.amount_tax === 0
        && session.allow_promotion_codes === false
        && session.adaptive_pricing?.enabled === false
        && session.automatic_tax?.enabled === false
        && session.payment_method_types.length === 1
        && session.payment_method_types[0] === 'card'
        && lineItems.length === 2
        && actualPriceIds.length === 2
        && actualPriceIds[0] === expectedPriceIds[0]
        && actualPriceIds[1] === expectedPriceIds[1]
        && session.metadata?.contractSchemaVersion === checkoutV2ContractVersion
        && session.metadata.userId === input.studentId
        && session.metadata.packageId === input.packageId
        && session.metadata.packagePriceId === input.packagePriceId
        && session.metadata.crmOpportunityId === input.opportunityId
        && session.metadata.checkoutIntentId === input.checkoutIntentId
        && session.metadata.slotPublicId === input.slotPublicId
        && session.metadata.initialPriceId === input.initialPriceId
        && session.metadata.recurringPriceId === input.recurringPriceId
        && session.metadata.firstClassAt === input.firstClassAt
        && session.metadata.renewalAnchorAt === input.renewalAnchorAt;
}

async function listCheckoutSessionsForIntent(input: {
    customerId: string;
    checkoutIntentId: string;
}): Promise<Stripe.Checkout.Session[]> {
    const matches: Stripe.Checkout.Session[] = [];
    const seenCursors = new Set<string>();
    let startingAfter: string | undefined;

    for (let pageNumber = 0; pageNumber < maxCheckoutSessionRecoveryPages; pageNumber += 1) {
        const page = await stripe.checkout.sessions.list({
            customer: input.customerId,
            limit: 100,
            ...(startingAfter ? { starting_after: startingAfter } : {}),
        });
        matches.push(...page.data.filter((session) => (
            session.metadata?.checkoutIntentId === input.checkoutIntentId
        )));
        if (!page.has_more) return matches;

        const nextCursor = page.data.at(-1)?.id;
        if (!nextCursor || seenCursors.has(nextCursor)) {
            throw new Error('Stripe Checkout Session pagination did not make progress');
        }
        seenCursors.add(nextCursor);
        startingAfter = nextCursor;
    }
    throw new Error('Stripe Checkout Session recovery exceeded its safe pagination limit');
}

async function claimDirectCheckoutIntent(
    supabaseAdmin: ReturnType<typeof createSupabaseAdminClient>,
    args: DirectCheckoutClaimArgs,
): Promise<{ data: CheckoutIntent | null; error: unknown }> {
    const client = supabaseAdmin as unknown as {
        rpc(name: 'claim_direct_checkout_intent_for_slot', rpcArgs: DirectCheckoutClaimArgs): Promise<{
            data: CheckoutIntent | null;
            error: unknown;
        }>;
    };
    return client.rpc('claim_direct_checkout_intent_for_slot', args);
}

async function releaseV2CheckoutIntent(
    supabaseAdmin: ReturnType<typeof createSupabaseAdminClient>,
    intent: CheckoutIntent,
    sessionId: string,
): Promise<boolean> {
    const released = await supabaseAdmin.rpc('release_expired_checkout_intent', {
        p_intent_id: intent.id,
        p_stripe_checkout_session_id: sessionId,
    });
    if (released.error || !released.data || released.data.status !== 'expired') return false;

    const hold = await supabaseAdmin.rpc('release_bookable_slot_hold', {
        p_checkout_intent_id: intent.id,
        p_reason: 'stripe_checkout_expired',
    });
    return !hold.error && Boolean(hold.data);
}

async function releaseAbandonedV2CheckoutIntent(
    supabaseAdmin: ReturnType<typeof createSupabaseAdminClient>,
    intent: CheckoutIntent,
    customerId: string,
): Promise<boolean> {
    const released = await supabaseAdmin.rpc('release_abandoned_checkout_intent', {
        p_intent_id: intent.id,
        p_stripe_customer_id: customerId,
    });
    if (released.error || !released.data || released.data.status !== 'expired') return false;

    const hold = await supabaseAdmin.rpc('release_bookable_slot_hold', {
        p_checkout_intent_id: intent.id,
        p_reason: 'checkout_abandoned_without_stripe_session',
    });
    return !hold.error && Boolean(hold.data);
}

async function releaseExpiredV2Hold(
    supabaseAdmin: ReturnType<typeof createSupabaseAdminClient>,
    intent: CheckoutIntent,
): Promise<boolean> {
    const hold = await supabaseAdmin.rpc('release_bookable_slot_hold', {
        p_checkout_intent_id: intent.id,
        p_reason: 'checkout_intent_already_expired',
    });
    return !hold.error && Boolean(hold.data);
}

async function reconcileOneExpiredV2Hold(input: {
    supabaseAdmin: ReturnType<typeof createSupabaseAdminClient>;
    hold: BookableSlotHold;
    runtimeLivemode: boolean;
}): Promise<boolean> {
    const intentResult = await input.supabaseAdmin
        .from('checkout_intents')
        .select('*')
        .eq('id', input.hold.checkout_intent_id)
        .single();
    const intent = intentResult.data;
    const intentExpiresAt = intent ? Date.parse(intent.expires_at) : Number.NaN;
    if (
        intentResult.error
        || !intent
        || !Number.isFinite(intentExpiresAt)
        || intentExpiresAt > Date.now()
    ) return false;

    if (intent.status === 'expired') {
        return releaseExpiredV2Hold(input.supabaseAdmin, intent);
    }
    if (!['creating', 'open'].includes(intent.status) || !intent.stripe_customer_id) {
        return false;
    }

    const sessions = await listCheckoutSessionsForIntent({
        customerId: intent.stripe_customer_id,
        checkoutIntentId: intent.id,
    });
    if (sessions.length === 0) {
        return intent.status === 'creating'
            && intent.stripe_checkout_session_id === null
            && releaseAbandonedV2CheckoutIntent(
                input.supabaseAdmin,
                intent,
                intent.stripe_customer_id,
            );
    }
    if (sessions.length !== 1) return false;

    const session = await stripe.checkout.sessions.retrieve(sessions[0]!.id);
    if (
        session.status !== 'expired'
        || session.livemode !== input.runtimeLivemode
        || stripeCustomerId(session.customer) !== intent.stripe_customer_id
        || session.metadata?.checkoutIntentId !== intent.id
        || (
            intent.stripe_checkout_session_id !== null
            && intent.stripe_checkout_session_id !== session.id
        )
    ) return false;

    return releaseV2CheckoutIntent(input.supabaseAdmin, intent, session.id);
}

async function reconcileExpiredV2HoldConflicts(input: {
    supabaseAdmin: ReturnType<typeof createSupabaseAdminClient>;
    slotId: string;
    holdFingerprint: string;
    runtimeLivemode: boolean;
}): Promise<boolean> {
    const expiredBefore = new Date().toISOString();
    const [bySlot, byFingerprint] = await Promise.all([
        input.supabaseAdmin
            .from('bookable_slot_holds')
            .select('*')
            .eq('slot_id', input.slotId)
            .eq('status', 'held')
            .lte('expires_at', expiredBefore)
            .maybeSingle(),
        input.supabaseAdmin
            .from('bookable_slot_holds')
            .select('*')
            .eq('hold_fingerprint', input.holdFingerprint)
            .eq('status', 'held')
            .lte('expires_at', expiredBefore)
            .maybeSingle(),
    ]);
    if (bySlot.error || byFingerprint.error) return false;

    const holds = new Map<string, BookableSlotHold>();
    for (const hold of [bySlot.data, byFingerprint.data]) {
        if (hold) holds.set(hold.id, hold);
    }
    if (holds.size === 0) return false;

    for (const hold of holds.values()) {
        if (!await reconcileOneExpiredV2Hold({
            supabaseAdmin: input.supabaseAdmin,
            hold,
            runtimeLivemode: input.runtimeLivemode,
        })) return false;
    }
    return true;
}

async function loadCheckoutV2Offer(
    supabaseAdmin: ReturnType<typeof createSupabaseAdminClient>,
    slotPublicId: string,
): Promise<{
    slot: BookableSlot;
    packageRow: PackageRow;
    packagePrice: PackagePrice;
    priceSnapshot: PriceSnapshot;
} | null> {
    const { data: slot, error: slotError } = await supabaseAdmin
        .from('bookable_slots')
        .select('id, public_id, package_id, teacher_id, status, contract_schema_version, first_occurrence_at, timezone_name, weekday, local_start_time, published_at, sold_subscription_id')
        .eq('public_id', slotPublicId)
        .eq('contract_schema_version', 2)
        .eq('status', 'available')
        .not('published_at', 'is', null)
        .is('sold_subscription_id', null)
        .single();
    if (slotError || !slot) return null;

    const { data: packageRow, error: packageError } = await supabaseAdmin
        .from('packages')
        .select('*')
        .eq('id', slot.package_id)
        .eq('contract_schema_version', 2)
        .eq('is_active', true)
        .eq('is_publicly_listed', true)
        .single();
    if (packageError || !packageRow || !isInitialIndividualOfferSnapshot({
        contract_schema_version: packageRow.contract_schema_version,
        package_key: packageRow.name,
        amount_cents: packageRow.amount_cents ?? 0,
        currency: PACKAGE_CURRENCY,
        billing_interval_unit: packageRow.billing_interval_unit as 'day' | 'week' | 'month' | 'year' | null,
        billing_interval_count: packageRow.billing_interval_count,
        sessions_per_period: packageRow.sessions_per_period ?? 0,
        class_duration_minutes: packageRow.class_duration_minutes,
    })) return null;

    const { data: packagePrice, error: packagePriceError } = await supabaseAdmin
        .from('package_prices')
        .select('*')
        .eq('package_id', packageRow.id)
        .eq('catalog_version', packageRow.catalog_version)
        .eq('contract_schema_version', 2)
        .eq('status', 'active')
        .single();
    if (packagePriceError || !packagePrice || !isInitialIndividualOfferSnapshot({
        contract_schema_version: packagePrice.contract_schema_version,
        package_key: packagePrice.package_key,
        amount_cents: packagePrice.amount_cents,
        currency: packagePrice.currency,
        billing_interval_unit: packagePrice.billing_interval_unit as 'day' | 'week' | 'month' | 'year' | null,
        billing_interval_count: packagePrice.billing_interval_count,
        sessions_per_period: packagePrice.sessions_per_period,
        class_duration_minutes: packagePrice.class_duration_minutes,
    })) return null;

    const { data: priceSnapshot, error: priceSnapshotError } = await supabaseAdmin
        .from('checkout_v2_price_snapshots')
        .select('*')
        .eq('package_price_id', packagePrice.id)
        .single();
    if (priceSnapshotError || !priceSnapshot) return null;
    if (
        priceSnapshot.initial_amount_cents !== INITIAL_INDIVIDUAL_OFFER.amountCents
        || priceSnapshot.recurring_amount_cents !== INITIAL_INDIVIDUAL_OFFER.amountCents
        || priceSnapshot.currency !== PACKAGE_CURRENCY
        || priceSnapshot.recurring_interval_unit !== INITIAL_INDIVIDUAL_OFFER.billingIntervalUnit
        || priceSnapshot.recurring_interval_count !== INITIAL_INDIVIDUAL_OFFER.billingIntervalCount
        || priceSnapshot.recurring_stripe_price_id !== packagePrice.stripe_price_id
    ) return null;

    return { slot, packageRow, packagePrice, priceSnapshot };
}

export async function handleCheckoutV2(context: CheckoutContext): Promise<Response> {
    try {
        const body = await context.request.json() as CheckoutV2Request;
        const lang = normalizeCheckoutLang(body.lang);
        if (!hasAcceptedCheckoutPolicies(body)) {
            return jsonResponse({ error: 'Adult confirmation and policy acceptance are required' }, 400);
        }
        if (!isUuid(body.slotPublicId)) {
            return jsonResponse({ error: 'A valid slotPublicId is required' }, 400);
        }
        const slotPublicId = body.slotPublicId;

        const clientAddress = readCheckoutClientAddress(context);
        if (!clientAddress) {
            return jsonResponse({ error: 'Checkout verification is temporarily unavailable' }, 503);
        }
        const turnstile = await verifyCheckoutTurnstile({
            token: body['cf-turnstile-response'],
            clientAddress,
            context,
        });
        if (!turnstile.ok) {
            return turnstile.reason === 'invalid'
                ? jsonResponse({ error: 'Checkout verification failed' }, 400)
                : jsonResponse({ error: 'Checkout verification is temporarily unavailable' }, 503);
        }
        const holdFingerprint = await createCheckoutHoldFingerprint({
            clientAddress,
            secret: readRuntimeEnv('CHECKOUT_HOLD_FINGERPRINT_SECRET', context) ?? '',
        });
        if (!holdFingerprint) {
            return jsonResponse({ error: 'Checkout verification is temporarily unavailable' }, 503);
        }

        const supabase = createSupabaseServerClient(context);
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return jsonResponse({ error: 'Unauthorized' }, 401);
        if (!user.email || !user.email_confirmed_at) {
            return jsonResponse({ error: 'A confirmed email is required before payment' }, 403);
        }

        const { data: profile, error: profileError } = await supabase
            .from('profiles')
            .select('id, role, full_name')
            .eq('id', user.id)
            .single();
        if (profileError || !profile) return jsonResponse({ error: 'Profile not found' }, 404);
        if (profile.role !== 'student') {
            return jsonResponse({ error: 'Only student accounts can purchase a plan' }, 403);
        }

        const { data: activeSub, error: activeSubError } = await supabase
            .from('subscriptions')
            .select('id')
            .eq('student_id', user.id)
            .in('status', ['active', 'pending', 'paused'])
            .limit(1)
            .maybeSingle();
        if (activeSubError) return jsonResponse({ error: 'Could not verify existing subscriptions' }, 500);
        if (activeSub) return jsonResponse({ error: 'Ya tienes una suscripción activa o pendiente' }, 409);

        const supabaseAdmin = createSupabaseAdminClient();
        const offer = await loadCheckoutV2Offer(supabaseAdmin, slotPublicId);
        if (!offer) return jsonResponse({ error: 'This place is not available for checkout' }, 409);
        const { slot, packageRow, packagePrice, priceSnapshot } = offer;

        const anchor = renewalAnchorFor(slot.first_occurrence_at);
        if (!anchor || Date.parse(slot.first_occurrence_at) <= Date.now()) {
            return jsonResponse({ error: 'This place no longer has a valid first class' }, 409);
        }

        const [stripeAccount, initialPrice, recurringPrice] = await Promise.all([
            stripe.accounts.retrieve(),
            stripe.prices.retrieve(priceSnapshot.initial_stripe_price_id),
            stripe.prices.retrieve(priceSnapshot.recurring_stripe_price_id),
        ]);
        const runtime = assertStripeRuntimeAccount(context, stripeAccount);
        if (runtime.livemode) assertStripePaymentReadiness(stripeAccount);
        const productId = packagePrice.stripe_product_id;
        if (
            priceSnapshot.stripe_account_id !== runtime.accountId
            || priceSnapshot.stripe_livemode !== runtime.livemode
            || packagePrice.stripe_account_id !== runtime.accountId
            || packagePrice.stripe_livemode !== runtime.livemode
            || !initialPrice.active
            || initialPrice.type !== 'one_time'
            || initialPrice.recurring !== null
            || initialPrice.unit_amount !== INITIAL_INDIVIDUAL_OFFER.amountCents
            || initialPrice.currency !== PACKAGE_CURRENCY
            || initialPrice.livemode !== runtime.livemode
            || stripeProductId(initialPrice.product) !== productId
            || !recurringPrice.active
            || recurringPrice.type !== 'recurring'
            || recurringPrice.unit_amount !== INITIAL_INDIVIDUAL_OFFER.amountCents
            || recurringPrice.currency !== PACKAGE_CURRENCY
            || recurringPrice.livemode !== runtime.livemode
            || stripeProductId(recurringPrice.product) !== productId
            || recurringPrice.recurring?.interval !== 'day'
            || recurringPrice.recurring.interval_count !== INITIAL_INDIVIDUAL_OFFER.billingIntervalCount
        ) return jsonResponse({ error: 'Stripe prices do not match the approved offer' }, 409);

        const claimArgs: DirectCheckoutClaimArgs = {
            p_student_id: user.id,
            p_primary_email: user.email,
            p_full_name: profile.full_name,
            p_package_price_id: packagePrice.id,
            p_lang: lang,
            p_legal_policy_version: CHECKOUT_TERMS_VERSION,
            p_site_url: getSiteUrl(),
            p_slot_public_id: slotPublicId,
            p_hold_fingerprint: holdFingerprint,
        };

        let claim = await claimDirectCheckoutIntent(supabaseAdmin, claimArgs);
        let checkoutIntent = claim.data;
        if (claim.error || !checkoutIntent) {
            const reconciled = await reconcileExpiredV2HoldConflicts({
                supabaseAdmin,
                slotId: slot.id,
                holdFingerprint,
                runtimeLivemode: runtime.livemode,
            });
            if (reconciled) {
                claim = await claimDirectCheckoutIntent(supabaseAdmin, claimArgs);
                checkoutIntent = claim.data;
            }
            if (claim.error || !checkoutIntent) {
                return jsonResponse({ error: 'Could not reserve this place for checkout' }, 409);
            }
        }

        for (let attempt = 0; attempt < 2; attempt += 1) {
            if (checkoutIntent.status === 'completed') {
                return jsonResponse({ error: 'Payment is being reconciled for the existing checkout' }, 409);
            }
            if (checkoutIntent.package_price_id !== packagePrice.id) {
                return jsonResponse({ error: 'You already have another checkout in progress' }, 409);
            }

            const profilePrivate = await getPrivateProfile(user.id);
            const customerSnapshot = checkoutIntent.stripe_customer_id
                ? {
                    stripe_customer_id: checkoutIntent.stripe_customer_id,
                    stripe_customer_account_id: runtime.accountId,
                    stripe_customer_livemode: runtime.livemode,
                }
                : profilePrivate;
            let customerId = await validatedStripeCustomerId({
                profile: customerSnapshot,
                userId: user.id,
                confirmedEmail: user.email,
                runtime,
            });
            if (!customerId && checkoutIntent.stripe_customer_id) {
                return jsonResponse({ error: 'The Checkout Customer snapshot is no longer available' }, 409);
            }
            if (!customerId) {
                const customer = await stripe.customers.create({
                    email: user.email,
                    metadata: { supabase_user_id: user.id },
                }, { idempotencyKey: `customer:${runtime.appEnvironment}:${user.id}` });
                customerId = customer.id;
                await upsertPrivateProfile(user.id, {
                    stripe_customer_id: customerId,
                    stripe_customer_account_id: runtime.accountId,
                    stripe_customer_livemode: runtime.livemode,
                });
            }
            if (!await stripeCustomerHasNoApplicableBalance({
                customerId,
                runtimeLivemode: runtime.livemode,
            })) return jsonResponse({ error: 'The Stripe Customer has a balance that changes this purchase' }, 409);

            const snapshotted = await supabaseAdmin.rpc('snapshot_checkout_intent_customer', {
                p_intent_id: checkoutIntent.id,
                p_stripe_customer_id: customerId,
            });
            if (
                snapshotted.error
                || !snapshotted.data
                || snapshotted.data.id !== checkoutIntent.id
                || snapshotted.data.stripe_customer_id !== customerId
            ) return jsonResponse({ error: 'Checkout Customer could not be recorded safely' }, 409);
            checkoutIntent = snapshotted.data;

            const policyAcceptedAt = checkoutIntent.policy_accepted_at;
            const metadata = {
                contractSchemaVersion: checkoutV2ContractVersion,
                userId: user.id,
                packageId: packageRow.id,
                packageKey: INITIAL_INDIVIDUAL_OFFER.packageKey,
                packagePriceId: packagePrice.id,
                crmOpportunityId: checkoutIntent.opportunity_id,
                checkoutIntentId: checkoutIntent.id,
                slotPublicId,
                initialPriceId: priceSnapshot.initial_stripe_price_id,
                recurringPriceId: priceSnapshot.recurring_stripe_price_id,
                catalogVersion: String(packagePrice.catalog_version),
                billingIntervalUnit: INITIAL_INDIVIDUAL_OFFER.billingIntervalUnit,
                billingIntervalCount: String(INITIAL_INDIVIDUAL_OFFER.billingIntervalCount),
                sessionsPerPeriod: String(INITIAL_INDIVIDUAL_OFFER.sessionsPerPeriod),
                classDurationMinutes: String(INITIAL_INDIVIDUAL_OFFER.classDurationMinutes),
                firstClassAt: slot.first_occurrence_at,
                renewalAnchorAt: anchor.iso,
                lang: normalizeCheckoutLang(checkoutIntent.lang),
                adultConfirmed: 'true',
                adultConfirmedAt: policyAcceptedAt,
                termsAccepted: 'true',
                termsAcceptedAt: policyAcceptedAt,
                serviceStartRequested: 'true',
                serviceStartRequestedAt: policyAcceptedAt,
                withdrawalLossAcknowledged: 'true',
                withdrawalLossAcknowledgedAt: policyAcceptedAt,
                legalPolicyVersion: checkoutIntent.legal_policy_version,
            };
            const matchInput = {
                runtimeLivemode: runtime.livemode,
                customerId,
                studentId: user.id,
                packageId: packageRow.id,
                packagePriceId: packagePrice.id,
                opportunityId: checkoutIntent.opportunity_id,
                checkoutIntentId: checkoutIntent.id,
                slotPublicId,
                initialPriceId: priceSnapshot.initial_stripe_price_id,
                recurringPriceId: priceSnapshot.recurring_stripe_price_id,
                firstClassAt: slot.first_occurrence_at,
                renewalAnchorAt: anchor.iso,
            };

            let existingSession: Stripe.Checkout.Session | null = null;
            if (checkoutIntent.stripe_checkout_session_id) {
                existingSession = await stripe.checkout.sessions.retrieve(
                    checkoutIntent.stripe_checkout_session_id,
                    { expand: ['line_items.data.price'] },
                );
            } else {
                const recovered = await listCheckoutSessionsForIntent({
                    customerId,
                    checkoutIntentId: checkoutIntent.id,
                });
                if (recovered.length > 1) {
                    return jsonResponse({ error: 'Multiple Stripe Sessions exist for this checkout' }, 409);
                }
                if (recovered[0]) {
                    existingSession = await stripe.checkout.sessions.retrieve(
                        recovered[0].id,
                        { expand: ['line_items.data.price'] },
                    );
                }
            }

            if (existingSession) {
                if (!checkoutSessionMatchesV2({ session: existingSession, ...matchInput })) {
                    return jsonResponse({ error: 'Stored Checkout Session does not match this place' }, 409);
                }
                if (existingSession.status === 'open' && existingSession.url) {
                    if (!checkoutIntent.stripe_checkout_session_id) {
                        const recorded = await supabaseAdmin
                            .from('checkout_intents')
                            .update({
                                status: 'open',
                                stripe_checkout_session_id: existingSession.id,
                                updated_at: new Date().toISOString(),
                            })
                            .eq('id', checkoutIntent.id)
                            .eq('status', 'creating')
                            .eq('stripe_customer_id', customerId)
                            .is('stripe_checkout_session_id', null)
                            .select('id')
                            .single();
                        if (recorded.error || !recorded.data) {
                            return jsonResponse({ error: 'Recovered checkout could not be recorded safely' }, 409);
                        }
                    }
                    return jsonResponse({ url: existingSession.url }, 200);
                }
                if (existingSession.status !== 'expired' || attempt > 0) {
                    return jsonResponse({ error: 'Payment is being reconciled for the existing checkout' }, 409);
                }
                if (!await releaseV2CheckoutIntent(supabaseAdmin, checkoutIntent, existingSession.id)) {
                    return jsonResponse({ error: 'Expired checkout could not release its place safely' }, 409);
                }
                claim = await claimDirectCheckoutIntent(supabaseAdmin, claimArgs);
                checkoutIntent = claim.data;
                if (claim.error || !checkoutIntent) {
                    return jsonResponse({ error: 'Could not reserve a replacement checkout' }, 409);
                }
                continue;
            }

            const intentExpiresAt = Date.parse(checkoutIntent.expires_at);
            if (!Number.isFinite(intentExpiresAt)) {
                return jsonResponse({ error: 'Checkout reservation has an invalid expiry' }, 409);
            }
            if (intentExpiresAt <= Date.now()) {
                if (
                    attempt > 0
                    || !await releaseAbandonedV2CheckoutIntent(
                        supabaseAdmin,
                        checkoutIntent,
                        customerId,
                    )
                ) {
                    return jsonResponse({ error: 'Expired checkout could not release its place safely' }, 409);
                }
                claim = await claimDirectCheckoutIntent(supabaseAdmin, claimArgs);
                checkoutIntent = claim.data;
                if (claim.error || !checkoutIntent) {
                    return jsonResponse({ error: 'Could not reserve a replacement checkout' }, 409);
                }
                continue;
            }

            const checkoutExpiresAt = Math.floor(Date.parse(checkoutIntent.stripe_session_expires_at) / 1000);
            const nowSeconds = Math.floor(Date.now() / 1000);
            const firstClassAtSeconds = Math.floor(Date.parse(slot.first_occurrence_at) / 1000);
            if (
                !Number.isInteger(checkoutExpiresAt)
                || checkoutExpiresAt < nowSeconds + stripeMinimumSessionLifetimeSeconds
                || checkoutExpiresAt >= firstClassAtSeconds
            ) return jsonResponse({ error: 'This place cannot be held for a safe Checkout Session' }, 409);

            const createdSession = await stripe.checkout.sessions.create({
                mode: 'subscription',
                locale: normalizeCheckoutLang(checkoutIntent.lang),
                payment_method_types: ['card'],
                customer: customerId,
                client_reference_id: user.id,
                line_items: [
                    { price: priceSnapshot.initial_stripe_price_id, quantity: 1 },
                    { price: priceSnapshot.recurring_stripe_price_id, quantity: 1 },
                ],
                success_url: `${checkoutIntent.site_url}/${normalizeCheckoutLang(checkoutIntent.lang)}/campus?payment=success`,
                cancel_url: `${checkoutIntent.site_url}/${normalizeCheckoutLang(checkoutIntent.lang)}/campus/account`,
                allow_promotion_codes: false,
                adaptive_pricing: { enabled: false },
                automatic_tax: { enabled: false },
                subscription_data: {
                    trial_end: anchor.unix,
                    proration_behavior: 'none',
                    trial_settings: { end_behavior: { missing_payment_method: 'cancel' } },
                    metadata,
                },
                metadata,
                expires_at: checkoutExpiresAt,
                expand: ['line_items.data.price'],
            }, { idempotencyKey: `checkout-intent:${checkoutIntent.id}` });

            if (!checkoutSessionMatchesV2({ session: createdSession, ...matchInput })) {
                return jsonResponse({ error: 'Stripe returned a Checkout Session for a different place' }, 409);
            }
            if (createdSession.status !== 'open' || !createdSession.url) {
                return jsonResponse({ error: 'Payment is being reconciled for the existing checkout' }, 409);
            }

            const recorded = await supabaseAdmin
                .from('checkout_intents')
                .update({
                    status: 'open',
                    stripe_checkout_session_id: createdSession.id,
                    updated_at: new Date().toISOString(),
                })
                .eq('id', checkoutIntent.id)
                .eq('status', 'creating')
                .eq('stripe_customer_id', customerId)
                .is('stripe_checkout_session_id', null)
                .select('id')
                .single();
            if (recorded.error || !recorded.data) {
                return jsonResponse({ error: 'Checkout Session could not be recorded safely' }, 409);
            }
            return jsonResponse({ url: createdSession.url }, 200);
        }

        return jsonResponse({ error: 'Could not create a stable Checkout Session' }, 409);
    } catch (error) {
        console.error('Error creating checkout v2:', error);
        return jsonResponse({ error: 'Internal server error' }, 500);
    }
}
