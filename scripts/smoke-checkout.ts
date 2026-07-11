/**
 * Narrow, authenticated checkout smoke for a non-live environment.
 *
 * This script exercises the post-application payment boundary: it reuses the
 * existing allowlisted staging student, prepares one temporary CRM opportunity, calls the real
 * checkout endpoint, verifies the resulting package_price/checkout_intent and
 * Stripe Checkout Session, then expires the open test session. It deliberately
 * does not fabricate a Stripe webhook or complete a payment. It never creates
 * an Auth user and deletes its temporary intent/opportunity during cleanup.
 *
 * Required while the app is running:
 *   SMOKE_BASE_URL=http://localhost:4321
 *   SMOKE_EXTERNAL_WRITES_CONFIRMATION=writes-ok:localhost:4321
 *   pnpm exec tsx scripts/smoke-checkout.ts
 */
import { spawnSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { chromium, type Browser, type Page } from 'playwright';
import Stripe from 'stripe';
import type { User } from '@supabase/supabase-js';
import type { Database, Tables } from '../src/types/database.types';
import {
    getCheckoutReadyPackageOffers,
    isPackageKeyCheckoutEligible,
    type PackageCatalogSnapshot,
    type PackagePriceSnapshot,
} from '../src/lib/package-pricing';
import {
    EXACT_STAGING_CHECKOUT_BOOTSTRAP_APPROVAL,
    STAGING_CHECKOUT_BOOTSTRAP_APPROVAL_ENV,
} from './smoke/staging-checkout-bootstrap-approval';

// The narrow smoke is staging-only. Explicit process env values win, while the
// ignored staging file supplies local defaults without ever inheriting base or
// production credentials.
dotenv.config({ path: '.env.staging', override: false, quiet: true });

const BOOTSTRAP_PREFLIGHT = process.argv.includes('--bootstrap-preflight');
const BOOTSTRAP_PRESERVE_OPEN = process.argv.includes('--bootstrap-preserve-open');
const BOOTSTRAP_CLEANUP = process.argv.includes('--bootstrap-cleanup');
if ([BOOTSTRAP_PREFLIGHT, BOOTSTRAP_PRESERVE_OPEN, BOOTSTRAP_CLEANUP].filter(Boolean).length > 1) {
    throw new Error('Checkout bootstrap preflight, preserve-open and cleanup modes are mutually exclusive.');
}
const BOOTSTRAP_MODE = BOOTSTRAP_PREFLIGHT || BOOTSTRAP_PRESERVE_OPEN || BOOTSTRAP_CLEANUP;

const supabaseUrl = requireEnv('PUBLIC_SUPABASE_URL');
const supabaseServiceKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
const stripeSecretKey = requireEnv('STRIPE_SECRET_KEY');
const stagingSupabaseRef = 'mzjyvmlxfpzdfdjzxxyj';
const stagingStripeAccountId = 'acct_1TruqOC22M3erP0j';
if (new URL(supabaseUrl).hostname.split('.')[0] !== stagingSupabaseRef) {
    throw new Error(`The checkout smoke only accepts Supabase staging ${stagingSupabaseRef}.`);
}
if (!stripeSecretKey.startsWith('sk_test_')) {
    throw new Error('The checkout smoke refuses Stripe live credentials.');
}
const baseUrl = normalizeAndConfirmSmokeBaseUrl(
    process.env.SMOKE_BASE_URL || process.env.TEST_BASE_URL || '',
    requireEnv('SMOKE_EXTERNAL_WRITES_CONFIRMATION')
);
if (BOOTSTRAP_MODE && new URL(baseUrl).host !== 'espanolhonesto-staging.alindev95.workers.dev') {
    throw new Error('Checkout bootstrap only accepts the exact deployed staging Worker host.');
}
const smokeEmail = requireEnv('SMOKE_STUDENT_EMAIL');
const smokePassword = requireEnv('SMOKE_STUDENT_PASSWORD');
const emailRecipientAllowlist = requireEnv('EMAIL_RECIPIENT_ALLOWLIST');
const checkoutGateConfirmation = requireEnv('STAGING_CHECKOUT_GATE_CONFIRMATION');

const supabaseAdmin = createClient<Database>(supabaseUrl, supabaseServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
});

const stripe = new Stripe(stripeSecretKey, { apiVersion: '2026-02-25.clover' });

type PackagePrice = PackagePriceSnapshot & Pick<Tables<'package_prices'>, 'id' | 'package_id'>;

type CheckoutPackage = PackageCatalogSnapshot & {
    id: string;
    package_prices: PackagePrice[];
};

type SmokeCheckout = {
    opportunityId: string;
    packagePrice: PackagePrice;
    sessionId: string;
    intentId: string;
    interest: 'checkout-smoke' | 'staging-checkout-bootstrap';
};

type BootstrapCustomer = {
    customerId: string;
    testClockId: string;
    createdByThisRun: boolean;
};

async function getCheckoutOffer(): Promise<PackagePrice> {
    const { data, error } = await supabaseAdmin
        .from('packages')
        .select(`
            id,
            name,
            catalog_version,
            price_monthly,
            sessions_per_month,
            has_group_session,
            has_dual_teacher,
            is_active,
            stripe_product_id,
            stripe_price_1m,
            stripe_price_3m,
            stripe_price_6m,
            package_prices (
                id,
                package_id,
                catalog_version,
                package_key,
                duration_months,
                amount_cents,
                currency,
                sessions_per_month,
                sessions_per_period,
                has_group_session,
                has_dual_teacher,
                status,
                stripe_account_id,
                stripe_livemode,
                stripe_price_id,
                stripe_product_id
            )
        `)
        .eq('is_active', true)
        .in('name', ['standard', 'bootcamp']);

    if (error) throw error;
    const candidates = (data as unknown as CheckoutPackage[])
        .filter((pkg) => isPackageKeyCheckoutEligible(pkg.name))
        .map((pkg) => ({ pkg, offers: getCheckoutReadyPackageOffers(pkg) }))
        .filter((candidate) => candidate.offers !== null)
        .sort((left, right) => (
            Number(right.pkg.name === 'standard') - Number(left.pkg.name === 'standard')
        ));
    const selected = candidates[0];
    const offer = selected?.offers?.get(1) as PackagePrice | undefined;
    if (!offer) {
        throw new Error('No checkout-eligible Standard or Bootcamp package has an exact canonical offer set.');
    }
    if (
        BOOTSTRAP_MODE
        && (
            selected?.pkg.name !== 'standard'
            || offer.package_key !== 'standard'
            || offer.duration_months !== 1
            || offer.currency !== 'eur'
        )
    ) {
        throw new Error('Checkout bootstrap requires the exact Standard one-month EUR offer.');
    }
    if (!offer.stripe_account_id) throw new Error('The active package_price is not bound to a Stripe account.');

    const [account, price] = await Promise.all([
        stripe.accounts.retrieve(),
        stripe.prices.retrieve(offer.stripe_price_id),
    ]);
    const productId = typeof price.product === 'string' ? price.product : price.product.id;

    if (offer.stripe_livemode || price.livemode) {
        throw new Error('This narrow smoke is test-mode only and refuses live Stripe writes.');
    }
    if (
        BOOTSTRAP_MODE
        && (
            account.id !== stagingStripeAccountId
            || account.country !== 'ES'
            || account.default_currency !== 'eur'
        )
    ) {
        throw new Error(`Checkout bootstrap only accepts Stripe Sandbox ${stagingStripeAccountId} configured as Spain/EUR.`);
    }
    if (
        account.id !== offer.stripe_account_id
        || price.id !== offer.stripe_price_id
        || !price.active
        || price.unit_amount !== offer.amount_cents
        || price.currency !== offer.currency
        || productId !== offer.stripe_product_id
        || price.recurring?.interval !== 'month'
        || price.recurring.interval_count !== offer.duration_months
    ) {
        throw new Error('The active package_price does not match the connected Stripe test account.');
    }

    return offer;
}

async function findAuthUserByEmail(email: string): Promise<User | null> {
    for (let page = 1; page <= 100; page += 1) {
        const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 100 });
        if (error) throw error;

        const users = data.users as unknown as User[];
        const user = users.find((candidate) => candidate.email?.toLowerCase() === email.toLowerCase());
        if (user) return user;
        if (users.length < 100) return null;
    }

    throw new Error('Smoke user lookup exceeded 100 Supabase Auth pages.');
}

async function getExistingSmokeUser(
    email: string,
    options: { allowBlockingSubscription?: boolean } = {},
): Promise<string> {
    const existing = await findAuthUserByEmail(email);
    if (!existing?.email_confirmed_at) {
        throw new Error('The allowlisted checkout smoke student must already exist with a confirmed email.');
    }
    const { data: profile, error: profileError } = await supabaseAdmin
        .from('profiles')
        .select('id, role')
        .eq('id', existing.id)
        .single();
    if (profileError || profile?.role !== 'student') {
        throw profileError ?? new Error('The existing checkout smoke account is not a student profile.');
    }

    const { data: activeSubscription, error: subscriptionError } = await supabaseAdmin
        .from('subscriptions')
        .select('id')
        .eq('student_id', existing.id)
        .in('status', ['active', 'pending', 'paused'])
        .limit(1)
        .maybeSingle();
    if (subscriptionError) throw subscriptionError;
    if (activeSubscription && !options.allowBlockingSubscription) {
        throw new Error('The owned checkout smoke student has an active or pending subscription; refusing destructive cleanup.');
    }

    return existing.id;
}

async function expireOwnedOpenCheckoutIntents(userId: string) {
    const { data: intents, error } = await supabaseAdmin
        .from('checkout_intents')
        .select('id, opportunity_id, stripe_checkout_session_id, status')
        .eq('student_id', userId)
        .in('status', ['creating', 'open']);
    if (error) throw error;

    for (const intent of intents ?? []) {
        const { data: opportunity, error: opportunityError } = await supabaseAdmin
            .from('crm_opportunities')
            .select('id, interest, converted_subscription_id')
            .eq('id', intent.opportunity_id)
            .maybeSingle();
        if (opportunityError) throw opportunityError;
        if (
            !opportunity
            || !['checkout-smoke', 'staging-checkout-bootstrap'].includes(opportunity.interest ?? '')
            || opportunity.converted_subscription_id
        ) {
            throw new Error('A non-smoke Checkout intent is already open for the reusable student; refusing to modify it.');
        }

        if (intent.stripe_checkout_session_id) {
            const session = await stripe.checkout.sessions.retrieve(intent.stripe_checkout_session_id);
            if (session.status === 'complete') {
                throw new Error('A previous owned smoke checkout completed; refusing to overwrite its reconciliation state.');
            }
            if (session.status === 'open') {
                await stripe.checkout.sessions.expire(session.id);
            }
        }

        const { error: expireError } = await supabaseAdmin
            .from('checkout_intents')
            .update({ status: 'expired', updated_at: new Date().toISOString() })
            .eq('id', intent.id)
            .in('status', ['creating', 'open']);
        if (expireError) throw expireError;
        const { error: deleteIntentError } = await supabaseAdmin
            .from('checkout_intents')
            .delete()
            .eq('id', intent.id)
            .eq('status', 'expired');
        if (deleteIntentError) throw deleteIntentError;
        const { error: deleteOpportunityError } = await supabaseAdmin
            .from('crm_opportunities')
            .delete()
            .eq('id', opportunity.id)
            .in('interest', ['checkout-smoke', 'staging-checkout-bootstrap'])
            .is('converted_subscription_id', null);
        if (deleteOpportunityError) throw deleteOpportunityError;
    }
}

async function ensureCheckoutApproval(
    userId: string,
    packageId: string,
    interest: SmokeCheckout['interest'],
): Promise<string> {
    const now = new Date().toISOString();
    const { data: existingContact, error: contactReadError } = await supabaseAdmin
        .from('crm_contacts')
        .select('id')
        .eq('profile_id', userId)
        .limit(1)
        .maybeSingle();
    if (contactReadError) throw contactReadError;

    const contactId = existingContact?.id;
    if (!contactId) throw new Error('The existing smoke student must already have a CRM contact.');

    const { data, error } = await supabaseAdmin
        .from('crm_opportunities')
        .insert({
            contact_id: contactId,
            stage: 'proposal',
            preferred_package_id: packageId,
            checkout_approved_at: now,
            interest,
        })
        .select('id')
        .single();
    if (error || !data) throw error ?? new Error('Could not create the smoke checkout approval.');
    return data.id;
}

async function signInForCheckout(
    email: string,
    password: string
): Promise<{ browser: Browser; page: Page }> {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ baseURL: baseUrl });

    try {
        await page.goto('/es/login');
        await page.waitForFunction(() => {
            const island = document.querySelector('astro-island');
            return island && !island.hasAttribute('ssr');
        }, { timeout: 10_000 });

        await page.fill('input[type="email"]', email);
        await page.fill('input[type="password"]', password);
        await page.click('button[type="submit"]');
        await page.waitForURL(/\/campus/, { timeout: 15_000 });
        return { browser, page };
    } catch (error) {
        await browser.close();
        throw error;
    }
}

async function createCheckout(page: Page, priceId: string): Promise<{ url: string; sessionId: string }> {
    const response = await page.request.post('/api/create-checkout', {
        data: {
            priceId,
            lang: 'es',
            adultConfirmed: true,
            termsAccepted: true,
            serviceStartRequested: true,
            withdrawalLossAcknowledged: true,
        },
    });
    const json = await response.json() as { url?: string; error?: string };
    if (!response.ok()) {
        throw new Error(`Checkout endpoint failed (${response.status()}): ${json.error || 'unknown error'}`);
    }
    if (!json.url?.startsWith('https://checkout.stripe.com/')) {
        throw new Error('Checkout endpoint did not return a Stripe Checkout URL.');
    }

    const sessionId = json.url.match(/\bcs_(?:test|live)_[A-Za-z0-9_]+/)?.[0];
    if (!sessionId) throw new Error('Could not identify the Stripe Checkout Session safely.');
    return { url: json.url, sessionId };
}

async function verifyCheckout(
    userId: string,
    opportunityId: string,
    packagePrice: PackagePrice,
    sessionId: string,
    interest: SmokeCheckout['interest'],
): Promise<SmokeCheckout> {
    const [session, intentResult] = await Promise.all([
        stripe.checkout.sessions.retrieve(sessionId),
        supabaseAdmin
            .from('checkout_intents')
            .select('id, opportunity_id, student_id, package_price_id, stripe_checkout_session_id, status')
            .eq('stripe_checkout_session_id', sessionId)
            .single(),
    ]);
    if (intentResult.error || !intentResult.data) throw intentResult.error ?? new Error('Checkout intent was not recorded.');
    const intent = intentResult.data;

    if (
        session.status !== 'open'
        || session.livemode
        || session.mode !== 'subscription'
        || session.metadata?.userId !== userId
        || session.metadata?.packagePriceId !== packagePrice.id
        || session.metadata?.crmOpportunityId !== opportunityId
        || session.metadata?.checkoutIntentId !== intent.id
        || intent.status !== 'open'
        || intent.student_id !== userId
        || intent.opportunity_id !== opportunityId
        || intent.package_price_id !== packagePrice.id
    ) {
        throw new Error('Stripe Checkout and the recorded checkout_intent do not match the approved package_price.');
    }

    return { opportunityId, packagePrice, sessionId, intentId: intent.id, interest };
}

async function closeSmokeCheckout(checkout: SmokeCheckout | null) {
    if (!checkout) return;

    if (checkout.sessionId) {
        const session = await stripe.checkout.sessions.retrieve(checkout.sessionId);
        if (session.status === 'open') await stripe.checkout.sessions.expire(session.id);
        if (session.status === 'complete') {
            throw new Error('The smoke Checkout Session completed unexpectedly; preserving it for webhook reconciliation.');
        }
    }

    let intentId = checkout.intentId;
    if (!intentId && checkout.sessionId) {
        const { data: intent, error: intentReadError } = await supabaseAdmin
            .from('checkout_intents')
            .select('id')
            .eq('stripe_checkout_session_id', checkout.sessionId)
            .maybeSingle();
        if (intentReadError) throw intentReadError;
        intentId = intent?.id ?? '';
    }
    if (!intentId) {
        const { data: intent, error: intentReadError } = await supabaseAdmin
            .from('checkout_intents')
            .select('id')
            .eq('opportunity_id', checkout.opportunityId)
            .in('status', ['creating', 'open'])
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
        if (intentReadError) throw intentReadError;
        intentId = intent?.id ?? '';
    }

    const now = new Date().toISOString();
    if (intentId) {
        const { error: intentError } = await supabaseAdmin
            .from('checkout_intents')
            .update({ status: 'expired', updated_at: now })
            .eq('id', intentId)
            .in('status', ['creating', 'open']);
        if (intentError) throw intentError;
    }

    const { error: approvalError } = await supabaseAdmin
        .from('crm_opportunities')
        .update({ checkout_approved_at: null, updated_at: now })
        .eq('id', checkout.opportunityId)
        .is('converted_subscription_id', null);
    if (approvalError) throw approvalError;

    const { error: intentDeleteError } = await supabaseAdmin
        .from('checkout_intents')
        .delete()
        .eq('opportunity_id', checkout.opportunityId)
        .in('status', ['expired', 'failed']);
    if (intentDeleteError) throw intentDeleteError;

    const { error: opportunityDeleteError } = await supabaseAdmin
        .from('crm_opportunities')
        .delete()
        .eq('id', checkout.opportunityId)
        .eq('interest', checkout.interest)
        .is('converted_subscription_id', null);
    if (opportunityDeleteError) throw opportunityDeleteError;
}

async function inspectReusableBootstrapCustomer(userId: string): Promise<BootstrapCustomer | null> {
    const { data: profilePrivate, error } = await supabaseAdmin
        .from('profiles_private')
        .select('profile_id, stripe_customer_id, stripe_customer_account_id, stripe_customer_livemode')
        .eq('profile_id', userId)
        .single();
    if (error) throw error;
    if (!profilePrivate.stripe_customer_id) {
        if (profilePrivate.stripe_customer_account_id || profilePrivate.stripe_customer_livemode !== null) {
            throw new Error('The bootstrap student has an incomplete Stripe Customer snapshot.');
        }
        return null;
    }
    if (
        profilePrivate.stripe_customer_account_id !== stagingStripeAccountId
        || profilePrivate.stripe_customer_livemode !== false
    ) {
        throw new Error('The bootstrap student is linked to a different Stripe account or mode.');
    }

    const customer = await stripe.customers.retrieve(profilePrivate.stripe_customer_id);
    if (customer.deleted || customer.metadata.supabase_user_id !== userId) {
        throw new Error('The stored bootstrap Stripe Customer is missing or belongs to another user.');
    }
    const testClockId = stripeObjectId(customer.test_clock);
    if (!testClockId) {
        throw new Error('The stored bootstrap Stripe Customer is not attached to a Test Clock.');
    }
    const testClock = await stripe.testHelpers.testClocks.retrieve(testClockId);
    if (testClock.status !== 'ready') {
        throw new Error('The bootstrap Test Clock is not ready.');
    }

    return {
        customerId: customer.id,
        testClockId,
        createdByThisRun: false,
    };
}

async function ensureBootstrapCustomer(userId: string): Promise<BootstrapCustomer> {
    const existing = await inspectReusableBootstrapCustomer(userId);
    if (existing) return existing;

    const frozenTime = Math.floor(Date.now() / 1000);
    const testClock = await stripe.testHelpers.testClocks.create({
        frozen_time: frozenTime,
        name: `espanolhonesto-staging-${userId}-${frozenTime}`,
    });

    try {
        const customer = await stripe.customers.create({
            email: smokeEmail,
            test_clock: testClock.id,
            metadata: {
                supabase_user_id: userId,
                source: 'staging-checkout-bootstrap',
            },
        }, {
            idempotencyKey: `staging-checkout-bootstrap:${userId}:${testClock.id}`,
        });
        const { data: updated, error: updateError } = await supabaseAdmin
            .from('profiles_private')
            .update({
                stripe_customer_id: customer.id,
                stripe_customer_account_id: stagingStripeAccountId,
                stripe_customer_livemode: false,
                updated_at: new Date().toISOString(),
            })
            .eq('profile_id', userId)
            .is('stripe_customer_id', null)
            .select('profile_id')
            .maybeSingle();
        if (updateError || !updated) {
            throw updateError ?? new Error('The bootstrap Customer snapshot could not be claimed atomically.');
        }

        return {
            customerId: customer.id,
            testClockId: testClock.id,
            createdByThisRun: true,
        };
    } catch (error) {
        try {
            await cleanupOwnedBootstrapArtifacts(userId);
        } catch (cleanupError) {
            throw new AggregateError(
                [error, cleanupError],
                'Bootstrap Customer creation failed and its cleanup could not be verified.',
            );
        }
        throw error;
    }
}

async function cleanupBootstrapCustomer(
    userId: string,
    customer: BootstrapCustomer | null,
    force = false,
) {
    if (!customer || (!customer.createdByThisRun && !force)) return;

    let stripeCustomerMissing = false;
    try {
        const stripeCustomer = await stripe.customers.retrieve(customer.customerId);
        if (
            stripeCustomer.deleted
            || stripeCustomer.metadata.supabase_user_id !== userId
            || stripeCustomer.metadata.source !== 'staging-checkout-bootstrap'
            || stripeObjectId(stripeCustomer.test_clock) !== customer.testClockId
        ) {
            throw new Error('Refusing to clean a Stripe Customer outside the exact bootstrap ownership boundary.');
        }
        const subscriptions = await stripe.subscriptions.list({
            customer: customer.customerId,
            status: 'all',
            limit: 1,
        });
        if (subscriptions.data.length > 0) {
            throw new Error('Refusing to clean a bootstrap Customer with completed billing evidence.');
        }
        for await (const session of stripe.checkout.sessions.list({ customer: customer.customerId, limit: 100 })) {
            if (session.status === 'complete') {
                throw new Error('Refusing to clean a bootstrap Customer with completed billing evidence.');
            }
            if (session.status === 'open') await stripe.checkout.sessions.expire(session.id);
        }
        const deleted = await stripe.customers.del(customer.customerId);
        if (!deleted.deleted) throw new Error('Stripe did not confirm bootstrap Customer deletion.');
    } catch (error) {
        if (isStripeResourceMissing(error)) stripeCustomerMissing = true;
        else throw error;
    }

    try {
        const deletedClock = await stripe.testHelpers.testClocks.del(customer.testClockId);
        if (!deletedClock.deleted) throw new Error('Stripe did not confirm bootstrap Test Clock deletion.');
    } catch (error) {
        if (!isStripeResourceMissing(error)) throw error;
    }

    const { data: profilePrivate, error: profileReadError } = await supabaseAdmin
        .from('profiles_private')
        .select('profile_id, stripe_customer_id')
        .eq('profile_id', userId)
        .single();
    if (profileReadError) throw profileReadError;
    if (profilePrivate.stripe_customer_id && profilePrivate.stripe_customer_id !== customer.customerId) {
        throw new Error('The bootstrap Customer snapshot changed before cleanup.');
    }
    if (profilePrivate.stripe_customer_id === customer.customerId) {
        const { data: cleared, error } = await supabaseAdmin
            .from('profiles_private')
            .update({
                stripe_customer_id: null,
                stripe_customer_account_id: null,
                stripe_customer_livemode: null,
                updated_at: new Date().toISOString(),
            })
            .eq('profile_id', userId)
            .eq('stripe_customer_id', customer.customerId)
            .select('profile_id')
            .maybeSingle();
        if (error || !cleared) {
            throw error ?? new Error('The bootstrap Customer snapshot could not be cleared atomically.');
        }
    }

    if (!stripeCustomerMissing) {
        try {
            await stripe.customers.retrieve(customer.customerId);
            throw new Error('Bootstrap Customer still exists after verified cleanup.');
        } catch (error) {
            if (!isStripeResourceMissing(error)) throw error;
        }
    }
}

async function cleanupOwnedBootstrapArtifacts(userId: string) {
    await expireOwnedOpenCheckoutIntents(userId);
    await cleanupOrphanBootstrapOpportunities(userId);

    const { data: linkedProfile, error: linkedProfileError } = await supabaseAdmin
        .from('profiles_private')
        .select('stripe_customer_id, stripe_customer_account_id, stripe_customer_livemode')
        .eq('profile_id', userId)
        .single();
    if (linkedProfileError) throw linkedProfileError;
    if (linkedProfile.stripe_customer_id) {
        if (
            linkedProfile.stripe_customer_account_id !== stagingStripeAccountId
            || linkedProfile.stripe_customer_livemode !== false
        ) {
            throw new Error('Refusing cleanup of a Customer snapshot outside the exact staging Sandbox.');
        }
        try {
            const linkedCustomer = await stripe.customers.retrieve(linkedProfile.stripe_customer_id);
            if (linkedCustomer.deleted) {
                await clearBootstrapCustomerSnapshot(userId, linkedProfile.stripe_customer_id);
            } else {
                const linkedClockId = stripeObjectId(linkedCustomer.test_clock);
                if (
                    linkedCustomer.metadata.supabase_user_id !== userId
                    || linkedCustomer.metadata.source !== 'staging-checkout-bootstrap'
                    || !linkedClockId
                ) {
                    throw new Error('Refusing cleanup of a linked Customer outside the exact bootstrap ownership boundary.');
                }
                await cleanupBootstrapCustomer(userId, {
                    customerId: linkedCustomer.id,
                    testClockId: linkedClockId,
                    createdByThisRun: true,
                }, true);
            }
        } catch (error) {
            if (isStripeResourceMissing(error)) {
                await clearBootstrapCustomerSnapshot(userId, linkedProfile.stripe_customer_id);
            } else {
                throw error;
            }
        }
    }

    const clockPrefix = `espanolhonesto-staging-${userId}-`;
    const ownedClocks: Stripe.TestHelpers.TestClock[] = [];
    for await (const clock of stripe.testHelpers.testClocks.list({ limit: 100 })) {
        if (clock.name?.startsWith(clockPrefix)) ownedClocks.push(clock);
    }
    for (const clock of ownedClocks) {
        if (clock.status !== 'ready') {
            throw new Error('An owned bootstrap Test Clock is not ready for verified cleanup.');
        }
        const customers: Stripe.Customer[] = [];
        for await (const customer of stripe.customers.list({ test_clock: clock.id, limit: 100 })) {
            customers.push(customer);
        }
        const ownedCustomers = customers.filter((customer) => (
            customer.metadata.supabase_user_id === userId
            && customer.metadata.source === 'staging-checkout-bootstrap'
        ));
        if (customers.length !== ownedCustomers.length || ownedCustomers.length > 1) {
            throw new Error('An owned bootstrap Test Clock contains resources outside the exact cleanup boundary.');
        }
        if (ownedCustomers.length === 0) {
            const deletedClock = await stripe.testHelpers.testClocks.del(clock.id);
            if (!deletedClock.deleted) throw new Error('Stripe did not confirm orphan Test Clock deletion.');
            continue;
        }
        await cleanupBootstrapCustomer(userId, {
            customerId: ownedCustomers[0].id,
            testClockId: clock.id,
            createdByThisRun: true,
        }, true);
    }

    const { data: remainingProfile, error: remainingError } = await supabaseAdmin
        .from('profiles_private')
        .select('stripe_customer_id, stripe_customer_account_id, stripe_customer_livemode')
        .eq('profile_id', userId)
        .single();
    if (remainingError) throw remainingError;
    if (
        remainingProfile.stripe_customer_id
        || remainingProfile.stripe_customer_account_id
        || remainingProfile.stripe_customer_livemode !== null
    ) {
        throw new Error('Bootstrap cleanup left a Stripe Customer snapshot behind.');
    }
}

async function clearBootstrapCustomerSnapshot(userId: string, customerId: string) {
    const { data: cleared, error } = await supabaseAdmin
        .from('profiles_private')
        .update({
            stripe_customer_id: null,
            stripe_customer_account_id: null,
            stripe_customer_livemode: null,
            updated_at: new Date().toISOString(),
        })
        .eq('profile_id', userId)
        .eq('stripe_customer_id', customerId)
        .eq('stripe_customer_account_id', stagingStripeAccountId)
        .eq('stripe_customer_livemode', false)
        .select('profile_id')
        .maybeSingle();
    if (error || !cleared) {
        throw error ?? new Error('The stale bootstrap Customer snapshot could not be cleared atomically.');
    }
}

async function cleanupOrphanBootstrapOpportunities(userId: string) {
    const { data: contact, error: contactError } = await supabaseAdmin
        .from('crm_contacts')
        .select('id')
        .eq('profile_id', userId)
        .limit(1)
        .maybeSingle();
    if (contactError) throw contactError;
    if (!contact) return;

    const { data: opportunities, error: opportunityError } = await supabaseAdmin
        .from('crm_opportunities')
        .select('id')
        .eq('contact_id', contact.id)
        .eq('interest', 'staging-checkout-bootstrap')
        .is('converted_subscription_id', null);
    if (opportunityError) throw opportunityError;

    for (const opportunity of opportunities ?? []) {
        const { data: intents, error: intentError } = await supabaseAdmin
            .from('checkout_intents')
            .select('id, status')
            .eq('opportunity_id', opportunity.id);
        if (intentError) throw intentError;
        if ((intents ?? []).some((intent) => ['creating', 'open', 'completed'].includes(intent.status))) {
            throw new Error('Refusing orphan cleanup because a bootstrap opportunity still has a live or completed intent.');
        }
        const { error: intentDeleteError } = await supabaseAdmin
            .from('checkout_intents')
            .delete()
            .eq('opportunity_id', opportunity.id)
            .in('status', ['expired', 'failed']);
        if (intentDeleteError) throw intentDeleteError;
        const { error: opportunityDeleteError } = await supabaseAdmin
            .from('crm_opportunities')
            .delete()
            .eq('id', opportunity.id)
            .eq('interest', 'staging-checkout-bootstrap')
            .is('converted_subscription_id', null);
        if (opportunityDeleteError) throw opportunityDeleteError;
    }

    const { data: remaining, error: remainingError } = await supabaseAdmin
        .from('crm_opportunities')
        .select('id')
        .eq('contact_id', contact.id)
        .eq('interest', 'staging-checkout-bootstrap')
        .is('converted_subscription_id', null)
        .limit(1)
        .maybeSingle();
    if (remainingError || remaining) {
        throw remainingError ?? new Error('Bootstrap cleanup left an unconverted CRM opportunity behind.');
    }
}

function isStripeResourceMissing(error: unknown): boolean {
    return (error as { code?: unknown })?.code === 'resource_missing';
}

function copyCheckoutUrlToClipboard(checkoutUrl: string) {
    if (process.platform !== 'win32') {
        throw new Error('The bootstrap Checkout handoff currently requires the Windows clipboard.');
    }
    const result = spawnSync('powershell.exe', [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        '$value = [Console]::In.ReadToEnd(); Set-Clipboard -Value $value',
    ], {
        input: checkoutUrl,
        encoding: 'utf8',
        windowsHide: true,
        timeout: 15_000,
    });
    if (result.error || result.status !== 0) {
        throw new Error('The verified test Checkout URL could not be copied to the local clipboard.');
    }
}

function stripeObjectId(value: string | { id: string } | null | undefined): string | null {
    return typeof value === 'string' ? value : value?.id ?? null;
}

async function main() {
    assertExistingAllowlistedStudent();
    assertCheckoutGateConfirmation();
    if (BOOTSTRAP_PRESERVE_OPEN || BOOTSTRAP_CLEANUP) assertCheckoutBootstrapApproval();

    if (BOOTSTRAP_CLEANUP) {
        await assertExactBootstrapStripeAccount();
        const cleanupUserId = await getExistingSmokeUser(smokeEmail, { allowBlockingSubscription: true });
        await cleanupOwnedBootstrapArtifacts(cleanupUserId);
        console.log('Checkout bootstrap cleanup passed: owned incomplete Stripe/Supabase artifacts are absent.');
        return;
    }

    const packagePrice = await getCheckoutOffer();
    const userId = await getExistingSmokeUser(smokeEmail);

    if (BOOTSTRAP_PREFLIGHT) {
        await inspectReusableBootstrapCustomer(userId);
        await probeCheckoutGateDisabledReadOnly();
        console.log('Checkout bootstrap preflight passed without external writes.');
        return;
    }

    await probeCheckoutGateEnabledReadOnly();
    let checkout: SmokeCheckout | null = null;
    let bootstrapCustomer: BootstrapCustomer | null = null;
    let preserveCheckout = false;
    let browser: Browser | null = null;
    const interest: SmokeCheckout['interest'] = BOOTSTRAP_PRESERVE_OPEN
        ? 'staging-checkout-bootstrap'
        : 'checkout-smoke';

    try {
        const authenticated = await signInForCheckout(smokeEmail, smokePassword);
        browser = authenticated.browser;
        // All configuration, account, catalog, deployed-gate and role-credential
        // preconditions are now valid. Cleanup of prior owned intents is the
        // first durable smoke-resource write.
        await expireOwnedOpenCheckoutIntents(userId);
        if (BOOTSTRAP_PRESERVE_OPEN) {
            bootstrapCustomer = await ensureBootstrapCustomer(userId);
        }
        const opportunityId = await ensureCheckoutApproval(userId, packagePrice.package_id, interest);
        checkout = { opportunityId, packagePrice, sessionId: '', intentId: '', interest };
        const created = await createCheckout(authenticated.page, packagePrice.stripe_price_id);
        checkout = {
            opportunityId,
            packagePrice,
            sessionId: created.sessionId,
            intentId: '',
            interest,
        };
        checkout = await verifyCheckout(userId, opportunityId, packagePrice, created.sessionId, interest);
        if (BOOTSTRAP_PRESERVE_OPEN) {
            copyCheckoutUrlToClipboard(created.url);
            preserveCheckout = true;
            console.log('Checkout bootstrap passed: one verified Stripe test session is open and available only in the local clipboard.');
        } else {
            console.log('Checkout smoke passed: approved package_price and checkout_intent verified in Stripe test mode.');
        }
    } finally {
        try {
            if (!preserveCheckout) await closeSmokeCheckout(checkout);
        } finally {
            try {
                if (!preserveCheckout) await cleanupBootstrapCustomer(userId, bootstrapCustomer);
            } finally {
                await browser?.close();
            }
        }
    }
}

function assertExistingAllowlistedStudent() {
    const allowlist = new Set(
        emailRecipientAllowlist
            .split(/[;,]/u)
            .map((email) => email.trim().toLowerCase())
            .filter(Boolean)
    );
    if (smokeEmail.toLowerCase().endsWith('@example.com') || !allowlist.has(smokeEmail.toLowerCase())) {
        throw new Error('SMOKE_STUDENT_EMAIL must be the existing allowlisted test student; example.com recipients are forbidden.');
    }
}

function assertCheckoutGateConfirmation() {
    const expected = `enabled-after-separate-cloudflare-approval:${new URL(baseUrl).host}`;
    if (checkoutGateConfirmation !== expected) {
        throw new Error('STAGING_CHECKOUT_GATE_CONFIRMATION does not match the separately approved staging gate change.');
    }
}

function assertCheckoutBootstrapApproval() {
    if (process.env[STAGING_CHECKOUT_BOOTSTRAP_APPROVAL_ENV] !== EXACT_STAGING_CHECKOUT_BOOTSTRAP_APPROVAL) {
        throw new Error(`Missing exact ${STAGING_CHECKOUT_BOOTSTRAP_APPROVAL_ENV} approval.`);
    }
}

async function assertExactBootstrapStripeAccount() {
    const account = await stripe.accounts.retrieve();
    if (
        account.id !== stagingStripeAccountId
        || account.country !== 'ES'
        || account.default_currency !== 'eur'
    ) {
        throw new Error(`Checkout bootstrap cleanup only accepts Stripe Sandbox ${stagingStripeAccountId} configured as Spain/EUR.`);
    }
}

async function probeCheckoutGateEnabledReadOnly() {
    const response = await fetch(`${baseUrl}/api/create-checkout`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            priceId: 'price_read_only_gate_probe',
            lang: 'es',
            adultConfirmed: true,
            termsAccepted: true,
            serviceStartRequested: true,
            withdrawalLossAcknowledged: true,
        }),
    });
    if (response.status !== 401) {
        throw new Error(response.status === 403
            ? 'Staging checkout is disabled; obtain the separate Cloudflare gate approval before the smoke.'
            : `Read-only checkout gate probe expected 401 and received ${response.status}.`);
    }
}

async function probeCheckoutGateDisabledReadOnly() {
    const response = await fetch(`${baseUrl}/api/create-checkout`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            priceId: 'price_read_only_gate_probe',
            lang: 'es',
            adultConfirmed: true,
            termsAccepted: true,
            serviceStartRequested: true,
            withdrawalLossAcknowledged: true,
        }),
    });
    if (response.status !== 403) {
        throw new Error(`Read-only checkout bootstrap preflight expected disabled 403 and received ${response.status}.`);
    }
}

function requireEnv(name: string): string {
    const value = process.env[name]?.trim();
    if (!value) throw new Error(`Missing ${name}.`);
    return value;
}

function normalizeAndConfirmSmokeBaseUrl(rawBaseUrl: string, confirmation: string): string {
    let parsedUrl: URL;
    try {
        parsedUrl = new URL(rawBaseUrl);
    } catch {
        throw new Error('SMOKE_BASE_URL (or TEST_BASE_URL) must be an absolute http(s) origin.');
    }
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
        throw new Error('The checkout smoke base URL must use http or https.');
    }
    if ((parsedUrl.pathname !== '/' && parsedUrl.pathname !== '') || parsedUrl.search || parsedUrl.hash) {
        throw new Error('The checkout smoke base URL must be an origin only.');
    }
    const allowedHosts = new Set([
        'localhost:4321',
        '127.0.0.1:4321',
        'espanolhonesto-staging.alindev95.workers.dev',
    ]);
    if (!allowedHosts.has(parsedUrl.host)) {
        throw new Error('The checkout smoke only accepts localhost or the exact staging Worker host.');
    }

    const expected = `writes-ok:${parsedUrl.host}`;
    if (confirmation !== expected) {
        throw new Error(`SMOKE_EXTERNAL_WRITES_CONFIRMATION must be "${expected}" for this checkout smoke.`);
    }
    return parsedUrl.origin;
}

main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(
        message
            .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[redacted-email]')
            .replace(/https?:\/\/[^\s"')]+/g, '[redacted-url]')
            .replace(/\b(?:cs|cus|sub|in|pi|evt|price|prod|pm)_(?:test|live)?_?[A-Za-z0-9_]+\b/g, '[redacted-stripe-id]')
    );
    process.exitCode = 1;
});
