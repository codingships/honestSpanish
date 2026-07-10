import * as dotenv from 'dotenv';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

type CheckStatus = 'ok' | 'warning' | 'failed';
type ReportStatus = 'OK' | 'WARNING' | 'FAILED';
type ClosureStatus = 'PLAN_ONLY_READY' | 'EXECUTED_AND_NEEDS_REVIEW' | 'BLOCKED_BY_GATE_OR_ARTIFACTS';
type TriageAction = 'resolved' | 'ignored';

interface Check {
    status: CheckStatus;
    name: string;
    message: string;
    details: string[];
}

interface SummaryLike {
    status?: string;
    sentryTriageStatus?: string;
    checks?: Array<{ status?: string; name?: string; message?: string; details?: string[] }>;
    projectResolution?: {
        orgSlug?: string | null;
        projectSlug?: string | null;
    };
}

interface SentryIssue {
    id?: string;
    shortId?: string;
    status?: string;
    level?: string;
    count?: string | number;
    lastSeen?: string;
    project?: {
        slug?: string;
    };
    tags?: Array<{
        key?: string;
        value?: string;
    }>;
}

interface IssueSnapshot {
    shortId: string;
    status: string;
    level: string;
    count: number;
    lastSeen: string | null;
    environments: string[];
}

interface ExecutionEnv {
    token: string;
    orgSlug: string;
    projectSlug: string;
    environment: string;
    action: TriageAction;
    shortIds: string[];
    approvalSentence: string;
}

interface ExecutionCapture {
    id: string;
    status: CheckStatus;
    writesSentry: boolean;
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
    targetProvider: 'sentry_issues';
    baseUrl: string;
    approvalEnvVar: string;
    executeRequested: boolean;
    approvalMatched: boolean;
    externalWritePerformed: boolean;
    supportedActions: TriageAction[];
    requiredEnv: string[];
    latestTriagePackSummaryPath: string | null;
    latestTriagePackApprovalPath: string | null;
    latestSentryReadonlySummaryPath: string | null;
    checks: Check[];
    captures: ExecutionCapture[];
    commandManifestPath: string;
    executionPlanPath: string;
    approvalGatePath: string;
    rollbackAfterTriagePath: string;
    manualEvidenceAfterTriagePath: string;
    summaryPath: string;
}

interface RenderedArtifacts {
    commandManifest: string;
    executionPlan: string;
    approvalGate: string;
    rollbackAfterTriage: string;
    manualEvidenceAfterTriage: string;
    summary: string;
}

interface SentryApiError extends Error {
    status?: number;
}

const approvalEnvVar = 'SENTRY_TRIAGE_APPROVAL';
const actionEnvVar = 'SENTRY_TRIAGE_ACTION';
const shortIdsEnvVar = 'SENTRY_TRIAGE_SHORT_IDS';
const environmentEnvVar = 'SENTRY_TRIAGE_ENVIRONMENT';
const requiredEnv = ['SENTRY_AUTH_TOKEN', 'SENTRY_ORG', 'SENTRY_PROJECT', actionEnvVar, shortIdsEnvVar, approvalEnvVar];
const supportedActions: TriageAction[] = ['resolved', 'ignored'];
const executeRequested = process.argv.includes('--execute-approved');
const baseUrl = process.env.SENTRY_BASE_URL?.trim() || 'https://sentry.io';

const startedAt = new Date();
const outputDir = path.join(process.cwd(), 'outputs', 'launch-sentry-issue-triage-runner', stamp(startedAt));
mkdirSync(outputDir, { recursive: true });

const latestTriagePackSummaryPath = latestGeneratedPath('launch-sentry-triage-pack', 'summary.md');
const latestTriagePackApprovalPath = latestGeneratedPath('launch-sentry-triage-pack', 'approval-request.md');
const latestTriagePackChecklistPath = latestGeneratedPath('launch-sentry-triage-pack', 'triage-checklist.md');
const latestTriagePackAlertPath = latestGeneratedPath('launch-sentry-triage-pack', 'alert-ownership-checklist.md');
const latestSentryReadonlySummaryPath = latestGeneratedPath('launch-sentry-readonly-evidence', 'summary.json');
const latestSentryReadonlySummary = readJsonIfExists<SummaryLike>(latestSentryReadonlySummaryPath);

const captures: ExecutionCapture[] = [];
const checks: Check[] = [
    validatePackageScript(),
    validateTriagePack(),
    validateSentryReadonlyEvidence(),
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
            message: 'Plan mode generated the Sentry issue triage runner package without connecting to Sentry or changing issue status.',
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
    writeFileSync(report.rollbackAfterTriagePath, rendered.rollbackAfterTriage, 'utf8');
    writeFileSync(report.manualEvidenceAfterTriagePath, rendered.manualEvidenceAfterTriage, 'utf8');
    writeFileSync(path.join(outputDir, 'summary.json'), JSON.stringify(report, null, 2), 'utf8');
    writeFileSync(report.summaryPath, rendered.summary, 'utf8');

    const failed = report.checks.filter((check) => check.status === 'failed');
    const warnings = report.checks.filter((check) => check.status === 'warning');

    console.log(`[launch:sentry-issue-triage-runner] Status: ${report.status}`);
    console.log(`[launch:sentry-issue-triage-runner] Closure: ${report.closureStatus}`);
    console.log(`[launch:sentry-issue-triage-runner] Failed: ${failed.length}`);
    console.log(`[launch:sentry-issue-triage-runner] Warnings: ${warnings.length}`);
    console.log(`[launch:sentry-issue-triage-runner] External write performed: ${report.externalWritePerformed}`);
    console.log(`[launch:sentry-issue-triage-runner] Summary: ${report.summaryPath}`);
    console.log(`[launch:sentry-issue-triage-runner] Execution plan: ${report.executionPlanPath}`);
    console.log(`[launch:sentry-issue-triage-runner] Approval gate: ${report.approvalGatePath}`);
    console.log(`[launch:sentry-issue-triage-runner] Rollback: ${report.rollbackAfterTriagePath}`);

    if (failed.length > 0) process.exit(1);
}

function createReport(reportChecks: Check[], reportCaptures: ExecutionCapture[]): RunnerReport {
    const reportStatus = statusFor(reportChecks);
    const externalWritePerformed = reportCaptures.some((capture) => capture.writesSentry && capture.status === 'ok');

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
        targetProvider: 'sentry_issues',
        baseUrl: safeBaseUrl(baseUrl),
        approvalEnvVar,
        executeRequested,
        approvalMatched,
        externalWritePerformed,
        supportedActions,
        requiredEnv,
        latestTriagePackSummaryPath,
        latestTriagePackApprovalPath,
        latestSentryReadonlySummaryPath,
        checks: reportChecks,
        captures: reportCaptures,
        commandManifestPath: path.join(outputDir, 'sentry-issue-triage-command-manifest.json'),
        executionPlanPath: path.join(outputDir, 'sentry-issue-triage-execution-plan.md'),
        approvalGatePath: path.join(outputDir, 'approval-gate.md'),
        rollbackAfterTriagePath: path.join(outputDir, 'rollback-after-sentry-issue-triage.md'),
        manualEvidenceAfterTriagePath: path.join(outputDir, 'manual-evidence-after-sentry-issue-triage.txt'),
        summaryPath: path.join(outputDir, 'summary.md'),
    };
}

function validatePackageScript(): Check {
    const packagePath = 'package.json';
    if (!existsSync(packagePath)) {
        return {
            status: 'failed',
            name: 'package_script_sentry_issue_triage_runner',
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
    if (packageJson.scripts?.['launch:sentry-issue-triage-runner'] !== 'tsx scripts/launch/sentry-issue-triage-runner.ts') {
        missing.push('launch:sentry-issue-triage-runner=tsx scripts/launch/sentry-issue-triage-runner.ts');
    }

    return {
        status: missing.length === 0 ? 'ok' : 'failed',
        name: 'package_script_sentry_issue_triage_runner',
        message: missing.length === 0
            ? 'Package scripts expose the gated Sentry issue triage runner and preserve pnpm policy.'
            : 'Package scripts are missing the gated Sentry issue triage runner or pnpm package manager contract.',
        details: missing.length === 0 ? ['launch:sentry-issue-triage-runner'] : missing.map((item) => `missing=${item}`),
    };
}

function validateTriagePack(): Check {
    if (!latestTriagePackSummaryPath || !latestTriagePackApprovalPath || !latestTriagePackChecklistPath || !latestTriagePackAlertPath) {
        return {
            status: 'failed',
            name: 'sentry_triage_pack_exists',
            message: 'The Sentry triage pack must exist before using the gated runner.',
            details: ['run=corepack pnpm --config.verify-deps-before-run=false launch:sentry-triage-pack'],
        };
    }

    const combined = [
        readFileSync(latestTriagePackSummaryPath, 'utf8'),
        readFileSync(latestTriagePackApprovalPath, 'utf8'),
        readFileSync(latestTriagePackChecklistPath, 'utf8'),
        readFileSync(latestTriagePackAlertPath, 'utf8'),
    ].join('\n');
    const required = [
        'Sentry Triage Pack',
        'exact approval',
        'accepted risk',
        'Do not fetch or export event details',
        'Do not create or change alert rules',
        'Rerun `corepack pnpm --config.verify-deps-before-run=false launch:sentry-readonly`',
    ];
    const missing = required.filter((snippet) => !combined.includes(snippet));

    return {
        status: missing.length === 0 ? 'ok' : 'failed',
        name: 'sentry_triage_pack_exists',
        message: missing.length === 0
            ? 'Latest Sentry triage pack contains issue scope, approval boundary, alert ownership and verification posture.'
            : 'Latest Sentry triage pack is missing required scope, verification or alert ownership facts.',
        details: missing.length === 0
            ? [
                `summary=${latestTriagePackSummaryPath}`,
                `approval=${latestTriagePackApprovalPath}`,
                `checklist=${latestTriagePackChecklistPath}`,
                `alert=${latestTriagePackAlertPath}`,
            ]
            : missing.map((snippet) => `missing=${snippet}`),
    };
}

function validateSentryReadonlyEvidence(): Check {
    if (!latestSentryReadonlySummaryPath || !latestSentryReadonlySummary) {
        return {
            status: 'failed',
            name: 'sentry_readonly_evidence_exists',
            message: 'Sentry read-only evidence is missing before preparing a write-capable issue triage runner.',
            details: ['run=corepack pnpm --config.verify-deps-before-run=false launch:sentry-readonly'],
        };
    }

    const projectResolution = latestSentryReadonlySummary.projectResolution;
    const problems: string[] = [];
    if (latestSentryReadonlySummary.status === 'FAILED') problems.push('latest Sentry read-only summary failed');
    if (!projectResolution?.orgSlug || projectResolution.orgSlug === 'unknown-org') problems.push('org slug missing in read-only evidence');
    if (!projectResolution?.projectSlug || projectResolution.projectSlug === 'unknown-project') problems.push('project slug missing in read-only evidence');

    return {
        status: problems.length === 0 ? 'ok' : 'failed',
        name: 'sentry_readonly_evidence_exists',
        message: problems.length === 0
            ? 'Latest Sentry read-only evidence resolves the project and can support a gated issue-status preflight.'
            : 'Latest Sentry read-only evidence is not sufficient for a gated issue triage runner.',
        details: problems.length === 0
            ? [
                `summary=${latestSentryReadonlySummaryPath}`,
                `status=${latestSentryReadonlySummary.status ?? 'unknown'}`,
                `org=${projectResolution?.orgSlug ?? 'unknown'}`,
                `project=${projectResolution?.projectSlug ?? 'unknown'}`,
            ]
            : problems,
    };
}

function validateApprovalGateSource(): Check {
    const sourcePath = path.join('scripts', 'launch', 'sentry-issue-triage-runner.ts');
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
        actionEnvVar,
        shortIdsEnvVar,
        '--execute-approved',
        'runApprovedExecution',
        'buildExactApprovalSentence',
        'sentryRequest',
        'GET',
        'PUT',
        '/issues/',
        'validateIssueScopeBeforeUpdate',
        'externalWritePerformed=false',
    ];
    const missing = required.filter((snippet) => !source.includes(snippet));

    return {
        status: missing.length === 0 ? 'ok' : 'failed',
        name: 'approval_gate_source',
        message: missing.length === 0
            ? 'Runner source contains Sentry read-only preflight, exact approval comparison and issue-status update branch.'
            : 'Runner source is missing required Sentry approval gate or execution sequencing facts.',
        details: missing.length === 0 ? [sourcePath] : missing.map((snippet) => `missing=${snippet}`),
    };
}

function validateForbiddenScopeSource(): Check {
    const sourcePath = path.join('scripts', 'launch', 'sentry-issue-triage-runner.ts');
    const source = readIfExists(sourcePath) ?? '';
    const required = forbiddenScopeLines();
    const missing = required.filter((snippet) => !source.includes(snippet));
    const forbiddenSnippets = [
        ...Array.from(source.matchAll(/sentryRequest<[^>]+>\(\s*env,\s*'DELETE'/g), (match) => match[0]),
        ...Array.from(source.matchAll(/\/(?:attachments|releases|alerts|rules|projects\/[^'"]+\/[^'"]+\/keys)/g), (match) => match[0]),
    ];

    return {
        status: missing.length === 0 && forbiddenSnippets.length === 0 ? 'ok' : 'failed',
        name: 'forbidden_scope_source',
        message: missing.length === 0 && forbiddenSnippets.length === 0
            ? 'Runner source forbids event payload access, alert/project/release changes, provider writes and secret-value output.'
            : 'Runner source is missing forbidden-scope wording or contains a forbidden Sentry operation snippet.',
        details: [
            ...missing.map((snippet) => `missing=${snippet}`),
            ...forbiddenSnippets.map((snippet) => `forbidden=${snippet}`),
        ],
    };
}

function validateExecutionEnv(): { check: Check; value: ExecutionEnv | null } {
    const token = process.env.SENTRY_AUTH_TOKEN ?? '';
    const orgSlug = process.env.SENTRY_ORG ?? '';
    const projectSlug = process.env.SENTRY_PROJECT ?? '';
    const environment = process.env[environmentEnvVar] ?? process.env.SENTRY_ENVIRONMENT ?? 'production';
    const action = process.env[actionEnvVar] ?? '';
    const shortIds = parseShortIds(process.env[shortIdsEnvVar] ?? '');
    const approvalSentence = process.env[approvalEnvVar] ?? '';
    const missing = requiredEnv.filter((name) => !process.env[name]);
    const problems = [...missing.map((name) => `missing=${name}`)];

    if (token && (looksPlaceholder(token) || token.length < 20)) {
        problems.push('SENTRY_AUTH_TOKEN is placeholder-shaped or too short');
    }
    if (orgSlug && !/^[a-z0-9_-]+$/i.test(orgSlug)) {
        problems.push('SENTRY_ORG must look like a Sentry organization slug');
    }
    if (projectSlug && !/^[a-z0-9_-]+$/i.test(projectSlug)) {
        problems.push('SENTRY_PROJECT must look like a Sentry project slug');
    }
    if (!supportedActions.includes(action as TriageAction)) {
        problems.push(`SENTRY_TRIAGE_ACTION must be one of ${supportedActions.join('|')}`);
    }
    if (shortIds.length === 0) {
        problems.push('SENTRY_TRIAGE_SHORT_IDS must contain at least one issue short ID');
    }
    if (shortIds.length > 100) {
        problems.push('SENTRY_TRIAGE_SHORT_IDS must contain 100 or fewer issue short IDs');
    }
    const malformedIds = shortIds.filter((id) => !/^[A-Z0-9][A-Z0-9-]{2,}$/.test(id));
    if (malformedIds.length > 0) {
        problems.push(`malformed_short_ids=${malformedIds.join('|')}`);
    }
    if (approvalSentence && approvalSentence.length < 80) {
        problems.push('SENTRY_TRIAGE_APPROVAL is too short to be the exact approval sentence');
    }

    return {
        check: {
            status: problems.length === 0 ? 'ok' : 'failed',
            name: 'execution_env_shape',
            message: problems.length === 0
                ? 'Execution environment has Sentry token, org/project, action, short IDs and approval variable.'
                : 'Execution environment is missing required values or attempts a forbidden Sentry triage target.',
            details: problems.length === 0
                ? [
                    `org=${orgSlug}`,
                    `project=${projectSlug}`,
                    `environment=${environment}`,
                    `action=${action}`,
                    `shortIds=${shortIds.join('|')}`,
                    `approvalProvided=${String(Boolean(approvalSentence))}`,
                ]
                : problems,
        },
        value: problems.length === 0
            ? { token, orgSlug, projectSlug, environment, action: action as TriageAction, shortIds, approvalSentence }
            : null,
    };
}

async function runApprovedExecution(env: ExecutionEnv, reportCaptures: ExecutionCapture[]): Promise<Check[]> {
    const executionChecks: Check[] = [];

    const before = await listIssues(env, 'sentry_issues_before_update_readonly', reportCaptures);
    executionChecks.push(before.check);
    if (!before.issues || before.check.status === 'failed') return executionChecks;

    const scopeCheck = validateIssueScopeBeforeUpdate(before.issues, env);
    executionChecks.push(scopeCheck);
    if (scopeCheck.status === 'failed') return executionChecks;

    const exactApprovalSentence = buildExactApprovalSentence(env);
    const exactApprovalGate: Check = {
        status: env.approvalSentence === exactApprovalSentence ? 'ok' : 'failed',
        name: 'exact_approval_gate',
        message: env.approvalSentence === exactApprovalSentence
            ? 'Exact approval sentence matched; only the listed Sentry issue status updates can run.'
            : 'Execution was requested but the exact approval gate did not match, so no Sentry issue update can run.',
        details: env.approvalSentence === exactApprovalSentence
            ? [
                `env=${approvalEnvVar}`,
                `org=${env.orgSlug}`,
                `project=${env.projectSlug}`,
                `environment=${env.environment}`,
                `action=${env.action}`,
                `shortIds=${env.shortIds.join('|')}`,
            ]
            : [
                `env=${approvalEnvVar}`,
                'required=exact sentence generated from live read-only Sentry issue preflight inputs',
                'externalWritePerformed=false',
            ],
    };
    executionChecks.push(exactApprovalGate);
    if (exactApprovalGate.status === 'failed') return executionChecks;

    const liveByShortId = new Map(before.issues.map((issue) => [normalizeShortId(issue.shortId ?? ''), issue]));
    const updateResults: Array<{ shortId: string; requestedStatus: TriageAction; resultStatus: string; ok: boolean; error?: string }> = [];

    for (const shortId of env.shortIds) {
        const issue = liveByShortId.get(shortId);
        if (!issue?.id) {
            updateResults.push({
                shortId,
                requestedStatus: env.action,
                resultStatus: 'missing',
                ok: false,
                error: 'issue id missing after scope preflight',
            });
            continue;
        }

        try {
            const updated = await sentryRequest<SentryIssue>(
                env,
                'PUT',
                `/api/0/organizations/${encodeURIComponent(env.orgSlug)}/issues/${encodeURIComponent(issue.id)}/`,
                {},
                { status: env.action },
            );
            updateResults.push({
                shortId,
                requestedStatus: env.action,
                resultStatus: updated.status ?? 'unknown',
                ok: updated.status === env.action,
            });
        } catch (error) {
            updateResults.push({
                shortId,
                requestedStatus: env.action,
                resultStatus: 'error',
                ok: false,
                error: safeErrorMessage(error),
            });
        }
    }

    const allUpdatesOk = updateResults.every((result) => result.ok);
    const updateCapture = writeExecutionCapture(
        'sentry_issue_status_updates',
        allUpdatesOk ? 'ok' : 'failed',
        true,
        'Sentry issue status update result, redacted to issue short IDs and status only.',
        { results: updateResults },
    );
    reportCaptures.push(updateCapture);
    executionChecks.push({
        status: allUpdatesOk ? 'ok' : 'failed',
        name: 'sentry_issue_status_updates',
        message: allUpdatesOk
            ? 'Sentry issue statuses were updated for the exact requested short IDs.'
            : 'One or more Sentry issue status updates failed.',
        details: [
            `capture=${updateCapture.path}`,
            `action=${env.action}`,
            `shortIds=${env.shortIds.join('|')}`,
            `failed=${updateResults.filter((result) => !result.ok).map((result) => result.shortId).join('|') || 'none'}`,
        ],
    });
    if (!allUpdatesOk) return executionChecks;

    const after = await listIssues(env, 'sentry_issues_after_update_readonly', reportCaptures);
    executionChecks.push(after.check);
    if (!after.issues || after.check.status === 'failed') return executionChecks;

    const remaining = new Set(after.issues.map((issue) => normalizeShortId(issue.shortId ?? '')));
    const stillUnresolved = env.shortIds.filter((shortId) => remaining.has(shortId));
    executionChecks.push({
        status: stillUnresolved.length === 0 ? 'ok' : 'failed',
        name: 'post_update_readonly_verification',
        message: stillUnresolved.length === 0
            ? 'Read-only verification no longer shows the requested short IDs in the unresolved issue query.'
            : 'Read-only verification still shows requested short IDs in the unresolved issue query.',
        details: [
            `action=${env.action}`,
            `stillUnresolved=${stillUnresolved.join('|') || 'none'}`,
            `query=is:unresolved`,
        ],
    });

    return executionChecks;
}

async function listIssues(
    env: ExecutionEnv,
    captureId: string,
    reportCaptures: ExecutionCapture[],
): Promise<{ check: Check; issues: SentryIssue[] | null }> {
    try {
        const issues = await sentryRequest<SentryIssue[]>(
            env,
            'GET',
            `/api/0/projects/${encodeURIComponent(env.orgSlug)}/${encodeURIComponent(env.projectSlug)}/issues/`,
            {
                query: 'is:unresolved',
                statsPeriod: '24h',
                per_page: '100',
                environment: env.environment,
            },
        );
        const snapshots = issues.map(snapshotIssue);
        const capture = writeExecutionCapture(
            captureId,
            'ok',
            false,
            'Read-only Sentry issue list; no titles, event ids, stack traces or raw payloads stored.',
            {
                org: env.orgSlug,
                project: env.projectSlug,
                environment: env.environment,
                query: 'is:unresolved',
                returned: snapshots.length,
                issues: snapshots,
            },
        );
        reportCaptures.push(capture);
        return {
            check: {
                status: 'ok',
                name: captureId,
                message: 'Sentry unresolved issue list was retrieved read-only.',
                details: [
                    `capture=${capture.path}`,
                    `org=${env.orgSlug}`,
                    `project=${env.projectSlug}`,
                    `environment=${env.environment}`,
                    `returned=${snapshots.length}`,
                ],
            },
            issues,
        };
    } catch (error) {
        const capture = writeExecutionCapture(
            captureId,
            'failed',
            false,
            'Read-only Sentry issue list failed; no issue update was attempted.',
            { error: safeErrorMessage(error), org: env.orgSlug, project: env.projectSlug, environment: env.environment },
        );
        reportCaptures.push(capture);
        return {
            check: {
                status: 'failed',
                name: captureId,
                message: 'Sentry unresolved issue list could not be retrieved read-only.',
                details: [`capture=${capture.path}`, safeErrorMessage(error)],
            },
            issues: null,
        };
    }
}

function validateIssueScopeBeforeUpdate(issues: SentryIssue[], env: ExecutionEnv): Check {
    const liveByShortId = new Map(issues.map((issue) => [normalizeShortId(issue.shortId ?? ''), issue]));
    const problems: string[] = [];
    for (const shortId of env.shortIds) {
        const issue = liveByShortId.get(shortId);
        if (!issue) {
            problems.push(`missing_live_unresolved_short_id=${shortId}`);
            continue;
        }
        if (!issue.id) problems.push(`missing_internal_issue_id_for=${shortId}`);
        if (issue.status !== 'unresolved') problems.push(`short_id_not_unresolved=${shortId}:${issue.status ?? 'unknown'}`);
        if (issue.project?.slug && issue.project.slug !== env.projectSlug) problems.push(`wrong_project_for=${shortId}`);
    }

    return {
        status: problems.length === 0 ? 'ok' : 'failed',
        name: 'sentry_issue_scope_preflight',
        message: problems.length === 0
            ? 'Live preflight found every requested short ID as unresolved in the named Sentry project/environment.'
            : 'Live preflight did not match the exact requested Sentry issue scope.',
        details: problems.length === 0
            ? [
                `org=${env.orgSlug}`,
                `project=${env.projectSlug}`,
                `environment=${env.environment}`,
                `action=${env.action}`,
                `shortIds=${env.shortIds.join('|')}`,
            ]
            : problems,
    };
}

function buildExactApprovalSentence(env: ExecutionEnv): string {
    return `Apruebo cambiar en Sentry ${env.orgSlug}/${env.projectSlug} entorno ${env.environment} los issue short IDs ${env.shortIds.join(', ')} a status ${env.action}, usando solo GET /api/0/projects/${env.orgSlug}/${env.projectSlug}/issues/ y PUT /api/0/organizations/${env.orgSlug}/issues/<issue_id>/ despues del preflight read-only, sin tocar alert rules, project settings, DSN, tokens, sourcemaps, releases, integrations, event data, stack traces, titles, raw payloads ni otros servicios externos. Despues hay que verificar con corepack pnpm --config.verify-deps-before-run=false launch:sentry-readonly y registrar evidencia sin secretos. No autorizo ningun otro cambio de Sentry ni servicios externos.`;
}

async function sentryRequest<T>(
    env: ExecutionEnv,
    method: 'GET' | 'PUT',
    pathname: string,
    params: Record<string, string> = {},
    body?: unknown,
): Promise<T> {
    const url = new URL(pathname, baseUrl);
    for (const [key, value] of Object.entries(params)) {
        url.searchParams.set(key, value);
    }

    const response = await fetch(url, {
        method,
        headers: {
            Authorization: `Bearer ${env.token}`,
            Accept: 'application/json',
            ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
    });

    if (!response.ok) {
        const error = new Error(`Sentry ${method} ${pathname} returned HTTP ${response.status}`) as SentryApiError;
        error.status = response.status;
        throw error;
    }

    return await response.json() as T;
}

function snapshotIssue(issue: SentryIssue): IssueSnapshot {
    const countValue = Number(issue.count ?? 0);
    const environmentTags = (issue.tags ?? [])
        .filter((tag) => tag.key === 'environment' && tag.value)
        .map((tag) => tag.value as string);
    return {
        shortId: normalizeShortId(issue.shortId ?? 'unknown'),
        status: safeValue(issue.status),
        level: safeValue(issue.level),
        count: Number.isFinite(countValue) ? countValue : 0,
        lastSeen: issue.lastSeen ?? null,
        environments: environmentTags.slice(0, 5),
    };
}

function writeExecutionCapture(
    id: string,
    status: CheckStatus,
    writesSentry: boolean,
    description: string,
    data: unknown,
): ExecutionCapture {
    const capturePath = path.join(outputDir, `${id}.json`);
    writeFileSync(capturePath, `${JSON.stringify({
        schemaVersion: 1,
        capturedAt: new Date().toISOString(),
        id,
        status,
        writesSentry,
        description,
        data,
    }, null, 2)}\n`, 'utf8');

    return {
        id,
        status,
        writesSentry,
        path: capturePath,
        description,
    };
}

function renderArtifacts(report: RunnerReport): RenderedArtifacts {
    const commandManifest = renderCommandManifest(report);
    const executionPlan = renderExecutionPlan(report);
    const approvalGate = renderApprovalGate(report);
    const rollbackAfterTriage = renderRollbackAfterTriage(report);
    const manualEvidenceAfterTriage = renderManualEvidenceAfterTriage(report);
    const summary = renderSummary(report);

    return { commandManifest, executionPlan, approvalGate, rollbackAfterTriage, manualEvidenceAfterTriage, summary };
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
        targetProvider: report.targetProvider,
        baseUrl: report.baseUrl,
        supportedActions: report.supportedActions,
        requiredEnv: report.requiredEnv,
        optionalEnv: [environmentEnvVar, 'SENTRY_BASE_URL'],
        approvalEnvVar: report.approvalEnvVar,
        executeFlag: '--execute-approved',
        officialApiDocs: [
            'https://docs.sentry.io/api/events/list-a-projects-issues/',
            'https://docs.sentry.io/api/events/update-an-issue/',
        ],
        planMode: {
            connectsToSentry: false,
            writesSentry: false,
            writesOtherExternalServices: false,
        },
        approvedExecutionOnly: {
            sentryReadOnlyPreflight: [
                'GET /api/0/projects/{organization_id_or_slug}/{project_id_or_slug}/issues/?query=is:unresolved',
            ],
            sentryWrite: 'PUT /api/0/organizations/{organization_id_or_slug}/issues/{issue_id}/ with { status }',
            updateScope: 'Only issue status for exact short IDs supplied in SENTRY_TRIAGE_SHORT_IDS after live read-only preflight and exact approval.',
        },
        latestSupportArtifacts: {
            triagePackSummary: toRelativeOrNull(report.latestTriagePackSummaryPath),
            triagePackApproval: toRelativeOrNull(report.latestTriagePackApprovalPath),
            sentryReadonlySummary: toRelativeOrNull(report.latestSentryReadonlySummaryPath),
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
        '# Sentry Issue Triage Runner Execution Plan',
        '',
        `- Generated: ${report.endedAt}`,
        `- Status: ${report.status}`,
        `- Closure: ${report.closureStatus}`,
        `- External write performed: ${String(report.externalWritePerformed)}`,
        `- Approval env var: ${approvalEnvVar}`,
        '',
        '## Scope',
        '',
        '- Plan mode is local-only and does not call Sentry.',
        '- Approved execution is limited to changing issue status for explicitly listed Sentry short IDs in one org/project/environment.',
        '- Supported actions are `resolved` and `ignored`; accepted-risk decisions without status changes remain manual evidence.',
        '- Before any update, the runner lists unresolved issues read-only, confirms every requested short ID is still unresolved, and builds the exact approval sentence from those execution inputs.',
        '- The update uses Sentry issue-status API only; it does not read event details, titles, stack traces, raw payloads, attachments, alerts, releases, sourcemaps, project settings or tokens.',
        '',
        '## Sequence',
        '',
        '1. Run `corepack pnpm --config.verify-deps-before-run=false launch:sentry-readonly` and review the read-only evidence.',
        '2. Run `corepack pnpm --config.verify-deps-before-run=false launch:sentry-triage-pack` and review the issue checklist, alert ownership checklist and accepted-risk options.',
        `3. Export \`SENTRY_AUTH_TOKEN\`, \`SENTRY_ORG\`, \`SENTRY_PROJECT\`, \`${actionEnvVar}\`, \`${shortIdsEnvVar}\` and \`${approvalEnvVar}\` outside repo files.`,
        '4. Execute only after exact approval: `corepack pnpm --config.verify-deps-before-run=false launch:sentry-issue-triage-runner -- --execute-approved`.',
        '5. Rerun `corepack pnpm --config.verify-deps-before-run=false launch:sentry-readonly` and record non-secret evidence or accepted risk.',
        '',
        '## Before And After Ledger',
        '',
        'Before this runner:',
        '',
        '- The Sentry triage pack could tell the operator what to inspect or document, but any future issue-status write still depended on dashboard-only manual execution.',
        '',
        'After this runner:',
        '',
        '- The same narrow status operation is commandized behind token/org/project/action/short-ID env shape, live read-only preflight, exact approval comparison, redacted captures and rollback instructions.',
        '- No external write occurs unless `--execute-approved` is passed and the approval sentence matches the live preflight inputs.',
        '',
        'Cost/benefit:',
        '',
        '- Benefit: reduces risk of changing the wrong Sentry issues or copying sensitive event data into launch evidence.',
        '- Cost: one more launch runner and approval artifact to maintain until Sentry production issue posture is closed.',
        '',
        'Rollback:',
        '',
        '- Reopen or re-triage affected issues in Sentry dashboard/API under a separate exact approval, then rerun Sentry read-only evidence and final smoke.',
        '',
        '## Forbidden Scope',
        '',
        ...forbiddenScopeLines().map((line) => `- ${line}`),
        '',
    ].join('\n')}\n`;
}

function renderApprovalGate(report: RunnerReport): string {
    return `${[
        '# Sentry Issue Triage Approval Gate',
        '',
        'This file is not approval. It describes the exact gate the runner will enforce before any Sentry write.',
        '',
        '## Required Command',
        '',
        '`corepack pnpm --config.verify-deps-before-run=false launch:sentry-issue-triage-runner -- --execute-approved`',
        '',
        '## Required Environment',
        '',
        '- `SENTRY_AUTH_TOKEN`: token with Sentry `event:read` and `event:write` or narrower equivalent; never store the value in repo files.',
        '- `SENTRY_ORG`: Sentry organization slug.',
        '- `SENTRY_PROJECT`: Sentry project slug.',
        `- \`${environmentEnvVar}\`: optional override; defaults to \`SENTRY_ENVIRONMENT\` or \`production\`.`,
        `- \`${actionEnvVar}\`: one of ${supportedActions.join(', ')}.`,
        `- \`${shortIdsEnvVar}\`: comma-separated issue short IDs from the latest read-only preflight.`,
        `- \`${approvalEnvVar}\`: the exact approval sentence generated from the runner inputs and live read-only issue preflight.`,
        '',
        '## Exact Sentence Shape',
        '',
        'The runner lists unresolved issues read-only first and then compares this exact sentence shape in memory:',
        '',
        '`Apruebo cambiar en Sentry <SENTRY_ORG>/<SENTRY_PROJECT> entorno <ENVIRONMENT> los issue short IDs <SHORT_IDS> a status <ACTION>, usando solo GET /api/0/projects/<SENTRY_ORG>/<SENTRY_PROJECT>/issues/ y PUT /api/0/organizations/<SENTRY_ORG>/issues/<issue_id>/ despues del preflight read-only, sin tocar alert rules, project settings, DSN, tokens, sourcemaps, releases, integrations, event data, stack traces, titles, raw payloads ni otros servicios externos. Despues hay que verificar con corepack pnpm --config.verify-deps-before-run=false launch:sentry-readonly y registrar evidencia sin secretos. No autorizo ningun otro cambio de Sentry ni servicios externos.`',
        '',
        'Do not write the full auth token, DSN private key, event IDs, issue titles, stack traces, request bodies, user data, raw payloads, private screenshots or alert webhook URLs into repo files, `.codex-ops`, summaries or chat.',
        '',
        `Current runner status: ${report.closureStatus}. External write performed: ${String(report.externalWritePerformed)}.`,
        '',
    ].join('\n')}\n`;
}

function renderRollbackAfterTriage(report: RunnerReport): string {
    return `${[
        '# Sentry Issue Triage Rollback',
        '',
        'Rollback applies only if the runner later performs an approved Sentry issue status update. Plan mode performs no external write.',
        '',
        '## Rollback Steps',
        '',
        '1. Identify affected short IDs from the runner capture or Sentry dashboard without copying titles, event IDs, stack traces or raw payloads.',
        '2. Decide whether the issue should be reopened, re-ignored with a new reason, or left closed with accepted risk.',
        '3. Use Sentry dashboard or a separately approved API operation scoped to those exact short IDs.',
        '4. Rerun `corepack pnpm --config.verify-deps-before-run=false launch:sentry-readonly` and confirm the intended unresolved issue posture.',
        '5. Update manual evidence with owner, reason, rollback/follow-up and final smoke impact.',
        '',
        '## Stop Conditions',
        '',
        '- Stop if the Sentry org/project/environment does not match the approval sentence.',
        '- Stop if the requested short ID is not present in the live read-only unresolved issue preflight.',
        '- Stop if the operation would fetch event details, stack traces, request bodies, user data or raw payloads.',
        '- Stop if the operation would change alert rules, project settings, DSN, tokens, sourcemaps, releases, integrations or other providers.',
        '- Stop if any secret value, event ID, issue title, private user data or raw payload would be stored in evidence.',
        '',
        `Latest support pack: ${toRelativeOrFallback(report.latestTriagePackSummaryPath, 'outputs/launch-sentry-triage-pack/<timestamp>/summary.md')}`,
        '',
    ].join('\n')}\n`;
}

function renderManualEvidenceAfterTriage(report: RunnerReport): string {
    const manifestPath = `../../${toRelative(report.commandManifestPath)}`;
    const summaryPath = `../../${toRelative(report.summaryPath)}`;
    const rollbackPath = `../../${toRelative(report.rollbackAfterTriagePath)}`;

    return `${[
        'corepack pnpm --config.verify-deps-before-run=false launch:manual-evidence:record --',
        '  --id integration_readiness',
        '  --status pass',
        '  --summary "Sentry issue triage runner reviewed/executed with non-secret evidence."',
        '  --environment production',
        '  --owner Alin',
        `  --evidence "command_output=${summaryPath}::Sentry issue triage runner summary reviewed"`,
        `  --evidence "command_output=${manifestPath}::Sentry issue triage runner command manifest reviewed"`,
        `  --evidence "command_output=${rollbackPath}::Sentry issue triage rollback reviewed"`,
        '  --evidence "manual_note=Replace with concrete non-secret result: Sentry org/project/environment, short IDs, action, post-triage launch:sentry-readonly summary path, owner/date and whether the runner executed or risk was accepted."',
        '',
        '# Add --write only after replacing the placeholder note with real non-secret evidence.',
        '',
    ].join(' \\\n')}`;
}

function renderSummary(report: RunnerReport): string {
    const lines = [
        '# Sentry Issue Triage Runner Summary',
        '',
        `- Status: ${report.status}`,
        `- Closure: ${report.closureStatus}`,
        `- Execute requested: ${String(report.executeRequested)}`,
        `- Approval matched: ${String(report.approvalMatched)}`,
        `- External write performed: ${String(report.externalWritePerformed)}`,
        `- Latest triage pack: ${toRelativeOrFallback(report.latestTriagePackSummaryPath, 'missing')}`,
        `- Latest Sentry read-only evidence: ${toRelativeOrFallback(report.latestSentryReadonlySummaryPath, 'missing')}`,
        `- Command manifest: ${toRelative(report.commandManifestPath)}`,
        `- Execution plan: ${toRelative(report.executionPlanPath)}`,
        `- Approval gate: ${toRelative(report.approvalGatePath)}`,
        `- Rollback: ${toRelative(report.rollbackAfterTriagePath)}`,
        '',
        'Plan mode is local-only. It does not connect to Sentry, does not resolve or ignore issues, does not fetch event details, stack traces, titles, raw payloads, attachments, alert rules, releases, sourcemaps, project settings or tokens, and does not store secret values.',
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
            '| Status | Capture | Writes Sentry | Path |',
            '| --- | --- | --- | --- |',
            ...report.captures.map((capture) => `| ${capture.status} | ${escapeCell(capture.id)} | ${String(capture.writesSentry)} | ${escapeCell(toRelative(capture.path))} |`),
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
        actionEnvVar,
        shortIdsEnvVar,
        '--execute-approved',
        'Plan mode is local-only',
        'GET /api/0/projects/{organization_id_or_slug}/{project_id_or_slug}/issues/',
        'PUT /api/0/organizations/{organization_id_or_slug}/issues/{issue_id}/',
        'event:read',
        'event:write',
        'No event details, stack traces, request bodies, user data, raw payloads, attachments or issue titles',
        'No alert rule, project setting, DSN, token, sourcemap, release or integration change',
        'rollback',
    ];
    const missing = required.filter((snippet) => !combined.includes(snippet));
    const unsafeSecretPatterns = [
        /Bearer\s+[A-Za-z0-9._-]{20,}/,
        /sntrys_[A-Za-z0-9_-]{20,}/,
        /sntryu_[A-Za-z0-9_-]{20,}/,
        /https:\/\/[A-Za-z0-9_-]+@[A-Za-z0-9.-]+\.ingest\.[A-Za-z0-9.-]+\/[0-9]+/,
        /SENTRY_AUTH_TOKEN\s*=\s*[^\s]+/,
    ];
    const offenders = unsafeSecretPatterns.filter((pattern) => pattern.test(combined));

    return {
        status: missing.length === 0 && offenders.length === 0 ? 'ok' : 'failed',
        name: 'generated_artifact_posture',
        message: missing.length === 0 && offenders.length === 0
            ? 'Generated Sentry runner artifacts preserve the approval gate, issue-status-only scope, rollback and no-secret posture.'
            : 'Generated Sentry runner artifacts are missing gate/scope facts or appear to include secret-like values.',
        details: [
            ...missing.map((snippet) => `missing=${snippet}`),
            ...offenders.map((pattern) => `secretPattern=${pattern}`),
        ],
    };
}

function parseShortIds(value: string): string[] {
    return [...new Set(value.split(',').map(normalizeShortId).filter(Boolean))];
}

function normalizeShortId(value: string): string {
    return value.trim().toUpperCase();
}

function safeBaseUrl(value: string): string {
    try {
        const url = new URL(value);
        return `${url.protocol}//${url.host}`;
    } catch {
        return 'invalid';
    }
}

function safeValue(value: string | undefined): string {
    return value?.replace(/[|\r\n]/g, ' ').trim() || 'unknown';
}

function safeErrorMessage(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    return message
        .replace(/Bearer\s+[A-Za-z0-9._-]+/g, 'Bearer [redacted]')
        .replace(/sntrys_[A-Za-z0-9_-]+/g, 'sntrys_[redacted]')
        .replace(/sntryu_[A-Za-z0-9_-]+/g, 'sntryu_[redacted]')
        .replace(/https:\/\/[A-Za-z0-9_-]+@/g, 'https://[redacted]@');
}

function looksPlaceholder(value: string): boolean {
    return /^(replace|change|todo|your_|dummy|example|placeholder|xxx)/i.test(value.trim());
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
        'No event details, stack traces, request bodies, user data, raw payloads, attachments or issue titles',
        'No alert rule, project setting, DSN, token, sourcemap, release or integration change',
        'No issue delete, discard, merge, assignment, bookmark, public-share or priority change',
        'No Sentry dashboard screenshot or output containing auth tokens, DSN secrets, private user data or raw logs',
        'No Cloudflare, Supabase, Stripe, Google, Resend, Turnstile, legal value, application code, checkout or email write',
        'No final smoke, production traffic change or key rotation',
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
