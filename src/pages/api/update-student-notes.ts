import type { APIRoute } from 'astro';
import { upsertPrivateProfile } from '../../lib/profiles-private';
import { createSupabaseServerClient } from '../../lib/supabase-server';

const MAX_STUDENT_NOTES_LENGTH = 5000;

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

        const { studentId, notes } = body;

        if (typeof studentId !== 'string' || !studentId.trim()) {
            return new Response(JSON.stringify({ error: 'studentId is required' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        if (notes !== undefined && notes !== null && typeof notes !== 'string') {
            return new Response(JSON.stringify({ error: 'notes must be a string' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        const safeNotes = typeof notes === 'string' ? notes : '';
        if (safeNotes.length > MAX_STUDENT_NOTES_LENGTH) {
            return new Response(JSON.stringify({ error: 'notes is too long' }), {
                status: 400,
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
                .eq('student_id', studentId.trim())
                .single();

            if (!assignment) {
                return new Response(JSON.stringify({ error: 'Student not assigned to you' }), {
                    status: 403,
                    headers: { 'Content-Type': 'application/json' },
                });
            }
        }

        // Update student notes
        try {
            await upsertPrivateProfile(studentId.trim(), { notes: safeNotes });
        } catch (updateError) {
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
