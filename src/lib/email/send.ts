/**
 * Transactional email send functions. Every provider call passes through the
 * persistent recipient-budget gate in delivery.ts.
 */
import { deliverEmail } from './delivery';
import { describeEmailSendError, redactEmailForLog } from './errors';
import {
    sendFulfillmentEmailEffect,
    type FulfillmentEmailEffectContext,
} from '../fulfillment/effects';
import {
    welcomeEmailTemplate,
    welcomeEmailSubject,
    renewalNoticeEmailTemplate,
    renewalNoticeSubject,
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
    type RenewalNoticeEmailData,
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

type TransactionalEmailInput = {
    email: string;
    failureLabel: string;
    html: string;
    source: string;
    subject: string;
    successLabel: string;
    thrownLabel: string;
};

export type TransactionalEmailSendOptions = {
    fulfillmentEffect?: FulfillmentEmailEffectContext;
};

async function sendTransactionalEmail(
    input: TransactionalEmailInput,
    options: TransactionalEmailSendOptions = {},
): Promise<boolean> {
    if (options.fulfillmentEffect) {
        await sendFulfillmentEmailEffect(options.fulfillmentEffect, {
            email: input.email,
            html: input.html,
            source: input.source,
            subject: input.subject,
        });
        console.log(`${input.successLabel} ${redactEmailForLog(input.email)}`);
        return true;
    }

    try {
        const result = await deliverEmail({
            to: input.email,
            subject: input.subject,
            html: input.html,
            source: input.source,
        });

        if (!result.ok) {
            console.error(
                input.failureLabel,
                result.error ? describeEmailSendError(result.error) : result.reason,
            );
            return false;
        }

        console.log(`${input.successLabel} ${redactEmailForLog(input.email)}`);
        return true;
    } catch (error) {
        console.error(input.thrownLabel, describeEmailSendError(error));
        return false;
    }
}

export async function sendWelcomeEmail(
    email: string,
    data: WelcomeEmailData,
    options: TransactionalEmailSendOptions = {},
): Promise<boolean> {
    return sendTransactionalEmail({
        email,
        subject: welcomeEmailSubject(data.locale),
        html: welcomeEmailTemplate(data),
        source: 'welcome',
        failureLabel: '[Email] Failed to send welcome email:',
        thrownLabel: '[Email] Error sending welcome email:',
        successLabel: '[Email] Welcome email sent to',
    }, options);
}

export async function sendRenewalNoticeEmail(
    email: string,
    data: RenewalNoticeEmailData,
    options: TransactionalEmailSendOptions = {},
): Promise<boolean> {
    return sendTransactionalEmail({
        email,
        subject: renewalNoticeSubject(data.locale),
        html: renewalNoticeEmailTemplate(data),
        source: 'renewal_notice',
        failureLabel: '[Email] Failed to send renewal notice:',
        thrownLabel: '[Email] Error sending renewal notice:',
        successLabel: '[Email] Renewal notice sent to',
    }, options);
}

export async function sendClassConfirmation(
    email: string,
    data: ClassConfirmationData,
    options: TransactionalEmailSendOptions = {},
): Promise<boolean> {
    return sendTransactionalEmail({
        email,
        subject: data.isTeacher
            ? `New class scheduled - ${data.date}`
            : `Class confirmed - ${data.date}`,
        html: classConfirmationTemplate(data),
        source: 'class_confirmation',
        failureLabel: '[Email] Failed to send class confirmation:',
        thrownLabel: '[Email] Error sending class confirmation:',
        successLabel: '[Email] Class confirmation sent to',
    }, options);
}

export async function sendClassReminder(email: string, data: ClassReminderData): Promise<boolean> {
    return sendTransactionalEmail({
        email,
        subject: `Reminder: your class is tomorrow - ${data.date}`,
        html: classReminderTemplate(data),
        source: 'class_reminder',
        failureLabel: '[Email] Failed to send class reminder:',
        thrownLabel: '[Email] Error sending class reminder:',
        successLabel: '[Email] Class reminder sent to',
    });
}

export async function sendClassCancelled(
    email: string,
    data: ClassCancelledData,
    options: TransactionalEmailSendOptions = {},
): Promise<boolean> {
    return sendTransactionalEmail({
        email,
        subject: `Class cancelled - ${data.date}`,
        html: classCancelledTemplate(data),
        source: 'class_cancelled',
        failureLabel: '[Email] Failed to send cancellation email:',
        thrownLabel: '[Email] Error sending cancellation email:',
        successLabel: '[Email] Cancellation email sent to',
    }, options);
}

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
    },
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
    data: Omit<ClassCancelledData, 'recipientName'>,
): Promise<void> {
    await sendClassCancelled(studentEmail, { recipientName: studentName, ...data });
    await sendClassCancelled(teacherEmail, { recipientName: teacherName, ...data });
}

export async function sendLeadWelcomeEmail(
    email: string,
    data: LeadWelcomeEmailData,
): Promise<boolean> {
    return sendTransactionalEmail({
        email,
        subject: 'Application received - Español Honesto',
        html: leadWelcomeTemplate(data),
        source: 'lead_welcome',
        failureLabel: '[Email] Failed to send lead welcome email:',
        thrownLabel: '[Email] Error sending lead welcome email:',
        successLabel: '[Email] Lead welcome email sent to',
    });
}

export async function sendLevelCheckInviteEmail(
    email: string,
    data: LevelCheckInviteEmailData,
): Promise<boolean> {
    return sendTransactionalEmail({
        email,
        subject: 'A few level questions - Espanol Honesto',
        html: levelCheckInviteTemplate(data),
        source: 'level_check_invite',
        failureLabel: '[Email] Failed to send level check invite:',
        thrownLabel: '[Email] Error sending level check invite:',
        successLabel: '[Email] Level check invite sent to',
    });
}

export async function sendMissingInfoEmail(
    email: string,
    data: MissingInfoEmailData,
): Promise<boolean> {
    return sendTransactionalEmail({
        email,
        subject: 'A little more context - Espanol Honesto',
        html: missingInfoEmailTemplate(data),
        source: 'missing_info',
        failureLabel: '[Email] Failed to send missing info email:',
        thrownLabel: '[Email] Error sending missing info email:',
        successLabel: '[Email] Missing info email sent to',
    });
}

export async function sendProposalNextStepEmail(
    email: string,
    data: ProposalNextStepEmailData,
): Promise<boolean> {
    return sendTransactionalEmail({
        email,
        subject: 'Suggested next step - Espanol Honesto',
        html: proposalNextStepEmailTemplate(data),
        source: 'proposal_next_step',
        failureLabel: '[Email] Failed to send proposal next step email:',
        thrownLabel: '[Email] Error sending proposal next step email:',
        successLabel: '[Email] Proposal next step email sent to',
    });
}

export async function sendSupportTicketReceivedEmail(
    email: string,
    data: SupportTicketReceivedEmailData,
): Promise<boolean> {
    return sendTransactionalEmail({
        email,
        subject: 'Support request received - Espanol Honesto',
        html: supportTicketReceivedTemplate(data),
        source: 'support_received',
        failureLabel: '[Email] Failed to send support acknowledgement:',
        thrownLabel: '[Email] Error sending support acknowledgement:',
        successLabel: '[Email] Support acknowledgement sent to',
    });
}

export async function sendSupportTicketUpdatedEmail(
    email: string,
    data: SupportTicketUpdatedEmailData,
): Promise<boolean> {
    return sendTransactionalEmail({
        email,
        subject: 'Support request updated - Espanol Honesto',
        html: supportTicketUpdatedTemplate(data),
        source: 'support_updated',
        failureLabel: '[Email] Failed to send support update:',
        thrownLabel: '[Email] Error sending support update:',
        successLabel: '[Email] Support update sent to',
    });
}
