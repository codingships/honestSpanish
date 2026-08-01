import {
    sanitizeAcquisitionAttribution,
    type AcquisitionAttribution,
} from '../acquisition-attribution';

export type AcquisitionAttributionEventKind =
    | 'application_submit'
    | 'level_check_submit'
    | 'checkout_start';

type AcquisitionAttributionRpcClient = {
    rpc(
        name: 'record_acquisition_attribution_event',
        args: Record<string, unknown>,
    ): Promise<{ data: unknown; error: unknown }>;
};

export type AcquisitionAttributionRecordResult =
    | { status: 'recorded' }
    | { status: 'skipped'; reason: 'missing_attribution' | 'record_failed' };

export async function recordAcquisitionAttributionSafe(
    client: unknown,
    input: {
        eventKind: AcquisitionAttributionEventKind;
        attribution: unknown;
        leadId?: string | null;
        checkoutIntentId?: string | null;
    },
): Promise<AcquisitionAttributionRecordResult> {
    const attribution = sanitizeAcquisitionAttribution(input.attribution);
    if (!attribution) return { status: 'skipped', reason: 'missing_attribution' };

    try {
        const rpcClient = client as AcquisitionAttributionRpcClient;
        const { error } = await rpcClient.rpc('record_acquisition_attribution_event', {
            p_request_id: attribution.requestId,
            p_event_kind: input.eventKind,
            p_lead_id: input.leadId ?? null,
            p_checkout_intent_id: input.checkoutIntentId ?? null,
            p_landing_path: attribution.landingPath,
            p_referrer_kind: attribution.referrerKind,
            p_referrer_host: attribution.referrerHost ?? null,
            p_referrer_path: attribution.referrerPath ?? null,
            p_entry_language: attribution.entryLanguage,
            p_utm_source: attribution.utmSource ?? null,
            p_utm_medium: attribution.utmMedium ?? null,
            p_utm_campaign: attribution.utmCampaign ?? null,
            p_utm_term: attribution.utmTerm ?? null,
            p_utm_content: attribution.utmContent ?? null,
        });
        if (error) throw error;
        return { status: 'recorded' };
    } catch {
        console.error('[AcquisitionAttribution] Could not record attribution event');
        return { status: 'skipped', reason: 'record_failed' };
    }
}

export type { AcquisitionAttribution };
