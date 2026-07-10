import { createServerClient, parseCookieHeader } from '@supabase/ssr';
import type { APIContext } from 'astro';
// 👇 1. Importamos la definición de la Base de Datos
import type { Database } from '../types/database.types';
import { getSupabaseAnonKey, getSupabaseRuntimeConfig } from './supabase-runtime-guard';

export const createSupabaseServerClient = (context: APIContext) => {
    const { url: supabaseUrl } = getSupabaseRuntimeConfig(context);
    const supabaseKey = getSupabaseAnonKey(context);

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
                    } catch {
                        // Handle ResponseSentError and Astro Cookie Warnings silently
                        // Thrown in Astro when Supabase tries to refresh the token mid-render or after headers are sent
                    }
                });
            },
        },
    });
};
