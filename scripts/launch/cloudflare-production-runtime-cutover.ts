import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

type CheckStatus = 'ok' | 'warning' | 'failed';

interface CutoverCheck {
    status: CheckStatus;
    name: string;
    message: string;
    details: string[];
}

interface CloudflareTarget {
    accountId: string;
    accountLabel: string;
    productionWorker: string;
    stagingWorker: string;
    pagesProject: string;
    customDomains: string[];
}

interface CutoverReport {
    schemaVersion: 1;
    startedAt: string;
    endedAt: string;
    status: 'OK' | 'WARNING' | 'FAILED';
    outputDir: string;
    target: CloudflareTarget;
    checks: CutoverCheck[];
    manifestPath: string;
    phaseOneApprovalPath: string;
    secretsApprovalPath: string;
    domainApprovalPath: string;
    verificationChecklistPath: string;
    rollbackPlanPath: string;
    manualEvidenceDryRunPath: string;
}

interface RenderedArtifacts {
    manifest: string;
    phaseOneApproval: string;
    secretsApproval: string;
    domainApproval: string;
    verificationChecklist: string;
    rollbackPlan: string;
    manualEvidenceDryRun: string;
    summary: string;
}

const target: CloudflareTarget = {
    accountId: 'd1a22bcf6477ff2ff31d2bfb83084e44',
    accountLabel: "Alindev95@gmail.com's Account",
    productionWorker: 'espanolhonesto',
    stagingWorker: 'espanolhonesto-staging',
    pagesProject: 'espanolhonesto',
    customDomains: ['espanolhonesto.com', 'www.espanolhonesto.com'],
};

const strictQaPreflightPath = path.join(
    'outputs',
    '019f1a5e-2745-7c43-870d-544e6ba4e0b1',
    'strict-qa-v2',
    'cloudflare-domain-worker-preflight.md',
);
const strictQaResultsPath = path.join(
    'outputs',
    '019f1a5e-2745-7c43-870d-544e6ba4e0b1',
    'strict-qa-v2',
    'strict-qa-results.json',
);
const cloudflareRuntimeReadonlyPath = latestGeneratedPath('launch-cloudflare-production-runtime-readonly', 'summary.md');
const cloudflareRuntimeCutoverPreflightPath = latestGeneratedPath('launch-cloudflare-production-runtime-cutover-preflight', 'summary.md');
const cloudflareRuntimeVariableMatrixPath = latestGeneratedPath('launch-cloudflare-production-runtime-cutover-preflight', 'cloudflare-production-worker-variable-matrix.md');

const modernParityRoutes = [
    '/',
    '/es',
    '/en',
    '/ru',
    '/es/espanol-para-vivir-en-espana',
    '/es/espanol-para-profesionales',
    '/es/clases-de-conversacion-en-espanol',
    '/robots.txt',
    '/sitemap-index.xml',
    '/sitemap-0.xml',
    '/llms.txt',
];

const webWorkerNames = [
    'PUBLIC_SUPABASE_URL',
    'PUBLIC_SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
    'PUBLIC_STRIPE_PUBLISHABLE_KEY',
    'STRIPE_SECRET_KEY',
    'STRIPE_WEBHOOK_SECRET',
    'PUBLIC_TURNSTILE_SITE_KEY',
    'TURNSTILE_SECRET_KEY',
    'PUBLIC_SENTRY_DSN',
    'SENTRY_AUTH_TOKEN',
    'PUBLIC_SITE_URL',
    'PUBLIC_APP_ENV',
    'FULFILLMENT_WORKER_URL',
    'INTERNAL_JOB_SECRET',
    'CRON_SECRET',
    'RESEND_API_KEY',
    'EMAIL_FROM',
    'RESEND_FROM_EMAIL',
    'SUPPORT_ALERT_EMAIL',
];

const fulfillmentWorkerNames = [
    'PUBLIC_APP_ENV',
    'INTERNAL_JOB_SECRET',
    'SUPABASE_SERVICE_ROLE_KEY',
    'PUBLIC_SUPABASE_URL',
    'RESEND_API_KEY',
    'EMAIL_FROM',
    'RESEND_FROM_EMAIL',
    'GOOGLE_SERVICE_ACCOUNT_EMAIL',
    'GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY',
    'GOOGLE_ADMIN_EMAIL',
    'GOOGLE_DRIVE_ROOT_FOLDER_ID',
    'GOOGLE_TEMPLATE_DOC_ID',
];

const startedAt = new Date();
const outputDir = path.join(process.cwd(), 'outputs', 'launch-cloudflare-production-runtime-cutover', stamp(startedAt));
mkdirSync(outputDir, { recursive: true });

const checks: CutoverCheck[] = [
    validateStrictQaPreflight(),
    validateLocalBuildParityEvidence(),
    validateCloudflareRuntimeReadonlyEvidence(),
    validateCloudflareRuntimeCutoverPreflightEvidence(),
    validateWranglerConfig(),
    validatePackageScripts(),
    validateDocsAndStatusWiring(),
];

let report = createReport(checks);
let rendered = renderArtifacts(report);
checks.push(validateGeneratedArtifactPosture(rendered));
report = createReport(checks);
rendered = renderArtifacts(report);

writeFileSync(report.manifestPath, rendered.manifest, 'utf8');
writeFileSync(report.phaseOneApprovalPath, rendered.phaseOneApproval, 'utf8');
writeFileSync(report.secretsApprovalPath, rendered.secretsApproval, 'utf8');
writeFileSync(report.domainApprovalPath, rendered.domainApproval, 'utf8');
writeFileSync(report.verificationChecklistPath, rendered.verificationChecklist, 'utf8');
writeFileSync(report.rollbackPlanPath, rendered.rollbackPlan, 'utf8');
writeFileSync(report.manualEvidenceDryRunPath, rendered.manualEvidenceDryRun, 'utf8');
writeFileSync(path.join(outputDir, 'summary.json'), JSON.stringify(report, null, 2), 'utf8');
writeFileSync(path.join(outputDir, 'summary.md'), rendered.summary, 'utf8');

const failed = report.checks.filter((check) => check.status === 'failed');
const warnings = report.checks.filter((check) => check.status === 'warning');

console.log(`[launch:cloudflare-production-runtime-cutover] Status: ${report.status}`);
console.log(`[launch:cloudflare-production-runtime-cutover] Failed: ${failed.length}`);
console.log(`[launch:cloudflare-production-runtime-cutover] Warnings: ${warnings.length}`);
console.log(`[launch:cloudflare-production-runtime-cutover] Summary: ${path.join(outputDir, 'summary.md')}`);
console.log(`[launch:cloudflare-production-runtime-cutover] Manifest: ${report.manifestPath}`);
console.log(`[launch:cloudflare-production-runtime-cutover] Phase 1 approval: ${report.phaseOneApprovalPath}`);
console.log(`[launch:cloudflare-production-runtime-cutover] Secrets approval: ${report.secretsApprovalPath}`);
console.log(`[launch:cloudflare-production-runtime-cutover] Domain approval: ${report.domainApprovalPath}`);
console.log(`[launch:cloudflare-production-runtime-cutover] Verification checklist: ${report.verificationChecklistPath}`);
console.log(`[launch:cloudflare-production-runtime-cutover] Rollback plan: ${report.rollbackPlanPath}`);

if (failed.length > 0) process.exit(1);

function createReport(reportChecks: CutoverCheck[]): CutoverReport {
    const reportStatus = statusFor(reportChecks);

    return {
        schemaVersion: 1,
        startedAt: startedAt.toISOString(),
        endedAt: new Date().toISOString(),
        status: reportStatus,
        outputDir,
        target,
        checks: reportChecks,
        manifestPath: path.join(outputDir, 'cloudflare-production-runtime-cutover-manifest.json'),
        phaseOneApprovalPath: path.join(outputDir, 'approval-request-phase-1-worker.md'),
        secretsApprovalPath: path.join(outputDir, 'approval-request-worker-secrets.md'),
        domainApprovalPath: path.join(outputDir, 'approval-request-domain-move.md'),
        verificationChecklistPath: path.join(outputDir, 'verification-checklist.md'),
        rollbackPlanPath: path.join(outputDir, 'rollback-plan.md'),
        manualEvidenceDryRunPath: path.join(outputDir, 'manual-evidence-dry-run.txt'),
    };
}

function validateStrictQaPreflight(): CutoverCheck {
    if (!existsSync(strictQaPreflightPath)) {
        return {
            status: 'failed',
            name: 'strict_qa_cloudflare_preflight_exists',
            message: 'The strict-QA Cloudflare domain/Worker preflight package is missing.',
            details: [`path=${strictQaPreflightPath}`],
        };
    }

    const preflight = readFileSync(strictQaPreflightPath, 'utf8');
    const required = [
        'production Worker `espanolhonesto` does not exist',
        'Pages project `espanolhonesto` exists and owns project domains',
        'Do not move `espanolhonesto.com` in the same step',
        'Approval Sentence For Phase 1 Only',
        'Approval Sentence For Domain Move Later',
        'CHECKOUT_ENABLED = "false"',
        'Token posture: broad write scopes are present',
    ];
    const missing = required.filter((snippet) => !preflight.includes(snippet));

    return {
        status: missing.length === 0 ? 'ok' : 'failed',
        name: 'strict_qa_cloudflare_preflight_exists',
        message: missing.length === 0
            ? 'Strict-QA preflight proves the current Cloudflare Pages-vs-Worker/domain posture and phased approvals.'
            : 'Strict-QA preflight is missing required domain/Worker safety facts.',
        details: missing.length === 0 ? [`path=${strictQaPreflightPath}`] : missing.map((snippet) => `missing=${snippet}`),
    };
}

function validateLocalBuildParityEvidence(): CutoverCheck {
    if (!existsSync(strictQaResultsPath)) {
        return {
            status: 'failed',
            name: 'local_build_parity_evidence_exists',
            message: 'The strict-QA tracker is missing, so the latest local build/preview parity proof cannot be verified.',
            details: [`path=${strictQaResultsPath}`],
        };
    }

    const results = readFileSync(strictQaResultsPath, 'utf8');
    const required = [
        'BASE-1074',
        'Local public SEO surface parity proof',
        'dist/client/llms.txt has',
        'dist/client/sitemap-0.xml includes all three segment URLs',
        'RETEST-285',
        'live-domain SEO blocker remains open by design',
        'BASE-1075',
        'Cloudflare Worker dry-run deploy proof',
        'wrangler deploy --env production --dry-run',
        'env.CHECKOUT_ENABLED (false)',
        'RETEST-286',
        'no external write occurred',
        'Test-Path dist returned False',
        ...modernParityRoutes,
    ];
    const missing = required.filter((snippet) => !results.includes(snippet));

    return {
        status: missing.length === 0 ? 'ok' : 'failed',
        name: 'local_build_parity_evidence_exists',
        message: missing.length === 0
            ? 'Strict-QA tracker proves the current local production build/preview serves the modern SEO surface and was cleaned up afterward.'
            : 'Strict-QA tracker is missing the latest local production build/preview parity evidence required before Cloudflare cutover approval.',
        details: missing.length === 0
            ? [`path=${strictQaResultsPath}`, 'localSeoBuild=BASE-1074/RETEST-285', 'wranglerDryRun=BASE-1075/RETEST-286', 'cleanup=dist_absent_after_build_and_dry_run']
            : missing.map((snippet) => `missing=${snippet}`),
    };
}

function validateCloudflareRuntimeReadonlyEvidence(): CutoverCheck {
    if (!cloudflareRuntimeReadonlyPath || !existsSync(cloudflareRuntimeReadonlyPath)) {
        return {
            status: 'warning',
            name: 'cloudflare_runtime_readonly_evidence_exists',
            message: 'Fresh Cloudflare production runtime read-only evidence is missing; run it before asking for any Cloudflare write approval.',
            details: ['run=corepack pnpm --config.verify-deps-before-run=false launch:cloudflare-production-runtime-readonly'],
        };
    }

    const evidence = readFileSync(cloudflareRuntimeReadonlyPath, 'utf8');
    const required = [
        'Cloudflare Production Runtime Read-Only Evidence',
        target.accountId,
        `Pages project: ${target.pagesProject}`,
        `production=${target.productionWorker}`,
        `staging=${target.stagingWorker}`,
        'pages_project_current_domain_owner',
        'production_worker_exists',
        'production_worker_secret_names',
        'This command uses Wrangler read/list/version commands only',
    ];
    const missing = required.filter((snippet) => !evidence.includes(snippet));

    return {
        status: missing.length === 0 ? 'ok' : 'failed',
        name: 'cloudflare_runtime_readonly_evidence_exists',
        message: missing.length === 0
            ? 'Fresh read-only Cloudflare evidence is available for the target account, Pages project, Workers and secret-name posture.'
            : 'Fresh read-only Cloudflare evidence is missing required target facts.',
        details: missing.length === 0
            ? [`path=${cloudflareRuntimeReadonlyPath}`]
            : missing.map((snippet) => `missing=${snippet}`),
    };
}

function validateCloudflareRuntimeCutoverPreflightEvidence(): CutoverCheck {
    if (!cloudflareRuntimeCutoverPreflightPath || !existsSync(cloudflareRuntimeCutoverPreflightPath)) {
        return {
            status: 'failed',
            name: 'cloudflare_runtime_cutover_preflight_exists',
            message: 'Fresh Cloudflare production runtime cutover preflight evidence is missing.',
            details: ['run=corepack pnpm --config.verify-deps-before-run=false launch:cloudflare-production-runtime-cutover-preflight'],
        };
    }

    const evidence = readFileSync(cloudflareRuntimeCutoverPreflightPath, 'utf8');
    const required = [
        'Cloudflare Production Runtime Preflight Refresh',
        'Remote write performed: false',
        `Target account: ${target.accountId}`,
        `Target Worker: ${target.productionWorker}`,
        'CHECKOUT_ENABLED=false in config: True',
        'Dry-run after build looked successful: True',
        'Dry-run mentions CHECKOUT_ENABLED=false: True',
        'Dry-run avoids custom domains: True',
        'dist removed after dry-run: True',
        'Variable matrix:',
        'wrangler_production_dry_run_passed',
        'command_scope_no_external_write',
    ];
    const missing = required.filter((snippet) => !evidence.includes(snippet));
    const matrixMissing = !cloudflareRuntimeVariableMatrixPath || !existsSync(cloudflareRuntimeVariableMatrixPath);

    return {
        status: missing.length === 0 && !matrixMissing ? 'ok' : 'failed',
        name: 'cloudflare_runtime_cutover_preflight_exists',
        message: missing.length === 0 && !matrixMissing
            ? 'Fresh cutover preflight proves local build, guarded Wrangler production dry-run, fail-closed checkout, custom-domain separation and cleanup posture.'
            : 'Fresh cutover preflight is missing required no-write build/dry-run evidence.',
        details: missing.length === 0 && !matrixMissing
            ? [
                `path=${cloudflareRuntimeCutoverPreflightPath}`,
                `variableMatrix=${cloudflareRuntimeVariableMatrixPath}`,
            ]
            : [
                ...missing.map((snippet) => `missing=${snippet}`),
                ...(matrixMissing ? ['missing=cloudflare-production-worker-variable-matrix.md'] : []),
            ],
    };
}

function validateWranglerConfig(): CutoverCheck {
    const wranglerPath = 'wrangler.toml';
    if (!existsSync(wranglerPath)) {
        return {
            status: 'failed',
            name: 'wrangler_production_worker_config',
            message: 'Root Wrangler config is missing.',
            details: [wranglerPath],
        };
    }

    const wrangler = readFileSync(wranglerPath, 'utf8');
    const checkoutFalseCount = [...wrangler.matchAll(/CHECKOUT_ENABLED\s*=\s*"false"/g)].length;
    const required = [
        'name = "espanolhonesto"',
        'keep_vars = true',
        '[env.staging]',
        'name = "espanolhonesto-staging"',
        '[env.production]',
        'name = "espanolhonesto"',
    ];
    const missing = required.filter((snippet) => !wrangler.includes(snippet));
    if (checkoutFalseCount < 3) missing.push('CHECKOUT_ENABLED = "false" in base, staging and production vars');

    return {
        status: missing.length === 0 ? 'ok' : 'failed',
        name: 'wrangler_production_worker_config',
        message: missing.length === 0
            ? 'Wrangler config names production and staging Workers separately and keeps checkout disabled by default.'
            : 'Wrangler config does not preserve the required production/staging Worker names or fail-closed checkout posture.',
        details: missing.length === 0 ? [`checkoutFalseCount=${checkoutFalseCount}`] : missing.map((snippet) => `missing=${snippet}`),
    };
}

function validatePackageScripts(): CutoverCheck {
    const packagePath = 'package.json';
    if (!existsSync(packagePath)) {
        return {
            status: 'failed',
            name: 'package_scripts_cloudflare_cutover',
            message: 'package.json is missing.',
            details: [packagePath],
        };
    }

    const packageJson = JSON.parse(readFileSync(packagePath, 'utf8')) as {
        packageManager?: string;
        scripts?: Record<string, string>;
    };
    const scripts = packageJson.scripts ?? {};
    const required: Array<[string, string]> = [
        ['build', 'tsx scripts/dev/staging.ts --build'],
        ['deploy', 'wrangler deploy --env staging'],
        ['deploy:production', 'wrangler deploy --env production'],
        ['launch:cloudflare-production-runtime-readonly', 'tsx scripts/launch/cloudflare-production-runtime-readonly.ts'],
        ['launch:cloudflare-production-runtime-cutover-preflight', 'tsx scripts/launch/cloudflare-production-runtime-cutover-preflight.ts'],
        ['launch:cloudflare-production-runtime-cutover', 'tsx scripts/launch/cloudflare-production-runtime-cutover.ts'],
        ['launch:cloudflare-production-worker-phase1', 'tsx scripts/launch/cloudflare-production-worker-phase1.ts'],
    ];
    const missing = required
        .filter(([name, value]) => scripts[name] !== value)
        .map(([name, value]) => `${name}=${value}`);

    if (packageJson.packageManager !== 'pnpm@10.33.0') {
        missing.push('packageManager=pnpm@10.33.0');
    }

    return {
        status: missing.length === 0 ? 'ok' : 'failed',
        name: 'package_scripts_cloudflare_cutover',
        message: missing.length === 0
            ? 'Package scripts expose the local-only Cloudflare production cutover pack and preserve pnpm/Wrangler commands.'
            : 'Package scripts are missing the Cloudflare production cutover command or package manager contract.',
        details: missing.length === 0 ? ['launch:cloudflare-production-runtime-cutover', 'launch:cloudflare-production-worker-phase1'] : missing.map((item) => `missing=${item}`),
    };
}

function validateDocsAndStatusWiring(): CutoverCheck {
    const files = [
        'scripts/launch/status.ts',
        'docs/launch/MANUAL_EVIDENCE_RUNBOOK.md',
        'tests/unit/operations-runbook.test.ts',
    ];
    const missingFiles = files.filter((file) => !existsSync(file));
    if (missingFiles.length > 0) {
        return {
            status: 'failed',
            name: 'docs_status_cutover_wiring',
            message: 'Required status/runbook/test files are missing.',
            details: missingFiles,
        };
    }

    const required: Array<[string, string]> = [
        ['scripts/launch/status.ts', 'launch-cloudflare-production-runtime-cutover'],
        ['scripts/launch/status.ts', 'approval-request-phase-1-worker.md'],
        ['docs/launch/MANUAL_EVIDENCE_RUNBOOK.md', 'pnpm launch:cloudflare-production-runtime-cutover-preflight'],
        ['docs/launch/MANUAL_EVIDENCE_RUNBOOK.md', 'cloudflare-production-worker-variable-matrix.md'],
        ['docs/launch/MANUAL_EVIDENCE_RUNBOOK.md', 'pnpm launch:cloudflare-production-runtime-cutover'],
        ['docs/launch/MANUAL_EVIDENCE_RUNBOOK.md', 'pnpm launch:cloudflare-production-worker-phase1'],
        ['docs/launch/MANUAL_EVIDENCE_RUNBOOK.md', 'cloudflare-production-runtime-cutover-manifest.json'],
        ['tests/unit/operations-runbook.test.ts', 'launch:cloudflare-production-runtime-cutover-preflight'],
        ['tests/unit/operations-runbook.test.ts', 'launch:cloudflare-production-runtime-cutover'],
        ['tests/unit/operations-runbook.test.ts', 'launch:cloudflare-production-worker-phase1'],
    ];
    const missing = required.filter(([file, snippet]) => !readFileSync(file, 'utf8').includes(snippet));

    return {
        status: missing.length === 0 ? 'ok' : 'failed',
        name: 'docs_status_cutover_wiring',
        message: missing.length === 0
            ? 'Status, manual evidence runbook and unit tests point to the generated Cloudflare cutover pack.'
            : 'Status, manual evidence runbook or tests do not yet point to the generated Cloudflare cutover pack.',
        details: missing.length === 0 ? required.map(([file]) => `checked=${file}`) : missing.map(([file, snippet]) => `missing=${file}::${snippet}`),
    };
}

function validateGeneratedArtifactPosture(renderedArtifacts: RenderedArtifacts): CutoverCheck {
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
        'does not write to Cloudflare',
        'does not deploy',
        'separate explicit approval',
        'CHECKOUT_ENABLED=false',
        'secret names only',
    ];
    const missing = requiredSafetyText.filter((snippet) => !combined.includes(snippet));

    return {
        status: offenders.length === 0 && missing.length === 0 ? 'ok' : 'failed',
        name: 'generated_artifact_secret_and_scope_posture',
        message: offenders.length === 0 && missing.length === 0
            ? 'Generated artifacts contain scope gates and no obvious secret values.'
            : 'Generated artifacts are missing safety text or appear to include secret-like values.',
        details: [
            ...offenders.map((pattern) => `secretPattern=${pattern}`),
            ...missing.map((snippet) => `missing=${snippet}`),
        ],
    };
}

function renderArtifacts(reportToRender: CutoverReport): RenderedArtifacts {
    const phaseOneApproval = renderPhaseOneApproval(reportToRender);
    const secretsApproval = renderSecretsApproval(reportToRender);
    const domainApproval = renderDomainApproval(reportToRender);
    const verificationChecklist = renderVerificationChecklist(reportToRender);
    const rollbackPlan = renderRollbackPlan(reportToRender);
    const manualEvidenceDryRun = renderManualEvidenceDryRun(reportToRender);
    const summary = renderSummary(reportToRender);

    const fileEntries = {
        phaseOneApproval: fileMeta(reportToRender.phaseOneApprovalPath, phaseOneApproval),
        secretsApproval: fileMeta(reportToRender.secretsApprovalPath, secretsApproval),
        domainApproval: fileMeta(reportToRender.domainApprovalPath, domainApproval),
        verificationChecklist: fileMeta(reportToRender.verificationChecklistPath, verificationChecklist),
        rollbackPlan: fileMeta(reportToRender.rollbackPlanPath, rollbackPlan),
        manualEvidenceDryRun: fileMeta(reportToRender.manualEvidenceDryRunPath, manualEvidenceDryRun),
        summary: fileMeta(path.join(reportToRender.outputDir, 'summary.md'), summary),
    };

    const manifest = `${JSON.stringify({
        schemaVersion: 1,
        generatedAt: reportToRender.endedAt,
        readyForApproval: reportToRender.status !== 'FAILED',
        status: reportToRender.status,
        target: reportToRender.target,
        sourceEvidence: {
            strictQaPreflight: strictQaPreflightPath,
            cloudflareRuntimeReadonly: cloudflareRuntimeReadonlyPath,
            cloudflareRuntimeCutoverPreflight: cloudflareRuntimeCutoverPreflightPath,
            cloudflareRuntimeVariableMatrix: cloudflareRuntimeVariableMatrixPath,
            strictQaResults: strictQaResultsPath,
            localPublicSeoBuildParity: 'BASE-1074/RETEST-285',
            wranglerProductionDryRun: 'BASE-1075/RETEST-286',
            commandizedWranglerProductionDryRun: 'launch:cloudflare-production-runtime-cutover-preflight',
            postBuildCleanup: 'dist absent after BASE-1074 and BASE-1075',
            wranglerConfig: 'wrangler.toml',
            packageJson: 'package.json',
            modernParityRoutes,
        },
        commandsVerifiedWithInstalledWranglerHelp: [
            'wrangler deploy --dry-run',
            'wrangler deploy --keep-vars',
            'wrangler secret list',
            'wrangler secret put <key>',
        ],
        phases: [
            {
                id: 'phase_1_worker_create_deploy',
                writesCloudflare: true,
                requiresSeparateApproval: true,
                targetResource: `Cloudflare Worker ${target.productionWorker}`,
                forbidden: ['custom domain move', 'DNS changes', 'Pages deletion', 'CHECKOUT_ENABLED=true', 'real payments'],
            },
            {
                id: 'phase_2_worker_secret_names',
                writesCloudflare: true,
                requiresSeparateApproval: true,
                targetResource: `Cloudflare Worker ${target.productionWorker} and fulfillment Worker production`,
                forbidden: ['printing secret values', 'domain move', 'key rotation outside final window'],
            },
            {
                id: 'phase_3_direct_worker_probe',
                writesCloudflare: false,
                requiresSeparateApproval: false,
                targetResource: `Direct workers.dev URL for ${target.productionWorker}`,
                forbidden: ['final smoke write paths', 'real payment session creation'],
            },
            {
                id: 'phase_4_domain_move',
                writesCloudflare: true,
                requiresSeparateApproval: true,
                targetResource: `${target.customDomains.join(', ')} from Pages ${target.pagesProject} to Worker ${target.productionWorker}`,
                forbidden: ['Pages deletion', 'DNS zone deletion', 'CHECKOUT_ENABLED=true', 'real payments'],
            },
        ],
        workerSecretNames: {
            astroWorker: webWorkerNames,
            fulfillmentWorker: fulfillmentWorkerNames,
            note: 'secret names only; values must come from the approved secure source and must never be written to repo outputs',
        },
        files: fileEntries,
        checks: reportToRender.checks,
    }, null, 2)}\n`;

    return {
        manifest,
        phaseOneApproval,
        secretsApproval,
        domainApproval,
        verificationChecklist,
        rollbackPlan,
        manualEvidenceDryRun,
        summary,
    };
}

function renderPhaseOneApproval(reportToRender: CutoverReport): string {
    return `${[
        '# Cloudflare Production Worker Phase 1 Approval Request',
        '',
        'This local file is not permission. It prepares the first Cloudflare external-write request for production runtime closure.',
        '',
        'This package does not write to Cloudflare, does not deploy, does not move domains and does not authorize secrets. It is an approval checklist only.',
        '',
        '## Exact Target',
        '',
        `- Account: ${reportToRender.target.accountLabel} (${reportToRender.target.accountId}).`,
        `- Worker to create/deploy: \`${reportToRender.target.productionWorker}\`.`,
        '- Source: current local build from this workspace.',
        '- Required state claim: `CHECKOUT_ENABLED=false`.',
        `- Existing custom domains remain on Pages project \`${reportToRender.target.pagesProject}\` in this phase.`,
        '',
        '## Required Read-Only Preflight',
        '',
        `- Run \`corepack pnpm --config.verify-deps-before-run=false launch:cloudflare-production-runtime-readonly\` and review \`${cloudflareRuntimeReadonlyPath ?? 'outputs/launch-cloudflare-production-runtime-readonly/<timestamp>/summary.md'}\`.`,
        `- Run \`corepack pnpm --config.verify-deps-before-run=false launch:cloudflare-production-runtime-cutover-preflight\` and review \`${cloudflareRuntimeCutoverPreflightPath ?? 'outputs/launch-cloudflare-production-runtime-cutover-preflight/<timestamp>/summary.md'}\`.`,
        `- Review \`${cloudflareRuntimeVariableMatrixPath ?? 'outputs/launch-cloudflare-production-runtime-cutover-preflight/<timestamp>/cloudflare-production-worker-variable-matrix.md'}\` before loading any secret or var name.`,
        `- Review \`${strictQaPreflightPath}\` and confirm the account/project/Worker names match this request.`,
        '- Confirm the current shell is logged into the intended Cloudflare account before any write.',
        '- Stop if the production Worker already exists with unknown code or ownership.',
        '- Stop if Wrangler tries to attach `espanolhonesto.com` or `www.espanolhonesto.com` in this phase.',
        '- Confirm `BASE-1074/RETEST-285` and `BASE-1075/RETEST-286` in the strict-QA tracker, or rerun the guarded local build/SEO and Wrangler dry-run proof, before approving deployment.',
        '',
        '## Commands After Approval',
        '',
        '```bash',
        'corepack pnpm --config.verify-deps-before-run=false build',
        'corepack pnpm --config.verify-deps-before-run=false exec wrangler deploy --env production --dry-run',
        'corepack pnpm --config.verify-deps-before-run=false exec wrangler deploy --env production --keep-vars',
        'corepack pnpm --config.verify-deps-before-run=false exec wrangler secret list --env production',
        '```',
        '',
        '## Exact Approval Sentence',
        '',
        'Apruebo crear/desplegar el Cloudflare Worker production `espanolhonesto` en la cuenta `d1a22bcf6477ff2ff31d2bfb83084e44` usando el build actual de `C:\\Users\\Alin\\Desktop\\Academia\\pruebas`, con `CHECKOUT_ENABLED=false`, sin adjuntar ni mover `espanolhonesto.com` ni `www.espanolhonesto.com`, sin activar pagos reales, sin borrar Pages y sin cambiar DNS. Despues, lista solo nombres de variables/secrets faltantes para cargarlos en una fase separada.',
        '',
        '## Forbidden Scope',
        '',
        '- No domain move, DNS change, Pages deletion, route change, zone change or custom-domain attachment.',
        '- No `CHECKOUT_ENABLED=true`, Stripe live mode, real checkout session or payment test.',
        '- No Supabase, Google, Resend, Sentry, Turnstile or GitHub writes.',
        '- No secret value printing or storage in outputs.',
        '',
    ].join('\n')}\n`;
}

function renderSecretsApproval(reportToRender: CutoverReport): string {
    return `${[
        '# Cloudflare Worker Secrets Approval Request',
        '',
        'This local file is not permission. It narrows the second Cloudflare write phase after the production Worker exists.',
        '',
        'This package does not write to Cloudflare, does not deploy and lists secret names only. Values must come from the approved secure source and must never be pasted into repo files, logs, screenshots or outputs.',
        '',
        '## Target Resources',
        '',
        `- Web Worker: \`${reportToRender.target.productionWorker}\` in account \`${reportToRender.target.accountId}\`.`,
        '- Fulfillment Worker production: `espanol-honesto-fulfillment-production` if production fulfillment is in scope for the same final window.',
        '',
        '## Web Worker Secret/Var Names',
        '',
        ...webWorkerNames.map((name) => `- \`${name}\``),
        '',
        '## Fulfillment Worker Secret/Var Names',
        '',
        ...fulfillmentWorkerNames.map((name) => `- \`${name}\``),
        '',
        '## Boundary Notes',
        '',
        '- Google service account keys belong on the fulfillment Worker, not the Astro web Worker, under the current architecture.',
        '- `INTERNAL_JOB_SECRET` must match between web Worker and fulfillment Worker for production, but the value must not be printed.',
        '- Keep `CHECKOUT_ENABLED=false` unless a separate payment-mode decision deliberately enables checkout.',
        '- `EMAIL_FROM` may be paired with `RESEND_FROM_EMAIL`; record names and posture only, not values.',
        '',
        '## Command Shape After Approval',
        '',
        '```bash',
        'corepack pnpm --config.verify-deps-before-run=false exec wrangler secret put SECRET_NAME --env production',
        'corepack pnpm --config.verify-deps-before-run=false exec wrangler secret list --env production',
        '```',
        '',
        '## Exact Approval Sentence',
        '',
        'Apruebo configurar/verificar solo por nombre los secrets/vars necesarios del Cloudflare Worker production `espanolhonesto` en la cuenta `d1a22bcf6477ff2ff31d2bfb83084e44`, y los del Fulfillment Worker production solo si forman parte de la misma ventana final, usando valores desde el origen seguro aprobado, sin imprimir valores, sin guardar valores en outputs, con `CHECKOUT_ENABLED=false`, sin mover dominios, sin borrar Pages, sin cambiar DNS y sin activar pagos reales.',
        '',
        '## Forbidden Scope',
        '',
        '- No domain move, DNS change, Pages deletion, Worker deletion or route change.',
        '- No key rotation unless it is the explicitly approved final rotation window.',
        '- No printing, logging, screenshotting or committing secret values.',
        '- No Stripe live mode, real checkout session, Supabase write, Google mutation or Resend send test.',
        '',
    ].join('\n')}\n`;
}

function renderDomainApproval(reportToRender: CutoverReport): string {
    return `${[
        '# Cloudflare Production Domain Move Approval Request',
        '',
        'This local file is not permission. It is only for the later domain phase after direct Worker verification passes.',
        '',
        'This package does not write to Cloudflare, does not deploy and does not authorize a domain move without separate explicit approval.',
        '',
        '## Required Before This Phase',
        '',
        `- Production Worker \`${reportToRender.target.productionWorker}\` exists in account \`${reportToRender.target.accountId}\`.`,
        '- Required production Worker secret names are present and verified without values.',
        '- Direct Worker URL probes pass non-destructively.',
        '- `CHECKOUT_ENABLED=false` is still active unless a separate payment posture has changed.',
        '- No active incident from the Worker creation or secret phase.',
        '',
        '## Exact Domains',
        '',
        ...reportToRender.target.customDomains.map((domain) => `- \`${domain}\``),
        '',
        '## Exact Approval Sentence',
        '',
        'Apruebo mover/adjuntar los dominios `espanolhonesto.com` y `www.espanolhonesto.com` desde Cloudflare Pages project `espanolhonesto` al Cloudflare Worker `espanolhonesto` en la cuenta `d1a22bcf6477ff2ff31d2bfb83084e44`, despues de confirmar que el Worker production tiene las variables/secrets necesarias y que `CHECKOUT_ENABLED=false` sigue activo. No apruebo borrar Pages, activar pagos reales, rotar claves ni tocar otros servicios.',
        '',
        '## Forbidden Scope',
        '',
        '- No Pages project deletion.',
        '- No DNS zone deletion or unrelated DNS changes.',
        '- No `CHECKOUT_ENABLED=true`, Stripe live mode or real payments.',
        '- No Supabase, Google, Resend, Sentry, Turnstile or GitHub writes.',
        '',
    ].join('\n')}\n`;
}

function renderVerificationChecklist(reportToRender: CutoverReport): string {
    return `${[
        '# Cloudflare Production Runtime Verification Checklist',
        '',
        'Use this after each approved phase. Record only non-secret evidence.',
        '',
        '## Phase 1: Worker Create/Deploy',
        '',
        '- Review the Wrangler dry-run output path and confirm it reports no custom domain attachment.',
        '- Confirm Worker name is `espanolhonesto` and account ID is `d1a22bcf6477ff2ff31d2bfb83084e44`.',
        '- Confirm `CHECKOUT_ENABLED=false` remains visible as a state claim.',
        '- Run `corepack pnpm --config.verify-deps-before-run=false exec wrangler secret list --env production` and record names only.',
        '',
        '## Phase 2: Secret Names',
        '',
        '- Confirm all required web Worker names are present or explicitly not needed with rationale.',
        '- Confirm fulfillment Worker production names separately; Google keys stay there under the current architecture.',
        '- Confirm no secret values appear in terminal history, repo files, screenshots or output artifacts.',
        '',
        '## Phase 3: Direct Worker URL',
        '',
        '- Probe public pages read-only from the direct Worker URL.',
        '- Probe these exact modern parity routes from the direct Worker URL:',
        ...modernParityRoutes.map((route) => `  - \`${route}\``),
        '- Do not create checkout sessions, emails, Google files/events or Supabase data during direct URL verification.',
        '',
        '## Phase 4: Domain Move',
        '',
        `- Confirm ${reportToRender.target.customDomains.join(' and ')} are no longer served by the old Pages project after the approved move.`,
        '- Confirm the same exact modern parity routes pass on `https://espanolhonesto.com` and, where applicable, `https://www.espanolhonesto.com`.',
        '- Rerun live-domain read-only, SEO, final-readiness, status and strict-QA tracker refresh.',
        '- Stop and roll back/reattach previous routing if custom domains serve blank, old, wrong-account or checkout-enabled output.',
        '',
        '## Expected Follow-Up Commands',
        '',
        '```bash',
        'corepack pnpm --config.verify-deps-before-run=false launch:live-domain-readonly',
        'corepack pnpm --config.verify-deps-before-run=false launch:final-readiness',
        'corepack pnpm --config.verify-deps-before-run=false launch:seo',
        'corepack pnpm --config.verify-deps-before-run=false launch:status',
        '```',
        '',
    ].join('\n')}\n`;
}

function renderRollbackPlan(reportToRender: CutoverReport): string {
    return `${[
        '# Cloudflare Production Runtime Rollback Plan',
        '',
        'This is a non-secret operational plan. It does not authorize writes by itself.',
        '',
        '## If Phase 1 Worker Deploy Fails',
        '',
        '- Stop before domain move.',
        '- Leave `espanolhonesto.com` and `www.espanolhonesto.com` on Pages.',
        '- Inspect Wrangler error output and fix local config/build before another approval.',
        '',
        '## If Secrets Are Missing Or Wrong',
        '',
        '- Keep domains on Pages.',
        '- Correct only the named secret/var in the approved Cloudflare Worker target.',
        '- Rerun secret list by name only and direct Worker read-only probes.',
        '',
        '## If Direct Worker URL Is Wrong',
        '',
        '- Do not move domains.',
        '- Keep checkout disabled.',
        '- Fix Worker/runtime config, rerun build/dry-run/direct probes and regenerate this pack.',
        '',
        '## If Domain Move Breaks Production',
        '',
        `- Reattach ${reportToRender.target.customDomains.join(' and ')} to the previous safe Cloudflare target or pause routing per dashboard rollback controls.`,
        `- Do not delete Pages project \`${reportToRender.target.pagesProject}\` during rollback.`,
        '- Keep `CHECKOUT_ENABLED=false` until final smoke and payment posture are clean.',
        '- Rerun live-domain read-only and status after rollback.',
        '',
    ].join('\n')}\n`;
}

function renderManualEvidenceDryRun(reportToRender: CutoverReport): string {
    const manifest = `../../${toPosix(path.relative(process.cwd(), reportToRender.manifestPath))}`;
    const phaseOne = `../../${toPosix(path.relative(process.cwd(), reportToRender.phaseOneApprovalPath))}`;
    const checklist = `../../${toPosix(path.relative(process.cwd(), reportToRender.verificationChecklistPath))}`;
    const preflight = cloudflareRuntimeCutoverPreflightPath
        ? `../../${toPosix(path.relative(process.cwd(), cloudflareRuntimeCutoverPreflightPath))}`
        : '../../outputs/launch-cloudflare-production-runtime-cutover-preflight/<timestamp>/summary.md';

    return `${[
        'corepack pnpm launch:manual-evidence:record --',
        '  --id integration_readiness',
        '  --status pass',
        '  --summary "Cloudflare production runtime/domain posture closed: production Worker exists, required secret names are present, direct Worker URL probes passed, and custom domains serve the modern Worker build after separate approval."',
        '  --environment "Cloudflare account d1a22bcf6477ff2ff31d2bfb83084e44; Worker espanolhonesto; domains espanolhonesto.com and www.espanolhonesto.com"',
        '  --owner Alin',
        `  --evidence "command_output=${preflight}::commandized no-write build/dry-run preflight reviewed"`,
        `  --evidence "command_output=${manifest}::generated cutover manifest reviewed"`,
        `  --evidence "command_output=${phaseOne}::phase approval scope reviewed"`,
        `  --evidence "command_output=${checklist}::post-phase verification checklist used"`,
        '  --evidence "manual_note=Replace with concrete non-secret result: phase 1 approved/executed; secret names verified; direct Worker URL passed; domain move separately approved/executed; live-domain/SEO/final readiness rerun."',
        '',
        '# Add --write only after replacing the placeholder note with real non-secret evidence.',
        '',
    ].join(' \\\n')}`;
}

function renderSummary(reportToRender: CutoverReport): string {
    const lines = [
        '# Cloudflare Production Runtime Cutover Summary',
        '',
        `- Status: ${reportToRender.status}`,
        `- Started: ${reportToRender.startedAt}`,
        `- Ended: ${reportToRender.endedAt}`,
        `- Manifest: ${toPosix(path.relative(process.cwd(), reportToRender.manifestPath))}`,
        `- Phase 1 approval: ${toPosix(path.relative(process.cwd(), reportToRender.phaseOneApprovalPath))}`,
        `- Secrets approval: ${toPosix(path.relative(process.cwd(), reportToRender.secretsApprovalPath))}`,
        `- Domain approval: ${toPosix(path.relative(process.cwd(), reportToRender.domainApprovalPath))}`,
        `- Verification checklist: ${toPosix(path.relative(process.cwd(), reportToRender.verificationChecklistPath))}`,
        `- Rollback plan: ${toPosix(path.relative(process.cwd(), reportToRender.rollbackPlanPath))}`,
        `- Cutover preflight: ${cloudflareRuntimeCutoverPreflightPath ? toPosix(path.relative(process.cwd(), cloudflareRuntimeCutoverPreflightPath)) : 'missing'}`,
        `- Variable matrix: ${cloudflareRuntimeVariableMatrixPath ? toPosix(path.relative(process.cwd(), cloudflareRuntimeVariableMatrixPath)) : 'missing'}`,
        '',
        'This is local-only. It does not write to Cloudflare, does not deploy and does not authorize a domain move. Every Cloudflare write still needs separate explicit approval naming the exact target.',
        '',
        '## Target',
        '',
        `- Account: ${reportToRender.target.accountLabel} (${reportToRender.target.accountId}).`,
        `- Production Worker: \`${reportToRender.target.productionWorker}\`.`,
        `- Current old production domain owner from preflight: Pages project \`${reportToRender.target.pagesProject}\`.`,
        `- Domains: ${reportToRender.target.customDomains.map((domain) => `\`${domain}\``).join(', ')}.`,
        '',
        '## Checks',
        '',
        '| Status | Check | Message | Details |',
        '| --- | --- | --- | --- |',
    ];

    for (const check of reportToRender.checks) {
        lines.push(`| ${check.status} | ${check.name} | ${escapeCell(check.message)} | ${escapeCell(check.details.join(' / '))} |`);
    }

    lines.push('');
    return `${lines.join('\n')}\n`;
}

function fileMeta(filePath: string, contents: string) {
    return {
        path: toPosix(path.relative(process.cwd(), filePath)),
        sha256: sha256(contents),
        bytes: Buffer.byteLength(contents, 'utf8'),
    };
}

function statusFor(checkList: CutoverCheck[]): CutoverReport['status'] {
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
