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

    it('isolates and refreshes the Vite dependency cache for the E2E server', () => {
        const astroConfig = read('astro.config.mjs');
        const e2eServer = read('tests/e2e/start-server.mjs');
        const playwrightConfig = read('playwright.config.ts');

        expect(astroConfig).toContain("cacheDir: path.join(process.cwd(), 'node_modules', '.vite-e2e')");
        expect(astroConfig).toContain("'@marsidev/react-turnstile'");
        expect(astroConfig).toContain("'@supabase/ssr'");
        expect(astroConfig).toContain("'react/jsx-dev-runtime'");
        expect(astroConfig).toContain('include: e2eSsrOptimizedDependencies');
        expect(e2eServer).toContain("spawnSync(process.execPath, [astroCli, 'sync']");
        expect(e2eServer).toContain("[astroCli, 'dev']");
        expect(e2eServer).not.toContain("[astroCli, 'dev', '--force']");
        expect(playwrightConfig).toContain("url: 'http://localhost:4321/api/e2e-runtime/environment'");
    });

    it('keeps staging on official Turnstile test keys when no dedicated keys exist', () => {
        const runner = read('scripts/dev/staging.ts');
        const workerConfig = read('wrangler.toml');

        expect(runner).toContain("turnstileTestSiteKey = '1x00000000000000000000AA'");
        expect(runner).toContain("turnstileTestSecretKey = '1x0000000000000000000000000000000AA'");
        expect(runner).toContain('source.PUBLIC_TURNSTILE_SITE_KEY ||= turnstileTestSiteKey');
        expect(runner).toContain('source.TURNSTILE_SECRET_KEY ||= turnstileTestSecretKey');
        expect(workerConfig).toContain('CHECKOUT_ENABLED_OVERRIDE = "false"');
        expect(workerConfig).toContain('EMAIL_DELIVERY_MODE = "allowlist"');
        expect(workerConfig).toContain('EMAIL_DAILY_RECIPIENT_LIMIT = "10"');
        expect(workerConfig).toContain('EMAIL_MONTHLY_RECIPIENT_LIMIT = "100"');
    });

    it('resolves the public Sentry DSN read-only without persisting or logging it', () => {
        const runner = read('scripts/dev/staging.ts');
        const releaseBuild = read('scripts/dev/build-staging-release.ts');
        const packageJson = read('package.json');

        expect(packageJson).toContain('"build:staging:release": "tsx scripts/dev/build-staging-release.ts --build"');
        expect(releaseBuild).toContain('/keys/?status=active');
        expect(releaseBuild).toContain('Authorization: `Bearer ${token}`');
        expect(releaseBuild).toContain('process.env.PUBLIC_SENTRY_DSN = publicDsn');
        expect(releaseBuild).not.toContain('console.log');
        expect(runner).toContain('source.PUBLIC_SENTRY_DSN || process.env.PUBLIC_SENTRY_DSN');
        expect(runner).toContain("output.SENTRY_ENVIRONMENT = 'staging'");
    });

    it('prepares a durable staging-only runtime allowlist without accepting live Stripe keys', () => {
        const preparer = read('scripts/dev/prepare-staging-secrets.ts');
        const packageJson = read('package.json');

        expect(packageJson).toContain('"env:staging:prepare": "tsx scripts/dev/prepare-staging-secrets.ts"');
        expect(preparer).toContain("stripeSecret?.startsWith('sk_test_')");
        expect(preparer).toContain("stripePublishable?.startsWith('pk_test_')");
        expect(preparer).toContain("EMAIL_DELIVERY_MODE: 'allowlist'");
        expect(preparer).toContain("EMAIL_DAILY_RECIPIENT_LIMIT: '10'");
        expect(preparer).toContain("EMAIL_MONTHLY_RECIPIENT_LIMIT: '100'");
        expect(preparer).toContain("CHECKOUT_ENABLED: 'false'");
        expect(preparer).toContain("INTERNAL_JOB_SECRET: staging.INTERNAL_JOB_SECRET || randomSecret()");
        expect(preparer).toContain('normalizeGooglePrivateKey(staging.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY');
        expect(preparer).toContain('createPrivateKey(googlePrivateKey)');
        expect(preparer).not.toContain('console.log(publicDsn');
        expect(preparer).not.toContain('console.log(staging');
    });
});
