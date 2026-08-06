import path from 'node:path';

export const STAGING_TEACHER_OPS_CONFIRMATION = [
    'writes-ok',
    'staging-teacher-ops',
    'codingships/honestSpanish',
    'mzjyvmlxfpzdfdjzxxyj',
    'acct_1TruqOC22M3erP0j',
    'd1a22bcf6477ff2ff31d2bfb83084e44',
].join(':');

export const STAGING_TEACHER_OPS_IDENTITY = Object.freeze({
    cloudflareAccountId: 'd1a22bcf6477ff2ff31d2bfb83084e44',
    repository: 'codingships/honestSpanish',
    repositoryRemote: 'https://github.com/codingships/honestSpanish.git',
    stripeAccountId: 'acct_1TruqOC22M3erP0j',
    supabaseProjectRef: 'mzjyvmlxfpzdfdjzxxyj',
    webOrigin: 'https://staging.espanolhonesto.com',
    webWorker: 'espanolhonesto-staging',
});

export type StagingTeacherOpsArgs = {
    confirmation?: string;
    envFile: string;
    mode: 'execute' | 'preflight';
};

export type StagingTeacherOpsGate = {
    envFile: string;
    identity: typeof STAGING_TEACHER_OPS_IDENTITY;
    mode: StagingTeacherOpsArgs['mode'];
};

function optionValue(argv: string[], index: number, option: string): string {
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${option} requires a value`);
    return value;
}

export function parseStagingTeacherOpsArgs(argv: string[]): StagingTeacherOpsArgs {
    const args: StagingTeacherOpsArgs = {
        envFile: '.env.staging',
        mode: 'preflight',
    };
    let selectedMode: 'execute' | 'preflight' | null = null;

    for (let index = 0; index < argv.length; index += 1) {
        const option = argv[index];
        if (option === '--execute') {
            if (selectedMode === 'preflight') throw new Error('--execute cannot be combined with --preflight');
            selectedMode = 'execute';
            args.mode = 'execute';
        } else if (option === '--preflight') {
            if (selectedMode === 'execute') throw new Error('--execute cannot be combined with --preflight');
            selectedMode = 'preflight';
            args.mode = 'preflight';
        } else if (option === '--confirmation') {
            if (args.confirmation !== undefined) throw new Error('--confirmation was provided more than once');
            args.confirmation = optionValue(argv, index++, option);
        } else if (option === '--env-file') {
            args.envFile = optionValue(argv, index++, option);
        } else {
            throw new Error(`Unknown option ${option}`);
        }
    }

    if (args.mode === 'execute' && args.confirmation !== STAGING_TEACHER_OPS_CONFIRMATION) {
        throw new Error(`--execute requires --confirmation=${STAGING_TEACHER_OPS_CONFIRMATION}`);
    }
    if (args.mode === 'preflight' && args.confirmation !== undefined) {
        throw new Error('--confirmation is valid only with --execute');
    }
    return args;
}

function requireExactValue(
    env: Record<string, string | undefined>,
    key: string,
    expected: string,
): void {
    const value = env[key]?.trim();
    if (!value) throw new Error(`Staging teacher-ops requires ${key}`);
    if (value !== expected) throw new Error(`${key} must be exactly ${expected}`);
}

export function validateStagingTeacherOpsGate(input: {
    args: StagingTeacherOpsArgs;
    env: Record<string, string | undefined>;
    repositoryRemote: string;
    resolvedEnvFile: string;
    webConfig: string;
    workspaceRoot: string;
}): StagingTeacherOpsGate {
    if (input.repositoryRemote.trim() !== STAGING_TEACHER_OPS_IDENTITY.repositoryRemote) {
        throw new Error('Repository remote must be codingships/honestSpanish');
    }

    requireExactValue(input.env, 'PUBLIC_APP_ENV', 'staging');
    requireExactValue(input.env, 'SUPABASE_EXPECTED_PROJECT_REF', STAGING_TEACHER_OPS_IDENTITY.supabaseProjectRef);
    requireExactValue(input.env, 'STRIPE_EXPECTED_ACCOUNT_ID', STAGING_TEACHER_OPS_IDENTITY.stripeAccountId);
    requireExactValue(input.env, 'PUBLIC_SITE_URL', STAGING_TEACHER_OPS_IDENTITY.webOrigin);
    requireExactValue(
        input.env,
        'PUBLIC_SUPABASE_URL',
        `https://${STAGING_TEACHER_OPS_IDENTITY.supabaseProjectRef}.supabase.co`,
    );

    for (const key of [
        'PUBLIC_SUPABASE_ANON_KEY',
        'SUPABASE_SERVICE_ROLE_KEY',
        'TEST_ADMIN_EMAIL',
        'TEST_ADMIN_PASSWORD',
    ]) {
        if (!input.env[key]?.trim()) throw new Error(`Staging teacher-ops requires ${key}`);
    }

    if (!input.webConfig.includes(`name = "${STAGING_TEACHER_OPS_IDENTITY.webWorker}"`)) {
        throw new Error('Web Worker config must target espanolhonesto-staging');
    }

    void input.workspaceRoot;
    if (!path.basename(input.resolvedEnvFile).includes('env.staging')
        && !input.resolvedEnvFile.includes('staging-teacher-ops-fixture')) {
        throw new Error('Teacher-ops smoke must use .env.staging');
    }

    return {
        envFile: input.args.envFile,
        identity: STAGING_TEACHER_OPS_IDENTITY,
        mode: input.args.mode,
    };
}

export function safeStagingTeacherOpsSummary(gate: StagingTeacherOpsGate): string[] {
    return [
        `mode=${gate.mode}`,
        `repository=${gate.identity.repository}`,
        `supabase_project_ref=${gate.identity.supabaseProjectRef}`,
        `stripe_account=${gate.identity.stripeAccountId}`,
        `cloudflare_account=${gate.identity.cloudflareAccountId}`,
        `web=${gate.identity.webWorker}`,
        'production=false',
        'stripe_live=false',
        'dns_writes=false',
        'external_writes=staging-supabase,staging-web',
    ];
}
