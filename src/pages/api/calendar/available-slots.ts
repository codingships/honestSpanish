import type { APIRoute } from 'astro';
import { createSupabaseServerClient } from '../../../lib/supabase-server';

export const GET: APIRoute = async (context) => {
    const supabase = createSupabaseServerClient(context);
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    }

    const url = new URL(context.request.url);
    const teacherId = url.searchParams.get('teacherId');
    const date = url.searchParams.get('date'); // formato: YYYY-MM-DD
    const duration = url.searchParams.get('duration') || '60';

    if (!teacherId || !date) {
        return new Response(JSON.stringify({ error: 'teacherId and date are required' }), { status: 400 });
    }

    // Llamar a la función de Postgres
    const { data, error } = await supabase.rpc('get_available_slots', {
        p_teacher_id: teacherId,
        p_date: date,
        p_duration_minutes: parseInt(duration)
    });

    if (error) {
        console.error('Error getting slots:', error);
        return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }

    return new Response(JSON.stringify({ slots: data || [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
    });
};
