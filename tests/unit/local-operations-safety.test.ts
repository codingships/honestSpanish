import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
    scripts?: Record<string, string>;
};
const fulfillmentPackageJson = JSON.parse(readFileSync('workers/fulfillment/package.json', 'utf8')) as {
    scripts?: Record<string, string>;
};
const demoDev = readFileSync('scripts/demo/dev.ts', 'utf8');
const astroConfig = readFileSync('astro.config.mjs', 'utf8');

describe('local operations safety', () => {
    it('exposes no local aliases for ungoverned writes or obsolete production Workers', () => {
        for (const alias of [
            'astro',
            'preview',
            'google:setup-staging',
            'start',
            'demo:staging:full',
            'demo:staging:safe',
            'demo:staging:interactive',
            'demo:local',
            'demo:watch',
            'demo:report',
            'dev:production-data',
            'build:production:bootstrap',
            'build:production:release',
            'validate:production-package',
            'demo:tunnel',
        ]) {
            expect(packageJson.scripts).not.toHaveProperty(alias);
        }
        expect(packageJson.scripts?.['dev:demo']).toBe('tsx scripts/demo/dev.ts');
        expect(fulfillmentPackageJson.scripts).not.toHaveProperty('validate:production');

        for (const file of [
            'scripts/setup-google-staging.ts',
            'scripts/block-system-node-package-managers.ps1',
            'scripts/dev/production.ts',
            'scripts/dev/build-production-bootstrap.ts',
            'scripts/dev/build-production-release.ts',
            'scripts/dev/production-release-safety.ts',
            'scripts/demo/tunnel.ts',
            'scripts/demo/run.ts',
            'scripts/demo/shared.ts',
            'scripts/demo/steps.ts',
            'scripts/demo/overlay.ts',
            'scripts/demo/watch.ts',
            'scripts/demo/report.ts',
            'scripts/load-test.js',
            'scripts/quick-stress-test.js',
            'scripts/load-test-results.json',
        ]) {
            expect(existsSync(file), file).toBe(false);
        }

        expect(astroConfig).not.toContain('production_bootstrap');
        expect(astroConfig).not.toContain("cloudflareTarget === 'production'");
        expect(astroConfig).not.toContain(': process.cwd();');
    });

    it('keeps the one remaining demo entry point on the exact staging guard', () => {
        expect(demoDev).toContain('loadStagingBrowserEnvironment');
        expect(demoDev).not.toContain("dotenv.config({ path: '.env'");
        expect(demoDev).not.toContain('DEMO_ALLOW_');
        expect(demoDev).not.toContain('DEMO_SMOKE');
    });
});
