import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('scripts/launch/cloudflare-production-runtime-readonly.ts', 'utf8');
const packageJson = readFileSync('package.json', 'utf8');
const finalApprovalQueue = readFileSync('scripts/launch/final-approval-queue.ts', 'utf8');
const cutoverPack = readFileSync('scripts/launch/cloudflare-production-runtime-cutover.ts', 'utf8');
const integrationFinalPackage = readFileSync('scripts/launch/integration-final-package.ts', 'utf8');
const finalReadiness = readFileSync('scripts/launch/final-readiness-audit.ts', 'utf8');
const statusScript = readFileSync('scripts/launch/status.ts', 'utf8');
const manualRunbook = readFileSync('docs/launch/MANUAL_EVIDENCE_RUNBOOK.md', 'utf8');
const manualEvidenceDoc = readFileSync('docs/launch/MANUAL_EVIDENCE.md', 'utf8');
const manualExample = readFileSync('docs/launch/MANUAL_EVIDENCE.example.json', 'utf8');

describe('Cloudflare production runtime read-only evidence', () => {
    it('is wired into pnpm scripts, final queue, integration package and launch status', () => {
        expect(packageJson).toContain('"launch:cloudflare-production-runtime-readonly": "tsx scripts/launch/cloudflare-production-runtime-readonly.ts"');
        expect(finalApprovalQueue).toContain('launch:cloudflare-production-runtime-readonly');
        expect(integrationFinalPackage).toContain('cloudflare_runtime_readonly');
        expect(integrationFinalPackage).toContain('launch-cloudflare-production-runtime-readonly');
        expect(finalReadiness).toContain('pnpm launch:cloudflare-production-runtime-readonly');
        expect(statusScript).toContain("readLatestJson<CheckBackedSummary>('launch-cloudflare-production-runtime-readonly', 'summary.json')");
        expect(statusScript).toContain('Cloudflare Production Runtime Read-Only Evidence');
        expect(cutoverPack).toContain('cloudflareRuntimeReadonlyPath');
        expect(cutoverPack).toContain('validateCloudflareRuntimeReadonlyEvidence');
        expect(cutoverPack).toContain('launch:cloudflare-production-runtime-readonly');
        expect(manualRunbook).toContain('pnpm launch:cloudflare-production-runtime-readonly');
        expect(manualRunbook).toContain('outputs/launch-cloudflare-production-runtime-readonly/<timestamp>/summary.md');
        expect(manualEvidenceDoc).toContain('launch-cloudflare-production-runtime-readonly');
        expect(manualExample).toContain('outputs/launch-cloudflare-production-runtime-readonly/<timestamp>/summary.md');
    });

    it('uses only Wrangler read/list/version probes and disables the skill-install prompt noise', () => {
        for (const snippet of [
            "spawnSync(corepackCommand()",
            "'pnpm'",
            "'--config.verify-deps-before-run=false'",
            "'exec'",
            "'wrangler'",
            "CI: 'true'",
            "WRANGLER_SEND_METRICS: 'false'",
            "'whoami', '--json'",
            "'pages', 'project', 'list', '--json'",
            "'pages', 'deployment', 'list'",
            "'deployments', 'list', '--name'",
            "'secret', 'list', '--name'",
            "'--format', 'json'",
        ]) {
            expect(source).toContain(snippet);
        }

        for (const forbidden of [
            "args: ['deploy'",
            "args: ['delete'",
            "args: ['secret', 'put'",
            "args: ['secret', 'delete'",
            "args: ['pages', 'deploy'",
            "args: ['pages', 'project', 'create'",
            "args: ['rollback'",
            "args: ['triggers'",
        ]) {
            expect(source).not.toContain(forbidden);
        }
    });

    it('records current Cloudflare state without secret values', () => {
        for (const snippet of [
            'd1a22bcf6477ff2ff31d2bfb83084e44',
            'espanolhonesto',
            'espanolhonesto-staging',
            'espanolhonesto.com',
            'www.espanolhonesto.com',
            'Pages project exists and currently owns the production custom domains',
            'production_worker_exists',
            'production_worker_secret_names',
            'requiredProductionWorkerSecretNames',
            'secret list probes store names only',
            'noSecretValuesStored',
            'extractJsonValue',
            'Project Name',
            'Project Domains',
            'script_not_found',
            'code:\\s*10007',
        ]) {
            expect(source).toContain(snippet);
        }

        expect(source).not.toContain('console.log(process.env');
        expect(source).not.toContain('writeFileSync(outputPath, process.env');
        expect(source).not.toContain("args: ['secret', 'put'");
    });
});
