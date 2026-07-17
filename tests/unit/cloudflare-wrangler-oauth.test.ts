import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
    CloudflareOAuthSessionError,
    ESPANOL_HONESTO_CLOUDFLARE_ACCOUNT_ID,
    ESPANOL_HONESTO_CLOUDFLARE_ZONE_NAME,
    assertAllowlistedCloudflareAccount,
    buildCloudflareCredentialFreeChildEnvironment,
    buildSanitizedWranglerOAuthEnvironment,
    cloudflareWranglerOAuthTestOnly,
    discoverAllowlistedCloudflareZone,
    requestAllowlistedCloudflareAccount,
    requestAllowlistedCloudflareZoneRead,
    runCloudflareWranglerFromKeyring,
    type CloudflareAccountApi,
    type CloudflareWranglerOAuthTestDependencies,
    type WithCloudflareOAuthOptions,
} from '../../scripts/launch/cloudflare-wrangler-oauth';

const accountId = ESPANOL_HONESTO_CLOUDFLARE_ACCOUNT_ID;
const oauthToken = 'oauth-token-kept-only-in-process-memory';
const zoneId = '0123456789abcdef0123456789abcdef';
const invokeWranglerMock = vi.fn<CloudflareWranglerOAuthTestDependencies['invokeWrangler']>();

function success(stdout: string) {
    return { status: 0, signal: null, stdout, stderr: '', error: undefined };
}

function identity(accounts = [{ id: accountId }], authType = 'OAuth Token'): string {
    return JSON.stringify({ loggedIn: true, authType, accounts });
}

function installSuccessfulWrangler(): void {
    invokeWranglerMock.mockImplementation((spec) => {
        const envFile = spec.args.at(-1);
        expect(envFile).toBeTruthy();
        expect(readFileSync(envFile as string, 'utf8')).toBe('');
        if (spec.args.includes('login')) return success('Options:\n  --use-keyring  Use the OS keychain');
        if (spec.args.includes('keyring')) {
            return success('Keyring storage is enabled\nCredentials are currently stored in: Encrypted file (redacted) with key in Windows Credential Manager');
        }
        if (spec.args.includes('whoami')) return success(identity());
        return success(JSON.stringify({ type: 'oauth', token: oauthToken }));
    });
}

function testDependencies(
    fetchImplementation: typeof globalThis.fetch = async () => new Response('{"success":true}'),
    sourceEnv: NodeJS.ProcessEnv = {},
): CloudflareWranglerOAuthTestDependencies {
    return {
        cwd: process.cwd(),
        fetch: fetchImplementation,
        invokeWrangler: invokeWranglerMock,
        sourceEnv,
    };
}

function runWithTestDependencies<T>(
    options: WithCloudflareOAuthOptions<T>,
    dependencies: CloudflareWranglerOAuthTestDependencies = testDependencies(),
): Promise<T> {
    return cloudflareWranglerOAuthTestOnly.withDependencies(options, dependencies);
}

afterEach(() => {
    invokeWranglerMock.mockReset();
});

describe('Cloudflare Wrangler OAuth session provider', () => {
    it('allows only the exact Espanol Honesto Cloudflare account', () => {
        expect(() => assertAllowlistedCloudflareAccount(accountId)).not.toThrow();
        for (const invalid of ['', `${accountId} `, '00000000000000000000000000000000']) {
            expect(() => assertAllowlistedCloudflareAccount(invalid)).toThrowError(
                expect.objectContaining({ code: 'account_not_allowlisted' }),
            );
        }
    });

    it('builds a minimal keyring-only environment without inherited credentials or overrides', () => {
        const environment = buildSanitizedWranglerOAuthEnvironment({
            APPDATA: 'C:\\Users\\test\\AppData\\Roaming',
            CLOUDFLARE_API_BASE_URL: 'https://attacker.invalid',
            CLOUDFLARE_API_KEY: 'global-key',
            CLOUDFLARE_API_TOKEN: 'api-token',
            CLOUDFLARE_EMAIL: 'person@example.com',
            NODE_OPTIONS: '--require malicious-module',
            PATH: 'C:\\safe-bin',
            WRANGLER_AUTH_URL: 'https://attacker.invalid/oauth',
            WRANGLER_OUTPUT_FILE_PATH: 'token-output.json',
        }, accountId);

        expect(environment).toMatchObject({
            APPDATA: 'C:\\Users\\test\\AppData\\Roaming',
            CLOUDFLARE_ACCOUNT_ID: accountId,
            CLOUDFLARE_AUTH_USE_KEYRING: 'true',
            PATH: 'C:\\safe-bin',
            WRANGLER_LOG_SANITIZE: 'true',
            WRANGLER_SEND_ERROR_REPORTS: 'false',
            WRANGLER_SEND_METRICS: 'false',
            WRANGLER_WRITE_LOGS: 'false',
        });
        for (const forbidden of [
            'CLOUDFLARE_API_BASE_URL',
            'CLOUDFLARE_API_KEY',
            'CLOUDFLARE_API_TOKEN',
            'CLOUDFLARE_EMAIL',
            'NODE_OPTIONS',
            'WRANGLER_AUTH_URL',
            'WRANGLER_OUTPUT_FILE_PATH',
        ]) {
            expect(environment).not.toHaveProperty(forbidden);
        }
    });

    it('removes legacy Cloudflare credentials from non-Wrangler child environments', () => {
        const environment = buildCloudflareCredentialFreeChildEnvironment({
            CLOUDFLARE_API_TOKEN: 'legacy-token',
            CLOUDFLARE_API_KEY: 'legacy-key',
            CLOUDFLARE_AUTH_TOKEN: 'legacy-auth-token',
            CLOUDFLARE_EMAIL: 'legacy@example.test',
            CF_API_TOKEN: 'legacy-cf-token',
            CF_API_KEY: 'legacy-cf-key',
            CF_AUTH_TOKEN: 'legacy-cf-auth-token',
            CF_EMAIL: 'legacy-cf@example.test',
            PUBLIC_APP_ENV: 'production',
        }, accountId);

        expect(environment).toEqual({
            CLOUDFLARE_ACCOUNT_ID: accountId,
            PUBLIC_APP_ENV: 'production',
        });
    });

    it('attests keyring and account membership, then confines requests to the allowlisted account', async () => {
        installSuccessfulWrangler();
        const fetchMock = vi.fn(async () => new Response('{"success":true}', { status: 200 }));

        await expect(runWithTestDependencies({
            accountId,
            consume: async (api) => {
                expect(api.accountId).toBe(accountId);
                const response = await api.request('/workers/scripts');
                return response.status;
            },
        }, testDependencies(fetchMock as unknown as typeof globalThis.fetch, {
            CLOUDFLARE_API_TOKEN: 'must-not-leak',
            PATH: 'C:\\safe-bin',
        }))).resolves.toBe(200);

        expect(invokeWranglerMock).toHaveBeenCalledTimes(4);
        const calls = invokeWranglerMock.mock.calls.map(([spec]) => spec);
        expect(calls.map((spec) => spec.args.slice(1, -2))).toEqual([
            ['login', '--help'],
            ['auth', 'keyring'],
            ['whoami', '--json'],
            ['auth', 'token', '--json'],
        ]);
        const isolatedEnvFiles = calls.map((spec) => {
            expect(spec.command).toBe(process.execPath);
            expect(spec.args[0]).toMatch(/[\\/]node_modules[\\/]wrangler[\\/]bin[\\/]wrangler\.js$/u);
            expect(spec.args.at(-2)).toBe('--env-file');
            expect(spec.env.CLOUDFLARE_API_TOKEN).toBeUndefined();
            expect(spec.env.CLOUDFLARE_AUTH_USE_KEYRING).toBe('true');
            expect(spec.env.CLOUDFLARE_ACCOUNT_ID).toBe(accountId);
            expect(spec.env.WRANGLER_WRITE_LOGS).toBe('false');
            return spec.args.at(-1);
        });
        expect(calls[0]?.env.WRANGLER_LOG).toBeUndefined();
        expect(calls[1]?.env.WRANGLER_LOG).toBeUndefined();
        expect(calls[2]?.env.WRANGLER_LOG).toBeUndefined();
        expect(calls[3]?.env.WRANGLER_LOG).toBeUndefined();
        expect(new Set(isolatedEnvFiles).size).toBe(1);
        expect(isolatedEnvFiles[0]).toMatch(/espanol-honesto-wrangler-auth-/u);
        expect(isolatedEnvFiles[0]).toMatch(/[\\/]empty\.env$/u);
        expect(existsSync(isolatedEnvFiles[0] as string)).toBe(false);

        expect(fetchMock).toHaveBeenCalledOnce();
        const [input, requestInit] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
        expect(input.href).toBe(`https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts`);
        const headers = requestInit.headers as Headers;
        expect(headers.get('Authorization')).toBe(`Bearer ${oauthToken}`);
        expect(requestInit.credentials).toBe('omit');
        expect(requestInit.redirect).toBe('error');
    });

    it('accepts an exact full account path without duplicating the account prefix', async () => {
        installSuccessfulWrangler();
        const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));

        await runWithTestDependencies({
            accountId,
            consume: async () => await requestAllowlistedCloudflareAccount(
                `/accounts/${accountId}/workers/scripts`,
            ),
        }, testDependencies(fetchMock as unknown as typeof globalThis.fetch));

        const [input] = fetchMock.mock.calls[0] as unknown as [URL];
        expect(input.href).toBe(`https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts`);
    });

    it('runs scoped Wrangler commands with the same isolated keyring environment and stdin', async () => {
        installSuccessfulWrangler();

        const result = await runWithTestDependencies({
            accountId,
            consume: () => runCloudflareWranglerFromKeyring(
                [
                    'secret',
                    'put',
                    'INTERNAL_JOB_SECRET',
                    '--config',
                    'workers/fulfillment/wrangler.toml',
                    '--env',
                    'production_bootstrap',
                ],
                { input: 'ephemeral-secret', timeoutMs: 240_000 },
            ),
        });

        expect(result.status).toBe(0);
        const command = invokeWranglerMock.mock.calls.at(-1)?.[0];
        expect(command?.args.slice(1, -2)).toEqual([
            'secret',
            'put',
            'INTERNAL_JOB_SECRET',
            '--config',
            'workers/fulfillment/wrangler.toml',
            '--env',
            'production_bootstrap',
        ]);
        expect(command?.input).toBe('ephemeral-secret');
        expect(command?.timeoutMs).toBe(240_000);
        expect(command?.env.CLOUDFLARE_AUTH_USE_KEYRING).toBe('true');
        expect(command?.env.WRANGLER_WRITE_LOGS).toBe('false');
        expect(command?.env.CLOUDFLARE_API_TOKEN).toBeUndefined();
        expect(command?.env.WRANGLER_LOG).toBeUndefined();
    });

    it('rejects every Wrangler command, override and delimiter outside the positive allowlist', async () => {
        installSuccessfulWrangler();

        await expect(runWithTestDependencies({
            accountId,
            consume: () => {
                for (const command of [
                    ['auth', 'token'],
                    ['deploy', '--account-id', 'other-account'],
                    ['deploy', '--config', 'other.toml', '--keep-vars'],
                    ['deploy', '--config=wrangler.toml', '--keep-vars'],
                    ['pages', 'deploy', 'dist'],
                    ['d1', 'execute', 'other-database'],
                    ['secret', 'delete', 'INTERNAL_JOB_SECRET', '--name', 'espanolhonesto'],
                    ['secret', 'put', 'GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY', '--config', 'wrangler.toml', '--env', 'production'],
                    ['secret', 'put', 'STRIPE_SECRET_KEY', '--config', 'workers/fulfillment/wrangler.toml', '--env', 'production_bootstrap'],
                    ['deploy', '--config', 'dist/server/wrangler.json', '--keep-vars', '--tag', 'eh-rc-fulfillment-bootstrap-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'],
                    ['delete', '--name', 'espanolhonesto'],
                    ['whoami', '--json', '--', '--account-id', 'other-account'],
                ]) {
                    expect(() => runCloudflareWranglerFromKeyring(command)).toThrowError(
                        expect.objectContaining({ code: 'wrangler_command_not_allowlisted' }),
                    );
                }
                expect(() => runCloudflareWranglerFromKeyring(
                    ['whoami', '--json'],
                    { timeoutMs: 300_001 },
                )).toThrowError(/300000/u);
                return 'blocked';
            },
        })).resolves.toBe('blocked');
    });

    it('rejects an allowlisted config path when its contents override the account', async () => {
        installSuccessfulWrangler();
        const cwd = mkdtempSync(path.join(tmpdir(), 'eh-cloudflare-config-scope-'));
        writeFileSync(path.join(cwd, 'wrangler.toml'), [
            'name = "espanolhonesto-env-required"',
            'account_id = "00000000000000000000000000000000"',
            '[env.production]',
            'name = "espanolhonesto"',
        ].join('\n'), 'utf8');
        try {
            await expect(runWithTestDependencies({
                accountId,
                consume: () => {
                    expect(() => runCloudflareWranglerFromKeyring([
                        'secret',
                        'list',
                        '--config',
                        'wrangler.toml',
                        '--env',
                        'production',
                        '--format',
                        'json',
                    ])).toThrowError(expect.objectContaining({
                        code: 'wrangler_command_not_allowlisted',
                    }));
                    return 'blocked';
                },
            }, {
                ...testDependencies(),
                cwd,
            })).resolves.toBe('blocked');
        } finally {
            rmSync(cwd, { recursive: true, force: true });
        }
    });

    it('discovers one exact account-owned zone and permits only its read-only routes', async () => {
        installSuccessfulWrangler();
        const fetchMock = vi.fn(async (input: URL | RequestInfo) => {
            const url = input instanceof URL ? input : new URL(String(input));
            if (url.pathname.endsWith('/zones')) {
                expect(url.searchParams.get('name')).toBe(ESPANOL_HONESTO_CLOUDFLARE_ZONE_NAME);
                expect(url.searchParams.get('account.id')).toBe(accountId);
                expect(url.searchParams.get('match')).toBe('all');
                return new Response(JSON.stringify({
                    success: true,
                    result: [{
                        id: zoneId,
                        name: ESPANOL_HONESTO_CLOUDFLARE_ZONE_NAME,
                        account: { id: accountId },
                    }],
                }));
            }
            return new Response(JSON.stringify({ success: true, result: [] }));
        });

        await expect(runWithTestDependencies({
            accountId,
            consume: async () => {
                const zone = await discoverAllowlistedCloudflareZone();
                expect(zone).toEqual({
                    id: zoneId,
                    name: ESPANOL_HONESTO_CLOUDFLARE_ZONE_NAME,
                    accountId,
                });
                const response = await requestAllowlistedCloudflareZoneRead(
                    zone.id,
                    '/workers/routes',
                );
                return response.status;
            },
        }, testDependencies(fetchMock as unknown as typeof globalThis.fetch))).resolves.toBe(200);

        expect(fetchMock).toHaveBeenCalledTimes(2);
        const routeUrl = fetchMock.mock.calls[1]?.[0] as unknown as URL;
        expect(routeUrl.href).toBe(
            `https://api.cloudflare.com/client/v4/zones/${zoneId}/workers/routes`,
        );
    });

    it.each([
        {
            label: 'cross-account discovery',
            result: [{ id: zoneId, name: ESPANOL_HONESTO_CLOUDFLARE_ZONE_NAME, account: { id: 'other' } }],
        },
        {
            label: 'multiple exact matches',
            result: [
                { id: zoneId, name: ESPANOL_HONESTO_CLOUDFLARE_ZONE_NAME, account: { id: accountId } },
                { id: 'fedcba9876543210fedcba9876543210', name: ESPANOL_HONESTO_CLOUDFLARE_ZONE_NAME, account: { id: accountId } },
            ],
        },
    ])('fails closed on $label', async ({ result }) => {
        installSuccessfulWrangler();
        const fetchMock = vi.fn(async () => new Response(JSON.stringify({ success: true, result })));

        await expect(runWithTestDependencies({
            accountId,
            consume: async () => {
                await expect(discoverAllowlistedCloudflareZone()).rejects.toMatchObject({
                    code: 'zone_attestation_failed',
                });
                return 'blocked';
            },
        }, testDependencies(fetchMock as unknown as typeof globalThis.fetch))).resolves.toBe('blocked');
    });

    it.each([
        { path: '/workers/routes', init: { method: 'DELETE' } },
        { path: '/../workers/routes', init: undefined },
        { path: '/%2e%2e/workers/routes', init: undefined },
        { path: '/workers/routes#fragment', init: undefined },
        { path: '/dns_records', init: undefined },
    ])('rejects zone writes and paths outside the exact read allowlist: $path', async ({ path, init }) => {
        installSuccessfulWrangler();
        const fetchMock = vi.fn(async () => new Response(JSON.stringify({
            success: true,
            result: [{
                id: zoneId,
                name: ESPANOL_HONESTO_CLOUDFLARE_ZONE_NAME,
                account: { id: accountId },
            }],
        })));

        await expect(runWithTestDependencies({
            accountId,
            consume: async () => {
                await expect(requestAllowlistedCloudflareZoneRead(zoneId, path, init)).rejects.toMatchObject({
                    code: 'zone_resource_not_allowlisted',
                });
                return 'blocked';
            },
        }, testDependencies(fetchMock as unknown as typeof globalThis.fetch))).resolves.toBe('blocked');
        expect(fetchMock).toHaveBeenCalledOnce();
    });

    it('rejects a different zone id after exact discovery', async () => {
        installSuccessfulWrangler();
        const fetchMock = vi.fn(async () => new Response(JSON.stringify({
            success: true,
            result: [{
                id: zoneId,
                name: ESPANOL_HONESTO_CLOUDFLARE_ZONE_NAME,
                account: { id: accountId },
            }],
        })));

        await expect(runWithTestDependencies({
            accountId,
            consume: async () => {
                await expect(requestAllowlistedCloudflareZoneRead(
                    'fedcba9876543210fedcba9876543210',
                    '/workers/routes',
                )).rejects.toMatchObject({ code: 'zone_resource_not_allowlisted' });
                return 'blocked';
            },
        }, testDependencies(fetchMock as unknown as typeof globalThis.fetch))).resolves.toBe('blocked');
    });

    it('invalidates even a returned API capability after callback exit', async () => {
        installSuccessfulWrangler();
        const fetchMock = vi.fn();

        const api = await runWithTestDependencies(
            { accountId, consume: (scopedApi) => scopedApi },
            testDependencies(fetchMock as unknown as typeof globalThis.fetch),
        );

        await expect(api.request('/workers/scripts')).rejects.toMatchObject({ code: 'oauth_scope_closed' });
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it.each([
        'https://api.cloudflare.com/client/v4/accounts/other/workers/scripts',
        '//api.cloudflare.com/client/v4/accounts/other/workers/scripts',
        '/../user',
        '/%2e%2e/user',
        '/workers\\scripts',
        '/workers/scripts#fragment',
    ])('rejects a resource path outside the account boundary: %s', async (resourcePath) => {
        installSuccessfulWrangler();
        const fetchMock = vi.fn();

        await expect(runWithTestDependencies({
            accountId,
            consume: async (api) => {
                await expect(api.request(resourcePath)).rejects.toMatchObject({
                    code: 'account_resource_not_allowlisted',
                });
                return 'blocked';
            },
        }, testDependencies(fetchMock as unknown as typeof globalThis.fetch))).resolves.toBe('blocked');
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('rejects caller-supplied authentication headers', async () => {
        installSuccessfulWrangler();
        const fetchMock = vi.fn();

        await expect(runWithTestDependencies({
            accountId,
            consume: async (api) => {
                await expect(api.request('/workers/scripts', {
                    headers: { Authorization: 'Bearer attacker-token' },
                })).rejects.toMatchObject({ code: 'account_resource_not_allowlisted' });
                return 'blocked';
            },
        }, testDependencies(fetchMock as unknown as typeof globalThis.fetch))).resolves.toBe('blocked');
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('rejects out-of-scope methods, account products and payloads before transport', async () => {
        installSuccessfulWrangler();
        const fetchMock = vi.fn();
        const queueId = 'a'.repeat(32);
        const siteKey = `0x${'a'.repeat(30)}`;

        await expect(runWithTestDependencies({
            accountId,
            consume: async (api) => {
                for (const [resource, init] of [
                    ['/d1/database', { method: 'GET' }],
                    ['/workers/scripts/espanolhonesto', { method: 'DELETE' }],
                    [`/queues/${queueId}`, {
                        method: 'PATCH',
                        body: JSON.stringify({ settings: { delivery_paused: false } }),
                    }],
                    [`/challenges/widgets/${siteKey}`, {
                        method: 'PUT',
                        body: JSON.stringify({
                            name: 'widget',
                            mode: 'managed',
                            clearance_level: 'no_clearance',
                            domains: ['attacker.example'],
                        }),
                    }],
                ] as const) {
                    await expect(api.request(resource, init)).rejects.toMatchObject({
                        code: 'account_resource_not_allowlisted',
                    });
                }
                return 'blocked';
            },
        }, testDependencies(fetchMock as unknown as typeof globalThis.fetch))).resolves.toBe('blocked');
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('permits only the exact staging Queue and Cron write payload contracts', async () => {
        installSuccessfulWrangler();
        const fetchMock = vi.fn(async () => new Response('{"success":true}', { status: 200 }));
        const queueId = 'a'.repeat(32);

        await runWithTestDependencies({
            accountId,
            consume: async (api) => {
                await api.request(`/queues/${queueId}`, {
                    method: 'PATCH',
                    body: JSON.stringify({
                        queue_name: 'espanol-honesto-fulfillment-staging-queue',
                        settings: { delivery_paused: true },
                    }),
                });
                await api.request('/workers/scripts/espanol-honesto-fulfillment-staging/schedules', {
                    method: 'PUT',
                    body: JSON.stringify([{ cron: '0 * * * *' }]),
                });
            },
        }, testDependencies(fetchMock as unknown as typeof globalThis.fetch));

        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('fails closed when keyring support is absent', async () => {
        invokeWranglerMock.mockReturnValue(success('Options:\n  --browser'));
        await expect(runWithTestDependencies({
            accountId,
            consume: vi.fn(),
        })).rejects.toMatchObject({ code: 'wrangler_keyring_unavailable' });
    });

    it('accepts the encrypted keyring attestation when Wrangler emits status on stderr', async () => {
        const keyringStatus = 'Keyring storage is enabled\nCredentials are currently stored in: Encrypted file (redacted) with key in Windows Credential Manager';
        invokeWranglerMock
            .mockReturnValueOnce(success('--use-keyring'))
            .mockReturnValueOnce({ status: 0, signal: null, stdout: '', stderr: keyringStatus })
            .mockReturnValueOnce(success(identity()))
            .mockReturnValueOnce(success(JSON.stringify({ type: 'oauth', token: oauthToken })));

        await expect(runWithTestDependencies({
            accountId,
            consume: () => 'attested',
        })).resolves.toBe('attested');
    });

    it('fails closed when encrypted Windows Credential Manager storage is not attested', async () => {
        invokeWranglerMock
            .mockReturnValueOnce(success('--use-keyring'))
            .mockReturnValueOnce(success('Keyring storage is disabled'));
        await expect(runWithTestDependencies({
            accountId,
            consume: vi.fn(),
        })).rejects.toMatchObject({ code: 'wrangler_keyring_unavailable' });
    });

    it('fails closed when the OAuth identity does not contain the allowlisted account', async () => {
        invokeWranglerMock
            .mockReturnValueOnce(success('--use-keyring'))
            .mockReturnValueOnce(success('Keyring storage is enabled\nCredentials are currently stored in: Encrypted file (redacted) with key in Windows Credential Manager'))
            .mockReturnValueOnce(success(identity([{ id: 'wrong-account' }])));
        await expect(runWithTestDependencies({
            accountId,
            consume: vi.fn(),
        })).rejects.toMatchObject({ code: 'wrangler_account_attestation_failed' });
    });

    it.each([
        { type: 'api_token', token: oauthToken },
        { type: 'api_key', key: oauthToken, email: 'person@example.com' },
        { type: 'oauth', token: 'short' },
        { type: 'oauth', token: ` ${oauthToken}` },
    ])('rejects a non-OAuth or malformed credential: $type', async (credential) => {
        invokeWranglerMock
            .mockReturnValueOnce(success('--use-keyring'))
            .mockReturnValueOnce(success('Keyring storage is enabled\nCredentials are currently stored in: Encrypted file (redacted) with key in Windows Credential Manager'))
            .mockReturnValueOnce(success(identity()))
            .mockReturnValueOnce(success(JSON.stringify(credential)));
        await expect(runWithTestDependencies({
            accountId,
            consume: vi.fn(),
        })).rejects.toMatchObject({ code: 'wrangler_oauth_retrieval_failed' });
    });

    it('never includes captured stdout, stderr or thrown command errors in provider errors', async () => {
        const leaked = 'secret-that-must-not-appear';
        for (const implementation of [
            () => ({ status: 1, signal: null, stdout: leaked, stderr: leaked }),
            () => { throw new Error(leaked); },
        ]) {
            invokeWranglerMock.mockImplementationOnce(implementation);
            let caught: unknown;
            try {
                await runWithTestDependencies({ accountId, consume: vi.fn() });
            } catch (error) {
                caught = error;
            }
            expect(caught).toBeInstanceOf(CloudflareOAuthSessionError);
            expect(String(caught)).not.toContain(leaked);
            expect((caught as Error).stack).not.toContain(leaked);
            invokeWranglerMock.mockReset();
        }
    });

    it('replaces callback errors so credential-shaped material cannot escape through an error', async () => {
        installSuccessfulWrangler();
        let caught: unknown;
        try {
            await runWithTestDependencies({
                accountId,
                consume: (_api: CloudflareAccountApi) => { throw new Error(oauthToken); },
            });
        } catch (error) {
            caught = error;
        }

        expect(caught).toBeInstanceOf(CloudflareOAuthSessionError);
        expect(caught).toMatchObject({ code: 'oauth_consumer_failed' });
        expect(String(caught)).not.toContain(oauthToken);
        expect((caught as Error).stack).not.toContain(oauthToken);
    });
});
