import { createHash } from 'node:crypto';

export const STAGING_AVAILABILITY_TARGET = {
    projectRef: 'mzjyvmlxfpzdfdjzxxyj',
    databaseName: 'postgres',
    timezone: 'Europe/Madrid',
} as const;

export const STAGING_AVAILABILITY_APPROVAL_ENV = 'STAGING_AVAILABILITY_APPROVAL';
export const STAGING_AVAILABILITY_DB_URL_ENV = 'SUPABASE_STAGING_DB_URL';
export const STAGING_AVAILABILITY_APPROVAL = 'Autorizo crear exclusivamente en Supabase staging `mzjyvmlxfpzdfdjzxxyj` cinco franjas semanales de disponibilidad demo para el unico perfil profesor de `TEST_TEACHER_EMAIL`: lunes a viernes, 09:00-18:00, zona operativa Europe/Madrid; ejecutar preflight de solo lectura, insertar solo si no existe ninguna disponibilidad para ese profesor y verificar despues el conjunto exacto. No autorizo produccion, reservas, Calendar, emails ni ningun otro cambio externo.';

export const STAGING_AVAILABILITY_SLOTS = [1, 2, 3, 4, 5].map((dayOfWeek) => ({
    dayOfWeek,
    startTime: '09:00:00',
    endTime: '18:00:00',
})) as readonly { dayOfWeek: number; startTime: string; endTime: string }[];

export type DatabaseTargetValidation = {
    valid: boolean;
    reason: string;
    connectionEnv: NodeJS.ProcessEnv | null;
};

export function validateStagingAvailabilityDatabaseUrl(value: string | undefined): DatabaseTargetValidation {
    if (!value) return { valid: false, reason: 'database URL is missing', connectionEnv: null };
    try {
        const parsed = new URL(value);
        const username = decodeURIComponent(parsed.username);
        const direct = parsed.hostname === `db.${STAGING_AVAILABILITY_TARGET.projectRef}.supabase.co`
            && username === 'postgres';
        const pooler = parsed.hostname.endsWith('.pooler.supabase.com')
            && username === `postgres.${STAGING_AVAILABILITY_TARGET.projectRef}`;
        const databaseName = parsed.pathname.replace(/^\//u, '');
        if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || (!direct && !pooler)) {
            return { valid: false, reason: 'database URL is not the exact staging project', connectionEnv: null };
        }
        if (databaseName !== STAGING_AVAILABILITY_TARGET.databaseName || !parsed.password) {
            return { valid: false, reason: 'database URL lacks the expected database or credential', connectionEnv: null };
        }
        return {
            valid: true,
            reason: 'exact staging database endpoint',
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

export function renderAvailabilityPreflightSql(): string {
    return `${[
        '\\set ON_ERROR_STOP on',
        'BEGIN READ ONLY;',
        'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ;',
        "select 'current_database', current_database();",
        "select 'teacher_match_count', count(*)::text from public.profiles",
        "where role::text = 'teacher' and lower(email) = lower(:'expected_teacher_email');",
        "select 'teacher_role_count', count(*)::text from public.profiles where role::text = 'teacher';",
        "select 'teacher_availability_count', count(*)::text",
        'from public.teacher_availability availability',
        'join public.profiles profile on profile.id = availability.teacher_id',
        "where profile.role::text = 'teacher' and lower(profile.email) = lower(:'expected_teacher_email');",
        "select 'hardening_history_count', count(*)::text",
        'from supabase_migrations.schema_migrations',
        "where version in ('20260712114000', '20260712114500');",
        "select 'overlap_constraint_valid', exists(",
        '  select 1 from pg_constraint',
        "  where conrelid = 'public.teacher_availability'::regclass",
        "    and conname = 'teacher_availability_no_active_overlap' and contype = 'x'",
        ')::text;',
        'COMMIT;',
        '',
    ].join('\n')}\n`;
}

export function renderAvailabilityApplySql(): string {
    const values = STAGING_AVAILABILITY_SLOTS
        .map((slot) => `(${slot.dayOfWeek}, '${slot.startTime}'::time, '${slot.endTime}'::time)`)
        .join(',\n        ');
    return `${[
        '\\set ON_ERROR_STOP on',
        'BEGIN;',
        "SET LOCAL lock_timeout = '5s';",
        "SET LOCAL statement_timeout = '30s';",
        "SET LOCAL espanol_honesto.expected_teacher_email = :'expected_teacher_email';",
        "SELECT pg_advisory_xact_lock(hashtextextended('espanol-honesto:staging-availability:mzjyvmlxfpzdfdjzxxyj', 0));",
        'LOCK TABLE public.profiles IN SHARE MODE;',
        'LOCK TABLE public.teacher_availability IN SHARE ROW EXCLUSIVE MODE;',
        'DO $availability_gate$',
        'DECLARE v_teacher_id uuid; v_existing integer; v_teacher_roles integer;',
        'BEGIN',
        "  SELECT count(*) INTO v_teacher_roles FROM public.profiles WHERE role::text = 'teacher';",
        "  IF v_teacher_roles <> 1 THEN RAISE EXCEPTION 'Expected exactly one staging teacher role'; END IF;",
        "  SELECT id INTO STRICT v_teacher_id FROM public.profiles",
        "  WHERE role::text = 'teacher' AND lower(email) = lower(current_setting('espanol_honesto.expected_teacher_email'));",
        '  SELECT count(*) INTO v_existing FROM public.teacher_availability WHERE teacher_id = v_teacher_id;',
        "  IF v_existing <> 0 THEN RAISE EXCEPTION 'Expected zero existing availability rows for the staging teacher'; END IF;",
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
        'DECLARE v_count integer; v_total integer;',
        'BEGIN',
        '  SELECT count(*) INTO v_count',
        '  FROM public.teacher_availability availability',
        '  JOIN public.profiles profile ON profile.id = availability.teacher_id',
        "  WHERE profile.role::text = 'teacher' AND lower(profile.email) = lower(current_setting('espanol_honesto.expected_teacher_email'))",
        "    AND availability.is_active AND availability.day_of_week BETWEEN 1 AND 5",
        "    AND availability.start_time = '09:00:00'::time AND availability.end_time = '18:00:00'::time;",
        '  SELECT count(*) INTO v_total',
        '  FROM public.teacher_availability availability',
        '  JOIN public.profiles profile ON profile.id = availability.teacher_id',
        "  WHERE profile.role::text = 'teacher' AND lower(profile.email) = lower(current_setting('espanol_honesto.expected_teacher_email'));",
        "  IF v_count <> 5 THEN RAISE EXCEPTION 'Availability seed did not create exactly five target rows'; END IF;",
        "  IF v_total <> 5 THEN RAISE EXCEPTION 'Availability seed did not leave exactly five total rows'; END IF;",
        'END $availability_assert$;',
        'COMMIT;',
        '',
    ].join('\n')}\n`;
}

export function renderAvailabilityVerifySql(): string {
    return `${[
        '\\set ON_ERROR_STOP on',
        'BEGIN READ ONLY;',
        'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ;',
        "select 'current_database', current_database();",
        "select 'teacher_match_count', count(*)::text from public.profiles",
        "where role::text = 'teacher' and lower(email) = lower(:'expected_teacher_email');",
        "select 'teacher_role_count', count(*)::text from public.profiles where role::text = 'teacher';",
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

export function parseFacts(output: string): Map<string, string> {
    const facts = new Map<string, string>();
    for (const line of output.split(/\r?\n/u)) {
        const separator = line.indexOf('\t');
        if (separator > 0) facts.set(line.slice(0, separator).trim(), line.slice(separator + 1).trim());
    }
    return facts;
}

export function validateAvailabilityPreflight(facts: Map<string, string>): string[] {
    const expected: Record<string, string> = {
        current_database: 'postgres',
        teacher_match_count: '1',
        teacher_role_count: '1',
        teacher_availability_count: '0',
        hardening_history_count: '2',
        overlap_constraint_valid: 'true',
    };
    return mismatches(facts, expected);
}

export function validateAvailabilityPostflight(facts: Map<string, string>): string[] {
    return mismatches(facts, {
        current_database: 'postgres',
        teacher_match_count: '1',
        teacher_role_count: '1',
        target_count: '5',
        target_days: '1,2,3,4,5',
        unexpected_count: '0',
    });
}

export function validateAvailabilityRolledBackPostflight(facts: Map<string, string>): string[] {
    return mismatches(facts, {
        current_database: 'postgres',
        teacher_match_count: '1',
        teacher_role_count: '1',
        target_count: '0',
        target_days: '',
        unexpected_count: '0',
    });
}

export function sha256(value: string): string {
    return createHash('sha256').update(value).digest('hex');
}

function mismatches(facts: Map<string, string>, expected: Record<string, string>): string[] {
    return Object.entries(expected)
        .filter(([key, value]) => facts.get(key) !== value)
        .map(([key, value]) => `${key}: expected ${value}, observed ${facts.get(key) ?? 'missing'}`);
}
