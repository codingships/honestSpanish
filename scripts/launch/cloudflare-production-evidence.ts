import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
    productionBootstrapVersionBindingTypes,
    productionBootstrapSecretNames,
    productionInertBindingNameErrors,
} from './cloudflare-production-worker-safety';

export const CLOUDFLARE_PRODUCTION_EVIDENCE_MAX_AGE_MS = 30 * 60 * 1_000;
const FUTURE_CLOCK_SKEW_MS = 2 * 60 * 1_000;
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const GIT_HEAD_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;

export const CLOUDFLARE_PRODUCTION_SOURCE_IDENTITY_PATHS = [
    '.github/workflows/ci.yml',
    '.github/workflows/deploy-staging.yml',
    'astro.config.mjs',
    'package.json',
    'pnpm-lock.yaml',
    'pnpm-workspace.yaml',
    'scripts/dev/build-production-bootstrap.ts',
    'scripts/dev/build-production-release.ts',
    'scripts/dev/deploy-built-worker.ts',
    'scripts/dev/production-release-safety.ts',
    'scripts/dev/production.ts',
    'scripts/launch/cloudflare-deployment-order.ts',
    'scripts/launch/cloudflare-production-evidence.ts',
    'scripts/launch/cloudflare-wrangler-oauth.ts',
    'scripts/launch/cloudflare-production-fulfillment-bootstrap-secrets.ts',
    'scripts/launch/cloudflare-production-fulfillment-enable-state.ts',
    'scripts/launch/cloudflare-production-fulfillment-lifecycle-shared.ts',
    'scripts/launch/cloudflare-production-fulfillment-lifecycle.ts',
    'scripts/launch/cloudflare-production-fulfillment-secrets.ts',
    'scripts/launch/cloudflare-production-inert-composite-evidence.ts',
    'scripts/launch/cloudflare-production-one-shot-write.ts',
    'scripts/launch/cloudflare-production-queue-provision.ts',
    'scripts/launch/cloudflare-production-queue-runtime.ts',
    'scripts/launch/cloudflare-production-queue-shared.ts',
    'scripts/launch/cloudflare-production-runtime-cutover-preflight.ts',
    'scripts/launch/cloudflare-production-runtime-cutover.ts',
    'scripts/launch/cloudflare-production-runtime-readonly.ts',
    'scripts/launch/rc-production-inert-evidence.ts',
    'scripts/launch/cloudflare-production-web-active-orchestrator.ts',
    'scripts/launch/cloudflare-production-worker-bootstrap-secrets.ts',
    'scripts/launch/cloudflare-production-worker-phase1.ts',
    'scripts/launch/cloudflare-production-worker-safety.ts',
    'scripts/launch/cloudflare-production-worker-secrets.ts',
    'workers/fulfillment/package.json',
    'workers/fulfillment/src/index.ts',
    'workers/fulfillment/wrangler.toml',
    'wrangler.toml',
] as const;

export const CLOUDFLARE_PRODUCTION_SOURCE_IDENTITY_EXCLUDED_UNTRACKED_PATHS = [
    'src/assets/avatar_irene_studio.png',
] as const;

export interface CloudflareProductionSourceFileIdentity {
    path: string;
    sha256: string;
}

export interface CloudflareProductionSourceIdentity {
    schemaVersion: 1;
    gitHead: string | null;
    gitWorktreeDirty: boolean | null;
    dirtyPaths: string[];
    unhashedDirtyPaths: string[];
    sourceSha256: string;
    files: CloudflareProductionSourceFileIdentity[];
}

interface CloudflareProductionSourceIdentityCaptureOptions {
    cwd?: string;
}

export interface CloudflareProductionEvidenceTarget {
    accountId: string;
    productionWorker: string;
    pagesProject: string;
    customDomains: readonly string[];
}

export interface CloudflareProductionEvidenceValidation {
    valid: boolean;
    errors: string[];
    evidenceTimestamp: string | null;
}

export interface CloudflareProductionInertRuntimeExpectation {
    observedAfter: string;
    webWorker: string;
    webVersionId: string;
    fulfillmentWorker: string;
    fulfillmentVersionId: string;
    productionQueue: string;
    productionQueueId: string;
    productionDeadLetterQueue: string;
    productionDeadLetterQueueId: string;
}

const runtimeCriticalChecks = [
    'readonly_command_scope',
    'cloudflare_api_get_scope',
    'cloudflare_account_auth',
    'pages_project_current_domain_owner',
    'legacy_reminder_worker_neutralized',
    'evidence_source_identity',
    'local_wrangler_config_fail_closed',
    'generated_output_secret_posture',
] as const;

const runtimeAmbiguitySensitiveChecks = new Set([
    'production_web_current_traffic',
    'production_fulfillment_current_traffic',
    'production_web_inert_bindings',
    'production_fulfillment_inert_bindings',
    'production_fulfillment_schedules',
    'production_queue_and_dlq_inventory',
]);

const cutoverPreflightCriticalChecks = [
    'command_scope_no_external_write',
    'cloudflare_account_auth',
    'checkout_disabled_config',
    'safe_base_worker_name',
    'local_build_passed',
    'wrangler_production_dry_run_passed',
    'dry_run_checkout_disabled',
    'dry_run_no_custom_domain_attachment',
    'evidence_source_identity',
    'production_variable_matrix_complete',
    'generated_output_secret_posture',
] as const;

export function captureCloudflareProductionSourceIdentity(
    options: CloudflareProductionSourceIdentityCaptureOptions = {},
): CloudflareProductionSourceIdentity {
    const cwd = path.resolve(options.cwd ?? process.cwd());
    const files = CLOUDFLARE_PRODUCTION_SOURCE_IDENTITY_PATHS
        .map(toPosix)
        .filter((filePath) => existsSync(path.join(cwd, ...filePath.split('/'))))
        .map((filePath) => ({
            path: filePath,
            sha256: sha256(readFileSync(path.join(cwd, ...filePath.split('/')), 'utf8')),
        }));
    const head = spawnSync('git', ['rev-parse', 'HEAD'], {
        cwd,
        encoding: 'utf8',
        timeout: 10_000,
        windowsHide: true,
    });
    const status = spawnSync('git', ['status', '--porcelain=v1', '--untracked-files=all'], {
        cwd,
        encoding: 'utf8',
        timeout: 10_000,
        windowsHide: true,
    });
    const dirtyPaths = status.status === 0 ? parseGitPorcelainPaths(stringValue(status.stdout)) : [];
    const hashedPaths = new Set(files.map((file) => file.path));

    return {
        schemaVersion: 1,
        gitHead: head.status === 0 ? stringValue(head.stdout).trim() || null : null,
        gitWorktreeDirty: status.status === 0 ? dirtyPaths.length > 0 : null,
        dirtyPaths,
        unhashedDirtyPaths: dirtyPaths.filter((filePath) => !hashedPaths.has(filePath)),
        sourceSha256: sourceIdentityAggregate(files),
        files,
    };
}

export function validateCloudflareProductionSourceIdentity(
    value: unknown,
    current: CloudflareProductionSourceIdentity = captureCloudflareProductionSourceIdentity(),
): string[] {
    const errors: string[] = [];
    const evidence = parseSourceIdentity(value, 'sourceIdentity', errors);
    const currentErrors: string[] = [];
    const currentIdentity = parseSourceIdentity(current, 'currentSourceIdentity', currentErrors);
    errors.push(...currentErrors);

    if (!evidence || !currentIdentity) return uniqueStrings(errors);
    if (evidence.gitHead !== currentIdentity.gitHead) errors.push('sourceIdentity.gitHead does not match current HEAD');
    if (evidence.gitWorktreeDirty !== currentIdentity.gitWorktreeDirty) {
        errors.push('sourceIdentity.gitWorktreeDirty does not match current worktree');
    }
    if (!sameStringArray(evidence.dirtyPaths, currentIdentity.dirtyPaths)) {
        errors.push('sourceIdentity.dirtyPaths do not match current worktree');
    }
    if (!sameStringArray(evidence.unhashedDirtyPaths, currentIdentity.unhashedDirtyPaths)) {
        errors.push('sourceIdentity.unhashedDirtyPaths do not match current worktree');
    }
    if (currentIdentity.unhashedDirtyPaths.length > 0) {
        errors.push('current source identity contains unhashed dirty paths');
    }
    if (evidence.sourceSha256 !== currentIdentity.sourceSha256) {
        errors.push('sourceIdentity.sourceSha256 does not match current source');
    }
    for (let index = 0; index < CLOUDFLARE_PRODUCTION_SOURCE_IDENTITY_PATHS.length; index += 1) {
        const evidenceFile = evidence.files[index];
        const currentFile = currentIdentity.files[index];
        if (evidenceFile?.path === currentFile?.path && evidenceFile?.sha256 !== currentFile?.sha256) {
            errors.push(`sourceIdentity file hash drift: ${evidenceFile.path}`);
        }
    }

    return uniqueStrings(errors);
}

export function validateCloudflareRuntimeReadonlySummary(
    value: unknown,
    target: CloudflareProductionEvidenceTarget,
    now = new Date(),
    currentSourceIdentity = captureCloudflareProductionSourceIdentity(),
): CloudflareProductionEvidenceValidation {
    const errors: string[] = [];
    const report = asRecord(value);
    if (report.schemaVersion !== 2) errors.push('schemaVersion must be 2');
    validateReportStatus(report.status, errors);
    const endedAt = stringValue(report.endedAt) || null;
    validateFreshness(endedAt, now, errors, 'endedAt');

    const evidenceTarget = asRecord(report.target);
    if (evidenceTarget.accountId !== target.accountId) errors.push('target.accountId mismatch');
    if (evidenceTarget.productionWorker !== target.productionWorker) errors.push('target.productionWorker mismatch');
    if (evidenceTarget.pagesProject !== target.pagesProject) errors.push('target.pagesProject mismatch');
    const customDomains = stringArray(evidenceTarget.customDomains);
    if (!sameStringSet(customDomains, target.customDomains)) errors.push('target.customDomains mismatch');

    const safety = asRecord(report.safety);
    for (const [name, expected] of [
        ['readOnly', true],
        ['noExternalWrites', true],
        ['noSecretValuesStored', true],
        ['noWorkerCodeDownloaded', true],
        ['rawVersionBindingValuesStored', false],
    ] as const) {
        if (safety[name] !== expected) errors.push(`safety.${name} must be ${String(expected)}`);
    }

    const checks = validateChecks(report.checks, runtimeCriticalChecks, errors);
    for (const check of checks) {
        if (check.status === 'warning'
            && runtimeAmbiguitySensitiveChecks.has(check.name)
            && !check.message.includes('Expected-not-ready')) {
            errors.push(`ambiguous safety check: ${check.name}`);
        }
    }

    const probes = arrayOfRecords(report.probes);
    validateUniqueNames(probes, 'id', 'probe', errors);
    for (const probe of probes) {
        if (probe.status === 'failed') errors.push(`failed probe: ${stringValue(probe.id) || 'unnamed'}`);
    }
    const pagesProbe = exactlyOneByName(probes, 'id', 'pages_projects', 'probe', errors);
    const pagesSummary = asRecord(pagesProbe?.summary);
    if (pagesSummary.projectFound !== true) errors.push('Pages project was not proven');
    if (pagesSummary.requiredDomainsPresent !== true) errors.push('Pages requiredDomainsPresent was not proven');
    const domainNames = stringArray(pagesSummary.domainNames);
    for (const domain of target.customDomains) {
        if (!domainNames.includes(domain)) errors.push(`Pages domain not proven: ${domain}`);
    }

    errors.push(...validateCloudflareProductionSourceIdentity(report.sourceIdentity, currentSourceIdentity));

    const apiInventory = asRecord(report.apiInventory);
    if (apiInventory.oauthKeyringAttested !== true) errors.push('Cloudflare encrypted OAuth keyring read scope was not proven');
    const workerScripts = asRecord(apiInventory.workerScripts);
    if (workerScripts.state !== 'ready') errors.push('account-wide Worker script inventory is not ready');
    const flaggedScripts = arrayOfRecords(workerScripts.flagged);
    const legacy = exactlyOneByName(flaggedScripts, 'name', 'espanol-honesto-reminders', 'flagged Worker', errors);
    const duplicate = exactlyOneByName(flaggedScripts, 'name', 'espanolhonesto-staging-staging', 'flagged Worker', errors);
    validateWorkerAbsentOrExactlyNeutralized(legacy, 'espanol-honesto-reminders', errors);
    validateWorkerAbsentOrExactlyNeutralized(duplicate, 'espanolhonesto-staging-staging', errors);
    validateLegacyHeadDeploymentPosture(asRecord(workerScripts.legacyHeadDeployment), errors);
    const apiCalls = arrayOfRecords(apiInventory.calls);
    const scriptsListCall = exactlyOneByName(apiCalls, 'id', 'worker_scripts_list', 'Cloudflare API call', errors);
    if (scriptsListCall?.method !== 'GET' || scriptsListCall?.success !== true || scriptsListCall?.outcome !== 'ok') {
        errors.push('account-wide Worker script GET was not proven successful');
    }
    for (const call of apiCalls) {
        const outcome = stringValue(call.outcome);
        if (['permission-gap', 'api-error'].includes(outcome)) {
            errors.push(`ambiguous Cloudflare API read: ${stringValue(call.id) || 'unnamed'}:${outcome}`);
        }
    }

    return { valid: errors.length === 0, errors, evidenceTimestamp: endedAt };
}

export function validateCloudflareRuntimeReadonlyInertAttestation(
    value: unknown,
    target: CloudflareProductionEvidenceTarget,
    expectation: CloudflareProductionInertRuntimeExpectation,
    now = new Date(),
    currentSourceIdentity = captureCloudflareProductionSourceIdentity(),
): CloudflareProductionEvidenceValidation {
    const base = validateCloudflareRuntimeReadonlySummary(
        value,
        target,
        now,
        currentSourceIdentity,
    );
    const errors = [...base.errors];
    const report = asRecord(value);
    const evidenceTarget = asRecord(report.target);
    for (const [field, expected] of [
        ['productionWorker', expectation.webWorker],
        ['productionFulfillmentWorker', expectation.fulfillmentWorker],
        ['productionQueue', expectation.productionQueue],
        ['productionDeadLetterQueue', expectation.productionDeadLetterQueue],
    ] as const) {
        if (evidenceTarget[field] !== expected) errors.push(`target.${field} mismatch for inert attestation`);
    }

    const observedAfter = Date.parse(expectation.observedAfter);
    const startedAtValue = stringValue(report.startedAt);
    const startedAt = Date.parse(startedAtValue);
    const endedAt = base.evidenceTimestamp ? Date.parse(base.evidenceTimestamp) : Number.NaN;
    if (!Number.isFinite(observedAfter)) errors.push('inert expectation observedAfter is invalid');
    if (!Number.isFinite(startedAt)) errors.push('runtime readback startedAt is invalid');
    else if (Number.isFinite(observedAfter) && startedAt <= observedAfter) {
        errors.push('runtime readback did not start after the immutable HMAC composite');
    }
    if (Number.isFinite(startedAt) && Number.isFinite(endedAt) && endedAt < startedAt) {
        errors.push('runtime readback ended before it started');
    }

    const checks = arrayOfRecords(report.checks);
    for (const name of [
        'production_web_current_traffic',
        'production_fulfillment_current_traffic',
        'production_worker_secret_names',
        'production_fulfillment_secret_names',
        'production_web_inert_bindings',
        'production_fulfillment_inert_bindings',
        'production_fulfillment_schedules',
        'production_queue_and_dlq_inventory',
    ]) {
        const check = exactlyOneByName(checks, 'name', name, 'inert runtime check', errors);
        if (check && check.status !== 'ok') errors.push(`inert runtime check is not ok: ${name}`);
    }

    const probes = arrayOfRecords(report.probes);
    validateCurrentDeploymentProbe(
        exactlyOneByName(probes, 'id', 'production_worker_status', 'inert runtime probe', errors),
        expectation.webVersionId,
        'production web',
        errors,
    );
    validateCurrentDeploymentProbe(
        exactlyOneByName(probes, 'id', 'production_fulfillment_status', 'inert runtime probe', errors),
        expectation.fulfillmentVersionId,
        'production fulfillment',
        errors,
    );
    validateExactSecretProbe(
        exactlyOneByName(probes, 'id', 'production_worker_secrets', 'inert runtime probe', errors),
        'production web',
        errors,
    );
    validateExactSecretProbe(
        exactlyOneByName(probes, 'id', 'production_fulfillment_secrets', 'inert runtime probe', errors),
        'production fulfillment',
        errors,
    );
    validateInertVersionProbe(
        exactlyOneByName(probes, 'id', 'production_worker_current_version', 'inert runtime probe', errors),
        'web',
        expectation.webWorker,
        expectation.webVersionId,
        expectation.fulfillmentWorker,
        errors,
    );
    validateInertVersionProbe(
        exactlyOneByName(probes, 'id', 'production_fulfillment_current_version', 'inert runtime probe', errors),
        'fulfillment',
        expectation.fulfillmentWorker,
        expectation.fulfillmentVersionId,
        expectation.fulfillmentWorker,
        errors,
    );

    const apiInventory = asRecord(report.apiInventory);
    const schedules = asRecord(apiInventory.fulfillmentSchedules);
    if (schedules.state !== 'ready') errors.push('production fulfillment schedule inventory is not ready');
    if (!Array.isArray(schedules.crons) || schedules.crons.length !== 0) {
        errors.push('production fulfillment Cron inventory must be exactly empty');
    }
    if (!Array.isArray(schedules.gaps) || schedules.gaps.length !== 0) {
        errors.push('production fulfillment schedule evidence gaps remain');
    }
    validateInertQueueInventory(
        apiInventory.queue,
        expectation.productionQueue,
        expectation.productionQueueId,
        'production Queue',
        errors,
    );
    validateInertQueueInventory(
        apiInventory.deadLetterQueue,
        expectation.productionDeadLetterQueue,
        expectation.productionDeadLetterQueueId,
        'production DLQ',
        errors,
    );
    if (!Array.isArray(apiInventory.gaps) || apiInventory.gaps.length !== 0) {
        errors.push('Cloudflare production API inventory gaps remain');
    }

    return {
        valid: errors.length === 0,
        errors: uniqueStrings(errors),
        evidenceTimestamp: base.evidenceTimestamp,
    };
}

export function validateCloudflareRuntimeCutoverPreflightSummary(
    value: unknown,
    target: Pick<CloudflareProductionEvidenceTarget, 'accountId' | 'productionWorker'>,
    now = new Date(),
    currentSourceIdentity = captureCloudflareProductionSourceIdentity(),
): CloudflareProductionEvidenceValidation {
    const errors: string[] = [];
    const report = asRecord(value);
    if (report.schemaVersion !== 1) errors.push('schemaVersion must be 1');
    validateReportStatus(report.status, errors);
    const generatedAt = stringValue(report.generatedAt) || null;
    validateFreshness(generatedAt, now, errors, 'generatedAt');
    if (report.remoteWritePerformed !== false) errors.push('remoteWritePerformed must be false');
    if (report.targetAccountId !== target.accountId) errors.push('targetAccountId mismatch');
    if (report.targetWorker !== target.productionWorker) errors.push('targetWorker mismatch');
    for (const name of [
        'checkoutEnabledFalseInConfig',
        'dryRunAfterBuildLooksSuccessful',
        'dryRunMentionsCheckoutFalse',
        'dryRunMentionsNoCustomDomains',
    ] as const) {
        if (report[name] !== true) errors.push(`${name} must be true`);
    }
    validateChecks(report.checks, cutoverPreflightCriticalChecks, errors);
    const captures = arrayOfRecords(report.captures);
    validateUniqueNames(captures, 'name', 'capture', errors);
    for (const capture of captures) {
        if (capture.status === 'failed') errors.push(`failed capture: ${stringValue(capture.name) || 'unnamed'}`);
    }
    errors.push(...validateCloudflareProductionSourceIdentity(report.sourceIdentity, currentSourceIdentity));
    return { valid: errors.length === 0, errors, evidenceTimestamp: generatedAt };
}

export function computeCloudflareProductionSourceSha256(
    files: readonly CloudflareProductionSourceFileIdentity[],
): string {
    return sourceIdentityAggregate(files);
}

function parseSourceIdentity(
    value: unknown,
    label: 'sourceIdentity' | 'currentSourceIdentity',
    errors: string[],
): CloudflareProductionSourceIdentity {
    const identity = asRecord(value);
    if (identity.schemaVersion !== 1) errors.push(`${label}.schemaVersion must be 1`);

    const gitHead = stringValue(identity.gitHead) || null;
    if (!gitHead || !GIT_HEAD_PATTERN.test(gitHead)) errors.push(`${label}.gitHead must be a Git SHA`);

    const gitWorktreeDirty = typeof identity.gitWorktreeDirty === 'boolean'
        ? identity.gitWorktreeDirty
        : null;
    if (gitWorktreeDirty === null) errors.push(`${label}.gitWorktreeDirty must be boolean`);

    const dirtyPaths = strictStringArray(identity.dirtyPaths, `${label}.dirtyPaths`, errors);
    const unhashedDirtyPaths = strictStringArray(
        identity.unhashedDirtyPaths,
        `${label}.unhashedDirtyPaths`,
        errors,
    );
    validateCanonicalStringArray(dirtyPaths, `${label}.dirtyPaths`, errors);
    validateCanonicalStringArray(unhashedDirtyPaths, `${label}.unhashedDirtyPaths`, errors);
    if (gitWorktreeDirty !== null && gitWorktreeDirty !== (dirtyPaths.length > 0)) {
        errors.push(`${label}.gitWorktreeDirty disagrees with dirtyPaths`);
    }

    const rawFiles = Array.isArray(identity.files) ? identity.files : [];
    if (!Array.isArray(identity.files)) errors.push(`${label}.files must be an array`);
    const files = rawFiles.map((file) => {
        const record = asRecord(file);
        return { path: stringValue(record.path), sha256: stringValue(record.sha256) };
    });
    const filePaths = files.map((file) => file.path);
    const canonicalPaths = [...CLOUDFLARE_PRODUCTION_SOURCE_IDENTITY_PATHS];
    if (!sameStringArray(filePaths, canonicalPaths)) {
        errors.push(`${label}.files path order does not match canonical allowlist`);
    }
    const duplicatePaths = duplicateStrings(filePaths);
    if (duplicatePaths.length > 0) errors.push(`${label}.files contains duplicate path`);
    for (const file of files) {
        if (!file.path) errors.push(`${label}.files contains a missing path`);
        if (!SHA256_PATTERN.test(file.sha256)) errors.push(`${label}.files contains an invalid SHA-256`);
    }

    const sourceSha256 = stringValue(identity.sourceSha256);
    if (!SHA256_PATTERN.test(sourceSha256)) errors.push(`${label}.sourceSha256 must be SHA-256`);
    if (sourceSha256 !== sourceIdentityAggregate(files)) {
        errors.push(`${label}.sourceSha256 does not match files`);
    }

    const hashedPaths = new Set(filePaths);
    const calculatedUnhashedDirtyPaths = dirtyPaths.filter((filePath) => !hashedPaths.has(filePath));
    if (!sameStringArray(unhashedDirtyPaths, calculatedUnhashedDirtyPaths)) {
        errors.push(`${label}.unhashedDirtyPaths does not match dirtyPaths/files`);
    }
    if (unhashedDirtyPaths.length > 0) {
        errors.push(label === 'sourceIdentity'
            ? 'sourceIdentity contains unhashed dirty paths'
            : 'current source identity contains unhashed dirty paths');
    }

    return {
        schemaVersion: 1,
        gitHead,
        gitWorktreeDirty,
        dirtyPaths,
        unhashedDirtyPaths,
        sourceSha256,
        files,
    };
}

function validateWorkerAbsentOrExactlyNeutralized(
    worker: Record<string, unknown> | null,
    name: string,
    errors: string[],
): void {
    if (!worker) return;
    if (worker.present === false) return;
    if (worker.present !== true) {
        errors.push(`flagged Worker presence is ambiguous: ${name}`);
        return;
    }

    if (worker.scheduleState !== 'ready') errors.push(`flagged Worker schedules are ambiguous: ${name}`);
    if (!Array.isArray(worker.crons)) errors.push(`flagged Worker Cron evidence is missing: ${name}`);
    else if (stringArray(worker.crons).length !== 0) errors.push(`flagged Worker Cron remains active: ${name}`);
    if (worker.subdomainState !== 'ready') errors.push(`flagged Worker subdomain is ambiguous: ${name}`);
    if (worker.workersDevEnabled !== false) errors.push(`flagged Worker workers.dev remains enabled or ambiguous: ${name}`);
    if (worker.previewsEnabled !== false) errors.push(`flagged Worker previews remain enabled or ambiguous: ${name}`);

    const surfaces = asRecord(worker.invocationSurfaces);
    if (surfaces.state !== 'ready') errors.push(`flagged Worker invocation surfaces are ambiguous: ${name}`);
    for (const field of [
        'customDomains',
        'workerRoutes',
        'queueConsumers',
        'inboundServiceBindings',
        'inboundTailConsumerReferences',
        'emailRoutingReferences',
    ] as const) {
        if (surfaces[field] !== 0) errors.push(`flagged Worker ${field} must be zero: ${name}`);
    }
    if (!Array.isArray(worker.gaps) || worker.gaps.length !== 0) {
        errors.push(`flagged Worker evidence gaps remain: ${name}`);
    }
}

function validateLegacyHeadDeploymentPosture(value: Record<string, unknown>, errors: string[]): void {
    if (value.state !== 'ready') errors.push('legacy Worker HEAD deployment posture is not ready');
    if (!Array.isArray(value.trackedLegacyPackagePaths) || value.trackedLegacyPackagePaths.length !== 0) {
        errors.push('legacy Worker package remains tracked in HEAD');
    }
    if (value.workingTreePackagePresent !== false) errors.push('legacy Worker package remains in the working tree');
    if (!Array.isArray(value.automaticDeployReferences) || value.automaticDeployReferences.length !== 0) {
        errors.push('legacy Worker automatic deployment reference remains in HEAD');
    }
    if (!Array.isArray(value.gaps) || value.gaps.length !== 0) {
        errors.push('legacy Worker HEAD deployment evidence gaps remain');
    }
}

function validateCurrentDeploymentProbe(
    probe: Record<string, unknown> | null,
    expectedVersionId: string,
    label: string,
    errors: string[],
): void {
    if (!probe) return;
    if (probe.status !== 'ok' || probe.exitCode !== 0) errors.push(`${label} status probe is not an exact success`);
    const summary = asRecord(probe.summary);
    if (summary.state !== 'ready') errors.push(`${label} deployment state is not ready`);
    if (summary.primaryVersionId !== expectedVersionId) errors.push(`${label} primary version mismatch`);
    if (summary.notFound !== false || summary.errorPreview !== null) {
        errors.push(`${label} deployment status is missing or ambiguous`);
    }
    const currentVersions = arrayOfRecords(summary.currentVersions);
    if (currentVersions.length !== 1
        || currentVersions[0]?.versionId !== expectedVersionId
        || currentVersions[0]?.percentage !== 100) {
        errors.push(`${label} traffic must be exactly 100% on the immutable HMAC version`);
    }
}

function validateExactSecretProbe(
    probe: Record<string, unknown> | null,
    label: string,
    errors: string[],
): void {
    if (!probe) return;
    if (probe.status !== 'ok' || probe.exitCode !== 0) errors.push(`${label} secret probe is not an exact success`);
    const summary = asRecord(probe.summary);
    const names = strictStringArray(summary.names, `${label} secret names`, errors);
    if (summary.count !== productionBootstrapSecretNames.length
        || !sameStringArray(names, productionBootstrapSecretNames)) {
        errors.push(`${label} secrets must be exactly ${productionBootstrapSecretNames.join(',')}`);
    }
    if (summary.notFound !== false || summary.errorPreview !== null) {
        errors.push(`${label} secret inventory is missing or ambiguous`);
    }
}

function validateInertVersionProbe(
    probe: Record<string, unknown> | null,
    kind: 'web' | 'fulfillment',
    expectedWorker: string,
    expectedVersionId: string,
    expectedFulfillmentWorker: string,
    errors: string[],
): void {
    if (!probe) return;
    const label = `production ${kind}`;
    if (probe.status !== 'ok' || probe.exitCode !== 0) errors.push(`${label} version probe is not an exact success`);
    const summary = asRecord(probe.summary);
    if (summary.state !== 'ready' || summary.versionId !== expectedVersionId) {
        errors.push(`${label} version readback does not match the immutable HMAC version`);
    }
    if (summary.notFound !== false || summary.errorPreview !== null || summary.rawBindingValuesStored !== false) {
        errors.push(`${label} version readback is missing, ambiguous or stored raw binding values`);
    }

    const bindingNames = strictStringArray(summary.bindingNames, `${label} bindingNames`, errors);
    const expectedBindingTypes = productionBootstrapVersionBindingTypes[kind];
    const expectedBindingNames = Object.keys(expectedBindingTypes);
    if (!sameStringArray(bindingNames, expectedBindingNames)) {
        errors.push(`${label} binding inventory does not match the exact inert bootstrap allowlist`);
    }
    validateExactBindingTypes(summary.bindings, expectedBindingTypes, label, errors);
    for (const bindingError of productionInertBindingNameErrors(kind, bindingNames)) {
        errors.push(`${label} binding inventory: ${bindingError}`);
    }

    const safeValues = asRecord(summary.safeValues);
    const expectedSafeValues: Record<string, string> = kind === 'web'
        ? {
            CHECKOUT_ENABLED: 'false',
            CHECKOUT_ENABLED_OVERRIDE: 'false',
            EMAIL_DAILY_RECIPIENT_LIMIT: '0',
            EMAIL_DELIVERY_MODE: 'disabled',
            EMAIL_MONTHLY_RECIPIENT_LIMIT: '0',
            NODE_ENV: 'production',
            PUBLIC_APP_ENV: 'production',
            SENTRY_ENVIRONMENT: 'production-bootstrap',
            WEB_RUNTIME_MODE: 'bootstrap',
            WORKER_IDENTITY: expectedWorker,
        }
        : {
            CHECKOUT_ENABLED: 'false',
            CHECKOUT_ENABLED_OVERRIDE: 'false',
            EMAIL_DAILY_RECIPIENT_LIMIT: '0',
            EMAIL_DELIVERY_MODE: 'disabled',
            EMAIL_MONTHLY_RECIPIENT_LIMIT: '0',
            FULFILLMENT_RUNTIME_MODE: 'bootstrap',
            NODE_ENV: 'production',
            PUBLIC_APP_ENV: 'production',
            WORKER_IDENTITY: expectedWorker,
        };
    validateExactStringRecord(safeValues, expectedSafeValues, `${label} safeValues`, errors);
    const safeTargets = asRecord(summary.safeTargets);
    validateExactStringRecord(
        safeTargets,
        kind === 'web' ? { FULFILLMENT_SERVICE: expectedFulfillmentWorker } : {},
        `${label} safeTargets`,
        errors,
    );
}

function validateExactBindingTypes(
    value: unknown,
    expectedTypes: Record<string, string>,
    label: string,
    errors: string[],
): void {
    if (!Array.isArray(value)) {
        errors.push(`${label} bindings must be an exact projected array`);
        return;
    }
    const projected = value.flatMap((entry) => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
        const binding = entry as Record<string, unknown>;
        return typeof binding.name === 'string' && typeof binding.type === 'string'
            ? [{ name: binding.name, type: binding.type }]
            : [];
    });
    if (projected.length !== value.length) {
        errors.push(`${label} bindings contain a malformed name/type projection`);
        return;
    }
    const names = projected.map((binding) => binding.name);
    if (new Set(names).size !== names.length) errors.push(`${label} bindings contain duplicate names`);
    const expectedNames = Object.keys(expectedTypes);
    if (!sameStringArray(names, expectedNames)) {
        errors.push(`${label} binding type inventory does not match the exact inert bootstrap allowlist`);
    }
    for (const [name, expectedType] of Object.entries(expectedTypes)) {
        const matches = projected.filter((binding) => binding.name === name);
        if (matches.length !== 1 || matches[0]?.type !== expectedType) {
            errors.push(`${label} binding ${name} must have type ${expectedType}`);
        }
    }
}

function validateInertQueueInventory(
    value: unknown,
    expectedName: string,
    expectedId: string,
    label: string,
    errors: string[],
): void {
    const queue = asRecord(value);
    if (queue.state !== 'ready' || queue.name !== expectedName || queue.id !== expectedId) {
        errors.push(`${label} identity or state mismatch`);
    }
    const settings = asRecord(queue.settings);
    if (settings.delivery_paused !== false
        || settings.delivery_delay !== 0
        || settings.message_retention_period !== 86_400) {
        errors.push(`${label} settings do not match the proven inert inventory`);
    }
    if (!Array.isArray(queue.producers) || queue.producers.length !== 0
        || !Array.isArray(queue.consumers) || queue.consumers.length !== 0) {
        errors.push(`${label} must have zero producers and zero consumers`);
    }
    if (queue.backlogAvailable !== true || queue.backlog !== 0) {
        errors.push(`${label} backlog must be proven as zero`);
    }
    if (!Array.isArray(queue.gaps) || queue.gaps.length !== 0) {
        errors.push(`${label} evidence gaps remain`);
    }
}

function validateExactStringRecord(
    actual: Record<string, unknown>,
    expected: Record<string, string>,
    label: string,
    errors: string[],
): void {
    const actualKeys = Object.keys(actual).sort();
    const expectedKeys = Object.keys(expected).sort();
    if (!sameStringArray(actualKeys, expectedKeys)
        || expectedKeys.some((key) => actual[key] !== expected[key])) {
        errors.push(`${label} does not match the exact inert bootstrap values`);
    }
}

function validateReportStatus(value: unknown, errors: string[]): void {
    if (value === 'FAILED') errors.push('report status is FAILED');
    else if (value !== 'OK' && value !== 'WARNING') errors.push('report status is invalid');
}

function validateFreshness(value: string | null, now: Date, errors: string[], field: string): void {
    const timestamp = value ? Date.parse(value) : Number.NaN;
    const age = now.getTime() - timestamp;
    if (!Number.isFinite(timestamp)) errors.push(`${field} is invalid`);
    else if (age < -FUTURE_CLOCK_SKEW_MS) errors.push(`${field} is in the future`);
    else if (age > CLOUDFLARE_PRODUCTION_EVIDENCE_MAX_AGE_MS) errors.push(`${field} is stale`);
}

function validateChecks(
    value: unknown,
    criticalNames: readonly string[],
    errors: string[],
): Array<{ name: string; status: string; message: string }> {
    const checks = arrayOfRecords(value).map((check) => ({
        name: stringValue(check.name),
        status: stringValue(check.status),
        message: stringValue(check.message),
    }));
    validateUniqueNames(checks, 'name', 'check', errors);
    for (const check of checks) {
        if (check.status === 'failed') errors.push(`failed check: ${check.name || 'unnamed'}`);
    }
    for (const name of criticalNames) {
        const matches = checks.filter((check) => check.name === name);
        if (matches.length !== 1) errors.push(`critical check count invalid: ${name}`);
        else if (matches[0].status !== 'ok') errors.push(`critical check is not ok: ${name}`);
    }
    return checks;
}

function validateUniqueNames(
    values: Array<Record<string, unknown> | { name: string }>,
    key: string,
    label: string,
    errors: string[],
): void {
    const names = values.map((value) => stringValue((value as Record<string, unknown>)[key]));
    if (names.some((name) => !name)) errors.push(`${label} name missing`);
    const duplicates = [...new Set(names.filter((name, index) => name && names.indexOf(name) !== index))];
    for (const duplicate of duplicates) errors.push(`duplicate ${label}: ${duplicate}`);
}

function exactlyOneByName(
    values: Record<string, unknown>[],
    key: string,
    expected: string,
    label: string,
    errors: string[],
): Record<string, unknown> | null {
    const matches = values.filter((value) => stringValue(value[key]) === expected);
    if (matches.length !== 1) {
        errors.push(`${label} count invalid: ${expected}`);
        return null;
    }
    return matches[0];
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
    return left.length === right.length && left.every((value) => right.includes(value));
}

function sameStringArray(left: readonly string[], right: readonly string[]): boolean {
    return left.length === right.length && left.every((value, index) => value === right[index]);
}

function strictStringArray(value: unknown, label: string, errors: string[]): string[] {
    if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
        errors.push(`${label} must be a string array`);
        return [];
    }
    return value as string[];
}

function validateCanonicalStringArray(value: string[], label: string, errors: string[]): void {
    if (duplicateStrings(value).length > 0) errors.push(`${label} contains duplicates`);
    if (!sameStringArray(value, [...value].sort())) errors.push(`${label} must be sorted`);
}

function duplicateStrings(value: readonly string[]): string[] {
    return [...new Set(value.filter((item, index) => value.indexOf(item) !== index))];
}

function sourceIdentityAggregate(files: readonly CloudflareProductionSourceFileIdentity[]): string {
    return sha256(files.map((file) => `${file.path}\0${file.sha256}`).join('\n'));
}

function parseGitPorcelainPaths(value: string): string[] {
    return value
        .split(/\r?\n/u)
        .map((line) => line.trimEnd())
        .filter(Boolean)
        .flatMap((line) => {
            const status = line.slice(0, 2);
            const rawPath = line.slice(3).trim();
            if (!rawPath) return [];
            const destination = rawPath.includes(' -> ') ? rawPath.split(' -> ').at(-1) ?? rawPath : rawPath;
            const filePath = toPosix(destination.replace(/^"|"$/gu, ''));
            if (status === '??' && CLOUDFLARE_PRODUCTION_SOURCE_IDENTITY_EXCLUDED_UNTRACKED_PATHS
                .some((excludedPath) => excludedPath === filePath)) return [];
            return [filePath];
        })
        .sort();
}

function sha256(value: string): string {
    return createHash('sha256').update(value).digest('hex');
}

function toPosix(filePath: string): string {
    return filePath.split(path.sep).join('/');
}

function uniqueStrings(value: readonly string[]): string[] {
    return [...new Set(value)];
}

function arrayOfRecords(value: unknown): Record<string, unknown>[] {
    return Array.isArray(value) ? value.map(asRecord) : [];
}

function stringArray(value: unknown): string[] {
    return Array.isArray(value) ? value.map(stringValue).filter(Boolean) : [];
}

function asRecord(value: unknown): Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}

function stringValue(value: unknown): string {
    return typeof value === 'string' ? value : '';
}
