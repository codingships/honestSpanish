import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

type CheckStatus = 'ok' | 'warning' | 'failed';

interface ClosureCheck {
    status: CheckStatus;
    name: string;
    message: string;
    details?: string[];
}

interface StagingOperationsPreflight {
    status?: 'OK' | 'WARNING' | 'FAILED';
    targetWorkerUrl?: string;
    includedWrangler?: boolean;
    checks?: Array<{
        status?: CheckStatus;
        name?: string;
        message?: string;
        details?: string[];
    }>;
}

interface ClosureReport {
    schemaVersion: 1;
    startedAt: string;
    endedAt: string;
    status: 'OK' | 'WARNING' | 'FAILED';
    outputDir: string;
    closurePackPath: string;
    approvalRequestPath: string;
    manualEvidenceDryRunPath: string;
    evidenceManifestPath: string;
    latestOperationsSummary: string | null;
    latestStagingOperationsSummary: string | null;
    latestStagingOperationsJson: string | null;
    latestResendReadonlySummary: string | null;
    latestResendReadonlyJson: string | null;
    latestAdminJobsRuntimeSummary: string | null;
    latestAdminJobsRuntimeJson: string | null;
    closureDependencies: string[];
    stillManual: string[];
    checks: ClosureCheck[];
}

interface OperationsEvidenceManifest {
    schemaVersion: 1;
    generatedAt: string;
    status: 'OK' | 'WARNING' | 'FAILED';
    readyForManualEvidenceReview: boolean;
    closurePackPath: string;
    approvalRequestPath: string;
    manualEvidenceDryRunPath: string;
    supportEvidence: {
        operationsSummary: string | null;
        stagingOperationsSummary: string | null;
        stagingOperationsJson: string | null;
        resendReadonlySummary: string | null;
        resendReadonlyJson: string | null;
        stagingWorkerUrl: string | null;
        wranglerReadOnlyIncluded: boolean;
        adminJobsRuntimeSummary: string | null;
        adminJobsRuntimeJson: string | null;
        checks: Array<{
            name: string;
            status: CheckStatus;
            message: string;
            details: string[];
        }>;
    };
    closureDependencies: string[];
    manualEvidenceStillRequired: string[];
    readOnlyTargets: string[];
    sideEffectsRequiringSeparateApproval: string[];
    evidenceRules: string[];
    forbiddenScope: string[];
}

const startedAt = new Date();
const outputDir = path.join(process.cwd(), 'outputs', 'launch-operations-external-closure', stamp(startedAt));
mkdirSync(outputDir, { recursive: true });

const latestOperationsSummary = latestFile('launch-operations', 'summary.md');
const latestStagingOperationsSummary = latestFile('launch-staging-operations-preflight', 'summary.md');
const latestStagingOperationsJson = latestFile('launch-staging-operations-preflight', 'summary.json');
const latestResendReadonlySummary = latestFile('resend-readonly-evidence', 'summary.md');
const latestResendReadonlyJson = latestFile('resend-readonly-evidence', 'summary.json');
const latestAdminJobsRuntimeSummary = latestFile('admin-jobs-staging-runtime', 'summary.md');
const latestAdminJobsRuntimeJson = latestFile('admin-jobs-staging-runtime', 'summary.json');
const closurePackPath = path.join(outputDir, 'operations-external-closure-pack.md');
const approvalRequestPath = path.join(outputDir, 'approval-request.md');
const manualEvidenceDryRunPath = path.join(outputDir, 'manual-evidence-dry-run.txt');
const evidenceManifestPath = path.join(outputDir, 'operations-external-evidence-manifest.json');

const stillManual = [
    'Cloudflare dashboard or approved read-only evidence that Workers Logs/observability is visible for staging; cron config, staging deployment and secret-name evidence are already covered by the staging preflight.',
    'Resend staging delivery/suppression visibility.',
    'Admin Jobs recovery evidence against staging UI/runtime after database_readiness is closed, or an explicit accepted RC substitute if staging DB is still unavailable.',
];

const closureDependencies = [
    '`database_readiness` is an upstream dependency for Admin Jobs staging UI/runtime: the screen reads hosted `fulfillment_jobs` and admin audit state, so do not mark that runtime check pass while Supabase staging schema is still drifting unless Alin explicitly accepts the local UI/API/tests as a scoped RC substitute.',
    'Cloudflare Workers Logs/observability and Resend delivery/suppression can be closed by read-only dashboard evidence; sending email, tailing logs with payloads, triggering cron or mutating jobs remains a separate approval scope.',
];

const checks: ClosureCheck[] = [
    checkLatestOperationsSummary(latestOperationsSummary),
    checkLatestStagingPreflight(latestStagingOperationsSummary, latestStagingOperationsJson),
    checkLatestResendReadonlyEvidence(latestResendReadonlySummary, latestResendReadonlyJson),
    checkAdminJobsRecoverySourceEvidence(),
    checkLatestAdminJobsRuntime(latestAdminJobsRuntimeSummary, latestAdminJobsRuntimeJson),
    checkManualRequirementsExplicit(stillManual),
];

const failed = checks.filter((check) => check.status === 'failed');
const warnings = checks.filter((check) => check.status === 'warning');
const status = failed.length > 0 ? 'FAILED' : warnings.length > 0 ? 'WARNING' : 'OK';

const report: ClosureReport = {
    schemaVersion: 1,
    startedAt: startedAt.toISOString(),
    endedAt: new Date().toISOString(),
    status,
    outputDir,
    closurePackPath,
    approvalRequestPath,
    manualEvidenceDryRunPath,
    evidenceManifestPath,
    latestOperationsSummary,
    latestStagingOperationsSummary,
    latestStagingOperationsJson,
    latestResendReadonlySummary,
    latestResendReadonlyJson,
    latestAdminJobsRuntimeSummary,
    latestAdminJobsRuntimeJson,
    closureDependencies,
    stillManual,
    checks,
};

writeFileSync(path.join(outputDir, 'summary.json'), JSON.stringify(report, null, 2), 'utf8');
writeFileSync(evidenceManifestPath, JSON.stringify(renderEvidenceManifest(report), null, 2), 'utf8');
writeFileSync(path.join(outputDir, 'summary.md'), renderSummary(report), 'utf8');
writeFileSync(closurePackPath, renderClosurePack(report), 'utf8');
writeFileSync(approvalRequestPath, renderApprovalRequest(report), 'utf8');
writeFileSync(manualEvidenceDryRunPath, renderManualEvidenceDryRun(report), 'utf8');

console.log(`[launch:operations-external-closure] Status: ${status}`);
console.log(`[launch:operations-external-closure] Failed: ${failed.length}`);
console.log(`[launch:operations-external-closure] Warnings: ${warnings.length}`);
console.log(`[launch:operations-external-closure] Closure pack: ${closurePackPath}`);
console.log(`[launch:operations-external-closure] Evidence manifest: ${evidenceManifestPath}`);
console.log(`[launch:operations-external-closure] Approval request: ${approvalRequestPath}`);
console.log(`[launch:operations-external-closure] Manual evidence dry run: ${manualEvidenceDryRunPath}`);

if (failed.length > 0) process.exit(1);

function checkLatestOperationsSummary(summaryPath: string | null): ClosureCheck {
    if (!summaryPath) {
        return {
            status: 'failed',
            name: 'operations_support_audit',
            message: 'No launch:operations summary was found.',
            details: ['Run corepack pnpm launch:operations first.'],
        };
    }

    const summary = readFileSync(summaryPath, 'utf8');
    const expected = [
        'Status: OK',
        'Cloudflare fulfillment Worker',
        'fulfillment job recovery',
        'Supabase Free backup/export',
    ];
    const missing = expected.filter((snippet) => !summary.includes(snippet));

    return {
        status: missing.length === 0 ? 'ok' : 'failed',
        name: 'operations_support_audit',
        message: missing.length === 0
            ? 'Latest launch:operations support audit is available and OK.'
            : 'Latest launch:operations summary is missing expected support evidence.',
        details: [
            `summary=${toPosix(path.relative(process.cwd(), summaryPath))}`,
            ...(missing.length > 0 ? [`missing=${missing.join(', ')}`] : []),
        ],
    };
}

function checkLatestStagingPreflight(summaryPath: string | null, jsonPath: string | null): ClosureCheck {
    if (!summaryPath || !jsonPath) {
        return {
            status: 'failed',
            name: 'staging_operations_preflight',
            message: 'No staging operations preflight summary was found.',
            details: ['Run corepack pnpm launch:staging-operations -- --include-wrangler first.'],
        };
    }

    const parsed = JSON.parse(readFileSync(jsonPath, 'utf8')) as StagingOperationsPreflight;
    const failedChecks = (parsed.checks ?? []).filter((check) => check.status === 'failed');
    const checkNames = new Set((parsed.checks ?? []).map((check) => check.name));
    const missingNames = [
        'worker_health',
        'internal_route_auth',
        'worker_cron_config',
        'wrangler_whoami',
        'wrangler_deployments_status',
        'wrangler_version_view',
        'wrangler_deployments_list',
        'wrangler_secret_list',
    ].filter((name) => !checkNames.has(name));

    return {
        status: parsed.status === 'OK' && failedChecks.length === 0 && missingNames.length === 0 ? 'ok' : 'failed',
        name: 'staging_operations_preflight',
        message: parsed.status === 'OK' && failedChecks.length === 0 && missingNames.length === 0
            ? 'Latest staging operations preflight is OK and includes Wrangler read-only checks.'
            : 'Latest staging operations preflight is missing required checks or has failures.',
        details: [
            `summary=${toPosix(path.relative(process.cwd(), summaryPath))}`,
            `target=${parsed.targetWorkerUrl ?? 'unknown'}`,
            `includedWrangler=${String(parsed.includedWrangler)}`,
            ...(missingNames.length > 0 ? [`missing=${missingNames.join(', ')}`] : []),
            ...(failedChecks.length > 0 ? [`failed=${failedChecks.map((check) => check.name).join(', ')}`] : []),
        ],
    };
}

function checkLatestResendReadonlyEvidence(summaryPath: string | null, jsonPath: string | null): ClosureCheck {
    if (!summaryPath || !jsonPath) {
        return {
            status: 'warning',
            name: 'resend_readonly_evidence',
            message: 'No Resend read-only evidence summary was found.',
            details: [
                'Run corepack pnpm launch:resend-readonly -- --env-file .dev.vars with a valid staging/read-only key source, or record dashboard evidence.',
                'This command sends no email and writes only aggregate metadata.',
            ],
        };
    }

    const parsed = JSON.parse(readFileSync(jsonPath, 'utf8')) as {
        status?: 'OK' | 'WARNING' | 'FAILED';
        checks?: Array<{ status?: CheckStatus; name?: string; httpStatus?: number | null }>;
    };
    const checks = parsed.checks ?? [];
    const failedChecks = checks.filter((check) => check.status === 'failed');
    const hasEmailVisibility = checks.some((check) => check.name === 'emails_list' && check.status === 'ok');
    const hasLogVisibility = checks.some((check) => check.name === 'logs_list' && check.status === 'ok');
    const hasDomainVisibility = checks.some((check) => check.name === 'domains_list' && check.status === 'ok');
    const ok = parsed.status === 'OK'
        && failedChecks.length === 0
        && hasEmailVisibility
        && hasLogVisibility
        && hasDomainVisibility;

    return {
        status: ok ? 'ok' : 'warning',
        name: 'resend_readonly_evidence',
        message: ok
            ? 'Latest Resend read-only evidence can support delivery/suppression visibility without sending email or storing private payloads.'
            : 'Latest Resend read-only evidence is present but does not yet close Resend staging visibility.',
        details: [
            `summary=${toPosix(path.relative(process.cwd(), summaryPath))}`,
            `status=${parsed.status ?? 'unknown'}`,
            `emailList=${String(hasEmailVisibility)}`,
            `logList=${String(hasLogVisibility)}`,
            `domainList=${String(hasDomainVisibility)}`,
            ...(failedChecks.length > 0 ? [`failed=${failedChecks.map((check) => `${check.name}:${check.httpStatus ?? 'unknown'}`).join(', ')}`] : []),
        ],
    };
}

function checkManualRequirementsExplicit(requirements: string[]): ClosureCheck {
    return {
        status: 'warning',
        name: 'manual_operations_evidence',
        message: 'Manual external evidence is still required before operations_external can be marked pass.',
        details: requirements,
    };
}

function checkLatestAdminJobsRuntime(summaryPath: string | null, jsonPath: string | null): ClosureCheck {
    if (!summaryPath || !jsonPath) {
        return {
            status: 'warning',
            name: 'admin_jobs_staging_runtime',
            message: 'No Admin Jobs staging UI/runtime read-only evidence was found.',
            details: [
                'Run corepack pnpm launch:admin-jobs-staging-runtime if staging admin credentials are available; it defaults to the direct Worker staging URL unless a base URL is provided explicitly.',
                'The script does not click process, retry or cancel buttons and stores only aggregate route/control evidence.',
            ],
        };
    }

    const parsed = JSON.parse(readFileSync(jsonPath, 'utf8')) as {
        status?: 'OK' | 'WARNING' | 'FAILED';
        baseUrl?: string;
        loginReachedAdmin?: boolean;
        jobsPageReached?: boolean;
        apiStatus?: number | null;
        recoveryControlsVisible?: boolean;
        tableOrEmptyStateVisible?: boolean;
        aggregateVisibleRowCount?: number;
        mutationsPerformed?: string;
    };
    const ok = parsed.status === 'OK'
        && parsed.loginReachedAdmin === true
        && parsed.jobsPageReached === true
        && parsed.apiStatus === 200
        && parsed.recoveryControlsVisible === true
        && parsed.tableOrEmptyStateVisible === true
        && parsed.mutationsPerformed === 'none';

    return {
        status: ok ? 'ok' : 'warning',
        name: 'admin_jobs_staging_runtime',
        message: ok
            ? 'Admin Jobs staging UI/runtime read-only evidence confirms the recovery surface is reachable without mutations.'
            : 'Admin Jobs staging UI/runtime evidence exists but does not yet close the runtime review.',
        details: [
            `summary=${toPosix(path.relative(process.cwd(), summaryPath))}`,
            `status=${parsed.status ?? 'unknown'}`,
            `baseUrl=${parsed.baseUrl ?? 'unknown'}`,
            `loginReachedAdmin=${String(parsed.loginReachedAdmin === true)}`,
            `jobsPageReached=${String(parsed.jobsPageReached === true)}`,
            `apiStatus=${parsed.apiStatus ?? 'not_observed'}`,
            `recoveryControlsVisible=${String(parsed.recoveryControlsVisible === true)}`,
            `tableOrEmptyStateVisible=${String(parsed.tableOrEmptyStateVisible === true)}`,
            `aggregateVisibleRowCount=${parsed.aggregateVisibleRowCount ?? 0}`,
            `mutationsPerformed=${parsed.mutationsPerformed ?? 'unknown'}`,
        ],
    };
}

function checkAdminJobsRecoverySourceEvidence(): ClosureCheck {
    const endpointPath = path.join('src', 'pages', 'api', 'admin', 'fulfillment-jobs.ts');
    const managerPath = path.join('src', 'components', 'admin', 'FulfillmentJobsManager.tsx');
    const apiTestPath = path.join('tests', 'api', 'admin-fulfillment-jobs.test.ts');
    const uiTestPath = path.join('tests', 'unit', 'fulfillment-jobs-manager.test.tsx');
    const endpoint = readFileIfExists(endpointPath);
    const manager = readFileIfExists(managerPath);
    const apiTest = readFileIfExists(apiTestPath);
    const uiTest = readFileIfExists(uiTestPath);
    const missing = [
        ...missingSnippets(endpointPath, endpoint, [
            "z.literal('retry')",
            "z.literal('cancel')",
            "z.literal('process_due')",
            'fulfillment_jobs.process_due',
            'fulfillment_job.retry',
            'fulfillment_job.cancel',
            'admin_audit_log',
        ]),
        ...missingSnippets(managerPath, manager, [
            '/api/admin/fulfillment-jobs',
            'Procesar pendientes',
            'Reintentar',
            'Cancelar',
            'aria-label="Tabla de jobs de cumplimiento"',
        ]),
        ...missingSnippets(apiTestPath, apiTest, [
            'processes due jobs through the internal worker client and logs audit evidence',
            'retries a failed job and records before/after audit evidence',
            'cancels a job and records before/after audit evidence',
            'fulfillment_jobs.process_due',
            'fulfillment_job.retry',
            'fulfillment_job.cancel',
        ]),
        ...missingSnippets(uiTestPath, uiTest, [
            'loads the recovery table without mutating jobs',
            'posts process_due with the expected safe admin payload',
            'posts retry and cancel with the selected job id',
            'Procesar pendientes',
            'Reintentar',
            'Cancelar',
        ]),
    ];

    return {
        status: missing.length === 0 ? 'ok' : 'failed',
        name: 'admin_jobs_recovery_source_evidence',
        message: missing.length === 0
            ? 'Admin Jobs recovery UI/API/tests cover read, process_due, retry, cancel and audit evidence before staging review.'
            : 'Admin Jobs recovery source evidence is incomplete before staging review.',
        details: missing.length > 0
            ? missing
            : [
                `endpoint=${toPosix(endpointPath)}`,
                `ui=${toPosix(managerPath)}`,
                `apiTests=${toPosix(apiTestPath)}`,
                `uiTests=${toPosix(uiTestPath)}`,
                'staging_note=This proves local wiring only; staging UI/runtime visibility still needs non-secret external evidence or an explicit RC substitute.',
            ],
    };
}

function renderSummary(report: ClosureReport): string {
    const lines = [
        '# Operations External Closure Summary',
        '',
        `- Status: ${report.status}`,
        `- Closure pack: ${toPosix(path.relative(process.cwd(), report.closurePackPath))}`,
        `- Evidence manifest: ${toPosix(path.relative(process.cwd(), report.evidenceManifestPath))}`,
        `- Approval request: ${toPosix(path.relative(process.cwd(), report.approvalRequestPath))}`,
        `- Manual evidence dry run: ${toPosix(path.relative(process.cwd(), report.manualEvidenceDryRunPath))}`,
        '',
        'This command prepares evidence for `operations_external`. It does not write to Cloudflare, Resend, Supabase, Google or `docs/launch/MANUAL_EVIDENCE.local.json`.',
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
    return `${lines.join('\n')}\n`;
}

function renderClosurePack(report: ClosureReport): string {
    const latestOperations = report.latestOperationsSummary
        ? toPosix(path.relative(process.cwd(), report.latestOperationsSummary))
        : 'missing';
    const latestStaging = report.latestStagingOperationsSummary
        ? toPosix(path.relative(process.cwd(), report.latestStagingOperationsSummary))
        : 'missing';
    const latestResend = report.latestResendReadonlySummary
        ? toPosix(path.relative(process.cwd(), report.latestResendReadonlySummary))
        : 'missing';
    const latestAdminJobsRuntime = report.latestAdminJobsRuntimeSummary
        ? toPosix(path.relative(process.cwd(), report.latestAdminJobsRuntimeSummary))
        : 'missing';

    const lines = [
        '# Operations External Closure Pack',
        '',
        `- Status: ${report.status}`,
        `- Generated: ${report.endedAt}`,
        `- Latest operations support summary: ${latestOperations}`,
        `- Latest staging operations preflight: ${latestStaging}`,
        `- Latest Resend read-only evidence: ${latestResend}`,
        `- Latest Admin Jobs staging runtime evidence: ${latestAdminJobsRuntime}`,
        `- Evidence manifest: ${toPosix(path.relative(process.cwd(), report.evidenceManifestPath))}`,
        '',
        '## Scope',
        '',
        'This pack exists to close `operations_external` for the no-real-payments RC. It is local-only and read-only: it does not call external APIs, does not deploy, does not tail logs, does not send email, does not process jobs, and does not update manual evidence.',
        '',
        '## Already Prepared',
        '',
        '- `corepack pnpm launch:operations` verifies local runbooks and static recovery wiring.',
        '- `corepack pnpm launch:staging-operations -- --include-wrangler` verifies Worker staging health/auth, local cron/observability config and Wrangler read-only account, deployment history/status and secret-name evidence.',
        '- `corepack pnpm launch:resend-readonly -- --env-file <staging-env-file>` verifies Resend domain/log/email list visibility without sending email or storing private payloads.',
        '- `corepack pnpm launch:admin-jobs-staging-runtime` verifies the staging Admin Jobs route/UI/API reachability without clicking job mutation controls or storing row data.',
        '- `operations-external-evidence-manifest.json` summarizes the latest support evidence, pending manual reviews, forbidden scope and side-effect approval gates.',
        '- `admin_jobs_recovery_source_evidence` verifies local Admin Jobs UI/API/tests for read, process_due, retry, cancel and audit logging; this supports but does not replace staging UI/runtime evidence after the staging DB is ready, unless Alin explicitly accepts it as the RC substitute.',
        '',
        '## Still Manual Before Marking `operations_external` Pass',
        '',
    ];

    for (const item of report.stillManual) {
        lines.push(`- ${item}`);
    }

    lines.push(
        '',
        '## Closure Dependencies',
        '',
    );

    for (const item of report.closureDependencies) {
        lines.push(`- ${item}`);
    }

    lines.push(
        '',
        '## Evidence Rules',
        '',
        '- Record only non-secret evidence: dashboard area, environment, timestamp, result, and local output paths.',
        '- Do not paste API keys, Bearer tokens, webhook secrets, service keys, private rows, email payloads or screenshots with private data.',
        '- Production Worker, final Google Drive smoke and final backup/export remain final-only unless Alin explicitly changes scope.',
        '',
        '## Approval Scopes',
        '',
        '- Cloudflare Worker staging dashboard/log review is read-only and can be approved separately.',
        '- Resend staging dashboard review is read-only; sending a staging test email needs separate explicit approval.',
        '- Admin Jobs staging UI/runtime review is read-only unless it retries, cancels or processes a real queued job; any job mutation needs separate explicit approval.',
        '- Supabase Free backup posture review is read-only; backup/export action remains final-only unless explicitly approved.',
        '',
        '## Stop Conditions',
        '',
        '- Stop if the dashboard/resource is not clearly staging.',
        '- Stop if any evidence would expose secret values, tokens, private rows, private email payloads or personal data screenshots.',
        '- Stop before sending email, triggering cron, processing jobs or changing Worker/Pages/Resend/Supabase config without a separate explicit approval.',
        '- Stop if production Worker, Google Drive final smoke, final backup/export or Stripe live appears in scope.',
        '',
        '## Suggested Closure Sequence',
        '',
        '1. Run `corepack pnpm launch:operations`.',
        '2. Run `corepack pnpm launch:staging-operations -- --include-wrangler`.',
        '3. Run `corepack pnpm launch:resend-readonly -- --env-file <staging-env-file>` or record equivalent Resend dashboard visibility.',
        '4. Run `corepack pnpm launch:admin-jobs-staging-runtime` if staging admin credentials are available, or record why the local source/UI/API/tests are the explicitly accepted RC substitute. Pass `--base-url https://staging.espanolhonesto.com` only when closing custom-domain staging evidence deliberately.',
        '5. Review Cloudflare dashboard for Workers Logs/observability visibility on fulfillment Worker staging; cron config, staging deployment and secret-name evidence are already covered by the staging preflight.',
        '6. Review Resend staging delivery/suppression visibility if API read-only evidence is not OK.',
        '7. After `database_readiness` is closed, review Admin Jobs recovery in staging UI/runtime; if staging DB is still unavailable or credentials are unavailable, record why local recovery evidence is the explicitly accepted RC substitute.',
        '8. Open `manual-evidence-dry-run.txt`, replace placeholders with concrete non-secret evidence and run it without `--write` first.',
        '9. Add `--write` only after reviewing the dry run, then rerun `corepack pnpm launch:manual-evidence` and `corepack pnpm launch:phase1`.',
        '',
        '## Checks',
        '',
        '| Status | Check | Message | Details |',
        '| --- | --- | --- | --- |',
    );

    for (const check of report.checks) {
        lines.push(`| ${check.status} | ${check.name} | ${escapeCell(check.message)} | ${escapeCell((check.details ?? []).join(' / '))} |`);
    }

    lines.push('');
    return `${lines.join('\n')}\n`;
}

function renderApprovalRequest(report: ClosureReport): string {
    const latestOperations = report.latestOperationsSummary
        ? toPosix(path.relative(process.cwd(), report.latestOperationsSummary))
        : 'outputs/launch-operations/<timestamp>/summary.md';
    const latestStaging = report.latestStagingOperationsSummary
        ? toPosix(path.relative(process.cwd(), report.latestStagingOperationsSummary))
        : 'outputs/launch-staging-operations-preflight/<timestamp>/summary.md';
    const latestResend = report.latestResendReadonlySummary
        ? toPosix(path.relative(process.cwd(), report.latestResendReadonlySummary))
        : 'outputs/resend-readonly-evidence/<timestamp>/summary.md';

    return `${[
        '# Operations External Evidence Approval Request',
        '',
        'Use this text when asking for explicit permission to inspect or touch staging operations resources. This file is not permission by itself.',
        '',
        'Requested read-only scope:',
        '',
        '- Cloudflare fulfillment Worker staging: confirm Workers Logs/observability visibility and Pages-to-Worker URL alignment; cron config, deployment health and secret-name evidence are covered by the staging preflight.',
        '- Resend staging: confirm sender/domain, delivery event visibility and bounce/suppression visibility without copying payloads or personal data.',
        '- Admin Jobs staging UI/runtime: after `database_readiness` is closed, confirm job list/recovery path is visible and safe to operate; do not retry/cancel/process jobs unless separately approved. If staging DB is still unavailable, record only an explicit accepted RC substitute based on local UI/API/tests.',
        '- Supabase Free backup posture and rollback baseline: review current posture and keep final backup/export under final-only unless separately approved.',
        '',
        'Support evidence already generated locally:',
        '',
        `- Operations support audit: \`${latestOperations}\`.`,
        `- Staging Worker/Wrangler preflight: \`${latestStaging}\`.`,
        `- Resend read-only evidence: \`${latestResend}\`.`,
        `- Closure pack: \`${toPosix(path.relative(process.cwd(), report.closurePackPath))}\`.`,
        `- Evidence manifest: \`${toPosix(path.relative(process.cwd(), report.evidenceManifestPath))}\`.`,
        '',
        'Separate approval is required before any side effect:',
        '',
        '- Sending a Resend staging test email.',
        '- Triggering cron, calling authenticated internal Worker routes or processing fulfillment jobs.',
        '- Retrying, cancelling or mutating Admin Jobs in staging.',
        '- Changing Cloudflare Worker/Pages config, variables, secrets, deployments or cron schedules.',
        '- Any production resource, Google Drive final smoke, backup/export action, Stripe live mode or legal/final-secret change.',
        '',
        'Evidence to record after review:',
        '',
        '- Resource name, environment, timestamp, visible status/result and local output path.',
        '- For Cloudflare, record only worker/service names, Workers Logs/observability visibility and deployment status; secret names are acceptable, secret values are not.',
        '- For Resend, record only staging sender/domain and event/suppression visibility; no email bodies, recipient lists or private payload screenshots.',
        '- For Admin Jobs, record only aggregate result, whether `database_readiness` was already closed, and whether a read-only review, accepted RC substitute or explicitly approved mutation was performed.',
        '',
        'Forbidden from this approval:',
        '',
        '- Production Worker changes or deploys.',
        '- Secret reads/writes, copied API keys, bearer tokens, database URLs or private rows.',
        '- Email payloads, personal data screenshots or customer/student data exports.',
        '- Stripe live, real checkout enablement, legal real data, final secrets, domain/Search Console changes or production smoke.',
        '',
    ].join('\n')}\n`;
}

function renderManualEvidenceDryRun(report: ClosureReport): string {
    const latestOperations = report.latestOperationsSummary
        ? `../../${toPosix(path.relative(process.cwd(), report.latestOperationsSummary))}`
        : '../../outputs/launch-operations/<timestamp>/summary.md';
    const latestStaging = report.latestStagingOperationsSummary
        ? `../../${toPosix(path.relative(process.cwd(), report.latestStagingOperationsSummary))}`
        : '../../outputs/launch-staging-operations-preflight/<timestamp>/summary.md';
    const latestResend = report.latestResendReadonlySummary
        ? `../../${toPosix(path.relative(process.cwd(), report.latestResendReadonlySummary))}`
        : '../../outputs/resend-readonly-evidence/<timestamp>/summary.md';
    const latestAdminJobsRuntime = report.latestAdminJobsRuntimeSummary
        ? `../../${toPosix(path.relative(process.cwd(), report.latestAdminJobsRuntimeSummary))}`
        : '../../outputs/admin-jobs-staging-runtime/<timestamp>/summary.md';
    const closurePack = `../../${toPosix(path.relative(process.cwd(), report.closurePackPath))}`;
    const evidenceManifest = `../../${toPosix(path.relative(process.cwd(), report.evidenceManifestPath))}`;

    const commandLines = [
        'corepack pnpm launch:manual-evidence:record --',
        '  --id operations_external',
        '  --status pass',
        '  --summary "RC operations baseline refreshed: fulfillment Worker staging health/auth, local cron/observability config, read-only Wrangler deployment and secret-name evidence, Cloudflare log visibility, Resend staging visibility, Admin Jobs recovery path reviewed after database_readiness or explicitly accepted as scoped RC substitute, and rollback posture reviewed; production Worker, final Drive smoke and final backup/export remain final-only."',
        '  --environment "staging operations, production final-only"',
        '  --owner Alin',
        `  --evidence "command_output=${latestOperations}::launch operations support audit"`,
        `  --evidence "command_output=${latestStaging}::staging Worker health/auth and Wrangler read-only preflight"`,
        `  --evidence "command_output=${latestResend}::Resend read-only domain/log/email visibility without private payloads"`,
        `  --evidence "command_output=${latestAdminJobsRuntime}::Admin Jobs staging UI/runtime read-only check or documented safe failure"`,
        `  --evidence "command_output=${closurePack}::operations_external closure checklist"`,
        `  --evidence "command_output=${evidenceManifest}::structured operations evidence manifest with read-only targets and side-effect gates"`,
        '  --evidence "manual_note=Replace with concrete non-secret result: Cloudflare Workers Logs/observability visibility reviewed on <date>; Resend staging delivery/suppression reviewed; Admin Jobs staging UI/runtime recovery reviewed after database_readiness or explicitly accepted as locally covered for RC because staging DB remains unavailable."',
    ];

    return `${commandLines.join(' \\\n')}\n\n# Add --write only after reviewing the dry run output and replacing the placeholder manual_note.\n`;
}

function latestFile(outputType: string, fileName: string): string | null {
    const root = path.join(process.cwd(), 'outputs', outputType);
    if (!existsSync(root)) return null;

    const directories = readdirSync(root, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(root, entry.name))
        .sort((a, b) => b.localeCompare(a));

    for (const directory of directories) {
        const candidate = path.join(directory, fileName);
        if (existsSync(candidate)) return candidate;
    }

    return null;
}

function readFileIfExists(file: string): string {
    return existsSync(file) ? readFileSync(file, 'utf8') : '';
}

function missingSnippets(file: string, source: string, snippets: string[]): string[] {
    return snippets
        .filter((snippet) => !source.includes(snippet))
        .map((snippet) => `${toPosix(file)} missing ${snippet}`);
}

function renderEvidenceManifest(report: ClosureReport): OperationsEvidenceManifest {
    const preflight = report.latestStagingOperationsJson && existsSync(report.latestStagingOperationsJson)
        ? JSON.parse(readFileSync(report.latestStagingOperationsJson, 'utf8')) as StagingOperationsPreflight
        : null;

    return {
        schemaVersion: 1,
        generatedAt: report.endedAt,
        status: report.status,
        readyForManualEvidenceReview: report.status !== 'FAILED',
        closurePackPath: toPosix(path.relative(process.cwd(), report.closurePackPath)),
        approvalRequestPath: toPosix(path.relative(process.cwd(), report.approvalRequestPath)),
        manualEvidenceDryRunPath: toPosix(path.relative(process.cwd(), report.manualEvidenceDryRunPath)),
        supportEvidence: {
            operationsSummary: report.latestOperationsSummary ? toPosix(path.relative(process.cwd(), report.latestOperationsSummary)) : null,
            stagingOperationsSummary: report.latestStagingOperationsSummary ? toPosix(path.relative(process.cwd(), report.latestStagingOperationsSummary)) : null,
            stagingOperationsJson: report.latestStagingOperationsJson ? toPosix(path.relative(process.cwd(), report.latestStagingOperationsJson)) : null,
            resendReadonlySummary: report.latestResendReadonlySummary ? toPosix(path.relative(process.cwd(), report.latestResendReadonlySummary)) : null,
            resendReadonlyJson: report.latestResendReadonlyJson ? toPosix(path.relative(process.cwd(), report.latestResendReadonlyJson)) : null,
            stagingWorkerUrl: preflight?.targetWorkerUrl ?? null,
            wranglerReadOnlyIncluded: preflight?.includedWrangler === true,
            adminJobsRuntimeSummary: report.latestAdminJobsRuntimeSummary ? toPosix(path.relative(process.cwd(), report.latestAdminJobsRuntimeSummary)) : null,
            adminJobsRuntimeJson: report.latestAdminJobsRuntimeJson ? toPosix(path.relative(process.cwd(), report.latestAdminJobsRuntimeJson)) : null,
            checks: report.checks.map((check) => ({
                name: check.name,
                status: check.status,
                message: check.message,
                details: check.details ?? [],
            })),
        },
        closureDependencies: report.closureDependencies,
        manualEvidenceStillRequired: report.stillManual,
        readOnlyTargets: [
            'Cloudflare fulfillment Worker staging Workers Logs/observability visibility; cron config, deployment and secret-name evidence are covered by preflight.',
            'Resend staging sender/domain, delivery event and suppression visibility.',
            'Admin Jobs staging UI/runtime visibility for job recovery after database_readiness, or explicit accepted RC substitute while staging DB remains unavailable.',
            'Supabase Free backup posture and rollback baseline review.',
        ],
        sideEffectsRequiringSeparateApproval: [
            'Sending a Resend staging test email.',
            'Triggering cron or calling authenticated internal Worker routes.',
            'Retrying, cancelling or processing Admin Jobs in staging.',
            'Changing Cloudflare Worker/Pages config, variables, secrets, deployments or cron schedules.',
            'Running backup/export actions.',
        ],
        evidenceRules: [
            'Record only resource name, environment, timestamp, aggregate result and local output paths.',
            'Secret names are acceptable when already emitted by read-only tooling; secret values are not.',
            'Do not store email bodies, recipient lists, private payload screenshots, private rows, database URLs, bearer tokens or service keys.',
            'Replace placeholder manual notes before adding --write to manual evidence.',
        ],
        forbiddenScope: [
            'Production Worker changes, deploys or cron changes.',
            'Production Google Drive final smoke.',
            'Stripe live mode, real checkout enablement or payment acceptance.',
            'Real legal data, final secrets, domain/Search Console changes or production smoke.',
        ],
    };
}

function stamp(date: Date): string {
    return date.toISOString().replace(/[:.]/g, '-');
}

function toPosix(filePath: string): string {
    return filePath.split(path.sep).join('/');
}

function escapeCell(value: string): string {
    return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}
