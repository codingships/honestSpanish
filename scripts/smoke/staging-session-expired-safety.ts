import path from 'node:path';

export const STAGING_SESSION_EXPIRED_CONFIRMATION = [
    'writes-ok',
    'staging-session-expired',
    'codingships/honestSpanish',
    'mzjyvmlxfpzdfdjzxxyj',
    'acct_1TruqOC22M3erP0j',
    'd1a22bcf6477ff2ff31d2bfb83084e44',
].join(':');

export const STAGING_SESSION_EXPIRED_IDENTITY = Object.freeze({
    cloudflareAccountId: 'd1a22bcf6477ff2ff31d2bfb83084e44',
    repository: 'codingships/honestSpanish',
    repositoryRemote: 'https://github.com/codingships/honestSpanish.git',
    stripeAccountId: 'acct_1TruqOC22M3erP0j',
    supabaseProjectRef: 'mzjyvmlxfpzdfdjzxxyj',
    webOrigin: 'https://staging.espanolhonesto.com',
    webWorker: 'espanolhonesto-staging',
});

export type StagingSessionExpiredArgs = {
    confirmation?: string;
    envFile: string;
    mode: 'execute' | 'preflight';
};

export type StagingSessionExpiredGate = {
    envFile: string;
    identity: typeof STAGING_SESSION_EXPIRED_IDENTITY;
    mode: StagingSessionExpiredArgs['mode'];
};

function optionValue(argv: string[], index: number, option: string): string {
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${option} requires a value`);
    return value;
}

export function parseStagingSessionExpiredArgs(argv: string[]): StagingSessionExpiredArgs {
    const args: StagingSessionExpiredArgs = {
        envFile: '.env.staging',
        mode: 'preflight',
    };
    let selectedMode: StagingSessionExpiredArgs['mode'] | null = null;

    for (let index = 0; index < argv.length; index += 1) {
        const option = argv[index];
        if (option === '--execute') {
            if (selectedMode) throw new Error('Choose exactly one runner mode');
            selectedMode = 'execute';
            args.mode = 'execute';
        } else if (option === '--preflight' || option === '--dry-run') {
            if (selectedMode) throw new Error('Choose exactly one runner mode');
            selectedMode = 'preflight';
            args.mode = 'preflight';
        } else if (option === '--confirmation') {
            if (args.confirmation !== undefined) throw new Error('--confirmation was provided more than once');
            args.confirmation = optionValue(argv, index++, option);
        } else if (option === '--env-file') {
            args.envFile = optionValue(argv, index++, option);
        } else {
            throw new Error('Unknown option; production, live, DNS and arbitrary targets are forbidden');
        }
    }

    if (args.mode === 'execute' && args.confirmation !== STAGING_SESSION_EXPIRED_CONFIRMATION) {
        throw new Error(`--execute requires --confirmation=${STAGING_SESSION_EXPIRED_CONFIRMATION}`);
    }
    if (args.mode === 'preflight' && args.confirmation !== undefined) {
        throw new Error('--confirmation is valid only with --execute');
    }
    return args;
}

function requireValue(env: Record<string, string | undefined>, key: string): string {
    const value = env[key]?.trim();
    if (!value) throw new Error(`Staging session-expired requires ${key}`);
    return value;
}

function requireExactValue(
    env: Record<string, string | undefined>,
    key: string,
    expected: string,
): void {
    const value = requireValue(env, key);
    if (value !== expected) throw new Error(`${key} must be exactly ${expected}`);
}

export function validateStagingSessionExpiredGate(input: {
    args: StagingSessionExpiredArgs;
    env: Record<string, string | undefined>;
    repositoryRemote: string;
    resolvedEnvFile: string;
    webConfig: string;
    workspaceRoot: string;
}): StagingSessionExpiredGate {
    if (input.repositoryRemote.trim() !== STAGING_SESSION_EXPIRED_IDENTITY.repositoryRemote) {
        throw new Error('Repository remote must be codingships/honestSpanish');
    }

    const envFile = path.resolve(input.resolvedEnvFile);
    if (path.basename(envFile) !== '.env.staging') {
        throw new Error('Session-expired smoke must load .env.staging');
    }

    requireExactValue(input.env, 'PUBLIC_APP_ENV', 'staging');
    requireExactValue(input.env, 'SUPABASE_EXPECTED_PROJECT_REF', STAGING_SESSION_EXPIRED_IDENTITY.supabaseProjectRef);
    requireExactValue(input.env, 'STRIPE_EXPECTED_ACCOUNT_ID', STAGING_SESSION_EXPIRED_IDENTITY.stripeAccountId);
    requireExactValue(input.env, 'PUBLIC_SITE_URL', STAGING_SESSION_EXPIRED_IDENTITY.webOrigin);
    requireExactValue(
        input.env,
        'PUBLIC_SUPABASE_URL',
        `https://${STAGING_SESSION_EXPIRED_IDENTITY.supabaseProjectRef}.supabase.co`,
    );

    for (const key of [
        'PUBLIC_SUPABASE_ANON_KEY',
        'SUPABASE_SERVICE_ROLE_KEY',
        'TEST_ADMIN_EMAIL',
        'TEST_ADMIN_PASSWORD',
        'TEST_TEACHER_EMAIL',
        'TEST_TEACHER_PASSWORD',
    ]) {
        requireValue(input.env, key);
    }

    if (!input.webConfig.includes(`name = "${STAGING_SESSION_EXPIRED_IDENTITY.webWorker}"`)) {
        throw new Error('Web Worker config must target espanolhonesto-staging');
    }

    return {
        envFile,
        identity: STAGING_SESSION_EXPIRED_IDENTITY,
        mode: input.args.mode,
    };
}

export function safeStagingSessionExpiredSummary(gate: StagingSessionExpiredGate): string[] {
    const identity = gate.identity;
    return [
        `mode=${gate.mode}`,
        'capability=a01-session-expired',
        `repository=${identity.repository}`,
        `supabase_project_ref=${identity.supabaseProjectRef}`,
        `stripe_account=${identity.stripeAccountId}`,
        `cloudflare_account=${identity.cloudflareAccountId}`,
        `workers=${identity.webWorker}`,
        'production=false',
        'stripe_live=false',
        'dns_writes=false',
        gate.mode === 'preflight'
            ? 'external_writes=none'
            : 'external_writes=staging-auth-session',
    ];
}
