import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import * as dotenv from 'dotenv';
import {
    buildRuntimeAttestationConfig,
    RUNTIME_ATTESTATION_SCHEMA,
    verifyRuntimeAttestation,
    type RuntimeAttestationEnvelope,
} from '../../src/lib/runtime-attestation';

type CheckStatus = 'ok' | 'warning' | 'failed';
type ReportStatus = 'OK' | 'WARNING' | 'FAILED';
type PhaseOneClosureStatus = 'PLAN_ONLY_READY' | 'EXECUTED_AND_NEEDS_REVIEW' | 'BLOCKED_BY_GATE_OR_ARTIFACTS';

interface PhaseOneCheck {
    status: CheckStatus;
    name: string;
    message: string;
    details: string[];
}

interface CommandSpec {
    id: string;
    display: string;
    bin: string;
    args: string[];
    timeoutMs: number;
    writesCloudflare: boolean;
}

interface CommandCapture {
    id: string;
    display: string;
    path: string;
    exitCode: number | null;
    status: CheckStatus;
    writesCloudflare: boolean;
}

interface CloudflareTarget {
    accountId: string;
    accountLabel: string;
    productionWorker: string;
    pagesProject: string;
    customDomains: string[];
}

interface PhaseOneReport {
    schemaVersion: 1;
    startedAt: string;
    endedAt: string;
    status: ReportStatus;
    phaseOneClosureStatus: PhaseOneClosureStatus;
    outputDir: string;
    target: CloudflareTarget;
    approvalEnvVar: string;
    executeRequested: boolean;
    approvalMatched: boolean;
    externalWriteAttempted: boolean;
    externalWritePerformed: boolean;
    latestFulfillmentBootstrapSummaryPath: string | null;
    latestFulfillmentBootstrapSecretsSummaryPath: string | null;
    latestPreflightSummaryPath: string | null;
    latestVariableMatrixPath: string | null;
    latestCutoverManifestPath: string | null;
    latestPhaseOneApprovalPath: string | null;
    checks: PhaseOneCheck[];
    captures: CommandCapture[];
    commandManifestPath: string;
    executionPlanPath: string;
    approvalGatePath: string;
    rollbackAfterPhaseOnePath: string;
    manualEvidenceAfterPhaseOnePath: string;
    summaryPath: string;
}

interface RenderedArtifacts {
    commandManifest: string;
    executionPlan: string;
    approvalGate: string;
    rollbackAfterPhaseOne: string;
    manualEvidenceAfterPhaseOne: string;
    summary: string;
}

const target: CloudflareTarget = {
    accountId: 'd1a22bcf6477ff2ff31d2bfb83084e44',
    accountLabel: "Alindev95@gmail.com's Account",
    productionWorker: 'espanolhonesto',
    pagesProject: 'espanolhonesto',
    customDomains: ['espanolhonesto.com', 'www.espanolhonesto.com'],
};

const approvalEnvVar = 'CLOUDFLARE_PHASE1_APPROVAL';
const exactApprovalSentence = 'Apruebo crear/desplegar unicamente el bootstrap inerte del Cloudflare Worker web production `espanolhonesto` en la cuenta `d1a22bcf6477ff2ff31d2bfb83084e44` usando `production_bootstrap` y el build actual de `C:\\Users\\Alin\\Desktop\\Academia\\pruebas`, despues de verificar fulfillment inerte con exactamente `INTERNAL_JOB_SECRET` y providers ausentes, con todas las rutas de aplicacion bloqueadas en 503, `WEB_RUNTIME_MODE=bootstrap`, checkout y email desactivados, sin exigir datos legales finales ni Stripe Live, sin cargar secrets web, sin adjuntar ni mover `espanolhonesto.com` ni `www.espanolhonesto.com`, sin borrar Pages y sin cambiar DNS.';
const executeRequested = process.argv.includes('--execute-approved');
const approvalMatched = process.env[approvalEnvVar] === exactApprovalSentence;

const startedAt = new Date();
const outputDir = path.join(process.cwd(), 'outputs', 'launch-cloudflare-production-worker-phase1', stamp(startedAt));
mkdirSync(outputDir, { recursive: true });

const latestPreflightSummaryPath = latestGeneratedPath('launch-cloudflare-production-runtime-cutover-preflight', 'summary.md');
const latestVariableMatrixPath = latestGeneratedPath('launch-cloudflare-production-runtime-cutover-preflight', 'cloudflare-production-worker-variable-matrix.md');
const latestCutoverManifestPath = latestGeneratedPath('launch-cloudflare-production-runtime-cutover', 'cloudflare-production-runtime-cutover-manifest.json');
const latestPhaseOneApprovalPath = latestGeneratedPath('launch-cloudflare-production-runtime-cutover', 'approval-request-phase-1-worker.md');
const latestFulfillmentBootstrapSummaryPath = latestGeneratedPathMatching(
    'launch-cloudflare-production-fulfillment-bootstrap',
    'summary.md',
    ['- Status: OK', '- Execute requested: true', '- External write performed: true', '| ok | health_bootstrap |', '| ok | bootstrap_operational_block |'],
);
const latestFulfillmentBootstrapSecretsSummaryPath = latestGeneratedPathMatching(
    'launch-cloudflare-production-fulfillment-bootstrap-secrets',
    'summary.md',
    [
        '- Status: OK',
        '- Execute requested: true',
        '- External write performed: true',
        '| ok | minimal_bootstrap_secret_shape_after_write |',
        '| ok | direct_fulfillment_bootstrap_hmac_attestation |',
    ],
);
const fulfillmentWorker = 'espanol-honesto-fulfillment-production';
const fulfillmentDirectUrl = 'https://espanol-honesto-fulfillment-production.alindev95.workers.dev/';
const webDirectUrl = 'https://espanolhonesto.alindev95.workers.dev/';
const bootstrapAllowedWebSecretNames = new Set([
    'INTERNAL_JOB_SECRET',
]);
const forbiddenBootstrapWebSecretNames = new Set([
    'PUBLIC_SUPABASE_URL',
    'PUBLIC_SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
    'PUBLIC_STRIPE_PUBLISHABLE_KEY',
    'STRIPE_SECRET_KEY',
    'STRIPE_WEBHOOK_SECRET',
    'STRIPE_EXPECTED_ACCOUNT_ID',
    'STRIPE_PORTAL_CONFIGURATION_ID',
    'RESEND_API_KEY',
    'EMAIL_FROM',
    'RESEND_FROM_EMAIL',
    'EMAIL_RECIPIENT_ALLOWLIST',
    'PUBLIC_TURNSTILE_SITE_KEY',
    'TURNSTILE_SECRET_KEY',
    'CRON_SECRET',
    'LEVEL_CHECK_TOKEN_SECRET',
    'PUBLIC_SENTRY_DSN',
    'SENTRY_DSN',
    'SENTRY_AUTH_TOKEN',
]);
const fulfillmentBootstrapSecretNames = [
    'INTERNAL_JOB_SECRET',
] as const;
const withheldFulfillmentProviderSecretNames = [
    'PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY',
    'GOOGLE_SERVICE_ACCOUNT_EMAIL', 'GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY', 'GOOGLE_ADMIN_EMAIL',
    'GOOGLE_DRIVE_ROOT_FOLDER_ID', 'GOOGLE_TEMPLATE_DOC_ID',
    'RESEND_API_KEY', 'EMAIL_FROM', 'RESEND_FROM_EMAIL', 'CRON_SECRET',
] as const;

const commands = buildCommands();
const captures: CommandCapture[] = [];
let externalWriteAttempted = false;
const checks: PhaseOneCheck[] = [
    validatePackageScript(),
    validateFulfillmentBootstrapEvidence(),
    validateFulfillmentBootstrapSecretsEvidence(),
    validateBootstrapBuildSource(),
    validateFinalRouteSeparation(),
    validateWranglerConfig(),
    validateApprovalGateSource(),
    validateForbiddenScopeSource(),
];

if (executeRequested && checks.some((check) => check.status === 'failed')) {
    checks.push({
        status: 'failed',
        name: 'initial_validation_gate',
        message: 'Initial local validation failed, so no Cloudflare command can run.',
        details: ['externalWriteAttempted=false'],
    });
} else if (executeRequested && !approvalMatched) {
    checks.push({
        status: 'failed',
        name: 'exact_approval_gate',
        message: 'Execution was requested but the exact approval gate did not match, so no Cloudflare write can run.',
        details: [
            `env=${approvalEnvVar}`,
            'required=exact sentence in approval-gate.md',
            'externalWritePerformed=false',
        ],
    });
} else if (executeRequested && approvalMatched) {
    dotenv.config({ path: process.env.CLOUDFLARE_FULFILLMENT_ENV_FILE?.trim() || '.env.production', override: false, quiet: true });
    checks.push(...await runApprovedExecution(captures));
} else {
    checks.push({
        status: 'ok',
        name: 'plan_mode_no_external_write',
        message: 'Plan mode generated the phase-1 execution package without calling Cloudflare or running deploy.',
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
writeFileSync(report.rollbackAfterPhaseOnePath, rendered.rollbackAfterPhaseOne, 'utf8');
writeFileSync(report.manualEvidenceAfterPhaseOnePath, rendered.manualEvidenceAfterPhaseOne, 'utf8');
writeFileSync(path.join(outputDir, 'summary.json'), JSON.stringify(report, null, 2), 'utf8');
writeFileSync(report.summaryPath, rendered.summary, 'utf8');

const failed = report.checks.filter((check) => check.status === 'failed');
const warnings = report.checks.filter((check) => check.status === 'warning');

console.log(`[launch:cloudflare-production-worker-phase1] Status: ${report.status}`);
console.log(`[launch:cloudflare-production-worker-phase1] Closure: ${report.phaseOneClosureStatus}`);
console.log(`[launch:cloudflare-production-worker-phase1] Failed: ${failed.length}`);
console.log(`[launch:cloudflare-production-worker-phase1] Warnings: ${warnings.length}`);
console.log(`[launch:cloudflare-production-worker-phase1] External write performed: ${report.externalWritePerformed}`);
console.log(`[launch:cloudflare-production-worker-phase1] External write attempted: ${report.externalWriteAttempted}`);
console.log(`[launch:cloudflare-production-worker-phase1] Summary: ${report.summaryPath}`);
console.log(`[launch:cloudflare-production-worker-phase1] Execution plan: ${report.executionPlanPath}`);
console.log(`[launch:cloudflare-production-worker-phase1] Approval gate: ${report.approvalGatePath}`);
console.log(`[launch:cloudflare-production-worker-phase1] Rollback: ${report.rollbackAfterPhaseOnePath}`);

if (failed.length > 0) process.exit(1);

function createReport(reportChecks: PhaseOneCheck[], reportCaptures: CommandCapture[]): PhaseOneReport {
    const reportStatus = statusFor(reportChecks);
    const externalWritePerformed = reportCaptures.some((capture) => capture.writesCloudflare && capture.status === 'ok');

    return {
        schemaVersion: 1,
        startedAt: startedAt.toISOString(),
        endedAt: new Date().toISOString(),
        status: reportStatus,
        phaseOneClosureStatus: reportStatus === 'FAILED'
            ? 'BLOCKED_BY_GATE_OR_ARTIFACTS'
            : executeRequested
                ? 'EXECUTED_AND_NEEDS_REVIEW'
                : 'PLAN_ONLY_READY',
        outputDir,
        target,
        approvalEnvVar,
        executeRequested,
        approvalMatched,
        externalWriteAttempted,
        externalWritePerformed,
        latestFulfillmentBootstrapSummaryPath,
        latestFulfillmentBootstrapSecretsSummaryPath,
        latestPreflightSummaryPath,
        latestVariableMatrixPath,
        latestCutoverManifestPath,
        latestPhaseOneApprovalPath,
        checks: reportChecks,
        captures: reportCaptures,
        commandManifestPath: path.join(outputDir, 'phase1-command-manifest.json'),
        executionPlanPath: path.join(outputDir, 'phase1-execution-plan.md'),
        approvalGatePath: path.join(outputDir, 'approval-gate.md'),
        rollbackAfterPhaseOnePath: path.join(outputDir, 'rollback-after-phase1.md'),
        manualEvidenceAfterPhaseOnePath: path.join(outputDir, 'manual-evidence-after-phase1.txt'),
        summaryPath: path.join(outputDir, 'summary.md'),
    };
}

function validateFulfillmentBootstrapEvidence(): PhaseOneCheck {
    if (!latestFulfillmentBootstrapSummaryPath || !existsSync(latestFulfillmentBootstrapSummaryPath)) {
        return {
            status: 'failed',
            name: 'fulfillment_bootstrap_before_web',
            message: 'The inert production fulfillment bootstrap must be executed and verified before the web Worker.',
            details: ['run=pnpm launch:cloudflare-production-fulfillment-bootstrap -- --execute-approved'],
        };
    }

    const summary = readFileSync(latestFulfillmentBootstrapSummaryPath, 'utf8');
    const required = [
        '- Status: OK',
        '- Execute requested: true',
        '- External write attempted: true',
        '- External write performed: true',
        '| ok | health_bootstrap |',
        '| ok | bootstrap_operational_block |',
    ];
    const missing = required.filter((snippet) => !summary.includes(snippet));
    return {
        status: missing.length === 0 ? 'ok' : 'failed',
        name: 'fulfillment_bootstrap_before_web',
        message: missing.length === 0
            ? 'Latest evidence proves the exact production fulfillment Worker exists in inert bootstrap mode before web deploy.'
            : 'Fulfillment bootstrap evidence is incomplete; web deploy remains blocked.',
        details: missing.length === 0
            ? [`summary=${latestFulfillmentBootstrapSummaryPath}`]
            : missing.map((snippet) => `missing=${snippet}`),
    };
}

function validateFulfillmentBootstrapSecretsEvidence(): PhaseOneCheck {
    if (!latestFulfillmentBootstrapSecretsSummaryPath || !existsSync(latestFulfillmentBootstrapSecretsSummaryPath)) {
        return {
            status: 'failed',
            name: 'fulfillment_bootstrap_hmac_before_web',
            message: 'The HMAC-only fulfillment bootstrap must be loaded and re-attested before web deploy.',
            details: ['run=pnpm launch:cloudflare-production-fulfillment-bootstrap-secrets -- --execute-approved'],
        };
    }
    const summary = readFileSync(latestFulfillmentBootstrapSecretsSummaryPath, 'utf8');
    const required = [
        '- Status: OK', '- Execute requested: true', '- External write performed: true',
        '| ok | minimal_bootstrap_secret_shape_after_write |',
        '| ok | direct_fulfillment_bootstrap_hmac_attestation |',
        '| ok | fulfillment_bootstrap_no_cron |',
    ];
    const missing = required.filter((snippet) => !summary.includes(snippet));
    return {
        status: missing.length === 0 ? 'ok' : 'failed',
        name: 'fulfillment_bootstrap_hmac_before_web',
        message: missing.length === 0
            ? 'Latest local evidence proves fulfillment has only the shared HMAC secret and no active providers.'
            : 'Minimal fulfillment bootstrap secret evidence is incomplete; web deploy is blocked.',
        details: missing.length === 0
            ? [`summary=${latestFulfillmentBootstrapSecretsSummaryPath}`, 'activeProviders=absent']
            : missing.map((snippet) => `missing=${snippet}`),
    };
}

function validatePackageScript(): PhaseOneCheck {
    const packagePath = 'package.json';
    if (!existsSync(packagePath)) {
        return {
            status: 'failed',
            name: 'package_script_cloudflare_phase1',
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
    if (packageJson.scripts?.['launch:cloudflare-production-worker-phase1'] !== 'tsx scripts/launch/cloudflare-production-worker-phase1.ts') {
        missing.push('launch:cloudflare-production-worker-phase1=tsx scripts/launch/cloudflare-production-worker-phase1.ts');
    }
    if (packageJson.scripts?.['build:production:bootstrap'] !== 'tsx scripts/dev/build-production-bootstrap.ts') {
        missing.push('build:production:bootstrap=tsx scripts/dev/build-production-bootstrap.ts');
    }
    if (packageJson.scripts?.['launch:cloudflare-production-worker-bootstrap-secrets'] !== 'tsx scripts/launch/cloudflare-production-worker-bootstrap-secrets.ts') {
        missing.push('launch:cloudflare-production-worker-bootstrap-secrets=tsx scripts/launch/cloudflare-production-worker-bootstrap-secrets.ts');
    }
    if (packageJson.scripts?.['launch:cloudflare-production-fulfillment-bootstrap-secrets'] !== 'tsx scripts/launch/cloudflare-production-fulfillment-bootstrap-secrets.ts') {
        missing.push('launch:cloudflare-production-fulfillment-bootstrap-secrets=tsx scripts/launch/cloudflare-production-fulfillment-bootstrap-secrets.ts');
    }

    return {
        status: missing.length === 0 ? 'ok' : 'failed',
        name: 'package_script_cloudflare_phase1',
        message: missing.length === 0
            ? 'Package scripts expose distinct bootstrap build/deploy/minimal-secret runners and preserve pnpm policy.'
            : 'Package scripts are missing a bootstrap build/deploy/minimal-secret command or pnpm contract.',
        details: missing.length === 0
            ? ['build:production:bootstrap', 'launch:cloudflare-production-fulfillment-bootstrap-secrets', 'launch:cloudflare-production-worker-phase1', 'launch:cloudflare-production-worker-bootstrap-secrets']
            : missing.map((item) => `missing=${item}`),
    };
}

function validateBootstrapBuildSource(): PhaseOneCheck {
    const packageJson = readIfExists('package.json') ?? '';
    const buildSource = readIfExists(path.join('scripts', 'dev', 'build-production-bootstrap.ts')) ?? '';
    const astroConfig = readIfExists('astro.config.mjs') ?? '';
    const required = [
        ['package.json', packageJson, '"build:production:bootstrap": "tsx scripts/dev/build-production-bootstrap.ts"'],
        ['build-production-bootstrap.ts', buildSource, "process.env.CLOUDFLARE_ENV = 'production_bootstrap'"],
        ['build-production-bootstrap.ts', buildSource, "process.env.WEB_RUNTIME_MODE = 'bootstrap'"],
        ['build-production-bootstrap.ts', buildSource, "process.env.EMAIL_DELIVERY_MODE = 'disabled'"],
        ['build-production-bootstrap.ts', buildSource, "'STRIPE_SECRET_KEY'"],
        ['build-production-bootstrap.ts', buildSource, "delete process.env[key]"],
        ['build-production-bootstrap.ts', buildSource, 'installBootstrapEntry(generatedConfigPath)'],
        ['build-production-bootstrap.ts', buildSource, "const ALLOWED_PATHS = new Set(['/health', '/api/internal/runtime-attestation'])"],
        ['build-production-bootstrap.ts', buildSource, "config.main = wrapperName"],
        ['build-production-bootstrap.ts', buildSource, 'validateBootstrapBundle(distRoot, sourceCredentialValues)'],
        ['build-production-bootstrap.ts', buildSource, 'assets.run_worker_first=true'],
        ['astro.config.mjs', astroConfig, 'legalIdentityIsExample && !productionBootstrap'],
    ] as const;
    const missing = required
        .filter(([, source, snippet]) => !source.includes(snippet))
        .map(([file, , snippet]) => `${file}:${snippet}`);

    return {
        status: missing.length === 0 ? 'ok' : 'failed',
        name: 'bootstrap_build_source',
        message: missing.length === 0
            ? 'The dedicated production bootstrap build selects production_bootstrap, strips active-provider credentials and bypasses only the final legal-identity gate while inert.'
            : 'The dedicated bootstrap build is missing required inert-mode or legal/Stripe separation safeguards.',
        details: missing.length === 0
            ? ['build=pnpm run build:production:bootstrap', 'legalFinalRequiredForActive=true', 'stripeLiveRequiredForActive=true']
            : missing.map((item) => `missing=${item}`),
    };
}

function validateFinalRouteSeparation(): PhaseOneCheck {
    const packageJson = readIfExists('package.json') ?? '';
    const finalRunner = readIfExists(path.join('scripts', 'launch', 'cloudflare-production-worker-secrets.ts')) ?? '';
    const required = [
        '"launch:cloudflare-production-worker-bootstrap-secrets": "tsx scripts/launch/cloudflare-production-worker-bootstrap-secrets.ts"',
        '"launch:cloudflare-production-worker-secrets": "tsx scripts/launch/cloudflare-production-worker-secrets.ts"',
    ];
    const missing = required.filter((snippet) => !packageJson.includes(snippet));
    if (!finalRunner.includes('fresh_stripe_live_readiness_pre_write_gate')) {
        missing.push('final worker secrets runner keeps Stripe Live gate');
    }

    return {
        status: missing.length === 0 ? 'ok' : 'failed',
        name: 'bootstrap_and_final_routes_separate',
        message: missing.length === 0
            ? 'Bootstrap secret loading and final active/live secret loading are separate commands and approval surfaces.'
            : 'Bootstrap and final active/live secret routes are not yet fully separated.',
        details: missing.length === 0
            ? ['bootstrap=INTERNAL_JOB_SECRET only for HMAC', 'final=Supabase runtime + legal/Stripe Live still required']
            : missing.map((item) => `missing=${item}`),
    };
}

function validateWranglerConfig(): PhaseOneCheck {
    const wranglerPath = 'wrangler.toml';
    if (!existsSync(wranglerPath)) {
        return {
            status: 'failed',
            name: 'wrangler_phase1_config',
            message: 'wrangler.toml is missing.',
            details: [wranglerPath],
        };
    }

    const wrangler = readFileSync(wranglerPath, 'utf8');
    const bootstrapStart = wrangler.indexOf('[env.production_bootstrap]');
    const activeStart = wrangler.indexOf('[env.production]');
    const bootstrap = bootstrapStart >= 0 && activeStart > bootstrapStart
        ? wrangler.slice(bootstrapStart, activeStart)
        : '';
    const required = [
        'name = "espanolhonesto-env-required"',
        'keep_vars = true',
        '[env.production_bootstrap]',
        '[env.production]',
        '[env.staging]',
        'name = "espanolhonesto-staging"',
    ];
    const missing = required.filter((snippet) => !wrangler.includes(snippet));
    for (const snippet of [
        'name = "espanolhonesto"',
        'WEB_RUNTIME_MODE = "bootstrap"',
        'CHECKOUT_ENABLED = "false"',
        'CHECKOUT_ENABLED_OVERRIDE = "false"',
        'EMAIL_DELIVERY_MODE = "disabled"',
        'EMAIL_DAILY_RECIPIENT_LIMIT = "0"',
        'EMAIL_MONTHLY_RECIPIENT_LIMIT = "0"',
        'service = "espanol-honesto-fulfillment-production"',
        '[env.production_bootstrap.assets]',
        'run_worker_first = true',
    ]) {
        if (!bootstrap.includes(snippet)) missing.push(`production_bootstrap:${snippet}`);
    }

    return {
        status: missing.length === 0 ? 'ok' : 'failed',
        name: 'wrangler_phase1_config',
        message: missing.length === 0
            ? 'Wrangler config has an exact-name production_bootstrap environment with inert web, checkout, email and fulfillment binding posture.'
            : 'Wrangler config is missing the required production_bootstrap safety posture.',
        details: missing.length === 0 ? ['environment=production_bootstrap', 'runtime=bootstrap', 'checkout=false', 'email=disabled'] : missing.map((snippet) => `missing=${snippet}`),
    };
}

function validateApprovalGateSource(): PhaseOneCheck {
    const sourcePath = path.join('scripts', 'launch', 'cloudflare-production-worker-phase1.ts');
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
        '--execute-approved',
        'const exactApprovalSentence =',
        'executeRequested && !approvalMatched',
        'externalWritePerformed=false',
        'corepack pnpm --config.verify-deps-before-run=false run build:production:bootstrap',
        'corepack pnpm --config.verify-deps-before-run=false exec wrangler deploy --config dist/server/wrangler.json --dry-run',
        'corepack pnpm --config.verify-deps-before-run=false exec wrangler deploy --config dist/server/wrangler.json --keep-vars',
        'corepack pnpm --config.verify-deps-before-run=false exec wrangler deployments list --name espanolhonesto --json',
        'corepack pnpm --config.verify-deps-before-run=false exec wrangler secret list --name espanolhonesto --format json',
    ];
    const missing = required.filter((snippet) => !source.includes(snippet));

    return {
        status: missing.length === 0 ? 'ok' : 'failed',
        name: 'approval_gate_source',
        message: missing.length === 0
            ? 'Runner source contains the exact approval gate and commandized phase-1 execution/verification commands.'
            : 'Runner source is missing required approval gate or commandized execution facts.',
        details: missing.length === 0 ? [sourcePath] : missing.map((snippet) => `missing=${snippet}`),
    };
}

function validateForbiddenScopeSource(): PhaseOneCheck {
    const sourcePath = path.join('scripts', 'launch', 'cloudflare-production-worker-phase1.ts');
    const source = readIfExists(sourcePath) ?? '';
    const required = [
        'No domain move',
        'No DNS change',
        'No Pages deletion',
        'No route change',
        'No custom-domain attachment',
        'No `CHECKOUT_ENABLED=true`',
        'No secret value printing',
        'No Stripe live mode',
        'No final legal identity requirement',
        'No Supabase, Google, Resend, Sentry, Turnstile or GitHub writes',
    ];
    const missing = required.filter((snippet) => !source.includes(snippet));
    const forbiddenCommandSnippets = [
        'wrangler pages project delete',
        'wrangler route delete',
        'wrangler dns',
        'wrangler secret put',
        'CHECKOUT_ENABLED=true',
    ];
    const commandText = Object.values(commands).map((command) => command.display).join('\n');
    const presentForbidden = forbiddenCommandSnippets.filter((snippet) => commandText.includes(snippet));

    return {
        status: missing.length === 0 && presentForbidden.length === 0 ? 'ok' : 'failed',
        name: 'forbidden_scope_source',
        message: missing.length === 0 && presentForbidden.length === 0
            ? 'Runner source keeps phase 1 limited to Worker deploy plus read-only verification, with explicit forbidden scope.'
            : 'Runner source is missing forbidden-scope wording or contains a forbidden command snippet.',
        details: [
            ...missing.map((snippet) => `missing=${snippet}`),
            ...presentForbidden.map((snippet) => `forbidden=${snippet}`),
        ],
    };
}

async function runApprovedExecution(reportCaptures: CommandCapture[]): Promise<PhaseOneCheck[]> {
    const executionChecks: PhaseOneCheck[] = [];

    executionChecks.push({
        status: 'ok',
        name: 'exact_approval_gate',
        message: 'Exact approval sentence matched; running only the phase-1 command sequence.',
        details: [
            `env=${approvalEnvVar}`,
            `targetAccount=${target.accountId}`,
            `targetWorker=${target.productionWorker}`,
        ],
    });

    const readonlyCapture = runCommand(commands.readonly);
    reportCaptures.push(readonlyCapture);
    executionChecks.push(checkForCapture(readonlyCapture));
    if (readonlyCapture.status === 'failed') return executionChecks;

    const remoteWebShape = validateFreshReadonlyWebShapeBeforeDeploy();
    executionChecks.push(remoteWebShape);
    if (remoteWebShape.status === 'failed') return executionChecks;

    const buildCapture = runCommand(commands.build);
    reportCaptures.push(buildCapture);
    executionChecks.push(checkForCapture(buildCapture));
    if (buildCapture.status === 'failed') return executionChecks;

    const builtConfigCheck = validateBuiltBootstrapConfig();
    executionChecks.push(builtConfigCheck);
    if (builtConfigCheck.status === 'failed') return executionChecks;

    const dryRunCapture = runCommand(commands.deployDryRun);
    reportCaptures.push(dryRunCapture);
    executionChecks.push(checkForCapture(dryRunCapture));
    if (dryRunCapture.status === 'failed') return executionChecks;

    const dryRunOutput = readFileSync(dryRunCapture.path, 'utf8');
    const dryRunIsSafe = [
        'WEB_RUNTIME_MODE', 'bootstrap',
        'CHECKOUT_ENABLED', 'CHECKOUT_ENABLED_OVERRIDE', 'false',
        'EMAIL_DELIVERY_MODE', 'disabled',
        'EMAIL_DAILY_RECIPIENT_LIMIT', 'EMAIL_MONTHLY_RECIPIENT_LIMIT', '0',
    ].every((snippet) => dryRunOutput.includes(snippet)) &&
        !target.customDomains.some((domain) => dryRunOutput.includes(domain));

    executionChecks.push({
        status: dryRunIsSafe ? 'ok' : 'failed',
        name: 'phase1_dry_run_guard_before_write',
        message: dryRunIsSafe
            ? 'Immediate dry-run proves production_bootstrap, web/checkout/email inertness and no custom-domain attachment before the approved deploy.'
            : 'Immediate dry-run does not prove production_bootstrap inertness and no-domain-attachment posture; deploy command was not run.',
        details: dryRunIsSafe
            ? [`capture=${dryRunCapture?.path ?? 'missing'}`]
            : [
                `capture=${dryRunCapture?.path ?? 'missing'}`,
                'required=WEB_RUNTIME_MODE bootstrap, checkout false, email disabled/zero and no espanolhonesto.com/www mention',
            ],
    });

    if (!dryRunIsSafe) return executionChecks;

    const fulfillmentVersionCapture = runCommand(commands.fulfillmentDeploymentsList);
    reportCaptures.push(fulfillmentVersionCapture);
    executionChecks.push(checkForCapture(fulfillmentVersionCapture));
    if (fulfillmentVersionCapture.status === 'failed') return executionChecks;
    const fulfillmentVersionId = deploymentVersionId(fulfillmentVersionCapture);
    if (!fulfillmentVersionId) {
        executionChecks.push({
            status: 'failed',
            name: 'fresh_fulfillment_bootstrap_version_before_web',
            message: 'Fresh fulfillment bootstrap version could not be read immediately before web deploy.',
            details: ['externalWriteAttempted=false'],
        });
        return executionChecks;
    }
    const freshBootstrapChecks = await verifyFreshFulfillmentBootstrap(fulfillmentVersionId);
    executionChecks.push(...freshBootstrapChecks);
    if (freshBootstrapChecks.some((check) => check.status === 'failed')) return executionChecks;

    for (const command of [commands.deployKeepVars, commands.deploymentsList, commands.secretList]) {
        const capture = runCommand(command);
        reportCaptures.push(capture);
        executionChecks.push(checkForCapture(capture));
        if (capture.status === 'failed') return executionChecks;
    }

    const deploymentCapture = reportCaptures.find((capture) => capture.id === commands.deploymentsList.id);
    const secretCapture = reportCaptures.find((capture) => capture.id === commands.secretList.id);
    const webVersionId = deploymentCapture ? deploymentVersionId(deploymentCapture) : null;
    if (!webVersionId || !secretCapture) {
        executionChecks.push({
            status: 'failed',
            name: 'web_bootstrap_version_and_secret_shape',
            message: 'Post-deploy web version or secret-name evidence is missing.',
            details: [`versionPresent=${String(Boolean(webVersionId))}`, `secretCapturePresent=${String(Boolean(secretCapture))}`],
        });
        return executionChecks;
    }

    executionChecks.push(validateBootstrapSecretShape(secretCapture));
    if (executionChecks.at(-1)?.status === 'failed') return executionChecks;
    executionChecks.push(...await verifyWebBootstrapAfterDeploy(webVersionId));

    return executionChecks;
}

function validateFreshReadonlyWebShapeBeforeDeploy(): PhaseOneCheck {
    const summaryPath = latestGeneratedPath('launch-cloudflare-production-runtime-readonly', 'summary.md');
    const deploymentsPath = latestGeneratedPath('launch-cloudflare-production-runtime-readonly', 'production_worker_deployments.txt');
    const secretsPath = latestGeneratedPath('launch-cloudflare-production-runtime-readonly', 'production_worker_secrets.txt');
    const summary = summaryPath ? readIfExists(summaryPath) ?? '' : '';
    const deployments = deploymentsPath ? readIfExists(deploymentsPath) ?? '' : '';
    const secrets = secretsPath ? readIfExists(secretsPath) ?? '' : '';
    const accountMatched = summary.includes(target.accountId);
    const workerAbsent = deployments.includes('This Worker does not exist on your account. [code: 10007]')
        && secrets.includes(`Worker "${target.productionWorker}" not found.`);

    if (accountMatched && workerAbsent) {
        return {
            status: 'ok',
            name: 'fresh_remote_web_shape_before_deploy',
            message: 'Fresh read-only evidence proves the exact production web Worker does not exist yet, so no remote secret/route state can be inherited.',
            details: [`summary=${summaryPath}`, 'workerAbsent=true', 'remoteSecrets=none'],
        };
    }

    const secretShape = extractSecretNames(secrets);
    const forbidden = [...secretShape.names].filter((name) => forbiddenBootstrapWebSecretNames.has(name));
    const unexpected = [...secretShape.names].filter((name) => !bootstrapAllowedWebSecretNames.has(name));
    const currentVersionId = /"version_id"\s*:\s*"([0-9a-f]{8}-[0-9a-f-]{27})"/iu.exec(deployments)?.[1] ?? null;
    const priorExecutedSummaryPath = latestGeneratedPathMatching(
        'launch-cloudflare-production-worker-phase1',
        'summary.md',
        ['- Status: OK', '- Execute requested: true', '| ok | web_bootstrap_health_after_deploy |'],
    );
    const priorExecutedSummary = priorExecutedSummaryPath ? readIfExists(priorExecutedSummaryPath) ?? '' : '';
    const knownBootstrap = priorExecutedSummary.includes('- Status: OK')
        && priorExecutedSummary.includes('- Execute requested: true')
        && priorExecutedSummary.includes('| ok | web_bootstrap_health_after_deploy |')
        && Boolean(currentVersionId && priorExecutedSummary.includes(`deploymentVersion=${currentVersionId}`));
    const safeExisting = accountMatched
        && secretShape.parsed
        && forbidden.length === 0
        && unexpected.length === 0
        && knownBootstrap;

    return {
        status: safeExisting ? 'ok' : 'failed',
        name: 'fresh_remote_web_shape_before_deploy',
        message: safeExisting
            ? 'Existing Worker is traceable to a previously attested bootstrap and still has only minimal/empty secret names.'
            : 'Existing or ambiguous Worker state is not proven safe before deploy; no Cloudflare write may start.',
        details: [
            `accountMatched=${String(accountMatched)}`,
            `workerAbsent=${String(workerAbsent)}`,
            `secretListParsed=${String(secretShape.parsed)}`,
            `forbidden=${forbidden.join(',') || 'none'}`,
            `unexpected=${unexpected.join(',') || 'none'}`,
            `currentVersionId=${currentVersionId ?? 'missing'}`,
            `knownBootstrap=${String(knownBootstrap)}`,
        ],
    };
}

function validateBuiltBootstrapConfig(): PhaseOneCheck {
    const configPath = path.join('dist', 'server', 'wrangler.json');
    if (!existsSync(configPath)) {
        return {
            status: 'failed',
            name: 'built_bootstrap_config',
            message: 'The bootstrap build did not produce dist/server/wrangler.json.',
            details: [`missing=${configPath}`],
        };
    }

    try {
        const config = JSON.parse(readFileSync(configPath, 'utf8')) as {
            name?: unknown;
            main?: unknown;
            targetEnvironment?: unknown;
            vars?: Record<string, unknown>;
            assets?: { run_worker_first?: unknown };
            services?: Array<{ binding?: unknown; service?: unknown }>;
            routes?: unknown[];
            triggers?: { crons?: unknown[] };
        };
        const vars = config.vars ?? {};
        const serviceBound = config.services?.some((binding) =>
            binding.binding === 'FULFILLMENT_SERVICE'
            && binding.service === fulfillmentWorker,
        ) === true;
        const expected: Array<[string, unknown, unknown]> = [
            ['name', config.name, target.productionWorker],
            ['main', config.main, 'bootstrap-entry.mjs'],
            ['targetEnvironment', config.targetEnvironment, 'production_bootstrap'],
            ['PUBLIC_APP_ENV', vars.PUBLIC_APP_ENV, 'production'],
            ['WEB_RUNTIME_MODE', vars.WEB_RUNTIME_MODE, 'bootstrap'],
            ['SUPABASE_EXPECTED_PROJECT_REF', vars.SUPABASE_EXPECTED_PROJECT_REF, 'vkkahxsybhbutszerawz'],
            ['WORKER_IDENTITY', vars.WORKER_IDENTITY, target.productionWorker],
            ['CHECKOUT_ENABLED', vars.CHECKOUT_ENABLED, 'false'],
            ['CHECKOUT_ENABLED_OVERRIDE', vars.CHECKOUT_ENABLED_OVERRIDE, 'false'],
            ['EMAIL_DELIVERY_MODE', vars.EMAIL_DELIVERY_MODE, 'disabled'],
            ['EMAIL_DAILY_RECIPIENT_LIMIT', vars.EMAIL_DAILY_RECIPIENT_LIMIT, '0'],
            ['EMAIL_MONTHLY_RECIPIENT_LIMIT', vars.EMAIL_MONTHLY_RECIPIENT_LIMIT, '0'],
        ];
        const mismatches = expected
            .filter(([, actual, wanted]) => actual !== wanted)
            .map(([name, actual, wanted]) => `${name}=${String(actual ?? 'missing')} expected=${String(wanted)}`);
        if (!serviceBound) mismatches.push(`FULFILLMENT_SERVICE=${fulfillmentWorker}`);
        if (config.assets?.run_worker_first !== true) mismatches.push('assets.run_worker_first=true');
        if ((config.routes?.length ?? 0) > 0) mismatches.push('routes must be absent/empty');
        if ((config.triggers?.crons?.length ?? 0) > 0) mismatches.push('crons must be absent/empty');
        const serialized = JSON.stringify(config);
        for (const name of forbiddenBootstrapWebSecretNames) {
            if (serialized.includes(`"${name}"`)) mismatches.push(`forbiddenBinding=${name}`);
        }

        return {
            status: mismatches.length === 0 ? 'ok' : 'failed',
            name: 'built_bootstrap_config',
            message: mismatches.length === 0
                ? 'The generated deploy config is bound to production_bootstrap and contains only inert web/email/checkout posture with no routes or active-provider bindings.'
                : 'The generated deploy config is not the exact inert production_bootstrap package.',
            details: mismatches.length === 0 ? [`config=${configPath}`, 'activeProviderBindings=absent'] : mismatches,
        };
    } catch (error) {
        return {
            status: 'failed',
            name: 'built_bootstrap_config',
            message: 'The generated bootstrap Wrangler config could not be parsed.',
            details: [sanitizeError(error instanceof Error ? error : new Error(String(error)))],
        };
    }
}

function validateBootstrapSecretShape(capture: CommandCapture): PhaseOneCheck {
    const captureText = readIfExists(capture.path) ?? '';
    const parsed = extractSecretNames(captureText);
    const forbidden = [...parsed.names].filter((name) => forbiddenBootstrapWebSecretNames.has(name));
    const unexpected = [...parsed.names].filter((name) => !bootstrapAllowedWebSecretNames.has(name));
    const safe = parsed.parsed && forbidden.length === 0 && unexpected.length === 0;
    return {
        status: safe ? 'ok' : 'failed',
        name: 'web_bootstrap_secret_shape_after_deploy',
        message: safe
            ? 'Remote secret-name evidence contains no active-provider or non-minimal bootstrap names.'
            : 'Remote secret-name evidence is unparseable or contains secrets outside the minimal bootstrap allowlist.',
        details: [
            `parsed=${String(parsed.parsed)}`,
            `secretCount=${parsed.names.size}`,
            `forbidden=${forbidden.join(',') || 'none'}`,
            `unexpected=${unexpected.join(',') || 'none'}`,
        ],
    };
}

function extractSecretNames(captureText: string): { names: Set<string>; parsed: boolean } {
    const names = new Set<string>();
    const jsonMatch = captureText.match(/\[\s*\{[\s\S]*?\}\s*\]/u) ?? captureText.match(/\[\s*\]/u);
    if (!jsonMatch) return { names, parsed: false };
    try {
        const parsed = JSON.parse(jsonMatch[0]) as Array<{ name?: unknown }>;
        if (!Array.isArray(parsed)) return { names, parsed: false };
        for (const item of parsed) {
            if (typeof item?.name === 'string' && item.name) names.add(item.name);
        }
        return { names, parsed: true };
    } catch {
        return { names, parsed: false };
    }
}

async function verifyWebBootstrapAfterDeploy(expectedVersionId: string): Promise<PhaseOneCheck[]> {
    const results: PhaseOneCheck[] = [];
    try {
        const healthResponse = await fetch(new URL('/health', webDirectUrl), {
            redirect: 'manual',
            signal: AbortSignal.timeout(20_000),
        });
        const health = await healthResponse.json() as {
            appEnvironment?: unknown;
            runtimeMode?: unknown;
            status?: unknown;
            workerIdentity?: unknown;
            checkoutEnabled?: unknown;
        };
        const healthy = healthResponse.status === 200
            && health.appEnvironment === 'production'
            && health.runtimeMode === 'bootstrap'
            && health.status === 'ok'
            && health.workerIdentity === target.productionWorker
            && health.checkoutEnabled === false;
        results.push({
            status: healthy ? 'ok' : 'failed',
            name: 'web_bootstrap_health_after_deploy',
            message: healthy
                ? 'Direct workers.dev health proves the newly deployed web Worker is the inert production bootstrap.'
                : 'Direct workers.dev health did not prove the exact inert production bootstrap.',
            details: [
                `httpStatus=${healthResponse.status}`,
                `runtimeMode=${String(health.runtimeMode ?? 'missing')}`,
                `workerIdentity=${String(health.workerIdentity ?? 'missing')}`,
                `deploymentVersion=${expectedVersionId}`,
            ],
        });

        const routeSpecs: Array<{ path: string; method: 'GET' | 'POST' }> = [
            { path: '/', method: 'GET' },
            { path: '/es', method: 'GET' },
            { path: '/es/campus', method: 'GET' },
            { path: '/robots.txt', method: 'GET' },
            { path: '/vite.svg', method: 'GET' },
            { path: '/favicon.png', method: 'GET' },
            { path: '/sitemap-index.xml', method: 'GET' },
            { path: bootstrapAssetProbePath(), method: 'GET' },
            { path: '/api/checkout', method: 'POST' },
        ];
        for (const route of routeSpecs) {
            const response = await fetch(new URL(route.path, webDirectUrl), {
                method: route.method,
                headers: route.method === 'POST' ? { 'Content-Type': 'application/json' } : undefined,
                body: route.method === 'POST' ? '{}' : undefined,
                redirect: 'manual',
                signal: AbortSignal.timeout(20_000),
            });
            let errorCode = 'invalid-body';
            try {
                errorCode = String((await response.json() as { errorCode?: unknown }).errorCode ?? 'missing');
            } catch {
                // Keep only the non-secret parse result in evidence.
            }
            const headersAreInert = response.headers.get('Cache-Control') === 'no-store'
                && (response.headers.get('X-Robots-Tag') ?? '').includes('noindex');
            results.push({
                status: response.status === 503 && errorCode === 'WEB_RUNTIME_BOOTSTRAP' && headersAreInert ? 'ok' : 'failed',
                name: `web_bootstrap_503_${route.method.toLowerCase()}_${route.path.replace(/[^a-z0-9]+/giu, '_') || 'root'}`,
                message: 'Representative public, campus and API routes must remain unavailable in bootstrap mode.',
                details: [`route=${route.method} ${route.path}`, `httpStatus=${response.status}`, `errorCode=${errorCode}`, `inertHeaders=${String(headersAreInert)}`],
            });
        }

        const attestationGet = await fetch(new URL('/api/internal/runtime-attestation', webDirectUrl), {
            method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(20_000),
        });
        results.push({
            status: attestationGet.status === 404 ? 'ok' : 'failed',
            name: 'web_bootstrap_attestation_get_hidden_after_deploy',
            message: 'The diagnostic attestation path must expose only its authenticated POST contract; GET remains 404.',
            details: [`httpStatus=${attestationGet.status}`],
        });
    } catch (error) {
        results.push({
            status: 'failed',
            name: 'web_bootstrap_direct_probe_after_deploy',
            message: 'Direct post-deploy bootstrap probes failed or timed out.',
            details: [sanitizeError(error instanceof Error ? error : new Error(String(error)))],
        });
    }
    return results;
}

function bootstrapAssetProbePath(): string {
    const assetRoot = path.join(process.cwd(), 'dist', 'client', '_astro');
    if (!existsSync(assetRoot)) return '/_astro/bootstrap-probe.js';
    const firstAsset = readdirSync(assetRoot, { withFileTypes: true })
        .find((entry) => entry.isFile());
    return firstAsset ? `/_astro/${encodeURIComponent(firstAsset.name)}` : '/_astro/bootstrap-probe.js';
}

function runCommand(command: CommandSpec): CommandCapture {
    if (command.writesCloudflare) externalWriteAttempted = true;
    const result = spawnSync(command.bin, command.args, {
        cwd: process.cwd(),
        encoding: 'utf8',
        shell: false,
        timeout: command.timeoutMs,
        env: process.env,
    });
    const stdout = sanitizeOutput(typeof result.stdout === 'string' ? result.stdout : String(result.stdout ?? ''));
    const stderr = sanitizeOutput(typeof result.stderr === 'string' ? result.stderr : String(result.stderr ?? ''));
    const exitCode = result.status;
    const timedOut = Boolean(result.error && result.error.message.includes('ETIMEDOUT'));
    const status: CheckStatus = exitCode === 0 && !timedOut ? 'ok' : 'failed';
    const capturePath = path.join(outputDir, `${command.id}.txt`);
    const body = [
        `command=${command.display}`,
        `writesCloudflare=${String(command.writesCloudflare)}`,
        `exitCode=${String(exitCode)}`,
        `error=${result.error ? sanitizeError(result.error) : 'none'}`,
        '',
        '## stdout',
        '',
        stdout || '(empty)',
        '',
        '## stderr',
        '',
        stderr || '(empty)',
        '',
    ].join('\n');

    writeFileSync(capturePath, body, 'utf8');

    return {
        id: command.id,
        display: command.display,
        path: capturePath,
        exitCode,
        status,
        writesCloudflare: command.writesCloudflare,
    };
}

function checkForCapture(capture: CommandCapture): PhaseOneCheck {
    return {
        status: capture.status,
        name: `command_${capture.id}`,
        message: capture.status === 'ok'
            ? `Command completed: ${capture.display}`
            : `Command failed or timed out: ${capture.display}`,
        details: [
            `capture=${capture.path}`,
            `exitCode=${String(capture.exitCode)}`,
            `writesCloudflare=${String(capture.writesCloudflare)}`,
        ],
    };
}

function deploymentVersionId(capture: CommandCapture): string | null {
    const text = existsSync(capture.path) ? readFileSync(capture.path, 'utf8') : '';
    return /"version_id"\s*:\s*"([0-9a-f]{8}-[0-9a-f-]{27})"/iu.exec(text)?.[1] ?? null;
}

async function verifyFreshFulfillmentBootstrap(expectedVersionId: string): Promise<PhaseOneCheck[]> {
    const missing = [
        ...fulfillmentBootstrapSecretNames.filter((name) => !process.env[name]?.trim()),
        ...(!process.env.CLOUDFLARE_API_TOKEN?.trim() ? ['CLOUDFLARE_API_TOKEN'] : []),
    ];
    if (missing.length > 0) {
        return [{
            status: 'failed',
            name: 'fresh_fulfillment_bootstrap_inputs_before_web',
            message: 'Fresh bootstrap proof lacks local secure inputs; web deploy is blocked.',
            details: missing.map((name) => `missing=${name}`),
        }];
    }

    const proofChecks: PhaseOneCheck[] = [];
    try {
        const healthResponse = await fetch(new URL('/health', fulfillmentDirectUrl), {
            redirect: 'error', signal: AbortSignal.timeout(20_000),
        });
        const health = await healthResponse.json() as { operationMode?: unknown; workerIdentity?: unknown };
        proofChecks.push({
            status: healthResponse.status === 200
                && health.operationMode === 'bootstrap'
                && health.workerIdentity === fulfillmentWorker ? 'ok' : 'failed',
            name: 'fresh_fulfillment_bootstrap_health_before_web',
            message: 'Fresh direct health must prove the exact fulfillment bootstrap identity before web deploy.',
            details: [`httpStatus=${healthResponse.status}`, `operationMode=${String(health.operationMode ?? 'missing')}`],
        });

        const blockedResponse = await fetch(new URL('/internal/jobs/process', fulfillmentDirectUrl), {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
            redirect: 'error', signal: AbortSignal.timeout(20_000),
        });
        const blockedBody = await blockedResponse.json() as { errorCode?: unknown };
        proofChecks.push({
            status: blockedResponse.status === 503 && blockedBody.errorCode === 'FULFILLMENT_DISABLED' ? 'ok' : 'failed',
            name: 'fresh_fulfillment_bootstrap_503_before_web',
            message: 'Fresh operational probe must prove fulfillment is disabled before web deploy.',
            details: [`httpStatus=${blockedResponse.status}`],
        });

        const nonce = randomUUID();
        const attestationResponse = await fetch(new URL('/internal/runtime-attestation', fulfillmentDirectUrl), {
            method: 'POST',
            headers: { Authorization: `Bearer ${process.env.INTERNAL_JOB_SECRET}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ nonce }), redirect: 'error', signal: AbortSignal.timeout(20_000),
        });
        const envelope = await attestationResponse.json() as RuntimeAttestationEnvelope;
        const config = await buildRuntimeAttestationConfig('fulfillment', {
            INTERNAL_JOB_SECRET: process.env.INTERNAL_JOB_SECRET?.trim() ?? '',
            PUBLIC_APP_ENV: 'production', SUPABASE_EXPECTED_PROJECT_REF: 'vkkahxsybhbutszerawz',
            WORKER_IDENTITY: fulfillmentWorker, WORKER_VERSION_ID: expectedVersionId,
            PUBLIC_SITE_URL: 'https://espanolhonesto.com', FULFILLMENT_RUNTIME_MODE: 'bootstrap',
            EMAIL_DELIVERY_MODE: 'disabled', EMAIL_DAILY_RECIPIENT_LIMIT: '0', EMAIL_MONTHLY_RECIPIENT_LIMIT: '0',
            CHECKOUT_ENABLED: 'false', CHECKOUT_ENABLED_OVERRIDE: 'false',
        });
        const providersAbsent = config.googleBoundary === 'absent'
            && config.googleServiceAccountFingerprint === 'absent'
            && config.googlePrivateKeyFingerprint === 'absent'
            && config.googleAdminFingerprint === 'absent'
            && config.googleDriveRootFingerprint === 'absent'
            && config.googleTemplateFingerprint === 'absent'
            && config.supabaseUrlFingerprint === 'absent'
            && config.supabaseServiceRoleFingerprint === 'absent'
            && config.resendApiKeyFingerprint === 'absent'
            && config.resendAllowlistFingerprint === 'absent'
            && config.resendSenderFingerprint === 'absent'
            && config.cronSecretFingerprint === 'absent';
        const attested = attestationResponse.status === 200
            && providersAbsent
            && envelope.workerVersionId === expectedVersionId
            && envelope.workerIdentity === fulfillmentWorker
            && await verifyRuntimeAttestation(envelope, {
                config, nonce, role: 'fulfillment', schema: RUNTIME_ATTESTATION_SCHEMA,
            }, process.env.INTERNAL_JOB_SECRET ?? '');
        proofChecks.push({
            status: attested ? 'ok' : 'failed',
            name: 'fresh_fulfillment_bootstrap_hmac_before_web',
            message: 'Fresh HMAC attestation must bind bootstrap config to the just-listed fulfillment version.',
            details: [
                `workerVersionMatched=${String(envelope.workerVersionId === expectedVersionId)}`,
                `providersAbsent=${String(providersAbsent)}`,
                `proofVerified=${String(attested)}`,
                `withheld=${withheldFulfillmentProviderSecretNames.join(',')}`,
            ],
        });

        const schedulesResponse = await fetch(
            `https://api.cloudflare.com/client/v4/accounts/${target.accountId}/workers/scripts/${encodeURIComponent(fulfillmentWorker)}/schedules`,
            { headers: { Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}` }, redirect: 'error', signal: AbortSignal.timeout(20_000) },
        );
        const schedules = await schedulesResponse.json() as { success?: unknown; result?: unknown[] };
        const noCron = schedulesResponse.status === 200 && schedules.success === true && Array.isArray(schedules.result) && schedules.result.length === 0;
        proofChecks.push({
            status: noCron ? 'ok' : 'failed',
            name: 'fresh_fulfillment_bootstrap_no_cron_before_web',
            message: 'Cloudflare schedules API must prove zero Cron Triggers immediately before web deploy.',
            details: [`httpStatus=${schedulesResponse.status}`, `scheduleCount=${Array.isArray(schedules.result) ? schedules.result.length : 'unknown'}`],
        });
    } catch {
        proofChecks.push({
            status: 'failed',
            name: 'fresh_fulfillment_bootstrap_remote_proof_before_web',
            message: 'Fresh remote bootstrap proof failed; web deploy is blocked.',
            details: ['probeFailed=true'],
        });
    }
    return proofChecks;
}

function renderArtifacts(report: PhaseOneReport): RenderedArtifacts {
    const commandManifest = `${JSON.stringify({
        schemaVersion: 1,
        generatedAt: report.endedAt,
        target: report.target,
        mode: report.executeRequested ? 'execute-approved' : 'plan',
        approvalEnvVar: report.approvalEnvVar,
        approvalMatched: report.approvalMatched,
        externalWriteAttempted: report.externalWriteAttempted,
        externalWritePerformed: report.externalWritePerformed,
        exactApprovalSentence,
        commands: Object.values(commands).map((command) => ({
            id: command.id,
            display: command.display,
            writesCloudflare: command.writesCloudflare,
        })),
        captures: report.captures.map((capture) => ({
            id: capture.id,
            path: toRelative(capture.path),
            exitCode: capture.exitCode,
            status: capture.status,
            writesCloudflare: capture.writesCloudflare,
        })),
        sourceEvidence: {
            noWritePreflight: toRelativeOrNull(report.latestPreflightSummaryPath),
            variableMatrix: toRelativeOrNull(report.latestVariableMatrixPath),
            cutoverManifest: toRelativeOrNull(report.latestCutoverManifestPath),
            phaseOneApproval: toRelativeOrNull(report.latestPhaseOneApprovalPath),
            fulfillmentBootstrap: toRelativeOrNull(report.latestFulfillmentBootstrapSummaryPath),
            fulfillmentBootstrapHmac: toRelativeOrNull(report.latestFulfillmentBootstrapSecretsSummaryPath),
        },
        forbiddenScope: forbiddenScopeLines(),
    }, null, 2)}\n`;

    const executionPlan = `${[
        '# Cloudflare Production Worker Phase 1 Execution Plan',
        '',
        'This is a gated runner package for creating/deploying only the inert production_bootstrap web Worker. It is not active-release, domain or secret-loading approval.',
        '',
        '## Current Mode',
        '',
        `- Execute requested: ${String(report.executeRequested)}.`,
        `- Approval matched: ${String(report.approvalMatched)}.`,
        `- External write attempted: ${String(report.externalWriteAttempted)}.`,
        `- External write performed: ${String(report.externalWritePerformed)}.`,
        '',
        '## Target',
        '',
        `- Account: ${report.target.accountLabel} (${report.target.accountId}).`,
        `- Worker: \`${report.target.productionWorker}\`.`,
        `- Existing Pages project that currently owns domains: \`${report.target.pagesProject}\`.`,
        `- Domains that must not move in phase 1: ${report.target.customDomains.map((domain) => `\`${domain}\``).join(', ')}.`,
        '- Required runtime state: `WEB_RUNTIME_MODE=bootstrap`, checkout false, email disabled and quotas zero.',
        '- Every application route must return `503 WEB_RUNTIME_BOOTSTRAP`; only `/health` and authenticated runtime attestation remain diagnostic.',
        '',
        '## Evidence To Review First',
        '',
        `- Fulfillment bootstrap proof: ${toRelativeOrFallback(report.latestFulfillmentBootstrapSummaryPath, 'outputs/launch-cloudflare-production-fulfillment-bootstrap/<timestamp>/summary.md')}`,
        `- Fulfillment HMAC-only proof: ${toRelativeOrFallback(report.latestFulfillmentBootstrapSecretsSummaryPath, 'outputs/launch-cloudflare-production-fulfillment-bootstrap-secrets/<timestamp>/summary.md')}`,
        '- Local bootstrap sources: `wrangler.toml`, `scripts/dev/build-production-bootstrap.ts`, `astro.config.mjs`, `src/middleware.ts`.',
        '',
        '## Commands Encoded In This Runner',
        '',
        '```bash',
        ...Object.values(commands).map((command) => command.display),
        '```',
        '',
        '## How To Execute Later',
        '',
        'Only after the exact approval is provided for the exact target/resource/scope:',
        '',
        '```powershell',
        `$env:${approvalEnvVar}='${exactApprovalSentence.replace(/'/g, "''")}'`,
        'corepack pnpm --config.verify-deps-before-run=false launch:cloudflare-production-worker-phase1 -- --execute-approved',
        '```',
        '',
        '## Stop Conditions',
        '',
        '- Stop if the logged-in Cloudflare account is not `d1a22bcf6477ff2ff31d2bfb83084e44`.',
        '- Stop if dry-run mentions `espanolhonesto.com` or `www.espanolhonesto.com`.',
        '- Stop if dry-run does not show bootstrap mode, checkout false and email disabled with zero quotas.',
        '- Stop if the generated config is not `targetEnvironment=production_bootstrap` or contains routes, cron or active-provider bindings.',
        '- Stop if the remote Worker contains any secret outside the minimal bootstrap allowlist.',
        '- Stop if any tool asks to move a domain, edit DNS, delete Pages, put secrets or enable checkout.',
        '',
    ].join('\n')}\n`;

    const approvalGate = `${[
        '# Cloudflare Production Worker Phase 1 Approval Gate',
        '',
        'This file is not approval. It documents the exact gate that the runner requires before the phase-1 deploy command can execute.',
        '',
        `- Environment variable: \`${approvalEnvVar}\`.`,
        '- Required flag: `--execute-approved`.',
        `- Execute requested in this run: ${String(report.executeRequested)}.`,
        `- Approval matched in this run: ${String(report.approvalMatched)}.`,
        `- External write attempted in this run: ${String(report.externalWriteAttempted)}.`,
        `- External write performed in this run: ${String(report.externalWritePerformed)}.`,
        '',
        '## Exact Approval Sentence',
        '',
        exactApprovalSentence,
        '',
        '## Allowed Scope After Match',
        '',
        '- Build the current workspace only with `pnpm run build:production:bootstrap`.',
        '- Validate the resolved `dist/server/wrangler.json` and run an immediate Wrangler dry-run.',
        '- Deploy only Worker `espanolhonesto` to account `d1a22bcf6477ff2ff31d2bfb83084e44` with bootstrap/checkout/email inertness and `--keep-vars`.',
        '- Verify deployments, minimal secret-name shape, direct health and representative 503 routes.',
        '- Do not require final legal identity or Stripe Live for this inert bootstrap; both remain mandatory for the later active build.',
        '',
        '## Forbidden Scope',
        '',
        ...forbiddenScopeLines().map((line) => `- ${line}`),
        '',
    ].join('\n')}\n`;

    const rollbackAfterPhaseOne = `${[
        '# Cloudflare Production Worker Phase 1 Rollback',
        '',
        'This rollback plan applies only after the Worker shell deploy phase. It does not authorize rollback writes by itself.',
        '',
        '## If Phase 1 Was Not Executed',
        '',
        '- No rollback is required; this package generated local evidence only.',
        '- Keep `espanolhonesto.com` and `www.espanolhonesto.com` on the existing Pages project.',
        '',
        '## If Worker Deploy Fails',
        '',
        '- Do not move domains.',
        '- Leave Pages as the production-serving target.',
        '- Inspect the sanitized command capture and fix local build/config before another exact approval.',
        '',
        '## If Worker Deploy Succeeds But Direct Probe Fails Later',
        '',
        '- Keep domains on Pages.',
        '- Keep checkout disabled.',
        '- Fix runtime/secret-name posture, regenerate preflight/cutover/phase1 packages and rerun direct Worker probes.',
        '',
        '## If A Domain Was Accidentally Moved Elsewhere',
        '',
        '- Treat this as out of scope for phase 1 and stop.',
        '- Reattach domains to the previously safe Cloudflare target using a separately approved rollback action.',
        '- Do not delete the Pages project during rollback.',
        '',
    ].join('\n')}\n`;

    const manualEvidenceAfterPhaseOne = `${[
        'corepack pnpm launch:manual-evidence:record --',
        '  --id integration_readiness',
        '  --status pass',
        '  --summary "Cloudflare production web bootstrap completed: Worker espanolhonesto is inert, checkout/email are disabled and representative application routes return 503; domains remain on Pages."',
        `  --environment "Cloudflare account ${report.target.accountId}; Worker ${report.target.productionWorker}; production_bootstrap only; domains not moved"`,
        '  --owner Alin',
        `  --evidence "command_output=../../${toRelative(report.summaryPath)}::phase-1 runner summary reviewed; replace placeholder after actual approved execution"`,
        `  --evidence "command_output=../../${toRelative(report.commandManifestPath)}::command manifest reviewed; no secret values stored"`,
        '  --evidence "manual_note=Replace this note with the actual non-secret verification: deploy capture path, deployments-list path, secret-name list path and direct Worker URL probe result."',
        '',
        '# Add --write only after phase 1 has actually run under exact approval and the placeholder note is replaced.',
        '',
    ].join(' \\\n')}`;

    const summary = renderSummary(report);

    return {
        commandManifest,
        executionPlan,
        approvalGate,
        rollbackAfterPhaseOne,
        manualEvidenceAfterPhaseOne,
        summary,
    };
}

function renderSummary(report: PhaseOneReport): string {
    const lines = [
        '# Cloudflare Production Worker Phase 1 Summary',
        '',
        `- Status: ${report.status}`,
        `- Closure: ${report.phaseOneClosureStatus}`,
        `- Generated: ${report.endedAt}`,
        `- Execute requested: ${String(report.executeRequested)}`,
        `- Approval matched: ${String(report.approvalMatched)}`,
        `- External write attempted: ${String(report.externalWriteAttempted)}`,
        `- External write performed: ${String(report.externalWritePerformed)}`,
        `- Command manifest: ${toRelative(report.commandManifestPath)}`,
        `- Execution plan: ${toRelative(report.executionPlanPath)}`,
        `- Approval gate: ${toRelative(report.approvalGatePath)}`,
        `- Rollback: ${toRelative(report.rollbackAfterPhaseOnePath)}`,
        `- Manual evidence template: ${toRelative(report.manualEvidenceAfterPhaseOnePath)}`,
        '',
        'This runner is plan-only unless both the exact approval environment variable and the `--execute-approved` flag are present. In plan mode it does not call Cloudflare, does not deploy, does not move domains, does not change DNS and does not write secrets.',
        '',
        '## Target',
        '',
        `- Account: ${report.target.accountLabel} (${report.target.accountId}).`,
        `- Worker: \`${report.target.productionWorker}\`.`,
        '- Runtime: `production_bootstrap` / `WEB_RUNTIME_MODE=bootstrap`.',
        '- Checkout/email: disabled; quotas zero.',
        `- Domains not moved in phase 1: ${report.target.customDomains.map((domain) => `\`${domain}\``).join(', ')}.`,
        '',
        '## Checks',
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
            '| Status | Command | Writes Cloudflare | Path |',
            '| --- | --- | --- | --- |',
            ...report.captures.map((capture) => `| ${capture.status} | ${escapeCell(capture.display)} | ${String(capture.writesCloudflare)} | ${escapeCell(toRelative(capture.path))} |`),
            '',
        );
    }

    return `${lines.join('\n')}\n`;
}

function validateGeneratedArtifactPosture(renderedArtifacts: RenderedArtifacts): PhaseOneCheck {
    const combined = Object.values(renderedArtifacts).join('\n');
    const required = [
        'External write performed',
        approvalEnvVar,
        exactApprovalSentence,
        'No domain move',
        'No DNS change',
        'No Pages deletion',
        'No secret value printing',
        'production_bootstrap',
        'WEB_RUNTIME_MODE=bootstrap',
        'corepack pnpm --config.verify-deps-before-run=false run build:production:bootstrap',
        'corepack pnpm --config.verify-deps-before-run=false exec wrangler deploy --config dist/server/wrangler.json --dry-run',
        'corepack pnpm --config.verify-deps-before-run=false exec wrangler deploy --config dist/server/wrangler.json --keep-vars',
    ];
    const missing = required.filter((snippet) => !combined.includes(snippet));
    const unsafeSecretSnippets = [
        'sk_live_',
        'whsec_',
    ].filter((snippet) => combined.includes(snippet));
    const unsafeCommandSnippets = [
        'wrangler secret put',
        'wrangler pages project delete',
        'wrangler route delete',
        'wrangler dns',
    ].filter((snippet) => Object.values(commands).some((command) => command.display.includes(snippet)));
    const unsafe = [...unsafeSecretSnippets, ...unsafeCommandSnippets];

    return {
        status: missing.length === 0 && unsafe.length === 0 ? 'ok' : 'failed',
        name: 'generated_artifact_posture',
        message: missing.length === 0 && unsafe.length === 0
            ? 'Generated phase-1 artifacts preserve the approval gate, command scope and no-secret/no-domain-move posture.'
            : 'Generated phase-1 artifacts are missing gate/scope facts or include unsafe snippets.',
        details: [
            ...missing.map((snippet) => `missing=${snippet}`),
            ...unsafe.map((snippet) => `unsafe=${snippet}`),
        ],
    };
}

function buildCommands(): Record<string, CommandSpec> & {
    readonly: CommandSpec;
    build: CommandSpec;
    deployDryRun: CommandSpec;
    deployKeepVars: CommandSpec;
    deploymentsList: CommandSpec;
    secretList: CommandSpec;
} {
    return {
        readonly: {
            id: 'cloudflare-production-runtime-readonly',
            display: 'corepack pnpm --config.verify-deps-before-run=false launch:cloudflare-production-runtime-readonly',
            bin: 'corepack',
            args: ['pnpm', '--config.verify-deps-before-run=false', 'launch:cloudflare-production-runtime-readonly'],
            timeoutMs: 120000,
            writesCloudflare: false,
        },
        build: {
            id: 'pnpm-build-production-bootstrap',
            display: 'corepack pnpm --config.verify-deps-before-run=false run build:production:bootstrap',
            bin: 'corepack',
            args: ['pnpm', '--config.verify-deps-before-run=false', 'run', 'build:production:bootstrap'],
            timeoutMs: 240000,
            writesCloudflare: false,
        },
        deployDryRun: {
            id: 'wrangler-deploy-production-bootstrap-dry-run',
            display: 'corepack pnpm --config.verify-deps-before-run=false exec wrangler deploy --config dist/server/wrangler.json --dry-run',
            bin: 'corepack',
            args: ['pnpm', '--config.verify-deps-before-run=false', 'exec', 'wrangler', 'deploy', '--config', 'dist/server/wrangler.json', '--dry-run'],
            timeoutMs: 180000,
            writesCloudflare: false,
        },
        deployKeepVars: {
            id: 'wrangler-deploy-production-bootstrap-keep-vars',
            display: 'corepack pnpm --config.verify-deps-before-run=false exec wrangler deploy --config dist/server/wrangler.json --keep-vars',
            bin: 'corepack',
            args: ['pnpm', '--config.verify-deps-before-run=false', 'exec', 'wrangler', 'deploy', '--config', 'dist/server/wrangler.json', '--keep-vars'],
            timeoutMs: 240000,
            writesCloudflare: true,
        },
        fulfillmentDeploymentsList: {
            id: 'wrangler-fulfillment-deployments-list-before-web',
            display: 'corepack pnpm --config.verify-deps-before-run=false exec wrangler deployments list --name espanol-honesto-fulfillment-production --json',
            bin: 'corepack',
            args: ['pnpm', '--config.verify-deps-before-run=false', 'exec', 'wrangler', 'deployments', 'list', '--name', 'espanol-honesto-fulfillment-production', '--json'],
            timeoutMs: 120000,
            writesCloudflare: false,
        },
        deploymentsList: {
            id: 'wrangler-deployments-list-production',
            display: 'corepack pnpm --config.verify-deps-before-run=false exec wrangler deployments list --name espanolhonesto --json',
            bin: 'corepack',
            args: ['pnpm', '--config.verify-deps-before-run=false', 'exec', 'wrangler', 'deployments', 'list', '--name', 'espanolhonesto', '--json'],
            timeoutMs: 120000,
            writesCloudflare: false,
        },
        secretList: {
            id: 'wrangler-secret-list-production',
            display: 'corepack pnpm --config.verify-deps-before-run=false exec wrangler secret list --name espanolhonesto --format json',
            bin: 'corepack',
            args: ['pnpm', '--config.verify-deps-before-run=false', 'exec', 'wrangler', 'secret', 'list', '--name', 'espanolhonesto', '--format', 'json'],
            timeoutMs: 120000,
            writesCloudflare: false,
        },
    };
}

function forbiddenScopeLines(): string[] {
    return [
        'No domain move.',
        'No DNS change.',
        'No Pages deletion.',
        'No route change.',
        'No custom-domain attachment.',
        'No `CHECKOUT_ENABLED=true`.',
        'No secret value printing or storage in outputs.',
        'No web secret loading in phase 1.',
        'No Stripe live mode, real checkout session or real payment.',
        'No final legal identity requirement for the inert bootstrap build; active release still requires it.',
        'No Supabase, Google, Resend, Sentry, Turnstile or GitHub writes.',
    ];
}

function statusFor(checkList: PhaseOneCheck[]): ReportStatus {
    if (checkList.some((check) => check.status === 'failed')) return 'FAILED';
    if (checkList.some((check) => check.status === 'warning')) return 'WARNING';
    return 'OK';
}

function readIfExists(filePath: string): string | null {
    return existsSync(filePath) ? readFileSync(filePath, 'utf8') : null;
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

function latestGeneratedPathMatching(folderName: string, fileName: string, snippets: readonly string[]): string | null {
    const root = path.join(process.cwd(), 'outputs', folderName);
    if (!existsSync(root)) return null;
    const candidates = readdirSync(root, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(root, entry.name, fileName))
        .filter((candidate) => existsSync(candidate))
        .sort()
        .reverse();
    return candidates.find((candidate) => {
        const contents = readFileSync(candidate, 'utf8');
        return snippets.every((snippet) => contents.includes(snippet));
    }) ?? null;
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
    return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function stamp(date: Date): string {
    return date.toISOString().replace(/[:.]/g, '-');
}

function sanitizeOutput(value: string): string {
    return value
        .replace(/-----BEGIN [A-Z ]+PRIVATE KEY-----[\s\S]*?-----END [A-Z ]+PRIVATE KEY-----/g, '[redacted-private-key]')
        .replace(/sk_(live|test)_[A-Za-z0-9]{20,}/g, 'sk_$1_[redacted]')
        .replace(/whsec_[A-Za-z0-9]{20,}/g, 'whsec_[redacted]')
        .replace(/sb_secret_[A-Za-z0-9_-]{20,}/g, 'sb_secret_[redacted]')
        .replace(/AIza[0-9A-Za-z_-]{30,}/g, 'AIza[redacted]')
        .replace(/(?<![A-Za-z0-9_])re_[A-Za-z0-9_]{20,}/g, 're_[redacted]')
        .replace(/(postgres|postgresql):\/\/[^\s"']+:[^\s"']+@/giu, '$1://[redacted-user]:[redacted-password]@')
        .replace(/Bearer\s+[A-Za-z0-9._-]{20,}/gi, 'Bearer [redacted]');
}

function sanitizeError(error: Error): string {
    return sanitizeOutput(error.message).replace(/\r?\n/g, ' ').slice(0, 500);
}
