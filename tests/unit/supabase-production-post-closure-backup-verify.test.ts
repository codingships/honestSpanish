import {
    mkdtempSync,
    mkdirSync,
    readFileSync,
    rmSync,
    statSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
    createPostClosureBackupReceipt,
    POST_CLOSURE_PUBLIC_TABLES,
} from '../../scripts/launch/supabase-production-post-closure-backup';
import {
    destinationBindingForExistingArtifact,
    createPostClosureBackupVerifyOutputDirectory,
    loadExactPostClosureBackupReceipt,
    normalizePostClosureBackupPathForBinding,
    parsePostClosureBackupVerifyArgs,
    POST_CLOSURE_BACKUP_VERIFY_STATUS,
    verifyPostClosureBackupLocally,
    type PostClosureBackupVerifyRuntime,
} from '../../scripts/launch/supabase-production-post-closure-backup-verify';
import {
    sha256,
    stableJson,
} from '../../scripts/launch/production-fixture-cleanup-shared';

const verificationSource = readFileSync(
    'scripts/launch/supabase-production-post-closure-backup-verify.ts',
    'utf8',
);
const canonicalSha = 'a'.repeat(40);
const productionEvidenceSha = 'b'.repeat(64);
const databaseStateSha = 'c'.repeat(64);
const createdAt = new Date('2026-07-17T10:00:00.000Z');
const verifiedAt = new Date('2026-07-17T11:00:00.000Z');
const temporaryDirectories: string[] = [];

afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
        rmSync(directory, { recursive: true, force: true });
    }
});

describe('Supabase production post-closure backup local verifier', () => {
    it('requires one explicit artifact and one receipt without accepting extra arguments', () => {
        expect(() => parsePostClosureBackupVerifyArgs([])).toThrow('--artifact is required');
        expect(() => parsePostClosureBackupVerifyArgs([
            '--artifact',
            path.resolve('backup.dump'),
        ])).toThrow('--receipt is required');
        expect(() => parsePostClosureBackupVerifyArgs([
            '--artifact',
            'relative.dump',
            '--receipt',
            'receipt.json',
        ])).toThrow('--artifact must be an absolute path');
        expect(() => parsePostClosureBackupVerifyArgs([
            '--artifact',
            path.resolve('backup.dump'),
            '--artifact',
            path.resolve('second.dump'),
            '--receipt',
            'receipt.json',
        ])).toThrow('--artifact may only be supplied once');
        expect(() => parsePostClosureBackupVerifyArgs([
            '--artifact',
            path.resolve('backup.dump'),
            '--receipt',
            'receipt.json',
            '--network',
        ])).toThrow('Unknown post-closure backup verification argument');
    });

    it('revalidates an exact path-bound EFS artifact and emits only path-free local evidence', async () => {
        const fixture = createValidFixture();
        const result = await verifyPostClosureBackupLocally({
            artifactPath: fixture.artifactPath,
            receiptPath: fixture.receiptPath,
            repositoryRoot: process.cwd(),
            runtime: fixture.runtime,
            now: verifiedAt,
        });

        expect(result).toEqual({
            valid: true,
            errors: [],
            verificationReceipt: expect.objectContaining({
                status: POST_CLOSURE_BACKUP_VERIFY_STATUS,
                sourceReceiptSha256: sha256(stableJson(fixture.receipt)),
                artifactSha256: fixture.receipt.artifactSha256,
                artifactBytes: fixture.receipt.artifactBytes,
                liveInventorySha256: fixture.receipt.liveInventorySha256,
                livePublicTableCount: 22,
                liveAuthTableCount: 2,
                receiptContractVerified: true,
                destinationBindingVerified: true,
                atRestProtectionVerified: true,
                archiveListVerified: true,
                archiveMatchesPostClosureContract: true,
                archiveMatchesFullReceiptInventory: true,
                artifactPathRecorded: false,
                sourceReceiptPathRecorded: false,
                networkAccessPerformed: false,
                credentialEnvironmentRead: false,
                databaseReadPerformed: false,
                databaseWritePerformed: false,
                externalServiceWritePerformed: false,
                verifiedAt: verifiedAt.toISOString(),
            }),
        });
        const serialized = stableJson(result.verificationReceipt);
        expect(serialized).not.toContain(fixture.artifactPath);
        expect(serialized).not.toContain(fixture.receiptPath);
        expect(serialized).not.toMatch(/@|postgres(?:ql)?:\/\//iu);
    });

    it('uses the same normalized real destination binding contract as the writer', () => {
        const fixture = createValidFixture();
        const spellingWithSegments = path.join(path.dirname(fixture.artifactPath), '.', path.basename(fixture.artifactPath));
        const resolved = destinationBindingForExistingArtifact(spellingWithSegments, process.cwd());
        expect(resolved.destinationBindingSha256).toBe(sha256(
            normalizePostClosureBackupPathForBinding(path.resolve(spellingWithSegments)),
        ));
        expect(resolved.destinationBindingSha256).toBe(fixture.receipt.destinationBindingSha256);
        if (process.platform === 'win32') {
            const alternateCase = fixture.artifactPath.toUpperCase();
            expect(destinationBindingForExistingArtifact(alternateCase, process.cwd()).destinationBindingSha256)
                .toBe(fixture.receipt.destinationBindingSha256);
        }
    });

    it('creates the outputs parent on first use and refuses to reuse a timestamp directory', () => {
        const repositoryRoot = mkdtempSync(path.join(tmpdir(), 'eh-post-closure-verify-output-'));
        temporaryDirectories.push(repositoryRoot);
        const outputDirectory = createPostClosureBackupVerifyOutputDirectory(verifiedAt, repositoryRoot);
        expect(statSync(outputDirectory).isDirectory()).toBe(true);
        expect(() => createPostClosureBackupVerifyOutputDirectory(verifiedAt, repositoryRoot)).toThrow();
    });

    it('rejects artifacts inside the repository before invoking local tools', async () => {
        const directory = mkdtempSync(path.join(process.cwd(), '.post-closure-verify-'));
        temporaryDirectories.push(directory);
        const artifactPath = path.join(directory, 'inside.dump');
        const receiptPath = path.join(directory, 'receipt.json');
        writeFileSync(artifactPath, 'archive', 'utf8');
        writeFileSync(receiptPath, '{}\n', 'utf8');
        let runtimeCalled = false;
        const result = await verifyPostClosureBackupLocally({
            artifactPath,
            receiptPath,
            runtime: {
                verifyWindowsEfsArtifact: () => { runtimeCalled = true; return true; },
                listArchive: () => { runtimeCalled = true; return { ok: true, stdout: '' }; },
                sha256File: async () => { runtimeCalled = true; return 'a'.repeat(64); },
            },
            now: verifiedAt,
        });
        expect(result.valid).toBe(false);
        expect(result.errors).toContain(
            'The artifact must be an existing ordinary non-symlink .dump file outside the repository.',
        );
        expect(runtimeCalled).toBe(false);
    });

    it('requires exact canonical receipt JSON and rejects path-like material accepted by its shape', () => {
        const fixture = createValidFixture();
        writeFileSync(fixture.receiptPath, JSON.stringify(fixture.receipt), 'utf8');
        expect(() => loadExactPostClosureBackupReceipt(fixture.receiptPath, verifiedAt)).toThrow(
            'canonical exact form',
        );

        const pathBearingReceipt = {
            ...fixture.receipt,
            toolVersions: {
                ...fixture.receipt.toolVersions,
                pgDump: 'C:\\PostgreSQL\\pg_dump.exe',
            },
        };
        writeFileSync(fixture.receiptPath, stableJson(pathBearingReceipt), 'utf8');
        expect(() => loadExactPostClosureBackupReceipt(fixture.receiptPath, verifiedAt)).toThrow(
            'path, identity, URL or secret-like material',
        );
    });

    it('fails closed on destination binding, byte count, digest and EFS drift', async () => {
        const fixture = createValidFixture({
            receiptOverrides: {
                destinationBindingSha256: 'd'.repeat(64),
                artifactBytes: 999,
                artifactSha256: 'e'.repeat(64),
            },
            efsVerified: false,
        });
        const result = await verifyPostClosureBackupLocally({
            artifactPath: fixture.artifactPath,
            receiptPath: fixture.receiptPath,
            runtime: fixture.runtime,
            now: verifiedAt,
        });
        expect(result.valid).toBe(false);
        expect(result.verificationReceipt).toBeNull();
        expect(result.errors).toEqual(expect.arrayContaining([
            'The artifact destination binding does not match the source receipt.',
            'The artifact size does not match the source receipt.',
            'The artifact SHA-256 does not match the source receipt.',
            'Windows EFS protection could not be re-verified.',
        ]));
    });

    it('fails closed when pg_restore cannot list the custom archive', async () => {
        const fixture = createValidFixture({ archiveListOk: false });
        const result = await verifyPostClosureBackupLocally({
            artifactPath: fixture.artifactPath,
            receiptPath: fixture.receiptPath,
            runtime: fixture.runtime,
            now: verifiedAt,
        });
        expect(result.valid).toBe(false);
        expect(result.errors).toContain('pg_restore --list could not read the artifact.');
    });

    it('fails closed on duplicate public/auth TABLE DATA entries', async () => {
        const fixture = createValidFixture({ duplicateFirstInventoryEntry: true });
        const result = await verifyPostClosureBackupLocally({
            artifactPath: fixture.artifactPath,
            receiptPath: fixture.receiptPath,
            runtime: fixture.runtime,
            now: verifiedAt,
        });
        expect(result.valid).toBe(false);
        expect(result.errors).toContain(
            'The archive contains duplicate or malformed public/auth TABLE DATA entries.',
        );
    });

    it('binds the exact public and complete auth inventories, their counts, hash and TOC size', async () => {
        const fixture = createValidFixture({
            receiptOverrides: {
                liveInventorySha256: 'f'.repeat(64),
                liveAuthTableCount: 3,
                archiveTocEntryCount: 999,
            },
        });
        const result = await verifyPostClosureBackupLocally({
            artifactPath: fixture.artifactPath,
            receiptPath: fixture.receiptPath,
            runtime: fixture.runtime,
            now: verifiedAt,
        });
        expect(result.valid).toBe(false);
        expect(result.errors).toEqual(expect.arrayContaining([
            'The archive auth TABLE DATA inventory does not match the receipt count or lacks auth.users.',
            'The archive public/auth TABLE DATA inventory hash does not match the receipt.',
            'The archive TOC entry count does not match the receipt.',
        ]));
    });

    it('rejects a forbidden or unexpected public table even if a forged receipt hashes it', async () => {
        const fixture = createValidFixture({ additionalInventory: ['public.jobs'] });
        const result = await verifyPostClosureBackupLocally({
            artifactPath: fixture.artifactPath,
            receiptPath: fixture.receiptPath,
            runtime: fixture.runtime,
            now: verifiedAt,
        });
        expect(result.valid).toBe(false);
        expect(result.errors).toEqual(expect.arrayContaining([
            'The archive does not match the exact post-closure public/auth contract.',
            'The archive public TABLE DATA inventory is not the exact 22-table contract.',
        ]));
    });

    it('has no application environment, credential, database or network execution path', () => {
        expect(verificationSource).not.toMatch(/from ['"]dotenv['"]/u);
        expect(verificationSource).not.toMatch(/loadDotenv|parseDotenv|SUPABASE_(?:DB_URL|ACCESS_TOKEN)|PGPASSWORD/u);
        expect(verificationSource).not.toMatch(/\bfetch\s*\(/u);
        expect(verificationSource).not.toMatch(/https?\.request|\bpsql\b|\bpg_dump\b/iu);
        expect(verificationSource).toContain("spawnSync('pg_restore'");
        expect(verificationSource).toContain("spawnSync('cipher.exe'");
        expect(verificationSource).toContain('credentialEnvironmentRead: false');
        expect(verificationSource).toContain('networkAccessPerformed: false');
        expect(verificationSource).toContain('repositoryRelativeOutputPath');
        expect(verificationSource).not.toContain("${POST_CLOSURE_BACKUP_VERIFY_STATUS}: ${path.join(outputDirectory, 'summary.json')}");
    });
});

interface FixtureOptions {
    receiptOverrides?: Record<string, unknown>;
    additionalInventory?: string[];
    efsVerified?: boolean;
    archiveListOk?: boolean;
    duplicateFirstInventoryEntry?: boolean;
}

function createValidFixture(options: FixtureOptions = {}) {
    const directory = mkdtempSync(path.join(tmpdir(), 'eh-post-closure-backup-verify-'));
    temporaryDirectories.push(directory);
    const artifactPath = path.join(directory, 'production.dump');
    const receiptPath = path.join(directory, 'post-closure-backup-receipt.json');
    const artifact = Buffer.from('custom-format-archive-fixture', 'utf8');
    writeFileSync(artifactPath, artifact);

    const inventory = [
        'auth.identities',
        'auth.users',
        ...POST_CLOSURE_PUBLIC_TABLES.map((table) => `public.${table}`),
        ...(options.additionalInventory ?? []),
    ].sort();
    let archiveList = inventory.map((entry, index) => {
        const [schema, table] = entry.split('.');
        return `${index + 1}; 0 0 TABLE DATA ${schema} ${table} owner`;
    }).join('\n');
    if (options.duplicateFirstInventoryEntry) {
        const [schema, table] = inventory[0].split('.');
        archiveList += `\n999; 0 0 TABLE DATA ${schema} ${table} owner`;
    }
    const destination = destinationBindingForExistingArtifact(artifactPath, process.cwd());
    const receipt = {
        ...createPostClosureBackupReceipt({
            canonicalGitSha: canonicalSha,
            productionInertEvidenceSha256: productionEvidenceSha,
            databaseStateSha256: databaseStateSha,
            destinationBindingSha256: destination.destinationBindingSha256,
            liveInventorySha256: sha256(stableJson(inventory)),
            livePublicTableCount: POST_CLOSURE_PUBLIC_TABLES.length,
            liveAuthTableCount: inventory.filter((entry) => entry.startsWith('auth.')).length,
            archiveTocEntryCount: archiveList.split('\n').length,
            artifactSha256: sha256(artifact),
            artifactBytes: statSync(artifactPath).size,
            toolVersions: {
                pgDump: 'pg_dump 17.5',
                pgRestore: 'pg_restore 17.5',
                psql: 'psql 17.5',
            },
            createdAt,
        }),
        ...(options.receiptOverrides ?? {}),
    };
    writeFileSync(receiptPath, stableJson(receipt), 'utf8');

    const runtime: PostClosureBackupVerifyRuntime = {
        verifyWindowsEfsArtifact: () => options.efsVerified ?? true,
        listArchive: () => ({
            ok: options.archiveListOk ?? true,
            stdout: archiveList,
        }),
        sha256File: async () => sha256(artifact),
    };
    return { artifactPath, receiptPath, receipt, runtime, archiveList, inventory };
}
