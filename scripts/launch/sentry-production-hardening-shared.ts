import { createHash } from 'node:crypto';

export const SENTRY_PRODUCTION_TARGET = {
    organization: 'honestspanish',
    project: 'espanol-honesto-astro',
    environment: 'production',
} as const;

export const SENTRY_PRODUCTION_HARDENING_APPROVAL_ENV = 'SENTRY_PRODUCTION_HARDENING_APPROVAL';
export const SENTRY_PRODUCTION_RECOVERY_APPROVAL_ENV = 'SENTRY_PRODUCTION_RECOVERY_APPROVAL';
export const SENTRY_PRODUCTION_WORKFLOW_NAMES = {
    newAndRegressed: 'EH Production - New and regressed errors',
    spike: 'EH Production - Error spike 10 events in 5 minutes',
} as const;

export interface SentryWorkflowDefinition {
    name: string;
    enabled: true;
    detectorIds: string[];
    config: { frequency: number };
    environment: 'production';
    triggers: {
        logicType: 'any-short';
        conditions: Array<{
            type: string;
            comparison: true;
            conditionResult: true;
        }>;
        actions: [];
    };
    actionFilters: Array<{
        logicType: 'all';
        conditions: Array<Record<string, unknown>>;
        actions: Array<{
            type: 'email';
            integrationId: null;
            data: Record<string, never>;
            config: {
                targetType: 'user';
                targetDisplay: null;
                targetIdentifier: string;
            };
            status: 'active';
        }>;
    }>;
    owner: string;
}

export interface SentryExecutionJournalState {
    lockFingerprint: string;
    initialScrubIPAddresses: boolean;
    workflowNames: string[];
    detectorFingerprint: string;
    ownerFingerprint: string;
    attemptedWorkflowNames: string[];
    stronglyOwnedWorkflows: Array<{ name: string; id: string }>;
    scrubIpEnableIntentSeen: boolean;
    hardeningFinalReadbackSeen: boolean;
}

export interface SentryRecoveryDecision {
    lockFingerprint: string;
    remoteSnapshotFingerprint: string;
    deleteWorkflows: Array<{ name: string; id: string; idFingerprint: string }>;
    restoreScrubIPAddresses: boolean;
    initialScrubIPAddresses: boolean;
    unprovenWorkflowMatches: Array<{ name: string; count: number }>;
    hardeningFinalReadbackSeen: boolean;
    manualRecoveryRequired: boolean;
    terminalWithoutExternalWrites: boolean;
}

export interface SentryHardeningTerminalProof {
    stableReadbacks: number;
    exactWorkflowDefinitionsVerified: boolean;
    workflowCount: number;
    legacyIssueRuleCount: number;
    scrubIPAddresses: boolean;
    executionLockAbsent: boolean;
    ambiguousOutcomeOutstanding: boolean;
    rawIdentifiersPersistedInReports: false;
}

export interface SentryExecutedReceiptAnchor {
    endedAt: string;
    detectorFingerprint: string;
    ownerFingerprint: string;
    workflowIdFingerprints: Array<{
        name: string;
        idFingerprint: string;
        ownershipSource: 'post_response';
    }>;
}

export interface SentryFinalizationPendingState {
    schemaVersion: 1;
    artifactKind: 'sentry_production_hardening_finalization_pending';
    createdAt: string;
    runStartedAt: string;
    outputDirectoryName: string;
    target: typeof SENTRY_PRODUCTION_TARGET;
    lockFingerprint: string;
    sourceFingerprint: string;
    detectorFingerprint: string;
    ownerFingerprint: string;
    workflowIdFingerprints: Array<{
        name: string;
        idFingerprint: string;
        ownershipSource: 'post_response';
    }>;
    externalWriteAttempted: true;
    externalWritePerformed: true;
    terminalProof: Omit<SentryHardeningTerminalProof, 'executionLockAbsent'>;
    expectedChanges: {
        scrubIPAddresses: true;
        workflows: string[];
        environment: 'production';
        actions: 'email to exact organization owner';
        spikeThreshold: '10 events in 5 minutes';
    };
    stateFingerprint: string;
}

export function buildSentryProductionWorkflows(input: {
    detectorId: string;
    ownerUserId: string;
}): SentryWorkflowDefinition[] {
    const common = {
        enabled: true as const,
        detectorIds: [input.detectorId],
        environment: SENTRY_PRODUCTION_TARGET.environment,
        owner: `user:${input.ownerUserId}`,
    };
    const emailAction = {
        type: 'email' as const,
        integrationId: null,
        data: {},
        config: {
            targetType: 'user' as const,
            targetDisplay: null,
            targetIdentifier: input.ownerUserId,
        },
        status: 'active' as const,
    };

    return [
        {
            ...common,
            name: SENTRY_PRODUCTION_WORKFLOW_NAMES.newAndRegressed,
            config: { frequency: 30 },
            triggers: {
                logicType: 'any-short',
                conditions: [
                    { type: 'first_seen_event', comparison: true, conditionResult: true },
                    { type: 'reappeared_event', comparison: true, conditionResult: true },
                    { type: 'regression_event', comparison: true, conditionResult: true },
                ],
                actions: [],
            },
            actionFilters: [{
                logicType: 'all',
                conditions: [{
                    type: 'issue_category',
                    comparison: { value: 1 },
                    conditionResult: true,
                }],
                actions: [emailAction],
            }],
        },
        {
            ...common,
            name: SENTRY_PRODUCTION_WORKFLOW_NAMES.spike,
            config: { frequency: 5 },
            triggers: {
                logicType: 'any-short',
                conditions: [],
                actions: [],
            },
            actionFilters: [{
                logicType: 'all',
                conditions: [{
                    type: 'event_frequency_count',
                    comparison: { value: 10, interval: '5m' },
                    conditionResult: true,
                }],
                actions: [emailAction],
            }],
        },
    ];
}

export function buildSentryProductionHardeningApproval(input: {
    detectorFingerprint: string;
    ownerFingerprint: string;
}): string {
    return `Autorizo en Sentry \`${SENTRY_PRODUCTION_TARGET.organization}/${SENTRY_PRODUCTION_TARGET.project}\` habilitar unicamente el scrubbing de direcciones IP y crear exactamente los workflows activos \`${SENTRY_PRODUCTION_WORKFLOW_NAMES.newAndRegressed}\` y \`${SENTRY_PRODUCTION_WORKFLOW_NAMES.spike}\`, limitados al entorno \`${SENTRY_PRODUCTION_TARGET.environment}\`, conectados al unico detector de errores con huella SHA-256 \`${input.detectorFingerprint}\` y con email al unico owner cuya huella SHA-256 es \`${input.ownerFingerprint}\`; autorizo verificar el resultado y, solo si la ejecucion falla, borrar exclusivamente los workflows creados en esa misma ejecucion y restaurar el valor anterior de scrub IP. No autorizo cambiar incidencias, eventos, otros proyectos, miembros, integraciones, releases, DSN, tokens ni ningun otro servicio externo.`;
}

export function parseSentryExecutionJournal(contents: string): SentryExecutionJournalState {
    const records = contents
        .split(/\r?\n/gu)
        .filter((line) => line.trim().length > 0)
        .map((line, index) => {
            let parsed: unknown;
            try {
                parsed = JSON.parse(line);
            } catch {
                throw new Error(`Sentry execution journal line ${index + 1} is not valid JSON.`);
            }
            if (!isRecord(parsed)) throw new Error(`Sentry execution journal line ${index + 1} is not an object.`);
            return parsed;
        });
    const first = records[0];
    if (!first || first.event !== 'lock_acquired' || first.schemaVersion !== 1) {
        throw new Error('Sentry execution journal does not start with the supported lock record.');
    }
    if (!isRecord(first.target)
        || first.target.organization !== SENTRY_PRODUCTION_TARGET.organization
        || first.target.project !== SENTRY_PRODUCTION_TARGET.project
        || first.target.environment !== SENTRY_PRODUCTION_TARGET.environment) {
        throw new Error('Sentry execution journal target does not match the exact production project.');
    }
    if (typeof first.initialScrubIPAddresses !== 'boolean') {
        throw new Error('Sentry execution journal is missing the initial scrub-IP value.');
    }
    const expectedNames = Object.values(SENTRY_PRODUCTION_WORKFLOW_NAMES);
    const workflowNames = stringArray(first.workflowNames);
    if (stableJson([...workflowNames].sort()) !== stableJson([...expectedNames].sort())) {
        throw new Error('Sentry execution journal workflow scope does not match the exact hardening scope.');
    }
    if (!isSha256(first.detectorFingerprint) || !isSha256(first.ownerFingerprint)) {
        throw new Error('Sentry execution journal detector/owner fingerprints are invalid.');
    }

    const allowedNames = new Set(workflowNames);
    const attempted = new Set<string>();
    const stronglyOwned = new Map<string, string>();
    let scrubIpEnableIntentSeen = false;
    let hardeningFinalReadbackSeen = false;
    for (const record of records.slice(1)) {
        if (record.event === 'scrub_ip_enable_intent') scrubIpEnableIntentSeen = true;
        if (record.event === 'hardening_final_readback_verified') hardeningFinalReadbackSeen = true;
        if (record.event === 'workflow_create_intent') {
            const name = requiredScopedWorkflowName(record.workflowName, allowedNames);
            attempted.add(name);
        }
        if (record.event === 'workflow_id_observed') {
            const name = requiredScopedWorkflowName(record.workflowName, allowedNames);
            if (record.source !== 'post_response') continue;
            if (!attempted.has(name)) {
                throw new Error(`Sentry execution journal records ownership before create intent for ${name}.`);
            }
            const id = typeof record.workflowId === 'string' ? record.workflowId.trim() : '';
            if (!id) throw new Error(`Sentry execution journal has an invalid POST-attested workflow id for ${name}.`);
            const existing = stronglyOwned.get(name);
            if (existing && existing !== id) {
                throw new Error(`Sentry execution journal has conflicting POST-attested workflow ids for ${name}.`);
            }
            stronglyOwned.set(name, id);
        }
    }

    return {
        lockFingerprint: createHash('sha256').update(contents, 'utf8').digest('hex'),
        initialScrubIPAddresses: first.initialScrubIPAddresses,
        workflowNames,
        detectorFingerprint: first.detectorFingerprint,
        ownerFingerprint: first.ownerFingerprint,
        attemptedWorkflowNames: [...attempted],
        stronglyOwnedWorkflows: [...stronglyOwned].map(([name, id]) => ({ name, id })),
        scrubIpEnableIntentSeen,
        hardeningFinalReadbackSeen,
    };
}

export function buildSentryRecoveryDecision(input: {
    journal: SentryExecutionJournalState;
    currentWorkflows: Array<Record<string, unknown>>;
    currentScrubIPAddresses: boolean;
}): SentryRecoveryDecision {
    const stronglyOwnedById = new Map(input.journal.stronglyOwnedWorkflows.map((workflow) => [workflow.id, workflow]));
    const attemptedNames = new Set(input.journal.attemptedWorkflowNames);
    const deleteWorkflowsById = new Map<string, { name: string; id: string; idFingerprint: string }>();
    for (const workflow of input.currentWorkflows) {
        const id = typeof workflow.id === 'string' || typeof workflow.id === 'number' ? String(workflow.id) : '';
        const owned = stronglyOwnedById.get(id);
        if (owned && !input.journal.hardeningFinalReadbackSeen) {
            deleteWorkflowsById.set(id, { ...owned, idFingerprint: fingerprintSentryId(id) });
        }
    }
    const deleteWorkflows = [...deleteWorkflowsById.values()];
    const ownedPresentIds = new Set(deleteWorkflows.map((workflow) => workflow.id));
    const unprovenCounts = new Map<string, number>();
    for (const workflow of input.currentWorkflows) {
        const name = typeof workflow.name === 'string' ? workflow.name : '';
        if (!attemptedNames.has(name)) continue;
        const id = typeof workflow.id === 'string' || typeof workflow.id === 'number' ? String(workflow.id) : '';
        if (id && ownedPresentIds.has(id)) continue;
        unprovenCounts.set(name, (unprovenCounts.get(name) ?? 0) + 1);
    }
    const unprovenWorkflowMatches = [...unprovenCounts].map(([name, count]) => ({ name, count }));
    const restoreScrubIPAddresses = !input.journal.hardeningFinalReadbackSeen
        && input.journal.scrubIpEnableIntentSeen
        && input.currentScrubIPAddresses !== input.journal.initialScrubIPAddresses;
    const remoteSnapshotFingerprint = createHash('sha256').update(stableJson({
        lockFingerprint: input.journal.lockFingerprint,
        currentScrubIPAddresses: input.currentScrubIPAddresses,
        stronglyOwnedPresent: deleteWorkflows.map((workflow) => ({
            name: workflow.name,
            idFingerprint: workflow.idFingerprint,
        })).sort((a, b) => a.name.localeCompare(b.name)),
        unprovenWorkflowMatches: [...unprovenWorkflowMatches].sort((a, b) => a.name.localeCompare(b.name)),
        hardeningFinalReadbackSeen: input.journal.hardeningFinalReadbackSeen,
    }), 'utf8').digest('hex');
    const manualRecoveryRequired = unprovenWorkflowMatches.length > 0 || input.journal.hardeningFinalReadbackSeen;
    return {
        lockFingerprint: input.journal.lockFingerprint,
        remoteSnapshotFingerprint,
        deleteWorkflows,
        restoreScrubIPAddresses,
        initialScrubIPAddresses: input.journal.initialScrubIPAddresses,
        unprovenWorkflowMatches,
        hardeningFinalReadbackSeen: input.journal.hardeningFinalReadbackSeen,
        manualRecoveryRequired,
        terminalWithoutExternalWrites: !manualRecoveryRequired
            && deleteWorkflows.length === 0
            && !restoreScrubIPAddresses,
    };
}

export function buildSentryProductionRecoveryApproval(decision: SentryRecoveryDecision): string {
    const workflowScope = decision.deleteWorkflows.length === 0
        ? 'ningun workflow'
        : decision.deleteWorkflows
            .map((workflow) => `\`${workflow.name}\` (id SHA-256 \`${workflow.idFingerprint}\`)`)
            .join(' y ');
    const scrubScope = decision.restoreScrubIPAddresses
        ? `restaurar scrub IP a \`${String(decision.initialScrubIPAddresses)}\``
        : 'no cambiar scrub IP';
    return `Autorizo recuperar el lock de Sentry \`${SENTRY_PRODUCTION_TARGET.organization}/${SENTRY_PRODUCTION_TARGET.project}\` con huella SHA-256 \`${decision.lockFingerprint}\` y snapshot remoto SHA-256 \`${decision.remoteSnapshotFingerprint}\`: borrar exclusivamente ${workflowScope}, acreditado(s) por el id devuelto directamente por el POST de esta ejecucion, ${scrubScope}, verificar por GET estable el estado terminal y eliminar el lock local solo despues de esa verificacion. No autorizo borrar workflows descubiertos solo por nombre, cambiar incidencias o eventos, ni tocar otros proyectos, miembros, integraciones, releases, DSN, tokens o servicios externos.`;
}

export function isSentryHardeningRolloutEligible(input: {
    closureStatus: string;
    executeRequested: boolean;
    reattestRequested?: boolean;
    externalWriteAttempted: boolean;
    externalWritePerformed: boolean;
    rollbackAttempted: boolean;
    createdWorkflowCount: number;
    terminalProof: SentryHardeningTerminalProof;
}): boolean {
    const proof = input.terminalProof;
    const executedHardening = input.closureStatus === 'HARDENED_AND_VERIFIED'
        && input.executeRequested
        && !input.reattestRequested
        && input.externalWriteAttempted
        && input.externalWritePerformed
        && input.createdWorkflowCount === 2;
    const getOnlyReattestation = input.closureStatus === 'REATTESTED_AND_VERIFIED'
        && input.reattestRequested === true
        && !input.executeRequested
        && !input.externalWriteAttempted
        && !input.externalWritePerformed
        && input.createdWorkflowCount === 0;
    return (executedHardening || getOnlyReattestation)
        && !input.rollbackAttempted
        && proof.stableReadbacks >= 2
        && proof.exactWorkflowDefinitionsVerified
        && proof.workflowCount === 2
        && proof.legacyIssueRuleCount === 0
        && proof.scrubIPAddresses
        && proof.executionLockAbsent
        && !proof.ambiguousOutcomeOutstanding
        && proof.rawIdentifiersPersistedInReports === false;
}

export function validateSentryHardeningExecutedReceiptAnchor(
    raw: unknown,
    now = new Date(),
): { valid: boolean; errors: string[]; value: SentryExecutedReceiptAnchor | null } {
    if (!isRecord(raw)) return { valid: false, errors: ['Source Sentry receipt must be a JSON object.'], value: null };
    const errors: string[] = [];
    const target = isRecord(raw.target) ? raw.target : {};
    const evidenceContract = isRecord(raw.evidenceContract) ? raw.evidenceContract : {};
    const terminalProof = isRecord(raw.terminalProof) ? raw.terminalProof : {};
    const finalizationProof = isRecord(raw.finalizationProof) ? raw.finalizationProof : {};
    const workflowEntries = Array.isArray(finalizationProof.workflowIdFingerprints)
        ? finalizationProof.workflowIdFingerprints.filter(isRecord)
        : [];
    const expectedNames = Object.values(SENTRY_PRODUCTION_WORKFLOW_NAMES).sort();
    const observedNames = workflowEntries.map((entry) => String(entry.name ?? '')).sort();

    if (raw.schemaVersion !== 1
        || raw.evidenceContractVersion !== 2
        || raw.artifactKind !== 'sentry_production_hardening_receipt'
        || raw.status !== 'OK'
        || raw.closureStatus !== 'HARDENED_AND_VERIFIED') {
        errors.push('Source Sentry receipt is not an executed HARDENED_AND_VERIFIED v2 receipt.');
    }
    if (target.organization !== SENTRY_PRODUCTION_TARGET.organization
        || target.project !== SENTRY_PRODUCTION_TARGET.project
        || target.environment !== SENTRY_PRODUCTION_TARGET.environment) {
        errors.push('Source Sentry receipt target mismatch.');
    }
    if (raw.executeRequested !== true
        || raw.externalWriteAttempted !== true
        || raw.externalWritePerformed !== true
        || raw.externalWriteOutcomeAmbiguous !== false
        || raw.executionLockRetainedForRecovery !== false
        || raw.rollbackAttempted !== false
        || raw.createdWorkflowCount !== 2
        || raw.rawIdentifiersPersistedInReports !== false
        || evidenceContract.rolloutEligible !== true
        || evidenceContract.requiredArtifactKind !== 'sentry_production_hardening_receipt'
        || evidenceContract.rawIdentifiersPersistedInReports !== false) {
        errors.push('Source Sentry receipt does not prove the exact successful write run.');
    }
    if (!Number.isSafeInteger(terminalProof.stableReadbacks)
        || Number(terminalProof.stableReadbacks) < 2
        || terminalProof.exactWorkflowDefinitionsVerified !== true
        || terminalProof.workflowCount !== 2
        || terminalProof.legacyIssueRuleCount !== 0
        || terminalProof.scrubIPAddresses !== true
        || terminalProof.executionLockAbsent !== true
        || terminalProof.ambiguousOutcomeOutstanding !== false
        || terminalProof.rawIdentifiersPersistedInReports !== false) {
        errors.push('Source Sentry receipt terminal proof is incomplete.');
    }
    if (!isSha256(raw.detectorFingerprint) || !isSha256(raw.ownerFingerprint)) {
        errors.push('Source Sentry detector/owner fingerprints are invalid.');
    }
    if (!isSha256(finalizationProof.stateFingerprint)
        || !isSha256(finalizationProof.sourceFingerprint)
        || workflowEntries.length !== 2
        || stableJson(observedNames) !== stableJson(expectedNames)
        || new Set(workflowEntries.map((entry) => entry.idFingerprint)).size !== 2
        || workflowEntries.some((entry) => (
            !isSha256(entry.idFingerprint) || entry.ownershipSource !== 'post_response'
        ))) {
        errors.push('Source Sentry receipt lacks exact POST-owned workflow fingerprints.');
    }
    const normalizedWorkflowEntries = workflowEntries.map((entry) => ({
        name: String(entry.name),
        idFingerprint: String(entry.idFingerprint),
        ownershipSource: entry.ownershipSource,
    })).sort((left, right) => left.name.localeCompare(right.name));
    const expectedSourceFingerprint = createHash('sha256').update(stableJson({
        ownershipSource: 'post_response',
        workflowIdFingerprints: normalizedWorkflowEntries,
        detectorFingerprint: raw.detectorFingerprint,
        ownerFingerprint: raw.ownerFingerprint,
    }), 'utf8').digest('hex');
    if (finalizationProof.sourceFingerprint !== expectedSourceFingerprint) {
        errors.push('Source Sentry receipt ownership fingerprint mismatch.');
    }
    const endedAt = typeof raw.endedAt === 'string' ? Date.parse(raw.endedAt) : Number.NaN;
    if (!Number.isFinite(endedAt)) errors.push('Source Sentry receipt endedAt is invalid.');
    else if (endedAt > now.getTime() + 5 * 60 * 1_000) errors.push('Source Sentry receipt is timestamped in the future.');

    const value = errors.length === 0 ? {
        endedAt: String(raw.endedAt),
        detectorFingerprint: String(raw.detectorFingerprint),
        ownerFingerprint: String(raw.ownerFingerprint),
        workflowIdFingerprints: normalizedWorkflowEntries.map((entry) => ({
            name: String(entry.name),
            idFingerprint: String(entry.idFingerprint),
            ownershipSource: 'post_response' as const,
        })).sort((left, right) => left.name.localeCompare(right.name)),
    } : null;
    return { valid: errors.length === 0, errors, value };
}

export function matchReattestedWorkflowOwnership(
    workflows: Array<Record<string, unknown>>,
    expected: SentryExecutedReceiptAnchor['workflowIdFingerprints'],
): boolean {
    if (workflows.length !== expected.length) return false;
    const observed = workflows.map((workflow) => ({
        name: typeof workflow.name === 'string' ? workflow.name : '',
        idFingerprint: fingerprintSentryId(
            typeof workflow.id === 'string' || typeof workflow.id === 'number' ? String(workflow.id) : '',
        ),
        ownershipSource: 'post_response' as const,
    })).sort((left, right) => left.name.localeCompare(right.name));
    return stableJson(observed) === stableJson(expected);
}

export function buildSentryFinalizationPendingState(input: {
    createdAt: string;
    runStartedAt: string;
    outputDirectoryName: string;
    lockFingerprint: string;
    detectorFingerprint: string;
    ownerFingerprint: string;
    workflowIdsByName: Array<{ name: string; id: string }>;
    terminalProof: Omit<SentryHardeningTerminalProof, 'executionLockAbsent'>;
}): SentryFinalizationPendingState {
    const workflowIdFingerprints = input.workflowIdsByName
        .map((workflow) => ({
            name: workflow.name,
            idFingerprint: fingerprintSentryId(workflow.id),
            ownershipSource: 'post_response' as const,
        }))
        .sort((left, right) => left.name.localeCompare(right.name));
    const sourceFingerprint = createHash('sha256').update(stableJson({
        ownershipSource: 'post_response',
        workflowIdFingerprints,
        detectorFingerprint: input.detectorFingerprint,
        ownerFingerprint: input.ownerFingerprint,
    }), 'utf8').digest('hex');
    const withoutStateFingerprint = {
        schemaVersion: 1 as const,
        artifactKind: 'sentry_production_hardening_finalization_pending' as const,
        createdAt: input.createdAt,
        runStartedAt: input.runStartedAt,
        outputDirectoryName: input.outputDirectoryName,
        target: SENTRY_PRODUCTION_TARGET,
        lockFingerprint: input.lockFingerprint,
        sourceFingerprint,
        detectorFingerprint: input.detectorFingerprint,
        ownerFingerprint: input.ownerFingerprint,
        workflowIdFingerprints,
        externalWriteAttempted: true as const,
        externalWritePerformed: true as const,
        terminalProof: input.terminalProof,
        expectedChanges: {
            scrubIPAddresses: true as const,
            workflows: Object.values(SENTRY_PRODUCTION_WORKFLOW_NAMES),
            environment: 'production' as const,
            actions: 'email to exact organization owner' as const,
            spikeThreshold: '10 events in 5 minutes' as const,
        },
    };
    return {
        ...withoutStateFingerprint,
        stateFingerprint: createHash('sha256').update(stableJson(withoutStateFingerprint), 'utf8').digest('hex'),
    };
}

export function parseSentryFinalizationPendingState(contents: string): SentryFinalizationPendingState {
    let parsed: unknown;
    try {
        parsed = JSON.parse(contents);
    } catch {
        throw new Error('Sentry finalization pending state is not valid JSON.');
    }
    if (!isRecord(parsed)) throw new Error('Sentry finalization pending state is not an object.');
    const workflowEntries = Array.isArray(parsed.workflowIdFingerprints)
        ? parsed.workflowIdFingerprints.filter(isRecord)
        : [];
    const terminalProof = isRecord(parsed.terminalProof) ? parsed.terminalProof : {};
    const expectedChanges = isRecord(parsed.expectedChanges) ? parsed.expectedChanges : {};
    const exactNames = Object.values(SENTRY_PRODUCTION_WORKFLOW_NAMES).sort();
    const workflowNames = workflowEntries.map((entry) => String(entry.name ?? '')).sort();
    const valid = parsed.schemaVersion === 1
        && parsed.artifactKind === 'sentry_production_hardening_finalization_pending'
        && isRecord(parsed.target)
        && stableJson(parsed.target) === stableJson(SENTRY_PRODUCTION_TARGET)
        && typeof parsed.createdAt === 'string'
        && !Number.isNaN(Date.parse(parsed.createdAt))
        && typeof parsed.runStartedAt === 'string'
        && !Number.isNaN(Date.parse(parsed.runStartedAt))
        && typeof parsed.outputDirectoryName === 'string'
        && /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/u.test(parsed.outputDirectoryName)
        && isSha256(parsed.lockFingerprint)
        && isSha256(parsed.sourceFingerprint)
        && isSha256(parsed.detectorFingerprint)
        && isSha256(parsed.ownerFingerprint)
        && workflowEntries.length === 2
        && stableJson(workflowNames) === stableJson(exactNames)
        && new Set(workflowEntries.map((entry) => entry.idFingerprint)).size === 2
        && workflowEntries.every((entry) => (
            isSha256(entry.idFingerprint) && entry.ownershipSource === 'post_response'
        ))
        && parsed.externalWriteAttempted === true
        && parsed.externalWritePerformed === true
        && Number.isSafeInteger(terminalProof.stableReadbacks)
        && Number(terminalProof.stableReadbacks) >= 2
        && terminalProof.exactWorkflowDefinitionsVerified === true
        && terminalProof.workflowCount === 2
        && terminalProof.legacyIssueRuleCount === 0
        && terminalProof.scrubIPAddresses === true
        && terminalProof.ambiguousOutcomeOutstanding === false
        && terminalProof.rawIdentifiersPersistedInReports === false
        && expectedChanges.scrubIPAddresses === true
        && stableJson(expectedChanges.workflows) === stableJson(Object.values(SENTRY_PRODUCTION_WORKFLOW_NAMES))
        && expectedChanges.environment === 'production'
        && expectedChanges.actions === 'email to exact organization owner'
        && expectedChanges.spikeThreshold === '10 events in 5 minutes'
        && isSha256(parsed.stateFingerprint);
    if (!valid) throw new Error('Sentry finalization pending state violates the exact v1 contract.');

    const value = parsed as unknown as SentryFinalizationPendingState;
    const expectedSourceFingerprint = createHash('sha256').update(stableJson({
        ownershipSource: 'post_response',
        workflowIdFingerprints: value.workflowIdFingerprints,
        detectorFingerprint: value.detectorFingerprint,
        ownerFingerprint: value.ownerFingerprint,
    }), 'utf8').digest('hex');
    const { stateFingerprint, ...withoutStateFingerprint } = value;
    const expectedStateFingerprint = createHash('sha256')
        .update(stableJson(withoutStateFingerprint), 'utf8')
        .digest('hex');
    if (value.sourceFingerprint !== expectedSourceFingerprint || stateFingerprint !== expectedStateFingerprint) {
        throw new Error('Sentry finalization pending state fingerprint mismatch.');
    }
    return value;
}

export function fingerprintSentryId(value: string): string {
    return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function workflowMatchesDefinition(
    workflow: Record<string, unknown>,
    definition: SentryWorkflowDefinition,
): boolean {
    if (workflow.name !== definition.name || workflow.enabled !== true || workflow.environment !== definition.environment) return false;
    if (!sameStrings(workflow.detectorIds, definition.detectorIds)) return false;
    if (workflow.owner !== definition.owner) return false;
    if (!isRecord(workflow.config) || workflow.config.frequency !== definition.config.frequency) return false;
    if (!isRecord(workflow.triggers)) return false;
    if (workflow.triggers.logicType !== definition.triggers.logicType) return false;
    if (!sameSentryConditionRecords(workflow.triggers.conditions, definition.triggers.conditions)) return false;
    if (!sameStructuredRecords(workflow.triggers.actions, definition.triggers.actions)) return false;
    const actionFilters = recordArray(workflow.actionFilters);
    if (actionFilters.length !== 1) return false;
    if (actionFilters[0].logicType !== definition.actionFilters[0].logicType) return false;
    const actions = recordArray(actionFilters[0].actions);
    if (actions.length !== 1 || !actionMatchesDefinition(actions[0], definition.actionFilters[0].actions[0])) return false;
    return sameSentryConditionRecords(actionFilters[0].conditions, definition.actionFilters[0].conditions);
}

export function analyzeSentryProjectRulesMirror(
    rules: Array<Record<string, unknown>>,
    definitions: SentryWorkflowDefinition[],
): { exact: boolean; entryCount: number; unmatchedEntryCount: number } {
    const expected = definitions.map(buildProjectRuleMirrorProjection);
    if (expected.some((projection) => projection === null)) {
        return { exact: false, entryCount: rules.length, unmatchedEntryCount: rules.length };
    }
    const unmatchedRuleIndexes = new Set(rules.map((_rule, index) => index));
    let everyDefinitionMatchedOnce = true;
    for (const projection of expected as Array<Record<string, unknown>>) {
        const matches = [...unmatchedRuleIndexes].filter((index) => (
            projectRuleMatchesProjection(rules[index] as Record<string, unknown>, projection)
        ));
        if (matches.length !== 1) {
            everyDefinitionMatchedOnce = false;
            continue;
        }
        unmatchedRuleIndexes.delete(matches[0] as number);
    }
    return {
        exact: everyDefinitionMatchedOnce
            && rules.length === definitions.length
            && unmatchedRuleIndexes.size === 0,
        entryCount: rules.length,
        unmatchedEntryCount: unmatchedRuleIndexes.size,
    };
}

function buildProjectRuleMirrorProjection(definition: SentryWorkflowDefinition): Record<string, unknown> | null {
    if (definition.actionFilters.length !== 1 || definition.actionFilters[0].actions.length !== 1) return null;
    const ownerId = definition.owner.startsWith('user:') ? definition.owner.slice('user:'.length) : '';
    const emailAction = definition.actionFilters[0].actions[0];
    if (!ownerId
        || emailAction.type !== 'email'
        || emailAction.config.targetType !== 'user'
        || emailAction.config.targetIdentifier !== ownerId) return null;

    const conditions: Array<Record<string, unknown>> = [];
    const filters: Array<Record<string, unknown>> = [];
    for (const condition of definition.triggers.conditions) {
        const translated = translateProjectRuleCondition(condition);
        if (!translated || translated.kind !== 'condition') return null;
        conditions.push(translated.value);
    }
    for (const condition of definition.actionFilters[0].conditions) {
        const translated = translateProjectRuleCondition(condition);
        if (!translated) return null;
        (translated.kind === 'condition' ? conditions : filters).push(translated.value);
    }

    return {
        name: definition.name,
        environment: definition.environment,
        frequency: definition.config.frequency,
        owner: definition.owner,
        status: 'active',
        snooze: false,
        projects: [SENTRY_PRODUCTION_TARGET.project],
        actionMatch: definition.triggers.logicType === 'any-short' ? 'any' : definition.triggers.logicType,
        filterMatch: definition.actionFilters[0].logicType,
        conditions,
        filters,
        actions: [{
            id: 'sentry.mail.actions.NotifyEmailAction',
            targetType: 'Member',
            targetIdentifier: ownerId,
            fallthroughType: 'ActiveMembers',
        }],
    };
}

function translateProjectRuleCondition(condition: Record<string, unknown>): {
    kind: 'condition' | 'filter';
    value: Record<string, unknown>;
} | null {
    switch (condition.type) {
        case 'first_seen_event':
            return {
                kind: 'condition',
                value: { id: 'sentry.rules.conditions.first_seen_event.FirstSeenEventCondition' },
            };
        case 'reappeared_event':
            return {
                kind: 'condition',
                value: { id: 'sentry.rules.conditions.reappeared_event.ReappearedEventCondition' },
            };
        case 'regression_event':
            return {
                kind: 'condition',
                value: { id: 'sentry.rules.conditions.regression_event.RegressionEventCondition' },
            };
        case 'issue_category': {
            const comparison = isRecord(condition.comparison) ? condition.comparison : {};
            return Number.isSafeInteger(comparison.value)
                ? {
                    kind: 'filter',
                    value: {
                        id: 'sentry.rules.filters.issue_category.IssueCategoryFilter',
                        value: String(comparison.value),
                    },
                }
                : null;
        }
        case 'event_frequency_count': {
            const comparison = isRecord(condition.comparison) ? condition.comparison : {};
            return Number.isSafeInteger(comparison.value) && comparison.interval === '5m'
                ? {
                    kind: 'condition',
                    value: {
                        id: 'sentry.rules.conditions.event_frequency.EventFrequencyCondition',
                        comparisonType: 'count',
                        value: comparison.value,
                        interval: comparison.interval,
                    },
                }
                : null;
        }
        default:
            return null;
    }
}

function projectRuleMatchesProjection(rule: Record<string, unknown>, expected: Record<string, unknown>): boolean {
    for (const key of [
        'name',
        'environment',
        'frequency',
        'owner',
        'status',
        'snooze',
        'actionMatch',
        'filterMatch',
    ]) {
        if (rule[key] !== expected[key]) return false;
    }
    if (!sameStrings(rule.projects, expected.projects as string[])) return false;
    return sameProjectRuleRecords(rule.conditions, expected.conditions as Array<Record<string, unknown>>)
        && sameProjectRuleRecords(rule.filters, expected.filters as Array<Record<string, unknown>>)
        && sameProjectRuleRecords(rule.actions, expected.actions as Array<Record<string, unknown>>);
}

function sameProjectRuleRecords(value: unknown, expected: Array<Record<string, unknown>>): boolean {
    if (!Array.isArray(value) || !value.every(isRecord) || value.length !== expected.length) return false;
    const normalized = value.map((record) => {
        const allowedKeys = new Set([...Object.keys(expected.find((candidate) => candidate.id === record.id) ?? {}), 'name']);
        if (Object.keys(record).some((key) => !allowedKeys.has(key))) return null;
        if (typeof record.name !== 'string' || record.name.trim().length === 0) return null;
        return Object.fromEntries(Object.entries(record).filter(([key]) => key !== 'name'));
    });
    if (normalized.some((record) => record === null)) return false;
    return stableJson((normalized as Array<Record<string, unknown>>).sort(compareStableRecords))
        === stableJson([...expected].sort(compareStableRecords));
}

function compareStableRecords(left: Record<string, unknown>, right: Record<string, unknown>): number {
    return stableJson(left).localeCompare(stableJson(right));
}

function sameStrings(value: unknown, expected: string[]): boolean {
    if (!Array.isArray(value) || !value.every(isString)) return false;
    return JSON.stringify([...value].sort()) === JSON.stringify([...expected].sort());
}

function sameStructuredRecords(value: unknown, expected: Array<Record<string, unknown>>): boolean {
    const records = recordArray(value);
    if (records.length !== expected.length) return false;
    return stableJson(records) === stableJson(expected);
}

function sameSentryConditionRecords(value: unknown, expected: Array<Record<string, unknown>>): boolean {
    const records = recordArray(value);
    if (records.length !== expected.length) return false;
    return records.every((record, index) => {
        const expectedRecord = expected[index];
        if (!expectedRecord) return false;
        const allowedKeys = new Set([...Object.keys(expectedRecord), 'id']);
        if (Object.keys(record).some((key) => !allowedKeys.has(key))) return false;
        if ('id' in record && !isSentryResponseId(record.id)) return false;
        const semanticRecord = Object.fromEntries(
            Object.entries(record).filter(([key]) => key !== 'id'),
        );
        return stableJson(semanticRecord) === stableJson(expectedRecord);
    });
}

function isSentryResponseId(value: unknown): boolean {
    return (typeof value === 'string' && value.trim().length > 0)
        || (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0);
}

function stringArray(value: unknown): string[] {
    return Array.isArray(value) && value.every(isString) ? value : [];
}

function requiredScopedWorkflowName(value: unknown, allowed: Set<string>): string {
    if (typeof value !== 'string' || !allowed.has(value)) {
        throw new Error('Sentry execution journal contains a workflow outside the exact hardening scope.');
    }
    return value;
}

function isSha256(value: unknown): value is string {
    return typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
}

function actionMatchesDefinition(value: Record<string, unknown>, expected: SentryWorkflowDefinition['actionFilters'][number]['actions'][number]): boolean {
    if (value.type !== expected.type
        || value.integrationId !== expected.integrationId
        || value.status !== expected.status) return false;
    if (!isRecord(value.data) || stableJson(value.data) !== stableJson(expected.data)) return false;
    if (!isRecord(value.config)) return false;
    return stableJson(value.config) === stableJson(expected.config);
}

function stableJson(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
    if (!isRecord(value)) return JSON.stringify(value);
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
}

function recordArray(value: unknown): Array<Record<string, unknown>> {
    return Array.isArray(value) ? value.filter(isRecord) : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
    return typeof value === 'string';
}
