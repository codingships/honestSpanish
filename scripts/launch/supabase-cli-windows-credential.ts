import { spawn } from 'node:child_process';
import path from 'node:path';

export const SUPABASE_CLI_WINDOWS_CREDENTIAL_TARGET = 'Supabase CLI:supabase';
const SUPABASE_MANAGEMENT_API_BASE = 'https://api.supabase.com';

export const ALLOWED_SUPABASE_MANAGEMENT_PROJECT_REFS = Object.freeze([
    'mzjyvmlxfpzdfdjzxxyj',
    'vkkahxsybhbutszerawz',
] as const);

const STAGING_PROJECT_REF = 'mzjyvmlxfpzdfdjzxxyj';
const PRODUCTION_PROJECT_REF = 'vkkahxsybhbutszerawz';
const STAGING_CANONICAL_SITE_URL = 'https://staging.espanolhonesto.com';
const STAGING_REQUIRED_AUTH_REDIRECTS = Object.freeze([
    'https://staging.espanolhonesto.com/api/auth/confirm?lang=es',
    'https://staging.espanolhonesto.com/api/auth/confirm?lang=en',
    'https://staging.espanolhonesto.com/api/auth/confirm?lang=ru',
    'https://staging.espanolhonesto.com/es/reset-password',
    'https://staging.espanolhonesto.com/en/reset-password',
    'https://staging.espanolhonesto.com/ru/reset-password',
] as const);

export type AllowedSupabaseManagementProjectRef =
    typeof ALLOWED_SUPABASE_MANAGEMENT_PROJECT_REFS[number];

export interface SupabaseAuthManagementPatch {
    disable_signup?: boolean;
    mailer_autoconfirm?: boolean;
    site_url?: string;
    uri_allow_list?: string;
}

export interface SupabaseAuthManagementClient {
    readonly projectRef: AllowedSupabaseManagementProjectRef;
    readonly getAuthConfig: () => Promise<Response>;
    readonly patchAuthConfig: (patch: SupabaseAuthManagementPatch) => Promise<Response>;
}

export type SupabaseManagementFetcher = (
    input: string,
    init: RequestInit,
) => Promise<Response>;

const MAX_CREDENTIAL_BYTES = 4_096;
const MAX_DIAGNOSTIC_BYTES = 8_192;
const CREDENTIAL_READER_TIMEOUT_MS = 10_000;
const ACCESS_TOKEN_PATTERN = /^sbp_[A-Za-z0-9_-]{20,512}$/u;

const SAFE_WINDOWS_ENVIRONMENT_KEYS = [
    'APPDATA',
    'ComSpec',
    'LOCALAPPDATA',
    'PATHEXT',
    'PSModulePath',
    'SystemRoot',
    'TEMP',
    'TMP',
    'USERPROFILE',
    'WINDIR',
] as const;

const WINDOWS_CREDENTIAL_READER_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'

$null = Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;

public static class EspanolHonestoSupabaseCredentialReader
{
    private const uint CredTypeGeneric = 1;

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct Credential
    {
        public uint Flags;
        public uint Type;
        public IntPtr TargetName;
        public IntPtr Comment;
        public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
        public uint CredentialBlobSize;
        public IntPtr CredentialBlob;
        public uint Persist;
        public uint AttributeCount;
        public IntPtr Attributes;
        public IntPtr TargetAlias;
        public IntPtr UserName;
    }

    [DllImport("advapi32.dll", EntryPoint = "CredReadW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CredRead(
        string target,
        uint type,
        uint flags,
        out IntPtr credentialPointer
    );

    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern void CredFree(IntPtr credentialPointer);

    public static byte[] ReadGeneric(string target)
    {
        IntPtr credentialPointer;
        if (!CredRead(target, CredTypeGeneric, 0, out credentialPointer))
        {
            throw new Win32Exception(Marshal.GetLastWin32Error());
        }

        try
        {
            Credential credential = Marshal.PtrToStructure<Credential>(credentialPointer);
            byte[] bytes = new byte[credential.CredentialBlobSize];
            if (bytes.Length > 0)
            {
                Marshal.Copy(credential.CredentialBlob, bytes, 0, bytes.Length);
            }
            return bytes;
        }
        finally
        {
            CredFree(credentialPointer);
        }
    }
}
'@

$credential = [EspanolHonestoSupabaseCredentialReader]::ReadGeneric('${SUPABASE_CLI_WINDOWS_CREDENTIAL_TARGET}')
try {
    $stdout = [Console]::OpenStandardOutput()
    $stdout.Write($credential, 0, $credential.Length)
    $stdout.Flush()
}
finally {
    if ($null -ne $credential) {
        [Array]::Clear($credential, 0, $credential.Length)
    }
}
`;

export type SupabaseCredentialErrorCode =
    | 'credential_invalid'
    | 'credential_missing'
    | 'credential_reader_failed'
    | 'credential_reader_timeout'
    | 'credential_reader_unavailable'
    | 'credential_too_large'
    | 'client_released'
    | 'operation_missing'
    | 'patch_invalid'
    | 'project_not_allowed'
    | 'test_only_forbidden'
    | 'unsupported_platform';

export class SupabaseCliCredentialError extends Error {
    readonly code: SupabaseCredentialErrorCode;

    constructor(code: SupabaseCredentialErrorCode, message: string) {
        super(message);
        this.name = 'SupabaseCliCredentialError';
        this.code = code;
    }
}

export interface SupabaseCredentialReaderProcessSpec {
    readonly executable: string;
    readonly args: readonly string[];
    readonly env: Readonly<Record<string, string>>;
    readonly timeoutMs: number;
    readonly maxStdoutBytes: number;
    readonly maxStderrBytes: number;
}

export interface SupabaseCredentialReaderProcessResult {
    readonly exitCode: number | null;
    readonly signal: NodeJS.Signals | null;
    readonly stdout: Buffer;
    readonly stderr: Buffer;
}

export type SupabaseCredentialProcessRunner = (
    spec: SupabaseCredentialReaderProcessSpec,
) => Promise<SupabaseCredentialReaderProcessResult>;

interface SupabaseCliCredentialProviderDependencies {
    readonly platform?: NodeJS.Platform;
    readonly env?: NodeJS.ProcessEnv;
    readonly runProcess?: SupabaseCredentialProcessRunner;
    /** Test-only transport seam. Production runners always use global fetch. */
    readonly fetcher?: SupabaseManagementFetcher;
}

/**
 * Runs one exact Auth Management API operation with the Supabase CLI PAT held
 * only inside a private, revocable client closure. Callers never receive the
 * PAT or a generic request primitive.
 *
 * The project ref is checked before Windows Credential Manager is touched.
 * There is deliberately no environment-variable or plaintext-file fallback.
 */
export async function withSupabaseAuthManagementClient<T>(
    projectRef: string,
    operation: (client: Readonly<SupabaseAuthManagementClient>) => T | Promise<T>,
): Promise<T> {
    return await withSupabaseAuthManagementClientDependencies(projectRef, operation, {});
}

export const supabaseAuthManagementTestOnly = Object.freeze({
    async withDependencies<T>(
        projectRef: string,
        operation: (client: Readonly<SupabaseAuthManagementClient>) => T | Promise<T>,
        dependencies: SupabaseCliCredentialProviderDependencies,
    ): Promise<T> {
        if (process.env.NODE_ENV !== 'test') {
            throw new SupabaseCliCredentialError(
                'test_only_forbidden',
                'Supabase Auth Management dependency injection is available only under NODE_ENV=test.',
            );
        }
        return await withSupabaseAuthManagementClientDependencies(
            projectRef,
            operation,
            dependencies,
        );
    },
});

async function withSupabaseAuthManagementClientDependencies<T>(
    projectRef: string,
    operation: (client: Readonly<SupabaseAuthManagementClient>) => T | Promise<T>,
    dependencies: SupabaseCliCredentialProviderDependencies,
): Promise<T> {
    assertAllowedSupabaseManagementProjectRef(projectRef);
    if (typeof operation !== 'function') {
        throw new SupabaseCliCredentialError(
            'operation_missing',
            'Supabase credential use requires an in-memory operation callback.',
        );
    }

    const platform = dependencies.platform ?? process.platform;
    if (platform !== 'win32') {
        throw new SupabaseCliCredentialError(
            'unsupported_platform',
            'The Supabase CLI credential provider requires Windows Credential Manager.',
        );
    }

    let credentialBlob: Buffer | null = null;
    const credentialState = {
        active: false,
        accessToken: '',
    };
    try {
        credentialBlob = await readSupabaseCliCredentialBlob({
            env: dependencies.env ?? process.env,
            runProcess: dependencies.runProcess ?? runSupabaseCredentialReaderProcess,
        });
        credentialState.accessToken = decodeAndValidateAccessToken(credentialBlob);
        credentialState.active = true;
        const client = createSupabaseAuthManagementClient(
            projectRef,
            credentialState,
            dependencies.fetcher ?? fetch,
        );
        return await operation(client);
    } finally {
        credentialState.active = false;
        credentialState.accessToken = '';
        credentialBlob?.fill(0);
    }
}

export function assertAllowedSupabaseManagementProjectRef(
    projectRef: string,
): asserts projectRef is AllowedSupabaseManagementProjectRef {
    if (!ALLOWED_SUPABASE_MANAGEMENT_PROJECT_REFS.some((allowed) => allowed === projectRef)) {
        throw new SupabaseCliCredentialError(
            'project_not_allowed',
            'Supabase credential access was refused because the project ref is not allowlisted.',
        );
    }
}

function createSupabaseAuthManagementClient(
    projectRef: AllowedSupabaseManagementProjectRef,
    credentialState: { active: boolean; accessToken: string },
    fetcher: SupabaseManagementFetcher,
): Readonly<SupabaseAuthManagementClient> {
    const endpoint = `${SUPABASE_MANAGEMENT_API_BASE}/v1/projects/${projectRef}/config/auth`;
    let initialStagingBaseline: StagingAuthBaseline | null = null;
    let initialStagingBaselineCaptured = false;
    const request = async (
        method: 'GET' | 'PATCH',
        patch?: SupabaseAuthManagementPatch,
    ): Promise<Response> => {
        if (!credentialState.active || !credentialState.accessToken) {
            throw new SupabaseCliCredentialError(
                'client_released',
                'The scoped Supabase Auth Management client is no longer active.',
            );
        }
        if (method === 'PATCH') {
            assertSafeAuthManagementPatch(projectRef, patch, initialStagingBaseline);
        }

        const headers: Record<string, string> = {
            Accept: 'application/json',
            Authorization: `Bearer ${credentialState.accessToken}`,
        };
        const init: RequestInit = {
            method,
            headers,
            redirect: 'error',
            signal: AbortSignal.timeout(20_000),
        };
        if (method === 'PATCH') {
            headers['Content-Type'] = 'application/json';
            init.body = JSON.stringify(copySafeAuthManagementPatch(
                projectRef,
                patch,
                initialStagingBaseline,
            ));
        }
        const response = await fetcher(endpoint, init);
        if (method === 'GET'
            && projectRef === STAGING_PROJECT_REF
            && !initialStagingBaselineCaptured) {
            initialStagingBaselineCaptured = true;
            initialStagingBaseline = await readInitialStagingAuthBaseline(response);
        }
        return response;
    };

    return Object.freeze({
        projectRef,
        getAuthConfig: async () => await request('GET'),
        patchAuthConfig: async (patch: SupabaseAuthManagementPatch) => await request('PATCH', patch),
    });
}

function copySafeAuthManagementPatch(
    projectRef: AllowedSupabaseManagementProjectRef,
    patch: SupabaseAuthManagementPatch | undefined,
    initialStagingBaseline: StagingAuthBaseline | null,
): SupabaseAuthManagementPatch {
    assertSafeAuthManagementPatch(projectRef, patch, initialStagingBaseline);
    const safePatch: SupabaseAuthManagementPatch = {};
    if (Object.hasOwn(patch, 'disable_signup') && typeof patch.disable_signup === 'boolean') {
        safePatch.disable_signup = patch.disable_signup;
    }
    if (Object.hasOwn(patch, 'mailer_autoconfirm') && typeof patch.mailer_autoconfirm === 'boolean') {
        safePatch.mailer_autoconfirm = patch.mailer_autoconfirm;
    }
    if (Object.hasOwn(patch, 'site_url') && typeof patch.site_url === 'string') {
        safePatch.site_url = patch.site_url;
    }
    if (Object.hasOwn(patch, 'uri_allow_list') && typeof patch.uri_allow_list === 'string') {
        safePatch.uri_allow_list = patch.uri_allow_list;
    }
    return safePatch;
}

function assertSafeAuthManagementPatch(
    projectRef: AllowedSupabaseManagementProjectRef,
    patch: SupabaseAuthManagementPatch | undefined,
    initialStagingBaseline: StagingAuthBaseline | null,
): asserts patch is SupabaseAuthManagementPatch {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
        throw new SupabaseCliCredentialError(
            'patch_invalid',
            'Supabase Auth Management PATCH requires a safe object.',
        );
    }
    const entries = Object.entries(patch);
    if (entries.length === 0) {
        throw new SupabaseCliCredentialError(
            'patch_invalid',
            'Supabase Auth Management PATCH must not be empty.',
        );
    }
    const allowedKeys = projectRef === PRODUCTION_PROJECT_REF
        ? new Set(['disable_signup', 'mailer_autoconfirm'])
        : new Set(['site_url', 'uri_allow_list']);
    for (const [key, value] of entries) {
        const booleanKey = key === 'disable_signup' || key === 'mailer_autoconfirm';
        const stringKey = key === 'site_url' || key === 'uri_allow_list';
        if (!allowedKeys.has(key)
            || (booleanKey && typeof value !== 'boolean')
            || (stringKey && typeof value !== 'string')) {
            throw new SupabaseCliCredentialError(
                'patch_invalid',
                'Supabase Auth Management PATCH contains a forbidden field or value.',
            );
        }
    }

    if (projectRef === STAGING_PROJECT_REF) {
        if (!initialStagingBaseline) {
            throw new SupabaseCliCredentialError(
                'patch_invalid',
                'Supabase staging Auth PATCH requires a successful baseline GET first.',
            );
        }
        if (Object.hasOwn(patch, 'site_url')
            && patch.site_url !== STAGING_CANONICAL_SITE_URL
            && patch.site_url !== initialStagingBaseline.siteUrl) {
            throw new SupabaseCliCredentialError(
                'patch_invalid',
                'Supabase staging Auth PATCH contains a non-canonical site URL.',
            );
        }
        if (Object.hasOwn(patch, 'uri_allow_list')) {
            const expectedMergedAllowList = buildExpectedStagingAllowList(
                initialStagingBaseline.uriAllowList,
            );
            if (patch.uri_allow_list !== initialStagingBaseline.uriAllowList
                && patch.uri_allow_list !== expectedMergedAllowList) {
                throw new SupabaseCliCredentialError(
                    'patch_invalid',
                    'Supabase staging Auth PATCH contains an unapproved redirect allowlist.',
                );
            }
        }
    }
}

interface StagingAuthBaseline {
    readonly siteUrl: string;
    readonly uriAllowList: string;
}

async function readInitialStagingAuthBaseline(
    response: Response,
): Promise<StagingAuthBaseline | null> {
    if (!response.ok) return null;
    try {
        const payload = await response.clone().json() as unknown;
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
        const record = payload as Record<string, unknown>;
        if (typeof record.site_url !== 'string' || typeof record.uri_allow_list !== 'string') {
            return null;
        }
        return Object.freeze({
            siteUrl: record.site_url,
            uriAllowList: record.uri_allow_list,
        });
    } catch {
        return null;
    }
}

function buildExpectedStagingAllowList(currentValue: string): string | null {
    const merged: string[] = [];
    const seen = new Set<string>();
    for (const rawEntry of currentValue.split(',')) {
        const entry = rawEntry.trim();
        if (!entry || seen.has(entry)) continue;
        if (hasBroadAuthRedirectWildcard(entry)) return null;
        seen.add(entry);
        merged.push(entry);
    }
    for (const entry of STAGING_REQUIRED_AUTH_REDIRECTS) {
        if (seen.has(entry)) continue;
        seen.add(entry);
        merged.push(entry);
    }
    return merged.join(',');
}

function hasBroadAuthRedirectWildcard(value: string): boolean {
    const entry = value.trim();
    if (!entry) return false;
    if (/[*[\]{}\\]/u.test(entry)
        || /%(?:2a|5b|5d|7b|7d|5c)/iu.test(entry)) {
        return true;
    }
    const queryDelimiter = entry.indexOf('?');
    if (queryDelimiter < 0) return false;
    const query = entry.slice(queryDelimiter + 1);
    return query.length === 0 || !query.includes('=');
}

export function buildSupabaseWindowsCredentialReaderSpec(
    sourceEnv: NodeJS.ProcessEnv = process.env,
): SupabaseCredentialReaderProcessSpec {
    const systemRoot = readEnvironmentValue(sourceEnv, 'SystemRoot');
    if (!systemRoot || !path.win32.isAbsolute(systemRoot)) {
        throw new SupabaseCliCredentialError(
            'credential_reader_unavailable',
            'Windows SystemRoot is unavailable for the Supabase credential reader.',
        );
    }

    const executable = path.win32.join(
        systemRoot,
        'System32',
        'WindowsPowerShell',
        'v1.0',
        'powershell.exe',
    );
    const encodedCommand = Buffer.from(WINDOWS_CREDENTIAL_READER_SCRIPT, 'utf16le').toString('base64');

    return Object.freeze({
        executable,
        args: Object.freeze([
            '-NoLogo',
            '-NoProfile',
            '-NonInteractive',
            '-EncodedCommand',
            encodedCommand,
        ]),
        env: Object.freeze(copySafeWindowsEnvironment(sourceEnv)),
        timeoutMs: CREDENTIAL_READER_TIMEOUT_MS,
        maxStdoutBytes: MAX_CREDENTIAL_BYTES,
        maxStderrBytes: MAX_DIAGNOSTIC_BYTES,
    });
}

async function runSupabaseCredentialReaderProcess(
    spec: SupabaseCredentialReaderProcessSpec,
): Promise<SupabaseCredentialReaderProcessResult> {
    return await new Promise((resolve, reject) => {
        const stdoutChunks: Buffer[] = [];
        const stderrChunks: Buffer[] = [];
        let stdoutBytes = 0;
        let stderrBytes = 0;
        let settled = false;

        const child = spawn(spec.executable, [...spec.args], {
            env: { ...spec.env },
            shell: false,
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsHide: true,
        });

        const clearChunks = () => {
            for (const chunk of stdoutChunks) chunk.fill(0);
            for (const chunk of stderrChunks) chunk.fill(0);
            stdoutChunks.length = 0;
            stderrChunks.length = 0;
        };
        const fail = (error: SupabaseCliCredentialError) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            clearChunks();
            try {
                child.kill();
            } catch {
                // The process may already have exited. No retry is attempted.
            }
            reject(error);
        };

        const timeout = setTimeout(() => fail(new SupabaseCliCredentialError(
            'credential_reader_timeout',
            'Windows Credential Manager did not answer within the fixed timeout.',
        )), spec.timeoutMs);

        child.stdout.on('data', (chunk: Buffer | string) => {
            const copy = Buffer.isBuffer(chunk) ? Buffer.from(chunk) : Buffer.from(chunk, 'utf8');
            if (Buffer.isBuffer(chunk)) chunk.fill(0);
            if (settled) {
                copy.fill(0);
                return;
            }
            stdoutBytes += copy.length;
            if (stdoutBytes > spec.maxStdoutBytes) {
                copy.fill(0);
                fail(new SupabaseCliCredentialError(
                    'credential_too_large',
                    'Windows Credential Manager returned an unexpectedly large credential.',
                ));
                return;
            }
            stdoutChunks.push(copy);
        });
        child.stderr.on('data', (chunk: Buffer | string) => {
            const copy = Buffer.isBuffer(chunk) ? Buffer.from(chunk) : Buffer.from(chunk, 'utf8');
            if (Buffer.isBuffer(chunk)) chunk.fill(0);
            if (settled) {
                copy.fill(0);
                return;
            }
            stderrBytes += copy.length;
            if (stderrBytes > spec.maxStderrBytes) {
                copy.fill(0);
                fail(new SupabaseCliCredentialError(
                    'credential_reader_failed',
                    'Windows Credential Manager returned excessive diagnostic output.',
                ));
                return;
            }
            stderrChunks.push(copy);
        });
        const childEvents = child as unknown as {
            once(event: 'error', listener: (error: Error) => void): void;
            once(
                event: 'close',
                listener: (exitCode: number | null, signal: NodeJS.Signals | null) => void,
            ): void;
        };
        childEvents.once('error', () => fail(new SupabaseCliCredentialError(
            'credential_reader_unavailable',
            'The local Windows Credential Manager reader could not be started.',
        )));
        childEvents.once('close', (exitCode, signal) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            const stdout = Buffer.concat(stdoutChunks, stdoutBytes);
            const stderr = Buffer.concat(stderrChunks, stderrBytes);
            clearChunks();
            resolve({ exitCode, signal, stdout, stderr });
        });
    });
}

async function readSupabaseCliCredentialBlob(options: {
    readonly env: NodeJS.ProcessEnv;
    readonly runProcess: SupabaseCredentialProcessRunner;
}): Promise<Buffer> {
    const spec = buildSupabaseWindowsCredentialReaderSpec(options.env);
    const result = await options.runProcess(spec);
    if (!result || !Buffer.isBuffer(result.stdout) || !Buffer.isBuffer(result.stderr)) {
        throw new SupabaseCliCredentialError(
            'credential_reader_failed',
            'Windows Credential Manager returned an invalid process result.',
        );
    }

    try {
        if (result.exitCode !== 0
            || result.signal !== null
            || !isEmptyOrBenignPowerShellProgress(result.stderr)) {
            throw new SupabaseCliCredentialError(
                'credential_reader_failed',
                'Windows Credential Manager could not provide the Supabase CLI credential.',
            );
        }
        if (result.stdout.length === 0) {
            throw new SupabaseCliCredentialError(
                'credential_missing',
                'The Supabase CLI credential is missing from Windows Credential Manager.',
            );
        }
        if (result.stdout.length > MAX_CREDENTIAL_BYTES) {
            throw new SupabaseCliCredentialError(
                'credential_too_large',
                'Windows Credential Manager returned an unexpectedly large credential.',
            );
        }

        return Buffer.from(result.stdout);
    } finally {
        result.stdout.fill(0);
        result.stderr.fill(0);
    }
}

function isEmptyOrBenignPowerShellProgress(stderr: Buffer): boolean {
    if (stderr.length === 0) return true;

    // Windows PowerShell 5.1 can serialize its own startup progress stream to
    // stderr as CLIXML even with -NoProfile. It is not an error and contains no
    // output from the credential reader. Accept only a closed CLIXML envelope
    // whose stream labels are exclusively `progress`; every other diagnostic
    // shape remains a hard failure and is discarded without being logged.
    const diagnostic = stderr.toString('utf8').replace(/^\uFEFF/u, '');
    if (!diagnostic.startsWith('#< CLIXML')) return false;
    if (!/<Objs\b[^>]*xmlns="http:\/\/schemas\.microsoft\.com\/powershell\/2004\/04"[^>]*>/u.test(diagnostic)) {
        return false;
    }
    if (!/<\/Objs>\s*$/u.test(diagnostic)) return false;
    if (/<E\b|ErrorRecord|NativeCommandError/iu.test(diagnostic)) return false;

    const streamLabels = [...diagnostic.matchAll(/\bS="([^"]+)"/gu)]
        .map((match) => match[1]);
    return streamLabels.length > 0
        && streamLabels.every((label) => label === 'progress');
}

function decodeAndValidateAccessToken(credentialBlob: Buffer): string {
    const utf16 = looksLikeUtf16LittleEndian(credentialBlob);
    let decoded = credentialBlob.toString(utf16 ? 'utf16le' : 'utf8');
    if (decoded.charCodeAt(0) === 0xfeff) decoded = decoded.slice(1);
    while (decoded.length > 0 && decoded.charCodeAt(decoded.length - 1) === 0) {
        decoded = decoded.slice(0, -1);
    }

    if (!ACCESS_TOKEN_PATTERN.test(decoded)) {
        throw new SupabaseCliCredentialError(
            'credential_invalid',
            'Windows Credential Manager did not contain a valid Supabase CLI access token.',
        );
    }
    return decoded;
}

function looksLikeUtf16LittleEndian(value: Buffer): boolean {
    if (value.length >= 2 && value[0] === 0xff && value[1] === 0xfe) return true;
    if (value.length < 4 || value.length % 2 !== 0) return false;

    let oddNullBytes = 0;
    for (let index = 1; index < value.length; index += 2) {
        if (value[index] === 0) oddNullBytes += 1;
    }
    return oddNullBytes / (value.length / 2) >= 0.8;
}

function copySafeWindowsEnvironment(sourceEnv: NodeJS.ProcessEnv): Record<string, string> {
    const safeEnvironment: Record<string, string> = {};
    for (const key of SAFE_WINDOWS_ENVIRONMENT_KEYS) {
        const value = readEnvironmentValue(sourceEnv, key);
        if (value !== undefined) safeEnvironment[key] = value;
    }
    return safeEnvironment;
}

function readEnvironmentValue(sourceEnv: NodeJS.ProcessEnv, expectedKey: string): string | undefined {
    const actualKey = Object.keys(sourceEnv)
        .find((key) => key.toLocaleLowerCase('en-US') === expectedKey.toLocaleLowerCase('en-US'));
    const value = actualKey === undefined ? undefined : sourceEnv[actualKey];
    return typeof value === 'string' && value.length > 0 ? value : undefined;
}
