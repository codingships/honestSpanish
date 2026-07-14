import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (file: string) => readFileSync(file, 'utf8');

describe('Cloudflare launch environment safety', () => {
    it('binds every build target to its exact public application environment', () => {
        const astroConfig = read('astro.config.mjs');

        expect(astroConfig).toContain("staging: 'staging'");
        expect(astroConfig).toContain("production_bootstrap: 'production'");
        expect(astroConfig).toContain("production: 'production'");
        expect(astroConfig).toContain('Refused unknown Cloudflare target');
        expect(astroConfig).toContain('PUBLIC_APP_ENV must be exactly');
        expect(astroConfig).toContain("cloudflareTarget === 'production' && legalIdentityIsExample");
    });

    it('runs generic CI Astro steps against the explicit inert staging target', () => {
        const workflow = read('.github/workflows/ci.yml');
        const buildAndTestJob = workflow.slice(
            workflow.indexOf('  build-and-test:'),
            workflow.indexOf('  deploy-cloudflare:'),
        );
        const syncStep = buildAndTestJob.slice(
            buildAndTestJob.indexOf('      - name: Sync Astro types'),
            buildAndTestJob.indexOf('      - name: Check types'),
        );
        const buildStep = buildAndTestJob.slice(
            buildAndTestJob.indexOf('      - name: Build'),
            buildAndTestJob.indexOf('      - name: Cache Playwright browsers'),
        );

        for (const step of [syncStep, buildStep]) {
            expect(step).toContain('CLOUDFLARE_ENV: "staging"');
            expect(step).toContain('PUBLIC_APP_ENV: "staging"');
        }
        expect(buildStep).not.toContain('PUBLIC_APP_ENV: "test"');
    });

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
            "configValue.routes[0]?.pattern === 'staging.espanolhonesto.com'",
            "configValue.routes[0]?.custom_domain === true",
            "configValue.workers_dev === true",
            "configValue.preview_urls === false",
            "Generic production writes are forbidden",
            "'whoami'",
            'd1a22bcf6477ff2ff31d2bfb83084e44',
        ]) expect(deployer).toContain(snippet);

        expect(packageJson).toContain('deploy-built-worker.ts --environment staging --execute');
        expect(packageJson).toContain('deploy-built-worker.ts --environment production --dry-run');
        expect(workflow).toContain('deploy-built-worker.ts --environment "$CLOUDFLARE_ENV" --dry-run');
        expect(workflow).toContain('run: pnpm run deploy');
    });

    it('uses safe top-level Worker names so bare deploys cannot overwrite production', () => {
        const web = read('wrangler.toml');
        const fulfillment = read('workers/fulfillment/wrangler.toml');

        expect(web).toMatch(/^name = "espanolhonesto-env-required"/mu);
        expect(web).toContain('[env.production]');
        expect(web).toContain('name = "espanolhonesto"');
        expect(web).toContain('pattern = "staging.espanolhonesto.com"');
        expect(web).toContain('custom_domain = true');
        expect(web).toContain('preview_urls = false');
        expect(fulfillment).toMatch(/^name = "espanol-honesto-fulfillment-env-required"/mu);
        expect(fulfillment).toContain('name = "espanol-honesto-fulfillment-production"');
        const webBootstrap = web.slice(web.indexOf('[env.production_bootstrap]'), web.indexOf('[env.production]'));
        const webProduction = web.slice(web.indexOf('[env.production]'));
        const fulfillmentBootstrap = fulfillment.slice(
            fulfillment.indexOf('[env.production_bootstrap]'),
            fulfillment.indexOf('[env.production]'),
        );
        const fulfillmentProduction = fulfillment.slice(fulfillment.indexOf('[env.production]'));
        for (const productionSection of [webBootstrap, webProduction, fulfillmentBootstrap, fulfillmentProduction]) {
            expect(productionSection).toContain('workers_dev = true');
            expect(productionSection).toContain('preview_urls = false');
        }
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
        expect(productionBuild).toContain('disableProductionReleaseSentryUpload(process.env)');
        expect(productionBuild).toContain("entry === '.dev.vars'");

        expect(ci).toContain('if: github.ref_name == \'main\'');
        expect(ci).toContain('wrangler deploy --config workers/fulfillment/wrangler.toml --env production_bootstrap --dry-run');
        expect(ci).toContain('wrangler deploy --config workers/fulfillment/wrangler.toml --env production --dry-run');
        expect(ci).toContain('Production CI completed build and dry-runs only.');
        expect(ci).toContain('if: github.ref_name == \'staging\'');
        expect(ci).toContain('wrangler deploy --config workers/fulfillment/wrangler.toml --env staging --keep-vars');
        expect(ci).toContain('deploy-built-worker.ts --environment "$CLOUDFLARE_ENV" --dry-run');
        expect(ci).toContain('run: pnpm run deploy');
        expect(ci).not.toContain('wrangler deploy --config workers/fulfillment/wrangler.toml --env production --keep-vars');
        expect(ci).not.toContain('run deploy -- --env');
    });

    it('hardens CI identity, repository credentials and staging deploy ordering', () => {
        const ci = read('.github/workflows/ci.yml');
        const deployJob = ci.slice(ci.indexOf('  deploy-cloudflare:'));

        expect(ci).toMatch(/^permissions:\r?\n {2}contents: read$/mu);
        expect(ci).toContain('group: ci-${{ github.workflow }}-${{ github.ref }}');
        expect(ci).toContain("cancel-in-progress: ${{ github.ref != 'refs/heads/staging' }}");
        expect(ci).toContain("if: github.event_name == 'push' && (github.ref == 'refs/heads/main' || github.ref == 'refs/heads/staging')");

        const checkoutUses = ci.match(/uses: actions\/checkout@v4/gu) ?? [];
        const hardenedCheckouts = ci.match(/uses: actions\/checkout@v4\r?\n {8}with:\r?\n {10}persist-credentials: false/gu) ?? [];
        expect(checkoutUses).toHaveLength(2);
        expect(hardenedCheckouts).toHaveLength(checkoutUses.length);

        const stagingHeadGate = deployJob.indexOf('Reject a superseded staging deploy');
        const identityPreflight = deployJob.indexOf('Verify exact Cloudflare identity before deploy validation');
        const firstDryRun = deployJob.indexOf('--dry-run');
        expect(stagingHeadGate).toBeGreaterThan(-1);
        expect(stagingHeadGate).toBeLessThan(identityPreflight);
        expect(identityPreflight).toBeGreaterThan(-1);
        expect(identityPreflight).toBeLessThan(firstDryRun);
        expect(deployJob).toContain("if: github.ref == 'refs/heads/staging'");
        expect(deployJob).toContain('$GITHUB_API_URL/repos/$GITHUB_REPOSITORY/git/ref/heads/staging');
        expect(deployJob).toContain('branchRef?.object?.sha !== expectedSha');
        expect(deployJob).toContain('Refusing superseded staging deploy; a newer branch head exists.');
        expect(deployJob).toContain('EXPECTED_CLOUDFLARE_ACCOUNT_ID: d1a22bcf6477ff2ff31d2bfb83084e44');
        expect(deployJob).toContain('pnpm exec wrangler whoami --json --install-skills=false');
        expect(deployJob).toContain('pnpm exec tsx scripts/ci/verify-cloudflare-identity.ts');
        expect(deployJob).toContain('--expected-account-id "$EXPECTED_CLOUDFLARE_ACCOUNT_ID"');
        expect(deployJob).toContain('CLOUDFLARE_ACCOUNT_ID does not match the exact approved account.');
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
            'build:production:release',
            'activeDeployDryRun',
            'activeDeploy',
            'validateBuiltActiveConfig',
            "runWebRuntimeAttestation(baseUrl, expectedVersionId, env, 'active'",
            'compensateToWebBootstrap',
            'compensating_web_bootstrap_proven',
            'initialApprovalSentence',
            'initialReconciliationApprovalSentence',
            '--reconcile-approved',
            'exact_reconciliation_approval_gate',
            'exclusive_reconciliation_lock_acquired',
            'recovery_bootstrap_compensation_required',
            'reconcilePriorCheckpointToSafeState',
            'canonical_write_state_restart_gate',
            'requireRecoverableWorkerWriteExecutionLock',
            'assertRecoveryWriteLockOwnership',
            'acquireNormalWorkerWriteExecutionLock',
            'reconciliationLockExists',
            'EXECUTED_AND_NEEDS_REVIEW',
            'exact_bootstrap_secret_inventory_pre_write',
            'remote_google_bindings_absent_pre_write',
            'remote_google_bindings_absent_after_active_deploy',
            'remote_google_bindings_absent_after_bootstrap_compensation',
            'persistWorkerWriteCheckpointAtomically',
            'readonlyReconciliationRequired',
            'verifyCloudflareWhoamiOutput',
            'wrangler versions view',
            'initial_validation_gate',
            'externalWriteAttempted',
        ]) expect(runner).toContain(snippet);

        expect(runner.indexOf('remoteTargetCheck.status')).toBeLessThan(runner.indexOf('for (const name of requiredSecretNames)'));
        expect(runner.indexOf('validateFreshStripeLiveReadiness(env)')).toBeLessThan(runner.indexOf('for (const name of requiredSecretNames)'));
        expect(runner.indexOf('staticCommands.activeBuild')).toBeLessThan(runner.indexOf('for (const name of requiredSecretNames)'));
        expect(runner.indexOf('const immediateBootstrapChecks')).toBeLessThan(runner.indexOf('for (const name of requiredSecretNames)'));
        expect(runner.indexOf('exact_bootstrap_secret_inventory_pre_write')).toBeLessThan(runner.indexOf('for (const name of requiredSecretNames)'));
        expect(runner.indexOf('remote_google_bindings_absent_pre_write')).toBeLessThan(runner.indexOf('for (const name of requiredSecretNames)'));
        expect(runner.indexOf('for (const name of requiredSecretNames)')).toBeLessThan(runner.indexOf('runCommand(staticCommands.activeDeploy)'));
        expect(runner.indexOf('runCommand(staticCommands.activeDeploy)')).toBeLessThan(runner.indexOf('runDirectWorkerProbes(env.directWorkerUrl'));

        const recovery = runner.slice(
            runner.indexOf('async function runApprovedReconciliation'),
            runner.indexOf('function asRecoveryObservation'),
        );
        expect(recovery).toContain('commands.whoami');
        expect(recovery).toContain('commands.deploymentsList');
        expect(recovery).toContain('commands.secretListBefore');
        expect(recovery).toContain('buildVersionViewCommand');
        expect(recovery).toContain('compensateToWebBootstrap');
        expect(recovery).not.toContain('buildSecretPutCommand');
        expect(recovery.indexOf('commands.whoami')).toBeLessThan(recovery.indexOf('compensateToWebBootstrap'));
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
            "path.join(outputDir, 'summary.json')",
        ]) expect(runner).toContain(snippet);
    });

    it('orders bootstrap, HMAC-only bootstrap secrets, web and explicit final enable in the manifest', () => {
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
            'fresh_production_queue_inventory_pre_enable',
            'fresh_production_queue_info_pre_enable',
            'fresh_stripe_live_readiness_immediately_before_enable',
            'structured_enable_prewrite_evidence',
            "cronScheduleProbe('bootstrap')",
            'compensating_bootstrap_rollback_proven',
        ]) expect(lifecycle).toContain(snippet);

        const orderedPhases = [
            'phase_1_fulfillment_inert_bootstrap',
            'phase_2_fulfillment_bootstrap_hmac_only',
            'phase_3_fresh_bootstrap_attestation_before_web',
            'phase_4_web_worker_create_deploy',
            'phase_5_web_bootstrap_hmac_only',
            'phase_6_fulfillment_final_secrets_while_inert',
            'phase_7_web_final_secrets_and_active_deploy',
            'phase_8_fresh_dual_worker_attestation',
            'phase_9_fulfillment_explicit_enable',
            'phase_10_direct_worker_attestation',
            'phase_11_domain_move',
        ];
        for (let index = 1; index < orderedPhases.length; index += 1) {
            expect(manifest.indexOf(orderedPhases[index - 1])).toBeLessThan(manifest.indexOf(orderedPhases[index]));
        }
        expect(webRunner).toContain('validateFulfillmentBootstrapEvidence()');
        expect(webRunner).toContain('validateFulfillmentBootstrapSecretsEvidence()');
        expect(webRunner).toContain("const fulfillmentBootstrapSecretNames = [");
        expect(webRunner).toContain("config.googleBoundary === 'absent'");
        expect(webRunner).toContain('initial_validation_gate');
        expect(webRunner).toContain('externalWriteAttempted = true');
    });

    it('documents the canonical production manual order without loading final providers before web bootstrap', () => {
        const workflow = read('.github/workflows/ci.yml');
        const order = workflow.match(/Required manual order: ([^"\r\n]+)/u)?.[1] ?? '';

        expect(order).toContain('fulfillment HMAC-only secret -> web bootstrap -> web HMAC-only secret');
        expect(order.indexOf('web HMAC-only secret')).toBeLessThan(order.indexOf('fulfillment final secrets'));
        expect(order.indexOf('fulfillment final secrets')).toBeLessThan(order.indexOf('web active deploy/final secrets'));
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
