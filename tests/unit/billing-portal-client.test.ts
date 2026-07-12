import { describe, expect, it, vi } from 'vitest';
import { openBillingPortal } from '../../src/lib/billing-portal-client';

function portalButton() {
    const button = document.createElement('button');
    button.textContent = 'Gestionar suscripción';
    return button;
}

describe('openBillingPortal', () => {
    it('navigates on success and restores the original button state', async () => {
        const button = portalButton();
        const navigate = vi.fn();
        const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
            url: 'https://billing.stripe.com/session/test-session',
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        }));

        await openBillingPortal({ button, fetcher, navigate });

        expect(navigate).toHaveBeenCalledWith('https://billing.stripe.com/session/test-session');
        expect(button.textContent).toBe('Gestionar suscripción');
        expect(button.disabled).toBe(false);
        expect(button.hasAttribute('aria-busy')).toBe(false);
    });

    it('rejects a non-OK response and restores the label, disabled state and aria state', async () => {
        const button = portalButton();
        button.setAttribute('aria-busy', 'false');
        const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 503 }));

        await expect(openBillingPortal({ button, fetcher, navigate: vi.fn() }))
            .rejects.toThrow('Could not open the billing portal');

        expect(button.textContent).toBe('Gestionar suscripción');
        expect(button.disabled).toBe(false);
        expect(button.getAttribute('aria-busy')).toBe('false');
    });

    it('rejects an unsafe URL and restores a pre-disabled button', async () => {
        const button = portalButton();
        button.disabled = true;
        const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
            url: 'javascript:alert(1)',
        }), { status: 200 }));

        await expect(openBillingPortal({ button, fetcher, navigate: vi.fn() }))
            .rejects.toThrow('safe URL');

        expect(button.textContent).toBe('Gestionar suscripción');
        expect(button.disabled).toBe(true);
    });
});
