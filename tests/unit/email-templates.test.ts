import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildEmailPreview, emailPreviewTypes } from '../../src/lib/email/previews';
import {
    classCancelledTemplate,
    classConfirmationTemplate,
    classReminderTemplate,
    checkoutV2CycleRescheduledSubject,
    checkoutV2CycleRescheduledTemplate,
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

    it.each([
        ['es', '28 d\u00edas'],
        ['en', '28 days'],
        ['ru', '28 \u0434\u043d\u0435\u0439'],
    ] as const)('renders the versioned 28-day renewal period in %s without a legacy month count', (locale, period) => {
        const html = renewalNoticeEmailTemplate({
            locale,
            studentName: 'Alina',
            packageName: 'Individual',
            renewalAt: '2026-10-10T12:00:00.000Z',
            cancelBy: '2026-10-10T12:00:00.000Z',
            billingIntervalUnit: 'day',
            billingIntervalCount: 28,
            amountTotal: 25900,
            currency: 'eur',
            accountUrl: 'https://example.com/account',
            supportUrl: 'https://example.com/support',
            termsUrl: 'https://example.com/terms',
        });

        expect(html).toContain(period);
        expect(html).not.toContain('3 months');
        expect(html).not.toMatch(mojibakePattern);
    });

    it('exposes the English renewal notice in the admin preview tool', () => {
        const preview = buildEmailPreview('renewal');

        expect(preview.subject).toBe('Your subscription renewal notice - Español Honesto');
        expect(preview.html).toContain('Your subscription will renew soon');
        expect(preview.html).toContain('4 individual 50-minute classes');
        expect(preview.html).toContain('28 days');
        expect(preview.html).toContain('259');
        expect(preview.html).not.toContain('£');
        expect(preview.html).toContain('€');
        expect(preview.html).toContain('/en/campus/account');
        expect(preview.html).toContain('/en/legal/terminos');
        expect(preview.html).not.toMatch(mojibakePattern);
    });

    it('confirms interest without turning context into an application gate', () => {
        const html = leadWelcomeTemplate({ recipientName: 'Alina' });

        expect(html).toContain('Your details are saved, Alina');
        expect(html).toContain('Español Honesto');
        expect(html).toContain('Four individual 50-minute classes cost EUR 259');
        expect(html).toContain('When direct booking is enabled');
        expect(html).toContain('When checkout is enabled');
        expect(html).toContain('will not require approval before purchase');
        expect(html).toContain('will never become a booking gate');
        expect(html).not.toContain('You can book directly');
        expect(html).not.toMatch(/confirm fit|plan proposal|wait for approval/i);
        expect(html).not.toContain('EXPLORAR EL BLOG');
        expect(html).not.toMatch(mojibakePattern);
    });

    it('keeps the lead preview aligned with direct booking', () => {
        const preview = buildEmailPreview('lead');

        expect(preview.subject).toBe('Direct booking details - Espanol Honesto');
        expect(preview.html).toContain('Your details are saved, Test User');
        expect(preview.html).toContain('will not require approval before purchase');
        expect(preview.html).toContain('When direct booking is enabled');
        expect(preview.html).not.toMatch(mojibakePattern);
    });

    it('offers the lightweight diagnostic as optional context without blocking purchase', () => {
        const html = levelCheckInviteTemplate({
            recipientName: 'Alina',
            diagnosticUrl: 'https://example.com/en/diagnostico?email=alina%40example.com',
        });
        const preview = buildEmailPreview('level-check');

        expect(preview.subject).toBe('Optional Spanish context - Espanol Honesto');
        expect(html).toContain('Optional Spanish context, Alina');
        expect(html).toContain('not an official exam, eligibility check or condition for booking');
        expect(html).toContain('A short written sample in Spanish');
        expect(html).toContain('Optional audio only later');
        expect(html).toContain('OPEN DIAGNOSTIC');
        expect(html).toContain('will not create a review or recommendation gate');
        expect(html).toContain('When direct booking is enabled');
        expect(html).not.toMatch(mojibakePattern);
    });

    it('keeps legacy paid-student welcome emails compatible while the preview shows Checkout V2', () => {
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
        expect(preview.html).toContain('EUR 259 charged when you reserved the place');
        expect(preview.html).toContain('4 individual 50-minute classes');
        expect(preview.html).toContain('Teacher: Alejandro García');
        expect(preview.html).toContain('Europe/Madrid');
        expect(preview.html).toContain('exactly 28 days after the first class');
        expect(preview.html).toContain('EUR 194.25 refund');
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

    it.each([
        ['es', '259 EUR cobrados al reservar', 'Profesor: Alejandro García', 'Siguiente cobro', '194,25 EUR', 'al menos 24 horas', 'no-show', 'salvo que soporte reclasifique una incidencia justificada'],
        ['en', 'EUR 259 charged when you reserved', 'Teacher: Alejandro García', 'Next charge', 'EUR 194.25', 'at least 24 hours', 'no-show', 'unless support reclassifies a justified incident'],
        ['ru', '259 EUR списаны при бронировании', 'Преподаватель: Alejandro García', 'Следующее списание', '194,25 EUR', 'не менее чем за 24 часа', 'неявка', 'если только служба поддержки не переклассифицирует подтверждённый уважительный случай'],
    ] as const)(
        'renders the complete immutable Checkout V2 welcome contract in %s',
        (locale, paid, teacher, renewal, refund, timely, late, justifiedIncident) => {
            const html = welcomeEmailTemplate({
                locale,
                studentName: 'Alina',
                packageName: 'Hybrid monthly legacy label',
                loginUrl: `https://example.com/${locale}/login`,
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
                legalPolicyVersion: 'checkout-v2-2026-08-01',
                policyAcceptedAt: '2026-09-01T10:00:00.000Z',
                termsUrl: `https://example.com/${locale}/legal/terminos`,
                supportUrl: `https://example.com/${locale}/campus/support`,
            });

            expect(html).toContain(paid);
            expect(html).toContain(teacher);
            expect(html).toContain('Europe/Madrid');
            expect(html).toContain(renewal);
            expect(html).toContain(refund);
            expect(html).toContain(timely);
            expect(html).toContain(late);
            expect(html).toContain(justifiedIncident);
            expect(html).toContain('checkout-v2-2026-08-01');
            expect(html.match(/Europe\/Madrid/g)).toHaveLength(6);
            expect(html).not.toMatch(/Hybrid monthly|Híbrido|Гибрид|3 month|405|145|coordinate your first class manually|30, 40 or 50/iu);
            expect(html).not.toMatch(mojibakePattern);
        },
    );

    it('states the complete provisional-anchor movement boundary in every Checkout V2 locale', () => {
        const render = (locale: 'es' | 'en' | 'ru') => welcomeEmailTemplate({
            locale,
            studentName: 'Alina',
            packageName: 'Individual',
            loginUrl: `https://example.com/${locale}/login`,
            sessionsTotal: 4,
            amountTotal: 25_900,
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
        });

        const es = render('es');
        expect(es).toContain('autoservicio');
        expect(es).toContain('al menos 24 horas');
        expect(es).toContain('máximo inclusivo de 28 días');
        expect(es).toContain('soporte fuera de ese límite');
        expect(es).toContain('ancla queda fija');

        const en = render('en');
        expect(en).toContain('self-service');
        expect(en).toContain('at least 24 hours');
        expect(en).toContain('inclusive maximum of 28 days');
        expect(en).toContain('support outside that limit');
        expect(en).toContain('renewal anchor is fixed');

        const ru = render('ru');
        expect(ru).toContain('самостоятельный перенос');
        expect(ru).toContain('не менее чем за 24 часа');
        expect(ru).toContain('28 дней включительно');
        expect(ru).toContain('службу поддержки вне этого предела');
        expect(ru).toContain('дата продления фиксируется');
    });

    it('fails closed instead of sending an incomplete Checkout V2 contract', () => {
        expect(() => welcomeEmailTemplate({
            locale: 'en',
            studentName: 'Alina',
            packageName: 'Individual',
            loginUrl: 'https://example.com/en/login',
            sessionsTotal: 4,
            amountTotal: 25900,
            currency: 'eur',
            contractSchemaVersion: 2,
            classDurationMinutes: 50,
        })).toThrow('Checkout V2 welcome contract');
    });

    it('keeps the weekly local class time through Madrid DST while renewal remains exactly 672 hours after class one', () => {
        const html = welcomeEmailTemplate({
            locale: 'en',
            studentName: 'Alina',
            packageName: 'Individual',
            loginUrl: 'https://example.com/en/login',
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
                '2026-10-12T08:00:00.000Z',
                '2026-10-19T08:00:00.000Z',
                '2026-10-26T09:00:00.000Z',
                '2026-11-02T09:00:00.000Z',
            ],
            renewalAnchorAt: '2026-11-09T08:00:00.000Z',
        });

        expect(html.match(/10:00/g)).toHaveLength(5);
        expect(html).toContain('9 November 2026 at 09:00');
    });

    it('rejects V2 class dates that do not preserve the announced weekly local pattern', () => {
        expect(() => welcomeEmailTemplate({
            locale: 'en',
            studentName: 'Alina',
            packageName: 'Individual',
            loginUrl: 'https://example.com/en/login',
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
                '2026-09-15T08:00:00.000Z',
                '2026-09-21T08:00:00.000Z',
                '2026-09-28T08:00:00.000Z',
            ],
            renewalAnchorAt: '2026-10-05T08:00:00.000Z',
        })).toThrow('Checkout V2 welcome contract');
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
            es: '4 clases individuales de 50 minutos',
            en: '4 individual 50-minute classes',
            ru: '4 индивидуальных занятия по 50 минут',
        }[locale]);
        expect(renewal.html).toContain({
            es: '4 clases individuales de 50 minutos',
            en: '4 individual 50-minute classes',
            ru: '4 индивидуальных занятия по 50 минут',
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
        expect(combinedHtml).not.toContain('Conversation plan');
        expect(combinedHtml).not.toContain('<script');
        expect(combinedHtml).not.toContain('<img');
        expect(combinedHtml).not.toContain('<svg');
        expect(combinedHtml).not.toContain('<b>Conversation plan</b>');
        expect(combinedHtml).not.toContain('javascript:alert');
    });

    it('keeps sales follow-up aligned with the single offer and direct booking', () => {
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

        expect(missingInfoPreview.subject).toBe('Optional context for your classes - Espanol Honesto');
        expect(proposalPreview.subject).toBe('How direct booking will work - Espanol Honesto');
        expect(missingInfoHtml).toContain('This is optional');
        expect(missingInfoHtml).toContain('without a review, recommendation or approval');
        expect(missingInfoHtml).toMatch(/When direct\s+booking is enabled/);
        expect(missingInfoHtml).toContain('when checkout is enabled');
        expect(missingInfoHtml).toContain('four individual 50-minute classes for EUR 259');
        expect(proposalHtml).toContain('four individual 50-minute classes for EUR 259');
        expect(proposalHtml).toContain('renewed every 28 days');
        expect(proposalHtml).toContain('teacher, weekly time, time zone, all four class dates');
        expect(proposalHtml).toContain('Booking will be direct');
        expect(proposalHtml).toContain('When checkout is enabled');
        expect(proposalHtml).not.toContain('Hybrid plan');
        expect(proposalHtml).not.toContain('coordinate the first class manually');
        expect([missingInfoHtml, proposalHtml].join('\n')).not.toMatch(/before suggesting a plan|if it looks like a fit|wait for approval/i);
        expect([missingInfoHtml, proposalHtml].join('\n')).not.toMatch(/you can already book|return to the availability shown on the website when you are ready/i);
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

describe('Checkout V2 provisional-anchor reschedule email', () => {
    const contract = {
        recipientName: 'Alina <student>',
        otherPartyName: 'Alejandro <teacher>',
        classStartsAt: [
            '2026-10-12T08:00:00.000Z',
            '2026-10-19T08:00:00.000Z',
            '2026-10-26T09:00:00.000Z',
            '2026-11-02T09:00:00.000Z',
        ],
        renewalAnchorAt: '2026-11-09T08:00:00.000Z',
        timezoneName: 'Europe/Madrid',
        amountCents: 25_900,
        currency: 'EUR',
    };

    it.each([
        ['es', 'Nuevas fechas', 'Próximo cobro', '259 EUR'],
        ['en', 'New dates', 'Next charge', 'EUR 259'],
        ['ru', 'Новые даты', 'Следующее списание', '259 EUR'],
    ] as const)('renders four dates and the exact next charge in %s', (locale, dates, charge, amount) => {
        const html = checkoutV2CycleRescheduledTemplate({
            ...contract,
            locale,
            isTeacher: false,
        });

        expect(checkoutV2CycleRescheduledSubject(locale, false)).toContain('Español Honesto');
        expect(html).toContain(dates);
        expect(html).toContain(charge);
        expect(html).toContain(amount);
        expect(html.match(/Europe\/Madrid/g)).toHaveLength(6);
        expect(html).toContain('Alina &lt;student&gt;');
        expect(html).toContain('Alejandro &lt;teacher&gt;');
        expect(html).not.toMatch(mojibakePattern);
    });

    it('renders one teacher summary without billing information', () => {
        const html = checkoutV2CycleRescheduledTemplate({
            ...contract,
            locale: 'en',
            isTeacher: true,
        });

        expect(checkoutV2CycleRescheduledSubject('en', true)).toBe(
            'First cycle rescheduled - Español Honesto',
        );
        expect(html).toContain('four new dates with your student');
        expect(html.match(/Europe\/Madrid/g)).toHaveLength(5);
        expect(html).not.toContain('EUR 259');
        expect(html).not.toContain('Next charge');
        expect(html).not.toMatch(mojibakePattern);
    });

    it('fails closed on an incoherent renewal anchor', () => {
        expect(() => checkoutV2CycleRescheduledTemplate({
            ...contract,
            locale: 'en',
            isTeacher: false,
            renewalAnchorAt: '2026-11-10T08:00:00.000Z',
        })).toThrow('exact renewal anchor');
    });
});
