import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import CrmContactActions from '../../src/components/admin/CrmContactActions';

// Component coverage for src/components/admin/CrmContactActions.tsx.
describe('CrmContactActions', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            json: vi.fn().mockResolvedValue({ activity: { id: 'activity-1' } }),
        }));
    });

    afterEach(() => {
        vi.clearAllTimers();
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it('renders the three CRM action areas with disabled empty-submit buttons', () => {
        render(
            <CrmContactActions
                contactId="10000000-0000-4000-8000-000000000001"
                opportunityId="20000000-0000-4000-8000-000000000001"
            />
        );

        expect(screen.getByRole('heading', { name: 'Nueva nota CRM' })).toBeVisible();
        expect(screen.getByRole('heading', { name: 'Comunicacion manual' })).toBeVisible();
        expect(screen.getByRole('heading', { name: 'Nueva tarea' })).toBeVisible();
        expect(screen.getByRole('button', { name: 'Guardar nota' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Registrar comunicacion' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Crear tarea' })).toBeDisabled();
        expect(screen.getByLabelText('Direccion de comunicacion')).toBeDisabled();
        expect(screen.getByLabelText('Direccion de comunicacion')).toHaveValue('outbound');
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
            target: { value: 'email_in' },
        });
        expect(screen.getByLabelText('Direccion de comunicacion')).toBeDisabled();
        expect(screen.getByLabelText('Direccion de comunicacion')).toHaveValue('inbound');
        fireEvent.change(screen.getByLabelText('Tipo de comunicacion'), {
            target: { value: 'whatsapp' },
        });
        expect(screen.getByLabelText('Direccion de comunicacion')).not.toBeDisabled();
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
        await act(async () => {});

        expect(fetch).toHaveBeenCalledTimes(1);
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
        expect(screen.getByRole('status')).toHaveTextContent('Comunicacion registrada.');
    });

    it('keeps internal notes separate from communication logs', async () => {
        render(<CrmContactActions contactId="10000000-0000-4000-8000-000000000001" />);

        fireEvent.change(screen.getByLabelText('Nota interna'), {
            target: { value: 'Prefiere tarde de Madrid.' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Guardar nota' }));
        await act(async () => {});

        expect(fetch).toHaveBeenCalledTimes(1);
        const [, request] = vi.mocked(fetch).mock.calls[0];
        expect(JSON.parse(request?.body as string)).toEqual({
            action: 'create_note',
            contactId: '10000000-0000-4000-8000-000000000001',
            opportunityId: null,
            body: 'Prefiere tarde de Madrid.',
        });
        expect(screen.getByRole('status')).toHaveTextContent('Nota guardada.');
    });

    it('creates tasks with priority and ISO due date payloads', async () => {
        render(
            <CrmContactActions
                contactId="10000000-0000-4000-8000-000000000001"
                opportunityId="20000000-0000-4000-8000-000000000001"
            />
        );

        fireEvent.change(screen.getByLabelText('Titulo de tarea'), {
            target: { value: 'Enviar propuesta premium' },
        });
        fireEvent.change(screen.getByLabelText('Tipo de tarea'), {
            target: { value: 'email' },
        });
        fireEvent.change(screen.getByLabelText('Prioridad'), {
            target: { value: 'urgent' },
        });
        fireEvent.change(screen.getByLabelText('Vencimiento'), {
            target: { value: '2026-06-25T10:15' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Crear tarea' }));
        await act(async () => {});

        expect(fetch).toHaveBeenCalledTimes(1);
        const [, request] = vi.mocked(fetch).mock.calls[0];
        expect(JSON.parse(request?.body as string)).toEqual({
            action: 'create_task',
            contactId: '10000000-0000-4000-8000-000000000001',
            opportunityId: '20000000-0000-4000-8000-000000000001',
            title: 'Enviar propuesta premium',
            taskType: 'email',
            priority: 'urgent',
            dueAt: new Date('2026-06-25T10:15').toISOString(),
        });
        expect(screen.getByRole('status')).toHaveTextContent('Tarea creada.');
    });

    it('disables all actions while an action is being saved', async () => {
        vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise(() => undefined)));
        render(<CrmContactActions contactId="10000000-0000-4000-8000-000000000001" />);

        fireEvent.change(screen.getByLabelText('Nota interna'), {
            target: { value: 'Pendiente de confirmacion horaria.' },
        });
        fireEvent.change(screen.getByLabelText('Resumen de comunicacion'), {
            target: { value: 'Mensaje listo pero bloqueado mientras guarda nota.' },
        });
        fireEvent.change(screen.getByLabelText('Titulo de tarea'), {
            target: { value: 'Llamar despues' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Guardar nota' }));

        expect(screen.getByRole('button', { name: 'Guardando...' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Registrar comunicacion' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Crear tarea' })).toBeDisabled();
    });

    it('announces API failures as alerts without clearing user input', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: false,
            json: vi.fn().mockResolvedValue({ error: 'Manual review required before outbound communication' }),
        }));
        render(<CrmContactActions contactId="10000000-0000-4000-8000-000000000001" />);

        fireEvent.change(screen.getByLabelText('Resumen de comunicacion'), {
            target: { value: 'WhatsApp comercial sin base legal suficiente.' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Registrar comunicacion' }));
        await act(async () => {});

        expect(screen.getByRole('alert')).toHaveTextContent('Manual review required before outbound communication');
        expect(screen.getByLabelText('Resumen de comunicacion')).toHaveValue('WhatsApp comercial sin base legal suficiente.');
    });
});
