import {
    chmodSync,
    closeSync,
    existsSync,
    fsyncSync,
    openSync,
    readFileSync,
    renameSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import * as dotenv from 'dotenv';

const stagingPath = '.env.staging';
const stagingRef = 'mzjyvmlxfpzdfdjzxxyj';
const expectedStripeAccount = 'acct_1TruqOC22M3erP0j';
const exactConfirmation = `update-staging-webhook-secret:${stagingRef}:espanolhonesto-staging`;

if (process.argv[2] !== exactConfirmation) {
    throw new Error('Exact staging webhook-secret confirmation is required.');
}

const chunks: Buffer[] = [];
for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
}

const webhookSecret = Buffer.concat(chunks).toString('utf8').trim();
if (!/^whsec_[A-Za-z0-9_]+$/u.test(webhookSecret)) {
    throw new Error('A Stripe webhook signing secret is required on stdin.');
}

const staging = dotenv.parse(readFileSync(stagingPath, 'utf8'));
if (!staging.PUBLIC_SUPABASE_URL?.includes(stagingRef)) {
    throw new Error(`Refusing a non-staging Supabase target; expected ${stagingRef}.`);
}
if (!staging.STRIPE_SECRET_KEY?.startsWith('sk_test_')) {
    throw new Error('Refusing a non-test Stripe environment.');
}
if (staging.STRIPE_EXPECTED_ACCOUNT_ID !== expectedStripeAccount) {
    throw new Error(`Refusing a Stripe account other than ${expectedStripeAccount}.`);
}

staging.STRIPE_WEBHOOK_SECRET = webhookSecret;
const serialized = `${Object.entries(staging)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
    .join('\n')}\n`;
const temporaryPath = `${stagingPath}.tmp-${process.pid}`;

try {
    rmSync(temporaryPath, { force: true });
    writeFileSync(temporaryPath, serialized, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    chmodSync(temporaryPath, 0o600);

    const verified = dotenv.parse(readFileSync(temporaryPath, 'utf8'));
    if (
        verified.STRIPE_WEBHOOK_SECRET !== webhookSecret
        || verified.PUBLIC_SUPABASE_URL !== staging.PUBLIC_SUPABASE_URL
        || verified.STRIPE_EXPECTED_ACCOUNT_ID !== expectedStripeAccount
    ) {
        throw new Error('Atomic staging webhook-secret verification failed.');
    }

    const descriptor = openSync(temporaryPath, 'r');
    try {
        fsyncSync(descriptor);
    } finally {
        closeSync(descriptor);
    }
    renameSync(temporaryPath, stagingPath);
    chmodSync(stagingPath, 0o600);
} finally {
    if (existsSync(temporaryPath)) rmSync(temporaryPath, { force: true });
}

console.log(`[env:staging:webhook] Updated ignored ${stagingPath} for ${stagingRef}; no secret value was printed.`);
