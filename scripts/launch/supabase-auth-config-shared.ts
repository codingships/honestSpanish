export const SUPABASE_MANAGEMENT_API_BASE = 'https://api.supabase.com';
export const SUPABASE_ACCESS_TOKEN_ENV = 'SUPABASE_ACCESS_TOKEN';

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

export const STAGING_AUTH_REDIRECTS = [
    'https://espanolhonesto-staging.alindev95.workers.dev/api/auth/confirm?lang=es',
    'https://espanolhonesto-staging.alindev95.workers.dev/api/auth/confirm?lang=en',
    'https://espanolhonesto-staging.alindev95.workers.dev/api/auth/confirm?lang=ru',
    'https://espanolhonesto-staging.alindev95.workers.dev/es/reset-password',
    'https://espanolhonesto-staging.alindev95.workers.dev/en/reset-password',
    'https://espanolhonesto-staging.alindev95.workers.dev/ru/reset-password',
] as const;

export type SafeAuthConfig = {
    disable_signup: boolean;
    mailer_autoconfirm: boolean;
    site_url: string;
    uri_allow_list: string;
};

export type SafeAuthConfigKey = keyof SafeAuthConfig;
export type AuthConfigPatch = Partial<SafeAuthConfig>;

export type Fetcher = (
    input: string | URL | Request,
    init?: RequestInit,
) => Promise<Response>;

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

export const STAGING_REDIRECTS_APPROVAL = {
    environment: 'staging',
    projectRef: SUPABASE_AUTH_TARGETS.staging.projectRef,
    approvalEnvVar: 'SUPABASE_AUTH_STAGING_REDIRECTS_APPROVAL',
    exactApprovalSentence: `Autorizo actualizar únicamente uri_allow_list de Supabase staging mzjyvmlxfpzdfdjzxxyj para añadir ${STAGING_AUTH_REDIRECTS.join(', ')}, preservando todas las entradas exactas existentes, bloqueando antes de escribir si existe cualquier comodín amplio, verificando el resultado y restaurando el valor previo si falla. No autorizo producción ni otros campos o recursos.`,
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
    projectRef: string;
    token: string;
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
    fetcher?: Fetcher;
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
    if (/[*\[\]{}\\]/u.test(entry)
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

export async function getSafeAuthConfig({
    projectRef,
    token,
    fetcher = fetch,
}: {
    projectRef: string;
    token: string;
    fetcher?: Fetcher;
}): Promise<SafeAuthConfig> {
    assertKnownProjectRef(projectRef);
    assertToken(token);

    const response = await fetcher(authConfigUrl(projectRef), {
        method: 'GET',
        headers: managementHeaders(token),
        redirect: 'error',
        signal: AbortSignal.timeout(20_000),
    });

    if (!response.ok) {
        throw new Error(`Supabase Management API GET failed with HTTP ${response.status}`);
    }

    return selectSafeAuthConfig(await response.json());
}

export async function patchAuthConfig({
    projectRef,
    token,
    patch,
    fetcher = fetch,
}: {
    projectRef: string;
    token: string;
    patch: AuthConfigPatch;
    fetcher?: Fetcher;
}): Promise<void> {
    assertKnownProjectRef(projectRef);
    assertToken(token);
    assertSafePatch(patch);

    const response = await fetcher(authConfigUrl(projectRef), {
        method: 'PATCH',
        headers: managementHeaders(token),
        body: JSON.stringify(patch),
        redirect: 'error',
        signal: AbortSignal.timeout(20_000),
    });

    if (!response.ok) {
        throw new Error(`Supabase Management API PATCH failed with HTTP ${response.status}`);
    }
}

export async function applyVerifiedAuthConfigChange({
    projectRef,
    token,
    buildDesiredPatch,
    verifyDesired,
    verifyRollback = verifyPatchValues,
    fetcher = fetch,
}: VerifiedChangeSpec): Promise<ChangeResult> {
    const before = await getSafeAuthConfig({ projectRef, token, fetcher });
    const desiredPatch = buildDesiredPatch(before);
    assertSafePatch(desiredPatch);
    const rollbackPatch = patchFromBefore(before, Object.keys(desiredPatch) as SafeAuthConfigKey[]);

    if (verifyDesired(before, before, desiredPatch)) {
        return result('already_applied', before, desiredPatch, before, false, true, rollbackPatch, before);
    }

    let afterFailure: SafeAuthConfig | null = null;

    try {
        await patchAuthConfig({ projectRef, token, patch: desiredPatch, fetcher });
        const after = await getSafeAuthConfig({ projectRef, token, fetcher });
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
            afterFailure = await getSafeAuthConfig({ projectRef, token, fetcher });
        } catch {
            afterFailure = null;
        }
    }

    if (afterFailure && verifyRollback(before, afterFailure, rollbackPatch)) {
        return result('failed_no_change', before, desiredPatch, afterFailure, false, true, rollbackPatch, afterFailure);
    }

    try {
        await patchAuthConfig({ projectRef, token, patch: rollbackPatch, fetcher });
        const afterRollback = await getSafeAuthConfig({ projectRef, token, fetcher });
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

function assertKnownProjectRef(projectRef: string): void {
    const knownRefs = new Set<string>(
        Object.values(SUPABASE_AUTH_TARGETS).map((target) => target.projectRef),
    );
    if (!knownRefs.has(projectRef)) {
        throw new Error('Supabase Auth config target is not allowlisted');
    }
}

function assertToken(token: string): void {
    if (!token.trim()) throw new Error(`Missing ${SUPABASE_ACCESS_TOKEN_ENV}`);
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

function managementHeaders(token: string): Record<string, string> {
    return {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
    };
}

function authConfigUrl(projectRef: string): string {
    return `${SUPABASE_MANAGEMENT_API_BASE}/v1/projects/${projectRef}/config/auth`;
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
