import * as dotenv from 'dotenv';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

type Status = 'ok' | 'warning' | 'failed';

interface Check {
    status: Status;
    name: string;
    message: string;
    details?: string[];
}

interface Report {
    schemaVersion: 1;
    startedAt: string;
    endedAt: string;
    status: 'OK' | 'WARNING' | 'FAILED';
    outputDir: string;
    envFile: string;
    checks: Check[];
}

type ApiResult = {
    success?: boolean;
    errors?: Array<{ code?: number; message?: string }>;
    messages?: unknown[];
    result?: unknown;
};

type TurnstileWidget = {
    sitekey?: string;
    name?: string;
    domains?: string[];
    mode?: string;
    clearance_level?: string;
    created_on?: string;
    modified_on?: string;
};

const envFile = readArgValue('--env-file') || '.env';
dotenv.config({ path: envFile, quiet: true });

const startedAt = new Date();
const outputDir = path.join(process.cwd(), 'outputs', 'launch-turnstile-readonly-evidence', stamp(startedAt));
mkdirSync(outputDir, { recursive: true });

const siteKey = process.env.PUBLIC_TURNSTILE_SITE_KEY;
const secretKey = process.env.TURNSTILE_SECRET_KEY;
const cloudflareApiToken = process.env.CLOUDFLARE_API_TOKEN;
const cloudflareAccountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const expectedDomains = expectedTurnstileDomains();

const checks: Check[] = [checkEnvironment()];

if (secretKey) {
    checks.push(await checkFakeTokenRejection());
}

if (cloudflareApiToken && cloudflareAccountId) {
    checks.push(await checkCloudflareToken());
    const widgetCheck = await checkTurnstileWidgetList();
    checks.push(widgetCheck);
}

const failed = checks.filter((check) => check.status === 'failed');
const warnings = checks.filter((check) => check.status === 'warning');
const status: Report['status'] = failed.length > 0 ? 'FAILED' : warnings.length > 0 ? 'WARNING' : 'OK';

const report: Report = {
    schemaVersion: 1,
    startedAt: startedAt.toISOString(),
    endedAt: new Date().toISOString(),
    status,
    outputDir,
    envFile,
    checks,
};

writeFileSync(path.join(outputDir, 'summary.json'), JSON.stringify(report, null, 2), 'utf8');
writeFileSync(path.join(outputDir, 'summary.md'), renderMarkdown(report), 'utf8');

console.log(`[launch:turnstile-readonly] Status: ${status}`);
console.log(`[launch:turnstile-readonly] Failed: ${failed.length}`);
console.log(`[launch:turnstile-readonly] Warnings: ${warnings.length}`);
console.log(`[launch:turnstile-readonly] Summary: ${path.join(outputDir, 'summary.md')}`);

if (failed.length > 0) process.exit(1);

function checkEnvironment(): Check {
    const missingRequired = [
        ['PUBLIC_TURNSTILE_SITE_KEY', siteKey],
        ['TURNSTILE_SECRET_KEY', secretKey],
    ].filter(([, value]) => !value).map(([key]) => key);
    const missingCloudflareApi = [
        ['CLOUDFLARE_ACCOUNT_ID', cloudflareAccountId],
        ['CLOUDFLARE_API_TOKEN', cloudflareApiToken],
    ].filter(([, value]) => !value).map(([key]) => key);
    const siteKeyShape = siteKey?.startsWith('0x') ? 'present_turnstile_shape' : siteKey ? 'present_unrecognized' : 'missing';
    const secretShape = secretKey?.startsWith('0x') ? 'present_turnstile_shape' : secretKey ? 'present_unrecognized' : 'missing';

    return {
        status: missingRequired.length > 0 ? 'failed' : missingCloudflareApi.length > 0 ? 'warning' : 'ok',
        name: 'environment_shape',
        message: missingRequired.length === 0 && missingCloudflareApi.length === 0
            ? 'Turnstile runtime and Cloudflare read-only API inputs are present.'
            : 'Turnstile runtime or Cloudflare read-only API inputs are incomplete.',
        details: [
            `env_file=${envFile}`,
            `missing_required=${missingRequired.length === 0 ? 'none' : missingRequired.join(', ')}`,
            `missing_cloudflare_api=${missingCloudflareApi.length === 0 ? 'none' : missingCloudflareApi.join(', ')}`,
            `site_key=${compactId(siteKey)}`,
            `site_key_shape=${siteKeyShape}`,
            `secret_key=${secretShape}`,
            `account=${compactId(cloudflareAccountId)}`,
            `expected_domains=${expectedDomains.join('|')}`,
        ],
    };
}

async function checkFakeTokenRejection(): Promise<Check> {
    try {
        const body = new URLSearchParams({
            secret: secretKey ?? '',
            response: `codex-invalid-token-${startedAt.getTime()}`,
        });
        const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
            method: 'POST',
            body,
        });
        const payload = await response.json() as { success?: boolean; 'error-codes'?: string[] };
        const errorCodes = payload['error-codes'] ?? [];
        const secretError = errorCodes.some((code) => code === 'invalid-input-secret' || code === 'missing-input-secret');
        const ok = response.ok && payload.success === false && !secretError;

        return {
            status: ok ? 'ok' : 'failed',
            name: 'siteverify_fake_token_rejection',
            message: ok
                ? 'Turnstile siteverify is reachable and rejects a deliberately invalid token without reporting a secret-key error.'
                : 'Turnstile siteverify did not reject the invalid token in the expected way.',
            details: [
                `http_status=${response.status}`,
                `success=${Boolean(payload.success)}`,
                `error_codes=${errorCodes.join('|') || 'none'}`,
                `secret_error=${secretError}`,
            ],
        };
    } catch (error) {
        return {
            status: 'failed',
            name: 'siteverify_fake_token_rejection',
            message: 'Turnstile siteverify could not be queried with a fake token.',
            details: [safeErrorMessage(error)],
        };
    }
}

async function checkCloudflareToken(): Promise<Check> {
    try {
        const payload = await cloudflareGet('/user/tokens/verify');
        const result = isRecord(payload.result) ? payload.result : {};
        const active = result.status === 'active';

        return {
            status: payload.success && active ? 'ok' : 'failed',
            name: 'cloudflare_api_token_readonly',
            message: payload.success && active
                ? 'Cloudflare API token verifies as active.'
                : 'Cloudflare API token verification did not return active.',
            details: [
                `token_id=${compactId(stringValue(result.id))}`,
                `status=${stringValue(result.status) || 'unknown'}`,
                `errors=${formatApiErrors(payload)}`,
            ],
        };
    } catch (error) {
        return {
            status: 'failed',
            name: 'cloudflare_api_token_readonly',
            message: 'Cloudflare API token could not be verified.',
            details: [safeErrorMessage(error)],
        };
    }
}

async function checkTurnstileWidgetList(): Promise<Check> {
    try {
        const payload = await cloudflareGet(`/accounts/${cloudflareAccountId}/challenges/widgets`);
        const widgets = normalizeWidgets(payload.result);
        const matchedWidget = widgets.find((widget) => widget.sitekey === siteKey);
        const domains = matchedWidget?.domains?.map(normalizeDomain).filter(Boolean) ?? [];
        const missingExpectedDomains = expectedDomains.filter((domain) => !domainAllowed(domain, domains));

        if (!payload.success) {
            return {
                status: 'failed',
                name: 'turnstile_widgets_readonly',
                message: 'Cloudflare Turnstile widgets could not be listed successfully.',
                details: [
                    `account=${compactId(cloudflareAccountId)}`,
                    `errors=${formatApiErrors(payload)}`,
                ],
            };
        }

        if (!matchedWidget) {
            return {
                status: 'failed',
                name: 'turnstile_widgets_readonly',
                message: 'Configured PUBLIC_TURNSTILE_SITE_KEY was not found among Cloudflare Turnstile widgets.',
                details: [
                    `account=${compactId(cloudflareAccountId)}`,
                    `widgets=${widgets.length}`,
                    `configured_site_key=${compactId(siteKey)}`,
                    `widget_site_keys=${widgets.map((widget) => compactId(widget.sitekey)).join('|') || 'none'}`,
                ],
            };
        }

        return {
            status: missingExpectedDomains.length > 0 ? 'warning' : 'ok',
            name: 'turnstile_widgets_readonly',
            message: missingExpectedDomains.length === 0
                ? 'Configured Turnstile site key exists in Cloudflare and covers the expected launch hostnames.'
                : 'Configured Turnstile site key exists, but one or more expected hostnames need dashboard review.',
            details: [
                `account=${compactId(cloudflareAccountId)}`,
                `widgets=${widgets.length}`,
                `matched_site_key=${compactId(matchedWidget.sitekey)}`,
                `name=${safeName(matchedWidget.name)}`,
                `mode=${matchedWidget.mode ?? 'unknown'}`,
                `clearance_level=${matchedWidget.clearance_level ?? 'unknown'}`,
                `domains=${domains.join('|') || 'none'}`,
                `expected_domains=${expectedDomains.join('|')}`,
                `missing_expected_domains=${missingExpectedDomains.join('|') || 'none'}`,
                `created=${matchedWidget.created_on ?? 'unknown'}`,
                `modified=${matchedWidget.modified_on ?? 'unknown'}`,
            ],
        };
    } catch (error) {
        return {
            status: 'failed',
            name: 'turnstile_widgets_readonly',
            message: 'Cloudflare Turnstile widgets could not be read.',
            details: [safeErrorMessage(error)],
        };
    }
}

async function cloudflareGet(pathname: string): Promise<ApiResult> {
    const response = await fetch(`https://api.cloudflare.com/client/v4${pathname}`, {
        method: 'GET',
        headers: {
            Authorization: `Bearer ${cloudflareApiToken}`,
            'Content-Type': 'application/json',
        },
    });
    const payload = await response.json() as ApiResult;
    if (!response.ok && payload.success !== false) {
        return {
            success: false,
            errors: [{ code: response.status, message: response.statusText }],
            result: payload,
        };
    }
    return payload;
}

function normalizeWidgets(value: unknown): TurnstileWidget[] {
    const rows = Array.isArray(value)
        ? value
        : isRecord(value) && Array.isArray(value.result)
            ? value.result
            : [];

    return rows.filter(isRecord).map((row) => ({
        sitekey: stringValue(row.sitekey),
        name: stringValue(row.name),
        domains: Array.isArray(row.domains) ? row.domains.map(stringValue).filter(Boolean) : [],
        mode: stringValue(row.mode),
        clearance_level: stringValue(row.clearance_level),
        created_on: stringValue(row.created_on),
        modified_on: stringValue(row.modified_on),
    }));
}

function expectedTurnstileDomains(): string[] {
    const explicit = process.env.TURNSTILE_EXPECTED_DOMAINS;
    const raw = explicit
        ? explicit.split(',')
        : [
            'espanolhonesto.com',
            'www.espanolhonesto.com',
            'staging.espanolhonesto.com',
        ];
    return [...new Set(raw.map(normalizeDomain).filter(Boolean))].sort();
}

function domainAllowed(domain: string, configuredDomains: string[]): boolean {
    if (configuredDomains.includes(domain)) return true;
    return configuredDomains.includes(`*.${domain.split('.').slice(-2).join('.')}`);
}

function normalizeDomain(value: string | null | undefined): string {
    if (!value) return '';
    const trimmed = value.trim().toLowerCase();
    if (!trimmed) return '';
    try {
        return new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`).hostname;
    } catch {
        return trimmed.replace(/^https?:\/\//, '').split('/')[0];
    }
}

function readArgValue(flag: string): string | null {
    const index = process.argv.indexOf(flag);
    if (index === -1) return null;
    const value = process.argv[index + 1];
    return value && !value.startsWith('--') ? value : null;
}

function compactId(id: string | null | undefined): string {
    if (!id) return 'missing';
    if (id.length <= 12) return id;
    return `${id.slice(0, 8)}...${id.slice(-6)}`;
}

function safeName(value: string | null | undefined): string {
    if (!value) return 'missing';
    return value.replace(/\|/g, '/').replace(/\r?\n/g, ' ').slice(0, 80);
}

function safeErrorMessage(error: unknown): string {
    let message = error instanceof Error ? error.message : String(error);
    for (const secret of [cloudflareApiToken, secretKey]) {
        if (secret) message = message.replaceAll(secret, '[redacted]');
    }
    return message.replace(/\r?\n/g, ' ').slice(0, 500);
}

function formatApiErrors(payload: ApiResult): string {
    const errors = payload.errors ?? [];
    if (errors.length === 0) return 'none';
    return errors.map((error) => `${error.code ?? 'unknown'}:${safeName(error.message)}`).join('|');
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string {
    return typeof value === 'string' ? value : '';
}

function renderMarkdown(report: Report): string {
    const lines = [
        '# Turnstile Read-Only Evidence',
        '',
        `- Status: ${report.status}`,
        `- Started: ${report.startedAt}`,
        `- Ended: ${report.endedAt}`,
        `- Output: ${report.outputDir}`,
        `- Env file: ${report.envFile}`,
        '',
        '## Scope',
        '',
        'This check is read-only for Cloudflare configuration. It verifies the Cloudflare API token status, lists Turnstile widgets, compares the configured public site key with the Cloudflare widget list, checks expected hostnames, and sends one deliberately invalid token to Turnstile siteverify to confirm rejection without a secret-key error. It does not create, update, rotate, delete, deploy, tail logs, change hostnames, retrieve secret values, or write Supabase.',
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
    lines.push('## Final Closure Note');
    lines.push('');
    lines.push('This evidence supports Turnstile integration readiness only. It does not replace final dashboard review, live-domain browser challenge rendering, real form submission with a valid browser token, key rotation review, or final production smoke.');
    lines.push('');

    return `${lines.join('\n')}\n`;
}

function escapeCell(value: string): string {
    return value.replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
}

function stamp(date: Date): string {
    return date.toISOString().replaceAll(':', '-').replaceAll('.', '-');
}
