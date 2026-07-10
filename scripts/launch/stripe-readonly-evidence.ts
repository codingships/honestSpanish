import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import Stripe from 'stripe';
import {
    calculatePackageTotalCents,
    isPackageCheckoutReady,
    type PackageCatalogSnapshot,
} from '../../src/lib/package-pricing';
import { REQUIRED_STRIPE_WEBHOOK_EVENTS } from '../../src/lib/stripe-webhook-events';
import type { Database } from '../../src/types/database.types';

type Status = 'ok' | 'warning' | 'failed';

interface Check {
    status: Status;
    name: string;
    message: string;
    details?: string[];
}

interface Report {
    schemaVersion: 1;
    startedAt: string;
    endedAt: string;
    status: 'OK' | 'WARNING' | 'FAILED';
    outputDir: string;
    targetEnvironment: 'staging' | 'production';
    supabaseProjectRef: string;
    stripeMode: 'test' | 'live' | 'unknown';
    checks: Check[];
}

type PackageRow = Pick<
    Database['public']['Tables']['packages']['Row'],
    'id' | 'catalog_version' | 'name' | 'price_monthly' | 'sessions_per_month' | 'has_group_session' | 'has_dual_teacher' | 'is_active' | 'stripe_product_id' | 'stripe_price_1m' | 'stripe_price_3m' | 'stripe_price_6m'
>;

type DurationMonths = 1 | 3 | 6;

const targetEnvironment = readTargetEnvironment();
dotenv.config({ path: '.env', override: true, quiet: true });
if (targetEnvironment === 'staging') {
    dotenv.config({ path: '.env.staging', override: true, quiet: true });
}

const startedAt = new Date();
const outputDir = path.join(process.cwd(), 'outputs', 'launch-stripe-readonly-evidence', stamp(startedAt));
mkdirSync(outputDir, { recursive: true });

const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
const stripePublishableKey = process.env.PUBLIC_STRIPE_PUBLISHABLE_KEY;
const stripeWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
const stripeExpectedAccountId = process.env.STRIPE_EXPECTED_ACCOUNT_ID;
const stripePortalConfigurationId = process.env.STRIPE_PORTAL_CONFIGURATION_ID;
const supabaseUrl = process.env.PUBLIC_SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseProjectRef = projectRefFromSupabaseUrl(supabaseUrl);
const expectedSupabaseProjectRef = process.env.SUPABASE_EXPECTED_PROJECT_REF;
const expectedWebhookHosts = expectedStripeWebhookHosts();
const requiredWebhookEvents = REQUIRED_STRIPE_WEBHOOK_EVENTS;
const expectedPackageKeys = ['group', 'standard', 'hybrid', 'bootcamp'] as const;

const checks: Check[] = [];
const stripeMode = modeFromKey(stripeSecretKey);

checks.push(checkEnvironment());

if (stripeSecretKey && supabaseUrl && supabaseServiceRoleKey) {
    const stripe = new Stripe(stripeSecretKey, {
        apiVersion: '2026-02-25.clover',
    });
    const supabase = createClient<Database>(supabaseUrl, supabaseServiceRoleKey, {
        auth: { autoRefreshToken: false, persistSession: false },
    });

    checks.push(await checkStripeAccount(stripe));
    checks.push(await checkStripePortalConfiguration(stripe));
    checks.push(await checkStripeWebhookEndpoints(stripe));
    checks.push(await checkSupabasePackageStripeLinks(stripe, supabase));
}

const failed = checks.filter((check) => check.status === 'failed');
const warnings = checks.filter((check) => check.status === 'warning');
const status: Report['status'] = failed.length > 0 ? 'FAILED' : warnings.length > 0 ? 'WARNING' : 'OK';

const report: Report = {
    schemaVersion: 1,
    startedAt: startedAt.toISOString(),
    endedAt: new Date().toISOString(),
    status,
    outputDir,
    targetEnvironment,
    supabaseProjectRef,
    stripeMode,
    checks,
};

writeFileSync(path.join(outputDir, 'summary.json'), JSON.stringify(report, null, 2), 'utf8');
writeFileSync(path.join(outputDir, 'summary.md'), renderMarkdown(report), 'utf8');

console.log(`[launch:stripe-readonly] Status: ${status}`);
console.log(`[launch:stripe-readonly] Failed: ${failed.length}`);
console.log(`[launch:stripe-readonly] Warnings: ${warnings.length}`);
console.log(`[launch:stripe-readonly] Stripe mode: ${stripeMode}`);
console.log(`[launch:stripe-readonly] Target environment: ${targetEnvironment}`);
console.log(`[launch:stripe-readonly] Supabase project ref: ${supabaseProjectRef}`);
console.log(`[launch:stripe-readonly] Summary: ${path.join(outputDir, 'summary.md')}`);

if (failed.length > 0) process.exit(1);

function checkEnvironment(): Check {
    const missing = [
        ['STRIPE_SECRET_KEY', stripeSecretKey],
        ['PUBLIC_STRIPE_PUBLISHABLE_KEY', stripePublishableKey],
        ['STRIPE_WEBHOOK_SECRET', stripeWebhookSecret],
        ['STRIPE_EXPECTED_ACCOUNT_ID', stripeExpectedAccountId],
        ['STRIPE_PORTAL_CONFIGURATION_ID', stripePortalConfigurationId],
        ['PUBLIC_SUPABASE_URL', supabaseUrl],
        ['SUPABASE_SERVICE_ROLE_KEY', supabaseServiceRoleKey],
        ['SUPABASE_EXPECTED_PROJECT_REF', expectedSupabaseProjectRef],
    ].filter(([, value]) => !value).map(([key]) => key);

    const publishableMode = modeFromKey(stripePublishableKey);
    const webhookSecretShape = stripeWebhookSecret?.startsWith('whsec_') ? 'present_whsec' : stripeWebhookSecret ? 'present_unrecognized' : 'missing';
    const modeMismatch = stripeMode !== 'unknown'
        && publishableMode !== 'unknown'
        && stripeMode !== publishableMode;
    const expectedSupabaseRef = targetEnvironment === 'staging'
        ? 'mzjyvmlxfpzdfdjzxxyj'
        : 'vkkahxsybhbutszerawz';
    const projectMismatch = supabaseProjectRef !== expectedSupabaseRef;
    const expectedRefMismatch = expectedSupabaseProjectRef !== expectedSupabaseRef;
    const expectedMode = targetEnvironment === 'production' ? 'live' : 'test';
    const targetModeMismatch = stripeMode !== expectedMode || publishableMode !== expectedMode;

    return {
        status: missing.length > 0 || modeMismatch || projectMismatch || expectedRefMismatch || targetModeMismatch ? 'failed' : 'ok',
        name: 'environment_shape',
        message: missing.length === 0
            && !modeMismatch
            && !projectMismatch
            && !expectedRefMismatch
            && !targetModeMismatch
            ? 'Stripe and Supabase environment variables are present with matching test/live key modes and a webhook-secret-shaped value.'
            : 'Stripe/Supabase environment shape is incomplete or inconsistent.',
        details: [
            `missing=${missing.length === 0 ? 'none' : missing.join(', ')}`,
            `secret_key_mode=${stripeMode}`,
            `publishable_key_mode=${publishableMode}`,
            `webhook_secret=${webhookSecretShape}`,
            `target_environment=${targetEnvironment}`,
            `supabase_project_ref=${supabaseProjectRef}`,
            `expected_supabase_project_ref=${expectedSupabaseRef}`,
            `configured_expected_project_ref=${expectedSupabaseProjectRef ?? 'missing'}`,
            `expected_stripe_mode=${expectedMode}`,
            ...(modeMismatch ? ['mode_mismatch=secret key and publishable key differ'] : []),
            ...(projectMismatch ? ['project_mismatch=Supabase target does not match requested environment'] : []),
            ...(expectedRefMismatch ? ['expected_ref_mismatch=SUPABASE_EXPECTED_PROJECT_REF is wrong'] : []),
            ...(targetModeMismatch ? ['target_mode_mismatch=Stripe keys do not match requested environment'] : []),
        ],
    };
}

async function checkStripeAccount(stripe: Stripe): Promise<Check> {
    try {
        const account = await stripe.accounts.retrieve();
        const liveActivationIncomplete = !account.charges_enabled || !account.payouts_enabled || !account.details_submitted;
        const accountMismatch = account.id !== stripeExpectedAccountId;
        const countryMismatch = account.country?.toUpperCase() !== 'ES';
        const currencyMismatch = account.default_currency?.toLowerCase() !== 'eur';
        const productionNotReady = targetEnvironment === 'production' && liveActivationIncomplete;
        return {
            status: accountMismatch || countryMismatch || currencyMismatch || productionNotReady
                ? 'failed'
                : liveActivationIncomplete
                    ? 'warning'
                    : 'ok',
            name: 'stripe_account_readonly',
            message: liveActivationIncomplete
                ? 'Stripe account is reachable, but merchant activation for real charges/payouts is incomplete.'
                : 'Stripe account is reachable and reports charges, payouts and submitted business details enabled.',
            details: [
                `account=${compactId(account.id)}`,
                `expected_account=${compactId(stripeExpectedAccountId)}`,
                `account_match=${!accountMismatch}`,
                `charges_enabled=${Boolean(account.charges_enabled)}`,
                `payouts_enabled=${Boolean(account.payouts_enabled)}`,
                `country=${account.country ?? 'unknown'}`,
                `default_currency=${account.default_currency ?? 'unknown'}`,
                `details_submitted=${Boolean(account.details_submitted)}`,
                `business_type=${account.business_type ?? 'unknown'}`,
                `capability_count=${Object.keys(account.capabilities ?? {}).length}`,
                `spain_country_match=${!countryMismatch}`,
                `eur_default_currency_match=${!currencyMismatch}`,
            ],
        };
    } catch (error) {
        return {
            status: 'failed',
            name: 'stripe_account_readonly',
            message: 'Stripe account could not be read with the configured key.',
            details: [errorMessage(error)],
        };
    }
}

async function checkStripeWebhookEndpoints(stripe: Stripe): Promise<Check> {
    try {
        const endpoints = await stripe.webhookEndpoints.list({ limit: 100 });
        const enabled = endpoints.data.filter((endpoint) => endpoint.status === 'enabled');
        const endpointHosts = enabled.map((endpoint) => safeEndpointHost(endpoint.url));
        const unexpectedHosts = [...new Set(endpointHosts.filter((host) => !isExpectedWebhookHost(host)))].sort();
        const matchingHosts = [...new Set(endpointHosts.filter((host) => isExpectedWebhookHost(host)))].sort();
        const matchingEndpointUrls = enabled.filter((endpoint) => isExpectedWebhookUrl(endpoint.url));
        const unexpectedEndpointUrls = enabled.filter((endpoint) => !isExpectedWebhookUrl(endpoint.url));
        const hostReviewProblems = enabled.length > 0
            && (matchingEndpointUrls.length !== 1 || unexpectedEndpointUrls.length > 0);
        const endpointWithRequiredEvents = enabled.find((endpoint) => (
            requiredWebhookEvents.every((event) => endpoint.enabled_events.includes(event))
        ));
        const endpointWithExactEvents = enabled.find((endpoint) => (
            isExpectedWebhookUrl(endpoint.url)
            && endpoint.enabled_events.length === requiredWebhookEvents.length
            && requiredWebhookEvents.every((event) => endpoint.enabled_events.includes(event))
        ));
        const enabledEventUnion = new Set(enabled.flatMap((endpoint) => endpoint.enabled_events));
        const missingRequiredEvents = requiredWebhookEvents.filter((event) => !enabledEventUnion.has(event));
        const eventReviewProblems = !endpointWithExactEvents;
        const endpointCountProblem = enabled.length !== 1;
        const details = [
            `total=${endpoints.data.length}`,
            `enabled=${enabled.length}`,
            `disabled=${endpoints.data.length - enabled.length}`,
            `expected_webhook_hosts=${expectedWebhookHosts.join('|') || 'none'}`,
            `matching_enabled_webhook_hosts=${matchingHosts.join('|') || 'none'}`,
            `unexpected_enabled_webhook_hosts=${unexpectedHosts.join('|') || 'none'}`,
            `matching_enabled_webhook_urls=${matchingEndpointUrls.map((endpoint) => safeEndpointUrl(endpoint.url)).join('|') || 'none'}`,
            `unexpected_enabled_webhook_urls=${unexpectedEndpointUrls.map((endpoint) => safeEndpointUrl(endpoint.url)).join('|') || 'none'}`,
            `required_events=${requiredWebhookEvents.join('|')}`,
            `missing_required_events=${missingRequiredEvents.join('|') || 'none'}`,
            `single_endpoint_has_required_events=${Boolean(endpointWithRequiredEvents)}`,
            `single_endpoint_has_exact_events=${Boolean(endpointWithExactEvents)}`,
            `exactly_one_enabled_endpoint=${!endpointCountProblem}`,
            ...enabled.slice(0, 10).map((endpoint, index) => [
                `enabled_${index + 1}_id=${compactId(endpoint.id)}`,
                `enabled_${index + 1}_url=${safeEndpointUrl(endpoint.url)}`,
                `enabled_${index + 1}_host=${safeEndpointHost(endpoint.url)}`,
                `enabled_${index + 1}_events=${endpoint.enabled_events.slice(0, 12).join('|')}`,
            ]).flat(),
        ];

        return {
            status: !endpointCountProblem && !hostReviewProblems && !eventReviewProblems ? 'ok' : 'failed',
            name: 'stripe_webhook_endpoints_readonly',
            message: enabled.length === 0
                ? 'No enabled Stripe webhook endpoints were visible in the configured mode.'
                : endpointCountProblem || hostReviewProblems || eventReviewProblems
                    ? 'Enabled Stripe webhook endpoints are visible, but host or required-event configuration needs launch review.'
                    : 'Exactly one enabled Stripe webhook endpoint has the exact launch host and event set in the configured mode.',
            details,
        };
    } catch (error) {
        return {
            status: 'failed',
            name: 'stripe_webhook_endpoints_readonly',
            message: 'Stripe webhook endpoints could not be listed.',
            details: [errorMessage(error)],
        };
    }
}

async function checkStripePortalConfiguration(stripe: Stripe): Promise<Check> {
    if (!stripePortalConfigurationId) {
        return {
            status: 'failed',
            name: 'stripe_portal_configuration_readonly',
            message: 'STRIPE_PORTAL_CONFIGURATION_ID is missing.',
        };
    }

    try {
        const configuration = await stripe.billingPortal.configurations.retrieve(stripePortalConfigurationId);
        const safe = configuration.active
            && configuration.features.payment_method_update.enabled
            && configuration.features.invoice_history.enabled
            && configuration.features.subscription_cancel.enabled
            && configuration.features.subscription_cancel.mode === 'at_period_end'
            && !configuration.features.subscription_update.enabled;
        return {
            status: safe ? 'ok' : 'failed',
            name: 'stripe_portal_configuration_readonly',
            message: safe
                ? 'Pinned Customer Portal configuration is active and launch-safe.'
                : 'Pinned Customer Portal configuration permits an unsafe or incomplete lifecycle action.',
            details: [
                `configuration=${compactId(configuration.id)}`,
                `active=${configuration.active}`,
                `payment_method_update=${configuration.features.payment_method_update.enabled}`,
                `invoice_history=${configuration.features.invoice_history.enabled}`,
                `subscription_cancel=${configuration.features.subscription_cancel.enabled}`,
                `cancel_mode=${configuration.features.subscription_cancel.mode}`,
                `subscription_update=${configuration.features.subscription_update.enabled}`,
            ],
        };
    } catch (error) {
        return {
            status: 'failed',
            name: 'stripe_portal_configuration_readonly',
            message: 'Pinned Stripe Customer Portal configuration could not be read.',
            details: [errorMessage(error)],
        };
    }
}

async function checkSupabasePackageStripeLinks(
    stripe: Stripe,
    supabase: ReturnType<typeof createClient<Database>>,
): Promise<Check> {
    const { count: legacyStripeSubscriptionCount, error: legacySubscriptionError } = await supabase
        .from('subscriptions')
        .select('id', { count: 'exact', head: true })
        .not('stripe_subscription_id', 'is', null)
        .is('package_price_id', null);
    if (legacySubscriptionError) {
        return {
            status: 'failed',
            name: 'package_price_links_readonly',
            message: 'Could not verify legacy Stripe subscription linkage in Supabase.',
            details: [legacySubscriptionError.message],
        };
    }

    const { data, error } = await supabase
        .from('packages')
        .select('id, catalog_version, name, price_monthly, sessions_per_month, has_group_session, has_dual_teacher, is_active, stripe_product_id, stripe_price_1m, stripe_price_3m, stripe_price_6m')
        .eq('is_active', true)
        .order('price_monthly', { ascending: true });

    if (error) {
        return {
            status: 'failed',
            name: 'package_price_links_readonly',
            message: 'Could not read active package Stripe links from Supabase.',
            details: [error.message],
        };
    }

    const { data: packagePrices, error: packagePricesError } = await supabase
        .from('package_prices')
        .select('package_id, catalog_version, package_key, duration_months, amount_cents, currency, sessions_per_month, sessions_per_period, has_group_session, has_dual_teacher, status, stripe_account_id, stripe_livemode, stripe_product_id, stripe_price_id')
        .eq('status', 'active');
    if (packagePricesError) {
        return {
            status: 'failed',
            name: 'package_price_links_readonly',
            message: 'Could not read immutable package prices from Supabase.',
            details: [packagePricesError.message],
        };
    }

    const packages = (data ?? []) as PackageRow[];
    const details: string[] = [
        `active_packages=${packages.length}`,
        `active_package_prices=${packagePrices?.length ?? 0}`,
        `stripe_subscriptions_without_package_price=${legacyStripeSubscriptionCount ?? 'unknown'}`,
    ];
    const problems: string[] = [];
    if ((legacyStripeSubscriptionCount ?? 0) > 0) {
        problems.push(`${legacyStripeSubscriptionCount} Stripe subscription(s) have no immutable package_price_id`);
    }
    if ((packagePrices?.length ?? 0) !== expectedPackageKeys.length * 3) {
        problems.push(`expected exactly ${expectedPackageKeys.length * 3} active immutable offers`);
    }
    const actualPackageKeys = packages.map((pkg) => pkg.name);
    const activePackageIds = new Set(packages.map((pkg) => pkg.id));
    if ((packagePrices ?? []).some((offer) => !activePackageIds.has(offer.package_id))) {
        problems.push('active immutable offer belongs to a package outside the launch catalog');
    }
    const missingPackageKeys = expectedPackageKeys.filter((key) => !actualPackageKeys.includes(key));
    const unexpectedPackageKeys = actualPackageKeys.filter((key) => !expectedPackageKeys.includes(key as typeof expectedPackageKeys[number]));
    if (
        packages.length !== expectedPackageKeys.length
        || new Set(actualPackageKeys).size !== expectedPackageKeys.length
        || missingPackageKeys.length > 0
        || unexpectedPackageKeys.length > 0
    ) {
        problems.push(`catalog keys mismatch (missing=${missingPackageKeys.join('|') || 'none'}, unexpected=${unexpectedPackageKeys.join('|') || 'none'})`);
    }
    const durations: Array<{ months: DurationMonths; key: keyof PackageRow; discount: number }> = [
        { months: 1, key: 'stripe_price_1m', discount: 1 },
        { months: 3, key: 'stripe_price_3m', discount: 0.9 },
        { months: 6, key: 'stripe_price_6m', discount: 0.8 },
    ];

    for (const pkg of packages) {
        details.push(`package=${pkg.name}`);
        const packageContractRows = (packagePrices ?? []).filter((offer) => offer.package_id === pkg.id);
        if (!isPackageCheckoutReady({
            ...pkg,
            package_prices: packageContractRows,
        } as PackageCatalogSnapshot)) {
            problems.push(`${pkg.name}: immutable offer set is not exactly checkout-ready`);
        }

        if (pkg.stripe_product_id) {
            try {
                const product = await stripe.products.retrieve(pkg.stripe_product_id);
                const productMatches = !product.deleted
                    && product.active
                    && product.metadata.package_id === pkg.id
                    && product.metadata.package_key === pkg.name
                    && product.metadata.catalog_version === String(pkg.catalog_version)
                    && product.metadata.app_environment === targetEnvironment;
                details.push([
                    `package_${pkg.name}_product=${compactId(product.id)}`,
                    `active=${!product.deleted && product.active}`,
                    `metadata_ok=${productMatches}`,
                ].join(' '));
                if (!productMatches) {
                    problems.push(`${pkg.name}: product state or ownership metadata mismatch`);
                }
            } catch (error) {
                problems.push(`${pkg.name}: product ${compactId(pkg.stripe_product_id)} not retrievable (${errorMessage(error)})`);
            }
        } else {
            problems.push(`${pkg.name}: missing stripe_product_id`);
        }

        for (const duration of durations) {
            const priceId = pkg[duration.key];
            const expectedAmount = calculatePackageTotalCents(pkg.price_monthly, duration.months);
            const contractOffer = (packagePrices ?? []).find((offer) => (
                offer.package_id === pkg.id
                && offer.catalog_version === pkg.catalog_version
                && offer.duration_months === duration.months
                && offer.status === 'active'
            ));
            if (!priceId) {
                problems.push(`${pkg.name}/${duration.months}m: missing price id`);
                continue;
            }
            if (
                !contractOffer
                || contractOffer.stripe_price_id !== priceId
                || contractOffer.stripe_product_id !== pkg.stripe_product_id
                || contractOffer.stripe_account_id !== stripeExpectedAccountId
                || contractOffer.stripe_livemode !== (stripeMode === 'live')
                || contractOffer.amount_cents !== expectedAmount
                || contractOffer.currency !== 'eur'
            ) {
                problems.push(`${pkg.name}/${duration.months}m: immutable package price mismatch`);
                continue;
            }

            try {
                const price = await stripe.prices.retrieve(String(priceId));
                const actualProductId = typeof price.product === 'string' ? price.product : price.product.id;
                const matches = price.active
                    && actualProductId === pkg.stripe_product_id
                    && price.currency === 'eur'
                    && price.unit_amount === expectedAmount
                    && price.recurring?.interval === 'month'
                    && price.recurring.interval_count === duration.months
                    && modeFromLivemode(price.livemode) === stripeMode
                    && price.metadata.package_id === pkg.id
                    && price.metadata.package_key === pkg.name
                    && price.metadata.catalog_version === String(pkg.catalog_version)
                    && price.metadata.duration_months === String(duration.months)
                    && price.metadata.app_environment === targetEnvironment;
                details.push([
                    `package_${pkg.name}_${duration.months}m=${compactId(price.id)}`,
                    `active=${price.active}`,
                    `currency=${price.currency}`,
                    `amount_ok=${price.unit_amount === expectedAmount}`,
                    `product_ok=${actualProductId === pkg.stripe_product_id}`,
                    `metadata_ok=${matches}`,
                    `recurring=${price.recurring?.interval ?? 'none'}:${price.recurring?.interval_count ?? 'none'}`,
                    `mode=${modeFromLivemode(price.livemode)}`,
                ].join(' '));
                if (!matches) {
                    problems.push(`${pkg.name}/${duration.months}m: price shape mismatch`);
                }
            } catch (error) {
                problems.push(`${pkg.name}/${duration.months}m: price ${compactId(String(priceId))} not retrievable (${errorMessage(error)})`);
            }
        }
    }

    return {
        status: packages.length === 0 || problems.length > 0 ? 'failed' : 'ok',
        name: 'package_price_links_readonly',
        message: problems.length === 0 && packages.length > 0
            ? 'Active Supabase packages have retrievable Stripe product and recurring EUR price links in the configured mode.'
            : 'One or more active package Stripe links need review before final payment closure.',
        details: [
            ...details,
            ...(problems.length > 0 ? [`problems=${problems.join(' / ')}`] : []),
        ],
    };
}

function modeFromKey(key: string | undefined): Report['stripeMode'] {
    if (!key) return 'unknown';
    if (key.startsWith('sk_test_') || key.startsWith('pk_test_')) return 'test';
    if (key.startsWith('sk_live_') || key.startsWith('pk_live_')) return 'live';
    return 'unknown';
}

function readTargetEnvironment(): Report['targetEnvironment'] {
    const index = process.argv.indexOf('--environment');
    const value = index >= 0 ? process.argv[index + 1] : 'production';
    if (value !== 'staging' && value !== 'production') {
        throw new Error('Use --environment staging or --environment production.');
    }
    return value;
}

function projectRefFromSupabaseUrl(value: string | undefined): string {
    if (!value) return 'missing';
    try {
        const hostname = new URL(value).hostname;
        return hostname.split('.')[0] || 'unknown';
    } catch {
        return 'unparseable';
    }
}

function modeFromLivemode(livemode: boolean): Report['stripeMode'] {
    return livemode ? 'live' : 'test';
}

function compactId(id: string | null | undefined): string {
    if (!id) return 'missing';
    if (id.length <= 12) return id;
    return `${id.slice(0, 8)}...${id.slice(-6)}`;
}

function safeEndpointUrl(value: string | null | undefined): string {
    if (!value) return 'missing';
    try {
        const url = new URL(value);
        return `${url.protocol}//${url.host}${url.pathname}`;
    } catch {
        return 'unparseable';
    }
}

function safeEndpointHost(value: string | null | undefined): string {
    if (!value) return 'missing';
    try {
        return new URL(value).hostname.toLowerCase();
    } catch {
        return 'unparseable';
    }
}

function expectedStripeWebhookHosts(): string[] {
    const explicit = process.env.STRIPE_EXPECTED_WEBHOOK_HOSTS;
    const raw = explicit
        ? explicit.split(',')
        : targetEnvironment === 'staging'
            ? ['espanolhonesto-staging.alindev95.workers.dev']
            : ['espanolhonesto.com'];
    return [...new Set(raw.map(normalizeHost).filter(Boolean))].sort();
}

function normalizeHost(value: string): string {
    const trimmed = value.trim().toLowerCase();
    if (!trimmed) return '';
    try {
        return new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`).hostname;
    } catch {
        return trimmed.replace(/^https?:\/\//, '').split('/')[0];
    }
}

function isExpectedWebhookHost(host: string): boolean {
    if (!host || host === 'missing' || host === 'unparseable') return false;
    return expectedWebhookHosts.some((expectedHost) => {
        if (expectedHost === host) return true;
        if (expectedHost.startsWith('*.')) {
            const suffix = expectedHost.slice(1);
            return host.endsWith(suffix) && host.length > suffix.length;
        }
        return false;
    });
}

function isExpectedWebhookUrl(value: string | null | undefined): boolean {
    if (!value) return false;
    try {
        const url = new URL(value);
        return url.protocol === 'https:'
            && !url.port
            && !url.username
            && !url.password
            && !url.search
            && !url.hash
            && url.pathname === '/api/stripe-webhook'
            && isExpectedWebhookHost(url.hostname.toLowerCase());
    } catch {
        return false;
    }
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function renderMarkdown(report: Report): string {
    const lines = [
        '# Stripe Read-Only Evidence',
        '',
        `- Status: ${report.status}`,
        `- Started: ${report.startedAt}`,
        `- Ended: ${report.endedAt}`,
        `- Target environment: ${report.targetEnvironment}`,
        `- Supabase project ref: ${report.supabaseProjectRef}`,
        `- Stripe mode: ${report.stripeMode}`,
        `- Output: ${report.outputDir}`,
        '',
        '## Scope',
        '',
        'This check is read-only. It retrieves Stripe account metadata, webhook endpoint metadata, and active Supabase package Stripe links. It does not create products, create prices, update Stripe, update Supabase, trigger checkout, send webhooks, retrieve secrets, or store secret values.',
        '',
        '## Checks',
        '',
        '| Status | Check | Message | Details |',
        '| --- | --- | --- | --- |',
    ];

    for (const check of report.checks) {
        lines.push(`| ${check.status} | ${check.name} | ${escapeCell(check.message)} | ${escapeCell((check.details ?? []).join(' / '))} |`);
    }

    lines.push('');
    lines.push('## Final Closure Note');
    lines.push('');
    lines.push('This evidence supports payment/integration readiness only. It does not replace final checkout, webhook delivery, dashboard review, reconciliation, legal approval, or final smoke evidence.');
    lines.push('');

    return `${lines.join('\n')}\n`;
}

function escapeCell(value: string): string {
    return value.replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
}

function stamp(date: Date): string {
    return date.toISOString().replaceAll(':', '-').replaceAll('.', '-');
}
