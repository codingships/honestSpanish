import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

type CheckStatus = 'ok' | 'warning' | 'failed';
type PackageStatus = 'OK' | 'WARNING' | 'FAILED';
type SeoClosureStatus = 'READY_FOR_FINAL_REVIEW_INPUTS' | 'BLOCKED_BY_LIVE_DOMAIN' | 'BLOCKED_BY_PACKAGE_ERRORS';

interface PackageCheck {
    status: CheckStatus;
    name: string;
    message: string;
    details: string[];
}

interface TimedSummary {
    status?: string;
    checks?: Array<{ status?: string; name?: string; message?: string; details?: string[] }>;
    findings?: Array<{ status?: string; area?: string; message?: string; details?: string[] }>;
}

interface SeoFinalPackageReport {
    schemaVersion: 1;
    startedAt: string;
    endedAt: string;
    status: PackageStatus;
    seoClosureStatus: SeoClosureStatus;
    outputDir: string;
    latestSeoSummaryPath: string | null;
    latestSeoWorksheetPath: string | null;
    latestLiveDomainSummaryPath: string | null;
    latestLiveDomainStatus: string | null;
    liveDomainIssueCount: number;
    checks: PackageCheck[];
    packagePath: string;
    manifestPath: string;
    reviewChecklistPath: string;
    domainParityGapPath: string;
    passDryRunPath: string;
    acceptedRiskDryRunPath: string;
    summaryPath: string;
}

interface RenderedArtifacts {
    packageMarkdown: string;
    manifest: string;
    reviewChecklist: string;
    domainParityGap: string;
    passDryRun: string;
    acceptedRiskDryRun: string;
    summary: string;
}

const seoAuditScriptPath = path.join('scripts', 'launch', 'seo-audit.ts');
const liveDomainScriptPath = path.join('scripts', 'launch', 'live-domain-readonly-evidence.ts');
const statusScriptPath = path.join('scripts', 'launch', 'status.ts');
const seoRunbookPath = path.join('docs', 'launch', 'SEO_LLM_FINAL.md');
const manualEvidencePath = path.join('docs', 'launch', 'MANUAL_EVIDENCE.md');
const manualRunbookPath = path.join('docs', 'launch', 'MANUAL_EVIDENCE_RUNBOOK.md');
const manualExamplePath = path.join('docs', 'launch', 'MANUAL_EVIDENCE.example.json');
const operationsRunbookTestPath = path.join('tests', 'unit', 'operations-runbook.test.ts');
const marketingPlanPath = path.join('docs', 'launch', 'LAUNCH_MARKETING_PLAN.md');

const startedAt = new Date();
const outputDir = path.join(process.cwd(), 'outputs', 'launch-seo-llm-final-package', stamp(startedAt));
mkdirSync(outputDir, { recursive: true });

const latestSeoSummaryPath = latestGeneratedPath('launch-seo', 'summary.md');
const latestSeoWorksheetPath = latestGeneratedPath('launch-seo', 'seo-llm-final-worksheet.md');
const latestLiveDomainSummaryPath = latestGeneratedPath('launch-live-domain-readonly-evidence', 'summary.md');
const latestLiveDomainJsonPath = latestGeneratedPath('launch-live-domain-readonly-evidence', 'summary.json');
const liveDomainSummary = readJsonIfExists<TimedSummary>(latestLiveDomainJsonPath);
const latestLiveDomainStatus = liveDomainSummary?.status ?? null;
const liveDomainIssues = collectLiveDomainIssues(liveDomainSummary);

const checks: PackageCheck[] = [
    validatePackageScript(),
    validateSeoAuditSupport(),
    validateLiveDomainEvidence(),
    validateSeoRunbook(),
    validateDocsAndStatusWiring(),
];

let report = createReport(checks);
let rendered = renderArtifacts(report);
checks.push(validateGeneratedArtifactPosture(rendered));
report = createReport(checks);
rendered = renderArtifacts(report);

writeFileSync(report.packagePath, rendered.packageMarkdown, 'utf8');
writeFileSync(report.manifestPath, rendered.manifest, 'utf8');
writeFileSync(report.reviewChecklistPath, rendered.reviewChecklist, 'utf8');
writeFileSync(report.domainParityGapPath, rendered.domainParityGap, 'utf8');
writeFileSync(report.passDryRunPath, rendered.passDryRun, 'utf8');
writeFileSync(report.acceptedRiskDryRunPath, rendered.acceptedRiskDryRun, 'utf8');
writeFileSync(path.join(outputDir, 'summary.json'), JSON.stringify(report, null, 2), 'utf8');
writeFileSync(report.summaryPath, rendered.summary, 'utf8');

const failed = report.checks.filter((check) => check.status === 'failed');
const warnings = report.checks.filter((check) => check.status === 'warning');

console.log(`[launch:seo-llm-final-package] Status: ${report.status}`);
console.log(`[launch:seo-llm-final-package] SEO closure: ${report.seoClosureStatus}`);
console.log(`[launch:seo-llm-final-package] Failed: ${failed.length}`);
console.log(`[launch:seo-llm-final-package] Warnings: ${warnings.length}`);
console.log(`[launch:seo-llm-final-package] Live-domain issues: ${report.liveDomainIssueCount}`);
console.log(`[launch:seo-llm-final-package] Summary: ${report.summaryPath}`);
console.log(`[launch:seo-llm-final-package] Package: ${report.packagePath}`);
console.log(`[launch:seo-llm-final-package] Manifest: ${report.manifestPath}`);
console.log(`[launch:seo-llm-final-package] Review checklist: ${report.reviewChecklistPath}`);
console.log(`[launch:seo-llm-final-package] Domain parity gap: ${report.domainParityGapPath}`);

if (failed.length > 0) process.exit(1);

function createReport(reportChecks: PackageCheck[]): SeoFinalPackageReport {
    const status = statusFor(reportChecks);
    const seoClosureStatus: SeoClosureStatus = status === 'FAILED'
        ? 'BLOCKED_BY_PACKAGE_ERRORS'
        : latestLiveDomainStatus === 'OK'
            ? 'READY_FOR_FINAL_REVIEW_INPUTS'
            : 'BLOCKED_BY_LIVE_DOMAIN';

    return {
        schemaVersion: 1,
        startedAt: startedAt.toISOString(),
        endedAt: new Date().toISOString(),
        status,
        seoClosureStatus,
        outputDir,
        latestSeoSummaryPath,
        latestSeoWorksheetPath,
        latestLiveDomainSummaryPath,
        latestLiveDomainStatus,
        liveDomainIssueCount: liveDomainIssues.length,
        checks: reportChecks,
        packagePath: path.join(outputDir, 'seo-llm-final-package.md'),
        manifestPath: path.join(outputDir, 'seo-llm-final-manifest.json'),
        reviewChecklistPath: path.join(outputDir, 'review-checklist.md'),
        domainParityGapPath: path.join(outputDir, 'domain-parity-gap.md'),
        passDryRunPath: path.join(outputDir, 'manual-evidence-dry-run-pass.txt'),
        acceptedRiskDryRunPath: path.join(outputDir, 'manual-evidence-dry-run-accepted-risk.txt'),
        summaryPath: path.join(outputDir, 'summary.md'),
    };
}

function validatePackageScript(): PackageCheck {
    const packagePath = 'package.json';
    const packageJson = readJsonIfExists<{ packageManager?: string; scripts?: Record<string, string> }>(packagePath);
    const missing: string[] = [];
    if (!packageJson) missing.push('package.json');
    if (packageJson?.packageManager !== 'pnpm@10.33.0') missing.push('packageManager=pnpm@10.33.0');
    if (packageJson?.scripts?.['launch:seo-llm-final-package'] !== 'tsx scripts/launch/seo-llm-final-package.ts') {
        missing.push('launch:seo-llm-final-package=tsx scripts/launch/seo-llm-final-package.ts');
    }

    return {
        status: missing.length === 0 ? 'ok' : 'failed',
        name: 'package_script_seo_llm_final_package',
        message: missing.length === 0
            ? 'Package scripts expose the local-only SEO/LLM final package and preserve pnpm policy.'
            : 'Package scripts are missing the SEO/LLM final package or pnpm package manager contract.',
        details: missing.length === 0 ? ['launch:seo-llm-final-package'] : missing.map((item) => `missing=${item}`),
    };
}

function validateSeoAuditSupport(): PackageCheck {
    const seoAudit = readIfExists(seoAuditScriptPath);
    const required = [
        'reviewCrawlabilityAndIndexation',
        'reviewMetadataAndAlternates',
        'reviewStructuredData',
        'reviewLlmSurface',
        'reviewMarketingPlanCoverage',
        'reviewFinalWorkflowCoverage',
        'seo-llm-final-worksheet.md',
    ];
    const missing = required.filter((snippet) => !seoAudit.includes(snippet));

    if (missing.length > 0) {
        return {
            status: 'failed',
            name: 'local_seo_audit_support',
            message: 'Local SEO audit support is missing required SEO/LLM checks.',
            details: missing.map((snippet) => `missing=${snippet}`),
        };
    }

    return {
        status: latestSeoSummaryPath ? 'ok' : 'warning',
        name: 'local_seo_audit_support',
        message: latestSeoSummaryPath
            ? 'Latest local launch:seo output is available and the audit covers the SEO/LLM support surfaces.'
            : 'SEO audit support exists, but no latest launch:seo output was found.',
        details: [
            `latestSeoSummary=${latestSeoSummaryPath ?? 'missing'}`,
            `latestSeoWorksheet=${latestSeoWorksheetPath ?? 'missing'}`,
        ],
    };
}

function validateLiveDomainEvidence(): PackageCheck {
    if (!latestLiveDomainSummaryPath) {
        return {
            status: 'warning',
            name: 'live_domain_readonly_evidence',
            message: 'No live-domain read-only output was found; run it before final SEO/LLM closure.',
            details: ['outputs/launch-live-domain-readonly-evidence/<timestamp>/summary.md'],
        };
    }

    return {
        status: latestLiveDomainStatus === 'OK' ? 'ok' : 'warning',
        name: 'live_domain_readonly_evidence',
        message: latestLiveDomainStatus === 'OK'
            ? 'Latest live-domain read-only probe is OK.'
            : 'Latest live-domain read-only probe is not OK; SEO/LLM final closure must remain blocked or explicitly risk-accepted.',
        details: [
            `latestLiveDomainSummary=${latestLiveDomainSummaryPath}`,
            `latestLiveDomainStatus=${latestLiveDomainStatus ?? 'unknown'}`,
            `issueCount=${liveDomainIssues.length}`,
            ...liveDomainIssues.slice(0, 12),
        ],
    };
}

function validateSeoRunbook(): PackageCheck {
    const runbook = readIfExists(seoRunbookPath);
    const marketingPlan = readIfExists(marketingPlanPath);
    const required: Array<[string, string]> = [
        [seoRunbookPath, 'Search Console'],
        [seoRunbookPath, 'Core Web Vitals'],
        [seoRunbookPath, 'Tipografia Rusa Premium'],
        [seoRunbookPath, 'LLM Discoverability'],
        [seoRunbookPath, 'No guardar fuentes comerciales sin licencia'],
        [seoRunbookPath, 'Criterio De Cierre'],
        [marketingPlanPath, 'SEO, LLM, oferta, solicitudes de plaza'],
        [marketingPlanPath, 'solicitud de plaza'],
    ];
    const missing = required.filter(([file, snippet]) => !(file === seoRunbookPath ? runbook : marketingPlan).includes(snippet));

    return {
        status: missing.length === 0 ? 'ok' : 'failed',
        name: 'seo_llm_final_runbook_scope',
        message: missing.length === 0
            ? 'SEO/LLM final runbook covers live-domain, Search Console/CWV, LLM discoverability, marketing parity and Russian typography decisions.'
            : 'SEO/LLM final runbook or marketing plan is missing required closure scope.',
        details: missing.length === 0 ? [seoRunbookPath, marketingPlanPath] : missing.map(([file, snippet]) => `missing=${file}::${snippet}`),
    };
}

function validateDocsAndStatusWiring(): PackageCheck {
    const required: Array<[string, string]> = [
        [statusScriptPath, 'seoLlmFinalPackage'],
        [statusScriptPath, 'seo-llm-final-manifest.json'],
        [statusScriptPath, 'domain-parity-gap.md'],
        [manualEvidencePath, 'outputs/launch-seo-llm-final-package/<timestamp>/seo-llm-final-manifest.json'],
        [manualRunbookPath, 'pnpm launch:seo-llm-final-package'],
        [manualRunbookPath, 'domain-parity-gap.md'],
        [manualExamplePath, 'outputs/launch-seo-llm-final-package/<timestamp>/seo-llm-final-manifest.json'],
        [operationsRunbookTestPath, 'launch:seo-llm-final-package'],
    ];
    const missingFiles = [...new Set(required.map(([file]) => file))].filter((file) => !existsSync(file));
    const missing = required.filter(([file, snippet]) => !readIfExists(file).includes(snippet));

    return {
        status: missingFiles.length === 0 && missing.length === 0 ? 'ok' : 'failed',
        name: 'docs_status_seo_llm_final_package_wiring',
        message: missingFiles.length === 0 && missing.length === 0
            ? 'Status, manual evidence docs, example evidence and runbook tests point to the SEO/LLM final package.'
            : 'SEO/LLM final package is not fully wired into status, docs or tests.',
        details: [
            ...missingFiles.map((file) => `missingFile=${file}`),
            ...missing.map(([file, snippet]) => `missing=${file}::${snippet}`),
        ],
    };
}

function validateGeneratedArtifactPosture(renderedArtifacts: RenderedArtifacts): PackageCheck {
    const combined = Object.values(renderedArtifacts).join('\n');
    const forbiddenSecretPatterns = [
        new RegExp('-----BEGIN ' + 'PRIVATE KEY-----'),
        /sk_(live|test)_[A-Za-z0-9]{20,}/,
        /whsec_[A-Za-z0-9]{20,}/,
        /sb_secret_[A-Za-z0-9_-]{20,}/,
        /AIza[0-9A-Za-z_-]{30,}/,
        /(?<![A-Za-z0-9_])re_[A-Za-z0-9_]{20,}/,
        /(postgres|postgresql):\/\/[^\s"']+:[^\s"']+@/,
    ];
    const offenders = forbiddenSecretPatterns.filter((pattern) => pattern.test(combined));
    const requiredSafetyText = [
        'does not deploy',
        'does not write external services',
        'does not buy or store fonts',
        'Search Console',
        'Core Web Vitals',
        'llms.txt',
        'domain parity',
        'Russian typography',
    ];
    const missing = requiredSafetyText.filter((snippet) => !combined.includes(snippet));

    return {
        status: offenders.length === 0 && missing.length === 0 ? 'ok' : 'failed',
        name: 'generated_artifact_secret_and_scope_posture',
        message: offenders.length === 0 && missing.length === 0
            ? 'Generated artifacts contain SEO/LLM scope gates and no obvious secret values.'
            : 'Generated artifacts are missing safety text or appear to include secret-like values.',
        details: [
            ...offenders.map((pattern) => `secretPattern=${pattern}`),
            ...missing.map((snippet) => `missing=${snippet}`),
        ],
    };
}

function renderArtifacts(report: SeoFinalPackageReport): RenderedArtifacts {
    const packageMarkdown = renderPackage(report);
    const reviewChecklist = renderReviewChecklist(report);
    const domainParityGap = renderDomainParityGap(report);
    const passDryRun = renderPassDryRun(report);
    const acceptedRiskDryRun = renderAcceptedRiskDryRun(report);
    const summary = renderSummary(report);
    const manifest = renderManifest(report, { packageMarkdown, reviewChecklist, domainParityGap, passDryRun, acceptedRiskDryRun, summary });

    return {
        packageMarkdown,
        manifest,
        reviewChecklist,
        domainParityGap,
        passDryRun,
        acceptedRiskDryRun,
        summary,
    };
}

function renderPackage(report: SeoFinalPackageReport): string {
    const lines = [
        '# SEO/LLM Final Package',
        '',
        `- Generated: ${report.endedAt}`,
        `- Status: ${report.status}`,
        `- SEO closure status: ${report.seoClosureStatus}`,
        `- Latest local SEO audit: ${report.latestSeoSummaryPath ?? 'missing'}`,
        `- Latest SEO worksheet: ${report.latestSeoWorksheetPath ?? 'missing'}`,
        `- Latest live-domain probe: ${report.latestLiveDomainSummaryPath ?? 'missing'}`,
        `- Latest live-domain status: ${report.latestLiveDomainStatus ?? 'missing'}`,
        `- Live-domain issue count: ${report.liveDomainIssueCount}`,
        '',
        'This package does not deploy, does not write external services, does not submit Search Console data, does not buy or store fonts, and does not authorize launch. It consolidates the final SEO/LLM evidence boundary.',
        '',
        '## Current Automated Evidence',
        '',
        '| Status | Check | Message | Details |',
        '| --- | --- | --- | --- |',
    ];

    for (const check of report.checks) {
        lines.push(`| ${check.status} | ${check.name} | ${escapeCell(check.message)} | ${escapeCell(check.details.join(' / '))} |`);
    }

    lines.push(
        '',
        '## Domain Parity Gate',
        '',
        'Do not close `seo_llm_final` while the production domain serves an old or incomplete surface unless Alin explicitly accepts that as a launch risk. The current live-domain issues are:',
        '',
    );

    if (liveDomainIssues.length === 0) {
        lines.push('- No live-domain issues detected in the latest read-only probe.');
    } else {
        for (const issue of liveDomainIssues) lines.push(`- ${issue}`);
    }

    lines.push(
        '',
        '## Human Inputs Still Required',
        '',
        '- Final public copy/legal/payment mode must be stable.',
        '- Search Console or equivalent sitemap and URL inspection evidence, or explicit accepted risk if unavailable.',
        '- Core Web Vitals or Lighthouse/PageSpeed evidence, or explicit accepted risk if unavailable.',
        '- Russian typography decision: licensed official Cyrillic-capable family installed and reviewed, or current fallback explicitly accepted.',
        '- Legal index policy decision: legal pages stay noindex or become indexable, with sitemap/noindex aligned.',
        '- LLM discoverability spot-check: public assistant-facing sources do not cite campus, API, demo, private data, immediate checkout, reviews, Telegram or guaranteed group/community claims.',
        '',
        '## Before And After Ledger',
        '',
        'Before this package:',
        '',
        '- `launch:seo` could be OK locally while the live production domain still returned 404 for modern segment routes and 404 for `/llms.txt`.',
        '- `seo_llm_final` closure pointed to the worksheet/runbook, but not to a generated current package that separated local SEO readiness from live-domain parity and human Search Console/CWV/font decisions.',
        '',
        'After this package:',
        '',
        '- No production SEO, copy, robots, sitemap, font, Search Console, Cloudflare, legal, payment or runtime value changed.',
        '- The current live-domain gap, review checklist, pass dry-run and accepted-risk dry-run are generated from current evidence.',
        '',
        'Cost/benefit:',
        '',
        '- Benefit: prevents a false SEO/LLM pass based on local checks while the public domain still serves an incomplete/old surface; makes Search Console, CWV and Russian typography decisions explicit.',
        '- Cost: one additional local support script and generated output folder to maintain.',
        '',
        'Rollback:',
        '',
        '- Remove `scripts/launch/seo-llm-final-package.ts`, the package script and related status/runbook/test/tracker references.',
        '- No service rollback is required because this package performs no external writes and changes no public SEO assets.',
        '',
    );

    return `${lines.join('\n')}\n`;
}

function renderReviewChecklist(report: SeoFinalPackageReport): string {
    return `${[
        '# SEO/LLM Final Review Checklist',
        '',
        'Use this after final copy, legal pages, payment mode and production runtime/domain posture are stable.',
        '',
        '## Automated Evidence',
        '',
        '- `pnpm launch:seo` is OK after final copy/legal/payment mode.',
        '- `pnpm launch:live-domain-readonly -- --base-url https://espanolhonesto.com --host-variant https://www.espanolhonesto.com` is OK, or each warning is explicitly accepted with owner and rollback/follow-up.',
        '- `pnpm launch:cloudflare-production-runtime-cutover` phases are completed or explicitly risk-accepted if the live domain still uses Pages.',
        '- `pnpm launch:status` points to current SEO/LLM evidence.',
        '',
        '## Search And Assistant Surface',
        '',
        '- robots.txt allows public pages and blocks campus, API, demo and private surfaces.',
        '- sitemap-index and public sitemap include final public URLs and exclude private/demo/API routes.',
        '- `/llms.txt` is reachable and accurately describes public sources, package posture, application-first conversion and forbidden private routes.',
        '- Canonical, hreflang, title, description, OG/Twitter and JSON-LD are reviewed for `/es`, `/en`, `/ru` and segment pages.',
        '- Search Console or equivalent has sitemap and key URL inspection evidence without tokens or personal data.',
        '- Core Web Vitals or Lighthouse/PageSpeed evidence exists for key landings, or accepted risk is recorded.',
        '',
        '## Human Decisions',
        '',
        '- Russian typography: licensed official Cyrillic-capable family is installed and reviewed on `/ru`, or current fallback is explicitly accepted.',
        '- Legal index policy is recorded and aligned with sitemap/noindex.',
        '- Marketing plan parity is reviewed against `docs/launch/LAUNCH_MARKETING_PLAN.md`.',
        '- LLM prompt spot-check does not invent reviews, Telegram, immediate checkout, guaranteed groups, private campus/API data or unlaunched features.',
        '',
        '## Evidence Safety',
        '',
        '- No Search Console tokens, analytics exports, customer emails, private screenshots, invoices, fiscal data or commercial font files in repo/output evidence.',
        '- Only redacted screenshots, manual notes, public URLs and generated command-output paths are stored.',
        '',
        '## Current Package State',
        '',
        `- SEO closure status: ${report.seoClosureStatus}`,
        `- Latest live-domain status: ${report.latestLiveDomainStatus ?? 'missing'}`,
        `- Live-domain issue count: ${report.liveDomainIssueCount}`,
        '',
    ].join('\n')}\n`;
}

function renderDomainParityGap(report: SeoFinalPackageReport): string {
    const lines = [
        '# SEO/LLM Domain Parity Gap',
        '',
        'This file summarizes why the public production domain still blocks `seo_llm_final` when live-domain evidence is not OK.',
        '',
        `- Latest live-domain summary: ${report.latestLiveDomainSummaryPath ?? 'missing'}`,
        `- Latest live-domain status: ${report.latestLiveDomainStatus ?? 'missing'}`,
        `- Issue count: ${report.liveDomainIssueCount}`,
        '',
        '## Current Issues',
        '',
    ];

    if (liveDomainIssues.length === 0) {
        lines.push('No live-domain issues detected in the latest read-only probe.');
    } else {
        for (const issue of liveDomainIssues) lines.push(`- ${issue}`);
    }

    lines.push(
        '',
        '## Required Closure',
        '',
        '- Deploy or route the modern Worker/public build to `espanolhonesto.com` and `www.espanolhonesto.com`, or explicitly accept the old-surface/domain gap as a launch risk.',
        '- Rerun live-domain read-only evidence and `pnpm launch:seo` after the domain/runtime change.',
        '- Do not treat local `launch:seo` OK as production-domain parity.',
        '',
    );

    return `${lines.join('\n')}\n`;
}

function renderPassDryRun(report: SeoFinalPackageReport): string {
    const packagePath = `../../${toPosix(path.relative(process.cwd(), report.packagePath))}`;
    const manifestPath = `../../${toPosix(path.relative(process.cwd(), report.manifestPath))}`;
    const checklistPath = `../../${toPosix(path.relative(process.cwd(), report.reviewChecklistPath))}`;
    const domainGapPath = `../../${toPosix(path.relative(process.cwd(), report.domainParityGapPath))}`;
    const seoSummaryPath = report.latestSeoSummaryPath ? `../../${report.latestSeoSummaryPath}` : '../../outputs/launch-seo/<timestamp>/summary.md';
    const liveDomainPath = report.latestLiveDomainSummaryPath ? `../../${report.latestLiveDomainSummaryPath}` : '../../outputs/launch-live-domain-readonly-evidence/<timestamp>/summary.md';

    return `${[
        'corepack pnpm launch:manual-evidence:record --',
        '  --id seo_llm_final',
        '  --status pass',
        '  --summary "SEO/LLM final review completed after final domain, copy, legal pages, payment mode and Cyrillic typography decision settled."',
        '  --environment production',
        '  --owner Alin',
        `  --evidence "command_output=${packagePath}::SEO/LLM final package reviewed"`,
        `  --evidence "command_output=${manifestPath}::SEO/LLM final manifest reviewed"`,
        `  --evidence "command_output=${checklistPath}::SEO/LLM final checklist completed"`,
        `  --evidence "command_output=${domainGapPath}::domain parity gap reviewed and resolved or explicitly accepted"`,
        `  --evidence "command_output=${seoSummaryPath}::pnpm launch:seo passes after final copy/legal/payment/domain settle"`,
        `  --evidence "command_output=${liveDomainPath}::live-domain read-only probe passes or documented warnings are accepted"`,
        '  --evidence "path=docs/launch/SEO_LLM_FINAL.md::stable SEO/LLM final runbook followed"',
        '  --evidence "manual_note=Replace with concrete non-secret result: Search Console/CWV/snippets/llms.txt/private-route exclusion/legal index policy and Russian typography decision reviewed."',
        '',
        '# Add --write only after replacing the placeholder note with real non-secret evidence.',
        '',
    ].join(' \\\n')}`;
}

function renderAcceptedRiskDryRun(report: SeoFinalPackageReport): string {
    const packagePath = `../../${toPosix(path.relative(process.cwd(), report.packagePath))}`;
    const domainGapPath = `../../${toPosix(path.relative(process.cwd(), report.domainParityGapPath))}`;
    const liveDomainPath = report.latestLiveDomainSummaryPath ? `../../${report.latestLiveDomainSummaryPath}` : '../../outputs/launch-live-domain-readonly-evidence/<timestamp>/summary.md';

    return `${[
        'corepack pnpm launch:manual-evidence:record --',
        '  --id seo_llm_final',
        '  --status accepted_risk',
        '  --summary "A specific SEO/LLM final signal is unavailable at launch and accepted with post-launch follow-up."',
        '  --environment production',
        '  --owner Alin',
        '  --risk-accepted-by Alin',
        '  --risk-rationale "Replace with concrete rationale: the unavailable SEO/LLM signal is scoped, does not expose private routes, and launch owner accepts the timing risk."',
        '  --rollback-plan "Replace with concrete plan: fix domain/indexing/font issue, rerun live-domain read-only plus launch:seo, and update Search Console/CWV evidence post-launch."',
        `  --evidence "command_output=${packagePath}::SEO/LLM final package reviewed before risk acceptance"`,
        `  --evidence "command_output=${domainGapPath}::specific live-domain or font/Search Console/CWV gap scoped"`,
        `  --evidence "command_output=${liveDomainPath}::live-domain probe documents pass or accepted warning"`,
        '  --evidence "manual_note=Replace with concrete non-secret result: Alin accepted Search Console/CWV/current Cyrillic fallback/domain timing risk with post-launch follow-up."',
        '',
        '# Add --write only after replacing placeholder rationale, rollback and note with concrete accepted-risk evidence.',
        '',
    ].join(' \\\n')}`;
}

function renderSummary(report: SeoFinalPackageReport): string {
    const lines = [
        '# SEO/LLM Final Package Summary',
        '',
        `- Status: ${report.status}`,
        `- SEO closure status: ${report.seoClosureStatus}`,
        `- Latest local SEO audit: ${report.latestSeoSummaryPath ?? 'missing'}`,
        `- Latest live-domain status: ${report.latestLiveDomainStatus ?? 'missing'}`,
        `- Live-domain issue count: ${report.liveDomainIssueCount}`,
        `- Package: ${toPosix(path.relative(process.cwd(), report.packagePath))}`,
        `- Manifest: ${toPosix(path.relative(process.cwd(), report.manifestPath))}`,
        `- Review checklist: ${toPosix(path.relative(process.cwd(), report.reviewChecklistPath))}`,
        `- Domain parity gap: ${toPosix(path.relative(process.cwd(), report.domainParityGapPath))}`,
        '',
        'This package is local-only. It does not deploy, does not write external services, does not submit Search Console data, does not buy or store fonts and does not close `seo_llm_final` by itself.',
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

function renderManifest(report: SeoFinalPackageReport, renderedFiles: Omit<RenderedArtifacts, 'manifest'>): string {
    return `${JSON.stringify({
        schemaVersion: 1,
        generatedAt: report.endedAt,
        status: report.status,
        seoClosureStatus: report.seoClosureStatus,
        latestSeoSummaryPath: report.latestSeoSummaryPath,
        latestSeoWorksheetPath: report.latestSeoWorksheetPath,
        latestLiveDomainSummaryPath: report.latestLiveDomainSummaryPath,
        latestLiveDomainStatus: report.latestLiveDomainStatus,
        liveDomainIssueCount: report.liveDomainIssueCount,
        liveDomainIssues,
        doesNotDeploy: true,
        doesNotWriteExternalServices: true,
        doesNotSubmitSearchConsole: true,
        doesNotBuyOrStoreFonts: true,
        finalReviewRequirements: [
            'production domain parity with modern Worker/public build',
            'robots/sitemap/canonical/hreflang/JSON-LD/snippets/llms.txt reviewed',
            'Search Console or equivalent evidence, or explicit accepted risk',
            'Core Web Vitals/PageSpeed/Lighthouse evidence, or explicit accepted risk',
            'Russian typography licensed-family or fallback decision',
            'legal index policy decision',
            'private/demo/campus/API exclusion',
            'marketing plan parity and LLM discoverability spot-check',
        ],
        files: {
            package: fileMeta(report.packagePath, renderedFiles.packageMarkdown),
            reviewChecklist: fileMeta(report.reviewChecklistPath, renderedFiles.reviewChecklist),
            domainParityGap: fileMeta(report.domainParityGapPath, renderedFiles.domainParityGap),
            passDryRun: fileMeta(report.passDryRunPath, renderedFiles.passDryRun),
            acceptedRiskDryRun: fileMeta(report.acceptedRiskDryRunPath, renderedFiles.acceptedRiskDryRun),
            summary: fileMeta(report.summaryPath, renderedFiles.summary),
        },
        checks: report.checks,
    }, null, 2)}\n`;
}

function collectLiveDomainIssues(summary: TimedSummary | null): string[] {
    const checks = summary?.checks ?? [];
    return checks
        .filter((check) => check.status && check.status !== 'ok')
        .map((check) => {
            const detail = Array.isArray(check.details) && check.details.length > 0
                ? ` (${check.details.join(' / ')})`
                : '';
            return `${check.status}: ${check.name ?? 'unknown'} - ${check.message ?? 'No message'}${detail}`;
        });
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

    return candidates[0] ? toPosix(path.relative(process.cwd(), candidates[0])) : null;
}

function readJsonIfExists<T>(file: string | null): T | null {
    if (!file || !existsSync(file)) return null;
    try {
        return JSON.parse(readFileSync(file, 'utf8')) as T;
    } catch {
        return null;
    }
}

function readIfExists(file: string): string {
    return existsSync(file) ? readFileSync(file, 'utf8') : '';
}

function fileMeta(filePath: string, contents: string) {
    return {
        path: toPosix(path.relative(process.cwd(), filePath)),
        sha256: sha256(contents),
        bytes: Buffer.byteLength(contents, 'utf8'),
    };
}

function statusFor(checkList: PackageCheck[]): PackageStatus {
    if (checkList.some((check) => check.status === 'failed')) return 'FAILED';
    if (checkList.some((check) => check.status === 'warning')) return 'WARNING';
    return 'OK';
}

function sha256(value: string): string {
    return createHash('sha256').update(value).digest('hex');
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
