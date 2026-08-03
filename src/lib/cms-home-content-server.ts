import type { SupportedLang } from '../i18n/utils';
import { createSupabaseAdminClient } from './supabase-admin';
import {
    CMS_HOME_CONTENT_KEY,
    parseCmsHomeContent,
    type CmsHomeContent,
} from './cms-home-content';

type DatabaseError = { code?: string; message?: string };
type CmsDocumentResult = PromiseLike<{
    data: unknown;
    error: DatabaseError | null;
}>;
type CmsDocumentQuery = CmsDocumentResult & {
    select(columns: string): CmsDocumentQuery;
    eq(column: string, value: unknown): CmsDocumentQuery;
    maybeSingle(): Promise<{ data: unknown; error: DatabaseError | null }>;
};
type CmsDocumentReader = {
    from(table: string): CmsDocumentQuery;
};

type PublishedDocumentRow = {
    current_version: number;
    published_payload: unknown;
};

export type PublishedCmsHomeContent = {
    content: CmsHomeContent;
    version: number;
};

export async function loadPublishedCmsHomeContent(
    lang: SupportedLang,
    reader: CmsDocumentReader = createSupabaseAdminClient() as unknown as CmsDocumentReader,
): Promise<PublishedCmsHomeContent | null> {
    try {
        const { data, error } = await reader
            .from('cms_documents')
            .select('current_version, published_payload')
            .eq('content_key', CMS_HOME_CONTENT_KEY)
            .eq('locale', lang)
            .maybeSingle();

        if (error) {
            console.error('[CmsContent] Published home lookup unavailable', {
                code: error.code ?? 'unknown',
                locale: lang,
            });
            return null;
        }
        if (!data) return null;

        const row = data as PublishedDocumentRow;
        const content = parseCmsHomeContent(row.published_payload);
        if (!content || !Number.isInteger(row.current_version) || row.current_version <= 0) {
            console.error('[CmsContent] Published home payload is invalid', {
                locale: lang,
            });
            return null;
        }

        return { content, version: row.current_version };
    } catch (error) {
        console.error('[CmsContent] Published home lookup failed safely', {
            name: error instanceof Error ? error.name : 'unknown',
            locale: lang,
        });
        return null;
    }
}
