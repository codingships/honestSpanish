import { chmodSync, writeFileSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Cloudflare preserves existing secret bindings omitted from --secrets-file.
// Keep every active staging secret explicit here until a separately authorized
// provider cleanup removes that binding from the Worker itself.
export const WEB_VERSION_SECRET_NAMES = [
    'ADMIN_EMAIL',
    'CHECKOUT_HOLD_FINGERPRINT_SECRET',
    'CRON_SECRET',
    'EMAIL_RECIPIENT_ALLOWLIST',
    'INTERNAL_JOB_SECRET',
    'LEVEL_CHECK_TOKEN_SECRET',
    'PUBLIC_SENTRY_DSN',
    'PUBLIC_STRIPE_PUBLISHABLE_KEY',
    'PUBLIC_SUPABASE_ANON_KEY',
    'PUBLIC_SUPABASE_URL',
    'RESEND_API_KEY',
    'RESEND_FROM_EMAIL',
    'STRIPE_EXPECTED_ACCOUNT_ID',
    'STRIPE_PORTAL_CONFIGURATION_ID',
    'STRIPE_SECRET_KEY',
    'STRIPE_WEBHOOK_SECRET',
    'SUPABASE_SERVICE_ROLE_KEY',
    'SUPPORT_ALERT_EMAIL',
    'TURNSTILE_SECRET_KEY',
] as const;

export const FULFILLMENT_VERSION_SECRET_NAMES = [
    'CRON_SECRET',
    'EMAIL_FROM',
    'EMAIL_RECIPIENT_ALLOWLIST',
    'GOOGLE_ADMIN_EMAIL',
    'GOOGLE_DRIVE_ROOT_FOLDER_ID',
    'GOOGLE_SERVICE_ACCOUNT_EMAIL',
    'GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY',
    'GOOGLE_TEMPLATE_DOC_ID',
    'INTERNAL_JOB_SECRET',
    'PUBLIC_SUPABASE_URL',
    'RESEND_API_KEY',
    'RESEND_FROM_EMAIL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'SUPPORT_ALERT_EMAIL',
] as const;

type SecretName = typeof WEB_VERSION_SECRET_NAMES[number]
    | typeof FULFILLMENT_VERSION_SECRET_NAMES[number];

export type CloudflareWorkerRole = 'web' | 'fulfillment';

const SECRET_NAMES_BY_ROLE = {
    fulfillment: FULFILLMENT_VERSION_SECRET_NAMES,
    web: WEB_VERSION_SECRET_NAMES,
} as const satisfies Record<CloudflareWorkerRole, readonly SecretName[]>;

export function writeCloudflareVersionSecrets(input: {
    env: Record<string, string | undefined>;
    outputPath: string;
    role: CloudflareWorkerRole;
    runnerTemp: string;
}): void {
    if (!input.runnerTemp || !isAbsolute(input.runnerTemp)) {
        throw new Error('RUNNER_TEMP must be an absolute path');
    }
    const runnerTemp = resolve(input.runnerTemp);
    const outputPath = exactRunnerTempFile(input.outputPath, runnerTemp, input.role);
    const secrets = readSecrets(input.env, SECRET_NAMES_BY_ROLE[input.role]);

    writeSecretFile(outputPath, secrets);
}

function readSecrets(
    env: Record<string, string | undefined>,
    names: readonly SecretName[],
): Record<string, string> {
    const missing = names.filter((name) => !(env[name]?.trim()));
    if (missing.length > 0) {
        throw new Error(`Missing version-scoped Worker secrets: ${missing.join(', ')}`);
    }
    if (
        names.includes('CHECKOUT_HOLD_FINGERPRINT_SECRET')
        && Buffer.byteLength(env.CHECKOUT_HOLD_FINGERPRINT_SECRET!.trim(), 'utf8') < 32
    ) {
        throw new Error('CHECKOUT_HOLD_FINGERPRINT_SECRET must contain at least 32 UTF-8 bytes');
    }
    return Object.fromEntries(names.map((name) => [name, env[name]!.trim()]));
}

function exactRunnerTempFile(path: string, runnerTemp: string, role: CloudflareWorkerRole): string {
    const resolved = resolve(path);
    const relativePath = relative(runnerTemp, resolved);
    if (
        !isAbsolute(path)
        || !relativePath
        || relativePath.startsWith('..')
        || isAbsolute(relativePath)
        || relativePath.includes('/')
        || relativePath.includes('\\')
        || !relativePath.endsWith('.json')
    ) {
        throw new Error(`${role} secrets file must be one JSON file directly inside RUNNER_TEMP`);
    }
    return resolved;
}

function writeSecretFile(path: string, secrets: Record<string, string>): void {
    writeFileSync(path, JSON.stringify(secrets), {
        encoding: 'utf8',
        flag: 'wx',
        mode: 0o600,
    });
    chmodSync(path, 0o600);
}

function argumentValue(name: '--output' | '--role'): string {
    const index = process.argv.indexOf(name);
    const value = index >= 0 ? process.argv[index + 1] : undefined;
    if (!value) throw new Error(`${name} requires a path`);
    return value;
}

function roleArgument(): CloudflareWorkerRole {
    const role = argumentValue('--role');
    if (role !== 'web' && role !== 'fulfillment') {
        throw new Error('--role must be web or fulfillment');
    }
    return role;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const role = roleArgument();
    writeCloudflareVersionSecrets({
        env: process.env,
        outputPath: argumentValue('--output'),
        role,
        runnerTemp: process.env.RUNNER_TEMP ?? '',
    });
    console.log(`[cloudflare-version-secrets] Prepared ${role} version-scoped file; values withheld.`);
}
