import * as dotenv from 'dotenv';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
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
    requestTurnstileCloudflareApi,
    TURNSTILE_CLOUDFLARE_REQUEST_TIMEOUT_MS,
    type CloudflareApiResponse,
} from './turnstile-cloudflare-request';

type CheckStatus = 'ok' | 'warning' | 'failed';
type ReportStatus = 'OK' | 'WARNING' | 'FAILED';
type ClosureStatus =
    | 'PLAN_ONLY_READY'
    | 'EXECUTED_AND_NEEDS_REVIEW'
    | 'BLOCKED_BY_GATE_OR_ARTIFACTS'
    | 'NEEDS_READONLY_RECONCILIATION_OR_ROLLBACK';

interface Check {
    status: CheckStatus;
    name: string;
    message: string;
    details: string[];
}

interface SummaryLike {
    status?: string;
    envFile?: string;
    checks?: Array<{ status?: string; name?: string; message?: string; details?: string[] }>;
}

interface TurnstileWidget {
    sitekey?: string;
    name?: string;
    domains?: string[];
    mode?: string;
    clearance_level?: string;
    created_on?: string;
    modified_on?: string;
}

interface WidgetSnapshot {
    siteKeyPrefix: string;
    name: string;
    domains: string[];
    mode: string;
    clearanceLevel: string;
    createdOn: string | null;
    modifiedOn: string | null;
}

interface ExecutionCapture {
    id: string;
    status: CheckStatus;
    writesCloudflare: boolean;
    path: string;
    description: string;
}

interface ExecutionEnv {
    accountId: string;
    apiToken: string;
    siteKey: string;
    approvalSentence: string;
    expectedDomains: string[];
}

interface RunnerReport {
    schemaVersion: 2;
    startedAt: string;
    endedAt: string;
    status: ReportStatus;
    closureStatus: ClosureStatus;
    outputDir: string;
    targetProvider: 'cloudflare_turnstile';
    approvalEnvVar: string;
    executeRequested: boolean;
    approvalMatched: boolean;
    externalWriteAttempted: boolean;
    externalWritePerformed: ExternalWritePerformed;
    externalWriteOutcome: ExternalWriteOutcome;
    readonlyReconciliationRequired: boolean;
    externalWriteReceiptPath: string;
    allowedDomains: string[];
    requiredEnv: string[];
    latestClosurePackSummaryPath: string | null;
    latestClosurePackApprovalPath: string | null;
    latestTurnstileReadonlySummaryPath: string | null;
    checks: Check[];
    captures: ExecutionCapture[];
    commandManifestPath: string;
    executionPlanPath: string;
    approvalGatePath: string;
    rollbackAfterClosurePath: string;
    manualEvidenceAfterClosurePath: string;
    summaryPath: string;
}

interface RenderedArtifacts {
    commandManifest: string;
    executionPlan: string;
    approvalGate: string;
    rollbackAfterClosure: string;
    manualEvidenceAfterClosure: string;
    summary: string;
}

const approvalEnvVar = 'TURNSTILE_DOMAIN_CLOSURE_APPROVAL';
const expectedDomainsEnvVar = 'TURNSTILE_EXPECTED_DOMAINS';
const requiredEnv = ['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN', 'PUBLIC_TURNSTILE_SITE_KEY', approvalEnvVar];
const allowedDomains = ['espanolhonesto.com', 'staging.espanolhonesto.com', 'www.espanolhonesto.com'];
const executeRequested = process.argv.includes('--execute-approved');

const startedAt = new Date();
const outputDir = path.join(process.cwd(), 'outputs', 'launch-turnstile-domain-closure-runner', stamp(startedAt));
mkdirSync(outputDir, { recursive: true });
const externalWriteReceiptPath = path.join(outputDir, 'external-write-receipt.json');
let externalWriteReceipt = createExternalWriteReceipt();

const latestClosurePackSummaryPath = latestGeneratedPath('launch-turnstile-domain-closure-pack', 'summary.md');
const latestClosurePackApprovalPath = latestGeneratedPath('launch-turnstile-domain-closure-pack', 'approval-request.md');
const latestClosurePackDashboardChecklistPath = latestGeneratedPath('launch-turnstile-domain-closure-pack', 'dashboard-evidence-checklist.md');
const latestClosurePackVerificationPath = latestGeneratedPath('launch-turnstile-domain-closure-pack', 'verification-checklist.md');
const latestClosurePackRollbackPath = latestGeneratedPath('launch-turnstile-domain-closure-pack', 'rollback-plan.md');
const latestTurnstileReadonlySummaryPath = latestGeneratedPath('launch-turnstile-readonly-evidence', 'summary.json');
const latestTurnstileReadonlySummary = readJsonIfExists<SummaryLike>(latestTurnstileReadonlySummaryPath);

const captures: ExecutionCapture[] = [];
const checks: Check[] = [
    validatePackageScript(),
    validateClosurePack(),
    validateTurnstileReadonlyEvidence(),
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
            message: 'Plan mode generated the Turnstile domain closure runner package without connecting to Cloudflare or changing widgets.',
            details: [
                'executeRequested=false',
                'externalWritePerformed=false',
                `futureGate=${approvalEnvVar}`,
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
    writeFileSync(report.rollbackAfterClosurePath, rendered.rollbackAfterClosure, 'utf8');
    writeFileSync(report.manualEvidenceAfterClosurePath, rendered.manualEvidenceAfterClosure, 'utf8');
    writeFileSync(path.join(outputDir, 'summary.json'), JSON.stringify(report, null, 2), 'utf8');
    writeFileSync(report.summaryPath, rendered.summary, 'utf8');

    const failed = report.checks.filter((check) => check.status === 'failed');
    const warnings = report.checks.filter((check) => check.status === 'warning');

    console.log(`[launch:turnstile-domain-closure-runner] Status: ${report.status}`);
    console.log(`[launch:turnstile-domain-closure-runner] Closure: ${report.closureStatus}`);
    console.log(`[launch:turnstile-domain-closure-runner] Failed: ${failed.length}`);
    console.log(`[launch:turnstile-domain-closure-runner] Warnings: ${warnings.length}`);
    console.log(`[launch:turnstile-domain-closure-runner] External write attempted: ${report.externalWriteAttempted}`);
    console.log(`[launch:turnstile-domain-closure-runner] External write performed: ${report.externalWritePerformed}`);
    console.log(`[launch:turnstile-domain-closure-runner] External write outcome: ${report.externalWriteOutcome}`);
    console.log(`[launch:turnstile-domain-closure-runner] Read-only reconciliation required: ${report.readonlyReconciliationRequired}`);
    console.log(`[launch:turnstile-domain-closure-runner] Summary: ${report.summaryPath}`);
    console.log(`[launch:turnstile-domain-closure-runner] Execution plan: ${report.executionPlanPath}`);
    console.log(`[launch:turnstile-domain-closure-runner] Approval gate: ${report.approvalGatePath}`);
    console.log(`[launch:turnstile-domain-closure-runner] Rollback: ${report.rollbackAfterClosurePath}`);

    if (failed.length > 0) process.exit(1);
}

function createReport(reportChecks: Check[], reportCaptures: ExecutionCapture[]): RunnerReport {
    const reportStatus = statusFor(reportChecks);

    return {
        schemaVersion: 2,
        startedAt: startedAt.toISOString(),
        endedAt: new Date().toISOString(),
        status: reportStatus,
        closureStatus: externalWriteReceipt.readonlyReconciliationRequired
            ? 'NEEDS_READONLY_RECONCILIATION_OR_ROLLBACK'
            : reportStatus === 'FAILED'
            ? 'BLOCKED_BY_GATE_OR_ARTIFACTS'
            : executeRequested
                ? 'EXECUTED_AND_NEEDS_REVIEW'
                : 'PLAN_ONLY_READY',
        outputDir,
        targetProvider: 'cloudflare_turnstile',
        approvalEnvVar,
        executeRequested,
        approvalMatched,
        ...externalWriteReceipt,
        externalWriteReceiptPath,
        allowedDomains,
        requiredEnv,
        latestClosurePackSummaryPath,
        latestClosurePackApprovalPath,
        latestTurnstileReadonlySummaryPath,
        checks: reportChecks,
        captures: reportCaptures,
        commandManifestPath: path.join(outputDir, 'turnstile-domain-closure-command-manifest.json'),
        executionPlanPath: path.join(outputDir, 'turnstile-domain-closure-execution-plan.md'),
        approvalGatePath: path.join(outputDir, 'approval-gate.md'),
        rollbackAfterClosurePath: path.join(outputDir, 'rollback-after-turnstile-domain-closure.md'),
        manualEvidenceAfterClosurePath: path.join(outputDir, 'manual-evidence-after-turnstile-domain-closure.txt'),
        summaryPath: path.join(outputDir, 'summary.md'),
    };
}

function validatePackageScript(): Check {
    const packagePath = 'package.json';
    if (!existsSync(packagePath)) {
        return {
            status: 'failed',
            name: 'package_script_turnstile_domain_closure_runner',
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
    if (packageJson.scripts?.['launch:turnstile-domain-closure-runner'] !== 'tsx scripts/launch/turnstile-domain-closure-runner.ts') {
        missing.push('launch:turnstile-domain-closure-runner=tsx scripts/launch/turnstile-domain-closure-runner.ts');
    }

    return {
        status: missing.length === 0 ? 'ok' : 'failed',
        name: 'package_script_turnstile_domain_closure_runner',
        message: missing.length === 0
            ? 'Package scripts expose the gated Turnstile domain closure runner and preserve pnpm policy.'
            : 'Package scripts are missing the gated Turnstile domain closure runner or pnpm package manager contract.',
        details: missing.length === 0 ? ['launch:turnstile-domain-closure-runner'] : missing.map((item) => `missing=${item}`),
    };
}

function validateClosurePack(): Check {
    if (!latestClosurePackSummaryPath || !latestClosurePackApprovalPath || !latestClosurePackDashboardChecklistPath || !latestClosurePackVerificationPath || !latestClosurePackRollbackPath) {
        return {
            status: 'failed',
            name: 'turnstile_closure_pack_exists',
            message: 'The Turnstile domain closure pack must exist before using the gated runner.',
            details: ['run=corepack pnpm --config.verify-deps-before-run=false launch:turnstile-domain-closure-pack'],
        };
    }

    const combined = [
        readFileSync(latestClosurePackSummaryPath, 'utf8'),
        readFileSync(latestClosurePackApprovalPath, 'utf8'),
        readFileSync(latestClosurePackDashboardChecklistPath, 'utf8'),
        readFileSync(latestClosurePackVerificationPath, 'utf8'),
        readFileSync(latestClosurePackRollbackPath, 'utf8'),
    ].join('\n');
    const required = [
        'Turnstile Domain Closure',
        'The exact approval scope is limited to the named Turnstile widget/domain review or correction.',
        'espanolhonesto.com',
        'staging.espanolhonesto.com',
        'www.espanolhonesto.com',
        'Do not change Turnstile secret key, site key, challenge mode or clearance level unless separately approved.',
        'Do not change DNS, Workers, Pages, WAF, Cloudflare account settings, API tokens, analytics or logs.',
        'rollback',
    ];
    const missing = required.filter((snippet) => !combined.includes(snippet));

    return {
        status: missing.length === 0 ? 'ok' : 'failed',
        name: 'turnstile_closure_pack_exists',
        message: missing.length === 0
            ? 'Latest Turnstile closure pack contains the domain scope, verification checklist and rollback posture.'
            : 'Latest Turnstile closure pack is missing required scope, verification or rollback facts.',
        details: missing.length === 0
            ? [
                `summary=${latestClosurePackSummaryPath}`,
                `approval=${latestClosurePackApprovalPath}`,
                `dashboard=${latestClosurePackDashboardChecklistPath}`,
                `verification=${latestClosurePackVerificationPath}`,
                `rollback=${latestClosurePackRollbackPath}`,
            ]
            : missing.map((snippet) => `missing=${snippet}`),
    };
}

function validateTurnstileReadonlyEvidence(): Check {
    if (!latestTurnstileReadonlySummaryPath || !latestTurnstileReadonlySummary) {
        return {
            status: 'failed',
            name: 'turnstile_readonly_evidence_exists',
            message: 'Turnstile read-only evidence is missing before preparing a write-capable runner.',
            details: ['run=corepack pnpm --config.verify-deps-before-run=false launch:turnstile-readonly'],
        };
    }

    const environmentCheck = latestTurnstileReadonlySummary.checks?.find((check) => check.name === 'environment_shape');
    const siteverifyCheck = latestTurnstileReadonlySummary.checks?.find((check) => check.name === 'siteverify_fake_token_rejection');
    const problems: string[] = [];
    if (latestTurnstileReadonlySummary.status === 'FAILED') problems.push('latest Turnstile read-only summary failed');
    if (environmentCheck?.status === 'failed') problems.push('environment_shape failed');
    if (siteverifyCheck?.status !== 'ok') problems.push('siteverify_fake_token_rejection is not OK');

    return {
        status: problems.length === 0 ? 'ok' : 'failed',
        name: 'turnstile_readonly_evidence_exists',
        message: problems.length === 0
            ? 'Latest Turnstile read-only evidence proves runtime key shape and siteverify fake-token rejection before the runner gate.'
            : 'Latest Turnstile read-only evidence is not sufficient for a gated domain closure runner.',
        details: problems.length === 0
            ? [
                `summary=${latestTurnstileReadonlySummaryPath}`,
                `status=${latestTurnstileReadonlySummary.status ?? 'unknown'}`,
                `envFile=${latestTurnstileReadonlySummary.envFile ?? 'unknown'}`,
                `siteverify=${siteverifyCheck?.status ?? 'missing'}`,
                `missingCloudflareApi=${detailValue(environmentCheck?.details, 'missing_cloudflare_api') ?? 'unknown'}`,
            ]
            : problems,
    };
}

function validateApprovalGateSource(): Check {
    const sourcePath = path.join('scripts', 'launch', 'turnstile-domain-closure-runner.ts');
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
        expectedDomainsEnvVar,
        '--execute-approved',
        'runApprovedExecution',
        'buildExactApprovalSentence',
        'cloudflareRequest',
        'requestTurnstileCloudflareApi',
        'TURNSTILE_CLOUDFLARE_REQUEST_TIMEOUT_MS',
        'GET',
        'PUT',
        '/challenges/widgets/',
        'validateWidgetBeforeUpdate',
        'markExternalWriteAttemptStarted',
        'persistExternalWriteReceipt',
        'externalWriteAttempted',
        'externalWriteOutcome',
        'ambiguous_needs_readonly_reconciliation',
        'readonlyReconciliationRequired',
        'put_error_or_timeout_outcome_ambiguous',
        'externalWritePerformed=false',
    ];
    const missing = required.filter((snippet) => !source.includes(snippet));

    return {
        status: missing.length === 0 ? 'ok' : 'failed',
        name: 'approval_gate_source',
        message: missing.length === 0
            ? 'Runner source contains Cloudflare read-only preflight, exact approval comparison and domains-only update branch.'
            : 'Runner source is missing required Turnstile approval gate or execution sequencing facts.',
        details: missing.length === 0 ? [sourcePath] : missing.map((snippet) => `missing=${snippet}`),
    };
}

function validateForbiddenScopeSource(): Check {
    const sourcePath = path.join('scripts', 'launch', 'turnstile-domain-closure-runner.ts');
    const source = readIfExists(sourcePath) ?? '';
    const required = forbiddenScopeLines();
    const missing = required.filter((snippet) => !source.includes(snippet));
    const forbiddenSnippets = [
        ...Array.from(source.matchAll(/cloudflareRequest<[^>]+>\(\s*env,\s*'DELETE'/g), (match) => match[0]),
        ...Array.from(source.matchAll(/\/(?:zones\/[^'"]*\/dns_records|accounts\/[^'"]*\/workers\/scripts|accounts\/[^'"]*\/pages\/projects|accounts\/[^'"]*\/rulesets)/g), (match) => match[0]),
    ];

    return {
        status: missing.length === 0 && forbiddenSnippets.length === 0 ? 'ok' : 'failed',
        name: 'forbidden_scope_source',
        message: missing.length === 0 && forbiddenSnippets.length === 0
            ? 'Runner source forbids key rotation, non-Turnstile Cloudflare writes, provider writes and secret-value output.'
            : 'Runner source is missing forbidden-scope wording or contains a forbidden Cloudflare operation snippet.',
        details: [
            ...missing.map((snippet) => `missing=${snippet}`),
            ...forbiddenSnippets.map((snippet) => `forbidden=${snippet}`),
        ],
    };
}

function validateExecutionEnv(): { check: Check; value: ExecutionEnv | null } {
    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID ?? '';
    const apiToken = process.env.CLOUDFLARE_API_TOKEN ?? '';
    const siteKey = process.env.PUBLIC_TURNSTILE_SITE_KEY ?? '';
    const approvalSentence = process.env[approvalEnvVar] ?? '';
    const expectedDomains = expectedTurnstileDomains();
    const missing = requiredEnv.filter((name) => !process.env[name]);
    const problems = [...missing.map((name) => `missing=${name}`)];

    if (accountId && !/^[a-f0-9]{32}$/i.test(accountId)) {
        problems.push('CLOUDFLARE_ACCOUNT_ID must look like a Cloudflare account id');
    }
    if (apiToken && apiToken.length < 20) {
        problems.push('CLOUDFLARE_API_TOKEN is too short to be a real token');
    }
    if (siteKey && !siteKey.startsWith('0x')) {
        problems.push('PUBLIC_TURNSTILE_SITE_KEY must look like a Turnstile site key');
    }
    const unexpectedDomains = expectedDomains.filter((domain) => !allowedDomains.includes(domain));
    if (unexpectedDomains.length > 0) {
        problems.push(`unexpected_expected_domains=${unexpectedDomains.join('|')}`);
    }

    return {
        check: {
            status: problems.length === 0 ? 'ok' : 'failed',
            name: 'execution_env_shape',
            message: problems.length === 0
                ? 'Execution environment has Cloudflare account/token, Turnstile site key, approval variable and allowed expected domains.'
                : 'Execution environment is missing required values or attempts a forbidden Turnstile target.',
            details: problems.length === 0
                ? [
                    `account=${compactId(accountId)}`,
                    `siteKey=${compactId(siteKey)}`,
                    `expectedDomains=${expectedDomains.join('|')}`,
                    `approvalProvided=${String(Boolean(approvalSentence))}`,
                ]
                : problems,
        },
        value: problems.length === 0
            ? { accountId, apiToken, siteKey, approvalSentence, expectedDomains }
            : null,
    };
}

async function runApprovedExecution(env: ExecutionEnv, reportCaptures: ExecutionCapture[]): Promise<Check[]> {
    const executionChecks: Check[] = [];

    const tokenCheck = await cloudflareTokenPreflight(env, reportCaptures);
    executionChecks.push(tokenCheck);
    if (tokenCheck.status === 'failed') return executionChecks;

    const before = await retrieveWidget(env, 'turnstile_widget_before_update_readonly', reportCaptures);
    executionChecks.push(before.check);
    if (!before.widget || before.check.status === 'failed') return executionChecks;

    const scopeCheck = validateWidgetBeforeUpdate(before.widget, env);
    executionChecks.push(scopeCheck);
    if (scopeCheck.status === 'failed') return executionChecks;

    const exactApprovalSentence = buildExactApprovalSentence(before.widget, env);
    const exactApprovalGate: Check = {
        status: env.approvalSentence === exactApprovalSentence ? 'ok' : 'failed',
        name: 'exact_approval_gate',
        message: env.approvalSentence === exactApprovalSentence
            ? 'Exact approval sentence matched; only the Turnstile widget domain list update can run.'
            : 'Execution was requested but the exact approval gate did not match, so no Turnstile update can run.',
        details: env.approvalSentence === exactApprovalSentence
            ? [
                `env=${approvalEnvVar}`,
                `account=${compactId(env.accountId)}`,
                `siteKey=${compactId(env.siteKey)}`,
                `domains=${env.expectedDomains.join('|')}`,
            ]
            : [
                `env=${approvalEnvVar}`,
                'required=exact sentence generated from live read-only Turnstile widget preflight',
                'externalWritePerformed=false',
            ],
    };
    executionChecks.push(exactApprovalGate);
    if (exactApprovalGate.status === 'failed') return executionChecks;

    if (sameStringSet(normalizeDomains(before.widget.domains ?? []), env.expectedDomains)) {
        executionChecks.push({
            status: 'warning',
            name: 'turnstile_domains_already_active',
            message: 'The Turnstile widget already has exactly the requested launch domains; no update call was made.',
            details: [
                `siteKey=${compactId(env.siteKey)}`,
                `domains=${env.expectedDomains.join('|')}`,
                'externalWritePerformed=false',
            ],
        });
        return executionChecks;
    }

    externalWriteReceipt = markExternalWriteAttemptStarted(externalWriteReceipt);
    persistExternalWriteReceipt('put_started_awaiting_provider_confirmation');

    try {
        const payload = await cloudflareRequest<TurnstileWidget>(
            env,
            'PUT',
            `/accounts/${env.accountId}/challenges/widgets/${env.siteKey}`,
            {
                name: before.widget.name,
                mode: before.widget.mode,
                clearance_level: before.widget.clearance_level,
                domains: env.expectedDomains,
            },
        );
        externalWriteReceipt = payload.success === true
            ? markExternalWriteConfirmed(externalWriteReceipt, true)
            : payload.success === false
                ? markExternalWriteConfirmed(externalWriteReceipt, false)
                : markExternalWriteAmbiguous(externalWriteReceipt);
        persistExternalWriteReceipt('put_provider_response_classified');
        const snapshot = snapshotWidget(payload.result ?? before.widget);
        const capture = writeExecutionCapture(
            'turnstile_widget_domains_update',
            payload.success === true ? 'ok' : 'failed',
            true,
            'Cloudflare Turnstile widget domains update result, redacted to public site key prefix and non-secret metadata.',
            {
                success: Boolean(payload.success),
                errors: formatApiErrors(payload),
                widget: snapshot,
            },
        );
        reportCaptures.push(capture);
        executionChecks.push({
            status: payload.success === true ? 'ok' : 'failed',
            name: 'turnstile_widget_domains_updated',
            message: payload.success === true
                ? 'Cloudflare Turnstile widget domain list was updated and captured without secret values.'
                : 'Cloudflare Turnstile widget domain update failed.',
            details: [
                `capture=${capture.path}`,
                `receipt=${externalWriteReceiptPath}`,
                `externalWriteAttempted=${String(externalWriteReceipt.externalWriteAttempted)}`,
                `externalWritePerformed=${String(externalWriteReceipt.externalWritePerformed)}`,
                `externalWriteOutcome=${externalWriteReceipt.externalWriteOutcome}`,
                `siteKey=${snapshot.siteKeyPrefix}`,
                `domains=${snapshot.domains.join('|') || 'none'}`,
                `errors=${formatApiErrors(payload)}`,
            ],
        });
        if (payload.success !== true) return executionChecks;
    } catch (error) {
        externalWriteReceipt = markExternalWriteAmbiguous(externalWriteReceipt);
        persistExternalWriteReceipt('put_error_or_timeout_outcome_ambiguous');
        const capture = writeExecutionCapture(
            'turnstile_widget_domains_update',
            'failed',
            true,
            'Cloudflare Turnstile widget domains update returned an error after the PUT started; outcome is ambiguous until read-only reconciliation.',
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
            name: 'turnstile_widget_domains_updated',
            message: 'Cloudflare Turnstile widget domain update errored after the PUT started; the write may have landed and must be reconciled read-only before rollback or retry.',
            details: [
                `capture=${capture.path}`,
                `receipt=${externalWriteReceiptPath}`,
                'externalWriteAttempted=true',
                'externalWritePerformed=unknown',
                `externalWriteOutcome=${externalWriteReceipt.externalWriteOutcome}`,
                'required=read-only widget reconciliation and rollback decision before retry',
                safeErrorMessage(error),
            ],
        });
        return executionChecks;
    }

    const after = await retrieveWidget(env, 'turnstile_widget_after_update_readonly', reportCaptures);
    executionChecks.push(after.check);
    if (!after.widget || after.check.status === 'failed') {
        externalWriteReceipt = requireReadonlyReconciliation(externalWriteReceipt);
        persistExternalWriteReceipt('post_put_readonly_reconciliation_failed');
        return executionChecks;
    }

    const domainsOk = sameStringSet(normalizeDomains(after.widget.domains ?? []), env.expectedDomains);
    const invariantsPreserved = after.widget.name === before.widget.name
        && after.widget.mode === before.widget.mode
        && after.widget.clearance_level === before.widget.clearance_level;
    executionChecks.push({
        status: domainsOk && invariantsPreserved ? 'ok' : 'failed',
        name: 'post_update_readonly_verification',
        message: domainsOk && invariantsPreserved
            ? 'Read-only verification shows exact domains and preserved widget name/mode/clearance after the update.'
            : 'Read-only verification did not prove domain or widget-mode invariants after the update.',
        details: [
            `domains=${normalizeDomains(after.widget.domains ?? []).join('|') || 'none'}`,
            `domainsOk=${String(domainsOk)}`,
            `namePreserved=${String(after.widget.name === before.widget.name)}`,
            `modePreserved=${String(after.widget.mode === before.widget.mode)}`,
            `clearancePreserved=${String(after.widget.clearance_level === before.widget.clearance_level)}`,
        ],
    });
    if (!domainsOk || !invariantsPreserved) {
        externalWriteReceipt = requireReadonlyReconciliation(externalWriteReceipt);
        persistExternalWriteReceipt('post_put_readonly_invariants_failed');
    } else {
        persistExternalWriteReceipt('post_put_readonly_verified');
    }

    return executionChecks;
}

async function cloudflareTokenPreflight(env: ExecutionEnv, reportCaptures: ExecutionCapture[]): Promise<Check> {
    try {
        const payload = await cloudflareRequest<{ id?: string; status?: string }>(env, 'GET', '/user/tokens/verify');
        const active = payload.success === true && payload.result?.status === 'active';
        const capture = writeExecutionCapture(
            'cloudflare_token_readonly_preflight',
            active ? 'ok' : 'failed',
            false,
            'Read-only Cloudflare token verification before any Turnstile widget update.',
            {
                success: Boolean(payload.success),
                tokenId: compactId(payload.result?.id),
                status: payload.result?.status ?? 'unknown',
                errors: formatApiErrors(payload),
            },
        );
        reportCaptures.push(capture);
        return {
            status: active ? 'ok' : 'failed',
            name: 'cloudflare_token_readonly_preflight',
            message: active
                ? 'Cloudflare API token verifies as active before any Turnstile write.'
                : 'Cloudflare API token verification failed; no Turnstile update can run.',
            details: [`capture=${capture.path}`, `status=${payload.result?.status ?? 'unknown'}`, `errors=${formatApiErrors(payload)}`],
        };
    } catch (error) {
        const capture = writeExecutionCapture(
            'cloudflare_token_readonly_preflight',
            'failed',
            false,
            'Read-only Cloudflare token verification failed before any Turnstile update.',
            { error: safeErrorMessage(error) },
        );
        reportCaptures.push(capture);
        return {
            status: 'failed',
            name: 'cloudflare_token_readonly_preflight',
            message: 'Cloudflare API token could not be verified.',
            details: [`capture=${capture.path}`, safeErrorMessage(error)],
        };
    }
}

async function retrieveWidget(
    env: ExecutionEnv,
    captureId: string,
    reportCaptures: ExecutionCapture[],
): Promise<{ check: Check; widget: TurnstileWidget | null }> {
    try {
        const payload = await cloudflareRequest<TurnstileWidget>(
            env,
            'GET',
            `/accounts/${env.accountId}/challenges/widgets/${env.siteKey}`,
        );
        const widget = normalizeWidget(payload.result);
        const capture = writeExecutionCapture(
            captureId,
            payload.success === true && widget ? 'ok' : 'failed',
            false,
            'Read-only Cloudflare Turnstile widget retrieve; no secret key or API token stored.',
            {
                success: Boolean(payload.success),
                errors: formatApiErrors(payload),
                widget: widget ? snapshotWidget(widget) : null,
            },
        );
        reportCaptures.push(capture);
        return {
            check: {
                status: payload.success === true && widget ? 'ok' : 'failed',
                name: captureId,
                message: payload.success === true && widget
                    ? 'Cloudflare Turnstile widget metadata was retrieved read-only.'
                    : 'Cloudflare Turnstile widget could not be retrieved read-only.',
                details: [
                    `capture=${capture.path}`,
                    `siteKey=${compactId(env.siteKey)}`,
                    `errors=${formatApiErrors(payload)}`,
                ],
            },
            widget,
        };
    } catch (error) {
        const capture = writeExecutionCapture(
            captureId,
            'failed',
            false,
            'Read-only Cloudflare Turnstile widget retrieve failed; no update was attempted.',
            { siteKey: compactId(env.siteKey), error: safeErrorMessage(error) },
        );
        reportCaptures.push(capture);
        return {
            check: {
                status: 'failed',
                name: captureId,
                message: 'Cloudflare Turnstile widget could not be retrieved read-only.',
                details: [`capture=${capture.path}`, safeErrorMessage(error)],
            },
            widget: null,
        };
    }
}

function validateWidgetBeforeUpdate(widget: TurnstileWidget, env: ExecutionEnv): Check {
    const domains = normalizeDomains(widget.domains ?? []);
    const problems: string[] = [];
    if (widget.sitekey !== env.siteKey) problems.push('retrieved widget sitekey does not match PUBLIC_TURNSTILE_SITE_KEY');
    if (!widget.name) problems.push('widget name is missing; refusing to PUT without preserving name');
    if (!widget.mode) problems.push('widget mode is missing; refusing to PUT without preserving mode');
    if (!widget.clearance_level) problems.push('widget clearance_level is missing; refusing to PUT without preserving clearance_level');
    if (env.expectedDomains.some((domain) => !allowedDomains.includes(domain))) {
        problems.push(`expected domains outside allowlist: ${env.expectedDomains.filter((domain) => !allowedDomains.includes(domain)).join('|')}`);
    }
    if (domains.some((domain) => !allowedDomains.includes(domain))) {
        problems.push(`current widget has domains outside runner allowlist: ${domains.filter((domain) => !allowedDomains.includes(domain)).join('|')}`);
    }

    return {
        status: problems.length === 0 ? 'ok' : 'failed',
        name: 'turnstile_widget_scope_preflight',
        message: problems.length === 0
            ? 'Widget preflight has a matching site key, preserveable name/mode/clearance and launch-domain-only scope.'
            : 'Widget preflight does not match the allowed domain-only update scope.',
        details: problems.length === 0
            ? [
                `siteKey=${compactId(env.siteKey)}`,
                `name=${safeValue(widget.name)}`,
                `mode=${safeValue(widget.mode)}`,
                `clearance=${safeValue(widget.clearance_level)}`,
                `currentDomains=${domains.join('|') || 'none'}`,
                `targetDomains=${env.expectedDomains.join('|')}`,
            ]
            : problems,
    };
}

function buildExactApprovalSentence(widget: TurnstileWidget, env: ExecutionEnv): string {
    return `Apruebo actualizar en Cloudflare Turnstile account ${env.accountId} el widget con site key ${env.siteKey} para que sus dominios sean exactamente ${env.expectedDomains.join(', ')}, preservando name "${widget.name}", mode "${widget.mode}" y clearance_level "${widget.clearance_level}", sin cambiar secret keys, site keys, modo de desafio, clearance level, WAF, DNS, Pages, Workers, API tokens, analytics ni ningun otro servicio externo. Despues hay que verificar con corepack pnpm --config.verify-deps-before-run=false launch:turnstile-readonly y registrar evidencia sin secret values, sin Turnstile secret key y sin Cloudflare API token. No autorizo ningun otro cambio de Cloudflare ni servicios externos.`;
}

async function cloudflareRequest<T>(
    env: ExecutionEnv,
    method: 'GET' | 'PUT',
    pathname: string,
    body?: unknown,
): Promise<CloudflareApiResponse<T>> {
    return requestTurnstileCloudflareApi<T>({
        apiToken: env.apiToken,
        method,
        pathname,
        body,
        timeoutMs: TURNSTILE_CLOUDFLARE_REQUEST_TIMEOUT_MS,
    });
}

function writeExecutionCapture(
    id: string,
    status: CheckStatus,
    writesCloudflare: boolean,
    description: string,
    data: unknown,
): ExecutionCapture {
    const capturePath = path.join(outputDir, `${id}.json`);
    writeFileSync(capturePath, `${JSON.stringify({
        schemaVersion: 1,
        capturedAt: new Date().toISOString(),
        id,
        status,
        writesCloudflare,
        description,
        data,
    }, null, 2)}\n`, 'utf8');

    return {
        id,
        status,
        writesCloudflare,
        path: capturePath,
        description,
    };
}

function persistExternalWriteReceipt(stage: string): void {
    writeFileSync(externalWriteReceiptPath, `${JSON.stringify({
        schemaVersion: 1,
        provider: 'cloudflare_turnstile',
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
    const rollbackAfterClosure = renderRollbackAfterClosure(report);
    const manualEvidenceAfterClosure = renderManualEvidenceAfterClosure(report);
    const summary = renderSummary(report);

    return { commandManifest, executionPlan, approvalGate, rollbackAfterClosure, manualEvidenceAfterClosure, summary };
}

function renderCommandManifest(report: RunnerReport): string {
    return `${JSON.stringify({
        schemaVersion: report.schemaVersion,
        generatedAt: report.endedAt,
        status: report.status,
        closureStatus: report.closureStatus,
        executeRequested: report.executeRequested,
        approvalMatched: report.approvalMatched,
        externalWriteAttempted: report.externalWriteAttempted,
        externalWritePerformed: report.externalWritePerformed,
        externalWriteOutcome: report.externalWriteOutcome,
        readonlyReconciliationRequired: report.readonlyReconciliationRequired,
        externalWriteReceiptPath: toRelative(report.externalWriteReceiptPath),
        targetProvider: report.targetProvider,
        allowedDomains: report.allowedDomains,
        requiredEnv: report.requiredEnv,
        optionalEnv: [expectedDomainsEnvVar],
        approvalEnvVar: report.approvalEnvVar,
        executeFlag: '--execute-approved',
        planMode: {
            connectsToCloudflare: false,
            writesCloudflare: false,
            writesOtherExternalServices: false,
        },
        approvedExecutionOnly: {
            cloudflareReadOnlyPreflight: [
                'GET /user/tokens/verify',
                'GET /accounts/{account_id}/challenges/widgets/{sitekey}',
            ],
            cloudflareWrite: 'PUT /accounts/{account_id}/challenges/widgets/{sitekey}',
            updateScope: 'domains only while preserving name, mode and clearance_level from live read-only widget preflight.',
        },
        latestSupportArtifacts: {
            closurePackSummary: toRelativeOrNull(report.latestClosurePackSummaryPath),
            closurePackApproval: toRelativeOrNull(report.latestClosurePackApprovalPath),
            turnstileReadonlySummary: toRelativeOrNull(report.latestTurnstileReadonlySummaryPath),
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
        '# Turnstile Domain Closure Runner Execution Plan',
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
        '- Plan mode is local-only and does not call Cloudflare.',
        '- Approved execution is limited to one Cloudflare Turnstile widget domain list update.',
        '- The runner allows only `espanolhonesto.com`, `www.espanolhonesto.com` and `staging.espanolhonesto.com`.',
        '- Before any update, the runner verifies the API token, retrieves the widget read-only, confirms the site key, captures current domains, and builds the exact approval sentence from that live preflight.',
        '- The update preserves `name`, `mode` and `clearance_level`; it does not rotate keys or touch WAF, DNS, Pages, Workers, analytics or logs.',
        '',
        '## Sequence',
        '',
        '1. Run `corepack pnpm --config.verify-deps-before-run=false launch:turnstile-readonly` and review the read-only evidence.',
        '2. Run `corepack pnpm --config.verify-deps-before-run=false launch:turnstile-domain-closure-pack` and review the approval request, dashboard checklist, verification checklist and rollback plan.',
        '3. Export `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `PUBLIC_TURNSTILE_SITE_KEY` and `TURNSTILE_DOMAIN_CLOSURE_APPROVAL` outside repo files.',
        '4. Execute only after exact approval: `corepack pnpm --config.verify-deps-before-run=false launch:turnstile-domain-closure-runner -- --execute-approved`.',
        '5. Rerun `corepack pnpm --config.verify-deps-before-run=false launch:turnstile-readonly` and confirm `turnstile_widgets_readonly` is OK.',
        '6. If the receipt says `ambiguous_needs_readonly_reconciliation`, do not retry the PUT: retrieve the widget read-only, compare it with both the before-capture and intended domains, then either record that the target landed or obtain separate approval to roll back.',
        '',
        '## Before And After Ledger',
        '',
        'Before this runner:',
        '',
        '- The Turnstile closure package could tell the operator what to inspect or change in Cloudflare, but the future domain update still depended on manual dashboard execution.',
        '',
        'After this runner:',
        '',
        '- The same operation is commandized behind a token/account/sitekey env shape, live read-only widget preflight, exact approval comparison, domain allowlist, redacted captures and rollback instructions.',
        '- No external write occurs unless `--execute-approved` is passed and the approval sentence matches the live widget facts.',
        '',
        'Cost/benefit:',
        '',
        '- Benefit: reduces risk of changing the wrong Turnstile widget, rotating keys, changing challenge mode, or broadening Cloudflare scope during final launch.',
        '- Cost: one more launch runner and approval artifact to maintain until integration readiness is closed.',
        '',
        'Rollback:',
        '',
        '- Restore the previous domain list from the pre-update read-only capture/dashboard evidence under a separate exact approval, then rerun Turnstile read-only evidence.',
        '',
        '## Forbidden Scope',
        '',
        ...forbiddenScopeLines().map((line) => `- ${line}`),
        '',
    ].join('\n')}\n`;
}

function renderApprovalGate(report: RunnerReport): string {
    return `${[
        '# Turnstile Domain Closure Approval Gate',
        '',
        'This file is not approval. It describes the exact gate the runner will enforce before any Cloudflare write.',
        '',
        '## Required Command',
        '',
        '`corepack pnpm --config.verify-deps-before-run=false launch:turnstile-domain-closure-runner -- --execute-approved`',
        '',
        '## Required Environment',
        '',
        '- `CLOUDFLARE_ACCOUNT_ID`: Cloudflare account id for the Espanol Honesto account.',
        '- `CLOUDFLARE_API_TOKEN`: token with Turnstile widget read/write scope; never store the value in repo files.',
        '- `PUBLIC_TURNSTILE_SITE_KEY`: existing Turnstile site key for the app.',
        `- \`${expectedDomainsEnvVar}\`: optional comma-separated override; every domain must stay inside the allowlist below.`,
        `- \`${approvalEnvVar}\`: the exact approval sentence generated from the live read-only widget preflight.`,
        '',
        'Allowed target domains:',
        '',
        ...allowedDomains.map((domain) => `- ${domain}`),
        '',
        '## Exact Sentence Shape',
        '',
        'The runner retrieves the widget read-only first and then compares this exact sentence shape in memory:',
        '',
        '`Apruebo actualizar en Cloudflare Turnstile account <CLOUDFLARE_ACCOUNT_ID> el widget con site key <PUBLIC_TURNSTILE_SITE_KEY> para que sus dominios sean exactamente <EXPECTED_DOMAINS>, preservando name "<LIVE_WIDGET_NAME>", mode "<LIVE_WIDGET_MODE>" y clearance_level "<LIVE_WIDGET_CLEARANCE_LEVEL>", sin cambiar secret keys, site keys, modo de desafio, clearance level, WAF, DNS, Pages, Workers, API tokens, analytics ni ningun otro servicio externo. Despues hay que verificar con corepack pnpm --config.verify-deps-before-run=false launch:turnstile-readonly y registrar evidencia sin secret values, sin Turnstile secret key y sin Cloudflare API token. No autorizo ningun otro cambio de Cloudflare ni servicios externos.`',
        '',
        'Do not write the full API token, Turnstile secret key, dashboard screenshots containing secrets, private user data, analytics exports or logs into repo files, `.codex-ops`, summaries or chat.',
        '',
        `Current runner status: ${report.closureStatus}. External write attempted: ${String(report.externalWriteAttempted)}. External write performed: ${String(report.externalWritePerformed)}. Outcome: ${report.externalWriteOutcome}.`,
        '',
    ].join('\n')}\n`;
}

function renderRollbackAfterClosure(report: RunnerReport): string {
    return `${[
        '# Turnstile Domain Closure Rollback',
        '',
        'Rollback applies only if the runner later performs an approved Turnstile widget domain update. Plan mode performs no external write.',
        '',
        '## Rollback Steps',
        '',
        '1. Identify the prior domain list from the pre-update read-only capture and Cloudflare dashboard, without copying API tokens or Turnstile secret keys.',
        '2. Set `TURNSTILE_EXPECTED_DOMAINS` to that prior list and use the same runner only after a new exact approval sentence is generated from the live read-only widget preflight.',
        '3. Run `corepack pnpm --config.verify-deps-before-run=false launch:turnstile-domain-closure-runner -- --execute-approved`.',
        '4. Rerun `corepack pnpm --config.verify-deps-before-run=false launch:turnstile-readonly` and confirm the intended widget/domain posture.',
        '5. If public forms were affected, keep launch traffic on the previous verified runtime or keep form submission disabled until a browser-token smoke passes.',
        '',
        '## Ambiguous Write Receipt',
        '',
        '- A timeout, network error or unclassifiable response after the PUT starts is recorded as `externalWriteAttempted=true`, `externalWritePerformed=unknown` and `externalWriteOutcome=ambiguous_needs_readonly_reconciliation`.',
        '- That outcome is a hard failure. Do not repeat the PUT until a fresh read-only widget reconciliation proves whether the intended domains landed and an operator has chosen either acceptance or separately approved rollback.',
        '',
        '## Stop Conditions',
        '',
        '- Stop if the Cloudflare account/site key does not match the approval sentence.',
        '- Stop if the domain list includes anything outside the allowlist.',
        '- Stop if the operation would rotate keys, create/delete widgets, change mode/clearance, WAF, DNS, Pages, Workers, analytics, logs or other Cloudflare resources.',
        '- Stop if any API token, Turnstile secret key, private user data, dashboard tokenized URL, analytics export or log payload would be stored in evidence.',
        '',
        `Latest support pack: ${toRelativeOrFallback(report.latestClosurePackSummaryPath, 'outputs/launch-turnstile-domain-closure-pack/<timestamp>/summary.md')}`,
        '',
    ].join('\n')}\n`;
}

function renderManualEvidenceAfterClosure(report: RunnerReport): string {
    const manifestPath = `../../${toRelative(report.commandManifestPath)}`;
    const summaryPath = `../../${toRelative(report.summaryPath)}`;
    const rollbackPath = `../../${toRelative(report.rollbackAfterClosurePath)}`;

    return `${[
        'corepack pnpm --config.verify-deps-before-run=false launch:manual-evidence:record --',
        '  --id integration_readiness',
        '  --status pass',
        '  --summary "Turnstile domain closure runner reviewed/executed with non-secret evidence."',
        '  --environment production',
        '  --owner Alin',
        `  --evidence "command_output=${summaryPath}::Turnstile domain closure runner summary reviewed"`,
        `  --evidence "command_output=${manifestPath}::Turnstile domain closure runner command manifest reviewed"`,
        `  --evidence "command_output=${rollbackPath}::Turnstile domain closure rollback reviewed"`,
        '  --evidence "manual_note=Replace with concrete non-secret result: Cloudflare account id prefix, widget name, site key prefix, allowed domains, post-closure launch:turnstile-readonly summary path, owner/date and whether the runner executed or risk was accepted."',
        '',
        '# Add --write only after replacing the placeholder note with real non-secret evidence.',
        '',
    ].join(' \\\n')}`;
}

function renderSummary(report: RunnerReport): string {
    const lines = [
        '# Turnstile Domain Closure Runner Summary',
        '',
        `- Status: ${report.status}`,
        `- Closure: ${report.closureStatus}`,
        `- Execute requested: ${String(report.executeRequested)}`,
        `- Approval matched: ${String(report.approvalMatched)}`,
        `- External write attempted: ${String(report.externalWriteAttempted)}`,
        `- External write performed: ${String(report.externalWritePerformed)}`,
        `- External write outcome: ${report.externalWriteOutcome}`,
        `- Read-only reconciliation required: ${String(report.readonlyReconciliationRequired)}`,
        `- Durable write receipt: ${toRelative(report.externalWriteReceiptPath)}`,
        `- Latest closure pack: ${toRelativeOrFallback(report.latestClosurePackSummaryPath, 'missing')}`,
        `- Latest Turnstile read-only evidence: ${toRelativeOrFallback(report.latestTurnstileReadonlySummaryPath, 'missing')}`,
        `- Command manifest: ${toRelative(report.commandManifestPath)}`,
        `- Execution plan: ${toRelative(report.executionPlanPath)}`,
        `- Approval gate: ${toRelative(report.approvalGatePath)}`,
        `- Rollback: ${toRelative(report.rollbackAfterClosurePath)}`,
        '',
        'Plan mode is local-only. It does not connect to Cloudflare, does not create/update/delete Turnstile widgets, does not rotate keys, does not change DNS, Workers, Pages, WAF, secrets, analytics or domains outside the named widget, and does not store secret values.',
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
            '| Status | Capture | Writes Cloudflare | Path |',
            '| --- | --- | --- | --- |',
            ...report.captures.map((capture) => `| ${capture.status} | ${escapeCell(capture.id)} | ${String(capture.writesCloudflare)} | ${escapeCell(toRelative(capture.path))} |`),
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
        'read-only widget reconciliation',
        approvalEnvVar,
        'CLOUDFLARE_ACCOUNT_ID',
        'PUBLIC_TURNSTILE_SITE_KEY',
        '--execute-approved',
        'Plan mode is local-only',
        'PUT /accounts/{account_id}/challenges/widgets/{sitekey}',
        'No Turnstile secret key, site key, challenge mode or clearance level change',
        'No WAF, DNS, Pages, Workers, analytics, logs, API token, account setting or other Cloudflare write',
        'rollback',
    ];
    const missing = required.filter((snippet) => !combined.includes(snippet));
    const unsafeSecretPatterns = [
        /Bearer\s+[A-Za-z0-9._-]{20,}/,
        /CLOUDFLARE_API_TOKEN\s*=\s*[^\s]+/,
        /TURNSTILE_SECRET_KEY\s*=\s*[^\s]+/,
        /(postgres|postgresql):\/\/[^\s"']+:[^\s"']+@/,
    ];
    const offenders = unsafeSecretPatterns.filter((pattern) => pattern.test(combined));

    return {
        status: missing.length === 0 && offenders.length === 0 ? 'ok' : 'failed',
        name: 'generated_artifact_posture',
        message: missing.length === 0 && offenders.length === 0
            ? 'Generated Turnstile runner artifacts preserve the approval gate, domains-only write scope, rollback and no-secret posture.'
            : 'Generated Turnstile runner artifacts are missing gate/scope facts or appear to include secret-like values.',
        details: [
            ...missing.map((snippet) => `missing=${snippet}`),
            ...offenders.map((pattern) => `secretPattern=${pattern}`),
        ],
    };
}

function expectedTurnstileDomains(): string[] {
    const explicit = process.env[expectedDomainsEnvVar];
    const raw = explicit ? explicit.split(',') : allowedDomains;
    return normalizeDomains(raw);
}

function normalizeDomains(values: string[]): string[] {
    return [...new Set(values.map(normalizeDomain).filter(Boolean))].sort();
}

function normalizeDomain(value: string): string {
    return value.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
}

function normalizeWidget(value: unknown): TurnstileWidget | null {
    if (!isRecord(value)) return null;
    return {
        sitekey: stringValue(value.sitekey),
        name: stringValue(value.name),
        domains: Array.isArray(value.domains) ? value.domains.map(stringValue).filter(Boolean) : [],
        mode: stringValue(value.mode),
        clearance_level: stringValue(value.clearance_level),
        created_on: stringValue(value.created_on),
        modified_on: stringValue(value.modified_on),
    };
}

function snapshotWidget(widget: TurnstileWidget): WidgetSnapshot {
    return {
        siteKeyPrefix: compactId(widget.sitekey),
        name: safeValue(widget.name),
        domains: normalizeDomains(widget.domains ?? []),
        mode: safeValue(widget.mode),
        clearanceLevel: safeValue(widget.clearance_level),
        createdOn: widget.created_on ?? null,
        modifiedOn: widget.modified_on ?? null,
    };
}

function sameStringSet(left: string[], right: string[]): boolean {
    return left.length === right.length && left.every((item) => right.includes(item));
}

function formatApiErrors(payload: CloudflareApiResponse<unknown>): string {
    const errors = payload.errors ?? [];
    if (errors.length === 0) return 'none';
    return errors.map((error) => `${error.code ?? 'unknown'}:${safeErrorMessage(error.message ?? 'unknown')}`).join('|');
}

function safeValue(value: string | undefined): string {
    return value?.replace(/[|\r\n]/g, ' ').trim() || 'unknown';
}

function safeErrorMessage(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    return message
        .replace(/Bearer\s+[A-Za-z0-9._-]+/g, 'Bearer [redacted]')
        .replace(/0x[a-zA-Z0-9_-]{20,}/g, '0x[redacted]')
        .replace(/cf-[A-Za-z0-9_-]{20,}/g, 'cf-[redacted]');
}

function compactId(id: string | undefined): string {
    if (!id) return 'missing';
    if (id.length <= 12) return id;
    return `${id.slice(0, 8)}...${id.slice(-6)}`;
}

function detailValue(details: string[] | undefined, key: string): string | null {
    const prefix = `${key}=`;
    const item = details?.find((detail) => detail.startsWith(prefix));
    return item ? item.slice(prefix.length) : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
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
        'No Turnstile secret key, site key, challenge mode or clearance level change',
        'No Turnstile widget create, delete or secret rotation',
        'No WAF, DNS, Pages, Workers, analytics, logs, API token, account setting or other Cloudflare write',
        'No Cloudflare dashboard screenshot or output containing API tokens, secret keys, private user data or logs',
        'No Stripe, Supabase, Google, Resend, Sentry, legal value, application code, checkout or email write',
        'No final smoke, real browser token submission or production traffic change',
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
