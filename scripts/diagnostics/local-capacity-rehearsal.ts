import { spawn, type ChildProcess } from 'node:child_process';
import { rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
    configurePlaywrightEnvironment,
    PUBLIC_E2E_BASE_URL,
} from '../../tests/e2e/environment-guard';

const requestCount = 1_000;
const concurrency = 30;
const requestTimeoutMs = 10_000;
const startupTimeoutMs = 120_000;
const runtimeVarsPath = resolve('tests/e2e/runtime/.dev.vars');
const requestIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

const routeMix = [
    '/en', '/en', '/en', '/en', '/en', '/en',
    '/es/blog/', '/es/blog/', '/es/blog/',
    '/es/blog/cuanto-tiempo-hablar-espanol-fluido',
    '/es/blog/cuanto-tiempo-hablar-espanol-fluido',
    '/es/blog/cuanto-tiempo-hablar-espanol-fluido',
    '/es/diagnostico', '/es/diagnostico', '/es/diagnostico',
    '/es/login', '/es/login',
    '/es/legal',
    '/ru',
    '/es',
] as const;

export type CapacitySample = {
    bytes: number;
    durationMs: number;
    ok: boolean;
    path: string;
    requestIdPresent: boolean;
    status: number | null;
};

export type CapacitySummary = {
    bytesReceived: number;
    failed: number;
    missingRequestIds: number;
    p50Ms: number;
    p95Ms: number;
    p99Ms: number;
    requests: number;
    statusCounts: Record<string, number>;
    succeeded: number;
};

export function percentile(values: readonly number[], quantile: number): number {
    if (values.length === 0) return 0;
    if (quantile < 0 || quantile > 1) throw new Error('Quantile must be between 0 and 1');

    const sorted = [...values].sort((left, right) => left - right);
    const index = Math.max(0, Math.ceil(quantile * sorted.length) - 1);
    return sorted[index] ?? 0;
}

export function summarizeCapacity(samples: readonly CapacitySample[]): CapacitySummary {
    const durations = samples.map((sample) => sample.durationMs);
    const statusCounts: Record<string, number> = {};

    for (const sample of samples) {
        const status = sample.status === null ? 'network-error' : String(sample.status);
        statusCounts[status] = (statusCounts[status] ?? 0) + 1;
    }

    return {
        requests: samples.length,
        succeeded: samples.filter((sample) => sample.ok).length,
        failed: samples.filter((sample) => !sample.ok).length,
        missingRequestIds: samples.filter((sample) => !sample.requestIdPresent).length,
        bytesReceived: samples.reduce((sum, sample) => sum + sample.bytes, 0),
        p50Ms: Math.round(percentile(durations, 0.5)),
        p95Ms: Math.round(percentile(durations, 0.95)),
        p99Ms: Math.round(percentile(durations, 0.99)),
        statusCounts,
    };
}

function appendLog(buffer: string[], chunk: Buffer): void {
    buffer.push(chunk.toString('utf8'));
    if (buffer.length > 80) buffer.splice(0, buffer.length - 80);
}

async function waitForRuntime(baseUrl: string, child: ChildProcess, logs: string[]): Promise<void> {
    const deadline = Date.now() + startupTimeoutMs;
    const environmentUrl = new URL('/api/e2e-runtime/environment', baseUrl);

    while (Date.now() < deadline) {
        if (child.exitCode !== null) {
            throw new Error(`Isolated runtime exited during startup (${child.exitCode}).\n${logs.join('')}`);
        }

        try {
            const response = await fetch(environmentUrl, { signal: AbortSignal.timeout(2_000) });
            if (response.ok) {
                const payload = await response.json() as Record<string, unknown>;
                if (
                    payload.appEnv === 'test'
                    && payload.externalIntegrationsDisabled === true
                    && payload.providerCredentialsPresent === false
                    && payload.runtimeIsolationEnabled === true
                    && payload.runtimeSupabaseRef === 'placeholder'
                ) return;
            }
        } catch {
            // The isolated server is still compiling or has not bound the port.
        }

        await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
    }

    throw new Error(`Isolated runtime did not become ready.\n${logs.join('')}`);
}

async function stopRuntime(child: ChildProcess): Promise<void> {
    if (child.exitCode !== null) return;

    child.kill('SIGTERM');
    const deadline = Date.now() + 5_000;
    while (child.exitCode === null && Date.now() < deadline) {
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
    }
    if (child.exitCode === null) child.kill('SIGKILL');
}

async function requestPath(baseUrl: string, path: string): Promise<CapacitySample> {
    const startedAt = performance.now();

    try {
        const response = await fetch(new URL(path, baseUrl), {
            headers: { Accept: 'text/html,application/xhtml+xml' },
            redirect: 'follow',
            signal: AbortSignal.timeout(requestTimeoutMs),
        });
        const body = await response.arrayBuffer();
        const requestId = response.headers.get('x-request-id') ?? '';

        return {
            bytes: body.byteLength,
            durationMs: performance.now() - startedAt,
            ok: response.ok && requestIdPattern.test(requestId),
            path,
            requestIdPresent: requestIdPattern.test(requestId),
            status: response.status,
        };
    } catch {
        return {
            bytes: 0,
            durationMs: performance.now() - startedAt,
            ok: false,
            path,
            requestIdPresent: false,
            status: null,
        };
    }
}

async function runRequests(baseUrl: string): Promise<CapacitySample[]> {
    const samples: CapacitySample[] = new Array(requestCount);
    let nextIndex = 0;

    const workers = Array.from({ length: concurrency }, async () => {
        while (true) {
            const index = nextIndex;
            nextIndex += 1;
            if (index >= requestCount) return;

            const path = routeMix[index % routeMix.length] ?? '/en';
            samples[index] = await requestPath(baseUrl, path);
        }
    });

    await Promise.all(workers);
    return samples;
}

async function run(): Promise<void> {
    const baseUrl = new URL(PUBLIC_E2E_BASE_URL);
    if (
        baseUrl.protocol !== 'http:'
        || baseUrl.hostname !== 'localhost'
        || baseUrl.port !== '4321'
        || baseUrl.username
        || baseUrl.password
    ) {
        throw new Error('Capacity rehearsal refuses any target except http://localhost:4321');
    }

    const childEnvironment = { ...process.env };
    configurePlaywrightEnvironment(childEnvironment);

    const logs: string[] = [];
    const child = spawn(process.execPath, ['tests/e2e/start-server.mjs'], {
        cwd: process.cwd(),
        env: childEnvironment,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
    });
    child.stdout?.on('data', (chunk: Buffer) => appendLog(logs, chunk));
    child.stderr?.on('data', (chunk: Buffer) => appendLog(logs, chunk));

    try {
        await waitForRuntime(baseUrl.href, child, logs);

        for (const path of new Set(routeMix)) {
            const sample = await requestPath(baseUrl.href, path);
            if (!sample.ok) throw new Error(`Warm-up failed for ${path} (${String(sample.status)})`);
        }

        const startedAt = performance.now();
        const samples = await runRequests(baseUrl.href);
        const elapsedMs = performance.now() - startedAt;
        const summary = summarizeCapacity(samples);
        const report = {
            target: 'local-isolated-runtime',
            externalIntegrations: 'disabled',
            scenario: {
                name: 'public acquisition burst',
                concurrency,
                requestCount,
                routeCount: new Set(routeMix).size,
                elapsedMs: Math.round(elapsedMs),
                throughputRequestsPerSecond: Number((requestCount / (elapsedMs / 1_000)).toFixed(1)),
            },
            summary,
            limitations: [
                'This exercises the isolated Astro application and public fallback paths only.',
                'It does not exercise authenticated campus traffic, Supabase, Cloudflare, Stripe, Google, Resend or Queue.',
                'It cannot substantiate capacity for 1,000 active students without an authorized staging rehearsal.',
            ],
        };

        console.log(JSON.stringify(report, null, 2));
        if (summary.failed > 0 || summary.missingRequestIds > 0) {
            throw new Error('Local capacity rehearsal observed failed or uncorrelated responses');
        }
    } finally {
        await stopRuntime(child);
        rmSync(runtimeVarsPath, { force: true });
    }
}

const invokedModule = process.argv[1]
    ? pathToFileURL(resolve(process.argv[1])).href
    : '';
if (import.meta.url === invokedModule) {
    run().catch((error: unknown) => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
    });
}
