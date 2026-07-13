export type WebActiveTransitionStatus =
    | 'ACTIVE_PROVEN'
    | 'BOOTSTRAP_COMPENSATED_AND_PROVEN'
    | 'REMOTE_STATE_AMBIGUOUS';

export type WebActiveTransitionPhase =
    | 'deploy_active'
    | 'prove_active'
    | 'compensate_bootstrap';

export interface WebActiveTransitionHooks {
    deployActive: () => Promise<boolean>;
    proveActive: () => Promise<boolean>;
    compensateBootstrap: () => Promise<boolean>;
}

export interface WebActiveTransitionResult {
    status: WebActiveTransitionStatus;
    phases: Array<{
        phase: WebActiveTransitionPhase;
        completed: boolean;
        error: boolean;
    }>;
    activeProven: boolean;
    bootstrapCompensationProven: boolean;
}

/**
 * Executes the only write-capable web transition in a fail-closed order.
 * Any failed, thrown or ambiguous active result must attempt compensation;
 * only a separately proven bootstrap compensation clears remote ambiguity.
 */
export async function orchestrateWebActiveTransition(
    hooks: WebActiveTransitionHooks,
): Promise<WebActiveTransitionResult> {
    const phases: WebActiveTransitionResult['phases'] = [];
    const activeDeployCompleted = await guardedPhase('deploy_active', hooks.deployActive, phases);
    const activeProven = activeDeployCompleted
        ? await guardedPhase('prove_active', hooks.proveActive, phases)
        : false;

    if (activeProven) {
        return {
            status: 'ACTIVE_PROVEN',
            phases,
            activeProven: true,
            bootstrapCompensationProven: false,
        };
    }

    const bootstrapCompensationProven = await guardedPhase(
        'compensate_bootstrap',
        hooks.compensateBootstrap,
        phases,
    );

    return {
        status: bootstrapCompensationProven
            ? 'BOOTSTRAP_COMPENSATED_AND_PROVEN'
            : 'REMOTE_STATE_AMBIGUOUS',
        phases,
        activeProven: false,
        bootstrapCompensationProven,
    };
}

async function guardedPhase(
    phase: WebActiveTransitionPhase,
    operation: () => Promise<boolean>,
    phases: WebActiveTransitionResult['phases'],
): Promise<boolean> {
    try {
        const completed = await operation();
        phases.push({ phase, completed, error: false });
        return completed;
    } catch {
        phases.push({ phase, completed: false, error: true });
        return false;
    }
}
