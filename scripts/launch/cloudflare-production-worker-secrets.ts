import * as dotenv from 'dotenv';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

type CheckStatus = 'ok' | 'warning' | 'failed';
type ReportStatus = 'OK' | 'WARNING' | 'FAILED';
type ClosureStatus = 'PLAN_ONLY_READY' | 'EXECUTED_AND_NEEDS_REVIEW' | 'BLOCKED_BY_GATE_OR_ARTIFACTS';

interface Check {
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

interface ProbeCapture {
    id: string;
    url: string;
    status: CheckStatus;
    httpStatus: number | null;
    bytes: number;
    path: string;
}

interface ExecutionEnv {
    approvalSentence: string;
    secretValues: Record<string, string>;
    directWorkerUrl: string | null;
}

interface CloudflareTarget {
    accountId: string;
    accountLabel: string;
    productionWorker: string;
    pagesProject: string;
    customDomains: string[];
}

interface RunnerReport {
    schemaVersion: 1;
    startedAt: string;
    endedAt: string;
    status: ReportStatus;
    closureStatus: ClosureStatus;
    outputDir: string;
    target: CloudflareTarget;
    approvalEnvVar: string;
    executeRequested: boolean;
    approvalMatched: boolean;
    externalWritePerformed: boolean;
    requiredSecretNames: string[];
    directWorkerUrlEnvVar: string;
    latestRuntimeReadonlyPath: string | null;
    latestPreflightSummaryPath: string | null;
    latestVariableMatrixPath: string | null;
    latestCutoverManifestPath: string | null;
    latestSecretsApprovalPath: string | null;
    latestPhaseOneRunnerPath: string | null;
    checks: Check[];
    captures: CommandCapture[];
    probes: ProbeCapture[];
    commandManifestPath: string;
    executionPlanPath: string;
    approvalGatePath: string;
    rollbackAfterSecretsPath: string;
    manualEvidenceAfterSecretsPath: string;
    summaryPath: string;
}

interface RenderedArtifacts {
    commandManifest: string;
    executionPlan: string;
    approvalGate: string;
    rollbackAfterSecrets: string;
    manualEvidenceAfterSecrets: string;
    summary: string;
}

const target: CloudflareTarget = {
    accountId: 'd1a22bcf6477ff2ff31d2bfb83084e44',
    accountLabel: "Alindev95@gmail.com's Account",
    productionWorker: 'espanolhonesto',
    pagesProject: 'espanolhonesto',
    customDomains: ['espanolhonesto.com', 'www.espanolhonesto.com'],
};

const approvalEnvVar = 'CLOUDFLARE_WORKER_SECRETS_APPROVAL';
const directWorkerUrlEnvVar = 'CLOUDFLARE_WORKER_DIRECT_URL';
const exactApprovalSentence = 'Apruebo configurar/verificar solo por nombre los secrets/vars necesarios del Cloudflare Worker production `espanolhonesto` en la cuenta `d1a22bcf6477ff2ff31d2bfb83084e44`, y los del Fulfillment Worker production solo si forman parte de la misma ventana final, usando valores desde el origen seguro aprobado, sin imprimir valores, sin guardar valores en outputs, con `CHECKOUT_ENABLED=false`, sin mover dominios, sin borrar Pages, sin cambiar DNS y sin activar pagos reales.';
const executeRequested = process.argv.includes('--execute-approved');

const requiredSecretNames = [
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

const modernProbeRoutes = [
    '/',
    '/es',
    '/en',
    '/ru',
    '/robots.txt',
    '/sitemap-index.xml',
    '/sitemap-0.xml',
    '/llms.txt',
];

const startedAt = new Date();
const outputDir = path.join(process.cwd(), 'outputs', 'launch-cloudflare-production-worker-secrets', stamp(startedAt));
mkdirSync(outputDir, { recursive: true });

const latestRuntimeReadonlyPath = latestGeneratedPath('launch-cloudflare-production-runtime-readonly', 'summary.md');
const latestPreflightSummaryPath = latestGeneratedPath('launch-cloudflare-production-runtime-cutover-preflight', 'summary.md');
const latestVariableMatrixPath = latestGeneratedPath('launch-cloudflare-production-runtime-cutover-preflight', 'cloudflare-production-worker-variable-matrix.md');
const latestCutoverManifestPath = latestGeneratedPath('launch-cloudflare-production-runtime-cutover', 'cloudflare-production-runtime-cutover-manifest.json');
const latestSecretsApprovalPath = latestGeneratedPath('launch-cloudflare-production-runtime-cutover', 'approval-request-worker-secrets.md');
const latestPhaseOneRunnerPath = latestGeneratedPath('launch-cloudflare-production-worker-phase1', 'summary.md');

const captures: CommandCapture[] = [];
const probes: ProbeCapture[] = [];
const checks: Check[] = [
    validatePackageScript(),
    validateLatestRuntimeReadonlyEvidence(),
    validateLatestNoWritePreflight(),
    validateLatestCutoverPack(),
    validateLatestPhaseOneRunner(),
    validateWranglerConfig(),
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
            const executionChecks = await runApprovedExecution(env.value, captures, probes);
            approvalMatched = executionChecks.some((check) => check.name === 'exact_approval_gate' && check.status === 'ok');
            checks.push(...executionChecks);
        }
    } else {
        checks.push({
            status: 'ok',
            name: 'plan_mode_no_external_write',
            message: 'Plan mode generated the Cloudflare Worker secret-name/direct-probe runner package without calling Cloudflare or writing secrets.',
            details: [
                'executeRequested=false',
                'externalWritePerformed=false',
                `futureGate=${approvalEnvVar}`,
                'futureFlag=--execute-approved',
            ],
        });
    }

    let report = createReport(checks, captures, probes);
    let rendered = renderArtifacts(report);
    checks.push(validateGeneratedArtifactPosture(rendered));
    report = createReport(checks, captures, probes);
    rendered = renderArtifacts(report);

    writeFileSync(report.commandManifestPath, rendered.commandManifest, 'utf8');
    writeFileSync(report.executionPlanPath, rendered.executionPlan, 'utf8');
    writeFileSync(report.approvalGatePath, rendered.approvalGate, 'utf8');
    writeFileSync(report.rollbackAfterSecretsPath, rendered.rollbackAfterSecrets, 'utf8');
    writeFileSync(report.manualEvidenceAfterSecretsPath, rendered.manualEvidenceAfterSecrets, 'utf8');
    writeFileSync(path.join(outputDir, 'summary.json'), JSON.stringify(report, null, 2), 'utf8');
    writeFileSync(report.summaryPath, rendered.summary, 'utf8');

    const failed = report.checks.filter((check) => check.status === 'failed');
    const warnings = report.checks.filter((check) => check.status === 'warning');

    console.log(`[launch:cloudflare-production-worker-secrets] Status: ${report.status}`);
    console.log(`[launch:cloudflare-production-worker-secrets] Closure: ${report.closureStatus}`);
    console.log(`[launch:cloudflare-production-worker-secrets] Failed: ${failed.length}`);
    console.log(`[launch:cloudflare-production-worker-secrets] Warnings: ${warnings.length}`);
    console.log(`[launch:cloudflare-production-worker-secrets] External write performed: ${report.externalWritePerformed}`);
    console.log(`[launch:cloudflare-production-worker-secrets] Summary: ${report.summaryPath}`);
    console.log(`[launch:cloudflare-production-worker-secrets] Execution plan: ${report.executionPlanPath}`);
    console.log(`[launch:cloudflare-production-worker-secrets] Approval gate: ${report.approvalGatePath}`);
    console.log(`[launch:cloudflare-production-worker-secrets] Rollback: ${report.rollbackAfterSecretsPath}`);

    if (failed.length > 0) process.exit(1);
}

function createReport(reportChecks: Check[], reportCaptures: CommandCapture[], reportProbes: ProbeCapture[]): RunnerReport {
    const reportStatus = statusFor(reportChecks);
    const externalWritePerformed = reportCaptures.some((capture) => capture.writesCloudflare && capture.status === 'ok');

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
        target,
        approvalEnvVar,
        executeRequested,
        approvalMatched,
        externalWritePerformed,
        requiredSecretNames,
        directWorkerUrlEnvVar,
        latestRuntimeReadonlyPath,
        latestPreflightSummaryPath,
        latestVariableMatrixPath,
        latestCutoverManifestPath,
        latestSecretsApprovalPath,
        latestPhaseOneRunnerPath,
        checks: reportChecks,
        captures: reportCaptures,
        probes: reportProbes,
        commandManifestPath: path.join(outputDir, 'cloudflare-worker-secrets-command-manifest.json'),
        executionPlanPath: path.join(outputDir, 'cloudflare-worker-secrets-execution-plan.md'),
        approvalGatePath: path.join(outputDir, 'approval-gate.md'),
        rollbackAfterSecretsPath: path.join(outputDir, 'rollback-after-worker-secrets.md'),
        manualEvidenceAfterSecretsPath: path.join(outputDir, 'manual-evidence-after-worker-secrets.txt'),
        summaryPath: path.join(outputDir, 'summary.md'),
    };
}

function validatePackageScript(): Check {
    const packageJson = readJsonIfExists<{ packageManager?: string; scripts?: Record<string, string> }>('package.json');
    const missing: string[] = [];
    if (!packageJson) missing.push('package.json');
    if (packageJson?.packageManager !== 'pnpm@10.33.0') missing.push('packageManager=pnpm@10.33.0');
    if (packageJson?.scripts?.['launch:cloudflare-production-worker-secrets'] !== 'tsx scripts/launch/cloudflare-production-worker-secrets.ts') {
        missing.push('launch:cloudflare-production-worker-secrets=tsx scripts/launch/cloudflare-production-worker-secrets.ts');
    }

    return {
        status: missing.length === 0 ? 'ok' : 'failed',
        name: 'package_script_cloudflare_worker_secrets',
        message: missing.length === 0
            ? 'Package scripts expose the gated Cloudflare production Worker secret-name runner and preserve pnpm policy.'
            : 'Package scripts are missing the gated Cloudflare production Worker secret-name runner or pnpm package manager contract.',
        details: missing.length === 0 ? ['launch:cloudflare-production-worker-secrets'] : missing.map((item) => `missing=${item}`),
    };
}

function validateLatestRuntimeReadonlyEvidence(): Check {
    if (!latestRuntimeReadonlyPath || !existsSync(latestRuntimeReadonlyPath)) {
        return {
            status: 'warning',
            name: 'latest_runtime_readonly_evidence_exists',
            message: 'Fresh Cloudflare runtime read-only evidence is missing; run it before executing the secret-name phase.',
            details: ['run=corepack pnpm --config.verify-deps-before-run=false launch:cloudflare-production-runtime-readonly'],
        };
    }

    const summary = readFileSync(latestRuntimeReadonlyPath, 'utf8');
    const required = [
        'Cloudflare Production Runtime Read-Only Evidence',
        target.accountId,
        target.productionWorker,
        'production_worker_secret_names',
        'This command uses Wrangler read/list/version commands only',
    ];
    const missing = required.filter((snippet) => !summary.includes(snippet));

    return {
        status: missing.length === 0 ? 'ok' : 'failed',
        name: 'latest_runtime_readonly_evidence_exists',
        message: missing.length === 0
            ? 'Latest Cloudflare runtime read-only evidence is available for account, Worker and secret-name posture.'
            : 'Latest Cloudflare runtime read-only evidence is missing required facts.',
        details: missing.length === 0 ? [`path=${latestRuntimeReadonlyPath}`] : missing.map((snippet) => `missing=${snippet}`),
    };
}

function validateLatestNoWritePreflight(): Check {
    if (!latestPreflightSummaryPath || !existsSync(latestPreflightSummaryPath)) {
        return {
            status: 'failed',
            name: 'latest_no_write_preflight_exists',
            message: 'The Cloudflare runtime cutover preflight must exist before the secret-name runner can be used.',
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
        'Dry-run avoids custom domains: True',
        'Variable matrix:',
        'wrangler deploy --env production --dry-run',
    ];
    const missing = required.filter((snippet) => !preflight.includes(snippet));
    const matrixMissing = !latestVariableMatrixPath || !existsSync(latestVariableMatrixPath);

    return {
        status: missing.length === 0 && !matrixMissing ? 'ok' : 'failed',
        name: 'latest_no_write_preflight_exists',
        message: missing.length === 0 && !matrixMissing
            ? 'Latest no-write preflight and variable matrix are available before secret-name execution.'
            : 'Latest no-write preflight is missing required safety facts for the secret-name phase.',
        details: missing.length === 0 && !matrixMissing
            ? [`preflight=${latestPreflightSummaryPath}`, `variableMatrix=${latestVariableMatrixPath}`]
            : [
                ...missing.map((snippet) => `missing=${snippet}`),
                ...(matrixMissing ? ['missing=cloudflare-production-worker-variable-matrix.md'] : []),
            ],
    };
}

function validateLatestCutoverPack(): Check {
    if (!latestCutoverManifestPath || !existsSync(latestCutoverManifestPath) || !latestSecretsApprovalPath || !existsSync(latestSecretsApprovalPath)) {
        return {
            status: 'failed',
            name: 'latest_cutover_pack_exists',
            message: 'The Cloudflare cutover package and Worker-secrets approval request must exist before this runner can be used.',
            details: ['run=corepack pnpm --config.verify-deps-before-run=false launch:cloudflare-production-runtime-cutover'],
        };
    }

    const approval = readFileSync(latestSecretsApprovalPath, 'utf8');
    const required = [
        '# Cloudflare Worker Secrets Approval Request',
        exactApprovalSentence,
        'secret names only',
        'Values must come from the approved secure source',
        'corepack pnpm --config.verify-deps-before-run=false exec wrangler secret put SECRET_NAME --env production',
        'No printing, logging, screenshotting or committing secret values.',
        'No domain move',
    ];
    const missing = required.filter((snippet) => !approval.includes(snippet));

    return {
        status: missing.length === 0 ? 'ok' : 'failed',
        name: 'latest_cutover_pack_exists',
        message: missing.length === 0
            ? 'Latest cutover package contains the Worker secret-name approval text and forbidden scope.'
            : 'Latest cutover package is missing required Worker secret-name approval facts.',
        details: missing.length === 0
            ? [`manifest=${latestCutoverManifestPath}`, `approval=${latestSecretsApprovalPath}`]
            : missing.map((snippet) => `missing=${snippet}`),
    };
}

function validateLatestPhaseOneRunner(): Check {
    if (!latestPhaseOneRunnerPath || !existsSync(latestPhaseOneRunnerPath)) {
        return {
            status: 'warning',
            name: 'latest_phase1_runner_exists',
            message: 'The phase-1 Worker runner has not generated evidence yet; secret loading must wait until the Worker exists.',
            details: ['run=corepack pnpm --config.verify-deps-before-run=false launch:cloudflare-production-worker-phase1'],
        };
    }

    const phaseOne = readFileSync(latestPhaseOneRunnerPath, 'utf8');
    const required = [
        'Cloudflare Production Worker Phase 1 Summary',
        'PLAN_ONLY_READY',
        'externalWritePerformed=false',
        target.productionWorker,
    ];
    const missing = required.filter((snippet) => !phaseOne.includes(snippet));

    return {
        status: missing.length === 0 ? 'ok' : 'warning',
        name: 'latest_phase1_runner_exists',
        message: missing.length === 0
            ? 'Phase-1 runner evidence exists; this secrets runner remains a later gated phase until Worker creation executes.'
            : 'Phase-1 runner evidence exists but does not show the expected plan-mode gate facts.',
        details: missing.length === 0 ? [`path=${latestPhaseOneRunnerPath}`] : missing.map((snippet) => `missing=${snippet}`),
    };
}

function validateWranglerConfig(): Check {
    const wranglerPath = 'wrangler.toml';
    if (!existsSync(wranglerPath)) {
        return {
            status: 'failed',
            name: 'wrangler_secret_phase_config',
            message: 'wrangler.toml is missing.',
            details: [wranglerPath],
        };
    }

    const wrangler = readFileSync(wranglerPath, 'utf8');
    const required = [
        'keep_vars = true',
        '[env.production]',
        'name = "espanolhonesto"',
        'CHECKOUT_ENABLED = "false"',
    ];
    const missing = required.filter((snippet) => !wrangler.includes(snippet));

    return {
        status: missing.length === 0 ? 'ok' : 'failed',
        name: 'wrangler_secret_phase_config',
        message: missing.length === 0
            ? 'Wrangler production env exists and keeps checkout fail-closed while secrets are loaded by name.'
            : 'Wrangler config is missing required production/fail-closed posture.',
        details: missing.length === 0 ? [wranglerPath] : missing.map((snippet) => `missing=${snippet}`),
    };
}

function validateApprovalGateSource(): Check {
    const sourcePath = path.join('scripts', 'launch', 'cloudflare-production-worker-secrets.ts');
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
        directWorkerUrlEnvVar,
        '--execute-approved',
        'const exactApprovalSentence =',
        'executeRequested',
        'externalWritePerformed=false',
        'wrangler secret put',
        'corepack pnpm --config.verify-deps-before-run=false exec wrangler secret list --env production --format json',
        'corepack pnpm --config.verify-deps-before-run=false exec wrangler deployments list --name espanolhonesto --json',
        'secretValues',
        'sanitizeOutput',
    ];
    const missing = required.filter((snippet) => !source.includes(snippet));

    return {
        status: missing.length === 0 ? 'ok' : 'failed',
        name: 'approval_gate_source',
        message: missing.length === 0
            ? 'Runner source contains exact approval, secret-name commandization, direct-probe support and output sanitization.'
            : 'Runner source is missing required approval gate or commandized execution facts.',
        details: missing.length === 0 ? [sourcePath] : missing.map((snippet) => `missing=${snippet}`),
    };
}

function validateForbiddenScopeSource(): Check {
    const sourcePath = path.join('scripts', 'launch', 'cloudflare-production-worker-secrets.ts');
    const source = readIfExists(sourcePath) ?? '';
    const required = [
        'No domain move',
        'No DNS change',
        'No Pages deletion',
        'No route change',
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
        'CHECKOUT_ENABLED=true',
    ];
    const commandText = Object.values(buildStaticCommands()).map((command) => command.display).join('\n');
    const presentForbidden = forbiddenCommandSnippets.filter((snippet) => commandText.includes(snippet));

    return {
        status: missing.length === 0 && presentForbidden.length === 0 ? 'ok' : 'failed',
        name: 'forbidden_scope_source',
        message: missing.length === 0 && presentForbidden.length === 0
            ? 'Runner source keeps the phase limited to Worker secret-name loading plus read-only direct probes.'
            : 'Runner source is missing forbidden-scope wording or contains a forbidden command snippet.',
        details: [
            ...missing.map((snippet) => `missing=${snippet}`),
            ...presentForbidden.map((snippet) => `forbidden=${snippet}`),
        ],
    };
}

function validateExecutionEnv(): { check: Check; value: ExecutionEnv | null } {
    const approvalSentence = process.env[approvalEnvVar]?.trim() ?? '';
    const missingNames = requiredSecretNames.filter((name) => !secretValueFor(name));
    const placeholderNames = requiredSecretNames.filter((name) => isPlaceholderValue(secretValueFor(name) ?? ''));
    approvalMatched = approvalSentence === exactApprovalSentence;

    if (!approvalMatched || missingNames.length > 0 || placeholderNames.length > 0) {
        return {
            check: {
                status: 'failed',
                name: 'execution_environment_gate',
                message: 'Execution was requested but approval or required secret-name source values are missing, so no Cloudflare write can run.',
                details: [
                    `approvalMatched=${String(approvalMatched)}`,
                    `missingNames=${missingNames.join(', ') || 'none'}`,
                    `placeholderNames=${placeholderNames.join(', ') || 'none'}`,
                    'externalWritePerformed=false',
                ],
            },
            value: null,
        };
    }

    return {
        check: {
            status: 'ok',
            name: 'execution_environment_gate',
            message: 'Exact approval matched and every required Worker secret/var name has a source value available without printing values.',
            details: [
                `approvalEnv=${approvalEnvVar}`,
                `secretNameCount=${requiredSecretNames.length}`,
                `directWorkerUrl=${process.env[directWorkerUrlEnvVar] ? 'provided' : 'not_provided'}`,
            ],
        },
        value: {
            approvalSentence,
            secretValues: Object.fromEntries(requiredSecretNames.map((name) => [name, secretValueFor(name) ?? ''])),
            directWorkerUrl: normalizeDirectWorkerUrl(process.env[directWorkerUrlEnvVar]),
        },
    };
}

async function runApprovedExecution(
    env: ExecutionEnv,
    reportCaptures: CommandCapture[],
    reportProbes: ProbeCapture[]
): Promise<Check[]> {
    const executionChecks: Check[] = [];

    executionChecks.push({
        status: 'ok',
        name: 'exact_approval_gate',
        message: 'Exact approval sentence matched; running only Worker secret-name commands and optional read-only direct probes.',
        details: [
            `env=${approvalEnvVar}`,
            `targetAccount=${target.accountId}`,
            `targetWorker=${target.productionWorker}`,
            `secretNameCount=${requiredSecretNames.length}`,
        ],
    });

    const staticCommands = buildStaticCommands();
    for (const command of [staticCommands.deploymentsList, staticCommands.secretListBefore]) {
        const capture = runCommand(command);
        reportCaptures.push(capture);
        executionChecks.push(checkForCapture(capture));
        if (capture.status === 'failed') return executionChecks;
    }

    for (const name of requiredSecretNames) {
        const command = buildSecretPutCommand(name);
        const capture = runCommand(command, `${env.secretValues[name]}\n`);
        reportCaptures.push(capture);
        executionChecks.push(checkForCapture(capture));
        if (capture.status === 'failed') return executionChecks;
    }

    const afterCapture = runCommand(staticCommands.secretListAfter);
    reportCaptures.push(afterCapture);
    executionChecks.push(checkForCapture(afterCapture));
    if (afterCapture.status === 'failed') return executionChecks;

    const listedNames = extractSecretNames(readIfExists(afterCapture.path) ?? '');
    const missingAfter = requiredSecretNames.filter((name) => !listedNames.has(name));
    executionChecks.push({
        status: missingAfter.length === 0 ? 'ok' : 'failed',
        name: 'required_secret_names_present_after_write',
        message: missingAfter.length === 0
            ? 'Post-write Cloudflare secret list includes every required Worker secret/var name.'
            : 'Post-write Cloudflare secret list is missing one or more required names.',
        details: missingAfter.length === 0
            ? [`nameCount=${requiredSecretNames.length}`]
            : missingAfter.map((name) => `missingName=${name}`),
    });
    if (missingAfter.length > 0) return executionChecks;

    if (!env.directWorkerUrl) {
        executionChecks.push({
            status: 'warning',
            name: 'direct_worker_probe_deferred',
            message: 'Secrets were loaded by name, but direct Worker URL probe was deferred because CLOUDFLARE_WORKER_DIRECT_URL was not provided.',
            details: [
                `env=${directWorkerUrlEnvVar}`,
                'requiredLater=probe direct Worker URL before domain move or final smoke',
            ],
        });
        return executionChecks;
    }

    const probeChecks = await runDirectWorkerProbes(env.directWorkerUrl, reportProbes);
    executionChecks.push(...probeChecks);
    return executionChecks;
}

async function runDirectWorkerProbes(baseUrl: string, reportProbes: ProbeCapture[]): Promise<Check[]> {
    const probeChecks: Check[] = [];

    for (const route of modernProbeRoutes) {
        const url = new URL(route, baseUrl).toString();
        const id = `direct-worker-probe-${route === '/' ? 'root' : route.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '')}`;
        const started = Date.now();
        let httpStatus: number | null = null;
        let bytes = 0;
        let bodyPreview = '';
        let status: CheckStatus = 'failed';
        let error = 'none';

        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 20000);
            const response = await fetch(url, {
                method: 'GET',
                redirect: 'follow',
                signal: controller.signal,
            });
            clearTimeout(timeout);
            httpStatus = response.status;
            const body = sanitizeOutput(await response.text());
            bytes = Buffer.byteLength(body, 'utf8');
            bodyPreview = body.slice(0, 500);
            status = response.status >= 200 && response.status < 400 && bytes > 40 ? 'ok' : 'failed';
        } catch (caught) {
            error = sanitizeError(caught instanceof Error ? caught : new Error(String(caught)));
        }

        const capturePath = path.join(outputDir, `${id}.txt`);
        writeFileSync(capturePath, [
            `url=${url}`,
            `httpStatus=${httpStatus ?? 'none'}`,
            `bytes=${bytes}`,
            `durationMs=${Date.now() - started}`,
            `error=${error}`,
            '',
            '## sanitized_body_preview',
            '',
            bodyPreview || '(empty)',
            '',
        ].join('\n'), 'utf8');

        const capture: ProbeCapture = {
            id,
            url,
            status,
            httpStatus,
            bytes,
            path: capturePath,
        };
        reportProbes.push(capture);
        probeChecks.push({
            status,
            name: id,
            message: status === 'ok'
                ? `Direct Worker read-only probe passed for ${route}.`
                : `Direct Worker read-only probe failed for ${route}.`,
            details: [
                `capture=${capturePath}`,
                `httpStatus=${httpStatus ?? 'none'}`,
                `bytes=${bytes}`,
            ],
        });
    }

    return probeChecks;
}

function runCommand(command: CommandSpec, input?: string): CommandCapture {
    const result = spawnSync(command.bin, command.args, {
        cwd: process.cwd(),
        encoding: 'utf8',
        input,
        timeout: command.timeoutMs,
        windowsHide: true,
        env: process.env,
    });
    const stdout = sanitizeOutput(result.stdout ?? '');
    const stderr = sanitizeOutput(result.stderr ?? '');
    const exitCode = result.status;
    const timedOut = Boolean(result.error?.message.includes('ETIMEDOUT'));
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

function checkForCapture(capture: CommandCapture): Check {
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

function renderArtifacts(report: RunnerReport): RenderedArtifacts {
    const commands = buildStaticCommands();
    const commandManifest = `${JSON.stringify({
        schemaVersion: 1,
        generatedAt: report.endedAt,
        target: report.target,
        mode: report.executeRequested ? 'execute-approved' : 'plan',
        approvalEnvVar: report.approvalEnvVar,
        approvalMatched: report.approvalMatched,
        externalWritePerformed: report.externalWritePerformed,
        exactApprovalSentence,
        requiredSecretNames: report.requiredSecretNames,
        directWorkerUrlEnvVar: report.directWorkerUrlEnvVar,
        commandShapes: [
            commands.deploymentsList.display,
            commands.secretListBefore.display,
            'corepack pnpm --config.verify-deps-before-run=false exec wrangler secret put SECRET_NAME --env production',
            commands.secretListAfter.display,
        ],
        captures: report.captures.map((capture) => ({
            id: capture.id,
            path: toRelative(capture.path),
            exitCode: capture.exitCode,
            status: capture.status,
            writesCloudflare: capture.writesCloudflare,
        })),
        probes: report.probes.map((probe) => ({
            id: probe.id,
            httpStatus: probe.httpStatus,
            bytes: probe.bytes,
            status: probe.status,
            path: toRelative(probe.path),
        })),
        sourceEvidence: {
            runtimeReadonly: toRelativeOrNull(report.latestRuntimeReadonlyPath),
            noWritePreflight: toRelativeOrNull(report.latestPreflightSummaryPath),
            variableMatrix: toRelativeOrNull(report.latestVariableMatrixPath),
            cutoverManifest: toRelativeOrNull(report.latestCutoverManifestPath),
            secretsApproval: toRelativeOrNull(report.latestSecretsApprovalPath),
            phaseOneRunner: toRelativeOrNull(report.latestPhaseOneRunnerPath),
        },
        forbiddenScope: forbiddenScopeLines(),
    }, null, 2)}\n`;

    const executionPlan = `${[
        '# Cloudflare Production Worker Secrets Execution Plan',
        '',
        'This is a gated runner package for loading and verifying production Worker secret/var names. It is not phase-1 Worker creation approval and it is not domain approval.',
        '',
        '## Current Mode',
        '',
        `- Execute requested: ${String(report.executeRequested)}.`,
        `- Approval matched: ${String(report.approvalMatched)}.`,
        `- External write performed: ${String(report.externalWritePerformed)}.`,
        '',
        '## Target',
        '',
        `- Account: ${report.target.accountLabel} (${report.target.accountId}).`,
        `- Worker: \`${report.target.productionWorker}\`.`,
        `- Existing Pages project that must remain untouched in this phase: \`${report.target.pagesProject}\`.`,
        `- Domains that must not move in this phase: ${report.target.customDomains.map((domain) => `\`${domain}\``).join(', ')}.`,
        '- Required runtime state claim: `CHECKOUT_ENABLED=false` from `wrangler.toml`.',
        '',
        '## Names This Runner Loads',
        '',
        ...report.requiredSecretNames.map((name) => `- \`${name}\``),
        '',
        '## Evidence To Review First',
        '',
        `- Runtime read-only: ${toRelativeOrFallback(report.latestRuntimeReadonlyPath, 'outputs/launch-cloudflare-production-runtime-readonly/<timestamp>/summary.md')}`,
        `- No-write preflight: ${toRelativeOrFallback(report.latestPreflightSummaryPath, 'outputs/launch-cloudflare-production-runtime-cutover-preflight/<timestamp>/summary.md')}`,
        `- Variable matrix: ${toRelativeOrFallback(report.latestVariableMatrixPath, 'outputs/launch-cloudflare-production-runtime-cutover-preflight/<timestamp>/cloudflare-production-worker-variable-matrix.md')}`,
        `- Cutover manifest: ${toRelativeOrFallback(report.latestCutoverManifestPath, 'outputs/launch-cloudflare-production-runtime-cutover/<timestamp>/cloudflare-production-runtime-cutover-manifest.json')}`,
        `- Secret-name approval request: ${toRelativeOrFallback(report.latestSecretsApprovalPath, 'outputs/launch-cloudflare-production-runtime-cutover/<timestamp>/approval-request-worker-secrets.md')}`,
        `- Phase-1 runner summary: ${toRelativeOrFallback(report.latestPhaseOneRunnerPath, 'outputs/launch-cloudflare-production-worker-phase1/<timestamp>/summary.md')}`,
        '',
        '## Commands Encoded In This Runner',
        '',
        '```bash',
        commands.deploymentsList.display,
        commands.secretListBefore.display,
        'corepack pnpm --config.verify-deps-before-run=false exec wrangler secret put SECRET_NAME --env production',
        commands.secretListAfter.display,
        '```',
        '',
        '## How To Execute Later',
        '',
        'Only after the production Worker exists and the exact approval is provided for the exact target/resource/scope:',
        '',
        '```powershell',
        `$env:${approvalEnvVar}='${exactApprovalSentence.replace(/'/g, "''")}'`,
        '# Optional, but required before domain move/final smoke:',
        `$env:${directWorkerUrlEnvVar}='https://<direct-worker-url>'`,
        'corepack pnpm --config.verify-deps-before-run=false launch:cloudflare-production-worker-secrets -- --execute-approved',
        '```',
        '',
        '## Stop Conditions',
        '',
        '- Stop if the production Worker does not exist or belongs to a different account.',
        '- Stop if any required value is missing from the secure env source.',
        '- Stop if any secret value appears in terminal, logs, screenshots, captures or output files.',
        '- Stop if Wrangler asks to attach/move custom domains, change DNS, delete Pages, enable checkout or run Stripe live mode.',
        '- Stop if direct Worker probes are blank, old Pages content, wrong-account content or checkout-enabled output.',
        '',
    ].join('\n')}\n`;

    const approvalGate = `${[
        '# Cloudflare Production Worker Secrets Approval Gate',
        '',
        'This file is not approval. It documents the exact gate required before the secret-name commands can execute.',
        '',
        `- Environment variable: \`${approvalEnvVar}\`.`,
        '- Required flag: `--execute-approved`.',
        `- Optional direct probe env: \`${directWorkerUrlEnvVar}\`.`,
        `- Execute requested in this run: ${String(report.executeRequested)}.`,
        `- Approval matched in this run: ${String(report.approvalMatched)}.`,
        `- External write performed in this run: ${String(report.externalWritePerformed)}.`,
        '',
        '## Exact Approval Sentence',
        '',
        exactApprovalSentence,
        '',
        '## Allowed Scope After Match',
        '',
        '- Verify production Worker deployments list read-only.',
        '- List existing Worker secret names read-only.',
        '- Load only the required Worker secret/var names from the approved secure environment source using Wrangler stdin.',
        '- List Worker secret names again and verify names only.',
        '- Probe the direct Worker URL read-only if `CLOUDFLARE_WORKER_DIRECT_URL` is provided.',
        '',
        '## Forbidden Scope',
        '',
        ...forbiddenScopeLines().map((line) => `- ${line}`),
        '',
    ].join('\n')}\n`;

    const rollbackAfterSecrets = `${[
        '# Cloudflare Production Worker Secrets Rollback',
        '',
        'This rollback plan applies only after the Worker secret-name phase. It does not authorize rollback writes by itself.',
        '',
        '## If Plan Mode Ran Only',
        '',
        '- No rollback is required; this package generated local evidence only.',
        '- Keep `espanolhonesto.com` and `www.espanolhonesto.com` on the existing Pages project.',
        '',
        '## If A Required Name Was Missing Or Wrong',
        '',
        '- Keep domains on Pages.',
        '- Correct only the affected Worker secret/var name under a separate exact approval.',
        '- Rerun this runner and verify names only.',
        '',
        '## If Direct Worker Probe Fails',
        '',
        '- Do not move domains.',
        '- Keep checkout disabled.',
        '- Fix Worker runtime/config, rerun read-only preflight and direct Worker probes before asking for domain approval.',
        '',
        '## If A Domain Was Accidentally Moved Elsewhere',
        '',
        '- Treat this as out of scope for this phase and stop.',
        '- Reattach domains to the previously safe Cloudflare target only under a separate domain rollback approval.',
        '- Do not delete the Pages project during rollback.',
        '',
    ].join('\n')}\n`;

    const manualEvidenceAfterSecrets = `${[
        'corepack pnpm launch:manual-evidence:record --',
        '  --id integration_readiness',
        '  --status pass',
        '  --summary "Cloudflare production Worker secret-name phase completed: required Worker secret/var names are present by name only and direct Worker probes have passed or are separately recorded before domain move."',
        `  --environment "Cloudflare account ${report.target.accountId}; Worker ${report.target.productionWorker}; secret names only; domains not moved"`,
        '  --owner Alin',
        `  --evidence "command_output=../../${toRelative(report.summaryPath)}::Worker secrets runner summary reviewed; replace placeholder after actual approved execution"`,
        `  --evidence "command_output=../../${toRelative(report.commandManifestPath)}::command manifest reviewed; no secret values stored"`,
        `  --evidence "command_output=../../${toRelative(report.approvalGatePath)}::approval gate reviewed for exact target and forbidden scope"`,
        '  --evidence "manual_note=Replace this note with the actual non-secret verification: post-write secret-list capture path and direct Worker URL probe result. Do not include secret values."',
        '',
        '# Add --write only after the approved phase has actually run and the placeholder note is replaced.',
        '',
    ].join(' \\\n')}`;

    return {
        commandManifest,
        executionPlan,
        approvalGate,
        rollbackAfterSecrets,
        manualEvidenceAfterSecrets,
        summary: renderSummary(report),
    };
}

function renderSummary(report: RunnerReport): string {
    const lines = [
        '# Cloudflare Production Worker Secrets Summary',
        '',
        `- Status: ${report.status}`,
        `- Closure: ${report.closureStatus}`,
        `- Generated: ${report.endedAt}`,
        `- Execute requested: ${String(report.executeRequested)}`,
        `- Approval matched: ${String(report.approvalMatched)}`,
        `- External write performed: ${String(report.externalWritePerformed)}`,
        `- Command manifest: ${toRelative(report.commandManifestPath)}`,
        `- Execution plan: ${toRelative(report.executionPlanPath)}`,
        `- Approval gate: ${toRelative(report.approvalGatePath)}`,
        `- Rollback: ${toRelative(report.rollbackAfterSecretsPath)}`,
        `- Manual evidence template: ${toRelative(report.manualEvidenceAfterSecretsPath)}`,
        '',
        'This runner is plan-only unless both the exact approval environment variable and the `--execute-approved` flag are present. In plan mode it does not call Cloudflare, does not deploy, does not move domains, does not change DNS and does not write secrets.',
        '',
        '## Target',
        '',
        `- Account: ${report.target.accountLabel} (${report.target.accountId}).`,
        `- Worker: \`${report.target.productionWorker}\`.`,
        `- Domains not moved in this phase: ${report.target.customDomains.map((domain) => `\`${domain}\``).join(', ')}.`,
        `- Required names: ${report.requiredSecretNames.length}.`,
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

    if (report.probes.length > 0) {
        lines.push(
            '## Direct Worker Probes',
            '',
            '| Status | URL | HTTP | Bytes | Path |',
            '| --- | --- | ---: | ---: | --- |',
            ...report.probes.map((probe) => `| ${probe.status} | ${escapeCell(probe.url)} | ${probe.httpStatus ?? 'none'} | ${probe.bytes} | ${escapeCell(toRelative(probe.path))} |`),
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
        exactApprovalSentence,
        'secret names only',
        'direct Worker',
        'No domain move',
        'No DNS change',
        'No Pages deletion',
        'No secret value printing',
        'corepack pnpm --config.verify-deps-before-run=false exec wrangler secret put SECRET_NAME --env production',
        'corepack pnpm --config.verify-deps-before-run=false exec wrangler secret list --env production --format json',
    ];
    const missing = required.filter((snippet) => !combined.includes(snippet));
    const unsafeSecretSnippets = [
        'sk_live_',
        'sk_test_',
        'whsec_',
        'sb_secret_',
        '-----BEGIN ' + 'PRIVATE KEY-----',
        'AIza',
    ].filter((snippet) => combined.includes(snippet));
    const unsafe = [...unsafeSecretSnippets];

    return {
        status: missing.length === 0 && unsafe.length === 0 ? 'ok' : 'failed',
        name: 'generated_artifact_posture',
        message: missing.length === 0 && unsafe.length === 0
            ? 'Generated Worker secret-name artifacts preserve the approval gate, command scope and no-secret/no-domain-move posture.'
            : 'Generated Worker secret-name artifacts are missing gate/scope facts or include unsafe snippets.',
        details: [
            ...missing.map((snippet) => `missing=${snippet}`),
            ...unsafe.map((snippet) => `unsafe=${snippet}`),
        ],
    };
}

function buildStaticCommands(): Record<string, CommandSpec> & {
    deploymentsList: CommandSpec;
    secretListBefore: CommandSpec;
    secretListAfter: CommandSpec;
} {
    return {
        deploymentsList: {
            id: 'wrangler-deployments-list-production',
            display: 'corepack pnpm --config.verify-deps-before-run=false exec wrangler deployments list --name espanolhonesto --json',
            bin: 'corepack',
            args: ['pnpm', '--config.verify-deps-before-run=false', 'exec', 'wrangler', 'deployments', 'list', '--name', 'espanolhonesto', '--json'],
            timeoutMs: 120000,
            writesCloudflare: false,
        },
        secretListBefore: {
            id: 'wrangler-secret-list-production-before',
            display: 'corepack pnpm --config.verify-deps-before-run=false exec wrangler secret list --env production --format json',
            bin: 'corepack',
            args: ['pnpm', '--config.verify-deps-before-run=false', 'exec', 'wrangler', 'secret', 'list', '--env', 'production', '--format', 'json'],
            timeoutMs: 120000,
            writesCloudflare: false,
        },
        secretListAfter: {
            id: 'wrangler-secret-list-production-after',
            display: 'corepack pnpm --config.verify-deps-before-run=false exec wrangler secret list --env production --format json',
            bin: 'corepack',
            args: ['pnpm', '--config.verify-deps-before-run=false', 'exec', 'wrangler', 'secret', 'list', '--env', 'production', '--format', 'json'],
            timeoutMs: 120000,
            writesCloudflare: false,
        },
    };
}

function buildSecretPutCommand(name: string): CommandSpec {
    return {
        id: `wrangler-secret-put-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
        display: `corepack pnpm --config.verify-deps-before-run=false exec wrangler secret put ${name} --env production`,
        bin: 'corepack',
        args: ['pnpm', '--config.verify-deps-before-run=false', 'exec', 'wrangler', 'secret', 'put', name, '--env', 'production'],
        timeoutMs: 120000,
        writesCloudflare: true,
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
        'No Google service-account key loading into the Astro web Worker; those names stay on the fulfillment Worker boundary.',
    ];
}

function extractSecretNames(captureText: string): Set<string> {
    const names = new Set<string>();
    const jsonMatch = captureText.match(/\[\s*\{[\s\S]*?\}\s*\]/);
    if (jsonMatch) {
        try {
            const parsed = JSON.parse(jsonMatch[0]) as Array<{ name?: string }>;
            for (const item of parsed) {
                if (item.name) names.add(item.name);
            }
        } catch {
            // Fall through to text matching.
        }
    }

    for (const name of requiredSecretNames) {
        if (captureText.includes(name)) names.add(name);
    }
    return names;
}

function secretValueFor(name: string): string | null {
    const value = process.env[name]?.trim();
    if (value) return value;
    if (name === 'EMAIL_FROM') return process.env.RESEND_FROM_EMAIL?.trim() || null;
    if (name === 'RESEND_FROM_EMAIL') return process.env.EMAIL_FROM?.trim() || null;
    return null;
}

function isPlaceholderValue(value: string): boolean {
    const normalized = value.trim().toLowerCase();
    if (!normalized) return false;
    return normalized.includes('replace-me') ||
        normalized.includes('changeme') ||
        normalized.includes('placeholder') ||
        normalized.includes('todo') ||
        normalized === 'your-key-here' ||
        normalized === 'test';
}

function normalizeDirectWorkerUrl(value: string | undefined): string | null {
    const trimmed = value?.trim();
    if (!trimmed) return null;
    try {
        const url = new URL(trimmed);
        if (url.protocol !== 'https:') return null;
        url.pathname = '/';
        url.search = '';
        url.hash = '';
        return url.toString();
    } catch {
        return null;
    }
}

function statusFor(checkList: Check[]): ReportStatus {
    if (checkList.some((check) => check.status === 'failed')) return 'FAILED';
    if (checkList.some((check) => check.status === 'warning')) return 'WARNING';
    return 'OK';
}

function readIfExists(filePath: string): string | null {
    return existsSync(filePath) ? readFileSync(filePath, 'utf8') : null;
}

function readJsonIfExists<T>(filePath: string | null): T | null {
    if (!filePath || !existsSync(filePath)) return null;
    try {
        return JSON.parse(readFileSync(filePath, 'utf8')) as T;
    } catch {
        return null;
    }
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
    const privateKeyPattern = new RegExp(
        '-----BEGIN [A-Z ]+' + 'PRIVATE KEY-----[\\s\\S]*?-----END [A-Z ]+' + 'PRIVATE KEY-----',
        'g'
    );

    return value
        .replace(privateKeyPattern, '[redacted-private-key]')
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
