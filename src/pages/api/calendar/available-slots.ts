import type { APIRoute } from 'astro';
import { normalizeClassDurationMinutes } from '../../../lib/class-duration';
import { shouldDisableExternalIntegrations } from '../../../lib/external-integrations';
import { filterSlotsAgainstGoogleViaInternalService, isInternalJobServiceConfigured } from '../../../lib/internal-job-service';
import { createSupabaseAdminClient } from '../../../lib/supabase-admin';
import { createSupabaseServerClient } from '../../../lib/supabase-server';

type AvailableSlot = {
    slot_start: string;
    slot_end: string;
};

export const GET: APIRoute = async (context) => {
    const supabase = createSupabaseServerClient(context);
    const supabaseAdmin = createSupabaseAdminClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    }

    const url = new URL(context.request.url);
    const teacherId = url.searchParams.get('teacherId');
    const date = url.searchParams.get('date');
    const duration = normalizeClassDurationMinutes(url.searchParams.get('duration'));
    const externalIntegrationsDisabled = shouldDisableExternalIntegrations();

    if (!teacherId || !date) {
        return new Response(JSON.stringify({ error: 'teacherId and date are required' }), { status: 400 });
    }

    const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single();

    const role = profile?.role;

    if (role !== 'student' && role !== 'teacher' && role !== 'admin') {
        return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });
    }

    if (role === 'teacher' && teacherId !== user.id) {
        return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });
    }

    if (role === 'student') {
        const { data: assignment } = await supabase
            .from('student_teachers')
            .select('id')
            .eq('teacher_id', teacherId)
            .eq('student_id', user.id)
            .single();

        if (!assignment) {
            return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });
        }
    }

    const { data: dbSlots, error } = await supabaseAdmin.rpc('get_available_slots', {
        p_teacher_id: teacherId,
        p_date: date,
        p_duration_minutes: duration,
    });

    if (error) {
        console.error('Error getting slots:', error);
        return new Response(JSON.stringify({ error: 'Internal server error' }), { status: 500 });
    }

    let finalSlots = (dbSlots || []) as AvailableSlot[];

    if (!externalIntegrationsDisabled && finalSlots.length > 0) {
        const { data: teacherProfile } = await supabase
            .from('profiles')
            .select('email')
            .eq('id', teacherId)
            .single();

        if (teacherProfile?.email) {
            if (!isInternalJobServiceConfigured(context)) {
                return new Response(JSON.stringify({
                    error: 'Calendar availability service is not configured',
                }), { status: 503 });
            }

            try {
                finalSlots = await filterSlotsAgainstGoogleViaInternalService(context, {
                    teacherEmail: teacherProfile.email,
                    slots: finalSlots,
                });
            } catch (error) {
                console.error('Failed to filter slots against Google Calendar:', error);
                return new Response(JSON.stringify({
                    error: 'Cannot verify Google Calendar availability right now',
                }), { status: 503 });
            }
        }
    }

    return new Response(JSON.stringify({ slots: finalSlots }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
    });
};
