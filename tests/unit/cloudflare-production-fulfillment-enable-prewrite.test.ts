import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
    PRODUCTION_FULFILLMENT_ENABLE_APPROVAL_SENTENCE,
    buildProductionEnablePrewriteEvidence,
    createProductionEnablePendingCheckpoint,
    markProductionEnableCheckpointAmbiguous,
    markProductionEnableCheckpointCompensated,
    markProductionEnableCheckpointCompensationStarted,
    markProductionEnableCheckpointProven,
    productionEnableStartupAction,
    productionFulfillmentEnableApprovalSha256,
    runGuardedEnableMutation,
    validateProductionEnableCheckpoint,
    validateProductionEnablePrewriteEvidence,
    type ProductionEnableCheckpoint,
    type ProductionEnablePrewriteEvidence,
} from '../../scripts/launch/cloudflare-production-fulfillment-lifecycle-shared';
import { PRODUCTION_QUEUE_TARGET } from '../../scripts/launch/cloudflare-production-queue-shared';
import type { StripeLiveReadiness } from '../../scripts/launch/stripe-live-readiness';

const runnerSource = readFileSync('scripts/launch/cloudflare-production-fulfillment-lifecycle.ts', 'utf8');
const stateSource = readFileSync('scripts/launch/cloudflare-production-fulfillment-enable-state.ts', 'utf8');
const now = new Date('2026-07-13T10:00:00.000Z');
const stripeAccountId = 'acct_1234567890';
const stripePortalConfigurationId = 'bpc_1234567890';

describe('Cloudflare production fulfillment enable prewrite gate', () => {
    it('runs fresh Queue and Stripe reads, strict evidence and attestations before the active deploy', () => {
        const start = runnerSource.indexOf('async function executeEnable()');
        const end = runnerSource.indexOf('function validatePackageScripts()', start);
        const source = runnerSource.slice(start, end);
        const dryRun = source.indexOf("deployCommand('fulfillment-active-dry-run', 'production', true)");
        const queueRead = source.indexOf('readFreshProductionQueueReadiness()');
        const stripeRead = source.indexOf('await readFreshStripeLiveReadiness()');
        const freshVersions = source.indexOf("deploymentsCommand('fulfillment-bootstrap-version-immediately-before-enable')");
        const webAttestation = source.indexOf('await webRuntimeAttestation(freshWebVersion)');
        const evidence = source.indexOf('buildProductionEnablePrewriteEvidence({');
        const writeIntent = source.indexOf('externalWriteAttempted = true;');
        const activeDeploy = source.indexOf("deployCommand('fulfillment-active-deploy', 'production', false)");

        expect(start).toBeGreaterThan(-1);
        expect(dryRun).toBeLessThan(queueRead);
        expect(queueRead).toBeLessThan(stripeRead);
        expect(stripeRead).toBeLessThan(freshVersions);
        expect(freshVersions).toBeLessThan(webAttestation);
        expect(webAttestation).toBeLessThan(evidence);
        expect(evidence).toBeLessThan(writeIntent);
        expect(writeIntent).toBeLessThan(activeDeploy);
        expect(runnerSource).toContain("['queues', 'list', '--page', String(page)]");
        expect(runnerSource).toContain("['queues', 'info', PRODUCTION_QUEUE_TARGET.queue]");
        expect(runnerSource).toContain("['queues', 'info', PRODUCTION_QUEUE_TARGET.deadLetterQueue]");
        expect(runnerSource).toContain('inspectStripeLiveReadiness(');
        expect(runnerSource).not.toContain('validateWebSecretsEvidence');
        expect(runnerSource).not.toContain("latestGeneratedPath('launch-cloudflare-production-worker-secrets'");
    });

    it('builds a strict, secret-free, approval-bound evidence object', () => {
        const evidence = validEvidence();

        expect(evidence).toMatchObject({
            schemaVersion: 1,
            kind: 'cloudflare-production-fulfillment-enable-prewrite',
            externalWriteAttemptedBeforeEvidence: false,
            approval: { sentenceSha256: productionFulfillmentEnableApprovalSha256() },
            target: {
                accountId: PRODUCTION_QUEUE_TARGET.accountId,
                queue: PRODUCTION_QUEUE_TARGET.queue,
                deadLetterQueue: PRODUCTION_QUEUE_TARGET.deadLetterQueue,
                stripeAccountId,
                stripePortalConfigurationId,
            },
            queue: {
                queueCount: 1,
                deadLetterQueueCount: 1,
                queueInfoVerified: true,
                deadLetterQueueInfoVerified: true,
            },
            stripe: { ok: true, failureCount: 0 },
        });
        expect(JSON.stringify(evidence)).not.toContain('sk_live_');
        expect(JSON.stringify(evidence)).not.toContain('CLOUDFLARE_API_TOKEN');
        expect(validateProductionEnablePrewriteEvidence(evidence, {
            now,
            stripeAccountId,
            stripePortalConfigurationId,
        })).toEqual({ ok: true, errors: [] });
    });

    it('fails closed on stale, replayed or adversarial Queue/Stripe/version evidence', () => {
        const mutations: Array<(value: ProductionEnablePrewriteEvidence) => void> = [
            (value) => { value.generatedAt = '2026-07-13T09:50:00.000Z'; },
            (value) => { value.queue.observedAt = '2026-07-13T09:50:00.000Z'; },
            (value) => { value.stripe.observedAt = '2026-07-13T09:50:00.000Z'; },
            (value) => { value.externalWriteAttemptedBeforeEvidence = true as false; },
            (value) => { value.approval.sentenceSha256 = '0'.repeat(64); },
            (value) => { value.target.queue = 'wrong-queue' as typeof value.target.queue; },
            (value) => { value.queue.queueCount = 2 as 1; },
            (value) => { value.queue.deadLetterQueueInfoVerified = false as true; },
            (value) => { value.stripe.facts.accountReady = false; },
            (value) => { value.stripe.facts.country = 'US'; },
            (value) => { value.stripe.facts.enabledWebhookCount = 2; },
            (value) => { value.immediatelyPrecedingVersions.web = 'not-a-version'; },
        ];

        for (const mutate of mutations) {
            const evidence = structuredClone(validEvidence());
            mutate(evidence);
            expect(validateProductionEnablePrewriteEvidence(evidence, {
                now,
                stripeAccountId,
                stripePortalConfigurationId,
            }).ok).toBe(false);
        }
    });

    it('binds the exact approval to fresh read-only Queue and Stripe gates', () => {
        expect(PRODUCTION_FULFILLMENT_ENABLE_APPROVAL_SENTENCE).toContain(PRODUCTION_QUEUE_TARGET.queue);
        expect(PRODUCTION_FULFILLMENT_ENABLE_APPROVAL_SENTENCE).toContain(PRODUCTION_QUEUE_TARGET.deadLetterQueue);
        expect(PRODUCTION_FULFILLMENT_ENABLE_APPROVAL_SENTENCE).toContain('Stripe Live');
        expect(PRODUCTION_FULFILLMENT_ENABLE_APPROVAL_SENTENCE).toContain('sin escribir Stripe');
        expect(PRODUCTION_FULFILLMENT_ENABLE_APPROVAL_SENTENCE).toContain('sin crear, borrar, pausar ni modificar Queues');
    });

    it('refuses to build evidence from a failed Stripe readiness mock', () => {
        expect(() => buildProductionEnablePrewriteEvidence({
            generatedAt: now.toISOString(),
            queue: validQueue(),
            stripe: {
                observedAt: now.toISOString(),
                readiness: { ...validStripe(), ok: false, failures: ['stripe_webhook_not_exact'] },
            },
            stripeAccountId,
            stripePortalConfigurationId,
            fulfillmentBootstrapVersion: '11111111-1111-4111-8111-111111111111',
            webVersion: '22222222-2222-4222-8222-222222222222',
        })).toThrow('Stripe Live readiness must be successful');
    });

    it('captures enable approval only from the initial process environment before dotenv', () => {
        const approvalCapture = runnerSource.indexOf('const initialApprovalValue = process.env[approvalEnvVar]?.trim()');
        const dotenvLoad = runnerSource.indexOf('dotenv.config({');
        const approvalValidation = runnerSource.indexOf('initialApprovalValue === exactApprovalSentence');

        expect(approvalCapture).toBeGreaterThan(-1);
        expect(approvalCapture).toBeLessThan(dotenvLoad);
        expect(dotenvLoad).toBeLessThan(approvalValidation);
        expect(runnerSource).toContain('approvalSource=initial_process_environment_only');
        expect(runnerSource).not.toContain('process.env[approvalEnvVar]?.trim() === exactApprovalSentence');
    });

    it('uses strict structured Cloudflare identity verification before checkpoint reconciliation', () => {
        const identityGate = runnerSource.indexOf('verifyCloudflareWhoamiOutput(whoami.stdout, target.accountId)');
        const reconciliation = runnerSource.indexOf('reconcileEnableCheckpointAtStartup()');

        expect(identityGate).toBeGreaterThan(-1);
        expect(identityGate).toBeLessThan(reconciliation);
        expect(runnerSource).not.toContain('captureText(whoami).includes(target.accountId)');
    });

    it('blocks bootstrap before writes on unknown Worker or non-inert Queue state', () => {
        const verifyStart = runnerSource.indexOf('async function verifyExistingFulfillmentBootstrapBeforeDeploy()');
        const verifyEnd = runnerSource.indexOf('function exactBootstrapSecretInventory', verifyStart);
        const verifySource = runnerSource.slice(verifyStart, verifyEnd);
        const bootstrapStart = runnerSource.indexOf('async function executeBootstrap()');
        const bootstrapEnd = runnerSource.indexOf('async function verifyExistingFulfillmentBootstrapBeforeDeploy()', bootstrapStart);
        const bootstrapSource = runnerSource.slice(bootstrapStart, bootstrapEnd);

        expect(verifySource).toContain('classifyExistingCloudflareWorkerState(');
        expect(verifySource).toContain("existingWorkerState === 'unknown'");
        expect(verifySource).toContain("await productionQueueRuntimeProbe('bootstrap')");
        expect(verifySource).toContain('externalWriteAttempted=false');
        const dryRunIndex = bootstrapSource.indexOf("deployCommand('fulfillment-bootstrap-dry-run'");
        const taggedDeployIndex = bootstrapSource.indexOf('const deploy = runCommand(deployCommand(');
        const taggedDeploySource = bootstrapSource.slice(taggedDeployIndex, taggedDeployIndex + 240);
        expect(bootstrapSource.indexOf('await verifyExistingFulfillmentBootstrapBeforeDeploy()'))
            .toBeLessThan(dryRunIndex);
        expect(dryRunIndex).toBeLessThan(taggedDeployIndex);
        expect(taggedDeploySource).toContain("'fulfillment-bootstrap-deploy'");
        expect(taggedDeploySource).toContain('deployTag');
    });

    it('proves exact Queue binding, producer, consumer, DLQ, pause and backlog state after enable and compensation', () => {
        const enableStart = runnerSource.indexOf('async function executeEnable()');
        const enableEnd = runnerSource.indexOf('async function reconcileEnableCheckpointAtStartup()', enableStart);
        const enableSource = runnerSource.slice(enableStart, enableEnd);
        const compensationStart = runnerSource.indexOf('async function compensateToBootstrap');
        const compensationEnd = runnerSource.indexOf('function command(', compensationStart);
        const compensationSource = runnerSource.slice(compensationStart, compensationEnd);

        expect(enableSource).toContain("queueVersionBindingProbe(freshFulfillmentVersion, 'bootstrap', 'immediately-before-enable')");
        expect(enableSource).toContain("queueVersionBindingProbe(afterVersionId, 'active', 'after-enable')");
        expect(enableSource).toContain("await productionQueueRuntimeProbe('active')");
        expect(compensationSource).toContain("queueVersionBindingProbe(versionId, 'bootstrap', 'after-compensation')");
        expect(compensationSource).toContain("await productionQueueRuntimeProbe('bootstrap')");
        for (const contract of [
            'deliveryPaused=false',
            "attachments=${expectedMode === 'active' ? 'producer=1,consumer=1' : 'producer=0,consumer=0'}",
            'backlog=0',
        ]) expect(runnerSource).toContain(contract);
    });

    it('persists an atomic durable pending checkpoint before the first active deploy', () => {
        const enableStart = runnerSource.indexOf('async function executeEnable()');
        const enableEnd = runnerSource.indexOf('async function reconcileEnableCheckpointAtStartup()', enableStart);
        const source = runnerSource.slice(enableStart, enableEnd);
        const checkpoint = source.indexOf('persistEnableCheckpoint(pendingCheckpoint, enableCheckpoint)');
        const writeIntent = source.indexOf('externalWriteAttempted = true');
        const activeDeploy = source.indexOf("deployCommand('fulfillment-active-deploy', 'production', false)");

        expect(checkpoint).toBeGreaterThan(-1);
        expect(checkpoint).toBeLessThan(writeIntent);
        expect(writeIntent).toBeLessThan(activeDeploy);
        expect(runnerSource).toContain("'launch-cloudflare-production-fulfillment-enable',\n    'checkpoint.json'");
        expect(stateSource).toContain("flag: 'wx'");
        expect(stateSource).toContain('flush: true');
        expect(stateSource).toContain('assertCheckpointMatches(input.checkpointPath, input.expected)');
        expect(stateSource).toContain('renameSync(temporaryPath, input.checkpointPath)');
        expect(runnerSource).toContain("externalWritePerformed = 'unknown'");
    });

    it('acquires the canonical owner lock before every startup reconciliation or enable', () => {
        const acquire = runnerSource.indexOf('acquireProductionEnableLock({');
        const reconciliation = runnerSource.indexOf('reconcileEnableCheckpointAtStartup()');
        const enable = runnerSource.indexOf('await executeEnable()');

        expect(acquire).toBeGreaterThan(-1);
        expect(acquire).toBeLessThan(reconciliation);
        expect(reconciliation).toBeLessThan(enable);
        expect(runnerSource).toContain("assertEnableMutationOwnership('active deploy')");
        expect(runnerSource).toContain("assertEnableMutationOwnership('compensating bootstrap rollback')");
        expect(runnerSource).toContain('releaseProductionEnableLock(enableLockPath, enableLockOwnerId)');
    });

    it('never accepts active as proven after compensation has started', () => {
        const compensationStarted = markProductionEnableCheckpointCompensationStarted(
            validPendingCheckpoint(),
            '2026-07-13T10:00:01.000Z',
        );

        expect(productionEnableStartupAction(compensationStarted)).toBe('compensate_only');
        expect(() => markProductionEnableCheckpointProven(
            compensationStarted,
            '33333333-3333-4333-8333-333333333333',
            '2026-07-13T10:00:02.000Z',
        )).toThrow('cannot transition to proven active');
        expect(runnerSource).toContain("startupAction === 'compensate_only'");
        expect(runnerSource).toContain('startup skips every active-proven path');
    });

    it('freshly revalidates an exact proven version, health, HMAC and Cron before reporting success', () => {
        const start = runnerSource.indexOf("startupAction === 'verify_proven_active'");
        const end = runnerSource.indexOf("startupAction === 'compensate_only'", start);
        const source = runnerSource.slice(start, end);

        expect(start).toBeGreaterThan(-1);
        expect(source).toContain("deploymentsCommand('fulfillment-proven-version-fresh-readback')");
        expect(source).toContain('versionId === checkpoint.activeVersionId');
        expect(source).toContain("healthProbe(directUrl, 'active')");
        expect(source).toContain("runtimeAttestation(directUrl, checkpoint.activeVersionId!, 'active')");
        expect(source).toContain("cronScheduleProbe('active')");
        expect(source).toContain("'PROVEN_REMOTE_READBACK_DIVERGED'");
        expect(source.indexOf('persistEnableCheckpoint(ambiguous, checkpoint)')).toBeLessThan(
            source.indexOf('proven_checkpoint_remote_divergence'),
        );
    });

    it('validates every checkpoint lifecycle state and rejects adversarial claims', () => {
        const pending = validPendingCheckpoint();
        const compensationStarted = markProductionEnableCheckpointCompensationStarted(
            pending,
            '2026-07-13T10:00:01.000Z',
        );
        const proven = markProductionEnableCheckpointProven(
            pending,
            '33333333-3333-4333-8333-333333333333',
            '2026-07-13T10:00:02.000Z',
        );
        const compensated = markProductionEnableCheckpointCompensated(
            compensationStarted,
            '44444444-4444-4444-8444-444444444444',
            '2026-07-13T10:00:03.000Z',
        );
        const ambiguous = markProductionEnableCheckpointAmbiguous(
            compensationStarted,
            'COMPENSATION_NOT_PROVEN',
            '2026-07-13T10:00:04.000Z',
        );

        for (const checkpoint of [pending, compensationStarted, proven, compensated, ambiguous]) {
            expect(validateProductionEnableCheckpoint(checkpoint)).toEqual({ ok: true, errors: [] });
        }

        const mutations: Array<(value: ProductionEnableCheckpoint) => void> = [
            (value) => { value.status = 'proven'; },
            (value) => { value.activeDeployAttempted = false as true; },
            (value) => { value.approvalSentenceSha256 = '0'.repeat(64); },
            (value) => { value.prewriteEvidenceSha256 = 'not-a-sha'; },
            (value) => { value.targetAccountId = 'wrong-account' as typeof value.targetAccountId; },
            (value) => { value.activeVersionId = 'not-a-version'; },
        ];
        for (const mutate of mutations) {
            const checkpoint = structuredClone(pending);
            mutate(checkpoint);
            expect(validateProductionEnableCheckpoint(checkpoint).ok).toBe(false);
        }
    });

    it('marks a fully verified active mutation proven without compensating', async () => {
        const calls: string[] = [];
        const driver = mutationDriver(calls, {
            deployAndVerifyActive: async () => 'active-proof',
        });

        await expect(runGuardedEnableMutation(driver)).resolves.toEqual({
            status: 'proven',
            proof: 'active-proof',
        });
        expect(calls).toEqual(['pending', 'active', 'proven']);
        expect(driver.compensateAndVerify).not.toHaveBeenCalled();
    });

    it('compensates a crash after active spawn but before capture returns', async () => {
        const calls: string[] = [];
        const driver = mutationDriver(calls, {
            deployAndVerifyActive: async () => {
                throw new Error('spawn returned no capture');
            },
            compensateAndVerify: async () => 'bootstrap-proof',
        });

        await expect(runGuardedEnableMutation(driver)).resolves.toEqual({
            status: 'compensated',
            proof: 'bootstrap-proof',
        });
        expect(calls).toEqual(['pending', 'active', 'compensate', 'compensated']);
    });

    it('compensates when postdeploy proof fails and marks failed compensation ambiguous', async () => {
        const compensatedCalls: string[] = [];
        const compensatedDriver = mutationDriver(compensatedCalls, {
            deployAndVerifyActive: async () => null,
            compensateAndVerify: async () => 'bootstrap-proof',
        });
        await expect(runGuardedEnableMutation(compensatedDriver)).resolves.toEqual({
            status: 'compensated',
            proof: 'bootstrap-proof',
        });
        expect(compensatedCalls).toEqual(['pending', 'active', 'compensate', 'compensated']);

        const ambiguousCalls: string[] = [];
        const ambiguousDriver = mutationDriver(ambiguousCalls, {
            deployAndVerifyActive: async () => null,
            compensateAndVerify: async () => {
                throw new Error('rollback timed out');
            },
        });
        const ambiguous = await runGuardedEnableMutation(ambiguousDriver);
        expect(ambiguous.status).toBe('ambiguous');
        expect(ambiguousCalls).toEqual(['pending', 'active', 'compensate', 'ambiguous']);
        expect(ambiguousDriver.markAmbiguous).toHaveBeenCalledWith(
            expect.stringContaining('ROLLBACK_TIMED_OUT'),
        );
    });

    it('compensates when the active proven transition cannot be persisted', async () => {
        const calls: string[] = [];
        const driver = mutationDriver(calls, {
            deployAndVerifyActive: async () => 'active-proof',
            compensateAndVerify: async () => 'bootstrap-proof',
        });
        driver.markProven.mockImplementationOnce(async () => {
            calls.push('proven');
            throw new Error('proven checkpoint write failed');
        });

        await expect(runGuardedEnableMutation(driver)).resolves.toEqual({
            status: 'compensated',
            proof: 'bootstrap-proof',
        });
        expect(calls).toEqual(['pending', 'active', 'proven', 'compensate', 'compensated']);
    });

    it('does not start active or compensation when durable pending persistence fails', async () => {
        const calls: string[] = [];
        const driver = mutationDriver(calls, {
            persistPending: () => {
                throw new Error('checkpoint unavailable');
            },
        });

        await expect(runGuardedEnableMutation(driver)).rejects.toThrow('checkpoint unavailable');
        expect(calls).toEqual(['pending']);
        expect(driver.deployAndVerifyActive).not.toHaveBeenCalled();
        expect(driver.compensateAndVerify).not.toHaveBeenCalled();
    });
});

function validEvidence(): ProductionEnablePrewriteEvidence {
    return buildProductionEnablePrewriteEvidence({
        generatedAt: now.toISOString(),
        queue: validQueue(),
        stripe: { observedAt: now.toISOString(), readiness: validStripe() },
        stripeAccountId,
        stripePortalConfigurationId,
        fulfillmentBootstrapVersion: '11111111-1111-4111-8111-111111111111',
        webVersion: '22222222-2222-4222-8222-222222222222',
    });
}

function validQueue() {
    return {
        observedAt: now.toISOString(),
        pagesRead: 2,
        queueCount: 1,
        deadLetterQueueCount: 1,
        queueInfoVerified: true,
        deadLetterQueueInfoVerified: true,
    } as const;
}

function validStripe(): StripeLiveReadiness {
    return {
        ok: true,
        failures: [],
        facts: {
            accountMatched: true,
            accountReady: true,
            country: 'ES',
            currency: 'eur',
            enabledWebhookCount: 1,
            portalMatched: true,
            webhookMatched: true,
        },
    };
}

function validPendingCheckpoint(): ProductionEnableCheckpoint {
    return createProductionEnablePendingCheckpoint({
        attemptId: '55555555-5555-4555-8555-555555555555',
        now: now.toISOString(),
        prewriteEvidenceSha256: 'a'.repeat(64),
    });
}

function mutationDriver(
    calls: string[],
    overrides: Partial<{
        persistPending(): Promise<void> | void;
        deployAndVerifyActive(): Promise<string | null>;
        compensateAndVerify(): Promise<string | null>;
    }> = {},
) {
    return {
        persistPending: vi.fn(() => {
            calls.push('pending');
            return overrides.persistPending?.();
        }),
        deployAndVerifyActive: vi.fn(async () => {
            calls.push('active');
            return overrides.deployAndVerifyActive?.() ?? null;
        }),
        markProven: vi.fn(async () => {
            calls.push('proven');
        }),
        compensateAndVerify: vi.fn(async () => {
            calls.push('compensate');
            return overrides.compensateAndVerify?.() ?? null;
        }),
        markCompensated: vi.fn(async () => {
            calls.push('compensated');
        }),
        markAmbiguous: vi.fn(async () => {
            calls.push('ambiguous');
        }),
    };
}
