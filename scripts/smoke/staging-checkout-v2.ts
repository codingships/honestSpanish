/**
 * One deliberately synthetic Checkout V2 purchase against canonical staging.
 *
 * Preflight is read-only. Execute is constrained by the confirmation token and
 * the allowlists in staging-checkout-v2-safety.ts. The permanent Stripe catalog
 * and its dedicated single-use capacity slot are asserted exactly, while every
 * purchase gets a fresh synthetic student.
 * Immutable billing evidence is retained; transient Stripe billing is closed
 * in finally so a failed run cannot leave a chargeable test subscription.
 */
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createBrowserClient } from '@supabase/ssr';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { parse } from 'dotenv';
import { chromium } from 'playwright';
import Stripe from 'stripe';
import type { Database } from '../../src/types/database.types';
import { CHECKOUT_TERMS_VERSION } from '../../src/lib/legal-policy';
import { completeStripeCheckoutSandbox } from './staging-checkout-v2-browser';
import {
    parseStagingCheckoutV2Args,
    safeStagingCheckoutV2Summary,
    stagingBrowserCookies,
    STAGING_CHECKOUT_V2_IDENTITY,
    type StagingCheckoutV2Gate,
    validateStagingCheckoutV2Gate,
} from './staging-checkout-v2-safety';

const packageKey = 'individual_4x50_28d';
const amountCents = 25_900;
const currency = 'eur';
const webhookPath = '/api/stripe-webhook';
const fixtures = Object.freeze({
    initialPriceId: 'price_1Tzz5MC22M3erP0jQYMb166L',
    packageId: 'cc8c0290-a0b5-4358-94e3-696edaec48ec',
    packagePriceId: 'ab7c18d9-154d-4c67-b923-2b822cca962d',
    productId: 'prod_Uzz3n6jX0vHDdl',
    recurringPriceId: 'price_1Tzz5NC22M3erP0j5tqhot57',
    slotFirstClassAt: '2026-08-10T14:00:00+00:00',
    slotId: 'f2234997-efe9-4e1c-8d29-291452454a16',
    slotPublicId: '3dc6cdb0-7f72-4e67-9673-dc5bd3b768b0',
    teacherId: '3ee5d324-e8a0-4633-a162-e6cf56c66fa4',
});
const requiredWebhookEvents: Stripe.WebhookEndpointCreateParams.EnabledEvent[] = [
    'charge.refunded',
    'checkout.session.completed',
    'checkout.session.expired',
    'customer.subscription.deleted',
    'customer.subscription.updated',
    'invoice.paid',
    'invoice.payment_failed',
    'invoice.upcoming',
    'refund.created',
    'refund.failed',
    'refund.updated',
];

type Env = Record<string, string>;
type Log = (line: string) => void;
type AuthCookie = { name: string; value: string };

export type StagingCheckoutV2RunState = {
    adminCookie?: string;
    checkoutSessionId?: string;
    completedPurchase?: boolean;
    declinedPaymentObserved?: boolean;
    grantCookie?: string;
    runId: string;
    slotId?: string;
    slotPublicId?: string;
    stripeCustomerId?: string;
    stripeSubscriptionId?: string;
    studentCookie?: string;
    studentId?: string;
    subscriptionId?: string;
    syntheticEmail: string;
};

export type StagingCheckoutV2Journey = {
    cleanup(env: Env, state: StagingCheckoutV2RunState, log: Log): Promise<void>;
    execute(env: Env, state: StagingCheckoutV2RunState, log: Log): Promise<void>;
    preflight(env: Env, log: Log): Promise<void>;
};

type RunnerDependencies = {
    envFile?: string;
    journey?: StagingCheckoutV2Journey;
    log?: Log;
    readText?: (file: string) => string;
    repositoryRemote?: (workspaceRoot: string) => string;
    workspaceRoot?: string;
};

type RealContext = {
    admin: SupabaseClient<Database>;
    stripe: Stripe;
};

function required(env: Env, key: string): string {
    const value = env[key]?.trim();
    if (!value) throw new Error(`Staging Checkout V2 requires ${key}`);
    return value;
}

function readRepositoryRemote(workspaceRoot: string): string {
    return execFileSync('git', ['remote', 'get-url', 'origin'], {
        cwd: workspaceRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        windowsHide: true,
    }).trim();
}

function canonicalWorkspaceRoot(worktreeRoot: string): string {
    const commonGitDir = execFileSync(
        'git',
        ['rev-parse', '--path-format=absolute', '--git-common-dir'],
        { cwd: worktreeRoot, encoding: 'utf8', windowsHide: true },
    ).trim();
    return path.dirname(commonGitDir);
}

function defaultEnvFile(worktreeRoot: string): string {
    const primary = path.resolve(canonicalWorkspaceRoot(worktreeRoot), '.env.staging');
    if (existsSync(primary)) return primary;
    return path.resolve(worktreeRoot, '.env.staging');
}

function createRunState(now = new Date()): StagingCheckoutV2RunState {
    const stamp = now.toISOString().replace(/\D/gu, '').slice(0, 14);
    const suffix = randomBytes(4).toString('hex');
    const runId = `checkout-v2-${stamp}-${suffix}`;
    return {
        runId,
        syntheticEmail: `delivered+hs-stg-${stamp}-${suffix}@resend.dev`,
    };
}

function createRealContext(env: Env): RealContext {
    return {
        admin: createClient<Database>(
            required(env, 'PUBLIC_SUPABASE_URL'),
            required(env, 'SUPABASE_SERVICE_ROLE_KEY'),
            { auth: { autoRefreshToken: false, persistSession: false } },
        ),
        stripe: new Stripe(required(env, 'STRIPE_SECRET_KEY')),
    };
}

async function fetchWithTimeout(url: string, init?: RequestInit, timeoutMs = 60_000): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, { ...init, redirect: 'manual', signal: controller.signal });
    } finally {
        clearTimeout(timeout);
    }
}

async function jsonResponse(response: Response): Promise<Record<string, unknown>> {
    const value = await response.json().catch(() => null);
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}

async function postJson(
    url: string,
    cookie: string,
    body: Record<string, unknown>,
    extraHeaders: Record<string, string> = {},
): Promise<{ body: Record<string, unknown>; response: Response }> {
    const response = await fetchWithTimeout(url, {
        method: 'POST',
        headers: {
            Cookie: cookie,
            Origin: STAGING_CHECKOUT_V2_IDENTITY.webOrigin,
            'Content-Type': 'application/json',
            ...extraHeaders,
        },
        body: JSON.stringify(body),
    });
    return { body: await jsonResponse(response), response };
}

function stringValue(value: unknown, label: string): string {
    if (typeof value !== 'string' || !value) throw new Error(`${label} returned an invalid identifier`);
    return value;
}

function assertHttp(response: Response, body: Record<string, unknown>, expected: number, label: string): void {
    if (response.status !== expected) {
        const code = typeof body.errorCode === 'string' ? ` code=${body.errorCode}` : '';
        throw new Error(`${label} failed with HTTP ${response.status}${code}`);
    }
}

async function createSessionCookie(env: Env, email: string, password: string): Promise<string> {
    const jar: AuthCookie[] = [];
    const client = createBrowserClient(
        required(env, 'PUBLIC_SUPABASE_URL'),
        required(env, 'PUBLIC_SUPABASE_ANON_KEY'),
        {
            cookies: {
                getAll: () => jar,
                setAll(cookies) {
                    for (const cookie of cookies) {
                        const entry = { name: cookie.name, value: cookie.value };
                        const index = jar.findIndex((item) => item.name === entry.name);
                        if (index >= 0) jar[index] = entry;
                        else jar.push(entry);
                    }
                },
            },
        },
    );
    const { error } = await client.auth.signInWithPassword({ email, password });
    if (error || jar.length === 0) throw new Error('Synthetic staging authentication failed');
    return jar.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ');
}

function setCookieValue(response: Response, cookieName: string): string {
    const header = response.headers.get('set-cookie') ?? '';
    const match = header.match(new RegExp(`(?:^|,\\s*)${cookieName}=([^;]+)`));
    if (!match?.[1]) throw new Error('Staging Checkout V2 grant cookie was not returned');
    return `${cookieName}=${match[1]}`;
}

function combineCookies(...values: Array<string | undefined>): string {
    return values.filter(Boolean).join('; ');
}

export function stagingCheckoutV2CleanupCookieHeader(input: Pick<
    StagingCheckoutV2RunState,
    'adminCookie' | 'grantCookie'
>): string {
    return combineCookies(
        stringValue(input.adminCookie, 'Staging admin session'),
        stringValue(input.grantCookie, 'Staging checkout grant'),
    );
}

async function packageRow(admin: SupabaseClient<Database>) {
    const { data, error } = await admin
        .from('packages')
        .select('*')
        .eq('name', packageKey)
        .eq('contract_schema_version', 2)
        .limit(2);
    if (error || data?.length !== 1) throw error ?? new Error('Canonical Checkout V2 package is missing or ambiguous');
    const row = data[0]!;
    if (
        row.amount_cents !== amountCents
        || row.billing_interval_unit !== 'day'
        || row.billing_interval_count !== 28
        || row.sessions_per_period !== 4
        || row.class_duration_minutes !== 50
    ) throw new Error('Canonical Checkout V2 package does not match 259 EUR / 4x50 / 28 days');
    return row;
}

function stripeProductId(product: string | Stripe.Product | Stripe.DeletedProduct): string {
    return typeof product === 'string' ? product : product.id;
}

async function verifyExactFixtures(env: Env, context: RealContext): Promise<void> {
    const exactUrl = `${STAGING_CHECKOUT_V2_IDENTITY.webOrigin}${webhookPath}`;
    const [account, pkg, price, snapshot, slot, engagement, product, initialPrice, recurringPrice, webhooks] = await Promise.all([
        context.stripe.accounts.retrieve(),
        packageRow(context.admin),
        context.admin.from('package_prices').select('*').eq('id', fixtures.packagePriceId).single(),
        context.admin.from('checkout_v2_price_snapshots').select('*')
            .eq('package_price_id', fixtures.packagePriceId).single(),
        context.admin.from('bookable_slots').select('*').eq('id', fixtures.slotId).single(),
        context.admin.from('teacher_compensation_engagements').select('*')
            .eq('teacher_id', fixtures.teacherId).eq('engagement_kind', 'founder')
            .lte('effective_from', new Date().toISOString())
            .order('effective_from', { ascending: false }).limit(1).maybeSingle(),
        context.stripe.products.retrieve(fixtures.productId),
        context.stripe.prices.retrieve(fixtures.initialPriceId),
        context.stripe.prices.retrieve(fixtures.recurringPriceId),
        context.stripe.webhookEndpoints.list({ limit: 100 }),
    ]);
    const queryError = price.error ?? snapshot.error ?? slot.error ?? engagement.error;
    if (queryError) throw queryError;
    if (!price.data || !snapshot.data || !slot.data || !engagement.data) {
        throw new Error('Exact staging database fixtures are incomplete');
    }
    const packagePrice = price.data;
    const priceSnapshot = snapshot.data;
    const bookableSlot = slot.data;
    if (
        account.id !== STAGING_CHECKOUT_V2_IDENTITY.stripeAccountId
        || pkg.id !== fixtures.packageId
        || !pkg.is_active
        || !pkg.is_publicly_listed
        || packagePrice.package_id !== fixtures.packageId
        || packagePrice.status !== 'active'
        || packagePrice.stripe_price_id !== fixtures.recurringPriceId
        || packagePrice.stripe_product_id !== fixtures.productId
        || packagePrice.amount_cents !== amountCents
        || packagePrice.billing_interval_unit !== 'day'
        || packagePrice.billing_interval_count !== 28
        || packagePrice.sessions_per_period !== 4
        || packagePrice.class_duration_minutes !== 50
        || priceSnapshot.initial_stripe_price_id !== fixtures.initialPriceId
        || priceSnapshot.recurring_stripe_price_id !== fixtures.recurringPriceId
        || bookableSlot.public_id !== fixtures.slotPublicId
        || bookableSlot.teacher_id !== fixtures.teacherId
        || bookableSlot.status !== 'available'
        || new Date(bookableSlot.first_occurrence_at).toISOString() !== new Date(fixtures.slotFirstClassAt).toISOString()
        || engagement.data.engagement_kind !== 'founder'
        || product.id !== fixtures.productId
        || ('deleted' in product && product.deleted)
        || !('active' in product)
        || !product.active
        || initialPrice.id !== fixtures.initialPriceId
        || !initialPrice.active
        || initialPrice.type !== 'one_time'
        || initialPrice.unit_amount !== amountCents
        || initialPrice.currency !== currency
        || stripeProductId(initialPrice.product) !== fixtures.productId
        || recurringPrice.id !== fixtures.recurringPriceId
        || !recurringPrice.active
        || recurringPrice.type !== 'recurring'
        || recurringPrice.unit_amount !== amountCents
        || recurringPrice.currency !== currency
        || recurringPrice.recurring?.interval !== 'day'
        || recurringPrice.recurring.interval_count !== 28
        || stripeProductId(recurringPrice.product) !== fixtures.productId
    ) throw new Error('Exact staging Checkout V2 fixture contract drifted');
    const endpoints = webhooks.data.filter((endpoint) => endpoint.url === exactUrl && endpoint.status === 'enabled');
    if (endpoints.length !== 1) throw new Error('Exact staging Stripe webhook is missing or ambiguous');
    if (!endpoints[0]!.enabled_events.includes('*')) {
        const missing = requiredWebhookEvents.filter((event) => !endpoints[0]!.enabled_events.includes(event));
        if (missing.length) throw new Error(`Staging Stripe webhook is missing ${missing.join(',')}`);
    }
    if (required(env, 'TEST_TEACHER_EMAIL').toLowerCase() === required(env, 'TEST_ADMIN_EMAIL').toLowerCase()) {
        throw new Error('Staging teacher and admin identities must be distinct');
    }
}

async function waitForProfile(admin: SupabaseClient<Database>, studentId: string): Promise<void> {
    for (let attempt = 0; attempt < 30; attempt += 1) {
        const { data, error } = await admin.from('profiles').select('id').eq('id', studentId).maybeSingle();
        if (data) return;
        if (error) throw error;
        await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw new Error('Synthetic student profile was not created');
}

async function createSyntheticStudent(
    env: Env,
    context: RealContext,
    state: StagingCheckoutV2RunState,
): Promise<string> {
    const password = `${randomBytes(24).toString('base64url')}aA1!`;
    const { data, error } = await context.admin.auth.admin.createUser({
        email: state.syntheticEmail,
        email_confirm: true,
        password,
        user_metadata: { full_name: `Staging Checkout ${state.runId}` },
    });
    if (error || !data.user) throw error ?? new Error('Could not create synthetic student');
    state.studentId = data.user.id;
    await waitForProfile(context.admin, data.user.id);
    state.studentCookie = await createSessionCookie(env, state.syntheticEmail, password);
    const confirmed = await postJson(
        `${STAGING_CHECKOUT_V2_IDENTITY.webOrigin}/api/auth/confirm-adult`,
        state.studentCookie,
        { adultConfirmed: true },
    );
    assertHttp(confirmed.response, confirmed.body, 200, 'Synthetic adult confirmation');
    return data.user.id;
}

async function issueGrant(state: StagingCheckoutV2RunState): Promise<void> {
    const grant = await postJson(
        `${STAGING_CHECKOUT_V2_IDENTITY.webOrigin}/api/internal/staging-e2e-checkout`,
        stringValue(state.adminCookie, 'Admin authentication'),
        {
            runId: state.runId,
            slotPublicId: stringValue(state.slotPublicId, 'Synthetic slot'),
            studentId: stringValue(state.studentId, 'Synthetic student'),
        },
        { 'X-Staging-E2E-Confirmation': 'sandbox-journey' },
    );
    assertHttp(grant.response, grant.body, 201, 'Private staging checkout grant');
    state.grantCookie = setCookieValue(grant.response, '__Host-hs_staging_e2e_checkout');
}

async function createCheckout(state: StagingCheckoutV2RunState): Promise<string> {
    const endpoint = `${STAGING_CHECKOUT_V2_IDENTITY.webOrigin}/api/create-checkout`;
    const cookies = combineCookies(state.studentCookie, state.grantCookie);
    const body = {
        adultConfirmed: true,
        lang: 'en',
        policyVersion: CHECKOUT_TERMS_VERSION,
        serviceStartRequested: true,
        slotPublicId: stringValue(state.slotPublicId, 'Synthetic slot'),
        termsAccepted: true,
        withdrawalLossAcknowledged: true,
    };
    const sessionIdFromUrl = (checkoutUrl: string): string | undefined => new URL(checkoutUrl).pathname
        .split('/')
        .map((segment) => decodeURIComponent(segment))
        .find((segment) => segment.startsWith('cs_test_'));

    const first = await postJson(endpoint, cookies, body);
    assertHttp(first.response, first.body, 200, 'Checkout V2 creation');
    const checkoutUrl = stringValue(first.body.url, 'Checkout V2');
    const sessionId = sessionIdFromUrl(checkoutUrl);
    state.checkoutSessionId = stringValue(sessionId, 'Stripe Checkout Session');

    const retry = await postJson(endpoint, cookies, body);
    assertHttp(retry.response, retry.body, 200, 'Checkout V2 idempotent retry');
    const retryUrl = stringValue(retry.body.url, 'Checkout V2 idempotent retry');
    const retrySessionId = sessionIdFromUrl(retryUrl);
    if (!sessionId || retrySessionId !== sessionId) {
        throw new Error('Checkout V2 retry created or returned another Stripe Checkout Session');
    }

    return checkoutUrl;
}

async function assertDeclinedCheckoutHasNoPurchase(
    context: RealContext,
    state: StagingCheckoutV2RunState,
): Promise<void> {
    const studentId = stringValue(state.studentId, 'Synthetic student');
    const checkoutSessionId = stringValue(state.checkoutSessionId, 'Stripe Checkout Session');
    const [checkout, subscriptions] = await Promise.all([
        context.stripe.checkout.sessions.retrieve(checkoutSessionId),
        context.admin.from('subscriptions').select('id').eq('student_id', studentId).limit(2),
    ]);
    const stripeSubscriptionId = typeof checkout.subscription === 'string'
        ? checkout.subscription
        : checkout.subscription?.id;
    if (
        subscriptions.error
        || (subscriptions.data?.length ?? 0) !== 0
        || checkout.id !== checkoutSessionId
        || checkout.status !== 'open'
        || checkout.payment_status !== 'unpaid'
        || stripeSubscriptionId
    ) throw new Error('Declined Stripe Sandbox payment materialized a purchase');
}

async function completeCheckout(
    checkoutUrl: string,
    realContext: RealContext,
    state: StagingCheckoutV2RunState,
): Promise<void> {
    const browser = await chromium.launch({ headless: true });
    try {
        const browserContext = await browser.newContext();
        await browserContext.addCookies(stagingBrowserCookies(
            stringValue(state.studentCookie, 'Student authentication'),
        ));
        const page = await browserContext.newPage();
        const result = await completeStripeCheckoutSandbox({
            afterDecline: () => assertDeclinedCheckoutHasNoPurchase(realContext, state),
            checkoutUrl,
            exerciseDeclineBeforeSuccess: true,
            page,
            syntheticEmail: state.syntheticEmail,
            timeoutMs: 90_000,
        });
        if (!result.declinedPaymentObserved) {
            throw new Error('Stripe Sandbox decline was not observed before successful payment');
        }
        state.declinedPaymentObserved = true;
        state.completedPurchase = true;
    } finally {
        await browser.close();
    }
}

async function waitForPurchase(context: RealContext, state: StagingCheckoutV2RunState): Promise<void> {
    const studentId = stringValue(state.studentId, 'Synthetic student');
    const deadline = Date.now() + 180_000;
    let lastStatus = 'not-observed';
    while (Date.now() < deadline) {
        const { data: subscriptions, error } = await context.admin
            .from('subscriptions')
            .select('*')
            .eq('student_id', studentId)
            .eq('contract_schema_version', 2)
            .limit(2);
        if (error) throw error;
        const subscription = subscriptions?.length === 1 ? subscriptions[0]! : null;
        if (!subscription) {
            lastStatus = 'subscription-pending';
            await new Promise((resolve) => setTimeout(resolve, 1_500));
            continue;
        }
        state.subscriptionId = subscription.id;
        state.stripeSubscriptionId = subscription.stripe_subscription_id ?? undefined;

        const [sessions, payments, cycles, jobs, slot] = await Promise.all([
            context.admin.from('sessions').select('*').eq('subscription_id', subscription.id)
                .order('checkout_v2_cycle_session_index', { ascending: true }),
            context.admin.from('payments').select('*').eq('subscription_id', subscription.id),
            context.admin.from('checkout_v2_cycles').select('*').eq('subscription_id', subscription.id),
            context.admin.from('fulfillment_jobs').select('*').eq('subscription_id', subscription.id),
            context.admin.from('bookable_slots').select('*')
                .eq('id', stringValue(state.slotId, 'Synthetic slot')).single(),
        ]);
        const queryError = sessions.error ?? payments.error ?? cycles.error ?? jobs.error ?? slot.error;
        if (queryError) throw queryError;
        const welcome = jobs.data?.find((job) => job.job_type === 'welcome_fulfillment');
        const classes = jobs.data?.find((job) => job.job_type === 'bulk_session_fulfillment');
        const payment = payments.data?.find((item) => item.status === 'succeeded');
        const cycle = cycles.data?.find((item) => item.cycle_number === 1 && item.cycle_kind === 'initial');
        const ready = subscription.status === 'active'
            && subscription.billing_interval_unit === 'day'
            && subscription.billing_interval_count === 28
            && subscription.contracted_sessions_per_period === 4
            && subscription.class_duration_minutes === 50
            && Boolean(subscription.stripe_subscription_id)
            && sessions.data?.length === 4
            && sessions.data.every((item, index) => (
                item.duration_minutes === 50
                && item.teacher_id
                && item.scheduled_at
                && item.calendar_event_id
                && item.drive_doc_id
                && item.drive_doc_url
                && item.meet_link
                && item.checkout_v2_cycle_session_index === index + 1
            ))
            && payment?.amount === amountCents
            && payment.currency === currency
            && cycle?.amount_cents === amountCents
            && cycle.currency === currency
            && cycle.materialization_state === 'ready'
            && cycle.sessions_total === 4
            && slot.data?.status === 'sold'
            && slot.data.sold_subscription_id === subscription.id
            && welcome?.status === 'succeeded'
            && classes?.status === 'succeeded';
        if (ready) {
            const checkout = await context.stripe.checkout.sessions.retrieve(
                stringValue(state.checkoutSessionId, 'Stripe Checkout Session'),
            );
            const checkoutCustomerId = typeof checkout.customer === 'string'
                ? checkout.customer
                : checkout.customer?.id;
            const checkoutSubscriptionId = typeof checkout.subscription === 'string'
                ? checkout.subscription
                : checkout.subscription?.id;
            state.stripeCustomerId = checkoutCustomerId;
            const checkoutIntentId = checkout.metadata?.checkoutIntentId;
            const customerSessions = checkoutCustomerId && checkoutIntentId
                ? await context.stripe.checkout.sessions.list({
                    customer: checkoutCustomerId,
                    limit: 100,
                })
                : null;
            const intentSessions = customerSessions?.data.filter((session) => (
                session.metadata?.checkoutIntentId === checkoutIntentId
            )) ?? [];
            const stripeSubscription = await context.stripe.subscriptions.retrieve(
                stringValue(state.stripeSubscriptionId, 'Stripe subscription'),
            );
            if (
                checkout.payment_status !== 'paid'
                || checkout.status !== 'complete'
                || checkout.amount_total !== amountCents
                || checkout.currency !== currency
                || checkout.client_reference_id !== studentId
                || checkoutSubscriptionId !== state.stripeSubscriptionId
                || checkout.metadata?.stagingE2ERunId !== state.runId
                || checkout.metadata?.userId !== studentId
                || checkout.metadata?.slotPublicId !== state.slotPublicId
                || checkout.metadata?.initialPriceId !== fixtures.initialPriceId
                || checkout.metadata?.recurringPriceId !== fixtures.recurringPriceId
                || !state.declinedPaymentObserved
                || intentSessions.length !== 1
                || intentSessions[0]?.id !== checkout.id
                || stripeSubscription.status !== 'trialing'
                || stripeSubscription.metadata.stagingE2ERunId !== state.runId
                || stripeSubscription.items.data.length !== 1
                || stripeSubscription.items.data[0]?.price.id !== fixtures.recurringPriceId
                || stripeSubscription.items.data[0]?.price.recurring?.interval !== 'day'
                || stripeSubscription.items.data[0].price.recurring.interval_count !== 28
            ) throw new Error('Stripe Sandbox purchase does not match the Checkout V2 contract');
            return;
        }
        lastStatus = `subscription=${subscription.status};sessions=${sessions.data?.length ?? 0};welcome=${welcome?.status ?? 'missing'};classes=${classes?.status ?? 'missing'}`;
        if (
            welcome?.status === 'dead'
            || classes?.status === 'dead'
            || (welcome?.status === 'failed' && welcome.attempts >= welcome.max_attempts)
            || (classes?.status === 'failed' && classes.attempts >= classes.max_attempts)
        ) {
            throw new Error(`Checkout V2 fulfillment failed: ${lastStatus}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 1_500));
    }
    throw new Error(`Checkout V2 was not fully fulfilled before timeout (${lastStatus})`);
}

async function cleanupReal(env: Env, state: StagingCheckoutV2RunState, log: Log): Promise<void> {
    const context = createRealContext(env);
    const errors: string[] = [];
    const attempt = async (label: string, work: () => Promise<void>) => {
        try { await work(); } catch { errors.push(label); }
    };
    if (state.grantCookie) {
        const grantCookie = state.grantCookie;
        await attempt('grant-cookie', async () => {
            const response = await fetchWithTimeout(`${STAGING_CHECKOUT_V2_IDENTITY.webOrigin}/api/internal/staging-e2e-checkout`, {
                method: 'DELETE',
                headers: {
                    Cookie: stagingCheckoutV2CleanupCookieHeader({
                        adminCookie: state.adminCookie,
                        grantCookie,
                    }),
                    Origin: STAGING_CHECKOUT_V2_IDENTITY.webOrigin,
                },
            });
            if (response.status !== 204) throw new Error(`Grant cleanup failed with HTTP ${response.status}`);
        });
    }
    if (state.checkoutSessionId) {
        await attempt('checkout-session', async () => {
            const session = await context.stripe.checkout.sessions.retrieve(state.checkoutSessionId!);
            if (session.status === 'open') await context.stripe.checkout.sessions.expire(session.id);
            if (!state.stripeCustomerId) {
                state.stripeCustomerId = typeof session.customer === 'string' ? session.customer : session.customer?.id;
            }
            if (!state.stripeSubscriptionId) {
                state.stripeSubscriptionId = typeof session.subscription === 'string'
                    ? session.subscription
                    : session.subscription?.id;
            }
        });
    }
    if (state.stripeSubscriptionId) {
        await attempt('stripe-subscription', async () => {
            const subscription = await context.stripe.subscriptions.retrieve(state.stripeSubscriptionId!);
            if (subscription.status !== 'canceled') await context.stripe.subscriptions.cancel(subscription.id);
        });
    }
    if (state.stripeCustomerId) {
        await attempt('stripe-customer', async () => {
            const customer = await context.stripe.customers.retrieve(state.stripeCustomerId!);
            if (!customer.deleted) await context.stripe.customers.del(customer.id);
        });
    }
    if (state.studentId && !state.checkoutSessionId && !state.subscriptionId) {
        await attempt('synthetic-user', async () => {
            const { error } = await context.admin.auth.admin.deleteUser(state.studentId!);
            if (error && !error.message.toLowerCase().includes('not found')) throw error;
        });
    }
    if (errors.length) throw new Error(`Cleanup incomplete: ${errors.join(', ')}`);
    log(`[staging-checkout-v2] cleanup=ok retained_immutable_evidence=${String(Boolean(state.subscriptionId))}`);
}

const realJourney: StagingCheckoutV2Journey = {
    async preflight(env, log) {
        const context = createRealContext(env);
        const [account, pkg, home, admin, teacher] = await Promise.all([
            context.stripe.accounts.retrieve(),
            packageRow(context.admin),
            fetchWithTimeout(`${STAGING_CHECKOUT_V2_IDENTITY.webOrigin}/es/`, undefined, 30_000),
            context.admin.from('profiles').select('id,role,email')
                .eq('email', required(env, 'TEST_ADMIN_EMAIL').toLowerCase()).limit(2),
            context.admin.from('profiles').select('id,role,email')
                .eq('email', required(env, 'TEST_TEACHER_EMAIL').toLowerCase()).limit(2),
        ]);
        if (account.id !== STAGING_CHECKOUT_V2_IDENTITY.stripeAccountId) {
            throw new Error('Stripe preflight resolved a non-allowlisted account');
        }
        if (!home.ok && home.status !== 304) throw new Error(`Staging web preflight failed with HTTP ${home.status}`);
        if (admin.error || admin.data?.length !== 1 || admin.data[0]?.role !== 'admin') {
            throw new Error('Staging admin identity is missing or ambiguous');
        }
        if (teacher.error || teacher.data?.length !== 1 || teacher.data[0]?.role !== 'teacher') {
            throw new Error('Staging teacher identity is missing or ambiguous');
        }
        if (pkg.name !== packageKey) throw new Error('Canonical package preflight failed');
        await verifyExactFixtures(env, context);
        log('[staging-checkout-v2] preflight=ok supabase=staging stripe=sandbox web=staging');
    },
    async execute(env, state, log) {
        const context = createRealContext(env);
        state.slotId = fixtures.slotId;
        state.slotPublicId = fixtures.slotPublicId;
        log('[staging-checkout-v2] fixtures=verified amount=25900 currency=eur interval=28-days');

        state.adminCookie = await createSessionCookie(
            env,
            required(env, 'TEST_ADMIN_EMAIL'),
            required(env, 'TEST_ADMIN_PASSWORD'),
        );
        await createSyntheticStudent(env, context, state);
        await issueGrant(state);
        const checkoutUrl = await createCheckout(state);
        log(`[staging-checkout-v2] checkout=created run_id=${state.runId} idempotent_retry=same_session`);
        await completeCheckout(checkoutUrl, context, state);
        await waitForPurchase(context, state);
        log('[staging-checkout-v2] purchase=verified declined_card=recovered unique_checkout=true amount=25900 sessions=4 renewal=28-days fulfillment=succeeded');
    },
    cleanup: cleanupReal,
};

export async function runStagingCheckoutV2(
    argv: string[],
    dependencies: RunnerDependencies = {},
): Promise<StagingCheckoutV2RunState | null> {
    const workspaceRoot = path.resolve(dependencies.workspaceRoot ?? process.cwd());
    const readText = dependencies.readText ?? ((file: string) => readFileSync(file, 'utf8'));
    const args = parseStagingCheckoutV2Args(argv);
    const envFile = path.resolve(dependencies.envFile ?? defaultEnvFile(workspaceRoot));
    const env = parse(readText(envFile));
    const gate: StagingCheckoutV2Gate = validateStagingCheckoutV2Gate({
        args,
        env,
        fulfillmentConfig: readText(path.resolve(workspaceRoot, 'workers/fulfillment/wrangler.toml')),
        repositoryRemote: (dependencies.repositoryRemote ?? readRepositoryRemote)(workspaceRoot),
        resolvedEnvFile: envFile,
        webConfig: readText(path.resolve(workspaceRoot, 'wrangler.toml')),
        workspaceRoot,
    });
    const log = dependencies.log ?? console.log;
    for (const item of safeStagingCheckoutV2Summary(gate)) log(`[staging-checkout-v2] ${item}`);

    const journey = dependencies.journey ?? realJourney;
    await journey.preflight(env, log);
    if (gate.mode === 'preflight') {
        log('[staging-checkout-v2] result=ok external_writes=none');
        return null;
    }

    const state = createRunState();
    let executionError: unknown;
    try {
        await journey.execute(env, state, log);
    } catch (error) {
        executionError = error;
    }
    try {
        await journey.cleanup(env, state, log);
    } catch (cleanupError) {
        if (executionError) {
            throw new AggregateError([executionError, cleanupError], 'Checkout V2 journey and cleanup both failed');
        }
        throw cleanupError;
    }
    if (executionError) throw executionError;
    log(`[staging-checkout-v2] result=ok run_id=${state.runId}`);
    return state;
}

/** Compatibility for the first safety-only draft; now executes the real runner. */
export const runStagingCheckoutV2Skeleton = runStagingCheckoutV2;

const invokedScriptPath = process.argv[1];
if (invokedScriptPath && import.meta.url === pathToFileURL(path.resolve(invokedScriptPath)).href) {
    runStagingCheckoutV2(process.argv.slice(2)).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : 'Staging Checkout V2 failed';
        console.error(`[staging-checkout-v2] failed=${message}`);
        process.exitCode = 1;
    });
}
