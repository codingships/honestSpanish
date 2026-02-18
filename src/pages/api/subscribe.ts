import type { APIRoute } from 'astro';
import { resend, EMAIL_FROM } from '../../lib/email/client';

const escapeHtml = (str: string) =>
    str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const POST: APIRoute = async ({ request, locals: _locals }) => {
    try {
        const { email, name, interest, lang } = await request.json();

        if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
            return new Response(JSON.stringify({ error: 'Email inválido' }), { status: 400 });
        }

        // 1. Send Admin Notification
        await resend.emails.send({
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
        });

        // 2. (Optional) Send Welcome Email to User
        // For now, we just notify admin.

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
