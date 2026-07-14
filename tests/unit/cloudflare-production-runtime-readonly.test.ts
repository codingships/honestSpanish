import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { newestWorkerDeployment } from '../../scripts/launch/cloudflare-deployment-order';

const source = readFileSync('scripts/launch/cloudflare-production-runtime-readonly.ts', 'utf8');
const evidenceSource = readFileSync('scripts/launch/cloudflare-production-evidence.ts', 'utf8');
const packageJson = readFileSync('package.json', 'utf8');
const finalApprovalQueue = readFileSync('scripts/launch/final-approval-queue.ts', 'utf8');
const cutoverPack = readFileSync('scripts/launch/cloudflare-production-runtime-cutover.ts', 'utf8');
const integrationFinalPackage = readFileSync('scripts/launch/integration-final-package.ts', 'utf8');
const finalReadiness = readFileSync('scripts/launch/final-readiness-audit.ts', 'utf8');
const statusScript = readFileSync('scripts/launch/status.ts', 'utf8');
const manualRunbook = readFileSync('docs/launch/MANUAL_EVIDENCE_RUNBOOK.md', 'utf8');
const manualEvidenceDoc = readFileSync('docs/launch/MANUAL_EVIDENCE.md', 'utf8');
const manualExample = readFileSync('docs/launch/MANUAL_EVIDENCE.example.json', 'utf8');

describe('Cloudflare production runtime read-only evidence', () => {
    it('selects the newest Worker deployment by created_on regardless of API ordering', () => {
        const oldestToNewest = [
            { id: 'old', created_on: '2026-07-11T09:57:34.551804Z' },
            { id: 'middle', created_on: '2026-07-11T23:21:57.712161Z' },
            { id: 'new', created_on: '2026-07-12T19:23:06.921581Z' },
        ];

        expect(newestWorkerDeployment(oldestToNewest)?.id).toBe('new');
        expect(newestWorkerDeployment([...oldestToNewest].reverse())?.id).toBe('new');
        expect(oldestToNewest.map(({ id }) => id)).toEqual(['old', 'middle', 'new']);
    });

    it('falls back deterministically when Cloudflare omits usable timestamps', () => {
        expect(newestWorkerDeployment([
            { id: 'first', created_on: 'not-a-date' },
            { id: 'second' },
        ])?.id).toBe('first');
        expect(newestWorkerDeployment([])).toBeUndefined();
    });

    it('is wired into pnpm scripts, final queue, integration package and launch status', () => {
        expect(packageJson).toContain('"launch:cloudflare-production-runtime-readonly": "tsx scripts/launch/cloudflare-production-runtime-readonly.ts"');
        expect(finalApprovalQueue).toContain('launch:cloudflare-production-runtime-readonly');
        expect(integrationFinalPackage).toContain('cloudflare_runtime_readonly');
        expect(integrationFinalPackage).toContain('launch-cloudflare-production-runtime-readonly');
        expect(finalReadiness).toContain('pnpm launch:cloudflare-production-runtime-readonly');
        expect(statusScript).toContain("readLatestJson<CheckBackedSummary>('launch-cloudflare-production-runtime-readonly', 'summary.json')");
        expect(statusScript).toContain('Cloudflare Production Runtime Read-Only Evidence');
        expect(cutoverPack).toContain('cloudflareRuntimeReadonlyPath');
        expect(cutoverPack).toContain('validateCloudflareRuntimeReadonlyEvidence');
        expect(cutoverPack).toContain('launch:cloudflare-production-runtime-readonly');
        expect(manualRunbook).toContain('pnpm launch:cloudflare-production-runtime-readonly');
        expect(manualRunbook).toContain('outputs/launch-cloudflare-production-runtime-readonly/<timestamp>/summary.md');
        expect(manualEvidenceDoc).toContain('launch-cloudflare-production-runtime-readonly');
        expect(manualExample).toContain('outputs/launch-cloudflare-production-runtime-readonly/<timestamp>/summary.md');
    });

    it('treats the preserved legacy Worker as a neutralization readback, not an open deletion decision', () => {
        for (const generatedSource of [integrationFinalPackage, finalReadiness, statusScript]) {
            expect(generatedSource).toContain('remains fully neutralized');
            expect(generatedSource).not.toContain('disabled/deleted');
            expect(generatedSource).not.toContain('decide to disable/delete');
        }
        expect(integrationFinalPackage).toContain('Legacy Worker neutralization reconfirmed');
    });

    it('uses only Wrangler read/list/version probes and disables the skill-install prompt noise', () => {
        for (const snippet of [
            "spawnSync(pnpmCommand()",
            "'pnpm.cmd' : 'pnpm'",
            "'--config.verify-deps-before-run=false'",
            "'--install-skills=false'",
            "'exec'",
            "'wrangler'",
            "CI: 'true'",
            "WRANGLER_SEND_METRICS: 'false'",
            'CLOUDFLARE_ACCOUNT_ID: target.accountId',
            "'whoami', '--json'",
            "'pages', 'project', 'list', '--json'",
            "'pages', 'deployment', 'list'",
            "'deployments', 'list', '--name'",
            "'secret', 'list', '--name'",
            "'--format', 'json'",
            'function arraysEqual(',
        ]) {
            expect(source).toContain(snippet);
        }

        for (const forbidden of [
            "args: ['deploy'",
            "args: ['delete'",
            "args: ['secret', 'put'",
            "args: ['secret', 'delete'",
            "args: ['pages', 'deploy'",
            "args: ['pages', 'project', 'create'",
            "args: ['rollback'",
            "args: ['triggers'",
        ]) {
            expect(source).not.toContain(forbidden);
        }
    });

    it('records current Cloudflare state without secret values', () => {
        for (const snippet of [
            'd1a22bcf6477ff2ff31d2bfb83084e44',
            'espanolhonesto',
            'espanolhonesto-staging',
            'espanolhonesto.com',
            'www.espanolhonesto.com',
            'Pages project exists and its domain facts prove ownership of both required production custom domains',
            'requiredDomainsPresent',
            'production_worker_exists',
            'production_worker_secret_names',
            'requiredProductionWebActiveSecretNames',
            'requiredProductionFulfillmentActiveSecretNames',
            'productionBootstrapSecretNames',
            'secret list probes store names only',
            'noSecretValuesStored',
            'extractJsonValue',
            'Project Name',
            'Project Domains',
            'script_not_found',
            'code:\\s*10007',
        ]) {
            expect(source).toContain(snippet);
        }

        expect(source).not.toContain('console.log(process.env');
        expect(source).not.toContain('writeFileSync(outputPath, process.env');
        expect(source).not.toContain("args: ['secret', 'put'");
    });

    it('covers the exact inert production web, fulfillment, Queue, DLQ and Cron inventory', () => {
        for (const snippet of [
            'productionFulfillmentWorker: PRODUCTION_QUEUE_TARGET.worker',
            'productionQueue: PRODUCTION_QUEUE_TARGET.queue',
            'productionDeadLetterQueue: PRODUCTION_QUEUE_TARGET.deadLetterQueue',
            "id: 'production_worker_status'",
            "id: 'production_fulfillment_deployments'",
            "id: 'production_fulfillment_status'",
            "id: 'production_fulfillment_secrets'",
            "'production_worker_current_version'",
            "'production_fulfillment_current_version'",
            '/workers/scripts/${encodeURIComponent(target.productionFulfillmentWorker)}/schedules',
            '/workers/scripts`',
            'flaggedLegacyWorkerNames',
            "'espanol-honesto-reminders'",
            "'espanolhonesto-staging-staging'",
            'readFlaggedWorkerScriptSnapshot',
            '/schedules`',
            '/subdomain`',
            'workersDevEnabled',
            'previewsEnabled',
            'legacy_reminder_worker_neutralized',
            'duplicate_staging_worker_posture',
            'captureLegacyHeadDeploymentPosture',
            "spawnSync('git', ['ls-tree', '-r', '--name-only', 'HEAD']",
            'trackedLegacyPackagePaths',
            'automaticDeployReferences',
            'enrichFlaggedWorkerInvocationSurfaces',
            '/workers/domains?service=',
            '/workers/routes',
            '/consumers',
            '/settings',
            '/email/routing/rules',
            'customDomains',
            'workerRoutes',
            'queueConsumers',
            'inboundServiceBindings',
            'inboundTailConsumerReferences',
            'emailRoutingReferences',
            '/queues?page=${page}&per_page=100',
            'readExactQueueSnapshot(target.productionQueue',
            'readExactQueueSnapshot(target.productionDeadLetterQueue',
            'backlog_count',
            'production_queue_and_dlq_inventory',
            'production_fulfillment_schedules',
        ]) {
            expect(source).toContain(snippet);
        }
    });

    it('persists binding names/types but only explicit allowlisted non-secret safety values', () => {
        for (const snippet of [
            'safePlainTextBindingValueNames',
            'safeTargetBindingValueNames',
            "outputPolicy?: 'sanitized-raw' | 'safe-binding-projection'",
            "outputPolicy: 'safe-binding-projection'",
            'safeBindingProjection',
            'rawBindingValuesStored: false',
            'rawVersionBindingValuesStored: false',
            'unredacted version binding values',
            "'WEB_RUNTIME_MODE'",
            "'FULFILLMENT_RUNTIME_MODE'",
            "'CHECKOUT_ENABLED'",
            "'CHECKOUT_ENABLED_OVERRIDE'",
            "'EMAIL_DELIVERY_MODE'",
            "'FULFILLMENT_SERVICE'",
            "'FULFILLMENT_QUEUE'",
        ]) {
            expect(source).toContain(snippet);
        }

        expect(source).not.toContain('parsedJson: result.parsedJson');
        expect(source).not.toContain('writeFileSync(outputPath, stdout');
        expect(source).not.toContain('writeFileSync(outputPath, JSON.stringify(parsedJson');
    });

    it('hard-codes direct Cloudflare access to exact GET-only paths and reports absent resources as expected-not-ready', () => {
        for (const snippet of [
            "method: 'GET'",
            'isAllowlistedCloudflareGetPath',
            'onlyGetApiCalls',
            "'expected-not-ready'",
            'exact-resource-absent',
            'response.status === 404',
            "? 'expected-not-ready'",
            'tokenAvailable',
            'permission-gap',
            'api-error',
        ]) {
            expect(source).toContain(snippet);
        }

        for (const forbidden of [
            "method: 'POST'",
            "method: 'PUT'",
            "method: 'PATCH'",
            "method: 'DELETE'",
            "'versions', 'download'",
            "'versions', 'upload'",
        ]) {
            expect(source).not.toContain(forbidden);
        }
    });

    it('binds every evidence package to Git HEAD and deterministic source/config hashes', () => {
        expect(source).toContain('captureCloudflareProductionSourceIdentity');
        expect(source).toContain('validateCloudflareProductionSourceIdentity');
        expect(source).toContain('evidence_source_identity');
        for (const snippet of [
            "spawnSync('git', ['rev-parse', 'HEAD']",
            "spawnSync('git', ['status', '--porcelain=v1', '--untracked-files=all']",
            'CLOUDFLARE_PRODUCTION_SOURCE_IDENTITY_PATHS',
            "'scripts/launch/cloudflare-production-runtime-readonly.ts'",
            "'scripts/launch/cloudflare-deployment-order.ts'",
            "'scripts/launch/cloudflare-production-queue-shared.ts'",
            "'scripts/launch/cloudflare-production-one-shot-write.ts'",
            "'scripts/launch/cloudflare-production-queue-runtime.ts'",
            "'scripts/launch/cloudflare-production-worker-phase1.ts'",
            "'scripts/launch/cloudflare-production-worker-secrets.ts'",
            "'scripts/dev/build-production-bootstrap.ts'",
            "'scripts/dev/build-production-release.ts'",
            "'scripts/dev/deploy-built-worker.ts'",
            "'wrangler.toml'",
            "'workers/fulfillment/wrangler.toml'",
            "'workers/fulfillment/src/index.ts'",
            'sourceSha256',
            'unhashedDirtyPaths',
            'parseGitPorcelainPaths',
            '.files path order does not match canonical allowlist',
        ]) {
            expect(evidenceSource).toContain(snippet);
        }
    });
});
