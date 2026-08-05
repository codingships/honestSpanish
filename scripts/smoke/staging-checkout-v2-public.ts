/**
 * Drives the normal public purchase journey on canonical staging: landing
 * page, launch plan, real slot selector, the four explicit consents and the
 * redirect to hosted Stripe Sandbox Checkout. Nothing here bypasses the
 * public interface; the browser context must already carry the synthetic
 * student session and the private staging checkout grant cookies.
 */
import type { Page } from 'playwright';
import { isStripeSandboxCheckoutUrl } from './staging-checkout-v2-browser';

const stagingOrigin = 'https://staging.espanolhonesto.com';
const planTestId = 'select-plan-individual_4x50_28d';
const payButtonName = 'Reservar y pagar';
const requiredConsents = 4;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export class PublicCheckoutJourneyError extends Error {
    constructor(
        public readonly code:
            | 'CONSENTS_DRIFTED'
            | 'HOSTED_CHECKOUT_MISMATCH'
            | 'INVALID_SLOT_PUBLIC_ID'
            | 'INVALID_TIMEOUT',
        message: string,
    ) {
        super(message);
        this.name = 'PublicCheckoutJourneyError';
    }
}

export type PublicCheckoutJourneyInput = {
    page: Page;
    slotPublicId: string;
    timeoutMs?: number;
};

export function validatePublicCheckoutJourneyInput(
    input: Pick<PublicCheckoutJourneyInput, 'slotPublicId' | 'timeoutMs'>,
): { slotPublicId: string; timeoutMs: number } {
    if (!uuidPattern.test(input.slotPublicId)) {
        throw new PublicCheckoutJourneyError(
            'INVALID_SLOT_PUBLIC_ID',
            'The public journey requires the exact granted slot public id',
        );
    }
    const timeoutMs = input.timeoutMs ?? 90_000;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 5_000 || timeoutMs > 120_000) {
        throw new PublicCheckoutJourneyError(
            'INVALID_TIMEOUT',
            'Public journey timeout is outside the safe range',
        );
    }
    return { slotPublicId: input.slotPublicId, timeoutMs };
}

export async function drivePublicCheckoutJourney(
    input: PublicCheckoutJourneyInput,
): Promise<{ checkoutUrl: string }> {
    const { slotPublicId, timeoutMs } = validatePublicCheckoutJourneyInput(input);
    const page = input.page;

    await page.goto(`${stagingOrigin}/es/`, { timeout: timeoutMs, waitUntil: 'domcontentloaded' });
    await page.getByTestId(planTestId).click({ timeout: timeoutMs });

    const dialog = page.getByRole('dialog');
    const slotRadio = dialog.locator(
        `input[type="radio"][name="bookable-slot"][value="${slotPublicId}"]`,
    );
    await slotRadio.check({ timeout: timeoutMs });

    const consents = dialog.getByRole('checkbox');
    await consents.first().waitFor({ state: 'visible', timeout: timeoutMs });
    if (await consents.count() !== requiredConsents) {
        throw new PublicCheckoutJourneyError(
            'CONSENTS_DRIFTED',
            'The public checkout no longer exposes exactly the four explicit consents',
        );
    }
    for (let index = 0; index < requiredConsents; index += 1) {
        await consents.nth(index).check({ timeout: timeoutMs });
    }

    // The staging Turnstile test key resolves automatically; Playwright waits
    // for the pay button to become actionable before clicking.
    await dialog.getByRole('button', { name: payButtonName }).click({ timeout: timeoutMs });

    try {
        await page.waitForURL(
            (url) => isStripeSandboxCheckoutUrl(url.href),
            { timeout: timeoutMs, waitUntil: 'domcontentloaded' },
        );
    } catch {
        throw new PublicCheckoutJourneyError(
            'HOSTED_CHECKOUT_MISMATCH',
            'The public journey did not reach hosted Stripe Sandbox Checkout',
        );
    }
    const checkoutUrl = page.url();
    if (!isStripeSandboxCheckoutUrl(checkoutUrl)) {
        throw new PublicCheckoutJourneyError(
            'HOSTED_CHECKOUT_MISMATCH',
            'The public journey finished at an unexpected URL',
        );
    }
    return { checkoutUrl };
}
