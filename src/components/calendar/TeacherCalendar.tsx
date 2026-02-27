import React, { useState } from 'react';
import ScheduleSessionModal from './ScheduleSessionModal';
import SessionDetailModal from './SessionDetailModal';
import BulkScheduleModal from './BulkScheduleModal';

interface Session {
    id: string;
    scheduled_at: string;
    duration_minutes: number;
    status: string;
    meet_link: string | null;
    teacher_notes: string | null;
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

export default function TeacherCalendar({
    sessions: initialSessions,
    students,
    teacherId,
    lang,
    translations: tProp
}: TeacherCalendarProps) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const t = tProp as Record<string, any>;
    const [sessions, setSessions] = useState<Session[]>(initialSessions);
    const [currentWeekStart, setCurrentWeekStart] = useState(() => {
        const today = new Date();
        const dayOfWeek = today.getDay();
        const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek; // Ajustar al lunes
        const monday = new Date(today);
        monday.setDate(today.getDate() + diff);
        monday.setHours(0, 0, 0, 0);
        return monday;
    });

    const [isScheduleModalOpen, setIsScheduleModalOpen] = useState(false);
    const [isBulkModalOpen, setIsBulkModalOpen] = useState(false);
    const [selectedSession, setSelectedSession] = useState<Session | null>(null);

    // Generar días de la semana actual
    const weekDays = Array.from({ length: 7 }, (_, i) => {
        const day = new Date(currentWeekStart);
        day.setDate(currentWeekStart.getDate() + i);
        return day;
    });

    // Navegar semanas
    const goToPrevWeek = () => {
        const newStart = new Date(currentWeekStart);
        newStart.setDate(newStart.getDate() - 7);
        setCurrentWeekStart(newStart);
    };

    const goToNextWeek = () => {
        const newStart = new Date(currentWeekStart);
        newStart.setDate(newStart.getDate() + 7);
        setCurrentWeekStart(newStart);
    };

    const goToToday = () => {
        const today = new Date();
        const dayOfWeek = today.getDay();
        const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
        const monday = new Date(today);
        monday.setDate(today.getDate() + diff);
        monday.setHours(0, 0, 0, 0);
        setCurrentWeekStart(monday);
    };

    // Filtrar sesiones para la semana actual
    const weekEnd = new Date(currentWeekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);
    weekEnd.setHours(23, 59, 59, 999);

    const sessionsThisWeek = sessions.filter(s => {
        const sessionDate = new Date(s.scheduled_at);
        return sessionDate >= currentWeekStart && sessionDate <= weekEnd;
    });

    // Agrupar sesiones por día
    const sessionsByDay = sessionsThisWeek.reduce((acc, session) => {
        const sessionDate = new Date(session.scheduled_at);
        const dayKey = sessionDate.toISOString().split('T')[0];
        if (!acc[dayKey]) {
            acc[dayKey] = [];
        }
        acc[dayKey].push(session);
        return acc;
    }, {} as Record<string, Session[]>);

    // Formateo
    const formatDate = (date: Date) => {
        return date.toLocaleDateString(lang === 'es' ? 'es-ES' : lang === 'ru' ? 'ru-RU' : 'en-US', {
            day: 'numeric',
            month: 'short'
        });
    };

    const formatTime = (dateStr: string) => {
        const date = new Date(dateStr);
        return date.toLocaleTimeString(lang === 'es' ? 'es-ES' : lang === 'ru' ? 'ru-RU' : 'en-US', {
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    const isToday = (date: Date) => {
        const today = new Date();
        return date.toDateString() === today.toDateString();
    };

    const getStatusColor = (status: string) => {
        switch (status) {
            case 'completed':
                return 'bg-green-100 border-green-300 text-green-800';
            case 'cancelled':
                return 'bg-gray-100 border-gray-300 text-gray-500 line-through';
            case 'no_show':
                return 'bg-red-100 border-red-300 text-red-800';
            default:
                return 'bg-[#E0F7FA] border-[#006064]/30 text-[#006064]';
        }
    };

    const handleSessionClick = (session: Session) => {
        setSelectedSession(session);
    };

    const handleSessionUpdate = (updatedSession: Session) => {
        setSessions(sessions.map(s => s.id === updatedSession.id ? updatedSession : s));
    };

    const handleNewSession = (newSession: Session) => {
        setSessions([...sessions, newSession]);
    };

    return (
        <div className="space-y-6">
            {/* Controles del calendario */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div className="flex items-center gap-2">
                    <button
                        onClick={goToPrevWeek}
                        className="p-2 border-2 border-[#006064] text-[#006064] hover:bg-[#006064] hover:text-white transition-colors font-bold"
                    >
                        ←
                    </button>
                    <button
                        onClick={goToToday}
                        className="px-4 py-2 border-2 border-[#006064] text-[#006064] hover:bg-[#006064] hover:text-white transition-colors font-bold text-sm uppercase"
                    >
                        {t.today}
                    </button>
                    <button
                        onClick={goToNextWeek}
                        className="p-2 border-2 border-[#006064] text-[#006064] hover:bg-[#006064] hover:text-white transition-colors font-bold"
                    >
                        →
                    </button>
                    <span className="ml-4 font-display text-lg text-[#006064]">
                        {formatDate(currentWeekStart)} - {formatDate(weekEnd)}
                    </span>
                </div>

                <div className="flex items-center gap-2">
                    <button
                        onClick={() => setIsBulkModalOpen(true)}
                        className="px-6 py-3 bg-white text-[#006064] font-bold uppercase text-sm border-2 border-[#006064] hover:bg-[#E0F7FA] transition-colors"
                        title="Agendar Múltiples Semanas a la vez"
                    >
                        + Agendar Curso
                    </button>
                    <button
                        onClick={() => setIsScheduleModalOpen(true)}
                        className="px-6 py-3 bg-[#006064] text-white font-bold uppercase text-sm border-2 border-[#006064] hover:bg-[#004d40] transition-colors"
                    >
                        + {t.scheduleClass}
                    </button>
                </div>
            </div>

            {/* Grid del calendario */}
            <div className="grid grid-cols-7 gap-2">
                {/* Headers de días */}
                {weekDays.map((day, index) => (
                    <div
                        key={index}
                        className={`p-3 text-center border-2 ${isToday(day)
                            ? 'bg-[#006064] text-white border-[#006064]'
                            : 'bg-white border-[#006064]/30'
                            }`}
                    >
                        <p className="font-bold text-xs uppercase">
                            {t.dayNames[day.getDay()].substring(0, 3)}
                        </p>
                        <p className={`font-display text-2xl ${isToday(day) ? 'text-white' : 'text-[#006064]'}`}>
                            {day.getDate()}
                        </p>
                    </div>
                ))}

                {/* Celdas con sesiones */}
                {weekDays.map((day, index) => {
                    const dayKey = day.toISOString().split('T')[0];
                    const daySessions = sessionsByDay[dayKey] || [];

                    return (
                        <div
                            key={`cell-${index}`}
                            className={`min-h-[120px] p-2 border-2 border-[#006064]/20 ${isToday(day) ? 'bg-[#E0F7FA]/50' : 'bg-white'
                                }`}
                        >
                            {daySessions
                                .sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime())
                                .map(session => (
                                    <button
                                        key={session.id}
                                        onClick={() => handleSessionClick(session)}
                                        className={`w-full text-left p-2 mb-1 text-xs border rounded transition-all hover:scale-[1.02] ${getStatusColor(session.status)}`}
                                    >
                                        <p className="font-bold">{formatTime(session.scheduled_at)}</p>
                                        <p className="truncate">
                                            {session.student?.full_name || session.student?.email?.split('@')[0]}
                                        </p>
                                    </button>
                                ))}
                        </div>
                    );
                })}
            </div>

            {/* Leyenda */}
            <div className="flex flex-wrap gap-4 text-xs">
                <div className="flex items-center gap-2">
                    <span className="w-4 h-4 bg-[#E0F7FA] border border-[#006064]/30"></span>
                    <span className="text-[#006064]/70">{t.scheduled}</span>
                </div>
                <div className="flex items-center gap-2">
                    <span className="w-4 h-4 bg-green-100 border border-green-300"></span>
                    <span className="text-[#006064]/70">{t.completed}</span>
                </div>
                <div className="flex items-center gap-2">
                    <span className="w-4 h-4 bg-red-100 border border-red-300"></span>
                    <span className="text-[#006064]/70">{t.noShow}</span>
                </div>
                <div className="flex items-center gap-2">
                    <span className="w-4 h-4 bg-gray-100 border border-gray-300"></span>
                    <span className="text-[#006064]/70">{t.cancelled}</span>
                </div>
            </div>

            {/* Modales */}
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
