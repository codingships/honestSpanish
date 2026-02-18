import type { APIRoute } from 'astro';
import { createSupabaseServerClient } from '../../../lib/supabase-server';

/**
 * POST /api/calendar/recurring-sessions
 * Creates multiple sessions at a fixed day/time each week until endDate or subscription limit.
 *
 * Body: {
 *   studentId: string,
 *   teacherId: string,
 *   dayOfWeek: number, // 0=Sunday, 1=Monday, ..., 6=Saturday
 *   time: string, // "10:00"
 *   durationMinutes?: number, // default 55
 *   startDate: string, // "2026-02-17"
 *   endDate?: string, // "2026-06-30" — if omitted, uses subscription end date
 *   autoCreateMeeting?: boolean, // default true
 *   meetLink?: string
 * }
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
        autoCreateMeeting = true,
        meetLink,
    } = body;

    // Validate required fields
    if (!studentId || !teacherId || dayOfWeek === undefined || !time || !startDate) {
        return new Response(JSON.stringify({
            error: 'Required: studentId, teacherId, dayOfWeek, time, startDate'
        }), { status: 400 });
    }

    if (dayOfWeek < 0 || dayOfWeek > 6) {
        return new Response(JSON.stringify({ error: 'dayOfWeek must be 0-6' }), { status: 400 });
    }

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

    const sessionsRemaining = (subscription.sessions_total ?? 0) - (subscription.sessions_used ?? 0);
    if (sessionsRemaining <= 0) {
        return new Response(JSON.stringify({ error: 'No sessions remaining in subscription' }), { status: 400 });
    }

    // Determine end boundary: use provided endDate or subscription end
    const finalEndDate = endDate
        ? new Date(endDate)
        : new Date(subscription.ends_at);

    // Generate all dates for the given day of week between startDate and endDate
    const dates: Date[] = [];
    const start = new Date(startDate);

    // Find first occurrence of dayOfWeek on or after startDate
    let current = new Date(start);
    while (current.getDay() !== dayOfWeek) {
        current.setDate(current.getDate() + 1);
    }

    while (current <= finalEndDate && dates.length < sessionsRemaining) {
        dates.push(new Date(current));
        current.setDate(current.getDate() + 7);
    }

    if (dates.length === 0) {
        return new Response(JSON.stringify({
            error: 'No valid dates found in the given range for this day of week'
        }), { status: 400 });
    }

    // Create sessions in bulk
    const createdSessions: any[] = [];
    const errors: string[] = [];

    for (const date of dates) {
        const [hours, minutes] = time.split(':').map(Number);
        date.setHours(hours, minutes, 0, 0);

        const scheduledAt = date.toISOString();

        try {
            const response = await fetch(new URL('/api/calendar/sessions', context.request.url).toString(), {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Cookie': context.request.headers.get('Cookie') || '',
                },
                body: JSON.stringify({
                    studentId,
                    teacherId,
                    scheduledAt,
                    durationMinutes,
                    meetLink: meetLink || null,
                    autoCreateMeeting,
                }),
            });

            if (response.ok) {
                const data = await response.json();
                createdSessions.push(data.session);
            } else {
                const data = await response.json();
                errors.push(`${date.toISOString().split('T')[0]}: ${data.error}`);
            }
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Unknown error';
            errors.push(`${date.toISOString().split('T')[0]}: ${message}`);
        }
    }

    return new Response(JSON.stringify({
        created: createdSessions.length,
        total_requested: dates.length,
        sessions: createdSessions,
        errors: errors.length > 0 ? errors : undefined,
    }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' }
    });
};
