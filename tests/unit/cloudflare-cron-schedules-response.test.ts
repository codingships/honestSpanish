import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseCloudflareCronSchedulesResponse } from '../../scripts/launch/cloudflare-cron-schedules-response';

describe('Cloudflare Cron schedules response parser', () => {
    it.each([
        ['legacy array result', { success: true, result: [] }],
        ['wrapped schedules result', { success: true, result: { schedules: [] } }],
    ])('accepts an empty %s', (_label, response) => {
        expect(parseCloudflareCronSchedulesResponse(response)).toEqual({ schedules: [] });
    });

    it.each([
        ['legacy array result', { success: true, result: [{ cron: '0 * * * *' }] }],
        ['wrapped schedules result', { success: true, result: { schedules: [{ cron: '0 * * * *' }] } }],
    ])('preserves schedule records from the %s', (_label, response) => {
        expect(parseCloudflareCronSchedulesResponse(response)).toEqual({
            schedules: [{ cron: '0 * * * *' }],
        });
    });

    it.each([
        null,
        [],
        { success: false, result: [] },
        { result: [] },
        { success: true },
        { success: true, result: {} },
        { success: true, result: { schedules: null } },
        { success: true, result: [null] },
        { success: true, result: { schedules: ['0 * * * *'] } },
    ])('fails closed for malformed response %#', (response) => {
        expect(parseCloudflareCronSchedulesResponse(response)).toBeNull();
    });

    it('is used by C, D and the fulfillment lifecycle probes', () => {
        for (const file of [
            'scripts/launch/cloudflare-production-fulfillment-bootstrap-secrets.ts',
            'scripts/launch/cloudflare-production-worker-phase1.ts',
            'scripts/launch/cloudflare-production-fulfillment-lifecycle.ts',
        ]) {
            const source = readFileSync(file, 'utf8');
            expect(source).toContain("from './cloudflare-cron-schedules-response'");
            expect(source).toContain('parseCloudflareCronSchedulesResponse(');
        }
    });
});
