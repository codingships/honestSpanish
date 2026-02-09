/**
 * Full Class Flow Test Endpoint
 * Tests the complete flow: Session → Drive Doc → Calendar → Meet → Emails
 * 
 * IMPORTANT: Only accessible to admins in production
 */
import type { APIRoute } from 'astro';
import { createSupabaseServerClient } from '../../../lib/supabase-server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL;
const supabaseServiceKey = import.meta.env.SUPABASE_SERVICE_ROLE_KEY;

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

    // Check admin role in production
    if (import.meta.env.PROD) {
        const { data: profile } = await supabase
            .from('profiles')
            .select('role')
            .eq('id', user.id)
            .single();

        if (!profile || profile.role !== 'admin') {
            return new Response(JSON.stringify({ error: 'Forbidden - Admin only' }), {
                status: 403,
                headers: { 'Content-Type': 'application/json' }
            });
        }
    }

    // Get request body
    let body;
    try {
        body = await context.request.json();
    } catch {
        return new Response(JSON.stringify({
            error: 'Invalid JSON body',
            example: {
                studentId: 'uuid-of-student',
                teacherId: 'uuid-of-teacher',
                startTime: '2026-01-25T10:00:00+01:00'
            }
        }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    const { studentId, teacherId, startTime } = body;

    if (!studentId || !teacherId || !startTime) {
        return new Response(JSON.stringify({
            error: 'Missing required fields: studentId, teacherId, startTime'
        }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    const results: {
        timestamp: string;
        step1_session: any;
        step2_driveDoc: any;
        step3_calendarEvent: any;
        step4_meetLink: any;
        step5_studentData: any;
        step6_teacherData: any;
        errors: string[];
        success: boolean;
    } = {
        timestamp: new Date().toISOString(),
        step1_session: null,
        step2_driveDoc: null,
        step3_calendarEvent: null,
        step4_meetLink: null,
        step5_studentData: null,
        step6_teacherData: null,
        errors: [],
        success: false,
    };

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    try {
        // Step 1: Get student data
        const { data: student, error: studentError } = await supabaseAdmin
            .from('profiles')
            .select('id, full_name, email, drive_folder_id, current_level')
            .eq('id', studentId)
            .single();

        if (studentError || !student) {
            results.errors.push(`Student not found: ${studentError?.message || 'No data'}`);
        } else {
            results.step5_studentData = {
                id: student.id,
                name: student.full_name,
                email: student.email,
                hasDriveFolder: !!student.drive_folder_id,
                level: student.current_level || 'A2',
            };
        }

        // Step 2: Get teacher data
        const { data: teacher, error: teacherError } = await supabaseAdmin
            .from('profiles')
            .select('id, full_name, email')
            .eq('id', teacherId)
            .single();

        if (teacherError || !teacher) {
            results.errors.push(`Teacher not found: ${teacherError?.message || 'No data'}`);
        } else {
            results.step6_teacherData = {
                id: teacher.id,
                name: teacher.full_name,
                email: teacher.email,
            };
        }

        // Step 3: Get active subscription
        const { data: subscription, error: subError } = await supabaseAdmin
            .from('subscriptions')
            .select('id, status, sessions_total, sessions_used')
            .eq('student_id', studentId)
            .eq('status', 'active')
            .order('created_at', { ascending: false })
            .limit(1)
            .single();

        if (subError || !subscription) {
            results.errors.push(`No active subscription for student: ${subError?.message || 'No active subscription'}`);
            return new Response(JSON.stringify(results, null, 2), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // Step 4: Create session
        const { data: session, error: sessionError } = await supabaseAdmin
            .from('sessions')
            .insert({
                subscription_id: subscription.id,
                student_id: studentId,
                teacher_id: teacherId,
                scheduled_at: startTime,
                duration_minutes: 60,
                status: 'scheduled',
            })
            .select()
            .single();

        if (sessionError) {
            results.errors.push(`Failed to create session: ${sessionError.message}`);
            return new Response(JSON.stringify(results, null, 2), {
                status: 500,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        results.step1_session = {
            id: session.id,
            scheduledAt: session.scheduled_at,
            status: session.status,
            created: true,
        };

        // Wait a bit for background tasks to complete
        await new Promise(resolve => setTimeout(resolve, 3000));

        // Step 5: Re-fetch session to check if Google integration worked
        const { data: updatedSession } = await supabaseAdmin
            .from('sessions')
            .select('drive_doc_id, drive_doc_url, calendar_event_id, meet_link')
            .eq('id', session.id)
            .single();

        if (updatedSession) {
            // Check Drive doc
            if (updatedSession.drive_doc_url) {
                results.step2_driveDoc = {
                    success: true,
                    docId: updatedSession.drive_doc_id,
                    url: updatedSession.drive_doc_url,
                };
            } else {
                results.step2_driveDoc = { success: false };
                results.errors.push('Drive document was not created');
            }

            // Check Calendar event
            if (updatedSession.calendar_event_id) {
                results.step3_calendarEvent = {
                    success: true,
                    eventId: updatedSession.calendar_event_id,
                };
            } else {
                results.step3_calendarEvent = { success: false };
                results.errors.push('Calendar event was not created');
            }

            // Check Meet link
            if (updatedSession.meet_link) {
                results.step4_meetLink = {
                    success: true,
                    url: updatedSession.meet_link,
                };
            } else {
                results.step4_meetLink = { success: false };
                results.errors.push('Meet link was not generated');
            }
        }

        results.success = results.errors.length === 0;

    } catch (error) {
        results.errors.push(`Unexpected error: ${error instanceof Error ? error.message : 'Unknown'}`);
    }

    return new Response(JSON.stringify(results, null, 2), {
        status: results.success ? 200 : 207, // 207 = Multi-Status (partial success)
        headers: { 'Content-Type': 'application/json' }
    });
};
