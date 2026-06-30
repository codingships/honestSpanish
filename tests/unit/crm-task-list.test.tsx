import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import CrmTaskList from '../../src/components/admin/CrmTaskList';

const task = {
    id: '30000000-0000-4000-8000-000000000001',
    assigned_to: null,
    title: 'Enviar propuesta',
    task_type: 'email',
    priority: 'high',
    status: 'open',
    due_at: '2026-06-25T10:00:00.000Z',
    completed_at: null,
    crm_contacts: {
        full_name: 'Ana Alumna',
        primary_email: 'ana@example.com',
    },
};

describe('CrmTaskList', () => {
    beforeEach(() => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            json: vi.fn().mockResolvedValue({ task }),
        }));
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('lets an admin claim a shared active task', async () => {
        render(<CrmTaskList tasks={[task]} showContact />);

        expect(screen.getByText(/Cola compartida/)).toBeDefined();
        fireEvent.click(screen.getByText('Asignarme'));

        await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
        const [, request] = vi.mocked(fetch).mock.calls[0];
        expect(JSON.parse(request?.body as string)).toEqual({
            action: 'claim_task',
            taskId: task.id,
        });
    });

    it('does not show the claim action for already assigned tasks', () => {
        render(<CrmTaskList tasks={[{ ...task, assigned_to: 'admin-1' }]} showContact />);

        expect(screen.getByText(/Asignada/)).toBeDefined();
        expect(screen.queryByText('Asignarme')).toBeNull();
    });

    it('sends a complete_task action for active tasks', async () => {
        render(<CrmTaskList tasks={[task]} showContact />);

        fireEvent.click(screen.getByText('Hecha'));

        await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
        const [, request] = vi.mocked(fetch).mock.calls[0];
        expect(request).toMatchObject({
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
        });
        expect(JSON.parse(request?.body as string)).toEqual({
            action: 'complete_task',
            taskId: task.id,
        });
    });

    it('sends an update_task action from the edit form', async () => {
        render(<CrmTaskList tasks={[task]} />);

        fireEvent.click(screen.getByText('Editar'));
        fireEvent.change(screen.getByDisplayValue('Enviar propuesta'), {
            target: { value: 'Enviar propuesta revisada' },
        });
        fireEvent.click(screen.getByText('Guardar'));

        await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
        const [, request] = vi.mocked(fetch).mock.calls[0];
        expect(JSON.parse(request?.body as string)).toMatchObject({
            action: 'update_task',
            taskId: task.id,
            title: 'Enviar propuesta revisada',
            taskType: 'email',
            priority: 'high',
        });
    });
});
