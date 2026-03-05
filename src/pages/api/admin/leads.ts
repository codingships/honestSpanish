import type { APIRoute } from 'astro';
import { createSupabaseServerClient } from '../../../lib/supabase-server';

// Forzamos Node.js runtime para compatibilidad Edge/Serverless en Astro 5
export const config = {
    runtime: 'nodejs'
};

// [GET] Listar todos los leads capturados (Requerido: Rol 'admin')
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

    // Extracción de datos (ordenados por fecha descendente, los más nuevos arriba)
    const { data: leads, error } = await supabase
        .from('leads')
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .select('*' as any) // Se añade cast seguro hasta que TS regenere tipos localmente con la nueva columna
        .order('created_at', { ascending: false });

    if (error) {
        return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }

    return new Response(JSON.stringify(leads), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
    });
};

// [PUT] Actualizar el estado (status) de un lead específico en el CRM
export const PUT: APIRoute = async (context) => {
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
        return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });
    }

    // Leer payload del front-end
    const body = await context.request.json();
    const { leadId, newStatus } = body;

    // Validación defensiva
    if (!leadId || !newStatus) {
        return new Response(JSON.stringify({ error: 'Missing leadId or newStatus parameters' }), { status: 400 });
    }

    if (!['new', 'contacted', 'discarded'].includes(newStatus)) {
        return new Response(JSON.stringify({ error: 'Invalid status value. Must be new, contacted, or discarded' }), { status: 400 });
    }

    // Ejecutar la mutación en Base de Datos
    const { error: updateError } = await supabase
        .from('leads')
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .update({ status: newStatus } as any) // Casting as any to bypass temporary type missing
        .eq('id', leadId);

    if (updateError) {
        return new Response(JSON.stringify({ error: updateError.message }), { status: 500 });
    }

    return new Response(JSON.stringify({ success: true, message: `Lead status updated to ${newStatus}` }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
    });
};
