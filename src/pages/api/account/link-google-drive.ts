import type { APIRoute } from 'astro';
import { z } from 'zod';
import { getPrivateProfile, upsertPrivateProfile } from '../../../lib/profiles-private';
import { createSupabaseServerClient } from '../../../lib/supabase-server';
import { ensureUserPermission, getFolderLink, revokeAnyoneWithLinkPermissions } from '../../../lib/google/drive';

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

        const rawBody = await context.request.json();
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

        await ensureUserPermission(profilePrivate.drive_folder_id, googleAccountEmail, 'reader');
        await revokeAnyoneWithLinkPermissions(profilePrivate.drive_folder_id);

        const folderUrl = profilePrivate.drive_folder_url || await getFolderLink(profilePrivate.drive_folder_id);
        const updatedPrivateProfile = await upsertPrivateProfile(user.id, {
            drive_folder_url: folderUrl,
            google_account_email: googleAccountEmail,
        });

        return new Response(JSON.stringify({
            success: true,
            driveFolderUrl: updatedPrivateProfile.drive_folder_url,
            googleAccountEmail: updatedPrivateProfile.google_account_email,
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
