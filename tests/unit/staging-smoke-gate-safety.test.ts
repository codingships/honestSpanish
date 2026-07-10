import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
    path.join(process.cwd(), 'scripts/launch/staging-smoke-rehearsal-runner.ts'),
    'utf8',
);

describe('staging smoke checkout gate ownership', () => {
    it('requires two exact approvals and the exact Cloudflare account/Worker', () => {
        expect(source).toContain("const checkoutGateApprovalEnvVar = 'STAGING_CHECKOUT_GATE_APPROVAL'");
        expect(source).toContain('checkoutGateApprovalMatched');
        expect(source).toContain("const cloudflareAccountId = 'd1a22bcf6477ff2ff31d2bfb83084e44'");
        expect(source).toContain("const stagingWorkerName = 'espanolhonesto-staging'");
        expect(source).toContain("'wrangler', 'whoami', '--json'");
        expect(source).toContain("'deployments', 'status', '--config', 'wrangler.toml', '--env', 'staging', '--json'");
    });

    it('attests the closed runtime before enabling and the enabled runtime before smoke writes', () => {
        const closedPreflight = source.indexOf("runSmokePreflightCommand(merged, 'false', 'before-gate-write')");
        const enable = source.indexOf("runCheckoutGateWrite('true', 'enable')");
        const enabledPreflight = source.indexOf("runSmokePreflightCommand(merged, 'true', 'after-gate-write')");
        const smoke = source.indexOf('const capture = runSmokeCommand(merged)');
        expect(closedPreflight).toBeGreaterThan(0);
        expect(enable).toBeGreaterThan(closedPreflight);
        expect(enabledPreflight).toBeGreaterThan(enable);
        expect(smoke).toBeGreaterThan(enabledPreflight);
    });

    it('owns a bounded false rollback from finally and verifies the deployed result', () => {
        expect(source).toContain('} finally {');
        expect(source).toContain('approvedChecks.push(runCheckoutGateRollback(merged, reportCaptures));');
        expect(source).toContain('for (let attempt = 1; attempt <= 3; attempt += 1)');
        expect(source).toContain("runCheckoutGateWrite('false', `rollback-${attempt}`)");
        expect(source).toContain("runRuntimePreflightCommand(env, 'false', attempt)");
        expect(source).toContain('rollbackState=verified-false');
        expect(source).toContain('rollbackState=ambiguous');
        expect(source).toContain("'secret',");
        expect(source).toContain("'CHECKOUT_ENABLED_OVERRIDE'");
        expect(source).toContain("'--env',");
        expect(source).toContain("'staging',");
    });
});
