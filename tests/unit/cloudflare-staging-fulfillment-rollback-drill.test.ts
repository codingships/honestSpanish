import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
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
        const disable = runnerSource.indexOf("executeScheduleWrite('disable_cron'");
        const normalize = runnerSource.indexOf("executeQueueDeliveryWrite('normalize_queue_active'");
        const pause = runnerSource.indexOf("executeQueueDeliveryWrite('pause_queue'");
        const rollback = runnerSource.indexOf("executeWranglerWrite(\n                'rollback_previous'", pause);
        const finallyBlock = runnerSource.indexOf('} finally {', rollback);
        const restore = runnerSource.indexOf("executeWranglerWrite(\n                    'restore_current'", finallyBlock);
        const restoreVerification = runnerSource.indexOf("'after_restore_current'", finallyBlock);
        const restoreCron = runnerSource.indexOf("executeScheduleWrite('restore_cron'", finallyBlock);
        const resume = runnerSource.indexOf("executeQueueDeliveryWrite('resume_queue'", finallyBlock);

        expect(initial).toBeGreaterThan(-1);
        expect(initial).toBeLessThan(approval);
        expect(approval).toBeLessThan(second);
        expect(second).toBeLessThan(disable);
        expect(disable).toBeLessThan(normalize);
        expect(normalize).toBeLessThan(pause);
        expect(pause).toBeLessThan(rollback);
        expect(rollback).toBeLessThan(finallyBlock);
        expect(finallyBlock).toBeLessThan(restore);
        expect(restore).toBeLessThan(restoreVerification);
        expect(restoreVerification).toBeLessThan(restoreCron);
        expect(restoreCron).toBeLessThan(resume);
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
