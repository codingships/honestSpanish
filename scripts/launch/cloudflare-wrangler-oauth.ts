import { spawnSync } from 'node:child_process';
import { AsyncLocalStorage } from 'node:async_hooks';
import { mkdtempSync, readFileSync, rmdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

export const ESPANOL_HONESTO_CLOUDFLARE_ACCOUNT_ID = 'd1a22bcf6477ff2ff31d2bfb83084e44';
export const ESPANOL_HONESTO_CLOUDFLARE_ZONE_NAME = 'espanolhonesto.com';

const WRANGLER_MAX_BUFFER_BYTES = 1024 * 1024;
const DEFAULT_WRANGLER_TIMEOUT_MS = 30_000;
const CLOUDFLARE_API_ORIGIN = 'https://api.cloudflare.com';
const CLOUDFLARE_API_PREFIX = '/client/v4';
const CLOUDFLARE_CREDENTIAL_ENV_KEY_PATTERN = /^(?:CLOUDFLARE_(?:API_(?:TOKEN|KEY)|AUTH_TOKEN|EMAIL)|CF_(?:API_(?:TOKEN|KEY)|AUTH_TOKEN|EMAIL))$/iu;
const ALLOWED_WRANGLER_WORKERS = new Set([
    'espanolhonesto',
    'espanolhonesto-staging',
    'espanol-honesto-fulfillment-production',
    'espanol-honesto-fulfillment-staging',
]);
const ALLOWED_ACCOUNT_API_WORKERS = new Set([
    ...ALLOWED_WRANGLER_WORKERS,
    'espanolhonesto-staging-staging',
    'espanol-honesto-reminders',
]);
const ALLOWED_WRANGLER_CONFIGS = new Set([
    'wrangler.toml',
    'workers/fulfillment/wrangler.toml',
    'dist/server/wrangler.json',
]);
const ALLOWED_WEB_PRODUCTION_SECRET_NAMES = new Set([
    'PUBLIC_SUPABASE_URL',
    'PUBLIC_SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
    'PUBLIC_STRIPE_PUBLISHABLE_KEY',
    'STRIPE_SECRET_KEY',
    'STRIPE_WEBHOOK_SECRET',
    'STRIPE_EXPECTED_ACCOUNT_ID',
    'STRIPE_PORTAL_CONFIGURATION_ID',
    'PUBLIC_TURNSTILE_SITE_KEY',
    'TURNSTILE_SECRET_KEY',
    'PUBLIC_SENTRY_DSN',
    'FULFILLMENT_WORKER_URL',
    'INTERNAL_JOB_SECRET',
    'CRON_SECRET',
    'LEVEL_CHECK_TOKEN_SECRET',
    'RESEND_API_KEY',
    'EMAIL_FROM',
    'RESEND_FROM_EMAIL',
    'ADMIN_EMAIL',
    'SUPPORT_ALERT_EMAIL',
]);
const ALLOWED_FULFILLMENT_BOOTSTRAP_SECRET_NAMES = new Set([
    'PUBLIC_SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'INTERNAL_JOB_SECRET',
    'GOOGLE_SERVICE_ACCOUNT_EMAIL',
    'GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY',
    'GOOGLE_ADMIN_EMAIL',
    'GOOGLE_DRIVE_ROOT_FOLDER_ID',
    'GOOGLE_TEMPLATE_DOC_ID',
    'RESEND_API_KEY',
    'EMAIL_FROM',
    'RESEND_FROM_EMAIL',
]);
const ALLOWED_PRODUCTION_QUEUE_NAMES = new Set([
    'espanol-honesto-fulfillment-production-queue',
    'espanol-honesto-fulfillment-production-dlq',
]);
const CLOUDFLARE_VERSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const WEB_BOOTSTRAP_DEPLOY_TAG_PATTERN = /^eh-rc-web-bootstrap-[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const FULFILLMENT_BOOTSTRAP_DEPLOY_TAG_PATTERN = /^eh-rc-fulfillment-bootstrap-[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

const SAFE_ENVIRONMENT_PASSTHROUGH = Object.freeze([
    'APPDATA',
    'COMSPEC',
    'HOME',
    'HOMEDRIVE',
    'HOMEPATH',
    'LANG',
    'LC_ALL',
    'LOCALAPPDATA',
    'PATH',
    'Path',
    'PATHEXT',
    'SYSTEMROOT',
    'SystemDrive',
    'SystemRoot',
    'TEMP',
    'TMP',
    'TZ',
    'USERPROFILE',
    'WINDIR',
    'XDG_CONFIG_HOME',
    'XDG_RUNTIME_DIR',
] as const);

export type CloudflareOAuthSessionErrorCode =
    | 'account_not_allowlisted'
    | 'account_resource_not_allowlisted'
    | 'cloudflare_account_request_failed'
    | 'cloudflare_zone_request_failed'
    | 'oauth_consumer_failed'
    | 'oauth_scope_closed'
    | 'wrangler_keyring_unavailable'
    | 'wrangler_account_attestation_failed'
    | 'wrangler_command_not_allowlisted'
    | 'wrangler_env_isolation_failed'
    | 'wrangler_oauth_retrieval_failed'
    | 'zone_attestation_failed'
    | 'zone_resource_not_allowlisted';

export class CloudflareOAuthSessionError extends Error {
    readonly code: CloudflareOAuthSessionErrorCode;

    constructor(code: CloudflareOAuthSessionErrorCode, message: string) {
        super(message);
        this.name = 'CloudflareOAuthSessionError';
        this.code = code;
    }
}

interface WranglerProcessSpec {
    command: string;
    args: readonly string[];
    cwd: string;
    env: NodeJS.ProcessEnv;
    input?: string;
    timeoutMs: number;
}

interface WranglerProcessResult {
    status: number | null;
    signal: NodeJS.Signals | null;
    stdout: string;
    stderr: string;
    error?: unknown;
}

type WranglerProcessInvoker = (spec: WranglerProcessSpec) => WranglerProcessResult;

export interface CloudflareWranglerOAuthTestDependencies {
    cwd: string;
    fetch: typeof globalThis.fetch;
    invokeWrangler: WranglerProcessInvoker;
    sourceEnv: NodeJS.ProcessEnv;
}

export interface CloudflareAccountApi {
    readonly accountId: typeof ESPANOL_HONESTO_CLOUDFLARE_ACCOUNT_ID;
    request(resourcePath: string, init?: RequestInit): Promise<Response>;
}

export interface CloudflareZoneIdentity {
    readonly id: string;
    readonly name: typeof ESPANOL_HONESTO_CLOUDFLARE_ZONE_NAME;
    readonly accountId: typeof ESPANOL_HONESTO_CLOUDFLARE_ACCOUNT_ID;
}

interface CloudflareZoneReadApi {
    discover(): Promise<CloudflareZoneIdentity>;
    request(zoneId: string, resourcePath: string, init?: RequestInit): Promise<Response>;
}

export interface CloudflareWranglerCommandOptions {
    input?: string;
    timeoutMs?: number;
}

export interface CloudflareWranglerCommandResult {
    status: number | null;
    signal: NodeJS.Signals | null;
    stdout: string;
    stderr: string;
    error?: unknown;
}

export interface WithCloudflareOAuthOptions<T> {
    accountId: string;
    consume: (api: CloudflareAccountApi) => T | Promise<T>;
    timeoutMs?: number;
}

interface CloudflareOAuthScope {
    api: CloudflareAccountApi;
    zoneApi: CloudflareZoneReadApi;
    cwd: string;
    env: NodeJS.ProcessEnv;
    envFile: string;
    invokeWrangler: WranglerProcessInvoker;
    timeoutMs: number;
    wranglerCliPath: string;
}

const cloudflareOAuthScope = new AsyncLocalStorage<CloudflareOAuthScope>();

/**
 * Build the deliberately small environment used only to ask Wrangler for its
 * keyring-backed OAuth session. Cloudflare auth variables, endpoint overrides,
 * Node injection flags and Wrangler output-file settings are not inherited.
 * Wrangler's disk logs are disabled because `auth token --json` would
 * otherwise persist the live OAuth credential in a plaintext diagnostic log.
 */
export function buildSanitizedWranglerOAuthEnvironment(
    sourceEnv: NodeJS.ProcessEnv,
    accountId: string,
): NodeJS.ProcessEnv {
    assertAllowlistedCloudflareAccount(accountId);

    const environment: NodeJS.ProcessEnv = {};
    for (const key of SAFE_ENVIRONMENT_PASSTHROUGH) {
        const value = sourceEnv[key];
        if (typeof value === 'string' && value.length > 0) environment[key] = value;
    }

    environment.CLOUDFLARE_ACCOUNT_ID = ESPANOL_HONESTO_CLOUDFLARE_ACCOUNT_ID;
    environment.CLOUDFLARE_AUTH_USE_KEYRING = 'true';
    environment.FORCE_COLOR = '0';
    environment.NO_COLOR = '1';
    environment.WRANGLER_LOG_SANITIZE = 'true';
    environment.WRANGLER_SEND_ERROR_REPORTS = 'false';
    environment.WRANGLER_SEND_METRICS = 'false';
    environment.WRANGLER_WRITE_LOGS = 'false';

    return environment;
}

/**
 * Preserve application/build inputs while ensuring a non-Wrangler child can
 * never inherit legacy Cloudflare credentials. The account ID is non-secret;
 * authentication remains exclusively inside the keyring provider.
 */
export function buildCloudflareCredentialFreeChildEnvironment(
    sourceEnv: NodeJS.ProcessEnv,
    accountId: string,
): NodeJS.ProcessEnv {
    assertAllowlistedCloudflareAccount(accountId);
    const environment: NodeJS.ProcessEnv = {};
    for (const [key, value] of Object.entries(sourceEnv)) {
        if (CLOUDFLARE_CREDENTIAL_ENV_KEY_PATTERN.test(key)) continue;
        if (typeof value === 'string') environment[key] = value;
    }
    environment.CLOUDFLARE_ACCOUNT_ID = ESPANOL_HONESTO_CLOUDFLARE_ACCOUNT_ID;
    return environment;
}

export function assertAllowlistedCloudflareAccount(accountId: string): void {
    if (accountId !== ESPANOL_HONESTO_CLOUDFLARE_ACCOUNT_ID) {
        throw new CloudflareOAuthSessionError(
            'account_not_allowlisted',
            'The requested Cloudflare account is not allowlisted for this project.',
        );
    }
}

export async function requestAllowlistedCloudflareAccount(
    resourcePath: string,
    init?: RequestInit,
): Promise<Response> {
    const scope = cloudflareOAuthScope.getStore();
    if (!scope) {
        throw new CloudflareOAuthSessionError(
            'oauth_scope_closed',
            'No scoped Cloudflare OAuth account capability is active.',
        );
    }
    return await scope.api.request(resourcePath, init);
}

export async function discoverAllowlistedCloudflareZone(): Promise<CloudflareZoneIdentity> {
    const scope = requireCloudflareOAuthScope();
    return await scope.zoneApi.discover();
}

export async function requestAllowlistedCloudflareZoneRead(
    zoneId: string,
    resourcePath: string,
    init?: RequestInit,
): Promise<Response> {
    const scope = requireCloudflareOAuthScope();
    return await scope.zoneApi.request(zoneId, resourcePath, init);
}

export function runCloudflareWranglerFromKeyring(
    args: readonly string[],
    options: CloudflareWranglerCommandOptions = {},
): CloudflareWranglerCommandResult {
    const scope = requireCloudflareOAuthScope();
    validateScopedWranglerArgs(args, scope.cwd);
    const timeoutMs = normalizeWranglerCommandTimeout(options.timeoutMs ?? scope.timeoutMs);
    return invokeSafely(scope.invokeWrangler, {
        command: process.execPath,
        args: [scope.wranglerCliPath, ...args, '--env-file', scope.envFile],
        cwd: scope.cwd,
        env: scope.env,
        input: options.input,
        timeoutMs,
    }, 'wrangler_command_not_allowlisted');
}

/**
 * Supplies an account-confined API capability to the callback. The raw OAuth
 * token is never exposed, written to disk, added to process.env, returned or
 * included in provider errors. The capability is invalidated on callback exit.
 */
export async function withCloudflareWranglerOAuth<T>(
    options: WithCloudflareOAuthOptions<T>,
): Promise<T> {
    return await withCloudflareWranglerOAuthRuntime(options, {
        cwd: path.resolve(process.cwd()),
        fetch: globalThis.fetch.bind(globalThis),
        invokeWrangler: invokeWranglerProcess,
        sourceEnv: process.env,
    });
}

export const cloudflareWranglerOAuthTestOnly = Object.freeze({
    async withDependencies<T>(
        options: WithCloudflareOAuthOptions<T>,
        dependencies: CloudflareWranglerOAuthTestDependencies,
    ): Promise<T> {
        if (process.env.NODE_ENV !== 'test') {
            throw new Error('Cloudflare Wrangler OAuth test dependencies are unavailable outside tests.');
        }
        return await withCloudflareWranglerOAuthRuntime(options, dependencies);
    },
});

async function withCloudflareWranglerOAuthRuntime<T>(
    options: WithCloudflareOAuthOptions<T>,
    dependencies: CloudflareWranglerOAuthTestDependencies,
): Promise<T> {
    assertAllowlistedCloudflareAccount(options.accountId);

    const isolation = createWranglerEnvIsolation();
    try {
        return await runCloudflareWranglerOAuth(options, isolation.envFile, dependencies);
    } finally {
        removeWranglerEnvIsolation(isolation);
    }
}

async function runCloudflareWranglerOAuth<T>(
    options: WithCloudflareOAuthOptions<T>,
    isolatedEnvFile: string,
    dependencies: CloudflareWranglerOAuthTestDependencies,
): Promise<T> {

    const timeoutMs = normalizeOAuthTimeout(options.timeoutMs);
    const cwd = path.resolve(dependencies.cwd);
    const wranglerCliPath = path.join(cwd, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
    const env = buildSanitizedWranglerOAuthEnvironment(
        dependencies.sourceEnv,
        options.accountId,
    );
    const globalIsolationArgs = ['--env-file', isolatedEnvFile] as const;

    const capability = invokeSafely(dependencies.invokeWrangler, {
        command: process.execPath,
        args: [wranglerCliPath, 'login', '--help', ...globalIsolationArgs],
        cwd,
        env,
        timeoutMs,
    }, 'wrangler_keyring_unavailable');
    if (!processSucceeded(capability) || !capability.stdout.includes('--use-keyring')) {
        throw new CloudflareOAuthSessionError(
            'wrangler_keyring_unavailable',
            'Wrangler does not provide the required keyring-backed OAuth capability.',
        );
    }

    const keyring = invokeSafely(dependencies.invokeWrangler, {
        command: process.execPath,
        args: [wranglerCliPath, 'auth', 'keyring', ...globalIsolationArgs],
        cwd,
        env,
        timeoutMs,
    }, 'wrangler_keyring_unavailable');
    if (!processSucceeded(keyring)
        || !isWindowsCredentialManagerKeyring(`${keyring.stdout}\n${keyring.stderr}`)) {
        throw new CloudflareOAuthSessionError(
            'wrangler_keyring_unavailable',
            'Wrangler could not attest encrypted OAuth storage in Windows Credential Manager.',
        );
    }

    const identity = invokeSafely(dependencies.invokeWrangler, {
        command: process.execPath,
        args: [wranglerCliPath, 'whoami', '--json', ...globalIsolationArgs],
        cwd,
        env,
        timeoutMs,
    }, 'wrangler_account_attestation_failed');
    if (!processSucceeded(identity) || !isExpectedOAuthIdentity(identity.stdout, options.accountId)) {
        throw new CloudflareOAuthSessionError(
            'wrangler_account_attestation_failed',
            'Wrangler could not attest the allowlisted Cloudflare OAuth account.',
        );
    }

    const credential = invokeSafely(dependencies.invokeWrangler, {
        command: process.execPath,
        args: [wranglerCliPath, 'auth', 'token', '--json', ...globalIsolationArgs],
        cwd,
        // The captured JSON remains private to this provider and is never
        // returned or logged. Do not set WRANGLER_LOG=none: Wrangler also uses
        // that channel for machine-readable output from several commands.
        env,
        timeoutMs,
    }, 'wrangler_oauth_retrieval_failed');
    if (!processSucceeded(credential)) {
        throw new CloudflareOAuthSessionError(
            'wrangler_oauth_retrieval_failed',
            'Wrangler could not retrieve the keyring-backed OAuth session.',
        );
    }

    let token = parseOAuthToken(credential.stdout);
    let active = true;
    const api: CloudflareAccountApi = Object.freeze({
        accountId: ESPANOL_HONESTO_CLOUDFLARE_ACCOUNT_ID,
        async request(resourcePath: string, init?: RequestInit): Promise<Response> {
            if (!active || !token) {
                throw new CloudflareOAuthSessionError(
                    'oauth_scope_closed',
                    'The scoped Cloudflare OAuth capability is no longer active.',
                );
            }
            return await requestCloudflareAccountWithToken(
                token,
                resourcePath,
                init,
                dependencies.fetch,
            );
        },
    });
    let zoneIdentityPromise: Promise<CloudflareZoneIdentity> | null = null;
    const zoneApi: CloudflareZoneReadApi = Object.freeze({
        async discover(): Promise<CloudflareZoneIdentity> {
            if (!active || !token) {
                throw new CloudflareOAuthSessionError(
                    'oauth_scope_closed',
                    'The scoped Cloudflare OAuth capability is no longer active.',
                );
            }
            zoneIdentityPromise ??= discoverExactCloudflareZone(
                token,
                dependencies.fetch,
            );
            return await zoneIdentityPromise;
        },
        async request(zoneId: string, resourcePath: string, init?: RequestInit): Promise<Response> {
            const identity = await this.discover();
            if (zoneId !== identity.id) {
                throw new CloudflareOAuthSessionError(
                    'zone_resource_not_allowlisted',
                    'The requested Cloudflare zone is not allowlisted for this project.',
                );
            }
            if (!active || !token) {
                throw new CloudflareOAuthSessionError(
                    'oauth_scope_closed',
                    'The scoped Cloudflare OAuth capability is no longer active.',
                );
            }
            return await requestExactCloudflareZoneRead(
                token,
                identity,
                resourcePath,
                init,
                dependencies.fetch,
            );
        },
    });
    const scope: CloudflareOAuthScope = {
        api,
        zoneApi,
        cwd,
        env,
        envFile: isolatedEnvFile,
        invokeWrangler: dependencies.invokeWrangler,
        timeoutMs,
        wranglerCliPath,
    };
    try {
        try {
            return await cloudflareOAuthScope.run(scope, async () => await options.consume(api));
        } catch {
            throw new CloudflareOAuthSessionError(
                'oauth_consumer_failed',
                'The authenticated Cloudflare operation failed; callback details were withheld to protect OAuth material.',
            );
        }
    } finally {
        active = false;
        zoneIdentityPromise = null;
        // JavaScript strings cannot be zeroized, but dropping this reference
        // keeps the credential scoped to this callback and eligible for GC.
        token = '';
    }
}

function requireCloudflareOAuthScope(): CloudflareOAuthScope {
    const scope = cloudflareOAuthScope.getStore();
    if (!scope) {
        throw new CloudflareOAuthSessionError(
            'oauth_scope_closed',
            'No scoped Cloudflare OAuth capability is active.',
        );
    }
    return scope;
}

interface WranglerEnvIsolation {
    directory: string;
    envFile: string;
}

function createWranglerEnvIsolation(): WranglerEnvIsolation {
    try {
        const directory = mkdtempSync(path.join(tmpdir(), 'espanol-honesto-wrangler-auth-'));
        const envFile = path.join(directory, 'empty.env');
        writeFileSync(envFile, '', { encoding: 'utf8', flag: 'wx' });
        return { directory, envFile };
    } catch {
        throw new CloudflareOAuthSessionError(
            'wrangler_env_isolation_failed',
            'Could not create the empty Wrangler environment isolation file.',
        );
    }
}

function removeWranglerEnvIsolation(isolation: WranglerEnvIsolation): void {
    try {
        rmSync(isolation.envFile, { force: true });
        rmdirSync(isolation.directory);
    } catch {
        throw new CloudflareOAuthSessionError(
            'wrangler_env_isolation_failed',
            'Could not remove the empty Wrangler environment isolation file.',
        );
    }
}

function invokeWranglerProcess(spec: WranglerProcessSpec): WranglerProcessResult {
    const result = spawnSync(spec.command, [...spec.args], {
        cwd: spec.cwd,
        encoding: 'utf8',
        env: spec.env,
        input: spec.input,
        maxBuffer: WRANGLER_MAX_BUFFER_BYTES,
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: spec.timeoutMs,
        windowsHide: true,
    });
    return {
        status: result.status,
        signal: result.signal,
        stdout: result.stdout ?? '',
        stderr: result.stderr ?? '',
        error: result.error,
    };
}

function validateScopedWranglerArgs(args: readonly string[], cwd: string): void {
    const invalid = args.length === 0 || args.some((arg) => (
        !arg
        || arg === '--'
        || containsAsciiControlCharacter(arg)
        || arg.startsWith('--account=')
        || arg.startsWith('--account-id=')
        || arg.startsWith('--config=')
        || arg.startsWith('--cwd=')
        || arg.startsWith('--env=')
        || arg.startsWith('--env-file=')
        || arg.startsWith('--profile=')
    ));
    const commandArgs = args.at(-1) === '--install-skills=false'
        ? args.slice(0, -1)
        : [...args];
    if (invalid || !isAllowlistedWranglerCommand(commandArgs)) {
        throw new CloudflareOAuthSessionError(
            'wrangler_command_not_allowlisted',
            'The Wrangler command is outside the scoped keyring command boundary.',
        );
    }
    assertWranglerConfigAccountConfinement(commandArgs, cwd);
}

function isAllowlistedWranglerCommand(args: readonly string[]): boolean {
    if (argsEqual(args, ['--version']) || argsEqual(args, ['whoami', '--json'])) return true;
    if (argsEqual(args, ['pages', 'project', 'list', '--json'])) return true;
    if (args.length === 8
        && args[0] === 'pages'
        && args[1] === 'deployment'
        && args[2] === 'list'
        && args[3] === '--project-name'
        && args[4] === 'espanolhonesto'
        && args[5] === '--environment'
        && (args[6] === 'production' || args[6] === 'preview')
        && args[7] === '--json') return true;
    if (args.length === 5
        && args[0] === 'deployments'
        && (args[1] === 'list' || args[1] === 'status')
        && args[2] === '--name'
        && ALLOWED_WRANGLER_WORKERS.has(args[3] ?? '')
        && args[4] === '--json') return true;
    if (isAllowlistedVersionView(args)) return true;
    if (isAllowlistedSecretCommand(args)) return true;
    if (isAllowlistedDeployCommand(args)) return true;
    if (isAllowlistedQueueCommand(args)) return true;
    return isAllowlistedStagingRollback(args);
}

function isAllowlistedVersionView(args: readonly string[]): boolean {
    return args.length === 6
        && args[0] === 'versions'
        && args[1] === 'view'
        && CLOUDFLARE_VERSION_ID_PATTERN.test(args[2] ?? '')
        && args[3] === '--name'
        && ALLOWED_WRANGLER_WORKERS.has(args[4] ?? '')
        && args[5] === '--json';
}

function isAllowlistedSecretCommand(args: readonly string[]): boolean {
    if (args.length === 6
        && args[0] === 'secret'
        && args[1] === 'list'
        && args[2] === '--name'
        && ALLOWED_WRANGLER_WORKERS.has(args[3] ?? '')
        && args[4] === '--format'
        && args[5] === 'json') return true;

    if (args.length === 8
        && args[0] === 'secret'
        && args[1] === 'list'
        && args[2] === '--config'
        && isAllowedConfigEnvironment(args[3] ?? '', args[5] ?? '')
        && args[4] === '--env'
        && args[6] === '--format'
        && args[7] === 'json') return true;

    return args.length === 7
        && args[0] === 'secret'
        && args[1] === 'put'
        && isAllowedSecretTarget(args[2] ?? '', args[4] ?? '', args[6] ?? '')
        && args[3] === '--config'
        && isAllowedConfigEnvironment(args[4] ?? '', args[6] ?? '')
        && args[5] === '--env';
}

function isAllowlistedDeployCommand(args: readonly string[]): boolean {
    if (args[0] !== 'deploy' || args[1] !== '--config') return false;
    const config = args[2] ?? '';
    let suffix: readonly string[];
    if (config === 'dist/server/wrangler.json') {
        suffix = args.slice(3);
    } else if (config === 'workers/fulfillment/wrangler.toml'
        && args[3] === '--env'
        && (args[4] === 'production_bootstrap' || args[4] === 'production')) {
        suffix = args.slice(5);
    } else {
        return false;
    }
    if (argsEqual(suffix, ['--dry-run']) || argsEqual(suffix, ['--keep-vars'])) return true;
    return suffix.length === 3
        && suffix[0] === '--keep-vars'
        && suffix[1] === '--tag'
        && isAllowedDeployTag(config, args[4] ?? '', suffix[2] ?? '');
}

function isAllowlistedQueueCommand(args: readonly string[]): boolean {
    if (args.length === 4
        && args[0] === 'queues'
        && args[1] === 'list'
        && args[2] === '--page') {
        const page = Number(args[3]);
        return Number.isSafeInteger(page) && page >= 1 && page <= 500 && String(page) === args[3];
    }
    if (args.length === 3
        && args[0] === 'queues'
        && args[1] === 'info'
        && ALLOWED_PRODUCTION_QUEUE_NAMES.has(args[2] ?? '')) return true;
    return args.length === 3
        && args[0] === 'queues'
        && args[1] === 'create'
        && ALLOWED_PRODUCTION_QUEUE_NAMES.has(args[2] ?? '');
}

function isAllowlistedStagingRollback(args: readonly string[]): boolean {
    return args.length === 9
        && args[0] === 'rollback'
        && CLOUDFLARE_VERSION_ID_PATTERN.test(args[1] ?? '')
        && args[2] === '--name'
        && args[3] === 'espanol-honesto-fulfillment-staging'
        && args[4] === '--yes'
        && args[5] === '--config'
        && args[6] === 'workers/fulfillment/wrangler.toml'
        && args[7] === '--env'
        && args[8] === 'staging';
}

function isAllowedConfigEnvironment(config: string, environment: string): boolean {
    return (config === 'wrangler.toml'
        && (environment === 'production_bootstrap' || environment === 'production'))
        || (config === 'workers/fulfillment/wrangler.toml'
            && (environment === 'production_bootstrap' || environment === 'production'));
}

function isAllowedSecretTarget(name: string, config: string, environment: string): boolean {
    if (config === 'wrangler.toml' && environment === 'production_bootstrap') {
        return name === 'INTERNAL_JOB_SECRET';
    }
    if (config === 'wrangler.toml' && environment === 'production') {
        return ALLOWED_WEB_PRODUCTION_SECRET_NAMES.has(name);
    }
    return config === 'workers/fulfillment/wrangler.toml'
        && environment === 'production_bootstrap'
        && ALLOWED_FULFILLMENT_BOOTSTRAP_SECRET_NAMES.has(name);
}

function isAllowedDeployTag(config: string, environment: string, tag: string): boolean {
    if (config === 'dist/server/wrangler.json') {
        return WEB_BOOTSTRAP_DEPLOY_TAG_PATTERN.test(tag);
    }
    return config === 'workers/fulfillment/wrangler.toml'
        && environment === 'production_bootstrap'
        && FULFILLMENT_BOOTSTRAP_DEPLOY_TAG_PATTERN.test(tag);
}

function assertWranglerConfigAccountConfinement(args: readonly string[], cwd: string): void {
    const configIndex = args.indexOf('--config');
    if (configIndex < 0) return;
    const config = args[configIndex + 1] ?? '';
    if (!ALLOWED_WRANGLER_CONFIGS.has(config)) throwWranglerCommandNotAllowlisted();
    const expectedPath = path.resolve(cwd, config);
    let source: string;
    try {
        source = readFileSync(expectedPath, 'utf8');
    } catch {
        throwWranglerCommandNotAllowlisted();
    }

    const accountIds = [...source.matchAll(/^\s*account_id\s*=\s*["']([^"']+)["']/gmu)]
        .map((match) => match[1]);
    if (accountIds.some((accountId) => accountId !== ESPANOL_HONESTO_CLOUDFLARE_ACCOUNT_ID)) {
        throwWranglerCommandNotAllowlisted();
    }
    if (config === 'dist/server/wrangler.json') {
        try {
            const value = JSON.parse(source) as unknown;
            if (!isRecord(value)
                || value.name !== 'espanolhonesto'
                || (typeof value.account_id === 'string'
                    && value.account_id !== ESPANOL_HONESTO_CLOUDFLARE_ACCOUNT_ID)) {
                throwWranglerCommandNotAllowlisted();
            }
        } catch (error) {
            if (error instanceof CloudflareOAuthSessionError) throw error;
            throwWranglerCommandNotAllowlisted();
        }
    }
}

function argsEqual(actual: readonly string[], expected: readonly string[]): boolean {
    return actual.length === expected.length
        && actual.every((value, index) => value === expected[index]);
}

function throwWranglerCommandNotAllowlisted(): never {
    throw new CloudflareOAuthSessionError(
        'wrangler_command_not_allowlisted',
        'The Wrangler command or configuration is outside the scoped keyring boundary.',
    );
}

function invokeSafely(
    invoke: WranglerProcessInvoker,
    spec: WranglerProcessSpec,
    code: CloudflareOAuthSessionErrorCode,
): WranglerProcessResult {
    try {
        return invoke(spec);
    } catch {
        throw new CloudflareOAuthSessionError(
            code,
            'Wrangler authentication failed without exposing command output.',
        );
    }
}

function processSucceeded(result: WranglerProcessResult): boolean {
    return result.error === undefined && result.status === 0 && result.signal === null;
}

function isWindowsCredentialManagerKeyring(output: string): boolean {
    return output.includes('Keyring storage is enabled')
        && output.includes('Credentials are currently stored in: Encrypted file')
        && output.includes('with key in Windows Credential Manager');
}

async function requestCloudflareAccountWithToken(
    token: string,
    resourcePath: string,
    init: RequestInit | undefined,
    fetchImplementation: typeof globalThis.fetch,
): Promise<Response> {
    const url = allowlistedAccountUrl(resourcePath);
    assertAllowlistedCloudflareAccountRequest(url, init);
    const headers = new Headers(init?.headers);
    for (const forbiddenHeader of ['authorization', 'x-auth-email', 'x-auth-key']) {
        if (headers.has(forbiddenHeader)) {
            throw new CloudflareOAuthSessionError(
                'account_resource_not_allowlisted',
                'Caller-supplied Cloudflare authentication headers are forbidden.',
            );
        }
    }
    headers.set('Authorization', `Bearer ${token}`);
    if (!headers.has('Accept')) headers.set('Accept', 'application/json');

    try {
        return await fetchImplementation(url, {
            ...init,
            credentials: 'omit',
            headers,
            redirect: 'error',
        });
    } catch (error) {
        if (error instanceof CloudflareOAuthSessionError) throw error;
        throw new CloudflareOAuthSessionError(
            'cloudflare_account_request_failed',
            'The allowlisted Cloudflare account request failed without exposing OAuth material.',
        );
    }
}

function assertAllowlistedCloudflareAccountRequest(url: URL, init: RequestInit | undefined): void {
    const accountPrefix = `${CLOUDFLARE_API_PREFIX}/accounts/${ESPANOL_HONESTO_CLOUDFLARE_ACCOUNT_ID}`;
    const resource = `${url.pathname.slice(accountPrefix.length)}${url.search}`;
    const method = (init?.method ?? 'GET').toUpperCase();
    if (method === 'GET' && init?.body === undefined && isAllowlistedCloudflareAccountGet(resource)) {
        return;
    }
    if (method === 'DELETE'
        && init?.body === undefined
        && resource === '/workers/scripts/espanol-honesto-fulfillment-production/secrets/INTERNAL_JOB_SECRET') {
        return;
    }
    const body = parseJsonRequestBody(init?.body);
    if (method === 'PATCH' && isAllowlistedStagingQueuePatch(resource, body)) return;
    if (method === 'PUT' && isAllowlistedStagingSchedulePut(resource, body)) return;
    if (method === 'PUT' && isAllowlistedTurnstileWidgetPut(resource, body)) return;
    throw new CloudflareOAuthSessionError(
        'account_resource_not_allowlisted',
        'The Cloudflare account request is outside the exact method, resource and payload allowlist.',
    );
}

function isAllowlistedCloudflareAccountGet(resource: string): boolean {
    if (resource === '/workers/scripts' || resource === '/challenges/widgets') return true;
    if (/^\/queues\?page=(?:[1-9]|[1-9]\d|[1-4]\d{2}|500)&per_page=100$/u.test(resource)) {
        return true;
    }
    if (/^\/queues\/[0-9a-f]{32}(?:\/metrics|\/consumers)?$/iu.test(resource)) return true;
    if (/^\/challenges\/widgets\/[0-9A-Za-z_-]{20,128}$/u.test(resource)) return true;

    for (const worker of ALLOWED_ACCOUNT_API_WORKERS) {
        const workerPrefix = `/workers/scripts/${worker}`;
        if (resource === `${workerPrefix}/settings`
            || resource === `${workerPrefix}/schedules`
            || resource === `${workerPrefix}/subdomain`
            || resource === `/workers/domains?service=${worker}`) {
            return true;
        }
    }

    const fulfillmentPrefix = '/workers/scripts/espanol-honesto-fulfillment-production';
    if (resource === `${fulfillmentPrefix}/deployments`
        || resource === `${fulfillmentPrefix}/secrets`) return true;
    return new RegExp(`^${fulfillmentPrefix}/versions/[0-9a-f-]{36}$`, 'iu').test(resource)
        && CLOUDFLARE_VERSION_ID_PATTERN.test(resource.slice(resource.lastIndexOf('/') + 1));
}

function isAllowlistedStagingQueuePatch(resource: string, body: unknown): boolean {
    if (!/^\/queues\/[0-9a-f]{32}$/iu.test(resource) || !hasExactKeys(body, ['queue_name', 'settings'])) {
        return false;
    }
    const settings = body.settings;
    return body.queue_name === 'espanol-honesto-fulfillment-staging-queue'
        && hasExactKeys(settings, ['delivery_paused'])
        && typeof settings.delivery_paused === 'boolean';
}

function isAllowlistedStagingSchedulePut(resource: string, body: unknown): boolean {
    if (resource !== '/workers/scripts/espanol-honesto-fulfillment-staging/schedules'
        || !Array.isArray(body)) return false;
    if (body.length === 0) return true;
    return body.length === 1
        && hasExactKeys(body[0], ['cron'])
        && body[0].cron === '0 * * * *';
}

function isAllowlistedTurnstileWidgetPut(resource: string, body: unknown): boolean {
    if (!/^\/challenges\/widgets\/[0-9A-Za-z_-]{20,128}$/u.test(resource)
        || !hasExactKeys(body, ['clearance_level', 'domains', 'mode', 'name'])) return false;
    if (typeof body.name !== 'string' || body.name.length < 1 || body.name.length > 128
        || typeof body.mode !== 'string' || body.mode.length < 1 || body.mode.length > 64
        || typeof body.clearance_level !== 'string'
        || body.clearance_level.length < 1
        || body.clearance_level.length > 64
        || !Array.isArray(body.domains)) return false;
    const expectedDomains = new Set([
        'espanolhonesto.com',
        'www.espanolhonesto.com',
        'staging.espanolhonesto.com',
    ]);
    return body.domains.length === expectedDomains.size
        && new Set(body.domains).size === expectedDomains.size
        && body.domains.every((domain) => typeof domain === 'string' && expectedDomains.has(domain));
}

function parseJsonRequestBody(body: BodyInit | null | undefined): unknown {
    if (typeof body !== 'string') return null;
    try {
        return JSON.parse(body) as unknown;
    } catch {
        return null;
    }
}

function hasExactKeys(value: unknown, expectedKeys: readonly string[]): value is Record<string, unknown> {
    if (!isRecord(value)) return false;
    const actualKeys = Object.keys(value).sort();
    const expected = [...expectedKeys].sort();
    return actualKeys.length === expected.length
        && actualKeys.every((key, index) => key === expected[index]);
}

async function discoverExactCloudflareZone(
    token: string,
    fetchImplementation: typeof globalThis.fetch,
): Promise<CloudflareZoneIdentity> {
    const url = new URL(`${CLOUDFLARE_API_PREFIX}/zones`, CLOUDFLARE_API_ORIGIN);
    url.searchParams.set('name', ESPANOL_HONESTO_CLOUDFLARE_ZONE_NAME);
    url.searchParams.set('account.id', ESPANOL_HONESTO_CLOUDFLARE_ACCOUNT_ID);
    url.searchParams.set('match', 'all');
    url.searchParams.set('per_page', '50');

    const response = await cloudflareOAuthFetch(
        token,
        url,
        { method: 'GET' },
        fetchImplementation,
        'cloudflare_zone_request_failed',
    );
    let envelope: unknown;
    try {
        envelope = await response.json();
    } catch {
        throw new CloudflareOAuthSessionError(
            'zone_attestation_failed',
            'Cloudflare did not return a valid response for the exact zone attestation.',
        );
    }
    if (!response.ok || !isRecord(envelope) || envelope.success !== true || !Array.isArray(envelope.result)) {
        throw new CloudflareOAuthSessionError(
            'zone_attestation_failed',
            'Cloudflare could not attest the exact allowlisted zone.',
        );
    }
    const matches = envelope.result.filter((entry): entry is Record<string, unknown> => {
        if (!isRecord(entry) || entry.name !== ESPANOL_HONESTO_CLOUDFLARE_ZONE_NAME) return false;
        const account = entry.account;
        return isRecord(account) && account.id === ESPANOL_HONESTO_CLOUDFLARE_ACCOUNT_ID;
    });
    if (matches.length !== 1 || envelope.result.length !== 1) {
        throw new CloudflareOAuthSessionError(
            'zone_attestation_failed',
            'Cloudflare did not return one unique exact allowlisted zone.',
        );
    }
    const zoneId = matches[0]?.id;
    if (typeof zoneId !== 'string' || !/^[0-9a-f]{32}$/iu.test(zoneId)) {
        throw new CloudflareOAuthSessionError(
            'zone_attestation_failed',
            'Cloudflare returned an invalid identifier for the allowlisted zone.',
        );
    }
    return Object.freeze({
        id: zoneId,
        name: ESPANOL_HONESTO_CLOUDFLARE_ZONE_NAME,
        accountId: ESPANOL_HONESTO_CLOUDFLARE_ACCOUNT_ID,
    });
}

async function requestExactCloudflareZoneRead(
    token: string,
    identity: CloudflareZoneIdentity,
    resourcePath: string,
    init: RequestInit | undefined,
    fetchImplementation: typeof globalThis.fetch,
): Promise<Response> {
    const method = (init?.method ?? 'GET').toUpperCase();
    if (method !== 'GET' || init?.body !== undefined) {
        throw new CloudflareOAuthSessionError(
            'zone_resource_not_allowlisted',
            'The allowlisted Cloudflare zone capability is read-only.',
        );
    }
    if (!isAllowlistedExactZoneReadPath(resourcePath)) {
        throw new CloudflareOAuthSessionError(
            'zone_resource_not_allowlisted',
            'The requested Cloudflare zone resource is not allowlisted.',
        );
    }
    const url = new URL(
        `${CLOUDFLARE_API_PREFIX}/zones/${identity.id}${resourcePath}`,
        CLOUDFLARE_API_ORIGIN,
    );
    return await cloudflareOAuthFetch(
        token,
        url,
        { ...init, method: 'GET' },
        fetchImplementation,
        'cloudflare_zone_request_failed',
    );
}

function isAllowlistedExactZoneReadPath(resourcePath: string): boolean {
    if (
        !resourcePath.startsWith('/')
        || resourcePath.startsWith('//')
        || resourcePath.includes('\\')
        || resourcePath.includes('#')
        || containsAsciiControlCharacter(resourcePath)
        || /%(?:2e|2f|5c)/iu.test(resourcePath)
    ) return false;
    if (resourcePath === '/workers/routes') return true;
    if (resourcePath === '/email/routing/rules/catch_all') return true;
    return /^\/email\/routing\/rules\?page=\d+&per_page=50$/u.test(resourcePath);
}

async function cloudflareOAuthFetch(
    token: string,
    url: URL,
    init: RequestInit,
    fetchImplementation: typeof globalThis.fetch,
    errorCode: 'cloudflare_account_request_failed' | 'cloudflare_zone_request_failed',
): Promise<Response> {
    const headers = new Headers(init.headers);
    for (const forbiddenHeader of ['authorization', 'x-auth-email', 'x-auth-key']) {
        if (headers.has(forbiddenHeader)) {
            throw new CloudflareOAuthSessionError(
                errorCode === 'cloudflare_zone_request_failed'
                    ? 'zone_resource_not_allowlisted'
                    : 'account_resource_not_allowlisted',
                'Caller-supplied Cloudflare authentication headers are forbidden.',
            );
        }
    }
    headers.set('Authorization', `Bearer ${token}`);
    if (!headers.has('Accept')) headers.set('Accept', 'application/json');
    try {
        return await fetchImplementation(url, {
            ...init,
            credentials: 'omit',
            headers,
            redirect: 'error',
        });
    } catch (error) {
        if (error instanceof CloudflareOAuthSessionError) throw error;
        throw new CloudflareOAuthSessionError(
            errorCode,
            'The allowlisted Cloudflare request failed without exposing OAuth material.',
        );
    }
}

function allowlistedAccountUrl(resourcePath: string): URL {
    if (
        !resourcePath.startsWith('/')
        || resourcePath.startsWith('//')
        || resourcePath.includes('\\')
        || containsAsciiControlCharacter(resourcePath)
    ) {
        throw new CloudflareOAuthSessionError(
            'account_resource_not_allowlisted',
            'Cloudflare resource paths must be account-relative absolute paths.',
        );
    }

    const rawPathname = resourcePath.split(/[?#]/u, 1)[0];
    if (/%(?:2e|2f|5c)/iu.test(rawPathname)) {
        throw new CloudflareOAuthSessionError(
            'account_resource_not_allowlisted',
            'Encoded path separators and dot segments are forbidden in Cloudflare resource paths.',
        );
    }

    const accountResourcePrefix = `/accounts/${ESPANOL_HONESTO_CLOUDFLARE_ACCOUNT_ID}`;
    let accountRelativePath = resourcePath;
    if (resourcePath === accountResourcePrefix) {
        accountRelativePath = '/';
    } else if (resourcePath.startsWith(`${accountResourcePrefix}/`)) {
        accountRelativePath = resourcePath.slice(accountResourcePrefix.length);
    } else if (resourcePath.startsWith('/accounts/')) {
        throw new CloudflareOAuthSessionError(
            'account_resource_not_allowlisted',
            'The Cloudflare resource is outside the allowlisted account boundary.',
        );
    }

    const accountPrefix = `${CLOUDFLARE_API_PREFIX}${accountResourcePrefix}`;
    const url = new URL(`${accountPrefix}${accountRelativePath}`, CLOUDFLARE_API_ORIGIN);
    if (
        url.origin !== CLOUDFLARE_API_ORIGIN
        || url.hash.length > 0
        || (url.pathname !== accountPrefix && !url.pathname.startsWith(`${accountPrefix}/`))
    ) {
        throw new CloudflareOAuthSessionError(
            'account_resource_not_allowlisted',
            'The Cloudflare resource is outside the allowlisted account boundary.',
        );
    }
    return url;
}

function isExpectedOAuthIdentity(output: string, accountId: string): boolean {
    const value = parseJsonRecord(output);
    if (!value) return false;
    if (value.loggedIn !== true || value.authType !== 'OAuth Token' || !Array.isArray(value.accounts)) {
        return false;
    }
    return value.accounts.some((account) => (
        isRecord(account) && account.id === accountId
    ));
}

function parseOAuthToken(output: string): string {
    const value = parseJsonRecord(output);
    const token = value?.token;
    if (
        value?.type !== 'oauth'
        || typeof token !== 'string'
        || token.length < 16
        || token.length > 16_384
        || token !== token.trim()
        || containsAsciiControlCharacter(token)
    ) {
        throw new CloudflareOAuthSessionError(
            'wrangler_oauth_retrieval_failed',
            'Wrangler did not return a valid OAuth credential.',
        );
    }
    return token;
}

function containsAsciiControlCharacter(value: string): boolean {
    return Array.from(value).some((character) => {
        const codePoint = character.codePointAt(0) ?? 0;
        return codePoint < 32 || codePoint === 127;
    });
}

function parseJsonRecord(output: string): Record<string, unknown> | null {
    try {
        const value: unknown = JSON.parse(output.trim());
        return isRecord(value) ? value : null;
    } catch {
        return null;
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeOAuthTimeout(value: number | undefined): number {
    if (value === undefined) return DEFAULT_WRANGLER_TIMEOUT_MS;
    if (!Number.isSafeInteger(value) || value < 1_000 || value > 60_000) {
        throw new TypeError('Wrangler OAuth timeout must be an integer between 1000 and 60000 milliseconds.');
    }
    return value;
}

function normalizeWranglerCommandTimeout(value: number): number {
    if (!Number.isSafeInteger(value) || value < 1_000 || value > 300_000) {
        throw new TypeError('Scoped Wrangler command timeout must be an integer between 1000 and 300000 milliseconds.');
    }
    return value;
}
