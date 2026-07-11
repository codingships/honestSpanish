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
        const start = source.indexOf('function runApprovedExecution');
        const end = source.indexOf('function runCheckoutBootstrapPreflightCommand');
        const fullSmokeSource = source.slice(start, end);
        const closedPreflight = fullSmokeSource.indexOf("runSmokePreflightCommand(merged, 'false', 'before-gate-write')");
        const enable = fullSmokeSource.indexOf("runCheckoutGateWrite('true', 'enable')");
        const enabledPreflight = fullSmokeSource.indexOf("runSmokePreflightCommand(merged, 'true', 'after-gate-write')");
        const smoke = fullSmokeSource.indexOf('const capture = runSmokeCommand(merged)');
        expect(closedPreflight).toBeGreaterThan(0);
        expect(enable).toBeGreaterThan(closedPreflight);
        expect(enabledPreflight).toBeGreaterThan(enable);
        expect(smoke).toBeGreaterThan(enabledPreflight);
    });

    it('has a separate bootstrap approval and closes the gate after preserving one open Checkout', () => {
        const start = source.indexOf('function runApprovedCheckoutBootstrap');
        const end = source.indexOf('function runApprovedExecution');
        const bootstrapSource = source.slice(start, end);
        const closedRuntime = bootstrapSource.indexOf("runRuntimePreflightCommand(merged, 'false', 0)");
        const bootstrapPreflight = bootstrapSource.indexOf('runCheckoutBootstrapPreflightCommand(merged)');
        const enable = bootstrapSource.indexOf("runCheckoutGateWrite('true', 'enable')");
        const enabledRuntime = bootstrapSource.indexOf("runRuntimePreflightCommand(merged, 'true', 0)");
        const bootstrap = bootstrapSource.indexOf('runCheckoutBootstrapCommand(merged)');
        const rollback = bootstrapSource.indexOf('runCheckoutGateRollback(merged, reportCaptures)');
        const failureCleanup = bootstrapSource.indexOf('runCheckoutBootstrapCleanupCommand(merged)');
        expect(source).toContain("process.argv.includes('--bootstrap-checkout-approved')");
        expect(source).toContain('STAGING_CHECKOUT_BOOTSTRAP_APPROVAL_ENV');
        expect(source).toContain('initial_read_only_guards');
        expect(source).toContain('runCheckoutBootstrapCleanupCommand(merged)');
        expect(source).toContain('bootstrapFailureNeedsCleanup && gateRollbackVerified');
        expect(source).toContain('cleanup was intentionally skipped because the Cloudflare checkout rollback is ambiguous');
        expect(closedRuntime).toBeGreaterThan(0);
        expect(bootstrapPreflight).toBeGreaterThan(closedRuntime);
        expect(enable).toBeGreaterThan(bootstrapPreflight);
        expect(enabledRuntime).toBeGreaterThan(enable);
        expect(bootstrap).toBeGreaterThan(enabledRuntime);
        expect(rollback).toBeGreaterThan(bootstrap);
        expect(failureCleanup).toBeGreaterThan(rollback);
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
