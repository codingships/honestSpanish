import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
    buildCloudflareProductionInertCompositeEvidence,
    CLOUDFLARE_PRODUCTION_INERT_EVIDENCE_MAX_AGE_MS,
    CLOUDFLARE_PRODUCTION_INERT_TARGET,
    readCloudflareProductionInertCompositeEvidence,
} from '../../scripts/launch/cloudflare-production-inert-composite-evidence';

const WEB_PHASE1_VERSION = '11111111-1111-4111-8111-111111111111';
const WEB_HMAC_VERSION = '22222222-2222-4222-8222-222222222222';
const FULFILLMENT_VERSION = '33333333-3333-4333-8333-333333333333';

function writeJson(filePath: string, value: unknown): void {
    writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8');
}

function sha256(filePath: string): string {
    return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function phaseOneSummary(endedAt: string): Record<string, unknown> {
    return {
        schemaVersion: 1,
        status: 'OK',
        executeRequested: true,
        externalWritePerformed: true,
        phaseOneClosureStatus: 'EXECUTED_AND_NEEDS_REVIEW',
        endedAt,
        target: {
            accountId: CLOUDFLARE_PRODUCTION_INERT_TARGET.accountId,
            productionWorker: CLOUDFLARE_PRODUCTION_INERT_TARGET.webWorker,
        },
        checks: [
            { status: 'ok', name: 'fresh_fulfillment_bootstrap_health_before_web', details: [] },
            { status: 'ok', name: 'fresh_fulfillment_bootstrap_503_before_web', details: [] },
            {
                status: 'ok',
                name: 'fresh_fulfillment_bootstrap_hmac_before_web',
                details: ['workerVersionMatched=true', 'providersAbsent=true', 'proofVerified=true'],
            },
            {
                status: 'ok',
                name: 'fresh_fulfillment_bootstrap_no_cron_before_web',
                details: ['scheduleCount=0'],
            },
            {
                status: 'ok',
                name: 'fresh_fulfillment_bounded_readback_before_web',
                details: [`versionId=${FULFILLMENT_VERSION}`],
            },
            {
                status: 'ok',
                name: 'web_bootstrap_deploy_version_changed',
                details: [`currentVersionId=${WEB_PHASE1_VERSION}`, 'deployTagMatched=true'],
            },
            {
                status: 'ok',
                name: 'web_bootstrap_health_after_deploy',
                details: [`deploymentVersion=${WEB_PHASE1_VERSION}`],
            },
            { status: 'ok', name: 'web_bootstrap_secret_shape_after_deploy', details: [] },
            {
                status: 'ok',
                name: 'web_bootstrap_bounded_readback',
                details: [`versionId=${WEB_PHASE1_VERSION}`],
            },
        ],
    };
}

function webHmacSummary(endedAt: string, upstreamSha256: string): Record<string, unknown> {
    return {
        schemaVersion: 1,
        status: 'OK',
        executeRequested: true,
        externalWritePerformed: true,
        closureStatus: 'EXECUTED_AND_ATTESTED',
        endedAt,
        target: {
            accountId: CLOUDFLARE_PRODUCTION_INERT_TARGET.accountId,
            worker: CLOUDFLARE_PRODUCTION_INERT_TARGET.webWorker,
            environment: CLOUDFLARE_PRODUCTION_INERT_TARGET.webEnvironment,
        },
        checks: [
            {
                status: 'ok',
                name: 'phase1_web_fulfillment_composite_before_secrets',
                details: [
                    `sourceCompositeSha256=${upstreamSha256}`,
                    `fulfillmentVersionId=${FULFILLMENT_VERSION}`,
                ],
            },
            { status: 'ok', name: 'minimal_bootstrap_secret_shape_after_write', details: [] },
            { status: 'ok', name: 'web_bootstrap_health_post_write', details: [] },
            {
                status: 'ok',
                name: 'direct_web_bootstrap_hmac_attestation',
                details: [
                    `webVersionId=${WEB_HMAC_VERSION}`,
                    'workerVersionMatched=true',
                    'proofVerified=true',
                ],
            },
            {
                status: 'ok',
                name: 'web_bootstrap_hmac_bounded_readback',
                details: [`versionId=${WEB_HMAC_VERSION}`],
            },
        ],
    };
}

describe('Cloudflare production inert composite evidence', () => {
    it('binds fresh phase-1 and web-HMAC reports to exact web and fulfillment versions', () => {
        const workspaceRoot = mkdtempSync(path.join(tmpdir(), 'cloudflare-inert-evidence-'));
        try {
            const now = new Date('2026-07-16T10:00:00.000Z');
            const phaseSummaryPath = path.join(workspaceRoot, 'phase1-summary.json');
            const phaseEvidencePath = path.join(workspaceRoot, 'phase1-evidence.json');
            writeJson(phaseSummaryPath, phaseOneSummary(now.toISOString()));
            const phaseEvidence = buildCloudflareProductionInertCompositeEvidence({
                stage: 'phase1_web_deployed',
                generatedAt: now,
                webVersionId: WEB_PHASE1_VERSION,
                fulfillmentVersionId: FULFILLMENT_VERSION,
                sourceSummaryPath: phaseSummaryPath,
                workspaceRoot,
            });
            writeJson(phaseEvidencePath, phaseEvidence);

            const phaseValidation = readCloudflareProductionInertCompositeEvidence(phaseEvidencePath, {
                workspaceRoot,
                now,
            });
            expect(phaseValidation).toMatchObject({ valid: true, errors: [] });
            expect(phaseValidation.value).toMatchObject({
                stage: 'phase1_web_deployed',
                web: { versionId: WEB_PHASE1_VERSION },
                fulfillment: { versionId: FULFILLMENT_VERSION },
                upstreamEvidence: null,
            });

            const finalSummaryPath = path.join(workspaceRoot, 'web-hmac-summary.json');
            const finalEvidencePath = path.join(workspaceRoot, 'web-hmac-evidence.json');
            const upstreamSha256 = sha256(phaseEvidencePath);
            writeJson(finalSummaryPath, webHmacSummary(now.toISOString(), upstreamSha256));
            const finalEvidence = buildCloudflareProductionInertCompositeEvidence({
                stage: 'web_hmac_closed',
                generatedAt: now,
                webVersionId: WEB_HMAC_VERSION,
                fulfillmentVersionId: FULFILLMENT_VERSION,
                sourceSummaryPath: finalSummaryPath,
                upstreamEvidencePath: phaseEvidencePath,
                workspaceRoot,
            });
            writeJson(finalEvidencePath, finalEvidence);

            const finalValidation = readCloudflareProductionInertCompositeEvidence(finalEvidencePath, {
                workspaceRoot,
                now,
            });
            expect(finalValidation).toMatchObject({ valid: true, errors: [] });
            expect(finalValidation.value).toMatchObject({
                stage: 'web_hmac_closed',
                web: { versionId: WEB_HMAC_VERSION, proof: 'hmac_runtime_attestation' },
                fulfillment: { versionId: FULFILLMENT_VERSION },
                upstreamEvidence: { sha256: upstreamSha256, stage: 'phase1_web_deployed' },
            });
        } finally {
            rmSync(workspaceRoot, { force: true, recursive: true });
        }
    });

    it('fails closed for stale, tampered or cross-version evidence', () => {
        const workspaceRoot = mkdtempSync(path.join(tmpdir(), 'cloudflare-inert-evidence-fault-'));
        try {
            const now = new Date('2026-07-16T10:00:00.000Z');
            const summaryPath = path.join(workspaceRoot, 'phase1-summary.json');
            const evidencePath = path.join(workspaceRoot, 'phase1-evidence.json');
            writeJson(summaryPath, phaseOneSummary(now.toISOString()));
            const evidence = buildCloudflareProductionInertCompositeEvidence({
                stage: 'phase1_web_deployed',
                generatedAt: now,
                webVersionId: WEB_PHASE1_VERSION,
                fulfillmentVersionId: FULFILLMENT_VERSION,
                sourceSummaryPath: summaryPath,
                workspaceRoot,
            });
            writeJson(evidencePath, evidence);

            const stale = readCloudflareProductionInertCompositeEvidence(evidencePath, {
                workspaceRoot,
                now: new Date(now.getTime() + CLOUDFLARE_PRODUCTION_INERT_EVIDENCE_MAX_AGE_MS + 1),
            });
            expect(stale.valid).toBe(false);
            expect(stale.errors.join(' ')).toMatch(/stale/i);

            const changedSummary = phaseOneSummary(now.toISOString());
            changedSummary.status = 'FAILED';
            writeJson(summaryPath, changedSummary);
            const tampered = readCloudflareProductionInertCompositeEvidence(evidencePath, { workspaceRoot, now });
            expect(tampered.valid).toBe(false);
            expect(tampered.errors.join(' ')).toMatch(/source-summary SHA-256 mismatch/i);

            writeJson(summaryPath, phaseOneSummary(now.toISOString()));
            expect(() => buildCloudflareProductionInertCompositeEvidence({
                stage: 'phase1_web_deployed',
                generatedAt: now,
                webVersionId: WEB_PHASE1_VERSION,
                fulfillmentVersionId: '44444444-4444-4444-8444-444444444444',
                sourceSummaryPath: summaryPath,
                workspaceRoot,
            })).toThrow(/lacks versionId=/i);
        } finally {
            rmSync(workspaceRoot, { force: true, recursive: true });
        }
    });
});
