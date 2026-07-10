import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import NextClassCard from '../../src/components/calendar/NextClassCard';

const translations = {
    nextClass: 'Proxima clase',
    noClasses: 'No tienes clases proximas',
    joinClass: 'Unirse a la clase',
    with: 'Con',
    in: 'en',
    viewAll: 'Ver todas',
    viewDocument: 'Ver documento',
    unassigned: 'Sin asignar',
    now: 'Ahora',
};

const makeSession = (scheduledAt: string, overrides: Record<string, unknown> = {}) => ({
    id: 'session-1',
    scheduled_at: scheduledAt,
    duration_minutes: 50,
    status: 'scheduled',
    meet_link: 'https://meet.google.com/abc-defg-hij',
    drive_doc_url: null,
    teacher: {
        full_name: 'Maria Garcia',
        email: 'maria@example.com',
    },
    ...overrides,
});

describe('NextClassCard', () => {
    beforeEach(() => {
        vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
        vi.setSystemTime(new Date('2026-02-18T12:00:00.000Z'));
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('renders an empty-state card with a stable selector for browser tests', () => {
        render(<NextClassCard session={null} lang="es" translations={translations} />);

        expect(screen.getByTestId('next-class-card')).toHaveClass('next-class-card');
        expect(screen.getByText(translations.nextClass)).toBeInTheDocument();
        expect(screen.getByText(translations.noClasses)).toBeInTheDocument();
        expect(screen.queryByRole('link', { name: /unirse/i })).toBeNull();
    });

    it('does not expose the Meet link 30 minutes before class', () => {
        const session = makeSession(new Date(Date.now() + 30 * 60 * 1000).toISOString());

        render(<NextClassCard session={session} lang="es" translations={translations} />);

        expect(screen.queryByRole('link', { name: /unirse a la clase/i })).toBeNull();
        expect(screen.getByRole('link', { name: translations.viewAll })).toHaveAttribute('href', '/es/campus/classes');
    });

    it('exposes the Meet link inside the 15 minute join window', () => {
        const session = makeSession(new Date(Date.now() + 14 * 60 * 1000).toISOString());

        render(<NextClassCard session={session} lang="es" translations={translations} />);

        expect(screen.getByRole('link', { name: /unirse a la clase/i })).toHaveAttribute('href', 'https://meet.google.com/abc-defg-hij');
    });

    it('updates the join state while the dashboard remains open', () => {
        const session = makeSession(new Date(Date.now() + 30 * 60 * 1000).toISOString());

        render(<NextClassCard session={session} lang="es" translations={translations} />);

        expect(screen.queryByRole('link', { name: /unirse a la clase/i })).toBeNull();

        act(() => {
            vi.advanceTimersByTime(16 * 60 * 1000);
        });

        expect(screen.getByRole('link', { name: /unirse a la clase/i })).toHaveAttribute('href', 'https://meet.google.com/abc-defg-hij');
    });

    it('renders document and teacher fallback links with accessible names', () => {
        const session = makeSession(new Date(Date.now() + 14 * 60 * 1000).toISOString(), {
            drive_doc_url: 'https://drive.google.com/doc',
            teacher: null,
        });

        render(<NextClassCard session={session} lang="es" translations={translations} />);

        expect(screen.getByText(translations.unassigned)).toBeInTheDocument();
        expect(screen.getByRole('link', { name: translations.viewDocument })).toHaveAttribute('href', 'https://drive.google.com/doc');
    });
});
