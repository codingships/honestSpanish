import { vi } from 'vitest';

const createQueryChain = (defaultResolve: any = { data: null, error: null }) => {
    const chain: any = {};
    const methods = [
        'select', 'insert', 'update', 'delete', 'upsert',
        'eq', 'neq', 'or', 'gte', 'gt', 'lte', 'lt',
        'order', 'limit', 'range', 'filter', 'is',
    ];
    methods.forEach(m => {
        chain[m] = vi.fn().mockReturnValue(chain);
    });
    chain['in'] = vi.fn().mockReturnValue(chain);
    chain.single = vi.fn().mockResolvedValue(defaultResolve);
    chain.maybeSingle = vi.fn().mockResolvedValue(defaultResolve);
    return chain;
};

// Mock Supabase client factory
export const createMockSupabaseClient = (overrides: any = {}) => {
    const mockUser = {
        id: 'test-user-id',
        email: 'test@example.com',
    };

    const mockProfile = {
        id: 'test-user-id',
        email: 'test@example.com',
        full_name: 'Test User',
        role: 'student',
        stripe_customer_id: null,
    };

    const client = {
        auth: {
            getUser: vi.fn().mockResolvedValue({ data: { user: mockUser }, error: null }),
            signInWithPassword: vi.fn().mockResolvedValue({ data: { user: mockUser }, error: null }),
            signOut: vi.fn().mockResolvedValue({ error: null }),
        },
        from: vi.fn((_table: string) => createQueryChain({ data: mockProfile, error: null })),
        rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
    };

    return { ...client, ...overrides };
};

// Mock for unauthenticated state
export const createUnauthenticatedMockClient = () => {
    return createMockSupabaseClient({
        auth: {
            getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
            signInWithPassword: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
            signOut: vi.fn().mockResolvedValue({ error: null }),
        },
    });
};
