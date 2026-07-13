import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
    allowListExactlyMatches,
    applyVerifiedAuthConfigChange,
    exactApprovalMatched,
    hasBroadAuthRedirectWildcard,
    mergeUriAllowList,
    PRODUCTION_AUTH_APPROVALS,
    productionDesiredPatch,
    redactedPreflight,
    safeErrorMessage,
    selectSafeAuthConfig,
    STAGING_AUTH_REDIRECTS,
    STAGING_AUTH_URLS_APPROVAL,
    STAGING_SITE_URL,
    SUPABASE_AUTH_TARGETS,
    verifyExactSafePatch,
    getSafeAuthConfig,
    type Fetcher,
    type SafeAuthConfig,
} from '../../scripts/launch/supabase-auth-config-shared';

const productionRunner = readFileSync(
    'scripts/launch/supabase-auth-production-gate.ts',
    'utf8',
);
const stagingRunner = readFileSync(
    'scripts/launch/supabase-auth-staging-callbacks-gate.ts',
    'utf8',
);
const preflightRunner = readFileSync(
    'scripts/launch/supabase-auth-config-preflight.ts',
    'utf8',
);

const baseConfig: SafeAuthConfig = {
    disable_signup: false,
    mailer_autoconfirm: true,
    site_url: 'https://example.com',
    uri_allow_list: 'https://example.com/auth/callback',
};

function jsonResponse(payload: unknown, status = 200): Response {
    return new Response(JSON.stringify(payload), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

function sequenceFetcher(responses: Response[]) {
    const fetcher = vi.fn(async () => {
        const response = responses.shift();
        if (!response) throw new Error('Unexpected fetch');
        return response;
    }) as unknown as Fetcher;
    return fetcher;
}

describe('Supabase Auth config runners', () => {
    it('selects only the four approved preflight fields and drops secret-bearing config', () => {
        const safe = selectSafeAuthConfig({
            ...baseConfig,
            smtp_pass: 'must-not-appear',
            jwt_secret: 'must-not-appear',
            hook_send_email_secrets: 'must-not-appear',
        });
        const artifact = JSON.stringify(redactedPreflight(
            SUPABASE_AUTH_TARGETS.production,
            safe,
        ));

        expect(Object.keys(safe).sort()).toEqual([
            'disable_signup',
            'mailer_autoconfirm',
            'site_url',
            'uri_allow_list',
        ]);
        expect(artifact).not.toContain('smtp_pass');
        expect(artifact).not.toContain('jwt_secret');
        expect(artifact).not.toContain('must-not-appear');
    });

    it('preserves exact staging allowlist entries and adds all confirmation and reset redirects once', () => {
        const existing = [
            'https://existing.example/callback',
            STAGING_AUTH_REDIRECTS[0],
            'https://another.example/auth/confirm',
        ].join(', ');
        const merged = mergeUriAllowList(existing, STAGING_AUTH_REDIRECTS);
        const entries = merged.split(',');

        expect(entries).toContain('https://existing.example/callback');
        expect(entries).toContain('https://another.example/auth/confirm');
        for (const redirect of STAGING_AUTH_REDIRECTS) {
            expect(entries.filter((entry) => entry === redirect)).toHaveLength(1);
        }
        expect(allowListExactlyMatches(merged, merged)).toBe(true);
        expect(allowListExactlyMatches(`${merged},${STAGING_AUTH_REDIRECTS[0]}`, merged)).toBe(false);
    });

    it('pins six exact staging redirects and rejects broad Supabase Auth wildcard syntax before merge', () => {
        expect(STAGING_SITE_URL)
            .toBe('https://staging.espanolhonesto.com');
        expect(STAGING_AUTH_REDIRECTS).toEqual([
            'https://staging.espanolhonesto.com/api/auth/confirm?lang=es',
            'https://staging.espanolhonesto.com/api/auth/confirm?lang=en',
            'https://staging.espanolhonesto.com/api/auth/confirm?lang=ru',
            'https://staging.espanolhonesto.com/es/reset-password',
            'https://staging.espanolhonesto.com/en/reset-password',
            'https://staging.espanolhonesto.com/ru/reset-password',
        ]);
        expect(STAGING_AUTH_REDIRECTS.every((entry) => !hasBroadAuthRedirectWildcard(entry))).toBe(true);

        for (const wildcard of [
            'https://*.example.com/auth/confirm',
            'https://example.com/**',
            'https://example.com/[!a-z]',
            'https://example.com/%2A',
            'https://example.com/?',
        ]) {
            expect(hasBroadAuthRedirectWildcard(wildcard)).toBe(true);
            expect(() => mergeUriAllowList(wildcard, STAGING_AUTH_REDIRECTS))
                .toThrow('contains a broad wildcard');
        }
    });

    it('requires both the execute flag and the exact phase-specific approval sentence', () => {
        const inert = PRODUCTION_AUTH_APPROVALS.inert;

        expect(exactApprovalMatched(inert, ['--execute-approved'], {
            [inert.approvalEnvVar]: inert.exactApprovalSentence,
        })).toBe(true);
        expect(exactApprovalMatched(inert, [], {
            [inert.approvalEnvVar]: inert.exactApprovalSentence,
        })).toBe(false);
        expect(exactApprovalMatched(inert, ['--execute-approved'], {
            [inert.approvalEnvVar]: `${inert.exactApprovalSentence} extra`,
        })).toBe(false);
        expect(exactApprovalMatched(STAGING_AUTH_URLS_APPROVAL, ['--execute-approved'], {
            [inert.approvalEnvVar]: inert.exactApprovalSentence,
        })).toBe(false);
    });

    it('binds the staging approval to both the canonical site URL and exact allowlist', () => {
        expect(STAGING_AUTH_URLS_APPROVAL.approvalEnvVar)
            .toBe('SUPABASE_AUTH_STAGING_URLS_APPROVAL');
        expect(STAGING_AUTH_URLS_APPROVAL.exactApprovalSentence)
            .toContain(`site_url=${STAGING_SITE_URL}`);
        expect(STAGING_AUTH_URLS_APPROVAL.exactApprovalSentence)
            .toContain('site_url y uri_allow_list');
        expect(STAGING_AUTH_URLS_APPROVAL.exactApprovalSentence)
            .toContain('No autorizo producción ni otros campos o recursos.');
    });

    it('encodes the reversible final production target as signup enabled with confirmation required', () => {
        expect(productionDesiredPatch('final')).toEqual({
            disable_signup: false,
            mailer_autoconfirm: false,
        });
    });

    it('patches only inert production flags, then verifies with a second GET', async () => {
        const after = {
            ...baseConfig,
            disable_signup: true,
            mailer_autoconfirm: false,
        };
        const fetcher = sequenceFetcher([
            jsonResponse(baseConfig),
            new Response(null, { status: 200 }),
            jsonResponse(after),
        ]);

        const result = await applyVerifiedAuthConfigChange({
            projectRef: SUPABASE_AUTH_TARGETS.production.projectRef,
            token: 'test-management-token',
            buildDesiredPatch: () => productionDesiredPatch('inert'),
            verifyDesired: verifyExactSafePatch,
            fetcher,
        });

        expect(result.status).toBe('applied');
        expect(fetcher).toHaveBeenCalledTimes(3);
        expect(fetcher).toHaveBeenNthCalledWith(
            1,
            `https://api.supabase.com/v1/projects/${SUPABASE_AUTH_TARGETS.production.projectRef}/config/auth`,
            expect.objectContaining({ method: 'GET' }),
        );
        expect(fetcher).toHaveBeenNthCalledWith(
            2,
            expect.any(String),
            expect.objectContaining({
                method: 'PATCH',
                body: JSON.stringify({
                    disable_signup: true,
                    mailer_autoconfirm: false,
                }),
            }),
        );
        expect(fetcher).toHaveBeenNthCalledWith(
            3,
            expect.any(String),
            expect.objectContaining({ method: 'GET' }),
        );
    });

    it('restores only previous production flag values when verification fails', async () => {
        const before = { ...baseConfig };
        const invalidAfter = {
            ...before,
            disable_signup: true,
            mailer_autoconfirm: true,
        };
        const fetcher = sequenceFetcher([
            jsonResponse(before),
            new Response(null, { status: 200 }),
            jsonResponse(invalidAfter),
            new Response(null, { status: 200 }),
            jsonResponse(before),
        ]);

        const result = await applyVerifiedAuthConfigChange({
            projectRef: SUPABASE_AUTH_TARGETS.production.projectRef,
            token: 'test-management-token',
            buildDesiredPatch: () => productionDesiredPatch('inert'),
            verifyDesired: verifyExactSafePatch,
            fetcher,
        });

        expect(result.status).toBe('failed_rolled_back');
        expect(result.rollback).toMatchObject({
            attempted: true,
            verified: true,
            patch: {
                disable_signup: false,
                mailer_autoconfirm: true,
            },
        });
        expect(fetcher).toHaveBeenNthCalledWith(
            4,
            expect.any(String),
            expect.objectContaining({
                method: 'PATCH',
                body: JSON.stringify({
                    disable_signup: false,
                    mailer_autoconfirm: true,
                }),
            }),
        );
    });

    it('does not compensate when a failed PATCH is proven to have changed nothing', async () => {
        const fetcher = sequenceFetcher([
            jsonResponse(baseConfig),
            new Response(null, { status: 403 }),
            jsonResponse(baseConfig),
        ]);

        const result = await applyVerifiedAuthConfigChange({
            projectRef: SUPABASE_AUTH_TARGETS.production.projectRef,
            token: 'test-management-token',
            buildDesiredPatch: () => productionDesiredPatch('inert'),
            verifyDesired: verifyExactSafePatch,
            fetcher,
        });

        expect(result.status).toBe('failed_no_change');
        expect(result.rollback.attempted).toBe(false);
        expect(fetcher).toHaveBeenCalledTimes(3);
    });

    it('pins the staging site URL, merges the allowlist and preserves auth flags', async () => {
        const mergedAllowList = mergeUriAllowList(baseConfig.uri_allow_list, STAGING_AUTH_REDIRECTS);
        const after = {
            ...baseConfig,
            site_url: STAGING_SITE_URL,
            uri_allow_list: mergedAllowList,
        };
        const fetcher = sequenceFetcher([
            jsonResponse(baseConfig),
            new Response(null, { status: 200 }),
            jsonResponse(after),
        ]);

        const result = await applyVerifiedAuthConfigChange({
            projectRef: SUPABASE_AUTH_TARGETS.staging.projectRef,
            token: 'test-management-token',
            buildDesiredPatch: (before) => ({
                site_url: STAGING_SITE_URL,
                uri_allow_list: mergeUriAllowList(before.uri_allow_list, STAGING_AUTH_REDIRECTS),
            }),
            verifyDesired: (before, observed, patch) => (
                observed.disable_signup === before.disable_signup
                && observed.mailer_autoconfirm === before.mailer_autoconfirm
                && patch.site_url === STAGING_SITE_URL
                && observed.site_url === STAGING_SITE_URL
                && typeof patch.uri_allow_list === 'string'
                && allowListExactlyMatches(observed.uri_allow_list, patch.uri_allow_list)
            ),
            fetcher,
        });

        expect(result.status).toBe('applied');
        expect(fetcher).toHaveBeenNthCalledWith(
            2,
            expect.any(String),
            expect.objectContaining({
                method: 'PATCH',
                body: JSON.stringify({
                    site_url: STAGING_SITE_URL,
                    uri_allow_list: mergedAllowList,
                }),
            }),
        );
    });

    it('restores both prior staging URL fields when verification fails', async () => {
        const before: SafeAuthConfig = {
            disable_signup: false,
            mailer_autoconfirm: false,
            site_url: 'http://localhost:3000',
            uri_allow_list: '',
        };
        const desiredAllowList = mergeUriAllowList(
            before.uri_allow_list,
            STAGING_AUTH_REDIRECTS,
        );
        const invalidAfter: SafeAuthConfig = {
            ...before,
            site_url: STAGING_SITE_URL,
            uri_allow_list: STAGING_AUTH_REDIRECTS[0],
        };
        const fetcher = sequenceFetcher([
            jsonResponse(before),
            new Response(null, { status: 200 }),
            jsonResponse(invalidAfter),
            new Response(null, { status: 200 }),
            jsonResponse(before),
        ]);

        const result = await applyVerifiedAuthConfigChange({
            projectRef: SUPABASE_AUTH_TARGETS.staging.projectRef,
            token: 'test-management-token',
            buildDesiredPatch: () => ({
                site_url: STAGING_SITE_URL,
                uri_allow_list: desiredAllowList,
            }),
            verifyDesired: (baseline, observed, patch) => (
                observed.disable_signup === baseline.disable_signup
                && observed.mailer_autoconfirm === baseline.mailer_autoconfirm
                && patch.site_url === STAGING_SITE_URL
                && observed.site_url === STAGING_SITE_URL
                && typeof patch.uri_allow_list === 'string'
                && allowListExactlyMatches(observed.uri_allow_list, patch.uri_allow_list)
            ),
            verifyRollback: (baseline, observed) => (
                observed.disable_signup === baseline.disable_signup
                && observed.mailer_autoconfirm === baseline.mailer_autoconfirm
                && observed.site_url === baseline.site_url
                && allowListExactlyMatches(observed.uri_allow_list, baseline.uri_allow_list)
            ),
            fetcher,
        });

        expect(result.status).toBe('failed_rolled_back');
        expect(result.rollback).toMatchObject({
            attempted: true,
            verified: true,
            patch: {
                site_url: before.site_url,
                uri_allow_list: before.uri_allow_list,
            },
        });
        expect(fetcher).toHaveBeenNthCalledWith(
            4,
            expect.any(String),
            expect.objectContaining({
                method: 'PATCH',
                body: JSON.stringify({
                    site_url: before.site_url,
                    uri_allow_list: before.uri_allow_list,
                }),
            }),
        );
    });

    it('keeps plan and blocked branches before the only write-capable call sites', () => {
        for (const source of [productionRunner, stagingRunner]) {
            const planBranch = source.indexOf('if (!executeRequested)');
            const blockedBranch = source.indexOf('else if (!approvalMatched || !token)');
            const applyCall = source.indexOf('await applyVerifiedAuthConfigChange');

            expect(planBranch).toBeGreaterThan(-1);
            expect(blockedBranch).toBeGreaterThan(planBranch);
            expect(applyCall).toBeGreaterThan(blockedBranch);
            expect(source).not.toMatch(/console\.log\([^\n]*(?:token|Authorization)/u);
        }
        expect(preflightRunner).toContain('getSafeAuthConfig');
        expect(preflightRunner).not.toContain('patchAuthConfig');
        expect(preflightRunner).not.toContain("method: 'PATCH'");
    });

    it('rejects any project ref outside the staging/production allowlist before fetch', async () => {
        const fetcher = vi.fn() as unknown as Fetcher;
        await expect(getSafeAuthConfig({
            projectRef: 'attacker-controlled-ref',
            token: 'test-management-token',
            fetcher,
        })).rejects.toThrow('target is not allowlisted');
        expect(fetcher).not.toHaveBeenCalled();
    });

    it('redacts management tokens from controlled error text', () => {
        const safe = safeErrorMessage(new Error(
            'Bearer sbp_super-secret SUPABASE_ACCESS_TOKEN=sbp_other-secret',
        ));
        expect(safe).not.toContain('super-secret');
        expect(safe).not.toContain('other-secret');
        expect(safe).toContain('[redacted]');
    });
});
