import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
    buildStripeWebhookCutoverApprovalSentence,
    classifyStripeWebhookCutoverEvidence,
    evaluatePreExecutionChecks,
    sha256Hex,
    validateStructuredCutoverPackSummary,
    type StripeReadonlySummaryLike,
    type StripeWebhookCutoverPackSummaryLike,
} from '../../scripts/launch/stripe-webhook-cutover-shared';

const requiredEvents = [
    'checkout.session.completed',
    'checkout.session.expired',
    'invoice.paid',
    'invoice.payment_failed',
    'invoice.upcoming',
    'charge.refunded',
    'customer.subscription.updated',
    'customer.subscription.deleted',
];
const legacyUrl = 'https://espanolhonesto-staging.alindev95.workers.dev/api/stripe-webhook';
const stagingUrl = 'https://staging.espanolhonesto.com/api/stripe-webhook';
const fullEndpointId = 'we_test_full_endpoint_identifier_12345';
const endpointIdSha256 = sha256Hex(fullEndpointId);
const fullAccountId = 'acct_test_expected_account_12345';
const accountIdSha256 = sha256Hex(fullAccountId);
const readonlyPath = 'outputs/launch-stripe-readonly-evidence/2026-07-15T10-12-03-317Z/summary.json';

describe('Stripe webhook cutover shared contract', () => {
    it('classifies only the exact current host-only drift as planifiable', () => {
        const result = classifyStripeWebhookCutoverEvidence(hostOnlySummary());

        expect(result).toMatchObject({
            state: 'HOST_ONLY_DRIFT',
            reasons: [],
            currentUrl: legacyUrl,
            currentHosts: ['espanolhonesto-staging.alindev95.workers.dev'],
            expectedHosts: ['staging.espanolhonesto.com'],
            enabledEvents: [...requiredEvents].sort(),
        });
    });

    it('recognizes exact expected-host evidence without proposing a cutover', () => {
        const result = classifyStripeWebhookCutoverEvidence(alreadyConfiguredSummary());

        expect(result).toMatchObject({
            state: 'ALREADY_ON_EXPECTED_HOST',
            reasons: [],
            currentUrl: stagingUrl,
        });
    });

    it('blocks host drift when any other read-only check failed', () => {
        const summary = hostOnlySummary();
        summary.checks?.push({ status: 'failed', name: 'stripe_portal_configuration_readonly', details: [] });

        const result = classifyStripeWebhookCutoverEvidence(summary);

        expect(result.state).toBe('BLOCKED');
        expect(result.reasons).toContain('blocking_check=stripe_portal_configuration_readonly');
    });

    it.each([
        ['an extra event', [...requiredEvents, 'payment_intent.succeeded'], []],
        ['a missing event', requiredEvents.slice(1), [requiredEvents[0]]],
    ])('blocks host drift with %s', (_label, enabledEvents, missingEvents) => {
        const result = classifyStripeWebhookCutoverEvidence(hostOnlySummary({
            enabledEvents,
            missingEvents,
            endpointHasRequiredEvents: missingEvents.length === 0,
        }));

        expect(result.state).toBe('BLOCKED');
        expect(result.reasons).toContain('enabled_event_set_must_exactly_match_required_events');
    });

    it('blocks host drift with multiple enabled endpoints', () => {
        const result = classifyStripeWebhookCutoverEvidence(hostOnlySummary({
            enabledCount: 2,
            exactlyOneEnabled: false,
            unexpectedHosts: [
                'espanolhonesto-staging.alindev95.workers.dev',
                'other.example.com',
            ],
            unexpectedUrls: [legacyUrl, 'https://other.example.com/api/stripe-webhook'],
        }));

        expect(result.state).toBe('BLOCKED');
        expect(result.reasons).toContain('enabled_endpoint_count_must_equal_one');
    });

    it('rejects a FAILED or stale structured cutover pack', () => {
        const failedPack = readyPack({ status: 'FAILED' });
        expect(validateStructuredCutoverPackSummary(failedPack, readonlyPath)).toContain('pack_status=FAILED');

        const stalePack = readyPack({ latestStripeReadonlySummary: 'outputs/launch-stripe-readonly-evidence/old/summary.json' });
        expect(validateStructuredCutoverPackSummary(stalePack, readonlyPath)).toContain('pack_stripe_readonly_lineage_mismatch');
    });

    it('accepts only the structured WARNING pack tied to the current read-only evidence', () => {
        expect(validateStructuredCutoverPackSummary(readyPack(), readonlyPath)).toEqual([]);
    });

    it('keeps runApprovedExecution behind acceptable pre-execution checks', () => {
        expect(evaluatePreExecutionChecks([
            { status: 'ok', name: 'pack' },
            { status: 'warning', name: 'non_blocking_test_activation' },
        ])).toEqual({ acceptable: true, blockingChecks: [] });

        expect(evaluatePreExecutionChecks([
            { status: 'ok', name: 'env' },
            { status: 'failed', name: 'structured_pack' },
        ])).toEqual({
            acceptable: false,
            blockingChecks: ['structured_pack:failed'],
        });

        const runner = readFileSync('scripts/launch/stripe-webhook-cutover-runner.ts', 'utf8');
        expect(runner).toMatch(
            /const preExecutionGate = addPreExecutionGate\('approved execution'\);[\s\S]*if \(env\.value && preExecutionGate\.acceptable\) \{\s+const executionChecks = await runApprovedExecution/,
        );
    });

    it('builds one executable approval sentence from the endpoint SHA-256 without exposing the full id', () => {
        const sentence = buildStripeWebhookCutoverApprovalSentence({
            accountIdSha256,
            endpointIdSha256,
            currentUrl: legacyUrl,
            targetUrl: stagingUrl,
            enabledEvents: requiredEvents,
        });

        expect(sentence).toContain(endpointIdSha256);
        expect(sentence).toContain(accountIdSha256);
        expect(sentence).not.toContain(fullEndpointId);
        expect(sentence).not.toContain(fullAccountId);
        expect(sentence).toContain(legacyUrl);
        expect(sentence).toContain(stagingUrl);
        expect(() => buildStripeWebhookCutoverApprovalSentence({
            accountIdSha256,
            endpointIdSha256: 'not-a-sha256',
            currentUrl: legacyUrl,
            targetUrl: stagingUrl,
            enabledEvents: requiredEvents,
        })).toThrow(/SHA-256/);
    });

    it('keeps approval preparation GET-only and never persists a raw endpoint description', () => {
        const runner = readFileSync('scripts/launch/stripe-webhook-cutover-runner.ts', 'utf8');
        const preparation = runner.slice(
            runner.indexOf('async function runApprovalPreparation'),
            runner.indexOf('async function runApprovedExecution'),
        );

        expect(preparation).toContain('captureStripeAccount');
        expect(preparation).toContain('retrieveEndpoint');
        expect(preparation).toContain('buildExactApprovalSentence');
        expect(preparation).not.toContain('webhookEndpoints.update');
        expect(runner).toContain('descriptionPresent: Boolean(endpoint.description)');
        expect(runner).toContain('descriptionSha256: endpoint.description ? sha256Hex(endpoint.description) : null');
        expect(runner).not.toContain('description: endpoint.description');
        expect(runner.match(/new Stripe\([\s\S]{0,180}?maxNetworkRetries: 0/g)).toHaveLength(2);
    });

    it('requires account and endpoint identity hashes in strict read-only evidence', () => {
        const missingEndpointHash = hostOnlySummary();
        const webhook = missingEndpointHash.checks?.find((check) => check.name === 'stripe_webhook_endpoints_readonly');
        webhook!.details = webhook?.details?.filter((detail) => !detail.startsWith('enabled_1_id_sha256='));
        expect(classifyStripeWebhookCutoverEvidence(missingEndpointHash).reasons)
            .toContain('endpoint_id_sha256_missing_or_invalid');

        const missingAccountHash = hostOnlySummary();
        const account = missingAccountHash.checks?.find((check) => check.name === 'stripe_account_readonly');
        account!.details = account?.details?.filter((detail) => !detail.startsWith('account_id_sha256='));
        expect(classifyStripeWebhookCutoverEvidence(missingAccountHash).reasons)
            .toContain('account_id_sha256_missing_or_invalid');
    });

    it('uses the shared contract in both generators and emits pnpm-only instructions', () => {
        const pack = readFileSync('scripts/launch/stripe-webhook-cutover-pack.ts', 'utf8');
        const runner = readFileSync('scripts/launch/stripe-webhook-cutover-runner.ts', 'utf8');

        expect(pack).toContain('classifyStripeWebhookCutoverEvidence');
        expect(runner).toContain('classifyStripeWebhookCutoverEvidence');
        expect(runner).toContain('validateStructuredCutoverPackSummary');
        expect(pack).toContain('--prepare-approval');
        expect(pack).not.toContain('Exact Approval Sentence For Staging/Test Host');
        expect(pack).not.toContain('Exact Approval Sentence For Production/Test Rehearsal Host');
        expect(`${pack}\n${runner}`).not.toContain('corepack pnpm');
    });
});

interface WebhookFixtureOptions {
    enabledCount?: number;
    exactlyOneEnabled?: boolean;
    enabledEvents?: string[];
    missingEvents?: string[];
    endpointHasRequiredEvents?: boolean;
    unexpectedHosts?: string[];
    unexpectedUrls?: string[];
}

function hostOnlySummary(options: WebhookFixtureOptions = {}): StripeReadonlySummaryLike {
    const enabledEvents = options.enabledEvents ?? requiredEvents;
    const missingEvents = options.missingEvents ?? [];
    const unexpectedHosts = options.unexpectedHosts ?? ['espanolhonesto-staging.alindev95.workers.dev'];
    const unexpectedUrls = options.unexpectedUrls ?? [legacyUrl];
    return summaryWithWebhook('FAILED', 'failed', [
        `enabled=${options.enabledCount ?? 1}`,
        `expected_webhook_hosts=staging.espanolhonesto.com`,
        'matching_enabled_webhook_hosts=none',
        `unexpected_enabled_webhook_hosts=${unexpectedHosts.join('|')}`,
        'matching_enabled_webhook_urls=none',
        `unexpected_enabled_webhook_urls=${unexpectedUrls.join('|')}`,
        `required_events=${requiredEvents.join('|')}`,
        `missing_required_events=${missingEvents.join('|') || 'none'}`,
        `single_endpoint_has_required_events=${options.endpointHasRequiredEvents ?? true}`,
        'single_endpoint_has_exact_events=false',
        `exactly_one_enabled_endpoint=${options.exactlyOneEnabled ?? true}`,
        `enabled_1_url=${legacyUrl}`,
        'enabled_1_host=espanolhonesto-staging.alindev95.workers.dev',
        `enabled_1_id_sha256=${endpointIdSha256}`,
        `enabled_1_events=${enabledEvents.join('|')}`,
    ]);
}

function alreadyConfiguredSummary(): StripeReadonlySummaryLike {
    return summaryWithWebhook('WARNING', 'ok', [
        'enabled=1',
        'expected_webhook_hosts=staging.espanolhonesto.com',
        'matching_enabled_webhook_hosts=staging.espanolhonesto.com',
        'unexpected_enabled_webhook_hosts=none',
        `matching_enabled_webhook_urls=${stagingUrl}`,
        'unexpected_enabled_webhook_urls=none',
        `required_events=${requiredEvents.join('|')}`,
        'missing_required_events=none',
        'single_endpoint_has_required_events=true',
        'single_endpoint_has_exact_events=true',
        'exactly_one_enabled_endpoint=true',
        `enabled_1_url=${stagingUrl}`,
        'enabled_1_host=staging.espanolhonesto.com',
        `enabled_1_id_sha256=${endpointIdSha256}`,
        `enabled_1_events=${requiredEvents.join('|')}`,
    ]);
}

function summaryWithWebhook(
    status: string,
    webhookStatus: string,
    details: string[],
): StripeReadonlySummaryLike {
    return {
        status,
        stripeMode: 'test',
        checks: [
            { status: 'ok', name: 'environment_shape', details: [] },
            {
                status: 'warning',
                name: 'stripe_account_readonly',
                details: [`account_id_sha256=${accountIdSha256}`, 'account_match=true'],
            },
            { status: 'ok', name: 'stripe_portal_configuration_readonly', details: [] },
            { status: webhookStatus, name: 'stripe_webhook_endpoints_readonly', details },
            { status: 'ok', name: 'package_price_links_readonly', details: [] },
        ],
    };
}

function readyPack(
    overrides: Partial<StripeWebhookCutoverPackSummaryLike> = {},
): StripeWebhookCutoverPackSummaryLike {
    return {
        schemaVersion: 1,
        status: 'WARNING',
        stripeCutoverStatus: 'READY_FOR_STRIPE_DASHBOARD_APPROVAL',
        latestStripeReadonlySummary: readonlyPath,
        checks: [
            { status: 'ok', name: 'package_script_stripe_webhook_cutover_pack' },
            { status: 'warning', name: 'stripe_readonly_evidence_available' },
            { status: 'ok', name: 'generated_artifact_secret_and_scope_posture' },
        ],
        ...overrides,
    };
}
