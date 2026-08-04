import { describe, expect, it } from 'vitest';
import {
    percentile,
    summarizeCapacity,
    type CapacitySample,
} from '../../scripts/diagnostics/local-capacity-rehearsal';

describe('local capacity rehearsal metrics', () => {
    it('uses nearest-rank percentiles without mutating the source', () => {
        const values = [40, 10, 30, 20];

        expect(percentile(values, 0.5)).toBe(20);
        expect(percentile(values, 0.95)).toBe(40);
        expect(values).toEqual([40, 10, 30, 20]);
    });

    it('reports failures, correlation gaps and status counts separately', () => {
        const samples: CapacitySample[] = [
            { bytes: 10, durationMs: 10, ok: true, path: '/en', requestIdPresent: true, status: 200 },
            { bytes: 20, durationMs: 30, ok: false, path: '/ru', requestIdPresent: false, status: 503 },
            { bytes: 0, durationMs: 20, ok: false, path: '/es', requestIdPresent: false, status: null },
        ];

        expect(summarizeCapacity(samples)).toEqual({
            bytesReceived: 30,
            failed: 2,
            missingRequestIds: 2,
            p50Ms: 20,
            p95Ms: 30,
            p99Ms: 30,
            requests: 3,
            statusCounts: { 200: 1, 503: 1, 'network-error': 1 },
            succeeded: 1,
        });
    });
});
