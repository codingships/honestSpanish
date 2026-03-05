import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

export default function ResetPasswordForm({ lang, translations }) {
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [success, setSuccess] = useState(false);
    const [sessionReady, setSessionReady] = useState(false);

    const t = translations;

    // Supabase automatically handles the token from the URL hash
    useEffect(() => {
        const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
            if (event === 'PASSWORD_RECOVERY') {
                setSessionReady(true);
            }
        });

        return () => subscription.unsubscribe();
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
            setError(err.message || 'An error occurred');
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
            <div className="w-full max-w-md mx-auto bg-white p-8 border-2 border-[#006064] shadow-[4px_4px_0px_0px_#006064] text-center">
                <div className="text-4xl mb-4">✅</div>
                <h2 className="font-display text-2xl text-[#006064] uppercase mb-4">
                    {t.auth.success.passwordChanged}
                </h2>
                <a
                    href={`/${lang}/login`}
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
                <h2 className="font-display text-3xl text-[#006064] uppercase mb-2">
                    {t.auth.resetPassword}
                </h2>
            </div>

            {error && (
                <div className="mb-4 p-3 bg-red-100 border-2 border-red-500 text-red-700 font-bold text-sm">
                    {error}
                </div>
            )}

            {!sessionReady && (
                <div className="mb-4 p-3 bg-yellow-100 border-2 border-yellow-500 text-yellow-700 font-bold text-sm text-center">
                    ⏳ {lang === 'es' ? 'Verificando enlace...' : lang === 'ru' ? 'Проверяем ссылку...' : 'Verifying link...'}
                </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-6">
                <div>
                    <label className="block font-mono text-xs uppercase tracking-wide text-[#006064] mb-2 font-bold">
                        {t.auth.newPassword}
                    </label>
                    <input
                        type="password"
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        required
                        minLength={6}
                        className={`w-full p-3 border-2 ${s.inputBorder} focus:outline-none focus:ring-2 focus:ring-[#006064]/20 font-sans text-lg text-[#006064]`}
                        placeholder="••••••••"
                    />
                </div>

                <div>
                    <label className="block font-mono text-xs uppercase tracking-wide text-[#006064] mb-2 font-bold">
                        {t.auth.confirmNewPassword}
                    </label>
                    <input
                        type="password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        required
                        minLength={6}
                        className={`w-full p-3 border-2 ${s.inputBorder} focus:outline-none focus:ring-2 focus:ring-[#006064]/20 font-sans text-lg text-[#006064]`}
                        placeholder="••••••••"
                    />
                </div>

                <button
                    type="submit"
                    disabled={loading || !sessionReady}
                    className={`w-full py-4 ${s.button} font-bold text-sm uppercase tracking-widest border-2 border-[#006064] shadow-[4px_4px_0px_0px_#006064] hover:shadow-none hover:translate-x-[2px] hover:translate-y-[2px] transition-all disabled:opacity-50 disabled:cursor-not-allowed`}
                >
                    {loading ? '...' : t.auth.resetPassword}
                </button>
            </form>
        </div>
    );
}
