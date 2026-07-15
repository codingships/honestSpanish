import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
    beginStripeCutoverRecovery,
    finishStripeCutoverRecovery,
    markStripeCutoverProviderResult,
    openStripeCutoverExecutionGuard,
    persistStripeCutoverWriteAhead,
    readStripeCutoverState,
    releaseStripeCutoverPrewriteGuard,
    resolveStripeCutoverExecution,
    stripeCutoverScopeHash,
} from '../../scripts/launch/stripe-webhook-cutover-state';

const accountId = 'acct_test_expected_account_12345';
const endpointId = 'we_test_full_endpoint_identifier_12345';
const accountIdSha256 = sha256(accountId);
const endpointIdSha256 = sha256(endpointId);
const scopeHash = stripeCutoverScopeHash(accountIdSha256, endpointIdSha256);
const priorUrl = 'https://legacy.example.com/api/stripe-webhook';
const targetUrl = 'https://staging.espanolhonesto.com/api/stripe-webhook';
const events = ['checkout.session.completed', 'invoice.paid'];

describe('Stripe webhook cutover persistent state', () => {
    it('persists write-ahead state before provider outcome and retains immutable resolved evidence', () => {
        withStateRoot((stateRoot) => {
            const guard = openStripeCutoverExecutionGuard(scopeHash, randomUUID(), { stateRoot });
            const writeAhead = persistStripeCutoverWriteAhead(guard, intent());
            expect(writeAhead.phase).toBe('write_ahead');

            const provider = markStripeCutoverProviderResult(guard, writeAhead, 'succeeded');
            const resolved = resolveStripeCutoverExecution(guard, provider, 'resolved_target');
            expect(resolved.phase).toBe('resolved_target');
            expect(readStripeCutoverState(scopeHash, { stateRoot })?.phase).toBe('resolved_target');

            const allEvidence = readAllFiles(stateRoot);
            expect(allEvidence).not.toContain(accountId);
            expect(allEvidence).not.toContain(endpointId);
            expect(allEvidence).toContain(accountIdSha256);
            expect(allEvidence).toContain(endpointIdSha256);
            expect((allEvidence.match(/"revision":/gu) ?? [])).toHaveLength(3);
        });
    });

    it.each([
        ['resolved_target', targetUrl],
        ['resolved_previous', priorUrl],
    ] as const)('uses one GET-only recovery to resolve %s and makes recovery terminal', (expected, url) => {
        withStateRoot((stateRoot) => {
            const guard = openStripeCutoverExecutionGuard(scopeHash, randomUUID(), {
                stateRoot,
                ownerPid: 424242,
                ownerHost: 'test-host',
            });
            const pending = persistStripeCutoverWriteAhead(guard, intent());
            markStripeCutoverProviderResult(guard, pending, 'ambiguous');

            const recovery = beginStripeCutoverRecovery(scopeHash, randomUUID(), {
                stateRoot,
                ownerHost: 'test-host',
                livenessProbe: () => 'dead',
            });
            expect(recovery.status).toBe('readback_required');
            if (recovery.status !== 'readback_required') throw new Error('expected recovery session');

            const result = finishStripeCutoverRecovery(recovery.session, observation(url));
            expect(result).toMatchObject({ status: expected, terminal: true });
            expect(readStripeCutoverState(scopeHash, { stateRoot })?.phase).toBe(expected);

            const next = openStripeCutoverExecutionGuard(scopeHash, randomUUID(), { stateRoot });
            releaseStripeCutoverPrewriteGuard(next);
        });
    });

    it('keeps the guard blocked when GET proves neither prior nor target state', () => {
        withStateRoot((stateRoot) => {
            const guard = openStripeCutoverExecutionGuard(scopeHash, randomUUID(), {
                stateRoot,
                ownerPid: 424242,
                ownerHost: 'test-host',
            });
            persistStripeCutoverWriteAhead(guard, intent());
            const recovery = beginStripeCutoverRecovery(scopeHash, randomUUID(), {
                stateRoot,
                ownerHost: 'test-host',
                livenessProbe: () => 'dead',
            });
            if (recovery.status !== 'readback_required') throw new Error('expected recovery session');

            const result = finishStripeCutoverRecovery(
                recovery.session,
                observation('https://other.example.com/api/stripe-webhook'),
            );
            expect(result).toMatchObject({ status: 'ambiguous', terminal: true });
            expect(readStripeCutoverState(scopeHash, { stateRoot })?.phase).toBe('provider_outcome_ambiguous');
            expect(() => openStripeCutoverExecutionGuard(scopeHash, randomUUID(), { stateRoot }))
                .toThrow(/unresolved write-ahead state/u);
        });
    });

    it('fails closed when lock liveness is alive or unknown', () => {
        withStateRoot((stateRoot) => {
            const guard = openStripeCutoverExecutionGuard(scopeHash, randomUUID(), {
                stateRoot,
                ownerPid: 424242,
                ownerHost: 'test-host',
            });
            persistStripeCutoverWriteAhead(guard, intent());

            const alive = beginStripeCutoverRecovery(scopeHash, randomUUID(), {
                stateRoot,
                ownerHost: 'test-host',
                livenessProbe: () => 'alive',
            });
            expect(alive.status).toBe('blocked');

            const unknown = beginStripeCutoverRecovery(scopeHash, randomUUID(), {
                stateRoot,
                ownerHost: 'test-host',
                livenessProbe: () => 'unknown',
            });
            expect(unknown.status).toBe('blocked');
        });
    });
});

function intent() {
    return {
        accountIdSha256,
        endpointIdSha256,
        priorUrl,
        targetUrl,
        enabledEvents: events,
        approvalSentenceSha256: sha256('approved sentence'),
    };
}

function observation(url: string) {
    return {
        url,
        livemode: false,
        status: 'enabled',
        enabledEvents: events,
    };
}

function withStateRoot(run: (stateRoot: string) => void): void {
    const stateRoot = mkdtempSync(path.join(tmpdir(), 'stripe-cutover-state-'));
    try {
        run(stateRoot);
    } finally {
        rmSync(stateRoot, { recursive: true, force: true });
    }
}

function readAllFiles(root: string): string {
    const chunks: string[] = [];
    for (const entry of readdirSync(root)) {
        const absolute = path.join(root, entry);
        if (statSync(absolute).isDirectory()) chunks.push(readAllFiles(absolute));
        else chunks.push(readFileSync(absolute, 'utf8'));
    }
    return chunks.join('\n');
}

function sha256(value: string): string {
    return createHash('sha256').update(value, 'utf8').digest('hex');
}
