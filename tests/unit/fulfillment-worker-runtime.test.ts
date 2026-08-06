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

    it('keeps executable Worker configuration staging-only and validation dry-run-only', () => {
        const config = read('workers/fulfillment/wrangler.toml');
        const packageJson = read('workers/fulfillment/package.json');
        const validator = read('scripts/dev/validate-built-worker.ts');
        const fulfillmentRunner = read('scripts/dev/fulfillment-worker.mjs');
        const webConfig = read('wrangler.toml');
        const worker = read('workers/fulfillment/src/index.ts');

        expect(config).toContain('keep_vars = false');
        expect(config).toContain('[env.staging.unsafe.metadata]');
        expect(config).toContain('keep_bindings = []');
        expect(config).toContain('[alias]');
        expect(config).toContain('"astro:env/server" = "./src/astro-env-server.ts"');
        expect(config).toContain('EMAIL_DELIVERY_MODE = "allowlist"');
        expect(config).toContain('EMAIL_DAILY_RECIPIENT_LIMIT = "20"');
        expect(config).toContain('EMAIL_MONTHLY_RECIPIENT_LIMIT = "100"');
        expect(config).toContain('binding = "FULFILLMENT_QUEUE"');
        expect(config).toContain('queue = "espanol-honesto-fulfillment-staging-queue"');
        expect(config).toContain('dead_letter_queue = "espanol-honesto-fulfillment-staging-dlq"');
        expect(config).toContain('max_batch_size = 1');
        expect(config).toContain('max_concurrency = 1');
        expect(config).not.toContain('[env.production_bootstrap]');
        expect(config).not.toContain('[env.production]');
        expect(config).not.toContain('espanol-honesto-fulfillment-production');
        expect(webConfig).not.toContain('[env.production_bootstrap]');
        expect(webConfig).not.toContain('[env.production]');
        expect(webConfig).not.toContain('espanol-honesto-fulfillment-production');
        expect(packageJson).toContain('"validate:staging": "node ../../scripts/dev/fulfillment-worker.mjs validate"');
        expect(packageJson).toContain('"wrangler": "4.107.1"');
        expect(packageJson).not.toContain('"validate:production"');
        expect(packageJson).not.toContain('"deploy":');
        expect(packageJson).not.toContain('"deploy:production":');
        expect(validator).toContain("environment !== 'staging'");
        expect(validator).toContain('Only --environment staging is supported');
        expect(validator).not.toContain("'production'");
        expect(validator).toContain("CLOUDFLARE_API_TOKEN: ''");
        expect(validator).toContain("WRANGLER_SEND_METRICS: 'false'");
        expect(fulfillmentRunner).toContain("'--local'");
        expect(fulfillmentRunner).toContain("'--dry-run'");
        expect(fulfillmentRunner).toContain("CLOUDFLARE_API_TOKEN: ''");
        expect(fulfillmentRunner).toContain("WRANGLER_SEND_METRICS: 'false'");
        expect(worker).not.toContain('applyRuntimeEnv');
    });
});
