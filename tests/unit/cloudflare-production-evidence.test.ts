import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
    CLOUDFLARE_PRODUCTION_SOURCE_IDENTITY_PATHS,
    CLOUDFLARE_PRODUCTION_SOURCE_IDENTITY_EXCLUDED_UNTRACKED_PATHS,
    captureCloudflareProductionSourceIdentity,
    computeCloudflareProductionSourceSha256,
    validateCloudflareRuntimeCutoverPreflightSummary,
    validateCloudflareRuntimeReadonlyInertAttestation,
    validateCloudflareRuntimeReadonlySummary,
    type CloudflareProductionSourceIdentity,
} from '../../scripts/launch/cloudflare-production-evidence';
import { productionBootstrapVersionBindingTypes } from '../../scripts/launch/cloudflare-production-worker-safety';

const now = new Date('2026-07-14T19:00:00.000Z');
const target = {
    accountId: 'd1a22bcf6477ff2ff31d2bfb83084e44',
    productionWorker: 'espanolhonesto',
    pagesProject: 'espanolhonesto',
    customDomains: ['espanolhonesto.com', 'www.espanolhonesto.com'],
} as const;
const currentSourceIdentity = cleanCurrentSourceIdentity();
const inertExpectation = {
    observedAfter: '2026-07-14T18:50:00.000Z',
    webWorker: 'espanolhonesto',
    webVersionId: '11111111-1111-4111-8111-111111111111',
    fulfillmentWorker: 'espanol-honesto-fulfillment-production',
    fulfillmentVersionId: '22222222-2222-4222-8222-222222222222',
    productionQueue: 'espanol-honesto-fulfillment-production-queue',
    productionQueueId: 'f00c0885eadb475cb9b513a4a7a8fcff',
    productionDeadLetterQueue: 'espanol-honesto-fulfillment-production-dlq',
    productionDeadLetterQueueId: 'e59a210ecfe243ddba945accee9f4b5a',
} as const;

function check(name: string, status: 'ok' | 'warning' | 'failed' = 'ok', message = 'proven') {
    return { name, status, message, details: [] };
}

function runtimeSummary(): Record<string, unknown> {
    return {
        schemaVersion: 2,
        startedAt: '2026-07-14T18:54:30.000Z',
        endedAt: '2026-07-14T18:55:00.000Z',
        status: 'WARNING',
        target: {
            ...target,
            stagingWorker: 'espanolhonesto-staging',
            productionFulfillmentWorker: 'espanol-honesto-fulfillment-production',
            productionQueue: 'espanol-honesto-fulfillment-production-queue',
            productionDeadLetterQueue: 'espanol-honesto-fulfillment-production-dlq',
        },
        safety: {
            readOnly: true,
            noExternalWrites: true,
            noSecretValuesStored: true,
            noWorkerCodeDownloaded: true,
            rawVersionBindingValuesStored: false,
        },
        checks: [
            check('readonly_command_scope'),
            check('cloudflare_api_get_scope'),
            check('cloudflare_account_auth'),
            check('pages_project_current_domain_owner'),
            check('legacy_reminder_worker_neutralized'),
            check('duplicate_staging_worker_posture'),
            check('evidence_source_identity'),
            check('local_wrangler_config_fail_closed'),
            check('generated_output_secret_posture'),
            check('production_web_current_traffic', 'warning', 'Expected-not-ready: Worker absent.'),
        ],
        probes: [{
            id: 'pages_projects',
            status: 'ok',
            summary: {
                projectFound: true,
                requiredDomainsPresent: true,
                domainNames: [...target.customDomains, 'espanolhonesto.pages.dev'],
            },
        }],
        sourceIdentity: {
            ...cloneSourceIdentity(currentSourceIdentity),
        },
        apiInventory: {
            oauthKeyringAttested: true,
            workerScripts: {
                state: 'ready',
                flagged: [
                    { name: 'espanol-honesto-reminders', present: false },
                    { name: 'espanolhonesto-staging-staging', present: false },
                ],
                legacyHeadDeployment: {
                    state: 'ready',
                    trackedLegacyPackagePaths: [],
                    workingTreePackagePresent: false,
                    automaticDeployReferences: [],
                    gaps: [],
                },
            },
            calls: [
                { id: 'worker_scripts_list', method: 'GET', success: true, outcome: 'ok' },
                { id: 'queues', outcome: 'expected-not-ready' },
            ],
        },
    };
}

function inertRuntimeSummary(): Record<string, unknown> {
    const report = runtimeSummary();
    report.checks = [
        ...((report.checks as Array<Record<string, unknown>>)
            .filter((entry) => entry.name !== 'production_web_current_traffic')),
        check('production_web_current_traffic'),
        check('production_fulfillment_current_traffic'),
        check('production_worker_secret_names'),
        check('production_fulfillment_secret_names'),
        check('production_web_inert_bindings'),
        check('production_fulfillment_inert_bindings'),
        check('production_fulfillment_schedules'),
        check('production_queue_and_dlq_inventory'),
    ];
    report.probes = [
        ...(report.probes as Array<Record<string, unknown>>),
        currentDeploymentProbe('production_worker_status', inertExpectation.webVersionId),
        currentDeploymentProbe('production_fulfillment_status', inertExpectation.fulfillmentVersionId),
        secretProbe('production_worker_secrets'),
        secretProbe('production_fulfillment_secrets'),
        inertVersionProbe('production_worker_current_version', 'web'),
        inertVersionProbe('production_fulfillment_current_version', 'fulfillment'),
    ];
    const apiInventory = report.apiInventory as Record<string, unknown>;
    apiInventory.fulfillmentSchedules = { state: 'ready', crons: [], gaps: [] };
    apiInventory.queue = inertQueue(
        inertExpectation.productionQueue,
        inertExpectation.productionQueueId,
    );
    apiInventory.deadLetterQueue = inertQueue(
        inertExpectation.productionDeadLetterQueue,
        inertExpectation.productionDeadLetterQueueId,
    );
    apiInventory.gaps = [];
    return report;
}

function currentDeploymentProbe(id: string, versionId: string): Record<string, unknown> {
    return {
        id,
        status: 'ok',
        exitCode: 0,
        summary: {
            state: 'ready',
            primaryVersionId: versionId,
            currentVersions: [{ versionId, percentage: 100 }],
            notFound: false,
            errorPreview: null,
        },
    };
}

function secretProbe(id: string): Record<string, unknown> {
    return {
        id,
        status: 'ok',
        exitCode: 0,
        summary: {
            count: 1,
            names: ['INTERNAL_JOB_SECRET'],
            notFound: false,
            errorPreview: null,
        },
    };
}

function inertVersionProbe(id: string, kind: 'web' | 'fulfillment'): Record<string, unknown> {
    const web = kind === 'web';
    const bindingTypes = productionBootstrapVersionBindingTypes[kind];
    const bindingNames = Object.keys(bindingTypes);
    return {
        id,
        status: 'ok',
        exitCode: 0,
        summary: {
            state: 'ready',
            versionId: web ? inertExpectation.webVersionId : inertExpectation.fulfillmentVersionId,
            bindingNames,
            bindings: bindingNames.map((name) => ({ name, type: bindingTypes[name as keyof typeof bindingTypes] })),
            safeValues: web ? {
                CHECKOUT_ENABLED: 'false',
                CHECKOUT_ENABLED_OVERRIDE: 'false',
                EMAIL_DAILY_RECIPIENT_LIMIT: '0',
                EMAIL_DELIVERY_MODE: 'disabled',
                EMAIL_MONTHLY_RECIPIENT_LIMIT: '0',
                NODE_ENV: 'production',
                PUBLIC_APP_ENV: 'production',
                SENTRY_ENVIRONMENT: 'production-bootstrap',
                WEB_RUNTIME_MODE: 'bootstrap',
                WORKER_IDENTITY: inertExpectation.webWorker,
            } : {
                CHECKOUT_ENABLED: 'false',
                CHECKOUT_ENABLED_OVERRIDE: 'false',
                EMAIL_DAILY_RECIPIENT_LIMIT: '0',
                EMAIL_DELIVERY_MODE: 'disabled',
                EMAIL_MONTHLY_RECIPIENT_LIMIT: '0',
                FULFILLMENT_RUNTIME_MODE: 'bootstrap',
                NODE_ENV: 'production',
                PUBLIC_APP_ENV: 'production',
                WORKER_IDENTITY: inertExpectation.fulfillmentWorker,
            },
            safeTargets: web ? { FULFILLMENT_SERVICE: inertExpectation.fulfillmentWorker } : {},
            notFound: false,
            errorPreview: null,
            rawBindingValuesStored: false,
        },
    };
}

function inertQueue(name: string, id: string): Record<string, unknown> {
    return {
        name,
        id,
        state: 'ready',
        settings: {
            delivery_paused: false,
            delivery_delay: 0,
            message_retention_period: 86_400,
        },
        producers: [],
        consumers: [],
        backlog: 0,
        backlogAvailable: true,
        gaps: [],
    };
}

function neutralizedWorker(name: string): Record<string, unknown> {
    return {
        name,
        present: true,
        scheduleState: 'ready',
        crons: [],
        subdomainState: 'ready',
        workersDevEnabled: false,
        previewsEnabled: false,
        invocationSurfaces: {
            state: 'ready',
            customDomains: 0,
            workerRoutes: 0,
            queueConsumers: 0,
            inboundServiceBindings: 0,
            inboundTailConsumerReferences: 0,
            emailRoutingReferences: 0,
        },
        gaps: [],
    };
}

function cutoverPreflightSummary(): Record<string, unknown> {
    return {
        schemaVersion: 1,
        generatedAt: '2026-07-14T18:55:00.000Z',
        status: 'WARNING',
        remoteWritePerformed: false,
        targetAccountId: target.accountId,
        targetWorker: target.productionWorker,
        checkoutEnabledFalseInConfig: true,
        dryRunAfterBuildLooksSuccessful: true,
        dryRunMentionsCheckoutFalse: true,
        dryRunMentionsNoCustomDomains: true,
        sourceIdentity: cloneSourceIdentity(currentSourceIdentity),
        checks: [
            check('command_scope_no_external_write'),
            check('cloudflare_account_auth'),
            check('checkout_disabled_config'),
            check('safe_base_worker_name'),
            check('local_build_passed'),
            check('wrangler_production_dry_run_passed'),
            check('dry_run_checkout_disabled'),
            check('dry_run_no_custom_domain_attachment'),
            check('evidence_source_identity'),
            check('production_variable_matrix_complete'),
            check('generated_output_secret_posture'),
            check('production_secret_list_shape_expected', 'warning', 'Expected-not-ready: Worker absent.'),
        ],
        captures: [
            { name: 'wrangler-whoami', status: 'ok' },
            { name: 'wrangler-secret-list-production', status: 'warning' },
        ],
    };
}

describe('structured Cloudflare production evidence gates', () => {
    it('accepts fresh structured runtime evidence with exact Pages domain facts and expected-not-ready warnings', () => {
        expect(validateRuntime(runtimeSummary())).toEqual({
            valid: true,
            errors: [],
            evidenceTimestamp: '2026-07-14T18:55:00.000Z',
        });
    });

    it('binds a fresh GET-only inert readback to the exact immutable HMAC versions', () => {
        expect(validateCloudflareRuntimeReadonlyInertAttestation(
            inertRuntimeSummary(),
            target,
            inertExpectation,
            now,
            currentSourceIdentity,
        )).toEqual({
            valid: true,
            errors: [],
            evidenceTimestamp: '2026-07-14T18:55:00.000Z',
        });
    });

    it.each([
        '2026-07-14T18:49:59.999Z',
        '2026-07-14T18:50:00.000Z',
    ])('rejects a readback that did not start strictly after its immutable HMAC receipt (%s)', (startedAt) => {
        const report = inertRuntimeSummary();
        report.startedAt = startedAt;

        const result = validateCloudflareRuntimeReadonlyInertAttestation(
            report,
            target,
            inertExpectation,
            now,
            currentSourceIdentity,
        );

        expect(result.valid).toBe(false);
        expect(result.errors).toContain(
            'runtime readback did not start after the immutable HMAC composite',
        );
    });

    it.each([
        ['web version drift', (report: Record<string, unknown>) => {
            const probe = (report.probes as Array<Record<string, unknown>>)
                .find((entry) => entry.id === 'production_worker_status');
            (probe?.summary as Record<string, unknown>).primaryVersionId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
        }, 'production web primary version mismatch'],
        ['secret expansion', (report: Record<string, unknown>) => {
            const probe = (report.probes as Array<Record<string, unknown>>)
                .find((entry) => entry.id === 'production_worker_secrets');
            const summary = probe?.summary as Record<string, unknown>;
            summary.count = 2;
            summary.names = ['INTERNAL_JOB_SECRET', 'STRIPE_SECRET_KEY'];
        }, 'production web secrets must be exactly INTERNAL_JOB_SECRET'],
        ['split traffic', (report: Record<string, unknown>) => {
            const probe = (report.probes as Array<Record<string, unknown>>)
                .find((entry) => entry.id === 'production_fulfillment_status');
            const summary = probe?.summary as Record<string, unknown>;
            summary.currentVersions = [{ versionId: inertExpectation.fulfillmentVersionId, percentage: 50 }];
        }, 'production fulfillment traffic must be exactly 100% on the immutable HMAC version'],
        ['binding type drift', (report: Record<string, unknown>) => {
            const probe = (report.probes as Array<Record<string, unknown>>)
                .find((entry) => entry.id === 'production_worker_current_version');
            const summary = probe?.summary as Record<string, unknown>;
            const binding = (summary.bindings as Array<Record<string, unknown>>)
                .find((entry) => entry.name === 'FULFILLMENT_SERVICE');
            if (binding) binding.type = 'queue';
        }, 'production web binding FULFILLMENT_SERVICE must have type service'],
        ['queue attachment', (report: Record<string, unknown>) => {
            const inventory = report.apiInventory as Record<string, unknown>;
            (inventory.queue as Record<string, unknown>).consumers = [{ worker: 'unexpected' }];
        }, 'production Queue must have zero producers and zero consumers'],
        ['queue backlog', (report: Record<string, unknown>) => {
            const inventory = report.apiInventory as Record<string, unknown>;
            (inventory.deadLetterQueue as Record<string, unknown>).backlog = 1;
        }, 'production DLQ backlog must be proven as zero'],
    ])('rejects an inert runtime readback with %s', (_label, mutate, expectedError) => {
        const report = inertRuntimeSummary();
        mutate(report);

        const result = validateCloudflareRuntimeReadonlyInertAttestation(
            report,
            target,
            inertExpectation,
            now,
            currentSourceIdentity,
        );

        expect(result.valid).toBe(false);
        expect(result.errors).toContain(expectedError);
    });

    it('rejects stale, failed, ambiguous, duplicate and unhashed runtime evidence', () => {
        const report = runtimeSummary();
        report.endedAt = '2026-07-14T17:00:00.000Z';
        report.status = 'FAILED';
        const checks = report.checks as Array<Record<string, unknown>>;
        checks.push(check('cloudflare_account_auth'));
        checks.push(check('production_queue_and_dlq_inventory', 'warning', 'Permission gap prevented Queue proof.'));
        (report.sourceIdentity as Record<string, unknown>).unhashedDirtyPaths = ['scripts/launch/other-input.ts'];
        (report.apiInventory as Record<string, unknown>).calls = [{ id: 'queues', outcome: 'permission-gap' }];

        const sourceIdentity = report.sourceIdentity as Record<string, unknown>;
        sourceIdentity.dirtyPaths = ['scripts/launch/other-input.ts'];
        sourceIdentity.gitWorktreeDirty = true;
        const result = validateRuntime(report);
        expect(result.valid).toBe(false);
        expect(result.errors).toEqual(expect.arrayContaining([
            'report status is FAILED',
            'endedAt is stale',
            'duplicate check: cloudflare_account_auth',
            'critical check count invalid: cloudflare_account_auth',
            'ambiguous safety check: production_queue_and_dlq_inventory',
            'sourceIdentity contains unhashed dirty paths',
            'ambiguous Cloudflare API read: queues:permission-gap',
        ]));
    });

    it('does not infer Pages ownership from project existence alone', () => {
        const report = runtimeSummary();
        const pages = (report.probes as Array<Record<string, unknown>>)[0].summary as Record<string, unknown>;
        pages.requiredDomainsPresent = false;
        pages.domainNames = ['espanolhonesto.pages.dev'];

        const result = validateRuntime(report);
        expect(result.valid).toBe(false);
        expect(result.errors).toEqual(expect.arrayContaining([
            'Pages requiredDomainsPresent was not proven',
            'Pages domain not proven: espanolhonesto.com',
            'Pages domain not proven: www.espanolhonesto.com',
        ]));
    });

    it('accepts the preserved legacy Worker only when every invocation surface is exactly neutralized', () => {
        const report = runtimeSummary();
        const scripts = ((report.apiInventory as Record<string, unknown>).workerScripts as Record<string, unknown>);
        (scripts.flagged as Array<Record<string, unknown>>)[0] = neutralizedWorker('espanol-honesto-reminders');

        const result = validateRuntime(report);
        expect(result).toEqual({
            valid: true,
            errors: [],
            evidenceTimestamp: '2026-07-14T18:55:00.000Z',
        });
    });

    it.each([
        ['active Cron', (worker: Record<string, unknown>) => { worker.crons = ['0 * * * *']; }, 'flagged Worker Cron remains active'],
        ['workers.dev', (worker: Record<string, unknown>) => { worker.workersDevEnabled = true; }, 'flagged Worker workers.dev remains enabled or ambiguous'],
        ['previews', (worker: Record<string, unknown>) => { worker.previewsEnabled = true; }, 'flagged Worker previews remain enabled or ambiguous'],
        ['custom domain', (worker: Record<string, unknown>) => { (worker.invocationSurfaces as Record<string, unknown>).customDomains = 1; }, 'flagged Worker customDomains must be zero'],
        ['Worker Route', (worker: Record<string, unknown>) => { (worker.invocationSurfaces as Record<string, unknown>).workerRoutes = 1; }, 'flagged Worker workerRoutes must be zero'],
        ['Queue consumer', (worker: Record<string, unknown>) => { (worker.invocationSurfaces as Record<string, unknown>).queueConsumers = 1; }, 'flagged Worker queueConsumers must be zero'],
        ['service binding', (worker: Record<string, unknown>) => { (worker.invocationSurfaces as Record<string, unknown>).inboundServiceBindings = 1; }, 'flagged Worker inboundServiceBindings must be zero'],
        ['tail consumer', (worker: Record<string, unknown>) => { (worker.invocationSurfaces as Record<string, unknown>).inboundTailConsumerReferences = 1; }, 'flagged Worker inboundTailConsumerReferences must be zero'],
        ['email routing', (worker: Record<string, unknown>) => { (worker.invocationSurfaces as Record<string, unknown>).emailRoutingReferences = 1; }, 'flagged Worker emailRoutingReferences must be zero'],
    ])('fails closed when the legacy Worker retains %s', (_label, mutate, expectedError) => {
        const report = runtimeSummary();
        const scripts = ((report.apiInventory as Record<string, unknown>).workerScripts as Record<string, unknown>);
        const worker = neutralizedWorker('espanol-honesto-reminders');
        mutate(worker);
        (scripts.flagged as Array<Record<string, unknown>>)[0] = worker;

        const result = validateRuntime(report);
        expect(result.valid).toBe(false);
        expect(result.errors).toContain(`${expectedError}: espanol-honesto-reminders`);
    });

    it('fails closed when a legacy invocation surface could not be read', () => {
        const report = runtimeSummary();
        const scripts = ((report.apiInventory as Record<string, unknown>).workerScripts as Record<string, unknown>);
        const worker = neutralizedWorker('espanol-honesto-reminders');
        worker.crons = undefined;
        (worker.invocationSurfaces as Record<string, unknown>).state = 'gap';
        worker.gaps = ['invocation-surfaces:worker-routes:permission-gap'];
        (scripts.flagged as Array<Record<string, unknown>>)[0] = worker;

        const result = validateRuntime(report);
        expect(result.valid).toBe(false);
        expect(result.errors).toEqual(expect.arrayContaining([
            'flagged Worker Cron evidence is missing: espanol-honesto-reminders',
            'flagged Worker invocation surfaces are ambiguous: espanol-honesto-reminders',
            'flagged Worker evidence gaps remain: espanol-honesto-reminders',
        ]));
    });

    it('allows the duplicate staging Worker as a non-critical warning only while it is completely unexposed', () => {
        const report = runtimeSummary();
        const duplicateCheck = (report.checks as Array<Record<string, unknown>>)
            .find((candidate) => candidate.name === 'duplicate_staging_worker_posture');
        if (!duplicateCheck) throw new Error('fixture check missing');
        duplicateCheck.status = 'warning';
        const scripts = ((report.apiInventory as Record<string, unknown>).workerScripts as Record<string, unknown>);
        (scripts.flagged as Array<Record<string, unknown>>)[1] = neutralizedWorker('espanolhonesto-staging-staging');

        expect(validateRuntime(report).valid).toBe(true);
        const duplicate = (scripts.flagged as Array<Record<string, unknown>>)[1];
        (duplicate.invocationSurfaces as Record<string, unknown>).workerRoutes = 1;
        const unsafe = validateRuntime(report);
        expect(unsafe.valid).toBe(false);
        expect(unsafe.errors).toContain('flagged Worker workerRoutes must be zero: espanolhonesto-staging-staging');
    });

    it('fails closed while HEAD can recreate the legacy Worker', () => {
        const report = runtimeSummary();
        const scripts = ((report.apiInventory as Record<string, unknown>).workerScripts as Record<string, unknown>);
        const head = scripts.legacyHeadDeployment as Record<string, unknown>;
        head.state = 'gap';
        head.trackedLegacyPackagePaths = ['workers/reminder-cron/wrangler.toml'];
        head.workingTreePackagePresent = true;
        head.automaticDeployReferences = ['workers/reminder-cron/package.json'];

        const result = validateRuntime(report);
        expect(result.valid).toBe(false);
        expect(result.errors).toEqual(expect.arrayContaining([
            'legacy Worker HEAD deployment posture is not ready',
            'legacy Worker package remains tracked in HEAD',
            'legacy Worker package remains in the working tree',
            'legacy Worker automatic deployment reference remains in HEAD',
        ]));
    });

    it('accepts only fresh structured no-write cutover preflight evidence with every critical check', () => {
        expect(validatePreflight(cutoverPreflightSummary()).valid).toBe(true);

        const failed = cutoverPreflightSummary();
        failed.generatedAt = '2026-07-14T17:00:00.000Z';
        failed.status = 'FAILED';
        (failed.checks as Array<Record<string, unknown>>)[0].status = 'failed';
        (failed.captures as Array<Record<string, unknown>>)[0].status = 'failed';
        const result = validatePreflight(failed);
        expect(result.valid).toBe(false);
        expect(result.errors).toEqual(expect.arrayContaining([
            'report status is FAILED',
            'generatedAt is stale',
            'failed check: command_scope_no_external_write',
            'critical check is not ok: command_scope_no_external_write',
            'failed capture: wrangler-whoami',
        ]));
    });

    it('rejects a runtime report after any canonical source file changes', () => {
        const changedCurrent = cloneSourceIdentity(currentSourceIdentity);
        changedCurrent.files[0].sha256 = changedCurrent.files[0].sha256 === 'b'.repeat(64)
            ? 'c'.repeat(64)
            : 'b'.repeat(64);
        changedCurrent.sourceSha256 = computeCloudflareProductionSourceSha256(changedCurrent.files);

        const result = validateRuntime(runtimeSummary(), changedCurrent);
        expect(result.valid).toBe(false);
        expect(result.errors).toEqual(expect.arrayContaining([
            'sourceIdentity.sourceSha256 does not match current source',
            `sourceIdentity file hash drift: ${changedCurrent.files[0].path}`,
        ]));
    });

    it('hashes the structured web+fulfillment evidence contract as production-critical source', () => {
        expect(CLOUDFLARE_PRODUCTION_SOURCE_IDENTITY_PATHS)
            .toContain('scripts/launch/cloudflare-production-inert-composite-evidence.ts');
        expect(CLOUDFLARE_PRODUCTION_SOURCE_IDENTITY_PATHS)
            .toContain('scripts/launch/cloudflare-wrangler-oauth.ts');
        expect(CLOUDFLARE_PRODUCTION_SOURCE_IDENTITY_PATHS)
            .toContain('scripts/launch/rc-production-inert-evidence.ts');
    });

    it('rejects a runtime report generated from another Git HEAD', () => {
        const report = runtimeSummary();
        (report.sourceIdentity as CloudflareProductionSourceIdentity).gitHead = 'f'.repeat(40);

        const result = validateRuntime(report);
        expect(result.valid).toBe(false);
        expect(result.errors).toContain('sourceIdentity.gitHead does not match current HEAD');
    });

    it.each([
        ['omitted', (files: CloudflareProductionSourceIdentity['files']) => files.slice(1), false],
        ['extra', (files: CloudflareProductionSourceIdentity['files']) => [...files, { path: 'scripts/launch/unexpected.ts', sha256: 'd'.repeat(64) }], false],
        ['reordered', (files: CloudflareProductionSourceIdentity['files']) => [files[1], files[0], ...files.slice(2)], false],
        ['duplicated', (files: CloudflareProductionSourceIdentity['files']) => [...files, files[0]], true],
    ])('rejects a source identity with a %s canonical file entry', (_label, mutateFiles, duplicateExpected) => {
        const report = runtimeSummary();
        const identity = report.sourceIdentity as CloudflareProductionSourceIdentity;
        identity.files = mutateFiles(identity.files);
        identity.sourceSha256 = computeCloudflareProductionSourceSha256(identity.files);

        const result = validateRuntime(report);
        expect(result.valid).toBe(false);
        expect(result.errors).toContain('sourceIdentity.files path order does not match canonical allowlist');
        expect(result.errors.includes('sourceIdentity.files contains duplicate path')).toBe(duplicateExpected);
    });

    it('rejects both hashed dirty-path drift and any current unhashed dirty path', () => {
        const allowedDirtyCurrent = cloneSourceIdentity(currentSourceIdentity);
        allowedDirtyCurrent.gitWorktreeDirty = true;
        allowedDirtyCurrent.dirtyPaths = [CLOUDFLARE_PRODUCTION_SOURCE_IDENTITY_PATHS[0]];
        expect(validateRuntime(runtimeSummary(), allowedDirtyCurrent).errors).toContain(
            'sourceIdentity.dirtyPaths do not match current worktree',
        );

        const unhashedDirtyCurrent = cloneSourceIdentity(currentSourceIdentity);
        unhashedDirtyCurrent.gitWorktreeDirty = true;
        unhashedDirtyCurrent.dirtyPaths = ['src/unhashed-production-change.ts'];
        unhashedDirtyCurrent.unhashedDirtyPaths = ['src/unhashed-production-change.ts'];
        const result = validateRuntime(runtimeSummary(), unhashedDirtyCurrent);
        expect(result.valid).toBe(false);
        expect(result.errors).toContain('current source identity contains unhashed dirty paths');
    });

    it('excludes only the exact untracked Irene studio asset and still rejects other untracked inputs', () => {
        const directory = mkdtempSync(path.join(tmpdir(), 'eh-cloudflare-source-identity-'));
        try {
            const initialized = spawnSync('git', ['init', '--quiet'], {
                cwd: directory,
                encoding: 'utf8',
                windowsHide: true,
            });
            expect(initialized.status).toBe(0);
            const retainedAsset = CLOUDFLARE_PRODUCTION_SOURCE_IDENTITY_EXCLUDED_UNTRACKED_PATHS[0];
            const retainedAssetPath = path.join(directory, ...retainedAsset.split('/'));
            mkdirSync(path.dirname(retainedAssetPath), { recursive: true });
            writeFileSync(retainedAssetPath, 'local image bytes', 'utf8');
            writeFileSync(path.join(directory, 'untracked-build-input.ts'), 'export const localOnly = true;\n', 'utf8');

            const identity = captureCloudflareProductionSourceIdentity({ cwd: directory });

            expect(identity.gitWorktreeDirty).toBe(true);
            expect(identity.dirtyPaths).not.toContain(retainedAsset);
            expect(identity.dirtyPaths).toContain('untracked-build-input.ts');
            expect(identity.files.some((file) => file.path === retainedAsset)).toBe(false);
            expect(identity.unhashedDirtyPaths).not.toContain(retainedAsset);
            expect(identity.unhashedDirtyPaths).toContain('untracked-build-input.ts');

            const staged = spawnSync('git', ['add', '--', retainedAsset], {
                cwd: directory,
                encoding: 'utf8',
                windowsHide: true,
            });
            expect(staged.status).toBe(0);
            const stagedIdentity = captureCloudflareProductionSourceIdentity({ cwd: directory });
            expect(stagedIdentity.dirtyPaths).toContain(retainedAsset);
            expect(stagedIdentity.unhashedDirtyPaths).toContain(retainedAsset);
        } finally {
            rmSync(directory, { recursive: true, force: true });
        }
    });

    it('keeps the excluded user-local asset unreferenced by runtime code', () => {
        const assetName = path.basename(CLOUDFLARE_PRODUCTION_SOURCE_IDENTITY_EXCLUDED_UNTRACKED_PATHS[0]);
        const references = spawnSync('git', [
            'grep', '-n', '-F', assetName, '--', 'src', 'workers', 'astro.config.mjs', 'wrangler.toml',
        ], {
            encoding: 'utf8',
            windowsHide: true,
        });
        const landingPage = readFileSync('src/components/LandingPage.astro', 'utf8');

        expect(references.status).toBe(1);
        expect(references.stdout).toBe('');
        expect(landingPage).toContain("import avatarIrene from '../assets/avatar_irene_team.png';");
        expect(landingPage).not.toContain(assetName);
    });

    it('source-binds cutover preflight evidence to the same current identity', () => {
        const report = cutoverPreflightSummary();
        const identity = report.sourceIdentity as CloudflareProductionSourceIdentity;
        identity.gitHead = 'e'.repeat(40);

        const result = validatePreflight(report);
        expect(result.valid).toBe(false);
        expect(result.errors).toContain('sourceIdentity.gitHead does not match current HEAD');
    });

    it('checks both structured identities before the Worker secrets runner can execute a command', () => {
        const source = readFileSync('scripts/launch/cloudflare-production-worker-secrets.ts', 'utf8');
        const runtimeGate = source.indexOf('validateLatestRuntimeReadonlyEvidence()');
        const preflightGate = source.indexOf('validateLatestNoWritePreflight()');
        const initialFailureGate = source.indexOf("checks.some((check) => check.status === 'failed')");
        const execution = source.indexOf('await runApprovedExecution');

        expect(runtimeGate).toBeGreaterThan(-1);
        expect(preflightGate).toBeGreaterThan(runtimeGate);
        expect(initialFailureGate).toBeGreaterThan(preflightGate);
        expect(execution).toBeGreaterThan(initialFailureGate);
        expect(source).toContain('validateCloudflareRuntimeReadonlySummary(summary, target)');
        expect(source).toContain('validateCloudflareRuntimeCutoverPreflightSummary(preflight, target)');
    });

    it('wires both consumers to summary.json validators and keeps persisted whoami output email-redacted', () => {
        const cutover = readFileSync('scripts/launch/cloudflare-production-runtime-cutover.ts', 'utf8');
        const secrets = readFileSync('scripts/launch/cloudflare-production-worker-secrets.ts', 'utf8');
        const preflight = readFileSync('scripts/launch/cloudflare-production-runtime-cutover-preflight.ts', 'utf8');
        const phaseOne = readFileSync('scripts/launch/cloudflare-production-worker-phase1.ts', 'utf8');
        const combined = `${cutover}\n${secrets}\n${preflight}\n${phaseOne}`;

        for (const source of [cutover, secrets]) {
            expect(source).toContain("latestGeneratedPath('launch-cloudflare-production-runtime-readonly', 'summary.json')");
            expect(source).toContain('validateCloudflareRuntimeReadonlySummary');
            expect(source).toContain('validateCloudflareRuntimeCutoverPreflightSummary');
        }
        for (const source of [preflight, phaseOne, secrets]) {
            expect(source).toContain("'[redacted-email]'");
        }
        expect(combined).toContain("accountLabel: 'Español Honesto Cloudflare account'");
        expect(combined).not.toMatch(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/iu);
        expect(preflight).toContain('emailRedacted: Boolean(stringValue(object.email))');
        expect(preflight).toContain("'email=redacted'");
    });
});

function cleanCurrentSourceIdentity(): CloudflareProductionSourceIdentity {
    const identity = captureCloudflareProductionSourceIdentity();
    if (!identity.gitHead || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(identity.gitHead)) {
        throw new Error('Cloudflare evidence tests require a valid Git HEAD.');
    }
    if (JSON.stringify(identity.files.map((file) => file.path))
        !== JSON.stringify([...CLOUDFLARE_PRODUCTION_SOURCE_IDENTITY_PATHS])) {
        throw new Error('Cloudflare evidence tests require every canonical source identity path.');
    }
    return {
        ...identity,
        gitWorktreeDirty: false,
        dirtyPaths: [],
        unhashedDirtyPaths: [],
    };
}

function cloneSourceIdentity(identity: CloudflareProductionSourceIdentity): CloudflareProductionSourceIdentity {
    return JSON.parse(JSON.stringify(identity)) as CloudflareProductionSourceIdentity;
}

function validateRuntime(
    report: Record<string, unknown>,
    current = currentSourceIdentity,
) {
    return validateCloudflareRuntimeReadonlySummary(report, target, now, current);
}

function validatePreflight(
    report: Record<string, unknown>,
    current = currentSourceIdentity,
) {
    return validateCloudflareRuntimeCutoverPreflightSummary(report, target, now, current);
}
