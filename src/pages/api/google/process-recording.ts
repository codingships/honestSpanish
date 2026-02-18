/**
 * API: Process Meet Recording
 * Manual endpoint for processing class recordings
 * Will fail silently if recordings aren't available
 */
import type { APIRoute } from 'astro';
import { createSupabaseServerClient } from '../../../lib/supabase-server';
import { processClassRecording } from '../../../lib/google/recordings';
import { linkRecordingToDocument } from '../../../lib/google/class-document';

export const POST: APIRoute = async (context) => {
    const supabase = createSupabaseServerClient(context);

    // Check authentication
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    // Check admin role
    const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single();

    if (!profile || profile.role !== 'admin') {
        return new Response(JSON.stringify({ error: 'Forbidden' }), {
            status: 403,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    // Get request body
    let body;
    try {
        body = await context.request.json();
    } catch {
        return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    const { sessionId } = body;
    if (!sessionId) {
        return new Response(JSON.stringify({ error: 'sessionId is required' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    // Get session data
    const { data: session, error: sessionError } = await supabase
        .from('sessions')
        .select(`
            id,
            meet_link,
            drive_doc_id,
            student:profiles!sessions_student_id_fkey(
                id,
                full_name,
                email,
                drive_folder_id
            )
        `)
        .eq('id', sessionId)
        .single();

    if (sessionError || !session) {
        return new Response(JSON.stringify({ error: 'Session not found' }), {
            status: 404,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    // Cast to access columns that may not be in generated types yet
    const sessionData = session as any;

    const meetLink = sessionData.meet_link;
    if (!meetLink) {
        return new Response(JSON.stringify({
            error: 'Session has no Meet link',
            note: 'Recording processing requires a Meet link'
        }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    const student = sessionData.student as any;
    if (!student?.drive_folder_id) {
        return new Response(JSON.stringify({
            error: 'Student has no Drive folder',
            note: 'Cannot process recording without student folder'
        }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    const studentName = student.full_name || student.email?.split('@')[0] || 'Estudiante';
    const level = 'A1'; // TODO: Get from student profile

    // Process the recording
    const result = await processClassRecording({
        meetLink,
        sessionId,
        studentRootFolderId: student.drive_folder_id,
        studentName,
        level,
    });

    // If recording was found and processed, link it to the document
    if (result.success && result.recordingLink && sessionData.drive_doc_id) {
        await linkRecordingToDocument(sessionData.drive_doc_id, result.recordingLink);
    }

    return new Response(JSON.stringify({
        success: result.success,
        result,
        note: result.error === 'no_recordings_folder'
            ? 'Meet recordings folder not found - this is expected if your Workspace license does not support recordings'
            : result.error === 'no_recording_found'
                ? 'No recording found for this session - this is normal if recording was not enabled'
                : undefined
    }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
    });
};
