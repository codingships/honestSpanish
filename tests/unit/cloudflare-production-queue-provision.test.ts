import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
    PRODUCTION_QUEUE_APPROVAL_ENV,
    PRODUCTION_QUEUE_APPROVAL_SENTENCE,
    PRODUCTION_QUEUE_TARGET,
    classifyQueueInventory,
    queueRowsInPage,
    validateProductionQueueConfig,
} from '../../scripts/launch/cloudflare-production-queue-shared';

const config = readFileSync('workers/fulfillment/wrangler.toml', 'utf8');
const runner = readFileSync('scripts/launch/cloudflare-production-queue-provision.ts', 'utf8');
const shared = readFileSync('scripts/launch/cloudflare-production-queue-shared.ts', 'utf8');
const packageJson = readFileSync('package.json', 'utf8');
const productionRunbook = readFileSync('docs/launch/CLOUDFLARE_PRODUCTION.md', 'utf8');

describe('Cloudflare production Queue provisioning', () => {
    it('binds the producer and consumer only in active production', () => {
        expect(validateProductionQueueConfig(config)).toEqual({ valid: true, errors: [] });

        const bootstrapStart = config.indexOf('[env.production_bootstrap]');
        const productionStart = config.indexOf('[env.production]');
        const bootstrap = config.slice(bootstrapStart, productionStart);
        const production = config.slice(productionStart);

        expect(bootstrap).not.toContain(PRODUCTION_QUEUE_TARGET.queue);
        expect(bootstrap).not.toContain(PRODUCTION_QUEUE_TARGET.deadLetterQueue);
        expect(bootstrap).not.toContain(PRODUCTION_QUEUE_TARGET.binding);
        expect(production).toContain(`queue = "${PRODUCTION_QUEUE_TARGET.queue}"`);
        expect(production).toContain(`dead_letter_queue = "${PRODUCTION_QUEUE_TARGET.deadLetterQueue}"`);
        for (const setting of [
            'max_batch_size = 1',
            'max_batch_timeout = 1',
            'max_concurrency = 1',
            'max_retries = 5',
            'retry_delay = 30',
        ]) {
            expect(production).toContain(setting);
        }
    });

    it('fails config validation if a production Queue leaks into bootstrap', () => {
        const leaked = config.replace(
            '[env.production_bootstrap.triggers]',
            `[[env.production_bootstrap.queues.producers]]\nbinding = "FULFILLMENT_QUEUE"\nqueue = "${PRODUCTION_QUEUE_TARGET.queue}"\n\n[env.production_bootstrap.triggers]`,
        );
        const validation = validateProductionQueueConfig(leaked);

        expect(validation.valid).toBe(false);
        expect(validation.errors.join('\n')).toContain('production_bootstrap');
    });

    it('classifies only the two exact production names and parses Wrangler Queue rows', () => {
        const output = [
            '│ 150fa19616be41a6a55b9ec1eea60be2 │ espanol-honesto-fulfillment-staging-dlq   │',
            '│ b65c8b6e98b140c2b3de53a86d3fc36a │ espanol-honesto-fulfillment-staging-queue │',
        ].join('\n');
        expect(classifyQueueInventory(output)).toMatchObject({
            queueCount: 0,
            deadLetterQueueCount: 0,
            clearForProvision: true,
        });
        expect(queueRowsInPage(output)).toBe(2);

        const withProduction = `${output}\n│ aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa │ ${PRODUCTION_QUEUE_TARGET.deadLetterQueue} │\n│ bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb │ ${PRODUCTION_QUEUE_TARGET.queue} │`;
        expect(classifyQueueInventory(withProduction)).toMatchObject({
            queueCount: 1,
            deadLetterQueueCount: 1,
            clearForProvision: false,
        });
        expect(queueRowsInPage(withProduction)).toBe(4);
    });

    it('requires exact approval plus flag and creates DLQ before Queue', () => {
        for (const snippet of [
            'PRODUCTION_QUEUE_APPROVAL_ENV',
            'PRODUCTION_QUEUE_APPROVAL_SENTENCE',
            "supportedArguments = new Set(['--execute-approved', '--verify-existing'])",
            "throw new Error('--execute-approved and --verify-existing are mutually exclusive')",
            'exact_existing_inventory_gate',
            'verify_existing_read_only',
            "closureStatus = 'VERIFIED_EXISTING'",
            "process.env[PRODUCTION_QUEUE_APPROVAL_ENV]?.trim() === PRODUCTION_QUEUE_APPROVAL_SENTENCE",
            'exact_name_collision_gate',
            'clearForProvision',
            'create-production-dlq',
            'dlq_first_verified',
            'create-production-queue',
            'two_queue_post_write_verification',
            'PARTIAL_WRITE_STOP',
            'externalWritePerformed',
            'manualReviewRequired=true',
        ]) {
            expect(runner).toContain(snippet);
        }

        for (const value of [
            PRODUCTION_QUEUE_APPROVAL_ENV,
            PRODUCTION_QUEUE_TARGET.accountId,
            PRODUCTION_QUEUE_TARGET.deadLetterQueue,
            PRODUCTION_QUEUE_TARGET.queue,
        ]) {
            expect(shared).toContain(value);
        }

        expect(runner.indexOf("const createDlq = runCommand")).toBeLessThan(runner.indexOf("const createQueue = runCommand"));
        expect(runner.indexOf('if (verifyExistingRequested)')).toBeLessThan(runner.indexOf('exact_name_collision_gate'));
        expect(PRODUCTION_QUEUE_APPROVAL_SENTENCE).toContain(PRODUCTION_QUEUE_TARGET.accountId);
        expect(PRODUCTION_QUEUE_APPROVAL_SENTENCE.indexOf(PRODUCTION_QUEUE_TARGET.deadLetterQueue))
            .toBeLessThan(PRODUCTION_QUEUE_APPROVAL_SENTENCE.indexOf(PRODUCTION_QUEUE_TARGET.queue));
    });

    it('allowlists only identity/list/info reads and exact Queue creates', () => {
        for (const snippet of [
            "group === 'whoami'",
            "group === 'queues'",
            "action === 'list'",
            "action === 'info'",
            "action === 'create'",
            'Command scope rejected',
            'writesCloudflare: false',
            'writesCloudflare: true',
            'WorkerDeployPerformed=false',
            'ManualConsumerAdded=false',
        ]) {
            expect(runner).toContain(snippet);
        }

        expect(runner).not.toContain("['deploy'");
        expect(runner).not.toContain("['queues', 'delete'");
        expect(runner).not.toContain("['queues', 'consumer'");
        expect(runner).not.toContain('dotenv.config');
    });

    it('keeps package wiring for the parent integration step', () => {
        expect(packageJson).toContain('"launch:cloudflare-production-queues": "tsx scripts/launch/cloudflare-production-queue-provision.ts"');
        expect(runner).toContain('launch:cloudflare-production-queues');
    });

    it('places inert Queue provisioning before the fulfillment bootstrap and final enable', () => {
        const queueStep = productionRunbook.indexOf('2. Crear, bajo aprobación exacta separada');
        const bootstrapStep = productionRunbook.indexOf('3. Desplegar primero `espanol-honesto-fulfillment-production`');
        const enableStep = productionRunbook.indexOf('10. Habilitar fulfillment únicamente');

        expect(queueStep).toBeGreaterThan(-1);
        expect(queueStep).toBeLessThan(bootstrapStep);
        expect(bootstrapStep).toBeLessThan(enableStep);
        expect(productionRunbook).toContain('pnpm launch:cloudflare-production-queues -- --execute-approved');
        expect(productionRunbook).toContain('pnpm launch:cloudflare-production-queues -- --verify-existing');
        expect(productionRunbook).toContain('no despliega Workers ni añade consumidores manualmente');
        expect(productionRunbook).toContain('`production_bootstrap` no declara bindings');
        expect(productionRunbook).toContain('Es un prerrequisito externo separado');
        expect(productionRunbook).toContain('el runner de enable no crea, borra, adopta ni valida el inventario de Queues');
        expect(productionRunbook).toContain('la existencia de Queues procede del preflight separado');
    });
});
