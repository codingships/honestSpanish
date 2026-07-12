import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    buildDatabaseToolProcessEnvironment,
    buildPsqlEnvironment,
    sanitizeOutput,
    sha256,
    stableJson,
} from './production-fixture-cleanup-shared';
import {
    PRODUCTION_ROLLOUT_APPROVAL_ENV,
    PRODUCTION_ROLLOUT_DB_URL_ENV,
    PRODUCTION_ROLLOUT_MIGRATIONS,
    PRODUCTION_ROLLOUT_PSQL_GATE,
    PRODUCTION_ROLLOUT_WAVES,
    buildProductionRolloutApproval,
    deriveWaveHistoryStates,
    expectedProductionWaveVerificationFacts,
    parseProductionSqlFacts,
    readAuthPolicyEvidence,
    readBackupReceiptEvidence,
    readFixtureCleanupEvidence,
    readGoogleFixturePolicyEvidence,
    readProductionPreflightEvidence,
    readSentryProductionHardeningEvidence,
    readStagingHardeningEvidence,
    renderProductionLivePreflightSql,
    renderProductionWaveApplySql,
    renderProductionWaveVerifySql,
    selectedWavesThrough,
    validateLiveHistoryFacts,
    validateProductionRolloutAllowlist,
    validateVerificationFacts,
    type EvidenceValidation,
    type ProductionPreflightEvidence,
    type ProductionRolloutMigration,
    type ProductionRolloutWave,
    type ProductionRolloutWaveId,
} from './supabase-production-rollout-runner-shared';
import { PRODUCTION_PROJECT, STAGING_ONLY_VERSION } from './supabase-production-rollout-shared';
import {
    STAGING_HARDENING_DB_URL_ENV,
    STAGING_HARDENING_TARGET,
    parseSqlFacts as parseStagingHardeningSqlFacts,
    renderStagingHardeningPostVerifySql,
    validatePostVerifyFacts as validateStagingHardeningPostVerifyFacts,
    validateStagingDatabaseUrl,
} from './supabase-staging-hardening-shared';

interface RunnerArgs {
    executeApproved: boolean;
    checkoutDisabledConfirmed: boolean;
    through: ProductionRolloutWaveId;
    throughExplicit: boolean;
    preflight: string | null;
    backupReceipt: string | null;
    cleanupEvidence: string | null;
    authPolicyEvidence: string | null;
    googleFixturePolicyEvidence: string | null;
    stagingHardeningEvidence: string | null;
    sentryHardeningEvidence: string | null;
}

interface PsqlCapture {
    id: string;
    ok: boolean;
    exitCode: number | null;
    stdout: string;
    stderr: string;
    error: string | null;
    writeAttempted: boolean;
}

const root = process.cwd();

export function parseProductionRolloutArgs(values: string[]): RunnerArgs {
    const parsed: RunnerArgs = {
        executeApproved: false,
        checkoutDisabledConfirmed: false,
        through: 'deferred_rc_hardening',
        throughExplicit: false,
        preflight: null,
        backupReceipt: null,
        cleanupEvidence: null,
        authPolicyEvidence: null,
        googleFixturePolicyEvidence: null,
        stagingHardeningEvidence: null,
        sentryHardeningEvidence: null,
    };
    const pathOptions = new Map<string, keyof RunnerArgs>([
        ['--preflight', 'preflight'],
        ['--backup-receipt', 'backupReceipt'],
        ['--cleanup-evidence', 'cleanupEvidence'],
        ['--auth-policy-evidence', 'authPolicyEvidence'],
        ['--google-fixture-policy-evidence', 'googleFixturePolicyEvidence'],
        ['--staging-hardening-evidence', 'stagingHardeningEvidence'],
        ['--sentry-hardening-evidence', 'sentryHardeningEvidence'],
    ]);

    for (let index = 0; index < values.length; index += 1) {
        const value = values[index];
        if (value === '--execute-approved') {
            if (parsed.executeApproved) throw new Error('--execute-approved may only be supplied once.');
            parsed.executeApproved = true;
            continue;
        }
        if (value === '--checkout-disabled-confirmed') {
            if (parsed.checkoutDisabledConfirmed) throw new Error('--checkout-disabled-confirmed may only be supplied once.');
            parsed.checkoutDisabledConfirmed = true;
            continue;
        }
        if (value === '--through') {
            const candidate = values[index + 1] as ProductionRolloutWaveId | undefined;
            if (!candidate || !PRODUCTION_ROLLOUT_WAVES.some((wave) => wave.id === candidate)) {
                throw new Error('--through requires an exact rollout wave id.');
            }
            parsed.through = candidate;
            parsed.throughExplicit = true;
            index += 1;
            continue;
        }
        const property = pathOptions.get(value);
        if (property) {
            const filePath = values[index + 1];
            if (!filePath || filePath.startsWith('--')) throw new Error(`${value} requires a JSON path.`);
            if (parsed[property]) throw new Error(`${value} may only be supplied once.`);
            (parsed[property] as string | null) = path.resolve(filePath);
            index += 1;
            continue;
        }
        throw new Error(`Unknown production rollout argument: ${value}`);
    }
    if (!parsed.executeApproved && parsed.checkoutDisabledConfirmed) {
        throw new Error('--checkout-disabled-confirmed is accepted only with --execute-approved.');
    }
    return parsed;
}

async function main(): Promise<void> {
    const startedAt = new Date();
    const args = parseProductionRolloutArgs(process.argv.slice(2));
    const mode = args.executeApproved ? 'execute-approved' : 'plan';
    const outputDir = createOutputDir(startedAt);
    const allowlist = validateProductionRolloutAllowlist(root);
    const preflightPath = args.preflight ?? latestPreflightPath();
    const preflight = readProductionPreflightEvidence(preflightPath, startedAt, root);
    const backup = readBackupReceiptEvidence(args.backupReceipt, startedAt);
    const cleanup = readFixtureCleanupEvidence(args.cleanupEvidence, backup.sha256, startedAt, root);
    const authPolicy = readAuthPolicyEvidence(args.authPolicyEvidence, cleanup.sha256, startedAt, backup.sha256);
    const googlePolicy = readGoogleFixturePolicyEvidence(args.googleFixturePolicyEvidence, startedAt);
    const stagingHardening = readStagingHardeningEvidence(args.stagingHardeningEvidence, startedAt);
    const sentryHardening = readSentryProductionHardeningEvidence(args.sentryHardeningEvidence, startedAt);
    const selectedWaves = selectedWavesThrough(args.through);
    const operationalWavesSelected = selectedWaves.some((wave) => wave.id !== 'processed_at_small_fix');
    const stagingHardeningSelected = selectedWaves.some((wave) => (
        wave.id === 'base_model_reconciliation' || wave.id === 'deferred_rc_hardening'
    ));
    const finalHardeningSelected = selectedWaves.some((wave) => wave.id === 'deferred_rc_hardening');
    const stagingHardeningPostVerifySql = renderStagingHardeningPostVerifySql();
    const stagingHardeningPostVerifySqlSha256 = sha256(stagingHardeningPostVerifySql);
    const waveStates = preflight.value ? deriveWaveHistoryStates(preflight.value) : [];
    const stateByWave = new Map(waveStates.map((state) => [state.id, state.state]));
    const pendingWaves = selectedWaves.filter((wave) => stateByWave.get(wave.id) !== 'complete');
    const pendingMigrations = pendingWaves.flatMap((wave) => wave.migrations);

    const evidenceGates = {
        allowlist: allowlist.valid,
        preflight: preflight.valid,
        backup: !operationalWavesSelected || backup.valid,
        publicCleanup: !operationalWavesSelected || cleanup.valid,
        authReducedQuarantined: !operationalWavesSelected || authPolicy.valid,
        googleFixturePolicy: !operationalWavesSelected || googlePolicy.valid,
        stagingHardeningAppliedAndVerified: !stagingHardeningSelected || stagingHardening.valid,
        sentryProductionHardenedAndVerified: !finalHardeningSelected || sentryHardening.valid,
    };
    const evidenceReady = Object.values(evidenceGates).every(Boolean);

    const baseScope = {
        schemaVersion: 1,
        targetProjectRef: PRODUCTION_PROJECT.ref,
        through: args.through,
        allowlistSha256: allowlist.allowlistSha256,
        evidence: {
            preflightSha256: preflight.sha256,
            backupReceiptSha256: operationalWavesSelected ? backup.sha256 : null,
            cleanupEvidenceSha256: operationalWavesSelected ? cleanup.sha256 : null,
            authPolicyEvidenceSha256: operationalWavesSelected ? authPolicy.sha256 : null,
            googleFixturePolicySha256: operationalWavesSelected ? googlePolicy.sha256 : null,
            stagingHardeningEvidenceSha256: stagingHardeningSelected ? stagingHardening.sha256 : null,
            sentryHardeningEvidenceSha256: finalHardeningSelected ? sentryHardening.sha256 : null,
        },
        preflightWaveStates: waveStates,
        pendingMigrations: pendingMigrations.map(migrationIdentity),
        exclusions: {
            stagingOnlyVersion: STAGING_ONLY_VERSION,
            dbPush: true,
            migrationRepair: true,
            automaticRestoreOrSwitch: true,
            externalProviderWrites: true,
        },
        liveStagingHardeningReadback: {
            required: stagingHardeningSelected,
            targetProjectRef: stagingHardeningSelected ? STAGING_HARDENING_TARGET.projectRef : null,
            postVerifySqlSha256: stagingHardeningSelected ? stagingHardeningPostVerifySqlSha256 : null,
        },
    };
    const scopeSha256 = sha256(stableJson(baseScope));

    const artifacts = createArtifacts(outputDir, selectedWaves);
    writeFileSync(artifacts.stagingHardeningLiveVerifySql, stagingHardeningPostVerifySql, 'utf8');
    const livePreflightSql = renderProductionLivePreflightSql();
    writeFileSync(artifacts.livePreflightSql, livePreflightSql, 'utf8');
    const waveSqlSha256: Record<string, string> = {};
    const verifySqlSha256: Record<string, string> = {};
    for (const wave of selectedWaves) {
        const applySql = renderProductionWaveApplySql({ wave, sources: allowlist.sources, scopeSha256 });
        const verifySql = renderProductionWaveVerifySql(selectedWaves.slice(0, selectedWaves.indexOf(wave) + 1));
        writeFileSync(artifacts.waveApply[wave.id], applySql, 'utf8');
        writeFileSync(artifacts.waveVerify[wave.id], verifySql, 'utf8');
        waveSqlSha256[wave.id] = sha256(applySql);
        verifySqlSha256[wave.id] = sha256(verifySql);
    }
    const finalVerifySql = renderProductionWaveVerifySql(selectedWaves);
    writeFileSync(artifacts.finalVerifySql, finalVerifySql, 'utf8');

    const exactApproval = evidenceReady && preflight.sha256
        ? buildProductionRolloutApproval({
            scopeSha256,
            allowlistSha256: allowlist.allowlistSha256,
            through: args.through,
            preflightSha256: preflight.sha256,
            backupReceiptSha256: operationalWavesSelected ? backup.sha256 : null,
            cleanupEvidenceSha256: operationalWavesSelected ? cleanup.sha256 : null,
            authPolicyEvidenceSha256: operationalWavesSelected ? authPolicy.sha256 : null,
            stagingEvidenceSha256: stagingHardeningSelected ? stagingHardening.sha256 : null,
            stagingLiveVerifySqlSha256: stagingHardeningSelected ? stagingHardeningPostVerifySqlSha256 : null,
            googleFixturePolicySha256: operationalWavesSelected ? googlePolicy.sha256 : null,
            sentryHardeningEvidenceSha256: finalHardeningSelected ? sentryHardening.sha256 : null,
            pendingMigrations,
            waveSqlSha256: Object.fromEntries(pendingWaves.map((wave) => [wave.id, waveSqlSha256[wave.id]])),
            livePreflightSqlSha256: sha256(livePreflightSql),
            waveVerifySqlSha256: verifySqlSha256,
            finalVerifySqlSha256: sha256(finalVerifySql),
        })
        : 'BLOCKED: all required evidence must validate before an exact approval is generated.';
    writeFileSync(artifacts.exactApproval, `${exactApproval}\n`, 'utf8');
    writeFileSync(artifacts.rollbackSwitch, renderRollbackSwitchPlan(scopeSha256), 'utf8');

    const reportBase = {
        schemaVersion: 1,
        startedAt: startedAt.toISOString(),
        mode,
        target: PRODUCTION_PROJECT,
        through: args.through,
        scopeSha256,
        allowlistSha256: allowlist.allowlistSha256,
        allowlistMigrationCount: PRODUCTION_ROLLOUT_MIGRATIONS.length,
        pendingMigrationCount: pendingMigrations.length,
        pendingMigrations: pendingMigrations.map(migrationIdentity),
        waveStates,
        gates: evidenceGates,
        evidence: {
            preflight: evidenceSummary(preflight),
            backup: evidenceSummary(backup),
            cleanup: evidenceSummary(cleanup),
            authPolicy: evidenceSummary(authPolicy),
            googlePolicy: evidenceSummary(googlePolicy),
            stagingHardening: evidenceSummary(stagingHardening),
            sentryHardening: evidenceSummary(sentryHardening),
        },
        artifacts: relativeArtifacts(artifacts),
        hashes: {
            livePreflightSqlSha256: sha256(livePreflightSql),
            stagingHardeningPostVerifySqlSha256,
            waveSqlSha256,
            verifySqlSha256,
            finalVerifySqlSha256: sha256(finalVerifySql),
        },
        safety: {
            checkoutMustRemainDisabled: true,
            excludedMigration: STAGING_ONLY_VERSION,
            forbiddenCommands: ['supabase db push', 'supabase migration repair'],
            automaticRollbackOrProjectSwitch: false,
            authFinalizeAfterWavesAndQuarantine: true,
            liveStagingHardeningReadbackRequired: stagingHardeningSelected,
        },
    };

    if (mode === 'plan') {
        const status = evidenceReady ? 'PLAN_ONLY_READY' : 'PLAN_ONLY_BLOCKED_BY_EVIDENCE';
        writeSummary(artifacts.summaryJson, {
            ...reportBase,
            endedAt: new Date().toISOString(),
            status,
            networkAccessPerformed: false,
            writeCommandInvoked: false,
            externalWritePerformed: false,
        });
        console.log(`${status}: ${artifacts.summaryJson}`);
        return;
    }

    const executionErrors: string[] = [];
    const stagingTarget = stagingHardeningSelected
        ? validateStagingDatabaseUrl(process.env[STAGING_HARDENING_DB_URL_ENV])
        : null;
    if (!args.throughExplicit) executionErrors.push('Execute mode requires an explicit --through wave.');
    if (!args.preflight) executionErrors.push('Execute mode requires explicit --preflight evidence.');
    if (!args.checkoutDisabledConfirmed) executionErrors.push('Execute mode requires --checkout-disabled-confirmed.');
    if (!evidenceReady) executionErrors.push('One or more local evidence gates are blocked.');
    if (stagingHardeningSelected && !stagingTarget?.valid) {
        executionErrors.push(`Exact staging database target is required: ${stagingTarget?.reason ?? 'validation failed'}.`);
    }
    if (process.env[PRODUCTION_ROLLOUT_APPROVAL_ENV] !== exactApproval) executionErrors.push(`Exact ${PRODUCTION_ROLLOUT_APPROVAL_ENV} value mismatch.`);
    if (executionErrors.length > 0) {
        writeSummary(artifacts.summaryJson, {
            ...reportBase,
            endedAt: new Date().toISOString(),
            status: 'BLOCKED_BEFORE_CONNECTION',
            errors: executionErrors,
            networkAccessPerformed: false,
            writeCommandInvoked: false,
            externalWritePerformed: false,
        });
        throw new Error(executionErrors.join(' '));
    }

    const databaseUrl = process.env[PRODUCTION_ROLLOUT_DB_URL_ENV];
    if (!databaseUrl) throw new Error(`${PRODUCTION_ROLLOUT_DB_URL_ENV} is required after all local gates pass.`);
    const connection = buildPsqlEnvironment(databaseUrl);
    const captures: Array<Record<string, unknown>> = [];
    if (stagingHardeningSelected) {
        const stagingConnection = stagingTarget?.connectionEnv as ReturnType<typeof buildPsqlEnvironment> | null;
        if (!stagingConnection) throw new Error('Validated staging connection environment is unavailable.');
        const stagingLive = runPsql(
            'live-staging-hardening',
            artifacts.stagingHardeningLiveVerifySql,
            stagingConnection,
            false,
            {},
        );
        persistCapture(outputDir, stagingLive);
        captures.push(captureSummary(stagingLive));
        const stagingLiveErrors = stagingLive.ok
            ? validateStagingHardeningPostVerifyFacts(
                parseStagingHardeningSqlFacts(stagingLive.stdout),
            ).details
            : [stagingLive.error ?? 'Live staging hardening readback failed.'];
        if (stagingLiveErrors.length > 0) {
            writeSummary(artifacts.summaryJson, {
                ...reportBase,
                endedAt: new Date().toISOString(),
                status: 'BLOCKED_LIVE_STAGING_HARDENING',
                errors: stagingLiveErrors,
                captures,
                networkAccessPerformed: true,
                writeCommandInvoked: false,
                externalWritePerformed: false,
            });
            throw new Error(stagingLiveErrors.join(' '));
        }
    }
    const live = runPsql('live-preflight', artifacts.livePreflightSql, connection, false, {});
    persistCapture(outputDir, live);
    captures.push(captureSummary(live));
    if (!live.ok || !preflight.value) throw new Error('Live read-only migration-history preflight failed.');
    const liveErrors = validateLiveHistoryFacts(
        parseProductionSqlFacts(live.stdout),
        preflight.value,
        operationalWavesSelected,
    );
    if (liveErrors.length > 0) {
        writeSummary(artifacts.summaryJson, {
            ...reportBase,
            endedAt: new Date().toISOString(),
            status: 'BLOCKED_LIVE_HISTORY_DRIFT',
            errors: liveErrors,
            captures,
            networkAccessPerformed: true,
            writeCommandInvoked: false,
            externalWritePerformed: false,
        });
        throw new Error(liveErrors.join(' '));
    }

    let writeCommandInvoked = false;
    let externalWritePerformed = false;
    for (let index = 0; index < selectedWaves.length; index += 1) {
        const wave = selectedWaves[index];
        const cumulativeWaves = selectedWaves.slice(0, index + 1);
        if (stateByWave.get(wave.id) !== 'complete') {
            if (operationalWavesSelected && (!authPolicy.value
                || Date.now() >= Date.parse(authPolicy.value.quarantineUntil))) {
                writeSummary(artifacts.summaryJson, {
                    ...reportBase,
                    endedAt: new Date().toISOString(),
                    status: 'STOPPED_AUTH_QUARANTINE_EXPIRED',
                    stoppedWave: wave.id,
                    captures,
                    networkAccessPerformed: true,
                    writeCommandInvoked,
                    externalWritePerformed,
                    nextAction: 'Keep production inert. Do not apply another wave outside the Auth credential-quarantine window.',
                });
                throw new Error('Auth credential quarantine expired before the next production wave.');
            }
            writeCommandInvoked = true;
            const apply = runPsql(`apply-${wave.id}`, artifacts.waveApply[wave.id], connection, true, {
                rollout_gate: PRODUCTION_ROLLOUT_PSQL_GATE,
                rollout_project_ref: PRODUCTION_PROJECT.ref,
                rollout_scope_sha256: scopeSha256,
                rollout_wave: wave.id,
            });
            persistCapture(outputDir, apply);
            captures.push(captureSummary(apply));
            if (!apply.ok || !apply.stdout.includes(`PRODUCTION_ROLLOUT_WAVE_COMMITTED|wave=${wave.id}|scope=${scopeSha256}`)) {
                const reconcile = runPsql(`reconcile-${wave.id}`, artifacts.waveVerify[wave.id], connection, false, {});
                persistCapture(outputDir, reconcile);
                captures.push(captureSummary(reconcile));
                writeSummary(artifacts.summaryJson, {
                    ...reportBase,
                    endedAt: new Date().toISOString(),
                    status: 'STOPPED_AMBIGUOUS_WAVE_RESULT',
                    stoppedWave: wave.id,
                    captures,
                    networkAccessPerformed: true,
                    writeCommandInvoked,
                    externalWritePerformed: 'unknown',
                    nextAction: 'Keep checkout disabled. Do not retry. Generate a fresh read-only preflight and obtain a new exact approval.',
                });
                throw new Error(`Wave ${wave.id} did not return its exact commit marker.`);
            }
            externalWritePerformed = true;
        }

        const verify = runPsql(`verify-${wave.id}`, artifacts.waveVerify[wave.id], connection, false, {});
        persistCapture(outputDir, verify);
        captures.push(captureSummary(verify));
        const verifyErrors = verify.ok
            ? validateVerificationFacts(
                parseProductionSqlFacts(verify.stdout),
                expectedProductionWaveVerificationFacts(cumulativeWaves),
            )
            : [verify.error ?? `Verification process failed for ${wave.id}.`];
        if (verifyErrors.length > 0) {
            writeSummary(artifacts.summaryJson, {
                ...reportBase,
                endedAt: new Date().toISOString(),
                status: 'STOPPED_POST_WAVE_VERIFICATION_FAILED',
                stoppedWave: wave.id,
                errors: verifyErrors,
                captures,
                networkAccessPerformed: true,
                writeCommandInvoked,
                externalWritePerformed,
                nextAction: 'Keep checkout disabled. Choose a separately reviewed fix-forward or isolated backup restore; this runner performs neither.',
            });
            throw new Error(verifyErrors.join(' '));
        }
    }

    const finalVerify = runPsql('final-verify', artifacts.finalVerifySql, connection, false, {});
    persistCapture(outputDir, finalVerify);
    captures.push(captureSummary(finalVerify));
    const finalErrors = finalVerify.ok
        ? validateVerificationFacts(
            parseProductionSqlFacts(finalVerify.stdout),
            expectedProductionWaveVerificationFacts(selectedWaves),
        )
        : [finalVerify.error ?? 'Final verification process failed.'];
    if (operationalWavesSelected && (!authPolicy.value
        || Date.now() >= Date.parse(authPolicy.value.quarantineUntil))) {
        finalErrors.push('Auth credential quarantine expired before final rollout verification completed.');
    }
    const status = finalErrors.length === 0
        ? args.through === 'deferred_rc_hardening'
            ? 'ALL_WAVES_APPLIED_AND_VERIFIED_AUTH_FINALIZE_PENDING'
            : 'SELECTED_WAVES_APPLIED_AND_VERIFIED'
        : 'FINAL_VERIFICATION_FAILED';
    const completedAt = new Date().toISOString();
    let rolloutReceiptSha256: string | null = null;
    if (finalErrors.length === 0 && args.through === 'deferred_rc_hardening') {
        const rolloutReceipt = {
            schemaVersion: 1,
            status: 'PRODUCTION_ROLLOUT_ALL_WAVES_APPLIED_AND_VERIFIED',
            targetProjectRef: PRODUCTION_PROJECT.ref,
            completedAt,
            scopeSha256,
            allowlistSha256: allowlist.allowlistSha256,
            through: args.through,
            migrationCount: 25,
            migrationManifestSha256: sha256(stableJson(PRODUCTION_ROLLOUT_MIGRATIONS.map(migrationIdentity))),
            preflightEvidenceSha256: preflight.sha256,
            backupReceiptSha256: backup.sha256,
            publicCleanupReceiptSha256: cleanup.sha256,
            authReducedQuarantinedReceiptSha256: authPolicy.sha256,
            googleFixturePolicyEvidenceSha256: googlePolicy.sha256,
            stagingHardeningEvidenceSha256: stagingHardening.sha256,
            sentryProductionHardeningEvidenceSha256: sentryHardening.sha256,
            livePreflightSqlSha256: sha256(livePreflightSql),
            finalVerifySqlSha256: sha256(finalVerifySql),
            finalVerificationPassed: true,
            stagingOnlyMigrationAbsent: true,
            checkoutRemainedDisabledByOperatorAttestation: true,
            authFinalizeRequired: true,
        };
        writeFileSync(artifacts.rolloutReceipt, stableJson(rolloutReceipt), 'utf8');
        rolloutReceiptSha256 = sha256(stableJson(rolloutReceipt));
    }
    writeSummary(artifacts.summaryJson, {
        ...reportBase,
        endedAt: completedAt,
        status,
        errors: finalErrors,
        captures,
        networkAccessPerformed: true,
        writeCommandInvoked,
        externalWritePerformed,
        authFinalizeRequired: true,
        rolloutReceiptFile: rolloutReceiptSha256 ? relative(artifacts.rolloutReceipt) : null,
        rolloutReceiptSha256,
    });
    if (finalErrors.length > 0) throw new Error(finalErrors.join(' '));
    console.log(`${status}: ${artifacts.summaryJson}`);
}

function runPsql(
    id: string,
    sqlPath: string,
    connection: ReturnType<typeof buildPsqlEnvironment>,
    writeAttempted: boolean,
    variables: Record<string, string>,
): PsqlCapture {
    const args = ['-X', '-w', '-q', '-A', '-t', '-F', '\t', '-v', 'ON_ERROR_STOP=1'];
    for (const [key, value] of Object.entries(variables)) args.push('-v', `${key}=${value}`);
    args.push('-f', sqlPath);
    const result = spawnSync('psql', args, {
        env: buildDatabaseToolProcessEnvironment(connection, {
            PGAPPNAME: `espanol-honesto-production-rollout-${id}`,
            PGOPTIONS: writeAttempted
                ? '-c statement_timeout=120000 -c lock_timeout=10000'
                : '-c default_transaction_read_only=on -c statement_timeout=30000 -c lock_timeout=5000',
        }),
        encoding: 'utf8',
        timeout: writeAttempted ? 180_000 : 45_000,
        windowsHide: true,
    });
    const exitCode = typeof result.status === 'number' ? result.status : null;
    return {
        id,
        ok: !result.error && exitCode === 0,
        exitCode,
        stdout: sanitizeOutput(result.stdout ?? ''),
        stderr: sanitizeOutput(result.stderr ?? ''),
        error: result.error ? sanitizeOutput(result.error.message) : exitCode === 0 ? null : `psql exited ${exitCode ?? 'unknown'}`,
        writeAttempted,
    };
}

function createArtifacts(outputDir: string, waves: readonly ProductionRolloutWave[]) {
    return {
        summaryJson: path.join(outputDir, 'summary.json'),
        manifestJson: path.join(outputDir, 'manifest.json'),
        livePreflightSql: path.join(outputDir, 'live-preflight-readonly.sql'),
        finalVerifySql: path.join(outputDir, 'final-verification-readonly.sql'),
        stagingHardeningLiveVerifySql: path.join(outputDir, 'staging-hardening-live-verification-readonly.sql'),
        exactApproval: path.join(outputDir, 'exact-approval-required.txt'),
        rollbackSwitch: path.join(outputDir, 'rollback-and-switch-plan.md'),
        rolloutReceipt: path.join(outputDir, 'production-rollout-receipt.json'),
        waveApply: Object.fromEntries(waves.map((wave) => [wave.id, path.join(outputDir, `wave-${wave.id}-apply.sql`)])) as Record<ProductionRolloutWaveId, string>,
        waveVerify: Object.fromEntries(waves.map((wave) => [wave.id, path.join(outputDir, `wave-${wave.id}-verify-readonly.sql`)])) as Record<ProductionRolloutWaveId, string>,
    };
}

function relativeArtifacts(artifacts: ReturnType<typeof createArtifacts>): Record<string, unknown> {
    return {
        summaryJson: relative(artifacts.summaryJson),
        manifestJson: relative(artifacts.manifestJson),
        livePreflightSql: relative(artifacts.livePreflightSql),
        finalVerifySql: relative(artifacts.finalVerifySql),
        stagingHardeningLiveVerifySql: relative(artifacts.stagingHardeningLiveVerifySql),
        exactApproval: relative(artifacts.exactApproval),
        rollbackSwitch: relative(artifacts.rollbackSwitch),
        rolloutReceipt: relative(artifacts.rolloutReceipt),
        waveApply: Object.fromEntries(Object.entries(artifacts.waveApply).map(([key, value]) => [key, relative(value)])),
        waveVerify: Object.fromEntries(Object.entries(artifacts.waveVerify).map(([key, value]) => [key, relative(value)])),
    };
}

function persistCapture(outputDir: string, capture: PsqlCapture): void {
    writeFileSync(
        path.join(outputDir, `${capture.id}-psql-sanitized.txt`),
        `# stdout\n${capture.stdout}\n# stderr\n${capture.stderr}\n# exit\n${capture.exitCode ?? 'unknown'}\n`,
        'utf8',
    );
}

function captureSummary(capture: PsqlCapture): Record<string, unknown> {
    return {
        id: capture.id,
        ok: capture.ok,
        exitCode: capture.exitCode,
        writeAttempted: capture.writeAttempted,
    };
}

function evidenceSummary<T>(evidence: EvidenceValidation<T>): Record<string, unknown> {
    return {
        provided: evidence.provided,
        valid: evidence.valid,
        sha256: evidence.sha256,
        errors: evidence.errors,
    };
}

function migrationIdentity(entry: ProductionRolloutMigration): Record<string, string> {
    return { version: entry.version, name: entry.name, file: entry.file, sha256: entry.sha256 };
}

function latestPreflightPath(): string | null {
    const directory = path.join(root, 'outputs', 'launch-supabase-production-readonly-preflight');
    if (!existsSync(directory)) return null;
    return readdirSync(directory, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(directory, entry.name, 'summary.json'))
        .filter((entry) => existsSync(entry))
        .sort()
        .at(-1) ?? null;
}

function createOutputDir(startedAt: Date): string {
    const outputDir = path.join(
        root,
        'outputs',
        'launch-supabase-production-rollout-runner',
        startedAt.toISOString().replace(/[:.]/gu, '-'),
    );
    mkdirSync(outputDir, { recursive: true });
    return outputDir;
}

function writeSummary(filePath: string, value: Record<string, unknown>): void {
    writeFileSync(filePath, stableJson(value), 'utf8');
    const manifestPath = path.join(path.dirname(filePath), 'manifest.json');
    writeFileSync(manifestPath, stableJson(value), 'utf8');
}

function renderRollbackSwitchPlan(scopeSha256: string): string {
    return `# Supabase production rollout rollback/switch boundary\n\n` +
        `Target: ${PRODUCTION_PROJECT.ref}. Scope: ${scopeSha256}.\n\n` +
        `- Every wave is one short transaction containing only its pinned migration sources and exact history inserts.\n` +
        `- On an error before COMMIT, PostgreSQL rolls back that wave. The runner stops and never retries automatically.\n` +
        `- After a missing/ambiguous commit marker or failed verification, keep checkout disabled and generate a fresh read-only preflight.\n` +
        `- There are no generic down migrations. Use a reviewed fix-forward, or restore the verified encrypted public+auth backup into an isolated Supabase project.\n` +
        `- Verify schema, Auth, RLS, aggregate data and application probes in the isolated project before requesting a separate connection/project switch approval.\n` +
        `- This runner never restores, changes project URLs/keys, switches traffic, touches Google/Stripe/Storage, runs db push or repairs migration history.\n`;
}

function relative(filePath: string): string {
    return path.relative(root, filePath).split(path.sep).join('/');
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
