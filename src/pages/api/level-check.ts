import type { APIRoute } from 'astro';
import {
    loadLeadCaptureForCrm,
    syncLeadCaptureToCrmSafe,
} from '../../lib/crm/lead-capture';
import { recordLevelCheckInCrmSafe } from '../../lib/crm/level-check';
import { verifyLeadEmailToken } from '../../lib/lead-email-token';
import { readRuntimeEnv } from '../../lib/runtime-env';
import { createSupabaseAdminClient } from '../../lib/supabase-admin';
import type { Database, Json } from '../../types/database.types';
import { ADULT_POLICY_VERSION, hasAcceptedAdultPolicy } from '../../lib/legal-policy';
import { recordAcquisitionAttributionSafe } from '../../lib/crm/acquisition-attribution';

type LeadInsert = Database['public']['Tables']['leads']['Insert'];
type LeadUpdate = Database['public']['Tables']['leads']['Update'];

const allowedLevels = new Set(['not_sure', 'a1', 'a2', 'b1', 'b2', 'c1_plus']);
const allowedComprehension = new Set(['mostly_understand', 'depends_context', 'get_lost_fast', 'not_sure']);
const allowedBlockers = new Set(['grammar', 'vocabulary', 'speed', 'confidence', 'culture', 'pronunciation', 'other']);

const levelLabels: Record<string, string> = {
    not_sure: 'not sure',
    a1: 'A1',
    a2: 'A2',
    b1: 'B1',
    b2: 'B2',
    c1_plus: 'C1+',
};

const comprehensionLabels: Record<string, string> = {
    mostly_understand: 'mostly understands',
    depends_context: 'depends on context',
    get_lost_fast: 'gets lost fast',
    not_sure: 'not sure',
};

const blockerLabels: Record<string, string> = {
    grammar: 'grammar',
    vocabulary: 'vocabulary',
    speed: 'speed of conversation',
    confidence: 'confidence',
    culture: 'culture/context',
    pronunciation: 'pronunciation',
    other: 'other',
};

const textOrNull = (value: unknown, maxLength: number): string | null => {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    if (!trimmed) return null;
    return trimmed.slice(0, maxLength);
};

const normalizeSourcePath = (value: unknown): string | null => {
    const sourcePath = textOrNull(value, 240);
    if (!sourcePath || !sourcePath.startsWith('/')) return null;
    if (sourcePath.startsWith('//') || sourcePath.includes('://')) return null;
    return sourcePath;
};

const normalizeAllowed = (value: unknown, allowed: Set<string>, fallback: string) => {
    return typeof value === 'string' && allowed.has(value) ? value : fallback;
};

const isMissingLevelCheckColumn = (error: unknown): boolean => {
    const code = typeof (error as { code?: unknown })?.code === 'string' ? (error as { code: string }).code : '';
    const message = typeof (error as { message?: unknown })?.message === 'string'
        ? (error as { message: string }).message
        : '';

    return message.includes('level_check_') && (code === 'PGRST204' || code === '42703' || code === '');
};

function jsonResponse(payload: unknown, status = 200): Response {
    return new Response(JSON.stringify(payload), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

function buildFitFlags(input: {
    currentLevel: string;
    comprehensionComfort: string;
    speakingBlocker: string;
    useContext: string | null;
    canSendAudioLater: boolean;
}) {
    const flags: string[] = [];
    if (input.currentLevel === 'not_sure' || input.currentLevel === 'a1') flags.push('basic_or_unclear_level');
    if (input.currentLevel === 'b1' || input.currentLevel === 'b2') flags.push('plateau_candidate');
    if (input.comprehensionComfort === 'get_lost_fast') flags.push('comprehension_gap');
    if (input.speakingBlocker === 'culture') flags.push('culture_context_signal');
    if (!input.useContext) flags.push('context_missing');
    if (input.canSendAudioLater) flags.push('audio_optional_available');
    return Array.from(new Set(flags)).slice(0, 8);
}

function buildSummary(input: {
    currentLevel: string;
    comprehensionComfort: string;
    speakingBlocker: string;
    useContext: string | null;
    writtenSample: string;
    canSendAudioLater: boolean;
}) {
    const context = input.useContext || 'not provided';
    return [
        `Self-reported level: ${levelLabels[input.currentLevel] || input.currentLevel}.`,
        `Comprehension: ${comprehensionLabels[input.comprehensionComfort] || input.comprehensionComfort}.`,
        `Main blocker: ${blockerLabels[input.speakingBlocker] || input.speakingBlocker}.`,
        `Context: ${context}.`,
        `Written sample stored temporarily (${input.writtenSample.length} characters).`,
        input.canSendAudioLater ? 'Student can send optional audio later.' : 'No optional audio requested.',
    ].join(' ').slice(0, 1000);
}

async function verifyTurnstile(token: unknown, clientAddress: string | undefined) {
    if (typeof token !== 'string' || !token.trim()) {
        return { ok: false, status: 400, message: 'Security verification is required.' };
    }

    const turnstileSecretKey = readRuntimeEnv('TURNSTILE_SECRET_KEY');
    const turnstileBody = new URLSearchParams({
        secret: turnstileSecretKey ?? '',
        response: token,
    });
    if (clientAddress) turnstileBody.set('remoteip', clientAddress);

    const turnstileRes = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: turnstileBody,
    });
    const turnstileData = await turnstileRes.json() as { success?: boolean };

    if (!turnstileData.success) {
        return { ok: false, status: 403, message: 'Security verification failed.' };
    }

    return { ok: true, status: 200, message: 'ok' };
}

export const POST: APIRoute = async ({ request, clientAddress }) => {
    let payload: Record<string, unknown>;
    try {
        payload = await request.json() as Record<string, unknown>;
    } catch {
        return jsonResponse({ error: 'Invalid JSON body' }, 400);
    }

    const normalizedEmail = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '';
    const normalizedLang = ['es', 'en', 'ru'].includes(String(payload.lang)) ? String(payload.lang) : 'en';
    const currentLevel = normalizeAllowed(payload.currentLevel, allowedLevels, 'not_sure');
    const comprehensionComfort = normalizeAllowed(payload.comprehensionComfort, allowedComprehension, 'not_sure');
    const speakingBlocker = normalizeAllowed(payload.speakingBlocker, allowedBlockers, 'other');
    const useContext = textOrNull(payload.useContext, 500);
    const writtenSample = textOrNull(payload.writtenSample, 1200);
    const sourcePath = normalizeSourcePath(payload.sourcePath);
    const leadId = textOrNull(payload.leadId, 80);
    const leadToken = textOrNull(payload.token, 180);
    const canSendAudioLater = Boolean(payload.canSendAudioLater);
    const consent = Boolean(payload.consent);

    if (!normalizedEmail || !/^\S+@\S+\.\S+$/.test(normalizedEmail)) {
        return jsonResponse({ error: 'Invalid email' }, 400);
    }

    if (!hasAcceptedAdultPolicy(payload.adultConfirmed)) {
        return jsonResponse({ error: 'You must confirm that you are at least 18.' }, 400);
    }

    if (!consent) {
        return jsonResponse({ error: 'Consent is required.' }, 400);
    }

    if (!writtenSample || writtenSample.length < 40) {
        return jsonResponse({ error: 'Please add a short written sample.' }, 400);
    }

    const turnstile = await verifyTurnstile(payload['cf-turnstile-response'], clientAddress);
    if (!turnstile.ok) {
        return jsonResponse({ error: turnstile.message }, turnstile.status);
    }

    const supabaseAdmin = createSupabaseAdminClient();
    const now = new Date().toISOString();
    const fitFlags = buildFitFlags({
        currentLevel,
        comprehensionComfort,
        speakingBlocker,
        useContext,
        canSendAudioLater,
    });
    const summary = buildSummary({
        currentLevel,
        comprehensionComfort,
        speakingBlocker,
        useContext,
        writtenSample,
        canSendAudioLater,
    });
    const levelCheckContext: Json = {
        current_level: currentLevel,
        comprehension_comfort: comprehensionComfort,
        speaking_blocker: speakingBlocker,
        use_context: useContext,
        written_sample: writtenSample,
        can_send_audio_later: canSendAudioLater,
        submitted_lang: normalizedLang,
        source_path: sourcePath,
        submitted_at: now,
        retention: 'clear_raw_if_discarded',
    };

    const levelCheckUpdate: LeadUpdate = {
        adult_confirmed: true,
        adult_confirmed_at: now,
        age_policy_version: ADULT_POLICY_VERSION,
        current_level: currentLevel,
        lang: normalizedLang,
        consent_given: true,
        level_check_status: 'received',
        level_check_context: levelCheckContext,
        level_check_summary: summary,
        level_check_estimated_level: currentLevel === 'not_sure' ? null : currentLevel,
        level_check_confidence: 'low',
        level_check_plan_recommendation: null,
        level_check_fit_flags: fitFlags,
        level_check_received_at: now,
        updated_at: now,
    };
    if (sourcePath) levelCheckUpdate.source_path = sourcePath;

    const { data: existingLead, error: findError } = await supabaseAdmin
        .from('leads')
        .select('id, email, status')
        .eq('email', normalizedEmail)
        .maybeSingle();

    if (findError) {
        return jsonResponse({ error: 'Could not load lead' }, 500);
    }

    const canUpdateExistingLead = existingLead?.id && leadId && leadToken
        ? await verifyLeadEmailToken({
            leadId,
            email: normalizedEmail,
            token: leadToken,
        }) && leadId === existingLead.id
        : false;

    if (existingLead?.id && !canUpdateExistingLead) {
        return jsonResponse({ message: 'Success' });
    }

    const saveResult = existingLead?.id
        ? await supabaseAdmin
            .from('leads')
            .update(levelCheckUpdate)
            .eq('id', existingLead.id)
            .select('id')
            .single()
        : await supabaseAdmin
            .from('leads')
            .insert({
                email: normalizedEmail,
                status: 'new',
                ...levelCheckUpdate,
            } satisfies LeadInsert)
            .select('id')
            .single();

    if (saveResult.error) {
        if (isMissingLevelCheckColumn(saveResult.error)) {
            return jsonResponse({ error: 'Level check fields are not migrated yet' }, 409);
        }
        console.error('[LevelCheck] Could not save diagnostic:', saveResult.error);
        return jsonResponse({ error: 'Could not save level check' }, 500);
    }

    const savedLead = await loadLeadCaptureForCrm(supabaseAdmin, normalizedEmail).catch((error) => {
        console.error('[LevelCheck] Could not reload lead for CRM sync:', error);
        return null;
    });
    const crmSync = savedLead ? await syncLeadCaptureToCrmSafe(supabaseAdmin, savedLead) : null;

    if (savedLead && crmSync?.status === 'synced') {
        await recordAcquisitionAttributionSafe(supabaseAdmin, {
            eventKind: 'level_check_submit',
            attribution: payload.attribution,
            leadId: savedLead.id,
        });
        await recordLevelCheckInCrmSafe(supabaseAdmin, {
            lead: savedLead,
            contactId: crmSync.contactId,
            opportunityId: crmSync.opportunityId,
            summary,
            receivedAt: now,
            metadata: {
                current_level: currentLevel,
                comprehension_comfort: comprehensionComfort,
                speaking_blocker: speakingBlocker,
                can_send_audio_later: canSendAudioLater,
                source_path: sourcePath,
                fit_flags: fitFlags,
                written_sample_characters: writtenSample.length,
                raw_context_location: 'leads.level_check_context',
                retention: 'clear_raw_if_discarded',
            },
        });
    }

    return jsonResponse({ message: 'Success' });
};
