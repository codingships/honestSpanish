import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

export const CLOUDFLARE_PRODUCTION_INERT_EVIDENCE_MAX_AGE_MS = 5 * 60 * 1_000;
export const CLOUDFLARE_PRODUCTION_INERT_TARGET = {
    accountId: 'd1a22bcf6477ff2ff31d2bfb83084e44',
    webWorker: 'espanolhonesto',
    webEnvironment: 'production_bootstrap',
    fulfillmentWorker: 'espanol-honesto-fulfillment-production',
    fulfillmentEnvironment: 'production_bootstrap',
} as const;

export type CloudflareProductionInertEvidenceStage = 'phase1_web_deployed' | 'web_hmac_closed';

export interface CloudflareProductionInertCompositeEvidence {
    schemaVersion: 1;
    artifactKind: 'cloudflare_production_inert_web_fulfillment_evidence';
    stage: CloudflareProductionInertEvidenceStage;
    generatedAt: string;
    maxAgeMs: typeof CLOUDFLARE_PRODUCTION_INERT_EVIDENCE_MAX_AGE_MS;
    target: typeof CLOUDFLARE_PRODUCTION_INERT_TARGET;
    web: {
        versionId: string;
        proof: 'phase1_remote_readback' | 'hmac_runtime_attestation';
    };
    fulfillment: {
        versionId: string;
        proof: 'hmac_runtime_attestation';
    };
    sourceSummary: {
        path: string;
        sha256: string;
        endedAt: string;
    };
    upstreamEvidence: {
        path: string;
        sha256: string;
        stage: 'phase1_web_deployed';
    } | null;
    bindingSha256: string;
}

export interface CloudflareProductionInertEvidenceValidation {
    valid: boolean;
    errors: string[];
    value: CloudflareProductionInertCompositeEvidence | null;
    sha256: string | null;
}

interface BuildInput {
    stage: CloudflareProductionInertEvidenceStage;
    generatedAt: Date | string;
    webVersionId: string;
    fulfillmentVersionId: string;
    sourceSummaryPath: string;
    upstreamEvidencePath?: string | null;
    workspaceRoot?: string;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const FUTURE_SKEW_MS = 60 * 1_000;

export function buildCloudflareProductionInertCompositeEvidence(
    input: BuildInput,
): CloudflareProductionInertCompositeEvidence {
    const workspaceRoot = path.resolve(input.workspaceRoot ?? process.cwd());
    const generatedAt = input.generatedAt instanceof Date
        ? input.generatedAt.toISOString()
        : new Date(input.generatedAt).toISOString();
    const sourcePath = resolveEvidencePath(workspaceRoot, input.sourceSummaryPath);
    const sourceBytes = readFileSync(sourcePath);
    const sourceSummary = parseJsonRecord(sourceBytes, 'Cloudflare inert source summary');
    const sourceEndedAt = typeof sourceSummary.endedAt === 'string' ? sourceSummary.endedAt : '';
    const upstreamPath = input.upstreamEvidencePath
        ? resolveEvidencePath(workspaceRoot, input.upstreamEvidencePath)
        : null;
    const upstreamBytes = upstreamPath ? readFileSync(upstreamPath) : null;
    const withoutBinding = {
        schemaVersion: 1 as const,
        artifactKind: 'cloudflare_production_inert_web_fulfillment_evidence' as const,
        stage: input.stage,
        generatedAt,
        maxAgeMs: CLOUDFLARE_PRODUCTION_INERT_EVIDENCE_MAX_AGE_MS,
        target: CLOUDFLARE_PRODUCTION_INERT_TARGET,
        web: {
            versionId: input.webVersionId,
            proof: input.stage === 'phase1_web_deployed'
                ? 'phase1_remote_readback' as const
                : 'hmac_runtime_attestation' as const,
        },
        fulfillment: {
            versionId: input.fulfillmentVersionId,
            proof: 'hmac_runtime_attestation' as const,
        },
        sourceSummary: {
            path: relativeEvidencePath(workspaceRoot, sourcePath),
            sha256: sha256(sourceBytes),
            endedAt: sourceEndedAt,
        },
        upstreamEvidence: upstreamPath && upstreamBytes ? {
            path: relativeEvidencePath(workspaceRoot, upstreamPath),
            sha256: sha256(upstreamBytes),
            stage: 'phase1_web_deployed' as const,
        } : null,
    };
    const evidence: CloudflareProductionInertCompositeEvidence = {
        ...withoutBinding,
        bindingSha256: sha256(Buffer.from(stableJson(withoutBinding), 'utf8')),
    };
    const validation = validateCloudflareProductionInertCompositeEvidence(evidence, {
        workspaceRoot,
        now: new Date(generatedAt),
    });
    if (!validation.valid) {
        throw new Error(`Cloudflare inert composite evidence is invalid: ${validation.errors.join('; ')}`);
    }
    return evidence;
}

export function readCloudflareProductionInertCompositeEvidence(
    evidencePath: string,
    options: { workspaceRoot?: string; now?: Date } = {},
): CloudflareProductionInertEvidenceValidation {
    const workspaceRoot = path.resolve(options.workspaceRoot ?? process.cwd());
    try {
        const absolutePath = resolveEvidencePath(workspaceRoot, evidencePath);
        const bytes = readFileSync(absolutePath);
        const raw = JSON.parse(bytes.toString('utf8')) as unknown;
        const validation = validateCloudflareProductionInertCompositeEvidence(raw, {
            workspaceRoot,
            now: options.now,
        });
        return { ...validation, sha256: sha256(bytes) };
    } catch (error) {
        return {
            valid: false,
            errors: [safeError(error)],
            value: null,
            sha256: null,
        };
    }
}

export function validateCloudflareProductionInertCompositeEvidence(
    raw: unknown,
    options: { workspaceRoot?: string; now?: Date } = {},
): CloudflareProductionInertEvidenceValidation {
    const errors: string[] = [];
    const workspaceRoot = path.resolve(options.workspaceRoot ?? process.cwd());
    const now = options.now ?? new Date();
    if (!isRecord(raw)) {
        return { valid: false, errors: ['Cloudflare inert evidence must be a JSON object.'], value: null, sha256: null };
    }
    const target = isRecord(raw.target) ? raw.target : {};
    const web = isRecord(raw.web) ? raw.web : {};
    const fulfillment = isRecord(raw.fulfillment) ? raw.fulfillment : {};
    const sourceSummary = isRecord(raw.sourceSummary) ? raw.sourceSummary : {};
    const upstreamEvidence = raw.upstreamEvidence === null
        ? null
        : isRecord(raw.upstreamEvidence) ? raw.upstreamEvidence : {};
    const stage = raw.stage;

    if (raw.schemaVersion !== 1
        || raw.artifactKind !== 'cloudflare_production_inert_web_fulfillment_evidence'
        || !['phase1_web_deployed', 'web_hmac_closed'].includes(String(stage))) {
        errors.push('Cloudflare inert evidence header is invalid.');
    }
    if (stableJson(target) !== stableJson(CLOUDFLARE_PRODUCTION_INERT_TARGET)) {
        errors.push('Cloudflare inert evidence target mismatch.');
    }
    if (raw.maxAgeMs !== CLOUDFLARE_PRODUCTION_INERT_EVIDENCE_MAX_AGE_MS) {
        errors.push('Cloudflare inert evidence freshness contract mismatch.');
    }
    requireFreshTimestamp(raw.generatedAt, now, 'Cloudflare inert composite evidence', errors);
    if (!UUID_PATTERN.test(String(web.versionId ?? '')) || !UUID_PATTERN.test(String(fulfillment.versionId ?? ''))) {
        errors.push('Cloudflare inert evidence contains an invalid Worker version id.');
    }
    if (web.proof !== (stage === 'phase1_web_deployed' ? 'phase1_remote_readback' : 'hmac_runtime_attestation')
        || fulfillment.proof !== 'hmac_runtime_attestation') {
        errors.push('Cloudflare inert evidence proof mode mismatch.');
    }
    if (!SHA256_PATTERN.test(String(sourceSummary.sha256 ?? ''))
        || typeof sourceSummary.path !== 'string'
        || typeof sourceSummary.endedAt !== 'string') {
        errors.push('Cloudflare inert evidence source-summary binding is malformed.');
    }
    requireFreshTimestamp(sourceSummary.endedAt, now, 'Cloudflare inert source summary', errors);

    let sourceReport: Record<string, unknown> | null = null;
    try {
        const sourcePath = resolveEvidencePath(workspaceRoot, String(sourceSummary.path ?? ''));
        const sourceBytes = readFileSync(sourcePath);
        if (sha256(sourceBytes) !== sourceSummary.sha256) errors.push('Cloudflare inert source-summary SHA-256 mismatch.');
        sourceReport = parseJsonRecord(sourceBytes, 'Cloudflare inert source summary');
        if (sourceReport.endedAt !== sourceSummary.endedAt) errors.push('Cloudflare inert source-summary endedAt mismatch.');
    } catch (error) {
        errors.push(safeError(error));
    }

    if (stage === 'phase1_web_deployed') {
        if (upstreamEvidence !== null) errors.push('Phase-1 inert evidence must not contain upstream evidence.');
    } else if (!upstreamEvidence
        || typeof upstreamEvidence.path !== 'string'
        || !SHA256_PATTERN.test(String(upstreamEvidence.sha256 ?? ''))
        || upstreamEvidence.stage !== 'phase1_web_deployed') {
        errors.push('Web-HMAC inert evidence lacks its exact phase-1 upstream binding.');
    } else {
        const upstream = readCloudflareProductionInertCompositeEvidence(upstreamEvidence.path, { workspaceRoot, now });
        if (!upstream.valid || !upstream.value) {
            errors.push(...upstream.errors.map((error) => `upstream: ${error}`));
        } else {
            if (upstream.sha256 !== upstreamEvidence.sha256) errors.push('Phase-1 upstream evidence SHA-256 mismatch.');
            if (upstream.value.stage !== 'phase1_web_deployed') errors.push('Phase-1 upstream evidence stage mismatch.');
            if (upstream.value.fulfillment.versionId !== fulfillment.versionId) {
                errors.push('Fulfillment version changed between phase-1 and web-HMAC evidence.');
            }
        }
    }

    if (sourceReport) validateSourceReport(
        sourceReport,
        stage as CloudflareProductionInertEvidenceStage,
        String(web.versionId ?? ''),
        String(fulfillment.versionId ?? ''),
        upstreamEvidence && isRecord(upstreamEvidence) ? String(upstreamEvidence.sha256 ?? '') : null,
        errors,
    );

    const { bindingSha256: _bindingSha256, ...withoutBinding } = raw;
    const expectedBinding = sha256(Buffer.from(stableJson(withoutBinding), 'utf8'));
    if (!SHA256_PATTERN.test(String(raw.bindingSha256 ?? '')) || raw.bindingSha256 !== expectedBinding) {
        errors.push('Cloudflare inert evidence binding SHA-256 mismatch.');
    }

    return {
        valid: errors.length === 0,
        errors,
        value: errors.length === 0 ? raw as unknown as CloudflareProductionInertCompositeEvidence : null,
        sha256: null,
    };
}

function validateSourceReport(
    report: Record<string, unknown>,
    stage: CloudflareProductionInertEvidenceStage,
    webVersionId: string,
    fulfillmentVersionId: string,
    upstreamSha256: string | null,
    errors: string[],
): void {
    const target = isRecord(report.target) ? report.target : {};
    const checks = Array.isArray(report.checks) ? report.checks.filter(isRecord) : [];
    if (report.schemaVersion !== 1 || report.status !== 'OK' || report.executeRequested !== true) {
        errors.push('Cloudflare inert source report is not an executed OK report.');
    }
    if (stage === 'phase1_web_deployed') {
        if (report.phaseOneClosureStatus !== 'EXECUTED_AND_NEEDS_REVIEW'
            || report.externalWritePerformed !== true
            || target.accountId !== CLOUDFLARE_PRODUCTION_INERT_TARGET.accountId
            || target.productionWorker !== CLOUDFLARE_PRODUCTION_INERT_TARGET.webWorker) {
            errors.push('Cloudflare phase-1 source report target or closure mismatch.');
        }
        requireOkCheck(checks, 'fresh_fulfillment_bootstrap_health_before_web', [], errors);
        requireOkCheck(checks, 'fresh_fulfillment_bootstrap_503_before_web', [], errors);
        requireOkCheck(checks, 'fresh_fulfillment_bootstrap_hmac_before_web', [
            'workerVersionMatched=true', 'providersAbsent=true', 'proofVerified=true',
        ], errors);
        requireOkCheck(checks, 'fresh_fulfillment_bootstrap_no_cron_before_web', ['scheduleCount=0'], errors);
        requireOkCheck(checks, 'fresh_fulfillment_bounded_readback_before_web', [
            `versionId=${fulfillmentVersionId}`,
        ], errors);
        requireOkCheck(checks, 'web_bootstrap_deploy_version_changed', [
            `currentVersionId=${webVersionId}`, 'deployTagMatched=true',
        ], errors);
        requireOkCheck(checks, 'web_bootstrap_health_after_deploy', [`deploymentVersion=${webVersionId}`], errors);
        requireOkCheck(checks, 'web_bootstrap_secret_shape_after_deploy', [], errors);
        requireOkCheck(checks, 'web_bootstrap_bounded_readback', [`versionId=${webVersionId}`], errors);
        return;
    }

    const reconciled = report.closureStatus === 'RECONCILED_STOP'
        && report.externalWritePerformed === false
        && hasOkCheck(checks, 'bootstrap_hmac_readonly_reconciliation');
    const executed = report.closureStatus === 'EXECUTED_AND_ATTESTED'
        && report.externalWritePerformed === true;
    if ((!reconciled && !executed)
        || target.accountId !== CLOUDFLARE_PRODUCTION_INERT_TARGET.accountId
        || target.worker !== CLOUDFLARE_PRODUCTION_INERT_TARGET.webWorker
        || target.environment !== CLOUDFLARE_PRODUCTION_INERT_TARGET.webEnvironment) {
        errors.push('Cloudflare web-HMAC source report target or closure mismatch.');
    }
    requireOkCheck(checks, 'phase1_web_fulfillment_composite_before_secrets', [
        `sourceCompositeSha256=${upstreamSha256 ?? 'missing'}`,
        `fulfillmentVersionId=${fulfillmentVersionId}`,
    ], errors);
    requireOkCheck(checks, 'minimal_bootstrap_secret_shape_after_write', [], errors);
    requireOkCheck(checks, 'web_bootstrap_health_post_write', [], errors);
    requireOkCheck(checks, 'direct_web_bootstrap_hmac_attestation', [
        `webVersionId=${webVersionId}`, 'workerVersionMatched=true', 'proofVerified=true',
    ], errors);
    requireOkCheck(checks, 'web_bootstrap_hmac_bounded_readback', [`versionId=${webVersionId}`], errors);
}

function requireOkCheck(
    checks: Record<string, unknown>[],
    name: string,
    requiredDetails: string[],
    errors: string[],
): void {
    const matches = checks.filter((check) => check.name === name && check.status === 'ok');
    if (matches.length !== 1) {
        errors.push(`Cloudflare inert source report requires exactly one ok ${name} check.`);
        return;
    }
    const details = Array.isArray(matches[0].details) ? matches[0].details : [];
    for (const detail of requiredDetails) {
        if (!details.includes(detail)) errors.push(`Cloudflare inert source report ${name} lacks ${detail}.`);
    }
}

function hasOkCheck(checks: Record<string, unknown>[], name: string): boolean {
    return checks.some((check) => check.name === name && check.status === 'ok');
}

function requireFreshTimestamp(raw: unknown, now: Date, label: string, errors: string[]): void {
    const timestamp = typeof raw === 'string' ? Date.parse(raw) : Number.NaN;
    const age = now.getTime() - timestamp;
    if (!Number.isFinite(timestamp)) errors.push(`${label} timestamp is invalid.`);
    else if (age < -FUTURE_SKEW_MS) errors.push(`${label} timestamp is in the future.`);
    else if (age > CLOUDFLARE_PRODUCTION_INERT_EVIDENCE_MAX_AGE_MS) errors.push(`${label} is stale.`);
}

function resolveEvidencePath(workspaceRoot: string, candidate: string): string {
    if (!candidate || path.isAbsolute(candidate)) {
        const absolute = path.resolve(candidate || workspaceRoot);
        if (absolute === workspaceRoot || !isWithin(workspaceRoot, absolute)) {
            throw new Error('Cloudflare inert evidence path escapes the workspace root.');
        }
        return absolute;
    }
    const absolute = path.resolve(workspaceRoot, candidate);
    if (!isWithin(workspaceRoot, absolute)) throw new Error('Cloudflare inert evidence path escapes the workspace root.');
    return absolute;
}

function relativeEvidencePath(workspaceRoot: string, absolutePath: string): string {
    const relative = path.relative(workspaceRoot, absolutePath);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
        throw new Error('Cloudflare inert evidence source must be inside the workspace root.');
    }
    return relative.split(path.sep).join('/');
}

function isWithin(root: string, candidate: string): boolean {
    const relative = path.relative(root, candidate);
    return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function parseJsonRecord(bytes: Buffer, label: string): Record<string, unknown> {
    const parsed = JSON.parse(bytes.toString('utf8')) as unknown;
    if (!isRecord(parsed)) throw new Error(`${label} must be a JSON object.`);
    return parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function sha256(bytes: Uint8Array): string {
    return createHash('sha256').update(bytes).digest('hex');
}

function stableJson(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
    if (!isRecord(value)) return JSON.stringify(value) ?? 'null';
    return `{${Object.keys(value).sort().map((key) => (
        `${JSON.stringify(key)}:${stableJson(value[key])}`
    )).join(',')}}`;
}

function safeError(error: unknown): string {
    return (error instanceof Error ? error.message : String(error)).replace(/\r?\n/gu, ' ').slice(0, 500);
}
