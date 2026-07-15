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
        const buildAndTestJob = workflow.slice(workflow.indexOf('  build-and-test:'));
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
        const workflow = read('.github/workflows/deploy-staging.yml');

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
        expect(workflow).toContain('deploy-built-worker.ts --environment staging --dry-run');
        expect(workflow).toContain('pnpm run deploy');
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

    it('keeps CI validation-only while staging uses an explicit manual deploy and production stays gated', () => {
        const ci = read('.github/workflows/ci.yml');
        const stagingDeploy = read('.github/workflows/deploy-staging.yml');
        const packageJson = read('package.json');
        const productionBuild = read('scripts/dev/build-production-release.ts');

        expect(packageJson).toContain('"build:production:release": "tsx scripts/dev/build-production-release.ts"');
        expect(productionBuild).toContain("process.env.CLOUDFLARE_ENV = 'production'");
        expect(productionBuild).toContain("process.env.PUBLIC_APP_ENV = 'production'");
        expect(productionBuild).toContain("SUPABASE_EXPECTED_PROJECT_REF=${productionRef}");
        expect(productionBuild).toContain('PUBLIC_SITE_URL=${productionSite}');
        expect(productionBuild).toContain("process.env.CLOUDFLARE_INCLUDE_PROCESS_ENV = 'false'");
        expect(productionBuild).toContain('disableProductionReleaseSentryUpload(process.env)');
        expect(productionBuild).toContain("entry === '.dev.vars'");

        expect(ci).toContain('branches: [ main ]');
        expect(ci).not.toContain('branches: [ main, staging ]');
        expect(ci).not.toContain('deploy-cloudflare:');
        expect(ci).not.toContain('CLOUDFLARE_API_TOKEN');
        expect(ci).not.toContain('run: pnpm run deploy');
        expect(stagingDeploy).toContain('workflow_dispatch:');
        expect(stagingDeploy).toContain('environment: staging');
        expect(stagingDeploy).toContain('pnpm exec wrangler deploy --config workers/fulfillment/wrangler.toml --env staging --keep-vars');
        expect(stagingDeploy).toContain('deploy-built-worker.ts --environment staging --dry-run');
        expect(stagingDeploy).toContain('pnpm run deploy');
        expect(stagingDeploy).toContain('This privileged workflow must be dispatched from refs/heads/main.');
        expect(stagingDeploy).toContain('scripts/ci/verify-staging-deploy-environment.ts');
        expect(stagingDeploy).toContain('pnpm run launch:staging-operations -- --include-wrangler');
        expect(ci).not.toContain('wrangler deploy --config workers/fulfillment/wrangler.toml --env production --keep-vars');
        expect(stagingDeploy).not.toContain('--env production');
        expect(stagingDeploy).not.toContain('--environment production');
    });

    it('hardens CI identity, exact-SHA approval and staging deploy ordering', () => {
        const ci = read('.github/workflows/ci.yml');
        const deployJob = read('.github/workflows/deploy-staging.yml');
        const buildAndTestJob = ci.slice(ci.indexOf('  build-and-test:'));
        const buildCheckout = buildAndTestJob.slice(
            buildAndTestJob.indexOf('      - name: Checkout code'),
            buildAndTestJob.indexOf('      - name: Install pnpm'),
        );
        const deployCheckout = deployJob.slice(
            deployJob.indexOf('      - name: Checkout exact commit'),
            deployJob.indexOf('      - name: Verify checked-out commit'),
        );

        expect(ci).toMatch(/^permissions:\r?\n {2}contents: read$/mu);
        expect(ci).toContain('group: ci-${{ github.workflow }}-${{ github.ref }}');
        expect(ci).toContain('cancel-in-progress: true');
        expect(deployJob).toContain('workflow_dispatch:');
        expect(deployJob).toContain('WORKFLOW_REF: ${{ github.ref }}');
        expect(deployJob).toContain('This privileged workflow must be dispatched from refs/heads/main.');
        expect(deployJob).toContain('group: cloudflare-staging-deploy');
        expect(deployJob).toContain('cancel-in-progress: false');

        const checkoutUses = ci.match(/uses: actions\/checkout@v4/gu) ?? [];
        const hardenedCheckouts = ci.match(/uses: actions\/checkout@v4\r?\n {8}with:\r?\n {10}persist-credentials: false/gu) ?? [];
        expect(checkoutUses).toHaveLength(1);
        expect(hardenedCheckouts).toHaveLength(checkoutUses.length);
        expect(buildCheckout).toContain('persist-credentials: false');
        expect(buildCheckout).toContain('fetch-depth: 0');
        expect(deployCheckout).toContain('persist-credentials: false');
        expect(deployCheckout).toContain('fetch-depth: 0');
        expect(deployCheckout).toContain('ref: ${{ inputs.commit_sha }}');

        const commitGate = deployJob.indexOf('Require successful CI for the exact commit');
        const identityPreflight = deployJob.indexOf('Verify exact Cloudflare identity');
        const firstDryRun = deployJob.indexOf('--dry-run');
        expect(commitGate).toBeGreaterThan(-1);
        expect(commitGate).toBeLessThan(identityPreflight);
        expect(identityPreflight).toBeGreaterThan(-1);
        expect(identityPreflight).toBeLessThan(firstDryRun);
        expect(deployJob).toContain('commit_sha must be a full lowercase 40-character Git commit SHA.');
        expect(deployJob).toContain('check-runs?per_page=100');
        expect(deployJob).toContain('run.name === "build-and-test"');
        expect(deployJob).toContain('run.conclusion === "success"');
        expect(deployJob).toContain('Refusing staging deploy: exact commit has no successful build-and-test check.');
        expect(deployJob).toContain('EXPECTED_CLOUDFLARE_ACCOUNT_ID: d1a22bcf6477ff2ff31d2bfb83084e44');
        expect(deployJob).toContain('pnpm exec wrangler whoami --json --install-skills=false');
        expect(deployJob).toContain('pnpm exec tsx scripts/ci/verify-cloudflare-identity.ts');
        expect(deployJob).toContain('--expected-account-id "$EXPECTED_CLOUDFLARE_ACCOUNT_ID"');
        expect(deployJob).toContain('CLOUDFLARE_ACCOUNT_ID does not match the exact staging account.');
        expect(deployJob.indexOf('Verify exact staging provider identities')).toBeLessThan(
            deployJob.indexOf('Build exact staging package'),
        );
        expect(deployJob.indexOf('Deploy staging web Worker')).toBeLessThan(
            deployJob.indexOf('Verify staging Fulfillment runtime and bindings'),
        );
        expect(deployJob).toContain('Record partial-deploy recovery requirement');
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
            "const deployTag = createOneShotCloudflareDeployTag(writeGuard, 'fulfillment-bootstrap')",
            "'fulfillment-bootstrap-deploy',\n        'production_bootstrap',\n        false,\n        deployTag,",
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
            'bootstrap_deploy_version_changed',
            'workerDeployCheckpointMatchesCurrentVersion',
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
        for (const runner of [lifecycle, webRunner]) {
            expect(runner).toContain('createOneShotCloudflareDeployTag');
            expect(runner).toContain("'--tag', deployTag");
            expect(runner).toContain('workerVersionTagFromView');
            expect(runner).toContain('capturedUnderWriteGuard=true');
        }
    });

    it('documents the canonical production manual order without loading final providers before web bootstrap', () => {
        const runbook = read('docs/launch/RUNBOOK.md');
        const orderedCommands = [
            'launch:cloudflare-production-fulfillment-bootstrap',
            'launch:cloudflare-production-fulfillment-bootstrap-secrets',
            'launch:cloudflare-production-worker-phase1',
            'launch:cloudflare-production-worker-bootstrap-secrets',
            'launch:cloudflare-production-fulfillment-secrets',
            'launch:cloudflare-production-worker-secrets',
            'launch:cloudflare-production-fulfillment-enable',
        ];

        for (let index = 1; index < orderedCommands.length; index += 1) {
            expect(runbook.indexOf(orderedCommands[index - 1])).toBeLessThan(runbook.indexOf(orderedCommands[index]));
        }
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
