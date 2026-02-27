import type { APIRoute } from 'astro';
import { createSupabaseServerClient } from '../../../lib/supabase-server';

// Forzamos Node.js para edge compatibility
export const config = {
    runtime: 'nodejs'
};

// [POST] Asignar un Profesor a un Estudiante (Requerido: Rol 'admin')
export const POST: APIRoute = async (context) => {
    const supabase = createSupabaseServerClient(context);

    // Auth Check
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    }

    // Role-based Access Control (RBAC): Únicamente Admin
    const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single();

    if (profile?.role !== 'admin') {
        return new Response(JSON.stringify({ error: 'Forbidden. Admin privileges required.' }), { status: 403 });
    }

    // Leer payload
    const body = await context.request.json();
    const { studentId, teacherId } = body;

    if (!studentId || !teacherId) {
        return new Response(JSON.stringify({ error: 'Missing studentId or teacherId' }), { status: 400 });
    }

    // 1. Verificar si el estudiante ya tiene un profesor primario asignado
    const { data: existingAssignment, error: existingError } = await supabase
        .from('student_teachers')
        .select('id, teacher_id')
        .eq('student_id', studentId)
        .eq('is_primary', true)
        .single();

    if (existingError && existingError.code !== 'PGRST116') { // PGRST116 = No rows found (lo cual es normal si es nuevo)
        return new Response(JSON.stringify({ error: 'Error comprobando asignaciones previas' }), { status: 500 });
    }

    // 2. Si hay asignación previa y el ID es distinto, borrar/reemplazar o actualizar
    if (existingAssignment) {
        // Upsert reemplazando el teacher ID
        const { error: updateError } = await supabase
            .from('student_teachers')
            .update({ teacher_id: teacherId, assigned_at: new Date().toISOString() })
            .eq('id', existingAssignment.id);

        if (updateError) {
            return new Response(JSON.stringify({ error: 'Failed to re-assign teacher' }), { status: 500 });
        }
    } else {
        // 3. Crear nueva asignación pura
        const { error: insertError } = await supabase
            .from('student_teachers')
            .insert({
                student_id: studentId,
                teacher_id: teacherId,
                is_primary: true
            });

        if (insertError) {
            // Verificar si violamos la key unique (student_id, teacher_id) que estaba como no primaria
            if (insertError.code === '23505') {
                await supabase
                    .from('student_teachers')
                    .update({ is_primary: true })
                    .eq('student_id', studentId)
                    .eq('teacher_id', teacherId);
            } else {
                return new Response(JSON.stringify({ error: 'Failed to assign teacher' }), { status: 500 });
            }
        }
    }

    return new Response(JSON.stringify({ success: true, message: 'Teacher successfully assigned' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
    });
};
