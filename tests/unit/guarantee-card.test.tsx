import React from 'react';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import GuaranteeCard from '../../src/components/account/GuaranteeCard';

const subscriptionId = '11111111-1111-4111-8111-111111111111';
const requestId = '22222222-2222-4222-8222-222222222222';

function guarantee(status: string, overrides: Record<string, unknown> = {}) {
    return {
        guarantee: {
            subscriptionId,
            status,
            refundAmountCents: 19425,
            currency: 'eur',
            operationId: null,
            reason: null,
            ...overrides,
        },
    };
}

function response(payload: unknown, status = 200) {
    return Promise.resolve(new Response(JSON.stringify(payload), {
        status,
        headers: { 'Content-Type': 'application/json' },
    }));
}

describe('GuaranteeCard', () => {
    beforeEach(() => {
        window.localStorage.clear();
        vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue(requestId);
    });

    afterEach(() => {
        cleanup();
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('requires an explicit accessible confirmation of all five effects before requesting a refund', async () => {
        const fetchMock = vi.fn()
            .mockImplementationOnce(() => response(guarantee('eligible')))
            .mockImplementationOnce(() => response(guarantee('processing', { operationId: requestId })));
        vi.stubGlobal('fetch', fetchMock);

        render(<GuaranteeCard subscriptionId={subscriptionId} lang="es" />);

        const requestButton = await screen.findByRole('button', { name: 'Solicitar devolución' });
        fireEvent.click(requestButton);

        const dialog = screen.getByRole('dialog', { name: 'Confirmar devolución' });
        expect(dialog).toHaveAttribute('aria-modal', 'true');
        expect(dialog).toHaveTextContent('medio de pago original');
        expect(dialog).toHaveTextContent('La primera clase permanece pagada');
        expect(dialog).toHaveTextContent('Las otras tres clases quedarán invalidadas');
        expect(dialog).toHaveTextContent('Se cancelarán todas las renovaciones futuras');
        expect(dialog).toHaveTextContent('Esta acción no se puede deshacer');

        const acknowledgement = screen.getByRole('checkbox', { name: /Entiendo y quiero/ });
        expect(acknowledgement).toHaveFocus();
        const confirmButton = screen.getByRole('button', { name: 'Confirmar devolución' });
        expect(confirmButton).toBeDisabled();
        fireEvent.click(acknowledgement);
        expect(confirmButton).toBeEnabled();
        fireEvent.click(confirmButton);

        await screen.findByText('Tu solicitud se está procesando. No necesitas crear otra.');
        expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/account/guarantee', expect.objectContaining({
            method: 'POST',
            body: JSON.stringify({ subscriptionId, requestId }),
        }));
        expect(window.localStorage.getItem(`honest-spanish:guarantee:${subscriptionId}:request-id`)).toBe(requestId);
    });

    it('traps forward and backward keyboard focus inside the confirmation dialog', async () => {
        vi.stubGlobal('fetch', vi.fn(() => response(guarantee('eligible'))));

        render(<GuaranteeCard subscriptionId={subscriptionId} lang="en" />);
        const requestButton = await screen.findByRole('button', { name: 'Request refund' });
        fireEvent.click(requestButton);

        const acknowledgement = screen.getByRole('checkbox', { name: /I understand/ });
        const cancelButton = screen.getByRole('button', { name: 'Go back' });
        expect(acknowledgement).toHaveFocus();

        fireEvent.keyDown(window, { key: 'Tab', shiftKey: true });
        expect(cancelButton).toHaveFocus();
        fireEvent.keyDown(window, { key: 'Tab' });
        expect(acknowledgement).toHaveFocus();

        fireEvent.click(acknowledgement);
        const confirmButton = screen.getByRole('button', { name: 'Confirm refund' });
        confirmButton.focus();
        fireEvent.keyDown(window, { key: 'Tab' });
        expect(acknowledgement).toHaveFocus();
    });

    it.each([
        ['not_started', 200, 'La garantía estará disponible después de completar la primera clase'],
        ['closed', 409, 'La ventana de esta garantía está cerrada'],
        ['refunded', 200, 'La devolución se ha completado'],
    ])('never offers a refund when the authoritative state is %s', async (status, httpStatus, expectedCopy) => {
        vi.stubGlobal('fetch', vi.fn(() => response(guarantee(status), httpStatus)));

        render(<GuaranteeCard subscriptionId={subscriptionId} lang="es" />);

        await screen.findByText(new RegExp(expectedCopy));
        expect(screen.queryByRole('button', { name: 'Solicitar devolución' })).toBeNull();
    });

    it('uses a valid 503 retryable response instead of losing the authoritative operation state', async () => {
        vi.stubGlobal('fetch', vi.fn(() => response(
            guarantee('retryable', { operationId: requestId }),
            503,
        )));

        render(<GuaranteeCard subscriptionId={subscriptionId} lang="en" />);

        await screen.findByText('The request has not finished. You can safely retry the same operation.');
        expect(screen.getByRole('button', { name: 'Retry the same request' })).toBeInTheDocument();
        expect(screen.queryByRole('alert')).toBeNull();
    });

    it('retries an uncertain request with the same persisted request id', async () => {
        const fetchMock = vi.fn()
            .mockImplementationOnce(() => response(guarantee('eligible')))
            .mockRejectedValueOnce(new TypeError('network error'))
            .mockImplementationOnce(() => response(guarantee('refund_pending', { operationId: requestId })));
        vi.stubGlobal('fetch', fetchMock);

        render(<GuaranteeCard subscriptionId={subscriptionId} lang="en" />);

        fireEvent.click(await screen.findByRole('button', { name: 'Request refund' }));
        fireEvent.click(screen.getByRole('checkbox', { name: /I understand/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Confirm refund' }));

        const retry = await screen.findByRole('button', { name: 'Retry the same request' });
        fireEvent.click(retry);
        await screen.findByText('The refund is in progress to the original payment method.');

        const firstBody = JSON.parse(fetchMock.mock.calls[1][1].body as string);
        const retryBody = JSON.parse(fetchMock.mock.calls[2][1].body as string);
        expect(firstBody.requestId).toBe(requestId);
        expect(retryBody.requestId).toBe(requestId);
    });

    it('shows only a short reference and support path during manual review', async () => {
        const operationId = 'aaaaaaaa-bbbb-4ccc-8ddd-1234567890ab';
        vi.stubGlobal('fetch', vi.fn(() => response(guarantee('manual_review', { operationId }))));

        render(<GuaranteeCard subscriptionId={subscriptionId} lang="en" />);

        await screen.findByText('The request needs review by the team. Do not create another request.');
        expect(screen.getByText('Reference: 567890AB')).toBeInTheDocument();
        expect(screen.queryByText(operationId)).toBeNull();
        expect(screen.getByRole('link', { name: 'Contact support' })).toHaveAttribute('href', '/en/campus/support');
        expect(screen.getByRole('button', { name: 'Check status' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Request refund' })).toBeNull();
    });

    it('fails closed when the backend response does not match the exact contract', async () => {
        vi.stubGlobal('fetch', vi.fn(() => response(guarantee('eligible', { refundAmountCents: 20000 }))));

        render(<GuaranteeCard subscriptionId={subscriptionId} lang="ru" />);

        await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Получен недопустимый статус'));
        expect(screen.queryByRole('button', { name: 'Запросить возврат' })).toBeNull();
    });

    it('keeps the latest subscription visible after cancellation and mounts the guarantee card', () => {
        const accountPage = readFileSync('src/pages/[lang]/campus/account.astro', 'utf8');

        expect(accountPage).toContain(".order('created_at', { ascending: false })");
        expect(accountPage).toContain('.maybeSingle()');
        expect(accountPage).not.toContain(".in('status', ['active', 'pending', 'paused'])");
        expect(accountPage).toContain('<GuaranteeCard');
        expect(accountPage).toContain('subscriptionId={subscription.id}');
    });
});
