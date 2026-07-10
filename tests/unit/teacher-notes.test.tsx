import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import TeacherNotes from '../../src/components/TeacherNotes';

const translations = {
    placeholder: 'Escribe notas sobre el progreso del estudiante...',
    save: 'Guardar notas',
    saved: 'Notas guardadas',
};

const deferred = <T,>() => {
    let resolve!: (value: T | PromiseLike<T>) => void;
    const promise = new Promise<T>((res) => {
        resolve = res;
    });
    return { promise, resolve };
};

function renderTeacherNotes(props: Partial<React.ComponentProps<typeof TeacherNotes>> = {}) {
    return render(
        <TeacherNotes
            studentId="student-1"
            initialNotes="Nota inicial"
            translations={translations}
            {...props}
        />,
    );
}

describe('TeacherNotes', () => {
    beforeEach(() => {
        vi.stubGlobal('fetch', vi.fn());
    });

    afterEach(() => {
        vi.clearAllMocks();
        vi.unstubAllGlobals();
        vi.useRealTimers();
    });

    it('renders an accessible notes form with the initial notes', () => {
        renderTeacherNotes();

        const notes = screen.getByLabelText(translations.placeholder);
        expect(notes).toHaveAttribute('name', 'notes');
        expect(notes).toHaveValue('Nota inicial');
        expect(screen.getByRole('button', { name: translations.save })).toHaveAttribute('type', 'submit');
        expect(screen.getByRole('form')).toHaveAttribute('aria-busy', 'false');
    });

    it('submits notes, locks controls while pending and announces saved status', async () => {
        const pendingSave = deferred<Response>();
        const fetchMock = vi.fn(() => pendingSave.promise);
        vi.stubGlobal('fetch', fetchMock);
        renderTeacherNotes();

        const notes = screen.getByLabelText(translations.placeholder);
        const save = screen.getByRole('button', { name: translations.save });
        fireEvent.change(notes, { target: { value: '  Necesita practicar subjuntivo.  ' } });
        fireEvent.click(save);

        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
        const [, requestInit] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
        expect(JSON.parse(String(requestInit.body))).toEqual({
            studentId: 'student-1',
            notes: '  Necesita practicar subjuntivo.  ',
        });
        expect(screen.getByRole('form')).toHaveAttribute('aria-busy', 'true');
        expect(notes).toBeDisabled();
        expect(screen.getByRole('button', { name: '...' })).toHaveAttribute('aria-busy', 'true');

        await act(async () => {
            pendingSave.resolve(Response.json({ success: true }));
        });

        expect(await screen.findByRole('status')).toHaveTextContent(translations.saved);
        expect(screen.getByRole('form')).toHaveAttribute('aria-busy', 'false');
        expect(notes).toBeEnabled();

        expect(screen.getByRole('status')).toHaveTextContent(translations.saved);
    });

    it('shows an alert with API errors and keeps the edited note available', async () => {
        const fetchMock = vi.fn(() => Promise.resolve(Response.json({ error: 'Student not assigned to you' }, { status: 403 })));
        vi.stubGlobal('fetch', fetchMock);
        renderTeacherNotes();

        const notes = screen.getByLabelText(translations.placeholder);
        fireEvent.change(notes, { target: { value: 'Nota privada' } });
        fireEvent.click(screen.getByRole('button', { name: translations.save }));

        expect(await screen.findByRole('alert')).toHaveTextContent('Student not assigned to you');
        expect(notes).toHaveValue('Nota privada');
        expect(screen.getByRole('button', { name: translations.save })).toBeEnabled();
    });

    it('resets note text and feedback when another student is rendered', async () => {
        vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(Response.json({ success: true }))));
        const { rerender } = renderTeacherNotes();

        fireEvent.change(screen.getByLabelText(translations.placeholder), {
            target: { value: 'Nota editada' },
        });
        fireEvent.click(screen.getByRole('button', { name: translations.save }));
        expect(await screen.findByRole('status')).toHaveTextContent(translations.saved);

        rerender(
            <TeacherNotes
                studentId="student-2"
                initialNotes="Nota del segundo estudiante"
                translations={translations}
            />,
        );

        expect(screen.getByLabelText(translations.placeholder)).toHaveValue('Nota del segundo estudiante');
        expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });
});
