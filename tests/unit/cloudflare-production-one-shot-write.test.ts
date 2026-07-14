import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    beginOneShotCloudflareWrite,
    closeOneShotCloudflareWriteGuard,
    openOneShotCloudflareWriteGuard,
    recordOneShotCloudflareProviderResult,
    recordOneShotCloudflareReadback,
} from '../../scripts/launch/cloudflare-production-one-shot-write';

const temporaryDirectories: string[] = [];

function workspace(): { root: string; evidence: string } {
    const root = mkdtempSync(path.join(tmpdir(), 'cloudflare-one-shot-write-'));
    temporaryDirectories.push(root);
    const evidence = path.join(root, 'evidence');
    mkdirSync(evidence, { recursive: true });
    vi.spyOn(process, 'cwd').mockReturnValue(root);
    return { root, evidence };
}

afterEach(() => {
    vi.restoreAllMocks();
    for (const directory of temporaryDirectories.splice(0)) {
        rmSync(directory, { recursive: true, force: true });
    }
});

describe('Cloudflare one-shot write guard', () => {
    it('persists write-ahead, requires provider reconciliation and releases only after proven readback', () => {
        const { evidence } = workspace();
        const guard = openOneShotCloudflareWriteGuard('test-scope', evidence);
        let checkpoint = beginOneShotCloudflareWrite(guard, 'provider-write');

        expect(checkpoint.stage).toBe('write_ahead');
        checkpoint = recordOneShotCloudflareProviderResult(guard, checkpoint, {
            exitCode: 0,
            timedOut: false,
            errorPresent: false,
        });
        expect(checkpoint.stage).toBe('provider_succeeded_needs_readback');
        expect(() => closeOneShotCloudflareWriteGuard(guard)).toThrow('unresolved write checkpoints');

        checkpoint = recordOneShotCloudflareReadback(guard, checkpoint, true);
        expect(checkpoint.stage).toBe('readback_proven');
        expect(() => closeOneShotCloudflareWriteGuard(guard)).not.toThrow();
    });

    it('classifies timeout/error as ambiguous and blocks a blind retry', () => {
        const { evidence } = workspace();
        const guard = openOneShotCloudflareWriteGuard('ambiguous-scope', evidence);
        let checkpoint = beginOneShotCloudflareWrite(guard, 'provider-write');
        checkpoint = recordOneShotCloudflareProviderResult(guard, checkpoint, {
            exitCode: null,
            timedOut: true,
            errorPresent: true,
        });

        expect(checkpoint.stage).toBe('provider_outcome_ambiguous');
        expect(checkpoint.receipt.externalWritePerformed).toBe('unknown');
        expect(() => openOneShotCloudflareWriteGuard('ambiguous-scope', evidence)).toThrow(
            'unresolved write checkpoints',
        );
    });
});
