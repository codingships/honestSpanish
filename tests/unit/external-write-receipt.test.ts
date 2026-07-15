import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
    createExternalWriteReceipt,
    markExternalWriteAmbiguous,
    markExternalWriteAttemptStarted,
    markExternalWriteConfirmed,
    requireReadonlyReconciliation,
} from '../../scripts/launch/external-write-receipt';

const read = (filePath: string): string => readFileSync(filePath, 'utf8');

describe('external write receipts', () => {
    it('treats a started but unconfirmed provider call as ambiguous, never as not performed', () => {
        const started = markExternalWriteAttemptStarted(createExternalWriteReceipt());

        expect(started).toEqual({
            externalWriteAttempted: true,
            externalWritePerformed: 'unknown',
            externalWriteOutcome: 'ambiguous_needs_readonly_reconciliation',
            readonlyReconciliationRequired: true,
        });
        expect(markExternalWriteAmbiguous(started)).toEqual(started);
    });

    it('classifies only an explicit provider result as confirmed', () => {
        const started = markExternalWriteAttemptStarted(createExternalWriteReceipt());

        expect(markExternalWriteConfirmed(started, true)).toEqual({
            externalWriteAttempted: true,
            externalWritePerformed: true,
            externalWriteOutcome: 'confirmed_succeeded',
            readonlyReconciliationRequired: false,
        });
        expect(markExternalWriteConfirmed(started, false)).toEqual({
            externalWriteAttempted: true,
            externalWritePerformed: false,
            externalWriteOutcome: 'confirmed_failed',
            readonlyReconciliationRequired: false,
        });
    });

    it('keeps a confirmed write visible when its post-write read-only verification fails', () => {
        const confirmed = markExternalWriteConfirmed(
            markExternalWriteAttemptStarted(createExternalWriteReceipt()),
            true,
        );

        expect(requireReadonlyReconciliation(confirmed)).toEqual({
            externalWriteAttempted: true,
            externalWritePerformed: true,
            externalWriteOutcome: 'confirmed_succeeded_needs_readonly_reconciliation',
            readonlyReconciliationRequired: true,
        });
    });

    it('refuses to classify or repeat a write without the required receipt transition', () => {
        const initial = createExternalWriteReceipt();
        const started = markExternalWriteAttemptStarted(initial);

        expect(() => markExternalWriteConfirmed(initial, true)).toThrow(/before recording that the write was attempted/i);
        expect(() => markExternalWriteAttemptStarted(started)).toThrow(/reconcile before retrying/i);
    });

    it('persists the ambiguous checkpoint before either provider write is awaited', () => {
        const turnstile = read('scripts/launch/turnstile-domain-closure-runner.ts');
        const stripe = read('scripts/launch/stripe-webhook-cutover-runner.ts');

        expect(turnstile).toMatch(
            /externalWriteReceipt = markExternalWriteAttemptStarted\(externalWriteReceipt\);\s+persistExternalWriteReceipt\('put_started_awaiting_provider_confirmation'\);\s+\s*try \{\s+const payload = await cloudflareRequest/,
        );
        expect(stripe).toMatch(
            /persistStripeCutoverWriteAhead[\s\S]*externalWriteReceipt = markExternalWriteAttemptStarted\(externalWriteReceipt\);\s+persistExternalWriteReceipt\('update_started_awaiting_provider_confirmation'\);\s+\s*let updated: Stripe\.WebhookEndpoint;\s+try \{\s+updated = await stripe\.webhookEndpoints\.update/,
        );

        for (const runner of [turnstile, stripe]) {
            expect(runner).toContain("externalWritePerformed: 'unknown'");
            expect(runner).toContain('externalWriteOutcome=ambiguous_needs_readonly_reconciliation');
            expect(runner).toContain('readonlyReconciliationRequired: true');
            expect(runner).toContain('NEEDS_READONLY_RECONCILIATION_OR_ROLLBACK');
            expect(runner).toContain('blocked_until_readonly_reconciliation_and_rollback_decision');
        }

        expect(turnstile).not.toContain('reportCaptures.some((capture) => capture.writesCloudflare');
        expect(stripe).not.toContain('reportCaptures.some((capture) => capture.writesStripe');
    });

    it('documents read-only reconciliation and separate rollback approval before retry', () => {
        const runbook = read('docs/launch/RUNBOOK.md');

        expect(runbook).toContain('externalWriteAttempted=true');
        expect(runbook).toContain('externalWritePerformed=unknown');
        expect(runbook).toContain('externalWriteOutcome=ambiguous_needs_readonly_reconciliation');
        expect(runbook).toContain('No reintentar la escritura.');
        expect(runbook).toContain('rollback con aprobacion independiente');
    });
});
