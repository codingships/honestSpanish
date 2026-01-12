import { createBrowserClient } from '@supabase/ssr';

const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL;
const supabaseKey = import.meta.env.PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing Supabase environment variables');
}

// Use createBrowserClient from @supabase/ssr for cookie-based auth
// This ensures the session is stored in cookies and accessible by the server
export const supabase = createBrowserClient(supabaseUrl, supabaseKey);
