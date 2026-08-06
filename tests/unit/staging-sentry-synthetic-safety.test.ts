import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Event } from '@sentry/astro';
import { scrubSentryEvent } from '../../src/lib/sentry-privacy';
import {
    STAGING_SENTRY_SYNTHETIC_CONFIRMATION,
    STAGING_SENTRY_SYNTHETIC_DECOYS,
    STAGING_SENTRY_SYNTHETIC_IDENTITY,
    assertSyntheticEventHasNoDecoys,
    parseApprovedStagingSentryDsn,
    parseStagingSentrySyntheticArgs,
    safeStagingSentrySyntheticSummary,
    validateStagingSentrySyntheticGate,
} from '../../scripts/smoke/staging-sentry-synthetic-safety';

const workspaceRoot = path.resolve('staging-sentry-synthetic-fixture');
const envFile = path.resolve(workspaceRoot, '.env.staging');

function validEnv(): Record<string, string> {
    return {
        PUBLIC_APP_ENV: 'staging',
        PUBLIC_SITE_URL: STAGING_SENTRY_SYNTHETIC_IDENTITY.webOrigin,
        PUBLIC_SENTRY_DSN: `https://public-key@${STAGING_SENTRY_SYNTHETIC_IDENTITY.sentryDsnHost}/${STAGING_SENTRY_SYNTHETIC_IDENTITY.sentryProjectId}`,
        PUBLIC_SUPABASE_URL: `https://${STAGING_SENTRY_SYNTHETIC_IDENTITY.supabaseProjectRef}.supabase.co`,
        STRIPE_EXPECTED_ACCOUNT_ID: STAGING_SENTRY_SYNTHETIC_IDENTITY.stripeAccountId,
        SUPABASE_EXPECTED_PROJECT_REF: STAGING_SENTRY_SYNTHETIC_IDENTITY.supabaseProjectRef,
        SENTRY_ENVIRONMENT: 'staging',
    };
}

const webConfig = `
[env.staging]
name = "${STAGING_SENTRY_SYNTHETIC_IDENTITY.webWorker}"
`;

describe('staging Sentry synthetic safety', () => {
    it('parses preflight by default and requires confirmation for execute', () => {
        expect(parseStagingSentrySyntheticArgs([])).toEqual({
            envFile: '.env.staging',
            mode: 'preflight',
        });
        expect(() => parseStagingSentrySyntheticArgs(['--execute'])).toThrow('--confirmation=');
        expect(parseStagingSentrySyntheticArgs([
            '--execute',
            '--confirmation',
            STAGING_SENTRY_SYNTHETIC_CONFIRMATION,
        ]).mode).toBe('execute');
    });

    it('accepts only the approved staging DSN identity', () => {
        const parsed = parseApprovedStagingSentryDsn(validEnv().PUBLIC_SENTRY_DSN);
        expect(parsed.publicKey).toBe('public-key');
        expect(() => parseApprovedStagingSentryDsn(
            'https://public-key@o000.ingest.sentry.io/1',
        )).toThrow('honestspanish/espanol-honesto-astro');
    });

    it('validates the approved staging gate without leaking secrets in the summary', () => {
        const gate = validateStagingSentrySyntheticGate({
            args: parseStagingSentrySyntheticArgs([]),
            env: validEnv(),
            repositoryRemote: STAGING_SENTRY_SYNTHETIC_IDENTITY.repositoryRemote,
            resolvedEnvFile: envFile,
            webConfig,
            workspaceRoot,
        });
        expect(gate.mode).toBe('preflight');
        const summary = safeStagingSentrySyntheticSummary(gate).join('\n');
        expect(summary).toContain('capability=r04-sentry-synthetic');
        expect(summary).toContain('production=false');
        expect(summary).not.toContain('public-key');
    });

    it('scrubs planted privacy decoys before they can leave the runner', () => {
        const scrubbed = scrubSentryEvent({
            message: STAGING_SENTRY_SYNTHETIC_DECOYS.rawMessage,
            user: { email: STAGING_SENTRY_SYNTHETIC_DECOYS.email },
            request: {
                url: `${STAGING_SENTRY_SYNTHETIC_IDENTITY.webOrigin}/es?${STAGING_SENTRY_SYNTHETIC_DECOYS.query}`,
                query_string: STAGING_SENTRY_SYNTHETIC_DECOYS.query,
                cookies: { session: 'decoy-cookie-value-never-send' },
                data: {
                    email: STAGING_SENTRY_SYNTHETIC_DECOYS.email,
                    password: STAGING_SENTRY_SYNTHETIC_DECOYS.password,
                },
                headers: {
                    authorization: STAGING_SENTRY_SYNTHETIC_DECOYS.authorization,
                    cookie: STAGING_SENTRY_SYNTHETIC_DECOYS.cookie,
                },
            },
            exception: {
                values: [{ type: 'Error', value: STAGING_SENTRY_SYNTHETIC_DECOYS.rawMessage }],
            },
        } as Event);

        expect(() => assertSyntheticEventHasNoDecoys(JSON.stringify(scrubbed))).not.toThrow();
        expect(scrubbed.user).toBeUndefined();
        expect(scrubbed.request?.cookies).toBeUndefined();
        expect(scrubbed.request?.data).toBeUndefined();
        expect(scrubbed.request?.headers).toBeUndefined();
        expect(scrubbed.request?.query_string).toBeUndefined();
    });
});
