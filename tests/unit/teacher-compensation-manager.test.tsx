import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import TeacherCompensationManager from '../../src/components/admin/TeacherCompensationManager';

const teacherId = '70000000-0000-4000-8000-000000000002';
const cycleId = '70000000-0000-4000-8000-000000000006';
const sessionId = '70000000-0000-4000-8000-000000000007';

const baseResponse = {
    teachers: [{
        id: teacherId,
        fullName: 'Irene Docente',
        email: 'irene@example.test',
        currentEngagement: null,
    }],
    engagements: [],
    milestone: {
        tenActiveHistoryState: 'requires_confirmation',
        firstReadyInitialAt: '2026-08-01T09:00:00.000Z',
        tenActiveReachedAt: null,
        tenActiveStudentsCount: null,
    },
    historyCycles: [{ id: cycleId, createdAt: '2026-08-01T09:00:00.000Z', studentLabel: 'Ana' }],
    cycleGaps: [{ id: cycleId, createdAt: '2026-08-01T09:00:00.000Z', cycleNumber: 1, studentLabel: 'Ana' }],
    sessionGaps: [{ id: sessionId, scheduledAt: '2026-08-02T09:00:00.000Z', status: 'completed', teacherLabel: 'Irene', studentLabel: 'Ana' }],
    classObligations: [],
    workObligations: [],
    workAdjustments: [],
    pagination: { page: 0, limit: 50, hasPrevious: false, hasMore: false },
};

function response(payload: unknown, ok = true): Response {
    return { ok, json: vi.fn().mockResolvedValue(payload) } as unknown as Response;
}

function postBodies() {
    return vi.mocked(fetch).mock.calls
        .filter(([, init]) => init?.method === 'POST')
        .map(([, init]) => JSON.parse(init?.body as string));
}

describe('TeacherCompensationManager', () => {
    beforeEach(() => {
        vi.stubGlobal('fetch', vi.fn(async (_input, init) => {
            if (init?.method === 'POST') return response({ result: { id: 'result-1' } });
            return response(baseResponse);
        }));
        vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue('70000000-0000-4000-8000-000000000001');
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('renders the four operational blocks and blocks reconciliation while history needs confirmation', async () => {
        render(<TeacherCompensationManager />);

        expect(await screen.findByRole('heading', { name: 'Vínculos docentes' })).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'Gate histórico' })).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'Reconciliación' })).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'Obligaciones registradas' })).toBeInTheDocument();
        expect(screen.getByText(/permanece bloqueada/)).toHaveAttribute('role', 'alert');
        expect(screen.getByRole('button', { name: 'Reconciliar siguiente ciclo' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Reconciliar sesión' })).toBeDisabled();
        expect(fetch).toHaveBeenCalledWith(
            '/api/admin/teacher-compensation?page=0&limit=50',
            expect.objectContaining({ signal: expect.any(AbortSignal) }),
        );
    });

    it('posts a stable engagement request without exposing an admin identifier', async () => {
        render(<TeacherCompensationManager />);
        await screen.findByRole('heading', { name: 'Vínculos docentes' });

        fireEvent.change(screen.getByLabelText('Efectivo desde'), { target: { value: '2026-08-03T10:00' } });
        fireEvent.change(screen.getByLabelText('Motivo'), { target: { value: 'Inicio acordado del vínculo' } });
        fireEvent.click(screen.getByRole('button', { name: 'Registrar vínculo' }));

        await waitFor(() => expect(postBodies()).toHaveLength(1));
        expect(postBodies()[0]).toEqual({
            action: 'configure_engagement',
            requestId: '70000000-0000-4000-8000-000000000001',
            teacherId,
            engagementKind: 'external',
            effectiveFrom: new Date('2026-08-03T10:00').toISOString(),
            reason: 'Inicio acordado del vínculo',
        });
        expect(postBodies()[0]).not.toHaveProperty('configuredBy');
        expect(await screen.findByText('Vínculo docente registrado')).toHaveAttribute('role', 'status');
    });

    it('records mandatory work with its real interval and stable request id', async () => {
        render(<TeacherCompensationManager />);
        await screen.findByRole('heading', { name: 'Vínculos docentes' });

        fireEvent.change(screen.getByLabelText('Inicio real'), { target: { value: '2026-08-03T10:00' } });
        fireEvent.change(screen.getByLabelText('Fin real'), { target: { value: '2026-08-03T11:00' } });
        fireEvent.change(screen.getByLabelText('Descripción'), { target: { value: 'Formación obligatoria inicial' } });
        fireEvent.click(screen.getByRole('button', { name: 'Registrar trabajo' }));

        await waitFor(() => expect(postBodies()).toHaveLength(1));
        expect(postBodies()[0]).toEqual({
            action: 'record_mandatory_work',
            requestId: '70000000-0000-4000-8000-000000000001',
            teacherId,
            workKind: 'mandatory_training',
            startedAt: new Date('2026-08-03T10:00').toISOString(),
            endedAt: new Date('2026-08-03T11:00').toISOString(),
            description: 'Formación obligatoria inicial',
        });
        expect(postBodies()[0]).not.toHaveProperty('recordedBy');
        expect(await screen.findByText('Trabajo obligatorio registrado')).toHaveAttribute('role', 'status');
    });

    it('totals adjusted work balances once and shows recent movements separately', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({
            ...baseResponse,
            classObligations: [{
                id: 'class-1',
                teacherId,
                teacherLabel: 'Irene Docente',
                studentLabel: 'Ana',
                eventKind: 'class_completed',
                sourceOccurredAt: '2026-08-02T10:00:00.000Z',
                amountCents: 2000,
                currency: 'eur',
            }],
            workObligations: [{
                id: 'work-1',
                teacherId,
                teacherLabel: 'Irene Docente',
                workKind: 'mandatory_training',
                startedAt: '2026-08-01T10:00:00.000Z',
                endedAt: '2026-08-01T11:00:00.000Z',
                originalMinutes: 60,
                originalAmountCents: 1500,
                adjustmentMinutes: -15,
                adjustmentAmountCents: -375,
                adjustedMinutes: 45,
                adjustedAmountCents: 1125,
                currency: 'eur',
                description: 'Formación obligatoria',
                createdAt: '2026-08-01T11:00:00.000Z',
            }],
            workAdjustments: [{
                id: 'adjustment-1',
                teacherId,
                teacherLabel: 'Irene Docente',
                workEntryId: 'work-1',
                minutesDelta: -15,
                amountCents: -375,
                currency: 'eur',
                reason: 'Corrección del tiempo real',
                createdAt: '2026-08-02T11:00:00.000Z',
            }],
        })));

        render(<TeacherCompensationManager />);

        const summary = await screen.findByText(/En esta página:/);
        expect(summary).toHaveTextContent(/clases 20,00.*trabajo ajustado 11,25.*obligaciones 31,25/);
        expect(screen.getByText(/Saldo actual: 45 min/)).toHaveTextContent('11,25');
        expect(screen.getByText(/Alta original: 60 min/)).toHaveTextContent('15,00');
        expect(screen.getByRole('heading', { name: 'Movimientos de ajuste recientes' })).toBeInTheDocument();
        expect(screen.getByText('Historial informativo independiente del total de la página.')).toBeInTheDocument();
    });
});
