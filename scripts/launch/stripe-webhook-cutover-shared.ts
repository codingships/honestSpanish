import { createHash } from 'node:crypto';

export type StripeEvidenceCheckStatus = 'ok' | 'warning' | 'failed';

export interface StripeEvidenceCheckLike {
    status?: string;
    name?: string;
    message?: string;
    details?: string[];
}

export interface StripeReadonlySummaryLike {
    status?: string;
    stripeMode?: string;
    checks?: StripeEvidenceCheckLike[];
}

export interface StripeWebhookCutoverPackSummaryLike {
    schemaVersion?: number;
    status?: string;
    stripeCutoverStatus?: string;
    latestStripeReadonlySummary?: string | null;
    checks?: StripeEvidenceCheckLike[];
}

export type StripeWebhookCutoverEvidenceState =
    | 'HOST_ONLY_DRIFT'
    | 'ALREADY_ON_EXPECTED_HOST'
    | 'BLOCKED';

export interface StripeWebhookCutoverEvidenceClassification {
    state: StripeWebhookCutoverEvidenceState;
    reasons: string[];
    currentHosts: string[];
    expectedHosts: string[];
    currentUrl: string | null;
    accountIdSha256: string | null;
    endpointIdSha256: string | null;
    requiredEvents: string[];
    enabledEvents: string[];
}

export interface PreExecutionGateResult {
    acceptable: boolean;
    blockingChecks: string[];
}

export interface StripeWebhookApprovalFacts {
    accountIdSha256: string;
    endpointIdSha256: string;
    currentUrl: string;
    targetUrl: string;
    enabledEvents: string[];
}

const webhookCheckName = 'stripe_webhook_endpoints_readonly';
const webhookPath = '/api/stripe-webhook';

export function classifyStripeWebhookCutoverEvidence(
    summary: StripeReadonlySummaryLike | null,
): StripeWebhookCutoverEvidenceClassification {
    if (!summary) return blocked(['stripe_readonly_summary_missing_or_invalid']);

    const checks = Array.isArray(summary.checks) ? summary.checks : [];
    const webhookChecks = checks.filter((check) => check.name === webhookCheckName);
    const webhookCheck = webhookChecks[0];
    const accountChecks = checks.filter((check) => check.name === 'stripe_account_readonly');
    const accountCheck = accountChecks[0];
    const reasons: string[] = [];

    if (summary.stripeMode !== 'test') reasons.push(`stripe_mode=${summary.stripeMode ?? 'unknown'}`);
    if (webhookChecks.length !== 1 || !webhookCheck) {
        reasons.push(`webhook_check_count=${webhookChecks.length}`);
        return blocked(reasons);
    }
    if (accountChecks.length !== 1 || !accountCheck) reasons.push(`stripe_account_check_count=${accountChecks.length}`);

    const failedChecks = checks.filter((check) => check.status === 'failed');
    const otherFailedChecks = failedChecks.filter((check) => check.name !== webhookCheckName);
    reasons.push(...otherFailedChecks.map((check) => `blocking_check=${check.name ?? 'unnamed'}`));

    const details = webhookCheck.details;
    const enabledCount = detailInteger(details, 'enabled');
    const exactlyOneEnabled = detailValue(details, 'exactly_one_enabled_endpoint') === 'true';
    const expectedHosts = detailList(details, 'expected_webhook_hosts');
    const matchingHosts = detailList(details, 'matching_enabled_webhook_hosts');
    const unexpectedHosts = detailList(details, 'unexpected_enabled_webhook_hosts');
    const matchingUrls = detailList(details, 'matching_enabled_webhook_urls');
    const unexpectedUrls = detailList(details, 'unexpected_enabled_webhook_urls');
    const currentUrl = nullableDetail(details, 'enabled_1_url');
    const currentHost = nullableDetail(details, 'enabled_1_host');
    const endpointIdSha256 = nullableDetail(details, 'enabled_1_id_sha256');
    const accountIdSha256 = nullableDetail(accountCheck?.details, 'account_id_sha256');
    const requiredEvents = detailList(details, 'required_events');
    const enabledEvents = detailList(details, 'enabled_1_events');
    const missingRequiredEvents = detailList(details, 'missing_required_events');
    const endpointHasRequiredEvents = detailValue(details, 'single_endpoint_has_required_events') === 'true';
    const endpointHasExactEventsAndExpectedUrl = detailValue(details, 'single_endpoint_has_exact_events') === 'true';
    const exactEventSet = sameStringSet(requiredEvents, enabledEvents);

    if (enabledCount !== 1 || !exactlyOneEnabled) reasons.push('enabled_endpoint_count_must_equal_one');
    if (expectedHosts.length === 0) reasons.push('expected_webhook_hosts_missing');
    if (requiredEvents.length === 0 || !exactEventSet || missingRequiredEvents.length > 0 || !endpointHasRequiredEvents) {
        reasons.push('enabled_event_set_must_exactly_match_required_events');
    }
    if (!currentUrl || !isStrictWebhookUrl(currentUrl)) reasons.push('current_webhook_url_shape_invalid');
    if (!currentHost || !currentUrl || safeHostname(currentUrl) !== currentHost) reasons.push('current_webhook_host_mismatch');
    if (!accountIdSha256 || !isSha256(accountIdSha256)) reasons.push('account_id_sha256_missing_or_invalid');
    if (detailValue(accountCheck?.details, 'account_match') !== 'true') reasons.push('stripe_account_match_not_proven');
    if (!endpointIdSha256 || !isSha256(endpointIdSha256)) reasons.push('endpoint_id_sha256_missing_or_invalid');

    const base = {
        currentHosts: unique([...unexpectedHosts, ...matchingHosts]),
        expectedHosts,
        currentUrl,
        accountIdSha256,
        endpointIdSha256,
        requiredEvents,
        enabledEvents,
    };

    const hostOnlyDrift = summary.status === 'FAILED'
        && webhookCheck.status === 'failed'
        && failedChecks.length === 1
        && failedChecks[0]?.name === webhookCheckName
        && matchingHosts.length === 0
        && matchingUrls.length === 0
        && unexpectedHosts.length === 1
        && unexpectedUrls.length === 1
        && unexpectedUrls[0] === currentUrl
        && unexpectedHosts[0] === currentHost
        && !expectedHosts.includes(currentHost ?? '')
        && !endpointHasExactEventsAndExpectedUrl;

    if (reasons.length === 0 && hostOnlyDrift) {
        return { state: 'HOST_ONLY_DRIFT', reasons: [], ...base };
    }

    const alreadyOnExpectedHost = (summary.status === 'OK' || summary.status === 'WARNING')
        && webhookCheck.status === 'ok'
        && failedChecks.length === 0
        && matchingHosts.length === 1
        && matchingUrls.length === 1
        && unexpectedHosts.length === 0
        && unexpectedUrls.length === 0
        && matchingUrls[0] === currentUrl
        && matchingHosts[0] === currentHost
        && expectedHosts.includes(currentHost ?? '')
        && endpointHasExactEventsAndExpectedUrl;

    if (reasons.length === 0 && alreadyOnExpectedHost) {
        return { state: 'ALREADY_ON_EXPECTED_HOST', reasons: [], ...base };
    }

    if (!hostOnlyDrift && webhookCheck.status === 'failed') reasons.push('webhook_failure_is_not_strict_host_only_drift');
    if (!alreadyOnExpectedHost && webhookCheck.status === 'ok') reasons.push('webhook_ok_evidence_is_internally_inconsistent');
    if (webhookCheck.status !== 'ok' && webhookCheck.status !== 'failed') {
        reasons.push(`webhook_check_status=${webhookCheck.status ?? 'unknown'}`);
    }
    return { state: 'BLOCKED', reasons: unique(reasons), ...base };
}

export function validateStructuredCutoverPackSummary(
    summary: StripeWebhookCutoverPackSummaryLike | null,
    expectedStripeReadonlySummary: string | null,
): string[] {
    if (!summary) return ['cutover_pack_summary_missing_or_invalid'];

    const problems: string[] = [];
    if (summary.schemaVersion !== 1) problems.push(`pack_schema_version=${summary.schemaVersion ?? 'missing'}`);
    if (summary.status !== 'WARNING') problems.push(`pack_status=${summary.status ?? 'missing'}`);
    if (summary.stripeCutoverStatus !== 'READY_FOR_STRIPE_DASHBOARD_APPROVAL') {
        problems.push(`pack_cutover_status=${summary.stripeCutoverStatus ?? 'missing'}`);
    }

    const checks = Array.isArray(summary.checks) ? summary.checks : [];
    const failedChecks = checks.filter((check) => check.status === 'failed');
    if (failedChecks.length > 0) {
        problems.push(`pack_failed_checks=${failedChecks.map((check) => check.name ?? 'unnamed').join('|')}`);
    }

    const evidenceCheck = checks.find((check) => check.name === 'stripe_readonly_evidence_available');
    if (evidenceCheck?.status !== 'warning') {
        problems.push(`pack_evidence_check_status=${evidenceCheck?.status ?? 'missing'}`);
    }

    const actualLineage = normalizeRelativePath(summary.latestStripeReadonlySummary);
    const expectedLineage = normalizeRelativePath(expectedStripeReadonlySummary);
    if (!expectedLineage || actualLineage !== expectedLineage) {
        problems.push('pack_stripe_readonly_lineage_mismatch');
    }

    return unique(problems);
}

export function evaluatePreExecutionChecks(
    checks: Array<{ status?: string; name?: string }>,
): PreExecutionGateResult {
    const blockingChecks = checks
        .filter((check) => check.status !== 'ok' && check.status !== 'warning')
        .map((check) => `${check.name ?? 'unnamed'}:${check.status ?? 'missing'}`);
    return {
        acceptable: checks.length > 0 && blockingChecks.length === 0,
        blockingChecks,
    };
}

export function sha256Hex(value: string): string {
    return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function buildStripeWebhookCutoverApprovalSentence(facts: StripeWebhookApprovalFacts): string {
    if (!isSha256(facts.accountIdSha256)) throw new Error('accountIdSha256 must be a lowercase SHA-256 hex digest');
    if (!isSha256(facts.endpointIdSha256)) throw new Error('endpointIdSha256 must be a lowercase SHA-256 hex digest');
    if (!isStrictWebhookUrl(facts.currentUrl)) throw new Error('currentUrl must be a strict HTTPS webhook URL');
    if (!isStrictWebhookUrl(facts.targetUrl)) throw new Error('targetUrl must be a strict HTTPS webhook URL');
    if (facts.enabledEvents.length === 0 || unique(facts.enabledEvents).length !== facts.enabledEvents.length) {
        throw new Error('enabledEvents must contain a non-empty unique event list');
    }

    const eventScope = facts.enabledEvents.join('|');
    return `Apruebo cambiar en Stripe test, en la cuenta con huella SHA-256 ${facts.accountIdSha256}, el webhook endpoint con huella SHA-256 ${facts.endpointIdSha256}, actualmente habilitado en ${facts.currentUrl}, para que apunte exactamente a ${facts.targetUrl}, conservando solo los eventos ${eventScope}, sin tocar productos, precios, clientes, suscripciones, Stripe live mode, CHECKOUT_ENABLED, Supabase, Cloudflare, Google, Resend, Sentry ni valores de secretos, y verificar despues con pnpm --config.verify-deps-before-run=false launch:stripe-readonly. No autorizo ningun otro cambio de Stripe ni servicios externos.`;
}

function blocked(reasons: string[]): StripeWebhookCutoverEvidenceClassification {
    return {
        state: 'BLOCKED',
        reasons: unique(reasons),
        currentHosts: [],
        expectedHosts: [],
        currentUrl: null,
        accountIdSha256: null,
        endpointIdSha256: null,
        requiredEvents: [],
        enabledEvents: [],
    };
}

function detailValue(details: string[] | undefined, key: string): string {
    const prefix = `${key}=`;
    return details?.find((detail) => detail.startsWith(prefix))?.slice(prefix.length).trim() ?? '';
}

function nullableDetail(details: string[] | undefined, key: string): string | null {
    const value = detailValue(details, key);
    return value && value !== 'none' && value !== 'missing' && value !== 'unparseable' ? value : null;
}

function detailList(details: string[] | undefined, key: string): string[] {
    const value = detailValue(details, key);
    if (!value || value === 'none') return [];
    return unique(value.split('|').map((item) => item.trim()).filter(Boolean));
}

function detailInteger(details: string[] | undefined, key: string): number | null {
    const value = detailValue(details, key);
    if (!/^\d+$/.test(value)) return null;
    return Number.parseInt(value, 10);
}

function isStrictWebhookUrl(value: string): boolean {
    try {
        const url = new URL(value);
        return url.protocol === 'https:'
            && !url.port
            && !url.username
            && !url.password
            && !url.search
            && !url.hash
            && url.pathname === webhookPath;
    } catch {
        return false;
    }
}

function safeHostname(value: string): string | null {
    try {
        return new URL(value).hostname.toLowerCase();
    } catch {
        return null;
    }
}

function sameStringSet(left: string[], right: string[]): boolean {
    return left.length > 0
        && left.length === right.length
        && left.every((item) => right.includes(item));
}

function isSha256(value: string): boolean {
    return /^[a-f0-9]{64}$/.test(value);
}

function normalizeRelativePath(value: string | null | undefined): string {
    return (value ?? '').replace(/\\/g, '/').replace(/^\.\//, '');
}

function unique(values: string[]): string[] {
    return [...new Set(values)].sort();
}
