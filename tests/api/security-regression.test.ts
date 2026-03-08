/**
 * Security Regression Tests
 * 
 * These tests verify that the security fixes from the audit are in place
 * and won't be accidentally undone by future changes.
 * 
 * Each test corresponds to a specific audit finding (C-x, H-x).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockSupabaseClient } from '../mocks/supabase';

// ─── Mocks ───────────────────────────────────────────────────────────
vi.mock('../../src/lib/supabase-server', () => ({
    createSupabaseServerClient: vi.fn(),
}));

vi.mock('../../src/lib/supabase-admin', () => ({
    createSupabaseAdminClient: vi.fn(() => ({
        from: vi.fn().mockReturnValue({
            update: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            gt: vi.fn().mockResolvedValue({ error: null }),
        }),
    })),
}));

vi.mock('../../src/lib/google/calendar', () => ({
    cancelClassEvent: vi.fn().mockResolvedValue(undefined),
    checkTeacherAvailability: vi.fn(),
}));

vi.mock('../../src/lib/email', () => ({
    sendClassCancelledToBoth: vi.fn().mockResolvedValue(undefined),
}));

// ─── Helpers ─────────────────────────────────────────────────────────
const makePostContext = (body: Record<string, unknown> = {}) => ({
    request: {
        json: vi.fn().mockResolvedValue(body),
        headers: { get: vi.fn().mockReturnValue('') },
        url: 'http://localhost:4321/api/test',
        method: 'POST',
    },
    cookies: { set: vi.fn(), get: vi.fn() },
});

const makeGetContext = (path: string, searchParams: Record<string, string> = {}) => {
    const url = new URL(`http://localhost:4321${path}`);
    Object.entries(searchParams).forEach(([k, v]) => url.searchParams.set(k, v));
    return {
        request: {
            url: url.toString(),
            headers: { get: vi.fn().mockReturnValue('') },
            method: 'GET',
        },
        cookies: { set: vi.fn(), get: vi.fn() },
    };
};

// ─── H-5: Teacher cannot read other teacher's sessions via ?teacherId= ──
describe('H-5: sessions GET teacherId restricted to admin', () => {
    beforeEach(() => vi.clearAllMocks());

    it('teacher role: ignores teacherId param (cannot see other teachers)', async () => {
        const mockUser = { id: 'teacher-a', email: 'a@test.com' };
        const mockSupabase = createMockSupabaseClient({
            auth: { getUser: vi.fn().mockResolvedValue({ data: { user: mockUser }, error: null }) },
        });

        const eqCalls: [string, string][] = [];
        mockSupabase.from = vi.fn(() => {
            const chain: any = {
                select: vi.fn().mockReturnThis(),
                eq: vi.fn((col: string, val: string) => {
                    eqCalls.push([col, val]);
                    return chain;
                }),
                order: vi.fn().mockReturnThis(),
                gte: vi.fn().mockReturnThis(),
                lte: vi.fn().mockReturnThis(),
                single: vi.fn().mockResolvedValue({ data: { role: 'teacher' }, error: null }),
            };
            // After all chaining, resolve with empty sessions
            chain.then = vi.fn((cb: any) => cb({ data: [], error: null }));
            return chain;
        });

        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        vi.mocked(createSupabaseServerClient).mockReturnValue(mockSupabase as any);

        const { GET } = await import('../../src/pages/api/calendar/sessions');
        await GET(makeGetContext('/api/calendar/sessions', { teacherId: 'teacher-b' }) as any);

        // The teacherId=teacher-b should NOT appear in eq calls for non-admin
        const teacherIdCalls = eqCalls.filter(([col, val]) => col === 'teacher_id' && val === 'teacher-b');
        expect(teacherIdCalls).toHaveLength(0);
    });
});

// ─── H-3: Student can only see their assigned teacher's slots ──────
describe('H-3: available-slots student IDOR protection', () => {
    beforeEach(() => vi.clearAllMocks());

    it('source code checks student_teachers assignment', async () => {
        const fs = await import('fs');
        const source = fs.readFileSync('src/pages/api/calendar/available-slots.ts', 'utf-8');

        // Must check student_teachers table for authorization
        expect(source).toContain('student_teachers');
        // Must return 403 for unauthorized students
        expect(source).toContain('403');
    });
});

// ─── H-6: bulk-sessions respects 50 session limit ──────────────────
describe('H-6: bulk-sessions DoS protection', () => {
    beforeEach(() => vi.clearAllMocks());

    it('source code enforces max 50 sessions per request', async () => {
        const fs = await import('fs');
        const source = fs.readFileSync('src/pages/api/calendar/bulk-sessions.ts', 'utf-8');

        // Must enforce a limit on scheduledDates length
        expect(source).toMatch(/scheduledDates\.length\s*>\s*50/);
        // Must return 400
        expect(source).toContain('400');
    });
});

// ─── H-4: create-portal-session no open redirect ────────────────────
describe('H-4: create-portal-session open redirect prevention', () => {
    beforeEach(() => vi.clearAllMocks());

    it('does not use Origin header for return_url', async () => {
        const fs = await import('fs');
        const source = fs.readFileSync(
            'src/pages/api/account/create-portal-session.ts', 'utf-8'
        );

        // Should NOT get Origin from request headers for return_url
        expect(source).not.toMatch(/headers.*get.*['"]Origin['"]/i);
        // Should use import.meta.env.SITE
        expect(source).toContain('import.meta.env.SITE');
    });
});

// ─── H-8: Calendar availability check fail-closed ───────────────────
describe('H-8: Calendar availability check fail-closed', () => {
    beforeEach(() => vi.clearAllMocks());

    it('checkTeacherAvailability throws on error instead of returning true', async () => {
        const fs = await import('fs');
        const source = fs.readFileSync('src/lib/google/calendar.ts', 'utf-8');
        const normalized = source.replace(/\r\n/g, '\n');

        // Find the function (it's exported)
        const fnStart = normalized.indexOf('function checkTeacherAvailability');
        expect(fnStart).toBeGreaterThan(-1);

        // Get a chunk of the function including its catch block
        const fnBody = normalized.slice(fnStart, fnStart + 2000);

        // Should NOT return true in catch (fail-open)
        expect(fnBody).not.toContain('return true');
        // Should throw in catch (fail-closed)
        expect(fnBody).toContain('throw');
    });
});

// ─── Error message sanitization ─────────────────────────────────────
describe('Error message sanitization', () => {
    it('no endpoint leaks raw error.message to the client', async () => {
        const fs = await import('fs');
        const path = await import('path');
        const glob = await import('fs');

        // Check all API endpoints
        const apiDir = 'src/pages/api';
        const checkDir = (dir: string) => {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    checkDir(fullPath);
                } else if (entry.name.endsWith('.ts') && !entry.name.includes('test')) {
                    const content = fs.readFileSync(fullPath, 'utf-8');
                    // Find JSON.stringify({ error: ... }) patterns that leak error.message
                    const leakPatterns = [
                        /JSON\.stringify\(\{\s*error:\s*error\.message/g,
                        /JSON\.stringify\(\{\s*error:\s*\(error as Error\)\.message/g,
                        /JSON\.stringify\(\{\s*error:\s*\w+Error\.message/g,
                    ];
                    for (const pattern of leakPatterns) {
                        const matches = content.match(pattern);
                        if (matches) {
                            // Allow test/debug endpoints
                            if (fullPath.includes('test') || fullPath.includes('full-class-flow')) continue;
                            throw new Error(
                                `${fullPath} leaks error.message to client: "${matches[0]}"`
                            );
                        }
                    }
                }
            }
        };
        checkDir(apiDir);
    });
});

// ─── C-3: append-homework ownership verification ────────────────────
describe('C-3: append-homework doc ownership', () => {
    it('source code verifies doc ownership before appending', async () => {
        const fs = await import('fs');
        const source = fs.readFileSync('src/pages/api/drive/append-homework.ts', 'utf-8');

        // Should check sessions table for doc ownership
        expect(source).toContain('sessions');
        expect(source).toContain('teacher_id');
        // Should have a Forbidden response for non-owners
        expect(source).toContain('Forbidden: doc not assigned');
    });
});

// ─── CRIT-02: No module-level supabaseAdmin in critical endpoints ───
describe('CRIT-02: No module-level supabaseAdmin', () => {
    const criticalFiles = [
        'src/pages/api/stripe-webhook.ts',
        'src/pages/api/subscribe.ts',
        'src/pages/api/cron/send-reminders.ts',
    ];

    it.each(criticalFiles)('%s does not instantiate supabaseAdmin at module level', async (file) => {
        const fs = await import('fs');
        const source = fs.readFileSync(file, 'utf-8');

        // Should NOT have createClient() at module level (outside of a function)
        // Allowed: createSupabaseAdminClient() inside a function
        const lines = source.split('\n');
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            // Skip if inside a function body (rough check: not at indent 0)
            if (line.match(/^const supabaseAdmin\s*=\s*createClient\(/)) {
                throw new Error(
                    `${file}:${i + 1} has module-level supabaseAdmin = createClient()`
                );
            }
        }
    });
});
