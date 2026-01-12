import type { APIRoute } from 'astro';
import { createSupabaseServerClient } from '../../lib/supabase-server';

export const POST: APIRoute = async (context) => {
    try {
        const body = await context.request.json();
        const { studentId, notes } = body;

        if (!studentId) {
            return new Response(JSON.stringify({ error: 'studentId is required' }), {
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

        // Verify user is teacher or admin
        const { data: profile } = await supabase
            .from('profiles')
            .select('role')
            .eq('id', user.id)
            .single();

        if (!profile || (profile.role !== 'teacher' && profile.role !== 'admin')) {
            return new Response(JSON.stringify({ error: 'Forbidden' }), {
                status: 403,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        // If not admin, verify student is assigned to this teacher
        if (profile.role !== 'admin') {
            const { data: assignment } = await supabase
                .from('student_teachers')
                .select('id')
                .eq('teacher_id', user.id)
                .eq('student_id', studentId)
                .single();

            if (!assignment) {
                return new Response(JSON.stringify({ error: 'Student not assigned to you' }), {
                    status: 403,
                    headers: { 'Content-Type': 'application/json' },
                });
            }
        }

        // Update student notes
        const { error: updateError } = await supabase
            .from('profiles')
            .update({ notes: notes || '' })
            .eq('id', studentId);

        if (updateError) {
            console.error('Error updating notes:', updateError);
            return new Response(JSON.stringify({ error: 'Failed to update notes' }), {
                status: 500,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        return new Response(JSON.stringify({ success: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        });
    } catch (error) {
        console.error('Update notes error:', error);
        return new Response(JSON.stringify({ error: 'Internal server error' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }
};
