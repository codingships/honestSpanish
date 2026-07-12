import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
    RC_OPERATIONAL_BLOCKER_DEFINITIONS,
    collectOpenRcOperationalBlockers,
    hasExplicitRcOperationalClosureEvidence,
} from '../../scripts/launch/rc-operational-checklist';

const openOperationSection = `
## Operacion

- [x] Jobs con reintento/cancelacion desde admin.
- [ ] Runbook validado con un incidente simulado. Parcial.
- [ ] Sentry alerts configuradas. Parcial.
- [x] Proceso de soporte definido.
- [ ] Proceso de rollback probado. Parcial.

## Integraciones
`;

describe('Release Candidate operational checklist blockers', () => {
    it('returns stable blocker ids for every open RC operations row', () => {
        expect(collectOpenRcOperationalBlockers(openOperationSection)).toEqual([
            expect.objectContaining({ id: 'incident_simulation', reason: 'unchecked' }),
            expect.objectContaining({ id: 'sentry_alerts', reason: 'unchecked' }),
            expect.objectContaining({ id: 'rollback_proof', reason: 'unchecked' }),
        ]);
    });

    it('requires explicit closure evidence even when every row is checked', () => {
        const closed = openOperationSection.replaceAll('- [ ]', '- [x]');
        expect(collectOpenRcOperationalBlockers(closed)).toEqual([
            expect.objectContaining({ id: 'incident_simulation', reason: 'incomplete_evidence' }),
            expect.objectContaining({ id: 'sentry_alerts', reason: 'incomplete_evidence' }),
            expect.objectContaining({ id: 'rollback_proof', reason: 'incomplete_evidence' }),
        ]);

        const closedWithEvidence = closed
            .replace('Parcial.', 'Evidencia: `outputs/launch-incident-drill/summary.md`.')
            .replace('Parcial.', 'Riesgo aceptado por: Alin, nota: aceptado para el RC.')
            .replace('Parcial.', 'Evidencia: `outputs/launch-rollback/summary.md`.');
        expect(collectOpenRcOperationalBlockers(closedWithEvidence)).toEqual([]);
    });

    it('rejects empty evidence and accepted-risk markers without owner plus date or note', () => {
        for (const marker of [
            'Evidencia:',
            'Riesgo aceptado por:',
            'Riesgo aceptado por: Alin.',
            'Riesgo aceptado por: 2026-07-12.',
            'Riesgo aceptado por: fecha: 2026-07-12.',
            'Riesgo aceptado por: Alin, nota:',
        ]) {
            const markdown = openOperationSection.replace(
                '- [ ] Runbook validado con un incidente simulado. Parcial.',
                `- [x] Runbook validado con un incidente simulado. ${marker}`,
            );
            expect(collectOpenRcOperationalBlockers(markdown)).toContainEqual(
                expect.objectContaining({ id: 'incident_simulation', reason: 'incomplete_evidence' }),
            );
        }

        expect(hasExplicitRcOperationalClosureEvidence('Riesgo aceptado por: Alin, 2026-07-12.')).toBe(true);
        expect(hasExplicitRcOperationalClosureEvidence('Riesgo aceptado por: Alin, nota: riesgo documentado.')).toBe(true);
        expect(hasExplicitRcOperationalClosureEvidence('Riesgo aceptado por:')).toBe(false);
        expect(hasExplicitRcOperationalClosureEvidence('Riesgo aceptado por: Alin, nota:')).toBe(false);
    });

    it('fails closed for missing rows and for checked rows that still say partial or missing', () => {
        const checkedButPartial = openOperationSection
            .replace('- [ ] Runbook', '- [x] Runbook')
            .replace('Parcial.', 'Evidencia: `outputs/launch-incident-drill/summary.md`. Parcial.');
        expect(collectOpenRcOperationalBlockers(checkedButPartial)).toContainEqual(
            expect.objectContaining({ id: 'incident_simulation', reason: 'incomplete_evidence' }),
        );

        const checkedButMissing = openOperationSection
            .replace('- [ ] Runbook', '- [x] Runbook')
            .replace('Parcial.', 'Evidencia: `outputs/launch-incident-drill/summary.md`; falta cierre humano.');
        expect(collectOpenRcOperationalBlockers(checkedButMissing)).toContainEqual(
            expect.objectContaining({ id: 'incident_simulation', reason: 'incomplete_evidence' }),
        );

        const missingRollback = openOperationSection.replace(
            '- [ ] Proceso de rollback probado. Parcial.\n',
            '',
        );
        expect(collectOpenRcOperationalBlockers(missingRollback)).toContainEqual(
            expect.objectContaining({ id: 'rollback_proof', reason: 'missing' }),
        );
    });

    it('keeps status, RC and secondary review wired to the shared fail-closed parser', () => {
        const status = readFileSync('scripts/launch/status.ts', 'utf8');
        const releaseCandidate = readFileSync('scripts/launch/release-candidate.ts', 'utf8');
        const secondary = readFileSync('scripts/launch/secondary-review.ts', 'utf8');

        expect(RC_OPERATIONAL_BLOCKER_DEFINITIONS.map((definition) => definition.id)).toEqual([
            'incident_simulation',
            'sentry_alerts',
            'rollback_proof',
        ]);
        expect(status).toContain('collectOpenRcOperationalBlockers(checklist)');
        expect(status).toContain('...rcOperationalOpenChecks');
        expect(status).toContain('RC_BLOCKED_BY_RELEASE_CANDIDATE_CHECKS');
        expect(releaseCandidate).toContain('RC_BLOCKED_BY_RELEASE_CANDIDATE_CHECKS');
        expect(secondary).toContain('collectOpenRcOperationalBlockers(checklist)');
        expect(secondary).toContain('hasExplicitRcOperationalClosureEvidence(line)');
        expect(secondary).not.toContain("lower.includes('riesgo aceptado por:')");
        expect(secondary).toContain('release candidate operational blockers');
        expect(secondary).toContain("new Set(['Go/No-Go Blockers', 'Operacion', 'Revision Secundaria'])");
    });
});
