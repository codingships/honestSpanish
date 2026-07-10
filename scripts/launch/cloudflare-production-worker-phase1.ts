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
const exactApprovalSentence = 'Apruebo crear/desplegar el Cloudflare Worker production `espanolhonesto` en la cuenta `d1a22bcf6477ff2ff31d2bfb83084e44` usando el build actual de `C:\\Users\\Alin\\Desktop\\Academia\\pruebas`, despues de cargar los secrets de fulfillment manteniendolo inerte y verificar inmediatamente su version remota, HMAC, modo bootstrap, bloqueo 503 y cron vacio, con `CHECKOUT_ENABLED=false`, sin adjuntar ni mover `espanolhonesto.com` ni `www.espanolhonesto.com`, sin activar pagos reales, sin borrar Pages y sin cambiar DNS.';
const executeRequested = process.argv.includes('--execute-approved');
const approvalMatched = process.env[approvalEnvVar] === exactApprovalSentence;

const startedAt = new Date();
const outputDir = path.join(process.cwd(), 'outputs', 'launch-cloudflare-production-worker-phase1', stamp(startedAt));
mkdirSync(outputDir, { recursive: true });

const latestPreflightSummaryPath = latestGeneratedPath('launch-cloudflare-production-runtime-cutover-preflight', 'summary.md');
const latestVariableMatrixPath = latestGeneratedPath('launch-cloudflare-production-runtime-cutover-preflight', 'cloudflare-production-worker-variable-matrix.md');
const latestCutoverManifestPath = latestGeneratedPath('launch-cloudflare-production-runtime-cutover', 'cloudflare-production-runtime-cutover-manifest.json');
const latestPhaseOneApprovalPath = latestGeneratedPath('launch-cloudflare-production-runtime-cutover', 'approval-request-phase-1-worker.md');
const latestFulfillmentBootstrapSummaryPath = latestGeneratedPath('launch-cloudflare-production-fulfillment-bootstrap', 'summary.md');
const latestFulfillmentSecretsSummaryPath = latestGeneratedPath('launch-cloudflare-production-fulfillment-secrets', 'summary.md');
const fulfillmentWorker = 'espanol-honesto-fulfillment-production';
const fulfillmentDirectUrl = 'https://espanol-honesto-fulfillment-production.alindev95.workers.dev/';
const fulfillmentSecretNames = [
    'PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'INTERNAL_JOB_SECRET',
    'GOOGLE_SERVICE_ACCOUNT_EMAIL', 'GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY', 'GOOGLE_ADMIN_EMAIL',
    'GOOGLE_DRIVE_ROOT_FOLDER_ID', 'GOOGLE_TEMPLATE_DOC_ID', 'RESEND_API_KEY', 'EMAIL_FROM', 'RESEND_FROM_EMAIL',
] as const;

const commands = buildCommands();
const captures: CommandCapture[] = [];
let externalWriteAttempted = false;
const checks: PhaseOneCheck[] = [
    validatePackageScript(),
    validateFulfillmentBootstrapEvidence(),
    validateFulfillmentSecretsEvidence(),
    validateLatestNoWritePreflight(),
    validateLatestCutoverPack(),
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

function validateFulfillmentSecretsEvidence(): PhaseOneCheck {
    if (!latestFulfillmentSecretsSummaryPath || !existsSync(latestFulfillmentSecretsSummaryPath)) {
        return {
            status: 'failed',
            name: 'fulfillment_secrets_before_web',
            message: 'Fulfillment secrets must be loaded and re-attested while bootstrap remains inert before web deploy.',
            details: ['run=pnpm launch:cloudflare-production-fulfillment-secrets -- --execute-approved'],
        };
    }
    const summary = readFileSync(latestFulfillmentSecretsSummaryPath, 'utf8');
    const required = [
        '- Status: OK', '- Execute requested: true', '- External write performed: true',
        '| ok | bootstrap_operational_block_pre_write |', '| ok | direct_fulfillment_runtime_attestation |',
    ];
    const missing = required.filter((snippet) => !summary.includes(snippet));
    return {
        status: missing.length === 0 ? 'ok' : 'failed',
        name: 'fulfillment_secrets_before_web',
        message: missing.length === 0
            ? 'Latest local evidence records fulfillment secret loading and bootstrap re-attestation.'
            : 'Fulfillment secret/bootstrap evidence is incomplete; web deploy is blocked.',
        details: missing.length === 0 ? [`summary=${latestFulfillmentSecretsSummaryPath}`] : missing.map((snippet) => `missing=${snippet}`),
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

    return {
        status: missing.length === 0 ? 'ok' : 'failed',
        name: 'package_script_cloudflare_phase1',
        message: missing.length === 0
            ? 'Package scripts expose the gated Cloudflare production Worker phase-1 runner and preserve pnpm policy.'
            : 'Package scripts are missing the gated Cloudflare production Worker phase-1 runner or pnpm package manager contract.',
        details: missing.length === 0 ? ['launch:cloudflare-production-worker-phase1'] : missing.map((item) => `missing=${item}`),
    };
}

function validateLatestNoWritePreflight(): PhaseOneCheck {
    if (!latestPreflightSummaryPath || !existsSync(latestPreflightSummaryPath)) {
        return {
            status: 'failed',
            name: 'latest_no_write_preflight_exists',
            message: 'The Cloudflare runtime cutover preflight must exist before phase-1 execution can be considered.',
            details: ['run=corepack pnpm --config.verify-deps-before-run=false launch:cloudflare-production-runtime-cutover-preflight'],
        };
    }

    const preflight = readFileSync(latestPreflightSummaryPath, 'utf8');
    const required = [
        'Cloudflare Production Runtime Preflight Refresh',
        'Remote write performed: false',
        `Target account: ${target.accountId}`,
        `Target Worker: ${target.productionWorker}`,
        'CHECKOUT_ENABLED=false in config: True',
        'Dry-run after build looked successful: True',
        'Dry-run mentions CHECKOUT_ENABLED=false: True',
        'Dry-run avoids custom domains: True',
        'Production secret-list shape: worker_missing',
        'dist removed after dry-run: True',
        'wrangler deploy --config dist/server/wrangler.json --dry-run',
    ];
    const missing = required.filter((snippet) => !preflight.includes(snippet));
    const matrixMissing = !latestVariableMatrixPath || !existsSync(latestVariableMatrixPath);

    return {
        status: missing.length === 0 && !matrixMissing ? 'ok' : 'failed',
        name: 'latest_no_write_preflight_exists',
        message: missing.length === 0 && !matrixMissing
            ? 'Latest no-write preflight proves build, dry-run, checkout-off, no-domain-attachment and expected missing Worker posture.'
            : 'Latest no-write preflight is missing required phase-1 safety facts.',
        details: missing.length === 0 && !matrixMissing
            ? [`preflight=${latestPreflightSummaryPath}`, `variableMatrix=${latestVariableMatrixPath}`]
            : [
                ...missing.map((snippet) => `missing=${snippet}`),
                ...(matrixMissing ? ['missing=cloudflare-production-worker-variable-matrix.md'] : []),
            ],
    };
}

function validateLatestCutoverPack(): PhaseOneCheck {
    if (!latestCutoverManifestPath || !existsSync(latestCutoverManifestPath) || !latestPhaseOneApprovalPath || !existsSync(latestPhaseOneApprovalPath)) {
        return {
            status: 'failed',
            name: 'latest_cutover_pack_exists',
            message: 'The Cloudflare cutover package and phase-1 approval request must exist before this runner can be used.',
            details: ['run=corepack pnpm --config.verify-deps-before-run=false launch:cloudflare-production-runtime-cutover'],
        };
    }

    const approval = readFileSync(latestPhaseOneApprovalPath, 'utf8');
    const required = [
        '# Cloudflare Production Worker Phase 1 Approval Request',
        exactApprovalSentence,
        'No domain move, DNS change, Pages deletion, route change, zone change or custom-domain attachment.',
        'No secret value printing or storage in outputs.',
        'corepack pnpm --config.verify-deps-before-run=false exec wrangler deploy --config dist/server/wrangler.json --keep-vars',
    ];
    const missing = required.filter((snippet) => !approval.includes(snippet));

    return {
        status: missing.length === 0 ? 'ok' : 'failed',
        name: 'latest_cutover_pack_exists',
        message: missing.length === 0
            ? 'Latest cutover package contains the phase-1 approval text, forbidden scope and rollback/verification support.'
            : 'Latest cutover package is missing required approval-gate facts.',
        details: missing.length === 0
            ? [`manifest=${latestCutoverManifestPath}`, `approval=${latestPhaseOneApprovalPath}`]
            : missing.map((snippet) => `missing=${snippet}`),
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
    const checkoutFalseCount = [...wrangler.matchAll(/CHECKOUT_ENABLED\s*=\s*"false"/g)].length;
    const required = [
        'name = "espanolhonesto-env-required"',
        'keep_vars = true',
        '[env.production]',
        'name = "espanolhonesto"',
        '[env.staging]',
        'name = "espanolhonesto-staging"',
    ];
    const missing = required.filter((snippet) => !wrangler.includes(snippet));
    if (checkoutFalseCount < 3) missing.push('CHECKOUT_ENABLED = "false" in base, staging and production vars');

    return {
        status: missing.length === 0 ? 'ok' : 'failed',
        name: 'wrangler_phase1_config',
        message: missing.length === 0
            ? 'Wrangler config uses a safe base name and keeps explicit production/staging names, keep_vars and checkout-off posture.'
            : 'Wrangler config is missing the required phase-1 safety posture.',
        details: missing.length === 0 ? [`checkoutFalseCount=${checkoutFalseCount}`] : missing.map((snippet) => `missing=${snippet}`),
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

    const preWriteCommands = [
        commands.readonly,
        commands.cutoverPreflight,
        commands.build,
        commands.deployDryRun,
    ];

    for (const command of preWriteCommands) {
        const capture = runCommand(command);
        reportCaptures.push(capture);
        executionChecks.push(checkForCapture(capture));
        if (capture.status === 'failed') return executionChecks;
    }

    const dryRunCapture = reportCaptures.find((capture) => capture.id === commands.deployDryRun.id);
    const dryRunOutput = dryRunCapture ? readFileSync(dryRunCapture.path, 'utf8') : '';
    const dryRunIsSafe = dryRunOutput.includes('CHECKOUT_ENABLED') &&
        dryRunOutput.includes('false') &&
        !target.customDomains.some((domain) => dryRunOutput.includes(domain));

    executionChecks.push({
        status: dryRunIsSafe ? 'ok' : 'failed',
        name: 'phase1_dry_run_guard_before_write',
        message: dryRunIsSafe
            ? 'Immediate dry-run still shows checkout disabled and no custom-domain attachment before the approved deploy.'
            : 'Immediate dry-run does not prove checkout-off and no-domain-attachment posture; deploy command was not run.',
        details: dryRunIsSafe
            ? [`capture=${dryRunCapture?.path ?? 'missing'}`]
            : [
                `capture=${dryRunCapture?.path ?? 'missing'}`,
                'required=CHECKOUT_ENABLED false and no espanolhonesto.com/www mention',
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

    return executionChecks;
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
        ...fulfillmentSecretNames.filter((name) => !process.env[name]?.trim()),
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
            ...Object.fromEntries(fulfillmentSecretNames.map((name) => [name, process.env[name]?.trim() ?? ''])),
            PUBLIC_APP_ENV: 'production', SUPABASE_EXPECTED_PROJECT_REF: 'vkkahxsybhbutszerawz',
            WORKER_IDENTITY: fulfillmentWorker, WORKER_VERSION_ID: expectedVersionId,
            PUBLIC_SITE_URL: 'https://espanolhonesto.com', FULFILLMENT_RUNTIME_MODE: 'bootstrap',
            EMAIL_DELIVERY_MODE: 'disabled', EMAIL_DAILY_RECIPIENT_LIMIT: '0', EMAIL_MONTHLY_RECIPIENT_LIMIT: '0',
            CHECKOUT_ENABLED: 'false', CHECKOUT_ENABLED_OVERRIDE: 'false',
        });
        const attested = attestationResponse.status === 200
            && envelope.workerVersionId === expectedVersionId
            && envelope.workerIdentity === fulfillmentWorker
            && await verifyRuntimeAttestation(envelope, {
                config, nonce, role: 'fulfillment', schema: RUNTIME_ATTESTATION_SCHEMA,
            }, process.env.INTERNAL_JOB_SECRET ?? '');
        proofChecks.push({
            status: attested ? 'ok' : 'failed',
            name: 'fresh_fulfillment_bootstrap_hmac_before_web',
            message: 'Fresh HMAC attestation must bind bootstrap config to the just-listed fulfillment version.',
            details: [`workerVersionMatched=${String(envelope.workerVersionId === expectedVersionId)}`, `proofVerified=${String(attested)}`],
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
        },
        forbiddenScope: forbiddenScopeLines(),
    }, null, 2)}\n`;

    const executionPlan = `${[
        '# Cloudflare Production Worker Phase 1 Execution Plan',
        '',
        'This is a gated runner package for creating/deploying only the production Worker shell. It is not domain approval and it is not secret loading approval.',
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
        '- Required runtime state claim: `CHECKOUT_ENABLED=false`.',
        '',
        '## Evidence To Review First',
        '',
        `- No-write preflight: ${toRelativeOrFallback(report.latestPreflightSummaryPath, 'outputs/launch-cloudflare-production-runtime-cutover-preflight/<timestamp>/summary.md')}`,
        `- Variable matrix: ${toRelativeOrFallback(report.latestVariableMatrixPath, 'outputs/launch-cloudflare-production-runtime-cutover-preflight/<timestamp>/cloudflare-production-worker-variable-matrix.md')}`,
        `- Cutover manifest: ${toRelativeOrFallback(report.latestCutoverManifestPath, 'outputs/launch-cloudflare-production-runtime-cutover/<timestamp>/cloudflare-production-runtime-cutover-manifest.json')}`,
        `- Phase-1 approval request: ${toRelativeOrFallback(report.latestPhaseOneApprovalPath, 'outputs/launch-cloudflare-production-runtime-cutover/<timestamp>/approval-request-phase-1-worker.md')}`,
        `- Fulfillment bootstrap proof: ${toRelativeOrFallback(report.latestFulfillmentBootstrapSummaryPath, 'outputs/launch-cloudflare-production-fulfillment-bootstrap/<timestamp>/summary.md')}`,
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
        '- Stop if dry-run does not show `CHECKOUT_ENABLED=false`.',
        '- Stop if Worker already exists with unknown ownership or unexpected routes.',
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
        '- Build current workspace.',
        '- Run immediate Wrangler production dry-run.',
        '- Deploy only Worker `espanolhonesto` to account `d1a22bcf6477ff2ff31d2bfb83084e44` with `CHECKOUT_ENABLED=false` and `--keep-vars`.',
        '- Verify deployments list and secret names by read-only commands.',
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
        '  --summary "Cloudflare production Worker phase 1 completed: Worker espanolhonesto exists in the intended Cloudflare account with checkout disabled; domains remain on Pages until later approval."',
        `  --environment "Cloudflare account ${report.target.accountId}; Worker ${report.target.productionWorker}; phase 1 only; domains not moved"`,
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
    cutoverPreflight: CommandSpec;
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
        cutoverPreflight: {
            id: 'cloudflare-production-runtime-cutover-preflight',
            display: 'corepack pnpm --config.verify-deps-before-run=false launch:cloudflare-production-runtime-cutover-preflight',
            bin: 'corepack',
            args: ['pnpm', '--config.verify-deps-before-run=false', 'launch:cloudflare-production-runtime-cutover-preflight'],
            timeoutMs: 240000,
            writesCloudflare: false,
        },
        build: {
            id: 'pnpm-build',
            display: 'corepack pnpm --config.verify-deps-before-run=false run build:production:release',
            bin: 'corepack',
            args: ['pnpm', '--config.verify-deps-before-run=false', 'run', 'build:production:release'],
            timeoutMs: 240000,
            writesCloudflare: false,
        },
        deployDryRun: {
            id: 'wrangler-deploy-production-dry-run',
            display: 'corepack pnpm --config.verify-deps-before-run=false exec wrangler deploy --config dist/server/wrangler.json --dry-run',
            bin: 'corepack',
            args: ['pnpm', '--config.verify-deps-before-run=false', 'exec', 'wrangler', 'deploy', '--config', 'dist/server/wrangler.json', '--dry-run'],
            timeoutMs: 180000,
            writesCloudflare: false,
        },
        deployKeepVars: {
            id: 'wrangler-deploy-production-keep-vars',
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
        'No Stripe live mode, real checkout session or real payment.',
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
