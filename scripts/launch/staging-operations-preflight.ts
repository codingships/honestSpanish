import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

type CheckStatus = 'ok' | 'failed' | 'warning';

interface CheckResult {
    status: CheckStatus;
    name: string;
    message: string;
    details?: string[];
}

interface PreflightReport {
    schemaVersion: 1;
    startedAt: string;
    endedAt: string;
    status: 'OK' | 'WARNING' | 'FAILED';
    outputDir: string;
    targetWorkerUrl: string;
    includedWrangler: boolean;
    checks: CheckResult[];
}

const startedAt = new Date();
const outputDir = path.join(process.cwd(), 'outputs', 'launch-staging-operations-preflight', stamp(startedAt));
mkdirSync(outputDir, { recursive: true });

const workerUrl = normalizeBaseUrl(readArgValue('--worker-url') ?? 'https://espanol-honesto-fulfillment-staging.alindev95.workers.dev');
const includeWrangler = process.argv.includes('--include-wrangler');

const checks: CheckResult[] = [
    await checkWorkerHealth(workerUrl),
    await checkInternalRouteRejectsAnonymous(workerUrl),
    checkLocalWorkerCronAndObservabilityConfig(),
];

if (includeWrangler) {
    checks.push(...runWranglerReadOnlyChecks());
}

const failed = checks.filter((check) => check.status === 'failed');
const warnings = checks.filter((check) => check.status === 'warning');
const status = failed.length > 0 ? 'FAILED' : warnings.length > 0 ? 'WARNING' : 'OK';

const report: PreflightReport = {
    schemaVersion: 1,
    startedAt: startedAt.toISOString(),
    endedAt: new Date().toISOString(),
    status,
    outputDir,
    targetWorkerUrl: workerUrl,
    includedWrangler: includeWrangler,
    checks,
};

writeFileSync(path.join(outputDir, 'summary.json'), JSON.stringify(report, null, 2), 'utf8');
writeFileSync(path.join(outputDir, 'summary.md'), renderMarkdown(report), 'utf8');

console.log(`[launch:staging-operations] Status: ${status}`);
console.log(`[launch:staging-operations] Failed: ${failed.length}`);
console.log(`[launch:staging-operations] Warnings: ${warnings.length}`);
console.log(`[launch:staging-operations] Summary: ${path.join(outputDir, 'summary.md')}`);

if (failed.length > 0) process.exit(1);

async function checkWorkerHealth(baseUrl: string): Promise<CheckResult> {
    const url = `${baseUrl}/health`;
    try {
        const response = await fetchWithTimeout(url);
        const text = await response.text();
        const payload = parseJsonObject(text);
        const ok = response.status === 200
            && payload?.ok === true
            && payload.service === 'fulfillment-worker'
            && payload.runtime === 'cloudflare-workers';

        return {
            status: ok ? 'ok' : 'failed',
            name: 'worker_health',
            message: ok
                ? 'Staging fulfillment Worker health endpoint responds with the expected public health payload.'
                : 'Staging fulfillment Worker health endpoint did not return the expected status or payload.',
            details: [
                `url=${url}`,
                `status=${response.status}`,
                `service=${typeof payload?.service === 'string' ? payload.service : 'missing'}`,
                `runtime=${typeof payload?.runtime === 'string' ? payload.runtime : 'missing'}`,
            ],
        };
    } catch (error) {
        return {
            status: 'failed',
            name: 'worker_health',
            message: 'Could not reach staging fulfillment Worker health endpoint.',
            details: [`url=${url}`, errorMessage(error)],
        };
    }
}

async function checkInternalRouteRejectsAnonymous(baseUrl: string): Promise<CheckResult> {
    const url = `${baseUrl}/internal/jobs/process`;
    try {
        const response = await fetchWithTimeout(url);

        return {
            status: response.status === 401 ? 'ok' : 'failed',
            name: 'internal_route_auth',
            message: response.status === 401
                ? 'Staging internal job route rejects unauthenticated requests.'
                : 'Staging internal job route did not reject an unauthenticated request with 401.',
            details: [
                `url=${url}`,
                `status=${response.status}`,
            ],
        };
    } catch (error) {
        return {
            status: 'failed',
            name: 'internal_route_auth',
            message: 'Could not verify unauthenticated internal job route rejection.',
            details: [`url=${url}`, errorMessage(error)],
        };
    }
}

function runWranglerReadOnlyChecks(): CheckResult[] {
    return [
        runWranglerCommand('wrangler_whoami', ['exec', 'wrangler', 'whoami'], [
            'logged in',
            'Account Name',
        ]),
        runWranglerCommand('wrangler_deployments_status', ['exec', 'wrangler', 'deployments', 'status', '--env', 'staging', '--json'], [
            'version_id',
            'percentage',
        ], path.join(process.cwd(), 'workers', 'fulfillment')),
        runWranglerVersionViewCheck(),
        runWranglerCommand('wrangler_deployments_list', ['exec', 'wrangler', 'deployments', 'list', '--env', 'staging', '--json'], [
            'created_on',
            'version_id',
        ], path.join(process.cwd(), 'workers', 'fulfillment')),
        runWranglerCommand('wrangler_secret_list', ['exec', 'wrangler', 'secret', 'list', '--env', 'staging'], [
            'INTERNAL_JOB_SECRET',
            'CRON_SECRET',
            'RESEND_API_KEY',
        ], path.join(process.cwd(), 'workers', 'fulfillment')),
    ];
}

function runWranglerVersionViewCheck(): CheckResult {
    const workerCwd = path.join(process.cwd(), 'workers', 'fulfillment');
    const status = spawnSync(pnpmCommand(), ['exec', 'wrangler', 'deployments', 'status', '--env', 'staging', '--json'], {
        cwd: workerCwd,
        encoding: 'utf8',
        shell: process.platform === 'win32',
        maxBuffer: 10 * 1024 * 1024,
    });
    const statusOutput = status.stdout ?? '';
    const versionId = extractActiveVersionId(statusOutput);
    const logPath = path.join(outputDir, 'wrangler_version_view.log');

    if (status.status !== 0 || !versionId) {
        writeFileSync(logPath, [
            `$ ${pnpmCommand()} exec wrangler deployments status --env staging --json`,
            `exitCode=${status.status ?? 'null'}`,
            '',
            redactWranglerOutput(`${status.stdout ?? ''}\n${status.stderr ?? ''}`),
            status.error ? `\nerror=${status.error.message}` : '',
        ].join('\n'), 'utf8');

        return {
            status: 'failed',
            name: 'wrangler_version_view',
            message: 'Could not identify the active staging Worker version for read-only version inspection.',
            details: [
                `log=${path.relative(process.cwd(), logPath).replace(/\\/g, '/')}`,
                `exitCode=${status.status ?? 'null'}`,
                'missing=active version_id',
            ],
        };
    }

    const version = spawnSync(pnpmCommand(), ['exec', 'wrangler', 'versions', 'view', versionId, '--env', 'staging', '--json'], {
        cwd: workerCwd,
        encoding: 'utf8',
        shell: process.platform === 'win32',
        maxBuffer: 10 * 1024 * 1024,
    });
    const versionOutput = `${version.stdout ?? ''}\n${version.stderr ?? ''}`;
    const sanitized = summarizeVersionView(version.stdout ?? '');
    writeFileSync(logPath, [
        `$ ${pnpmCommand()} exec wrangler versions view ${versionId} --env staging --json`,
        `exitCode=${version.status ?? 'null'}`,
        '',
        sanitized || redactWranglerOutput(versionOutput),
        version.error ? `\nerror=${version.error.message}` : '',
    ].join('\n'), 'utf8');

    const expected = ['INTERNAL_JOB_SECRET', 'RESEND_API_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'PUBLIC_APP_ENV'];
    const missing = expected.filter((snippet) => !versionOutput.includes(snippet));

    return {
        status: version.status === 0 && missing.length === 0 ? 'ok' : 'failed',
        name: 'wrangler_version_view',
        message: version.status === 0 && missing.length === 0
            ? 'Wrangler read-only version view confirms the active staging Worker version and binding names without secret values.'
            : 'Wrangler read-only version view failed or did not include expected staging binding names.',
        details: [
            `log=${path.relative(process.cwd(), logPath).replace(/\\/g, '/')}`,
            `version_id=${versionId}`,
            `exitCode=${version.status ?? 'null'}`,
            ...(missing.length > 0 ? [`missing=${missing.join(', ')}`] : []),
        ],
    };
}

function checkLocalWorkerCronAndObservabilityConfig(): CheckResult {
    const wranglerConfigPath = path.join(process.cwd(), 'workers', 'fulfillment', 'wrangler.toml');
    if (!existsSync(wranglerConfigPath)) {
        return {
            status: 'failed',
            name: 'worker_cron_config',
            message: 'Fulfillment Worker wrangler.toml is missing.',
            details: [`path=${toPosix(path.relative(process.cwd(), wranglerConfigPath))}`],
        };
    }

    const config = readFileSync(wranglerConfigPath, 'utf8');
    const expected = [
        '[observability]',
        'enabled = true',
        '[triggers]',
        'crons = ["0 * * * *"]',
        '[env.staging]',
        'name = "espanol-honesto-fulfillment-staging"',
    ];
    const missing = expected.filter((snippet) => !config.includes(snippet));

    return {
        status: missing.length === 0 ? 'ok' : 'failed',
        name: 'worker_cron_config',
        message: missing.length === 0
            ? 'Local fulfillment Worker config includes staging name, hourly cron and observability enabled.'
            : 'Local fulfillment Worker config is missing expected staging cron or observability settings.',
        details: [
            `path=${toPosix(path.relative(process.cwd(), wranglerConfigPath))}`,
            ...(missing.length > 0 ? [`missing=${missing.join(', ')}`] : []),
        ],
    };
}

function runWranglerCommand(name: string, args: string[], expectedSnippets: string[], cwd = process.cwd()): CheckResult {
    const result = spawnSync(pnpmCommand(), args, {
        cwd,
        encoding: 'utf8',
        shell: process.platform === 'win32',
        maxBuffer: 10 * 1024 * 1024,
    });

    const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
    const missing = expectedSnippets.filter((snippet) => !output.includes(snippet));
    const logPath = path.join(outputDir, `${name}.log`);
    writeFileSync(logPath, [
        `$ ${pnpmCommand()} ${args.join(' ')}`,
        `exitCode=${result.status ?? 'null'}`,
        '',
        redactWranglerOutput(output),
        result.error ? `\nerror=${result.error.message}` : '',
    ].join('\n'), 'utf8');

    return {
        status: result.status === 0 && missing.length === 0 ? 'ok' : 'failed',
        name,
        message: result.status === 0 && missing.length === 0
            ? 'Wrangler read-only command returned the expected non-secret evidence.'
            : 'Wrangler read-only command failed or did not include expected evidence.',
        details: [
            `log=${path.relative(process.cwd(), logPath).replace(/\\/g, '/')}`,
            `exitCode=${result.status ?? 'null'}`,
            ...(missing.length > 0 ? [`missing=${missing.join(', ')}`] : []),
        ],
    };
}

function extractActiveVersionId(json: string): string | null {
    try {
        const parsed = JSON.parse(json) as { versions?: Array<{ version_id?: unknown; percentage?: unknown }> };
        const active = parsed.versions?.find((version) => version.percentage === 100 || version.percentage === '100');
        return typeof active?.version_id === 'string' ? active.version_id : null;
    } catch {
        return null;
    }
}

function summarizeVersionView(json: string): string {
    try {
        const parsed = JSON.parse(json) as {
            id?: unknown;
            number?: unknown;
            resources?: {
                bindings?: Array<{ name?: unknown; type?: unknown }>;
            };
        };
        const bindings = (parsed.resources?.bindings ?? [])
            .map((binding) => ({
                name: typeof binding.name === 'string' ? binding.name : 'unknown',
                type: typeof binding.type === 'string' ? binding.type : 'unknown',
            }));
        return JSON.stringify({
            id: parsed.id,
            number: parsed.number,
            binding_names_and_types: bindings,
        }, null, 2);
    } catch {
        return '';
    }
}

async function fetchWithTimeout(url: string): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
        return await fetch(url, {
            method: 'GET',
            redirect: 'manual',
            signal: controller.signal,
        });
    } finally {
        clearTimeout(timeout);
    }
}

function renderMarkdown(report: PreflightReport): string {
    const lines = [
        '# Staging Operations Preflight',
        '',
        `- Status: ${report.status}`,
        `- Started: ${report.startedAt}`,
        `- Ended: ${report.endedAt}`,
        `- Target Worker: ${report.targetWorkerUrl}`,
        `- Wrangler read-only checks: ${report.includedWrangler ? 'included' : 'skipped'}`,
        '',
        '## Scope',
        '',
        'This preflight is read-only. It checks public Worker health, anonymous rejection of an internal route and local Worker cron/observability config. With `--include-wrangler`, it also runs Wrangler read-only status/list commands and writes redacted logs. It does not deploy, rollback, write secrets, tail logs, send email, process jobs or touch Supabase data.',
        '',
        'Wrangler read-only commands, when requested: `wrangler whoami`, `wrangler deployments status --env staging --json`, `wrangler versions view <active-version> --env staging --json`, `wrangler deployments list --env staging --json` and `wrangler secret list --env staging`.',
        '',
        'Output root: `outputs/launch-staging-operations-preflight/<timestamp>/`.',
        '',
        '## Checks',
        '',
        '| Status | Check | Message | Details |',
        '| --- | --- | --- | --- |',
    ];

    for (const check of report.checks) {
        lines.push(`| ${check.status} | ${check.name} | ${escapeCell(check.message)} | ${escapeCell((check.details ?? []).join(' / '))} |`);
    }

    lines.push('');
    lines.push('## Still Manual For `operations_external`');
    lines.push('');
    lines.push('- Cloudflare Workers Logs/observability visibility in the dashboard or another approved read-only evidence source; cron config, staging deployment and secret-name evidence are covered above.');
    lines.push('- Resend staging delivery/suppression visibility.');
    lines.push('- Admin Jobs recovery evidence against staging UI/runtime.');
    lines.push('- Non-secret evidence recorded in `docs/launch/MANUAL_EVIDENCE.local.json` before marking `operations_external` as pass.');
    lines.push('');

    return `${lines.join('\n')}\n`;
}

function readArgValue(name: string): string | null {
    const index = process.argv.indexOf(name);
    if (index === -1) return null;
    return process.argv[index + 1] ?? null;
}

function normalizeBaseUrl(value: string): string {
    return value.replace(/\/+$/g, '');
}

function parseJsonObject(value: string): Record<string, unknown> | null {
    try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
    } catch {
        return null;
    }
}

function redactWranglerOutput(value: string): string {
    return value
        .replace(/([A-Z0-9_]*(?:SECRET|TOKEN|KEY|PASSWORD)[A-Z0-9_]*\s*[:=]\s*)[^\s,;]+/gi, '$1[redacted]')
        .replace(/Bearer\s+[A-Za-z0-9._~-]+/g, 'Bearer [redacted]')
        .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted-email]');
}

function toPosix(value: string): string {
    return value.replace(/\\/g, '/');
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? `error=${error.message}` : 'error=unknown';
}

function pnpmCommand(): string {
    return process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
}

function stamp(date: Date): string {
    return date.toISOString().replace(/[:.]/g, '-');
}

function escapeCell(value: string): string {
    return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}
