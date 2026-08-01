import type { APIRoute } from 'astro';
import {
    loadLatestCheckoutV2Progress,
    resolveCheckoutV2AcademicProgress,
} from '../../../lib/checkout-v2-progress';
import { createSupabaseAdminClient } from '../../../lib/supabase-admin';
import { createSupabaseServerClient } from '../../../lib/supabase-server';

export const config = {
    runtime: 'nodejs'
};

const ADMIN_USERS_PAGE_SIZE = 500;

async function loadAllPages<T>(
    loadPage: (from: number, to: number) => Promise<{ data: T[] | null; error: unknown }>,
): Promise<{ data: T[]; error: unknown | null }> {
    const data: T[] = [];

    for (let from = 0; ; from += ADMIN_USERS_PAGE_SIZE) {
        const page = await loadPage(from, from + ADMIN_USERS_PAGE_SIZE - 1);
        if (page.error) {
            return { data: [], error: page.error };
        }

        const rows = page.data ?? [];
        data.push(...rows);
        if (rows.length < ADMIN_USERS_PAGE_SIZE) {
            return { data, error: null };
        }
    }
}

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
    const { data: teachers, error: teachersError } = await loadAllPages(async (from, to) => {
        const result = await supabase
            .from('profiles')
            .select('id, full_name, email')
            .eq('role', 'teacher')
            .order('full_name')
            .order('id', { ascending: true })
            .range(from, to);
        return result;
    });

    if (teachersError) {
        return new Response(JSON.stringify({ error: 'Error fetching teachers' }), { status: 500 });
    }

    // 2. Obtener Estudiantes con sus Suscripciones Activas y Profesores Asignados
    // Se extrae la relación con subscriptions (para saber su plan y sesiones)
    // Se extrae la relación con student_teachers (para saber quién es su mentor)
    const { data: students, error: studentsError } = await loadAllPages(async (from, to) => {
        const result = await supabase
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
                    contract_schema_version,
                    package:packages(name, display_name)
                ),
                assigned_teachers:student_teachers!student_teachers_student_id_fkey (
                    teacher:profiles!student_teachers_teacher_id_fkey(id, full_name)
                )
            `)
            .eq('role', 'student')
            .order('created_at', { ascending: false })
            .order('id', { ascending: true })
            .range(from, to);
        return result;
    });

    if (studentsError) {
        return new Response(JSON.stringify({ error: 'Error fetching students' }), { status: 500 });
    }

    const activeSubscriptions = (students ?? []).flatMap((student) => {
        const subscription = (student.subscriptions ?? [])
            .find((candidate) => candidate.status === 'active');
        return subscription ? [subscription] : [];
    });
    const checkoutV2SubscriptionIds = activeSubscriptions
        .filter((subscription) => subscription.contract_schema_version === 2)
        .map((subscription) => subscription.id);

    let progressBySubscription;
    try {
        progressBySubscription = await loadLatestCheckoutV2Progress(
            createSupabaseAdminClient(),
            checkoutV2SubscriptionIds,
        );
    } catch (error) {
        console.error('[AdminUsers] Could not load Checkout V2 progress', {
            code: error instanceof Error ? error.message : 'unknown',
        });
        return new Response(JSON.stringify({ error: 'Error fetching academic progress' }), { status: 503 });
    }

    const invalidCheckoutV2Progress = checkoutV2SubscriptionIds.some((subscriptionId) => {
        const resolved = resolveCheckoutV2AcademicProgress(
            2,
            progressBySubscription.get(subscriptionId),
        );
        return resolved.state === 'missing' || resolved.state === 'inconsistent';
    });

    if (invalidCheckoutV2Progress) {
        console.error('[AdminUsers] Checkout V2 progress is missing or inconsistent', {
            code: 'CHECKOUT_V2_PROGRESS_INCONSISTENT',
        });
        return new Response(JSON.stringify({ error: 'Error fetching academic progress' }), { status: 503 });
    }

    // 3. Empaquetar y limpiar la respuesta para FrontEnd
    const formattedStudents = students?.map(student => {
        // Encontrar si tiene una suscripción activa
        const activeSub = (student.subscriptions ?? [])
            .find((sub) => sub.status === 'active');
        const cycleProgress = activeSub?.contract_schema_version === 2
            ? progressBySubscription.get(activeSub.id) ?? null
            : null;
        const resolvedProgress = activeSub
            ? resolveCheckoutV2AcademicProgress(activeSub.contract_schema_version, cycleProgress)
            : null;
        const academicProgress = !activeSub
            ? null
            : resolvedProgress?.state === 'legacy'
                ? { state: 'legacy' as const, consumedSessions: null, sessionsTotal: null }
                : resolvedProgress?.state === 'ready'
                    ? {
                        state: 'ready' as const,
                        consumedSessions: resolvedProgress.consumed,
                        sessionsTotal: resolvedProgress.total,
                    }
                    : resolvedProgress?.state === 'pending'
                        ? { state: 'pending' as const, consumedSessions: null, sessionsTotal: cycleProgress?.sessions_total ?? null }
                        : { state: 'inconsistent' as const, consumedSessions: null, sessionsTotal: null };

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
            activeSubscription: activeSub ? { ...activeSub, academicProgress } : null,
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
