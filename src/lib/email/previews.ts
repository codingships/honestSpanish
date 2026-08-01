import {
    classCancelledTemplate,
    classConfirmationTemplate,
    classReminderTemplate,
    leadWelcomeTemplate,
    levelCheckInviteTemplate,
    missingInfoEmailTemplate,
    proposalNextStepEmailTemplate,
    renewalNoticeEmailTemplate,
    renewalNoticeSubject,
    supportTicketReceivedTemplate,
    supportTicketUpdatedTemplate,
    welcomeEmailTemplate,
    welcomeEmailSubject,
} from './templates';
import { describeEmailSendError } from './errors';
import { deliverEmail } from './delivery';

export const emailPreviewTypes = [
    'welcome',
    'renewal',
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
export const emailPreviewLocales = ['es', 'en', 'ru'] as const;
export type EmailPreviewLocale = typeof emailPreviewLocales[number];

const previewPackageNames: Record<EmailPreviewLocale, { welcome: string; renewal: string }> = {
    es: { welcome: '4 clases individuales de 50 minutos', renewal: '4 clases individuales de 50 minutos' },
    en: { welcome: '4 individual 50-minute classes', renewal: '4 individual 50-minute classes' },
    ru: { welcome: '4 индивидуальных занятия по 50 минут', renewal: '4 индивидуальных занятия по 50 минут' },
};

export type EmailPreview = {
    type: EmailPreviewType;
    subject: string;
    html: string;
};

export function isEmailPreviewType(value: string): value is EmailPreviewType {
    return emailPreviewTypes.includes(value as EmailPreviewType);
}

export function isEmailPreviewLocale(value: string): value is EmailPreviewLocale {
    return emailPreviewLocales.includes(value as EmailPreviewLocale);
}

export function buildEmailPreview(type: EmailPreviewType, locale: EmailPreviewLocale = 'en'): EmailPreview {
    switch (type) {
        case 'welcome': {
            const welcomeLocale = locale;
            return {
                type,
                subject: welcomeEmailSubject(welcomeLocale),
                html: welcomeEmailTemplate({
                    locale: welcomeLocale,
                    studentName: 'Test User',
                    packageName: previewPackageNames[welcomeLocale].welcome,
                    loginUrl: `https://staging.espanolhonesto.com/${welcomeLocale}/login`,
                    driveFolderUrl: 'https://drive.google.com/example',
                    sessionsTotal: 4,
                    amountTotal: 25900,
                    currency: 'eur',
                    contractSchemaVersion: 2,
                    classDurationMinutes: 50,
                    teacherName: 'Alejandro García',
                    slotWeekday: 1,
                    slotLocalStartTime: '10:00:00',
                    timezoneName: 'Europe/Madrid',
                    classStartsAt: [
                        '2026-09-07T08:00:00.000Z',
                        '2026-09-14T08:00:00.000Z',
                        '2026-09-21T08:00:00.000Z',
                        '2026-09-28T08:00:00.000Z',
                    ],
                    renewalAnchorAt: '2026-10-05T08:00:00.000Z',
                    legalPolicyVersion: '2026-07-10',
                    policyAcceptedAt: '2026-09-01T10:00:00.000Z',
                    termsUrl: `https://staging.espanolhonesto.com/${welcomeLocale}/legal/terminos`,
                    supportUrl: `https://staging.espanolhonesto.com/${welcomeLocale}/campus/support`,
                }),
            };
        }
        case 'renewal': {
            const renewalLocale = locale;
            return {
                type,
                subject: renewalNoticeSubject(renewalLocale),
                html: renewalNoticeEmailTemplate({
                    locale: renewalLocale,
                    studentName: 'Test User',
                    packageName: previewPackageNames[renewalLocale].renewal,
                    renewalAt: '2026-10-05T08:00:00.000Z',
                    cancelBy: '2026-10-05T08:00:00.000Z',
                    billingIntervalUnit: 'day',
                    billingIntervalCount: 28,
                    amountTotal: 25900,
                    currency: 'eur',
                    accountUrl: `https://staging.espanolhonesto.com/${renewalLocale}/campus/account`,
                    supportUrl: `https://staging.espanolhonesto.com/${renewalLocale}/campus/support`,
                    termsUrl: `https://staging.espanolhonesto.com/${renewalLocale}/legal/terminos`,
                }),
            };
        }
        case 'confirmation':
            return {
                type,
                subject: 'Class confirmed - Thursday, 15 January 2026',
                html: classConfirmationTemplate({
                    recipientName: 'Test User',
                    isTeacher: false,
                    otherPartyName: 'Alejandro Garcia',
                    date: 'Thursday, 15 January 2026',
                    time: '10:00 CET',
                    duration: 50,
                    meetLink: 'https://meet.google.com/abc-defg-hij',
                    documentLink: 'https://docs.google.com/example',
                }),
            };
        case 'reminder':
            return {
                type,
                subject: 'Reminder: your class is tomorrow - Friday, 16 January 2026',
                html: classReminderTemplate({
                    recipientName: 'Test User',
                    teacherName: 'Alejandro Garcia',
                    date: 'Friday, 16 January 2026',
                    time: '10:00 CET',
                    meetLink: 'https://meet.google.com/abc-defg-hij',
                    documentLink: 'https://docs.google.com/example',
                }),
            };
        case 'cancelled':
            return {
                type,
                subject: 'Class cancelled - Thursday, 15 January 2026',
                html: classCancelledTemplate({
                    recipientName: 'Test User',
                    date: 'Thursday, 15 January 2026',
                    time: '10:00 CET',
                    cancelledBy: 'student',
                    reason: 'Test cancellation reason',
                }),
            };
        case 'lead':
            return {
                type,
                subject: 'Direct booking details - Espanol Honesto',
                html: leadWelcomeTemplate({
                    recipientName: 'Test User',
                }),
            };
        case 'level-check':
            return {
                type,
                subject: 'Optional Spanish context - Espanol Honesto',
                html: levelCheckInviteTemplate({
                    recipientName: 'Test User',
                    diagnosticUrl: 'https://staging.espanolhonesto.com/en/diagnostico?email=test%40example.com',
                }),
            };
        case 'missing-info':
            return {
                type,
                subject: 'Optional context for your classes - Espanol Honesto',
                html: missingInfoEmailTemplate({
                    recipientName: 'Test User',
                    diagnosticUrl: 'https://staging.espanolhonesto.com/en/diagnostico?email=test%40example.com',
                }),
            };
        case 'proposal-next-step':
            return {
                type,
                subject: 'How direct booking will work - Espanol Honesto',
                html: proposalNextStepEmailTemplate({
                    recipientName: 'Test User',
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

export async function sendEmailPreview(
    type: EmailPreviewType,
    email: string,
    locale: EmailPreviewLocale = 'en',
): Promise<boolean> {
    const preview = buildEmailPreview(type, locale);
    const result = await deliverEmail({
        to: email,
        subject: preview.subject,
        html: preview.html,
        source: 'email_preview',
    });

    if (!result.ok) {
        console.error(
            '[EmailPreview] Resend rejected test email:',
            result.error ? describeEmailSendError(result.error) : result.reason,
        );
        return false;
    }

    return true;
}
