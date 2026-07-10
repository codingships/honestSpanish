/**
 * Email Templates
 * Branded HTML templates for transactional emails.
 */

// ============================================
// Base Template
// ============================================

export function baseTemplate(content: string): string {
    const year = new Date().getFullYear();

    return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Español Honesto</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f5f5f5; font-family: Arial, sans-serif;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f5f5f5; padding: 40px 20px;">
        <tr>
            <td align="center">
                <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 4px; overflow: hidden; max-width: 100%;">
                    <tr>
                        <td style="background-color: #006064; padding: 30px; text-align: center;">
                            <h1 style="margin: 0; color: #ffffff; font-size: 28px; font-weight: bold; letter-spacing: 2px;">
                                ESPAÑOL HONESTO
                            </h1>
                        </td>
                    </tr>
                    <tr>
                        <td style="padding: 40px 30px;">
                            ${content}
                        </td>
                    </tr>
                    <tr>
                        <td style="background-color: #E0F7FA; padding: 25px 30px; text-align: center; border-top: 3px solid #006064;">
                            <p style="margin: 0 0 10px 0; color: #006064; font-size: 14px;">
                                Questions? Reply to this email.
                            </p>
                            <p style="margin: 0; color: #666666; font-size: 12px;">
                                © ${year} Español Honesto · Madrid, Spain
                            </p>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>
    `.trim();
}

// ============================================
// Welcome Email
// ============================================

export interface WelcomeEmailData {
    studentName: string;
    packageName: string;
    loginUrl: string;
    driveFolderUrl?: string;
    durationMonths?: number;
    startsAt?: string;
    endsAt?: string;
    sessionsTotal?: number;
    amountTotal?: number;
    currency?: string;
    legalPolicyVersion?: string;
    policyAcceptedAt?: string;
    termsUrl?: string;
    supportUrl?: string;
}

export function welcomeEmailTemplate(data: WelcomeEmailData): string {
    const studentName = escapeEmailHtml(data.studentName);
    const packageName = escapeEmailHtml(data.packageName);
    const loginUrl = safeEmailUrl(data.loginUrl);
    const driveFolderUrl = safeEmailUrl(data.driveFolderUrl);
    const termsUrl = safeEmailUrl(data.termsUrl);
    const supportUrl = safeEmailUrl(data.supportUrl);
    const durationMonths = Number.isInteger(data.durationMonths) ? String(data.durationMonths) : '';
    const sessionsTotal = Number.isInteger(data.sessionsTotal) ? String(data.sessionsTotal) : '';
    const startsAt = escapeEmailHtml(data.startsAt || '');
    const endsAt = escapeEmailHtml(data.endsAt || '');
    const legalPolicyVersion = escapeEmailHtml(data.legalPolicyVersion || '');
    const policyAcceptedAt = escapeEmailHtml(data.policyAcceptedAt || '');
    const currency = typeof data.currency === 'string' && /^[a-z]{3}$/i.test(data.currency)
        ? data.currency.toUpperCase()
        : 'EUR';
    const amountPaid = Number.isInteger(data.amountTotal) && (data.amountTotal ?? 0) >= 0
        ? new Intl.NumberFormat('en-IE', { style: 'currency', currency }).format((data.amountTotal ?? 0) / 100)
        : '';
    const hasContractDetails = Boolean(durationMonths && startsAt && endsAt && sessionsTotal && amountPaid);
    const content = `
        <h2 style="color: #006064; margin: 0 0 20px 0;">Welcome, ${studentName}</h2>

        <p style="color: #333333; font-size: 16px; line-height: 1.6;">
            Your <strong>${packageName}</strong> plan is active.
            We are glad to have you with us.
        </p>

        ${hasContractDetails ? `
        <div style="background-color: #f9f9f9; padding: 20px; margin: 25px 0; border: 2px solid #006064;">
            <p style="margin: 0 0 12px 0; color: #006064; font-weight: bold;">Your contract summary</p>
            <ul style="margin: 0; padding-left: 20px; color: #333333; line-height: 1.7;">
                <li>Plan: ${packageName}</li>
                <li>Subscription period: ${durationMonths} month(s), ${startsAt} to ${endsAt}</li>
                <li>Class allowance for this period: ${sessionsTotal}</li>
                <li>Amount charged at the start of the period: ${escapeEmailHtml(amountPaid)}</li>
                <li>Automatic renewal: the same amount and period recur until renewal is disabled before the next charge.</li>
                <li>Unused classes expire on ${endsAt} and do not roll over, subject to statutory rights and approved exceptions.</li>
                <li>Class cancellation: at least 24 hours restores the credit; later cancellation or no-show consumes it, subject to a justified support exception.</li>
            </ul>
            ${legalPolicyVersion ? `<p style="margin: 12px 0 0 0; color: #666666; font-size: 12px;">Terms version: ${legalPolicyVersion}${policyAcceptedAt ? ` · accepted ${policyAcceptedAt}` : ''}</p>` : ''}
        </div>
        ` : ''}

        ${termsUrl ? `
        <p style="color: #333333; font-size: 14px; line-height: 1.6;">
            Your terms, 14-day withdrawal information and model form are available at
            <a href="${termsUrl}" style="color: #006064;">${termsUrl}</a>.
            ${supportUrl ? `To cancel renewal, report an incident or exercise withdrawal, use <a href="${supportUrl}" style="color: #006064;">support</a> or reply to this email.` : ''}
        </p>
        ` : ''}

        <div style="background-color: #E0F7FA; padding: 20px; margin: 25px 0; border-left: 4px solid #006064;">
            <p style="margin: 0 0 10px 0; color: #006064; font-weight: bold;">Next steps:</p>
            <ol style="margin: 0; padding-left: 20px; color: #333333;">
                <li style="margin-bottom: 8px;">Open your campus and check that you can access your dashboard and materials.</li>
                <li style="margin-bottom: 8px;">Reply with any schedule limits before your first class if something has changed.</li>
                <li style="margin-bottom: 8px;">We will coordinate your first class manually, respecting real availability.</li>
                <li style="margin-bottom: 8px;">Your materials folder should be ready before the first class.</li>
            </ol>
        </div>

        ${loginUrl ? `
        <table width="100%" cellpadding="0" cellspacing="0" style="margin: 30px 0;">
            <tr>
                <td align="center">
                    <a href="${loginUrl}" style="display: inline-block; background-color: #006064; color: #ffffff; padding: 15px 40px; text-decoration: none; font-weight: bold; font-size: 16px;">
                        OPEN CAMPUS
                    </a>
                </td>
            </tr>
        </table>
        ` : ''}

        ${driveFolderUrl ? `
        <p style="color: #666666; font-size: 14px;">
            Your materials folder: <a href="${driveFolderUrl}" style="color: #006064;">${driveFolderUrl}</a>
        </p>
        ` : ''}

        <p style="color: #333333; font-size: 16px; line-height: 1.6;">
            Speak soon,<br>
            <strong>The Español Honesto team</strong>
        </p>
    `;

    return baseTemplate(content);
}

// ============================================
// Upcoming Renewal Notice
// ============================================

export type RenewalNoticeLocale = 'es' | 'en' | 'ru';

export interface RenewalNoticeEmailData {
    locale: RenewalNoticeLocale;
    studentName: string;
    packageName: string;
    renewalAt: string;
    cancelBy: string;
    durationMonths: number;
    amountTotal: number;
    currency: string;
    accountUrl: string;
    supportUrl: string;
    termsUrl: string;
}

const renewalNoticeCopy = {
    es: {
        subject: 'Aviso de renovación de tu suscripción - Español Honesto',
        title: 'Tu suscripción se renovará próximamente',
        hello: 'Hola',
        intro: 'Te avisamos con antelación de la próxima renovación automática de tu suscripción.',
        plan: 'Plan',
        chargeDate: 'Fecha prevista de cobro',
        amount: 'Importe',
        period: 'Nuevo periodo',
        deadline: 'Plazo de cancelación',
        deadlineText: 'antes de la fecha prevista de cobro indicada arriba',
        cancel: 'Puedes desactivar la renovación desde tu cuenta. También puedes solicitarlo por soporte o respondiendo a este correo antes del plazo.',
        consequence: 'Si no cancelas a tiempo, se cobrará el importe indicado y la suscripción se renovará por el mismo periodo.',
        accountButton: 'GESTIONAR RENOVACIÓN',
        support: 'Contactar con soporte',
        terms: 'Consultar condiciones',
        signoff: 'Equipo de Español Honesto',
    },
    en: {
        subject: 'Your subscription renewal notice - Español Honesto',
        title: 'Your subscription will renew soon',
        hello: 'Hello',
        intro: 'This is advance notice of the upcoming automatic renewal of your subscription.',
        plan: 'Plan',
        chargeDate: 'Expected charge date',
        amount: 'Amount',
        period: 'New period',
        deadline: 'Cancellation deadline',
        deadlineText: 'before the expected charge date shown above',
        cancel: 'You can turn off renewal from your account. You may also ask support or reply to this email before the deadline.',
        consequence: 'If you do not cancel in time, the stated amount will be charged and the subscription will renew for the same period.',
        accountButton: 'MANAGE RENEWAL',
        support: 'Contact support',
        terms: 'View terms',
        signoff: 'The Español Honesto team',
    },
    ru: {
        subject: 'Уведомление о продлении подписки - Español Honesto',
        title: 'Ваша подписка скоро продлится',
        hello: 'Здравствуйте',
        intro: 'Заранее уведомляем вас о предстоящем автоматическом продлении подписки.',
        plan: 'Тариф',
        chargeDate: 'Предполагаемая дата списания',
        amount: 'Сумма',
        period: 'Новый период',
        deadline: 'Срок отмены',
        deadlineText: 'до указанной выше предполагаемой даты списания',
        cancel: 'Отключить продление можно в личном кабинете. До истечения срока также можно обратиться в поддержку или ответить на это письмо.',
        consequence: 'Если вы не отмените продление вовремя, указанная сумма будет списана, а подписка продлится на тот же период.',
        accountButton: 'УПРАВЛЯТЬ ПРОДЛЕНИЕМ',
        support: 'Связаться с поддержкой',
        terms: 'Посмотреть условия',
        signoff: 'Команда Español Honesto',
    },
} as const;

const renewalIntlLocales: Record<RenewalNoticeLocale, string> = {
    es: 'es-ES',
    en: 'en-GB',
    ru: 'ru-RU',
};

function renewalPeriodLabel(locale: RenewalNoticeLocale, months: number): string {
    if (locale === 'es') return `${months} ${months === 1 ? 'mes' : 'meses'}`;
    if (locale === 'en') return `${months} ${months === 1 ? 'month' : 'months'}`;

    const mod10 = months % 10;
    const mod100 = months % 100;
    const unit = mod10 === 1 && mod100 !== 11
        ? 'месяц'
        : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)
            ? 'месяца'
            : 'месяцев';
    return `${months} ${unit}`;
}

export function renewalNoticeSubject(locale: RenewalNoticeLocale): string {
    return renewalNoticeCopy[locale].subject;
}

export function renewalNoticeEmailTemplate(data: RenewalNoticeEmailData): string {
    const copy = renewalNoticeCopy[data.locale];
    const intlLocale = renewalIntlLocales[data.locale];
    const renewalDate = new Date(data.renewalAt);
    const cancelDate = new Date(data.cancelBy);
    if (!Number.isFinite(renewalDate.getTime()) || !Number.isFinite(cancelDate.getTime())) {
        throw new Error('Renewal notice requires valid renewal and cancellation dates');
    }

    const currency = /^[a-z]{3}$/i.test(data.currency) ? data.currency.toUpperCase() : 'EUR';
    const amountTotal = Number.isInteger(data.amountTotal) && data.amountTotal >= 0 ? data.amountTotal : 0;
    const durationMonths = Number.isInteger(data.durationMonths) && data.durationMonths > 0
        ? data.durationMonths
        : 1;
    const formatDate = (value: Date) => new Intl.DateTimeFormat(intlLocale, {
        dateStyle: 'long',
        timeZone: 'Europe/Madrid',
    }).format(value);
    const amount = new Intl.NumberFormat(intlLocale, {
        style: 'currency',
        currency,
    }).format(amountTotal / 100);
    const studentName = escapeEmailHtml(data.studentName);
    const packageName = escapeEmailHtml(data.packageName);
    const accountUrl = safeEmailUrl(data.accountUrl);
    const supportUrl = safeEmailUrl(data.supportUrl);
    const termsUrl = safeEmailUrl(data.termsUrl);

    const content = `
        <h2 style="color: #006064; margin: 0 0 20px 0;">${copy.title}</h2>
        <p style="color: #333333; font-size: 16px; line-height: 1.6;">${copy.hello} ${studentName},</p>
        <p style="color: #333333; font-size: 16px; line-height: 1.6;">${copy.intro}</p>

        <div style="background-color: #f9f9f9; padding: 20px; margin: 25px 0; border: 2px solid #006064;">
            <p style="margin: 0; color: #333333; font-size: 15px; line-height: 1.8;">
                <strong>${copy.plan}:</strong> ${packageName}<br>
                <strong>${copy.chargeDate}:</strong> ${escapeEmailHtml(formatDate(renewalDate))}<br>
                <strong>${copy.amount}:</strong> ${escapeEmailHtml(amount)}<br>
                <strong>${copy.period}:</strong> ${escapeEmailHtml(renewalPeriodLabel(data.locale, durationMonths))}<br>
                <strong>${copy.deadline}:</strong> ${copy.deadlineText} (${escapeEmailHtml(formatDate(cancelDate))})
            </p>
        </div>

        <p style="color: #333333; font-size: 16px; line-height: 1.6;">${copy.cancel}</p>
        <p style="color: #333333; font-size: 16px; line-height: 1.6;"><strong>${copy.consequence}</strong></p>

        ${accountUrl ? `<p style="text-align: center; margin: 30px 0;"><a href="${accountUrl}" style="display: inline-block; background-color: #006064; color: #ffffff; padding: 15px 32px; text-decoration: none; font-weight: bold;">${copy.accountButton}</a></p>` : ''}
        <p style="color: #666666; font-size: 14px; line-height: 1.7;">
            ${supportUrl ? `<a href="${supportUrl}" style="color: #006064;">${copy.support}</a>` : ''}
            ${supportUrl && termsUrl ? ' · ' : ''}
            ${termsUrl ? `<a href="${termsUrl}" style="color: #006064;">${copy.terms}</a>` : ''}
        </p>
        <p style="color: #333333; font-size: 16px; line-height: 1.6;">${copy.signoff}</p>
    `;

    return baseTemplate(content);
}

// ============================================
// Class Confirmation Email
// ============================================

export interface ClassConfirmationData {
    recipientName: string;
    isTeacher: boolean;
    otherPartyName: string;
    date: string;
    time: string;
    duration: number;
    meetLink?: string;
    documentLink?: string;
}

export function classConfirmationTemplate(data: ClassConfirmationData): string {
    const title = data.isTeacher ? 'New class scheduled' : 'Your class is confirmed';
    const recipientName = escapeEmailHtml(data.recipientName);
    const otherPartyName = escapeEmailHtml(data.otherPartyName);
    const date = escapeEmailHtml(data.date);
    const time = escapeEmailHtml(data.time);
    const duration = escapeEmailHtml(String(data.duration));
    const meetLink = safeEmailUrl(data.meetLink);
    const documentLink = safeEmailUrl(data.documentLink);

    const content = `
        <h2 style="color: #006064; margin: 0 0 20px 0;">${title}</h2>

        <p style="color: #333333; font-size: 16px; line-height: 1.6;">
            Hi ${recipientName},
        </p>

        <p style="color: #333333; font-size: 16px; line-height: 1.6;">
            ${data.isTeacher ? 'A class has been scheduled with your student:' : 'Your next Spanish class is confirmed:'}
        </p>

        <div style="background-color: #f9f9f9; padding: 25px; margin: 25px 0; border: 2px solid #006064;">
            <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                    <td style="padding: 8px 0; color: #666666; font-size: 14px;">Date:</td>
                    <td style="padding: 8px 0; color: #333333; font-size: 16px; font-weight: bold;">${date}</td>
                </tr>
                <tr>
                    <td style="padding: 8px 0; color: #666666; font-size: 14px;">Time:</td>
                    <td style="padding: 8px 0; color: #333333; font-size: 16px; font-weight: bold;">${time}</td>
                </tr>
                <tr>
                    <td style="padding: 8px 0; color: #666666; font-size: 14px;">Duration:</td>
                    <td style="padding: 8px 0; color: #333333; font-size: 16px;">${duration} minutes</td>
                </tr>
                <tr>
                    <td style="padding: 8px 0; color: #666666; font-size: 14px;">${data.isTeacher ? 'Student' : 'Teacher'}:</td>
                    <td style="padding: 8px 0; color: #333333; font-size: 16px;">${otherPartyName}</td>
                </tr>
            </table>
        </div>

        ${meetLink ? `
        <table width="100%" cellpadding="0" cellspacing="0" style="margin: 25px 0;">
            <tr>
                <td align="center">
                    <a href="${meetLink}" style="display: inline-block; background-color: #006064; color: #ffffff; padding: 15px 40px; text-decoration: none; font-weight: bold; font-size: 16px;">
                        JOIN THE VIDEO CALL
                    </a>
                </td>
            </tr>
        </table>
        ` : ''}

        ${documentLink ? `
        <p style="color: #666666; font-size: 14px; margin-top: 20px;">
            Class document: <a href="${documentLink}" style="color: #006064;">Open document</a>
        </p>
        ` : ''}

        <p style="color: #333333; font-size: 15px; line-height: 1.6;">
            We schedule ${duration} minutes for the class, and the video call is not cut automatically at the minute mark.
        </p>

        <p style="color: #333333; font-size: 16px; line-height: 1.6; margin-top: 30px;">
            See you soon,<br>
            <strong>Español Honesto</strong>
        </p>
    `;

    return baseTemplate(content);
}

// ============================================
// Class Reminder Email
// ============================================

export interface ClassReminderData {
    recipientName: string;
    date: string;
    time: string;
    teacherName?: string;
    studentName?: string;
    meetLink?: string;
    documentLink?: string;
}

export function classReminderTemplate(data: ClassReminderData): string {
    const isTeacher = !!data.studentName;
    const otherPartyLabel = isTeacher ? 'your student' : 'your teacher';
    const otherPartyName = isTeacher ? data.studentName : data.teacherName;
    const recipientName = escapeEmailHtml(data.recipientName);
    const date = escapeEmailHtml(data.date);
    const time = escapeEmailHtml(data.time);
    const safeOtherPartyName = otherPartyName ? escapeEmailHtml(otherPartyName) : '';
    const meetLink = safeEmailUrl(data.meetLink);
    const documentLink = safeEmailUrl(data.documentLink);

    const content = `
        <h2 style="color: #006064; margin: 0 0 20px 0;">Your class is tomorrow</h2>

        <p style="color: #333333; font-size: 16px; line-height: 1.6;">
            Hi ${recipientName},
        </p>

        <p style="color: #333333; font-size: 16px; line-height: 1.6;">
            This is a reminder that you have a Spanish class scheduled for tomorrow.
        </p>

        <div style="background-color: #E0F7FA; padding: 25px; margin: 25px 0; border-left: 4px solid #006064;">
            <p style="margin: 0 0 10px 0; font-size: 18px; color: #006064; font-weight: bold;">
                ${date} at ${time}
            </p>
            ${safeOtherPartyName ? `
            <p style="margin: 0; color: #333333; font-size: 14px;">
                With ${otherPartyLabel} ${safeOtherPartyName}
            </p>
            ` : ''}
        </div>

        ${meetLink ? `
        <table width="100%" cellpadding="0" cellspacing="0" style="margin: 25px 0;">
            <tr>
                <td align="center">
                    <a href="${meetLink}" style="display: inline-block; background-color: #00897B; color: #ffffff; padding: 15px 40px; text-decoration: none; font-weight: bold; font-size: 16px; border-radius: 4px;">
                        JOIN THE VIDEO CALL
                    </a>
                </td>
            </tr>
        </table>
        ` : ''}

        ${documentLink ? `
        <table width="100%" cellpadding="0" cellspacing="0" style="margin: 15px 0;">
            <tr>
                <td align="center">
                    <a href="${documentLink}" style="display: inline-block; background-color: #4285F4; color: #ffffff; padding: 12px 30px; text-decoration: none; font-weight: bold; font-size: 14px; border-radius: 4px;">
                        OPEN CLASS DOCUMENT
                    </a>
                </td>
            </tr>
        </table>
        ` : ''}

        <p style="color: #333333; font-size: 16px; line-height: 1.6; margin-top: 30px;">
            See you tomorrow,<br>
            <strong>Español Honesto</strong>
        </p>
    `;

    return baseTemplate(content);
}

// ============================================
// Class Cancelled Email
// ============================================

export interface ClassCancelledData {
    recipientName: string;
    date: string;
    time: string;
    cancelledBy: 'student' | 'teacher' | 'admin';
    reason?: string;
}

export function classCancelledTemplate(data: ClassCancelledData): string {
    const cancellerText = {
        student: 'the student',
        teacher: 'the teacher',
        admin: 'the admin team',
    }[data.cancelledBy];
    const recipientName = escapeEmailHtml(data.recipientName);
    const date = escapeEmailHtml(data.date);
    const time = escapeEmailHtml(data.time);
    const reason = data.reason ? escapeEmailHtml(data.reason) : '';

    const content = `
        <h2 style="color: #006064; margin: 0 0 20px 0;">Class cancelled</h2>

        <p style="color: #333333; font-size: 16px; line-height: 1.6;">
            Hi ${recipientName},
        </p>

        <p style="color: #333333; font-size: 16px; line-height: 1.6;">
            The scheduled class has been cancelled by ${cancellerText}.
        </p>

        <div style="background-color: #fff3cd; padding: 25px; margin: 25px 0; border-left: 4px solid #856404;">
            <p style="margin: 0 0 10px 0; color: #856404; font-weight: bold;">Cancelled class details:</p>
            <p style="margin: 0; color: #333333;">
                Date: ${date}<br>
                Time: ${time}
            </p>
            ${reason ? `
            <p style="margin: 15px 0 0 0; color: #666666; font-size: 14px;">
                <em>Reason: ${reason}</em>
            </p>
            ` : ''}
        </div>

        <p style="color: #333333; font-size: 16px; line-height: 1.6;">
            The session is available to reschedule. If you have any questions, reply to this email.
        </p>

        <p style="color: #333333; font-size: 16px; line-height: 1.6; margin-top: 30px;">
            Best,<br>
            <strong>Español Honesto</strong>
        </p>
    `;

    return baseTemplate(content);
}

// ============================================
// Lead Welcome Email
// ============================================

export interface LeadWelcomeEmailData {
    recipientName?: string;
}

export function leadWelcomeTemplate(data: LeadWelcomeEmailData): string {
    const name = data.recipientName ? escapeEmailHtml(data.recipientName) : 'there';
    const content = `
        <h2 style="color: #006064; margin: 0 0 20px 0;">Application received, ${name}</h2>

        <p style="color: #333333; font-size: 16px; line-height: 1.6;">
            Thanks for applying for a place at <strong>Español Honesto</strong>. We have received your information
            and will review your level, goals and availability before suggesting a next step.
        </p>

        <div style="background-color: #E0F7FA; padding: 25px; margin: 25px 0; border-left: 4px solid #006064;">
            <p style="margin: 0 0 10px 0; font-size: 18px; color: #006064; font-weight: bold;">
                What happens now?
            </p>
            <ol style="margin: 0; padding-left: 20px; color: #333333; font-size: 14px; line-height: 1.6;">
                <li style="margin-bottom: 8px;">We read your application to understand your link with Spain, your approximate level and what you need.</li>
                <li style="margin-bottom: 8px;">If it looks like a fit, we will reply with the next step: a few level questions, a short diagnostic or a plan proposal.</li>
                <li style="margin-bottom: 0;">You do not need to buy anything yet. First we confirm fit, availability and expectations.</li>
            </ol>
        </div>

        <p style="color: #333333; font-size: 16px; line-height: 1.6;">
            Español Honesto is for adults and professionals who already have a base and want more serious conversation:
            culture, work, everyday life and real contact with Spain.
        </p>

        <p style="color: #333333; font-size: 16px; line-height: 1.6; margin-top: 30px;">
            Speak soon,<br>
            <strong>The Español Honesto team</strong>
        </p>
    `;

    return baseTemplate(content);
}

// ============================================
// Sales Follow-Up Emails
// ============================================

export interface MissingInfoEmailData {
    recipientName?: string;
    diagnosticUrl?: string;
}

export function missingInfoEmailTemplate(data: MissingInfoEmailData): string {
    const name = data.recipientName ? escapeEmailHtml(data.recipientName) : 'there';
    const diagnosticUrl = safeEmailUrl(data.diagnosticUrl);
    const content = `
        <h2 style="color: #006064; margin: 0 0 20px 0;">One more detail, ${name}</h2>

        <p style="color: #333333; font-size: 16px; line-height: 1.6;">
            Thanks again for your application. Before suggesting a plan, we need a little more context
            so that we do not push you into the wrong format.
        </p>

        <div style="background-color: #E0F7FA; padding: 25px; margin: 25px 0; border-left: 4px solid #006064;">
            <p style="margin: 0 0 10px 0; font-size: 18px; color: #006064; font-weight: bold;">
                Could you reply with:
            </p>
            <ol style="margin: 0; padding-left: 20px; color: #333333; font-size: 14px; line-height: 1.6;">
                <li style="margin-bottom: 8px;">where you use Spanish now, or where you want to use it;</li>
                <li style="margin-bottom: 8px;">what usually blocks you when you speak;</li>
                <li style="margin-bottom: 0;">your realistic availability for live classes.</li>
            </ol>
        </div>

        ${diagnosticUrl ? `
        <p style="color: #333333; font-size: 16px; line-height: 1.6;">
            If it is easier, you can also answer through this short diagnostic:
        </p>

        <table width="100%" cellpadding="0" cellspacing="0" style="margin: 25px 0;">
            <tr>
                <td align="center">
                    <a href="${diagnosticUrl}" style="display: inline-block; background-color: #006064; color: #ffffff; padding: 15px 40px; text-decoration: none; font-weight: bold; font-size: 16px;">
                        OPEN DIAGNOSTIC
                    </a>
                </td>
            </tr>
        </table>
        ` : ''}

        <p style="color: #333333; font-size: 16px; line-height: 1.6;">
            A direct reply to this email is perfectly fine.
        </p>

        <p style="color: #333333; font-size: 16px; line-height: 1.6; margin-top: 30px;">
            Speak soon,<br>
            <strong>The Español Honesto team</strong>
        </p>
    `;

    return baseTemplate(content);
}

export interface ProposalNextStepEmailData {
    recipientName?: string;
    planRecommendation?: string | null;
}

export function proposalNextStepEmailTemplate(data: ProposalNextStepEmailData): string {
    const name = data.recipientName ? escapeEmailHtml(data.recipientName) : 'there';
    const planRecommendation = data.planRecommendation ? escapeEmailHtml(data.planRecommendation) : '';
    const content = `
        <h2 style="color: #006064; margin: 0 0 20px 0;">Suggested next step, ${name}</h2>

        <p style="color: #333333; font-size: 16px; line-height: 1.6;">
            We have reviewed your application and it looks like there may be a good fit.
            The useful next step is to confirm the format and availability before any payment.
        </p>

        ${planRecommendation ? `
        <div style="background-color: #E0F7FA; padding: 25px; margin: 25px 0; border-left: 4px solid #006064;">
            <p style="margin: 0 0 10px 0; font-size: 18px; color: #006064; font-weight: bold;">
                Initial recommendation
            </p>
            <p style="margin: 0; color: #333333; font-size: 15px; line-height: 1.6;">
                ${planRecommendation}
            </p>
        </div>
        ` : ''}

        <p style="color: #333333; font-size: 16px; line-height: 1.6;">
            Please reply with any schedule limits, questions or concerns. Then we can confirm the plan,
            coordinate the first class manually and only send payment instructions when everything is clear.
        </p>

        <p style="color: #333333; font-size: 16px; line-height: 1.6;">
            No pressure and no automatic checkout yet: we prefer to make the decision cleanly.
        </p>

        <p style="color: #333333; font-size: 16px; line-height: 1.6; margin-top: 30px;">
            Speak soon,<br>
            <strong>The Español Honesto team</strong>
        </p>
    `;

    return baseTemplate(content);
}

// ============================================
// Support Ticket Received Email
// ============================================

export interface SupportTicketReceivedEmailData {
    recipientName?: string;
    issueTitle: string;
    ticketId: string;
    supportUrl?: string;
}

export interface SupportTicketUpdatedEmailData {
    recipientName?: string;
    issueTitle: string;
    ticketId: string;
    status: string;
    adminNote?: string | null;
    supportUrl?: string;
}

function escapeEmailHtml(value: string): string {
    return value
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}

function safeEmailUrl(value: string | undefined): string | null {
    if (!value) return null;

    try {
        const url = new URL(value);
        if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
        return escapeEmailHtml(url.toString());
    } catch {
        return null;
    }
}

function supportStatusLabel(status: string): string {
    const labels: Record<string, string> = {
        open: 'Open',
        triaged: 'In review',
        closed: 'Closed',
    };
    return labels[status] || status;
}

export function supportTicketReceivedTemplate(data: SupportTicketReceivedEmailData): string {
    const name = data.recipientName ? escapeEmailHtml(data.recipientName) : 'there';
    const issueTitle = escapeEmailHtml(data.issueTitle);
    const ticketId = escapeEmailHtml(data.ticketId);
    const supportUrl = safeEmailUrl(data.supportUrl);
    const content = `
        <h2 style="color: #006064; margin: 0 0 20px 0;">We received your support request, ${name}</h2>

        <p style="color: #333333; font-size: 16px; line-height: 1.6;">
            Thanks for letting us know. We have created a support ticket and will review it manually.
        </p>

        <div style="background-color: #E0F7FA; padding: 25px; margin: 25px 0; border-left: 4px solid #006064;">
            <p style="margin: 0 0 10px 0; font-size: 18px; color: #006064; font-weight: bold;">
                Ticket details
            </p>
            <p style="margin: 0; color: #333333; font-size: 15px; line-height: 1.6;">
                Issue: ${issueTitle}<br>
                Ticket: ${ticketId}
            </p>
        </div>

        <p style="color: #333333; font-size: 16px; line-height: 1.6;">
            If the issue affects an upcoming class, we will prioritize it. You can also reply to this email
            with any extra detail that may help.
        </p>

        ${supportUrl ? `
        <table width="100%" cellpadding="0" cellspacing="0" style="margin: 25px 0;">
            <tr>
                <td align="center">
                    <a href="${supportUrl}" style="display: inline-block; background-color: #006064; color: #ffffff; padding: 15px 40px; text-decoration: none; font-weight: bold; font-size: 16px;">
                        OPEN SUPPORT
                    </a>
                </td>
            </tr>
        </table>
        ` : ''}

        <p style="color: #333333; font-size: 16px; line-height: 1.6; margin-top: 30px;">
            Speak soon,<br>
            <strong>The Espanol Honesto team</strong>
        </p>
    `;

    return baseTemplate(content);
}

export function supportTicketUpdatedTemplate(data: SupportTicketUpdatedEmailData): string {
    const name = data.recipientName ? escapeEmailHtml(data.recipientName) : 'there';
    const statusLabel = escapeEmailHtml(supportStatusLabel(data.status));
    const note = data.adminNote?.trim();
    const safeNote = note ? escapeEmailHtml(note).replace(/\r?\n/g, '<br>') : '';
    const supportUrl = safeEmailUrl(data.supportUrl);
    const closingText = data.status === 'closed'
        ? 'If anything still feels unresolved, reply to this email and we will reopen the conversation.'
        : 'You can reply to this email with any extra detail that may help us resolve it cleanly.';

    const content = `
        <h2 style="color: #006064; margin: 0 0 20px 0;">Update on your support request, ${name}</h2>

        <p style="color: #333333; font-size: 16px; line-height: 1.6;">
            We reviewed your support ticket and updated its status.
        </p>

        <div style="background-color: #E0F7FA; padding: 25px; margin: 25px 0; border-left: 4px solid #006064;">
            <p style="margin: 0 0 10px 0; font-size: 18px; color: #006064; font-weight: bold;">
                Ticket update
            </p>
            <p style="margin: 0; color: #333333; font-size: 15px; line-height: 1.6;">
                Issue: ${escapeEmailHtml(data.issueTitle)}<br>
                Status: ${statusLabel}<br>
                Ticket: ${escapeEmailHtml(data.ticketId)}
            </p>
        </div>

        ${safeNote ? `
        <div style="background-color: #f9f9f9; padding: 20px; margin: 25px 0; border-left: 4px solid #999999;">
            <p style="margin: 0 0 10px 0; color: #333333; font-weight: bold;">Note from us</p>
            <p style="margin: 0; color: #333333; font-size: 15px; line-height: 1.6;">${safeNote}</p>
        </div>
        ` : ''}

        <p style="color: #333333; font-size: 16px; line-height: 1.6;">
            ${closingText}
        </p>

        ${supportUrl ? `
        <table width="100%" cellpadding="0" cellspacing="0" style="margin: 25px 0;">
            <tr>
                <td align="center">
                    <a href="${supportUrl}" style="display: inline-block; background-color: #006064; color: #ffffff; padding: 15px 40px; text-decoration: none; font-weight: bold; font-size: 16px;">
                        OPEN SUPPORT
                    </a>
                </td>
            </tr>
        </table>
        ` : ''}

        <p style="color: #333333; font-size: 16px; line-height: 1.6; margin-top: 30px;">
            Speak soon,<br>
            <strong>The Espanol Honesto team</strong>
        </p>
    `;

    return baseTemplate(content);
}

// ============================================
// Lightweight Level Check Email
// ============================================

export interface LevelCheckInviteEmailData {
    recipientName?: string;
    diagnosticUrl: string;
}

export function levelCheckInviteTemplate(data: LevelCheckInviteEmailData): string {
    const name = data.recipientName ? escapeEmailHtml(data.recipientName) : 'there';
    const diagnosticUrl = safeEmailUrl(data.diagnosticUrl);
    const content = `
        <h2 style="color: #006064; margin: 0 0 20px 0;">A few level questions, ${name}</h2>

        <p style="color: #333333; font-size: 16px; line-height: 1.6;">
            Before suggesting a plan, we would like to understand how you actually use Spanish.
            This is a short diagnostic, not an official exam.
        </p>

        <div style="background-color: #E0F7FA; padding: 25px; margin: 25px 0; border-left: 4px solid #006064;">
            <p style="margin: 0 0 10px 0; font-size: 18px; color: #006064; font-weight: bold;">
                What we ask for
            </p>
            <ol style="margin: 0; padding-left: 20px; color: #333333; font-size: 14px; line-height: 1.6;">
                <li style="margin-bottom: 8px;">A few closed questions about your level and main blocker.</li>
                <li style="margin-bottom: 8px;">A short written sample in Spanish.</li>
                <li style="margin-bottom: 0;">Optional audio only later, if you want and if it is useful.</li>
            </ol>
        </div>

        ${diagnosticUrl ? `
        <table width="100%" cellpadding="0" cellspacing="0" style="margin: 30px 0;">
            <tr>
                <td align="center">
                    <a href="${diagnosticUrl}" style="display: inline-block; background-color: #006064; color: #ffffff; padding: 15px 40px; text-decoration: none; font-weight: bold; font-size: 16px;">
                        OPEN DIAGNOSTIC
                    </a>
                </td>
            </tr>
        </table>
        ` : ''}

        <p style="color: #333333; font-size: 16px; line-height: 1.6;">
            We review it manually and use it only to decide the next honest step: proposal, waitlist, or a better format.
        </p>

        <p style="color: #333333; font-size: 16px; line-height: 1.6; margin-top: 30px;">
            Speak soon,<br>
            <strong>The Español Honesto team</strong>
        </p>
    `;

    return baseTemplate(content);
}
