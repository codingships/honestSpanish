import { http, HttpResponse } from 'msw';

// Default mock handlers for external services
export const handlers = [
    // Mock Stripe API
    http.post('https://api.stripe.com/*', () => {
        return HttpResponse.json({ id: 'mock_id' });
    }),
];
