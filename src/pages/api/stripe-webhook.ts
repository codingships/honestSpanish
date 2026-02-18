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
    try {
        switch (event.type) {
            case 'checkout.session.completed': {
                // First-time subscription checkout
                const session = event.data.object as Stripe.Checkout.Session;
                await handleCheckoutCompleted(session);
                break;
            }

            case 'invoice.paid': {
                // Recurring monthly payment succeeded
                const invoice = event.data.object as Stripe.Invoice;
                await handleInvoicePaid(invoice);
                break;
            }

            case 'customer.subscription.deleted': {
                // Subscription cancelled (expired or cancelled by admin/customer)
                const subscription = event.data.object as Stripe.Subscription;
                await handleSubscriptionDeleted(subscription);
                break;
            }

            case 'customer.subscription.updated': {
                // Subscription updated (e.g. payment failed, trial ended)
                const subscription = event.data.object as Stripe.Subscription;
                await handleSubscriptionUpdated(subscription);
                break;
            }

            default:
                console.log(`[Webhook] Unhandled event type: ${event.type}`);
        }
    } catch (error) {
        console.error(`[Webhook] Error processing ${event.type}:`, error);
        // Still return 200 to acknowledge receipt
    }

    return new Response(JSON.stringify({ received: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
    });
};

// ============================================
// HANDLER: First-time checkout completed
// ============================================
async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
    // For subscription mode, metadata is on the subscription, not the session
    const userId = session.metadata?.userId
        || (session.subscription
            ? (await stripe.subscriptions.retrieve(session.subscription as string)).metadata?.userId
            : null);
    const priceId = session.metadata?.priceId
        || (session.subscription
            ? (await stripe.subscriptions.retrieve(session.subscription as string)).metadata?.priceId
            : null);

    if (!userId || !priceId) {
        console.error('[Webhook] Missing metadata in checkout session');
        return;
    }

    // Find the package that matches the priceId
    const { data: pkg, error: pkgError } = await supabaseAdmin
        .from('packages')
        .select('*')
        .or(`stripe_price_1m.eq.${priceId},stripe_price_3m.eq.${priceId},stripe_price_6m.eq.${priceId}`)
        .single();

    if (pkgError || !pkg) {
        console.error('[Webhook] Package not found for priceId:', priceId);
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

    // Create subscription record
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
            stripe_invoice_id: session.invoice as string | null,
        })
        .select()
        .single();

    if (subError) {
        console.error('[Webhook] Error creating subscription:', subError);
        return;
    }

    // Create payment record
    const { error: paymentError } = await supabaseAdmin
        .from('payments')
        .insert({
            student_id: userId,
            subscription_id: subscription.id,
            amount: session.amount_total ?? 0,
            currency: session.currency ?? 'eur',
            status: 'succeeded',
            stripe_payment_intent_id: session.payment_intent as string | null,
            description: `${pkg.name} - ${durationMonths} month(s) - Initial`,
        });

    if (paymentError) {
        console.error('[Webhook] Error creating payment:', paymentError);
    }

    // Save Stripe subscription ID in our subscription record for future reference
    if (session.subscription) {
        await supabaseAdmin
            .from('subscriptions')
            .update({ stripe_invoice_id: session.subscription as string })
            .eq('id', subscription.id);
    }

    console.log(`[Webhook] Successfully processed initial payment for user ${userId}, subscription ${subscription.id}`);

    // Create Google Drive folder structure for the student and send welcome email
    await createDriveFolderForStudent(userId, pkg);
}

// ============================================
// HANDLER: Recurring invoice paid (monthly renewal)
// ============================================
async function handleInvoicePaid(invoice: Stripe.Invoice) {
    // Skip the first invoice (already handled by checkout.session.completed)
    if (invoice.billing_reason === 'subscription_create') {
        console.log('[Webhook] Skipping initial invoice (handled by checkout.session.completed)');
        return;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stripeSubscriptionId = (invoice as any).subscription as string;
    if (!stripeSubscriptionId) {
        console.log('[Webhook] Invoice without subscription, skipping');
        return;
    }

    // Get subscription metadata to find our user
    const stripeSubscription = await stripe.subscriptions.retrieve(stripeSubscriptionId);
    const userId = stripeSubscription.metadata?.userId;

    if (!userId) {
        console.error('[Webhook] No userId in subscription metadata for:', stripeSubscriptionId);
        return;
    }

    // Find the active subscription in our DB
    const { data: subscription, error: subError } = await supabaseAdmin
        .from('subscriptions')
        .select('id, package_id, sessions_total, duration_months')
        .eq('student_id', userId)
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

    if (subError || !subscription) {
        console.error('[Webhook] No active subscription found for user:', userId);
        return;
    }

    // Get the package to know sessions_per_month
    const { data: pkg } = await supabaseAdmin
        .from('packages')
        .select('sessions_per_month')
        .eq('id', subscription.package_id)
        .single();

    // Extend the subscription: add 1 month, reset sessions or add to total
    const newEndsAt = new Date();
    newEndsAt.setMonth(newEndsAt.getMonth() + 1);

    const additionalSessions = pkg?.sessions_per_month ?? 0;

    const { error: updateError } = await supabaseAdmin
        .from('subscriptions')
        .update({
            ends_at: newEndsAt.toISOString().split('T')[0],
            sessions_total: (subscription.sessions_total ?? 0) + additionalSessions,
            sessions_used: 0, // Reset sessions for the new month
        })
        .eq('id', subscription.id);

    if (updateError) {
        console.error('[Webhook] Error extending subscription:', updateError);
    }

    // Record the payment
    const { error: paymentError } = await supabaseAdmin
        .from('payments')
        .insert({
            student_id: userId,
            subscription_id: subscription.id,
            amount: invoice.amount_paid ?? 0,
            currency: invoice.currency ?? 'eur',
            status: 'succeeded',
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            stripe_payment_intent_id: (invoice as any).payment_intent as string | null,
            description: `Monthly renewal`,
        });

    if (paymentError) {
        console.error('[Webhook] Error creating renewal payment:', paymentError);
    }

    console.log(`[Webhook] Renewal processed for user ${userId}: +${additionalSessions} sessions, extended to ${newEndsAt.toISOString().split('T')[0]}`);
}

// ============================================
// HANDLER: Subscription deleted/cancelled
// ============================================
async function handleSubscriptionDeleted(subscription: Stripe.Subscription) {
    const userId = subscription.metadata?.userId;

    if (!userId) {
        console.error('[Webhook] No userId in deleted subscription metadata');
        return;
    }

    // Mark all active subscriptions for this user as cancelled
    const { error: updateError } = await supabaseAdmin
        .from('subscriptions')
        .update({ status: 'cancelled' })
        .eq('student_id', userId)
        .eq('status', 'active');

    if (updateError) {
        console.error('[Webhook] Error cancelling subscription:', updateError);
    }

    console.log(`[Webhook] Subscription cancelled for user ${userId}`);
}

// ============================================
// HANDLER: Subscription updated (e.g. past_due)
// ============================================
async function handleSubscriptionUpdated(subscription: Stripe.Subscription) {
    const userId = subscription.metadata?.userId;

    if (!userId) return;

    // If subscription goes past_due, update our status
    if (subscription.status === 'past_due') {
        await supabaseAdmin
            .from('subscriptions')
            .update({ status: 'paused' })
            .eq('student_id', userId)
            .eq('status', 'active');

        console.log(`[Webhook] Subscription marked past_due for user ${userId}`);
    }
}

// ============================================
// Create Drive folder + send welcome email
// ============================================
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const teachers = student.student_teachers as unknown as any[];

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

            const displayNameObj = pkg.display_name as unknown as { es?: string };

            await sendWelcomeEmail(student.email, {
                studentName: student.full_name || 'Estudiante',
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