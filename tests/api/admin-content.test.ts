import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDefaultCmsHomeContent } from '../../src/lib/cms-home-content';

vi.mock('../../src/lib/supabase-server', () => ({
    createSupabaseServerClient: vi.fn(),
}));

vi.mock('../../src/lib/supabase-admin', () => ({
    createSupabaseAdminClient: vi.fn(),
}));

type TableName = 'cms_documents' | 'cms_content_drafts' | 'cms_content_versions';
type Row = Record<string, unknown>;

class Query {
    private filters: Array<(row: Row) => boolean> = [];
    private orderBy: { column: string; ascending: boolean } | null = null;

    constructor(private readonly rows: Row[]) {}

    select() { return this; }
    eq(column: string, value: unknown) {
        this.filters.push((row) => row[column] === value);
        return this;
    }
    order(column: string, options?: { ascending?: boolean }) {
        this.orderBy = { column, ascending: options?.ascending !== false };
        return this;
    }
    private result() {
        const result = this.rows.filter((row) => this.filters.every((filter) => filter(row)));
        if (!this.orderBy) return result;
        const { column, ascending } = this.orderBy;
        return [...result].sort((left, right) => {
            const comparison = String(left[column]).localeCompare(String(right[column]));
            return ascending ? comparison : -comparison;
        });
    }
    then(resolve: (value: { data: Row[]; error: null }) => unknown) {
        return Promise.resolve({ data: this.result(), error: null }).then(resolve);
    }
}

function createAdminClient(overrides: Partial<Record<TableName, Row[]>> = {}) {
    const state: Record<TableName, Row[]> = {
        cms_documents: [],
        cms_content_drafts: [],
        cms_content_versions: [],
        ...overrides,
    };
    return {
        state,
        from: vi.fn((table: TableName) => new Query(state[table])),
        rpc: vi.fn().mockResolvedValue({ data: {}, error: null }),
    };
}

function createServerClient(capabilities: readonly string[] = ['content.read', 'content.write']) {
    return {
        auth: {
            getUser: vi.fn().mockResolvedValue({
                data: { user: { id: '99700000-0000-4000-8000-000000000001', email: 'editor@example.test' } },
                error: null,
            }),
        },
        rpc: vi.fn((_name: string, args: { p_capability: string }) => Promise.resolve({
            data: capabilities.includes(args.p_capability),
            error: null,
        })),
    };
}

function context(body?: unknown, origin = 'http://localhost:4321') {
    return {
        request: {
            url: 'http://localhost:4321/api/admin/content',
            headers: new Headers(origin ? { Origin: origin } : {}),
            json: vi.fn().mockResolvedValue(body ?? {}),
        },
        cookies: { get: vi.fn(), set: vi.fn() },
        locals: {},
    };
}

describe('/api/admin/content', () => {
    beforeEach(async () => {
        vi.clearAllMocks();
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        vi.mocked(createSupabaseServerClient).mockReturnValue(createServerClient() as never);
    });

    it('loads all locales with integrated fallback and a separate write capability', async () => {
        const admin = createAdminClient({
            cms_documents: [{
                id: '99710000-0000-4000-8000-000000000001',
                content_key: 'homepage',
                locale: 'en',
                current_version: 2,
                published_payload: getDefaultCmsHomeContent('en'),
                published_at: '2026-08-03T18:00:00Z',
                updated_at: '2026-08-03T18:00:00Z',
            }],
            cms_content_versions: [{
                id: '99720000-0000-4000-8000-000000000001',
                document_id: '99710000-0000-4000-8000-000000000001',
                version: 2,
                published_at: '2026-08-03T18:00:00Z',
            }],
        });
        const { createSupabaseAdminClient } = await import('../../src/lib/supabase-admin');
        vi.mocked(createSupabaseAdminClient).mockReturnValue(admin as never);
        const { GET } = await import('../../src/pages/api/admin/content');

        const response = await GET(context() as never);
        const body = await response.json() as Record<string, unknown>;
        const surfaces = body.surfaces as Array<Record<string, unknown>>;

        expect(response.status).toBe(200);
        expect(response.headers.get('Cache-Control')).toBe('private, no-store');
        expect(body.can_write).toBe(true);
        expect(surfaces.map((surface) => surface.locale)).toEqual(['es', 'en', 'ru']);
        expect(surfaces.find((surface) => surface.locale === 'en')?.document)
            .toEqual(expect.objectContaining({ current_version: 2, published_valid: true }));
        expect(surfaces.find((surface) => surface.locale === 'es')?.effective_payload)
            .toEqual(getDefaultCmsHomeContent('es'));
    });

    it('creates a draft from the server-owned fallback and never accepts a browser initial payload', async () => {
        const admin = createAdminClient();
        const { createSupabaseAdminClient } = await import('../../src/lib/supabase-admin');
        vi.mocked(createSupabaseAdminClient).mockReturnValue(admin as never);
        const { POST } = await import('../../src/pages/api/admin/content');

        const response = await POST(context({ action: 'create_draft', locale: 'ru' }) as never);

        expect(response.status).toBe(200);
        expect(admin.rpc).toHaveBeenCalledWith('create_cms_content_draft', {
            p_actor_id: '99700000-0000-4000-8000-000000000001',
            p_content_key: 'homepage',
            p_locale: 'ru',
            p_initial_payload: getDefaultCmsHomeContent('ru'),
        });
    });

    it('rejects a malformed draft before calling the privileged client', async () => {
        const { createSupabaseAdminClient } = await import('../../src/lib/supabase-admin');
        const { POST } = await import('../../src/pages/api/admin/content');

        const response = await POST(context({
            action: 'update_draft',
            draftId: '99730000-0000-4000-8000-000000000001',
            expectedRevision: 1,
            payload: { seo: {} },
        }) as never);

        expect(response.status).toBe(400);
        expect(createSupabaseAdminClient).not.toHaveBeenCalled();
    });

    it('rejects cross-site or origin-less mutations before authentication', async () => {
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        const { createSupabaseAdminClient } = await import('../../src/lib/supabase-admin');
        const { POST } = await import('../../src/pages/api/admin/content');

        const crossSite = await POST(context(
            { action: 'create_draft', locale: 'en' },
            'https://attacker.example',
        ) as never);
        const originless = await POST(context(
            { action: 'create_draft', locale: 'en' },
            '',
        ) as never);

        expect(crossSite.status).toBe(403);
        expect(originless.status).toBe(403);
        expect(createSupabaseServerClient).not.toHaveBeenCalled();
        expect(createSupabaseAdminClient).not.toHaveBeenCalled();
    });

    it('rejects mutation for a read-only content administrator', async () => {
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        const { createSupabaseAdminClient } = await import('../../src/lib/supabase-admin');
        vi.mocked(createSupabaseServerClient).mockReturnValue(createServerClient(['content.read']) as never);
        const { POST } = await import('../../src/pages/api/admin/content');

        const response = await POST(context({ action: 'create_draft', locale: 'en' }) as never);

        expect(response.status).toBe(403);
        expect(createSupabaseAdminClient).not.toHaveBeenCalled();
    });

    it('maps optimistic-concurrency failures to a conflict without leaking database details', async () => {
        const admin = createAdminClient();
        admin.rpc.mockResolvedValueOnce({
            data: null,
            error: { code: '40001', message: 'cms_content_stale_revision internal details' },
        });
        const { createSupabaseAdminClient } = await import('../../src/lib/supabase-admin');
        vi.mocked(createSupabaseAdminClient).mockReturnValue(admin as never);
        const { POST } = await import('../../src/pages/api/admin/content');

        const response = await POST(context({
            action: 'update_draft',
            draftId: '99730000-0000-4000-8000-000000000001',
            expectedRevision: 1,
            payload: getDefaultCmsHomeContent('en'),
        }) as never);
        const body = await response.json() as { error: string; code: string };

        expect(response.status).toBe(409);
        expect(body).toEqual({ error: 'Managed content operation failed', code: '40001' });
        expect(JSON.stringify(body)).not.toContain('internal details');
    });
});
