import React, { useEffect, useRef, useState } from 'react';
import ScheduleSessionModal from './ScheduleSessionModal';
import SessionDetailModal from './SessionDetailModal';
import BulkScheduleModal from './BulkScheduleModal';
import {
    addDaysToDateKey,
    dayOfWeekForDateKey,
    MADRID_TIME_ZONE,
    madridDateKey,
    madridWeekStartDateKey,
} from '../../lib/calendar/madrid-time';

interface Session {
    id: string;
    scheduled_at: string;
    duration_minutes: number;
    status: string;
    meet_link: string | null;
    teacher_notes: string | null;
    drive_doc_url: string | null;
    student: {
        id: string;
        full_name: string | null;
        email: string;
    };
}

interface Student {
    id: string;
    full_name: string | null;
    email: string;
}

interface TeacherCalendarProps {
    sessions: Session[];
    initialWeekStartKey: string;
    students: Student[];
    teacherId: string;
    lang: string;
    translations: Record<string, unknown>;
}

type LoadState = 'ready' | 'loading' | 'error';

const localeForLang = (lang: string) => (lang === 'es' ? 'es-ES' : lang === 'ru' ? 'ru-RU' : 'en-US');
const dateFromDateKey = (dateKey: string) => new Date(`${dateKey}T12:00:00.000Z`);

function isNullableString(value: unknown): value is string | null {
    return value === null || typeof value === 'string';
}

function isCalendarSession(value: unknown): value is Session {
    if (!value || typeof value !== 'object') return false;
    const session = value as Partial<Session>;
    const student = session.student as Partial<Session['student']> | null | undefined;

    return typeof session.id === 'string'
        && typeof session.scheduled_at === 'string'
        && !Number.isNaN(Date.parse(session.scheduled_at))
        && typeof session.duration_minutes === 'number'
        && typeof session.status === 'string'
        && isNullableString(session.meet_link)
        && isNullableString(session.teacher_notes)
        && isNullableString(session.drive_doc_url)
        && Boolean(student)
        && typeof student?.id === 'string'
        && isNullableString(student?.full_name)
        && typeof student?.email === 'string';
}

function sessionsFromPayload(payload: unknown, expectedWeekStartKey: string): Session[] | null {
    if (!payload || typeof payload !== 'object') return null;
    const result = payload as { weekStartKey?: unknown; sessions?: unknown };
    if (result.weekStartKey !== expectedWeekStartKey || !Array.isArray(result.sessions)) return null;
    return result.sessions.every(isCalendarSession) ? result.sessions : null;
}

export default function TeacherCalendar({
    sessions: initialSessions,
    initialWeekStartKey,
    students,
    teacherId,
    lang,
    translations: tProp,
}: TeacherCalendarProps) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const t = tProp as Record<string, any>;
    const dayNames = Array.isArray(t.dayNames)
        ? t.dayNames
        : ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const previousWeekLabel = t.previousWeek || (lang === 'es' ? 'Semana anterior' : 'Previous week');
    const nextWeekLabel = t.nextWeek || (lang === 'es' ? 'Semana siguiente' : 'Next week');
    const scheduleCourseLabel = t.scheduleCourse || (lang === 'es' ? 'Agendar curso' : 'Schedule course');
    const calendarGridLabel = t.calendarGridLabel || t.schedule || 'Calendar';
    const studentUnavailableLabel = t.studentUnavailable || (lang === 'es'
        ? 'Estudiante no disponible'
        : 'Student unavailable');
    const loadErrorLabel = t.loadError || (lang === 'es'
        ? 'No se pudo cargar esta semana.'
        : 'This week could not be loaded.');
    const retryLabel = t.retry || (lang === 'es' ? 'Reintentar' : 'Try again');

    const sessionCache = useRef(new Map<string, Session[]>([[initialWeekStartKey, initialSessions]]));
    const requestGeneration = useRef(0);
    const [sessions, setSessions] = useState<Session[]>(initialSessions);
    const [currentWeekStartKey, setCurrentWeekStartKey] = useState(initialWeekStartKey);
    const [loadState, setLoadState] = useState<LoadState>('ready');
    const [reloadGeneration, setReloadGeneration] = useState(0);
    const [isScheduleModalOpen, setIsScheduleModalOpen] = useState(false);
    const [isBulkModalOpen, setIsBulkModalOpen] = useState(false);
    const [selectedSession, setSelectedSession] = useState<Session | null>(null);
    const currentWeekStartKeyRef = useRef(currentWeekStartKey);
    currentWeekStartKeyRef.current = currentWeekStartKey;

    useEffect(() => {
        sessionCache.current.set(initialWeekStartKey, initialSessions);
        if (currentWeekStartKeyRef.current === initialWeekStartKey) {
            setSessions(initialSessions);
            setLoadState('ready');
        }
    }, [initialSessions, initialWeekStartKey]);

    useEffect(() => {
        const generation = ++requestGeneration.current;
        const cachedSessions = sessionCache.current.get(currentWeekStartKey);
        if (cachedSessions) {
            setSessions(cachedSessions);
            setLoadState('ready');
            return;
        }

        const controller = new AbortController();
        setSessions([]);
        setLoadState('loading');

        void (async () => {
            try {
                const response = await fetch(
                    `/api/calendar/sessions?weekStart=${encodeURIComponent(currentWeekStartKey)}`,
                    {
                        signal: controller.signal,
                        credentials: 'same-origin',
                        headers: { Accept: 'application/json' },
                    },
                );
                const payload: unknown = await response.json().catch(() => null);
                const loadedSessions = response.ok
                    ? sessionsFromPayload(payload, currentWeekStartKey)
                    : null;

                if (!loadedSessions) throw new Error('calendar_week_load_failed');
                if (controller.signal.aborted || generation !== requestGeneration.current) return;

                sessionCache.current.set(currentWeekStartKey, loadedSessions);
                setSessions(loadedSessions);
                setLoadState('ready');
            } catch (error) {
                if (
                    controller.signal.aborted
                    || (error instanceof Error && error.name === 'AbortError')
                    || generation !== requestGeneration.current
                ) {
                    return;
                }

                setSessions([]);
                setLoadState('error');
            }
        })();

        return () => controller.abort();
    }, [currentWeekStartKey, reloadGeneration]);

    const weekDays = Array.from({ length: 7 }, (_, index) => (
        addDaysToDateKey(currentWeekStartKey, index)
    ));
    const weekEndKey = weekDays[6] ?? addDaysToDateKey(currentWeekStartKey, 6);

    const selectWeek = (weekStartKey: string) => {
        setSelectedSession(null);
        const cachedSessions = sessionCache.current.get(weekStartKey);
        if (weekStartKey === currentWeekStartKey) {
            if (cachedSessions) {
                setSessions(cachedSessions);
                setLoadState('ready');
            } else if (loadState === 'error') {
                invalidateCalendar();
            }
            return;
        }
        setSessions(cachedSessions || []);
        setLoadState(cachedSessions ? 'ready' : 'loading');
        setCurrentWeekStartKey(weekStartKey);
    };

    const goToPrevWeek = () => selectWeek(addDaysToDateKey(currentWeekStartKey, -7));
    const goToNextWeek = () => selectWeek(addDaysToDateKey(currentWeekStartKey, 7));
    const goToToday = () => selectWeek(madridWeekStartDateKey(new Date()));

    const invalidateCalendar = () => {
        requestGeneration.current += 1;
        sessionCache.current.clear();
        setSessions([]);
        setLoadState('loading');
        setReloadGeneration((generation) => generation + 1);
    };

    const sessionsThisWeek = sessions.filter((session) => {
        const sessionDayKey = madridDateKey(new Date(session.scheduled_at));
        return sessionDayKey >= currentWeekStartKey && sessionDayKey <= weekEndKey;
    });

    const sessionsByDay = sessionsThisWeek.reduce((acc, session) => {
        const dayKey = madridDateKey(new Date(session.scheduled_at));
        if (!acc[dayKey]) acc[dayKey] = [];
        acc[dayKey].push(session);
        return acc;
    }, {} as Record<string, Session[]>);

    const formatDate = (dateKey: string) => dateFromDateKey(dateKey).toLocaleDateString(localeForLang(lang), {
        day: 'numeric',
        month: 'short',
        timeZone: MADRID_TIME_ZONE,
    });

    const formatTime = (dateStr: string) => new Date(dateStr).toLocaleTimeString(localeForLang(lang), {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: MADRID_TIME_ZONE,
    });

    const formatDayNumber = (dateKey: string) => dateFromDateKey(dateKey).toLocaleDateString(localeForLang(lang), {
        day: 'numeric',
        timeZone: MADRID_TIME_ZONE,
    });

    const isToday = (dateKey: string) => dateKey === madridDateKey(new Date());

    const getStatusBadge = (status: string) => {
        switch (status) {
            case 'completed':
                return { text: t.completed || 'Completed', className: 'bg-green-100 border-green-300 text-green-800' };
            case 'cancelled':
                return { text: t.cancelled || 'Cancelled', className: 'bg-gray-100 border-gray-300 text-gray-500 line-through' };
            case 'no_show':
                return { text: t.noShow || 'No show', className: 'bg-red-100 border-red-300 text-red-800' };
            default:
                return { text: t.scheduled || 'Scheduled', className: 'bg-[#E0F7FA] border-[#006064]/30 text-[#006064]' };
        }
    };

    const handleSessionUpdate = (_updatedSession: Session) => {
        invalidateCalendar();
    };

    const handleNewSession = (_newSession: Session) => {
        invalidateCalendar();
    };

    const calendarGrid = (
        <div className="grid grid-cols-7 gap-2" role="grid" aria-label={calendarGridLabel}>
            <div role="row" className="contents">
                {weekDays.map((dayKey) => {
                    const today = isToday(dayKey);
                    const dayName = dayNames[dayOfWeekForDateKey(dayKey)] || '';

                    return (
                        <div
                            key={`header-${dayKey}`}
                            role="columnheader"
                            aria-current={today ? 'date' : undefined}
                            className={`p-3 text-center border-2 ${today
                                ? 'bg-[#006064] text-white border-[#006064]'
                                : 'bg-white border-[#006064]/30'
                            }`}
                        >
                            <p className="font-bold text-xs uppercase">{String(dayName).substring(0, 3)}</p>
                            <p className={`font-display text-2xl ${today ? 'text-white' : 'text-[#006064]'}`}>
                                {formatDayNumber(dayKey)}
                            </p>
                        </div>
                    );
                })}
            </div>

            <div role="row" className="contents">
                {weekDays.map((dayKey) => {
                    const daySessions = sessionsByDay[dayKey] || [];
                    const dayName = dayNames[dayOfWeekForDateKey(dayKey)] || '';

                    return (
                        <div
                            key={`cell-${dayKey}`}
                            role="gridcell"
                            aria-label={`${dayName} ${formatDate(dayKey)}: ${daySessions.length} ${t.scheduled || 'sessions'}`}
                            className={`min-h-[120px] p-2 border-2 border-[#006064]/20 ${isToday(dayKey)
                                ? 'bg-[#E0F7FA]/50'
                                : 'bg-white'
                            }`}
                        >
                            {[...daySessions]
                                .sort((a, b) => Date.parse(a.scheduled_at) - Date.parse(b.scheduled_at))
                                .map((session) => {
                                    const statusBadge = getStatusBadge(session.status);
                                    const studentName = session.student?.full_name
                                        || session.student?.email?.split('@')[0]
                                        || studentUnavailableLabel;

                                    return (
                                        <button
                                            key={session.id}
                                            type="button"
                                            aria-label={`${formatTime(session.scheduled_at)} ${studentName} ${statusBadge.text}`}
                                            onClick={() => setSelectedSession(session)}
                                            className={`w-full text-left p-2 mb-1 text-xs border rounded transition-all hover:scale-[1.02] ${statusBadge.className}`}
                                        >
                                            <time className="block font-bold" dateTime={session.scheduled_at}>
                                                {formatTime(session.scheduled_at)}
                                            </time>
                                            <span className="block truncate">{studentName}</span>
                                        </button>
                                    );
                                })}
                        </div>
                    );
                })}
            </div>
        </div>
    );

    return (
        <div className="space-y-6" aria-busy={loadState === 'loading'}>
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        aria-label={previousWeekLabel}
                        onClick={goToPrevWeek}
                        className="p-2 border-2 border-[#006064] text-[#006064] hover:bg-[#006064] hover:text-white transition-colors font-bold"
                    >
                        &larr;
                    </button>
                    <button
                        type="button"
                        onClick={goToToday}
                        className="px-4 py-2 border-2 border-[#006064] text-[#006064] hover:bg-[#006064] hover:text-white transition-colors font-bold text-sm uppercase"
                    >
                        {t.today}
                    </button>
                    <button
                        type="button"
                        aria-label={nextWeekLabel}
                        onClick={goToNextWeek}
                        className="p-2 border-2 border-[#006064] text-[#006064] hover:bg-[#006064] hover:text-white transition-colors font-bold"
                    >
                        &rarr;
                    </button>
                    <span className="ml-4 font-display text-lg text-[#006064]" aria-live="polite">
                        {formatDate(currentWeekStartKey)} - {formatDate(weekEndKey)}
                    </span>
                </div>

                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        onClick={() => setIsBulkModalOpen(true)}
                        className="px-6 py-3 bg-white text-[#006064] font-bold uppercase text-sm border-2 border-[#006064] hover:bg-[#E0F7FA] transition-colors"
                        title={scheduleCourseLabel}
                        aria-label={scheduleCourseLabel}
                    >
                        + {scheduleCourseLabel}
                    </button>
                    <button
                        type="button"
                        onClick={() => setIsScheduleModalOpen(true)}
                        className="px-6 py-3 bg-[#006064] text-white font-bold uppercase text-sm border-2 border-[#006064] hover:bg-[#004d40] transition-colors"
                    >
                        + {t.scheduleClass}
                    </button>
                </div>
            </div>

            {loadState === 'loading' && (
                <p role="status" className="border-2 border-[#006064]/20 bg-white p-6 text-[#006064]">
                    {t.loading || 'Loading...'}
                </p>
            )}

            {loadState === 'error' && (
                <div role="alert" className="border-2 border-red-300 bg-red-50 p-6 text-red-900">
                    <p>{loadErrorLabel}</p>
                    <button
                        type="button"
                        onClick={invalidateCalendar}
                        className="mt-4 border-2 border-red-800 px-4 py-2 font-bold uppercase"
                    >
                        {retryLabel}
                    </button>
                </div>
            )}

            {loadState === 'ready' && (
                <>
                    {sessionsThisWeek.length === 0 && (
                        <p role="status" className="border-2 border-[#006064]/20 bg-white p-4 text-[#006064]/70">
                            {t.noSessions || 'No sessions'}
                        </p>
                    )}
                    {calendarGrid}
                    <div className="flex flex-wrap gap-4 text-xs">
                        <div className="flex items-center gap-2">
                            <span className="w-4 h-4 bg-[#E0F7FA] border border-[#006064]/30" aria-hidden="true"></span>
                            <span className="text-[#006064]/70">{t.scheduled}</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <span className="w-4 h-4 bg-green-100 border border-green-300" aria-hidden="true"></span>
                            <span className="text-[#006064]/70">{t.completed}</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <span className="w-4 h-4 bg-red-100 border border-red-300" aria-hidden="true"></span>
                            <span className="text-[#006064]/70">{t.noShow}</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <span className="w-4 h-4 bg-gray-100 border border-gray-300" aria-hidden="true"></span>
                            <span className="text-[#006064]/70">{t.cancelled}</span>
                        </div>
                    </div>
                </>
            )}

            {isScheduleModalOpen && (
                <ScheduleSessionModal
                    isOpen={isScheduleModalOpen}
                    onClose={() => setIsScheduleModalOpen(false)}
                    students={students}
                    teacherId={teacherId}
                    lang={lang}
                    translations={t}
                    onSessionCreated={handleNewSession}
                />
            )}

            {isBulkModalOpen && (
                <BulkScheduleModal
                    isOpen={isBulkModalOpen}
                    onClose={() => setIsBulkModalOpen(false)}
                    students={students}
                    teacherId={teacherId}
                    lang={lang}
                    translations={t}
                    onSessionsCreated={invalidateCalendar}
                />
            )}

            {selectedSession && (
                <SessionDetailModal
                    isOpen={true}
                    onClose={() => setSelectedSession(null)}
                    session={selectedSession}
                    lang={lang}
                    translations={t}
                    onSessionUpdate={handleSessionUpdate}
                    canEdit={true}
                />
            )}
        </div>
    );
}
