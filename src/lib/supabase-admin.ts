import { createClient } from '@supabase/supabase-js';
import type { Database } from '../types/database.types';
import { requireRuntimeEnv } from './runtime-env';
import { getSupabaseRuntimeConfig, supabaseProjectRef } from './supabase-runtime-guard';

type RuntimeBindings = Record<string, unknown>;

function runtimeBinding(bindings: RuntimeBindings, key: string): string | null {
    const value = bindings[key];
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * Admin client with service role key — bypasses RLS.
 * Extracted to its own module so it can be mocked in tests.
 * Only call this on the server. Never expose the service role key to the client.
 */
export const createSupabaseAdminClient = (bindings?: RuntimeBindings) => {
    if (bindings) {
        const url = runtimeBinding(bindings, 'PUBLIC_SUPABASE_URL');
        const serviceRoleKey = runtimeBinding(bindings, 'SUPABASE_SERVICE_ROLE_KEY');
        const expectedProjectRef = runtimeBinding(bindings, 'SUPABASE_EXPECTED_PROJECT_REF');
        const actualProjectRef = supabaseProjectRef(url ?? undefined);

        if (!url || !serviceRoleKey || !expectedProjectRef || actualProjectRef !== expectedProjectRef) {
            throw new Error('Explicit Supabase admin runtime bindings are missing or invalid');
        }

        return createClient<Database>(url, serviceRoleKey);
    }

    const { url } = getSupabaseRuntimeConfig();
    return createClient<Database>(
        url,
        requireRuntimeEnv('SUPABASE_SERVICE_ROLE_KEY')
    );
};
