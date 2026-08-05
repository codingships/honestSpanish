import path from 'node:path';

export const STAGING_SUPABASE_REF = 'mzjyvmlxfpzdfdjzxxyj';
export const STAGING_SITE_HOST = 'staging.espanolhonesto.com';
export const STAGING_FULFILLMENT_HOST = 'espanol-honesto-fulfillment-staging.alindev95.workers.dev';
export const STAGING_WEB_IDENTITY = 'espanolhonesto-staging';
export const STAGING_FULFILLMENT_IDENTITY = 'espanol-honesto-fulfillment-staging';
export const STAGING_SMOKE_LEASE_NAME = 'google-resend-write-smoke';
export const STAGING_DAILY_EMAIL_LIMIT = 10;
export const STAGING_MONTHLY_EMAIL_LIMIT = 100;

export type RunnerArgs = {
    baseUrl?: string;
    confirmation?: string;
    cleanupOnly?: string;
    envFile: string;
    execute: boolean;
    expectedFulfillmentVersionId?: string;
    expectedWebVersionId?: string;
    sendOneEmail: boolean;
};

export type StagingGate = {
    baseHost: string;
    baseOrigin: string;
    dailyEmailLimit: number;
    expectedFulfillmentVersionId: string;
    expectedWebVersionId: string;
    monthlyEmailLimit: number;
    recipientAllowlist: Set<string>;
};

type DriveCleanupCandidate = {
    mimeType?: string | null;
    name?: string | null;
    parents?: string[] | null;
};

type CalendarCleanupCandidate = {
    organizer?: { email?: string | null } | null;
    start?: { dateTime?: string | null } | null;
    summary?: string | null;
};

function optionValue(argv: string[], index: number, option: string): string {
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
        throw new Error(`${option} requires a value`);
    }
    return value;
}

export function parseRunnerArgs(argv: string[]): RunnerArgs {
    const args: RunnerArgs = {
        envFile: '.env.staging',
        execute: false,
        sendOneEmail: false,
    };
    let selectedMode: 'execute' | 'preflight' | null = null;

    for (let index = 0; index < argv.length; index += 1) {
        const option = argv[index];
        if (option === '--execute') {
            if (selectedMode === 'preflight') throw new Error('--execute cannot be combined with --preflight/--dry-run');
            selectedMode = 'execute';
            args.execute = true;
        } else if (option === '--preflight' || option === '--dry-run') {
            if (selectedMode === 'execute') throw new Error('--execute cannot be combined with --preflight/--dry-run');
            selectedMode = 'preflight';
            args.execute = false;
        }
        else if (option === '--send-one-email') args.sendOneEmail = true;
        else if (option === '--cleanup-only') args.cleanupOnly = optionValue(argv, index++, option);
        else if (option === '--base-url') args.baseUrl = optionValue(argv, index++, option);
        else if (option === '--confirmation') args.confirmation = optionValue(argv, index++, option);
        else if (option === '--env-file') args.envFile = optionValue(argv, index++, option);
        else if (option === '--expected-web-version-id') {
            args.expectedWebVersionId = optionValue(argv, index++, option);
        }
        else if (option === '--expected-fulfillment-version-id') {
            args.expectedFulfillmentVersionId = optionValue(argv, index++, option);
        }
        else throw new Error(`Unknown option: ${option}`);
    }

    return args;
}

function requireEnv(env: Record<string, string | undefined>, key: string): string {
    const value = env[key]?.trim();
    if (!value) throw new Error(`Missing ${key}`);
    return value;
}

function requireHttpsOrigin(value: string, label: string): URL {
    let url: URL;
    try {
        url = new URL(value);
    } catch {
        throw new Error(`${label} must be an absolute URL`);
    }

    if (url.protocol !== 'https:' || (url.pathname !== '/' && url.pathname !== '') || url.search || url.hash) {
        throw new Error(`${label} must be an HTTPS origin without path, query or hash`);
    }
    return url;
}

function parsePositiveLimit(value: string, key: string, maximum: number): number {
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) {
        throw new Error(`${key} must be an integer between 1 and ${maximum}`);
    }
    return parsed;
}

function normalizeEmail(value: string): string {
    return value.trim().toLowerCase();
}

export function isAllowedStagingWebHost(host: string): boolean {
    return host === STAGING_SITE_HOST;
}

function requireVersionId(value: string | undefined, option: string): string {
    const normalized = value?.trim().toLowerCase();
    if (!normalized || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(normalized)) {
        throw new Error(`${option} must be an externally supplied Worker version UUID`);
    }
    return normalized;
}

export function validateStagingGates(input: {
    args: RunnerArgs;
    env: Record<string, string | undefined>;
    workspaceRoot: string;
}): StagingGate {
    const { args, env, workspaceRoot } = input;
    const expectedEnvFile = path.resolve(workspaceRoot, '.env.staging');
    if (path.resolve(workspaceRoot, args.envFile) !== expectedEnvFile) {
        throw new Error('Only the workspace .env.staging file is allowed');
    }

    if (requireEnv(env, 'PUBLIC_APP_ENV') !== 'staging') {
        throw new Error('PUBLIC_APP_ENV must be staging');
    }

    const supabaseUrl = requireHttpsOrigin(requireEnv(env, 'PUBLIC_SUPABASE_URL'), 'PUBLIC_SUPABASE_URL');
    if (supabaseUrl.hostname !== `${STAGING_SUPABASE_REF}.supabase.co`) {
        throw new Error('PUBLIC_SUPABASE_URL is not the approved staging project');
    }

    const siteUrl = requireHttpsOrigin(requireEnv(env, 'PUBLIC_SITE_URL'), 'PUBLIC_SITE_URL');
    if (siteUrl.hostname !== STAGING_SITE_HOST) {
        throw new Error('PUBLIC_SITE_URL is not the approved stable staging Worker');
    }

    const fulfillmentUrl = requireHttpsOrigin(
        requireEnv(env, 'FULFILLMENT_WORKER_URL'),
        'FULFILLMENT_WORKER_URL',
    );
    if (fulfillmentUrl.hostname !== STAGING_FULFILLMENT_HOST) {
        throw new Error('FULFILLMENT_WORKER_URL is not the approved staging Worker');
    }

    const baseUrl = requireHttpsOrigin(args.baseUrl ?? siteUrl.origin, '--base-url');
    if (!isAllowedStagingWebHost(baseUrl.hostname)) {
        throw new Error('--base-url is not an approved staging Worker host');
    }
    const expectedWebVersionId = requireVersionId(
        args.expectedWebVersionId,
        '--expected-web-version-id',
    );
    const expectedFulfillmentVersionId = requireVersionId(
        args.expectedFulfillmentVersionId,
        '--expected-fulfillment-version-id',
    );

    if (requireEnv(env, 'CHECKOUT_ENABLED') !== 'true'
        || requireEnv(env, 'CHECKOUT_ENABLED_OVERRIDE') !== 'true') {
        throw new Error('Checkout must remain enabled during the integration smoke');
    }

    const stripeKey = env.STRIPE_SECRET_KEY?.trim();
    if (stripeKey && !stripeKey.startsWith('sk_test_')) {
        throw new Error('A non-test Stripe key is forbidden in staging');
    }

    if (requireEnv(env, 'EMAIL_DELIVERY_MODE') !== 'allowlist') {
        throw new Error('EMAIL_DELIVERY_MODE must be allowlist');
    }

    const dailyEmailLimit = parsePositiveLimit(
        requireEnv(env, 'EMAIL_DAILY_RECIPIENT_LIMIT'),
        'EMAIL_DAILY_RECIPIENT_LIMIT',
        STAGING_DAILY_EMAIL_LIMIT,
    );
    const monthlyEmailLimit = parsePositiveLimit(
        requireEnv(env, 'EMAIL_MONTHLY_RECIPIENT_LIMIT'),
        'EMAIL_MONTHLY_RECIPIENT_LIMIT',
        STAGING_MONTHLY_EMAIL_LIMIT,
    );
    const recipientAllowlist = new Set(
        requireEnv(env, 'EMAIL_RECIPIENT_ALLOWLIST')
            .split(/[,;\n]/)
            .map(normalizeEmail)
            .filter(Boolean),
    );
    for (const key of ['TEST_ADMIN_EMAIL', 'TEST_STUDENT_EMAIL', 'TEST_TEACHER_EMAIL']) {
        if (!recipientAllowlist.has(normalizeEmail(requireEnv(env, key)))) {
            throw new Error(`${key} must be in EMAIL_RECIPIENT_ALLOWLIST`);
        }
    }

    for (const key of [
        'PUBLIC_SUPABASE_ANON_KEY',
        'SUPABASE_SERVICE_ROLE_KEY',
        'INTERNAL_JOB_SECRET',
        'GOOGLE_SERVICE_ACCOUNT_EMAIL',
        'GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY',
        'GOOGLE_ADMIN_EMAIL',
        'GOOGLE_DRIVE_ROOT_FOLDER_ID',
        'GOOGLE_TEMPLATE_DOC_ID',
        'RESEND_API_KEY',
        'TEST_ADMIN_PASSWORD',
        'TEST_TEACHER_PASSWORD',
    ]) requireEnv(env, key);

    if (env.GOOGLE_DRIVE_ROOT_FOLDER_ID === env.GOOGLE_TEMPLATE_DOC_ID) {
        throw new Error('Google staging root and template IDs must differ');
    }

    if (args.execute) {
        const expectedConfirmation = `writes-ok:${baseUrl.host}`;
        if (args.confirmation !== expectedConfirmation) {
            throw new Error(`--confirmation must exactly match ${expectedConfirmation}`);
        }
        if (!args.cleanupOnly && !args.sendOneEmail) {
            throw new Error('--execute requires --send-one-email');
        }
        if (args.cleanupOnly && args.sendOneEmail) {
            throw new Error('--cleanup-only cannot be combined with --send-one-email');
        }
    } else if (args.sendOneEmail) {
        throw new Error('--send-one-email is only valid with --execute');
    } else if (args.cleanupOnly) {
        throw new Error('--cleanup-only is only valid with --execute');
    }

    if (args.cleanupOnly && !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(args.cleanupOnly)) {
        throw new Error('--cleanup-only requires a UUID run_id');
    }

    return {
        baseHost: baseUrl.host,
        baseOrigin: baseUrl.origin,
        dailyEmailLimit,
        expectedFulfillmentVersionId,
        expectedWebVersionId,
        monthlyEmailLimit,
        recipientAllowlist,
    };
}

export function assertExactJobResponse(
    response: unknown,
    expected: { dedupeKey: string; jobId: string; runId: string; smokeMarker: string },
): void {
    if (!response || typeof response !== 'object' || Array.isArray(response)) {
        throw new Error('Exact job response is not an object');
    }
    const record = response as Record<string, unknown>;
    if (
        record.status !== 'succeeded'
        || record.dedupeKey !== expected.dedupeKey
        || record.jobId !== expected.jobId
        || record.runId !== expected.runId
        || record.smokeMarker !== expected.smokeMarker
    ) {
        throw new Error('Exact job response identity mismatch');
    }
}

export function assertExactEmailResponse(
    response: unknown,
    expected: { runId: string; smokeMarker: string },
): void {
    if (!response || typeof response !== 'object' || Array.isArray(response)) {
        throw new Error('Exact email response is not an object');
    }
    const record = response as Record<string, unknown>;
    if (
        record.status !== 'sent'
        || record.runId !== expected.runId
        || record.smokeMarker !== expected.smokeMarker
    ) {
        throw new Error('Exact email response identity mismatch');
    }
}

export function assertDriveCleanupTarget(
    candidate: DriveCleanupCandidate,
    expectedParentId: string,
    marker: string,
): void {
    if (candidate.mimeType !== 'application/vnd.google-apps.folder') {
        throw new Error('Drive cleanup target is not a folder');
    }
    if (!candidate.parents?.includes(expectedParentId)) {
        throw new Error('Drive cleanup target is outside the staging root');
    }
    if (!candidate.name?.includes(marker)) {
        throw new Error('Drive cleanup target does not contain the smoke marker');
    }
}

export function assertCalendarCleanupTarget(
    candidate: CalendarCleanupCandidate,
    input: { marker: string; organizerEmail: string; scheduledAt: string },
): void {
    if (candidate.summary !== `Clase de Español - ${input.marker}`) {
        throw new Error('Calendar cleanup target does not match the smoke marker');
    }
    if (normalizeEmail(candidate.organizer?.email ?? '') !== normalizeEmail(input.organizerEmail)) {
        throw new Error('Calendar cleanup target has an unexpected organizer');
    }
    const actualStart = new Date(candidate.start?.dateTime ?? '').getTime();
    const expectedStart = new Date(input.scheduledAt).getTime();
    if (!Number.isFinite(actualStart) || Math.abs(actualStart - expectedStart) > 60_000) {
        throw new Error('Calendar cleanup target has an unexpected start time');
    }
}
