import type { APIRoute } from 'astro';
import { deliverEmail, sendLeadWelcomeEmail } from '../../lib/email';
import {
    loadLeadCaptureForCrm,
    recordLeadEmailOutInCrmSafe,
    syncLeadCaptureToCrmSafe,
} from '../../lib/crm/lead-capture';
import { createSupabaseAdminClient } from '../../lib/supabase-admin';
import { readRuntimeEnv } from '../../lib/runtime-env';
import type { Database } from '../../types/database.types';
import { describeEmailSendError } from '../../lib/email/errors';
import { hasAcceptedAdultPolicy, LEGAL_POLICY_VERSION } from '../../lib/legal-policy';

type LeadInsert = Database['public']['Tables']['leads']['Insert'];

const escapeHtml = (str: string) =>
    str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const allowedLevels = new Set(['not_sure', 'a1', 'a2', 'b1', 'b2', 'c1_plus']);
const languageAliases = new Map([
    ['russian', 'ru'],
    ['ruso', 'ru'],
    ['russo', 'ru'],
    ['ru', 'ru'],
    ['english', 'en'],
    ['ingles', 'en'],
    ['inglés', 'en'],
    ['en', 'en'],
    ['spanish', 'es'],
    ['espanol', 'es'],
    ['español', 'es'],
    ['es', 'es'],
]);

const textOrNull = (value: unknown, maxLength: number): string | null => {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    if (!trimmed) return null;
    return trimmed.slice(0, maxLength);
};

const normalizeLevel = (value: unknown): string | null => {
    if (typeof value !== 'string') return null;
    return allowedLevels.has(value) ? value : null;
};

const normalizeSourcePath = (value: unknown): string | null => {
    const sourcePath = textOrNull(value, 240);
    if (!sourcePath || !sourcePath.startsWith('/')) return null;
    if (sourcePath.startsWith('//') || sourcePath.includes('://')) return null;
    return sourcePath;
};

const normalizeLanguageToken = (value: unknown): string | null => {
    const token = textOrNull(value, 40);
    if (!token) return null;
    const normalized = token.toLowerCase().normalize('NFKC').replace(/\s+/g, '_');
    return languageAliases.get(normalized) || normalized.replace(/[^a-z0-9_+-]/g, '').slice(0, 40) || null;
};

const normalizeSpokenLanguages = (value: unknown, otherValue: unknown): string[] => {
    const rawLanguages = Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
    const otherLanguages = typeof otherValue === 'string'
        ? otherValue.split(/[;,]/).map((item) => item.trim())
        : [];
    const normalized = [...rawLanguages, ...otherLanguages]
        .map(normalizeLanguageToken)
        .filter((item): item is string => Boolean(item));

    return Array.from(new Set(normalized)).slice(0, 12);
};

const isMissingOptionalLeadColumn = (error: unknown): boolean => {
    const code = typeof (error as { code?: unknown })?.code === 'string' ? (error as { code: string }).code : '';
    const message = typeof (error as { message?: unknown })?.message === 'string'
        ? (error as { message: string }).message
        : '';

    return ['preferred_package', 'spoken_languages', 'is_russian_speaker'].some((column) => message.includes(column))
        && (code === 'PGRST204' || code === '42703' || code === '');
};

const isDuplicateLeadEmail = (error: unknown): boolean => {
    const code = typeof (error as { code?: unknown })?.code === 'string' ? (error as { code: string }).code : '';
    const message = typeof (error as { message?: unknown })?.message === 'string'
        ? (error as { message: string }).message
        : '';

    return code === '23505' && message.toLowerCase().includes('email');
};

export const POST: APIRoute = async ({ request, locals: _locals, clientAddress }) => {
    const supabaseAdmin = createSupabaseAdminClient();
    try {
        const payload = await request.json() as Record<string, unknown>;
        const { email, name, interest, lang, consent } = payload;
        const turnstileToken = typeof payload['cf-turnstile-response'] === 'string' ? payload['cf-turnstile-response'] : '';
        const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
        const normalizedName = textOrNull(name, 120);
        const normalizedInterest = textOrNull(interest, 80);
        const normalizedLang = typeof lang === 'string' && ['es', 'en', 'ru'].includes(lang) ? lang : 'es';
        const currentLevel = normalizeLevel(payload.currentLevel);
        const learningGoal = textOrNull(payload.learningGoal, 700);
        const availability = textOrNull(payload.availability, 400);
        const preferredPackage = textOrNull(payload.preferredPackage, 80);
        const sourcePath = normalizeSourcePath(payload.sourcePath);
        const spokenLanguages = normalizeSpokenLanguages(payload.spokenLanguages, payload.otherLanguages);
        const isRussianSpeaker = Boolean(payload.isRussianSpeaker) || spokenLanguages.includes('ru');

        if (!normalizedEmail || !/^\S+@\S+\.\S+$/.test(normalizedEmail)) {
            return new Response(JSON.stringify({ error: 'Email inválido' }), { status: 400 });
        }

        if (!hasAcceptedAdultPolicy(payload.adultConfirmed)) {
            return new Response(JSON.stringify({ error: 'Debes confirmar que tienes al menos 18 años' }), { status: 400 });
        }

        if (!consent) {
            return new Response(JSON.stringify({ error: 'Debe aceptar las políticas de privacidad' }), { status: 400 });
        }

        // Validar Token Cloudflare Turnstile
        if (!turnstileToken) {
            return new Response(JSON.stringify({ error: 'Por favor, pasa la verificación de seguridad.' }), { status: 400 });
        }

        const turnstileSecretKey = readRuntimeEnv('TURNSTILE_SECRET_KEY');
        const turnstileBody = new URLSearchParams({
            secret: turnstileSecretKey ?? '',
            response: turnstileToken,
        });
        if (clientAddress) {
            turnstileBody.set('remoteip', clientAddress);
        }

        const turnstileRes = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: turnstileBody,
        });
        const turnstileData = await turnstileRes.json() as { success?: boolean };

        if (!turnstileData.success) {
            return new Response(JSON.stringify({ error: 'Validación anti-bot fallida.' }), { status: 403 });
        }

        // 1. Guardar en Base de Datos (CRM & GDPR)
        const adultConfirmedAt = new Date().toISOString();
        const leadUpsert: LeadInsert = {
            email: normalizedEmail,
            name: normalizedName,
            interest: normalizedInterest,
            current_level: currentLevel,
            learning_goal: learningGoal,
            availability,
            preferred_package: preferredPackage,
            source_path: sourcePath,
            lang: normalizedLang,
            spoken_languages: spokenLanguages,
            is_russian_speaker: isRussianSpeaker,
            adult_confirmed: true,
            adult_confirmed_at: adultConfirmedAt,
            age_policy_version: LEGAL_POLICY_VERSION,
            consent_given: Boolean(consent),
            ip_address: clientAddress,
            status: 'new',
            updated_at: new Date().toISOString(),
        };

        let { error: dbError } = await supabaseAdmin
            .from('leads')
            .insert(leadUpsert);

        if (dbError && isMissingOptionalLeadColumn(dbError)) {
            const fallbackLeadUpsert: LeadInsert = { ...leadUpsert };
            delete fallbackLeadUpsert.preferred_package;
            delete fallbackLeadUpsert.spoken_languages;
            delete fallbackLeadUpsert.is_russian_speaker;
            const retry = await supabaseAdmin
                .from('leads')
                .insert(fallbackLeadUpsert);
            dbError = retry.error;
        }

        if (dbError && isDuplicateLeadEmail(dbError)) {
            const { error: attestationError } = await supabaseAdmin
                .from('leads')
                .update({
                    adult_confirmed: true,
                    adult_confirmed_at: adultConfirmedAt,
                    age_policy_version: LEGAL_POLICY_VERSION,
                    consent_given: true,
                    updated_at: adultConfirmedAt,
                })
                .eq('email', normalizedEmail);

            if (attestationError) {
                console.error('Supabase error updating adult attestation:', attestationError);
                return new Response(JSON.stringify({ error: 'Error al registrar contacto' }), { status: 500 });
            }

            return new Response(
                JSON.stringify({ message: 'Success' }),
                { status: 200 }
            );
        }

        if (dbError) {
            console.error('Supabase error inserting lead:', dbError);
            // We can choose to fail or continue. Better fail to guarantee GDPR compliance before notifying.
            return new Response(JSON.stringify({ error: 'Error al registrar contacto' }), { status: 500 });
        }

        const savedLead = await loadLeadCaptureForCrm(supabaseAdmin, normalizedEmail).catch((error) => {
            console.error('[Subscribe] Could not reload lead for CRM sync:', error);
            return null;
        });
        const crmSync = savedLead
            ? await syncLeadCaptureToCrmSafe(supabaseAdmin, savedLead)
            : null;

        // 2. Send Admin Notification through the shared quota/safety gate.
        const adminNotification = await deliverEmail({
            to: [readRuntimeEnv('ADMIN_EMAIL') || 'alejandro@espanolhonesto.com'],
            subject: `Nuevo Lead: ${escapeHtml(normalizedName || 'N/A')} (${escapeHtml(normalizedInterest || 'N/A')})`,
            html: `
        <div style="font-family: sans-serif; padding: 20px; color: #333;">
            <h1 style="color: #006064;">Nuevo Lead Capturado</h1>
            <p><strong>Nombre:</strong> ${escapeHtml(normalizedName || 'N/A')}</p>
            <p><strong>Email:</strong> ${escapeHtml(normalizedEmail)}</p>
            <p><strong>Interés:</strong> ${escapeHtml(normalizedInterest || 'N/A')}</p>
            <p><strong>Nivel declarado:</strong> ${escapeHtml(currentLevel || 'N/A')}</p>
            <p><strong>Plan de interes:</strong> ${escapeHtml(preferredPackage || 'N/A')}</p>
            <p><strong>Objetivo:</strong> ${escapeHtml(learningGoal || 'N/A')}</p>
            <p><strong>Disponibilidad:</strong> ${escapeHtml(availability || 'N/A')}</p>
            <p><strong>Origen:</strong> ${escapeHtml(sourcePath || 'N/A')}</p>
            <p><strong>Idioma:</strong> ${escapeHtml(normalizedLang)}</p>
            <p><strong>Lenguas:</strong> ${escapeHtml(spokenLanguages.join(', ') || 'N/A')}</p>
            <p><strong>Rusofono:</strong> ${isRussianSpeaker ? 'Si' : 'No'}</p>
            <p><strong>Fecha:</strong> ${new Date().toLocaleString()}</p>
            <hr />
            <p style="font-size: 12px; color: #888;">Este lead proviene del formulario de solicitud de plaza.</p>
        </div>
      `,
            source: 'lead_admin_notification',
        });
        if (!adminNotification.ok) {
            console.error(
                'Error notifying admin:',
                adminNotification.error
                    ? describeEmailSendError(adminNotification.error)
                    : adminNotification.reason
            );
        }

        // 3. Send Welcome Email to User
        const leadWelcomeSent = await sendLeadWelcomeEmail(normalizedEmail, {
            recipientName: normalizedName ?? undefined
        });

        if (savedLead && leadWelcomeSent && crmSync?.status === 'synced') {
            await recordLeadEmailOutInCrmSafe(supabaseAdmin, {
                lead: savedLead,
                contactId: crmSync.contactId,
                opportunityId: crmSync.opportunityId,
                subject: 'Application received - Espanol Honesto',
                template: 'lead_welcome',
            });
        }

        return new Response(
            JSON.stringify({ message: 'Success' }),
            { status: 200 }
        );
    } catch (error) {
        console.error('[Subscribe] Lead/email flow error:', describeEmailSendError(error));
        return new Response(
            JSON.stringify({ error: 'Error al enviar email' }),
            { status: 500 }
        );
    }
};
