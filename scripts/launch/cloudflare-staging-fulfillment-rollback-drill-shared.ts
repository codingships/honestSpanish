import { createHash } from 'node:crypto';

export const STAGING_FULFILLMENT_ROLLBACK_TARGET = Object.freeze({
    accountId: 'd1a22bcf6477ff2ff31d2bfb83084e44',
    worker: 'espanol-honesto-fulfillment-staging',
    queue: 'espanol-honesto-fulfillment-staging-queue',
    queueId: 'b65c8b6e98b140c2b3de53a86d3fc36a',
    directUrl: 'https://espanol-honesto-fulfillment-staging.alindev95.workers.dev',
});

export const STAGING_FULFILLMENT_ROLLBACK_APPROVAL_ENV =
    'CLOUDFLARE_STAGING_FULFILLMENT_ROLLBACK_DRILL_APPROVAL';

export const EXPECTED_FULFILLMENT_HANDLERS = Object.freeze(['fetch', 'queue', 'scheduled']);

export const EXPECTED_STAGING_PLAIN_TEXT = Object.freeze({
    NODE_ENV: 'production',
    PUBLIC_APP_ENV: 'staging',
    SUPABASE_EXPECTED_PROJECT_REF: 'mzjyvmlxfpzdfdjzxxyj',
    WORKER_IDENTITY: 'espanol-honesto-fulfillment-staging',
    PUBLIC_SITE_URL: 'https://espanolhonesto-staging.alindev95.workers.dev',
    FULFILLMENT_RUNTIME_MODE: 'active',
    EMAIL_DELIVERY_MODE: 'allowlist',
    EMAIL_DAILY_RECIPIENT_LIMIT: '10',
    EMAIL_MONTHLY_RECIPIENT_LIMIT: '100',
    CHECKOUT_ENABLED: 'false',
    CHECKOUT_ENABLED_OVERRIDE: 'false',
});

export interface DeploymentVersion {
    versionId: string;
    percentage: number;
}

export interface Deployment {
    id: string;
    createdOn: string;
    versions: DeploymentVersion[];
}

export interface RollbackVersions {
    currentDeploymentId: string;
    currentVersionId: string;
    currentCreatedOn: string;
    previousDeploymentId: string;
    previousVersionId: string;
    previousCreatedOn: string;
}

export interface BindingShape {
    name: string;
    type: string;
}

export interface VersionShape {
    id: string;
    handlers: string[];
    bindings: BindingShape[];
    runtimePlainText: Record<string, string>;
}

export interface CompatibilityResult {
    compatible: boolean;
    errors: string[];
}

export interface HealthIdentity {
    httpStatus: number;
    ok: boolean;
    service: string;
    runtime: string;
    operationMode: string;
    workerIdentity: string;
}

export interface QueueDeliverySnapshot {
    schemaVersion: 1;
    source: 'cloudflare-api-readonly';
    capturedAt: string;
    accountId: string;
    queueId: string;
    queueName: string;
    deliveryPaused: boolean | 'absent_requires_normalization';
    producerWorkerNames: string[];
    consumerWorkerNames: string[];
    backlogMessages?: number;
}

export interface ApprovalSnapshotInput {
    versions: RollbackVersions;
    currentShape: VersionShape;
    previousShape: VersionShape;
    health: HealthIdentity;
    queue: QueueDeliverySnapshot;
    cronSchedules: string[];
}

export function discoverRollbackVersions(statusValue: unknown, listValue: unknown): RollbackVersions {
    const status = parseDeployment(statusValue, 'current deployment status');
    requireSingleFullTrafficVersion(status, 'current deployment status');

    const history = asArray(listValue)
        .map((value, index) => parseDeployment(value, `deployment history[${index}]`))
        .sort((left, right) => Date.parse(right.createdOn) - Date.parse(left.createdOn));

    if (history.length < 2) {
        throw new Error('Deployment history must contain the current and an immediate previous deployment.');
    }

    const statusIndex = history.findIndex((deployment) => deployment.id === status.id);
    if (statusIndex !== 0) {
        throw new Error('Current deployment status is not the newest deployment in history.');
    }

    const previous = history[1];
    requireSingleFullTrafficVersion(previous, 'immediate previous deployment');

    const currentVersionId = status.versions[0].versionId;
    const previousVersionId = previous.versions[0].versionId;
    if (currentVersionId === previousVersionId) {
        throw new Error('Immediate previous deployment does not identify a distinct Worker version.');
    }

    return {
        currentDeploymentId: status.id,
        currentVersionId,
        currentCreatedOn: status.createdOn,
        previousDeploymentId: previous.id,
        previousVersionId,
        previousCreatedOn: previous.createdOn,
    };
}

export function parseVersionShape(value: unknown, expectedVersionId: string): VersionShape {
    const object = asRecord(value);
    const id = requiredString(object.id, 'Worker version id');
    if (id !== expectedVersionId) {
        throw new Error(`Worker version view returned unexpected id ${id}.`);
    }

    const resources = asRecord(object.resources);
    const script = asRecord(resources.script);
    const handlerValues = firstArray(script.handlers, resources.handlers, object.handlers);
    if (!handlerValues) throw new Error('Worker version view did not expose handler metadata.');
    const handlers = uniqueSorted(handlerValues.map((handler) => requiredString(handler, 'handler')));

    const bindings = asArray(resources.bindings).map((bindingValue, index) => {
        const binding = asRecord(bindingValue);
        return {
            name: requiredString(binding.name, `binding[${index}].name`),
            type: requiredString(binding.type, `binding[${index}].type`),
            plainText: plainTextValue(binding),
        };
    });
    if (bindings.length === 0) throw new Error('Worker version view did not expose binding metadata.');

    const names = bindings.map((binding) => binding.name);
    if (new Set(names).size !== names.length) throw new Error('Worker version view contains duplicate binding names.');

    const allowlistedPlainNames = new Set(Object.keys(EXPECTED_STAGING_PLAIN_TEXT));
    const runtimePlainText = Object.fromEntries(bindings
        .filter((binding) => binding.type === 'plain_text'
            && allowlistedPlainNames.has(binding.name)
            && binding.plainText !== undefined)
        .map((binding) => [binding.name, binding.plainText as string]));

    return {
        id,
        handlers,
        bindings: bindings
            .map(({ name, type }) => ({ name, type }))
            .sort(compareBinding),
        runtimePlainText,
    };
}

export function validateVersionCompatibility(current: VersionShape, previous: VersionShape): CompatibilityResult {
    const errors: string[] = [];
    const expectedHandlers = [...EXPECTED_FULFILLMENT_HANDLERS].sort();

    if (canonicalJson(current.handlers) !== canonicalJson(expectedHandlers)) {
        errors.push(`Current handler shape must be exactly ${expectedHandlers.join(',')}.`);
    }
    if (canonicalJson(previous.handlers) !== canonicalJson(expectedHandlers)) {
        errors.push(`Previous handler shape must be exactly ${expectedHandlers.join(',')}.`);
    }
    if (canonicalJson(current.handlers) !== canonicalJson(previous.handlers)) {
        errors.push('Current and previous handler shapes differ.');
    }
    if (canonicalJson(current.bindings) !== canonicalJson(previous.bindings)) {
        errors.push('Current and previous binding name/type shapes differ.');
    }

    for (const [versionLabel, shape] of [['current', current], ['previous', previous]] as const) {
        for (const [key, expected] of Object.entries(EXPECTED_STAGING_PLAIN_TEXT)) {
            const exposed = shape.runtimePlainText[key];
            if (exposed !== expected) {
                errors.push(`${versionLabel} ${key} must be present and exactly ${expected}.`);
            }
        }
    }

    return { compatible: errors.length === 0, errors };
}

export function validateHealthIdentity(health: HealthIdentity): string[] {
    const errors: string[] = [];
    if (health.httpStatus !== 200) errors.push('Health HTTP status is not 200.');
    if (!health.ok) errors.push('Health ok flag is not true.');
    if (health.service !== 'fulfillment-worker') errors.push('Health service identity is unexpected.');
    if (health.runtime !== 'cloudflare-workers') errors.push('Health runtime identity is unexpected.');
    if (health.operationMode !== 'active') errors.push('Health operation mode is not active.');
    if (health.workerIdentity !== STAGING_FULFILLMENT_ROLLBACK_TARGET.worker) {
        errors.push('Health Worker identity is unexpected.');
    }
    return errors;
}

export function buildApprovalSnapshot(input: ApprovalSnapshotInput): Record<string, unknown> {
    return {
        schemaVersion: 1,
        target: STAGING_FULFILLMENT_ROLLBACK_TARGET,
        current: {
            deploymentId: input.versions.currentDeploymentId,
            versionId: input.versions.currentVersionId,
            createdOn: input.versions.currentCreatedOn,
            handlers: input.currentShape.handlers,
            bindings: input.currentShape.bindings,
            runtimePlainText: input.currentShape.runtimePlainText,
        },
        previous: {
            deploymentId: input.versions.previousDeploymentId,
            versionId: input.versions.previousVersionId,
            createdOn: input.versions.previousCreatedOn,
            handlers: input.previousShape.handlers,
            bindings: input.previousShape.bindings,
            runtimePlainText: input.previousShape.runtimePlainText,
        },
        health: input.health,
        queue: {
            accountId: input.queue.accountId,
            queueId: input.queue.queueId,
            queueName: input.queue.queueName,
            deliveryPaused: input.queue.deliveryPaused,
            producerWorkerNames: input.queue.producerWorkerNames,
            consumerWorkerNames: input.queue.consumerWorkerNames,
            ...(input.queue.backlogMessages === undefined ? {} : { backlogMessages: input.queue.backlogMessages }),
        },
        cronSchedules: [...input.cronSchedules].sort(),
        drill: {
            rollbackTarget: input.versions.previousVersionId,
            mandatoryRestoreTarget: input.versions.currentVersionId,
            endpointsAllowed: [`${STAGING_FULFILLMENT_ROLLBACK_TARGET.directUrl}/health`],
            writesInOrder: [
                'disable exact staging Worker cron',
                'normalize exact staging Queue active',
                'pause exact staging Queue',
                'rollback previous',
                'restore current',
                'restore exact hourly cron',
                'resume exact staging Queue',
            ],
            conditionalCompensationWritesInOrder: [
                'if cron or queue restoration is unproven: disable exact staging Worker cron',
                'pause exact staging Queue',
            ],
            failClosedReadbacks: [
                'after restore_current failure: verify cron off, queue paused and backlog zero',
                'after compensation: verify cron off, queue paused and backlog zero',
            ],
        },
    };
}

export function snapshotSha256(snapshot: Record<string, unknown>): string {
    return createHash('sha256').update(canonicalJson(snapshot)).digest('hex');
}

export function exactRollbackApproval(versions: RollbackVersions, snapshotHash: string): string {
    return [
        'Autorizo el simulacro exacto de rollback del Cloudflare Fulfillment Worker staging',
        `account=${STAGING_FULFILLMENT_ROLLBACK_TARGET.accountId}`,
        `worker=${STAGING_FULFILLMENT_ROLLBACK_TARGET.worker}`,
        `current=${versions.currentVersionId}`,
        `previous=${versions.previousVersionId}`,
        `snapshot=${snapshotHash}`,
        `queue=${STAGING_FULFILLMENT_ROLLBACK_TARGET.queue}`,
        'normalize_queue_active=true',
        'disable_cron_before_rollback=true',
        'pause_before_rollback=true',
        'rollback_previous_then_restore_current=true',
        'restore_hourly_cron=true',
        'resume_after_restore=true',
        'verify_isolation_after_restore_current_failure=true',
        'compensate_incomplete_cron_or_queue_restore=cron_off_and_queue_paused',
        'compensation_readback=cron_off_queue_paused_backlog_zero',
        'checkout_must_remain_false=true',
        'production_and_other_resources=FORBIDDEN',
    ].join(' | ');
}

export function rollbackWranglerArgs(versionId: string): string[] {
    assertUuid(versionId, 'rollback version id');
    return ['rollback', versionId, '--name', STAGING_FULFILLMENT_ROLLBACK_TARGET.worker, '--yes'];
}

export function queueDeliveryWranglerArgs(action: 'pause' | 'resume'): string[] {
    return [
        'queues',
        action === 'pause' ? 'pause-delivery' : 'resume-delivery',
        STAGING_FULFILLMENT_ROLLBACK_TARGET.queue,
    ];
}

export function parseQueueDeliverySnapshot(
    value: unknown,
    now: Date,
    maximumAgeMs = 120_000,
    expectedPaused = false,
    notBefore?: Date,
): QueueDeliverySnapshot {
    const root = asRecord(value);
    const normalized = root.schemaVersion === 1 && root.source === 'cloudflare-api-readonly'
        ? root
        : normalizeCloudflareQueueApiSnapshot(root);
    const capturedAt = requiredString(normalized.capturedAt, 'queue snapshot capturedAt');
    const capturedTime = Date.parse(capturedAt);
    if (!Number.isFinite(capturedTime)) throw new Error('Queue snapshot capturedAt is invalid.');
    if (capturedTime > now.getTime() + 30_000) throw new Error('Queue snapshot capturedAt is in the future.');
    if (now.getTime() - capturedTime > maximumAgeMs) throw new Error('Queue snapshot is stale.');
    if (notBefore && capturedTime < notBefore.getTime()) {
        throw new Error('Queue snapshot predates the write it must verify.');
    }

    const accountId = requiredString(normalized.accountId, 'queue snapshot accountId');
    const queueId = requiredString(normalized.queueId, 'queue snapshot queueId');
    const queueName = requiredString(normalized.queueName, 'queue snapshot queueName');
    const deliveryPaused = normalized.deliveryPaused;
    if (typeof deliveryPaused !== 'boolean') throw new Error('Queue snapshot deliveryPaused is missing.');
    const producerWorkerNames = uniqueSorted(asArray(normalized.producerWorkerNames)
        .map((name) => requiredString(name, 'queue snapshot producer Worker name')));
    const consumerWorkerNames = uniqueSorted(asArray(normalized.consumerWorkerNames)
        .map((name) => requiredString(name, 'queue snapshot consumer Worker name')));

    if (accountId !== STAGING_FULFILLMENT_ROLLBACK_TARGET.accountId) {
        throw new Error('Queue snapshot account does not match the exact staging account.');
    }
    if (queueName !== STAGING_FULFILLMENT_ROLLBACK_TARGET.queue) {
        throw new Error('Queue snapshot does not describe the exact staging Queue.');
    }
    if (queueId !== STAGING_FULFILLMENT_ROLLBACK_TARGET.queueId) {
        throw new Error('Queue snapshot ID does not match the exact staging Queue.');
    }
    if (deliveryPaused !== expectedPaused) {
        throw new Error(`Queue delivery_paused must be ${String(expectedPaused)}.`);
    }
    if (canonicalJson(producerWorkerNames) !== canonicalJson([STAGING_FULFILLMENT_ROLLBACK_TARGET.worker])) {
        throw new Error('Queue snapshot must contain only the exact staging Fulfillment Worker producer.');
    }
    if (canonicalJson(consumerWorkerNames) !== canonicalJson([STAGING_FULFILLMENT_ROLLBACK_TARGET.worker])) {
        throw new Error('Queue snapshot must contain only the exact staging Fulfillment Worker consumer.');
    }

    const rawBacklogMessages = normalized.backlogMessages;
    if (rawBacklogMessages !== undefined
        && (typeof rawBacklogMessages !== 'number' || !Number.isInteger(rawBacklogMessages) || rawBacklogMessages !== 0)) {
        throw new Error('Queue snapshot backlogMessages, when supplied, must be the verified integer 0.');
    }
    const backlogMessages = typeof rawBacklogMessages === 'number' ? rawBacklogMessages : undefined;

    return {
        schemaVersion: 1,
        source: 'cloudflare-api-readonly',
        capturedAt,
        accountId,
        queueId,
        queueName,
        deliveryPaused,
        producerWorkerNames,
        consumerWorkerNames,
        ...(backlogMessages === undefined ? {} : { backlogMessages }),
    };
}

export function parseMixedWranglerJson(value: string): unknown {
    const sanitized = value.replace(/\u001b\[[0-9;]*m/gu, '').trim();
    try {
        return JSON.parse(sanitized);
    } catch {
        // Wrangler can surround --json output with informational lines. Extract
        // the first complete JSON object/array without trusting those lines.
    }

    for (let start = 0; start < sanitized.length; start += 1) {
        if (sanitized[start] !== '{' && sanitized[start] !== '[') continue;
        const end = matchingJsonEnd(sanitized, start);
        if (end === -1) continue;
        try {
            return JSON.parse(sanitized.slice(start, end + 1));
        } catch {
            // Continue looking for a later complete JSON value.
        }
    }
    throw new Error('Wrangler output did not contain a complete JSON object or array.');
}

export function canonicalJson(value: unknown): string {
    return JSON.stringify(sortRecursively(value));
}

function parseDeployment(value: unknown, label: string): Deployment {
    const object = asRecord(value);
    const id = requiredString(object.id, `${label} id`);
    const createdOn = requiredString(object.created_on, `${label} created_on`);
    if (!Number.isFinite(Date.parse(createdOn))) throw new Error(`${label} created_on is invalid.`);
    const versions = asArray(object.versions).map((versionValue, index) => {
        const version = asRecord(versionValue);
        const versionId = requiredString(version.version_id, `${label} versions[${index}].version_id`);
        assertUuid(versionId, `${label} version id`);
        const percentage = typeof version.percentage === 'number'
            ? version.percentage
            : Number(version.percentage);
        if (!Number.isFinite(percentage)) throw new Error(`${label} percentage is invalid.`);
        return { versionId, percentage };
    });
    return { id, createdOn, versions };
}

function requireSingleFullTrafficVersion(deployment: Deployment, label: string): void {
    if (deployment.versions.length !== 1 || deployment.versions[0].percentage !== 100) {
        throw new Error(`${label} must contain exactly one version at 100% traffic.`);
    }
}

function plainTextValue(binding: Record<string, unknown>): string | undefined {
    for (const key of ['text', 'value']) {
        if (typeof binding[key] === 'string') return binding[key] as string;
    }
    return undefined;
}

function normalizeCloudflareQueueApiSnapshot(root: Record<string, unknown>): Record<string, unknown> {
    const result = root.result;
    const candidates = Array.isArray(result) ? result : [result];
    const queue = candidates
        .map(asRecord)
        .find((candidate) => candidate.queue_name === STAGING_FULFILLMENT_ROLLBACK_TARGET.queue);
    if (!queue) throw new Error('Cloudflare Queue API snapshot does not contain the exact staging Queue.');
    const consumers = asArray(queue.consumers).map(asRecord);
    return {
        schemaVersion: 1,
        source: 'cloudflare-api-readonly',
        capturedAt: root.capturedAt,
        accountId: root.accountId,
        queueId: queue.queue_id,
        queueName: queue.queue_name,
        deliveryPaused: asRecord(queue.settings).delivery_paused,
        producerWorkerNames: asArray(queue.producers)
            .map(asRecord)
            .filter((producer) => producer.type === 'worker')
            .map((producer) => producer.script ?? producer.script_name),
        consumerWorkerNames: consumers
            .filter((consumer) => consumer.type === 'worker')
            .map((consumer) => consumer.script ?? consumer.script_name),
        backlogMessages: root.backlogMessages,
    };
}

function matchingJsonEnd(value: string, start: number): number {
    const stack: string[] = [];
    let quoted = false;
    let escaped = false;
    for (let index = start; index < value.length; index += 1) {
        const character = value[index];
        if (quoted) {
            if (escaped) escaped = false;
            else if (character === '\\') escaped = true;
            else if (character === '"') quoted = false;
            continue;
        }
        if (character === '"') {
            quoted = true;
            continue;
        }
        if (character === '{' || character === '[') stack.push(character);
        else if (character === '}' || character === ']') {
            const open = stack.pop();
            if ((open === '{' && character !== '}') || (open === '[' && character !== ']')) return -1;
            if (stack.length === 0) return index;
        }
    }
    return -1;
}

function compareBinding(left: BindingShape, right: BindingShape): number {
    return left.name.localeCompare(right.name) || left.type.localeCompare(right.type);
}

function uniqueSorted(values: string[]): string[] {
    return [...new Set(values)].sort();
}

function firstArray(...values: unknown[]): unknown[] | null {
    for (const value of values) if (Array.isArray(value)) return value;
    return null;
}

function asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}

function asArray(value: unknown): unknown[] {
    return Array.isArray(value) ? value : [];
}

function requiredString(value: unknown, label: string): string {
    if (typeof value !== 'string' || value.trim() === '') throw new Error(`${label} is missing.`);
    return value;
}

function assertUuid(value: string, label: string): void {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)) {
        throw new Error(`${label} is not a UUID.`);
    }
}

function sortRecursively(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(sortRecursively);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, sortRecursively(item)]));
}
