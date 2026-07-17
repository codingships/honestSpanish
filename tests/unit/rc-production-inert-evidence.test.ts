import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
    RC_PRODUCTION_INERT_BLOCKER_ID,
    assessRcProductionInertEvidence as assessRcProductionInertEvidenceWithSource,
} from '../../scripts/launch/rc-production-inert-evidence';
import {
    CLOUDFLARE_PRODUCTION_SOURCE_IDENTITY_PATHS,
    computeCloudflareProductionSourceSha256,
    type CloudflareProductionSourceIdentity,
} from '../../scripts/launch/cloudflare-production-evidence';
import {
    classifyWorkerWriteProviderResult,
    productionBootstrapVersionBindingTypes,
    reconcileWorkerWriteCheckpoint,
    startWorkerWriteCheckpoint,
} from '../../scripts/launch/cloudflare-production-worker-safety';
import {
    buildCloudflareProductionInertCompositeEvidence,
    CLOUDFLARE_PRODUCTION_INERT_TARGET,
} from '../../scripts/launch/cloudflare-production-inert-composite-evidence';
import {
    productionRolloutAllowlistSha256,
    productionRolloutMigrationManifestSha256,
} from '../../scripts/launch/supabase-production-rollout-runner-shared';
import {
    PRODUCTION_EXPECTED_HISTORY_COUNT,
    PRODUCTION_INERT_ZERO_ROW_TABLES,
    productionInertDatabaseStateSha256,
} from '../../scripts/launch/production-inert-final-readonly-shared';
import { FIXTURE_CLEANUP_TARGET } from '../../scripts/launch/production-fixture-cleanup-shared';

const now = new Date('2026-07-15T12:00:00.000Z');
const WEB_PHASE1_VERSION = '11111111-1111-4111-8111-111111111111';
const WEB_HMAC_VERSION = '22222222-2222-4222-8222-222222222222';
const FULFILLMENT_VERSION = '33333333-3333-4333-8333-333333333333';
const temporaryDirectories: string[] = [];
const cloudflareSourceIdentity = testCloudflareSourceIdentity();
const cloudflarePlanCheckNames = [
    'bootstrap_secret_runner_source',
    'wrangler_production_bootstrap',
    'bootstrap_runtime_inertness_source',
    'final_live_route_preserved',
    'phase1_web_fulfillment_composite_before_secrets',
    'plan_mode_no_external_write',
] as const;
const cloudflarePlanWithheldNames = [
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
] as const;

function cloudflarePlanOnlySummary(
    options: {
        status?: 'OK' | 'WARNING';
        checks?: Array<Record<string, unknown>>;
        captures?: Array<Record<string, unknown>>;
    } = {},
): Record<string, unknown> {
    const status = options.status ?? 'OK';
    return {
        schemaVersion: 1,
        status,
        executeRequested: false,
        approvalMatched: false,
        externalWriteAttempted: false,
        externalWritePerformed: false,
        closureStatus: 'PLAN_ONLY_READY',
        target: {
            accountId: 'd1a22bcf6477ff2ff31d2bfb83084e44',
            worker: 'espanolhonesto',
            environment: 'production_bootstrap',
            directUrl: 'https://espanolhonesto.alindev95.workers.dev',
            supabaseRef: 'vkkahxsybhbutszerawz',
            fulfillmentUrl: 'https://espanol-honesto-fulfillment-production.alindev95.workers.dev',
            customDomains: ['espanolhonesto.com', 'www.espanolhonesto.com'],
        },
        requiredSecretNames: ['INTERNAL_JOB_SECRET'],
        explicitlyWithheldSecretNames: cloudflarePlanWithheldNames,
        startedAt: '2026-07-15T11:59:00.000Z',
        endedAt: '2026-07-15T11:59:00.001Z',
        checks: options.checks ?? cloudflarePlanCheckNames.map((name) => ({
            name,
            status: status === 'WARNING' && name === 'phase1_web_fulfillment_composite_before_secrets'
                ? 'warning'
                : 'ok',
            message: 'canonical plan check',
            details: [],
        })),
        captures: options.captures ?? [],
    };
}

function assessRcProductionInertEvidence(outputsRoot: string, at = now) {
    return assessRcProductionInertEvidenceWithSource(outputsRoot, at, cloudflareSourceIdentity);
}

afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
        rmSync(directory, { recursive: true, force: true });
    }
});

describe('computed RC production-inert evidence', () => {
    it('blocks with one computed RC check when canonical production preparation is absent', () => {
        const root = temporaryOutputs();
        const assessment = assessRcProductionInertEvidence(root, now);

        expect(assessment.ready).toBe(false);
        expect(assessment.blocker?.id).toBe(RC_PRODUCTION_INERT_BLOCKER_ID);
        expect(assessment.requirements.filter((requirement) => requirement.status === 'open').map(({ id }) => id)).toEqual([
            'cloudflare_bootstrap_hmac',
            'supabase_production_rollout',
            'supabase_auth_finalized',
            'supabase_production_availability',
            'supabase_auth_inert_after_preparation',
        ]);
        expect(assessment.renewableReadbacks.map(({ status }) => status)).toEqual([
            'unavailable',
            'unavailable',
        ]);
        expect(assessment.refreshRequiredBeforeExternalWrite).toBe(true);
        expect(assessment.cloudflareResolution).toBe('historical_closure_required');
    });

    it('closes only a hash-bound Cloudflare + Supabase inert preparation chain', () => {
        const root = temporaryOutputs();
        writeCompleteEvidenceChain(root);

        const assessment = assessRcProductionInertEvidence(root, now);

        expect(assessment.ready).toBe(true);
        expect(assessment.blocker).toBeNull();
        expect(assessment.requirements.every((requirement) => requirement.status === 'closed')).toBe(true);
        expect(assessment.renewableReadbacks.map(({ status }) => status)).toEqual(['fresh', 'fresh']);
        expect(assessment.refreshRequiredBeforeExternalWrite).toBe(false);
        expect(assessment.cloudflareResolution).toBe('closed');
        expect(assessment.latestEvidenceAt).toBe('2026-07-15T11:58:30.000Z');
    });

    it('accepts a read-only Cloudflare reconciliation that re-attests the same HMAC-only bootstrap', () => {
        const root = temporaryOutputs();
        writeCompleteEvidenceChain(root, { cloudflareReconciled: true });

        const assessment = assessRcProductionInertEvidence(root, now);

        expect(assessment.ready).toBe(true);
        expect(assessment.blocker).toBeNull();
    });

    it('keeps Cloudflare open after a newer ambiguous write until a later reconciliation', () => {
        const root = temporaryOutputs();
        writeCompleteEvidenceChain(root);
        writeResolvedCloudflareCheckpoint(root, '2026-07-15T11:59:00.000Z');

        expect(openRequirementIds(assessRcProductionInertEvidence(root, now))).toEqual([
            'cloudflare_bootstrap_hmac',
        ]);

        writeCloudflareCompositeClosure(root, true, '2026-07-15T11:59:30.000Z');

        expect(assessRcProductionInertEvidence(root, now).ready).toBe(true);
    });

    it('keeps Cloudflare open when a crash leaves canonical write state without a summary', () => {
        const root = temporaryOutputs();
        writeCompleteEvidenceChain(root);
        const stateRoot = path.join(
            root,
            'launch-cloudflare-production-write-state',
            'web-bootstrap-hmac-secret',
        );
        const pending = path.join(stateRoot, 'write-checkpoints-pending');
        mkdirSync(pending, { recursive: true });
        mkdirSync(path.join(stateRoot, 'execution.lock'), { recursive: true });
        writeFileSync(path.join(pending, 'crashed-write.json'), '{}\n', 'utf8');

        const assessment = assessRcProductionInertEvidence(root, now);

        expect(openRequirementIds(assessment)).toEqual(['cloudflare_bootstrap_hmac']);
        expect(assessment.requirements[0]?.reason).toContain('pending checkpoint or lock');
        expect(assessment.cloudflareResolution).toBe('write_state_reconciliation_required');
    });

    it('prioritizes reconciliation when write state exists even if no immutable closure exists', () => {
        const root = temporaryOutputs();
        const stateRoot = path.join(
            root,
            'launch-cloudflare-production-write-state',
            'web-bootstrap-hmac-secret',
        );
        const pending = path.join(stateRoot, 'write-checkpoints-pending');
        mkdirSync(pending, { recursive: true });
        mkdirSync(path.join(stateRoot, 'execution.lock'), { recursive: true });
        writeFileSync(path.join(pending, 'unknown-write.json'), '{}\n', 'utf8');

        const assessment = assessRcProductionInertEvidence(root, now);

        expect(assessment.cloudflareResolution).toBe('write_state_reconciliation_required');
        expect(assessment.requirements[0]?.reason).toContain('pending checkpoint or lock');
    });

    it('keeps Cloudflare open when a resolved checkpoint is newer than its summary until later reconciliation', () => {
        const root = temporaryOutputs();
        writeCompleteEvidenceChain(root);
        writeResolvedCloudflareCheckpoint(
            root,
            '2026-07-15T11:59:00.000Z',
            'fulfillment-bootstrap-hmac-secret',
        );

        expect(openRequirementIds(assessRcProductionInertEvidence(root, now))).toEqual([
            'cloudflare_bootstrap_hmac',
        ]);

        writeCloudflareCompositeClosure(root, true, '2026-07-15T11:59:30.000Z');

        expect(assessRcProductionInertEvidence(root, now).ready).toBe(true);
    });

    it.each([
        'fulfillment-bootstrap-deploy',
        'fulfillment-bootstrap-hmac-secret',
        'fulfillment-bootstrap-hmac-secret-recovery-delete',
        'production-queue-provision',
        'web-bootstrap-deploy',
        'web-bootstrap-hmac-secret',
    ])('invalidates a readback when scope %s writes at or after readback start', (scope) => {
        const root = temporaryOutputs();
        writeCompleteEvidenceChain(root);
        writeResolvedCloudflareCheckpoint(root, '2026-07-15T11:58:20.000Z', scope);

        expect(openRequirementIds(assessRcProductionInertEvidence(root, now))).toEqual([
            'cloudflare_bootstrap_hmac',
        ]);
    });

    it('does not fall back after a newer incomplete Cloudflare closure attempt', () => {
        const root = temporaryOutputs();
        writeCompleteEvidenceChain(root);
        mkdirSync(path.join(
            root,
            'launch-cloudflare-production-worker-bootstrap-secrets',
            '2026-07-15T11-59-00-000Z',
        ), { recursive: true });

        expect(openRequirementIds(assessRcProductionInertEvidence(root, now))).toEqual([
            'cloudflare_bootstrap_hmac',
        ]);
    });

    it('does not fall back after a newer incomplete Cloudflare runtime readback', () => {
        const root = temporaryOutputs();
        writeCompleteEvidenceChain(root);
        mkdirSync(path.join(
            root,
            'launch-cloudflare-production-runtime-readonly',
            '2026-07-15T11-59-00-000Z',
        ), { recursive: true });

        expect(openRequirementIds(assessRcProductionInertEvidence(root, now))).toEqual([
            'cloudflare_bootstrap_hmac',
        ]);
    });

    it.each(['OK', 'WARNING'] as const)(
        'ignores a newer exact %s plan-only Cloudflare attempt because it performs no write',
        (status) => {
        const root = temporaryOutputs();
        writeCompleteEvidenceChain(root);
        writeEvidence(
            root,
            'launch-cloudflare-production-worker-bootstrap-secrets',
            '2026-07-15T11-59-00-000Z',
            'summary.json',
            cloudflarePlanOnlySummary({ status }),
        );

        expect(assessRcProductionInertEvidence(root, now).ready).toBe(true);
        },
    );

    it.each([
        [[{}]],
        [[{ name: 'plan_mode_no_external_write', status: 'unknown' }]],
        [[
            { name: 'plan_mode_no_external_write', status: 'ok' },
            { name: 'plan_mode_no_external_write', status: 'ok' },
        ]],
        [[{ name: 'some_other_gate', status: 'ok' }]],
    ])('does not ignore a malformed newer plan-only Cloudflare attempt %#', (checks) => {
        const root = temporaryOutputs();
        writeCompleteEvidenceChain(root);
        writeEvidence(
            root,
            'launch-cloudflare-production-worker-bootstrap-secrets',
            '2026-07-15T11-59-00-000Z',
            'summary.json',
            cloudflarePlanOnlySummary({ status: 'WARNING', checks }),
        );

        expect(openRequirementIds(assessRcProductionInertEvidence(root, now))).toEqual([
            'cloudflare_bootstrap_hmac',
        ]);
    });

    it('does not ignore a plan-only summary that claims a command capture', () => {
        const root = temporaryOutputs();
        writeCompleteEvidenceChain(root);
        writeEvidence(
            root,
            'launch-cloudflare-production-worker-bootstrap-secrets',
            '2026-07-15T11-59-00-000Z',
            'summary.json',
            cloudflarePlanOnlySummary({ captures: [{ id: 'unexpected-command' }] }),
        );

        expect(openRequirementIds(assessRcProductionInertEvidence(root, now))).toEqual([
            'cloudflare_bootstrap_hmac',
        ]);
    });

    it('rejects plan-only Cloudflare evidence and broken Supabase receipt bindings', () => {
        const cloudflareRoot = temporaryOutputs();
        writeCompleteEvidenceChain(cloudflareRoot, { cloudflarePlanOnly: true });
        expect(openRequirementIds(assessRcProductionInertEvidence(cloudflareRoot, now))).toContain('cloudflare_bootstrap_hmac');

        const supabaseRoot = temporaryOutputs();
        const chain = writeCompleteEvidenceChain(supabaseRoot);
        const tamperedAvailability = {
            ...chain.availability,
            authPolicyReceiptSha256: 'f'.repeat(64),
        };
        writeEvidence(
            supabaseRoot,
            'launch-production-availability',
            '2026-07-15T11-06-00-000Z',
            'production-availability-receipt.json',
            tamperedAvailability,
        );
        rmSync(chain.availabilityPath);

        const assessment = assessRcProductionInertEvidence(supabaseRoot, now);
        expect(openRequirementIds(assessment)).toEqual(expect.arrayContaining([
            'supabase_production_availability',
            'supabase_auth_inert_after_preparation',
        ]));
    });

    it('requires a final read-only Supabase/Auth sandwich after availability', () => {
        const root = temporaryOutputs();
        writeCompleteEvidenceChain(root, { omitFinalSupabase: true });

        const missing = assessRcProductionInertEvidence(root, now);
        expect(openRequirementIds(missing)).toEqual(['supabase_auth_inert_after_preparation']);
    });

    it('does not fall back to an older final read-only receipt after a newer broken binding', () => {
        const root = temporaryOutputs();
        const chain = writeCompleteEvidenceChain(root);
        writeFinalSupabaseCapture(
            root,
            '2026-07-15T11-55-00-000Z',
            {
                ...finalSupabaseReceipt(
                    chain.rolloutSha256,
                    chain.authPolicySha256,
                    'f'.repeat(64),
                ),
                observedAt: '2026-07-15T11:55:00.000Z',
                expiresAt: '2026-07-15T12:10:00.000Z',
            },
        );

        expect(openRequirementIds(assessRcProductionInertEvidence(root, now))).toEqual([
            'supabase_auth_inert_after_preparation',
        ]);
    });

    it('does not fall back to an older success after a newer failed or in-progress final capture', () => {
        for (const status of ['CAPTURE_FAILED', 'CAPTURE_IN_PROGRESS'] as const) {
            const root = temporaryOutputs();
            writeCompleteEvidenceChain(root);
            writeEvidence(
                root,
                'launch-production-inert-final-readonly',
                '2026-07-15T11-55-00-000Z',
                'summary.json',
                {
                    schemaVersion: 1,
                    mode: 'capture-readonly',
                    status,
                    targetEnvironment: 'production',
                    targetProjectRef: 'vkkahxsybhbutszerawz',
                    startedAt: '2026-07-15T11:55:00.000Z',
                    finishedAt: status === 'CAPTURE_FAILED' ? '2026-07-15T11:55:01.000Z' : null,
                    receiptSha256: null,
                    receiptFile: null,
                    receiptObservedAt: null,
                    receiptExpiresAt: null,
                    failureCategory: status === 'CAPTURE_FAILED' ? 'DATABASE_READBACK_FAILED' : null,
                    externalWritePerformed: false,
                },
            );

            expect(openRequirementIds(assessRcProductionInertEvidence(root, now))).toEqual([
                'supabase_auth_inert_after_preparation',
            ]);
        }
    });

    it('ignores a newer plan-only final directory after a successful capture', () => {
        const root = temporaryOutputs();
        writeCompleteEvidenceChain(root);
        writeEvidence(
            root,
            'launch-production-inert-final-readonly',
            '2026-07-15T11-59-00-000Z',
            'plan.json',
            { schemaVersion: 1, status: 'PLAN_ONLY_NO_NETWORK' },
        );

        expect(assessRcProductionInertEvidence(root, now).ready).toBe(true);
    });

    it('keeps historical closure valid when only the renewable Supabase readback expires', () => {
        const root = temporaryOutputs();
        writeCompleteEvidenceChain(root);

        const staleAssessment = assessRcProductionInertEvidence(
            root,
            new Date('2026-07-15T12:21:00.000Z'),
        );

        expect(staleAssessment.ready).toBe(true);
        expect(openRequirementIds(staleAssessment)).toEqual([]);
        expect(staleAssessment.renewableReadbacks).toMatchObject([
            { id: 'cloudflare_runtime_readback', status: 'fresh' },
            { id: 'supabase_inert_final_readback', status: 'refresh_required' },
        ]);
        expect(staleAssessment.refreshRequiredBeforeExternalWrite).toBe(true);
    });

    it('keeps historical closure valid when both renewable readbacks expire', () => {
        const root = temporaryOutputs();
        writeCompleteEvidenceChain(root);

        const assessment = assessRcProductionInertEvidence(
            root,
            new Date('2026-07-15T12:31:00.000Z'),
        );

        expect(assessment.ready).toBe(true);
        expect(assessment.blocker).toBeNull();
        expect(assessment.renewableReadbacks.map(({ status }) => status)).toEqual([
            'refresh_required',
            'refresh_required',
        ]);
        expect(assessment.refreshRequiredBeforeExternalWrite).toBe(true);
    });

    it('requires a renewable GET-only Cloudflare readback after the immutable HMAC receipt', () => {
        const root = temporaryOutputs();
        writeCompleteEvidenceChain(root, { omitCloudflareRuntime: true });

        expect(openRequirementIds(assessRcProductionInertEvidence(root, now))).toEqual([
            'cloudflare_bootstrap_hmac',
        ]);
        expect(assessRcProductionInertEvidence(root, now).renewableReadbacks[0]).toMatchObject({
            id: 'cloudflare_runtime_readback',
            status: 'unavailable',
        });
        expect(assessRcProductionInertEvidence(root, now).cloudflareResolution).toBe('readback_only');
    });

    it('renews an old immutable HMAC receipt without another Cloudflare write', () => {
        const root = temporaryOutputs();
        const chain = writeCompleteEvidenceChain(root);
        writeCloudflareRuntimeReadback(root, '2026-07-15T12:20:00.000Z');
        writeFinalSupabaseCapture(
            root,
            '2026-07-15T12-20-00-000Z',
            {
                ...finalSupabaseReceipt(
                    chain.rolloutSha256,
                    chain.authPolicySha256,
                    createHash('sha256').update(readFileSync(chain.availabilityPath)).digest('hex'),
                ),
                observedAt: '2026-07-15T12:20:00.000Z',
                expiresAt: '2026-07-15T12:35:00.000Z',
            },
        );

        const renewed = assessRcProductionInertEvidence(
            root,
            new Date('2026-07-15T12:21:00.000Z'),
        );
        expect(renewed.ready).toBe(true);
        expect(renewed.renewableReadbacks.map(({ status }) => status)).toEqual(['fresh', 'fresh']);
        expect(renewed.refreshRequiredBeforeExternalWrite).toBe(false);
    });

    it('does not accept a newer Cloudflare readback whose version drifts from the HMAC receipt', () => {
        const root = temporaryOutputs();
        writeCompleteEvidenceChain(root);
        writeCloudflareRuntimeReadback(
            root,
            '2026-07-15T11:59:00.000Z',
            'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        );

        expect(openRequirementIds(assessRcProductionInertEvidence(root, now))).toEqual([
            'cloudflare_bootstrap_hmac',
        ]);
    });

    it('independently requires zero sessions, zero refresh tokens and all rollout migrations', () => {
        for (const unsafeField of [
            { authSessionsRemaining: 1 },
            { authRefreshTokensRemaining: 1 },
            { rolloutMigrationsVerified: 24 },
        ]) {
            const root = temporaryOutputs();
            const chain = writeCompleteEvidenceChain(root);
            writeEvidence(
                root,
                'launch-production-availability',
                '2026-07-15T11-51-00-000Z',
                'production-availability-receipt.json',
                {
                    ...chain.availability,
                    ...unsafeField,
                    verifiedAt: '2026-07-15T11:51:00.000Z',
                },
            );
            rmSync(chain.availabilityPath);

            expect(openRequirementIds(assessRcProductionInertEvidence(root, now))).toEqual(expect.arrayContaining([
                'supabase_production_availability',
                'supabase_auth_inert_after_preparation',
            ]));
        }
    });

    it('does not combine an older complete chain with a newer unfinished rollout', () => {
        const root = temporaryOutputs();
        const chain = writeCompleteEvidenceChain(root);
        const newerAuth = writeEvidence(
            root,
            'launch-supabase-auth-config-preflight',
            '2026-07-15T11-10-00-000Z',
            'auth-inert-receipt.json',
            authInertReceipt('2026-07-15T11:10:00.000Z'),
        );
        writeEvidence(
            root,
            'launch-supabase-production-rollout-runner',
            '2026-07-15T11-20-00-000Z',
            'production-rollout-receipt.json',
            rolloutReceipt(
                newerAuth.sha256,
                '2026-07-15T11:20:00.000Z',
                chain.publicCleanupSha256,
                chain.preservationPolicySha256,
            ),
        );

        const assessment = assessRcProductionInertEvidence(root, now);

        expect(assessment.ready).toBe(false);
        expect(openRequirementIds(assessment)).toEqual([
            'supabase_auth_finalized',
            'supabase_production_availability',
            'supabase_auth_inert_after_preparation',
        ]);
    });

    it('does not fall back when the newest rollout has a broken Auth-inert binding', () => {
        const root = temporaryOutputs();
        const chain = writeCompleteEvidenceChain(root);
        writeEvidence(
            root,
            'launch-supabase-production-rollout-runner',
            '2026-07-15T11-20-00-000Z',
            'production-rollout-receipt.json',
            rolloutReceipt(
                'f'.repeat(64),
                '2026-07-15T11:20:00.000Z',
                chain.publicCleanupSha256,
                chain.preservationPolicySha256,
            ),
        );

        const assessment = assessRcProductionInertEvidence(root, now);

        expect(assessment.ready).toBe(false);
        expect(openRequirementIds(assessment)).toEqual([
            'supabase_production_rollout',
            'supabase_auth_finalized',
            'supabase_production_availability',
            'supabase_auth_inert_after_preparation',
        ]);
    });

    it('rejects a rollout whose Auth-inert proof was already older than 15 minutes', () => {
        const root = temporaryOutputs();
        const chain = writeCompleteEvidenceChain(root);
        writeEvidence(
            root,
            'launch-supabase-production-rollout-runner',
            '2026-07-15T10-30-00-000Z',
            'production-rollout-receipt.json',
            rolloutReceipt(
                chain.initialAuthSha256,
                '2026-07-15T10:30:00.000Z',
                chain.publicCleanupSha256,
                chain.preservationPolicySha256,
            ),
        );

        expect(openRequirementIds(assessRcProductionInertEvidence(root, now))).toEqual([
            'supabase_production_rollout',
            'supabase_auth_finalized',
            'supabase_production_availability',
            'supabase_auth_inert_after_preparation',
        ]);
    });

    it('rejects non-canonical rollout allowlist and migration-manifest hashes', () => {
        for (const field of ['allowlistSha256', 'migrationManifestSha256'] as const) {
            const root = temporaryOutputs();
            const chain = writeCompleteEvidenceChain(root);
            const receipt = rolloutReceipt(
                chain.initialAuthSha256,
                '2026-07-15T10:21:00.000Z',
                chain.publicCleanupSha256,
                chain.preservationPolicySha256,
            );
            receipt[field] = 'f'.repeat(64);
            writeEvidence(
                root,
                'launch-supabase-production-rollout-runner',
                '2026-07-15T10-21-00-000Z',
                'production-rollout-receipt.json',
                receipt,
            );

            expect(openRequirementIds(assessRcProductionInertEvidence(root, now))).toEqual([
                'supabase_production_rollout',
                'supabase_auth_finalized',
                'supabase_production_availability',
                'supabase_auth_inert_after_preparation',
            ]);
        }
    });

    it('requires the rollout preservation policy to match the linked public-cleanup receipt', () => {
        const root = temporaryOutputs();
        const chain = writeCompleteEvidenceChain(root);
        writeEvidence(
            root,
            'launch-supabase-production-rollout-runner',
            '2026-07-15T11-20-00-000Z',
            'production-rollout-receipt.json',
            rolloutReceipt(
                chain.initialAuthSha256,
                '2026-07-15T11:20:00.000Z',
                chain.publicCleanupSha256,
                'f'.repeat(64),
            ),
        );

        expect(openRequirementIds(assessRcProductionInertEvidence(root, now))).toEqual([
            'supabase_production_rollout',
            'supabase_auth_finalized',
            'supabase_production_availability',
            'supabase_auth_inert_after_preparation',
        ]);
    });

    it('rejects a rollout receipt that omits the preservation-policy binding', () => {
        const root = temporaryOutputs();
        const chain = writeCompleteEvidenceChain(root);
        const receipt = rolloutReceipt(
            chain.initialAuthSha256,
            '2026-07-15T10:20:00.000Z',
            chain.publicCleanupSha256,
            chain.preservationPolicySha256,
        );
        delete receipt.preservationPolicySha256;
        writeFileSync(chain.rolloutPath, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');

        expect(openRequirementIds(assessRcProductionInertEvidence(root, now))).toEqual([
            'supabase_production_rollout',
            'supabase_auth_finalized',
            'supabase_production_availability',
            'supabase_auth_inert_after_preparation',
        ]);
    });

    it('wires the computed blocker into status and therefore into the RC gate', () => {
        const status = readFileSync('scripts/launch/status.ts', 'utf8');
        const releaseCandidate = readFileSync('scripts/launch/release-candidate.ts', 'utf8');

        expect(status).toContain('assessRcProductionInertEvidence(outputsRoot, startedAt)');
        expect(status).toContain('...productionInertOpenChecks');
        expect(status).toContain('RC_BLOCKED_BY_RELEASE_CANDIDATE_CHECKS');
        expect(status).toContain('production inert RC evidence');
        expect(releaseCandidate).toContain('const readiness = statusSummary?.summary.releaseCandidateReadiness ?? null');
        expect(releaseCandidate).toContain("'RC_READY_WITH_FINAL_BLOCKERS'");
    });
});

function writeCompleteEvidenceChain(root: string, options: {
    cloudflarePlanOnly?: boolean;
    cloudflareReconciled?: boolean;
    omitCloudflareRuntime?: boolean;
    omitFinalSupabase?: boolean;
} = {}): {
    availability: Record<string, unknown>;
    availabilityPath: string;
    authPolicySha256: string;
    finalSupabasePath: string | null;
    initialAuthSha256: string;
    preservationPolicySha256: string;
    publicCleanupSha256: string;
    rolloutPath: string;
    rolloutSha256: string;
} {
    const initialAuth = writeEvidence(
        root,
        'launch-supabase-auth-config-preflight',
        '2026-07-15T10-10-00-000Z',
        'auth-inert-receipt.json',
        authInertReceipt('2026-07-15T10:10:00.000Z'),
    );
    const preservationPolicySha256 = '9'.repeat(64);
    const publicCleanup = writeEvidence(
        root,
        'launch-production-fixture-cleanup',
        '2026-07-15T10-10-00-000Z',
        'public-cleanup-receipt.json',
        publicCleanupReceipt(preservationPolicySha256),
    );
    const rollout = writeEvidence(
        root,
        'launch-supabase-production-rollout-runner',
        '2026-07-15T10-20-00-000Z',
        'production-rollout-receipt.json',
        rolloutReceipt(
            initialAuth.sha256,
            '2026-07-15T10:20:00.000Z',
            publicCleanup.sha256,
            preservationPolicySha256,
        ),
    );
    const authPolicy = writeEvidence(
        root,
        'launch-supabase-production-auth-cleanup',
        '2026-07-15T11-40-00-000Z',
        'auth-policy-receipt.json',
        finalAuthPolicyReceipt(rollout.sha256, publicCleanup.sha256),
    );
    const availability = availabilityReceipt(authPolicy.sha256);
    const availabilityEvidence = writeEvidence(
        root,
        'launch-production-availability',
        '2026-07-15T11-45-00-000Z',
        'production-availability-receipt.json',
        availability,
    );
    const finalSupabaseEvidence = !options.omitFinalSupabase
        ? writeFinalSupabaseCapture(
            root,
            '2026-07-15T11-50-00-000Z',
            finalSupabaseReceipt(rollout.sha256, authPolicy.sha256, availabilityEvidence.sha256),
        )
        : null;
    if (!options.cloudflarePlanOnly) {
        writeCloudflareCompositeClosure(
            root,
            options.cloudflareReconciled === true,
            '2026-07-15T11:58:00.000Z',
            options.omitCloudflareRuntime !== true,
        );
    }
    return {
        availability,
        availabilityPath: availabilityEvidence.file,
        authPolicySha256: authPolicy.sha256,
        finalSupabasePath: finalSupabaseEvidence?.file ?? null,
        initialAuthSha256: initialAuth.sha256,
        preservationPolicySha256,
        publicCleanupSha256: publicCleanup.sha256,
        rolloutPath: rollout.file,
        rolloutSha256: rollout.sha256,
    };
}

function writeCloudflareCompositeClosure(
    outputsRoot: string,
    reconciled: boolean,
    generatedAt: string,
    writeRuntime = true,
): void {
    const workspaceRoot = path.dirname(outputsRoot);
    const finalAt = new Date(generatedAt);
    const phaseSummaryEndedAt = new Date(finalAt.getTime() - 30_000).toISOString();
    const phaseEvidenceGeneratedAt = new Date(finalAt.getTime() - 20_000).toISOString();
    const phaseSummary = writeEvidence(
        outputsRoot,
        'launch-cloudflare-production-worker-phase1',
        phaseSummaryEndedAt.replace(/[:.]/gu, '-'),
        'summary.json',
        {
            schemaVersion: 1,
            status: 'OK',
            executeRequested: true,
            externalWritePerformed: true,
            phaseOneClosureStatus: 'EXECUTED_AND_NEEDS_REVIEW',
            endedAt: phaseSummaryEndedAt,
            target: {
                accountId: CLOUDFLARE_PRODUCTION_INERT_TARGET.accountId,
                productionWorker: CLOUDFLARE_PRODUCTION_INERT_TARGET.webWorker,
            },
            checks: [
                okCheck('fresh_fulfillment_bootstrap_health_before_web'),
                okCheck('fresh_fulfillment_bootstrap_503_before_web'),
                okCheck('fresh_fulfillment_bootstrap_hmac_before_web', [
                    'workerVersionMatched=true',
                    'providersAbsent=true',
                    'proofVerified=true',
                ]),
                okCheck('fresh_fulfillment_bootstrap_no_cron_before_web', ['scheduleCount=0']),
                okCheck('fresh_fulfillment_bounded_readback_before_web', [`versionId=${FULFILLMENT_VERSION}`]),
                okCheck('web_bootstrap_deploy_version_changed', [
                    `currentVersionId=${WEB_PHASE1_VERSION}`,
                    'deployTagMatched=true',
                ]),
                okCheck('web_bootstrap_health_after_deploy', [`deploymentVersion=${WEB_PHASE1_VERSION}`]),
                okCheck('web_bootstrap_secret_shape_after_deploy'),
                okCheck('web_bootstrap_bounded_readback', [`versionId=${WEB_PHASE1_VERSION}`]),
            ],
        },
    );
    const phaseEvidence = buildCloudflareProductionInertCompositeEvidence({
        stage: 'phase1_web_deployed',
        generatedAt: phaseEvidenceGeneratedAt,
        webVersionId: WEB_PHASE1_VERSION,
        fulfillmentVersionId: FULFILLMENT_VERSION,
        sourceSummaryPath: phaseSummary.file,
        workspaceRoot,
    });
    const phaseEvidenceWritten = writeEvidence(
        outputsRoot,
        'launch-cloudflare-production-worker-phase1',
        phaseEvidenceGeneratedAt.replace(/[:.]/gu, '-'),
        'production-inert-web-fulfillment-evidence.json',
        phaseEvidence as unknown as Record<string, unknown>,
    );
    const finalSummary = writeEvidence(
        outputsRoot,
        'launch-cloudflare-production-worker-bootstrap-secrets',
        generatedAt.replace(/[:.]/gu, '-'),
        'summary.json',
        {
            schemaVersion: 1,
            status: 'OK',
            executeRequested: true,
            externalWritePerformed: !reconciled,
            closureStatus: reconciled ? 'RECONCILED_STOP' : 'EXECUTED_AND_ATTESTED',
            endedAt: generatedAt,
            target: {
                accountId: CLOUDFLARE_PRODUCTION_INERT_TARGET.accountId,
                worker: CLOUDFLARE_PRODUCTION_INERT_TARGET.webWorker,
                environment: CLOUDFLARE_PRODUCTION_INERT_TARGET.webEnvironment,
            },
            checks: [
                okCheck('phase1_web_fulfillment_composite_before_secrets', [
                    `sourceCompositeSha256=${phaseEvidenceWritten.sha256}`,
                    `fulfillmentVersionId=${FULFILLMENT_VERSION}`,
                ]),
                okCheck('minimal_bootstrap_secret_shape_after_write'),
                okCheck('web_bootstrap_health_post_write'),
                okCheck('direct_web_bootstrap_hmac_attestation', [
                    `webVersionId=${WEB_HMAC_VERSION}`,
                    'workerVersionMatched=true',
                    'proofVerified=true',
                ]),
                okCheck('web_bootstrap_hmac_bounded_readback', [`versionId=${WEB_HMAC_VERSION}`]),
                ...(reconciled ? [okCheck('bootstrap_hmac_readonly_reconciliation')] : []),
            ],
        },
    );
    const finalEvidence = buildCloudflareProductionInertCompositeEvidence({
        stage: 'web_hmac_closed',
        generatedAt,
        webVersionId: WEB_HMAC_VERSION,
        fulfillmentVersionId: FULFILLMENT_VERSION,
        sourceSummaryPath: finalSummary.file,
        upstreamEvidencePath: phaseEvidenceWritten.file,
        workspaceRoot,
    });
    writeEvidence(
        outputsRoot,
        'launch-cloudflare-production-worker-bootstrap-secrets',
        generatedAt.replace(/[:.]/gu, '-'),
        'production-inert-web-fulfillment-evidence.json',
        finalEvidence as unknown as Record<string, unknown>,
    );
    if (writeRuntime) {
        writeCloudflareRuntimeReadback(
            outputsRoot,
            new Date(finalAt.getTime() + 30_000).toISOString(),
        );
    }
}

function writeCloudflareRuntimeReadback(
    outputsRoot: string,
    endedAt: string,
    webVersionId = WEB_HMAC_VERSION,
): void {
    const startedAt = new Date(Date.parse(endedAt) - 10_000).toISOString();
    writeEvidence(
        outputsRoot,
        'launch-cloudflare-production-runtime-readonly',
        endedAt.replace(/[:.]/gu, '-'),
        'summary.json',
        {
            schemaVersion: 2,
            startedAt,
            endedAt,
            status: 'WARNING',
            target: {
                accountId: CLOUDFLARE_PRODUCTION_INERT_TARGET.accountId,
                pagesProject: 'espanolhonesto',
                productionWorker: CLOUDFLARE_PRODUCTION_INERT_TARGET.webWorker,
                productionFulfillmentWorker: CLOUDFLARE_PRODUCTION_INERT_TARGET.fulfillmentWorker,
                stagingWorker: 'espanolhonesto-staging',
                customDomains: ['espanolhonesto.com', 'www.espanolhonesto.com'],
                productionQueue: 'espanol-honesto-fulfillment-production-queue',
                productionDeadLetterQueue: 'espanol-honesto-fulfillment-production-dlq',
            },
            safety: {
                readOnly: true,
                noExternalWrites: true,
                noSecretValuesStored: true,
                noWorkerCodeDownloaded: true,
                rawVersionBindingValuesStored: false,
            },
            checks: [
                'readonly_command_scope',
                'cloudflare_api_get_scope',
                'cloudflare_account_auth',
                'pages_project_current_domain_owner',
                'legacy_reminder_worker_neutralized',
                'evidence_source_identity',
                'local_wrangler_config_fail_closed',
                'generated_output_secret_posture',
                'production_web_current_traffic',
                'production_fulfillment_current_traffic',
                'production_worker_secret_names',
                'production_fulfillment_secret_names',
                'production_web_inert_bindings',
                'production_fulfillment_inert_bindings',
                'production_fulfillment_schedules',
                'production_queue_and_dlq_inventory',
            ].map((name) => ({ name, status: 'ok', message: 'proven', details: [] })),
            probes: [
                {
                    id: 'pages_projects',
                    status: 'ok',
                    summary: {
                        projectFound: true,
                        requiredDomainsPresent: true,
                        domainNames: [
                            'espanolhonesto.com',
                            'www.espanolhonesto.com',
                            'espanolhonesto.pages.dev',
                        ],
                    },
                },
                runtimeDeploymentProbe('production_worker_status', webVersionId),
                runtimeDeploymentProbe('production_fulfillment_status', FULFILLMENT_VERSION),
                runtimeSecretProbe('production_worker_secrets'),
                runtimeSecretProbe('production_fulfillment_secrets'),
                runtimeVersionProbe('production_worker_current_version', 'web', webVersionId),
                runtimeVersionProbe(
                    'production_fulfillment_current_version',
                    'fulfillment',
                    FULFILLMENT_VERSION,
                ),
            ],
            sourceIdentity: JSON.parse(JSON.stringify(cloudflareSourceIdentity)),
            apiInventory: {
                oauthKeyringAttested: true,
                workerScripts: {
                    state: 'ready',
                    flagged: [
                        { name: 'espanol-honesto-reminders', present: false },
                        { name: 'espanolhonesto-staging-staging', present: false },
                    ],
                    legacyHeadDeployment: {
                        state: 'ready',
                        trackedLegacyPackagePaths: [],
                        workingTreePackagePresent: false,
                        automaticDeployReferences: [],
                        gaps: [],
                    },
                },
                calls: [{ id: 'worker_scripts_list', method: 'GET', success: true, outcome: 'ok' }],
                fulfillmentSchedules: { state: 'ready', crons: [], gaps: [] },
                queue: runtimeQueue(
                    'espanol-honesto-fulfillment-production-queue',
                    'f00c0885eadb475cb9b513a4a7a8fcff',
                ),
                deadLetterQueue: runtimeQueue(
                    'espanol-honesto-fulfillment-production-dlq',
                    'e59a210ecfe243ddba945accee9f4b5a',
                ),
                gaps: [],
            },
        },
    );
}

function runtimeDeploymentProbe(id: string, versionId: string): Record<string, unknown> {
    return {
        id,
        status: 'ok',
        exitCode: 0,
        summary: {
            state: 'ready',
            primaryVersionId: versionId,
            currentVersions: [{ versionId, percentage: 100 }],
            notFound: false,
            errorPreview: null,
        },
    };
}

function runtimeSecretProbe(id: string): Record<string, unknown> {
    return {
        id,
        status: 'ok',
        exitCode: 0,
        summary: {
            count: 1,
            names: ['INTERNAL_JOB_SECRET'],
            notFound: false,
            errorPreview: null,
        },
    };
}

function runtimeVersionProbe(
    id: string,
    kind: 'web' | 'fulfillment',
    versionId: string,
): Record<string, unknown> {
    const web = kind === 'web';
    const bindingTypes = productionBootstrapVersionBindingTypes[kind];
    const bindingNames = Object.keys(bindingTypes);
    return {
        id,
        status: 'ok',
        exitCode: 0,
        summary: {
            state: 'ready',
            versionId,
            bindingNames,
            bindings: bindingNames.map((name) => ({
                name,
                type: bindingTypes[name as keyof typeof bindingTypes],
            })),
            safeValues: web ? {
                CHECKOUT_ENABLED: 'false',
                CHECKOUT_ENABLED_OVERRIDE: 'false',
                EMAIL_DAILY_RECIPIENT_LIMIT: '0',
                EMAIL_DELIVERY_MODE: 'disabled',
                EMAIL_MONTHLY_RECIPIENT_LIMIT: '0',
                NODE_ENV: 'production',
                PUBLIC_APP_ENV: 'production',
                SENTRY_ENVIRONMENT: 'production-bootstrap',
                WEB_RUNTIME_MODE: 'bootstrap',
                WORKER_IDENTITY: CLOUDFLARE_PRODUCTION_INERT_TARGET.webWorker,
            } : {
                CHECKOUT_ENABLED: 'false',
                CHECKOUT_ENABLED_OVERRIDE: 'false',
                EMAIL_DAILY_RECIPIENT_LIMIT: '0',
                EMAIL_DELIVERY_MODE: 'disabled',
                EMAIL_MONTHLY_RECIPIENT_LIMIT: '0',
                FULFILLMENT_RUNTIME_MODE: 'bootstrap',
                NODE_ENV: 'production',
                PUBLIC_APP_ENV: 'production',
                WORKER_IDENTITY: CLOUDFLARE_PRODUCTION_INERT_TARGET.fulfillmentWorker,
            },
            safeTargets: web
                ? { FULFILLMENT_SERVICE: CLOUDFLARE_PRODUCTION_INERT_TARGET.fulfillmentWorker }
                : {},
            notFound: false,
            errorPreview: null,
            rawBindingValuesStored: false,
        },
    };
}

function runtimeQueue(name: string, id: string): Record<string, unknown> {
    return {
        name,
        id,
        state: 'ready',
        settings: {
            delivery_paused: false,
            delivery_delay: 0,
            message_retention_period: 86_400,
        },
        producers: [],
        consumers: [],
        backlog: 0,
        backlogAvailable: true,
        gaps: [],
    };
}

function okCheck(name: string, details: string[] = []): Record<string, unknown> {
    return { status: 'ok', name, ...(details.length > 0 ? { details } : {}) };
}

function authInertReceipt(
    observedAt: string,
    flags = { disable_signup: true, mailer_autoconfirm: false },
): Record<string, unknown> {
    return {
        schemaVersion: 1,
        receiptKind: 'supabase_production_auth_inert_readonly',
        status: 'AUTH_INERT_VERIFIED',
        target: { environment: 'production', projectRef: 'vkkahxsybhbutszerawz' },
        flags,
        observedAt,
        source: 'supabase_management_api',
        requestMethod: 'GET',
        externalWritePerformed: false,
    };
}

function rolloutReceipt(
    authInertEvidenceSha256: string,
    completedAt = '2026-07-15T10:20:00.000Z',
    publicCleanupReceiptSha256 = '7'.repeat(64),
    preservationPolicySha256 = '9'.repeat(64),
): Record<string, unknown> {
    const hashes = Object.fromEntries([
        'scopeSha256',
        'allowlistSha256',
        'migrationManifestSha256',
        'preflightEvidenceSha256',
        'historyReconciliationManifestSha256',
        'historyReconciliationSnapshotSha256',
        'liveHistoryReconciliationSqlSha256',
        'liveHistoryReconciliationSnapshotSha256',
        'backupReceiptSha256',
        'backupArtifactSha256',
        'backupArtifactVerificationSha256',
        'authReducedQuarantinedReceiptSha256',
        'googleFixturePolicyEvidenceSha256',
        'stagingHardeningEvidenceSha256',
        'sentryProductionHardeningEvidenceSha256',
        'livePreflightSqlSha256',
        'finalVerifySqlSha256',
    ].map((key, index) => [key, (index % 10).toString().repeat(64)]));
    hashes.allowlistSha256 = productionRolloutAllowlistSha256();
    hashes.migrationManifestSha256 = productionRolloutMigrationManifestSha256();
    hashes.backupReceiptSha256 = '1'.repeat(64);
    hashes.authReducedQuarantinedReceiptSha256 = '3'.repeat(64);
    return {
        schemaVersion: 1,
        status: 'PRODUCTION_ROLLOUT_ALL_WAVES_APPLIED_AND_VERIFIED',
        targetProjectRef: 'vkkahxsybhbutszerawz',
        completedAt,
        ...hashes,
        authInertEvidenceSha256,
        publicCleanupReceiptSha256,
        preservationPolicySha256,
        through: 'deferred_rc_hardening',
        migrationCount: 25,
        finalVerificationPassed: true,
        stagingOnlyMigrationAbsent: true,
        stagingOnlyVersions: ['20260710150000', '20260713161300'],
        checkoutRemainedDisabledByOperatorAttestation: true,
        authFinalizeRequired: true,
    };
}

function publicCleanupReceipt(preservationPolicySha256: string): Record<string, unknown> {
    return {
        schemaVersion: 2,
        status: 'PUBLIC_FIXTURE_CLEANUP_EXECUTED_AND_VERIFIED',
        targetProjectRef: 'vkkahxsybhbutszerawz',
        completedAt: '2026-07-15T10:10:00.000Z',
        preservationPolicySha256,
    };
}

function finalAuthPolicyReceipt(
    productionRolloutReceiptSha256: string,
    publicCleanupReceiptSha256 = '2'.repeat(64),
): Record<string, unknown> {
    return {
        schemaVersion: 1,
        targetProjectRef: 'vkkahxsybhbutszerawz',
        status: 'CLOSED_AND_VERIFIED',
        closedAt: '2026-07-15T11:40:00.000Z',
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
        backupReceiptSha256: '1'.repeat(64),
        publicCleanupReceiptSha256,
        authReducedReceiptSha256: '3'.repeat(64),
        productionRolloutReceiptSha256,
        preservedSetSha256: '4'.repeat(64),
        preservedRoleBindingSha256: '6'.repeat(64),
        freezeCutoff: '2026-07-02T18:29:27.580Z',
        quarantineUntil: '2026-07-15T11:35:00.000Z',
        googleDriveFixtureFolders: 'UNTOUCHED_110_OBSERVED',
    };
}

function availabilityReceipt(authPolicyReceiptSha256: string): Record<string, unknown> {
    return {
        schemaVersion: 1,
        status: 'SEEDED_AND_VERIFIED',
        targetProjectRef: 'vkkahxsybhbutszerawz',
        authPolicyReceiptSha256,
        schedule: [1, 2, 3, 4, 5].map((dayOfWeek) => ({
            dayOfWeek,
            startTime: '09:00:00',
            endTime: '18:00:00',
        })),
        timezone: 'Europe/Madrid',
        authUsersRemaining: 2,
        authSessionsRemaining: 0,
        authRefreshTokensRemaining: 0,
        rolloutMigrationsVerified: 25,
        externalProvidersTouched: false,
        verifiedAt: '2026-07-15T11:45:00.000Z',
    };
}

function finalSupabaseReceipt(
    rolloutReceiptSha256: string,
    authPolicyReceiptSha256: string,
    availabilityReceiptSha256: string,
): Record<string, unknown> {
    const databaseFacts = finalDatabaseFacts();
    const databaseStateSha256 = productionInertDatabaseStateSha256({
        facts: databaseFacts,
        preservedSetSha256: '4'.repeat(64),
        preservedRoleBindingSha256: '6'.repeat(64),
        duplicateKeys: [],
        identityValuesDiscarded: true,
    });
    return {
        schemaVersion: 1,
        receiptKind: 'production_inert_final_readonly',
        status: 'PRODUCTION_INERT_FINAL_READONLY_VERIFIED',
        targetEnvironment: 'production',
        targetProjectRef: 'vkkahxsybhbutszerawz',
        rolloutReceiptSha256,
        authPolicyReceiptSha256,
        availabilityReceiptSha256,
        preservedSetSha256: '4'.repeat(64),
        preservedRoleBindingSha256: '6'.repeat(64),
        canonicalMigrationManifestSha256: productionRolloutMigrationManifestSha256(),
        databaseFacts,
        databaseStateSha256,
        authFlags: { disableSignup: true, mailerAutoconfirm: false },
        stableDatabaseReadbacks: 2,
        managementApiGetBetweenReadbacks: true,
        externalWritePerformed: false,
        observedAt: '2026-07-15T11:50:00.000Z',
        expiresAt: '2026-07-15T12:05:00.000Z',
    };
}

function finalDatabaseFacts(): Record<string, string> {
    return {
        current_database: 'postgres',
        auth_user_count: '2',
        auth_session_count: '0',
        auth_refresh_token_count: '0',
        profile_count: '2',
        profile_private_count: '2',
        profile_role_counts: '1,1,0,0',
        preserved_auth_link_count: '2',
        preserved_auth_profile_email_match_count: '2',
        preserved_expected_role_email_match_count: '2',
        preserved_private_link_count: '2',
        non_minimal_profile_count: '0',
        non_minimal_private_profile_count: '0',
        teacher_madrid_timezone_count: '1',
        package_total_count: '4',
        canonical_package_count: '4',
        canonical_package_clean_count: '4',
        canonical_package_catalog_sha256: FIXTURE_CLEANUP_TARGET.canonicalPackageSha256,
        package_catalog_version_one_count: '4',
        noncanonical_package_count: '0',
        package_local_stripe_reference_count: '0',
        legacy_jobs_absent: 'true',
        storage_owned_object_count: '0',
        ...Object.fromEntries(PRODUCTION_INERT_ZERO_ROW_TABLES.map((table) => [
            `row_count_public_${table}`,
            '0',
        ])),
        availability_total_count: '5',
        teacher_availability_count: '5',
        availability_target_count: '5',
        availability_target_days: '1,2,3,4,5',
        availability_unexpected_count: '0',
        canonical_migration_counts: '25,0',
        migration_history_total_count: String(PRODUCTION_EXPECTED_HISTORY_COUNT),
        staging_only_migration_count: '0',
    };
}

function writeFinalSupabaseCapture(
    root: string,
    directoryName: string,
    receipt: Record<string, unknown>,
): { file: string; sha256: string } {
    const written = writeEvidence(
        root,
        'launch-production-inert-final-readonly',
        directoryName,
        'production-inert-final-receipt.json',
        receipt,
    );
    const observedAt = String(receipt.observedAt);
    const observedTime = Date.parse(observedAt);
    writeEvidence(
        root,
        'launch-production-inert-final-readonly',
        directoryName,
        'summary.json',
        {
            schemaVersion: 1,
            mode: 'capture-readonly',
            status: 'PRODUCTION_INERT_FINAL_READONLY_VERIFIED',
            targetEnvironment: 'production',
            targetProjectRef: 'vkkahxsybhbutszerawz',
            startedAt: new Date(observedTime - 1_000).toISOString(),
            finishedAt: new Date(observedTime + 1_000).toISOString(),
            receiptSha256: written.sha256,
            receiptFile: 'production-inert-final-receipt.json',
            receiptObservedAt: observedAt,
            receiptExpiresAt: receipt.expiresAt,
            failureCategory: null,
            externalWritePerformed: false,
        },
    );
    return written;
}

function writeEvidence(
    root: string,
    outputName: string,
    directoryName: string,
    fileName: string,
    value: Record<string, unknown>,
): { file: string; sha256: string } {
    const directory = path.join(root, outputName, directoryName);
    mkdirSync(directory, { recursive: true });
    const file = path.join(directory, fileName);
    const source = `${JSON.stringify(value, null, 2)}\n`;
    writeFileSync(file, source, 'utf8');
    return { file, sha256: createHash('sha256').update(source).digest('hex') };
}

function writeResolvedCloudflareCheckpoint(
    root: string,
    recordedAt: string,
    scope = 'web-bootstrap-hmac-secret',
): void {
    const stateDirectory = path.join(
        root,
        'launch-cloudflare-production-write-state',
        scope,
        'write-checkpoints-resolved',
    );
    mkdirSync(stateDirectory, { recursive: true });
    let checkpoint = startWorkerWriteCheckpoint(
        'put-internal-job-secret',
        1,
        WEB_HMAC_VERSION,
        undefined,
        new Date('2026-07-15T11:18:00.000Z'),
    );
    checkpoint = classifyWorkerWriteProviderResult(checkpoint, {
        exitCode: 0,
        timedOut: false,
        errorPresent: false,
    }, new Date('2026-07-15T11:19:00.000Z'));
    checkpoint = reconcileWorkerWriteCheckpoint(checkpoint, true, new Date(recordedAt));
    writeFileSync(path.join(stateDirectory, 'resolved.json'), `${JSON.stringify(checkpoint, null, 2)}\n`, 'utf8');
}

function testCloudflareSourceIdentity(): CloudflareProductionSourceIdentity {
    const files = CLOUDFLARE_PRODUCTION_SOURCE_IDENTITY_PATHS.map((filePath) => ({
        path: filePath,
        sha256: 'a'.repeat(64),
    }));
    return {
        schemaVersion: 1,
        gitHead: 'b'.repeat(40),
        gitWorktreeDirty: false,
        dirtyPaths: [],
        unhashedDirtyPaths: [],
        sourceSha256: computeCloudflareProductionSourceSha256(files),
        files,
    };
}

function temporaryOutputs(): string {
    const workspace = mkdtempSync(path.join(os.tmpdir(), 'eh-rc-production-inert-'));
    const outputs = path.join(workspace, 'outputs');
    mkdirSync(outputs, { recursive: true });
    temporaryDirectories.push(workspace);
    return outputs;
}

function openRequirementIds(assessment: ReturnType<typeof assessRcProductionInertEvidence>): string[] {
    return assessment.requirements
        .filter((requirement) => requirement.status === 'open')
        .map((requirement) => requirement.id);
}
