import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
    cloudflareGetWithRetry,
    retryCloudflareReadonlyGet,
} from '../../scripts/launch/cloudflare-staging-fulfillment-rollback-drill';
import {
    EXPECTED_STAGING_PLAIN_TEXT,
    STAGING_FULFILLMENT_ROLLBACK_APPROVAL_ENV,
    STAGING_FULFILLMENT_ROLLBACK_TARGET,
    buildApprovalSnapshot,
    discoverRollbackVersions,
    exactRollbackApproval,
    parseMixedWranglerJson,
    parseQueueDeliverySnapshot,
    parseVersionShape,
    rollbackWranglerArgs,
    snapshotSha256,
    validateHealthIdentity,
    validateVersionCompatibility,
} from '../../scripts/launch/cloudflare-staging-fulfillment-rollback-drill-shared';

const runnerSource = readFileSync('scripts/launch/cloudflare-staging-fulfillment-rollback-drill.ts', 'utf8');
const orchestratorSource = readFileSync('scripts/launch/cloudflare-staging-fulfillment-rollback-drill-orchestrator.ts', 'utf8');
const packageJson = readFileSync('package.json', 'utf8');
const runbook = readFileSync('docs/launch/RUNBOOK.md', 'utf8');
const checklist = readFileSync('docs/launch/CHECKLIST.md', 'utf8');

const CURRENT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PREVIOUS = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function deployment(id: string, versionId: string, createdOn: string, percentage = 100) {
    return {
        id,
        created_on: createdOn,
        versions: [{ version_id: versionId, percentage }],
    };
}

function versionView(id: string, overrides: Record<string, unknown> = {}) {
    return {
        id,
        resources: {
            script: { handlers: ['scheduled', 'fetch', 'queue'] },
            bindings: [
                ...Object.entries(EXPECTED_STAGING_PLAIN_TEXT)
                    .map(([name, text]) => ({ name, type: 'plain_text', text })),
                { name: 'CF_VERSION_METADATA', type: 'version_metadata' },
                { name: 'FULFILLMENT_QUEUE', type: 'queue' },
                { name: 'INTERNAL_JOB_SECRET', type: 'secret_text' },
            ],
        },
        ...overrides,
    };
}

describe('Cloudflare staging Fulfillment rollback drill', () => {
    it('pins the exact staging account, Worker, direct URL and approval environment', () => {
        expect(STAGING_FULFILLMENT_ROLLBACK_TARGET).toEqual({
            accountId: 'd1a22bcf6477ff2ff31d2bfb83084e44',
            worker: 'espanol-honesto-fulfillment-staging',
            queue: 'espanol-honesto-fulfillment-staging-queue',
            queueId: 'b65c8b6e98b140c2b3de53a86d3fc36a',
            directUrl: 'https://espanol-honesto-fulfillment-staging.alindev95.workers.dev',
        });
        expect(STAGING_FULFILLMENT_ROLLBACK_APPROVAL_ENV)
            .toBe('CLOUDFLARE_STAGING_FULFILLMENT_ROLLBACK_DRILL_APPROVAL');
    });

    it('discovers the current and immediate previous single-version 100% deployments by timestamp', () => {
        const current = deployment('deployment-current', CURRENT, '2026-07-12T20:00:00Z');
        const previous = deployment('deployment-previous', PREVIOUS, '2026-07-12T19:00:00Z');
        const older = deployment(
            'deployment-older',
            'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
            '2026-07-11T19:00:00Z',
        );

        expect(discoverRollbackVersions(current, [older, current, previous])).toEqual({
            currentDeploymentId: 'deployment-current',
            currentVersionId: CURRENT,
            currentCreatedOn: '2026-07-12T20:00:00Z',
            previousDeploymentId: 'deployment-previous',
            previousVersionId: PREVIOUS,
            previousCreatedOn: '2026-07-12T19:00:00Z',
        });
    });

    it('does not skip an incompatible immediate prior deployment to find an older convenient target', () => {
        const current = deployment('deployment-current', CURRENT, '2026-07-12T20:00:00Z');
        const split = {
            id: 'deployment-split',
            created_on: '2026-07-12T19:00:00Z',
            versions: [
                { version_id: PREVIOUS, percentage: 50 },
                { version_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', percentage: 50 },
            ],
        };
        const older = deployment('deployment-older', PREVIOUS, '2026-07-11T19:00:00Z');

        expect(() => discoverRollbackVersions(current, [older, split, current]))
            .toThrow('immediate previous deployment must contain exactly one version at 100% traffic');
    });

    it('requires identical exact handlers and binding name/type shape and fail-closed checkout values', () => {
        const current = parseVersionShape(versionView(CURRENT), CURRENT);
        const previous = parseVersionShape(versionView(PREVIOUS), PREVIOUS);
        expect(validateVersionCompatibility(current, previous)).toEqual({ compatible: true, errors: [] });

        const unsafeBindings = [
            ...Object.entries(EXPECTED_STAGING_PLAIN_TEXT)
                .filter(([name]) => name !== 'PUBLIC_APP_ENV')
                .map(([name, text]) => ({
                    name,
                    type: 'plain_text',
                    text: name === 'CHECKOUT_ENABLED' ? 'true' : text,
                })),
            { name: 'CF_VERSION_METADATA', type: 'version_metadata' },
        ];
        const unsafePrevious = parseVersionShape(versionView(PREVIOUS, {
            resources: {
                script: { handlers: ['fetch', 'queue'] },
                bindings: unsafeBindings,
            },
        }), PREVIOUS);
        const result = validateVersionCompatibility(current, unsafePrevious);
        expect(result.compatible).toBe(false);
        expect(result.errors).toEqual(expect.arrayContaining([
            expect.stringContaining('Previous handler shape'),
            expect.stringContaining('binding name/type shapes differ'),
            expect.stringContaining('previous CHECKOUT_ENABLED must be present and exactly false'),
            expect.stringContaining('previous PUBLIC_APP_ENV must be present and exactly staging'),
        ]));
    });

    it('binds exact approval to both versions and the canonical non-secret snapshot', () => {
        const versions = discoverRollbackVersions(
            deployment('deployment-current', CURRENT, '2026-07-12T20:00:00Z'),
            [
                deployment('deployment-current', CURRENT, '2026-07-12T20:00:00Z'),
                deployment('deployment-previous', PREVIOUS, '2026-07-12T19:00:00Z'),
            ],
        );
        const health = {
            httpStatus: 200,
            ok: true,
            service: 'fulfillment-worker',
            runtime: 'cloudflare-workers',
            operationMode: 'active',
            workerIdentity: STAGING_FULFILLMENT_ROLLBACK_TARGET.worker,
        };
        expect(validateHealthIdentity(health)).toEqual([]);
        const snapshot = buildApprovalSnapshot({
            versions,
            currentShape: parseVersionShape(versionView(CURRENT), CURRENT),
            previousShape: parseVersionShape(versionView(PREVIOUS), PREVIOUS),
            health,
            queue: {
                schemaVersion: 1,
                source: 'cloudflare-api-readonly',
                capturedAt: '2026-07-12T20:00:00Z',
                accountId: STAGING_FULFILLMENT_ROLLBACK_TARGET.accountId,
                queueId: STAGING_FULFILLMENT_ROLLBACK_TARGET.queueId,
                queueName: STAGING_FULFILLMENT_ROLLBACK_TARGET.queue,
                deliveryPaused: 'absent_requires_normalization',
                producerWorkerNames: [STAGING_FULFILLMENT_ROLLBACK_TARGET.worker],
                consumerWorkerNames: [STAGING_FULFILLMENT_ROLLBACK_TARGET.worker],
                backlogMessages: 0,
            },
            cronSchedules: ['0 * * * *'],
        });
        const hash = snapshotSha256(snapshot);
        const approval = exactRollbackApproval(versions, hash);

        expect(hash).toMatch(/^[0-9a-f]{64}$/u);
        expect(approval).toContain(`current=${CURRENT}`);
        expect(approval).toContain(`previous=${PREVIOUS}`);
        expect(approval).toContain(`snapshot=${hash}`);
        expect(approval).toContain('production_and_other_resources=FORBIDDEN');
        expect(approval).toContain('disable_cron_before_rollback=true');
        expect(approval).toContain('restore_hourly_cron=true');
        expect(approval).toContain('verify_isolation_after_restore_current_failure=true');
        expect(approval).toContain('compensate_incomplete_cron_or_queue_restore=cron_off_and_queue_paused');
        expect(approval).toContain('compensation_readback=cron_off_queue_paused_backlog_zero');
        expect(snapshot).toMatchObject({
            drill: {
                conditionalCompensationWritesInOrder: [
                    expect.stringContaining('disable exact staging Worker cron'),
                    'pause exact staging Queue',
                ],
                failClosedReadbacks: [
                    expect.stringContaining('restore_current failure'),
                    expect.stringContaining('after compensation'),
                ],
            },
        });

        const laterCapture = buildApprovalSnapshot({
            versions,
            currentShape: parseVersionShape(versionView(CURRENT), CURRENT),
            previousShape: parseVersionShape(versionView(PREVIOUS), PREVIOUS),
            health,
            queue: {
                ...snapshot.queue as Record<string, unknown>,
                schemaVersion: 1,
                source: 'cloudflare-api-readonly',
                capturedAt: '2026-07-12T20:01:00Z',
            } as never,
            cronSchedules: ['0 * * * *'],
        });
        expect(snapshotSha256(laterCapture)).toBe(hash);
    });

    it('extracts complete JSON from mixed Wrangler output without trusting surrounding lines', () => {
        expect(parseMixedWranglerJson('Wrangler notice\n{"loggedIn":true,"accounts":[]}\nDone')).toEqual({
            loggedIn: true,
            accounts: [],
        });
        expect(() => parseMixedWranglerJson('notice only')).toThrow('complete JSON');
    });

    it('retries transient read-only GET transport and provider failures with bounded deterministic backoff', async () => {
        const transientTransport = vi.fn()
            .mockRejectedValueOnce(new TypeError('fetch failed'))
            .mockResolvedValue({ status: 200, value: 'ok' });
        const transportWait = vi.fn().mockResolvedValue(undefined);

        await expect(retryCloudflareReadonlyGet(transientTransport, transportWait))
            .resolves.toEqual({ status: 200, value: 'ok' });
        expect(transientTransport).toHaveBeenCalledTimes(2);
        expect(transientTransport).toHaveBeenNthCalledWith(1, 1, 3);
        expect(transientTransport).toHaveBeenNthCalledWith(2, 2, 3);
        expect(transportWait).toHaveBeenCalledTimes(1);
        expect(transportWait).toHaveBeenCalledWith(250);

        const transientProvider = vi.fn()
            .mockResolvedValueOnce({ status: 429 })
            .mockResolvedValueOnce({ status: 503 })
            .mockResolvedValue({ status: 200 });
        const providerWait = vi.fn().mockResolvedValue(undefined);

        await expect(retryCloudflareReadonlyGet(transientProvider, providerWait))
            .resolves.toEqual({ status: 200 });
        expect(transientProvider).toHaveBeenCalledTimes(3);
        expect(providerWait.mock.calls).toEqual([[250], [1_000]]);
    });

    it('exhausts read-only GET retries fail-closed and does not retry non-transient responses or parse errors', async () => {
        const exhausted = vi.fn().mockRejectedValue(new TypeError('fetch failed'));
        const exhaustedWait = vi.fn().mockResolvedValue(undefined);

        await expect(retryCloudflareReadonlyGet(exhausted, exhaustedWait)).rejects.toThrow('fetch failed');
        expect(exhausted).toHaveBeenCalledTimes(3);
        expect(exhaustedWait.mock.calls).toEqual([[250], [1_000]]);

        for (const failure of [
            { kind: 'http', value: { status: 401 } },
            { kind: 'http', value: { status: 409 } },
            { kind: 'parse', value: new SyntaxError('invalid JSON') },
        ] as const) {
            const request = failure.kind === 'http'
                ? vi.fn().mockResolvedValue(failure.value)
                : vi.fn().mockRejectedValue(failure.value);
            const wait = vi.fn().mockResolvedValue(undefined);
            if (failure.kind === 'http') {
                await expect(retryCloudflareReadonlyGet(request, wait)).resolves.toEqual(failure.value);
            } else {
                await expect(retryCloudflareReadonlyGet(request, wait)).rejects.toThrow('invalid JSON');
            }
            expect(request).toHaveBeenCalledTimes(1);
            expect(wait).not.toHaveBeenCalled();
        }
    });

    it('retries AbortError and a real Cloudflare GET 503 body before requiring JSON', async () => {
        const abortError = new Error('request aborted');
        abortError.name = 'AbortError';
        const abortedRequest = vi.fn()
            .mockRejectedValueOnce(abortError)
            .mockResolvedValue({ status: 200 });
        const abortWait = vi.fn().mockResolvedValue(undefined);

        await expect(retryCloudflareReadonlyGet(abortedRequest, abortWait))
            .resolves.toEqual({ status: 200 });
        expect(abortedRequest).toHaveBeenCalledTimes(2);
        expect(abortWait).toHaveBeenCalledWith(250);

        const fetchMock = vi.fn()
            .mockResolvedValueOnce(new Response('<html>temporary upstream failure</html>', { status: 503 }))
            .mockResolvedValueOnce(new Response(JSON.stringify({ success: true, result: {} }), {
                status: 200,
                headers: { 'content-type': 'application/json' },
            }));
        const providerWait = vi.fn().mockResolvedValue(undefined);
        vi.stubEnv('CLOUDFLARE_API_TOKEN', 'test-token');
        vi.stubGlobal('fetch', fetchMock);
        try {
            await expect(cloudflareGetWithRetry('test_get_503', '/test', providerWait))
                .resolves.toMatchObject({ ok: true, status: 200 });
            expect(fetchMock).toHaveBeenCalledTimes(2);
            expect(providerWait).toHaveBeenCalledTimes(1);
            expect(providerWait).toHaveBeenCalledWith(250);
        } finally {
            vi.unstubAllGlobals();
            vi.unstubAllEnvs();
        }
    });

    it('keeps GET retries structurally separate from single-attempt PATCH, PUT and Wrangler writes', () => {
        for (const reader of ['readQueueState', 'readQueueBacklog', 'readSchedules']) {
            const start = runnerSource.indexOf(`async function ${reader}`);
            const end = runnerSource.indexOf('\n}', start) + 2;
            expect(start, reader).toBeGreaterThan(-1);
            expect(runnerSource.slice(start, end), reader).toContain('cloudflareGetWithRetry(');
        }

        const apiWriteStart = runnerSource.indexOf('async function executeApiWrite');
        const apiWriteEnd = runnerSource.indexOf('\n}', apiWriteStart) + 2;
        const apiWriteSource = runnerSource.slice(apiWriteStart, apiWriteEnd);
        expect(apiWriteSource).toContain('cloudflareRequestOnce(');
        expect(apiWriteSource).not.toContain('cloudflareGetWithRetry(');
        expect(apiWriteSource).toContain('body, 1, 1');

        const wranglerWriteStart = runnerSource.indexOf('function executeWranglerWrite');
        const wranglerWriteEnd = runnerSource.indexOf('\n}', wranglerWriteStart) + 2;
        const wranglerWriteSource = runnerSource.slice(wranglerWriteStart, wranglerWriteEnd);
        expect(wranglerWriteSource).toContain('runWrangler(');
        expect(wranglerWriteSource).not.toContain('retryCloudflareReadonlyGet(');
    });

    it('requires explicit Queue delivery state, exact ID/shape and fresh evidence', () => {
        const base = {
            schemaVersion: 1,
            source: 'cloudflare-api-readonly',
            capturedAt: '2026-07-12T20:00:00Z',
            accountId: STAGING_FULFILLMENT_ROLLBACK_TARGET.accountId,
            queueId: STAGING_FULFILLMENT_ROLLBACK_TARGET.queueId,
            queueName: STAGING_FULFILLMENT_ROLLBACK_TARGET.queue,
            deliveryPaused: false,
            producerWorkerNames: [STAGING_FULFILLMENT_ROLLBACK_TARGET.worker],
            consumerWorkerNames: [STAGING_FULFILLMENT_ROLLBACK_TARGET.worker],
            backlogMessages: 0,
        };
        expect(parseQueueDeliverySnapshot(base, new Date('2026-07-12T20:01:00Z')).deliveryPaused).toBe(false);
        expect(() => parseQueueDeliverySnapshot({ ...base, deliveryPaused: undefined }, new Date('2026-07-12T20:01:00Z')))
            .toThrow('deliveryPaused is missing');
        expect(() => parseQueueDeliverySnapshot({ ...base, queueId: 'wrong' }, new Date('2026-07-12T20:01:00Z')))
            .toThrow('Queue snapshot ID');
    });

    it('builds only the exact rollback command and orders the write behind two live preflights and approval', () => {
        expect(rollbackWranglerArgs(PREVIOUS)).toEqual([
            'rollback',
            PREVIOUS,
            '--name',
            STAGING_FULFILLMENT_ROLLBACK_TARGET.worker,
            '--yes',
        ]);

        const initial = runnerSource.indexOf("runLivePreflight('preflight_initial')");
        const approval = runnerSource.indexOf('report.approvalMatched =');
        const second = runnerSource.indexOf("runLivePreflight('preflight_before_write')");
        const acquireLock = runnerSource.indexOf('acquireExecutionLock(initial.versions, initial.snapshotSha256)');
        const armManualReconciliation = runnerSource.indexOf('report.manualReconciliationRequired = true;', acquireLock);
        const orchestrationCall = runnerSource.indexOf('orchestrateRollbackDrill({');
        const releaseGuard = runnerSource.indexOf('if (executionLockMayBeReleased(orchestration))', orchestrationCall);
        const releaseCall = runnerSource.indexOf('releaseExecutionLock();', releaseGuard);
        const forwardList = orchestratorSource.indexOf('const FORWARD_PHASES');
        const disable = orchestratorSource.indexOf("'disable_cron'", forwardList);
        const normalize = orchestratorSource.indexOf("'normalize_queue_active'", disable);
        const pause = orchestratorSource.indexOf("'pause_queue'", normalize);
        const isolation = orchestratorSource.indexOf("'verify_isolation'", pause);
        const rollback = orchestratorSource.indexOf("'rollback_previous'", isolation);
        const recovery = orchestratorSource.indexOf('if (aWriteMayHaveStarted)');
        const restore = orchestratorSource.indexOf("runSafely(driver, 'restore_current')", recovery);
        const restoreCron = orchestratorSource.indexOf("runSafely(driver, 'restore_cron')", restore);
        const resume = orchestratorSource.indexOf("runSafely(driver, 'resume_queue')", restoreCron);
        const compensate = orchestratorSource.indexOf('compensateAndVerifyIsolation(driver, outcomes)', resume);
        const compensateDisable = orchestratorSource.indexOf("runSafely(driver, 'compensate_disable_cron')");
        const compensatePause = orchestratorSource.indexOf("runSafely(driver, 'compensate_pause_queue')", compensateDisable);
        const compensateVerify = orchestratorSource.indexOf("runSafely(driver, 'verify_compensated_isolation')", compensatePause);

        expect(initial).toBeGreaterThan(-1);
        expect(initial).toBeLessThan(approval);
        expect(approval).toBeLessThan(second);
        expect(second).toBeLessThan(acquireLock);
        expect(acquireLock).toBeLessThan(armManualReconciliation);
        expect(armManualReconciliation).toBeLessThan(orchestrationCall);
        expect(orchestrationCall).toBeLessThan(releaseGuard);
        expect(releaseGuard).toBeLessThan(releaseCall);
        expect(runnerSource.indexOf('releaseExecutionLock();', releaseCall + 1)).toBe(-1);
        expect(disable).toBeLessThan(normalize);
        expect(normalize).toBeLessThan(pause);
        expect(pause).toBeLessThan(isolation);
        expect(isolation).toBeLessThan(rollback);
        expect(recovery).toBeLessThan(restore);
        expect(restore).toBeLessThan(restoreCron);
        expect(restoreCron).toBeLessThan(resume);
        expect(resume).toBeLessThan(compensate);
        expect(compensateDisable).toBeLessThan(compensatePause);
        expect(compensatePause).toBeLessThan(compensateVerify);
        expect(orchestrationCall).toBeGreaterThan(-1);
    });

    it('stores sanitized metadata only and exposes the plan through pnpm and launch docs without closing it', () => {
        for (const snippet of [
            'noRawProviderOutputStored: true',
            'noSecretValuesStored: true',
            'stdoutSha256',
            'stderrSha256',
            "delete childEnv[STAGING_FULFILLMENT_ROLLBACK_APPROVAL_ENV]",
            'RESTORATION_UNPROVEN',
            'BLOCKED_NO_TOKEN',
            '--install-skills=false',
            'markExternalWriteAttemptStarted',
            'requireReadonlyReconciliation',
            'manualReconciliationRequired',
            'executionLockMayBeReleased(orchestration)',
            'minimalWranglerEnvironment()',
        ]) {
            expect(runnerSource).toContain(snippet);
        }
        expect(runnerSource).not.toContain("'/internal/");
        expect(runnerSource).not.toContain("'purge'");
        expect(runnerSource).not.toContain("'delete'");
        expect(runnerSource).not.toContain("'consumer'");
        expect(packageJson).toContain('"launch:cloudflare-staging-fulfillment-rollback-drill"');
        expect(runbook).toContain('pnpm launch:cloudflare-staging-fulfillment-rollback-drill');
        expect(checklist).toContain('launch:cloudflare-staging-fulfillment-rollback-drill');
        expect(checklist).toContain('- [ ] Proceso de rollback probado.');
    });

    it('initializes all top-level mutable command state before starting the runner', () => {
        const commandOutputInitialization = runnerSource.indexOf('const commandOutput = new Map<string, string>();');
        const topLevelRun = runnerSource.indexOf('await run();');

        expect(commandOutputInitialization).toBeGreaterThan(-1);
        expect(topLevelRun).toBeGreaterThan(-1);
        expect(commandOutputInitialization).toBeLessThan(topLevelRun);
        expect(runnerSource.indexOf('const commandOutput = new Map<string, string>();', commandOutputInitialization + 1))
            .toBe(-1);
    });
});
