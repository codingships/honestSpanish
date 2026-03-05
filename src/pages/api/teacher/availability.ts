import type { APIRoute } from 'astro';
import { createSupabaseServerClient } from '../../../lib/supabase-server';

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
    const teacherId = profile.role === 'admin'
        ? url.searchParams.get('teacherId') || user.id
        : user.id;

    const { data, error } = await supabase
        .from('teacher_availability')
        .select('*')
        .eq('teacher_id', teacherId)
        .eq('is_active', true)
        .order('day_of_week')
        .order('start_time');

    if (error) {
        return new Response(JSON.stringify({ error: error.message }), { status: 500 });
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

    const body = await context.request.json();
    const { teacherId, dayOfWeek, startTime, endTime } = body;

    // Solo admin puede crear para otro profesor
    const targetTeacherId = profile.role === 'admin' && teacherId ? teacherId : user.id;

    // Validar datos
    if (dayOfWeek === undefined || !startTime || !endTime) {
        return new Response(JSON.stringify({ error: 'Missing required fields' }), { status: 400 });
    }

    const { data, error } = await supabase
        .from('teacher_availability')
        .insert({
            teacher_id: targetTeacherId,
            day_of_week: dayOfWeek,
            start_time: startTime,
            end_time: endTime,
            is_active: true
        })
        .select()
        .single();

    if (error) {
        // Si es duplicado, ignorar
        if (error.code === '23505') {
            return new Response(JSON.stringify({ message: 'Slot already exists' }), { status: 200 });
        }
        return new Response(JSON.stringify({ error: error.message }), { status: 500 });
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

    const body = await context.request.json();
    const { id } = body;

    if (!id) {
        return new Response(JSON.stringify({ error: 'Missing availability id' }), { status: 400 });
    }

    // Soft delete (marcar como inactivo)
    const { error } = await supabase
        .from('teacher_availability')
        .update({ is_active: false })
        .eq('id', id)
        .eq(profile.role !== 'admin' ? 'teacher_id' : 'id', profile.role !== 'admin' ? user.id : id);

    if (error) {
        return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }

    return new Response(JSON.stringify({ success: true }), { status: 200 });
};
