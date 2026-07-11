import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
    assessStagingSmokeEmailBudget,
    MAX_STAGING_SMOKE_PLANNED_RECIPIENTS,
    parseStagingSmokeEmailBudget,
    parseWranglerWhoamiSummary,
    RESEND_FREE_DAILY_RECIPIENT_LIMIT,
    RESEND_FREE_MONTHLY_RECIPIENT_LIMIT,
    runCleanupOwnedNodeCommand,
    runDirectNodeCommand,
    sanitizeStagingSmokeCapture,
    STAGING_SMOKE_EMAIL_RECIPIENT_PLAN,
    STAGING_SMOKE_PLANNED_RECIPIENTS,
    wranglerCliArgs,
} from '../../scripts/launch/staging-smoke-runner-safety';

const source = readText('scripts/launch/staging-smoke-rehearsal-runner.ts');
const safetySource = readText('scripts/launch/staging-smoke-runner-safety.ts');
const temporaryDirectories: string[] = [];

afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
        rmSync(directory, { recursive: true, force: true });
    }
});

describe('staging smoke checkout-closed runner', () => {
    it('caps the normal smoke at six recipient entries with zero cleanup recipients', () => {
        expect(STAGING_SMOKE_EMAIL_RECIPIENT_PLAN).toEqual({
            classConfirmation: 2,
            classReminder: 2,
            classCancellation: 2,
            secondarySchedulingVariants: 0,
            cleanup: 0,
        });
        expect(STAGING_SMOKE_PLANNED_RECIPIENTS).toBe(6);
        expect(STAGING_SMOKE_PLANNED_RECIPIENTS).toBeLessThanOrEqual(
            MAX_STAGING_SMOKE_PLANNED_RECIPIENTS,
        );
        expect(RESEND_FREE_DAILY_RECIPIENT_LIMIT).toBe(10);
        expect(RESEND_FREE_MONTHLY_RECIPIENT_LIMIT).toBe(100);
    });

    it('fails closed before writes when daily or monthly usage plus the smoke plan exceeds its cap', () => {
        expect(assessStagingSmokeEmailBudget({
            currentDailyRecipients: 4,
            currentMonthlyRecipients: 94,
            configuredDailyLimit: 10,
            configuredMonthlyLimit: 100,
        })).toMatchObject({
            allowed: true,
            currentDailyRecipients: 4,
            currentMonthlyRecipients: 94,
            plannedSmokeRecipients: 6,
            projectedDailyRecipients: 10,
            projectedMonthlyRecipients: 100,
            effectiveDailyLimit: 10,
            effectiveMonthlyLimit: 100,
        });
        expect(assessStagingSmokeEmailBudget({
            currentDailyRecipients: 5,
            currentMonthlyRecipients: 0,
            configuredDailyLimit: 10,
            configuredMonthlyLimit: 100,
        })).toMatchObject({
            allowed: false,
            reason: 'daily_budget_exceeded',
            projectedDailyRecipients: 11,
        });
        expect(assessStagingSmokeEmailBudget({
            currentDailyRecipients: 0,
            currentMonthlyRecipients: 95,
            configuredDailyLimit: 10,
            configuredMonthlyLimit: 100,
        })).toMatchObject({
            allowed: false,
            reason: 'monthly_budget_exceeded',
            projectedMonthlyRecipients: 101,
        });
        expect(assessStagingSmokeEmailBudget({
            currentDailyRecipients: 0,
            currentMonthlyRecipients: 0,
            configuredDailyLimit: 11,
            configuredMonthlyLimit: 100,
        })).toMatchObject({
            allowed: false,
            reason: 'configured_limit_exceeds_resend_free_cap',
        });
        expect(assessStagingSmokeEmailBudget({
            currentDailyRecipients: 0,
            currentMonthlyRecipients: 0,
            configuredDailyLimit: 10,
            configuredMonthlyLimit: 101,
        })).toMatchObject({
            allowed: false,
            reason: 'configured_limit_exceeds_resend_free_cap',
        });
        expect(assessStagingSmokeEmailBudget({
            currentDailyRecipients: 0,
            currentMonthlyRecipients: 0,
            configuredDailyLimit: 10,
            configuredMonthlyLimit: 100,
            plannedSmokeRecipients: 9,
        })).toMatchObject({
            allowed: false,
            reason: 'smoke_plan_exceeds_maximum',
        });
    });

    it('accepts only a self-consistent successful budget payload from the read-only child', () => {
        const assessment = assessStagingSmokeEmailBudget({
            currentDailyRecipients: 2,
            currentMonthlyRecipients: 20,
            configuredDailyLimit: 10,
            configuredMonthlyLimit: 100,
        });
        const stdout = JSON.stringify({ emailRecipientBudget: assessment });

        expect(parseStagingSmokeEmailBudget(stdout)).toEqual(assessment);
        expect(parseStagingSmokeEmailBudget(JSON.stringify({
            emailRecipientBudget: { ...assessment, projectedDailyRecipients: 9 },
        }))).toBeNull();
        expect(parseStagingSmokeEmailBudget(JSON.stringify({
            emailRecipientBudget: { ...assessment, projectedMonthlyRecipients: 27 },
        }))).toBeNull();
        expect(parseStagingSmokeEmailBudget('{}')).toBeNull();
    });

    it('keeps checkout false throughout and reuses completed evidence before smoke writes', () => {
        const start = source.indexOf('function runApprovedExecution');
        const end = source.indexOf('function runSmokePreflightCommand');
        const executionSource = source.slice(start, end);
        const sourceGuard = executionSource.indexOf("merged.CHECKOUT_ENABLED_OVERRIDE !== 'false'");
        const preflight = executionSource.indexOf('const preflightCapture = runSmokePreflightCommand(merged)');
        const smoke = executionSource.indexOf('const capture = runSmokeCommand(merged)');

        expect(sourceGuard).toBeGreaterThan(0);
        expect(preflight).toBeGreaterThan(sourceGuard);
        expect(smoke).toBeGreaterThan(preflight);
        expect(executionSource).toContain('preflightCapture.emailRecipientBudget');
        expect(source.slice(
            source.indexOf('function runSmokePreflightCommand'),
            source.indexOf('function runCloudflareReadOnlyPreflight'),
        )).toContain('parseStagingSmokeEmailBudget');
        expect(executionSource).toContain('completedCheckoutEvidenceReused=true');
        expect(executionSource).toContain('cloudflareWritesStarted=false');
        expect(source).toContain("'--expect-checkout-override',\n        'false'");
        expect(source).not.toContain("runCheckoutGateWrite('true'");
        expect(source).not.toContain('runApprovedCheckoutBootstrap');
        expect(source).not.toContain('stripe.checkout.sessions.expire');
    });

    it('uses direct Node entrypoints with accurate displays and no cmd/pnpm wrapper', () => {
        expect(source).toContain('runDirectNodeCommand(wranglerCliArgs');
        expect(source).toContain("display: 'node node_modules/wrangler/bin/wrangler.js deployments status");
        expect(source).toContain("const display = 'node --import tsx");
        expect(wranglerCliArgs(['whoami', '--json'])[0]).toMatch(/node_modules[\\/]wrangler[\\/]bin[\\/]wrangler\.js$/u);
        expect(source).not.toContain('process.env.ComSpec');
        expect(source).not.toContain("'/c', 'pnpm'");
        expect(source).not.toContain('spawnSync');
        expect(source).not.toContain('reportCaptures.push(enabledPreflight)');
    });

    it('does not impose a hard timeout on the write-capable smoke child', () => {
        const smokeStart = source.indexOf('function runSmokeCommand');
        const smokeEnd = source.indexOf('function buildSmokeEnv', smokeStart);
        const smokeSource = source.slice(smokeStart, smokeEnd);

        expect(smokeSource).toContain('runCleanupOwnedNodeCommand([');
        expect(smokeSource).not.toContain('timeoutMs');
        expect(smokeSource).not.toContain('runDirectNodeCommand([');
        expect(smokeSource).not.toContain('result.stdout');
        expect(smokeSource).not.toContain('result.stderr');
        const helperStart = safetySource.indexOf('export function runCleanupOwnedNodeCommand');
        const helperEnd = safetySource.indexOf('function spawnNodeCommand', helperStart);
        const helperSource = safetySource.slice(helperStart, helperEnd);
        expect(helperSource).toContain("stdio: 'ignore'");
        expect(helperSource).not.toContain('timeout:');
        expect(helperSource).not.toContain('maxBuffer:');
    });

    it('terminates a timed-out direct Node process before it can write later', async () => {
        const directory = mkdtempSync(path.join(tmpdir(), 'staging-smoke-timeout-'));
        temporaryDirectories.push(directory);
        const marker = path.join(directory, 'late-write.txt');
        const childScript = `setTimeout(() => require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'late'), 250)`;

        const result = runDirectNodeCommand(['-e', childScript], { timeoutMs: 40 });

        expect((result.error as NodeJS.ErrnoException | undefined)?.code).toBe('ETIMEDOUT');
        expect(result.status).toBeNull();
        await new Promise((resolve) => setTimeout(resolve, 350));
        expect(existsSync(marker)).toBe(false);
    });

    it('waits for a write-capable child to finish its delayed finally cleanup', () => {
        const directory = mkdtempSync(path.join(tmpdir(), 'staging-smoke-cleanup-'));
        temporaryDirectories.push(directory);
        const marker = path.join(directory, 'cleanup-complete.txt');
        const childScript = [
            '(async () => {',
            '  try { await new Promise((resolve) => setTimeout(resolve, 120)); }',
            `  finally { require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'clean'); }`,
            '})().catch(() => process.exitCode = 1);',
        ].join('\n');

        const result = runCleanupOwnedNodeCommand(['-e', childScript], {});

        expect(result.error).toBeUndefined();
        expect(result.status).toBe(0);
        expect(existsSync(marker)).toBe(true);
        expect(readFileSync(marker, 'utf8')).toBe('clean');
    });

    it('redacts complete PEM blocks for generic, RSA and EC private keys', () => {
        const pemBlock = (variant: '' | 'RSA' | 'EC', payload: string) => {
            const label = [variant, 'PRIVATE KEY'].filter(Boolean).join(' ');
            return [`-----${'BEGIN'} ${label}-----`, payload, `-----${'END'} ${label}-----`].join('\n');
        };
        const input = [
            'before',
            pemBlock('', 'private-payload'),
            'middle',
            pemBlock('RSA', 'rsa-payload'),
            pemBlock('EC', 'ec-payload'),
            'after',
        ].join('\n');

        const sanitized = sanitizeStagingSmokeCapture(input);

        expect(sanitized.match(/\[redacted-pem-block\]/gu)).toHaveLength(3);
        expect(sanitized).not.toContain('BEGIN');
        expect(sanitized).not.toContain('private-payload');
        expect(sanitized).not.toContain('rsa-payload');
        expect(sanitized).not.toContain('ec-payload');
        expect(sanitized).toContain('before');
        expect(sanitized).toContain('after');
    });

    it('redacts generic email addresses from non-whoami command captures', () => {
        const sanitized = sanitizeStagingSmokeCapture('operator@example.com and Student.Name+qa@sub.example.es');
        expect(sanitized).toBe('[redacted-email] and [redacted-email]');
    });

    it('reduces wrangler whoami JSON to safe booleans and account IDs', () => {
        const rawIdentity = JSON.stringify({
            email: 'operator@example.com',
            name: 'Private Operator',
            accounts: [{ id: 'd1a22bcf6477ff2ff31d2bfb83084e44', name: 'Private Account' }],
        });

        const summary = parseWranglerWhoamiSummary(rawIdentity, 0);
        const persisted = JSON.stringify(summary);

        expect(summary).toEqual({
            authenticated: true,
            jsonParsed: true,
            accountIds: ['d1a22bcf6477ff2ff31d2bfb83084e44'],
        });
        expect(persisted).not.toContain('operator@example.com');
        expect(persisted).not.toContain('Private Operator');
        const whoamiStart = source.indexOf('function runWranglerWhoamiCapture');
        const whoamiEnd = source.indexOf('function runWranglerCapture', whoamiStart);
        const whoamiSource = source.slice(whoamiStart, whoamiEnd);
        expect(whoamiSource).toContain('JSON.stringify(summary, null, 2)');
        expect(whoamiSource).not.toContain('sanitize(result.stdout');
        expect(whoamiSource).not.toContain('result.stderr');
    });
});

function readText(relativePath: string) {
    return readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}
