/**
 * Session Modal Components Tests
 * 
 * Tests for:
 * - SessionDetailModal - viewing session details
 * - ScheduleSessionModal - scheduling new sessions
 * - StudentCancelModal - cancelling sessions
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../setup';
import SessionDetailModal from '../../src/components/calendar/SessionDetailModal';
import ScheduleSessionModal from '../../src/components/calendar/ScheduleSessionModal';
import StudentCancelModal from '../../src/components/calendar/StudentCancelModal';

// Mock window.location.reload and assign
Object.defineProperty(window, 'location', {
    configurable: true,
    value: { reload: vi.fn(), assign: vi.fn(), href: 'http://localhost:3000' },
});

// Mock translations behaving like the real ones
const mockTranslations = {
    sessionDetails: {
        title: 'Detalles de la Sesión',
        date: 'Fecha',
        time: 'Hora',
        duration: 'Duración',
        status: 'Estado',
        teacher: 'Profesor',
        student: 'Estudiante',
        meetLink: 'Enlace de la reunión',
        notes: 'Notas',
        close: 'Cerrar',
        cancelSession: 'Cancelar Clase',
        markComplete: 'Marcar como completada',
        markNoShow: 'Marcar como no asistió',
        scheduled: 'Programada',
        completed: 'Completada',
        cancelled: 'Cancelada',
        noShow: 'No asistió',
        addNotes: 'AÑADIR NOTAS',
    },
    schedule: {
        scheduleClass: 'PROGRAMAR CLASE',
        selectStudent: 'SELECCIONAR ESTUDIANTE',
        selectDate: 'SELECCIONAR FECHA',
        selectTime: 'SELECCIONAR HORA',
        confirm: 'CONFIRMAR',
        cancel: 'CANCELAR',
        noSlots: 'No hay slots disponibles',
    },
    cancel: {
        cancelClass: 'CANCELAR CLASE',
        cancelConfirm: '¿Estás seguro?',
        cancelWarning: 'Esta acción no se puede deshacer',
        confirm: 'Sí, cancelar',
        cancel: 'No, cerrar',
        close: 'Cerrar',
        with: 'Con',
        message: '¿Estás seguro que deseas cancelar esta clase?',
    },
};

describe('Session Modal Tests', () => {

    beforeEach(() => {
        vi.clearAllMocks();
        // Default handlers used by most tests
        server.resetHandlers(
            http.post('http://localhost:3000/api/calendar/session-action', () => {
                return HttpResponse.json({ success: true });
            }),
            http.post('http://localhost:3000/api/calendar/sessions', () => {
                return HttpResponse.json({ success: true, session: { id: 'new-session' } });
            }),
            http.get('http://localhost:3000/api/calendar/available-slots', () => {
                return HttpResponse.json({ slots: [] });
            })
        );
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date(2026, 0, 14, 12, 0, 0));
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    describe('SessionDetailModal', () => {

        const mockSession = {
            id: 'session-1',
            scheduled_at: new Date('2026-01-15T10:00:00').toISOString(),
            duration_minutes: 60,
            status: 'scheduled',
            meet_link: 'https://meet.google.com/abc-defg-hij',
            teacher_notes: 'Focus on past tense',
            teacher: {
                id: 'teacher-1',
                full_name: 'María García',
                email: 'maria@test.com',
            },
            student: {
                id: 'student-1',
                full_name: 'John Doe',
                email: 'john@test.com',
            },
        };

        it('should display session info', () => {
            render(
                <SessionDetailModal
                    isOpen={true}
                    onClose={() => { }}
                    session={mockSession}
                    lang="es"
                    translations={mockTranslations.sessionDetails}
                    onSessionUpdate={() => { }}
                    canEdit={false}
                />
            );

            expect(screen.getAllByText(/John Doe|john@test.com/).length).toBeGreaterThan(0);
            expect(screen.getByText(/meet.google.com/)).toBeDefined();
            expect(screen.getByText('Programada')).toBeDefined();
        });

        it('should show actions when canEdit is true', () => {
            render(
                <SessionDetailModal
                    isOpen={true}
                    onClose={() => { }}
                    session={mockSession}
                    lang="es"
                    translations={mockTranslations.sessionDetails}
                    onSessionUpdate={() => { }}
                    canEdit={true}
                />
            );

            // "Cancelar Clase" button should be visible for scheduled session
            expect(screen.getByText(mockTranslations.sessionDetails.cancelSession)).toBeDefined();
        });

        it('should perform action when button clicked', async () => {
            let requestBody: any;
            server.use(
                http.post('http://localhost:3000/api/calendar/session-action', async ({ request }) => {
                    requestBody = await request.json();
                    return HttpResponse.json({ success: true });
                })
            );

            render(
                <SessionDetailModal
                    isOpen={true}
                    onClose={() => { }}
                    session={mockSession}
                    lang="es"
                    translations={mockTranslations.sessionDetails}
                    onSessionUpdate={() => { }}
                    canEdit={true}
                />
            );

            fireEvent.click(screen.getByText(mockTranslations.sessionDetails.cancelSession));

            await waitFor(() => {
                expect(requestBody).toBeDefined();
                expect(requestBody?.action).toBe('cancel');
            });
        });

        it('matches snapshot', () => {
            const { asFragment } = render(
                <SessionDetailModal
                    isOpen={true}
                    onClose={() => { }}
                    session={mockSession}
                    lang="es"
                    translations={mockTranslations.sessionDetails}
                    onSessionUpdate={() => { }}
                    canEdit={true}
                />
            );
            expect(asFragment()).toMatchSnapshot();
        });
    });

    describe('ScheduleSessionModal', () => {

        const mockStudents = [
            { id: 'student-1', full_name: 'John Doe', email: 'john@test.com' },
        ];

        it('should render initial state', () => {
            render(
                <ScheduleSessionModal
                    isOpen={true}
                    onClose={() => { }}
                    students={mockStudents}
                    teacherId="teacher-1"
                    lang="es"
                    translations={mockTranslations.schedule}
                    onSessionCreated={() => { }}
                />
            );

            expect(screen.getByText(mockTranslations.schedule.scheduleClass)).toBeDefined();
            expect(screen.getByText('John Doe')).toBeDefined(); // Inside option
        });

        it('should fetch slots when date selected', async () => {
            let fetchCalled = false;
            server.use(
                http.get('http://localhost:3000/api/calendar/available-slots', () => {
                    fetchCalled = true;
                    return HttpResponse.json({
                        slots: [{ slot_start: '2026-01-15T10:00:00', slot_end: '2026-01-15T11:00:00' }]
                    });
                })
            );

            render(
                <ScheduleSessionModal
                    isOpen={true}
                    onClose={() => { }}
                    students={mockStudents}
                    teacherId="teacher-1"
                    lang="es"
                    translations={mockTranslations.schedule}
                    onSessionCreated={() => { }}
                />
            );

            // Need to select student first to proceed (step 1 -> 2)
            fireEvent.change(screen.getByRole('combobox'), { target: { value: 'student-1' } });
            fireEvent.click(screen.getByText(/Continuar/i));

            // Step 2: Select date
            const dateInput = screen.getByDisplayValue(''); // Input type date
            fireEvent.change(dateInput, { target: { value: '2026-01-15' } });

            // Should trigger fetch
            await waitFor(() => {
                expect(fetchCalled).toBe(true);
            });
        });
    });

    describe('StudentCancelModal', () => {

        const mockSession = {
            id: 'session-1',
            scheduled_at: '2026-01-14T12:00:00.000Z', // Fixed ISO date for consistent snapshots
            teacher: {
                full_name: 'Teacher',
                email: 't@test.com'
            }
        };

        it('should call cancel API on confirm', async () => {
            let requestBody: any;
            server.use(
                http.post('http://localhost:3000/api/calendar/session-action', async ({ request }) => {
                    requestBody = await request.json();
                    return HttpResponse.json({ success: true });
                })
            );

            render(
                <StudentCancelModal
                    isOpen={true}
                    onClose={() => { }}
                    session={mockSession}
                    lang="es"
                    translations={mockTranslations.cancel}
                    onSuccess={() => { }}
                />
            );

            const confirmButton = screen.getByText(mockTranslations.cancel.confirm);
            fireEvent.click(confirmButton);

            await waitFor(() => {
                expect(requestBody).toBeDefined();
                expect(requestBody?.action).toBe('cancel');
            });
        });
        it('matches snapshot', () => {
            const { asFragment } = render(
                <StudentCancelModal
                    isOpen={true}
                    onClose={() => { }}
                    session={mockSession}
                    lang="es"
                    translations={mockTranslations.cancel}
                    onSuccess={() => { }}
                />
            );
            expect(asFragment()).toMatchSnapshot();
        });
    });

    // Add snapshots for other modals in their respective describe blocks
    // We need to target specific lines for those, but since I'm editing the end of the file, 
    // I'll just add one for StudentCancelModal here and use separate calls for the others if needed,
    // OR arguably since I have the context of the whole file structure I can try to find the other closing braces.
    // However, replace_file_content works best on contiguous blocks. 
    // Let's stick to adding to the last block (StudentCancelModal) for now and I'll do a separate edit for the others if I can't reach them easily or if I want to be safe.
    // Actually, I can use multi_replace to target multiple locations!
});
