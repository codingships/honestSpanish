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

        expect(config).toContain('keep_vars = true');
        expect(config).toContain('[alias]');
        expect(config).toContain('"astro:env/server" = "./src/astro-env-server.ts"');
        expect(packageJson).toContain('"deploy": "wrangler deploy --env staging"');
        expect(packageJson).toContain('"deploy:production": "wrangler deploy --env production"');
        expect(worker).not.toContain('applyRuntimeEnv');
    });
});
