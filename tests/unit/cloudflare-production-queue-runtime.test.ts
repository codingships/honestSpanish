import { describe, expect, it } from 'vitest';
import {
    classifyExistingCloudflareWorkerState,
    validateProductionQueueRuntimeReadback,
    validateProductionQueueVersionBinding,
    type ProductionQueueRuntimeMode,
} from '../../scripts/launch/cloudflare-production-queue-runtime';
import { PRODUCTION_QUEUE_TARGET } from '../../scripts/launch/cloudflare-production-queue-shared';

const queueId = '11111111111141118111111111111111';
const dlqId = '22222222222242228222222222222222';
const versionId = '33333333-3333-4333-8333-333333333333';

function readback(mode: ProductionQueueRuntimeMode) {
    const active = mode === 'active';
    return {
        expectedMode: mode,
        inventoryRows: [
            { queue_id: queueId, queue_name: PRODUCTION_QUEUE_TARGET.queue },
            { queue_id: dlqId, queue_name: PRODUCTION_QUEUE_TARGET.deadLetterQueue },
        ],
        queueDetail: {
            queue_id: queueId,
            queue_name: PRODUCTION_QUEUE_TARGET.queue,
            producers_total_count: active ? 1 : 0,
            consumers_total_count: active ? 1 : 0,
            producers: active ? [{ script_name: PRODUCTION_QUEUE_TARGET.worker }] : [],
            consumers: active ? [{
                script_name: PRODUCTION_QUEUE_TARGET.worker,
                settings: {
                    batch_size: 1,
                    max_wait_time_ms: 1_000,
                    max_retries: 5,
                    max_concurrency: 1,
                    retry_delay: 30,
                    dead_letter_queue: PRODUCTION_QUEUE_TARGET.deadLetterQueue,
                },
            }] : [],
            settings: { delivery_paused: false },
        },
        queueMetrics: { backlog_count: 0 },
        deadLetterQueueDetail: {
            queue_id: dlqId,
            queue_name: PRODUCTION_QUEUE_TARGET.deadLetterQueue,
            producers_total_count: 0,
            consumers_total_count: 0,
            producers: [],
            consumers: [],
            settings: { delivery_paused: false },
        },
        deadLetterQueueMetrics: { backlog_count: 0 },
    };
}

function versionView(mode: ProductionQueueRuntimeMode): string {
    return JSON.stringify({
        id: versionId,
        resources: {
            bindings: mode === 'active'
                ? [{ name: 'FULFILLMENT_QUEUE', type: 'queue', queue_name: PRODUCTION_QUEUE_TARGET.queue }]
                : [{ name: 'CF_VERSION_METADATA', type: 'version_metadata' }],
        },
    });
}

describe('Cloudflare production Queue runtime readback', () => {
    it('classifies existing Worker state only from two mutually consistent exact reads', () => {
        expect(classifyExistingCloudflareWorkerState(
            { succeeded: false, explicitlyNotFound: true },
            { succeeded: false, explicitlyNotFound: true },
        )).toBe('absent');
        expect(classifyExistingCloudflareWorkerState(
            { succeeded: true, explicitlyNotFound: false },
            { succeeded: true, explicitlyNotFound: false },
        )).toBe('present');

        for (const [deployments, secrets] of [
            [{ succeeded: false, explicitlyNotFound: true }, { succeeded: true, explicitlyNotFound: false }],
            [{ succeeded: true, explicitlyNotFound: false }, { succeeded: false, explicitlyNotFound: true }],
            [{ succeeded: false, explicitlyNotFound: false }, { succeeded: false, explicitlyNotFound: false }],
            [{ succeeded: true, explicitlyNotFound: true }, { succeeded: true, explicitlyNotFound: false }],
        ] as const) {
            expect(classifyExistingCloudflareWorkerState(deployments, secrets)).toBe('unknown');
        }
    });

    it('accepts the exact active producer/consumer/DLQ/settings/unpaused contract', () => {
        expect(validateProductionQueueRuntimeReadback(readback('active'))).toEqual({
            ok: true,
            errors: [],
            queueId,
            deadLetterQueueId: dlqId,
        });
        expect(validateProductionQueueVersionBinding(versionView('active'), versionId, 'active')).toEqual({
            ok: true,
            errors: [],
        });
    });

    it('accepts bootstrap compensation only after every Queue attachment is gone', () => {
        expect(validateProductionQueueRuntimeReadback(readback('bootstrap')).ok).toBe(true);
        expect(validateProductionQueueVersionBinding(versionView('bootstrap'), versionId, 'bootstrap')).toEqual({
            ok: true,
            errors: [],
        });
    });

    it('fails closed on duplicate inventory, absent paused state, backlog, wrong parties or settings', () => {
        const mutations: Array<(value: ReturnType<typeof readback>) => void> = [
            (value) => { value.inventoryRows.push(value.inventoryRows[0]); },
            (value) => { delete (value.queueDetail.settings as { delivery_paused?: boolean }).delivery_paused; },
            (value) => { value.queueMetrics.backlog_count = 1; },
            (value) => { (value.queueDetail.producers as Array<{ script_name: string }>)[0].script_name = 'wrong-worker'; },
            (value) => { ((value.queueDetail.consumers as Array<{ settings: { max_retries: number } }>)[0].settings).max_retries = 4; },
            (value) => { (value.deadLetterQueueDetail.producers as unknown[]).push({ script_name: PRODUCTION_QUEUE_TARGET.worker }); },
        ];

        for (const mutate of mutations) {
            const value = structuredClone(readback('active'));
            mutate(value);
            expect(validateProductionQueueRuntimeReadback(value).ok).toBe(false);
        }
    });

    it('fails closed unless the active version binds the exact Queue and bootstrap binds none', () => {
        const wrongTarget = versionView('active').replace(PRODUCTION_QUEUE_TARGET.queue, 'wrong-queue');
        expect(validateProductionQueueVersionBinding(wrongTarget, versionId, 'active').ok).toBe(false);
        expect(validateProductionQueueVersionBinding(versionView('active'), versionId, 'bootstrap').ok).toBe(false);
        expect(validateProductionQueueVersionBinding('{broken', versionId, 'active').ok).toBe(false);
    });
});
