import { createHash } from 'node:crypto';
import { LEGAL_POLICY_VERSION } from '../../src/lib/legal-policy';
import {
    PRODUCTION_AVAILABILITY_SLOTS,
    PRODUCTION_AVAILABILITY_TARGET,
    validateFinalAuthPolicyReceipt,
    validateProductionAvailabilityDatabaseUrl,
} from './production-availability-shared';
import {
    FIXTURE_CLEANUP_TARGET,
    stableJson,
    type DatabaseConnectionEnvironment,
} from './production-fixture-cleanup-shared';
import {
    hashIdentitySet,
    hashRoleBoundIdentitySet,
    type FinalAuthPolicyReceipt,
} from './supabase-production-auth-cleanup-shared';
import {
    PRODUCTION_ROLLOUT_MIGRATIONS,
    productionRolloutAllowlistSha256,
    productionRolloutMigrationManifestSha256,
} from './supabase-production-rollout-runner-shared';
import {
    PRODUCTION_PROJECT,
    STAGING_ONLY_MIGRATIONS,
    STAGING_ONLY_VERSIONS,
} from './supabase-production-rollout-shared';

export const PRODUCTION_INERT_FINAL_RECEIPT_KIND = 'production_inert_final_readonly';
export const PRODUCTION_INERT_FINAL_STATUS = 'PRODUCTION_INERT_FINAL_READONLY_VERIFIED';
export const PRODUCTION_INERT_FINAL_RECEIPT_MAX_AGE_MS = 15 * 60 * 1_000;
export const PRODUCTION_INERT_FINAL_DATABASE_READBACKS = 2;
export const PRODUCTION_INERT_FINAL_DB_URL_ENV = 'SUPABASE_PRODUCTION_DB_URL';
export const PRODUCTION_INERT_FINAL_OUTPUT_FILE = 'production-inert-final-receipt.json';
export const PRODUCTION_INERT_FINAL_ATTEMPT_FILE = 'summary.json';
export const PRODUCTION_BASELINE_HISTORY_COUNT = 24;
export const PRODUCTION_EXPECTED_HISTORY_COUNT = PRODUCTION_BASELINE_HISTORY_COUNT
    + PRODUCTION_ROLLOUT_MIGRATIONS.length;

export const PRODUCTION_INERT_ZERO_ROW_TABLES = [
    'subscriptions',
    'student_teachers',
    'sessions',
    'payments',
    'leads',
    'processed_webhook_events',
    'fulfillment_jobs',
    'support_tickets',
    'admin_audit_log',
    'crm_contacts',
    'crm_opportunities',
    'crm_tasks',
    'crm_activities',
    'crm_consents',
    'package_prices',
    'checkout_intents',
    'email_recipient_budget_usage',
    'fulfillment_effects',
] as const;

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/iu;
const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/iu;
const URL_PATTERN = /(?:https?|postgres(?:ql)?):\/\//iu;
const SECRET_PATTERN = /(?:Bearer\s+|sbp_|sb_secret_|eyJ)[A-Za-z0-9._~-]+/iu;

export interface ProductionInertFinalArgs {
    mode: 'plan' | 'capture-readonly';
    rolloutReceiptPath: string | null;
    authPolicyReceiptPath: string | null;
    availabilityReceiptPath: string | null;
}

export interface LoadedReceipt<T = unknown> {
    value: T;
    sha256: string;
}

export interface ProductionInertSourceChain {
    rollout: LoadedReceipt;
    authPolicy: LoadedReceipt<FinalAuthPolicyReceipt>;
    availability: LoadedReceipt;
}

export interface ProductionInertDatabaseReadback {
    facts: Record<string, string>;
    preservedSetSha256: string | null;
    preservedRoleBindingSha256: string | null;
    duplicateKeys: string[];
    identityValuesDiscarded: boolean;
}

export interface ProductionInertFinalReceipt {
    schemaVersion: 1;
    receiptKind: typeof PRODUCTION_INERT_FINAL_RECEIPT_KIND;
    status: typeof PRODUCTION_INERT_FINAL_STATUS;
    targetEnvironment: 'production';
    targetProjectRef: typeof PRODUCTION_PROJECT.ref;
    rolloutReceiptSha256: string;
    authPolicyReceiptSha256: string;
    availabilityReceiptSha256: string;
    preservedSetSha256: string;
    preservedRoleBindingSha256: string;
    canonicalMigrationManifestSha256: string;
    databaseFacts: Record<string, string>;
    databaseStateSha256: string;
    authFlags: {
        disableSignup: true;
        mailerAutoconfirm: false;
    };
    stableDatabaseReadbacks: 2;
    managementApiGetBetweenReadbacks: true;
    externalWritePerformed: false;
    observedAt: string;
    expiresAt: string;
}

export type ProductionInertFinalAttemptStatus =
    | 'CAPTURE_IN_PROGRESS'
    | 'CAPTURE_FAILED'
    | typeof PRODUCTION_INERT_FINAL_STATUS;

export interface ProductionInertFinalAttemptSummary {
    schemaVersion: 1;
    mode: 'capture-readonly';
    status: ProductionInertFinalAttemptStatus;
    targetEnvironment: 'production';
    targetProjectRef: typeof PRODUCTION_PROJECT.ref;
    startedAt: string;
    finishedAt: string | null;
    receiptSha256: string | null;
    receiptFile: typeof PRODUCTION_INERT_FINAL_OUTPUT_FILE | null;
    receiptObservedAt: string | null;
    receiptExpiresAt: string | null;
    failureCategory: string | null;
    externalWritePerformed: false;
}

export function parseProductionInertFinalArgs(argv: readonly string[]): ProductionInertFinalArgs {
    const supported = new Set([
        '--capture-readonly',
        '--rollout-receipt',
        '--auth-policy-receipt',
        '--availability-receipt',
    ]);
    const seen = new Set<string>();
    const values = new Map<string, string>();
    let capture = false;

    for (let index = 0; index < argv.length; index += 1) {
        const argument = argv[index];
        if (!supported.has(argument)) throw new Error(`Unsupported argument: ${argument}`);
        if (seen.has(argument)) throw new Error(`Duplicate argument: ${argument}`);
        seen.add(argument);
        if (argument === '--capture-readonly') {
            capture = true;
            continue;
        }
        const value = argv[index + 1];
        if (!value || value.startsWith('--')) throw new Error(`${argument} requires an explicit path.`);
        values.set(argument, value);
        index += 1;
    }

    if (!capture && values.size > 0) {
        throw new Error('Receipt paths are accepted only with --capture-readonly.');
    }
    if (capture) {
        for (const argument of [
            '--rollout-receipt',
            '--auth-policy-receipt',
            '--availability-receipt',
        ]) {
            if (!values.has(argument)) throw new Error(`${argument} is required with --capture-readonly.`);
        }
    }

    return {
        mode: capture ? 'capture-readonly' : 'plan',
        rolloutReceiptPath: values.get('--rollout-receipt') ?? null,
        authPolicyReceiptPath: values.get('--auth-policy-receipt') ?? null,
        availabilityReceiptPath: values.get('--availability-receipt') ?? null,
    };
}

export function canonicalProductionMigrationManifestSha256(): string {
    return productionRolloutMigrationManifestSha256();
}

export function validateProductionInertFinalDatabaseUrl(
    value: string | undefined,
): DatabaseConnectionEnvironment {
    const validation = validateProductionAvailabilityDatabaseUrl(value);
    if (!validation.valid || !validation.connectionEnv) {
        throw new Error(`Production database target rejected: ${validation.reason}.`);
    }
    const connection = validation.connectionEnv;
    for (const key of ['PGHOST', 'PGPORT', 'PGUSER', 'PGPASSWORD', 'PGDATABASE'] as const) {
        if (!connection[key]) throw new Error(`Production database target lacks ${key}.`);
    }
    return {
        PGHOST: connection.PGHOST as string,
        PGPORT: connection.PGPORT as string,
        PGUSER: connection.PGUSER as string,
        PGPASSWORD: connection.PGPASSWORD as string,
        PGDATABASE: connection.PGDATABASE as string,
    };
}

export function validateProductionInertSourceChain(
    chain: ProductionInertSourceChain,
    now = new Date(),
): string[] {
    const errors: string[] = [];
    const rollout = asRecord(chain.rollout.value);
    const authPolicy = asRecord(chain.authPolicy.value);
    const availability = asRecord(chain.availability.value);

    if (!rollout) {
        errors.push('Production rollout receipt must be an object.');
    } else {
        const expected: Record<string, unknown> = {
            schemaVersion: 1,
            status: 'PRODUCTION_ROLLOUT_ALL_WAVES_APPLIED_AND_VERIFIED',
            targetProjectRef: PRODUCTION_PROJECT.ref,
            through: 'deferred_rc_hardening',
            migrationCount: PRODUCTION_ROLLOUT_MIGRATIONS.length,
            migrationManifestSha256: canonicalProductionMigrationManifestSha256(),
            allowlistSha256: productionRolloutAllowlistSha256(),
            finalVerificationPassed: true,
            stagingOnlyMigrationAbsent: true,
            checkoutRemainedDisabledByOperatorAttestation: true,
            authFinalizeRequired: true,
        };
        for (const [key, expectedValue] of Object.entries(expected)) {
            if (rollout[key] !== expectedValue) {
                errors.push(`Production rollout ${key} must equal ${String(expectedValue)}.`);
            }
        }
        if (!sameStringArray(rollout.stagingOnlyVersions, STAGING_ONLY_VERSIONS)) {
            errors.push('Production rollout stagingOnlyVersions mismatch.');
        }
        for (const key of [
            'preservationPolicySha256',
            'publicCleanupReceiptSha256',
            'backupReceiptSha256',
            'authReducedQuarantinedReceiptSha256',
        ]) {
            if (!isSha256(rollout[key])) errors.push(`Production rollout ${key} must be a lowercase SHA-256.`);
        }
        validatePastTimestamp(rollout.completedAt, 'Production rollout completedAt', now, errors);
    }

    errors.push(...validateFinalAuthPolicyReceipt(chain.authPolicy.value, now)
        .map((error) => `Auth policy: ${error}`));
    if (authPolicy) {
        validatePastTimestamp(authPolicy.closedAt, 'Auth policy closedAt', now, errors);
        if (authPolicy.productionRolloutReceiptSha256 !== chain.rollout.sha256) {
            errors.push('Auth policy is not linked to the supplied production rollout receipt SHA-256.');
        }
        if (!isSha256(authPolicy.preservedSetSha256)) {
            errors.push('Auth policy preservedSetSha256 must be a lowercase SHA-256.');
        }
        if (rollout) {
            for (const [authKey, rolloutKey, label] of [
                ['publicCleanupReceiptSha256', 'publicCleanupReceiptSha256', 'public-cleanup receipt'],
                ['backupReceiptSha256', 'backupReceiptSha256', 'backup receipt'],
                ['authReducedReceiptSha256', 'authReducedQuarantinedReceiptSha256', 'Auth-reduced receipt'],
            ] as const) {
                if (authPolicy[authKey] !== rollout[rolloutKey]) {
                    errors.push(`Auth policy ${label} SHA-256 does not match the production rollout.`);
                }
            }
        }
    }

    if (!availability) {
        errors.push('Production availability receipt must be an object.');
    } else {
        const expected: Record<string, unknown> = {
            schemaVersion: 1,
            status: 'SEEDED_AND_VERIFIED',
            targetProjectRef: PRODUCTION_AVAILABILITY_TARGET.projectRef,
            authPolicyReceiptSha256: chain.authPolicy.sha256,
            timezone: PRODUCTION_AVAILABILITY_TARGET.timezone,
            authUsersRemaining: 2,
            authSessionsRemaining: 0,
            authRefreshTokensRemaining: 0,
            rolloutMigrationsVerified: PRODUCTION_ROLLOUT_MIGRATIONS.length,
            externalProvidersTouched: false,
        };
        for (const [key, expectedValue] of Object.entries(expected)) {
            if (availability[key] !== expectedValue) {
                errors.push(`Production availability ${key} must equal ${String(expectedValue)}.`);
            }
        }
        if (!sameAvailabilitySchedule(availability.schedule)) {
            errors.push('Production availability schedule must be exactly Monday-Friday 09:00-18:00.');
        }
        validatePastTimestamp(availability.verifiedAt, 'Production availability verifiedAt', now, errors);
    }

    if (rollout && authPolicy && availability) {
        const rolloutAt = parseTimestamp(rollout.completedAt);
        const authAt = parseTimestamp(authPolicy.closedAt);
        const availabilityAt = parseTimestamp(availability.verifiedAt);
        if (rolloutAt !== null && authAt !== null && authAt < rolloutAt) {
            errors.push('Auth policy closure predates the linked production rollout.');
        }
        if (authAt !== null && availabilityAt !== null && availabilityAt < authAt) {
            errors.push('Production availability verification predates the linked Auth policy closure.');
        }
    }

    for (const [label, hash] of [
        ['Production rollout receipt', chain.rollout.sha256],
        ['Auth policy receipt', chain.authPolicy.sha256],
        ['Production availability receipt', chain.availability.sha256],
    ] as const) {
        if (!isSha256(hash)) errors.push(`${label} file SHA-256 is invalid.`);
    }
    return errors;
}

export function renderProductionInertFinalReadbackSql(): string {
    const migrationRows = PRODUCTION_ROLLOUT_MIGRATIONS
        .map((entry) => `('${sqlLiteral(entry.version)}','${sqlLiteral(entry.name)}','${entry.sha256}')`)
        .join(',\n        ');
    const stagingOnlyPredicate = STAGING_ONLY_MIGRATIONS
        .map((entry) => `(history.version = '${sqlLiteral(entry.version)}' OR regexp_replace(coalesce(history.name, ''), '^[0-9]+_', '') = '${sqlLiteral(entry.name)}')`)
        .join(' OR ');
    const zeroTableStatements = PRODUCTION_INERT_ZERO_ROW_TABLES
        .map((table) => `SELECT 'row_count_public_${table}', count(*)::text FROM public.${table};`);

    return `${[
        '\\set ON_ERROR_STOP on',
        'BEGIN READ ONLY;',
        'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ;',
        "SET LOCAL statement_timeout = '30s';",
        "SET LOCAL lock_timeout = '5s';",
        "SELECT 'current_database', current_database();",
        "SELECT 'auth_user_count', count(*)::text FROM auth.users;",
        "SELECT 'auth_session_count', count(*)::text FROM auth.sessions;",
        "SELECT 'auth_refresh_token_count', count(*)::text FROM auth.refresh_tokens;",
        "SELECT 'profile_count', count(*)::text FROM public.profiles;",
        "SELECT 'profile_private_count', count(*)::text FROM public.profiles_private;",
        "SELECT 'profile_role_counts', ((count(*) FILTER (WHERE role::text = 'admin'))::text || ',' ||",
        "  (count(*) FILTER (WHERE role::text = 'teacher'))::text || ',' ||",
        "  (count(*) FILTER (WHERE role::text = 'student'))::text || ',' ||",
        "  (count(*) FILTER (WHERE role::text NOT IN ('admin', 'teacher', 'student')))::text) FROM public.profiles;",
        "SELECT 'preserved_auth_link_count', count(*)::text FROM auth.users identity",
        "JOIN public.profiles profile ON profile.id = identity.id WHERE profile.role::text IN ('admin', 'teacher');",
        "SELECT 'preserved_auth_profile_email_match_count', count(*)::text FROM auth.users identity",
        "JOIN public.profiles profile ON profile.id = identity.id",
        "WHERE profile.role::text IN ('admin', 'teacher') AND lower(identity.email) = lower(profile.email);",
        "SELECT 'preserved_expected_role_email_match_count', count(*)::text FROM auth.users identity",
        "JOIN public.profiles profile ON profile.id = identity.id WHERE",
        "  (profile.role::text = 'admin' AND lower(profile.email) = lower(:'expected_admin_email')",
        "    AND lower(identity.email) = lower(:'expected_admin_email')) OR",
        "  (profile.role::text = 'teacher' AND lower(profile.email) = lower(:'expected_teacher_email')",
        "    AND lower(identity.email) = lower(:'expected_teacher_email'));",
        "SELECT 'preserved_private_link_count', count(*)::text FROM public.profiles_private private_profile",
        "JOIN public.profiles profile ON profile.id = private_profile.profile_id WHERE profile.role::text IN ('admin', 'teacher');",
        `SELECT 'non_minimal_profile_count', count(*)::text FROM public.profiles`,
        `WHERE full_name IS NOT NULL OR phone IS NOT NULL OR preferred_language IS DISTINCT FROM 'es'`,
        `  OR timezone IS DISTINCT FROM 'Europe/Madrid' OR adult_confirmed IS DISTINCT FROM TRUE`,
        `  OR adult_confirmed_at IS NULL OR age_policy_version IS DISTINCT FROM '${sqlLiteral(LEGAL_POLICY_VERSION)}';`,
        "SELECT 'non_minimal_private_profile_count', count(*)::text FROM public.profiles_private",
        'WHERE stripe_customer_id IS NOT NULL OR stripe_customer_account_id IS NOT NULL',
        '  OR stripe_customer_livemode IS NOT NULL OR drive_folder_id IS NOT NULL',
        '  OR drive_folder_url IS NOT NULL OR google_account_email IS NOT NULL',
        '  OR notes IS NOT NULL OR current_level IS NOT NULL;',
        "SELECT 'teacher_madrid_timezone_count', count(*)::text FROM public.profiles",
        "WHERE role::text = 'teacher' AND timezone = 'Europe/Madrid';",
        "SELECT 'admin_profile_id', coalesce(min(id)::text, '') FROM public.profiles WHERE role::text = 'admin';",
        "SELECT 'teacher_profile_id', coalesce(min(id)::text, '') FROM public.profiles WHERE role::text = 'teacher';",
        "SELECT 'package_total_count', count(*)::text FROM public.packages;",
        "SELECT 'canonical_package_count', count(*)::text FROM public.packages",
        "WHERE name IN ('group','standard','hybrid','bootcamp');",
        "SELECT 'canonical_package_clean_count', count(*)::text FROM public.packages",
        "WHERE name IN ('group','standard','hybrid','bootcamp')",
        '  AND stripe_product_id IS NULL AND stripe_price_1m IS NULL',
        '  AND stripe_price_3m IS NULL AND stripe_price_6m IS NULL;',
        "SELECT 'canonical_package_catalog_sha256', encode(extensions.digest(",
        "  convert_to(catalog.canonical_json::text, 'UTF8'), 'sha256'), 'hex')",
        'FROM (SELECT jsonb_agg(jsonb_build_object(',
        "  'name', name, 'display_name', display_name, 'price_monthly', price_monthly,",
        "  'sessions_per_month', sessions_per_month, 'has_group_session', has_group_session,",
        "  'has_dual_teacher', has_dual_teacher, 'is_active', is_active) ORDER BY name) AS canonical_json",
        "  FROM public.packages WHERE name IN ('group','standard','hybrid','bootcamp')) catalog;",
        "SELECT 'package_catalog_version_one_count', count(*)::text FROM public.packages",
        "WHERE name IN ('group','standard','hybrid','bootcamp') AND catalog_version = 1;",
        "SELECT 'noncanonical_package_count', count(*)::text FROM public.packages",
        "WHERE name NOT IN ('group','standard','hybrid','bootcamp') OR name IS NULL;",
        "SELECT 'package_local_stripe_reference_count', count(*)::text FROM public.packages",
        'WHERE stripe_product_id IS NOT NULL OR stripe_price_1m IS NOT NULL',
        '  OR stripe_price_3m IS NOT NULL OR stripe_price_6m IS NOT NULL;',
        "SELECT 'legacy_jobs_absent', (to_regclass('public.jobs') IS NULL)::text;",
        "SELECT 'storage_owned_object_count', count(*)::text FROM storage.objects WHERE owner_id IS NOT NULL;",
        ...zeroTableStatements,
        "SELECT 'availability_total_count', count(*)::text FROM public.teacher_availability;",
        "SELECT 'teacher_availability_count', count(*)::text FROM public.teacher_availability availability",
        "JOIN public.profiles profile ON profile.id = availability.teacher_id WHERE profile.role::text = 'teacher';",
        "SELECT 'availability_target_count', count(*)::text FROM public.teacher_availability availability",
        "JOIN public.profiles profile ON profile.id = availability.teacher_id",
        "WHERE profile.role::text = 'teacher' AND availability.is_active",
        "  AND availability.day_of_week BETWEEN 1 AND 5",
        "  AND availability.start_time = '09:00:00'::time AND availability.end_time = '18:00:00'::time;",
        "SELECT 'availability_target_days', coalesce(string_agg(availability.day_of_week::text, ',' ORDER BY availability.day_of_week), '')",
        "FROM public.teacher_availability availability JOIN public.profiles profile ON profile.id = availability.teacher_id",
        "WHERE profile.role::text = 'teacher';",
        "SELECT 'availability_unexpected_count', count(*)::text FROM public.teacher_availability availability",
        "JOIN public.profiles profile ON profile.id = availability.teacher_id",
        "WHERE profile.role::text <> 'teacher' OR NOT (availability.is_active",
        "  AND availability.day_of_week BETWEEN 1 AND 5",
        "  AND availability.start_time = '09:00:00'::time AND availability.end_time = '18:00:00'::time);",
        'WITH expected(version, name, source_sha256) AS (',
        `    VALUES ${migrationRows}`,
        '), matches AS (',
        '    SELECT expected.version, count(history.version)::integer AS match_count',
        '    FROM expected LEFT JOIN supabase_migrations.schema_migrations history',
        '      ON history.version = expected.version AND history.name = expected.name',
        '     AND cardinality(history.statements) = 1',
        "     AND encode(extensions.digest(convert_to(history.statements[1], 'UTF8'), 'sha256'), 'hex') = expected.source_sha256",
        '    GROUP BY expected.version',
        ')',
        "SELECT 'canonical_migration_counts', ((count(*) FILTER (WHERE match_count = 1))::text || ',' ||",
        "  (count(*) FILTER (WHERE match_count <> 1))::text) FROM matches;",
        "SELECT 'migration_history_total_count', count(*)::text FROM supabase_migrations.schema_migrations;",
        `SELECT 'staging_only_migration_count', count(*)::text FROM supabase_migrations.schema_migrations history WHERE ${stagingOnlyPredicate};`,
        'COMMIT;',
        '',
    ].join('\n')}\n`;
}

export function parseProductionInertFinalReadback(output: string): ProductionInertDatabaseReadback {
    const rawFacts = new Map<string, string>();
    const duplicateKeys = new Set<string>();
    let adminId = '';
    let teacherId = '';

    for (const line of output.split(/\r?\n/u)) {
        const separator = line.indexOf('\t');
        if (separator <= 0) continue;
        const key = line.slice(0, separator).trim();
        const value = line.slice(separator + 1).trim();
        if (key === 'admin_profile_id') {
            adminId = value;
            continue;
        }
        if (key === 'teacher_profile_id') {
            teacherId = value;
            continue;
        }
        if (rawFacts.has(key)) duplicateKeys.add(key);
        rawFacts.set(key, value);
    }

    let preservedSetSha256: string | null = null;
    let preservedRoleBindingSha256: string | null = null;
    try {
        preservedSetSha256 = hashIdentitySet([adminId, teacherId]);
        preservedRoleBindingSha256 = hashRoleBoundIdentitySet(adminId, teacherId);
    } catch {
        preservedSetSha256 = null;
        preservedRoleBindingSha256 = null;
    }

    const facts: Record<string, string> = {};
    for (const key of expectedDatabaseFactKeys()) {
        const value = rawFacts.get(key);
        if (value !== undefined) facts[key] = value;
    }
    return {
        facts,
        preservedSetSha256,
        preservedRoleBindingSha256,
        duplicateKeys: [...duplicateKeys].sort(),
        identityValuesDiscarded: true,
    };
}

export function validateProductionInertFinalReadback(
    readback: ProductionInertDatabaseReadback,
    expectedPreservedSetSha256: string,
    expectedPreservedRoleBindingSha256: string,
): string[] {
    const expected: Record<string, string> = {
        current_database: 'postgres',
        auth_user_count: '2',
        auth_session_count: '0',
        auth_refresh_token_count: '0',
        profile_count: '2',
        profile_private_count: '2',
        profile_role_counts: '1,1,0,0',
        preserved_auth_link_count: '2',
        preserved_auth_profile_email_match_count: '2',
        preserved_expected_role_email_match_count: '2',
        preserved_private_link_count: '2',
        non_minimal_profile_count: '0',
        non_minimal_private_profile_count: '0',
        teacher_madrid_timezone_count: '1',
        package_total_count: '4',
        canonical_package_count: '4',
        canonical_package_clean_count: '4',
        canonical_package_catalog_sha256: FIXTURE_CLEANUP_TARGET.canonicalPackageSha256,
        package_catalog_version_one_count: '4',
        noncanonical_package_count: '0',
        package_local_stripe_reference_count: '0',
        legacy_jobs_absent: 'true',
        storage_owned_object_count: '0',
        availability_total_count: '5',
        teacher_availability_count: '5',
        availability_target_count: '5',
        availability_target_days: '1,2,3,4,5',
        availability_unexpected_count: '0',
        canonical_migration_counts: `${PRODUCTION_ROLLOUT_MIGRATIONS.length},0`,
        migration_history_total_count: String(PRODUCTION_EXPECTED_HISTORY_COUNT),
        staging_only_migration_count: '0',
    };
    for (const table of PRODUCTION_INERT_ZERO_ROW_TABLES) {
        expected[`row_count_public_${table}`] = '0';
    }
    const errors = Object.entries(expected)
        .filter(([key, value]) => readback.facts[key] !== value)
        .map(([key, value]) => `${key}: expected ${value}, observed ${readback.facts[key] ?? '<missing>'}.`);
    if (readback.preservedSetSha256 !== expectedPreservedSetSha256) {
        errors.push('Database preservedSetSha256 does not match the Auth policy receipt.');
    }
    if (readback.preservedRoleBindingSha256 !== expectedPreservedRoleBindingSha256) {
        errors.push('Database preservedRoleBindingSha256 does not match the Auth policy receipt.');
    }
    if (readback.duplicateKeys.length > 0) {
        errors.push(`Database readback contains duplicate facts: ${readback.duplicateKeys.join(', ')}.`);
    }
    if (!readback.identityValuesDiscarded) errors.push('Raw identity values were not discarded.');
    return errors;
}

export function productionInertDatabaseStateSha256(
    readback: ProductionInertDatabaseReadback,
): string {
    return sha256ProductionInertFinal(stableJson({
        facts: readback.facts,
        preservedSetSha256: readback.preservedSetSha256,
        preservedRoleBindingSha256: readback.preservedRoleBindingSha256,
    }));
}

export function createProductionInertFinalReceipt(input: {
    chain: ProductionInertSourceChain;
    firstReadback: ProductionInertDatabaseReadback;
    secondReadback: ProductionInertDatabaseReadback;
    observedAt?: Date;
}): ProductionInertFinalReceipt {
    const observedAt = input.observedAt ?? new Date();
    const preservedSetSha256 = input.chain.authPolicy.value.preservedSetSha256;
    const preservedRoleBindingSha256 = input.chain.authPolicy.value.preservedRoleBindingSha256;
    const firstErrors = validateProductionInertFinalReadback(
        input.firstReadback,
        preservedSetSha256,
        preservedRoleBindingSha256,
    );
    const secondErrors = validateProductionInertFinalReadback(
        input.secondReadback,
        preservedSetSha256,
        preservedRoleBindingSha256,
    );
    if (firstErrors.length > 0 || secondErrors.length > 0) {
        throw new Error(`Database readback validation failed: ${[...firstErrors, ...secondErrors].join(' ')}`);
    }
    const firstState = productionInertDatabaseStateSha256(input.firstReadback);
    const secondState = productionInertDatabaseStateSha256(input.secondReadback);
    if (firstState !== secondState) throw new Error('The two production database readbacks are not stable.');

    const receipt: ProductionInertFinalReceipt = {
        schemaVersion: 1,
        receiptKind: PRODUCTION_INERT_FINAL_RECEIPT_KIND,
        status: PRODUCTION_INERT_FINAL_STATUS,
        targetEnvironment: 'production',
        targetProjectRef: PRODUCTION_PROJECT.ref,
        rolloutReceiptSha256: input.chain.rollout.sha256,
        authPolicyReceiptSha256: input.chain.authPolicy.sha256,
        availabilityReceiptSha256: input.chain.availability.sha256,
        preservedSetSha256,
        preservedRoleBindingSha256,
        canonicalMigrationManifestSha256: canonicalProductionMigrationManifestSha256(),
        databaseFacts: { ...input.firstReadback.facts },
        databaseStateSha256: firstState,
        authFlags: {
            disableSignup: true,
            mailerAutoconfirm: false,
        },
        stableDatabaseReadbacks: PRODUCTION_INERT_FINAL_DATABASE_READBACKS,
        managementApiGetBetweenReadbacks: true,
        externalWritePerformed: false,
        observedAt: observedAt.toISOString(),
        expiresAt: new Date(observedAt.getTime() + PRODUCTION_INERT_FINAL_RECEIPT_MAX_AGE_MS).toISOString(),
    };
    const sensitiveErrors = validateIdentityFreeReceipt(receipt);
    if (sensitiveErrors.length > 0) throw new Error(sensitiveErrors.join(' '));
    return receipt;
}

export function validateProductionInertFinalReceipt(
    raw: unknown,
    now = new Date(),
): string[] {
    const receipt = asRecord(raw);
    if (!receipt) return ['Production inert final receipt must be an object.'];
    const errors: string[] = [];
    requireExactKeys(receipt, [
        'schemaVersion',
        'receiptKind',
        'status',
        'targetEnvironment',
        'targetProjectRef',
        'rolloutReceiptSha256',
        'authPolicyReceiptSha256',
        'availabilityReceiptSha256',
        'preservedSetSha256',
        'preservedRoleBindingSha256',
        'canonicalMigrationManifestSha256',
        'databaseFacts',
        'databaseStateSha256',
        'authFlags',
        'stableDatabaseReadbacks',
        'managementApiGetBetweenReadbacks',
        'externalWritePerformed',
        'observedAt',
        'expiresAt',
    ], 'Production inert final receipt', errors);
    const expected: Record<string, unknown> = {
        schemaVersion: 1,
        receiptKind: PRODUCTION_INERT_FINAL_RECEIPT_KIND,
        status: PRODUCTION_INERT_FINAL_STATUS,
        targetEnvironment: 'production',
        targetProjectRef: PRODUCTION_PROJECT.ref,
        canonicalMigrationManifestSha256: canonicalProductionMigrationManifestSha256(),
        stableDatabaseReadbacks: PRODUCTION_INERT_FINAL_DATABASE_READBACKS,
        managementApiGetBetweenReadbacks: true,
        externalWritePerformed: false,
    };
    for (const [key, value] of Object.entries(expected)) {
        if (receipt[key] !== value) errors.push(`${key} must equal ${String(value)}.`);
    }
    for (const key of [
        'rolloutReceiptSha256',
        'authPolicyReceiptSha256',
        'availabilityReceiptSha256',
        'preservedSetSha256',
        'preservedRoleBindingSha256',
        'databaseStateSha256',
    ]) {
        if (!isSha256(receipt[key])) errors.push(`${key} must be a lowercase SHA-256.`);
    }
    const authFlags = asRecord(receipt.authFlags);
    if (!authFlags
        || !sameKeys(authFlags, ['disableSignup', 'mailerAutoconfirm'])
        || authFlags.disableSignup !== true
        || authFlags.mailerAutoconfirm !== false) {
        errors.push('authFlags must be exactly disableSignup=true and mailerAutoconfirm=false.');
    }
    const databaseFacts = asRecord(receipt.databaseFacts);
    if (!databaseFacts
        || !sameKeys(databaseFacts, expectedDatabaseFactKeys())
        || Object.values(databaseFacts).some((value) => typeof value !== 'string')) {
        errors.push('databaseFacts must contain exactly the sanitized final readback facts.');
    } else if (isSha256(receipt.preservedSetSha256)
        && isSha256(receipt.preservedRoleBindingSha256)) {
        const sanitizedReadback: ProductionInertDatabaseReadback = {
            facts: databaseFacts as Record<string, string>,
            preservedSetSha256: receipt.preservedSetSha256,
            preservedRoleBindingSha256: receipt.preservedRoleBindingSha256,
            duplicateKeys: [],
            identityValuesDiscarded: true,
        };
        errors.push(...validateProductionInertFinalReadback(
            sanitizedReadback,
            receipt.preservedSetSha256,
            receipt.preservedRoleBindingSha256,
        ).map((error) => `databaseFacts: ${error}`));
        const expectedStateSha256 = productionInertDatabaseStateSha256(sanitizedReadback);
        if (receipt.databaseStateSha256 !== expectedStateSha256) {
            errors.push('databaseStateSha256 does not match the sanitized databaseFacts.');
        }
    }

    const observedAt = parseTimestamp(receipt.observedAt);
    const expiresAt = parseTimestamp(receipt.expiresAt);
    if (observedAt === null) {
        errors.push('observedAt must be an ISO timestamp.');
    } else {
        const age = now.getTime() - observedAt;
        if (age < 0) errors.push('observedAt cannot be in the future.');
        if (age > PRODUCTION_INERT_FINAL_RECEIPT_MAX_AGE_MS) {
            errors.push('Production inert final receipt is older than 15 minutes.');
        }
    }
    if (expiresAt === null) {
        errors.push('expiresAt must be an ISO timestamp.');
    } else if (observedAt !== null) {
        const lifetime = expiresAt - observedAt;
        if (lifetime <= 0 || lifetime > PRODUCTION_INERT_FINAL_RECEIPT_MAX_AGE_MS) {
            errors.push('Production inert final receipt lifetime must be at most 15 minutes.');
        }
        if (now.getTime() > expiresAt) errors.push('Production inert final receipt has expired.');
    }
    errors.push(...validateIdentityFreeReceipt(receipt));
    return errors;
}

export function createProductionInertFinalAttemptSummary(input: {
    status: ProductionInertFinalAttemptStatus;
    startedAt: Date;
    finishedAt?: Date;
    receipt?: ProductionInertFinalReceipt;
    failureCategory?: string;
}): ProductionInertFinalAttemptSummary {
    const receipt = input.receipt;
    const summary: ProductionInertFinalAttemptSummary = {
        schemaVersion: 1,
        mode: 'capture-readonly',
        status: input.status,
        targetEnvironment: 'production',
        targetProjectRef: PRODUCTION_PROJECT.ref,
        startedAt: input.startedAt.toISOString(),
        finishedAt: input.finishedAt?.toISOString() ?? null,
        receiptSha256: receipt ? sha256ProductionInertFinal(stableJson(receipt)) : null,
        receiptFile: receipt ? PRODUCTION_INERT_FINAL_OUTPUT_FILE : null,
        receiptObservedAt: receipt?.observedAt ?? null,
        receiptExpiresAt: receipt?.expiresAt ?? null,
        failureCategory: input.failureCategory ?? null,
        externalWritePerformed: false,
    };
    const errors = validateProductionInertFinalAttemptSummary(summary, input.finishedAt ?? input.startedAt);
    if (errors.length > 0) throw new Error(`Final capture summary is invalid: ${errors.join(' ')}`);
    return summary;
}

export function validateProductionInertFinalAttemptSummary(
    raw: unknown,
    now = new Date(),
): string[] {
    const summary = asRecord(raw);
    if (!summary) return ['Production inert final capture summary must be an object.'];
    const errors: string[] = [];
    requireExactKeys(summary, [
        'schemaVersion',
        'mode',
        'status',
        'targetEnvironment',
        'targetProjectRef',
        'startedAt',
        'finishedAt',
        'receiptSha256',
        'receiptFile',
        'receiptObservedAt',
        'receiptExpiresAt',
        'failureCategory',
        'externalWritePerformed',
    ], 'Production inert final capture summary', errors);
    if (summary.schemaVersion !== 1) errors.push('Capture summary schemaVersion must equal 1.');
    if (summary.mode !== 'capture-readonly') errors.push('Capture summary mode must be capture-readonly.');
    if (summary.targetEnvironment !== 'production') errors.push('Capture summary targetEnvironment must be production.');
    if (summary.targetProjectRef !== PRODUCTION_PROJECT.ref) errors.push('Capture summary targetProjectRef mismatch.');
    if (summary.externalWritePerformed !== false) errors.push('Capture summary externalWritePerformed must be false.');
    const startedAt = parseTimestamp(summary.startedAt);
    const finishedAt = summary.finishedAt === null ? null : parseTimestamp(summary.finishedAt);
    if (startedAt === null) errors.push('Capture summary startedAt must be an ISO timestamp.');
    else if (startedAt > now.getTime()) errors.push('Capture summary startedAt cannot be in the future.');
    if (summary.finishedAt !== null && finishedAt === null) {
        errors.push('Capture summary finishedAt must be null or an ISO timestamp.');
    }
    if (startedAt !== null && finishedAt !== null && finishedAt < startedAt) {
        errors.push('Capture summary finishedAt cannot predate startedAt.');
    }

    if (summary.status === 'CAPTURE_IN_PROGRESS') {
        if (summary.finishedAt !== null
            || summary.receiptSha256 !== null
            || summary.receiptFile !== null
            || summary.receiptObservedAt !== null
            || summary.receiptExpiresAt !== null
            || summary.failureCategory !== null) {
            errors.push('In-progress capture summary must not contain completion, receipt or failure fields.');
        }
    } else if (summary.status === 'CAPTURE_FAILED') {
        if (finishedAt === null) errors.push('Failed capture summary requires finishedAt.');
        if (summary.receiptSha256 !== null
            || summary.receiptFile !== null
            || summary.receiptObservedAt !== null
            || summary.receiptExpiresAt !== null) {
            errors.push('Failed capture summary must not bind a receipt.');
        }
        if (typeof summary.failureCategory !== 'string'
            || !/^[A-Z][A-Z0-9_]{2,79}$/u.test(summary.failureCategory)) {
            errors.push('Failed capture summary requires a safe uppercase failureCategory.');
        }
    } else if (summary.status === PRODUCTION_INERT_FINAL_STATUS) {
        if (finishedAt === null) errors.push('Successful capture summary requires finishedAt.');
        if (!isSha256(summary.receiptSha256)) errors.push('Successful capture summary requires receiptSha256.');
        if (summary.receiptFile !== PRODUCTION_INERT_FINAL_OUTPUT_FILE) {
            errors.push(`Successful capture summary receiptFile must be ${PRODUCTION_INERT_FINAL_OUTPUT_FILE}.`);
        }
        if (parseTimestamp(summary.receiptObservedAt) === null) {
            errors.push('Successful capture summary requires receiptObservedAt.');
        }
        if (parseTimestamp(summary.receiptExpiresAt) === null) {
            errors.push('Successful capture summary requires receiptExpiresAt.');
        }
        if (summary.failureCategory !== null) errors.push('Successful capture summary failureCategory must be null.');
    } else {
        errors.push('Capture summary status is unsupported.');
    }
    errors.push(...validateIdentityFreeReceipt(summary));
    return errors;
}

export function validateIdentityFreeReceipt(raw: unknown): string[] {
    const serialized = JSON.stringify(raw);
    const errors: string[] = [];
    if (UUID_PATTERN.test(serialized)) errors.push('Receipt must not contain identity UUIDs.');
    if (EMAIL_PATTERN.test(serialized)) errors.push('Receipt must not contain email addresses.');
    if (URL_PATTERN.test(serialized)) errors.push('Receipt must not contain URLs.');
    if (SECRET_PATTERN.test(serialized)) errors.push('Receipt must not contain secret material.');
    return errors;
}

export function sha256ProductionInertFinal(value: string | Buffer): string {
    return createHash('sha256').update(value).digest('hex');
}

function expectedDatabaseFactKeys(): readonly string[] {
    return [
        'current_database',
        'auth_user_count',
        'auth_session_count',
        'auth_refresh_token_count',
        'profile_count',
        'profile_private_count',
        'profile_role_counts',
        'preserved_auth_link_count',
        'preserved_auth_profile_email_match_count',
        'preserved_expected_role_email_match_count',
        'preserved_private_link_count',
        'non_minimal_profile_count',
        'non_minimal_private_profile_count',
        'teacher_madrid_timezone_count',
        'package_total_count',
        'canonical_package_count',
        'canonical_package_clean_count',
        'canonical_package_catalog_sha256',
        'package_catalog_version_one_count',
        'noncanonical_package_count',
        'package_local_stripe_reference_count',
        'legacy_jobs_absent',
        'storage_owned_object_count',
        ...PRODUCTION_INERT_ZERO_ROW_TABLES.map((table) => `row_count_public_${table}`),
        'availability_total_count',
        'teacher_availability_count',
        'availability_target_count',
        'availability_target_days',
        'availability_unexpected_count',
        'canonical_migration_counts',
        'migration_history_total_count',
        'staging_only_migration_count',
    ];
}

function sameAvailabilitySchedule(value: unknown): boolean {
    if (!Array.isArray(value) || value.length !== PRODUCTION_AVAILABILITY_SLOTS.length) return false;
    return value.every((slot, index) => {
        const record = asRecord(slot);
        const expected = PRODUCTION_AVAILABILITY_SLOTS[index];
        return record
            && sameKeys(record, ['dayOfWeek', 'startTime', 'endTime'])
            && record.dayOfWeek === expected.dayOfWeek
            && record.startTime === expected.startTime
            && record.endTime === expected.endTime;
    });
}

function validatePastTimestamp(value: unknown, label: string, now: Date, errors: string[]): void {
    const timestamp = parseTimestamp(value);
    if (timestamp === null) errors.push(`${label} must be an ISO timestamp.`);
    else if (timestamp > now.getTime()) errors.push(`${label} cannot be in the future.`);
}

function parseTimestamp(value: unknown): number | null {
    if (typeof value !== 'string') return null;
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) ? timestamp : null;
}

function isSha256(value: unknown): value is string {
    return typeof value === 'string' && SHA256_PATTERN.test(value);
}

function sameStringArray(value: unknown, expected: readonly string[]): boolean {
    return Array.isArray(value)
        && value.length === expected.length
        && value.every((entry, index) => entry === expected[index]);
}

function requireExactKeys(
    value: Record<string, unknown>,
    expected: readonly string[],
    label: string,
    errors: string[],
): void {
    if (!sameKeys(value, expected)) errors.push(`${label} keys do not match the exact schema.`);
}

function sameKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
    const actual = Object.keys(value).sort();
    return actual.length === expected.length
        && actual.every((key, index) => key === [...expected].sort()[index]);
}

function sqlLiteral(value: string): string {
    return value.replace(/'/gu, "''");
}

function asRecord(value: unknown): Record<string, unknown> | null {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null;
}
