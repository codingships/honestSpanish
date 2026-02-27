import type { APIRoute } from 'astro';
import { createSupabaseServerClient } from '../../../lib/supabase-server';

export const config = {
    runtime: 'nodejs'
};

export const GET: APIRoute = async (context) => {
    const supabase = createSupabaseServerClient(context);

    // Detección de sesión activa
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

    // 1. Obtener todos los Profesores Activos
    const { data: teachers, error: teachersError } = await supabase
        .from('profiles')
        .select('id, full_name, email')
        .eq('role', 'teacher')
        .order('full_name');

    if (teachersError) {
        return new Response(JSON.stringify({ error: 'Error fetching teachers' }), { status: 500 });
    }

    // 2. Obtener Estudiantes con sus Suscripciones Activas y Profesores Asignados
    // Se extrae la relación con subscriptions (para saber su plan y sesiones)
    // Se extrae la relación con student_teachers (para saber quién es su mentor)
    const { data: students, error: studentsError } = await supabase
        .from('profiles')
        .select(`
            id, 
            full_name, 
            email, 
            created_at,
            subscriptions (
                id,
                status,
                sessions_total,
                sessions_used,
                package:packages(name, display_name)
            ),
            assigned_teachers:student_teachers!student_teachers_student_id_fkey (
                teacher:profiles!student_teachers_teacher_id_fkey(id, full_name)
            )
        `)
        .eq('role', 'student')
        .order('created_at', { ascending: false });

    if (studentsError) {
        return new Response(JSON.stringify({ error: 'Error fetching students' }), { status: 500 });
    }

    // 3. Empaquetar y limpiar la respuesta para FrontEnd
    const formattedStudents = students?.map(student => {
        // Encontrar si tiene una suscripción activa
        const activeSub = Array.isArray(student.subscriptions)
            ? student.subscriptions.find((sub: any) => sub.status === 'active')
            : (student.subscriptions as any)?.status === 'active' ? student.subscriptions : null;

        // Extraer el profesor principal asignado (si lo tiene)
        let primaryTeacher = null;
        if (student.assigned_teachers && Array.isArray(student.assigned_teachers) && student.assigned_teachers.length > 0) {
            primaryTeacher = student.assigned_teachers[0].teacher;
        }

        return {
            id: student.id,
            fullName: student.full_name,
            email: student.email,
            createdAt: student.created_at,
            activeSubscription: activeSub,
            primaryTeacher: primaryTeacher
        };
    });

    return new Response(JSON.stringify({
        teachers: teachers || [],
        students: formattedStudents || []
    }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
    });
};
