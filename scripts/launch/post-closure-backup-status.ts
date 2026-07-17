import {
    existsSync,
    readFileSync,
    readdirSync,
} from 'node:fs';
import path from 'node:path';
import {
    POST_CLOSURE_BACKUP_STATUS,
    type PostClosureBackupReceipt,
    validatePostClosureBackupReceipt,
} from './supabase-production-post-closure-backup';
import {
    sha256,
    stableJson,
} from './production-fixture-cleanup-shared';

export type PostClosureBackupTechnicalClosureStatus = 'pending' | 'verified' | 'invalid';

export interface PostClosureBackupTechnicalClosure {
    status: PostClosureBackupTechnicalClosureStatus;
    reason: string;
    canonicalGitSha: string | null;
    receiptSha256: string | null;
    artifactSha256: string | null;
    evidencePath: string | null;
    isFinalGate: false;
}

const BACKUP_OUTPUT_DIRECTORY = 'launch-supabase-production-post-closure-backup';
const SUMMARY_FILE = 'summary.json';
const RECEIPT_FILE = 'post-closure-backup-receipt.json';
const PLAN_ONLY_STATUS = 'PLAN_ONLY_READY';
const ATTEMPT_DIRECTORY_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/u;

const EXECUTION_SUMMARY_KEYS = [
    'status',
    'targetProjectRef',
    'canonicalGitSha',
    'productionInertEvidenceSha256',
    'databaseStateSha256',
    'tableContractSha256',
    'destinationBindingSha256',
    'liveInventorySha256',
    'livePublicTableCount',
    'liveAuthTableCount',
    'stableProductionInertRowStateReadbacks',
    'liveAuthConfigurationReadbacks',
    'productionInertEvidenceRevalidatedAtEnd',
    'archiveTocEntryCount',
    'artifactSha256',
    'receiptSha256',
    'receiptFile',
    'artifactPathRecorded',
    'restoreValidation',
    'restorePerformed',
    'networkAccessPerformed',
    'databaseWritePerformed',
    'externalServiceWritePerformed',
    'localBackupWritten',
].sort();

const SUMMARY_RECEIPT_BINDINGS: ReadonlyArray<keyof PostClosureBackupReceipt> = [
    'status',
    'targetProjectRef',
    'canonicalGitSha',
    'productionInertEvidenceSha256',
    'databaseStateSha256',
    'tableContractSha256',
    'destinationBindingSha256',
    'liveInventorySha256',
    'livePublicTableCount',
    'liveAuthTableCount',
    'archiveTocEntryCount',
    'artifactSha256',
];

export function assessPostClosureBackupTechnicalClosure(
    outputsRoot: string,
    now = new Date(),
): PostClosureBackupTechnicalClosure {
    const attemptsRoot = path.join(outputsRoot, BACKUP_OUTPUT_DIRECTORY);
    if (!existsSync(attemptsRoot)) return pendingAssessment();

    let attemptDirectories: string[];
    try {
        attemptDirectories = readdirSync(attemptsRoot, { withFileTypes: true })
            .filter((entry) => entry.isDirectory() && ATTEMPT_DIRECTORY_PATTERN.test(entry.name))
            .map((entry) => path.join(attemptsRoot, entry.name))
            .sort((left, right) => path.basename(right).localeCompare(path.basename(left)));
    } catch {
        return invalidAssessment(
            'The post-closure backup attempt history could not be read.',
            attemptsRoot,
        );
    }

    for (const attemptDirectory of attemptDirectories) {
        const summaryPath = path.join(attemptDirectory, SUMMARY_FILE);
        if (!existsSync(summaryPath)) {
            return invalidAssessment(
                'The latest real post-closure backup attempt is incomplete because summary.json is missing.',
                attemptDirectory,
            );
        }

        const summaryRead = readCanonicalJson(summaryPath);
        if (!summaryRead.ok) {
            return invalidAssessment(
                'The latest post-closure backup attempt has a non-canonical or invalid summary.json.',
                summaryPath,
            );
        }
        if (!isRecord(summaryRead.value)) {
            return invalidAssessment(
                'The latest post-closure backup attempt summary must be a JSON object.',
                summaryPath,
            );
        }

        const summary = summaryRead.value;
        if (summary.status === PLAN_ONLY_STATUS) continue;

        return assessRealAttempt(attemptDirectory, summaryPath, summary, now);
    }

    return pendingAssessment();
}

function assessRealAttempt(
    attemptDirectory: string,
    summaryPath: string,
    summary: Record<string, unknown>,
    now: Date,
): PostClosureBackupTechnicalClosure {
    if (summary.status !== POST_CLOSURE_BACKUP_STATUS) {
        return invalidAssessment(
            `The latest real post-closure backup attempt has non-success status ${displayStatus(summary.status)}.`,
            summaryPath,
        );
    }
    if (stableJson(Object.keys(summary).sort()) !== stableJson(EXECUTION_SUMMARY_KEYS)) {
        return invalidAssessment(
            'The latest real post-closure backup summary field set does not match the execution contract.',
            summaryPath,
        );
    }
    if (summary.receiptFile !== RECEIPT_FILE) {
        return invalidAssessment(
            'The latest real post-closure backup summary does not name the canonical receipt file.',
            summaryPath,
        );
    }

    const receiptPath = path.join(attemptDirectory, RECEIPT_FILE);
    if (!existsSync(receiptPath)) {
        return invalidAssessment(
            'The latest real post-closure backup attempt is missing its bound receipt.',
            summaryPath,
        );
    }
    const receiptRead = readCanonicalJson(receiptPath);
    if (!receiptRead.ok) {
        return invalidAssessment(
            'The latest real post-closure backup receipt is non-canonical or invalid JSON.',
            summaryPath,
        );
    }

    const receiptErrors = validatePostClosureBackupReceipt(receiptRead.value, now);
    if (receiptErrors.length > 0 || !isRecord(receiptRead.value)) {
        return invalidAssessment(
            'The latest real post-closure backup receipt does not satisfy the receipt contract.',
            summaryPath,
        );
    }
    const receipt = receiptRead.value as unknown as PostClosureBackupReceipt;
    const computedReceiptSha256 = sha256(receiptRead.raw);

    if (summary.receiptSha256 !== computedReceiptSha256) {
        return invalidAssessment(
            'The latest real post-closure backup summary does not bind the canonical receipt SHA-256.',
            summaryPath,
        );
    }
    if (SUMMARY_RECEIPT_BINDINGS.some((key) => summary[key] !== receipt[key])) {
        return invalidAssessment(
            'The latest real post-closure backup summary and receipt bindings differ.',
            summaryPath,
        );
    }
    if (summary.stableProductionInertRowStateReadbacks !== receipt.stableProductionInertRowStateReadbacks
        || summary.liveAuthConfigurationReadbacks !== receipt.liveAuthConfigurationReadbacks) {
        return invalidAssessment(
            'The latest real post-closure backup readback counts differ from the receipt.',
            summaryPath,
        );
    }
    if (summary.productionInertEvidenceRevalidatedAtEnd !== true
        || summary.artifactPathRecorded !== false
        || summary.restoreValidation !== receipt.restoreValidation
        || summary.restorePerformed !== false
        || summary.networkAccessPerformed !== true
        || summary.databaseWritePerformed !== false
        || summary.externalServiceWritePerformed !== false
        || summary.localBackupWritten !== true) {
        return invalidAssessment(
            'The latest real post-closure backup summary does not prove the exact no-write/local-backup safety flags.',
            summaryPath,
        );
    }

    return {
        status: 'verified',
        reason: 'The latest real post-closure backup attempt has a canonical, valid and exactly bound summary and receipt.',
        canonicalGitSha: receipt.canonicalGitSha,
        receiptSha256: computedReceiptSha256,
        artifactSha256: receipt.artifactSha256,
        evidencePath: summaryPath,
        isFinalGate: false,
    };
}

function readCanonicalJson(filePath: string):
    | { ok: true; value: unknown; raw: string }
    | { ok: false } {
    try {
        const raw = readFileSync(filePath, 'utf8');
        const value = JSON.parse(raw) as unknown;
        if (raw !== stableJson(value)) return { ok: false };
        return { ok: true, value, raw };
    } catch {
        return { ok: false };
    }
}

function pendingAssessment(): PostClosureBackupTechnicalClosure {
    return {
        status: 'pending',
        reason: 'No real post-closure backup attempt exists; plan-only attempts do not satisfy technical closure.',
        canonicalGitSha: null,
        receiptSha256: null,
        artifactSha256: null,
        evidencePath: null,
        isFinalGate: false,
    };
}

function invalidAssessment(reason: string, evidencePath: string): PostClosureBackupTechnicalClosure {
    return {
        status: 'invalid',
        reason,
        canonicalGitSha: null,
        receiptSha256: null,
        artifactSha256: null,
        evidencePath,
        isFinalGate: false,
    };
}

function displayStatus(value: unknown): string {
    if (typeof value !== 'string' || value.length === 0 || value.length > 100) return 'UNKNOWN';
    return value.replace(/[^A-Z0-9_-]/giu, '_');
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
