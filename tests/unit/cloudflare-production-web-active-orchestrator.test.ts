import { describe, expect, it, vi } from 'vitest';
import { orchestrateWebActiveTransition } from '../../scripts/launch/cloudflare-production-web-active-orchestrator';

describe('Cloudflare production web active transition orchestrator', () => {
    it('closes only after the active deployment is independently proven', async () => {
        const compensateBootstrap = vi.fn(async () => true);
        const result = await orchestrateWebActiveTransition({
            deployActive: vi.fn(async () => true),
            proveActive: vi.fn(async () => true),
            compensateBootstrap,
        });

        expect(result.status).toBe('ACTIVE_PROVEN');
        expect(result.phases.map((phase) => phase.phase)).toEqual(['deploy_active', 'prove_active']);
        expect(compensateBootstrap).not.toHaveBeenCalled();
    });

    it.each([
        ['provider failure', async () => false],
        ['timeout or thrown state', async () => { throw new Error('timeout'); }],
    ])('compensates after %s during the active deploy', async (_label, deployActive) => {
        const proveActive = vi.fn(async () => true);
        const compensateBootstrap = vi.fn(async () => true);
        const result = await orchestrateWebActiveTransition({
            deployActive,
            proveActive,
            compensateBootstrap,
        });

        expect(result.status).toBe('BOOTSTRAP_COMPENSATED_AND_PROVEN');
        expect(proveActive).not.toHaveBeenCalled();
        expect(compensateBootstrap).toHaveBeenCalledOnce();
        expect(result.phases.at(-1)).toMatchObject({ phase: 'compensate_bootstrap', completed: true });
    });

    it('compensates when the provider succeeded but active readback is ambiguous', async () => {
        const result = await orchestrateWebActiveTransition({
            deployActive: vi.fn(async () => true),
            proveActive: vi.fn(async () => false),
            compensateBootstrap: vi.fn(async () => true),
        });

        expect(result.status).toBe('BOOTSTRAP_COMPENSATED_AND_PROVEN');
        expect(result.phases.map((phase) => phase.phase)).toEqual([
            'deploy_active',
            'prove_active',
            'compensate_bootstrap',
        ]);
    });

    it.each([
        ['failed compensation', async () => false],
        ['thrown compensation', async () => { throw new Error('rollback timeout'); }],
    ])('keeps remote state ambiguous after %s', async (_label, compensateBootstrap) => {
        const result = await orchestrateWebActiveTransition({
            deployActive: vi.fn(async () => true),
            proveActive: vi.fn(async () => false),
            compensateBootstrap,
        });

        expect(result.status).toBe('REMOTE_STATE_AMBIGUOUS');
        expect(result.activeProven).toBe(false);
        expect(result.bootstrapCompensationProven).toBe(false);
    });
});
