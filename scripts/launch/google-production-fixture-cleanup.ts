import { drive as driveApi } from '@googleapis/drive';
import * as dotenv from 'dotenv';
import { JWT } from 'google-auth-library';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { normalizeGooglePrivateKey } from '../../src/lib/google/private-key';
import {
    GOOGLE_PRODUCTION_CLEANUP_APPROVAL_ENV,
    GOOGLE_PRODUCTION_EXPECTED_COUNT_ENV,
    GOOGLE_PRODUCTION_EXPECTED_FINGERPRINT_ENV,
    GOOGLE_PRODUCTION_FIXTURE_BASELINE_COUNT,
    GOOGLE_PRODUCTION_RECOVERY_DIR_ENV,
    advanceGoogleProductionCleanupRecoveryState,
    buildGoogleFixturePolicyEvidence,
    buildGoogleProductionCleanupApproval,
    buildGoogleProductionCleanupRecoveryState,
    driveChildIdentityFingerprint,
    driveChildrenAggregate,
    evaluateGoogleProductionCleanupRecoverySnapshot,
    isGoogleProductionCleanupRecoveryState,
    reconcileGoogleProductionCleanupRecoveryState,
    resourceFingerprint,
    validateGoogleProductionRecoveryApproval,
    validateGoogleProductionRecoveryDirectory,
    validateExpectedSnapshot,
    type DriveChildSnapshot,
    type GoogleProductionCleanupRecoveryState,
} from './google-production-fixture-cleanup-shared';

type CheckStatus = 'ok' | 'failed';
type ClosureStatus = 'PLAN_READY'
    | 'RECOVERY_PLAN_READY'
    | 'TRASHED_AND_VERIFIED'
    | 'PARTIAL_WRITE_STOP'
    | 'PARTIAL_STATE_UNATTESTED'
    | 'ALREADY_CLEAN_UNATTESTED'
    | 'BLOCKED';

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
const outputRoot = path.join(process.cwd(), 'outputs', 'launch-google-production-fixture-cleanup');
const outputDir = path.join(outputRoot, stamp(startedAt));
const recoveryDirectoryValidation = validateGoogleProductionRecoveryDirectory(
    process.env[GOOGLE_PRODUCTION_RECOVERY_DIR_ENV],
    process.cwd(),
);
const recoveryStateDir = recoveryDirectoryValidation.resolvedPath ?? '';
mkdirSync(outputDir, { recursive: true });

const productionEnv = readEnv('.env');
const stagingEnv = readEnv('.env.staging');
const rootId = productionEnv.GOOGLE_DRIVE_ROOT_FOLDER_ID ?? '';
const rootFingerprint = rootId ? resourceFingerprint(rootId) : '';
const checks: Check[] = [];
let closureStatus: ClosureStatus = 'BLOCKED';
let externalWriteAttempted = false;
let externalWritePerformed = false;
let movedToTrashThisRun = 0;
let movedToTrashReconciled = 0;
let beforeChildren: DriveChildSnapshot[] = [];
let afterChildren: DriveChildSnapshot[] = [];
let approvalSentence = '';
let approvalExpectedCount = 0;
let approvalExpectedFingerprint = '';
let terminalRecoveryState: GoogleProductionCleanupRecoveryState | null = null;
let recoveredAfterInterruptedRun = false;
let recoveryStateLoaded = false;
let recoveryStateSequence: number | null = null;

checks.push(validateEnvironment());

if (checks.every((check) => check.status === 'ok')) {
    await inspectAndMaybeExecute();
}

const beforeAggregate = driveChildrenAggregate(beforeChildren);
const afterAggregate = driveChildrenAggregate(afterChildren);
if (closureStatus === 'BLOCKED' && checks.every((check) => check.status === 'ok')) {
    checks.push(fail('terminal_state_missing', 'The runner did not reach a defined terminal state.', [
        'externalWriteAttempted=false_or_recovery_state_preserved',
    ]));
}
const failed = checks.some((check) => check.status === 'failed');
if (failed && externalWritePerformed) closureStatus = 'PARTIAL_WRITE_STOP';
const status = failed ? 'FAILED' : 'OK';
const endedAt = new Date();

const report = {
    schemaVersion: 1,
    startedAt: startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
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
    movedToTrashThisRun,
    movedToTrashReconciled,
    permanentlyDeleted: 0 as const,
    before: beforeAggregate,
    after: afterAggregate,
    approval: {
        environmentVariable: GOOGLE_PRODUCTION_CLEANUP_APPROVAL_ENV,
        expectedCountEnvironmentVariable: GOOGLE_PRODUCTION_EXPECTED_COUNT_ENV,
        expectedFingerprintEnvironmentVariable: GOOGLE_PRODUCTION_EXPECTED_FINGERPRINT_ENV,
        requiredFlag: '--execute-approved',
        expectedCount: approvalExpectedCount,
        expectedFingerprintSha256: approvalExpectedFingerprint,
        exactSentence: approvalSentence,
    },
    recovery: {
        durableWriteAheadEnabled: recoveryDirectoryValidation.valid,
        directoryEnvironmentVariable: GOOGLE_PRODUCTION_RECOVERY_DIR_ENV,
        explicitDirectoryConfigured: recoveryDirectoryValidation.valid,
        directoryOutsideRepository: recoveryDirectoryValidation.valid,
        stateLoaded: recoveryStateLoaded,
        stateSequence: recoveryStateSequence,
        stateStatus: terminalRecoveryState?.status ?? null,
        recoveredAfterInterruptedRun,
        rawIdsPersisted: false,
        receiptConsumableByProductionRollout: closureStatus === 'TRASHED_AND_VERIFIED',
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
    if (!terminalRecoveryState) throw new Error('TRASHED_AND_VERIFIED requires a durable terminal recovery state.');
    const policyEvidence = buildGoogleFixturePolicyEvidence({
        state: terminalRecoveryState,
        currentChildren: afterChildren,
        completedAt: endedAt,
        recoveredAfterInterruptedRun,
    });
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

    try {
        beforeChildren = await listActiveDirectChildren(drive, rootId);
    } catch (error) {
        checks.push(fail('active_children_snapshot', 'Active direct children could not be read.', [safeError(error)]));
        return;
    }
    const before = driveChildrenAggregate(beforeChildren);
    checks.push(ok('active_children_snapshot', 'Active direct children were read without persisting names, owners or raw IDs.', [
        `count=${before.total}`,
        `folders=${before.folders}`,
        `nonFolders=${before.nonFolders}`,
        `oldestCreatedAt=${before.oldestCreatedAt ?? 'none'}`,
        `newestCreatedAt=${before.newestCreatedAt ?? 'none'}`,
        `fingerprintSha256=${before.fingerprintSha256}`,
    ]));

    if (before.nonFolders !== 0) {
        checks.push(fail('folder_only_gate', 'The cleanup refuses a snapshot containing non-folder direct children.', [
            `nonFolders=${before.nonFolders}`,
            'externalWriteAttempted=false',
        ]));
        return;
    }

    const loadedRecovery = loadDurableRecoveryState();
    if (loadedRecovery.errors.length > 0) {
        checks.push(fail('durable_recovery_state', 'Durable Google cleanup recovery state is invalid; writes and receipts are blocked.', loadedRecovery.errors));
        return;
    }
    let recoveryState = loadedRecovery.state;
    recoveryStateLoaded = recoveryState !== null;
    recoveryStateSequence = recoveryState?.writeSequence ?? null;
    const recoveryEvaluation = evaluateGoogleProductionCleanupRecoverySnapshot({
        state: recoveryState,
        rootFingerprint,
        currentChildren: beforeChildren,
    });
    if (recoveryEvaluation.disposition === 'BLOCKED') {
        checks.push(fail('durable_recovery_state', 'Current Drive state is outside the canonical or durable recovery boundary.', recoveryEvaluation.errors));
        return;
    }
    if (recoveryState) {
        const reconciliation = recoveryEvaluation.reconciliation!;
        movedToTrashReconciled = reconciliation.movedToTrashDerived;
        recoveredAfterInterruptedRun = before.total === 0
            || (recoveryState.status === 'WRITE_IN_PROGRESS'
                && (recoveryState.writeSequence > 0 || reconciliation.movedToTrashDerived > 0));
        approvalSentence = buildGoogleProductionCleanupApproval({
            rootFingerprint,
            childCount: recoveryState.baseline.total,
            childFingerprint: recoveryState.baseline.fingerprintSha256,
        });
        approvalExpectedCount = recoveryState.baseline.total;
        approvalExpectedFingerprint = recoveryState.baseline.fingerprintSha256;
        checks.push(ok('durable_recovery_state', 'The live active-child set is an exact subset of the original approved 110-folder baseline.', [
            `stateSequence=${recoveryState.writeSequence}`,
            `activeChildren=${reconciliation.activeChildren}`,
            `movedToTrashDerived=${reconciliation.movedToTrashDerived}`,
            'rawIdsPersisted=false',
        ]));
    } else {
        if (recoveryEvaluation.disposition !== 'CAN_START_CANONICAL_BASELINE') {
            afterChildren = beforeChildren;
            closureStatus = recoveryEvaluation.disposition === 'ALREADY_CLEAN_UNATTESTED'
                ? 'ALREADY_CLEAN_UNATTESTED'
                : 'PARTIAL_STATE_UNATTESTED';
            checks.push(fail('canonical_fixture_baseline', 'A non-canonical active-child count has no durable approved 110-folder recovery baseline.', [
                `activeChildren=${before.total}`,
                `requiredBaseline=${GOOGLE_PRODUCTION_FIXTURE_BASELINE_COUNT}`,
                ...recoveryEvaluation.errors,
                'receiptEmitted=false',
                'writesBlocked=true',
            ]));
            return;
        }
        approvalSentence = buildGoogleProductionCleanupApproval({
            rootFingerprint,
            childCount: before.total,
            childFingerprint: before.fingerprintSha256,
        });
        approvalExpectedCount = before.total;
        approvalExpectedFingerprint = before.fingerprintSha256;
    }

    if (recoveryState && before.total === 0) {
        terminalRecoveryState = advanceGoogleProductionCleanupRecoveryState({
            state: recoveryState,
            currentChildren: beforeChildren,
            now: new Date(),
            markEmptyVerified: true,
        });
        persistDurableRecoveryState(terminalRecoveryState);
        recoveryStateSequence = terminalRecoveryState.writeSequence;
        movedToTrashReconciled = GOOGLE_PRODUCTION_FIXTURE_BASELINE_COUNT;
        afterChildren = [];
        closureStatus = 'TRASHED_AND_VERIFIED';
        checks.push(ok('recovered_empty_root_receipt', 'The empty production root was reconciled to the original approved baseline and can emit a fresh rollout receipt.', [
            `baseline=${GOOGLE_PRODUCTION_FIXTURE_BASELINE_COUNT}`,
            'activeDirectChildrenAfter=0',
            `recoveredAfterInterruptedRun=${String(recoveredAfterInterruptedRun)}`,
            'externalWriteAttempted=false',
        ]));
        return;
    }

    if (!executeRequested) {
        afterChildren = beforeChildren;
        closureStatus = recoveryState ? 'RECOVERY_PLAN_READY' : 'PLAN_READY';
        checks.push(ok('plan_mode_read_only', recoveryState
            ? 'Recovery plan performed Google reads only and kept the original 110-folder approval boundary.'
            : 'Plan mode performed Google reads only against the canonical 110-folder baseline.', [
            'externalWriteAttempted=false',
            `approvalEnv=${GOOGLE_PRODUCTION_CLEANUP_APPROVAL_ENV}`,
            `baseline=${GOOGLE_PRODUCTION_FIXTURE_BASELINE_COUNT}`,
        ]));
        return;
    }

    const snapshotErrors = recoveryState
        ? validateGoogleProductionRecoveryApproval({
            state: recoveryState,
            expectedCount: process.env[GOOGLE_PRODUCTION_EXPECTED_COUNT_ENV],
            expectedFingerprint: process.env[GOOGLE_PRODUCTION_EXPECTED_FINGERPRINT_ENV],
        })
        : validateExpectedSnapshot({
            aggregate: before,
            expectedCount: process.env[GOOGLE_PRODUCTION_EXPECTED_COUNT_ENV],
            expectedFingerprint: process.env[GOOGLE_PRODUCTION_EXPECTED_FINGERPRINT_ENV],
        });
    const approvalMatches = process.env[GOOGLE_PRODUCTION_CLEANUP_APPROVAL_ENV]?.trim() === approvalSentence;
    if (!approvalMatches) snapshotErrors.push(`${GOOGLE_PRODUCTION_CLEANUP_APPROVAL_ENV} does not match the exact original approval sentence`);
    checks.push(snapshotErrors.length === 0
        ? ok('exact_execution_gate', 'Approval, root and original 110-folder baseline match exactly.', [
            `currentActiveCount=${before.total}`,
            `baselineFingerprintSha256=${recoveryState?.baseline.fingerprintSha256 ?? before.fingerprintSha256}`,
        ])
        : fail('exact_execution_gate', 'Execution approval or snapshot does not match; no write may start.', snapshotErrors));
    if (snapshotErrors.length > 0) return;

    if (!recoveryState) {
        recoveryState = buildGoogleProductionCleanupRecoveryState({
            rootFingerprint,
            children: beforeChildren,
            now: new Date(),
        });
        persistDurableRecoveryState(recoveryState);
        recoveryStateSequence = recoveryState.writeSequence;
        checks.push(ok('write_ahead_baseline', 'Durable hash-only recovery baseline was persisted before the first Google write.', [
            `stateSequence=${recoveryState.writeSequence}`,
            'rawIdsPersisted=false',
        ]));
    }

    let activeChildren = [...beforeChildren];
    for (const child of beforeChildren) {
        const childFingerprint = driveChildIdentityFingerprint(child);
        recoveryState = advanceGoogleProductionCleanupRecoveryState({
            state: recoveryState,
            currentChildren: activeChildren,
            now: new Date(),
            pendingChildFingerprintSha256: childFingerprint,
        });
        persistDurableRecoveryState(recoveryState);
        recoveryStateSequence = recoveryState.writeSequence;
        externalWriteAttempted = true;
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
            movedToTrashThisRun += 1;
            activeChildren = activeChildren.filter((candidate) => candidate.id !== child.id);
            recoveryState = advanceGoogleProductionCleanupRecoveryState({
                state: recoveryState,
                currentChildren: activeChildren,
                now: new Date(),
                pendingChildFingerprintSha256: null,
            });
            persistDurableRecoveryState(recoveryState);
            recoveryStateSequence = recoveryState.writeSequence;
            movedToTrashReconciled = recoveryState.movedToTrashDerived;
        } catch (error) {
            let remainingActiveObserved: number | 'unknown' = 'unknown';
            try {
                afterChildren = await listActiveDirectChildren(drive, rootId);
                remainingActiveObserved = afterChildren.length;
                const reconciled = advanceGoogleProductionCleanupRecoveryState({
                    state: recoveryState,
                    currentChildren: afterChildren,
                    now: new Date(),
                    pendingChildFingerprintSha256: afterChildren.some((candidate) => (
                        driveChildIdentityFingerprint(candidate) === childFingerprint
                    )) ? childFingerprint : null,
                });
                persistDurableRecoveryState(reconciled);
                recoveryStateSequence = reconciled.writeSequence;
                movedToTrashReconciled = reconciled.movedToTrashDerived;
            } catch {
                // The last valid write-ahead state remains sufficient for a later live reconciliation.
            }
            checks.push(fail('trash_exact_children', 'A direct child could not be moved to trash; execution stopped without permanent deletion.', [
                `movedToTrashThisRun=${movedToTrashThisRun}`,
                `movedToTrashReconciled=${movedToTrashReconciled}`,
                `remainingActiveObserved=${remainingActiveObserved}`,
                `durableStateSequence=${recoveryStateSequence ?? 'none'}`,
                safeError(error),
            ]));
            closureStatus = 'PARTIAL_WRITE_STOP';
            return;
        }
    }

    afterChildren = await listActiveDirectChildren(drive, rootId);
    const reconciliation = reconcileGoogleProductionCleanupRecoveryState({
        state: recoveryState,
        rootFingerprint,
        currentChildren: afterChildren,
    });
    movedToTrashReconciled = reconciliation.movedToTrashDerived;
    const verified = reconciliation.valid && reconciliation.activeChildren === 0;
    checks.push(verified
        ? ok('trash_exact_children', 'All allowlisted direct folders were moved to trash and the active root is empty.', [
            `movedToTrashThisRun=${movedToTrashThisRun}`,
            `movedToTrashReconciled=${movedToTrashReconciled}`,
            'activeDirectChildrenAfter=0',
            'permanentDeletes=0',
        ])
        : fail('trash_exact_children', 'Post-write verification did not reach an empty active root.', [
            `movedToTrashThisRun=${movedToTrashThisRun}`,
            `movedToTrashReconciled=${movedToTrashReconciled}`,
            `activeDirectChildrenAfter=${reconciliation.activeChildren}`,
            ...reconciliation.errors,
            'permanentDeletes=0',
        ]));
    if (!verified) {
        closureStatus = 'PARTIAL_WRITE_STOP';
        return;
    }
    terminalRecoveryState = advanceGoogleProductionCleanupRecoveryState({
        state: recoveryState,
        currentChildren: afterChildren,
        now: new Date(),
        markEmptyVerified: true,
    });
    persistDurableRecoveryState(terminalRecoveryState);
    recoveryStateSequence = terminalRecoveryState.writeSequence;
    closureStatus = 'TRASHED_AND_VERIFIED';
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

function loadDurableRecoveryState(): {
    state: GoogleProductionCleanupRecoveryState | null;
    errors: string[];
} {
    if (!recoveryDirectoryValidation.valid || !recoveryStateDir) return { state: null, errors: [] };
    if (!existsSync(recoveryStateDir)) return { state: null, errors: [] };
    const entries = readdirSync(recoveryStateDir)
        .map((name) => {
            const match = /^state-(\d{6})-([a-f0-9]{64})\.json$/u.exec(name);
            return match ? { name, sequence: Number(match[1]), hash: match[2] } : null;
        })
        .filter((entry): entry is { name: string; sequence: number; hash: string } => entry !== null)
        .sort((left, right) => left.sequence - right.sequence);
    if (entries.length === 0) return { state: null, errors: [] };

    const errors: string[] = [];
    let previous: GoogleProductionCleanupRecoveryState | null = null;
    for (const entry of entries) {
        let value: unknown;
        try {
            value = JSON.parse(readFileSync(path.join(recoveryStateDir, entry.name), 'utf8')) as unknown;
        } catch (error) {
            errors.push(`Recovery state ${entry.name} is unreadable: ${safeError(error)}`);
            continue;
        }
        if (!isGoogleProductionCleanupRecoveryState(value)) {
            errors.push(`Recovery state ${entry.name} violates its integrity or schema contract.`);
            continue;
        }
        if (value.writeSequence !== entry.sequence || value.stateSha256 !== entry.hash) {
            errors.push(`Recovery state filename identity mismatch at sequence ${entry.sequence}.`);
        }
        if (previous === null) {
            if (entry.sequence !== 0 || value.previousStateSha256 !== null) {
                errors.push('Recovery state chain must start at sequence 0 without a predecessor.');
            }
        } else if (entry.sequence !== previous.writeSequence + 1
            || value.previousStateSha256 !== previous.stateSha256) {
            errors.push(`Recovery state chain is discontinuous at sequence ${entry.sequence}.`);
        }
        previous = value;
    }
    return errors.length > 0 ? { state: null, errors } : { state: previous, errors: [] };
}

function persistDurableRecoveryState(state: GoogleProductionCleanupRecoveryState): void {
    if (!recoveryDirectoryValidation.valid || !recoveryStateDir) {
        throw new Error(`Refusing Google cleanup write without a valid ${GOOGLE_PRODUCTION_RECOVERY_DIR_ENV} outside the repository.`);
    }
    if (!isGoogleProductionCleanupRecoveryState(state)) {
        throw new Error('Refusing to persist an invalid Google cleanup recovery state.');
    }
    mkdirSync(recoveryStateDir, { recursive: true });
    const finalName = `state-${String(state.writeSequence).padStart(6, '0')}-${state.stateSha256}.json`;
    const finalPath = path.join(recoveryStateDir, finalName);
    const serialized = `${JSON.stringify(state, null, 2)}\n`;
    if (existsSync(finalPath)) {
        if (readFileSync(finalPath, 'utf8') !== serialized) {
            throw new Error('Existing durable recovery state content does not match its checksum-bound filename.');
        }
        return;
    }
    const temporaryPath = path.join(
        recoveryStateDir,
        `.pending-${process.pid}-${state.writeSequence}-${state.stateSha256}.tmp`,
    );
    writeFileSync(temporaryPath, serialized, { encoding: 'utf8', flag: 'wx' });
    renameSync(temporaryPath, finalPath);
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
    const recoveryDirectorySafe = !executeRequested || recoveryDirectoryValidation.valid;
    const fullyValid = valid && recoveryDirectorySafe;
    return fullyValid
        ? ok('environment_boundary', 'Production Google config is complete and its Drive root differs from staging.', [
            'productionEnv=.env',
            'stagingEnv=.env.staging',
            `rootFingerprint=${rootFingerprint}`,
            `stagingRootFingerprint=${resourceFingerprint(stagingRoot!)}`,
            'rawIdsPersisted=false',
            `recoveryDirectoryConfigured=${String(recoveryDirectoryValidation.valid)}`,
            `recoveryDirectoryStoredOutsideRepository=${String(recoveryDirectoryValidation.valid)}`,
        ])
        : fail('environment_boundary', 'Production/staging Google boundary is incomplete or unsafe.', [
            `missing=${missing.join(',') || 'none'}`,
            `rootsDistinct=${String(rootsDistinct)}`,
            `privateKeyShape=${String(privateKeyShape)}`,
            `recoveryDirectorySafe=${String(recoveryDirectorySafe)}`,
            `recoveryDirectoryReason=${recoveryDirectoryValidation.reason}`,
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
        `- Moved to trash this run: ${value.movedToTrashThisRun}`,
        `- Moved to trash reconciled from baseline: ${value.movedToTrashReconciled}`,
        `- Durable recovery state loaded: ${String(value.recovery.stateLoaded)}`,
        `- Durable recovery sequence: ${value.recovery.stateSequence ?? 'none'}`,
        `- Rollout-consumable receipt: ${String(value.recovery.receiptConsumableByProductionRollout)}`,
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
        `- Current active direct children: \`${value.before.total}\`.`,
        `- Original approved direct children: \`${value.approval.expectedCount || 'unavailable'}\`.`,
        `- Original children snapshot SHA-256: \`${value.approval.expectedFingerprintSha256 || 'unavailable'}\`.`,
        `- Required flag: \`--execute-approved\`.`,
        `- Required count env: \`${GOOGLE_PRODUCTION_EXPECTED_COUNT_ENV}=${value.approval.expectedCount || 'unavailable'}\`.`,
        `- Required fingerprint env: \`${GOOGLE_PRODUCTION_EXPECTED_FINGERPRINT_ENV}=${value.approval.expectedFingerprintSha256 || 'unavailable'}\`.`,
        `- Required approval env: \`${GOOGLE_PRODUCTION_CLEANUP_APPROVAL_ENV}\`.`,
        `- Required execute-only recovery dir env: \`${GOOGLE_PRODUCTION_RECOVERY_DIR_ENV}\` pointing to an absolute directory outside the repository.`,
        '',
        '## Exact Approval Sentence',
        '',
        value.approval.exactSentence || '<unavailable until a valid read-only snapshot exists>',
        '',
        'Execution is folder-only, direct-child-only and trash-only. Recovery always reuses the original 110-folder approval and never approves the remaining subset. Any baseline, membership, root, environment, state-chain or approval drift blocks all writes and receipts.',
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
