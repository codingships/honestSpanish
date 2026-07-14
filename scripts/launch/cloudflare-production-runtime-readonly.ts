import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { newestWorkerDeployment } from './cloudflare-deployment-order';
import {
    captureCloudflareProductionSourceIdentity,
    validateCloudflareProductionSourceIdentity,
    type CloudflareProductionSourceIdentity,
} from './cloudflare-production-evidence';
import { PRODUCTION_QUEUE_TARGET, validateProductionQueueConfig } from './cloudflare-production-queue-shared';
import {
    productionBootstrapSecretNames,
    productionBootstrapSecretInventoryErrors,
    productionInertBindingNameErrors,
} from './cloudflare-production-worker-safety';

type CheckStatus = 'ok' | 'warning' | 'failed';

interface Target {
    accountId: string;
    accountLabel: string;
    pagesProject: string;
    productionWorker: string;
    productionFulfillmentWorker: string;
    stagingWorker: string;
    customDomains: string[];
    productionQueue: string;
    productionDeadLetterQueue: string;
}

interface ProbeConfig {
    id: string;
    label: string;
    args: string[];
    expectJson: boolean;
    allowFailure: boolean;
    outputPolicy?: 'sanitized-raw' | 'safe-binding-projection';
}

interface ProbeResult {
    id: string;
    label: string;
    command: string;
    exitCode: number | null;
    status: CheckStatus;
    message: string;
    outputPath: string;
    stdoutSha256: string;
    stderrSha256: string;
    summary: Record<string, unknown>;
}

interface Check {
    status: CheckStatus;
    name: string;
    message: string;
    details: string[];
}

interface Report {
    schemaVersion: 2;
    startedAt: string;
    endedAt: string;
    status: 'OK' | 'WARNING' | 'FAILED';
    outputDir: string;
    target: Target;
    sourceIdentity: CloudflareProductionSourceIdentity;
    apiInventory: ApiInventory;
    probes: ProbeResult[];
    checks: Check[];
    summaryPath: string;
}

type ApiReadOutcome = 'ok' | 'expected-not-ready' | 'token-missing' | 'permission-gap' | 'api-error';

interface ApiReadCapture {
    id: string;
    method: 'GET';
    path: string;
    httpStatus: number | null;
    success: boolean;
    outcome: ApiReadOutcome;
    responseSha256?: string;
}

interface SafeQueueParty {
    type: string;
    worker: string | null;
    settings: Record<string, string | number | boolean>;
}

interface QueueInventorySnapshot {
    name: string;
    id: string | null;
    state: 'ready' | 'expected-not-ready' | 'gap';
    settings: Record<string, string | number | boolean>;
    producers: SafeQueueParty[];
    consumers: SafeQueueParty[];
    backlog: number | null;
    backlogAvailable: boolean;
    gaps: string[];
}

interface FlaggedWorkerScriptSnapshot {
    name: string;
    present: boolean;
    scheduleState: 'ready' | 'expected-not-ready' | 'gap';
    crons: string[];
    subdomainState: 'ready' | 'expected-not-ready' | 'gap';
    workersDevEnabled: boolean | null;
    previewsEnabled: boolean | null;
    invocationSurfaces: {
        state: 'ready' | 'not-applicable' | 'gap';
        customDomains: number;
        workerRoutes: number;
        queueConsumers: number;
        inboundServiceBindings: number;
        inboundTailConsumerReferences: number;
        emailRoutingReferences: number;
    };
    gaps: string[];
}

interface LegacyHeadDeploymentPosture {
    state: 'ready' | 'gap';
    trackedLegacyPackagePaths: string[];
    workingTreePackagePresent: boolean;
    automaticDeployReferences: string[];
    gaps: string[];
}

interface WorkerScriptInventory {
    state: 'ready' | 'gap';
    names: string[];
    flagged: FlaggedWorkerScriptSnapshot[];
    legacyHeadDeployment: LegacyHeadDeploymentPosture;
    gaps: string[];
}

interface ApiInventory {
    tokenAvailable: boolean;
    calls: ApiReadCapture[];
    workerScripts: WorkerScriptInventory;
    fulfillmentSchedules: {
        state: 'ready' | 'expected-not-ready' | 'gap';
        crons: string[];
        gaps: string[];
    };
    queue: QueueInventorySnapshot;
    deadLetterQueue: QueueInventorySnapshot;
    gaps: string[];
}

const target: Target = {
    accountId: 'd1a22bcf6477ff2ff31d2bfb83084e44',
    accountLabel: 'Español Honesto Cloudflare account',
    pagesProject: 'espanolhonesto',
    productionWorker: 'espanolhonesto',
    productionFulfillmentWorker: PRODUCTION_QUEUE_TARGET.worker,
    stagingWorker: 'espanolhonesto-staging',
    customDomains: ['espanolhonesto.com', 'www.espanolhonesto.com'],
    productionQueue: PRODUCTION_QUEUE_TARGET.queue,
    productionDeadLetterQueue: PRODUCTION_QUEUE_TARGET.deadLetterQueue,
};

const legacyReminderWorkerName = 'espanol-honesto-reminders';
const duplicateStagingWorkerName = 'espanolhonesto-staging-staging';
const flaggedLegacyWorkerNames = [
    legacyReminderWorkerName,
    duplicateStagingWorkerName,
] as const;

const requiredProductionWebActiveSecretNames = [
    'PUBLIC_SUPABASE_URL',
    'PUBLIC_SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
    'PUBLIC_STRIPE_PUBLISHABLE_KEY',
    'STRIPE_SECRET_KEY',
    'STRIPE_WEBHOOK_SECRET',
    'STRIPE_EXPECTED_ACCOUNT_ID',
    'STRIPE_PORTAL_CONFIGURATION_ID',
    'PUBLIC_TURNSTILE_SITE_KEY',
    'TURNSTILE_SECRET_KEY',
    'PUBLIC_SENTRY_DSN',
    'FULFILLMENT_WORKER_URL',
    'INTERNAL_JOB_SECRET',
    'CRON_SECRET',
    'LEVEL_CHECK_TOKEN_SECRET',
    'RESEND_API_KEY',
    'EMAIL_FROM',
    'RESEND_FROM_EMAIL',
    'ADMIN_EMAIL',
    'SUPPORT_ALERT_EMAIL',
];

const requiredProductionFulfillmentActiveSecretNames = [
    'PUBLIC_SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'INTERNAL_JOB_SECRET',
    'GOOGLE_SERVICE_ACCOUNT_EMAIL',
    'GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY',
    'GOOGLE_ADMIN_EMAIL',
    'GOOGLE_DRIVE_ROOT_FOLDER_ID',
    'GOOGLE_TEMPLATE_DOC_ID',
    'RESEND_API_KEY',
    'EMAIL_FROM',
    'RESEND_FROM_EMAIL',
];

const safePlainTextBindingValueNames = new Set([
    'NODE_ENV',
    'PUBLIC_APP_ENV',
    'WEB_RUNTIME_MODE',
    'FULFILLMENT_RUNTIME_MODE',
    'WORKER_IDENTITY',
    'CHECKOUT_ENABLED',
    'CHECKOUT_ENABLED_OVERRIDE',
    'EMAIL_DELIVERY_MODE',
    'EMAIL_DAILY_RECIPIENT_LIMIT',
    'EMAIL_MONTHLY_RECIPIENT_LIMIT',
    'SENTRY_ENVIRONMENT',
]);

const safeTargetBindingValueNames = new Set([
    'FULFILLMENT_SERVICE',
    'FULFILLMENT_QUEUE',
]);

const probeConfigs: ProbeConfig[] = [
    {
        id: 'wrangler_version',
        label: 'Wrangler version',
        args: ['--version'],
        expectJson: false,
        allowFailure: false,
    },
    {
        id: 'whoami',
        label: 'Wrangler auth/account',
        args: ['whoami', '--json'],
        expectJson: true,
        allowFailure: false,
    },
    {
        id: 'pages_projects',
        label: 'Cloudflare Pages project list',
        args: ['pages', 'project', 'list', '--json'],
        expectJson: true,
        allowFailure: false,
    },
    {
        id: 'pages_production_deployments',
        label: 'Pages production deployments',
        args: ['pages', 'deployment', 'list', '--project-name', target.pagesProject, '--environment', 'production', '--json'],
        expectJson: true,
        allowFailure: true,
    },
    {
        id: 'pages_preview_deployments',
        label: 'Pages preview deployments',
        args: ['pages', 'deployment', 'list', '--project-name', target.pagesProject, '--environment', 'preview', '--json'],
        expectJson: true,
        allowFailure: true,
    },
    {
        id: 'staging_worker_deployments',
        label: 'Staging Worker deployments',
        args: ['deployments', 'list', '--name', target.stagingWorker, '--json'],
        expectJson: true,
        allowFailure: false,
    },
    {
        id: 'production_worker_deployments',
        label: 'Production Worker deployments',
        args: ['deployments', 'list', '--name', target.productionWorker, '--json'],
        expectJson: true,
        allowFailure: true,
    },
    {
        id: 'production_worker_status',
        label: 'Production web Worker current deployment status',
        args: ['deployments', 'status', '--name', target.productionWorker, '--json'],
        expectJson: true,
        allowFailure: true,
    },
    {
        id: 'production_fulfillment_deployments',
        label: 'Production fulfillment Worker deployments',
        args: ['deployments', 'list', '--name', target.productionFulfillmentWorker, '--json'],
        expectJson: true,
        allowFailure: true,
    },
    {
        id: 'production_fulfillment_status',
        label: 'Production fulfillment Worker current deployment status',
        args: ['deployments', 'status', '--name', target.productionFulfillmentWorker, '--json'],
        expectJson: true,
        allowFailure: true,
    },
    {
        id: 'staging_worker_secrets',
        label: 'Staging Worker secret names',
        args: ['secret', 'list', '--name', target.stagingWorker, '--format', 'json'],
        expectJson: true,
        allowFailure: false,
    },
    {
        id: 'production_worker_secrets',
        label: 'Production Worker secret names',
        args: ['secret', 'list', '--name', target.productionWorker, '--format', 'json'],
        expectJson: true,
        allowFailure: true,
    },
    {
        id: 'production_fulfillment_secrets',
        label: 'Production fulfillment Worker secret names',
        args: ['secret', 'list', '--name', target.productionFulfillmentWorker, '--format', 'json'],
        expectJson: true,
        allowFailure: true,
    },
];

const startedAt = new Date();
const outputDir = path.join(process.cwd(), 'outputs', 'launch-cloudflare-production-runtime-readonly', stamp(startedAt));
mkdirSync(outputDir, { recursive: true });

void main().catch((error: Error) => {
    console.error(`[launch:cloudflare-production-runtime-readonly] ${safeErrorMessage(error)}`);
    process.exitCode = 1;
});

async function main(): Promise<void> {
    const initialProbes = probeConfigs.map(runProbe);
    const probes = [
        ...initialProbes,
        runCurrentVersionBindingProbe(initialProbes, 'production_worker_status', target.productionWorker, 'production_worker_current_version'),
        runCurrentVersionBindingProbe(initialProbes, 'production_fulfillment_status', target.productionFulfillmentWorker, 'production_fulfillment_current_version'),
    ];
    const sourceIdentity = captureCloudflareProductionSourceIdentity();
    const apiInventory = await captureApiInventory();
    writeFileSync(path.join(outputDir, 'cloudflare_api_gets.json'), `${JSON.stringify(apiInventory.calls, null, 2)}\n`, 'utf8');

    const checks = buildChecks(probes, sourceIdentity, apiInventory);
    const failed = checks.filter((check) => check.status === 'failed');
    const warnings = checks.filter((check) => check.status === 'warning');
    const status: Report['status'] = failed.length > 0 ? 'FAILED' : warnings.length > 0 ? 'WARNING' : 'OK';
    const report: Report = {
        schemaVersion: 2,
        startedAt: startedAt.toISOString(),
        endedAt: new Date().toISOString(),
        status,
        outputDir,
        target,
        sourceIdentity,
        apiInventory,
        probes,
        checks,
        summaryPath: path.join(outputDir, 'summary.md'),
    };

    writeFileSync(path.join(outputDir, 'summary.json'), JSON.stringify(renderJsonReport(report), null, 2), 'utf8');
    writeFileSync(report.summaryPath, renderMarkdown(report), 'utf8');

    console.log(`[launch:cloudflare-production-runtime-readonly] Status: ${status}`);
    console.log(`[launch:cloudflare-production-runtime-readonly] Failed: ${failed.length}`);
    console.log(`[launch:cloudflare-production-runtime-readonly] Warnings: ${warnings.length}`);
    console.log(`[launch:cloudflare-production-runtime-readonly] Summary: ${report.summaryPath}`);

    if (failed.length > 0) process.exitCode = 1;
}

function runProbe(config: ProbeConfig): ProbeResult {
    if (!isAllowlistedWranglerRead(config.args)) {
        throw new Error(`Wrangler read scope rejected for probe ${config.id}.`);
    }
    const outputPath = path.join(outputDir, `${config.id}.txt`);
    const result = spawnSync(pnpmCommand(), [
        '--config.verify-deps-before-run=false',
        'exec',
        'wrangler',
        ...config.args,
        '--install-skills=false',
    ], {
        env: {
            ...process.env,
            CLOUDFLARE_ACCOUNT_ID: target.accountId,
            CI: 'true',
            WRANGLER_SEND_METRICS: 'false',
        },
        encoding: 'utf8',
        timeout: 45_000,
        windowsHide: true,
        shell: process.platform === 'win32',
    });

    const stdout = sanitizeOutput(typeof result.stdout === 'string' ? result.stdout : String(result.stdout ?? ''));
    const stderr = sanitizeOutput(typeof result.stderr === 'string' ? result.stderr : String(result.stderr ?? ''));
    const exitCode = typeof result.status === 'number' ? result.status : null;
    const parsedJson = config.expectJson ? parseJsonFromWrangler(stdout) : null;
    const command = `pnpm --config.verify-deps-before-run=false exec wrangler ${config.args.join(' ')} --install-skills=false`;
    const parseFailed = config.expectJson && exitCode === 0 && parsedJson === null;
    const unexpectedFailure = exitCode !== 0 && !config.allowFailure;
    const statusForProbe: CheckStatus = unexpectedFailure || parseFailed || result.error ? 'failed' : exitCode === 0 ? 'ok' : 'warning';
    const message = probeMessage(config, exitCode, parsedJson, stderr, result.error);
    const summary = summarizeProbe(config.id, parsedJson, stdout, stderr, exitCode);
    const persistedStdout = config.outputPolicy === 'safe-binding-projection'
        ? JSON.stringify(summary, null, 2)
        : stdout;

    writeFileSync(outputPath, [
        `# ${config.label}`,
        '',
        `command=${command}`,
        `exitCode=${exitCode ?? 'unknown'}`,
        `status=${statusForProbe}`,
        '',
        config.outputPolicy === 'safe-binding-projection' ? '# safe binding projection' : '# stdout',
        persistedStdout,
        '',
        '# stderr',
        stderr,
        '',
    ].join('\n'), 'utf8');

    return {
        id: config.id,
        label: config.label,
        command,
        exitCode,
        status: statusForProbe,
        message,
        outputPath,
        stdoutSha256: sha256(persistedStdout),
        stderrSha256: sha256(stderr),
        summary,
    };
}

function runCurrentVersionBindingProbe(
    results: ProbeResult[],
    statusProbeId: string,
    worker: string,
    id: string,
): ProbeResult {
    const status = probe(results, statusProbeId).summary as { primaryVersionId?: string };
    const versionId = status.primaryVersionId;
    if (!versionId) return skippedVersionBindingProbe(id, worker);
    return runProbe({
        id,
        label: `${worker} current version binding inventory`,
        args: ['versions', 'view', versionId, '--name', worker, '--json'],
        expectJson: true,
        allowFailure: true,
        outputPolicy: 'safe-binding-projection',
    });
}

function skippedVersionBindingProbe(id: string, worker: string): ProbeResult {
    const outputPath = path.join(outputDir, `${id}.txt`);
    const summary = {
        state: 'expected-not-ready',
        worker,
        reason: 'No current production version was visible, so no version metadata was requested.',
        bindingNames: [],
        bindings: [],
        safeValues: {},
    };
    const persisted = JSON.stringify(summary, null, 2);
    writeFileSync(outputPath, [
        `# ${worker} current version binding inventory`,
        '',
        'command=not-run',
        'exitCode=not-applicable',
        'status=warning',
        '',
        '# safe binding projection',
        persisted,
        '',
    ].join('\n'), 'utf8');
    return {
        id,
        label: `${worker} current version binding inventory`,
        command: 'not-run: current production version unavailable',
        exitCode: null,
        status: 'warning',
        message: 'Expected-not-ready: current production version unavailable.',
        outputPath,
        stdoutSha256: sha256(persisted),
        stderrSha256: sha256(''),
        summary,
    };
}

function captureLegacyHeadDeploymentPosture(): LegacyHeadDeploymentPosture {
    const gaps: string[] = [];
    const tree = spawnSync('git', ['ls-tree', '-r', '--name-only', 'HEAD'], {
        cwd: process.cwd(),
        encoding: 'utf8',
        timeout: 10_000,
        windowsHide: true,
    });
    const trackedPaths = tree.status === 0
        ? stringValue(tree.stdout).split(/\r?\n/u).map((value) => toPosix(value.trim())).filter(Boolean)
        : [];
    if (tree.status !== 0) gaps.push('git-head-tree-unavailable');

    const trackedLegacyPackagePaths = trackedPaths
        .filter((filePath) => filePath === 'workers/reminder-cron' || filePath.startsWith('workers/reminder-cron/'))
        .sort();
    const workingTreePackagePresent = existsSync(path.join(process.cwd(), 'workers', 'reminder-cron'));

    const deploymentSurfaceFiles = trackedPaths.filter((filePath) =>
        ['package.json', 'pnpm-workspace.yaml', 'wrangler.toml'].includes(filePath)
        || /^\.github\/workflows\/[^/]+\.ya?ml$/iu.test(filePath)
        || /^workers\/.+\/(?:package\.json|wrangler\.(?:toml|jsonc?|ya?ml))$/iu.test(filePath)
        || /^scripts\/dev\/.+\.(?:[cm]?[jt]s|json|ya?ml)$/iu.test(filePath));
    const automaticDeployReferences: string[] = [];
    for (const filePath of deploymentSurfaceFiles.sort()) {
        const content = spawnSync('git', ['show', `HEAD:${filePath}`], {
            cwd: process.cwd(),
            encoding: 'utf8',
            timeout: 10_000,
            windowsHide: true,
        });
        if (content.status !== 0) {
            gaps.push(`head-deployment-surface-unreadable:${filePath}`);
            continue;
        }
        const value = stringValue(content.stdout);
        if (value.includes(legacyReminderWorkerName) || value.includes('workers/reminder-cron')) {
            automaticDeployReferences.push(filePath);
        }
    }

    const state: LegacyHeadDeploymentPosture['state'] = gaps.length === 0
        && trackedLegacyPackagePaths.length === 0
        && !workingTreePackagePresent
        && automaticDeployReferences.length === 0
        ? 'ready'
        : 'gap';
    return {
        state,
        trackedLegacyPackagePaths,
        workingTreePackagePresent,
        automaticDeployReferences,
        gaps,
    };
}

interface ApiGetResult {
    ok: boolean;
    outcome: ApiReadOutcome;
    payload: Record<string, unknown>;
}

async function captureApiInventory(): Promise<ApiInventory> {
    const calls: ApiReadCapture[] = [];
    const token = process.env.CLOUDFLARE_API_TOKEN?.trim() ?? '';
    const legacyHeadDeployment = captureLegacyHeadDeploymentPosture();
    const emptyQueue = (name: string): QueueInventorySnapshot => ({
        name,
        id: null,
        state: 'expected-not-ready',
        settings: {},
        producers: [],
        consumers: [],
        backlog: null,
        backlogAvailable: false,
        gaps: [],
    });
    const inventory: ApiInventory = {
        tokenAvailable: Boolean(token),
        calls,
        workerScripts: {
            state: 'gap',
            names: [],
            flagged: flaggedLegacyWorkerNames.map((name) => emptyFlaggedWorkerScript(name)),
            legacyHeadDeployment,
            gaps: [],
        },
        fulfillmentSchedules: {
            state: 'expected-not-ready',
            crons: [],
            gaps: [],
        },
        queue: emptyQueue(target.productionQueue),
        deadLetterQueue: emptyQueue(target.productionDeadLetterQueue),
        gaps: [],
    };

    if (!token) {
        const gap = 'CLOUDFLARE_API_TOKEN is unavailable; Worker script names, subdomain flags, Queue, metrics and Cron GET inventory were not attempted.';
        inventory.gaps.push(gap);
        inventory.workerScripts.gaps.push(gap);
        inventory.fulfillmentSchedules.gaps.push(gap);
        inventory.queue.gaps.push(gap);
        inventory.deadLetterQueue.gaps.push(gap);
        return inventory;
    }

    const scriptsPath = `/accounts/${target.accountId}/workers/scripts`;
    const scripts = await cloudflareGet('worker_scripts_list', scriptsPath, token, calls);
    if (scripts.ok) {
        const names = asArray(scripts.payload.result)
            .map(asRecord)
            .map((row) => stringValue(row.id) || stringValue(row.name) || stringValue(row.script_name))
            .filter(Boolean)
            .sort();
        inventory.workerScripts = {
            state: 'ready',
            names,
            flagged: [],
            legacyHeadDeployment,
            gaps: [],
        };
        for (const name of flaggedLegacyWorkerNames) {
            inventory.workerScripts.flagged.push(await readFlaggedWorkerScriptSnapshot(name, names, token, calls));
        }
        inventory.workerScripts.gaps.push(...inventory.workerScripts.flagged.flatMap((snapshot) =>
            snapshot.gaps
                .filter((gap) => !gap.startsWith('invocation-surfaces:'))
                .map((gap) => `${snapshot.name}:${gap}`)));
        if (inventory.workerScripts.gaps.length > 0) inventory.workerScripts.state = 'gap';
    } else {
        const gap = `worker-scripts-list:${scripts.outcome}`;
        inventory.workerScripts.gaps.push(gap);
    }

    const schedulesPath = `/accounts/${target.accountId}/workers/scripts/${encodeURIComponent(target.productionFulfillmentWorker)}/schedules`;
    const schedules = await cloudflareGet('production_fulfillment_schedules', schedulesPath, token, calls);
    if (schedules.ok) {
        const rawResult = schedules.payload.result;
        const rows = Array.isArray(rawResult) ? rawResult : asArray(asRecord(rawResult).schedules);
        inventory.fulfillmentSchedules = {
            state: 'ready',
            crons: rows.map(asRecord).map((row) => stringValue(row.cron)).filter(Boolean).sort(),
            gaps: [],
        };
    } else {
        inventory.fulfillmentSchedules.state = schedules.outcome === 'expected-not-ready' ? 'expected-not-ready' : 'gap';
        inventory.fulfillmentSchedules.gaps.push(`schedules:${schedules.outcome}`);
    }

    const queueRows: Record<string, unknown>[] = [];
    let page = 1;
    let totalPages = 1;
    while (page <= totalPages && page <= 100) {
        const queueListPath = `/accounts/${target.accountId}/queues?page=${page}&per_page=100`;
        const pageResult = await cloudflareGet(`production_queues_page_${page}`, queueListPath, token, calls);
        if (!pageResult.ok) {
            const gap = `queue-list-page-${page}:${pageResult.outcome}`;
            inventory.gaps.push(gap);
            inventory.queue.state = 'gap';
            inventory.deadLetterQueue.state = 'gap';
            inventory.queue.gaps.push(gap);
            inventory.deadLetterQueue.gaps.push(gap);
            return inventory;
        }
        queueRows.push(...asArray(pageResult.payload.result).map(asRecord));
        const resultInfo = asRecord(pageResult.payload.result_info);
        totalPages = finiteNumber(resultInfo.total_pages) ?? page;
        page += 1;
    }
    if (totalPages > 100) {
        const gap = `queue-pagination-exceeded-safe-limit:${totalPages}`;
        inventory.gaps.push(gap);
        inventory.queue.state = 'gap';
        inventory.deadLetterQueue.state = 'gap';
        inventory.queue.gaps.push(gap);
        inventory.deadLetterQueue.gaps.push(gap);
        return inventory;
    }

    await enrichFlaggedWorkerInvocationSurfaces(
        inventory.workerScripts.flagged,
        inventory.workerScripts.names,
        queueRows,
        token,
        calls,
    );
    inventory.workerScripts.gaps.push(...inventory.workerScripts.flagged.flatMap((snapshot) =>
        snapshot.gaps
            .filter((gap) => gap.startsWith('invocation-surfaces:'))
            .map((gap) => `${snapshot.name}:${gap}`)));
    if (inventory.workerScripts.gaps.length > 0) inventory.workerScripts.state = 'gap';

    inventory.queue = await readExactQueueSnapshot(target.productionQueue, queueRows, token, calls);
    inventory.deadLetterQueue = await readExactQueueSnapshot(target.productionDeadLetterQueue, queueRows, token, calls);
    inventory.gaps.push(
        ...inventory.workerScripts.gaps,
        ...inventory.queue.gaps.map((gap) => `${target.productionQueue}:${gap}`),
        ...inventory.deadLetterQueue.gaps.map((gap) => `${target.productionDeadLetterQueue}:${gap}`),
        ...inventory.fulfillmentSchedules.gaps,
    );
    return inventory;
}

function emptyFlaggedWorkerScript(name: string): FlaggedWorkerScriptSnapshot {
    return {
        name,
        present: false,
        scheduleState: 'expected-not-ready',
        crons: [],
        subdomainState: 'expected-not-ready',
        workersDevEnabled: null,
        previewsEnabled: null,
        invocationSurfaces: {
            state: 'not-applicable',
            customDomains: 0,
            workerRoutes: 0,
            queueConsumers: 0,
            inboundServiceBindings: 0,
            inboundTailConsumerReferences: 0,
            emailRoutingReferences: 0,
        },
        gaps: [],
    };
}

async function readFlaggedWorkerScriptSnapshot(
    name: string,
    scriptNames: string[],
    token: string,
    calls: ApiReadCapture[],
): Promise<FlaggedWorkerScriptSnapshot> {
    const snapshot = emptyFlaggedWorkerScript(name);
    snapshot.present = scriptNames.includes(name);
    if (!snapshot.present) return snapshot;
    snapshot.invocationSurfaces.state = 'gap';
    snapshot.gaps.push('invocation-surfaces:not-read');

    const encodedName = encodeURIComponent(name);
    const schedules = await cloudflareGet(
        `${safeId(name)}_schedules`,
        `/accounts/${target.accountId}/workers/scripts/${encodedName}/schedules`,
        token,
        calls,
    );
    if (schedules.ok) {
        const rawResult = schedules.payload.result;
        const rows = Array.isArray(rawResult) ? rawResult : asArray(asRecord(rawResult).schedules);
        snapshot.scheduleState = 'ready';
        snapshot.crons = rows.map(asRecord).map((row) => stringValue(row.cron)).filter(Boolean).sort();
    } else {
        snapshot.scheduleState = schedules.outcome === 'expected-not-ready' ? 'expected-not-ready' : 'gap';
        snapshot.gaps.push(`schedules:${schedules.outcome}`);
    }

    const subdomain = await cloudflareGet(
        `${safeId(name)}_subdomain`,
        `/accounts/${target.accountId}/workers/scripts/${encodedName}/subdomain`,
        token,
        calls,
    );
    if (subdomain.ok) {
        const result = asRecord(subdomain.payload.result);
        snapshot.subdomainState = 'ready';
        snapshot.workersDevEnabled = typeof result.enabled === 'boolean' ? result.enabled : null;
        snapshot.previewsEnabled = typeof result.previews_enabled === 'boolean' ? result.previews_enabled : null;
        if (snapshot.workersDevEnabled === null || snapshot.previewsEnabled === null) {
            snapshot.subdomainState = 'gap';
            snapshot.gaps.push('subdomain:flags-unavailable');
        }
    } else {
        snapshot.subdomainState = subdomain.outcome === 'expected-not-ready' ? 'expected-not-ready' : 'gap';
        snapshot.gaps.push(`subdomain:${subdomain.outcome}`);
    }
    return snapshot;
}

async function enrichFlaggedWorkerInvocationSurfaces(
    snapshots: FlaggedWorkerScriptSnapshot[],
    scriptNames: string[],
    queueRows: Record<string, unknown>[],
    token: string,
    calls: ApiReadCapture[],
): Promise<void> {
    const present = snapshots.filter((snapshot) => snapshot.present);
    if (present.length === 0) return;

    const surfaceGaps = new Map(present.map((snapshot) => [snapshot.name, [] as string[]]));
    for (const snapshot of present) {
        snapshot.gaps = snapshot.gaps.filter((gap) => gap !== 'invocation-surfaces:not-read');
        snapshot.invocationSurfaces.state = 'ready';
    }
    const markGap = (snapshot: FlaggedWorkerScriptSnapshot, gap: string): void => {
        surfaceGaps.get(snapshot.name)?.push(gap);
    };
    const markAll = (gap: string): void => {
        for (const snapshot of present) markGap(snapshot, gap);
    };

    for (const snapshot of present) {
        const domains = await cloudflareGet(
            `${safeId(snapshot.name)}_custom_domains`,
            `/accounts/${target.accountId}/workers/domains?service=${encodeURIComponent(snapshot.name)}`,
            token,
            calls,
        );
        if (!domains.ok) {
            markGap(snapshot, `custom-domains:${domains.outcome}`);
        } else {
            snapshot.invocationSurfaces.customDomains = asArray(domains.payload.result)
                .map(asRecord)
                .filter((row) => stringValue(row.service) === snapshot.name)
                .length;
        }
    }

    const zones = await readPaginatedApiRows(
        'account_zones',
        (page) => `/zones?account.id=${target.accountId}&page=${page}&per_page=50`,
        token,
        calls,
    );
    if (!zones.ok) {
        markAll(`worker-routes:${zones.gap}`);
    } else {
        for (const zone of zones.rows) {
            const zoneId = stringValue(zone.id);
            if (!/^[0-9a-f]{32}$/iu.test(zoneId)) {
                markAll('worker-routes:zone-id-missing-or-invalid');
                continue;
            }
            const routes = await cloudflareGet(
                `zone_${safeId(zoneId)}_worker_routes`,
                `/zones/${zoneId}/workers/routes`,
                token,
                calls,
            );
            if (!routes.ok) {
                markAll(`worker-routes:${routes.outcome}`);
                continue;
            }
            const rows = asArray(routes.payload.result).map(asRecord);
            for (const snapshot of present) {
                snapshot.invocationSurfaces.workerRoutes += rows
                    .filter((row) => stringValue(row.script) === snapshot.name)
                    .length;
            }
        }
    }

    for (const queue of queueRows) {
        const queueId = stringValue(queue.queue_id) || stringValue(queue.id);
        if (!/^[0-9a-f-]{16,64}$/iu.test(queueId)) {
            markAll('queue-consumers:queue-id-missing-or-invalid');
            continue;
        }
        const consumers = await cloudflareGet(
            `queue_${safeId(queueId)}_consumers`,
            `/accounts/${target.accountId}/queues/${queueId}/consumers`,
            token,
            calls,
        );
        if (!consumers.ok) {
            markAll(`queue-consumers:${consumers.outcome}`);
            continue;
        }
        const raw = consumers.payload.result;
        const rows = (Array.isArray(raw) ? raw : asArray(asRecord(raw).consumers)).map(asRecord);
        for (const snapshot of present) {
            snapshot.invocationSurfaces.queueConsumers += rows
                .filter((row) => referencesWorker(row, snapshot.name))
                .length;
        }
    }

    for (const scriptName of scriptNames) {
        const settings = await cloudflareGet(
            `${safeId(scriptName)}_settings`,
            `/accounts/${target.accountId}/workers/scripts/${encodeURIComponent(scriptName)}/settings`,
            token,
            calls,
        );
        if (!settings.ok) {
            markAll(`worker-settings:${scriptName}:${settings.outcome}`);
            continue;
        }
        const result = asRecord(settings.payload.result);
        const bindings = asArray(result.bindings).map(asRecord);
        const tailConsumers = asArray(result.tail_consumers);
        for (const snapshot of present) {
            snapshot.invocationSurfaces.inboundServiceBindings += bindings
                .filter((binding) => stringValue(binding.type) === 'service' && referencesWorker(binding, snapshot.name))
                .length;
            snapshot.invocationSurfaces.inboundTailConsumerReferences += tailConsumers
                .filter((consumer) => referencesWorker(consumer, snapshot.name))
                .length;
        }
    }

    if (zones.ok) {
        for (const zone of zones.rows) {
            const zoneId = stringValue(zone.id);
            if (!/^[0-9a-f]{32}$/iu.test(zoneId)) continue;
            const rules = await readPaginatedApiRows(
                `zone_${safeId(zoneId)}_email_routing_rules`,
                (page) => `/zones/${zoneId}/email/routing/rules?page=${page}&per_page=50`,
                token,
                calls,
            );
            if (!rules.ok) markAll(`email-routing:${rules.gap}`);
            else addEmailRoutingMatches(present, rules.rows);

            const catchAll = await cloudflareGet(
                `zone_${safeId(zoneId)}_email_routing_catch_all`,
                `/zones/${zoneId}/email/routing/rules/catch_all`,
                token,
                calls,
            );
            if (!catchAll.ok) {
                markAll(`email-routing-catch-all:${catchAll.outcome}`);
            } else {
                addEmailRoutingMatches(present, [asRecord(catchAll.payload.result)]);
            }
        }
    }

    for (const snapshot of present) {
        const gaps = [...new Set(surfaceGaps.get(snapshot.name) ?? [])].sort();
        if (gaps.length > 0) {
            snapshot.invocationSurfaces.state = 'gap';
            snapshot.gaps.push(...gaps.map((gap) => `invocation-surfaces:${gap}`));
        }
    }
}

interface PaginatedApiRows {
    ok: boolean;
    rows: Record<string, unknown>[];
    gap: string;
}

async function readPaginatedApiRows(
    idPrefix: string,
    pathForPage: (page: number) => string,
    token: string,
    calls: ApiReadCapture[],
): Promise<PaginatedApiRows> {
    const rows: Record<string, unknown>[] = [];
    let page = 1;
    let totalPages = 1;
    while (page <= totalPages && page <= 100) {
        const result = await cloudflareGet(`${idPrefix}_page_${page}`, pathForPage(page), token, calls);
        if (!result.ok) return { ok: false, rows: [], gap: `${idPrefix}:page-${page}:${result.outcome}` };
        const raw = result.payload.result;
        const record = asRecord(raw);
        const collection = Array.isArray(raw)
            ? raw
            : Array.isArray(record.rules)
                ? record.rules
                : Array.isArray(record.zones)
                    ? record.zones
                    : Array.isArray(record.items)
                        ? record.items
                        : [];
        rows.push(...collection.map(asRecord));
        const info = asRecord(result.payload.result_info);
        totalPages = finiteNumber(info.total_pages) ?? page;
        page += 1;
    }
    if (totalPages > 100) return { ok: false, rows: [], gap: `${idPrefix}:pagination-exceeded-safe-limit` };
    return { ok: true, rows, gap: '' };
}

function addEmailRoutingMatches(
    snapshots: FlaggedWorkerScriptSnapshot[],
    rules: Record<string, unknown>[],
): void {
    for (const snapshot of snapshots) {
        snapshot.invocationSurfaces.emailRoutingReferences += rules
            .filter((rule) => referencesWorker(rule, snapshot.name))
            .length;
    }
}

function referencesWorker(value: unknown, workerName: string): boolean {
    if (typeof value === 'string') return value === workerName;
    const row = asRecord(value);
    for (const candidate of [
        row.script,
        row.script_name,
        row.service,
        row.service_name,
        row.worker,
        row.worker_name,
        row.name,
        asRecord(row.settings).script_name,
    ]) {
        if (stringValue(candidate) === workerName) return true;
    }
    try {
        return JSON.stringify(row).includes(workerName);
    } catch {
        return true;
    }
}

async function readExactQueueSnapshot(
    name: string,
    rows: Record<string, unknown>[],
    token: string,
    calls: ApiReadCapture[],
): Promise<QueueInventorySnapshot> {
    const matches = rows.filter((row) => queueName(row) === name);
    if (matches.length === 0) {
        return {
            name,
            id: null,
            state: 'expected-not-ready',
            settings: {},
            producers: [],
            consumers: [],
            backlog: null,
            backlogAvailable: false,
            gaps: ['exact-resource-absent'],
        };
    }
    if (matches.length !== 1) {
        return {
            name,
            id: null,
            state: 'gap',
            settings: {},
            producers: [],
            consumers: [],
            backlog: null,
            backlogAvailable: false,
            gaps: [`exact-name-count=${matches.length}`],
        };
    }
    const queueId = stringValue(matches[0].queue_id) || stringValue(matches[0].id);
    if (!/^[0-9a-f-]{16,64}$/iu.test(queueId)) {
        return {
            name,
            id: null,
            state: 'gap',
            settings: {},
            producers: [],
            consumers: [],
            backlog: null,
            backlogAvailable: false,
            gaps: ['queue-id-missing-or-invalid'],
        };
    }

    const basePath = `/accounts/${target.accountId}/queues/${queueId}`;
    const detail = await cloudflareGet(`${safeId(name)}_detail`, basePath, token, calls);
    if (!detail.ok) {
        return {
            name,
            id: queueId,
            state: detail.outcome === 'expected-not-ready' ? 'expected-not-ready' : 'gap',
            settings: {},
            producers: [],
            consumers: [],
            backlog: null,
            backlogAvailable: false,
            gaps: [`detail:${detail.outcome}`],
        };
    }
    const result = asRecord(detail.payload.result);
    const snapshot: QueueInventorySnapshot = {
        name,
        id: queueId,
        state: 'ready',
        settings: safeQueueSettings(asRecord(result.settings)),
        producers: asArray(result.producers).map(asRecord).map(safeQueueParty),
        consumers: asArray(result.consumers).map(asRecord).map(safeQueueParty),
        backlog: null,
        backlogAvailable: false,
        gaps: [],
    };
    if (!('delivery_paused' in snapshot.settings)) {
        snapshot.gaps.push('settings:delivery_paused-unavailable');
    }
    if (queueName(result) && queueName(result) !== name) {
        snapshot.state = 'gap';
        snapshot.gaps.push(`detail-name-mismatch=${queueName(result)}`);
    }
    const metrics = await cloudflareGet(`${safeId(name)}_metrics`, `${basePath}/metrics`, token, calls);
    if (metrics.ok) {
        const backlog = finiteNumber(asRecord(metrics.payload.result).backlog_count);
        if (backlog !== null && Number.isInteger(backlog) && backlog >= 0) {
            snapshot.backlog = backlog;
            snapshot.backlogAvailable = true;
        } else {
            snapshot.state = 'gap';
            snapshot.gaps.push('metrics:backlog_count-unavailable');
        }
    } else {
        snapshot.gaps.push(`metrics:${metrics.outcome}`);
    }
    return snapshot;
}

async function cloudflareGet(
    id: string,
    apiPath: string,
    token: string,
    calls: ApiReadCapture[],
): Promise<ApiGetResult> {
    if (!isAllowlistedCloudflareGetPath(apiPath)) {
        throw new Error(`Cloudflare GET scope rejected: ${apiPath}`);
    }
    const capture: ApiReadCapture = {
        id,
        method: 'GET',
        path: apiPath,
        httpStatus: null,
        success: false,
        outcome: 'api-error',
    };
    calls.push(capture);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    try {
        const response = await fetch(`https://api.cloudflare.com/client/v4${apiPath}`, {
            method: 'GET',
            signal: controller.signal,
            headers: {
                authorization: `Bearer ${token}`,
                accept: 'application/json',
            },
        });
        const raw = await response.text();
        capture.httpStatus = response.status;
        capture.responseSha256 = sha256(raw);
        let payload: Record<string, unknown> = {};
        try {
            payload = asRecord(JSON.parse(raw));
        } catch {
            capture.outcome = 'api-error';
            return { ok: false, outcome: capture.outcome, payload: {} };
        }
        const success = response.ok && payload.success === true;
        capture.success = success;
        capture.outcome = success
            ? 'ok'
            : response.status === 404
                ? 'expected-not-ready'
                : response.status === 401 || response.status === 403
                    ? 'permission-gap'
                    : 'api-error';
        return { ok: success, outcome: capture.outcome, payload };
    } catch {
        capture.outcome = 'api-error';
        return { ok: false, outcome: capture.outcome, payload: {} };
    } finally {
        clearTimeout(timeout);
    }
}

function isAllowlistedCloudflareGetPath(apiPath: string): boolean {
    const accountPrefix = `/accounts/${target.accountId}`;
    if (apiPath === `${accountPrefix}/workers/scripts`) return true;
    if (apiPath === `${accountPrefix}/workers/scripts/${encodeURIComponent(target.productionFulfillmentWorker)}/schedules`) return true;
    for (const name of flaggedLegacyWorkerNames) {
        const scriptPrefix = `${accountPrefix}/workers/scripts/${encodeURIComponent(name)}`;
        if (apiPath === `${scriptPrefix}/schedules` || apiPath === `${scriptPrefix}/subdomain`) return true;
        if (apiPath === `${accountPrefix}/workers/domains?service=${encodeURIComponent(name)}`) return true;
    }
    if (new RegExp(`^${escapeRegExp(accountPrefix)}/workers/scripts/[a-z0-9_][a-z0-9_-]*/settings$`, 'iu').test(apiPath)) return true;
    if (new RegExp(`^/zones\\?account\\.id=${target.accountId}&page=\\d+&per_page=50$`, 'u').test(apiPath)) return true;
    if (/^\/zones\/[0-9a-f]{32}\/workers\/routes$/iu.test(apiPath)) return true;
    if (/^\/zones\/[0-9a-f]{32}\/email\/routing\/rules\?page=\d+&per_page=50$/iu.test(apiPath)) return true;
    if (/^\/zones\/[0-9a-f]{32}\/email\/routing\/rules\/catch_all$/iu.test(apiPath)) return true;
    if (new RegExp(`^${escapeRegExp(accountPrefix)}/queues\\?page=\\d+&per_page=100$`, 'u').test(apiPath)) return true;
    return new RegExp(`^${escapeRegExp(accountPrefix)}/queues/[0-9a-f-]{16,64}(?:/metrics|/consumers)?$`, 'iu').test(apiPath);
}

function onlyGetApiCalls(calls: ApiReadCapture[]): boolean {
    return calls.every((call) => call.method === 'GET' && isAllowlistedCloudflareGetPath(call.path));
}

function queueName(value: Record<string, unknown>): string {
    return stringValue(value.queue_name) || stringValue(value.name);
}

function safeQueueParty(value: Record<string, unknown>): SafeQueueParty {
    const settings = { ...asRecord(value.settings), ...value };
    const safeSettings = safeNumericAndBooleanFields(settings, [
        'max_batch_size',
        'max_batch_timeout',
        'max_retries',
        'max_concurrency',
        'retry_delay',
        'visibility_timeout_ms',
        'dead_letter_queue',
    ]);
    const deadLetterQueue = queueName(asRecord(settings.dead_letter_queue));
    if (!safeSettings.dead_letter_queue && deadLetterQueue) safeSettings.dead_letter_queue = deadLetterQueue;
    return {
        type: stringValue(value.type),
        worker: stringValue(value.script) || stringValue(value.script_name) || null,
        settings: safeSettings,
    };
}

function safeQueueSettings(value: Record<string, unknown>): Record<string, string | number | boolean> {
    return safeNumericAndBooleanFields(value, [
        'delivery_paused',
        'delivery_delay',
        'delivery_delay_seconds',
        'message_retention_period',
        'message_retention_period_hours',
    ]);
}

function safeNumericAndBooleanFields(
    value: Record<string, unknown>,
    allowlist: string[],
): Record<string, string | number | boolean> {
    return Object.fromEntries(allowlist.flatMap((key) => {
        const entry = value[key];
        return typeof entry === 'string' || typeof entry === 'number' || typeof entry === 'boolean'
            ? [[key, entry]]
            : [];
    }));
}

function safeId(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9]+/gu, '_').replace(/^_|_$/gu, '');
}

function buildChecks(
    results: ProbeResult[],
    sourceIdentity: CloudflareProductionSourceIdentity,
    apiInventory: ApiInventory,
): Check[] {
    const whoami = probe(results, 'whoami');
    const pagesProjects = probe(results, 'pages_projects');
    const pagesProduction = probe(results, 'pages_production_deployments');
    const stagingWorker = probe(results, 'staging_worker_deployments');
    const productionWorker = probe(results, 'production_worker_deployments');
    const productionWorkerStatus = probe(results, 'production_worker_status');
    const productionFulfillment = probe(results, 'production_fulfillment_deployments');
    const productionFulfillmentStatus = probe(results, 'production_fulfillment_status');
    const stagingSecrets = probe(results, 'staging_worker_secrets');
    const productionSecrets = probe(results, 'production_worker_secrets');
    const productionFulfillmentSecrets = probe(results, 'production_fulfillment_secrets');
    const productionWorkerBindings = probe(results, 'production_worker_current_version');
    const productionFulfillmentBindings = probe(results, 'production_fulfillment_current_version');

    const authSummary = whoami.summary as {
        loggedIn?: boolean;
        targetAccountFound?: boolean;
        accountName?: string;
    };
    const pagesSummary = pagesProjects.summary as {
        projectFound?: boolean;
        domainNames?: string[];
        requiredDomainsPresent?: boolean;
    };
    const pagesProductionSummary = pagesProduction.summary as {
        count?: number;
        latestId?: string;
        latestBranch?: string;
        latestSource?: string;
        latestStatus?: string;
    };
    const stagingWorkerSummary = stagingWorker.summary as {
        count?: number;
        latestVersionId?: string;
        latestCreatedOn?: string;
    };
    const productionWorkerSummary = productionWorker.summary as {
        count?: number;
        notFound?: boolean;
        errorPreview?: string;
        latestVersionId?: string;
    };
    const productionWorkerStatusSummary = productionWorkerStatus.summary as {
        primaryVersionId?: string;
        currentVersions?: Array<{ versionId: string; percentage: number | null }>;
        notFound?: boolean;
    };
    const productionFulfillmentSummary = productionFulfillment.summary as {
        count?: number;
        notFound?: boolean;
        errorPreview?: string;
        latestVersionId?: string;
        latestCreatedOn?: string;
    };
    const productionFulfillmentStatusSummary = productionFulfillmentStatus.summary as {
        primaryVersionId?: string;
        currentVersions?: Array<{ versionId: string; percentage: number | null }>;
        notFound?: boolean;
    };
    const stagingSecretSummary = stagingSecrets.summary as {
        names?: string[];
    };
    const productionSecretSummary = productionSecrets.summary as {
        names?: string[];
        notFound?: boolean;
        errorPreview?: string;
    };
    const productionFulfillmentSecretSummary = productionFulfillmentSecrets.summary as {
        names?: string[];
        notFound?: boolean;
        errorPreview?: string;
    };
    const productionSecretNames = productionSecretSummary.names ?? [];
    const productionFulfillmentSecretNames = productionFulfillmentSecretSummary.names ?? [];
    const missingWebBootstrapSecrets = productionBootstrapSecretNames.filter((name) => !productionSecretNames.includes(name));
    const missingWebActiveSecrets = requiredProductionWebActiveSecretNames.filter((name) => !productionSecretNames.includes(name));
    const missingFulfillmentBootstrapSecrets = productionBootstrapSecretNames.filter((name) => !productionFulfillmentSecretNames.includes(name));
    const missingFulfillmentActiveSecrets = requiredProductionFulfillmentActiveSecretNames.filter((name) => !productionFulfillmentSecretNames.includes(name));
    const productionWorkerVisible = (productionWorkerSummary.count ?? 0) > 0
        || Boolean(productionWorkerStatusSummary.primaryVersionId);
    const productionFulfillmentVisible = (productionFulfillmentSummary.count ?? 0) > 0
        || Boolean(productionFulfillmentStatusSummary.primaryVersionId);
    const webBootstrapSecretErrors = productionBootstrapSecretInventoryErrors(
        productionWorkerVisible,
        productionSecretNames,
    );
    const fulfillmentBootstrapSecretErrors = productionBootstrapSecretInventoryErrors(
        productionFulfillmentVisible,
        productionFulfillmentSecretNames,
    );

    const checks: Check[] = [
        {
            status: onlyReadCommands(results) ? 'ok' : 'failed',
            name: 'readonly_command_scope',
            message: onlyReadCommands(results)
                ? 'Only Wrangler read/list/version commands were executed; no deploy, delete, secret put, route, DNS or domain move command is present.'
                : 'One or more configured Wrangler commands appear to be write-capable.',
            details: results.map((result) => `${result.id}=${result.command}`),
        },
        {
            status: onlyGetApiCalls(apiInventory.calls) ? 'ok' : 'failed',
            name: 'cloudflare_api_get_scope',
            message: onlyGetApiCalls(apiInventory.calls)
                ? 'Every direct Cloudflare API request is an allowlisted GET for the exact account, fulfillment schedule or production Queue inventory.'
                : 'A direct Cloudflare API request fell outside the exact GET-only allowlist.',
            details: apiInventory.calls.length > 0
                ? apiInventory.calls.map((call) => `${call.id}=GET ${call.path}:${call.outcome}`)
                : ['apiCalls=0', `tokenAvailable=${apiInventory.tokenAvailable}`],
        },
        {
            status: authSummary.loggedIn && authSummary.targetAccountFound ? 'ok' : 'failed',
            name: 'cloudflare_account_auth',
            message: authSummary.loggedIn && authSummary.targetAccountFound
                ? 'Wrangler is logged in and the target Cloudflare account is visible.'
                : 'Wrangler auth did not prove access to the intended Cloudflare account.',
            details: [
                'email=redacted',
                `account=${authSummary.accountName ?? 'missing'}`,
                `targetAccountId=${target.accountId}`,
            ],
        },
        {
            status: pagesSummary.projectFound && pagesSummary.requiredDomainsPresent ? 'ok' : 'failed',
            name: 'pages_project_current_domain_owner',
            message: pagesSummary.projectFound && pagesSummary.requiredDomainsPresent
                ? 'Pages project exists and its domain facts prove ownership of both required production custom domains; production domain cutover is still a final-window task.'
                : 'The exact Pages project and both required custom-domain facts were not proven, so current production-domain ownership is ambiguous.',
            details: [
                `project=${target.pagesProject}`,
                `projectFound=${String(Boolean(pagesSummary.projectFound))}`,
                `requiredDomainsPresent=${String(Boolean(pagesSummary.requiredDomainsPresent))}`,
                `domains=${(pagesSummary.domainNames ?? []).join(',') || 'none'}`,
                `expectedDomains=${target.customDomains.join(',')}`,
            ],
        },
        {
            status: 'warning',
            name: 'pages_production_deployment_posture',
            message: (pagesProductionSummary.count ?? 0) > 0
                ? 'Pages production deployments are visible; current production custom domains still appear tied to the old Pages deployment line.'
                : 'Expected-not-ready: no Pages production deployment was visible for the production project.',
            details: [
                `count=${pagesProductionSummary.count ?? 0}`,
                `latestId=${pagesProductionSummary.latestId ?? 'missing'}`,
                `latestBranch=${pagesProductionSummary.latestBranch ?? 'missing'}`,
                `latestSource=${pagesProductionSummary.latestSource ?? 'missing'}`,
                `latestStatus=${pagesProductionSummary.latestStatus ?? 'missing'}`,
            ],
        },
        {
            status: (stagingWorkerSummary.count ?? 0) > 0 ? 'ok' : 'warning',
            name: 'staging_worker_exists',
            message: (stagingWorkerSummary.count ?? 0) > 0
                ? 'Staging Worker deployments are visible.'
                : 'Staging Worker deployments are not visible in this read-only probe.',
            details: [
                `worker=${target.stagingWorker}`,
                `count=${stagingWorkerSummary.count ?? 0}`,
                `latestVersion=${stagingWorkerSummary.latestVersionId ?? 'missing'}`,
                `latestCreatedOn=${stagingWorkerSummary.latestCreatedOn ?? 'missing'}`,
            ],
        },
        {
            status: productionWorkerVisible ? 'ok' : 'warning',
            name: 'production_worker_exists',
            message: productionWorkerVisible
                ? 'Production Worker deployments are visible.'
                : 'Expected-not-ready: production web Worker is absent; creation/deploy remains pending and requires separate explicit Cloudflare approval.',
            details: [
                `worker=${target.productionWorker}`,
                `count=${productionWorkerSummary.count ?? 0}`,
                `latestVersion=${productionWorkerSummary.latestVersionId ?? 'missing'}`,
                `currentVersion=${productionWorkerStatusSummary.primaryVersionId ?? 'missing'}`,
                `traffic=${renderTraffic(productionWorkerStatusSummary.currentVersions)}`,
                `notFound=${Boolean(productionWorkerSummary.notFound)}`,
                `error=${productionWorkerSummary.errorPreview ?? 'none'}`,
            ],
        },
        {
            status: productionFulfillmentVisible ? 'ok' : 'warning',
            name: 'production_fulfillment_worker_exists',
            message: productionFulfillmentVisible
                ? 'Production fulfillment Worker deployments and current version are visible.'
                : 'Expected-not-ready: production fulfillment Worker is absent; inert bootstrap deployment remains pending.',
            details: [
                `worker=${target.productionFulfillmentWorker}`,
                `count=${productionFulfillmentSummary.count ?? 0}`,
                `latestVersion=${productionFulfillmentSummary.latestVersionId ?? 'missing'}`,
                `latestCreatedOn=${productionFulfillmentSummary.latestCreatedOn ?? 'missing'}`,
                `currentVersion=${productionFulfillmentStatusSummary.primaryVersionId ?? 'missing'}`,
                `traffic=${renderTraffic(productionFulfillmentStatusSummary.currentVersions)}`,
                `notFound=${Boolean(productionFulfillmentSummary.notFound)}`,
                `error=${productionFulfillmentSummary.errorPreview ?? 'none'}`,
            ],
        },
        currentTrafficShapeCheck('production_web_current_traffic', 'web', productionWorkerStatusSummary.currentVersions),
        currentTrafficShapeCheck('production_fulfillment_current_traffic', 'fulfillment', productionFulfillmentStatusSummary.currentVersions),
        {
            status: (stagingSecretSummary.names ?? []).length > 0 ? 'ok' : 'warning',
            name: 'staging_worker_secret_names',
            message: (stagingSecretSummary.names ?? []).length > 0
                ? 'Staging Worker secret names are visible by name only.'
                : 'Staging Worker secret list returned no names; confirm whether staging uses vars/config only or secrets are expected elsewhere.',
            details: [
                `worker=${target.stagingWorker}`,
                `names=${(stagingSecretSummary.names ?? []).join(',') || 'none'}`,
            ],
        },
        {
            status: webBootstrapSecretErrors.length > 0 ? 'failed' : productionWorkerVisible ? 'ok' : 'warning',
            name: 'production_worker_secret_names',
            message: webBootstrapSecretErrors.length > 0
                ? 'Production web Worker secret names violate the exact inert-bootstrap inventory.'
                : productionWorkerVisible
                    ? 'Production web Worker has exactly the single inert-bootstrap HMAC secret name.'
                    : 'Expected-not-ready: production web Worker is absent and has no visible secret names.',
            details: [
                `worker=${target.productionWorker}`,
                `visibleNames=${productionSecretNames.join(',') || 'none'}`,
                `missingBootstrapNames=${missingWebBootstrapSecrets.join(',') || 'none'}`,
                `missingActiveNames=${missingWebActiveSecrets.join(',') || 'none'}`,
                `notFound=${Boolean(productionSecretSummary.notFound)}`,
                `error=${productionSecretSummary.errorPreview ?? 'none'}`,
                ...webBootstrapSecretErrors.map((error) => `unsafe=${error}`),
            ],
        },
        {
            status: fulfillmentBootstrapSecretErrors.length > 0 ? 'failed' : productionFulfillmentVisible ? 'ok' : 'warning',
            name: 'production_fulfillment_secret_names',
            message: fulfillmentBootstrapSecretErrors.length > 0
                ? 'Production fulfillment Worker secret names violate the exact inert-bootstrap inventory.'
                : productionFulfillmentVisible
                    ? 'Production fulfillment Worker has exactly the single inert-bootstrap HMAC secret name.'
                    : 'Expected-not-ready: production fulfillment Worker is absent and has no visible secret names.',
            details: [
                `worker=${target.productionFulfillmentWorker}`,
                `visibleNames=${productionFulfillmentSecretNames.join(',') || 'none'}`,
                `missingBootstrapNames=${missingFulfillmentBootstrapSecrets.join(',') || 'none'}`,
                `missingActiveNames=${missingFulfillmentActiveSecrets.join(',') || 'none'}`,
                `notFound=${Boolean(productionFulfillmentSecretSummary.notFound)}`,
                `error=${productionFulfillmentSecretSummary.errorPreview ?? 'none'}`,
                ...fulfillmentBootstrapSecretErrors.map((error) => `unsafe=${error}`),
            ],
        },
        inertBindingPostureCheck('production_web_inert_bindings', productionWorkerBindings, 'web'),
        inertBindingPostureCheck('production_fulfillment_inert_bindings', productionFulfillmentBindings, 'fulfillment'),
        ...legacyWorkerPostureChecks(apiInventory),
        fulfillmentSchedulesCheck(apiInventory, productionFulfillmentVisible),
        queueInventoryCheck(apiInventory),
        sourceIdentityCheck(sourceIdentity),
        validateWranglerConfig(),
        validateGeneratedOutputPosture(results),
    ];

    return checks;
}

function legacyWorkerPostureChecks(apiInventory: ApiInventory): Check[] {
    const scripts = apiInventory.workerScripts;
    const legacy = scripts.flagged.find((snapshot) => snapshot.name === legacyReminderWorkerName);
    const duplicate = scripts.flagged.find((snapshot) => snapshot.name === duplicateStagingWorkerName);
    const headReady = scripts.legacyHeadDeployment.state === 'ready'
        && scripts.legacyHeadDeployment.trackedLegacyPackagePaths.length === 0
        && !scripts.legacyHeadDeployment.workingTreePackagePresent
        && scripts.legacyHeadDeployment.automaticDeployReferences.length === 0
        && scripts.legacyHeadDeployment.gaps.length === 0;
    const legacyRemoteReady = legacy ? workerIsAbsentOrExactlyNeutralized(legacy) : false;
    const duplicateRemoteReady = duplicate ? workerIsAbsentOrExactlyNeutralized(duplicate) : false;
    const legacyReady = scripts.state === 'ready' && legacyRemoteReady && headReady;
    const duplicateReady = scripts.state === 'ready' && duplicateRemoteReady;
    return [
        {
            status: legacyReady ? 'ok' : 'failed',
            name: 'legacy_reminder_worker_neutralized',
            message: legacyReady
                ? legacy?.present
                    ? 'The legacy reminders Worker remains preserved but every invocation surface is exactly neutralized, and HEAD cannot redeploy it.'
                    : 'The legacy reminders Worker is absent and HEAD contains no package or automatic deployment reference that can recreate it.'
                : 'The legacy reminders Worker is exposed, ambiguous, or deployable from HEAD; production consumers must fail closed.',
            details: [
                `inventoryState=${scripts.state}`,
                ...flaggedWorkerDetails(legacy),
                `headDeploymentState=${scripts.legacyHeadDeployment.state}`,
                `trackedLegacyPackagePaths=${scripts.legacyHeadDeployment.trackedLegacyPackagePaths.join(',') || 'none'}`,
                `workingTreePackagePresent=${String(scripts.legacyHeadDeployment.workingTreePackagePresent)}`,
                `automaticDeployReferences=${scripts.legacyHeadDeployment.automaticDeployReferences.join(',') || 'none'}`,
                `headDeploymentGaps=${scripts.legacyHeadDeployment.gaps.join(',') || 'none'}`,
            ],
        },
        {
            status: duplicateReady ? duplicate?.present ? 'warning' : 'ok' : 'failed',
            name: 'duplicate_staging_worker_posture',
            message: duplicateReady
                ? duplicate?.present
                    ? 'The duplicate staging Worker still exists but is completely unexposed; retain it only as a non-critical cleanup warning.'
                    : 'The duplicate staging Worker is absent.'
                : 'The duplicate staging Worker has an invocation surface or ambiguous evidence; production consumers must fail closed.',
            details: [
                `inventoryState=${scripts.state}`,
                ...flaggedWorkerDetails(duplicate),
            ],
        },
    ];
}

function workerIsAbsentOrExactlyNeutralized(snapshot: FlaggedWorkerScriptSnapshot): boolean {
    if (!snapshot.present) return true;
    const surfaces = snapshot.invocationSurfaces;
    return snapshot.scheduleState === 'ready'
        && snapshot.crons.length === 0
        && snapshot.subdomainState === 'ready'
        && snapshot.workersDevEnabled === false
        && snapshot.previewsEnabled === false
        && surfaces.state === 'ready'
        && surfaces.customDomains === 0
        && surfaces.workerRoutes === 0
        && surfaces.queueConsumers === 0
        && surfaces.inboundServiceBindings === 0
        && surfaces.inboundTailConsumerReferences === 0
        && surfaces.emailRoutingReferences === 0
        && snapshot.gaps.length === 0;
}

function flaggedWorkerDetails(snapshot: FlaggedWorkerScriptSnapshot | undefined): string[] {
    if (!snapshot) return ['snapshot=missing'];
    const surfaces = snapshot.invocationSurfaces;
    return [
        `name=${snapshot.name}`,
        `present=${snapshot.present}`,
        `scheduleState=${snapshot.scheduleState}`,
        `crons=${snapshot.crons.join(',') || 'none'}`,
        `subdomainState=${snapshot.subdomainState}`,
        `workersDevEnabled=${String(snapshot.workersDevEnabled)}`,
        `previewsEnabled=${String(snapshot.previewsEnabled)}`,
        `invocationSurfaceState=${surfaces.state}`,
        `customDomains=${surfaces.customDomains}`,
        `workerRoutes=${surfaces.workerRoutes}`,
        `queueConsumers=${surfaces.queueConsumers}`,
        `inboundServiceBindings=${surfaces.inboundServiceBindings}`,
        `inboundTailConsumerReferences=${surfaces.inboundTailConsumerReferences}`,
        `emailRoutingReferences=${surfaces.emailRoutingReferences}`,
        `gaps=${snapshot.gaps.join(',') || 'none'}`,
    ];
}

function inertBindingPostureCheck(
    name: string,
    result: ProbeResult,
    kind: 'web' | 'fulfillment',
): Check {
    const summary = result.summary as {
        state?: string;
        versionId?: string;
        bindingNames?: string[];
        safeValues?: Record<string, string>;
        safeTargets?: Record<string, string>;
    };
    if (summary.state === 'expected-not-ready' || !summary.versionId) {
        return {
            status: 'warning',
            name,
            message: `Expected-not-ready: no current production ${kind} version exists, so inert binding posture cannot yet be proven.`,
            details: [`workerKind=${kind}`, `state=${summary.state ?? 'unknown'}`],
        };
    }

    const values = summary.safeValues ?? {};
    const targets = summary.safeTargets ?? {};
    const expected: Record<string, string> = kind === 'web'
        ? {
            WEB_RUNTIME_MODE: 'bootstrap',
            CHECKOUT_ENABLED: 'false',
            CHECKOUT_ENABLED_OVERRIDE: 'false',
            EMAIL_DELIVERY_MODE: 'disabled',
        }
        : {
            FULFILLMENT_RUNTIME_MODE: 'bootstrap',
            CHECKOUT_ENABLED: 'false',
            CHECKOUT_ENABLED_OVERRIDE: 'false',
            EMAIL_DELIVERY_MODE: 'disabled',
        };
    const unsafe = Object.entries(expected)
        .filter(([key, value]) => key in values && values[key] !== value)
        .map(([key, value]) => `${key}=${values[key]} expected=${value}`);
    unsafe.push(...productionInertBindingNameErrors(kind, summary.bindingNames ?? []));
    if (kind === 'web' && 'FULFILLMENT_SERVICE' in targets
        && targets.FULFILLMENT_SERVICE !== target.productionFulfillmentWorker) {
        unsafe.push(`FULFILLMENT_SERVICE=${targets.FULFILLMENT_SERVICE} expected=${target.productionFulfillmentWorker}`);
    }
    const missing = Object.keys(expected).filter((key) => !(key in values));
    if (kind === 'web' && !('FULFILLMENT_SERVICE' in targets)) missing.push('FULFILLMENT_SERVICE target');

    return {
        status: unsafe.length > 0 ? 'failed' : missing.length > 0 ? 'warning' : 'ok',
        name,
        message: unsafe.length > 0
            ? `The current production ${kind} version violates the inert safety contract.`
            : missing.length > 0
                ? `The current production ${kind} version exists, but its redacted metadata does not fully prove every inert safety value.`
                : `The current production ${kind} version proves the allowlisted inert runtime, checkout and email posture.`,
        details: [
            `versionId=${summary.versionId}`,
            `bindingNames=${(summary.bindingNames ?? []).join(',') || 'none'}`,
            `safeValues=${renderSummaryValue(values)}`,
            `safeTargets=${renderSummaryValue(targets)}`,
            ...unsafe.map((value) => `unsafe=${value}`),
            ...missing.map((value) => `missing=${value}`),
        ],
    };
}

function currentTrafficShapeCheck(
    name: string,
    kind: 'web' | 'fulfillment',
    versions: Array<{ versionId: string; percentage: number | null }> | undefined,
): Check {
    const current = versions ?? [];
    if (current.length === 0) {
        return {
            status: 'warning',
            name,
            message: `Expected-not-ready: no current production ${kind} traffic version is visible.`,
            details: ['currentVersions=none'],
        };
    }
    const exact = current.length === 1 && current[0].percentage === 100;
    return {
        status: exact ? 'ok' : 'failed',
        name,
        message: exact
            ? `Production ${kind} traffic points 100% to one exact current version.`
            : `Production ${kind} traffic is split or its percentage is ambiguous; one projected version cannot prove the full inert runtime.`,
        details: [`traffic=${renderTraffic(current)}`],
    };
}

function fulfillmentSchedulesCheck(apiInventory: ApiInventory, fulfillmentVisible: boolean): Check {
    const schedules = apiInventory.fulfillmentSchedules;
    if (!fulfillmentVisible && schedules.state === 'expected-not-ready') {
        return {
            status: 'warning',
            name: 'production_fulfillment_schedules',
            message: 'Expected-not-ready: fulfillment Worker is absent and therefore has no readable Cron inventory yet.',
            details: schedules.gaps,
        };
    }
    if (schedules.state !== 'ready') {
        return {
            status: 'warning',
            name: 'production_fulfillment_schedules',
            message: 'Cloudflare Cron GET could not fully prove the production fulfillment schedule inventory.',
            details: schedules.gaps,
        };
    }
    return {
        status: schedules.crons.length === 0 ? 'ok' : 'failed',
        name: 'production_fulfillment_schedules',
        message: schedules.crons.length === 0
            ? 'Production fulfillment Worker has zero Cron Triggers, as required while inert.'
            : 'Production fulfillment Worker has Cron Triggers and is not inert.',
        details: [`crons=${schedules.crons.join(',') || 'none'}`],
    };
}

function queueInventoryCheck(apiInventory: ApiInventory): Check {
    const snapshots = [apiInventory.queue, apiInventory.deadLetterQueue];
    const unexpectedBacklog = snapshots.filter((snapshot) => snapshot.backlogAvailable && snapshot.backlog !== 0);
    const unexpectedConsumers = snapshots.filter((snapshot) => snapshot.consumers.length > 0 || snapshot.producers.length > 0);
    const gaps = snapshots.flatMap((snapshot) => snapshot.gaps.map((gap) => `${snapshot.name}:${gap}`));
    const missing = snapshots.filter((snapshot) => snapshot.state === 'expected-not-ready');
    if (unexpectedBacklog.length > 0 || unexpectedConsumers.length > 0) {
        return {
            status: 'failed',
            name: 'production_queue_and_dlq_inventory',
            message: 'Production Queue resources are not inert: backlog or producer/consumer attachment is present.',
            details: [
                ...unexpectedBacklog.map((snapshot) => `${snapshot.name}:backlog=${snapshot.backlog}`),
                ...unexpectedConsumers.map((snapshot) => `${snapshot.name}:producers=${snapshot.producers.length}:consumers=${snapshot.consumers.length}`),
            ],
        };
    }
    if (missing.length > 0 || gaps.length > 0) {
        return {
            status: 'warning',
            name: 'production_queue_and_dlq_inventory',
            message: missing.length > 0
                ? 'Expected-not-ready: the exact production Queue and/or DLQ is absent.'
                : 'The exact production Queue resources exist, but Cloudflare did not expose every requested read-only configuration/metrics field.',
            details: [
                ...snapshots.map((snapshot) => `${snapshot.name}:state=${snapshot.state}:id=${snapshot.id ?? 'missing'}:backlog=${snapshot.backlogAvailable ? snapshot.backlog : 'unavailable'}`),
                ...gaps,
            ],
        };
    }
    return {
        status: 'ok',
        name: 'production_queue_and_dlq_inventory',
        message: 'The exact production Queue and DLQ exist with zero backlog and no producer/consumer attachment while production remains inert.',
        details: snapshots.map((snapshot) => [
            `name=${snapshot.name}`,
            `id=${snapshot.id}`,
            `settings=${renderSummaryValue(snapshot.settings)}`,
            `backlog=${snapshot.backlog}`,
        ].join(':')),
    };
}

function sourceIdentityCheck(sourceIdentity: CloudflareProductionSourceIdentity): Check {
    const errors = validateCloudflareProductionSourceIdentity(sourceIdentity, sourceIdentity);
    const valid = errors.length === 0;
    return {
        status: valid ? 'ok' : 'failed',
        name: 'evidence_source_identity',
        message: valid
            ? 'Evidence is bound to the current Git HEAD and deterministic hashes of every runner/config source file; any tracked dirty change is included in that hash set.'
            : 'Git HEAD, canonical source/config hashes or tracked dirty-path coverage is incomplete, so this package cannot claim an unambiguous source identity.',
        details: [
            `gitHead=${sourceIdentity.gitHead ?? 'missing'}`,
            `gitWorktreeDirty=${String(sourceIdentity.gitWorktreeDirty)}`,
            `dirtyPaths=${sourceIdentity.dirtyPaths.join(',') || 'none'}`,
            `unhashedDirtyPaths=${sourceIdentity.unhashedDirtyPaths.join(',') || 'none'}`,
            `sourceSha256=${sourceIdentity.sourceSha256}`,
            ...errors.map((error) => `invalid=${error}`),
            ...sourceIdentity.files.map((file) => `${file.path}=${file.sha256}`),
        ],
    };
}

function renderTraffic(value: Array<{ versionId: string; percentage: number | null }> | undefined): string {
    return (value ?? []).map((entry) => `${entry.versionId}:${entry.percentage ?? 'unknown'}%`).join(',') || 'none';
}

function validateWranglerConfig(): Check {
    const wranglerPath = 'wrangler.toml';
    const fulfillmentWranglerPath = 'workers/fulfillment/wrangler.toml';
    if (!existsSync(wranglerPath) || !existsSync(fulfillmentWranglerPath)) {
        return {
            status: 'failed',
            name: 'local_wrangler_config_fail_closed',
            message: 'One or both production Wrangler configs are missing.',
            details: [wranglerPath, fulfillmentWranglerPath],
        };
    }

    const wrangler = readFileSync(wranglerPath, 'utf8');
    const fulfillmentWrangler = readFileSync(fulfillmentWranglerPath, 'utf8');
    const checkoutFalseCount = [...wrangler.matchAll(/CHECKOUT_ENABLED\s*=\s*"false"/g)].length;
    const fulfillmentCheckoutFalseCount = [...fulfillmentWrangler.matchAll(/CHECKOUT_ENABLED\s*=\s*"false"/g)].length;
    const required = [
        'name = "espanolhonesto-env-required"',
        'keep_vars = true',
        '[env.staging]',
        'name = "espanolhonesto-staging"',
        '[env.production]',
        'name = "espanolhonesto"',
    ];
    const missing = required.filter((snippet) => !wrangler.includes(snippet));
    const requiredFulfillment = [
        'name = "espanol-honesto-fulfillment-env-required"',
        'keep_vars = true',
        '[env.production_bootstrap]',
        `name = "${target.productionFulfillmentWorker}"`,
        '[env.production_bootstrap.triggers]',
        'crons = []',
        '[env.production]',
        `queue = "${target.productionQueue}"`,
        `dead_letter_queue = "${target.productionDeadLetterQueue}"`,
    ];
    missing.push(...requiredFulfillment
        .filter((snippet) => !fulfillmentWrangler.includes(snippet))
        .map((snippet) => `fulfillment:${snippet}`));
    if (checkoutFalseCount < 3) missing.push('web:CHECKOUT_ENABLED = "false" in base, staging and production vars');
    if (fulfillmentCheckoutFalseCount < 3) missing.push('fulfillment:CHECKOUT_ENABLED = "false" in staging/bootstrap/production vars');
    const queueValidation = validateProductionQueueConfig(fulfillmentWrangler);
    missing.push(...queueValidation.errors.map((error) => `fulfillmentQueue:${error}`));

    return {
        status: missing.length === 0 ? 'ok' : 'failed',
        name: 'local_wrangler_config_fail_closed',
        message: missing.length === 0
            ? 'Local web and fulfillment Wrangler configs preserve exact production names, inert bootstrap posture and the exact active-only Queue/DLQ contract.'
            : 'Local Wrangler config is missing required production names, inert bootstrap posture or exact Queue/DLQ contract.',
        details: missing.length === 0
            ? [
                `webCheckoutFalseCount=${checkoutFalseCount}`,
                `fulfillmentCheckoutFalseCount=${fulfillmentCheckoutFalseCount}`,
                wranglerPath,
                fulfillmentWranglerPath,
            ]
            : missing.map((snippet) => `missing=${snippet}`),
    };
}

function validateGeneratedOutputPosture(results: ProbeResult[]): Check {
    const combined = results
        .map((result) => readFileSync(result.outputPath, 'utf8'))
        .join('\n');
    const forbiddenSecretPatterns = [
        new RegExp('-----BEGIN ' + 'PRIVATE KEY-----'),
        /sk_(live|test)_[A-Za-z0-9]{20,}/,
        /whsec_[A-Za-z0-9]{20,}/,
        /sb_secret_[A-Za-z0-9_-]{20,}/,
        /AIza[0-9A-Za-z_-]{30,}/,
        /(?<![A-Za-z0-9_])re_[A-Za-z0-9_]{20,}/,
        /(postgres|postgresql):\/\/[^\s"']+:[^\s"']+@/,
        /Bearer\s+[A-Za-z0-9._-]{20,}/i,
    ];
    const offenders = forbiddenSecretPatterns.filter((pattern) => pattern.test(combined));

    return {
        status: offenders.length === 0 ? 'ok' : 'failed',
        name: 'generated_output_secret_posture',
        message: offenders.length === 0
            ? 'Generated command artifacts contain no obvious secret values.'
            : 'Generated command artifacts appear to contain secret-like values.',
        details: offenders.map((pattern) => `secretPattern=${pattern}`).concat([
            'secret list probes store names only as returned by Wrangler',
            'stdout/stderr are sanitized for common token/key patterns before writing',
        ]),
    };
}

function summarizeProbe(
    id: string,
    parsedJson: unknown,
    stdout: string,
    stderr: string,
    exitCode: number | null,
): Record<string, unknown> {
    switch (id) {
        case 'wrangler_version':
            return {
                version: stdout.trim().split(/\s+/u).at(-1) ?? stdout.trim(),
            };
        case 'whoami':
            return summarizeWhoami(parsedJson);
        case 'pages_projects':
            return summarizePagesProjects(parsedJson);
        case 'pages_production_deployments':
        case 'pages_preview_deployments':
            return summarizePagesDeployments(parsedJson);
        case 'staging_worker_deployments':
        case 'production_worker_deployments':
        case 'production_fulfillment_deployments':
            return summarizeWorkerDeployments(parsedJson, stderr, exitCode);
        case 'production_worker_status':
        case 'production_fulfillment_status':
            return summarizeWorkerStatus(parsedJson, stderr, exitCode);
        case 'staging_worker_secrets':
        case 'production_worker_secrets':
        case 'production_fulfillment_secrets':
            return summarizeSecrets(parsedJson, stderr, exitCode);
        case 'production_worker_current_version':
        case 'production_fulfillment_current_version':
            return summarizeVersionBindings(parsedJson, stderr, exitCode);
        default:
            return {};
    }
}

function summarizeWhoami(value: unknown): Record<string, unknown> {
    const object = asRecord(value);
    const accounts = asArray(object.accounts);
    const targetAccount = accounts
        .map(asRecord)
        .find((account) => stringValue(account.id) === target.accountId);
    return {
        loggedIn: Boolean(object.loggedIn),
        authType: stringValue(object.authType),
        emailRedacted: Boolean(stringValue(object.email)),
        accountName: targetAccount ? target.accountLabel : '',
        targetAccountFound: Boolean(targetAccount),
        accountCount: accounts.length,
    };
}

function summarizeWorkerStatus(value: unknown, stderr: string, exitCode: number | null): Record<string, unknown> {
    const versions = asArray(asRecord(value).versions)
        .map(asRecord)
        .map((version) => ({
            versionId: stringValue(version.version_id),
            percentage: finiteNumber(version.percentage),
        }))
        .filter((version) => Boolean(version.versionId))
        .sort((left, right) => (right.percentage ?? -1) - (left.percentage ?? -1));
    return {
        state: exitCode === 0 && versions.length > 0 ? 'ready' : 'expected-not-ready',
        primaryVersionId: versions[0]?.versionId ?? '',
        currentVersions: versions,
        notFound: isCloudflareScriptNotFound(stderr),
        errorPreview: exitCode === 0 ? null : compactText(stderr),
    };
}

function summarizeVersionBindings(value: unknown, stderr: string, exitCode: number | null): Record<string, unknown> {
    const object = asRecord(value);
    const bindings = asArray(asRecord(object.resources).bindings)
        .map(asRecord)
        .map(safeBindingProjection)
        .filter((binding) => Boolean(binding.name))
        .sort((left, right) => left.name.localeCompare(right.name));
    const safeValues = Object.fromEntries(bindings
        .filter((binding) => binding.safeValue !== undefined)
        .map((binding) => [binding.name, binding.safeValue]));
    const safeTargets = Object.fromEntries(bindings
        .filter((binding) => binding.safeTarget !== undefined)
        .map((binding) => [binding.name, binding.safeTarget]));
    return {
        state: exitCode === 0 && stringValue(object.id) ? 'ready' : 'expected-not-ready',
        versionId: stringValue(object.id),
        bindingNames: bindings.map((binding) => binding.name),
        bindings,
        safeValues,
        safeTargets,
        notFound: isCloudflareScriptNotFound(stderr),
        errorPreview: exitCode === 0 ? null : compactText(stderr),
        rawBindingValuesStored: false,
    };
}

function safeBindingProjection(binding: Record<string, unknown>): {
    name: string;
    type: string;
    safeValue?: string;
    safeTarget?: string;
} {
    const name = stringValue(binding.name);
    const type = stringValue(binding.type);
    const projected: {
        name: string;
        type: string;
        safeValue?: string;
        safeTarget?: string;
    } = { name, type };
    if (safePlainTextBindingValueNames.has(name)) {
        const value = stringValue(binding.text) || stringValue(binding.value);
        if (value) projected.safeValue = value;
    }
    if (safeTargetBindingValueNames.has(name)) {
        const safeTarget = stringValue(binding.service)
            || stringValue(binding.queue_name)
            || stringValue(binding.queue);
        if (safeTarget) projected.safeTarget = safeTarget;
    }
    return projected;
}

function summarizePagesProjects(value: unknown): Record<string, unknown> {
    const projects = asArray(value).map(asRecord);
    const project = projects.find((candidate) =>
        stringValue(candidate['Project Name']) === target.pagesProject
        || stringValue(candidate.name) === target.pagesProject
    );
    const rawDomains = stringValue(project?.['Project Domains'])
        || asArray(project?.domains).map(String).join(', ');
    const domainNames = rawDomains
        .split(',')
        .map((domain) => domain.trim())
        .filter(Boolean);
    return {
        projectFound: Boolean(project),
        projectName: stringValue(project?.['Project Name']) || stringValue(project?.name),
        domainNames,
        requiredDomainsPresent: target.customDomains.every((domain) => domainNames.includes(domain)),
        projectCount: projects.length,
    };
}

function summarizePagesDeployments(value: unknown): Record<string, unknown> {
    const deployments = asArray(value).map(asRecord);
    const latest = deployments[0] ?? {};
    return {
        count: deployments.length,
        latestId: stringValue(latest.Id) || stringValue(latest.id),
        latestEnvironment: stringValue(latest.Environment) || stringValue(latest.environment),
        latestBranch: stringValue(latest.Branch) || stringValue(asRecord(asRecord(latest.deployment_trigger).metadata).branch),
        latestSource: stringValue(latest.Source) || stringValue(asRecord(asRecord(latest.deployment_trigger).metadata).commit_hash),
        latestDeployment: stringValue(latest.Deployment) || stringValue(latest.url),
        latestStatus: stringValue(latest.Status) || stringValue(latest.created_on),
    };
}

function summarizeWorkerDeployments(value: unknown, stderr: string, exitCode: number | null): Record<string, unknown> {
    const deployments = asArray(value).map(asRecord);
    const latest = newestWorkerDeployment(deployments) ?? {};
    const versions = asArray(latest.versions).map(asRecord);
    return {
        count: exitCode === 0 ? deployments.length : 0,
        latestId: stringValue(latest.id),
        latestCreatedOn: stringValue(latest.created_on),
        latestVersionId: stringValue(versions[0]?.version_id),
        notFound: isCloudflareScriptNotFound(stderr),
        errorPreview: exitCode === 0 ? null : compactText(stderr),
    };
}

function summarizeSecrets(value: unknown, stderr: string, exitCode: number | null): Record<string, unknown> {
    const secrets = asArray(value).map(asRecord);
    const names = exitCode === 0
        ? secrets.map((secret) => stringValue(secret.name)).filter(Boolean).sort()
        : [];
    return {
        count: names.length,
        names,
        notFound: isCloudflareScriptNotFound(stderr),
        errorPreview: exitCode === 0 ? null : compactText(stderr),
    };
}

function probe(results: ProbeResult[], id: string): ProbeResult {
    const result = results.find((candidate) => candidate.id === id);
    if (!result) throw new Error(`Missing probe ${id}`);
    return result;
}

function onlyReadCommands(results: ProbeResult[]): boolean {
    return results.every((result) => result.command.startsWith('not-run:') || isAllowlistedWranglerCommand(result.command));
}

function isAllowlistedWranglerCommand(command: string): boolean {
    const prefix = 'pnpm --config.verify-deps-before-run=false exec wrangler ';
    if (!command.startsWith(prefix)) return false;
    return isAllowlistedWranglerRead(command.slice(prefix.length).split(' '));
}

function isAllowlistedWranglerRead(args: string[]): boolean {
    const normalized = args.at(-1) === '--install-skills=false' ? args.slice(0, -1) : args;
    if (normalized.length === 1 && normalized[0] === '--version') return true;
    if (arraysEqual(normalized, ['whoami', '--json'])) return true;
    if (arraysEqual(normalized, ['pages', 'project', 'list', '--json'])) return true;
    if (normalized.length === 8
        && arraysEqual(normalized.slice(0, 3), ['pages', 'deployment', 'list'])
        && normalized[3] === '--project-name'
        && normalized[4] === target.pagesProject
        && normalized[5] === '--environment'
        && ['production', 'preview'].includes(normalized[6])
        && normalized[7] === '--json') return true;
    if (normalized.length === 5
        && normalized[0] === 'deployments'
        && ['list', 'status'].includes(normalized[1])
        && normalized[2] === '--name'
        && [target.stagingWorker, target.productionWorker, target.productionFulfillmentWorker].includes(normalized[3])
        && normalized[4] === '--json') return true;
    if (normalized.length === 6
        && arraysEqual(normalized.slice(0, 2), ['secret', 'list'])
        && normalized[2] === '--name'
        && [target.stagingWorker, target.productionWorker, target.productionFulfillmentWorker].includes(normalized[3])
        && arraysEqual(normalized.slice(4), ['--format', 'json'])) return true;
    return normalized.length === 6
        && arraysEqual(normalized.slice(0, 2), ['versions', 'view'])
        && /^[0-9a-f-]{36}$/iu.test(normalized[2] ?? '')
        && normalized[3] === '--name'
        && [target.productionWorker, target.productionFulfillmentWorker].includes(normalized[4])
        && normalized[5] === '--json';
}

function parseJsonFromWrangler(output: string): unknown | null {
    const candidate = extractJsonValue(stripAnsi(output));
    if (!candidate) return null;
    try {
        return JSON.parse(candidate);
    } catch {
        return null;
    }
}

function extractJsonValue(value: string): string | null {
    const objectStart = value.indexOf('{');
    const arrayStart = value.indexOf('[');
    const starts = [objectStart, arrayStart].filter((index) => index >= 0);
    const start = starts.length > 0 ? Math.min(...starts) : -1;
    if (start < 0) return null;
    const opener = value[start];
    const closer = opener === '[' ? ']' : '}';
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let index = start; index < value.length; index += 1) {
        const char = value[index];
        if (inString) {
            if (escaped) {
                escaped = false;
            } else if (char === '\\') {
                escaped = true;
            } else if (char === '"') {
                inString = false;
            }
            continue;
        }

        if (char === '"') {
            inString = true;
            continue;
        }

        if (char === opener) depth += 1;
        if (char === closer) depth -= 1;
        if (depth === 0) return value.slice(start, index + 1);
    }

    return value.slice(start).trim();
}

function probeMessage(
    config: ProbeConfig,
    exitCode: number | null,
    parsedJson: unknown,
    stderr: string,
    error: Error | undefined,
): string {
    if (error) return safeErrorMessage(error);
    if (config.expectJson && exitCode === 0 && parsedJson === null) return 'Command exited 0 but JSON output could not be parsed.';
    if (exitCode === 0) return 'Command completed.';
    if (config.allowFailure) return compactText(stderr) || `Command exited ${exitCode ?? 'unknown'}; captured as warning.`;
    return compactText(stderr) || `Command exited ${exitCode ?? 'unknown'}.`;
}

function renderJsonReport(report: Report): Record<string, unknown> {
    return {
        schemaVersion: report.schemaVersion,
        startedAt: report.startedAt,
        endedAt: report.endedAt,
        status: report.status,
        outputDir: report.outputDir,
        target: report.target,
        sourceIdentity: report.sourceIdentity,
        apiInventory: report.apiInventory,
        probes: report.probes.map((result) => ({
            id: result.id,
            label: result.label,
            command: result.command,
            exitCode: result.exitCode,
            status: result.status,
            message: result.message,
            outputPath: toPosix(path.relative(process.cwd(), result.outputPath)),
            stdoutSha256: result.stdoutSha256,
            stderrSha256: result.stderrSha256,
            summary: result.summary,
        })),
        checks: report.checks,
        safety: {
            readOnly: true,
            noExternalWrites: true,
            noSecretValuesStored: true,
            noWorkerCodeDownloaded: true,
            rawVersionBindingValuesStored: false,
            directApiMethodAllowlist: ['GET'],
            safePlainTextBindingValueNames: [...safePlainTextBindingValueNames].sort(),
            safeTargetBindingValueNames: [...safeTargetBindingValueNames].sort(),
            env: {
                CI: 'true',
                WRANGLER_SEND_METRICS: 'false',
            },
            forbidden: [
                'deploy',
                'delete',
                'secret put',
                'secret delete',
                'pages deploy',
                'pages project create',
                'rollback',
                'triggers',
                'DNS/domain move',
                'Worker code download',
                'unredacted version binding values',
            ],
        },
    };
}

function renderMarkdown(report: Report): string {
    const lines = [
        '# Cloudflare Production Runtime Read-Only Evidence',
        '',
        `- Status: ${report.status}`,
        `- Started: ${report.startedAt}`,
        `- Ended: ${report.endedAt}`,
        `- Target account: ${report.target.accountLabel} (${report.target.accountId})`,
        `- Pages project: ${report.target.pagesProject}`,
        `- Workers: web=${report.target.productionWorker}; fulfillment=${report.target.productionFulfillmentWorker}; staging web=${report.target.stagingWorker}`,
        `- Domains: ${report.target.customDomains.join(', ')}`,
        `- Queues: primary=${report.target.productionQueue}; DLQ=${report.target.productionDeadLetterQueue}`,
        `- Git HEAD: ${report.sourceIdentity.gitHead ?? 'missing'}`,
        `- Source SHA-256: ${report.sourceIdentity.sourceSha256}`,
        `- Tracked worktree dirty: ${String(report.sourceIdentity.gitWorktreeDirty)}`,
        '',
        '## Scope',
        '',
        'This command uses allowlisted Wrangler read/list/status/version-view commands plus exact Cloudflare API GET requests only. It does not deploy, delete, upload, download Worker code, create resources, move domains, change DNS, write secrets, rotate keys, enable checkout, activate Stripe live mode or mutate Cloudflare resources. Secret probes store names only. Version metadata is projected before persistence: every binding name/type is retained, but plain values are omitted unless their name is in the explicit non-secret safety allowlist.',
        '',
        '## Current State Synopsis',
        '',
        ...currentStateSynopsis(report),
        '',
        '## Source Identity',
        '',
        '| File | SHA-256 |',
        '| --- | --- |',
        ...report.sourceIdentity.files.map((file) => `| ${file.path} | ${file.sha256} |`),
        '',
        '## Direct Cloudflare GET Inventory',
        '',
        `- API token available to this process: ${report.apiInventory.tokenAvailable}.`,
        `- Worker scripts: state=${report.apiInventory.workerScripts.state}; names=${report.apiInventory.workerScripts.names.join(',') || 'none'}.`,
        ...report.apiInventory.workerScripts.flagged.map((snapshot) =>
            `- Flagged Worker ${snapshot.name}: present=${snapshot.present}; crons=${snapshot.crons.join(',') || 'none'}; workers.dev=${String(snapshot.workersDevEnabled)}; previews=${String(snapshot.previewsEnabled)}; invocation surfaces=${snapshot.invocationSurfaces.state} (domains=${snapshot.invocationSurfaces.customDomains}, routes=${snapshot.invocationSurfaces.workerRoutes}, queues=${snapshot.invocationSurfaces.queueConsumers}, service bindings=${snapshot.invocationSurfaces.inboundServiceBindings}, tails=${snapshot.invocationSurfaces.inboundTailConsumerReferences}, email routing=${snapshot.invocationSurfaces.emailRoutingReferences}); gaps=${snapshot.gaps.join(',') || 'none'}.`),
        `- Legacy Worker deployment posture in HEAD: state=${report.apiInventory.workerScripts.legacyHeadDeployment.state}; tracked package paths=${report.apiInventory.workerScripts.legacyHeadDeployment.trackedLegacyPackagePaths.join(',') || 'none'}; working-tree package=${String(report.apiInventory.workerScripts.legacyHeadDeployment.workingTreePackagePresent)}; automatic deployment references=${report.apiInventory.workerScripts.legacyHeadDeployment.automaticDeployReferences.join(',') || 'none'}; gaps=${report.apiInventory.workerScripts.legacyHeadDeployment.gaps.join(',') || 'none'}.`,
        `- Fulfillment schedules: state=${report.apiInventory.fulfillmentSchedules.state}; crons=${report.apiInventory.fulfillmentSchedules.crons.join(',') || 'none'}.`,
        `- Queue: ${renderQueueSynopsis(report.apiInventory.queue)}.`,
        `- DLQ: ${renderQueueSynopsis(report.apiInventory.deadLetterQueue)}.`,
        `- GET captures: ${toPosix(path.relative(process.cwd(), path.join(report.outputDir, 'cloudflare_api_gets.json')))}.`,
        '',
        '## Checks',
        '',
        '| Status | Check | Message | Details |',
        '| --- | --- | --- | --- |',
        ...report.checks.map((check) => `| ${check.status} | ${check.name} | ${escapeCell(check.message)} | ${escapeCell(check.details.join(' / '))} |`),
        '',
        '## Probe Outputs',
        '',
        '| Status | Probe | Exit | Output | Summary |',
        '| --- | --- | ---: | --- | --- |',
        ...report.probes.map((result) => `| ${result.status} | ${escapeCell(result.label)} | ${result.exitCode ?? 'n/a'} | ${toPosix(path.relative(process.cwd(), result.outputPath))} | ${escapeCell(renderSummaryValue(result.summary))} |`),
        '',
        '## Final Closure Note',
        '',
        'This evidence supports `integration_readiness`, `seo_llm_final` and `final_smoke` only as a current read-only Cloudflare posture snapshot. If the production Worker is absent or the domains still belong to Pages, keep the generated Cloudflare cutover approval phases open. Every Cloudflare write still needs separate explicit approval naming the exact account, project, Worker, domain and forbidden scope.',
        '',
    ];

    return `${lines.join('\n')}\n`;
}

function currentStateSynopsis(report: Report): string[] {
    const pagesProjects = probe(report.probes, 'pages_projects').summary as {
        domainNames?: string[];
    };
    const productionWorker = probe(report.probes, 'production_worker_deployments').summary as {
        count?: number;
        notFound?: boolean;
    };
    const stagingWorker = probe(report.probes, 'staging_worker_deployments').summary as {
        count?: number;
        latestVersionId?: string;
    };
    const productionSecrets = probe(report.probes, 'production_worker_secrets').summary as {
        names?: string[];
        notFound?: boolean;
    };
    const productionFulfillment = probe(report.probes, 'production_fulfillment_deployments').summary as {
        count?: number;
        latestVersionId?: string;
        notFound?: boolean;
    };
    const productionFulfillmentSecrets = probe(report.probes, 'production_fulfillment_secrets').summary as {
        names?: string[];
        notFound?: boolean;
    };

    return [
        `- Pages domains now visible: ${(pagesProjects.domainNames ?? []).join(', ') || 'none'}.`,
        `- Staging Worker deployments visible: ${stagingWorker.count ?? 0}; latest version: ${stagingWorker.latestVersionId ?? 'missing'}.`,
        `- Production Worker deployments visible: ${productionWorker.count ?? 0}; not found: ${Boolean(productionWorker.notFound)}.`,
        `- Production Worker secret names visible: ${(productionSecrets.names ?? []).join(', ') || 'none'}; not found: ${Boolean(productionSecrets.notFound)}.`,
        `- Production fulfillment deployments visible: ${productionFulfillment.count ?? 0}; latest version: ${productionFulfillment.latestVersionId ?? 'missing'}; not found: ${Boolean(productionFulfillment.notFound)}.`,
        `- Production fulfillment secret names visible: ${(productionFulfillmentSecrets.names ?? []).join(', ') || 'none'}; not found: ${Boolean(productionFulfillmentSecrets.notFound)}.`,
        `- Account-wide Worker scripts: ${report.apiInventory.workerScripts.state}; flagged present: ${report.apiInventory.workerScripts.flagged.filter((snapshot) => snapshot.present).map((snapshot) => snapshot.name).join(',') || 'none'}.`,
        `- Legacy reminders deployment posture in HEAD: ${report.apiInventory.workerScripts.legacyHeadDeployment.state}; tracked package paths: ${report.apiInventory.workerScripts.legacyHeadDeployment.trackedLegacyPackagePaths.length}; automatic deployment references: ${report.apiInventory.workerScripts.legacyHeadDeployment.automaticDeployReferences.length}.`,
        `- Production fulfillment Cron state: ${report.apiInventory.fulfillmentSchedules.state}; crons: ${report.apiInventory.fulfillmentSchedules.crons.join(',') || 'none'}.`,
        `- Production Queue/DLQ: ${report.apiInventory.queue.state}/${report.apiInventory.deadLetterQueue.state}.`,
    ];
}

function renderQueueSynopsis(snapshot: QueueInventorySnapshot): string {
    return [
        `name=${snapshot.name}`,
        `state=${snapshot.state}`,
        `id=${snapshot.id ?? 'missing'}`,
        `producers=${renderQueueParties(snapshot.producers)}`,
        `consumers=${renderQueueParties(snapshot.consumers)}`,
        `backlog=${snapshot.backlogAvailable ? snapshot.backlog : 'unavailable'}`,
        `settings=${renderSummaryValue(snapshot.settings)}`,
        `gaps=${snapshot.gaps.join(',') || 'none'}`,
    ].join('; ');
}

function renderQueueParties(parties: SafeQueueParty[]): string {
    return parties.map((party) => [
        party.type || 'unknown-type',
        party.worker ?? 'no-worker',
        renderSummaryValue(party.settings) || 'no-settings',
    ].join('/')).join(',') || 'none';
}

function asArray(value: unknown): unknown[] {
    return Array.isArray(value) ? value : value === null || typeof value === 'undefined' ? [] : [value];
}

function asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function arraysEqual(left: string[], right: string[]): boolean {
    return left.length === right.length && left.every((value, index) => value === right[index]);
}

function finiteNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim()) {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) return parsed;
    }
    return null;
}

function stringValue(value: unknown): string {
    return typeof value === 'string' ? value : typeof value === 'number' || typeof value === 'boolean' ? String(value) : '';
}

function pnpmCommand(): string {
    return process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
}

function sanitizeOutput(value: string): string {
    return stripAnsi(value)
        .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu, '[redacted-email]')
        .replace(/-----BEGIN [A-Z ]+PRIVATE KEY-----[\s\S]*?-----END [A-Z ]+PRIVATE KEY-----/g, '[redacted-private-key]')
        .replace(/sk_(live|test)_[A-Za-z0-9]{20,}/g, 'sk_$1_[redacted]')
        .replace(/whsec_[A-Za-z0-9]{20,}/g, 'whsec_[redacted]')
        .replace(/sb_secret_[A-Za-z0-9_-]{20,}/g, 'sb_secret_[redacted]')
        .replace(/AIza[0-9A-Za-z_-]{30,}/g, 'AIza[redacted]')
        .replace(/(?<![A-Za-z0-9_])re_[A-Za-z0-9_]{20,}/g, 're_[redacted]')
        .replace(/(postgres|postgresql):\/\/[^\s"']+:[^\s"']+@/giu, '$1://[redacted-user]:[redacted-password]@')
        .replace(/Bearer\s+[A-Za-z0-9._-]{20,}/gi, 'Bearer [redacted]');
}

function stripAnsi(value: string): string {
    const escape = String.fromCharCode(27);
    return value.replace(new RegExp(`${escape}\\[[0-?]*[ -/]*[@-~]`, 'g'), '');
}

function safeErrorMessage(error: Error): string {
    return sanitizeOutput(error.message).replace(/\r?\n/g, ' ').slice(0, 500);
}

function compactText(value: string): string {
    return value.replace(/\s+/g, ' ').trim().slice(0, 500);
}

function isCloudflareScriptNotFound(stderr: string): boolean {
    return /code:\s*10007|workers\.api\.error\.script_not_found|script_not_found|not found/iu.test(stderr);
}

function renderSummaryValue(value: Record<string, unknown>): string {
    return Object.entries(value)
        .map(([key, entry]) => `${key}=${Array.isArray(entry) ? entry.join(',') : String(entry ?? 'null')}`)
        .join('; ');
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

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
