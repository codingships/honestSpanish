import { createServerClient, parseCookieHeader } from '@supabase/ssr';

export const createSupabaseServerClient = (context) => {
    const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL;
    const supabaseKey = import.meta.env.PUBLIC_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseKey) {
        throw new Error('Missing Supabase environment variables');
    }

    return createServerClient(supabaseUrl, supabaseKey, {
        cookies: {
            getAll() {
                return parseCookieHeader(context.request.headers.get('Cookie') ?? '');
            },
            setAll(cookiesToSet) {
                cookiesToSet.forEach(({ name, value, options }) =>
                    context.cookies.set(name, value, options)
                )
            },
        },
    });
};
