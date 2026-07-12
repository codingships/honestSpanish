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
    es: { welcome: 'Híbrido mensual', renewal: 'Mensual estándar' },
    en: { welcome: 'Hybrid monthly', renewal: 'Standard monthly' },
    ru: { welcome: 'Гибридный месяц', renewal: 'Стандартный месяц' },
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
                    loginUrl: `https://espanolhonesto-staging.alindev95.workers.dev/${welcomeLocale}/login`,
                    driveFolderUrl: 'https://drive.google.com/example',
                    durationMonths: 3,
                    startsAt: '2026-10-10',
                    endsAt: '2027-01-09',
                    sessionsTotal: 12,
                    amountTotal: 40500,
                    currency: 'eur',
                    legalPolicyVersion: '2026-07-10',
                    policyAcceptedAt: '2026-10-10T12:00:00.000Z',
                    termsUrl: `https://espanolhonesto-staging.alindev95.workers.dev/${welcomeLocale}/legal/terminos`,
                    supportUrl: `https://espanolhonesto-staging.alindev95.workers.dev/${welcomeLocale}/campus/support`,
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
                    renewalAt: '2026-10-10T12:00:00.000Z',
                    cancelBy: '2026-10-10T12:00:00.000Z',
                    durationMonths: 1,
                    amountTotal: 14500,
                    currency: 'eur',
                    accountUrl: `https://espanolhonesto-staging.alindev95.workers.dev/${renewalLocale}/campus/account`,
                    supportUrl: `https://espanolhonesto-staging.alindev95.workers.dev/${renewalLocale}/campus/support`,
                    termsUrl: `https://espanolhonesto-staging.alindev95.workers.dev/${renewalLocale}/legal/terminos`,
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
                    diagnosticUrl: 'https://espanolhonesto-staging.alindev95.workers.dev/en/diagnostico?email=test%40example.com',
                }),
            };
        case 'missing-info':
            return {
                type,
                subject: 'A little more context - Espanol Honesto',
                html: missingInfoEmailTemplate({
                    recipientName: 'Test User',
                    diagnosticUrl: 'https://espanolhonesto-staging.alindev95.workers.dev/en/diagnostico?email=test%40example.com',
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
                    supportUrl: 'https://espanolhonesto-staging.alindev95.workers.dev/en/campus/support',
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
                    supportUrl: 'https://espanolhonesto-staging.alindev95.workers.dev/en/campus/support',
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
