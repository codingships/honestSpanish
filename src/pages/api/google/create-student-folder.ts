import type { APIRoute } from 'astro';
import { callInternalJobService } from '../../../lib/internal-job-service';
import { getPrivateProfile } from '../../../lib/profiles-private';
import { createSupabaseServerClient } from '../../../lib/supabase-server';

type CreateStudentFolderRequest = {
    studentId?: unknown;
};

export const POST: APIRoute = async (context) => {
    const supabase = createSupabaseServerClient(context);

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single();

    if (!profile || profile.role !== 'admin') {
        return new Response(JSON.stringify({ error: 'Forbidden' }), {
            status: 403,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    let body: CreateStudentFolderRequest;
    try {
        body = await context.request.json() as CreateStudentFolderRequest;
    } catch {
        return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    const studentId = typeof body.studentId === 'string' ? body.studentId : '';
    if (!studentId) {
        return new Response(JSON.stringify({ error: 'studentId is required' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    const { data: student, error: studentError } = await supabase
        .from('profiles')
        .select('id')
        .eq('id', studentId)
        .single();

    if (studentError || !student) {
        return new Response(JSON.stringify({ error: 'Student not found' }), {
            status: 404,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    const studentPrivate = await getPrivateProfile(studentId);

    if (studentPrivate?.drive_folder_id) {
        return new Response(JSON.stringify({
            error: 'Student already has a Drive folder',
            folderId: studentPrivate.drive_folder_id,
            folderUrl: studentPrivate.drive_folder_url,
        }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    try {
        const result = await callInternalJobService('/internal/google/create-student-folder', {
            studentId,
        }, { context });

        return new Response(JSON.stringify({
            success: true,
            result,
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        });
    } catch (error) {
        console.error('[CreateStudentFolder] Error:', error);
        return new Response(JSON.stringify({
            error: 'Failed to create folder structure',
            details: 'See server logs',
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }
};
