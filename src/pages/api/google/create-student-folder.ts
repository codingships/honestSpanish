/**
 * API: Create Student Folder
 * Manual endpoint for creating Drive folder structure for existing students
 * Only accessible by admins
 */
import type { APIRoute } from 'astro';
import { createSupabaseServerClient } from '../../../lib/supabase-server';
import { createStudentFolderStructure } from '../../../lib/google/student-folder';

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

    const { studentId } = body;
    if (!studentId) {
        return new Response(JSON.stringify({ error: 'studentId is required' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    // Get student data
    const { data: student, error: studentError } = await supabase
        .from('profiles')
        .select(`
            id,
            full_name,
            email,
            drive_folder_id,
            student_teachers!student_teachers_student_id_fkey(
                is_primary,
                teacher:profiles!student_teachers_teacher_id_fkey(full_name)
            )
        `)
        .eq('id', studentId)
        .single();

    if (studentError || !student) {
        return new Response(JSON.stringify({ error: 'Student not found' }), {
            status: 404,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    // Check if already has folder
    if (student.drive_folder_id) {
        return new Response(JSON.stringify({
            error: 'Student already has a Drive folder',
            folderId: student.drive_folder_id
        }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    // Get primary teacher name
    const primaryTeacher = (student.student_teachers as any[])?.find((st: any) => st.is_primary);
    const teacherName = primaryTeacher?.teacher?.full_name || null;

    try {
        // Create folder structure
        const result = await createStudentFolderStructure({
            studentName: student.full_name || student.email?.split('@')[0] || 'Estudiante',
            studentEmail: student.email,
            teacherName,
        });

        // Update profile with folder ID
        const { error: updateError } = await supabase
            .from('profiles')
            .update({ drive_folder_id: result.rootFolderId })
            .eq('id', studentId);

        if (updateError) {
            console.error('[CreateStudentFolder] Error updating profile:', updateError);
        }

        return new Response(JSON.stringify({
            success: true,
            result
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });

    } catch (error) {
        console.error('[CreateStudentFolder] Error:', error);
        return new Response(JSON.stringify({
            error: 'Failed to create folder structure',
            details: error instanceof Error ? error.message : 'Unknown error'
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
};
