import { pathToFileURL } from 'node:url';

export const STAGING_DEPLOY_TARGET = {
    supabaseProjectRef: 'mzjyvmlxfpzdfdjzxxyj',
    supabaseUrl: 'https://mzjyvmlxfpzdfdjzxxyj.supabase.co',
    stripeAccountId: 'acct_1TruqOC22M3erP0j',
    stripeCountry: 'ES',
    stripeCurrency: 'eur',
    siteUrl: 'https://staging.espanolhonesto.com',
    turnstileSiteKey: '1x00000000000000000000AA',
} as const;

type FetchLike = typeof fetch;

export interface StagingProviderIdentity {
    supabaseProjectRef: string;
    stripeAccountId: string;
    stripeCountry: string;
    stripeCurrency: string;
}

export function validateStagingDeployEnvironment(env: NodeJS.ProcessEnv): string[] {
    const errors: string[] = [];
    const supabaseUrl = env.PUBLIC_SUPABASE_URL?.trim() ?? '';
    try {
        const parsed = new URL(supabaseUrl);
        if (parsed.href !== `${STAGING_DEPLOY_TARGET.supabaseUrl}/`) {
            errors.push(`PUBLIC_SUPABASE_URL must equal ${STAGING_DEPLOY_TARGET.supabaseUrl}.`);
        }
    } catch {
        errors.push('PUBLIC_SUPABASE_URL must be a valid HTTPS URL.');
    }
    requirePublicCredential(env.PUBLIC_SUPABASE_ANON_KEY, 'PUBLIC_SUPABASE_ANON_KEY', errors);
    requirePrefix(env.PUBLIC_STRIPE_PUBLISHABLE_KEY, 'PUBLIC_STRIPE_PUBLISHABLE_KEY', 'pk_test_', errors);
    requirePrefix(env.STRIPE_SECRET_KEY, 'STRIPE_SECRET_KEY', 'sk_test_', errors);
    requirePrefix(env.STRIPE_WEBHOOK_SECRET, 'STRIPE_WEBHOOK_SECRET', 'whsec_', errors);
    if (env.PUBLIC_SITE_URL?.trim() !== STAGING_DEPLOY_TARGET.siteUrl) {
        errors.push(`PUBLIC_SITE_URL must equal ${STAGING_DEPLOY_TARGET.siteUrl}.`);
    }
    if (env.PUBLIC_TURNSTILE_SITE_KEY?.trim() !== STAGING_DEPLOY_TARGET.turnstileSiteKey) {
        errors.push('PUBLIC_TURNSTILE_SITE_KEY must be the canonical Turnstile test key.');
    }
    return errors;
}

export async function verifyStagingDeployProviders(
    env: NodeJS.ProcessEnv,
    fetchImpl: FetchLike = fetch,
): Promise<StagingProviderIdentity> {
    const errors = validateStagingDeployEnvironment(env);
    if (errors.length > 0) throw new Error(`Staging deploy environment rejected: ${errors.join(' ')}`);

    const supabaseUrl = env.PUBLIC_SUPABASE_URL!.trim();
    const supabaseAnonKey = env.PUBLIC_SUPABASE_ANON_KEY!.trim();
    const supabaseResponse = await fetchImpl(`${supabaseUrl}/auth/v1/settings`, {
        method: 'GET',
        headers: {
            apikey: supabaseAnonKey,
            Authorization: `Bearer ${supabaseAnonKey}`,
        },
        signal: AbortSignal.timeout(15_000),
    });
    if (!supabaseResponse.ok) {
        throw new Error(`Supabase staging identity GET failed with status ${supabaseResponse.status}.`);
    }

    const stripeSecretKey = env.STRIPE_SECRET_KEY!.trim();
    const stripeResponse = await fetchImpl('https://api.stripe.com/v1/account', {
        method: 'GET',
        headers: { Authorization: `Bearer ${stripeSecretKey}` },
        signal: AbortSignal.timeout(15_000),
    });
    if (!stripeResponse.ok) {
        throw new Error(`Stripe staging identity GET failed with status ${stripeResponse.status}.`);
    }
    const stripe = await stripeResponse.json() as Record<string, unknown>;
    const stripeAccountId = typeof stripe.id === 'string' ? stripe.id : '';
    const stripeCountry = typeof stripe.country === 'string' ? stripe.country.toUpperCase() : '';
    const stripeCurrency = typeof stripe.default_currency === 'string' ? stripe.default_currency.toLowerCase() : '';
    if (stripeAccountId !== STAGING_DEPLOY_TARGET.stripeAccountId
        || stripeCountry !== STAGING_DEPLOY_TARGET.stripeCountry
        || stripeCurrency !== STAGING_DEPLOY_TARGET.stripeCurrency) {
        throw new Error('Stripe staging identity does not match the exact Sandbox account, country and currency.');
    }

    return {
        supabaseProjectRef: STAGING_DEPLOY_TARGET.supabaseProjectRef,
        stripeAccountId,
        stripeCountry,
        stripeCurrency,
    };
}

function requirePublicCredential(value: string | undefined, name: string, errors: string[]): void {
    const normalized = value?.trim() ?? '';
    if (normalized.length < 20 || /(?:placeholder|example|changeme|your[_-])/iu.test(normalized)) {
        errors.push(`${name} is missing or placeholder-like.`);
    }
}

function requirePrefix(value: string | undefined, name: string, prefix: string, errors: string[]): void {
    const normalized = value?.trim() ?? '';
    if (!normalized.startsWith(prefix) || normalized.length <= prefix.length + 8) {
        errors.push(`${name} must be a non-placeholder ${prefix} credential.`);
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const identity = await verifyStagingDeployProviders(process.env);
    console.log(
        `[verify-staging-deploy-environment] Supabase=${identity.supabaseProjectRef}; `
        + `Stripe=${identity.stripeAccountId}/${identity.stripeCountry}/${identity.stripeCurrency}; secrets withheld.`,
    );
}
