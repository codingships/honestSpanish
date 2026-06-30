import type { APIRoute } from 'astro';
import { z } from 'zod';
import { callInternalJobService } from '../../../lib/internal-job-service';
import { getPrivateProfile } from '../../../lib/profiles-private';
import { createSupabaseServerClient } from '../../../lib/supabase-server';

const linkGoogleDriveSchema = z.object({
    googleAccountEmail: z.string().trim().email(),
});

export const POST: APIRoute = async (context) => {
    try {
        const supabase = createSupabaseServerClient(context);
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
            return new Response(JSON.stringify({ error: 'Unauthorized' }), {
                status: 401,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        const { data: profile, error: profileError } = await supabase
            .from('profiles')
            .select('role')
            .eq('id', user.id)
            .single();

        if (profileError || !profile) {
            return new Response(JSON.stringify({ error: 'Profile not found' }), {
                status: 404,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        if (profile.role !== 'student') {
            return new Response(JSON.stringify({ error: 'Forbidden' }), {
                status: 403,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        let rawBody: unknown;
        try {
            rawBody = await context.request.json();
        } catch {
            return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        const parsedBody = linkGoogleDriveSchema.safeParse(rawBody);
        if (!parsedBody.success) {
            return new Response(JSON.stringify({ error: 'Invalid Google account email' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        const googleAccountEmail = parsedBody.data.googleAccountEmail.toLowerCase();
        const profilePrivate = await getPrivateProfile(user.id);

        if (!profilePrivate?.drive_folder_id) {
            return new Response(JSON.stringify({ error: 'Drive folder not ready yet' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        const updatedPrivateProfile = await callInternalJobService<{
            driveFolderUrl: string | null;
            googleAccountEmail: string;
        }>('/internal/account/link-google-drive', {
            userId: user.id,
            googleAccountEmail,
        }, { context });

        return new Response(JSON.stringify({
            success: true,
            driveFolderUrl: updatedPrivateProfile.driveFolderUrl,
            googleAccountEmail: updatedPrivateProfile.googleAccountEmail,
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        });
    } catch (error) {
        console.error('Link Google Drive error:', error);
        return new Response(JSON.stringify({ error: 'Failed to link Google Drive access' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }
};
