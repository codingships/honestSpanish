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
    settlements: [],
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
    it('closes a month and documents a manual payment without client-supplied admin data', async () => {
        const settlementId = '70000000-0000-4000-8000-000000000020';
        vi.stubGlobal('fetch', vi.fn(async (_input, init) => {
            if (init?.method === 'POST') return response({ result: { id: 'result-1' } });
            return response({
                ...baseResponse,
                settlements: [{
                    id: settlementId,
                    teacherId,
                    teacherLabel: 'Irene Docente',
                    periodMonth: '2026-07-01',
                    periodStartAt: '2026-06-30T22:00:00.000Z',
                    periodEndAt: '2026-07-31T22:00:00.000Z',
                    classAmountCents: 8000,
                    workAmountCents: 1500,
                    adjustmentAmountCents: -250,
                    totalAmountCents: 9250,
                    currency: 'eur',
                    lineCount: 6,
                    closeNote: 'Cierre mensual revisado',
                    closedAt: '2026-08-01T09:00:00.000Z',
                    status: 'closed',
                    paymentId: null,
                    paidAt: null,
                    paymentReference: null,
                    invoiceReference: null,
                    paymentNote: null,
                }],
            });
        }));

        render(<TeacherCompensationManager />);
        expect(await screen.findByRole('heading', { name: 'Liquidaciones mensuales' })).toBeInTheDocument();
        expect(screen.getByText(/92,50/)).toHaveTextContent(/6 movimientos/);
        expect(screen.getByRole('link', { name: 'Descargar CSV' })).toHaveAttribute(
            'href',
            `/api/teacher/compensation-export?settlementId=${settlementId}`,
        );

        fireEvent.change(screen.getByLabelText('Mes cerrado'), { target: { value: '2026-07' } });
        fireEvent.change(screen.getByLabelText('Nota de cierre'), { target: { value: 'Cierre mensual revisado' } });
        fireEvent.click(screen.getByRole('button', { name: /Cerrar liquidaci/u }));
        await waitFor(() => expect(postBodies()).toHaveLength(1));
        expect(postBodies()[0]).toEqual({
            action: 'close_settlement',
            requestId: '70000000-0000-4000-8000-000000000001',
            teacherId,
            periodMonth: '2026-07-01',
            note: 'Cierre mensual revisado',
        });
        expect(postBodies()[0]).not.toHaveProperty('adminId');

        fireEvent.change(screen.getByLabelText('Fecha real de pago'), { target: { value: '2026-08-01T12:00' } });
        fireEvent.change(screen.getByLabelText('Referencia del pago'), { target: { value: 'transfer-2026-07' } });
        fireEvent.change(screen.getByLabelText('Nota'), { target: { value: 'Pago manual comprobado' } });
        fireEvent.click(screen.getByRole('button', { name: 'Marcar pago manual' }));
        await waitFor(() => expect(postBodies()).toHaveLength(2));
        expect(postBodies()[1]).toEqual({
            action: 'record_settlement_payment',
            requestId: '70000000-0000-4000-8000-000000000001',
            settlementId,
            paidAt: new Date('2026-08-01T12:00').toISOString(),
            paymentReference: 'transfer-2026-07',
            invoiceReference: null,
            note: 'Pago manual comprobado',
        });
        expect(postBodies()[1]).not.toHaveProperty('adminId');
    });

    it('voids an erroneous payment mark with append-only correction data', async () => {
        const settlementId = '70000000-0000-4000-8000-000000000020';
        const paymentId = '70000000-0000-4000-8000-000000000021';
        vi.stubGlobal('fetch', vi.fn(async (_input, init) => {
            if (init?.method === 'POST') return response({ result: { id: 'void-1' } });
            return response({
                ...baseResponse,
                settlements: [{
                    id: settlementId,
                    teacherId,
                    teacherLabel: 'Irene Docente',
                    periodMonth: '2026-07-01',
                    periodStartAt: '2026-06-30T22:00:00.000Z',
                    periodEndAt: '2026-07-31T22:00:00.000Z',
                    classAmountCents: 8000,
                    workAmountCents: 1500,
                    adjustmentAmountCents: -250,
                    totalAmountCents: 9250,
                    currency: 'eur',
                    lineCount: 6,
                    closeNote: 'Cierre mensual revisado',
                    closedAt: '2026-08-01T09:00:00.000Z',
                    status: 'paid',
                    paymentId,
                    paidAt: '2026-08-01T10:00:00.000Z',
                    paymentReference: 'transfer-incorrecta',
                    invoiceReference: null,
                    paymentNote: 'Pago marcado por error',
                }],
            });
        }));

        render(<TeacherCompensationManager />);
        expect(await screen.findByRole('button', { name: 'Anular marca de pago' })).toBeDisabled();
        fireEvent.change(screen.getByLabelText(/Motivo de la anulaci/u), {
            target: { value: 'La referencia bancaria era incorrecta' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Anular marca de pago' }));

        await waitFor(() => expect(postBodies()).toHaveLength(1));
        expect(postBodies()[0]).toEqual({
            action: 'void_settlement_payment',
            requestId: '70000000-0000-4000-8000-000000000001',
            paymentId,
            reason: 'La referencia bancaria era incorrecta',
        });
        expect(postBodies()[0]).not.toHaveProperty('adminId');
        expect(await screen.findByText(/Marca de pago anulada/)).toHaveAttribute('role', 'status');
    });

    it('uses a new request id when an identical payment is recorded again after a successful void', async () => {
        const settlementId = '70000000-0000-4000-8000-000000000020';
        const paymentId = '70000000-0000-4000-8000-000000000021';
        const requestIds = [
            '70000000-0000-4000-8000-000000000031',
            '70000000-0000-4000-8000-000000000032',
            '70000000-0000-4000-8000-000000000033',
        ] as const;
        vi.mocked(globalThis.crypto.randomUUID)
            .mockReset()
            .mockReturnValueOnce(requestIds[0])
            .mockReturnValueOnce(requestIds[1])
            .mockReturnValueOnce(requestIds[2]);

        const closedSettlement = {
            id: settlementId,
            teacherId,
            teacherLabel: 'Irene Docente',
            periodMonth: '2026-07-01',
            periodStartAt: '2026-06-30T22:00:00.000Z',
            periodEndAt: '2026-07-31T22:00:00.000Z',
            classAmountCents: 8000,
            workAmountCents: 1500,
            adjustmentAmountCents: -250,
            totalAmountCents: 9250,
            currency: 'eur',
            lineCount: 6,
            closeNote: 'Cierre mensual revisado',
            closedAt: '2026-08-01T09:00:00.000Z',
            status: 'closed',
            paymentId: null,
            paidAt: null,
            paymentReference: null,
            invoiceReference: null,
            paymentNote: null,
        };
        const paidSettlement = {
            ...closedSettlement,
            status: 'paid',
            paymentId,
            paidAt: '2026-08-01T10:00:00.000Z',
            paymentReference: 'transfer-2026-07',
            paymentNote: 'Pago manual comprobado',
        };
        let getCount = 0;
        vi.stubGlobal('fetch', vi.fn(async (_input, init) => {
            if (init?.method === 'POST') return response({ result: { id: 'result-1' } });
            getCount += 1;
            const settlement = getCount === 2 || getCount >= 4 ? paidSettlement : closedSettlement;
            return response({ ...baseResponse, settlements: [settlement] });
        }));

        render(<TeacherCompensationManager />);
        await screen.findByRole('button', { name: 'Marcar pago manual' });

        const enterPayment = () => {
            fireEvent.change(screen.getByLabelText('Fecha real de pago'), { target: { value: '2026-08-01T12:00' } });
            fireEvent.change(screen.getByLabelText('Referencia del pago'), { target: { value: 'transfer-2026-07' } });
            fireEvent.change(screen.getByLabelText('Nota'), { target: { value: 'Pago manual comprobado' } });
            fireEvent.click(screen.getByRole('button', { name: 'Marcar pago manual' }));
        };

        enterPayment();
        await screen.findByRole('button', { name: 'Anular marca de pago' });
        fireEvent.change(screen.getByLabelText(/Motivo de la anulaci/u), {
            target: { value: 'La referencia bancaria era incorrecta' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Anular marca de pago' }));
        await screen.findByRole('button', { name: 'Marcar pago manual' });

        enterPayment();
        await waitFor(() => expect(postBodies()).toHaveLength(3));
        const paymentPosts = postBodies().filter((body) => body.action === 'record_settlement_payment');
        expect(paymentPosts).toHaveLength(2);
        expect(paymentPosts[0]).toEqual({
            action: 'record_settlement_payment',
            requestId: requestIds[0],
            settlementId,
            paidAt: new Date('2026-08-01T12:00').toISOString(),
            paymentReference: 'transfer-2026-07',
            invoiceReference: null,
            note: 'Pago manual comprobado',
        });
        expect(paymentPosts[1]).toEqual({
            ...paymentPosts[0],
            requestId: requestIds[2],
        });
        expect(paymentPosts[1].requestId).not.toBe(paymentPosts[0].requestId);
    });
});
