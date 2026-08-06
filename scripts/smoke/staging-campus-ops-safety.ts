import path from 'node:path';
import { STAGING_CHECKOUT_V2_IDENTITY } from './staging-checkout-v2-safety';

export const STAGING_CAMPUS_OPS_CONFIRMATION = [
    'writes-ok',
    'staging-campus-ops',
    'codingships/honestSpanish',
    'mzjyvmlxfpzdfdjzxxyj',
    'acct_1TruqOC22M3erP0j',
    'd1a22bcf6477ff2ff31d2bfb83084e44',
].join(':');

export const STAGING_CAMPUS_OPS_IDENTITY = STAGING_CHECKOUT_V2_IDENTITY;

export type StagingCampusOpsArgs = {
    confirmation?: string;
    envFile: string;
    mode: 'execute' | 'preflight';
    /** Reuse a fulfilled Checkout V2 subscription for B03 without a new purchase. */
    reuseSubscriptionId?: string;
};

export type StagingCampusOpsGate = {
    envFile: string;
    identity: typeof STAGING_CAMPUS_OPS_IDENTITY;
    mode: StagingCampusOpsArgs['mode'];
};

function optionValue(argv: string[], index: number, option: string): string {
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${option} requires a value`);
    return value;
}

export function parseStagingCampusOpsArgs(argv: string[]): StagingCampusOpsArgs {
    const args: StagingCampusOpsArgs = {
        envFile: '.env.staging',
        mode: 'preflight',
    };
    let selectedMode: StagingCampusOpsArgs['mode'] | null = null;

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
        } else if (option === '--reuse-subscription') {
            if (args.reuseSubscriptionId !== undefined) {
                throw new Error('--reuse-subscription was provided more than once');
            }
            args.reuseSubscriptionId = optionValue(argv, index++, option);
        } else {
            throw new Error('Unknown option; production, live, DNS and arbitrary targets are forbidden');
        }
    }

    if (args.mode === 'execute' && args.confirmation !== STAGING_CAMPUS_OPS_CONFIRMATION) {
        throw new Error(`--execute requires --confirmation=${STAGING_CAMPUS_OPS_CONFIRMATION}`);
    }
    if (args.mode === 'preflight' && args.confirmation !== undefined) {
        throw new Error('--confirmation is valid only with --execute');
    }
    if (args.mode === 'preflight' && args.reuseSubscriptionId !== undefined) {
        throw new Error('--reuse-subscription is valid only with --execute');
    }
    if (
        args.reuseSubscriptionId !== undefined
        && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
            .test(args.reuseSubscriptionId)
    ) {
        throw new Error('--reuse-subscription requires a UUID');
    }
    return args;
}

function requireValue(env: Record<string, string | undefined>, key: string): string {
    const value = env[key]?.trim();
    if (!value) throw new Error(`Staging campus-ops requires ${key}`);
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

function requireExactOrigin(value: string, expected: string, label: string): void {
    if (value !== expected) throw new Error(`${label} must be exactly ${expected}`);
}

function requireConfig(config: string, needle: string, label: string): void {
    if (!config.includes(needle)) throw new Error(`${label} config must include ${needle}`);
}

export function validateStagingCampusOpsGate(input: {
    args: StagingCampusOpsArgs;
    env: Record<string, string | undefined>;
    fulfillmentConfig: string;
    repositoryRemote: string;
    resolvedEnvFile: string;
    webConfig: string;
    workspaceRoot: string;
}): StagingCampusOpsGate {
    if (input.repositoryRemote.trim() !== STAGING_CAMPUS_OPS_IDENTITY.repositoryRemote) {
        throw new Error('Repository remote must be codingships/honestSpanish');
    }

    const envFile = path.resolve(input.resolvedEnvFile);
    if (!envFile.endsWith(`${path.sep}.env.staging`) && path.basename(envFile) !== '.env.staging') {
        throw new Error('Campus-ops must load .env.staging');
    }

    requireExactValue(input.env, 'PUBLIC_APP_ENV', 'staging');
    requireExactValue(input.env, 'SUPABASE_EXPECTED_PROJECT_REF', STAGING_CAMPUS_OPS_IDENTITY.supabaseProjectRef);
    requireExactValue(input.env, 'STRIPE_EXPECTED_ACCOUNT_ID', STAGING_CAMPUS_OPS_IDENTITY.stripeAccountId);
    requireExactOrigin(
        requireValue(input.env, 'PUBLIC_SITE_URL'),
        STAGING_CAMPUS_OPS_IDENTITY.webOrigin,
        'PUBLIC_SITE_URL',
    );
    requireExactOrigin(
        requireValue(input.env, 'PUBLIC_SUPABASE_URL'),
        `https://${STAGING_CAMPUS_OPS_IDENTITY.supabaseProjectRef}.supabase.co`,
        'PUBLIC_SUPABASE_URL',
    );
    requireExactOrigin(
        requireValue(input.env, 'FULFILLMENT_WORKER_URL'),
        STAGING_CAMPUS_OPS_IDENTITY.fulfillmentOrigin,
        'FULFILLMENT_WORKER_URL',
    );

    if (!requireValue(input.env, 'STRIPE_SECRET_KEY').startsWith('sk_test_')
        || !requireValue(input.env, 'PUBLIC_STRIPE_PUBLISHABLE_KEY').startsWith('pk_test_')) {
        throw new Error('Stripe staging keys must be test-mode keys');
    }
    requireExactValue(input.env, 'CHECKOUT_ENABLED', 'true');
    requireExactValue(input.env, 'CHECKOUT_ENABLED_OVERRIDE', 'true');
    for (const key of [
        'STRIPE_WEBHOOK_SECRET',
        'PUBLIC_SUPABASE_ANON_KEY',
        'SUPABASE_SERVICE_ROLE_KEY',
        'TEST_ADMIN_EMAIL',
        'TEST_ADMIN_PASSWORD',
        'TEST_TEACHER_EMAIL',
        'TEST_TEACHER_PASSWORD',
    ]) {
        requireValue(input.env, key);
    }
    const databaseUrl = requireValue(input.env, 'SUPABASE_DB_URL');
    if (!databaseUrl.includes(STAGING_CAMPUS_OPS_IDENTITY.supabaseProjectRef)) {
        throw new Error('SUPABASE_DB_URL does not identify the allowlisted staging project');
    }

    requireConfig(input.webConfig, `name = "${STAGING_CAMPUS_OPS_IDENTITY.webWorker}"`, 'Web Worker');
    requireConfig(
        input.webConfig,
        `service = "${STAGING_CAMPUS_OPS_IDENTITY.fulfillmentWorker}"`,
        'Web service binding',
    );
    requireConfig(
        input.fulfillmentConfig,
        `name = "${STAGING_CAMPUS_OPS_IDENTITY.fulfillmentWorker}"`,
        'Fulfillment Worker',
    );

    return {
        envFile,
        identity: STAGING_CAMPUS_OPS_IDENTITY,
        mode: input.args.mode,
    };
}

export function safeStagingCampusOpsSummary(gate: StagingCampusOpsGate): string[] {
    const identity = gate.identity;
    return [
        `mode=${gate.mode}`,
        'campus_ops=b03',
        `repository=${identity.repository}`,
        `supabase_project_ref=${identity.supabaseProjectRef}`,
        `stripe_account=${identity.stripeAccountId}`,
        `stripe_livemode=${String(identity.stripeLivemode)}`,
        `cloudflare_account=${identity.cloudflareAccountId}`,
        `workers=${identity.webWorker},${identity.fulfillmentWorker}`,
        'production=false',
        'stripe_live=false',
        'dns_writes=false',
        gate.mode === 'preflight'
            ? 'external_writes=none'
            : 'external_writes=staging-supabase,staging-stripe-sandbox,staging-web',
    ];
}
