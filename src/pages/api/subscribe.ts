import type { APIRoute } from 'astro';
import { resend, EMAIL_FROM, sendLeadWelcomeEmail } from '../../lib/email';
import { createClient } from '@supabase/supabase-js';

const escapeHtml = (str: string) =>
    str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL;
const supabaseServiceKey = import.meta.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

export const POST: APIRoute = async ({ request, locals: _locals, clientAddress }) => {
    try {
        const payload = await request.json();
        const { email, name, interest, lang, consent } = payload;
        const turnstileToken = payload['cf-turnstile-response'];

        if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
            return new Response(JSON.stringify({ error: 'Email inválido' }), { status: 400 });
        }

        if (!consent) {
            return new Response(JSON.stringify({ error: 'Debe aceptar las políticas de privacidad' }), { status: 400 });
        }

        // Validar Token Cloudflare Turnstile
        if (!turnstileToken) {
            return new Response(JSON.stringify({ error: 'Por favor, pasa la verificación de seguridad.' }), { status: 400 });
        }

        const turnstileSecretKey = import.meta.env.TURNSTILE_SECRET_KEY;
        const turnstileRes = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: `secret=${turnstileSecretKey}&response=${turnstileToken}`,
        });
        const turnstileData = await turnstileRes.json();

        if (!turnstileData.success) {
            return new Response(JSON.stringify({ error: 'Validación anti-bot fallida.' }), { status: 403 });
        }

        // 1. Guardar en Base de Datos (CRM & GDPR)
        const { error: dbError } = await supabaseAdmin
            .from('leads')
            .insert({
                email,
                name: name || null,
                interest: interest || null,
                lang: lang || 'es',
                consent_given: Boolean(consent),
                ip_address: clientAddress
            });

        if (dbError) {
            console.error('Supabase error inserting lead:', dbError);
            // We can choose to fail or continue. Better fail to guarantee GDPR compliance before notifying.
            return new Response(JSON.stringify({ error: 'Error al registrar contacto' }), { status: 500 });
        }

        // 2. Send Admin Notification (Non-blocking)
        resend.emails.send({
            from: EMAIL_FROM,
            to: ['alejandro@espanolhonesto.com'],
            subject: `Nuevo Lead: ${escapeHtml(name || '')} (${escapeHtml(interest || '')})`,
            html: `
        <div style="font-family: sans-serif; padding: 20px; color: #333;">
            <h1 style="color: #006064;">Nuevo Lead Capturado</h1>
            <p><strong>Nombre:</strong> ${escapeHtml(name || 'N/A')}</p>
            <p><strong>Email:</strong> ${escapeHtml(email)}</p>
            <p><strong>Interés:</strong> ${escapeHtml(interest || 'N/A')}</p>
            <p><strong>Idioma:</strong> ${escapeHtml(lang || '')}</p>
            <p><strong>Fecha:</strong> ${new Date().toLocaleString()}</p>
            <hr />
            <p style="font-size: 12px; color: #888;">Este lead proviene del formulario de contacto.</p>
        </div>
      `,
        }).catch(err => console.error('Error notifying admin:', err));

        // 3. Send Welcome Email to User
        await sendLeadWelcomeEmail(email, {
            recipientName: name
        });

        return new Response(
            JSON.stringify({ message: 'Success' }),
            { status: 200 }
        );
    } catch (error) {
        console.error('Resend error:', error);
        return new Response(
            JSON.stringify({ error: 'Error al enviar email' }),
            { status: 500 }
        );
    }
};
