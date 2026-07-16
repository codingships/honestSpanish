import { createHash } from 'node:crypto';
import {
    hashIdentitySet,
    PRODUCTION_AUTH_FREEZE_CUTOFF,
    type FinalAuthPolicyReceipt,
} from './supabase-production-auth-cleanup-shared';
import { PRODUCTION_ROLLOUT_MIGRATIONS } from './supabase-production-rollout-runner-shared';

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

const productionRolloutHistoryValuesSql = PRODUCTION_ROLLOUT_MIGRATIONS
    .map((migration) => `('${migration.version}', '${migration.name}', '${migration.sha256}')`)
    .join(',\n    ');

const productionRolloutHistoryCanonicalCteSql = [
    'with expected(version, name, source_sha256) as (',
    `  values ${productionRolloutHistoryValuesSql}`,
    '), canonical as (',
    '  select expected.version',
    '  from expected',
    '  left join supabase_migrations.schema_migrations history on history.version = expected.version',
    '  group by expected.version, expected.name, expected.source_sha256',
    '  having count(history.version) = 1',
    '    and bool_and(history.name = expected.name',
    '      and cardinality(history.statements) = 1',
    "      and encode(extensions.digest(convert_to(history.statements[1], 'UTF8'), 'sha256'), 'hex') = expected.source_sha256)",
    ')',
].join('\n');

const productionRolloutHistoryExactCountSql = `${productionRolloutHistoryCanonicalCteSql}\nselect count(*)::integer from canonical`;

export type ProductionAvailabilityIdentityIds = {
    adminId: string;
    teacherId: string;
};

export function normalizeProductionAvailabilityOutput(output: string): {
    output: string;
    identityIds: ProductionAvailabilityIdentityIds | null;
} {
    let adminId = '';
    let teacherId = '';
    const safeLines: string[] = [];
    for (const line of output.split(/\r?\n/u)) {
        const separator = line.indexOf('\t');
        const key = separator > 0 ? line.slice(0, separator).trim() : '';
        const value = separator > 0 ? line.slice(separator + 1).trim() : '';
        if (key === 'admin_profile_id') {
            adminId = value;
            continue;
        }
        if (key === 'teacher_profile_id') {
            teacherId = value;
            continue;
        }
        safeLines.push(line);
    }
    let identityIds: ProductionAvailabilityIdentityIds | null = null;
    if (adminId || teacherId) {
        try {
            const preservedSetSha256 = hashIdentitySet([adminId, teacherId]);
            identityIds = { adminId, teacherId };
            safeLines.push(`preserved_set_sha256\t${preservedSetSha256}`);
        } catch {
            safeLines.push('preserved_set_sha256\tinvalid');
        }
    }
    return { output: safeLines.join('\n'), identityIds };
}

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

export function validateFinalAuthPolicyReceipt(value: unknown, now = new Date()): string[] {
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
        freezeCutoff: PRODUCTION_AUTH_FREEZE_CUTOFF,
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
        'preservedRoleBindingSha256',
    ]) {
        if (typeof value[key] !== 'string' || !/^[a-f0-9]{64}$/u.test(value[key])) errors.push(`${key} must be a lowercase SHA-256`);
    }
    if (typeof value.closedAt !== 'string' || !Number.isFinite(Date.parse(value.closedAt))) errors.push('closedAt must be an ISO timestamp');
    if (typeof value.quarantineUntil !== 'string' || !Number.isFinite(Date.parse(value.quarantineUntil))) errors.push('quarantineUntil must be an ISO timestamp');
    if (typeof value.closedAt === 'string' && typeof value.quarantineUntil === 'string'
        && Number.isFinite(Date.parse(value.closedAt)) && Number.isFinite(Date.parse(value.quarantineUntil))) {
        if (Date.parse(value.closedAt) < Date.parse(value.quarantineUntil)) errors.push('closedAt must be at or after quarantineUntil');
        if (Date.parse(value.quarantineUntil) > now.getTime()) errors.push('quarantineUntil must have elapsed');
        if (Date.parse(value.closedAt) > now.getTime() + 300_000) errors.push('closedAt cannot be in the future');
    }
    return errors;
}

export function renderProductionAvailabilityPreflightSql(): string {
    return `${[
        '\\set ON_ERROR_STOP on',
        'BEGIN READ ONLY;',
        'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ;',
        "select 'current_database', current_database();",
        "select 'teacher_match_count', count(*)::text from public.profiles",
        "where role::text = 'teacher' and lower(email) = lower(:'expected_teacher_email');",
        "select 'profile_role_counts', ((count(*) filter (where role::text = 'admin'))::text || ',' ||",
        "  (count(*) filter (where role::text = 'teacher'))::text || ',' ||",
        "  (count(*) filter (where role::text = 'student'))::text || ',' ||",
        "  (count(*) filter (where role::text not in ('admin', 'teacher', 'student')))::text) from public.profiles;",
        "select 'auth_user_count', count(*)::text from auth.users;",
        "select 'auth_session_counts', ((select count(*) from auth.sessions)::text || ',' ||",
        "  (select count(*) from auth.refresh_tokens)::text);",
        "select 'teacher_auth_link_count', count(*)::text from public.profiles profile",
        'join auth.users identity on identity.id = profile.id',
        "where profile.role::text = 'teacher' and lower(profile.email) = lower(:'expected_teacher_email')",
        "  and lower(identity.email) = lower(:'expected_teacher_email');",
        "select 'admin_profile_id', coalesce(min(id)::text, '') from public.profiles where role::text = 'admin';",
        "select 'teacher_profile_id', coalesce(min(id)::text, '') from public.profiles",
        "where role::text = 'teacher' and lower(email) = lower(:'expected_teacher_email');",
        "select 'teacher_availability_count', count(*)::text",
        'from public.teacher_availability availability',
        'join public.profiles profile on profile.id = availability.teacher_id',
        "where profile.role::text = 'teacher' and lower(profile.email) = lower(:'expected_teacher_email');",
        "select 'final_profile_counts', ((select count(*) from public.profiles)::text || ',' || (select count(*) from public.profiles_private)::text);",
        "select 'rollout_history_exact_count', exact_count::text",
        `from (${productionRolloutHistoryExactCountSql}) exact_rollout(exact_count);`,
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
        "SET LOCAL espanol_honesto.expected_teacher_email = :'expected_teacher_email';",
        "SET LOCAL espanol_honesto.expected_admin_id = :'expected_admin_id';",
        "SET LOCAL espanol_honesto.expected_teacher_id = :'expected_teacher_id';",
        "SELECT pg_advisory_xact_lock(hashtextextended('espanol-honesto:production-availability:vkkahxsybhbutszerawz', 0));",
        'LOCK TABLE auth.users IN SHARE MODE;',
        'LOCK TABLE auth.sessions IN SHARE MODE;',
        'LOCK TABLE auth.refresh_tokens IN SHARE MODE;',
        'LOCK TABLE supabase_migrations.schema_migrations IN SHARE MODE;',
        'LOCK TABLE public.profiles IN SHARE MODE;',
        'LOCK TABLE public.profiles_private IN SHARE MODE;',
        'LOCK TABLE public.teacher_availability IN SHARE ROW EXCLUSIVE MODE;',
        'DO $availability_gate$',
        'DECLARE v_admin_id uuid; v_teacher_id uuid; v_existing integer; v_profiles integer; v_private integer;',
        'DECLARE v_admin_roles integer; v_teacher_roles integer; v_student_roles integer; v_other_roles integer;',
        'DECLARE v_auth integer; v_teacher_auth integer; v_private_bound integer; v_sessions integer; v_refresh_tokens integer; v_rollout_migrations integer;',
        'BEGIN',
        '  SELECT count(*) INTO v_profiles FROM public.profiles;',
        '  SELECT count(*) INTO v_private FROM public.profiles_private;',
        "  IF v_profiles <> 2 OR v_private <> 2 THEN RAISE EXCEPTION 'Expected exact finalized two-profile Auth policy state'; END IF;",
        "  SELECT count(*) FILTER (WHERE role::text = 'admin'), count(*) FILTER (WHERE role::text = 'teacher'),",
        "    count(*) FILTER (WHERE role::text = 'student'), count(*) FILTER (WHERE role::text NOT IN ('admin', 'teacher', 'student'))",
        '  INTO v_admin_roles, v_teacher_roles, v_student_roles, v_other_roles FROM public.profiles;',
        "  IF v_admin_roles <> 1 OR v_teacher_roles <> 1 OR v_student_roles <> 0 OR v_other_roles <> 0 THEN RAISE EXCEPTION 'Expected exact admin teacher production role set'; END IF;",
        '  SELECT id INTO STRICT v_admin_id FROM public.profiles',
        "  WHERE id = current_setting('espanol_honesto.expected_admin_id')::uuid AND role::text = 'admin';",
        '  SELECT id INTO STRICT v_teacher_id FROM public.profiles',
        "  WHERE id = current_setting('espanol_honesto.expected_teacher_id')::uuid AND role::text = 'teacher'",
        "    AND lower(email) = lower(current_setting('espanol_honesto.expected_teacher_email'));",
        '  SELECT count(*) INTO v_auth FROM auth.users WHERE id IN (v_admin_id, v_teacher_id);',
        '  SELECT count(*) INTO v_teacher_auth FROM auth.users',
        "  WHERE id = v_teacher_id AND lower(email) = lower(current_setting('espanol_honesto.expected_teacher_email'));",
        '  SELECT count(*) INTO v_private_bound FROM public.profiles_private WHERE profile_id IN (v_admin_id, v_teacher_id);',
        "  IF v_auth <> 2 OR v_teacher_auth <> 1 OR v_private_bound <> 2 THEN RAISE EXCEPTION 'Preserved production identities no longer match the approved receipt'; END IF;",
        '  SELECT count(*) INTO v_sessions FROM auth.sessions;',
        '  SELECT count(*) INTO v_refresh_tokens FROM auth.refresh_tokens;',
        "  IF v_sessions <> 0 OR v_refresh_tokens <> 0 THEN RAISE EXCEPTION 'Expected zero production Auth sessions and refresh tokens'; END IF;",
        `  ${productionRolloutHistoryCanonicalCteSql}\n  select count(*)::integer into v_rollout_migrations from canonical;`,
        "  IF v_rollout_migrations <> 25 THEN RAISE EXCEPTION 'Expected exact canonical 25-migration production rollout'; END IF;",
        '  SELECT count(*) INTO v_existing FROM public.teacher_availability WHERE teacher_id = v_teacher_id;',
        "  IF v_existing <> 0 THEN RAISE EXCEPTION 'Expected zero existing availability rows for the production teacher'; END IF;",
        'END $availability_gate$;',
        'WITH target_teacher AS (',
        '  SELECT id FROM public.profiles',
        "  WHERE id = current_setting('espanol_honesto.expected_teacher_id')::uuid",
        "    AND role::text = 'teacher' AND lower(email) = lower(:'expected_teacher_email')",
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
        "  WHERE profile.id = current_setting('espanol_honesto.expected_teacher_id')::uuid;",
        "  IF v_count <> 5 THEN RAISE EXCEPTION 'Production availability seed did not create exactly five target rows'; END IF;",
        "  IF v_total <> 5 THEN RAISE EXCEPTION 'Production availability seed did not leave exactly five total rows'; END IF;",
        'END $availability_assert$;',
        'COMMIT;',
        '',
    ].join('\n')}\n`;
}

export function renderProductionAvailabilityVerifySql(): string {
    return `${[
        '\\set ON_ERROR_STOP on',
        'BEGIN READ ONLY;',
        'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ;',
        "select 'current_database', current_database();",
        "select 'teacher_match_count', count(*)::text from public.profiles",
        "where role::text = 'teacher' and lower(email) = lower(:'expected_teacher_email');",
        "select 'profile_role_counts', ((count(*) filter (where role::text = 'admin'))::text || ',' ||",
        "  (count(*) filter (where role::text = 'teacher'))::text || ',' ||",
        "  (count(*) filter (where role::text = 'student'))::text || ',' ||",
        "  (count(*) filter (where role::text not in ('admin', 'teacher', 'student')))::text) from public.profiles;",
        "select 'auth_user_count', count(*)::text from auth.users;",
        "select 'auth_session_counts', ((select count(*) from auth.sessions)::text || ',' ||",
        "  (select count(*) from auth.refresh_tokens)::text);",
        "select 'rollout_history_exact_count', exact_count::text",
        `from (${productionRolloutHistoryExactCountSql}) exact_rollout(exact_count);`,
        "select 'teacher_auth_link_count', count(*)::text from public.profiles profile",
        'join auth.users identity on identity.id = profile.id',
        "where profile.role::text = 'teacher' and lower(profile.email) = lower(:'expected_teacher_email')",
        "  and lower(identity.email) = lower(:'expected_teacher_email');",
        "select 'final_profile_counts', ((select count(*) from public.profiles)::text || ',' || (select count(*) from public.profiles_private)::text);",
        "select 'admin_profile_id', coalesce(min(id)::text, '') from public.profiles where role::text = 'admin';",
        "select 'teacher_profile_id', coalesce(min(id)::text, '') from public.profiles",
        "where role::text = 'teacher' and lower(email) = lower(:'expected_teacher_email');",
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

export function validateProductionAvailabilityPreflight(
    facts: Map<string, string>,
    expectedPreservedSetSha256: string,
): string[] {
    return mismatches(facts, {
        current_database: 'postgres',
        teacher_match_count: '1',
        profile_role_counts: '1,1,0,0',
        auth_user_count: '2',
        auth_session_counts: '0,0',
        teacher_auth_link_count: '1',
        preserved_set_sha256: expectedPreservedSetSha256,
        teacher_availability_count: '0',
        final_profile_counts: '2,2',
        rollout_history_exact_count: String(PRODUCTION_ROLLOUT_MIGRATIONS.length),
        overlap_constraint_valid: 'true',
    });
}

export function validateProductionAvailabilityPostflight(
    facts: Map<string, string>,
    expectedPreservedSetSha256: string,
): string[] {
    return mismatches(facts, {
        current_database: 'postgres',
        teacher_match_count: '1',
        profile_role_counts: '1,1,0,0',
        auth_user_count: '2',
        auth_session_counts: '0,0',
        rollout_history_exact_count: String(PRODUCTION_ROLLOUT_MIGRATIONS.length),
        teacher_auth_link_count: '1',
        final_profile_counts: '2,2',
        preserved_set_sha256: expectedPreservedSetSha256,
        target_count: '5',
        target_days: '1,2,3,4,5',
        unexpected_count: '0',
    });
}

export function validateProductionAvailabilityRolledBackPostflight(
    facts: Map<string, string>,
    expectedPreservedSetSha256: string,
): string[] {
    return mismatches(facts, {
        current_database: 'postgres',
        teacher_match_count: '1',
        profile_role_counts: '1,1,0,0',
        auth_user_count: '2',
        auth_session_counts: '0,0',
        rollout_history_exact_count: String(PRODUCTION_ROLLOUT_MIGRATIONS.length),
        teacher_auth_link_count: '1',
        final_profile_counts: '2,2',
        preserved_set_sha256: expectedPreservedSetSha256,
        target_count: '0',
        target_days: '',
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
