import React, { useState } from 'react';
import { supabase } from '../lib/supabase';

// Helper function to get lang from URL at redirect time
const getLangFromUrl = () => {
    if (typeof window === 'undefined') return 'es';
    const pathParts = window.location.pathname.split('/').filter(Boolean);
    const lang = pathParts[0];
    return ['es', 'en', 'ru'].includes(lang) ? lang : 'es';
};

export default function AuthForm({ lang: langProp, translations }) {
    const lang = langProp || getLangFromUrl();

    // mode: 'login' | 'register' | 'forgotPassword'
    const [mode, setMode] = useState('login');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [successMessage, setSuccessMessage] = useState(null);

    const t = translations;

    const switchMode = (newMode) => {
        setMode(newMode);
        setError(null);
        setSuccessMessage(null);
    };

    const handleForgotPassword = async (e) => {
        e.preventDefault();
        setLoading(true);
        setError(null);
        setSuccessMessage(null);

        try {
            const { error } = await supabase.auth.resetPasswordForEmail(email, {
                redirectTo: `${window.location.origin}/${lang}/reset-password`,
            });
            if (error) throw error;
            setSuccessMessage(t.auth.success.resetEmailSent);
        } catch (err) {
            console.error(err);
            setError(err.message || 'An error occurred');
        } finally {
            setLoading(false);
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        setError(null);
        setSuccessMessage(null);

        try {
            if (mode === 'login') {
                const { error } = await supabase.auth.signInWithPassword({
                    email,
                    password,
                });
                if (error) throw error;

                const currentLang = getLangFromUrl();
                window.location.href = `/api/auth/post-login?lang=${currentLang}`;
            } else {
                const fullName = email.split('@')[0];

                const { data, error } = await supabase.auth.signUp({
                    email,
                    password,
                    options: {
                        data: {
                            full_name: fullName,
                        }
                    }
                });
                if (error) throw error;

                if (data?.session) {
                    window.location.href = `/api/auth/post-login?lang=${getLangFromUrl()}`;
                } else if (data?.user && !data?.user?.identities?.length === 0) {
                    setSuccessMessage(t.auth.success.registered);
                } else {
                    const { error: loginError } = await supabase.auth.signInWithPassword({
                        email,
                        password,
                    });
                    if (!loginError) {
                        window.location.href = `/api/auth/post-login?lang=${getLangFromUrl()}`;
                    } else {
                        setSuccessMessage(t.auth.success.registered);
                    }
                }
            }
        } catch (err) {
            console.error(err);
            if (err.message && err.message.includes("Invalid login credentials")) {
                setError(t.auth.error.invalidCredentials);
            } else if (err.message && err.message.includes("User already registered")) {
                setError(t.auth.error.emailTaken);
            } else {
                setError(err.message || "An error occurred");
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
            <div className="w-full max-w-md mx-auto bg-white p-8 border-2 border-[#006064] shadow-[4px_4px_0px_0px_#006064]">
                <div className="text-center mb-6">
                    <h2 className="font-display text-3xl text-[#006064] uppercase mb-2">
                        {t.auth.resetPassword}
                    </h2>
                    <p className="text-sm text-[#006064]/70">
                        {t.auth.resetPasswordInstructions}
                    </p>
                </div>

                {error && (
                    <div className="mb-4 p-3 bg-red-100 border-2 border-red-500 text-red-700 font-bold text-sm">
                        {error}
                    </div>
                )}

                {successMessage && (
                    <div className="mb-4 p-3 bg-green-100 border-2 border-green-500 text-green-700 font-bold text-sm">
                        {successMessage}
                    </div>
                )}

                <form onSubmit={handleForgotPassword} className="space-y-6">
                    <div>
                        <label className="block font-mono text-xs uppercase tracking-wide text-[#006064] mb-2 font-bold">
                            {t.auth.email}
                        </label>
                        <input
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            required
                            className={`w-full p-3 border-2 ${s.inputBorder} focus:outline-none focus:ring-2 focus:ring-[#006064]/20 font-sans text-lg text-[#006064] placeholder-[#006064]/30`}
                            placeholder="nombre@ejemplo.com"
                        />
                    </div>

                    <button
                        type="submit"
                        disabled={loading}
                        className={`w-full py-4 ${s.button} font-bold text-sm uppercase tracking-widest border-2 border-[#006064] shadow-[4px_4px_0px_0px_#006064] hover:shadow-none hover:translate-x-[2px] hover:translate-y-[2px] transition-all disabled:opacity-50 disabled:cursor-not-allowed`}
                    >
                        {loading ? '...' : t.auth.sendResetLink}
                    </button>
                </form>

                <div className="mt-6 text-center">
                    <button
                        onClick={() => switchMode('login')}
                        className="text-sm font-bold text-[#006064] underline hover:opacity-70"
                    >
                        {t.auth.backToLogin}
                    </button>
                </div>
            </div>
        );
    }

    // ---------- LOGIN / REGISTER MODE ----------
    return (
        <div className="w-full max-w-md mx-auto bg-white p-8 border-2 border-[#006064] shadow-[4px_4px_0px_0px_#006064]">
            <div className="text-center mb-8">
                <h2 className="font-display text-3xl text-[#006064] uppercase mb-2">
                    {mode === 'login' ? t.auth.login : t.auth.register}
                </h2>
            </div>

            {error && (
                <div className="mb-4 p-3 bg-red-100 border-2 border-red-500 text-red-700 font-bold text-sm">
                    {error}
                </div>
            )}

            {successMessage && (
                <div className="mb-4 p-3 bg-green-100 border-2 border-green-500 text-green-700 font-bold text-sm">
                    {successMessage}
                </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-6">
                <div>
                    <label className="block font-mono text-xs uppercase tracking-wide text-[#006064] mb-2 font-bold">
                        {t.auth.email}
                    </label>
                    <input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                        className={`w-full p-3 border-2 ${s.inputBorder} focus:outline-none focus:ring-2 focus:ring-[#006064]/20 font-sans text-lg text-[#006064] placeholder-[#006064]/30`}
                        placeholder="nombre@ejemplo.com"
                    />
                </div>

                <div>
                    <label className="block font-mono text-xs uppercase tracking-wide text-[#006064] mb-2 font-bold">
                        {t.auth.password}
                    </label>
                    <input
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                        className={`w-full p-3 border-2 ${s.inputBorder} focus:outline-none focus:ring-2 focus:ring-[#006064]/20 font-sans text-lg text-[#006064]`}
                        placeholder="••••••••"
                    />
                </div>

                <button
                    type="submit"
                    disabled={loading}
                    className={`w-full py-4 ${s.button} font-bold text-sm uppercase tracking-widest border-2 border-[#006064] shadow-[4px_4px_0px_0px_#006064] hover:shadow-none hover:translate-x-[2px] hover:translate-y-[2px] transition-all disabled:opacity-50 disabled:cursor-not-allowed`}
                >
                    {loading ? '...' : (mode === 'login' ? t.auth.submitLogin : t.auth.submitRegister)}
                </button>
            </form>

            <div className="mt-6 text-center text-sm font-sans text-[#006064]">
                <p>
                    {mode === 'login' ? t.auth.noAccount : t.auth.hasAccount}{' '}
                    <button
                        onClick={() => switchMode(mode === 'login' ? 'register' : 'login')}
                        className="font-bold underline hover:opacity-70"
                    >
                        {mode === 'login' ? t.auth.register : t.auth.login}
                    </button>
                </p>
            </div>

            {mode === 'login' && (
                <div className="mt-2 text-center text-xs font-mono text-[#006064]/60">
                    <button
                        onClick={() => switchMode('forgotPassword')}
                        className="hover:underline"
                    >
                        {t.auth.forgotPassword}
                    </button>
                </div>
            )}
        </div>
    );
}
