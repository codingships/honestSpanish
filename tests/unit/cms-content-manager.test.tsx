import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import CmsContentManager from '../../src/components/admin/CmsContentManager';
import { getDefaultCmsHomeContent } from '../../src/lib/cms-home-content';

function response(payload: unknown): Response {
    return {
        ok: true,
        json: vi.fn().mockResolvedValue(payload),
    } as unknown as Response;
}

function state(canWrite = true, withDraft = true) {
    const surfaces = (['es', 'en', 'ru'] as const).map((locale) => ({
        locale,
        effective_payload: getDefaultCmsHomeContent(locale),
        document: locale === 'en' ? {
            id: '99810000-0000-4000-8000-000000000001',
            current_version: 1,
            published_at: '2026-08-03T18:00:00Z',
            updated_at: '2026-08-03T18:00:00Z',
            published_valid: true,
        } : null,
        draft: locale === 'en' && withDraft ? {
            id: '99820000-0000-4000-8000-000000000001',
            base_version: 1,
            revision: 2,
            status: 'draft' as const,
            payload: getDefaultCmsHomeContent('en'),
            payload_valid: true,
            created_at: '2026-08-03T18:00:00Z',
            updated_at: '2026-08-03T18:00:00Z',
        } : null,
        history: locale === 'en' ? [{
            id: '99830000-0000-4000-8000-000000000001',
            version: 1,
            published_at: '2026-08-03T18:00:00Z',
        }] : [],
    }));
    return { can_write: canWrite, surfaces };
}

describe('CmsContentManager', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('requires saving before real preview or publication', async () => {
        const fetchMock = vi.fn().mockResolvedValue(response(state()));
        vi.stubGlobal('fetch', fetchMock);
        render(<CmsContentManager />);

        expect(await screen.findByText('SEO')).toBeInTheDocument();
        const preview = screen.getByRole('link', { name: 'Vista previa real' });
        const publish = screen.getByRole('button', { name: 'Publicar versión' });
        const save = screen.getByRole('button', { name: 'Guardar borrador' });
        expect(preview).toHaveAttribute('aria-disabled', 'false');
        expect(publish).not.toBeDisabled();
        expect(save).toBeDisabled();

        const title = screen.getAllByLabelText(/^Título/u)[0];
        fireEvent.change(title, { target: { value: 'A managed homepage title' } });

        expect(preview).toHaveAttribute('aria-disabled', 'true');
        expect(publish).toBeDisabled();
        expect(save).not.toBeDisabled();

        fireEvent.click(save);
        await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
        const request = fetchMock.mock.calls[1]?.[1] as RequestInit;
        expect(JSON.parse(String(request.body))).toEqual(expect.objectContaining({
            action: 'update_draft',
            expectedRevision: 2,
            payload: expect.objectContaining({
                seo: expect.objectContaining({ title: 'A managed homepage title' }),
            }),
        }));
    });

    it('keeps every mutation disabled for a read-only editor', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(state(false))));
        render(<CmsContentManager />);

        expect(await screen.findByText('SEO')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Guardar borrador' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Publicar versión' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Descartar borrador' })).toBeDisabled();
        expect(screen.getAllByRole('textbox').every((field) => field.hasAttribute('disabled'))).toBe(true);
    });

    it('protects unsaved changes when switching locale', async () => {
        const confirm = vi.fn()
            .mockReturnValueOnce(false)
            .mockReturnValueOnce(true);
        vi.stubGlobal('confirm', confirm);
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(state())));
        render(<CmsContentManager />);

        const title = (await screen.findAllByLabelText(/Título/u))[0];
        fireEvent.change(title, { target: { value: 'Unsaved title' } });
        const english = screen.getByRole('button', { name: 'English' });
        const spanish = screen.getByRole('button', { name: 'Español' });

        fireEvent.click(spanish);
        expect(english).toHaveAttribute('aria-pressed', 'true');
        expect(spanish).toHaveAttribute('aria-pressed', 'false');

        fireEvent.click(spanish);
        expect(spanish).toHaveAttribute('aria-pressed', 'true');
        expect(confirm).toHaveBeenCalledTimes(2);
    });

    it('reports an invalid field locally without sending a privileged mutation', async () => {
        const fetchMock = vi.fn().mockResolvedValue(response(state()));
        vi.stubGlobal('fetch', fetchMock);
        render(<CmsContentManager />);

        const title = (await screen.findAllByLabelText(/Título/u))[0];
        fireEvent.change(title, { target: { value: '   ' } });
        fireEvent.click(screen.getByRole('button', { name: 'Guardar borrador' }));

        expect(await screen.findByRole('alert')).toHaveTextContent('seo.title');
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('offers draft creation when a locale has only integrated fallback', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(state(true, false))));
        render(<CmsContentManager />);

        expect(await screen.findByRole('button', {
            name: 'Crear borrador desde la versión vigente',
        })).not.toBeDisabled();
    });
});
