import { drive as driveApi } from '@googleapis/drive';
import * as dotenv from 'dotenv';
import { JWT } from 'google-auth-library';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { normalizeGooglePrivateKey } from '../../src/lib/google/private-key';
import {
    GOOGLE_PRODUCTION_CLEANUP_APPROVAL_ENV,
    GOOGLE_PRODUCTION_EXPECTED_COUNT_ENV,
    GOOGLE_PRODUCTION_EXPECTED_FINGERPRINT_ENV,
    buildGoogleProductionCleanupApproval,
    driveChildrenAggregate,
    resourceFingerprint,
    validateExpectedSnapshot,
    type DriveChildSnapshot,
} from './google-production-fixture-cleanup-shared';

type CheckStatus = 'ok' | 'failed';
type ClosureStatus = 'PLAN_READY' | 'ALREADY_CLEAN' | 'TRASHED_AND_VERIFIED' | 'PARTIAL_WRITE_STOP' | 'BLOCKED';

interface Check {
    status: CheckStatus;
    name: string;
    message: string;
    details: string[];
}

const supportedArguments = new Set(['--execute-approved']);
const unsupportedArguments = process.argv.slice(2).filter((argument) => !supportedArguments.has(argument));
if (unsupportedArguments.length > 0) throw new Error(`Unsupported argument(s): ${unsupportedArguments.join(', ')}`);

const executeRequested = process.argv.includes('--execute-approved');
const startedAt = new Date();
const outputDir = path.join(process.cwd(), 'outputs', 'launch-google-production-fixture-cleanup', stamp(startedAt));
mkdirSync(outputDir, { recursive: true });

const productionEnv = readEnv('.env');
const stagingEnv = readEnv('.env.staging');
const rootId = productionEnv.GOOGLE_DRIVE_ROOT_FOLDER_ID ?? '';
const rootFingerprint = rootId ? resourceFingerprint(rootId) : '';
const checks: Check[] = [];
let closureStatus: ClosureStatus = 'BLOCKED';
let externalWriteAttempted = false;
let externalWritePerformed = false;
let movedToTrash = 0;
let beforeChildren: DriveChildSnapshot[] = [];
let afterChildren: DriveChildSnapshot[] = [];
let approvalSentence = '';

checks.push(validateEnvironment());

if (checks.every((check) => check.status === 'ok')) {
    await inspectAndMaybeExecute();
}

const beforeAggregate = driveChildrenAggregate(beforeChildren);
const afterAggregate = driveChildrenAggregate(afterChildren);
const failed = checks.some((check) => check.status === 'failed');
if (!failed && closureStatus === 'BLOCKED') closureStatus = executeRequested ? 'TRASHED_AND_VERIFIED' : 'PLAN_READY';
if (failed && externalWritePerformed) closureStatus = 'PARTIAL_WRITE_STOP';
const status = failed ? 'FAILED' : 'OK';

const report = {
    schemaVersion: 1,
    startedAt: startedAt.toISOString(),
    endedAt: new Date().toISOString(),
    status,
    closureStatus,
    environment: 'production',
    envFile: '.env',
    root: {
        idFingerprintSha256: rootFingerprint,
        rawIdPersisted: false,
    },
    executeRequested,
    externalWriteAttempted,
    externalWritePerformed,
    movedToTrash,
    permanentlyDeleted: 0 as const,
    before: beforeAggregate,
    after: afterAggregate,
    approval: {
        environmentVariable: GOOGLE_PRODUCTION_CLEANUP_APPROVAL_ENV,
        expectedCountEnvironmentVariable: GOOGLE_PRODUCTION_EXPECTED_COUNT_ENV,
        expectedFingerprintEnvironmentVariable: GOOGLE_PRODUCTION_EXPECTED_FINGERPRINT_ENV,
        requiredFlag: '--execute-approved',
        exactSentence: approvalSentence,
    },
    checks,
    forbiddenScope: [
        'permanent deletion or emptying Google Drive trash',
        'the production Drive root folder itself',
        'the template document or permissions',
        'Calendar events or FreeBusy writes',
        'staging Google resources',
        'Supabase, Stripe, Resend, Cloudflare, DNS or domains',
    ],
};

writeFileSync(path.join(outputDir, 'summary.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
writeFileSync(path.join(outputDir, 'summary.md'), renderSummary(report), 'utf8');
writeFileSync(path.join(outputDir, 'approval-gate.md'), renderApprovalGate(report), 'utf8');
if (closureStatus === 'TRASHED_AND_VERIFIED') {
    const policyEvidence = {
        schemaVersion: 1,
        environment: 'production',
        status: 'TRASHED_AND_VERIFIED',
        completedAt: report.endedAt,
        observedActiveRootChildrenBefore: beforeAggregate.total,
        observedFoldersBefore: beforeAggregate.folders,
        activeRootChildrenAfter: afterAggregate.total,
        permanentlyDeleted: 0,
        rootIdStored: false,
    } as const;
    writeFileSync(
        path.join(outputDir, 'google-fixture-policy-evidence.json'),
        `${JSON.stringify(policyEvidence, null, 2)}\n`,
        'utf8',
    );
}

console.log(`[launch:google-production-fixture-cleanup] Status: ${status}`);
console.log(`[launch:google-production-fixture-cleanup] Closure: ${closureStatus}`);
console.log(`[launch:google-production-fixture-cleanup] Before: ${beforeAggregate.total}`);
console.log(`[launch:google-production-fixture-cleanup] After: ${afterAggregate.total}`);
console.log(`[launch:google-production-fixture-cleanup] External write attempted: ${String(externalWriteAttempted)}`);
console.log(`[launch:google-production-fixture-cleanup] Summary: ${path.join(outputDir, 'summary.md')}`);

if (failed) process.exit(1);

async function inspectAndMaybeExecute(): Promise<void> {
    const auth = new JWT({
        email: productionEnv.GOOGLE_SERVICE_ACCOUNT_EMAIL,
        key: normalizeGooglePrivateKey(productionEnv.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY!),
        scopes: ['https://www.googleapis.com/auth/drive'],
        subject: productionEnv.GOOGLE_ADMIN_EMAIL,
    });
    const drive = driveApi({ version: 'v3', auth });

    try {
        await auth.authorize();
        checks.push(ok('production_google_auth', 'Production Google DWD authorization succeeded.', [
            `admin=${maskEmail(productionEnv.GOOGLE_ADMIN_EMAIL)}`,
            'scope=drive',
        ]));
    } catch (error) {
        checks.push(fail('production_google_auth', 'Production Google DWD authorization failed.', [safeError(error)]));
        return;
    }

    try {
        const root = await drive.files.get({
            fileId: rootId,
            supportsAllDrives: true,
            fields: 'id,name,mimeType,trashed,capabilities(canEdit,canAddChildren)',
        });
        const valid = root.data.id === rootId
            && root.data.mimeType === 'application/vnd.google-apps.folder'
            && root.data.trashed !== true
            && root.data.capabilities?.canEdit === true;
        checks.push(valid
            ? ok('exact_production_root', 'The exact production Drive root is active, editable and distinct from staging.', [
                `rootFingerprint=${rootFingerprint}`,
                `name=${safeLabel(root.data.name)}`,
                'mime=application/vnd.google-apps.folder',
                'rawIdPersisted=false',
            ])
            : fail('exact_production_root', 'The production Drive root does not have the required safe shape.', [
                `rootFingerprint=${rootFingerprint}`,
                `mime=${root.data.mimeType ?? 'missing'}`,
                `trashed=${String(root.data.trashed)}`,
                `canEdit=${String(root.data.capabilities?.canEdit)}`,
            ]));
        if (!valid) return;
    } catch (error) {
        checks.push(fail('exact_production_root', 'The exact production Drive root could not be read.', [safeError(error)]));
        return;
    }

    beforeChildren = await listActiveDirectChildren(drive, rootId);
    const before = driveChildrenAggregate(beforeChildren);
    approvalSentence = buildGoogleProductionCleanupApproval({
        rootFingerprint,
        childCount: before.total,
        childFingerprint: before.fingerprintSha256,
    });
    checks.push(ok('active_children_snapshot', 'Active direct children were read without persisting names, owners or raw IDs.', [
        `count=${before.total}`,
        `folders=${before.folders}`,
        `nonFolders=${before.nonFolders}`,
        `oldestCreatedAt=${before.oldestCreatedAt ?? 'none'}`,
        `newestCreatedAt=${before.newestCreatedAt ?? 'none'}`,
        `fingerprintSha256=${before.fingerprintSha256}`,
    ]));

    if (before.total === 0) {
        afterChildren = [];
        closureStatus = 'ALREADY_CLEAN';
        checks.push(ok('already_clean', 'The production Drive root already has zero active direct children.', [
            'externalWriteAttempted=false',
        ]));
        return;
    }

    if (before.nonFolders !== 0) {
        checks.push(fail('folder_only_gate', 'The cleanup refuses a snapshot containing non-folder direct children.', [
            `nonFolders=${before.nonFolders}`,
            'externalWriteAttempted=false',
        ]));
        return;
    }

    if (!executeRequested) {
        afterChildren = beforeChildren;
        closureStatus = 'PLAN_READY';
        checks.push(ok('plan_mode_read_only', 'Plan mode performed Google reads only.', [
            'externalWriteAttempted=false',
            `approvalEnv=${GOOGLE_PRODUCTION_CLEANUP_APPROVAL_ENV}`,
        ]));
        return;
    }

    const snapshotErrors = validateExpectedSnapshot({
        aggregate: before,
        expectedCount: process.env[GOOGLE_PRODUCTION_EXPECTED_COUNT_ENV],
        expectedFingerprint: process.env[GOOGLE_PRODUCTION_EXPECTED_FINGERPRINT_ENV],
    });
    const approvalMatches = process.env[GOOGLE_PRODUCTION_CLEANUP_APPROVAL_ENV]?.trim() === approvalSentence;
    if (!approvalMatches) snapshotErrors.push(`${GOOGLE_PRODUCTION_CLEANUP_APPROVAL_ENV} does not match the exact current approval sentence`);
    checks.push(snapshotErrors.length === 0
        ? ok('exact_execution_gate', 'Approval, root and child snapshot match exactly.', [
            `count=${before.total}`,
            `fingerprintSha256=${before.fingerprintSha256}`,
        ])
        : fail('exact_execution_gate', 'Execution approval or snapshot does not match; no write may start.', snapshotErrors));
    if (snapshotErrors.length > 0) return;

    externalWriteAttempted = true;
    for (const child of beforeChildren) {
        try {
            const response = await drive.files.update({
                fileId: child.id,
                supportsAllDrives: true,
                requestBody: { trashed: true },
                fields: 'id,trashed',
            });
            if (response.data.id !== child.id || response.data.trashed !== true) {
                throw new Error('Google Drive did not attest trashed=true for the allowlisted child');
            }
            externalWritePerformed = true;
            movedToTrash += 1;
        } catch (error) {
            checks.push(fail('trash_exact_children', 'A direct child could not be moved to trash; execution stopped without permanent deletion.', [
                `movedToTrash=${movedToTrash}`,
                `remainingUnattempted=${before.total - movedToTrash - 1}`,
                safeError(error),
            ]));
            return;
        }
    }

    afterChildren = await listActiveDirectChildren(drive, rootId);
    const after = driveChildrenAggregate(afterChildren);
    const verified = movedToTrash === before.total && after.total === 0;
    checks.push(verified
        ? ok('trash_exact_children', 'All allowlisted direct folders were moved to trash and the active root is empty.', [
            `movedToTrash=${movedToTrash}`,
            'activeDirectChildrenAfter=0',
            'permanentDeletes=0',
        ])
        : fail('trash_exact_children', 'Post-write verification did not reach an empty active root.', [
            `movedToTrash=${movedToTrash}`,
            `activeDirectChildrenAfter=${after.total}`,
            'permanentDeletes=0',
        ]));
    if (verified) closureStatus = 'TRASHED_AND_VERIFIED';
}

async function listActiveDirectChildren(
    drive: ReturnType<typeof driveApi>,
    parentId: string,
): Promise<DriveChildSnapshot[]> {
    const children: DriveChildSnapshot[] = [];
    let pageToken: string | undefined;
    do {
        const response = await drive.files.list({
            q: `'${escapeDriveQuery(parentId)}' in parents and trashed = false`,
            supportsAllDrives: true,
            includeItemsFromAllDrives: true,
            pageSize: 1000,
            pageToken,
            fields: 'nextPageToken,files(id,mimeType,createdTime)',
        });
        for (const child of response.data.files ?? []) {
            if (!child.id) throw new Error('Google Drive returned a direct child without an id');
            children.push({
                id: child.id,
                mimeType: child.mimeType ?? 'unknown',
                createdTime: child.createdTime ?? 'unknown',
            });
        }
        pageToken = response.data.nextPageToken ?? undefined;
    } while (pageToken);
    return children;
}

function validateEnvironment(): Check {
    const required = [
        'GOOGLE_SERVICE_ACCOUNT_EMAIL',
        'GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY',
        'GOOGLE_ADMIN_EMAIL',
        'GOOGLE_DRIVE_ROOT_FOLDER_ID',
    ] as const;
    const missing = required.filter((key) => !productionEnv[key]);
    const stagingRoot = stagingEnv.GOOGLE_DRIVE_ROOT_FOLDER_ID;
    const rootsDistinct = Boolean(rootId && stagingRoot && rootId !== stagingRoot);
    const privateKeyShape = productionEnv.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.includes('PRIVATE KEY') === true;
    const valid = missing.length === 0 && rootsDistinct && privateKeyShape;
    return valid
        ? ok('environment_boundary', 'Production Google config is complete and its Drive root differs from staging.', [
            'productionEnv=.env',
            'stagingEnv=.env.staging',
            `rootFingerprint=${rootFingerprint}`,
            `stagingRootFingerprint=${resourceFingerprint(stagingRoot!)}`,
            'rawIdsPersisted=false',
        ])
        : fail('environment_boundary', 'Production/staging Google boundary is incomplete or unsafe.', [
            `missing=${missing.join(',') || 'none'}`,
            `rootsDistinct=${String(rootsDistinct)}`,
            `privateKeyShape=${String(privateKeyShape)}`,
            'externalWriteAttempted=false',
        ]);
}

function readEnv(filePath: string): Record<string, string> {
    return dotenv.parse(readFileSync(filePath));
}

function renderSummary(value: typeof report): string {
    return `${[
        '# Google Production Fixture Cleanup',
        '',
        `- Status: ${value.status}`,
        `- Closure: ${value.closureStatus}`,
        `- Environment: ${value.environment}`,
        `- Root SHA-256: ${value.root.idFingerprintSha256}`,
        `- Execute requested: ${String(value.executeRequested)}`,
        `- External write attempted: ${String(value.externalWriteAttempted)}`,
        `- External write performed: ${String(value.externalWritePerformed)}`,
        `- Active children before: ${value.before.total}`,
        `- Active children after: ${value.after.total}`,
        `- Moved to trash: ${value.movedToTrash}`,
        `- Permanent deletes: 0`,
        '',
        '| Status | Check | Message | Details |',
        '| --- | --- | --- | --- |',
        ...value.checks.map((check) => `| ${check.status} | ${check.name} | ${escapeCell(check.message)} | ${escapeCell(check.details.join(' / '))} |`),
        '',
        'No child names, owners or raw file IDs are persisted. Moving a folder to Google Drive trash is recoverable until the account trash retention/purge policy removes it; this runner never empties trash.',
        '',
    ].join('\n')}\n`;
}

function renderApprovalGate(value: typeof report): string {
    return `${[
        '# Google Production Fixture Cleanup Approval Gate',
        '',
        'This file is not approval.',
        '',
        `- Root SHA-256: \`${value.root.idFingerprintSha256}\`.`,
        `- Exact active direct children: \`${value.before.total}\`.`,
        `- Children snapshot SHA-256: \`${value.before.fingerprintSha256}\`.`,
        `- Required flag: \`--execute-approved\`.`,
        `- Required count env: \`${GOOGLE_PRODUCTION_EXPECTED_COUNT_ENV}=${value.before.total}\`.`,
        `- Required fingerprint env: \`${GOOGLE_PRODUCTION_EXPECTED_FINGERPRINT_ENV}=${value.before.fingerprintSha256}\`.`,
        `- Required approval env: \`${GOOGLE_PRODUCTION_CLEANUP_APPROVAL_ENV}\`.`,
        '',
        '## Exact Approval Sentence',
        '',
        value.approval.exactSentence || '<unavailable until a valid read-only snapshot exists>',
        '',
        'Execution is folder-only, direct-child-only and trash-only. Any count, fingerprint, root, environment or approval drift blocks all writes.',
        '',
    ].join('\n')}\n`;
}

function ok(name: string, message: string, details: string[]): Check {
    return { status: 'ok', name, message, details };
}

function fail(name: string, message: string, details: string[]): Check {
    return { status: 'failed', name, message, details };
}

function escapeDriveQuery(value: string): string {
    return value.replaceAll('\\', '\\\\').replaceAll("'", "\\'");
}

function maskEmail(value: string | undefined): string {
    if (!value?.includes('@')) return value ? 'present_unrecognized' : 'missing';
    const [local, domain] = value.split('@');
    return `${local.slice(0, 1)}***@${domain}`;
}

function safeLabel(value: string | null | undefined): string {
    return (value ?? 'missing').replace(/\r?\n/gu, ' ').replace(/\|/gu, '/').slice(0, 80);
}

function safeError(error: unknown): string {
    let message = error instanceof Error ? error.message : String(error);
    for (const sensitiveValue of [
        productionEnv.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY,
        productionEnv.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(/\\n/gu, '\n'),
        rootId,
        stagingEnv.GOOGLE_DRIVE_ROOT_FOLDER_ID,
        ...beforeChildren.map((child) => child.id),
    ]) {
        if (sensitiveValue) message = message.replaceAll(sensitiveValue, '[redacted]');
    }
    return message
        .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu, '[redacted-email]')
        .replace(/Bearer\s+[A-Za-z0-9._-]{12,}/giu, 'Bearer [redacted]')
        .replace(/\r?\n/gu, ' ')
        .slice(0, 500);
}

function escapeCell(value: string): string {
    return value.replace(/\|/gu, '\\|').replace(/\r?\n/gu, ' ');
}

function stamp(date: Date): string {
    return date.toISOString().replace(/[:.]/gu, '-');
}
