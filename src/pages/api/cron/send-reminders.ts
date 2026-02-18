import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';
import { sendClassReminder } from '../../../lib/email';

// Use service role for CRON job
const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL;
const supabaseServiceKey = import.meta.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

const CRON_SECRET = import.meta.env.CRON_SECRET;

export const GET: APIRoute = async ({ request }) => {
    // Verify authorization
    const authHeader = request.headers.get('Authorization');
    if (CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
        console.warn('[CRON] Unauthorized request to send-reminders');
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    const result = {
        success: true,
        timestamp: new Date().toISOString(),
        processed: 0,
        sent: 0,
        failed: 0,
        errors: [] as string[],
    };

    try {
        // Calculate time window: 23-25 hours from now
        const now = new Date();
        const windowStart = new Date(now.getTime() + 23 * 60 * 60 * 1000);
        const windowEnd = new Date(now.getTime() + 25 * 60 * 60 * 1000);

        console.log(`[CRON] Looking for sessions between ${windowStart.toISOString()} and ${windowEnd.toISOString()}`);

        // Find sessions needing reminders
        const { data: sessions, error: queryError } = await supabaseAdmin
            .from('sessions')
            .select(`
                id,
                scheduled_at,
                duration_minutes,
                meet_link,
                drive_doc_url,
                student:profiles!sessions_student_id_fkey(id, full_name, email),
                teacher:profiles!sessions_teacher_id_fkey(id, full_name, email)
            `)
            .eq('status', 'scheduled')
            .eq('reminder_sent', false)
            .gte('scheduled_at', windowStart.toISOString())
            .lte('scheduled_at', windowEnd.toISOString());

        if (queryError) {
            console.error('[CRON] Query error:', queryError);
            return new Response(JSON.stringify({
                success: false,
                error: queryError.message
            }), { status: 500, headers: { 'Content-Type': 'application/json' } });
        }

        console.log(`[CRON] Found ${sessions?.length || 0} sessions needing reminders`);

        if (!sessions || sessions.length === 0) {
            return new Response(JSON.stringify({
                ...result,
                message: 'No sessions need reminders at this time'
            }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // Process each session
        for (const session of sessions) {
            result.processed++;

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const student = session.student as any;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const teacher = session.teacher as any;

            if (!student?.email || !teacher?.email) {
                result.failed++;
                result.errors.push(`Session ${session.id}: Missing email addresses`);
                continue;
            }

            // Format date/time in Spanish with Madrid timezone
            const sessionDate = new Date(session.scheduled_at);
            const dateStr = sessionDate.toLocaleDateString('es-ES', {
                weekday: 'long',
                day: 'numeric',
                month: 'long',
                year: 'numeric',
                timeZone: 'Europe/Madrid'
            });
            const timeStr = sessionDate.toLocaleTimeString('es-ES', {
                hour: '2-digit',
                minute: '2-digit',
                timeZone: 'Europe/Madrid'
            });

            // Send reminder to student
            try {
                const studentSent = await sendClassReminder(student.email, {
                    recipientName: student.full_name || 'Estudiante',
                    date: dateStr,
                    time: timeStr,
                    teacherName: teacher.full_name || 'Tu profesor',
                    meetLink: session.meet_link,
                    documentLink: session.drive_doc_url,
                });

                if (studentSent) {
                    result.sent++;
                } else {
                    result.errors.push(`Session ${session.id}: Failed to send to student ${student.email}`);
                }
            } catch (err) {
                result.failed++;
                result.errors.push(`Session ${session.id}: Student email error - ${err instanceof Error ? err.message : 'Unknown'}`);
            }

            // Send reminder to teacher
            try {
                const teacherSent = await sendClassReminder(teacher.email, {
                    recipientName: teacher.full_name || 'Profesor',
                    date: dateStr,
                    time: timeStr,
                    studentName: student.full_name || 'Tu estudiante',
                    meetLink: session.meet_link,
                    documentLink: session.drive_doc_url,
                });

                if (teacherSent) {
                    result.sent++;
                } else {
                    result.errors.push(`Session ${session.id}: Failed to send to teacher ${teacher.email}`);
                }
            } catch (err) {
                result.failed++;
                result.errors.push(`Session ${session.id}: Teacher email error - ${err instanceof Error ? err.message : 'Unknown'}`);
            }

            // Mark session as reminder sent
            const { error: updateError } = await supabaseAdmin
                .from('sessions')
                .update({ reminder_sent: true })
                .eq('id', session.id);

            if (updateError) {
                console.error(`[CRON] Failed to update reminder_sent for session ${session.id}:`, updateError);
            }
        }

        result.failed = result.processed * 2 - result.sent; // 2 emails per session

        console.log(`[CRON] Completed: ${result.sent} emails sent, ${result.failed} failed`);

        return new Response(JSON.stringify(result), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });

    } catch (error) {
        console.error('[CRON] Unexpected error:', error);
        return new Response(JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
};
