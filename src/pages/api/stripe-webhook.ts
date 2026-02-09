export const config = {
    runtime: 'nodejs'
};
import type { APIRoute } from 'astro';
import { stripe } from '../../lib/stripe';
import { createClient } from '@supabase/supabase-js';
import { createStudentFolderStructure } from '../../lib/google/student-folder';
import { sendWelcomeEmail } from '../../lib/email';
// 👇 1. Importamos tus tipos generados
import type { Database } from '../../types/database.types';
// 👇 2. Importamos tipos de Stripe para evitar 'any' en la sesión
import type Stripe from 'stripe';

// Use service role key for webhook (bypasses RLS)
const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL;
const supabaseServiceKey = import.meta.env.SUPABASE_SERVICE_ROLE_KEY;

// 👇 3. Inyectamos <Database> al cliente Admin
const supabaseAdmin = createClient<Database>(supabaseUrl, supabaseServiceKey);

export const POST: APIRoute = async ({ request }) => {
    const webhookSecret = import.meta.env.STRIPE_WEBHOOK_SECRET;

    if (!webhookSecret) {
        console.error('Missing STRIPE_WEBHOOK_SECRET');
        return new Response('Webhook secret not configured', { status: 500 });
    }

    // Get raw body as text (NOT JSON parsed)
    const payload = await request.text();
    const signature = request.headers.get('stripe-signature');

    if (!signature) {
        return new Response('Missing stripe-signature header', { status: 400 });
    }

    let event: Stripe.Event;

    try {
        event = stripe.webhooks.constructEvent(payload, signature, webhookSecret);
    } catch (err) {
        // Manejo de error tipado
        const errorMessage = err instanceof Error ? err.message : 'Unknown Error';
        console.error('Webhook signature verification failed:', errorMessage);
        return new Response(`Webhook Error: ${errorMessage}`, { status: 400 });
    }

    // Handle the event
    if (event.type === 'checkout.session.completed') {
        // 👇 TypeScript ahora sabe que esto es una Session
        const session = event.data.object as Stripe.Checkout.Session;

        try {
            await handleCheckoutCompleted(session);
        } catch (error) {
            console.error('Error processing checkout:', error);
            // Still return 200 to acknowledge receipt
        }
    }

    return new Response(JSON.stringify({ received: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
    });
};

// 👇 Definimos el tipo de entrada correctamente
async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
    const { userId, priceId } = session.metadata || {};

    if (!userId || !priceId) {
        console.error('Missing metadata in checkout session');
        return;
    }

    // Find the package that matches the priceId
    // 👇 'pkg' ahora tiene autocompletado y tipo
    const { data: pkg, error: pkgError } = await supabaseAdmin
        .from('packages')
        .select('*')
        .or(`stripe_price_1m.eq.${priceId},stripe_price_3m.eq.${priceId},stripe_price_6m.eq.${priceId}`)
        .single();

    if (pkgError || !pkg) {
        console.error('Package not found for priceId:', priceId);
        return;
    }

    // Determine duration based on which price column matched
    let durationMonths = 1;
    if (pkg.stripe_price_3m === priceId) {
        durationMonths = 3;
    } else if (pkg.stripe_price_6m === priceId) {
        durationMonths = 6;
    }

    // Calculate dates
    const startsAt = new Date();
    const endsAt = new Date();
    endsAt.setMonth(endsAt.getMonth() + durationMonths);

    const sessionsTotal = pkg.sessions_per_month * durationMonths;

    // Create subscription
    const { data: subscription, error: subError } = await supabaseAdmin
        .from('subscriptions')
        .insert({
            student_id: userId,
            package_id: pkg.id,
            status: 'active',
            duration_months: durationMonths,
            starts_at: startsAt.toISOString().split('T')[0],
            ends_at: endsAt.toISOString().split('T')[0],
            sessions_total: sessionsTotal,
            sessions_used: 0,
            stripe_invoice_id: session.invoice as string | null, // Stripe type matching
        })
        .select()
        .single();

    if (subError) {
        console.error('Error creating subscription:', subError);
        return;
    }

    // Create payment record
    const { error: paymentError } = await supabaseAdmin
        .from('payments')
        .insert({
            student_id: userId,
            subscription_id: subscription.id,
            amount: session.amount_total ?? 0, // Fallback si es null
            currency: session.currency ?? 'eur',
            status: 'succeeded',
            stripe_payment_intent_id: session.payment_intent as string | null,
            description: `${pkg.name} - ${durationMonths} month(s)`,
        });

    if (paymentError) {
        console.error('Error creating payment:', paymentError);
    }

    console.log(`Successfully processed payment for user ${userId}, subscription ${subscription.id}`);

    // Create Google Drive folder structure for the student and send welcome email
    await createDriveFolderForStudent(userId, pkg);
}

/**
 * Create Drive folder structure for a student (after successful payment)
 * Also sends welcome email after folder creation
 */
// 👇 Tipamos 'pkg' usando los tipos de la DB directamente
async function createDriveFolderForStudent(
    userId: string,
    pkg: Database['public']['Tables']['packages']['Row']
): Promise<void> {
    let driveFolderLink: string | null = null;
    try {
        // Get student data with assigned teacher
        const { data: student, error: studentError } = await supabaseAdmin
            .from('profiles')
            .select(`
                id,
                full_name,
                email,
                drive_folder_id,
                student_teachers!student_teachers_student_id_fkey(
                    is_primary,
                    teacher:profiles!student_teachers_teacher_id_fkey(full_name)
                )
            `)
            .eq('id', userId)
            .single();

        if (studentError || !student) {
            console.error('[Webhook] Could not fetch student for folder creation:', studentError);
            return;
        }

        // Skip if already has folder
        if (student.drive_folder_id) {
            console.log(`[Webhook] Student ${userId} already has Drive folder, skipping`);
            return;
        }

        // Get primary teacher name
        // 👇 TypeScript infiere que student_teachers es un Array gracias a los tipos generados
        // Si falla, es porque la relación en Supabase devuelve un objeto único, pero usualmente es array.
        const teachers = student.student_teachers as unknown as any[];
        // Nota: Mantenemos un casting ligero aquí porque las relaciones anidadas profundas 
        // a veces son difíciles de inferir automáticamente sin un helper de tipos extra.

        const primaryTeacher = teachers?.find((st: any) => st.is_primary);
        const teacherName = primaryTeacher?.teacher?.full_name || null;

        console.log(`[Webhook] Creating Drive folder for ${student.full_name || student.email}`);

        // Create folder structure (creates all levels: A2, B1, B2, C1)
        const result = await createStudentFolderStructure({
            studentName: student.full_name || student.email?.split('@')[0] || 'Estudiante',
            studentEmail: student.email,
            teacherName,
        });

        // Update profile with folder ID
        const { error: updateError } = await supabaseAdmin
            .from('profiles')
            .update({ drive_folder_id: result.rootFolderId })
            .eq('id', userId);

        if (updateError) {
            console.error('[Webhook] Error updating profile with folder ID:', updateError);
        } else {
            console.log(`[Webhook] Successfully created Drive folder for student ${userId}: ${result.rootFolderId}`);
            driveFolderLink = result.rootFolderLink;
        }

    } catch (error) {
        // Log error but don't throw - folder creation shouldn't block payment
        console.error('[Webhook] Error creating Drive folder (non-blocking):',
            error instanceof Error ? error.message : 'Unknown error');
    }

    // Send welcome email
    try {
        const { data: student } = await supabaseAdmin
            .from('profiles')
            .select('full_name, email')
            .eq('id', userId)
            .single();

        if (student?.email) {
            const publicUrl = import.meta.env.PUBLIC_URL || 'https://espanolhonesto.com';

            // 👇 SOLUCIÓN: Hacemos un casting explícito del JSON
            const displayNameObj = pkg.display_name as unknown as { es?: string };

            await sendWelcomeEmail(student.email, {
                studentName: student.full_name || 'Estudiante',
                // 👇 Usamos el objeto tipeado
                packageName: displayNameObj?.es || pkg.name || 'Español',
                loginUrl: `${publicUrl}/es/login`,
                driveFolderUrl: driveFolderLink || undefined,
            });
        }
    } catch (error) {
        console.error('[Webhook] Error sending welcome email (non-blocking):',
            error instanceof Error ? error.message : 'Unknown error');
    }
}