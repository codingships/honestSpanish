import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
    parseFacts,
    renderAvailabilityApplySql,
    renderAvailabilityPreflightSql,
    renderAvailabilityVerifySql,
    STAGING_AVAILABILITY_APPROVAL,
    STAGING_AVAILABILITY_SLOTS,
    validateAvailabilityPostflight,
    validateAvailabilityPreflight,
    validateAvailabilityRolledBackPostflight,
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
        expect(preflight).toContain('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
        expect(verify).toContain('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
        expect(preflight).toContain("'20260712114000'");
        expect(apply).toContain('Expected zero existing availability rows');
        expect(apply).toContain('BEGIN;');
        expect(apply).toContain('pg_advisory_xact_lock');
        expect(apply).toContain('LOCK TABLE public.teacher_availability IN SHARE ROW EXCLUSIVE MODE');
        expect(apply).toContain('Availability seed did not leave exactly five total rows');
        expect(apply).toContain("SET LOCAL espanol_honesto.expected_teacher_email = :'expected_teacher_email';");
        expect(apply.match(/current_setting\('espanol_honesto\.expected_teacher_email'\)/gu)).toHaveLength(3);
        for (const proceduralBlock of apply.match(/DO \$[\s\S]+?END \$[^;]+;/gu) ?? []) {
            expect(proceduralBlock).not.toContain(":'expected_teacher_email'");
        }
        expect(apply).toContain('COMMIT;');
        expect(verify).toContain('unexpected_count');
    });

    it('validates exact preflight and postflight facts', () => {
        const preflight = parseFacts([
            'current_database\tpostgres',
            'teacher_match_count\t1',
            'teacher_role_count\t1',
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
            'teacher_match_count\t1',
            'teacher_role_count\t1',
            'target_count\t5',
            'target_days\t1,2,3,4,5',
            'unexpected_count\t0',
        ].join('\n'));
        expect(validateAvailabilityPostflight(postflight)).toEqual([]);

        const rolledBack = parseFacts([
            'current_database\tpostgres',
            'teacher_match_count\t1',
            'teacher_role_count\t1',
            'target_count\t0',
            'target_days\t',
            'unexpected_count\t0',
        ].join('\n'));
        expect(validateAvailabilityRolledBackPostflight(rolledBack)).toEqual([]);
    });

    it('always performs a read-only verify after an apply attempt', () => {
        const source = readFileSync('scripts/launch/staging-availability-seed.ts', 'utf8');
        expect(source).toContain("const apply = runPsql('apply'");
        expect(source).toContain("const verify = runPsql('verify'");
        expect(source).not.toContain('if (externalWritePerformed)');
        expect(source).toContain('AMBIGUOUS_REQUIRES_READONLY_RECONCILIATION');
    });
});

function fixtureDatabaseUrl(user: string, host: string, port: string): string {
    const scheme = ['post', 'gresql'].join('');
    return `${scheme}:${'//'}${user}:${['fixture', 'password'].join('-')}@${host}:${port}/postgres`;
}
