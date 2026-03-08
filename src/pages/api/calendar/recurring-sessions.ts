import type { APIRoute } from 'astro';
import { createSupabaseServerClient } from '../../../lib/supabase-server';
import { checkTeacherAvailability } from '../../../lib/google/calendar';

/**
 * POST /api/calendar/recurring-sessions
 * Creates multiple sessions at a fixed day/time each week until endDate or subscription limit.
 * Uses direct DB operations (same pattern as bulk-sessions.ts) instead of HTTP self-fetch.
 */
export const POST: APIRoute = async (context) => {
    const supabase = createSupabaseServerClient(context);
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    }

    const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single();

    if (!profile || (profile.role !== 'admin' && profile.role !== 'teacher')) {
        return new Response(JSON.stringify({ error: 'Forbidden: only admin or teacher' }), { status: 403 });
    }

    const body = await context.request.json();
    const {
        studentId,
        teacherId,
        dayOfWeek,
        time,
        durationMinutes = 55,
        startDate,
        endDate,
        meetLink,
    } = body;

    // IDOR Protection: verify teacher owns this student
    if (profile.role !== 'admin') {
        const { data: assignment } = await supabase
            .from('student_teachers')
            .select('id')
            .eq('teacher_id', user.id)
            .eq('student_id', studentId)
            .single();

        if (!assignment) {
            return new Response(JSON.stringify({ error: 'Student not assigned to you' }), { status: 403 });
        }
    }

    // Validate required fields
    if (!studentId || !teacherId || dayOfWeek === undefined || !time || !startDate) {
        return new Response(JSON.stringify({
            error: 'Required: studentId, teacherId, dayOfWeek, time, startDate'
        }), { status: 400 });
    }

    if (dayOfWeek < 0 || dayOfWeek > 6) {
        return new Response(JSON.stringify({ error: 'dayOfWeek must be 0-6' }), { status: 400 });
    }

    const finalTeacherId = profile.role === 'admin' && teacherId ? teacherId : user.id;

    // Verify student has active subscription
    const { data: subscription } = await supabase
        .from('subscriptions')
        .select('id, sessions_used, sessions_total, ends_at')
        .eq('student_id', studentId)
        .eq('status', 'active')
        .gte('ends_at', new Date().toISOString())
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

    if (!subscription) {
        return new Response(JSON.stringify({ error: 'Student has no active subscription' }), { status: 400 });
    }

    const sessionsUsed = subscription.sessions_used ?? 0;
    const sessionsTotal = subscription.sessions_total ?? 0;
    const sessionsRemaining = sessionsTotal - sessionsUsed;

    if (sessionsRemaining <= 0) {
        return new Response(JSON.stringify({ error: 'No sessions remaining in subscription' }), { status: 400 });
    }

    // Determine end boundary
    const finalEndDate = endDate ? new Date(endDate) : new Date(subscription.ends_at);

    // Generate all ISO date strings for the given day of week
    const scheduledDates: string[] = [];
    const current = new Date(startDate);

    // Find first occurrence of dayOfWeek on or after startDate
    while (current.getDay() !== dayOfWeek) {
        current.setDate(current.getDate() + 1);
    }

    const [hours, minutes] = time.split(':').map(Number);
    while (current <= finalEndDate && scheduledDates.length < sessionsRemaining) {
        const d = new Date(current);
        d.setHours(hours, minutes, 0, 0);
        scheduledDates.push(d.toISOString());
        current.setDate(current.getDate() + 7);
    }

    if (scheduledDates.length === 0) {
        return new Response(JSON.stringify({
            error: 'No valid dates found in the given range for this day of week'
        }), { status: 400 });
    }

    // Check total quota
    if (sessionsUsed + scheduledDates.length > sessionsTotal) {
        return new Response(JSON.stringify({
            error: `Not enough sessions. Tried ${scheduledDates.length}, only ${sessionsRemaining} available.`
        }), { status: 400 });
    }

    // Get teacher email for Google Calendar checks
    const { data: teacherProfile } = await supabase
        .from('profiles')
        .select('email')
        .eq('id', finalTeacherId)
        .single();
    const teacherEmail = teacherProfile?.email;

    // 1. VERIFY ALL CONFLICTS BEFORE INSERTING (atomicity)
    for (const dateStr of scheduledDates) {
        const scheduledDate = new Date(dateStr);
        const endTime = new Date(scheduledDate.getTime() + durationMinutes * 60000);

        // DB conflict check
        const { data: conflicts } = await supabase
            .from('sessions')
            .select('id')
            .eq('teacher_id', finalTeacherId)
            .neq('status', 'cancelled')
            .gte('scheduled_at', scheduledDate.toISOString())
            .lt('scheduled_at', endTime.toISOString());

        if (conflicts && conflicts.length > 0) {
            return new Response(JSON.stringify({
                error: `Conflicto en BBDD: ${scheduledDate.toLocaleDateString()} ${scheduledDate.toLocaleTimeString()}`
            }), { status: 409 });
        }

        // Google Calendar conflict check
        if (teacherEmail) {
            const isFree = await checkTeacherAvailability(teacherEmail, scheduledDate, endTime);
            if (!isFree) {
                return new Response(JSON.stringify({
                    error: `Conflicto en Google Calendar: ${scheduledDate.toLocaleDateString()} ${scheduledDate.toLocaleTimeString()}`
                }), { status: 409 });
            }
        }
    }

    // 2. BULK INSERT all sessions
    const sessionsToInsert = scheduledDates.map(dateStr => ({
        subscription_id: subscription.id,
        student_id: studentId,
        teacher_id: finalTeacherId,
        scheduled_at: dateStr,
        duration_minutes: durationMinutes,
        meet_link: meetLink || null,
        status: 'scheduled' as const,
    }));

    const { data: createdSessions, error: insertError } = await supabase
        .from('sessions')
        .insert(sessionsToInsert)
        .select('*');

    if (insertError || !createdSessions) {
        return new Response(JSON.stringify({ error: insertError?.message || 'Error inserting sessions' }), { status: 500 });
    }

    // 3. OPTIMISTIC LOCK on quota
    const { data: updatedSub } = await supabase
        .from('subscriptions')
        .update({ sessions_used: sessionsUsed + scheduledDates.length })
        .eq('id', subscription.id)
        .eq('sessions_used', sessionsUsed)
        .select('id')
        .single();

    if (!updatedSub) {
        // Concurrency abort — cancel all created sessions
        const createdIds = createdSessions.map(s => s.id);
        await supabase.from('sessions').update({ status: 'cancelled' }).in('id', createdIds);
        return new Response(JSON.stringify({ error: 'Concurrency error: quota changed' }), { status: 409 });
    }

    return new Response(JSON.stringify({
        created: createdSessions.length,
        total_requested: scheduledDates.length,
        sessions: createdSessions,
    }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' }
    });
};
