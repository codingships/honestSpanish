import { createClient } from '@supabase/supabase-js';
import type { Database } from '../types/database.types';

/**
 * Admin client with service role key — bypasses RLS.
 * Extracted to its own module so it can be mocked in tests.
 * Only call this on the server. Never expose the service role key to the client.
 */
export const createSupabaseAdminClient = () =>
    createClient<Database>(
        import.meta.env.PUBLIC_SUPABASE_URL,
        import.meta.env.SUPABASE_SERVICE_ROLE_KEY
    );
