import * as dotenv from 'dotenv';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import Stripe from 'stripe';
import {
    createExternalWriteReceipt,
    markExternalWriteAmbiguous,
    markExternalWriteAttemptStarted,
    markExternalWriteConfirmed,
    requireReadonlyReconciliation,
    type ExternalWriteOutcome,
    type ExternalWritePerformed,
} from './external-write-receipt';
import {
    buildStripeWebhookCutoverApprovalSentence,
    classifyStripeWebhookCutoverEvidence,
    evaluatePreExecutionChecks,
    sha256Hex,
    validateStructuredCutoverPackSummary,
    type StripeReadonlySummaryLike,
    type StripeWebhookCutoverPackSummaryLike,
} from './stripe-webhook-cutover-shared';
import {
    beginStripeCutoverRecovery,
    blockStripeCutoverRecovery,
    finishStripeCutoverRecovery,
    markStripeCutoverProviderResult,
    openStripeCutoverExecutionGuard,
    persistStripeCutoverWriteAhead,
    releaseStripeCutoverPrewriteGuard,
    resolveStripeCutoverExecution,
    stripeCutoverScopeHash,
    type StripeCutoverExecutionGuard,
    type StripeCutoverPersistentState,
} from './stripe-webhook-cutover-state';

type CheckStatus = 'ok' | 'warning' | 'failed';
type ReportStatus = 'OK' | 'WARNING' | 'FAILED';
type ClosureStatus =
    | 'PLAN_ONLY_READY'
    | 'APPROVAL_PREPARED_GET_ONLY'
    | 'RECOVERY_RESOLVED_GET_ONLY'
    | 'RECOVERY_BLOCKED_GET_ONLY'
    | 'EXECUTED_AND_NEEDS_REVIEW'
    | 'BLOCKED_BY_GATE_OR_ARTIFACTS'
    | 'NEEDS_READONLY_RECONCILIATION_OR_ROLLBACK';

interface Check {
    status: CheckStatus;
    name: string;
    message: string;
    details: string[];
}

interface EndpointSnapshot {
    idSha256: string;
    url: string;
    host: string;
    urlShapeSafe: boolean;
    status: string | null;
    livemode: boolean;
    enabledEvents: string[];
    apiVersion: string | null;
    descriptionPresent: boolean;
    descriptionSha256: string | null;
}

interface AccountSnapshot {
    idSha256: string;
    country: string;
    defaultCurrency: string;
    chargesEnabled: boolean;
    payoutsEnabled: boolean;
}

interface ExecutionCapture {
    id: string;
    status: CheckStatus;
    writesStripe: boolean;
    path: string;
    description: string;
}

interface RunnerReport {
    schemaVersion: 2;
    startedAt: string;
    endedAt: string;
    status: ReportStatus;
    closureStatus: ClosureStatus;
    outputDir: string;
    stripeModePolicy: 'test-only';
    approvalEnvVar: string;
    prepareApprovalRequested: boolean;
    executeRequested: boolean;
    approvalPrepared: boolean;
    approvalMatched: boolean;
    externalWriteAttempted: boolean;
    externalWritePerformed: ExternalWritePerformed;
    externalWriteOutcome: ExternalWriteOutcome;
    readonlyReconciliationRequired: boolean;
    externalWriteReceiptPath: string;
    targetWebhookPath: string;
    allowedTargetHosts: string[];
    requiredEnv: string[];
    latestCutoverPackSummaryPath: string | null;
    latestCutoverPackStructuredSummaryPath: string | null;
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
    expectedAccountId: string;
    endpointId: string;
    targetUrl: string;
    approvalSentence: string;
}

interface PreparationEnv {
    stripeSecretKey: string;
    expectedAccountId: string;
    endpointId: string;
    targetUrl: string;
}

const approvalEnvVar = 'STRIPE_WEBHOOK_CUTOVER_APPROVAL';
const expectedAccountIdEnvVar = 'STRIPE_EXPECTED_ACCOUNT_ID';
const endpointIdEnvVar = 'STRIPE_WEBHOOK_ENDPOINT_ID';
const targetUrlEnvVar = 'STRIPE_WEBHOOK_TARGET_URL';
const preparationRequiredEnv = ['STRIPE_SECRET_KEY', expectedAccountIdEnvVar, endpointIdEnvVar, targetUrlEnvVar];
const requiredEnv = [...preparationRequiredEnv, approvalEnvVar];
const targetWebhookPath = '/api/stripe-webhook';
const allowedTargetHosts = ['staging.espanolhonesto.com', 'espanolhonesto.com', 'www.espanolhonesto.com'];
const prepareApprovalRequested = process.argv.includes('--prepare-approval');
const executeRequested = process.argv.includes('--execute-approved');
const runnerRunId = randomUUID();

const startedAt = new Date();
const outputDir = path.join(process.cwd(), 'outputs', 'launch-stripe-webhook-cutover-runner', stamp(startedAt));
mkdirSync(outputDir, { recursive: true });
const externalWriteReceiptPath = path.join(outputDir, 'external-write-receipt.json');
let externalWriteReceipt = createExternalWriteReceipt();

const latestCutoverPackSummaryPath = latestGeneratedPath('launch-stripe-webhook-cutover-pack', 'summary.md');
const latestCutoverPackStructuredSummaryPath = latestGeneratedPath('launch-stripe-webhook-cutover-pack', 'summary.json');
const latestCutoverPackApprovalPath = latestGeneratedPath('launch-stripe-webhook-cutover-pack', 'approval-request.md');
const latestCutoverPackVerificationPath = latestGeneratedPath('launch-stripe-webhook-cutover-pack', 'verification-checklist.md');
const latestCutoverPackRollbackPath = latestGeneratedPath('launch-stripe-webhook-cutover-pack', 'rollback-plan.md');
const latestStripeReadonlySummaryPath = latestGeneratedPath('launch-stripe-readonly-evidence', 'summary.json');
const latestStripeReadonlySummary = readJsonIfExists<StripeReadonlySummaryLike>(latestStripeReadonlySummaryPath);
const latestCutoverPackStructuredSummary = readJsonIfExists<StripeWebhookCutoverPackSummaryLike>(latestCutoverPackStructuredSummaryPath);

const captures: ExecutionCapture[] = [];
const checks: Check[] = [
    validatePackageScript(),
    validateCutoverPack(),
    validateStripeReadonlyEvidence(),
    validateApprovalGateSource(),
    validateForbiddenScopeSource(),
];

let approvalMatched = false;
let approvalPrepared = false;
let preparedApprovalSentence: string | null = null;
let recoveryOnlyStatus: 'resolved' | 'blocked' | null = null;

await main();

async function main(): Promise<void> {
    if (prepareApprovalRequested && executeRequested) {
        checks.push({
            status: 'failed',
            name: 'runner_mode_gate',
            message: 'GET-only approval preparation and approved execution are mutually exclusive.',
            details: ['choose_exactly_one=--prepare-approval|--execute-approved', 'externalWriteAttempted=false'],
        });
    } else if (prepareApprovalRequested) {
        dotenv.config({ path: '.env', quiet: true });
        const env = validatePreparationEnv();
        checks.push(env.check);
        const preExecutionGate = addPreExecutionGate('approval preparation');

        if (env.value && preExecutionGate.acceptable) {
            const preparation = await runApprovalPreparation(env.value, captures);
            checks.push(...preparation.checks);
            preparedApprovalSentence = preparation.approvalSentence;
            approvalPrepared = Boolean(preparedApprovalSentence);
        }
    } else if (executeRequested) {
        dotenv.config({ path: '.env', quiet: true });
        const env = validateExecutionEnv();
        checks.push(env.check);
        const preExecutionGate = addPreExecutionGate('approved execution');

        if (env.value && preExecutionGate.acceptable) {
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
                'prepareApprovalRequested=false',
                'externalWritePerformed=false',
                `futureGate=${approvalEnvVar}`,
                'preparationFlag=--prepare-approval',
                'futureFlag=--execute-approved',
            ],
        });
    }

    persistExternalWriteReceipt('run_checks_complete');

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
    console.log(`[launch:stripe-webhook-cutover-runner] External write attempted: ${report.externalWriteAttempted}`);
    console.log(`[launch:stripe-webhook-cutover-runner] External write performed: ${report.externalWritePerformed}`);
    console.log(`[launch:stripe-webhook-cutover-runner] External write outcome: ${report.externalWriteOutcome}`);
    console.log(`[launch:stripe-webhook-cutover-runner] Read-only reconciliation required: ${report.readonlyReconciliationRequired}`);
    console.log(`[launch:stripe-webhook-cutover-runner] Summary: ${report.summaryPath}`);
    console.log(`[launch:stripe-webhook-cutover-runner] Execution plan: ${report.executionPlanPath}`);
    console.log(`[launch:stripe-webhook-cutover-runner] Approval gate: ${report.approvalGatePath}`);
    console.log(`[launch:stripe-webhook-cutover-runner] Rollback: ${report.rollbackAfterCutoverPath}`);

    if (failed.length > 0) process.exit(1);
}

function addPreExecutionGate(purpose: string) {
    const result = evaluatePreExecutionChecks(checks);
    checks.push({
        status: result.acceptable ? 'ok' : 'failed',
        name: 'pre_execution_checks_gate',
        message: result.acceptable
            ? `All static, structured-evidence and environment checks are acceptable before ${purpose}.`
            : `${purpose} is blocked because one or more pre-execution checks are not acceptable.`,
        details: result.acceptable
            ? ['all_pre_execution_checks=acceptable']
            : [
                ...result.blockingChecks.map((check) => `blocking=${check}`),
                'externalWriteAttempted=false',
            ],
    });
    return result;
}

function createReport(reportChecks: Check[], reportCaptures: ExecutionCapture[]): RunnerReport {
    const reportStatus = statusFor(reportChecks);

    return {
        schemaVersion: 2,
        startedAt: startedAt.toISOString(),
        endedAt: new Date().toISOString(),
        status: reportStatus,
        closureStatus: recoveryOnlyStatus === 'blocked'
            ? 'RECOVERY_BLOCKED_GET_ONLY'
            : recoveryOnlyStatus === 'resolved'
                ? 'RECOVERY_RESOLVED_GET_ONLY'
        : externalWriteReceipt.readonlyReconciliationRequired
            ? 'NEEDS_READONLY_RECONCILIATION_OR_ROLLBACK'
            : reportStatus === 'FAILED'
            ? 'BLOCKED_BY_GATE_OR_ARTIFACTS'
            : prepareApprovalRequested && approvalPrepared
                ? 'APPROVAL_PREPARED_GET_ONLY'
            : executeRequested
                ? 'EXECUTED_AND_NEEDS_REVIEW'
                : 'PLAN_ONLY_READY',
        outputDir,
        stripeModePolicy: 'test-only',
        approvalEnvVar,
        prepareApprovalRequested,
        executeRequested,
        approvalPrepared,
        approvalMatched,
        ...externalWriteReceipt,
        externalWriteReceiptPath,
        targetWebhookPath,
        allowedTargetHosts,
        requiredEnv,
        latestCutoverPackSummaryPath,
        latestCutoverPackStructuredSummaryPath,
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
    if (
        !latestCutoverPackSummaryPath
        || !latestCutoverPackStructuredSummaryPath
        || !latestCutoverPackApprovalPath
        || !latestCutoverPackVerificationPath
        || !latestCutoverPackRollbackPath
    ) {
        return {
            status: 'failed',
            name: 'cutover_pack_exists',
            message: 'The complete structured Stripe webhook cutover pack must exist before using the gated runner.',
            details: ['run=pnpm --config.verify-deps-before-run=false launch:stripe-webhook-cutover-pack'],
        };
    }

    const artifactPaths = [
        latestCutoverPackSummaryPath,
        latestCutoverPackStructuredSummaryPath,
        latestCutoverPackApprovalPath,
        latestCutoverPackVerificationPath,
        latestCutoverPackRollbackPath,
    ];
    const packDirectory = path.dirname(latestCutoverPackStructuredSummaryPath);
    const problems = validateStructuredCutoverPackSummary(
        latestCutoverPackStructuredSummary,
        latestStripeReadonlySummaryPath ? toRelative(latestStripeReadonlySummaryPath) : null,
    );
    if (artifactPaths.some((artifactPath) => path.dirname(artifactPath) !== packDirectory)) {
        problems.push('cutover_pack_artifacts_do_not_share_one_output_directory');
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
        '--prepare-approval',
        'Endpoint id SHA-256',
        'Do not switch to Stripe live mode.',
        'Do not create or edit products, prices, customers, subscriptions, invoices, tax settings, bank/payout settings or fraud rules.',
        'webhook signing secret',
        'rollback',
    ];
    const missing = required.filter((snippet) => !combined.includes(snippet));
    problems.push(...missing.map((snippet) => `missing=${snippet}`));

    return {
        status: problems.length === 0 ? 'ok' : 'failed',
        name: 'cutover_pack_exists',
        message: problems.length === 0
            ? 'Latest Stripe cutover pack has a structured ready status, current read-only lineage, one artifact directory and the required safety posture.'
            : 'Latest Stripe cutover pack is failed, stale, structurally inconsistent, or missing required safety facts.',
        details: problems.length === 0
            ? [
                `summary=${toRelative(latestCutoverPackSummaryPath)}`,
                `structuredSummary=${toRelative(latestCutoverPackStructuredSummaryPath)}`,
                `approval=${toRelative(latestCutoverPackApprovalPath)}`,
                `verification=${toRelative(latestCutoverPackVerificationPath)}`,
                `rollback=${toRelative(latestCutoverPackRollbackPath)}`,
            ]
            : problems,
    };
}

function validateStripeReadonlyEvidence(): Check {
    if (!latestStripeReadonlySummaryPath || !latestStripeReadonlySummary) {
        return {
            status: 'failed',
            name: 'stripe_readonly_evidence_exists',
            message: 'Stripe read-only evidence is missing before preparing a write-capable runner.',
            details: ['run=pnpm --config.verify-deps-before-run=false launch:stripe-readonly'],
        };
    }

    const classification = classifyStripeWebhookCutoverEvidence(latestStripeReadonlySummary);
    const hostOnlyDrift = classification.state === 'HOST_ONLY_DRIFT';

    return {
        status: hostOnlyDrift ? 'ok' : 'failed',
        name: 'stripe_readonly_evidence_exists',
        message: hostOnlyDrift
            ? 'Latest Stripe read-only evidence proves test mode and a strict host-only drift with the exact current webhook event scope.'
            : 'Latest Stripe read-only evidence is not the strict host-only drift required for a gated test-mode webhook cutover.',
        details: hostOnlyDrift
            ? [
                `summary=${toRelative(latestStripeReadonlySummaryPath)}`,
                `status=${latestStripeReadonlySummary.status ?? 'unknown'}`,
                `stripeMode=${latestStripeReadonlySummary.stripeMode}`,
                `currentHosts=${classification.currentHosts.join('|')}`,
                `expectedHosts=${classification.expectedHosts.join('|')}`,
                `events=${classification.enabledEvents.join('|')}`,
            ]
            : classification.reasons,
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
        '--prepare-approval',
        '--execute-approved',
        'runApprovalPreparation',
        'runApprovedExecution',
        'buildExactApprovalSentence',
        'buildStripeWebhookCutoverApprovalSentence',
        'sha256Hex',
        'descriptionPresent',
        'descriptionSha256',
        'maxNetworkRetries: 0',
        'persistStripeCutoverWriteAhead',
        'beginStripeCutoverRecovery',
        'accountIdSha256',
        'stripe.webhookEndpoints.retrieve',
        'stripe.webhookEndpoints.update',
        "stripeSecretKey.startsWith('sk_test_')",
        "stripeSecretKey.startsWith('sk_live_')",
        'endpoint.livemode === false',
        'markExternalWriteAttemptStarted',
        'persistExternalWriteReceipt',
        'externalWriteAttempted',
        'externalWriteOutcome',
        'ambiguous_needs_readonly_reconciliation',
        'readonlyReconciliationRequired',
        'externalWritePerformed=false',
    ];
    const missing = required.filter((snippet) => !source.includes(snippet));

    return {
        status: missing.length === 0 ? 'ok' : 'failed',
        name: 'approval_gate_source',
        message: missing.length === 0
            ? 'Runner source contains account-bound GET-only approval preparation, zero-retry write, persistent recovery guard and URL-only update branch.'
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

function validatePreparationEnv(): { check: Check; value: PreparationEnv | null } {
    const stripeSecretKey = process.env.STRIPE_SECRET_KEY ?? '';
    const expectedAccountId = process.env[expectedAccountIdEnvVar] ?? '';
    const endpointId = process.env[endpointIdEnvVar] ?? '';
    const targetUrl = process.env[targetUrlEnvVar] ?? '';
    const missing = preparationRequiredEnv.filter((name) => !process.env[name]);
    const problems = validateRuntimeEnvValues(stripeSecretKey, expectedAccountId, endpointId, targetUrl, missing);

    return {
        check: {
            status: problems.length === 0 ? 'ok' : 'failed',
            name: 'approval_preparation_env_shape',
            message: problems.length === 0
                ? 'GET-only approval preparation has a Stripe test key, endpoint id and allowed target URL.'
                : 'GET-only approval preparation is missing required values or attempts a forbidden Stripe mode/target.',
            details: problems.length === 0
                ? [
                    'stripeKeyMode=test',
                    `expectedAccountIdSha256=${sha256Hex(expectedAccountId)}`,
                    `endpointIdSha256=${sha256Hex(endpointId)}`,
                    `targetUrl=${safeUrl(targetUrl)}`,
                    'externalWriteAttempted=false',
                ]
                : problems,
        },
        value: problems.length === 0 ? { stripeSecretKey, expectedAccountId, endpointId, targetUrl } : null,
    };
}

function validateExecutionEnv(): { check: Check; value: ExecutionEnv | null } {
    const stripeSecretKey = process.env.STRIPE_SECRET_KEY ?? '';
    const expectedAccountId = process.env[expectedAccountIdEnvVar] ?? '';
    const endpointId = process.env[endpointIdEnvVar] ?? '';
    const targetUrl = process.env[targetUrlEnvVar] ?? '';
    const approvalSentence = process.env[approvalEnvVar] ?? '';
    const missing = requiredEnv.filter((name) => !process.env[name]);
    const problems = validateRuntimeEnvValues(stripeSecretKey, expectedAccountId, endpointId, targetUrl, missing);

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
                    `expectedAccountIdSha256=${sha256Hex(expectedAccountId)}`,
                    `endpointIdSha256=${sha256Hex(endpointId)}`,
                    `targetUrl=${safeUrl(targetUrl)}`,
                    `approvalProvided=${String(Boolean(approvalSentence))}`,
                ]
                : problems,
        },
        value: problems.length === 0
            ? { stripeSecretKey, expectedAccountId, endpointId, targetUrl, approvalSentence }
            : null,
    };
}

function validateRuntimeEnvValues(
    stripeSecretKey: string,
    expectedAccountId: string,
    endpointId: string,
    targetUrl: string,
    missing: string[],
): string[] {
    const problems = [...missing.map((name) => `missing=${name}`)];
    if (stripeSecretKey && !stripeSecretKey.startsWith('sk_test_')) {
        problems.push('STRIPE_SECRET_KEY must be a Stripe test secret key');
    }
    if (stripeSecretKey.startsWith('sk_live_')) {
        problems.push('STRIPE_SECRET_KEY live mode is explicitly forbidden');
    }
    if (expectedAccountId && !/^acct_[A-Za-z0-9]+$/u.test(expectedAccountId)) {
        problems.push(`${expectedAccountIdEnvVar} must look like a Stripe account id`);
    }
    if (endpointId && !/^we_[A-Za-z0-9]+$/.test(endpointId)) {
        problems.push(`${endpointIdEnvVar} must look like a Stripe webhook endpoint id`);
    }
    const targetValidation = validateTargetUrl(targetUrl);
    if (targetUrl && targetValidation.length > 0) problems.push(...targetValidation);
    return problems;
}

async function runApprovalPreparation(
    env: PreparationEnv,
    reportCaptures: ExecutionCapture[],
): Promise<{ checks: Check[]; approvalSentence: string | null }> {
    const preparationChecks: Check[] = [];
    const stripe = new Stripe(env.stripeSecretKey, {
        apiVersion: '2026-02-25.clover',
        maxNetworkRetries: 0,
    });

    const account = await captureStripeAccount(stripe, env.expectedAccountId, reportCaptures);
    preparationChecks.push(account.check);
    if (!account.snapshot || account.check.status === 'failed') {
        return { checks: preparationChecks, approvalSentence: null };
    }

    const recovery = await runPersistentRecovery(
        stripe,
        account.snapshot,
        env.endpointId,
        reportCaptures,
    );
    preparationChecks.push(...recovery.checks);
    if (recovery.terminal) return { checks: preparationChecks, approvalSentence: null };

    const before = await retrieveEndpoint(stripe, env.endpointId, 'stripe_endpoint_approval_preparation_get_only', reportCaptures);
    preparationChecks.push(before.check);
    if (!before.snapshot || before.check.status === 'failed') {
        return { checks: preparationChecks, approvalSentence: null };
    }

    const endpointScopeCheck = validateEndpointScope(before.snapshot);
    preparationChecks.push(endpointScopeCheck);
    if (endpointScopeCheck.status === 'failed') return { checks: preparationChecks, approvalSentence: null };

    const approvalSentence = buildExactApprovalSentence(account.snapshot, before.snapshot, env.targetUrl);
    const capture = writeExecutionCapture(
        'stripe_exact_approval_prepared_get_only',
        'ok',
        false,
        'GET-only approval preparation stores endpoint identity only as SHA-256 and never stores the full endpoint id or free-form description.',
        {
            endpointIdSha256: before.snapshot.idSha256,
            accountIdSha256: account.snapshot.idSha256,
            from: before.snapshot.url,
            to: safeUrl(env.targetUrl),
            events: before.snapshot.enabledEvents,
            approvalSentenceSha256: sha256Hex(approvalSentence),
            externalWriteAttempted: false,
        },
    );
    reportCaptures.push(capture);
    preparationChecks.push({
        status: 'ok',
        name: 'stripe_exact_approval_prepared_get_only',
        message: 'Exactly one executable approval sentence was prepared from live GET-only endpoint facts and a SHA-256 endpoint identity.',
        details: [
            `capture=${capture.path}`,
            `endpointIdSha256=${before.snapshot.idSha256}`,
            `approvalSentenceSha256=${sha256Hex(approvalSentence)}`,
            'externalWriteAttempted=false',
        ],
    });
    return { checks: preparationChecks, approvalSentence };
}

async function runApprovedExecution(env: ExecutionEnv, reportCaptures: ExecutionCapture[]): Promise<Check[]> {
    const executionChecks: Check[] = [];
    const stripe = new Stripe(env.stripeSecretKey, {
        apiVersion: '2026-02-25.clover',
        maxNetworkRetries: 0,
    });

    const account = await captureStripeAccount(stripe, env.expectedAccountId, reportCaptures);
    executionChecks.push(account.check);
    if (!account.snapshot || account.check.status === 'failed') return executionChecks;

    const recovery = await runPersistentRecovery(
        stripe,
        account.snapshot,
        env.endpointId,
        reportCaptures,
    );
    executionChecks.push(...recovery.checks);
    if (recovery.terminal) return executionChecks;

    const scopeHash = stripeCutoverScopeHash(account.snapshot.idSha256, sha256Hex(env.endpointId));
    let guard: StripeCutoverExecutionGuard;
    try {
        guard = openStripeCutoverExecutionGuard(scopeHash, runnerRunId);
    } catch (error) {
        executionChecks.push({
            status: 'failed',
            name: 'stripe_persistent_write_guard',
            message: 'Persistent Stripe write guard could not be acquired; no update was attempted.',
            details: [safeErrorMessage(error), 'externalWriteAttempted=false'],
        });
        return executionChecks;
    }

    const before = await retrieveEndpoint(stripe, env.endpointId, 'stripe_endpoint_before_update_readonly', reportCaptures);
    executionChecks.push(before.check);
    if (!before.snapshot || before.check.status === 'failed') {
        releaseStripeCutoverPrewriteGuard(guard);
        return executionChecks;
    }

    const endpointScopeCheck = validateEndpointScope(before.snapshot);
    executionChecks.push(endpointScopeCheck);
    if (endpointScopeCheck.status === 'failed') {
        releaseStripeCutoverPrewriteGuard(guard);
        return executionChecks;
    }

    const exactApprovalSentence = buildExactApprovalSentence(account.snapshot, before.snapshot, env.targetUrl);
    const exactApprovalGate: Check = {
        status: env.approvalSentence === exactApprovalSentence ? 'ok' : 'failed',
        name: 'exact_approval_gate',
        message: env.approvalSentence === exactApprovalSentence
            ? 'Exact approval sentence matched; only the Stripe test-mode webhook URL update can run.'
            : 'Execution was requested but the exact approval gate did not match, so no Stripe webhook update can run.',
        details: env.approvalSentence === exactApprovalSentence
            ? [
                `env=${approvalEnvVar}`,
                `endpointIdSha256=${before.snapshot.idSha256}`,
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
    if (exactApprovalGate.status === 'failed') {
        releaseStripeCutoverPrewriteGuard(guard);
        return executionChecks;
    }

    if (normalizeUrl(before.snapshot.url) === normalizeUrl(env.targetUrl)) {
        executionChecks.push({
            status: 'warning',
            name: 'target_url_already_active',
            message: 'The Stripe webhook endpoint already points at the requested target URL; no update call was made.',
            details: [
                `endpointIdSha256=${before.snapshot.idSha256}`,
                `targetUrl=${safeUrl(env.targetUrl)}`,
                'externalWritePerformed=false',
            ],
        });
        releaseStripeCutoverPrewriteGuard(guard);
        return executionChecks;
    }

    let persistentState: StripeCutoverPersistentState;
    try {
        persistentState = persistStripeCutoverWriteAhead(guard, {
            accountIdSha256: account.snapshot.idSha256,
            endpointIdSha256: before.snapshot.idSha256,
            priorUrl: before.snapshot.url,
            targetUrl: safeUrl(env.targetUrl),
            enabledEvents: before.snapshot.enabledEvents,
            approvalSentenceSha256: sha256Hex(exactApprovalSentence),
        });
    } catch (error) {
        executionChecks.push({
            status: 'failed',
            name: 'stripe_write_ahead_intent',
            message: 'Durable Stripe write-ahead intent could not be persisted; no update was attempted.',
            details: [safeErrorMessage(error), 'externalWriteAttempted=false'],
        });
        return executionChecks;
    }

    externalWriteReceipt = markExternalWriteAttemptStarted(externalWriteReceipt);
    persistExternalWriteReceipt('update_started_awaiting_provider_confirmation');

    let updated: Stripe.WebhookEndpoint;
    try {
        updated = await stripe.webhookEndpoints.update(env.endpointId, { url: env.targetUrl });
        externalWriteReceipt = markExternalWriteConfirmed(externalWriteReceipt, true);
        persistExternalWriteReceipt('update_provider_success_confirmed');
    } catch (error) {
        try {
            persistentState = markStripeCutoverProviderResult(guard, persistentState, 'ambiguous');
        } catch {
            // The durable write-ahead state and execution lock remain fail-closed.
        }
        externalWriteReceipt = markExternalWriteAmbiguous(externalWriteReceipt);
        persistExternalWriteReceipt('update_error_or_timeout_outcome_ambiguous');
        const capture = writeExecutionCapture(
            'stripe_endpoint_url_update',
            'failed',
            true,
            'Stripe webhook endpoint URL update returned an error after the update started; outcome is ambiguous until read-only reconciliation.',
            {
                error: safeErrorMessage(error),
                externalWriteAttempted: true,
                externalWritePerformed: 'unknown',
                externalWriteOutcome: externalWriteReceipt.externalWriteOutcome,
                readonlyReconciliationRequired: true,
            },
        );
        reportCaptures.push(capture);
        executionChecks.push({
            status: 'failed',
            name: 'stripe_webhook_endpoint_url_updated',
            message: 'Stripe test-mode webhook endpoint update errored after the write started; it may have landed and must be reconciled read-only before rollback or retry.',
            details: [
                `capture=${capture.path}`,
                `receipt=${externalWriteReceiptPath}`,
                'externalWriteAttempted=true',
                'externalWritePerformed=unknown',
                `externalWriteOutcome=${externalWriteReceipt.externalWriteOutcome}`,
                'required=read-only endpoint reconciliation and rollback decision before retry',
                safeErrorMessage(error),
            ],
        });
        return executionChecks;
    }

    try {
        persistentState = markStripeCutoverProviderResult(guard, persistentState, 'succeeded');
    } catch (error) {
        externalWriteReceipt = requireReadonlyReconciliation(externalWriteReceipt);
        persistExternalWriteReceipt('provider_succeeded_but_persistent_state_update_failed');
        executionChecks.push({
            status: 'failed',
            name: 'stripe_persistent_provider_result',
            message: 'Stripe returned success, but durable state could not advance; GET-only recovery is required.',
            details: [safeErrorMessage(error), 'required=read-only endpoint reconciliation before retry'],
        });
        return executionChecks;
    }

    const snapshot = snapshotEndpoint(updated);
    const capture = writeExecutionCapture(
        'stripe_endpoint_url_update',
        'ok',
        true,
        'Stripe webhook endpoint URL update result, redacted to endpoint identity hashes and non-secret metadata.',
        snapshot,
    );
    reportCaptures.push(capture);
    executionChecks.push({
        status: 'ok',
        name: 'stripe_webhook_endpoint_url_updated',
        message: 'Stripe test-mode webhook endpoint URL was updated and captured without secret values.',
        details: [
            `capture=${capture.path}`,
            `receipt=${externalWriteReceiptPath}`,
            `externalWriteAttempted=${String(externalWriteReceipt.externalWriteAttempted)}`,
            `externalWritePerformed=${String(externalWriteReceipt.externalWritePerformed)}`,
            `externalWriteOutcome=${externalWriteReceipt.externalWriteOutcome}`,
            `endpointIdSha256=${snapshot.idSha256}`,
            `targetUrl=${safeUrl(snapshot.url)}`,
            `events=${snapshot.enabledEvents.join('|')}`,
        ],
    });

    const after = await retrieveEndpoint(stripe, env.endpointId, 'stripe_endpoint_after_update_readonly', reportCaptures);
    executionChecks.push(after.check);
    if (!after.snapshot || after.check.status === 'failed') {
        try {
            persistentState = markStripeCutoverProviderResult(guard, persistentState, 'ambiguous');
        } catch {
            // Existing provider-success state and execution lock remain fail-closed.
        }
        externalWriteReceipt = requireReadonlyReconciliation(externalWriteReceipt);
        persistExternalWriteReceipt('post_update_readonly_reconciliation_failed');
        return executionChecks;
    }

    const afterChecks = [
        normalizeUrl(after.snapshot.url) === normalizeUrl(env.targetUrl),
        after.snapshot.livemode === false,
        after.snapshot.status === 'enabled',
        sameStringSet(after.snapshot.enabledEvents, before.snapshot.enabledEvents),
    ];
    const verificationPassed = afterChecks.every(Boolean);
    executionChecks.push({
        status: verificationPassed ? 'ok' : 'failed',
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
    if (!verificationPassed) {
        try {
            persistentState = markStripeCutoverProviderResult(guard, persistentState, 'ambiguous');
        } catch {
            // Existing provider-success state and execution lock remain fail-closed.
        }
        externalWriteReceipt = requireReadonlyReconciliation(externalWriteReceipt);
        persistExternalWriteReceipt('post_update_readonly_invariants_failed');
    } else {
        try {
            resolveStripeCutoverExecution(guard, persistentState, 'resolved_target');
        } catch (error) {
            externalWriteReceipt = requireReadonlyReconciliation(externalWriteReceipt);
            persistExternalWriteReceipt('post_update_state_resolution_failed');
            executionChecks.push({
                status: 'failed',
                name: 'stripe_persistent_state_resolution',
                message: 'Post-update readback passed, but persistent state/lock resolution failed closed.',
                details: [safeErrorMessage(error), 'required=GET-only persistent-state recovery'],
            });
            return executionChecks;
        }
        persistExternalWriteReceipt('post_update_readonly_verified');
    }

    return executionChecks;
}

async function runPersistentRecovery(
    stripe: Stripe,
    account: AccountSnapshot,
    endpointId: string,
    reportCaptures: ExecutionCapture[],
): Promise<{ terminal: boolean; checks: Check[] }> {
    const endpointIdSha256 = sha256Hex(endpointId);
    const scopeHash = stripeCutoverScopeHash(account.idSha256, endpointIdSha256);
    const recovery = beginStripeCutoverRecovery(scopeHash, runnerRunId);
    if (recovery.status === 'not_needed') return { terminal: false, checks: [] };

    if (recovery.status === 'blocked') {
        recoveryOnlyStatus = 'blocked';
        return {
            terminal: true,
            checks: [{
                status: 'failed',
                name: 'stripe_persistent_recovery_gate',
                message: 'Persistent Stripe state or lock is unresolved; this invocation is terminal and cannot update Stripe.',
                details: [recovery.reason, `scopeHash=${scopeHash}`, 'externalWriteAttempted=false'],
            }],
        };
    }

    if (recovery.status === 'terminal_lock_only_recovered') {
        recoveryOnlyStatus = 'resolved';
        return {
            terminal: true,
            checks: [{
                status: 'ok',
                name: 'stripe_persistent_lock_only_recovery',
                message: 'A definitely-dead pre-write lock was recovered locally; this invocation is terminal and made no Stripe update.',
                details: [recovery.reason, `scopeHash=${scopeHash}`, 'externalWriteAttempted=false'],
            }],
        };
    }

    const readback = await retrieveEndpoint(
        stripe,
        endpointId,
        'stripe_endpoint_persistent_recovery_get_only',
        reportCaptures,
    );
    if (!readback.snapshot || readback.check.status === 'failed') {
        try {
            blockStripeCutoverRecovery(recovery.session);
        } catch {
            // Persistent recovery locks remain fail-closed if local state cannot advance.
        }
        recoveryOnlyStatus = 'blocked';
        return {
            terminal: true,
            checks: [
                readback.check,
                {
                    status: 'failed',
                    name: 'stripe_persistent_recovery_readback',
                    message: 'GET-only recovery could not read the endpoint; the persistent guard remains blocked.',
                    details: [`scopeHash=${scopeHash}`, 'externalWriteAttempted=false', 'retryUpdate=false'],
                },
            ],
        };
    }

    if (readback.snapshot.idSha256 !== endpointIdSha256) {
        try {
            blockStripeCutoverRecovery(recovery.session);
        } catch {
            // Persistent recovery locks remain fail-closed if local state cannot advance.
        }
        recoveryOnlyStatus = 'blocked';
        return {
            terminal: true,
            checks: [{
                status: 'failed',
                name: 'stripe_persistent_recovery_identity',
                message: 'GET-only recovery endpoint identity did not match the guarded endpoint hash.',
                details: [`scopeHash=${scopeHash}`, 'externalWriteAttempted=false', 'retryUpdate=false'],
            }],
        };
    }

    try {
        const result = finishStripeCutoverRecovery(recovery.session, {
            url: readback.snapshot.url,
            livemode: readback.snapshot.livemode,
            status: readback.snapshot.status,
            enabledEvents: readback.snapshot.enabledEvents,
        });
        recoveryOnlyStatus = result.status === 'ambiguous' ? 'blocked' : 'resolved';
        const capture = writeExecutionCapture(
            'stripe_persistent_recovery_result',
            result.status === 'ambiguous' ? 'failed' : 'ok',
            false,
            'Terminal GET-only persistent-state recovery; it never retries the Stripe update.',
            {
                scopeHash,
                accountIdSha256: account.idSha256,
                endpointIdSha256,
                result: result.status,
                terminal: true,
                externalWriteAttempted: false,
                retryUpdate: false,
            },
        );
        reportCaptures.push(capture);
        return {
            terminal: true,
            checks: [
                readback.check,
                {
                    status: result.status === 'ambiguous' ? 'failed' : 'ok',
                    name: 'stripe_persistent_recovery_readback',
                    message: result.status === 'ambiguous'
                        ? 'GET-only recovery proved neither exact prior nor exact target state; the guard remains blocked.'
                        : 'GET-only recovery proved an exact safe state and released the stale guard; this invocation remains terminal.',
                    details: [
                        `capture=${capture.path}`,
                        `scopeHash=${scopeHash}`,
                        `result=${result.status}`,
                        'terminal=true',
                        'externalWriteAttempted=false',
                        'retryUpdate=false',
                    ],
                },
            ],
        };
    } catch (error) {
        try {
            blockStripeCutoverRecovery(recovery.session);
        } catch {
            // Persistent recovery locks remain fail-closed if local state cannot advance.
        }
        recoveryOnlyStatus = 'blocked';
        return {
            terminal: true,
            checks: [{
                status: 'failed',
                name: 'stripe_persistent_recovery_state',
                message: 'GET-only recovery could not safely resolve persistent state; the guard remains blocked.',
                details: [safeErrorMessage(error), `scopeHash=${scopeHash}`, 'retryUpdate=false'],
            }],
        };
    }
}

async function captureStripeAccount(
    stripe: Stripe,
    expectedAccountId: string,
    reportCaptures: ExecutionCapture[],
): Promise<{ check: Check; snapshot: AccountSnapshot | null }> {
    try {
        const account = await stripe.accounts.retrieve();
        const idSha256 = sha256Hex(account.id);
        const evidence = classifyStripeWebhookCutoverEvidence(latestStripeReadonlySummary);
        const problems: string[] = [];
        if (account.id !== expectedAccountId) problems.push('live Stripe account does not equal STRIPE_EXPECTED_ACCOUNT_ID');
        if (evidence.accountIdSha256 !== idSha256) problems.push('live Stripe account hash differs from strict read-only evidence');
        const snapshot: AccountSnapshot = {
            idSha256,
            country: account.country ?? 'unknown',
            defaultCurrency: account.default_currency ?? 'unknown',
            chargesEnabled: Boolean(account.charges_enabled),
            payoutsEnabled: Boolean(account.payouts_enabled),
        };
        const capture = writeExecutionCapture(
            'stripe_account_readonly_preflight',
            problems.length === 0 ? 'ok' : 'failed',
            false,
            'Read-only Stripe account preflight bound to the expected account SHA-256 before any webhook update.',
            snapshot,
        );
        reportCaptures.push(capture);
        return {
            check: {
                status: problems.length === 0 ? 'ok' : 'failed',
                name: 'stripe_account_readonly_preflight',
                message: problems.length === 0
                    ? 'Stripe account exactly matches the expected account and strict evidence hash before any write.'
                    : 'Stripe account identity does not match the expected account/evidence; no webhook update can run.',
                details: problems.length === 0
                    ? [
                        `capture=${capture.path}`,
                        `accountIdSha256=${idSha256}`,
                        `country=${account.country ?? 'unknown'}`,
                    ]
                    : problems,
            },
            snapshot: problems.length === 0 ? snapshot : null,
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
            check: {
                status: 'failed',
                name: 'stripe_account_readonly_preflight',
                message: 'Stripe account could not be read; no webhook update can run.',
                details: [`capture=${capture.path}`, safeErrorMessage(error)],
            },
            snapshot: null,
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
                    `endpointIdSha256=${snapshot.idSha256}`,
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
            { endpointIdSha256: sha256Hex(endpointId), error: safeErrorMessage(error) },
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
    const evidence = classifyStripeWebhookCutoverEvidence(latestStripeReadonlySummary);
    if (endpoint.livemode !== false) problems.push('endpoint livemode is not false');
    if (endpoint.status !== 'enabled') problems.push(`endpoint status is ${endpoint.status ?? 'unknown'}`);
    if (endpoint.enabledEvents.length === 0) problems.push('endpoint has no enabled events to preserve');
    if (!endpoint.urlShapeSafe) problems.push(`current endpoint must be a strict HTTPS URL with exact path ${targetWebhookPath}`);
    if (!sameStringSet(endpoint.enabledEvents, evidence.enabledEvents)) {
        problems.push('live endpoint events differ from the current strict read-only evidence');
    }
    if (!evidence.endpointIdSha256 || endpoint.idSha256 !== evidence.endpointIdSha256) {
        problems.push('live endpoint id SHA-256 differs from the current read-only evidence');
    }

    return {
        status: problems.length === 0 ? 'ok' : 'failed',
        name: 'stripe_endpoint_scope_preflight',
        message: problems.length === 0
            ? 'Endpoint preflight is test mode, enabled and scoped to the webhook path before update.'
            : 'Endpoint preflight does not match the allowed test-mode enabled webhook scope.',
        details: problems.length === 0
            ? [
                `endpointIdSha256=${endpoint.idSha256}`,
                `from=${safeUrl(endpoint.url)}`,
                `events=${endpoint.enabledEvents.join('|')}`,
            ]
            : problems,
    };
}

function buildExactApprovalSentence(account: AccountSnapshot, endpoint: EndpointSnapshot, targetUrl: string): string {
    return buildStripeWebhookCutoverApprovalSentence({
        accountIdSha256: account.idSha256,
        endpointIdSha256: endpoint.idSha256,
        currentUrl: endpoint.url,
        targetUrl,
        enabledEvents: endpoint.enabledEvents,
    });
}

function snapshotEndpoint(endpoint: Stripe.WebhookEndpoint): EndpointSnapshot {
    return {
        idSha256: sha256Hex(endpoint.id),
        url: safeEndpointUrl(endpoint.url),
        host: safeEndpointHost(endpoint.url),
        urlShapeSafe: isStrictWebhookUrl(endpoint.url),
        status: endpoint.status ?? null,
        livemode: Boolean(endpoint.livemode),
        enabledEvents: [...endpoint.enabled_events],
        apiVersion: endpoint.api_version ?? null,
        descriptionPresent: Boolean(endpoint.description),
        descriptionSha256: endpoint.description ? sha256Hex(endpoint.description) : null,
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

function persistExternalWriteReceipt(stage: string): void {
    writeFileSync(externalWriteReceiptPath, `${JSON.stringify({
        schemaVersion: 1,
        provider: 'stripe_test_webhook_endpoint',
        updatedAt: new Date().toISOString(),
        stage,
        ...externalWriteReceipt,
        retryPolicy: externalWriteReceipt.readonlyReconciliationRequired
            ? 'blocked_until_readonly_reconciliation_and_rollback_decision'
            : 'normal_exact_approval_gate',
    }, null, 2)}\n`, 'utf8');
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
        prepareApprovalRequested: report.prepareApprovalRequested,
        executeRequested: report.executeRequested,
        approvalPrepared: report.approvalPrepared,
        approvalMatched: report.approvalMatched,
        externalWriteAttempted: report.externalWriteAttempted,
        externalWritePerformed: report.externalWritePerformed,
        externalWriteOutcome: report.externalWriteOutcome,
        readonlyReconciliationRequired: report.readonlyReconciliationRequired,
        externalWriteReceiptPath: toRelative(report.externalWriteReceiptPath),
        stripeModePolicy: report.stripeModePolicy,
        targetWebhookPath: report.targetWebhookPath,
        allowedTargetHosts: report.allowedTargetHosts,
        requiredEnv: report.requiredEnv,
        preparationRequiredEnv,
        approvalEnvVar: report.approvalEnvVar,
        prepareApprovalFlag: '--prepare-approval',
        executeFlag: '--execute-approved',
        planMode: {
            connectsToStripe: false,
            writesStripe: false,
            writesOtherExternalServices: false,
        },
        approvalPreparationMode: {
            stripeCalls: ['stripe.accounts.retrieve', 'stripe.webhookEndpoints.retrieve'],
            maxNetworkRetries: 0,
            writesStripe: false,
            identity: 'Account and endpoint SHA-256 only; full ids remain in process environment memory.',
            freeFormDescriptionPersisted: false,
        },
        approvedExecutionOnly: {
            stripeReadOnlyPreflight: [
                'stripe.accounts.retrieve',
                'stripe.webhookEndpoints.retrieve',
            ],
            stripeWrite: 'stripe.webhookEndpoints.update(endpointId, { url: targetUrl })',
            maxNetworkRetries: 0,
            updateScope: 'URL only; enabled_events are not sent, products/prices/customers/subscriptions/checkout are never touched.',
            durableGuard: 'Atomic execution lock plus immutable write-ahead journal keyed by account+endpoint identity hash.',
            recovery: 'A later invocation is GET-only and terminal; it never retries the update in the recovery process.',
        },
        latestSupportArtifacts: {
            cutoverPackSummary: toRelativeOrNull(report.latestCutoverPackSummaryPath),
            cutoverPackStructuredSummary: toRelativeOrNull(report.latestCutoverPackStructuredSummaryPath),
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
        `- External write attempted: ${String(report.externalWriteAttempted)}`,
        `- External write performed: ${String(report.externalWritePerformed)}`,
        `- External write outcome: ${report.externalWriteOutcome}`,
        `- Read-only reconciliation required: ${String(report.readonlyReconciliationRequired)}`,
        `- Durable write receipt: ${toRelative(report.externalWriteReceiptPath)}`,
        `- Approval env var: ${approvalEnvVar}`,
        '',
        '## Scope',
        '',
        '- Plan mode is local-only and does not call Stripe.',
        '- Approval preparation uses only Stripe GET operations and writes exactly one approval sentence containing account and endpoint SHA-256 values, never full ids.',
        '- Approved execution is limited to one Stripe test-mode webhook endpoint URL update.',
        '- The target URL must be HTTPS, must use an allowed launch host and must end in `/api/stripe-webhook`.',
        '- Before any update, the runner reads the Stripe account and endpoint metadata, confirms `livemode=false`, confirms the endpoint is enabled and builds the exact approval sentence from that live read-only preflight.',
        '- Stripe SDK network retries are explicitly zero. A durable write-ahead journal and atomic execution lock are persisted before the single URL update call.',
        '- Any later invocation that finds unresolved state performs GET/readback only and terminates, even when it resolves the state safely.',
        '',
        '## Sequence',
        '',
        '1. Run `pnpm --config.verify-deps-before-run=false launch:stripe-readonly` and review the read-only evidence.',
        '2. Run `pnpm --config.verify-deps-before-run=false launch:stripe-webhook-cutover-pack` and review the approval request, verification checklist and rollback plan.',
        '3. Export `STRIPE_SECRET_KEY`, `STRIPE_EXPECTED_ACCOUNT_ID`, `STRIPE_WEBHOOK_ENDPOINT_ID` and `STRIPE_WEBHOOK_TARGET_URL` outside repo files.',
        '4. Prepare one approval sentence with GET-only calls: `pnpm --config.verify-deps-before-run=false launch:stripe-webhook-cutover-runner -- --prepare-approval`.',
        '5. Review and approve the single sentence in `approval-gate.md`, then supply it through `STRIPE_WEBHOOK_CUTOVER_APPROVAL` outside repo files.',
        '6. Execute only after exact approval: `pnpm --config.verify-deps-before-run=false launch:stripe-webhook-cutover-runner -- --execute-approved`.',
        '7. Rerun `pnpm --config.verify-deps-before-run=false launch:stripe-readonly` and confirm `stripe_webhook_endpoints_readonly` is OK.',
        '8. If the receipt says `ambiguous_needs_readonly_reconciliation`, do not retry the update: retrieve the endpoint read-only, compare it with both the before-capture and intended URL, then either record that the target landed or obtain separate approval to roll back.',
        '',
        '## Before And After Ledger',
        '',
        'Before this runner:',
        '',
        '- The launch package showed a truncated endpoint id inside sentences labelled exact, so those sentences could not satisfy the executable runner contract.',
        '',
        'After this runner:',
        '',
        '- A GET-only mode now prepares one executable sentence from live facts, identifying the endpoint by SHA-256 while keeping the full id only in process environment memory.',
        '- Endpoint descriptions are reduced to presence plus SHA-256; free-form description text is never persisted.',
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
    const exactSentenceSection = preparedApprovalSentence
        ? [
            '## Single Exact Executable Approval Sentence',
            '',
            preparedApprovalSentence,
            '',
            'This sentence contains the endpoint id SHA-256, not the full endpoint id. Supply it unchanged through `STRIPE_WEBHOOK_CUTOVER_APPROVAL` only after explicit human approval.',
        ]
        : [
            '## Approval Sentence Not Prepared Yet',
            '',
            'Run the GET-only preparation command below. Plan mode intentionally does not invent or persist a non-executable sentence from a truncated endpoint id.',
        ];
    return `${[
        '# Stripe Webhook Cutover Approval Gate',
        '',
        'This file is not approval. It describes the exact gate the runner will enforce before any Stripe write.',
        '',
        '## GET-only Preparation Command',
        '',
        '`pnpm --config.verify-deps-before-run=false launch:stripe-webhook-cutover-runner -- --prepare-approval`',
        '',
        ...exactSentenceSection,
        '',
        '## Approved Execution Command',
        '',
        '`pnpm --config.verify-deps-before-run=false launch:stripe-webhook-cutover-runner -- --execute-approved`',
        '',
        '## Required Environment',
        '',
        '- `STRIPE_SECRET_KEY`: must be a Stripe test secret key. Live keys are rejected.',
        `- \`${expectedAccountIdEnvVar}\`: exact expected Stripe account id; the live GET must match it, but only its SHA-256 is persisted.`,
        `- \`${endpointIdEnvVar}\`: the full webhook endpoint id from Stripe Dashboard/API, supplied outside repo files.`,
        `- \`${targetUrlEnvVar}\`: exactly one HTTPS URL on an allowed launch host ending in \`${targetWebhookPath}\`.`,
        `- \`${approvalEnvVar}\`: the exact SHA-256-based approval sentence generated by GET-only preparation. Required only for approved execution.`,
        '',
        'Allowed target hosts:',
        '',
        ...allowedTargetHosts.map((host) => `- ${host}`),
        '',
        'Full account/endpoint ids and the Stripe key must never be written to artifacts. The prepared approval sentence may exist only in this ignored approval-gate artifact and contains only identity hashes, never raw ids or a free-form endpoint description.',
        '',
        `Current runner status: ${report.closureStatus}. External write attempted: ${String(report.externalWriteAttempted)}. External write performed: ${String(report.externalWritePerformed)}. Outcome: ${report.externalWriteOutcome}.`,
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
        '3. Run `pnpm --config.verify-deps-before-run=false launch:stripe-webhook-cutover-runner -- --execute-approved`.',
        '4. Rerun `pnpm --config.verify-deps-before-run=false launch:stripe-readonly` and confirm the intended host posture.',
        '5. If checkout/webhook traffic was exercised, reconcile Supabase `payments`, `subscriptions` and `processed_webhook_events` with redacted evidence only.',
        '',
        '## Ambiguous Write Receipt',
        '',
        '- A timeout, network error or provider exception after the update starts is recorded as `externalWriteAttempted=true`, `externalWritePerformed=unknown` and `externalWriteOutcome=ambiguous_needs_readonly_reconciliation`.',
        '- That outcome is a hard failure. Do not repeat the update until a fresh read-only endpoint reconciliation proves whether the intended URL landed and an operator has chosen either acceptance or separately approved rollback.',
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
        'pnpm launch:manual-evidence:record --',
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
        `- GET-only approval preparation requested: ${String(report.prepareApprovalRequested)}`,
        `- Approval prepared: ${String(report.approvalPrepared)}`,
        `- Execute requested: ${String(report.executeRequested)}`,
        `- Approval matched: ${String(report.approvalMatched)}`,
        `- External write attempted: ${String(report.externalWriteAttempted)}`,
        `- External write performed: ${String(report.externalWritePerformed)}`,
        `- External write outcome: ${report.externalWriteOutcome}`,
        `- Read-only reconciliation required: ${String(report.readonlyReconciliationRequired)}`,
        `- Durable write receipt: ${toRelative(report.externalWriteReceiptPath)}`,
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
        'External write attempted',
        'External write performed',
        'External write outcome',
        'ambiguous_needs_readonly_reconciliation',
        'externalWritePerformed=unknown',
        'read-only endpoint reconciliation',
        approvalEnvVar,
        endpointIdEnvVar,
        targetUrlEnvVar,
        '--execute-approved',
        'Plan mode is local-only',
        'No Stripe live mode',
        'No product, price, customer, subscription, invoice, tax, bank/payout or fraud-rule change',
        'No webhook signing secret output or storage',
        'SHA-256',
        'free-form endpoint description',
        'stripe.webhookEndpoints.update(endpointId, { url: targetUrl })',
        'rollback',
    ];
    const missing = required.filter((snippet) => !combined.includes(snippet));
    const unsafeSecretPatterns = [
        /sk_(live|test)_[A-Za-z0-9]{20,}/,
        /pk_(live|test)_[A-Za-z0-9]{20,}/,
        /whsec_[A-Za-z0-9]{20,}/,
        /\bwe_[A-Za-z0-9]{16,}\b/,
        /\bacct_[A-Za-z0-9]{12,}\b/,
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
    if (parsed.port || parsed.username || parsed.password || parsed.search || parsed.hash) {
        problems.push(`${targetUrlEnvVar} must not include port, credentials, query string or hash`);
    }
    return problems;
}

function isStrictWebhookUrl(value: string): boolean {
    try {
        const parsed = new URL(value);
        return parsed.protocol === 'https:'
            && !parsed.port
            && !parsed.username
            && !parsed.password
            && !parsed.search
            && !parsed.hash
            && parsed.pathname === targetWebhookPath;
    } catch {
        return false;
    }
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

function safeErrorMessage(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    return message
        .replace(/sk_(live|test)_[A-Za-z0-9]+/g, 'sk_$1_[redacted]')
        .replace(/pk_(live|test)_[A-Za-z0-9]+/g, 'pk_$1_[redacted]')
        .replace(/whsec_[A-Za-z0-9]+/g, 'whsec_[redacted]')
        .replace(/\bwe_[A-Za-z0-9]+\b/g, 'we_[redacted]')
        .replace(/\bacct_[A-Za-z0-9]+\b/g, 'acct_[redacted]');
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
