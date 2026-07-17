import {
    closeSync,
    fsyncSync,
    mkdirSync,
    mkdtempSync,
    openSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
    POST_CLOSURE_BACKUP_APPROVAL_ENV,
    POST_CLOSURE_BACKUP_RECEIPT_KIND,
    POST_CLOSURE_BACKUP_STATUS,
    POST_CLOSURE_MINIMUM_EVIDENCE_TTL_MS,
    POST_CLOSURE_PUBLIC_TABLES,
    POST_CLOSURE_TABLE_CONTRACT_SHA256,
    assertReservedArtifactFingerprint,
    assertProductionInertRowStateMatchesEvidence,
    buildPostClosureBackupApproval,
    compareArchiveToLiveInventory,
    createPostClosureBackupReceipt,
    createPostClosureArtifactFailureSummary,
    captureReservedArtifactFingerprint,
    loadProductionInertFinalEvidence,
    parseArchivePublicAuthTableData,
    parseLiveTableInventory,
    parsePostClosureBackupArgs,
    prepareReservedArtifactForEncryptedDump,
    redactExpectedProductionEmails,
    sha256PinnedReservedArtifact,
    validateLivePostClosureInventory,
    validatePostClosureBackupReceipt,
} from '../../scripts/launch/supabase-production-post-closure-backup';
import {
    FIXTURE_CLEANUP_TARGET,
    stableJson,
} from '../../scripts/launch/production-fixture-cleanup-shared';
import {
    canonicalProductionMigrationManifestSha256,
    createProductionInertFinalAttemptSummary,
    parseProductionInertFinalReadback,
    PRODUCTION_EXPECTED_HISTORY_COUNT,
    PRODUCTION_INERT_FINAL_STATUS,
    PRODUCTION_INERT_ZERO_ROW_TABLES,
    productionInertDatabaseStateSha256,
    type ProductionInertDatabaseReadback,
    type ProductionInertFinalReceipt,
} from '../../scripts/launch/production-inert-final-readonly-shared';
import {
    hashIdentitySet,
    hashRoleBoundIdentitySet,
} from '../../scripts/launch/supabase-production-auth-cleanup-shared';

const runnerSource = readFileSync(
    'scripts/launch/supabase-production-post-closure-backup.ts',
    'utf8',
);
const canonicalSha = 'a'.repeat(40);
const hashA = 'a'.repeat(64);
const hashB = 'b'.repeat(64);
const hashC = 'c'.repeat(64);
const adminId = '11111111-1111-4111-8111-111111111111';
const teacherId = '22222222-2222-4222-8222-222222222222';
const preservedSetSha256 = hashIdentitySet([adminId, teacherId]);
const preservedRoleBindingSha256 = hashRoleBoundIdentitySet(adminId, teacherId);

function validReadback(overrides: Record<string, string> = {}): ProductionInertDatabaseReadback {
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
    return parseProductionInertFinalReadback([
        ...Object.entries(facts).map(([key, value]) => `${key}\t${value}`),
        `admin_profile_id\t${adminId}`,
        `teacher_profile_id\t${teacherId}`,
        '',
    ].join('\n'));
}

function validFinalReceipt(observedAt: Date): ProductionInertFinalReceipt {
    const readback = validReadback();
    return {
        schemaVersion: 1,
        receiptKind: 'production_inert_final_readonly',
        status: PRODUCTION_INERT_FINAL_STATUS,
        targetEnvironment: 'production',
        targetProjectRef: FIXTURE_CLEANUP_TARGET.projectRef,
        rolloutReceiptSha256: '1'.repeat(64),
        authPolicyReceiptSha256: '2'.repeat(64),
        availabilityReceiptSha256: '3'.repeat(64),
        preservedSetSha256,
        preservedRoleBindingSha256,
        canonicalMigrationManifestSha256: canonicalProductionMigrationManifestSha256(),
        databaseFacts: { ...readback.facts },
        databaseStateSha256: productionInertDatabaseStateSha256(readback),
        authFlags: { disableSignup: true, mailerAutoconfirm: false },
        stableDatabaseReadbacks: 2,
        managementApiGetBetweenReadbacks: true,
        externalWritePerformed: false,
        observedAt: observedAt.toISOString(),
        expiresAt: new Date(observedAt.getTime() + 15 * 60 * 1_000).toISOString(),
    };
}

function attemptDirectoryName(startedAt: Date): string {
    return startedAt.toISOString().replace(/[:.]/gu, '-');
}

function writeSuccessfulAttempt(
    attemptsRoot: string,
    startedAt: Date,
    receipt: ProductionInertFinalReceipt,
): string {
    const directory = path.join(attemptsRoot, attemptDirectoryName(startedAt));
    mkdirSync(directory, { recursive: true });
    const finishedAt = new Date(Date.parse(receipt.observedAt) + 1);
    const summary = createProductionInertFinalAttemptSummary({
        status: PRODUCTION_INERT_FINAL_STATUS,
        startedAt,
        finishedAt,
        receipt,
    });
    const receiptPath = path.join(directory, 'production-inert-final-receipt.json');
    writeFileSync(receiptPath, stableJson(receipt), 'utf8');
    writeFileSync(path.join(directory, 'summary.json'), stableJson(summary), 'utf8');
    return receiptPath;
}

describe('Supabase production post-closure backup runner', () => {
    it('requires a destination, fresh final evidence and canonical SHA even in plan mode', () => {
        expect(() => parsePostClosureBackupArgs([])).toThrow('--destination is required');
        expect(() => parsePostClosureBackupArgs([
            'plan',
            '--destination',
            'C:\\backups\\post-closure.dump',
            '--production-inert-evidence',
            'production-inert-final-receipt.json',
            '--canonical-sha',
            canonicalSha,
        ])).not.toThrow();
        expect(parsePostClosureBackupArgs([
            'execute',
            '--destination',
            'C:\\backups\\post-closure.dump',
            '--production-inert-evidence',
            'production-inert-final-receipt.json',
            '--canonical-sha',
            canonicalSha,
            '--execute-approved',
            '--restore-procedure-reviewed',
        ])).toMatchObject({
            mode: 'execute',
            canonicalSha,
            executeApproved: true,
            restoreProcedureReviewed: true,
        });
        expect(() => parsePostClosureBackupArgs([
            'plan',
            '--destination',
            'C:\\backups\\post-closure.dump',
            '--production-inert-evidence',
            'evidence.json',
            '--canonical-sha',
            'short',
        ])).toThrow('40-character');
        expect(runnerSource).toContain("identity.branch !== 'main'");
        expect(runnerSource).toContain("['status', '--porcelain=v1', '--untracked-files=all']");
        expect(runnerSource).toContain('identity.head !== canonicalSha');
        expect(runnerSource).toContain("['rev-parse', '--verify', 'refs/remotes/origin/main']");
        expect(runnerSource).toContain('identity.originMain !== canonicalSha');
    });

    it('accepts only the canonical receipt from the latest real attempt and ignores plan-only output', () => {
        const attemptsRoot = mkdtempSync(path.join(tmpdir(), 'eh-inert-attempts-'));
        try {
            const receipt = validFinalReceipt(new Date('2026-07-17T12:00:00.000Z'));
            const receiptPath = writeSuccessfulAttempt(
                attemptsRoot,
                new Date('2026-07-17T11:59:58.000Z'),
                receipt,
            );
            const planDirectory = path.join(
                attemptsRoot,
                attemptDirectoryName(new Date('2026-07-17T12:06:30.000Z')),
            );
            mkdirSync(planDirectory);
            writeFileSync(path.join(planDirectory, 'plan.json'), '{}\n', 'utf8');

            const loaded = loadProductionInertFinalEvidence(
                receiptPath,
                new Date('2026-07-17T12:05:00.000Z'),
                { attemptsRoot },
            );
            expect(loaded.receiptPath).toBe(receiptPath);
            expect(loaded.summary.status).toBe(PRODUCTION_INERT_FINAL_STATUS);
            expect(loaded.databaseStateSha256).toBe(receipt.databaseStateSha256);

            const failedStartedAt = new Date('2026-07-17T12:06:00.000Z');
            const failedDirectory = path.join(attemptsRoot, attemptDirectoryName(failedStartedAt));
            mkdirSync(failedDirectory);
            const inProgressSummary = createProductionInertFinalAttemptSummary({
                status: 'CAPTURE_IN_PROGRESS',
                startedAt: failedStartedAt,
            });
            writeFileSync(path.join(failedDirectory, 'summary.json'), stableJson(inProgressSummary), 'utf8');
            expect(() => loadProductionInertFinalEvidence(
                receiptPath,
                new Date('2026-07-17T12:07:00.000Z'),
                { attemptsRoot },
            )).toThrow('CAPTURE_IN_PROGRESS');

            const failedSummary = createProductionInertFinalAttemptSummary({
                status: 'CAPTURE_FAILED',
                startedAt: failedStartedAt,
                finishedAt: new Date('2026-07-17T12:06:01.000Z'),
                failureCategory: 'DATABASE_READBACK_FAILED',
            });
            writeFileSync(path.join(failedDirectory, 'summary.json'), stableJson(failedSummary), 'utf8');
            expect(() => loadProductionInertFinalEvidence(
                receiptPath,
                new Date('2026-07-17T12:07:00.000Z'),
                { attemptsRoot },
            )).toThrow('CAPTURE_FAILED');
        } finally {
            rmSync(attemptsRoot, { recursive: true, force: true });
        }
    });

    it('rejects an older supplied path, an invalid newest attempt and summary-receipt drift', () => {
        const attemptsRoot = mkdtempSync(path.join(tmpdir(), 'eh-inert-attempts-'));
        try {
            const olderReceipt = validFinalReceipt(new Date('2026-07-17T12:00:00.000Z'));
            const olderPath = writeSuccessfulAttempt(
                attemptsRoot,
                new Date('2026-07-17T11:59:58.000Z'),
                olderReceipt,
            );
            const latestReceipt = validFinalReceipt(new Date('2026-07-17T12:02:00.000Z'));
            const latestPath = writeSuccessfulAttempt(
                attemptsRoot,
                new Date('2026-07-17T12:01:58.000Z'),
                latestReceipt,
            );
            const now = new Date('2026-07-17T12:05:00.000Z');
            expect(() => loadProductionInertFinalEvidence(olderPath, now, { attemptsRoot }))
                .toThrow('canonical receipt from the latest real attempt');

            const latestSummaryPath = path.join(path.dirname(latestPath), 'summary.json');
            const latestSummary = JSON.parse(readFileSync(latestSummaryPath, 'utf8')) as Record<string, unknown>;
            latestSummary.receiptSha256 = 'f'.repeat(64);
            writeFileSync(latestSummaryPath, stableJson(latestSummary), 'utf8');
            expect(() => loadProductionInertFinalEvidence(latestPath, now, { attemptsRoot }))
                .toThrow('does not bind exactly');

            const invalidStartedAt = new Date('2026-07-17T12:03:00.000Z');
            const invalidDirectory = path.join(attemptsRoot, attemptDirectoryName(invalidStartedAt));
            mkdirSync(invalidDirectory);
            writeFileSync(path.join(invalidDirectory, 'summary.json'), '{}\n', 'utf8');
            expect(() => loadProductionInertFinalEvidence(latestPath, now, { attemptsRoot }))
                .toThrow('summary is invalid');
        } finally {
            rmSync(attemptsRoot, { recursive: true, force: true });
        }
    });

    it('requires a five-minute evidence margin before dump but permits final zero-margin revalidation', () => {
        const attemptsRoot = mkdtempSync(path.join(tmpdir(), 'eh-inert-attempts-'));
        try {
            const receipt = validFinalReceipt(new Date('2026-07-17T12:00:00.000Z'));
            const receiptPath = writeSuccessfulAttempt(
                attemptsRoot,
                new Date('2026-07-17T11:59:58.000Z'),
                receipt,
            );
            expect(POST_CLOSURE_MINIMUM_EVIDENCE_TTL_MS).toBe(5 * 60 * 1_000);
            expect(() => loadProductionInertFinalEvidence(
                receiptPath,
                new Date('2026-07-17T12:10:00.000Z'),
                { attemptsRoot },
            )).not.toThrow();
            expect(() => loadProductionInertFinalEvidence(
                receiptPath,
                new Date('2026-07-17T12:10:00.001Z'),
                { attemptsRoot },
            )).toThrow('at least 300000 ms');
            expect(() => loadProductionInertFinalEvidence(
                receiptPath,
                new Date('2026-07-17T12:14:59.999Z'),
                { attemptsRoot, minimumRemainingTtlMs: 0 },
            )).not.toThrow();
        } finally {
            rmSync(attemptsRoot, { recursive: true, force: true });
        }
    });

    it('validates exact sanitized row state and its SHA against the final evidence', () => {
        const receipt = validFinalReceipt(new Date('2026-07-17T12:00:00.000Z'));
        const readback = validReadback();
        const evidence = {
            value: receipt,
            sha256: '4'.repeat(64),
            databaseStateSha256: receipt.databaseStateSha256,
            summary: createProductionInertFinalAttemptSummary({
                status: PRODUCTION_INERT_FINAL_STATUS,
                startedAt: new Date('2026-07-17T11:59:58.000Z'),
                finishedAt: new Date('2026-07-17T12:00:00.001Z'),
                receipt,
            }),
            receiptPath: 'canonical-receipt.json',
        };
        expect(assertProductionInertRowStateMatchesEvidence(readback, evidence, 'Pre-dump'))
            .toBe(receipt.databaseStateSha256);
        expect(() => assertProductionInertRowStateMatchesEvidence(
            validReadback({ availability_total_count: '4' }),
            evidence,
            'Post-dump',
        )).toThrow('availability_total_count');
        expect(() => assertProductionInertRowStateMatchesEvidence(
            readback,
            { ...evidence, databaseStateSha256: '9'.repeat(64) },
            'Post-dump',
        )).toThrow('does not match the supplied receipt');
    });

    it('keeps expected identities out of psql argv and redacts them from diagnostics', () => {
        const admin = 'admin@example.invalid';
        const teacher = 'teacher@example.invalid';
        expect(redactExpectedProductionEmails(
            `failed for ${admin} and ${teacher}`,
            [admin, teacher],
        )).toBe('failed for [redacted-email] and [redacted-email]');
        expect(runnerSource).not.toContain('`expected_admin_email=${expectedAdminEmail}`');
        expect(runnerSource).not.toContain('`expected_teacher_email=${expectedTeacherEmail}`');
        expect(runnerSource).toContain('\\getenv expected_admin_email EH_EXPECTED_ADMIN_EMAIL');
        expect(runnerSource).toContain('redactExpectedProductionEmails(');
    });

    it('binds exact approval to post-closure state and every safety boundary', () => {
        const approval = buildPostClosureBackupApproval({
            canonicalGitSha: canonicalSha,
            productionInertEvidenceSha256: hashA,
            databaseStateSha256: hashB,
            destinationBindingSha256: hashC,
        });
        for (const expected of [
            `target=${FIXTURE_CLEANUP_TARGET.projectRef}`,
            `canonical_sha=${canonicalSha}`,
            `production_inert_evidence=${hashA}`,
            `database_state=${hashB}`,
            `table_contract=${POST_CLOSURE_TABLE_CONTRACT_SHA256}`,
            `destination_binding=${hashC}`,
            'at_rest_protection=windows_efs',
            'overwrite=FORBIDDEN',
            'database_writes=FORBIDDEN',
            'external_service_writes=FORBIDDEN',
            'restore_validation=TABLETOP_PG_RESTORE_LIST_ONLY',
        ]) {
            expect(approval).toContain(expected);
        }
        expect(POST_CLOSURE_BACKUP_APPROVAL_ENV)
            .toBe('SUPABASE_PRODUCTION_POST_CLOSURE_BACKUP_APPROVAL');
        expect(runnerSource).toContain('process.env[POST_CLOSURE_BACKUP_APPROVAL_ENV] !== approval');
    });

    it('accepts exactly the 22 post-closure public tables plus managed auth tables', () => {
        expect(POST_CLOSURE_PUBLIC_TABLES).toHaveLength(22);
        const inventory = [
            ...POST_CLOSURE_PUBLIC_TABLES.map((table) => `public\t${table}`),
            'auth\tusers',
            'auth\tsessions',
            'auth\tidentities',
        ].join('\n');
        const parsed = parseLiveTableInventory(inventory);
        expect(validateLivePostClosureInventory(parsed)).toEqual({
            ok: true,
            missingPublic: [],
            unexpectedPublic: [],
            missingAuth: [],
        });
        const withoutPackagePrices = parsed.filter((entry) => entry !== 'public.package_prices');
        expect(validateLivePostClosureInventory([
            ...withoutPackagePrices,
            'public.jobs',
        ])).toMatchObject({
            ok: false,
            missingPublic: ['public.package_prices'],
            unexpectedPublic: ['public.jobs'],
        });
    });

    it('compares the archive TABLE DATA to the full live public and auth inventory', () => {
        const live = [
            ...POST_CLOSURE_PUBLIC_TABLES.map((table) => `public.${table}`),
            'auth.users',
            'auth.sessions',
        ].sort();
        const toc = live
            .map((entry, index) => {
                const [schema, table] = entry.split('.');
                return `${index + 1}; 0 0 TABLE DATA ${schema} ${table} postgres`;
            })
            .join('\n');
        expect(parseArchivePublicAuthTableData(toc)).toEqual(live);
        expect(compareArchiveToLiveInventory(toc, live)).toEqual({
            ok: true,
            missingFromArchive: [],
            unexpectedInArchive: [],
        });
        expect(compareArchiveToLiveInventory(
            toc.replace('TABLE DATA auth sessions', 'TABLE DATA auth refresh_tokens'),
            live,
        )).toEqual({
            ok: false,
            missingFromArchive: ['auth.sessions'],
            unexpectedInArchive: ['auth.refresh_tokens'],
        });
    });

    it('proves EFS with positioned local content, restores the same file, then gives its descriptor to pg_dump', () => {
        const helperStart = runnerSource.indexOf('export function prepareReservedArtifactForEncryptedDump(');
        const sentinelWrite = runnerSource.indexOf('const bytesWritten = writeSync(', helperStart);
        const sentinelFsync = runnerSource.indexOf('fsyncSync(descriptor);', sentinelWrite);
        const sentinelFingerprint = runnerSource.indexOf('const sentinelArtifact = captureReservedArtifactFingerprint(', sentinelFsync);
        const artifactEfs = runnerSource.indexOf('verifyArtifactEfs(destination)', sentinelFingerprint);
        const truncate = runnerSource.indexOf('ftruncateSync(descriptor, 0)', artifactEfs);
        const restoreFsync = runnerSource.indexOf('fsyncSync(descriptor);', truncate);
        const restoredFingerprint = runnerSource.indexOf('const restoredArtifact = captureReservedArtifactFingerprint(', restoreFsync);
        const finalParentEfs = runnerSource.indexOf('Windows EFS protection could not be re-verified immediately before execution.');
        const reservation = runnerSource.indexOf("const descriptor = openSync(destination, 'wx', 0o600)", finalParentEfs);
        const prepareCall = runnerSource.indexOf('const emptyArtifact = prepareReservedArtifactForEncryptedDump(', reservation);
        const dotenvLoad = runnerSource.indexOf('loadDotenv({', prepareCall);
        expect(helperStart).toBeGreaterThan(-1);
        expect(sentinelWrite).toBeGreaterThan(helperStart);
        expect(sentinelFsync).toBeGreaterThan(sentinelWrite);
        expect(sentinelFingerprint).toBeGreaterThan(sentinelFsync);
        expect(artifactEfs).toBeGreaterThan(sentinelFingerprint);
        expect(truncate).toBeGreaterThan(artifactEfs);
        expect(restoreFsync).toBeGreaterThan(truncate);
        expect(restoredFingerprint).toBeGreaterThan(restoreFsync);
        expect(finalParentEfs).toBeGreaterThan(-1);
        expect(reservation).toBeGreaterThan(finalParentEfs);
        expect(prepareCall).toBeGreaterThan(reservation);
        expect(dotenvLoad).toBeGreaterThan(prepareCall);
        expect(runnerSource).toContain("openSync(destination, 'wx', 0o600)");
        expect(runnerSource).toContain("stdio: ['ignore', descriptor, 'pipe']");
        expect(runnerSource).toContain('runPgDumpToReservedDestination(descriptor, databaseToolEnvironment)');
        expect(runnerSource).toContain('fsyncSync(descriptor)');
        expect(runnerSource).not.toMatch(/["']--file["']/u);
        expect(runnerSource).not.toMatch(/\b(?:unlinkSync|rmSync|renameSync)\b/u);
        expect(runnerSource).toContain('partial artifact was retained');
        expect(runnerSource).toContain("['--list', destination]");
        expect(runnerSource).toContain('repositoryRelativeOutputPath');
        expect(runnerSource).not.toContain("PLAN_ONLY_READY: ${path.join(outputDir, 'summary.json')}");
        expect(runnerSource).not.toContain("${POST_CLOSURE_BACKUP_STATUS}: ${path.join(outputDir, 'summary.json')}");
    });

    it('restores the reserved artifact to byte zero after a successful EFS sentinel check', () => {
        const directory = mkdtempSync(path.join(tmpdir(), 'eh-efs-reservation-'));
        const destination = path.join(directory, 'backup.dump');
        const descriptor = openSync(destination, 'wx', 0o600);
        try {
            const reserved = captureReservedArtifactFingerprint(descriptor, destination);
            const restored = prepareReservedArtifactForEncryptedDump(
                descriptor,
                destination,
                (artifactPath) => {
                    const sentinel = captureReservedArtifactFingerprint(descriptor, artifactPath);
                    expect(sentinel).toMatchObject({
                        device: reserved.device,
                        inode: reserved.inode,
                        birthtimeMs: reserved.birthtimeMs,
                        size: 1,
                    });
                    expect(readFileSync(artifactPath)).toEqual(Buffer.from([0x45]));
                    return { valid: true };
                },
            );
            expect(restored).toMatchObject({
                device: reserved.device,
                inode: reserved.inode,
                birthtimeMs: reserved.birthtimeMs,
                size: 0,
            });
            expect(readFileSync(destination)).toHaveLength(0);

            writeFileSync(descriptor, Buffer.from('archive-at-zero'));
            fsyncSync(descriptor);
            expect(readFileSync(destination, 'utf8')).toBe('archive-at-zero');
        } finally {
            closeSync(descriptor);
            rmSync(directory, { recursive: true, force: true });
        }
    });

    it('fails closed while still restoring the reserved artifact after an invalid EFS check', () => {
        const directory = mkdtempSync(path.join(tmpdir(), 'eh-efs-reservation-failure-'));
        const destination = path.join(directory, 'backup.dump');
        const descriptor = openSync(destination, 'wx', 0o600);
        try {
            expect(() => prepareReservedArtifactForEncryptedDump(
                descriptor,
                destination,
                () => ({ valid: false }),
            )).toThrow('did not inherit verifiable Windows EFS protection');
            expect(readFileSync(destination)).toHaveLength(0);

            writeFileSync(descriptor, Buffer.from('failure-restored-at-zero'));
            fsyncSync(descriptor);
            expect(readFileSync(destination, 'utf8')).toBe('failure-restored-at-zero');
        } finally {
            closeSync(descriptor);
            rmSync(directory, { recursive: true, force: true });
        }
    });

    it('pins identity, size, mtime and hash and detects mutation through the still-open handle', async () => {
        const directory = mkdtempSync(path.join(tmpdir(), 'eh-pinned-artifact-'));
        const destination = path.join(directory, 'backup.dump');
        const descriptor = openSync(destination, 'wx', 0o600);
        try {
            expect(captureReservedArtifactFingerprint(descriptor, destination).size).toBe(0);
            writeFileSync(descriptor, Buffer.from('custom-archive'));
            fsyncSync(descriptor);
            const pinned = captureReservedArtifactFingerprint(descriptor, destination);
            expect(pinned.size).toBe(Buffer.byteLength('custom-archive'));
            const digest = await sha256PinnedReservedArtifact(descriptor, destination, pinned);
            expect(digest).toMatch(/^[a-f0-9]{64}$/u);
            expect(assertReservedArtifactFingerprint(descriptor, destination, pinned)).toEqual(pinned);

            writeFileSync(descriptor, Buffer.from('-tampered'));
            fsyncSync(descriptor);
            expect(() => assertReservedArtifactFingerprint(descriptor, destination, pinned))
                .toThrow('changed after the dump was pinned');
        } finally {
            closeSync(descriptor);
            rmSync(directory, { recursive: true, force: true });
        }
    });

    it('writes a path-free durable failure contract for every post-reservation failure', () => {
        const summary = createPostClosureArtifactFailureSummary({
            canonicalGitSha: canonicalSha,
            destinationBindingSha256: hashC,
            phase: 'DUMP_PINNED',
            error: new Error('archive identity changed at C:\\private\\backup.dump'),
            artifactRetainedForInspection: true,
            receiptPersisted: false,
        });
        expect(summary).toMatchObject({
            status: 'BACKUP_FAILED_NO_RECEIPT',
            failurePhase: 'DUMP_PINNED',
            failureCategory: 'ARCHIVE_VERIFICATION_FAILED',
            artifactReservationCreated: true,
            artifactRetainedForInspection: true,
            artifactPathRecorded: false,
            receiptPersisted: false,
            databaseWritePerformed: false,
            externalServiceWritePerformed: false,
        });
        expect(JSON.stringify(summary)).not.toContain('C:\\private');
        expect(runnerSource).toContain('catch (error) {');
        expect(runnerSource).toContain('createPostClosureArtifactFailureSummary({');
        expect(runnerSource).toContain("writeDurableFile(path.join(outputDir, 'summary.json'), stableJson(summary), 'w')");
        expect(runnerSource).toContain('fsyncSync(descriptor)');
    });

    it('loads .env only after local gates and uses the exact production DB URL validator', () => {
        const approvalGate = runnerSource.indexOf('process.env[POST_CLOSURE_BACKUP_APPROVAL_ENV] !== approval');
        const immediateEvidence = runnerSource.indexOf('loadProductionInertFinalEvidence(', approvalGate);
        const dotenvLoad = runnerSource.indexOf('loadDotenv({', immediateEvidence);
        const databaseBuild = runnerSource.indexOf('buildPsqlEnvironment(databaseUrl)', dotenvLoad);
        const rowStateBefore = runnerSource.indexOf('const rowStateBefore = readProductionInertRowState(', databaseBuild);
        const authGet = runnerSource.indexOf('await withSupabaseAuthManagementClient(', rowStateBefore);
        const preDumpEvidence = runnerSource.indexOf('const preDumpEvidence = loadProductionInertFinalEvidence(', authGet);
        const dump = runnerSource.indexOf('runPgDumpToReservedDestination(', preDumpEvidence);
        const rowStateAfter = runnerSource.indexOf('const rowStateAfter = readProductionInertRowState(', dump);
        const finalAuthGet = runnerSource.indexOf('await withSupabaseAuthManagementClient(', rowStateAfter);
        const finalArtifactEfs = runnerSource.indexOf('verifyWindowsEfsArtifact(destination)', finalAuthGet);
        const finalArtifactHash = runnerSource.indexOf('const artifactSha256 = await sha256PinnedReservedArtifact(', finalArtifactEfs);
        const finalEvidence = runnerSource.indexOf('const finalEvidence = loadProductionInertFinalEvidence(', finalArtifactHash);
        const receiptCreation = runnerSource.indexOf('const receipt = createPostClosureBackupReceipt({', finalEvidence);
        expect(approvalGate).toBeGreaterThan(-1);
        expect(immediateEvidence).toBeGreaterThan(approvalGate);
        expect(dotenvLoad).toBeGreaterThan(immediateEvidence);
        expect(runnerSource.slice(dotenvLoad, databaseBuild)).toContain('override: false');
        expect(databaseBuild).toBeGreaterThan(dotenvLoad);
        expect(rowStateBefore).toBeGreaterThan(databaseBuild);
        expect(authGet).toBeGreaterThan(rowStateBefore);
        expect(preDumpEvidence).toBeGreaterThan(authGet);
        expect(dump).toBeGreaterThan(preDumpEvidence);
        expect(rowStateAfter).toBeGreaterThan(dump);
        expect(finalAuthGet).toBeGreaterThan(rowStateAfter);
        expect(finalArtifactEfs).toBeGreaterThan(finalAuthGet);
        expect(finalArtifactHash).toBeGreaterThan(finalArtifactEfs);
        expect(finalEvidence).toBeGreaterThan(finalArtifactHash);
        expect(receiptCreation).toBeGreaterThan(finalEvidence);
        expect(runnerSource.slice(finalEvidence, receiptCreation)).not.toContain('await ');
        expect(runnerSource).toContain('verifyLiveProductionAuthInert(client)');
        expect(runnerSource.match(/verifyLiveProductionAuthInert\(client\)/gu)).toHaveLength(2);
        expect(runnerSource).toContain('renderProductionInertFinalReadbackSql()');
        expect(runnerSource).toContain('{ minimumRemainingTtlMs: 0 }');
        expect(runnerSource).toContain('artifactSha256 !== artifactSha256AfterDump');
        expect(runnerSource).toContain('assertReservedArtifactFingerprint(descriptor, destination, pinnedArtifact)');
        expect(runnerSource).toContain("connection.PGDATABASE !== 'postgres'");
        expect(runnerSource).not.toContain('SUPABASE_ACCESS_TOKEN');
    });

    it('issues a new receipt incompatible with the historical cleanup backup contract', () => {
        const receipt = createPostClosureBackupReceipt({
            canonicalGitSha: canonicalSha,
            productionInertEvidenceSha256: hashA,
            databaseStateSha256: hashB,
            destinationBindingSha256: hashC,
            liveInventorySha256: 'd'.repeat(64),
            livePublicTableCount: 22,
            liveAuthTableCount: 12,
            archiveTocEntryCount: 100,
            artifactSha256: 'e'.repeat(64),
            artifactBytes: 1234,
            toolVersions: {
                pgDump: 'pg_dump (PostgreSQL) 17.4',
                pgRestore: 'pg_restore (PostgreSQL) 17.4',
                psql: 'psql (PostgreSQL) 17.4',
            },
            createdAt: new Date('2026-07-17T12:00:00.000Z'),
        });
        expect(receipt).toMatchObject({
            receiptKind: POST_CLOSURE_BACKUP_RECEIPT_KIND,
            status: POST_CLOSURE_BACKUP_STATUS,
            canonicalGitSha: canonicalSha,
            productionInertEvidenceSha256: hashA,
            databaseStateSha256: hashB,
            tableContractSha256: POST_CLOSURE_TABLE_CONTRACT_SHA256,
            livePublicTableCount: 22,
            stableLiveInventoryReadbacks: 2,
            stableProductionInertRowStateReadbacks: 2,
            liveAuthConfigurationReadbacks: 2,
            archiveMatchesFullLiveInventory: true,
            artifactPathRecorded: false,
            restorePerformed: false,
            restoreValidation: 'tabletop_pg_restore_list_only',
            databaseWritePerformed: false,
            externalServiceWritePerformed: false,
        });
        expect(validatePostClosureBackupReceipt(
            receipt,
            new Date('2026-07-17T12:00:01.000Z'),
        )).toEqual([]);
        expect(validatePostClosureBackupReceipt({
            ...receipt,
            databaseStateSha256: 'invalid',
            artifactPath: 'C:\\secret\\backup.dump',
        }, new Date('2026-07-17T12:00:01.000Z'))).toEqual(expect.arrayContaining([
            'Post-closure backup receipt keys are not exact.',
            'databaseStateSha256 must be a lowercase SHA-256.',
        ]));
        const serialized = JSON.stringify(receipt);
        expect(serialized).not.toContain('aggregateSnapshotSha256');
        expect(serialized).not.toContain('approvalScopeSha256');
        expect(serialized).not.toContain('authInertEvidenceSha256');
        expect(serialized).not.toContain('"artifactPath":');
        expect(serialized).not.toContain('postgresql://');
        expect(serialized).not.toContain('@');
    });

    it('never restores or writes to the production database', () => {
        expect(runnerSource).toContain("PGOPTIONS: '-c default_transaction_read_only=on");
        expect(runnerSource).not.toContain("'--dbname'");
        expect(runnerSource).not.toContain('pg_restore --dbname');
        expect(runnerSource).not.toContain('supabase db push');
        expect(runnerSource).not.toContain('supabase migration repair');
        expect(runnerSource).toContain('databaseWritePerformed: false');
        expect(runnerSource).toContain('externalServiceWritePerformed: false');
    });
});
