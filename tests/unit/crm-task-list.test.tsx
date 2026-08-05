import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
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

const assignedTask = {
    ...task,
    id: '30000000-0000-4000-8000-000000000002',
    assigned_to: 'admin-1',
    title: 'Preparar informe',
    task_type: 'review',
    priority: 'normal',
    status: 'snoozed',
    due_at: null,
    crm_contacts: {
        full_name: null,
        primary_email: 'fallback@example.com',
    },
};

function requestBody(index = 0) {
    const [, request] = vi.mocked(fetch).mock.calls[index];
    return JSON.parse(request?.body as string);
}

async function flushAction() {
    await act(async () => {});
}

// Component coverage for src/components/admin/CrmTaskList.tsx.
describe('CrmTaskList', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-06-24T08:00:00.000Z'));
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            json: vi.fn().mockResolvedValue({ task }),
        }));
    });

    afterEach(() => {
        vi.clearAllTimers();
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it('keeps a clear empty state', () => {
        render(<CrmTaskList tasks={[]} emptyText="Sin tareas CRM." />);

        expect(screen.getByText('Sin tareas CRM.')).toBeInTheDocument();
    });

    it('lets an admin claim a shared active task with semantic success feedback', async () => {
        render(<CrmTaskList tasks={[task]} showContact />);

        expect(screen.getByText(/Ana Alumna - Email - Alta - Abierta - Cola compartida/)).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Asignarme' }));
        await flushAction();

        expect(fetch).toHaveBeenCalledTimes(1);
        expect(requestBody()).toEqual({
            action: 'claim_task',
            taskId: task.id,
        });
        expect(screen.getByRole('status')).toHaveTextContent('Tarea asignada.');
    });

    it('renders due dates in the fixed academy timezone during hydration', () => {
        const toLocaleStringSpy = vi.spyOn(Date.prototype, 'toLocaleString');

        render(<CrmTaskList tasks={[task]} />);

        expect(toLocaleStringSpy).toHaveBeenCalledWith('es-ES', expect.objectContaining({
            timeZone: 'Europe/Madrid',
        }));
    });

    it('does not show the claim action for already assigned tasks', () => {
        render(<CrmTaskList tasks={[assignedTask]} showContact />);

        expect(screen.getByText(/fallback@example.com - Revision - Normal - Aplazada - Asignada/)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Asignarme' })).not.toBeInTheDocument();
    });

    it('sends complete_task and cancel_task actions for active tasks', async () => {
        const { rerender } = render(<CrmTaskList tasks={[task]} showContact />);

        fireEvent.click(screen.getByRole('button', { name: 'Hecha' }));
        await flushAction();

        expect(requestBody()).toEqual({
            action: 'complete_task',
            taskId: task.id,
        });
        expect(screen.getByRole('status')).toHaveTextContent('Tarea completada.');

        vi.mocked(fetch).mockClear();
        rerender(<CrmTaskList tasks={[task]} showContact />);
        fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
        await flushAction();

        expect(requestBody()).toEqual({
            action: 'cancel_task',
            taskId: task.id,
        });
        expect(screen.getByRole('status')).toHaveTextContent('Tarea cancelada.');
    });

    it('sends snooze_task with tomorrow morning due date', async () => {
        const expectedDueAt = new Date();
        expectedDueAt.setDate(expectedDueAt.getDate() + 1);
        expectedDueAt.setHours(9, 0, 0, 0);
        render(<CrmTaskList tasks={[task]} />);

        fireEvent.click(screen.getByRole('button', { name: 'Aplazar' }));
        await flushAction();

        expect(requestBody()).toEqual({
            action: 'snooze_task',
            taskId: task.id,
            dueAt: expectedDueAt.toISOString(),
        });
        expect(screen.getByRole('status')).toHaveTextContent('Tarea aplazada.');
    });

    it('sends an update_task action from labelled edit controls', async () => {
        render(<CrmTaskList tasks={[task]} />);

        fireEvent.click(screen.getByRole('button', { name: 'Editar' }));
        fireEvent.change(screen.getByLabelText('Titulo de tarea'), {
            target: { value: 'Enviar propuesta revisada' },
        });
        fireEvent.change(screen.getByLabelText('Tipo de tarea'), {
            target: { value: 'call' },
        });
        fireEvent.change(screen.getByLabelText('Prioridad de tarea'), {
            target: { value: 'urgent' },
        });
        fireEvent.change(screen.getByLabelText('Vencimiento de tarea'), {
            target: { value: '2026-06-26T12:30' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
        await flushAction();

        expect(requestBody()).toEqual({
            action: 'update_task',
            taskId: task.id,
            title: 'Enviar propuesta revisada',
            taskType: 'call',
            priority: 'urgent',
            dueAt: new Date('2026-06-26T12:30').toISOString(),
        });
        expect(screen.getByRole('status')).toHaveTextContent('Tarea actualizada.');
    });

    it('keeps save disabled when the edited title is blank', () => {
        render(<CrmTaskList tasks={[task]} />);

        fireEvent.click(screen.getByRole('button', { name: 'Editar' }));
        fireEvent.change(screen.getByLabelText('Titulo de tarea'), {
            target: { value: '   ' },
        });

        expect(screen.getByRole('button', { name: 'Guardar' })).toBeDisabled();
    });

    it('disables every task action while one task mutation is being saved', () => {
        vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise(() => undefined)));
        render(<CrmTaskList tasks={[task, assignedTask]} showContact />);

        const completeButtons = screen.getAllByRole('button', { name: 'Hecha' });
        fireEvent.click(completeButtons[0]);

        expect(screen.getByRole('button', { name: 'Asignarme' })).toBeDisabled();
        expect(completeButtons[0]).toBeDisabled();
        expect(completeButtons[0]).toHaveAttribute('aria-busy', 'true');
        expect(completeButtons[1]).toBeDisabled();
        expect(completeButtons[1]).toHaveAttribute('aria-busy', 'false');
        for (const button of screen.getAllByRole('button', { name: 'Editar' })) {
            expect(button).toBeDisabled();
        }
    });

    it('announces API failures as alerts and re-enables task actions', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: false,
            json: vi.fn().mockResolvedValue({ error: 'Could not update CRM task' }),
        }));
        render(<CrmTaskList tasks={[task]} />);

        fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
        await flushAction();

        expect(screen.getByRole('alert')).toHaveTextContent('Could not update CRM task');
        expect(screen.getByRole('button', { name: 'Cancelar' })).not.toBeDisabled();
    });
});
