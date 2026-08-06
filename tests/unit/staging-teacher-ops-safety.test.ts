import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
    STAGING_TEACHER_OPS_CONFIRMATION,
    STAGING_TEACHER_OPS_IDENTITY,
    parseStagingTeacherOpsArgs,
    safeStagingTeacherOpsSummary,
    validateStagingTeacherOpsGate,
} from '../../scripts/smoke/staging-teacher-ops-safety';

const workspaceRoot = path.resolve('staging-teacher-ops-fixture');
const envFile = path.resolve(workspaceRoot, '.env.staging');

function validEnv(): Record<string, string> {
    return {
        PUBLIC_APP_ENV: 'staging',
        PUBLIC_SITE_URL: STAGING_TEACHER_OPS_IDENTITY.webOrigin,
        PUBLIC_SUPABASE_ANON_KEY: 'anon-never-log',
        PUBLIC_SUPABASE_URL: `https://${STAGING_TEACHER_OPS_IDENTITY.supabaseProjectRef}.supabase.co`,
        STRIPE_EXPECTED_ACCOUNT_ID: STAGING_TEACHER_OPS_IDENTITY.stripeAccountId,
        SUPABASE_EXPECTED_PROJECT_REF: STAGING_TEACHER_OPS_IDENTITY.supabaseProjectRef,
        SUPABASE_SERVICE_ROLE_KEY: 'service-role-never-log',
        TEST_ADMIN_EMAIL: 'admin@example.test',
        TEST_ADMIN_PASSWORD: 'admin-password-never-log',
    };
}

const webConfig = `
[env.staging]
name = "${STAGING_TEACHER_OPS_IDENTITY.webWorker}"
`;

describe('staging teacher-ops safety', () => {
    it('parses preflight by default and requires confirmation for execute', () => {
        expect(parseStagingTeacherOpsArgs([])).toEqual({
            envFile: '.env.staging',
            mode: 'preflight',
        });
        expect(() => parseStagingTeacherOpsArgs(['--execute'])).toThrow('--confirmation=');
        expect(parseStagingTeacherOpsArgs([
            '--execute',
            '--confirmation',
            STAGING_TEACHER_OPS_CONFIRMATION,
        ]).mode).toBe('execute');
    });

    it('validates the approved staging gate without leaking secrets in the summary', () => {
        const gate = validateStagingTeacherOpsGate({
            args: parseStagingTeacherOpsArgs([]),
            env: validEnv(),
            repositoryRemote: STAGING_TEACHER_OPS_IDENTITY.repositoryRemote,
            resolvedEnvFile: envFile,
            webConfig,
            workspaceRoot,
        });
        expect(gate.mode).toBe('preflight');
        const summary = safeStagingTeacherOpsSummary(gate).join('\n');
        expect(summary).toContain('production=false');
        expect(summary).not.toContain('service-role-never-log');
        expect(summary).not.toContain('admin-password-never-log');
    });

    it('rejects production-like targets', () => {
        expect(() => validateStagingTeacherOpsGate({
            args: parseStagingTeacherOpsArgs([]),
            env: { ...validEnv(), PUBLIC_APP_ENV: 'production' },
            repositoryRemote: STAGING_TEACHER_OPS_IDENTITY.repositoryRemote,
            resolvedEnvFile: envFile,
            webConfig,
            workspaceRoot,
        })).toThrow('PUBLIC_APP_ENV');
    });
});
