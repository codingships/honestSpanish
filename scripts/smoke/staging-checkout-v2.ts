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
import { randomBytes, randomUUID } from 'node:crypto';
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
import { drivePublicCheckoutJourney } from './staging-checkout-v2-public';
import {
    parseStagingCheckoutV2Args,
    safeStagingCheckoutV2Summary,
    stagingBrowserCookies,
    STAGING_CHECKOUT_V2_IDENTITY,
    type StagingCheckoutV2Gate,
    validateStagingCheckoutV2Gate,
} from './staging-checkout-v2-safety';

const packageKey = 'individual_4x50_28d';
const syntheticEmailPattern = /^delivered\+hs-stg-[a-z0-9][a-z0-9-]{0,45}@resend\.dev$/u;
const amountCents = 25_900;
const currency = 'eur';
const webhookPath = '/api/stripe-webhook';
const fixtures = Object.freeze({
    initialPriceId: 'price_1Tzz5MC22M3erP0jQYMb166L',
    packageId: 'cc8c0290-a0b5-4358-94e3-696edaec48ec',
    packagePriceId: 'ab7c18d9-154d-4c67-b923-2b822cca962d',
    productId: 'prod_Uzz3n6jX0vHDdl',
    recurringPriceId: 'price_1Tzz5NC22M3erP0j5tqhot57',
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
    guaranteeRefunded?: boolean;
    guaranteeStripeRefundId?: string;
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

export type StagingCheckoutV2JourneyOptions = {
    guarantee: boolean;
    journey: 'api' | 'public';
};

export type StagingCheckoutV2Journey = {
    cleanup(env: Env, state: StagingCheckoutV2RunState, log: Log): Promise<void>;
    execute(
        env: Env,
        state: StagingCheckoutV2RunState,
        log: Log,
        options?: StagingCheckoutV2JourneyOptions,
    ): Promise<void>;
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

const madridWeekdayHour = new Intl.DateTimeFormat('en-US', {
    hour: '2-digit',
    hour12: false,
    minute: '2-digit',
    timeZone: 'Europe/Madrid',
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
});

function madridParts(date: Date): { dateKey: string; time: string; weekday: number } {
    const parts = Object.fromEntries(
        madridWeekdayHour.formatToParts(date).map((part) => [part.type, part.value]),
    ) as Record<string, string>;
    const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    return {
        dateKey: `${parts.year}-${parts.month}-${parts.day}`,
        time: `${parts.hour === '24' ? '00' : parts.hour}:${parts.minute}`,
        weekday: weekdays.indexOf(parts.weekday ?? ''),
    };
}

/**
 * Sold slots are immutable by product contract, so every accreditation run
 * buys a freshly created capacity slot instead of re-arming a used one. The
 * slot is created and published through the real admin surface and must fit a
 * free weekday/hour inside the synthetic teacher's availability (Mon-Fri
 * 09:00-18:00 Madrid) without colliding with already scheduled sessions or
 * other non-retired slots.
 */
async function chooseFreshSlotSchedule(
    context: RealContext,
): Promise<{ firstClassDate: string; localStartTime: string }> {
    const [sessions, slots] = await Promise.all([
        context.admin.from('sessions')
            .select('scheduled_at, status')
            .eq('teacher_id', fixtures.teacherId)
            .gte('scheduled_at', new Date().toISOString()),
        context.admin.from('bookable_slots')
            .select('weekday, local_start_time, status')
            .eq('teacher_id', fixtures.teacherId)
            .neq('status', 'retired'),
    ]);
    if (sessions.error || slots.error) throw sessions.error ?? slots.error;

    const taken = new Set<string>();
    for (const session of sessions.data ?? []) {
        if (session.status === 'cancelled' || !session.scheduled_at) continue;
        const at = madridParts(new Date(session.scheduled_at));
        taken.add(`${at.weekday}@${at.time}`);
    }
    for (const slot of slots.data ?? []) {
        taken.add(`${slot.weekday}@${slot.local_start_time.slice(0, 5)}`);
    }

    for (let dayOffset = 2; dayOffset <= 16; dayOffset += 1) {
        const candidate = new Date(Date.now() + dayOffset * 86_400_000);
        const day = madridParts(candidate);
        if (day.weekday < 1 || day.weekday > 5) continue;
        for (let hour = 9; hour <= 17; hour += 1) {
            const localStartTime = `${String(hour).padStart(2, '0')}:00`;
            if (taken.has(`${day.weekday}@${localStartTime}`)) continue;
            return { firstClassDate: day.dateKey, localStartTime };
        }
    }
    throw new Error('No free synthetic capacity schedule is available for the staging teacher');
}

async function createFreshCapacitySlot(
    state: StagingCheckoutV2RunState,
    context: RealContext,
    log: Log,
): Promise<void> {
    const adminCookie = stringValue(state.adminCookie, 'Admin authentication');
    const endpoint = `${STAGING_CHECKOUT_V2_IDENTITY.webOrigin}/api/admin/teachers-slots`;
    const schedule = await chooseFreshSlotSchedule(context);

    const created = await postJson(endpoint, adminCookie, {
        action: 'create_slot',
        firstClassDate: schedule.firstClassDate,
        localStartTime: schedule.localStartTime,
        reason: `Synthetic staging accreditation run ${state.runId}`,
        requestId: randomUUID(),
        teacherId: fixtures.teacherId,
    });
    assertHttp(created.response, created.body, 200, 'Synthetic capacity slot creation');
    const slot = created.body.result as { id?: unknown; public_id?: unknown } | null;
    state.slotId = stringValue(slot?.id, 'Synthetic capacity slot');
    state.slotPublicId = stringValue(slot?.public_id, 'Synthetic capacity slot');

    const published = await postJson(endpoint, adminCookie, {
        action: 'transition_slot',
        reason: `Synthetic staging accreditation run ${state.runId}`,
        requestId: randomUUID(),
        slotId: state.slotId,
        transition: 'publish',
    });
    assertHttp(published.response, published.body, 200, 'Synthetic capacity slot publication');
    log(`[staging-checkout-v2] slot=created first_class=${schedule.firstClassDate}T${schedule.localStartTime}@Europe/Madrid status=available`);
}

async function verifyExactFixtures(env: Env, context: RealContext): Promise<void> {
    const exactUrl = `${STAGING_CHECKOUT_V2_IDENTITY.webOrigin}${webhookPath}`;
    const [account, pkg, price, snapshot, engagement, product, initialPrice, recurringPrice, webhooks] = await Promise.all([
        context.stripe.accounts.retrieve(),
        packageRow(context.admin),
        context.admin.from('package_prices').select('*').eq('id', fixtures.packagePriceId).single(),
        context.admin.from('checkout_v2_price_snapshots').select('*')
            .eq('package_price_id', fixtures.packagePriceId).single(),
        context.admin.from('teacher_compensation_engagements').select('*')
            .eq('teacher_id', fixtures.teacherId).eq('engagement_kind', 'founder')
            .lte('effective_from', new Date().toISOString())
            .order('effective_from', { ascending: false }).limit(1).maybeSingle(),
        context.stripe.products.retrieve(fixtures.productId),
        context.stripe.prices.retrieve(fixtures.initialPriceId),
        context.stripe.prices.retrieve(fixtures.recurringPriceId),
        context.stripe.webhookEndpoints.list({ limit: 100 }),
    ]);
    const queryError = price.error ?? snapshot.error ?? engagement.error;
    if (queryError) throw queryError;
    if (!price.data || !snapshot.data || !engagement.data) {
        throw new Error('Exact staging database fixtures are incomplete');
    }
    const packagePrice = price.data;
    const priceSnapshot = snapshot.data;
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

async function assertSyntheticSlotIsPubliclyOpen(state: StagingCheckoutV2RunState): Promise<void> {
    const response = await fetchWithTimeout(
        `${STAGING_CHECKOUT_V2_IDENTITY.webOrigin}/api/bookable-slots`,
        {
            headers: {
                Accept: 'application/json',
                Cookie: stringValue(state.studentCookie, 'Student authentication'),
            },
        },
    );
    const body = await jsonResponse(response);
    const slots = Array.isArray(body.slots) ? body.slots as Array<{ publicId?: unknown }> : [];
    const listed = slots.some((slot) => slot.publicId === state.slotPublicId);
    if (
        response.status !== 200
        || body.checkoutEnabled !== true
        || !listed
    ) {
        throw new Error(
            'Synthetic slot is not listed in the open public checkout lane'
            + ` (http=${response.status}, checkoutEnabled=${String(body.checkoutEnabled)}, slots=${slots.length})`,
        );
    }
}

function checkoutRequestBody(state: StagingCheckoutV2RunState, lang: 'en' | 'es'): Record<string, unknown> {
    return {
        adultConfirmed: true,
        'cf-turnstile-response': 'XXXX.DUMMY.TOKEN.XXXX',
        lang,
        policyVersion: CHECKOUT_TERMS_VERSION,
        serviceStartRequested: true,
        slotPublicId: stringValue(state.slotPublicId, 'Synthetic slot'),
        termsAccepted: true,
        withdrawalLossAcknowledged: true,
    };
}

function sessionIdFromUrl(checkoutUrl: string): string | undefined {
    return new URL(checkoutUrl).pathname
        .split('/')
        .map((segment) => decodeURIComponent(segment))
        .find((segment) => segment.startsWith('cs_test_'));
}

async function assertIdempotentCheckoutRetry(
    state: StagingCheckoutV2RunState,
    lang: 'en' | 'es',
): Promise<void> {
    const retry = await postJson(
        `${STAGING_CHECKOUT_V2_IDENTITY.webOrigin}/api/create-checkout`,
        stringValue(state.studentCookie, 'Student authentication'),
        checkoutRequestBody(state, lang),
    );
    assertHttp(retry.response, retry.body, 200, 'Checkout V2 idempotent retry');
    const retryUrl = stringValue(retry.body.url, 'Checkout V2 idempotent retry');
    if (sessionIdFromUrl(retryUrl) !== stringValue(state.checkoutSessionId, 'Stripe Checkout Session')) {
        throw new Error('Checkout V2 retry created or returned another Stripe Checkout Session');
    }
}

async function createCheckout(state: StagingCheckoutV2RunState): Promise<string> {
    const first = await postJson(
        `${STAGING_CHECKOUT_V2_IDENTITY.webOrigin}/api/create-checkout`,
        stringValue(state.studentCookie, 'Student authentication'),
        checkoutRequestBody(state, 'en'),
    );
    assertHttp(first.response, first.body, 200, 'Checkout V2 creation');
    const checkoutUrl = stringValue(first.body.url, 'Checkout V2');
    state.checkoutSessionId = stringValue(sessionIdFromUrl(checkoutUrl), 'Stripe Checkout Session');
    await assertIdempotentCheckoutRetry(state, 'en');
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

async function purchaseThroughPublicJourney(
    realContext: RealContext,
    state: StagingCheckoutV2RunState,
    log: Log,
): Promise<void> {
    const browser = await chromium.launch({ headless: true });
    try {
        const browserContext = await browser.newContext();
        await browserContext.addCookies(stagingBrowserCookies(
            stringValue(state.studentCookie, 'Student authentication'),
        ));
        const page = await browserContext.newPage();
        const { checkoutUrl } = await drivePublicCheckoutJourney({
            page,
            slotPublicId: stringValue(state.slotPublicId, 'Synthetic slot'),
            timeoutMs: 90_000,
        });
        state.checkoutSessionId = stringValue(sessionIdFromUrl(checkoutUrl), 'Stripe Checkout Session');
        log(`[staging-checkout-v2] public_journey=hosted-checkout run_id=${state.runId}`);
        await assertIdempotentCheckoutRetry(state, 'es');
        log('[staging-checkout-v2] checkout=created via=public-ui idempotent_retry=same_session');

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

async function waitForPurchase(
    context: RealContext,
    state: StagingCheckoutV2RunState,
    journey: 'api' | 'public',
): Promise<void> {
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
            // Public checkout never attaches stagingE2ERunId; that metadata is
            // reserved for the grant-gated staging-e2e path. Correlate public
            // purchases by student, slot, prices and unique checkout intent.
            const runIdMatchesJourney = journey === 'public'
                ? checkout.metadata?.stagingE2ERunId === undefined
                    && stripeSubscription.metadata.stagingE2ERunId === undefined
                : checkout.metadata?.stagingE2ERunId === state.runId
                    && stripeSubscription.metadata.stagingE2ERunId === state.runId;
            if (
                checkout.payment_status !== 'paid'
                || checkout.status !== 'complete'
                || checkout.amount_total !== amountCents
                || checkout.currency !== currency
                || checkout.client_reference_id !== studentId
                || checkoutSubscriptionId !== state.stripeSubscriptionId
                || !runIdMatchesJourney
                || checkout.metadata?.userId !== studentId
                || checkout.metadata?.slotPublicId !== state.slotPublicId
                || checkout.metadata?.initialPriceId !== fixtures.initialPriceId
                || checkout.metadata?.recurringPriceId !== fixtures.recurringPriceId
                || !state.declinedPaymentObserved
                || intentSessions.length !== 1
                || intentSessions[0]?.id !== checkout.id
                || stripeSubscription.status !== 'trialing'
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

const guaranteeRefundCents = 19_425;

/**
 * The guarantee window opens after the first class is really over and before
 * the second one starts. A fresh synthetic purchase has all four classes in
 * the future, so the first session is time-shifted into a completed past class
 * together with the correlated billing anchor/cycle timestamps. Those writes
 * must commit in one transaction because the deferred coherence guard spans
 * sessions, billing_state and cycles.
 */
function makeFirstClassSyntheticallyCompleted(
    env: Env,
    state: StagingCheckoutV2RunState,
): void {
    const subscriptionId = stringValue(state.subscriptionId, 'Subscription');
    const nowMs = Date.now();
    const firstClassAt = new Date(nowMs - 120 * 60_000).toISOString();
    const completedAt = new Date(nowMs - 60 * 60_000).toISOString();
    const databaseUrl = required(env, 'SUPABASE_DB_URL');
    if (!databaseUrl.includes(STAGING_CHECKOUT_V2_IDENTITY.supabaseProjectRef)) {
        throw new Error('Refusing non-staging SUPABASE_DB_URL for guarantee setup');
    }

    const sql = `
BEGIN;
UPDATE public.sessions
SET
    scheduled_at = '${firstClassAt}'::timestamptz,
    completed_at = '${completedAt}'::timestamptz,
    status = 'completed',
    updated_at = clock_timestamp()
WHERE subscription_id = '${subscriptionId}'::uuid
  AND checkout_v2_cycle_session_index = 1
  AND status = 'scheduled';
UPDATE public.checkout_v2_billing_state
SET
    first_class_at = '${firstClassAt}'::timestamptz,
    renewal_anchor_at = '${firstClassAt}'::timestamptz + INTERVAL '672 hours',
    stripe_renewal_anchor_at = '${firstClassAt}'::timestamptz + INTERVAL '672 hours',
    anchor_revision = anchor_revision + 1,
    updated_at = clock_timestamp()
WHERE subscription_id = '${subscriptionId}'::uuid
  AND anchor_state = 'provisional'
  AND first_class_at IS DISTINCT FROM '${firstClassAt}'::timestamptz;
UPDATE public.checkout_v2_cycles
SET
    starts_at = '${firstClassAt}'::timestamptz,
    ends_at = '${firstClassAt}'::timestamptz + INTERVAL '672 hours',
    updated_at = clock_timestamp()
WHERE subscription_id = '${subscriptionId}'::uuid
  AND cycle_number = 1
  AND cycle_kind = 'initial';
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM public.sessions
        WHERE subscription_id = '${subscriptionId}'::uuid
          AND checkout_v2_cycle_session_index = 1
          AND status = 'completed'
          AND scheduled_at = '${firstClassAt}'::timestamptz
          AND completed_at = '${completedAt}'::timestamptz
    ) THEN
        RAISE EXCEPTION 'synthetic_first_class_not_completed';
    END IF;
END $$;
COMMIT;
`;

    try {
        execFileSync('psql', [databaseUrl, '-v', 'ON_ERROR_STOP=1', '-X', '-q', '-c', sql], {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsHide: true,
        });
    } catch (error) {
        const stderr = error && typeof error === 'object' && 'stderr' in error
            ? String((error as { stderr?: unknown }).stderr ?? '')
            : '';
        const detail = stderr.split('\n').map((line) => line.trim()).find(Boolean) ?? 'psql failed';
        throw new Error(`Synthetic first-class completion failed: ${detail}`);
    }
}

async function accreditGuarantee(
    env: Env,
    context: RealContext,
    state: StagingCheckoutV2RunState,
    log: Log,
): Promise<void> {
    const subscriptionId = stringValue(state.subscriptionId, 'Subscription');
    const studentCookie = stringValue(state.studentCookie, 'Student authentication');
    const endpoint = `${STAGING_CHECKOUT_V2_IDENTITY.webOrigin}/api/account/guarantee`;

    makeFirstClassSyntheticallyCompleted(env, state);
    log('[staging-checkout-v2] guarantee_setup=first-class-completed synthetic_time_shift=true');

    const requestId = randomUUID();
    const body = { requestId, subscriptionId };
    const guaranteeOf = (payload: Record<string, unknown>): Record<string, unknown> => (
        payload.guarantee && typeof payload.guarantee === 'object' && !Array.isArray(payload.guarantee)
            ? payload.guarantee as Record<string, unknown>
            : {}
    );

    const first = await postJson(endpoint, studentCookie, body);
    if (![200, 202].includes(first.response.status)) {
        throw new Error(`Guarantee request failed with HTTP ${first.response.status}`);
    }
    const duplicate = await postJson(endpoint, studentCookie, body);
    if (![200, 202].includes(duplicate.response.status)) {
        throw new Error(`Guarantee idempotent duplicate failed with HTTP ${duplicate.response.status}`);
    }
    const firstOperationId = guaranteeOf(first.body).operationId;
    const duplicateOperationId = guaranteeOf(duplicate.body).operationId;
    if (
        typeof firstOperationId !== 'string'
        || !firstOperationId
        || duplicateOperationId !== firstOperationId
    ) {
        throw new Error('The duplicated guarantee request did not reuse the same operation');
    }
    log('[staging-checkout-v2] guarantee=requested idempotent_duplicate=same_operation');

    const deadline = Date.now() + 240_000;
    let publicStatus = 'unknown';
    while (Date.now() < deadline) {
        const response = await fetchWithTimeout(
            `${endpoint}?subscriptionId=${subscriptionId}`,
            { headers: { Cookie: studentCookie } },
        );
        const guarantee = guaranteeOf(await jsonResponse(response));
        publicStatus = typeof guarantee.status === 'string' ? guarantee.status : 'unknown';
        if (publicStatus === 'refunded') {
            if (guarantee.refundAmountCents !== guaranteeRefundCents || guarantee.currency !== currency) {
                throw new Error('The public guarantee state does not match the proportional refund');
            }
            break;
        }
        if (!['processing', 'refund_pending', 'eligible'].includes(publicStatus)) {
            throw new Error(`Guarantee reached a non-refundable state: ${publicStatus}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
    if (publicStatus !== 'refunded') {
        throw new Error(`Guarantee was not refunded before timeout (${publicStatus})`);
    }

    const { data: operation, error: operationError } = await context.admin
        .from('checkout_v2_guarantee_operations')
        .select('status, refund_amount_cents, currency, stripe_refund_id, refund_status')
        .eq('request_id', requestId)
        .single();
    if (operationError || !operation) {
        throw operationError ?? new Error('Guarantee operation row is missing');
    }
    if (
        operation.status !== 'refunded'
        || operation.refund_amount_cents !== guaranteeRefundCents
        || operation.currency !== currency
        || operation.refund_status !== 'succeeded'
        || typeof operation.stripe_refund_id !== 'string'
    ) throw new Error('Guarantee operation did not settle as a succeeded proportional refund');

    const [refund, stripeSubscription] = await Promise.all([
        context.stripe.refunds.retrieve(operation.stripe_refund_id),
        context.stripe.subscriptions.retrieve(
            stringValue(state.stripeSubscriptionId, 'Stripe subscription'),
        ),
    ]);
    if (
        refund.amount !== guaranteeRefundCents
        || refund.currency !== currency
        || refund.status !== 'succeeded'
        || stripeSubscription.status !== 'canceled'
    ) throw new Error('Stripe Sandbox refund does not match the proportional guarantee contract');

    state.guaranteeRefunded = true;
    state.guaranteeStripeRefundId = operation.stripe_refund_id;
    log(`[staging-checkout-v2] guarantee=refunded amount=${guaranteeRefundCents} currency=${currency} subscription=canceled`);
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
    if (state.slotId && state.adminCookie && !state.subscriptionId) {
        // A slot that never sold must not linger as fake public availability.
        await attempt('capacity-slot', async () => {
            const { data: slot, error } = await context.admin
                .from('bookable_slots')
                .select('status')
                .eq('id', state.slotId!)
                .single();
            if (error || !slot) throw error ?? new Error('Synthetic capacity slot is missing');
            if (slot.status === 'sold' || slot.status === 'retired') return;
            const retired = await postJson(
                `${STAGING_CHECKOUT_V2_IDENTITY.webOrigin}/api/admin/teachers-slots`,
                state.adminCookie!,
                {
                    action: 'transition_slot',
                    reason: `Synthetic staging accreditation cleanup ${state.runId}`,
                    requestId: randomUUID(),
                    slotId: state.slotId,
                    transition: 'retire',
                },
            );
            if (retired.response.status !== 200) {
                throw new Error(`Slot retirement failed with HTTP ${retired.response.status}`);
            }
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
    async execute(env, state, log, options = { guarantee: false, journey: 'api' }) {
        const context = createRealContext(env);
        log('[staging-checkout-v2] fixtures=verified amount=25900 currency=eur interval=28-days');

        state.adminCookie = await createSessionCookie(
            env,
            required(env, 'TEST_ADMIN_EMAIL'),
            required(env, 'TEST_ADMIN_PASSWORD'),
        );
        await createFreshCapacitySlot(state, context, log);
        await createSyntheticStudent(env, context, state);
        await assertSyntheticSlotIsPubliclyOpen(state);
        if (options.journey === 'public') {
            await purchaseThroughPublicJourney(context, state, log);
        } else {
            const checkoutUrl = await createCheckout(state);
            log(`[staging-checkout-v2] checkout=created run_id=${state.runId} idempotent_retry=same_session`);
            await completeCheckout(checkoutUrl, context, state);
        }
        await waitForPurchase(context, state, options.journey);
        log(`[staging-checkout-v2] purchase=verified journey=${options.journey} declined_card=recovered unique_checkout=true amount=25900 sessions=4 renewal=28-days fulfillment=succeeded`);
        if (options.guarantee) await accreditGuarantee(env, context, state, log);
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
        await journey.execute(env, state, log, { guarantee: gate.guarantee, journey: gate.journey });
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
        // Supabase query errors are plain objects, not Error instances.
        const message = error instanceof Error
            ? error.message
            : (error && typeof error === 'object' && typeof (error as { message?: unknown }).message === 'string'
                ? (error as { message: string }).message
                : 'Staging Checkout V2 failed');
        console.error(`[staging-checkout-v2] failed=${message}`);
        process.exitCode = 1;
    });
}
