/**
 * API: Send Test Email
 * Admin-only endpoint for testing email templates
 */
import type { APIRoute } from 'astro';
import { createSupabaseServerClient } from '../../../lib/supabase-server';
import {
    sendWelcomeEmail,
    sendClassConfirmation,
    sendClassReminder,
    sendClassCancelled,
} from '../../../lib/email';

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

    const { type, email } = body;

    if (!type || !email) {
        return new Response(JSON.stringify({ error: 'type and email are required' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    const validTypes = ['welcome', 'confirmation', 'reminder', 'cancelled'];
    if (!validTypes.includes(type)) {
        return new Response(JSON.stringify({
            error: `Invalid type. Must be one of: ${validTypes.join(', ')}`
        }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    let success = false;

    try {
        switch (type) {
            case 'welcome':
                success = await sendWelcomeEmail(email, {
                    studentName: 'Usuario de Prueba',
                    packageName: 'Español Intensivo (6 clases/mes)',
                    loginUrl: 'https://espanolhonesto.com/es/login',
                    driveFolderUrl: 'https://drive.google.com/example',
                });
                break;

            case 'confirmation':
                success = await sendClassConfirmation(email, {
                    recipientName: 'Usuario de Prueba',
                    isTeacher: false,
                    otherPartyName: 'Alejandro García',
                    date: 'Lunes, 15 de enero de 2026',
                    time: '10:00',
                    duration: 60,
                    meetLink: 'https://meet.google.com/abc-defg-hij',
                    documentLink: 'https://docs.google.com/example',
                });
                break;

            case 'reminder':
                success = await sendClassReminder(email, {
                    recipientName: 'Usuario de Prueba',
                    isTeacher: false,
                    otherPartyName: 'Alejandro García',
                    date: 'Martes, 16 de enero de 2026',
                    time: '10:00',
                    meetLink: 'https://meet.google.com/abc-defg-hij',
                    documentLink: 'https://docs.google.com/example',
                });
                break;

            case 'cancelled':
                success = await sendClassCancelled(email, {
                    recipientName: 'Usuario de Prueba',
                    date: 'Lunes, 15 de enero de 2026',
                    time: '10:00',
                    cancelledBy: 'student',
                    reason: 'Motivo de la cancelación de prueba',
                });
                break;
        }

        return new Response(JSON.stringify({
            success,
            message: success ? `Test email (${type}) sent to ${email}` : 'Failed to send email'
        }), {
            status: success ? 200 : 500,
            headers: { 'Content-Type': 'application/json' }
        });

    } catch (error) {
        console.error('[Email Test] Error:', error);
        return new Response(JSON.stringify({
            error: 'Failed to send test email',
            details: error instanceof Error ? error.message : 'Unknown error'
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
};
