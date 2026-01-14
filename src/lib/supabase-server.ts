import { createServerClient, parseCookieHeader } from '@supabase/ssr';
import type { APIContext } from 'astro';

export const createSupabaseServerClient = (context: APIContext) => {
    const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL;
    const supabaseKey = import.meta.env.PUBLIC_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseKey) {
        throw new Error('Missing Supabase environment variables');
    }

    return createServerClient(supabaseUrl, supabaseKey, {
        cookies: {
            getAll() {
                const cookies = parseCookieHeader(context.request.headers.get('Cookie') ?? '');
                return cookies.map(c => ({ name: c.name, value: c.value ?? '' }));
            },
            setAll(cookiesToSet) {
                cookiesToSet.forEach(({ name, value, options }) =>
                    context.cookies.set(name, value, options)
                )
            },
        },
    });
};
