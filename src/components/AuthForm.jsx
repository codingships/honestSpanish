import React, { useState } from 'react';
import { supabase } from '../lib/supabase';
import { LEGAL_POLICY_VERSION } from '../lib/legal-policy';

// Helper function to get lang from URL at redirect time
const getLangFromUrl = () => {
    if (typeof window === 'undefined') return 'es';
    const pathParts = window.location.pathname.split('/').filter(Boolean);
    const lang = pathParts[0];
    return ['es', 'en', 'ru'].includes(lang) ? lang : 'es';
};

export default function AuthForm({ lang: langProp, translations, initialError }) {
    const lang = langProp || getLangFromUrl();

    // mode: 'login' | 'register' | 'forgotPassword'
    const [mode, setMode] = useState('login');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [adultConfirmed, setAdultConfirmed] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(initialError || null);
    const [successMessage, setSuccessMessage] = useState(null);

    const t = translations;

    const switchMode = (newMode) => {
        setMode(newMode);
        setError(null);
        setSuccessMessage(null);
        setAdultConfirmed(false);
    };

    const handleForgotPassword = async (e) => {
        e.preventDefault();
        setLoading(true);
        setError(null);
        setSuccessMessage(null);
        const normalizedEmail = email.trim();

        try {
            // Best practice: don't reveal if email exists. Always show success.
            // Errors are intentionally swallowed to avoid email enumeration attacks.
            await supabase.auth.resetPasswordForEmail(normalizedEmail, {
                redirectTo: `${window.location.origin}/${lang}/reset-password`,
            });
        } catch (err) {
            void err;
        } finally {
            setLoading(false);
            // Always show success regardless of outcome
            setSuccessMessage(t.auth.success.resetEmailSent);
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        setError(null);
        setSuccessMessage(null);
        const normalizedEmail = email.trim();

        if (mode === 'register' && !adultConfirmed) {
            setError(t.auth.error.adultRequired);
            setLoading(false);
            return;
        }

        try {
            if (mode === 'login') {
                const { error } = await supabase.auth.signInWithPassword({
                    email: normalizedEmail,
                    password,
                });
                if (error) throw error;

                const currentLang = lang;
                window.location.href = `/api/auth/post-login?lang=${currentLang}`;
            } else {
                const fullName = normalizedEmail.split('@')[0];
                const currentLang = lang;
                const confirmationUrl = new URL('/api/auth/confirm', window.location.origin);
                confirmationUrl.searchParams.set('lang', currentLang);

                const { data, error } = await supabase.auth.signUp({
                    email: normalizedEmail,
                    password,
                    options: {
                        emailRedirectTo: confirmationUrl.toString(),
                        data: {
                            full_name: fullName,
                            adult_confirmed: true,
                            adult_confirmed_at: new Date().toISOString(),
                            age_policy_version: LEGAL_POLICY_VERSION,
                        }
                    }
                });
                if (error) throw error;

                if (data?.session) {
                    window.location.href = `/api/auth/post-login?lang=${currentLang}`;
                } else {
                    setSuccessMessage(t.auth.success.registered);
                }
            }
        } catch (err) {
            if (err.message && err.message.includes("Invalid login credentials")) {
                setError(t.auth.error.invalidCredentials);
            } else if (err.message && err.message.includes("User already registered")) {
                setError(t.auth.error.emailTaken);
            } else {
                setError(t.auth.error.generic);
            }
        } finally {
            setLoading(false);
        }
    };

    const s = {
        bg: 'bg-[#E0F7FA]',
        text: 'text-[#006064]',
        accent: 'bg-[#006064]',
        accentText: 'text-white',
        border: 'border-[#006064]',
        inputBorder: 'border-[#006064]',
        button: 'bg-[#006064] text-white hover:bg-[#004d40]',
    };

    // ---------- FORGOT PASSWORD MODE ----------
    if (mode === 'forgotPassword') {
        return (
            <div className="w-full max-w-md mx-auto relative">
                <a href={`/${lang}`} className="absolute -top-10 left-0 text-[#006064] text-sm font-bold font-mono hover:opacity-70 transition-opacity">
                    ← {t.auth.backHome}
                </a>
                <div className="bg-white p-8 border-2 border-[#006064] shadow-[4px_4px_0px_0px_#006064]">
                    <div className="text-center mb-6">
                        <h1 className="font-display text-3xl text-[#006064] uppercase mb-2">
                            {t.auth.resetPassword}
                        </h1>
                        <p className="text-sm text-[#006064]">
                            {t.auth.resetPasswordInstructions}
                        </p>
                    </div>

                    {error && (
                        <div role="alert" className="mb-4 p-3 bg-red-100 border-2 border-red-500 text-red-700 font-bold text-sm">
                            {error}
                        </div>
                    )}

                    {successMessage && (
                        <div role="status" className="mb-4 p-3 bg-green-100 border-2 border-green-500 text-green-700 font-bold text-sm">
                            {successMessage}
                        </div>
                    )}

                    <form onSubmit={handleForgotPassword} className="space-y-6">
                        <div>
                            <label htmlFor="reset-email" className="block font-mono text-xs uppercase tracking-wide text-[#006064] mb-2 font-bold">
                                {t.auth.email}
                            </label>
                            <input
                                id="reset-email"
                                name="email"
                                type="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                required
                                className={`w-full p-3 border-2 ${s.inputBorder} focus:outline-none focus:ring-4 focus:ring-[#006064] focus:ring-offset-2 font-sans text-lg text-[#006064] placeholder-[#006064]/50`}
                                placeholder={t.auth.emailPlaceholder}
                            />
                        </div>

                        <button
                            type="submit"
                            disabled={loading}
                            aria-busy={loading}
                            className={`w-full py-4 ${s.button} font-bold text-sm uppercase tracking-widest border-2 border-[#006064] shadow-[4px_4px_0px_0px_#006064] hover:shadow-none hover:translate-x-[2px] hover:translate-y-[2px] transition-all disabled:opacity-50 disabled:cursor-not-allowed`}
                        >
                            {loading ? '...' : t.auth.sendResetLink}
                        </button>
                    </form>

                    <div className="mt-6 text-center">
                        <button
                            type="button"
                            onClick={() => switchMode('login')}
                            disabled={loading}
                            className="text-sm font-bold text-[#006064] underline hover:opacity-70"
                        >
                            {t.auth.backToLogin}
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    // ---------- LOGIN / REGISTER MODE ----------
    return (
        <div className="w-full max-w-md mx-auto relative">
            <a href={`/${lang}`} className="absolute -top-10 left-0 text-[#006064] text-sm font-bold font-mono hover:opacity-70 transition-opacity">
                ← {t.auth.backHome}
            </a>
            <div className="bg-white p-8 border-2 border-[#006064] shadow-[4px_4px_0px_0px_#006064]">
                <div className="text-center mb-8">
                    <h1 className="font-display text-3xl text-[#006064] uppercase mb-2">
                        {mode === 'login' ? t.auth.login : t.auth.register}
                    </h1>
                </div>

                {error && (
                    <div role="alert" className="mb-4 p-3 bg-red-100 border-2 border-red-500 text-red-700 font-bold text-sm">
                        {error}
                    </div>
                )}

                {successMessage && (
                    <div role="status" className="mb-4 p-3 bg-green-100 border-2 border-green-500 text-green-700 font-bold text-sm">
                        {successMessage}
                    </div>
                )}

                <form onSubmit={handleSubmit} className="space-y-6">
                    <div>
                        <label htmlFor="auth-email" className="block font-mono text-xs uppercase tracking-wide text-[#006064] mb-2 font-bold">
                            {t.auth.email}
                        </label>
                        <input
                            id="auth-email"
                            name="email"
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            required
                            className={`w-full p-3 border-2 ${s.inputBorder} focus:outline-none focus:ring-4 focus:ring-[#006064] focus:ring-offset-2 font-sans text-lg text-[#006064] placeholder-[#006064]/50`}
                            placeholder={t.auth.emailPlaceholder}
                        />
                    </div>

                    <div>
                        <label htmlFor="auth-password" className="block font-mono text-xs uppercase tracking-wide text-[#006064] mb-2 font-bold">
                            {t.auth.password}
                        </label>
                        <input
                            id="auth-password"
                            name="password"
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            required
                            className={`w-full p-3 border-2 ${s.inputBorder} focus:outline-none focus:ring-4 focus:ring-[#006064] focus:ring-offset-2 font-sans text-lg text-[#006064]`}
                            placeholder="••••••••"
                        />
                    </div>

                    {mode === 'register' && (
                        <label className="flex items-start gap-3 text-xs leading-5 text-[#006064]/80">
                            <input
                                type="checkbox"
                                checked={adultConfirmed}
                                onChange={(event) => setAdultConfirmed(event.currentTarget.checked)}
                                aria-required="true"
                                className="mt-1 h-4 w-4 border-2 border-[#006064] text-[#006064] focus:ring-[#006064]/20"
                            />
                            <span>{t.auth.adultConfirmation}</span>
                        </label>
                    )}

                    <button
                        type="submit"
                        disabled={loading}
                        aria-busy={loading}
                        className={`w-full py-4 ${s.button} font-bold text-sm uppercase tracking-widest border-2 border-[#006064] shadow-[4px_4px_0px_0px_#006064] hover:shadow-none hover:translate-x-[2px] hover:translate-y-[2px] transition-all disabled:opacity-50 disabled:cursor-not-allowed`}
                    >
                        {loading ? '...' : (mode === 'login' ? t.auth.submitLogin : t.auth.submitRegister)}
                    </button>
                </form>

                <div className="mt-6 text-center text-sm font-sans text-[#006064]">
                    <p>
                        {mode === 'login' ? t.auth.noAccount : t.auth.hasAccount}{' '}
                        <button
                            type="button"
                            onClick={() => switchMode(mode === 'login' ? 'register' : 'login')}
                            disabled={loading}
                            className="font-bold underline hover:opacity-70"
                        >
                            {mode === 'login' ? t.auth.register : t.auth.login}
                        </button>
                    </p>
                </div>

                {mode === 'login' && (
                    <div className="mt-2 text-center text-xs font-mono text-[#006064]/60">
                        <button
                            type="button"
                            onClick={() => switchMode('forgotPassword')}
                            disabled={loading}
                            className="text-[#006064] hover:underline"
                        >
                            {t.auth.forgotPassword}
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
