import type { APIRoute } from 'astro';
import { createSupabaseServerClient } from '../../../lib/supabase-server';
import { appendToDocument } from '../../../lib/google/drive';

export const config = {
    runtime: 'nodejs',
};

function extractDocIdFromUrl(url: string): string | null {
    // Matches https://docs.google.com/document/d/XXXXX/edit
    const match = url.match(/\/d\/([a-zA-Z0-9-_]+)/);
    return match ? match[1] : null;
}

export const POST: APIRoute = async (context) => {
    try {
        const supabase = createSupabaseServerClient(context);
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
            return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
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

        // Formatear el contenido para que se vea claro como "Deberes"
        const formatter = new Intl.DateTimeFormat('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
        const dateStr = classDate ? formatter.format(new Date(classDate)) : formatter.format(new Date());

        const formattedContent = `\n\n--- Deberes de la clase del ${dateStr} ---\n\n${text}\n`;

        // Añadir el contenido usando la API de Docs
        await appendToDocument(docId, formattedContent);

        return new Response(JSON.stringify({ success: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });

    } catch (error: any) {
        console.error('Append homework error:', error);
        return new Response(JSON.stringify({ error: error.message || 'Internal Server Error' }), { status: 500 });
    }
};
