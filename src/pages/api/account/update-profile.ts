import type { APIRoute } from 'astro';
import { createSupabaseServerClient } from '../../../lib/supabase-server';

const SUPPORTED_LANGUAGES = new Set(['es', 'en', 'ru']);

function optionalString(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export const POST: APIRoute = async (context) => {
    try {
        // Get Supabase client and verify user
        const supabase = createSupabaseServerClient(context);
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
            return new Response(JSON.stringify({ error: 'Unauthorized' }), {
                status: 401,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        let body: Record<string, unknown>;
        try {
            body = await context.request.json();
        } catch {
            return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        const fullName = optionalString(body.fullName);
        const phone = optionalString(body.phone);
        const preferredLanguage = typeof body.preferredLanguage === 'string' && SUPPORTED_LANGUAGES.has(body.preferredLanguage)
            ? body.preferredLanguage
            : 'es';
        const timezone = optionalString(body.timezone);

        // Validate timezone is a real IANA timezone
        let safeTimezone = 'Europe/Madrid';
        if (timezone) {
            try {
                Intl.DateTimeFormat(undefined, { timeZone: timezone });
                safeTimezone = timezone;
            } catch {
                // Invalid timezone, use default
            }
        }

        // Update profile
        const { error: updateError } = await supabase
            .from('profiles')
            .update({
                full_name: fullName,
                phone,
                preferred_language: preferredLanguage,
                timezone: safeTimezone,
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
