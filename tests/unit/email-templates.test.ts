import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildEmailPreview, emailPreviewTypes } from '../../src/lib/email/previews';
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
} from '../../src/lib/email/templates';

const mojibakePattern = /(?:Ã|Â|Ð|ðŸ|â€|â|â|�)/;
const emailTemplateManagerSource = readFileSync('src/components/admin/EmailTemplateManager.tsx', 'utf8');

describe('lead application email', () => {
    it.each([
        ['es', 'Tu suscripción se renovará próximamente', 'Fecha prevista de cobro', '3 meses', 'Plazo de cancelación', 'Si no cancelas a tiempo'],
        ['en', 'Your subscription will renew soon', 'Expected charge date', '3 months', 'Cancellation deadline', 'If you do not cancel in time'],
        ['ru', 'Ваша подписка скоро продлится', 'Предполагаемая дата списания', '3 месяца', 'Срок отмены', 'Если вы не отмените продление вовремя'],
    ] as const)('renders the complete upcoming-renewal notice in %s', (locale, title, date, period, deadline, consequence) => {
        const html = renewalNoticeEmailTemplate({
            locale,
            studentName: 'Alina <script>alert(1)</script>',
            packageName: 'Hybrid <img src=x>',
            renewalAt: '2026-10-10T12:00:00.000Z',
            cancelBy: '2026-10-10T12:00:00.000Z',
            durationMonths: 3,
            amountTotal: 27000,
            currency: 'eur',
            accountUrl: 'https://example.com/account',
            supportUrl: 'https://example.com/support',
            termsUrl: 'https://example.com/terms',
        });

        expect(html).toContain(title);
        expect(html).toContain(date);
        expect(html).toContain('270');
        expect(html).toContain(period);
        expect(html).toContain(deadline);
        expect(html).toContain(consequence);
        expect(html).toContain('Alina &lt;script&gt;alert(1)&lt;/script&gt;');
        expect(html).toContain('Hybrid &lt;img src=x&gt;');
        expect(html).not.toContain('<script');
        expect(html).not.toContain('<img');
        expect(html).not.toMatch(mojibakePattern);
    });

    it('exposes the English renewal notice in the admin preview tool', () => {
        const preview = buildEmailPreview('renewal');

        expect(preview.subject).toBe('Your subscription renewal notice - Español Honesto');
        expect(preview.html).toContain('Your subscription will renew soon');
        expect(preview.html).toContain('Standard monthly');
        expect(preview.html).not.toContain('£');
        expect(preview.html).toContain('€');
        expect(preview.html).toContain('/en/campus/account');
        expect(preview.html).toContain('/en/legal/terminos');
        expect(preview.html).not.toMatch(mojibakePattern);
    });

    it('confirms the application and explains fit review before purchase', () => {
        const html = leadWelcomeTemplate({ recipientName: 'Alina' });

        expect(html).toContain('Application received, Alina');
        expect(html).toContain('Español Honesto');
        expect(html).toContain('review your level, goals and availability');
        expect(html).toContain('a short diagnostic or a plan proposal');
        expect(html).toContain('You do not need to buy anything yet');
        expect(html).toContain('adults and professionals');
        expect(html).not.toContain('EXPLORAR EL BLOG');
        expect(html).not.toMatch(mojibakePattern);
    });

    it('keeps the lead preview aligned with application review', () => {
        const preview = buildEmailPreview('lead');

        expect(preview.subject).toBe('Application received - Español Honesto');
        expect(preview.html).toContain('Application received, Test User');
        expect(preview.html).toContain('First we confirm fit, availability and expectations');
        expect(preview.html).not.toMatch(mojibakePattern);
    });

    it('invites selected leads to the lightweight diagnostic without implying an official exam', () => {
        const html = levelCheckInviteTemplate({
            recipientName: 'Alina',
            diagnosticUrl: 'https://example.com/en/diagnostico?email=alina%40example.com',
        });
        const preview = buildEmailPreview('level-check');

        expect(preview.subject).toBe('A few level questions - Espanol Honesto');
        expect(html).toContain('A few level questions, Alina');
        expect(html).toContain('short diagnostic, not an official exam');
        expect(html).toContain('A short written sample in Spanish');
        expect(html).toContain('Optional audio only later');
        expect(html).toContain('OPEN DIAGNOSTIC');
        expect(html).not.toMatch(mojibakePattern);
    });

    it('keeps paid student welcome emails encoding-safe', () => {
        const preview = buildEmailPreview('welcome');
        const html = welcomeEmailTemplate({
            locale: 'en',
            studentName: 'Alina',
            packageName: 'Hybrid Plan',
            loginUrl: 'https://example.com/es/campus',
            driveFolderUrl: 'https://drive.google.com/example',
            durationMonths: 3,
            startsAt: '2026-07-10',
            endsAt: '2026-10-10',
            sessionsTotal: 12,
            amountTotal: 64800,
            currency: 'eur',
            legalPolicyVersion: '2026-07-10',
            policyAcceptedAt: '2026-07-10T10:00:00.000Z',
            termsUrl: 'https://example.com/es/legal/terminos',
            supportUrl: 'https://example.com/es/campus/support',
        });

        expect(preview.subject).toBe('Your subscription confirmation - Español Honesto');
        expect(preview.html).toContain('Contract confirmation');
        expect(preview.html).toContain('Subscription period: 3 month(s)');
        expect(preview.html).toContain('Classes available in this period: 12');
        expect(preview.html).toContain('Terms version: 2026-07-10');
        expect(preview.html).toContain('/en/legal/terminos');
        expect(html).toContain('Welcome, Alina');
        expect(html).toContain('Your plan is active: <strong>Hybrid Plan</strong>.');
        expect(html).toContain('check that you can access your dashboard and materials');
        expect(html).toContain('Reply with any schedule limits before your first class');
        expect(html).toContain('coordinate your first class manually');
        expect(html).toContain('Your materials folder');
        expect(html).toContain('Contract confirmation');
        expect(html).toContain('Subscription period: 3 month(s), from 2026-07-10 to 2026-10-10');
        expect(html).toContain('Classes available in this period: 12');
        expect(html).toContain('Automatic renewal');
        expect(html).toContain('Terms version: 2026-07-10');
        expect(html).toContain('Terms preserved in this email');
        expect(html).toContain('Model withdrawal notice');
        expect(html).toContain('14 calendar days');
        expect(html).toContain('lost only after full performance');
        expect(html).toContain('/es/legal/terminos');
        expect(html).not.toMatch(mojibakePattern);
    });

    it.each(['es', 'en', 'ru'] as const)('previews localized welcome and renewal emails in %s', (locale) => {
        const welcome = buildEmailPreview('welcome', locale);
        const renewal = buildEmailPreview('renewal', locale);

        expect(welcome.subject).toBe(welcomeEmailSubject(locale));
        expect(renewal.subject).toBe(renewalNoticeSubject(locale));
        expect(welcome.html).toContain(`/${locale}/login`);
        expect(welcome.html).toContain(`/${locale}/legal/terminos`);
        expect(welcome.html).toContain('2026-07-10');
        expect(renewal.html).toContain(`/${locale}/campus/account`);
        expect(renewal.html).toContain(`/${locale}/legal/terminos`);
        expect(welcome.html).toContain({
            es: 'Híbrido mensual',
            en: 'Hybrid monthly',
            ru: 'Гибридный месяц',
        }[locale]);
        expect(renewal.html).toContain({
            es: 'Mensual estándar',
            en: 'Standard monthly',
            ru: 'Стандартный месяц',
        }[locale]);
        expect(renewal.html).toContain({
            es: '¿Tienes dudas? Responde a este correo.',
            en: 'Questions? Reply to this email.',
            ru: 'Есть вопросы? Ответьте на это письмо.',
        }[locale]);
        expect(welcome.html).not.toMatch(mojibakePattern);
        expect(renewal.html).not.toMatch(mojibakePattern);
    });

    it.each([
        ['es', 'Confirmación contractual', 'Modelo de desistimiento', '14 días naturales', 'Plan Híbrido'],
        ['en', 'Contract confirmation', 'Model withdrawal notice', '14 calendar days', 'Hybrid Plan'],
        ['ru', 'Подтверждение договора', 'Образец заявления об отказе', '14 календарных дней', 'Гибридный план'],
    ] as const)('preserves the accepted contract and withdrawal model in %s', (locale, summary, model, withdrawal, packageName) => {
        const html = welcomeEmailTemplate({
            locale,
            studentName: 'Alina',
            packageName,
            loginUrl: `https://example.com/${locale}/campus`,
            durationMonths: 3,
            startsAt: '2026-07-10',
            endsAt: '2026-10-10',
            sessionsTotal: 12,
            amountTotal: 64800,
            currency: 'eur',
            legalPolicyVersion: '2026-07-10',
            policyAcceptedAt: '2026-07-10T10:00:00.000Z',
            termsUrl: `https://example.com/${locale}/legal/terminos`,
            supportUrl: `https://example.com/${locale}/campus/support`,
        });

        expect(html).toContain(summary);
        expect(html).toContain(model);
        expect(html).toContain(withdrawal);
        expect(html).toContain(`<strong>${packageName}</strong>`);
        expect(html).toContain('2026-07-10T10:00:00.000Z');
        expect(html).not.toMatch(mojibakePattern);
    });

    it('keeps class confirmation clear that Meet is not cut automatically', () => {
        const html = classConfirmationTemplate({
            recipientName: 'Alina',
            isTeacher: false,
            otherPartyName: 'Alejandro',
            date: 'Monday, 20 July 2026',
            time: '10:00',
            duration: 50,
            meetLink: 'https://meet.google.com/abc-defg-hij',
            documentLink: 'https://docs.google.com/document/d/example',
        });

        expect(html).toContain('Duration:');
        expect(html).toContain('50 minutes');
        expect(html).toContain('the video call is not cut automatically at the minute mark');
        expect(html).not.toMatch(mojibakePattern);
    });

    it('escapes dynamic fields across transactional student emails', () => {
        const welcomeHtml = welcomeEmailTemplate({
            locale: 'en',
            studentName: 'Alina <script>alert(1)</script>',
            packageName: 'Hybrid <img src=x>',
            loginUrl: 'javascript:alert(1)',
            driveFolderUrl: 'https://drive.google.com/folder?name=<script>',
        });
        const confirmationHtml = classConfirmationTemplate({
            recipientName: 'Student <script>',
            isTeacher: false,
            otherPartyName: 'Teacher <img src=x>',
            date: 'Monday <b>',
            time: '10:00 <svg>',
            duration: 50,
            meetLink: 'javascript:alert(1)',
            documentLink: 'https://docs.google.com/document?title=<script>',
        });
        const reminderHtml = classReminderTemplate({
            recipientName: 'Teacher <script>',
            date: 'Tuesday <b>',
            time: '11:00 <svg>',
            studentName: 'Student <img src=x>',
            meetLink: 'javascript:alert(1)',
            documentLink: 'https://docs.google.com/document?title=<script>',
        });
        const cancelledHtml = classCancelledTemplate({
            recipientName: 'Alina <script>',
            date: 'Wednesday <b>',
            time: '12:00 <svg>',
            cancelledBy: 'student',
            reason: '<img src=x onerror=alert(1)>',
        });
        const leadHtml = leadWelcomeTemplate({ recipientName: 'Lead <script>' });
        const missingInfoHtml = missingInfoEmailTemplate({
            recipientName: 'Lead <script>',
            diagnosticUrl: 'javascript:alert(1)',
        });
        const proposalHtml = proposalNextStepEmailTemplate({
            recipientName: 'Lead <script>',
            planRecommendation: '<b>Conversation plan</b>',
        });
        const levelCheckHtml = levelCheckInviteTemplate({
            recipientName: 'Lead <script>',
            diagnosticUrl: 'javascript:alert(1)',
        });
        const combinedHtml = [
            welcomeHtml,
            confirmationHtml,
            reminderHtml,
            cancelledHtml,
            leadHtml,
            missingInfoHtml,
            proposalHtml,
            levelCheckHtml,
        ].join('\n');

        expect(combinedHtml).toContain('Alina &lt;script&gt;alert(1)&lt;/script&gt;');
        expect(combinedHtml).toContain('Hybrid &lt;img src=x&gt;');
        expect(combinedHtml).toContain('Teacher &lt;img src=x&gt;');
        expect(combinedHtml).toContain('&lt;img src=x onerror=alert(1)&gt;');
        expect(combinedHtml).toContain('&lt;b&gt;Conversation plan&lt;/b&gt;');
        expect(combinedHtml).not.toContain('<script');
        expect(combinedHtml).not.toContain('<img');
        expect(combinedHtml).not.toContain('<svg');
        expect(combinedHtml).not.toContain('<b>Conversation plan</b>');
        expect(combinedHtml).not.toContain('javascript:alert');
    });

    it('keeps sales follow-up emails manual, sober and pre-payment', () => {
        const missingInfoHtml = missingInfoEmailTemplate({
            recipientName: 'Alina',
            diagnosticUrl: 'https://example.com/en/diagnostico',
        });
        const proposalHtml = proposalNextStepEmailTemplate({
            recipientName: 'Alina',
            planRecommendation: 'Hybrid plan with focused conversation practice.',
        });
        const missingInfoPreview = buildEmailPreview('missing-info');
        const proposalPreview = buildEmailPreview('proposal-next-step');

        expect(missingInfoPreview.subject).toBe('A little more context - Espanol Honesto');
        expect(proposalPreview.subject).toBe('Suggested next step - Espanol Honesto');
        expect(missingInfoHtml).toContain('we need a little more context');
        expect(missingInfoHtml).toContain('A direct reply to this email is perfectly fine');
        expect(proposalHtml).toContain('before any payment');
        expect(proposalHtml).toContain('No pressure and no automatic checkout yet');
        expect(missingInfoHtml).not.toMatch(mojibakePattern);
        expect(proposalHtml).not.toMatch(mojibakePattern);
    });

    it('acknowledges support tickets without turning them into marketing', () => {
        const html = supportTicketReceivedTemplate({
            recipientName: 'Alina',
            issueTitle: 'Missing Meet link',
            ticketId: 'ticket-1',
            supportUrl: 'https://example.com/en/campus/support',
        });
        const preview = buildEmailPreview('support-received');

        expect(preview.subject).toBe('Support request received - Espanol Honesto');
        expect(html).toContain('We received your support request, Alina');
        expect(html).toContain('We have created a support ticket');
        expect(html).toContain('Ticket: ticket-1');
        expect(html).toContain('If the issue affects an upcoming class');
        expect(html).not.toContain('checkout');
        expect(html).not.toMatch(mojibakePattern);
    });

    it('escapes user-controlled support ticket fields before rendering email HTML', () => {
        const receivedHtml = supportTicketReceivedTemplate({
            recipientName: 'Alina <admin>',
            issueTitle: '<img src=x onerror=alert(1)>',
            ticketId: 'ticket-<script>alert(1)</script>',
            supportUrl: 'javascript:alert(1)',
        });
        const updatedHtml = supportTicketUpdatedTemplate({
            recipientName: 'Alina <admin>',
            issueTitle: '<img src=x onerror=alert(1)>',
            ticketId: 'ticket-<script>alert(1)</script>',
            status: 'closed',
            adminNote: '<b>Restored</b>\nPlease try again.',
            supportUrl: 'https://example.com/en/campus/support?next=" onclick="alert(1)',
        });

        expect(receivedHtml).toContain('Alina &lt;admin&gt;');
        expect(receivedHtml).toContain('&lt;img src=x onerror=alert(1)&gt;');
        expect(receivedHtml).toContain('ticket-&lt;script&gt;alert(1)&lt;/script&gt;');
        expect(receivedHtml).not.toContain('<img');
        expect(receivedHtml).not.toContain('<script');
        expect(receivedHtml).not.toContain('javascript:alert');
        expect(receivedHtml).not.toContain('OPEN SUPPORT');

        expect(updatedHtml).toContain('Alina &lt;admin&gt;');
        expect(updatedHtml).toContain('&lt;img src=x onerror=alert(1)&gt;');
        expect(updatedHtml).toContain('ticket-&lt;script&gt;alert(1)&lt;/script&gt;');
        expect(updatedHtml).toContain('&lt;b&gt;Restored&lt;/b&gt;<br>Please try again.');
        expect(updatedHtml).not.toContain('<img');
        expect(updatedHtml).not.toContain('<script');
        expect(updatedHtml).not.toContain('<b>Restored</b>');
        expect(updatedHtml).not.toContain('onclick="alert');
    });

    it('keeps support update emails transactional and human-readable', () => {
        const html = supportTicketUpdatedTemplate({
            recipientName: 'Alina',
            issueTitle: 'Missing Meet link',
            ticketId: 'ticket-1',
            status: 'closed',
            adminNote: 'We restored the Meet link in your campus.',
            supportUrl: 'https://example.com/en/campus/support',
        });
        const preview = buildEmailPreview('support-updated');

        expect(preview.subject).toBe('Support request updated - Espanol Honesto');
        expect(html).toContain('Update on your support request, Alina');
        expect(html).toContain('Status: Closed');
        expect(html).toContain('Note from us');
        expect(html).toContain('We restored the Meet link');
        expect(html).toContain('OPEN SUPPORT');
        expect(html).not.toContain('checkout');
        expect(html).not.toMatch(mojibakePattern);
    });

    it('exposes every backend preview type in the admin email test tool', () => {
        for (const type of emailPreviewTypes) {
            expect(emailTemplateManagerSource).toContain(`value: '${type}'`);
        }
        expect(emailTemplateManagerSource).toContain('Soporte actualizado');
        expect(emailTemplateManagerSource).toContain(
            "import type { EmailPreviewLocale, EmailPreviewType }",
        );
    });
});
