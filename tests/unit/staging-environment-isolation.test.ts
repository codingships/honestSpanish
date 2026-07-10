import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (file: string) => readFileSync(file, 'utf8');

describe('staging environment isolation', () => {
    it('uses an empty dedicated Vite env directory instead of inheriting the root .env', () => {
        const runner = read('scripts/dev/staging.ts');
        const astroConfig = read('astro.config.mjs');

        expect(runner).toContain("path.join(tmpdir(), 'espanol-honesto', 'staging-env')");
        expect(runner).toContain('childEnv.ESPANOL_RUNTIME_ENV_DIR = isolatedEnvDirectory');
        expect(astroConfig).toContain('process.env.ESPANOL_RUNTIME_ENV_DIR');
        expect(astroConfig).toContain('envDir: envDirectory');
        expect(astroConfig).toContain("cacheDir: path.join(process.cwd(), 'node_modules', '.vite-staging')");
    });

    it('keeps staging on official Turnstile test keys when no dedicated keys exist', () => {
        const runner = read('scripts/dev/staging.ts');

        expect(runner).toContain("turnstileTestSiteKey = '1x00000000000000000000AA'");
        expect(runner).toContain("turnstileTestSecretKey = '1x0000000000000000000000000000000AA'");
        expect(runner).toContain('source.PUBLIC_TURNSTILE_SITE_KEY ||= turnstileTestSiteKey');
        expect(runner).toContain('source.TURNSTILE_SECRET_KEY ||= turnstileTestSecretKey');
    });
});
