import type { APIRoute } from 'astro';
import { z } from 'zod';
import { requireAdminCapability } from '../../../lib/admin-access';
import {
    CMS_HOME_CONTENT_KEY,
    CMS_HOME_LOCALES,
    cmsHomeContentSchema,
    getDefaultCmsHomeContent,
    parseCmsHomeContent,
    type CmsHomeLocale,
} from '../../../lib/cms-home-content';
import { createSupabaseAdminClient } from '../../../lib/supabase-admin';
import { createSupabaseServerClient } from '../../../lib/supabase-server';

export const config = { runtime: 'nodejs' };

const jsonHeaders = {
    'Content-Type': 'application/json',
    'Cache-Control': 'private, no-store',
};
const localeSchema = z.enum(CMS_HOME_LOCALES);
const actionSchema = z.discriminatedUnion('action', [
    z.object({
        action: z.literal('create_draft'),
        locale: localeSchema,
    }).strict(),
    z.object({
        action: z.literal('update_draft'),
        draftId: z.string().uuid(),
        expectedRevision: z.number().int().positive(),
        payload: cmsHomeContentSchema,
    }).strict(),
    z.object({
        action: z.literal('discard_draft'),
        draftId: z.string().uuid(),
        expectedRevision: z.number().int().positive(),
    }).strict(),
    z.object({
        action: z.literal('publish_draft'),
        draftId: z.string().uuid(),
        expectedRevision: z.number().int().positive(),
    }).strict(),
    z.object({
        action: z.literal('rollback'),
        documentId: z.string().uuid(),
        sourceVersion: z.number().int().positive(),
        expectedCurrentVersion: z.number().int().positive(),
        operationId: z.string().uuid(),
    }).strict(),
]);

type DatabaseError = { code?: string; message?: string };
type QueryResult = PromiseLike<{ data: unknown; error: DatabaseError | null }>;
type QueryBuilder = QueryResult & {
    select(columns: string): QueryBuilder;
    eq(column: string, value: unknown): QueryBuilder;
    order(column: string, options?: { ascending?: boolean }): QueryBuilder;
};
type CmsAdminClient = {
    from(table: string): QueryBuilder;
    rpc(name: string, args: Record<string, unknown>): Promise<{
        data: unknown;
        error: DatabaseError | null;
    }>;
};

type CmsDocumentRow = {
    id: string;
    content_key: string;
    locale: CmsHomeLocale;
    current_version: number;
    published_payload: unknown;
    published_at: string | null;
    updated_at: string;
};
type CmsDraftRow = {
    id: string;
    document_id: string;
    base_version: number;
    revision: number;
    status: 'draft' | 'published' | 'discarded';
    payload: unknown;
    created_at: string;
    updated_at: string;
};
type CmsVersionRow = {
    id: string;
    document_id: string;
    version: number;
    published_at: string;
};

class RouteFailure extends Error {
    constructor(readonly response: Response) {
        super(`CMS content request failed with ${response.status}`);
    }
}

function jsonResponse(payload: unknown, status = 200): Response {
    return new Response(JSON.stringify(payload), {
        status,
        headers: jsonHeaders,
    });
}

function sameOriginRequest(request: Request): boolean {
    const origin = request.headers.get('Origin');
    if (!origin) return false;
    try {
        return new URL(origin).origin === new URL(request.url).origin;
    } catch {
        return false;
    }
}

function rpcFailure(error: DatabaseError | null, fallback: string): RouteFailure {
    const code = error?.code ?? 'unknown';
    const status = code === '40001' || code === '23505'
        ? 409
        : code === 'P0002'
            ? 404
            : code === '42501'
                ? 403
                : code === '22023' || code === '23514'
                    ? 400
                    : 500;
    return new RouteFailure(jsonResponse({ error: fallback, code }, status));
}

async function loadCmsState(admin: CmsAdminClient) {
    const [documentsResult, draftsResult, versionsResult] = await Promise.all([
        admin.from('cms_documents')
            .select('id, content_key, locale, current_version, published_payload, published_at, updated_at')
            .eq('content_key', CMS_HOME_CONTENT_KEY)
            .order('locale', { ascending: true }),
        admin.from('cms_content_drafts')
            .select('id, document_id, base_version, revision, status, payload, created_at, updated_at')
            .eq('status', 'draft')
            .order('created_at', { ascending: false }),
        admin.from('cms_content_versions')
            .select('id, document_id, version, published_at')
            .order('version', { ascending: false }),
    ]);
    if (documentsResult.error || draftsResult.error || versionsResult.error) {
        throw new RouteFailure(jsonResponse({ error: 'Could not load managed content' }, 500));
    }

    const documents = (documentsResult.data ?? []) as CmsDocumentRow[];
    const drafts = (draftsResult.data ?? []) as CmsDraftRow[];
    const versions = (versionsResult.data ?? []) as CmsVersionRow[];

    return {
        surfaces: CMS_HOME_LOCALES.map((locale) => {
            const document = documents.find((row) => row.locale === locale) ?? null;
            const draft = document
                ? drafts.find((row) => row.document_id === document.id) ?? null
                : null;
            const publishedContent = document
                ? parseCmsHomeContent(document.published_payload)
                : null;
            const draftContent = draft ? parseCmsHomeContent(draft.payload) : null;

            return {
                locale,
                effective_payload: publishedContent ?? getDefaultCmsHomeContent(locale),
                document: document ? {
                    id: document.id,
                    current_version: document.current_version,
                    published_at: document.published_at,
                    updated_at: document.updated_at,
                    published_valid: publishedContent !== null,
                } : null,
                draft: draft ? {
                    id: draft.id,
                    base_version: draft.base_version,
                    revision: draft.revision,
                    status: draft.status,
                    payload: draftContent,
                    payload_valid: draftContent !== null,
                    created_at: draft.created_at,
                    updated_at: draft.updated_at,
                } : null,
                history: document
                    ? versions
                        .filter((row) => row.document_id === document.id)
                        .map((row) => ({
                            id: row.id,
                            version: row.version,
                            published_at: row.published_at,
                        }))
                    : [],
            };
        }),
    };
}

async function parseAction(request: Request) {
    let value: unknown;
    try {
        value = await request.json();
    } catch {
        throw new RouteFailure(jsonResponse({ error: 'Invalid JSON body' }, 400));
    }

    const parsed = actionSchema.safeParse(value);
    if (!parsed.success) {
        throw new RouteFailure(jsonResponse({
            error: 'Invalid content action',
            details: parsed.error.issues.map((issue) => ({
                path: issue.path.join('.'),
                message: issue.message,
            })),
        }, 400));
    }
    return parsed.data;
}

export const GET: APIRoute = async (context) => {
    const auth = await requireAdminCapability(context, 'content.read');
    if (auth.error) return auth.error;

    try {
        const server = createSupabaseServerClient(context);
        const admin = createSupabaseAdminClient() as unknown as CmsAdminClient;
        const [{ data: canWrite, error: capabilityError }, state] = await Promise.all([
            server.rpc('has_my_admin_capability', { p_capability: 'content.write' }),
            loadCmsState(admin),
        ]);
        return jsonResponse({
            ...state,
            can_write: capabilityError ? false : canWrite === true,
        });
    } catch (error) {
        return error instanceof RouteFailure
            ? error.response
            : jsonResponse({ error: 'Could not load managed content' }, 500);
    }
};

export const POST: APIRoute = async (context) => {
    if (!sameOriginRequest(context.request)) {
        return jsonResponse({ error: 'Forbidden' }, 403);
    }
    const auth = await requireAdminCapability(context, 'content.write');
    if (auth.error || !auth.user) return auth.error;

    try {
        const action = await parseAction(context.request);
        const admin = createSupabaseAdminClient() as unknown as CmsAdminClient;
        let error: DatabaseError | null = null;

        if (action.action === 'create_draft') {
            ({ error } = await admin.rpc('create_cms_content_draft', {
                p_actor_id: auth.user.id,
                p_content_key: CMS_HOME_CONTENT_KEY,
                p_locale: action.locale,
                p_initial_payload: getDefaultCmsHomeContent(action.locale),
            }));
        } else if (action.action === 'update_draft') {
            ({ error } = await admin.rpc('update_cms_content_draft', {
                p_actor_id: auth.user.id,
                p_draft_id: action.draftId,
                p_expected_revision: action.expectedRevision,
                p_payload: action.payload,
            }));
        } else if (action.action === 'discard_draft') {
            ({ error } = await admin.rpc('discard_cms_content_draft', {
                p_actor_id: auth.user.id,
                p_draft_id: action.draftId,
                p_expected_revision: action.expectedRevision,
            }));
        } else if (action.action === 'publish_draft') {
            ({ error } = await admin.rpc('publish_cms_content_draft', {
                p_actor_id: auth.user.id,
                p_draft_id: action.draftId,
                p_expected_revision: action.expectedRevision,
            }));
        } else {
            ({ error } = await admin.rpc('rollback_cms_content_document', {
                p_actor_id: auth.user.id,
                p_document_id: action.documentId,
                p_source_version: action.sourceVersion,
                p_expected_current_version: action.expectedCurrentVersion,
                p_operation_id: action.operationId,
            }));
        }

        if (error) throw rpcFailure(error, 'Managed content operation failed');
        return jsonResponse(await loadCmsState(admin));
    } catch (error) {
        if (error instanceof RouteFailure) return error.response;
        console.error('[CmsContent] Managed operation failed safely', {
            name: error instanceof Error ? error.name : 'unknown',
            code: (error as { code?: unknown })?.code ?? 'unknown',
        });
        return jsonResponse({ error: 'Managed content operation failed safely' }, 500);
    }
};
