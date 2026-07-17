import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
    googleRuntimeVariableNames,
    scrubBootstrapEnvironment,
    validateBootstrapBundle,
    validateGeneratedBootstrap,
} from '../../scripts/dev/build-production-bootstrap';

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
            "'GOOGLE_SERVICE_ACCOUNT_EMAIL'",
            "'GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY'",
            "'GOOGLE_ADMIN_EMAIL'",
            "'GOOGLE_DRIVE_ROOT_FOLDER_ID'",
            "'GOOGLE_TEMPLATE_DOC_ID'",
            'scrubBootstrapEnvironment(process.env)',
            'delete process.env[key]',
            'installBootstrapEntry(generatedConfigPath)',
            "const ALLOWED_PATHS = new Set(['/health', '/api/internal/runtime-attestation'])",
            'config.main = wrapperName',
            'validateGeneratedBootstrap(generatedConfigPath)',
            'validateBootstrapBundle(distRoot, sourceCredentialValues)',
            'forbidden Google names in generated config=',
            'assets.run_worker_first=true',
        ]) expect(bootstrap).toContain(snippet);
        expect(astro).toContain("cloudflareTarget === 'production' && legalIdentityIsExample");
        expect(active).toContain("process.env.WEB_RUNTIME_MODE = 'active'");
    });

    it('scrubs Google env, rejects resolved bindings and rejects provider values without rejecting attestation contract names', () => {
        expect(googleRuntimeVariableNames).toEqual([
            'GOOGLE_SERVICE_ACCOUNT_EMAIL',
            'GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY',
            'GOOGLE_ADMIN_EMAIL',
            'GOOGLE_DRIVE_ROOT_FOLDER_ID',
            'GOOGLE_TEMPLATE_DOC_ID',
        ]);

        const adversarialEnvironment: NodeJS.ProcessEnv = { SAFE_BOOTSTRAP_VALUE: 'preserved' };
        for (const key of googleRuntimeVariableNames) adversarialEnvironment[key] = `adversarial-${key}`;
        scrubBootstrapEnvironment(adversarialEnvironment);
        expect(adversarialEnvironment.SAFE_BOOTSTRAP_VALUE).toBe('preserved');
        for (const key of googleRuntimeVariableNames) {
            expect(Object.prototype.hasOwnProperty.call(adversarialEnvironment, key)).toBe(false);
        }

        const fixtureRoot = mkdtempSync(path.join(tmpdir(), 'cloudflare-web-bootstrap-safety-'));
        try {
            const configDirectory = path.join(fixtureRoot, 'server');
            const configPath = path.join(configDirectory, 'wrangler.json');
            mkdirSync(configDirectory, { recursive: true });
            const cleanConfig = {
                main: 'bootstrap-entry.mjs',
                name: 'espanolhonesto',
                vars: {
                    PUBLIC_APP_ENV: 'production',
                    WEB_RUNTIME_MODE: 'bootstrap',
                    SUPABASE_EXPECTED_PROJECT_REF: 'vkkahxsybhbutszerawz',
                    CHECKOUT_ENABLED: 'false',
                    CHECKOUT_ENABLED_OVERRIDE: 'false',
                    EMAIL_DELIVERY_MODE: 'disabled',
                    EMAIL_DAILY_RECIPIENT_LIMIT: '0',
                    EMAIL_MONTHLY_RECIPIENT_LIMIT: '0',
                },
                assets: { run_worker_first: true },
                kv_namespaces: [],
                routes: [],
                services: [
                    {
                        binding: 'FULFILLMENT_SERVICE',
                        service: 'espanol-honesto-fulfillment-production',
                    },
                ],
            };
            const writeConfig = (value: unknown) => writeFileSync(configPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');

            writeConfig(cleanConfig);
            expect(() => validateGeneratedBootstrap(configPath)).not.toThrow();

            for (const key of googleRuntimeVariableNames) {
                writeConfig({
                    ...cleanConfig,
                    vars: { ...cleanConfig.vars, [key]: 'adversarial-google-binding' },
                });
                expect(() => validateGeneratedBootstrap(configPath)).toThrow(`forbidden bootstrap vars=${key}`);

                writeConfig({
                    ...cleanConfig,
                    adversarial_nested_config: { provider_variable_name: key },
                });
                expect(() => validateGeneratedBootstrap(configPath)).toThrow(
                    `forbidden Google names in generated config=${key}`,
                );
            }

            const bundleDirectory = path.join(fixtureRoot, 'bundle');
            const bundlePath = path.join(bundleDirectory, 'entry.mjs');
            mkdirSync(bundleDirectory, { recursive: true });
            writeFileSync(bundlePath, 'export default { fetch() { return new Response("bootstrap"); } };\n', 'utf8');
            expect(() => validateBootstrapBundle(bundleDirectory, new Map())).not.toThrow();

            writeFileSync(
                bundlePath,
                `${googleRuntimeVariableNames.map((key) => `const ${key} = '${key}';`).join('\n')}\n`,
                'utf8',
            );
            expect(() => validateBootstrapBundle(bundleDirectory, new Map())).not.toThrow();

            for (const key of googleRuntimeVariableNames) {
                const providerValue = `unique-provider-value-${key}`;
                writeFileSync(bundlePath, `export default ${JSON.stringify(providerValue)};\n`, 'utf8');
                expect(() => validateBootstrapBundle(bundleDirectory, new Map([[key, providerValue]]))).toThrow(key);
            }

            const multilinePrivateKey = [
                '-----BEGIN ' + 'PRIVATE KEY-----',
                'unique-private-key-material',
                '-----END ' + 'PRIVATE KEY-----',
            ].join('\n');
            writeFileSync(bundlePath, `export default ${JSON.stringify(multilinePrivateKey)};\n`, 'utf8');
            expect(readFileSync(bundlePath, 'utf8')).not.toContain(multilinePrivateKey);
            expect(() => validateBootstrapBundle(bundleDirectory, new Map([
                ['GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY', multilinePrivateKey],
            ]))).toThrow('GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY');
        } finally {
            rmSync(fixtureRoot, { force: true, recursive: true });
        }
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
            'pnpm --config.verify-deps-before-run=false run build:production:bootstrap',
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
            'web_bootstrap_prewrite_version_identity',
            'web_bootstrap_deploy_version_changed',
            'workerDeployCheckpointMatchesCurrentVersion',
            'buildCloudflareProductionInertCompositeEvidence',
            'production-inert-web-fulfillment-evidence.json',
            'production_inert_composite_evidence_inputs',
            '`versionId=${result.value}`',
            'WEB_RUNTIME_BOOTSTRAP',
            'No final legal identity requirement',
            'externalWriteAttempted = true',
        ]) expect(runner).toContain(snippet);
        const reconciliation = runner.slice(
            runner.indexOf("reconcileOneShotCloudflareWriteGuard(\n        'web-bootstrap-deploy'"),
            runner.indexOf("openOneShotCloudflareWriteGuard('web-bootstrap-deploy'"),
        );
        expect(reconciliation).toContain('retryWebBootstrapDeployEvidence');
        expect(runner).toContain('workerDeployCheckpointMatchesCurrentVersion');
        expect(runner).toContain('versionId');
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
        expect(executionGate).not.toContain('CLOUDFLARE_API_TOKEN');
        expect(runner).toContain('withCloudflareWranglerOAuth');
        expect(runner).toContain('requestAllowlistedCloudflareAccount');
        expect(runner).toContain('runCloudflareWranglerFromKeyring');

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
            'phase1_web_fulfillment_composite_before_secrets',
            'phase1_composite_immediately_before_secret_write',
            'readCloudflareProductionInertCompositeEvidence',
            'buildCloudflareProductionInertCompositeEvidence',
            'production-inert-web-fulfillment-evidence.json',
            'maxAgeMs=300000',
            'sequence=Cloudflare C-D-E immediately before launch:status',
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
        expect(runner).not.toContain('latestGeneratedPathMatching');
        expect(runner).not.toContain("['- Status: OK', '- Execute requested: true'");

        const minimalSet = runner.slice(
            runner.indexOf('const requiredSecretNames = ['),
            runner.indexOf('const explicitlyWithheldSecretNames = ['),
        );
        expect(minimalSet).toContain("'INTERNAL_JOB_SECRET'");
        expect(minimalSet).not.toContain("'PUBLIC_SUPABASE_URL'");
        expect(minimalSet).not.toContain("'PUBLIC_SUPABASE_ANON_KEY'");

        const execution = runner.slice(runner.indexOf('async function runApprovedExecution'));
        expect(execution.indexOf('validateRemoteTarget(captures)')).toBeLessThan(execution.indexOf('const name = requiredSecretNames[0]'));
        expect(execution.indexOf("probeBootstrapRoutes('pre_write')")).toBeLessThan(execution.indexOf('const name = requiredSecretNames[0]'));
        expect(finalRunner).toContain('fresh_stripe_live_readiness_pre_write_gate');
        expect(finalRunner).toContain('stripeMode=live');
    });

    it('bounds only C-D-E readbacks while each approved mutation remains a one-shot outside the retry helper', () => {
        const fulfillmentSecrets = read('scripts/launch/cloudflare-production-fulfillment-bootstrap-secrets.ts');
        const webDeploy = read('scripts/launch/cloudflare-production-worker-phase1.ts');
        const webSecrets = read('scripts/launch/cloudflare-production-worker-bootstrap-secrets.ts');

        for (const source of [fulfillmentSecrets, webDeploy, webSecrets]) {
            expect(source).toContain("from './cloudflare-readonly-retry'");
            expect(source).toContain('retryCloudflareReadonlyEvidence({');
            expect(source).toContain('readonlyOutcome=retryable');
            expect(source).toContain('readonlyOutcome=definitive_failure');
            expect(source).toContain('attempt-${attempt}');
        }

        const fulfillmentMutation = fulfillmentSecrets.indexOf('const capture = runCommand(command, `${secretValue(name)}\\n`);');
        const fulfillmentRetry = fulfillmentSecrets.indexOf('const postWriteReadback = await retryFulfillmentBootstrapSecretEvidence(');
        expect(fulfillmentMutation).toBeGreaterThan(-1);
        expect(fulfillmentRetry).toBeGreaterThan(fulfillmentMutation);
        const fulfillmentHelper = fulfillmentSecrets.slice(
            fulfillmentSecrets.indexOf('async function retryFulfillmentBootstrapSecretEvidence('),
            fulfillmentSecrets.indexOf('function validateExecutionEnvironment()'),
        );
        expect(fulfillmentHelper).not.toContain('secretPutCommand(');
        expect(fulfillmentHelper).not.toContain('writesCloudflare: true');

        const deployMutation = webDeploy.indexOf('const deployCapture = runCommand(taggedDeployCommand);');
        const deployRetry = webDeploy.indexOf('const postDeployReadback = await retryWebBootstrapDeployEvidence(');
        expect(deployMutation).toBeGreaterThan(-1);
        expect(deployRetry).toBeGreaterThan(deployMutation);
        const deployHelper = webDeploy.slice(
            webDeploy.indexOf('async function retryWebBootstrapDeployEvidence('),
            webDeploy.indexOf('function validateFreshReadonlyWebShapeBeforeDeploy()'),
        );
        expect(deployHelper).not.toContain('taggedDeployCommand');
        expect(deployHelper).not.toContain('deployKeepVars');
        expect(deployHelper).not.toContain('writesCloudflare: true');
        expect(webDeploy).toContain('isRetryableCloudflareReadonlyStatus(healthResponse.status, [404])');

        const webSecretMutation = webSecrets.indexOf('const secretCapture = runCommand(secretCommand, `${value}\\n`);');
        const webSecretRetry = webSecrets.indexOf('const postWriteReadback = await retryWebBootstrapSecretEvidence(');
        expect(webSecretMutation).toBeGreaterThan(-1);
        expect(webSecretRetry).toBeGreaterThan(webSecretMutation);
        const webSecretHelper = webSecrets.slice(
            webSecrets.indexOf('async function retryWebBootstrapSecretEvidence('),
            webSecrets.indexOf('function validateRemoteTarget('),
        );
        expect(webSecretHelper).not.toContain('buildSecretPutCommand(');
        expect(webSecretHelper).not.toContain('writesCloudflare: true');

        expect(fulfillmentSecrets).toContain('isRetryableCloudflareReadonlyStatus(response.status, [401])');
        expect(webSecrets).toContain('isRetryableCloudflareReadonlyStatus(response.status, [401])');
        expect(webDeploy).toContain('isRetryableCloudflareReadonlyStatus(attestationResponse.status, [401])');
        expect(webDeploy.indexOf("const blockedResponse = await fetch(new URL('/internal/jobs/process'"))
            .toBeLessThan(webDeploy.indexOf('httpStatus = blockedResponse.status'));
        expect(fulfillmentSecrets).toContain('A 200 attestation was cryptographically invalid');
        expect(webSecrets).toContain('A 200 web attestation was cryptographically invalid');
    });
});
