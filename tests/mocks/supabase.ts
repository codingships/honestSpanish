import { vi } from 'vitest';

// Mock Supabase client factory
export const createMockSupabaseClient = (overrides = {}) => {
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

    return {
        auth: {
            getUser: vi.fn().mockResolvedValue({ data: { user: mockUser }, error: null }),
            signInWithPassword: vi.fn().mockResolvedValue({ data: { user: mockUser }, error: null }),
            signOut: vi.fn().mockResolvedValue({ error: null }),
        },
        from: vi.fn((table: string) => ({
            select: vi.fn().mockReturnThis(),
            insert: vi.fn().mockReturnThis(),
            update: vi.fn().mockReturnThis(),
            delete: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            or: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ data: mockProfile, error: null }),
        })),
        ...overrides,
    };
};

// Mock for unauthenticated state
export const createUnauthenticatedMockClient = () => {
    return createMockSupabaseClient({
        auth: {
            getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
        },
    });
};
