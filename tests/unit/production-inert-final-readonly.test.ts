import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
    canonicalProductionMigrationManifestSha256,
    createProductionInertFinalAttemptSummary,
    createProductionInertFinalReceipt,
    parseProductionInertFinalArgs,
    parseProductionInertFinalReadback,
    PRODUCTION_INERT_FINAL_RECEIPT_MAX_AGE_MS,
    PRODUCTION_EXPECTED_HISTORY_COUNT,
    PRODUCTION_INERT_ZERO_ROW_TABLES,
    productionInertDatabaseStateSha256,
    renderProductionInertFinalReadbackSql,
    validateIdentityFreeReceipt,
    validateProductionInertFinalDatabaseUrl,
    validateProductionInertFinalReadback,
    validateProductionInertFinalAttemptSummary,
    validateProductionInertFinalReceipt,
    validateProductionInertSourceChain,
    type ProductionInertSourceChain,
} from '../../scripts/launch/production-inert-final-readonly-shared';
import {
    FIXTURE_CLEANUP_TARGET,
    stableJson,
} from '../../scripts/launch/production-fixture-cleanup-shared';
import {
    hashIdentitySet,
    hashRoleBoundIdentitySet,
} from '../../scripts/launch/supabase-production-auth-cleanup-shared';
import {
    PRODUCTION_ROLLOUT_MIGRATIONS,
    productionRolloutAllowlistSha256,
} from '../../scripts/launch/supabase-production-rollout-runner-shared';
import { STAGING_ONLY_VERSIONS } from '../../scripts/launch/supabase-production-rollout-shared';

const now = new Date('2026-07-16T14:00:00.000Z');
const rolloutSha256 = 'a'.repeat(64);
const authPolicySha256 = 'b'.repeat(64);
const availabilitySha256 = 'c'.repeat(64);
const preservationPolicySha256 = 'd'.repeat(64);
const adminId = '11111111-1111-4111-8111-111111111111';
const teacherId = '22222222-2222-4222-8222-222222222222';
const preservedSetSha256 = hashIdentitySet([adminId, teacherId]);
const preservedRoleBindingSha256 = hashRoleBoundIdentitySet(adminId, teacherId);

function sourceChain(): ProductionInertSourceChain {
    return {
        rollout: {
            sha256: rolloutSha256,
            value: {
                schemaVersion: 1,
                status: 'PRODUCTION_ROLLOUT_ALL_WAVES_APPLIED_AND_VERIFIED',
                targetProjectRef: 'vkkahxsybhbutszerawz',
                completedAt: '2026-07-16T10:00:00.000Z',
                through: 'deferred_rc_hardening',
                migrationCount: 25,
                migrationManifestSha256: canonicalProductionMigrationManifestSha256(),
                allowlistSha256: productionRolloutAllowlistSha256(),
                preservationPolicySha256,
                publicCleanupReceiptSha256: 'e'.repeat(64),
                backupReceiptSha256: 'f'.repeat(64),
                authReducedQuarantinedReceiptSha256: '1'.repeat(64),
                finalVerificationPassed: true,
                stagingOnlyMigrationAbsent: true,
                stagingOnlyVersions: [...STAGING_ONLY_VERSIONS],
                checkoutRemainedDisabledByOperatorAttestation: true,
                authFinalizeRequired: true,
            },
        },
        authPolicy: {
            sha256: authPolicySha256,
            value: {
                schemaVersion: 1,
                targetProjectRef: 'vkkahxsybhbutszerawz',
                status: 'CLOSED_AND_VERIFIED',
                closedAt: '2026-07-16T12:00:00.000Z',
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
                backupReceiptSha256: 'f'.repeat(64),
                publicCleanupReceiptSha256: 'e'.repeat(64),
                authReducedReceiptSha256: '1'.repeat(64),
                productionRolloutReceiptSha256: rolloutSha256,
                preservedSetSha256,
                preservedRoleBindingSha256,
                freezeCutoff: '2026-07-02T18:29:27.580Z',
                quarantineUntil: '2026-07-16T11:00:00.000Z',
                googleDriveFixtureFolders: 'UNTOUCHED_110_OBSERVED',
            },
        },
        availability: {
            sha256: availabilitySha256,
            value: {
                schemaVersion: 1,
                status: 'SEEDED_AND_VERIFIED',
                targetProjectRef: 'vkkahxsybhbutszerawz',
                authPolicyReceiptSha256: authPolicySha256,
                schedule: [1, 2, 3, 4, 5].map((dayOfWeek) => ({
                    dayOfWeek,
                    startTime: '09:00:00',
                    endTime: '18:00:00',
                })),
                timezone: 'Europe/Madrid',
                authUsersRemaining: 2,
                authSessionsRemaining: 0,
                authRefreshTokensRemaining: 0,
                rolloutMigrationsVerified: 25,
                externalProvidersTouched: false,
                verifiedAt: '2026-07-16T13:00:00.000Z',
            },
        },
    } as ProductionInertSourceChain;
}

function readbackOutput(overrides: Record<string, string> = {}): string {
    const facts: Record<string, string> = {
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
        canonical_migration_counts: '25,0',
        migration_history_total_count: String(PRODUCTION_EXPECTED_HISTORY_COUNT),
        staging_only_migration_count: '0',
        ...Object.fromEntries(PRODUCTION_INERT_ZERO_ROW_TABLES.map((table) => [
            `row_count_public_${table}`,
            '0',
        ])),
        ...overrides,
    };
    return [
        ...Object.entries(facts).map(([key, value]) => `${key}\t${value}`),
        `admin_profile_id\t${adminId}`,
        `teacher_profile_id\t${teacherId}`,
        '',
    ].join('\n');
}

describe('production inert final read-only runner', () => {
    it('defaults to a no-network plan and requires three explicit receipt paths for capture', () => {
        expect(parseProductionInertFinalArgs([])).toEqual({
            mode: 'plan',
            rolloutReceiptPath: null,
            authPolicyReceiptPath: null,
            availabilityReceiptPath: null,
        });
        const args = parseProductionInertFinalArgs([
            '--capture-readonly',
            '--rollout-receipt', 'rollout.json',
            '--auth-policy-receipt', 'auth.json',
            '--availability-receipt', 'availability.json',
        ]);
        expect(args).toMatchObject({
            mode: 'capture-readonly',
            rolloutReceiptPath: 'rollout.json',
            authPolicyReceiptPath: 'auth.json',
            availabilityReceiptPath: 'availability.json',
        });
        expect(() => parseProductionInertFinalArgs(['--capture-readonly']))
            .toThrow('--rollout-receipt is required');
        expect(() => parseProductionInertFinalArgs(['--rollout-receipt', 'rollout.json']))
            .toThrow('only with --capture-readonly');
        expect(() => parseProductionInertFinalArgs(['--capture-readonly', '--capture-readonly']))
            .toThrow('Duplicate argument');
        expect(() => parseProductionInertFinalArgs(['--execute']))
            .toThrow('Unsupported argument');
    });

    it('rejects staging and accepts only the exact production Supabase database target', () => {
        expect(() => validateProductionInertFinalDatabaseUrl(
            databaseUrl('mzjyvmlxfpzdfdjzxxyj'),
        )).toThrow('Production database target rejected');
        expect(() => validateProductionInertFinalDatabaseUrl(
            databaseUrl('vkkahxsybhbutszerawz'),
        )).not.toThrow();
        expect(() => validateProductionInertFinalDatabaseUrl(
            databaseUrl('vkkahxsybhbutszerawz', 'another_database'),
        )).toThrow('Production database target rejected');
    });

    it('binds the exact rollout, Auth policy and availability chain to production', () => {
        const chain = sourceChain();
        expect(validateProductionInertSourceChain(chain, now)).toEqual([]);

        const wrongRolloutLink = sourceChain();
        wrongRolloutLink.authPolicy.value.productionRolloutReceiptSha256 = '9'.repeat(64);
        expect(validateProductionInertSourceChain(wrongRolloutLink, now))
            .toContain('Auth policy is not linked to the supplied production rollout receipt SHA-256.');

        const wrongAvailabilityLink = sourceChain();
        (wrongAvailabilityLink.availability.value as Record<string, unknown>).authPolicyReceiptSha256 = '8'.repeat(64);
        expect(validateProductionInertSourceChain(wrongAvailabilityLink, now))
            .toContain(`Production availability authPolicyReceiptSha256 must equal ${authPolicySha256}.`);

        const wrongMigrationManifest = sourceChain();
        (wrongMigrationManifest.rollout.value as Record<string, unknown>).migrationManifestSha256 = '7'.repeat(64);
        expect(validateProductionInertSourceChain(wrongMigrationManifest, now))
            .toContain(`Production rollout migrationManifestSha256 must equal ${canonicalProductionMigrationManifestSha256()}.`);

        const wrongSchedule = sourceChain();
        const schedule = (wrongSchedule.availability.value as { schedule: Array<Record<string, unknown>> }).schedule;
        schedule[4] = { ...schedule[4], endTime: '17:00:00' };
        expect(validateProductionInertSourceChain(wrongSchedule, now))
            .toContain('Production availability schedule must be exactly Monday-Friday 09:00-18:00.');

        for (const [authKey, expectedError] of [
            ['backupReceiptSha256', 'Auth policy backup receipt SHA-256 does not match the production rollout.'],
            ['publicCleanupReceiptSha256', 'Auth policy public-cleanup receipt SHA-256 does not match the production rollout.'],
            ['authReducedReceiptSha256', 'Auth policy Auth-reduced receipt SHA-256 does not match the production rollout.'],
        ] as const) {
            const broken = sourceChain();
            broken.authPolicy.value[authKey] = '9'.repeat(64);
            expect(validateProductionInertSourceChain(broken, now)).toContain(expectedError);
        }
    });

    it('renders two-layer read-only database protection and verifies all 25 canonical migrations', () => {
        const sql = renderProductionInertFinalReadbackSql();
        expect(PRODUCTION_ROLLOUT_MIGRATIONS).toHaveLength(25);
        expect(sql).toContain('BEGIN READ ONLY;');
        expect(sql).toContain('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ;');
        expect(sql).toContain('canonical_migration_counts');
        expect(sql).toContain('extensions.digest');
        expect(sql).toContain('availability_target_days');
        expect(sql).toContain('storage_owned_object_count');
        expect(sql).toContain('non_minimal_private_profile_count');
        expect(sql).toContain('canonical_package_clean_count');
        expect(sql).toContain('canonical_package_catalog_sha256');
        expect(sql).toContain('package_catalog_version_one_count');
        expect(sql).toContain('migration_history_total_count');
        for (const table of PRODUCTION_INERT_ZERO_ROW_TABLES) {
            expect(sql).toContain(`row_count_public_${table}`);
        }
        for (const migration of PRODUCTION_ROLLOUT_MIGRATIONS) {
            expect(sql).toContain(migration.version);
            expect(sql).toContain(migration.sha256);
        }
        expect(sql).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|ALTER|DROP|CREATE|PATCH|PUT)\b/iu);
    });

    it('discards both raw identity UUIDs and validates the exact inert database aggregate', () => {
        const readback = parseProductionInertFinalReadback(readbackOutput());
        expect(readback.preservedSetSha256).toBe(preservedSetSha256);
        expect(readback.preservedRoleBindingSha256).toBe(preservedRoleBindingSha256);
        expect(readback.identityValuesDiscarded).toBe(true);
        expect(validateProductionInertFinalReadback(
            readback,
            preservedSetSha256,
            preservedRoleBindingSha256,
        )).toEqual([]);
        expect(JSON.stringify(readback)).not.toContain(adminId);
        expect(JSON.stringify(readback)).not.toContain(teacherId);

        for (const [key, observed] of [
            ['auth_user_count', '3'],
            ['auth_session_count', '1'],
            ['auth_refresh_token_count', '1'],
            ['profile_count', '3'],
            ['profile_private_count', '1'],
            ['profile_role_counts', '1,1,1,0'],
            ['preserved_auth_profile_email_match_count', '1'],
            ['preserved_expected_role_email_match_count', '1'],
            ['non_minimal_profile_count', '1'],
            ['non_minimal_private_profile_count', '1'],
            ['teacher_madrid_timezone_count', '0'],
            ['package_total_count', '5'],
            ['canonical_package_clean_count', '3'],
            ['canonical_package_catalog_sha256', '0'.repeat(64)],
            ['package_catalog_version_one_count', '3'],
            ['package_local_stripe_reference_count', '1'],
            ['legacy_jobs_absent', 'false'],
            ['storage_owned_object_count', '1'],
            ['row_count_public_payments', '1'],
            ['row_count_public_crm_contacts', '1'],
            ['row_count_public_checkout_intents', '1'],
            ['availability_total_count', '4'],
            ['availability_target_days', '1,2,3,4'],
            ['canonical_migration_counts', '24,1'],
            ['migration_history_total_count', String(PRODUCTION_EXPECTED_HISTORY_COUNT + 1)],
            ['staging_only_migration_count', '1'],
        ]) {
            const drift = parseProductionInertFinalReadback(readbackOutput({ [key]: observed }));
            expect(validateProductionInertFinalReadback(
                drift,
                preservedSetSha256,
                preservedRoleBindingSha256,
            ).length).toBeGreaterThan(0);
        }

        const swapped = parseProductionInertFinalReadback(readbackOutput()
            .replace(`admin_profile_id\t${adminId}`, `admin_profile_id\t${teacherId}`)
            .replace(`teacher_profile_id\t${teacherId}`, `teacher_profile_id\t${adminId}`));
        expect(swapped.preservedSetSha256).toBe(preservedSetSha256);
        expect(swapped.preservedRoleBindingSha256).not.toBe(preservedRoleBindingSha256);
        expect(validateProductionInertFinalReadback(
            swapped,
            preservedSetSha256,
            preservedRoleBindingSha256,
        )).toContain('Database preservedRoleBindingSha256 does not match the Auth policy receipt.');
    });

    it('requires two identical database states and emits a 15-minute identity-free GET-only receipt', () => {
        const firstReadback = parseProductionInertFinalReadback(readbackOutput());
        const secondReadback = parseProductionInertFinalReadback(readbackOutput());
        expect(productionInertDatabaseStateSha256(firstReadback))
            .toBe(productionInertDatabaseStateSha256(secondReadback));
        const receipt = createProductionInertFinalReceipt({
            chain: sourceChain(),
            firstReadback,
            secondReadback,
            observedAt: now,
        });
        expect(receipt).toMatchObject({
            receiptKind: 'production_inert_final_readonly',
            status: 'PRODUCTION_INERT_FINAL_READONLY_VERIFIED',
            targetEnvironment: 'production',
            targetProjectRef: 'vkkahxsybhbutszerawz',
            rolloutReceiptSha256: rolloutSha256,
            authPolicyReceiptSha256: authPolicySha256,
            availabilityReceiptSha256: availabilitySha256,
            preservedSetSha256,
            preservedRoleBindingSha256,
            stableDatabaseReadbacks: 2,
            managementApiGetBetweenReadbacks: true,
            externalWritePerformed: false,
        });
        expect(validateProductionInertFinalReceipt(receipt, now)).toEqual([]);
        expect(validateProductionInertFinalReceipt(
            receipt,
            new Date(now.getTime() + PRODUCTION_INERT_FINAL_RECEIPT_MAX_AGE_MS),
        )).toEqual([]);
        expect(validateProductionInertFinalReceipt(
            receipt,
            new Date(now.getTime() + PRODUCTION_INERT_FINAL_RECEIPT_MAX_AGE_MS + 1),
        ).length).toBeGreaterThan(0);
        expect(validateIdentityFreeReceipt(receipt)).toEqual([]);
        expect(validateIdentityFreeReceipt({ ...receipt, email: 'person@example.com' })).not.toEqual([]);
        expect(validateIdentityFreeReceipt({ ...receipt, url: 'https://example.com' })).not.toEqual([]);
        expect(validateIdentityFreeReceipt({ ...receipt, identity: adminId })).not.toEqual([]);
        expect(validateProductionInertFinalReceipt({
            ...receipt,
            databaseFacts: { ...receipt.databaseFacts, row_count_public_payments: '1' },
        }, now)).toContain('databaseFacts: row_count_public_payments: expected 0, observed 1.');
        expect(validateProductionInertFinalReceipt({
            ...receipt,
            databaseStateSha256: '0'.repeat(64),
        }, now)).toContain('databaseStateSha256 does not match the sanitized databaseFacts.');
    });

    it('does not allow an unstable second readback to produce a receipt', () => {
        const firstReadback = parseProductionInertFinalReadback(readbackOutput());
        const secondReadback = parseProductionInertFinalReadback(readbackOutput({ availability_total_count: '4' }));
        expect(() => createProductionInertFinalReceipt({
            chain: sourceChain(),
            firstReadback,
            secondReadback,
            observedAt: now,
        })).toThrow('Database readback validation failed');
    });

    it('emits exact fail-closed capture summaries for in-progress, failed and successful attempts', () => {
        const inProgress = createProductionInertFinalAttemptSummary({
            status: 'CAPTURE_IN_PROGRESS',
            startedAt: now,
        });
        expect(validateProductionInertFinalAttemptSummary(inProgress, now)).toEqual([]);
        expect(inProgress.receiptSha256).toBeNull();

        const failed = createProductionInertFinalAttemptSummary({
            status: 'CAPTURE_FAILED',
            startedAt: now,
            finishedAt: new Date(now.getTime() + 1_000),
            failureCategory: 'DATABASE_READBACK_FAILED',
        });
        expect(validateProductionInertFinalAttemptSummary(
            failed,
            new Date(now.getTime() + 1_000),
        )).toEqual([]);
        expect(validateProductionInertFinalAttemptSummary({
            ...failed,
            failureCategory: 'unsafe detail',
        }, new Date(now.getTime() + 1_000))).toContain(
            'Failed capture summary requires a safe uppercase failureCategory.',
        );

        const readback = parseProductionInertFinalReadback(readbackOutput());
        const receipt = createProductionInertFinalReceipt({
            chain: sourceChain(),
            firstReadback: readback,
            secondReadback: readback,
            observedAt: now,
        });
        const success = createProductionInertFinalAttemptSummary({
            status: receipt.status,
            startedAt: new Date(now.getTime() - 1_000),
            finishedAt: new Date(now.getTime() + 1_000),
            receipt,
        });
        expect(validateProductionInertFinalAttemptSummary(
            success,
            new Date(now.getTime() + 1_000),
        )).toEqual([]);
        expect(success.receiptSha256).toMatch(/^[a-f0-9]{64}$/u);
    });

    it('keeps the runtime sequence GET/read-only and exposes the pnpm launch script', () => {
        const runner = readFileSync('scripts/launch/production-inert-final-readonly.ts', 'utf8');
        const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
            scripts: Record<string, string>;
        };
        const firstRead = runner.indexOf('const firstReadback = runDatabaseReadback');
        const managementGet = runner.indexOf('await verifyLiveProductionAuthInert');
        const secondRead = runner.indexOf('const secondReadback = runDatabaseReadback');
        expect(firstRead).toBeGreaterThan(-1);
        expect(managementGet).toBeGreaterThan(firstRead);
        expect(secondRead).toBeGreaterThan(managementGet);
        expect(runner).not.toContain("method: 'PATCH'");
        expect(runner).not.toContain("method: 'PUT'");
        expect(runner).toContain('default_transaction_read_only=on');
        expect(runner).toContain('expected_admin_email=');
        expect(runner).toContain('expected_teacher_email=');
        expect(runner).toContain("status: 'CAPTURE_IN_PROGRESS'");
        expect(runner).toContain("status: 'CAPTURE_FAILED'");
        expect(packageJson.scripts['launch:production-inert-final-readonly'])
            .toBe('tsx scripts/launch/production-inert-final-readonly.ts');
        expect(canonicalProductionMigrationManifestSha256())
            .toMatch(/^[a-f0-9]{64}$/u);
        expect(stableJson({ ok: true })).toBe('{\n  "ok": true\n}\n');
    });
});

function databaseUrl(projectRef: string, database = 'postgres'): string {
    const url = new URL(`postgresql://db.${projectRef}.supabase.co:5432/${database}`);
    url.username = 'postgres';
    url.password = 'unit-test-credential';
    return url.toString();
}
