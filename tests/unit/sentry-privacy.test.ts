import { describe, expect, it } from 'vitest';
import type { Breadcrumb, Event } from '@sentry/astro';
import { scrubSentryBreadcrumb, scrubSentryEvent } from '../../src/lib/sentry-privacy';

describe('Sentry privacy boundary', () => {
    it('removes identity, request payloads, secrets and URL parameters', () => {
        const event = scrubSentryEvent({
            message: 'Failure for learner@example.com from 192.0.2.15 with token=private',
            transaction: '/es/diagnostico?email=learner@example.com',
            user: { id: 'student-1', email: 'learner@example.com' },
            request: {
                url: 'https://example.com/es/diagnostico?email=learner@example.com',
                query_string: 'email=learner@example.com',
                cookies: { session: 'private' },
                data: { email: 'learner@example.com', answer: 'private' },
                headers: { authorization: 'Bearer private-token' },
            },
            extra: {
                requestId: 'private-request-id',
                note: 'Contact learner@example.com',
            },
        } as Event);

        expect(event.user).toBeUndefined();
        expect(event.request).toEqual({ url: '/es/diagnostico' });
        expect(event.transaction).toBe('/es/diagnostico');
        expect(event.message).toBe('Failure for [redacted-email] from [redacted-ip] with token=[redacted]');
        expect(event.extra).toEqual({
            requestId: 'private-request-id',
            note: 'Contact [redacted-email]',
        });
        expect(JSON.stringify(event)).not.toContain('learner@example.com');
        expect(JSON.stringify(event)).not.toContain('private-token');
        expect(JSON.stringify(event)).not.toContain('192.0.2.15');
    });

    it('drops console breadcrumbs and strips parameters from navigation breadcrumbs', () => {
        expect(scrubSentryBreadcrumb({ category: 'console', message: 'learner@example.com' })).toBeNull();

        const breadcrumb = scrubSentryBreadcrumb({
            category: 'navigation',
            message: 'to learner@example.com',
            data: { url: 'https://example.com/es?email=learner@example.com' },
        } as Breadcrumb);

        expect(breadcrumb).toEqual({
            category: 'navigation',
            message: 'to [redacted-email]',
            data: { url: '/es' },
        });
    });
});
