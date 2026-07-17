export type RollbackDrillPhase =
    | 'disable_cron'
    | 'normalize_queue_active'
    | 'pause_queue'
    | 'verify_isolation'
    | 'rollback_previous'
    | 'restore_current'
    | 'restore_cron'
    | 'resume_queue'
    | 'verify_isolation_after_restore_failure'
    | 'compensate_disable_cron'
    | 'compensate_pause_queue'
    | 'verify_compensated_isolation';

export type ProviderOutcome = 'not_applicable' | 'succeeded' | 'failed' | 'ambiguous';
export type ReadbackOutcome = 'not_attempted' | 'proven' | 'failed' | 'ambiguous';

export interface PhaseOutcome {
    phase: RollbackDrillPhase;
    writeAttempted: boolean;
    provider: ProviderOutcome;
    readback: ReadbackOutcome;
    error?: string;
}

export interface RollbackDrillDriver {
    runPhase(phase: RollbackDrillPhase): Promise<PhaseOutcome>;
}

export interface RollbackDrillOrchestrationResult {
    outcomes: PhaseOutcome[];
    forwardPathProven: boolean;
    currentRestored: boolean;
    cronRestored: boolean;
    queueResumed: boolean;
    restorationProven: boolean;
    isolationRetainedOnRestoreFailure: boolean;
    manualReconciliationRequired: boolean;
}

const FORWARD_PHASES: RollbackDrillPhase[] = [
    'disable_cron',
    'normalize_queue_active',
    'pause_queue',
    'verify_isolation',
    'rollback_previous',
];

const READ_ONLY_PHASES = new Set<RollbackDrillPhase>([
    'verify_isolation',
    'verify_isolation_after_restore_failure',
    'verify_compensated_isolation',
]);

export async function orchestrateRollbackDrill(
    driver: RollbackDrillDriver,
): Promise<RollbackDrillOrchestrationResult> {
    const outcomes: PhaseOutcome[] = [];
    let forwardPathProven = true;
    let aWriteMayHaveStarted = false;

    for (const phase of FORWARD_PHASES) {
        const outcome = await runSafely(driver, phase);
        outcomes.push(outcome);
        aWriteMayHaveStarted ||= outcome.writeAttempted;
        if (!phaseProven(outcome)) {
            forwardPathProven = false;
            break;
        }
    }

    let currentRestored = false;
    let cronRestored = false;
    let queueResumed = false;
    let isolationRetainedOnRestoreFailure = false;
    if (aWriteMayHaveStarted) {
        const current = await runSafely(driver, 'restore_current');
        outcomes.push(current);
        currentRestored = phaseProven(current);

        if (currentRestored) {
            const cron = await runSafely(driver, 'restore_cron');
            outcomes.push(cron);
            cronRestored = phaseProven(cron);

            if (cronRestored) {
                const queue = await runSafely(driver, 'resume_queue');
                outcomes.push(queue);
                queueResumed = phaseProven(queue);
                if (!queueResumed) {
                    isolationRetainedOnRestoreFailure = await compensateAndVerifyIsolation(driver, outcomes);
                    cronRestored = false;
                }
            } else {
                isolationRetainedOnRestoreFailure = await compensateAndVerifyIsolation(driver, outcomes);
            }
        } else {
            const isolation = await runSafely(driver, 'verify_isolation_after_restore_failure');
            outcomes.push(isolation);
            isolationRetainedOnRestoreFailure = phaseProven(isolation);
        }
    }

    const restorationProven = currentRestored && cronRestored && queueResumed;
    const manualReconciliationRequired = !forwardPathProven || !restorationProven;
    return {
        outcomes,
        forwardPathProven,
        currentRestored,
        cronRestored,
        queueResumed,
        restorationProven,
        isolationRetainedOnRestoreFailure,
        manualReconciliationRequired,
    };
}

export function executionLockMayBeReleased(
    result: Pick<RollbackDrillOrchestrationResult, 'forwardPathProven' | 'restorationProven' | 'manualReconciliationRequired'>,
): boolean {
    return result.forwardPathProven
        && result.restorationProven
        && !result.manualReconciliationRequired;
}

export function phaseProven(outcome: PhaseOutcome): boolean {
    if (READ_ONLY_PHASES.has(outcome.phase)) {
        return !outcome.writeAttempted
            && outcome.provider === 'not_applicable'
            && outcome.readback === 'proven';
    }
    return outcome.writeAttempted
        && (outcome.provider === 'succeeded' || outcome.provider === 'ambiguous')
        && outcome.readback === 'proven';
}

async function compensateAndVerifyIsolation(
    driver: RollbackDrillDriver,
    outcomes: PhaseOutcome[],
): Promise<boolean> {
    const cron = await runSafely(driver, 'compensate_disable_cron');
    outcomes.push(cron);
    const queue = await runSafely(driver, 'compensate_pause_queue');
    outcomes.push(queue);
    const isolation = await runSafely(driver, 'verify_compensated_isolation');
    outcomes.push(isolation);
    return phaseProven(cron)
        && phaseProven(queue)
        && phaseProven(isolation);
}

async function runSafely(
    driver: RollbackDrillDriver,
    phase: RollbackDrillPhase,
): Promise<PhaseOutcome> {
    try {
        const outcome = await driver.runPhase(phase);
        if (outcome.phase !== phase) {
            const readOnly = READ_ONLY_PHASES.has(phase);
            return {
                phase,
                writeAttempted: !readOnly,
                provider: readOnly ? 'not_applicable' : 'ambiguous',
                readback: 'ambiguous',
                error: `Driver returned outcome for ${outcome.phase}.`,
            };
        }
        return outcome;
    } catch (error) {
        const readOnly = READ_ONLY_PHASES.has(phase);
        return {
            phase,
            writeAttempted: !readOnly,
            provider: readOnly ? 'not_applicable' : 'ambiguous',
            readback: 'ambiguous',
            error: error instanceof Error ? error.message : 'Unknown injected phase failure.',
        };
    }
}
