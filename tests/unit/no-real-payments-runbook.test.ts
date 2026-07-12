import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (file: string) => readFileSync(file, 'utf8');

describe('no-real-payments launch mode', () => {
    it('keeps the no-real-payments gate wired to checkout safeguards and docs', () => {
        const packageJson = read('package.json');
        const script = read('scripts/launch/no-real-payments.ts');
        const remediation = read('scripts/launch/staging-no-real-payments-remediation.ts');
        const releaseCandidate = read('scripts/launch/release-candidate.ts');
        const statusScript = read('scripts/launch/status.ts');
        const guide = read('docs/launch/NO_REAL_PAYMENTS.md');
        const ci = read('.github/workflows/ci.yml');
        const launchSequence = read('docs/launch/LAUNCH_SEQUENCE.md');
        const checklist = read('docs/launch/CHECKLIST.md');
        const wrangler = read('wrangler.toml');

        expect(packageJson).toContain('launch:no-real-payments');
        expect(packageJson).toContain('scripts/launch/no-real-payments.ts');
        expect(packageJson).toContain('launch:staging-no-real-payments-remediation');
        expect(packageJson).toContain('scripts/launch/staging-no-real-payments-remediation.ts');
        expect(packageJson).toContain('launch:rc-external-closure');
        expect(packageJson).toContain('scripts/launch/rc-external-closure.ts');
        expect(wrangler).toContain('CHECKOUT_ENABLED = "false"');

        for (const snippet of [
            'CHECKOUT_ENABLED=false',
            'Checkout is disabled',
            'checkoutMode={checkoutMode}',
            'CHECKOUT_ENABLED_OVERRIDE',
            'tests/api/create-checkout.test.ts',
            'tests/e2e/checkout.public.spec.ts',
            'launch:payments',
            'manual-evidence-dry-run.txt',
            'payments_staging',
            '--deployed-url',
            '/api/create-checkout',
            'POST empty JSON body',
            'does not contact Stripe',
            'deployed environment',
            "jsonResponse({ error: 'Checkout is disabled' }, 403)",
        ]) {
            expect(script).toContain(snippet);
        }

        for (const snippet of [
            'corepack pnpm launch:no-real-payments',
            '--deployed-url https://espanolhonesto-staging.alindev95.workers.dev',
            'corepack pnpm launch:staging-no-real-payments-remediation',
            'CHECKOUT_ENABLED=false',
            'CHECKOUT_ENABLED = "false"',
            'falla cerrado con 403',
            '403 `Checkout is disabled`',
            '`400` con `priceId is required`',
            'corregir `CHECKOUT_ENABLED=false`',
            'solo basta si el despliegue ya contiene el guard',
            'empaquetar/commitear y redeployar primero el codigo actual',
            'modo `application`',
            'Variables reales desplegadas',
            'manual-evidence-dry-run.txt',
            'local_deployment_gap',
            'working tree',
            'codigo/config anterior',
            'No tratar una variable sola como cierre suficiente',
            'Usar `manual-evidence-dry-run.txt` solo despues de que el post-fix probe desplegado pase',
            'no registrar `payments_staging` como cerrado',
            'CI ejecuta `pnpm run launch:no-real-payments`',
            'Worker canónico `https://espanolhonesto-staging.alindev95.workers.dev`',
            'ni depende de una variable externa',
            'https://staging.espanolhonesto.com',
            'deploy de staging no debe considerarse apto para RC',
        ]) {
            expect(guide).toContain(snippet);
        }

        for (const snippet of [
            'pnpm run launch:no-real-payments',
            'CHECKOUT_ENABLED: "false"',
            'Verify staging checkout is disabled',
            'STAGING_WORKER_URL: https://espanolhonesto-staging.alindev95.workers.dev',
            '--deployed-url "$STAGING_WORKER_URL"',
        ]) {
            expect(ci).toContain(snippet);
        }

        expect(launchSequence).toContain('pnpm launch:no-real-payments');
        expect(launchSequence).toContain('Stripe Checkout sin decision explicita');
        expect(releaseCandidate).toContain('CLOUDFLARE_STAGING_URL');
        expect(releaseCandidate).toContain('CLOUDFLARE_WORKERS_STAGING_URL');
        expect(releaseCandidate).toContain('DEFAULT_WORKER_STAGING_URL');
        expect(releaseCandidate).toContain('https://espanolhonesto-staging.alindev95.workers.dev');
        expect(releaseCandidate).toContain('stagingUrl');
        expect(releaseCandidate).toContain("runStep('launch:no-real-payments', ['--', '--deployed-url', stagingUrl])");
        expect(releaseCandidate).toContain("runStep('launch:staging-no-real-payments-remediation', ['--', '--deployed-url', stagingUrl])");
        expect(releaseCandidate).toContain("runStep('launch:rc-external-closure')");
        expect(checklist).toContain('launch:no-real-payments');
        expect(statusScript).toContain('launch-staging-no-real-payments-remediation');
        expect(statusScript).toContain('launch-rc-external-closure');
        expect(statusScript).toContain('RC External Closure');
        expect(statusScript).toContain('no_real_payments_staging');
        expect(statusScript).toContain('staging checkout not blocked');
        expect(statusScript).toContain('staging no-real-payments build manifest');
        expect(statusScript).toContain('Staging No-Real-Payments Build Manifest');

        for (const snippet of [
            'espanolhonesto-staging',
            'DEFAULT_WORKER_STAGING_URL',
            'https://espanolhonesto-staging.alindev95.workers.dev',
            'CLOUDFLARE_WORKERS_STAGING_URL',
            'wrangler_worker_deployments_status',
            'wrangler_worker_deployments_list',
            'worker-staging-build-manifest.json',
            'buildPackageManifestPath',
            'BuildPackageManifest',
            'readyForStagingDeployPackage',
            'inspectPagesBuildPackage',
            'withinPagesFileCountLimit',
            'withinPagesFileSizeLimit',
            'checkoutEnabledDefault',
            'nodejsCompat',
            'Local Worker build output contains the checkout-disabled guard and deploy package basics needed for staging deploy.',
            'local_build_package_guard',
            'corepack pnpm build',
            'Worker staging build package manifest includes checkout-disabled guard',
            'local_deployment_gap',
            'git diff',
            'working-tree-only fixes',
            'committed and redeployed',
            'CHECKOUT_ENABLED=false',
            'Worker/environment that serves staging',
            'do not rely on a variable-only fix',
            'package and redeploy current code/config',
            'variable-only change is not enough',
            'package/redeploy current code/config to staging first',
            'readyForStagingDeployPackage=true',
            'Cloudflare Worker Staging No-Real-Payments Approval Request',
            'approval-request.md',
            'Manual Evidence Dry Run: Staging No-Real-Payments',
            'manualEvidenceDryRunPath',
            'manual-evidence-dry-run.txt',
            'Use this only after the Cloudflare Worker staging fix is complete',
            '--id payments_staging',
            'relativeToLaunchDocs',
            'Expected: deployed checkout probe returns 403 Checkout is disabled',
            'Production Worker, custom production domain, Stripe live and real checkout enablement are excluded.',
            'It does not deploy, change variables, delete deployments, write secrets, call Stripe',
            'corepack pnpm launch:no-real-payments -- --deployed-url',
            'if (failed.length > 0) process.exit(1)',
        ]) {
            expect(remediation).toContain(snippet);
        }

        expect(remediation).not.toContain('intended Pages staging/production environment');
    });
});
