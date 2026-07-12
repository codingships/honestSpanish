export type ExternalWritePerformed = boolean | 'unknown';

export type ExternalWriteOutcome =
    | 'not_attempted'
    | 'confirmed_succeeded'
    | 'confirmed_failed'
    | 'ambiguous_needs_readonly_reconciliation'
    | 'confirmed_succeeded_needs_readonly_reconciliation';

export interface ExternalWriteReceiptState {
    externalWriteAttempted: boolean;
    externalWritePerformed: ExternalWritePerformed;
    externalWriteOutcome: ExternalWriteOutcome;
    readonlyReconciliationRequired: boolean;
}

export function createExternalWriteReceipt(): ExternalWriteReceiptState {
    return {
        externalWriteAttempted: false,
        externalWritePerformed: false,
        externalWriteOutcome: 'not_attempted',
        readonlyReconciliationRequired: false,
    };
}

/**
 * Call and durably persist this transition immediately before invoking a
 * write-capable provider operation. Until the provider response is
 * classified, the only safe assumption is that the write may have landed.
 */
export function markExternalWriteAttemptStarted(
    current: ExternalWriteReceiptState,
): ExternalWriteReceiptState {
    if (current.externalWriteAttempted) {
        throw new Error('External write receipt already records an attempted write. Reconcile before retrying.');
    }

    return {
        externalWriteAttempted: true,
        externalWritePerformed: 'unknown',
        externalWriteOutcome: 'ambiguous_needs_readonly_reconciliation',
        readonlyReconciliationRequired: true,
    };
}

export function markExternalWriteConfirmed(
    current: ExternalWriteReceiptState,
    performed: boolean,
): ExternalWriteReceiptState {
    assertWriteAttempted(current);
    return {
        externalWriteAttempted: true,
        externalWritePerformed: performed,
        externalWriteOutcome: performed ? 'confirmed_succeeded' : 'confirmed_failed',
        readonlyReconciliationRequired: false,
    };
}

export function markExternalWriteAmbiguous(
    current: ExternalWriteReceiptState,
): ExternalWriteReceiptState {
    assertWriteAttempted(current);
    return {
        externalWriteAttempted: true,
        externalWritePerformed: 'unknown',
        externalWriteOutcome: 'ambiguous_needs_readonly_reconciliation',
        readonlyReconciliationRequired: true,
    };
}

export function requireReadonlyReconciliation(
    current: ExternalWriteReceiptState,
): ExternalWriteReceiptState {
    assertWriteAttempted(current);
    if (current.externalWritePerformed === 'unknown') return markExternalWriteAmbiguous(current);

    return {
        ...current,
        externalWriteOutcome: current.externalWritePerformed
            ? 'confirmed_succeeded_needs_readonly_reconciliation'
            : current.externalWriteOutcome,
        readonlyReconciliationRequired: true,
    };
}

function assertWriteAttempted(current: ExternalWriteReceiptState): void {
    if (!current.externalWriteAttempted) {
        throw new Error('Cannot classify an external write before recording that the write was attempted.');
    }
}
