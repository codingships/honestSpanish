import * as dotenv from 'dotenv';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
    SENTRY_PRODUCTION_HARDENING_APPROVAL_ENV,
    SENTRY_PRODUCTION_TARGET,
    SENTRY_PRODUCTION_WORKFLOW_NAMES,
    buildSentryProductionHardeningApproval,
    buildSentryProductionWorkflows,
    fingerprintSentryId,
    workflowMatchesDefinition,
    type SentryWorkflowDefinition,
} from './sentry-production-hardening-shared';

type CheckStatus = 'ok' | 'failed';
type ClosureStatus = 'PLAN_READY' | 'HARDENED_AND_VERIFIED' | 'PARTIAL_WRITE_STOP' | 'BLOCKED';

interface Check {
    status: CheckStatus;
    name: string;
    message: string;
    details: string[];
}

interface ProjectShape {
    slug?: string;
    status?: string;
    dataScrubber?: boolean;
    dataScrubberDefaults?: boolean;
    scrubIPAddresses?: boolean;
    access?: string[];
    options?: Record<string, unknown>;
}

interface MemberShape {
    id?: string;
    role?: string;
    orgRole?: string;
    expired?: boolean;
    pending?: boolean;
    user?: { id?: string } | null;
}

const supportedArguments = new Set(['--execute-approved']);
const unsupportedArguments = process.argv.slice(2).filter((argument) => !supportedArguments.has(argument));
if (unsupportedArguments.length > 0) throw new Error(`Unsupported argument(s): ${unsupportedArguments.join(', ')}`);

const executeRequested = process.argv.includes('--execute-approved');
const startedAt = new Date();
const outputDir = path.join(process.cwd(), 'outputs', 'launch-sentry-production-hardening', stamp(startedAt));
mkdirSync(outputDir, { recursive: true });

const env = dotenv.parse(readFileSync('.env'));
const token = process.env.SENTRY_AUTH_TOKEN?.trim() || env.SENTRY_AUTH_TOKEN?.trim() || '';
const baseUrl = process.env.SENTRY_BASE_URL?.trim() || env.SENTRY_BASE_URL?.trim() || 'https://sentry.io';
const checks: Check[] = [];
const createdWorkflowIds: string[] = [];
let detectorId = '';
let ownerUserId = '';
let detectorFingerprint = '';
let ownerFingerprint = '';
let approvalSentence = '';
let workflowDefinitions: SentryWorkflowDefinition[] = [];
let initialScrubIp = false;
let externalWriteAttempted = false;
let externalWritePerformed = false;
let rollbackAttempted = false;
let rollbackComplete = false;
let closureStatus: ClosureStatus = 'BLOCKED';

checks.push(validateLocalEnvironment());
if (checks.every((check) => check.status === 'ok')) {
    try {
        await preflightAndMaybeExecute();
    } catch (error) {
        checks.push(fail('remote_preflight', 'Sentry read-only preflight failed before the exact execution gate.', [
            safeError(error),
            `externalWriteAttempted=${String(externalWriteAttempted)}`,
        ]));
        if (externalWritePerformed && !rollbackAttempted) await rollbackCreatedChanges();
    }
}

const failed = checks.some((check) => check.status === 'failed');
if (!failed && closureStatus === 'BLOCKED') closureStatus = executeRequested ? 'HARDENED_AND_VERIFIED' : 'PLAN_READY';
if (failed && externalWritePerformed) closureStatus = 'PARTIAL_WRITE_STOP';
const status = failed ? 'FAILED' : 'OK';
const report = {
    schemaVersion: 1,
    startedAt: startedAt.toISOString(),
    endedAt: new Date().toISOString(),
    status,
    closureStatus,
    target: SENTRY_PRODUCTION_TARGET,
    executeRequested,
    externalWriteAttempted,
    externalWritePerformed,
    rollbackAttempted,
    rollbackComplete,
    createdWorkflowCount: createdWorkflowIds.length,
    detectorFingerprint,
    ownerFingerprint,
    approval: {
        environmentVariable: SENTRY_PRODUCTION_HARDENING_APPROVAL_ENV,
        requiredFlag: '--execute-approved',
        exactSentence: approvalSentence,
    },
    expectedChanges: {
        scrubIPAddresses: true,
        workflows: Object.values(SENTRY_PRODUCTION_WORKFLOW_NAMES),
        environment: 'production',
        actions: 'email to exact organization owner',
        spikeThreshold: '10 events in 5 minutes',
    },
    checks,
    forbiddenScope: [
        'issue status, event or payload access/mutation',
        'other Sentry projects or organizations',
        'members, integrations, releases, DSN, keys or tokens',
        'other project settings',
        'any non-Sentry service',
    ],
};

writeFileSync(path.join(outputDir, 'summary.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
writeFileSync(path.join(outputDir, 'summary.md'), renderSummary(report), 'utf8');
writeFileSync(path.join(outputDir, 'approval-gate.md'), renderApprovalGate(report), 'utf8');

console.log(`[launch:sentry-production-hardening] Status: ${status}`);
console.log(`[launch:sentry-production-hardening] Closure: ${closureStatus}`);
console.log(`[launch:sentry-production-hardening] External write attempted: ${String(externalWriteAttempted)}`);
console.log(`[launch:sentry-production-hardening] Summary: ${path.join(outputDir, 'summary.md')}`);
if (failed) process.exit(1);

async function preflightAndMaybeExecute(): Promise<void> {
    const projectPath = projectApiPath();
    const project = await sentryRequest<ProjectShape>('GET', projectPath);
    const dataScrubber = project.dataScrubber === true || project.options?.['sentry:scrub_data'] === true;
    const defaultScrubbers = project.dataScrubberDefaults === true || project.options?.['sentry:scrub_defaults'] === true;
    initialScrubIp = project.scrubIPAddresses === true || project.options?.['sentry:scrub_ip_address'] === true;
    const projectReady = project.slug === SENTRY_PRODUCTION_TARGET.project
        && project.status === 'active'
        && dataScrubber
        && defaultScrubbers
        && project.access?.includes('alerts:read') === true
        && project.access?.includes('alerts:write') === true;
    checks.push(projectReady
        ? ok('exact_project_preflight', 'Exact Sentry project is active with sensitive-data scrubbers and alert access.', [
            `scrubIPAddresses=${initialScrubIp}`,
            'dataScrubber=true',
            'defaultScrubbers=true',
        ])
        : fail('exact_project_preflight', 'Exact Sentry project or privacy/alert prerequisites are not ready.', [
            `projectSlugMatches=${String(project.slug === SENTRY_PRODUCTION_TARGET.project)}`,
            `projectStatus=${project.status ?? 'unknown'}`,
            `dataScrubber=${String(dataScrubber)}`,
            `defaultScrubbers=${String(defaultScrubbers)}`,
            `alertsRead=${String(project.access?.includes('alerts:read') === true)}`,
            `alertsWrite=${String(project.access?.includes('alerts:write') === true)}`,
        ]));
    if (!projectReady) return;

    const workflows = extractRecords(await sentryRequest<unknown>('GET', workflowsApiPath(), { project: SENTRY_PRODUCTION_TARGET.project }));
    const legacyRules = extractRecords(await sentryRequest<unknown>('GET', `${projectApiPath()}rules/`));
    const noExistingAlerts = workflows.length === 0 && legacyRules.length === 0;
    checks.push(noExistingAlerts
        ? ok('empty_alert_baseline', 'The exact project has no existing workflows or legacy issue alert rules.', [
            'workflows=0',
            'legacyIssueRules=0',
        ])
        : fail('empty_alert_baseline', 'Existing alert configuration blocks automatic creation to avoid overlap.', [
            `workflows=${workflows.length}`,
            `legacyIssueRules=${legacyRules.length}`,
            'externalWriteAttempted=false',
        ]));
    if (!noExistingAlerts) return;

    const detectors = extractRecords(await sentryRequest<unknown>('GET', detectorsApiPath(), { project: SENTRY_PRODUCTION_TARGET.project }));
    const errorDetectors = detectors.filter((record) => record.type === 'error' && record.enabled !== false && typeof record.id === 'string');
    const members = await sentryRequest<MemberShape[]>('GET', membersApiPath());
    const active = members.filter((member) => member.expired !== true && member.pending !== true);
    const privileged = active.filter((member) => ['owner', 'manager', 'admin'].includes(member.orgRole ?? member.role ?? ''));
    const owner = privileged.length === 1 ? privileged[0] : active.length === 1 ? active[0] : null;
    const candidateOwnerUserId = owner?.user?.id ?? owner?.id ?? '';
    const exactIdentity = errorDetectors.length === 1 && Boolean(candidateOwnerUserId);
    if (exactIdentity) {
        detectorId = String(errorDetectors[0].id);
        ownerUserId = candidateOwnerUserId;
        detectorFingerprint = fingerprintSentryId(detectorId);
        ownerFingerprint = fingerprintSentryId(ownerUserId);
        workflowDefinitions = buildSentryProductionWorkflows({ detectorId, ownerUserId });
        approvalSentence = buildSentryProductionHardeningApproval({ detectorFingerprint, ownerFingerprint });
    }
    checks.push(exactIdentity
        ? ok('exact_detector_and_owner', 'Exactly one enabled error detector and one notification owner are pinned by hash.', [
            `detectorFingerprint=${detectorFingerprint}`,
            `ownerFingerprint=${ownerFingerprint}`,
            'rawIdsPersisted=false',
        ])
        : fail('exact_detector_and_owner', 'Error detector or notification owner is ambiguous.', [
            `enabledErrorDetectors=${errorDetectors.length}`,
            `activeMembers=${active.length}`,
            `privilegedMembers=${privileged.length}`,
            'externalWriteAttempted=false',
        ]));
    if (!exactIdentity) return;

    if (!executeRequested) {
        closureStatus = 'PLAN_READY';
        checks.push(ok('plan_mode_read_only', 'Plan mode completed Sentry GET-only preflight.', [
            'externalWriteAttempted=false',
            `approvalEnv=${SENTRY_PRODUCTION_HARDENING_APPROVAL_ENV}`,
        ]));
        return;
    }

    const approvalMatches = process.env[SENTRY_PRODUCTION_HARDENING_APPROVAL_ENV]?.trim() === approvalSentence;
    checks.push(approvalMatches
        ? ok('exact_approval_gate', 'Exact approval sentence matches project, detector, owner and two workflows.', [])
        : fail('exact_approval_gate', 'Exact approval sentence is missing or mismatched; no writes may start.', [
            `approvalEnv=${SENTRY_PRODUCTION_HARDENING_APPROVAL_ENV}`,
            'externalWriteAttempted=false',
        ]));
    if (!approvalMatches) return;

    externalWriteAttempted = true;
    try {
        for (const definition of workflowDefinitions) {
            const created = await sentryRequest<Record<string, unknown>>('POST', workflowsApiPath(), {}, definition);
            externalWritePerformed = true;
            const id = typeof created.id === 'string' || typeof created.id === 'number' ? String(created.id) : '';
            if (!id || !workflowMatchesDefinition(created, definition)) {
                throw new Error(`Sentry did not attest the exact created workflow shape for ${definition.name}`);
            }
            createdWorkflowIds.push(id);
        }

        if (!initialScrubIp) {
            const updated = await sentryRequest<ProjectShape>('PUT', projectPath, {}, { scrubIPAddresses: true });
            externalWritePerformed = true;
            const updatedScrubIp = updated.scrubIPAddresses === true || updated.options?.['sentry:scrub_ip_address'] === true;
            if (!updatedScrubIp) throw new Error('Sentry did not attest scrubIPAddresses=true');
        }

        const finalProject = await sentryRequest<ProjectShape>('GET', projectPath);
        const finalScrubIp = finalProject.scrubIPAddresses === true || finalProject.options?.['sentry:scrub_ip_address'] === true;
        const finalWorkflows = extractRecords(await sentryRequest<unknown>('GET', workflowsApiPath(), { project: SENTRY_PRODUCTION_TARGET.project }));
        const finalLegacyRules = extractRecords(await sentryRequest<unknown>('GET', `${projectApiPath()}rules/`));
        const exactFinal = finalScrubIp
            && finalLegacyRules.length === 0
            && finalWorkflows.length === workflowDefinitions.length
            && workflowDefinitions.every((definition) => finalWorkflows.some((workflow) => workflowMatchesDefinition(workflow, definition)));
        if (!exactFinal) throw new Error('Final Sentry hardening verification did not match the exact two-workflow state');

        closureStatus = 'HARDENED_AND_VERIFIED';
        checks.push(ok('hardening_post_write_verification', 'IP scrubbing and both exact production email workflows are active.', [
            'scrubIPAddresses=true',
            `workflowCount=${finalWorkflows.length}`,
            `names=${workflowDefinitions.map((definition) => definition.name).join('|')}`,
            'environment=production',
            'notification=email_exact_owner',
        ]));
    } catch (error) {
        checks.push(fail('hardening_execution', 'Sentry hardening failed; narrow rollback was attempted.', [safeError(error)]));
        await rollbackCreatedChanges();
    }
}

async function rollbackCreatedChanges(): Promise<void> {
    rollbackAttempted = true;
    const failures: string[] = [];
    for (const id of [...createdWorkflowIds].reverse()) {
        try {
            await sentryRequest<unknown>('DELETE', `${workflowsApiPath()}${encodeURIComponent(id)}/`);
        } catch (error) {
            failures.push(`workflow:${safeError(error)}`);
        }
    }
    if (!initialScrubIp) {
        try {
            await sentryRequest<ProjectShape>('PUT', projectApiPath(), {}, { scrubIPAddresses: false });
        } catch (error) {
            failures.push(`scrubIp:${safeError(error)}`);
        }
    }
    rollbackComplete = failures.length === 0;
    checks.push(rollbackComplete
        ? ok('narrow_rollback', 'Only changes created in this execution were rolled back.', [
            `workflowDeletes=${createdWorkflowIds.length}`,
            `scrubIpRestored=${String(!initialScrubIp)}`,
        ])
        : fail('narrow_rollback', 'Narrow Sentry rollback was incomplete and requires manual review.', failures));
}

async function sentryRequest<T>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    pathName: string,
    params: Record<string, string> = {},
    body?: unknown,
): Promise<T> {
    const url = new URL(pathName, baseUrl);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    const response = await fetch(url, {
        method,
        headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/json',
            ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) throw new Error(`Sentry ${method} ${pathName} returned HTTP ${response.status}`);
    if (response.status === 204) return undefined as T;
    return await response.json() as T;
}

function validateLocalEnvironment(): Check {
    const configuredOrg = env.SENTRY_ORG?.trim() || process.env.SENTRY_ORG?.trim();
    const configuredProject = env.SENTRY_PROJECT?.trim() || process.env.SENTRY_PROJECT?.trim();
    const valid = Boolean(token)
        && (!configuredOrg || configuredOrg === SENTRY_PRODUCTION_TARGET.organization)
        && (!configuredProject || configuredProject === SENTRY_PRODUCTION_TARGET.project)
        && /^https:\/\//u.test(baseUrl);
    return valid
        ? ok('local_environment', 'Local Sentry environment pins the exact production organization/project.', [
            `target=${SENTRY_PRODUCTION_TARGET.organization}/${SENTRY_PRODUCTION_TARGET.project}`,
            `baseHost=${new URL(baseUrl).host}`,
            'token=present_not_persisted',
        ])
        : fail('local_environment', 'Local Sentry target/token is missing or does not match the exact project.', [
            `orgMatches=${String(!configuredOrg || configuredOrg === SENTRY_PRODUCTION_TARGET.organization)}`,
            `projectMatches=${String(!configuredProject || configuredProject === SENTRY_PRODUCTION_TARGET.project)}`,
            `tokenPresent=${String(Boolean(token))}`,
            'externalWriteAttempted=false',
        ]);
}

function extractRecords(payload: unknown): Array<Record<string, unknown>> {
    if (Array.isArray(payload)) return payload.filter(isRecord);
    if (!isRecord(payload)) return [];
    for (const key of ['data', 'results', 'workflows', 'rules', 'detectors']) {
        if (Array.isArray(payload[key])) return payload[key].filter(isRecord);
    }
    return [];
}

function projectApiPath(): string {
    return `/api/0/projects/${SENTRY_PRODUCTION_TARGET.organization}/${SENTRY_PRODUCTION_TARGET.project}/`;
}

function workflowsApiPath(): string {
    return `/api/0/organizations/${SENTRY_PRODUCTION_TARGET.organization}/workflows/`;
}

function detectorsApiPath(): string {
    return `/api/0/organizations/${SENTRY_PRODUCTION_TARGET.organization}/detectors/`;
}

function membersApiPath(): string {
    return `/api/0/organizations/${SENTRY_PRODUCTION_TARGET.organization}/members/`;
}

function renderSummary(value: typeof report): string {
    return `${[
        '# Sentry Production Hardening',
        '',
        `- Status: ${value.status}`,
        `- Closure: ${value.closureStatus}`,
        `- Target: ${value.target.organization}/${value.target.project}`,
        `- Environment: ${value.target.environment}`,
        `- Execute requested: ${String(value.executeRequested)}`,
        `- External write attempted: ${String(value.externalWriteAttempted)}`,
        `- External write performed: ${String(value.externalWritePerformed)}`,
        `- Rollback attempted: ${String(value.rollbackAttempted)}`,
        `- Rollback complete: ${String(value.rollbackComplete)}`,
        `- Detector SHA-256: ${value.detectorFingerprint || 'unavailable'}`,
        `- Owner SHA-256: ${value.ownerFingerprint || 'unavailable'}`,
        '',
        '| Status | Check | Message | Details |',
        '| --- | --- | --- | --- |',
        ...value.checks.map((check) => `| ${check.status} | ${check.name} | ${escapeCell(check.message)} | ${escapeCell(check.details.join(' / '))} |`),
        '',
        'The runner never reads Sentry events or payloads and never persists member, detector, workflow or token identifiers.',
        '',
    ].join('\n')}\n`;
}

function renderApprovalGate(value: typeof report): string {
    return `${[
        '# Sentry Production Hardening Approval Gate',
        '',
        'This file is not approval.',
        '',
        `- Exact target: \`${value.target.organization}/${value.target.project}\`.`,
        `- Exact environment: \`${value.target.environment}\`.`,
        `- Detector SHA-256: \`${value.detectorFingerprint || 'unavailable'}\`.`,
        `- Owner SHA-256: \`${value.ownerFingerprint || 'unavailable'}\`.`,
        `- Required flag: \`--execute-approved\`.`,
        `- Required environment variable: \`${SENTRY_PRODUCTION_HARDENING_APPROVAL_ENV}\`.`,
        '',
        '## Exact Approval Sentence',
        '',
        value.approval.exactSentence || '<unavailable until the exact read-only preflight succeeds>',
        '',
    ].join('\n')}\n`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function safeError(error: unknown): string {
    let message = error instanceof Error ? error.message : String(error);
    for (const secret of [token, detectorId, ownerUserId, ...createdWorkflowIds]) {
        if (secret) message = message.replaceAll(secret, '[redacted]');
    }
    return message.replace(/\r?\n/gu, ' ').slice(0, 500);
}

function ok(name: string, message: string, details: string[]): Check {
    return { status: 'ok', name, message, details };
}

function fail(name: string, message: string, details: string[]): Check {
    return { status: 'failed', name, message, details };
}

function escapeCell(value: string): string {
    return value.replace(/\|/gu, '\\|').replace(/\r?\n/gu, ' ');
}

function stamp(date: Date): string {
    return date.toISOString().replace(/[:.]/gu, '-');
}
