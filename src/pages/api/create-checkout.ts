import type { APIRoute } from 'astro';
import type Stripe from 'stripe';
import { findCheckoutApproval } from '../../lib/checkout-approval';
import { isCheckoutEnabled } from '../../lib/checkout-enabled';
import { CHECKOUT_TERMS_VERSION, hasAcceptedCheckoutPolicies } from '../../lib/legal-policy';
import {
    calculatePackageTotalCents,
    calculateSessionsPerPeriod,
    isPackageKeyCheckoutEligible,
    isPackageDuration,
    packagePriceField,
    PACKAGE_CURRENCY,
} from '../../lib/package-pricing';
import { getPrivateProfile, upsertPrivateProfile } from '../../lib/profiles-private';
import { readRuntimeEnv } from '../../lib/runtime-env';
import { getSiteUrl } from '../../lib/site-url';
import { stripe } from '../../lib/stripe';
import { validatedStripeCustomerId } from '../../lib/stripe-customer';
import { assertStripePaymentReadiness, assertStripeRuntimeAccount } from '../../lib/stripe-runtime-guard';
import { createSupabaseAdminClient } from '../../lib/supabase-admin';
import { createSupabaseServerClient } from '../../lib/supabase-server';
import { handleCheckoutV2 } from '../../lib/checkout-v2';

const supportedCheckoutLangs = new Set(['es', 'en', 'ru']);
const jsonHeaders = { 'Content-Type': 'application/json' };
const maxCheckoutSessionRecoveryPages = 100;

// The historical monthly implementation remains reachable only inside the
// explicitly isolated legacy test runtime. Every real runtime uses the
// capacity-backed v2 contract below, even while its checkout gate is closed.
function isIsolatedLegacyCheckoutTest(context: Parameters<typeof readRuntimeEnv>[1]): boolean {
    return readRuntimeEnv('PUBLIC_APP_ENV', context) === 'test'
        && readRuntimeEnv('E2E_RUNTIME_ISOLATED', context) === 'true'
        && readRuntimeEnv('E2E_DISABLE_EXTERNAL_INTEGRATIONS', context) === 'true'
        && readRuntimeEnv('E2E_TARGET_SUPABASE_REF', context) === 'placeholder';
}

function jsonResponse(payload: unknown, status: number): Response {
    return new Response(JSON.stringify(payload), { status, headers: jsonHeaders });
}

function normalizeCheckoutLang(value: unknown): 'es' | 'en' | 'ru' {
    return typeof value === 'string' && supportedCheckoutLangs.has(value)
        ? value as 'es' | 'en' | 'ru'
        : 'es';
}

function isStripePriceId(value: unknown): value is string {
    return typeof value === 'string' && /^price_[A-Za-z0-9_]+$/.test(value);
}

function stripeProductId(product: string | { id: string }): string {
    return typeof product === 'string' ? product : product.id;
}

function stripeCustomerId(customer: Stripe.Checkout.Session['customer']): string | null {
    if (!customer) return null;
    return typeof customer === 'string' ? customer : customer.id;
}

function createdSessionMatchesCheckout(input: {
    session: Stripe.Checkout.Session;
    runtimeLivemode: boolean;
    stripeCustomerId: string;
    expectedAmountCents: number;
    expectedCurrency: string;
    userId: string;
    priceId: string;
    packageId: string;
    packagePriceId: string;
    opportunityId: string;
    checkoutIntentId: string;
}): boolean {
    const { session } = input;
    const lineItems = session.line_items?.data ?? [];
    const onlyLineItem = lineItems.length === 1 ? lineItems[0] : null;

    return session.mode === 'subscription'
        && session.livemode === input.runtimeLivemode
        && stripeCustomerId(session.customer) === input.stripeCustomerId
        && session.client_reference_id === input.userId
        && session.amount_subtotal === input.expectedAmountCents
        && session.amount_total === input.expectedAmountCents
        && session.currency === input.expectedCurrency
        && (session.discounts?.length ?? 0) === 0
        && session.total_details?.amount_discount === 0
        && (session.total_details.amount_shipping ?? 0) === 0
        && session.total_details.amount_tax === 0
        && session.allow_promotion_codes === false
        && session.adaptive_pricing?.enabled === false
        && session.automatic_tax?.enabled === false
        && session.payment_method_types.length === 1
        && session.payment_method_types[0] === 'card'
        && onlyLineItem?.quantity === 1
        && onlyLineItem.price?.id === input.priceId
        && session.metadata?.userId === input.userId
        && session.metadata.priceId === input.priceId
        && session.metadata.packageId === input.packageId
        && session.metadata.packagePriceId === input.packagePriceId
        && session.metadata.crmOpportunityId === input.opportunityId
        && session.metadata.checkoutIntentId === input.checkoutIntentId;
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
            return jsonResponse({ error: 'Checkout is disabled', errorCode: 'CHECKOUT_DISABLED' }, 403);
        }
        if (!isIsolatedLegacyCheckoutTest(context)) return handleCheckoutV2(context);

        const body = await context.request.json() as CheckoutRequest;
        const { priceId } = body;
        const lang = normalizeCheckoutLang(body.lang);

        if (!hasAcceptedCheckoutPolicies(body)) {
            return jsonResponse({ error: 'Adult confirmation and policy acceptance are required' }, 400);
        }
        if (!priceId) return jsonResponse({ error: 'priceId is required' }, 400);
        if (!isStripePriceId(priceId)) return jsonResponse({ error: 'Invalid price ID' }, 400);

        const supabase = createSupabaseServerClient(context);
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return jsonResponse({ error: 'Unauthorized' }, 401);
        if (!user.email || !user.email_confirmed_at) {
            return jsonResponse({
                error: 'A confirmed email is required before payment',
                errorCode: 'ACCOUNT_NOT_ELIGIBLE',
            }, 403);
        }

        const { data: profile, error: profileError } = await supabase
            .from('profiles')
            .select('id, role')
            .eq('id', user.id)
            .single();
        if (profileError || !profile) return jsonResponse({ error: 'Profile not found' }, 404);
        if (profile.role !== 'student') {
            return jsonResponse({
                error: 'Only student accounts can purchase a plan',
                errorCode: 'ACCOUNT_NOT_ELIGIBLE',
            }, 403);
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
        const { data: packagePrice, error: packagePriceError } = await supabaseAdmin
            .from('package_prices')
            .select('*')
            .eq('stripe_price_id', priceId)
            .eq('status', 'active')
            .single();
        if (packagePriceError || !packagePrice || !isPackageDuration(packagePrice.duration_months)) {
            return jsonResponse({ error: 'This price is not available for new purchases' }, 400);
        }

        const { data: pkg, error: packageError } = await supabaseAdmin
            .from('packages')
            .select('*')
            .eq('id', packagePrice.package_id)
            .eq('is_active', true)
            .single();
        if (packageError || !pkg) return jsonResponse({ error: 'Package is not available' }, 400);
        if (!isPackageKeyCheckoutEligible(pkg.name)) {
            return jsonResponse({ error: 'This package requires additional group or teacher operations and is not available for direct checkout' }, 409);
        }

        const duration = packagePrice.duration_months;
        const expectedAmount = calculatePackageTotalCents(pkg.price_monthly, duration);
        const expectedSessions = calculateSessionsPerPeriod(pkg.sessions_per_month, duration);
        const currentPriceField = packagePriceField(duration);
        if (
            pkg.catalog_version !== packagePrice.catalog_version
            || pkg[currentPriceField] !== priceId
            || pkg.stripe_product_id !== packagePrice.stripe_product_id
            || packagePrice.amount_cents !== expectedAmount
            || packagePrice.currency !== PACKAGE_CURRENCY
            || packagePrice.sessions_per_period !== expectedSessions
        ) {
            return jsonResponse({ error: 'Catalog and billing price are not synchronized' }, 409);
        }

        const approval = await findCheckoutApproval(supabaseAdmin, {
            userId: user.id,
            email: user.email,
            emailConfirmedAt: user.email_confirmed_at,
        }, pkg.id);
        if (!approval) {
            return jsonResponse({ error: 'Tu plaza o este plan todavía no están aprobados para pago' }, 403);
        }

        // Read-only Stripe verification happens before creating a Customer or a
        // Checkout Session, so a bad environment or catalog fails closed.
        const [stripeAccount, stripePrice] = await Promise.all([
            stripe.accounts.retrieve(),
            stripe.prices.retrieve(priceId),
        ]);
        const runtime = assertStripeRuntimeAccount(context, stripeAccount);
        if (runtime.livemode) assertStripePaymentReadiness(stripeAccount);
        const actualProductId = stripeProductId(stripePrice.product);
        if (
            !stripePrice.active
            || stripePrice.unit_amount !== packagePrice.amount_cents
            || stripePrice.currency !== packagePrice.currency
            || actualProductId !== packagePrice.stripe_product_id
            || stripePrice.recurring?.interval !== 'month'
            || stripePrice.recurring.interval_count !== duration
            || stripePrice.livemode !== packagePrice.stripe_livemode
            || packagePrice.stripe_account_id !== runtime.accountId
        ) {
            return jsonResponse({ error: 'Stripe price does not match the approved offer' }, 409);
        }

        const requestedSiteUrl = getSiteUrl();
        const claimArgs = {
            p_opportunity_id: approval.opportunityId,
            p_contact_id: approval.contactId,
            p_student_id: user.id,
            p_package_price_id: packagePrice.id,
            p_lang: lang,
            p_legal_policy_version: CHECKOUT_TERMS_VERSION,
            p_site_url: requestedSiteUrl,
        };
        let { data: checkoutIntent, error: checkoutIntentError } = await supabaseAdmin
            .rpc('claim_checkout_intent', claimArgs);
        if (
            checkoutIntentError
            || !checkoutIntent
            || checkoutIntent.opportunity_id !== approval.opportunityId
            || checkoutIntent.contact_id !== approval.contactId
            || checkoutIntent.student_id !== user.id
        ) {
            return jsonResponse({ error: 'Could not reserve this approved checkout' }, 409);
        }
        if (checkoutIntent.status === 'completed') {
            return jsonResponse({ error: 'Payment is being reconciled for the existing checkout' }, 409);
        }
        if (checkoutIntent.package_price_id !== packagePrice.id) {
            return jsonResponse({ error: 'You already have another checkout in progress' }, 409);
        }
        if (checkoutIntent.stripe_checkout_session_id) {
            const existingSession = await stripe.checkout.sessions.retrieve(
                checkoutIntent.stripe_checkout_session_id,
                { expand: ['line_items.data.price'] }
            );
            if (
                !checkoutIntent.stripe_customer_id
                || !createdSessionMatchesCheckout({
                    session: existingSession,
                    runtimeLivemode: runtime.livemode,
                    stripeCustomerId: checkoutIntent.stripe_customer_id,
                    expectedAmountCents: packagePrice.amount_cents,
                    expectedCurrency: packagePrice.currency,
                    userId: user.id,
                    priceId,
                    packageId: pkg.id,
                    packagePriceId: packagePrice.id,
                    opportunityId: approval.opportunityId,
                    checkoutIntentId: checkoutIntent.id,
                })
            ) {
                return jsonResponse({ error: 'Stored Checkout Session does not match this approved offer' }, 409);
            }
            if (existingSession.status === 'open' && existingSession.url) {
                if (!await stripeCustomerHasNoApplicableBalance({
                    customerId: checkoutIntent.stripe_customer_id,
                    runtimeLivemode: runtime.livemode,
                })) {
                    return jsonResponse({ error: 'The Stripe Customer has a balance that changes this purchase' }, 409);
                }
                return jsonResponse({ url: existingSession.url }, 200);
            }
            if (existingSession.status === 'expired') {
                const { data: releasedIntent, error: releaseError } = await supabaseAdmin.rpc('release_expired_checkout_intent', {
                    p_intent_id: checkoutIntent.id,
                    p_stripe_checkout_session_id: checkoutIntent.stripe_checkout_session_id,
                });
                if (releaseError || !releasedIntent || releasedIntent.status !== 'expired') {
                    return jsonResponse({ error: 'Expired checkout could not be released safely' }, 409);
                }
                const reclaimed = await supabaseAdmin.rpc('claim_checkout_intent', claimArgs);
                checkoutIntent = reclaimed.data;
                checkoutIntentError = reclaimed.error;
                if (
                    checkoutIntentError
                    || !checkoutIntent
                    || checkoutIntent.opportunity_id !== approval.opportunityId
                    || checkoutIntent.contact_id !== approval.contactId
                    || checkoutIntent.student_id !== user.id
                    || checkoutIntent.package_price_id !== packagePrice.id
                    || checkoutIntent.status !== 'creating'
                    || checkoutIntent.stripe_checkout_session_id
                ) {
                    return jsonResponse({ error: 'Could not reserve a replacement checkout' }, 409);
                }
            } else {
                return jsonResponse({ error: 'Payment is being reconciled for the existing checkout' }, 409);
            }
        }
        // A single retry may replace one verified-expired/abandoned intent.
        // Every iteration snapshots the Customer before any Session creation.
        for (let reservationAttempt = 0; reservationAttempt < 2; reservationAttempt += 1) {
            if (checkoutIntent.status !== 'creating' || checkoutIntent.stripe_checkout_session_id) {
                return jsonResponse({ error: 'Payment is being reconciled for the existing checkout' }, 409);
            }

            const profilePrivate = await getPrivateProfile(user.id);
            const customerSnapshot = checkoutIntent.stripe_customer_id
                ? {
                    stripe_customer_id: checkoutIntent.stripe_customer_id,
                    stripe_customer_account_id: runtime.accountId,
                    stripe_customer_livemode: runtime.livemode,
                }
                : profilePrivate;
            let stripeCustomerId = await validatedStripeCustomerId({
                profile: customerSnapshot,
                userId: user.id,
                confirmedEmail: user.email,
                runtime,
            });
            if (!stripeCustomerId && checkoutIntent.stripe_customer_id) {
                return jsonResponse({ error: 'The Checkout Customer snapshot is no longer available' }, 409);
            }
            if (!stripeCustomerId) {
                const customer = await stripe.customers.create({
                    email: user.email,
                    metadata: { supabase_user_id: user.id },
                }, {
                    idempotencyKey: `customer:${runtime.appEnvironment}:${user.id}`,
                });
                stripeCustomerId = customer.id;

                try {
                    await upsertPrivateProfile(user.id, {
                        stripe_customer_id: stripeCustomerId,
                        stripe_customer_account_id: runtime.accountId,
                        stripe_customer_livemode: runtime.livemode,
                    });
                } catch (profileUpdateError) {
                    console.error('Failed to persist stripe_customer_id:', profileUpdateError);
                    return jsonResponse({ error: 'Failed to prepare checkout' }, 500);
                }
            }

            if (!await stripeCustomerHasNoApplicableBalance({
                customerId: stripeCustomerId,
                runtimeLivemode: runtime.livemode,
            })) {
                return jsonResponse({ error: 'The Stripe Customer has a balance that changes this purchase' }, 409);
            }

            const customerSnapshotResult = await supabaseAdmin.rpc('snapshot_checkout_intent_customer', {
                p_intent_id: checkoutIntent.id,
                p_stripe_customer_id: stripeCustomerId,
            });
            checkoutIntent = customerSnapshotResult.data;
            checkoutIntentError = customerSnapshotResult.error;
            if (
                checkoutIntentError
                || !checkoutIntent
                || checkoutIntent.opportunity_id !== approval.opportunityId
                || checkoutIntent.contact_id !== approval.contactId
                || checkoutIntent.student_id !== user.id
                || checkoutIntent.package_price_id !== packagePrice.id
                || checkoutIntent.status !== 'creating'
                || checkoutIntent.stripe_checkout_session_id
                || checkoutIntent.stripe_customer_id !== stripeCustomerId
            ) {
                return jsonResponse({ error: 'Could not persist the Checkout Customer safely' }, 409);
            }

            const nowSeconds = Math.floor(Date.now() / 1000);
            const checkoutExpiresAt = Math.floor(Date.parse(checkoutIntent.stripe_session_expires_at) / 1000);
            const recoveryExpiresAt = Math.floor(Date.parse(checkoutIntent.expires_at) / 1000);
            if (!Number.isInteger(checkoutExpiresAt) || !Number.isInteger(recoveryExpiresAt)) {
                return jsonResponse({ error: 'The reserved checkout has invalid recovery deadlines' }, 409);
            }

            // Once Session creation is no longer safe, enumerate every Session
            // for the snapshotted Customer. Absence is trusted only after the
            // final Stripe page; pagination errors never release the intent.
            if (checkoutExpiresAt < nowSeconds + 30 * 60) {
                const matchingSessions = await listCheckoutSessionsForIntent({
                    customerId: stripeCustomerId,
                    checkoutIntentId: checkoutIntent.id,
                });
                if (matchingSessions.length > 1) {
                    return jsonResponse({ error: 'Multiple Stripe Sessions match this checkout; manual review is required' }, 409);
                }

                if (matchingSessions.length === 0) {
                    if (recoveryExpiresAt > nowSeconds) {
                        return jsonResponse({ error: 'The reserved checkout is awaiting its recovery deadline' }, 409);
                    }
                    const released = await supabaseAdmin.rpc('release_abandoned_checkout_intent', {
                        p_intent_id: checkoutIntent.id,
                        p_stripe_customer_id: stripeCustomerId,
                    });
                    if (released.error || !released.data || released.data.status !== 'expired') {
                        return jsonResponse({ error: 'Abandoned checkout could not be released safely' }, 409);
                    }

                    const reclaimed = await supabaseAdmin.rpc('claim_checkout_intent', claimArgs);
                    checkoutIntent = reclaimed.data;
                    checkoutIntentError = reclaimed.error;
                    if (
                        checkoutIntentError
                        || !checkoutIntent
                        || checkoutIntent.opportunity_id !== approval.opportunityId
                        || checkoutIntent.contact_id !== approval.contactId
                        || checkoutIntent.student_id !== user.id
                        || checkoutIntent.package_price_id !== packagePrice.id
                        || checkoutIntent.status !== 'creating'
                        || checkoutIntent.stripe_checkout_session_id
                    ) {
                        return jsonResponse({ error: 'Could not reserve a replacement checkout' }, 409);
                    }
                    continue;
                }

                const recoveredSession = await stripe.checkout.sessions.retrieve(
                    matchingSessions[0].id,
                    { expand: ['line_items.data.price'] },
                );
                if (!createdSessionMatchesCheckout({
                    session: recoveredSession,
                    runtimeLivemode: runtime.livemode,
                    stripeCustomerId,
                    expectedAmountCents: packagePrice.amount_cents,
                    expectedCurrency: packagePrice.currency,
                    userId: user.id,
                    priceId,
                    packageId: pkg.id,
                    packagePriceId: packagePrice.id,
                    opportunityId: approval.opportunityId,
                    checkoutIntentId: checkoutIntent.id,
                })) {
                    return jsonResponse({ error: 'Recovered Checkout Session does not match this approved offer' }, 409);
                }

                if (recoveredSession.status === 'complete') {
                    return jsonResponse({ error: 'Payment is being reconciled for the existing checkout' }, 409);
                }
                if (recoveredSession.status === 'expired') {
                    const released = await supabaseAdmin.rpc('release_expired_checkout_intent', {
                        p_intent_id: checkoutIntent.id,
                        p_stripe_checkout_session_id: recoveredSession.id,
                    });
                    if (released.error || !released.data || released.data.status !== 'expired') {
                        return jsonResponse({ error: 'Expired checkout could not be released safely' }, 409);
                    }
                    const reclaimed = await supabaseAdmin.rpc('claim_checkout_intent', claimArgs);
                    checkoutIntent = reclaimed.data;
                    checkoutIntentError = reclaimed.error;
                    if (
                        checkoutIntentError
                        || !checkoutIntent
                        || checkoutIntent.opportunity_id !== approval.opportunityId
                        || checkoutIntent.contact_id !== approval.contactId
                        || checkoutIntent.student_id !== user.id
                        || checkoutIntent.package_price_id !== packagePrice.id
                        || checkoutIntent.status !== 'creating'
                        || checkoutIntent.stripe_checkout_session_id
                    ) {
                        return jsonResponse({ error: 'Could not reserve a replacement checkout' }, 409);
                    }
                    continue;
                }
                if (recoveredSession.status !== 'open' || !recoveredSession.url) {
                    return jsonResponse({ error: 'Recovered Checkout Session is not usable' }, 409);
                }

                const { data: openedIntent, error: openedIntentError } = await supabaseAdmin
                    .from('checkout_intents')
                    .update({
                        status: 'open',
                        stripe_checkout_session_id: recoveredSession.id,
                        updated_at: new Date().toISOString(),
                    })
                    .eq('id', checkoutIntent.id)
                    .eq('status', 'creating')
                    .eq('stripe_customer_id', stripeCustomerId)
                    .is('stripe_checkout_session_id', null)
                    .select('id')
                    .single();
                if (openedIntentError || !openedIntent) {
                    return jsonResponse({ error: 'Recovered checkout could not be recorded safely' }, 409);
                }
                return jsonResponse({ url: recoveredSession.url }, 200);
            }

            // Stable across retries using the same checkout intent/idempotency key.
            const policyAcceptedAt = checkoutIntent.policy_accepted_at;
            const intentLang = normalizeCheckoutLang(checkoutIntent.lang);
            const policyMetadata = {
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
            const billingMetadata = {
                userId: user.id,
                priceId,
                packageId: pkg.id,
                packagePriceId: packagePrice.id,
                crmOpportunityId: approval.opportunityId,
                checkoutIntentId: checkoutIntent.id,
                catalogVersion: String(packagePrice.catalog_version),
                durationMonths: String(duration),
                sessionsPerPeriod: String(packagePrice.sessions_per_period),
                lang: intentLang,
                ...policyMetadata,
            };

            const createdSession = await stripe.checkout.sessions.create({
                mode: 'subscription',
                locale: intentLang,
                payment_method_types: ['card'],
                customer: stripeCustomerId,
                client_reference_id: user.id,
                line_items: [{ price: priceId, quantity: 1 }],
                success_url: `${checkoutIntent.site_url}/${intentLang}/campus?payment=success`,
                cancel_url: `${checkoutIntent.site_url}/${intentLang}/campus/account`,
                allow_promotion_codes: false,
                adaptive_pricing: { enabled: false },
                subscription_data: { metadata: billingMetadata },
                metadata: billingMetadata,
                expires_at: checkoutExpiresAt,
                expand: ['line_items.data.price'],
            }, {
                idempotencyKey: `checkout-intent:${checkoutIntent.id}`,
            });

            if (!createdSession.id || !createdSessionMatchesCheckout({
                    session: createdSession,
                    runtimeLivemode: runtime.livemode,
                    stripeCustomerId,
                    expectedAmountCents: packagePrice.amount_cents,
                    expectedCurrency: packagePrice.currency,
                    userId: user.id,
                priceId,
                packageId: pkg.id,
                packagePriceId: packagePrice.id,
                opportunityId: approval.opportunityId,
                checkoutIntentId: checkoutIntent.id,
            })) {
                return jsonResponse({ error: 'Stripe returned a Checkout Session for a different offer' }, 409);
            }

            if (createdSession.status === 'open') {
                if (!createdSession.url) {
                    return jsonResponse({ error: 'Stripe did not return a usable Checkout Session' }, 500);
                }
                const { data: openedIntent, error: openedIntentError } = await supabaseAdmin
                    .from('checkout_intents')
                    .update({
                        status: 'open',
                        stripe_checkout_session_id: createdSession.id,
                        updated_at: new Date().toISOString(),
                    })
                    .eq('id', checkoutIntent.id)
                    .eq('status', 'creating')
                    .eq('stripe_customer_id', stripeCustomerId)
                    .is('stripe_checkout_session_id', null)
                    .select('id')
                    .single();
                if (openedIntentError || !openedIntent) {
                    return jsonResponse({ error: 'Checkout was created but could not be recorded safely' }, 500);
                }
                return jsonResponse({ url: createdSession.url }, 200);
            }

            // A completed Session may already be under webhook reconciliation
            // and must never be released or replaced.
            if (createdSession.status !== 'expired') {
                return jsonResponse({ error: 'Payment is being reconciled for the existing checkout' }, 409);
            }

            const { data: releasedIntent, error: releaseError } = await supabaseAdmin.rpc(
                'release_expired_checkout_intent',
                {
                    p_intent_id: checkoutIntent.id,
                    p_stripe_checkout_session_id: createdSession.id,
                }
            );
            if (releaseError || !releasedIntent || releasedIntent.status !== 'expired') {
                return jsonResponse({ error: 'Expired checkout could not be released safely' }, 409);
            }

            const reclaimed = await supabaseAdmin.rpc('claim_checkout_intent', claimArgs);
            checkoutIntent = reclaimed.data;
            checkoutIntentError = reclaimed.error;
            if (
                checkoutIntentError
                || !checkoutIntent
                || checkoutIntent.opportunity_id !== approval.opportunityId
                || checkoutIntent.contact_id !== approval.contactId
                || checkoutIntent.student_id !== user.id
                || checkoutIntent.package_price_id !== packagePrice.id
                || checkoutIntent.status !== 'creating'
                || checkoutIntent.stripe_checkout_session_id
            ) {
                return jsonResponse({ error: 'Could not reserve a replacement checkout' }, 409);
            }
        }

        return jsonResponse({ error: 'Checkout recovery requires manual review' }, 409);
    } catch (error) {
        console.error('Checkout error:', error);
        return jsonResponse({ error: 'Internal server error' }, 500);
    }
};
