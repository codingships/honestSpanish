import type { APIRoute } from 'astro';
import { callInternalJobService } from '../../../lib/internal-job-service';
import { createSupabaseServerClient } from '../../../lib/supabase-server';

function extractDocIdFromUrl(url: string): string | null {
    let parsedUrl: URL;
    try {
        parsedUrl = new URL(url);
    } catch {
        return null;
    }

    if (!['docs.google.com', 'drive.google.com'].includes(parsedUrl.hostname)) {
        return null;
    }

    const match = parsedUrl.pathname.match(/\/d\/([a-zA-Z0-9-_]+)/);
    return match ? match[1] : null;
}

export const POST: APIRoute = async (context) => {
    try {
        const supabase = createSupabaseServerClient(context);
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
            return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
        }

        const { data: profile } = await supabase
            .from('profiles')
            .select('role')
            .eq('id', user.id)
            .single();

        if (!profile || (profile.role !== 'teacher' && profile.role !== 'admin')) {
            return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });
        }

        const body = await context.request.json();
        const { docUrl, text, classDate } = body;

        if (!docUrl || !text) {
            return new Response(JSON.stringify({ error: 'Missing docUrl or text' }), { status: 400 });
        }

        const docId = extractDocIdFromUrl(docUrl);
        if (!docId) {
            return new Response(JSON.stringify({ error: 'Invalid Google Doc URL format' }), { status: 400 });
        }

        if (profile.role !== 'admin') {
            const { data: ownerSessionById } = await supabase
                .from('sessions')
                .select('id')
                .eq('drive_doc_id', docId)
                .eq('teacher_id', user.id)
                .limit(1)
                .maybeSingle();

            const { data: ownerSessionByUrl } = ownerSessionById
                ? { data: null }
                : await supabase
                    .from('sessions')
                    .select('id')
                    .eq('drive_doc_url', docUrl)
                    .eq('teacher_id', user.id)
                    .limit(1)
                    .maybeSingle();

            if (!ownerSessionById && !ownerSessionByUrl) {
                return new Response(JSON.stringify({ error: 'Forbidden: doc not assigned to you' }), { status: 403 });
            }
        }

        const formatter = new Intl.DateTimeFormat('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
        const dateStr = classDate ? formatter.format(new Date(classDate)) : formatter.format(new Date());
        const formattedContent = `\n\n--- Deberes de la clase del ${dateStr} ---\n\n${text}\n`;

        await callInternalJobService('/internal/drive/append-homework', {
            docId,
            content: formattedContent,
        }, { context });

        return new Response(JSON.stringify({ success: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        });
    } catch (error: unknown) {
        console.error('Append homework error:', error);
        return new Response(JSON.stringify({ error: 'Internal server error' }), { status: 500 });
    }
};
