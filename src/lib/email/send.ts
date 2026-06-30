/**
 * Email Send Functions
 * Functions to send each type of transactional email.
 */
import { getEmailFrom, getResend } from './client';
import {
    welcomeEmailTemplate,
    classConfirmationTemplate,
    classReminderTemplate,
    classCancelledTemplate,
    leadWelcomeTemplate,
    levelCheckInviteTemplate,
    missingInfoEmailTemplate,
    proposalNextStepEmailTemplate,
    supportTicketReceivedTemplate,
    supportTicketUpdatedTemplate,
    type WelcomeEmailData,
    type ClassConfirmationData,
    type ClassReminderData,
    type ClassCancelledData,
    type LeadWelcomeEmailData,
    type LevelCheckInviteEmailData,
    type MissingInfoEmailData,
    type ProposalNextStepEmailData,
    type SupportTicketReceivedEmailData,
    type SupportTicketUpdatedEmailData,
} from './templates';

function redactEmailForLog(email: string): string {
    const [localPart, domain] = email.split('@');
    if (!localPart || !domain) return '[redacted-email]';

    const first = localPart[0] ?? '*';
    const last = localPart.length > 1 ? localPart[localPart.length - 1] : '*';
    return `${first}***${last}@${domain}`;
}

type EmailProviderErrorShape = {
    name?: unknown;
    message?: unknown;
    code?: unknown;
    status?: unknown;
    statusCode?: unknown;
};

const EMAIL_ADDRESS_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

function redactEmailsInText(value: string): string {
    return value.replace(EMAIL_ADDRESS_PATTERN, (match) => redactEmailForLog(match));
}

function describeEmailSendError(error: unknown): string {
    if (error instanceof Error) {
        const label = error.name && error.name !== 'Error' ? `${error.name}: ` : '';
        return redactEmailsInText(`${label}${error.message || 'Unknown email provider error'}`);
    }

    if (typeof error === 'string') {
        return redactEmailsInText(error);
    }

    if (error && typeof error === 'object') {
        const providerError = error as EmailProviderErrorShape;
        const parts: string[] = [];

        if (typeof providerError.name === 'string') {
            parts.push(redactEmailsInText(providerError.name));
        }

        if (typeof providerError.message === 'string') {
            parts.push(redactEmailsInText(providerError.message));
        }

        if (typeof providerError.code === 'string' || typeof providerError.code === 'number') {
            parts.push(`code=${redactEmailsInText(String(providerError.code))}`);
        }

        if (typeof providerError.statusCode === 'string' || typeof providerError.statusCode === 'number') {
            parts.push(`status=${redactEmailsInText(String(providerError.statusCode))}`);
        } else if (typeof providerError.status === 'string' || typeof providerError.status === 'number') {
            parts.push(`status=${redactEmailsInText(String(providerError.status))}`);
        }

        return parts.length > 0 ? parts.join(' ') : 'Unknown email provider error';
    }

    return 'Unknown email provider error';
}

// ============================================
// Send Welcome Email
// ============================================

export async function sendWelcomeEmail(
    email: string,
    data: WelcomeEmailData
): Promise<boolean> {
    try {
        const { error } = await getResend().emails.send({
            from: getEmailFrom(),
            to: email,
            subject: 'Welcome to Español Honesto',
            html: welcomeEmailTemplate(data),
        });

        if (error) {
            console.error('[Email] Failed to send welcome email:', describeEmailSendError(error));
            return false;
        }

        console.log(`[Email] Welcome email sent to ${redactEmailForLog(email)}`);
        return true;
    } catch (error) {
        console.error('[Email] Error sending welcome email:', describeEmailSendError(error));
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
            ? `New class scheduled - ${data.date}`
            : `Class confirmed - ${data.date}`;

        const { error } = await getResend().emails.send({
            from: getEmailFrom(),
            to: email,
            subject,
            html: classConfirmationTemplate(data),
        });

        if (error) {
            console.error('[Email] Failed to send class confirmation:', describeEmailSendError(error));
            return false;
        }

        console.log(`[Email] Class confirmation sent to ${redactEmailForLog(email)}`);
        return true;
    } catch (error) {
        console.error('[Email] Error sending class confirmation:', describeEmailSendError(error));
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
        const { error } = await getResend().emails.send({
            from: getEmailFrom(),
            to: email,
            subject: `Reminder: your class is tomorrow - ${data.date}`,
            html: classReminderTemplate(data),
        });

        if (error) {
            console.error('[Email] Failed to send class reminder:', describeEmailSendError(error));
            return false;
        }

        console.log(`[Email] Class reminder sent to ${redactEmailForLog(email)}`);
        return true;
    } catch (error) {
        console.error('[Email] Error sending class reminder:', describeEmailSendError(error));
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
        const { error } = await getResend().emails.send({
            from: getEmailFrom(),
            to: email,
            subject: `Class cancelled - ${data.date}`,
            html: classCancelledTemplate(data),
        });

        if (error) {
            console.error('[Email] Failed to send cancellation email:', describeEmailSendError(error));
            return false;
        }

        console.log(`[Email] Cancellation email sent to ${redactEmailForLog(email)}`);
        return true;
    } catch (error) {
        console.error('[Email] Error sending cancellation email:', describeEmailSendError(error));
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
    await sendClassConfirmation(studentEmail, {
        recipientName: studentName,
        isTeacher: false,
        otherPartyName: teacherName,
        ...classDetails,
    });

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
    await sendClassCancelled(studentEmail, {
        recipientName: studentName,
        ...data,
    });

    await sendClassCancelled(teacherEmail, {
        recipientName: teacherName,
        ...data,
    });
}

// ============================================
// Send Lead Application Email
// ============================================

export async function sendLeadWelcomeEmail(
    email: string,
    data: LeadWelcomeEmailData
): Promise<boolean> {
    try {
        const { error } = await getResend().emails.send({
            from: getEmailFrom(),
            to: email,
            subject: 'Application received - Español Honesto',
            html: leadWelcomeTemplate(data),
        });

        if (error) {
            console.error('[Email] Failed to send lead welcome email:', describeEmailSendError(error));
            // Failing this confirmation should not crash the lead capture flow.
            return false;
        }

        console.log(`[Email] Lead welcome email sent to ${redactEmailForLog(email)}`);
        return true;
    } catch (error) {
        console.error('[Email] Error sending lead welcome email:', describeEmailSendError(error));
        return false;
    }
}

export async function sendLevelCheckInviteEmail(
    email: string,
    data: LevelCheckInviteEmailData
): Promise<boolean> {
    try {
        const { error } = await getResend().emails.send({
            from: getEmailFrom(),
            to: email,
            subject: 'A few level questions - Espanol Honesto',
            html: levelCheckInviteTemplate(data),
        });

        if (error) {
            console.error('[Email] Failed to send level check invite:', describeEmailSendError(error));
            return false;
        }

        console.log(`[Email] Level check invite sent to ${redactEmailForLog(email)}`);
        return true;
    } catch (error) {
        console.error('[Email] Error sending level check invite:', describeEmailSendError(error));
        return false;
    }
}

export async function sendMissingInfoEmail(
    email: string,
    data: MissingInfoEmailData
): Promise<boolean> {
    try {
        const { error } = await getResend().emails.send({
            from: getEmailFrom(),
            to: email,
            subject: 'A little more context - Espanol Honesto',
            html: missingInfoEmailTemplate(data),
        });

        if (error) {
            console.error('[Email] Failed to send missing info email:', describeEmailSendError(error));
            return false;
        }

        console.log(`[Email] Missing info email sent to ${redactEmailForLog(email)}`);
        return true;
    } catch (error) {
        console.error('[Email] Error sending missing info email:', describeEmailSendError(error));
        return false;
    }
}

export async function sendProposalNextStepEmail(
    email: string,
    data: ProposalNextStepEmailData
): Promise<boolean> {
    try {
        const { error } = await getResend().emails.send({
            from: getEmailFrom(),
            to: email,
            subject: 'Suggested next step - Espanol Honesto',
            html: proposalNextStepEmailTemplate(data),
        });

        if (error) {
            console.error('[Email] Failed to send proposal next step email:', describeEmailSendError(error));
            return false;
        }

        console.log(`[Email] Proposal next step email sent to ${redactEmailForLog(email)}`);
        return true;
    } catch (error) {
        console.error('[Email] Error sending proposal next step email:', describeEmailSendError(error));
        return false;
    }
}

export async function sendSupportTicketReceivedEmail(
    email: string,
    data: SupportTicketReceivedEmailData
): Promise<boolean> {
    try {
        const { error } = await getResend().emails.send({
            from: getEmailFrom(),
            to: email,
            subject: 'Support request received - Espanol Honesto',
            html: supportTicketReceivedTemplate(data),
        });

        if (error) {
            console.error('[Email] Failed to send support acknowledgement:', describeEmailSendError(error));
            return false;
        }

        console.log(`[Email] Support acknowledgement sent to ${redactEmailForLog(email)}`);
        return true;
    } catch (error) {
        console.error('[Email] Error sending support acknowledgement:', describeEmailSendError(error));
        return false;
    }
}

export async function sendSupportTicketUpdatedEmail(
    email: string,
    data: SupportTicketUpdatedEmailData
): Promise<boolean> {
    try {
        const { error } = await getResend().emails.send({
            from: getEmailFrom(),
            to: email,
            subject: 'Support request updated - Espanol Honesto',
            html: supportTicketUpdatedTemplate(data),
        });

        if (error) {
            console.error('[Email] Failed to send support update:', describeEmailSendError(error));
            return false;
        }

        console.log(`[Email] Support update sent to ${redactEmailForLog(email)}`);
        return true;
    } catch (error) {
        console.error('[Email] Error sending support update:', describeEmailSendError(error));
        return false;
    }
}
