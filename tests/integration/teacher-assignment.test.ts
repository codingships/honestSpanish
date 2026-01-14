import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockSupabaseClient } from '../mocks/supabase';

/**
 * Integration test for teacher assignment flow:
 * 1. Admin assigns teacher to student
 * 2. Teacher can view assigned students
 * 3. Teacher can update student notes
 * 4. Admin can remove teacher assignment
 */

vi.mock('../../src/lib/supabase-server', () => ({
    createSupabaseServerClient: vi.fn(),
}));

describe('Teacher Assignment Flow Integration', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('Admin Assign Teacher', () => {
        it('should successfully assign teacher to student', async () => {
            const mockSupabase = createMockSupabaseClient();

            // Create a chainable mock that handles all the different query patterns
            const createChainableMock = (finalValue: any) => {
                const chain: any = {};
                chain.select = vi.fn().mockReturnValue(chain);
                chain.insert = vi.fn().mockResolvedValue({ error: null });
                chain.update = vi.fn().mockReturnValue(chain);
                chain.delete = vi.fn().mockReturnValue(chain);
                chain.eq = vi.fn().mockReturnValue(chain);
                chain.neq = vi.fn().mockResolvedValue({ error: null });
                chain.single = vi.fn().mockResolvedValue(finalValue);
                return chain;
            };

            mockSupabase.from = vi.fn().mockImplementation((table) => {
                if (table === 'profiles') {
                    return createChainableMock({ data: { role: 'admin' }, error: null });
                }
                if (table === 'student_teachers') {
                    // Return null for existing check (so it goes to insert path)
                    return createChainableMock({ data: null, error: null });
                }
                return createChainableMock({ data: null, error: null });
            });

            const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
            vi.mocked(createSupabaseServerClient).mockReturnValue(mockSupabase as any);

            const mockRequest = {
                json: vi.fn().mockResolvedValue({
                    studentId: 'student-123',
                    teacherId: 'teacher-456',
                    isPrimary: true,
                }),
            };

            const mockContext = {
                request: mockRequest,
                cookies: { set: vi.fn() },
            };

            const { POST } = await import('../../src/pages/api/admin/assign-teacher');
            const response = await POST(mockContext as any);

            expect(response.status).toBe(200);
        });
    });

    describe('Teacher Access Student Notes', () => {
        it('should allow teacher to update notes for assigned student', async () => {
            const mockSupabase = createMockSupabaseClient();

            const createChainableMock = (finalValue: any) => {
                const chain: any = {};
                chain.select = vi.fn().mockReturnValue(chain);
                chain.update = vi.fn().mockReturnValue(chain);
                chain.eq = vi.fn().mockReturnValue(chain);
                chain.single = vi.fn().mockResolvedValue(finalValue);
                return chain;
            };

            let profileCallCount = 0;
            mockSupabase.from = vi.fn().mockImplementation((table) => {
                if (table === 'profiles') {
                    profileCallCount++;
                    if (profileCallCount === 1) {
                        // First call: get role
                        return createChainableMock({ data: { role: 'teacher' }, error: null });
                    } else {
                        // Second call: update notes
                        const chain = createChainableMock({ data: null, error: null });
                        chain.eq = vi.fn().mockResolvedValue({ error: null });
                        return chain;
                    }
                }
                if (table === 'student_teachers') {
                    return createChainableMock({ data: { id: 'assignment-1' }, error: null });
                }
                return createChainableMock({ data: null, error: null });
            });

            const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
            vi.mocked(createSupabaseServerClient).mockReturnValue(mockSupabase as any);

            const mockRequest = {
                json: vi.fn().mockResolvedValue({
                    studentId: 'student-123',
                    notes: 'Updated notes for this student',
                }),
            };

            const mockContext = {
                request: mockRequest,
                cookies: { set: vi.fn() },
            };

            const { POST } = await import('../../src/pages/api/update-student-notes');
            const response = await POST(mockContext as any);

            expect(response.status).toBe(200);
        });

        it('should deny teacher from updating notes for unassigned student', async () => {
            const mockSupabase = createMockSupabaseClient();

            const createChainableMock = (finalValue: any) => {
                const chain: any = {};
                chain.select = vi.fn().mockReturnValue(chain);
                chain.eq = vi.fn().mockReturnValue(chain);
                chain.single = vi.fn().mockResolvedValue(finalValue);
                return chain;
            };

            mockSupabase.from = vi.fn().mockImplementation((table) => {
                if (table === 'profiles') {
                    return createChainableMock({ data: { role: 'teacher' }, error: null });
                }
                if (table === 'student_teachers') {
                    // No assignment found
                    return createChainableMock({ data: null, error: null });
                }
                return createChainableMock({ data: null, error: null });
            });

            const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
            vi.mocked(createSupabaseServerClient).mockReturnValue(mockSupabase as any);

            const mockRequest = {
                json: vi.fn().mockResolvedValue({
                    studentId: 'unassigned-student',
                    notes: 'Should not be allowed',
                }),
            };

            const mockContext = {
                request: mockRequest,
                cookies: { set: vi.fn() },
            };

            const { POST } = await import('../../src/pages/api/update-student-notes');
            const response = await POST(mockContext as any);

            expect(response.status).toBe(403);
        });
    });

    describe('Admin Remove Teacher', () => {
        it('should successfully remove teacher assignment', async () => {
            const mockSupabase = createMockSupabaseClient();

            const createChainableMock = (finalValue: any) => {
                const chain: any = {};
                chain.select = vi.fn().mockReturnValue(chain);
                chain.delete = vi.fn().mockReturnValue(chain);
                chain.eq = vi.fn().mockReturnValue(chain);
                chain.single = vi.fn().mockResolvedValue(finalValue);
                return chain;
            };

            mockSupabase.from = vi.fn().mockImplementation((table) => {
                if (table === 'profiles') {
                    return createChainableMock({ data: { role: 'admin' }, error: null });
                }
                if (table === 'student_teachers') {
                    const chain = createChainableMock({ data: null, error: null });
                    chain.eq = vi.fn().mockReturnValue({
                        eq: vi.fn().mockResolvedValue({ error: null }),
                    });
                    return chain;
                }
                return createChainableMock({ data: null, error: null });
            });

            const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
            vi.mocked(createSupabaseServerClient).mockReturnValue(mockSupabase as any);

            const mockRequest = {
                json: vi.fn().mockResolvedValue({
                    studentId: 'student-123',
                    teacherId: 'teacher-456',
                }),
            };

            const mockContext = {
                request: mockRequest,
                cookies: { set: vi.fn() },
            };

            const { POST } = await import('../../src/pages/api/admin/remove-teacher');
            const response = await POST(mockContext as any);

            expect(response.status).toBe(200);
        });
    });
});
