import React, { useState } from 'react';
import AdminScheduleModal from './AdminScheduleModal';
import SessionDetailModal from './SessionDetailModal';

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
    teacher?: {
        id: string;
        full_name: string | null;
        email: string;
    } | null;
}

interface Teacher {
    id: string;
    full_name: string | null;
    email: string;
}

interface Student {
    id: string;
    full_name: string | null;
    email: string;
}

interface AdminCalendarProps {
    sessions: Session[];
    teachers: Teacher[];
    students: Student[];
    lang: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    translations: Record<string, any>;
}

export default function AdminCalendar({
    sessions: initialSessions,
    teachers,
    students,
    lang,
    translations: t
}: AdminCalendarProps) {
    const [sessions, setSessions] = useState<Session[]>(initialSessions);
    const [view, setView] = useState<'week' | 'month'>('week');
    const [filterTeacher, setFilterTeacher] = useState<string>('all');
    const [currentDate, setCurrentDate] = useState(new Date());

    const [isScheduleModalOpen, setIsScheduleModalOpen] = useState(false);
    const [selectedSession, setSelectedSession] = useState<Session | null>(null);

    // Calcular inicio de semana (lunes)
    const getWeekStart = (date: Date) => {
        const d = new Date(date);
        const day = d.getDay();
        const diff = day === 0 ? -6 : 1 - day;
        d.setDate(d.getDate() + diff);
        d.setHours(0, 0, 0, 0);
        return d;
    };

    const [weekStart, setWeekStart] = useState(getWeekStart(new Date()));

    // Generar días de la semana
    const weekDays = Array.from({ length: 7 }, (_, i) => {
        const day = new Date(weekStart);
        day.setDate(weekStart.getDate() + i);
        return day;
    });

    // Generar días del mes
    const getMonthDays = () => {
        const year = currentDate.getFullYear();
        const month = currentDate.getMonth();
        const firstDay = new Date(year, month, 1);
        const lastDay = new Date(year, month + 1, 0);

        const days: (Date | null)[] = [];

        // Días vacíos al inicio
        const startPadding = firstDay.getDay() === 0 ? 6 : firstDay.getDay() - 1;
        for (let i = 0; i < startPadding; i++) {
            days.push(null);
        }

        // Días del mes
        for (let i = 1; i <= lastDay.getDate(); i++) {
            days.push(new Date(year, month, i));
        }

        return days;
    };

    // Navegación
    const goToPrev = () => {
        if (view === 'week') {
            const newStart = new Date(weekStart);
            newStart.setDate(newStart.getDate() - 7);
            setWeekStart(newStart);
        } else {
            setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1));
        }
    };

    const goToNext = () => {
        if (view === 'week') {
            const newStart = new Date(weekStart);
            newStart.setDate(newStart.getDate() + 7);
            setWeekStart(newStart);
        } else {
            setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1));
        }
    };

    const goToToday = () => {
        const today = new Date();
        setWeekStart(getWeekStart(today));
        setCurrentDate(today);
    };

    // Filtrar sesiones
    const filteredSessions = sessions.filter(s => {
        if (filterTeacher !== 'all' && s.teacher?.id !== filterTeacher) {
            return false;
        }
        return true;
    });

    // Agrupar sesiones por día
    const getSessionsForDay = (date: Date) => {
        const dayKey = date.toISOString().split('T')[0];
        return filteredSessions.filter(s => {
            const sessionDate = new Date(s.scheduled_at).toISOString().split('T')[0];
            return sessionDate === dayKey;
        }).sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime());
    };

    const formatTime = (dateStr: string) => {
        return new Date(dateStr).toLocaleTimeString(lang === 'es' ? 'es-ES' : 'en-US', {
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    const formatDate = (date: Date) => {
        return date.toLocaleDateString(lang === 'es' ? 'es-ES' : 'en-US', {
            day: 'numeric',
            month: 'short'
        });
    };

    const formatMonthYear = (date: Date) => {
        return date.toLocaleDateString(lang === 'es' ? 'es-ES' : 'en-US', {
            month: 'long',
            year: 'numeric'
        });
    };

    const isToday = (date: Date) => {
        const today = new Date();
        return date.toDateString() === today.toDateString();
    };

    const getStatusColor = (status: string) => {
        switch (status) {
            case 'completed': return 'bg-green-100 border-green-300 text-green-800';
            case 'cancelled': return 'bg-gray-100 border-gray-300 text-gray-500 line-through';
            case 'no_show': return 'bg-red-100 border-red-300 text-red-800';
            default: return 'bg-blue-100 border-blue-300 text-blue-800';
        }
    };

    const getTeacherColor = (teacherId: string | undefined) => {
        if (!teacherId) return 'border-l-gray-400';
        const colors = [
            'border-l-purple-500',
            'border-l-orange-500',
            'border-l-pink-500',
            'border-l-indigo-500',
            'border-l-teal-500',
        ];
        const index = teachers.findIndex(t => t.id === teacherId);
        return colors[index % colors.length];
    };

    const handleSessionUpdate = (updatedSession: Session) => {
        setSessions(sessions.map(s => s.id === updatedSession.id ? updatedSession : s));
    };

    const handleNewSession = (newSession: Session) => {
        setSessions([...sessions, newSession]);
    };

    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);

    return (
        <div className="space-y-6">
            {/* Controles */}
            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 bg-white p-4 border-2 border-[#006064] shadow-[4px_4px_0px_0px_#006064]">
                {/* Navegación */}
                <div className="flex items-center gap-2">
                    <button onClick={goToPrev} className="p-2 border-2 border-[#006064] text-[#006064] hover:bg-[#006064] hover:text-white transition-colors font-bold">
                        ←
                    </button>
                    <button onClick={goToToday} className="px-4 py-2 border-2 border-[#006064] text-[#006064] hover:bg-[#006064] hover:text-white transition-colors font-bold text-sm uppercase">
                        {t.today}
                    </button>
                    <button onClick={goToNext} className="p-2 border-2 border-[#006064] text-[#006064] hover:bg-[#006064] hover:text-white transition-colors font-bold">
                        →
                    </button>
                    <span className="ml-4 font-display text-lg text-[#006064]">
                        {view === 'week'
                            ? `${formatDate(weekStart)} - ${formatDate(weekEnd)}`
                            : formatMonthYear(currentDate)
                        }
                    </span>
                </div>

                {/* Filtros y acciones */}
                <div className="flex flex-wrap items-center gap-3">
                    {/* Vista */}
                    <div className="flex border-2 border-[#006064]">
                        <button
                            onClick={() => setView('week')}
                            className={`px-3 py-1 text-sm font-bold ${view === 'week' ? 'bg-[#006064] text-white' : 'text-[#006064]'}`}
                        >
                            {t.week}
                        </button>
                        <button
                            onClick={() => setView('month')}
                            className={`px-3 py-1 text-sm font-bold ${view === 'month' ? 'bg-[#006064] text-white' : 'text-[#006064]'}`}
                        >
                            {t.month}
                        </button>
                    </div>

                    {/* Filtro profesor */}
                    <select
                        value={filterTeacher}
                        onChange={(e) => setFilterTeacher(e.target.value)}
                        className="p-2 border-2 border-[#006064] bg-white text-[#006064] text-sm"
                    >
                        <option value="all">{t.allTeachers}</option>
                        {teachers.map(teacher => (
                            <option key={teacher.id} value={teacher.id}>
                                {teacher.full_name || teacher.email}
                            </option>
                        ))}
                    </select>

                    {/* Botón programar */}
                    <button
                        onClick={() => setIsScheduleModalOpen(true)}
                        className="px-4 py-2 bg-[#006064] text-white font-bold uppercase text-sm border-2 border-[#006064] hover:bg-[#004d40] transition-colors"
                    >
                        + {t.scheduleClass}
                    </button>
                </div>
            </div>

            {/* Vista Semanal */}
            {view === 'week' && (
                <div className="grid grid-cols-7 gap-2">
                    {/* Headers */}
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

                    {/* Celdas */}
                    {weekDays.map((day, index) => {
                        const daySessions = getSessionsForDay(day);

                        return (
                            <div
                                key={`cell-${index}`}
                                className={`min-h-[150px] p-2 border-2 border-[#006064]/20 ${isToday(day) ? 'bg-[#E0F7FA]/50' : 'bg-white'
                                    }`}
                            >
                                {daySessions.map(session => (
                                    <button
                                        key={session.id}
                                        onClick={() => setSelectedSession(session)}
                                        className={`w-full text-left p-2 mb-1 text-xs border-l-4 rounded transition-all hover:scale-[1.02] ${getStatusColor(session.status)} ${getTeacherColor(session.teacher?.id)}`}
                                    >
                                        <p className="font-bold">{formatTime(session.scheduled_at)}</p>
                                        <p className="truncate font-medium">
                                            {session.student?.full_name || session.student?.email?.split('@')[0]}
                                        </p>
                                        <p className="truncate text-[10px] opacity-70">
                                            {session.teacher?.full_name || 'Sin profesor'}
                                        </p>
                                    </button>
                                ))}
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Vista Mensual */}
            {view === 'month' && (
                <div>
                    {/* Headers días */}
                    <div className="grid grid-cols-7 gap-1 mb-1">
                        {t.dayNames.slice(1).concat(t.dayNames[0]).map((day: string, i: number) => (
                            <div key={i} className="p-2 text-center text-xs font-bold text-[#006064]/60 uppercase">
                                {day.substring(0, 3)}
                            </div>
                        ))}
                    </div>

                    {/* Grid del mes */}
                    <div className="grid grid-cols-7 gap-1">
                        {getMonthDays().map((day, index) => {
                            if (!day) {
                                return <div key={index} className="min-h-[80px] bg-gray-50"></div>;
                            }

                            const daySessions = getSessionsForDay(day);

                            return (
                                <div
                                    key={index}
                                    className={`min-h-[80px] p-1 border ${isToday(day)
                                        ? 'bg-[#E0F7FA] border-[#006064]'
                                        : 'bg-white border-gray-200'
                                        }`}
                                >
                                    <p className={`text-xs font-bold mb-1 ${isToday(day) ? 'text-[#006064]' : 'text-gray-500'}`}>
                                        {day.getDate()}
                                    </p>
                                    {daySessions.slice(0, 3).map(session => (
                                        <button
                                            key={session.id}
                                            onClick={() => setSelectedSession(session)}
                                            className={`w-full text-left px-1 py-0.5 mb-0.5 text-[10px] rounded truncate ${getStatusColor(session.status)}`}
                                        >
                                            {formatTime(session.scheduled_at)} {session.student?.full_name?.split(' ')[0] || ''}
                                        </button>
                                    ))}
                                    {daySessions.length > 3 && (
                                        <p className="text-[10px] text-[#006064]/60 text-center">
                                            +{daySessions.length - 3} más
                                        </p>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* Leyenda de profesores */}
            {filterTeacher === 'all' && teachers.length > 0 && (
                <div className="flex flex-wrap gap-4 text-xs">
                    {teachers.map((teacher, index) => {
                        const colors = ['bg-purple-500', 'bg-orange-500', 'bg-pink-500', 'bg-indigo-500', 'bg-teal-500'];
                        return (
                            <div key={teacher.id} className="flex items-center gap-2">
                                <span className={`w-3 h-3 ${colors[index % colors.length]}`}></span>
                                <span className="text-[#006064]/70">{teacher.full_name || teacher.email}</span>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Modales */}
            {isScheduleModalOpen && (
                <AdminScheduleModal
                    isOpen={isScheduleModalOpen}
                    onClose={() => setIsScheduleModalOpen(false)}
                    teachers={teachers}
                    students={students}
                    lang={lang}
                    translations={t}
                    onSessionCreated={handleNewSession}
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
