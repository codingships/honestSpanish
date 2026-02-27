import { createServerClient, parseCookieHeader } from '@supabase/ssr';
import type { APIContext } from 'astro';
// 👇 1. Importamos la definición de la Base de Datos
import type { Database } from '../types/database.types';

export const createSupabaseServerClient = (context: APIContext) => {
    const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL;
    const supabaseKey = import.meta.env.PUBLIC_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseKey) {
        throw new Error('Missing Supabase environment variables');
    }

    // 👇 2. Inyectamos el tipo <Database> aquí
    return createServerClient<Database>(supabaseUrl, supabaseKey, {
        cookies: {
            getAll() {
                const cookies = parseCookieHeader(context.request.headers.get('Cookie') ?? '');
                return cookies.map(c => ({ name: c.name, value: c.value ?? '' }));
            },
            setAll(cookiesToSet) {
                cookiesToSet.forEach(({ name, value, options }) => {
                    try {
                        if (context.cookies.has(name) && context.cookies.get(name)?.value === value) return; // Prevent redunant sets
                        context.cookies.set(name, value, options);
                    } catch (error: any) {
                        // Handle ResponseSentError and Astro Cookie Warnings silently
                        // Thrown in Astro when Supabase tries to refresh the token mid-render or after headers are sent
                    }
                });
            },
        },
    });
};