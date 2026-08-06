import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
    STAGING_SESSION_EXPIRED_CONFIRMATION,
    STAGING_SESSION_EXPIRED_IDENTITY,
    parseStagingSessionExpiredArgs,
    safeStagingSessionExpiredSummary,
    validateStagingSessionExpiredGate,
} from '../../scripts/smoke/staging-session-expired-safety';

const workspaceRoot = path.resolve('staging-session-expired-fixture');
const envFile = path.resolve(workspaceRoot, '.env.staging');

function validEnv(): Record<string, string> {
    return {
        PUBLIC_APP_ENV: 'staging',
        PUBLIC_SITE_URL: STAGING_SESSION_EXPIRED_IDENTITY.webOrigin,
        PUBLIC_SUPABASE_ANON_KEY: 'anon-never-log',
        PUBLIC_SUPABASE_URL: `https://${STAGING_SESSION_EXPIRED_IDENTITY.supabaseProjectRef}.supabase.co`,
        STRIPE_EXPECTED_ACCOUNT_ID: STAGING_SESSION_EXPIRED_IDENTITY.stripeAccountId,
        SUPABASE_EXPECTED_PROJECT_REF: STAGING_SESSION_EXPIRED_IDENTITY.supabaseProjectRef,
        SUPABASE_SERVICE_ROLE_KEY: 'service-role-never-log',
        TEST_ADMIN_EMAIL: 'admin@example.test',
        TEST_ADMIN_PASSWORD: 'admin-password-never-log',
        TEST_TEACHER_EMAIL: 'teacher@example.test',
        TEST_TEACHER_PASSWORD: 'teacher-password-never-log',
    };
}

const webConfig = `
[env.staging]
name = "${STAGING_SESSION_EXPIRED_IDENTITY.webWorker}"
`;

describe('staging session-expired safety', () => {
    it('parses preflight by default and requires confirmation for execute', () => {
        expect(parseStagingSessionExpiredArgs([])).toEqual({
            envFile: '.env.staging',
            mode: 'preflight',
        });
        expect(() => parseStagingSessionExpiredArgs(['--execute'])).toThrow('--confirmation=');
        expect(parseStagingSessionExpiredArgs([
            '--execute',
            '--confirmation',
            STAGING_SESSION_EXPIRED_CONFIRMATION,
        ]).mode).toBe('execute');
    });

    it('validates the approved staging gate without leaking secrets in the summary', () => {
        const gate = validateStagingSessionExpiredGate({
            args: parseStagingSessionExpiredArgs([]),
            env: validEnv(),
            repositoryRemote: STAGING_SESSION_EXPIRED_IDENTITY.repositoryRemote,
            resolvedEnvFile: envFile,
            webConfig,
            workspaceRoot,
        });
        expect(gate.mode).toBe('preflight');
        const summary = safeStagingSessionExpiredSummary(gate).join('\n');
        expect(summary).toContain('capability=a01-session-expired');
        expect(summary).toContain('production=false');
        expect(summary).not.toContain('service-role-never-log');
        expect(summary).not.toContain('admin-password-never-log');
    });

    it('rejects production-like targets', () => {
        expect(() => validateStagingSessionExpiredGate({
            args: parseStagingSessionExpiredArgs([]),
            env: { ...validEnv(), PUBLIC_APP_ENV: 'production' },
            repositoryRemote: STAGING_SESSION_EXPIRED_IDENTITY.repositoryRemote,
            resolvedEnvFile: envFile,
            webConfig,
            workspaceRoot,
        })).toThrow('PUBLIC_APP_ENV');
    });
});
