import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
    SENTRY_PRODUCTION_WORKFLOW_NAMES,
    buildSentryProductionHardeningApproval,
    buildSentryProductionWorkflows,
    fingerprintSentryId,
    workflowMatchesDefinition,
} from '../../scripts/launch/sentry-production-hardening-shared';

describe('Sentry production hardening', () => {
    const detectorId = 'detector-123';
    const ownerUserId = 'owner-456';
    const definitions = buildSentryProductionWorkflows({ detectorId, ownerUserId });

    it('defines exact production email coverage for new/regressed errors and a five-minute spike', () => {
        expect(definitions).toHaveLength(2);
        expect(definitions.map((definition) => definition.name)).toEqual(Object.values(SENTRY_PRODUCTION_WORKFLOW_NAMES));
        for (const definition of definitions) {
            expect(definition.enabled).toBe(true);
            expect(definition.environment).toBe('production');
            expect(definition.detectorIds).toEqual([detectorId]);
            expect(definition.owner).toBe(`user:${ownerUserId}`);
            expect(definition.actionFilters[0].actions).toEqual([expect.objectContaining({
                type: 'email',
                status: 'active',
                config: expect.objectContaining({ targetType: 'user', targetIdentifier: ownerUserId }),
            })]);
        }
        expect(definitions[0].triggers.conditions.map((condition) => condition.type)).toEqual([
            'first_seen_event',
            'reappeared_event',
            'regression_event',
        ]);
        expect(definitions[1].actionFilters[0].conditions).toEqual([expect.objectContaining({
            type: 'event_frequency_count',
            comparison: { value: 10, interval: '5min' },
        })]);
    });

    it('validates only the exact returned workflow shape', () => {
        const response = { ...definitions[0], id: 'workflow-id' };
        expect(workflowMatchesDefinition(response, definitions[0])).toBe(true);
        expect(workflowMatchesDefinition({ ...response, environment: null }, definitions[0])).toBe(false);
        expect(workflowMatchesDefinition({ ...response, detectorIds: ['other'] }, definitions[0])).toBe(false);
        expect(workflowMatchesDefinition({ ...response, actionFilters: [] }, definitions[0])).toBe(false);
    });

    it('pins detector and owner hashes in an exact narrow approval sentence', () => {
        const detectorFingerprint = fingerprintSentryId(detectorId);
        const ownerFingerprint = fingerprintSentryId(ownerUserId);
        const approval = buildSentryProductionHardeningApproval({ detectorFingerprint, ownerFingerprint });
        expect(approval).toContain('honestspanish/espanol-honesto-astro');
        expect(approval).toContain(detectorFingerprint);
        expect(approval).toContain(ownerFingerprint);
        expect(approval).toContain('scrubbing de direcciones IP');
        expect(approval).toContain('No autorizo cambiar incidencias');
    });

    it('keeps the executable runner exact-gated, GET-first and free of issue/event mutation', () => {
        const source = readFileSync('scripts/launch/sentry-production-hardening.ts', 'utf8');
        expect(source).toContain('SENTRY_PRODUCTION_HARDENING_APPROVAL_ENV');
        expect(source).toContain("process.argv.includes('--execute-approved')");
        expect(source).toContain("sentryRequest<unknown>('GET', workflowsApiPath()");
        expect(source).toContain("sentryRequest<Record<string, unknown>>('POST', workflowsApiPath()");
        expect(source).toContain('{ scrubIPAddresses: true }');
        expect(source).toContain("sentryRequest<unknown>('DELETE'");
        expect(source).not.toContain('/issues/');
        expect(source).not.toContain('/events/');
        expect(source).not.toContain('status: \'resolved\'');
    });
});
