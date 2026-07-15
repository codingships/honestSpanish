export type AvailabilityWriteOutcome =
    | 'not_attempted'
    | 'applied_verified'
    | 'rolled_back_verified'
    | 'ambiguous';

export type AvailabilityWriteClassification = {
    outcome: Exclude<AvailabilityWriteOutcome, 'not_attempted'>;
    externalWritePerformed: boolean | null;
};

export function classifyAvailabilityWriteAttempt(input: {
    applyCommandSucceeded: boolean;
    readbackCommandSucceeded: boolean;
    appliedMismatches: readonly string[];
    rolledBackMismatches: readonly string[];
}): AvailabilityWriteClassification {
    if (!input.readbackCommandSucceeded) {
        return { outcome: 'ambiguous', externalWritePerformed: null };
    }
    if (input.appliedMismatches.length === 0) {
        return { outcome: 'applied_verified', externalWritePerformed: true };
    }
    if (!input.applyCommandSucceeded && input.rolledBackMismatches.length === 0) {
        return { outcome: 'rolled_back_verified', externalWritePerformed: false };
    }
    return { outcome: 'ambiguous', externalWritePerformed: null };
}
