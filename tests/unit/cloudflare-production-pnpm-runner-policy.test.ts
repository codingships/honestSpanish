import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const productionRunnerPaths = [
    'scripts/launch/cloudflare-production-runtime-readonly.ts',
    'scripts/launch/cloudflare-production-runtime-cutover-preflight.ts',
    'scripts/launch/cloudflare-production-queue-provision.ts',
    'scripts/launch/cloudflare-production-fulfillment-lifecycle.ts',
    'scripts/launch/cloudflare-production-fulfillment-bootstrap-secrets.ts',
    'scripts/launch/cloudflare-production-fulfillment-secrets.ts',
    'scripts/launch/cloudflare-production-worker-phase1.ts',
    'scripts/launch/cloudflare-production-worker-bootstrap-secrets.ts',
    'scripts/launch/cloudflare-production-worker-secrets.ts',
] as const;

const productionPlanManifestPaths = [
    ...productionRunnerPaths,
    'scripts/launch/cloudflare-production-runtime-cutover.ts',
] as const;

const executableCorepackPatterns = [
    /spawnSync\(\s*(?:corepackCommand\(\)|process\.platform\s*===\s*'win32'\s*\?\s*'corepack\.cmd'\s*:\s*'corepack'|['"]corepack(?:\.cmd)?['"])/u,
    /\bbin:\s*(?:['"]corepack(?:\.cmd)?['"]|corepack\b)/u,
    /\bfunction\s+corepackCommand\s*\(/u,
    /\bconst\s+corepack\s*=/u,
    /\bdisplay:\s*(?:['"`])corepack\s+pnpm\b/u,
    /\bargs:\s*\[\s*['"]pnpm['"]\s*,\s*['"]--config\.verify-deps-before-run=false['"]/u,
] as const;

describe('Cloudflare production runner pnpm policy', () => {
    it.each(productionRunnerPaths)('%s uses direct pnpm or the scoped Wrangler keyring runner', (runnerPath) => {
        const source = readFileSync(runnerPath, 'utf8');

        for (const pattern of executableCorepackPatterns) {
            expect(source.match(pattern), `${runnerPath} matched ${pattern}`).toBeNull();
        }

        expect(source).not.toMatch(/\bcorepack\s+pnpm\b/iu);
        const usesScopedWranglerKeyring = source.includes('runCloudflareWranglerFromKeyring');
        const usesDirectPnpm = /(?:spawnSync\(pnpmCommand\(\)|\bbin:\s*(?:pnpmCommand\(\)|pnpm\b))/u.test(source);
        expect(usesScopedWranglerKeyring || usesDirectPnpm).toBe(true);
        if (usesDirectPnpm) {
            expect(source).toContain("process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'");
            expect(source).toContain("shell: process.platform === 'win32'");
        }
    });

    it.each(productionPlanManifestPaths)('%s does not generate obsolete Corepack commands', (runnerPath) => {
        const source = readFileSync(runnerPath, 'utf8');

        expect(source).not.toMatch(/\bcorepack\s+pnpm\b/iu);
    });

    it('keeps plan manifests and self-check expectations aligned with direct pnpm commands', () => {
        const preflight = readFileSync('scripts/launch/cloudflare-production-runtime-cutover-preflight.ts', 'utf8');
        const cutover = readFileSync('scripts/launch/cloudflare-production-runtime-cutover.ts', 'utf8');
        const phaseOne = readFileSync('scripts/launch/cloudflare-production-worker-phase1.ts', 'utf8');
        const finalSecrets = readFileSync('scripts/launch/cloudflare-production-worker-secrets.ts', 'utf8');

        expect(preflight).toContain('requiredCommand=pnpm --config.verify-deps-before-run=false exec wrangler deploy');
        expect(cutover).toContain('run=pnpm --config.verify-deps-before-run=false launch:cloudflare-production-runtime-readonly');
        expect(cutover).toContain("'pnpm --config.verify-deps-before-run=false launch:status'");
        expect(cutover).toContain("latestGeneratedPath('launch-cloudflare-production-runtime-readonly', 'summary.json')");
        expect(cutover).toContain('validateCloudflareRuntimeReadonlySummary');
        expect(cutover).toContain('validateCloudflareRuntimeCutoverPreflightSummary');
        expect(phaseOne).toContain("'pnpm --config.verify-deps-before-run=false run build:production:bootstrap'");
        expect(phaseOne).toContain("'pnpm --config.verify-deps-before-run=false launch:cloudflare-production-worker-phase1 -- --execute-approved'");
        expect(finalSecrets).toContain('run=pnpm --config.verify-deps-before-run=false launch:cloudflare-production-runtime-readonly');
        expect(finalSecrets).toContain("latestGeneratedPath('launch-cloudflare-production-runtime-readonly', 'summary.json')");
        expect(finalSecrets).toContain('validateCloudflareRuntimeReadonlySummary');
        expect(finalSecrets).toContain('validateCloudflareRuntimeCutoverPreflightSummary');
        expect(finalSecrets).toContain('pnpm --config.verify-deps-before-run=false launch:cloudflare-production-worker-secrets --');
        expect(finalSecrets).toContain("'pnpm launch:manual-evidence:record --'");
    });
});
