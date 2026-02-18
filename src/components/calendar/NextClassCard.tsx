import React from 'react';

interface Session {
    id: string;
    scheduled_at: string;
    duration_minutes: number;
    status: string;
    meet_link: string | null;
    drive_doc_url: string | null;
    teacher: {
        full_name: string | null;
        email: string;
    } | null;
}

interface NextClassCardProps {
    session: Session | null;
    lang: string;
    translations: {
        nextClass: string;
        noClasses: string;
        joinClass: string;
        with: string;
        in: string;
        viewAll: string;
        viewDocument?: string;
        unassigned?: string;
        now?: string;
    };
}

export default function NextClassCard({ session, lang, translations: t }: NextClassCardProps) {
    if (!session) {
        return (
            <div className="bg-white p-6 border-2 border-[#006064] shadow-[4px_4px_0px_0px_#006064] flex flex-col justify-between h-full">
                <div className="flex items-center justify-between mb-4">
                    <h3 className="font-bold text-lg text-[#006064] uppercase tracking-wide">{t.nextClass}</h3>
                    <span className="text-2xl">📅</span>
                </div>

                <div className="flex-1 flex flex-col items-center justify-center text-center p-4 border-2 border-dashed border-[#006064]/20 bg-[#E0F7FA]/30 rounded">
                    <p className="text-sm font-bold text-[#006064]/50">{t.noClasses}</p>
                </div>
            </div>
        );
    }

    const sessionDate = new Date(session.scheduled_at);
    const now = new Date();
    const diffMs = sessionDate.getTime() - now.getTime();
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffHours / 24);

    const formatDate = () => {
        return sessionDate.toLocaleDateString(lang === 'es' ? 'es-ES' : lang === 'ru' ? 'ru-RU' : 'en-US', {
            weekday: 'short',
            day: 'numeric',
            month: 'short'
        });
    };

    const formatTime = () => {
        return sessionDate.toLocaleTimeString(lang === 'es' ? 'es-ES' : lang === 'ru' ? 'ru-RU' : 'en-US', {
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    const getTimeUntil = () => {
        const locale = lang === 'es' ? 'es' : lang === 'ru' ? 'ru' : 'en';
        const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'always', style: 'short' });
        if (diffDays > 0) return rtf.format(diffDays, 'day');
        if (diffHours > 0) return rtf.format(diffHours, 'hour');
        const diffMinutes = Math.floor(diffMs / (1000 * 60));
        if (diffMinutes > 0) return rtf.format(diffMinutes, 'minute');
        return t.now || '!';
    };

    const canJoin = () => {
        if (!session.meet_link) return false;
        const minutesUntil = diffMs / (1000 * 60);
        return minutesUntil <= 15 && minutesUntil >= -60;
    };

    const isStartingSoon = diffHours <= 2 && diffHours >= 0;

    return (
        <div className={`bg-white p-6 border-2 border-[#006064] shadow-[4px_4px_0px_0px_#006064] flex flex-col justify-between h-full ${isStartingSoon ? 'ring-2 ring-yellow-400' : ''
            }`}>
            <div>
                <div className="flex items-center justify-between mb-4">
                    <h3 className="font-bold text-lg text-[#006064] uppercase tracking-wide">{t.nextClass}</h3>
                    <span className="text-2xl">📅</span>
                </div>

                {isStartingSoon && (
                    <div className="mb-3 px-2 py-1 bg-yellow-100 text-yellow-800 text-xs font-bold inline-block">
                        ⏰ {getTimeUntil()}
                    </div>
                )}

                <div className="mb-4">
                    <p className="font-display text-2xl text-[#006064]">{formatDate()}</p>
                    <p className="font-mono text-3xl text-[#006064]">{formatTime()}</p>
                </div>

                <p className="text-sm text-[#006064]/70">
                    <span className="text-[#006064]/50">{t.with}:</span>{' '}
                    <strong>{session.teacher?.full_name || session.teacher?.email || t.unassigned || '–'}</strong>
                </p>

                {!isStartingSoon && (
                    <p className="text-xs text-[#006064]/50 mt-2">
                        {getTimeUntil()}
                    </p>
                )}
            </div>

            <div className="mt-4 space-y-2">
                {/* Join Meet button - visible when class is starting soon */}
                {canJoin() && session.meet_link ? (
                    <a
                        href={session.meet_link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center justify-center gap-2 w-full py-3 bg-[#00897B] text-white text-sm font-bold uppercase hover:bg-[#00796B] transition-colors rounded"
                    >
                        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z" />
                        </svg>
                        {t.joinClass}
                    </a>
                ) : null}

                {/* Document link - always visible if exists */}
                {session.drive_doc_url && (
                    <a
                        href={session.drive_doc_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center justify-center gap-2 w-full py-2 bg-[#4285F4] text-white text-sm font-bold uppercase hover:bg-[#3367D6] transition-colors rounded"
                    >
                        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm4 18H6V4h7v5h5v11z" />
                        </svg>
                        {t.viewDocument || '→'}
                    </a>
                )}

                {/* View all classes link */}
                {!canJoin() && (
                    <a
                        href={`/${lang}/campus/classes`}
                        className="block w-full text-center py-2 bg-[#E0F7FA] text-[#006064] text-xs font-bold uppercase border border-[#006064] hover:bg-[#006064] hover:text-white transition-colors"
                    >
                        {t.viewAll} →
                    </a>
                )}
            </div>
        </div>
    );
}
