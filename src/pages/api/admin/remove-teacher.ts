import type { APIRoute } from 'astro';
import { createSupabaseServerClient } from '../../../lib/supabase-server';

export const POST: APIRoute = async (context) => {
    try {
        const body = await context.request.json();
        const { studentId, teacherId } = body;

        if (!studentId || !teacherId) {
            return new Response(JSON.stringify({ error: 'studentId and teacherId are required' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        // Get Supabase client and verify user
        const supabase = createSupabaseServerClient(context);
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
            return new Response(JSON.stringify({ error: 'Unauthorized' }), {
                status: 401,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        // Verify user is admin
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

        // Delete the assignment
        const { error: deleteError } = await supabase
            .from('student_teachers')
            .delete()
            .eq('student_id', studentId)
            .eq('teacher_id', teacherId);

        if (deleteError) {
            console.error('Error removing assignment:', deleteError);
            return new Response(JSON.stringify({ error: 'Failed to remove assignment' }), {
                status: 500,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        return new Response(JSON.stringify({ success: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        });
    } catch (error) {
        console.error('Remove teacher error:', error);
        return new Response(JSON.stringify({ error: 'Internal server error' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }
};
