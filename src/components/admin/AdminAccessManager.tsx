import { useEffect, useMemo, useRef, useState } from 'react';
import {
    ADMIN_ACCESS_ROLES,
    type AdminAccessRole,
} from '../../lib/admin-access-contract';

type AdminSummary = {
    id: string;
    email: string;
    fullName: string | null;
    roles: AdminAccessRole[];
};

type AccessResponse = {
    admins?: AdminSummary[];
    canWrite?: boolean;
    error?: string;
};

const roleCopy: Record<AdminAccessRole, { label: string; description: string }> = {
    owner: {
        label: 'Propietario',
        description: 'Control total, incluida la gestión de accesos.',
    },
    content_editor: {
        label: 'Contenido',
        description: 'Edita páginas, SEO, navegación, FAQ, blog y emails.',
    },
    catalog_editor: {
        label: 'Catálogo',
        description: 'Prepara y publica paquetes, términos y precios.',
    },
    operator: {
        label: 'Operaciones',
        description: 'Gestiona alumnos, profesores, clases, CRM y soporte.',
    },
    finance: {
        label: 'Finanzas',
        description: 'Consulta y gestiona cobros, devoluciones y liquidaciones.',
    },
    viewer: {
        label: 'Solo lectura',
        description: 'Consulta todas las áreas sin poder cambiar datos.',
    },
};

export default function AdminAccessManager() {
    const [admins, setAdmins] = useState<AdminSummary[]>([]);
    const [canWrite, setCanWrite] = useState(false);
    const [loading, setLoading] = useState(true);
    const [pendingKey, setPendingKey] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [message, setMessage] = useState<string | null>(null);
    const [staffEmail, setStaffEmail] = useState('');
    const [staffFullName, setStaffFullName] = useState('');
    const [staffRole, setStaffRole] = useState<AdminAccessRole>('viewer');
    const [staffReason, setStaffReason] = useState('');
    const [staffAction, setStaffAction] = useState<'invite' | 'promote' | null>(null);
    const staffRequestIds = useRef(new Map<'invite' | 'promote', { id: string; payload: string }>());
    const ownerCount = useMemo(
        () => admins.filter((admin) => admin.roles.includes('owner')).length,
        [admins],
    );

    const load = async () => {
        setLoading(true);
        setError(null);
        try {
            const response = await fetch('/api/admin/access');
            const data = await response.json() as AccessResponse;
            if (!response.ok) throw new Error(data.error || 'No se pudieron cargar los accesos');
            setAdmins(data.admins ?? []);
            setCanWrite(data.canWrite === true);
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : 'No se pudieron cargar los accesos');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        void load();
    }, []);

    const staffLanguage = (): 'es' | 'en' | 'ru' => {
        const value = document.documentElement.lang;
        return value === 'en' || value === 'ru' ? value : 'es';
    };

    const inviteAdministrator = async () => {
        if (!canWrite || staffAction) return;
        setStaffAction('invite');
        setError(null);
        setMessage(null);
        try {
            const invitationPayload = {
                target: 'admin' as const,
                email: staffEmail,
                fullName: staffFullName,
                lang: staffLanguage(),
                reason: staffReason,
            };
            const serializedPayload = JSON.stringify(invitationPayload);
            const previousRequest = staffRequestIds.current.get('invite');
            const logicalRequest = previousRequest?.payload === serializedPayload
                ? previousRequest
                : { id: crypto.randomUUID(), payload: serializedPayload };
            staffRequestIds.current.set('invite', logicalRequest);
            const response = await fetch('/api/admin/staff-invitations', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    requestId: logicalRequest.id,
                    ...invitationPayload,
                }),
            });
            const data = await response.json() as {
                auditDegraded?: boolean;
                error?: string;
                state?: 'existing_pending' | 'existing_verified' | 'sent';
            };
            if (!response.ok) throw new Error(data.error || 'No se pudo enviar la invitación');
            staffRequestIds.current.delete('invite');
            setMessage(data.state === 'existing_verified'
                ? 'La cuenta ya está verificada. Ya puedes promoverla.'
                : data.state === 'existing_pending'
                    ? 'La cuenta ya existe y está pendiente de verificar el email. No se ha enviado otra invitación.'
                    : data.auditDegraded
                        ? 'La invitación fue aceptada, pero la auditoría de finalización requiere revisión.'
                        : 'Invitación enviada. Cuando confirme su cuenta, podrás promoverla.');
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : 'No se pudo enviar la invitación');
        } finally {
            setStaffAction(null);
        }
    };

    const promoteAdministrator = async () => {
        if (!canWrite || staffAction) return;
        setStaffAction('promote');
        setError(null);
        setMessage(null);
        try {
            const promotionPayload = {
                action: 'promote' as const,
                email: staffEmail,
                accessRole: staffRole,
                reason: staffReason,
            };
            const serializedPayload = JSON.stringify(promotionPayload);
            const previousRequest = staffRequestIds.current.get('promote');
            const logicalRequest = previousRequest?.payload === serializedPayload
                ? previousRequest
                : { id: crypto.randomUUID(), payload: serializedPayload };
            staffRequestIds.current.set('promote', logicalRequest);
            const response = await fetch('/api/admin/access', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    requestId: logicalRequest.id,
                    ...promotionPayload,
                }),
            });
            const data = await response.json() as AccessResponse;
            if (!response.ok) throw new Error(data.error || 'No se pudo promover la cuenta');
            setAdmins(data.admins ?? []);
            setCanWrite(data.canWrite === true);
            staffRequestIds.current.delete('promote');
            setMessage('Cuenta promovida y acceso inicial concedido.');
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : 'No se pudo promover la cuenta');
        } finally {
            setStaffAction(null);
        }
    };

    const mutate = async (
        admin: AdminSummary,
        accessRole: AdminAccessRole,
        action: 'grant' | 'revoke',
    ) => {
        const key = `${admin.id}:${accessRole}`;
        if (!canWrite || pendingKey) return;
        setPendingKey(key);
        setError(null);
        setMessage(null);
        try {
            const response = await fetch('/api/admin/access', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action,
                    profileId: admin.id,
                    accessRole,
                }),
            });
            const data = await response.json() as AccessResponse;
            if (!response.ok) throw new Error(data.error || 'No se pudo cambiar el acceso');
            setAdmins(data.admins ?? []);
            setCanWrite(data.canWrite === true);
            setMessage(action === 'grant' ? 'Acceso concedido' : 'Acceso retirado');
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : 'No se pudo cambiar el acceso');
        } finally {
            setPendingKey(null);
        }
    };

    if (loading) {
        return (
            <div role="status" className="border-2 border-[#006064] bg-white p-6 font-mono text-[#006064]">
                Cargando accesos...
            </div>
        );
    }

    return (
        <div className="space-y-5">
            {!canWrite && (
                <p className="border-2 border-[#006064] bg-[#E0F7FA] p-4 text-sm font-bold text-[#006064]">
                    Puedes consultar los accesos, pero solo un propietario puede modificarlos.
                </p>
            )}
            {error && <p role="alert" className="border-2 border-red-700 bg-red-50 p-4 font-bold text-red-800">{error}</p>}
            {message && <p role="status" className="border-2 border-green-700 bg-green-50 p-4 font-bold text-green-800">{message}</p>}

            <section className="border-2 border-[#006064] bg-[#E0F7FA] p-5 shadow-[4px_4px_0_0_#006064]">
                <h2 className="text-xl font-black text-[#006064]">Añadir personal administrador</h2>
                <p className="mt-2 text-sm text-gray-800">
                    Primero envía la invitación. Solo después de que la persona confirme el email y complete su perfil podrás promoverla y concederle su acceso inicial.
                </p>
                <div className="mt-5 grid gap-4 md:grid-cols-2">
                    <label className="grid gap-1 text-sm font-bold text-[#006064]">
                        Nombre completo
                        <input value={staffFullName} onChange={(event) => setStaffFullName(event.target.value)} maxLength={120} className="border-2 border-[#006064] bg-white px-3 py-2 text-gray-950" />
                    </label>
                    <label className="grid gap-1 text-sm font-bold text-[#006064]">
                        Email
                        <input type="email" value={staffEmail} onChange={(event) => setStaffEmail(event.target.value)} maxLength={320} autoComplete="email" className="border-2 border-[#006064] bg-white px-3 py-2 text-gray-950" />
                    </label>
                    <label className="grid gap-1 text-sm font-bold text-[#006064]">
                        Acceso inicial
                        <select value={staffRole} onChange={(event) => setStaffRole(event.target.value as AdminAccessRole)} className="border-2 border-[#006064] bg-white px-3 py-2 text-gray-950">
                            {ADMIN_ACCESS_ROLES.map((role) => <option key={role} value={role}>{roleCopy[role].label}</option>)}
                        </select>
                    </label>
                    <label className="grid gap-1 text-sm font-bold text-[#006064]">
                        Motivo documentado
                        <input value={staffReason} onChange={(event) => setStaffReason(event.target.value)} minLength={5} maxLength={1000} className="border-2 border-[#006064] bg-white px-3 py-2 text-gray-950" />
                    </label>
                </div>
                <div className="mt-5 flex flex-wrap gap-3">
                    <button
                        type="button"
                        disabled={!canWrite || staffAction !== null || staffFullName.trim().length < 2 || !staffEmail.includes('@') || staffReason.trim().length < 5}
                        onClick={() => void inviteAdministrator()}
                        className="border-2 border-[#006064] bg-white px-4 py-2 text-sm font-black uppercase text-[#006064] disabled:opacity-50"
                    >
                        {staffAction === 'invite' ? 'Enviando…' : 'Enviar invitación'}
                    </button>
                    <button
                        type="button"
                        disabled={!canWrite || staffAction !== null || !staffEmail.includes('@') || staffReason.trim().length < 5}
                        onClick={() => void promoteAdministrator()}
                        className="border-2 border-[#006064] bg-[#006064] px-4 py-2 text-sm font-black uppercase text-white disabled:opacity-50"
                    >
                        {staffAction === 'promote' ? 'Promoviendo…' : 'Promover cuenta verificada'}
                    </button>
                </div>
            </section>

            <div className="grid gap-5 xl:grid-cols-2">
                {admins.map((admin) => (
                    <section key={admin.id} className="border-2 border-[#006064] bg-white p-5 shadow-[4px_4px_0_0_#006064]">
                        <div className="mb-4 border-b-2 border-[#006064] pb-3">
                            <h2 className="text-lg font-black text-[#006064]">{admin.fullName || admin.email}</h2>
                            {admin.fullName && <p className="mt-1 font-mono text-xs text-[#006064]">{admin.email}</p>}
                        </div>

                        <ul className="space-y-3">
                            {ADMIN_ACCESS_ROLES.map((role) => {
                                const assigned = admin.roles.includes(role);
                                const isLastOwner = role === 'owner' && assigned && ownerCount === 1;
                                const pending = pendingKey === `${admin.id}:${role}`;
                                return (
                                    <li key={role} className="flex flex-col gap-3 border border-[#006064]/30 p-3 sm:flex-row sm:items-center sm:justify-between">
                                        <div>
                                            <p className="font-black text-[#006064]">{roleCopy[role].label}</p>
                                            <p className="mt-1 text-xs text-gray-700">{roleCopy[role].description}</p>
                                        </div>
                                        <button
                                            type="button"
                                            disabled={!canWrite || pendingKey !== null || isLastOwner}
                                            aria-label={`${assigned ? 'Retirar' : 'Conceder'} ${roleCopy[role].label} a ${admin.fullName || admin.email}`}
                                            title={isLastOwner ? 'Debe quedar al menos un propietario' : undefined}
                                            onClick={() => void mutate(admin, role, assigned ? 'revoke' : 'grant')}
                                            className={`min-w-28 border-2 px-3 py-2 text-xs font-black uppercase transition-colors focus-visible:outline focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-[#006064] disabled:cursor-not-allowed disabled:opacity-50 ${assigned
                                                ? 'border-red-800 bg-white text-red-800 hover:bg-red-50'
                                                : 'border-[#006064] bg-[#006064] text-white hover:bg-[#004d40]'
                                            }`}
                                        >
                                            {pending ? 'Guardando...' : assigned ? 'Retirar' : 'Conceder'}
                                        </button>
                                    </li>
                                );
                            })}
                        </ul>
                    </section>
                ))}
            </div>

            {admins.length === 0 && (
                <p role="status" className="border-2 border-[#006064] bg-white p-6 text-center text-[#006064]">
                    No hay perfiles administradores disponibles.
                </p>
            )}
        </div>
    );
}
