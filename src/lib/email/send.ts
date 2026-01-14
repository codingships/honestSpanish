/**
 * Email Send Functions
 * Functions to send each type of transactional email
 */
import { resend, EMAIL_FROM } from './client';
import {
    welcomeEmailTemplate,
    classConfirmationTemplate,
    classReminderTemplate,
    classCancelledTemplate,
    type WelcomeEmailData,
    type ClassConfirmationData,
    type ClassReminderData,
    type ClassCancelledData,
} from './templates';

// ============================================
// Send Welcome Email
// ============================================

export async function sendWelcomeEmail(
    email: string,
    data: WelcomeEmailData
): Promise<boolean> {
    try {
        const { error } = await resend.emails.send({
            from: EMAIL_FROM,
            to: email,
            subject: '¡Bienvenido/a a Español Honesto! 🎉',
            html: welcomeEmailTemplate(data),
        });

        if (error) {
            console.error('[Email] Failed to send welcome email:', error);
            return false;
        }

        console.log(`[Email] Welcome email sent to ${email}`);
        return true;
    } catch (error) {
        console.error('[Email] Error sending welcome email:',
            error instanceof Error ? error.message : 'Unknown error');
        return false;
    }
}

// ============================================
// Send Class Confirmation Email
// ============================================

export async function sendClassConfirmation(
    email: string,
    data: ClassConfirmationData
): Promise<boolean> {
    try {
        const subject = data.isTeacher
            ? `📅 Nueva clase programada - ${data.date}`
            : `🎉 Clase confirmada - ${data.date}`;

        const { error } = await resend.emails.send({
            from: EMAIL_FROM,
            to: email,
            subject,
            html: classConfirmationTemplate(data),
        });

        if (error) {
            console.error('[Email] Failed to send class confirmation:', error);
            return false;
        }

        console.log(`[Email] Class confirmation sent to ${email}`);
        return true;
    } catch (error) {
        console.error('[Email] Error sending class confirmation:',
            error instanceof Error ? error.message : 'Unknown error');
        return false;
    }
}

// ============================================
// Send Class Reminder Email
// ============================================

export async function sendClassReminder(
    email: string,
    data: ClassReminderData
): Promise<boolean> {
    try {
        const { error } = await resend.emails.send({
            from: EMAIL_FROM,
            to: email,
            subject: `⏰ Recordatorio: Tu clase es mañana - ${data.date}`,
            html: classReminderTemplate(data),
        });

        if (error) {
            console.error('[Email] Failed to send class reminder:', error);
            return false;
        }

        console.log(`[Email] Class reminder sent to ${email}`);
        return true;
    } catch (error) {
        console.error('[Email] Error sending class reminder:',
            error instanceof Error ? error.message : 'Unknown error');
        return false;
    }
}

// ============================================
// Send Class Cancelled Email
// ============================================

export async function sendClassCancelled(
    email: string,
    data: ClassCancelledData
): Promise<boolean> {
    try {
        const { error } = await resend.emails.send({
            from: EMAIL_FROM,
            to: email,
            subject: `❌ Clase cancelada - ${data.date}`,
            html: classCancelledTemplate(data),
        });

        if (error) {
            console.error('[Email] Failed to send cancellation email:', error);
            return false;
        }

        console.log(`[Email] Cancellation email sent to ${email}`);
        return true;
    } catch (error) {
        console.error('[Email] Error sending cancellation email:',
            error instanceof Error ? error.message : 'Unknown error');
        return false;
    }
}

// ============================================
// Send to Both Parties (Student + Teacher)
// ============================================

export async function sendClassConfirmationToBoth(
    studentEmail: string,
    studentName: string,
    teacherEmail: string,
    teacherName: string,
    classDetails: {
        date: string;
        time: string;
        duration: number;
        meetLink?: string;
        documentLink?: string;
    }
): Promise<void> {
    // Send to student
    await sendClassConfirmation(studentEmail, {
        recipientName: studentName,
        isTeacher: false,
        otherPartyName: teacherName,
        ...classDetails,
    });

    // Send to teacher
    await sendClassConfirmation(teacherEmail, {
        recipientName: teacherName,
        isTeacher: true,
        otherPartyName: studentName,
        ...classDetails,
    });
}

export async function sendClassCancelledToBoth(
    studentEmail: string,
    studentName: string,
    teacherEmail: string,
    teacherName: string,
    data: Omit<ClassCancelledData, 'recipientName'>
): Promise<void> {
    // Send to student
    await sendClassCancelled(studentEmail, {
        recipientName: studentName,
        ...data,
    });

    // Send to teacher
    await sendClassCancelled(teacherEmail, {
        recipientName: teacherName,
        ...data,
    });
}
