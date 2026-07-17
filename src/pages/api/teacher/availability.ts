import type { APIRoute } from 'astro';
import { createSupabaseServerClient } from '../../../lib/supabase-server';

type AvailabilityRequestBody = {
    teacherId?: unknown;
    dayOfWeek?: unknown;
    startTime?: unknown;
    endTime?: unknown;
    id?: unknown;
};

const timePattern = /^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/;

async function readAvailabilityBody(request: Request): Promise<AvailabilityRequestBody | null> {
    try {
        const body = await request.json();
        return body && typeof body === 'object' ? body as AvailabilityRequestBody : null;
    } catch {
        return null;
    }
}

function normalizeTime(value: unknown) {
    if (typeof value !== 'string' || !timePattern.test(value)) return null;
    return value.length === 5 ? `${value}:00` : value;
}

function isValidDayOfWeek(value: unknown) {
    return Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 6;
}

async function getProfileRole(supabase: ReturnType<typeof createSupabaseServerClient>, profileId: string) {
    const { data } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', profileId)
        .maybeSingle();

    return data?.role;
}

// GET: Obtener disponibilidad del profesor
export const GET: APIRoute = async (context) => {
    const supabase = createSupabaseServerClient(context);
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    }

    // Verificar rol
    const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single();

    if (!profile || (profile.role !== 'teacher' && profile.role !== 'admin')) {
        return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });
    }

    // Obtener teacherId del query param (admin puede ver de cualquier profesor)
    const url = new URL(context.request.url);
    const requestedTeacherId = url.searchParams.get('teacherId')?.trim();
    if (profile.role === 'admin' && !requestedTeacherId) {
        return new Response(JSON.stringify({ error: 'teacherId is required for admin availability queries' }), { status: 400 });
    }

    const teacherId = profile.role === 'admin' ? requestedTeacherId as string : user.id;

    if (profile.role === 'admin' && await getProfileRole(supabase, teacherId) !== 'teacher') {
        return new Response(JSON.stringify({ error: 'teacherId must belong to a teacher profile' }), { status: 400 });
    }

    const { data, error } = await supabase
        .from('teacher_availability')
        .select('*')
        .eq('teacher_id', teacherId)
        .eq('is_active', true)
        .order('day_of_week')
        .order('start_time');

    if (error) {
        return new Response(JSON.stringify({ error: 'Internal server error' }), { status: 500 });
    }

    return new Response(JSON.stringify({ availability: data }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
    });
};

// POST: Crear/actualizar disponibilidad
export const POST: APIRoute = async (context) => {
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

    const body = await readAvailabilityBody(context.request);
    if (!body) {
        return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400 });
    }

    const { teacherId, dayOfWeek, startTime, endTime } = body;
    const normalizedStartTime = normalizeTime(startTime);
    const normalizedEndTime = normalizeTime(endTime);

    // Validar datos
    if (dayOfWeek === undefined || !startTime || !endTime) {
        return new Response(JSON.stringify({ error: 'Missing required fields' }), { status: 400 });
    }

    if (!isValidDayOfWeek(dayOfWeek) || !normalizedStartTime || !normalizedEndTime) {
        return new Response(JSON.stringify({ error: 'Invalid availability slot' }), { status: 400 });
    }

    if (normalizedStartTime >= normalizedEndTime) {
        return new Response(JSON.stringify({ error: 'Invalid availability time range' }), { status: 400 });
    }
    const normalizedDayOfWeek = Number(dayOfWeek);

    // Solo admin puede crear para otro profesor
    const requestedTeacherId = typeof teacherId === 'string' ? teacherId.trim() : '';
    const targetTeacherId = profile.role === 'admin' && requestedTeacherId ? requestedTeacherId : user.id;

    if (profile.role === 'admin') {
        if (!requestedTeacherId) {
            return new Response(JSON.stringify({ error: 'teacherId is required for admin availability changes' }), { status: 400 });
        }

        if (await getProfileRole(supabase, targetTeacherId) !== 'teacher') {
            return new Response(JSON.stringify({ error: 'teacherId must belong to a teacher profile' }), { status: 400 });
        }
    }

    const { data, error } = await supabase
        .from('teacher_availability')
        .insert({
            teacher_id: targetTeacherId,
            day_of_week: normalizedDayOfWeek,
            start_time: normalizedStartTime,
            end_time: normalizedEndTime,
            is_active: true
        })
        .select()
        .single();

    if (error) {
        // A database constraint is the concurrency-safe source of truth for
        // both exact duplicates (23505) and overlapping active ranges (23P01).
        if (error.code === '23505' || error.code === '23P01') {
            return new Response(JSON.stringify({
                error: 'Availability overlaps an existing active slot',
            }), {
                status: 409,
                headers: { 'Content-Type': 'application/json' },
            });
        }
        return new Response(JSON.stringify({ error: 'Internal server error' }), { status: 500 });
    }

    return new Response(JSON.stringify({ availability: data }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' }
    });
};

// DELETE: Eliminar slot de disponibilidad
export const DELETE: APIRoute = async (context) => {
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

    const body = await readAvailabilityBody(context.request);
    if (!body) {
        return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400 });
    }

    const { id } = body;
    const slotId = typeof id === 'string' ? id.trim() : '';

    if (!slotId) {
        return new Response(JSON.stringify({ error: 'Missing availability id' }), { status: 400 });
    }

    // Soft delete (marcar como inactivo)
    const { error } = await supabase
        .from('teacher_availability')
        .update({ is_active: false })
        .eq('id', slotId)
        .eq(profile.role !== 'admin' ? 'teacher_id' : 'id', profile.role !== 'admin' ? user.id : slotId);

    if (error) {
        return new Response(JSON.stringify({ error: 'Internal server error' }), { status: 500 });
    }

    return new Response(JSON.stringify({ success: true }), { status: 200 });
};
