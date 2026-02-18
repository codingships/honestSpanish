import type { APIRoute } from 'astro';
import { Resend } from 'resend';

export const POST: APIRoute = async ({ request, locals: _locals }) => {
    const apiKey = import.meta.env.RESEND_API_KEY;

    if (!apiKey) {
        return new Response(JSON.stringify({ error: 'Resend API key missing' }), {
            status: 500,
        });
    }

    const resend = new Resend(apiKey);

    try {
        const { email, name, interest, lang } = await request.json();

        if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
            return new Response(JSON.stringify({ error: 'Email inválido' }), { status: 400 });
        }

        // 1. Send Admin Notification
        await resend.emails.send({
            from: 'Acme <onboarding@resend.dev>', // Change to verified domain if available
            to: ['alejandro@espanolhonesto.com'],
            subject: `Nuevo Lead: ${name} (${interest})`,
            html: `
        <div style="font-family: sans-serif; padding: 20px; color: #333;">
            <h1 style="color: #006064;">Nuevo Lead Capturado</h1>
            <p><strong>Nombre:</strong> ${name || 'N/A'}</p>
            <p><strong>Email:</strong> ${email}</p>
            <p><strong>Interés:</strong> ${interest || 'N/A'}</p>
            <p><strong>Idioma:</strong> ${lang}</p>
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
