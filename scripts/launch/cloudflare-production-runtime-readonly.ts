import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { newestWorkerDeployment } from './cloudflare-deployment-order';

type CheckStatus = 'ok' | 'warning' | 'failed';

interface Target {
    accountId: string;
    accountLabel: string;
    pagesProject: string;
    productionWorker: string;
    stagingWorker: string;
    customDomains: string[];
}

interface ProbeConfig {
    id: string;
    label: string;
    args: string[];
    expectJson: boolean;
    allowFailure: boolean;
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
    parsedJson: unknown | null;
    summary: Record<string, unknown>;
}

interface Check {
    status: CheckStatus;
    name: string;
    message: string;
    details: string[];
}

interface Report {
    schemaVersion: 1;
    startedAt: string;
    endedAt: string;
    status: 'OK' | 'WARNING' | 'FAILED';
    outputDir: string;
    target: Target;
    probes: ProbeResult[];
    checks: Check[];
    summaryPath: string;
}

const target: Target = {
    accountId: 'd1a22bcf6477ff2ff31d2bfb83084e44',
    accountLabel: "Alindev95@gmail.com's Account",
    pagesProject: 'espanolhonesto',
    productionWorker: 'espanolhonesto',
    stagingWorker: 'espanolhonesto-staging',
    customDomains: ['espanolhonesto.com', 'www.espanolhonesto.com'],
};

const requiredProductionWorkerSecretNames = [
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
        allowFailure: false,
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
];

const startedAt = new Date();
const outputDir = path.join(process.cwd(), 'outputs', 'launch-cloudflare-production-runtime-readonly', stamp(startedAt));
mkdirSync(outputDir, { recursive: true });

const probes = probeConfigs.map(runProbe);
const checks = buildChecks(probes);
const failed = checks.filter((check) => check.status === 'failed');
const warnings = checks.filter((check) => check.status === 'warning');
const status: Report['status'] = failed.length > 0 ? 'FAILED' : warnings.length > 0 ? 'WARNING' : 'OK';

const report: Report = {
    schemaVersion: 1,
    startedAt: startedAt.toISOString(),
    endedAt: new Date().toISOString(),
    status,
    outputDir,
    target,
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

if (failed.length > 0) process.exit(1);

function runProbe(config: ProbeConfig): ProbeResult {
    const outputPath = path.join(outputDir, `${config.id}.txt`);
    const result = spawnSync(corepackCommand(), [
        'pnpm',
        '--config.verify-deps-before-run=false',
        'exec',
        'wrangler',
        ...config.args,
    ], {
        env: {
            ...process.env,
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
    const command = `corepack pnpm --config.verify-deps-before-run=false exec wrangler ${config.args.join(' ')}`;
    const parseFailed = config.expectJson && exitCode === 0 && parsedJson === null;
    const unexpectedFailure = exitCode !== 0 && !config.allowFailure;
    const statusForProbe: CheckStatus = unexpectedFailure || parseFailed || result.error ? 'failed' : exitCode === 0 ? 'ok' : 'warning';
    const message = probeMessage(config, exitCode, parsedJson, stderr, result.error);

    writeFileSync(outputPath, [
        `# ${config.label}`,
        '',
        `command=${command}`,
        `exitCode=${exitCode ?? 'unknown'}`,
        `status=${statusForProbe}`,
        '',
        '# stdout',
        stdout,
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
        stdoutSha256: sha256(stdout),
        stderrSha256: sha256(stderr),
        parsedJson,
        summary: summarizeProbe(config.id, parsedJson, stdout, stderr, exitCode),
    };
}

function buildChecks(results: ProbeResult[]): Check[] {
    const whoami = probe(results, 'whoami');
    const pagesProjects = probe(results, 'pages_projects');
    const pagesProduction = probe(results, 'pages_production_deployments');
    const stagingWorker = probe(results, 'staging_worker_deployments');
    const productionWorker = probe(results, 'production_worker_deployments');
    const stagingSecrets = probe(results, 'staging_worker_secrets');
    const productionSecrets = probe(results, 'production_worker_secrets');

    const authSummary = whoami.summary as {
        loggedIn?: boolean;
        targetAccountFound?: boolean;
        email?: string;
        accountName?: string;
    };
    const pagesSummary = pagesProjects.summary as {
        projectFound?: boolean;
        domainNames?: string[];
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
    const stagingSecretSummary = stagingSecrets.summary as {
        names?: string[];
    };
    const productionSecretSummary = productionSecrets.summary as {
        names?: string[];
        notFound?: boolean;
        errorPreview?: string;
    };
    const productionSecretNames = productionSecretSummary.names ?? [];
    const missingProductionSecrets = requiredProductionWorkerSecretNames.filter((name) => !productionSecretNames.includes(name));

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
            status: authSummary.loggedIn && authSummary.targetAccountFound ? 'ok' : 'failed',
            name: 'cloudflare_account_auth',
            message: authSummary.loggedIn && authSummary.targetAccountFound
                ? 'Wrangler is logged in and the target Cloudflare account is visible.'
                : 'Wrangler auth did not prove access to the intended Cloudflare account.',
            details: [
                `email=${authSummary.email ?? 'unknown'}`,
                `account=${authSummary.accountName ?? 'missing'}`,
                `targetAccountId=${target.accountId}`,
            ],
        },
        {
            status: pagesSummary.projectFound ? 'warning' : 'failed',
            name: 'pages_project_current_domain_owner',
            message: pagesSummary.projectFound
                ? 'Pages project exists and currently owns the production custom domains; production domain cutover is still a final-window task.'
                : 'Pages project could not be found, so current production-domain ownership cannot be verified.',
            details: [
                `project=${target.pagesProject}`,
                `domains=${(pagesSummary.domainNames ?? []).join(',') || 'none'}`,
                `expectedDomains=${target.customDomains.join(',')}`,
            ],
        },
        {
            status: (pagesProductionSummary.count ?? 0) > 0 ? 'warning' : 'failed',
            name: 'pages_production_deployment_posture',
            message: (pagesProductionSummary.count ?? 0) > 0
                ? 'Pages production deployments are visible; current production custom domains still appear tied to the old Pages deployment line.'
                : 'No Pages production deployment was visible for the production project.',
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
            status: (productionWorkerSummary.count ?? 0) > 0 ? 'ok' : 'warning',
            name: 'production_worker_exists',
            message: (productionWorkerSummary.count ?? 0) > 0
                ? 'Production Worker deployments are visible.'
                : 'Production Worker is not visible yet; Worker creation/deploy remains pending and requires separate explicit Cloudflare approval.',
            details: [
                `worker=${target.productionWorker}`,
                `count=${productionWorkerSummary.count ?? 0}`,
                `latestVersion=${productionWorkerSummary.latestVersionId ?? 'missing'}`,
                `notFound=${Boolean(productionWorkerSummary.notFound)}`,
                `error=${productionWorkerSummary.errorPreview ?? 'none'}`,
            ],
        },
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
            status: productionSecretNames.length > 0 && missingProductionSecrets.length === 0 ? 'ok' : 'warning',
            name: 'production_worker_secret_names',
            message: productionSecretNames.length > 0 && missingProductionSecrets.length === 0
                ? 'Production Worker required secret names are present by name only.'
                : 'Production Worker secret names are absent or incomplete; secret-name loading remains a separate final-window phase.',
            details: [
                `worker=${target.productionWorker}`,
                `visibleNames=${productionSecretNames.join(',') || 'none'}`,
                `missingRequiredNames=${missingProductionSecrets.join(',') || 'none'}`,
                `notFound=${Boolean(productionSecretSummary.notFound)}`,
                `error=${productionSecretSummary.errorPreview ?? 'none'}`,
            ],
        },
        validateWranglerConfig(),
        validateGeneratedOutputPosture(results),
    ];

    return checks;
}

function validateWranglerConfig(): Check {
    const wranglerPath = 'wrangler.toml';
    if (!existsSync(wranglerPath)) {
        return {
            status: 'failed',
            name: 'local_wrangler_config_fail_closed',
            message: 'wrangler.toml is missing.',
            details: [wranglerPath],
        };
    }

    const wrangler = readFileSync(wranglerPath, 'utf8');
    const checkoutFalseCount = [...wrangler.matchAll(/CHECKOUT_ENABLED\s*=\s*"false"/g)].length;
    const required = [
        'name = "espanolhonesto-env-required"',
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
        name: 'local_wrangler_config_fail_closed',
        message: missing.length === 0
            ? 'Local Wrangler config uses a safe base name and preserves separate staging/production Worker names with fail-closed checkout posture.'
            : 'Local Wrangler config is missing required production/staging names or checkout-disabled posture.',
        details: missing.length === 0 ? [`checkoutFalseCount=${checkoutFalseCount}`, wranglerPath] : missing.map((snippet) => `missing=${snippet}`),
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
            return summarizeWorkerDeployments(parsedJson, stderr, exitCode);
        case 'staging_worker_secrets':
        case 'production_worker_secrets':
            return summarizeSecrets(parsedJson, stderr, exitCode);
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
        email: stringValue(object.email),
        accountName: stringValue(targetAccount?.name),
        targetAccountFound: Boolean(targetAccount),
        accountCount: accounts.length,
    };
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
    const forbiddenPatterns = [
        /\bwrangler\s+deploy\b/u,
        /\bwrangler\s+delete\b/u,
        /\bwrangler\s+secret\s+put\b/u,
        /\bwrangler\s+secret\s+delete\b/u,
        /\bwrangler\s+pages\s+deploy\b/u,
        /\bwrangler\s+pages\s+project\s+create\b/u,
        /\bwrangler\s+rollback\b/u,
        /\bwrangler\s+triggers\b/u,
    ];
    return results.every((result) => !forbiddenPatterns.some((pattern) => pattern.test(result.command)));
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
        `- Workers: production=${report.target.productionWorker}; staging=${report.target.stagingWorker}`,
        `- Domains: ${report.target.customDomains.join(', ')}`,
        '',
        '## Scope',
        '',
        'This command uses Wrangler read/list/version commands only. It does not deploy, delete, upload, create, move domains, change DNS, write secrets, rotate keys, enable checkout, activate Stripe live mode or mutate Cloudflare resources. Secret probes store names only as returned by Wrangler; values are never requested or written.',
        '',
        '## Current State Synopsis',
        '',
        ...currentStateSynopsis(report),
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

    return [
        `- Pages domains now visible: ${(pagesProjects.domainNames ?? []).join(', ') || 'none'}.`,
        `- Staging Worker deployments visible: ${stagingWorker.count ?? 0}; latest version: ${stagingWorker.latestVersionId ?? 'missing'}.`,
        `- Production Worker deployments visible: ${productionWorker.count ?? 0}; not found: ${Boolean(productionWorker.notFound)}.`,
        `- Production Worker secret names visible: ${(productionSecrets.names ?? []).join(', ') || 'none'}; not found: ${Boolean(productionSecrets.notFound)}.`,
    ];
}

function asArray(value: unknown): unknown[] {
    return Array.isArray(value) ? value : value === null || typeof value === 'undefined' ? [] : [value];
}

function asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown): string {
    return typeof value === 'string' ? value : typeof value === 'number' || typeof value === 'boolean' ? String(value) : '';
}

function corepackCommand(): string {
    return 'corepack';
}

function sanitizeOutput(value: string): string {
    return stripAnsi(value)
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
