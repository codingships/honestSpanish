import { describe, expect, it } from 'vitest';
import { classifyAvailabilityWriteAttempt } from '../../scripts/launch/availability-write-recovery-shared';

describe('availability write recovery', () => {
    it('accepts an exact applied readback even when the apply command response was lost', () => {
        expect(classifyAvailabilityWriteAttempt({
            applyCommandSucceeded: false,
            readbackCommandSucceeded: true,
            appliedMismatches: [],
            rolledBackMismatches: ['target_count: expected 0, observed 5'],
        })).toEqual({ outcome: 'applied_verified', externalWritePerformed: true });
    });

    it('reports false only when a failed apply is followed by an exact empty readback', () => {
        expect(classifyAvailabilityWriteAttempt({
            applyCommandSucceeded: false,
            readbackCommandSucceeded: true,
            appliedMismatches: ['target_count: expected 5, observed 0'],
            rolledBackMismatches: [],
        })).toEqual({ outcome: 'rolled_back_verified', externalWritePerformed: false });
    });

    it.each([
        {
            applyCommandSucceeded: true,
            readbackCommandSucceeded: true,
            appliedMismatches: ['target_count: expected 5, observed 0'],
            rolledBackMismatches: [],
        },
        {
            applyCommandSucceeded: false,
            readbackCommandSucceeded: false,
            appliedMismatches: ['readback command failed'],
            rolledBackMismatches: ['readback command failed'],
        },
        {
            applyCommandSucceeded: false,
            readbackCommandSucceeded: true,
            appliedMismatches: ['target_count drift'],
            rolledBackMismatches: ['unexpected_count drift'],
        },
    ])('keeps contradictory or incomplete readback ambiguous', (input) => {
        expect(classifyAvailabilityWriteAttempt(input)).toEqual({
            outcome: 'ambiguous',
            externalWritePerformed: null,
        });
    });
});
