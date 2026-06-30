import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'dotenv';
import { Resend } from 'resend';

type CheckStatus = 'ok' | 'warning' | 'failed';

interface EndpointCheck {
    status: CheckStatus;
    name: string;
    httpStatus: number | null;
    message: string;
    details?: string[];
}

interface ResendReadonlyReport {
    schemaVersion: 1;
    startedAt: string;
    endedAt: string;
    status: 'OK' | 'WARNING' | 'FAILED';
    outputDir: string;
    keySource: string;
    checks: EndpointCheck[];
    domainSummary: {
        count: number;
        byStatus: Record<string, number>;
        sendingCapabilities: Record<string, number>;
        receivingCapabilities: Record<string, number>;
        byRegion: Record<string, number>;
    };
    logSummary: {
        count: number;
        byEndpoint: Record<string, number>;
        byMethod: Record<string, number>;
        byResponseStatus: Record<string, number>;
    };
    emailSummary: {
        count: number;
        hasMore: boolean;
        byLastEvent: Record<string, number>;
        scheduledCount: number;
    };
    redaction: string[];
}

type ResendResponse<T> = {
    data: T | null;
    error: {
        message?: string;
        statusCode?: number | null;
        name?: string;
    } | null;
};

type ListResponse<T> = {
    data?: T[];
    object?: string;
    has_more?: boolean;
};

type DomainItem = {
    status?: string;
    region?: string;
    capabilities?: {
        sending?: string;
        receiving?: string;
    };
};

type LogItem = {
    endpoint?: string;
    method?: string;
    response_status?: number;
};

type EmailItem = {
    last_event?: string;
    scheduled_at?: string | null;
};

const startedAt = new Date();
const outputDir = path.join(process.cwd(), 'outputs', 'resend-readonly-evidence', stamp(startedAt));
mkdirSync(outputDir, { recursive: true });

const envFile = readArgValue('--env-file');
const key = readApiKey(envFile);
const keySource = envFile ? `${envFile}:RESEND_API_KEY` : 'process.env:RESEND_API_KEY';
const redaction = [
    'No API key values are written.',
    'No recipient addresses, sender addresses, subjects, email bodies, attachment names, message ids, request bodies or response bodies are written.',
    'Domain names are not written by default; this report stores only aggregate status/capability counts.',
];

let checks: EndpointCheck[] = [];
let domainSummary = emptyDomainSummary();
let logSummary = emptyLogSummary();
let emailSummary = emptyEmailSummary();

if (!key) {
    checks = [{
        status: 'warning',
        name: 'resend_api_key_available',
        httpStatus: null,
        message: 'No Resend API key was available from the selected source.',
        details: [
            `source=${keySource}`,
            'Run with a valid staging/read-only key source, for example --env-file .dev.vars, without printing the key.',
        ],
    }];
} else if (isPlaceholderKey(key)) {
    checks = [{
        status: 'warning',
        name: 'resend_api_key_available',
        httpStatus: null,
        message: 'The selected Resend API key looks like a placeholder, so no API call was attempted.',
        details: [`source=${keySource}`],
    }];
} else {
    const resend = new Resend(key);
    const domains = await callList('domains_list', '/domains', () => resend.domains.list({ limit: 20 }));
    const logs = await callList('logs_list', '/logs', () => resend.logs.list({ limit: 20 }));
    const emails = await callList('emails_list', '/emails', () => resend.emails.list({ limit: 20 }));

    checks = [domains.check, logs.check, emails.check];
    domainSummary = summarizeDomains(domains.items);
    logSummary = summarizeLogs(logs.items);
    emailSummary = summarizeEmails(emails.items, emails.hasMore);
}

const failed = checks.filter((check) => check.status === 'failed');
const warnings = checks.filter((check) => check.status === 'warning');
const status = failed.length > 0 ? 'FAILED' : warnings.length > 0 ? 'WARNING' : 'OK';
const report: ResendReadonlyReport = {
    schemaVersion: 1,
    startedAt: startedAt.toISOString(),
    endedAt: new Date().toISOString(),
    status,
    outputDir,
    keySource,
    checks,
    domainSummary,
    logSummary,
    emailSummary,
    redaction,
};

writeFileSync(path.join(outputDir, 'summary.json'), JSON.stringify(report, null, 2), 'utf8');
writeFileSync(path.join(outputDir, 'summary.md'), renderSummary(report), 'utf8');

console.log(`[launch:resend-readonly] Status: ${status}`);
console.log(`[launch:resend-readonly] Failed: ${failed.length}`);
console.log(`[launch:resend-readonly] Warnings: ${warnings.length}`);
console.log(`[launch:resend-readonly] Summary: ${path.join(outputDir, 'summary.md')}`);

if (failed.length > 0) process.exit(1);

function readApiKey(file: string | null): string | null {
    if (!file) return process.env.RESEND_API_KEY?.trim() || null;
    const absolute = path.resolve(process.cwd(), file);
    if (!existsSync(absolute)) return null;
    const parsed = parse(readFileSync(absolute, 'utf8'));
    return parsed.RESEND_API_KEY?.trim() || null;
}

function isPlaceholderKey(value: string): boolean {
    return /placeholder|changeme|example|dummy|test-key/i.test(value) || value === 're_placeholder';
}

async function callList<T>(
    name: string,
    endpoint: string,
    action: () => Promise<ResendResponse<ListResponse<T>>>,
): Promise<{ check: EndpointCheck; items: T[]; hasMore: boolean }> {
    try {
        const response = await action();
        if (response.error) {
            const httpStatus = response.error.statusCode ?? null;
            return {
                check: {
                    status: httpStatus === 401 || httpStatus === 403 ? 'failed' : 'warning',
                    name,
                    httpStatus,
                    message: 'Resend read-only endpoint did not return list data.',
                    details: [
                        `endpoint=${endpoint}`,
                        `errorName=${response.error.name ?? 'unknown'}`,
                        `httpStatus=${httpStatus ?? 'unknown'}`,
                    ],
                },
                items: [],
                hasMore: false,
            };
        }

        const data = response.data;
        const items = Array.isArray(data?.data) ? data.data : [];
        return {
            check: {
                status: 'ok',
                name,
                httpStatus: 200,
                message: 'Resend read-only endpoint returned list metadata.',
                details: [
                    `endpoint=${endpoint}`,
                    `count=${items.length}`,
                    `hasMore=${String(Boolean(data?.has_more))}`,
                ],
            },
            items,
            hasMore: Boolean(data?.has_more),
        };
    } catch (error) {
        return {
            check: {
                status: 'failed',
                name,
                httpStatus: null,
                message: 'Resend read-only endpoint threw before returning a response.',
                details: [`endpoint=${endpoint}`, errorMessage(error)],
            },
            items: [],
            hasMore: false,
        };
    }
}

function summarizeDomains(items: unknown[]): ResendReadonlyReport['domainSummary'] {
    const summary = emptyDomainSummary();
    for (const raw of items) {
        const domain = raw as DomainItem;
        summary.count += 1;
        count(summary.byStatus, domain.status ?? 'unknown');
        count(summary.sendingCapabilities, domain.capabilities?.sending ?? 'unknown');
        count(summary.receivingCapabilities, domain.capabilities?.receiving ?? 'unknown');
        count(summary.byRegion, domain.region ?? 'unknown');
    }
    return summary;
}

function summarizeLogs(items: unknown[]): ResendReadonlyReport['logSummary'] {
    const summary = emptyLogSummary();
    for (const raw of items) {
        const log = raw as LogItem;
        summary.count += 1;
        count(summary.byEndpoint, sanitizeEndpoint(log.endpoint ?? 'unknown'));
        count(summary.byMethod, log.method ?? 'unknown');
        count(summary.byResponseStatus, String(log.response_status ?? 'unknown'));
    }
    return summary;
}

function summarizeEmails(items: unknown[], hasMore: boolean): ResendReadonlyReport['emailSummary'] {
    const summary = emptyEmailSummary();
    summary.hasMore = hasMore;
    for (const raw of items) {
        const email = raw as EmailItem;
        summary.count += 1;
        count(summary.byLastEvent, email.last_event ?? 'unknown');
        if (email.scheduled_at) summary.scheduledCount += 1;
    }
    return summary;
}

function sanitizeEndpoint(endpoint: string): string {
    return endpoint
        .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]')
        .replace(/\/emails\/[A-Za-z0-9_-]+/g, '/emails/[id]')
        .replace(/\/domains\/[A-Za-z0-9_-]+/g, '/domains/[id]');
}

function emptyDomainSummary(): ResendReadonlyReport['domainSummary'] {
    return {
        count: 0,
        byStatus: {},
        sendingCapabilities: {},
        receivingCapabilities: {},
        byRegion: {},
    };
}

function emptyLogSummary(): ResendReadonlyReport['logSummary'] {
    return {
        count: 0,
        byEndpoint: {},
        byMethod: {},
        byResponseStatus: {},
    };
}

function emptyEmailSummary(): ResendReadonlyReport['emailSummary'] {
    return {
        count: 0,
        hasMore: false,
        byLastEvent: {},
        scheduledCount: 0,
    };
}

function count(target: Record<string, number>, key: string): void {
    target[key] = (target[key] ?? 0) + 1;
}

function renderSummary(report: ResendReadonlyReport): string {
    const lines = [
        '# Resend Read-Only Evidence',
        '',
        `- Status: ${report.status}`,
        `- Started: ${report.startedAt}`,
        `- Ended: ${report.endedAt}`,
        `- Source: ${report.keySource}`,
        `- Output: ${report.outputDir}`,
        '',
        '## Scope',
        '',
        'This command only reads Resend list metadata through the installed Resend SDK. It does not send email, create broadcasts, mutate contacts, change domains, read email bodies or write dashboard configuration.',
        '',
        '## Checks',
        '',
        '| Status | Check | HTTP | Message | Details |',
        '| --- | --- | ---: | --- | --- |',
    ];

    for (const check of report.checks) {
        lines.push(`| ${check.status} | ${check.name} | ${check.httpStatus ?? '-'} | ${escapeCell(check.message)} | ${escapeCell((check.details ?? []).join(' / '))} |`);
    }

    lines.push(
        '',
        '## Domain Aggregates',
        '',
        `- Count: ${report.domainSummary.count}`,
        `- By status: ${JSON.stringify(report.domainSummary.byStatus)}`,
        `- Sending capabilities: ${JSON.stringify(report.domainSummary.sendingCapabilities)}`,
        `- Receiving capabilities: ${JSON.stringify(report.domainSummary.receivingCapabilities)}`,
        `- By region: ${JSON.stringify(report.domainSummary.byRegion)}`,
        '',
        '## Log Aggregates',
        '',
        `- Count: ${report.logSummary.count}`,
        `- By endpoint: ${JSON.stringify(report.logSummary.byEndpoint)}`,
        `- By method: ${JSON.stringify(report.logSummary.byMethod)}`,
        `- By response status: ${JSON.stringify(report.logSummary.byResponseStatus)}`,
        '',
        '## Email Event Aggregates',
        '',
        `- Count: ${report.emailSummary.count}`,
        `- Has more: ${String(report.emailSummary.hasMore)}`,
        `- By last event: ${JSON.stringify(report.emailSummary.byLastEvent)}`,
        `- Scheduled count: ${report.emailSummary.scheduledCount}`,
        '',
        '## Redaction',
        '',
    );

    for (const item of report.redaction) {
        lines.push(`- ${item}`);
    }

    lines.push('');
    return `${lines.join('\n')}\n`;
}

function readArgValue(name: string): string | null {
    const index = process.argv.indexOf(name);
    if (index === -1) return null;
    return process.argv[index + 1] ?? null;
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? `error=${error.message}` : 'error=unknown';
}

function stamp(date: Date): string {
    return date.toISOString().replace(/[:.]/g, '-');
}

function escapeCell(value: string): string {
    return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}
