import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

type CheckStatus = 'ok' | 'warning' | 'failed';
type PackageStatus = 'OK' | 'WARNING' | 'FAILED';
type SentryTriageStatus =
    | 'READY_FOR_FINAL_REVIEW'
    | 'READY_FOR_SENTRY_DASHBOARD_TRIAGE'
    | 'MISSING_SENTRY_READONLY_EVIDENCE'
    | 'BLOCKED_BY_SENTRY_READONLY_FAILURE';

interface Check {
    status: CheckStatus;
    name: string;
    message: string;
    details: string[];
}

interface SentryIssueRow {
    shortId?: string;
    status?: string;
    level?: string;
    count?: number;
    lastSeen?: string;
    environments?: string[];
}

interface IssueSummary {
    status?: string;
    environment?: string;
    query?: string;
    statsPeriod?: string;
    returned?: number;
    totalEventCountAcrossReturnedIssues?: number;
    latestLastSeen?: string;
    sample?: SentryIssueRow[];
}

interface SentryReadonlySummary {
    status?: string;
    baseUrl?: string;
    projectResolution?: {
        orgSlug?: string | null;
        projectSlug?: string | null;
        dsnHost?: string | null;
        dsnProjectIdSuffix?: string | null;
    };
    checks?: Array<{ status?: string; name?: string; message?: string; details?: string[] }>;
    issueThreshold?: {
        selectedEnvironment?: string;
        maxUnresolvedIssues?: number;
        source?: string;
    };
    issueSummary?: {
        selectedEnvironment?: IssueSummary;
        allEnvironment?: IssueSummary;
    };
}

interface Report {
    schemaVersion: 1;
    startedAt: string;
    endedAt: string;
    status: PackageStatus;
    sentryTriageStatus: SentryTriageStatus;
    outputDir: string;
    latestSentryReadonlySummary: string | null;
    orgSlug: string;
    projectSlug: string;
    selectedEnvironment: string;
    unresolvedCount: number;
    maxUnresolvedIssues: number;
    issueRows: SentryIssueRow[];
    checks: Check[];
    packagePath: string;
    manifestPath: string;
    approvalRequestPath: string;
    triageChecklistPath: string;
    alertOwnershipChecklistPath: string;
    acceptedRiskDryRunPath: string;
    passDryRunPath: string;
    summaryPath: string;
}

interface RenderedArtifacts {
    packageMarkdown: string;
    manifest: string;
    approvalRequest: string;
    triageChecklist: string;
    alertOwnershipChecklist: string;
    acceptedRiskDryRun: string;
    passDryRun: string;
    summary: string;
}

const startedAt = new Date();
const outputDir = path.join(process.cwd(), 'outputs', 'launch-sentry-triage-pack', stamp(startedAt));
mkdirSync(outputDir, { recursive: true });

const latestSentryReadonlySummary = latestGeneratedPath('launch-sentry-readonly-evidence', 'summary.json');
const sentrySummary = readJsonIfExists<SentryReadonlySummary>(latestSentryReadonlySummary);
const selectedSummary = sentrySummary?.issueSummary?.selectedEnvironment;
const threshold = sentrySummary?.issueThreshold;
const orgSlug = sentrySummary?.projectResolution?.orgSlug ?? 'unknown-org';
const projectSlug = sentrySummary?.projectResolution?.projectSlug ?? 'unknown-project';
const selectedEnvironment = threshold?.selectedEnvironment ?? selectedSummary?.environment ?? 'production';
const unresolvedCount = selectedSummary?.returned ?? 0;
const maxUnresolvedIssues = threshold?.maxUnresolvedIssues ?? 0;
const issueRows = selectedSummary?.sample ?? [];
const issueShortIds = issueRows.map((row) => row.shortId).filter(Boolean) as string[];

const checks: Check[] = [
    validatePackageScript(),
    validateReadonlyEvidence(),
];

let report = createReport(checks);
let rendered = renderArtifacts(report);
checks.push(validateGeneratedArtifactPosture(rendered));
report = createReport(checks);
rendered = renderArtifacts(report);

writeFileSync(report.packagePath, rendered.packageMarkdown, 'utf8');
writeFileSync(report.manifestPath, rendered.manifest, 'utf8');
writeFileSync(report.approvalRequestPath, rendered.approvalRequest, 'utf8');
writeFileSync(report.triageChecklistPath, rendered.triageChecklist, 'utf8');
writeFileSync(report.alertOwnershipChecklistPath, rendered.alertOwnershipChecklist, 'utf8');
writeFileSync(report.acceptedRiskDryRunPath, rendered.acceptedRiskDryRun, 'utf8');
writeFileSync(report.passDryRunPath, rendered.passDryRun, 'utf8');
writeFileSync(path.join(outputDir, 'summary.json'), JSON.stringify(report, null, 2), 'utf8');
writeFileSync(report.summaryPath, rendered.summary, 'utf8');

const failed = report.checks.filter((check) => check.status === 'failed');
const warnings = report.checks.filter((check) => check.status === 'warning');

console.log(`[launch:sentry-triage-pack] Status: ${report.status}`);
console.log(`[launch:sentry-triage-pack] Sentry triage: ${report.sentryTriageStatus}`);
console.log(`[launch:sentry-triage-pack] Failed: ${failed.length}`);
console.log(`[launch:sentry-triage-pack] Warnings: ${warnings.length}`);
console.log(`[launch:sentry-triage-pack] Summary: ${report.summaryPath}`);
console.log(`[launch:sentry-triage-pack] Package: ${report.packagePath}`);
console.log(`[launch:sentry-triage-pack] Approval request: ${report.approvalRequestPath}`);
console.log(`[launch:sentry-triage-pack] Triage checklist: ${report.triageChecklistPath}`);
console.log(`[launch:sentry-triage-pack] Alert ownership checklist: ${report.alertOwnershipChecklistPath}`);

if (failed.length > 0) process.exit(1);

function createReport(reportChecks: Check[]): Report {
    const status = statusFor(reportChecks);
    const sentryTriageStatus: SentryTriageStatus = !latestSentryReadonlySummary
        ? 'MISSING_SENTRY_READONLY_EVIDENCE'
        : sentrySummary?.status === 'FAILED'
            ? 'BLOCKED_BY_SENTRY_READONLY_FAILURE'
            : unresolvedCount > maxUnresolvedIssues
                ? 'READY_FOR_SENTRY_DASHBOARD_TRIAGE'
                : 'READY_FOR_FINAL_REVIEW';

    return {
        schemaVersion: 1,
        startedAt: startedAt.toISOString(),
        endedAt: new Date().toISOString(),
        status,
        sentryTriageStatus,
        outputDir,
        latestSentryReadonlySummary: latestSentryReadonlySummary ? toPosix(path.relative(process.cwd(), latestSentryReadonlySummary)) : null,
        orgSlug,
        projectSlug,
        selectedEnvironment,
        unresolvedCount,
        maxUnresolvedIssues,
        issueRows,
        checks: reportChecks,
        packagePath: path.join(outputDir, 'sentry-triage-pack.md'),
        manifestPath: path.join(outputDir, 'sentry-triage-manifest.json'),
        approvalRequestPath: path.join(outputDir, 'approval-request.md'),
        triageChecklistPath: path.join(outputDir, 'triage-checklist.md'),
        alertOwnershipChecklistPath: path.join(outputDir, 'alert-ownership-checklist.md'),
        acceptedRiskDryRunPath: path.join(outputDir, 'manual-evidence-dry-run-accepted-risk.txt'),
        passDryRunPath: path.join(outputDir, 'manual-evidence-dry-run-pass.txt'),
        summaryPath: path.join(outputDir, 'summary.md'),
    };
}

function validatePackageScript(): Check {
    const packageJson = readJsonIfExists<{ packageManager?: string; scripts?: Record<string, string> }>('package.json');
    const missing: string[] = [];
    if (!packageJson) missing.push('package.json');
    if (packageJson?.packageManager !== 'pnpm@10.33.0') missing.push('packageManager=pnpm@10.33.0');
    if (packageJson?.scripts?.['launch:sentry-triage-pack'] !== 'tsx scripts/launch/sentry-triage-pack.ts') {
        missing.push('launch:sentry-triage-pack=tsx scripts/launch/sentry-triage-pack.ts');
    }

    return {
        status: missing.length === 0 ? 'ok' : 'failed',
        name: 'package_script_sentry_triage_pack',
        message: missing.length === 0
            ? 'Package scripts expose the local-only Sentry triage pack and preserve pnpm policy.'
            : 'Package scripts are missing the Sentry triage pack or pnpm package manager contract.',
        details: missing.length === 0 ? ['launch:sentry-triage-pack'] : missing.map((item) => `missing=${item}`),
    };
}

function validateReadonlyEvidence(): Check {
    if (!latestSentryReadonlySummary || !sentrySummary) {
        return {
            status: 'warning',
            name: 'sentry_readonly_evidence_available',
            message: 'No Sentry read-only summary is available yet.',
            details: ['run=corepack pnpm --config.verify-deps-before-run=false launch:sentry-readonly'],
        };
    }

    if (sentrySummary.status === 'FAILED') {
        return {
            status: 'failed',
            name: 'sentry_readonly_evidence_available',
            message: 'Latest Sentry read-only evidence failed; do not prepare dashboard triage until that is understood.',
            details: [toPosix(path.relative(process.cwd(), latestSentryReadonlySummary))],
        };
    }

    const details = [
        `latest=${toPosix(path.relative(process.cwd(), latestSentryReadonlySummary))}`,
        `sentry_status=${sentrySummary.status ?? 'unknown'}`,
        `org=${orgSlug}`,
        `project=${projectSlug}`,
        `environment=${selectedEnvironment}`,
        `unresolved=${unresolvedCount}`,
        `max_unresolved=${maxUnresolvedIssues}`,
        `short_ids=${issueShortIds.join('|') || 'none'}`,
    ];

    return {
        status: unresolvedCount > maxUnresolvedIssues ? 'warning' : 'ok',
        name: 'sentry_readonly_evidence_available',
        message: unresolvedCount > maxUnresolvedIssues
            ? 'Latest Sentry read-only evidence needs issue triage, resolution or accepted risk.'
            : 'Latest Sentry read-only evidence is within the unresolved issue threshold.',
        details,
    };
}

function validateGeneratedArtifactPosture(renderedArtifacts: RenderedArtifacts): Check {
    const combined = Object.values(renderedArtifacts).join('\n');
    const forbiddenSecretPatterns = [
        /sntrys_[A-Za-z0-9_-]{20,}/,
        /sntryu_[A-Za-z0-9_-]{20,}/,
        /https:\/\/[A-Za-z0-9_-]+@[A-Za-z0-9.-]+\.ingest\.[A-Za-z0-9.-]+\/[0-9]+/,
        /Bearer\s+[A-Za-z0-9._-]{20,}/,
    ];
    const offenders = forbiddenSecretPatterns.filter((pattern) => pattern.test(combined));
    const requiredSafetyText = [
        'does not call Sentry',
        'does not resolve, ignore, archive or delete Sentry issues',
        'does not create or change alert rules',
        'does not fetch event details, stack traces or raw payloads',
        'exact approval',
        'accepted risk',
        'rollback',
    ];
    const missing = requiredSafetyText.filter((snippet) => !combined.includes(snippet));

    return {
        status: offenders.length === 0 && missing.length === 0 ? 'ok' : 'failed',
        name: 'generated_artifact_secret_and_scope_posture',
        message: offenders.length === 0 && missing.length === 0
            ? 'Generated Sentry triage artifacts contain scope gates and no obvious secret values.'
            : 'Generated Sentry triage artifacts are missing safety text or appear to include secret-like values.',
        details: [
            ...offenders.map((pattern) => `secretPattern=${pattern}`),
            ...missing.map((snippet) => `missing=${snippet}`),
        ],
    };
}

function renderArtifacts(report: Report): RenderedArtifacts {
    const packageMarkdown = renderPackage(report);
    const approvalRequest = renderApprovalRequest(report);
    const triageChecklist = renderTriageChecklist(report);
    const alertOwnershipChecklist = renderAlertOwnershipChecklist(report);
    const acceptedRiskDryRun = renderAcceptedRiskDryRun(report);
    const passDryRun = renderPassDryRun(report);
    const summary = renderSummary(report);
    const manifest = renderManifest(report, { packageMarkdown, approvalRequest, triageChecklist, alertOwnershipChecklist, acceptedRiskDryRun, passDryRun, summary });

    return { packageMarkdown, manifest, approvalRequest, triageChecklist, alertOwnershipChecklist, acceptedRiskDryRun, passDryRun, summary };
}

function renderPackage(report: Report): string {
    return `${[
        '# Sentry Triage Pack',
        '',
        `- Generated: ${report.endedAt}`,
        `- Status: ${report.status}`,
        `- Sentry triage status: ${report.sentryTriageStatus}`,
        `- Latest Sentry read-only summary: ${report.latestSentryReadonlySummary ?? 'missing'}`,
        `- Project: ${report.orgSlug}/${report.projectSlug}`,
        `- Environment: ${report.selectedEnvironment}`,
        `- Unresolved issue count: ${report.unresolvedCount}`,
        `- Max unresolved threshold: ${report.maxUnresolvedIssues}`,
        '',
        'This package is local-only. It does not call Sentry, does not resolve, ignore, archive or delete Sentry issues, does not create or change alert rules, does not upload sourcemaps, does not fetch event details, stack traces or raw payloads, does not retrieve secret values and does not write external services.',
        '',
        '## Current Issue Queue',
        '',
        ...renderIssueRows(report.issueRows),
        '',
        '## Required Next Step',
        '',
        report.sentryTriageStatus === 'READY_FOR_SENTRY_DASHBOARD_TRIAGE'
            ? '- Use `triage-checklist.md` and `approval-request.md` to decide whether to resolve/ignore each listed short ID in Sentry dashboard, or record accepted risk with owner, impact, monitor and rollback.'
            : '- No Sentry issue-triage action is currently proposed by this pack.',
        '',
        '## Before And After Ledger',
        '',
        'Before this package:',
        '',
        '- Sentry read-only evidence exposed unresolved short IDs, but final reviewers still had to infer the triage path, alert ownership proof, accepted risk fields and exact dashboard write boundary.',
        '',
        'After this package:',
        '',
        '- The unresolved issue queue, exact approval boundary, alert ownership checklist, accepted-risk dry run and pass dry run are generated from latest read-only evidence.',
        '- No Sentry issue status, alert, project, release, sourcemap, token, DSN, external service, app behavior, legal value or UX style changed.',
        '',
        'Cost/benefit:',
        '',
        '- Benefit: reduces false integration closure risk from unresolved Sentry issues and prevents storing sensitive event details in QA artifacts.',
        '- Cost: one additional local support script/output folder to maintain.',
        '',
        'Rollback:',
        '',
        '- Remove this generator, package script, runbook/test references and generated outputs. No Sentry rollback is required because this package performs no external write.',
        '',
    ].join('\n')}\n`;
}

function renderApprovalRequest(report: Report): string {
    const ids = issueShortIds.join(', ') || 'none';
    return `${[
        '# Sentry Triage Approval Request',
        '',
        'This is not approval by itself. Paste the exact approval sentence only after the Sentry dashboard project, environment and issue short IDs are reviewed.',
        'The exact approval scope is limited to manual dashboard triage for the listed short IDs.',
        '',
        '## Preflight',
        '',
        `- Latest read-only evidence: ${report.latestSentryReadonlySummary ?? 'missing'}`,
        `- Project: ${report.orgSlug}/${report.projectSlug}`,
        `- Environment: ${report.selectedEnvironment}`,
        `- Unresolved issue count: ${report.unresolvedCount}`,
        `- Short IDs: ${ids}`,
        '',
        '## Exact Approval Sentence For Dashboard Triage',
        '',
        `Apruebo hacer triage manual en Sentry ${report.orgSlug}/${report.projectSlug} entorno ${report.selectedEnvironment} solo para estos issue short IDs: ${ids}. La accion permitida es marcar cada issue como resuelto o ignorado con razon en dashboard, o dejarlo abierto si se documenta accepted risk; no autorizo cambiar alert rules, project settings, DSN, tokens, sourcemaps, releases, integrations, datos de eventos, ni ningun servicio externo. Despues hay que verificar con corepack pnpm --config.verify-deps-before-run=false launch:sentry-readonly y registrar evidencia sin secretos, sin titles, sin event IDs, sin stack traces y sin raw payloads.`,
        '',
        '## Forbidden Scope',
        '',
        '- Do not fetch or export event details, stack traces, request bodies, user data or raw payloads.',
        '- Do not create or change alert rules unless separately approved.',
        '- Do not upload sourcemaps, rotate tokens, change DSN/project settings or edit releases.',
        '- Do not touch Cloudflare, Supabase, Stripe, Google, Resend, DNS or application code as part of this approval.',
        '',
    ].join('\n')}\n`;
}

function renderTriageChecklist(report: Report): string {
    return `${[
        '# Sentry Issue Triage Checklist',
        '',
        '- Confirm dashboard project and environment match the read-only evidence.',
        '- For each listed short ID, decide exactly one state: resolved after verified fix, ignored with dashboard rationale, left open with accepted risk, or post-launch backlog with owner.',
        '- Do not copy titles, event IDs, stack traces, request bodies, user data, user IPs or raw payloads into repo artifacts.',
        '- Confirm whether any high-count or recent issue blocks final smoke or launch.',
        '- Confirm alert owner, notification route and review cadence before final integration pass.',
        '- Rerun `corepack pnpm --config.verify-deps-before-run=false launch:sentry-readonly` after dashboard triage.',
        '- Expected pass path: selected unresolved count is at or below threshold, or accepted-risk evidence names the remaining count, owner, impact, monitor and rollback.',
        '',
        '## Issue Rows',
        '',
        ...renderIssueRows(report.issueRows),
        '',
    ].join('\n')}\n`;
}

function renderAlertOwnershipChecklist(report: Report): string {
    return `${[
        '# Sentry Alert Ownership Checklist',
        '',
        '- Owner named for launch window Sentry monitoring.',
        '- Notification channel checked without storing webhook URLs or tokens.',
        '- Privacy scrubbing posture reviewed: no sensitive event details are copied into QA artifacts.',
        '- Release/environment tagging reviewed for the final runtime.',
        '- Local/dev capture isolation reviewed (`SENTRY_CAPTURE_LOCAL=false` unless explicitly debugging).',
        '- Escalation path and rollback/fallback owner named for new production errors.',
        '- Final smoke evidence links to Sentry check or accepted risk if unresolved issues remain.',
        '',
        `Current read-only source: ${report.latestSentryReadonlySummary ?? 'missing'}`,
        '',
    ].join('\n')}\n`;
}

function renderAcceptedRiskDryRun(report: Report): string {
    const packagePath = `../../${toPosix(path.relative(process.cwd(), report.packagePath))}`;
    const manifestPath = `../../${toPosix(path.relative(process.cwd(), report.manifestPath))}`;
    const checklistPath = `../../${toPosix(path.relative(process.cwd(), report.triageChecklistPath))}`;

    return `${[
        'corepack pnpm --config.verify-deps-before-run=false launch:manual-evidence:record --',
        '  --id integration_readiness',
        '  --status accepted_risk',
        '  --summary "Sentry unresolved issue limitation is reviewed and accepted for launch."',
        '  --environment production',
        '  --owner Alin',
        '  --risk-accepted-by Alin',
        `  --risk-rationale "Replace with concrete rationale: ${report.unresolvedCount} unresolved Sentry issues remain in ${report.orgSlug}/${report.projectSlug} ${report.selectedEnvironment}, impact is scoped, owner and monitor are named, and no sensitive event data is stored."`,
        '  --rollback-plan "Replace with concrete plan: pause affected workflow or release, inspect Sentry dashboard, revert/fix the source change, rerun launch:sentry-readonly and final smoke, then update manual evidence."',
        `  --evidence "command_output=${packagePath}::Sentry triage package reviewed"`,
        `  --evidence "command_output=${manifestPath}::Sentry triage manifest reviewed"`,
        `  --evidence "command_output=${checklistPath}::Sentry issue triage checklist completed"`,
        '  --evidence "manual_note=Replace with concrete non-secret result: issue short IDs triaged, owner/cadence/alert route reviewed, remaining risk and rollback accepted."',
        '',
        '# Add --write only after replacing placeholders with concrete accepted-risk evidence.',
        '',
    ].join(' \\\n')}`;
}

function renderPassDryRun(report: Report): string {
    const packagePath = `../../${toPosix(path.relative(process.cwd(), report.packagePath))}`;
    const manifestPath = `../../${toPosix(path.relative(process.cwd(), report.manifestPath))}`;
    const alertPath = `../../${toPosix(path.relative(process.cwd(), report.alertOwnershipChecklistPath))}`;

    return `${[
        'corepack pnpm --config.verify-deps-before-run=false launch:manual-evidence:record --',
        '  --id integration_readiness',
        '  --status pass',
        '  --summary "Sentry issue triage, alert ownership and release/environment posture verified."',
        '  --environment production',
        '  --owner Alin',
        `  --evidence "command_output=${packagePath}::Sentry triage package reviewed"`,
        `  --evidence "command_output=${manifestPath}::Sentry triage manifest reviewed"`,
        `  --evidence "command_output=${alertPath}::Sentry alert ownership checklist completed"`,
        '  --evidence "manual_note=Replace with concrete non-secret result: unresolved count at/below threshold or issues resolved/ignored with dashboard rationale; owner/cadence/privacy/release tags checked."',
        '',
        '# Add --write only after replacing the placeholder note with real non-secret evidence.',
        '',
    ].join(' \\\n')}`;
}

function renderSummary(report: Report): string {
    const lines = [
        '# Sentry Triage Pack Summary',
        '',
        `- Status: ${report.status}`,
        `- Sentry triage status: ${report.sentryTriageStatus}`,
        `- Latest Sentry read-only summary: ${report.latestSentryReadonlySummary ?? 'missing'}`,
        `- Project: ${report.orgSlug}/${report.projectSlug}`,
        `- Environment: ${report.selectedEnvironment}`,
        `- Unresolved issue count: ${report.unresolvedCount}`,
        `- Max unresolved threshold: ${report.maxUnresolvedIssues}`,
        `- Package: ${toPosix(path.relative(process.cwd(), report.packagePath))}`,
        `- Approval request: ${toPosix(path.relative(process.cwd(), report.approvalRequestPath))}`,
        `- Triage checklist: ${toPosix(path.relative(process.cwd(), report.triageChecklistPath))}`,
        `- Alert ownership checklist: ${toPosix(path.relative(process.cwd(), report.alertOwnershipChecklistPath))}`,
        '',
        'This package is local-only. It does not call Sentry, does not resolve, ignore, archive or delete Sentry issues, does not create or change alert rules, and does not fetch event details, stack traces or raw payloads.',
        '',
        '| Status | Check | Message | Details |',
        '| --- | --- | --- | --- |',
    ];

    for (const check of report.checks) {
        lines.push(`| ${check.status} | ${check.name} | ${escapeCell(check.message)} | ${escapeCell(check.details.join(' / '))} |`);
    }

    lines.push('');
    return `${lines.join('\n')}\n`;
}

function renderManifest(report: Report, renderedFiles: Omit<RenderedArtifacts, 'manifest'>): string {
    return `${JSON.stringify({
        schemaVersion: 1,
        generatedAt: report.endedAt,
        status: report.status,
        sentryTriageStatus: report.sentryTriageStatus,
        latestSentryReadonlySummary: report.latestSentryReadonlySummary,
        orgSlug: report.orgSlug,
        projectSlug: report.projectSlug,
        selectedEnvironment: report.selectedEnvironment,
        unresolvedCount: report.unresolvedCount,
        maxUnresolvedIssues: report.maxUnresolvedIssues,
        issueRows: report.issueRows,
        doesNotCallSentry: true,
        doesNotWriteExternalServices: true,
        doesNotFetchEventDetails: true,
        forbiddenScope: [
            'event details, stack traces, request bodies, user data, raw payloads',
            'alert rules/project settings/DSN/tokens/sourcemaps/releases',
            'Cloudflare/Supabase/Stripe/Google/Resend/DNS/app writes',
        ],
        files: {
            package: fileMeta(report.packagePath, renderedFiles.packageMarkdown),
            approvalRequest: fileMeta(report.approvalRequestPath, renderedFiles.approvalRequest),
            triageChecklist: fileMeta(report.triageChecklistPath, renderedFiles.triageChecklist),
            alertOwnershipChecklist: fileMeta(report.alertOwnershipChecklistPath, renderedFiles.alertOwnershipChecklist),
            acceptedRiskDryRun: fileMeta(report.acceptedRiskDryRunPath, renderedFiles.acceptedRiskDryRun),
            passDryRun: fileMeta(report.passDryRunPath, renderedFiles.passDryRun),
            summary: fileMeta(report.summaryPath, renderedFiles.summary),
        },
        checks: report.checks,
    }, null, 2)}\n`;
}

function renderIssueRows(rows: SentryIssueRow[]): string[] {
    if (rows.length === 0) return ['- No issue short IDs were returned by the latest read-only summary.'];

    return [
        '| Short ID | Status | Level | Count | Last seen | Environments |',
        '| --- | --- | --- | ---: | --- | --- |',
        ...rows.map((row) => `| ${escapeCell(row.shortId ?? 'unknown')} | ${escapeCell(row.status ?? 'unknown')} | ${escapeCell(row.level ?? 'unknown')} | ${row.count ?? 0} | ${escapeCell(row.lastSeen ?? 'unknown')} | ${escapeCell(row.environments?.join(', ') || 'none')} |`),
    ];
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

function fileMeta(filePath: string, contents: string) {
    return {
        path: toPosix(path.relative(process.cwd(), filePath)),
        sha256: createHash('sha256').update(contents).digest('hex'),
        bytes: Buffer.byteLength(contents, 'utf8'),
    };
}

function statusFor(checkList: Check[]): PackageStatus {
    if (checkList.some((check) => check.status === 'failed')) return 'FAILED';
    if (checkList.some((check) => check.status === 'warning')) return 'WARNING';
    return 'OK';
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
