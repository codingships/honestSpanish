/**
 * Staging accreditation for R04: one synthetic Sentry error without PII.
 *
 * Preflight validates the approved DSN identity. Execute plants privacy decoys,
 * scrubs them with the production scrubber, posts a single event to the
 * canonical staging project, and refuses to continue if any decoy remains.
 *
 * Reception is confirmed afterwards via Sentry MCP/API using the printed
 * request_id / event_id. Mailbox continuity remains a human gate.
 */
import { createHash, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parse } from 'dotenv';
import type { Event } from '@sentry/astro';
import { scrubSentryEvent } from '../../src/lib/sentry-privacy';
import {
    assertSyntheticEventHasNoDecoys,
    parseStagingSentrySyntheticArgs,
    safeStagingSentrySyntheticSummary,
    STAGING_SENTRY_SYNTHETIC_DECOYS,
    STAGING_SENTRY_SYNTHETIC_IDENTITY,
    validateStagingSentrySyntheticGate,
    type StagingSentrySyntheticGate,
} from './staging-sentry-synthetic-safety';

type Env = Record<string, string | undefined>;
type Log = (message: string) => void;

type RunnerDependencies = {
    envFile?: string;
    log?: Log;
    postEvent?: (input: {
        body: string;
        publicKey: string;
        url: string;
    }) => Promise<{ ok: boolean; status: number; text: string }>;
    readText?: (file: string) => string;
    repositoryRemote?: (workspaceRoot: string) => string;
    workspaceRoot?: string;
};

function readRepositoryRemote(workspaceRoot: string): string {
    return execFileSync('git', ['remote', 'get-url', 'origin'], {
        cwd: workspaceRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        windowsHide: true,
    }).trim();
}

function canonicalWorkspaceRoot(worktreeRoot: string): string {
    const commonGitDir = execFileSync(
        'git',
        ['rev-parse', '--path-format=absolute', '--git-common-dir'],
        { cwd: worktreeRoot, encoding: 'utf8', windowsHide: true },
    ).trim();
    return path.dirname(commonGitDir);
}

function defaultEnvFile(worktreeRoot: string): string {
    return path.resolve(canonicalWorkspaceRoot(worktreeRoot), '.env.staging');
}

function newEventId(): string {
    return randomBytes(16).toString('hex');
}

function newRequestId(): string {
    return `sentry-synth-${randomBytes(16).toString('hex')}`;
}

function buildDecoyEvent(input: {
    eventId: string;
    requestId: string;
}): Event {
    const decoys = STAGING_SENTRY_SYNTHETIC_DECOYS;
    const safeMessage = 'Operational failure: observability.synthetic:SYNTHETIC_PROBE';
    return {
        event_id: input.eventId,
        timestamp: Date.now() / 1000,
        platform: 'node',
        level: 'error',
        environment: 'staging',
        release: undefined,
        transaction: `/es/campus/admin/packages?${decoys.query}`,
        message: safeMessage,
        fingerprint: ['observability.synthetic', 'SYNTHETIC_PROBE', input.requestId],
        tags: {
            'operational.surface': 'observability.synthetic',
            'operational.code': 'SYNTHETIC_PROBE',
            request_id: input.requestId,
            synthetic: 'true',
        },
        user: {
            email: decoys.email,
            id: 'decoy-user-id',
        },
        request: {
            url: `${STAGING_SENTRY_SYNTHETIC_IDENTITY.webOrigin}/es/campus/admin/packages?${decoys.query}`,
            query_string: decoys.query,
            cookies: { session: decoys.cookie.split('=', 2)[1] ?? decoys.cookie },
            data: {
                email: decoys.email,
                password: decoys.password,
            },
            headers: {
                authorization: decoys.authorization,
                cookie: decoys.cookie,
            },
            method: 'POST',
        },
        extra: {
            bait: decoys.rawMessage,
            note: `Contact ${decoys.email}`,
        },
        exception: {
            values: [{
                type: 'Error',
                value: safeMessage,
                mechanism: { type: 'generic', handled: true },
            }],
        },
    } as Event;
}

async function defaultPostEvent(input: {
    body: string;
    publicKey: string;
    url: string;
}): Promise<{ ok: boolean; status: number; text: string }> {
    const response = await fetch(input.url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Sentry-Auth': [
                'Sentry sentry_version=7',
                'sentry_client=staging-sentry-synthetic/1.0.0',
                `sentry_key=${input.publicKey}`,
            ].join(', '),
        },
        body: input.body,
    });
    return {
        ok: response.ok,
        status: response.status,
        text: await response.text(),
    };
}

function storeEndpoint(): string {
    const identity = STAGING_SENTRY_SYNTHETIC_IDENTITY;
    return `https://${identity.sentryDsnHost}/api/${identity.sentryProjectId}/store/`;
}

async function preflightWeb(log: Log): Promise<void> {
    const response = await fetch(`${STAGING_SENTRY_SYNTHETIC_IDENTITY.webOrigin}/es/`, {
        redirect: 'manual',
    });
    if (!response.ok && response.status !== 304 && ![301, 302, 303, 307, 308].includes(response.status)) {
        throw new Error(`Staging web preflight failed with HTTP ${response.status}`);
    }
    log('[staging-sentry-synthetic] preflight=ok web=staging sentry_dsn=approved');
}

export async function runStagingSentrySynthetic(
    argv: string[],
    dependencies: RunnerDependencies = {},
): Promise<{ eventId: string; requestId: string; runId: string } | null> {
    const workspaceRoot = path.resolve(dependencies.workspaceRoot ?? process.cwd());
    const readText = dependencies.readText ?? ((file: string) => readFileSync(file, 'utf8'));
    const args = parseStagingSentrySyntheticArgs(argv);
    const envFile = path.resolve(dependencies.envFile ?? defaultEnvFile(workspaceRoot));
    const env = parse(readText(envFile)) as Env;
    const gate: StagingSentrySyntheticGate = validateStagingSentrySyntheticGate({
        args,
        env,
        repositoryRemote: (dependencies.repositoryRemote ?? readRepositoryRemote)(workspaceRoot),
        resolvedEnvFile: envFile,
        webConfig: readText(path.resolve(workspaceRoot, 'wrangler.toml')),
        workspaceRoot,
    });
    const log = dependencies.log ?? console.log;
    for (const item of safeStagingSentrySyntheticSummary(gate)) {
        log(`[staging-sentry-synthetic] ${item}`);
    }

    await preflightWeb(log);

    if (gate.mode === 'preflight') {
        log('[staging-sentry-synthetic] result=ok external_writes=none');
        return null;
    }

    const requestId = newRequestId();
    const eventId = newEventId();
    const runId = `sentry-synthetic-${requestId.slice('sentry-synth-'.length).slice(0, 16)}`;
    const scrubbed = scrubSentryEvent(buildDecoyEvent({ eventId, requestId }));
    const body = JSON.stringify(scrubbed);
    assertSyntheticEventHasNoDecoys(body);

    const fingerprint = createHash('sha256').update(body).digest('hex').slice(0, 16);
    log(`[staging-sentry-synthetic] scrubbed=ok payload_fp=${fingerprint}`);

    const postEvent = dependencies.postEvent ?? defaultPostEvent;
    const posted = await postEvent({
        body,
        publicKey: gate.sentryPublicKey,
        url: storeEndpoint(),
    });
    if (!posted.ok) {
        throw new Error(`Sentry ingest rejected the synthetic event with HTTP ${posted.status}`);
    }

    log(`[staging-sentry-synthetic] ingest=ok event_id=${eventId}`);
    log(`[staging-sentry-synthetic] request_id=${requestId}`);
    log(`[staging-sentry-synthetic] r04_probe=sent environment=staging`);
    log(`[staging-sentry-synthetic] result=ok run_id=${runId}`);
    return { eventId, requestId, runId };
}

const invokedScriptPath = process.argv[1];
if (invokedScriptPath && import.meta.url === pathToFileURL(path.resolve(invokedScriptPath)).href) {
    runStagingSentrySynthetic(process.argv.slice(2)).catch((error: unknown) => {
        const message = error instanceof Error
            ? error.message
            : (error && typeof error === 'object' && typeof (error as { message?: unknown }).message === 'string'
                ? (error as { message: string }).message
                : 'Staging Sentry synthetic failed');
        console.error(`[staging-sentry-synthetic] failed=${message}`);
        process.exitCode = 1;
    });
}
