import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { getSecret } from '../../workers/fulfillment/src/astro-env-server';

const read = (file: string) => readFileSync(file, 'utf8');

describe('fulfillment Worker runtime boundary', () => {
    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it('reads Cloudflare text vars and secrets through process.env', () => {
        vi.stubEnv('FULFILLMENT_RUNTIME_TEST', 'staging-value');

        expect(getSecret('FULFILLMENT_RUNTIME_TEST')).toBe('staging-value');
        expect(getSecret('FULFILLMENT_RUNTIME_MISSING')).toBeUndefined();
    });

    it('aliases the Astro-only module and keeps deploy commands environment-explicit', () => {
        const config = read('workers/fulfillment/wrangler.toml');
        const packageJson = read('workers/fulfillment/package.json');
        const worker = read('workers/fulfillment/src/index.ts');
        const stagingConfig = config.slice(
            config.indexOf('[env.staging]'),
            config.indexOf('[env.production_bootstrap]'),
        );
        const productionConfig = config.slice(config.indexOf('[env.production_bootstrap]'));

        expect(config).toContain('keep_vars = true');
        expect(config).toContain('[alias]');
        expect(config).toContain('"astro:env/server" = "./src/astro-env-server.ts"');
        expect(config).toContain('EMAIL_DELIVERY_MODE = "allowlist"');
        expect(config).toContain('EMAIL_DAILY_RECIPIENT_LIMIT = "10"');
        expect(config).toContain('EMAIL_MONTHLY_RECIPIENT_LIMIT = "100"');
        expect(stagingConfig).toContain('binding = "FULFILLMENT_QUEUE"');
        expect(stagingConfig).toContain('queue = "espanol-honesto-fulfillment-staging-queue"');
        expect(stagingConfig).toContain('dead_letter_queue = "espanol-honesto-fulfillment-staging-dlq"');
        expect(stagingConfig).toContain('max_batch_size = 1');
        expect(stagingConfig).toContain('max_concurrency = 1');
        expect(productionConfig).not.toContain('queues.producers');
        expect(productionConfig).not.toContain('queues.consumers');
        expect(productionConfig).not.toContain('FULFILLMENT_QUEUE');
        expect(packageJson).toContain('"deploy": "wrangler deploy --config wrangler.toml --env staging"');
        expect(packageJson).toContain('"deploy:production": "wrangler deploy --config wrangler.toml --env production --dry-run"');
        expect(worker).not.toContain('applyRuntimeEnv');
    });
});
