import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
    PRODUCTION_AVAILABILITY_APPROVAL,
    PRODUCTION_AVAILABILITY_SLOTS,
    normalizeProductionAvailabilityOutput,
    parseAvailabilityFacts,
    renderProductionAvailabilityApplySql,
    renderProductionAvailabilityPreflightSql,
    renderProductionAvailabilityVerifySql,
    validateFinalAuthPolicyReceipt,
    validateProductionAvailabilityDatabaseUrl,
    validateProductionAvailabilityPostflight,
    validateProductionAvailabilityPreflight,
    validateProductionAvailabilityRolledBackPostflight,
} from '../../scripts/launch/production-availability-shared';
import { hashIdentitySet } from '../../scripts/launch/supabase-production-auth-cleanup-shared';

const ADMIN_ID = '11111111-1111-4111-8111-111111111111';
const TEACHER_ID = '22222222-2222-4222-8222-222222222222';
const PRESERVED_SET_SHA256 = hashIdentitySet([ADMIN_ID, TEACHER_ID]);

const validReceipt = {
    schemaVersion: 1,
    targetProjectRef: 'vkkahxsybhbutszerawz',
    status: 'CLOSED_AND_VERIFIED',
    closedAt: '2026-07-12T12:00:00.000Z',
    mode: 'preserve_admin_teacher',
    authUsersRemaining: 2,
    publicProfilesRemaining: 2,
    publicProfilesPrivateRemaining: 2,
    profileRoles: { admin: 1, teacher: 1, student: 0 },
    fixtureStudentsRemaining: 0,
    storageObjectsTouched: false,
    externalProvidersTouched: false,
    passwordsRotatedUnretained: true,
    sessionsInvalidatedOrExpired: true,
    resetEmailsSent: false,
    backupReceiptSha256: 'a'.repeat(64),
    publicCleanupReceiptSha256: 'b'.repeat(64),
    authReducedReceiptSha256: 'c'.repeat(64),
    productionRolloutReceiptSha256: 'd'.repeat(64),
    preservedSetSha256: PRESERVED_SET_SHA256,
    freezeCutoff: '2026-07-02T18:29:27.580Z',
    quarantineUntil: '2026-07-12T11:00:00.000Z',
    googleDriveFixtureFolders: 'UNTOUCHED_110_OBSERVED',
};

describe('production availability seed', () => {
    it('pins the exact project and allows direct or pooler production URLs only', () => {
        const credential = ['fi', 'xture'].join('');
        const direct = ['postgresql://postgres:', credential, '@db.vkkahxsybhbutszerawz.supabase.co:5432/postgres'].join('');
        const productionPooler = ['postgresql://postgres.vkkahxsybhbutszerawz:', credential, '@aws-0-eu-west-1.pooler.supabase.com:6543/postgres'].join('');
        const stagingPooler = ['postgresql://postgres.mzjyvmlxfpzdfdjzxxyj:', credential, '@aws-0-eu-west-1.pooler.supabase.com:6543/postgres'].join('');
        expect(validateProductionAvailabilityDatabaseUrl(direct).valid).toBe(true);
        expect(validateProductionAvailabilityDatabaseUrl(productionPooler).valid).toBe(true);
        expect(validateProductionAvailabilityDatabaseUrl(stagingPooler).valid).toBe(false);
    });

    it('requires the exact closed Auth policy receipt and rejects drift', () => {
        expect(validateFinalAuthPolicyReceipt(validReceipt)).toEqual([]);
        expect(validateFinalAuthPolicyReceipt({ ...validReceipt, publicProfilesRemaining: 3 })).toContain('publicProfilesRemaining must equal 2');
        expect(validateFinalAuthPolicyReceipt({ ...validReceipt, resetEmailsSent: true })).toContain('resetEmailsSent must equal false');
    });

    it('defines only five Monday-Friday Madrid windows and an atomic empty-baseline insert', () => {
        expect(PRODUCTION_AVAILABILITY_SLOTS).toEqual([1, 2, 3, 4, 5].map((dayOfWeek) => ({
            dayOfWeek,
            startTime: '09:00:00',
            endTime: '18:00:00',
        })));
        const sql = renderProductionAvailabilityApplySql();
        expect(renderProductionAvailabilityPreflightSql()).toContain('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
        expect(renderProductionAvailabilityVerifySql()).toContain('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
        expect(sql).toContain('BEGIN;');
        expect(sql).toContain('Expected exact finalized two-profile Auth policy state');
        expect(sql).toContain('Expected zero existing availability rows for the production teacher');
        expect(sql).toContain('pg_advisory_xact_lock');
        expect(sql).toContain('LOCK TABLE auth.users IN SHARE MODE');
        expect(sql).toContain('LOCK TABLE public.teacher_availability IN SHARE ROW EXCLUSIVE MODE');
        expect(sql).toContain("current_setting('espanol_honesto.expected_admin_id')::uuid");
        expect(sql).toContain("current_setting('espanol_honesto.expected_teacher_id')::uuid");
        expect(sql).toContain('Production availability seed did not leave exactly five total rows');
        expect(sql).toContain("SET LOCAL espanol_honesto.expected_teacher_email = :'expected_teacher_email';");
        expect(sql.match(/current_setting\('espanol_honesto\.expected_teacher_email'\)/gu)).toHaveLength(3);
        for (const proceduralBlock of sql.match(/DO \$[\s\S]+?END \$[^;]+;/gu) ?? []) {
            expect(proceduralBlock).not.toContain(":'expected_teacher_email'");
        }
        expect(sql).toContain('COMMIT;');
        expect(sql).not.toContain('DELETE');
        expect(sql).not.toContain('TRUNCATE');
    });

    it('validates exact preflight and postflight aggregates', () => {
        expect(validateProductionAvailabilityPreflight(parseAvailabilityFacts([
            'current_database\tpostgres',
            'teacher_match_count\t1',
            'profile_role_counts\t1,1,0,0',
            'auth_user_count\t2',
            'teacher_auth_link_count\t1',
            `preserved_set_sha256\t${PRESERVED_SET_SHA256}`,
            'teacher_availability_count\t0',
            'final_profile_counts\t2,2',
            'hardening_history_count\t2',
            'overlap_constraint_valid\ttrue',
        ].join('\n')), PRESERVED_SET_SHA256)).toEqual([]);
        expect(validateProductionAvailabilityPostflight(parseAvailabilityFacts([
            'current_database\tpostgres',
            'teacher_match_count\t1',
            'profile_role_counts\t1,1,0,0',
            'auth_user_count\t2',
            'teacher_auth_link_count\t1',
            'final_profile_counts\t2,2',
            `preserved_set_sha256\t${PRESERVED_SET_SHA256}`,
            'target_count\t5',
            'target_days\t1,2,3,4,5',
            'unexpected_count\t0',
        ].join('\n')), PRESERVED_SET_SHA256)).toEqual([]);

        expect(validateProductionAvailabilityRolledBackPostflight(parseAvailabilityFacts([
            'current_database\tpostgres',
            'teacher_match_count\t1',
            'profile_role_counts\t1,1,0,0',
            'auth_user_count\t2',
            'teacher_auth_link_count\t1',
            'final_profile_counts\t2,2',
            `preserved_set_sha256\t${PRESERVED_SET_SHA256}`,
            'target_count\t0',
            'target_days\t',
            'unexpected_count\t0',
        ].join('\n')), PRESERVED_SET_SHA256)).toEqual([]);
    });

    it('derives the live preserved-set hash without persisting raw identity UUIDs', () => {
        const normalized = normalizeProductionAvailabilityOutput([
            `admin_profile_id\t${ADMIN_ID}`,
            `teacher_profile_id\t${TEACHER_ID}`,
            'current_database\tpostgres',
        ].join('\n'));
        expect(normalized.identityIds).toEqual({ adminId: ADMIN_ID, teacherId: TEACHER_ID });
        expect(normalized.output).toContain(`preserved_set_sha256\t${PRESERVED_SET_SHA256}`);
        expect(normalized.output).not.toContain(ADMIN_ID);
        expect(normalized.output).not.toContain(TEACHER_ID);
    });

    it('fails closed when the receipt identity set is stale', () => {
        const facts = parseAvailabilityFacts([
            'current_database\tpostgres',
            'teacher_match_count\t1',
            'profile_role_counts\t1,1,0,0',
            'auth_user_count\t2',
            'teacher_auth_link_count\t1',
            `preserved_set_sha256\t${'f'.repeat(64)}`,
            'teacher_availability_count\t0',
            'final_profile_counts\t2,2',
            'hardening_history_count\t2',
            'overlap_constraint_valid\ttrue',
        ].join('\n'));
        expect(validateProductionAvailabilityPreflight(facts, PRESERVED_SET_SHA256)).toContain(
            `preserved_set_sha256: expected ${PRESERVED_SET_SHA256}, observed ${'f'.repeat(64)}`,
        );
    });

    it('keeps execution exact-gated, receipt-bound and provider-free', () => {
        const source = readFileSync('scripts/launch/production-availability-seed.ts', 'utf8');
        expect(PRODUCTION_AVAILABILITY_APPROVAL).toContain('vkkahxsybhbutszerawz');
        expect(source).toContain('--auth-policy-receipt');
        expect(source).toContain('PRODUCTION_AVAILABILITY_INERT_CONFIRMATION_ENV');
        expect(source).toContain('default_transaction_read_only=on');
        expect(source).toContain('externalProvidersTouched: false');
        expect(source).toContain("const verify = runPsql('verify'");
        expect(source).not.toContain('if (externalWritePerformed)');
        expect(source).toContain('AMBIGUOUS_REQUIRES_READONLY_RECONCILIATION');
        expect(source).not.toContain('googleapis');
        expect(source).not.toContain('resend');
        expect(source).not.toContain('stripe');
    });
});
