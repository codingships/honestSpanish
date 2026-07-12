import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
    applyFreshStandalonePrimaryEvidence,
    applyFreshStandaloneSecondaryEvidence,
    readJsonEvidenceCandidates,
    readLatestJsonOrMarkdownSummary,
    selectStagingSmokeEvidence,
    summarizePrimaryResults,
    type StagingSmokeEvidenceSummary,
    type StandalonePrimaryEvidence,
    type StandaloneSecondaryEvidence,
} from './status-evidence';
import { collectOpenRcOperationalBlockers } from './rc-operational-checklist';

type FindingStatus = 'ok' | 'warning' | 'failed';
type LaunchStatus = 'BLOCKED' | 'READY_WITH_ACCEPTED_RISKS' | 'READY_CANDIDATE' | 'NO_EVIDENCE';

interface Finding {
    status: FindingStatus;
    area?: string;
    name?: string;
    message: string;
    details?: string[];
    evidence?: string;
}

interface PrimarySummary {
    status: string;
    outputDir: string;
    startedAt: string;
    endedAt: string;
    results: Finding[];
}

interface ManualEvidenceSummary {
    status: 'OK' | 'WARNING' | 'FAILED';
    outputDir: string;
    evidenceFile: string;
    manualEvidenceIndexPath?: string;
    nextActionsPath?: string;
    phaseOneWorksheetPath?: string;
    phaseOneClosurePackPath?: string;
    startedAt: string;
    endedAt: string;
    manualEvidencePhaseSummary?: unknown[];
    manualEvidenceByPhase?: Partial<Record<ManualEvidencePhase, PhaseManualCheck[]>>;
    findings: Finding[];
}

type ManualEvidencePhase = 'phase_1_now' | 'phase_2_release_candidate' | 'phase_3_final' | 'unknown';

interface PhaseManualCheck {
    id: string;
    phase: ManualEvidencePhase;
    label?: string;
    heading?: string;
    area: string;
    status: 'failed' | 'warning';
    message: string;
    details: string[];
}

type ManualEvidencePhaseCategory = 'work_now' | 'release_candidate' | 'final_only' | 'unknown';

interface ManualEvidencePhaseSummary {
    phase: ManualEvidencePhase;
    heading: string;
    category: ManualEvidencePhaseCategory;
    openCount: number;
    failedCount: number;
    warningCount: number;
    checkIds: string[];
}

interface SecondaryReviewSummary {
    status: string;
    primaryEvidenceDir: string | null;
    startedAt: string;
    endedAt: string;
    findings: Finding[];
}

interface AuditSummary {
    status: string;
    outputDir: string;
    startedAt: string;
    endedAt: string;
}

interface CheckBackedSummary extends AuditSummary {
    checks?: Array<{
        status?: FindingStatus;
        name?: string;
        message?: string;
        details?: string[];
    }>;
    remediationPackPath?: string;
    buildPackageManifestPath?: string;
    closurePackPath?: string;
    nextApprovalPath?: string;
    nextActionPath?: string;
    executionBoardPath?: string;
    evidenceManifestPath?: string;
}

interface FinalApprovalCriticalPathStep {
    id?: string;
    title?: string;
    phase?: string;
    itemIds?: string[];
    prerequisites?: string[];
    blocks?: string[];
    closeWhen?: string;
    stopIf?: string[];
}

interface FinalApprovalQueueItem {
    id?: string;
    title?: string;
    status?: string;
    waitReason?: string;
    prerequisiteItemIds?: string[];
    finalBlockers?: string[];
}

interface FinalApprovalQueueManifest {
    approvalQueueStatus?: string;
    items?: FinalApprovalQueueItem[];
    criticalPath?: FinalApprovalCriticalPathStep[];
}

interface StrictQaFinding {
    errorId?: string;
    status?: string;
    severity?: string;
    type?: string;
    surface?: string;
    summary?: string;
    fix?: string;
    retestEvidence?: string;
}

interface StrictQaResults {
    findings?: StrictQaFinding[];
}

interface StrictQaTrackerOutput {
    file: string;
    data: StrictQaResults;
    endedAt: string;
}

interface GateStep {
    name: string;
    exitCode: number | null;
    status: 'ok' | 'failed';
    logPath: string;
}

interface GateSummary {
    status: string;
    outputDir: string;
    startedAt: string;
    endedAt: string;
    steps: GateStep[];
    statusSummaryPath: string | null;
}

interface ReleaseCandidateGateSummary {
    status: string;
    outputDir: string;
    startedAt: string;
    endedAt: string;
    statusSummaryPath: string | null;
}

interface PhaseOneSummary {
    status: string;
    outputDir: string;
    startedAt: string;
    endedAt: string;
    phaseOneOpenChecks?: unknown[];
    phaseOneArtifacts?: {
        phaseOneClosurePackPath?: string | null;
    };
}

interface SourceRef {
    label: string;
    status: string;
    path: string | null;
}

interface EvidenceTimestamp {
    label: string;
    endedAt?: string | null;
}

interface TimedEvidenceSummary {
    endedAt?: string | null;
}

interface StatusReport {
    schemaVersion: 1;
    startedAt: string;
    endedAt: string;
    status: LaunchStatus;
    releaseCandidateReadiness: ReleaseCandidateReadiness;
    sources: SourceRef[];
    currentEvidence: CurrentEvidence[];
    blockers: Finding[];
    warnings: Finding[];
    openGoNoGo: string[];
    urgencySummary: UrgencySummary[];
    phaseOneFocus: PhaseOneFocusItem[];
    manualEvidenceCoverage: ManualEvidenceCoverageItem[];
    manualEvidencePhaseSummary: ManualEvidencePhaseSummary[];
    manualEvidenceByPhase: Record<ManualEvidencePhase, PhaseManualCheck[]>;
    nextActions: string[];
    outputDir: string;
    finalClosurePackPath: string;
}

type UrgencyBucket = 'phase_1_now' | 'phase_2_release_candidate' | 'phase_3_final' | 'automatic_legal';

interface UrgencySummary {
    bucket: UrgencyBucket;
    heading: string;
    openCount: number;
    failedCount: number;
    warningCount: number;
    checkIds: string[];
    decisionRule: string;
}

interface CurrentEvidence {
    label: string;
    status: string;
    path: string | null;
    role: string;
}

type PhaseOneFocusStatus = 'clear' | 'failed' | 'warning';

type ReleaseCandidateStatus =
    | 'RC_BLOCKED_BY_PHASE_1'
    | 'RC_BLOCKED_BY_RELEASE_CANDIDATE_CHECKS'
    | 'RC_READY_WITH_ACCEPTED_RISKS'
    | 'RC_READY_WITH_FINAL_BLOCKERS'
    | 'RC_READY_FOR_GO_NO_GO'
    | 'NO_EVIDENCE';

interface ReleaseCandidateReadiness {
    status: ReleaseCandidateStatus;
    reason: string;
    phaseOneOpenChecks: string[];
    releaseCandidateOpenChecks: string[];
    finalOnlyOpenChecks: string[];
    strictQaOpenChecks: string[];
    acceptedRiskChecks: string[];
    provenNow: string[];
    nextDecision: string;
}

interface PhaseOneFocusItem {
    id: string;
    status: PhaseOneFocusStatus;
    supportCommand: string;
    evidenceMinimum: string;
    nextStep: string;
}

interface ManualEvidenceCoverageItem {
    id: string;
    phase: ManualEvidencePhase;
    heading: string;
    status: FindingStatus | 'missing';
    area: string;
    message: string;
}

const manualEvidencePhaseMap: Record<string, { phase: ManualEvidencePhase; label: string }> = {
    cleanup_agents_decision: { phase: 'phase_1_now', label: 'Fase 1: ordenar ahora' },
    content_review: { phase: 'phase_1_now', label: 'Fase 1: ordenar ahora' },
    accessibility_manual: { phase: 'phase_1_now', label: 'Fase 1: ordenar ahora' },
    security_external: { phase: 'phase_1_now', label: 'Fase 1: ordenar ahora; repetir en cierre final' },
    operations_external: { phase: 'phase_1_now', label: 'Fase 1: ordenar ahora; repetir en cierre final' },
    database_readiness: { phase: 'phase_1_now', label: 'Fase 1: ordenar ahora; repetir en cierre final' },
    payments_staging: { phase: 'phase_3_final', label: 'Fase 3: cierre final; antes de activar pagos reales' },
    legal_owner_controller: { phase: 'phase_3_final', label: 'Fase 3: cierre final' },
    legal_human_review: { phase: 'phase_3_final', label: 'Fase 3: cierre final' },
    integration_readiness: { phase: 'phase_3_final', label: 'Fase 3: cierre final' },
    seo_llm_final: { phase: 'phase_3_final', label: 'Fase 3: cierre final' },
    final_smoke: { phase: 'phase_3_final', label: 'Fase 3: cierre final' },
};

const phaseOrder: ManualEvidencePhase[] = [
    'phase_1_now',
    'phase_2_release_candidate',
    'phase_3_final',
    'unknown',
];

const phaseHeadings: Record<ManualEvidencePhase, string> = {
    phase_1_now: 'Fase 1: Ordenar Ahora',
    phase_2_release_candidate: 'Fase 2: Release Candidate',
    phase_3_final: 'Fase 3: Cierre Final',
    unknown: 'Sin Fase Mapeada',
};

const phaseCategories: Record<ManualEvidencePhase, ManualEvidencePhaseCategory> = {
    phase_1_now: 'work_now',
    phase_2_release_candidate: 'release_candidate',
    phase_3_final: 'final_only',
    unknown: 'unknown',
};

const phaseOneFocusOrder = [
    'cleanup_agents_decision',
    'content_review',
    'accessibility_manual',
    'database_readiness',
    'operations_external',
    'security_external',
] as const;

const phaseOneFocusDetails: Record<typeof phaseOneFocusOrder[number], Omit<PhaseOneFocusItem, 'id' | 'status'>> = {
    cleanup_agents_decision: {
        supportCommand: 'pnpm launch:cleanup',
        evidenceMinimum: 'Decision keep/move/delete for .agent/ and .agents/, with recovery path if moved.',
        nextStep: 'Record the decision in docs/launch/MANUAL_EVIDENCE.local.json under cleanup_agents_decision.',
    },
    content_review: {
        supportCommand: 'pnpm launch:content',
        evidenceMinimum: 'Human review of ES/EN/RU copy, prices, emails, empty states and error states.',
        nextStep: 'Record reviewed routes and any copy changes under content_review.',
    },
    accessibility_manual: {
        supportCommand: 'pnpm launch:accessibility',
        evidenceMinimum: 'Manual keyboard, focus, screen reader, 200% zoom, mobile and critical-form pass.',
        nextStep: 'Record devices/browsers, routes and failures fixed under accessibility_manual.',
    },
    database_readiness: {
        supportCommand: 'pnpm launch:operations + pnpm launch:staging-db-rollout + pnpm launch:supabase-security-rollout',
        evidenceMinimum: 'Supabase staging/production separation, hosted migrations/RLS/privileges, SEC-014/SEC-015 security migrations, staging data flows, Free-plan backup posture and audit/job tables reviewed.',
        nextStep: 'Open the latest staging schema rollout pack for CRM/schema drift and the latest Supabase security rollout pack for migrations 021/022/20260702124757, apply/verify only the explicitly approved scope with staging first, rerun hosted-schema-check.sql plus the security post-apply verification SQL, resolve or explain missing launch-critical tables/columns/indexes/RLS/policies/privileges, then record Supabase Free backup posture and migration/RLS evidence before production is considered.',
    },
    operations_external: {
        supportCommand: 'pnpm launch:operations + pnpm launch:operations-external-closure',
        evidenceMinimum: 'Cloudflare fulfillment Worker staging, fulfillment jobs, Resend staging, Workers Logs/observability visibility, Supabase Free backup posture and rollback baseline verified externally; cron config, staging deployment and secret-name evidence are covered by preflight.',
        nextStep: 'Close Cloudflare Workers Logs/observability evidence and Resend staging visibility; close Admin Jobs staging UI/runtime after database_readiness is closed, or record an explicit scoped RC substitute based on local UI/API/tests while staging DB remains unavailable. Keep production Worker, final Drive smoke and final backup action under final-only checks.',
    },
    security_external: {
        supportCommand: 'pnpm launch:security',
        evidenceMinimum: 'External RLS, privileged key placement, current Cloudflare/Turnstile/log posture and visible third-party access reviewed for RC.',
        nextStep: 'Close current WAF/Turnstile/log review as pass evidence; keep final key rotation, live-domain review and deeper permission cleanup under final-only checks.',
    },
};

const startedAt = new Date();
const outputDir = path.join(process.cwd(), 'outputs', 'launch-status', stamp(startedAt));
const outputsRoot = path.join(process.cwd(), 'outputs');
const finalClosurePackPath = path.join(outputDir, 'final-closure-pack.md');
mkdirSync(outputDir, { recursive: true });

const primary = readLatestJson<PrimarySummary>('launch-verification', 'summary.json');
const sequence = readLatestJson<AuditSummary>('launch-sequence', 'summary.json');
const legal = readLatestJson<AuditSummary>('launch-legal', 'summary.json');
const legalFinalInputs = readLatestJson<CheckBackedSummary>('launch-legal-final-inputs', 'summary.json');
const manual = readLatestJson<ManualEvidenceSummary>('launch-manual-evidence', 'summary.json');
const secondary = readLatestJson<SecondaryReviewSummary>('launch-secondary-review', 'secondary-review.json');
const gate = readLatestJson<GateSummary>('launch-gate', 'summary.json');
const releaseCandidateGate = readLatestJson<ReleaseCandidateGateSummary>('launch-rc', 'summary.json');
const phaseOne = readLatestJson<PhaseOneSummary>('launch-phase-1', 'summary.json');
const functionalRc = readLatestJson<AuditSummary>('launch-functional-rc', 'summary.json');
const securityAudit = readLatestJson<AuditSummary>('launch-security', 'summary.json');
const operationsAudit = readLatestJson<AuditSummary>('launch-operations', 'summary.json');
const accessibilityAudit = readLatestJson<AuditSummary>('launch-accessibility', 'summary.json');
const cleanupAudit = readLatestJson<AuditSummary>('launch-cleanup', 'summary.json');
const finalReadinessAudit = readLatestJson<AuditSummary>('launch-final-readiness', 'summary.json');
const payments = readLatestJson<AuditSummary>('launch-payments', 'summary.json');
const noRealPayments = readLatestJson<CheckBackedSummary>('launch-no-real-payments', 'summary.json');
const noRealPaymentsRemediation = readLatestJson<CheckBackedSummary>('launch-staging-no-real-payments-remediation', 'summary.json');
const rcExternalClosure = readLatestJson<CheckBackedSummary>('launch-rc-external-closure', 'summary.json');
const operationsExternalClosure = readLatestJson<CheckBackedSummary>('launch-operations-external-closure', 'summary.json');
const stagingDatabaseRollout = readLatestJson<AuditSummary>('launch-staging-database-rollout', 'summary.json');
const liveDomainReadonly = readLatestJson<CheckBackedSummary>('launch-live-domain-readonly-evidence', 'summary.json');
const seoAudit = readLatestJson<AuditSummary>('launch-seo', 'summary.json');
const seoLlmFinalPackage = readLatestJson<CheckBackedSummary>('launch-seo-llm-final-package', 'summary.json');
const integrationFinalPackage = readLatestJson<CheckBackedSummary>('launch-integration-final-package', 'summary.json');
const stripeReadonlyEvidence = readLatestJson<CheckBackedSummary>('launch-stripe-readonly-evidence', 'summary.json');
const turnstileReadonlyEvidence = readLatestJson<CheckBackedSummary>('launch-turnstile-readonly-evidence', 'summary.json');
const sentryReadonlyEvidence = readLatestJson<CheckBackedSummary>('launch-sentry-readonly-evidence', 'summary.json');
const googleReadonlyEvidence = readLatestJson<CheckBackedSummary>('launch-google-readonly-evidence', 'summary.json');
const resendReadonlyEvidence = readLatestJson<CheckBackedSummary>('resend-readonly-evidence', 'summary.json');
const stripeWebhookCutoverPack = readLatestJson<CheckBackedSummary>('launch-stripe-webhook-cutover-pack', 'summary.json');
const stripeWebhookCutoverRunner = readLatestJson<CheckBackedSummary>('launch-stripe-webhook-cutover-runner', 'summary.json');
const turnstileDomainClosurePack = readLatestJson<CheckBackedSummary>('launch-turnstile-domain-closure-pack', 'summary.json');
const turnstileDomainClosureRunner = readLatestJson<CheckBackedSummary>('launch-turnstile-domain-closure-runner', 'summary.json');
const sentryTriagePack = readLatestJson<CheckBackedSummary>('launch-sentry-triage-pack', 'summary.json');
const sentryIssueTriageRunner = readLatestJson<CheckBackedSummary>('launch-sentry-issue-triage-runner', 'summary.json');
const finalSmokeExecutionPack = readLatestJson<CheckBackedSummary>('launch-final-smoke-execution-pack', 'summary.json');
const stagingSmokeSelection = selectStagingSmokeEvidence(readJsonEvidenceCandidates<CheckBackedSummary & StagingSmokeEvidenceSummary>(
    outputsRoot,
    'launch-staging-smoke-rehearsal-runner',
    'summary.json',
));
const stagingSmokeRehearsalRunner = stagingSmokeSelection.preferred;
const stagingSmokeLatestPlan = stagingSmokeSelection.latestPlan;
const finalApprovalQueue = readLatestJson<CheckBackedSummary>('launch-final-approval-queue', 'summary.json');
const finalApprovalQueueManifest = readLatestJson<FinalApprovalQueueManifest>('launch-final-approval-queue', 'final-approval-queue-manifest.json');
const cloudflareProductionRuntimeReadonly = readLatestJson<CheckBackedSummary>('launch-cloudflare-production-runtime-readonly', 'summary.json');
const cloudflareProductionRuntimeCutoverPreflight = readLatestJson<CheckBackedSummary>('launch-cloudflare-production-runtime-cutover-preflight', 'summary.json');
const cloudflareProductionRuntimeCutover = readLatestJson<CheckBackedSummary>('launch-cloudflare-production-runtime-cutover', 'summary.json');
const cloudflareProductionWorkerPhaseOne = readLatestJson<CheckBackedSummary>('launch-cloudflare-production-worker-phase1', 'summary.json');
const cloudflareProductionWorkerSecrets = readLatestJson<CheckBackedSummary>('launch-cloudflare-production-worker-secrets', 'summary.json');
const cloudflareProductionFulfillmentSecrets = readLatestJsonOrMarkdownSummary<CheckBackedSummary>(
    outputsRoot,
    'launch-cloudflare-production-fulfillment-secrets',
);
const supabaseProcessedAtCleanupRunner = readLatestJson<CheckBackedSummary>('launch-supabase-processed-at-cleanup-runner', 'summary.json');
const supabaseProcessedAtReadonlyPreflight = latestGeneratedPath('supabase-processed-at-readonly-preflight', 'summary.md');
const strictQaTracker = readLatestStrictQaResults();
const strictQaOpenFindings = collectStrictQaOpenFindings(strictQaTracker?.data ?? null);
const strictQaOpenSecurityFindings = strictQaOpenFindings.filter(isStrictQaSecurityFinding);
const strictQaStandaloneOpenFindings = strictQaOpenFindings.filter((finding) => !isStrictQaFindingRepresentedByManualEvidence(finding));
const checklist = readIfExists(path.join('docs', 'launch', 'CHECKLIST.md'));
const openChecklistGoNoGo = sectionLines(checklist, '## Go/No-Go Blockers')
    .filter((line) => line.trim().startsWith('- [ ]'))
    .map((line) => line.trim());
const rcOperationalBlockers = collectOpenRcOperationalBlockers(checklist);
const openGoNoGo = uniqueList([
    ...openChecklistGoNoGo,
    ...rcOperationalBlockers.map((blocker) => blocker.line),
]);

const standaloneAuditDefinitions = [
    { commandName: 'pnpm launch:security', secondaryArea: 'security evidence', evidence: securityAudit },
    { commandName: 'pnpm launch:operations', secondaryArea: 'operations evidence', evidence: operationsAudit },
    { commandName: 'pnpm launch:accessibility', secondaryArea: 'accessibility evidence', evidence: accessibilityAudit },
    { commandName: 'pnpm launch:cleanup', secondaryArea: 'cleanup evidence', evidence: cleanupAudit },
    { commandName: 'pnpm launch:final-readiness', secondaryArea: 'final readiness evidence', evidence: finalReadinessAudit },
] as const;
const standalonePrimaryEvidence: StandalonePrimaryEvidence[] = standaloneAuditDefinitions.flatMap(({ commandName, evidence }) => evidence
    ? [{ commandName, file: evidence.file, data: evidence.data }]
    : []);
const standaloneSecondaryEvidence: StandaloneSecondaryEvidence[] = standaloneAuditDefinitions.flatMap(({ commandName, secondaryArea, evidence }) => evidence
    ? [{ commandName, secondaryArea, file: evidence.file, data: evidence.data }]
    : []);
const effectivePrimaryResults = primary
    ? applyFreshStandalonePrimaryEvidence(primary.data.results, primary.data.endedAt, standalonePrimaryEvidence)
    : [];
const effectivePrimary: PrimarySummary | null = primary
    ? {
        ...primary.data,
        status: summarizePrimaryResults(effectivePrimaryResults),
        results: effectivePrimaryResults,
    }
    : null;
const effectiveSecondary: SecondaryReviewSummary | null = secondary
    ? {
        ...secondary.data,
        findings: applyFreshStandaloneSecondaryEvidence(
            secondary.data.findings,
            secondary.data.endedAt,
            standaloneSecondaryEvidence,
        ),
    }
    : null;

const blockers = [
    ...collectBlockers(effectivePrimary, manual?.data ?? null, effectiveSecondary),
    ...strictQaStandaloneOpenFindings.map(strictQaFindingToBlocker),
];
const warnings = collectWarnings(effectivePrimary, manual?.data ?? null, effectiveSecondary);
const manualEvidenceByPhase = normalizeManualEvidenceByPhase(manual?.data ?? null);
const manualEvidencePhaseSummary = summarizeManualEvidenceByPhase(manualEvidenceByPhase);
const manualEvidenceCoverage = buildManualEvidenceCoverage(manual?.data ?? null);
const stagingNoRealPaymentsBlocked = hasFailedCheck(noRealPaymentsRemediation?.data ?? null, 'deployed_checkout_probe');
const urgencySummary = buildUrgencySummary(
    manualEvidencePhaseSummary,
    blockers,
    stagingNoRealPaymentsBlocked,
    strictQaOpenSecurityFindings
);
const status = deriveStatus(effectivePrimary, manual?.data ?? null, effectiveSecondary, blockers, openGoNoGo);
const releaseCandidateReadiness = buildReleaseCandidateReadiness(
    manualEvidencePhaseSummary,
    manualEvidenceByPhase,
    effectivePrimary,
    noRealPaymentsRemediation?.data ?? null,
    strictQaOpenSecurityFindings,
    strictQaStandaloneOpenFindings,
    rcOperationalBlockers.map((blocker) => blocker.id),
);
const gateFreshnessInputs: EvidenceTimestamp[] = [
    // Full-gate freshness is scoped to commands that `pnpm launch:gate`
    // owns as canonical blockers. RC refreshes also regenerate phase1/manual
    // support evidence; treating those as full-gate freshness inputs creates
    // a gate-vs-RC stale loop where neither dashboard source can converge.
    { label: 'primary verification', endedAt: primary?.data.endedAt },
    { label: 'secondary review', endedAt: secondary?.data.endedAt },
];
// Do not use the strict-QA tracker as a launch-gate freshness input.
// The tracker is a standalone blocking source in this status report; adding
// it here makes recording gate evidence in the canonical tracker stale the
// gate again, creating a freshness loop that cannot converge.
const releaseCandidateFreshnessInputs: EvidenceTimestamp[] = [
    // RC freshness is scoped to the commands run by `pnpm launch:rc`.
    // Primary verification is intentionally excluded to avoid a rerun ping-pong
    // between `launch:verify` and `launch:rc` while full `launch:gate` remains strict.
    { label: 'phase 1 gate', endedAt: phaseOne?.data.endedAt },
    { label: 'functional rc', endedAt: functionalRc?.data.endedAt },
    { label: 'manual evidence', endedAt: manual?.data.endedAt },
    { label: 'staging database rollout', endedAt: stagingDatabaseRollout?.data.endedAt },
    { label: 'operations external closure', endedAt: operationsExternalClosure?.data.endedAt },
    { label: 'payments audit', endedAt: payments?.data.endedAt },
    { label: 'no-real-payments audit', endedAt: noRealPayments?.data.endedAt },
    { label: 'staging no-real-payments remediation', endedAt: noRealPaymentsRemediation?.data.endedAt },
    { label: 'rc external closure', endedAt: rcExternalClosure?.data.endedAt },
];
const rcExternalClosureFreshnessInputs: EvidenceTimestamp[] = [
    { label: 'staging database rollout', endedAt: stagingDatabaseRollout?.data.endedAt },
    { label: 'operations external closure', endedAt: operationsExternalClosure?.data.endedAt },
    { label: 'staging no-real-payments remediation', endedAt: noRealPaymentsRemediation?.data.endedAt },
];
const sources: SourceRef[] = [
    {
        label: 'launch gate',
        status: summarizeGateSource(gate?.data ?? null, gateFreshnessInputs),
        path: gate?.file ?? null,
    },
    {
        label: 'release candidate gate',
        status: summarizeReleaseCandidateGateSource(
            releaseCandidateGate?.data ?? null,
            releaseCandidateFreshnessInputs,
            releaseCandidateReadiness
        ),
        path: releaseCandidateGate?.file ?? null,
    },
    {
        label: 'phase 1 gate',
        status: summarizePhaseOneSource(phaseOne?.data ?? null),
        path: phaseOne?.file ?? null,
    },
    {
        label: 'primary verification',
        status: effectivePrimary?.status ?? 'missing',
        path: primary?.file ?? null,
    },
    {
        label: 'security audit',
        status: securityAudit?.data.status ?? 'missing',
        path: securityAudit?.file ?? null,
    },
    {
        label: 'operations audit',
        status: operationsAudit?.data.status ?? 'missing',
        path: operationsAudit?.file ?? null,
    },
    {
        label: 'accessibility audit',
        status: accessibilityAudit?.data.status ?? 'missing',
        path: accessibilityAudit?.file ?? null,
    },
    {
        label: 'cleanup audit',
        status: cleanupAudit?.data.status ?? 'missing',
        path: cleanupAudit?.file ?? null,
    },
    {
        label: 'final readiness audit',
        status: finalReadinessAudit?.data.status ?? 'missing',
        path: finalReadinessAudit?.file ?? null,
    },
    {
        label: 'launch sequence',
        status: sequence?.data.status ?? 'missing',
        path: sequence?.file ?? null,
    },
    {
        label: 'legal audit',
        status: legal?.data.status ?? 'missing',
        path: legal?.file ?? null,
    },
    {
        label: 'legal final inputs package',
        status: legalFinalInputs?.data.status ?? 'missing',
        path: legalFinalInputs?.file ?? null,
    },
    {
        label: 'payments audit',
        status: payments?.data.status ?? 'missing',
        path: payments?.file ?? null,
    },
    {
        label: 'functional rc',
        status: functionalRc?.data.status ?? 'missing',
        path: functionalRc?.file ?? null,
    },
    {
        label: 'staging database rollout',
        status: stagingDatabaseRollout?.data.status ?? 'missing',
        path: stagingDatabaseRollout?.file ?? null,
    },
    {
        label: 'operations external closure',
        status: operationsExternalClosure?.data.status ?? 'missing',
        path: operationsExternalClosure?.file ?? null,
    },
    {
        label: 'operations external closure pack',
        status: operationsExternalClosure?.data.closurePackPath ? 'available' : 'missing',
        path: operationsExternalClosure?.data.closurePackPath ?? null,
    },
    {
        label: 'operations external evidence manifest',
        status: operationsExternalClosure?.data.evidenceManifestPath ? 'available' : 'missing',
        path: operationsExternalClosure?.data.evidenceManifestPath ?? null,
    },
    {
        label: 'no-real-payments audit',
        status: noRealPayments?.data.status ?? 'missing',
        path: noRealPayments?.file ?? null,
    },
    {
        label: 'staging no-real-payments remediation',
        status: summarizeNoRealPaymentsRemediation(noRealPaymentsRemediation?.data ?? null),
        path: noRealPaymentsRemediation?.file ?? null,
    },
    {
        label: 'staging no-real-payments build manifest',
        status: noRealPaymentsRemediation?.data.buildPackageManifestPath ? 'available' : 'missing',
        path: noRealPaymentsRemediation?.data.buildPackageManifestPath ?? null,
    },
    {
        label: 'rc external closure',
        status: summarizeRcExternalClosureSource(rcExternalClosure?.data ?? null, rcExternalClosureFreshnessInputs),
        path: rcExternalClosure?.file ?? null,
    },
    {
        label: 'rc external closure pack',
        status: rcExternalClosure?.data.closurePackPath ? 'available' : 'missing',
        path: rcExternalClosure?.data.closurePackPath ?? null,
    },
    {
        label: 'rc external next approval',
        status: rcExternalClosure?.data.nextApprovalPath ? 'available' : 'missing',
        path: rcExternalClosure?.data.nextApprovalPath ?? null,
    },
    {
        label: 'strict QA tracker',
        status: summarizeStrictQaTracker(strictQaTracker?.data ?? null, strictQaOpenFindings, strictQaOpenSecurityFindings),
        path: strictQaTracker?.file ?? null,
    },
    {
        label: 'live-domain read-only evidence',
        status: liveDomainReadonly?.data.status ?? 'missing',
        path: liveDomainReadonly?.file ?? null,
    },
    {
        label: 'seo audit',
        status: seoAudit?.data.status ?? 'missing',
        path: seoAudit?.file ?? null,
    },
    {
        label: 'seo llm final package',
        status: seoLlmFinalPackage?.data.status ?? 'missing',
        path: seoLlmFinalPackage?.file ?? null,
    },
    {
        label: 'integration final package',
        status: integrationFinalPackage?.data.status ?? 'missing',
        path: integrationFinalPackage?.file ?? null,
    },
    {
        label: 'stripe read-only evidence',
        status: stripeReadonlyEvidence?.data.status ?? 'missing',
        path: stripeReadonlyEvidence?.file ?? null,
    },
    {
        label: 'turnstile read-only evidence',
        status: turnstileReadonlyEvidence?.data.status ?? 'missing',
        path: turnstileReadonlyEvidence?.file ?? null,
    },
    {
        label: 'sentry read-only evidence',
        status: sentryReadonlyEvidence?.data.status ?? 'missing',
        path: sentryReadonlyEvidence?.file ?? null,
    },
    {
        label: 'google read-only evidence',
        status: googleReadonlyEvidence?.data.status ?? 'missing',
        path: googleReadonlyEvidence?.file ?? null,
    },
    {
        label: 'resend read-only evidence',
        status: resendReadonlyEvidence?.data.status ?? 'missing',
        path: resendReadonlyEvidence?.file ?? null,
    },
    {
        label: 'stripe webhook cutover pack',
        status: stripeWebhookCutoverPack?.data.status ?? 'missing',
        path: stripeWebhookCutoverPack?.file ?? null,
    },
    {
        label: 'stripe webhook cutover runner',
        status: stripeWebhookCutoverRunner?.data.status ?? 'missing',
        path: stripeWebhookCutoverRunner?.file ?? null,
    },
    {
        label: 'turnstile domain closure pack',
        status: turnstileDomainClosurePack?.data.status ?? 'missing',
        path: turnstileDomainClosurePack?.file ?? null,
    },
    {
        label: 'turnstile domain closure runner',
        status: turnstileDomainClosureRunner?.data.status ?? 'missing',
        path: turnstileDomainClosureRunner?.file ?? null,
    },
    {
        label: 'sentry triage pack',
        status: sentryTriagePack?.data.status ?? 'missing',
        path: sentryTriagePack?.file ?? null,
    },
    {
        label: 'sentry issue triage runner',
        status: sentryIssueTriageRunner?.data.status ?? 'missing',
        path: sentryIssueTriageRunner?.file ?? null,
    },
    {
        label: 'final smoke execution pack',
        status: finalSmokeExecutionPack?.data.status ?? 'missing',
        path: finalSmokeExecutionPack?.file ?? null,
    },
    {
        label: 'staging smoke rehearsal runner',
        status: summarizeStagingSmokeEvidence(stagingSmokeRehearsalRunner?.data ?? null),
        path: stagingSmokeRehearsalRunner?.file ?? null,
    },
    {
        label: 'staging smoke latest plan',
        status: summarizeStagingSmokeEvidence(stagingSmokeLatestPlan?.data ?? null),
        path: stagingSmokeLatestPlan?.file ?? null,
    },
    {
        label: 'final approval queue',
        status: finalApprovalQueue?.data.status ?? 'missing',
        path: finalApprovalQueue?.file ?? null,
    },
    {
        label: 'final approval next action',
        status: finalApprovalQueue?.data.nextActionPath ? 'available' : 'missing',
        path: finalApprovalQueue?.data.nextActionPath ?? null,
    },
    {
        label: 'final approval execution board',
        status: finalApprovalQueue?.data.executionBoardPath ? 'available' : 'missing',
        path: finalApprovalQueue?.data.executionBoardPath ?? null,
    },
    {
        label: 'cloudflare production runtime read-only evidence',
        status: cloudflareProductionRuntimeReadonly?.data.status ?? 'missing',
        path: cloudflareProductionRuntimeReadonly?.file ?? null,
    },
    {
        label: 'cloudflare production runtime cutover preflight',
        status: cloudflareProductionRuntimeCutoverPreflight?.data.status ?? 'missing',
        path: cloudflareProductionRuntimeCutoverPreflight?.file ?? null,
    },
    {
        label: 'cloudflare production runtime cutover',
        status: cloudflareProductionRuntimeCutover?.data.status ?? 'missing',
        path: cloudflareProductionRuntimeCutover?.file ?? null,
    },
    {
        label: 'cloudflare production Worker phase 1 runner',
        status: cloudflareProductionWorkerPhaseOne?.data.status ?? 'missing',
        path: cloudflareProductionWorkerPhaseOne?.file ?? null,
    },
    {
        label: 'cloudflare production Worker secrets runner',
        status: cloudflareProductionWorkerSecrets?.data.status ?? 'missing',
        path: cloudflareProductionWorkerSecrets?.file ?? null,
    },
    {
        label: 'cloudflare production Fulfillment secrets runner',
        status: cloudflareProductionFulfillmentSecrets?.data.status ?? 'missing',
        path: cloudflareProductionFulfillmentSecrets?.file ?? null,
    },
    {
        label: 'supabase processed_at read-only preflight',
        status: supabaseProcessedAtReadonlyPreflight ? 'available' : 'missing',
        path: supabaseProcessedAtReadonlyPreflight,
    },
    {
        label: 'supabase processed_at cleanup runner',
        status: supabaseProcessedAtCleanupRunner?.data.status ?? 'missing',
        path: supabaseProcessedAtCleanupRunner?.file ?? null,
    },
    {
        label: 'manual evidence',
        status: manual?.data.status ?? 'missing',
        path: manual?.file ?? null,
    },
    {
        label: 'manual evidence index',
        status: manual?.data.manualEvidenceIndexPath ? 'available' : 'missing',
        path: manual?.data.manualEvidenceIndexPath ?? null,
    },
    {
        label: 'manual evidence next actions',
        status: manual?.data.nextActionsPath ? 'available' : 'missing',
        path: manual?.data.nextActionsPath ?? null,
    },
    {
        label: 'phase 1 closure pack',
        status: manual?.data.phaseOneClosurePackPath ? 'available' : 'missing',
        path: manual?.data.phaseOneClosurePackPath ?? null,
    },
    {
        label: 'final closure runbook',
        status: existsSync(path.join('docs', 'launch', 'FINAL_CLOSURE.md')) ? 'available' : 'missing',
        path: existsSync(path.join('docs', 'launch', 'FINAL_CLOSURE.md')) ? path.resolve('docs', 'launch', 'FINAL_CLOSURE.md') : null,
    },
    {
        label: 'final closure pack',
        status: 'generated',
        path: finalClosurePackPath,
    },
    {
        label: 'secondary review',
        status: secondary?.data.status ?? 'missing',
        path: secondary?.file ?? null,
    },
    {
        label: 'launch checklist',
        status: existsSync(path.join('docs', 'launch', 'CHECKLIST.md')) ? `${openGoNoGo.length} open Go/No-Go` : 'missing',
        path: existsSync(path.join('docs', 'launch', 'CHECKLIST.md')) ? path.resolve('docs', 'launch', 'CHECKLIST.md') : null,
    },
];
const report: StatusReport = {
    schemaVersion: 1,
    startedAt: startedAt.toISOString(),
    endedAt: new Date().toISOString(),
    status,
    releaseCandidateReadiness,
    sources,
    currentEvidence: buildCurrentEvidence(sources),
    blockers,
    warnings,
    openGoNoGo,
    urgencySummary,
    phaseOneFocus: buildPhaseOneFocus(manualEvidenceByPhase, strictQaOpenSecurityFindings),
    manualEvidenceCoverage,
    manualEvidencePhaseSummary,
    manualEvidenceByPhase,
    nextActions: buildNextActions(
        blockers,
        openGoNoGo,
        gate?.data ?? null,
        manual?.data ?? null,
        isGateStale(gate?.data ?? null, gateFreshnessInputs),
        isReleaseCandidateGateActionablyStale(
            releaseCandidateGate?.data ?? null,
            releaseCandidateFreshnessInputs,
            releaseCandidateReadiness
        )
    ),
    outputDir,
    finalClosurePackPath,
};

writeFileSync(path.join(outputDir, 'summary.json'), JSON.stringify(report, null, 2), 'utf8');
writeFileSync(path.join(outputDir, 'summary.md'), renderMarkdown(report), 'utf8');
writeFileSync(finalClosurePackPath, renderFinalClosurePack(report), 'utf8');

console.log(`[launch:status] Status: ${report.status}`);
console.log(`[launch:status] Blockers: ${report.blockers.length}`);
console.log(`[launch:status] Warnings: ${report.warnings.length}`);
console.log(`[launch:status] Open Go/No-Go: ${report.openGoNoGo.length}`);
console.log(`[launch:status] Summary: ${path.join(outputDir, 'summary.md')}`);
console.log(`[launch:status] Final closure pack: ${finalClosurePackPath}`);

function collectBlockers(
    primarySummary: PrimarySummary | null,
    manualSummary: ManualEvidenceSummary | null,
    secondarySummary: SecondaryReviewSummary | null
): Finding[] {
    const findings: Finding[] = [];

    if (!primarySummary) {
        findings.push({ status: 'failed', area: 'primary verification', message: 'No primary launch verification evidence found.' });
    } else {
        findings.push(...primarySummary.results
            .filter((result) => result.status === 'failed')
            .map((result) => ({
                status: 'failed' as const,
                area: result.name ?? 'primary verification',
                message: result.message,
                details: result.details,
                evidence: result.evidence,
            })));
    }

    if (!manualSummary) {
        findings.push({ status: 'failed', area: 'manual evidence', message: 'No manual launch evidence audit found.' });
    } else {
        findings.push(...manualSummary.findings
            .filter((finding) => finding.status === 'failed')
            .map((finding) => ({
                status: 'failed' as const,
                area: finding.area ?? 'manual evidence',
                message: finding.message,
                details: finding.details,
                evidence: manualSummary.evidenceFile,
            })));
    }

    if (!secondarySummary) {
        findings.push({ status: 'failed', area: 'secondary review', message: 'No secondary launch review evidence found.' });
    } else {
        findings.push(...secondarySummary.findings
            .filter((finding) => finding.status === 'failed')
            .filter((finding) => !isSecondaryMetaFinding(finding, Boolean(primarySummary), Boolean(manualSummary)))
            .map((finding) => ({
                status: 'failed' as const,
                area: finding.area ?? 'secondary review',
                message: finding.message,
                details: finding.details,
            })));
    }

    return findings;
}

function isSecondaryMetaFinding(finding: Finding, hasPrimary: boolean, hasManual: boolean): boolean {
    const area = finding.area ?? '';
    if (area === 'go/no-go blockers') return true;
    if (hasPrimary && (area === 'primary evidence' || area === 'primary status' || area === 'primary warnings')) return true;
    if (hasManual && area === 'manual launch evidence') return true;
    return false;
}

function collectWarnings(
    primarySummary: PrimarySummary | null,
    manualSummary: ManualEvidenceSummary | null,
    secondarySummary: SecondaryReviewSummary | null
): Finding[] {
    return [
        ...(primarySummary?.results ?? []),
        ...(manualSummary?.findings ?? []),
        ...(secondarySummary?.findings ?? [])
            .filter((finding) => !isSecondaryMetaFinding(finding, Boolean(primarySummary), Boolean(manualSummary))),
    ].filter((finding) => finding.status === 'warning');
}

function normalizeManualEvidenceByPhase(manualSummary: ManualEvidenceSummary | null): Record<ManualEvidencePhase, PhaseManualCheck[]> {
    const source = manualSummary?.manualEvidenceByPhase;
    if (!source) return groupManualEvidenceByPhase(manualSummary);

    const grouped: Record<ManualEvidencePhase, PhaseManualCheck[]> = {
        phase_1_now: [],
        phase_2_release_candidate: [],
        phase_3_final: [],
        unknown: [],
    };

    let hasStructuredGroups = false;
    for (const phase of phaseOrder) {
        const checks = source[phase];
        if (!Array.isArray(checks)) continue;
        hasStructuredGroups = true;
        grouped[phase] = checks
            .filter((check) => check.status === 'failed' || check.status === 'warning')
            .map((check) => normalizePhaseManualCheck(check, phase));
    }

    if (!hasStructuredGroups) return groupManualEvidenceByPhase(manualSummary);

    for (const phase of phaseOrder) {
        grouped[phase].sort((a, b) => a.id.localeCompare(b.id));
    }

    return grouped;
}

function normalizePhaseManualCheck(check: PhaseManualCheck, fallbackPhase: ManualEvidencePhase): PhaseManualCheck {
    const mapped = manualEvidencePhaseMap[check.id] ?? { phase: fallbackPhase, label: phaseHeadings[fallbackPhase] };
    const phase = check.phase && phaseOrder.includes(check.phase) ? check.phase : mapped.phase;

    return {
        id: check.id,
        phase,
        label: check.label ?? mapped.label,
        heading: check.heading ?? phaseHeadings[phase],
        area: check.area,
        status: check.status,
        message: check.message,
        details: Array.isArray(check.details) ? check.details : [],
    };
}

function groupManualEvidenceByPhase(manualSummary: ManualEvidenceSummary | null): Record<ManualEvidencePhase, PhaseManualCheck[]> {
    const grouped: Record<ManualEvidencePhase, PhaseManualCheck[]> = {
        phase_1_now: [],
        phase_2_release_candidate: [],
        phase_3_final: [],
        unknown: [],
    };

    for (const finding of manualSummary?.findings ?? []) {
        if (finding.status !== 'failed' && finding.status !== 'warning') continue;

        const checkId = extractManualCheckId(finding);
        if (!checkId) continue;

        const mapped = manualEvidencePhaseMap[checkId] ?? { phase: 'unknown' as const, label: 'Sin fase mapeada' };
        grouped[mapped.phase].push({
            id: checkId,
            phase: mapped.phase,
            label: mapped.label,
            area: finding.area ?? 'manual evidence',
            status: finding.status,
            message: finding.message,
            details: finding.details ?? [],
        });
    }

    for (const phase of phaseOrder) {
        grouped[phase].sort((a, b) => a.id.localeCompare(b.id));
    }

    return grouped;
}

function summarizeManualEvidenceByPhase(
    grouped: Record<ManualEvidencePhase, PhaseManualCheck[]>
): ManualEvidencePhaseSummary[] {
    return phaseOrder.map((phase) => {
        const checks = grouped[phase];
        return {
            phase,
            heading: phaseHeadings[phase],
            category: phaseCategories[phase],
            openCount: checks.length,
            failedCount: checks.filter((check) => check.status === 'failed').length,
            warningCount: checks.filter((check) => check.status === 'warning').length,
            checkIds: checks.map((check) => check.id),
        };
    });
}

function buildManualEvidenceCoverage(manualSummary: ManualEvidenceSummary | null): ManualEvidenceCoverageItem[] {
    const findingsByCheckId = new Map<string, Finding>();

    for (const finding of manualSummary?.findings ?? []) {
        const checkId = extractManualCheckId(finding);
        if (checkId && !findingsByCheckId.has(checkId)) {
            findingsByCheckId.set(checkId, finding);
        }
    }

    return Object.entries(manualEvidencePhaseMap).map(([id, mapped]) => {
        const finding = findingsByCheckId.get(id);

        return {
            id,
            phase: mapped.phase,
            heading: phaseHeadings[mapped.phase],
            status: finding?.status ?? 'missing',
            area: finding?.area ?? 'manual evidence',
            message: finding?.message ?? 'Manual evidence check is missing from the latest manual evidence summary.',
        };
    });
}

function buildUrgencySummary(
    phaseSummary: ManualEvidencePhaseSummary[],
    failedFindings: Finding[],
    stagingNoRealPaymentsIsBlocked: boolean,
    strictQaOpenSecurityFindings: StrictQaFinding[]
): UrgencySummary[] {
    const byPhase = new Map(phaseSummary.map((summary) => [summary.phase, summary]));
    const legalAuditBlocked = failedFindings.some((finding) => {
        const haystack = `${finding.area ?? ''} ${finding.name ?? ''} ${finding.message}`;
        return /launch:legal|legal audit|pnpm launch:legal/i.test(haystack);
    });

    const phaseOneSummary = byPhase.get('phase_1_now');
    const enrichedPhaseOneSummary = strictQaOpenSecurityFindings.reduce(
        (summary, finding) => addComputedUrgencyCheck(
            summary,
            finding.errorId ?? 'strict_qa_security',
            'phase_1_now'
        ),
        phaseOneSummary
    );
    const releaseCandidateSummary = byPhase.get('phase_2_release_candidate');
    const enrichedReleaseCandidateSummary = stagingNoRealPaymentsIsBlocked
        ? addComputedUrgencyCheck(releaseCandidateSummary, 'no_real_payments_staging', 'phase_2_release_candidate')
        : releaseCandidateSummary;

    return [
        summarizeUrgencyBucket(
            'phase_1_now',
            'Ahora / Fase 1',
            enrichedPhaseOneSummary,
            'Cerrar antes de congelar release candidate: limpieza, contenido, accesibilidad, seguridad externa, operacion y base de datos.'
        ),
        summarizeUrgencyBucket(
            'phase_2_release_candidate',
            'Release Candidate / Fase 2',
            enrichedReleaseCandidateSummary,
            'Congelar RC cuando Fase 1 este cerrada y staging tenga checkout bloqueado; Stripe queda final-only mientras no se acepten pagos reales.'
        ),
        summarizeUrgencyBucket(
            'phase_3_final',
            'Cierre Final / Fase 3',
            byPhase.get('phase_3_final'),
            'Mantener abierto deliberadamente hasta datos legales reales, claves finales, integraciones live, fuente rusa premium, SEO/LLM y smoke de produccion.'
        ),
        {
            bucket: 'automatic_legal',
            heading: 'Bloqueo Automatico Legal',
            openCount: legalAuditBlocked ? 1 : 0,
            failedCount: legalAuditBlocked ? 1 : 0,
            warningCount: 0,
            checkIds: legalAuditBlocked ? ['pnpm launch:legal'] : [],
            decisionRule: 'No inventar datos: Alin completa titular/controlador y despues se rerun launch:legal.',
        },
    ];
}

function addComputedUrgencyCheck(
    summary: ManualEvidencePhaseSummary | undefined,
    checkId: string,
    fallbackPhase: ManualEvidencePhase
): ManualEvidencePhaseSummary {
    const base = summary ?? {
        phase: fallbackPhase,
        heading: phaseHeadings[fallbackPhase],
        category: phaseCategories[fallbackPhase],
        openCount: 0,
        failedCount: 0,
        warningCount: 0,
        checkIds: [],
    };

    if (base.checkIds.includes(checkId)) return base;

    return {
        ...base,
        openCount: base.openCount + 1,
        failedCount: base.failedCount + 1,
        checkIds: [...base.checkIds, checkId],
    };
}

function summarizeUrgencyBucket(
    bucket: ManualEvidencePhase,
    heading: string,
    phaseSummary: ManualEvidencePhaseSummary | undefined,
    decisionRule: string
): UrgencySummary {
    return {
        bucket,
        heading,
        openCount: phaseSummary?.openCount ?? 0,
        failedCount: phaseSummary?.failedCount ?? 0,
        warningCount: phaseSummary?.warningCount ?? 0,
        checkIds: phaseSummary?.checkIds ?? [],
        decisionRule,
    };
}

function buildPhaseOneFocus(
    grouped: Record<ManualEvidencePhase, PhaseManualCheck[]>,
    strictQaOpenSecurityFindings: StrictQaFinding[]
): PhaseOneFocusItem[] {
    const openById = new Map(grouped.phase_1_now.map((check) => [check.id, check]));
    const strictSecurityIds = strictQaOpenSecurityFindings
        .map((finding) => finding.errorId)
        .filter((errorId): errorId is string => Boolean(errorId));
    const strictSecurityNextStep = strictSecurityIds.length > 0
        ? `Strict QA tracker still has ${strictSecurityIds.join(', ')} open; do not treat RC security/database as clear until the generated Supabase security rollout is approved, applied staging-first and verified read-only, or an explicit accepted risk is recorded.`
        : null;

    return phaseOneFocusOrder.map((id) => {
        const openCheck = openById.get(id);
        const strictSecurityApplies = Boolean(strictSecurityNextStep)
            && (id === 'database_readiness' || id === 'security_external');
        const status = strictSecurityApplies ? 'failed' : openCheck?.status ?? 'clear';
        const details = phaseOneFocusDetails[id];
        return {
            id,
            status,
            ...details,
            nextStep: strictSecurityApplies
                ? strictSecurityNextStep ?? details.nextStep
                : status === 'clear' ? phaseOneClearNextStep(id) : details.nextStep,
        };
    });
}

function phaseOneClearNextStep(id: typeof phaseOneFocusOrder[number]): string {
    if (id === 'security_external') {
        return 'Sin accion ahora para RC; repetir solo si cambia el alcance o caduca, y mantener rotacion final/live-domain/deep permissions en final-only.';
    }

    return 'Sin accion ahora para RC; repetir solo si cambia el alcance, caduca la evidencia o se reabre el check.';
}

function buildReleaseCandidateReadiness(
    phaseSummary: ManualEvidencePhaseSummary[],
    grouped: Record<ManualEvidencePhase, PhaseManualCheck[]>,
    primarySummary: PrimarySummary | null,
    noRealPaymentsRemediationSummary: CheckBackedSummary | null,
    strictQaOpenSecurityFindings: StrictQaFinding[],
    strictQaStandaloneOpenFindings: StrictQaFinding[],
    rcOperationalOpenChecks: string[],
): ReleaseCandidateReadiness {
    const phaseOneOpenChecks = grouped.phase_1_now
        .filter((check) => check.status === 'failed')
        .map((check) => check.id);
    const strictQaSecurityIds = strictQaOpenSecurityFindings
        .map((finding) => finding.errorId)
        .filter((errorId): errorId is string => Boolean(errorId));
    const strictQaStandaloneIds = strictQaStandaloneOpenFindings
        .map((finding) => finding.errorId)
        .filter((errorId): errorId is string => Boolean(errorId));
    const enrichedPhaseOneOpenChecks = uniqueList([...phaseOneOpenChecks, ...strictQaSecurityIds]);
    const stagingNoRealPaymentsBlocked = hasFailedCheck(noRealPaymentsRemediationSummary, 'deployed_checkout_probe');
    const releaseCandidateOpenChecks = [
        ...grouped.phase_2_release_candidate
        .filter((check) => check.status === 'failed')
            .map((check) => check.id),
        ...(stagingNoRealPaymentsBlocked ? ['no_real_payments_staging'] : []),
        ...rcOperationalOpenChecks,
    ];
    const finalOnlyOpenChecks = grouped.phase_3_final.map((check) => check.id);
    const finalLaunchOpenChecks = uniqueList([...finalOnlyOpenChecks, ...strictQaStandaloneIds]);
    const acceptedRiskChecks = phaseOrder
        .flatMap((phase) => grouped[phase])
        .filter((check) => check.status === 'warning')
        .map((check) => check.id);
    const noEvidence = !primarySummary && phaseSummary.every((phase) => phase.openCount === 0);
    const automatedVerifierStatus = primarySummary?.status ?? 'missing';
    const provenNow = [
        'Demo/dev/test quedan fuera del runtime normal cuando la bandera esta apagada.',
        stagingNoRealPaymentsBlocked
            ? 'El codigo local de no-cobros esta cubierto, pero staging desplegado aun devuelve 400 en /api/create-checkout; no se puede congelar RC sin bloquear checkout en Cloudflare Worker staging.'
            : 'El modo sin cobros reales tiene salvaguardas locales y no hay fallo desplegado vigente en el paquete de remediacion.',
        phaseOneOpenChecks.includes('operations_external')
            ? 'La arquitectura del Cloudflare Fulfillment Worker, health checks y rutas internas esta cubierta por auditoria automatica; la verificacion externa fresca sigue en operations_external.'
            : 'Cloudflare Fulfillment Worker staging esta desplegado y verificado en health/auth/configuracion.',
        phaseOneOpenChecks.includes('database_readiness') || strictQaSecurityIds.length > 0
            ? `Supabase staging y production estan identificados como proyectos separados; ${strictQaSecurityIds.length > 0 ? `el tracker estricto mantiene ${strictQaSecurityIds.join(', ')} abiertos hasta aplicar/verificar el rollout de seguridad` : 'database_readiness sigue abierto hasta resolver o verificar migraciones/RLS/backup posture'} con staging primero.`
            : 'Supabase staging y production son proyectos separados con RLS y migraciones criticas revisadas.',
        'Launch Gate, Fase 1, evidencia manual y revision secundaria generan evidencias frescas y auditables.',
    ];

    if (noEvidence) {
        return {
            status: 'NO_EVIDENCE',
            reason: 'No hay evidencia suficiente para evaluar el Release Candidate.',
            phaseOneOpenChecks: enrichedPhaseOneOpenChecks,
            releaseCandidateOpenChecks,
            finalOnlyOpenChecks,
            strictQaOpenChecks: strictQaStandaloneIds,
            acceptedRiskChecks,
            provenNow: [],
            nextDecision: 'Ejecutar pnpm launch:gate para generar evidencia primaria, manual, Fase 1 y secundaria.',
        };
    }

    if (enrichedPhaseOneOpenChecks.length > 0) {
        return {
            status: 'RC_BLOCKED_BY_PHASE_1',
            reason: `Fase 1 sigue abierta (${enrichedPhaseOneOpenChecks.join(', ')}). El RC no se debe congelar hasta cerrar esos checks como pass.`,
            phaseOneOpenChecks: enrichedPhaseOneOpenChecks,
            releaseCandidateOpenChecks,
            finalOnlyOpenChecks,
            strictQaOpenChecks: strictQaStandaloneIds,
            acceptedRiskChecks,
            provenNow,
            nextDecision: `${buildPhaseOneNextDecision(enrichedPhaseOneOpenChecks)} Usar pnpm launch:rc-external-closure como hoja unica de cierres externos RC.${releaseCandidateOpenChecks.includes('no_real_payments_staging') ? ' Para Cloudflare Worker staging, revisar tambien el ultimo rc-staging-package.md, rc-staging-package-files.txt, rc-staging-runtime-diff.patch, rc-staging-runtime-manifest.json y worker-staging-build-manifest.json antes de confiar en CHECKOUT_ENABLED=false.' : ''}`,
        };
    }

    if (releaseCandidateOpenChecks.length > 0) {
        return {
            status: 'RC_BLOCKED_BY_RELEASE_CANDIDATE_CHECKS',
            reason: `Fase 1 esta limpia, pero aun falta evidencia propia de RC (${releaseCandidateOpenChecks.join(', ')}).`,
            phaseOneOpenChecks: enrichedPhaseOneOpenChecks,
            releaseCandidateOpenChecks,
            finalOnlyOpenChecks,
            strictQaOpenChecks: strictQaStandaloneIds,
            acceptedRiskChecks,
            provenNow,
            nextDecision: releaseCandidateOpenChecks.includes('no_real_payments_staging')
                ? 'Corregir Cloudflare Worker staging desde el pack de pnpm launch:rc-external-closure y los ultimos rc-staging-package.md/rc-staging-package-files.txt/rc-staging-runtime-diff.patch/rc-staging-runtime-manifest.json/worker-staging-build-manifest.json: si HEAD/deploy no contiene el guard, empaquetar/redeployar la slice minima antes de confiar en CHECKOUT_ENABLED=false; si se usa dist local, exigir readyForStagingDeployPackage=true; despues ejecutar pnpm launch:no-real-payments -- --deployed-url <staging-url> y pnpm launch:rc.'
                : rcOperationalOpenChecks.length > 0
                    ? `Cerrar los bloqueos operativos RC (${rcOperationalOpenChecks.join(', ')}) con evidencia no secreta o una aceptacion de riesgo explicita; despues rerun pnpm launch:operations, pnpm launch:status y pnpm launch:rc.`
                    : 'Cerrar Stripe staging o documentar que el RC se congela sin aceptar pagos.',
        };
    }

    if (finalLaunchOpenChecks.length > 0 || automatedVerifierStatus === 'BLOCKED') {
        return {
            status: 'RC_READY_WITH_FINAL_BLOCKERS',
            reason: `El RC puede congelarse tecnicamente, pero el lanzamiento sigue bloqueado por cierre final (${finalLaunchOpenChecks.join(', ') || 'automatic legal gate'}).`,
            phaseOneOpenChecks: enrichedPhaseOneOpenChecks,
            releaseCandidateOpenChecks,
            finalOnlyOpenChecks,
            strictQaOpenChecks: strictQaStandaloneIds,
            acceptedRiskChecks,
            provenNow,
            nextDecision: 'Completar legal real, integraciones finales, strict-QA tracker blockers, backup final si aplica, fuente rusa premium, SEO/LLM, smoke final y rerun del Launch Gate antes de Go/No-Go.',
        };
    }

    if (acceptedRiskChecks.length > 0) {
        return {
            status: 'RC_READY_WITH_ACCEPTED_RISKS',
            reason: `No quedan bloqueos de Fase 1 o RC, pero hay riesgos aceptados documentados (${acceptedRiskChecks.join(', ')}).`,
            phaseOneOpenChecks: enrichedPhaseOneOpenChecks,
            releaseCandidateOpenChecks,
            finalOnlyOpenChecks,
            strictQaOpenChecks: strictQaStandaloneIds,
            acceptedRiskChecks,
            provenNow,
            nextDecision: 'Revisar los riesgos aceptados y ejecutar pnpm launch:gate inmediatamente antes de la decision final.',
        };
    }

    return {
        status: 'RC_READY_FOR_GO_NO_GO',
        reason: 'No quedan checks manuales abiertos por fase; queda ejecutar Go/No-Go final con evidencia fresca.',
        phaseOneOpenChecks: enrichedPhaseOneOpenChecks,
        releaseCandidateOpenChecks,
        finalOnlyOpenChecks,
        strictQaOpenChecks: strictQaStandaloneIds,
        acceptedRiskChecks,
        provenNow,
        nextDecision: 'Ejecutar pnpm launch:gate inmediatamente antes de la decision final.',
    };
}

function buildPhaseOneNextDecision(phaseOneOpenChecks: string[]): string {
    const openChecks = renderListValue(phaseOneOpenChecks);
    return `Cerrar los checks abiertos de Fase 1 (${openChecks}) con evidencia real/no secreta; mantener Stripe/payments, production Worker, backup final, fuente rusa premium, rotacion final, SEO/LLM y smoke final como final-only.`;
}

function buildCurrentEvidence(sourceRefs: SourceRef[]): CurrentEvidence[] {
    const rows = [
        {
            sourceLabel: 'primary verification',
            label: 'Primary Verification',
            role: 'Automated launch verifier with newer standalone security, operations, accessibility, cleanup and final-readiness audits applied to matching command results only.',
        },
        {
            sourceLabel: 'security audit',
            label: 'Security Audit',
            role: 'Latest standalone launch:security evidence; supersedes only an older matching primary-verification command result.',
        },
        {
            sourceLabel: 'operations audit',
            label: 'Operations Audit',
            role: 'Latest standalone launch:operations evidence; supersedes only an older matching primary-verification command result.',
        },
        {
            sourceLabel: 'accessibility audit',
            label: 'Accessibility Audit',
            role: 'Latest standalone launch:accessibility evidence; manual accessibility evidence remains separately required.',
        },
        {
            sourceLabel: 'cleanup audit',
            label: 'Cleanup Audit',
            role: 'Latest standalone launch:cleanup evidence; the human keep/move/delete decision remains separately required.',
        },
        {
            sourceLabel: 'final readiness audit',
            label: 'Final Readiness Audit',
            role: 'Latest standalone automated integration/smoke-hook audit; deliberate legal, provider and final-smoke evidence remains separately required.',
        },
        {
            sourceLabel: 'phase 1 gate',
            label: 'Phase 1 Readiness',
            role: 'Current immediate-work gate for cleanup, content, accessibility, database, operations and security evidence.',
        },
        {
            sourceLabel: 'manual evidence',
            label: 'Manual Evidence Audit',
            role: 'Current audit of human/external evidence stored in the ignored local evidence file.',
        },
        {
            sourceLabel: 'secondary review',
            label: 'Secondary Review',
            role: 'Current independent review result over primary evidence, checklist and manual evidence.',
        },
        {
            sourceLabel: 'legal audit',
            label: 'Legal Audit',
            role: 'Current automatic legal placeholder/subprocessor/cookies audit; real values remain human-owned.',
        },
        {
            sourceLabel: 'legal final inputs package',
            label: 'Legal Final Inputs Package',
            role: 'Local final-only package listing owner/controller placeholders, legal input docs, dry-run manual evidence and human review evidence shape without inventing legal values.',
        },
        {
            sourceLabel: 'payments audit',
            label: 'Payments Audit',
            role: 'Static payment audit covering checkout, webhooks, portal, package catalog and no-real-payments safeguards.',
        },
        {
            sourceLabel: 'functional rc',
            label: 'Functional RC',
            role: 'Local mocked functional proof for commercial intake, CRM, transactional email, level check, onboarding, scheduling, no-real-payments safety and support recovery.',
        },
        {
            sourceLabel: 'staging database rollout',
            label: 'Staging Database Rollout',
            role: 'Local rollout pack for applying/verifying missing Supabase staging migrations before closing database_readiness.',
        },
        {
            sourceLabel: 'operations external closure',
            label: 'Operations External Closure',
            role: 'Local/read-only closure pack for operations_external; proves support audits and lists remaining manual Cloudflare Logs/observability, Resend staging and Admin Jobs runtime evidence.',
        },
        {
            sourceLabel: 'operations external evidence manifest',
            label: 'Operations External Evidence Manifest',
            role: 'Structured manifest of read-only operations targets, support evidence, side-effect approval gates and forbidden scope before closing operations_external.',
        },
        {
            sourceLabel: 'strict QA tracker',
            label: 'Strict QA Tracker',
            role: 'Canonical feature, finding, fix and retest tracker; open strict-QA findings block final launch, and open SEC-* findings block Phase 1 and RC readiness.',
        },
        {
            sourceLabel: 'live-domain read-only evidence',
            label: 'Live Domain Read-Only Evidence',
            role: 'Public GET-only proof of whether espanolhonesto.com/www serve the modern launch surface, including robots, sitemap, llms.txt, key routes, metadata and mojibake checks.',
        },
        {
            sourceLabel: 'seo audit',
            label: 'SEO/LLM Local Audit',
            role: 'Local static SEO/LLM proof for crawlability, metadata, structured data, segment answer blocks, llms.txt source and marketing-plan parity.',
        },
        {
            sourceLabel: 'seo llm final package',
            label: 'SEO/LLM Final Package',
            role: 'Local closure package for final search/assistant review, domain parity gaps, Search Console/CWV notes, snippets, llms.txt and Russian typography decision.',
        },
        {
            sourceLabel: 'integration final package',
            label: 'Integration Final Package',
            role: 'Local service matrix for Stripe, Cloudflare runtime/domain, Supabase, Google, Resend, Turnstile, Sentry and final provider evidence.',
        },
        {
            sourceLabel: 'stripe read-only evidence',
            label: 'Stripe Read-Only Evidence',
            role: 'Read-only Stripe test-mode account, webhook host and Supabase package/price-link evidence; does not create sessions, prices, products or webhook endpoints.',
        },
        {
            sourceLabel: 'turnstile read-only evidence',
            label: 'Turnstile Read-Only Evidence',
            role: 'Read-only/fake-token Turnstile reachability and domain-shape evidence; rejects an invalid token and does not change Cloudflare widgets.',
        },
        {
            sourceLabel: 'sentry read-only evidence',
            label: 'Sentry Read-Only Evidence',
            role: 'Read-only Sentry project reachability and aggregate unresolved-issue evidence; does not resolve, delete or mutate issues.',
        },
        {
            sourceLabel: 'google read-only evidence',
            label: 'Google Workspace Read-Only Evidence',
            role: 'Read-only Google Workspace DWD, Drive root/template, Docs API and Calendar/FreeBusy metadata evidence; does not create folders, documents, events or invitations.',
        },
        {
            sourceLabel: 'resend read-only evidence',
            label: 'Resend Read-Only Evidence',
            role: 'Read-only Resend domain/log/email aggregate metadata evidence; does not send emails or store message bodies/recipients.',
        },
        {
            sourceLabel: 'stripe webhook cutover pack',
            label: 'Stripe Webhook Cutover Pack',
            role: 'Local approval, verification and rollback package for moving the enabled Stripe test-mode webhook to a launch host; does not change Stripe.',
        },
        {
            sourceLabel: 'stripe webhook cutover runner',
            label: 'Stripe Webhook Cutover Runner',
            role: 'Plan-only and exact-gated runner for the future Stripe test-mode webhook URL update; plan mode does not call Stripe and approved mode is URL-only.',
        },
        {
            sourceLabel: 'turnstile domain closure pack',
            label: 'Turnstile Domain Closure Pack',
            role: 'Local approval, dashboard evidence and rollback package for Turnstile widget/domain closure; does not change Cloudflare.',
        },
        {
            sourceLabel: 'turnstile domain closure runner',
            label: 'Turnstile Domain Closure Runner',
            role: 'Plan-only and exact-gated runner for a future Cloudflare Turnstile widget domain-list update; plan mode does not call Cloudflare and approved mode is domains-only.',
        },
        {
            sourceLabel: 'sentry triage pack',
            label: 'Sentry Triage Pack',
            role: 'Local triage, alert ownership and accepted-risk package for unresolved Sentry issues; does not change Sentry.',
        },
        {
            sourceLabel: 'sentry issue triage runner',
            label: 'Sentry Issue Triage Runner',
            role: 'Plan-only and exact-gated runner for future Sentry issue status changes; plan mode does not call Sentry and approved mode is issue-status-only for listed short IDs.',
        },
        {
            sourceLabel: 'final smoke execution pack',
            label: 'Final Smoke Execution Pack',
            role: 'Approval, preflight, rollback and redacted-evidence package for the future write-capable production lifecycle smoke.',
        },
        {
            sourceLabel: 'staging smoke rehearsal runner',
            label: 'Staging Smoke Executed Success',
            role: 'Latest successful exact-gated staging lifecycle execution when one exists; a newer plan-only run cannot hide this evidence.',
        },
        {
            sourceLabel: 'staging smoke latest plan',
            label: 'Staging Smoke Latest Plan',
            role: 'Latest local-only staging rehearsal plan, retained separately from successful executed evidence.',
        },
        {
            sourceLabel: 'final approval queue',
            label: 'Final Approval Queue',
            role: 'Single local navigation queue for final approvals, human final inputs, exact approval requests, rollback paths and support evidence; does not authorize or perform writes.',
        },
        {
            sourceLabel: 'final approval next action',
            label: 'Final Approval Next Action Cursor',
            role: 'Small local cursor showing the first human-only, Strict-QA and Cloudflare actions plus actions that must wait; does not authorize writes.',
        },
        {
            sourceLabel: 'final approval execution board',
            label: 'Final Window Execution Board',
            role: 'Operator board splitting safe local checks, read-only refreshes, exact-approval writes and must-wait final actions; does not authorize writes.',
        },
        {
            sourceLabel: 'cloudflare production runtime read-only evidence',
            label: 'Cloudflare Production Runtime Read-Only Evidence',
            role: 'Wrangler read-only snapshot of target account, Pages project/domain ownership, staging Worker, production Worker and secret-name posture; does not deploy, move domains or write secrets.',
        },
        {
            sourceLabel: 'cloudflare production runtime cutover preflight',
            label: 'Cloudflare Production Runtime Cutover Preflight',
            role: 'Commandized no-write Cloudflare preflight that runs local build, guarded Wrangler production deploy dry-run, secret-name list probes, variable matrix and generated dist cleanup before any production Worker approval.',
        },
        {
            sourceLabel: 'cloudflare production runtime cutover',
            label: 'Cloudflare Production Runtime Cutover',
            role: 'Local approval and rollback package that keeps production Worker existence, Worker secret setup, direct Worker verification and the later espanolhonesto.com/www domain move as separate phases.',
        },
        {
            sourceLabel: 'cloudflare production Worker phase 1 runner',
            label: 'Cloudflare Production Worker Phase 1 Runner',
            role: 'Plan-only and exact-gated runner for the future production Worker create/deploy phase; plan mode does not call Cloudflare and approved mode forbids domain moves, DNS changes, Pages deletion and secret loading.',
        },
        {
            sourceLabel: 'cloudflare production Worker secrets runner',
            label: 'Cloudflare Production Worker Secrets Runner',
            role: 'Plan-only and exact-gated web Worker secret-name runner; approved mode requires account/ref/live-mode/site/env/direct-URL validation plus identity/version/Supabase attestation.',
        },
        {
            sourceLabel: 'cloudflare production Fulfillment secrets runner',
            label: 'Cloudflare Production Fulfillment Secrets Runner',
            role: 'Separate plan-only route for Fulfillment production Supabase/Google/Resend/email config and secret names; approved mode attests identity/version/Supabase without sending email or processing jobs.',
        },
        {
            sourceLabel: 'supabase processed_at read-only preflight',
            label: 'Supabase Processed At Read-Only Preflight',
            role: 'Executed read-only staging/production metadata and aggregate evidence for the remaining processed_at default drift; does not apply migrations or read private row payloads.',
        },
        {
            sourceLabel: 'no-real-payments audit',
            label: 'No-Real-Payments Audit',
            role: 'Current local proof that public CTAs are application-first and checkout fails closed by default.',
        },
        {
            sourceLabel: 'staging no-real-payments remediation',
            label: 'Staging No-Real-Payments Remediation',
            role: 'Read-only proof of whether Cloudflare Worker staging blocks checkout before Stripe/Supabase.',
        },
        {
            sourceLabel: 'staging no-real-payments build manifest',
            label: 'Staging No-Real-Payments Build Manifest',
            role: 'Structured manifest proving the local Worker build output contains the checkout-disabled guard before using it as staging deploy source.',
        },
        {
            sourceLabel: 'rc external closure',
            label: 'RC External Closure',
            role: 'Single local control sheet for the remaining staging-only Cloudflare, Supabase and operations evidence needed before RC freeze.',
        },
        {
            sourceLabel: 'rc external next approval',
            label: 'RC External Next Approval',
            role: 'One-resource approval prompt for the next recommended staging-only external action.',
        },
        {
            sourceLabel: 'release candidate gate',
            label: 'Release Candidate Gate',
            role: 'Latest RC-only gate; can pass with final-only blockers but must fail while Phase 1 or RC checks remain open.',
        },
        {
            sourceLabel: 'launch gate',
            label: 'Full Launch Gate',
            role: 'Latest canonical full gate run when available; blocked while any required step remains blocked.',
        },
        {
            sourceLabel: 'final closure pack',
            label: 'Final Closure Pack',
            role: 'Generated per status run; translates final-only blockers and open strict-QA blockers into ordered closure steps and evidence targets.',
        },
    ];

    return rows.map((row) => {
        const source = sourceRefs.find((item) => item.label === row.sourceLabel);
        return {
            label: row.label,
            status: source?.status ?? 'missing',
            path: toSummaryMarkdownPath(source?.path ?? null),
            role: row.role,
        };
    });
}

function extractManualCheckId(finding: Finding): string | null {
    const haystack = [
        finding.message,
        ...(finding.details ?? []),
    ].join(' ');

    for (const id of Object.keys(manualEvidencePhaseMap)) {
        if (haystack.includes(id)) return id;
    }

    return null;
}

function deriveStatus(
    primarySummary: PrimarySummary | null,
    manualSummary: ManualEvidenceSummary | null,
    secondarySummary: SecondaryReviewSummary | null,
    failedFindings: Finding[],
    openBlockers: string[]
): LaunchStatus {
    if (!primarySummary && !manualSummary && !secondarySummary) return 'NO_EVIDENCE';
    if (failedFindings.length > 0 || openBlockers.length > 0) return 'BLOCKED';
    if (manualSummary?.status === 'WARNING' || (secondarySummary?.status ?? '').includes('ACCEPTED_RISKS')) {
        return 'READY_WITH_ACCEPTED_RISKS';
    }
    return 'READY_CANDIDATE';
}

function buildNextActions(
    failedFindings: Finding[],
    openBlockers: string[],
    gateSummary: GateSummary | null,
    manualSummary: ManualEvidenceSummary | null,
    gateIsStale: boolean,
    releaseCandidateGateIsStale: boolean
): string[] {
    const actions = new Set<string>();

    if (!gateSummary) {
        actions.add('Run pnpm launch:gate so the dashboard includes a canonical full-gate evidence run.');
    } else if (gateIsStale) {
        actions.add('Do not rerun pnpm launch:gate only to clear stale status while final-only blockers remain; rerun pnpm launch:gate before Go/No-Go or after closing final evidence because newer primary/manual/secondary evidence exists than the latest full-gate run.');
    }
    if (releaseCandidateGateIsStale) {
        actions.add('Do not rerun pnpm launch:rc only to clear stale RC status while Phase 1 and RC checks are clear; rerun pnpm launch:rc only before re-freezing RC or after Phase 1, payments or manual evidence changes that should become the new RC baseline.');
    }
    if (rcExternalClosure?.data.closurePackPath && rcExternalClosure.data.status !== 'OK') {
        actions.add(`Use ${toRelative(rcExternalClosure.data.closurePackPath)} as the single RC external closure sheet for Cloudflare checkout blocking, Supabase staging rollout and operations evidence.`);
    }
    if (rcExternalClosure?.data.nextApprovalPath && rcExternalClosure.data.status !== 'OK') {
        actions.add(`Use ${toRelative(rcExternalClosure.data.nextApprovalPath)} for the next single-resource external approval; it currently narrows the RC closure to the first failed/warning action instead of approving every scope at once.`);
    }
    if (failedFindings.some((finding) => (finding.area ?? '').includes('manual') || finding.evidence?.includes('MANUAL_EVIDENCE'))) {
        actions.add('Update docs/launch/MANUAL_EVIDENCE.local.json only when you have real final evidence or an explicit accepted risk; do not fill it just to clear deliberate final-only blockers. Then rerun pnpm launch:manual-evidence.');
        if (manualSummary?.manualEvidenceIndexPath) {
            actions.add(`Use ${toRelative(manualSummary.manualEvidenceIndexPath)} as the generated map of check -> phase -> command -> worksheet -> evidence minimum.`);
        }
        if (manualSummary?.nextActionsPath) {
            actions.add(`Use ${toRelative(manualSummary.nextActionsPath)} for the generated per-check manual evidence action plan.`);
        }
        if (manualSummary?.phaseOneClosurePackPath && phaseOne?.data?.status === 'BLOCKED') {
            actions.add(`Use ${toRelative(manualSummary.phaseOneClosurePackPath)} to close Phase 1 blockers with safe JSON snippets and verification commands.`);
        }
    }
    if (openBlockers.some((line) => /legal_owner_controller|legal_human_review|payments_staging|integration_readiness|seo_llm_final|final_smoke|Cierre Final|final-only/i.test(line))) {
        actions.add('Use docs/launch/FINAL_CLOSURE.md as the ordered final Go/No-Go runbook before changing legal, Stripe, premium Russian font, keys, production integrations, SEO/LLM or final smoke evidence.');
    }
    if (phaseOne?.data?.status === 'BLOCKED') {
        actions.add('Run pnpm launch:phase1 after updating Phase 1 evidence to confirm immediate cleanup/content/accessibility/database/operations/security work.');
    }
    if (openBlockers.some((line) => line.includes('.agent') || line.includes('.agents'))) {
        actions.add('Decide whether .agent/ and .agents/ stay versioned or move outside the repo, then record the decision.');
    }
    if (openBlockers.some((line) => /Cloudflare fulfillment Worker|Google|Resend|cron|rollback/i.test(line))) {
        actions.add('Verify RC operations baseline: Cloudflare fulfillment Worker staging, fulfillment jobs, Resend staging, Workers Logs/observability visibility, Supabase Free backup posture and rollback.');
    }
    if (openBlockers.some((line) => /Accesibilidad/i.test(line))) {
        actions.add('Perform manual accessibility pass for keyboard, focus, screen reader, zoom, mobile and critical forms.');
    }
    if (openBlockers.some((line) => /Contenido|Copy/i.test(line))) {
        actions.add('If public copy, prices, emails, empty states or error states changed after RC, re-review ES/EN/RU and update the relevant content/SEO evidence.');
    }
    if (openBlockers.some((line) => /Database|Supabase|RLS|backups|admin_audit_log|fulfillment_jobs/i.test(line))) {
        actions.add('Verify database readiness: staging/production separation, staging assignments/subscriptions, hosted migrations, RLS, Supabase Free backup posture and audit/job tables, with staging before production.');
    }
    if (openBlockers.some((line) => /Stripe|Pagos|staging/i.test(line))) {
        actions.add('Keep Stripe/payment smoke final-only unless checkout is enabled; before real payments, document checkout, webhook delivery, subscription/payment, portal and reconciliation.');
    }
    if (actions.size === 0 && failedFindings.length === 0 && openBlockers.length === 0) {
        actions.add('Run pnpm launch:verify, pnpm launch:manual-evidence and pnpm launch:secondary-review immediately before Go/No-Go.');
    }
    if (failedFindings.some((finding) => (finding.area ?? '').includes('legal') || finding.message.toLowerCase().includes('legal'))) {
        actions.add('Complete real legal owner/controller data and legal review during final closure; do not invent values.');
    }
    if (openBlockers.some((line) => /Integraciones|integration|Smoke Final|smoke final|Stripe live/i.test(line))) {
        actions.add('Keep final-only integration and production smoke checks open until API keys, legal data and Stripe/live-mode decisions are final.');
    }
    if (openBlockers.some((line) => /SEO|LLM|buscadores/i.test(line))) {
        actions.add('Keep SEO/LLM readiness as final-only: rerun the live-domain read-only probe and verify sitemap, robots, structured data/search snippets and AI-facing content after final copy and legal pages settle.');
        actions.add('Keep premium Russian typography final-only: buy/license the official Cyrillic-capable family or explicitly accept the current fallback before closing seo_llm_final/final_smoke.');
    }

    return Array.from(actions);
}

function summarizeGateSource(gateSummary: GateSummary | null, latestEvidence: EvidenceTimestamp[] = []): string {
    if (!gateSummary) return 'missing';

    const failedSteps = gateSummary.steps.filter((step) => step.status === 'failed');
    const baseStatus = failedSteps.length === 0
        ? gateSummary.status
        : `${gateSummary.status} (${failedSteps.length} failed steps)`;
    const newerEvidence = newerEvidenceAfterSummary(gateSummary, latestEvidence);

    return newerEvidence.length === 0
        ? baseStatus
        : `STALE: ${baseStatus}; newer evidence: ${newerEvidence.join(', ')}`;
}

function summarizeReleaseCandidateGateSource(
    releaseCandidateSummary: ReleaseCandidateGateSummary | null,
    latestEvidence: EvidenceTimestamp[] = [],
    readiness: ReleaseCandidateReadiness | null = null
): string {
    if (!releaseCandidateSummary) return 'missing';

    const newerEvidence = newerEvidenceAfterSummary(releaseCandidateSummary, latestEvidence);

    if (newerEvidence.length === 0) return releaseCandidateSummary.status;

    return isReleaseCandidateCurrentForScope(readiness)
        ? `CURRENT_FOR_RC_SCOPE: ${releaseCandidateSummary.status}; newer final-only evidence: ${newerEvidence.join(', ')}`
        : `STALE: ${releaseCandidateSummary.status}; newer evidence: ${newerEvidence.join(', ')}`;
}

function summarizeRcExternalClosureSource(
    rcExternalClosureSummary: CheckBackedSummary | null,
    latestEvidence: EvidenceTimestamp[] = []
): string {
    if (!rcExternalClosureSummary) return 'missing';

    const newerEvidence = newerEvidenceAfterSummary(rcExternalClosureSummary, latestEvidence);

    return newerEvidence.length === 0
        ? rcExternalClosureSummary.status
        : `STALE: ${rcExternalClosureSummary.status}; newer evidence: ${newerEvidence.join(', ')}`;
}

function isGateStale(gateSummary: GateSummary | null, latestEvidence: EvidenceTimestamp[]): boolean {
    return isSummaryStale(gateSummary, latestEvidence);
}

function isReleaseCandidateGateActionablyStale(
    releaseCandidateSummary: ReleaseCandidateGateSummary | null,
    latestEvidence: EvidenceTimestamp[],
    readiness: ReleaseCandidateReadiness | null
): boolean {
    return isSummaryStale(releaseCandidateSummary, latestEvidence)
        && !isReleaseCandidateCurrentForScope(readiness);
}

function isSummaryStale(summary: TimedEvidenceSummary | null, latestEvidence: EvidenceTimestamp[]): boolean {
    return newerEvidenceAfterSummary(summary, latestEvidence).length > 0;
}

function isReleaseCandidateCurrentForScope(readiness: ReleaseCandidateReadiness | null): boolean {
    return readiness?.status === 'RC_READY_WITH_FINAL_BLOCKERS'
        && readiness.phaseOneOpenChecks.length === 0
        && readiness.releaseCandidateOpenChecks.length === 0;
}

function newerEvidenceAfterSummary(summary: TimedEvidenceSummary | null, latestEvidence: EvidenceTimestamp[]): string[] {
    if (!summary?.endedAt) return [];

    const summaryEndedAt = Date.parse(summary.endedAt);
    if (Number.isNaN(summaryEndedAt)) return [];

    return latestEvidence
        .filter((evidence) => {
            if (!evidence.endedAt) return false;
            const evidenceEndedAt = Date.parse(evidence.endedAt);
            return !Number.isNaN(evidenceEndedAt) && evidenceEndedAt > summaryEndedAt;
        })
        .map((evidence) => evidence.label);
}

function summarizePhaseOneSource(phaseOneSummary: PhaseOneSummary | null): string {
    if (!phaseOneSummary) return 'missing';

    const openChecks = Array.isArray(phaseOneSummary.phaseOneOpenChecks)
        ? phaseOneSummary.phaseOneOpenChecks.length
        : 0;
    return `${phaseOneSummary.status} (${openChecks} open Phase 1 checks)`;
}

function summarizeNoRealPaymentsRemediation(summary: CheckBackedSummary | null): string {
    if (!summary) return 'missing';

    const deployedProbe = summary.checks?.find((check) => check.name === 'deployed_checkout_probe');
    if (deployedProbe?.status === 'failed') {
        const detail = deployedProbe.details?.find((item) => item.startsWith('status=')) ?? 'status=unknown';
        return `${summary.status} (${detail}; staging checkout not blocked)`;
    }

    return summary.status;
}

function summarizeStagingSmokeEvidence(summary: StagingSmokeEvidenceSummary | null): string {
    if (!summary) return 'missing';
    return summary.closureStatus ? `${summary.status} / ${summary.closureStatus}` : summary.status;
}

function hasFailedCheck(summary: CheckBackedSummary | null, checkName: string): boolean {
    return Boolean(summary?.checks?.some((check) => check.name === checkName && check.status === 'failed'));
}

function readLatestStrictQaResults(): StrictQaTrackerOutput | null {
    const outputsRoot = path.join(process.cwd(), 'outputs');
    if (!existsSync(outputsRoot)) return null;

    const candidates = readdirSync(outputsRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(outputsRoot, entry.name, 'strict-qa-v2', 'strict-qa-results.json'))
        .filter((file) => existsSync(file))
        .map((file) => ({
            file,
            mtimeMs: statSync(file).mtimeMs,
        }))
        .sort((a, b) => b.mtimeMs - a.mtimeMs);

    for (const candidate of candidates) {
        try {
            return {
                file: candidate.file,
                data: JSON.parse(readFileSync(candidate.file, 'utf8')) as StrictQaResults,
                endedAt: new Date(candidate.mtimeMs).toISOString(),
            };
        } catch {
            // Ignore corrupt historical tracker snapshots and try the next newest one.
        }
    }

    return null;
}

function collectStrictQaOpenFindings(results: StrictQaResults | null): StrictQaFinding[] {
    return (results?.findings ?? [])
        .filter((finding) => String(finding.status ?? '').toLowerCase() === 'open')
        .sort((a, b) => String(a.errorId ?? '').localeCompare(String(b.errorId ?? '')));
}

function isStrictQaSecurityFinding(finding: StrictQaFinding): boolean {
    return /^SEC-\d+/i.test(String(finding.errorId ?? ''));
}

function isStrictQaFindingRepresentedByManualEvidence(finding: StrictQaFinding): boolean {
    const errorId = String(finding.errorId ?? '');

    return (
        /^ERR-LEGAL-/i.test(errorId) ||
        /^ERR-FINAL-INTEGRATION-/i.test(errorId) ||
        /^ERR-FINAL-SEO-/i.test(errorId) ||
        /^ERR-FINAL-SMOKE-/i.test(errorId)
    );
}

function strictQaFindingToBlocker(finding: StrictQaFinding): Finding {
    const errorId = finding.errorId ?? 'strict QA finding';

    return {
        status: 'failed',
        area: isStrictQaSecurityFinding(finding) ? 'strict QA security' : 'strict QA tracker',
        name: errorId,
        message: `${errorId} remains open in the canonical Strict QA tracker: ${finding.summary ?? 'No summary recorded.'}`,
        details: [
            `severity=${finding.severity ?? 'unknown'}`,
            `type=${finding.type ?? 'unknown'}`,
            `surface=${finding.surface ?? 'unknown'}`,
            `fix=${finding.fix ?? 'No fix guidance recorded.'}`,
        ],
        evidence: 'strict-qa-results.json',
    };
}

function summarizeStrictQaTracker(
    results: StrictQaResults | null,
    strictQaOpenFindings: StrictQaFinding[],
    strictQaOpenSecurityFindings: StrictQaFinding[]
): string {
    if (!results) return 'missing';

    if (strictQaOpenFindings.length > 0) {
        const ids = strictQaOpenFindings
            .map((finding) => finding.errorId ?? 'strict QA finding')
            .join(', ');
        const securitySuffix =
            strictQaOpenSecurityFindings.length > 0 ? `; ${strictQaOpenSecurityFindings.length} security finding(s) block Phase 1/RC` : '';
        return `OPEN: ${ids}${securitySuffix}`;
    }

    return 'OK';
}

function readLatestJson<T>(folderName: string, fileName: string): { file: string; data: T } | null {
    const directory = findLatestEvidenceDir(folderName, fileName);
    if (!directory) return null;

    const file = path.join(directory, fileName);
    return {
        file,
        data: JSON.parse(readFileSync(file, 'utf8')) as T,
    };
}

function findLatestEvidenceDir(folderName: string, summaryFileName: string): string | null {
    const root = path.join(process.cwd(), 'outputs', folderName);
    if (!existsSync(root)) return null;

    const directories = readdirSync(root, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(root, entry.name))
        .filter((directory) => existsSync(path.join(directory, summaryFileName)))
        .sort((a, b) => b.localeCompare(a));

    return directories[0] ?? null;
}

function sectionLines(markdown: string, heading: string): string[] {
    const lines = markdown.split(/\r?\n/);
    const start = lines.findIndex((line) => line.trim() === heading);
    if (start < 0) return [];

    const result: string[] = [];
    for (let index = start + 1; index < lines.length; index += 1) {
        const line = lines[index];
        if (line.startsWith('## ') && line.trim() !== heading) break;
        result.push(line);
    }

    return result;
}

function renderMarkdown(statusReport: StatusReport): string {
    const lines = [
        '# Launch Status',
        '',
        `- Status: ${statusReport.status}`,
        `- Started: ${statusReport.startedAt}`,
        `- Ended: ${statusReport.endedAt}`,
        `- Output: ${statusReport.outputDir}`,
        `- Final Closure Pack: ${toRelative(statusReport.finalClosurePackPath)}`,
        '',
        '## Sources',
        '',
        '| Source | Status | Path |',
        '| --- | --- | --- |',
        ...statusReport.sources.map((source) => `| ${escapeCell(source.label)} | ${escapeCell(source.status)} | ${escapeCell(toRelative(source.path))} |`),
        '',
        '## Current Evidence',
        '',
        'These rows are generated from the latest local outputs and are the freshness source for this dashboard. They may be newer than copied checklist text below.',
        '',
        '| Evidence | Status | Path | Role |',
        '| --- | --- | --- | --- |',
        ...statusReport.currentEvidence.map((evidence) => `| ${escapeCell(evidence.label)} | ${escapeCell(evidence.status)} | ${escapeCell(toRelative(evidence.path))} | ${escapeCell(evidence.role)} |`),
        '',
        '## Urgency Summary',
        '',
        '| Priority | Open | Failed | Warnings | Checks | Rule |',
        '| --- | ---: | ---: | ---: | --- | --- |',
        ...statusReport.urgencySummary.map((summary) => `| ${escapeCell(summary.heading)} | ${summary.openCount} | ${summary.failedCount} | ${summary.warningCount} | ${escapeCell(summary.checkIds.join(', ') || '-')} | ${escapeCell(summary.decisionRule)} |`),
        '',
        '## Release Candidate Readiness',
        '',
        '| Field | Value |',
        '| --- | --- |',
        `| Status | ${escapeCell(statusReport.releaseCandidateReadiness.status)} |`,
        `| Reason | ${escapeCell(statusReport.releaseCandidateReadiness.reason)} |`,
        `| Phase 1 Open | ${escapeCell(renderListValue(statusReport.releaseCandidateReadiness.phaseOneOpenChecks))} |`,
        `| RC Open | ${escapeCell(renderListValue(statusReport.releaseCandidateReadiness.releaseCandidateOpenChecks))} |`,
        `| Final-Only Open | ${escapeCell(renderListValue(statusReport.releaseCandidateReadiness.finalOnlyOpenChecks))} |`,
        `| Strict-QA Open | ${escapeCell(renderListValue(statusReport.releaseCandidateReadiness.strictQaOpenChecks))} |`,
        `| Accepted Risks | ${escapeCell(renderListValue(statusReport.releaseCandidateReadiness.acceptedRiskChecks))} |`,
        `| Next Decision | ${escapeCell(statusReport.releaseCandidateReadiness.nextDecision)} |`,
        '',
        'Already proven for RC scope:',
        '',
        ...statusReport.releaseCandidateReadiness.provenNow.map((item) => `- ${item}`),
        ...(statusReport.releaseCandidateReadiness.provenNow.length === 0 ? ['- No RC evidence has been generated yet.'] : []),
        '',
        '## Phase 1 Focus',
        '',
        'Close these checks before release candidate freeze. Do not use legal real data, Stripe live, final API key rotation or production smoke to clear Phase 1.',
        '',
        `- Closure pack: ${toRelative(statusReport.sources.find((source) => source.label === 'phase 1 closure pack')?.path ?? null) || 'missing'}`,
        '- After updating local evidence: run `pnpm launch:phase1`, then `pnpm launch:status`.',
        '',
        '| Status | Check | Support Command | Evidence Minimum | Next Step |',
        '| --- | --- | --- | --- | --- |',
        ...statusReport.phaseOneFocus.map((item) => `| ${escapeCell(item.status)} | ${escapeCell(item.id)} | ${escapeCell(item.supportCommand)} | ${escapeCell(item.evidenceMinimum)} | ${escapeCell(item.nextStep)} |`),
        '',
        '## Blockers',
        '',
    ];

    if (statusReport.blockers.length === 0) {
        lines.push('No blockers detected in the latest available evidence.');
    } else {
        for (const blocker of statusReport.blockers) {
            lines.push(`- ${blocker.area ?? blocker.name ?? 'unknown'}: ${blocker.message}`);
            if (blocker.details?.length) {
                lines.push(`  Evidence detail: ${blocker.details.slice(0, 8).join(' / ')}`);
            }
        }
    }

    lines.push('', '## Manual Evidence Phase Summary', '');
    lines.push('| Phase | Category | Open | Failed | Warnings | Checks |');
    lines.push('| --- | --- | ---: | ---: | ---: | --- |');
    for (const phaseSummary of statusReport.manualEvidencePhaseSummary) {
        if (phaseSummary.openCount === 0 && phaseSummary.phase === 'unknown') continue;
        lines.push(`| ${escapeCell(phaseSummary.heading)} | ${escapeCell(renderPhaseCategory(phaseSummary.category))} | ${phaseSummary.openCount} | ${phaseSummary.failedCount} | ${phaseSummary.warningCount} | ${escapeCell(phaseSummary.checkIds.join(', ') || '-')} |`);
    }
    lines.push('');

    lines.push('## Manual Evidence Coverage', '');
    lines.push('All required manual checks are listed here, including clear checks, so closed items remain traceable.');
    lines.push('');
    lines.push('| Phase | Check | Status | Area | Message |');
    lines.push('| --- | --- | --- | --- | --- |');
    for (const check of statusReport.manualEvidenceCoverage) {
        lines.push(`| ${escapeCell(check.heading)} | ${escapeCell(check.id)} | ${escapeCell(check.status)} | ${escapeCell(check.area)} | ${escapeCell(check.message)} |`);
    }
    lines.push('');

    lines.push('## Open Manual Evidence By Phase', '');
    const hasPhaseItems = phaseOrder.some((phase) => statusReport.manualEvidenceByPhase[phase].length > 0);
    if (!hasPhaseItems) {
        lines.push('No open manual evidence checks detected.');
    } else {
        for (const phase of phaseOrder) {
            const checks = statusReport.manualEvidenceByPhase[phase];
            if (checks.length === 0) continue;

            lines.push(`### ${phaseHeadings[phase]}`, '');
            for (const check of checks) {
                lines.push(`- ${check.id} (${check.status}): ${check.message}`);
                if (check.details.length > 0) {
                    lines.push(`  Evidence detail: ${check.details.slice(0, 4).join(' / ')}`);
                }
            }
            lines.push('');
        }
    }

    lines.push('', '## Open Go/No-Go', '');
    if (statusReport.openGoNoGo.length === 0) {
        lines.push('No unchecked Go/No-Go blockers found in CHECKLIST.md.');
    } else {
        lines.push('### Open Go/No-Go Breakdown', '');
        lines.push('The checklist can show more open rows than the manual evidence summary because command-level rows are derived blockers. Close the final evidence checks first; then rerun the commands.');
        lines.push('');
        lines.push('| Type | Count | Meaning |');
        lines.push('| --- | ---: | --- |');
        lines.push(`| Final evidence checks | ${statusReport.releaseCandidateReadiness.finalOnlyOpenChecks.length} | Real final-window evidence still missing: ${escapeCell(renderListValue(statusReport.releaseCandidateReadiness.finalOnlyOpenChecks))}. |`);
        lines.push(`| Strict-QA tracker blockers | ${statusReport.releaseCandidateReadiness.strictQaOpenChecks.length} | Open tracker findings not represented by manual evidence: ${escapeCell(renderListValue(statusReport.releaseCandidateReadiness.strictQaOpenChecks))}. |`);
        lines.push(`| Automatic legal audit | ${statusReport.urgencySummary.find((summary) => summary.bucket === 'automatic_legal')?.openCount ?? 0} | Derived from legal placeholders until real owner/controller data and human review are complete. |`);
        lines.push(`| Checklist command rows | ${statusReport.openGoNoGo.length} | Includes command-level blockers such as launch:gate, launch:verify, manual-evidence, secondary-review and legal audit; these should clear after the underlying final evidence is recorded. |`);
        lines.push('');
        lines.push('Unchecked checklist rows copied from CHECKLIST.md. Read them as pending targets and use Current Evidence above for the live result:');
        lines.push('');
        statusReport.openGoNoGo.forEach((line) => lines.push(`- ${renderOpenChecklistTarget(line)}`));
    }

    lines.push('', '## Next Actions', '');
    statusReport.nextActions.forEach((action) => lines.push(`- ${action}`));

    lines.push('', '## Rule', '');
    lines.push('This report is a dashboard over the latest Launch Gate evidence, including the latest pnpm launch:gate run when present. It does not replace pnpm launch:verify, pnpm launch:manual-evidence or pnpm launch:secondary-review.');
    lines.push('');

    return `${lines.join('\n')}\n`;
}

function renderOpenChecklistTarget(line: string): string {
    return `Pendiente: ${line
        .replace(/^- \[ \]\s*/, '')
        .replace(/`([^`]+)` pasa sin fallos/g, '`$1` debe pasar sin fallos')
        .replace(/`([^`]+)` pasa\./g, '`$1` debe pasar.')}`;
}

interface ClosureWorksheetPaths {
    finalRunbook: string;
    manualEvidenceFile: string;
    manualEvidenceIndex: string;
    manualEvidenceNextActions: string;
    cloudflareDomainWorkerPreflight: string;
    cloudflareProductionRuntimeReadonly: string;
    cloudflareProductionRuntimeCutoverPreflight: string;
    cloudflareProductionWorkerVariableMatrix: string;
    cloudflareProductionRuntimeCutover: string;
    cloudflareProductionRuntimePhaseOneApproval: string;
    cloudflareProductionWorkerPhaseOneRunner: string;
    cloudflareProductionWorkerPhaseOnePlan: string;
    cloudflareProductionWorkerPhaseOneApprovalGate: string;
    cloudflareProductionWorkerPhaseOneRollback: string;
    cloudflareProductionWorkerSecretsRunner: string;
    cloudflareProductionWorkerSecretsPlan: string;
    cloudflareProductionWorkerSecretsApprovalGate: string;
    cloudflareProductionWorkerSecretsRollback: string;
    cloudflareProductionFulfillmentSecretsRunner: string;
    cloudflareProductionFulfillmentSecretsPlan: string;
    cloudflareProductionFulfillmentSecretsApprovalGate: string;
    legalWorksheet: string;
    legalFinalInputsPackage: string;
    legalFinalInputsManifest: string;
    paymentsWorksheet: string;
    integrationWorksheet: string;
    integrationFinalPackage: string;
    integrationFinalManifest: string;
    integrationServiceMatrix: string;
    stripeReadonlySummary: string;
    turnstileReadonlySummary: string;
    sentryReadonlySummary: string;
    googleReadonlySummary: string;
    resendReadonlySummary: string;
    stripeWebhookCutoverPack: string;
    stripeWebhookCutoverApproval: string;
    stripeWebhookCutoverRollback: string;
    stripeWebhookCutoverRunner: string;
    stripeWebhookCutoverRunnerPlan: string;
    stripeWebhookCutoverRunnerApprovalGate: string;
    stripeWebhookCutoverRunnerRollback: string;
    turnstileDomainClosurePack: string;
    turnstileDomainDashboardChecklist: string;
    turnstileDomainClosureRunner: string;
    turnstileDomainClosureRunnerPlan: string;
    turnstileDomainClosureRunnerApprovalGate: string;
    turnstileDomainClosureRunnerRollback: string;
    sentryTriagePack: string;
    sentryTriageChecklist: string;
    sentryAlertOwnershipChecklist: string;
    sentryIssueTriageRunner: string;
    sentryIssueTriageRunnerPlan: string;
    sentryIssueTriageRunnerApprovalGate: string;
    sentryIssueTriageRunnerRollback: string;
    supabaseProcessedAtCleanupApproval: string;
    supabaseProcessedAtCleanupManifest: string;
    supabaseProcessedAtCleanupPreflight: string;
    supabaseProcessedAtCleanupPostApplyVerification: string;
    supabaseProcessedAtAcceptedRiskPackage: string;
    supabaseProcessedAtAcceptedRiskDryRun: string;
    supabaseProcessedAtReadonlyPreflight: string;
    supabaseProcessedAtCleanupRunner: string;
    supabaseProcessedAtCleanupRunnerPlan: string;
    supabaseProcessedAtCleanupRunnerApprovalGate: string;
    supabaseProcessedAtCleanupRunnerRollback: string;
    finalSmokeWorksheet: string;
    finalSmokeExecutionPack: string;
    finalSmokeExecutionApproval: string;
    finalSmokeExecutionManifest: string;
    stagingSmokeRehearsalRunner: string;
    stagingSmokeRehearsalRunnerPlan: string;
    stagingSmokeRehearsalApprovalGate: string;
    stagingSmokeRehearsalRollback: string;
    finalApprovalQueue: string;
    finalApprovalQueueManifest: string;
    finalApprovalNextAction: string;
    finalApprovalExecutionBoard: string;
    seoWorksheet: string;
    liveDomainReadonlySummary: string;
    seoLlmFinalPackage: string;
    seoLlmFinalManifest: string;
    seoLlmDomainParityGap: string;
}

interface FinalCheckGuidance {
    what: string;
    closeWith: string;
    evidenceMinimum: string;
    preflightDecisions?: string[];
    passSummary: string;
    passEvidence: string[];
    acceptedRisk: string;
    riskSummary?: string;
    riskRationale?: string;
    rollbackPlan?: string;
    riskEvidence?: string[];
}

function renderFinalClosurePack(statusReport: StatusReport): string {
    const paths: ClosureWorksheetPaths = {
        finalRunbook: sourcePath(statusReport, 'final closure runbook'),
        manualEvidenceFile: 'docs/launch/MANUAL_EVIDENCE.local.json',
        manualEvidenceIndex: sourcePath(statusReport, 'manual evidence index'),
        manualEvidenceNextActions: sourcePath(statusReport, 'manual evidence next actions'),
        cloudflareDomainWorkerPreflight: 'outputs/019f1a5e-2745-7c43-870d-544e6ba4e0b1/strict-qa-v2/cloudflare-domain-worker-preflight.md',
        cloudflareProductionRuntimeReadonly: toRelative(latestGeneratedPath('launch-cloudflare-production-runtime-readonly', 'summary.md')) || 'outputs/launch-cloudflare-production-runtime-readonly/<timestamp>/summary.md',
        cloudflareProductionRuntimeCutoverPreflight: toRelative(latestGeneratedPath('launch-cloudflare-production-runtime-cutover-preflight', 'summary.md')) || 'outputs/launch-cloudflare-production-runtime-cutover-preflight/<timestamp>/summary.md',
        cloudflareProductionWorkerVariableMatrix: toRelative(latestGeneratedPath('launch-cloudflare-production-runtime-cutover-preflight', 'cloudflare-production-worker-variable-matrix.md')) || 'outputs/launch-cloudflare-production-runtime-cutover-preflight/<timestamp>/cloudflare-production-worker-variable-matrix.md',
        cloudflareProductionRuntimeCutover: toRelative(latestGeneratedPath('launch-cloudflare-production-runtime-cutover', 'cloudflare-production-runtime-cutover-manifest.json')) || 'outputs/launch-cloudflare-production-runtime-cutover/<timestamp>/cloudflare-production-runtime-cutover-manifest.json',
        cloudflareProductionRuntimePhaseOneApproval: toRelative(latestGeneratedPath('launch-cloudflare-production-runtime-cutover', 'approval-request-phase-1-worker.md')) || 'outputs/launch-cloudflare-production-runtime-cutover/<timestamp>/approval-request-phase-1-worker.md',
        cloudflareProductionWorkerPhaseOneRunner: toRelative(latestGeneratedPath('launch-cloudflare-production-worker-phase1', 'summary.md')) || 'outputs/launch-cloudflare-production-worker-phase1/<timestamp>/summary.md',
        cloudflareProductionWorkerPhaseOnePlan: toRelative(latestGeneratedPath('launch-cloudflare-production-worker-phase1', 'phase1-execution-plan.md')) || 'outputs/launch-cloudflare-production-worker-phase1/<timestamp>/phase1-execution-plan.md',
        cloudflareProductionWorkerPhaseOneApprovalGate: toRelative(latestGeneratedPath('launch-cloudflare-production-worker-phase1', 'approval-gate.md')) || 'outputs/launch-cloudflare-production-worker-phase1/<timestamp>/approval-gate.md',
        cloudflareProductionWorkerPhaseOneRollback: toRelative(latestGeneratedPath('launch-cloudflare-production-worker-phase1', 'rollback-after-phase1.md')) || 'outputs/launch-cloudflare-production-worker-phase1/<timestamp>/rollback-after-phase1.md',
        cloudflareProductionWorkerSecretsRunner: toRelative(latestGeneratedPath('launch-cloudflare-production-worker-secrets', 'summary.md')) || 'outputs/launch-cloudflare-production-worker-secrets/<timestamp>/summary.md',
        cloudflareProductionWorkerSecretsPlan: toRelative(latestGeneratedPath('launch-cloudflare-production-worker-secrets', 'cloudflare-worker-secrets-execution-plan.md')) || 'outputs/launch-cloudflare-production-worker-secrets/<timestamp>/cloudflare-worker-secrets-execution-plan.md',
        cloudflareProductionWorkerSecretsApprovalGate: toRelative(latestGeneratedPath('launch-cloudflare-production-worker-secrets', 'approval-gate.md')) || 'outputs/launch-cloudflare-production-worker-secrets/<timestamp>/approval-gate.md',
        cloudflareProductionWorkerSecretsRollback: toRelative(latestGeneratedPath('launch-cloudflare-production-worker-secrets', 'rollback-after-worker-secrets.md')) || 'outputs/launch-cloudflare-production-worker-secrets/<timestamp>/rollback-after-worker-secrets.md',
        cloudflareProductionFulfillmentSecretsRunner: toRelative(latestGeneratedPath('launch-cloudflare-production-fulfillment-secrets', 'summary.md')) || 'outputs/launch-cloudflare-production-fulfillment-secrets/<timestamp>/summary.md',
        cloudflareProductionFulfillmentSecretsPlan: toRelative(latestGeneratedPath('launch-cloudflare-production-fulfillment-secrets', 'execution-plan.md')) || 'outputs/launch-cloudflare-production-fulfillment-secrets/<timestamp>/execution-plan.md',
        cloudflareProductionFulfillmentSecretsApprovalGate: toRelative(latestGeneratedPath('launch-cloudflare-production-fulfillment-secrets', 'approval-gate.md')) || 'outputs/launch-cloudflare-production-fulfillment-secrets/<timestamp>/approval-gate.md',
        legalWorksheet: toRelative(latestGeneratedPath('launch-legal', 'legal-closure-worksheet.md')) || 'missing',
        legalFinalInputsPackage: toRelative(latestGeneratedPath('launch-legal-final-inputs', 'legal-final-inputs-package.md')) || 'outputs/launch-legal-final-inputs/<timestamp>/legal-final-inputs-package.md',
        legalFinalInputsManifest: toRelative(latestGeneratedPath('launch-legal-final-inputs', 'legal-final-inputs-manifest.json')) || 'outputs/launch-legal-final-inputs/<timestamp>/legal-final-inputs-manifest.json',
        paymentsWorksheet: toRelative(latestGeneratedPath('launch-payments', 'payments-staging-worksheet.md')) || 'missing',
        integrationWorksheet: toRelative(latestGeneratedPath('launch-final-readiness', 'integration-readiness-worksheet.md')) || 'missing',
        integrationFinalPackage: toRelative(latestGeneratedPath('launch-integration-final-package', 'integration-final-package.md')) || 'outputs/launch-integration-final-package/<timestamp>/integration-final-package.md',
        integrationFinalManifest: toRelative(latestGeneratedPath('launch-integration-final-package', 'integration-final-manifest.json')) || 'outputs/launch-integration-final-package/<timestamp>/integration-final-manifest.json',
        integrationServiceMatrix: toRelative(latestGeneratedPath('launch-integration-final-package', 'service-evidence-matrix.md')) || 'outputs/launch-integration-final-package/<timestamp>/service-evidence-matrix.md',
        stripeReadonlySummary: toRelative(latestGeneratedPath('launch-stripe-readonly-evidence', 'summary.md')) || 'outputs/launch-stripe-readonly-evidence/<timestamp>/summary.md',
        turnstileReadonlySummary: toRelative(latestGeneratedPath('launch-turnstile-readonly-evidence', 'summary.md')) || 'outputs/launch-turnstile-readonly-evidence/<timestamp>/summary.md',
        sentryReadonlySummary: toRelative(latestGeneratedPath('launch-sentry-readonly-evidence', 'summary.md')) || 'outputs/launch-sentry-readonly-evidence/<timestamp>/summary.md',
        googleReadonlySummary: toRelative(latestGeneratedPath('launch-google-readonly-evidence', 'summary.md')) || 'outputs/launch-google-readonly-evidence/<timestamp>/summary.md',
        resendReadonlySummary: toRelative(latestGeneratedPath('resend-readonly-evidence', 'summary.md')) || 'outputs/resend-readonly-evidence/<timestamp>/summary.md',
        stripeWebhookCutoverPack: toRelative(latestGeneratedPath('launch-stripe-webhook-cutover-pack', 'stripe-webhook-cutover-pack.md')) || 'outputs/launch-stripe-webhook-cutover-pack/<timestamp>/stripe-webhook-cutover-pack.md',
        stripeWebhookCutoverApproval: toRelative(latestGeneratedPath('launch-stripe-webhook-cutover-pack', 'approval-request.md')) || 'outputs/launch-stripe-webhook-cutover-pack/<timestamp>/approval-request.md',
        stripeWebhookCutoverRollback: toRelative(latestGeneratedPath('launch-stripe-webhook-cutover-pack', 'rollback-plan.md')) || 'outputs/launch-stripe-webhook-cutover-pack/<timestamp>/rollback-plan.md',
        stripeWebhookCutoverRunner: toRelative(latestGeneratedPath('launch-stripe-webhook-cutover-runner', 'summary.md')) || 'outputs/launch-stripe-webhook-cutover-runner/<timestamp>/summary.md',
        stripeWebhookCutoverRunnerPlan: toRelative(latestGeneratedPath('launch-stripe-webhook-cutover-runner', 'stripe-webhook-cutover-execution-plan.md')) || 'outputs/launch-stripe-webhook-cutover-runner/<timestamp>/stripe-webhook-cutover-execution-plan.md',
        stripeWebhookCutoverRunnerApprovalGate: toRelative(latestGeneratedPath('launch-stripe-webhook-cutover-runner', 'approval-gate.md')) || 'outputs/launch-stripe-webhook-cutover-runner/<timestamp>/approval-gate.md',
        stripeWebhookCutoverRunnerRollback: toRelative(latestGeneratedPath('launch-stripe-webhook-cutover-runner', 'rollback-after-webhook-cutover.md')) || 'outputs/launch-stripe-webhook-cutover-runner/<timestamp>/rollback-after-webhook-cutover.md',
        turnstileDomainClosurePack: toRelative(latestGeneratedPath('launch-turnstile-domain-closure-pack', 'turnstile-domain-closure-pack.md')) || 'outputs/launch-turnstile-domain-closure-pack/<timestamp>/turnstile-domain-closure-pack.md',
        turnstileDomainDashboardChecklist: toRelative(latestGeneratedPath('launch-turnstile-domain-closure-pack', 'dashboard-evidence-checklist.md')) || 'outputs/launch-turnstile-domain-closure-pack/<timestamp>/dashboard-evidence-checklist.md',
        turnstileDomainClosureRunner: toRelative(latestGeneratedPath('launch-turnstile-domain-closure-runner', 'summary.md')) || 'outputs/launch-turnstile-domain-closure-runner/<timestamp>/summary.md',
        turnstileDomainClosureRunnerPlan: toRelative(latestGeneratedPath('launch-turnstile-domain-closure-runner', 'turnstile-domain-closure-execution-plan.md')) || 'outputs/launch-turnstile-domain-closure-runner/<timestamp>/turnstile-domain-closure-execution-plan.md',
        turnstileDomainClosureRunnerApprovalGate: toRelative(latestGeneratedPath('launch-turnstile-domain-closure-runner', 'approval-gate.md')) || 'outputs/launch-turnstile-domain-closure-runner/<timestamp>/approval-gate.md',
        turnstileDomainClosureRunnerRollback: toRelative(latestGeneratedPath('launch-turnstile-domain-closure-runner', 'rollback-after-turnstile-domain-closure.md')) || 'outputs/launch-turnstile-domain-closure-runner/<timestamp>/rollback-after-turnstile-domain-closure.md',
        sentryTriagePack: toRelative(latestGeneratedPath('launch-sentry-triage-pack', 'sentry-triage-pack.md')) || 'outputs/launch-sentry-triage-pack/<timestamp>/sentry-triage-pack.md',
        sentryTriageChecklist: toRelative(latestGeneratedPath('launch-sentry-triage-pack', 'triage-checklist.md')) || 'outputs/launch-sentry-triage-pack/<timestamp>/triage-checklist.md',
        sentryAlertOwnershipChecklist: toRelative(latestGeneratedPath('launch-sentry-triage-pack', 'alert-ownership-checklist.md')) || 'outputs/launch-sentry-triage-pack/<timestamp>/alert-ownership-checklist.md',
        sentryIssueTriageRunner: toRelative(latestGeneratedPath('launch-sentry-issue-triage-runner', 'summary.md')) || 'outputs/launch-sentry-issue-triage-runner/<timestamp>/summary.md',
        sentryIssueTriageRunnerPlan: toRelative(latestGeneratedPath('launch-sentry-issue-triage-runner', 'sentry-issue-triage-execution-plan.md')) || 'outputs/launch-sentry-issue-triage-runner/<timestamp>/sentry-issue-triage-execution-plan.md',
        sentryIssueTriageRunnerApprovalGate: toRelative(latestGeneratedPath('launch-sentry-issue-triage-runner', 'approval-gate.md')) || 'outputs/launch-sentry-issue-triage-runner/<timestamp>/approval-gate.md',
        sentryIssueTriageRunnerRollback: toRelative(latestGeneratedPath('launch-sentry-issue-triage-runner', 'rollback-after-sentry-issue-triage.md')) || 'outputs/launch-sentry-issue-triage-runner/<timestamp>/rollback-after-sentry-issue-triage.md',
        supabaseProcessedAtCleanupApproval: toRelative(latestGeneratedPath('launch-supabase-processed-at-cleanup', 'approval-request.md')) || 'outputs/launch-supabase-processed-at-cleanup/<timestamp>/approval-request.md',
        supabaseProcessedAtCleanupManifest: toRelative(latestGeneratedPath('launch-supabase-processed-at-cleanup', 'supabase-processed-at-cleanup-manifest.json')) || 'outputs/launch-supabase-processed-at-cleanup/<timestamp>/supabase-processed-at-cleanup-manifest.json',
        supabaseProcessedAtCleanupPreflight: toRelative(latestGeneratedPath('launch-supabase-processed-at-cleanup', 'preflight.sql')) || 'outputs/launch-supabase-processed-at-cleanup/<timestamp>/preflight.sql',
        supabaseProcessedAtCleanupPostApplyVerification: toRelative(latestGeneratedPath('launch-supabase-processed-at-cleanup', 'post-apply-verification.sql')) || 'outputs/launch-supabase-processed-at-cleanup/<timestamp>/post-apply-verification.sql',
        supabaseProcessedAtAcceptedRiskPackage: toRelative(latestGeneratedPath('launch-supabase-processed-at-cleanup', 'accepted-risk-package.md')) || 'outputs/launch-supabase-processed-at-cleanup/<timestamp>/accepted-risk-package.md',
        supabaseProcessedAtAcceptedRiskDryRun: toRelative(latestGeneratedPath('launch-supabase-processed-at-cleanup', 'strict-qa-accepted-risk-dry-run.txt')) || 'outputs/launch-supabase-processed-at-cleanup/<timestamp>/strict-qa-accepted-risk-dry-run.txt',
        supabaseProcessedAtReadonlyPreflight: toRelative(latestGeneratedPath('supabase-processed-at-readonly-preflight', 'summary.md')) || 'outputs/supabase-processed-at-readonly-preflight/<timestamp>/summary.md',
        supabaseProcessedAtCleanupRunner: toRelative(latestGeneratedPath('launch-supabase-processed-at-cleanup-runner', 'summary.md')) || 'outputs/launch-supabase-processed-at-cleanup-runner/<timestamp>/summary.md',
        supabaseProcessedAtCleanupRunnerPlan: toRelative(latestGeneratedPath('launch-supabase-processed-at-cleanup-runner', 'processed-at-cleanup-execution-plan.md')) || 'outputs/launch-supabase-processed-at-cleanup-runner/<timestamp>/processed-at-cleanup-execution-plan.md',
        supabaseProcessedAtCleanupRunnerApprovalGate: toRelative(latestGeneratedPath('launch-supabase-processed-at-cleanup-runner', 'approval-gate.md')) || 'outputs/launch-supabase-processed-at-cleanup-runner/<timestamp>/approval-gate.md',
        supabaseProcessedAtCleanupRunnerRollback: toRelative(latestGeneratedPath('launch-supabase-processed-at-cleanup-runner', 'rollback-after-cleanup.md')) || 'outputs/launch-supabase-processed-at-cleanup-runner/<timestamp>/rollback-after-cleanup.md',
        finalSmokeWorksheet: toRelative(latestGeneratedPath('launch-final-readiness', 'final-smoke-worksheet.md')) || 'missing',
        finalSmokeExecutionPack: toRelative(latestGeneratedPath('launch-final-smoke-execution-pack', 'summary.md')) || 'outputs/launch-final-smoke-execution-pack/<timestamp>/summary.md',
        finalSmokeExecutionApproval: toRelative(latestGeneratedPath('launch-final-smoke-execution-pack', 'approval-request-final-smoke.md')) || 'outputs/launch-final-smoke-execution-pack/<timestamp>/approval-request-final-smoke.md',
        finalSmokeExecutionManifest: toRelative(latestGeneratedPath('launch-final-smoke-execution-pack', 'final-smoke-execution-manifest.json')) || 'outputs/launch-final-smoke-execution-pack/<timestamp>/final-smoke-execution-manifest.json',
        stagingSmokeRehearsalRunner: toRelative(latestGeneratedPath('launch-staging-smoke-rehearsal-runner', 'summary.md')) || 'outputs/launch-staging-smoke-rehearsal-runner/<timestamp>/summary.md',
        stagingSmokeRehearsalRunnerPlan: toRelative(latestGeneratedPath('launch-staging-smoke-rehearsal-runner', 'staging-smoke-execution-plan.md')) || 'outputs/launch-staging-smoke-rehearsal-runner/<timestamp>/staging-smoke-execution-plan.md',
        stagingSmokeRehearsalApprovalGate: toRelative(latestGeneratedPath('launch-staging-smoke-rehearsal-runner', 'approval-gate.md')) || 'outputs/launch-staging-smoke-rehearsal-runner/<timestamp>/approval-gate.md',
        stagingSmokeRehearsalRollback: toRelative(latestGeneratedPath('launch-staging-smoke-rehearsal-runner', 'rollback-after-staging-smoke.md')) || 'outputs/launch-staging-smoke-rehearsal-runner/<timestamp>/rollback-after-staging-smoke.md',
        finalApprovalQueue: toRelative(latestGeneratedPath('launch-final-approval-queue', 'final-approval-queue.md')) || 'outputs/launch-final-approval-queue/<timestamp>/final-approval-queue.md',
        finalApprovalQueueManifest: toRelative(latestGeneratedPath('launch-final-approval-queue', 'final-approval-queue-manifest.json')) || 'outputs/launch-final-approval-queue/<timestamp>/final-approval-queue-manifest.json',
        finalApprovalNextAction: toRelative(latestGeneratedPath('launch-final-approval-queue', 'final-approval-next-action.md')) || 'outputs/launch-final-approval-queue/<timestamp>/final-approval-next-action.md',
        finalApprovalExecutionBoard: toRelative(latestGeneratedPath('launch-final-approval-queue', 'final-window-execution-board.md')) || 'outputs/launch-final-approval-queue/<timestamp>/final-window-execution-board.md',
        seoWorksheet: toRelative(latestGeneratedPath('launch-seo', 'seo-llm-final-worksheet.md')) || 'missing',
        liveDomainReadonlySummary: toRelative(latestGeneratedPath('launch-live-domain-readonly-evidence', 'summary.md')) || 'outputs/launch-live-domain-readonly-evidence/<timestamp>/summary.md',
        seoLlmFinalPackage: toRelative(latestGeneratedPath('launch-seo-llm-final-package', 'seo-llm-final-package.md')) || 'outputs/launch-seo-llm-final-package/<timestamp>/seo-llm-final-package.md',
        seoLlmFinalManifest: toRelative(latestGeneratedPath('launch-seo-llm-final-package', 'seo-llm-final-manifest.json')) || 'outputs/launch-seo-llm-final-package/<timestamp>/seo-llm-final-manifest.json',
        seoLlmDomainParityGap: toRelative(latestGeneratedPath('launch-seo-llm-final-package', 'domain-parity-gap.md')) || 'outputs/launch-seo-llm-final-package/<timestamp>/domain-parity-gap.md',
    };
    const finalChecks = statusReport.manualEvidenceByPhase.phase_3_final;
    const strictQaTrackerBlockers = statusReport.blockers.filter((blocker) =>
        blocker.area === 'strict QA tracker' || blocker.area === 'strict QA security'
    );
    const lines = [
        '# Final Closure Pack',
        '',
        'Generated by `pnpm launch:status` from the latest local launch evidence.',
        '',
        `- Launch Status: ${statusReport.status}`,
        `- Release Candidate Status: ${statusReport.releaseCandidateReadiness.status}`,
        `- Generated: ${statusReport.endedAt}`,
        `- Stable Runbook: ${paths.finalRunbook}`,
        `- Manual Evidence File: ${paths.manualEvidenceFile}`,
        '',
        '## Current Gate Snapshot',
        '',
        '| Field | Value |',
        '| --- | --- |',
        `| Phase 1 Open | ${escapeCell(renderListValue(statusReport.releaseCandidateReadiness.phaseOneOpenChecks))} |`,
        `| RC Open | ${escapeCell(renderListValue(statusReport.releaseCandidateReadiness.releaseCandidateOpenChecks))} |`,
        `| Final-Only Open | ${escapeCell(renderListValue(statusReport.releaseCandidateReadiness.finalOnlyOpenChecks))} |`,
        `| Strict-QA Open | ${escapeCell(renderListValue(statusReport.releaseCandidateReadiness.strictQaOpenChecks))} |`,
        `| Accepted Risks | ${escapeCell(renderListValue(statusReport.releaseCandidateReadiness.acceptedRiskChecks))} |`,
        `| Next Decision | ${escapeCell(statusReport.releaseCandidateReadiness.nextDecision)} |`,
        '',
        '## Final-Only Checks',
        '',
    ];

    if (finalChecks.length === 0) {
        lines.push('No final-only manual checks are currently open. Still run the full final gate before marking the launch ready.');
    } else {
        lines.push('| Check | Status | What It Means | Close It With | Evidence Minimum | Preflight Decisions |');
        lines.push('| --- | --- | --- | --- | --- | --- |');
        for (const check of finalChecks) {
            const guide = finalCheckGuidance(check.id, paths);
            const preflightDecisions = guide.preflightDecisions?.length
                ? guide.preflightDecisions.join('; ')
                : '-';
            lines.push(`| ${escapeCell(check.id)} | ${escapeCell(check.status)} | ${escapeCell(guide.what)} | ${escapeCell(guide.closeWith)} | ${escapeCell(guide.evidenceMinimum)} | ${escapeCell(preflightDecisions)} |`);
        }
    }

    lines.push(
        '',
        '## Strict-QA Tracker Blockers',
        '',
    );

    if (strictQaTrackerBlockers.length === 0) {
        lines.push('No standalone strict-QA tracker blockers are currently open.');
    } else {
        lines.push('These are not closed by manual evidence commands. Close them by fixing/applying/accepting the finding in `strict-qa-results.json`, then regenerate the tracker and rerun `pnpm launch:status`.');
        lines.push('');
        lines.push('| Finding | Severity / Type | Close It With | Evidence Minimum |');
        lines.push('| --- | --- | --- | --- |');
        for (const blocker of strictQaTrackerBlockers) {
            lines.push(strictQaBlockerClosureRow(blocker, paths));
        }
    }

    lines.push(
        '',
        '## Final Approval Critical Path',
        '',
        ...renderFinalApprovalCriticalPath(),
    );

    lines.push(
        '',
        '## Final Approval Item Posture',
        '',
        ...renderFinalApprovalItemPosture(),
    );

    lines.push(
        '',
        '## Record Final Evidence',
        '',
        'Use these commands in dry-run mode first. Add `--write` only after reviewing the printed change. Keep secrets, private documents, full dashboard tokens and private user data out of evidence.',
        '',
    );

    if (finalChecks.length === 0) {
        lines.push('No final-only checks currently need manual evidence commands.');
    } else {
        for (const check of finalChecks) {
            const guide = finalCheckGuidance(check.id, paths);
            lines.push(
                `### ${check.id}`,
                '',
                'Pass evidence dry run:',
                '',
                '```bash',
                manualEvidencePassCommand(check.id, guide),
                '```',
                '',
                guide.acceptedRisk,
                '',
                ...(guide.riskSummary
                    ? [
                        'Accepted-risk dry run:',
                        '',
                        '```bash',
                        manualEvidenceAcceptedRiskCommand(check.id, guide),
                        '```',
                        '',
                    ]
                    : [
                        'Accepted-risk command: not generated for this check.',
                        '',
                    ]),
            );
        }
    }

    lines.push(
        '',
        '## Responsibilities And Cadence',
        '',
        'Use `docs/launch/FINAL_CLOSURE.md` as the source of truth for the final-window cadence. The launch owner must update that runbook before Gate execution if scope or timing changes.',
        '',
        '| Moment | Owner | Action | Blocks |',
        '| --- | --- | --- | --- |',
        '| T-48h | Alin | Freeze public copy, packages, docs/launch/LAUNCH_MARKETING_PLAN.md, payment mode and the real-payments/no-payments decision. | Legal, SEO/LLM, Stripe and final smoke. |',
        '| T-48h | Alin | Confirm reviews, Telegram, rich telemetry and definitive level check remain out of launch unless a new decision is documented. | Checklist, legal/cookies and manual evidence. |',
        '| T-48h | Alin | Confirm premium Russian font: buy/license the official Cyrillic-capable family or accept the current fallback as a launch decision. | `seo_llm_final`, `final_smoke`. |',
        '| T-24h | Alin | Complete real legal data and human legal review. | `legal_owner_controller`, `legal_human_review`. |',
        '| T-24h | Alin/Codex | Run Supabase backup/export outside the repo or confirm Pro upgrade/accepted risk. | `database_readiness`, Go/No-Go. |',
        '| T-12h | Alin/Codex | Rotate final keys and validate secrets in Cloudflare, Supabase, Stripe, Google, Resend, Turnstile and Sentry. | `security_external`, `integration_readiness`. |',
        '| T-6h | Codex | Run local final-support audits: security, operations, payments, SEO, final readiness and status. | Final manual evidence. |',
        '| T-3h | Alin/Codex | Finish the gated full lifecycle rehearsal in staging, then run only the minimal manual production checklist. | `final_smoke`. |',
        '| T-1h | Alin | Review manual evidence, accept non-critical risks if any, and decide Go/No-Go. | `launchDecision`. |',
        '| T-0 | Codex | Run `pnpm launch:gate`, `pnpm launch:secondary-review` and `pnpm launch:status`. | `READY` or `NO-GO`. |',
        '',
        '## Ordered Closure',
        '',
        '1. Freeze final public copy, prices, legal pages, domain, checkout mode and docs/launch/LAUNCH_MARKETING_PLAN.md.',
        '2. Confirm the definitive level check is still postponed, or if it enters launch, follow docs/launch/LEVEL_CHECK.md first: consent, purpose, retention, access/deletion, rubric, legal review and accessibility/legal reruns.',
        '3. Confirm premium Russian typography: buy/license the official Cyrillic-capable family and verify `/ru`, or record that Alin accepts the current fallback for launch. Do not commit unlicensed font files, invoices or fiscal data.',
        `4. Fill real legal data and human review evidence using ${paths.legalWorksheet}, ${paths.legalFinalInputsPackage} and ${paths.legalFinalInputsManifest}. Do not invent owner/controller/subprocessor values.`,
        `5. Complete Stripe test rehearsal, then prepare Stripe live for real payments from day one and prove CHECKOUT_ENABLED_OVERRIDE=false as rollback. Close it using ${paths.paymentsWorksheet}. If Stripe MCP listing is unavailable, use Stripe dashboard, checkout, webhook and Supabase reconciliation evidence as the source of truth.`,
        '6. Run Supabase backup/export outside the repo, confirm Pro upgrade, or record accepted risk using docs/launch/SUPABASE_BACKUP_RUNBOOK.md before key rotation or production/destructive changes.',
        '7. Resolve standalone strict-QA tracker blockers listed above, including any approved Supabase cleanup migration or explicit accepted-risk decision, then regenerate the tracker.',
        '8. Rotate keys only in the final deployment window, after copy, legal, payments and domain are final.',
        `9. Resolve Cloudflare production runtime posture using ${paths.cloudflareDomainWorkerPreflight}, ${paths.cloudflareProductionRuntimeReadonly}, ${paths.cloudflareProductionRuntimeCutoverPreflight}, ${paths.cloudflareProductionWorkerVariableMatrix}, ${paths.cloudflareProductionRuntimeCutover}, the Worker-create runner ${paths.cloudflareProductionWorkerPhaseOneRunner}, the web secrets/attestation runner ${paths.cloudflareProductionWorkerSecretsRunner} and the separate fulfillment config/secrets/email runner ${paths.cloudflareProductionFulfillmentSecretsRunner}: both production Workers must exist and attest exact identity/version/Supabase before a separately approved domain move. Use ${paths.cloudflareProductionRuntimePhaseOneApproval}, ${paths.cloudflareProductionWorkerPhaseOneApprovalGate}, ${paths.cloudflareProductionWorkerSecretsApprovalGate} and ${paths.cloudflareProductionFulfillmentSecretsApprovalGate} for their own phases only; they are not domain approval.`,
        '10. Rotate keys only after the production runtime/domain/payment/legal posture is settled, and never store key values in evidence.',
        `11. Verify production integrations using ${paths.integrationWorksheet} and ${paths.integrationFinalPackage}: Cloudflare Pages-vs-Worker domain ownership, production Worker secrets/direct probe, Supabase, Google, Resend, Turnstile, Sentry and logs. Use ${paths.stripeWebhookCutoverPack} plus ${paths.stripeWebhookCutoverRunner}, ${paths.turnstileDomainClosurePack} plus ${paths.turnstileDomainClosureRunner}, ${paths.sentryTriagePack} plus ${paths.sentryIssueTriageRunner}, and the staging rehearsal runner ${paths.stagingSmokeRehearsalRunner} for the current Stripe webhook, Turnstile dashboard, Sentry issue and pre-final staging lifecycle decisions. Include the legacy Worker espanol-honesto-reminders decision, Supabase Advisor findings and staging migration-history decision.`,
        `12. Close SEO/LLM after final copy/legal/domain settle using ${paths.seoWorksheet} and ${paths.seoLlmFinalPackage}; run the live-domain read-only probe, verify that the live custom domains serve the modern Worker build rather than the old Pages project, then verify marketing plan parity and the Cyrillic typography decision against docs/launch/LAUNCH_MARKETING_PLAN.md and docs/launch/SEO_LLM_FINAL.md.`,
        '13. Run or review the full staging-only rehearsal using ' + paths.stagingSmokeRehearsalRunner + ' after the separate checkout-gate approval and read-only preflight; then complete only the minimal manual production checklist from ' + paths.finalSmokeExecutionPack + ' and ' + paths.finalSmokeWorksheet + '. Never run `real-env-smoke.ts` against production; review ' + paths.finalSmokeExecutionApproval + ' and include a rendered `/ru` spot check if font assets changed.',
        '14. Run the final commands below and make the Go/No-Go decision from fresh evidence.',
        '',
        '## Final Commands',
        '',
        '```bash',
        'pnpm launch:legal',
        'pnpm launch:payments',
        'pnpm launch:final-readiness',
        'pnpm launch:cloudflare-production-runtime-readonly',
        'pnpm launch:cloudflare-production-worker-secrets',
        'pnpm launch:cloudflare-production-fulfillment-secrets',
        'pnpm launch:integration-final-package',
        'pnpm launch:staging-smoke-rehearsal-runner',
        'pnpm launch:sentry-issue-triage-runner',
        'pnpm launch:final-smoke-execution-pack',
        'pnpm launch:live-domain-readonly -- --base-url https://espanolhonesto.com --host-variant https://www.espanolhonesto.com',
        'pnpm launch:seo',
        'pnpm launch:seo-llm-final-package',
        'pnpm launch:manual-evidence',
        'pnpm launch:gate',
        'pnpm launch:secondary-review',
        'pnpm launch:status',
        '```',
        '',
        '## Evidence Safety',
        '',
        '- Put non-secret evidence only in `docs/launch/MANUAL_EVIDENCE.local.json`.',
        '- Do not store API keys, private keys, webhook secrets, tokens, invoices, personal IDs or private screenshots in the repository.',
        '- If the definitive level check enters launch, do not store submitted documents, audio, video, private Drive links or level-test personal data in the repository, outputs or `.codex-ops`; record only redacted non-secret notes.',
        '- Key rotation, Stripe live mode, premium Russian font replacement and production smoke stay final-window actions; they are not required to keep the RC viable.',
        '- If a final check is intentionally deferred, record the accepted risk and owner in manual evidence instead of marking it silently done.',
        '',
        '## Current Source Paths',
        '',
        '| Source | Path |',
        '| --- | --- |',
        `| Launch Status Summary | ${escapeCell(toRelative(path.join(statusReport.outputDir, 'summary.md')))} |`,
        `| Manual Evidence Index | ${escapeCell(paths.manualEvidenceIndex)} |`,
        `| Manual Evidence Next Actions | ${escapeCell(paths.manualEvidenceNextActions)} |`,
        `| Final Closure Runbook | ${escapeCell(paths.finalRunbook)} |`,
        `| Cloudflare Domain/Worker Preflight | ${escapeCell(paths.cloudflareDomainWorkerPreflight)} |`,
        `| Cloudflare Production Runtime Read-Only Evidence | ${escapeCell(paths.cloudflareProductionRuntimeReadonly)} |`,
        `| Cloudflare Production Runtime Cutover Preflight | ${escapeCell(paths.cloudflareProductionRuntimeCutoverPreflight)} |`,
        `| Cloudflare Production Worker Variable Matrix | ${escapeCell(paths.cloudflareProductionWorkerVariableMatrix)} |`,
        `| Cloudflare Production Runtime Cutover | ${escapeCell(paths.cloudflareProductionRuntimeCutover)} |`,
        `| Cloudflare Worker Phase 1 Approval | ${escapeCell(paths.cloudflareProductionRuntimePhaseOneApproval)} |`,
        `| Cloudflare Worker Phase 1 Runner Summary | ${escapeCell(paths.cloudflareProductionWorkerPhaseOneRunner)} |`,
        `| Cloudflare Worker Phase 1 Runner Plan | ${escapeCell(paths.cloudflareProductionWorkerPhaseOnePlan)} |`,
        `| Cloudflare Worker Phase 1 Approval Gate | ${escapeCell(paths.cloudflareProductionWorkerPhaseOneApprovalGate)} |`,
        `| Cloudflare Worker Phase 1 Rollback | ${escapeCell(paths.cloudflareProductionWorkerPhaseOneRollback)} |`,
        `| Cloudflare Worker Secrets Runner Summary | ${escapeCell(paths.cloudflareProductionWorkerSecretsRunner)} |`,
        `| Cloudflare Worker Secrets Runner Plan | ${escapeCell(paths.cloudflareProductionWorkerSecretsPlan)} |`,
        `| Cloudflare Worker Secrets Approval Gate | ${escapeCell(paths.cloudflareProductionWorkerSecretsApprovalGate)} |`,
        `| Cloudflare Worker Secrets Runner Rollback | ${escapeCell(paths.cloudflareProductionWorkerSecretsRollback)} |`,
        `| Cloudflare Fulfillment Secrets Runner Summary | ${escapeCell(paths.cloudflareProductionFulfillmentSecretsRunner)} |`,
        `| Cloudflare Fulfillment Secrets Runner Plan | ${escapeCell(paths.cloudflareProductionFulfillmentSecretsPlan)} |`,
        `| Cloudflare Fulfillment Secrets Approval Gate | ${escapeCell(paths.cloudflareProductionFulfillmentSecretsApprovalGate)} |`,
        '| Launch Marketing Plan | docs/launch/LAUNCH_MARKETING_PLAN.md |',
        `| Legal Worksheet | ${escapeCell(paths.legalWorksheet)} |`,
        `| Legal Final Inputs Package | ${escapeCell(paths.legalFinalInputsPackage)} |`,
        `| Legal Final Inputs Manifest | ${escapeCell(paths.legalFinalInputsManifest)} |`,
        `| Payments Worksheet | ${escapeCell(paths.paymentsWorksheet)} |`,
        `| Integration Worksheet | ${escapeCell(paths.integrationWorksheet)} |`,
        `| Integration Final Package | ${escapeCell(paths.integrationFinalPackage)} |`,
        `| Integration Final Manifest | ${escapeCell(paths.integrationFinalManifest)} |`,
        `| Integration Service Matrix | ${escapeCell(paths.integrationServiceMatrix)} |`,
        `| Stripe Read-Only Evidence | ${escapeCell(paths.stripeReadonlySummary)} |`,
        `| Turnstile Read-Only Evidence | ${escapeCell(paths.turnstileReadonlySummary)} |`,
        `| Sentry Read-Only Evidence | ${escapeCell(paths.sentryReadonlySummary)} |`,
        `| Google Workspace Read-Only Evidence | ${escapeCell(paths.googleReadonlySummary)} |`,
        `| Resend Read-Only Evidence | ${escapeCell(paths.resendReadonlySummary)} |`,
        `| Stripe Webhook Cutover Pack | ${escapeCell(paths.stripeWebhookCutoverPack)} |`,
        `| Stripe Webhook Approval Request | ${escapeCell(paths.stripeWebhookCutoverApproval)} |`,
        `| Stripe Webhook Rollback Plan | ${escapeCell(paths.stripeWebhookCutoverRollback)} |`,
        `| Stripe Webhook Cutover Runner | ${escapeCell(paths.stripeWebhookCutoverRunner)} |`,
        `| Stripe Webhook Cutover Runner Plan | ${escapeCell(paths.stripeWebhookCutoverRunnerPlan)} |`,
        `| Stripe Webhook Cutover Approval Gate | ${escapeCell(paths.stripeWebhookCutoverRunnerApprovalGate)} |`,
        `| Stripe Webhook Cutover Runner Rollback | ${escapeCell(paths.stripeWebhookCutoverRunnerRollback)} |`,
        `| Turnstile Domain Closure Pack | ${escapeCell(paths.turnstileDomainClosurePack)} |`,
        `| Turnstile Dashboard Evidence Checklist | ${escapeCell(paths.turnstileDomainDashboardChecklist)} |`,
        `| Turnstile Domain Closure Runner | ${escapeCell(paths.turnstileDomainClosureRunner)} |`,
        `| Turnstile Domain Closure Runner Plan | ${escapeCell(paths.turnstileDomainClosureRunnerPlan)} |`,
        `| Turnstile Domain Closure Approval Gate | ${escapeCell(paths.turnstileDomainClosureRunnerApprovalGate)} |`,
        `| Turnstile Domain Closure Runner Rollback | ${escapeCell(paths.turnstileDomainClosureRunnerRollback)} |`,
        `| Sentry Triage Pack | ${escapeCell(paths.sentryTriagePack)} |`,
        `| Sentry Triage Checklist | ${escapeCell(paths.sentryTriageChecklist)} |`,
        `| Sentry Alert Ownership Checklist | ${escapeCell(paths.sentryAlertOwnershipChecklist)} |`,
        `| Sentry Issue Triage Runner | ${escapeCell(paths.sentryIssueTriageRunner)} |`,
        `| Sentry Issue Triage Runner Plan | ${escapeCell(paths.sentryIssueTriageRunnerPlan)} |`,
        `| Sentry Issue Triage Approval Gate | ${escapeCell(paths.sentryIssueTriageRunnerApprovalGate)} |`,
        `| Sentry Issue Triage Runner Rollback | ${escapeCell(paths.sentryIssueTriageRunnerRollback)} |`,
        `| Supabase Processed At Cleanup Approval | ${escapeCell(paths.supabaseProcessedAtCleanupApproval)} |`,
        `| Supabase Processed At Cleanup Manifest | ${escapeCell(paths.supabaseProcessedAtCleanupManifest)} |`,
        `| Supabase Processed At Cleanup Preflight | ${escapeCell(paths.supabaseProcessedAtCleanupPreflight)} |`,
        `| Supabase Processed At Cleanup Verification | ${escapeCell(paths.supabaseProcessedAtCleanupPostApplyVerification)} |`,
        `| Supabase Processed At Accepted Risk Package | ${escapeCell(paths.supabaseProcessedAtAcceptedRiskPackage)} |`,
        `| Supabase Processed At Accepted Risk Dry Run | ${escapeCell(paths.supabaseProcessedAtAcceptedRiskDryRun)} |`,
        `| Supabase Processed At Read-Only Preflight | ${escapeCell(paths.supabaseProcessedAtReadonlyPreflight)} |`,
        `| Supabase Processed At Cleanup Runner | ${escapeCell(paths.supabaseProcessedAtCleanupRunner)} |`,
        `| Supabase Processed At Cleanup Runner Plan | ${escapeCell(paths.supabaseProcessedAtCleanupRunnerPlan)} |`,
        `| Supabase Processed At Cleanup Approval Gate | ${escapeCell(paths.supabaseProcessedAtCleanupRunnerApprovalGate)} |`,
        `| Supabase Processed At Cleanup Runner Rollback | ${escapeCell(paths.supabaseProcessedAtCleanupRunnerRollback)} |`,
        `| Final Smoke Worksheet | ${escapeCell(paths.finalSmokeWorksheet)} |`,
        `| Final Smoke Execution Pack | ${escapeCell(paths.finalSmokeExecutionPack)} |`,
        `| Final Smoke Execution Approval | ${escapeCell(paths.finalSmokeExecutionApproval)} |`,
        `| Final Smoke Execution Manifest | ${escapeCell(paths.finalSmokeExecutionManifest)} |`,
        `| Staging Smoke Rehearsal Runner | ${escapeCell(paths.stagingSmokeRehearsalRunner)} |`,
        `| Staging Smoke Rehearsal Runner Plan | ${escapeCell(paths.stagingSmokeRehearsalRunnerPlan)} |`,
        `| Staging Smoke Rehearsal Approval Gate | ${escapeCell(paths.stagingSmokeRehearsalApprovalGate)} |`,
        `| Staging Smoke Rehearsal Rollback | ${escapeCell(paths.stagingSmokeRehearsalRollback)} |`,
        `| Final Approval Queue | ${escapeCell(paths.finalApprovalQueue)} |`,
        `| Final Approval Queue Manifest | ${escapeCell(paths.finalApprovalQueueManifest)} |`,
        `| Final Approval Next Action Cursor | ${escapeCell(paths.finalApprovalNextAction)} |`,
        `| Final Window Execution Board | ${escapeCell(paths.finalApprovalExecutionBoard)} |`,
        `| SEO/LLM Worksheet | ${escapeCell(paths.seoWorksheet)} |`,
        `| Live Domain Read-Only Evidence | ${escapeCell(paths.liveDomainReadonlySummary)} |`,
        `| SEO/LLM Final Package | ${escapeCell(paths.seoLlmFinalPackage)} |`,
        `| SEO/LLM Final Manifest | ${escapeCell(paths.seoLlmFinalManifest)} |`,
        `| SEO/LLM Domain Parity Gap | ${escapeCell(paths.seoLlmDomainParityGap)} |`,
        '',
    );

    return `${lines.join('\n')}\n`;
}

function renderFinalApprovalCriticalPath(): string[] {
    const steps = finalApprovalQueueManifest?.data.criticalPath ?? [];
    if (steps.length === 0) {
        return [
            'No final approval critical path is available. Run `pnpm launch:final-approval-queue`, then rerun `pnpm launch:status` before approving final-window writes.',
        ];
    }

    return [
        `Source: ${toRelative(finalApprovalQueueManifest?.file ?? '') || 'outputs/launch-final-approval-queue/<timestamp>/final-approval-queue-manifest.json'}`,
        '',
        'This is the dependency order for final-window execution. It is not approval and does not replace the linked request files.',
        '',
        '| Step | Phase | Queue Items | Prerequisites | Blocks | Close When | Stop If |',
        '| --- | --- | --- | --- | --- | --- | --- |',
        ...steps.map((step) => `| ${escapeCell(step.title ?? step.id ?? 'unknown')} | ${escapeCell(step.phase ?? '-')} | ${escapeCell((step.itemIds ?? []).join(', ') || '-')} | ${escapeCell((step.prerequisites ?? []).join('<br>') || '-')} | ${escapeCell((step.blocks ?? []).join(', ') || '-')} | ${escapeCell(step.closeWhen ?? '-')} | ${escapeCell((step.stopIf ?? []).join('<br>') || '-')} |`),
    ];
}

function renderFinalApprovalItemPosture(): string[] {
    const manifest = finalApprovalQueueManifest?.data;
    const items = manifest?.items ?? [];
    if (items.length === 0) {
        return [
            'No final approval item posture is available. Run `pnpm launch:final-approval-queue`, then rerun `pnpm launch:status` before approving final-window writes.',
        ];
    }

    return [
        `Source: ${toRelative(finalApprovalQueueManifest?.file ?? '') || 'outputs/launch-final-approval-queue/<timestamp>/final-approval-queue-manifest.json'}`,
        `Approval Queue Status: ${manifest?.approvalQueueStatus ?? 'unknown'}`,
        '',
        'Items marked `must_wait` are blocked by prerequisites even when all local artifacts exist.',
        'Items marked `requires_exact_approval` still need explicit resource/action approval before any write.',
        'Items marked `human_input_required` need human-owned final values or review.',
        '',
        '| Item | Status | Wait Reason | Prerequisites | Blocks |',
        '| --- | --- | --- | --- | --- |',
        ...items.map((item) => `| ${escapeCell(item.title ?? item.id ?? 'unknown')} | ${escapeCell(item.status ?? 'unknown')} | ${escapeCell(item.waitReason ?? '-')} | ${escapeCell((item.prerequisiteItemIds ?? []).join(', ') || '-')} | ${escapeCell((item.finalBlockers ?? []).join(', ') || '-')} |`),
    ];
}

function strictQaBlockerClosureRow(blocker: Finding, paths: ClosureWorksheetPaths): string {
    const findingId = blocker.name ?? 'strict QA finding';
    const severity = detailValue(blocker.details, 'severity') || 'unknown';
    const type = detailValue(blocker.details, 'type') || 'unknown';
    const fix = detailValue(blocker.details, 'fix') || 'Use the canonical tracker finding fix guidance.';
    const closeItWith =
        findingId === 'ERR-QA-SUPABASE-PROCESSED-AT-DEFAULT-149'
            ? `pnpm launch:supabase-production-readonly-preflight; pnpm launch:supabase-production-rollout -- --through processed_at_small_fix --preflight outputs/launch-supabase-production-readonly-preflight/<timestamp>/summary.json; outputs/launch-supabase-production-rollout-runner/<timestamp>/summary.json; outputs/launch-supabase-production-rollout-runner/<timestamp>/wave-processed_at_small_fix-verify-readonly.sql; ${paths.supabaseProcessedAtReadonlyPreflight}; ${paths.supabaseProcessedAtAcceptedRiskPackage}; ${paths.supabaseProcessedAtAcceptedRiskDryRun}; outputs/019f1a5e-2745-7c43-870d-544e6ba4e0b1/strict-qa-v2/supabase-processed-at-default-approval-package.md; supabase/migrations/20260703211451_drop_processed_webhook_processed_at_default.sql`
            : fix;
    const evidenceMinimum =
        findingId === 'ERR-QA-SUPABASE-PROCESSED-AT-DEFAULT-149'
            ? 'Do not execute the retired legacy cleanup runner. Apply `processed_at_small_fix` through the source-bound production rollout, either alone or as the first of all 24 migrations, under its fresh exact approval. Then rerun the processed_at read-only preflight and require staging/production defaults NULL plus clean webhook aggregates. Only after that evidence exists, update strict-qa-results.json to Fixed, rebuild strict-qa-tracker-v2.xlsx and rerun pnpm launch:status. Explicit accepted risk remains a fallback only.'
            : 'Record fix or accepted-risk evidence in strict-qa-results.json, rebuild strict-qa-tracker-v2.xlsx and rerun pnpm launch:status.';

    return `| ${escapeCell(findingId)} | ${escapeCell(`${severity} / ${type}`)} | ${escapeCell(closeItWith)} | ${escapeCell(evidenceMinimum)} |`;
}

function detailValue(details: string[] | undefined, key: string): string | null {
    const prefix = `${key}=`;
    return details?.find((detail) => detail.startsWith(prefix))?.slice(prefix.length) ?? null;
}

function finalCheckGuidance(checkId: string, paths: ClosureWorksheetPaths): FinalCheckGuidance {
    switch (checkId) {
        case 'legal_owner_controller':
            return {
                what: 'Real legal owner/controller/subprocessor/cookie data must replace placeholders.',
                closeWith: `docs/launch/LEGAL_INPUTS_REQUIRED.md; ${paths.legalWorksheet}; ${paths.legalFinalInputsPackage}; ${paths.legalFinalInputsManifest}; ${paths.finalRunbook}`,
                evidenceMinimum: '`pnpm launch:legal` passes with real values and manual evidence points to the reviewed legal pages; the generated legal final inputs manifest shows zero owner/controller placeholders.',
                passSummary: 'Real owner/controller legal data applied to public legal pages and legal audit passes.',
                passEvidence: [
                    'path=docs/launch/LEGAL_INPUTS_REQUIRED.md',
                    `command_output=${paths.legalFinalInputsPackage}::current legal inputs package reviewed`,
                    `command_output=${paths.legalFinalInputsManifest}::placeholder inventory is zero after real data is applied`,
                    'command_output=outputs/launch-legal/<timestamp>/summary.md::pnpm launch:legal passes after real data is applied',
                    'manual_note=Reviewed public legal pages; no private identity documents stored in repo evidence',
                ],
                acceptedRisk: 'Do not use `accepted_risk` to publish with missing real owner/controller data. Keep this check pending until the public legal data is complete.',
            };
        case 'legal_human_review':
            return {
                what: 'A human must review the final legal pages, privacy/cookies posture and public legal copy.',
                closeWith: `docs/launch/LEGAL_INPUTS_REQUIRED.md; ${paths.legalWorksheet}; ${paths.legalFinalInputsPackage}; ${paths.manualEvidenceFile}`,
                evidenceMinimum: 'Reviewer/date/scope recorded without personal IDs or private documents; generated legal package reviewed; legal audit passes.',
                passSummary: 'Human review completed for privacy, cookies, terms, subprocessors and public legal copy.',
                passEvidence: [
                    'manual_note=Reviewer, date, scope and result recorded without private notes',
                    `command_output=${paths.legalFinalInputsPackage}::current legal review checklist and placeholder inventory reviewed`,
                    'command_output=outputs/launch-legal/<timestamp>/summary.md::legal audit result after review',
                    'path=docs/launch/FINAL_CLOSURE.md::final legal closure sequence followed',
                ],
                acceptedRisk: 'Use `accepted_risk` for legal review only if Alin explicitly accepts the residual legal risk and records a concrete rollback/mitigation plan.',
                riskSummary: 'Legal human review has a documented residual risk accepted by Alin for launch.',
                riskRationale: 'Alin has reviewed the legal scope, understands the unresolved legal-review limitation and accepts it as a launch risk.',
                rollbackPlan: 'Keep checkout or public launch paused, update legal pages, rerun pnpm launch:legal and notify affected users if legal wording must change after launch.',
                riskEvidence: [
                    'manual_note=Alin accepted a specific residual legal-review risk; no private advisor notes stored',
                    `command_output=${paths.legalFinalInputsPackage}::current legal package reviewed before risk acceptance`,
                    'path=docs/launch/FINAL_CLOSURE.md::accepted-risk path followed',
                ],
            };
        case 'payments_staging':
            return {
                what: 'The final payment posture must be explicit before checkout is public.',
                closeWith: `${paths.paymentsWorksheet}; ${paths.finalRunbook}`,
                evidenceMinimum: 'Document no-checkout/test/live decision plus checkout, webhook, subscription/payment, portal and reconciliation evidence as applicable. Use Stripe dashboard/checkout/webhook evidence if MCP listing is unavailable.',
                preflightDecisions: [
                    'Stripe evidence source: Stripe MCP list/search is not the source of truth if it cannot list products or prices.',
                    'Use Stripe dashboard, checkout event, webhook delivery and Supabase reconciliation evidence for final closure.',
                    'Do not block launch closure on MCP list output alone if dashboard evidence is complete.',
                ],
                passSummary: 'Payment posture verified for launch: Stripe test rehearsal complete, Stripe live ready for day-one payments and checkout rollback proven.',
                passEvidence: [
                    `command_output=${paths.paymentsWorksheet}::payments staging worksheet completed without secrets`,
                    'dashboard=Stripe dashboard reviewed with redacted/non-secret evidence only',
                    'manual_note=Checkout mode, webhook delivery, portal and reconciliation decision recorded; dashboard/checkout/webhook/Supabase evidence used if MCP listing was unavailable',
                ],
                acceptedRisk: 'If launching without real payments, prefer a clear `pass` with checkout disabled/hidden/blocked as evidence. Use `accepted_risk` only for a documented non-critical payment limitation.',
                riskSummary: 'A non-critical payment limitation is documented and accepted for launch.',
                riskRationale: 'The payment limitation does not expose users to unexpected charges or broken purchase entry points, and Alin accepts the remaining reconciliation/support risk.',
                rollbackPlan: 'Disable checkout entry points or set packages inactive, reconcile Stripe/Supabase manually and rerun pnpm launch:payments before accepting payments.',
                riskEvidence: [
                    'manual_note=Payment limitation and user impact reviewed by Alin',
                    'manual_note=Stripe evidence source reviewed; MCP listing limitation does not replace dashboard/checkout/webhook evidence',
                    `command_output=${paths.paymentsWorksheet}::payments worksheet documents the accepted limitation`,
                ],
            };
        case 'integration_readiness':
            return {
                what: 'Production-facing external services must be named, reachable, monitored and rollback-safe.',
                closeWith: `${paths.integrationWorksheet}; ${paths.integrationFinalPackage}; ${paths.integrationFinalManifest}; ${paths.integrationServiceMatrix}; ${paths.stripeWebhookCutoverPack}; ${paths.stripeWebhookCutoverRunner}; ${paths.turnstileDomainClosurePack}; ${paths.turnstileDomainClosureRunner}; ${paths.sentryTriagePack}; ${paths.sentryIssueTriageRunner}; ${paths.cloudflareDomainWorkerPreflight}; ${paths.cloudflareProductionRuntimeReadonly}; ${paths.cloudflareProductionRuntimeCutoverPreflight}; ${paths.cloudflareProductionWorkerVariableMatrix}; ${paths.cloudflareProductionRuntimeCutover}; ${paths.cloudflareProductionWorkerPhaseOneRunner}; ${paths.cloudflareProductionWorkerSecretsRunner}; ${paths.cloudflareProductionFulfillmentSecretsRunner}; ${paths.stagingSmokeRehearsalRunner}; ${paths.finalRunbook}`,
                evidenceMinimum: 'Generated integration final package and service evidence matrix reviewed; Cloudflare Pages-vs-Worker domain ownership, current Wrangler read-only snapshot, both production Workers, separate web/fulfillment secret-name posture, direct identity/version/Supabase attestations, cutover manifest, Supabase, Google, Resend, Turnstile, Sentry/log checks, staging smoke rehearsal and rollback baseline recorded without secrets.',
                preflightDecisions: [
                    'Run pnpm launch:integration-final-package after final-readiness and provider read-only evidence refreshes.',
                    'Use cloudflare-domain-worker-preflight.md, pnpm launch:cloudflare-production-runtime-readonly, pnpm launch:cloudflare-production-runtime-cutover-preflight, pnpm launch:cloudflare-production-runtime-cutover, pnpm launch:cloudflare-production-worker-phase1, pnpm launch:cloudflare-production-worker-secrets and pnpm launch:cloudflare-production-fulfillment-secrets before any domain write: web deploy, web secrets, fulfillment config/secrets/email, direct attestations and domain move are separate approval phases.',
                    'Run pnpm launch:staging-smoke-rehearsal-runner in plan mode before any staging lifecycle smoke; execute it only with exact STAGING_SMOKE_REHEARSAL_APPROVAL and --execute-approved.',
                    'Do not mark integration_readiness pass while espanolhonesto.com/www are still attached to the old Pages project or production Worker espanolhonesto is absent.',
                    'Decide whether Cloudflare legacy Worker espanol-honesto-reminders is disabled/deleted or documented as non-interfering.',
                    'Review Supabase Advisor findings: leaked password protection, btree_gist in public, production public.jobs legacy table and staging migration history.',
                    'Stripe evidence source must use dashboard/checkout/webhook evidence if MCP listing remains unavailable.',
                ],
                passSummary: 'Production integration readiness verified across Cloudflare, Supabase, Google, Resend, Turnstile, Sentry/logs and rollback baseline.',
                passEvidence: [
                    `command_output=${paths.integrationWorksheet}::integration readiness worksheet completed`,
                    `command_output=${paths.integrationFinalPackage}::integration final package reviewed`,
                    `command_output=${paths.integrationFinalManifest}::integration final manifest reviewed`,
                    `command_output=${paths.integrationServiceMatrix}::service evidence matrix completed`,
                    `command_output=${paths.sentryIssueTriageRunner}::Sentry issue triage runner summary reviewed; external write performed only under exact approval`,
                    `command_output=${paths.cloudflareDomainWorkerPreflight}::Cloudflare Pages-vs-Worker/domain preflight reviewed and final state verified`,
                    `command_output=${paths.cloudflareProductionRuntimeReadonly}::Cloudflare production runtime read-only evidence reviewed and final state verified`,
                    `command_output=${paths.cloudflareProductionRuntimeCutoverPreflight}::Cloudflare no-write build/dry-run preflight reviewed`,
                    `command_output=${paths.cloudflareProductionWorkerVariableMatrix}::Cloudflare production Worker variable matrix reviewed without secret values`,
                    `command_output=${paths.cloudflareProductionRuntimeCutover}::Cloudflare production runtime cutover manifest reviewed and phased evidence completed`,
                    `command_output=${paths.cloudflareProductionWorkerPhaseOneRunner}::Cloudflare phase-1 runner summary reviewed; external write performed only under exact approval`,
                    `command_output=${paths.cloudflareProductionWorkerSecretsRunner}::Cloudflare secret-name/direct-probe runner summary reviewed; external write performed only under exact approval`,
                    `command_output=${paths.cloudflareProductionFulfillmentSecretsRunner}::Cloudflare fulfillment config/secrets/email runner summary reviewed; no email or job writes in this phase`,
                    `command_output=${paths.stagingSmokeRehearsalRunner}::staging smoke rehearsal runner reviewed; external write performed only under exact approval`,
                    'dashboard=External dashboards checked with secrets redacted',
                    'manual_note=Final integration config, Cloudflare custom-domain Worker posture, Stripe live day-one payment posture, observability and rollback reviewed, including espanol-honesto-reminders, Supabase Advisor and Stripe evidence-source decisions',
                ],
                acceptedRisk: 'Use `accepted_risk` only for a specific non-critical integration limitation with owner, rationale, rollback plan and user impact.',
                riskSummary: 'A non-critical production integration limitation is documented and accepted for launch.',
                riskRationale: 'The integration limitation has a known owner, limited user impact and manual fallback, and does not compromise secrets or data boundaries.',
                rollbackPlan: 'Pause affected workflow, use the documented manual fallback, inspect logs, fix configuration and rerun pnpm launch:final-readiness plus pnpm launch:secondary-review.',
                riskEvidence: [
                    `command_output=${paths.integrationWorksheet}::integration worksheet documents the limitation`,
                    `command_output=${paths.integrationFinalPackage}::integration final package reviewed before risk acceptance`,
                    `command_output=${paths.integrationServiceMatrix}::specific provider limitation scoped`,
                    `command_output=${paths.cloudflareDomainWorkerPreflight}::Cloudflare domain/Worker limitation explicitly scoped if relevant`,
                    `command_output=${paths.cloudflareProductionRuntimeReadonly}::Cloudflare read-only runtime limitation explicitly scoped if relevant`,
                    `command_output=${paths.cloudflareProductionRuntimeCutoverPreflight}::Cloudflare build/dry-run limitation explicitly scoped if relevant`,
                    `command_output=${paths.cloudflareProductionRuntimeCutover}::Cloudflare production runtime cutover limitation explicitly scoped if relevant`,
                    `command_output=${paths.cloudflareProductionWorkerPhaseOneRunner}::Cloudflare phase-1 runner limitation explicitly scoped if relevant`,
                    `command_output=${paths.cloudflareProductionWorkerSecretsRunner}::Cloudflare secret-name/direct-probe runner limitation explicitly scoped if relevant`,
                    `command_output=${paths.stagingSmokeRehearsalRunner}::staging smoke rehearsal limitation explicitly scoped if relevant`,
                    'manual_note=Cloudflare Pages-vs-Worker, legacy Worker, Supabase Advisor, staging migration-history or Stripe evidence-source limitation explicitly scoped',
                    'manual_note=Owner, impact, fallback and monitoring path recorded',
                ],
            };
        case 'seo_llm_final':
            return {
                what: 'Search, LLM and public Russian typography surfaces must be checked after final copy, legal pages, domain and payment mode settle.',
                closeWith: `docs/launch/SEO_LLM_FINAL.md; ${paths.seoWorksheet}; ${paths.liveDomainReadonlySummary}; ${paths.seoLlmFinalPackage}; ${paths.seoLlmFinalManifest}; ${paths.seoLlmDomainParityGap}; ${paths.cloudflareDomainWorkerPreflight}; ${paths.cloudflareProductionRuntimeReadonly}; ${paths.cloudflareProductionRuntimeCutoverPreflight}; ${paths.cloudflareProductionRuntimeCutover}; ${paths.cloudflareProductionWorkerPhaseOneRunner}; ${paths.cloudflareProductionWorkerSecretsRunner}`,
                evidenceMinimum: 'Final live-domain probe must show espanolhonesto.com/www serving the modern Worker build rather than old Pages; generated SEO/LLM package must show domain parity or a scoped accepted risk; sitemap, robots, canonical/hreflang, structured data, snippets, llms.txt, premium Russian font/Cyrillic rendering decision and Search Console/CWV or accepted-risk notes recorded.',
                preflightDecisions: [
                    'Run pnpm launch:seo-llm-final-package after launch:seo and live-domain read-only evidence.',
                    'Do not close seo_llm_final if domain-parity-gap.md still shows old Pages/incomplete modern route evidence unless Alin accepts that exact risk.',
                    'Do not store Search Console tokens, analytics exports, commercial font files, invoices or private screenshots in repo evidence.',
                ],
                passSummary: 'SEO/LLM final review completed after final domain, copy, legal pages, payment mode and Cyrillic typography decision settled.',
                passEvidence: [
                    `command_output=${paths.seoWorksheet}::SEO/LLM final worksheet completed`,
                    `command_output=${paths.seoLlmFinalPackage}::SEO/LLM final package reviewed`,
                    `command_output=${paths.seoLlmFinalManifest}::SEO/LLM final manifest reviewed`,
                    `command_output=${paths.seoLlmDomainParityGap}::domain parity gap resolved or explicitly accepted`,
                    `command_output=${paths.cloudflareDomainWorkerPreflight}::Cloudflare production custom domains verified against the modern Worker build`,
                    `command_output=${paths.cloudflareProductionRuntimeReadonly}::Cloudflare production runtime read-only evidence verified after final domain move`,
                    `command_output=${paths.cloudflareProductionRuntimeCutoverPreflight}::Cloudflare build/dry-run preflight verified before final domain move`,
                    `command_output=${paths.cloudflareProductionRuntimeCutover}::Cloudflare production runtime/domain cutover phases completed before SEO/LLM closure`,
                    `command_output=${paths.cloudflareProductionWorkerPhaseOneRunner}::Cloudflare phase-1 runner evidence reviewed before final domain move`,
                    `command_output=${paths.cloudflareProductionWorkerSecretsRunner}::Cloudflare secret-name/direct-probe runner evidence reviewed before final domain move`,
                    `command_output=${paths.liveDomainReadonlySummary}::live production domain probe passes or specific warnings are accepted`,
                    'path=docs/launch/SEO_LLM_FINAL.md',
                    'manual_note=Live domain serves modern Worker surface; Search Console/CWV/snippets/llms.txt/private-route exclusion and premium Russian font/Cyrillic rendering reviewed or explicitly risk-accepted',
                ],
                acceptedRisk: 'Search Console, Core Web Vitals or current Russian font fallback can be `accepted_risk` only if unavailable/unresolved at launch and Alin records the reason plus post-launch follow-up.',
                riskSummary: 'An SEO/LLM final signal is unavailable at launch and accepted with post-launch follow-up.',
                riskRationale: 'The unavailable signal is not a private-indexing failure and the Russian text remains legible; live-domain probe results, public robots, sitemap, canonical/hreflang, JSON-LD, llms.txt and `/ru` rendering have been reviewed.',
                rollbackPlan: 'Keep a post-launch SEO/font follow-up, inspect Search Console/CWV when available, license or replace the font if needed, fix indexing/snippet issues and rerun pnpm launch:live-domain-readonly plus pnpm launch:seo.',
                riskEvidence: [
                    `command_output=${paths.seoWorksheet}::SEO/LLM worksheet documents unavailable signal`,
                    `command_output=${paths.seoLlmFinalPackage}::SEO/LLM package reviewed before risk acceptance`,
                    `command_output=${paths.seoLlmDomainParityGap}::specific domain/Search Console/CWV/font gap scoped`,
                    `command_output=${paths.liveDomainReadonlySummary}::live-domain probe documents pass or accepted warning`,
                    'path=docs/launch/SEO_LLM_FINAL.md',
                    'manual_note=Alin accepted Search Console/CWV or current Cyrillic fallback timing risk with post-launch follow-up',
                ],
            };
        case 'final_smoke':
            return {
                what: 'A final end-to-end product pass must prove the public and campus flows still work.',
                closeWith: `${paths.finalSmokeWorksheet}; ${paths.finalSmokeExecutionPack}; ${paths.finalSmokeExecutionApproval}; ${paths.finalSmokeExecutionManifest}; ${paths.stagingSmokeRehearsalRunner}; ${paths.stagingSmokeRehearsalApprovalGate}; ${paths.finalRunbook}`,
                evidenceMinimum: 'Fresh public, auth, campus, support, admin, fulfillment, payment/no-payment and `/ru` visual smoke evidence recorded; staging rehearsal may provide pre-final provider proof but does not close final smoke; write-capable final smoke must have exact approval, preflight, rollback and redacted output evidence.',
                preflightDecisions: [
                    'Run pnpm launch:staging-smoke-rehearsal-runner in plan mode, and execute it only if exact staging approval is present; do not treat staging rehearsal as production final-smoke pass evidence.',
                    'Run pnpm launch:final-smoke-execution-pack before any write-capable smoke.',
                    'Use SMOKE_EXTERNAL_WRITES_CONFIRMATION=writes-ok:<host> only for the exact SMOKE_BASE_URL host.',
                    'Do not run production smoke until runtime/domain/payment/legal posture is final enough for launch-day evidence.',
                ],
                passSummary: 'Final smoke completed for public, auth, campus, support, admin, fulfillment, payment/no-payment and Russian rendering flows.',
                passEvidence: [
                    `command_output=${paths.finalSmokeWorksheet}::final smoke worksheet completed`,
                    `command_output=${paths.finalSmokeExecutionPack}::local-only final smoke execution pack reviewed`,
                    `command_output=${paths.finalSmokeExecutionApproval}::exact write-capable smoke approval reviewed before run`,
                    `command_output=${paths.finalSmokeExecutionManifest}::final smoke manifest confirms package did not run writes and documents approval boundary`,
                    `command_output=${paths.stagingSmokeRehearsalRunner}::staging rehearsal runner reviewed separately from final smoke`,
                    'command_output=outputs/real-env-smoke/<timestamp>/summary.md::redacted real environment smoke output after approved run',
                    'manual_note=Fresh launch-day smoke passed with routes and account types covered',
                    'screenshot=outputs/launch-user-evidence/<date>/final-smoke-redacted.png::redacted representative evidence',
                ],
                acceptedRisk: 'Do not skip final smoke silently. Use `accepted_risk` only for a scoped smoke gap with rollback plan and explicit Alin signoff.',
                riskSummary: 'A scoped final-smoke gap is accepted with explicit rollback and owner.',
                riskRationale: 'The untested smoke area is scoped, has a known manual fallback and does not hide a known broken critical flow.',
                rollbackPlan: 'Pause launch or disable the affected entry point, run the missing smoke path, fix the issue and rerun pnpm launch:final-readiness plus pnpm launch:gate.',
                riskEvidence: [
                    `command_output=${paths.finalSmokeWorksheet}::final smoke worksheet identifies the scoped gap`,
                    `command_output=${paths.finalSmokeExecutionPack}::execution pack identifies the approval boundary and rollback plan for the scoped gap`,
                    `command_output=${paths.stagingSmokeRehearsalRunner}::staging rehearsal scope and limits reviewed before risk acceptance`,
                    'manual_note=Alin accepted the scoped smoke gap and rollback plan',
                ],
            };
        default:
            return {
                what: 'Final-only launch evidence is still open.',
                closeWith: `${paths.manualEvidenceNextActions}; ${paths.finalRunbook}`,
                evidenceMinimum: 'Record non-secret evidence and rerun the relevant launch audit.',
                passSummary: 'Final launch evidence recorded for this check.',
                passEvidence: [
                    `command_output=${paths.manualEvidenceNextActions}::manual evidence action plan followed`,
                    'manual_note=Final-only check reviewed and closed without secrets',
                ],
                acceptedRisk: 'Use `accepted_risk` only with explicit owner, concrete rationale and rollback plan.',
                riskSummary: 'A final-only launch risk is explicitly accepted by Alin.',
                riskRationale: 'The remaining limitation is scoped, non-secret, non-critical and has a documented owner and follow-up.',
                rollbackPlan: 'Use the documented rollback path, pause affected workflow and rerun the relevant launch audit after remediation.',
                riskEvidence: [
                    `command_output=${paths.manualEvidenceNextActions}::manual evidence action plan reviewed`,
                    'manual_note=Accepted risk recorded with owner, rationale and rollback plan',
                ],
            };
    }
}

function manualEvidencePassCommand(checkId: string, guide: FinalCheckGuidance): string {
    const args = [
        'pnpm launch:manual-evidence:record --',
        `--id ${shellQuote(checkId)}`,
        '--status pass',
        `--summary ${shellQuote(guide.passSummary)}`,
        '--environment production',
        '--owner Alin',
        ...guide.passEvidence.map((evidence) => `--evidence ${shellQuote(evidence)}`),
    ];

    return args.join(' ');
}

function manualEvidenceAcceptedRiskCommand(checkId: string, guide: FinalCheckGuidance): string {
    const args = [
        'pnpm launch:manual-evidence:record --',
        `--id ${shellQuote(checkId)}`,
        '--status accepted_risk',
        `--summary ${shellQuote(guide.riskSummary ?? `Accepted risk recorded for ${checkId}.`)}`,
        '--environment production',
        '--owner Alin',
        `--risk-accepted-by ${shellQuote('Alin')}`,
        `--risk-rationale ${shellQuote(guide.riskRationale ?? 'Alin accepts this scoped launch risk with a documented follow-up.')}`,
        `--rollback-plan ${shellQuote(guide.rollbackPlan ?? 'Pause the affected launch path, remediate the issue and rerun the relevant launch audit.')}`,
        ...(guide.riskEvidence ?? ['manual_note=Accepted risk recorded by Alin without secrets']).map((evidence) => `--evidence ${shellQuote(evidence)}`),
    ];

    return args.join(' ');
}

function shellQuote(value: string): string {
    return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function sourcePath(statusReport: StatusReport, label: string): string {
    return toRelative(statusReport.sources.find((source) => source.label === label)?.path ?? null) || 'missing';
}

function latestGeneratedPath(folderName: string, fileName: string): string | null {
    const directory = findLatestEvidenceDir(folderName, fileName)
        ?? findLatestEvidenceDir(folderName, 'summary.json')
        ?? findLatestEvidenceDir(folderName, 'summary.md');
    return directory ? path.join(directory, fileName) : null;
}

function readIfExists(file: string): string {
    return existsSync(file) ? readFileSync(file, 'utf8') : '';
}

function uniqueList(values: string[]): string[] {
    return Array.from(new Set(values));
}

function toRelative(file: string | null): string {
    if (!file) return '';
    return path.relative(process.cwd(), file).replace(/\\/g, '/');
}

function toSummaryMarkdownPath(file: string | null): string | null {
    if (!file) return null;
    if (file.endsWith(`${path.sep}summary.json`) || file.endsWith('/summary.json')) {
        return file.replace(/summary\.json$/, 'summary.md');
    }
    if (file.endsWith(`${path.sep}secondary-review.json`) || file.endsWith('/secondary-review.json')) {
        return file.replace(/secondary-review\.json$/, 'secondary-review.md');
    }
    return file;
}

function renderPhaseCategory(category: ManualEvidencePhaseCategory): string {
    switch (category) {
        case 'work_now':
            return 'Trabajo inmediato';
        case 'release_candidate':
            return 'Release candidate';
        case 'final_only':
            return 'Cierre final deliberado';
        default:
            return 'Sin categoria';
    }
}

function renderListValue(values: string[]): string {
    return values.length > 0 ? values.join(', ') : '-';
}

function stamp(date: Date): string {
    return date.toISOString().replace(/[:.]/g, '-');
}

function escapeCell(value: string): string {
    return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}
