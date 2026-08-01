import React, { useState, useEffect, useId } from 'react';
import { supabase } from '../lib/supabase';
import { appendAuthReturnTo, sanitizeAuthReturnTo } from '../lib/auth-return-to';

/**
 * @param {{
 *   lang: 'es' | 'en' | 'ru';
 *   translations: any;
 *   returnTo?: string | null;
 * }} props
 */
export default function ResetPasswordForm({ lang, translations, returnTo: requestedReturnTo = null }) {
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [success, setSuccess] = useState(false);
    const [sessionReady, setSessionReady] = useState(false);
    const [sessionChecked, setSessionChecked] = useState(false);

    const t = translations;
    const returnTo = sanitizeAuthReturnTo(requestedReturnTo);
    const loginUrl = appendAuthReturnTo(`/${lang}/login`, returnTo);
    const formId = useId();
    const titleId = `${formId}-title`;
    const newPasswordId = `${formId}-new-password`;
    const confirmPasswordId = `${formId}-confirm-password`;
    const errorId = `${formId}-error`;
    const sessionNoticeId = `${formId}-session-notice`;
    const recoveryCopy = {
        es: {
            verifying: 'Verificando enlace...',
            invalid: 'Este enlace no es válido o ha caducado. Pide un nuevo enlace desde iniciar sesión.',
        },
        en: {
            verifying: 'Verifying link...',
            invalid: 'This link is invalid or has expired. Request a new link from login.',
        },
        ru: {
            verifying: 'Проверяем ссылку...',
            invalid: 'Эта ссылка недействительна или истекла. Запросите новую ссылку на странице входа.',
        },
    }[lang] || {
        verifying: 'Verifying link...',
        invalid: 'This link is invalid or has expired. Request a new link from login.',
    };

    // Supabase automatically handles the token from the URL hash
    useEffect(() => {
        let mounted = true;
        const markSessionReady = (event, session) => {
            if (!mounted) return;
            if (event === 'PASSWORD_RECOVERY' || session) {
                setSessionReady(true);
            }
            setSessionChecked(true);
        };

        const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
            markSessionReady(event, session);
        });

        supabase.auth.getSession?.()
            .then(({ data }) => {
                if (!mounted) return;
                if (data?.session) {
                    setSessionReady(true);
                }
                setSessionChecked(true);
            })
            .catch(() => {
                if (mounted) setSessionChecked(true);
            });

        return () => {
            mounted = false;
            subscription.unsubscribe();
        };
    }, []);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError(null);

        if (newPassword.length < 6) {
            setError(t.auth.passwordTooShort);
            return;
        }

        if (newPassword !== confirmPassword) {
            setError(t.auth.passwordsDoNotMatch);
            return;
        }

        setLoading(true);

        try {
            const { error } = await supabase.auth.updateUser({
                password: newPassword,
            });
            if (error) throw error;
            setSuccess(true);
        } catch (err) {
            console.error(err);
            setError(t.auth.error.generic);
        } finally {
            setLoading(false);
        }
    };

    const s = {
        inputBorder: 'border-[#006064]',
        button: 'bg-[#006064] text-white hover:bg-[#004d40]',
    };

    if (success) {
        return (
            <div role="status" aria-live="polite" className="w-full max-w-md mx-auto bg-white p-8 border-2 border-[#006064] shadow-[4px_4px_0px_0px_#006064] text-center">
                <div className="text-4xl mb-4" aria-hidden="true">✅</div>
                <h1 className="font-display text-2xl text-[#006064] uppercase mb-4">
                    {t.auth.success.passwordChanged}
                </h1>
                <a
                    href={loginUrl}
                    className="inline-block bg-[#006064] text-white px-6 py-3 font-bold text-sm uppercase border-2 border-[#006064] hover:bg-[#004d40] transition-colors"
                >
                    {t.auth.login}
                </a>
            </div>
        );
    }

    return (
        <div className="w-full max-w-md mx-auto bg-white p-8 border-2 border-[#006064] shadow-[4px_4px_0px_0px_#006064]">
            <div className="text-center mb-6">
                <h1 id={titleId} className="font-display text-2xl sm:text-3xl leading-tight text-[#006064] uppercase mb-2">
                    {t.auth.resetPassword}
                </h1>
            </div>

            {error && (
                <div id={errorId} role="alert" className="mb-4 p-3 bg-red-100 border-2 border-red-500 text-red-700 font-bold text-sm">
                    {error}
                </div>
            )}

            {!sessionReady && (
                <div
                    id={sessionNoticeId}
                    role={sessionChecked ? 'alert' : 'status'}
                    aria-live="polite"
                    className="mb-4 p-3 bg-yellow-100 border-2 border-yellow-500 text-yellow-700 font-bold text-sm text-center"
                >
                    <span aria-hidden="true">⏳</span> {sessionChecked ? recoveryCopy.invalid : recoveryCopy.verifying}
                    {sessionChecked && (
                        <>
                            {' '}
                            <a href={loginUrl} className="underline hover:opacity-70">
                                {t.auth.login}
                            </a>
                        </>
                    )}
                </div>
            )}

            <form
                onSubmit={handleSubmit}
                aria-labelledby={titleId}
                aria-busy={loading}
                aria-describedby={error ? errorId : !sessionReady ? sessionNoticeId : undefined}
                className="space-y-6"
            >
                <div>
                    <label htmlFor={newPasswordId} className="block font-mono text-xs uppercase tracking-wide text-[#006064] mb-2 font-bold">
                        {t.auth.newPassword}
                    </label>
                    <input
                        id={newPasswordId}
                        name="newPassword"
                        type="password"
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        required
                        minLength={6}
                        autoComplete="new-password"
                        disabled={loading || !sessionReady}
                        aria-describedby={error ? errorId : undefined}
                        className={`w-full p-3 border-2 ${s.inputBorder} focus:outline-none focus:ring-4 focus:ring-[#006064] focus:ring-offset-2 font-sans text-lg text-[#006064]`}
                        placeholder="••••••••"
                    />
                </div>

                <div>
                    <label htmlFor={confirmPasswordId} className="block font-mono text-xs uppercase tracking-wide text-[#006064] mb-2 font-bold">
                        {t.auth.confirmNewPassword}
                    </label>
                    <input
                        id={confirmPasswordId}
                        name="confirmPassword"
                        type="password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        required
                        minLength={6}
                        autoComplete="new-password"
                        disabled={loading || !sessionReady}
                        aria-describedby={error ? errorId : undefined}
                        className={`w-full p-3 border-2 ${s.inputBorder} focus:outline-none focus:ring-4 focus:ring-[#006064] focus:ring-offset-2 font-sans text-lg text-[#006064]`}
                        placeholder="••••••••"
                    />
                </div>

                <button
                    type="submit"
                    disabled={loading || !sessionReady}
                    aria-busy={loading}
                    className={`w-full py-4 ${s.button} font-bold text-sm uppercase tracking-widest border-2 border-[#006064] shadow-[4px_4px_0px_0px_#006064] hover:shadow-none hover:translate-x-[2px] hover:translate-y-[2px] transition-all disabled:opacity-50 disabled:cursor-not-allowed`}
                >
                    {loading ? '...' : t.auth.resetPassword}
                </button>
            </form>
        </div>
    );
}
