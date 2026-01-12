import type { APIRoute } from 'astro';
import { createSupabaseServerClient } from '../../../lib/supabase-server';

export const POST: APIRoute = async (context) => {
    try {
        const body = await context.request.json();
        const { studentId, teacherId, isPrimary } = body;

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

        // If isPrimary, remove primary status from existing assignment
        if (isPrimary) {
            await supabase
                .from('student_teachers')
                .update({ is_primary: false })
                .eq('student_id', studentId)
                .eq('is_primary', true);
        }

        // Check if assignment already exists
        const { data: existing } = await supabase
            .from('student_teachers')
            .select('id')
            .eq('student_id', studentId)
            .eq('teacher_id', teacherId)
            .single();

        if (existing) {
            // Update existing assignment
            const { error: updateError } = await supabase
                .from('student_teachers')
                .update({ is_primary: isPrimary ?? false })
                .eq('id', existing.id);

            if (updateError) {
                console.error('Error updating assignment:', updateError);
                return new Response(JSON.stringify({ error: 'Failed to update assignment' }), {
                    status: 500,
                    headers: { 'Content-Type': 'application/json' },
                });
            }
        } else {
            // Create new assignment
            const { error: insertError } = await supabase
                .from('student_teachers')
                .insert({
                    student_id: studentId,
                    teacher_id: teacherId,
                    is_primary: isPrimary ?? false,
                });

            if (insertError) {
                console.error('Error creating assignment:', insertError);
                return new Response(JSON.stringify({ error: 'Failed to create assignment' }), {
                    status: 500,
                    headers: { 'Content-Type': 'application/json' },
                });
            }
        }

        return new Response(JSON.stringify({ success: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        });
    } catch (error) {
        console.error('Assign teacher error:', error);
        return new Response(JSON.stringify({ error: 'Internal server error' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }
};
