type BillingPortalResponse = {
    url?: unknown;
};

type OpenBillingPortalOptions = {
    button: HTMLButtonElement;
    fetcher?: typeof fetch;
    navigate?: (url: string) => void;
};

export async function openBillingPortal({
    button,
    fetcher = fetch,
    navigate = (url) => window.location.assign(url),
}: OpenBillingPortalOptions): Promise<void> {
    const originalText = button.textContent;
    const wasDisabled = button.disabled;
    const originalAriaBusy = button.getAttribute('aria-busy');

    button.textContent = '...';
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');

    try {
        const response = await fetcher('/api/account/create-portal-session', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
        });

        if (!response.ok) {
            throw new Error('Could not open the billing portal');
        }

        const data = await response.json() as BillingPortalResponse;
        let portalUrl: URL;
        try {
            portalUrl = new URL(typeof data.url === 'string' ? data.url : '');
        } catch {
            throw new Error('Billing portal response did not contain a safe URL');
        }

        if (portalUrl.protocol !== 'https:' || portalUrl.hostname !== 'billing.stripe.com') {
            throw new Error('Billing portal response did not contain a safe URL');
        }

        navigate(portalUrl.toString());
    } finally {
        button.textContent = originalText;
        button.disabled = wasDisabled;
        if (originalAriaBusy === null) {
            button.removeAttribute('aria-busy');
        } else {
            button.setAttribute('aria-busy', originalAriaBusy);
        }
    }
}
