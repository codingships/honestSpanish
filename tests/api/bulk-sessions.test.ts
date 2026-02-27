import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockSupabaseClient } from '../mocks/supabase';

// Mock Supabase Server Client
vi.mock('../../src/lib/supabase-server', () => ({
    createSupabaseServerClient: vi.fn(),
}));

// Mock Google Calendar
vi.mock('../../src/lib/google/calendar', () => ({
    checkTeacherAvailability: vi.fn(),
    createClassEvent: vi.fn(),
}));

const makeContext = (body: Record<string, unknown> = {}) => ({
    request: {
        json: vi.fn().mockResolvedValue(body),
        headers: { get: vi.fn().mockReturnValue('') },
        url: 'http://localhost:4321/api/calendar/bulk-sessions',
    },
    cookies: { set: vi.fn(), get: vi.fn() },
});

describe('POST /api/calendar/bulk-sessions', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('returns 401 when user is not authenticated', async () => {
        const mockSupabase = createMockSupabaseClient({
            auth: {
                getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
            },
        });
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        vi.mocked(createSupabaseServerClient).mockReturnValue(mockSupabase as any);

        const { POST } = await import('../../src/pages/api/calendar/bulk-sessions');
        const response = await POST(makeContext({ studentId: '123', sessions: ['2026-01-01T10:00:00Z'] }) as any);
        expect(response.status).toBe(401);
    });

    it('returns 403 when user is a student (RBAC Privilege Escalation attempt)', async () => {
        // Simulamos que el usuario logueado es un estdiante
        const mockSupabase = createMockSupabaseClient({
            auth: {
                getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'student_1' } }, error: null }),
            },
        });
        mockSupabase.from = vi.fn((table: string) => {
            const chain: any = {
                select: vi.fn().mockReturnThis(),
                eq: vi.fn().mockReturnThis(),
                single: vi.fn().mockResolvedValue({ data: { role: 'student' } }), // Rol es Alumno
            };
            return chain;
        });

        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        vi.mocked(createSupabaseServerClient).mockReturnValue(mockSupabase as any);

        const { POST } = await import('../../src/pages/api/calendar/bulk-sessions');
        // Un alumno intenta llamar al endpoint de agendamiento
        const response = await POST(makeContext({ studentId: '123', sessions: ['2026-01-01T10:00:00Z'] }) as any);

        // Debe ser expulsado
        expect(response.status).toBe(403);
    });

    it('returns 400 when missing required payload fields', async () => {
        const mockSupabase = createMockSupabaseClient({
            auth: {
                getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'teacher_1' } }, error: null }),
            },
        });
        mockSupabase.from = vi.fn((table: string) => ({
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ data: { role: 'teacher' } }), // Logueado como profe (permitido)
        } as any));

        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        vi.mocked(createSupabaseServerClient).mockReturnValue(mockSupabase as any);

        const { POST } = await import('../../src/pages/api/calendar/bulk-sessions');

        // Payload corrupto (sin arrray de 'sessions')
        const response = await POST(makeContext({ studentId: '123' }) as any);
        expect(response.status).toBe(400);

        const body = await response.json();
        expect(body.error).toContain('dates are required');
    });

    it('returns 409 Conflict if ONE of the dates is busy (Atomicity Check)', async () => {
        const mockSupabase = createMockSupabaseClient({
            auth: {
                getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'teacher_1' } }, error: null }),
            },
        });

        mockSupabase.from = vi.fn((table: string) => {
            const chain: any = {
                select: vi.fn().mockReturnThis(),
                eq: vi.fn().mockReturnThis(),
                neq: vi.fn().mockReturnThis(),
                gte: vi.fn().mockReturnThis(),
                lt: vi.fn().mockReturnThis(),
                order: vi.fn().mockReturnThis(),
                limit: vi.fn().mockReturnThis(),
                single: vi.fn(),
            };
            if (table === 'profiles') {
                chain.single.mockResolvedValue({ data: { role: 'teacher', email: 'profe@test.com' } });
            } else if (table === 'subscriptions') {
                chain.single.mockResolvedValue({ data: { id: 'sub_1', sessions_used: 0, sessions_total: 10 } });
            } else if (table === 'sessions') {
                // Mockeamos la respuesta de conflictos: Simulamos que devuelve [1] conflicto
                chain.single.mockResolvedValue({ data: [{ id: 'existing_class' }] });
                // Return an array for the select list query
                chain.lt = vi.fn().mockResolvedValue({ data: [{ id: 'fake_conflict' }] });
            }
            return chain;
        });

        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        vi.mocked(createSupabaseServerClient).mockReturnValue(mockSupabase as any);

        // Simulamos que el calendario de Google ESTÁ libre, el bloqueo viene de BBDD
        const calendarModule = await import('../../src/lib/google/calendar');
        vi.mocked(calendarModule.checkTeacherAvailability).mockResolvedValue(true);

        const { POST } = await import('../../src/pages/api/calendar/bulk-sessions');

        // Enviamos 3 fechas
        const payload = {
            studentId: '123',
            sessions: [
                '2026-10-10T10:00:00Z',
                '2026-10-11T10:00:00Z',
                '2026-10-12T10:00:00Z'
            ]
        };

        const response = await POST(makeContext(payload) as any);

        // La API deberia abortar devolviendo HTTP 409 Conflict antes de insertar
        expect(response.status).toBe(409);
        const body = await response.json();
        expect(body.error).toContain('Conflicto detectado en Campus');
    });
});
