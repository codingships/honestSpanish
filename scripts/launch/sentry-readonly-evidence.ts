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
    baseUrl: string;
    projectResolution: ProjectResolution;
    checks: Check[];
    issueThreshold: UnresolvedIssueThreshold;
    issueSummary: {
        allEnvironment: IssueQuerySummary;
        selectedEnvironment: IssueQuerySummary;
    };
    redaction: string[];
}

interface ProjectResolution {
    mode: 'configured' | 'derived_from_dsn' | 'unresolved';
    orgSlug: string | null;
    projectSlug: string | null;
    projectIdSuffix: string | null;
    dsnHost: string | null;
    dsnProjectIdSuffix: string | null;
    organizationCount: number;
    projectCount: number;
}

interface SentryOrganization {
    slug?: string;
    name?: string;
}

interface SentryProject {
    id?: string;
    slug?: string;
    name?: string;
}

interface SentryIssue {
    shortId?: string;
    status?: string;
    level?: string;
    count?: string | number;
    firstSeen?: string;
    lastSeen?: string;
    userCount?: number;
    project?: {
        id?: string;
        slug?: string;
    };
    tags?: Array<{
        key?: string;
        value?: string;
    }>;
}

interface IssueQuerySummary {
    status: 'ok' | 'warning' | 'skipped';
    environment: string;
    query: string;
    statsPeriod: string;
    returned: number;
    totalEventCountAcrossReturnedIssues: number;
    latestLastSeen: string | null;
    byLevel: Record<string, number>;
    byStatus: Record<string, number>;
    byEnvironmentTag: Record<string, number>;
    sample: Array<{
        shortId: string;
        status: string;
        level: string;
        count: number;
        lastSeen: string | null;
        environments: string[];
    }>;
    note: string;
}

type ApiError = Error & { status?: number };
type ThresholdSource = 'cli' | 'env' | 'default';

interface UnresolvedIssueThreshold {
    selectedEnvironment: string;
    maxUnresolvedIssues: number;
    source: ThresholdSource;
}

const envFile = readArgValue('--env-file') || '.env';
dotenv.config({ path: envFile, quiet: true });

const startedAt = new Date();
const outputDir = path.join(process.cwd(), 'outputs', 'launch-sentry-readonly-evidence', stamp(startedAt));
mkdirSync(outputDir, { recursive: true });

const baseUrl = process.env.SENTRY_BASE_URL?.trim() || 'https://sentry.io';
const token = process.env.SENTRY_AUTH_TOKEN?.trim();
const configuredOrg = process.env.SENTRY_ORG?.trim() || null;
const configuredProject = process.env.SENTRY_PROJECT?.trim() || null;
const dsn = process.env.PUBLIC_SENTRY_DSN?.trim() || process.env.SENTRY_DSN?.trim() || null;
const selectedEnvironment = readArgValue('--environment') || process.env.SENTRY_ENVIRONMENT?.trim() || 'production';
const statsPeriod = readArgValue('--time-range') || '24h';
const query = readArgValue('--query') || 'is:unresolved';
const limit = clampNumber(Number(readArgValue('--limit') || 20), 1, 50);
const issueThreshold = readUnresolvedIssueThreshold();
const dsnParts = parseDsn(dsn);

const redaction = [
    'No Sentry auth token, DSN public key, event ids, stack traces, request bodies, user emails, user IPs or raw event payloads are written.',
    'Issue titles are not written; this report stores aggregate counts and short issue ids only.',
    'Only Sentry GET endpoints are used: organizations, projects and issue lists.',
];

const checks: Check[] = [checkEnvironment()];
let projectResolution: ProjectResolution = emptyResolution();
let allEnvironment = skippedIssueSummary('all', 'Sentry project could not be resolved.');
let selectedEnvironmentSummary = skippedIssueSummary(selectedEnvironment, 'Sentry project could not be resolved.');

if (token && !looksPlaceholder(token)) {
    const resolution = await resolveProject();
    projectResolution = resolution.resolution;
    checks.push(...resolution.checks);

    if (projectResolution.orgSlug && projectResolution.projectSlug) {
        allEnvironment = await queryIssues(projectResolution.orgSlug, projectResolution.projectSlug, null);
        selectedEnvironmentSummary = await queryIssues(projectResolution.orgSlug, projectResolution.projectSlug, selectedEnvironment);
    }
}

checks.push(checkUnresolvedIssueThreshold(selectedEnvironmentSummary, issueThreshold));

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
    baseUrl: safeBaseUrl(baseUrl),
    projectResolution,
    checks,
    issueThreshold,
    issueSummary: {
        allEnvironment,
        selectedEnvironment: selectedEnvironmentSummary,
    },
    redaction,
};

writeFileSync(path.join(outputDir, 'summary.json'), JSON.stringify(report, null, 2), 'utf8');
writeFileSync(path.join(outputDir, 'summary.md'), renderMarkdown(report), 'utf8');

console.log(`[launch:sentry-readonly] Status: ${status}`);
console.log(`[launch:sentry-readonly] Failed: ${failed.length}`);
console.log(`[launch:sentry-readonly] Warnings: ${warnings.length}`);
console.log(`[launch:sentry-readonly] Project: ${projectResolution.orgSlug ?? 'unresolved'}/${projectResolution.projectSlug ?? 'unresolved'}`);
console.log(`[launch:sentry-readonly] Summary: ${path.join(outputDir, 'summary.md')}`);

if (failed.length > 0) process.exit(1);

function checkEnvironment(): Check {
    const missing = [
        ['SENTRY_AUTH_TOKEN', token],
        ['PUBLIC_SENTRY_DSN or SENTRY_DSN', dsn],
    ].filter(([, value]) => !value).map(([name]) => name);
    const placeholderToken = token ? looksPlaceholder(token) : false;
    const configuredPairPartial = Boolean(configuredOrg) !== Boolean(configuredProject);

    return {
        status: missing.length > 0 || placeholderToken || configuredPairPartial ? 'warning' : 'ok',
        name: 'environment_shape',
        message: missing.length === 0 && !placeholderToken && !configuredPairPartial
            ? 'Sentry token/DSN environment shape is present for read-only evidence.'
            : 'Sentry read-only evidence inputs are incomplete or placeholder-shaped.',
        details: [
            `env_file=${envFile}`,
            `missing=${missing.length === 0 ? 'none' : missing.join(', ')}`,
            `token=${token ? 'present' : 'missing'}`,
            `token_placeholder=${placeholderToken}`,
            `dsn_host=${dsnParts.host ?? 'missing'}`,
            `dsn_project=${compactId(dsnParts.projectId)}`,
            `configured_org=${configuredOrg ? 'present' : 'missing'}`,
            `configured_project=${configuredProject ? 'present' : 'missing'}`,
            ...(configuredPairPartial ? ['configured_pair_partial=true'] : []),
        ],
    };
}

function checkUnresolvedIssueThreshold(
    summary: IssueQuerySummary,
    threshold: UnresolvedIssueThreshold,
): Check {
    const details = [
        `environment=${summary.environment}`,
        `query=${summary.query}`,
        `stats_period=${summary.statsPeriod}`,
        `returned_visible_issues=${summary.returned}`,
        `result_limit=${limit}`,
        `max_unresolved_issues=${threshold.maxUnresolvedIssues}`,
        `threshold_source=${threshold.source}`,
        `issue_query_status=${summary.status}`,
        `latest_last_seen=${summary.latestLastSeen ?? 'none'}`,
        `event_count_across_returned_issues=${summary.totalEventCountAcrossReturnedIssues}`,
    ];

    if (summary.status !== 'ok') {
        return {
            status: 'warning',
            name: 'sentry_unresolved_issue_threshold',
            message: 'Selected Sentry environment issue query did not produce clean read-only evidence.',
            details: [...details, `note=${summary.note}`],
        };
    }

    if (summary.returned > threshold.maxUnresolvedIssues) {
        return {
            status: 'warning',
            name: 'sentry_unresolved_issue_threshold',
            message: 'Selected Sentry environment has unresolved issues above allowed threshold.',
            details,
        };
    }

    return {
        status: 'ok',
        name: 'sentry_unresolved_issue_threshold',
        message: 'Selected Sentry environment has unresolved issues at or below allowed threshold.',
        details,
    };
}

async function resolveProject(): Promise<{ resolution: ProjectResolution; checks: Check[] }> {
    const localChecks: Check[] = [];
    let organizations: SentryOrganization[] = [];
    const projects: SentryProject[] = [];

    if (configuredOrg && configuredProject) {
        localChecks.push({
            status: 'ok',
            name: 'sentry_project_resolution',
            message: 'Sentry org/project were configured explicitly.',
            details: [`org=${configuredOrg}`, `project=${configuredProject}`],
        });
        return {
            resolution: {
                mode: 'configured',
                orgSlug: configuredOrg,
                projectSlug: configuredProject,
                projectIdSuffix: null,
                dsnHost: dsnParts.host,
                dsnProjectIdSuffix: compactId(dsnParts.projectId),
                organizationCount: 0,
                projectCount: 0,
            },
            checks: localChecks,
        };
    }

    try {
        organizations = await sentryGet<SentryOrganization[]>('/api/0/organizations/');
        localChecks.push({
            status: organizations.length > 0 ? 'ok' : 'warning',
            name: 'sentry_organizations_readonly',
            message: organizations.length > 0
                ? 'Sentry organizations endpoint is reachable with the configured token.'
                : 'Sentry organizations endpoint returned no organizations.',
            details: [`organizations=${organizations.length}`],
        });
    } catch (error) {
        localChecks.push({
            status: statusForApiError(error),
            name: 'sentry_organizations_readonly',
            message: 'Sentry organizations endpoint could not be read with the configured token.',
            details: [safeErrorMessage(error)],
        });
        return { resolution: emptyResolution(), checks: localChecks };
    }

    for (const org of organizations.slice(0, 20)) {
        const slug = org.slug;
        if (!slug) continue;
        try {
            const orgProjects = await sentryGet<SentryProject[]>(`/api/0/organizations/${encodeURIComponent(slug)}/projects/`);
            projects.push(...orgProjects.map((project) => ({ ...project, slug: project.slug, name: project.name })));
            const matched = orgProjects.find((project) => dsnParts.projectId && String(project.id) === dsnParts.projectId);
            if (matched?.slug) {
                localChecks.push({
                    status: 'ok',
                    name: 'sentry_project_resolution',
                    message: 'Sentry project was derived from PUBLIC_SENTRY_DSN project id.',
                    details: [
                        `org=${slug}`,
                        `project=${matched.slug}`,
                        `project_id=${compactId(matched.id)}`,
                        `dsn_host=${dsnParts.host ?? 'unknown'}`,
                    ],
                });
                return {
                    resolution: {
                        mode: 'derived_from_dsn',
                        orgSlug: slug,
                        projectSlug: matched.slug,
                        projectIdSuffix: compactId(matched.id),
                        dsnHost: dsnParts.host,
                        dsnProjectIdSuffix: compactId(dsnParts.projectId),
                        organizationCount: organizations.length,
                        projectCount: projects.length,
                    },
                    checks: localChecks,
                };
            }
        } catch (error) {
            localChecks.push({
                status: 'warning',
                name: 'sentry_projects_readonly',
                message: `Sentry projects endpoint could not be read for one organization.`,
                details: [`org=${slug}`, safeErrorMessage(error)],
            });
        }
    }

    localChecks.push({
        status: 'warning',
        name: 'sentry_project_resolution',
        message: 'Sentry project could not be resolved from configured org/project or DSN project id.',
        details: [
            `organizations=${organizations.length}`,
            `projects_scanned=${projects.length}`,
            `dsn_project=${compactId(dsnParts.projectId)}`,
            'Set SENTRY_ORG and SENTRY_PROJECT for deterministic final evidence.',
        ],
    });

    return {
        resolution: {
            mode: 'unresolved',
            orgSlug: null,
            projectSlug: null,
            projectIdSuffix: null,
            dsnHost: dsnParts.host,
            dsnProjectIdSuffix: compactId(dsnParts.projectId),
            organizationCount: organizations.length,
            projectCount: projects.length,
        },
        checks: localChecks,
    };
}

async function queryIssues(
    orgSlug: string,
    projectSlug: string,
    environment: string | null,
): Promise<IssueQuerySummary> {
    const params: Record<string, string> = {
        statsPeriod,
        query,
        per_page: String(limit),
    };
    if (environment) params.environment = environment;

    try {
        const issues = await sentryGet<SentryIssue[]>(`/api/0/projects/${encodeURIComponent(orgSlug)}/${encodeURIComponent(projectSlug)}/issues/`, params);
        return summarizeIssues(issues, environment ?? 'all', 'ok');
    } catch (error) {
        return {
            ...skippedIssueSummary(environment ?? 'all', safeErrorMessage(error)),
            status: statusForApiError(error) === 'failed' ? 'warning' : 'warning',
        };
    }
}

function summarizeIssues(issues: SentryIssue[], environment: string, statusValue: 'ok' | 'warning'): IssueQuerySummary {
    const summary: IssueQuerySummary = {
        status: statusValue,
        environment,
        query,
        statsPeriod,
        returned: issues.length,
        totalEventCountAcrossReturnedIssues: 0,
        latestLastSeen: null,
        byLevel: {},
        byStatus: {},
        byEnvironmentTag: {},
        sample: [],
        note: issues.length === 0
            ? 'No unresolved issues were returned for this query.'
            : 'Issue titles, event ids and stack traces are intentionally omitted from this evidence.',
    };

    for (const issue of issues) {
        const countValue = Number(issue.count ?? 0);
        summary.totalEventCountAcrossReturnedIssues += Number.isFinite(countValue) ? countValue : 0;
        count(summary.byLevel, issue.level ?? 'unknown');
        count(summary.byStatus, issue.status ?? 'unknown');

        const environmentTags = (issue.tags ?? [])
            .filter((tag) => tag.key === 'environment' && tag.value)
            .map((tag) => tag.value as string);
        for (const tag of environmentTags) count(summary.byEnvironmentTag, tag);

        if (issue.lastSeen && (!summary.latestLastSeen || issue.lastSeen > summary.latestLastSeen)) {
            summary.latestLastSeen = issue.lastSeen;
        }

        if (summary.sample.length < limit) {
            summary.sample.push({
                shortId: issue.shortId ?? 'unknown',
                status: issue.status ?? 'unknown',
                level: issue.level ?? 'unknown',
                count: Number.isFinite(countValue) ? countValue : 0,
                lastSeen: issue.lastSeen ?? null,
                environments: environmentTags.slice(0, 5),
            });
        }
    }

    return summary;
}

async function sentryGet<T>(pathName: string, params: Record<string, string> = {}): Promise<T> {
    if (!token) throw new Error('Missing SENTRY_AUTH_TOKEN');
    const url = new URL(pathName, baseUrl);
    for (const [key, value] of Object.entries(params)) {
        url.searchParams.set(key, value);
    }

    const response = await fetch(url, {
        method: 'GET',
        headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/json',
        },
    });

    if (!response.ok) {
        const error = new Error(`Sentry GET ${pathName} returned HTTP ${response.status}`) as ApiError;
        error.status = response.status;
        throw error;
    }

    return await response.json() as T;
}

function renderMarkdown(report: Report): string {
    const lines = [
        '# Sentry Read-Only Evidence',
        '',
        `- Status: ${report.status}`,
        `- Started: ${report.startedAt}`,
        `- Ended: ${report.endedAt}`,
        `- Output: ${report.outputDir}`,
        `- Env file: ${report.envFile}`,
        `- Base URL: ${report.baseUrl}`,
        '',
        '## Scope',
        '',
        'This command is read-only. It uses Sentry GET endpoints for organizations, projects and issue lists. It does not resolve issues, create alerts, change projects, upload sourcemaps, query event details, fetch stack traces, fetch raw payloads, mutate dashboards, retrieve secret values or write to any external service.',
        '',
        '## Project Resolution',
        '',
        '| Field | Value |',
        '| --- | --- |',
        `| Mode | ${report.projectResolution.mode} |`,
        `| Org | ${report.projectResolution.orgSlug ?? 'unresolved'} |`,
        `| Project | ${report.projectResolution.projectSlug ?? 'unresolved'} |`,
        `| Project id suffix | ${report.projectResolution.projectIdSuffix ?? 'unknown'} |`,
        `| DSN host | ${report.projectResolution.dsnHost ?? 'unknown'} |`,
        `| DSN project id suffix | ${report.projectResolution.dsnProjectIdSuffix ?? 'unknown'} |`,
        `| Organizations scanned | ${report.projectResolution.organizationCount} |`,
        `| Projects scanned | ${report.projectResolution.projectCount} |`,
        '',
        '## Checks',
        '',
        '| Status | Check | Message | Details |',
        '| --- | --- | --- | --- |',
        ...report.checks.map((check) => `| ${check.status} | ${check.name} | ${check.message} | ${(check.details ?? []).join('<br>')} |`),
        '',
        '## Issue Threshold',
        '',
        '| Field | Value |',
        '| --- | --- |',
        `| Selected environment | ${report.issueThreshold.selectedEnvironment} |`,
        `| Max unresolved issues | ${report.issueThreshold.maxUnresolvedIssues} |`,
        `| Source | ${report.issueThreshold.source} |`,
        '',
        '## Issue Summary',
        '',
        renderIssueSummary('All environments', report.issueSummary.allEnvironment),
        '',
        renderIssueSummary(`Environment ${report.issueSummary.selectedEnvironment.environment}`, report.issueSummary.selectedEnvironment),
        '',
        '## Redaction',
        '',
        ...report.redaction.map((item) => `- ${item}`),
        '',
        '## Impact On Open Findings',
        '',
        '- `ERR-FINAL-INTEGRATION-010` remains open. This evidence can prove Sentry API/project reachability and recent issue-list visibility. Any unresolved issue count above the configured threshold is reported as a QA warning, but this command still does not configure or verify final alert rules, owner/cadence, privacy scrubbing, final production release tags, key rotation or launch-window smoke.',
        '- `ERR-FINAL-SMOKE-012` remains open. No production write-path smoke was performed.',
        '',
    ];
    return `${lines.join('\n')}\n`;
}

function renderIssueSummary(title: string, summary: IssueQuerySummary): string {
    return [
        `### ${title}`,
        '',
        '| Field | Value |',
        '| --- | --- |',
        `| Status | ${summary.status} |`,
        `| Query | ${summary.query} |`,
        `| Stats period | ${summary.statsPeriod} |`,
        `| Returned issues | ${summary.returned} |`,
        `| Event count across returned issues | ${summary.totalEventCountAcrossReturnedIssues} |`,
        `| Latest lastSeen | ${summary.latestLastSeen ?? 'none'} |`,
        `| By level | ${formatCounts(summary.byLevel)} |`,
        `| By status | ${formatCounts(summary.byStatus)} |`,
        `| By environment tag | ${formatCounts(summary.byEnvironmentTag)} |`,
        `| Note | ${summary.note} |`,
        '',
        `Returned issue rows below are bounded by --limit / SENTRY evidence limit (${limit}) and intentionally omit titles, event ids, stack traces and raw payloads.`,
        '',
        '| Short ID | Status | Level | Count | Last seen | Environments |',
        '| --- | --- | --- | ---: | --- | --- |',
        ...(summary.sample.length === 0
            ? ['| - | - | - | 0 | - | - |']
            : summary.sample.map((issue) => `| ${issue.shortId} | ${issue.status} | ${issue.level} | ${issue.count} | ${issue.lastSeen ?? 'none'} | ${issue.environments.join(', ') || 'none'} |`)),
    ].join('\n');
}

function skippedIssueSummary(environment: string, note: string): IssueQuerySummary {
    return {
        status: 'skipped',
        environment,
        query,
        statsPeriod,
        returned: 0,
        totalEventCountAcrossReturnedIssues: 0,
        latestLastSeen: null,
        byLevel: {},
        byStatus: {},
        byEnvironmentTag: {},
        sample: [],
        note,
    };
}

function emptyResolution(): ProjectResolution {
    return {
        mode: 'unresolved',
        orgSlug: null,
        projectSlug: null,
        projectIdSuffix: null,
        dsnHost: dsnParts.host,
        dsnProjectIdSuffix: compactId(dsnParts.projectId),
        organizationCount: 0,
        projectCount: 0,
    };
}

function parseDsn(value: string | null): { host: string | null; projectId: string | null } {
    if (!value) return { host: null, projectId: null };
    try {
        const url = new URL(value);
        const projectId = url.pathname.split('/').filter(Boolean).at(-1) ?? null;
        return { host: url.host, projectId };
    } catch {
        return { host: 'unparsed', projectId: null };
    }
}

function readArgValue(name: string): string | null {
    const index = process.argv.indexOf(name);
    if (index >= 0) return process.argv[index + 1] ?? null;
    const prefix = `${name}=`;
    const match = process.argv.find((arg) => arg.startsWith(prefix));
    return match ? match.slice(prefix.length) : null;
}

function readUnresolvedIssueThreshold(): UnresolvedIssueThreshold {
    const cliValue = readArgValue('--max-unresolved-issues');
    const envValue = process.env.SENTRY_MAX_UNRESOLVED_ISSUES?.trim() || null;
    const rawValue = cliValue ?? envValue ?? '0';
    const source: ThresholdSource = cliValue !== null ? 'cli' : envValue ? 'env' : 'default';

    return {
        selectedEnvironment,
        maxUnresolvedIssues: clampNumber(Number(rawValue), 0, 100000),
        source,
    };
}

function stamp(date: Date): string {
    return date.toISOString().replaceAll(':', '-').replaceAll('.', '-');
}

function looksPlaceholder(value: string): boolean {
    return /placeholder|changeme|example|dummy|your_/i.test(value);
}

function compactId(value: string | null | undefined): string {
    if (!value) return 'missing';
    if (value.length <= 8) return value;
    return `...${value.slice(-8)}`;
}

function clampNumber(value: number, min: number, max: number): number {
    if (!Number.isFinite(value)) return min;
    return Math.min(max, Math.max(min, Math.trunc(value)));
}

function count(target: Record<string, number>, key: string): void {
    target[key] = (target[key] ?? 0) + 1;
}

function formatCounts(counts: Record<string, number>): string {
    const entries = Object.entries(counts).sort(([a], [b]) => a.localeCompare(b));
    return entries.length === 0 ? 'none' : entries.map(([key, value]) => `${key}:${value}`).join(', ');
}

function safeBaseUrl(value: string): string {
    try {
        const url = new URL(value);
        return `${url.protocol}//${url.host}`;
    } catch {
        return 'unparsed';
    }
}

function safeErrorMessage(error: unknown): string {
    const raw = error instanceof Error ? error.message : String(error);
    const withoutToken = token ? raw.replaceAll(token, '[REDACTED_TOKEN]') : raw;
    return withoutToken
        .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[REDACTED_EMAIL]')
        .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '[REDACTED_IP]');
}

function statusForApiError(error: unknown): Status {
    const statusCode = typeof error === 'object' && error && 'status' in error
        ? Number((error as ApiError).status)
        : null;
    return statusCode === 401 || statusCode === 403 ? 'failed' : 'warning';
}
