import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (file: string) => readFileSync(file, 'utf8');

describe('Cloudflare launch environment safety', () => {
    it('deploys Astro 6 web packages only from the build-resolved Wrangler config', () => {
        const deployer = read('scripts/dev/deploy-built-worker.ts');
        const packageJson = read('package.json');
        const workflow = read('.github/workflows/ci.yml');

        for (const snippet of [
            "path.join(workspaceRoot, 'dist', 'server', 'wrangler.json')",
            "configValue.targetEnvironment === selectedEnvironment",
            "configValue.main === 'entry.mjs'",
            "vars.CHECKOUT_ENABLED === 'false'",
            "vars.CHECKOUT_ENABLED_OVERRIDE === 'false'",
            "Generic production writes are forbidden",
            "'whoami'",
            'd1a22bcf6477ff2ff31d2bfb83084e44',
        ]) expect(deployer).toContain(snippet);

        expect(packageJson).toContain('deploy-built-worker.ts --environment staging --execute');
        expect(packageJson).toContain('deploy-built-worker.ts --environment production --dry-run');
        expect(workflow).toContain('deploy-built-worker.ts --environment "$CLOUDFLARE_ENV" --dry-run');
        expect(workflow).toContain('run: pnpm deploy');
    });

    it('uses safe top-level Worker names so bare deploys cannot overwrite production', () => {
        const web = read('wrangler.toml');
        const fulfillment = read('workers/fulfillment/wrangler.toml');

        expect(web).toMatch(/^name = "espanolhonesto-env-required"/mu);
        expect(web).toContain('[env.production]');
        expect(web).toContain('name = "espanolhonesto"');
        expect(fulfillment).toMatch(/^name = "espanol-honesto-fulfillment-env-required"/mu);
        expect(fulfillment).toContain('name = "espanol-honesto-fulfillment-production"');
    });

    it('keeps main production read-only while staging retains explicit automatic deploys', () => {
        const ci = read('.github/workflows/ci.yml');
        const packageJson = read('package.json');
        const productionBuild = read('scripts/dev/build-production-release.ts');

        expect(packageJson).toContain('"build:production:release": "tsx scripts/dev/build-production-release.ts"');
        expect(ci).toContain('pnpm run build:production:release');
        expect(productionBuild).toContain("process.env.CLOUDFLARE_ENV = 'production'");
        expect(productionBuild).toContain("process.env.PUBLIC_APP_ENV = 'production'");
        expect(productionBuild).toContain("SUPABASE_EXPECTED_PROJECT_REF=${productionRef}");
        expect(productionBuild).toContain('PUBLIC_SITE_URL=${productionSite}');
        expect(productionBuild).toContain("process.env.CLOUDFLARE_INCLUDE_PROCESS_ENV = 'false'");
        expect(productionBuild).toContain("entry === '.dev.vars'");

        expect(ci).toContain('if: github.ref_name == \'main\'');
        expect(ci).toContain('wrangler deploy --config workers/fulfillment/wrangler.toml --env production_bootstrap --dry-run');
        expect(ci).toContain('wrangler deploy --config workers/fulfillment/wrangler.toml --env production --dry-run');
        expect(ci).toContain('Production CI completed build and dry-runs only.');
        expect(ci).toContain('if: github.ref_name == \'staging\'');
        expect(ci).toContain('wrangler deploy --config workers/fulfillment/wrangler.toml --env staging --keep-vars');
        expect(ci).toContain('deploy-built-worker.ts --environment "$CLOUDFLARE_ENV" --dry-run');
        expect(ci).toContain('run: pnpm deploy');
        expect(ci).not.toContain('wrangler deploy --config workers/fulfillment/wrangler.toml --env production --keep-vars');
        expect(ci).not.toContain('run deploy -- --env');
    });

    it('defines an exact-name inert bootstrap and a separate active fulfillment environment', () => {
        const config = read('workers/fulfillment/wrangler.toml');
        const worker = read('workers/fulfillment/src/index.ts');

        const bootstrap = config.slice(
            config.indexOf('[env.production_bootstrap]'),
            config.indexOf('[env.production]'),
        );
        const active = config.slice(config.indexOf('[env.production]'));
        expect(bootstrap).toContain('name = "espanol-honesto-fulfillment-production"');
        expect(bootstrap).toContain('crons = []');
        expect(bootstrap).toContain('FULFILLMENT_RUNTIME_MODE = "bootstrap"');
        expect(bootstrap).toContain('EMAIL_DELIVERY_MODE = "disabled"');
        expect(bootstrap).toContain('EMAIL_DAILY_RECIPIENT_LIMIT = "0"');
        expect(active).toContain('FULFILLMENT_RUNTIME_MODE = "active"');
        expect(active).toContain('EMAIL_DELIVERY_MODE = "live"');
        expect(active).toContain('crons = ["0 * * * *"]');
        expect(worker).toContain("return json(503, { errorCode: 'FULFILLMENT_DISABLED' })");
        expect(worker).toContain("fulfillmentRuntimeMode(env) !== 'active'");
    });

    it('gates web secret writes on exact target facts and verifies runtime attestation', () => {
        const runner = read('scripts/launch/cloudflare-production-worker-secrets.ts');

        for (const snippet of [
            'CLOUDFLARE_ACCOUNT_ID',
            'CLOUDFLARE_WORKER_ENV_FILE',
            'vkkahxsybhbutszerawz',
            'stripeMode=live',
            'https://espanolhonesto.com',
            "secretValueFor('PUBLIC_APP_ENV') === 'production'",
            'remote_target_pre_write_gate',
            'direct_worker_runtime_attestation',
            'deploymentsListAfter',
            'workerVersionMatched',
            'supabaseExpectedProjectRef',
            'verifyRuntimeAttestation',
            'fresh_stripe_live_readiness_pre_write_gate',
            'inspectStripeLiveReadiness',
            'initial_validation_gate',
            'externalWriteAttempted',
        ]) expect(runner).toContain(snippet);

        expect(runner.indexOf('remoteTargetCheck.status')).toBeLessThan(runner.indexOf('for (const name of requiredSecretNames)'));
        expect(runner.indexOf('validateFreshStripeLiveReadiness(env)')).toBeLessThan(runner.indexOf('for (const name of requiredSecretNames)'));
    });

    it('keeps fulfillment production config/secrets/email on a separate exact-approval path', () => {
        const packageJson = read('package.json');
        const runner = read('scripts/launch/cloudflare-production-fulfillment-secrets.ts');

        expect(packageJson).toContain('launch:cloudflare-production-fulfillment-secrets');
        for (const snippet of [
            'CLOUDFLARE_FULFILLMENT_SECRETS_APPROVAL',
            'CLOUDFLARE_FULFILLMENT_DIRECT_URL',
            'workers/fulfillment/wrangler.toml',
            'espanol-honesto-fulfillment-production',
            'FULFILLMENT_RUNTIME_MODE=bootstrap',
            'EMAIL_DELIVERY_MODE = "disabled"',
            'EMAIL_DAILY_RECIPIENT_LIMIT',
            'EMAIL_MONTHLY_RECIPIENT_LIMIT',
            'GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY',
            'RESEND_API_KEY',
            'remote_target_pre_write_gate',
            'direct_fulfillment_runtime_attestation',
            'fulfillment-deployments-after-secrets',
            'post_write_deployment_version',
            'No email send',
            '--env production_bootstrap',
            'externalWriteAttempted = true',
            'initial_validation_gate',
        ]) expect(runner).toContain(snippet);
    });

    it('orders bootstrap, web, inert secret loading and explicit final enable in the manifest', () => {
        const lifecycle = read('scripts/launch/cloudflare-production-fulfillment-lifecycle.ts');
        const manifest = read('scripts/launch/cloudflare-production-runtime-cutover.ts');
        const webRunner = read('scripts/launch/cloudflare-production-worker-phase1.ts');

        for (const snippet of [
            'launch:cloudflare-production-fulfillment-bootstrap',
            'launch:cloudflare-production-fulfillment-enable',
            "deployCommand('fulfillment-bootstrap-deploy', 'production_bootstrap', false)",
            "deployCommand('fulfillment-active-deploy', 'production', false)",
            'bootstrap_web_secrets_pre_enable_gate',
            'disabledOperationProbe',
            'externalWriteAttempted = true',
            'await compensateToBootstrap(directUrl)',
            'fresh_dual_worker_version_gate',
            'fresh_web_runtime_attestation_pre_enable',
            "cronScheduleProbe('bootstrap')",
            'compensating_bootstrap_rollback_proven',
        ]) expect(lifecycle).toContain(snippet);

        const orderedPhases = [
            'phase_1_fulfillment_inert_bootstrap',
            'phase_2_fulfillment_secrets_while_inert',
            'phase_3_fresh_bootstrap_attestation_before_web',
            'phase_4_web_worker_create_deploy',
            'phase_5_web_worker_secret_names',
            'phase_6_fresh_dual_worker_attestation',
            'phase_7_fulfillment_explicit_enable',
            'phase_8_direct_worker_attestation',
            'phase_9_domain_move',
        ];
        for (let index = 1; index < orderedPhases.length; index += 1) {
            expect(manifest.indexOf(orderedPhases[index - 1])).toBeLessThan(manifest.indexOf(orderedPhases[index]));
        }
        expect(webRunner).toContain('validateFulfillmentBootstrapEvidence()');
        expect(webRunner).toContain('initial_validation_gate');
        expect(webRunner).toContain('externalWriteAttempted = true');
    });

    it('binds runtime attestations to the expected Supabase ref and exact production identities', () => {
        const attestation = read('src/lib/runtime-attestation.ts');
        const webRoute = read('src/pages/api/internal/runtime-attestation.ts');
        const fulfillment = read('workers/fulfillment/src/index.ts');

        expect(attestation).toContain('supabaseExpectedProjectRef');
        expect(attestation).toContain("value(env, 'SUPABASE_EXPECTED_PROJECT_REF')");
        expect(attestation).toContain('stripeSecretKeyFingerprint');
        expect(attestation).toContain('fulfillmentRuntimeMode');
        expect(attestation).toContain("value(env, 'STRIPE_EXPECTED_ACCOUNT_ID')");
        expect(webRoute).toContain("'STRIPE_PORTAL_CONFIGURATION_ID'");
        expect(webRoute).toContain("'STRIPE_WEBHOOK_SECRET'");
        expect(webRoute).toContain("appEnvironment === 'production'");
        expect(webRoute).toContain("? 'espanolhonesto'");
        expect(fulfillment).toContain("? 'espanol-honesto-fulfillment-production'");
    });
});
