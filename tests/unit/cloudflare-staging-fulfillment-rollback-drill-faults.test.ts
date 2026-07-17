import { describe, expect, it } from 'vitest';
import {
    executionLockMayBeReleased,
    orchestrateRollbackDrill,
    phaseProven,
    type PhaseOutcome,
    type RollbackDrillPhase,
} from '../../scripts/launch/cloudflare-staging-fulfillment-rollback-drill-orchestrator';
import {
    createExternalWriteReceipt,
    markExternalWriteAttemptStarted,
    markExternalWriteConfirmed,
    requireReadonlyReconciliation,
} from '../../scripts/launch/external-write-receipt';

const phases: RollbackDrillPhase[] = [
    'disable_cron',
    'normalize_queue_active',
    'pause_queue',
    'verify_isolation',
    'rollback_previous',
    'restore_current',
    'restore_cron',
    'resume_queue',
];

const forwardPhases = new Set<RollbackDrillPhase>([
    'disable_cron',
    'normalize_queue_active',
    'pause_queue',
    'verify_isolation',
    'rollback_previous',
]);

const readOnlyPhases = new Set<RollbackDrillPhase>([
    'verify_isolation',
    'verify_isolation_after_restore_failure',
    'verify_compensated_isolation',
]);

const faultModes = ['provider_failure', 'timeout', 'ambiguous_readback'] as const;
type FaultMode = typeof faultModes[number];

function proven(phase: RollbackDrillPhase): PhaseOutcome {
    const readOnly = readOnlyPhases.has(phase);
    return {
        phase,
        writeAttempted: !readOnly,
        provider: readOnly ? 'not_applicable' : 'succeeded',
        readback: 'proven',
    };
}

function injectedFailure(phase: RollbackDrillPhase, fault: FaultMode): PhaseOutcome {
    if (fault === 'timeout') throw new Error(`timeout:${phase}`);
    const readOnly = readOnlyPhases.has(phase);
    if (fault === 'provider_failure') {
        return {
            phase,
            writeAttempted: !readOnly,
            provider: readOnly ? 'not_applicable' : 'failed',
            readback: 'not_attempted',
            error: `provider failed:${phase}`,
        };
    }
    return {
        phase,
        writeAttempted: !readOnly,
        provider: readOnly ? 'not_applicable' : 'succeeded',
        readback: 'ambiguous',
        error: `readback ambiguous:${phase}`,
    };
}

describe('Cloudflare staging rollback drill fault injection', () => {
    for (const fault of faultModes) {
        it(`fails closed for ${fault} injected at every reachable phase`, async () => {
            for (const injectedPhase of phases) {
                const calls: RollbackDrillPhase[] = [];
                const result = await orchestrateRollbackDrill({
                    async runPhase(phase) {
                        calls.push(phase);
                        if (phase !== injectedPhase) return proven(phase);
                        return injectedFailure(phase, fault);
                    },
                });

                if (forwardPhases.has(injectedPhase)) {
                    expect(result.forwardPathProven, `${fault}:${injectedPhase}`).toBe(false);
                    expect(calls).toEqual(expect.arrayContaining(['restore_current', 'restore_cron', 'resume_queue']));
                    expect(result.restorationProven).toBe(true);
                } else if (injectedPhase === 'restore_current') {
                    expect(result.currentRestored).toBe(false);
                    expect(result.cronRestored).toBe(false);
                    expect(result.queueResumed).toBe(false);
                    expect(result.isolationRetainedOnRestoreFailure).toBe(true);
                    expect(calls).toContain('verify_isolation_after_restore_failure');
                    expect(calls).not.toContain('restore_cron');
                    expect(calls).not.toContain('resume_queue');
                    expect(calls).not.toContain('compensate_disable_cron');
                } else if (injectedPhase === 'restore_cron') {
                    expect(result.currentRestored).toBe(true);
                    expect(result.cronRestored).toBe(false);
                    expect(result.queueResumed).toBe(false);
                    expect(result.restorationProven).toBe(false);
                    expect(result.isolationRetainedOnRestoreFailure).toBe(true);
                    expect(calls).not.toContain('resume_queue');
                    expect(calls).toEqual(expect.arrayContaining([
                        'compensate_disable_cron',
                        'compensate_pause_queue',
                        'verify_compensated_isolation',
                    ]));
                } else {
                    expect(result.currentRestored).toBe(true);
                    expect(result.cronRestored).toBe(false);
                    expect(result.queueResumed).toBe(false);
                    expect(result.restorationProven).toBe(false);
                    expect(result.isolationRetainedOnRestoreFailure).toBe(true);
                    expect(calls).toEqual(expect.arrayContaining([
                        'compensate_disable_cron',
                        'compensate_pause_queue',
                        'verify_compensated_isolation',
                    ]));
                }
                expect(calls.filter((phase) => phase === 'rollback_previous').length, `${fault}:${injectedPhase}`)
                    .toBeLessThanOrEqual(1);
                expect(result.manualReconciliationRequired, `${fault}:${injectedPhase}`).toBe(true);
                expect(executionLockMayBeReleased(result), `${fault}:${injectedPhase}`).toBe(false);
            }
        });
    }

    for (const fault of faultModes) {
        it(`keeps the lock when post-restore-current isolation verification has ${fault}`, async () => {
            const result = await orchestrateRollbackDrill({
                async runPhase(phase) {
                    if (phase === 'restore_current') {
                        return {
                            phase,
                            writeAttempted: true,
                            provider: 'failed',
                            readback: 'failed',
                            error: 'restore prerequisite failure',
                        };
                    }
                    if (phase === 'verify_isolation_after_restore_failure') {
                        return injectedFailure(phase, fault);
                    }
                    return proven(phase);
                },
            });

            expect(result.restorationProven).toBe(false);
            expect(result.isolationRetainedOnRestoreFailure).toBe(false);
            expect(result.manualReconciliationRequired).toBe(true);
            expect(executionLockMayBeReleased(result)).toBe(false);
        });
    }

    it('reports success only when forward path and current/Cron/Queue readbacks are all proven', async () => {
        const calls: RollbackDrillPhase[] = [];
        const result = await orchestrateRollbackDrill({
            async runPhase(phase) {
                calls.push(phase);
                return proven(phase);
            },
        });

        expect(result.forwardPathProven).toBe(true);
        expect(result.restorationProven).toBe(true);
        expect(result.currentRestored).toBe(true);
        expect(result.cronRestored).toBe(true);
        expect(result.queueResumed).toBe(true);
        expect(result.manualReconciliationRequired).toBe(false);
        expect(executionLockMayBeReleased(result)).toBe(true);
        expect(calls).toEqual(phases);
        expect(calls.filter((phase) => phase === 'rollback_previous')).toHaveLength(1);
    });

    for (const fault of faultModes) {
        it(`fails closed for ${fault} in every compensation phase`, async () => {
            for (const compensationFault of [
                'compensate_disable_cron',
                'compensate_pause_queue',
                'verify_compensated_isolation',
            ] as const) {
                const calls: RollbackDrillPhase[] = [];
                const result = await orchestrateRollbackDrill({
                    async runPhase(phase) {
                        calls.push(phase);
                        if (phase === 'resume_queue') {
                            return {
                                phase,
                                writeAttempted: true,
                                provider: 'ambiguous',
                                readback: 'ambiguous',
                                error: 'injected incomplete Queue resume',
                            };
                        }
                        if (phase === compensationFault) {
                            return injectedFailure(phase, fault);
                        }
                        return proven(phase);
                    },
                });

                expect(result.restorationProven, compensationFault).toBe(false);
                expect(result.isolationRetainedOnRestoreFailure, compensationFault).toBe(false);
                expect(result.manualReconciliationRequired, compensationFault).toBe(true);
                expect(executionLockMayBeReleased(result), compensationFault).toBe(false);
                expect(calls).toEqual(expect.arrayContaining([
                    'compensate_disable_cron',
                    'compensate_pause_queue',
                    'verify_compensated_isolation',
                ]));
            }
        });
    }

    it('requires a write receipt for write phases and reserves not_applicable for read-only phases', () => {
        expect(phaseProven({
            phase: 'restore_cron',
            writeAttempted: false,
            provider: 'not_applicable',
            readback: 'proven',
        })).toBe(false);
        expect(phaseProven({
            phase: 'restore_cron',
            writeAttempted: true,
            provider: 'ambiguous',
            readback: 'proven',
        })).toBe(true);
        expect(phaseProven({
            phase: 'verify_compensated_isolation',
            writeAttempted: false,
            provider: 'not_applicable',
            readback: 'proven',
        })).toBe(true);
        expect(phaseProven({
            phase: 'verify_compensated_isolation',
            writeAttempted: true,
            provider: 'succeeded',
            readback: 'proven',
        })).toBe(false);
    });

    it('keeps a write receipt reconciliation-pending until readback confirms the intended state', () => {
        const started = markExternalWriteAttemptStarted(createExternalWriteReceipt());
        expect(started.externalWritePerformed).toBe('unknown');
        expect(started.readonlyReconciliationRequired).toBe(true);

        const providerReturned = requireReadonlyReconciliation(markExternalWriteConfirmed(started, true));
        expect(providerReturned.externalWritePerformed).toBe(true);
        expect(providerReturned.readonlyReconciliationRequired).toBe(true);
        expect(providerReturned.externalWriteOutcome).toBe('confirmed_succeeded_needs_readonly_reconciliation');

        const readbackProven = markExternalWriteConfirmed(providerReturned, true);
        expect(readbackProven.externalWritePerformed).toBe(true);
        expect(readbackProven.readonlyReconciliationRequired).toBe(false);
        expect(readbackProven.externalWriteOutcome).toBe('confirmed_succeeded');
    });
});
