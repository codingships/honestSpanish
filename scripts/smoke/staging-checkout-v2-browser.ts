import type { Frame, Locator, Page } from 'playwright';

const checkoutHostname = 'checkout.stripe.com';
const stagingOrigin = 'https://staging.espanolhonesto.com';
const syntheticEmailPattern = /^delivered\+hs-stg-[a-z0-9][a-z0-9-]{0,45}@resend\.dev$/u;
const probeIntervalMs = 100;

const selectors = Object.freeze({
    cardChoice: [
        '[data-testid="card-accordion-item"]',
        '[role="button"][aria-controls*="card"]',
    ],
    cardNumber: [
        'input[name="cardNumber"]',
        'input#cardNumber',
        'input[autocomplete="cc-number"]',
    ],
    country: [
        'select[name="billingCountry"]',
        'select#billingCountry',
        'select[autocomplete="country"]',
    ],
    cvc: [
        'input[name="cardCvc"]',
        'input#cardCvc',
        'input[autocomplete="cc-csc"]',
    ],
    email: [
        'input[name="email"]',
        'input#email',
        'input[autocomplete="email"]',
    ],
    expiry: [
        'input[name="cardExpiry"]',
        'input#cardExpiry',
        'input[autocomplete="cc-exp"]',
    ],
    name: [
        'input[name="billingName"]',
        'input#billingName',
        'input[autocomplete="cc-name"]',
    ],
    postalCode: [
        'input[name="billingPostalCode"]',
        'input#billingPostalCode',
        'input[autocomplete="postal-code"]',
    ],
    paymentError: [
        '[data-testid="payment-form-error"]',
        '[role="alert"]',
        '#card-errors',
    ],
    submit: [
        'button[data-testid="hosted-payment-submit-button"]',
        'button#submit',
        'button[type="submit"]',
    ],
});

export class StripeCheckoutSandboxError extends Error {
    constructor(
        public readonly code:
            | 'CHECKOUT_IDENTITY_MISMATCH'
            | 'CHECKOUT_NOT_READY'
            | 'INVALID_CHECKOUT_URL'
            | 'INVALID_SYNTHETIC_EMAIL'
            | 'RETURN_URL_MISMATCH',
        message: string,
    ) {
        super(message);
        this.name = 'StripeCheckoutSandboxError';
    }
}

export type CompleteStripeCheckoutSandboxInput = {
    afterDecline?: () => Promise<void>;
    checkoutUrl: string;
    exerciseDeclineBeforeSuccess?: boolean;
    page: Page;
    syntheticEmail: string;
    timeoutMs?: number;
};

function parseUrl(value: string): URL | null {
    try {
        return new URL(value);
    } catch {
        return null;
    }
}

export function isStripeSandboxCheckoutUrl(value: string): boolean {
    const url = parseUrl(value);
    if (
        !url
        || url.protocol !== 'https:'
        || url.hostname !== checkoutHostname
        || url.port !== ''
        || url.username !== ''
        || url.password !== ''
    ) return false;
    return url.pathname.split('/').some((segment) => segment.startsWith('cs_test_'));
}

export function isStagingCheckoutSuccessUrl(value: string): boolean {
    const url = parseUrl(value);
    if (!url || url.origin !== stagingOrigin || url.hash !== '') return false;
    if (!/^\/(?:en|es|ru)\/campus\/?$/u.test(url.pathname)) return false;
    return url.searchParams.size === 1 && url.searchParams.get('payment') === 'success';
}

function normalizedSyntheticEmail(value: string): string | null {
    const normalized = value.trim().toLowerCase();
    return syntheticEmailPattern.test(normalized) ? normalized : null;
}

async function visibleLocator(
    page: Page,
    candidateSelectors: readonly string[],
    timeoutMs: number,
): Promise<Locator | null> {
    const attempts = Math.max(1, Math.ceil(timeoutMs / probeIntervalMs));
    for (let attempt = 0; attempt < attempts; attempt += 1) {
        const frames: Frame[] = page.frames();
        for (const frame of frames) {
            for (const selector of candidateSelectors) {
                const locator = frame.locator(selector).first();
                if (await locator.isVisible().catch(() => false)) return locator;
            }
        }
        if (attempt + 1 < attempts) await page.waitForTimeout(probeIntervalMs);
    }
    return null;
}

async function requiredLocator(
    page: Page,
    candidateSelectors: readonly string[],
    label: string,
    timeoutMs: number,
): Promise<Locator> {
    const locator = await visibleLocator(page, candidateSelectors, timeoutMs);
    if (!locator) {
        throw new StripeCheckoutSandboxError(
            'CHECKOUT_NOT_READY',
            `Stripe Sandbox Checkout did not expose the ${label} control`,
        );
    }
    return locator;
}

function futureExpiry(now: Date): string {
    const year = (now.getUTCFullYear() + 3) % 100;
    return `12${String(year).padStart(2, '0')}`;
}

async function assertOrFillSyntheticEmail(locator: Locator, expected: string, timeoutMs: number): Promise<void> {
    if (await locator.isEditable().catch(() => false)) {
        await locator.fill(expected, { timeout: timeoutMs });
        return;
    }
    const current = await locator.inputValue({ timeout: timeoutMs }).catch(() => '');
    if (current.trim().toLowerCase() !== expected) {
        throw new StripeCheckoutSandboxError(
            'CHECKOUT_IDENTITY_MISMATCH',
            'Stripe Sandbox Checkout is bound to another customer email',
        );
    }
}

export async function completeStripeCheckoutSandbox(
    input: CompleteStripeCheckoutSandboxInput,
): Promise<{ completed: true; declinedPaymentObserved: boolean }> {
    if (!isStripeSandboxCheckoutUrl(input.checkoutUrl)) {
        throw new StripeCheckoutSandboxError(
            'INVALID_CHECKOUT_URL',
            'Only a hosted Stripe cs_test_ Checkout URL is allowed',
        );
    }
    const syntheticEmail = normalizedSyntheticEmail(input.syntheticEmail);
    if (!syntheticEmail) {
        throw new StripeCheckoutSandboxError(
            'INVALID_SYNTHETIC_EMAIL',
            'Only the dedicated Resend staging recipient is allowed',
        );
    }

    const timeoutMs = input.timeoutMs ?? 45_000;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 5_000 || timeoutMs > 120_000) {
        throw new StripeCheckoutSandboxError('CHECKOUT_NOT_READY', 'Checkout timeout is outside the safe range');
    }

    await input.page.goto(input.checkoutUrl, { timeout: timeoutMs, waitUntil: 'domcontentloaded' });
    if (!isStripeSandboxCheckoutUrl(input.page.url())) {
        throw new StripeCheckoutSandboxError(
            'INVALID_CHECKOUT_URL',
            'Stripe Sandbox Checkout navigated outside the allowlisted hosted checkout',
        );
    }

    const email = await visibleLocator(input.page, selectors.email, 0);
    if (email) await assertOrFillSyntheticEmail(email, syntheticEmail, timeoutMs);

    let cardNumber = await visibleLocator(input.page, selectors.cardNumber, 2_000);
    if (!cardNumber) {
        const cardChoice = await visibleLocator(input.page, selectors.cardChoice, 1_000);
        if (cardChoice) await cardChoice.click({ timeout: timeoutMs });
        cardNumber = await visibleLocator(input.page, selectors.cardNumber, timeoutMs);
    }
    if (!cardNumber) {
        throw new StripeCheckoutSandboxError(
            'CHECKOUT_NOT_READY',
            'Stripe Sandbox Checkout did not expose the card number control',
        );
    }

    const country = await visibleLocator(input.page, selectors.country, 0);
    if (country) await country.selectOption('ES', { timeout: timeoutMs });
    // Country selection can re-render Stripe's billing form. Resolve every
    // editable control again afterwards instead of retaining detached locators.
    cardNumber = await requiredLocator(input.page, selectors.cardNumber, 'card number', timeoutMs);
    const expiry = await requiredLocator(input.page, selectors.expiry, 'card expiry', timeoutMs);
    const cvc = await requiredLocator(input.page, selectors.cvc, 'card security code', timeoutMs);
    const name = await visibleLocator(input.page, selectors.name, 0);
    const postalCode = await visibleLocator(input.page, selectors.postalCode, 500);

    if (name) await name.fill('Español Honesto Staging', { timeout: timeoutMs });
    await cardNumber.fill(
        input.exerciseDeclineBeforeSuccess ? '4000000000000002' : '4242424242424242',
        { timeout: timeoutMs },
    );
    await expiry.fill(futureExpiry(new Date()), { timeout: timeoutMs });
    await cvc.fill('123', { timeout: timeoutMs });
    if (postalCode) await postalCode.fill('28001', { timeout: timeoutMs });

    let submit = await requiredLocator(input.page, selectors.submit, 'payment submit', timeoutMs);
    await submit.click({ timeout: timeoutMs });

    if (input.exerciseDeclineBeforeSuccess) {
        const paymentError = await requiredLocator(
            input.page,
            selectors.paymentError,
            'declined payment error',
            timeoutMs,
        );
        const paymentErrorText = (await paymentError.textContent({ timeout: timeoutMs }))?.trim();
        if (!paymentErrorText) {
            throw new StripeCheckoutSandboxError(
                'CHECKOUT_NOT_READY',
                'Stripe Sandbox exposed an empty payment error after the declined card',
            );
        }
        if (!isStripeSandboxCheckoutUrl(input.page.url())) {
            throw new StripeCheckoutSandboxError(
                'RETURN_URL_MISMATCH',
                'A declined Stripe Sandbox payment navigated away from hosted checkout',
            );
        }
        await input.afterDecline?.();

        // Stripe can re-render and clear the payment controls after a decline.
        // Resolve them again and complete the same Checkout Session successfully.
        cardNumber = await requiredLocator(input.page, selectors.cardNumber, 'card number', timeoutMs);
        const retryExpiry = await requiredLocator(input.page, selectors.expiry, 'card expiry', timeoutMs);
        const retryCvc = await requiredLocator(input.page, selectors.cvc, 'card security code', timeoutMs);
        await cardNumber.fill('4242424242424242', { timeout: timeoutMs });
        await retryExpiry.fill(futureExpiry(new Date()), { timeout: timeoutMs });
        await retryCvc.fill('123', { timeout: timeoutMs });
        submit = await requiredLocator(input.page, selectors.submit, 'payment submit', timeoutMs);
        await submit.click({ timeout: timeoutMs });
    }

    try {
        await input.page.waitForURL(
            (url) => isStagingCheckoutSuccessUrl(url.href),
            { timeout: timeoutMs, waitUntil: 'domcontentloaded' },
        );
    } catch {
        throw new StripeCheckoutSandboxError(
            'RETURN_URL_MISMATCH',
            'Stripe Sandbox Checkout did not return to the exact staging success URL',
        );
    }
    if (!isStagingCheckoutSuccessUrl(input.page.url())) {
        throw new StripeCheckoutSandboxError(
            'RETURN_URL_MISMATCH',
            'Stripe Sandbox Checkout finished at an unexpected URL',
        );
    }
    return {
        completed: true,
        declinedPaymentObserved: input.exerciseDeclineBeforeSuccess === true,
    };
}
