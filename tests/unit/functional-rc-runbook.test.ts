import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (file: string) => readFileSync(file, 'utf8');

describe('functional RC launch verification', () => {
    it('keeps the no-real-payments functional RC command wired to launch guidance', () => {
        const packageJson = read('package.json');
        const script = read('scripts/launch/functional-rc.ts');
        const releaseCandidate = read('scripts/launch/release-candidate.ts');
        const statusScript = read('scripts/launch/status.ts');
        const guide = read('docs/launch/FUNCTIONAL_RC.md');
        const emailMatrix = read('docs/launch/EMAIL_MATRIX.md');
        const launchSequence = read('docs/launch/LAUNCH_SEQUENCE.md');

        expect(packageJson).toContain('launch:functional-rc');
        expect(packageJson).toContain('scripts/launch/functional-rc.ts');

        for (const snippet of [
            'commercial_intake_crm',
            'transactional_emails',
            'level_check',
            'post_payment_onboarding',
            'contract: functionalRcContract',
            'commercialIntakeContract',
            'postPaymentActivationContract',
            'excludedExternalDependencies',
            'finalOnlyExclusions',
            'evidenceRules',
            'summary.json',
            'The same contract is written to `summary.json` under `contract`',
            'Commercial Intake Contract',
            'Application creates or updates a CRM contact, opportunity, consent, timeline activity and review task.',
            'Initial review task has a 24h first-human-response SLA.',
            'shared founder queue until one admin claims it manually',
            'CRM opportunity stage is the source for proposal, nurture, lost and won decisions.',
            'Post-Payment Activation Contract',
            'Welcome email accepted by Resend or an equivalent mocked sender.',
            'First class is coordinated manually against real availability',
            'Google Meet is not cut automatically at the minute mark.',
            'scheduling_availability',
            'no_real_payments_safety',
            'support_and_recovery',
            'tests/api/subscribe.test.ts',
            'tests/api/admin-leads.test.ts',
            'tests/unit/email-templates.test.ts',
            'tests/api/level-check.test.ts',
            'tests/unit/crm-onboarding.test.ts',
            'tests/unit/calendar-availability.test.ts',
            'tests/api/available-slots.test.ts',
            'tests/api/teacher-availability.test.ts',
            'tests/api/sessions-create.test.ts',
            'tests/api/recurring-sessions.test.ts',
            'tests/api/bulk-sessions.test.ts',
            'tests/api/session-action.test.ts',
            'tests/unit/StudentClassList.test.tsx',
            'tests/api/create-checkout.test.ts',
            'It does not contact Stripe live',
            'Hosted Supabase schema parity and migrations',
            'Cloudflare Workers Logs/observability',
            'cron config/deployment/secret-name evidence is covered by staging preflight',
            'Do not use this command to close external service evidence.',
            'Do not use this command to close final-only legal',
        ]) {
            expect(script).toContain(snippet);
        }

        for (const snippet of [
            'corepack pnpm launch:functional-rc',
            'Solicitud de plaza y CRM',
            'Emails transaccionales',
            'Diagnostico ligero de nivel',
            'Contrato De Flujo Comercial',
            'SLA de 24h para primera respuesta humana',
            'cola compartida de fundadores',
            'propuesta, posponer, perder o ganar',
            'Contrato De Activacion Post-Pago',
            'Primera clase coordinada manualmente con disponibilidad real',
            'Google Meet no se corta automaticamente',
            'Calendario, disponibilidad de profesor',
            'Checkout fail-closed',
            'Supabase alojado ni migraciones remotas',
            '`outputs/launch-functional-rc/<timestamp>/summary.json`',
            '`contract`',
        ]) {
            expect(guide).toContain(snippet);
        }

        expect(launchSequence).toContain('pnpm launch:functional-rc');
        expect(launchSequence).toContain('sin cobros reales');
        expect(releaseCandidate).toContain("runStep('launch:functional-rc')");
        expect(statusScript).toContain('launch-functional-rc');
        expect(statusScript).toContain('Functional RC');

        for (const snippet of [
            'Contrato De Activacion Post-Pago',
            'email pide abrir campus/materiales',
            'responder si hay limites de disponibilidad',
            'SLA 24h',
            'primera clase se complete',
        ]) {
            expect(emailMatrix).toContain(snippet);
        }
    });
});
