import React, { useState } from 'react';

interface ProfileFormProps {
    profile: {
        full_name: string | null;
        email: string;
        phone: string | null;
        preferred_language: string;
        timezone: string;
    };
    translations: {
        fullName: string;
        email: string;
        phone: string;
        language: string;
        timezone: string;
        save: string;
        saved: string;
    };
}

const timezones = [
    { value: 'Europe/Madrid', label: 'Madrid (UTC+1/+2)' },
    { value: 'Europe/London', label: 'London (UTC+0/+1)' },
    { value: 'Europe/Paris', label: 'Paris (UTC+1/+2)' },
    { value: 'Europe/Berlin', label: 'Berlin (UTC+1/+2)' },
    { value: 'Europe/Rome', label: 'Rome (UTC+1/+2)' },
    { value: 'Europe/Amsterdam', label: 'Amsterdam (UTC+1/+2)' },
    { value: 'Europe/Brussels', label: 'Brussels (UTC+1/+2)' },
    { value: 'Europe/Lisbon', label: 'Lisbon (UTC+0/+1)' },
    { value: 'Europe/Warsaw', label: 'Warsaw (UTC+1/+2)' },
    { value: 'Europe/Moscow', label: 'Moscow (UTC+3)' },
    { value: 'America/New_York', label: 'New York (UTC-5/-4)' },
    { value: 'America/Los_Angeles', label: 'Los Angeles (UTC-8/-7)' },
    { value: 'America/Mexico_City', label: 'Mexico City (UTC-6/-5)' },
    { value: 'America/Bogota', label: 'Bogotá (UTC-5)' },
    { value: 'America/Buenos_Aires', label: 'Buenos Aires (UTC-3)' },
];

const languages = [
    { value: 'es', label: 'Español' },
    { value: 'en', label: 'English' },
    { value: 'ru', label: 'Русский' },
];

export default function ProfileForm({ profile, translations: t }: ProfileFormProps) {
    const [formData, setFormData] = useState({
        fullName: profile.full_name || '',
        phone: profile.phone || '',
        preferredLanguage: profile.preferred_language || 'es',
        timezone: profile.timezone || 'Europe/Madrid',
    });
    const [isSaving, setIsSaving] = useState(false);
    const [saveStatus, setSaveStatus] = useState<'idle' | 'saved' | 'error'>('idle');

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
        setSaveStatus('idle');
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsSaving(true);
        setSaveStatus('idle');

        try {
            const response = await fetch('/api/account/update-profile', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(formData),
            });

            if (!response.ok) {
                throw new Error('Failed to save');
            }

            setSaveStatus('saved');
            setTimeout(() => setSaveStatus('idle'), 3000);
        } catch (error) {
            console.error('Error saving profile:', error);
            setSaveStatus('error');
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-4">
            {/* Full Name */}
            <div>
                <label className="block text-xs font-mono uppercase text-[#006064]/60 mb-1">
                    {t.fullName}
                </label>
                <input
                    type="text"
                    name="fullName"
                    value={formData.fullName}
                    onChange={handleChange}
                    className="w-full p-3 border-2 border-[#006064] focus:outline-none focus:ring-2 focus:ring-[#006064]/20 text-[#006064]"
                />
            </div>

            {/* Email (read-only) */}
            <div>
                <label className="block text-xs font-mono uppercase text-[#006064]/60 mb-1">
                    {t.email}
                </label>
                <input
                    type="email"
                    value={profile.email}
                    disabled
                    className="w-full p-3 border-2 border-[#006064]/30 bg-gray-100 text-[#006064]/60 cursor-not-allowed"
                />
            </div>

            {/* Phone */}
            <div>
                <label className="block text-xs font-mono uppercase text-[#006064]/60 mb-1">
                    {t.phone}
                </label>
                <input
                    type="tel"
                    name="phone"
                    value={formData.phone}
                    onChange={handleChange}
                    placeholder="+34 600 000 000"
                    className="w-full p-3 border-2 border-[#006064] focus:outline-none focus:ring-2 focus:ring-[#006064]/20 text-[#006064]"
                />
            </div>

            {/* Preferred Language */}
            <div>
                <label className="block text-xs font-mono uppercase text-[#006064]/60 mb-1">
                    {t.language}
                </label>
                <select
                    name="preferredLanguage"
                    value={formData.preferredLanguage}
                    onChange={handleChange}
                    className="w-full p-3 border-2 border-[#006064] bg-white text-[#006064]"
                >
                    {languages.map(lang => (
                        <option key={lang.value} value={lang.value}>{lang.label}</option>
                    ))}
                </select>
            </div>

            {/* Timezone */}
            <div>
                <label className="block text-xs font-mono uppercase text-[#006064]/60 mb-1">
                    {t.timezone}
                </label>
                <select
                    name="timezone"
                    value={formData.timezone}
                    onChange={handleChange}
                    className="w-full p-3 border-2 border-[#006064] bg-white text-[#006064]"
                >
                    {timezones.map(tz => (
                        <option key={tz.value} value={tz.value}>{tz.label}</option>
                    ))}
                </select>
            </div>

            {/* Submit */}
            <div className="flex items-center gap-4 pt-2">
                <button
                    type="submit"
                    disabled={isSaving}
                    className={`px-6 py-3 font-bold uppercase text-sm border-2 border-[#006064] transition-colors ${isSaving
                            ? 'bg-gray-200 text-gray-500 cursor-not-allowed'
                            : 'bg-[#006064] text-white hover:bg-[#004d40]'
                        }`}
                >
                    {isSaving ? '...' : t.save}
                </button>

                {saveStatus === 'saved' && (
                    <span className="text-green-600 font-bold text-sm">✓ {t.saved}</span>
                )}
                {saveStatus === 'error' && (
                    <span className="text-red-600 font-bold text-sm">✗ Error</span>
                )}
            </div>
        </form>
    );
}
