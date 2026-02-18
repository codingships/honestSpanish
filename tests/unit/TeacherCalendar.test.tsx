import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import TeacherCalendar from '../../src/components/calendar/TeacherCalendar';

vi.mock('../../src/components/calendar/ScheduleSessionModal', () => ({
    default: ({ isOpen }: { isOpen: boolean }) =>
        isOpen ? <div data-testid="schedule-modal">Schedule Modal</div> : null,
}));

vi.mock('../../src/components/calendar/SessionDetailModal', () => ({
    default: ({ isOpen }: { isOpen: boolean }) =>
        isOpen ? <div data-testid="session-detail-modal">Session Detail Modal</div> : null,
}));

const mockTranslations = {
    today: 'Hoy',
    scheduleClass: 'Programar clase',
    dayNames: ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'],
    scheduled: 'Programada',
    completed: 'Completada',
    noShow: 'No asistió',
    cancelled: 'Cancelada',
};

const makeSession = (overrides: Record<string, unknown> = {}) => ({
    id: `session-${Math.random().toString(36).slice(2)}`,
    scheduled_at: new Date().toISOString(),
    duration_minutes: 60,
    status: 'scheduled',
    meet_link: null,
    teacher_notes: null,
    student: {
        id: 'student-1',
        full_name: 'Ana López',
        email: 'ana@test.com',
    },
    ...overrides,
});

const defaultProps = {
    sessions: [],
    students: [{ id: 'student-1', full_name: 'Ana López', email: 'ana@test.com' }],
    teacherId: 'teacher-1',
    lang: 'es',
    translations: mockTranslations,
};

describe('TeacherCalendar — header and navigation', () => {
    beforeEach(() => {
        vi.useFakeTimers({ toFake: ['Date'] });
        // Monday 2026-02-16
        vi.setSystemTime(new Date('2026-02-16T10:00:00.000Z'));
    });
    afterEach(() => vi.useRealTimers());

    it('renders the "Hoy" button', () => {
        render(<TeacherCalendar {...defaultProps} />);
        expect(screen.getByText('Hoy')).toBeDefined();
    });

    it('renders the "Programar clase" button', () => {
        render(<TeacherCalendar {...defaultProps} />);
        expect(screen.getByText(/Programar clase/)).toBeDefined();
    });

    it('renders previous and next week navigation buttons', () => {
        render(<TeacherCalendar {...defaultProps} />);
        expect(screen.getByText('←')).toBeDefined();
        expect(screen.getByText('→')).toBeDefined();
    });

    it('goToNextWeek advances the displayed week range', () => {
        render(<TeacherCalendar {...defaultProps} />);
        const initialText = document.body.textContent;
        fireEvent.click(screen.getByText('→'));
        const newText = document.body.textContent;
        // The week range text should have changed
        expect(newText).not.toBe(initialText);
    });

    it('goToPrevWeek moves the displayed week back', () => {
        render(<TeacherCalendar {...defaultProps} />);
        const initialText = document.body.textContent;
        fireEvent.click(screen.getByText('←'));
        const newText = document.body.textContent;
        expect(newText).not.toBe(initialText);
    });

    it('clicking "Hoy" after navigating returns to current week range', () => {
        render(<TeacherCalendar {...defaultProps} />);
        const initialText = document.body.textContent;
        // Go forward 2 weeks
        fireEvent.click(screen.getByText('→'));
        fireEvent.click(screen.getByText('→'));
        expect(document.body.textContent).not.toBe(initialText);
        // Return to today
        fireEvent.click(screen.getByText('Hoy'));
        expect(document.body.textContent).toBe(initialText);
    });
});

describe('TeacherCalendar — schedule modal', () => {
    beforeEach(() => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2026-02-16T10:00:00.000Z'));
    });
    afterEach(() => vi.useRealTimers());

    it('schedule modal is not visible initially', () => {
        render(<TeacherCalendar {...defaultProps} />);
        expect(screen.queryByTestId('schedule-modal')).toBeNull();
    });

    it('clicking "Programar clase" opens the schedule modal', () => {
        render(<TeacherCalendar {...defaultProps} />);
        fireEvent.click(screen.getByText(/Programar clase/));
        expect(screen.getByTestId('schedule-modal')).toBeDefined();
    });
});

describe('TeacherCalendar — session rendering', () => {
    beforeEach(() => {
        vi.useFakeTimers({ toFake: ['Date'] });
        // Monday 2026-02-16
        vi.setSystemTime(new Date('2026-02-16T10:00:00.000Z'));
    });
    afterEach(() => vi.useRealTimers());

    it('renders a session in the current week', () => {
        const session = makeSession({
            // Wednesday of the same week
            scheduled_at: '2026-02-18T15:00:00.000Z',
            student: { id: 'student-1', full_name: 'Ana López', email: 'ana@test.com' },
        });
        render(<TeacherCalendar {...defaultProps} sessions={[session]} />);
        expect(screen.getByText('Ana López')).toBeDefined();
    });

    it('does not render a session from the previous week', () => {
        const session = makeSession({
            scheduled_at: '2026-02-09T15:00:00.000Z', // previous week
            student: { id: 'student-1', full_name: 'Estudiante Previo', email: 'prev@test.com' },
        });
        render(<TeacherCalendar {...defaultProps} sessions={[session]} />);
        expect(screen.queryByText('Estudiante Previo')).toBeNull();
    });

    it('renders all 7 day header columns', () => {
        render(<TeacherCalendar {...defaultProps} />);
        // Each day shows its abbreviated name
        const dayAbbrs = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
        dayAbbrs.forEach(abbr => {
            const matches = screen.getAllByText(new RegExp(abbr, 'i'));
            expect(matches.length).toBeGreaterThan(0);
        });
    });
});
