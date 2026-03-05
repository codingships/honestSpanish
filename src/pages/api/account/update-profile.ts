import type { APIRoute } from 'astro';
import { createSupabaseServerClient } from '../../../lib/supabase-server';

export const POST: APIRoute = async (context) => {
    try {
        const body = await context.request.json();
        const { fullName, phone, preferredLanguage, timezone } = body;

        // Get Supabase client and verify user
        const supabase = createSupabaseServerClient(context);
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
            return new Response(JSON.stringify({ error: 'Unauthorized' }), {
                status: 401,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        // Update profile
        const { error: updateError } = await supabase
            .from('profiles')
            .update({
                full_name: fullName || null,
                phone: phone || null,
                preferred_language: preferredLanguage || 'es',
                timezone: timezone || 'Europe/Madrid',
                updated_at: new Date().toISOString(),
            })
            .eq('id', user.id);

        if (updateError) {
            console.error('Error updating profile:', updateError);
            return new Response(JSON.stringify({ error: 'Failed to update profile' }), {
                status: 500,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        return new Response(JSON.stringify({ success: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        });
    } catch (error) {
        console.error('Update profile error:', error);
        return new Response(JSON.stringify({ error: 'Internal server error' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }
};
