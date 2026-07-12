import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
    PRODUCTION_AVAILABILITY_APPROVAL,
    PRODUCTION_AVAILABILITY_SLOTS,
    parseAvailabilityFacts,
    renderProductionAvailabilityApplySql,
    validateFinalAuthPolicyReceipt,
    validateProductionAvailabilityDatabaseUrl,
    validateProductionAvailabilityPostflight,
    validateProductionAvailabilityPreflight,
} from '../../scripts/launch/production-availability-shared';

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
    preservedSetSha256: 'e'.repeat(64),
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
        expect(sql).toContain('BEGIN;');
        expect(sql).toContain('Expected exact finalized two-profile Auth policy state');
        expect(sql).toContain('Expected zero existing availability rows for the production teacher');
        expect(sql).toContain('COMMIT;');
        expect(sql).not.toContain('DELETE');
        expect(sql).not.toContain('TRUNCATE');
    });

    it('validates exact preflight and postflight aggregates', () => {
        expect(validateProductionAvailabilityPreflight(parseAvailabilityFacts([
            'current_database\tpostgres',
            'teacher_match_count\t1',
            'teacher_availability_count\t0',
            'final_profile_counts\t2,2',
            'hardening_history_count\t2',
            'overlap_constraint_valid\ttrue',
        ].join('\n')))).toEqual([]);
        expect(validateProductionAvailabilityPostflight(parseAvailabilityFacts([
            'current_database\tpostgres',
            'target_count\t5',
            'target_days\t1,2,3,4,5',
            'unexpected_count\t0',
        ].join('\n')))).toEqual([]);
    });

    it('keeps execution exact-gated, receipt-bound and provider-free', () => {
        const source = readFileSync('scripts/launch/production-availability-seed.ts', 'utf8');
        expect(PRODUCTION_AVAILABILITY_APPROVAL).toContain('vkkahxsybhbutszerawz');
        expect(source).toContain('--auth-policy-receipt');
        expect(source).toContain('PRODUCTION_AVAILABILITY_INERT_CONFIRMATION_ENV');
        expect(source).toContain('default_transaction_read_only=on');
        expect(source).toContain('externalProvidersTouched: false');
        expect(source).not.toContain('googleapis');
        expect(source).not.toContain('resend');
        expect(source).not.toContain('stripe');
    });
});
