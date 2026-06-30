import { getEmailFrom, getResend } from './client';
import {
    classCancelledTemplate,
    classConfirmationTemplate,
    classReminderTemplate,
    leadWelcomeTemplate,
    levelCheckInviteTemplate,
    missingInfoEmailTemplate,
    proposalNextStepEmailTemplate,
    supportTicketReceivedTemplate,
    supportTicketUpdatedTemplate,
    welcomeEmailTemplate,
} from './templates';

export const emailPreviewTypes = [
    'welcome',
    'confirmation',
    'reminder',
    'cancelled',
    'lead',
    'level-check',
    'missing-info',
    'proposal-next-step',
    'support-received',
    'support-updated',
] as const;
export type EmailPreviewType = typeof emailPreviewTypes[number];

export type EmailPreview = {
    type: EmailPreviewType;
    subject: string;
    html: string;
};

export function isEmailPreviewType(value: string): value is EmailPreviewType {
    return emailPreviewTypes.includes(value as EmailPreviewType);
}

export function buildEmailPreview(type: EmailPreviewType): EmailPreview {
    switch (type) {
        case 'welcome':
            return {
                type,
                subject: 'Welcome to Español Honesto',
                html: welcomeEmailTemplate({
                    studentName: 'Test User',
                    packageName: 'Hybrid Plan',
                    loginUrl: 'https://staging.espanolhonesto.com/es/login',
                    driveFolderUrl: 'https://drive.google.com/example',
                }),
            };
        case 'confirmation':
            return {
                type,
                subject: 'Class confirmed - 15 January',
                html: classConfirmationTemplate({
                    recipientName: 'Test User',
                    isTeacher: false,
                    otherPartyName: 'Alejandro Garcia',
                    date: 'Thursday, 15 January 2026',
                    time: '10:00',
                    duration: 50,
                    meetLink: 'https://meet.google.com/abc-defg-hij',
                    documentLink: 'https://docs.google.com/example',
                }),
            };
        case 'reminder':
            return {
                type,
                subject: 'Reminder: your class is tomorrow',
                html: classReminderTemplate({
                    recipientName: 'Test User',
                    teacherName: 'Alejandro Garcia',
                    date: 'Friday, 16 January 2026',
                    time: '10:00',
                    meetLink: 'https://meet.google.com/abc-defg-hij',
                    documentLink: 'https://docs.google.com/example',
                }),
            };
        case 'cancelled':
            return {
                type,
                subject: 'Class cancelled - 15 January',
                html: classCancelledTemplate({
                    recipientName: 'Test User',
                    date: 'Thursday, 15 January 2026',
                    time: '10:00',
                    cancelledBy: 'student',
                    reason: 'Test cancellation reason',
                }),
            };
        case 'lead':
            return {
                type,
                subject: 'Application received - Español Honesto',
                html: leadWelcomeTemplate({
                    recipientName: 'Test User',
                }),
            };
        case 'level-check':
            return {
                type,
                subject: 'A few level questions - Espanol Honesto',
                html: levelCheckInviteTemplate({
                    recipientName: 'Test User',
                    diagnosticUrl: 'https://staging.espanolhonesto.com/en/diagnostico?email=test%40example.com',
                }),
            };
        case 'missing-info':
            return {
                type,
                subject: 'A little more context - Espanol Honesto',
                html: missingInfoEmailTemplate({
                    recipientName: 'Test User',
                    diagnosticUrl: 'https://staging.espanolhonesto.com/en/diagnostico?email=test%40example.com',
                }),
            };
        case 'proposal-next-step':
            return {
                type,
                subject: 'Suggested next step - Espanol Honesto',
                html: proposalNextStepEmailTemplate({
                    recipientName: 'Test User',
                    planRecommendation: 'Start with a focused conversation plan for professional and everyday situations.',
                }),
            };
        case 'support-received':
            return {
                type,
                subject: 'Support request received - Espanol Honesto',
                html: supportTicketReceivedTemplate({
                    recipientName: 'Test User',
                    issueTitle: 'Missing Meet link',
                    ticketId: 'ticket-preview',
                    supportUrl: 'https://staging.espanolhonesto.com/en/campus/support',
                }),
            };
        case 'support-updated':
            return {
                type,
                subject: 'Support request updated - Espanol Honesto',
                html: supportTicketUpdatedTemplate({
                    recipientName: 'Test User',
                    issueTitle: 'Missing Meet link',
                    ticketId: 'ticket-preview',
                    status: 'closed',
                    adminNote: 'We checked the class and restored the Meet link in your campus.',
                    supportUrl: 'https://staging.espanolhonesto.com/en/campus/support',
                }),
            };
    }
}

export async function sendEmailPreview(type: EmailPreviewType, email: string): Promise<boolean> {
    const preview = buildEmailPreview(type);
    const { error } = await getResend().emails.send({
        from: getEmailFrom(),
        to: email,
        subject: preview.subject,
        html: preview.html,
    });

    if (error) {
        console.error('[EmailPreview] Resend rejected test email:', error);
        return false;
    }

    return true;
}
