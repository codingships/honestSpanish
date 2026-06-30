import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import CrmContactActions from '../../src/components/admin/CrmContactActions';

describe('CrmContactActions', () => {
    beforeEach(() => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            json: vi.fn().mockResolvedValue({ activity: { id: 'activity-1' } }),
        }));
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('sends create_communication with channel, direction, purpose and consent review fields', async () => {
        render(
            <CrmContactActions
                contactId="10000000-0000-4000-8000-000000000001"
                opportunityId="20000000-0000-4000-8000-000000000001"
            />
        );

        expect(screen.queryByRole('option', { name: 'Marketing' })).not.toBeInTheDocument();
        fireEvent.change(screen.getByLabelText('Tipo de comunicacion'), {
            target: { value: 'whatsapp' },
        });
        fireEvent.change(screen.getByLabelText('Direccion de comunicacion'), {
            target: { value: 'outbound' },
        });
        fireEvent.change(screen.getByLabelText('Finalidad de comunicacion'), {
            target: { value: 'sales_follow_up' },
        });
        fireEvent.change(screen.getByLabelText('Asunto de comunicacion'), {
            target: { value: 'Seguimiento de nivel' },
        });
        fireEvent.change(screen.getByLabelText('Resumen de comunicacion'), {
            target: { value: 'Le escribi para confirmar disponibilidad de manana.' },
        });
        fireEvent.change(screen.getByLabelText('Motivo de revision legal'), {
            target: { value: 'Antiguo alumno con interes reciente.' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Registrar comunicacion' }));

        await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
        const [, request] = vi.mocked(fetch).mock.calls[0];
        expect(request).toMatchObject({
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
        });
        expect(JSON.parse(request?.body as string)).toEqual({
            action: 'create_communication',
            contactId: '10000000-0000-4000-8000-000000000001',
            opportunityId: '20000000-0000-4000-8000-000000000001',
            communicationType: 'whatsapp',
            direction: 'outbound',
            purpose: 'sales_follow_up',
            subject: 'Seguimiento de nivel',
            body: 'Le escribi para confirmar disponibilidad de manana.',
            occurredAt: null,
            consentOverrideReason: 'Antiguo alumno con interes reciente.',
        });
        expect(await screen.findByText('Comunicacion registrada.')).toBeInTheDocument();
    });

    it('keeps internal notes separate from communication logs', async () => {
        render(<CrmContactActions contactId="10000000-0000-4000-8000-000000000001" />);

        fireEvent.change(screen.getByLabelText('Nota interna'), {
            target: { value: 'Prefiere tarde de Madrid.' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Guardar nota' }));

        await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
        const [, request] = vi.mocked(fetch).mock.calls[0];
        expect(JSON.parse(request?.body as string)).toEqual({
            action: 'create_note',
            contactId: '10000000-0000-4000-8000-000000000001',
            opportunityId: null,
            body: 'Prefiere tarde de Madrid.',
        });
    });
});
