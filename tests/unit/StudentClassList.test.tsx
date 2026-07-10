import React from 'react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import StudentClassList from '../../src/components/calendar/StudentClassList';

vi.mock('../../src/components/calendar/StudentCancelModal', () => ({
    default: ({
        isOpen,
        onClose,
        onSuccess,
        session,
    }: {
        isOpen: boolean;
        onClose: () => void;
        onSuccess: (sessionId: string) => void;
        session: { id: string };
    }) =>
        isOpen ? (
            <div data-testid="cancel-modal" role="dialog" aria-label="Cancelar clase">
                <button type="button" onClick={onClose}>Volver</button>
                <button type="button" onClick={() => onSuccess(session.id)}>Confirmar cancelacion</button>
            </div>
        ) : null,
}));

const mockTranslations = {
    upcoming: 'Proximas',
    past: 'Pasadas',
    noUpcoming: 'No tienes clases proximas programadas',
    noPast: 'No tienes clases pasadas',
    joinClass: 'Unirse a la clase',
    cancelClass: 'Cancelar clase',
    cancelUnavailable: 'Menos de 24h: cancelar consume la sesion',
    cancelLateNotice: 'Menos de 24h: cancelar consume la sesion.',
    linkAvailableSoon: 'Link disponible pronto',
    startingSoon: 'Empieza pronto',
    with: 'Con',
    duration: 'Duracion',
    minutes: 'minutos',
    teacherNotes: 'Notas del profesor',
    unassigned: 'Sin asignar',
    viewDocument: 'Ver documento',
    status: {
        scheduled: 'Programada',
        completed: 'Completada',
        cancelled: 'Cancelada',
        noShow: 'No asistio',
    },
};

type TestSession = React.ComponentProps<typeof StudentClassList>['upcomingSessions'][number];

let sessionCounter = 0;

const makeSession = (overrides: Partial<TestSession> = {}): TestSession => ({
    id: overrides.id || `session-${++sessionCounter}`,
    scheduled_at: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
    duration_minutes: 50,
    status: 'scheduled',
    meet_link: 'https://meet.google.com/abc-def',
    drive_doc_url: null,
    teacher_notes: null,
    teacher: {
        id: 'teacher-1',
        full_name: 'Maria Garcia',
        email: 'maria@test.com',
    },
    ...overrides,
});

beforeEach(() => {
    sessionCounter = 0;
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    vi.setSystemTime(new Date('2026-02-18T12:00:00.000Z'));
});

afterEach(() => {
    cleanup();
    vi.useRealTimers();
});

describe('StudentClassList - tabs', () => {
    it('renders semantic tabs and defaults to the upcoming panel', () => {
        render(
            <StudentClassList
                upcomingSessions={[]}
                pastSessions={[]}
                lang="es"
                translations={mockTranslations}
            />
        );

        const upcomingTab = screen.getByRole('tab', { name: /Proximas \(0\)/ });
        const pastTab = screen.getByRole('tab', { name: /Pasadas \(0\)/ });
        expect(upcomingTab).toHaveAttribute('aria-selected', 'true');
        expect(pastTab).toHaveAttribute('aria-selected', 'false');
        expect(screen.getByRole('tabpanel', { name: /Proximas/ })).toHaveTextContent(mockTranslations.noUpcoming);
    });

    it('switches to the past tab on click', () => {
        render(
            <StudentClassList
                upcomingSessions={[]}
                pastSessions={[]}
                lang="es"
                translations={mockTranslations}
            />
        );

        fireEvent.click(screen.getByRole('tab', { name: /Pasadas/ }));
        expect(screen.getByRole('tab', { name: /Pasadas/ })).toHaveAttribute('aria-selected', 'true');
        expect(screen.getByRole('tabpanel', { name: /Pasadas/ })).toHaveTextContent(mockTranslations.noPast);
    });

    it('does not render corrupted visible symbols in tabs or status badges', () => {
        const { container } = render(
            <StudentClassList
                upcomingSessions={[makeSession({ scheduled_at: new Date(Date.now() + 23 * 60 * 60 * 1000).toISOString() })]}
                pastSessions={[]}
                lang="es"
                translations={mockTranslations}
            />
        );

        expect(container.textContent).not.toMatch(/(?:Ã|Â|â|ðŸ)/);
    });
});

describe('StudentClassList - session card rendering', () => {
    it('renders teacher name on session card', () => {
        render(
            <StudentClassList
                upcomingSessions={[makeSession()]}
                pastSessions={[]}
                lang="es"
                translations={mockTranslations}
            />
        );
        expect(screen.getByText('Maria Garcia')).toBeInTheDocument();
    });

    it('renders session status badge', () => {
        const session = makeSession({
            scheduled_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
            status: 'completed',
        });
        render(
            <StudentClassList
                upcomingSessions={[]}
                pastSessions={[session]}
                lang="es"
                translations={mockTranslations}
            />
        );
        fireEvent.click(screen.getByRole('tab', { name: /Pasadas/ }));
        expect(screen.getByText(mockTranslations.status.completed)).toBeInTheDocument();
    });

    it('shows "unassigned" when teacher is null', () => {
        render(
            <StudentClassList
                upcomingSessions={[makeSession({ teacher: null })]}
                pastSessions={[]}
                lang="es"
                translations={mockTranslations}
            />
        );
        expect(screen.getByText(mockTranslations.unassigned)).toBeInTheDocument();
    });

    it('uses the localized document link label', () => {
        render(
            <StudentClassList
                upcomingSessions={[makeSession({ drive_doc_url: 'https://drive.google.com/doc' })]}
                pastSessions={[]}
                lang="es"
                translations={mockTranslations}
            />
        );

        expect(screen.getByRole('link', { name: /Ver documento/ })).toHaveAttribute('href', 'https://drive.google.com/doc');
    });
});

describe('StudentClassList - prop and local-state sync', () => {
    it('syncs upcoming sessions when the parent provides a refreshed list', async () => {
        const first = makeSession({
            id: 'session-old',
            teacher: { id: 'teacher-old', full_name: 'Old Teacher', email: 'old@test.com' },
        });
        const second = makeSession({
            id: 'session-new',
            teacher: { id: 'teacher-new', full_name: 'New Teacher', email: 'new@test.com' },
        });

        const { rerender } = render(
            <StudentClassList
                upcomingSessions={[first]}
                pastSessions={[]}
                lang="es"
                translations={mockTranslations}
            />
        );

        expect(screen.getByText('Old Teacher')).toBeInTheDocument();

        rerender(
            <StudentClassList
                upcomingSessions={[second]}
                pastSessions={[]}
                lang="es"
                translations={mockTranslations}
            />
        );

        await waitFor(() => expect(screen.queryByText('Old Teacher')).not.toBeInTheDocument());
        expect(screen.getByText('New Teacher')).toBeInTheDocument();
    });

    it('moves a cancelled upcoming session into the past list once', async () => {
        const session = makeSession({
            id: 'session-cancel',
            scheduled_at: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
        });

        render(
            <StudentClassList
                upcomingSessions={[session]}
                pastSessions={[]}
                lang="es"
                translations={mockTranslations}
            />
        );

        fireEvent.click(screen.getByRole('button', { name: /Cancelar clase/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Confirmar cancelacion' }));

        await waitFor(() => expect(screen.getByRole('tab', { name: /Proximas \(0\)/ })).toBeInTheDocument());
        fireEvent.click(screen.getByRole('tab', { name: /Pasadas \(1\)/ }));
        expect(screen.getByText(mockTranslations.status.cancelled)).toBeInTheDocument();
        expect(screen.getAllByText('Maria Garcia')).toHaveLength(1);
    });
});

describe('StudentClassList - canCancel logic', () => {
    it('shows cancel button when session is 25h away', () => {
        const session = makeSession({
            scheduled_at: new Date(Date.now() + 25 * 60 * 60 * 1000).toISOString(),
            status: 'scheduled',
        });
        render(
            <StudentClassList
                upcomingSessions={[session]}
                pastSessions={[]}
                lang="es"
                translations={mockTranslations}
            />
        );
        expect(screen.getByRole('button', { name: /Cancelar clase/ })).toBeInTheDocument();
    });

    it('keeps cancellation available at 23h and warns that the class is consumed', () => {
        const session = makeSession({
            scheduled_at: new Date(Date.now() + 23 * 60 * 60 * 1000).toISOString(),
            status: 'scheduled',
        });
        render(
            <StudentClassList
                upcomingSessions={[session]}
                pastSessions={[]}
                lang="es"
                translations={mockTranslations}
            />
        );
        expect(screen.getByRole('button', { name: /Cancelar clase/ })).toBeInTheDocument();
        expect(screen.getByText(mockTranslations.cancelLateNotice)).toBeInTheDocument();
    });

    it('hides cancel button when status is cancelled', () => {
        const session = makeSession({
            scheduled_at: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
            status: 'cancelled',
        });
        render(
            <StudentClassList
                upcomingSessions={[session]}
                pastSessions={[]}
                lang="es"
                translations={mockTranslations}
            />
        );
        expect(screen.queryByRole('button', { name: /Cancelar clase/ })).toBeNull();
    });

    it('clicking cancel button opens the cancel modal', () => {
        const session = makeSession({
            scheduled_at: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
            status: 'scheduled',
        });
        render(
            <StudentClassList
                upcomingSessions={[session]}
                pastSessions={[]}
                lang="es"
                translations={mockTranslations}
            />
        );
        fireEvent.click(screen.getByRole('button', { name: /Cancelar clase/ }));
        expect(screen.getByTestId('cancel-modal')).toBeInTheDocument();
    });

    it('clicking Volver in modal closes it', () => {
        const session = makeSession({
            scheduled_at: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
            status: 'scheduled',
        });
        render(
            <StudentClassList
                upcomingSessions={[session]}
                pastSessions={[]}
                lang="es"
                translations={mockTranslations}
            />
        );
        fireEvent.click(screen.getByRole('button', { name: /Cancelar clase/ }));
        expect(screen.getByTestId('cancel-modal')).toBeInTheDocument();
        fireEvent.click(screen.getByText('Volver'));
        expect(screen.queryByTestId('cancel-modal')).toBeNull();
    });
});

describe('StudentClassList - canJoin logic', () => {
    it('shows join button when session starts in 14 min and has meet link', () => {
        const session = makeSession({
            scheduled_at: new Date(Date.now() + 14 * 60 * 1000).toISOString(),
            status: 'scheduled',
            meet_link: 'https://meet.google.com/test',
        });
        render(
            <StudentClassList
                upcomingSessions={[session]}
                pastSessions={[]}
                lang="es"
                translations={mockTranslations}
            />
        );
        expect(screen.getByRole('link', { name: /Unirse a la clase/ })).toHaveAttribute('href', 'https://meet.google.com/test');
    });

    it('refreshes the join state when a class enters the 15 minute window', () => {
        vi.setSystemTime(new Date('2026-02-18T09:43:00.000Z'));
        const session = makeSession({
            scheduled_at: '2026-02-18T10:00:00.000Z',
            status: 'scheduled',
            meet_link: 'https://meet.google.com/test',
        });

        render(
            <StudentClassList
                upcomingSessions={[session]}
                pastSessions={[]}
                lang="es"
                translations={mockTranslations}
            />
        );

        expect(screen.queryByRole('link', { name: /Unirse a la clase/ })).toBeNull();
        expect(screen.getByRole('status', { name: /Link disponible pronto/ })).toBeInTheDocument();

        act(() => {
            vi.advanceTimersByTime(3 * 60 * 1000);
        });

        expect(screen.getByRole('link', { name: /Unirse a la clase/ })).toHaveAttribute('href', 'https://meet.google.com/test');
    });

    it('hides join button when session starts in 30 min and shows the availability notice', () => {
        const session = makeSession({
            scheduled_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
            status: 'scheduled',
            meet_link: 'https://meet.google.com/test',
        });
        render(
            <StudentClassList
                upcomingSessions={[session]}
                pastSessions={[]}
                lang="es"
                translations={mockTranslations}
            />
        );
        expect(screen.queryByRole('link', { name: /Unirse a la clase/ })).toBeNull();
        expect(screen.getByRole('status', { name: /Link disponible pronto/ })).toBeInTheDocument();
    });

    it('hides join button when session has no meet link', () => {
        const session = makeSession({
            scheduled_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
            status: 'scheduled',
            meet_link: null,
        });
        render(
            <StudentClassList
                upcomingSessions={[session]}
                pastSessions={[]}
                lang="es"
                translations={mockTranslations}
            />
        );
        expect(screen.queryByRole('link', { name: /Unirse a la clase/ })).toBeNull();
    });

    it('keeps join button available when a 50 min session is overrunning', () => {
        const session = makeSession({
            scheduled_at: new Date(Date.now() - 90 * 60 * 1000).toISOString(),
            status: 'scheduled',
            meet_link: 'https://meet.google.com/test',
        });
        render(
            <StudentClassList
                upcomingSessions={[session]}
                pastSessions={[]}
                lang="es"
                translations={mockTranslations}
            />
        );
        expect(screen.getByRole('link', { name: /Unirse a la clase/ })).toBeInTheDocument();
    });

    it('hides join button after the duration plus overrun window has passed', () => {
        const session = makeSession({
            scheduled_at: new Date(Date.now() - 171 * 60 * 1000).toISOString(),
            duration_minutes: 50,
            status: 'scheduled',
            meet_link: 'https://meet.google.com/test',
        });
        render(
            <StudentClassList
                upcomingSessions={[session]}
                pastSessions={[]}
                lang="es"
                translations={mockTranslations}
            />
        );
        expect(screen.queryByRole('link', { name: /Unirse a la clase/ })).toBeNull();
    });
});

describe('StudentClassList - isStartingSoon logic', () => {
    it('shows "starting soon" badge when session is 23h away', () => {
        const session = makeSession({
            scheduled_at: new Date(Date.now() + 23 * 60 * 60 * 1000).toISOString(),
            status: 'scheduled',
        });
        render(
            <StudentClassList
                upcomingSessions={[session]}
                pastSessions={[]}
                lang="es"
                translations={mockTranslations}
            />
        );
        expect(screen.getByText(new RegExp(mockTranslations.startingSoon))).toBeInTheDocument();
    });

    it('does not show "starting soon" badge when session is 25h away', () => {
        const session = makeSession({
            scheduled_at: new Date(Date.now() + 25 * 60 * 60 * 1000).toISOString(),
            status: 'scheduled',
        });
        render(
            <StudentClassList
                upcomingSessions={[session]}
                pastSessions={[]}
                lang="es"
                translations={mockTranslations}
            />
        );
        expect(screen.queryByText(new RegExp(mockTranslations.startingSoon))).toBeNull();
    });
});

describe('StudentClassList - page integration contract', () => {
    it('passes the localized document label from the classes page', () => {
        const pageSource = readFileSync(
            path.join(process.cwd(), 'src/pages/[lang]/campus/classes.astro'),
            'utf8'
        );

        expect(pageSource).toContain("viewDocument: t('campus.student.classes.viewDocument')");
    });
});
