import React, { useEffect, useId, useState } from 'react';
import StudentCancelModal from './StudentCancelModal';
import { isClassJoinWindowOpen } from '../../lib/class-access';

interface Session {
    id: string;
    scheduled_at: string;
    duration_minutes: number;
    status: string;
    meet_link: string | null;
    drive_doc_url: string | null;
    teacher_notes: string | null;
    teacher: {
        id: string;
        full_name: string | null;
        email: string;
    } | null;
}

interface StudentClassListProps {
    upcomingSessions: Session[];
    pastSessions: Session[];
    lang: string;
    translations: Record<string, unknown>;
}

const localeForLang = (lang: string) => (lang === 'es' ? 'es-ES' : lang === 'ru' ? 'ru-RU' : 'en-US');
const safeDomId = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, '-') || 'session';

export default function StudentClassList({
    upcomingSessions: initialUpcoming,
    pastSessions: initialPast,
    lang,
    translations: tProp
}: StudentClassListProps) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const t = tProp as Record<string, any>;
    const tabsId = useId();
    const upcomingTabId = `${tabsId}-upcoming-tab`;
    const pastTabId = `${tabsId}-past-tab`;
    const upcomingPanelId = `${tabsId}-upcoming-panel`;
    const pastPanelId = `${tabsId}-past-panel`;

    const [upcomingSessions, setUpcomingSessions] = useState(initialUpcoming);
    const [pastSessions, setPastSessions] = useState(initialPast);
    const [activeTab, setActiveTab] = useState<'upcoming' | 'past'>('upcoming');
    const [cancelModalSession, setCancelModalSession] = useState<Session | null>(null);
    const [mounted, setMounted] = useState(false);
    const [now, setNow] = useState(() => new Date());

    useEffect(() => {
        setUpcomingSessions(initialUpcoming);
    }, [initialUpcoming]);

    useEffect(() => {
        setPastSessions(initialPast);
    }, [initialPast]);

    useEffect(() => {
        setMounted(true);
        setNow(new Date());

        const intervalId = window.setInterval(() => {
            setNow(new Date());
        }, 60 * 1000);

        return () => window.clearInterval(intervalId);
    }, []);

    const formatDate = (dateStr: string) => {
        if (!mounted) return '...';
        return new Date(dateStr).toLocaleDateString(localeForLang(lang), {
            weekday: 'long',
            day: 'numeric',
            month: 'long'
        });
    };

    const formatTime = (dateStr: string) => {
        if (!mounted) return '--:--';
        return new Date(dateStr).toLocaleTimeString(localeForLang(lang), {
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    const getStatusBadge = (status: string) => {
        switch (status) {
            case 'completed':
                return { text: t.status?.completed || 'Completed', class: 'bg-green-100 text-green-700' };
            case 'cancelled':
                return { text: t.status?.cancelled || 'Cancelled', class: 'bg-gray-100 text-gray-500' };
            case 'no_show':
                return { text: t.status?.noShow || 'No show', class: 'bg-red-100 text-red-700' };
            default:
                return { text: t.status?.scheduled || 'Scheduled', class: 'bg-blue-100 text-blue-700' };
        }
    };

    const canCancel = (session: Session) => {
        return session.status === 'scheduled';
    };

    const isLateCancellation = (session: Session) => {
        const sessionTime = new Date(session.scheduled_at);
        const hoursUntil = (sessionTime.getTime() - now.getTime()) / (1000 * 60 * 60);
        return hoursUntil < 24;
    };

    const canJoin = (session: Session) => {
        if (!session.meet_link || session.status !== 'scheduled') return false;
        return isClassJoinWindowOpen(session.scheduled_at, session.duration_minutes, now);
    };

    const isStartingSoon = (session: Session) => {
        const sessionTime = new Date(session.scheduled_at);
        const hoursUntil = (sessionTime.getTime() - now.getTime()) / (1000 * 60 * 60);
        return hoursUntil <= 24 && hoursUntil > 0;
    };

    const handleCancelSuccess = (sessionId: string) => {
        setUpcomingSessions((currentUpcoming) => {
            const cancelledSession = currentUpcoming.find((session) => session.id === sessionId);
            if (cancelledSession) {
                setPastSessions((currentPast) => [
                    { ...cancelledSession, status: 'cancelled' },
                    ...currentPast,
                ]);
            }

            return currentUpcoming.filter((session) => session.id !== sessionId);
        });
        setCancelModalSession(null);
    };

    const renderSessionCard = (session: Session, isUpcoming: boolean) => {
        const statusBadge = getStatusBadge(session.status);
        const showJoinButton = isUpcoming && canJoin(session);
        const showCancelButton = isUpcoming && canCancel(session);
        const lateCancellation = isUpcoming && isLateCancellation(session);
        const startingSoon = isUpcoming && isStartingSoon(session);
        const sessionDomId = safeDomId(session.id);
        const dateId = `student-class-${sessionDomId}-date`;
        const timeId = `student-class-${sessionDomId}-time`;
        const statusId = `student-class-${sessionDomId}-status`;
        const sessionLabel = `${formatDate(session.scheduled_at)} ${formatTime(session.scheduled_at)}`;
        const teacherName = session.teacher?.full_name || session.teacher?.email || t.unassigned;
        const viewDocumentLabel = t.viewDocument || 'Document';

        return (
            <article
                key={session.id}
                aria-labelledby={`${dateId} ${timeId}`}
                aria-describedby={statusId}
                className={`bg-white p-6 border-2 border-[#006064] shadow-[4px_4px_0px_0px_#006064] ${startingSoon ? 'ring-2 ring-yellow-400' : ''
                    }`}
            >
                {startingSoon && (
                    <div className="mb-3 px-3 py-1 bg-yellow-100 text-yellow-800 text-xs font-bold inline-block">
                        <span aria-hidden="true">&#9200;</span> {t.startingSoon}
                    </div>
                )}

                <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
                    <div className="flex-1">
                        <div className="flex items-center gap-3 mb-2">
                            <time
                                id={dateId}
                                dateTime={session.scheduled_at}
                                className="font-display text-xl text-[#006064]"
                            >
                                {formatDate(session.scheduled_at)}
                            </time>
                            <span
                                id={statusId}
                                className={`px-2 py-0.5 text-xs font-bold rounded ${statusBadge.class}`}
                            >
                                {statusBadge.text}
                            </span>
                        </div>

                        <time
                            id={timeId}
                            dateTime={session.scheduled_at}
                            className="block font-mono text-2xl text-[#006064] mb-2"
                        >
                            {formatTime(session.scheduled_at)}
                        </time>

                        <div className="text-sm text-[#006064]/70 space-y-1">
                            <p>
                                <span className="text-[#006064]/50">{t.with}:</span>{' '}
                                <strong>{teacherName}</strong>
                            </p>
                            <p>
                                <span className="text-[#006064]/50">{t.duration}:</span>{' '}
                                {session.duration_minutes} {t.minutes}
                            </p>
                        </div>

                        {!isUpcoming && session.teacher_notes && (
                            <div className="mt-4 p-3 bg-[#E0F7FA] border border-[#006064]/20">
                                <p className="text-xs font-mono uppercase text-[#006064]/50 mb-1">
                                    {t.teacherNotes}
                                </p>
                                <p className="text-sm text-[#006064]">{session.teacher_notes}</p>
                            </div>
                        )}
                    </div>

                    {isUpcoming && session.status === 'scheduled' && (
                        <div className="flex flex-col gap-2">
                            {showJoinButton && session.meet_link && (
                                <a
                                    href={session.meet_link}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    aria-label={`${t.joinClass}: ${sessionLabel}`}
                                    className="flex items-center justify-center gap-2 px-6 py-3 bg-[#006064] text-white font-bold uppercase text-sm hover:bg-[#004d40] transition-colors rounded"
                                >
                                    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                                        <path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z" />
                                    </svg>
                                    {t.joinClass}
                                </a>
                            )}

                            {!showJoinButton && session.meet_link && (
                                <div
                                    role="status"
                                    aria-label={`${t.linkAvailableSoon}: ${sessionLabel}`}
                                    className="px-6 py-3 bg-gray-100 text-gray-500 font-bold uppercase text-sm text-center rounded"
                                >
                                    <span aria-hidden="true">&#127909;</span> {t.linkAvailableSoon}
                                </div>
                            )}

                            {session.drive_doc_url && (
                                <a
                                    href={session.drive_doc_url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    aria-label={`${viewDocumentLabel}: ${sessionLabel}`}
                                    className="flex items-center justify-center gap-2 px-6 py-2 bg-[#4285F4] text-white font-bold uppercase text-sm hover:bg-[#3367D6] transition-colors rounded"
                                >
                                    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                                        <path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm4 18H6V4h7v5h5v11z" />
                                    </svg>
                                    {viewDocumentLabel}
                                </a>
                            )}

                            {showCancelButton && (
                                <>
                                    <button
                                        type="button"
                                        onClick={() => setCancelModalSession(session)}
                                        aria-label={`${t.cancelClass}: ${sessionLabel}`}
                                        className="px-6 py-3 bg-white text-red-600 font-bold uppercase text-sm text-center border-2 border-red-600 hover:bg-red-50 transition-colors"
                                    >
                                        {t.cancelClass}
                                    </button>
                                    {lateCancellation && (
                                        <p className="text-xs text-amber-700 text-center font-semibold">
                                            {t.cancelLateNotice || t.cancelUnavailable}
                                        </p>
                                    )}
                                </>
                            )}
                        </div>
                    )}
                </div>
            </article>
        );
    };

    return (
        <div>
            <div className="flex border-b-2 border-[#006064] mb-6" role="tablist" aria-label={`${t.upcoming} / ${t.past}`}>
                <button
                    id={upcomingTabId}
                    type="button"
                    role="tab"
                    aria-selected={activeTab === 'upcoming'}
                    aria-controls={upcomingPanelId}
                    onClick={() => setActiveTab('upcoming')}
                    className={`px-6 py-3 font-bold text-sm uppercase transition-colors ${activeTab === 'upcoming'
                        ? 'border-b-4 border-[#006064] text-[#006064] bg-white -mb-[2px]'
                        : 'text-[#006064]/60 hover:text-[#006064]'
                        }`}
                >
                    <span aria-hidden="true">&#128197;</span> {t.upcoming} ({upcomingSessions.length})
                </button>
                <button
                    id={pastTabId}
                    type="button"
                    role="tab"
                    aria-selected={activeTab === 'past'}
                    aria-controls={pastPanelId}
                    onClick={() => setActiveTab('past')}
                    className={`px-6 py-3 font-bold text-sm uppercase transition-colors ${activeTab === 'past'
                        ? 'border-b-4 border-[#006064] text-[#006064] bg-white -mb-[2px]'
                        : 'text-[#006064]/60 hover:text-[#006064]'
                        }`}
                >
                    <span aria-hidden="true">&#128218;</span> {t.past} ({pastSessions.length})
                </button>
            </div>

            {activeTab === 'upcoming' && (
                <div
                    id={upcomingPanelId}
                    role="tabpanel"
                    aria-labelledby={upcomingTabId}
                    className="space-y-4"
                >
                    {upcomingSessions.length === 0 ? (
                        <div className="bg-white p-12 border-2 border-[#006064] shadow-[4px_4px_0px_0px_#006064] text-center">
                            <p className="text-[#006064]/60 font-mono">{t.noUpcoming}</p>
                        </div>
                    ) : (
                        upcomingSessions.map((session) => renderSessionCard(session, true))
                    )}
                </div>
            )}

            {activeTab === 'past' && (
                <div
                    id={pastPanelId}
                    role="tabpanel"
                    aria-labelledby={pastTabId}
                    className="space-y-4"
                >
                    {pastSessions.length === 0 ? (
                        <div className="bg-white p-12 border-2 border-[#006064] shadow-[4px_4px_0px_0px_#006064] text-center">
                            <p className="text-[#006064]/60 font-mono">{t.noPast}</p>
                        </div>
                    ) : (
                        pastSessions.map((session) => renderSessionCard(session, false))
                    )}
                </div>
            )}

            {cancelModalSession && (
                <StudentCancelModal
                    isOpen={!!cancelModalSession}
                    onClose={() => setCancelModalSession(null)}
                    session={cancelModalSession}
                    lang={lang}
                    translations={t}
                    onSuccess={handleCancelSuccess}
                />
            )}
        </div>
    );
}
