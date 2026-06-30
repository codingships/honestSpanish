import { describe, expect, it, vi } from 'vitest';
import { checkTeacherAvailabilitySlots } from '../../src/lib/calendar/availability';

describe('checkTeacherAvailabilitySlots', () => {
    it('accepts scheduled times returned by the canonical availability RPC', async () => {
        const scheduledAt = '2026-02-18T09:00:00.000Z';
        const rpc = vi.fn().mockResolvedValue({
            data: [{ slot_start: scheduledAt, slot_end: '2026-02-18T09:50:00.000Z' }],
            error: null,
        });

        await expect(checkTeacherAvailabilitySlots({ rpc }, {
            teacherId: 'teacher-1',
            scheduledAts: [scheduledAt],
            durationMinutes: 50,
        })).resolves.toEqual({ ok: true });

        expect(rpc).toHaveBeenCalledWith('get_available_slots', {
            p_teacher_id: 'teacher-1',
            p_date: '2026-02-18',
            p_duration_minutes: 50,
        });
    });

    it('rejects a scheduled time that is not in the available slot list', async () => {
        const rpc = vi.fn().mockResolvedValue({
            data: [{ slot_start: '2026-02-18T09:00:00.000Z' }],
            error: null,
        });

        await expect(checkTeacherAvailabilitySlots({ rpc }, {
            teacherId: 'teacher-1',
            scheduledAts: ['2026-02-18T10:00:00.000Z'],
            durationMinutes: 50,
        })).resolves.toMatchObject({
            ok: false,
            status: 409,
            error: 'Time slot is outside teacher availability or already booked',
        });
    });

    it('rejects duplicate scheduled times before asking for available slots', async () => {
        const scheduledAt = '2026-02-18T09:00:00.000Z';
        const rpc = vi.fn();

        await expect(checkTeacherAvailabilitySlots({ rpc }, {
            teacherId: 'teacher-1',
            scheduledAts: [scheduledAt, scheduledAt],
            durationMinutes: 50,
        })).resolves.toMatchObject({
            ok: false,
            status: 409,
            error: 'Request contains overlapping class times',
        });

        expect(rpc).not.toHaveBeenCalled();
    });

    it('rejects partially overlapping scheduled times inside one request', async () => {
        const rpc = vi.fn();

        await expect(checkTeacherAvailabilitySlots({ rpc }, {
            teacherId: 'teacher-1',
            scheduledAts: [
                '2026-02-18T09:00:00.000Z',
                '2026-02-18T09:30:00.000Z',
            ],
            durationMinutes: 50,
        })).resolves.toMatchObject({
            ok: false,
            status: 409,
            error: 'Request contains overlapping class times',
        });

        expect(rpc).not.toHaveBeenCalled();
    });

    it('groups checks by Europe/Madrid calendar date', async () => {
        const rpc = vi.fn()
            .mockResolvedValueOnce({
                data: [{ slot_start: '2026-02-18T22:30:00.000Z' }],
                error: null,
            })
            .mockResolvedValueOnce({
                data: [{ slot_start: '2026-02-19T09:00:00.000Z' }],
                error: null,
            });

        await expect(checkTeacherAvailabilitySlots({ rpc }, {
            teacherId: 'teacher-1',
            scheduledAts: [
                '2026-02-18T22:30:00.000Z',
                '2026-02-19T09:00:00.000Z',
            ],
            durationMinutes: 50,
        })).resolves.toEqual({ ok: true });

        expect(rpc).toHaveBeenNthCalledWith(1, 'get_available_slots', expect.objectContaining({
            p_date: '2026-02-18',
        }));
        expect(rpc).toHaveBeenNthCalledWith(2, 'get_available_slots', expect.objectContaining({
            p_date: '2026-02-19',
        }));
    });
});
