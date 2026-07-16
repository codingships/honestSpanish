import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
    SENTRY_PRODUCTION_WORKFLOW_NAMES,
    analyzeSentryProjectRulesMirror,
    buildSentryProductionHardeningApproval,
    buildSentryProductionRecoveryApproval,
    buildSentryProductionWorkflows,
    buildSentryRecoveryDecision,
    fingerprintSentryId,
    isSentryHardeningRolloutEligible,
    matchReattestedWorkflowOwnership,
    parseSentryExecutionJournal,
    validateSentryHardeningExecutedReceiptAnchor,
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
            comparison: { value: 10, interval: '5m' },
        })]);
    });

    it('validates only the exact returned workflow shape', () => {
        const response = { ...definitions[0], id: 'workflow-id' };
        expect(workflowMatchesDefinition(response, definitions[0])).toBe(true);
        const sentryResponse = {
            ...response,
            organizationId: 'organization-id',
            triggers: {
                ...response.triggers,
                id: 'trigger-id',
                organizationId: 'organization-id',
                conditions: response.triggers.conditions.map((condition, index) => ({
                    ...condition,
                    id: `trigger-condition-${index + 1}`,
                })),
            },
            actionFilters: response.actionFilters.map((actionFilter, filterIndex) => ({
                ...actionFilter,
                id: `action-filter-${filterIndex + 1}`,
                organizationId: 'organization-id',
                conditions: actionFilter.conditions.map((condition, conditionIndex) => ({
                    ...condition,
                    id: `filter-condition-${conditionIndex + 1}`,
                })),
                actions: actionFilter.actions.map((action, actionIndex) => ({
                    ...action,
                    id: `action-${actionIndex + 1}`,
                })),
            })),
        };
        expect(workflowMatchesDefinition(sentryResponse, definitions[0])).toBe(true);
        expect(workflowMatchesDefinition({
            ...sentryResponse,
            triggers: {
                ...sentryResponse.triggers,
                conditions: sentryResponse.triggers.conditions.map((condition, index) => index === 0
                    ? { ...condition, undocumentedSemanticField: true }
                    : condition),
            },
        }, definitions[0])).toBe(false);
        expect(workflowMatchesDefinition({
            ...sentryResponse,
            triggers: {
                ...sentryResponse.triggers,
                conditions: sentryResponse.triggers.conditions.map((condition, index) => index === 0
                    ? { ...condition, id: {} }
                    : condition),
            },
        }, definitions[0])).toBe(false);
        expect(workflowMatchesDefinition({ ...response, environment: null }, definitions[0])).toBe(false);
        expect(workflowMatchesDefinition({ ...response, detectorIds: ['other'] }, definitions[0])).toBe(false);
        expect(workflowMatchesDefinition({ ...response, actionFilters: [] }, definitions[0])).toBe(false);
        expect(workflowMatchesDefinition({
            ...response,
            triggers: {
                ...response.triggers,
                conditions: response.triggers.conditions.map((condition, index) => index === 0
                    ? { ...condition, comparison: false }
                    : condition),
            },
        }, definitions[0])).toBe(false);
        expect(workflowMatchesDefinition({
            ...response,
            triggers: { ...response.triggers, actions: [{ type: 'unexpected_action' }] },
        }, definitions[0])).toBe(false);
        expect(workflowMatchesDefinition({
            ...response,
            actionFilters: [{ ...response.actionFilters[0], logicType: 'any' }],
        }, definitions[0])).toBe(false);
        expect(workflowMatchesDefinition({
            ...response,
            actionFilters: [{
                ...response.actionFilters[0],
                actions: [{
                    ...response.actionFilters[0].actions[0],
                    integrationId: 'unexpected-integration',
                }],
            }],
        }, definitions[0])).toBe(false);
    });

    it('validates the complete 10-events-in-5-minutes spike filter and email action', () => {
        const definition = definitions[1];
        const response = { ...definition, id: 'spike-workflow-id' };
        expect(workflowMatchesDefinition(response, definition)).toBe(true);

        expect(workflowMatchesDefinition({
            ...response,
            actionFilters: [{
                ...response.actionFilters[0],
                conditions: [{
                    ...response.actionFilters[0].conditions[0],
                    comparison: { value: 11, interval: '5m' },
                }],
            }],
        }, definition)).toBe(false);
        expect(workflowMatchesDefinition({
            ...response,
            actionFilters: [{
                ...response.actionFilters[0],
                conditions: [{
                    ...response.actionFilters[0].conditions[0],
                    comparison: { value: 10, interval: '10m' },
                }],
            }],
        }, definition)).toBe(false);
        expect(workflowMatchesDefinition({
            ...response,
            actionFilters: [{
                ...response.actionFilters[0],
                conditions: [{
                    ...response.actionFilters[0].conditions[0],
                    conditionResult: false,
                }],
            }],
        }, definition)).toBe(false);
        expect(workflowMatchesDefinition({
            ...response,
            actionFilters: [{
                ...response.actionFilters[0],
                actions: [{
                    ...response.actionFilters[0].actions[0],
                    status: 'disabled',
                }],
            }],
        }, definition)).toBe(false);
        expect(workflowMatchesDefinition({
            ...response,
            actionFilters: [{
                ...response.actionFilters[0],
                actions: [{
                    ...response.actionFilters[0].actions[0],
                    config: {
                        ...response.actionFilters[0].actions[0].config,
                        targetIdentifier: 'different-owner',
                    },
                }],
            }],
        }, definition)).toBe(false);
    });

    it('treats the deprecated project-rules endpoint as an exact compatibility mirror', () => {
        const mirror = projectRulesMirror(ownerUserId);
        expect(analyzeSentryProjectRulesMirror(mirror, definitions)).toEqual({
            exact: true,
            entryCount: 2,
            unmatchedEntryCount: 0,
        });

        const wrongRecipient = structuredClone(mirror);
        (wrongRecipient[0].actions as Array<Record<string, unknown>>)[0].targetIdentifier = 'another-user';
        expect(analyzeSentryProjectRulesMirror(wrongRecipient, definitions).exact).toBe(false);

        const extraRule = [...mirror, { ...mirror[0], name: 'Unrelated rule' }];
        const extraAnalysis = analyzeSentryProjectRulesMirror(extraRule, definitions);
        expect(extraAnalysis.exact).toBe(false);
        expect(extraAnalysis.unmatchedEntryCount).toBe(1);
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

    it('never treats a workflow discovered only by name as owned after an ambiguous POST', () => {
        const journal = parseSentryExecutionJournal(executionJournal([
            { event: 'workflow_create_intent', workflowName: definitions[0].name },
            {
                event: 'workflow_id_observed',
                workflowName: definitions[0].name,
                workflowId: 'name-only-id',
                source: 'get_reconciliation',
            },
        ]));
        expect(journal.stronglyOwnedWorkflows).toEqual([]);

        const decision = buildSentryRecoveryDecision({
            journal,
            currentWorkflows: [{ id: 'name-only-id', name: definitions[0].name }],
            currentScrubIPAddresses: false,
        });
        expect(decision.deleteWorkflows).toEqual([]);
        expect(decision.manualRecoveryRequired).toBe(true);
        expect(decision.unprovenWorkflowMatches).toEqual([{ name: definitions[0].name, count: 1 }]);
    });

    it('allows recovery deletion only for an id returned directly by the run POST', () => {
        const rawId = 'post-attested-workflow-id';
        const journal = parseSentryExecutionJournal(executionJournal([
            { event: 'workflow_create_intent', workflowName: definitions[0].name },
            {
                event: 'workflow_id_observed',
                workflowName: definitions[0].name,
                workflowId: rawId,
                source: 'post_response',
            },
            { event: 'scrub_ip_enable_intent' },
        ]));
        const decision = buildSentryRecoveryDecision({
            journal,
            currentWorkflows: [{ id: rawId, name: definitions[0].name }],
            currentScrubIPAddresses: true,
        });
        expect(decision.manualRecoveryRequired).toBe(false);
        expect(decision.deleteWorkflows).toEqual([{
            id: rawId,
            name: definitions[0].name,
            idFingerprint: fingerprintSentryId(rawId),
        }]);
        expect(decision.restoreScrubIPAddresses).toBe(true);

        const approval = buildSentryProductionRecoveryApproval(decision);
        expect(approval).toContain(journal.lockFingerprint);
        expect(approval).toContain(decision.remoteSnapshotFingerprint);
        expect(approval).toContain(fingerprintSentryId(rawId));
        expect(approval).not.toContain(rawId);
        expect(approval).toContain('No autorizo borrar workflows descubiertos solo por nombre');
    });

    it('retains the manual boundary when an extra same-name workflow lacks POST ownership', () => {
        const rawId = 'post-attested-workflow-id';
        const journal = parseSentryExecutionJournal(executionJournal([
            { event: 'workflow_create_intent', workflowName: definitions[0].name },
            {
                event: 'workflow_id_observed',
                workflowName: definitions[0].name,
                workflowId: rawId,
                source: 'post_response',
            },
        ]));
        const decision = buildSentryRecoveryDecision({
            journal,
            currentWorkflows: [
                { id: rawId, name: definitions[0].name },
                { id: 'unproven-duplicate', name: definitions[0].name },
            ],
            currentScrubIPAddresses: false,
        });
        expect(decision.deleteWorkflows).toHaveLength(1);
        expect(decision.manualRecoveryRequired).toBe(true);
        expect(decision.unprovenWorkflowMatches).toEqual([{ name: definitions[0].name, count: 1 }]);
    });

    it('never rolls back a journal that already recorded successful hardening readback', () => {
        const rawId = 'post-attested-workflow-id';
        const journal = parseSentryExecutionJournal(executionJournal([
            { event: 'workflow_create_intent', workflowName: definitions[0].name },
            {
                event: 'workflow_id_observed',
                workflowName: definitions[0].name,
                workflowId: rawId,
                source: 'post_response',
            },
            { event: 'hardening_final_readback_verified', stableReadbacks: 2 },
        ]));
        const decision = buildSentryRecoveryDecision({
            journal,
            currentWorkflows: [{ id: rawId, name: definitions[0].name }],
            currentScrubIPAddresses: true,
        });
        expect(journal.hardeningFinalReadbackSeen).toBe(true);
        expect(decision.deleteWorkflows).toEqual([]);
        expect(decision.restoreScrubIPAddresses).toBe(false);
        expect(decision.manualRecoveryRequired).toBe(true);
    });

    it('requires the complete terminal proof before a Sentry artifact is rollout-eligible', () => {
        const base = {
            closureStatus: 'HARDENED_AND_VERIFIED',
            executeRequested: true,
            externalWriteAttempted: true,
            externalWritePerformed: true,
            rollbackAttempted: false,
            createdWorkflowCount: 2,
            terminalProof: {
                stableReadbacks: 2,
                exactWorkflowDefinitionsVerified: true,
                workflowCount: 2,
                legacyIssueRuleCount: 0,
                scrubIPAddresses: true,
                executionLockAbsent: true,
                ambiguousOutcomeOutstanding: false,
                rawIdentifiersPersistedInReports: false as const,
            },
        };
        expect(isSentryHardeningRolloutEligible(base)).toBe(true);
        expect(isSentryHardeningRolloutEligible({
            ...base,
            terminalProof: { ...base.terminalProof, stableReadbacks: 1 },
        })).toBe(false);
        expect(isSentryHardeningRolloutEligible({
            ...base,
            terminalProof: { ...base.terminalProof, executionLockAbsent: false },
        })).toBe(false);
        expect(isSentryHardeningRolloutEligible({
            ...base,
            terminalProof: { ...base.terminalProof, ambiguousOutcomeOutstanding: true },
        })).toBe(false);
        expect(isSentryHardeningRolloutEligible({
            ...base,
            closureStatus: 'REATTESTED_AND_VERIFIED',
            executeRequested: false,
            reattestRequested: true,
            externalWriteAttempted: false,
            externalWritePerformed: false,
            createdWorkflowCount: 0,
        })).toBe(true);
    });

    it('anchors GET-only reattestation to the exact executed receipt and POST-owned workflow ids', () => {
        const receipt = executedReceiptAnchorFixture();
        const validation = validateSentryHardeningExecutedReceiptAnchor(
            receipt,
            new Date('2026-07-16T12:00:00.000Z'),
        );
        expect(validation).toMatchObject({ valid: true, errors: [] });
        const owned = validation.value?.workflowIdFingerprints ?? [];
        const responses = definitions.map((definition, index) => ({
            ...definition,
            id: `workflow-${index + 1}`,
        }));
        expect(matchReattestedWorkflowOwnership(responses, owned)).toBe(true);
        expect(matchReattestedWorkflowOwnership([
            { ...responses[0], id: 'foreign-id' },
            responses[1],
        ], owned)).toBe(false);
        expect(validateSentryHardeningExecutedReceiptAnchor({
            ...receipt,
            endedAt: '2026-07-17T12:00:00.000Z',
        }, new Date('2026-07-16T12:00:00.000Z'))).toMatchObject({ valid: false });
    });

    it('keeps the executable runner exact-gated, GET-first and free of issue/event mutation', () => {
        const source = readFileSync('scripts/launch/sentry-production-hardening.ts', 'utf8');
        expect(source).toContain('SENTRY_PRODUCTION_HARDENING_APPROVAL_ENV');
        expect(source).toContain("value === '--execute-approved'");
        expect(source).toContain("sentryRequest<unknown>('GET', workflowsApiPath()");
        expect(source).toContain("sentryRequest<Record<string, unknown>>('POST', workflowsApiPath()");
        expect(source).toContain('{ scrubIPAddresses: true }');
        expect(source).toContain("sentryRequest<unknown>('DELETE'");
        expect(source).toContain("'.execution-lock.jsonl'");
        expect(source).toContain("openSync(executionLockPath, 'wx')");
        expect(source).toContain('fsyncSync(descriptor)');
        expect(source).toContain("event: 'workflow_create_intent'");
        expect(source).toContain("source: 'post_response'");
        expect(source).not.toContain("rememberCreatedWorkflow(name, id, 'get_reconciliation')");
        expect(source).toContain("value === '--recover-lock'");
        expect(source).toContain("value === '--reattest-existing'");
        expect(source).toContain('validateSentryHardeningExecutedReceiptAnchor');
        expect(source).toContain('matchReattestedWorkflowOwnership');
        expect(source).toContain('SENTRY_PRODUCTION_RECOVERY_APPROVAL_ENV');
        expect(source).toContain('workflow_name_only_match_requires_manual_recovery');
        expect(source).toContain('automatic DELETE is forbidden');
        expect(source).toContain('readStableRelevantWorkflows()');
        expect(source).toContain('workflowAbsenceVerified=true');
        expect(source).toContain('rawIdentifiersPersistedInReports: false');
        expect(source).toContain("artifactKind: 'sentry_production_hardening_receipt'");
        expect(source).toContain('rolloutEligible');
        expect(source).toContain('stableReadbacks');
        expect(source).not.toContain('/issues/');
        expect(source).not.toContain('/events/');
        expect(source).not.toContain('status: \'resolved\'');
    });
});

function executedReceiptAnchorFixture(): Record<string, unknown> {
    const detectorFingerprint = fingerprintSentryId('detector-123');
    const ownerFingerprint = fingerprintSentryId('owner-456');
    const workflowIdFingerprints = Object.values(SENTRY_PRODUCTION_WORKFLOW_NAMES).map((name, index) => ({
        name,
        idFingerprint: fingerprintSentryId(`workflow-${index + 1}`),
        ownershipSource: 'post_response',
    })).sort((left, right) => left.name.localeCompare(right.name));
    const sourceFingerprint = createHash('sha256').update(stableJsonForTest({
        ownershipSource: 'post_response',
        workflowIdFingerprints,
        detectorFingerprint,
        ownerFingerprint,
    }), 'utf8').digest('hex');
    return {
        schemaVersion: 1,
        evidenceContractVersion: 2,
        artifactKind: 'sentry_production_hardening_receipt',
        endedAt: '2026-07-15T12:00:00.000Z',
        status: 'OK',
        closureStatus: 'HARDENED_AND_VERIFIED',
        target: {
            organization: 'honestspanish',
            project: 'espanol-honesto-astro',
            environment: 'production',
        },
        executeRequested: true,
        externalWriteAttempted: true,
        externalWritePerformed: true,
        externalWriteOutcomeAmbiguous: false,
        executionLockRetainedForRecovery: false,
        rollbackAttempted: false,
        createdWorkflowCount: 2,
        detectorFingerprint,
        ownerFingerprint,
        rawIdentifiersPersistedInReports: false,
        terminalProof: {
            stableReadbacks: 2,
            exactWorkflowDefinitionsVerified: true,
            workflowCount: 2,
            legacyIssueRuleCount: 0,
            scrubIPAddresses: true,
            executionLockAbsent: true,
            ambiguousOutcomeOutstanding: false,
            rawIdentifiersPersistedInReports: false,
        },
        evidenceContract: {
            rolloutEligible: true,
            requiredArtifactKind: 'sentry_production_hardening_receipt',
            rawIdentifiersPersistedInReports: false,
        },
        finalizationProof: {
            stateFingerprint: 'a'.repeat(64),
            sourceFingerprint,
            workflowIdFingerprints,
        },
    };
}

function stableJsonForTest(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(stableJsonForTest).join(',')}]`;
    if (!value || typeof value !== 'object') return JSON.stringify(value);
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => (
        `${JSON.stringify(key)}:${stableJsonForTest(record[key])}`
    )).join(',')}}`;
}

function executionJournal(events: Array<Record<string, unknown>>): string {
    return [
        {
            schemaVersion: 1,
            event: 'lock_acquired',
            target: {
                organization: 'honestspanish',
                project: 'espanol-honesto-astro',
                environment: 'production',
            },
            initialScrubIPAddresses: false,
            workflowNames: Object.values(SENTRY_PRODUCTION_WORKFLOW_NAMES),
            detectorFingerprint: 'd'.repeat(64),
            ownerFingerprint: 'e'.repeat(64),
        },
        ...events,
    ].map((event) => JSON.stringify(event)).join('\n') + '\n';
}

function projectRulesMirror(ownerUserId: string): Array<Record<string, unknown>> {
    const action = {
        id: 'sentry.mail.actions.NotifyEmailAction',
        targetType: 'Member',
        targetIdentifier: ownerUserId,
        fallthroughType: 'ActiveMembers',
        name: 'Send an email notification',
    };
    return [
        {
            name: SENTRY_PRODUCTION_WORKFLOW_NAMES.newAndRegressed,
            environment: 'production',
            frequency: 30,
            owner: `user:${ownerUserId}`,
            status: 'active',
            snooze: false,
            projects: ['espanol-honesto-astro'],
            actionMatch: 'any',
            filterMatch: 'all',
            conditions: [
                { id: 'sentry.rules.conditions.first_seen_event.FirstSeenEventCondition', name: 'A new issue is created' },
                { id: 'sentry.rules.conditions.reappeared_event.ReappearedEventCondition', name: 'A resolved issue reappears' },
                { id: 'sentry.rules.conditions.regression_event.RegressionEventCondition', name: 'An issue regresses' },
            ],
            filters: [{
                id: 'sentry.rules.filters.issue_category.IssueCategoryFilter',
                value: '1',
                name: 'The issue category is error',
            }],
            actions: [{ ...action }],
        },
        {
            name: SENTRY_PRODUCTION_WORKFLOW_NAMES.spike,
            environment: 'production',
            frequency: 5,
            owner: `user:${ownerUserId}`,
            status: 'active',
            snooze: false,
            projects: ['espanol-honesto-astro'],
            actionMatch: 'any',
            filterMatch: 'all',
            conditions: [{
                id: 'sentry.rules.conditions.event_frequency.EventFrequencyCondition',
                comparisonType: 'count',
                value: 10,
                interval: '5m',
                name: 'The issue is seen more than 10 times in 5 minutes',
            }],
            filters: [],
            actions: [{ ...action }],
        },
    ];
}
