import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../types/database.types';
import { createSupabaseAdminClient } from './supabase-admin';

type ProfilePrivateRow = Database['public']['Tables']['profiles_private']['Row'];
type ProfilePrivateUpdate = Database['public']['Tables']['profiles_private']['Update'];

const PROFILE_PRIVATE_SELECT = `
    profile_id,
    stripe_customer_id,
    stripe_customer_account_id,
    stripe_customer_livemode,
    drive_folder_id,
    drive_folder_url,
    google_account_email,
    notes,
    current_level,
    created_at,
    updated_at
`;

const getAdminClient = (client?: SupabaseClient<Database>) => client ?? createSupabaseAdminClient();

export async function getPrivateProfile(
    profileId: string,
    client?: SupabaseClient<Database>
): Promise<ProfilePrivateRow | null> {
    const supabaseAdmin = getAdminClient(client);
    const { data, error } = await supabaseAdmin
        .from('profiles_private')
        .select(PROFILE_PRIVATE_SELECT)
        .eq('profile_id', profileId)
        .maybeSingle();

    if (error) {
        throw error;
    }

    return data;
}

export async function getPrivateProfiles(
    profileIds: string[],
    client?: SupabaseClient<Database>
): Promise<Map<string, ProfilePrivateRow>> {
    const uniqueIds = [...new Set(profileIds.filter(Boolean))];
    if (uniqueIds.length === 0) {
        return new Map();
    }

    const supabaseAdmin = getAdminClient(client);
    const { data, error } = await supabaseAdmin
        .from('profiles_private')
        .select(PROFILE_PRIVATE_SELECT)
        .in('profile_id', uniqueIds);

    if (error) {
        throw error;
    }

    return new Map((data ?? []).map((row) => [row.profile_id, row]));
}

export async function upsertPrivateProfile(
    profileId: string,
    patch: Omit<ProfilePrivateUpdate, 'profile_id'>,
    client?: SupabaseClient<Database>
): Promise<ProfilePrivateRow> {
    const supabaseAdmin = getAdminClient(client);
    const { data: updatedData, error: updateError } = await supabaseAdmin
        .from('profiles_private')
        .update(patch)
        .eq('profile_id', profileId)
        .select(PROFILE_PRIVATE_SELECT)
        .maybeSingle();

    if (updateError) {
        throw updateError;
    }

    if (updatedData) {
        return updatedData;
    }

    const { data: insertedData, error: insertError } = await supabaseAdmin
        .from('profiles_private')
        .insert({ profile_id: profileId, ...patch })
        .select(PROFILE_PRIVATE_SELECT)
        .single();

    if (insertError) {
        throw insertError;
    }

    return insertedData;
}
