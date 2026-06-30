import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import PaymentRecoveryActions from '../../src/components/admin/PaymentRecoveryActions';

describe('PaymentRecoveryActions', () => {
    beforeEach(() => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            json: vi.fn().mockResolvedValue({ existing: false, task: { id: 'task-1' } }),
        }));
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('creates a CRM payment recovery task for failed payments', async () => {
        render(<PaymentRecoveryActions paymentId="50000000-0000-4000-8000-000000000001" status="failed" />);

        fireEvent.change(screen.getByLabelText('Plazo de seguimiento'), {
            target: { value: 'tomorrow' },
        });
        fireEvent.click(screen.getByText('Crear tarea'));

        await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
        const [, request] = vi.mocked(fetch).mock.calls[0];
        expect(request).toMatchObject({
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
        });
        const payload = JSON.parse(request?.body as string);
        expect(payload).toEqual({
            action: 'create_payment_recovery_task',
            paymentId: '50000000-0000-4000-8000-000000000001',
            dueAt: expect.any(String),
        });
        expect(Number.isNaN(Date.parse(payload.dueAt))).toBe(false);
        expect(await screen.findByText('Tarea CRM creada')).toBeInTheDocument();
    });

    it('does not render actions for non-failed payments', () => {
        const { container } = render(<PaymentRecoveryActions paymentId="50000000-0000-4000-8000-000000000001" status="succeeded" />);

        expect(container).toBeEmptyDOMElement();
    });
});
