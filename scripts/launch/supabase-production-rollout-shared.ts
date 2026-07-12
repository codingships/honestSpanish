import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

export const PRODUCTION_PROJECT = {
    environment: 'production' as const,
    name: 'espanol-honesto',
    ref: 'vkkahxsybhbutszerawz',
    region: 'eu-west-1',
    envFile: '.env',
};

export const PROCESSED_AT_VERSION = '20260703211451';
export const MODEL_RECONCILIATION_VERSION = '20260712112000';
export const STAGING_ONLY_VERSION = '20260710150000';

export const KNOWN_MIGRATION_WAVES = [
    {
        id: 'processed_at_small_fix',
        label: 'Correccion minima de processed_at',
        versions: [PROCESSED_AT_VERSION],
        destructive: false,
        requiresBackupEvidence: false,
        requiresPreservationPolicy: false,
    },
    {
        id: 'base_model_reconciliation',
        label: 'Reconciliacion del contrato base del modelo',
        versions: [MODEL_RECONCILIATION_VERSION],
        destructive: false,
        requiresBackupEvidence: true,
        requiresPreservationPolicy: false,
    },
    {
        id: 'application_schema',
        label: 'Esquema de solicitud, CRM y diagnostico',
        versions: [
            '018',
            '019',
            '020',
            '20260624163423',
            '20260624185757',
            '20260625213116',
            '20260625215008',
        ],
        destructive: false,
        requiresBackupEvidence: true,
        requiresPreservationPolicy: false,
    },
    {
        id: 'runtime_and_policy',
        label: 'Runtime, presupuesto de email y politicas de cuenta',
        versions: [
            '20260710083915',
            '20260710120000',
            '20260710123000',
            '20260710130000',
            '20260710133000',
            '20260710143000',
            '20260710144000',
        ],
        destructive: false,
        requiresBackupEvidence: true,
        requiresPreservationPolicy: false,
    },
    {
        id: 'billing_contract',
        label: 'Contrato de catalogo, checkout y billing',
        versions: [
            '20260710205031',
            '20260710215712',
            '20260710221846',
            '20260710223900',
        ],
        destructive: false,
        requiresBackupEvidence: true,
        requiresPreservationPolicy: true,
    },
    {
        id: 'fulfillment_ledger',
        label: 'Ledger durable de efectos de fulfillment',
        versions: ['20260711192817'],
        destructive: false,
        requiresBackupEvidence: true,
        requiresPreservationPolicy: false,
    },
    {
        id: 'deferred_rc_hardening',
        label: 'Hardening de solapes de disponibilidad y politica 18+',
        versions: [
            '20260712114000',
            '20260712114500',
        ],
        destructive: false,
        requiresBackupEvidence: true,
        requiresPreservationPolicy: false,
    },
] as const;

export interface LocalMigration {
    order: number;
    version: string;
    name: string;
    file: string;
    sha256: string;
    bytes: number;
    stagingOnly: boolean;
    plannedWave: string | null;
}

export interface RemoteMigration {
    version: string;
    name: string;
}

export type MigrationHistoryStatus = 'exact' | 'alias' | 'missing' | 'ambiguous';

export interface MigrationHistoryMapping extends LocalMigration {
    historyStatus: MigrationHistoryStatus;
    remoteVersions: string[];
    versionNameMismatch: boolean;
    duplicateSemanticHistory: boolean;
}

export function collectLocalMigrations(root = process.cwd()): LocalMigration[] {
    const migrationsDir = path.join(root, 'supabase', 'migrations');
    if (!existsSync(migrationsDir)) return [];

    return readdirSync(migrationsDir, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
        .map((entry) => entry.name)
        .sort((left, right) => left.localeCompare(right, 'en'))
        .map((fileName, index) => {
            const parsed = parseMigrationFileName(fileName);
            const absolutePath = path.join(migrationsDir, fileName);
            const content = readFileSync(absolutePath, 'utf8');
            return {
                order: index + 1,
                version: parsed.version,
                name: parsed.name,
                file: toPosix(path.relative(root, absolutePath)),
                sha256: sha256(content),
                bytes: Buffer.byteLength(content, 'utf8'),
                stagingOnly: parsed.version === STAGING_ONLY_VERSION,
                plannedWave: waveForVersion(parsed.version),
            };
        });
}

export function parseMigrationFileName(fileName: string): { version: string; name: string } {
    const match = fileName.match(/^([^_]+)_(.+)\.sql$/u);
    if (!match) {
        return {
            version: fileName.replace(/\.sql$/u, ''),
            name: '',
        };
    }

    return {
        version: match[1],
        name: match[2],
    };
}

export function mapMigrationHistory(
    localMigrations: LocalMigration[],
    remoteMigrations: RemoteMigration[],
): MigrationHistoryMapping[] {
    return localMigrations.map((migration) => {
        const exactMatches = remoteMigrations.filter((remote) => remote.version === migration.version);
        const nameMatches = remoteMigrations.filter((remote) => normalizeMigrationName(remote.name) === normalizeMigrationName(migration.name));
        const remoteMatches = uniqueRemoteMigrations([...exactMatches, ...nameMatches]);
        const versionNameMismatch = exactMatches.some((remote) => (
            normalizeMigrationName(remote.name) !== normalizeMigrationName(migration.name)
        ));

        let historyStatus: MigrationHistoryStatus;
        if (exactMatches.length === 1) {
            historyStatus = 'exact';
        } else if (remoteMatches.length === 1) {
            historyStatus = 'alias';
        } else if (remoteMatches.length > 1 || exactMatches.length > 1) {
            historyStatus = 'ambiguous';
        } else {
            historyStatus = 'missing';
        }

        return {
            ...migration,
            historyStatus,
            remoteVersions: remoteMatches.map((remote) => remote.version).sort(),
            versionNameMismatch,
            duplicateSemanticHistory: remoteMatches.length > 1,
        };
    });
}

export function waveForVersion(version: string): string | null {
    return KNOWN_MIGRATION_WAVES.find((wave) => wave.versions.includes(version as never))?.id ?? null;
}

export function normalizeMigrationName(value: string): string {
    return value
        .trim()
        .replace(/\.sql$/u, '')
        .replace(/^\d+_/u, '')
        .replace(/[-\s]+/gu, '_')
        .replace(/_+/gu, '_')
        .toLowerCase();
}

export function sha256(value: string): string {
    return createHash('sha256').update(value).digest('hex');
}

export function stableJson(value: unknown): string {
    return `${JSON.stringify(value, null, 2)}\n`;
}

export function toPosix(filePath: string): string {
    return filePath.split(path.sep).join('/');
}

function uniqueRemoteMigrations(migrations: RemoteMigration[]): RemoteMigration[] {
    const seen = new Set<string>();
    return migrations.filter((migration) => {
        const key = `${migration.version}\u0000${migration.name}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}
