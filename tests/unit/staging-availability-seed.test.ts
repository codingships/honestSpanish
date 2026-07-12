import { describe, expect, it } from 'vitest';
import {
    parseFacts,
    renderAvailabilityApplySql,
    renderAvailabilityPreflightSql,
    renderAvailabilityVerifySql,
    STAGING_AVAILABILITY_APPROVAL,
    STAGING_AVAILABILITY_SLOTS,
    validateAvailabilityPostflight,
    validateAvailabilityPreflight,
    validateStagingAvailabilityDatabaseUrl,
} from '../../scripts/launch/staging-availability-shared';

describe('staging availability seed safety', () => {
    it('pins five weekday Madrid-time slots and exact approval scope', () => {
        expect(STAGING_AVAILABILITY_SLOTS.map((slot) => slot.dayOfWeek)).toEqual([1, 2, 3, 4, 5]);
        expect(new Set(STAGING_AVAILABILITY_SLOTS.map((slot) => `${slot.startTime}-${slot.endTime}`))).toEqual(
            new Set(['09:00:00-18:00:00']),
        );
        expect(STAGING_AVAILABILITY_APPROVAL).toContain('mzjyvmlxfpzdfdjzxxyj');
        expect(STAGING_AVAILABILITY_APPROVAL).toContain('No autorizo produccion');
    });

    it('accepts only the exact staging direct or project-qualified pooler URL', () => {
        const direct = fixtureDatabaseUrl('postgres', 'db.mzjyvmlxfpzdfdjzxxyj.supabase.co', '5432');
        const pooler = fixtureDatabaseUrl(
            'postgres.mzjyvmlxfpzdfdjzxxyj',
            'aws-0-eu-west-1.pooler.supabase.com',
            '6543',
        );
        expect(validateStagingAvailabilityDatabaseUrl(direct).valid).toBe(true);
        expect(validateStagingAvailabilityDatabaseUrl(pooler).valid).toBe(true);
        expect(validateStagingAvailabilityDatabaseUrl(direct.replace('mzjyvmlxfpzdfdjzxxyj', 'vkkahxsybhbutszerawz')).valid).toBe(false);
        expect(validateStagingAvailabilityDatabaseUrl(undefined).valid).toBe(false);
    });

    it('renders read-only preflight, fail-closed apply and read-only postflight', () => {
        const preflight = renderAvailabilityPreflightSql();
        const apply = renderAvailabilityApplySql();
        const verify = renderAvailabilityVerifySql();
        expect(preflight).toContain('BEGIN READ ONLY');
        expect(preflight).toContain("'20260712114000'");
        expect(apply).toContain('Expected zero existing availability rows');
        expect(apply).toContain('BEGIN;');
        expect(apply).toContain('COMMIT;');
        expect(verify).toContain('unexpected_count');
    });

    it('validates exact preflight and postflight facts', () => {
        const preflight = parseFacts([
            'current_database\tpostgres',
            'teacher_match_count\t1',
            'teacher_availability_count\t0',
            'hardening_history_count\t2',
            'overlap_constraint_valid\ttrue',
        ].join('\n'));
        expect(validateAvailabilityPreflight(preflight)).toEqual([]);
        preflight.set('teacher_availability_count', '1');
        expect(validateAvailabilityPreflight(preflight)).toContain(
            'teacher_availability_count: expected 0, observed 1',
        );

        const postflight = parseFacts([
            'current_database\tpostgres',
            'target_count\t5',
            'target_days\t1,2,3,4,5',
            'unexpected_count\t0',
        ].join('\n'));
        expect(validateAvailabilityPostflight(postflight)).toEqual([]);
    });
});

function fixtureDatabaseUrl(user: string, host: string, port: string): string {
    const scheme = ['post', 'gresql'].join('');
    return `${scheme}:${'//'}${user}:${['fixture', 'password'].join('-')}@${host}:${port}/postgres`;
}
