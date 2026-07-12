import { createHash } from 'node:crypto';
import type { FinalAuthPolicyReceipt } from './supabase-production-auth-cleanup-shared';

export const PRODUCTION_AVAILABILITY_TARGET = {
    projectRef: 'vkkahxsybhbutszerawz',
    databaseName: 'postgres',
    timezone: 'Europe/Madrid',
} as const;

export const PRODUCTION_AVAILABILITY_APPROVAL_ENV = 'SUPABASE_PRODUCTION_AVAILABILITY_APPROVAL';
export const PRODUCTION_AVAILABILITY_DB_URL_ENV = 'SUPABASE_PRODUCTION_DB_URL';
export const PRODUCTION_AVAILABILITY_INERT_CONFIRMATION_ENV = 'SUPABASE_PRODUCTION_AUTH_INERT_CONFIRMATION';
export const PRODUCTION_AVAILABILITY_INERT_CONFIRMATION = 'target=vkkahxsybhbutszerawz | production_inert=true | checkout=DISABLED | signup=DISABLED | no_traffic_until_quarantine_expiry=true';
export const PRODUCTION_AVAILABILITY_APPROVAL = 'Autorizo crear exclusivamente en Supabase produccion `vkkahxsybhbutszerawz`, despues de un `auth-policy-receipt.json` valido y con signup/checkout aun desactivados, cinco franjas semanales para el unico perfil profesor preservado `TEST_TEACHER_EMAIL`: lunes a viernes, 09:00-18:00, zona operativa Europe/Madrid; ejecutar preflight de solo lectura, insertar solo si no existe ninguna disponibilidad para ese profesor y verificar el conjunto exacto. No autorizo staging, reservas, Calendar, emails, Auth, otros perfiles ni ningun otro cambio externo.';

export const PRODUCTION_AVAILABILITY_SLOTS = [1, 2, 3, 4, 5].map((dayOfWeek) => ({
    dayOfWeek,
    startTime: '09:00:00',
    endTime: '18:00:00',
})) as readonly { dayOfWeek: number; startTime: string; endTime: string }[];

export function validateProductionAvailabilityDatabaseUrl(value: string | undefined): {
    valid: boolean;
    reason: string;
    connectionEnv: NodeJS.ProcessEnv | null;
} {
    if (!value) return { valid: false, reason: 'database URL is missing', connectionEnv: null };
    try {
        const parsed = new URL(value);
        const username = decodeURIComponent(parsed.username);
        const direct = parsed.hostname === `db.${PRODUCTION_AVAILABILITY_TARGET.projectRef}.supabase.co`
            && username === 'postgres';
        const pooler = parsed.hostname.endsWith('.pooler.supabase.com')
            && username === `postgres.${PRODUCTION_AVAILABILITY_TARGET.projectRef}`;
        const databaseName = parsed.pathname.replace(/^\//u, '');
        if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || (!direct && !pooler)) {
            return { valid: false, reason: 'database URL is not the exact production project', connectionEnv: null };
        }
        if (databaseName !== PRODUCTION_AVAILABILITY_TARGET.databaseName || !parsed.password) {
            return { valid: false, reason: 'database URL lacks the expected database or credential', connectionEnv: null };
        }
        return {
            valid: true,
            reason: 'exact production database endpoint',
            connectionEnv: {
                PGHOST: parsed.hostname,
                PGPORT: parsed.port || '5432',
                PGUSER: username,
                PGPASSWORD: decodeURIComponent(parsed.password),
                PGDATABASE: databaseName,
            },
        };
    } catch {
        return { valid: false, reason: 'database URL is invalid', connectionEnv: null };
    }
}

export function validateFinalAuthPolicyReceipt(value: unknown): string[] {
    if (!isRecord(value)) return ['receipt must be an object'];
    const errors: string[] = [];
    const expected: Record<string, unknown> = {
        schemaVersion: 1,
        targetProjectRef: PRODUCTION_AVAILABILITY_TARGET.projectRef,
        status: 'CLOSED_AND_VERIFIED',
        mode: 'preserve_admin_teacher',
        authUsersRemaining: 2,
        publicProfilesRemaining: 2,
        publicProfilesPrivateRemaining: 2,
        fixtureStudentsRemaining: 0,
        storageObjectsTouched: false,
        externalProvidersTouched: false,
        passwordsRotatedUnretained: true,
        sessionsInvalidatedOrExpired: true,
        resetEmailsSent: false,
        googleDriveFixtureFolders: 'UNTOUCHED_110_OBSERVED',
    };
    for (const [key, expectedValue] of Object.entries(expected)) {
        if (value[key] !== expectedValue) errors.push(`${key} must equal ${String(expectedValue)}`);
    }
    const roles = value.profileRoles;
    if (!isRecord(roles) || roles.admin !== 1 || roles.teacher !== 1 || roles.student !== 0) {
        errors.push('profileRoles must be exactly admin=1, teacher=1, student=0');
    }
    for (const key of [
        'backupReceiptSha256',
        'publicCleanupReceiptSha256',
        'authReducedReceiptSha256',
        'productionRolloutReceiptSha256',
        'preservedSetSha256',
    ]) {
        if (typeof value[key] !== 'string' || !/^[a-f0-9]{64}$/u.test(value[key])) errors.push(`${key} must be a lowercase SHA-256`);
    }
    if (typeof value.closedAt !== 'string' || !Number.isFinite(Date.parse(value.closedAt))) errors.push('closedAt must be an ISO timestamp');
    if (typeof value.quarantineUntil !== 'string' || !Number.isFinite(Date.parse(value.quarantineUntil))) errors.push('quarantineUntil must be an ISO timestamp');
    return errors;
}

export function renderProductionAvailabilityPreflightSql(): string {
    return `${[
        '\\set ON_ERROR_STOP on',
        'BEGIN READ ONLY;',
        "select 'current_database', current_database();",
        "select 'teacher_match_count', count(*)::text from public.profiles",
        "where role::text = 'teacher' and lower(email) = lower(:'expected_teacher_email');",
        "select 'teacher_availability_count', count(*)::text",
        'from public.teacher_availability availability',
        'join public.profiles profile on profile.id = availability.teacher_id',
        "where profile.role::text = 'teacher' and lower(profile.email) = lower(:'expected_teacher_email');",
        "select 'final_profile_counts', ((select count(*) from public.profiles)::text || ',' || (select count(*) from public.profiles_private)::text);",
        "select 'hardening_history_count', count(*)::text",
        'from supabase_migrations.schema_migrations',
        "where version in ('20260712114000', '20260712114500');",
        "select 'overlap_constraint_valid', exists(",
        '  select 1 from pg_constraint',
        "  where conrelid = 'public.teacher_availability'::regclass",
        "    and conname = 'teacher_availability_no_active_overlap' and contype = 'x' and convalidated",
        ')::text;',
        'COMMIT;',
        '',
    ].join('\n')}\n`;
}

export function renderProductionAvailabilityApplySql(): string {
    const values = PRODUCTION_AVAILABILITY_SLOTS
        .map((slot) => `(${slot.dayOfWeek}, '${slot.startTime}'::time, '${slot.endTime}'::time)`)
        .join(',\n        ');
    return `${[
        '\\set ON_ERROR_STOP on',
        'BEGIN;',
        "SET LOCAL lock_timeout = '5s';",
        "SET LOCAL statement_timeout = '30s';",
        'DO $availability_gate$',
        'DECLARE v_teacher_id uuid; v_existing integer; v_profiles integer; v_private integer;',
        'BEGIN',
        '  SELECT count(*) INTO v_profiles FROM public.profiles;',
        '  SELECT count(*) INTO v_private FROM public.profiles_private;',
        "  IF v_profiles <> 2 OR v_private <> 2 THEN RAISE EXCEPTION 'Expected exact finalized two-profile Auth policy state'; END IF;",
        '  SELECT id INTO STRICT v_teacher_id FROM public.profiles',
        "  WHERE role::text = 'teacher' AND lower(email) = lower(:'expected_teacher_email');",
        '  SELECT count(*) INTO v_existing FROM public.teacher_availability WHERE teacher_id = v_teacher_id;',
        "  IF v_existing <> 0 THEN RAISE EXCEPTION 'Expected zero existing availability rows for the production teacher'; END IF;",
        'END $availability_gate$;',
        'WITH target_teacher AS (',
        '  SELECT id FROM public.profiles',
        "  WHERE role::text = 'teacher' AND lower(email) = lower(:'expected_teacher_email')",
        '), slots(day_of_week, start_time, end_time) AS (',
        `  VALUES ${values}`,
        ')',
        'INSERT INTO public.teacher_availability (teacher_id, day_of_week, start_time, end_time, is_active)',
        'SELECT target_teacher.id, slots.day_of_week, slots.start_time, slots.end_time, true',
        'FROM target_teacher CROSS JOIN slots;',
        'DO $availability_assert$',
        'DECLARE v_count integer;',
        'BEGIN',
        '  SELECT count(*) INTO v_count',
        '  FROM public.teacher_availability availability',
        '  JOIN public.profiles profile ON profile.id = availability.teacher_id',
        "  WHERE profile.role::text = 'teacher' AND lower(profile.email) = lower(:'expected_teacher_email')",
        "    AND availability.is_active AND availability.day_of_week BETWEEN 1 AND 5",
        "    AND availability.start_time = '09:00:00'::time AND availability.end_time = '18:00:00'::time;",
        "  IF v_count <> 5 THEN RAISE EXCEPTION 'Production availability seed did not create exactly five target rows'; END IF;",
        'END $availability_assert$;',
        'COMMIT;',
        '',
    ].join('\n')}\n`;
}

export function renderProductionAvailabilityVerifySql(): string {
    return `${[
        '\\set ON_ERROR_STOP on',
        'BEGIN READ ONLY;',
        "select 'current_database', current_database();",
        "select 'target_count', count(*)::text",
        'from public.teacher_availability availability',
        'join public.profiles profile on profile.id = availability.teacher_id',
        "where profile.role::text = 'teacher' and lower(profile.email) = lower(:'expected_teacher_email')",
        "  and availability.is_active and availability.day_of_week between 1 and 5",
        "  and availability.start_time = '09:00:00'::time and availability.end_time = '18:00:00'::time;",
        "select 'target_days', coalesce(string_agg(availability.day_of_week::text, ',' order by availability.day_of_week), '')",
        'from public.teacher_availability availability',
        'join public.profiles profile on profile.id = availability.teacher_id',
        "where profile.role::text = 'teacher' and lower(profile.email) = lower(:'expected_teacher_email');",
        "select 'unexpected_count', count(*)::text",
        'from public.teacher_availability availability',
        'join public.profiles profile on profile.id = availability.teacher_id',
        "where profile.role::text = 'teacher' and lower(profile.email) = lower(:'expected_teacher_email')",
        "  and not (availability.is_active and availability.day_of_week between 1 and 5",
        "    and availability.start_time = '09:00:00'::time and availability.end_time = '18:00:00'::time);",
        'COMMIT;',
        '',
    ].join('\n')}\n`;
}

export function parseAvailabilityFacts(output: string): Map<string, string> {
    const facts = new Map<string, string>();
    for (const line of output.split(/\r?\n/u)) {
        const separator = line.indexOf('\t');
        if (separator > 0) facts.set(line.slice(0, separator).trim(), line.slice(separator + 1).trim());
    }
    return facts;
}

export function validateProductionAvailabilityPreflight(facts: Map<string, string>): string[] {
    return mismatches(facts, {
        current_database: 'postgres',
        teacher_match_count: '1',
        teacher_availability_count: '0',
        final_profile_counts: '2,2',
        hardening_history_count: '2',
        overlap_constraint_valid: 'true',
    });
}

export function validateProductionAvailabilityPostflight(facts: Map<string, string>): string[] {
    return mismatches(facts, {
        current_database: 'postgres',
        target_count: '5',
        target_days: '1,2,3,4,5',
        unexpected_count: '0',
    });
}

export function sha256Availability(value: string): string {
    return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function asFinalAuthPolicyReceipt(value: unknown): FinalAuthPolicyReceipt | null {
    return validateFinalAuthPolicyReceipt(value).length === 0 ? value as FinalAuthPolicyReceipt : null;
}

function mismatches(facts: Map<string, string>, expected: Record<string, string>): string[] {
    return Object.entries(expected)
        .filter(([key, value]) => facts.get(key) !== value)
        .map(([key, value]) => `${key}: expected ${value}, observed ${facts.get(key) ?? 'missing'}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
