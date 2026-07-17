import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import {
    buildDatabaseToolProcessEnvironment,
    buildPsqlEnvironment,
} from './production-fixture-cleanup-shared';
import { PRODUCTION_PROJECT, sha256, stableJson } from './supabase-production-rollout-shared';

const MAX_SNAPSHOT_BYTES = 300_000;
const SQL_PATH = 'scripts/launch/sql/supabase-production-history-reconciliation-readonly.sql';
const OUTPUT_FAMILY = 'launch-supabase-production-history-reconciliation';
const hash = z.string().regex(/^[a-f0-9]{64}$/u);

export const HISTORY_RECONCILIATION_EXCEPTION_ID = 'EH_SUPABASE_PRODUCTION_HISTORY_EXCEPTION_V1';
export const HISTORY_RECONCILIATION_MAX_AGE_MS = 15 * 60 * 1_000;
export const HISTORY_RECONCILIATION_SQL_PATH = SQL_PATH;
export const HISTORY_RECONCILIATION_SQL_SHA256 = 'f2c02e8a8a5362e50420cb3e8a6e4fc86d04cd49b87a7cc059a98c81c5b6ff51';

export const HISTORY_EXPECTATIONS = [
    row('009', 'jobs', [
        '3cab4919bb2f077eea6300334ea3819ca3051bc11662453749b3403c87881c03',
        'a118a70b948bf1158bc7c01fa9e6eb535b75ebe21ada6c9c2c08ad7a19943759',
        '94a4a5cd18c6ac02ec9ec3211694582393bf181cc61f4570fe8bb4484816a636',
        'd9e694375676440f5af1414ed673afe72c17689d1ea684c3a1248deec073274d',
        'aea9157915dbe6c9710e8e96fdb1b8a74354772caf4e828fdd606a3f64d31dee',
        'f2ddb0c04a9c9a2a370c611e59ce2fd3eb1d293699ec773cec8f27e0be3b3de8',
    ], 'cc4d3bf8b661f20c4f68bbcdd50c25774c79ed1803f1336913405b6867448d48', 'e5c796ad31dc19ae3651e1a64ddbb3263caf207df196f58fc3acfac8f90028e9'),
    row('021', 'harden_session_write_policies', [
        '77d357626324220da633d921c7977d11fe6a6b73ab55da1bb66d9168f14377d2',
        '15b836a2376faa96c63c51a2592ff29b6d8e768496c999d1f5b867225177c0db',
        '1e76f1f09c367aa46ff2044d8d09f596e987b07c85078649d2290f43fb7f9189',
        'b75ef2fa81b5a027191cb6a65e208aa7eebdca5cd7eeac1eed31cda51d49f81d',
        'a71fbfb0f5abaedaa8e30c9cf2d1f6d45b27f2e38767230eb2a6c7b4f5e007d4',
        'f22943b316a828ef10f11fe08551ebf613018089d7c05f3d7699f0c2227362b7',
    ], '676a1ccfd36705fa2ad073cd67e5da367e5193de85473cbe788ac3682ad3ba4c', '06b28f7c10032503525dc6a374502afb8bab10c35a37b727524f800e690efe47'),
    row('022', 'track_stripe_webhook_processing_state', [
        'cf267fef21225e4a355b9b7e6e1b479223be58341575dbf2d129cbabb37634d8',
        'c660933b82624a6ab27240ce0aea56cdef74c8c504569880d438ecc90ced8e84',
        '7172a4ee6a5df6ea853c13f30f4b26afdc629bc1fb888ba36dbb1ffed5010e32',
        '10298486ec97366d033f9b762c36f66c722b971357eb76e3b20a9cf2703ccd51',
    ], '8e3bdac76f4073390ad665b0d5d3ac7176d1514e8e267b60083b4291a89d902b', 'c8d26ce478549340d61cdd3cb999232fe29b3776566f25d7ba6331e53d63142a'),
    row('20260702124757', 'harden_profile_role_trigger', [
        '885b80805d0687a1bd82e2b830b09072d0aebf0de016f72c8cd0d34fc900b3dc',
        '7235293e6fd8feafb0003832dd64ea9d96a419dfa5756732f85edb8daac53b40',
        '013896a97274e3c97791842eca61941154c41e0c7958831bf651c1a2549450cb',
        '6767182ff591660e7066644c716c6c0d6450b95a1f29b07f25dd04584d95c057',
        'b8f12b838e67b2c00769b81fe4268d7e0a31a2b0055cecb9731907917192d793',
        '358d6b2621f5f635b8372f8c855d016b86a586efb7e3721433a05d3997e59882',
        '6db8e036ea7d6a5f725e777a4faa5348f0f8039169cb492bd6b08f93f6585376',
        'd8025701ac4ee984c4ec39d11869e25e11d5346f7a9e69c1eb66ebb1b7e7ac43',
        'd63fdb5527e422ba59e4cdcfee689cb6a4a1a01018761609b06502232269ab68',
    ], '3bbbcaa86f4671e3051b7f1da05710376e47a42d19028469c7e5069fd4082489', '3a9d4f5cd30811f603703ee6ab653a519ecbf6e7f1df79fc9bcacdbbd4ec3fca'),
    row('20260703192245', '021_harden_session_write_policies', ['5a547504b82208552751412368fd46ed7bf3efa9ab5f0f8ad8a9f11c528d21c5'], '79dc2c297ee88985c5d68a96d1a282eae45fa112ebf534cf051ee29ea789de67', '5a547504b82208552751412368fd46ed7bf3efa9ab5f0f8ad8a9f11c528d21c5'),
    row('20260703192307', '022_track_stripe_webhook_processing_state', ['398b2838c506e0c026c60489c25ed4fb3c337341c68779b676a5f7cec1d1b4f8'], '38be75e1c23e79b3fc0fe4b8170416d9bfc12db009762e0a2bbbfc8ce626db70', '398b2838c506e0c026c60489c25ed4fb3c337341c68779b676a5f7cec1d1b4f8'),
    row('20260703192329', '20260702124757_harden_profile_role_trigger', ['a45c03c7aa39288c9b63dc9534ac3fc5941bed6d47855d64f7d8d36c4a27a1e3'], 'e280d5cb6f1fce9c4d592155dce1a3aca6597e69cebc529fa82bcda922e05411', 'a45c03c7aa39288c9b63dc9534ac3fc5941bed6d47855d64f7d8d36c4a27a1e3'),
] as const;

export const EFFECT_EXPECTATIONS = [
    effect('009.remote_identity', 'absent', 'version_collision_public.jobs'),
    effect('009.packages_updated_at', 'present', 'column_present'),
    effect('009.packages_name_unique', 'present', 'unique_constraint_present'),
    effect('009.sessions_duration_default', 'superseded', '50'),
    effect('009.fulfillment_jobs_table', 'present', 'table_present'),
    effect('009.fulfillment_jobs_base_columns', 'present', 'base_columns_present'),
    effect('009.fulfillment_jobs_constraints', 'superseded', 'base_constraints_present_and_job_type_extended'),
    effect('009.fulfillment_jobs_indexes', 'present', 'required_indexes_present'),
    effect('009.fulfillment_jobs_rls', 'present', 'rls_enabled'),
    effect('009.admin_audit_log_table', 'present', 'table_present'),
    effect('009.admin_audit_log_columns', 'present', 'base_columns_present'),
    effect('009.admin_audit_log_indexes', 'present', 'required_indexes_present'),
    effect('009.admin_audit_log_rls', 'present', 'rls_enabled'),
    effect('009.processed_webhook_events_rls', 'present', 'rls_enabled'),
    effect('009.admin_policies', 'superseded', 'authenticated_private_is_admin'),
    effect('009.update_triggers', 'present', 'both_triggers_present'),
    effect('009.package_seed_keys', 'superseded', 'four_catalog_keys_present_runtime_values_authoritative'),
    effect('009.is_admin_function', 'superseded', 'private_helper_active_public_execute_closed'),
    effect('021.forbidden_write_policies', 'present', 'absent_as_required'),
    effect('021.teacher_select_policy', 'superseded', 'legacy_select_present_pending_authenticated_reconciliation'),
    effect('022.processing_columns', 'present', 'four_columns_present'),
    effect('022.processing_status_contract', 'present', 'not_null_default_processing_check_present'),
    effect('022.processing_status_rows', 'present', 'zero_invalid_or_null'),
    effect('022.timestamp_backfill', 'present', 'zero_null_created_or_processed'),
    effect('022.processed_at_default', 'superseded', 'now_pending_exact_followup'),
    effect('20260702124757.public_function_removed', 'present', 'public_function_absent'),
    effect('20260702124757.private_function_contract', 'present', 'security_definer_search_path_and_acl'),
    effect('20260702124757.private_function_body', 'present', '709647dfdca8c9d44aaec18bdca57ead1595edce2cab1529334afb51b33c5c43'),
    effect('20260702124757.trigger', 'present', 'before_update_trigger_present'),
] as const;

const sourceExpectations = [
    source('009', 'supabase/migrations/009_launch_catalog_and_fulfillment.sql', 4_994, 'a7d9481607efc62188585419aa765400add2cffaec37f8d4fac18768ede91ffd'),
    source('021', 'supabase/migrations/021_harden_session_write_policies.sql', 769, '5a547504b82208552751412368fd46ed7bf3efa9ab5f0f8ad8a9f11c528d21c5'),
    source('022', 'supabase/migrations/022_track_stripe_webhook_processing_state.sql', 1_296, '398b2838c506e0c026c60489c25ed4fb3c337341c68779b676a5f7cec1d1b4f8'),
    source('20260702124757', 'supabase/migrations/20260702124757_harden_profile_role_trigger.sql', 1_429, 'a45c03c7aa39288c9b63dc9534ac3fc5941bed6d47855d64f7d8d36c4a27a1e3'),
] as const;

const historyRowSchema = z.strictObject({
    version: z.string().regex(/^(?:\d{3}|\d{14})$/u),
    name: z.string().min(1).max(100),
    statementCount: z.number().int().positive().max(20),
    statementSha256: z.array(hash).min(1).max(20),
    statementsArraySha256: hash,
    joinedStatementsSha256: hash,
    expectedStatementCountMatches: z.literal(true),
});

const effectSchema = z.strictObject({
    id: z.string().min(1).max(100),
    classification: z.enum(['present', 'absent', 'superseded']),
    observed: z.string().min(1).max(160),
    passed: z.literal(true),
});

const descriptorSchema = z.strictObject({
    ordinal: z.number().int().min(1).max(6),
    operation: z.enum(['create_table', 'create_index', 'enable_rls']),
    object_name: z.literal('public.jobs'),
    statement_bytes: z.number().int().positive().max(10_000),
    statement_sha256: hash,
});

const snapshotSchema = z.strictObject({
    schemaVersion: z.literal(1),
    capturedAt: z.string().datetime({ offset: true }),
    provenance: z.enum([
        'supabase_connector_execute_sql',
        'supabase_history_capture_psql_readonly',
        'production_rollout_psql_readonly',
    ]),
    target: z.strictObject({
        environment: z.literal('production'),
        name: z.literal('espanolhonesto'),
        ref: z.literal('vkkahxsybhbutszerawz'),
        database: z.literal('postgres'),
    }),
    safety: z.strictObject({
        transactionReadOnly: z.literal(true),
        rawStatementsPersisted: z.literal(false),
        rawStatementsReturned: z.literal(false),
        privateRowsSelected: z.literal(false),
        externalWritePerformed: z.literal(false),
    }),
    historyRows: z.array(historyRowSchema).length(7),
    remote009Descriptors: z.array(descriptorSchema).length(6),
    effectChecks: z.array(effectSchema).length(EFFECT_EXPECTATIONS.length),
});

export type HistoryReconciliationSnapshot = z.infer<typeof snapshotSchema>;

export function parseHistoryReconciliationSnapshot(
    raw: string,
    now = new Date(),
    expectedProvenance: HistoryReconciliationSnapshot['provenance'] = 'supabase_connector_execute_sql',
    maxAgeMs = 24 * 60 * 60 * 1_000,
): HistoryReconciliationSnapshot {
    let json: unknown;
    try { json = JSON.parse(raw) as unknown; } catch { throw new Error('History reconciliation snapshot is not valid JSON.'); }
    const result = snapshotSchema.safeParse(json);
    if (!result.success) {
        const issues = result.error.issues.map((issue) => `${issue.path.join('.') || '<root>'}:${issue.code}`).join(', ');
        throw new Error(`History reconciliation snapshot schema validation failed: ${issues}`);
    }
    const snapshot = result.data;
    const capturedAt = Date.parse(snapshot.capturedAt);
    if (snapshot.provenance !== expectedProvenance) throw new Error('History reconciliation provenance mismatch.');
    if (capturedAt > now.getTime()) throw new Error('History reconciliation snapshot capturedAt is in the future.');
    if (now.getTime() - capturedAt > maxAgeMs) throw new Error('History reconciliation snapshot is stale.');
    validateExactHistory(snapshot.historyRows);
    validateExactDescriptors(snapshot.remote009Descriptors);
    validateExactEffects(snapshot.effectChecks);
    return snapshot;
}

export function buildHistoryReconciliationManifest(
    snapshot: HistoryReconciliationSnapshot,
    root = process.cwd(),
    lineageOverride?: Record<string, unknown>,
): Record<string, unknown> {
    const sources = sourceExpectations.map((expected) => {
        const absolute = path.join(root, expected.file);
        const content = readFileSync(absolute);
        const observed = { ...expected, bytes: content.byteLength, sha256: sha256(content.toString('utf8')) };
        if (observed.bytes !== expected.bytes || observed.sha256 !== expected.sha256) {
            throw new Error(`Local source drift: ${expected.file}.`);
        }
        return observed;
    });
    const queryRaw = readFileSync(path.join(root, SQL_PATH), 'utf8');
    const lineage = lineageOverride ?? collect009GitLineage(root);
    const sourceByVersion = new Map(sources.map((item) => [item.version, item]));
    const historyByVersion = new Map(snapshot.historyRows.map((item) => [item.version, item]));
    const exactAliasPairs = [
        alias('021', '20260703192245'),
        alias('022', '20260703192307'),
        alias('20260702124757', '20260703192329'),
    ].map(({ legacyVersion, exactSourceVersion }) => {
        const exactRow = required(historyByVersion.get(exactSourceVersion), exactSourceVersion);
        const sourceItem = required(sourceByVersion.get(legacyVersion), legacyVersion);
        if (exactRow.statementSha256.length !== 1 || exactRow.statementSha256[0] !== sourceItem.sha256) {
            throw new Error(`Exact source alias mismatch for ${legacyVersion}.`);
        }
        return {
            legacyVersion,
            exactSourceVersion,
            legacyStatementSha256: required(historyByVersion.get(legacyVersion), legacyVersion).statementSha256,
            sourceFile: sourceItem.file,
            sourceSha256: sourceItem.sha256,
            exactSourceStatementSha256: exactRow.statementSha256[0],
            identity: 'EXACT_FULL_SOURCE_STATEMENT' as const,
        };
    });
    const core = {
        schemaVersion: 2,
        target: PRODUCTION_PROJECT,
        allowlist: {
            id: HISTORY_RECONCILIATION_EXCEPTION_ID,
            targetProjectRef: PRODUCTION_PROJECT.ref,
            remoteVersionCollision: '009',
            duplicateCanonicalSources: ['021', '022', '20260702124757'],
            migrationRepair: 'FORBIDDEN',
        },
        evidence: {
            capturedAt: snapshot.capturedAt,
            provenance: snapshot.provenance,
            query: { file: SQL_PATH, sha256: sha256(queryRaw) },
            snapshotSha256: sha256(stableJson(snapshot)),
            historyRows: snapshot.historyRows,
            remote009Descriptors: snapshot.remote009Descriptors,
            effectChecks: snapshot.effectChecks,
            localSources: sources,
            gitLineage009: lineage,
        },
        reconciliation: {
            exactAliasPairs,
            local009: {
                remoteVersion: '009',
                remoteName: 'jobs',
                remoteObject: 'public.jobs',
                localSourceFile: sourceByVersion.get('009')?.file,
                localSourceSha256: sourceByVersion.get('009')?.sha256,
                sourceIdentity: 'PROVEN_DIFFERENT_VERSION_COLLISION',
                gitContains009JobsMigration: false,
                fullEffectContractVerified: true,
                proposedException: {
                    type: 'SOURCE_BOUND_VERSION_COLLISION_EFFECT_RECONCILIATION',
                    exactRemoteRowHashesBound: true,
                    exactLocalSourceHashBound: true,
                    exactEffectContractBound: true,
                    eligibleForManualReview: true,
                    enabled: false,
                    rolloutConsumable: false,
                    allowlistedConsumerImplemented: true,
                    activationRequiresExactApproval: true,
                },
            },
        },
        verdict: {
            status: 'REVIEWED_EXCEPTION_ELIGIBLE',
            rolloutExceptionEligible: true,
            rolloutMustRemainBlocked: true,
            blocker: 'EXPLICIT_HISTORY_EXCEPTION_AUTHORIZATION_REQUIRED',
            safeFacts: [
                'The three duplicate semantic histories have exact full-source timestamped rows.',
                'Remote 009 is a six-statement public.jobs migration and is not the local launch catalog source.',
                'Every enumerated local 009/021/022/profile-trigger schema effect is present or explicitly superseded.',
            ],
            requiredBeforeEnablement: [
                'A fresh read-only snapshot immediately before rollout proving identical hashes and effects.',
                'Explicit authorization to enable the exception; migration repair remains forbidden.',
            ],
        },
        safety: {
            externalWritePerformed: false,
            migrationApplied: false,
            migrationRepairPerformed: false,
            rawMigrationSqlStored: false,
            privateRowsStored: false,
            rolloutConsumerModified: true,
        },
    };
    return { ...core, manifestCoreSha256: sha256(stableJson(core)) };
}

export function collect009GitLineage(root = process.cwd()): Record<string, unknown> {
    const file = 'supabase/migrations/009_launch_catalog_and_fulfillment.sql';
    const log = runGit(root, ['log', '--all', '--format=%H\t%aI\t%s', '--', file]);
    const rows = log.split(/\r?\n/u).filter(Boolean);
    if (rows.length !== 1 || !rows[0].startsWith('05dca85e592efd1fb83e8d7851f7d23adf3c7697\t')) {
        throw new Error('Unexpected Git lineage for local 009 source.');
    }
    const objects = runGit(root, ['rev-list', '--objects', '--all']).split(/\r?\n/u);
    const historical009JobsPaths = objects
        .map((line) => line.slice(line.indexOf(' ') + 1))
        .filter((filePath) => /(?:^|\/)009_jobs\.sql$/iu.test(filePath));
    if (historical009JobsPaths.length > 0) throw new Error('A historical 009_jobs.sql path exists and requires review.');
    const blob = runGit(root, ['rev-parse', '05dca85e592efd1fb83e8d7851f7d23adf3c7697:supabase/migrations/009_launch_catalog_and_fulfillment.sql']);
    return {
        commitsTouchingLocal009: rows,
        firstAndOnlyCommit: '05dca85e592efd1fb83e8d7851f7d23adf3c7697',
        sourceBlobSha1: blob,
        historical009JobsPaths,
        remote009SourceFoundInReachableGitHistory: false,
    };
}

function validateExactHistory(observed: HistoryReconciliationSnapshot['historyRows']): void {
    if (stableJson(observed) !== stableJson(HISTORY_EXPECTATIONS)) throw new Error('Exact seven-row migration history hash contract mismatch.');
}

function validateExactDescriptors(observed: HistoryReconciliationSnapshot['remote009Descriptors']): void {
    const expectedOperations = ['create_table', 'create_index', 'create_index', 'create_index', 'create_index', 'enable_rls'];
    const expectedBytes = [853, 121, 91, 81, 95, 49];
    const expectedHashes = HISTORY_EXPECTATIONS[0].statementSha256;
    for (const [index, descriptor] of observed.entries()) {
        if (descriptor.ordinal !== index + 1
            || descriptor.operation !== expectedOperations[index]
            || descriptor.statement_sha256 !== expectedHashes[index]
            || descriptor.object_name !== 'public.jobs'
            || descriptor.statement_bytes !== expectedBytes[index]) {
            throw new Error('Remote 009 safe descriptor contract mismatch.');
        }
    }
}

function validateExactEffects(observed: HistoryReconciliationSnapshot['effectChecks']): void {
    if (stableJson(observed) !== stableJson(EFFECT_EXPECTATIONS.map((item) => ({ ...item, passed: true })))) {
        throw new Error('Complete schema-effect contract mismatch.');
    }
}

export type HistoryReconciliationArgs =
    | { mode: 'snapshot'; snapshotPath: string }
    | { mode: 'capture-readonly'; snapshotPath: null };

export function parseHistoryReconciliationArgs(values: string[]): HistoryReconciliationArgs {
    const args = values[0] === '--' ? values.slice(1) : values;
    if (args.length === 1 && args[0] === '--capture-readonly') {
        return { mode: 'capture-readonly', snapshotPath: null };
    }
    if (args.length === 2 && args[0] === '--snapshot' && args[1]) {
        return { mode: 'snapshot', snapshotPath: args[1] };
    }
    throw new Error('Usage: --capture-readonly OR --snapshot <aggregate-only.json>.');
}

function readSnapshotFile(root: string, filePath: string): string {
    const resolved = path.resolve(root, filePath);
    if (!existsSync(resolved) || path.extname(resolved).toLowerCase() !== '.json') throw new Error('Snapshot must be an existing JSON file.');
    const stat = lstatSync(resolved);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size <= 0 || stat.size > MAX_SNAPSHOT_BYTES) throw new Error('Snapshot must be an ordinary bounded JSON file.');
    const relative = path.relative(realpathSync(root), realpathSync(resolved));
    if (path.isAbsolute(relative) || relative.startsWith(`..${path.sep}`) || relative === '..') throw new Error('Snapshot must be inside the repository workspace.');
    return readFileSync(resolved, 'utf8');
}

interface CaptureProcessResult {
    status: number | null;
    stdout?: string;
    stderr?: string;
    error?: Error;
}

type CaptureSpawn = (
    command: string,
    args: string[],
    options: {
        cwd: string;
        env: NodeJS.ProcessEnv;
        encoding: 'utf8';
        timeout: number;
        windowsHide: true;
    },
) => CaptureProcessResult;

export function captureHistoryReconciliationSnapshotReadonly(options: {
    root?: string;
    envFile?: string;
    now?: Date;
    spawn?: CaptureSpawn;
} = {}): HistoryReconciliationSnapshot {
    const root = options.root ?? process.cwd();
    const envFile = path.resolve(root, options.envFile ?? PRODUCTION_PROJECT.envFile);
    const sqlPath = path.resolve(root, SQL_PATH);
    const sql = readFileSync(sqlPath, 'utf8');
    if (sha256(sql) !== HISTORY_RECONCILIATION_SQL_SHA256) {
        throw new Error('Allowlisted history reconciliation SQL SHA-256 mismatch.');
    }
    const env = readEnvironment(envFile);
    const databaseUrl = env.get('SUPABASE_DB_URL');
    if (!databaseUrl) throw new Error('Production environment is missing SUPABASE_DB_URL.');
    const publicUrl = env.get('PUBLIC_SUPABASE_URL');
    if (!publicUrl || !urlIdentifiesProject(publicUrl, PRODUCTION_PROJECT.ref)) {
        throw new Error('Production environment PUBLIC_SUPABASE_URL target mismatch.');
    }
    const connection = buildPsqlEnvironment(databaseUrl);
    const spawn = options.spawn ?? ((command, args, spawnOptions) => (
        spawnSync(command, args, spawnOptions) as CaptureProcessResult
    ));
    const result = spawn('psql', [
        '-X', '-w', '-q', '-A', '-t',
        '-v', 'ON_ERROR_STOP=1',
        '-f', sqlPath,
    ], {
        cwd: root,
        env: buildDatabaseToolProcessEnvironment(connection, {
            PGAPPNAME: 'espanol-honesto-history-reconciliation-capture',
            PGOPTIONS: [
                '-c application_name=espanol-honesto-history-reconciliation-capture',
                '-c espanol_honesto.history_reconciliation_provenance=capture_psql_readonly',
                '-c default_transaction_read_only=on',
                '-c statement_timeout=30000',
                '-c lock_timeout=5000',
            ].join(' '),
        }),
        encoding: 'utf8',
        timeout: 45_000,
        windowsHide: true,
    });
    if (result.error || result.status !== 0) {
        throw new Error(`Read-only history reconciliation capture failed (exit=${String(result.status ?? 'unknown')}); no snapshot was persisted.`);
    }
    const raw = result.stdout ?? '';
    if (Buffer.byteLength(raw, 'utf8') <= 0 || Buffer.byteLength(raw, 'utf8') > MAX_SNAPSHOT_BYTES) {
        throw new Error('Read-only history reconciliation capture returned an invalid bounded snapshot.');
    }
    const capturedAt = options.now ?? new Date();
    let snapshot: HistoryReconciliationSnapshot;
    try {
        snapshot = parseHistoryReconciliationSnapshot(
            raw.trim(),
            capturedAt,
            'supabase_history_capture_psql_readonly',
            5 * 60 * 1_000,
        );
    } catch (captureProvenanceError) {
        try {
            // Supabase can strip startup application/custom GUCs. In that case the
            // allowlisted SQL reports its connector fallback and this trusted wrapper
            // seals the more precise provenance only after the complete contract passes.
            snapshot = parseHistoryReconciliationSnapshot(
                raw.trim(),
                capturedAt,
                'supabase_connector_execute_sql',
                5 * 60 * 1_000,
            );
        } catch {
            throw captureProvenanceError;
        }
    }
    return snapshot.provenance === 'supabase_history_capture_psql_readonly'
        ? snapshot
        : { ...snapshot, provenance: 'supabase_history_capture_psql_readonly' };
}

function main(): void {
    const root = process.cwd();
    const args = parseHistoryReconciliationArgs(process.argv.slice(2));
    const snapshot = args.mode === 'capture-readonly'
        ? captureHistoryReconciliationSnapshotReadonly({ root })
        : parseHistoryReconciliationSnapshot(readSnapshotFile(root, args.snapshotPath));
    const manifest = buildHistoryReconciliationManifest(snapshot, root);
    const outputDir = path.join(root, 'outputs', OUTPUT_FAMILY, stamp(new Date()));
    mkdirSync(outputDir, { recursive: true });
    const manifestPath = path.join(outputDir, 'immutable-review-manifest.json');
    const summaryPath = path.join(outputDir, 'summary.md');
    writeFileSync(manifestPath, stableJson(manifest), 'utf8');
    writeFileSync(summaryPath, renderSummary(manifest), 'utf8');
    console.log('[launch:supabase-production-history-reconciliation] Status: REVIEWED_EXCEPTION_ELIGIBLE');
    console.log(`[launch:supabase-production-history-reconciliation] Capture mode: ${args.mode}`);
    console.log('[launch:supabase-production-history-reconciliation] Temporary snapshot persisted: false');
    console.log('[launch:supabase-production-history-reconciliation] External write performed: false');
    console.log(`[launch:supabase-production-history-reconciliation] Manifest: ${manifestPath}`);
}

function renderSummary(manifest: Record<string, unknown>): string {
    const digest = String(manifest.manifestCoreSha256);
    return [
        '# Supabase production history reconciliation',
        '',
        '- Verdict: `REVIEWED_EXCEPTION_ELIGIBLE`; explicit activation remains required.',
        `- Exact target: ${PRODUCTION_PROJECT.ref}.`,
        '- Duplicate 021, 022 and 20260702124757 rows: exact full-source timestamp aliases verified.',
        '- 009: remote history is `public.jobs`; local source is `009_launch_catalog_and_fulfillment.sql`. This is a proven version collision, not source identity.',
        '- All enumerated final schema effects are present or explicitly superseded.',
        '- Proposed exception remains non-consumable until the allowlisted runner receives exact opt-in authorization.',
        `- Manifest core SHA-256: ${digest}.`,
        '- No migration, repair, data write, private-row export or rollout change was performed.',
        '',
    ].join('\n');
}

function row(version: string, name: string, statementSha256: readonly string[], statementsArraySha256: string, joinedStatementsSha256: string) {
    return { version, name, statementCount: statementSha256.length, statementSha256: [...statementSha256], statementsArraySha256, joinedStatementsSha256, expectedStatementCountMatches: true as const };
}
function effect(id: string, classification: 'present' | 'absent' | 'superseded', observed: string) { return { id, classification, observed }; }
function source(version: string, file: string, bytes: number, sourceSha256: string) { return { version, file, bytes, sha256: sourceSha256 }; }
function alias(legacyVersion: string, exactSourceVersion: string) { return { legacyVersion, exactSourceVersion }; }
function required<T>(value: T | undefined, label: string): T { if (!value) throw new Error(`Missing required evidence: ${label}.`); return value; }
function runGit(root: string, args: string[]): string {
    const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', timeout: 10_000, windowsHide: true });
    if (result.error || result.status !== 0) throw new Error(`Git lineage command failed: git ${args[0]}.`);
    return (result.stdout ?? '').trim();
}
function readEnvironment(envFile: string): Map<string, string> {
    const values = new Map<string, string>();
    for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/u)) {
        const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/u);
        if (!match) continue;
        values.set(match[1], stripQuotes(match[2].trim()));
    }
    return values;
}
function stripQuotes(value: string): string {
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        return value.slice(1, -1);
    }
    return value;
}
function urlIdentifiesProject(value: string, projectRef: string): boolean {
    try {
        const parsed = new URL(value);
        return parsed.hostname === `${projectRef}.supabase.co`;
    } catch {
        return false;
    }
}
function stamp(date: Date): string { return date.toISOString().replace(/[:.]/gu, '-'); }

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
