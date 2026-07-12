import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import type { Database } from '../../src/types/database.types';
import { LEGAL_POLICY_VERSION } from '../../src/lib/legal-policy';
import {
    FIXTURE_CLEANUP_DATABASE_ENV,
    buildDatabaseToolProcessEnvironment,
    buildPsqlEnvironment,
    sha256,
    stableJson,
} from './production-fixture-cleanup-shared';
import {
    PRODUCTION_AUTH_APPROVAL_ENVS,
    PRODUCTION_AUTH_CLEANUP_TARGET,
    PRODUCTION_AUTH_DEFAULT_JWT_EXPIRY_SECONDS,
    PRODUCTION_AUTH_FREEZE_CUTOFF,
    PRODUCTION_AUTH_INERT_CONFIRMATION,
    PRODUCTION_AUTH_INERT_CONFIRMATION_ENV,
    PRODUCTION_AUTH_OUTPUT_FILES,
    PRODUCTION_AUTH_REQUARANTINE_LEDGER_DIR_ENV,
    approvalEnvForPhase,
    beginAuthRequarantineRotation,
    buildAuthCleanupApproval,
    buildQuarantineUntil,
    confirmAuthRequarantineRotation,
    hashIdentitySet,
    readJsonEvidence,
    sanitizeAuthCleanupOutput,
    selectAuthQuarantineConfig,
    validateAuthPreflightEvidence,
    validateAuthRequarantineReceipt,
    validateAuthReducedReceipt,
    validateCheckpoint,
    validateCleanupInputs,
    type AuthCleanupCheckpoint,
    type AuthCleanupPhase,
    type AuthPreflightEvidence,
    type AuthQuarantineConfig,
    type AuthRequarantineCheckpoint,
    type AuthRequarantineReceipt,
    type AuthReducedReceipt,
    type FinalAuthPolicyReceipt,
    type ProductionAuthDatabaseAggregate,
} from './supabase-production-auth-cleanup-shared';
import { SUPABASE_ACCESS_TOKEN_ENV, SUPABASE_MANAGEMENT_API_BASE } from './supabase-auth-config-shared';

type Mode = 'plan' | 'preflight' | 'requarantine-preflight' | AuthCleanupPhase;

interface CliOptions {
    mode: Mode;
    backupReceiptPath: string | null;
    publicCleanupReceiptPath: string | null;
    evidencePath: string | null;
    checkpointPath: string | null;
    authReducedReceiptPath: string | null;
    rolloutReceiptPath: string | null;
    executeApproved: boolean;
}

interface SecureInputs {
    supabaseUrl: string;
    serviceRoleKey: string;
    databaseUrl: string;
    managementToken: string;
    adminEmail: string;
    teacherEmail: string;
}

interface IdentityState {
    users: User[];
    preserved: [User, User];
    candidates: User[];
    preservedSetSha256: string;
    candidateSetSha256: string;
    newestCreatedAt: string;
    identitiesCreatedAfterFreeze: number;
}

interface DatabaseDiscovery {
    tables: Set<string>;
    columns: Set<string>;
    profileCrmSyncTriggerCount: number;
}

interface RolloutReceipt {
    schemaVersion: 1;
    status: 'PRODUCTION_ROLLOUT_ALL_WAVES_APPLIED_AND_VERIFIED';
    targetProjectRef: string;
    completedAt: string;
    scopeSha256: string;
    allowlistSha256: string;
    through: 'deferred_rc_hardening';
    migrationCount: 25;
    migrationManifestSha256: string;
    preflightEvidenceSha256: string;
    backupReceiptSha256: string;
    publicCleanupReceiptSha256: string;
    authReducedQuarantinedReceiptSha256: string;
    googleFixturePolicyEvidenceSha256: string;
    stagingHardeningEvidenceSha256: string;
    sentryProductionHardeningEvidenceSha256: string;
    livePreflightSqlSha256: string;
    finalVerifySqlSha256: string;
    finalVerificationPassed: true;
    stagingOnlyMigrationAbsent: true;
    checkoutRemainedDisabledByOperatorAttestation: true;
    authFinalizeRequired: true;
}

interface ValidatedRolloutReceipt {
    value: RolloutReceipt;
    sha256: string;
}

interface LiveState {
    identity: IdentityState;
    database: ProductionAuthDatabaseAggregate;
    configuration: AuthQuarantineConfig;
}

interface PsqlResult {
    ok: boolean;
    stdout: string;
    stderr: string;
    status: number | null;
    error: string | null;
}

const root = process.cwd();
const PUBLIC_FIXTURE_TABLES = [
    'subscriptions',
    'student_teachers',
    'sessions',
    'payments',
    'leads',
    'processed_webhook_events',
    'fulfillment_jobs',
    'support_tickets',
    'admin_audit_log',
    'teacher_availability',
    'jobs',
    'crm_contacts',
    'crm_opportunities',
    'crm_tasks',
    'crm_activities',
    'crm_consents',
    'package_prices',
    'checkout_intents',
    'email_recipient_budget_usage',
    'fulfillment_effects',
] as const;
const REQUIRED_FINAL_TABLES = [
    'public.crm_contacts',
    'public.crm_opportunities',
    'public.crm_tasks',
    'public.crm_activities',
    'public.crm_consents',
    'public.package_prices',
    'public.checkout_intents',
    'public.email_recipient_budget_usage',
    'public.fulfillment_effects',
] as const;
const REQUIRED_FINAL_COLUMNS = [
    'public.profiles.adult_confirmed',
    'public.profiles.adult_confirmed_at',
    'public.profiles.age_policy_version',
    'public.profiles_private.stripe_customer_account_id',
    'public.profiles_private.stripe_customer_livemode',
    'public.profiles_private.drive_folder_url',
    'public.profiles_private.google_account_email',
] as const;

export function parseProductionAuthCleanupArgs(args: string[]): CliOptions {
    const mode = (args[0] ?? 'plan') as Mode;
    if (!['plan', 'preflight', 'requarantine-preflight', 'delete', 'resume-delete', 'finalize', 'resume-finalize', 're-quarantine'].includes(mode)) {
        throw new Error('Mode must be plan, preflight, requarantine-preflight, delete, resume-delete, finalize, resume-finalize or re-quarantine.');
    }
    const options: CliOptions = {
        mode,
        backupReceiptPath: null,
        publicCleanupReceiptPath: null,
        evidencePath: null,
        checkpointPath: null,
        authReducedReceiptPath: null,
        rolloutReceiptPath: null,
        executeApproved: false,
    };
    const pathFlags: Record<string, keyof Pick<CliOptions,
        'backupReceiptPath' | 'publicCleanupReceiptPath' | 'evidencePath' | 'checkpointPath'
        | 'authReducedReceiptPath' | 'rolloutReceiptPath'>> = {
        '--backup-receipt': 'backupReceiptPath',
        '--public-cleanup-receipt': 'publicCleanupReceiptPath',
        '--evidence': 'evidencePath',
        '--checkpoint': 'checkpointPath',
        '--auth-reduced-receipt': 'authReducedReceiptPath',
        '--rollout-receipt': 'rolloutReceiptPath',
    };
    for (let index = 1; index < args.length; index += 1) {
        const argument = args[index];
        if (argument === '--execute-approved') {
            if (options.executeApproved) throw new Error('--execute-approved may only be supplied once.');
            options.executeApproved = true;
            continue;
        }
        const key = pathFlags[argument];
        if (key) {
            const value = args[index + 1];
            if (!value || value.startsWith('--')) throw new Error(`${argument} requires a path.`);
            if (options[key]) throw new Error(`${argument} may only be supplied once.`);
            options[key] = value;
            index += 1;
            continue;
        }
        throw new Error(`Unknown production Auth cleanup argument: ${argument}`);
    }
    if (mode === 'plan' && args.length > 1) throw new Error('Plan mode accepts no additional arguments.');
    if ((mode === 'preflight' || mode === 'requarantine-preflight') && (options.executeApproved || options.evidencePath)) {
        throw new Error('Preflight is read-only and does not accept execution gates/evidence.');
    }
    if (['delete', 'resume-delete', 'finalize', 'resume-finalize', 're-quarantine'].includes(mode)
        && (!options.executeApproved || !options.evidencePath)) {
        throw new Error(`${mode} requires --execute-approved and --evidence.`);
    }
    if (mode === 'resume-delete' && !options.checkpointPath) throw new Error('resume-delete requires --checkpoint.');
    if (mode === 'delete' && options.checkpointPath) throw new Error('delete does not accept --checkpoint; use resume-delete.');
    if ((mode === 'finalize' || mode === 'resume-finalize')
        && (!options.authReducedReceiptPath || !options.rolloutReceiptPath)) {
        throw new Error(`${mode} requires --auth-reduced-receipt and --rollout-receipt.`);
    }
    if (mode === 'resume-finalize' && !options.checkpointPath) throw new Error('resume-finalize requires --checkpoint.');
    if (mode === 'finalize' && options.checkpointPath) throw new Error('finalize does not accept --checkpoint; use resume-finalize.');
    if ((mode === 'requarantine-preflight' || mode === 're-quarantine') && !options.authReducedReceiptPath) {
        throw new Error(`${mode} requires --auth-reduced-receipt.`);
    }
    if ((mode === 'requarantine-preflight' || mode === 're-quarantine')
        && (options.checkpointPath || options.rolloutReceiptPath)) {
        throw new Error(`${mode} does not accept --checkpoint or --rollout-receipt.`);
    }
    if (mode !== 'plan' && (!options.backupReceiptPath || !options.publicCleanupReceiptPath)) {
        throw new Error(`${mode} requires --backup-receipt and --public-cleanup-receipt.`);
    }
    return options;
}

export function isRetryableSupabaseAdminError(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false;
    const status = (error as { status?: unknown }).status;
    return typeof status === 'number' && [429, 500, 502, 503, 504].includes(status);
}

export function classifyReadiness(input: {
    users: number;
    candidates: number;
    profiles: number;
    profilesPrivate: number;
    checkpointProvided: boolean;
    authReducedReceiptProvided: boolean;
    rolloutReceiptProvided: boolean;
    finalSchemaReady: boolean;
    quarantineElapsed: boolean;
    requarantineRequested?: boolean;
}): AuthPreflightEvidence['readiness'] | 'BLOCKED' {
    if (input.requarantineRequested) {
        return input.users === 2 && input.candidates === 0
            && input.profiles === 0 && input.profilesPrivate === 0
            && !input.checkpointProvided && input.authReducedReceiptProvided
            && !input.rolloutReceiptProvided
            ? 'REQUARANTINE_READY'
            : 'BLOCKED';
    }
    if (input.users === 138 && input.candidates === 136 && input.profiles === 0
        && input.profilesPrivate === 0 && !input.checkpointProvided && !input.authReducedReceiptProvided) {
        return 'INITIAL_DELETE_READY';
    }
    if (input.users >= 2 && input.users <= 138 && input.candidates >= 0 && input.candidates <= 136
        && input.profiles === 0 && input.profilesPrivate === 0 && input.checkpointProvided
        && !input.authReducedReceiptProvided) {
        return 'RESUME_DELETE_READY';
    }
    const finalizeCommon = input.users === 2 && input.candidates === 0
        && input.authReducedReceiptProvided && input.rolloutReceiptProvided
        && input.finalSchemaReady && input.quarantineElapsed;
    if (finalizeCommon && input.profiles === 0 && input.profilesPrivate === 0 && !input.checkpointProvided) {
        return 'FINALIZE_READY';
    }
    if (finalizeCommon && input.checkpointProvided
        && ((input.profiles === 0 && input.profilesPrivate === 0)
            || (input.profiles === 2 && input.profilesPrivate >= 0 && input.profilesPrivate <= 2))) {
        return 'RESUME_FINALIZE_READY';
    }
    return 'BLOCKED';
}

async function main(): Promise<void> {
    const startedAt = new Date();
    const outputDir = createOutputDir(startedAt);
    let options: CliOptions;
    try {
        options = parseProductionAuthCleanupArgs(process.argv.slice(2));
    } catch (error) {
        writeSummary(outputDir, {
            schemaVersion: 1,
            status: 'BLOCKED_ARGUMENTS',
            externalWritePerformed: false,
            networkAccessPerformed: false,
            error: safeMessage(error),
        });
        throw error;
    }

    if (options.mode === 'plan') {
        writePlan(outputDir);
        return;
    }

    const cleanupValidation = validateCleanupInputs({
        backupReceiptPath: options.backupReceiptPath as string,
        publicCleanupReceiptPath: options.publicCleanupReceiptPath as string,
        root,
    });
    if (!cleanupValidation.ok || !cleanupValidation.value) {
        writeSummary(outputDir, {
            schemaVersion: 1,
            status: 'BLOCKED_CLEANUP_EVIDENCE',
            errors: cleanupValidation.errors,
            externalWritePerformed: false,
            networkAccessPerformed: false,
        });
        throw new Error(cleanupValidation.errors.join(' '));
    }
    const cleanup = cleanupValidation.value;

    if (options.mode === 'preflight' || options.mode === 'requarantine-preflight') {
        await runPreflight(outputDir, options, cleanup);
        return;
    }
    if (options.mode === 'delete' || options.mode === 'resume-delete') {
        await runDeletePhase(outputDir, options, cleanup);
        return;
    }
    if (options.mode === 're-quarantine') {
        await runRequarantinePhase(outputDir, options, cleanup);
        return;
    }
    await runFinalizePhase(outputDir, options, cleanup);
}

function writePlan(outputDir: string): void {
    const dummy = 'a'.repeat(64);
    const approvalTemplates = Object.fromEntries(
        (['delete', 'resume-delete', 'finalize', 'resume-finalize', 're-quarantine'] as AuthCleanupPhase[]).map((phase) => [
            phase,
            buildAuthCleanupApproval({
                phase,
                evidenceSha256: dummy,
                publicCleanupReceiptSha256: dummy,
                backupReceiptSha256: dummy,
                preservedSetSha256: dummy,
                candidateCount: phase.includes('finalize') || phase === 're-quarantine' ? 0 : 136,
                candidateSetSha256: dummy,
                checkpointSha256: phase.startsWith('resume') ? dummy : null,
                authReducedReceiptSha256: phase.includes('finalize') || phase === 're-quarantine' ? dummy : null,
                rolloutReceiptSha256: phase.includes('finalize') ? dummy : null,
                quarantineUntil: phase.includes('finalize') || phase === 're-quarantine' ? '<FROM_AUTH_REDUCED_RECEIPT>' : null,
            }).replaceAll(dummy, '<DYNAMIC_SHA256>'),
        ]),
    );
    writeSummary(outputDir, {
        schemaVersion: 1,
        status: 'PLAN_ONLY_READY',
        targetProjectRef: PRODUCTION_AUTH_CLEANUP_TARGET.projectRef,
        externalWritePerformed: false,
        networkAccessPerformed: false,
        operation: {
            preserve: ['TEST_ADMIN_EMAIL', 'TEST_TEACHER_EMAIL'],
            deleteOtherAuthUsers: 136,
            passwordRotation: 'two random values passed directly to Admin API and never persisted',
            refreshSessions: 'must verify zero after rotation',
            accessJwt: `production remains inert for JWT TTL plus ${PRODUCTION_AUTH_DEFAULT_JWT_EXPIRY_SECONDS === 3600 ? 'five-minute skew' : 'safety skew'}`,
            finalProfiles: 'created only after all 25 migrations in seven rollout waves and quarantine expiry',
            signup: 'must remain disabled',
            checkout: 'must remain disabled',
            outboundEmails: 'forbidden; password resets are final-window only',
            storage: 'no owned object permitted; no Storage write',
            googleDrive: '110 observed fixture folders remain untouched and require a separate policy/action',
            stripe: 'untouched',
        },
        sequence: [
            'Verify the auth-inclusive backup and public-cleanup v2 receipt.',
            'Run preflight; it reads Auth/config/database aggregates and emits no identity values.',
            'Execute initial delete or an explicitly approved resume; stop on any partial failure.',
            'If the 65-minute credential window becomes too short, run the separate re-quarantine preflight and exact-approved rotation; it deletes no users and emits a fresh chained receipt.',
            `Consume ${PRODUCTION_AUTH_OUTPUT_FILES.reducedReceipt} in the production rollout runner.`,
            'Apply all 25 allowlisted migrations in seven waves while production remains quarantined.',
            'After quarantine expiry, run a fresh preflight with the rollout receipt.',
            'Finalize the two minimal profiles/private rows and emit the final Auth policy receipt.',
            'Send password reset emails only in the separately approved final launch window.',
        ],
        requiredInertConfirmation: {
            env: PRODUCTION_AUTH_INERT_CONFIRMATION_ENV,
            exactValue: PRODUCTION_AUTH_INERT_CONFIRMATION,
        },
        approvalEnvironments: PRODUCTION_AUTH_APPROVAL_ENVS,
        approvalTemplates,
    });
    console.log(`PLAN_ONLY_READY: ${path.join(outputDir, PRODUCTION_AUTH_OUTPUT_FILES.summary)}`);
}

async function runPreflight(
    outputDir: string,
    options: CliOptions,
    cleanup: NonNullable<ReturnType<typeof validateCleanupInputs>['value']>,
): Promise<void> {
    const secureInputs = loadSecureInputs();
    const checkpointInput = options.checkpointPath
        ? loadAndValidateCheckpoint(options.checkpointPath, cleanup)
        : null;
    const reducedInput = options.authReducedReceiptPath
        ? loadAndValidateReducedReceipt(options.authReducedReceiptPath, cleanup)
        : null;
    const rolloutInput = options.rolloutReceiptPath
        ? loadAndValidateRolloutReceipt(options.rolloutReceiptPath, cleanup, reducedInput)
        : null;
    const live = await collectLiveState(secureInputs);
    const profileCount = live.database.counts['public.profiles'] ?? -1;
    const privateCount = live.database.counts['public.profiles_private'] ?? -1;
    const quarantineUntil = reducedInput?.value.quarantineUntil ?? null;
    const quarantineElapsed = quarantineUntil ? Date.now() >= Date.parse(quarantineUntil) : false;
    const readiness = classifyReadiness({
        users: live.identity.users.length,
        candidates: live.identity.candidates.length,
        profiles: profileCount,
        profilesPrivate: privateCount,
        checkpointProvided: Boolean(checkpointInput),
        authReducedReceiptProvided: Boolean(reducedInput),
        rolloutReceiptProvided: Boolean(rolloutInput),
        finalSchemaReady: live.database.finalSchemaReady,
        quarantineElapsed,
        requarantineRequested: options.mode === 'requarantine-preflight',
    });
    const errors = validateLiveSafety(live, readiness);
    if (checkpointInput && checkpointInput.value.preservedSetSha256 !== live.identity.preservedSetSha256) {
        errors.push('Checkpoint preserved-set hash does not match the current exact preserved identities.');
    }
    if (checkpointInput && !['IN_PROGRESS', 'PARTIAL_FAILURE'].includes(checkpointInput.value.status)) {
        errors.push('Only an interrupted or partial-failure checkpoint may be resumed.');
    }
    if (checkpointInput && !reducedInput
        && !['delete', 'resume-delete'].includes(checkpointInput.value.phase)) {
        errors.push('Auth reduction may resume only from a delete-phase checkpoint.');
    }
    if (checkpointInput && reducedInput
        && !['finalize', 'resume-finalize'].includes(checkpointInput.value.phase)) {
        errors.push('Auth finalize may resume only from a finalize-phase checkpoint.');
    }
    if (reducedInput && reducedInput.value.preservedSetSha256 !== live.identity.preservedSetSha256) {
        errors.push('Auth-reduced preserved-set hash does not match the current exact preserved identities.');
    }
    if (readiness === 'BLOCKED') errors.push('Observed state does not match an approved initial/resume/finalize state.');
    if (errors.length > 0 || readiness === 'BLOCKED') {
        writeSummary(outputDir, {
            schemaVersion: 1,
            status: 'BLOCKED_READONLY_PREFLIGHT',
            targetProjectRef: PRODUCTION_AUTH_CLEANUP_TARGET.projectRef,
            errors,
            aggregates: redactedLiveAggregates(live),
            externalWritePerformed: false,
            networkAccessPerformed: true,
            outboundEmailsSent: false,
        });
        throw new Error(errors.join(' '));
    }
    const phase = phaseForReadiness(readiness);
    const createdAt = new Date().toISOString();
    const evidence: AuthPreflightEvidence = {
        schemaVersion: 1,
        status: 'READY',
        createdAt,
        targetProjectRef: PRODUCTION_AUTH_CLEANUP_TARGET.projectRef,
        readiness,
        approvalPhase: phase,
        publicCleanupReceiptSha256: cleanup.publicCleanupReceiptSha256,
        backupReceiptSha256: cleanup.backupReceiptSha256,
        manifestSha256: cleanup.manifestSha256,
        freezeCutoff: PRODUCTION_AUTH_FREEZE_CUTOFF,
        baselineProfileRoles: {
            admin: 1,
            teacher: 1,
            student: 136,
            source: 'cleanup_v2_manifest',
        },
        auth: {
            users: live.identity.users.length,
            preserved: 2,
            candidates: live.identity.candidates.length,
            preservedSetSha256: live.identity.preservedSetSha256,
            candidateSetSha256: live.identity.candidateSetSha256,
            newestCreatedAt: live.identity.newestCreatedAt,
            identitiesCreatedAfterFreeze: 0,
        },
        database: live.database,
        configuration: live.configuration,
        checkpointSha256: checkpointInput?.sha256 ?? null,
        authReducedReceiptSha256: reducedInput?.sha256 ?? null,
        rolloutReceiptSha256: rolloutInput?.sha256 ?? null,
        quarantineUntil,
        quarantineElapsed,
        safety: {
            readOnly: true,
            noEmailsPersisted: true,
            noUuidsPersisted: true,
            outboundEmailsSent: false,
            externalWritePerformed: false,
            googleDriveFixtureFolders: 'UNTOUCHED_110_OBSERVED',
        },
    };
    const evidencePath = path.join(outputDir, PRODUCTION_AUTH_OUTPUT_FILES.evidence);
    writeIdentityFreeJson(evidencePath, evidence, 'Preflight evidence');
    const evidenceSha256 = sha256(readFileSync(evidencePath));
    const approval = buildAuthCleanupApproval({
        phase,
        evidenceSha256,
        publicCleanupReceiptSha256: cleanup.publicCleanupReceiptSha256,
        backupReceiptSha256: cleanup.backupReceiptSha256,
        preservedSetSha256: live.identity.preservedSetSha256,
        candidateCount: live.identity.candidates.length,
        candidateSetSha256: live.identity.candidateSetSha256,
        checkpointSha256: checkpointInput?.sha256 ?? null,
        authReducedReceiptSha256: reducedInput?.sha256 ?? null,
        rolloutReceiptSha256: rolloutInput?.sha256 ?? null,
        quarantineUntil,
    });
    writeFileSync(path.join(outputDir, PRODUCTION_AUTH_OUTPUT_FILES.approval), `${approval}\n`, 'utf8');
    writeSummary(outputDir, {
        schemaVersion: 1,
        status: readiness,
        targetProjectRef: PRODUCTION_AUTH_CLEANUP_TARGET.projectRef,
        evidenceFile: PRODUCTION_AUTH_OUTPUT_FILES.evidence,
        evidenceSha256,
        approvalFile: PRODUCTION_AUTH_OUTPUT_FILES.approval,
        approvalEnvironment: approvalEnvForPhase(phase),
        externalWritePerformed: false,
        networkAccessPerformed: true,
        outboundEmailsSent: false,
        googleDriveFixtureFolders: 'UNTOUCHED_110_OBSERVED',
    });
    console.log(`${readiness}: ${path.join(outputDir, PRODUCTION_AUTH_OUTPUT_FILES.summary)}`);
}

async function runDeletePhase(
    outputDir: string,
    options: CliOptions,
    cleanup: NonNullable<ReturnType<typeof validateCleanupInputs>['value']>,
): Promise<void> {
    const phase = options.mode as 'delete' | 'resume-delete';
    const evidenceInput = readJsonEvidence<AuthPreflightEvidence>(options.evidencePath as string);
    const evidenceValidation = validateAuthPreflightEvidence(evidenceInput.value, phase);
    if (!evidenceValidation.ok || !evidenceValidation.value) throw new Error(evidenceValidation.errors.join(' '));
    const evidence = evidenceValidation.value;
    assertEvidenceCleanupBindings(evidence, cleanup);
    const checkpointInput = options.checkpointPath
        ? loadAndValidateCheckpoint(options.checkpointPath, cleanup)
        : null;
    if (phase === 'resume-delete' && checkpointInput?.sha256 !== evidence.checkpointSha256) {
        throw new Error('Resume checkpoint hash does not match the fresh evidence.');
    }
    if (checkpointInput && checkpointInput.value.preservedSetSha256 !== evidence.auth.preservedSetSha256) {
        throw new Error('Resume checkpoint preserved-set hash mismatch.');
    }
    if (checkpointInput && !['IN_PROGRESS', 'PARTIAL_FAILURE'].includes(checkpointInput.value.status)) {
        throw new Error('Resume requires an interrupted or partial-failure checkpoint.');
    }
    if (checkpointInput && !['delete', 'resume-delete'].includes(checkpointInput.value.phase)) {
        throw new Error('Resume-delete checkpoint phase mismatch.');
    }
    const approval = buildAuthCleanupApproval({
        phase,
        evidenceSha256: evidenceInput.sha256,
        publicCleanupReceiptSha256: cleanup.publicCleanupReceiptSha256,
        backupReceiptSha256: cleanup.backupReceiptSha256,
        preservedSetSha256: evidence.auth.preservedSetSha256,
        candidateCount: evidence.auth.candidates,
        candidateSetSha256: evidence.auth.candidateSetSha256,
        checkpointSha256: checkpointInput?.sha256 ?? null,
    });
    assertExecutionApprovals(phase, approval);
    const secureInputs = loadSecureInputs();
    const client = buildSupabaseAdminClient(secureInputs);
    const live = await collectLiveState(secureInputs, client);
    assertLiveMatchesEvidence(live, evidence);
    const safetyErrors = validateLiveSafety(live, evidence.readiness);
    if (safetyErrors.length > 0) throw new Error(safetyErrors.join(' '));

    let checkpoint: AuthCleanupCheckpoint = checkpointInput?.value ?? {
        schemaVersion: 1,
        targetProjectRef: PRODUCTION_AUTH_CLEANUP_TARGET.projectRef,
        phase,
        status: 'IN_PROGRESS',
        startedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        publicCleanupReceiptSha256: cleanup.publicCleanupReceiptSha256,
        backupReceiptSha256: cleanup.backupReceiptSha256,
        freezeCutoff: PRODUCTION_AUTH_FREEZE_CUTOFF,
        preservedSetSha256: live.identity.preservedSetSha256,
        initialCandidateCount: 136,
        initialCandidateSetSha256: live.identity.candidateSetSha256,
        remainingCandidateCount: live.identity.candidates.length,
        remainingCandidateSetSha256: live.identity.candidateSetSha256,
        deletedCount: 136 - live.identity.candidates.length,
        passwordRotationsCompleted: 0,
        profilesFinalized: false,
        lastErrorCategory: null,
        externalWritePerformed: false,
    };
    if (phase === 'resume-delete') checkpoint = { ...checkpoint, phase, status: 'IN_PROGRESS', updatedAt: new Date().toISOString(), lastErrorCategory: null };
    const checkpointPath = path.join(outputDir, PRODUCTION_AUTH_OUTPUT_FILES.checkpoint);
    writeCheckpoint(checkpointPath, checkpoint);

    const candidates = [...live.identity.candidates].sort((left, right) => left.id.localeCompare(right.id));
    const remaining = new Map(candidates.map((user) => [user.id, user]));
    try {
        for (const candidate of candidates) {
            await retryAdminCall(async () => {
                const { error } = await client.auth.admin.deleteUser(candidate.id, false);
                if (error) throw error;
            });
            remaining.delete(candidate.id);
            await assertPreservedUsersStillExist(client, live.identity.preserved);
            checkpoint = {
                ...checkpoint,
                status: 'IN_PROGRESS',
                updatedAt: new Date().toISOString(),
                remainingCandidateCount: remaining.size,
                remainingCandidateSetSha256: hashIdentitySet([...remaining.keys()]),
                deletedCount: 136 - remaining.size,
                externalWritePerformed: true,
            };
            writeCheckpoint(checkpointPath, checkpoint);
            if (checkpoint.deletedCount % 10 === 0 || remaining.size === 0) {
                console.log(`[launch:supabase-production-auth-cleanup] deleted=${checkpoint.deletedCount} remaining=${remaining.size}`);
            }
            if (remaining.size > 0) await delay(250);
        }

        const reducedIdentity = classifyIdentityState(await listAllAuthUsers(client), secureInputs);
        if (reducedIdentity.users.length !== 2 || reducedIdentity.candidates.length !== 0
            || reducedIdentity.preservedSetSha256 !== live.identity.preservedSetSha256) {
            throw taggedError('POST_DELETE_AUTH_MISMATCH');
        }

        checkpoint = { ...checkpoint, passwordRotationsCompleted: 0, updatedAt: new Date().toISOString() };
        writeCheckpoint(checkpointPath, checkpoint);
        for (const preserved of reducedIdentity.preserved) {
            let randomPassword = randomBytes(48).toString('base64url');
            try {
                await retryAdminCall(async () => {
                    const { error } = await client.auth.admin.updateUserById(preserved.id, { password: randomPassword });
                    if (error) throw error;
                });
            } finally {
                randomPassword = '';
            }
            await assertPreservedUsersStillExist(client, reducedIdentity.preserved);
            checkpoint = {
                ...checkpoint,
                passwordRotationsCompleted: checkpoint.passwordRotationsCompleted + 1,
                updatedAt: new Date().toISOString(),
                externalWritePerformed: true,
            };
            writeCheckpoint(checkpointPath, checkpoint);
        }

        const after = await collectLiveState(secureInputs, client);
        if (after.identity.users.length !== 2 || after.identity.candidates.length !== 0
            || after.identity.preservedSetSha256 !== live.identity.preservedSetSha256
            || (after.database.counts['public.profiles'] ?? -1) !== 0
            || (after.database.counts['public.profiles_private'] ?? -1) !== 0
            || after.database.fixtureRows !== 0 || after.database.storageOwnedObjects !== 0
            || after.database.authSessions !== 0 || after.database.authRefreshTokens !== 0
            || !after.configuration.disableSignup) {
            throw taggedError('POST_ROTATION_QUARANTINE_MISMATCH');
        }
        const completedAt = new Date().toISOString();
        const quarantineUntil = buildQuarantineUntil(completedAt, after.configuration.jwtExpirySeconds);
        const receipt: AuthReducedReceipt = {
            schemaVersion: 1,
            status: 'AUTH_REDUCED_QUARANTINED',
            targetProjectRef: PRODUCTION_AUTH_CLEANUP_TARGET.projectRef,
            completedAt,
            publicCleanupReceiptSha256: cleanup.publicCleanupReceiptSha256,
            backupReceiptSha256: cleanup.backupReceiptSha256,
            authUsers: 2,
            profiles: 0,
            fixtureStudents: 0,
            passwordsRotatedUnretained: true,
            quarantineUntil,
            storageObjectsTouched: false,
            externalProvidersTouched: false,
            preservedSetSha256: after.identity.preservedSetSha256,
            deletedCandidateSetSha256: checkpoint.initialCandidateSetSha256,
            freezeCutoff: PRODUCTION_AUTH_FREEZE_CUTOFF,
            jwtExpirySeconds: after.configuration.jwtExpirySeconds,
            jwtExpirySource: after.configuration.jwtExpirySource,
            refreshSessionsRemaining: 0,
            resetEmailsSent: false,
            googleDriveFixtureFolders: 'UNTOUCHED_110_OBSERVED',
        };
        writeIdentityFreeJson(
            path.join(outputDir, PRODUCTION_AUTH_OUTPUT_FILES.reducedReceipt),
            receipt,
            'Auth-reduced receipt',
        );
        checkpoint = {
            ...checkpoint,
            status: 'AUTH_REDUCED_QUARANTINED',
            updatedAt: completedAt,
            remainingCandidateCount: 0,
            remainingCandidateSetSha256: hashIdentitySet([]),
            deletedCount: 136,
            passwordRotationsCompleted: 2,
            lastErrorCategory: null,
            externalWritePerformed: true,
        };
        writeCheckpoint(checkpointPath, checkpoint);
        writeSummary(outputDir, {
            schemaVersion: 1,
            status: 'AUTH_REDUCED_QUARANTINED',
            targetProjectRef: PRODUCTION_AUTH_CLEANUP_TARGET.projectRef,
            completedAt,
            authUsers: 2,
            profiles: 0,
            fixtureStudents: 0,
            refreshSessionsRemaining: 0,
            quarantineUntil,
            receiptFile: PRODUCTION_AUTH_OUTPUT_FILES.reducedReceipt,
            checkpointFile: PRODUCTION_AUTH_OUTPUT_FILES.checkpoint,
            externalWritePerformed: true,
            outboundEmailsSent: false,
            storageObjectsTouched: false,
            externalProvidersTouched: false,
            googleDriveFixtureFolders: 'UNTOUCHED_110_OBSERVED',
            nextAction: 'Keep production inert; apply the 25 rollout migrations in seven waves using this receipt, then wait until quarantineUntil before Auth finalize.',
        });
        console.log(`AUTH_REDUCED_QUARANTINED: ${path.join(outputDir, PRODUCTION_AUTH_OUTPUT_FILES.summary)}`);
    } catch (error) {
        checkpoint = await refreshFailureCheckpoint(checkpoint, checkpointPath, client, secureInputs, error);
        writeSummary(outputDir, {
            schemaVersion: 1,
            status: 'PARTIAL_FAILURE_STOPPED_NEW_APPROVAL_REQUIRED',
            targetProjectRef: PRODUCTION_AUTH_CLEANUP_TARGET.projectRef,
            remainingCandidates: checkpoint.remainingCandidateCount,
            deletedCandidates: checkpoint.deletedCount,
            passwordRotationsCompleted: checkpoint.passwordRotationsCompleted,
            checkpointFile: PRODUCTION_AUTH_OUTPUT_FILES.checkpoint,
            errorCategory: checkpoint.lastErrorCategory,
            externalWritePerformed: checkpoint.externalWritePerformed,
            outboundEmailsSent: false,
            storageObjectsTouched: false,
            externalProvidersTouched: false,
            nextAction: 'Do not retry automatically. Run a new read-only preflight with this checkpoint and obtain the exact resume approval.',
        });
        throw error;
    }
}

async function runRequarantinePhase(
    outputDir: string,
    options: CliOptions,
    cleanup: NonNullable<ReturnType<typeof validateCleanupInputs>['value']>,
): Promise<void> {
    const phase = 're-quarantine' as const;
    const evidenceInput = readJsonEvidence<AuthPreflightEvidence>(options.evidencePath as string);
    const evidenceValidation = validateAuthPreflightEvidence(evidenceInput.value, phase);
    if (!evidenceValidation.ok || !evidenceValidation.value) throw new Error(evidenceValidation.errors.join(' '));
    const evidence = evidenceValidation.value;
    assertEvidenceCleanupBindings(evidence, cleanup);
    const prior = loadAndValidateReducedReceipt(options.authReducedReceiptPath as string, cleanup);
    if (prior.sha256 !== evidence.authReducedReceiptSha256
        || prior.value.preservedSetSha256 !== evidence.auth.preservedSetSha256) {
        throw new Error('Re-quarantine prior receipt does not match the fresh evidence/preserved set.');
    }
    const approval = buildAuthCleanupApproval({
        phase,
        evidenceSha256: evidenceInput.sha256,
        publicCleanupReceiptSha256: cleanup.publicCleanupReceiptSha256,
        backupReceiptSha256: cleanup.backupReceiptSha256,
        preservedSetSha256: evidence.auth.preservedSetSha256,
        candidateCount: 0,
        candidateSetSha256: evidence.auth.candidateSetSha256,
        authReducedReceiptSha256: prior.sha256,
        quarantineUntil: prior.value.quarantineUntil,
    });
    assertExecutionApprovals(phase, approval);
    const ledgerRoot = validateRequarantineLedgerDirectory(
        process.env[PRODUCTION_AUTH_REQUARANTINE_LEDGER_DIR_ENV] ?? '',
    );

    const secureInputs = loadSecureInputs();
    const client = buildSupabaseAdminClient(secureInputs);
    const live = await collectLiveState(secureInputs, client);
    assertLiveMatchesEvidence(live, evidence);
    const safetyErrors = validateLiveSafety(live, evidence.readiness);
    if (safetyErrors.length > 0) throw new Error(safetyErrors.join(' '));
    if (live.identity.preservedSetSha256 !== prior.value.preservedSetSha256) {
        throw new Error('Re-quarantine preserved identities differ from the prior Auth-reduced receipt.');
    }
    acquireRequarantineOneShotLock(evidenceInput.sha256, prior.sha256, ledgerRoot);

    const startedAt = new Date().toISOString();
    const checkpointPath = path.join(outputDir, PRODUCTION_AUTH_OUTPUT_FILES.requarantineCheckpoint);
    let checkpoint: AuthRequarantineCheckpoint = {
        schemaVersion: 1,
        targetProjectRef: PRODUCTION_AUTH_CLEANUP_TARGET.projectRef,
        status: 'IN_PROGRESS',
        startedAt,
        updatedAt: startedAt,
        previousAuthReducedReceiptSha256: prior.sha256,
        publicCleanupReceiptSha256: cleanup.publicCleanupReceiptSha256,
        backupReceiptSha256: cleanup.backupReceiptSha256,
        preservedSetSha256: live.identity.preservedSetSha256,
        passwordRotationsAttempted: 0,
        passwordRotationsCompleted: 0,
        externalWritePerformed: false,
        pendingWriteAttempt: false,
        lastErrorCategory: null,
    };
    writeIdentityFreeJson(checkpointPath, checkpoint, 'Auth re-quarantine checkpoint');

    try {
        const preserved = [...live.identity.preserved].sort((left, right) => left.id.localeCompare(right.id));
        for (const user of preserved) {
            checkpoint = beginAuthRequarantineRotation(checkpoint, new Date().toISOString());
            writeIdentityFreeJson(checkpointPath, checkpoint, 'Auth re-quarantine checkpoint');
            let randomPassword = randomBytes(48).toString('base64url');
            try {
                await retryAdminCall(async () => {
                    const { error } = await client.auth.admin.updateUserById(user.id, { password: randomPassword });
                    if (error) throw error;
                });
            } finally {
                randomPassword = '';
            }
            checkpoint = confirmAuthRequarantineRotation(checkpoint, new Date().toISOString());
            writeIdentityFreeJson(checkpointPath, checkpoint, 'Auth re-quarantine checkpoint');
            await assertPreservedUsersStillExist(client, live.identity.preserved);
        }

        const after = await collectLiveState(secureInputs, client);
        if (after.identity.users.length !== 2 || after.identity.candidates.length !== 0
            || after.identity.preservedSetSha256 !== prior.value.preservedSetSha256
            || (after.database.counts['public.profiles'] ?? -1) !== 0
            || (after.database.counts['public.profiles_private'] ?? -1) !== 0
            || after.database.fixtureRows !== 0 || after.database.storageOwnedObjects !== 0
            || after.database.authSessions !== 0 || after.database.authRefreshTokens !== 0
            || !after.configuration.disableSignup) {
            throw taggedError('POST_REQUARANTINE_STATE_MISMATCH');
        }
        const completedAt = new Date().toISOString();
        const quarantineUntil = buildQuarantineUntil(completedAt, after.configuration.jwtExpirySeconds);
        const receipt: AuthRequarantineReceipt = {
            schemaVersion: 1,
            status: 'AUTH_REDUCED_QUARANTINED',
            targetProjectRef: PRODUCTION_AUTH_CLEANUP_TARGET.projectRef,
            completedAt,
            publicCleanupReceiptSha256: cleanup.publicCleanupReceiptSha256,
            backupReceiptSha256: cleanup.backupReceiptSha256,
            authUsers: 2,
            profiles: 0,
            fixtureStudents: 0,
            passwordsRotatedUnretained: true,
            quarantineUntil,
            storageObjectsTouched: false,
            externalProvidersTouched: false,
            preservedSetSha256: after.identity.preservedSetSha256,
            deletedCandidateSetSha256: prior.value.deletedCandidateSetSha256,
            freezeCutoff: PRODUCTION_AUTH_FREEZE_CUTOFF,
            jwtExpirySeconds: after.configuration.jwtExpirySeconds,
            jwtExpirySource: after.configuration.jwtExpirySource,
            refreshSessionsRemaining: 0,
            resetEmailsSent: false,
            googleDriveFixtureFolders: 'UNTOUCHED_110_OBSERVED',
            requarantine: true,
            preflightEvidenceSha256: evidenceInput.sha256,
            previousAuthReducedReceiptSha256: prior.sha256,
            passwordRotationsCompleted: 2,
            authSessionsObservedBefore: live.database.authSessions,
            refreshSessionsObservedBefore: live.database.authRefreshTokens,
            authSessionsRemaining: 0,
            refreshSessionsAbsentAndVerified: true,
            refreshSessionVerificationMethod: 'PASSWORD_ROTATION_WITH_ZERO_SESSION_READBACK',
        };
        const receiptValidation = validateAuthRequarantineReceipt(receipt, {
            publicCleanupReceiptSha256: cleanup.publicCleanupReceiptSha256,
            backupReceiptSha256: cleanup.backupReceiptSha256,
            preservedSetSha256: after.identity.preservedSetSha256,
            preflightEvidenceSha256: evidenceInput.sha256,
            previousAuthReducedReceiptSha256: prior.sha256,
        });
        if (!receiptValidation.ok || !receiptValidation.value) {
            throw new Error(`Auth re-quarantine receipt self-validation failed: ${receiptValidation.errors.join(' ')}`);
        }
        writeIdentityFreeJson(
            path.join(outputDir, PRODUCTION_AUTH_OUTPUT_FILES.requarantinedReceipt),
            receiptValidation.value,
            'Auth re-quarantine receipt',
        );
        checkpoint = {
            ...checkpoint,
            status: 'AUTH_REQUARANTINED',
            updatedAt: completedAt,
            passwordRotationsAttempted: 2,
            passwordRotationsCompleted: 2,
            externalWritePerformed: true,
            pendingWriteAttempt: false,
            lastErrorCategory: null,
        };
        writeIdentityFreeJson(checkpointPath, checkpoint, 'Auth re-quarantine checkpoint');
        writeSummary(outputDir, {
            schemaVersion: 1,
            status: 'AUTH_REQUARANTINED',
            targetProjectRef: PRODUCTION_AUTH_CLEANUP_TARGET.projectRef,
            completedAt,
            authUsers: 2,
            profiles: 0,
            candidates: 0,
            passwordRotationsCompleted: 2,
            authSessionsObservedBefore: live.database.authSessions,
            refreshSessionsObservedBefore: live.database.authRefreshTokens,
            authSessionsRemaining: 0,
            refreshSessionsRemaining: 0,
            quarantineUntil,
            previousAuthReducedReceiptSha256: prior.sha256,
            receiptFile: PRODUCTION_AUTH_OUTPUT_FILES.requarantinedReceipt,
            checkpointFile: PRODUCTION_AUTH_OUTPUT_FILES.requarantineCheckpoint,
            externalWritePerformed: true,
            outboundEmailsSent: false,
            usersDeleted: 0,
            storageObjectsTouched: false,
            externalProvidersTouched: false,
            nextAction: 'Keep production inert and use the fresh chained receipt for a new rollout preflight/window.',
        });
        console.log(`AUTH_REQUARANTINED: ${path.join(outputDir, PRODUCTION_AUTH_OUTPUT_FILES.summary)}`);
    } catch (error) {
        checkpoint = {
            ...checkpoint,
            status: 'PARTIAL_FAILURE',
            updatedAt: new Date().toISOString(),
            lastErrorCategory: errorCategory(error),
        };
        writeIdentityFreeJson(checkpointPath, checkpoint, 'Auth re-quarantine checkpoint');
        writeSummary(outputDir, {
            schemaVersion: 1,
            status: 'REQUARANTINE_PARTIAL_FAILURE_STOPPED_NEW_PREFLIGHT_AND_APPROVAL_REQUIRED',
            targetProjectRef: PRODUCTION_AUTH_CLEANUP_TARGET.projectRef,
            passwordRotationsAttempted: checkpoint.passwordRotationsAttempted,
            passwordRotationsCompleted: checkpoint.passwordRotationsCompleted,
            checkpointFile: PRODUCTION_AUTH_OUTPUT_FILES.requarantineCheckpoint,
            errorCategory: checkpoint.lastErrorCategory,
            externalWritePerformed: checkpoint.externalWritePerformed,
            pendingWriteAttempt: checkpoint.pendingWriteAttempt,
            outboundEmailsSent: false,
            usersDeleted: 0,
            storageObjectsTouched: false,
            externalProvidersTouched: false,
            nextAction: 'Do not auto-retry. Run a fresh re-quarantine preflight against live auth=2/profiles=0/candidates=0 and obtain a new exact approval.',
        });
        throw error;
    }
}

async function runFinalizePhase(
    outputDir: string,
    options: CliOptions,
    cleanup: NonNullable<ReturnType<typeof validateCleanupInputs>['value']>,
): Promise<void> {
    const phase = options.mode as 'finalize' | 'resume-finalize';
    const evidenceInput = readJsonEvidence<AuthPreflightEvidence>(options.evidencePath as string);
    const evidenceValidation = validateAuthPreflightEvidence(evidenceInput.value, phase);
    if (!evidenceValidation.ok || !evidenceValidation.value) throw new Error(evidenceValidation.errors.join(' '));
    const evidence = evidenceValidation.value;
    assertEvidenceCleanupBindings(evidence, cleanup);
    const reducedInput = loadAndValidateReducedReceipt(options.authReducedReceiptPath as string, cleanup);
    if (reducedInput.sha256 !== evidence.authReducedReceiptSha256) throw new Error('Auth-reduced receipt hash does not match the fresh evidence.');
    if (reducedInput.value.preservedSetSha256 !== evidence.auth.preservedSetSha256) {
        throw new Error('Auth-reduced preserved-set hash does not match the fresh evidence.');
    }
    const rolloutInput = loadAndValidateRolloutReceipt(options.rolloutReceiptPath as string, cleanup, reducedInput);
    if (rolloutInput.sha256 !== evidence.rolloutReceiptSha256) throw new Error('Rollout receipt hash does not match the fresh evidence.');
    const checkpointInput = options.checkpointPath ? loadAndValidateCheckpoint(options.checkpointPath, cleanup) : null;
    if (phase === 'resume-finalize' && checkpointInput?.sha256 !== evidence.checkpointSha256) {
        throw new Error('Finalize resume checkpoint hash does not match the fresh evidence.');
    }
    if (checkpointInput && checkpointInput.value.preservedSetSha256 !== evidence.auth.preservedSetSha256) {
        throw new Error('Finalize resume checkpoint preserved-set hash mismatch.');
    }
    if (checkpointInput && !['IN_PROGRESS', 'PARTIAL_FAILURE'].includes(checkpointInput.value.status)) {
        throw new Error('Finalize resume requires an interrupted or partial-failure checkpoint.');
    }
    if (checkpointInput && !['finalize', 'resume-finalize'].includes(checkpointInput.value.phase)) {
        throw new Error('Resume-finalize checkpoint phase mismatch.');
    }
    const approval = buildAuthCleanupApproval({
        phase,
        evidenceSha256: evidenceInput.sha256,
        publicCleanupReceiptSha256: cleanup.publicCleanupReceiptSha256,
        backupReceiptSha256: cleanup.backupReceiptSha256,
        preservedSetSha256: evidence.auth.preservedSetSha256,
        candidateCount: 0,
        candidateSetSha256: evidence.auth.candidateSetSha256,
        checkpointSha256: checkpointInput?.sha256 ?? null,
        authReducedReceiptSha256: reducedInput.sha256,
        rolloutReceiptSha256: rolloutInput.sha256,
        quarantineUntil: reducedInput.value.quarantineUntil,
    });
    assertExecutionApprovals(phase, approval);
    if (Date.now() < Date.parse(reducedInput.value.quarantineUntil)) throw new Error('JWT quarantine has not elapsed.');

    const secureInputs = loadSecureInputs();
    const client = buildSupabaseAdminClient(secureInputs);
    const live = await collectLiveState(secureInputs, client);
    assertLiveMatchesEvidence(live, evidence);
    const safetyErrors = validateLiveSafety(live, evidence.readiness);
    if (safetyErrors.length > 0 || !live.database.finalSchemaReady) throw new Error([...safetyErrors, 'Final schema is not ready.'].join(' '));

    let checkpoint: AuthCleanupCheckpoint = checkpointInput?.value ?? {
        schemaVersion: 1,
        targetProjectRef: PRODUCTION_AUTH_CLEANUP_TARGET.projectRef,
        phase,
        status: 'IN_PROGRESS',
        startedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        publicCleanupReceiptSha256: cleanup.publicCleanupReceiptSha256,
        backupReceiptSha256: cleanup.backupReceiptSha256,
        freezeCutoff: PRODUCTION_AUTH_FREEZE_CUTOFF,
        preservedSetSha256: live.identity.preservedSetSha256,
        initialCandidateCount: 136,
        initialCandidateSetSha256: reducedInput.value.deletedCandidateSetSha256,
        remainingCandidateCount: 0,
        remainingCandidateSetSha256: hashIdentitySet([]),
        deletedCount: 136,
        passwordRotationsCompleted: 2,
        profilesFinalized: false,
        lastErrorCategory: null,
        externalWritePerformed: false,
    };
    checkpoint = { ...checkpoint, phase, status: 'IN_PROGRESS', updatedAt: new Date().toISOString(), lastErrorCategory: null };
    const checkpointPath = path.join(outputDir, PRODUCTION_AUTH_OUTPUT_FILES.checkpoint);
    writeCheckpoint(checkpointPath, checkpoint);
    try {
        const now = new Date().toISOString();
        const [admin, teacher] = live.identity.preserved;
        const adminEmail = admin.email;
        const teacherEmail = teacher.email;
        if (!adminEmail || !teacherEmail) throw taggedError('PRESERVED_EMAIL_MISSING');
        const { error: profilesError } = await client.from('profiles').upsert([
            {
                id: admin.id,
                email: adminEmail,
                full_name: null,
                role: 'admin',
                preferred_language: 'es',
                phone: null,
                timezone: 'Europe/Madrid',
                adult_confirmed: true,
                adult_confirmed_at: now,
                age_policy_version: LEGAL_POLICY_VERSION,
            },
            {
                id: teacher.id,
                email: teacherEmail,
                full_name: null,
                role: 'teacher',
                preferred_language: 'es',
                phone: null,
                timezone: 'Europe/Madrid',
                adult_confirmed: true,
                adult_confirmed_at: now,
                age_policy_version: LEGAL_POLICY_VERSION,
            },
        ], { onConflict: 'id' });
        if (profilesError) throw profilesError;
        checkpoint = { ...checkpoint, externalWritePerformed: true, updatedAt: new Date().toISOString() };
        writeCheckpoint(checkpointPath, checkpoint);

        const { error: privateError } = await client.from('profiles_private').upsert([
            minimalPrivateProfile(admin.id),
            minimalPrivateProfile(teacher.id),
        ], { onConflict: 'profile_id' });
        if (privateError) throw privateError;
        checkpoint = { ...checkpoint, externalWritePerformed: true, updatedAt: new Date().toISOString() };
        writeCheckpoint(checkpointPath, checkpoint);

        const after = await collectLiveState(secureInputs, client);
        assertFinalState(after, live.identity.preservedSetSha256);
        const closedAt = new Date().toISOString();
        const finalReceipt: FinalAuthPolicyReceipt = {
            schemaVersion: 1,
            targetProjectRef: PRODUCTION_AUTH_CLEANUP_TARGET.projectRef,
            status: 'CLOSED_AND_VERIFIED',
            closedAt,
            mode: 'preserve_admin_teacher',
            authUsersRemaining: 2,
            publicProfilesRemaining: 2,
            publicProfilesPrivateRemaining: 2,
            profileRoles: { admin: 1, teacher: 1, student: 0 },
            fixtureStudentsRemaining: 0,
            storageObjectsTouched: false,
            externalProvidersTouched: false,
            passwordsRotatedUnretained: true,
            sessionsInvalidatedOrExpired: true,
            resetEmailsSent: false,
            backupReceiptSha256: cleanup.backupReceiptSha256,
            publicCleanupReceiptSha256: cleanup.publicCleanupReceiptSha256,
            authReducedReceiptSha256: reducedInput.sha256,
            productionRolloutReceiptSha256: rolloutInput.sha256,
            preservedSetSha256: after.identity.preservedSetSha256,
            freezeCutoff: PRODUCTION_AUTH_FREEZE_CUTOFF,
            quarantineUntil: reducedInput.value.quarantineUntil,
            googleDriveFixtureFolders: 'UNTOUCHED_110_OBSERVED',
        };
        writeIdentityFreeJson(
            path.join(outputDir, PRODUCTION_AUTH_OUTPUT_FILES.finalReceipt),
            finalReceipt,
            'Final Auth policy receipt',
        );
        checkpoint = { ...checkpoint, status: 'FINALIZED', profilesFinalized: true, updatedAt: closedAt, lastErrorCategory: null };
        writeCheckpoint(checkpointPath, checkpoint);
        writeSummary(outputDir, {
            schemaVersion: 1,
            status: 'CLOSED_AND_VERIFIED',
            targetProjectRef: PRODUCTION_AUTH_CLEANUP_TARGET.projectRef,
            closedAt,
            authUsers: 2,
            profiles: 2,
            profilesPrivate: 2,
            roles: { admin: 1, teacher: 1, student: 0 },
            fixtureRows: 0,
            storageOwnedObjects: 0,
            authSessions: 0,
            authRefreshTokens: 0,
            receiptFile: PRODUCTION_AUTH_OUTPUT_FILES.finalReceipt,
            checkpointFile: PRODUCTION_AUTH_OUTPUT_FILES.checkpoint,
            externalWritePerformed: true,
            outboundEmailsSent: false,
            resetEmailsSent: false,
            externalProvidersTouched: false,
            googleDriveFixtureFolders: 'UNTOUCHED_110_OBSERVED',
            nextAction: 'Keep signup and checkout disabled. Password reset emails remain a separate final-window action.',
        });
        console.log(`CLOSED_AND_VERIFIED: ${path.join(outputDir, PRODUCTION_AUTH_OUTPUT_FILES.summary)}`);
    } catch (error) {
        checkpoint = {
            ...checkpoint,
            status: 'PARTIAL_FAILURE',
            updatedAt: new Date().toISOString(),
            profilesFinalized: false,
            lastErrorCategory: errorCategory(error),
        };
        writeCheckpoint(checkpointPath, checkpoint);
        writeSummary(outputDir, {
            schemaVersion: 1,
            status: 'PARTIAL_FAILURE_STOPPED_NEW_APPROVAL_REQUIRED',
            targetProjectRef: PRODUCTION_AUTH_CLEANUP_TARGET.projectRef,
            profilesFinalized: false,
            checkpointFile: PRODUCTION_AUTH_OUTPUT_FILES.checkpoint,
            errorCategory: checkpoint.lastErrorCategory,
            externalWritePerformed: checkpoint.externalWritePerformed,
            outboundEmailsSent: false,
            externalProvidersTouched: false,
            nextAction: 'Run a new read-only preflight with the checkpoint and obtain the exact resume-finalize approval.',
        });
        throw error;
    }
}

async function collectLiveState(
    inputs: SecureInputs,
    client = buildSupabaseAdminClient(inputs),
): Promise<LiveState> {
    const [users, configuration, database] = await Promise.all([
        listAllAuthUsers(client),
        getAuthQuarantineConfig(inputs.managementToken),
        Promise.resolve(collectDatabaseAggregate(inputs.databaseUrl)),
    ]);
    return {
        identity: classifyIdentityState(users, inputs),
        configuration,
        database,
    };
}

function classifyIdentityState(users: User[], inputs: Pick<SecureInputs, 'adminEmail' | 'teacherEmail'>): IdentityState {
    const admin = exactEmailUser(users, inputs.adminEmail, 'TEST_ADMIN_EMAIL');
    const teacher = exactEmailUser(users, inputs.teacherEmail, 'TEST_TEACHER_EMAIL');
    if (admin.id === teacher.id) throw new Error('The two preserved Auth identities are not distinct.');
    const preservedIds = new Set([admin.id, teacher.id]);
    const candidates = users.filter((user) => !preservedIds.has(user.id));
    const cutoff = Date.parse(PRODUCTION_AUTH_FREEZE_CUTOFF);
    const identitiesCreatedAfterFreeze = users.filter((user) => Date.parse(user.created_at) > cutoff).length;
    const newestCreatedAt = users.map((user) => user.created_at).sort().at(-1) ?? '';
    return {
        users,
        preserved: [admin, teacher],
        candidates,
        preservedSetSha256: hashIdentitySet([admin.id, teacher.id]),
        candidateSetSha256: hashIdentitySet(candidates.map((user) => user.id)),
        newestCreatedAt,
        identitiesCreatedAfterFreeze,
    };
}

async function listAllAuthUsers(client: SupabaseClient<Database>): Promise<User[]> {
    const users: User[] = [];
    for (let page = 1; page <= 100; page += 1) {
        const { data, error } = await client.auth.admin.listUsers({ page, perPage: 1000 });
        if (error) throw error;
        users.push(...data.users);
        if (data.users.length < 1000) break;
        if (page === 100) throw new Error('Auth pagination exceeded the safety limit.');
    }
    if (new Set(users.map((user) => user.id)).size !== users.length) throw new Error('Auth pagination returned duplicate identities.');
    return users;
}

function exactEmailUser(users: User[], email: string, label: string): User {
    const normalized = email.trim().toLowerCase();
    const matches = users.filter((user) => user.email?.trim().toLowerCase() === normalized);
    if (matches.length !== 1) throw new Error(`${label} must resolve to exactly one Auth identity.`);
    return matches[0];
}

async function getAuthQuarantineConfig(token: string): Promise<AuthQuarantineConfig> {
    const response = await fetch(
        `${SUPABASE_MANAGEMENT_API_BASE}/v1/projects/${PRODUCTION_AUTH_CLEANUP_TARGET.projectRef}/config/auth`,
        {
            method: 'GET',
            headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
            redirect: 'error',
            signal: AbortSignal.timeout(20_000),
        },
    );
    if (!response.ok) throw new Error(`Supabase Auth config GET failed with HTTP ${response.status}.`);
    const validation = selectAuthQuarantineConfig(await response.json());
    if (!validation.ok || !validation.value) throw new Error(validation.errors.join(' '));
    return validation.value;
}

function collectDatabaseAggregate(databaseUrl: string): ProductionAuthDatabaseAggregate {
    const environment = buildPsqlEnvironment(databaseUrl);
    const discoveryResult = runReadOnlyPsql(environment, discoverySql());
    if (!discoveryResult.ok) throw new Error(discoveryResult.error ?? 'Database discovery failed.');
    const discovery = parseDiscovery(discoveryResult.stdout);
    const aggregateResult = runReadOnlyPsql(environment, aggregateSql(discovery));
    if (!aggregateResult.ok) throw new Error(aggregateResult.error ?? 'Database aggregate query failed.');
    return parseDatabaseAggregate(aggregateResult.stdout, discovery);
}

function discoverySql(): string {
    return [
        `SELECT 'table|' || table_schema || '|' || table_name FROM information_schema.tables WHERE table_schema IN ('public','auth','storage') ORDER BY table_schema, table_name;`,
        `SELECT 'column|' || table_schema || '|' || table_name || '|' || column_name FROM information_schema.columns WHERE table_schema IN ('public','auth','storage') ORDER BY table_schema, table_name, ordinal_position;`,
        `SELECT 'profile_crm_trigger_count|' || count(*)::text FROM pg_trigger AS trigger JOIN pg_proc AS fn ON fn.oid=trigger.tgfoid WHERE trigger.tgrelid=to_regclass('public.profiles') AND NOT trigger.tgisinternal AND (trigger.tgname ILIKE '%crm%' OR pg_get_functiondef(fn.oid) ILIKE '%crm_contacts%');`,
    ].join('\n');
}

function aggregateSql(discovery: DatabaseDiscovery): string {
    const statements: string[] = [];
    const countTables = [
        'public.profiles',
        'public.profiles_private',
        'public.packages',
        ...PUBLIC_FIXTURE_TABLES.map((table) => `public.${table}`),
    ].filter((table, index, all) => discovery.tables.has(table) && all.indexOf(table) === index);
    for (const table of countTables) {
        statements.push(`SELECT 'count|${table}|' || count(*)::text FROM ${table};`);
    }
    statements.push(`SELECT 'role|admin|' || count(*)::text FROM public.profiles WHERE role::text='admin';`);
    statements.push(`SELECT 'role|teacher|' || count(*)::text FROM public.profiles WHERE role::text='teacher';`);
    statements.push(`SELECT 'role|student|' || count(*)::text FROM public.profiles WHERE role::text='student';`);
    statements.push(`SELECT 'role|other|' || count(*)::text FROM public.profiles WHERE role IS NULL OR role::text NOT IN ('admin','teacher','student');`);
    if (discovery.tables.has('auth.sessions')) statements.push(`SELECT 'auth_sessions|' || count(*)::text FROM auth.sessions;`);
    if (discovery.tables.has('auth.refresh_tokens')) statements.push(`SELECT 'auth_refresh_tokens|' || count(*)::text FROM auth.refresh_tokens;`);
    if (discovery.tables.has('storage.objects') && discovery.columns.has('storage.objects.owner_id')) {
        statements.push(`SELECT 'storage_owned_objects|' || count(*)::text FROM storage.objects WHERE owner_id IS NOT NULL;`);
    }
    if (REQUIRED_FINAL_COLUMNS.slice(0, 3).every((column) => discovery.columns.has(column))) {
        statements.push(`SELECT 'non_minimal_profiles|' || count(*)::text FROM public.profiles WHERE full_name IS NOT NULL OR phone IS NOT NULL OR preferred_language IS DISTINCT FROM 'es' OR timezone IS DISTINCT FROM 'Europe/Madrid' OR adult_confirmed IS DISTINCT FROM TRUE OR adult_confirmed_at IS NULL OR age_policy_version IS DISTINCT FROM '${sqlLiteral(LEGAL_POLICY_VERSION)}';`);
    }
    if (REQUIRED_FINAL_COLUMNS.slice(3).every((column) => discovery.columns.has(column))) {
        statements.push(`SELECT 'non_minimal_profiles_private|' || count(*)::text FROM public.profiles_private WHERE stripe_customer_id IS NOT NULL OR stripe_customer_account_id IS NOT NULL OR stripe_customer_livemode IS NOT NULL OR drive_folder_id IS NOT NULL OR drive_folder_url IS NOT NULL OR google_account_email IS NOT NULL OR notes IS NOT NULL OR current_level IS NOT NULL;`);
    }
    statements.push(`SELECT 'fact|adult_columns|' || (SELECT count(*)=3 FROM information_schema.columns WHERE table_schema='public' AND table_name='profiles' AND column_name IN ('adult_confirmed','adult_confirmed_at','age_policy_version'))::text;`);
    statements.push(`SELECT 'fact|crm_tables|' || (SELECT count(*)=5 FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('crm_contacts','crm_opportunities','crm_tasks','crm_activities','crm_consents'))::text;`);
    statements.push(`SELECT 'fact|billing_tables|' || (SELECT count(*)=2 FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('package_prices','checkout_intents'))::text;`);
    statements.push(`SELECT 'fact|runtime_tables|' || (SELECT count(*)=2 FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('email_recipient_budget_usage','fulfillment_effects'))::text;`);
    statements.push(`SELECT 'fact|legacy_jobs_absent|' || (to_regclass('public.jobs') IS NULL)::text;`);
    statements.push(`SELECT 'fact|hardening_overlap|' || EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid=to_regclass('public.teacher_availability') AND conname='teacher_availability_no_active_overlap' AND contype='x')::text;`);
    statements.push(`SELECT 'fact|current_adult_policy|' || EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.handle_new_user()') AND pg_get_functiondef(oid) LIKE '%${sqlLiteral(LEGAL_POLICY_VERSION)}%' AND pg_get_functiondef(oid) LIKE '%v_requested_age_policy_version = v_current_age_policy_version%')::text;`);
    statements.push(`SELECT 'fact|profile_crm_sync_absent|' || (${discovery.profileCrmSyncTriggerCount}=0)::text;`);
    return statements.join('\n');
}

function parseDiscovery(stdout: string): DatabaseDiscovery {
    const tables = new Set<string>();
    const columns = new Set<string>();
    let profileCrmSyncTriggerCount = -1;
    for (const rawLine of stdout.split(/\r?\n/u)) {
        const line = rawLine.trim();
        if (!line) continue;
        const parts = line.split('|');
        if (parts[0] === 'table' && parts.length === 3) tables.add(`${parts[1]}.${parts[2]}`);
        else if (parts[0] === 'column' && parts.length === 4) columns.add(`${parts[1]}.${parts[2]}.${parts[3]}`);
        else if (parts[0] === 'profile_crm_trigger_count' && parts.length === 2) profileCrmSyncTriggerCount = Number(parts[1]);
    }
    if (!tables.has('public.profiles') || !tables.has('public.profiles_private')
        || !tables.has('auth.users') || !tables.has('auth.sessions')
        || !tables.has('auth.refresh_tokens') || !tables.has('storage.objects')
        || !columns.has('storage.objects.owner_id') || profileCrmSyncTriggerCount < 0) {
        throw new Error('Database discovery is missing required Auth/profile/Storage objects.');
    }
    return { tables, columns, profileCrmSyncTriggerCount };
}

function parseDatabaseAggregate(stdout: string, discovery: DatabaseDiscovery): ProductionAuthDatabaseAggregate {
    const counts: Record<string, number> = {};
    const roles = { admin: 0, teacher: 0, student: 0, other: 0 };
    const facts: Record<string, boolean> = {};
    let nonMinimalProfiles: number | null = null;
    let nonMinimalProfilesPrivate: number | null = null;
    let authSessions = -1;
    let authRefreshTokens = -1;
    let storageOwnedObjects = -1;
    for (const rawLine of stdout.split(/\r?\n/u)) {
        const parts = rawLine.trim().split('|');
        if (parts[0] === 'count' && parts.length === 3) counts[parts[1]] = exactNonNegativeInteger(parts[2]);
        else if (parts[0] === 'role' && parts.length === 3 && parts[1] in roles) roles[parts[1] as keyof typeof roles] = exactNonNegativeInteger(parts[2]);
        else if (parts[0] === 'fact' && parts.length === 3) facts[parts[1]] = parts[2] === 'true';
        else if (parts[0] === 'non_minimal_profiles' && parts.length === 2) nonMinimalProfiles = exactNonNegativeInteger(parts[1]);
        else if (parts[0] === 'non_minimal_profiles_private' && parts.length === 2) nonMinimalProfilesPrivate = exactNonNegativeInteger(parts[1]);
        else if (parts[0] === 'auth_sessions' && parts.length === 2) authSessions = exactNonNegativeInteger(parts[1]);
        else if (parts[0] === 'auth_refresh_tokens' && parts.length === 2) authRefreshTokens = exactNonNegativeInteger(parts[1]);
        else if (parts[0] === 'storage_owned_objects' && parts.length === 2) storageOwnedObjects = exactNonNegativeInteger(parts[1]);
    }
    const fixtureRows = PUBLIC_FIXTURE_TABLES.reduce((sum, table) => sum + (counts[`public.${table}`] ?? 0), 0);
    const finalSchemaReady = REQUIRED_FINAL_TABLES.every((table) => discovery.tables.has(table))
        && REQUIRED_FINAL_COLUMNS.every((column) => discovery.columns.has(column))
        && Object.keys(facts).length === 8
        && Object.values(facts).every(Boolean)
        && discovery.profileCrmSyncTriggerCount === 0;
    if (authSessions < 0 || authRefreshTokens < 0 || storageOwnedObjects < 0) {
        throw new Error('Database aggregate is missing Auth session or Storage ownership counts.');
    }
    return {
        counts,
        profileRoles: roles,
        nonMinimalProfiles,
        nonMinimalProfilesPrivate,
        profileCrmSyncTriggerCount: discovery.profileCrmSyncTriggerCount,
        finalSchemaReady,
        finalSchemaFacts: facts,
        fixtureRows,
        storageOwnedObjects,
        authSessions,
        authRefreshTokens,
    };
}

function runReadOnlyPsql(
    connection: ReturnType<typeof buildPsqlEnvironment>,
    sql: string,
): PsqlResult {
    const result = spawnSync('psql', ['-X', '-w', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-f', '-'], {
        env: buildDatabaseToolProcessEnvironment(connection, {
            PGOPTIONS: '-c default_transaction_read_only=on -c statement_timeout=30000 -c lock_timeout=5000',
        }),
        input: sql,
        encoding: 'utf8',
        timeout: 45_000,
        windowsHide: true,
    });
    const status = typeof result.status === 'number' ? result.status : null;
    return {
        ok: !result.error && status === 0,
        stdout: sanitizeAuthCleanupOutput(result.stdout ?? ''),
        stderr: sanitizeAuthCleanupOutput(result.stderr ?? ''),
        status,
        error: result.error ? safeMessage(result.error) : status === 0 ? null : `psql exited with status ${status ?? 'unknown'}.`,
    };
}

function validateLiveSafety(
    live: LiveState,
    readiness: AuthPreflightEvidence['readiness'] | 'BLOCKED',
): string[] {
    const errors: string[] = [];
    if (live.identity.preserved.length !== 2) errors.push('Exactly two preserved Auth identities are required.');
    if (live.identity.identitiesCreatedAfterFreeze !== 0) errors.push('An Auth identity was created after the approved freeze cutoff.');
    if (live.database.storageOwnedObjects !== 0) errors.push('Supabase Storage has owned objects; Auth deletion is blocked.');
    if (live.database.fixtureRows !== 0) errors.push('Fixture rows remain outside profiles/packages.');
    if ((live.database.counts['public.packages'] ?? -1) !== 4) errors.push('Canonical package count is not four.');
    if (!live.configuration.disableSignup) errors.push('Supabase production signup is not disabled.');
    if (live.database.profileCrmSyncTriggerCount !== 0) errors.push('An unexpected profile-to-CRM trigger is installed.');
    const profileCount = live.database.counts['public.profiles'] ?? -1;
    const privateCount = live.database.counts['public.profiles_private'] ?? -1;
    if (readiness === 'INITIAL_DELETE_READY' || readiness === 'RESUME_DELETE_READY') {
        if (profileCount !== 0 || privateCount !== 0) errors.push('Profiles must remain absent during Auth reduction/quarantine.');
    } else if (readiness === 'REQUARANTINE_READY') {
        if (live.identity.users.length !== 2 || live.identity.candidates.length !== 0
            || profileCount !== 0 || privateCount !== 0) {
            errors.push('Re-quarantine requires exactly auth=2, candidates=0 and profiles/private=0.');
        }
    } else {
        if (live.identity.users.length !== 2 || live.identity.candidates.length !== 0) errors.push('Finalize requires exactly the preserved Auth identities.');
        if (live.database.authSessions !== 0 || live.database.authRefreshTokens !== 0) errors.push('Finalize requires zero Auth sessions and refresh tokens.');
        if (!live.database.finalSchemaReady) errors.push('Finalize requires the verified final schema.');
    }
    return errors;
}

function assertLiveMatchesEvidence(live: LiveState, evidence: AuthPreflightEvidence): void {
    if (live.identity.users.length !== evidence.auth.users
        || live.identity.candidates.length !== evidence.auth.candidates
        || live.identity.preservedSetSha256 !== evidence.auth.preservedSetSha256
        || live.identity.candidateSetSha256 !== evidence.auth.candidateSetSha256
        || live.identity.identitiesCreatedAfterFreeze !== 0
        || live.database.storageOwnedObjects !== evidence.database.storageOwnedObjects
        || live.database.fixtureRows !== evidence.database.fixtureRows
        || (live.database.counts['public.profiles'] ?? -1) !== (evidence.database.counts['public.profiles'] ?? -1)
        || (live.database.counts['public.profiles_private'] ?? -1) !== (evidence.database.counts['public.profiles_private'] ?? -1)
        || live.configuration.jwtExpirySeconds !== evidence.configuration.jwtExpirySeconds
        || live.configuration.disableSignup !== evidence.configuration.disableSignup) {
        throw new Error('Live Auth/database/config state drifted after the approved preflight.');
    }
}

async function assertPreservedUsersStillExist(client: SupabaseClient<Database>, preserved: [User, User]): Promise<void> {
    for (const expected of preserved) {
        await retryAdminCall(async () => {
            const { data, error } = await client.auth.admin.getUserById(expected.id);
            if (error) throw error;
            if (!data.user || data.user.id !== expected.id
                || data.user.email?.trim().toLowerCase() !== expected.email?.trim().toLowerCase()) {
                throw taggedError('PRESERVED_AUTH_IDENTITY_MISSING_OR_CHANGED');
            }
        });
    }
}

async function retryAdminCall(operation: () => Promise<void>): Promise<void> {
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
            await operation();
            return;
        } catch (error) {
            lastError = error;
            if (!isRetryableSupabaseAdminError(error) || attempt === 2) throw error;
            await new Promise<void>((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
        }
    }
    throw lastError;
}

async function delay(milliseconds: number): Promise<void> {
    await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

async function refreshFailureCheckpoint(
    checkpoint: AuthCleanupCheckpoint,
    checkpointPath: string,
    client: SupabaseClient<Database>,
    inputs: SecureInputs,
    error: unknown,
): Promise<AuthCleanupCheckpoint> {
    let remainingCount = checkpoint.remainingCandidateCount;
    let remainingHash = checkpoint.remainingCandidateSetSha256;
    try {
        const identity = classifyIdentityState(await listAllAuthUsers(client), inputs);
        remainingCount = identity.candidates.length;
        remainingHash = identity.candidateSetSha256;
    } catch {
        // Preserve the last verified aggregate checkpoint when the read-back is unavailable.
    }
    const failed: AuthCleanupCheckpoint = {
        ...checkpoint,
        status: 'PARTIAL_FAILURE',
        updatedAt: new Date().toISOString(),
        remainingCandidateCount: remainingCount,
        remainingCandidateSetSha256: remainingHash,
        deletedCount: 136 - remainingCount,
        lastErrorCategory: errorCategory(error),
        externalWritePerformed: true,
    };
    writeCheckpoint(checkpointPath, failed);
    return failed;
}

function loadAndValidateCheckpoint(
    checkpointPath: string,
    cleanup: NonNullable<ReturnType<typeof validateCleanupInputs>['value']>,
): { value: AuthCleanupCheckpoint; sha256: string } {
    const loaded = readJsonEvidence<AuthCleanupCheckpoint>(checkpointPath);
    const validation = validateCheckpoint(loaded.value, cleanup);
    if (!validation.ok || !validation.value) throw new Error(validation.errors.join(' '));
    return { value: validation.value, sha256: loaded.sha256 };
}

function loadAndValidateReducedReceipt(
    receiptPath: string,
    cleanup: NonNullable<ReturnType<typeof validateCleanupInputs>['value']>,
): { value: AuthReducedReceipt; sha256: string } {
    const loaded = readJsonEvidence<AuthReducedReceipt>(receiptPath);
    const validation = validateAuthReducedReceipt(loaded.value, cleanup);
    if (!validation.ok || !validation.value) throw new Error(validation.errors.join(' '));
    return { value: validation.value, sha256: loaded.sha256 };
}

function loadAndValidateRolloutReceipt(
    receiptPath: string,
    cleanup: NonNullable<ReturnType<typeof validateCleanupInputs>['value']>,
    reducedInput: { value: AuthReducedReceipt; sha256: string } | null,
): ValidatedRolloutReceipt {
    if (!reducedInput) throw new Error('Rollout receipt validation requires the Auth-reduced receipt.');
    const loaded = readJsonEvidence<RolloutReceipt>(receiptPath);
    const value = loaded.value;
    const hashes = [
        value.scopeSha256,
        value.allowlistSha256,
        value.migrationManifestSha256,
        value.preflightEvidenceSha256,
        value.backupReceiptSha256,
        value.publicCleanupReceiptSha256,
        value.authReducedQuarantinedReceiptSha256,
        value.googleFixturePolicyEvidenceSha256,
        value.stagingHardeningEvidenceSha256,
        value.sentryProductionHardeningEvidenceSha256,
        value.livePreflightSqlSha256,
        value.finalVerifySqlSha256,
    ];
    if (value.schemaVersion !== 1
        || value.status !== 'PRODUCTION_ROLLOUT_ALL_WAVES_APPLIED_AND_VERIFIED'
        || value.targetProjectRef !== PRODUCTION_AUTH_CLEANUP_TARGET.projectRef
        || value.through !== 'deferred_rc_hardening'
        || value.migrationCount !== 25
        || !hashes.every((hash) => /^[a-f0-9]{64}$/u.test(hash))
        || value.backupReceiptSha256 !== cleanup.backupReceiptSha256
        || value.publicCleanupReceiptSha256 !== cleanup.publicCleanupReceiptSha256
        || value.authReducedQuarantinedReceiptSha256 !== reducedInput.sha256
        || value.finalVerificationPassed !== true
        || value.stagingOnlyMigrationAbsent !== true
        || value.checkoutRemainedDisabledByOperatorAttestation !== true
        || value.authFinalizeRequired !== true
        || !Number.isFinite(Date.parse(value.completedAt))
        || Date.parse(value.completedAt) > Date.now() + 5 * 60 * 1_000
        || Date.parse(value.completedAt) < Date.parse(reducedInput.value.completedAt)) {
        throw new Error('Production rollout receipt is invalid or not bound to the cleanup/Auth-reduced receipts.');
    }
    return { value, sha256: loaded.sha256 };
}

function assertEvidenceCleanupBindings(
    evidence: AuthPreflightEvidence,
    cleanup: NonNullable<ReturnType<typeof validateCleanupInputs>['value']>,
): void {
    if (evidence.publicCleanupReceiptSha256 !== cleanup.publicCleanupReceiptSha256
        || evidence.backupReceiptSha256 !== cleanup.backupReceiptSha256
        || evidence.manifestSha256 !== cleanup.manifestSha256) {
        throw new Error('Preflight evidence is not bound to the supplied cleanup inputs.');
    }
}

function assertExecutionApprovals(phase: AuthCleanupPhase, approval: string): void {
    const approvalEnv = approvalEnvForPhase(phase);
    if (process.env[approvalEnv]?.trim() !== approval) throw new Error(`Exact approval mismatch in ${approvalEnv}.`);
    if (process.env[PRODUCTION_AUTH_INERT_CONFIRMATION_ENV]?.trim() !== PRODUCTION_AUTH_INERT_CONFIRMATION) {
        throw new Error(`Exact inert/checkout confirmation mismatch in ${PRODUCTION_AUTH_INERT_CONFIRMATION_ENV}.`);
    }
}

function assertFinalState(live: LiveState, preservedSetSha256: string): void {
    const counts = live.database.counts;
    if (live.identity.users.length !== 2 || live.identity.candidates.length !== 0
        || live.identity.preservedSetSha256 !== preservedSetSha256
        || counts['public.profiles'] !== 2 || counts['public.profiles_private'] !== 2
        || live.database.profileRoles.admin !== 1 || live.database.profileRoles.teacher !== 1
        || live.database.profileRoles.student !== 0 || live.database.profileRoles.other !== 0
        || live.database.nonMinimalProfiles !== 0 || live.database.nonMinimalProfilesPrivate !== 0
        || live.database.fixtureRows !== 0 || live.database.storageOwnedObjects !== 0
        || live.database.authSessions !== 0 || live.database.authRefreshTokens !== 0
        || !live.database.finalSchemaReady || !live.configuration.disableSignup) {
        throw taggedError('FINAL_AGGREGATE_VERIFICATION_FAILED');
    }
}

function minimalPrivateProfile(profileId: string): Database['public']['Tables']['profiles_private']['Insert'] {
    return {
        profile_id: profileId,
        stripe_customer_id: null,
        stripe_customer_account_id: null,
        stripe_customer_livemode: null,
        drive_folder_id: null,
        drive_folder_url: null,
        google_account_email: null,
        notes: null,
        current_level: null,
    };
}

function loadSecureInputs(): SecureInputs {
    const production = readEnvSubset(path.join(root, '.env'), [
        'PUBLIC_SUPABASE_URL',
        'SUPABASE_SERVICE_ROLE_KEY',
        FIXTURE_CLEANUP_DATABASE_ENV,
    ]);
    const tests = readEnvSubset(path.join(root, '.env.test'), ['TEST_ADMIN_EMAIL', 'TEST_TEACHER_EMAIL']);
    const supabaseUrl = requiredInput('PUBLIC_SUPABASE_URL', production);
    const parsedUrl = new URL(supabaseUrl);
    if (parsedUrl.protocol !== 'https:' || parsedUrl.hostname !== `${PRODUCTION_AUTH_CLEANUP_TARGET.projectRef}.supabase.co`) {
        throw new Error('PUBLIC_SUPABASE_URL does not target the exact approved production project.');
    }
    const adminEmail = requiredInput('TEST_ADMIN_EMAIL', tests).trim().toLowerCase();
    const teacherEmail = requiredInput('TEST_TEACHER_EMAIL', tests).trim().toLowerCase();
    if (adminEmail === teacherEmail || !adminEmail.includes('@') || !teacherEmail.includes('@')) {
        throw new Error('Preserved test email inputs must be distinct valid addresses.');
    }
    return {
        supabaseUrl,
        serviceRoleKey: requiredInput('SUPABASE_SERVICE_ROLE_KEY', production),
        databaseUrl: requiredInput(FIXTURE_CLEANUP_DATABASE_ENV, production),
        managementToken: requiredInput(SUPABASE_ACCESS_TOKEN_ENV, {}),
        adminEmail,
        teacherEmail,
    };
}

function readEnvSubset(filePath: string, names: readonly string[]): Record<string, string> {
    const selected: Record<string, string> = {};
    if (!existsSync(filePath)) return selected;
    const allowlist = new Set(names);
    for (const rawLine of readFileSync(filePath, 'utf8').split(/\r?\n/u)) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) continue;
        const separator = line.indexOf('=');
        if (separator < 1) continue;
        const name = line.slice(0, separator).trim();
        if (!allowlist.has(name)) continue;
        let value = line.slice(separator + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }
        selected[name] = value;
    }
    return selected;
}

function requiredInput(name: string, fallback: Record<string, string>): string {
    const value = process.env[name]?.trim() || fallback[name]?.trim();
    if (!value) throw new Error(`Missing required secure input ${name}.`);
    return value;
}

function buildSupabaseAdminClient(inputs: SecureInputs): SupabaseClient<Database> {
    return createClient<Database>(inputs.supabaseUrl, inputs.serviceRoleKey, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
        global: { headers: { 'X-Client-Info': 'espanol-honesto-production-auth-cleanup' } },
    });
}

function phaseForReadiness(readiness: AuthPreflightEvidence['readiness']): AuthCleanupPhase {
    if (readiness === 'INITIAL_DELETE_READY') return 'delete';
    if (readiness === 'RESUME_DELETE_READY') return 'resume-delete';
    if (readiness === 'FINALIZE_READY') return 'finalize';
    if (readiness === 'RESUME_FINALIZE_READY') return 'resume-finalize';
    return 're-quarantine';
}

function redactedLiveAggregates(live: LiveState): Record<string, unknown> {
    return {
        authUsers: live.identity.users.length,
        preserved: 2,
        candidates: live.identity.candidates.length,
        identitiesCreatedAfterFreeze: live.identity.identitiesCreatedAfterFreeze,
        database: live.database,
        configuration: live.configuration,
    };
}

function writeCheckpoint(checkpointPath: string, checkpoint: AuthCleanupCheckpoint): void {
    writeIdentityFreeJson(checkpointPath, checkpoint, 'Checkpoint');
}

function writeSummary(outputDir: string, summary: Record<string, unknown>): void {
    writeIdentityFreeJson(
        path.join(outputDir, PRODUCTION_AUTH_OUTPUT_FILES.summary),
        summary,
        'Summary',
    );
}

function writeIdentityFreeJson(filePath: string, value: unknown, label: string): void {
    const serialized = stableJson(value);
    if (/@|[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/iu.test(serialized)) {
        throw new Error(`${label} serialization attempted to persist an email or UUID.`);
    }
    writeFileSync(filePath, serialized, 'utf8');
}

export function acquireRequarantineOneShotLock(
    evidenceSha256: string,
    priorReceiptSha256: string,
    ledgerRoot: string,
): string {
    if (!/^[a-f0-9]{64}$/u.test(evidenceSha256) || !/^[a-f0-9]{64}$/u.test(priorReceiptSha256)) {
        throw new Error('Re-quarantine one-shot lock requires exact SHA-256 bindings.');
    }
    const keySha256 = sha256(stableJson({
        targetProjectRef: PRODUCTION_AUTH_CLEANUP_TARGET.projectRef,
        evidenceSha256,
        priorReceiptSha256,
    }));
    mkdirSync(ledgerRoot, { recursive: true });
    const lockPath = path.join(ledgerRoot, `${keySha256}.json`);
    const value = stableJson({
        schemaVersion: 1,
        status: 'REQUARANTINE_APPROVAL_CONSUMED_ONE_SHOT',
        createdAt: new Date().toISOString(),
        targetProjectRef: PRODUCTION_AUTH_CLEANUP_TARGET.projectRef,
        evidenceSha256,
        priorReceiptSha256,
        keySha256,
    });
    try {
        writeFileSync(lockPath, value, { encoding: 'utf8', flag: 'wx', flush: true });
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
            throw new Error('This exact re-quarantine evidence/prior-receipt approval was already consumed. Generate a fresh preflight/approval and use the latest receipt predecessor.');
        }
        throw error;
    }
    return lockPath;
}

export function validateRequarantineLedgerDirectory(
    rawPath: string,
    repositoryRoot = root,
): string {
    const trimmed = rawPath.trim();
    if (!trimmed || !path.isAbsolute(trimmed)) {
        throw new Error(`${PRODUCTION_AUTH_REQUARANTINE_LEDGER_DIR_ENV} must be an absolute path outside the repository.`);
    }
    const repositoryPhysical = realpathSync.native(path.resolve(repositoryRoot));
    const targetPhysical = projectedPhysicalPath(path.resolve(trimmed));
    const relativeToRepository = path.relative(repositoryPhysical, targetPhysical);
    if (relativeToRepository === ''
        || (!relativeToRepository.startsWith(`..${path.sep}`)
            && relativeToRepository !== '..'
            && !path.isAbsolute(relativeToRepository))) {
        throw new Error(`${PRODUCTION_AUTH_REQUARANTINE_LEDGER_DIR_ENV} must resolve physically outside the repository.`);
    }
    return targetPhysical;
}

function projectedPhysicalPath(absolutePath: string): string {
    let existingAncestor = absolutePath;
    while (!existsSync(existingAncestor)) {
        const parent = path.dirname(existingAncestor);
        if (parent === existingAncestor) break;
        existingAncestor = parent;
    }
    const physicalAncestor = realpathSync.native(existingAncestor);
    return path.resolve(physicalAncestor, path.relative(existingAncestor, absolutePath));
}

function createOutputDir(startedAt: Date): string {
    const outputDir = path.join(
        root,
        'outputs',
        'launch-supabase-production-auth-cleanup',
        startedAt.toISOString().replace(/[:.]/gu, '-'),
    );
    mkdirSync(outputDir, { recursive: true });
    return outputDir;
}

function exactNonNegativeInteger(raw: string): number {
    const value = Number(raw);
    if (!Number.isInteger(value) || value < 0) throw new Error('Database aggregate contains an invalid count.');
    return value;
}

function sqlLiteral(value: string): string {
    return value.replace(/'/gu, "''");
}

function taggedError(category: string): Error {
    const error = new Error(category);
    error.name = 'ProductionAuthCleanupError';
    return error;
}

function errorCategory(error: unknown): string {
    if (error instanceof Error && /^[A-Z0-9_]{3,80}$/u.test(error.message)) return error.message;
    if (isRetryableSupabaseAdminError(error)) return 'RETRYABLE_ADMIN_API_EXHAUSTED';
    return 'EXTERNAL_OPERATION_FAILED_REDACTED';
}

function safeMessage(error: unknown): string {
    return sanitizeAuthCleanupOutput(error instanceof Error ? error.message : String(error));
}

const isMain = process.argv[1]
    ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
    : false;

if (isMain) {
    main().catch((error: unknown) => {
        console.error(safeMessage(error));
        process.exitCode = 1;
    });
}
