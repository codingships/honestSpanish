import * as dotenv from 'dotenv';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import Stripe from 'stripe';

type CheckStatus = 'ok' | 'warning' | 'failed';
type ReportStatus = 'OK' | 'WARNING' | 'FAILED';
type ClosureStatus = 'PLAN_ONLY_READY' | 'EXECUTED_AND_NEEDS_REVIEW' | 'BLOCKED_BY_GATE_OR_ARTIFACTS';

interface Check {
    status: CheckStatus;
    name: string;
    message: string;
    details: string[];
}

interface SummaryLike {
    status?: string;
    stripeMode?: string;
    checks?: Array<{ status?: string; name?: string; message?: string; details?: string[] }>;
}

interface EndpointSnapshot {
    id: string;
    url: string;
    host: string;
    status: string | null;
    livemode: boolean;
    enabledEvents: string[];
    apiVersion: string | null;
    description: string | null;
}

interface ExecutionCapture {
    id: string;
    status: CheckStatus;
    writesStripe: boolean;
    path: string;
    description: string;
}

interface RunnerReport {
    schemaVersion: 1;
    startedAt: string;
    endedAt: string;
    status: ReportStatus;
    closureStatus: ClosureStatus;
    outputDir: string;
    stripeModePolicy: 'test-only';
    approvalEnvVar: string;
    executeRequested: boolean;
    approvalMatched: boolean;
    externalWritePerformed: boolean;
    targetWebhookPath: string;
    allowedTargetHosts: string[];
    requiredEnv: string[];
    latestCutoverPackSummaryPath: string | null;
    latestCutoverPackApprovalPath: string | null;
    latestStripeReadonlySummaryPath: string | null;
    checks: Check[];
    captures: ExecutionCapture[];
    commandManifestPath: string;
    executionPlanPath: string;
    approvalGatePath: string;
    rollbackAfterCutoverPath: string;
    manualEvidenceAfterCutoverPath: string;
    summaryPath: string;
}

interface RenderedArtifacts {
    commandManifest: string;
    executionPlan: string;
    approvalGate: string;
    rollbackAfterCutover: string;
    manualEvidenceAfterCutover: string;
    summary: string;
}

interface ExecutionEnv {
    stripeSecretKey: string;
    endpointId: string;
    targetUrl: string;
    approvalSentence: string;
}

const approvalEnvVar = 'STRIPE_WEBHOOK_CUTOVER_APPROVAL';
const endpointIdEnvVar = 'STRIPE_WEBHOOK_ENDPOINT_ID';
const targetUrlEnvVar = 'STRIPE_WEBHOOK_TARGET_URL';
const requiredEnv = ['STRIPE_SECRET_KEY', endpointIdEnvVar, targetUrlEnvVar, approvalEnvVar];
const targetWebhookPath = '/api/stripe-webhook';
const allowedTargetHosts = ['staging.espanolhonesto.com', 'espanolhonesto.com', 'www.espanolhonesto.com'];
const executeRequested = process.argv.includes('--execute-approved');

const startedAt = new Date();
const outputDir = path.join(process.cwd(), 'outputs', 'launch-stripe-webhook-cutover-runner', stamp(startedAt));
mkdirSync(outputDir, { recursive: true });

const latestCutoverPackSummaryPath = latestGeneratedPath('launch-stripe-webhook-cutover-pack', 'summary.md');
const latestCutoverPackApprovalPath = latestGeneratedPath('launch-stripe-webhook-cutover-pack', 'approval-request.md');
const latestCutoverPackVerificationPath = latestGeneratedPath('launch-stripe-webhook-cutover-pack', 'verification-checklist.md');
const latestCutoverPackRollbackPath = latestGeneratedPath('launch-stripe-webhook-cutover-pack', 'rollback-plan.md');
const latestStripeReadonlySummaryPath = latestGeneratedPath('launch-stripe-readonly-evidence', 'summary.json');
const latestStripeReadonlySummary = readJsonIfExists<SummaryLike>(latestStripeReadonlySummaryPath);

const captures: ExecutionCapture[] = [];
const checks: Check[] = [
    validatePackageScript(),
    validateCutoverPack(),
    validateStripeReadonlyEvidence(),
    validateApprovalGateSource(),
    validateForbiddenScopeSource(),
];

let approvalMatched = false;

await main();

async function main(): Promise<void> {
    if (executeRequested) {
        dotenv.config({ path: '.env', quiet: true });
        const env = validateExecutionEnv();
        checks.push(env.check);

        if (env.value) {
            const executionChecks = await runApprovedExecution(env.value, captures);
            approvalMatched = executionChecks.some((check) => check.name === 'exact_approval_gate' && check.status === 'ok');
            checks.push(...executionChecks);
        }
    } else {
        checks.push({
            status: 'ok',
            name: 'plan_mode_no_external_write',
            message: 'Plan mode generated the Stripe webhook cutover runner package without connecting to Stripe or changing webhook endpoints.',
            details: [
                'executeRequested=false',
                'externalWritePerformed=false',
                `futureGate=${approvalEnvVar}`,
                'futureFlag=--execute-approved',
            ],
        });
    }

    let report = createReport(checks, captures);
    let rendered = renderArtifacts(report);
    checks.push(validateGeneratedArtifactPosture(rendered));
    report = createReport(checks, captures);
    rendered = renderArtifacts(report);

    writeFileSync(report.commandManifestPath, rendered.commandManifest, 'utf8');
    writeFileSync(report.executionPlanPath, rendered.executionPlan, 'utf8');
    writeFileSync(report.approvalGatePath, rendered.approvalGate, 'utf8');
    writeFileSync(report.rollbackAfterCutoverPath, rendered.rollbackAfterCutover, 'utf8');
    writeFileSync(report.manualEvidenceAfterCutoverPath, rendered.manualEvidenceAfterCutover, 'utf8');
    writeFileSync(path.join(outputDir, 'summary.json'), JSON.stringify(report, null, 2), 'utf8');
    writeFileSync(report.summaryPath, rendered.summary, 'utf8');

    const failed = report.checks.filter((check) => check.status === 'failed');
    const warnings = report.checks.filter((check) => check.status === 'warning');

    console.log(`[launch:stripe-webhook-cutover-runner] Status: ${report.status}`);
    console.log(`[launch:stripe-webhook-cutover-runner] Closure: ${report.closureStatus}`);
    console.log(`[launch:stripe-webhook-cutover-runner] Failed: ${failed.length}`);
    console.log(`[launch:stripe-webhook-cutover-runner] Warnings: ${warnings.length}`);
    console.log(`[launch:stripe-webhook-cutover-runner] External write performed: ${report.externalWritePerformed}`);
    console.log(`[launch:stripe-webhook-cutover-runner] Summary: ${report.summaryPath}`);
    console.log(`[launch:stripe-webhook-cutover-runner] Execution plan: ${report.executionPlanPath}`);
    console.log(`[launch:stripe-webhook-cutover-runner] Approval gate: ${report.approvalGatePath}`);
    console.log(`[launch:stripe-webhook-cutover-runner] Rollback: ${report.rollbackAfterCutoverPath}`);

    if (failed.length > 0) process.exit(1);
}

function createReport(reportChecks: Check[], reportCaptures: ExecutionCapture[]): RunnerReport {
    const reportStatus = statusFor(reportChecks);
    const externalWritePerformed = reportCaptures.some((capture) => capture.writesStripe && capture.status === 'ok');

    return {
        schemaVersion: 1,
        startedAt: startedAt.toISOString(),
        endedAt: new Date().toISOString(),
        status: reportStatus,
        closureStatus: reportStatus === 'FAILED'
            ? 'BLOCKED_BY_GATE_OR_ARTIFACTS'
            : executeRequested
                ? 'EXECUTED_AND_NEEDS_REVIEW'
                : 'PLAN_ONLY_READY',
        outputDir,
        stripeModePolicy: 'test-only',
        approvalEnvVar,
        executeRequested,
        approvalMatched,
        externalWritePerformed,
        targetWebhookPath,
        allowedTargetHosts,
        requiredEnv,
        latestCutoverPackSummaryPath,
        latestCutoverPackApprovalPath,
        latestStripeReadonlySummaryPath,
        checks: reportChecks,
        captures: reportCaptures,
        commandManifestPath: path.join(outputDir, 'stripe-webhook-cutover-command-manifest.json'),
        executionPlanPath: path.join(outputDir, 'stripe-webhook-cutover-execution-plan.md'),
        approvalGatePath: path.join(outputDir, 'approval-gate.md'),
        rollbackAfterCutoverPath: path.join(outputDir, 'rollback-after-webhook-cutover.md'),
        manualEvidenceAfterCutoverPath: path.join(outputDir, 'manual-evidence-after-webhook-cutover.txt'),
        summaryPath: path.join(outputDir, 'summary.md'),
    };
}

function validatePackageScript(): Check {
    const packagePath = 'package.json';
    if (!existsSync(packagePath)) {
        return {
            status: 'failed',
            name: 'package_script_stripe_webhook_cutover_runner',
            message: 'package.json is missing.',
            details: [packagePath],
        };
    }

    const packageJson = JSON.parse(readFileSync(packagePath, 'utf8')) as {
        packageManager?: string;
        scripts?: Record<string, string>;
    };
    const missing: string[] = [];
    if (packageJson.packageManager !== 'pnpm@10.33.0') missing.push('packageManager=pnpm@10.33.0');
    if (packageJson.scripts?.['launch:stripe-webhook-cutover-runner'] !== 'tsx scripts/launch/stripe-webhook-cutover-runner.ts') {
        missing.push('launch:stripe-webhook-cutover-runner=tsx scripts/launch/stripe-webhook-cutover-runner.ts');
    }

    return {
        status: missing.length === 0 ? 'ok' : 'failed',
        name: 'package_script_stripe_webhook_cutover_runner',
        message: missing.length === 0
            ? 'Package scripts expose the gated Stripe webhook cutover runner and preserve pnpm policy.'
            : 'Package scripts are missing the gated Stripe webhook cutover runner or pnpm package manager contract.',
        details: missing.length === 0 ? ['launch:stripe-webhook-cutover-runner'] : missing.map((item) => `missing=${item}`),
    };
}

function validateCutoverPack(): Check {
    if (!latestCutoverPackSummaryPath || !latestCutoverPackApprovalPath || !latestCutoverPackVerificationPath || !latestCutoverPackRollbackPath) {
        return {
            status: 'failed',
            name: 'cutover_pack_exists',
            message: 'The Stripe webhook cutover pack must exist before using the gated runner.',
            details: ['run=corepack pnpm --config.verify-deps-before-run=false launch:stripe-webhook-cutover-pack'],
        };
    }

    const combined = [
        readFileSync(latestCutoverPackSummaryPath, 'utf8'),
        readFileSync(latestCutoverPackApprovalPath, 'utf8'),
        readFileSync(latestCutoverPackVerificationPath, 'utf8'),
        readFileSync(latestCutoverPackRollbackPath, 'utf8'),
    ].join('\n');
    const required = [
        'Stripe Webhook Cutover',
        'The exact approval scope is limited to one Stripe test-mode webhook endpoint host change.',
        'https://staging.espanolhonesto.com/api/stripe-webhook',
        'https://espanolhonesto.com/api/stripe-webhook',
        'Do not switch to Stripe live mode.',
        'Do not create or edit products, prices, customers, subscriptions, invoices, tax settings, bank/payout settings or fraud rules.',
        'webhook signing secret',
        'rollback',
    ];
    const missing = required.filter((snippet) => !combined.includes(snippet));

    return {
        status: missing.length === 0 ? 'ok' : 'failed',
        name: 'cutover_pack_exists',
        message: missing.length === 0
            ? 'Latest Stripe cutover pack contains the test-mode scope, target URLs, verification checklist and rollback posture.'
            : 'Latest Stripe cutover pack is missing required scope, verification or rollback facts.',
        details: missing.length === 0
            ? [
                `summary=${latestCutoverPackSummaryPath}`,
                `approval=${latestCutoverPackApprovalPath}`,
                `verification=${latestCutoverPackVerificationPath}`,
                `rollback=${latestCutoverPackRollbackPath}`,
            ]
            : missing.map((snippet) => `missing=${snippet}`),
    };
}

function validateStripeReadonlyEvidence(): Check {
    if (!latestStripeReadonlySummaryPath || !latestStripeReadonlySummary) {
        return {
            status: 'failed',
            name: 'stripe_readonly_evidence_exists',
            message: 'Stripe read-only evidence is missing before preparing a write-capable runner.',
            details: ['run=corepack pnpm --config.verify-deps-before-run=false launch:stripe-readonly'],
        };
    }

    const webhookCheck = latestStripeReadonlySummary.checks?.find((check) => check.name === 'stripe_webhook_endpoints_readonly');
    const currentHosts = detailList(webhookCheck?.details, 'unexpected_enabled_webhook_hosts');
    const expectedHosts = detailList(webhookCheck?.details, 'expected_webhook_hosts');
    const events = detailList(webhookCheck?.details, 'enabled_1_events');
    const problems: string[] = [];

    if (latestStripeReadonlySummary.status === 'FAILED') problems.push('latest Stripe read-only summary failed');
    if (latestStripeReadonlySummary.stripeMode !== 'test') problems.push(`stripeMode=${latestStripeReadonlySummary.stripeMode ?? 'unknown'}`);
    if (!webhookCheck) problems.push('missing stripe_webhook_endpoints_readonly check');
    if (events.length === 0) problems.push('missing enabled event set');

    return {
        status: problems.length === 0 ? 'ok' : 'failed',
        name: 'stripe_readonly_evidence_exists',
        message: problems.length === 0
            ? 'Latest Stripe read-only evidence proves test mode and gives the current webhook/event scope for the cutover gate.'
            : 'Latest Stripe read-only evidence is not sufficient for a gated test-mode webhook cutover.',
        details: problems.length === 0
            ? [
                `summary=${latestStripeReadonlySummaryPath}`,
                `status=${latestStripeReadonlySummary.status ?? 'unknown'}`,
                `stripeMode=${latestStripeReadonlySummary.stripeMode}`,
                `currentHosts=${currentHosts.join('|') || 'none'}`,
                `expectedHosts=${expectedHosts.join('|') || 'none'}`,
                `events=${events.join('|')}`,
            ]
            : problems,
    };
}

function validateApprovalGateSource(): Check {
    const sourcePath = path.join('scripts', 'launch', 'stripe-webhook-cutover-runner.ts');
    const source = readIfExists(sourcePath);
    if (!source) {
        return {
            status: 'failed',
            name: 'approval_gate_source',
            message: 'Cannot validate this runner source file.',
            details: [sourcePath],
        };
    }

    const required = [
        approvalEnvVar,
        endpointIdEnvVar,
        targetUrlEnvVar,
        '--execute-approved',
        'runApprovedExecution',
        'buildExactApprovalSentence',
        'stripe.webhookEndpoints.retrieve',
        'stripe.webhookEndpoints.update',
        "stripeSecretKey.startsWith('sk_test_')",
        "stripeSecretKey.startsWith('sk_live_')",
        'endpoint.livemode === false',
        'externalWritePerformed=false',
    ];
    const missing = required.filter((snippet) => !source.includes(snippet));

    return {
        status: missing.length === 0 ? 'ok' : 'failed',
        name: 'approval_gate_source',
        message: missing.length === 0
            ? 'Runner source contains test-key validation, read-only retrieve, exact approval comparison and URL-only update branch.'
            : 'Runner source is missing required Stripe approval gate or execution sequencing facts.',
        details: missing.length === 0 ? [sourcePath] : missing.map((snippet) => `missing=${snippet}`),
    };
}

function validateForbiddenScopeSource(): Check {
    const sourcePath = path.join('scripts', 'launch', 'stripe-webhook-cutover-runner.ts');
    const source = readIfExists(sourcePath) ?? '';
    const required = forbiddenScopeLines();
    const missing = required.filter((snippet) => !source.includes(snippet));
    const forbiddenUpdateSnippets = Array.from(
        source.matchAll(/stripe\.(products|prices|customers|subscriptions|checkout|paymentIntents|invoices)\.(create|update|del|delete|retrieve|list)/g),
        (match) => match[0],
    );

    return {
        status: missing.length === 0 && forbiddenUpdateSnippets.length === 0 ? 'ok' : 'failed',
        name: 'forbidden_scope_source',
        message: missing.length === 0 && forbiddenUpdateSnippets.length === 0
            ? 'Runner source forbids live mode, non-webhook Stripe writes, provider writes and secret-value output.'
            : 'Runner source is missing forbidden-scope wording or contains a forbidden Stripe write snippet.',
        details: [
            ...missing.map((snippet) => `missing=${snippet}`),
            ...forbiddenUpdateSnippets.map((snippet) => `forbidden=${snippet}`),
        ],
    };
}

function validateExecutionEnv(): { check: Check; value: ExecutionEnv | null } {
    const stripeSecretKey = process.env.STRIPE_SECRET_KEY ?? '';
    const endpointId = process.env[endpointIdEnvVar] ?? '';
    const targetUrl = process.env[targetUrlEnvVar] ?? '';
    const approvalSentence = process.env[approvalEnvVar] ?? '';
    const missing = requiredEnv.filter((name) => !process.env[name]);
    const problems = [...missing.map((name) => `missing=${name}`)];

    if (stripeSecretKey && !stripeSecretKey.startsWith('sk_test_')) {
        problems.push('STRIPE_SECRET_KEY must be a Stripe test secret key');
    }
    if (stripeSecretKey.startsWith('sk_live_')) {
        problems.push('STRIPE_SECRET_KEY live mode is explicitly forbidden');
    }
    if (endpointId && !/^we_[A-Za-z0-9]+$/.test(endpointId)) {
        problems.push(`${endpointIdEnvVar} must look like a Stripe webhook endpoint id`);
    }
    const targetValidation = validateTargetUrl(targetUrl);
    if (targetUrl && targetValidation.length > 0) {
        problems.push(...targetValidation);
    }

    return {
        check: {
            status: problems.length === 0 ? 'ok' : 'failed',
            name: 'execution_env_shape',
            message: problems.length === 0
                ? 'Execution environment has a Stripe test key, endpoint id, allowed target URL and approval variable shape.'
                : 'Execution environment is missing required values or attempts a forbidden Stripe mode/target.',
            details: problems.length === 0
                ? [
                    'stripeKeyMode=test',
                    `endpointId=${compactId(endpointId)}`,
                    `targetUrl=${safeUrl(targetUrl)}`,
                    `approvalProvided=${String(Boolean(approvalSentence))}`,
                ]
                : problems,
        },
        value: problems.length === 0
            ? { stripeSecretKey, endpointId, targetUrl, approvalSentence }
            : null,
    };
}

async function runApprovedExecution(env: ExecutionEnv, reportCaptures: ExecutionCapture[]): Promise<Check[]> {
    const executionChecks: Check[] = [];
    const stripe = new Stripe(env.stripeSecretKey, {
        apiVersion: '2026-02-25.clover',
    });

    const accountCheck = await captureStripeAccount(stripe, reportCaptures);
    executionChecks.push(accountCheck);
    if (accountCheck.status === 'failed') return executionChecks;

    const before = await retrieveEndpoint(stripe, env.endpointId, 'stripe_endpoint_before_update_readonly', reportCaptures);
    executionChecks.push(before.check);
    if (!before.snapshot || before.check.status === 'failed') return executionChecks;

    const endpointScopeCheck = validateEndpointScope(before.snapshot);
    executionChecks.push(endpointScopeCheck);
    if (endpointScopeCheck.status === 'failed') return executionChecks;

    const exactApprovalSentence = buildExactApprovalSentence(before.snapshot, env.endpointId, env.targetUrl);
    const exactApprovalGate: Check = {
        status: env.approvalSentence === exactApprovalSentence ? 'ok' : 'failed',
        name: 'exact_approval_gate',
        message: env.approvalSentence === exactApprovalSentence
            ? 'Exact approval sentence matched; only the Stripe test-mode webhook URL update can run.'
            : 'Execution was requested but the exact approval gate did not match, so no Stripe webhook update can run.',
        details: env.approvalSentence === exactApprovalSentence
            ? [
                `env=${approvalEnvVar}`,
                `endpointId=${before.snapshot.id}`,
                `from=${safeUrl(before.snapshot.url)}`,
                `to=${safeUrl(env.targetUrl)}`,
                `events=${before.snapshot.enabledEvents.join('|')}`,
            ]
            : [
                `env=${approvalEnvVar}`,
                'required=exact sentence generated from live read-only Stripe endpoint preflight',
                'externalWritePerformed=false',
            ],
    };
    executionChecks.push(exactApprovalGate);
    if (exactApprovalGate.status === 'failed') return executionChecks;

    if (normalizeUrl(before.snapshot.url) === normalizeUrl(env.targetUrl)) {
        executionChecks.push({
            status: 'warning',
            name: 'target_url_already_active',
            message: 'The Stripe webhook endpoint already points at the requested target URL; no update call was made.',
            details: [
                `endpointId=${before.snapshot.id}`,
                `targetUrl=${safeUrl(env.targetUrl)}`,
                'externalWritePerformed=false',
            ],
        });
        return executionChecks;
    }

    try {
        const updated = await stripe.webhookEndpoints.update(env.endpointId, { url: env.targetUrl });
        const snapshot = snapshotEndpoint(updated);
        const capture = writeExecutionCapture(
            'stripe_endpoint_url_update',
            'ok',
            true,
            'Stripe webhook endpoint URL update result, redacted to endpoint id prefix and non-secret metadata.',
            snapshot,
        );
        reportCaptures.push(capture);
        executionChecks.push({
            status: 'ok',
            name: 'stripe_webhook_endpoint_url_updated',
            message: 'Stripe test-mode webhook endpoint URL was updated and captured without secret values.',
            details: [
                `capture=${capture.path}`,
                `endpointId=${snapshot.id}`,
                `targetUrl=${safeUrl(snapshot.url)}`,
                `events=${snapshot.enabledEvents.join('|')}`,
            ],
        });
    } catch (error) {
        const capture = writeExecutionCapture(
            'stripe_endpoint_url_update',
            'failed',
            true,
            'Stripe webhook endpoint URL update failed; no secret values stored.',
            { error: safeErrorMessage(error) },
        );
        reportCaptures.push(capture);
        executionChecks.push({
            status: 'failed',
            name: 'stripe_webhook_endpoint_url_updated',
            message: 'Stripe test-mode webhook endpoint URL update failed.',
            details: [`capture=${capture.path}`, safeErrorMessage(error)],
        });
        return executionChecks;
    }

    const after = await retrieveEndpoint(stripe, env.endpointId, 'stripe_endpoint_after_update_readonly', reportCaptures);
    executionChecks.push(after.check);
    if (!after.snapshot || after.check.status === 'failed') return executionChecks;

    const afterChecks = [
        normalizeUrl(after.snapshot.url) === normalizeUrl(env.targetUrl),
        after.snapshot.livemode === false,
        after.snapshot.status === 'enabled',
        sameStringSet(after.snapshot.enabledEvents, before.snapshot.enabledEvents),
    ];
    executionChecks.push({
        status: afterChecks.every(Boolean) ? 'ok' : 'failed',
        name: 'post_update_readonly_verification',
        message: afterChecks.every(Boolean)
            ? 'Read-only verification shows the target URL, test mode, enabled status and original event set after the update.'
            : 'Read-only verification did not prove the target URL/test-mode/enabled-event invariants after the update.',
        details: [
            `targetUrl=${safeUrl(after.snapshot.url)}`,
            `livemode=${String(after.snapshot.livemode)}`,
            `status=${after.snapshot.status ?? 'unknown'}`,
            `eventsPreserved=${String(sameStringSet(after.snapshot.enabledEvents, before.snapshot.enabledEvents))}`,
        ],
    });

    return executionChecks;
}

async function captureStripeAccount(stripe: Stripe, reportCaptures: ExecutionCapture[]): Promise<Check> {
    try {
        const account = await stripe.accounts.retrieve();
        const capture = writeExecutionCapture(
            'stripe_account_readonly_preflight',
            'ok',
            false,
            'Read-only Stripe account preflight before any webhook update.',
            {
                accountId: compactId(account.id),
                country: account.country ?? 'unknown',
                defaultCurrency: account.default_currency ?? 'unknown',
                chargesEnabled: Boolean(account.charges_enabled),
                payoutsEnabled: Boolean(account.payouts_enabled),
            },
        );
        reportCaptures.push(capture);
        return {
            status: 'ok',
            name: 'stripe_account_readonly_preflight',
            message: 'Stripe account is reachable with the configured test key before any write.',
            details: [
                `capture=${capture.path}`,
                `account=${compactId(account.id)}`,
                `country=${account.country ?? 'unknown'}`,
            ],
        };
    } catch (error) {
        const capture = writeExecutionCapture(
            'stripe_account_readonly_preflight',
            'failed',
            false,
            'Read-only Stripe account preflight failed before any webhook update.',
            { error: safeErrorMessage(error) },
        );
        reportCaptures.push(capture);
        return {
            status: 'failed',
            name: 'stripe_account_readonly_preflight',
            message: 'Stripe account could not be read; no webhook update can run.',
            details: [`capture=${capture.path}`, safeErrorMessage(error)],
        };
    }
}

async function retrieveEndpoint(
    stripe: Stripe,
    endpointId: string,
    captureId: string,
    reportCaptures: ExecutionCapture[],
): Promise<{ check: Check; snapshot: EndpointSnapshot | null }> {
    try {
        const endpoint = await stripe.webhookEndpoints.retrieve(endpointId);
        const snapshot = snapshotEndpoint(endpoint);
        const capture = writeExecutionCapture(
            captureId,
            'ok',
            false,
            'Read-only Stripe webhook endpoint retrieve; endpoint id is compacted and no webhook secret is stored.',
            snapshot,
        );
        reportCaptures.push(capture);
        return {
            check: {
                status: 'ok',
                name: captureId,
                message: 'Stripe webhook endpoint metadata was retrieved read-only.',
                details: [
                    `capture=${capture.path}`,
                    `endpointId=${snapshot.id}`,
                    `url=${safeUrl(snapshot.url)}`,
                    `livemode=${String(snapshot.livemode)}`,
                    `status=${snapshot.status ?? 'unknown'}`,
                ],
            },
            snapshot,
        };
    } catch (error) {
        const capture = writeExecutionCapture(
            captureId,
            'failed',
            false,
            'Read-only Stripe webhook endpoint retrieve failed; no webhook update was attempted.',
            { endpointId: compactId(endpointId), error: safeErrorMessage(error) },
        );
        reportCaptures.push(capture);
        return {
            check: {
                status: 'failed',
                name: captureId,
                message: 'Stripe webhook endpoint could not be retrieved read-only.',
                details: [`capture=${capture.path}`, safeErrorMessage(error)],
            },
            snapshot: null,
        };
    }
}

function validateEndpointScope(endpoint: EndpointSnapshot): Check {
    const problems: string[] = [];
    if (endpoint.livemode !== false) problems.push('endpoint livemode is not false');
    if (endpoint.status !== 'enabled') problems.push(`endpoint status is ${endpoint.status ?? 'unknown'}`);
    if (endpoint.enabledEvents.length === 0) problems.push('endpoint has no enabled events to preserve');
    if (!endpoint.url.endsWith(targetWebhookPath)) problems.push(`current endpoint path is not ${targetWebhookPath}`);

    return {
        status: problems.length === 0 ? 'ok' : 'failed',
        name: 'stripe_endpoint_scope_preflight',
        message: problems.length === 0
            ? 'Endpoint preflight is test mode, enabled and scoped to the webhook path before update.'
            : 'Endpoint preflight does not match the allowed test-mode enabled webhook scope.',
        details: problems.length === 0
            ? [
                `endpointId=${endpoint.id}`,
                `from=${safeUrl(endpoint.url)}`,
                `events=${endpoint.enabledEvents.join('|')}`,
            ]
            : problems,
    };
}

function buildExactApprovalSentence(endpoint: EndpointSnapshot, endpointId: string, targetUrl: string): string {
    const eventScope = endpoint.enabledEvents.join('|');
    return `Apruebo cambiar en Stripe test el webhook endpoint actualmente habilitado en ${endpoint.url} (${endpointId}) para que apunte exactamente a ${targetUrl}, conservando solo los eventos ${eventScope}, sin tocar productos, precios, clientes, suscripciones, Stripe live mode, CHECKOUT_ENABLED, Supabase, Cloudflare, Google, Resend, Sentry ni valores de secretos, y verificar despues con corepack pnpm --config.verify-deps-before-run=false launch:stripe-readonly. No autorizo ningun otro cambio de Stripe ni servicios externos.`;
}

function snapshotEndpoint(endpoint: Stripe.WebhookEndpoint): EndpointSnapshot {
    return {
        id: compactId(endpoint.id),
        url: safeEndpointUrl(endpoint.url),
        host: safeEndpointHost(endpoint.url),
        status: endpoint.status ?? null,
        livemode: Boolean(endpoint.livemode),
        enabledEvents: [...endpoint.enabled_events],
        apiVersion: endpoint.api_version ?? null,
        description: endpoint.description ?? null,
    };
}

function writeExecutionCapture(
    id: string,
    status: CheckStatus,
    writesStripe: boolean,
    description: string,
    data: unknown,
): ExecutionCapture {
    const capturePath = path.join(outputDir, `${id}.json`);
    writeFileSync(capturePath, `${JSON.stringify({
        schemaVersion: 1,
        capturedAt: new Date().toISOString(),
        id,
        status,
        writesStripe,
        description,
        data,
    }, null, 2)}\n`, 'utf8');

    return {
        id,
        status,
        writesStripe,
        path: capturePath,
        description,
    };
}

function renderArtifacts(report: RunnerReport): RenderedArtifacts {
    const commandManifest = renderCommandManifest(report);
    const executionPlan = renderExecutionPlan(report);
    const approvalGate = renderApprovalGate(report);
    const rollbackAfterCutover = renderRollbackAfterCutover(report);
    const manualEvidenceAfterCutover = renderManualEvidenceAfterCutover(report);
    const summary = renderSummary(report);

    return { commandManifest, executionPlan, approvalGate, rollbackAfterCutover, manualEvidenceAfterCutover, summary };
}

function renderCommandManifest(report: RunnerReport): string {
    return `${JSON.stringify({
        schemaVersion: report.schemaVersion,
        generatedAt: report.endedAt,
        status: report.status,
        closureStatus: report.closureStatus,
        executeRequested: report.executeRequested,
        approvalMatched: report.approvalMatched,
        externalWritePerformed: report.externalWritePerformed,
        stripeModePolicy: report.stripeModePolicy,
        targetWebhookPath: report.targetWebhookPath,
        allowedTargetHosts: report.allowedTargetHosts,
        requiredEnv: report.requiredEnv,
        approvalEnvVar: report.approvalEnvVar,
        executeFlag: '--execute-approved',
        planMode: {
            connectsToStripe: false,
            writesStripe: false,
            writesOtherExternalServices: false,
        },
        approvedExecutionOnly: {
            stripeReadOnlyPreflight: [
                'stripe.accounts.retrieve',
                'stripe.webhookEndpoints.retrieve',
            ],
            stripeWrite: 'stripe.webhookEndpoints.update(endpointId, { url: targetUrl })',
            updateScope: 'URL only; enabled_events are not sent, products/prices/customers/subscriptions/checkout are never touched.',
        },
        latestSupportArtifacts: {
            cutoverPackSummary: toRelativeOrNull(report.latestCutoverPackSummaryPath),
            cutoverPackApproval: toRelativeOrNull(report.latestCutoverPackApprovalPath),
            stripeReadonlySummary: toRelativeOrNull(report.latestStripeReadonlySummaryPath),
        },
        forbiddenScope: forbiddenScopeLines(),
        captures: report.captures.map((capture) => ({
            ...capture,
            path: toRelative(capture.path),
        })),
        checks: report.checks,
    }, null, 2)}\n`;
}

function renderExecutionPlan(report: RunnerReport): string {
    return `${[
        '# Stripe Webhook Cutover Runner Execution Plan',
        '',
        `- Generated: ${report.endedAt}`,
        `- Status: ${report.status}`,
        `- Closure: ${report.closureStatus}`,
        `- External write performed: ${String(report.externalWritePerformed)}`,
        `- Approval env var: ${approvalEnvVar}`,
        '',
        '## Scope',
        '',
        '- Plan mode is local-only and does not call Stripe.',
        '- Approved execution is limited to one Stripe test-mode webhook endpoint URL update.',
        '- The target URL must be HTTPS, must use an allowed launch host and must end in `/api/stripe-webhook`.',
        '- Before any update, the runner reads the Stripe account and endpoint metadata, confirms `livemode=false`, confirms the endpoint is enabled and builds the exact approval sentence from that live read-only preflight.',
        '',
        '## Sequence',
        '',
        '1. Run `corepack pnpm --config.verify-deps-before-run=false launch:stripe-readonly` and review the read-only evidence.',
        '2. Run `corepack pnpm --config.verify-deps-before-run=false launch:stripe-webhook-cutover-pack` and review the approval request, verification checklist and rollback plan.',
        '3. Export `STRIPE_WEBHOOK_ENDPOINT_ID`, `STRIPE_WEBHOOK_TARGET_URL` and `STRIPE_WEBHOOK_CUTOVER_APPROVAL` outside repo files.',
        '4. Execute only after exact approval: `corepack pnpm --config.verify-deps-before-run=false launch:stripe-webhook-cutover-runner -- --execute-approved`.',
        '5. Rerun `corepack pnpm --config.verify-deps-before-run=false launch:stripe-readonly` and confirm `stripe_webhook_endpoints_readonly` is OK.',
        '',
        '## Before And After Ledger',
        '',
        'Before this runner:',
        '',
        '- The launch package could tell the human exactly what to approve in Stripe, but the actual future update still depended on manual dashboard execution.',
        '',
        'After this runner:',
        '',
        '- The same operation is commandized behind a test-mode key check, endpoint/URL env vars, live read-only preflight, exact approval comparison, redacted captures and rollback instructions.',
        '- No external write occurs unless `--execute-approved` is passed and the approval sentence matches the live endpoint facts.',
        '',
        'Cost/benefit:',
        '',
        '- Benefit: reduces manual dashboard drift and records reversible, non-secret evidence for the Stripe webhook launch-host change.',
        '- Cost: one more launch runner and approval artifact to maintain until final payment posture is closed.',
        '',
        'Rollback:',
        '',
        '- Restore the previous endpoint URL from the redacted before-capture/dashboard evidence under a separate exact approval, then rerun Stripe read-only evidence.',
        '',
        '## Forbidden Scope',
        '',
        ...forbiddenScopeLines().map((line) => `- ${line}`),
        '',
    ].join('\n')}\n`;
}

function renderApprovalGate(report: RunnerReport): string {
    return `${[
        '# Stripe Webhook Cutover Approval Gate',
        '',
        'This file is not approval. It describes the exact gate the runner will enforce before any Stripe write.',
        '',
        '## Required Command',
        '',
        '`corepack pnpm --config.verify-deps-before-run=false launch:stripe-webhook-cutover-runner -- --execute-approved`',
        '',
        '## Required Environment',
        '',
        '- `STRIPE_SECRET_KEY`: must be a Stripe test secret key. Live keys are rejected.',
        `- \`${endpointIdEnvVar}\`: the full webhook endpoint id from Stripe Dashboard/API, supplied outside repo files.`,
        `- \`${targetUrlEnvVar}\`: exactly one HTTPS URL on an allowed launch host ending in \`${targetWebhookPath}\`.`,
        `- \`${approvalEnvVar}\`: the exact approval sentence generated from the live read-only endpoint preflight.`,
        '',
        'Allowed target hosts:',
        '',
        ...allowedTargetHosts.map((host) => `- ${host}`),
        '',
        '## Exact Sentence Shape',
        '',
        'The runner retrieves the endpoint read-only first and then compares this exact sentence shape in memory:',
        '',
        '`Apruebo cambiar en Stripe test el webhook endpoint actualmente habilitado en <CURRENT_ENDPOINT_URL> (<STRIPE_WEBHOOK_ENDPOINT_ID>) para que apunte exactamente a <STRIPE_WEBHOOK_TARGET_URL>, conservando solo los eventos <EVENTS_FROM_LIVE_PREFLIGHT>, sin tocar productos, precios, clientes, suscripciones, Stripe live mode, CHECKOUT_ENABLED, Supabase, Cloudflare, Google, Resend, Sentry ni valores de secretos, y verificar despues con corepack pnpm --config.verify-deps-before-run=false launch:stripe-readonly. No autorizo ningun otro cambio de Stripe ni servicios externos.`',
        '',
        'Do not write the full approval sentence, secret key, webhook signing secret, raw event payloads or customer/payment data into repo files, `.codex-ops`, screenshots, summaries or chat.',
        '',
        `Current runner status: ${report.closureStatus}. External write performed: ${String(report.externalWritePerformed)}.`,
        '',
    ].join('\n')}\n`;
}

function renderRollbackAfterCutover(report: RunnerReport): string {
    return `${[
        '# Stripe Webhook Cutover Rollback',
        '',
        'Rollback applies only if the runner later performs an approved Stripe webhook URL update. Plan mode performs no external write.',
        '',
        '## Rollback Steps',
        '',
        '1. Identify the prior URL from the pre-update read-only capture and Stripe Dashboard, without copying secrets or customer/payment data.',
        '2. Set `STRIPE_WEBHOOK_TARGET_URL` to that prior URL and use the same runner only after a new exact approval sentence is generated from the live read-only endpoint preflight.',
        '3. Run `corepack pnpm --config.verify-deps-before-run=false launch:stripe-webhook-cutover-runner -- --execute-approved`.',
        '4. Rerun `corepack pnpm --config.verify-deps-before-run=false launch:stripe-readonly` and confirm the intended host posture.',
        '5. If checkout/webhook traffic was exercised, reconcile Supabase `payments`, `subscriptions` and `processed_webhook_events` with redacted evidence only.',
        '',
        '## Stop Conditions',
        '',
        '- Stop if the Stripe key is live mode or the endpoint `livemode` is true.',
        '- Stop if the target host is not one of the allowed launch hosts or does not serve the intended runtime.',
        '- Stop if the operation would change enabled events, products, prices, customers, subscriptions, invoices, checkout enablement, tax, bank/payout settings or fraud rules.',
        '- Stop if any secret value, webhook signing secret, raw payload, customer data or payment method data would be stored in evidence.',
        '',
        `Latest support pack: ${toRelativeOrFallback(report.latestCutoverPackSummaryPath, 'outputs/launch-stripe-webhook-cutover-pack/<timestamp>/summary.md')}`,
        '',
    ].join('\n')}\n`;
}

function renderManualEvidenceAfterCutover(report: RunnerReport): string {
    const manifestPath = `../../${toRelative(report.commandManifestPath)}`;
    const summaryPath = `../../${toRelative(report.summaryPath)}`;
    const rollbackPath = `../../${toRelative(report.rollbackAfterCutoverPath)}`;

    return `${[
        'corepack pnpm launch:manual-evidence:record --',
        '  --id integration_readiness',
        '  --status pass',
        '  --summary "Stripe webhook test-mode launch-host cutover runner reviewed/executed with non-secret evidence."',
        '  --environment production',
        '  --owner Alin',
        `  --evidence "command_output=${summaryPath}::Stripe webhook cutover runner summary reviewed"`,
        `  --evidence "command_output=${manifestPath}::Stripe webhook cutover runner command manifest reviewed"`,
        `  --evidence "command_output=${rollbackPath}::Stripe webhook cutover rollback reviewed"`,
        '  --evidence "manual_note=Replace with concrete non-secret result: Stripe test mode, endpoint id prefix only, exact host, event set, post-cutover launch:stripe-readonly summary path, owner/date and whether the runner executed or risk was accepted."',
        '',
        '# Add --write only after replacing the placeholder note with real non-secret evidence.',
        '',
    ].join(' \\\n')}`;
}

function renderSummary(report: RunnerReport): string {
    const lines = [
        '# Stripe Webhook Cutover Runner Summary',
        '',
        `- Status: ${report.status}`,
        `- Closure: ${report.closureStatus}`,
        `- Execute requested: ${String(report.executeRequested)}`,
        `- Approval matched: ${String(report.approvalMatched)}`,
        `- External write performed: ${String(report.externalWritePerformed)}`,
        `- Latest cutover pack: ${toRelativeOrFallback(report.latestCutoverPackSummaryPath, 'missing')}`,
        `- Latest Stripe read-only evidence: ${toRelativeOrFallback(report.latestStripeReadonlySummaryPath, 'missing')}`,
        `- Command manifest: ${toRelative(report.commandManifestPath)}`,
        `- Execution plan: ${toRelative(report.executionPlanPath)}`,
        `- Approval gate: ${toRelative(report.approvalGatePath)}`,
        `- Rollback: ${toRelative(report.rollbackAfterCutoverPath)}`,
        '',
        'Plan mode is local-only. It does not connect to Stripe, does not create/update/disable/delete webhook endpoints, does not change products, prices, customers, subscriptions, checkout enablement or Stripe live mode, and does not store webhook signing secret values.',
        '',
        '| Status | Check | Message | Details |',
        '| --- | --- | --- | --- |',
        ...report.checks.map((check) => `| ${check.status} | ${check.name} | ${escapeCell(check.message)} | ${escapeCell(check.details.join(' / ') || '-')} |`),
        '',
    ];

    if (report.captures.length > 0) {
        lines.push(
            '## Captures',
            '',
            '| Status | Capture | Writes Stripe | Path |',
            '| --- | --- | --- | --- |',
            ...report.captures.map((capture) => `| ${capture.status} | ${escapeCell(capture.id)} | ${String(capture.writesStripe)} | ${escapeCell(toRelative(capture.path))} |`),
            '',
        );
    }

    return `${lines.join('\n')}\n`;
}

function validateGeneratedArtifactPosture(renderedArtifacts: RenderedArtifacts): Check {
    const combined = Object.values(renderedArtifacts).join('\n');
    const required = [
        'External write performed',
        approvalEnvVar,
        endpointIdEnvVar,
        targetUrlEnvVar,
        '--execute-approved',
        'Plan mode is local-only',
        'No Stripe live mode',
        'No product, price, customer, subscription, invoice, tax, bank/payout or fraud-rule change',
        'No webhook signing secret output or storage',
        'stripe.webhookEndpoints.update(endpointId, { url: targetUrl })',
        'rollback',
    ];
    const missing = required.filter((snippet) => !combined.includes(snippet));
    const unsafeSecretPatterns = [
        /sk_(live|test)_[A-Za-z0-9]{20,}/,
        /pk_(live|test)_[A-Za-z0-9]{20,}/,
        /whsec_[A-Za-z0-9]{20,}/,
        /(postgres|postgresql):\/\/[^\s"']+:[^\s"']+@/,
    ];
    const offenders = unsafeSecretPatterns.filter((pattern) => pattern.test(combined));

    return {
        status: missing.length === 0 && offenders.length === 0 ? 'ok' : 'failed',
        name: 'generated_artifact_posture',
        message: missing.length === 0 && offenders.length === 0
            ? 'Generated Stripe runner artifacts preserve the approval gate, URL-only write scope, rollback and no-secret posture.'
            : 'Generated Stripe runner artifacts are missing gate/scope facts or appear to include secret-like values.',
        details: [
            ...missing.map((snippet) => `missing=${snippet}`),
            ...offenders.map((pattern) => `secretPattern=${pattern}`),
        ],
    };
}

function validateTargetUrl(value: string): string[] {
    const problems: string[] = [];
    let parsed: URL;
    try {
        parsed = new URL(value);
    } catch {
        return [`${targetUrlEnvVar} must be a valid absolute URL`];
    }

    if (parsed.protocol !== 'https:') problems.push(`${targetUrlEnvVar} must use https`);
    if (!allowedTargetHosts.includes(parsed.hostname)) {
        problems.push(`${targetUrlEnvVar} host must be one of ${allowedTargetHosts.join('|')}`);
    }
    if (parsed.pathname !== targetWebhookPath) problems.push(`${targetUrlEnvVar} path must be ${targetWebhookPath}`);
    if (parsed.search || parsed.hash) problems.push(`${targetUrlEnvVar} must not include query string or hash`);
    return problems;
}

function safeEndpointUrl(value: string): string {
    try {
        const parsed = new URL(value);
        return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
    } catch {
        return 'unparseable-url';
    }
}

function safeEndpointHost(value: string): string {
    try {
        return new URL(value).hostname;
    } catch {
        return 'unparseable-host';
    }
}

function safeUrl(value: string): string {
    return safeEndpointUrl(value);
}

function normalizeUrl(value: string): string {
    return safeEndpointUrl(value).replace(/\/+$/, '');
}

function sameStringSet(left: string[], right: string[]): boolean {
    return left.length === right.length && left.every((item) => right.includes(item));
}

function compactId(id: string): string {
    if (id.length <= 12) return id;
    return `${id.slice(0, 7)}...${id.slice(-6)}`;
}

function safeErrorMessage(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    return message
        .replace(/sk_(live|test)_[A-Za-z0-9]+/g, 'sk_$1_[redacted]')
        .replace(/pk_(live|test)_[A-Za-z0-9]+/g, 'pk_$1_[redacted]')
        .replace(/whsec_[A-Za-z0-9]+/g, 'whsec_[redacted]');
}

function detailValue(details: string[] | undefined, key: string): string | null {
    const prefix = `${key}=`;
    const item = details?.find((detail) => detail.startsWith(prefix));
    return item ? item.slice(prefix.length) : null;
}

function detailList(details: string[] | undefined, key: string): string[] {
    const value = detailValue(details, key);
    if (!value || value === 'none') return [];
    return value.split('|').map((item) => item.trim()).filter(Boolean);
}

function latestGeneratedPath(folderName: string, fileName: string): string | null {
    const root = path.join(process.cwd(), 'outputs', folderName);
    if (!existsSync(root)) return null;

    const candidates = readdirSync(root, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(root, entry.name, fileName))
        .filter((candidate) => existsSync(candidate))
        .sort()
        .reverse();

    return candidates[0] ?? null;
}

function readJsonIfExists<T>(file: string | null): T | null {
    if (!file || !existsSync(file)) return null;
    try {
        return JSON.parse(readFileSync(file, 'utf8')) as T;
    } catch {
        return null;
    }
}

function readIfExists(filePath: string): string | null {
    return existsSync(filePath) ? readFileSync(filePath, 'utf8') : null;
}

function forbiddenScopeLines(): string[] {
    return [
        'No Stripe live mode',
        'No product, price, customer, subscription, invoice, tax, bank/payout or fraud-rule change',
        'No CHECKOUT_ENABLED change',
        'No enabled_events change',
        'No webhook signing secret output or storage',
        'No raw Stripe event payload, customer data, payment method data or card data in evidence',
        'No Supabase, Cloudflare, Google, Resend, Sentry, Turnstile, DNS, Pages, Worker or GitHub writes',
        'No checkout session creation, real payment, email send, Google event creation or final smoke',
    ];
}

function statusFor(checkList: Check[]): ReportStatus {
    if (checkList.some((check) => check.status === 'failed')) return 'FAILED';
    if (checkList.some((check) => check.status === 'warning')) return 'WARNING';
    return 'OK';
}

function stamp(date: Date): string {
    return date.toISOString().replace(/[:.]/g, '-');
}

function toRelative(filePath: string): string {
    return toPosix(path.relative(process.cwd(), filePath));
}

function toRelativeOrNull(filePath: string | null): string | null {
    return filePath ? toRelative(filePath) : null;
}

function toRelativeOrFallback(filePath: string | null, fallback: string): string {
    return filePath ? toRelative(filePath) : fallback;
}

function toPosix(filePath: string): string {
    return filePath.split(path.sep).join('/');
}

function escapeCell(value: string): string {
    return value.replace(/\|/g, '\\|').replace(/\n/g, '<br>');
}
