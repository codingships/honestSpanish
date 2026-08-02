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

const jsonHeaders = {
    'Cache-Control': 'private, no-store',
    'Content-Type': 'application/json; charset=utf-8',
};

function json(payload: unknown, status = 200): Response {
    return new Response(JSON.stringify(payload), { status, headers: jsonHeaders });
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
        return json({ error: 'Unauthorized' }, 401);
    }

    // Verificar rol
    const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single();

    if (!profile || (profile.role !== 'teacher' && profile.role !== 'admin')) {
        return json({ error: 'Forbidden' }, 403);
    }

    // Obtener teacherId del query param (admin puede ver de cualquier profesor)
    const url = new URL(context.request.url);
    const requestedTeacherId = url.searchParams.get('teacherId')?.trim();
    if (profile.role === 'admin' && !requestedTeacherId) {
        return json({ error: 'teacherId is required for admin availability queries' }, 400);
    }

    const teacherId = profile.role === 'admin' ? requestedTeacherId as string : user.id;

    if (profile.role === 'admin' && await getProfileRole(supabase, teacherId) !== 'teacher') {
        return json({ error: 'teacherId must belong to a teacher profile' }, 400);
    }

    const { data, error } = await supabase
        .from('teacher_availability')
        .select('*')
        .eq('teacher_id', teacherId)
        .eq('is_active', true)
        .order('day_of_week')
        .order('start_time');

    if (error) {
        return json({ error: 'Internal server error' }, 500);
    }

    return json({ availability: data });
};

// POST: Crear/actualizar disponibilidad
export const POST: APIRoute = async (context) => {
    if (!sameOriginRequest(context.request)) return json({ error: 'Forbidden' }, 403);

    const supabase = createSupabaseServerClient(context);
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
        return json({ error: 'Unauthorized' }, 401);
    }

    const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single();

    if (!profile || (profile.role !== 'teacher' && profile.role !== 'admin')) {
        return json({ error: 'Forbidden' }, 403);
    }

    const body = await readAvailabilityBody(context.request);
    if (!body) {
        return json({ error: 'Invalid JSON body' }, 400);
    }

    const { teacherId, dayOfWeek, startTime, endTime } = body;
    const normalizedStartTime = normalizeTime(startTime);
    const normalizedEndTime = normalizeTime(endTime);

    // Validar datos
    if (dayOfWeek === undefined || !startTime || !endTime) {
        return json({ error: 'Missing required fields' }, 400);
    }

    if (!isValidDayOfWeek(dayOfWeek) || !normalizedStartTime || !normalizedEndTime) {
        return json({ error: 'Invalid availability slot' }, 400);
    }

    if (normalizedStartTime >= normalizedEndTime) {
        return json({ error: 'Invalid availability time range' }, 400);
    }
    const normalizedDayOfWeek = Number(dayOfWeek);

    // Solo admin puede crear para otro profesor
    const requestedTeacherId = typeof teacherId === 'string' ? teacherId.trim() : '';
    const targetTeacherId = profile.role === 'admin' && requestedTeacherId ? requestedTeacherId : user.id;

    if (profile.role === 'admin') {
        if (!requestedTeacherId) {
            return json({ error: 'teacherId is required for admin availability changes' }, 400);
        }

        if (await getProfileRole(supabase, targetTeacherId) !== 'teacher') {
            return json({ error: 'teacherId must belong to a teacher profile' }, 400);
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
            return json({
                error: 'Availability overlaps an existing active slot',
            }, 409);
        }
        return json({ error: 'Internal server error' }, 500);
    }

    return json({ availability: data }, 201);
};

// DELETE: Eliminar slot de disponibilidad
export const DELETE: APIRoute = async (context) => {
    if (!sameOriginRequest(context.request)) return json({ error: 'Forbidden' }, 403);

    const supabase = createSupabaseServerClient(context);
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
        return json({ error: 'Unauthorized' }, 401);
    }

    const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single();

    if (!profile || (profile.role !== 'teacher' && profile.role !== 'admin')) {
        return json({ error: 'Forbidden' }, 403);
    }

    const body = await readAvailabilityBody(context.request);
    if (!body) {
        return json({ error: 'Invalid JSON body' }, 400);
    }

    const { id } = body;
    const slotId = typeof id === 'string' ? id.trim() : '';

    if (!slotId) {
        return json({ error: 'Missing availability id' }, 400);
    }

    // Soft delete (marcar como inactivo)
    let updateQuery = supabase
        .from('teacher_availability')
        .update({ is_active: false })
        .eq('id', slotId);

    if (profile.role !== 'admin') {
        updateQuery = updateQuery.eq('teacher_id', user.id);
    }

    const { data, error } = await updateQuery
        .select('id')
        .maybeSingle();

    if (error) {
        if (error.code === '23514' || error.message?.includes('bookable_slot')) {
            return json({ error: 'Pause or retire the published places before removing this availability' }, 409);
        }
        return json({ error: 'Internal server error' }, 500);
    }

    if (!data) return json({ error: 'Availability not found' }, 404);

    return json({ success: true });
};
