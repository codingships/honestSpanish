import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import AvailabilityManager from '../../src/components/calendar/AvailabilityManager';
import { server } from '../setup';

const mockTranslations = {
    dayNames: ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'],
    addSlot: 'Añadir horario',
    removeSlot: 'Eliminar',
    from: 'Desde',
    to: 'Hasta',
    save: 'Guardar',
    cancel: 'Cancelar',
    noSlots: 'Sin horarios',
    day: 'Día',
    slotAdded: 'Horario añadido correctamente',
    slotRemoved: 'Horario eliminado',
    errorAdding: 'Error al añadir el horario',
    errorRemoving: 'Error al eliminar el horario',
    invalidTimeRange: 'La hora final debe ser posterior a la inicial',
};

const makeSlot = (overrides: Record<string, unknown> = {}) => ({
    id: `slot-${Math.random().toString(36).slice(2)}`,
    day_of_week: 1,
    start_time: '09:00:00',
    end_time: '10:00:00',
    is_active: true,
    ...overrides,
});

const defaultProps = {
    initialAvailability: [],
    teacherId: 'teacher-1',
    lang: 'es',
    translations: mockTranslations,
};

describe('AvailabilityManager — initial render', () => {
    it('renders all 7 day columns', () => {
        render(<AvailabilityManager {...defaultProps} />);
        // Days are rendered as headers
        expect(screen.getByText('Lun')).toBeDefined();
        expect(screen.getByText('Mar')).toBeDefined();
        expect(screen.getByText('Dom')).toBeDefined();
    });

    it('shows noSlots message when no availability', () => {
        render(<AvailabilityManager {...defaultProps} />);
        const noSlotsMessages = screen.getAllByText(mockTranslations.noSlots);
        expect(noSlotsMessages.length).toBeGreaterThan(0);
    });

    it('renders existing slots grouped by day', () => {
        const slots = [
            makeSlot({ id: 'slot-1', day_of_week: 1, start_time: '09:00:00', end_time: '10:00:00' }),
            makeSlot({ id: 'slot-2', day_of_week: 3, start_time: '14:00:00', end_time: '15:00:00' }),
        ];
        render(<AvailabilityManager {...defaultProps} initialAvailability={slots} />);
        expect(screen.getByText('09:00 - 10:00')).toBeDefined();
        expect(screen.getByText('14:00 - 15:00')).toBeDefined();
    });

    it('renders the "Añadir horario" button', () => {
        render(<AvailabilityManager {...defaultProps} />);
        expect(screen.getByText(/Añadir horario/)).toBeDefined();
    });
});

describe('AvailabilityManager — add slot form', () => {
    it('clicking "Añadir horario" shows the form', () => {
        render(<AvailabilityManager {...defaultProps} />);
        fireEvent.click(screen.getByText(/Añadir horario/));
        expect(screen.getByText('Guardar')).toBeDefined();
        expect(screen.getByText('Cancelar')).toBeDefined();
        expect(screen.getByLabelText(mockTranslations.day)).toBeDefined();
        expect(screen.getByLabelText(mockTranslations.from)).toBeDefined();
        expect(screen.getByLabelText(mockTranslations.to)).toBeDefined();
    });

    it('clicking "Cancelar" in form hides the form', () => {
        render(<AvailabilityManager {...defaultProps} />);
        fireEvent.click(screen.getByText(/Añadir horario/));
        fireEvent.click(screen.getByText('Cancelar'));
        expect(screen.queryByText('Guardar')).toBeNull();
    });

    it('blocks an invalid time range before submitting', () => {
        render(<AvailabilityManager {...defaultProps} />);
        fireEvent.click(screen.getByText(/Añadir horario/));

        fireEvent.change(screen.getByLabelText(mockTranslations.from), { target: { value: '11:00' } });
        fireEvent.change(screen.getByLabelText(mockTranslations.to), { target: { value: '10:00' } });

        expect(screen.getByRole('alert')).toHaveTextContent(mockTranslations.invalidTimeRange);
        expect(screen.getByRole('button', { name: mockTranslations.save })).toBeDisabled();
    });

    it('submitting form calls POST /api/teacher/availability and shows success message', async () => {
        server.use(
            http.post('http://localhost:3000/api/teacher/availability', () => {
                return HttpResponse.json({
                    availability: {
                        id: 'new-slot-1',
                        day_of_week: 1,
                        start_time: '10:00:00',
                        end_time: '11:00:00',
                        is_active: true,
                    },
                });
            })
        );

        render(<AvailabilityManager {...defaultProps} />);
        fireEvent.click(screen.getByText(/Añadir horario/));
        fireEvent.click(screen.getByText('Guardar'));

        await waitFor(() => {
            expect(screen.getByRole('status')).toHaveTextContent(mockTranslations.slotAdded);
        });
    });

    it('shows error message when POST /api/teacher/availability fails', async () => {
        server.use(
            http.post('http://localhost:3000/api/teacher/availability', () => {
                return new HttpResponse(null, { status: 500 });
            })
        );

        render(<AvailabilityManager {...defaultProps} />);
        fireEvent.click(screen.getByText(/Añadir horario/));
        fireEvent.click(screen.getByText('Guardar'));

        await waitFor(() => {
            expect(screen.getByRole('alert')).toHaveTextContent(mockTranslations.errorAdding);
        });
    });
});

describe('AvailabilityManager — remove slot', () => {
    beforeEach(() => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
    });
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('clicking × calls DELETE /api/teacher/availability and removes the slot', async () => {
        server.use(
            http.delete('http://localhost:3000/api/teacher/availability', () => {
                return HttpResponse.json({ success: true });
            })
        );

        const slot = makeSlot({ id: 'slot-to-delete', day_of_week: 1, start_time: '09:00:00', end_time: '10:00:00' });
        render(<AvailabilityManager {...defaultProps} initialAvailability={[slot]} />);

        // The slot should be visible
        expect(screen.getByText('09:00 - 10:00')).toBeDefined();

        // Click the × button
        const removeBtn = screen.getByRole('button', { name: `${mockTranslations.removeSlot}: 09:00 - 10:00` });
        fireEvent.click(removeBtn);

        await waitFor(() => {
            expect(screen.getByRole('status')).toHaveTextContent(mockTranslations.slotRemoved);
        });
    });

    it('shows error message when DELETE fails', async () => {
        server.use(
            http.delete('http://localhost:3000/api/teacher/availability', () => {
                return new HttpResponse(null, { status: 500 });
            })
        );

        const slot = makeSlot({ id: 'slot-fail', day_of_week: 2, start_time: '11:00:00', end_time: '12:00:00' });
        render(<AvailabilityManager {...defaultProps} initialAvailability={[slot]} />);

        fireEvent.click(screen.getByRole('button', { name: `${mockTranslations.removeSlot}: 11:00 - 12:00` }));

        await waitFor(() => {
            expect(screen.getByRole('alert')).toHaveTextContent(mockTranslations.errorRemoving);
        });
    });
});
