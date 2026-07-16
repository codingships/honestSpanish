import {
    existsSync,
    mkdtempSync,
    readFileSync,
    readdirSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
    buildSentryProductionHardeningApproval,
    fingerprintSentryId,
} from '../../scripts/launch/sentry-production-hardening-shared';

type FaultPhase = 'pending_write' | 'lock_removal' | 'receipt_write' | 'pending_cleanup' | null;

const localFault = vi.hoisted(() => ({ phase: null as FaultPhase }));

vi.mock('../../scripts/launch/sentry-production-hardening-local', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../scripts/launch/sentry-production-hardening-local')>();
    return {
        ...actual,
        writeSentryProductionFinalizationPending: (filePath: string, contents: string): void => {
            if (localFault.phase === 'pending_write') throw new Error('injected pending write failure');
            actual.writeSentryProductionFinalizationPending(filePath, contents);
        },
        removeSentryProductionExecutionLock: (lockPath: string): void => {
            if (localFault.phase === 'lock_removal') throw new Error('injected execution-lock removal failure');
            actual.removeSentryProductionExecutionLock(lockPath);
        },
        writeSentryProductionHardeningReceipt: (filePath: string, contents: string): void => {
            if (localFault.phase === 'receipt_write') throw new Error('injected receipt write failure');
            actual.writeSentryProductionHardeningReceipt(filePath, contents);
        },
        removeSentryProductionFinalizationPending: (filePath: string): void => {
            if (localFault.phase === 'pending_cleanup') throw new Error('injected pending cleanup failure');
            actual.removeSentryProductionFinalizationPending(filePath);
        },
    };
});

describe.sequential('Sentry production hardening runner finalization boundaries', () => {
    it('refreshes an executed receipt through anchored GET-only reattestation without remote writes', async () => {
        await withRunnerHarness(async (harness) => {
            expect(await harness.execute(['--execute-approved'])).toBeUndefined();
            const sourceReceipt = harness.receiptPaths()[0];
            expect(sourceReceipt).toBeTruthy();
            const writesBefore = remoteWriteCalls(harness.calls).length;

            expect(await harness.execute([
                '--reattest-existing',
                '--source-receipt',
                sourceReceipt as string,
            ])).toBeUndefined();

            expect(remoteWriteCalls(harness.calls)).toHaveLength(writesBefore);
            const reattestation = harness.summaries().find((summary) => summary.mode === 'reattestation');
            expect(reattestation).toMatchObject({
                status: 'OK',
                closureStatus: 'REATTESTED_AND_VERIFIED',
                executeRequested: false,
                externalWriteAttempted: false,
                externalWritePerformed: false,
                createdWorkflowCount: 0,
                evidenceContract: {
                    rolloutEligible: true,
                    attestationMode: 'live_get_only_revalidation',
                },
                reattestation: {
                    sourceExecutedWriteProof: true,
                    detectorFingerprintMatched: true,
                    ownerFingerprintMatched: true,
                    workflowIdFingerprintsMatched: true,
                },
            });
            expect(harness.receiptPaths()).toHaveLength(2);
        });
    });

    it('rejects same-name workflows whose ids no longer match the executed receipt anchor', async () => {
        await withRunnerHarness(async (harness) => {
            expect(await harness.execute(['--execute-approved'])).toBeUndefined();
            const sourceReceipt = harness.receiptPaths()[0] as string;
            const writesBefore = remoteWriteCalls(harness.calls).length;
            harness.patchWorkflow(0, { id: 'foreign-same-name-workflow' });

            expect(await harness.execute([
                '--reattest-existing',
                '--source-receipt',
                sourceReceipt,
            ])).toBe(harness.exitSignal);
            expect(remoteWriteCalls(harness.calls)).toHaveLength(writesBefore);
            expect(harness.receiptPaths()).toHaveLength(1);
            expect(harness.summaries()).toContainEqual(expect.objectContaining({
                status: 'FAILED',
                mode: 'reattestation',
                externalWriteAttempted: false,
                externalWritePerformed: false,
            }));
        });
    });

    it.each(['detector', 'owner'] as const)(
        'rejects %s identity drift that occurs after the initial reattestation preflight',
        async (identityKind) => {
            await withRunnerHarness(async (harness) => {
                expect(await harness.execute(['--execute-approved'])).toBeUndefined();
                const sourceReceipt = harness.receiptPaths()[0] as string;
                const writesBefore = remoteWriteCalls(harness.calls).length;
                if (identityKind === 'detector') harness.invalidateDetectorAfterAdditionalReads(2);
                else harness.invalidateOwnerAfterAdditionalReads(2);

                expect(await harness.execute([
                    '--reattest-existing',
                    '--source-receipt',
                    sourceReceipt,
                ])).toBe(harness.exitSignal);

                expect(remoteWriteCalls(harness.calls)).toHaveLength(writesBefore);
                expect(harness.receiptPaths()).toHaveLength(1);
                const reattestation = harness.summaries().find((summary) => summary.mode === 'reattestation');
                expect(reattestation).toMatchObject({
                    status: 'FAILED',
                    closureStatus: 'BLOCKED',
                    externalWriteAttempted: false,
                    externalWritePerformed: false,
                    checks: expect.arrayContaining([
                        expect.objectContaining({
                            name: 'get_only_reattestation',
                            status: 'failed',
                            details: expect.arrayContaining([
                                'stableDetectorOwnerFingerprintsMatched=false',
                                'remoteWriteAttempted=false',
                            ]),
                        }),
                    ]),
                });
            });
        },
    );

    it('enforces GET-only reattestation at the Sentry transport boundary', () => {
        const source = readFileSync('scripts/launch/sentry-production-hardening.ts', 'utf8');
        expect(source).toContain("if (reattestRequested && method !== 'GET')");
        expect(source).toContain('Sentry GET-only reattestation blocked forbidden');
    });

    it('retains the execution lock and performs no rollback when provisional-state persistence fails', async () => {
        await withRunnerHarness(async (harness) => {
            localFault.phase = 'pending_write';
            expect(await harness.execute(['--execute-approved'])).toBe(harness.exitSignal);
            expect(existsSync(harness.lockPath)).toBe(true);
            expect(existsSync(harness.pendingPath)).toBe(false);
            expect(harness.receiptPaths()).toEqual([]);
            expectNoCompensatingRemoteWrites(harness.calls);
            expect(harness.summaries()).toContainEqual(expect.objectContaining({
                status: 'FAILED',
                closureStatus: 'RECOVERY_REQUIRED',
                rollbackAttempted: false,
                executionLockRetainedForRecovery: true,
            }));
        });
    });

    it('keeps both durable states and performs no rollback when execution-lock removal fails', async () => {
        await withRunnerHarness(async (harness) => {
            localFault.phase = 'lock_removal';
            expect(await harness.execute(['--execute-approved'])).toBe(harness.exitSignal);
            expect(existsSync(harness.lockPath)).toBe(true);
            expect(existsSync(harness.pendingPath)).toBe(true);
            expect(harness.receiptPaths()).toEqual([]);
            expectNoCompensatingRemoteWrites(harness.calls);
            expect(readFileSync(harness.lockPath, 'utf8')).toContain('"event":"hardening_final_readback_verified"');
        });
    });

    it('GET-revalidates exact POST-owned ids and completes locally after a crash before receipt persistence', async () => {
        await withRunnerHarness(async (harness) => {
            localFault.phase = 'receipt_write';
            const firstError = await harness.execute(['--execute-approved']);
            expect(firstError).toBeInstanceOf(Error);
            expect((firstError as Error).message).toContain('injected receipt write failure');
            expect(existsSync(harness.lockPath)).toBe(false);
            expect(existsSync(harness.pendingPath)).toBe(true);
            expect(harness.receiptPaths()).toEqual([]);

            const writesBeforeRecovery = remoteWriteCalls(harness.calls).length;
            localFault.phase = null;
            expect(await harness.execute(['--recover-lock', '--execute-approved'])).toBeUndefined();
            expect(remoteWriteCalls(harness.calls)).toHaveLength(writesBeforeRecovery);
            expect(harness.calls.filter((call) => call.method === 'DELETE')).toEqual([]);
            expect(existsSync(harness.lockPath)).toBe(false);
            expect(existsSync(harness.pendingPath)).toBe(false);
            expect(harness.receiptPaths()).toHaveLength(1);
            const receipt = JSON.parse(readFileSync(harness.receiptPaths()[0], 'utf8')) as Record<string, unknown>;
            expect(receipt).toMatchObject({
                artifactKind: 'sentry_production_hardening_receipt',
                closureStatus: 'HARDENED_AND_VERIFIED',
                createdWorkflowCount: 2,
            });
        });
    });

    it('idempotently clears a leftover provisional state after the receipt was durably written', async () => {
        await withRunnerHarness(async (harness) => {
            localFault.phase = 'pending_cleanup';
            const firstError = await harness.execute(['--execute-approved']);
            expect(firstError).toBeInstanceOf(Error);
            expect((firstError as Error).message).toContain('injected pending cleanup failure');
            expect(existsSync(harness.lockPath)).toBe(false);
            expect(existsSync(harness.pendingPath)).toBe(true);
            expect(harness.receiptPaths()).toHaveLength(1);

            const writesBeforeRecovery = remoteWriteCalls(harness.calls).length;
            localFault.phase = null;
            expect(await harness.execute(['--recover-lock', '--execute-approved'])).toBeUndefined();
            expect(remoteWriteCalls(harness.calls)).toHaveLength(writesBeforeRecovery);
            expect(existsSync(harness.pendingPath)).toBe(false);
            expect(harness.receiptPaths().length).toBeGreaterThanOrEqual(1);
        });
    });

    it('never adopts a same-name workflow with a different POST source id or owner', async () => {
        await withRunnerHarness(async (harness) => {
            localFault.phase = 'receipt_write';
            expect(await harness.execute(['--execute-approved'])).toBeInstanceOf(Error);
            const writesBeforeRecovery = remoteWriteCalls(harness.calls).length;

            localFault.phase = null;
            harness.patchWorkflow(0, { id: 'foreign-workflow-id' });
            expect(await harness.execute(['--recover-lock', '--execute-approved'])).toBe(harness.exitSignal);
            expect(remoteWriteCalls(harness.calls)).toHaveLength(writesBeforeRecovery);
            expect(existsSync(harness.pendingPath)).toBe(true);
            expect(harness.receiptPaths()).toEqual([]);

            harness.patchWorkflow(0, { id: 'workflow-test-1', owner: 'user:foreign-owner-id' });
            expect(await harness.execute(['--recover-lock', '--execute-approved'])).toBe(harness.exitSignal);
            expect(remoteWriteCalls(harness.calls)).toHaveLength(writesBeforeRecovery);
            expect(existsSync(harness.pendingPath)).toBe(true);
            expect(harness.receiptPaths()).toEqual([]);
        });
    });

    it.each([
        ['another HTTPS origin', 'https://attacker.invalid'],
        ['credentials', 'https://user:password@sentry.io'],
        ['a query string', 'https://sentry.io/?redirect=attacker'],
        ['a fragment', 'https://sentry.io/#attacker'],
        ['a non-root path', 'https://sentry.io/api/0/'],
        ['a normalized-away path', 'https://sentry.io/api/../'],
        ['an explicit port', 'https://sentry.io:443/'],
        ['an invalid HTTPS URL', 'https://'],
    ])('rejects a Sentry base URL containing %s before every fetch in plan and execute mode', async (_label, baseUrl) => {
        await withRunnerHarness(async (harness) => {
            expect(await harness.execute([])).toBe(harness.exitSignal);
            expect(harness.calls).toEqual([]);

            expect(await harness.execute(['--execute-approved'])).toBe(harness.exitSignal);
            expect(harness.calls).toEqual([]);
            expect(harness.receiptPaths()).toEqual([]);
            expect(harness.summaries().length).toBeGreaterThan(0);
            for (const summary of harness.summaries()) {
                expect(summary).toMatchObject({
                    status: 'FAILED',
                    externalWriteAttempted: false,
                    externalWritePerformed: false,
                });
                expect(summary.checks).toEqual(expect.arrayContaining([
                    expect.objectContaining({
                        name: 'local_environment',
                        status: 'failed',
                        details: expect.arrayContaining(['baseOriginCanonical=false']),
                    }),
                ]));
            }
        }, { baseUrl });
    });
});

interface RunnerHarness {
    calls: Array<{ method: string; path: string }>;
    exitSignal: Error;
    lockPath: string;
    pendingPath: string;
    execute: (args: string[]) => Promise<unknown>;
    invalidateDetectorAfterAdditionalReads: (additionalReads: number) => void;
    invalidateOwnerAfterAdditionalReads: (additionalReads: number) => void;
    patchWorkflow: (index: number, patch: Record<string, unknown>) => void;
    receiptPaths: () => string[];
    summaries: () => Array<Record<string, unknown>>;
}

async function withRunnerHarness(
    run: (harness: RunnerHarness) => Promise<void>,
    options: { baseUrl?: string } = {},
): Promise<void> {
    const originalCwd = process.cwd();
    const originalArgv = [...process.argv];
    const environmentKeys = [
        'SENTRY_AUTH_TOKEN',
        'SENTRY_BASE_URL',
        'SENTRY_ORG',
        'SENTRY_PROJECT',
        'SENTRY_PRODUCTION_HARDENING_APPROVAL',
    ] as const;
    const originalEnvironment = new Map(environmentKeys.map((key) => [key, process.env[key]]));
    const directory = mkdtempSync(path.join(os.tmpdir(), 'eh-sentry-hardening-runner-'));
    const outputRoot = path.join(directory, 'outputs', 'launch-sentry-production-hardening');
    const detectorId = 'detector-test-id';
    const ownerUserId = 'owner-test-id';
    const baseUrl = options.baseUrl ?? 'https://sentry.io';
    const calls: Array<{ method: string; path: string }> = [];
    const workflows: Array<Record<string, unknown>> = [];
    let detectorReadCount = 0;
    let ownerReadCount = 0;
    let detectorInvalidAtRead: number | null = null;
    let ownerInvalidAtRead: number | null = null;
    let scrubIPAddresses = false;
    const exitSignal = new Error('expected process.exit from a failed runner');
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw exitSignal;
    });
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
        const url = new URL(String(input));
        const method = (init?.method ?? 'GET').toUpperCase();
        calls.push({ method, path: url.pathname });
        if (url.pathname === '/api/0/projects/honestspanish/espanol-honesto-astro/') {
            if (method === 'PUT') scrubIPAddresses = parseBody(init?.body).scrubIPAddresses === true;
            return jsonResponse({
                slug: 'espanol-honesto-astro',
                status: 'active',
                dataScrubber: true,
                dataScrubberDefaults: true,
                scrubIPAddresses,
                access: ['alerts:read', 'alerts:write'],
            });
        }
        if (url.pathname === '/api/0/projects/honestspanish/espanol-honesto-astro/rules/') {
            return jsonResponse(projectRulesMirror(workflows, ownerUserId));
        }
        if (url.pathname === '/api/0/organizations/honestspanish/detectors/') {
            detectorReadCount += 1;
            return jsonResponse([{
                id: detectorId,
                type: 'error',
                enabled: detectorInvalidAtRead === null || detectorReadCount < detectorInvalidAtRead,
            }]);
        }
        if (url.pathname === '/api/0/organizations/honestspanish/members/') {
            ownerReadCount += 1;
            const currentOwnerUserId = ownerInvalidAtRead !== null && ownerReadCount >= ownerInvalidAtRead
                ? 'foreign-owner-test-id'
                : ownerUserId;
            return jsonResponse([{ orgRole: 'owner', user: { id: currentOwnerUserId } }]);
        }
        if (url.pathname === '/api/0/organizations/honestspanish/workflows/') {
            if (method === 'GET') return jsonResponse(workflows);
            if (method === 'POST') {
                const payload = parseBody(init?.body);
                const ordinal = workflows.length + 1;
                const triggers = payload.triggers as Record<string, unknown>;
                const actionFilters = payload.actionFilters as Array<Record<string, unknown>>;
                const eventFrequencyConditions = actionFilters
                    .flatMap((actionFilter) => actionFilter.conditions as Array<Record<string, unknown>>)
                    .filter((condition) => condition.type === 'event_frequency_count');
                const eventFrequencyContractIsValid = eventFrequencyConditions.every((condition) => {
                    const comparison = condition.comparison as Record<string, unknown>;
                    return Number.isSafeInteger(comparison.value)
                        && Number(comparison.value) >= 0
                        && comparison.interval === '5m'
                        && Object.keys(comparison).sort().join(',') === 'interval,value';
                });
                if (!eventFrequencyContractIsValid) {
                    return jsonResponse({ detail: 'invalid event-frequency comparison' }, 400);
                }
                const created = {
                    ...payload,
                    id: `workflow-test-${ordinal}`,
                    organizationId: 'organization-test-id',
                    triggers: {
                        ...triggers,
                        id: `trigger-test-${ordinal}`,
                        organizationId: 'organization-test-id',
                        conditions: (triggers.conditions as Array<Record<string, unknown>>).map((condition, index) => ({
                            ...condition,
                            id: `trigger-condition-test-${ordinal}-${index + 1}`,
                        })),
                    },
                    actionFilters: actionFilters.map((actionFilter, filterIndex) => ({
                        ...actionFilter,
                        id: `action-filter-test-${ordinal}-${filterIndex + 1}`,
                        organizationId: 'organization-test-id',
                        conditions: (actionFilter.conditions as Array<Record<string, unknown>>).map((condition, conditionIndex) => ({
                            ...condition,
                            id: `filter-condition-test-${ordinal}-${conditionIndex + 1}`,
                        })),
                        actions: (actionFilter.actions as Array<Record<string, unknown>>).map((action, actionIndex) => ({
                            ...action,
                            id: `action-test-${ordinal}-${actionIndex + 1}`,
                        })),
                    })),
                };
                workflows.push(created);
                return jsonResponse(created);
            }
        }
        if (url.pathname.startsWith('/api/0/organizations/honestspanish/workflows/') && method === 'DELETE') {
            return new Response(null, { status: 204 });
        }
        throw new Error(`Unexpected Sentry test request: ${method} ${url.pathname}`);
    });

    try {
        process.chdir(directory);
        writeFileSync(path.join(directory, '.env'), [
            'SENTRY_AUTH_TOKEN=test-token',
            `SENTRY_BASE_URL=${baseUrl}`,
            'SENTRY_ORG=honestspanish',
            'SENTRY_PROJECT=espanol-honesto-astro',
            '',
        ].join('\n'), 'utf8');
        process.env.SENTRY_AUTH_TOKEN = 'test-token';
        process.env.SENTRY_BASE_URL = baseUrl;
        process.env.SENTRY_ORG = 'honestspanish';
        process.env.SENTRY_PROJECT = 'espanol-honesto-astro';
        process.env.SENTRY_PRODUCTION_HARDENING_APPROVAL = buildSentryProductionHardeningApproval({
            detectorFingerprint: fingerprintSentryId(detectorId),
            ownerFingerprint: fingerprintSentryId(ownerUserId),
        });
        vi.stubGlobal('fetch', fetchMock);

        const execute = async (args: string[]): Promise<unknown> => {
            process.argv = [originalArgv[0] ?? 'node', originalArgv[1] ?? 'vitest', ...args];
            exitSpy.mockClear();
            vi.resetModules();
            try {
                await import('../../scripts/launch/sentry-production-hardening');
                return undefined;
            } catch (error) {
                return error;
            }
        };
        await run({
            calls,
            exitSignal,
            lockPath: path.join(outputRoot, '.execution-lock.jsonl'),
            pendingPath: path.join(outputRoot, '.finalization-pending.json'),
            execute,
            invalidateDetectorAfterAdditionalReads: (additionalReads) => {
                detectorInvalidAtRead = detectorReadCount + additionalReads;
            },
            invalidateOwnerAfterAdditionalReads: (additionalReads) => {
                ownerInvalidAtRead = ownerReadCount + additionalReads;
            },
            patchWorkflow: (index, patch) => {
                Object.assign(workflows[index], patch);
            },
            receiptPaths: () => artifactPaths(outputRoot, 'sentry-production-hardening-receipt.json'),
            summaries: () => artifactPaths(outputRoot, 'summary.json').map((filePath) => (
                JSON.parse(readFileSync(filePath, 'utf8')) as Record<string, unknown>
            )),
        });
    } finally {
        localFault.phase = null;
        vi.unstubAllGlobals();
        consoleSpy.mockRestore();
        exitSpy.mockRestore();
        process.chdir(originalCwd);
        process.argv = originalArgv;
        for (const [key, value] of originalEnvironment) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
        rmSync(directory, { recursive: true, force: true });
    }
}

function artifactPaths(outputRoot: string, fileName: string): string[] {
    if (!existsSync(outputRoot)) return [];
    return readdirSync(outputRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(outputRoot, entry.name, fileName))
        .filter(existsSync);
}

function remoteWriteCalls(calls: Array<{ method: string; path: string }>): Array<{ method: string; path: string }> {
    return calls.filter((call) => ['POST', 'PUT', 'DELETE'].includes(call.method));
}

function expectNoCompensatingRemoteWrites(calls: Array<{ method: string; path: string }>): void {
    expect(calls.filter((call) => call.method === 'DELETE')).toEqual([]);
    expect(calls.filter((call) => call.method === 'PUT')).toHaveLength(1);
}

function parseBody(body: BodyInit | null | undefined): Record<string, unknown> {
    if (typeof body !== 'string') throw new Error('Expected a JSON string body in Sentry runner test.');
    return JSON.parse(body) as Record<string, unknown>;
}

function jsonResponse(value: unknown, status = 200): Response {
    return new Response(JSON.stringify(value), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

function projectRulesMirror(
    workflows: Array<Record<string, unknown>>,
    ownerUserId: string,
): Array<Record<string, unknown>> {
    return workflows.map((workflow) => {
        const common = {
            name: workflow.name,
            environment: 'production',
            frequency: (workflow.config as Record<string, unknown>).frequency,
            owner: `user:${ownerUserId}`,
            status: 'active',
            snooze: false,
            projects: ['espanol-honesto-astro'],
            actionMatch: 'any',
            filterMatch: 'all',
            actions: [{
                id: 'sentry.mail.actions.NotifyEmailAction',
                targetType: 'Member',
                targetIdentifier: ownerUserId,
                fallthroughType: 'ActiveMembers',
                name: 'Send an email notification',
            }],
        };
        if (workflow.name === 'EH Production - New and regressed errors') {
            return {
                ...common,
                conditions: [
                    { id: 'sentry.rules.conditions.first_seen_event.FirstSeenEventCondition', name: 'A new issue is created' },
                    { id: 'sentry.rules.conditions.reappeared_event.ReappearedEventCondition', name: 'A resolved issue reappears' },
                    { id: 'sentry.rules.conditions.regression_event.RegressionEventCondition', name: 'An issue regresses' },
                ],
                filters: [{
                    id: 'sentry.rules.filters.issue_category.IssueCategoryFilter',
                    value: '1',
                    name: 'The issue category is error',
                }],
            };
        }
        return {
            ...common,
            conditions: [{
                id: 'sentry.rules.conditions.event_frequency.EventFrequencyCondition',
                comparisonType: 'count',
                value: 10,
                interval: '5m',
                name: 'The issue is seen more than 10 times in 5 minutes',
            }],
            filters: [],
        };
    });
}
