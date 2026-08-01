import { describe, expect, it, vi } from 'vitest';
import { recordAcquisitionAttributionSafe } from '../../src/lib/crm/acquisition-attribution';

const attribution = {
    requestId: '10000000-0000-4000-8000-000000000001',
    landingPath: '/en/spanish-for-work',
    referrerKind: 'external',
    referrerHost: 'example.com',
    entryLanguage: 'en',
    utmSource: 'google',
    utmMedium: 'cpc',
    utmCampaign: 'move_to_spain',
};

describe('recordAcquisitionAttributionSafe', () => {
    it('sanitizes again and records a linked event through the durable RPC', async () => {
        const rpc = vi.fn().mockResolvedValue({ data: { id: 'event-1' }, error: null });

        const result = await recordAcquisitionAttributionSafe({ rpc }, {
            eventKind: 'application_submit',
            attribution,
            leadId: '30000000-0000-4000-8000-000000000001',
        });

        expect(result).toEqual({ status: 'recorded' });
        expect(rpc).toHaveBeenCalledWith('record_acquisition_attribution_event', {
            p_request_id: attribution.requestId,
            p_event_kind: 'application_submit',
            p_lead_id: '30000000-0000-4000-8000-000000000001',
            p_checkout_intent_id: null,
            p_landing_path: '/en/spanish-for-work',
            p_referrer_kind: 'external',
            p_referrer_host: 'example.com',
            p_referrer_path: null,
            p_entry_language: 'en',
            p_utm_source: 'google',
            p_utm_medium: 'cpc',
            p_utm_campaign: 'move_to_spain',
            p_utm_term: null,
            p_utm_content: null,
        });
    });

    it('does not call the database when attribution is absent or invalid', async () => {
        const rpc = vi.fn();

        await expect(recordAcquisitionAttributionSafe({ rpc }, {
            eventKind: 'level_check_submit',
            attribution: null,
        })).resolves.toEqual({ status: 'skipped', reason: 'missing_attribution' });
        await expect(recordAcquisitionAttributionSafe({ rpc }, {
            eventKind: 'level_check_submit',
            attribution: { ...attribution, requestId: 'not-a-uuid' },
        })).resolves.toEqual({ status: 'skipped', reason: 'missing_attribution' });

        expect(rpc).not.toHaveBeenCalled();
    });

    it('accepts an idempotent replay result without exposing the attribution payload', async () => {
        const rpc = vi.fn()
            .mockResolvedValueOnce({ data: { id: 'event-1' }, error: null })
            .mockResolvedValueOnce({ data: { id: 'event-1' }, error: null });

        const first = await recordAcquisitionAttributionSafe({ rpc }, {
            eventKind: 'checkout_start',
            attribution,
            checkoutIntentId: '40000000-0000-4000-8000-000000000001',
        });
        const replay = await recordAcquisitionAttributionSafe({ rpc }, {
            eventKind: 'checkout_start',
            attribution,
            checkoutIntentId: '40000000-0000-4000-8000-000000000001',
        });

        expect(first).toEqual({ status: 'recorded' });
        expect(replay).toEqual({ status: 'recorded' });
    });

    it('logs no payload and never throws when the table is absent or the RPC fails', async () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const rpc = vi.fn().mockResolvedValue({
            data: null,
            error: { code: 'PGRST202', message: `failed for ${attribution.utmCampaign}` },
        });

        const result = await recordAcquisitionAttributionSafe({ rpc }, {
            eventKind: 'application_submit',
            attribution,
        });

        expect(result).toEqual({ status: 'skipped', reason: 'record_failed' });
        expect(errorSpy).toHaveBeenCalledWith('[AcquisitionAttribution] Could not record attribution event');
        expect(errorSpy.mock.calls.flat().join(' ')).not.toContain(attribution.utmCampaign);
        errorSpy.mockRestore();
    });
});
