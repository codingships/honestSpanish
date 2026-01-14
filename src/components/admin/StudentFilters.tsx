import React, { useState, useMemo } from 'react';

interface Student {
    id: string;
    full_name: string | null;
    email: string;
    phone: string | null;
    created_at: string;
    preferred_language: string;
    subscription_status: string | null;
    subscription_ends: string | null;
    package_name: string | null;
    package_display_name: any;
    teacher_name: string | null;
}

interface StudentFiltersProps {
    students: Student[];
    lang: 'es' | 'en' | 'ru';
    translations: {
        search: string;
        filterStatus: string;
        filterPlan: string;
        all: string;
        withPlan: string;
        noPlan: string;
        expired: string;
        assignTeacher: string;
        registered: string;
        viewDetails: string;
    };
    packages: { name: string; displayName: string }[];
}

export default function StudentFilters({ students, lang, translations: t, packages }: StudentFiltersProps) {
    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState('all');
    const [planFilter, setPlanFilter] = useState('all');

    const filteredStudents = useMemo(() => {
        return students.filter(student => {
            // Search filter
            const searchLower = search.toLowerCase();
            const matchesSearch = !search ||
                (student.full_name?.toLowerCase().includes(searchLower)) ||
                student.email.toLowerCase().includes(searchLower);

            // Status filter
            let matchesStatus = true;
            if (statusFilter === 'active') {
                matchesStatus = student.subscription_status === 'active';
            } else if (statusFilter === 'none') {
                matchesStatus = !student.subscription_status;
            } else if (statusFilter === 'expired') {
                matchesStatus = student.subscription_status === 'expired' ||
                    (student.subscription_ends && new Date(student.subscription_ends) < new Date());
            }

            // Plan filter
            const matchesPlan = planFilter === 'all' || student.package_name === planFilter;

            return matchesSearch && matchesStatus && matchesPlan;
        });
    }, [students, search, statusFilter, planFilter]);

    const formatDate = (dateStr: string) => {
        const date = new Date(dateStr);
        return date.toLocaleDateString(lang === 'es' ? 'es-ES' : lang === 'ru' ? 'ru-RU' : 'en-US', {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
        });
    };

    const getStatusBadge = (student: Student) => {
        if (!student.subscription_status) {
            return { text: t.noPlan, class: 'bg-gray-200 text-gray-700' };
        }
        if (student.subscription_status === 'active') {
            const endsAt = student.subscription_ends ? new Date(student.subscription_ends) : null;
            const now = new Date();
            if (endsAt && endsAt < now) {
                return { text: t.expired, class: 'bg-red-100 text-red-700' };
            }
            return { text: 'Activo', class: 'bg-green-100 text-green-700' };
        }
        return { text: t.expired, class: 'bg-red-100 text-red-700' };
    };

    const getPlanBadge = (student: Student) => {
        if (!student.package_name) return null;
        const colors: Record<string, string> = {
            essential: 'bg-blue-100 text-blue-700 border-blue-300',
            intensive: 'bg-purple-100 text-purple-700 border-purple-300',
            premium: 'bg-yellow-100 text-yellow-800 border-yellow-300',
        };
        const displayName = student.package_display_name?.[lang] || student.package_name;
        return {
            text: displayName,
            class: colors[student.package_name] || 'bg-gray-100 text-gray-700',
        };
    };

    return (
        <div>
            {/* Filters */}
            <div className="flex flex-col md:flex-row gap-4 mb-6">
                <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder={t.search}
                    className="flex-1 p-3 border-2 border-[#006064] focus:outline-none focus:ring-2 focus:ring-[#006064]/20 font-sans text-[#006064] placeholder-[#006064]/40"
                />

                <select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                    className="p-3 border-2 border-[#006064] bg-white text-[#006064] font-mono text-sm"
                >
                    <option value="all">{t.filterStatus}: {t.all}</option>
                    <option value="active">{t.withPlan}</option>
                    <option value="none">{t.noPlan}</option>
                    <option value="expired">{t.expired}</option>
                </select>

                <select
                    value={planFilter}
                    onChange={(e) => setPlanFilter(e.target.value)}
                    className="p-3 border-2 border-[#006064] bg-white text-[#006064] font-mono text-sm"
                >
                    <option value="all">{t.filterPlan}: {t.all}</option>
                    {packages.map(pkg => (
                        <option key={pkg.name} value={pkg.name}>{pkg.displayName}</option>
                    ))}
                </select>
            </div>

            {/* Results count */}
            <p className="text-sm text-[#006064]/60 mb-4 font-mono">
                {filteredStudents.length} estudiantes
            </p>

            {/* Table */}
            <div className="overflow-x-auto">
                <table className="w-full border-2 border-[#006064]">
                    <thead className="bg-[#006064] text-white">
                        <tr>
                            <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider">Nombre</th>
                            <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider hidden md:table-cell">Email</th>
                            <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider">Plan</th>
                            <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider hidden lg:table-cell">Estado</th>
                            <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider hidden lg:table-cell">Profesor</th>
                            <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider hidden md:table-cell">{t.registered}</th>
                            <th className="px-4 py-3 text-center text-xs font-bold uppercase tracking-wider">Acciones</th>
                        </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-[#006064]/20">
                        {filteredStudents.map((student) => {
                            const statusBadge = getStatusBadge(student);
                            const planBadge = getPlanBadge(student);

                            return (
                                <tr key={student.id} className="hover:bg-[#E0F7FA]/50 transition-colors">
                                    <td className="px-4 py-3">
                                        <a
                                            href={`/${lang}/campus/admin/student/${student.id}`}
                                            className="font-bold text-[#006064] hover:underline"
                                        >
                                            {student.full_name || student.email.split('@')[0]}
                                        </a>
                                        <p className="text-xs text-[#006064]/60 md:hidden">{student.email}</p>
                                    </td>
                                    <td className="px-4 py-3 text-sm text-[#006064]/80 hidden md:table-cell">
                                        {student.email}
                                    </td>
                                    <td className="px-4 py-3">
                                        {planBadge ? (
                                            <span className={`px-2 py-1 text-xs font-bold rounded border ${planBadge.class}`}>
                                                {planBadge.text}
                                            </span>
                                        ) : (
                                            <span className="text-xs text-[#006064]/40">—</span>
                                        )}
                                    </td>
                                    <td className="px-4 py-3 hidden lg:table-cell">
                                        <span className={`px-2 py-1 text-xs font-bold rounded ${statusBadge.class}`}>
                                            {statusBadge.text}
                                        </span>
                                    </td>
                                    <td className="px-4 py-3 text-sm text-[#006064]/80 hidden lg:table-cell">
                                        {student.teacher_name || (
                                            <span className="text-[#006064]/40 italic">Sin asignar</span>
                                        )}
                                    </td>
                                    <td className="px-4 py-3 text-sm text-[#006064]/60 font-mono hidden md:table-cell">
                                        {formatDate(student.created_at)}
                                    </td>
                                    <td className="px-4 py-3 text-center">
                                        <a
                                            href={`/${lang}/campus/admin/student/${student.id}`}
                                            className="inline-block px-3 py-1 bg-[#006064] text-white text-xs font-bold uppercase hover:bg-[#004d40] transition-colors"
                                        >
                                            {t.viewDetails}
                                        </a>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            {filteredStudents.length === 0 && (
                <div className="text-center py-12 text-[#006064]/60 font-mono">
                    No se encontraron estudiantes
                </div>
            )}
        </div>
    );
}
