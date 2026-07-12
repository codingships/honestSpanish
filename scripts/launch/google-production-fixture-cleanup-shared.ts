import { createHash } from 'node:crypto';

export const GOOGLE_PRODUCTION_CLEANUP_APPROVAL_ENV = 'GOOGLE_PRODUCTION_DRIVE_FIXTURE_CLEANUP_APPROVAL';
export const GOOGLE_PRODUCTION_EXPECTED_COUNT_ENV = 'GOOGLE_PRODUCTION_DRIVE_EXPECTED_COUNT';
export const GOOGLE_PRODUCTION_EXPECTED_FINGERPRINT_ENV = 'GOOGLE_PRODUCTION_DRIVE_EXPECTED_FINGERPRINT';

export interface DriveChildSnapshot {
    id: string;
    mimeType: string;
    createdTime: string;
}

export interface DriveChildrenAggregate {
    total: number;
    folders: number;
    nonFolders: number;
    oldestCreatedAt: string | null;
    newestCreatedAt: string | null;
    fingerprintSha256: string;
}

export function driveChildrenAggregate(children: DriveChildSnapshot[]): DriveChildrenAggregate {
    const normalized = children
        .map((child) => ({
            id: child.id.trim(),
            mimeType: child.mimeType.trim() || 'unknown',
            createdTime: child.createdTime.trim() || 'unknown',
        }))
        .sort((left, right) => (
            left.id.localeCompare(right.id)
            || left.mimeType.localeCompare(right.mimeType)
            || left.createdTime.localeCompare(right.createdTime)
        ));
    const timestamps = normalized
        .map((child) => child.createdTime)
        .filter((value) => value !== 'unknown')
        .sort();
    const folders = normalized.filter((child) => child.mimeType === 'application/vnd.google-apps.folder').length;

    return {
        total: normalized.length,
        folders,
        nonFolders: normalized.length - folders,
        oldestCreatedAt: timestamps[0] ?? null,
        newestCreatedAt: timestamps.at(-1) ?? null,
        fingerprintSha256: createHash('sha256').update(JSON.stringify(normalized), 'utf8').digest('hex'),
    };
}

export function resourceFingerprint(value: string): string {
    return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function buildGoogleProductionCleanupApproval(input: {
    rootFingerprint: string;
    childCount: number;
    childFingerprint: string;
}): string {
    return `Autorizo mover a la papelera, sin borrado permanente, unicamente los ${input.childCount} hijos directos activos de la carpeta raiz de Google Drive de produccion cuya huella SHA-256 es \`${input.rootFingerprint}\`, siempre que la huella agregada exacta de esos hijos siga siendo \`${input.childFingerprint}\`; autorizo la verificacion read-only posterior. No autorizo tocar la carpeta raiz, la plantilla, permisos, Calendar, staging, Supabase, Stripe, Resend, Cloudflare, DNS, dominios ni otros archivos.`;
}

export function validateExpectedSnapshot(input: {
    aggregate: DriveChildrenAggregate;
    expectedCount: string | undefined;
    expectedFingerprint: string | undefined;
}): string[] {
    const errors: string[] = [];
    const parsedCount = Number(input.expectedCount);
    if (!input.expectedCount || !Number.isSafeInteger(parsedCount) || parsedCount < 1) {
        errors.push(`${GOOGLE_PRODUCTION_EXPECTED_COUNT_ENV} must be a positive integer`);
    } else if (parsedCount !== input.aggregate.total) {
        errors.push(`expected child count ${parsedCount} does not match current count ${input.aggregate.total}`);
    }
    if (!input.expectedFingerprint || !/^[a-f0-9]{64}$/u.test(input.expectedFingerprint)) {
        errors.push(`${GOOGLE_PRODUCTION_EXPECTED_FINGERPRINT_ENV} must be a lowercase SHA-256 fingerprint`);
    } else if (input.expectedFingerprint !== input.aggregate.fingerprintSha256) {
        errors.push('expected child fingerprint does not match the current Drive snapshot');
    }
    if (input.aggregate.nonFolders !== 0) {
        errors.push(`current Drive snapshot contains ${input.aggregate.nonFolders} non-folder direct children`);
    }
    return errors;
}
