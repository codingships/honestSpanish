import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import {
    PRODUCTION_AUTH_INERT_RECEIPT_MAX_AGE_MS,
    PRODUCTION_AUTH_INERT_RECEIPT_KIND,
    validateProductionAuthInertReceipt,
} from './supabase-auth-config-shared';
import {
    PRODUCTION_AVAILABILITY_SLOTS,
    PRODUCTION_AVAILABILITY_TARGET,
    validateFinalAuthPolicyReceipt,
} from './production-availability-shared';
import {
    PRODUCTION_PROJECT,
    STAGING_ONLY_VERSIONS,
} from './supabase-production-rollout-shared';
import {
    PRODUCTION_ROLLOUT_MIGRATIONS,
    productionRolloutAllowlistSha256,
    productionRolloutMigrationManifestSha256,
} from './supabase-production-rollout-runner-shared';
import { findUnresolvedWorkerWriteCheckpoints } from './cloudflare-production-worker-safety';
import {
    validateCloudflareProductionInertCompositeEvidence,
    type CloudflareProductionInertCompositeEvidence,
} from './cloudflare-production-inert-composite-evidence';
import {
    CLOUDFLARE_PRODUCTION_EVIDENCE_MAX_AGE_MS,
    validateCloudflareRuntimeReadonlyInertAttestation,
    type CloudflareProductionSourceIdentity,
} from './cloudflare-production-evidence';
import { PRODUCTION_QUEUE_TARGET } from './cloudflare-production-queue-shared';
import {
    PRODUCTION_INERT_FINAL_ATTEMPT_FILE,
    PRODUCTION_INERT_FINAL_OUTPUT_FILE,
    PRODUCTION_INERT_FINAL_STATUS,
    validateProductionInertFinalAttemptSummary,
    validateProductionInertFinalReceipt,
    type ProductionInertFinalAttemptSummary,
    type ProductionInertFinalReceipt,
} from './production-inert-final-readonly-shared';

export const RC_PRODUCTION_INERT_BLOCKER_ID = 'production_inert_preparation' as const;
export const RC_FOUNDATIONAL_EVIDENCE_MAX_AGE_MS = Number.POSITIVE_INFINITY;

export type RcProductionInertRequirementId =
    | 'cloudflare_bootstrap_hmac'
    | 'supabase_production_rollout'
    | 'supabase_auth_finalized'
    | 'supabase_production_availability'
    | 'supabase_auth_inert_after_preparation';

export interface RcProductionInertRequirement {
    id: RcProductionInertRequirementId;
    status: 'closed' | 'open';
    reason: string;
    evidencePath: string | null;
}

export type RcProductionInertRenewableReadbackId =
    | 'cloudflare_runtime_readback'
    | 'supabase_inert_final_readback';

export interface RcProductionInertRenewableReadback {
    id: RcProductionInertRenewableReadbackId;
    status: 'fresh' | 'refresh_required' | 'unavailable';
    reason: string;
    evidencePath: string | null;
    observedAt: string | null;
    expiresAt: string | null;
    requiredBefore: 'external_write';
}

export interface RcProductionInertAssessment {
    ready: boolean;
    blocker: {
        id: typeof RC_PRODUCTION_INERT_BLOCKER_ID;
        line: string;
    } | null;
    requirements: RcProductionInertRequirement[];
    renewableReadbacks: RcProductionInertRenewableReadback[];
    refreshRequiredBeforeExternalWrite: boolean;
    cloudflareResolution:
        | 'closed'
        | 'readback_only'
        | 'historical_closure_required'
        | 'write_state_reconciliation_required';
    sourcePath: string | null;
    latestEvidenceAt: string | null;
}

interface JsonCandidate<T = unknown> {
    file: string;
    sha256: string;
    value: T;
}

interface ProductionRolloutReceipt {
    completedAt: string;
    authInertEvidenceSha256: string;
    backupReceiptSha256: string;
    publicCleanupReceiptSha256: string;
    authReducedQuarantinedReceiptSha256: string;
    preservationPolicySha256: string;
}

interface PublicCleanupReceipt {
    completedAt: string;
    preservationPolicySha256: string;
}

interface FinalAuthPolicyReceipt {
    closedAt: string;
    productionRolloutReceiptSha256: string;
    backupReceiptSha256: string;
    publicCleanupReceiptSha256: string;
    authReducedReceiptSha256: string;
    preservedSetSha256: string;
    preservedRoleBindingSha256: string;
}

interface FinalSupabaseCaptureAttempt {
    directory: string;
    summary: JsonCandidate<ProductionInertFinalAttemptSummary> | null;
    receipt: JsonCandidate<ProductionInertFinalReceipt> | null;
}

interface ProductionAvailabilityReceipt {
    verifiedAt: string;
    authPolicyReceiptSha256: string;
}

interface ProductionAuthInertReceipt {
    observedAt: string;
}

interface CloudflareRuntimeReadonlyReceipt {
    startedAt: string;
    endedAt: string;
}

interface LatestAttempt<T> {
    candidate: JsonCandidate<T> | null;
    attemptDirectory: string | null;
    invalidAttempt: boolean;
}

const futureClockSkewMs = 5 * 60 * 1_000;
const sha256Pattern = /^[a-f0-9]{64}$/u;
const cloudflarePlanOnlyWithheldNames = [
    'PUBLIC_SUPABASE_URL',
    'PUBLIC_SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
    'PUBLIC_STRIPE_PUBLISHABLE_KEY',
    'STRIPE_SECRET_KEY',
    'STRIPE_WEBHOOK_SECRET',
    'STRIPE_EXPECTED_ACCOUNT_ID',
    'STRIPE_PORTAL_CONFIGURATION_ID',
    'RESEND_API_KEY',
    'EMAIL_FROM',
    'RESEND_FROM_EMAIL',
    'EMAIL_RECIPIENT_ALLOWLIST',
    'PUBLIC_TURNSTILE_SITE_KEY',
    'TURNSTILE_SECRET_KEY',
    'CRON_SECRET',
    'LEVEL_CHECK_TOKEN_SECRET',
    'PUBLIC_SENTRY_DSN',
    'SENTRY_DSN',
    'SENTRY_AUTH_TOKEN',
];

const evidenceLocations = {
    cloudflare: [
        'launch-cloudflare-production-worker-bootstrap-secrets',
        'production-inert-web-fulfillment-evidence.json',
    ],
    cloudflareRuntime: ['launch-cloudflare-production-runtime-readonly', 'summary.json'],
    publicCleanup: ['launch-production-fixture-cleanup', 'public-cleanup-receipt.json'],
    rollout: ['launch-supabase-production-rollout-runner', 'production-rollout-receipt.json'],
    authPolicy: ['launch-supabase-production-auth-cleanup', 'auth-policy-receipt.json'],
    authInert: ['launch-supabase-auth-config-preflight', 'auth-inert-receipt.json'],
    availability: ['launch-production-availability', 'production-availability-receipt.json'],
    finalSupabase: ['launch-production-inert-final-readonly', 'production-inert-final-receipt.json'],
} as const;

export function assessRcProductionInertEvidence(
    outputsRoot = path.join(process.cwd(), 'outputs'),
    now = new Date(),
    currentCloudflareSourceIdentity?: CloudflareProductionSourceIdentity,
): RcProductionInertAssessment {
    const workspaceRoot = path.dirname(path.resolve(outputsRoot));
    const cloudflareAttemptSelection = readLatestCloudflareCompositeAttempt(outputsRoot);
    const latestCloudflareAttempt = cloudflareAttemptSelection.candidate
        && isRecord(cloudflareAttemptSelection.candidate.value)
        && cloudflareAttemptSelection.candidate.value.stage === 'web_hmac_closed'
        && typeof cloudflareAttemptSelection.candidate.value.generatedAt === 'string'
        && Number.isFinite(Date.parse(cloudflareAttemptSelection.candidate.value.generatedAt))
        ? {
            ...cloudflareAttemptSelection.candidate,
            value: cloudflareAttemptSelection.candidate.value as unknown as CloudflareProductionInertCompositeEvidence,
        }
        : null;
    const latestAcceptedCloudflareClosure = latestCloudflareAttempt
        && validateCloudflareProductionInertCompositeEvidence(latestCloudflareAttempt.value, {
            workspaceRoot,
            now: new Date(latestCloudflareAttempt.value.generatedAt),
        }).valid
        ? latestCloudflareAttempt
        : null;
    const cloudflareRuntimeAttemptSelection = readLatestJsonAttempt<CloudflareRuntimeReadonlyReceipt>(
        outputsRoot,
        ...evidenceLocations.cloudflareRuntime,
    );
    const latestCloudflareRuntimeAttempt = cloudflareRuntimeAttemptSelection.candidate
        && isRecord(cloudflareRuntimeAttemptSelection.candidate.value)
        && typeof cloudflareRuntimeAttemptSelection.candidate.value.startedAt === 'string'
        && Number.isFinite(Date.parse(cloudflareRuntimeAttemptSelection.candidate.value.startedAt))
        && typeof cloudflareRuntimeAttemptSelection.candidate.value.endedAt === 'string'
        && Number.isFinite(Date.parse(cloudflareRuntimeAttemptSelection.candidate.value.endedAt))
        ? {
            ...cloudflareRuntimeAttemptSelection.candidate,
            value: cloudflareRuntimeAttemptSelection.candidate.value as unknown as CloudflareRuntimeReadonlyReceipt,
        }
        : null;
    const latestAcceptedCloudflareRuntime = latestAcceptedCloudflareClosure
        && latestCloudflareRuntimeAttempt
        && timestampIsHistoricallyUsable(latestCloudflareRuntimeAttempt.value.endedAt, now)
        && validateCloudflareRuntimeReadonlyInertAttestation(
            latestCloudflareRuntimeAttempt.value,
            {
                accountId: latestAcceptedCloudflareClosure.value.target.accountId,
                productionWorker: latestAcceptedCloudflareClosure.value.target.webWorker,
                pagesProject: 'espanolhonesto',
                customDomains: ['espanolhonesto.com', 'www.espanolhonesto.com'],
            },
            {
                observedAfter: latestAcceptedCloudflareClosure.value.generatedAt,
                webWorker: latestAcceptedCloudflareClosure.value.target.webWorker,
                webVersionId: latestAcceptedCloudflareClosure.value.web.versionId,
                fulfillmentWorker: latestAcceptedCloudflareClosure.value.target.fulfillmentWorker,
                fulfillmentVersionId: latestAcceptedCloudflareClosure.value.fulfillment.versionId,
                productionQueue: PRODUCTION_QUEUE_TARGET.queue,
                productionQueueId: PRODUCTION_QUEUE_TARGET.queueId,
                productionDeadLetterQueue: PRODUCTION_QUEUE_TARGET.deadLetterQueue,
                productionDeadLetterQueueId: PRODUCTION_QUEUE_TARGET.deadLetterQueueId,
            },
            new Date(latestCloudflareRuntimeAttempt.value.endedAt),
            currentCloudflareSourceIdentity,
        ).valid
        ? latestCloudflareRuntimeAttempt
        : null;
    const cloudflareWriteStateOpen = hasAnyOpenCloudflareWriteState(
        outputsRoot,
        latestCloudflareRuntimeAttempt?.value.startedAt
            ?? latestAcceptedCloudflareClosure?.value.generatedAt
            ?? '1970-01-01T00:00:00.000Z',
    );
    const cloudflare = cloudflareWriteStateOpen ? null : latestAcceptedCloudflareRuntime;
    const cloudflareResolution: RcProductionInertAssessment['cloudflareResolution'] = cloudflare
        ? 'closed'
        : cloudflareWriteStateOpen
            ? 'write_state_reconciliation_required'
            : latestAcceptedCloudflareClosure
                ? 'readback_only'
                : 'historical_closure_required';

    const authInertArtifacts = readJsonCandidates(outputsRoot, ...evidenceLocations.authInert);
    const historicalAuthInertCandidates = validCandidates<ProductionAuthInertReceipt>(
        authInertArtifacts,
        (value) => validateHistoricalAuthInertReceipt(value, now),
    );
    const authInertBySha = new Map(historicalAuthInertCandidates.map((candidate) => [candidate.sha256, candidate]));

    const publicCleanupCandidates = validCandidates<PublicCleanupReceipt>(
        readJsonCandidates(outputsRoot, ...evidenceLocations.publicCleanup),
        (value) => validatePublicCleanupReceipt(value, now),
    );
    const publicCleanupBySha = new Map(publicCleanupCandidates.map((candidate) => [candidate.sha256, candidate]));

    const rolloutAttempts = timestampedCandidates<ProductionRolloutReceipt>(
        readJsonCandidates(outputsRoot, ...evidenceLocations.rollout),
        'completedAt',
    );
    const latestRolloutAttempt = newest(rolloutAttempts, (value) => value.completedAt);
    const latestRolloutReceipt = latestRolloutAttempt
        && validateProductionRolloutReceipt(latestRolloutAttempt.value, now).length === 0
        ? latestRolloutAttempt
        : null;
    const rollout = latestRolloutReceipt && (() => {
        const linkedAuth = authInertBySha.get(latestRolloutReceipt.value.authInertEvidenceSha256);
        const linkedCleanup = publicCleanupBySha.get(latestRolloutReceipt.value.publicCleanupReceiptSha256);
        return linkedAuth !== undefined
            && linkedCleanup !== undefined
            && latestRolloutReceipt.value.preservationPolicySha256 === linkedCleanup.value.preservationPolicySha256
            && Date.parse(linkedAuth.value.observedAt) <= Date.parse(latestRolloutReceipt.value.completedAt) + futureClockSkewMs
            && Date.parse(latestRolloutReceipt.value.completedAt) - Date.parse(linkedAuth.value.observedAt)
                <= PRODUCTION_AUTH_INERT_RECEIPT_MAX_AGE_MS
            && Date.parse(linkedCleanup.value.completedAt) <= Date.parse(latestRolloutReceipt.value.completedAt) + futureClockSkewMs
            ? latestRolloutReceipt
            : null;
    })();

    const authPolicyAttempts = timestampedCandidates<FinalAuthPolicyReceipt>(
        readJsonCandidates(outputsRoot, ...evidenceLocations.authPolicy),
        'closedAt',
    );
    const latestAuthPolicyAttempt = newest(authPolicyAttempts, (value) => value.closedAt);
    const authPolicy = latestAuthPolicyAttempt
        && validateAuthPolicyReceipt(latestAuthPolicyAttempt.value, now).length === 0
        && rollout !== null
        && latestAuthPolicyAttempt.value.productionRolloutReceiptSha256 === rollout.sha256
        && latestAuthPolicyAttempt.value.backupReceiptSha256 === rollout.value.backupReceiptSha256
        && latestAuthPolicyAttempt.value.publicCleanupReceiptSha256 === rollout.value.publicCleanupReceiptSha256
        && latestAuthPolicyAttempt.value.authReducedReceiptSha256
            === rollout.value.authReducedQuarantinedReceiptSha256
        && Date.parse(latestAuthPolicyAttempt.value.closedAt) >= Date.parse(rollout.value.completedAt)
        ? latestAuthPolicyAttempt
        : null;

    const availabilityAttempts = timestampedCandidates<ProductionAvailabilityReceipt>(
        readJsonCandidates(outputsRoot, ...evidenceLocations.availability),
        'verifiedAt',
    );
    const latestAvailabilityAttempt = newest(availabilityAttempts, (value) => value.verifiedAt);
    const availability = latestAvailabilityAttempt
        && validateProductionAvailabilityReceipt(latestAvailabilityAttempt.value, now).length === 0
        && authPolicy !== null
        && latestAvailabilityAttempt.value.authPolicyReceiptSha256 === authPolicy.sha256
        && Date.parse(latestAvailabilityAttempt.value.verifiedAt) >= Date.parse(authPolicy.value.closedAt)
        ? latestAvailabilityAttempt
        : null;

    const finalSupabaseAttempts = readFinalSupabaseCaptureAttempts(outputsRoot);
    const latestFinalSupabaseAttempt = finalSupabaseAttempts[0] ?? null;
    const latestFinalSupabaseSummary = latestFinalSupabaseAttempt?.summary ?? null;
    const latestFinalSupabaseReceipt = latestFinalSupabaseAttempt?.receipt ?? null;
    const finalSupabaseHistoricalClock = latestFinalSupabaseSummary
        && latestFinalSupabaseReceipt
        ? historicalValidationClock([
            latestFinalSupabaseSummary.value.finishedAt,
            latestFinalSupabaseReceipt.value.observedAt,
        ], now)
        : null;
    const finalSupabase = latestFinalSupabaseSummary
        && latestFinalSupabaseReceipt
        && finalSupabaseHistoricalClock
        && validateProductionInertFinalAttemptSummary(
            latestFinalSupabaseSummary.value,
            finalSupabaseHistoricalClock,
        ).length === 0
        && latestFinalSupabaseSummary.value.status === PRODUCTION_INERT_FINAL_STATUS
        && latestFinalSupabaseSummary.value.receiptSha256 === latestFinalSupabaseReceipt.sha256
        && latestFinalSupabaseSummary.value.receiptFile === PRODUCTION_INERT_FINAL_OUTPUT_FILE
        && latestFinalSupabaseSummary.value.receiptObservedAt === latestFinalSupabaseReceipt.value.observedAt
        && latestFinalSupabaseSummary.value.receiptExpiresAt === latestFinalSupabaseReceipt.value.expiresAt
        && validateProductionInertFinalReceipt(
            latestFinalSupabaseReceipt.value,
            finalSupabaseHistoricalClock,
        ).length === 0
        && rollout !== null
            && authPolicy !== null
            && availability !== null
            && latestFinalSupabaseReceipt.value.rolloutReceiptSha256 === rollout.sha256
            && latestFinalSupabaseReceipt.value.authPolicyReceiptSha256 === authPolicy.sha256
            && latestFinalSupabaseReceipt.value.availabilityReceiptSha256 === availability.sha256
            && latestFinalSupabaseReceipt.value.preservedSetSha256 === authPolicy.value.preservedSetSha256
            && latestFinalSupabaseReceipt.value.preservedRoleBindingSha256
                === authPolicy.value.preservedRoleBindingSha256
            && Date.parse(latestFinalSupabaseReceipt.value.observedAt) >= Date.parse(availability.value.verifiedAt)
        ? latestFinalSupabaseReceipt
        : null;

    const requirements: RcProductionInertRequirement[] = [
        requirement(
            'cloudflare_bootstrap_hmac',
            cloudflare,
            'The immutable Cloudflare HMAC closure is bound to a historically valid GET-only readback of the exact inert web and fulfillment versions.',
            cloudflareWriteStateOpen
                ? 'Cloudflare web bootstrap HMAC has a pending checkpoint or lock, or a resolved checkpoint newer than the accepted closure, requiring read-only reconciliation.'
                : latestAcceptedCloudflareClosure === null
                    ? cloudflareAttemptSelection.invalidAttempt
                        ? 'The latest Cloudflare bootstrap HMAC attempt is incomplete, malformed or lacks its immutable closure.'
                        : 'No valid executed-and-attested Cloudflare production bootstrap HMAC closure was found.'
                    : latestCloudflareRuntimeAttempt === null
                        ? cloudflareRuntimeAttemptSelection.invalidAttempt
                            ? 'The latest Cloudflare production GET-only readback attempt is incomplete or malformed.'
                            : 'No Cloudflare production GET-only runtime readback was found after the immutable HMAC closure.'
                        : 'The latest Cloudflare production GET-only readback is invalid or does not match the immutable HMAC versions exactly.',
        ),
        requirement(
            'supabase_production_rollout',
            rollout,
            'Supabase production rollout is fully applied, verified, checkout-off and bound to Auth-inert plus the exact public-cleanup preservation policy.',
            rolloutAttempts.length > 0
                ? 'A rollout receipt exists, but it is not bound to the canonical Auth-inert and public-cleanup receipts it names.'
                : 'No exact 25-migration production rollout receipt was found.',
        ),
        requirement(
            'supabase_auth_finalized',
            authPolicy,
            'Supabase Auth is finalized to exactly admin + teacher with sessions invalidated and no reset email.',
            'No final Auth policy receipt bound to the completed production rollout was found.',
        ),
        requirement(
            'supabase_production_availability',
            availability,
            'Production availability is exactly Monday-Friday 09:00-18:00 Europe/Madrid and bound to final Auth.',
            'No exact five-row production availability receipt bound to final Auth was found.',
        ),
        requirement(
            'supabase_auth_inert_after_preparation',
            finalSupabase,
            'A completed final read-only sandwich proves the exact database state plus disable_signup=true and mailer_autoconfirm=false.',
            'No valid final Supabase/Auth read-only receipt bound to rollout, final Auth and availability was found.',
        ),
    ];
    const cloudflareExpiresAt = cloudflare
        ? new Date(
            Date.parse(cloudflare.value.endedAt) + CLOUDFLARE_PRODUCTION_EVIDENCE_MAX_AGE_MS,
        ).toISOString()
        : null;
    const renewableReadbacks: RcProductionInertRenewableReadback[] = [
        {
            id: 'cloudflare_runtime_readback',
            status: cloudflare
                ? now.getTime() <= Date.parse(cloudflareExpiresAt as string)
                    ? 'fresh'
                    : 'refresh_required'
                : 'unavailable',
            reason: cloudflare
                ? now.getTime() <= Date.parse(cloudflareExpiresAt as string)
                    ? 'The exact inert Cloudflare runtime readback remains inside its operational freshness window.'
                    : 'The historical Cloudflare closure remains valid, but its GET-only runtime readback must be renewed before any external write.'
                : 'No exact historical Cloudflare runtime readback is available; this is an RC blocker, not a freshness-only warning.',
            evidencePath: cloudflare?.file ?? null,
            observedAt: cloudflare?.value.endedAt ?? null,
            expiresAt: cloudflareExpiresAt,
            requiredBefore: 'external_write',
        },
        {
            id: 'supabase_inert_final_readback',
            status: finalSupabase
                ? now.getTime() <= Date.parse(finalSupabase.value.expiresAt)
                    ? 'fresh'
                    : 'refresh_required'
                : 'unavailable',
            reason: finalSupabase
                ? now.getTime() <= Date.parse(finalSupabase.value.expiresAt)
                    ? 'The exact inert Supabase DB/Auth readback remains inside its operational freshness window.'
                    : 'The historical Supabase closure remains valid, but its read-only DB/Auth sandwich must be renewed before any external write.'
                : 'No exact historical Supabase DB/Auth readback is available; this is an RC blocker, not a freshness-only warning.',
            evidencePath: finalSupabase?.file ?? null,
            observedAt: finalSupabase?.value.observedAt ?? null,
            expiresAt: finalSupabase?.value.expiresAt ?? null,
            requiredBefore: 'external_write',
        },
    ];
    const open = requirements.filter((item) => item.status === 'open');
    const ready = open.length === 0;
    const evidenceTimestamps = [
        cloudflare?.value.endedAt,
        rollout?.value.completedAt,
        authPolicy?.value.closedAt,
        availability?.value.verifiedAt,
        finalSupabase?.value.observedAt,
    ].filter((value): value is string => Boolean(value));

    return {
        ready,
        blocker: ready
            ? null
            : {
                id: RC_PRODUCTION_INERT_BLOCKER_ID,
                line: `- [ ] ${RC_PRODUCTION_INERT_BLOCKER_ID} (computed): missing ${open.map((item) => item.id).join(', ')}.`,
            },
        requirements,
        renewableReadbacks,
        refreshRequiredBeforeExternalWrite: renewableReadbacks.some((item) => item.status !== 'fresh'),
        cloudflareResolution,
        sourcePath: finalSupabase?.file
            ?? availability?.file
            ?? authPolicy?.file
            ?? rollout?.file
            ?? cloudflare?.file
            ?? null,
        latestEvidenceAt: latestTimestamp(evidenceTimestamps),
    };
}

function validateProductionRolloutReceipt(value: unknown, now: Date): string[] {
    if (!isRecord(value)) return ['Production rollout receipt must be an object.'];
    const errors: string[] = [];
    const expected: Record<string, unknown> = {
        schemaVersion: 1,
        status: 'PRODUCTION_ROLLOUT_ALL_WAVES_APPLIED_AND_VERIFIED',
        targetProjectRef: PRODUCTION_PROJECT.ref,
        through: 'deferred_rc_hardening',
        migrationCount: PRODUCTION_ROLLOUT_MIGRATIONS.length,
        finalVerificationPassed: true,
        stagingOnlyMigrationAbsent: true,
        checkoutRemainedDisabledByOperatorAttestation: true,
        authFinalizeRequired: true,
    };
    for (const [key, expectedValue] of Object.entries(expected)) {
        if (value[key] !== expectedValue) errors.push(`${key} must equal ${String(expectedValue)}.`);
    }
    for (const key of [
        'scopeSha256',
        'allowlistSha256',
        'migrationManifestSha256',
        'preflightEvidenceSha256',
        'historyReconciliationManifestSha256',
        'historyReconciliationSnapshotSha256',
        'liveHistoryReconciliationSqlSha256',
        'liveHistoryReconciliationSnapshotSha256',
        'authInertEvidenceSha256',
        'backupReceiptSha256',
        'backupArtifactSha256',
        'backupArtifactVerificationSha256',
        'publicCleanupReceiptSha256',
        'preservationPolicySha256',
        'authReducedQuarantinedReceiptSha256',
        'googleFixturePolicyEvidenceSha256',
        'stagingHardeningEvidenceSha256',
        'sentryProductionHardeningEvidenceSha256',
        'livePreflightSqlSha256',
        'finalVerifySqlSha256',
    ]) {
        if (!sha256Pattern.test(String(value[key] ?? ''))) errors.push(`${key} must be a lowercase SHA-256.`);
    }
    if (value.allowlistSha256 !== productionRolloutAllowlistSha256()) {
        errors.push('allowlistSha256 must match the canonical production rollout allowlist.');
    }
    if (value.migrationManifestSha256 !== productionRolloutMigrationManifestSha256()) {
        errors.push('migrationManifestSha256 must match the canonical production rollout manifest.');
    }
    if (!sameStringArray(value.stagingOnlyVersions, [...STAGING_ONLY_VERSIONS])) {
        errors.push('stagingOnlyVersions must contain the exact excluded staging migrations.');
    }
    validateTimestamp(value.completedAt, 'completedAt', now, errors, RC_FOUNDATIONAL_EVIDENCE_MAX_AGE_MS);
    return errors;
}

function validatePublicCleanupReceipt(value: unknown, now: Date): string[] {
    if (!isRecord(value)) return ['Public cleanup receipt must be an object.'];
    const errors: string[] = [];
    if (value.schemaVersion !== 2) errors.push('Public cleanup receipt schemaVersion must be 2.');
    if (value.status !== 'PUBLIC_FIXTURE_CLEANUP_EXECUTED_AND_VERIFIED') {
        errors.push('Public cleanup receipt status mismatch.');
    }
    if (value.targetProjectRef !== PRODUCTION_PROJECT.ref) errors.push('Public cleanup receipt target mismatch.');
    if (!sha256Pattern.test(String(value.preservationPolicySha256 ?? ''))) {
        errors.push('Public cleanup preservationPolicySha256 must be a lowercase SHA-256.');
    }
    validateTimestamp(
        value.completedAt,
        'Public cleanup completedAt',
        now,
        errors,
        RC_FOUNDATIONAL_EVIDENCE_MAX_AGE_MS,
    );
    return errors;
}

function validateAuthPolicyReceipt(value: unknown, now: Date): string[] {
    const errors = validateFinalAuthPolicyReceipt(value, now);
    if (!isRecord(value)) return errors;
    validateTimestamp(value.closedAt, 'closedAt', now, errors, RC_FOUNDATIONAL_EVIDENCE_MAX_AGE_MS);
    if (!sha256Pattern.test(String(value.productionRolloutReceiptSha256 ?? ''))) {
        errors.push('productionRolloutReceiptSha256 must be a lowercase SHA-256.');
    }
    return [...new Set(errors)];
}

function validateProductionAvailabilityReceipt(value: unknown, now: Date): string[] {
    if (!isRecord(value)) return ['Production availability receipt must be an object.'];
    const errors: string[] = [];
    if (value.schemaVersion !== 1) errors.push('schemaVersion must be 1.');
    if (value.status !== 'SEEDED_AND_VERIFIED') errors.push('status must be SEEDED_AND_VERIFIED.');
    if (value.targetProjectRef !== PRODUCTION_AVAILABILITY_TARGET.projectRef) errors.push('targetProjectRef mismatch.');
    if (value.timezone !== PRODUCTION_AVAILABILITY_TARGET.timezone) errors.push('timezone must be Europe/Madrid.');
    if (value.externalProvidersTouched !== false) errors.push('externalProvidersTouched must be false.');
    if (value.authUsersRemaining !== 2) errors.push('authUsersRemaining must be 2.');
    if (value.authSessionsRemaining !== 0) errors.push('authSessionsRemaining must be 0.');
    if (value.authRefreshTokensRemaining !== 0) errors.push('authRefreshTokensRemaining must be 0.');
    if (value.rolloutMigrationsVerified !== 25) errors.push('rolloutMigrationsVerified must be 25.');
    if (!sha256Pattern.test(String(value.authPolicyReceiptSha256 ?? ''))) {
        errors.push('authPolicyReceiptSha256 must be a lowercase SHA-256.');
    }
    if (JSON.stringify(value.schedule) !== JSON.stringify(PRODUCTION_AVAILABILITY_SLOTS)) {
        errors.push('schedule must contain exactly the five canonical weekday rows.');
    }
    validateTimestamp(value.verifiedAt, 'verifiedAt', now, errors, RC_FOUNDATIONAL_EVIDENCE_MAX_AGE_MS);
    return errors;
}

function validateHistoricalAuthInertReceipt(value: unknown, now: Date): string[] {
    if (!isRecord(value)) return ['Production Auth inert receipt must be an object.'];
    const observedAt = typeof value.observedAt === 'string' ? Date.parse(value.observedAt) : Number.NaN;
    if (!Number.isFinite(observedAt)) return ['Production Auth inert receipt observedAt is invalid.'];

    // Historical evidence is used only to verify the rollout's immutable hash
    // binding. It remains bounded to the same 24-hour preparation window.
    const contractNow = new Date(observedAt + 1_000);
    const errors = validateProductionAuthInertReceipt(value, contractNow).errors;
    if (value.receiptKind !== PRODUCTION_AUTH_INERT_RECEIPT_KIND) {
        errors.push('Production Auth inert receipt kind mismatch.');
    }
    validateTimestamp(value.observedAt, 'observedAt', now, errors, RC_FOUNDATIONAL_EVIDENCE_MAX_AGE_MS);
    return [...new Set(errors)];
}

function readFinalSupabaseCaptureAttempts(outputsRoot: string): FinalSupabaseCaptureAttempt[] {
    const directory = path.join(outputsRoot, evidenceLocations.finalSupabase[0]);
    if (!existsSync(directory)) return [];
    return readdirSync(directory, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .sort((left, right) => right.name.localeCompare(left.name))
        .flatMap((entry): FinalSupabaseCaptureAttempt[] => {
            const attemptDirectory = path.join(directory, entry.name);
            const summaryPath = path.join(attemptDirectory, PRODUCTION_INERT_FINAL_ATTEMPT_FILE);
            const receiptPath = path.join(attemptDirectory, PRODUCTION_INERT_FINAL_OUTPUT_FILE);
            const planPath = path.join(attemptDirectory, 'plan.json');
            if (existsSync(planPath) && !existsSync(summaryPath) && !existsSync(receiptPath)) return [];
            return [{
                directory: attemptDirectory,
                summary: readJsonCandidate<ProductionInertFinalAttemptSummary>(summaryPath),
                receipt: readJsonCandidate<ProductionInertFinalReceipt>(receiptPath),
            }];
        });
}

function readJsonCandidate<T>(file: string): JsonCandidate<T> | null {
    if (!existsSync(file)) return null;
    try {
        const bytes = readFileSync(file);
        return {
            file,
            sha256: createHash('sha256').update(bytes).digest('hex'),
            value: JSON.parse(bytes.toString('utf8')) as T,
        };
    } catch {
        return null;
    }
}

function readLatestCloudflareCompositeAttempt(
    outputsRoot: string,
): LatestAttempt<CloudflareProductionInertCompositeEvidence> {
    const directory = path.join(outputsRoot, evidenceLocations.cloudflare[0]);
    const attempts = readAttemptDirectories(directory);
    if (attempts === null) return { candidate: null, attemptDirectory: directory, invalidAttempt: true };
    for (const attemptDirectory of attempts) {
        const evidencePath = path.join(attemptDirectory, evidenceLocations.cloudflare[1]);
        if (existsSync(evidencePath)) {
            const candidate = readJsonCandidate<CloudflareProductionInertCompositeEvidence>(evidencePath);
            return { candidate, attemptDirectory, invalidAttempt: candidate === null };
        }
        const summary = readJsonCandidate<Record<string, unknown>>(path.join(attemptDirectory, 'summary.json'));
        if (summary && isExactCloudflarePlanOnlySummary(summary.value)) continue;
        return { candidate: null, attemptDirectory, invalidAttempt: true };
    }
    return { candidate: null, attemptDirectory: null, invalidAttempt: false };
}

function readLatestJsonAttempt<T>(
    outputsRoot: string,
    outputName: string,
    fileName: string,
): LatestAttempt<T> {
    const directory = path.join(outputsRoot, outputName);
    const attempts = readAttemptDirectories(directory);
    if (attempts === null) return { candidate: null, attemptDirectory: directory, invalidAttempt: true };
    const attemptDirectory = attempts[0] ?? null;
    if (!attemptDirectory) return { candidate: null, attemptDirectory: null, invalidAttempt: false };
    const candidate = readJsonCandidate<T>(path.join(attemptDirectory, fileName));
    return { candidate, attemptDirectory, invalidAttempt: candidate === null };
}

function readAttemptDirectories(directory: string): string[] | null {
    if (!existsSync(directory)) return [];
    try {
        const entries = readdirSync(directory, { withFileTypes: true });
        if (entries.some((entry) => !entry.isDirectory())) return null;
        return entries
            .map((entry) => path.join(directory, entry.name))
            .sort((left, right) => right.localeCompare(left));
    } catch {
        return null;
    }
}

function isExactCloudflarePlanOnlySummary(value: unknown): boolean {
    if (!isRecord(value)) return false;
    const startedAt = typeof value.startedAt === 'string' ? Date.parse(value.startedAt) : Number.NaN;
    const endedAt = typeof value.endedAt === 'string' ? Date.parse(value.endedAt) : Number.NaN;
    const checks = Array.isArray(value.checks) ? value.checks : [];
    const normalizedChecks = checks.flatMap((check) => isRecord(check)
        && typeof check.name === 'string'
        && check.name.trim().length > 0
        && (check.status === 'ok' || check.status === 'warning')
        && typeof check.message === 'string'
        && Array.isArray(check.details)
        && check.details.every((detail) => typeof detail === 'string')
        ? [{ name: check.name.trim(), status: check.status }]
        : []);
    const names = normalizedChecks.map((check) => check.name);
    const expectedNames = [
        'bootstrap_secret_runner_source',
        'wrangler_production_bootstrap',
        'bootstrap_runtime_inertness_source',
        'final_live_route_preserved',
        'phase1_web_fulfillment_composite_before_secrets',
        'plan_mode_no_external_write',
    ];
    const expectedStatus = normalizedChecks.some((check) => check.status === 'warning') ? 'WARNING' : 'OK';
    const target = isRecord(value.target) ? value.target : {};
    return value.schemaVersion === 1
        && value.status === expectedStatus
        && value.executeRequested === false
        && typeof value.approvalMatched === 'boolean'
        && value.externalWriteAttempted === false
        && value.externalWritePerformed === false
        && value.closureStatus === 'PLAN_ONLY_READY'
        && target.accountId === 'd1a22bcf6477ff2ff31d2bfb83084e44'
        && target.worker === 'espanolhonesto'
        && target.environment === 'production_bootstrap'
        && target.directUrl === 'https://espanolhonesto.alindev95.workers.dev'
        && target.supabaseRef === PRODUCTION_PROJECT.ref
        && target.fulfillmentUrl === 'https://espanol-honesto-fulfillment-production.alindev95.workers.dev'
        && sameStringArray(target.customDomains, ['espanolhonesto.com', 'www.espanolhonesto.com'])
        && sameStringArray(value.requiredSecretNames, ['INTERNAL_JOB_SECRET'])
        && sameStringArray(value.explicitlyWithheldSecretNames, cloudflarePlanOnlyWithheldNames)
        && Array.isArray(value.captures)
        && value.captures.length === 0
        && Number.isFinite(startedAt)
        && Number.isFinite(endedAt)
        && endedAt >= startedAt
        && normalizedChecks.length === checks.length
        && new Set(names).size === names.length
        && sameStringArray(names, expectedNames)
        && normalizedChecks.at(-1)?.status === 'ok';
}

function timestampIsHistoricallyUsable(value: string, now: Date): boolean {
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) && timestamp <= now.getTime() + futureClockSkewMs;
}

function historicalValidationClock(values: unknown[], now: Date): Date | null {
    const timestamps = values.map((value) => typeof value === 'string' ? Date.parse(value) : Number.NaN);
    if (timestamps.some((timestamp) => (
        !Number.isFinite(timestamp) || timestamp > now.getTime() + futureClockSkewMs
    ))) return null;
    return new Date(Math.max(...timestamps));
}

function readJsonCandidates(outputsRoot: string, outputName: string, fileName: string): JsonCandidate[] {
    const directory = path.join(outputsRoot, outputName);
    if (!existsSync(directory)) return [];
    const files = readdirSync(directory, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(directory, entry.name, fileName))
        .filter(existsSync)
        .sort((left, right) => right.localeCompare(left));

    return files.flatMap((file) => {
        try {
            const bytes = readFileSync(file);
            return [{
                file,
                sha256: createHash('sha256').update(bytes).digest('hex'),
                value: JSON.parse(bytes.toString('utf8')) as unknown,
            }];
        } catch {
            return [];
        }
    });
}

function hasAnyOpenCloudflareWriteState(
    outputsRoot: string,
    acceptedReadbackStartedAt: string,
): boolean {
    const stateRoot = path.join(outputsRoot, 'launch-cloudflare-production-write-state');
    if (!existsSync(stateRoot)) return false;
    try {
        const scopes = readdirSync(stateRoot, { withFileTypes: true });
        if (scopes.some((entry) => !entry.isDirectory())) return true;
        return scopes.some((entry) => hasOpenCloudflareWriteState(
            outputsRoot,
            entry.name,
            acceptedReadbackStartedAt,
        ));
    } catch {
        return true;
    }
}

function hasOpenCloudflareWriteState(
    outputsRoot: string,
    scope: string,
    acceptedReadbackStartedAt: string,
): boolean {
    const stateRoot = path.join(outputsRoot, 'launch-cloudflare-production-write-state', scope);
    if (existsSync(path.join(stateRoot, 'execution.lock'))
        || existsSync(path.join(stateRoot, 'reconciliation.lock'))) return true;
    const pendingDirectory = path.join(stateRoot, 'write-checkpoints-pending');
    if (existsSync(pendingDirectory) && readdirSync(pendingDirectory).length > 0) return true;

    const resolvedDirectory = path.join(stateRoot, 'write-checkpoints-resolved');
    if (!existsSync(resolvedDirectory)) return false;
    try {
        const resolved = findUnresolvedWorkerWriteCheckpoints(resolvedDirectory);
        if (resolved.length === 0) return false;
        const acceptedReadbackAt = Date.parse(acceptedReadbackStartedAt);
        return !Number.isFinite(acceptedReadbackAt)
            || resolved.some((checkpoint) => {
                const recordedAt = Date.parse(checkpoint.recordedAt);
                return !Number.isFinite(recordedAt) || recordedAt >= acceptedReadbackAt;
            });
    } catch {
        return true;
    }
}

function validCandidates<T>(
    candidates: JsonCandidate[],
    validate: (value: unknown) => string[],
): Array<JsonCandidate<T>> {
    return candidates.flatMap((candidate) => validate(candidate.value).length === 0
        ? [{ ...candidate, value: candidate.value as T }]
        : []);
}

function timestampedCandidates<T>(
    candidates: JsonCandidate[],
    timestampKey: string,
): Array<JsonCandidate<T>> {
    return candidates.flatMap((candidate) => {
        if (!isRecord(candidate.value)) return [];
        const timestamp = candidate.value[timestampKey];
        if (typeof timestamp !== 'string' || !Number.isFinite(Date.parse(timestamp))) return [];
        return [{ ...candidate, value: candidate.value as unknown as T }];
    });
}

function newest<T>(
    candidates: Array<JsonCandidate<T>>,
    timestamp: (value: T) => string,
): JsonCandidate<T> | null {
    return [...candidates].sort((left, right) =>
        Date.parse(timestamp(right.value)) - Date.parse(timestamp(left.value)))[0] ?? null;
}

function requirement<T>(
    id: RcProductionInertRequirementId,
    evidence: JsonCandidate<T> | null,
    closedReason: string,
    openReason: string,
): RcProductionInertRequirement {
    return {
        id,
        status: evidence ? 'closed' : 'open',
        reason: evidence ? closedReason : openReason,
        evidencePath: evidence?.file ?? null,
    };
}

function validateTimestamp(
    value: unknown,
    label: string,
    now: Date,
    errors: string[],
    maxAgeMs: number,
): void {
    const parsed = typeof value === 'string' ? Date.parse(value) : Number.NaN;
    if (!Number.isFinite(parsed)) {
        errors.push(`${label} must be a valid timestamp.`);
    } else if (parsed > now.getTime() + futureClockSkewMs) {
        errors.push(`${label} cannot be in the future.`);
    } else if (now.getTime() - parsed > maxAgeMs) {
        errors.push(`${label} is stale.`);
    }
}

function latestTimestamp(values: string[]): string | null {
    if (values.length === 0) return null;
    return [...values].sort((left, right) => Date.parse(right) - Date.parse(left))[0] ?? null;
}

function sameStringArray(value: unknown, expected: string[]): boolean {
    return Array.isArray(value)
        && value.length === expected.length
        && value.every((item, index) => item === expected[index]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
