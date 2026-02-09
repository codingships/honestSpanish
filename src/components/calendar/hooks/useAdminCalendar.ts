import { useState } from 'react';

// Interfaces compartidas (extraídas del componente original)
export interface Session {
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

export interface Teacher {
    id: string;
    full_name: string | null;
    email: string;
}

export interface Student {
    id: string;
    full_name: string | null;
    email: string;
}

export function useAdminCalendar(initialSessions: Session[]) {
    const [sessions, setSessions] = useState<Session[]>(initialSessions);
    const [view, setView] = useState<'week' | 'month'>('week');
    const [filterTeacher, setFilterTeacher] = useState<string>('all');
    const [currentDate, setCurrentDate] = useState(new Date());

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

    // Data Calculation Helpers
    const getWeekDays = () => {
        return Array.from({ length: 7 }, (_, i) => {
            const day = new Date(weekStart);
            day.setDate(weekStart.getDate() + i);
            return day;
        });
    };

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

    // Filtrado
    const filteredSessions = sessions.filter(s => {
        if (filterTeacher !== 'all' && s.teacher?.id !== filterTeacher) {
            return false;
        }
        return true;
    });

    const getSessionsForDay = (date: Date | null) => {
        if (!date) return [];
        // Usar fecha local en vez de UTC para evitar problemas de timezone
        const dayKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
        return filteredSessions.filter(s => {
            const sessionDate = new Date(s.scheduled_at);
            const sessionDayKey = `${sessionDate.getFullYear()}-${String(sessionDate.getMonth() + 1).padStart(2, '0')}-${String(sessionDate.getDate()).padStart(2, '0')}`;
            return sessionDayKey === dayKey;
        }).sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime());
    };

    // Handlers de actualización
    const handleSessionUpdate = (updatedSession: Session) => {
        setSessions(sessions.map(s => s.id === updatedSession.id ? updatedSession : s));
    };

    const handleNewSession = (newSession: Session) => {
        setSessions([...sessions, newSession]);
    };

    return {
        // State
        sessions,
        view,
        filterTeacher,
        currentDate,
        weekStart,
        // Actions
        setView,
        setFilterTeacher,
        goToPrev,
        goToNext,
        goToToday,
        handleSessionUpdate,
        handleNewSession,
        // Helpers / Computed
        getWeekDays,
        getMonthDays,
        getSessionsForDay,
        weekEnd: (() => {
            const end = new Date(weekStart);
            end.setDate(weekStart.getDate() + 6);
            return end;
        })()
    };
}