/**
 * Drives the normal public purchase journey on canonical staging: landing
 * page, launch plan, real slot selector, the four explicit consents and the
 * redirect to hosted Stripe Sandbox Checkout. Nothing here bypasses the
 * public interface; the browser context must already carry the synthetic
 * student session. Staging must keep global checkout open and Turnstile on
 * Cloudflare always-pass test keys so the headless harness can present the
 * documented dummy response token.
 *
 * Turnstile is stubbed only as a headless browser harness: the public UI
 * still requires a client token, and create-checkout verifies it server-side
 * against the staging always-pass secret.
 */
import type { Page } from 'playwright';
import { isStripeSandboxCheckoutUrl } from './staging-checkout-v2-browser';

const stagingOrigin = 'https://staging.espanolhonesto.com';
const planTestId = 'select-plan-individual_4x50_28d';
const payButtonName = 'Reservar y pagar';
const requiredConsents = 4;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const stagingTurnstileToken = 'XXXX.DUMMY.TOKEN.XXXX';

export class PublicCheckoutJourneyError extends Error {
    constructor(
        public readonly code:
            | 'CONSENTS_DRIFTED'
            | 'HOSTED_CHECKOUT_MISMATCH'
            | 'INVALID_SLOT_PUBLIC_ID'
            | 'INVALID_TIMEOUT'
            | 'SLOT_NOT_LISTED',
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
            'The public journey requires the exact synthetic slot public id',
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

async function stubHeadlessTurnstile(page: Page): Promise<void> {
    await page.route('**/challenges.cloudflare.com/turnstile/**', async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/javascript',
            body: `
                window.turnstile = {
                    render: function(container, params) {
                        var target = typeof container === 'string'
                            ? document.querySelector(container)
                            : container;
                        if (target) {
                            var widget = document.createElement('div');
                            widget.dataset.mockCheckoutTurnstile = 'ready';
                            target.appendChild(widget);
                        }
                        if (params && params.callback) {
                            setTimeout(function() {
                                params.callback(${JSON.stringify(stagingTurnstileToken)});
                                document.documentElement.dataset.e2eCheckoutTurnstileReady = 'true';
                            }, 0);
                        }
                        return 'staging-checkout-widget';
                    },
                    reset: function() {},
                    remove: function() {},
                    isExpired: function() { return false; }
                };
            `,
        });
    });
}

export async function drivePublicCheckoutJourney(
    input: PublicCheckoutJourneyInput,
): Promise<{ checkoutUrl: string }> {
    const { slotPublicId, timeoutMs } = validatePublicCheckoutJourneyInput(input);
    const page = input.page;
    await stubHeadlessTurnstile(page);

    await page.goto(`${stagingOrigin}/es/`, { timeout: timeoutMs, waitUntil: 'networkidle' });

    const planButton = page.getByTestId(planTestId);
    await planButton.scrollIntoViewIfNeeded();
    await planButton.waitFor({ state: 'visible', timeout: timeoutMs });

    // The pricing island is SSR'd; clicking before hydration is a no-op. Retry
    // until the modal opens and the open public slot lane answers.
    const dialog = page.getByRole('dialog');
    const deadline = Date.now() + timeoutMs;
    let slotsPayload: {
        checkoutEnabled?: unknown;
        slots?: Array<{ publicId?: unknown }>;
    } | null = null;
    let slotsStatus = 0;
    while (Date.now() < deadline) {
        const remaining = Math.max(1_000, deadline - Date.now());
        const slotsResponsePromise = page.waitForResponse(
            (response) => {
                if (response.request().method() !== 'GET') return false;
                try {
                    return new URL(response.url()).pathname === '/api/bookable-slots';
                } catch {
                    return false;
                }
            },
            { timeout: Math.min(remaining, 15_000) },
        ).catch(() => null);
        await planButton.click({ timeout: remaining });
        const slotsResponse = await slotsResponsePromise;
        if (slotsResponse) {
            slotsStatus = slotsResponse.status();
            slotsPayload = await slotsResponse.json().catch(() => null) as {
                checkoutEnabled?: unknown;
                slots?: Array<{ publicId?: unknown }>;
            } | null;
        }
        if (await dialog.isVisible().catch(() => false)) break;
        await page.waitForTimeout(250);
    }
    if (!(await dialog.isVisible().catch(() => false))) {
        throw new PublicCheckoutJourneyError(
            'SLOT_NOT_LISTED',
            'The public pricing modal did not open after the hydrated plan selection',
        );
    }
    const listed = Array.isArray(slotsPayload?.slots)
        && slotsPayload.slots.some((slot) => slot.publicId === slotPublicId);
    if (!listed || slotsPayload?.checkoutEnabled !== true) {
        throw new PublicCheckoutJourneyError(
            'SLOT_NOT_LISTED',
            'The synthetic slot was not exposed in the open public checkout lane'
            + ` (http=${slotsStatus || 'not-observed'}, checkoutEnabled=${String(slotsPayload?.checkoutEnabled)})`,
        );
    }

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

    await page.waitForFunction(
        () => document.documentElement.dataset.e2eCheckoutTurnstileReady === 'true',
        undefined,
        { timeout: timeoutMs },
    );

    const checkoutObservation: { body: string; status: number } = { body: '', status: 0 };
    page.on('response', (response) => {
        try {
            if (new URL(response.url()).pathname !== '/api/create-checkout') return;
        } catch {
            return;
        }
        const status = response.status();
        response.text()
            .then((body) => {
                checkoutObservation.body = body.slice(0, 300);
                checkoutObservation.status = status;
            })
            .catch(() => {
                checkoutObservation.body = '(unreadable)';
                checkoutObservation.status = status;
            });
    });

    await dialog.getByRole('button', { name: payButtonName }).click({ timeout: timeoutMs });

    try {
        await page.waitForURL(
            (url) => isStripeSandboxCheckoutUrl(url.href),
            { timeout: timeoutMs, waitUntil: 'domcontentloaded' },
        );
    } catch {
        throw new PublicCheckoutJourneyError(
            'HOSTED_CHECKOUT_MISMATCH',
            'The public journey did not reach hosted Stripe Sandbox Checkout'
            + ` (page=${page.url()}`
            + `, create-checkout=${checkoutObservation.status || 'not-observed'} ${checkoutObservation.body || ''})`,
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
