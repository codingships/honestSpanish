import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

type CheckStatus = 'ok' | 'warning' | 'failed';
type PackageStatus = 'OK' | 'WARNING' | 'FAILED';
type TurnstileClosureStatus =
    | 'READY_FOR_FINAL_REVIEW'
    | 'READY_FOR_CLOUDFLARE_DASHBOARD_REVIEW'
    | 'MISSING_TURNSTILE_READONLY_EVIDENCE'
    | 'BLOCKED_BY_TURNSTILE_READONLY_FAILURE';

interface Check {
    status: CheckStatus;
    name: string;
    message: string;
    details: string[];
}

interface SummaryCheck {
    status?: string;
    name?: string;
    message?: string;
    details?: string[];
}

interface TurnstileReadonlySummary {
    status?: string;
    envFile?: string;
    checks?: SummaryCheck[];
}

interface Report {
    schemaVersion: 1;
    startedAt: string;
    endedAt: string;
    status: PackageStatus;
    turnstileClosureStatus: TurnstileClosureStatus;
    outputDir: string;
    latestTurnstileReadonlySummary: string | null;
    envFile: string;
    account: string;
    siteKeyPrefix: string;
    widgetName: string;
    widgetMode: string;
    widgetClearanceLevel: string;
    expectedDomains: string[];
    configuredDomains: string[];
    missingExpectedDomains: string[];
    missingCloudflareApiInputs: string[];
    runtimeSiteverifyStatus: string;
    widgetReadonlyStatus: string;
    checks: Check[];
    packagePath: string;
    manifestPath: string;
    approvalRequestPath: string;
    dashboardEvidenceChecklistPath: string;
    verificationChecklistPath: string;
    rollbackPlanPath: string;
    manualEvidenceDryRunPath: string;
    summaryPath: string;
}

interface RenderedArtifacts {
    packageMarkdown: string;
    manifest: string;
    approvalRequest: string;
    dashboardEvidenceChecklist: string;
    verificationChecklist: string;
    rollbackPlan: string;
    manualEvidenceDryRun: string;
    summary: string;
}

const startedAt = new Date();
const outputDir = path.join(process.cwd(), 'outputs', 'launch-turnstile-domain-closure-pack', stamp(startedAt));
mkdirSync(outputDir, { recursive: true });

const latestTurnstileReadonlySummary = latestGeneratedPath('launch-turnstile-readonly-evidence', 'summary.json');
const turnstileSummary = readJsonIfExists<TurnstileReadonlySummary>(latestTurnstileReadonlySummary);
const environmentCheck = turnstileSummary?.checks?.find((check) => check.name === 'environment_shape');
const siteverifyCheck = turnstileSummary?.checks?.find((check) => check.name === 'siteverify_fake_token_rejection');
const widgetCheck = turnstileSummary?.checks?.find((check) => check.name === 'turnstile_widgets_readonly');

const envFile = turnstileSummary?.envFile ?? '.env';
const account = detailValue(widgetCheck?.details, 'account') || detailValue(environmentCheck?.details, 'account') || 'missing';
const siteKeyPrefix = detailValue(widgetCheck?.details, 'matched_site_key')
    || detailValue(environmentCheck?.details, 'site_key')
    || 'missing';
const widgetName = detailValue(widgetCheck?.details, 'name') || 'dashboard review required';
const widgetMode = detailValue(widgetCheck?.details, 'mode') || 'unknown';
const widgetClearanceLevel = detailValue(widgetCheck?.details, 'clearance_level') || 'unknown';
const expectedDomains = unique([
    ...detailList(widgetCheck?.details, 'expected_domains'),
    ...detailList(environmentCheck?.details, 'expected_domains'),
    'espanolhonesto.com',
    'www.espanolhonesto.com',
    'staging.espanolhonesto.com',
]).sort();
const configuredDomains = unique(detailList(widgetCheck?.details, 'domains')).sort();
const missingExpectedDomains = widgetCheck
    ? unique(detailList(widgetCheck.details, 'missing_expected_domains')).sort()
    : expectedDomains;
const missingCloudflareApiInputs = unique(detailList(environmentCheck?.details, 'missing_cloudflare_api')).sort();
const runtimeSiteverifyStatus = siteverifyCheck?.status ?? 'missing';
const widgetReadonlyStatus = widgetCheck?.status ?? 'missing';

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
writeFileSync(report.dashboardEvidenceChecklistPath, rendered.dashboardEvidenceChecklist, 'utf8');
writeFileSync(report.verificationChecklistPath, rendered.verificationChecklist, 'utf8');
writeFileSync(report.rollbackPlanPath, rendered.rollbackPlan, 'utf8');
writeFileSync(report.manualEvidenceDryRunPath, rendered.manualEvidenceDryRun, 'utf8');
writeFileSync(path.join(outputDir, 'summary.json'), JSON.stringify(report, null, 2), 'utf8');
writeFileSync(report.summaryPath, rendered.summary, 'utf8');

const failed = report.checks.filter((check) => check.status === 'failed');
const warnings = report.checks.filter((check) => check.status === 'warning');

console.log(`[launch:turnstile-domain-closure-pack] Status: ${report.status}`);
console.log(`[launch:turnstile-domain-closure-pack] Turnstile closure: ${report.turnstileClosureStatus}`);
console.log(`[launch:turnstile-domain-closure-pack] Failed: ${failed.length}`);
console.log(`[launch:turnstile-domain-closure-pack] Warnings: ${warnings.length}`);
console.log(`[launch:turnstile-domain-closure-pack] Summary: ${report.summaryPath}`);
console.log(`[launch:turnstile-domain-closure-pack] Package: ${report.packagePath}`);
console.log(`[launch:turnstile-domain-closure-pack] Approval request: ${report.approvalRequestPath}`);
console.log(`[launch:turnstile-domain-closure-pack] Dashboard evidence checklist: ${report.dashboardEvidenceChecklistPath}`);
console.log(`[launch:turnstile-domain-closure-pack] Verification checklist: ${report.verificationChecklistPath}`);
console.log(`[launch:turnstile-domain-closure-pack] Rollback plan: ${report.rollbackPlanPath}`);

if (failed.length > 0) process.exit(1);

function createReport(reportChecks: Check[]): Report {
    const status = statusFor(reportChecks);
    const turnstileClosureStatus: TurnstileClosureStatus = !latestTurnstileReadonlySummary
        ? 'MISSING_TURNSTILE_READONLY_EVIDENCE'
        : turnstileSummary?.status === 'FAILED'
            ? 'BLOCKED_BY_TURNSTILE_READONLY_FAILURE'
            : widgetReadonlyStatus === 'ok'
                ? 'READY_FOR_FINAL_REVIEW'
                : 'READY_FOR_CLOUDFLARE_DASHBOARD_REVIEW';

    return {
        schemaVersion: 1,
        startedAt: startedAt.toISOString(),
        endedAt: new Date().toISOString(),
        status,
        turnstileClosureStatus,
        outputDir,
        latestTurnstileReadonlySummary: latestTurnstileReadonlySummary
            ? toPosix(path.relative(process.cwd(), latestTurnstileReadonlySummary))
            : null,
        envFile,
        account,
        siteKeyPrefix,
        widgetName,
        widgetMode,
        widgetClearanceLevel,
        expectedDomains,
        configuredDomains,
        missingExpectedDomains,
        missingCloudflareApiInputs,
        runtimeSiteverifyStatus,
        widgetReadonlyStatus,
        checks: reportChecks,
        packagePath: path.join(outputDir, 'turnstile-domain-closure-pack.md'),
        manifestPath: path.join(outputDir, 'turnstile-domain-closure-manifest.json'),
        approvalRequestPath: path.join(outputDir, 'approval-request.md'),
        dashboardEvidenceChecklistPath: path.join(outputDir, 'dashboard-evidence-checklist.md'),
        verificationChecklistPath: path.join(outputDir, 'verification-checklist.md'),
        rollbackPlanPath: path.join(outputDir, 'rollback-plan.md'),
        manualEvidenceDryRunPath: path.join(outputDir, 'manual-evidence-dry-run.txt'),
        summaryPath: path.join(outputDir, 'summary.md'),
    };
}

function validatePackageScript(): Check {
    const packageJson = readJsonIfExists<{ packageManager?: string; scripts?: Record<string, string> }>('package.json');
    const missing: string[] = [];
    if (!packageJson) missing.push('package.json');
    if (packageJson?.packageManager !== 'pnpm@10.33.0') missing.push('packageManager=pnpm@10.33.0');
    if (packageJson?.scripts?.['launch:turnstile-domain-closure-pack'] !== 'tsx scripts/launch/turnstile-domain-closure-pack.ts') {
        missing.push('launch:turnstile-domain-closure-pack=tsx scripts/launch/turnstile-domain-closure-pack.ts');
    }

    return {
        status: missing.length === 0 ? 'ok' : 'failed',
        name: 'package_script_turnstile_domain_closure_pack',
        message: missing.length === 0
            ? 'Package scripts expose the local-only Turnstile domain closure pack and preserve pnpm policy.'
            : 'Package scripts are missing the Turnstile domain closure pack or pnpm package manager contract.',
        details: missing.length === 0 ? ['launch:turnstile-domain-closure-pack'] : missing.map((item) => `missing=${item}`),
    };
}

function validateReadonlyEvidence(): Check {
    if (!latestTurnstileReadonlySummary || !turnstileSummary) {
        return {
            status: 'warning',
            name: 'turnstile_readonly_evidence_available',
            message: 'No Turnstile read-only summary is available yet.',
            details: ['run=corepack pnpm --config.verify-deps-before-run=false launch:turnstile-readonly'],
        };
    }

    if (turnstileSummary.status === 'FAILED') {
        return {
            status: 'failed',
            name: 'turnstile_readonly_evidence_available',
            message: 'Latest Turnstile read-only evidence failed; do not prepare dashboard/domain closure until that is understood.',
            details: [toPosix(path.relative(process.cwd(), latestTurnstileReadonlySummary))],
        };
    }

    const needsDashboardReview = widgetReadonlyStatus !== 'ok';

    return {
        status: needsDashboardReview ? 'warning' : 'ok',
        name: 'turnstile_readonly_evidence_available',
        message: needsDashboardReview
            ? 'Latest Turnstile read-only evidence still needs Cloudflare widget/domain dashboard or API closure.'
            : 'Latest Turnstile read-only evidence already confirms the configured widget and expected domains.',
        details: [
            `latest=${toPosix(path.relative(process.cwd(), latestTurnstileReadonlySummary))}`,
            `turnstile_status=${turnstileSummary.status ?? 'unknown'}`,
            `env_file=${envFile}`,
            `runtime_siteverify=${runtimeSiteverifyStatus}`,
            `widget_readonly=${widgetReadonlyStatus}`,
            `account=${account}`,
            `site_key=${siteKeyPrefix}`,
            `widget_name=${widgetName}`,
            `configured_domains=${configuredDomains.join('|') || 'unknown'}`,
            `expected_domains=${expectedDomains.join('|') || 'unknown'}`,
            `missing_expected_domains=${missingExpectedDomains.join('|') || 'none'}`,
            `missing_cloudflare_api=${missingCloudflareApiInputs.join('|') || 'none'}`,
        ],
    };
}

function validateGeneratedArtifactPosture(renderedArtifacts: RenderedArtifacts): Check {
    const combined = Object.values(renderedArtifacts).join('\n');
    const forbiddenSecretPatterns = [
        /Bearer\s+[A-Za-z0-9._-]{20,}/,
        /cf-[A-Za-z0-9_-]{32,}/,
        /TURNSTILE_SECRET_KEY\s*=\s*[^\s]+/,
        /CLOUDFLARE_API_TOKEN\s*=\s*[^\s]+/,
        /(postgres|postgresql):\/\/[^\s"']+:[^\s"']+@/,
    ];
    const offenders = forbiddenSecretPatterns.filter((pattern) => pattern.test(combined));
    const requiredSafetyText = [
        'does not call Cloudflare',
        'does not create, update or delete Turnstile widgets',
        'does not change DNS, Workers, Pages, WAF, secrets or domains',
        'exact approval',
        'dashboard evidence',
        'rollback',
    ];
    const missing = requiredSafetyText.filter((snippet) => !combined.includes(snippet));

    return {
        status: offenders.length === 0 && missing.length === 0 ? 'ok' : 'failed',
        name: 'generated_artifact_secret_and_scope_posture',
        message: offenders.length === 0 && missing.length === 0
            ? 'Generated Turnstile closure artifacts contain scope gates and no obvious secret values.'
            : 'Generated Turnstile closure artifacts are missing safety text or appear to include secret-like values.',
        details: [
            ...offenders.map((pattern) => `secretPattern=${pattern}`),
            ...missing.map((snippet) => `missing=${snippet}`),
        ],
    };
}

function renderArtifacts(report: Report): RenderedArtifacts {
    const packageMarkdown = renderPackage(report);
    const approvalRequest = renderApprovalRequest(report);
    const dashboardEvidenceChecklist = renderDashboardEvidenceChecklist(report);
    const verificationChecklist = renderVerificationChecklist(report);
    const rollbackPlan = renderRollbackPlan(report);
    const manualEvidenceDryRun = renderManualEvidenceDryRun(report);
    const summary = renderSummary(report);
    const manifest = renderManifest(report, {
        packageMarkdown,
        approvalRequest,
        dashboardEvidenceChecklist,
        verificationChecklist,
        rollbackPlan,
        manualEvidenceDryRun,
        summary,
    });

    return {
        packageMarkdown,
        manifest,
        approvalRequest,
        dashboardEvidenceChecklist,
        verificationChecklist,
        rollbackPlan,
        manualEvidenceDryRun,
        summary,
    };
}

function renderPackage(report: Report): string {
    return `${[
        '# Turnstile Domain Closure Pack',
        '',
        `- Status: ${report.status}`,
        `- Turnstile closure: ${report.turnstileClosureStatus}`,
        `- Latest read-only evidence: ${report.latestTurnstileReadonlySummary ?? 'missing'}`,
        `- Env file: ${report.envFile}`,
        `- Account: ${report.account}`,
        `- Site key prefix: ${report.siteKeyPrefix}`,
        `- Widget name: ${report.widgetName}`,
        `- Expected domains: ${report.expectedDomains.join(', ') || 'unknown'}`,
        `- Configured domains: ${report.configuredDomains.join(', ') || 'unknown'}`,
        `- Missing expected domains: ${report.missingExpectedDomains.join(', ') || 'none'}`,
        '',
        'This package is local-only. It does not call Cloudflare, does not create, update or delete Turnstile widgets, does not change DNS, Workers, Pages, WAF, secrets or domains, does not rotate keys and does not write external services.',
        '',
        '## Required Next Step',
        '',
        report.turnstileClosureStatus === 'READY_FOR_FINAL_REVIEW'
            ? '- Turnstile widget/domain read-only evidence is already OK; complete final browser smoke and record non-secret evidence.'
            : '- Use `approval-request.md`, `dashboard-evidence-checklist.md` and `verification-checklist.md` to confirm or correct the Turnstile widget/domain posture in Cloudflare dashboard or through read-only API evidence.',
        '',
        '## Before And After Ledger',
        '',
        'Before this package:',
        '',
        '- `launch:turnstile-readonly` could prove runtime key shape and fake-token rejection, but dashboard/API widget-domain evidence remained easy to leave as a loose manual note.',
        '',
        'After this package:',
        '',
        '- The exact approval boundary, expected domains, dashboard evidence fields, verification command and rollback path are generated from the latest read-only Turnstile evidence.',
        '- No Cloudflare widget, DNS, Worker, Page, WAF, secret, token, Turnstile key, runtime behavior, legal value, UX style or private data changed.',
        '',
        'Cost/benefit:',
        '',
        '- Benefit: makes Turnstile dashboard/domain closure reviewable and reversible without broad Cloudflare permissions or secret exposure.',
        '- Cost: one local support script/output folder and static test coverage to maintain.',
        '',
        'Reversibility:',
        '',
        '- Remove the package command/docs/tests/integration pointer and generated artifacts. This reopens the looser Turnstile dashboard/domain evidence path but does not affect runtime code or external services.',
    ].join('\n')}\n`;
}

function renderApprovalRequest(report: Report): string {
    const domains = report.expectedDomains.join(', ') || 'the expected launch domains';

    return `${[
        '# Turnstile Dashboard Approval Request',
        '',
        'This is not approval by itself. Paste the exact approval sentence only after the Cloudflare account, widget, site key prefix and expected domains are reviewed.',
        'The exact approval scope is limited to the named Turnstile widget/domain review or correction.',
        '',
        '## Preflight',
        '',
        `- Latest read-only evidence: ${report.latestTurnstileReadonlySummary ?? 'missing'}`,
        `- Account: ${report.account}`,
        `- Site key prefix: ${report.siteKeyPrefix}`,
        `- Widget name: ${report.widgetName}`,
        `- Expected domains: ${domains}`,
        '',
        '## Exact Approval Sentence For Dashboard Review',
        '',
        `Apruebo revisar y, si falta algun dominio, actualizar manualmente en Cloudflare Turnstile account ${report.account} el widget asociado al site key ${report.siteKeyPrefix} para que cubra exactamente estos dominios: ${domains}. La accion permitida es confirmar el widget existente o ajustar solo la lista de dominios de ese widget; no autorizo cambiar secret keys, site keys, modo de desafio, WAF, DNS, Pages, Workers, API tokens, cuentas, analytics ni ningun otro servicio externo. Despues hay que verificar con corepack pnpm --config.verify-deps-before-run=false launch:turnstile-readonly y registrar dashboard evidence sin secret values, sin Turnstile secret key y sin Cloudflare API token.`,
        '',
        '## Forbidden Scope',
        '',
        '- Do not change Turnstile secret key, site key, challenge mode or clearance level unless separately approved.',
        '- Do not change DNS, Workers, Pages, WAF, Cloudflare account settings, API tokens, analytics or logs.',
        '- Do not store screenshots containing secret values, full API tokens or private user data.',
        '- Do not touch Stripe, Supabase, Google, Resend, Sentry, legal values or application code as part of this approval.',
    ].join('\n')}\n`;
}

function renderDashboardEvidenceChecklist(report: Report): string {
    return `${[
        '# Turnstile Dashboard Evidence Checklist',
        '',
        '- [ ] Confirm Cloudflare account matches the intended Espanol Honesto account.',
        `- [ ] Confirm widget site key prefix is ${report.siteKeyPrefix}.`,
        `- [ ] Confirm widget name: ${report.widgetName}.`,
        `- [ ] Confirm widget mode: ${report.widgetMode}.`,
        `- [ ] Confirm clearance level: ${report.widgetClearanceLevel}.`,
        ...report.expectedDomains.map((domain) => `- [ ] Confirm allowed domain includes ${domain}.`),
        '- [ ] Confirm no Turnstile secret key is copied into repo docs, screenshots or generated outputs.',
        '- [ ] Confirm no Cloudflare API token is copied into repo docs, screenshots or generated outputs.',
        '- [ ] Record dashboard evidence with account name/id prefix, widget name, site key prefix, allowed domains, owner and date.',
        '- [ ] If a dashboard change was made, record before/after domains and owner/date.',
        '',
        'This checklist is dashboard evidence support only. It does not call Cloudflare and does not create, update or delete Turnstile widgets.',
    ].join('\n')}\n`;
}

function renderVerificationChecklist(report: Report): string {
    return `${[
        '# Turnstile Verification Checklist',
        '',
        'After dashboard/API review or correction:',
        '',
        `- [ ] Rerun \`corepack pnpm --config.verify-deps-before-run=false launch:turnstile-readonly -- --env-file ${report.envFile}\`.`,
        '- [ ] If Cloudflare API inputs are available, confirm `cloudflare_api_token_readonly` is OK.',
        '- [ ] If Cloudflare API inputs are available, confirm `turnstile_widgets_readonly` is OK.',
        '- [ ] If API inputs are unavailable, attach dashboard evidence with the same facts: account, widget name, site key prefix and allowed domains.',
        '- [ ] Confirm `siteverify_fake_token_rejection` remains OK.',
        '- [ ] Run `corepack pnpm --config.verify-deps-before-run=false launch:integration-final-package` and confirm the Turnstile warning is gone or explicitly represented by accepted-risk evidence.',
        '- [ ] Record non-secret evidence in `integration_readiness` before marking the launch gate pass.',
        '',
        'This checklist does not replace the final browser form smoke with a real Turnstile browser token.',
    ].join('\n')}\n`;
}

function renderRollbackPlan(report: Report): string {
    const priorDomains = report.configuredDomains.length > 0
        ? report.configuredDomains.join(', ')
        : 'the pre-change dashboard domain list captured before editing';

    return `${[
        '# Turnstile Rollback Plan',
        '',
        'Rollback trigger:',
        '',
        '- Lead/signup forms fail Turnstile on an expected launch domain.',
        '- Dashboard/API evidence shows the wrong widget, site key or allowed domain list.',
        '- A broader Cloudflare setting was changed accidentally.',
        '',
        'Rollback steps:',
        '',
        `1. Restore the Turnstile widget allowed domains to: ${priorDomains}.`,
        '2. Revert only the dashboard/API domain edit made under the exact approval.',
        `3. Rerun \`corepack pnpm --config.verify-deps-before-run=false launch:turnstile-readonly -- --env-file ${report.envFile}\`.`,
        '4. Record the rollback as non-secret dashboard evidence with owner, date and reason.',
        '5. If the issue affects public forms during launch, keep checkout/lead capture disabled or route traffic back to the previously verified runtime until fixed.',
        '',
        'Do not rotate keys, change WAF/DNS/Worker/Page settings or edit other Cloudflare products as part of this rollback unless separately approved.',
    ].join('\n')}\n`;
}

function renderManualEvidenceDryRun(report: Report): string {
    const manifestPath = `../../${toPosix(path.relative(process.cwd(), report.manifestPath))}`;
    const checklistPath = `../../${toPosix(path.relative(process.cwd(), report.dashboardEvidenceChecklistPath))}`;
    const verificationPath = `../../${toPosix(path.relative(process.cwd(), report.verificationChecklistPath))}`;

    return `${[
        'corepack pnpm --config.verify-deps-before-run=false launch:manual-evidence:record --',
        '  --id integration_readiness',
        '  --status pass',
        '  --summary "Turnstile widget/domain posture verified for final launch domains."',
        '  --environment production',
        '  --owner Alin',
        `  --evidence "command_output=${manifestPath}::Turnstile closure manifest reviewed"`,
        `  --evidence "command_output=${checklistPath}::Turnstile dashboard evidence checklist completed"`,
        `  --evidence "command_output=${verificationPath}::Turnstile verification checklist completed"`,
        '  --evidence "manual_note=Replace with concrete non-secret dashboard/API result: account, widget name, site key prefix and allowed domains verified."',
        '',
        '# Add --write only after replacing the placeholder note with real dashboard/API evidence.',
    ].join(' \\\n')}\n`;
}

function renderSummary(report: Report): string {
    return `${[
        '# Turnstile Domain Closure Pack Summary',
        '',
        `- Status: ${report.status}`,
        `- Turnstile closure: ${report.turnstileClosureStatus}`,
        `- Failed: ${report.checks.filter((check) => check.status === 'failed').length}`,
        `- Warnings: ${report.checks.filter((check) => check.status === 'warning').length}`,
        `- Package: ${toPosix(path.relative(process.cwd(), report.packagePath))}`,
        `- Manifest: ${toPosix(path.relative(process.cwd(), report.manifestPath))}`,
        `- Approval request: ${toPosix(path.relative(process.cwd(), report.approvalRequestPath))}`,
        `- Dashboard evidence checklist: ${toPosix(path.relative(process.cwd(), report.dashboardEvidenceChecklistPath))}`,
        `- Verification checklist: ${toPosix(path.relative(process.cwd(), report.verificationChecklistPath))}`,
        `- Rollback plan: ${toPosix(path.relative(process.cwd(), report.rollbackPlanPath))}`,
        '',
        'This package is local-only. It does not call Cloudflare, does not create, update or delete Turnstile widgets, and does not change DNS, Workers, Pages, WAF, secrets or domains.',
        '',
        '| Status | Check | Message | Details |',
        '| --- | --- | --- | --- |',
        ...report.checks.map((check) => `| ${check.status} | ${check.name} | ${escapeCell(check.message)} | ${escapeCell(check.details.join(' / ') || 'none')} |`),
    ].join('\n')}\n`;
}

function renderManifest(report: Report, renderedFiles: Omit<RenderedArtifacts, 'manifest'>): string {
    return `${JSON.stringify({
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        status: report.status,
        turnstileClosureStatus: report.turnstileClosureStatus,
        latestTurnstileReadonlySummary: report.latestTurnstileReadonlySummary,
        envFile: report.envFile,
        account: report.account,
        siteKeyPrefix: report.siteKeyPrefix,
        widgetName: report.widgetName,
        widgetMode: report.widgetMode,
        widgetClearanceLevel: report.widgetClearanceLevel,
        expectedDomains: report.expectedDomains,
        configuredDomains: report.configuredDomains,
        missingExpectedDomains: report.missingExpectedDomains,
        missingCloudflareApiInputs: report.missingCloudflareApiInputs,
        runtimeSiteverifyStatus: report.runtimeSiteverifyStatus,
        widgetReadonlyStatus: report.widgetReadonlyStatus,
        doesNotCallCloudflare: true,
        doesNotWriteExternalServices: true,
        doesNotMutateTurnstileWidgets: true,
        forbiddenScope: [
            'Turnstile secret key/site key/challenge-mode changes',
            'DNS/Workers/Pages/WAF/secrets/domains/API tokens',
            'Stripe/Supabase/Google/Resend/Sentry/legal/app writes',
        ],
        files: {
            package: fileMeta(report.packagePath, renderedFiles.packageMarkdown),
            approvalRequest: fileMeta(report.approvalRequestPath, renderedFiles.approvalRequest),
            dashboardEvidenceChecklist: fileMeta(report.dashboardEvidenceChecklistPath, renderedFiles.dashboardEvidenceChecklist),
            verificationChecklist: fileMeta(report.verificationChecklistPath, renderedFiles.verificationChecklist),
            rollbackPlan: fileMeta(report.rollbackPlanPath, renderedFiles.rollbackPlan),
            manualEvidenceDryRun: fileMeta(report.manualEvidenceDryRunPath, renderedFiles.manualEvidenceDryRun),
            summary: fileMeta(report.summaryPath, renderedFiles.summary),
        },
        checks: report.checks,
    }, null, 2)}\n`;
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

function detailValue(details: string[] | undefined, key: string): string {
    const prefix = `${key}=`;
    const row = details?.find((detail) => detail.startsWith(prefix));
    return row ? row.slice(prefix.length).trim() : '';
}

function detailList(details: string[] | undefined, key: string): string[] {
    const value = detailValue(details, key);
    if (!value || value === 'none' || value === 'missing' || value === 'unknown') return [];
    return value
        .split(/[|,]/)
        .map((item) => item.trim())
        .filter(Boolean)
        .filter((item) => item !== 'none' && item !== 'missing' && item !== 'unknown');
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

function unique(values: string[]): string[] {
    return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function escapeCell(value: string): string {
    return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}
