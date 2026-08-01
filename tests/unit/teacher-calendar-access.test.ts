import { describe, expect, it } from 'vitest';
import { resolveTeacherCalendarAccess } from '../../src/lib/calendar/teacher-calendar-access';

describe('teacher calendar access state', () => {
    it.each([
        [{ hasUser: false, authFailed: false, profileStatus: null, profileRole: null }, 'login'],
        [{ hasUser: false, authFailed: true, profileStatus: null, profileRole: null }, 'unavailable'],
        [{ hasUser: true, authFailed: true, profileStatus: null, profileRole: null }, 'unavailable'],
        [{ hasUser: true, authFailed: false, profileStatus: 'error', profileRole: null }, 'unavailable'],
        [{ hasUser: true, authFailed: false, profileStatus: 'empty', profileRole: null }, 'unavailable'],
        [{ hasUser: true, authFailed: false, profileStatus: 'ready', profileRole: 'admin' }, 'admin-calendar'],
        [{ hasUser: true, authFailed: false, profileStatus: 'ready', profileRole: 'student' }, 'campus'],
        [{ hasUser: true, authFailed: false, profileStatus: 'ready', profileRole: 'teacher' }, 'teacher-calendar'],
    ] as const)('resolves %o to %s', (input, expected) => {
        expect(resolveTeacherCalendarAccess(input)).toBe(expected);
    });
});
