import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
    assertAllowedSupabaseManagementProjectRef,
    type SupabaseAuthManagementClient,
    type SupabaseAuthManagementPatch,
} from './supabase-cli-windows-credential';

export const PRODUCTION_AUTH_INERT_RECEIPT_KIND = 'supabase_production_auth_inert_readonly';
export const PRODUCTION_AUTH_INERT_RECEIPT_MAX_AGE_MS = 15 * 60 * 1_000;

export const SUPABASE_AUTH_TARGETS = {
    staging: {
        environment: 'staging',
        projectRef: 'mzjyvmlxfpzdfdjzxxyj',
    },
    production: {
        environment: 'production',
        projectRef: 'vkkahxsybhbutszerawz',
    },
} as const;

export const STAGING_SITE_URL =
    'https://staging.espanolhonesto.com';

export const STAGING_AUTH_REDIRECTS = [
    'https://staging.espanolhonesto.com/api/auth/confirm?lang=es',
    'https://staging.espanolhonesto.com/api/auth/confirm?lang=en',
    'https://staging.espanolhonesto.com/api/auth/confirm?lang=ru',
    'https://staging.espanolhonesto.com/es/reset-password',
    'https://staging.espanolhonesto.com/en/reset-password',
    'https://staging.espanolhonesto.com/ru/reset-password',
] as const;

export type SafeAuthConfig = {
    disable_signup: boolean;
    mailer_autoconfirm: boolean;
    site_url: string;
    uri_allow_list: string;
};

export type SafeAuthConfigKey = keyof SafeAuthConfig;
export type AuthConfigPatch = SupabaseAuthManagementPatch;

export interface ProductionAuthInertReceipt {
    schemaVersion: 1;
    receiptKind: typeof PRODUCTION_AUTH_INERT_RECEIPT_KIND;
    status: 'AUTH_INERT_VERIFIED';
    target: {
        environment: 'production';
        projectRef: typeof SUPABASE_AUTH_TARGETS.production.projectRef;
    };
    flags: {
        disable_signup: true;
        mailer_autoconfirm: false;
    };
    observedAt: string;
    source: 'supabase_management_api';
    requestMethod: 'GET';
    externalWritePerformed: false;
}

export interface ProductionAuthInertEvidence {
    provided: boolean;
    valid: boolean;
    path: string | null;
    sha256: string | null;
    value: ProductionAuthInertReceipt | null;
    errors: string[];
}

export interface ProductionAuthInertValidation {
    ok: boolean;
    errors: string[];
    value: ProductionAuthInertReceipt | null;
}

export type ApprovalSpec = {
    environment: 'staging' | 'production';
    projectRef: string;
    approvalEnvVar: string;
    exactApprovalSentence: string;
};

export const PRODUCTION_AUTH_APPROVALS = {
    inert: {
        environment: 'production',
        projectRef: SUPABASE_AUTH_TARGETS.production.projectRef,
        approvalEnvVar: 'SUPABASE_AUTH_PRODUCTION_INERT_APPROVAL',
        exactApprovalSentence: 'Autorizo actualizar únicamente la configuración Auth de Supabase producción vkkahxsybhbutszerawz para disable_signup=true y mailer_autoconfirm=false, verificarla y restaurar los valores previos si falla. No autorizo otros proyectos, campos ni recursos.',
    },
    final: {
        environment: 'production',
        projectRef: SUPABASE_AUTH_TARGETS.production.projectRef,
        approvalEnvVar: 'SUPABASE_AUTH_PRODUCTION_FINAL_APPROVAL',
        exactApprovalSentence: 'Autorizo actualizar únicamente la configuración Auth de Supabase producción vkkahxsybhbutszerawz para disable_signup=false y mailer_autoconfirm=false, verificarla y restaurar los valores previos si falla. No autorizo otros proyectos, campos ni recursos.',
    },
} as const satisfies Record<string, ApprovalSpec>;

export const STAGING_AUTH_URLS_APPROVAL = {
    environment: 'staging',
    projectRef: SUPABASE_AUTH_TARGETS.staging.projectRef,
    approvalEnvVar: 'SUPABASE_AUTH_STAGING_URLS_APPROVAL',
    exactApprovalSentence: `Autorizo actualizar únicamente site_url y uri_allow_list de Supabase staging mzjyvmlxfpzdfdjzxxyj, fijando site_url=${STAGING_SITE_URL} y añadiendo ${STAGING_AUTH_REDIRECTS.join(', ')}, preservando todas las entradas exactas existentes, bloqueando antes de escribir si existe cualquier comodín amplio, verificando ambos campos y restaurando sus valores previos si falla. No autorizo producción ni otros campos o recursos.`,
} as const satisfies ApprovalSpec;

export type ChangeResult = {
    status: 'already_applied' | 'applied' | 'failed_no_change' | 'failed_rolled_back' | 'failed_rollback_unverified';
    before: SafeAuthConfig;
    desiredPatch: AuthConfigPatch;
    after: SafeAuthConfig | null;
    rollback: {
        attempted: boolean;
        verified: boolean;
        patch: AuthConfigPatch;
        after: SafeAuthConfig | null;
    };
};

type VerifiedChangeSpec = {
    client: Readonly<SupabaseAuthManagementClient>;
    buildDesiredPatch: (before: SafeAuthConfig) => AuthConfigPatch;
    verifyDesired: (
        before: SafeAuthConfig,
        after: SafeAuthConfig,
        desiredPatch: AuthConfigPatch,
    ) => boolean;
    verifyRollback?: (
        before: SafeAuthConfig,
        after: SafeAuthConfig,
        rollbackPatch: AuthConfigPatch,
    ) => boolean;
};

export function selectSafeAuthConfig(payload: unknown): SafeAuthConfig {
    if (!isRecord(payload)
        || typeof payload.disable_signup !== 'boolean'
        || typeof payload.mailer_autoconfirm !== 'boolean'
        || typeof payload.site_url !== 'string'
        || typeof payload.uri_allow_list !== 'string') {
        throw new Error('Supabase Auth config response is missing expected safe fields');
    }

    return {
        disable_signup: payload.disable_signup,
        mailer_autoconfirm: payload.mailer_autoconfirm,
        site_url: payload.site_url,
        uri_allow_list: payload.uri_allow_list,
    };
}

export function redactedPreflight(
    target: { environment: string; projectRef: string },
    config: SafeAuthConfig,
) {
    return {
        schemaVersion: 1,
        redacted: true,
        target: {
            environment: target.environment,
            projectRef: target.projectRef,
        },
        config: { ...config },
    };
}

export function productionAuthConfigIsInert(config: Pick<SafeAuthConfig, 'disable_signup' | 'mailer_autoconfirm'>): boolean {
    return config.disable_signup === true && config.mailer_autoconfirm === false;
}

export function createProductionAuthInertReceipt(
    config: Pick<SafeAuthConfig, 'disable_signup' | 'mailer_autoconfirm'>,
    observedAt = new Date(),
): ProductionAuthInertReceipt {
    assertProductionAuthConfigInert(config);
    return {
        schemaVersion: 1,
        receiptKind: PRODUCTION_AUTH_INERT_RECEIPT_KIND,
        status: 'AUTH_INERT_VERIFIED',
        target: {
            environment: SUPABASE_AUTH_TARGETS.production.environment,
            projectRef: SUPABASE_AUTH_TARGETS.production.projectRef,
        },
        flags: {
            disable_signup: true,
            mailer_autoconfirm: false,
        },
        observedAt: observedAt.toISOString(),
        source: 'supabase_management_api',
        requestMethod: 'GET',
        externalWritePerformed: false,
    };
}

export function validateProductionAuthInertReceipt(
    raw: unknown,
    now = new Date(),
): ProductionAuthInertValidation {
    if (!isRecord(raw)) {
        return { ok: false, errors: ['Production Auth inert receipt must be a JSON object.'], value: null };
    }

    const errors: string[] = [];
    requireExactKeys(raw, [
        'schemaVersion',
        'receiptKind',
        'status',
        'target',
        'flags',
        'observedAt',
        'source',
        'requestMethod',
        'externalWritePerformed',
    ], 'Production Auth inert receipt', errors);
    if (raw.schemaVersion !== 1) errors.push('Production Auth inert receipt schemaVersion must be 1.');
    if (raw.receiptKind !== PRODUCTION_AUTH_INERT_RECEIPT_KIND) errors.push('Production Auth inert receipt kind mismatch.');
    if (raw.status !== 'AUTH_INERT_VERIFIED') errors.push('Production Auth inert receipt status mismatch.');
    if (raw.source !== 'supabase_management_api' || raw.requestMethod !== 'GET') {
        errors.push('Production Auth inert receipt must come from a Supabase Management API GET.');
    }
    if (raw.externalWritePerformed !== false) {
        errors.push('Production Auth inert receipt must prove externalWritePerformed=false.');
    }

    if (!isRecord(raw.target)) {
        errors.push('Production Auth inert receipt target is missing.');
    } else {
        requireExactKeys(raw.target, ['environment', 'projectRef'], 'Production Auth inert target', errors);
        if (raw.target.environment !== SUPABASE_AUTH_TARGETS.production.environment
            || raw.target.projectRef !== SUPABASE_AUTH_TARGETS.production.projectRef) {
            errors.push('Production Auth inert receipt target mismatch.');
        }
    }

    if (!isRecord(raw.flags)) {
        errors.push('Production Auth inert receipt flags are missing.');
    } else {
        requireExactKeys(raw.flags, ['disable_signup', 'mailer_autoconfirm'], 'Production Auth inert flags', errors);
        if (raw.flags.disable_signup !== true || raw.flags.mailer_autoconfirm !== false) {
            errors.push('Production Auth inert receipt flags must be disable_signup=true and mailer_autoconfirm=false.');
        }
    }

    const observedAt = typeof raw.observedAt === 'string' ? Date.parse(raw.observedAt) : Number.NaN;
    const age = now.getTime() - observedAt;
    if (!Number.isFinite(observedAt)) {
        errors.push('Production Auth inert receipt observedAt must be a valid timestamp.');
    } else if (age < 0) {
        errors.push('Production Auth inert receipt timestamp is in the future.');
    } else if (age > PRODUCTION_AUTH_INERT_RECEIPT_MAX_AGE_MS) {
        errors.push('Production Auth inert receipt is older than 15 minutes.');
    }

    return {
        ok: errors.length === 0,
        errors,
        value: errors.length === 0 ? raw as unknown as ProductionAuthInertReceipt : null,
    };
}

export function readProductionAuthInertEvidence(
    evidencePath: string | null,
    now = new Date(),
): ProductionAuthInertEvidence {
    if (!evidencePath) {
        return {
            provided: false,
            valid: false,
            path: null,
            sha256: null,
            value: null,
            errors: ['Production Auth inert receipt path is required.'],
        };
    }

    const resolvedPath = path.resolve(evidencePath);
    let bytes: Buffer;
    let raw: unknown;
    try {
        bytes = readFileSync(resolvedPath);
        raw = JSON.parse(bytes.toString('utf8'));
    } catch {
        return {
            provided: true,
            valid: false,
            path: resolvedPath,
            sha256: null,
            value: null,
            errors: ['Production Auth inert receipt could not be read as JSON.'],
        };
    }

    const validation = validateProductionAuthInertReceipt(raw, now);
    return {
        provided: true,
        valid: validation.ok,
        path: resolvedPath,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        value: validation.value,
        errors: validation.errors,
    };
}

export async function verifyLiveProductionAuthInert(
    client: Readonly<SupabaseAuthManagementClient>,
): Promise<SafeAuthConfig> {
    if (client.projectRef !== SUPABASE_AUTH_TARGETS.production.projectRef) {
        throw new Error('Supabase production Auth verification requires the exact production project');
    }
    const config = await getSafeAuthConfig(client);
    assertProductionAuthConfigInert(config);
    return config;
}

export function parseUriAllowList(value: string): string[] {
    const seen = new Set<string>();
    const entries: string[] = [];

    for (const rawEntry of value.split(',')) {
        const entry = rawEntry.trim();
        if (!entry || seen.has(entry)) continue;
        seen.add(entry);
        entries.push(entry);
    }

    return entries;
}

export function mergeUriAllowList(
    currentValue: string,
    requiredEntries: readonly string[],
): string {
    const merged = parseUriAllowList(currentValue);
    assertNoBroadAuthRedirectWildcards(merged);
    assertNoBroadAuthRedirectWildcards(requiredEntries);
    const seen = new Set(merged);

    for (const entry of requiredEntries) {
        const normalized = entry.trim();
        if (!normalized || seen.has(normalized)) continue;
        seen.add(normalized);
        merged.push(normalized);
    }

    return merged.join(',');
}

export function assertNoBroadAuthRedirectWildcards(entries: readonly string[]): void {
    for (const entry of entries) {
        if (hasBroadAuthRedirectWildcard(entry)) {
            throw new Error('Supabase Auth redirect allowlist contains a broad wildcard');
        }
    }
}

export function hasBroadAuthRedirectWildcard(value: string): boolean {
    const entry = value.trim();
    if (!entry) return false;

    // Supabase Auth supports glob syntax in redirect URLs. The RC contract is
    // exact-path only: reject raw or percent-encoded globstar, character-class,
    // brace and escape syntax. A literal query delimiter remains valid for the
    // three exact `?lang=` confirmation callbacks.
    if (/[*[\]{}\\]/u.test(entry)
        || /%(?:2a|5b|5d|7b|7d|5c)/iu.test(entry)) {
        return true;
    }

    const queryDelimiter = entry.indexOf('?');
    if (queryDelimiter < 0) return false;

    const query = entry.slice(queryDelimiter + 1);
    return query.length === 0 || !query.includes('=');
}

export function allowListExactlyMatches(value: string, expected: string): boolean {
    const actualEntries = value.split(',').map((entry) => entry.trim()).filter(Boolean);
    const expectedEntries = parseUriAllowList(expected);

    if (actualEntries.length !== expectedEntries.length) return false;
    if (new Set(actualEntries).size !== actualEntries.length) return false;

    const actualSet = new Set(actualEntries);
    return expectedEntries.every((entry) => actualSet.has(entry));
}

export function exactApprovalMatched(
    spec: ApprovalSpec,
    argv: readonly string[],
    env: Record<string, string | undefined>,
): boolean {
    return argv.includes('--execute-approved')
        && env[spec.approvalEnvVar]?.trim() === spec.exactApprovalSentence;
}

export function productionDesiredPatch(phase: 'inert' | 'final'): AuthConfigPatch {
    return {
        disable_signup: phase === 'inert',
        mailer_autoconfirm: false,
    };
}

export function verifyExactSafePatch(
    before: SafeAuthConfig,
    after: SafeAuthConfig,
    patch: AuthConfigPatch,
): boolean {
    for (const key of safeAuthConfigKeys) {
        const expected = key in patch ? patch[key] : before[key];
        if (after[key] !== expected) return false;
    }
    return true;
}

export async function getSafeAuthConfig(
    client: Readonly<SupabaseAuthManagementClient>,
): Promise<SafeAuthConfig> {
    assertKnownProjectRef(client.projectRef);
    const response = await client.getAuthConfig();

    if (!response.ok) {
        throw new Error(`Supabase Management API GET failed with HTTP ${response.status}`);
    }

    return selectSafeAuthConfig(await response.json());
}

export async function patchAuthConfig(
    client: Readonly<SupabaseAuthManagementClient>,
    patch: AuthConfigPatch,
): Promise<void> {
    assertKnownProjectRef(client.projectRef);
    assertSafePatch(patch);
    const response = await client.patchAuthConfig(patch);

    if (!response.ok) {
        throw new Error(`Supabase Management API PATCH failed with HTTP ${response.status}`);
    }
}

export async function applyVerifiedAuthConfigChange({
    client,
    buildDesiredPatch,
    verifyDesired,
    verifyRollback = verifyPatchValues,
}: VerifiedChangeSpec): Promise<ChangeResult> {
    const before = await getSafeAuthConfig(client);
    const desiredPatch = buildDesiredPatch(before);
    assertSafePatch(desiredPatch);
    const rollbackPatch = patchFromBefore(before, Object.keys(desiredPatch) as SafeAuthConfigKey[]);

    if (verifyDesired(before, before, desiredPatch)) {
        return result('already_applied', before, desiredPatch, before, false, true, rollbackPatch, before);
    }

    let afterFailure: SafeAuthConfig | null = null;

    try {
        await patchAuthConfig(client, desiredPatch);
        const after = await getSafeAuthConfig(client);
        if (verifyDesired(before, after, desiredPatch)) {
            return result('applied', before, desiredPatch, after, false, true, rollbackPatch, null);
        }
        afterFailure = after;
    } catch {
        // The write state may be ambiguous after a network/API failure. A
        // redacted GET below decides whether compensating rollback is needed.
    }

    if (!afterFailure) {
        try {
            afterFailure = await getSafeAuthConfig(client);
        } catch {
            afterFailure = null;
        }
    }

    if (afterFailure && verifyRollback(before, afterFailure, rollbackPatch)) {
        return result('failed_no_change', before, desiredPatch, afterFailure, false, true, rollbackPatch, afterFailure);
    }

    try {
        await patchAuthConfig(client, rollbackPatch);
        const afterRollback = await getSafeAuthConfig(client);
        const rollbackVerified = verifyRollback(before, afterRollback, rollbackPatch);
        return result(
            rollbackVerified ? 'failed_rolled_back' : 'failed_rollback_unverified',
            before,
            desiredPatch,
            afterFailure,
            true,
            rollbackVerified,
            rollbackPatch,
            afterRollback,
        );
    } catch {
        return result(
            'failed_rollback_unverified',
            before,
            desiredPatch,
            afterFailure,
            true,
            false,
            rollbackPatch,
            null,
        );
    }
}

export function safeErrorMessage(error: unknown): string {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return message
        .replace(/Bearer\s+[A-Za-z0-9._~+/-]+/giu, 'Bearer [redacted]')
        .replace(/sbp_[A-Za-z0-9_-]+/giu, '[redacted-token]')
        .replace(/SUPABASE_ACCESS_TOKEN\s*=\s*\S+/giu, 'SUPABASE_ACCESS_TOKEN=[redacted]');
}

const safeAuthConfigKeys: SafeAuthConfigKey[] = [
    'disable_signup',
    'mailer_autoconfirm',
    'site_url',
    'uri_allow_list',
];

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireExactKeys(
    value: Record<string, unknown>,
    expectedKeys: readonly string[],
    label: string,
    errors: string[],
): void {
    const actual = Object.keys(value).sort();
    const expected = [...expectedKeys].sort();
    if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
        errors.push(`${label} fields do not match the exact contract.`);
    }
}

function assertProductionAuthConfigInert(
    config: Pick<SafeAuthConfig, 'disable_signup' | 'mailer_autoconfirm'>,
): void {
    if (!productionAuthConfigIsInert(config)) {
        throw new Error('Supabase production Auth is not inert: disable_signup=true and mailer_autoconfirm=false are required.');
    }
}

function assertKnownProjectRef(projectRef: string): void {
    try {
        assertAllowedSupabaseManagementProjectRef(projectRef);
    } catch {
        throw new Error('Supabase Auth config target is not allowlisted');
    }
}

function assertSafePatch(patch: AuthConfigPatch): void {
    const entries = Object.entries(patch);
    if (entries.length === 0) throw new Error('Supabase Auth config patch is empty');

    for (const [key, value] of entries) {
        if (!safeAuthConfigKeys.includes(key as SafeAuthConfigKey)) {
            throw new Error('Supabase Auth config patch contains a forbidden field');
        }
        if ((key === 'disable_signup' || key === 'mailer_autoconfirm') && typeof value !== 'boolean') {
            throw new Error('Supabase Auth boolean patch has an invalid value');
        }
        if ((key === 'site_url' || key === 'uri_allow_list') && typeof value !== 'string') {
            throw new Error('Supabase Auth URL patch has an invalid value');
        }
    }
}

function patchFromBefore(before: SafeAuthConfig, keys: SafeAuthConfigKey[]): AuthConfigPatch {
    const patch: AuthConfigPatch = {};
    for (const key of keys) {
        assignPatchValue(patch, key, before[key]);
    }
    return patch;
}

function assignPatchValue(
    patch: AuthConfigPatch,
    key: SafeAuthConfigKey,
    value: SafeAuthConfig[SafeAuthConfigKey],
): void {
    if (key === 'disable_signup' || key === 'mailer_autoconfirm') {
        patch[key] = value as boolean;
    } else {
        patch[key] = value as string;
    }
}

function verifyPatchValues(
    _before: SafeAuthConfig,
    after: SafeAuthConfig,
    patch: AuthConfigPatch,
): boolean {
    return Object.entries(patch).every(([key, value]) => after[key as SafeAuthConfigKey] === value);
}

function result(
    status: ChangeResult['status'],
    before: SafeAuthConfig,
    desiredPatch: AuthConfigPatch,
    after: SafeAuthConfig | null,
    rollbackAttempted: boolean,
    rollbackVerified: boolean,
    rollbackPatch: AuthConfigPatch,
    afterRollback: SafeAuthConfig | null,
): ChangeResult {
    return {
        status,
        before,
        desiredPatch,
        after,
        rollback: {
            attempted: rollbackAttempted,
            verified: rollbackVerified,
            patch: rollbackPatch,
            after: afterRollback,
        },
    };
}
