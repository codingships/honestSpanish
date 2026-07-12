export const RC_OPERATIONAL_BLOCKER_DEFINITIONS = [
    {
        id: 'incident_simulation',
        label: 'Runbook validado con un incidente simulado.',
    },
    {
        id: 'sentry_alerts',
        label: 'Sentry alerts configuradas.',
    },
    {
        id: 'rollback_proof',
        label: 'Proceso de rollback probado.',
    },
] as const;

export type RcOperationalBlockerId = typeof RC_OPERATIONAL_BLOCKER_DEFINITIONS[number]['id'];

export interface RcOperationalBlocker {
    id: RcOperationalBlockerId;
    line: string;
    reason: 'unchecked' | 'missing' | 'incomplete_evidence';
}

export function collectOpenRcOperationalBlockers(markdown: string): RcOperationalBlocker[] {
    const operationLines = sectionLines(markdown, '## Operacion');
    const blockers: RcOperationalBlocker[] = [];

    for (const definition of RC_OPERATIONAL_BLOCKER_DEFINITIONS) {
        const line = operationLines.find((candidate) => candidate.includes(definition.label));
        if (!line) {
            blockers.push({
                id: definition.id,
                line: `- [ ] ${definition.label} (missing from ## Operacion)`,
                reason: 'missing',
            });
            continue;
        }

        if (/^\s*- \[[xX]\]/.test(line)) {
            const hasClosureEvidence = hasExplicitRcOperationalClosureEvidence(line);
            const remainsIncomplete = /\bParcial\b/iu.test(line)
                || /\bfalta\b/iu.test(line);

            if (hasClosureEvidence && !remainsIncomplete) continue;

            blockers.push({
                id: definition.id,
                line: line.trim(),
                reason: 'incomplete_evidence',
            });
            continue;
        }

        blockers.push({
            id: definition.id,
            line: line.trim(),
            reason: 'unchecked',
        });
    }

    return blockers;
}

export function hasExplicitRcOperationalClosureEvidence(line: string): boolean {
    const evidence = line.match(/\bEvidencia\s*:\s*(.*)$/iu)?.[1]?.trim() ?? '';
    if (/[\p{L}\p{N}`]/u.test(evidence)) return true;

    const acceptedRisk = line.match(/\bRiesgo aceptado por\s*:\s*(.*)$/iu)?.[1]?.trim() ?? '';
    if (!acceptedRisk) return false;

    const dateMatch = acceptedRisk.match(
        /\b(?:fecha\s*:\s*)?(?:\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{4})\b/iu,
    );
    const noteMatch = acceptedRisk.match(/\bnota\s*:\s*[\p{L}\p{N}].*$/iu);
    const dateOrNoteIndex = [dateMatch?.index, noteMatch?.index]
        .filter((index): index is number => typeof index === 'number')
        .sort((left, right) => left - right)[0] ?? -1;
    if (dateOrNoteIndex <= 0) return false;

    const owner = acceptedRisk.slice(0, dateOrNoteIndex).replace(/[\s,;(\[]+$/gu, '').trim();
    return /[\p{L}\p{N}]/u.test(owner);
}

function sectionLines(markdown: string, heading: string): string[] {
    const lines = markdown.split(/\r?\n/);
    const start = lines.findIndex((line) => line.trim() === heading);
    if (start === -1) return [];

    const output: string[] = [];
    for (let index = start + 1; index < lines.length; index += 1) {
        const line = lines[index];
        if (/^##\s+/.test(line)) break;
        output.push(line);
    }
    return output;
}
