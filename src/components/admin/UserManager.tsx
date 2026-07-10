import { useState, useEffect } from 'react';

interface Teacher {
    id: string;
    fullName: string | null;
    email: string;
}

interface Subscription {
    id: string;
    status: string;
    sessions_total: number;
    sessions_used: number;
    package: { name: string; display_name: unknown };
}

interface Student {
    id: string;
    fullName: string | null;
    email: string;
    createdAt: string;
    activeSubscription?: Subscription | null;
    primaryTeacher?: { id: string; fullName: string | null } | null;
}

type AdminUsersResponse = {
    error?: string;
    students?: Student[];
    teachers?: Teacher[];
};

export default function UserManager() {
    const [students, setStudents] = useState<Student[]>([]);
    const [teachers, setTeachers] = useState<Teacher[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [actionMessage, setActionMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
    const [updatingId, setUpdatingId] = useState<string | null>(null);
    const isMutating = updatingId !== null;

    useEffect(() => {
        const controller = new AbortController();
        void fetchUsers(controller.signal);
        return () => controller.abort();
    }, []);

    const fetchUsers = async (signal?: AbortSignal) => {
        try {
            setLoading(true);
            setError(null);
            const res = await fetch('/api/admin/users', { signal });
            if (!res.ok) {
                const body = await res.json().catch(() => null) as { error?: string } | null;
                throw new Error(typeof body?.error === 'string' ? body.error : 'No se pudieron cargar los usuarios');
            }
            const data = await res.json() as AdminUsersResponse;
            setTeachers(data.teachers ?? []);
            setStudents(data.students ?? []);
        } catch (err) {
            if (err instanceof DOMException && err.name === 'AbortError') return;
            setError(err instanceof Error ? err.message : 'Unknown error');
        } finally {
            if (!signal?.aborted) {
                setLoading(false);
            }
        }
    };

    const assignTeacher = async (studentId: string, teacherId: string) => {
        if (!teacherId) return; // Ignore clear selection for now

        try {
            setUpdatingId(studentId);
            setActionMessage(null);
            const res = await fetch('/api/admin/assign-teacher', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ studentId, teacherId })
            });

            if (!res.ok) {
                const body = await res.json().catch(() => null) as { error?: string } | null;
                throw new Error(typeof body?.error === 'string' ? body.error : 'Error al asignar profesor');
            }

            // Optimistic update keeps the table responsive without a second list fetch.
            const selectedTeacher = teachers.find(t => t.id === teacherId);
            setStudents(currentStudents => currentStudents.map(s =>
                s.id === studentId ? { ...s, primaryTeacher: { id: teacherId, fullName: selectedTeacher?.fullName || selectedTeacher?.email || 'Desconocido' } } : s
            ));
            setActionMessage({ type: 'success', text: 'Profesor asignado' });

        } catch (err) {
            setActionMessage({ type: 'error', text: err instanceof Error ? err.message : 'Error al asignar profesor' });
        } finally {
            setUpdatingId(null);
        }
    };

    if (loading) return <div role="status" className="text-gray-500 flex justify-center p-8"><span className="animate-pulse">Cargando base de datos...</span></div>;
    if (error) return <div role="alert" className="text-red-600 bg-red-50 p-4 rounded-xl border border-red-200">Error: {error}</div>;

    return (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="p-6 border-b border-gray-100 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                    <h2 className="text-xl font-bold text-gray-900">Gestión de Alumnos (Emparejador)</h2>
                    <p className="text-sm text-gray-500 mt-1">Asigna profesores a los nuevos alumnos matriculados.</p>
                </div>
                <div className="flex gap-2">
                    <div role="status" aria-live="polite" className="bg-[#6A131C]/10 text-[#6A131C] text-sm font-medium px-4 py-2 rounded-full">
                        Alumnos: {students.length}
                    </div>
                    <div role="status" aria-live="polite" className="bg-blue-50 text-blue-700 text-sm font-medium px-4 py-2 rounded-full">
                        Profesores: {teachers.length}
                    </div>
                </div>
            </div>

            {actionMessage && (
                <div
                    role={actionMessage.type === 'error' ? 'alert' : 'status'}
                    className={`mx-6 mt-4 rounded-lg border p-3 text-sm ${actionMessage.type === 'error'
                        ? 'border-red-200 bg-red-50 text-red-700'
                        : 'border-green-200 bg-green-50 text-green-700'
                        }`}
                >
                    {actionMessage.text}
                </div>
            )}

            <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                    <thead>
                        <tr className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wider">
                            <th className="p-4 font-medium">Alumno</th>
                            <th className="p-4 font-medium">Plan Activo</th>
                            <th className="p-4 font-medium">Progreso Mensual</th>
                            <th className="p-4 font-medium" style={{ width: '250px' }}>Tutor Asignado</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 text-sm">
                        {students.length === 0 ? (
                            <tr>
                                <td colSpan={4} role="status" className="p-8 text-center text-gray-500">
                                    No hay estudiantes registrados.
                                </td>
                            </tr>
                        ) : (
                            students.map((student) => (
                                <tr key={student.id} className="hover:bg-gray-50 transition-colors">
                                    <td className="p-4">
                                        <div className="font-medium text-gray-900">{student.fullName || 'Sin Nombre'}</div>
                                        <div className="text-xs text-gray-500">{student.email}</div>
                                    </td>

                                    <td className="p-4">
                                        {student.activeSubscription ? (
                                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                                                {student.activeSubscription.package.name} ({student.activeSubscription.sessions_total} clases)
                                            </span>
                                        ) : (
                                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
                                                Inactivo/Caducado
                                            </span>
                                        )}
                                    </td>

                                    <td className="p-4 text-gray-600">
                                        {student.activeSubscription ? (
                                            <div className="flex items-center gap-2">
                                                <span className="font-bold">{student.activeSubscription.sessions_used}</span>
                                                <span className="text-gray-400">/</span>
                                                <span>{student.activeSubscription.sessions_total} dadas</span>
                                            </div>
                                        ) : '-'}
                                    </td>

                                    <td className="p-4">
                                        <select
                                            className={`block w-full rounded-md border-0 py-1.5 pl-3 pr-10 text-gray-900 ring-1 ring-inset focus:ring-2 focus:ring-inset sm:text-sm sm:leading-6 ${student.primaryTeacher ? 'ring-green-300 focus:ring-green-600 bg-green-50' : 'ring-red-300 focus:ring-[#6A131C] bg-red-50'
                                            }`}
                                            value={student.primaryTeacher?.id || ""}
                                            aria-label={`Tutor asignado para ${student.fullName || student.email}`}
                                            aria-busy={updatingId === student.id}
                                            onChange={(e) => assignTeacher(student.id, e.target.value)}
                                            disabled={isMutating}
                                        >
                                            <option value="" disabled>Seleccionar Profesor...</option>
                                            {teachers.map(t => (
                                                <option key={t.id} value={t.id}>{t.fullName || t.email}</option>
                                            ))}
                                        </select>
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
