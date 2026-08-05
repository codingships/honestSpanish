import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

vi.mock('../../src/components/calendar/AvailabilityManager', () => ({
    default: ({ teacherId, initialAvailability, onAvailabilityChange }: { teacherId: string; initialAvailability: unknown[]; onAvailabilityChange?: (value: unknown[]) => void }) => (
        <div data-testid="availability-manager" data-teacher={teacherId} data-count={initialAvailability.length}>
            <button type="button" onClick={() => onAvailabilityChange?.([])}>Mock clear availability</button>
        </div>
    ),
}));

import TeacherSlotManager from '../../src/components/admin/TeacherSlotManager';

const layout = readFileSync('src/layouts/CampusLayout.astro', 'utf8');
const page = readFileSync('src/pages/[lang]/campus/admin/teachers.astro', 'utf8');

const response = (payload: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
}));

const teacher = {
    id: '11111111-1111-4111-8111-111111111111',
    fullName: 'Irene Example',
    email: 'irene@example.com',
    currentEngagement: { engagementKind: 'founder' },
    availability: [{ id: 'window-1', dayOfWeek: 1, startTime: '09:00:00', endTime: '12:00:00' }],
};

const occurrence = (index: number) => ({
    index,
    startsAt: `2026-08-${String(3 + ((index - 1) * 7)).padStart(2, '0')}T07:00:00.000Z`,
    durationMinutes: 50,
});

const slot = (overrides: Record<string, unknown> = {}) => ({
    id: '22222222-2222-4222-8222-222222222222',
    publicId: 'place-public-1',
    teacherId: teacher.id,
    status: 'draft',
    weekday: 1,
    localStartTime: '09:00:00',
    firstOccurrenceAt: '2026-08-03T07:00:00.000Z',
    occurrences: [occurrence(1), occurrence(2), occurrence(3), occurrence(4)],
    hasLiveHold: false,
    ...overrides,
});

const payload = (slots = [slot()]) => ({
    package: { name: 'initial_individual', displayName: { es: '4 clases individuales', en: '4 individual classes', ru: '4 индивидуальных занятия' } },
    teachers: [teacher],
    slots,
});

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('admin teachers and bookable places surface', () => {
    it('is reachable only through the localized admin campus shell', () => {
        expect(layout).toContain('/campus/admin/teachers');
        expect(layout).toContain('Profesores y plazas');
        expect(layout).toContain('Teachers & bookable places');
        expect(layout).toContain('Преподаватели и места');
        expect(page).toContain("profile.role !== 'admin'");
        expect(page).toContain('<TeacherSlotManager client:load');
    });

    it('keeps weekly availability separate from sellable places and adapts the API shape', async () => {
        vi.stubGlobal('fetch', vi.fn(() => response(payload())));
        render(<TeacherSlotManager lang="es" />);

        expect(await screen.findByRole('heading', { name: 'Disponibilidad semanal' })).toBeInTheDocument();
        expect(screen.getByText(/Esto no publica ninguna plaza de venta\./)).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'Plazas vendibles' })).toBeInTheDocument();
        expect(screen.getByTestId('availability-manager')).toHaveAttribute('data-teacher', teacher.id);
        expect(screen.getByTestId('availability-manager')).toHaveAttribute('data-count', '1');
        fireEvent.click(screen.getByRole('button', { name: 'Mock clear availability' }));
        expect(screen.getByTestId('availability-manager')).toHaveAttribute('data-count', '0');
        expect(screen.getByText('Sin disponibilidad semanal')).toBeInTheDocument();
    });

    it('localizes the operational surface in Russian', async () => {
        vi.stubGlobal('fetch', vi.fn(() => response(payload([]))));
        render(<TeacherSlotManager lang="ru" />);

        expect(await screen.findByRole('heading', { name: 'Еженедельная доступность' })).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'Места для продажи' })).toBeInTheDocument();
        expect(screen.getByText('У этого преподавателя пока нет мест.')).toBeInTheDocument();
    });

    it('invites a teacher without granting the role in the same action', async () => {
        const fetchMock = vi.fn()
            .mockImplementationOnce(() => response(payload()))
            .mockImplementationOnce(() => response({ state: 'sent', profileId: 'new-profile' }, 202));
        vi.stubGlobal('fetch', fetchMock);
        render(<TeacherSlotManager lang="en" />);

        const section = (await screen.findByRole('heading', { name: 'Invite a new teacher' })).closest('section')!;
        fireEvent.change(within(section).getByLabelText('Full name'), { target: { value: 'New Teacher' } });
        fireEvent.change(within(section).getByLabelText('Account email'), { target: { value: 'new@example.test' } });
        fireEvent.change(within(section).getByLabelText('Documented reason'), { target: { value: 'Approved teacher onboarding' } });
        fireEvent.click(within(section).getByRole('button', { name: 'Send invitation' }));

        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
        expect(JSON.parse(String((fetchMock.mock.calls[1]?.[1] as RequestInit).body))).toMatchObject({
            target: 'teacher',
            email: 'new@example.test',
            fullName: 'New Teacher',
            lang: 'en',
            reason: 'Approved teacher onboarding',
        });
        expect(await screen.findByRole('status')).toHaveTextContent('Invitation sent.');
    });

    it('blocks pause and retire while an available place has a live hold', async () => {
        vi.stubGlobal('fetch', vi.fn(() => response(payload([slot({ status: 'available', hasLiveHold: true })]))));
        render(<TeacherSlotManager lang="en" />);

        expect(await screen.findByText('Temporarily reserved')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Pause' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Retire' })).toBeDisabled();
        expect(screen.queryByRole('button', { name: 'Publish' })).not.toBeInTheDocument();
    });

    it('requires an explicit confirmation before publishing a draft', async () => {
        const fetchMock = vi.fn()
            .mockImplementationOnce(() => response(payload()))
            .mockImplementationOnce(() => response({ result: { ok: true } }))
            .mockImplementationOnce(() => response(payload([slot({ status: 'available' })])));
        vi.stubGlobal('fetch', fetchMock);
        render(<TeacherSlotManager lang="es" />);

        fireEvent.click(await screen.findByRole('button', { name: 'Publicar' }));
        expect(screen.getByRole('heading', { name: 'Confirmar acción: Publicar' })).toBeInTheDocument();
        expect(screen.getByText(/Referencia pública: place-public-1/)).toBeInTheDocument();
        const reasonFields = screen.getAllByLabelText('Motivo documentado');
        fireEvent.change(reasonFields.at(-1)!, { target: { value: 'Plaza revisada por operaciones' } });
        fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }));

        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
        const request = fetchMock.mock.calls[1]?.[1] as RequestInit;
        expect(JSON.parse(String(request.body))).toMatchObject({
            action: 'transition_slot',
            slotId: '22222222-2222-4222-8222-222222222222',
            transition: 'publish',
            reason: 'Plaza revisada por operaciones',
        });
    });

    it('reuses the request id after an ambiguous network failure', async () => {
        const fetchMock = vi.fn()
            .mockImplementationOnce(() => response(payload()))
            .mockRejectedValueOnce(new TypeError('Network error'))
            .mockImplementationOnce(() => response({ result: { ok: true } }))
            .mockImplementationOnce(() => response(payload([slot({ status: 'available' })])));
        vi.stubGlobal('fetch', fetchMock);
        render(<TeacherSlotManager lang="es" />);

        fireEvent.click(await screen.findByRole('button', { name: 'Publicar' }));
        fireEvent.change(screen.getAllByLabelText('Motivo documentado').at(-1)!, { target: { value: 'Plaza revisada por operaciones' } });
        fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }));
        expect(await screen.findByRole('alert')).toHaveTextContent('Network error');
        fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }));

        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
        const firstBody = JSON.parse(String((fetchMock.mock.calls[1]?.[1] as RequestInit).body));
        const retryBody = JSON.parse(String((fetchMock.mock.calls[2]?.[1] as RequestInit).body));
        expect(retryBody.requestId).toBe(firstBody.requestId);
    });

    it('clears a pending transition when the selected teacher changes', async () => {
        const otherTeacher = { ...teacher, id: '33333333-3333-4333-8333-333333333333', fullName: 'Other Teacher', email: 'other@example.com' };
        const otherSlot = slot({ id: '44444444-4444-4444-8444-444444444444', publicId: 'place-public-2', teacherId: otherTeacher.id });
        vi.stubGlobal('fetch', vi.fn(() => response({ ...payload(), teachers: [teacher, otherTeacher], slots: [slot(), otherSlot] })));
        render(<TeacherSlotManager lang="en" />);

        fireEvent.click(await screen.findByRole('button', { name: 'Publish' }));
        expect(screen.getByText(/Public reference: place-public-1/)).toBeInTheDocument();
        fireEvent.change(screen.getByRole('combobox', { name: 'Select teacher' }), { target: { value: otherTeacher.id } });
        expect(screen.queryByRole('heading', { name: 'Confirm action: Publish' })).not.toBeInTheDocument();
    });

    it('configures a future engagement for the selected active teacher', async () => {
        const fetchMock = vi.fn()
            .mockImplementationOnce(() => response(payload()))
            .mockImplementationOnce(() => response({ result: { id: 'engagement-2' } }))
            .mockImplementationOnce(() => response(payload()));
        vi.stubGlobal('fetch', fetchMock);
        render(<TeacherSlotManager lang="en" />);

        const section = (await screen.findByRole('heading', { name: 'Configure new engagement' })).closest('section')!;
        fireEvent.change(within(section).getByLabelText('Engagement'), { target: { value: 'external' } });
        fireEvent.change(within(section).getByLabelText('Effective from'), { target: { value: '2026-09-01T12:00' } });
        fireEvent.change(within(section).getByLabelText('Documented reason'), { target: { value: 'Future contract change' } });
        fireEvent.click(within(section).getByRole('button', { name: 'Configure new engagement' }));

        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
        expect(JSON.parse(String((fetchMock.mock.calls[1]?.[1] as RequestInit).body))).toMatchObject({
            action: 'configure_engagement',
            teacherId: teacher.id,
            engagementKind: 'external',
            reason: 'Future contract change',
        });
    });
});
