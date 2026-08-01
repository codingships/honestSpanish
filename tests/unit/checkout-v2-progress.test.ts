import { describe, expect, it, vi } from 'vitest';
import {
    hasUsableCheckoutV2Progress,
    loadCheckoutV2ProgressHistory,
    loadLatestCheckoutV2Progress,
    resolveCheckoutV2AcademicProgress,
} from '../../src/lib/checkout-v2-progress';

const queryWith = (result: { data: unknown; error: unknown }) => {
    const query = {
        select: vi.fn(),
        in: vi.fn(),
        order: vi.fn(),
    };
    query.select.mockReturnValue(query);
    query.in.mockReturnValue(query);
    query.order.mockResolvedValue(result);
    return query;
};

describe('Checkout V2 progress loader', () => {
    it('loads exactly one canonical latest row per requested subscription', async () => {
        const rpc = vi.fn().mockResolvedValue({
            data: [
                { subscription_id: 'sub-1', cycle_number: 2, progress_state: 'ready' },
                { subscription_id: 'sub-2', cycle_number: 1, progress_state: 'pending' },
            ],
            error: null,
        });
        const client = { rpc };

        const result = await loadLatestCheckoutV2Progress(client as never, ['sub-1', 'sub-1', 'sub-2']);

        expect(rpc).toHaveBeenCalledWith('get_checkout_v2_subscriptions_progress', {
            p_subscription_ids: ['sub-1', 'sub-2'],
        });
        expect(result.get('sub-1')?.cycle_number).toBe(2);
        expect(result.get('sub-2')?.progress_state).toBe('pending');
    });

    it('does not query for an empty set', async () => {
        const client = { rpc: vi.fn() };

        await expect(loadLatestCheckoutV2Progress(client as never, [])).resolves.toEqual(new Map());
        expect(client.rpc).not.toHaveBeenCalled();
    });

    it('chunks large rosters so PostgREST cannot truncate a 1000-student read', async () => {
        const rpc = vi.fn().mockImplementation((_, args: { p_subscription_ids: string[] }) => (
            Promise.resolve({
                data: args.p_subscription_ids.map((subscription_id) => ({ subscription_id })),
                error: null,
            })
        ));
        const client = { rpc };
        const ids = Array.from({ length: 1000 }, (_, index) => `sub-${index + 1}`);

        const result = await loadLatestCheckoutV2Progress(client as never, ids);

        expect(rpc).toHaveBeenCalledTimes(2);
        expect(rpc.mock.calls.map((call) => call[1].p_subscription_ids)).toEqual([
            ids.slice(0, 500),
            ids.slice(500),
        ]);
        expect(result.size).toBe(1000);
    });

    it('groups every cycle for history without collapsing renewals', async () => {
        const query = queryWith({
            data: [
                { subscription_id: 'sub-1', cycle_number: 2 },
                { subscription_id: 'sub-1', cycle_number: 1 },
                { subscription_id: 'sub-2', cycle_number: 1 },
            ],
            error: null,
        });
        const client = { from: vi.fn().mockReturnValue(query) };

        const result = await loadCheckoutV2ProgressHistory(client as never, ['sub-1', 'sub-2']);

        expect(result.get('sub-1')?.map((row) => row.cycle_number)).toEqual([2, 1]);
        expect(result.get('sub-2')).toHaveLength(1);
    });

    it('fails closed when the canonical latest-progress read model cannot be read', async () => {
        const client = {
            rpc: vi.fn().mockResolvedValue({ data: null, error: { code: '42501' } }),
        };

        await expect(loadLatestCheckoutV2Progress(client as never, ['sub-1']))
            .rejects.toThrow('checkout_v2_progress_load_failed');
    });

    it('only treats a ready cycle as usable progress', () => {
        expect(hasUsableCheckoutV2Progress({ progress_state: 'ready' } as never)).toBe(true);
        expect(hasUsableCheckoutV2Progress({ progress_state: 'pending' } as never)).toBe(false);
        expect(hasUsableCheckoutV2Progress({ progress_state: 'inconsistent' } as never)).toBe(false);
        expect(hasUsableCheckoutV2Progress(null)).toBe(false);
    });

    it.each([
        { version: 1, progress: null, expected: { state: 'legacy' } },
        { version: 2, progress: null, expected: { state: 'missing' } },
        { version: 2, progress: { progress_state: 'pending' }, expected: { state: 'pending' } },
        {
            version: 2,
            progress: { progress_state: 'ready', sessions_consumed: 2, sessions_total: 4 },
            expected: { state: 'ready', consumed: 2, total: 4 },
        },
        {
            version: 2,
            progress: { progress_state: 'ready', sessions_consumed: null, sessions_total: 4 },
            expected: { state: 'inconsistent' },
        },
        {
            version: 2,
            progress: { progress_state: 'ready', sessions_consumed: 5, sessions_total: 4 },
            expected: { state: 'inconsistent' },
        },
        {
            version: 2,
            progress: { progress_state: 'inconsistent' },
            expected: { state: 'inconsistent' },
        },
    ])('resolves academic presentation truth for $expected.state', ({ version, progress, expected }) => {
        expect(resolveCheckoutV2AcademicProgress(version, progress as never)).toEqual(expected);
    });
});
