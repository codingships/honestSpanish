import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

type CheckStatus = 'ok' | 'warning' | 'failed';
type PackageStatus = 'OK' | 'WARNING' | 'FAILED';
type IntegrationClosureStatus = 'READY_FOR_FINAL_REVIEW_INPUTS' | 'BLOCKED_BY_FINAL_EVIDENCE' | 'BLOCKED_BY_PACKAGE_ERRORS';

interface PackageCheck {
    status: CheckStatus;
    name: string;
    message: string;
    details: string[];
}

interface EvidenceSource {
    id: string;
    label: string;
    path: string | null;
    expectedStatus?: 'OK' | 'WARNING' | 'FAILED' | 'BLOCKED';
    requiredForPass: boolean;
    role: string;
}

interface SummaryLike {
    status?: string;
    failed?: number;
    warnings?: number;
    checks?: Array<{ status?: string; name?: string; message?: string; details?: string[] }>;
}

interface IntegrationPackageReport {
    schemaVersion: 1;
    startedAt: string;
    endedAt: string;
    status: PackageStatus;
    integrationClosureStatus: IntegrationClosureStatus;
    outputDir: string;
    evidenceSources: EvidenceSource[];
    missingRequiredEvidence: string[];
    warningEvidence: string[];
    warningEvidenceDetails: string[];
    warningRemediationPlan: WarningRemediation[];
    blockingEvidence: string[];
    checks: PackageCheck[];
    packagePath: string;
    manifestPath: string;
    serviceMatrixPath: string;
    approvalChecklistPath: string;
    passDryRunPath: string;
    acceptedRiskDryRunPath: string;
    summaryPath: string;
}

interface RenderedArtifacts {
    packageMarkdown: string;
    manifest: string;
    serviceMatrix: string;
    approvalChecklist: string;
    passDryRun: string;
    acceptedRiskDryRun: string;
    summary: string;
}

interface WarningRemediation {
    sourceId: string;
    status: string;
    problem: string;
    allowedNextStep: string;
    readOnlyVerification: string;
    evidenceToRecord: string;
    rollbackOrRisk: string;
    externalWriteGate: string;
}

const finalReadinessScriptPath = path.join('scripts', 'launch', 'final-readiness-audit.ts');
const statusScriptPath = path.join('scripts', 'launch', 'status.ts');
const manualEvidencePath = path.join('docs', 'launch', 'MANUAL_EVIDENCE.md');
const manualRunbookPath = path.join('docs', 'launch', 'MANUAL_EVIDENCE_RUNBOOK.md');
const manualExamplePath = path.join('docs', 'launch', 'MANUAL_EVIDENCE.example.json');
const operationsRunbookTestPath = path.join('tests', 'unit', 'operations-runbook.test.ts');
const strictQaCloudflarePreflightPath = path.join('outputs', '019f1a5e-2745-7c43-870d-544e6ba4e0b1', 'strict-qa-v2', 'cloudflare-domain-worker-preflight.md');

const startedAt = new Date();
const outputDir = path.join(process.cwd(), 'outputs', 'launch-integration-final-package', stamp(startedAt));
mkdirSync(outputDir, { recursive: true });

const evidenceSources: EvidenceSource[] = [
    {
        id: 'final_readiness',
        label: 'Final readiness worksheet',
        path: latestGeneratedPath('launch-final-readiness', 'integration-readiness-worksheet.md'),
        expectedStatus: 'OK',
        requiredForPass: true,
        role: 'Local static proof that runtime hooks and manual closure workflow exist.',
    },
    {
        id: 'cloudflare_domain_worker_preflight',
        label: 'Cloudflare Pages-vs-Worker/domain preflight',
        path: existsSync(strictQaCloudflarePreflightPath) ? toPosix(strictQaCloudflarePreflightPath) : null,
        requiredForPass: true,
        role: 'Current resource-level Cloudflare posture before production Worker/domain writes.',
    },
    {
        id: 'cloudflare_runtime_readonly',
        label: 'Cloudflare production runtime read-only evidence',
        path: latestGeneratedPath('launch-cloudflare-production-runtime-readonly', 'summary.md'),
        expectedStatus: 'OK',
        requiredForPass: true,
        role: 'Fresh Wrangler read-only proof of target account, Pages custom-domain owner, staging Worker, production Worker and secret-name posture.',
    },
    {
        id: 'cloudflare_runtime_cutover_preflight',
        label: 'Cloudflare production runtime cutover preflight',
        path: latestGeneratedPath('launch-cloudflare-production-runtime-cutover-preflight', 'summary.md'),
        expectedStatus: 'OK',
        requiredForPass: true,
        role: 'Commandized local build, guarded Wrangler production deploy dry-run, fail-closed checkout proof, custom-domain separation and dist cleanup before any production Worker approval.',
    },
    {
        id: 'cloudflare_worker_variable_matrix',
        label: 'Cloudflare production Worker variable matrix',
        path: latestGeneratedPath('launch-cloudflare-production-runtime-cutover-preflight', 'cloudflare-production-worker-variable-matrix.md'),
        requiredForPass: true,
        role: 'Names-only matrix for Astro Worker vars/secrets and fulfillment-only Google boundary; stores no secret values.',
    },
    {
        id: 'cloudflare_runtime_cutover',
        label: 'Cloudflare production runtime cutover package',
        path: latestGeneratedPath('launch-cloudflare-production-runtime-cutover', 'cloudflare-production-runtime-cutover-manifest.json'),
        expectedStatus: 'OK',
        requiredForPass: true,
        role: 'Phased Worker creation, secret-name setup, direct probe, domain move and rollback package.',
    },
    {
        id: 'cloudflare_worker_phase1_runner',
        label: 'Cloudflare production Worker phase-1 gated runner',
        path: latestGeneratedPath('launch-cloudflare-production-worker-phase1', 'summary.md'),
        expectedStatus: 'OK',
        requiredForPass: true,
        role: 'Local-gated phase-1 runner that refuses production Worker deploy unless the exact approval env var and flag match; plan mode records externalWritePerformed=false.',
    },
    {
        id: 'cloudflare_worker_secrets_runner',
        label: 'Cloudflare production web Worker secret-name/direct-attestation gated runner',
        path: latestGeneratedPath('launch-cloudflare-production-worker-secrets', 'summary.md'),
        expectedStatus: 'OK',
        requiredForPass: true,
        role: 'Plan-only runner that refuses web Worker secret-name loading unless exact account/ref/mode/site/env/direct-URL facts match; approved mode requires identity/version/Supabase attestation.',
    },
    {
        id: 'cloudflare_fulfillment_secrets_runner',
        label: 'Cloudflare production Fulfillment Worker config/secrets/email gated runner',
        path: latestGeneratedPath('launch-cloudflare-production-fulfillment-secrets', 'summary.md'),
        expectedStatus: 'OK',
        requiredForPass: true,
        role: 'Separate plan-only runner for production Supabase/Google/Resend/email names and config; approved mode requires exact target validation plus identity/version/Supabase attestation without sending email or processing jobs.',
    },
    {
        id: 'supabase_processed_at_cleanup',
        label: 'Supabase processed_at cleanup package',
        path: latestGeneratedPath('launch-supabase-processed-at-cleanup', 'supabase-processed-at-cleanup-manifest.json'),
        expectedStatus: 'OK',
        requiredForPass: true,
        role: 'Remaining production-only processed_webhook_events.processed_at default drift closure package.',
    },
    {
        id: 'supabase_processed_at_cleanup_runner',
        label: 'Supabase processed_at cleanup gated runner',
        path: latestGeneratedPath('launch-supabase-processed-at-cleanup-runner', 'summary.md'),
        expectedStatus: 'OK',
        requiredForPass: true,
        role: 'Plan-only runner that requires exact approval before applying the processed_at cleanup staging-first and production-second.',
    },
    {
        id: 'payments',
        label: 'Payments audit',
        path: latestGeneratedPath('launch-payments', 'summary.md'),
        expectedStatus: 'OK',
        requiredForPass: true,
        role: 'Static payment posture, checkout/webhook/catalog/portal/reconciliation support.',
    },
    {
        id: 'stripe_readonly',
        label: 'Stripe read-only evidence',
        path: latestGeneratedPath('launch-stripe-readonly-evidence', 'summary.md'),
        expectedStatus: 'OK',
        requiredForPass: false,
        role: 'Stripe account/test-mode/package/webhook support evidence; dashboard may replace it if connector limitations apply.',
    },
    {
        id: 'stripe_webhook_cutover_runner',
        label: 'Stripe webhook cutover gated runner',
        path: latestGeneratedPath('launch-stripe-webhook-cutover-runner', 'summary.md'),
        expectedStatus: 'OK',
        requiredForPass: true,
        role: 'Plan-only runner that refuses Stripe webhook endpoint URL updates unless test mode, endpoint id, target URL, live read-only preflight and exact approval all match.',
    },
    {
        id: 'google_readonly',
        label: 'Google read-only evidence',
        path: latestGeneratedPath('launch-google-readonly-evidence', 'summary.md'),
        expectedStatus: 'OK',
        requiredForPass: false,
        role: 'Google Drive/Docs/Calendar metadata evidence without mutations.',
    },
    {
        id: 'resend_readonly',
        label: 'Resend read-only evidence',
        path: latestGeneratedPath('resend-readonly-evidence', 'summary.md'),
        expectedStatus: 'OK',
        requiredForPass: false,
        role: 'Resend domain/log/email visibility without sends or private payloads.',
    },
    {
        id: 'turnstile_readonly',
        label: 'Turnstile read-only evidence',
        path: latestGeneratedPath('launch-turnstile-readonly-evidence', 'summary.md'),
        expectedStatus: 'OK',
        requiredForPass: false,
        role: 'Runtime key/siteverify support evidence; widget/domain dashboard evidence remains required if API listing is unavailable.',
    },
    {
        id: 'turnstile_domain_closure_runner',
        label: 'Turnstile domain closure gated runner',
        path: latestGeneratedPath('launch-turnstile-domain-closure-runner', 'summary.md'),
        expectedStatus: 'OK',
        requiredForPass: true,
        role: 'Plan-only runner that refuses Cloudflare Turnstile widget domain updates unless account, site key, live read-only widget preflight, allowed domains and exact approval all match.',
    },
    {
        id: 'sentry_readonly',
        label: 'Sentry read-only evidence',
        path: latestGeneratedPath('launch-sentry-readonly-evidence', 'summary.md'),
        expectedStatus: 'OK',
        requiredForPass: false,
        role: 'Sentry project/release/issue visibility; unresolved issue warnings require triage or accepted risk.',
    },
    {
        id: 'sentry_issue_triage_runner',
        label: 'Sentry issue triage gated runner',
        path: latestGeneratedPath('launch-sentry-issue-triage-runner', 'summary.md'),
        expectedStatus: 'OK',
        requiredForPass: true,
        role: 'Plan-only runner that refuses Sentry issue status changes unless org, project, environment, action, short IDs, live read-only preflight and exact approval all match.',
    },
    {
        id: 'seo_llm_final_package',
        label: 'SEO/LLM final package',
        path: latestGeneratedPath('launch-seo-llm-final-package', 'seo-llm-final-manifest.json'),
        expectedStatus: 'OK',
        requiredForPass: true,
        role: 'Production-domain parity and search/assistant/font final closure support.',
    },
    {
        id: 'final_smoke_execution_pack',
        label: 'Final smoke execution package',
        path: latestGeneratedPath('launch-final-smoke-execution-pack', 'final-smoke-execution-manifest.json'),
        expectedStatus: 'OK',
        requiredForPass: true,
        role: 'Write-capable final smoke approval, preflight and rollback support.',
    },
    {
        id: 'staging_smoke_rehearsal_runner',
        label: 'Staging smoke rehearsal gated runner',
        path: latestGeneratedPath('launch-staging-smoke-rehearsal-runner', 'summary.md'),
        expectedStatus: 'OK',
        requiredForPass: true,
        role: 'Plan-only and exact-gated staging lifecycle smoke rehearsal with Stripe test and real test providers; plan mode records no external writes and approved mode remains separate from final smoke.',
    },
];

const missingRequiredEvidence = evidenceSources
    .filter((source) => source.requiredForPass && !source.path)
    .map((source) => source.id);
const warningEvidence = evidenceSources
    .map((source) => ({ source, summary: readSummaryForSource(source) }))
    .filter(({ source, summary }) => source.path && summary?.status && !isPassingEvidenceStatus(summary.status))
    .map(({ source, summary }) => `${source.id}:${summary?.status}`);
const warningEvidenceDetails = evidenceSources.flatMap((source) => warningDetailsForSource(source));
const warningRemediationPlan = evidenceSources.flatMap((source) => remediationPlanForSource(source));
const blockingEvidence = [
    ...missingRequiredEvidence.map((id) => `${id}:missing`),
    ...warningEvidence,
];

const checks: PackageCheck[] = [
    validatePackageScript(),
    validateFinalReadinessSupport(),
    validateEvidenceAvailability(),
    validateDocsAndStatusWiring(),
];

let report = createReport(checks);
let rendered = renderArtifacts(report);
checks.push(validateGeneratedArtifactPosture(rendered));
report = createReport(checks);
rendered = renderArtifacts(report);

writeFileSync(report.packagePath, rendered.packageMarkdown, 'utf8');
writeFileSync(report.manifestPath, rendered.manifest, 'utf8');
writeFileSync(report.serviceMatrixPath, rendered.serviceMatrix, 'utf8');
writeFileSync(report.approvalChecklistPath, rendered.approvalChecklist, 'utf8');
writeFileSync(report.passDryRunPath, rendered.passDryRun, 'utf8');
writeFileSync(report.acceptedRiskDryRunPath, rendered.acceptedRiskDryRun, 'utf8');
writeFileSync(path.join(outputDir, 'summary.json'), JSON.stringify(report, null, 2), 'utf8');
writeFileSync(report.summaryPath, rendered.summary, 'utf8');

const failed = report.checks.filter((check) => check.status === 'failed');
const warnings = report.checks.filter((check) => check.status === 'warning');

console.log(`[launch:integration-final-package] Status: ${report.status}`);
console.log(`[launch:integration-final-package] Integration closure: ${report.integrationClosureStatus}`);
console.log(`[launch:integration-final-package] Failed: ${failed.length}`);
console.log(`[launch:integration-final-package] Warnings: ${warnings.length}`);
console.log(`[launch:integration-final-package] Blocking evidence: ${report.blockingEvidence.length}`);
console.log(`[launch:integration-final-package] Summary: ${report.summaryPath}`);
console.log(`[launch:integration-final-package] Package: ${report.packagePath}`);
console.log(`[launch:integration-final-package] Manifest: ${report.manifestPath}`);
console.log(`[launch:integration-final-package] Service matrix: ${report.serviceMatrixPath}`);

if (failed.length > 0) process.exit(1);

function createReport(reportChecks: PackageCheck[]): IntegrationPackageReport {
    const status = statusFor(reportChecks);
    const integrationClosureStatus: IntegrationClosureStatus = status === 'FAILED'
        ? 'BLOCKED_BY_PACKAGE_ERRORS'
        : blockingEvidence.length === 0
            ? 'READY_FOR_FINAL_REVIEW_INPUTS'
            : 'BLOCKED_BY_FINAL_EVIDENCE';

    return {
        schemaVersion: 1,
        startedAt: startedAt.toISOString(),
        endedAt: new Date().toISOString(),
        status,
        integrationClosureStatus,
        outputDir,
        evidenceSources,
        missingRequiredEvidence,
        warningEvidence,
        warningEvidenceDetails,
        warningRemediationPlan,
        blockingEvidence,
        checks: reportChecks,
        packagePath: path.join(outputDir, 'integration-final-package.md'),
        manifestPath: path.join(outputDir, 'integration-final-manifest.json'),
        serviceMatrixPath: path.join(outputDir, 'service-evidence-matrix.md'),
        approvalChecklistPath: path.join(outputDir, 'approval-checklist.md'),
        passDryRunPath: path.join(outputDir, 'manual-evidence-dry-run-pass.txt'),
        acceptedRiskDryRunPath: path.join(outputDir, 'manual-evidence-dry-run-accepted-risk.txt'),
        summaryPath: path.join(outputDir, 'summary.md'),
    };
}

function validatePackageScript(): PackageCheck {
    const packageJson = readJsonIfExists<{ packageManager?: string; scripts?: Record<string, string> }>('package.json');
    const missing: string[] = [];
    if (!packageJson) missing.push('package.json');
    if (packageJson?.packageManager !== 'pnpm@10.33.0') missing.push('packageManager=pnpm@10.33.0');
    if (packageJson?.scripts?.['launch:integration-final-package'] !== 'tsx scripts/launch/integration-final-package.ts') {
        missing.push('launch:integration-final-package=tsx scripts/launch/integration-final-package.ts');
    }

    return {
        status: missing.length === 0 ? 'ok' : 'failed',
        name: 'package_script_integration_final_package',
        message: missing.length === 0
            ? 'Package scripts expose the local-only integration final package and preserve pnpm policy.'
            : 'Package scripts are missing the integration final package or pnpm package manager contract.',
        details: missing.length === 0 ? ['launch:integration-final-package'] : missing.map((item) => `missing=${item}`),
    };
}

function validateFinalReadinessSupport(): PackageCheck {
    const finalReadiness = readIfExists(finalReadinessScriptPath);
    const required = [
        'reviewIntegrationEnvironmentCoverage',
        'reviewIntegrationRuntimeHooks',
        'renderIntegrationReadinessWorksheet',
        'Cloudflare production domain/runtime',
        'Stripe evidence source',
        'fulfillment/reminder worker',
    ];
    const missing = required.filter((snippet) => !finalReadiness.includes(snippet));

    return {
        status: missing.length === 0 ? 'ok' : 'failed',
        name: 'final_readiness_integration_support',
        message: missing.length === 0
            ? 'Final-readiness script preserves integration runtime, service and manual evidence coverage.'
            : 'Final-readiness script is missing required integration closure support.',
        details: missing.length === 0 ? [finalReadinessScriptPath] : missing.map((snippet) => `missing=${snippet}`),
    };
}

function validateEvidenceAvailability(): PackageCheck {
    if (missingRequiredEvidence.length > 0) {
        return {
            status: 'warning',
            name: 'required_integration_evidence_availability',
            message: 'Some required generated integration evidence is missing; integration_readiness cannot close yet.',
            details: missingRequiredEvidence,
        };
    }

    return {
        status: warningEvidence.length === 0 ? 'ok' : 'warning',
        name: 'required_integration_evidence_availability',
        message: warningEvidence.length === 0
            ? 'Required generated integration evidence is available and no source status warning was detected.'
            : 'Required/generated integration evidence is available, but one or more latest sources are not OK and need final review or accepted risk.',
        details: warningEvidence.length === 0 ? ['required evidence present'] : warningEvidence,
    };
}

function validateDocsAndStatusWiring(): PackageCheck {
    const required: Array<[string, string]> = [
        [statusScriptPath, 'integrationFinalPackage'],
        [statusScriptPath, 'integration-final-manifest.json'],
        [statusScriptPath, 'service-evidence-matrix.md'],
        [manualEvidencePath, 'outputs/launch-integration-final-package/<timestamp>/integration-final-manifest.json'],
        [manualEvidencePath, 'launch-cloudflare-production-runtime-readonly'],
        [manualEvidencePath, 'launch-cloudflare-production-runtime-cutover-preflight'],
        [manualEvidencePath, 'launch-cloudflare-production-worker-phase1'],
        [manualEvidencePath, 'launch-cloudflare-production-worker-secrets'],
        [manualEvidencePath, 'launch:stripe-webhook-cutover-runner'],
        [manualEvidencePath, 'launch:turnstile-domain-closure-runner'],
        [manualEvidencePath, 'launch:sentry-issue-triage-runner'],
        [manualEvidencePath, 'cloudflare-production-worker-variable-matrix.md'],
        [manualRunbookPath, 'pnpm launch:integration-final-package'],
        [manualRunbookPath, 'pnpm launch:cloudflare-production-runtime-readonly'],
        [manualRunbookPath, 'pnpm launch:cloudflare-production-runtime-cutover-preflight'],
        [manualRunbookPath, 'pnpm launch:cloudflare-production-worker-phase1'],
        [manualRunbookPath, 'pnpm launch:cloudflare-production-worker-secrets'],
        [manualRunbookPath, 'pnpm launch:stripe-webhook-cutover-runner'],
        [manualRunbookPath, 'pnpm launch:turnstile-domain-closure-runner'],
        [manualRunbookPath, 'pnpm launch:sentry-issue-triage-runner'],
        [manualRunbookPath, 'cloudflare-production-worker-variable-matrix.md'],
        [manualRunbookPath, 'service-evidence-matrix.md'],
        [manualExamplePath, 'outputs/launch-cloudflare-production-runtime-readonly/<timestamp>/summary.md'],
        [manualExamplePath, 'outputs/launch-cloudflare-production-runtime-cutover-preflight/<timestamp>/summary.md'],
        [manualExamplePath, 'outputs/launch-cloudflare-production-runtime-cutover-preflight/<timestamp>/cloudflare-production-worker-variable-matrix.md'],
        [manualExamplePath, 'outputs/launch-cloudflare-production-worker-phase1/<timestamp>/summary.md'],
        [manualExamplePath, 'outputs/launch-cloudflare-production-worker-secrets/<timestamp>/summary.md'],
        [manualExamplePath, 'outputs/launch-stripe-webhook-cutover-runner/<timestamp>/summary.md'],
        [manualExamplePath, 'outputs/launch-turnstile-domain-closure-runner/<timestamp>/summary.md'],
        [manualExamplePath, 'outputs/launch-sentry-issue-triage-runner/<timestamp>/summary.md'],
        [manualExamplePath, 'outputs/launch-supabase-processed-at-cleanup-runner/<timestamp>/summary.md'],
        [manualExamplePath, 'outputs/launch-integration-final-package/<timestamp>/integration-final-manifest.json'],
        [operationsRunbookTestPath, 'launch:integration-final-package'],
        [operationsRunbookTestPath, 'launch:cloudflare-production-runtime-readonly'],
        [operationsRunbookTestPath, 'launch:cloudflare-production-runtime-cutover-preflight'],
        [operationsRunbookTestPath, 'launch:cloudflare-production-worker-phase1'],
        [operationsRunbookTestPath, 'launch:cloudflare-production-worker-secrets'],
        [operationsRunbookTestPath, 'launch:stripe-webhook-cutover-runner'],
        [operationsRunbookTestPath, 'launch:turnstile-domain-closure-runner'],
        [operationsRunbookTestPath, 'launch:sentry-issue-triage-runner'],
        [operationsRunbookTestPath, 'launch:supabase-processed-at-cleanup-runner'],
        [operationsRunbookTestPath, 'cloudflare-production-worker-variable-matrix.md'],
    ];
    const missingFiles = [...new Set(required.map(([file]) => file))].filter((file) => !existsSync(file));
    const missing = required.filter(([file, snippet]) => !readIfExists(file).includes(snippet));

    return {
        status: missingFiles.length === 0 && missing.length === 0 ? 'ok' : 'failed',
        name: 'docs_status_integration_final_package_wiring',
        message: missingFiles.length === 0 && missing.length === 0
            ? 'Status, manual evidence docs, example evidence and runbook tests point to the integration final package.'
            : 'Integration final package is not fully wired into status, docs or tests.',
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
        'secret names only',
        'Cloudflare Pages-vs-Worker',
        'Stripe evidence source',
        'Google',
        'Resend',
        'Turnstile',
        'Sentry',
        'Supabase processed_at',
    ];
    const missing = requiredSafetyText.filter((snippet) => !combined.includes(snippet));

    return {
        status: offenders.length === 0 && missing.length === 0 ? 'ok' : 'failed',
        name: 'generated_artifact_secret_and_scope_posture',
        message: offenders.length === 0 && missing.length === 0
            ? 'Generated artifacts contain integration scope gates and no obvious secret values.'
            : 'Generated artifacts are missing safety text or appear to include secret-like values.',
        details: [
            ...offenders.map((pattern) => `secretPattern=${pattern}`),
            ...missing.map((snippet) => `missing=${snippet}`),
        ],
    };
}

function renderArtifacts(report: IntegrationPackageReport): RenderedArtifacts {
    const packageMarkdown = renderPackage(report);
    const serviceMatrix = renderServiceMatrix(report);
    const approvalChecklist = renderApprovalChecklist(report);
    const passDryRun = renderPassDryRun(report);
    const acceptedRiskDryRun = renderAcceptedRiskDryRun(report);
    const summary = renderSummary(report);
    const manifest = renderManifest(report, { packageMarkdown, serviceMatrix, approvalChecklist, passDryRun, acceptedRiskDryRun, summary });

    return { packageMarkdown, manifest, serviceMatrix, approvalChecklist, passDryRun, acceptedRiskDryRun, summary };
}

function renderPackage(report: IntegrationPackageReport): string {
    const lines = [
        '# Integration Final Package',
        '',
        `- Generated: ${report.endedAt}`,
        `- Status: ${report.status}`,
        `- Integration closure status: ${report.integrationClosureStatus}`,
        `- Blocking evidence count: ${report.blockingEvidence.length}`,
        '',
        'This package is local-only. It does not deploy, does not write external services, does not rotate keys, does not print secrets and does not close `integration_readiness` by itself.',
        '',
        '## Current Blocking Evidence',
        '',
    ];

    if (report.blockingEvidence.length === 0) {
        lines.push('- No generated evidence blocker detected by this local package.');
    } else {
        for (const item of report.blockingEvidence) lines.push(`- ${item}`);
    }

    lines.push(
        '',
        '## Warning Evidence Synopsis',
        '',
    );

    if (report.warningEvidenceDetails.length === 0) {
        lines.push('- No warning or failed source detail detected.');
    } else {
        for (const detail of report.warningEvidenceDetails) lines.push(`- ${detail}`);
    }

    lines.push(
        '',
        '## Blocking Warning Remediation Plan',
        '',
        ...renderWarningRemediationPlan(report.warningRemediationPlan),
    );

    lines.push(
        '',
        '## Evidence Matrix',
        '',
        '| Required | Source | Path | Role | Latest Status |',
        '| --- | --- | --- | --- | --- |',
    );

    for (const source of report.evidenceSources) {
        const summary = readSummaryForSource(source);
        lines.push(`| ${source.requiredForPass ? 'yes' : 'support'} | ${escapeCell(source.label)} | ${escapeCell(source.path ?? 'missing')} | ${escapeCell(source.role)} | ${escapeCell(summary?.status ?? 'n/a')} |`);
    }

    lines.push(
        '',
        '## Human Inputs Still Required',
        '',
        '- Final payment posture: Stripe test rehearsal completed, then Stripe live with dashboard/webhook/reconciliation evidence; no-checkout is rollback only.',
        '- Stripe evidence source: if connector list/search evidence is incomplete, use Stripe dashboard, checkout/webhook delivery and Supabase reconciliation evidence instead.',
        '- Cloudflare Pages-vs-Worker/domain ownership: production Worker shell, commandized build/dry-run preflight, variable matrix, secret names, direct URL probes and custom domains.',
        '- Supabase processed_at default drift: apply/verify the cleanup migration or explicitly accept the risk.',
        '- Google Drive/Docs/Calendar/Meet production account and permissions.',
        '- Resend sender/domain/log/suppression posture.',
        '- Turnstile widget domains in Cloudflare dashboard/API.',
        '- Sentry unresolved production issue triage, alert ownership and release/environment posture.',
        '- Legacy Worker `espanol-honesto-reminders` decision: disabled/deleted or documented as non-interfering.',
        '- Final key rotation names/posture without storing values.',
        '',
        '## Before And After Ledger',
        '',
        'Before this package:',
        '',
        '- `integration_readiness` depended on several generated packages and read-only probes spread across outputs and docs.',
        '- A reviewer could miss that SEO/domain, Supabase processed_at, Sentry/Turnstile or Cloudflare production runtime preflight evidence was still warning/open.',
        '',
        'After this package:',
        '',
        '- No runtime, dashboard, secret, payment, legal, UX or external service value changed.',
        '- The integration evidence matrix, pass dry-run and accepted-risk dry-run are generated from current local evidence paths.',
        '',
        'Cost/benefit:',
        '',
        '- Benefit: reduces false integration closure risk by making every external-service evidence dependency visible in one artifact.',
        '- Cost: one additional local support script and generated output folder to maintain.',
        '',
        'Rollback:',
        '',
        '- Remove `scripts/launch/integration-final-package.ts`, the package script and related status/runbook/test/tracker references.',
        '- No service rollback is required because this package performs no external writes.',
        '',
    );

    return `${lines.join('\n')}\n`;
}

function renderServiceMatrix(report: IntegrationPackageReport): string {
    const lines = [
        '# Integration Service Evidence Matrix',
        '',
        '| Source | Required For Pass | Latest Path | Latest Status | Role |',
        '| --- | --- | --- | --- | --- |',
    ];

    for (const source of report.evidenceSources) {
        const summary = readSummaryForSource(source);
        lines.push(`| ${escapeCell(source.label)} | ${source.requiredForPass ? 'yes' : 'support or dashboard substitute'} | ${escapeCell(source.path ?? 'missing')} | ${escapeCell(summary?.status ?? 'n/a')} | ${escapeCell(source.role)} |`);
    }

    lines.push(
        '',
        '## Rule',
        '',
        'For `integration_readiness`, support evidence can be replaced by dashboard/manual evidence only when the manual record names the source, date, owner, environment, non-secret result and rollback/follow-up. Generated WARNING evidence must not be ignored silently.',
        '',
    );

    return `${lines.join('\n')}\n`;
}

function renderApprovalChecklist(report: IntegrationPackageReport): string {
    return `${[
        '# Integration Final Approval Checklist',
        '',
        'Use this before marking `integration_readiness` pass or accepted_risk.',
        '',
        '## No-Write Boundary',
        '',
        '- This package does not deploy, does not write external services and does not rotate keys.',
        '- Store secret names only, never values.',
        '- External writes still need exact resource approval and read-only preflight.',
        '',
        '## Final Checks',
        '',
        '- Payment posture documented and consistent with public checkout behavior.',
        '- Cloudflare production runtime and domains verified or explicitly risk-accepted.',
        '- Supabase processed_at drift applied/verified or explicitly risk-accepted.',
        '- Google, Resend, Turnstile, Sentry and fulfillment/reminder evidence reviewed.',
        '- Legacy Worker decision recorded.',
        '- SEO/domain package and final smoke execution package are reviewed because they depend on the same production runtime.',
        '',
        '## Current State',
        '',
        `- Integration closure status: ${report.integrationClosureStatus}`,
        `- Blocking evidence: ${report.blockingEvidence.join(', ') || 'none'}`,
        '',
        '## Blocking Warning Remediation Plan',
        '',
        ...renderWarningRemediationPlan(report.warningRemediationPlan),
        '',
    ].join('\n')}\n`;
}

function renderPassDryRun(report: IntegrationPackageReport): string {
    const packagePath = `../../${toPosix(path.relative(process.cwd(), report.packagePath))}`;
    const manifestPath = `../../${toPosix(path.relative(process.cwd(), report.manifestPath))}`;
    const matrixPath = `../../${toPosix(path.relative(process.cwd(), report.serviceMatrixPath))}`;
    const checklistPath = `../../${toPosix(path.relative(process.cwd(), report.approvalChecklistPath))}`;

    return `${[
        'corepack pnpm launch:manual-evidence:record --',
        '  --id integration_readiness',
        '  --status pass',
        '  --summary "Production integration readiness verified across Cloudflare, Supabase, Google, Resend, Turnstile, Sentry/logs and rollback baseline."',
        '  --environment production',
        '  --owner Alin',
        `  --evidence "command_output=${packagePath}::integration final package reviewed"`,
        `  --evidence "command_output=${manifestPath}::integration final manifest reviewed"`,
        `  --evidence "command_output=${matrixPath}::service evidence matrix completed"`,
        `  --evidence "command_output=${checklistPath}::integration final approval checklist completed"`,
        '  --evidence "manual_note=Replace with concrete non-secret result: final payment posture, Cloudflare runtime/domain, Supabase drift, Google, Resend, Turnstile, Sentry, legacy Worker and rollback posture reviewed."',
        '',
        '# Add --write only after replacing the placeholder note with real non-secret evidence.',
        '',
    ].join(' \\\n')}`;
}

function renderAcceptedRiskDryRun(report: IntegrationPackageReport): string {
    const packagePath = `../../${toPosix(path.relative(process.cwd(), report.packagePath))}`;
    const matrixPath = `../../${toPosix(path.relative(process.cwd(), report.serviceMatrixPath))}`;

    return `${[
        'corepack pnpm launch:manual-evidence:record --',
        '  --id integration_readiness',
        '  --status accepted_risk',
        '  --summary "A specific production integration limitation is documented and accepted for launch."',
        '  --environment production',
        '  --owner Alin',
        '  --risk-accepted-by Alin',
        '  --risk-rationale "Replace with concrete rationale: the integration limitation is scoped, has a known owner and manual fallback, and does not compromise secrets or data boundaries."',
        '  --rollback-plan "Replace with concrete plan: pause affected workflow, use fallback, inspect logs, fix configuration and rerun final-readiness/status plus relevant provider evidence."',
        `  --evidence "command_output=${packagePath}::integration package reviewed before risk acceptance"`,
        `  --evidence "command_output=${matrixPath}::specific provider limitation scoped"`,
        '  --evidence "manual_note=Replace with concrete non-secret result: Alin accepted a scoped integration risk with owner, impact, fallback and monitoring path."',
        '',
        '# Add --write only after replacing placeholder rationale, rollback and note with concrete accepted-risk evidence.',
        '',
    ].join(' \\\n')}`;
}

function renderSummary(report: IntegrationPackageReport): string {
    const lines = [
        '# Integration Final Package Summary',
        '',
        `- Status: ${report.status}`,
        `- Integration closure status: ${report.integrationClosureStatus}`,
        `- Blocking evidence count: ${report.blockingEvidence.length}`,
        `- Package: ${toPosix(path.relative(process.cwd(), report.packagePath))}`,
        `- Manifest: ${toPosix(path.relative(process.cwd(), report.manifestPath))}`,
        `- Service matrix: ${toPosix(path.relative(process.cwd(), report.serviceMatrixPath))}`,
        '',
        'This package is local-only. It does not deploy, does not write external services, does not rotate keys and does not close `integration_readiness` by itself.',
        '',
        '| Status | Check | Message | Details |',
        '| --- | --- | --- | --- |',
    ];

    for (const check of report.checks) {
        lines.push(`| ${check.status} | ${check.name} | ${escapeCell(check.message)} | ${escapeCell(check.details.join(' / '))} |`);
    }

    if (report.warningEvidenceDetails.length > 0) {
        lines.push(
            '',
            '## Warning Evidence Synopsis',
            '',
            ...report.warningEvidenceDetails.map((detail) => `- ${detail}`),
        );
    }

    if (report.warningRemediationPlan.length > 0) {
        lines.push(
            '',
            '## Blocking Warning Remediation Plan',
            '',
            ...renderWarningRemediationPlan(report.warningRemediationPlan),
        );
    }

    lines.push('');
    return `${lines.join('\n')}\n`;
}

function renderManifest(report: IntegrationPackageReport, renderedFiles: Omit<RenderedArtifacts, 'manifest'>): string {
    return `${JSON.stringify({
        schemaVersion: 1,
        generatedAt: report.endedAt,
        status: report.status,
        integrationClosureStatus: report.integrationClosureStatus,
        evidenceSources: report.evidenceSources,
        missingRequiredEvidence: report.missingRequiredEvidence,
        warningEvidence: report.warningEvidence,
        warningEvidenceDetails: report.warningEvidenceDetails,
        warningRemediationPlan: report.warningRemediationPlan,
        blockingEvidence: report.blockingEvidence,
        doesNotDeploy: true,
        doesNotWriteExternalServices: true,
        secretNamesOnly: true,
        finalReviewRequirements: [
            'Stripe live payment posture and rollback',
            'Cloudflare Pages-vs-Worker/domain ownership',
            'Cloudflare production runtime read-only snapshot',
            'Cloudflare production runtime build/dry-run preflight',
            'Cloudflare production Worker variable matrix without values',
            'production Worker existence, secret-name runner and direct Worker probes',
            'Supabase processed_at drift decision',
            'Google Drive/Docs/Calendar/Meet',
            'Resend sender/domain/log/suppression',
            'Turnstile widget domains',
            'Sentry triage/alerts/releases',
            'fulfillment/reminder worker and legacy Worker decision',
            'final key rotation posture without values',
        ],
        files: {
            package: fileMeta(report.packagePath, renderedFiles.packageMarkdown),
            serviceMatrix: fileMeta(report.serviceMatrixPath, renderedFiles.serviceMatrix),
            approvalChecklist: fileMeta(report.approvalChecklistPath, renderedFiles.approvalChecklist),
            passDryRun: fileMeta(report.passDryRunPath, renderedFiles.passDryRun),
            acceptedRiskDryRun: fileMeta(report.acceptedRiskDryRunPath, renderedFiles.acceptedRiskDryRun),
            summary: fileMeta(report.summaryPath, renderedFiles.summary),
        },
        checks: report.checks,
    }, null, 2)}\n`;
}

function readSummaryForSource(source: EvidenceSource): SummaryLike | null {
    if (!source.path) return null;
    const normalizedPath = source.path.endsWith('.json') ? source.path : source.path.replace(/summary\.md$/, 'summary.json');
    return readJsonIfExists<SummaryLike>(normalizedPath);
}

function isPassingEvidenceStatus(status: string | undefined): boolean {
    return Boolean(status && ['OK', 'READY_FOR_FINAL_REVIEW_INPUTS', 'READY_FOR_FINAL_SMOKE_APPROVAL'].includes(status));
}

function warningDetailsForSource(source: EvidenceSource): string[] {
    const summary = readSummaryForSource(source);
    if (!source.path || !summary?.status || isPassingEvidenceStatus(summary.status)) return [];

    const prefix = `${source.id}:${summary?.status ?? 'missing'}`;
    const warningChecks = (summary?.checks ?? []).filter((check) => {
        const status = String(check.status ?? '').toLowerCase();
        return status && status !== 'ok';
    });

    if (warningChecks.length === 0) {
        return [`${prefix} - ${source.path}`];
    }

    return warningChecks.slice(0, 5).map((check) => {
        const details = (check.details ?? [])
            .slice(0, 6)
            .map((detail) => cleanDetail(detail))
            .filter(Boolean)
            .join(' / ');
        return `${prefix} ${check.name ?? 'summary'} - ${cleanDetail(check.message ?? 'No warning message recorded.')}${details ? ` (${details})` : ''}`;
    });
}

function remediationPlanForSource(source: EvidenceSource): WarningRemediation[] {
    const summary = readSummaryForSource(source);
    if (!source.path || !summary?.status || isPassingEvidenceStatus(summary.status)) return [];

    const problem = warningDetailsForSource(source)[0] ?? `${source.id}:${summary.status} needs review.`;
    const base = {
        sourceId: source.id,
        status: summary.status,
        problem: cleanDetail(problem),
    };

    if (source.id === 'stripe_readonly') {
        return [{
            ...base,
            allowedNextStep: 'Run corepack pnpm --config.verify-deps-before-run=false launch:stripe-webhook-cutover-pack and corepack pnpm --config.verify-deps-before-run=false launch:stripe-webhook-cutover-runner. Then, only after read-only Stripe account/mode preflight and exact approval, update only the selected test-mode webhook endpoint URL for the launch runtime, preserving the intended /api/stripe-webhook path and event list; do not change products, prices, customers, subscriptions or signing secret values in repo artifacts.',
            readOnlyVerification: 'Rerun corepack pnpm --config.verify-deps-before-run=false launch:stripe-readonly and confirm stripe_webhook_endpoints_readonly is OK with at least one enabled expected host and no unexpected enabled host.',
            evidenceToRecord: 'Record the new launch:stripe-readonly summary.md plus the runner summary/manifest and a non-secret dashboard note naming mode, endpoint id prefix, host, enabled event set, owner and date; never record the webhook signing secret.',
            rollbackOrRisk: 'Rollback is to disable the newly added/edited endpoint or restore the prior endpoint host. If the old host remains intentionally enabled, record accepted risk with why it cannot receive public launch traffic.',
            externalWriteGate: 'Any Stripe webhook endpoint create/update/disable is an external write and needs exact approval naming Stripe mode, endpoint/resource, host and event scope after preflight.',
        }];
    }

    if (source.id === 'turnstile_readonly') {
        return [{
            ...base,
            allowedNextStep: 'Run corepack pnpm --config.verify-deps-before-run=false launch:turnstile-domain-closure-pack and corepack pnpm --config.verify-deps-before-run=false launch:turnstile-domain-closure-runner. Then provide Cloudflare read-only inputs or exact-approved runner/dashboard evidence confirming the configured Turnstile site key belongs to the intended widget and covers espanolhonesto.com, www.espanolhonesto.com and staging.espanolhonesto.com.',
            readOnlyVerification: 'Rerun corepack pnpm --config.verify-deps-before-run=false launch:turnstile-readonly and confirm cloudflare_api_token_readonly and turnstile_widgets_readonly are OK, or attach dashboard evidence with the same domain facts.',
            evidenceToRecord: 'Record the launch:turnstile-readonly summary.md plus the runner summary/manifest or dashboard note with site key prefix, widget name, allowed domains, owner and date; never record the Turnstile secret key or Cloudflare API token.',
            rollbackOrRisk: 'Rollback is to remove any wrongly added domain from the named Turnstile widget or restore the previous widget/key pairing. If API evidence is unavailable, accepted risk must name the dashboard substitute and final browser form smoke.',
            externalWriteGate: 'Any Turnstile widget/domain change is a Cloudflare external write and needs exact approval naming account, widget/site key prefix and domain list after read-only or dashboard preflight.',
        }];
    }

    if (source.id === 'sentry_readonly') {
        return [{
            ...base,
            allowedNextStep: 'Run corepack pnpm --config.verify-deps-before-run=false launch:sentry-triage-pack and corepack pnpm --config.verify-deps-before-run=false launch:sentry-issue-triage-runner. Then triage visible unresolved production issues to resolved/ignored under exact approval, or explicitly accept the scoped launch risk with owner, monitor and fallback; do not store titles, stack traces, event ids or payloads in repo artifacts.',
            readOnlyVerification: 'Rerun corepack pnpm --config.verify-deps-before-run=false launch:sentry-readonly and confirm the selected production unresolved issue count is within the configured threshold.',
            evidenceToRecord: 'Record the summary.md plus the runner summary/manifest or a non-secret dashboard note with project, environment, query window, resulting count, short IDs/action, owner and date.',
            rollbackOrRisk: 'Rollback is operational: pause the affected release path or revert the release/config that created the issue spike, then rerun read-only evidence. Accepted risk must include impact, monitor and response owner.',
            externalWriteGate: 'Changing Sentry issue status, alert rules or releases is an external write and needs exact approval naming project, environment and action scope after preflight.',
        }];
    }

    if (source.id === 'cloudflare_runtime_readonly') {
        return [{
            ...base,
            allowedNextStep: 'Regenerate corepack pnpm --config.verify-deps-before-run=false launch:cloudflare-production-runtime-readonly and corepack pnpm --config.verify-deps-before-run=false launch:cloudflare-production-runtime-cutover-preflight, then follow the Cloudflare production runtime cutover package in separate phases: Worker create/deploy, secret-name verification, direct Worker probe and later custom-domain move. Do not combine domain move with Worker creation.',
            readOnlyVerification: 'Rerun corepack pnpm --config.verify-deps-before-run=false launch:cloudflare-production-runtime-readonly after each approved Cloudflare phase and confirm production_worker_exists, production_worker_secret_names and pages_project_current_domain_owner move toward OK in the expected order.',
            evidenceToRecord: 'Record summary.md plus non-secret dashboard notes naming account id, project, Worker, domains and secret names only; never record secret values, tokens, DNS credentials or private dashboard screenshots.',
            rollbackOrRisk: 'Rollback is to keep or return espanolhonesto.com/www to the previous verified Pages/Worker target while checkout remains disabled; accepted risk must name the old Pages/Worker state and user/SEO impact.',
            externalWriteGate: 'Any Cloudflare deploy, secret write, route, DNS, Pages domain or Worker domain change needs exact approval naming account, Worker/project, domains and forbidden scope after this read-only preflight.',
        }];
    }

    if (source.id === 'cloudflare_runtime_cutover_preflight') {
        return [{
            ...base,
            allowedNextStep: 'Review the generated preflight summary and variable matrix, then regenerate corepack pnpm --config.verify-deps-before-run=false launch:cloudflare-production-runtime-cutover after any local config/build change. If the only warning is worker_missing, proceed only to the separate Worker phase-1 approval; do not move domains or load secret values in that same phase.',
            readOnlyVerification: 'Rerun corepack pnpm --config.verify-deps-before-run=false launch:cloudflare-production-runtime-cutover-preflight and confirm command_scope_no_external_write, local_build_passed, wrangler_production_dry_run_passed, dry_run_checkout_disabled, dry_run_no_custom_domain_attachment and dist_cleanup_posture are OK.',
            evidenceToRecord: 'Record summary.md, manifest.json and cloudflare-production-worker-variable-matrix.md only; never record secret values, token values, private keys or dashboard screenshots containing secrets.',
            rollbackOrRisk: 'Rollback is local: keep production domains on the old verified runtime, keep CHECKOUT_ENABLED=false, discard the generated dry-run artifacts if stale, fix config/build and rerun the preflight before requesting any Cloudflare write.',
            externalWriteGate: 'This preflight does not authorize deploy. Any Cloudflare deploy, secret put, route, DNS or domain move still needs exact approval naming account, Worker/project, domains and forbidden scope.',
        }];
    }

    if (source.id === 'cloudflare_worker_phase1_runner') {
        return [{
            ...base,
            allowedNextStep: 'Run corepack pnpm --config.verify-deps-before-run=false launch:cloudflare-production-worker-phase1 in plan mode. Only later, after exact approval, use CLOUDFLARE_PHASE1_APPROVAL plus --execute-approved for the Worker-create phase.',
            readOnlyVerification: 'Open the generated summary and confirm status OK, phaseOneClosureStatus PLAN_ONLY_READY, externalWritePerformed=false, and approval-gate.md contains the exact target and forbidden scope.',
            evidenceToRecord: 'Record the runner summary, phase1-command-manifest.json, phase1-execution-plan.md, approval-gate.md and rollback-after-phase1.md paths without secret values.',
            rollbackOrRisk: 'No rollback for plan mode. If an approved deploy later fails, keep domains on Pages and follow rollback-after-phase1.md.',
            externalWriteGate: 'Requires exact CLOUDFLARE_PHASE1_APPROVAL value and --execute-approved; no domain move, DNS change, Pages deletion, secret loading or CHECKOUT_ENABLED=true.',
        }];
    }

    if (source.id === 'cloudflare_worker_secrets_runner') {
        return [{
            ...base,
            allowedNextStep: 'Run corepack pnpm --config.verify-deps-before-run=false launch:cloudflare-production-worker-secrets in plan mode. Only later, after the production Worker exists and exact approval is present, use CLOUDFLARE_WORKER_SECRETS_APPROVAL plus --execute-approved with the exact CLOUDFLARE_WORKER_DIRECT_URL.',
            readOnlyVerification: 'Open the generated summary and confirm status OK, closureStatus PLAN_ONLY_READY, externalWritePerformed=false, cloudflare-worker-secrets-command-manifest.json lists names only, and approval-gate.md forbids domain/DNS/Pages/payment changes.',
            evidenceToRecord: 'Record summary.md, cloudflare-worker-secrets-command-manifest.json, cloudflare-worker-secrets-execution-plan.md, approval-gate.md and rollback-after-worker-secrets.md paths without secret values. After approved execution, record only secret names present and direct Worker probe captures.',
            rollbackOrRisk: 'No rollback for plan mode. If an approved secret-name load later fails, keep domains on Pages, correct only the affected name under exact approval and rerun the direct Worker probes before domain approval.',
            externalWriteGate: 'Requires exact CLOUDFLARE_WORKER_SECRETS_APPROVAL plus account/ref/live-mode/site/env/direct-URL validation and --execute-approved; no domain move, DNS change, Pages deletion, secret value output or CHECKOUT_ENABLED=true.',
        }];
    }

    if (source.id === 'cloudflare_fulfillment_secrets_runner') {
        return [{
            ...base,
            allowedNextStep: 'Run corepack pnpm --config.verify-deps-before-run=false launch:cloudflare-production-fulfillment-secrets in plan mode. Execute only after the exact Fulfillment Worker approval, secure production env source and exact direct URL are ready.',
            readOnlyVerification: 'Confirm the plan summary is OK/externalWritePerformed=false, then after approved execution require health plus authenticated identity/version/Supabase attestation.',
            evidenceToRecord: 'Record summary.md, command-manifest.json, execution-plan.md, approval-gate.md and non-secret attestation result only; never record Google/Resend/Supabase/internal secret values.',
            rollbackOrRisk: 'No rollback for plan mode. If secret loading fails, do not send email/process jobs or move domains; correct only the named Cloudflare secret under a new exact approval.',
            externalWriteGate: 'Requires exact CLOUDFLARE_FULFILLMENT_SECRETS_APPROVAL, --execute-approved, exact account/ref/site/env/email limits/direct URL and an existing production Fulfillment Worker; no web Worker/domain/provider mutation.',
        }];
    }

    if (source.id === 'supabase_processed_at_cleanup_runner') {
        return [{
            ...base,
            allowedNextStep: 'Run corepack pnpm --config.verify-deps-before-run=false launch:supabase-processed-at-cleanup and corepack pnpm --config.verify-deps-before-run=false launch:supabase-processed-at-cleanup-runner in plan mode. Only later, after exact approval, use SUPABASE_PROCESSED_AT_CLEANUP_APPROVAL plus --execute-approved for the staging-first/production-second cleanup.',
            readOnlyVerification: 'Open the generated runner summary and confirm status OK, closureStatus PLAN_ONLY_READY, externalWritePerformed=false, and approval-gate.md contains the exact staging/production project refs and forbidden scope.',
            evidenceToRecord: 'Record summary.md, processed-at-cleanup-command-manifest.json, processed-at-cleanup-execution-plan.md, approval-gate.md and rollback-after-cleanup.md paths without database URLs or secret values.',
            rollbackOrRisk: 'No rollback for plan mode. If an approved apply later fails, stop before production if staging failed and follow rollback-after-cleanup.md plus the cleanup package rollback SQL only under separate exact approval.',
            externalWriteGate: 'Requires exact SUPABASE_PROCESSED_AT_CLEANUP_APPROVAL value and --execute-approved; no db push, no unrelated migration, no row/user/Auth/Storage/API-setting changes and no other provider writes.',
        }];
    }

    if (source.id === 'seo_llm_final_package') {
        return [{
            ...base,
            allowedNextStep: 'Complete the production domain/runtime parity path so robots.txt, sitemap-public.xml, llms.txt and modern public routes are served from espanolhonesto.com; if this depends on Cloudflare, use the Cloudflare production runtime cutover package first.',
            readOnlyVerification: 'Rerun corepack pnpm --config.verify-deps-before-run=false launch:live-domain-readonly and corepack pnpm --config.verify-deps-before-run=false launch:seo-llm-final-package until live-domain evidence and SEO/LLM final package are OK.',
            evidenceToRecord: 'Record both generated summaries plus any Search Console or dashboard evidence as non-secret owner/date notes; do not store private analytics exports or paid font license files.',
            rollbackOrRisk: 'Rollback is to return the custom domain to the previous verified runtime or restore prior crawl files. If launching with the old domain state, accepted risk must name missing resources, SEO impact and mitigation.',
            externalWriteGate: 'Any Cloudflare domain/DNS/deploy/Search Console write needs exact resource approval; this local package only describes the required closure path.',
        }];
    }

    if (source.id === 'final_smoke_execution_pack') {
        return [{
            ...base,
            allowedNextStep: 'Clear every non-smoke final prerequisite first: legal owner/review, integration provider evidence, SEO/domain parity, and Supabase processed_at cleanup or documented risk; rerun corepack pnpm --config.verify-deps-before-run=false launch:status and corepack pnpm --config.verify-deps-before-run=false launch:final-smoke-execution-pack, and only move to real smoke after the pack reports READY_FOR_FINAL_SMOKE_APPROVAL.',
            readOnlyVerification: 'Rerun corepack pnpm --config.verify-deps-before-run=false launch:status and corepack pnpm --config.verify-deps-before-run=false launch:final-smoke-execution-pack; confirm the manifest has readyForApproval=true, finalPrerequisiteBlockers=[] and no WAITING_ON_FINAL_PREREQUISITES status.',
            evidenceToRecord: 'Record the redacted outputs/real-env-smoke/<timestamp>/summary.md after execution plus final-smoke-execution-manifest.json, approval-request-final-smoke.md, preflight-checklist.md, rollback-and-cleanup-plan.md, owner and date; never record passwords, tokens, Stripe secrets, Google private keys or private customer payloads.',
            rollbackOrRisk: 'Use rollback-and-cleanup-plan.md for created test users, checkout state, sessions, calendar artifacts, fulfillment jobs and emails. If a smoke gap is accepted, record the exact skipped behavior, impact, fallback, owner and the post-fix rerun date.',
            externalWriteGate: 'Any real final smoke that can write Supabase, Stripe, Google, Resend or admin jobs needs exact approval naming environment, SMOKE_BASE_URL, SMOKE_EXTERNAL_WRITES_CONFIRMATION=writes-ok:<host>, payment posture and smoke credential source. No Cloudflare deploy, DNS or domain writes are allowed by this step.',
        }];
    }

    if (source.id === 'staging_smoke_rehearsal_runner') {
        return [{
            ...base,
            allowedNextStep: 'Run corepack pnpm --config.verify-deps-before-run=false launch:final-smoke-execution-pack and corepack pnpm --config.verify-deps-before-run=false launch:staging-smoke-rehearsal-runner in plan mode. Only later, after exact approval, use STAGING_SMOKE_REHEARSAL_APPROVAL plus --execute-approved for the staging rehearsal against https://espanolhonesto-staging.alindev95.workers.dev.',
            readOnlyVerification: 'Open the generated runner summary and confirm status OK, closureStatus PLAN_ONLY_READY or EXECUTED_AND_NEEDS_REVIEW, externalWriteCommandStarted matches the approval state, Stripe live keys were rejected, and approval-gate.md names the exact staging host and forbidden scope.',
            evidenceToRecord: 'Record summary.md, staging-smoke-command-manifest.json, staging-smoke-execution-plan.md, approval-gate.md and rollback-after-staging-smoke.md paths without passwords, tokens, private customer payloads or secret values. After approved execution, record only the redacted smoke summary and cleanup status.',
            rollbackOrRisk: 'No rollback for plan mode. If an approved staging rehearsal later fails or creates smoke data, use rollback-after-staging-smoke.md and the final-smoke rollback plan to clean only the smoke-scoped Supabase, Stripe test, Google, Resend and Admin Jobs artifacts.',
            externalWriteGate: 'Requires exact STAGING_SMOKE_REHEARSAL_APPROVAL value and --execute-approved; allows only smoke-scoped writes on staging Supabase, Stripe test, Google, Resend and Admin Jobs, with no Cloudflare deploy/DNS/domain changes, no real payments, no admin/teacher password resets and no Supabase schema migration.',
        }];
    }

    return [{
        ...base,
        allowedNextStep: 'Open the source artifact, resolve the warning at the owning service or document a scoped accepted risk with owner, impact and fallback.',
        readOnlyVerification: 'Rerun the source evidence command and then corepack pnpm --config.verify-deps-before-run=false launch:integration-final-package.',
        evidenceToRecord: 'Record non-secret generated evidence plus owner/date/manual note in the manual evidence system.',
        rollbackOrRisk: 'Rollback depends on the owning service; accepted risk must include a concrete rollback or fallback.',
        externalWriteGate: 'Any external mutation still needs exact resource approval and read-only preflight.',
    }];
}

function renderWarningRemediationPlan(plan: WarningRemediation[]): string[] {
    if (plan.length === 0) return ['- No warning remediation is currently required by generated evidence.'];

    return plan.flatMap((item) => [
        `- ${item.sourceId}:${item.status}`,
        `  - Problem: ${item.problem}`,
        `  - Allowed next step: ${item.allowedNextStep}`,
        `  - Read-only verification: ${item.readOnlyVerification}`,
        `  - Evidence to record: ${item.evidenceToRecord}`,
        `  - Rollback or accepted risk: ${item.rollbackOrRisk}`,
        `  - External write gate: ${item.externalWriteGate}`,
    ]);
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

function cleanDetail(value: string): string {
    const compact = String(value).replace(/\s+/g, ' ').trim();
    return compact.length > 360 ? `${compact.slice(0, 357)}...` : compact;
}
