import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import {
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
import { findUnresolvedWorkerWriteCheckpoints } from './cloudflare-production-worker-safety';

export const RC_PRODUCTION_INERT_BLOCKER_ID = 'production_inert_preparation' as const;

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

export interface RcProductionInertAssessment {
    ready: boolean;
    blocker: {
        id: typeof RC_PRODUCTION_INERT_BLOCKER_ID;
        line: string;
    } | null;
    requirements: RcProductionInertRequirement[];
    sourcePath: string | null;
    latestEvidenceAt: string | null;
}

interface JsonCandidate<T = unknown> {
    file: string;
    sha256: string;
    value: T;
}

interface CloudflareBootstrapClosure {
    endedAt: string;
}

interface ProductionRolloutReceipt {
    completedAt: string;
    authInertEvidenceSha256: string;
}

interface FinalAuthPolicyReceipt {
    closedAt: string;
    productionRolloutReceiptSha256: string;
}

interface ProductionAvailabilityReceipt {
    verifiedAt: string;
    authPolicyReceiptSha256: string;
}

interface ProductionAuthInertReceipt {
    observedAt: string;
}

const futureClockSkewMs = 5 * 60 * 1_000;
const sha256Pattern = /^[a-f0-9]{64}$/u;

const evidenceLocations = {
    cloudflare: ['launch-cloudflare-production-worker-bootstrap-secrets', 'summary.json'],
    rollout: ['launch-supabase-production-rollout-runner', 'production-rollout-receipt.json'],
    authPolicy: ['launch-supabase-production-auth-cleanup', 'auth-policy-receipt.json'],
    authInert: ['launch-supabase-auth-config-preflight', 'auth-inert-receipt.json'],
    availability: ['launch-production-availability', 'production-availability-receipt.json'],
} as const;

export function assessRcProductionInertEvidence(
    outputsRoot = path.join(process.cwd(), 'outputs'),
    now = new Date(),
): RcProductionInertAssessment {
    const cloudflareAttempts = readJsonCandidates(outputsRoot, ...evidenceLocations.cloudflare)
        .flatMap((candidate): Array<JsonCandidate<CloudflareBootstrapClosure>> => {
            if (!isRecord(candidate.value)
                || candidate.value.executeRequested !== true
                || candidate.value.approvalMatched !== true
                || typeof candidate.value.endedAt !== 'string'
                || !Number.isFinite(Date.parse(candidate.value.endedAt))) return [];
            return [{ ...candidate, value: candidate.value as unknown as CloudflareBootstrapClosure }];
        });
    const latestCloudflareAttempt = newest(cloudflareAttempts, (value) => value.endedAt);
    const latestAcceptedCloudflareClosure = latestCloudflareAttempt
        && validateCloudflareBootstrapClosure(latestCloudflareAttempt.value, now).length === 0
        ? latestCloudflareAttempt
        : null;
    const cloudflareWriteStateOpen = hasOpenCloudflareWriteState(
        outputsRoot,
        'web-bootstrap-hmac-secret',
        latestAcceptedCloudflareClosure?.value.endedAt ?? null,
    );
    const cloudflare = cloudflareWriteStateOpen ? null : latestAcceptedCloudflareClosure;

    const authInertCandidates = validCandidates<ProductionAuthInertReceipt>(
        readJsonCandidates(outputsRoot, ...evidenceLocations.authInert),
        (value) => validateAuthInertReceiptContract(value, now),
    );
    const authInertBySha = new Map(authInertCandidates.map((candidate) => [candidate.sha256, candidate]));

    const rolloutCandidates = validCandidates<ProductionRolloutReceipt>(
        readJsonCandidates(outputsRoot, ...evidenceLocations.rollout),
        (value) => validateProductionRolloutReceipt(value, now),
    );
    const latestRolloutReceipt = newest(rolloutCandidates, (value) => value.completedAt);
    const rollout = latestRolloutReceipt && (() => {
        const linkedAuth = authInertBySha.get(latestRolloutReceipt.value.authInertEvidenceSha256);
        return linkedAuth !== undefined
            && Date.parse(linkedAuth.value.observedAt) <= Date.parse(latestRolloutReceipt.value.completedAt) + futureClockSkewMs
            ? latestRolloutReceipt
            : null;
    })();

    const authPolicyCandidates = validCandidates<FinalAuthPolicyReceipt>(
        readJsonCandidates(outputsRoot, ...evidenceLocations.authPolicy),
        (value) => validateAuthPolicyReceipt(value, now),
    ).filter((candidate) => {
        return rollout !== null
            && candidate.value.productionRolloutReceiptSha256 === rollout.sha256
            && Date.parse(candidate.value.closedAt) >= Date.parse(rollout.value.completedAt);
    });
    const authPolicy = newest(authPolicyCandidates, (value) => value.closedAt);

    const availabilityCandidates = validCandidates<ProductionAvailabilityReceipt>(
        readJsonCandidates(outputsRoot, ...evidenceLocations.availability),
        (value) => validateProductionAvailabilityReceipt(value, now),
    ).filter((candidate) => {
        return authPolicy !== null
            && candidate.value.authPolicyReceiptSha256 === authPolicy.sha256
            && Date.parse(candidate.value.verifiedAt) >= Date.parse(authPolicy.value.closedAt);
    });
    const availability = newest(availabilityCandidates, (value) => value.verifiedAt);

    const postPreparationAuthInert = availability
        ? newest(
            authInertCandidates.filter((candidate) =>
                Date.parse(candidate.value.observedAt) >= Date.parse(availability.value.verifiedAt)),
            (value) => value.observedAt,
        )
        : null;

    const requirements: RcProductionInertRequirement[] = [
        requirement(
            'cloudflare_bootstrap_hmac',
            cloudflare,
            'Cloudflare production fulfillment + web bootstrap and HMAC-only attestation are closed.',
            cloudflareWriteStateOpen
                ? 'Cloudflare web bootstrap HMAC has a pending checkpoint or lock, or a resolved checkpoint newer than the accepted closure, requiring read-only reconciliation.'
                : 'No executed-and-attested Cloudflare production bootstrap HMAC closure was found.',
        ),
        requirement(
            'supabase_production_rollout',
            rollout,
            'Supabase production rollout is fully applied, verified, checkout-off and bound to Auth-inert GET evidence.',
            rolloutCandidates.length > 0
                ? 'A rollout receipt exists, but it is not bound to the canonical Auth-inert receipt it names.'
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
            postPreparationAuthInert,
            'A post-preparation Management API GET proves disable_signup=true and mailer_autoconfirm=false.',
            'No canonical Auth-inert GET receipt observed after Auth finalization and availability was found.',
        ),
    ];
    const open = requirements.filter((item) => item.status === 'open');
    const ready = open.length === 0;
    const evidenceTimestamps = [
        cloudflare?.value.endedAt,
        rollout?.value.completedAt,
        authPolicy?.value.closedAt,
        availability?.value.verifiedAt,
        postPreparationAuthInert?.value.observedAt,
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
        sourcePath: postPreparationAuthInert?.file
            ?? availability?.file
            ?? authPolicy?.file
            ?? rollout?.file
            ?? cloudflare?.file
            ?? null,
        latestEvidenceAt: latestTimestamp(evidenceTimestamps),
    };
}

function validateCloudflareBootstrapClosure(value: unknown, now: Date): string[] {
    if (!isRecord(value)) return ['Cloudflare bootstrap closure must be an object.'];
    const errors: string[] = [];
    if (value.schemaVersion !== 1) errors.push('schemaVersion must be 1.');
    if (value.status !== 'OK') errors.push('status must be OK.');
    if (!['EXECUTED_AND_ATTESTED', 'RECONCILED_STOP'].includes(String(value.closureStatus))) {
        errors.push('closureStatus must prove execution or read-only reconciliation.');
    }
    if (value.executeRequested !== true || value.approvalMatched !== true) {
        errors.push('The exact execution approval must have matched.');
    }
    if (value.closureStatus === 'EXECUTED_AND_ATTESTED' && value.externalWritePerformed !== true) {
        errors.push('Executed closure must prove the HMAC write.');
    }
    if (value.externalWritePerformed === 'unknown') errors.push('Cloudflare write outcome is ambiguous.');
    validateTimestamp(value.endedAt, 'endedAt', now, errors);

    const target = isRecord(value.target) ? value.target : null;
    if (!target
        || target.accountId !== 'd1a22bcf6477ff2ff31d2bfb83084e44'
        || target.worker !== 'espanolhonesto'
        || target.environment !== 'production_bootstrap'
        || target.supabaseRef !== PRODUCTION_PROJECT.ref) {
        errors.push('Cloudflare bootstrap target mismatch.');
    }
    if (!sameStringArray(value.requiredSecretNames, ['INTERNAL_JOB_SECRET'])) {
        errors.push('Cloudflare bootstrap secret set must be exactly INTERNAL_JOB_SECRET.');
    }

    const checks = Array.isArray(value.checks) ? value.checks.filter(isRecord) : [];
    const checkIsOk = (name: string): boolean => checks.some((check) => check.name === name && check.status === 'ok');
    for (const name of [
        'phase1_web_bootstrap_before_secrets',
        'minimal_bootstrap_secret_shape_after_write',
        'direct_web_bootstrap_hmac_attestation',
    ]) {
        if (!checkIsOk(name)) errors.push(`Cloudflare proof check is missing: ${name}.`);
    }
    const closureProof = value.closureStatus === 'RECONCILED_STOP'
        ? 'bootstrap_hmac_readonly_reconciliation'
        : 'bootstrap_hmac_write_checkpoint_resolved';
    if (!checkIsOk(closureProof)) errors.push(`Cloudflare closure proof is missing: ${closureProof}.`);
    if (checks.some((check) => check.status === 'failed' || check.status === 'warning')) {
        errors.push('Cloudflare closure contains a non-ok check.');
    }
    return errors;
}

function validateProductionRolloutReceipt(value: unknown, now: Date): string[] {
    if (!isRecord(value)) return ['Production rollout receipt must be an object.'];
    const errors: string[] = [];
    const expected: Record<string, unknown> = {
        schemaVersion: 1,
        status: 'PRODUCTION_ROLLOUT_ALL_WAVES_APPLIED_AND_VERIFIED',
        targetProjectRef: PRODUCTION_PROJECT.ref,
        through: 'deferred_rc_hardening',
        migrationCount: 25,
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
        'authReducedQuarantinedReceiptSha256',
        'googleFixturePolicyEvidenceSha256',
        'stagingHardeningEvidenceSha256',
        'sentryProductionHardeningEvidenceSha256',
        'livePreflightSqlSha256',
        'finalVerifySqlSha256',
    ]) {
        if (!sha256Pattern.test(String(value[key] ?? ''))) errors.push(`${key} must be a lowercase SHA-256.`);
    }
    if (!sameStringArray(value.stagingOnlyVersions, [...STAGING_ONLY_VERSIONS])) {
        errors.push('stagingOnlyVersions must contain the exact excluded staging migrations.');
    }
    validateTimestamp(value.completedAt, 'completedAt', now, errors);
    return errors;
}

function validateAuthPolicyReceipt(value: unknown, now: Date): string[] {
    const errors = validateFinalAuthPolicyReceipt(value, now);
    if (!isRecord(value)) return errors;
    validateTimestamp(value.closedAt, 'closedAt', now, errors);
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
    if (!sha256Pattern.test(String(value.authPolicyReceiptSha256 ?? ''))) {
        errors.push('authPolicyReceiptSha256 must be a lowercase SHA-256.');
    }
    if (JSON.stringify(value.schedule) !== JSON.stringify(PRODUCTION_AVAILABILITY_SLOTS)) {
        errors.push('schedule must contain exactly the five canonical weekday rows.');
    }
    validateTimestamp(value.verifiedAt, 'verifiedAt', now, errors);
    return errors;
}

function validateAuthInertReceiptContract(value: unknown, now: Date): string[] {
    if (!isRecord(value)) return ['Production Auth inert receipt must be an object.'];
    const observedAt = typeof value.observedAt === 'string' ? Date.parse(value.observedAt) : Number.NaN;
    if (!Number.isFinite(observedAt)) return ['Production Auth inert receipt observedAt is invalid.'];

    // The canonical validator includes a 15-minute operational gate. RC status
    // validates the same exact receipt contract, then uses chain chronology
    // instead of expiring a completed preparation every fifteen minutes.
    const contractNow = new Date(observedAt + 1_000);
    const errors = validateProductionAuthInertReceipt(value, contractNow).errors;
    if (value.receiptKind !== PRODUCTION_AUTH_INERT_RECEIPT_KIND) {
        errors.push('Production Auth inert receipt kind mismatch.');
    }
    validateTimestamp(value.observedAt, 'observedAt', now, errors);
    return [...new Set(errors)];
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

function hasOpenCloudflareWriteState(
    outputsRoot: string,
    scope: string,
    acceptedClosureEndedAt: string | null,
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
        const acceptedClosureAt = acceptedClosureEndedAt === null
            ? Number.NaN
            : Date.parse(acceptedClosureEndedAt);
        return !Number.isFinite(acceptedClosureAt)
            || resolved.some((checkpoint) => {
                const recordedAt = Date.parse(checkpoint.recordedAt);
                return !Number.isFinite(recordedAt) || recordedAt > acceptedClosureAt;
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

function validateTimestamp(value: unknown, label: string, now: Date, errors: string[]): void {
    const parsed = typeof value === 'string' ? Date.parse(value) : Number.NaN;
    if (!Number.isFinite(parsed)) {
        errors.push(`${label} must be a valid timestamp.`);
    } else if (parsed > now.getTime() + futureClockSkewMs) {
        errors.push(`${label} cannot be in the future.`);
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
