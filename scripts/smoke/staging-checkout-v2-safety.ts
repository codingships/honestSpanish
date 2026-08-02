import path from 'node:path';

export const STAGING_CHECKOUT_V2_CONFIRMATION = [
    'writes-ok',
    'staging-checkout-v2',
    'codingships/honestSpanish',
    'mzjyvmlxfpzdfdjzxxyj',
    'acct_1TruqOC22M3erP0j',
    'd1a22bcf6477ff2ff31d2bfb83084e44',
].join(':');

export const STAGING_CHECKOUT_V2_IDENTITY = Object.freeze({
    cloudflareAccountId: 'd1a22bcf6477ff2ff31d2bfb83084e44',
    deadLetterQueue: 'espanol-honesto-fulfillment-staging-dlq',
    fulfillmentOrigin: 'https://espanol-honesto-fulfillment-staging.alindev95.workers.dev',
    fulfillmentWorker: 'espanol-honesto-fulfillment-staging',
    queue: 'espanol-honesto-fulfillment-staging-queue',
    repository: 'codingships/honestSpanish',
    repositoryRemote: 'https://github.com/codingships/honestSpanish.git',
    stripeAccountId: 'acct_1TruqOC22M3erP0j',
    stripeLivemode: false,
    supabaseProjectRef: 'mzjyvmlxfpzdfdjzxxyj',
    webOrigin: 'https://staging.espanolhonesto.com',
    webWorker: 'espanolhonesto-staging',
});

export type StagingCheckoutV2RunnerArgs = {
    confirmation?: string;
    envFile: string;
    mode: 'execute' | 'preflight';
};

export type StagingCheckoutV2Gate = {
    envFile: string;
    identity: typeof STAGING_CHECKOUT_V2_IDENTITY;
    mode: StagingCheckoutV2RunnerArgs['mode'];
};

export type StagingBrowserCookie = {
    name: string;
    value: string;
    url: string;
};

export function stagingBrowserCookies(cookieHeader: string): StagingBrowserCookie[] {
    const cookies: StagingBrowserCookie[] = [];
    const names = new Set<string>();

    for (const segment of cookieHeader.split(';')) {
        const separator = segment.indexOf('=');
        const name = separator >= 0 ? segment.slice(0, separator).trim() : '';
        const value = separator >= 0 ? segment.slice(separator + 1).trim() : '';
        if (!name || !value || !/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/u.test(name)) {
            throw new Error('Synthetic staging authentication returned a malformed browser cookie');
        }
        if (names.has(name)) {
            throw new Error('Synthetic staging authentication returned duplicate browser cookies');
        }
        names.add(name);
        cookies.push({ name, value, url: STAGING_CHECKOUT_V2_IDENTITY.webOrigin });
    }

    if (cookies.length === 0) {
        throw new Error('Synthetic staging authentication returned no browser cookies');
    }
    return cookies;
}

function optionValue(argv: string[], index: number, option: string): string {
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${option} requires a value`);
    return value;
}

export function parseStagingCheckoutV2Args(argv: string[]): StagingCheckoutV2RunnerArgs {
    const args: StagingCheckoutV2RunnerArgs = { envFile: '.env.staging', mode: 'preflight' };
    let selectedMode: StagingCheckoutV2RunnerArgs['mode'] | null = null;

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
        } else {
            throw new Error('Unknown option; production, live, DNS and arbitrary targets are forbidden');
        }
    }

    if (args.mode === 'execute' && args.confirmation !== STAGING_CHECKOUT_V2_CONFIRMATION) {
        throw new Error(`--execute requires --confirmation=${STAGING_CHECKOUT_V2_CONFIRMATION}`);
    }
    if (args.mode === 'preflight' && args.confirmation !== undefined) {
        throw new Error('--confirmation is valid only with --execute');
    }
    return args;
}

function requireValue(env: Record<string, string | undefined>, key: string): string {
    const value = env[key]?.trim();
    if (!value) throw new Error(`Staging checkout preflight requires ${key}`);
    return value;
}

function requireExactValue(
    env: Record<string, string | undefined>,
    key: string,
    expected: string,
): void {
    if (requireValue(env, key) !== expected) throw new Error(`${key} does not match the staging allowlist`);
}

function requireExactOrigin(value: string, expected: string, key: string): void {
    let parsed: URL;
    try {
        parsed = new URL(value);
    } catch {
        throw new Error(`${key} must be the exact staging origin`);
    }
    if (parsed.href !== `${expected}/`) throw new Error(`${key} must be the exact staging origin`);
}

function requireConfig(config: string, fragment: string, label: string): void {
    if (!config.replace(/\r\n/gu, '\n').includes(fragment)) {
        throw new Error(`${label} does not match the staging infrastructure allowlist`);
    }
}

export function validateStagingCheckoutV2Gate(input: {
    args: StagingCheckoutV2RunnerArgs;
    env: Record<string, string | undefined>;
    fulfillmentConfig: string;
    repositoryRemote: string;
    webConfig: string;
    workspaceRoot: string;
    resolvedEnvFile?: string;
}): StagingCheckoutV2Gate {
    const { args, env } = input;
    const envFile = path.resolve(input.resolvedEnvFile ?? path.resolve(input.workspaceRoot, args.envFile));
    if (path.basename(envFile) !== '.env.staging') {
        throw new Error('Only the canonical workspace .env.staging file is allowed');
    }
    if (input.repositoryRemote.trim() !== STAGING_CHECKOUT_V2_IDENTITY.repositoryRemote) {
        throw new Error('Git origin is not the allowlisted codingships/honestSpanish repository');
    }

    requireExactValue(env, 'PUBLIC_APP_ENV', 'staging');
    requireExactValue(env, 'SUPABASE_EXPECTED_PROJECT_REF', STAGING_CHECKOUT_V2_IDENTITY.supabaseProjectRef);
    requireExactValue(env, 'STRIPE_EXPECTED_ACCOUNT_ID', STAGING_CHECKOUT_V2_IDENTITY.stripeAccountId);
    requireExactValue(env, 'CHECKOUT_ENABLED', 'false');
    requireExactValue(env, 'CHECKOUT_ENABLED_OVERRIDE', 'false');

    requireExactOrigin(
        requireValue(env, 'PUBLIC_SITE_URL'),
        STAGING_CHECKOUT_V2_IDENTITY.webOrigin,
        'PUBLIC_SITE_URL',
    );
    requireExactOrigin(
        requireValue(env, 'PUBLIC_SUPABASE_URL'),
        `https://${STAGING_CHECKOUT_V2_IDENTITY.supabaseProjectRef}.supabase.co`,
        'PUBLIC_SUPABASE_URL',
    );
    requireExactOrigin(
        requireValue(env, 'FULFILLMENT_WORKER_URL'),
        STAGING_CHECKOUT_V2_IDENTITY.fulfillmentOrigin,
        'FULFILLMENT_WORKER_URL',
    );

    if (!requireValue(env, 'STRIPE_SECRET_KEY').startsWith('sk_test_')
        || !requireValue(env, 'PUBLIC_STRIPE_PUBLISHABLE_KEY').startsWith('pk_test_')) {
        throw new Error('Stripe staging keys must be test-mode keys');
    }
    requireValue(env, 'STRIPE_WEBHOOK_SECRET');
    requireValue(env, 'PUBLIC_SUPABASE_ANON_KEY');
    requireValue(env, 'SUPABASE_SERVICE_ROLE_KEY');
    requireValue(env, 'TEST_ADMIN_EMAIL');
    requireValue(env, 'TEST_ADMIN_PASSWORD');
    requireValue(env, 'TEST_TEACHER_EMAIL');

    requireConfig(input.webConfig, `name = "${STAGING_CHECKOUT_V2_IDENTITY.webWorker}"`, 'Web Worker');
    requireConfig(
        input.webConfig,
        `service = "${STAGING_CHECKOUT_V2_IDENTITY.fulfillmentWorker}"`,
        'Web service binding',
    );
    requireConfig(
        input.fulfillmentConfig,
        `name = "${STAGING_CHECKOUT_V2_IDENTITY.fulfillmentWorker}"`,
        'Fulfillment Worker',
    );
    requireConfig(
        input.fulfillmentConfig,
        `queue = "${STAGING_CHECKOUT_V2_IDENTITY.queue}"`,
        'Fulfillment queue',
    );
    requireConfig(
        input.fulfillmentConfig,
        `dead_letter_queue = "${STAGING_CHECKOUT_V2_IDENTITY.deadLetterQueue}"`,
        'Fulfillment DLQ',
    );

    return { envFile, identity: STAGING_CHECKOUT_V2_IDENTITY, mode: args.mode };
}

export function safeStagingCheckoutV2Summary(gate: StagingCheckoutV2Gate): string[] {
    const identity = gate.identity;
    return [
        `mode=${gate.mode}`,
        `repository=${identity.repository}`,
        `supabase_project_ref=${identity.supabaseProjectRef}`,
        `stripe_account=${identity.stripeAccountId}`,
        `stripe_livemode=${String(identity.stripeLivemode)}`,
        `cloudflare_account=${identity.cloudflareAccountId}`,
        `workers=${identity.webWorker},${identity.fulfillmentWorker}`,
        `queue=${identity.queue}`,
        `dlq=${identity.deadLetterQueue}`,
        'production=false',
        'stripe_live=false',
        'dns_writes=false',
        gate.mode === 'preflight'
            ? 'external_writes=none'
            : 'external_writes=staging-supabase,stripe-sandbox,staging-web',
    ];
}
