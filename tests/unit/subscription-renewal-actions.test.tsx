import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import SubscriptionRenewalActions from '../../src/components/admin/SubscriptionRenewalActions';

describe('SubscriptionRenewalActions', () => {
    const subscriptionId = '80000000-0000-4000-8000-000000000001';

    beforeEach(() => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2026-01-15T09:30:00.000Z'));
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            json: vi.fn().mockResolvedValue({ existing: false, task: { id: 'task-1' } }),
        }));
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it('creates a CRM renewal task for active subscriptions with the selected due date', async () => {
        render(<SubscriptionRenewalActions subscriptionId={subscriptionId} status="active" />);

        fireEvent.change(screen.getByLabelText('Plazo de renovacion'), {
            target: { value: 'one_week' },
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
            action: 'create_subscription_renewal_task',
            subscriptionId,
            dueAt: '2026-01-22T10:00:00.000Z',
        });
        expect(await screen.findByRole('status')).toHaveTextContent('Tarea CRM creada');
    });

    it('does not render actions for inactive subscriptions', () => {
        const { container, rerender } = render(<SubscriptionRenewalActions subscriptionId={subscriptionId} status="cancelled" />);

        expect(container).toBeEmptyDOMElement();

        rerender(<SubscriptionRenewalActions subscriptionId={subscriptionId} status={null} />);
        expect(container).toBeEmptyDOMElement();
    });

    it('announces an existing open renewal task without creating duplicate uncertainty', async () => {
        vi.mocked(fetch).mockResolvedValueOnce({
            ok: true,
            json: vi.fn().mockResolvedValue({ existing: true, task: { id: 'task-1' } }),
        } as unknown as Response);
        render(<SubscriptionRenewalActions subscriptionId={subscriptionId} status="active" />);

        fireEvent.click(screen.getByText('Crear tarea'));

        expect(await screen.findByRole('status')).toHaveTextContent('Ya hay tarea abierta');
    });

    it('locks renewal controls while the task is being created', async () => {
        let resolveFetch!: (value: Response) => void;
        vi.mocked(fetch).mockReturnValueOnce(new Promise((resolve) => {
            resolveFetch = resolve;
        }) as Promise<Response>);
        render(<SubscriptionRenewalActions subscriptionId={subscriptionId} status="active" />);

        fireEvent.click(screen.getByText('Crear tarea'));

        const select = screen.getByLabelText('Plazo de renovacion');
        const button = screen.getByRole('button', { name: 'Creando...' });
        expect(select).toBeDisabled();
        expect(button).toBeDisabled();
        expect(button).toHaveAttribute('aria-busy', 'true');

        resolveFetch({
            ok: true,
            json: vi.fn().mockResolvedValue({ existing: false, task: { id: 'task-1' } }),
        } as unknown as Response);

        await waitFor(() => expect(screen.getByRole('button', { name: 'Crear tarea' })).not.toBeDisabled());
    });

    it('announces API errors as alerts', async () => {
        vi.mocked(fetch).mockResolvedValueOnce({
            ok: false,
            json: vi.fn().mockResolvedValue({ error: 'CRM no disponible' }),
        } as unknown as Response);
        render(<SubscriptionRenewalActions subscriptionId={subscriptionId} status="active" />);

        fireEvent.click(screen.getByText('Crear tarea'));

        expect(await screen.findByRole('alert')).toHaveTextContent('CRM no disponible');
    });
});
