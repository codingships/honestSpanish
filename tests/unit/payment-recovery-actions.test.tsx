import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import PaymentRecoveryActions from '../../src/components/admin/PaymentRecoveryActions';

function jsonResponse(payload: unknown, ok = true) {
    return {
        ok,
        json: vi.fn().mockResolvedValue(payload),
    } as unknown as Response;
}

function requestBody() {
    const [, request] = vi.mocked(fetch).mock.calls[0];
    return JSON.parse(request?.body as string);
}

async function flushAction() {
    await act(async () => {});
}

// Component coverage for src/components/admin/PaymentRecoveryActions.tsx.
describe('PaymentRecoveryActions', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-06-24T08:30:00.000Z'));
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ existing: false, task: { id: 'task-1' } })));
    });

    afterEach(() => {
        vi.clearAllTimers();
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it('creates a CRM payment recovery task for failed payments', async () => {
        const expectedDueAt = new Date();
        expectedDueAt.setDate(expectedDueAt.getDate() + 1);
        expectedDueAt.setHours(10, 0, 0, 0);
        render(<PaymentRecoveryActions paymentId="50000000-0000-4000-8000-000000000001" status="failed" />);

        fireEvent.change(screen.getByLabelText('Plazo de seguimiento'), {
            target: { value: 'tomorrow' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Crear tarea' }));
        await flushAction();

        const [, request] = vi.mocked(fetch).mock.calls[0];
        expect(request).toMatchObject({
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
        });
        expect(requestBody()).toEqual({
            action: 'create_payment_recovery_task',
            paymentId: '50000000-0000-4000-8000-000000000001',
            dueAt: expectedDueAt.toISOString(),
        });
        expect(screen.getByRole('status')).toHaveTextContent('Tarea CRM creada');
    });

    it('reports existing recovery tasks semantically', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ existing: true, task: { id: 'task-1' } })));
        render(<PaymentRecoveryActions paymentId="50000000-0000-4000-8000-000000000001" status="failed" />);

        fireEvent.click(screen.getByRole('button', { name: 'Crear tarea' }));
        await flushAction();

        expect(screen.getByRole('status')).toHaveTextContent('Ya hay tarea abierta');
    });

    it('disables controls while creating the recovery task', () => {
        vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise(() => undefined)));
        render(<PaymentRecoveryActions paymentId="50000000-0000-4000-8000-000000000001" status="failed" />);

        fireEvent.click(screen.getByRole('button', { name: 'Crear tarea' }));

        expect(screen.getByLabelText('Plazo de seguimiento')).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Creando...' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Creando...' })).toHaveAttribute('aria-busy', 'true');
    });

    it('announces API errors as alerts', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'Could not create payment recovery task' }, false)));
        render(<PaymentRecoveryActions paymentId="50000000-0000-4000-8000-000000000001" status="failed" />);

        fireEvent.click(screen.getByRole('button', { name: 'Crear tarea' }));
        await flushAction();

        expect(screen.getByRole('alert')).toHaveTextContent('Could not create payment recovery task');
    });

    it('does not render actions for non-failed payments', () => {
        const { container } = render(<PaymentRecoveryActions paymentId="50000000-0000-4000-8000-000000000001" status="succeeded" />);

        expect(container).toBeEmptyDOMElement();
    });
});
