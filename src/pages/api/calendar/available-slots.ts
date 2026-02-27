export const config = {
    runtime: 'nodejs'
};
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
    const { data: dbSlots, error } = await supabase.rpc('get_available_slots', {
        p_teacher_id: teacherId,
        p_date: date,
        p_duration_minutes: parseInt(duration)
    });

    if (error) {
        console.error('Error getting slots:', error);
        return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }

    let finalSlots = dbSlots || [];

    // Ahora filtramos con Google Calendar
    if (finalSlots.length > 0) {
        const { data: teacherProfile } = await supabase
            .from('profiles')
            .select('email')
            .eq('id', teacherId)
            .single();

        if (teacherProfile && teacherProfile.email) {
            try {
                // Rango de TODO el día que hemos consultado
                const startTime = new Date(finalSlots[0].slot_start);
                const endTime = new Date(finalSlots[finalSlots.length - 1].slot_end);

                const { getCalendarClient } = await import('../../../lib/google/calendar');
                const calendar = getCalendarClient();
                const response = await calendar.freebusy.query({
                    requestBody: {
                        timeMin: startTime.toISOString(),
                        timeMax: endTime.toISOString(),
                        items: [{ id: teacherProfile.email }],
                        timeZone: 'Europe/Madrid',
                    },
                });

                const busySlots = response.data.calendars?.[teacherProfile.email]?.busy || [];

                // Filter out any db slot that overlaps with a Google Calendar busy slot
                if (busySlots.length > 0) {
                    finalSlots = finalSlots.filter((slot: { slot_start: string, slot_end: string }) => {
                        const sStart = new Date(slot.slot_start).getTime();
                        const sEnd = new Date(slot.slot_end).getTime();

                        // Determinar si hay superposición con ALGÚN bloque ocupado
                        const isOverlapping = busySlots.some(busy => {
                            if (!busy.start || !busy.end) return false;
                            const bStart = new Date(busy.start).getTime();
                            const bEnd = new Date(busy.end).getTime();
                            // Dos intervalos [A, B] y [C, D] se superponen si: A < D y B > C
                            return sStart < bEnd && sEnd > bStart;
                        });

                        return !isOverlapping; // Nos quedamos solo con los que NO se superponen
                    });
                }
            } catch (calErr) {
                console.error('Failed to filter slots against Google Calendar:', calErr);
                // Fallback silencioso a los slots de la BBDD si falla la API
            }
        }
    }

    return new Response(JSON.stringify({ slots: finalSlots }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
    });
};
