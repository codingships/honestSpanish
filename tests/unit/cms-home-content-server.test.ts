import { afterEach, describe, expect, it, vi } from 'vitest';
import { getDefaultCmsHomeContent } from '../../src/lib/cms-home-content';
import { loadPublishedCmsHomeContent } from '../../src/lib/cms-home-content-server';

function reader(result: { data: unknown; error: { code?: string } | null }) {
    const query = {
        select: vi.fn(),
        eq: vi.fn(),
        maybeSingle: vi.fn().mockResolvedValue(result),
    };
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    return { from: vi.fn().mockReturnValue(query), query };
}

describe('published homepage content lookup', () => {
    afterEach(() => vi.restoreAllMocks());

    it('returns only a valid positive published version', async () => {
        const content = getDefaultCmsHomeContent('en');
        const source = reader({
            data: { current_version: 3, published_payload: content },
            error: null,
        });

        await expect(loadPublishedCmsHomeContent('en', source as never)).resolves.toEqual({
            content,
            version: 3,
        });
        expect(source.from).toHaveBeenCalledWith('cms_documents');
        expect(source.query.eq).toHaveBeenCalledWith('content_key', 'homepage');
        expect(source.query.eq).toHaveBeenCalledWith('locale', 'en');
    });

    it.each([
        { current_version: 0, published_payload: getDefaultCmsHomeContent('es') },
        { current_version: 1, published_payload: { seo: {} } },
        null,
    ])('fails closed for absent or invalid stored content', async (data) => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        await expect(loadPublishedCmsHomeContent('es', reader({ data, error: null }) as never))
            .resolves.toBeNull();
    });

    it('falls back safely when Supabase reports or throws an error', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        await expect(loadPublishedCmsHomeContent(
            'ru',
            reader({ data: null, error: { code: '08006' } }) as never,
        )).resolves.toBeNull();

        const throwing = {
            from: vi.fn(() => { throw new Error('database unavailable'); }),
        };
        await expect(loadPublishedCmsHomeContent('ru', throwing as never)).resolves.toBeNull();
    });
});
