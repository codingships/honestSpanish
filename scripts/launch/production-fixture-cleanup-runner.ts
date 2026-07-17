import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    FIXTURE_CLEANUP_APPROVAL_ENV,
    FIXTURE_CLEANUP_DATABASE_ENV,
    FIXTURE_CLEANUP_GATE,
    FIXTURE_CLEANUP_PATHS,
    FIXTURE_CLEANUP_SUCCESS_PREFIX,
    FIXTURE_CLEANUP_TARGET,
    buildDatabaseToolProcessEnvironment,
    buildFixtureCleanupApproval,
    buildPsqlEnvironment,
    loadAndValidateFixtureCleanupManifest,
    parseFixtureCleanupPreview,
    readFixturePreservationPolicyEvidence,
    sanitizeOutput,
    sha256,
    stableJson,
    validateBackupReceipt,
    type FixtureCleanupManifest,
    type FixtureCleanupPreview,
} from './production-fixture-cleanup-shared';
import {
    readProductionAuthInertEvidence,
    safeErrorMessage,
    verifyLiveProductionAuthInert,
} from './supabase-auth-config-shared';
import { withSupabaseAuthManagementClient } from './supabase-cli-windows-credential';

type Mode = 'plan' | 'preview' | 'execute';

interface CliOptions {
    mode: Mode;
    executeApproved: boolean;
    backupReceiptPath: string | null;
    authInertEvidencePath: string | null;
    preservationPolicyPath: string | null;
}

interface PsqlResult {
    ok: boolean;
    status: number | null;
    stdout: string;
    stderr: string;
    error: string | null;
}

const root = process.cwd();

export function parseFixtureCleanupArgs(args: string[]): CliOptions {
    const modeCandidate = args[0] ?? 'plan';
    if (!['plan', 'preview', 'execute'].includes(modeCandidate)) {
        throw new Error('Mode must be one of: plan, preview, execute.');
    }

    let executeApproved = false;
    let backupReceiptPath: string | null = null;
    let authInertEvidencePath: string | null = null;
    let preservationPolicyPath: string | null = null;
    for (let index = 1; index < args.length; index += 1) {
        const argument = args[index];
        if (argument === '--execute-approved') {
            if (executeApproved) throw new Error('--execute-approved may only be supplied once.');
            executeApproved = true;
            continue;
        }
        if (argument === '--backup-receipt') {
            const value = args[index + 1];
            if (!value || value.startsWith('--')) throw new Error('--backup-receipt requires a file path.');
            if (backupReceiptPath) throw new Error('--backup-receipt may only be supplied once.');
            backupReceiptPath = value;
            index += 1;
            continue;
        }
        if (argument === '--auth-inert-evidence') {
            const value = args[index + 1];
            if (!value || value.startsWith('--')) throw new Error('--auth-inert-evidence requires a JSON file path.');
            if (authInertEvidencePath) throw new Error('--auth-inert-evidence may only be supplied once.');
            authInertEvidencePath = value;
            index += 1;
            continue;
        }
        if (argument === '--preservation-policy') {
            const value = args[index + 1];
            if (!value || value.startsWith('--')) throw new Error('--preservation-policy requires a JSON file path.');
            if (preservationPolicyPath) throw new Error('--preservation-policy may only be supplied once.');
            preservationPolicyPath = value;
            index += 1;
            continue;
        }
        throw new Error(`Unknown fixture-cleanup argument: ${argument}`);
    }

    const mode = modeCandidate as Mode;
    if (mode !== 'execute' && (executeApproved || backupReceiptPath || authInertEvidencePath || preservationPolicyPath)) {
        throw new Error('Execution gates are accepted only in execute mode.');
    }
    return { mode, executeApproved, backupReceiptPath, authInertEvidencePath, preservationPolicyPath };
}

export function executeGateRequested(options: CliOptions): boolean {
    return options.mode === 'execute'
        && options.executeApproved
        && typeof options.backupReceiptPath === 'string'
        && typeof options.authInertEvidencePath === 'string'
        && typeof options.preservationPolicyPath === 'string';
}

async function main(): Promise<void> {
    const startedAt = new Date();
    const outputDir = createOutputDir(startedAt);
    const options = parseFixtureCleanupArgs(process.argv.slice(2));
    const manifestValidation = loadAndValidateFixtureCleanupManifest(root);

    if (!manifestValidation.ok || !manifestValidation.value) {
        writeSummary(outputDir, {
            status: 'BLOCKED_LOCAL_BUNDLE_INVALID',
            mode: options.mode,
            errors: manifestValidation.errors,
            networkAccessPerformed: false,
            externalWritePerformed: false,
        });
        throw new Error(manifestValidation.errors.join(' '));
    }

    if (options.mode === 'plan') {
        runPlan(outputDir, manifestValidation.value);
        return;
    }

    if (options.mode === 'preview') {
        const databaseUrl = process.env[FIXTURE_CLEANUP_DATABASE_ENV];
        if (!databaseUrl) throw new Error(`${FIXTURE_CLEANUP_DATABASE_ENV} is required for preview mode.`);
        const databaseEnvironment = buildPsqlEnvironment(databaseUrl);
        const preview = runPreview(outputDir, databaseEnvironment);
        const status = preview.baselineMatches
            ? 'PREVIEW_MATCHED_NO_WRITE'
            : 'BLOCKED_PREVIEW_BASELINE_DRIFT';
        writeSummary(outputDir, {
            status,
            mode: options.mode,
            targetProjectRef: FIXTURE_CLEANUP_TARGET.projectRef,
            preview,
            networkAccessPerformed: true,
            externalWritePerformed: false,
            authCleanup: 'BLOCKED_SEPARATE_APPROVAL_AND_WORKFLOW',
        });
        if (!preview.baselineMatches) process.exitCode = 2;
        console.log(`${status}: ${path.join(outputDir, 'summary.json')}`);
        return;
    }

    if (!executeGateRequested(options)) {
        writeSummary(outputDir, {
            status: 'BLOCKED_EXECUTION_GATES_MISSING',
            mode: options.mode,
            required: [
                '--execute-approved',
                '--backup-receipt <verified-receipt.json>',
                '--auth-inert-evidence <fresh-auth-inert-receipt.json>',
                '--preservation-policy <fresh-exact-policy.json>',
            ],
            networkAccessPerformed: false,
            externalWritePerformed: false,
        });
        throw new Error('Execute mode requires --execute-approved, --backup-receipt, --auth-inert-evidence and --preservation-policy.');
    }

    const preservationPolicy = readFixturePreservationPolicyEvidence(
        options.preservationPolicyPath,
        startedAt,
        root,
    );
    if (!preservationPolicy.ok || !preservationPolicy.sha256) {
        writeSummary(outputDir, {
            status: 'BLOCKED_PRESERVATION_POLICY_INVALID',
            mode: options.mode,
            preservationPolicy: {
                provided: preservationPolicy.provided,
                sha256: preservationPolicy.sha256,
                errors: preservationPolicy.errors,
            },
            networkAccessPerformed: false,
            externalWritePerformed: false,
        });
        throw new Error(preservationPolicy.errors.join(' '));
    }

    const authInert = readProductionAuthInertEvidence(options.authInertEvidencePath, startedAt);
    if (!authInert.valid || !authInert.sha256) {
        writeSummary(outputDir, {
            status: 'BLOCKED_AUTH_INERT_EVIDENCE_INVALID',
            mode: options.mode,
            authInertEvidence: evidenceSummary(authInert),
            networkAccessPerformed: false,
            externalWritePerformed: false,
        });
        throw new Error(authInert.errors.join(' '));
    }

    const receiptBytes = readFileSync(path.resolve(root, options.backupReceiptPath as string));
    let receiptPayload: unknown;
    try {
        receiptPayload = JSON.parse(receiptBytes.toString('utf8'));
    } catch {
        throw new Error('Backup receipt is not valid JSON.');
    }
    const receiptValidation = validateBackupReceipt(receiptPayload, startedAt);
    if (!receiptValidation.ok) {
        writeSummary(outputDir, {
            status: 'BLOCKED_BACKUP_RECEIPT_INVALID',
            mode: options.mode,
            errors: receiptValidation.errors,
            networkAccessPerformed: false,
            externalWritePerformed: false,
        });
        throw new Error(receiptValidation.errors.join(' '));
    }

    const databaseUrl = process.env[FIXTURE_CLEANUP_DATABASE_ENV];
    if (!databaseUrl) throw new Error(`${FIXTURE_CLEANUP_DATABASE_ENV} is required for execute mode.`);
    const databaseEnvironment = buildPsqlEnvironment(databaseUrl);
    const receiptSha256 = sha256(receiptBytes);
    const preview = runPreview(outputDir, databaseEnvironment);
    if (!preview.baselineMatches) {
        writeSummary(outputDir, {
            status: 'BLOCKED_PREVIEW_BASELINE_DRIFT',
            mode: options.mode,
            targetProjectRef: FIXTURE_CLEANUP_TARGET.projectRef,
            preview,
            backupReceiptSha256: receiptSha256,
            networkAccessPerformed: true,
            externalWritePerformed: false,
        });
        throw new Error('Read-only preview no longer matches the approved aggregate snapshot.');
    }

    const approvalSentence = buildFixtureCleanupApproval({
        executeSqlSha256: manifestValidation.value.sql.execute.sha256,
        backupReceiptSha256: receiptSha256,
        authInertEvidenceSha256: authInert.sha256,
        packageStripeReferenceSha256: preview.packageStripeReferenceSha256,
        preservationPolicySha256: preservationPolicy.sha256,
    });
    const approvalPath = path.join(outputDir, 'exact-approval-required.txt');
    writeFileSync(approvalPath, `${approvalSentence}\n`, 'utf8');

    if (process.env[FIXTURE_CLEANUP_APPROVAL_ENV] !== approvalSentence) {
        writeSummary(outputDir, {
            status: 'BLOCKED_EXACT_APPROVAL_MISMATCH',
            mode: options.mode,
            targetProjectRef: FIXTURE_CLEANUP_TARGET.projectRef,
            executeSqlSha256: manifestValidation.value.sql.execute.sha256,
            backupReceiptSha256: receiptSha256,
            authInertEvidenceSha256: authInert.sha256,
            packageStripeReferenceSha256: preview.packageStripeReferenceSha256,
            preservationPolicySha256: preservationPolicy.sha256,
            exactApprovalFile: path.basename(approvalPath),
            networkAccessPerformed: true,
            externalWritePerformed: false,
        });
        throw new Error(`Exact approval mismatch. Review ${approvalPath} and set ${FIXTURE_CLEANUP_APPROVAL_ENV}.`);
    }

    const immediatePreservationPolicy = readFixturePreservationPolicyEvidence(
        options.preservationPolicyPath,
        new Date(),
        root,
    );
    if (!immediatePreservationPolicy.ok
        || immediatePreservationPolicy.sha256 !== preservationPolicy.sha256) {
        writeSummary(outputDir, {
            status: 'BLOCKED_PRESERVATION_POLICY_REVALIDATION',
            mode: options.mode,
            targetProjectRef: FIXTURE_CLEANUP_TARGET.projectRef,
            preservationPolicy: {
                provided: immediatePreservationPolicy.provided,
                sha256: immediatePreservationPolicy.sha256,
                errors: immediatePreservationPolicy.errors,
            },
            networkAccessPerformed: true,
            externalWritePerformed: false,
        });
        throw new Error('Fixture-preservation policy expired, changed or failed immediate revalidation.');
    }

    const immediateAuthInert = readProductionAuthInertEvidence(options.authInertEvidencePath, new Date());
    if (!immediateAuthInert.valid || immediateAuthInert.sha256 !== authInert.sha256) {
        writeSummary(outputDir, {
            status: 'BLOCKED_AUTH_INERT_EVIDENCE_REVALIDATION',
            mode: options.mode,
            targetProjectRef: FIXTURE_CLEANUP_TARGET.projectRef,
            authInertEvidence: evidenceSummary(immediateAuthInert),
            networkAccessPerformed: true,
            externalWritePerformed: false,
        });
        throw new Error('Production Auth inert receipt expired, changed or failed immediate revalidation.');
    }
    try {
        await withSupabaseAuthManagementClient(
            FIXTURE_CLEANUP_TARGET.projectRef,
            async (client) => await verifyLiveProductionAuthInert(client),
        );
    } catch (error) {
        writeSummary(outputDir, {
            status: 'BLOCKED_LIVE_AUTH_NOT_INERT',
            mode: options.mode,
            targetProjectRef: FIXTURE_CLEANUP_TARGET.projectRef,
            authInertEvidenceSha256: authInert.sha256,
            error: safeErrorMessage(error),
            networkAccessPerformed: true,
            externalWritePerformed: false,
        });
        throw error;
    }

    const result = runPsql({
        databaseEnvironment,
        sqlPath: path.join(root, FIXTURE_CLEANUP_PATHS.executeSql),
        readOnly: false,
        variables: {
            cleanup_gate: FIXTURE_CLEANUP_GATE,
            cleanup_project_ref: FIXTURE_CLEANUP_TARGET.projectRef,
            cleanup_snapshot_sha256: FIXTURE_CLEANUP_TARGET.aggregateSnapshotSha256,
            cleanup_scope_sha256: FIXTURE_CLEANUP_TARGET.approvalScopeSha256,
            cleanup_backup_receipt_sha256: receiptSha256,
            cleanup_package_stripe_reference_sha256: preview.packageStripeReferenceSha256,
            cleanup_preservation_policy_sha256: preservationPolicy.sha256,
        },
    });
    writePsqlEvidence(outputDir, 'execute', result);

    const expectedSuccessMarker = `${FIXTURE_CLEANUP_SUCCESS_PREFIX}`
        + `project_ref=${FIXTURE_CLEANUP_TARGET.projectRef}|`
        + `snapshot=${FIXTURE_CLEANUP_TARGET.aggregateSnapshotSha256}|`
        + `scope=${FIXTURE_CLEANUP_TARGET.approvalScopeSha256}|`
        + `preservation_policy=${preservationPolicy.sha256}|`
        + 'auth_users=BLOCKED_UNTOUCHED_138|packages=4|legacy_jobs=ABSENT';
    if (!result.ok || !result.stdout.includes(expectedSuccessMarker)) {
        writeSummary(outputDir, {
            status: 'EXECUTION_FAILED_TRANSACTION_ABORTED_OR_STATE_UNKNOWN',
            mode: options.mode,
            targetProjectRef: FIXTURE_CLEANUP_TARGET.projectRef,
            psqlExitCode: result.status,
            markerObserved: false,
            networkAccessPerformed: true,
            externalWritePerformed: 'attempted',
            nextAction: 'Do not retry. Inspect the sanitized psql evidence and re-run read-only preview.',
        });
        throw new Error(result.error ?? 'Fixture-cleanup transaction did not emit its success marker.');
    }

    const completedAt = new Date().toISOString();
    const publicCleanupReceipt = {
        schemaVersion: 2,
        status: 'PUBLIC_FIXTURE_CLEANUP_EXECUTED_AND_VERIFIED',
        targetProjectRef: FIXTURE_CLEANUP_TARGET.projectRef,
        completedAt,
        aggregateSnapshotSha256: FIXTURE_CLEANUP_TARGET.aggregateSnapshotSha256,
        approvalScopeSha256: FIXTURE_CLEANUP_TARGET.approvalScopeSha256,
        backupReceiptSha256: receiptSha256,
        authInertEvidenceSha256: authInert.sha256,
        executeSqlSha256: manifestValidation.value.sql.execute.sha256,
        packageStripeReferenceSha256: preview.packageStripeReferenceSha256,
        preservationPolicySha256: preservationPolicy.sha256,
        freezeCutoff: '2026-07-02T18:29:27.580Z',
        postconditions: {
            authUsers: 138,
            profiles: 0,
            profilesPrivate: 0,
            legacyJobsTableAbsent: true,
            supportTickets: 0,
            packages: 4,
        },
        packagesPreserved: ['group', 'standard', 'hybrid', 'bootcamp'],
        localPackageStripeFieldsCleared: true,
        inactiveEssentialDeleted: true,
        externalStripeGoogleStorage: 'UNTOUCHED',
        authNextStep: 'SEPARATE_AUTH_REDUCTION_REQUIRED',
    };
    const publicCleanupReceiptPath = path.join(outputDir, 'public-cleanup-receipt.json');
    writeFileSync(publicCleanupReceiptPath, stableJson(publicCleanupReceipt), 'utf8');
    writeSummary(outputDir, {
        status: 'EXECUTED_AND_VERIFIED',
        completedAt,
        mode: options.mode,
        targetProjectRef: FIXTURE_CLEANUP_TARGET.projectRef,
        aggregateSnapshotSha256: FIXTURE_CLEANUP_TARGET.aggregateSnapshotSha256,
        approvalScopeSha256: FIXTURE_CLEANUP_TARGET.approvalScopeSha256,
        executeSqlSha256: manifestValidation.value.sql.execute.sha256,
        backupReceiptSha256: receiptSha256,
        authInertEvidenceSha256: authInert.sha256,
        packageStripeReferenceSha256: preview.packageStripeReferenceSha256,
        preservationPolicySha256: preservationPolicy.sha256,
        psqlExitCode: result.status,
        markerObserved: true,
        packagesPreserved: ['group', 'standard', 'hybrid', 'bootcamp'],
        localPackageStripeFieldsCleared: true,
        inactiveEssentialDeleted: true,
        authUsers: 'BLOCKED_UNTOUCHED_138',
        externalStripeGoogleStorage: 'UNTOUCHED',
        networkAccessPerformed: true,
        externalWritePerformed: true,
        postCommitRollback: 'VERIFIED_BACKUP_ONLY',
        publicCleanupReceiptFile: path.basename(publicCleanupReceiptPath),
        publicCleanupReceiptSha256: sha256(stableJson(publicCleanupReceipt)),
    });
    console.log(`EXECUTED_AND_VERIFIED: ${path.join(outputDir, 'summary.json')}`);
}

function runPlan(outputDir: string, manifest: FixtureCleanupManifest): void {
    const approvalTemplate = buildFixtureCleanupApproval({
        executeSqlSha256: manifest.sql.execute.sha256,
        backupReceiptSha256: 'b'.repeat(64),
        authInertEvidenceSha256: 'c'.repeat(64),
        packageStripeReferenceSha256: 'a'.repeat(64),
        preservationPolicySha256: 'd'.repeat(64),
    })
        .replace(`backup_receipt=${'b'.repeat(64)}`, 'backup_receipt=<SHA256_OF_COMPLETED_RECEIPT>')
        .replace(`auth_inert_evidence=${'c'.repeat(64)}`, 'auth_inert_evidence=<SHA256_OF_FRESH_AUTH_INERT_RECEIPT>')
        .replace(`package_stripe_references=${'a'.repeat(64)}`, 'package_stripe_references=<SHA256_FROM_FRESH_PREVIEW>')
        .replace(`preservation_policy=${'d'.repeat(64)}`, 'preservation_policy=<SHA256_OF_FRESH_EXACT_POLICY>');

    writeSummary(outputDir, {
        status: 'PLAN_ONLY_READY',
        mode: 'plan',
        targetProjectRef: FIXTURE_CLEANUP_TARGET.projectRef,
        aggregateSnapshotSha256: FIXTURE_CLEANUP_TARGET.aggregateSnapshotSha256,
        approvalScopeSha256: FIXTURE_CLEANUP_TARGET.approvalScopeSha256,
        previewSqlSha256: manifest.sql.preview.sha256,
        executeSqlSha256: manifest.sql.execute.sha256,
        backupReceiptTemplate: FIXTURE_CLEANUP_PATHS.backupReceiptTemplate,
        approvalTemplate,
        executionSequence: [
            'Create and independently store a fresh backup; complete the receipt.',
            'Complete the exact class/action preservation policy and keep it fresh.',
            `Run preview with ${FIXTURE_CLEANUP_DATABASE_ENV} supplied only to the process.`,
            'Require baselineMatches=true and capture the fresh package Stripe-reference hash.',
            'Invoke execute with both CLI gates and the exact dynamic approval environment value.',
            'Require the committed success marker; never retry an ambiguous result without a fresh preview.',
        ],
        authCleanup: 'BLOCKED_SEPARATE_APPROVAL_AND_WORKFLOW',
        networkAccessPerformed: false,
        externalWritePerformed: false,
    });
    console.log(`PLAN_ONLY_READY: ${path.join(outputDir, 'summary.json')}`);
}

function runPreview(
    outputDir: string,
    databaseEnvironment: ReturnType<typeof buildPsqlEnvironment>,
): FixtureCleanupPreview {
    const result = runPsql({
        databaseEnvironment,
        sqlPath: path.join(root, FIXTURE_CLEANUP_PATHS.previewSql),
        readOnly: true,
        variables: {},
    });
    writePsqlEvidence(outputDir, 'preview', result);
    if (!result.ok) throw new Error(result.error ?? 'Read-only fixture-cleanup preview failed.');
    return parseFixtureCleanupPreview(result.stdout);
}

function runPsql(input: {
    databaseEnvironment: ReturnType<typeof buildPsqlEnvironment>;
    sqlPath: string;
    readOnly: boolean;
    variables: Record<string, string>;
}): PsqlResult {
    const args = [
        '-X',
        '-w',
        '-q',
        '-A',
        '-t',
        '-v',
        'ON_ERROR_STOP=1',
    ];
    for (const [key, value] of Object.entries(input.variables)) {
        args.push('-v', `${key}=${value}`);
    }
    args.push('-f', input.sqlPath);

    const childEnvironment = buildDatabaseToolProcessEnvironment(input.databaseEnvironment, {
        PGOPTIONS: input.readOnly
            ? '-c default_transaction_read_only=on -c statement_timeout=30000 -c lock_timeout=5000'
            : '-c statement_timeout=60000 -c lock_timeout=5000',
    });

    const result = spawnSync('psql', args, {
        env: childEnvironment,
        encoding: 'utf8',
        timeout: input.readOnly ? 45_000 : 90_000,
        windowsHide: true,
    });
    const status = typeof result.status === 'number' ? result.status : null;
    const stdout = sanitizeOutput(result.stdout ?? '');
    const stderr = sanitizeOutput(result.stderr ?? '');
    const error = result.error
        ? sanitizeOutput(result.error.message)
        : status === 0
            ? null
            : `psql exited with status ${status ?? 'unknown'}.`;
    return { ok: !result.error && status === 0, status, stdout, stderr, error };
}

function writePsqlEvidence(outputDir: string, label: string, result: PsqlResult): void {
    writeFileSync(
        path.join(outputDir, `${label}-psql-sanitized.txt`),
        `# stdout\n${result.stdout}\n# stderr\n${result.stderr}\n# exit\n${result.status ?? 'unknown'}\n`,
        'utf8',
    );
}

function createOutputDir(startedAt: Date): string {
    const outputDir = path.join(
        root,
        'outputs',
        'launch-production-fixture-cleanup',
        startedAt.toISOString().replace(/[:.]/gu, '-'),
    );
    mkdirSync(outputDir, { recursive: true });
    return outputDir;
}

function writeSummary(outputDir: string, summary: Record<string, unknown>): void {
    writeFileSync(path.join(outputDir, 'summary.json'), stableJson(summary), 'utf8');
}

function evidenceSummary(evidence: ReturnType<typeof readProductionAuthInertEvidence>): Record<string, unknown> {
    return {
        provided: evidence.provided,
        valid: evidence.valid,
        sha256: evidence.sha256,
        errors: evidence.errors,
    };
}

const isMain = process.argv[1]
    ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
    : false;

if (isMain) {
    main().catch((error: unknown) => {
        console.error(sanitizeOutput(error instanceof Error ? error.message : String(error)));
        process.exitCode = 1;
    });
}
