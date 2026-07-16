import * as dotenv from 'dotenv';
import { createHash } from 'node:crypto';
import {
    closeSync,
    existsSync,
    fsyncSync,
    mkdirSync,
    openSync,
    readFileSync,
    writeFileSync,
    writeSync,
} from 'node:fs';
import path from 'node:path';
import {
    removeSentryProductionExecutionLock,
    removeSentryProductionFinalizationPending,
    writeSentryProductionFinalizationPending,
    writeSentryProductionHardeningReceipt,
} from './sentry-production-hardening-local';
import {
    SENTRY_PRODUCTION_HARDENING_APPROVAL_ENV,
    SENTRY_PRODUCTION_RECOVERY_APPROVAL_ENV,
    SENTRY_PRODUCTION_TARGET,
    SENTRY_PRODUCTION_WORKFLOW_NAMES,
    analyzeSentryProjectRulesMirror,
    buildSentryProductionRecoveryApproval,
    buildSentryProductionHardeningApproval,
    buildSentryProductionWorkflows,
    buildSentryRecoveryDecision,
    buildSentryFinalizationPendingState,
    fingerprintSentryId,
    isSentryHardeningRolloutEligible,
    matchReattestedWorkflowOwnership,
    parseSentryFinalizationPendingState,
    parseSentryExecutionJournal,
    validateSentryHardeningExecutedReceiptAnchor,
    workflowMatchesDefinition,
    type SentryFinalizationPendingState,
    type SentryHardeningTerminalProof,
    type SentryExecutedReceiptAnchor,
    type SentryRecoveryDecision,
    type SentryWorkflowDefinition,
} from './sentry-production-hardening-shared';

type CheckStatus = 'ok' | 'failed';
type ClosureStatus = 'PLAN_READY'
    | 'HARDENED_AND_VERIFIED'
    | 'REATTESTED_AND_VERIFIED'
    | 'PARTIAL_WRITE_STOP'
    | 'RECOVERY_REQUIRED'
    | 'RECOVERY_PLAN_READY'
    | 'RECOVERY_MANUAL_REQUIRED'
    | 'RECOVERED_AND_VERIFIED'
    | 'BLOCKED';

interface Check {
    status: CheckStatus;
    name: string;
    message: string;
    details: string[];
}

interface ProjectShape {
    slug?: string;
    status?: string;
    dataScrubber?: boolean;
    dataScrubberDefaults?: boolean;
    scrubIPAddresses?: boolean;
    access?: string[];
    options?: Record<string, unknown>;
}

interface MemberShape {
    id?: string;
    role?: string;
    orgRole?: string;
    expired?: boolean;
    pending?: boolean;
    user?: { id?: string } | null;
}

interface SentryIdentitySnapshot {
    exact: boolean;
    detectorId: string;
    ownerUserId: string;
    detectorFingerprint: string;
    ownerFingerprint: string;
    enabledErrorDetectorCount: number;
    activeMemberCount: number;
    privilegedMemberCount: number;
}

const SENTRY_API_ORIGIN = 'https://sentry.io';
const cli = parseArguments(process.argv.slice(2));
const executeRequested = cli.executeRequested;
const recoverLockRequested = cli.recoverLockRequested;
const reattestRequested = cli.reattestRequested;
if (reattestRequested && (executeRequested || recoverLockRequested)) {
    throw new Error('--reattest-existing is GET-only and cannot be combined with --execute-approved or --recover-lock.');
}
const startedAt = new Date();
const hardeningOutputRoot = path.join(process.cwd(), 'outputs', 'launch-sentry-production-hardening');
const executionLockPath = path.join(hardeningOutputRoot, '.execution-lock.jsonl');
const finalizationPendingPath = path.join(hardeningOutputRoot, '.finalization-pending.json');
const outputDir = path.join(hardeningOutputRoot, stamp(startedAt));
mkdirSync(outputDir, { recursive: true });

const env = dotenv.parse(readFileSync('.env'));
const token = process.env.SENTRY_AUTH_TOKEN?.trim() || env.SENTRY_AUTH_TOKEN?.trim() || '';
const configuredBaseUrl = process.env.SENTRY_BASE_URL?.trim() || env.SENTRY_BASE_URL?.trim() || SENTRY_API_ORIGIN;
const sentryBaseUrlIsCanonical = isCanonicalSentryBaseUrl(configuredBaseUrl);
const baseUrl = SENTRY_API_ORIGIN;
const checks: Check[] = [];
const createdWorkflowIds: string[] = [];
const createdWorkflowIdsByName = new Map<string, string>();
const attemptedWorkflowNames = new Set<string>();
let detectorId = '';
let ownerUserId = '';
let detectorFingerprint = '';
let ownerFingerprint = '';
let approvalSentence = '';
let approvalEnvironmentVariable = SENTRY_PRODUCTION_HARDENING_APPROVAL_ENV;
let workflowDefinitions: SentryWorkflowDefinition[] = [];
let initialScrubIp = false;
let scrubIpEnableIntentSeen = false;
let externalWriteAttempted = false;
let externalWritePerformed = false;
let externalWriteOutcomeAmbiguous = false;
let rollbackAttempted = false;
let rollbackComplete = false;
let executionLockAcquired = false;
let finalStableReadbacks = 0;
let finalExactWorkflowDefinitionsVerified = false;
let finalWorkflowCount = 0;
let finalLegacyIssueRuleCount = -1;
let finalScrubIPAddresses = false;
let hardeningRemoteStateVerified = false;
let hardeningFinalReadbackJournaled = false;
let finalizationPendingState: SentryFinalizationPendingState | null = null;
let evidenceCreatedWorkflowCount: number | null = null;
let reattestationAnchor: SentryExecutedReceiptAnchor | null = null;
let reattestationSourceReceiptSha256 = '';
let recoveryPlan: null | {
    lockFingerprint: string;
    remoteSnapshotFingerprint: string;
    deleteWorkflowCount: number;
    deleteWorkflowIdFingerprints: string[];
    restoreScrubIPAddresses: boolean;
    unprovenWorkflowMatches: Array<{ name: string; count: number }>;
    hardeningFinalReadbackSeen: boolean;
    manualRecoveryRequired: boolean;
} = null;
let closureStatus: ClosureStatus = 'BLOCKED';

checks.push(validateLocalEnvironment());
checks.push(recoverLockRequested ? validateExecutionLockPresence() : validateExecutionLockAbsence());
if (reattestRequested) checks.push(validateReattestationSourceReceipt());
if (checks.every((check) => check.status === 'ok')) {
    try {
        if (recoverLockRequested && existsSync(finalizationPendingPath)) await reconcileFinalizationPending();
        else if (recoverLockRequested) await reconcileExecutionLock();
        else await preflightAndMaybeExecute();
    } catch (error) {
        checks.push(fail(recoverLockRequested ? 'recovery_reconciliation' : 'remote_preflight', recoverLockRequested
            ? 'Sentry lock recovery stopped safely and retained the execution journal.'
            : 'Sentry read-only preflight failed before the exact execution gate.', [
            safeError(error),
            `externalWriteAttempted=${String(externalWriteAttempted)}`,
        ]));
        if (existsSync(executionLockPath) || existsSync(finalizationPendingPath)) closureStatus = 'RECOVERY_REQUIRED';
    }
}

const failed = checks.some((check) => check.status === 'failed');
if (!failed && closureStatus === 'BLOCKED') closureStatus = recoverLockRequested
    ? (executeRequested ? 'RECOVERED_AND_VERIFIED' : 'RECOVERY_PLAN_READY')
    : reattestRequested ? 'REATTESTED_AND_VERIFIED'
        : (executeRequested ? 'HARDENED_AND_VERIFIED' : 'PLAN_READY');
if (failed && externalWritePerformed && closureStatus === 'BLOCKED') closureStatus = 'PARTIAL_WRITE_STOP';
const status = failed ? 'FAILED' : 'OK';
const createdWorkflowCount = evidenceCreatedWorkflowCount ?? createdWorkflowIds.length;
const reportFinalizationState = getFinalizationPendingState();
const reportReattestationAnchor = currentReattestationAnchor();
const terminalProof: SentryHardeningTerminalProof = {
    stableReadbacks: finalStableReadbacks,
    exactWorkflowDefinitionsVerified: finalExactWorkflowDefinitionsVerified,
    workflowCount: finalWorkflowCount,
    legacyIssueRuleCount: finalLegacyIssueRuleCount,
    scrubIPAddresses: finalScrubIPAddresses,
    executionLockAbsent: !existsSync(executionLockPath),
    ambiguousOutcomeOutstanding: externalWriteOutcomeAmbiguous,
    rawIdentifiersPersistedInReports: false,
};
const rolloutEligible = isSentryHardeningRolloutEligible({
    closureStatus,
    executeRequested,
    reattestRequested,
    externalWriteAttempted,
    externalWritePerformed,
    rollbackAttempted,
    createdWorkflowCount,
    terminalProof,
});
const report = {
    schemaVersion: 1,
    evidenceContractVersion: 2,
    artifactKind: 'sentry_production_hardening_report',
    startedAt: startedAt.toISOString(),
    endedAt: new Date().toISOString(),
    status,
    closureStatus,
    target: SENTRY_PRODUCTION_TARGET,
    mode: recoverLockRequested ? 'recovery' : reattestRequested ? 'reattestation' : 'hardening',
    executeRequested,
    externalWriteAttempted,
    externalWritePerformed,
    externalWriteOutcomeAmbiguous,
    rollbackAttempted,
    rollbackComplete,
    executionLockRetainedForRecovery: existsSync(executionLockPath),
    rawIdentifiersPersistedInReports: false,
    createdWorkflowCount,
    detectorFingerprint,
    ownerFingerprint,
    terminalProof,
    evidenceContract: {
        rolloutEligible,
        requiredArtifactKind: 'sentry_production_hardening_receipt',
        attestationMode: reattestRequested ? 'live_get_only_revalidation' : 'write_proven_hardening',
        rawIdentifiersPersistedInReports: false,
    },
    reattestation: reattestRequested && reportReattestationAnchor ? {
        schemaVersion: 1,
        sourceReceiptSha256: reattestationSourceReceiptSha256,
        sourceReceiptEndedAt: reportReattestationAnchor.endedAt,
        sourceClosureStatus: 'HARDENED_AND_VERIFIED' as const,
        requestMethod: 'GET' as const,
        sourceExecutedWriteProof: true,
        detectorFingerprintMatched: detectorFingerprint === reportReattestationAnchor.detectorFingerprint,
        ownerFingerprintMatched: ownerFingerprint === reportReattestationAnchor.ownerFingerprint,
        workflowIdFingerprintsMatched: true,
    } : null,
    finalizationProof: reportFinalizationState ? {
        stateFingerprint: reportFinalizationState.stateFingerprint,
        sourceFingerprint: reportFinalizationState.sourceFingerprint,
        workflowIdFingerprints: reportFinalizationState.workflowIdFingerprints,
    } : null,
    recoveryPlan,
    approval: {
        environmentVariable: reattestRequested ? 'GET_ONLY_NO_APPROVAL' : approvalEnvironmentVariable,
        requiredFlag: reattestRequested
            ? '--reattest-existing --source-receipt <executed-receipt.json>'
            : recoverLockRequested ? '--recover-lock --execute-approved' : '--execute-approved',
        exactSentence: reattestRequested ? '' : approvalSentence,
    },
    expectedChanges: {
        scrubIPAddresses: true,
        workflows: Object.values(SENTRY_PRODUCTION_WORKFLOW_NAMES),
        environment: 'production',
        actions: 'email to exact organization owner',
        spikeThreshold: '10 events in 5 minutes',
    },
    checks,
    forbiddenScope: [
        'issue status, event or payload access/mutation',
        'other Sentry projects or organizations',
        'members, integrations, releases, DSN, keys or tokens',
        'other project settings',
        'any non-Sentry service',
    ],
};

writeFileSync(path.join(outputDir, 'summary.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
writeFileSync(path.join(outputDir, 'summary.md'), renderSummary(report), 'utf8');
writeFileSync(path.join(outputDir, 'approval-gate.md'), renderApprovalGate(report), 'utf8');
if (rolloutEligible) {
    const receiptPath = path.join(outputDir, 'sentry-production-hardening-receipt.json');
    writeSentryProductionHardeningReceipt(receiptPath, `${JSON.stringify({
        ...report,
        artifactKind: 'sentry_production_hardening_receipt',
    }, null, 2)}\n`);
    if (existsSync(finalizationPendingPath)) removeSentryProductionFinalizationPending(finalizationPendingPath);
}

console.log(`[launch:sentry-production-hardening] Status: ${status}`);
console.log(`[launch:sentry-production-hardening] Closure: ${closureStatus}`);
console.log(`[launch:sentry-production-hardening] External write attempted: ${String(externalWriteAttempted)}`);
console.log(`[launch:sentry-production-hardening] Summary: ${path.join(outputDir, 'summary.md')}`);
if (failed) process.exit(1);

async function preflightAndMaybeExecute(): Promise<void> {
    const projectPath = projectApiPath();
    const project = await sentryRequest<ProjectShape>('GET', projectPath);
    const dataScrubber = project.dataScrubber === true || project.options?.['sentry:scrub_data'] === true;
    const defaultScrubbers = project.dataScrubberDefaults === true || project.options?.['sentry:scrub_defaults'] === true;
    initialScrubIp = project.scrubIPAddresses === true || project.options?.['sentry:scrub_ip_address'] === true;
    const projectReady = project.slug === SENTRY_PRODUCTION_TARGET.project
        && project.status === 'active'
        && dataScrubber
        && defaultScrubbers
        && project.access?.includes('alerts:read') === true
        && project.access?.includes('alerts:write') === true;
    checks.push(projectReady
        ? ok('exact_project_preflight', 'Exact Sentry project is active with sensitive-data scrubbers and alert access.', [
            `scrubIPAddresses=${initialScrubIp}`,
            'dataScrubber=true',
            'defaultScrubbers=true',
        ])
        : fail('exact_project_preflight', 'Exact Sentry project or privacy/alert prerequisites are not ready.', [
            `projectSlugMatches=${String(project.slug === SENTRY_PRODUCTION_TARGET.project)}`,
            `projectStatus=${project.status ?? 'unknown'}`,
            `dataScrubber=${String(dataScrubber)}`,
            `defaultScrubbers=${String(defaultScrubbers)}`,
            `alertsRead=${String(project.access?.includes('alerts:read') === true)}`,
            `alertsWrite=${String(project.access?.includes('alerts:write') === true)}`,
        ]));
    if (!projectReady) return;

    const workflows = extractRecords(await sentryRequest<unknown>('GET', workflowsApiPath(), { project: SENTRY_PRODUCTION_TARGET.project }));
    const projectRulesMirror = extractRecords(await sentryRequest<unknown>('GET', `${projectApiPath()}rules/`));
    const detectors = extractRecords(await sentryRequest<unknown>('GET', detectorsApiPath(), { project: SENTRY_PRODUCTION_TARGET.project }));
    const members = await sentryRequest<MemberShape[]>('GET', membersApiPath());
    const identity = resolveSentryIdentity(detectors, members);
    const exactIdentity = identity.exact;
    if (exactIdentity) {
        detectorId = identity.detectorId;
        ownerUserId = identity.ownerUserId;
        detectorFingerprint = identity.detectorFingerprint;
        ownerFingerprint = identity.ownerFingerprint;
        workflowDefinitions = buildSentryProductionWorkflows({ detectorId, ownerUserId });
        approvalSentence = buildSentryProductionHardeningApproval({ detectorFingerprint, ownerFingerprint });
    }
    checks.push(exactIdentity
        ? ok('exact_detector_and_owner', 'Exactly one enabled error detector and one notification owner are pinned by hash.', [
            `detectorFingerprint=${detectorFingerprint}`,
            `ownerFingerprint=${ownerFingerprint}`,
            'rawDetectorOwnerIdsPersisted=false',
        ])
        : fail('exact_detector_and_owner', 'Error detector or notification owner is ambiguous.', [
            `enabledErrorDetectors=${identity.enabledErrorDetectorCount}`,
            `activeMembers=${identity.activeMemberCount}`,
            `privilegedMembers=${identity.privilegedMemberCount}`,
            'externalWriteAttempted=false',
        ]));
    if (!exactIdentity) return;

    if (reattestRequested) {
        if (!reattestationAnchor) throw new Error('Validated Sentry source receipt anchor is unavailable.');
        const initialMirror = analyzeSentryProjectRulesMirror(projectRulesMirror, workflowDefinitions);
        const identityMatchesAnchor = detectorFingerprint === reattestationAnchor.detectorFingerprint
            && ownerFingerprint === reattestationAnchor.ownerFingerprint;
        const ownershipMatchesAnchor = matchReattestedWorkflowOwnership(
            workflows,
            reattestationAnchor.workflowIdFingerprints,
        );
        const initialExact = identityMatchesAnchor
            && ownershipMatchesAnchor
            && initialScrubIp
            && workflows.length === workflowDefinitions.length
            && workflowDefinitions.every((definition) => (
                workflows.some((workflow) => workflowMatchesDefinition(workflow, definition))
            ))
            && initialMirror.exact;
        checks.push(initialExact
            ? ok('existing_hardening_baseline', 'Existing Sentry state matches the exact production hardening contract.', [
                'scrubIPAddresses=true',
                `workflowCount=${workflows.length}`,
                'sourcePostResponseWorkflowIdsMatched=true',
                'sourceDetectorOwnerFingerprintsMatched=true',
                'projectRulesCompatibilityMirror=exact',
                'externalWriteAttempted=false',
            ])
            : fail('existing_hardening_baseline', 'Existing Sentry state does not match the exact production hardening contract.', [
                `scrubIPAddresses=${String(initialScrubIp)}`,
                `workflowCount=${workflows.length}`,
                `projectRulesCompatibilityEntries=${projectRulesMirror.length}`,
                `projectRulesCompatibilityMirrorExact=${String(initialMirror.exact)}`,
                `sourcePostResponseWorkflowIdsMatched=${String(ownershipMatchesAnchor)}`,
                `sourceDetectorOwnerFingerprintsMatched=${String(identityMatchesAnchor)}`,
                'externalWriteAttempted=false',
            ]));
        if (!initialExact) return;

        const finalState = await readStableHardeningState(reattestationAnchor.workflowIdFingerprints);
        finalStableReadbacks = finalState.stableReadbacks;
        finalExactWorkflowDefinitionsVerified = finalState.exactWorkflowDefinitionsVerified;
        finalWorkflowCount = finalState.workflowCount;
        finalLegacyIssueRuleCount = finalState.legacyIssueRuleCount;
        finalScrubIPAddresses = finalState.scrubIPAddresses;
        const terminalExact = finalState.stableReadbacks >= 2
            && finalState.exactWorkflowDefinitionsVerified
            && finalState.workflowCount === 2
            && finalState.legacyIssueRuleCount === 0
            && finalState.scrubIPAddresses
            && finalState.identityFingerprintsMatched
            && finalState.workflowIdFingerprintsMatched;
        checks.push(terminalExact
            ? ok('get_only_reattestation', 'Two stable GET readbacks reattested the exact hardened production state.', [
                `stableReadbacks=${finalState.stableReadbacks}`,
                'remoteWriteAttempted=false',
                'sourcePostResponseWorkflowIdsMatched=true',
                'stableDetectorOwnerFingerprintsMatched=true',
                'receiptFresh=true',
            ])
            : fail('get_only_reattestation', 'Stable GET readbacks did not reattest the exact hardened production state.', [
                `stableReadbacks=${finalState.stableReadbacks}`,
                `workflowCount=${finalState.workflowCount}`,
                `unmatchedLegacyIssueRuleCount=${finalState.legacyIssueRuleCount}`,
                `scrubIPAddresses=${String(finalState.scrubIPAddresses)}`,
                `stableDetectorOwnerFingerprintsMatched=${String(finalState.identityFingerprintsMatched)}`,
                `sourcePostResponseWorkflowIdsMatched=${String(finalState.workflowIdFingerprintsMatched)}`,
                'remoteWriteAttempted=false',
            ]));
        if (terminalExact) closureStatus = 'REATTESTED_AND_VERIFIED';
        return;
    }

    const noExistingAlerts = workflows.length === 0 && projectRulesMirror.length === 0;
    checks.push(noExistingAlerts
        ? ok('empty_alert_baseline', 'The exact project has no native workflows or deprecated project-rules compatibility entries.', [
            'workflows=0',
            'projectRulesCompatibilityEntries=0',
        ])
        : fail('empty_alert_baseline', 'Existing alert configuration blocks automatic creation to avoid overlap.', [
            `workflows=${workflows.length}`,
            `projectRulesCompatibilityEntries=${projectRulesMirror.length}`,
            'externalWriteAttempted=false',
        ]));
    if (!noExistingAlerts) return;

    if (!executeRequested) {
        closureStatus = 'PLAN_READY';
        checks.push(ok('plan_mode_read_only', 'Plan mode completed Sentry GET-only preflight.', [
            'externalWriteAttempted=false',
            `approvalEnv=${SENTRY_PRODUCTION_HARDENING_APPROVAL_ENV}`,
        ]));
        return;
    }

    const approvalMatches = process.env[SENTRY_PRODUCTION_HARDENING_APPROVAL_ENV]?.trim() === approvalSentence;
    checks.push(approvalMatches
        ? ok('exact_approval_gate', 'Exact approval sentence matches project, detector, owner and two workflows.', [])
        : fail('exact_approval_gate', 'Exact approval sentence is missing or mismatched; no writes may start.', [
            `approvalEnv=${SENTRY_PRODUCTION_HARDENING_APPROVAL_ENV}`,
            'externalWriteAttempted=false',
        ]));
    if (!approvalMatches) return;

    try {
        acquireExecutionLock();
        checks.push(ok('exclusive_execution_lock', 'Exclusive gitignored execution journal was acquired and flushed before any write.', [
            'lockScope=sentry_production_hardening',
            'rawIdsInReports=false',
        ]));
    } catch (error) {
        checks.push(fail('exclusive_execution_lock', 'A durable execution lock could not be acquired; no Sentry write may start.', [
            safeError(error),
            'externalWriteAttempted=false',
        ]));
        return;
    }

    externalWriteAttempted = true;
    try {
        for (const definition of workflowDefinitions) {
            attemptedWorkflowNames.add(definition.name);
            appendExecutionJournal({
                event: 'workflow_create_intent',
                workflowName: definition.name,
            });
            let created: Record<string, unknown>;
            try {
                created = await sentryRequest<Record<string, unknown>>('POST', workflowsApiPath(), {}, definition);
            } catch (error) {
                externalWriteOutcomeAmbiguous = true;
                throw new Error(`Sentry workflow create outcome requires GET reconciliation for ${definition.name}: ${safeError(error)}`);
            }
            externalWritePerformed = true;
            const id = typeof created.id === 'string' || typeof created.id === 'number' ? String(created.id) : '';
            if (id) rememberCreatedWorkflow(definition.name, id, 'post_response');
            if (!id || !workflowMatchesDefinition(created, definition)) {
                throw new Error(`Sentry did not attest the exact created workflow shape for ${definition.name}`);
            }
            appendExecutionJournal({
                event: 'workflow_create_response_verified',
                workflowName: definition.name,
            });
        }

        if (!initialScrubIp) {
            scrubIpEnableIntentSeen = true;
            appendExecutionJournal({ event: 'scrub_ip_enable_intent' });
            let updated: ProjectShape;
            try {
                updated = await sentryRequest<ProjectShape>('PUT', projectPath, {}, { scrubIPAddresses: true });
            } catch (error) {
                externalWriteOutcomeAmbiguous = true;
                throw new Error(`Sentry scrub IP update outcome requires GET reconciliation: ${safeError(error)}`);
            }
            externalWritePerformed = true;
            const updatedScrubIp = updated.scrubIPAddresses === true || updated.options?.['sentry:scrub_ip_address'] === true;
            if (!updatedScrubIp) throw new Error('Sentry did not attest scrubIPAddresses=true');
            appendExecutionJournal({ event: 'scrub_ip_enable_response_verified' });
        }

        const finalState = await readStableHardeningState();
        finalStableReadbacks = finalState.stableReadbacks;
        finalExactWorkflowDefinitionsVerified = finalState.exactWorkflowDefinitionsVerified;
        finalWorkflowCount = finalState.workflowCount;
        finalLegacyIssueRuleCount = finalState.legacyIssueRuleCount;
        finalScrubIPAddresses = finalState.scrubIPAddresses;
        if (!finalState.scrubIPAddresses
            || finalState.legacyIssueRuleCount !== 0
            || finalState.workflowCount !== workflowDefinitions.length
            || !finalState.exactWorkflowDefinitionsVerified) {
            throw new Error('Final Sentry hardening verification did not match the exact two-workflow state');
        }

        hardeningRemoteStateVerified = true;
        appendExecutionJournal({
            event: 'hardening_final_readback_verified',
            stableReadbacks: finalState.stableReadbacks,
            workflowCount: finalState.workflowCount,
            legacyIssueRuleCount: finalState.legacyIssueRuleCount,
            scrubIPAddresses: finalState.scrubIPAddresses,
        });
        hardeningFinalReadbackJournaled = true;
        const journal = parseSentryExecutionJournal(readFileSync(executionLockPath, 'utf8'));
        finalizationPendingState = buildSentryFinalizationPendingState({
            createdAt: new Date().toISOString(),
            runStartedAt: startedAt.toISOString(),
            outputDirectoryName: path.basename(outputDir),
            lockFingerprint: journal.lockFingerprint,
            detectorFingerprint,
            ownerFingerprint,
            workflowIdsByName: [...createdWorkflowIdsByName].map(([name, id]) => ({ name, id })),
            terminalProof: {
                stableReadbacks: finalState.stableReadbacks,
                exactWorkflowDefinitionsVerified: finalState.exactWorkflowDefinitionsVerified,
                workflowCount: finalState.workflowCount,
                legacyIssueRuleCount: finalState.legacyIssueRuleCount,
                scrubIPAddresses: finalState.scrubIPAddresses,
                ambiguousOutcomeOutstanding: externalWriteOutcomeAmbiguous,
                rawIdentifiersPersistedInReports: false,
            },
        });
        writeSentryProductionFinalizationPending(
            finalizationPendingPath,
            `${JSON.stringify(finalizationPendingState, null, 2)}\n`,
        );
        removeExecutionLock();
        closureStatus = 'HARDENED_AND_VERIFIED';
        checks.push(ok('hardening_post_write_verification', 'IP scrubbing and both exact production email workflows are active.', [
            'scrubIPAddresses=true',
            `workflowCount=${finalState.workflowCount}`,
            `stableReadbacks=${finalState.stableReadbacks}`,
            'projectRulesCompatibilityMirror=exact',
            'unmatchedLegacyIssueRuleCount=0',
            `names=${workflowDefinitions.map((definition) => definition.name).join('|')}`,
            'environment=production',
            'notification=email_exact_owner',
        ]));
    } catch (error) {
        if (hardeningRemoteStateVerified) {
            closureStatus = 'RECOVERY_REQUIRED';
            checks.push(fail(
                'hardening_local_finalization',
                'Sentry hardening was verified remotely, but local finalization failed; remote rollback is forbidden and the lock is retained.',
                [
                    safeError(error),
                    'hardeningRemoteStateVerified=true',
                    `hardeningFinalReadbackJournaled=${String(hardeningFinalReadbackJournaled)}`,
                    'remoteRollbackAttempted=false',
                    `executionLockRetained=${String(existsSync(executionLockPath))}`,
                ],
            ));
            return;
        }
        checks.push(fail('hardening_execution', 'Sentry hardening failed; narrow rollback was attempted.', [safeError(error)]));
        await rollbackCreatedChanges();
        if (!rollbackComplete && existsSync(executionLockPath)) closureStatus = 'RECOVERY_REQUIRED';
    }
}

async function reconcileFinalizationPending(): Promise<void> {
    approvalEnvironmentVariable = 'LOCAL_FINALIZATION_ONLY';
    finalizationPendingState = parseSentryFinalizationPendingState(
        readFileSync(finalizationPendingPath, 'utf8'),
    );
    detectorFingerprint = finalizationPendingState.detectorFingerprint;
    ownerFingerprint = finalizationPendingState.ownerFingerprint;
    externalWriteAttempted = finalizationPendingState.externalWriteAttempted;
    externalWritePerformed = finalizationPendingState.externalWritePerformed;
    evidenceCreatedWorkflowCount = finalizationPendingState.workflowIdFingerprints.length;

    if (existsSync(executionLockPath)) {
        const journal = parseSentryExecutionJournal(readFileSync(executionLockPath, 'utf8'));
        const journalWorkflowFingerprints = journal.stronglyOwnedWorkflows
            .map((workflow) => ({
                name: workflow.name,
                idFingerprint: fingerprintSentryId(workflow.id),
                ownershipSource: 'post_response',
            }))
            .sort((left, right) => left.name.localeCompare(right.name));
        if (journal.lockFingerprint !== finalizationPendingState.lockFingerprint
            || !journal.hardeningFinalReadbackSeen
            || JSON.stringify(journalWorkflowFingerprints) !== JSON.stringify(finalizationPendingState.workflowIdFingerprints)) {
            throw new Error('Sentry finalization pending state does not match the durable execution journal.');
        }
        executionLockAcquired = true;
    }

    const finalState = await readStablePendingFinalizationState(finalizationPendingState);
    finalStableReadbacks = finalState.stableReadbacks;
    finalExactWorkflowDefinitionsVerified = finalState.exactWorkflowDefinitionsVerified;
    finalWorkflowCount = finalState.workflowCount;
    finalLegacyIssueRuleCount = finalState.legacyIssueRuleCount;
    finalScrubIPAddresses = finalState.scrubIPAddresses;
    externalWriteOutcomeAmbiguous = !finalState.exactWorkflowDefinitionsVerified;
    if (!finalState.exactWorkflowDefinitionsVerified
        || finalState.workflowCount !== 2
        || finalState.legacyIssueRuleCount !== 0
        || !finalState.scrubIPAddresses) {
        closureStatus = 'RECOVERY_REQUIRED';
        checks.push(fail('finalization_pending_remote_revalidation', 'Pending Sentry finalization no longer matches the exact POST-owned state; no local or remote mutation was performed.', [
            `workflowCount=${finalState.workflowCount}`,
            `unmatchedLegacyIssueRuleCount=${finalState.legacyIssueRuleCount}`,
            `scrubIPAddresses=${String(finalState.scrubIPAddresses)}`,
            'workflowAdoptionByName=false',
            'remoteWriteAttempted=false',
        ]));
        return;
    }

    detectorId = finalState.detectorId;
    ownerUserId = finalState.ownerUserId;
    workflowDefinitions = finalState.workflowDefinitions;
    checks.push(ok('finalization_pending_remote_revalidation', 'GET-only revalidation matched the exact POST-owned workflow ids, owner, detector and complete definitions.', [
        `stateFingerprint=${finalizationPendingState.stateFingerprint}`,
        `sourceFingerprint=${finalizationPendingState.sourceFingerprint}`,
        `stableReadbacks=${finalState.stableReadbacks}`,
        'workflowAdoptionByName=false',
        'remoteWriteAttempted=false',
    ]));

    if (!executeRequested) {
        closureStatus = 'RECOVERY_PLAN_READY';
        checks.push(ok('finalization_pending_plan', 'Pending finalization is ready for local-only completion.', [
            'requiredFlag=--recover-lock --execute-approved',
            'externalWriteAuthorizedOrRequired=false',
        ]));
        return;
    }

    if (existsSync(executionLockPath)) removeExecutionLock();
    closureStatus = 'HARDENED_AND_VERIFIED';
    checks.push(ok('finalization_pending_completed', 'The exact remote state was revalidated and the remaining finalization is local-only.', [
        'executionLockAbsent=true',
        'remoteWriteAttempted=false',
        'receiptWillBeWrittenBeforePendingStateCleanup=true',
    ]));
}

async function reconcileExecutionLock(): Promise<void> {
    approvalEnvironmentVariable = SENTRY_PRODUCTION_RECOVERY_APPROVAL_ENV;
    const journal = parseSentryExecutionJournal(readFileSync(executionLockPath, 'utf8'));
    executionLockAcquired = true;
    initialScrubIp = journal.initialScrubIPAddresses;
    scrubIpEnableIntentSeen = journal.scrubIpEnableIntentSeen;
    detectorFingerprint = journal.detectorFingerprint;
    ownerFingerprint = journal.ownerFingerprint;
    for (const name of journal.attemptedWorkflowNames) attemptedWorkflowNames.add(name);
    for (const workflow of journal.stronglyOwnedWorkflows) {
        createdWorkflowIdsByName.set(workflow.name, workflow.id);
        createdWorkflowIds.push(workflow.id);
    }

    const currentWorkflows = await readStableRelevantWorkflows();
    const currentScrubIp = await readStableScrubIp();
    const decision = buildSentryRecoveryDecision({
        journal,
        currentWorkflows,
        currentScrubIPAddresses: currentScrubIp,
    });
    setRecoveryPlan(decision);
    checks.push(ok('recovery_lock_integrity', 'The gitignored execution journal matches the exact Sentry target and supported schema.', [
        `lockFingerprint=${decision.lockFingerprint}`,
        `postAttestedWorkflowIds=${journal.stronglyOwnedWorkflows.length}`,
        'rawWorkflowIdsPersistedInReports=false',
    ]));
    checks.push(decision.manualRecoveryRequired
        ? fail('recovery_ownership_boundary', decision.hardeningFinalReadbackSeen
            ? 'The journal already contains a successful hardening readback; automatic rollback is forbidden.'
            : 'A workflow found only by name cannot be deleted automatically.', [
            `hardeningFinalReadbackSeen=${String(decision.hardeningFinalReadbackSeen)}`,
            ...decision.unprovenWorkflowMatches.map((match) => (
                `workflow=${match.name};nameOnlyMatches=${match.count};automaticDelete=false`
            )),
        ])
        : ok('recovery_ownership_boundary', 'Every planned workflow deletion is backed by an id returned directly by this run POST.', [
            `plannedDeletes=${decision.deleteWorkflows.length}`,
            'nameOnlyDeletes=0',
        ]));
    if (decision.manualRecoveryRequired) {
        closureStatus = 'RECOVERY_MANUAL_REQUIRED';
        return;
    }

    approvalSentence = buildSentryProductionRecoveryApproval(decision);
    if (!executeRequested) {
        closureStatus = 'RECOVERY_PLAN_READY';
        checks.push(ok('recovery_plan_read_only', 'Recovery plan completed with GET-only Sentry reconciliation and no lock mutation.', [
            `remoteSnapshotFingerprint=${decision.remoteSnapshotFingerprint}`,
            `plannedDeletes=${decision.deleteWorkflows.length}`,
            `restoreScrubIPAddresses=${String(decision.restoreScrubIPAddresses)}`,
            'executionLockRetained=true',
        ]));
        return;
    }

    const approvalMatches = process.env[SENTRY_PRODUCTION_RECOVERY_APPROVAL_ENV]?.trim() === approvalSentence;
    checks.push(approvalMatches
        ? ok('exact_recovery_approval_gate', 'Exact recovery approval matches the lock, remote snapshot and strongly owned changes.', [])
        : fail('exact_recovery_approval_gate', 'Exact recovery approval is missing or mismatched; the lock remains and no write may start.', [
            `approvalEnv=${SENTRY_PRODUCTION_RECOVERY_APPROVAL_ENV}`,
            'externalWriteAttempted=false',
        ]));
    if (!approvalMatches) return;

    appendExecutionJournal({
        event: 'recovery_execution_started',
        lockFingerprint: decision.lockFingerprint,
        remoteSnapshotFingerprint: decision.remoteSnapshotFingerprint,
        deleteWorkflowCount: decision.deleteWorkflows.length,
        restoreScrubIPAddresses: decision.restoreScrubIPAddresses,
    });
    externalWriteAttempted = decision.deleteWorkflows.length > 0 || decision.restoreScrubIPAddresses;
    for (const workflow of decision.deleteWorkflows) {
        appendExecutionJournal({
            event: 'recovery_workflow_delete_intent',
            workflowName: workflow.name,
            workflowId: workflow.id,
        });
        try {
            await sentryRequest<unknown>('DELETE', `${workflowsApiPath()}${encodeURIComponent(workflow.id)}/`);
            externalWritePerformed = true;
            appendExecutionJournal({ event: 'recovery_workflow_delete_response', workflowName: workflow.name });
        } catch {
            externalWriteOutcomeAmbiguous = true;
            appendExecutionJournal({ event: 'recovery_workflow_delete_response_ambiguous', workflowName: workflow.name });
        }
    }
    if (decision.restoreScrubIPAddresses) {
        appendExecutionJournal({
            event: 'recovery_scrub_ip_restore_intent',
            restoreValue: decision.initialScrubIPAddresses,
        });
        try {
            await sentryRequest<ProjectShape>('PUT', projectApiPath(), {}, {
                scrubIPAddresses: decision.initialScrubIPAddresses,
            });
            externalWritePerformed = true;
            appendExecutionJournal({ event: 'recovery_scrub_ip_restore_response' });
        } catch {
            externalWriteOutcomeAmbiguous = true;
            appendExecutionJournal({ event: 'recovery_scrub_ip_restore_response_ambiguous' });
        }
    }

    const verifiedWorkflows = await readStableRelevantWorkflows();
    const verifiedScrubIp = await readStableScrubIp();
    const terminalDecision = buildSentryRecoveryDecision({
        journal,
        currentWorkflows: verifiedWorkflows,
        currentScrubIPAddresses: verifiedScrubIp,
    });
    const terminalVerified = terminalDecision.terminalWithoutExternalWrites;
    if (!terminalVerified) {
        setRecoveryPlan(terminalDecision);
        closureStatus = 'RECOVERY_REQUIRED';
        checks.push(fail('recovery_terminal_readback', 'Recovery did not reach the proven terminal state; the lock was retained.', [
            `stronglyOwnedWorkflowsRemaining=${terminalDecision.deleteWorkflows.length}`,
            `nameOnlyMatches=${terminalDecision.unprovenWorkflowMatches.length}`,
            `scrubRestoreStillRequired=${String(terminalDecision.restoreScrubIPAddresses)}`,
            'executionLockRetained=true',
        ]));
        return;
    }

    appendExecutionJournal({
        event: 'recovery_terminal_readback_verified',
        workflowAbsenceVerified: true,
        scrubIpRestored: true,
        stableReadbacks: 2,
    });
    removeExecutionLock();
    rollbackComplete = true;
    closureStatus = 'RECOVERED_AND_VERIFIED';
    checks.push(ok('recovery_terminal_readback', 'Strongly owned changes are absent/restored and the execution lock was removed.', [
        'stronglyOwnedWorkflowsRemaining=0',
        'nameOnlyMatches=0',
        'scrubIpRestored=true',
        'stableReadbacks=2',
        'executionLockRemoved=true',
    ]));
}

function setRecoveryPlan(decision: SentryRecoveryDecision): void {
    recoveryPlan = {
        lockFingerprint: decision.lockFingerprint,
        remoteSnapshotFingerprint: decision.remoteSnapshotFingerprint,
        deleteWorkflowCount: decision.deleteWorkflows.length,
        deleteWorkflowIdFingerprints: decision.deleteWorkflows.map((workflow) => workflow.idFingerprint),
        restoreScrubIPAddresses: decision.restoreScrubIPAddresses,
        unprovenWorkflowMatches: decision.unprovenWorkflowMatches,
        hardeningFinalReadbackSeen: decision.hardeningFinalReadbackSeen,
        manualRecoveryRequired: decision.manualRecoveryRequired,
    };
}

function getFinalizationPendingState(): SentryFinalizationPendingState | null {
    return finalizationPendingState;
}

async function rollbackCreatedChanges(): Promise<void> {
    rollbackAttempted = true;
    const failures: string[] = [];
    const ambiguousDeletes = new Set<string>();

    try {
        const beforeRollback = await readStableRelevantWorkflows();
        const stronglyOwnedIds = new Set(createdWorkflowIdsByName.values());
        for (const name of attemptedWorkflowNames) {
            const matches = beforeRollback.filter((workflow) => workflow.name === name);
            const unprovenMatches = matches.filter((workflow) => {
                const id = typeof workflow.id === 'string' || typeof workflow.id === 'number' ? String(workflow.id) : '';
                return !id || !stronglyOwnedIds.has(id);
            });
            if (unprovenMatches.length > 0) {
                externalWriteOutcomeAmbiguous = true;
                appendExecutionJournal({
                    event: 'workflow_name_only_match_requires_manual_recovery',
                    workflowName: name,
                    matchCount: unprovenMatches.length,
                    rawIdsPersisted: false,
                });
                failures.push(`workflow=${name}: ${unprovenMatches.length} match(es) lack POST-attested ownership; automatic DELETE is forbidden`);
            } else if (matches.length === 0) {
                appendExecutionJournal({ event: 'workflow_create_absence_readback', workflowName: name });
            }
        }
    } catch (error) {
        failures.push(`workflow_reconciliation:${safeError(error)}`);
    }

    for (const [name, id] of [...createdWorkflowIdsByName.entries()].reverse()) {
        try {
            appendExecutionJournal({
                event: 'rollback_workflow_delete_intent',
                workflowName: name,
                workflowId: id,
            });
            await sentryRequest<unknown>('DELETE', `${workflowsApiPath()}${encodeURIComponent(id)}/`);
            externalWritePerformed = true;
            appendExecutionJournal({ event: 'rollback_workflow_delete_response', workflowName: name });
        } catch {
            externalWriteOutcomeAmbiguous = true;
            ambiguousDeletes.add(name);
        }
    }

    let workflowAbsenceVerified = false;
    try {
        const afterRollback = await readStableRelevantWorkflows();
        const remainingNames = [...new Set(afterRollback.map((workflow) => String(workflow.name ?? 'unknown')))];
        workflowAbsenceVerified = remainingNames.length === 0;
        if (!workflowAbsenceVerified) failures.push(`workflow_absence_readback:remaining=${remainingNames.join('|')}`);
        for (const name of ambiguousDeletes) {
            if (afterRollback.some((workflow) => workflow.name === name)) {
                failures.push(`workflow=${name}: DELETE outcome remains ambiguous after stable GET readback`);
            }
        }
    } catch (error) {
        failures.push(`workflow_absence_readback:${safeError(error)}`);
    }

    let scrubIpRestored = false;
    try {
        const currentScrubIp = await readStableScrubIp();
        if (currentScrubIp !== initialScrubIp && scrubIpEnableIntentSeen) {
            appendExecutionJournal({
                event: 'rollback_scrub_ip_restore_intent',
                restoreValue: initialScrubIp,
            });
            try {
                await sentryRequest<ProjectShape>('PUT', projectApiPath(), {}, { scrubIPAddresses: initialScrubIp });
                externalWritePerformed = true;
                appendExecutionJournal({ event: 'rollback_scrub_ip_restore_response' });
            } catch {
                externalWriteOutcomeAmbiguous = true;
            }
        }
        const finalScrubIp = await readStableScrubIp();
        scrubIpRestored = finalScrubIp === initialScrubIp;
        if (currentScrubIp !== initialScrubIp && !scrubIpEnableIntentSeen) {
            failures.push('scrub_ip_readback: value drifted without a journaled write intent; automatic PUT is forbidden');
        }
        if (!scrubIpRestored) failures.push('scrub_ip_readback: initial value was not restored');
    } catch (error) {
        failures.push(`scrub_ip_readback:${safeError(error)}`);
    }

    if (failures.length === 0 && workflowAbsenceVerified && scrubIpRestored) {
        try {
            appendExecutionJournal({
                event: 'rollback_terminal_readback_verified',
                workflowAbsenceVerified,
                scrubIpRestored,
            });
            removeExecutionLock();
        } catch (error) {
            failures.push(`execution_lock_cleanup:${safeError(error)}`);
        }
    }

    rollbackComplete = failures.length === 0 && workflowAbsenceVerified && scrubIpRestored && !existsSync(executionLockPath);
    checks.push(rollbackComplete
        ? ok('narrow_rollback', 'Only changes created in this execution were rolled back.', [
            `workflowDeletes=${createdWorkflowIdsByName.size}`,
            'workflowAbsenceVerified=true',
            'scrubIpRestored=true',
            'executionLockRemoved=true',
        ])
        : fail('narrow_rollback', 'Narrow Sentry rollback was incomplete and requires manual review.', failures));
}

async function readStableRelevantWorkflows(): Promise<Array<Record<string, unknown>>> {
    if (attemptedWorkflowNames.size === 0) return [];
    const stronglyOwnedIds = new Set(createdWorkflowIdsByName.values());
    let previousSignature: string | null = null;
    let stableReadCount = 0;
    let latest: Array<Record<string, unknown>> = [];
    let lastError = '';
    for (let attempt = 1; attempt <= 4; attempt += 1) {
        try {
            const workflows = extractRecords(await sentryRequest<unknown>('GET', workflowsApiPath(), {
                project: SENTRY_PRODUCTION_TARGET.project,
            }));
            latest = workflows.filter((workflow) => {
                const nameMatches = typeof workflow.name === 'string' && attemptedWorkflowNames.has(workflow.name);
                const id = typeof workflow.id === 'string' || typeof workflow.id === 'number' ? String(workflow.id) : '';
                return nameMatches || (id.length > 0 && stronglyOwnedIds.has(id));
            });
            const signature = latest
                .map((workflow) => `${String(workflow.name)}:${typeof workflow.id}:${String(workflow.id ?? '')}`)
                .sort()
                .join('|');
            stableReadCount = signature === previousSignature ? stableReadCount + 1 : 1;
            previousSignature = signature;
            if (stableReadCount >= 2) return latest;
        } catch (error) {
            lastError = safeError(error);
            previousSignature = null;
            stableReadCount = 0;
        }
        if (attempt < 4) await boundedReadbackDelay(attempt);
    }
    throw new Error(`Sentry workflow GET reconciliation did not reach two stable readbacks${lastError ? `: ${lastError}` : ''}`);
}

async function readStablePendingFinalizationState(pending: SentryFinalizationPendingState): Promise<{
    stableReadbacks: number;
    exactWorkflowDefinitionsVerified: boolean;
    workflowCount: number;
    legacyIssueRuleCount: number;
    scrubIPAddresses: boolean;
    detectorId: string;
    ownerUserId: string;
    workflowDefinitions: SentryWorkflowDefinition[];
}> {
    let previousSignature: string | null = null;
    let stableReadbacks = 0;
    let lastError = '';
    for (let attempt = 1; attempt <= 4; attempt += 1) {
        try {
            const project = await sentryRequest<ProjectShape>('GET', projectApiPath());
            const workflows = extractRecords(await sentryRequest<unknown>('GET', workflowsApiPath(), {
                project: SENTRY_PRODUCTION_TARGET.project,
            }));
            const projectRulesMirror = extractRecords(await sentryRequest<unknown>('GET', `${projectApiPath()}rules/`));
            const scrubIPAddresses = project.scrubIPAddresses === true
                || project.options?.['sentry:scrub_ip_address'] === true;
            const ownership = matchPendingWorkflowOwnership(workflows, pending);
            const mirror = analyzeSentryProjectRulesMirror(projectRulesMirror, ownership.workflowDefinitions);
            const exactTargetState = ownership.exact && mirror.exact;
            const signature = JSON.stringify({
                scrubIPAddresses,
                projectRulesMirror: mirror,
                workflowInventory: workflows.map((workflow) => ({
                    idFingerprint: fingerprintSentryId(String(workflow.id ?? '')),
                    name: String(workflow.name ?? ''),
                })).sort((left, right) => left.idFingerprint.localeCompare(right.idFingerprint)),
                exactWorkflowDefinitionsVerified: exactTargetState,
            });
            stableReadbacks = signature === previousSignature ? stableReadbacks + 1 : 1;
            previousSignature = signature;
            if (stableReadbacks >= 2) {
                return {
                    stableReadbacks,
                    exactWorkflowDefinitionsVerified: exactTargetState,
                    workflowCount: workflows.length,
                    legacyIssueRuleCount: mirror.unmatchedEntryCount,
                    scrubIPAddresses,
                    detectorId: ownership.detectorId,
                    ownerUserId: ownership.ownerUserId,
                    workflowDefinitions: ownership.workflowDefinitions,
                };
            }
        } catch (error) {
            lastError = safeError(error);
            previousSignature = null;
            stableReadbacks = 0;
        }
        if (attempt < 4) await boundedReadbackDelay(attempt);
    }
    throw new Error(`Sentry pending-finalization GET verification did not reach two stable readbacks${lastError ? `: ${lastError}` : ''}`);
}

function matchPendingWorkflowOwnership(
    workflows: Array<Record<string, unknown>>,
    pending: SentryFinalizationPendingState,
): {
    exact: boolean;
    detectorId: string;
    ownerUserId: string;
    workflowDefinitions: SentryWorkflowDefinition[];
} {
    const failure = { exact: false, detectorId: '', ownerUserId: '', workflowDefinitions: [] };
    if (workflows.length !== pending.workflowIdFingerprints.length) return failure;
    const workflowsByFingerprint = new Map(workflows.map((workflow) => {
        const rawId = typeof workflow.id === 'string' || typeof workflow.id === 'number'
            ? String(workflow.id)
            : '';
        return [fingerprintSentryId(rawId), workflow] as const;
    }));
    const ownedWorkflows = pending.workflowIdFingerprints.map((entry) => {
        const workflow = workflowsByFingerprint.get(entry.idFingerprint);
        return workflow?.name === entry.name ? workflow : null;
    });
    if (ownedWorkflows.some((workflow) => workflow === null)) return failure;
    const first = ownedWorkflows[0] as Record<string, unknown>;
    const detectorIds = Array.isArray(first.detectorIds) && first.detectorIds.every((value) => typeof value === 'string')
        ? first.detectorIds
        : [];
    const owner = typeof first.owner === 'string' && first.owner.startsWith('user:')
        ? first.owner.slice('user:'.length)
        : '';
    if (detectorIds.length !== 1
        || !owner
        || fingerprintSentryId(detectorIds[0]) !== pending.detectorFingerprint
        || fingerprintSentryId(owner) !== pending.ownerFingerprint) return failure;
    const definitions = buildSentryProductionWorkflows({ detectorId: detectorIds[0], ownerUserId: owner });
    const exact = pending.workflowIdFingerprints.every((entry) => {
        const workflow = workflowsByFingerprint.get(entry.idFingerprint);
        const definition = definitions.find((candidate) => candidate.name === entry.name);
        return Boolean(workflow && definition && workflowMatchesDefinition(workflow, definition));
    });
    return {
        exact,
        detectorId: detectorIds[0],
        ownerUserId: owner,
        workflowDefinitions: definitions,
    };
}

async function readStableHardeningState(
    requiredWorkflowFingerprints: SentryExecutedReceiptAnchor['workflowIdFingerprints'] | null = null,
): Promise<{
    stableReadbacks: number;
    exactWorkflowDefinitionsVerified: boolean;
    identityFingerprintsMatched: boolean;
    workflowIdFingerprintsMatched: boolean;
    workflowCount: number;
    legacyIssueRuleCount: number;
    scrubIPAddresses: boolean;
}> {
    let previousSignature: string | null = null;
    let stableReadCount = 0;
    let latest = {
        stableReadbacks: 0,
        exactWorkflowDefinitionsVerified: false,
        identityFingerprintsMatched: false,
        workflowIdFingerprintsMatched: requiredWorkflowFingerprints === null,
        workflowCount: 0,
        legacyIssueRuleCount: -1,
        scrubIPAddresses: false,
    };
    let lastError = '';
    for (let attempt = 1; attempt <= 4; attempt += 1) {
        try {
            const project = await sentryRequest<ProjectShape>('GET', projectApiPath());
            const workflows = extractRecords(await sentryRequest<unknown>('GET', workflowsApiPath(), {
                project: SENTRY_PRODUCTION_TARGET.project,
            }));
            const projectRulesMirror = extractRecords(await sentryRequest<unknown>('GET', `${projectApiPath()}rules/`));
            const detectors = extractRecords(await sentryRequest<unknown>('GET', detectorsApiPath(), {
                project: SENTRY_PRODUCTION_TARGET.project,
            }));
            const members = await sentryRequest<MemberShape[]>('GET', membersApiPath());
            const identity = resolveSentryIdentity(detectors, members);
            const identityFingerprintsMatched = identity.exact
                && identity.detectorFingerprint === detectorFingerprint
                && identity.ownerFingerprint === ownerFingerprint;
            const scrubIPAddresses = project.scrubIPAddresses === true
                || project.options?.['sentry:scrub_ip_address'] === true;
            const nativeWorkflowDefinitionsVerified = workflows.length === workflowDefinitions.length
                && workflowDefinitions.every((definition) => (
                    workflows.some((workflow) => workflowMatchesDefinition(workflow, definition))
                ));
            const mirror = analyzeSentryProjectRulesMirror(projectRulesMirror, workflowDefinitions);
            const workflowIdFingerprintsMatched = requiredWorkflowFingerprints === null
                || matchReattestedWorkflowOwnership(workflows, requiredWorkflowFingerprints);
            const exactWorkflowDefinitionsVerified = nativeWorkflowDefinitionsVerified
                && mirror.exact
                && identityFingerprintsMatched
                && workflowIdFingerprintsMatched;
            const signature = JSON.stringify({
                scrubIPAddresses,
                workflowInventory: workflows.map((workflow) => ({
                    id: String(workflow.id ?? ''),
                    name: String(workflow.name ?? ''),
                    exact: workflowDefinitions.some((definition) => workflowMatchesDefinition(workflow, definition)),
                })).sort((left, right) => `${left.name}:${left.id}`.localeCompare(`${right.name}:${right.id}`)),
                projectRulesMirror: mirror,
                identity: {
                    exact: identity.exact,
                    detectorFingerprint: identity.detectorFingerprint,
                    ownerFingerprint: identity.ownerFingerprint,
                    enabledErrorDetectorCount: identity.enabledErrorDetectorCount,
                    activeMemberCount: identity.activeMemberCount,
                    privilegedMemberCount: identity.privilegedMemberCount,
                },
            });
            stableReadCount = signature === previousSignature ? stableReadCount + 1 : 1;
            previousSignature = signature;
            latest = {
                stableReadbacks: stableReadCount,
                exactWorkflowDefinitionsVerified,
                identityFingerprintsMatched,
                workflowIdFingerprintsMatched,
                workflowCount: workflows.length,
                legacyIssueRuleCount: mirror.unmatchedEntryCount,
                scrubIPAddresses,
            };
            if (stableReadCount >= 2) return latest;
        } catch (error) {
            lastError = safeError(error);
            previousSignature = null;
            stableReadCount = 0;
        }
        if (attempt < 4) await boundedReadbackDelay(attempt);
    }
    throw new Error(`Sentry final hardening GET verification did not reach two stable readbacks${lastError ? `: ${lastError}` : ''}`);
}

async function readStableScrubIp(): Promise<boolean> {
    let previous: boolean | null = null;
    let stableReadCount = 0;
    let lastError = '';
    for (let attempt = 1; attempt <= 4; attempt += 1) {
        try {
            const project = await sentryRequest<ProjectShape>('GET', projectApiPath());
            const value = project.scrubIPAddresses === true || project.options?.['sentry:scrub_ip_address'] === true;
            stableReadCount = value === previous ? stableReadCount + 1 : 1;
            previous = value;
            if (stableReadCount >= 2) return value;
        } catch (error) {
            lastError = safeError(error);
            previous = null;
            stableReadCount = 0;
        }
        if (attempt < 4) await boundedReadbackDelay(attempt);
    }
    throw new Error(`Sentry project GET reconciliation did not reach two stable readbacks${lastError ? `: ${lastError}` : ''}`);
}

async function boundedReadbackDelay(attempt: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, attempt * 200));
}

function acquireExecutionLock(): void {
    mkdirSync(hardeningOutputRoot, { recursive: true });
    const descriptor = openSync(executionLockPath, 'wx');
    executionLockAcquired = true;
    try {
        writeJournalRecord(descriptor, {
            schemaVersion: 1,
            event: 'lock_acquired',
            runStartedAt: startedAt.toISOString(),
            target: SENTRY_PRODUCTION_TARGET,
            initialScrubIPAddresses: initialScrubIp,
            workflowNames: workflowDefinitions.map((definition) => definition.name),
            detectorFingerprint,
            ownerFingerprint,
            rawIdentifiersRestrictedToThisGitignoredLock: true,
        });
        fsyncSync(descriptor);
    } finally {
        closeSync(descriptor);
    }
}

function appendExecutionJournal(event: Record<string, unknown>): void {
    if (!executionLockAcquired || !existsSync(executionLockPath)) {
        throw new Error('Sentry production hardening execution lock is unavailable');
    }
    const descriptor = openSync(executionLockPath, 'a');
    try {
        writeJournalRecord(descriptor, event);
        fsyncSync(descriptor);
    } finally {
        closeSync(descriptor);
    }
}

function writeJournalRecord(descriptor: number, event: Record<string, unknown>): void {
    const record = JSON.stringify({ ...event, recordedAt: new Date().toISOString() });
    writeSync(descriptor, `${record}\n`, null, 'utf8');
}

function rememberCreatedWorkflow(name: string, id: string, source: 'post_response'): void {
    const existing = createdWorkflowIdsByName.get(name);
    if (existing && existing !== id) {
        throw new Error(`Sentry workflow reconciliation produced conflicting ids for ${name}`);
    }
    if (existing === id) return;
    createdWorkflowIdsByName.set(name, id);
    if (!createdWorkflowIds.includes(id)) createdWorkflowIds.push(id);
    appendExecutionJournal({
        event: 'workflow_id_observed',
        workflowName: name,
        workflowId: id,
        source,
    });
}

function removeExecutionLock(): void {
    if (!executionLockAcquired || !existsSync(executionLockPath)) {
        throw new Error('Sentry production hardening execution lock cannot be removed because it is unavailable');
    }
    removeSentryProductionExecutionLock(executionLockPath);
    executionLockAcquired = false;
}

async function sentryRequest<T>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    pathName: string,
    params: Record<string, string> = {},
    body?: unknown,
): Promise<T> {
    if (reattestRequested && method !== 'GET') {
        throw new Error(`Sentry GET-only reattestation blocked forbidden ${method} request`);
    }
    if (!sentryBaseUrlIsCanonical) {
        throw new Error('Sentry API origin is not the exact canonical production origin');
    }
    const url = new URL(pathName, baseUrl);
    if (url.origin !== SENTRY_API_ORIGIN || url.username || url.password) {
        throw new Error('Sentry request escaped the exact canonical production origin');
    }
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    const response = await fetch(url, {
        method,
        headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/json',
            ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) throw new Error(`Sentry ${method} ${pathName} returned HTTP ${response.status}`);
    if (response.status === 204) return undefined as T;
    return await response.json() as T;
}

function validateLocalEnvironment(): Check {
    const configuredOrg = env.SENTRY_ORG?.trim() || process.env.SENTRY_ORG?.trim();
    const configuredProject = env.SENTRY_PROJECT?.trim() || process.env.SENTRY_PROJECT?.trim();
    const valid = Boolean(token)
        && (!configuredOrg || configuredOrg === SENTRY_PRODUCTION_TARGET.organization)
        && (!configuredProject || configuredProject === SENTRY_PRODUCTION_TARGET.project)
        && sentryBaseUrlIsCanonical;
    return valid
        ? ok('local_environment', 'Local Sentry environment pins the exact production organization/project and API origin.', [
            `target=${SENTRY_PRODUCTION_TARGET.organization}/${SENTRY_PRODUCTION_TARGET.project}`,
            `baseOrigin=${SENTRY_API_ORIGIN}`,
            'token=present_not_persisted',
        ])
        : fail('local_environment', 'Local Sentry target/token/API origin is missing or does not match the exact production boundary.', [
            `orgMatches=${String(!configuredOrg || configuredOrg === SENTRY_PRODUCTION_TARGET.organization)}`,
            `projectMatches=${String(!configuredProject || configuredProject === SENTRY_PRODUCTION_TARGET.project)}`,
            `tokenPresent=${String(Boolean(token))}`,
            `baseOriginCanonical=${String(sentryBaseUrlIsCanonical)}`,
            'externalWriteAttempted=false',
        ]);
}

function validateReattestationSourceReceipt(): Check {
    if (!cli.sourceReceiptPath) {
        return fail('reattestation_source_receipt', 'GET-only reattestation requires an explicit executed source receipt.', [
            'requiredFlag=--source-receipt <sentry-production-hardening-receipt.json>',
            'networkAccessPerformed=false',
        ]);
    }
    try {
        const receiptBytes = readFileSync(cli.sourceReceiptPath);
        const parsed = JSON.parse(receiptBytes.toString('utf8')) as unknown;
        const validation = validateSentryHardeningExecutedReceiptAnchor(parsed, startedAt);
        if (!validation.valid || !validation.value) {
            return fail('reattestation_source_receipt', 'Executed Sentry source receipt is not a valid ownership anchor.', [
                ...validation.errors,
                'networkAccessPerformed=false',
            ]);
        }
        reattestationAnchor = validation.value;
        reattestationSourceReceiptSha256 = createHash('sha256').update(receiptBytes).digest('hex');
        return ok('reattestation_source_receipt', 'Executed Sentry receipt is a valid POST-owned identity anchor.', [
            `sourceReceiptSha256=${reattestationSourceReceiptSha256}`,
            `sourceReceiptEndedAt=${validation.value.endedAt}`,
            'workflowOwnership=post_response',
            'networkAccessPerformed=false',
        ]);
    } catch (error) {
        return fail('reattestation_source_receipt', 'Executed Sentry source receipt could not be read or validated.', [
            safeError(error),
            'networkAccessPerformed=false',
        ]);
    }
}

function currentReattestationAnchor(): SentryExecutedReceiptAnchor | null {
    return reattestationAnchor;
}

function isCanonicalSentryBaseUrl(value: string): boolean {
    if (value !== SENTRY_API_ORIGIN && value !== `${SENTRY_API_ORIGIN}/`) return false;
    try {
        const url = new URL(value);
        return url.origin === SENTRY_API_ORIGIN
            && url.protocol === 'https:'
            && url.hostname === 'sentry.io'
            && url.port === ''
            && url.username === ''
            && url.password === ''
            && url.pathname === '/'
            && url.search === ''
            && url.hash === '';
    } catch {
        return false;
    }
}

function validateExecutionLockAbsence(): Check {
    const lockPresent = existsSync(executionLockPath);
    const finalizationPending = existsSync(finalizationPendingPath);
    return lockPresent || finalizationPending
        ? fail('execution_lock_preflight', 'A prior Sentry execution or finalization state requires reconciliation before any new run.', [
            `lockPresent=${String(lockPresent)}`,
            `finalizationPending=${String(finalizationPending)}`,
            'rawLockContentsPersistedInReports=false',
            'externalWriteAttempted=false',
        ])
        : ok('execution_lock_preflight', 'No prior Sentry hardening execution lock is present.', [
            'lockPresent=false',
            'finalizationPending=false',
        ]);
}

function validateExecutionLockPresence(): Check {
    const lockPresent = existsSync(executionLockPath);
    const finalizationPending = existsSync(finalizationPendingPath);
    return lockPresent || finalizationPending
        ? ok('execution_lock_recovery_preflight', 'A prior Sentry lock or finalization state is present for GET-first reconciliation.', [
            `lockPresent=${String(lockPresent)}`,
            `finalizationPending=${String(finalizationPending)}`,
            'rawLockContentsPersistedInReports=false',
        ])
        : fail('execution_lock_recovery_preflight', 'Recovery mode requires a prior gitignored execution or finalization state.', [
            'lockPresent=false',
            'finalizationPending=false',
            'externalWriteAttempted=false',
        ]);
}

function extractRecords(payload: unknown): Array<Record<string, unknown>> {
    if (Array.isArray(payload)) return payload.filter(isRecord);
    if (!isRecord(payload)) return [];
    for (const key of ['data', 'results', 'workflows', 'rules', 'detectors']) {
        if (Array.isArray(payload[key])) return payload[key].filter(isRecord);
    }
    return [];
}

function resolveSentryIdentity(
    detectors: Array<Record<string, unknown>>,
    members: MemberShape[],
): SentryIdentitySnapshot {
    const errorDetectors = detectors.filter((record) => (
        record.type === 'error' && record.enabled !== false && typeof record.id === 'string'
    ));
    const active = members.filter((member) => member.expired !== true && member.pending !== true);
    const privileged = active.filter((member) => (
        ['owner', 'manager', 'admin'].includes(member.orgRole ?? member.role ?? '')
    ));
    const owner = privileged.length === 1 ? privileged[0] : active.length === 1 ? active[0] : null;
    const rawOwnerUserId = owner?.user?.id ?? owner?.id ?? '';
    const ownerUserId = typeof rawOwnerUserId === 'string' ? rawOwnerUserId : '';
    const detectorId = errorDetectors.length === 1 ? String(errorDetectors[0].id) : '';
    const exact = Boolean(detectorId && ownerUserId);
    return {
        exact,
        detectorId,
        ownerUserId,
        detectorFingerprint: exact ? fingerprintSentryId(detectorId) : '',
        ownerFingerprint: exact ? fingerprintSentryId(ownerUserId) : '',
        enabledErrorDetectorCount: errorDetectors.length,
        activeMemberCount: active.length,
        privilegedMemberCount: privileged.length,
    };
}

function projectApiPath(): string {
    return `/api/0/projects/${SENTRY_PRODUCTION_TARGET.organization}/${SENTRY_PRODUCTION_TARGET.project}/`;
}

function workflowsApiPath(): string {
    return `/api/0/organizations/${SENTRY_PRODUCTION_TARGET.organization}/workflows/`;
}

function detectorsApiPath(): string {
    return `/api/0/organizations/${SENTRY_PRODUCTION_TARGET.organization}/detectors/`;
}

function membersApiPath(): string {
    return `/api/0/organizations/${SENTRY_PRODUCTION_TARGET.organization}/members/`;
}

function renderSummary(value: typeof report): string {
    return `${[
        '# Sentry Production Hardening',
        '',
        `- Status: ${value.status}`,
        `- Closure: ${value.closureStatus}`,
        `- Target: ${value.target.organization}/${value.target.project}`,
        `- Environment: ${value.target.environment}`,
        `- Mode: ${value.mode}`,
        `- Execute requested: ${String(value.executeRequested)}`,
        `- External write attempted: ${String(value.externalWriteAttempted)}`,
        `- External write performed: ${String(value.externalWritePerformed)}`,
        `- External write outcome was ever ambiguous: ${String(value.externalWriteOutcomeAmbiguous)}`,
        `- Rollback attempted: ${String(value.rollbackAttempted)}`,
        `- Rollback complete: ${String(value.rollbackComplete)}`,
        `- Execution lock retained for recovery: ${String(value.executionLockRetainedForRecovery)}`,
        `- Raw identifiers persisted in reports: ${String(value.rawIdentifiersPersistedInReports)}`,
        `- Rollout eligible: ${String(value.evidenceContract.rolloutEligible)}`,
        `- Stable terminal readbacks: ${value.terminalProof.stableReadbacks}`,
        `- Detector SHA-256: ${value.detectorFingerprint || 'unavailable'}`,
        `- Owner SHA-256: ${value.ownerFingerprint || 'unavailable'}`,
        '',
        '| Status | Check | Message | Details |',
        '| --- | --- | --- | --- |',
        ...value.checks.map((check) => `| ${check.status} | ${check.name} | ${escapeCell(check.message)} | ${escapeCell(check.details.join(' / '))} |`),
        '',
        'The runner never reads Sentry events or payloads. Reports and receipts persist only hashes and counts; a raw workflow id may exist solely in the gitignored execution lock until terminal readback or recovery is proven.',
        '',
    ].join('\n')}\n`;
}

function renderApprovalGate(value: typeof report): string {
    return `${[
        '# Sentry Production Hardening Approval Gate',
        '',
        'This file is not approval.',
        '',
        `- Exact target: \`${value.target.organization}/${value.target.project}\`.`,
        `- Exact environment: \`${value.target.environment}\`.`,
        `- Detector SHA-256: \`${value.detectorFingerprint || 'unavailable'}\`.`,
        `- Owner SHA-256: \`${value.ownerFingerprint || 'unavailable'}\`.`,
        `- Required flag: \`${value.approval.requiredFlag}\`.`,
        `- Required environment variable: \`${value.approval.environmentVariable}\`.`,
        '',
        '## Exact Approval Sentence',
        '',
        value.approval.exactSentence || '<unavailable until the exact read-only preflight succeeds>',
        '',
    ].join('\n')}\n`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function safeError(error: unknown): string {
    let message = error instanceof Error ? error.message : String(error);
    for (const secret of [token, detectorId, ownerUserId, ...createdWorkflowIds]) {
        if (secret) message = message.replaceAll(secret, '[redacted]');
    }
    return message.replace(/\r?\n/gu, ' ').slice(0, 500);
}

function ok(name: string, message: string, details: string[]): Check {
    return { status: 'ok', name, message, details };
}

function fail(name: string, message: string, details: string[]): Check {
    return { status: 'failed', name, message, details };
}

function escapeCell(value: string): string {
    return value.replace(/\|/gu, '\\|').replace(/\r?\n/gu, ' ');
}

function stamp(date: Date): string {
    return date.toISOString().replace(/[:.]/gu, '-');
}

function parseArguments(values: string[]): {
    executeRequested: boolean;
    recoverLockRequested: boolean;
    reattestRequested: boolean;
    sourceReceiptPath: string | null;
} {
    const normalized = values[0] === '--' ? values.slice(1) : values;
    let executeRequested = false;
    let recoverLockRequested = false;
    let reattestRequested = false;
    let sourceReceiptPath: string | null = null;
    for (let index = 0; index < normalized.length; index += 1) {
        const value = normalized[index];
        if (value === '--execute-approved') executeRequested = true;
        else if (value === '--recover-lock') recoverLockRequested = true;
        else if (value === '--reattest-existing') reattestRequested = true;
        else if (value === '--source-receipt') {
            const candidate = normalized[index + 1];
            if (!candidate || candidate.startsWith('--')) throw new Error('--source-receipt requires a file path.');
            if (sourceReceiptPath) throw new Error('--source-receipt may be provided only once.');
            sourceReceiptPath = path.resolve(candidate);
            index += 1;
        } else throw new Error(`Unsupported argument: ${value}`);
    }
    if (reattestRequested !== Boolean(sourceReceiptPath)) {
        throw new Error('--reattest-existing and --source-receipt must be provided together.');
    }
    return { executeRequested, recoverLockRequested, reattestRequested, sourceReceiptPath };
}
