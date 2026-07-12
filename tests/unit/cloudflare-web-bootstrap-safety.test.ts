import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (file: string) => readFileSync(file, 'utf8');

describe('Cloudflare production web bootstrap safety', () => {
    it('defines an exact-name inert web bootstrap separately from active production', () => {
        const config = read('wrangler.toml');
        const bootstrap = config.slice(
            config.indexOf('[env.production_bootstrap]'),
            config.indexOf('[env.production]'),
        );
        const active = config.slice(config.indexOf('[env.production]'));

        for (const snippet of [
            'name = "espanolhonesto"',
            'WEB_RUNTIME_MODE = "bootstrap"',
            'CHECKOUT_ENABLED = "false"',
            'CHECKOUT_ENABLED_OVERRIDE = "false"',
            'EMAIL_DELIVERY_MODE = "disabled"',
            'EMAIL_DAILY_RECIPIENT_LIMIT = "0"',
            'EMAIL_MONTHLY_RECIPIENT_LIMIT = "0"',
            'service = "espanol-honesto-fulfillment-production"',
            '[env.production_bootstrap.assets]',
            'run_worker_first = true',
        ]) expect(bootstrap).toContain(snippet);

        expect(active).toContain('WEB_RUNTIME_MODE = "active"');
        expect(active).toContain('EMAIL_DELIVERY_MODE = "live"');
    });

    it('builds bootstrap without final legal or provider credentials while preserving the active gate', () => {
        const packageJson = read('package.json');
        const bootstrap = read('scripts/dev/build-production-bootstrap.ts');
        const active = read('scripts/dev/build-production-release.ts');
        const astro = read('astro.config.mjs');

        expect(packageJson).toContain('"build:production:bootstrap": "tsx scripts/dev/build-production-bootstrap.ts"');
        for (const snippet of [
            "process.env.CLOUDFLARE_ENV = 'production_bootstrap'",
            "process.env.WEB_RUNTIME_MODE = 'bootstrap'",
            "process.env.EMAIL_DELIVERY_MODE = 'disabled'",
            "'SUPABASE_SERVICE_ROLE_KEY'",
            "'STRIPE_SECRET_KEY'",
            "'RESEND_API_KEY'",
            "'TURNSTILE_SECRET_KEY'",
            "'CRON_SECRET'",
            "'LEVEL_CHECK_TOKEN_SECRET'",
            'delete process.env[key]',
            'installBootstrapEntry(generatedConfigPath)',
            "const ALLOWED_PATHS = new Set(['/health', '/api/internal/runtime-attestation'])",
            'config.main = wrapperName',
            'validateBootstrapBundle(distRoot, sourceCredentialValues)',
            'assets.run_worker_first=true',
        ]) expect(bootstrap).toContain(snippet);
        expect(astro).toContain('legalIdentityIsExample && !productionBootstrap');
        expect(active).toContain("process.env.WEB_RUNTIME_MODE = 'active'");
    });

    it('allows only diagnostics and blocks representative application routes in bootstrap mode', () => {
        const middleware = read('src/middleware.ts');
        const health = read('src/pages/health.ts');
        const attestation = read('src/lib/runtime-attestation.ts');

        expect(middleware).toContain("'/health'");
        expect(middleware).toContain("'/api/internal/runtime-attestation'");
        expect(middleware).toContain("'WEB_RUNTIME_BOOTSTRAP'");
        expect(middleware).toContain('status: 503');
        expect(health).toContain("runtimeMode === 'bootstrap' || runtimeMode === 'active'");
        expect(attestation).toContain('const stripeConfigured = webRole && [');
        expect(attestation).toContain('].some((key) => Boolean(value(env, key)))');
        expect(attestation).toContain('webRuntimeMode');
    });

    it('deploys only the resolved production_bootstrap package after fresh inert fulfillment proof', () => {
        const runner = read('scripts/launch/cloudflare-production-worker-phase1.ts');
        const preflight = read('scripts/launch/cloudflare-production-runtime-cutover-preflight.ts');

        for (const snippet of [
            'validateFulfillmentBootstrapEvidence()',
            'validateFulfillmentBootstrapSecretsEvidence()',
            'launch-cloudflare-production-fulfillment-bootstrap-secrets',
            'fulfillmentBootstrapSecretNames',
            "'INTERNAL_JOB_SECRET'",
            "config.googleBoundary === 'absent'",
            "config.supabaseServiceRoleFingerprint === 'absent'",
            "config.resendApiKeyFingerprint === 'absent'",
            'corepack pnpm --config.verify-deps-before-run=false run build:production:bootstrap',
            'targetEnvironment',
            "'production_bootstrap'",
            'validateBuiltBootstrapConfig()',
            'assets.run_worker_first=true',
            "['main', config.main, 'bootstrap-entry.mjs']",
            'web_bootstrap_secret_shape_after_deploy',
            'verifyWebBootstrapAfterDeploy',
            "{ path: '/robots.txt', method: 'GET' }",
            "{ path: '/vite.svg', method: 'GET' }",
            "{ path: '/favicon.png', method: 'GET' }",
            "{ path: '/sitemap-index.xml', method: 'GET' }",
            "return '/_astro/bootstrap-probe.js'",
            "response.headers.get('Cache-Control') === 'no-store'",
            "response.headers.get('X-Robots-Tag')",
            'web_bootstrap_attestation_get_hidden_after_deploy',
            'WEB_RUNTIME_BOOTSTRAP',
            'No final legal identity requirement',
            'externalWriteAttempted = true',
        ]) expect(runner).toContain(snippet);
        expect(runner).not.toContain("args: ['pnpm', '--config.verify-deps-before-run=false', 'run', 'build:production:release']");
        expect(preflight).toContain("args: pnpmArgs('run', 'build:production:bootstrap')");
        expect(preflight).not.toContain("args: pnpmArgs('run', 'build:production:release')");
        expect(preflight).toContain('Astro 6 selects `production_bootstrap` during the build');
        expect(preflight).toContain('The active `build:production:release` remains a separate final-window gate');
        expect(preflight).toContain('readResolvedWorkerConfig()');
        expect(preflight).toContain('resolvedWorkerConfigHasCustomDomainAttachment(resolvedWorkerConfig)');
        expect(preflight).not.toContain('target.customDomains.every((domain) => !dryRunOutput.includes(domain))');
    });

    it('loads only the shared HMAC secret into the fulfillment bootstrap', () => {
        const packageJson = read('package.json');
        const runner = read('scripts/launch/cloudflare-production-fulfillment-bootstrap-secrets.ts');
        const finalRunner = read('scripts/launch/cloudflare-production-fulfillment-secrets.ts');

        expect(packageJson).toContain('launch:cloudflare-production-fulfillment-bootstrap-secrets');
        for (const snippet of [
            'CLOUDFLARE_FULFILLMENT_BOOTSTRAP_SECRETS_APPROVAL',
            'INTERNAL_JOB_SECRET',
            'explicitlyWithheldSecretNames',
            'PUBLIC_SUPABASE_URL',
            'SUPABASE_SERVICE_ROLE_KEY',
            'GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY',
            'RESEND_API_KEY',
            'CRON_SECRET',
            '--env production_bootstrap',
            'remote_target_pre_write_gate',
            'minimal_bootstrap_secret_shape_before_write',
            'minimal_bootstrap_secret_shape_after_write',
            'direct_fulfillment_bootstrap_hmac_attestation',
            "config.googleBoundary === 'absent'",
            "config.supabaseUrlFingerprint === 'absent'",
            "config.supabaseServiceRoleFingerprint === 'absent'",
            "config.resendApiKeyFingerprint === 'absent'",
            "config.cronSecretFingerprint === 'absent'",
            'fulfillment_bootstrap_no_cron',
            'externalWriteAttempted = true',
        ]) expect(runner).toContain(snippet);

        const minimalSet = runner.slice(
            runner.indexOf('const requiredSecretNames = ['),
            runner.indexOf('const explicitlyWithheldSecretNames = ['),
        );
        expect(minimalSet).toContain("'INTERNAL_JOB_SECRET'");
        expect(minimalSet).not.toContain("'PUBLIC_SUPABASE_URL'");
        expect(minimalSet).not.toContain("'GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY'");
        expect(minimalSet).not.toContain("'RESEND_API_KEY'");

        const executionGate = runner.slice(
            runner.indexOf('function validateExecutionEnvironment()'),
            runner.indexOf('function validatePackageScript()'),
        );
        expect(executionGate).not.toContain("'CLOUDFLARE_API_TOKEN'");
        expect(runner).toContain('verificationMode=wrangler_oauth_plus_connector_followup');

        expect(finalRunner).toContain('GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY');
        expect(finalRunner).toContain('RESEND_API_KEY');
        expect(finalRunner).toContain('SUPABASE_SERVICE_ROLE_KEY');
    });

    it('loads only the HMAC secret and attests Supabase runtime credentials plus active providers absent', () => {
        const packageJson = read('package.json');
        const runner = read('scripts/launch/cloudflare-production-worker-bootstrap-secrets.ts');
        const finalRunner = read('scripts/launch/cloudflare-production-worker-secrets.ts');

        expect(packageJson).toContain('launch:cloudflare-production-worker-bootstrap-secrets');
        for (const snippet of [
            'CLOUDFLARE_WORKER_BOOTSTRAP_SECRETS_APPROVAL',
            'PUBLIC_SUPABASE_URL',
            'PUBLIC_SUPABASE_ANON_KEY',
            'INTERNAL_JOB_SECRET',
            'SUPABASE_SERVICE_ROLE_KEY',
            'STRIPE_SECRET_KEY',
            'RESEND_API_KEY',
            'TURNSTILE_SECRET_KEY',
            'CRON_SECRET',
            'LEVEL_CHECK_TOKEN_SECRET',
            '--env production_bootstrap',
            'remote_target_pre_write_gate',
            'minimal_bootstrap_secret_shape_before_write',
            'minimal_bootstrap_secret_shape_after_write',
            'direct_web_bootstrap_hmac_attestation',
            "config.webRuntimeMode === 'bootstrap'",
            "config.stripeBoundary === 'absent'",
            "config.resendApiKeyFingerprint === 'absent'",
            "config.supabaseUrlFingerprint === 'absent'",
            "config.supabaseAnonFingerprint === 'absent'",
            "config.supabaseServiceRoleFingerprint === 'absent'",
            "config.turnstileSiteKeyFingerprint === 'absent'",
            "config.turnstileSecretFingerprint === 'absent'",
            "config.cronSecretFingerprint === 'absent'",
            "config.levelCheckSecretFingerprint === 'absent'",
            'externalWriteAttempted = true',
            'initial_validation_gate',
        ]) expect(runner).toContain(snippet);

        const executionInputs = runner.slice(
            runner.indexOf('function validateExecutionInputs()'),
            runner.indexOf('async function runApprovedExecution()'),
        );
        expect(executionInputs).not.toContain('CLOUDFLARE_API_TOKEN');

        const minimalSet = runner.slice(
            runner.indexOf('const requiredSecretNames = ['),
            runner.indexOf('const explicitlyWithheldSecretNames = ['),
        );
        expect(minimalSet).toContain("'INTERNAL_JOB_SECRET'");
        expect(minimalSet).not.toContain("'PUBLIC_SUPABASE_URL'");
        expect(minimalSet).not.toContain("'PUBLIC_SUPABASE_ANON_KEY'");

        const execution = runner.slice(runner.indexOf('async function runApprovedExecution'));
        expect(execution.indexOf('validateRemoteTarget(captures)')).toBeLessThan(execution.indexOf('for (const name of requiredSecretNames)'));
        expect(execution.indexOf("probeBootstrapRoutes('pre_write')")).toBeLessThan(execution.indexOf('for (const name of requiredSecretNames)'));
        expect(finalRunner).toContain('fresh_stripe_live_readiness_pre_write_gate');
        expect(finalRunner).toContain('stripeMode=live');
    });
});
