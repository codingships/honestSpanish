import { describe, expect, it, vi } from 'vitest';
import type { Frame, Locator, Page } from 'playwright';
import {
    completeStripeCheckoutSandbox,
    isStagingCheckoutSuccessUrl,
    isStripeSandboxCheckoutUrl,
} from '../../scripts/smoke/staging-checkout-v2-browser';

const checkoutUrl = 'https://checkout.stripe.com/c/pay/cs_test_staging_journey#safe-fragment';
const syntheticEmail = 'delivered+hs-stg-browser-journey@resend.dev';

type ControlKind =
    | 'cardNumber'
    | 'country'
    | 'cvc'
    | 'email'
    | 'expiry'
    | 'name'
    | 'postalCode'
    | 'submit';

function kindForSelector(selector: string): ControlKind | null {
    if (/cardNumber|cc-number/u.test(selector)) return 'cardNumber';
    if (/billingCountry|country/u.test(selector)) return 'country';
    if (/cardCvc|cc-csc/u.test(selector)) return 'cvc';
    if (/name="email"|#email|autocomplete="email"/u.test(selector)) return 'email';
    if (/cardExpiry|cc-exp/u.test(selector)) return 'expiry';
    if (/billingName|cc-name/u.test(selector)) return 'name';
    if (/billingPostalCode|postal-code/u.test(selector)) return 'postalCode';
    if (/submit/u.test(selector)) return 'submit';
    return null;
}

function checkoutPage(input: {
    lockedEmail?: string;
    missing?: ControlKind[];
    returnUrl?: string;
} = {}) {
    const missing = new Set(input.missing ?? []);
    const fills = new Map<ControlKind, string>();
    const clicks: ControlKind[] = [];
    let currentUrl = checkoutUrl;

    const controls = new Map<ControlKind, Record<string, ReturnType<typeof vi.fn>>>() as Map<
        ControlKind,
        Record<string, ReturnType<typeof vi.fn>>
    >;
    for (const kind of [
        'cardNumber', 'country', 'cvc', 'email', 'expiry', 'name', 'postalCode', 'submit',
    ] as const) {
        controls.set(kind, {
            click: vi.fn(async () => { clicks.push(kind); }),
            fill: vi.fn(async (value: string) => { fills.set(kind, value); }),
            first: vi.fn(function (this: unknown) { return this; }),
            inputValue: vi.fn(async () => input.lockedEmail ?? syntheticEmail),
            isEditable: vi.fn(async () => kind !== 'email' || input.lockedEmail === undefined),
            isVisible: vi.fn(async () => !missing.has(kind)),
            selectOption: vi.fn(async (value: string) => { fills.set(kind, value); }),
        });
    }
    const hidden = {
        click: vi.fn(),
        fill: vi.fn(),
        first: vi.fn(function (this: unknown) { return this; }),
        inputValue: vi.fn(async () => ''),
        isEditable: vi.fn(async () => false),
        isVisible: vi.fn(async () => false),
        selectOption: vi.fn(),
    };
    const frame = {
        locator: vi.fn((selector: string) => {
            const kind = kindForSelector(selector);
            return (kind ? controls.get(kind) : hidden) as unknown as Locator;
        }),
    } as unknown as Frame;
    const returnUrl = input.returnUrl ?? 'https://staging.espanolhonesto.com/en/campus?payment=success';
    const page = {
        frames: vi.fn(() => [frame]),
        goto: vi.fn(async (url: string) => { currentUrl = url; }),
        url: vi.fn(() => currentUrl),
        waitForTimeout: vi.fn(async () => undefined),
        waitForURL: vi.fn(async (predicate: (url: URL) => boolean) => {
            currentUrl = returnUrl;
            if (!predicate(new URL(currentUrl))) throw new Error('unexpected return');
        }),
    } as unknown as Page;
    return { clicks, fills, page };
}

describe('hosted Stripe Checkout Sandbox browser helper', () => {
    it('allows only hosted cs_test_ Checkout and the exact staging success destination', () => {
        expect(isStripeSandboxCheckoutUrl(checkoutUrl)).toBe(true);
        expect(isStripeSandboxCheckoutUrl('https://checkout.stripe.com/c/pay/cs_live_forbidden')).toBe(false);
        expect(isStripeSandboxCheckoutUrl('https://checkout.stripe.example/c/pay/cs_test_fake')).toBe(false);
        expect(isStagingCheckoutSuccessUrl(
            'https://staging.espanolhonesto.com/es/campus?payment=success',
        )).toBe(true);
        expect(isStagingCheckoutSuccessUrl(
            'https://espanolhonesto.com/es/campus?payment=success',
        )).toBe(false);
        expect(isStagingCheckoutSuccessUrl(
            'https://staging.espanolhonesto.com/es/campus?payment=success&session_id=secret',
        )).toBe(false);
    });

    it('fills the deterministic Stripe test card once and returns only to staging', async () => {
        const browser = checkoutPage();

        await expect(completeStripeCheckoutSandbox({
            checkoutUrl,
            page: browser.page,
            syntheticEmail,
            timeoutMs: 5_000,
        })).resolves.toEqual({ completed: true });

        expect(browser.fills.get('email')).toBe(syntheticEmail);
        expect(browser.fills.get('cardNumber')).toBe('4242424242424242');
        expect(browser.fills.get('cvc')).toBe('123');
        expect(browser.fills.get('country')).toBe('ES');
        expect(browser.fills.get('postalCode')).toBe('28001');
        expect(browser.clicks).toEqual(['submit']);
    });

    it('rejects a locked Checkout belonging to another customer before card submission', async () => {
        const browser = checkoutPage({ lockedEmail: 'another-synthetic@resend.dev' });

        await expect(completeStripeCheckoutSandbox({
            checkoutUrl,
            page: browser.page,
            syntheticEmail,
            timeoutMs: 5_000,
        })).rejects.toMatchObject({
            code: 'CHECKOUT_IDENTITY_MISMATCH',
        });
        expect(browser.clicks).toEqual([]);
        expect(browser.fills.has('cardNumber')).toBe(false);
    });

    it('fails closed when the hosted form changes or redirects away from staging', async () => {
        const missingCard = checkoutPage({ missing: ['cardNumber'] });
        await expect(completeStripeCheckoutSandbox({
            checkoutUrl,
            page: missingCard.page,
            syntheticEmail,
            timeoutMs: 5_000,
        })).rejects.toMatchObject({ code: 'CHECKOUT_NOT_READY' });
        expect(missingCard.clicks).toEqual([]);

        const wrongReturn = checkoutPage({
            returnUrl: 'https://example.test/en/campus?payment=success',
        });
        await expect(completeStripeCheckoutSandbox({
            checkoutUrl,
            page: wrongReturn.page,
            syntheticEmail,
            timeoutMs: 5_000,
        })).rejects.toMatchObject({ code: 'RETURN_URL_MISMATCH' });
        expect(wrongReturn.clicks).toEqual(['submit']);
    });
});
