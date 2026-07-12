import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { chromium, type Browser, type Locator, type Page } from 'playwright';
import Stripe from 'stripe';
import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import { parse } from 'dotenv';
import {
    buildRuntimeAttestationConfig,
    RUNTIME_ATTESTATION_SCHEMA,
    verifyRuntimeAttestation,
    type RuntimeAttestationEnvelope,
} from '../../src/lib/runtime-attestation';
import type { Database } from '../../src/types/database.types';
import {
    fingerprintPortalSmokeValue,
    PORTAL_CANCEL_ACTION_NAMES,
    PORTAL_CONTINUE_ACTION_NAMES,
    PORTAL_COOKIE_REJECT_NAMES,
    resolvePortalSmokeLang,
    sanitizePortalSmokeText,
    STAGING_PORTAL_SMOKE,
    STAGING_PORTAL_SMOKE_APPROVAL,
    STAGING_PORTAL_SMOKE_APPROVAL_ENV,
    validateCancellation,
    validateOwnedStripeResource,
    validatePortalConfig,
    validateSafeReturnUrl,
    validateStagingPortalSmokeEnv,
    validateTrialSubscription,
    type PortalSmokeLang,
} from './staging-customer-portal-smoke-shared';

type CheckStatus = 'ok' | 'warning' | 'failed';
type ReportStatus = 'OK' | 'WARNING' | 'FAILED';
type RunnerMode = 'plan' | 'preflight-readonly' | 'execute-approved' | 'cleanup-only';

interface Check {
    status: CheckStatus;
    name: string;
    message: string;
    details: string[];
}

interface PrivateBillingSnapshot {
    stripeCustomerId: string | null;
    stripeCustomerAccountId: string | null;
    stripeCustomerLivemode: boolean | null;
    updatedAt: string | null;
}

interface PackageOffer {
    id: string;
    packageId: string;
    stripePriceId: string;
    stripeProductId: string;
    sessionsPerPeriod: number;
    durationMonths: number;
}

interface EmailBudgetSnapshot {
    daily: number;
    monthly: number;
}

interface ReadOnlyPreflight {
    studentId: string;
    privateBilling: PrivateBillingSnapshot;
    packageOffer: PackageOffer;
    emailBudget: EmailBudgetSnapshot;
    portalConfigurationId: string;
    webVersionId: string;
}

interface CleanupCheckpoint {
    schemaVersion: 1;
    runId: string;
    status: 'prepared' | 'customer_created' | 'subscription_created' | 'supabase_prepared' | 'portal_verified' | 'cleanup_started' | 'cleaned' | 'cleanup_incomplete';
    startedAt: string;
    studentId: string;
    privateBillingBefore: PrivateBillingSnapshot;
    packageOffer: PackageOffer;
    localSubscriptionId: string;
    stripeCustomerId: string | null;
    stripeSubscriptionId: string | null;
    eventIds: string[];
    cleanupErrors: string[];
}

interface ResourceEvidence {
    checkpointPath: string | null;
    runFingerprint: string | null;
    customerFingerprint: string | null;
    subscriptionFingerprint: string | null;
    localSubscriptionFingerprint: string | null;
    portalUrlStored: false;
    screenshotsStored: false;
}

interface RunnerReport {
    schemaVersion: 1;
    startedAt: string;
    endedAt: string;
    status: ReportStatus;
    closureStatus: 'PLAN_ONLY_READY' | 'PREFLIGHT_VERIFIED' | 'EXECUTED_CLEAN' | 'CLEANUP_VERIFIED' | 'BLOCKED';
    mode: RunnerMode;
    target: typeof STAGING_PORTAL_SMOKE;
    language: PortalSmokeLang;
    approvalMatched: boolean;
    externalReadPerformed: boolean;
    externalWriteAttempted: boolean;
    externalWritePerformed: boolean;
    cleanupAttempted: boolean;
    cleanupVerified: boolean;
    testStudentFingerprint: string | null;
    checks: Check[];
    resources: ResourceEvidence;
    artifacts: {
        summaryJson: string;
        summaryMarkdown: string;
        manifest: string;
        executionPlan: string;
        approvalGate: string;
        cleanupRunbook: string;
    };
}

const args = process.argv.slice(2);
const executeRequested = args.includes('--execute-approved');
const preflightRequested = args.includes('--preflight-readonly');
const cleanupRequested = args.includes('--cleanup-only');
const selectedModes = [executeRequested, preflightRequested, cleanupRequested].filter(Boolean).length;
const mode: RunnerMode = executeRequested
    ? 'execute-approved'
    : cleanupRequested
        ? 'cleanup-only'
        : preflightRequested
            ? 'preflight-readonly'
            : 'plan';
const checkpointArgument = args.find((argument) => argument.startsWith('--checkpoint='))?.slice('--checkpoint='.length) ?? null;
const approvalMatched = process.env[STAGING_PORTAL_SMOKE_APPROVAL_ENV] === STAGING_PORTAL_SMOKE_APPROVAL;
const language = resolvePortalSmokeLang(process.env.PORTAL_SMOKE_LANG);
const startedAt = new Date();
const outputDir = path.join(
    process.cwd(),
    'outputs',
    'launch-staging-customer-portal-smoke',
    stamp(startedAt),
);
mkdirSync(outputDir, { recursive: true });

const artifacts: RunnerReport['artifacts'] = {
    summaryJson: path.join(outputDir, 'summary.json'),
    summaryMarkdown: path.join(outputDir, 'summary.md'),
    manifest: path.join(outputDir, 'manifest.json'),
    executionPlan: path.join(outputDir, 'execution-plan.md'),
    approvalGate: path.join(outputDir, 'approval-gate.md'),
    cleanupRunbook: path.join(outputDir, 'cleanup-runbook.md'),
};
const checks: Check[] = [];
const resources: ResourceEvidence = {
    checkpointPath: null,
    runFingerprint: null,
    customerFingerprint: null,
    subscriptionFingerprint: null,
    localSubscriptionFingerprint: null,
    portalUrlStored: false,
    screenshotsStored: false,
};
let externalReadPerformed = false;
let externalWriteAttempted = false;
let externalWritePerformed = false;
let cleanupAttempted = false;
let cleanupVerified = false;
let closureStatus: RunnerReport['closureStatus'] = mode === 'plan' ? 'PLAN_ONLY_READY' : 'BLOCKED';
let testStudentFingerprint: string | null = null;
let stagingEnv: Record<string, string | undefined> = {};

try {
    stagingEnv = loadStagingEnv();
    const envValidation = validateStagingPortalSmokeEnv(stagingEnv);
    checks.push({
        status: envValidation.valid ? 'ok' : 'failed',
        name: 'local_staging_environment',
        message: envValidation.valid
            ? 'The secure staging source identifies exact Supabase/Stripe/Portal targets, test keys, TEST_STUDENT_* and checkout=false.'
            : 'The staging source is missing or does not match the exact Portal smoke scope.',
        details: envValidation.details,
    });
    testStudentFingerprint = fingerprintPortalSmokeValue(stagingEnv.TEST_STUDENT_EMAIL?.trim().toLowerCase());
} catch (error) {
    checks.push(failedCheck('local_staging_environment', 'Could not load the secure staging source.', error));
}

checks.push(validatePackageScript());
checks.push(validateRunnerSourcePosture());
checks.push(validateNoUnresolvedCheckpoint(mode, checkpointArgument));

if (selectedModes > 1) {
    checks.push({
        status: 'failed',
        name: 'mode_exclusive',
        message: 'Use only one of --preflight-readonly, --execute-approved or --cleanup-only.',
        details: ['externalReadPerformed=false', 'externalWriteAttempted=false'],
    });
} else if (checks.some((check) => check.status === 'failed')) {
    checks.push({
        status: 'failed',
        name: 'local_gates_before_network',
        message: 'A local gate failed, so no external read or write can start.',
        details: ['externalReadPerformed=false', 'externalWriteAttempted=false'],
    });
} else if (mode === 'plan') {
    checks.push({
        status: 'ok',
        name: 'plan_mode_no_external_access',
        message: 'Default plan mode generated local artifacts without contacting staging, Stripe, Supabase or the browser.',
        details: ['externalReadPerformed=false', 'externalWriteAttempted=false'],
    });
} else if ((mode === 'execute-approved' || mode === 'cleanup-only') && !approvalMatched) {
    checks.push({
        status: 'failed',
        name: 'exact_approval_gate',
        message: 'Write-capable mode was requested without the exact approval value; no external request was made.',
        details: [
            `env=${STAGING_PORTAL_SMOKE_APPROVAL_ENV}`,
            'required=exact sentence in approval-gate.md',
            'externalReadPerformed=false',
            'externalWriteAttempted=false',
        ],
    });
} else {
    try {
        const stripe = createStripe(stagingEnv);
        const supabase = createSupabase(stagingEnv);
        if (mode === 'cleanup-only') {
            if (!checkpointArgument) throw new Error('--cleanup-only requires --checkpoint=<path>');
            const checkpointPath = resolveCheckpointPath(checkpointArgument);
            const checkpoint = readCheckpoint(checkpointPath);
            resources.checkpointPath = toRelative(checkpointPath);
            setResourceFingerprints(checkpoint);
            externalReadPerformed = true;
            await assertExactRemoteAccounts(stripe, supabase, checkpoint.studentId);
            externalWriteAttempted = true;
            cleanupAttempted = true;
            const cleanup = await cleanupOwnedResources({ checkpoint, checkpointPath, stripe, supabase });
            cleanupVerified = cleanup.cleaned;
            externalWritePerformed = cleanup.anyWrite;
            checks.push({
                status: cleanup.cleaned ? 'ok' : 'failed',
                name: 'cleanup_only_verified',
                message: cleanup.cleaned
                    ? 'Cleanup-only mode reconciled and verified the exact checkpoint-owned Stripe/Supabase resources.'
                    : 'Cleanup-only mode could not prove complete cleanup; the checkpoint remains for another reviewed attempt.',
                details: cleanup.errors.map((error) => sanitizePortalSmokeText(error)),
            });
            if (cleanup.cleaned) closureStatus = 'CLEANUP_VERIFIED';
        } else {
            externalReadPerformed = true;
            const preflight = await runReadOnlyPreflight(stripe, supabase, stagingEnv);
            checks.push({
                status: 'ok',
                name: 'remote_readonly_preflight',
                message: 'Read-only preflight verified checkout=false attestation, exact Stripe test account/Portal config, student, catalog offer and clean fixture boundary.',
                details: [
                    `supabaseProjectRef=${STAGING_PORTAL_SMOKE.supabaseProjectRef}`,
                    `stripeAccountId=${STAGING_PORTAL_SMOKE.stripeAccountId}`,
                    'checkout=false',
                    `webVersionFingerprint=${fingerprintPortalSmokeValue(preflight.webVersionId)}`,
                ],
            });
            if (mode === 'preflight-readonly') {
                closureStatus = 'PREFLIGHT_VERIFIED';
            } else {
                checks.push({
                    status: 'ok',
                    name: 'exact_approval_gate',
                    message: 'Exact approval matched after local gates and the read-only preflight.',
                    details: [`env=${STAGING_PORTAL_SMOKE_APPROVAL_ENV}`],
                });
                externalWriteAttempted = true;
                const execution = await runApprovedPortalSmoke({
                    env: stagingEnv,
                    language,
                    preflight,
                    stripe,
                    supabase,
                });
                externalWritePerformed = execution.anyWrite;
                cleanupAttempted = true;
                cleanupVerified = execution.cleanupVerified;
                resources.checkpointPath = toRelative(execution.checkpointPath);
                setResourceFingerprints(execution.checkpoint);
                checks.push(...execution.checks);
                if (execution.smokeVerified && execution.cleanupVerified) closureStatus = 'EXECUTED_CLEAN';
            }
        }
    } catch (error) {
        checks.push(failedCheck('remote_or_execution_flow', 'Portal smoke flow stopped safely.', error));
    }
}

let report = buildReport();
writeLocalArtifacts(report);
checks.push(validateGeneratedArtifacts());
report = buildReport();
writeLocalArtifacts(report);

console.log(`[launch:staging-customer-portal-smoke] Status: ${report.status}`);
console.log(`[launch:staging-customer-portal-smoke] Closure: ${report.closureStatus}`);
console.log(`[launch:staging-customer-portal-smoke] Mode: ${report.mode}`);
console.log(`[launch:staging-customer-portal-smoke] External write attempted: ${String(report.externalWriteAttempted)}`);
console.log(`[launch:staging-customer-portal-smoke] Cleanup verified: ${String(report.cleanupVerified)}`);
console.log(`[launch:staging-customer-portal-smoke] Summary: ${report.artifacts.summaryMarkdown}`);

if (report.status === 'FAILED') process.exit(1);

function buildReport(): RunnerReport {
    const status = statusFor(checks);
    if (status === 'FAILED') closureStatus = 'BLOCKED';
    return {
        schemaVersion: 1,
        startedAt: startedAt.toISOString(),
        endedAt: new Date().toISOString(),
        status,
        closureStatus,
        mode,
        target: STAGING_PORTAL_SMOKE,
        language,
        approvalMatched,
        externalReadPerformed,
        externalWriteAttempted,
        externalWritePerformed,
        cleanupAttempted,
        cleanupVerified,
        testStudentFingerprint,
        checks,
        resources,
        artifacts,
    };
}

function loadStagingEnv(): Record<string, string | undefined> {
    const envPath = path.join(process.cwd(), '.env.staging');
    if (!existsSync(envPath)) throw new Error('.env.staging is missing');
    const parsed = parse(readFileSync(envPath));
    return Object.fromEntries(Object.entries(parsed).map(([key, value]) => [key, value.trim()]));
}

function createStripe(env: Record<string, string | undefined>): Stripe {
    const secret = requiredEnv(env, 'STRIPE_SECRET_KEY');
    if (!secret.startsWith('sk_test_')) throw new Error('Stripe key must remain test mode');
    return new Stripe(secret, { maxNetworkRetries: 0, timeout: 20_000 });
}

function createSupabase(env: Record<string, string | undefined>): SupabaseClient<Database> {
    return createClient<Database>(
        requiredEnv(env, 'PUBLIC_SUPABASE_URL'),
        requiredEnv(env, 'SUPABASE_SERVICE_ROLE_KEY'),
        { auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false } },
    );
}

async function runReadOnlyPreflight(
    stripe: Stripe,
    supabase: SupabaseClient<Database>,
    env: Record<string, string | undefined>,
): Promise<ReadOnlyPreflight> {
    const [account, webVersionId] = await Promise.all([
        stripe.accounts.retrieve(),
        attestCheckoutDisabled(env),
    ]);
    if (account.id !== STAGING_PORTAL_SMOKE.stripeAccountId) throw new Error('Stripe account mismatch');

    const configurationId = requiredEnv(env, 'STRIPE_PORTAL_CONFIGURATION_ID');
    const configuration = await stripe.billingPortal.configurations.retrieve(configurationId);
    const portalValidation = validatePortalConfig({
        id: configuration.id,
        active: configuration.active,
        livemode: configuration.livemode,
        defaultReturnUrl: configuration.default_return_url,
        paymentMethodUpdateEnabled: configuration.features.payment_method_update.enabled,
        invoiceHistoryEnabled: configuration.features.invoice_history.enabled,
        subscriptionCancelEnabled: configuration.features.subscription_cancel.enabled,
        subscriptionCancelMode: configuration.features.subscription_cancel.mode,
        subscriptionCancelProration: configuration.features.subscription_cancel.proration_behavior,
        subscriptionUpdateEnabled: configuration.features.subscription_update.enabled,
    }, configurationId);
    if (!portalValidation.valid) throw new Error(`Portal configuration is unsafe: ${portalValidation.details.join('; ')}`);

    const studentEmail = requiredEnv(env, 'TEST_STUDENT_EMAIL').trim().toLowerCase();
    const student = await findExactAuthUser(supabase, studentEmail);
    if (!student.email_confirmed_at) throw new Error('TEST_STUDENT_EMAIL is not confirmed');

    const [profileResult, privateResult, activeSubscriptionsResult, packagePricesResult, emailBudget] = await Promise.all([
        supabase.from('profiles').select('id,email,role').eq('id', student.id).maybeSingle(),
        supabase
            .from('profiles_private')
            .select('stripe_customer_id,stripe_customer_account_id,stripe_customer_livemode,updated_at')
            .eq('profile_id', student.id)
            .maybeSingle(),
        supabase
            .from('subscriptions')
            .select('id')
            .eq('student_id', student.id)
            .in('status', ['active', 'pending', 'paused'])
            .limit(2),
        supabase
            .from('package_prices')
            .select('id,package_id,package_key,duration_months,currency,sessions_per_period,status,stripe_account_id,stripe_livemode,stripe_product_id,stripe_price_id')
            .eq('package_key', 'standard')
            .eq('duration_months', 1)
            .eq('currency', 'eur')
            .eq('status', 'active')
            .eq('stripe_account_id', STAGING_PORTAL_SMOKE.stripeAccountId)
            .eq('stripe_livemode', false)
            .limit(2),
        readEmailBudget(supabase),
    ]);
    if (profileResult.error || !profileResult.data) throw profileResult.error ?? new Error('Student profile is missing');
    if (profileResult.data.role !== 'student' || profileResult.data.email?.trim().toLowerCase() !== studentEmail) {
        throw new Error('TEST_STUDENT_EMAIL is not the exact student profile');
    }
    if (privateResult.error || !privateResult.data) throw privateResult.error ?? new Error('Student private profile is missing');
    if (activeSubscriptionsResult.error) throw activeSubscriptionsResult.error;
    if ((activeSubscriptionsResult.data?.length ?? 0) !== 0) {
        throw new Error('TEST_STUDENT_EMAIL already has an active/pending/paused local subscription');
    }
    if (packagePricesResult.error || packagePricesResult.data?.length !== 1) {
        throw packagePricesResult.error ?? new Error('Exact Standard one-month staging offer is not unique');
    }
    const offer = packagePricesResult.data[0];
    const stripePrice = await stripe.prices.retrieve(offer.stripe_price_id);
    if (
        !stripePrice.active
        || stripePrice.livemode
        || stripePrice.currency !== 'eur'
        || stripePrice.type !== 'recurring'
        || stripePrice.recurring?.interval !== 'month'
        || stripePrice.recurring.interval_count !== 1
        || stripeObjectId(stripePrice.product) !== offer.stripe_product_id
    ) {
        throw new Error('Stripe staging price does not match the immutable Standard one-month offer');
    }

    return {
        studentId: student.id,
        privateBilling: {
            stripeCustomerId: privateResult.data.stripe_customer_id,
            stripeCustomerAccountId: privateResult.data.stripe_customer_account_id,
            stripeCustomerLivemode: privateResult.data.stripe_customer_livemode,
            updatedAt: privateResult.data.updated_at,
        },
        packageOffer: {
            id: offer.id,
            packageId: offer.package_id,
            stripePriceId: offer.stripe_price_id,
            stripeProductId: offer.stripe_product_id,
            sessionsPerPeriod: offer.sessions_per_period,
            durationMonths: offer.duration_months,
        },
        emailBudget,
        portalConfigurationId: configuration.id,
        webVersionId,
    };
}

async function attestCheckoutDisabled(env: Record<string, string | undefined>): Promise<string> {
    const healthResponse = await fetch(`${STAGING_PORTAL_SMOKE.webOrigin}/health`, {
        headers: { 'Cache-Control': 'no-cache' },
        redirect: 'manual',
    });
    const health = await readJsonRecord(healthResponse, 'Staging health');
    if (
        healthResponse.status !== 200
        || health.status !== 'ok'
        || health.appEnvironment !== 'staging'
        || health.workerIdentity !== STAGING_PORTAL_SMOKE.workerIdentity
        || health.runtimeMode !== 'active'
        || health.checkoutEnabled !== false
    ) {
        throw new Error('Staging /health does not attest active checkout=false runtime');
    }

    const nonce = randomUUID();
    const attestationResponse = await fetch(`${STAGING_PORTAL_SMOKE.webOrigin}/api/internal/runtime-attestation`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${requiredEnv(env, 'INTERNAL_JOB_SECRET')}`,
            'Cache-Control': 'no-cache',
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ nonce }),
        redirect: 'manual',
    });
    const envelopeRecord = await readJsonRecord(attestationResponse, 'Staging runtime attestation');
    if (
        attestationResponse.status !== 200
        || envelopeRecord.schema !== RUNTIME_ATTESTATION_SCHEMA
        || envelopeRecord.role !== 'web'
        || envelopeRecord.workerIdentity !== STAGING_PORTAL_SMOKE.workerIdentity
        || typeof envelopeRecord.workerVersionId !== 'string'
        || typeof envelopeRecord.proof !== 'string'
        || envelopeRecord.nonce !== nonce
    ) {
        throw new Error('Staging runtime attestation envelope is invalid');
    }
    const envelope = envelopeRecord as unknown as RuntimeAttestationEnvelope;
    const config = await buildRuntimeAttestationConfig('web', {
        ...env,
        CHECKOUT_ENABLED: 'false',
        CHECKOUT_ENABLED_OVERRIDE: 'false',
        FULFILLMENT_RUNTIME_MODE: 'absent',
        PUBLIC_APP_ENV: 'staging',
        SUPABASE_EXPECTED_PROJECT_REF: STAGING_PORTAL_SMOKE.supabaseProjectRef,
        WEB_RUNTIME_MODE: 'active',
        WORKER_IDENTITY: STAGING_PORTAL_SMOKE.workerIdentity,
        WORKER_VERSION_ID: envelope.workerVersionId,
    });
    if (!await verifyRuntimeAttestation(envelope, {
        config,
        nonce,
        role: 'web',
        schema: RUNTIME_ATTESTATION_SCHEMA,
    }, requiredEnv(env, 'INTERNAL_JOB_SECRET'))) {
        throw new Error('Staging runtime attestation proof does not match checkout=false configuration');
    }

    const checkoutProbe = await fetch(`${STAGING_PORTAL_SMOKE.webOrigin}/api/create-checkout`, {
        method: 'POST',
        headers: { 'Cache-Control': 'no-cache', 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
        redirect: 'manual',
    });
    const probeBody = await readJsonRecord(checkoutProbe, 'Checkout-disabled probe');
    if (checkoutProbe.status !== 403 || probeBody.error !== 'Checkout is disabled') {
        throw new Error('Deployed checkout probe did not return exact 403 Checkout is disabled');
    }
    return envelope.workerVersionId;
}

async function runApprovedPortalSmoke(input: {
    env: Record<string, string | undefined>;
    language: PortalSmokeLang;
    preflight: ReadOnlyPreflight;
    stripe: Stripe;
    supabase: SupabaseClient<Database>;
}): Promise<{
    anyWrite: boolean;
    checkpoint: CleanupCheckpoint;
    checkpointPath: string;
    checks: Check[];
    smokeVerified: boolean;
    cleanupVerified: boolean;
}> {
    const runId = randomUUID();
    const localSubscriptionId = randomUUID();
    const checkpointPath = path.join(
        process.cwd(),
        'outputs',
        'launch-staging-customer-portal-smoke',
        'checkpoints',
        `${runId}.json`,
    );
    let checkpoint: CleanupCheckpoint = {
        schemaVersion: 1,
        runId,
        status: 'prepared',
        startedAt: new Date().toISOString(),
        studentId: input.preflight.studentId,
        privateBillingBefore: input.preflight.privateBilling,
        packageOffer: input.preflight.packageOffer,
        localSubscriptionId,
        stripeCustomerId: null,
        stripeSubscriptionId: null,
        eventIds: [],
        cleanupErrors: [],
    };
    writeCheckpoint(checkpointPath, checkpoint);
    let browser: Browser | null = null;
    let smokeVerified = false;
    let anyWrite = false;
    const executionChecks: Check[] = [];

    try {
        const customer = await input.stripe.customers.create({
            email: requiredEnv(input.env, 'TEST_STUDENT_EMAIL'),
            preferred_locales: [input.language],
            metadata: {
                source: STAGING_PORTAL_SMOKE.source,
                portalSmokeRunId: runId,
                supabase_user_id: input.preflight.studentId,
            },
        }, { idempotencyKey: `portal-smoke-customer-${runId}` });
        anyWrite = true;
        externalWritePerformed = true;
        assertOwned(customer.metadata, customer.livemode, runId, 'Customer');
        checkpoint = { ...checkpoint, stripeCustomerId: customer.id, status: 'customer_created' };
        writeCheckpoint(checkpointPath, checkpoint);

        const subscription = await input.stripe.subscriptions.create({
            customer: customer.id,
            items: [{ price: input.preflight.packageOffer.stripePriceId, quantity: 1 }],
            trial_period_days: STAGING_PORTAL_SMOKE.trialDays,
            trial_settings: { end_behavior: { missing_payment_method: 'cancel' } },
            collection_method: 'charge_automatically',
            payment_behavior: 'error_if_incomplete',
            automatic_tax: { enabled: false },
            metadata: {
                source: STAGING_PORTAL_SMOKE.source,
                portalSmokeRunId: runId,
                userId: input.preflight.studentId,
                packagePriceId: input.preflight.packageOffer.id,
                localSubscriptionId,
            },
        }, { idempotencyKey: `portal-smoke-subscription-${runId}` });
        assertOwned(subscription.metadata, subscription.livemode, runId, 'Subscription');
        checkpoint = { ...checkpoint, stripeSubscriptionId: subscription.id, status: 'subscription_created' };
        writeCheckpoint(checkpointPath, checkpoint);

        const trialValidation = await validateCreatedTrial(input.stripe, subscription, customer.id, input.preflight.packageOffer.stripePriceId);
        if (!trialValidation.valid) throw new Error(`Unsafe trial fixture: ${trialValidation.details.join('; ')}`);

        await linkTemporaryBillingCustomer(input.supabase, checkpoint);
        await insertTemporaryLocalSubscription(input.supabase, checkpoint, subscription);
        checkpoint = { ...checkpoint, status: 'supabase_prepared' };
        writeCheckpoint(checkpointPath, checkpoint);

        browser = await chromium.launch({ headless: false, slowMo: 50 });
        const context = await browser.newContext({
            locale: input.language === 'es' ? 'es-ES' : 'en-US',
            viewport: { width: 1365, height: 900 },
        });
        const page = await context.newPage();
        await exercisePortalUi({
            env: input.env,
            language: input.language,
            page,
            stripe: input.stripe,
            subscriptionId: subscription.id,
        });

        const cancelled = await input.stripe.subscriptions.retrieve(subscription.id);
        const cancellationValidation = validateCancellation(subscriptionCancellationSnapshot(cancelled));
        if (!cancellationValidation.valid) {
            throw new Error(`Portal did not schedule exact period-end cancellation: ${cancellationValidation.details.join('; ')}`);
        }
        const zeroMoneyValidation = await validateCreatedTrial(input.stripe, cancelled, customer.id, input.preflight.packageOffer.stripePriceId);
        const cancellationOnlyDetails = zeroMoneyValidation.details.filter((detail) => detail !== 'subscription starts pre-cancelled');
        if (cancellationOnlyDetails.length > 0) {
            throw new Error(`Portal smoke generated payment state: ${cancellationOnlyDetails.join('; ')}`);
        }
        const emailBudgetAfter = await readEmailBudget(input.supabase);
        if (
            emailBudgetAfter.daily !== input.preflight.emailBudget.daily
            || emailBudgetAfter.monthly !== input.preflight.emailBudget.monthly
        ) {
            throw new Error('Resend recipient budget changed during the Portal smoke');
        }

        const eventIds = await collectOwnedEventIds(input.stripe, checkpoint);
        checkpoint = { ...checkpoint, eventIds, status: 'portal_verified' };
        writeCheckpoint(checkpointPath, checkpoint);
        smokeVerified = true;
        executionChecks.push({
            status: 'ok',
            name: 'real_portal_ui_cancellation',
            message: 'Playwright logged in, opened the configured Stripe Portal from the real account button, scheduled period-end cancellation and returned to the exact account URL.',
            details: [
                `language=${input.language}`,
                'cancelAtPeriodEndOrExactDate=true',
                'portalUrlStored=false',
                'screenshotsStored=false',
                'paymentIntents=0',
                'charges=0',
                'resendBudgetDelta=0',
            ],
        });
    } catch (error) {
        executionChecks.push(failedCheck('real_portal_ui_cancellation', 'Real Portal UI execution failed before verified completion.', error));
    } finally {
        if (browser) await browser.close().catch(() => undefined);
        cleanupAttempted = true;
        checkpoint = readCheckpoint(checkpointPath);
        const cleanup = await cleanupOwnedResources({
            checkpoint,
            checkpointPath,
            stripe: input.stripe,
            supabase: input.supabase,
        });
        checkpoint = readCheckpoint(checkpointPath);
        anyWrite = anyWrite || cleanup.anyWrite;
        executionChecks.push({
            status: cleanup.cleaned ? 'ok' : 'failed',
            name: 'exact_cleanup_after_portal_smoke',
            message: cleanup.cleaned
                ? 'Exact Stripe and Supabase temporary resources were reconciled and cleanup was verified.'
                : 'Cleanup is incomplete; the owned checkpoint remains available for --cleanup-only recovery.',
            details: cleanup.errors.map((error) => sanitizePortalSmokeText(error)),
        });
    }

    return {
        anyWrite,
        checkpoint,
        checkpointPath,
        checks: executionChecks,
        smokeVerified,
        cleanupVerified: checkpoint.status === 'cleaned',
    };
}

async function exercisePortalUi(input: {
    env: Record<string, string | undefined>;
    language: PortalSmokeLang;
    page: Page;
    stripe: Stripe;
    subscriptionId: string;
}): Promise<void> {
    const accountUrl = `${STAGING_PORTAL_SMOKE.webOrigin}/${input.language}/campus/account`;
    await input.page.goto(`${STAGING_PORTAL_SMOKE.webOrigin}/${input.language}/login`, {
        waitUntil: 'domcontentloaded',
        timeout: 30_000,
    });
    await input.page.locator('input[type="email"]').fill(requiredEnv(input.env, 'TEST_STUDENT_EMAIL'));
    await input.page.locator('input[type="password"]').fill(requiredEnv(input.env, 'TEST_STUDENT_PASSWORD'));
    await Promise.all([
        input.page.waitForURL((url) => (
            url.origin === STAGING_PORTAL_SMOKE.webOrigin
            && url.pathname.startsWith(`/${input.language}/campus`)
        ), { timeout: 30_000 }),
        input.page.locator('button[type="submit"]').click(),
    ]);
    const dashboardUrl = `${STAGING_PORTAL_SMOKE.webOrigin}/${input.language}/campus`;
    if (new URL(input.page.url()).pathname !== `/${input.language}/campus`) {
        await input.page.goto(dashboardUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    }
    const manageButton = input.page.locator('#manage-sub-btn');
    await manageButton.waitFor({ state: 'visible', timeout: 20_000 });
    await Promise.all([
        input.page.waitForURL((url) => url.protocol === 'https:' && url.hostname === 'billing.stripe.com', { timeout: 30_000 }),
        manageButton.click(),
    ]);
    await dismissStripeCookies(input.page);

    for (let step = 0; step < 6; step += 1) {
        const current = await input.stripe.subscriptions.retrieve(input.subscriptionId);
        if (validateCancellation(subscriptionCancellationSnapshot(current)).valid) break;

        const radios = input.page.getByRole('radio');
        if (await radios.count() > 0 && !await anyChecked(radios)) {
            await radios.first().check();
        }

        const cancelAction = await firstVisibleByNames(input.page, ['button', 'link'], PORTAL_CANCEL_ACTION_NAMES);
        const continueAction = cancelAction ?? await firstVisibleByNames(input.page, ['button'], PORTAL_CONTINUE_ACTION_NAMES);
        if (!continueAction) throw new Error('Could not find a visible ES/EN cancellation action in Stripe Portal');
        await continueAction.click();
        await input.page.waitForLoadState('domcontentloaded', { timeout: 15_000 }).catch(() => undefined);
        await dismissStripeCookies(input.page);
    }

    const scheduled = await waitForSubscriptionCancellation(input.stripe, input.subscriptionId, 20_000);
    const scheduledValidation = validateCancellation(subscriptionCancellationSnapshot(scheduled));
    if (!scheduledValidation.valid) throw new Error(scheduledValidation.details.join('; '));

    if (input.page.url() !== accountUrl) {
        const returnLink = await firstSafeReturnLink(input.page, accountUrl, input.language);
        if (!returnLink) throw new Error('Stripe Portal has no visible exact staging return link');
        await Promise.all([
            input.page.waitForURL((url) => url.href === accountUrl, { timeout: 30_000 }),
            returnLink.click(),
        ]);
    }
    const safeReturn = validateSafeReturnUrl(input.page.url(), input.language);
    if (!safeReturn.valid) throw new Error(`Unsafe Portal return: ${safeReturn.details.join('; ')}`);
    await input.page.waitForLoadState('domcontentloaded', { timeout: 20_000 });
}

async function validateCreatedTrial(
    stripe: Stripe,
    subscription: Stripe.Subscription,
    customerId: string,
    priceId: string,
) {
    const [paymentMethods, paymentIntents, charges] = await Promise.all([
        stripe.paymentMethods.list({ customer: customerId, limit: 10 }),
        stripe.paymentIntents.list({ customer: customerId, limit: 10 }),
        stripe.charges.list({ customer: customerId, limit: 10 }),
    ]);
    const invoiceId = stripeObjectId(subscription.latest_invoice);
    const invoice = invoiceId ? await stripe.invoices.retrieve(invoiceId) : null;
    const item = subscription.items.data[0];
    return validateTrialSubscription({
        status: subscription.status,
        livemode: subscription.livemode,
        customerId: stripeObjectId(subscription.customer) ?? '',
        expectedCustomerId: customerId,
        itemCount: subscription.items.data.length,
        priceId: item?.price.id ?? '',
        expectedPriceId: priceId,
        periodEnd: subscriptionPeriodEnd(subscription),
        trialEnd: subscription.trial_end,
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
        cancelAt: subscription.cancel_at,
        missingPaymentMethodBehavior: subscription.trial_settings?.end_behavior.missing_payment_method ?? null,
        paymentMethodCount: paymentMethods.data.length,
        paymentIntentCount: paymentIntents.data.length,
        chargeCount: charges.data.length,
        invoiceAmountDue: invoice?.amount_due ?? null,
        invoiceAmountPaid: invoice?.amount_paid ?? null,
        invoiceTotal: invoice?.total ?? null,
    }, Math.floor(Date.now() / 1000));
}

async function linkTemporaryBillingCustomer(
    supabase: SupabaseClient<Database>,
    checkpoint: CleanupCheckpoint,
): Promise<void> {
    if (!checkpoint.stripeCustomerId) throw new Error('Temporary Customer is missing');
    let update = supabase
        .from('profiles_private')
        .update({
            stripe_customer_id: checkpoint.stripeCustomerId,
            stripe_customer_account_id: STAGING_PORTAL_SMOKE.stripeAccountId,
            stripe_customer_livemode: false,
        })
        .eq('profile_id', checkpoint.studentId);
    update = checkpoint.privateBillingBefore.updatedAt === null
        ? update.is('updated_at', null)
        : update.eq('updated_at', checkpoint.privateBillingBefore.updatedAt);
    const { data, error } = await update.select('profile_id').maybeSingle();
    if (error || !data) throw error ?? new Error('Private billing snapshot changed concurrently');
}

async function insertTemporaryLocalSubscription(
    supabase: SupabaseClient<Database>,
    checkpoint: CleanupCheckpoint,
    subscription: Stripe.Subscription,
): Promise<void> {
    if (!checkpoint.stripeSubscriptionId) throw new Error('Temporary Subscription is missing');
    const item = subscription.items.data[0];
    const periodStart = subscriptionPeriodStart(subscription);
    const periodEnd = subscriptionPeriodEnd(subscription);
    if (!item || !periodStart || !periodEnd) throw new Error('Trial Subscription has no exact period boundaries');
    const { error } = await supabase.from('subscriptions').insert({
        id: checkpoint.localSubscriptionId,
        student_id: checkpoint.studentId,
        package_id: checkpoint.packageOffer.packageId,
        package_price_id: checkpoint.packageOffer.id,
        status: 'active',
        duration_months: checkpoint.packageOffer.durationMonths,
        contracted_sessions_per_period: checkpoint.packageOffer.sessionsPerPeriod,
        sessions_total: checkpoint.packageOffer.sessionsPerPeriod,
        sessions_used: 0,
        starts_at: isoDate(periodStart),
        ends_at: isoDate(periodEnd),
        stripe_subscription_id: checkpoint.stripeSubscriptionId,
        stripe_invoice_id: null,
    });
    if (error) throw error;
}

async function cleanupOwnedResources(input: {
    checkpoint: CleanupCheckpoint;
    checkpointPath: string;
    stripe: Stripe;
    supabase: SupabaseClient<Database>;
}): Promise<{ anyWrite: boolean; cleaned: boolean; errors: string[] }> {
    let checkpoint = { ...input.checkpoint, status: 'cleanup_started' as const, cleanupErrors: [] };
    writeCheckpoint(input.checkpointPath, checkpoint);
    const errors: string[] = [];
    let anyWrite = false;

    const subscription = await findOwnedSubscription(input.stripe, checkpoint).catch((error) => {
        errors.push(`find_subscription: ${safeError(error)}`);
        return null;
    });
    if (subscription) {
        const ownership = validateOwnedStripeResource({
            source: subscription.metadata.source,
            runId: subscription.metadata.portalSmokeRunId,
            expectedRunId: checkpoint.runId,
            livemode: subscription.livemode,
        });
        if (!ownership.valid) {
            errors.push(`subscription_ownership: ${ownership.details.join('; ')}`);
        } else {
            checkpoint = { ...checkpoint, stripeSubscriptionId: subscription.id };
            writeCheckpoint(input.checkpointPath, checkpoint);
            try {
                await input.stripe.subscriptions.update(subscription.id, {
                    metadata: { userId: '', source: STAGING_PORTAL_SMOKE.source, portalSmokeRunId: checkpoint.runId },
                });
                anyWrite = true;
            } catch (error) {
                errors.push(`strip_subscription_user_metadata: ${safeError(error)}`);
            }
        }
    }

    try {
        const { error } = await input.supabase
            .from('subscriptions')
            .delete()
            .eq('id', checkpoint.localSubscriptionId)
            .eq('student_id', checkpoint.studentId)
            .eq('package_price_id', checkpoint.packageOffer.id)
            .eq('stripe_subscription_id', checkpoint.stripeSubscriptionId ?? '__missing__');
        if (error) throw error;
        anyWrite = true;
    } catch (error) {
        errors.push(`delete_local_subscription: ${safeError(error)}`);
    }

    if (checkpoint.stripeCustomerId) {
        try {
            const currentResult = await input.supabase
                .from('profiles_private')
                .select('stripe_customer_id,stripe_customer_account_id,stripe_customer_livemode')
                .eq('profile_id', checkpoint.studentId)
                .maybeSingle();
            if (currentResult.error || !currentResult.data) {
                throw currentResult.error ?? new Error('Private billing row is missing');
            }
            const alreadyRestored = currentResult.data.stripe_customer_id === checkpoint.privateBillingBefore.stripeCustomerId
                && currentResult.data.stripe_customer_account_id === checkpoint.privateBillingBefore.stripeCustomerAccountId
                && currentResult.data.stripe_customer_livemode === checkpoint.privateBillingBefore.stripeCustomerLivemode;
            const stillTemporary = currentResult.data.stripe_customer_id === checkpoint.stripeCustomerId
                && currentResult.data.stripe_customer_account_id === STAGING_PORTAL_SMOKE.stripeAccountId
                && currentResult.data.stripe_customer_livemode === false;
            if (!alreadyRestored && !stillTemporary) {
                throw new Error('Private billing fields changed outside the owned smoke transition');
            }
            if (stillTemporary) {
                const { data, error } = await input.supabase
                    .from('profiles_private')
                    .update({
                        stripe_customer_id: checkpoint.privateBillingBefore.stripeCustomerId,
                        stripe_customer_account_id: checkpoint.privateBillingBefore.stripeCustomerAccountId,
                        stripe_customer_livemode: checkpoint.privateBillingBefore.stripeCustomerLivemode,
                    })
                    .eq('profile_id', checkpoint.studentId)
                    .eq('stripe_customer_id', checkpoint.stripeCustomerId)
                    .eq('stripe_customer_account_id', STAGING_PORTAL_SMOKE.stripeAccountId)
                    .eq('stripe_customer_livemode', false)
                    .select('profile_id')
                    .maybeSingle();
                if (error || !data) throw error ?? new Error('Temporary private billing link no longer matches ownership');
                anyWrite = true;
            }
        } catch (error) {
            errors.push(`restore_private_billing: ${safeError(error)}`);
        }
    }

    if (subscription && subscription.status !== 'canceled') {
        try {
            await input.stripe.subscriptions.cancel(subscription.id, { prorate: false, invoice_now: false });
            anyWrite = true;
        } catch (error) {
            errors.push(`cancel_subscription: ${safeError(error)}`);
        }
    }

    const customer = await findOwnedCustomer(input.stripe, checkpoint).catch((error) => {
        errors.push(`find_customer: ${safeError(error)}`);
        return null;
    });
    if (customer && !customer.deleted) {
        const ownership = validateOwnedStripeResource({
            source: customer.metadata.source,
            runId: customer.metadata.portalSmokeRunId,
            expectedRunId: checkpoint.runId,
            livemode: customer.livemode,
        });
        if (!ownership.valid) {
            errors.push(`customer_ownership: ${ownership.details.join('; ')}`);
        } else {
            checkpoint = { ...checkpoint, stripeCustomerId: customer.id };
            writeCheckpoint(input.checkpointPath, checkpoint);
            try {
                await input.stripe.customers.del(customer.id);
                anyWrite = true;
            } catch (error) {
                errors.push(`delete_customer: ${safeError(error)}`);
            }
        }
    }

    try {
        const ownedEventIds = await collectOwnedEventIds(input.stripe, checkpoint);
        checkpoint = { ...checkpoint, eventIds: [...new Set([...checkpoint.eventIds, ...ownedEventIds])] };
        writeCheckpoint(input.checkpointPath, checkpoint);
        if (checkpoint.eventIds.length > 0) {
            await waitForProcessedEventsToSucceed(input.supabase, checkpoint.eventIds, 20_000);
            const { error } = await input.supabase
                .from('processed_webhook_events')
                .delete()
                .in('stripe_event_id', checkpoint.eventIds);
            if (error) throw error;
            anyWrite = true;
        }
    } catch (error) {
        errors.push(`cleanup_processed_events: ${safeError(error)}`);
    }

    const verification = await verifyCleanup(input.stripe, input.supabase, checkpoint).catch((error) => ({
        clean: false,
        errors: [`verify_cleanup: ${safeError(error)}`],
    }));
    errors.push(...verification.errors);
    const cleaned = errors.length === 0 && verification.clean;
    checkpoint = {
        ...checkpoint,
        status: cleaned ? 'cleaned' : 'cleanup_incomplete',
        cleanupErrors: errors.map(sanitizePortalSmokeText),
    };
    writeCheckpoint(input.checkpointPath, checkpoint);
    return { anyWrite, cleaned, errors };
}

async function verifyCleanup(
    stripe: Stripe,
    supabase: SupabaseClient<Database>,
    checkpoint: CleanupCheckpoint,
): Promise<{ clean: boolean; errors: string[] }> {
    const errors: string[] = [];
    const [localSubscription, privateBilling, payments, sessions, jobs, processedEvents] = await Promise.all([
        supabase.from('subscriptions').select('id').eq('id', checkpoint.localSubscriptionId).maybeSingle(),
        supabase
            .from('profiles_private')
            .select('stripe_customer_id,stripe_customer_account_id,stripe_customer_livemode')
            .eq('profile_id', checkpoint.studentId)
            .maybeSingle(),
        supabase.from('payments').select('id').eq('subscription_id', checkpoint.localSubscriptionId).limit(1),
        supabase.from('sessions').select('id').eq('subscription_id', checkpoint.localSubscriptionId).limit(1),
        supabase.from('fulfillment_jobs').select('id').eq('subscription_id', checkpoint.localSubscriptionId).limit(1),
        checkpoint.eventIds.length > 0
            ? supabase.from('processed_webhook_events').select('stripe_event_id').in('stripe_event_id', checkpoint.eventIds).limit(1)
            : Promise.resolve({ data: [], error: null }),
    ]);
    for (const [label, result] of [
        ['local_subscription', localSubscription],
        ['private_billing', privateBilling],
        ['payments', payments],
        ['sessions', sessions],
        ['jobs', jobs],
        ['processed_events', processedEvents],
    ] as const) {
        if (result.error) errors.push(`${label}: query failed`);
    }
    if (localSubscription.data) errors.push('local subscription remains');
    if (!privateBilling.data) {
        errors.push('private billing row is missing');
    } else if (
        privateBilling.data.stripe_customer_id !== checkpoint.privateBillingBefore.stripeCustomerId
        || privateBilling.data.stripe_customer_account_id !== checkpoint.privateBillingBefore.stripeCustomerAccountId
        || privateBilling.data.stripe_customer_livemode !== checkpoint.privateBillingBefore.stripeCustomerLivemode
    ) {
        errors.push('private billing snapshot was not restored exactly');
    }
    if ((payments.data?.length ?? 0) > 0) errors.push('temporary subscription has payment rows');
    if ((sessions.data?.length ?? 0) > 0) errors.push('temporary subscription has session rows');
    if ((jobs.data?.length ?? 0) > 0) errors.push('temporary subscription has fulfillment jobs');
    if ((processedEvents.data?.length ?? 0) > 0) errors.push('owned processed webhook rows remain');

    if (checkpoint.stripeSubscriptionId) {
        const subscription = await stripe.subscriptions.retrieve(checkpoint.stripeSubscriptionId);
        if (subscription.status !== 'canceled') errors.push('Stripe subscription is not canceled');
        const [paymentIntents, charges] = await Promise.all([
            stripe.paymentIntents.list({ customer: checkpoint.stripeCustomerId ?? undefined, limit: 10 }),
            stripe.charges.list({ customer: checkpoint.stripeCustomerId ?? undefined, limit: 10 }),
        ]);
        if (paymentIntents.data.length > 0) errors.push('temporary Stripe customer has PaymentIntents');
        if (charges.data.length > 0) errors.push('temporary Stripe customer has charges');
    }
    if (checkpoint.stripeCustomerId) {
        const customer = await stripe.customers.retrieve(checkpoint.stripeCustomerId);
        if (!('deleted' in customer) || customer.deleted !== true) errors.push('Stripe customer is not deleted');
    }
    return { clean: errors.length === 0, errors };
}

async function assertExactRemoteAccounts(
    stripe: Stripe,
    supabase: SupabaseClient<Database>,
    studentId: string,
): Promise<void> {
    const [account, profile] = await Promise.all([
        stripe.accounts.retrieve(),
        supabase.from('profiles').select('id,role').eq('id', studentId).maybeSingle(),
    ]);
    if (account.id !== STAGING_PORTAL_SMOKE.stripeAccountId) throw new Error('Stripe account mismatch');
    if (profile.error || profile.data?.role !== 'student') throw profile.error ?? new Error('Checkpoint student is invalid');
}

async function findOwnedSubscription(stripe: Stripe, checkpoint: CleanupCheckpoint): Promise<Stripe.Subscription | null> {
    if (checkpoint.stripeSubscriptionId) {
        try {
            return await stripe.subscriptions.retrieve(checkpoint.stripeSubscriptionId);
        } catch (error) {
            if (stripeErrorCode(error) !== 'resource_missing') throw error;
        }
    }
    const result = await stripe.subscriptions.search({
        query: `metadata['portalSmokeRunId']:'${checkpoint.runId}'`,
        limit: 10,
    });
    return result.data[0] ?? null;
}

async function findOwnedCustomer(stripe: Stripe, checkpoint: CleanupCheckpoint): Promise<Stripe.Customer | Stripe.DeletedCustomer | null> {
    if (checkpoint.stripeCustomerId) {
        try {
            return await stripe.customers.retrieve(checkpoint.stripeCustomerId);
        } catch (error) {
            if (stripeErrorCode(error) !== 'resource_missing') throw error;
        }
    }
    const result = await stripe.customers.search({
        query: `metadata['portalSmokeRunId']:'${checkpoint.runId}'`,
        limit: 10,
    });
    return result.data[0] ?? null;
}

async function collectOwnedEventIds(stripe: Stripe, checkpoint: CleanupCheckpoint): Promise<string[]> {
    const events = await stripe.events.list({
        created: { gte: Math.max(0, Math.floor(new Date(checkpoint.startedAt).getTime() / 1000) - 5) },
        limit: 100,
    });
    const ids = events.data.filter((event) => {
        if (event.livemode) return false;
        if (!['customer.subscription.updated', 'customer.subscription.deleted'].includes(event.type)) return false;
        const object = event.data.object as { id?: unknown; customer?: unknown; metadata?: unknown };
        const objectId = typeof object.id === 'string' ? object.id : null;
        const customerId = stripeObjectId(object.customer as string | { id: string } | null | undefined);
        const metadata = object.metadata && typeof object.metadata === 'object' && !Array.isArray(object.metadata)
            ? object.metadata as Record<string, unknown>
            : {};
        return objectId === checkpoint.stripeSubscriptionId
            || objectId === checkpoint.stripeCustomerId
            || customerId === checkpoint.stripeCustomerId
            || metadata.portalSmokeRunId === checkpoint.runId;
    }).map((event) => event.id);
    return [...new Set(ids)].sort();
}

async function waitForProcessedEventsToSucceed(
    supabase: SupabaseClient<Database>,
    eventIds: string[],
    timeoutMs: number,
): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const { data, error } = await supabase
            .from('processed_webhook_events')
            .select('stripe_event_id,processing_status')
            .in('stripe_event_id', eventIds);
        if (error) throw error;
        if ((data ?? []).some((row) => row.processing_status === 'failed')) {
            throw new Error('An owned Portal smoke webhook failed processing');
        }
        if (data?.length === eventIds.length && data.every((row) => row.processing_status === 'succeeded')) return;
        await delay(500);
    }
    throw new Error('Owned Portal smoke webhooks did not all reach succeeded before cleanup timeout');
}

async function readEmailBudget(supabase: SupabaseClient<Database>): Promise<EmailBudgetSnapshot> {
    const today = new Date().toISOString().slice(0, 10);
    const month = `${today.slice(0, 8)}01`;
    const { data, error } = await supabase
        .from('email_recipient_budget_usage')
        .select('period_kind,period_start,recipient_count')
        .eq('budget_scope', 'nonproduction')
        .in('period_start', [today, month]);
    if (error) throw error;
    return {
        daily: data?.find((row) => row.period_kind === 'day' && row.period_start === today)?.recipient_count ?? 0,
        monthly: data?.find((row) => row.period_kind === 'month' && row.period_start === month)?.recipient_count ?? 0,
    };
}

async function findExactAuthUser(supabase: SupabaseClient<Database>, email: string): Promise<User> {
    const matches: User[] = [];
    for (let page = 1; page <= 100; page += 1) {
        const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 100 });
        if (error) throw error;
        matches.push(...data.users.filter((user) => user.email?.trim().toLowerCase() === email));
        if (data.users.length < 100) break;
    }
    if (matches.length !== 1) throw new Error('TEST_STUDENT_EMAIL must resolve to exactly one existing Auth user');
    return matches[0];
}

async function waitForSubscriptionCancellation(
    stripe: Stripe,
    subscriptionId: string,
    timeoutMs: number,
): Promise<Stripe.Subscription> {
    const deadline = Date.now() + timeoutMs;
    let last = await stripe.subscriptions.retrieve(subscriptionId);
    while (Date.now() < deadline) {
        last = await stripe.subscriptions.retrieve(subscriptionId);
        if (validateCancellation(subscriptionCancellationSnapshot(last)).valid) return last;
        await delay(500);
    }
    return last;
}

function subscriptionCancellationSnapshot(subscription: Stripe.Subscription) {
    return {
        status: subscription.status,
        periodEnd: subscriptionPeriodEnd(subscription),
        trialEnd: subscription.trial_end,
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
        cancelAt: subscription.cancel_at,
    };
}

function subscriptionPeriodStart(subscription: Stripe.Subscription): number | null {
    const item = subscription.items.data[0] as Stripe.SubscriptionItem & { current_period_start?: unknown };
    return typeof item?.current_period_start === 'number' ? item.current_period_start : null;
}

function subscriptionPeriodEnd(subscription: Stripe.Subscription): number | null {
    const item = subscription.items.data[0] as Stripe.SubscriptionItem & { current_period_end?: unknown };
    return typeof item?.current_period_end === 'number' ? item.current_period_end : null;
}

async function dismissStripeCookies(page: Page): Promise<void> {
    const reject = await firstVisibleByNames(page, ['button'], PORTAL_COOKIE_REJECT_NAMES);
    if (reject) await reject.click();
}

async function firstVisibleByNames(
    page: Page,
    roles: Array<'button' | 'link'>,
    names: readonly RegExp[],
): Promise<Locator | null> {
    for (const role of roles) {
        for (const name of names) {
            const locator = page.getByRole(role, { name });
            for (let index = 0; index < await locator.count(); index += 1) {
                const candidate = locator.nth(index);
                if (await candidate.isVisible()) return candidate;
            }
        }
    }
    return null;
}

async function firstSafeReturnLink(page: Page, accountUrl: string, lang: PortalSmokeLang): Promise<Locator | null> {
    const links = page.locator('a[href]');
    for (let index = 0; index < await links.count(); index += 1) {
        const link = links.nth(index);
        if (!await link.isVisible()) continue;
        const href = await link.getAttribute('href');
        if (!href) continue;
        const resolved = new URL(href, page.url()).href;
        if (resolved === accountUrl && validateSafeReturnUrl(resolved, lang).valid) return link;
    }
    return null;
}

async function anyChecked(radios: Locator): Promise<boolean> {
    for (let index = 0; index < await radios.count(); index += 1) {
        if (await radios.nth(index).isChecked()) return true;
    }
    return false;
}

function assertOwned(
    metadata: Stripe.Metadata,
    livemode: boolean,
    runId: string,
    label: string,
): void {
    const validation = validateOwnedStripeResource({
        source: metadata.source,
        runId: metadata.portalSmokeRunId,
        expectedRunId: runId,
        livemode,
    });
    if (!validation.valid) throw new Error(`${label} ownership failed: ${validation.details.join('; ')}`);
}

function writeCheckpoint(filePath: string, checkpoint: CleanupCheckpoint): void {
    mkdirSync(path.dirname(filePath), { recursive: true });
    const temporary = `${filePath}.tmp-${process.pid}`;
    writeFileSync(temporary, `${JSON.stringify(checkpoint, null, 2)}\n`, 'utf8');
    renameSync(temporary, filePath);
}

function readCheckpoint(filePath: string): CleanupCheckpoint {
    const value = JSON.parse(readFileSync(filePath, 'utf8')) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Cleanup checkpoint is invalid');
    const checkpoint = value as CleanupCheckpoint;
    if (
        checkpoint.schemaVersion !== 1
        || !/^[0-9a-f-]{36}$/iu.test(checkpoint.runId)
        || !/^[0-9a-f-]{36}$/iu.test(checkpoint.studentId)
        || !/^[0-9a-f-]{36}$/iu.test(checkpoint.localSubscriptionId)
        || checkpoint.packageOffer?.id === undefined
        || checkpoint.privateBillingBefore === undefined
    ) {
        throw new Error('Cleanup checkpoint identity is invalid');
    }
    return checkpoint;
}

function resolveCheckpointPath(argument: string): string {
    const resolved = path.resolve(process.cwd(), argument);
    const checkpointRoot = path.resolve(
        process.cwd(),
        'outputs',
        'launch-staging-customer-portal-smoke',
        'checkpoints',
    );
    if (!resolved.startsWith(`${checkpointRoot}${path.sep}`) || path.extname(resolved) !== '.json') {
        throw new Error('Checkpoint must be a JSON file under the exact Portal smoke checkpoint directory');
    }
    if (!existsSync(resolved)) throw new Error('Checkpoint does not exist');
    return resolved;
}

function validateNoUnresolvedCheckpoint(currentMode: RunnerMode, checkpoint: string | null): Check {
    if (currentMode === 'cleanup-only' && checkpoint) {
        return {
            status: 'ok',
            name: 'unresolved_checkpoint_gate',
            message: 'Cleanup-only mode targets one explicitly named local checkpoint.',
            details: ['scope=one checkpoint'],
        };
    }
    const root = path.join(process.cwd(), 'outputs', 'launch-staging-customer-portal-smoke', 'checkpoints');
    if (!existsSync(root)) {
        return { status: 'ok', name: 'unresolved_checkpoint_gate', message: 'No prior Portal smoke checkpoints exist.', details: [] };
    }
    const unresolved = readdirSync(root)
        .filter((file) => file.endsWith('.json'))
        .map((file) => path.join(root, file))
        .filter((file) => {
            try {
                return readCheckpoint(file).status !== 'cleaned';
            } catch {
                return true;
            }
        });
    return {
        status: unresolved.length === 0 ? 'ok' : 'failed',
        name: 'unresolved_checkpoint_gate',
        message: unresolved.length === 0
            ? 'Every prior Portal smoke checkpoint is marked cleaned.'
            : 'An unresolved Portal smoke checkpoint must be cleaned before another preflight/execution.',
        details: unresolved.map(toRelative),
    };
}

function validatePackageScript(): Check {
    const packageJson = JSON.parse(readFileSync(path.join(process.cwd(), 'package.json'), 'utf8')) as {
        packageManager?: string;
        scripts?: Record<string, string>;
    };
    const expected = 'tsx scripts/launch/staging-customer-portal-smoke-runner.ts';
    const details: string[] = [];
    if (packageJson.packageManager !== 'pnpm@10.33.0') details.push('packageManager must remain pnpm@10.33.0');
    if (packageJson.scripts?.['launch:staging-customer-portal-smoke'] !== expected) {
        details.push(`launch:staging-customer-portal-smoke must equal ${expected}`);
    }
    return {
        status: details.length === 0 ? 'ok' : 'failed',
        name: 'package_script',
        message: details.length === 0 ? 'The pnpm script points only to this gated runner.' : 'Package script is missing or unsafe.',
        details,
    };
}

function validateRunnerSourcePosture(): Check {
    const source = readFileSync(path.join(process.cwd(), 'scripts/launch/staging-customer-portal-smoke-runner.ts'), 'utf8');
    const gate = source.indexOf("(mode === 'execute-approved' || mode === 'cleanup-only') && !approvalMatched");
    const preflight = source.indexOf('const preflight = await runReadOnlyPreflight', gate);
    const write = source.indexOf('const execution = await runApprovedPortalSmoke', preflight);
    const finallyCleanup = source.indexOf('} finally {', write);
    const cleanupCall = source.indexOf('await cleanupOwnedResources', finallyCleanup);
    const required = [
        'headless: false',
        "page.locator('#manage-sub-btn')",
        'billing.stripe.com',
        'PORTAL_CANCEL_ACTION_NAMES',
        'validateSafeReturnUrl',
        "trial_period_days: STAGING_PORTAL_SMOKE.trialDays",
        "missing_payment_method: 'cancel'",
        'paymentIntents.list',
        'charges.list',
        'readEmailBudget',
        'screenshotsStored: false',
        'portalUrlStored: false',
    ];
    const missing = required.filter((snippet) => !source.includes(snippet));
    const forbiddenCalls = [
        /stripe\.testHelpers/gu,
        /resend\.(?:emails\.)?send/giu,
        /\/api\/stripe-webhook/gu,
        /screenshots?\s*\(/giu,
        /page\.screenshot/gu,
        /stripe\.checkout\.sessions\.create/gu,
    ].filter((pattern) => pattern.test(source));
    const ordered = gate >= 0 && preflight > gate && write > preflight && finallyCleanup > write && cleanupCall > finallyCleanup;
    return {
        status: ordered && missing.length === 0 && forbiddenCalls.length === 0 ? 'ok' : 'failed',
        name: 'runner_source_posture',
        message: ordered && missing.length === 0 && forbiddenCalls.length === 0
            ? 'Source gates writes after approval/preflight, drives real headed UI, proves zero-money/email state and always enters exact cleanup.'
            : 'Runner source is missing safety sequencing or contains a forbidden synthetic/email/Checkout/screenshot call.',
        details: [
            ...(ordered ? [] : ['approval/preflight/write/finally-cleanup order is invalid']),
            ...missing.map((snippet) => `missing=${snippet}`),
            ...forbiddenCalls.map((pattern) => `forbidden=${String(pattern)}`),
        ],
    };
}

function validateGeneratedArtifacts(): Check {
    const combined = [artifacts.executionPlan, artifacts.approvalGate, artifacts.cleanupRunbook, artifacts.manifest]
        .filter(existsSync)
        .map((file) => readFileSync(file, 'utf8'))
        .join('\n');
    const required = [
        STAGING_PORTAL_SMOKE.webOrigin,
        STAGING_PORTAL_SMOKE.supabaseProjectRef,
        STAGING_PORTAL_SMOKE.stripeAccountId,
        STAGING_PORTAL_SMOKE_APPROVAL_ENV,
        '--execute-approved',
        '--cleanup-only',
        'checkout=false',
        'no screenshots',
        'Portal session URL',
    ];
    const missing = required.filter((snippet) => !combined.includes(snippet));
    const unsafe = [
        /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/iu,
        /\b(?:sk|pk)_(?:test|live)_[A-Za-z0-9_]+\b/u,
        /https:\/\/billing\.stripe\.com\/p\/session\//iu,
        /TEST_STUDENT_PASSWORD\s*[:=]\s*[^<\s]/iu,
    ].filter((pattern) => pattern.test(combined));
    return {
        status: missing.length === 0 && unsafe.length === 0 ? 'ok' : 'failed',
        name: 'generated_artifacts_redacted',
        message: missing.length === 0 && unsafe.length === 0
            ? 'Generated artifacts preserve exact scope/recovery and contain no email, credential, key or Portal session URL.'
            : 'Generated artifacts are incomplete or contain sensitive material.',
        details: [
            ...missing.map((snippet) => `missing=${snippet}`),
            ...unsafe.map((pattern) => `unsafe=${String(pattern)}`),
        ],
    };
}

function writeLocalArtifacts(report: RunnerReport): void {
    writeFileSync(artifacts.executionPlan, renderExecutionPlan(report), 'utf8');
    writeFileSync(artifacts.approvalGate, renderApprovalGate(report), 'utf8');
    writeFileSync(artifacts.cleanupRunbook, renderCleanupRunbook(report), 'utf8');
    writeFileSync(artifacts.manifest, renderManifest(report), 'utf8');
    writeFileSync(artifacts.summaryJson, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    writeFileSync(artifacts.summaryMarkdown, renderSummary(report), 'utf8');
}

function renderExecutionPlan(report: RunnerReport): string {
    return `${[
        '# Staging Stripe Customer Portal smoke execution plan',
        '',
        `- Exact web origin: ${STAGING_PORTAL_SMOKE.webOrigin}.`,
        `- Exact Supabase staging ref: ${STAGING_PORTAL_SMOKE.supabaseProjectRef}.`,
        `- Exact Stripe test account: ${STAGING_PORTAL_SMOKE.stripeAccountId}.`,
        '- Portal configuration, Stripe/Supabase credentials and TEST_STUDENT_* come only from `.env.staging`; values are never copied to evidence.',
        `- Current mode: ${report.mode}.`,
        `- External write performed: ${String(report.externalWritePerformed)}.`,
        '',
        '## Fixed sequence',
        '',
        '1. Validate local target/key mode and checkout=false.',
        '2. Read-only: verify `/health`, signed runtime attestation and exact `403 Checkout is disabled` probe.',
        '3. Read-only: verify Stripe account, Portal configuration, Standard one-month offer, existing Auth student and no active local subscription.',
        '4. After exact approval only: create one owned test Customer and one 14-day trialing Subscription with no payment method.',
        '5. Verify zero PaymentIntents, zero charges and zero-value trial invoice; temporarily link only the private billing fields and one local subscription row.',
        '6. Launch headed Playwright, log in with TEST_STUDENT_*, click the real dashboard `#manage-sub-btn`, cancel renewal in the hosted ES/EN Portal and use its exact safe return link.',
        '7. Verify cancel_at_period_end or exact trial/period-end cancel_at, zero money state and zero Resend budget delta.',
        '8. Always close the browser and enter exact cleanup; no screenshots, trace, video or Portal session URL are stored.',
        '',
        '## Commands for a future approved window',
        '',
        '```powershell',
        'pnpm launch:staging-customer-portal-smoke -- --preflight-readonly',
        `$env:${STAGING_PORTAL_SMOKE_APPROVAL_ENV}='${STAGING_PORTAL_SMOKE_APPROVAL.replace(/'/gu, "''")}'`,
        'pnpm launch:staging-customer-portal-smoke -- --execute-approved',
        '```',
        '',
        'Default invocation is plan-only and performs no external reads or writes.',
        '',
    ].join('\n')}\n`;
}

function renderApprovalGate(report: RunnerReport): string {
    return `${[
        '# Staging Stripe Customer Portal smoke approval gate',
        '',
        'This file is not approval. It records the exact value required for write-capable execution or checkpoint cleanup.',
        '',
        `- Required environment variable: \`${STAGING_PORTAL_SMOKE_APPROVAL_ENV}\`.`,
        '- Required execution flag: `--execute-approved`.',
        '- Cleanup recovery flag: `--cleanup-only --checkpoint=outputs/launch-staging-customer-portal-smoke/checkpoints/<run>.json`.',
        `- Approval matched in this run: ${String(report.approvalMatched)}.`,
        '',
        '## Exact sentence',
        '',
        STAGING_PORTAL_SMOKE_APPROVAL,
        '',
        'No Stripe live, production, Checkout, synthetic webhook, Resend/email, Cloudflare, deploy, DNS or domain action is permitted.',
        '',
    ].join('\n')}\n`;
}

function renderCleanupRunbook(report: RunnerReport): string {
    return `${[
        '# Staging Customer Portal smoke cleanup and recovery',
        '',
        `- Cleanup attempted in this run: ${String(report.cleanupAttempted)}.`,
        `- Cleanup verified in this run: ${String(report.cleanupVerified)}.`,
        `- Checkpoint: ${report.resources.checkpointPath ?? 'none (plan/preflight created no resources)'}.`,
        '',
        'Normal failures enter cleanup through `finally`. The checkpoint is written atomically before the first provider write and after every resource transition.',
        '',
        'Cleanup is ownership-gated by test mode, exact source marker and random run ID. It removes the temporary user metadata, deletes the exact local subscription, restores only the three original private billing fields, cancels the Stripe Subscription, deletes the Customer, removes exact processed webhook rows, and verifies no payment/session/job rows exist.',
        '',
        'Stripe Event objects and canceled Subscription history are provider audit objects and cannot be physically deleted; cleanup verifies the Subscription is canceled and Customer is deleted. No live object can match the ownership gate.',
        '',
        'After a hard process/OS interruption, rerun only the checkpoint cleanup with the same exact approval:',
        '',
        '```powershell',
        `$env:${STAGING_PORTAL_SMOKE_APPROVAL_ENV}='<exact sentence from approval-gate.md>'`,
        'pnpm launch:staging-customer-portal-smoke -- --cleanup-only --checkpoint=outputs/launch-staging-customer-portal-smoke/checkpoints/<run>.json',
        '```',
        '',
        'A new smoke is blocked while any checkpoint remains unresolved.',
        '',
    ].join('\n')}\n`;
}

function renderManifest(report: RunnerReport): string {
    return `${JSON.stringify({
        schemaVersion: report.schemaVersion,
        generatedAt: report.endedAt,
        mode: report.mode,
        target: report.target,
        language: report.language,
        approvalEnv: STAGING_PORTAL_SMOKE_APPROVAL_ENV,
        approvalMatched: report.approvalMatched,
        externalReadPerformed: report.externalReadPerformed,
        externalWriteAttempted: report.externalWriteAttempted,
        externalWritePerformed: report.externalWritePerformed,
        cleanupAttempted: report.cleanupAttempted,
        cleanupVerified: report.cleanupVerified,
        testStudentFingerprint: report.testStudentFingerprint,
        resourceFingerprints: report.resources,
        browserEvidence: {
            headed: true,
            selectors: 'semantic ES/EN with stable application button ID',
            screenshots: 'disabled',
            trace: 'disabled',
            video: 'disabled',
            portalSessionUrl: 'never persisted',
        },
        forbidden: [
            'Stripe live or production',
            'Checkout session creation',
            'synthetic webhooks',
            'Resend or other email calls',
            'payments or payment methods',
            'Cloudflare/deploy/DNS/domain changes',
        ],
        artifacts: Object.fromEntries(Object.entries(report.artifacts).map(([key, value]) => [key, toRelative(value)])),
    }, null, 2)}\n`;
}

function renderSummary(report: RunnerReport): string {
    return `${[
        '# Staging Stripe Customer Portal smoke runner summary',
        '',
        `- Status: ${report.status}.`,
        `- Closure: ${report.closureStatus}.`,
        `- Mode: ${report.mode}.`,
        `- External read performed: ${String(report.externalReadPerformed)}.`,
        `- External write attempted: ${String(report.externalWriteAttempted)}.`,
        `- External write performed: ${String(report.externalWritePerformed)}.`,
        `- Cleanup attempted: ${String(report.cleanupAttempted)}.`,
        `- Cleanup verified: ${String(report.cleanupVerified)}.`,
        `- Test student fingerprint: ${report.testStudentFingerprint ?? 'absent'}.`,
        '- Stored email/password/key/Portal URL/screenshots: none.',
        '',
        '| Status | Check | Message | Details |',
        '| --- | --- | --- | --- |',
        ...report.checks.map((check) => `| ${check.status} | ${check.name} | ${escapeCell(check.message)} | ${escapeCell(check.details.join(' / ') || '-')} |`),
        '',
    ].join('\n')}\n`;
}

function setResourceFingerprints(checkpoint: CleanupCheckpoint): void {
    resources.runFingerprint = fingerprintPortalSmokeValue(checkpoint.runId);
    resources.customerFingerprint = fingerprintPortalSmokeValue(checkpoint.stripeCustomerId);
    resources.subscriptionFingerprint = fingerprintPortalSmokeValue(checkpoint.stripeSubscriptionId);
    resources.localSubscriptionFingerprint = fingerprintPortalSmokeValue(checkpoint.localSubscriptionId);
}

function requiredEnv(env: Record<string, string | undefined>, key: string): string {
    const value = env[key]?.trim();
    if (!value) throw new Error(`Missing required staging key ${key}`);
    return value;
}

async function readJsonRecord(response: Response, label: string): Promise<Record<string, unknown>> {
    const text = await response.text();
    try {
        const value = JSON.parse(text) as unknown;
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('not an object');
        return value as Record<string, unknown>;
    } catch {
        throw new Error(`${label} did not return a JSON object`);
    }
}

function stripeObjectId(value: string | { id: string } | null | undefined): string | null {
    if (!value) return null;
    return typeof value === 'string' ? value : value.id;
}

function stripeErrorCode(error: unknown): string | null {
    return error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
        ? error.code
        : null;
}

function safeError(error: unknown): string {
    return sanitizePortalSmokeText(error instanceof Error ? error.message : error).replace(/\r?\n/gu, ' ').slice(0, 500);
}

function failedCheck(name: string, message: string, error: unknown): Check {
    return { status: 'failed', name, message, details: [`error=${safeError(error)}`] };
}

function statusFor(checkList: Check[]): ReportStatus {
    if (checkList.some((check) => check.status === 'failed')) return 'FAILED';
    if (checkList.some((check) => check.status === 'warning')) return 'WARNING';
    return 'OK';
}

function isoDate(unixSeconds: number): string {
    return new Date(unixSeconds * 1000).toISOString().slice(0, 10);
}

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function stamp(date: Date): string {
    return date.toISOString().replace(/[:.]/gu, '-');
}

function toRelative(filePath: string): string {
    return path.relative(process.cwd(), filePath).split(path.sep).join('/');
}

function escapeCell(value: string): string {
    return value.replace(/\|/gu, '\\|').replace(/\r?\n/gu, ' ');
}
