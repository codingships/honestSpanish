import { describe, expect, it, vi } from 'vitest';
import {
    ALLOWED_SUPABASE_MANAGEMENT_PROJECT_REFS,
    assertAllowedSupabaseManagementProjectRef,
    buildSupabaseWindowsCredentialReaderSpec,
    SupabaseCliCredentialError,
    SUPABASE_CLI_WINDOWS_CREDENTIAL_TARGET,
    supabaseAuthManagementTestOnly,
    withSupabaseAuthManagementClient,
    type SupabaseAuthManagementClient,
    type SupabaseCredentialProcessRunner,
} from '../../scripts/launch/supabase-cli-windows-credential';

const stagingRef = 'mzjyvmlxfpzdfdjzxxyj';
const productionRef = 'vkkahxsybhbutszerawz';
const testToken = ['sbp_', 'a'.repeat(40)].join('');
const stagingSiteUrl = 'https://staging.espanolhonesto.com';
const stagingRequiredRedirects = [
    'https://staging.espanolhonesto.com/api/auth/confirm?lang=es',
    'https://staging.espanolhonesto.com/api/auth/confirm?lang=en',
    'https://staging.espanolhonesto.com/api/auth/confirm?lang=ru',
    'https://staging.espanolhonesto.com/es/reset-password',
    'https://staging.espanolhonesto.com/en/reset-password',
    'https://staging.espanolhonesto.com/ru/reset-password',
];

function successfulReader(
    credential: Buffer = Buffer.from(testToken, 'utf8'),
): SupabaseCredentialProcessRunner {
    return vi.fn().mockResolvedValue({
        exitCode: 0,
        signal: null,
        stdout: credential,
        stderr: Buffer.alloc(0),
    });
}

describe('Supabase CLI Windows credential provider', () => {
    it('keeps the production API dependency-free and blocks the injection seam outside tests', async () => {
        expect(withSupabaseAuthManagementClient).toHaveLength(2);
        const runProcess = successfulReader();
        const fetcher = vi.fn();
        const previousNodeEnv = process.env.NODE_ENV;
        process.env.NODE_ENV = 'production';
        try {
            await expect(supabaseAuthManagementTestOnly.withDependencies(stagingRef, vi.fn(), {
                platform: 'win32',
                env: { SystemRoot: 'C:\\Windows' },
                runProcess,
                fetcher,
            })).rejects.toMatchObject({ code: 'test_only_forbidden' });
        } finally {
            if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
            else process.env.NODE_ENV = previousNodeEnv;
        }
        expect(runProcess).not.toHaveBeenCalled();
        expect(fetcher).not.toHaveBeenCalled();
    });

    it('pins the exact staging and production project allowlist', () => {
        expect(ALLOWED_SUPABASE_MANAGEMENT_PROJECT_REFS).toEqual([
            stagingRef,
            productionRef,
        ]);
        expect(Object.isFrozen(ALLOWED_SUPABASE_MANAGEMENT_PROJECT_REFS)).toBe(true);
        expect(SUPABASE_CLI_WINDOWS_CREDENTIAL_TARGET).toBe('Supabase CLI:supabase');
        expect(() => assertAllowedSupabaseManagementProjectRef(stagingRef)).not.toThrow();
        expect(() => assertAllowedSupabaseManagementProjectRef(productionRef)).not.toThrow();
    });

    it.each([
        '',
        'unknown-project',
        `${stagingRef} `,
        stagingRef.toUpperCase(),
    ])('rejects a non-exact project ref before reading credentials: %s', async (projectRef) => {
        const runProcess = successfulReader();
        const operation = vi.fn();

        await expect(supabaseAuthManagementTestOnly.withDependencies(projectRef, operation, {
            platform: 'win32',
            env: { SystemRoot: 'C:\\Windows' },
            runProcess,
        })).rejects.toMatchObject({ code: 'project_not_allowed' });

        expect(runProcess).not.toHaveBeenCalled();
        expect(operation).not.toHaveBeenCalled();
    });

    it('fails closed on non-Windows platforms without reading credentials', async () => {
        const runProcess = successfulReader();

        await expect(supabaseAuthManagementTestOnly.withDependencies(stagingRef, vi.fn(), {
            platform: 'linux',
            runProcess,
        })).rejects.toMatchObject({ code: 'unsupported_platform' });

        expect(runProcess).not.toHaveBeenCalled();
    });

    it('provides only a project-scoped Auth client and clears credential buffers', async () => {
        const processStdout = Buffer.from(testToken, 'utf8');
        const processStderr = Buffer.alloc(0);
        const runProcess = vi.fn().mockResolvedValue({
            exitCode: 0,
            signal: null,
            stdout: processStdout,
            stderr: processStderr,
        });
        const fetcher = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
        const operation = vi.fn(async (client: Readonly<SupabaseAuthManagementClient>) => {
            expect(client.projectRef).toBe(stagingRef);
            expect(Object.keys(client).sort()).toEqual(['getAuthConfig', 'patchAuthConfig', 'projectRef']);
            expect(JSON.stringify(client)).not.toContain(testToken);
            expect(processStdout.equals(Buffer.alloc(processStdout.length))).toBe(true);
            await client.getAuthConfig();
            return 'operation-complete';
        });

        await expect(supabaseAuthManagementTestOnly.withDependencies(stagingRef, operation, {
            platform: 'win32',
            env: { SystemRoot: 'C:\\Windows' },
            runProcess,
            fetcher,
        })).resolves.toBe('operation-complete');

        expect(operation).toHaveBeenCalledOnce();
        expect(fetcher).toHaveBeenCalledExactlyOnceWith(
            `https://api.supabase.com/v1/projects/${stagingRef}/config/auth`,
            expect.objectContaining({
                method: 'GET',
                headers: expect.objectContaining({ Authorization: `Bearer ${testToken}` }),
                redirect: 'error',
            }),
        );
        expect(processStdout.equals(Buffer.alloc(processStdout.length))).toBe(true);
        expect(processStderr.equals(Buffer.alloc(processStderr.length))).toBe(true);
    });

    it('accepts the UTF-16LE blob shape used by some Windows credential writers', async () => {
        const operation = vi.fn().mockReturnValue('ok');

        await expect(supabaseAuthManagementTestOnly.withDependencies(productionRef, operation, {
            platform: 'win32',
            env: { SystemRoot: 'C:\\Windows' },
            runProcess: successfulReader(Buffer.from(testToken, 'utf16le')),
        })).resolves.toBe('ok');

        expect(operation).toHaveBeenCalledOnce();
    });

    it('confines production PATCH to the exact Auth endpoint and inertness booleans', async () => {
        const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));

        await supabaseAuthManagementTestOnly.withDependencies(productionRef, async (client) => {
            await client.patchAuthConfig({
                disable_signup: true,
                mailer_autoconfirm: false,
            });
        }, {
            platform: 'win32',
            env: { SystemRoot: 'C:\\Windows' },
            runProcess: successfulReader(),
            fetcher,
        });

        expect(fetcher).toHaveBeenCalledExactlyOnceWith(
            `https://api.supabase.com/v1/projects/${productionRef}/config/auth`,
            expect.objectContaining({
                method: 'PATCH',
                headers: expect.objectContaining({
                    Authorization: `Bearer ${testToken}`,
                    'Content-Type': 'application/json',
                }),
                body: JSON.stringify({
                    disable_signup: true,
                    mailer_autoconfirm: false,
                }),
            }),
        );
    });

    it.each([
        { site_url: stagingSiteUrl },
        { uri_allow_list: stagingRequiredRedirects.join(',') },
        { disable_signup: true, site_url: stagingSiteUrl },
    ])('rejects URL capability on production before transport %#', async (patch) => {
        const fetcher = vi.fn();

        await expect(supabaseAuthManagementTestOnly.withDependencies(
            productionRef,
            async (client) => await client.patchAuthConfig(patch),
            {
                platform: 'win32',
                env: { SystemRoot: 'C:\\Windows' },
                runProcess: successfulReader(),
                fetcher,
            },
        )).rejects.toMatchObject({ code: 'patch_invalid' });

        expect(fetcher).not.toHaveBeenCalled();
    });

    it('allows staging only the canonical merged redirects and the captured rollback baseline', async () => {
        const legacyRedirect = 'https://legacy-staging.example.test/auth/confirm';
        const baseline = {
            site_url: 'https://old-staging.example.test',
            uri_allow_list: legacyRedirect,
        };
        const mergedRedirects = [legacyRedirect, ...stagingRequiredRedirects].join(',');
        const fetcher = vi.fn()
            .mockResolvedValueOnce(new Response(JSON.stringify(baseline), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            }))
            .mockResolvedValue(new Response(null, { status: 200 }));

        await supabaseAuthManagementTestOnly.withDependencies(stagingRef, async (client) => {
            await client.getAuthConfig();
            await client.patchAuthConfig({
                site_url: stagingSiteUrl,
                uri_allow_list: mergedRedirects,
            });
            await client.patchAuthConfig({
                site_url: baseline.site_url,
                uri_allow_list: baseline.uri_allow_list,
            });
        }, {
            platform: 'win32',
            env: { SystemRoot: 'C:\\Windows' },
            runProcess: successfulReader(),
            fetcher,
        });

        expect(fetcher).toHaveBeenNthCalledWith(2,
            `https://api.supabase.com/v1/projects/${stagingRef}/config/auth`,
            expect.objectContaining({
                method: 'PATCH',
                body: JSON.stringify({
                    site_url: stagingSiteUrl,
                    uri_allow_list: mergedRedirects,
                }),
            }));
        expect(fetcher).toHaveBeenNthCalledWith(3,
            `https://api.supabase.com/v1/projects/${stagingRef}/config/auth`,
            expect.objectContaining({
                method: 'PATCH',
                body: JSON.stringify(baseline),
            }));
    });

    it('rejects staging PATCH before a successful baseline GET', async () => {
        const fetcher = vi.fn();

        await expect(supabaseAuthManagementTestOnly.withDependencies(stagingRef, async (client) => {
            await client.patchAuthConfig({ site_url: stagingSiteUrl });
        }, {
            platform: 'win32',
            env: { SystemRoot: 'C:\\Windows' },
            runProcess: successfulReader(),
            fetcher,
        })).rejects.toMatchObject({ code: 'patch_invalid' });

        expect(fetcher).not.toHaveBeenCalled();
    });

    it.each([
        { site_url: 'https://attacker.example' },
        { uri_allow_list: 'https://attacker.example/auth/confirm' },
        { uri_allow_list: 'https://staging.espanolhonesto.com/**' },
    ])('rejects non-canonical staging URL material after baseline %#', async (patch) => {
        const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
            site_url: stagingSiteUrl,
            uri_allow_list: stagingRequiredRedirects.join(','),
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        }));

        await expect(supabaseAuthManagementTestOnly.withDependencies(stagingRef, async (client) => {
            await client.getAuthConfig();
            await client.patchAuthConfig(patch);
        }, {
            platform: 'win32',
            env: { SystemRoot: 'C:\\Windows' },
            runProcess: successfulReader(),
            fetcher,
        })).rejects.toMatchObject({ code: 'patch_invalid' });

        expect(fetcher).toHaveBeenCalledTimes(1);
    });

    it.each([
        {},
        { smtp_pass: 'forbidden' },
        { disable_signup: 'true' },
        { site_url: false },
    ])('rejects unsafe Auth PATCH material before transport %#', async (patch) => {
        const fetcher = vi.fn();

        await expect(supabaseAuthManagementTestOnly.withDependencies(stagingRef, async (client) => {
            await client.patchAuthConfig(patch as never);
        }, {
            platform: 'win32',
            env: { SystemRoot: 'C:\\Windows' },
            runProcess: successfulReader(),
            fetcher,
        })).rejects.toMatchObject({ code: 'patch_invalid' });

        expect(fetcher).not.toHaveBeenCalled();
    });

    it('serializes a fresh safe-field object instead of caller-controlled toJSON', async () => {
        const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
        const patch = Object.assign(
            Object.create({
                toJSON: () => ({ smtp_pass: 'forbidden' }),
            }) as Record<string, unknown>,
            { disable_signup: true },
        );

        await supabaseAuthManagementTestOnly.withDependencies(productionRef, async (client) => {
            await client.patchAuthConfig(patch as never);
        }, {
            platform: 'win32',
            env: { SystemRoot: 'C:\\Windows' },
            runProcess: successfulReader(),
            fetcher,
        });

        expect(fetcher).toHaveBeenCalledExactlyOnceWith(
            `https://api.supabase.com/v1/projects/${productionRef}/config/auth`,
            expect.objectContaining({
                method: 'PATCH',
                body: JSON.stringify({ disable_signup: true }),
            }),
        );
    });

    it('revokes a client that escapes the callback and clears its credential closure', async () => {
        const fetcher = vi.fn();
        let escapedClient: Readonly<SupabaseAuthManagementClient> | null = null;

        const returned = await supabaseAuthManagementTestOnly.withDependencies(stagingRef, (client) => {
            escapedClient = client;
            return client;
        }, {
            platform: 'win32',
            env: { SystemRoot: 'C:\\Windows' },
            runProcess: successfulReader(),
            fetcher,
        });

        expect(returned).toBe(escapedClient);
        expect(JSON.stringify(returned)).not.toContain(testToken);
        await expect(returned.getAuthConfig()).rejects.toMatchObject({ code: 'client_released' });
        expect(fetcher).not.toHaveBeenCalled();
    });

    it('accepts only the progress-only CLIXML emitted by Windows PowerShell 5.1 startup', async () => {
        const progressOnly = Buffer.from([
            '#< CLIXML',
            '<Objs Version="1.1.0.1" xmlns="http://schemas.microsoft.com/powershell/2004/04">',
            '<Obj S="progress"><Nil N="CurrentOperation" /></Obj>',
            '</Objs>',
        ].join('\r\n'), 'utf8');
        const operation = vi.fn().mockReturnValue('ok');

        await expect(supabaseAuthManagementTestOnly.withDependencies(stagingRef, operation, {
            platform: 'win32',
            env: { SystemRoot: 'C:\\Windows' },
            runProcess: vi.fn().mockResolvedValue({
                exitCode: 0,
                signal: null,
                stdout: Buffer.from(testToken, 'utf8'),
                stderr: progressOnly,
            }),
        })).resolves.toBe('ok');

        expect(operation).toHaveBeenCalledOnce();
        expect(progressOnly.equals(Buffer.alloc(progressOnly.length))).toBe(true);
    });

    it.each([
        '#< CLIXML\r\n<Objs xmlns="http://schemas.microsoft.com/powershell/2004/04"><Obj S="error" /></Objs>',
        '#< CLIXML\r\n<Objs xmlns="http://schemas.microsoft.com/powershell/2004/04"><E>failure</E><Obj S="progress" /></Objs>',
        '<Objs xmlns="http://schemas.microsoft.com/powershell/2004/04"><Obj S="progress" /></Objs>',
    ])('rejects every stderr shape other than closed progress-only CLIXML', async (diagnostic) => {
        const operation = vi.fn();

        await expect(supabaseAuthManagementTestOnly.withDependencies(stagingRef, operation, {
            platform: 'win32',
            env: { SystemRoot: 'C:\\Windows' },
            runProcess: vi.fn().mockResolvedValue({
                exitCode: 0,
                signal: null,
                stdout: Buffer.from(testToken, 'utf8'),
                stderr: Buffer.from(diagnostic, 'utf8'),
            }),
        })).rejects.toMatchObject({ code: 'credential_reader_failed' });

        expect(operation).not.toHaveBeenCalled();
    });

    it.each([
        Buffer.from('not-a-supabase-token', 'utf8'),
        Buffer.from(`${testToken}\n`, 'utf8'),
        Buffer.from(`Bearer ${testToken}`, 'utf8'),
        Buffer.alloc(0),
    ])('rejects malformed credential material without exposing it in the error', async (credential) => {
        const operation = vi.fn();
        let error: unknown;
        try {
            await supabaseAuthManagementTestOnly.withDependencies(stagingRef, operation, {
                platform: 'win32',
                env: { SystemRoot: 'C:\\Windows' },
                runProcess: successfulReader(credential),
            });
        } catch (caught) {
            error = caught;
        }

        expect(error).toBeInstanceOf(SupabaseCliCredentialError);
        expect((error as SupabaseCliCredentialError).code)
            .toMatch(/credential_(?:invalid|missing)/u);
        expect(String(error)).not.toContain(testToken);
        expect(String(error)).not.toContain('not-a-supabase-token');
        expect(operation).not.toHaveBeenCalled();
    });

    it('redacts child diagnostics and clears all process buffers on failure', async () => {
        const processStdout = Buffer.from(testToken, 'utf8');
        const processStderr = Buffer.from(`failure accidentally included ${testToken}`, 'utf8');
        let error: unknown;
        try {
            await supabaseAuthManagementTestOnly.withDependencies(productionRef, vi.fn(), {
                platform: 'win32',
                env: { SystemRoot: 'C:\\Windows' },
                runProcess: vi.fn().mockResolvedValue({
                    exitCode: 1,
                    signal: null,
                    stdout: processStdout,
                    stderr: processStderr,
                }),
            });
        } catch (caught) {
            error = caught;
        }

        expect(error).toMatchObject({ code: 'credential_reader_failed' });
        expect(String(error)).not.toContain(testToken);
        expect(processStdout.equals(Buffer.alloc(processStdout.length))).toBe(true);
        expect(processStderr.equals(Buffer.alloc(processStderr.length))).toBe(true);
    });

    it('does not swallow callback failures and still clears credential material', async () => {
        const processStdout = Buffer.from(testToken, 'utf8');
        const callbackError = new Error('operation deliberately stopped');

        await expect(supabaseAuthManagementTestOnly.withDependencies(productionRef, async () => {
            throw callbackError;
        }, {
            platform: 'win32',
            env: { SystemRoot: 'C:\\Windows' },
            runProcess: successfulReader(processStdout),
        })).rejects.toBe(callbackError);

        expect(processStdout.equals(Buffer.alloc(processStdout.length))).toBe(true);
    });

    it('builds an absolute no-shell reader with an allowlisted environment only', () => {
        const spec = buildSupabaseWindowsCredentialReaderSpec({
            SystemRoot: 'C:\\Windows',
            TEMP: 'C:\\Temp',
            USERPROFILE: 'C:\\Users\\Example',
            SUPABASE_ACCESS_TOKEN: testToken,
            CLOUDFLARE_API_TOKEN: 'must-not-cross-process-boundary',
            ANOTHER_SECRET: 'must-not-cross-process-boundary',
        });

        expect(spec.executable).toBe(
            'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
        );
        expect(spec.args.slice(0, 3)).toEqual(['-NoLogo', '-NoProfile', '-NonInteractive']);
        expect(spec.args).toContain('-EncodedCommand');
        expect(spec.env).toEqual({
            SystemRoot: 'C:\\Windows',
            TEMP: 'C:\\Temp',
            USERPROFILE: 'C:\\Users\\Example',
        });
        expect(JSON.stringify(spec)).not.toContain(testToken);
        expect(JSON.stringify(spec)).not.toContain('must-not-cross-process-boundary');
    });

    it('refuses a missing or relative SystemRoot rather than searching PATH', () => {
        for (const env of [{}, { SystemRoot: 'Windows' }]) {
            let error: unknown;
            try {
                buildSupabaseWindowsCredentialReaderSpec(env);
            } catch (caught) {
                error = caught;
            }
            expect(error).toMatchObject({ code: 'credential_reader_unavailable' });
        }
    });

    it('requires an operation callback before touching Credential Manager', async () => {
        const runProcess = successfulReader();

        await expect(supabaseAuthManagementTestOnly.withDependencies(stagingRef, null as never, {
            platform: 'win32',
            env: { SystemRoot: 'C:\\Windows' },
            runProcess,
        })).rejects.toMatchObject({ code: 'operation_missing' });

        expect(runProcess).not.toHaveBeenCalled();
    });
});
