import path from 'node:path';

export const STAGING_SENTRY_SYNTHETIC_CONFIRMATION = [
    'writes-ok',
    'staging-sentry-synthetic',
    'codingships/honestSpanish',
    'mzjyvmlxfpzdfdjzxxyj',
    'acct_1TruqOC22M3erP0j',
    'd1a22bcf6477ff2ff31d2bfb83084e44',
].join(':');

export const STAGING_SENTRY_SYNTHETIC_IDENTITY = Object.freeze({
    cloudflareAccountId: 'd1a22bcf6477ff2ff31d2bfb83084e44',
    repository: 'codingships/honestSpanish',
    repositoryRemote: 'https://github.com/codingships/honestSpanish.git',
    sentryDsnHost: 'o4510912289701888.ingest.de.sentry.io',
    sentryOrg: 'honestspanish',
    sentryProject: 'espanol-honesto-astro',
    sentryProjectId: '4510917714444368',
    sentryRegionUrl: 'https://de.sentry.io',
    stripeAccountId: 'acct_1TruqOC22M3erP0j',
    supabaseProjectRef: 'mzjyvmlxfpzdfdjzxxyj',
    webOrigin: 'https://staging.espanolhonesto.com',
    webWorker: 'espanolhonesto-staging',
});

/** Deliberate privacy bait planted before scrubbing. Must never leave the runner. */
export const STAGING_SENTRY_SYNTHETIC_DECOYS = Object.freeze({
    authorization: 'Bearer decoy-auth-token-never-send',
    cookie: 'session=decoy-cookie-value-never-send',
    email: 'decoy+sentry-synthetic@example.invalid',
    password: 'decoy-password-never-send',
    query: 'email=decoy%2Bsentry-synthetic%40example.invalid&token=decoy-secret-token',
    rawMessage: 'Raw failure for decoy+sentry-synthetic@example.invalid with secret=decoy-secret-token',
});

export type StagingSentrySyntheticArgs = {
    confirmation?: string;
    envFile: string;
    mode: 'execute' | 'preflight';
};

export type StagingSentrySyntheticGate = {
    envFile: string;
    identity: typeof STAGING_SENTRY_SYNTHETIC_IDENTITY;
    mode: StagingSentrySyntheticArgs['mode'];
    sentryDsn: string;
    sentryPublicKey: string;
};

function optionValue(argv: string[], index: number, option: string): string {
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${option} requires a value`);
    return value;
}

export function parseStagingSentrySyntheticArgs(argv: string[]): StagingSentrySyntheticArgs {
    const args: StagingSentrySyntheticArgs = {
        envFile: '.env.staging',
        mode: 'preflight',
    };
    let selectedMode: StagingSentrySyntheticArgs['mode'] | null = null;

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

    if (args.mode === 'execute' && args.confirmation !== STAGING_SENTRY_SYNTHETIC_CONFIRMATION) {
        throw new Error(`--execute requires --confirmation=${STAGING_SENTRY_SYNTHETIC_CONFIRMATION}`);
    }
    if (args.mode === 'preflight' && args.confirmation !== undefined) {
        throw new Error('--confirmation is valid only with --execute');
    }
    return args;
}

function requireValue(env: Record<string, string | undefined>, key: string): string {
    const value = env[key]?.trim();
    if (!value) throw new Error(`Staging Sentry synthetic requires ${key}`);
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

export function parseApprovedStagingSentryDsn(value: string): {
    dsn: string;
    publicKey: string;
} {
    let parsed: URL;
    try {
        parsed = new URL(value.trim());
    } catch {
        throw new Error('PUBLIC_SENTRY_DSN must be a valid HTTPS URL');
    }

    const identity = STAGING_SENTRY_SYNTHETIC_IDENTITY;
    if (
        parsed.protocol !== 'https:'
        || !parsed.username
        || parsed.password
        || parsed.hostname !== identity.sentryDsnHost
        || parsed.pathname !== `/${identity.sentryProjectId}`
        || parsed.port
        || parsed.search
        || parsed.hash
    ) {
        throw new Error('PUBLIC_SENTRY_DSN must target honestspanish/espanol-honesto-astro');
    }

    return {
        dsn: parsed.toString(),
        publicKey: decodeURIComponent(parsed.username),
    };
}

export function validateStagingSentrySyntheticGate(input: {
    args: StagingSentrySyntheticArgs;
    env: Record<string, string | undefined>;
    repositoryRemote: string;
    resolvedEnvFile: string;
    webConfig: string;
    workspaceRoot: string;
}): StagingSentrySyntheticGate {
    if (input.repositoryRemote.trim() !== STAGING_SENTRY_SYNTHETIC_IDENTITY.repositoryRemote) {
        throw new Error('Repository remote must be codingships/honestSpanish');
    }

    const envFile = path.resolve(input.resolvedEnvFile);
    if (path.basename(envFile) !== '.env.staging') {
        throw new Error('Sentry synthetic smoke must load .env.staging');
    }

    requireExactValue(input.env, 'PUBLIC_APP_ENV', 'staging');
    requireExactValue(input.env, 'SUPABASE_EXPECTED_PROJECT_REF', STAGING_SENTRY_SYNTHETIC_IDENTITY.supabaseProjectRef);
    requireExactValue(input.env, 'STRIPE_EXPECTED_ACCOUNT_ID', STAGING_SENTRY_SYNTHETIC_IDENTITY.stripeAccountId);
    requireExactValue(input.env, 'PUBLIC_SITE_URL', STAGING_SENTRY_SYNTHETIC_IDENTITY.webOrigin);
    requireExactValue(
        input.env,
        'PUBLIC_SUPABASE_URL',
        `https://${STAGING_SENTRY_SYNTHETIC_IDENTITY.supabaseProjectRef}.supabase.co`,
    );

    const sentryEnvironment = input.env.SENTRY_ENVIRONMENT?.trim();
    if (sentryEnvironment && sentryEnvironment !== 'staging') {
        throw new Error('SENTRY_ENVIRONMENT must be staging when present');
    }

    const { dsn, publicKey } = parseApprovedStagingSentryDsn(requireValue(input.env, 'PUBLIC_SENTRY_DSN'));

    if (!input.webConfig.includes(`name = "${STAGING_SENTRY_SYNTHETIC_IDENTITY.webWorker}"`)) {
        throw new Error('Web Worker config must target espanolhonesto-staging');
    }

    return {
        envFile,
        identity: STAGING_SENTRY_SYNTHETIC_IDENTITY,
        mode: input.args.mode,
        sentryDsn: dsn,
        sentryPublicKey: publicKey,
    };
}

export function assertSyntheticEventHasNoDecoys(serialized: string): void {
    const decoys = Object.values(STAGING_SENTRY_SYNTHETIC_DECOYS);
    for (const decoy of decoys) {
        if (serialized.includes(decoy)) {
            throw new Error('Scrubbed synthetic Sentry event still contains a privacy decoy');
        }
    }
    if (serialized.includes('example.invalid') || serialized.includes('decoy-')) {
        throw new Error('Scrubbed synthetic Sentry event still contains decoy residue');
    }
}

export function safeStagingSentrySyntheticSummary(gate: StagingSentrySyntheticGate): string[] {
    const identity = gate.identity;
    return [
        `mode=${gate.mode}`,
        'capability=r04-sentry-synthetic',
        `repository=${identity.repository}`,
        `sentry_org=${identity.sentryOrg}`,
        `sentry_project=${identity.sentryProject}`,
        `sentry_project_id=${identity.sentryProjectId}`,
        `supabase_project_ref=${identity.supabaseProjectRef}`,
        `stripe_account=${identity.stripeAccountId}`,
        `cloudflare_account=${identity.cloudflareAccountId}`,
        `workers=${identity.webWorker}`,
        'production=false',
        'stripe_live=false',
        'dns_writes=false',
        gate.mode === 'preflight'
            ? 'external_writes=none'
            : 'external_writes=staging-sentry-event',
    ];
}
