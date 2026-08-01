import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (file: string) => readFileSync(file, 'utf8');

describe('staging environment isolation', () => {
    it('uses an empty dedicated Vite env directory instead of inheriting the root .env', () => {
        const runner = read('scripts/dev/staging.ts');
        const astroConfig = read('astro.config.mjs');

        expect(runner).toContain("path.join(tmpdir(), 'espanol-honesto', 'staging-env')");
        expect(runner).toContain('childEnv.ESPANOL_RUNTIME_ENV_DIR = isolatedEnvDirectory');
        expect(astroConfig).toContain("path.join(tmpdir(), 'espanol-honesto', 'staging-env')");
        expect(astroConfig).toContain('path.resolve(configuredLocalRuntimeEnv) !== localRuntimeEnvRoot');
        expect(astroConfig).toContain("e2eRuntimeIsolated || process.env.CI === 'true'");
        expect(astroConfig).not.toContain('? path.resolve(process.env.ESPANOL_RUNTIME_ENV_DIR)');
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
        const validator = read('scripts/dev/validate-built-worker.ts');

        expect(runner).toContain("turnstileTestSiteKey = '1x00000000000000000000AA'");
        expect(runner).toContain("turnstileTestSecretKey = '1x0000000000000000000000000000000AA'");
        expect(runner).toContain('source.PUBLIC_TURNSTILE_SITE_KEY ||= turnstileTestSiteKey');
        expect(runner).toContain('source.TURNSTILE_SECRET_KEY ||= turnstileTestSecretKey');
        expect(workerConfig).toContain('CHECKOUT_ENABLED_OVERRIDE = "false"');
        expect(workerConfig).toContain('EMAIL_DELIVERY_MODE = "allowlist"');
        expect(workerConfig).toContain('EMAIL_DAILY_RECIPIENT_LIMIT = "10"');
        expect(workerConfig).toContain('EMAIL_MONTHLY_RECIPIENT_LIMIT = "100"');
        expect(workerConfig).not.toContain('STRIPE_EXPECTED_ACCOUNT_ID =');
        expect(validator).toContain("hasOwnProperty.call(vars, 'STRIPE_EXPECTED_ACCOUNT_ID')");
        expect(validator).toContain('STRIPE_EXPECTED_ACCOUNT_ID must be a version-scoped secret only');
        expect(workerConfig).toContain('keep_vars = false');
        expect(workerConfig).toContain('[env.staging.unsafe.metadata]');
        expect(workerConfig).toContain('keep_bindings = []');
    });

    it('requires an explicit public Sentry DSN for builds without an auth lookup', () => {
        const runner = read('scripts/dev/staging.ts');
        const releaseBuild = read('scripts/dev/build-staging-release.ts');
        const packageJson = read('package.json');

        expect(packageJson).toContain('"build:staging:release": "tsx scripts/dev/build-staging-release.ts --build"');
        expect(releaseBuild).toContain('PUBLIC_SENTRY_DSN must be configured explicitly for staging');
        expect(releaseBuild).toContain("process.env.SENTRY_UPLOAD_SOURCEMAPS = 'false'");
        expect(releaseBuild).not.toContain('/keys/?status=active');
        expect(releaseBuild).not.toContain('SENTRY_AUTH_TOKEN');
        expect(releaseBuild).not.toContain('fetch(');
        expect(releaseBuild).not.toContain('console.log');
        expect(runner).toContain('source.PUBLIC_SENTRY_DSN || process.env.PUBLIC_SENTRY_DSN');
        expect(runner).toContain("output.SENTRY_ENVIRONMENT = 'staging'");
    });

    it('prepares a durable staging-only runtime allowlist without accepting live Stripe keys', () => {
        const preparer = read('scripts/dev/prepare-staging-secrets.ts');
        const runner = read('scripts/dev/staging.ts');
        const packageJson = read('package.json');

        expect(packageJson).toContain('"env:staging:prepare": "tsx scripts/dev/prepare-staging-secrets.ts"');
        expect(preparer).toContain("stripeSecret?.startsWith('sk_test_')");
        expect(preparer).toContain("stripePublishable?.startsWith('pk_test_')");
        expect(preparer).toContain("EMAIL_DELIVERY_MODE: 'allowlist'");
        expect(preparer).toContain("EMAIL_DAILY_RECIPIENT_LIMIT: '10'");
        expect(preparer).toContain("EMAIL_MONTHLY_RECIPIENT_LIMIT: '100'");
        expect(preparer).toContain("CHECKOUT_ENABLED: 'false'");
        expect(preparer).toContain("const cronSecret = requireStagingSecret('CRON_SECRET')");
        expect(preparer).toContain(
            "const checkoutHoldFingerprintSecret = requireStagingSecret('CHECKOUT_HOLD_FINGERPRINT_SECRET')",
        );
        expect(preparer).toContain("const internalJobSecret = requireStagingSecret('INTERNAL_JOB_SECRET')");
        expect(preparer).toContain("const levelCheckTokenSecret = requireStagingSecret('LEVEL_CHECK_TOKEN_SECRET')");
        expect(preparer).toContain('INTERNAL_JOB_SECRET: internalJobSecret');
        expect(preparer).toContain('CRON_SECRET: cronSecret');
        expect(preparer).toContain('CHECKOUT_HOLD_FINGERPRINT_SECRET: checkoutHoldFingerprintSecret');
        expect(preparer).toContain('LEVEL_CHECK_TOKEN_SECRET: levelCheckTokenSecret');
        expect(preparer).toContain('must already contain the provisioned staging secret');
        expect(preparer).not.toContain('randomBytes');
        expect(preparer).not.toContain('randomSecret');
        expect(preparer).toContain('normalizeGooglePrivateKey(staging.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY');
        expect(preparer).toContain('createPrivateKey(googlePrivateKey)');
        expect(preparer).toContain("const sentryOrg = 'honestspanish'");
        expect(preparer).toContain("const sentryProject = 'espanol-honesto-astro'");
        expect(preparer).toContain("const sentryDsnHost = 'o4510912289701888.ingest.de.sentry.io'");
        expect(preparer).toContain("const sentryProjectId = '4510917714444368'");
        expect(preparer).toContain('SENTRY_ORG: sentryOrg');
        expect(preparer).toContain('SENTRY_PROJECT: sentryProject');
        expect(preparer).toContain('staging.SENTRY_AUTH_TOKEN || process.env.SENTRY_AUTH_TOKEN');
        expect(preparer).not.toContain("const basePath = '.env'");
        expect(preparer).not.toContain("fromAllowedSources('SENTRY_ORG')");
        expect(preparer).not.toContain("fromAllowedSources('SENTRY_PROJECT')");
        expect(preparer).not.toContain('console.log(publicDsn');
        expect(preparer).not.toContain('console.log(staging');
        expect(preparer).toContain('isExactHttpsOrigin(staging.PUBLIC_SUPABASE_URL, stagingSupabaseUrl)');
        expect(preparer).toContain("const stagingStripeAccountId = 'acct_1TruqOC22M3erP0j'");
        expect(preparer).toContain('stripeExpectedAccount !== stagingStripeAccountId');
        expect(preparer).toContain("const testPath = '.env.test'");
        expect(preparer).toContain('test[key]?.trim().toLowerCase()');
        expect(preparer).toContain('ADMIN_EMAIL: test.TEST_ADMIN_EMAIL');
        expect(preparer).toContain('SUPPORT_ALERT_EMAIL: test.TEST_ADMIN_EMAIL');
        expect(preparer).not.toContain('staging.TEST_ADMIN_EMAIL');
        expect(preparer).not.toContain('PUBLIC_SUPABASE_URL?.includes(stagingRef)');
        expect(runner).toContain('isExactHttpsOrigin(source.PUBLIC_SUPABASE_URL, stagingSupabaseUrl)');
        expect(runner).toContain('source.STRIPE_EXPECTED_ACCOUNT_ID !== stagingStripeAccountId');
        expect(runner).not.toContain('PUBLIC_SUPABASE_URL?.includes(stagingRef)');
    });
});
