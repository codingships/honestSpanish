import { parseMixedJsonOutput } from '../ci/verify-cloudflare-identity';
import { PRODUCTION_QUEUE_TARGET } from './cloudflare-production-queue-shared';

type JsonRecord = Record<string, unknown>;
export type ProductionQueueRuntimeMode = 'active' | 'bootstrap';
export type ExistingCloudflareWorkerState = 'absent' | 'present' | 'unknown';

export interface CloudflareWorkerPresenceRead {
    succeeded: boolean;
    explicitlyNotFound: boolean;
}

export interface ProductionQueueRuntimeReadbackInput {
    inventoryRows: unknown[];
    queueDetail: unknown;
    queueMetrics: unknown;
    deadLetterQueueDetail: unknown;
    deadLetterQueueMetrics: unknown;
    expectedMode: ProductionQueueRuntimeMode;
}

export interface ProductionQueueRuntimeValidation {
    ok: boolean;
    errors: string[];
    queueId: string | null;
    deadLetterQueueId: string | null;
}

export function classifyExistingCloudflareWorkerState(
    deployments: CloudflareWorkerPresenceRead,
    secretInventory: CloudflareWorkerPresenceRead,
): ExistingCloudflareWorkerState {
    const absent = !deployments.succeeded
        && deployments.explicitlyNotFound
        && !secretInventory.succeeded
        && secretInventory.explicitlyNotFound;
    if (absent) return 'absent';
    const present = deployments.succeeded
        && !deployments.explicitlyNotFound
        && secretInventory.succeeded
        && !secretInventory.explicitlyNotFound;
    return present ? 'present' : 'unknown';
}

function asRecord(value: unknown): JsonRecord {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value as JsonRecord
        : {};
}

function asArray(value: unknown): unknown[] {
    return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown): string {
    return typeof value === 'string' ? value : '';
}

function queueName(value: JsonRecord): string {
    return stringValue(value.queue_name) || stringValue(value.name);
}

function queueId(value: JsonRecord): string | null {
    const valueId = stringValue(value.queue_id) || stringValue(value.id);
    return /^[0-9a-f]{32}$/iu.test(valueId) ? valueId : null;
}

function partyWorkerName(value: unknown): string {
    const party = asRecord(value);
    const settings = asRecord(party.settings);
    return stringValue(party.script)
        || stringValue(party.script_name)
        || stringValue(party.worker)
        || stringValue(party.worker_name)
        || stringValue(settings.script)
        || stringValue(settings.script_name);
}

function partySettings(value: unknown): JsonRecord {
    const party = asRecord(value);
    return { ...asRecord(party.settings), ...party };
}

function deadLetterQueueName(value: unknown): string {
    if (typeof value === 'string') return value;
    return queueName(asRecord(value));
}

function validateDetailIdentity(
    label: string,
    detail: JsonRecord,
    expectedName: string,
    expectedId: string | null,
    errors: string[],
): void {
    if (!expectedId) {
        errors.push(`${label} inventory ID is missing or invalid.`);
        return;
    }
    if (queueId(detail) !== expectedId || queueName(detail) !== expectedName) {
        errors.push(`${label} detail identity does not match its exact inventory resource.`);
    }
    const producers = asArray(detail.producers);
    const consumers = asArray(detail.consumers);
    if (detail.producers_total_count !== producers.length) {
        errors.push(`${label} producer count is absent or inconsistent.`);
    }
    if (detail.consumers_total_count !== consumers.length) {
        errors.push(`${label} consumer count is absent or inconsistent.`);
    }
    if (asRecord(detail.settings).delivery_paused !== false) {
        errors.push(`${label} delivery_paused must be explicitly false.`);
    }
}

function validateZeroBacklog(label: string, value: unknown, errors: string[]): void {
    if (asRecord(value).backlog_count !== 0) {
        errors.push(`${label} backlog_count must be exactly zero.`);
    }
}

export function validateProductionQueueRuntimeReadback(
    input: ProductionQueueRuntimeReadbackInput,
): ProductionQueueRuntimeValidation {
    const errors: string[] = [];
    const rows = input.inventoryRows.map(asRecord);
    const queueMatches = rows.filter((row) => queueName(row) === PRODUCTION_QUEUE_TARGET.queue);
    const deadLetterQueueMatches = rows.filter((row) => queueName(row) === PRODUCTION_QUEUE_TARGET.deadLetterQueue);
    if (queueMatches.length !== 1) errors.push(`Primary Queue exact-name count must be one; observed ${queueMatches.length}.`);
    if (deadLetterQueueMatches.length !== 1) errors.push(`DLQ exact-name count must be one; observed ${deadLetterQueueMatches.length}.`);
    const primaryId = queueMatches.length === 1 ? queueId(queueMatches[0]) : null;
    const dlqId = deadLetterQueueMatches.length === 1 ? queueId(deadLetterQueueMatches[0]) : null;
    const primary = asRecord(input.queueDetail);
    const dlq = asRecord(input.deadLetterQueueDetail);

    validateDetailIdentity('Primary Queue', primary, PRODUCTION_QUEUE_TARGET.queue, primaryId, errors);
    validateDetailIdentity('DLQ', dlq, PRODUCTION_QUEUE_TARGET.deadLetterQueue, dlqId, errors);
    validateZeroBacklog('Primary Queue', input.queueMetrics, errors);
    validateZeroBacklog('DLQ', input.deadLetterQueueMetrics, errors);

    const primaryProducers = asArray(primary.producers);
    const primaryConsumers = asArray(primary.consumers);
    const dlqProducers = asArray(dlq.producers);
    const dlqConsumers = asArray(dlq.consumers);
    if (dlqProducers.length !== 0 || dlqConsumers.length !== 0) {
        errors.push('DLQ must not have a producer or consumer attachment.');
    }

    if (input.expectedMode === 'bootstrap') {
        if (primaryProducers.length !== 0 || primaryConsumers.length !== 0) {
            errors.push('Bootstrap compensation must detach every primary Queue producer and consumer.');
        }
    } else {
        const expectedWorker = PRODUCTION_QUEUE_TARGET.worker;
        if (primaryProducers.length !== 1 || partyWorkerName(primaryProducers[0]) !== expectedWorker) {
            errors.push('Active primary Queue must have exactly the production fulfillment Worker as producer.');
        }
        if (primaryConsumers.length !== 1 || partyWorkerName(primaryConsumers[0]) !== expectedWorker) {
            errors.push('Active primary Queue must have exactly the production fulfillment Worker as consumer.');
        }
        const settings = partySettings(primaryConsumers[0]);
        const expectedSettings: Array<[string, unknown]> = [
            ['batch_size', 1],
            ['max_wait_time_ms', 1_000],
            ['max_retries', 5],
            ['max_concurrency', 1],
            ['retry_delay', 30],
        ];
        for (const [name, expected] of expectedSettings) {
            if (settings[name] !== expected) errors.push(`Active Queue consumer ${name} must be ${String(expected)}.`);
        }
        if (deadLetterQueueName(settings.dead_letter_queue) !== PRODUCTION_QUEUE_TARGET.deadLetterQueue) {
            errors.push('Active Queue consumer must target the exact production DLQ.');
        }
    }

    return { ok: errors.length === 0, errors, queueId: primaryId, deadLetterQueueId: dlqId };
}

export function validateProductionQueueVersionBinding(
    source: string,
    expectedVersionId: string,
    expectedMode: ProductionQueueRuntimeMode,
): { ok: boolean; errors: string[] } {
    const errors: string[] = [];
    let parsed: unknown;
    try {
        parsed = parseMixedJsonOutput(source);
    } catch {
        return { ok: false, errors: ['Version view is not valid structured JSON.'] };
    }
    const version = asRecord(parsed);
    if (version.id !== expectedVersionId) errors.push('Version view does not match the exact deployed version.');
    const bindings = asArray(asRecord(version.resources).bindings).map(asRecord);
    const queueBindings = bindings.filter((binding) => binding.name === 'FULFILLMENT_QUEUE');
    if (expectedMode === 'bootstrap') {
        if (queueBindings.length !== 0) errors.push('Bootstrap version must not contain FULFILLMENT_QUEUE.');
    } else {
        if (queueBindings.length !== 1) {
            errors.push(`Active version must contain one FULFILLMENT_QUEUE binding; observed ${queueBindings.length}.`);
        } else {
            const binding = queueBindings[0];
            const targetName = stringValue(binding.queue_name)
                || stringValue(binding.queue)
                || stringValue(binding.target)
                || queueName(asRecord(binding.resource));
            if (targetName !== PRODUCTION_QUEUE_TARGET.queue) {
                errors.push('FULFILLMENT_QUEUE does not target the exact production Queue.');
            }
        }
    }
    return { ok: errors.length === 0, errors };
}
