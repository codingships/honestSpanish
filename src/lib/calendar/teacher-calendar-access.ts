export type TeacherCalendarAccess =
    | 'login'
    | 'unavailable'
    | 'admin-calendar'
    | 'campus'
    | 'teacher-calendar';

type TeacherCalendarAccessInput = {
    hasUser: boolean;
    authFailed: boolean;
    profileStatus: 'ready' | 'empty' | 'error' | null;
    profileRole: unknown;
};

export function resolveTeacherCalendarAccess({
    hasUser,
    authFailed,
    profileStatus,
    profileRole,
}: TeacherCalendarAccessInput): TeacherCalendarAccess {
    if (authFailed) return 'unavailable';
    if (!hasUser) return 'login';
    if (profileStatus !== 'ready') return 'unavailable';
    if (profileRole === 'admin') return 'admin-calendar';
    if (profileRole !== 'teacher') return 'campus';
    return 'teacher-calendar';
}
