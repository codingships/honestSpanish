import React, { useEffect, useState } from 'react';
import ScheduleSessionModal from './ScheduleSessionModal';
import SessionDetailModal from './SessionDetailModal';
import BulkScheduleModal from './BulkScheduleModal';
import { addDaysToDateKey, dayOfWeekForDateKey, madridDateKey } from '../../lib/calendar/madrid-time';

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
    students: Student[];
    teacherId: string;
    lang: string;
    translations: Record<string, unknown>;
}

const localeForLang = (lang: string) => (lang === 'es' ? 'es-ES' : lang === 'ru' ? 'ru-RU' : 'en-US');
const calendarTimeZone = 'Europe/Madrid';

const localDateKey = (date: Date) => madridDateKey(date);
const dateFromDateKey = (dateKey: string) => new Date(`${dateKey}T00:00:00.000Z`);

const startOfWeek = (sourceDate: Date) => {
    const sourceDateKey = localDateKey(sourceDate);
    const dayOfWeek = dayOfWeekForDateKey(sourceDateKey);
    const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    return dateFromDateKey(addDaysToDateKey(sourceDateKey, diff));
};

export default function TeacherCalendar({
    sessions: initialSessions,
    students,
    teacherId,
    lang,
    translations: tProp
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

    const [sessions, setSessions] = useState<Session[]>(initialSessions);
    const [currentWeekStart, setCurrentWeekStart] = useState(() => startOfWeek(new Date()));

    const [isScheduleModalOpen, setIsScheduleModalOpen] = useState(false);
    const [isBulkModalOpen, setIsBulkModalOpen] = useState(false);
    const [selectedSession, setSelectedSession] = useState<Session | null>(null);

    useEffect(() => {
        setSessions(initialSessions);
    }, [initialSessions]);

    const currentWeekStartKey = localDateKey(currentWeekStart);
    const weekDays = Array.from({ length: 7 }, (_, index) => (
        dateFromDateKey(addDaysToDateKey(currentWeekStartKey, index))
    ));

    const goToPrevWeek = () => {
        setCurrentWeekStart((weekStart) => {
            return dateFromDateKey(addDaysToDateKey(localDateKey(weekStart), -7));
        });
    };

    const goToNextWeek = () => {
        setCurrentWeekStart((weekStart) => {
            return dateFromDateKey(addDaysToDateKey(localDateKey(weekStart), 7));
        });
    };

    const goToToday = () => {
        setCurrentWeekStart(startOfWeek(new Date()));
    };

    const weekEnd = weekDays[6] ?? dateFromDateKey(addDaysToDateKey(currentWeekStartKey, 6));
    const weekEndKey = localDateKey(weekEnd);

    const sessionsThisWeek = sessions.filter((session) => {
        const sessionDayKey = localDateKey(new Date(session.scheduled_at));
        return sessionDayKey >= currentWeekStartKey && sessionDayKey <= weekEndKey;
    });

    const sessionsByDay = sessionsThisWeek.reduce((acc, session) => {
        const sessionDate = new Date(session.scheduled_at);
        const dayKey = localDateKey(sessionDate);
        if (!acc[dayKey]) {
            acc[dayKey] = [];
        }
        acc[dayKey].push(session);
        return acc;
    }, {} as Record<string, Session[]>);

    const formatDate = (date: Date) => {
        return date.toLocaleDateString(localeForLang(lang), {
            day: 'numeric',
            month: 'short',
            timeZone: calendarTimeZone,
        });
    };

    const formatTime = (dateStr: string) => {
        const date = new Date(dateStr);
        return date.toLocaleTimeString(localeForLang(lang), {
            hour: '2-digit',
            minute: '2-digit',
            timeZone: calendarTimeZone,
        });
    };

    const formatDayNumber = (date: Date) => {
        return date.toLocaleDateString(localeForLang(lang), {
            day: 'numeric',
            timeZone: calendarTimeZone,
        });
    };

    const isToday = (date: Date) => {
        const today = new Date();
        return localDateKey(date) === localDateKey(today);
    };

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

    const handleSessionClick = (session: Session) => {
        setSelectedSession(session);
    };

    const handleSessionUpdate = (updatedSession: Session) => {
        setSessions((currentSessions) => (
            currentSessions.map((session) => session.id === updatedSession.id ? updatedSession : session)
        ));
        setSelectedSession((currentSession) => (
            currentSession?.id === updatedSession.id ? updatedSession : currentSession
        ));
    };

    const handleNewSession = (newSession: Session) => {
        setSessions((currentSessions) => [...currentSessions, newSession]);
    };

    return (
        <div className="space-y-6">
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
                        {formatDate(currentWeekStart)} - {formatDate(weekEnd)}
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

            <div className="grid grid-cols-7 gap-2" role="grid" aria-label={calendarGridLabel}>
                <div role="row" className="contents">
                    {weekDays.map((day) => {
                        const today = isToday(day);
                        const dayName = dayNames[day.getDay()] || '';

                        return (
                            <div
                                key={`header-${localDateKey(day)}`}
                                role="columnheader"
                                aria-current={today ? 'date' : undefined}
                                className={`p-3 text-center border-2 ${today
                                    ? 'bg-[#006064] text-white border-[#006064]'
                                    : 'bg-white border-[#006064]/30'
                                    }`}
                            >
                                <p className="font-bold text-xs uppercase">
                                    {String(dayName).substring(0, 3)}
                                </p>
                                <p className={`font-display text-2xl ${today ? 'text-white' : 'text-[#006064]'}`}>
                                    {formatDayNumber(day)}
                                </p>
                            </div>
                        );
                    })}
                </div>

                <div role="row" className="contents">
                    {weekDays.map((day) => {
                        const dayKey = localDateKey(day);
                        const daySessions = sessionsByDay[dayKey] || [];
                        const dayName = dayNames[day.getDay()] || '';

                        return (
                            <div
                                key={`cell-${dayKey}`}
                                role="gridcell"
                                aria-label={`${dayName} ${formatDate(day)}: ${daySessions.length} ${t.scheduled || 'sessions'}`}
                                className={`min-h-[120px] p-2 border-2 border-[#006064]/20 ${isToday(day) ? 'bg-[#E0F7FA]/50' : 'bg-white'
                                    }`}
                            >
                                {[...daySessions]
                                    .sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime())
                                    .map((session) => {
                                        const statusBadge = getStatusBadge(session.status);
                                        const studentName = session.student?.full_name || session.student?.email?.split('@')[0] || '';

                                        return (
                                            <button
                                                key={session.id}
                                                type="button"
                                                aria-label={`${formatTime(session.scheduled_at)} ${studentName} ${statusBadge.text}`}
                                                onClick={() => handleSessionClick(session)}
                                                className={`w-full text-left p-2 mb-1 text-xs border rounded transition-all hover:scale-[1.02] ${statusBadge.className}`}
                                            >
                                                <time className="block font-bold" dateTime={session.scheduled_at}>
                                                    {formatTime(session.scheduled_at)}
                                                </time>
                                                <span className="block truncate">
                                                    {studentName}
                                                </span>
                                            </button>
                                        );
                                    })}
                            </div>
                        );
                    })}
                </div>
            </div>

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
                    onSessionsCreated={() => window.location.reload()}
                />
            )}

            {selectedSession && (
                <SessionDetailModal
                    isOpen={!!selectedSession}
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
