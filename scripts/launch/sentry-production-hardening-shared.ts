import { createHash } from 'node:crypto';

export const SENTRY_PRODUCTION_TARGET = {
    organization: 'honestspanish',
    project: 'espanol-honesto-astro',
    environment: 'production',
} as const;

export const SENTRY_PRODUCTION_HARDENING_APPROVAL_ENV = 'SENTRY_PRODUCTION_HARDENING_APPROVAL';
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
                    comparison: { value: 10, interval: '5min' },
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
    const triggerTypes = recordArray(workflow.triggers.conditions).map((condition) => condition.type).filter(isString).sort();
    const expectedTriggerTypes = definition.triggers.conditions.map((condition) => condition.type).sort();
    if (JSON.stringify(triggerTypes) !== JSON.stringify(expectedTriggerTypes)) return false;
    const actionFilters = recordArray(workflow.actionFilters);
    if (actionFilters.length !== 1) return false;
    const actions = recordArray(actionFilters[0].actions);
    if (actions.length !== 1 || actions[0].type !== 'email' || actions[0].status !== 'active') return false;
    const config = actions[0].config;
    if (!isRecord(config)) return false;
    if (config.targetType !== 'user' || config.targetIdentifier !== definition.actionFilters[0].actions[0].config.targetIdentifier) return false;
    const conditions = recordArray(actionFilters[0].conditions);
    const expectedConditionType = definition.actionFilters[0].conditions[0]?.type;
    return conditions.length === 1 && conditions[0].type === expectedConditionType;
}

function sameStrings(value: unknown, expected: string[]): boolean {
    if (!Array.isArray(value) || !value.every(isString)) return false;
    return JSON.stringify([...value].sort()) === JSON.stringify([...expected].sort());
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
