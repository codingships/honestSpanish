export const PRODUCTION_QUEUE_TARGET = {
    accountId: 'd1a22bcf6477ff2ff31d2bfb83084e44',
    config: 'workers/fulfillment/wrangler.toml',
    worker: 'espanol-honesto-fulfillment-production',
    queue: 'espanol-honesto-fulfillment-production-queue',
    deadLetterQueue: 'espanol-honesto-fulfillment-production-dlq',
    binding: 'FULFILLMENT_QUEUE',
} as const;

export const PRODUCTION_QUEUE_APPROVAL_ENV = 'CLOUDFLARE_PRODUCTION_QUEUE_PROVISION_APPROVAL';

export const PRODUCTION_QUEUE_APPROVAL_SENTENCE =
    'Autorizo crear unicamente las Cloudflare Queues `espanol-honesto-fulfillment-production-dlq` primero y `espanol-honesto-fulfillment-production-queue` despues, en la cuenta `d1a22bcf6477ff2ff31d2bfb83084e44`; autorizo solo la verificacion read-only posterior. No autorizo desplegar Workers, anadir consumidores manuales, tocar staging, otras Queues, secretos, Supabase, Stripe, Google, Resend, DNS, dominios ni Pages.';

export interface QueueInventory {
    queueCount: number;
    deadLetterQueueCount: number;
    queueExists: boolean;
    deadLetterQueueExists: boolean;
    clearForProvision: boolean;
}

export interface ConfigValidation {
    valid: boolean;
    errors: string[];
}

export function classifyQueueInventory(output: string): QueueInventory {
    const sanitized = stripAnsi(output);
    const queueCount = countOccurrences(sanitized, PRODUCTION_QUEUE_TARGET.queue);
    const deadLetterQueueCount = countOccurrences(sanitized, PRODUCTION_QUEUE_TARGET.deadLetterQueue);
    return {
        queueCount,
        deadLetterQueueCount,
        queueExists: queueCount > 0,
        deadLetterQueueExists: deadLetterQueueCount > 0,
        clearForProvision: queueCount === 0 && deadLetterQueueCount === 0,
    };
}

export function queueRowsInPage(output: string): number {
    return stripAnsi(output).match(/[│|]\s*[0-9a-f]{32}\s*[│|]/giu)?.length ?? 0;
}

export function validateProductionQueueConfig(source: string): ConfigValidation {
    const errors: string[] = [];
    const staging = sliceSection(source, '[env.staging]', '[env.production_bootstrap]');
    const bootstrap = sliceSection(source, '[env.production_bootstrap]', '[env.production]');
    const production = sliceSection(source, '[env.production]', null);
    const beforeStaging = source.slice(0, source.indexOf('[env.staging]'));

    if (!staging) errors.push('missing env.staging section');
    if (!bootstrap) errors.push('missing env.production_bootstrap section');
    if (!production) errors.push('missing env.production section');

    for (const [label, section] of [
        ['base', beforeStaging],
        ['staging', staging],
        ['production_bootstrap', bootstrap],
    ] as const) {
        for (const forbidden of [
            PRODUCTION_QUEUE_TARGET.queue,
            PRODUCTION_QUEUE_TARGET.deadLetterQueue,
            'env.production.queues.producers',
            'env.production.queues.consumers',
        ]) {
            if (section.includes(forbidden)) errors.push(`${label} contains forbidden production Queue scope: ${forbidden}`);
        }
    }

    for (const forbidden of ['queues.producers', 'queues.consumers', PRODUCTION_QUEUE_TARGET.binding]) {
        if (bootstrap.includes(forbidden)) errors.push(`production_bootstrap contains forbidden Queue binding/consumer: ${forbidden}`);
    }

    const requiredProduction = [
        '[[env.production.queues.producers]]',
        `binding = "${PRODUCTION_QUEUE_TARGET.binding}"`,
        `queue = "${PRODUCTION_QUEUE_TARGET.queue}"`,
        '[[env.production.queues.consumers]]',
        'max_batch_size = 1',
        'max_batch_timeout = 1',
        'max_retries = 5',
        `dead_letter_queue = "${PRODUCTION_QUEUE_TARGET.deadLetterQueue}"`,
        'max_concurrency = 1',
        'retry_delay = 30',
    ];
    for (const required of requiredProduction) {
        if (!production.includes(required)) errors.push(`env.production missing: ${required}`);
    }

    if (countOccurrences(source, PRODUCTION_QUEUE_TARGET.queue) !== 2) {
        errors.push('production queue name must appear exactly twice (producer and consumer)');
    }
    if (countOccurrences(source, PRODUCTION_QUEUE_TARGET.deadLetterQueue) !== 1) {
        errors.push('production DLQ name must appear exactly once (consumer dead_letter_queue)');
    }
    if (countOccurrences(source, '[[env.production.queues.producers]]') !== 1) {
        errors.push('env.production must define exactly one Queue producer');
    }
    if (countOccurrences(source, '[[env.production.queues.consumers]]') !== 1) {
        errors.push('env.production must define exactly one Queue consumer');
    }

    const producerIndex = production.indexOf('[[env.production.queues.producers]]');
    const consumerIndex = production.indexOf('[[env.production.queues.consumers]]');
    if (producerIndex < 0 || consumerIndex < 0 || producerIndex >= consumerIndex) {
        errors.push('env.production Queue producer must precede its consumer');
    }

    return { valid: errors.length === 0, errors };
}

export function stripAnsi(value: string): string {
    const escape = String.fromCharCode(27);
    return value.replace(new RegExp(`${escape}\\[[0-?]*[ -/]*[@-~]`, 'gu'), '');
}

function countOccurrences(source: string, needle: string): number {
    if (!needle) return 0;
    let count = 0;
    let cursor = 0;
    while (true) {
        const index = source.indexOf(needle, cursor);
        if (index < 0) return count;
        count += 1;
        cursor = index + needle.length;
    }
}

function sliceSection(source: string, start: string, end: string | null): string {
    const startIndex = source.indexOf(start);
    if (startIndex < 0) return '';
    const endIndex = end ? source.indexOf(end, startIndex + start.length) : -1;
    return source.slice(startIndex, endIndex >= 0 ? endIndex : undefined);
}
