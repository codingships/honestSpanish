import { createHash } from 'node:crypto';

export const STAGING_PORTAL_SMOKE = {
    supabaseProjectRef: 'mzjyvmlxfpzdfdjzxxyj',
    stripeAccountId: 'acct_1TruqOC22M3erP0j',
    webOrigin: 'https://staging.espanolhonesto.com',
    workerIdentity: 'espanolhonesto-staging',
    source: 'espanol-honesto-staging-portal-smoke',
    trialDays: 14,
} as const;

export const STAGING_PORTAL_SMOKE_APPROVAL_ENV = 'STAGING_PORTAL_SMOKE_APPROVAL';
export const STAGING_PORTAL_SMOKE_APPROVAL = 'Autorizo ejecutar una unica prueba real del Stripe Customer Portal contra `https://staging.espanolhonesto.com`, usando exclusivamente Supabase staging `mzjyvmlxfpzdfdjzxxyj`, Stripe test `acct_1TruqOC22M3erP0j`, la configuracion Portal fijada en `.env.staging` y la cuenta existente `TEST_STUDENT_*`. Autorizo crear un Customer test temporal y una Subscription test en trial sin metodo de pago ni cobro, enlazar temporalmente solo `profiles_private` y una fila minima de `subscriptions`, iniciar sesion mediante Playwright, abrir el Portal desde el boton real, cancelar la renovacion desde la interfaz hospedada, verificar la fecha de cancelacion y el retorno seguro, y limpiar exactamente los recursos temporales de Stripe y Supabase incluso si falla la prueba. Acepto solo los webhooks reales producidos por esas acciones y su limpieza exacta; no autorizo webhooks sinteticos, Resend ni otros emails, Checkout, pagos, Stripe live, produccion, Cloudflare, deploys, DNS, dominios ni ningun otro cambio externo.';

export const STAGING_PORTAL_SMOKE_REQUIRED_ENV = [
    'PUBLIC_APP_ENV',
    'PUBLIC_SITE_URL',
    'PUBLIC_SUPABASE_URL',
    'SUPABASE_EXPECTED_PROJECT_REF',
    'PUBLIC_SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
    'STRIPE_SECRET_KEY',
    'PUBLIC_STRIPE_PUBLISHABLE_KEY',
    'STRIPE_EXPECTED_ACCOUNT_ID',
    'STRIPE_PORTAL_CONFIGURATION_ID',
    'INTERNAL_JOB_SECRET',
    'CHECKOUT_ENABLED',
    'CHECKOUT_ENABLED_OVERRIDE',
    'TEST_STUDENT_EMAIL',
    'TEST_STUDENT_PASSWORD',
] as const;

export type PortalSmokeLang = 'es' | 'en';

export interface PortalConfigSnapshot {
    id: string;
    active: boolean;
    livemode: boolean;
    defaultReturnUrl: string | null;
    paymentMethodUpdateEnabled: boolean;
    invoiceHistoryEnabled: boolean;
    subscriptionCancelEnabled: boolean;
    subscriptionCancelMode: string;
    subscriptionCancelProration: string;
    subscriptionUpdateEnabled: boolean;
}

export interface TrialSubscriptionSnapshot {
    status: string;
    livemode: boolean;
    customerId: string;
    expectedCustomerId: string;
    itemCount: number;
    priceId: string;
    expectedPriceId: string;
    periodEnd: number | null;
    trialEnd: number | null;
    cancelAtPeriodEnd: boolean;
    cancelAt: number | null;
    missingPaymentMethodBehavior: string | null;
    paymentMethodCount: number;
    paymentIntentCount: number;
    chargeCount: number;
    invoiceAmountDue: number | null;
    invoiceAmountPaid: number | null;
    invoiceTotal: number | null;
}

export interface CancellationSnapshot {
    status: string;
    periodEnd: number | null;
    trialEnd: number | null;
    cancelAtPeriodEnd: boolean;
    cancelAt: number | null;
}

export interface OwnershipSnapshot {
    source: string | undefined;
    runId: string | undefined;
    expectedRunId: string;
    livemode: boolean;
}

export interface ValidationResult {
    valid: boolean;
    details: string[];
}

export const PORTAL_CANCEL_ACTION_NAMES = [
    /cancel subscription/iu,
    /cancel plan/iu,
    /continue (?:to )?cancel/iu,
    /cancelar (?:la |el )?suscripci[oó]n/iu,
    /cancelar (?:el )?plan/iu,
    /continuar (?:con la )?cancelaci[oó]n/iu,
] as const;

export const PORTAL_CONTINUE_ACTION_NAMES = [
    /^continue$/iu,
    /^next$/iu,
    /^continuar$/iu,
    /^siguiente$/iu,
] as const;

export const PORTAL_COOKIE_REJECT_NAMES = [
    /reject all/iu,
    /rechazar todo/iu,
] as const;

export function validateStagingPortalSmokeEnv(env: Record<string, string | undefined>): ValidationResult {
    const details: string[] = [];
    for (const key of STAGING_PORTAL_SMOKE_REQUIRED_ENV) {
        if (!env[key]?.trim()) details.push(`${key}=missing`);
    }
    if (env.PUBLIC_APP_ENV?.trim() !== 'staging') details.push('PUBLIC_APP_ENV must be staging');
    if (env.PUBLIC_SITE_URL?.trim() !== STAGING_PORTAL_SMOKE.webOrigin) {
        details.push('PUBLIC_SITE_URL must be the exact staging origin');
    }
    if (env.PUBLIC_SUPABASE_URL?.trim() !== `https://${STAGING_PORTAL_SMOKE.supabaseProjectRef}.supabase.co`) {
        details.push('PUBLIC_SUPABASE_URL must identify exact staging');
    }
    if (env.SUPABASE_EXPECTED_PROJECT_REF?.trim() !== STAGING_PORTAL_SMOKE.supabaseProjectRef) {
        details.push('SUPABASE_EXPECTED_PROJECT_REF must identify exact staging');
    }
    if (env.STRIPE_EXPECTED_ACCOUNT_ID?.trim() !== STAGING_PORTAL_SMOKE.stripeAccountId) {
        details.push('STRIPE_EXPECTED_ACCOUNT_ID must identify the exact staging test account');
    }
    if (!env.STRIPE_SECRET_KEY?.trim().startsWith('sk_test_')) details.push('STRIPE_SECRET_KEY must be test mode');
    if (!env.PUBLIC_STRIPE_PUBLISHABLE_KEY?.trim().startsWith('pk_test_')) {
        details.push('PUBLIC_STRIPE_PUBLISHABLE_KEY must be test mode');
    }
    if (!/^bpc_[A-Za-z0-9_]+$/u.test(env.STRIPE_PORTAL_CONFIGURATION_ID?.trim() ?? '')) {
        details.push('STRIPE_PORTAL_CONFIGURATION_ID must be a Portal configuration ID');
    }
    if (env.CHECKOUT_ENABLED?.trim() !== 'false' || env.CHECKOUT_ENABLED_OVERRIDE?.trim() !== 'false') {
        details.push('checkout must remain false in both local staging gates');
    }
    const studentEmail = env.TEST_STUDENT_EMAIL?.trim().toLowerCase() ?? '';
    if (!studentEmail || studentEmail.endsWith('@example.com')) details.push('TEST_STUDENT_EMAIL must be the existing real test inbox');
    if ((env.TEST_STUDENT_PASSWORD?.trim().length ?? 0) < 6) details.push('TEST_STUDENT_PASSWORD is missing or shorter than the application minimum');

    return { valid: details.length === 0, details };
}

export function validatePortalConfig(snapshot: PortalConfigSnapshot, expectedConfigurationId: string): ValidationResult {
    const details: string[] = [];
    if (snapshot.id !== expectedConfigurationId) details.push('Portal configuration ID mismatch');
    if (!snapshot.active) details.push('Portal configuration is inactive');
    if (snapshot.livemode) details.push('Portal configuration is live mode');
    if (!snapshot.paymentMethodUpdateEnabled) details.push('payment method update is disabled');
    if (!snapshot.invoiceHistoryEnabled) details.push('invoice history is disabled');
    if (!snapshot.subscriptionCancelEnabled) details.push('subscription cancellation is disabled');
    if (snapshot.subscriptionCancelMode !== 'at_period_end') details.push('subscription cancellation is not at period end');
    if (snapshot.subscriptionCancelProration !== 'none') details.push('subscription cancellation proration is not none');
    if (snapshot.subscriptionUpdateEnabled) details.push('subscription plan changes must remain disabled');
    if (snapshot.defaultReturnUrl) {
        try {
            const target = new URL(snapshot.defaultReturnUrl);
            if (target.origin !== STAGING_PORTAL_SMOKE.webOrigin) details.push('Portal default return URL leaves staging');
        } catch {
            details.push('Portal default return URL is invalid');
        }
    }
    return { valid: details.length === 0, details };
}

export function validateTrialSubscription(snapshot: TrialSubscriptionSnapshot, nowUnix: number): ValidationResult {
    const details: string[] = [];
    if (snapshot.status !== 'trialing') details.push('subscription is not trialing');
    if (snapshot.livemode) details.push('subscription is live mode');
    if (snapshot.customerId !== snapshot.expectedCustomerId) details.push('subscription customer mismatch');
    if (snapshot.itemCount !== 1) details.push('subscription must have exactly one item');
    if (snapshot.priceId !== snapshot.expectedPriceId) details.push('subscription price mismatch');
    if (!Number.isInteger(snapshot.periodEnd) || (snapshot.periodEnd ?? 0) <= nowUnix) details.push('period end is invalid');
    if (!Number.isInteger(snapshot.trialEnd) || (snapshot.trialEnd ?? 0) < nowUnix + 7 * 86_400) {
        details.push('trial end is too early to guarantee cleanup before billing');
    }
    if (snapshot.cancelAtPeriodEnd || snapshot.cancelAt !== null) details.push('subscription starts pre-cancelled');
    if (snapshot.missingPaymentMethodBehavior !== 'cancel') details.push('missing payment method must cancel at trial end');
    if (snapshot.paymentMethodCount !== 0) details.push('temporary customer has a payment method');
    if (snapshot.paymentIntentCount !== 0) details.push('trial created a PaymentIntent');
    if (snapshot.chargeCount !== 0) details.push('trial created a charge');
    for (const [label, amount] of [
        ['invoice amount due', snapshot.invoiceAmountDue],
        ['invoice amount paid', snapshot.invoiceAmountPaid],
        ['invoice total', snapshot.invoiceTotal],
    ] as const) {
        if (amount !== null && amount !== 0) details.push(`${label} is not zero`);
    }
    return { valid: details.length === 0, details };
}

export function validateCancellation(snapshot: CancellationSnapshot): ValidationResult {
    const details: string[] = [];
    if (snapshot.status !== 'trialing' && snapshot.status !== 'active') {
        details.push('subscription is no longer active/trialing after scheduled cancellation');
    }
    const expectedEnd = snapshot.trialEnd ?? snapshot.periodEnd;
    if (!expectedEnd || !Number.isInteger(expectedEnd)) details.push('expected cancellation boundary is missing');
    const scheduledByDate = Boolean(
        snapshot.cancelAt
        && expectedEnd
        && Math.abs(snapshot.cancelAt - expectedEnd) <= 1,
    );
    if (!snapshot.cancelAtPeriodEnd && !scheduledByDate) {
        details.push('neither cancel_at_period_end nor an exact period-end cancel_at is set');
    }
    if (snapshot.cancelAt && expectedEnd && Math.abs(snapshot.cancelAt - expectedEnd) > 1) {
        details.push('cancel_at does not match the trial/period end');
    }
    return { valid: details.length === 0, details };
}

export function validateOwnedStripeResource(snapshot: OwnershipSnapshot): ValidationResult {
    const details: string[] = [];
    if (snapshot.source !== STAGING_PORTAL_SMOKE.source) details.push('resource source marker mismatch');
    if (snapshot.runId !== snapshot.expectedRunId) details.push('resource run marker mismatch');
    if (snapshot.livemode) details.push('owned resource unexpectedly uses live mode');
    return { valid: details.length === 0, details };
}

export function validateSafeReturnUrl(value: string, lang: PortalSmokeLang): ValidationResult {
    const details: string[] = [];
    try {
        const target = new URL(value);
        if (target.origin !== STAGING_PORTAL_SMOKE.webOrigin) details.push('return origin mismatch');
        if (target.pathname !== `/${lang}/campus/account`) details.push('return path mismatch');
        if (target.search || target.hash || target.username || target.password) details.push('return URL contains unexpected components');
    } catch {
        details.push('return URL is invalid');
    }
    return { valid: details.length === 0, details };
}

export function resolvePortalSmokeLang(value: string | undefined): PortalSmokeLang {
    return value?.trim().toLowerCase() === 'en' ? 'en' : 'es';
}

export function fingerprintPortalSmokeValue(value: string | null | undefined): string | null {
    return value ? `sha256:${createHash('sha256').update(value).digest('hex')}` : null;
}

export function sanitizePortalSmokeText(value: unknown): string {
    return String(value)
        .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu, '[redacted-email]')
        .replace(/\b(?:sk|pk)_(?:test|live)_[A-Za-z0-9_]+\b/gu, '[redacted-stripe-key]')
        .replace(/\bwhsec_[A-Za-z0-9_]+\b/gu, '[redacted-webhook-secret]')
        .replace(/\bsb_(?:secret|publishable)_[A-Za-z0-9_-]+\b/gu, '[redacted-supabase-key]')
        .replace(/\beyJ[A-Za-z0-9._-]+\b/gu, '[redacted-token]')
        .replace(/https:\/\/billing\.stripe\.com\/p\/session\/[^\s"']+/giu, '[redacted-portal-session-url]')
        .replace(/(password|authorization|cookie)\s*[=:]\s*[^\s,;]+/giu, '$1=[redacted]');
}
