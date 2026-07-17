import { createHash } from 'node:crypto';
import { PRODUCTION_QUEUE_TARGET } from './cloudflare-production-queue-shared';
import type { StripeLiveReadiness } from './stripe-live-readiness';

export const PRODUCTION_FULFILLMENT_ENABLE_APPROVAL_ENV = 'CLOUDFLARE_FULFILLMENT_ENABLE_APPROVAL';
export const PRODUCTION_FULFILLMENT_ENABLE_APPROVAL_SENTENCE =
    'Apruebo habilitar finalmente el Cloudflare Fulfillment Worker production `espanol-honesto-fulfillment-production` en la cuenta `d1a22bcf6477ff2ff31d2bfb83084e44` usando el entorno Wrangler `production`, despues de verificar en esta misma ejecucion el bootstrap inerte, el Worker web production, todos los secrets requeridos, la atestacion autenticada, la existencia unica y el info exacto de las Queues `espanol-honesto-fulfillment-production-queue` y `espanol-honesto-fulfillment-production-dlq`, y la preparacion read-only fresca de Stripe Live; este deploy activa jobs, email live y el cron horario, sin crear, borrar, pausar ni modificar Queues, sin escribir Stripe y sin tocar dominios, DNS ni Pages.';
export const PRODUCTION_FULFILLMENT_ENABLE_PREFLIGHT_MAX_AGE_MS = 5 * 60 * 1_000;

const FUTURE_CLOCK_SKEW_MS = 5_000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

export type ProductionEnableCheckpointStatus = 'pending' | 'proven' | 'compensated' | 'ambiguous';

export interface ProductionEnableCheckpoint {
    schemaVersion: 2;
    kind: 'cloudflare-production-fulfillment-enable-checkpoint';
    revision: number;
    status: ProductionEnableCheckpointStatus;
    attemptId: string;
    startedAt: string;
    updatedAt: string;
    targetAccountId: typeof PRODUCTION_QUEUE_TARGET.accountId;
    targetWorker: typeof PRODUCTION_QUEUE_TARGET.worker;
    approvalSentenceSha256: string;
    prewriteEvidenceSha256: string;
    activeDeployAttempted: true;
    compensationAttempted: boolean;
    activeVersionId: string | null;
    compensatedBootstrapVersionId: string | null;
    lastErrorCategory: string | null;
}

export interface GuardedEnableMutationDriver<ActiveProof, CompensationProof> {
    persistPending(): Promise<void> | void;
    deployAndVerifyActive(): Promise<ActiveProof | null>;
    markProven(proof: ActiveProof): Promise<void> | void;
    compensateAndVerify(): Promise<CompensationProof | null>;
    markCompensated(proof: CompensationProof): Promise<void> | void;
    markAmbiguous(errorCategory: string): Promise<void> | void;
}

export type GuardedEnableMutationResult<ActiveProof, CompensationProof> =
    | { status: 'proven'; proof: ActiveProof }
    | { status: 'compensated'; proof: CompensationProof }
    | { status: 'ambiguous'; errorCategory: string };

export type ProductionEnableStartupAction =
    | 'allow_new_attempt'
    | 'verify_proven_active'
    | 'reconcile_active_then_compensate'
    | 'compensate_only';

export interface ProductionEnableQueueReadiness {
    observedAt: string;
    pagesRead: number;
    queueCount: 1;
    deadLetterQueueCount: 1;
    queueInfoVerified: true;
    deadLetterQueueInfoVerified: true;
}

export interface ProductionEnableStripeReadiness {
    observedAt: string;
    readiness: StripeLiveReadiness;
}

export interface ProductionEnablePrewriteEvidence {
    schemaVersion: 1;
    kind: 'cloudflare-production-fulfillment-enable-prewrite';
    generatedAt: string;
    externalWriteAttemptedBeforeEvidence: false;
    approval: {
        envVar: typeof PRODUCTION_FULFILLMENT_ENABLE_APPROVAL_ENV;
        sentenceSha256: string;
    };
    target: {
        accountId: typeof PRODUCTION_QUEUE_TARGET.accountId;
        worker: typeof PRODUCTION_QUEUE_TARGET.worker;
        webWorker: 'espanolhonesto';
        queue: typeof PRODUCTION_QUEUE_TARGET.queue;
        deadLetterQueue: typeof PRODUCTION_QUEUE_TARGET.deadLetterQueue;
        stripeAccountId: string;
        stripePortalConfigurationId: string;
    };
    queue: ProductionEnableQueueReadiness;
    stripe: {
        observedAt: string;
        ok: true;
        failureCount: 0;
        facts: StripeLiveReadiness['facts'];
    };
    immediatelyPrecedingVersions: {
        fulfillmentBootstrap: string;
        web: string;
    };
}

export function productionFulfillmentEnableApprovalSha256(): string {
    return createHash('sha256')
        .update(PRODUCTION_FULFILLMENT_ENABLE_APPROVAL_SENTENCE)
        .digest('hex');
}

export function createProductionEnablePendingCheckpoint(input: {
    attemptId: string;
    now: string;
    prewriteEvidenceSha256: string;
    previousRevision?: number;
}): ProductionEnableCheckpoint {
    return {
        schemaVersion: 2,
        kind: 'cloudflare-production-fulfillment-enable-checkpoint',
        revision: (input.previousRevision ?? 0) + 1,
        status: 'pending',
        attemptId: input.attemptId,
        startedAt: input.now,
        updatedAt: input.now,
        targetAccountId: PRODUCTION_QUEUE_TARGET.accountId,
        targetWorker: PRODUCTION_QUEUE_TARGET.worker,
        approvalSentenceSha256: productionFulfillmentEnableApprovalSha256(),
        prewriteEvidenceSha256: input.prewriteEvidenceSha256,
        activeDeployAttempted: true,
        compensationAttempted: false,
        activeVersionId: null,
        compensatedBootstrapVersionId: null,
        lastErrorCategory: null,
    };
}

export function markProductionEnableCheckpointCompensationStarted(
    checkpoint: ProductionEnableCheckpoint,
    now: string,
): ProductionEnableCheckpoint {
    return {
        ...checkpoint,
        revision: checkpoint.revision + 1,
        status: 'pending',
        updatedAt: now,
        compensationAttempted: true,
        activeVersionId: null,
        compensatedBootstrapVersionId: null,
        lastErrorCategory: checkpoint.lastErrorCategory ?? 'ACTIVE_ENABLE_NOT_PROVEN',
    };
}

export function markProductionEnableCheckpointProven(
    checkpoint: ProductionEnableCheckpoint,
    activeVersionId: string,
    now: string,
): ProductionEnableCheckpoint {
    if (checkpoint.compensationAttempted) {
        throw new Error('A checkpoint with compensation started cannot transition to proven active');
    }
    return {
        ...checkpoint,
        revision: checkpoint.revision + 1,
        status: 'proven',
        updatedAt: now,
        activeVersionId,
        compensatedBootstrapVersionId: null,
        lastErrorCategory: null,
    };
}

export function markProductionEnableCheckpointCompensated(
    checkpoint: ProductionEnableCheckpoint,
    bootstrapVersionId: string,
    now: string,
): ProductionEnableCheckpoint {
    return {
        ...checkpoint,
        revision: checkpoint.revision + 1,
        status: 'compensated',
        updatedAt: now,
        compensationAttempted: true,
        activeVersionId: null,
        compensatedBootstrapVersionId: bootstrapVersionId,
        lastErrorCategory: null,
    };
}

export function markProductionEnableCheckpointAmbiguous(
    checkpoint: ProductionEnableCheckpoint,
    errorCategory: string,
    now: string,
): ProductionEnableCheckpoint {
    return {
        ...checkpoint,
        revision: checkpoint.revision + 1,
        status: 'ambiguous',
        updatedAt: now,
        activeVersionId: null,
        compensatedBootstrapVersionId: null,
        lastErrorCategory: errorCategory || 'UNKNOWN_ENABLE_ERROR',
    };
}

export function validateProductionEnableCheckpoint(value: unknown): { ok: boolean; errors: string[] } {
    const errors: string[] = [];
    if (!isRecord(value)) return { ok: false, errors: ['checkpoint must be an object'] };
    if (value.schemaVersion !== 2) errors.push('checkpoint schemaVersion must be 2');
    if (value.kind !== 'cloudflare-production-fulfillment-enable-checkpoint') errors.push('checkpoint kind is invalid');
    if (!Number.isSafeInteger(value.revision) || Number(value.revision) < 1) errors.push('checkpoint revision is invalid');
    if (!['pending', 'proven', 'compensated', 'ambiguous'].includes(String(value.status))) errors.push('checkpoint status is invalid');
    if (!UUID_PATTERN.test(String(value.attemptId ?? ''))) errors.push('checkpoint attemptId is invalid');
    if (!validTimestamp(value.startedAt)) errors.push('checkpoint startedAt is invalid');
    if (!validTimestamp(value.updatedAt)) errors.push('checkpoint updatedAt is invalid');
    if (value.targetAccountId !== PRODUCTION_QUEUE_TARGET.accountId) errors.push('checkpoint target account is invalid');
    if (value.targetWorker !== PRODUCTION_QUEUE_TARGET.worker) errors.push('checkpoint target Worker is invalid');
    if (value.approvalSentenceSha256 !== productionFulfillmentEnableApprovalSha256()) errors.push('checkpoint approval hash is invalid');
    if (!SHA256_PATTERN.test(String(value.prewriteEvidenceSha256 ?? ''))) errors.push('checkpoint evidence hash is invalid');
    if (value.activeDeployAttempted !== true) errors.push('checkpoint must record active deploy intent');
    if (typeof value.compensationAttempted !== 'boolean') errors.push('checkpoint compensationAttempted is invalid');
    if (value.activeVersionId !== null && !UUID_PATTERN.test(String(value.activeVersionId))) errors.push('checkpoint active version is invalid');
    if (value.compensatedBootstrapVersionId !== null && !UUID_PATTERN.test(String(value.compensatedBootstrapVersionId))) errors.push('checkpoint bootstrap version is invalid');
    if (value.lastErrorCategory !== null && (typeof value.lastErrorCategory !== 'string' || !value.lastErrorCategory)) errors.push('checkpoint last error is invalid');

    if (value.status === 'pending' && (value.activeVersionId !== null || value.compensatedBootstrapVersionId !== null)) {
        errors.push('pending checkpoint cannot claim a proven version');
    }
    if (value.status === 'proven' && (!UUID_PATTERN.test(String(value.activeVersionId ?? '')) || value.compensatedBootstrapVersionId !== null)) {
        errors.push('proven checkpoint requires only an active version');
    }
    if (value.status === 'proven' && value.compensationAttempted !== false) {
        errors.push('proven checkpoint cannot follow a compensation attempt');
    }
    if (value.status === 'compensated' && (!UUID_PATTERN.test(String(value.compensatedBootstrapVersionId ?? '')) || value.activeVersionId !== null || value.compensationAttempted !== true)) {
        errors.push('compensated checkpoint requires only a compensated bootstrap version');
    }
    if (value.status === 'ambiguous' && (typeof value.lastErrorCategory !== 'string' || !value.lastErrorCategory)) {
        errors.push('ambiguous checkpoint requires an error category');
    }
    if (value.status === 'ambiguous' && (value.activeVersionId !== null || value.compensatedBootstrapVersionId !== null)) {
        errors.push('ambiguous checkpoint cannot claim a proven version');
    }
    return { ok: errors.length === 0, errors };
}

export function productionEnableStartupAction(
    checkpoint: ProductionEnableCheckpoint,
): ProductionEnableStartupAction {
    if (checkpoint.status === 'compensated') return 'allow_new_attempt';
    if (checkpoint.compensationAttempted) return 'compensate_only';
    if (checkpoint.status === 'proven') return 'verify_proven_active';
    return 'reconcile_active_then_compensate';
}

export async function runGuardedEnableMutation<ActiveProof, CompensationProof>(
    driver: GuardedEnableMutationDriver<ActiveProof, CompensationProof>,
): Promise<GuardedEnableMutationResult<ActiveProof, CompensationProof>> {
    await driver.persistPending();
    let activeFailure = 'ACTIVE_ENABLE_NOT_PROVEN';
    try {
        const activeProof = await driver.deployAndVerifyActive();
        if (activeProof !== null) {
            await driver.markProven(activeProof);
            return { status: 'proven', proof: activeProof };
        }
    } catch (error) {
        activeFailure = errorCategory(error, 'ACTIVE_ENABLE_EXCEPTION');
    }

    try {
        const compensationProof = await driver.compensateAndVerify();
        if (compensationProof !== null) {
            await driver.markCompensated(compensationProof);
            return { status: 'compensated', proof: compensationProof };
        }
        activeFailure = `${activeFailure}_COMPENSATION_NOT_PROVEN`;
    } catch (error) {
        activeFailure = `${activeFailure}_${errorCategory(error, 'COMPENSATION_EXCEPTION')}`;
    }

    await driver.markAmbiguous(activeFailure);
    return { status: 'ambiguous', errorCategory: activeFailure };
}

export function buildProductionEnablePrewriteEvidence(input: {
    generatedAt: string;
    queue: ProductionEnableQueueReadiness;
    stripe: ProductionEnableStripeReadiness;
    stripeAccountId: string;
    stripePortalConfigurationId: string;
    fulfillmentBootstrapVersion: string;
    webVersion: string;
}): ProductionEnablePrewriteEvidence {
    if (!input.stripe.readiness.ok || input.stripe.readiness.failures.length !== 0) {
        throw new Error('Stripe Live readiness must be successful before building enable evidence');
    }

    return {
        schemaVersion: 1,
        kind: 'cloudflare-production-fulfillment-enable-prewrite',
        generatedAt: input.generatedAt,
        externalWriteAttemptedBeforeEvidence: false,
        approval: {
            envVar: PRODUCTION_FULFILLMENT_ENABLE_APPROVAL_ENV,
            sentenceSha256: productionFulfillmentEnableApprovalSha256(),
        },
        target: {
            accountId: PRODUCTION_QUEUE_TARGET.accountId,
            worker: PRODUCTION_QUEUE_TARGET.worker,
            webWorker: 'espanolhonesto',
            queue: PRODUCTION_QUEUE_TARGET.queue,
            deadLetterQueue: PRODUCTION_QUEUE_TARGET.deadLetterQueue,
            stripeAccountId: input.stripeAccountId,
            stripePortalConfigurationId: input.stripePortalConfigurationId,
        },
        queue: input.queue,
        stripe: {
            observedAt: input.stripe.observedAt,
            ok: true,
            failureCount: 0,
            facts: input.stripe.readiness.facts,
        },
        immediatelyPrecedingVersions: {
            fulfillmentBootstrap: input.fulfillmentBootstrapVersion,
            web: input.webVersion,
        },
    };
}

export function validateProductionEnablePrewriteEvidence(
    value: unknown,
    expected: {
        now: Date;
        stripeAccountId: string;
        stripePortalConfigurationId: string;
    },
): { ok: boolean; errors: string[] } {
    const errors: string[] = [];
    if (!isRecord(value)) return { ok: false, errors: ['evidence must be an object'] };

    if (value.schemaVersion !== 1) errors.push('schemaVersion must be 1');
    if (value.kind !== 'cloudflare-production-fulfillment-enable-prewrite') errors.push('kind is invalid');
    if (value.externalWriteAttemptedBeforeEvidence !== false) errors.push('evidence must precede external writes');
    validateFreshTimestamp(value.generatedAt, 'generatedAt', expected.now, errors);

    const approval = record(value.approval, 'approval', errors);
    if (approval) {
        if (approval.envVar !== PRODUCTION_FULFILLMENT_ENABLE_APPROVAL_ENV) errors.push('approval envVar is invalid');
        if (!SHA256_PATTERN.test(String(approval.sentenceSha256 ?? ''))
            || approval.sentenceSha256 !== productionFulfillmentEnableApprovalSha256()) {
            errors.push('approval sentence hash is invalid');
        }
    }

    const target = record(value.target, 'target', errors);
    if (target) {
        const expectedTarget = {
            accountId: PRODUCTION_QUEUE_TARGET.accountId,
            worker: PRODUCTION_QUEUE_TARGET.worker,
            webWorker: 'espanolhonesto',
            queue: PRODUCTION_QUEUE_TARGET.queue,
            deadLetterQueue: PRODUCTION_QUEUE_TARGET.deadLetterQueue,
            stripeAccountId: expected.stripeAccountId,
            stripePortalConfigurationId: expected.stripePortalConfigurationId,
        };
        for (const [key, expectedValue] of Object.entries(expectedTarget)) {
            if (target[key] !== expectedValue) errors.push(`target.${key} is invalid`);
        }
    }

    const queue = record(value.queue, 'queue', errors);
    if (queue) {
        validateFreshTimestamp(queue.observedAt, 'queue.observedAt', expected.now, errors);
        if (!Number.isSafeInteger(queue.pagesRead) || Number(queue.pagesRead) < 1 || Number(queue.pagesRead) > 500) {
            errors.push('queue.pagesRead is invalid');
        }
        if (queue.queueCount !== 1) errors.push('queue.queueCount must be 1');
        if (queue.deadLetterQueueCount !== 1) errors.push('queue.deadLetterQueueCount must be 1');
        if (queue.queueInfoVerified !== true) errors.push('queue info must be verified');
        if (queue.deadLetterQueueInfoVerified !== true) errors.push('DLQ info must be verified');
    }

    const stripe = record(value.stripe, 'stripe', errors);
    if (stripe) {
        validateFreshTimestamp(stripe.observedAt, 'stripe.observedAt', expected.now, errors);
        if (stripe.ok !== true || stripe.failureCount !== 0) errors.push('Stripe readiness must be successful');
        const facts = record(stripe.facts, 'stripe.facts', errors);
        if (facts) {
            if (facts.accountMatched !== true) errors.push('Stripe account must match');
            if (facts.accountReady !== true) errors.push('Stripe account must be ready');
            if (facts.country !== 'ES') errors.push('Stripe country must be ES');
            if (facts.currency !== 'eur') errors.push('Stripe currency must be eur');
            if (facts.enabledWebhookCount !== 1) errors.push('Stripe enabled webhook count must be 1');
            if (facts.portalMatched !== true) errors.push('Stripe Portal must match');
            if (facts.webhookMatched !== true) errors.push('Stripe webhook must match');
        }
    }

    const versions = record(value.immediatelyPrecedingVersions, 'immediatelyPrecedingVersions', errors);
    if (versions) {
        if (!UUID_PATTERN.test(String(versions.fulfillmentBootstrap ?? ''))) errors.push('fulfillment bootstrap version is invalid');
        if (!UUID_PATTERN.test(String(versions.web ?? ''))) errors.push('web version is invalid');
    }

    return { ok: errors.length === 0, errors };
}

function validateFreshTimestamp(value: unknown, label: string, now: Date, errors: string[]): void {
    if (typeof value !== 'string') {
        errors.push(`${label} must be an ISO timestamp`);
        return;
    }
    const timestamp = Date.parse(value);
    if (!Number.isFinite(timestamp)) {
        errors.push(`${label} must be an ISO timestamp`);
        return;
    }
    const age = now.getTime() - timestamp;
    if (age < -FUTURE_CLOCK_SKEW_MS || age > PRODUCTION_FULFILLMENT_ENABLE_PREFLIGHT_MAX_AGE_MS) {
        errors.push(`${label} is not fresh`);
    }
}

function record(value: unknown, label: string, errors: string[]): Record<string, unknown> | null {
    if (!isRecord(value)) {
        errors.push(`${label} must be an object`);
        return null;
    }
    return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validTimestamp(value: unknown): value is string {
    return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function errorCategory(error: unknown, fallback: string): string {
    if (!(error instanceof Error) || !error.message) return fallback;
    const normalized = error.message
        .toUpperCase()
        .replace(/[^A-Z0-9]+/gu, '_')
        .replace(/^_+|_+$/gu, '')
        .slice(0, 80);
    return normalized || fallback;
}
