import React, { useEffect, useMemo, useState } from 'react';

type LocalizedText = { es: string; en: string; ru: string };

type PackageRow = {
    id: string;
    name: string;
    display_name: LocalizedText;
    price_monthly: number;
    sessions_per_month: number;
    has_group_session: boolean | null;
    has_dual_teacher: boolean | null;
    stripe_product_id: string | null;
    stripe_price_1m: string | null;
    stripe_price_3m: string | null;
    stripe_price_6m: string | null;
    is_active: boolean | null;
    checkout_ready: boolean;
};

type EditablePackage = PackageRow & {
    priceMonthlyEur: string;
    sessionsPerMonth: string;
};

const emptyDisplayName: LocalizedText = { es: '', en: '', ru: '' };

function toEditable(pkg: PackageRow): EditablePackage {
    return {
        ...pkg,
        display_name: { ...emptyDisplayName, ...pkg.display_name },
        priceMonthlyEur: String((pkg.price_monthly / 100).toFixed(2)).replace('.00', ''),
        sessionsPerMonth: String(pkg.sessions_per_month),
    };
}

function maskStripeId(value: string | null): string {
    if (!value) return 'Pendiente';
    return `${value.slice(0, 12)}...${value.slice(-4)}`;
}

function missingCheckoutDurations(pkg: PackageRow): string[] {
    const durations: Array<[string, string | null]> = [
        ['1m', pkg.stripe_price_1m],
        ['3m', pkg.stripe_price_3m],
        ['6m', pkg.stripe_price_6m],
    ];

    return durations
        .filter(([, priceId]) => !priceId)
        .map(([duration]) => duration);
}

export default function ProductCatalogManager() {
    const [packages, setPackages] = useState<EditablePackage[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [savingId, setSavingId] = useState<string | null>(null);
    const [syncingId, setSyncingId] = useState<string | null>(null);
    const [message, setMessage] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [newPackage, setNewPackage] = useState({
        name: '',
        displayName: { es: '', en: '', ru: '' },
        priceMonthlyEur: '',
        sessionsPerMonth: '4',
        hasGroupSession: false,
        hasDualTeacher: false,
        isActive: false,
    });

    const activeWithoutCheckout = useMemo(
        () => packages.filter((pkg) => pkg.is_active && !pkg.checkout_ready).length,
        [packages]
    );

    const loadPackages = async () => {
        setIsLoading(true);
        setError(null);
        try {
            const response = await fetch('/api/admin/packages');
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || 'No se pudo cargar el catálogo');
            setPackages((data.packages || []).map(toEditable));
        } catch (err) {
            setError(err instanceof Error ? err.message : 'No se pudo cargar el catálogo');
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        void loadPackages();
    }, []);

    const updatePackage = (id: string, patch: Partial<EditablePackage>) => {
        setPackages((current) => current.map((pkg) => pkg.id === id ? { ...pkg, ...patch } : pkg));
    };

    const updatePackageName = (id: string, lang: keyof LocalizedText, value: string) => {
        setPackages((current) => current.map((pkg) => pkg.id === id
            ? { ...pkg, display_name: { ...pkg.display_name, [lang]: value } }
            : pkg));
    };

    const savePackage = async (pkg: EditablePackage) => {
        setSavingId(pkg.id);
        setMessage(null);
        setError(null);
        try {
            const response = await fetch('/api/admin/packages', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    packageId: pkg.id,
                    displayName: pkg.display_name,
                    priceMonthlyEur: Number(pkg.priceMonthlyEur),
                    sessionsPerMonth: Number(pkg.sessionsPerMonth),
                    hasGroupSession: Boolean(pkg.has_group_session),
                    hasDualTeacher: Boolean(pkg.has_dual_teacher),
                    isActive: Boolean(pkg.is_active),
                }),
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || 'No se pudo guardar el paquete');
            setPackages((current) => current.map((item) => item.id === pkg.id ? toEditable(data.package) : item));
            setMessage('Paquete guardado');
        } catch (err) {
            setError(err instanceof Error ? err.message : 'No se pudo guardar el paquete');
        } finally {
            setSavingId(null);
        }
    };

    const syncStripe = async (pkg: EditablePackage) => {
        setSyncingId(pkg.id);
        setMessage(null);
        setError(null);
        try {
            const response = await fetch('/api/admin/packages', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'sync_stripe',
                    packageId: pkg.id,
                    durations: [1, 3, 6],
                }),
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || 'No se pudo sincronizar Stripe');
            setPackages((current) => current.map((item) => item.id === pkg.id ? toEditable(data.package) : item));
            setMessage('Stripe sincronizado');
        } catch (err) {
            setError(err instanceof Error ? err.message : 'No se pudo sincronizar Stripe');
        } finally {
            setSyncingId(null);
        }
    };

    const createPackage = async () => {
        setMessage(null);
        setError(null);
        try {
            const response = await fetch('/api/admin/packages', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'create_package',
                    name: newPackage.name,
                    displayName: newPackage.displayName,
                    priceMonthlyEur: Number(newPackage.priceMonthlyEur),
                    sessionsPerMonth: Number(newPackage.sessionsPerMonth),
                    hasGroupSession: newPackage.hasGroupSession,
                    hasDualTeacher: newPackage.hasDualTeacher,
                    isActive: newPackage.isActive,
                }),
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || 'No se pudo crear el paquete');
            setPackages((current) => [...current, toEditable(data.package)].sort((a, b) => a.price_monthly - b.price_monthly));
            setNewPackage({
                name: '',
                displayName: { es: '', en: '', ru: '' },
                priceMonthlyEur: '',
                sessionsPerMonth: '4',
                hasGroupSession: false,
                hasDualTeacher: false,
                isActive: false,
            });
            setMessage('Paquete creado');
        } catch (err) {
            setError(err instanceof Error ? err.message : 'No se pudo crear el paquete');
        }
    };

    if (isLoading) {
        return <div className="p-6 border-2 border-[#006064] bg-white text-[#006064] font-mono">Cargando...</div>;
    }

    return (
        <div className="space-y-6">
            {(message || error || activeWithoutCheckout > 0) && (
                <div className={`border-2 p-4 font-mono text-sm ${error ? 'border-red-500 bg-red-50 text-red-700' : activeWithoutCheckout > 0 ? 'border-yellow-500 bg-yellow-50 text-yellow-800' : 'border-green-600 bg-green-50 text-green-700'}`}>
                    {error || message || `${activeWithoutCheckout} paquete(s) activos no tienen precios Stripe completos`}
                </div>
            )}

            <div className="overflow-x-auto border-2 border-[#006064] bg-white">
                <table className="w-full min-w-[1100px] text-sm">
                    <thead className="bg-[#006064] text-white">
                        <tr>
                            <th className="p-3 text-left font-mono uppercase text-xs">Clave</th>
                            <th className="p-3 text-left font-mono uppercase text-xs">Nombres</th>
                            <th className="p-3 text-left font-mono uppercase text-xs">Precio</th>
                            <th className="p-3 text-left font-mono uppercase text-xs">Clases</th>
                            <th className="p-3 text-left font-mono uppercase text-xs">Incluye</th>
                            <th className="p-3 text-left font-mono uppercase text-xs">Stripe</th>
                            <th className="p-3 text-left font-mono uppercase text-xs">Estado</th>
                            <th className="p-3 text-right font-mono uppercase text-xs">Acciones</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-[#006064]/20">
                        {packages.map((pkg) => {
                            const missingDurations = missingCheckoutDurations(pkg);
                            const checkoutLabel = pkg.checkout_ready
                                ? 'Checkout listo'
                                : pkg.is_active
                                    ? 'Activo sin checkout'
                                    : 'Sin checkout';

                            return (
                            <tr key={pkg.id} className={!pkg.is_active ? 'bg-gray-50 opacity-70' : 'bg-white'}>
                                <td className="p-3 align-top font-mono font-bold text-[#006064]">{pkg.name}</td>
                                <td className="p-3 align-top space-y-2">
                                    {(['es', 'en', 'ru'] as const).map((lang) => (
                                        <input
                                            key={lang}
                                            value={pkg.display_name[lang]}
                                            onChange={(event) => updatePackageName(pkg.id, lang, event.target.value)}
                                            className="block w-full border border-[#006064]/30 p-2 text-[#006064]"
                                            aria-label={`Nombre ${lang}`}
                                            placeholder={lang}
                                        />
                                    ))}
                                </td>
                                <td className="p-3 align-top">
                                    <input
                                        type="number"
                                        min="1"
                                        step="0.01"
                                        value={pkg.priceMonthlyEur}
                                        onChange={(event) => updatePackage(pkg.id, { priceMonthlyEur: event.target.value })}
                                        className="w-24 border border-[#006064]/30 p-2 text-[#006064]"
                                        aria-label="Precio mensual"
                                    />
                                </td>
                                <td className="p-3 align-top">
                                    <input
                                        type="number"
                                        min="1"
                                        max="200"
                                        value={pkg.sessionsPerMonth}
                                        onChange={(event) => updatePackage(pkg.id, { sessionsPerMonth: event.target.value })}
                                        className="w-20 border border-[#006064]/30 p-2 text-[#006064]"
                                        aria-label="Clases al mes"
                                    />
                                </td>
                                <td className="p-3 align-top space-y-2">
                                    <label className="flex items-center gap-2">
                                        <input
                                            type="checkbox"
                                            checked={Boolean(pkg.has_group_session)}
                                            onChange={(event) => updatePackage(pkg.id, { has_group_session: event.target.checked })}
                                            className="h-4 w-4 accent-[#006064]"
                                        />
                                        <span>Grupo</span>
                                    </label>
                                    <label className="flex items-center gap-2">
                                        <input
                                            type="checkbox"
                                            checked={Boolean(pkg.has_dual_teacher)}
                                            onChange={(event) => updatePackage(pkg.id, { has_dual_teacher: event.target.checked })}
                                            className="h-4 w-4 accent-[#006064]"
                                        />
                                        <span>Doble profesor</span>
                                    </label>
                                </td>
                                <td className="p-3 align-top font-mono text-xs leading-6">
                                    <div>{maskStripeId(pkg.stripe_price_1m)}</div>
                                    <div>{maskStripeId(pkg.stripe_price_3m)}</div>
                                    <div>{maskStripeId(pkg.stripe_price_6m)}</div>
                                </td>
                                <td className="p-3 align-top space-y-2">
                                    <label className="flex items-center gap-2">
                                        <input
                                            type="checkbox"
                                            checked={Boolean(pkg.is_active)}
                                            onChange={(event) => updatePackage(pkg.id, { is_active: event.target.checked })}
                                            className="h-4 w-4 accent-[#006064]"
                                        />
                                        <span>{pkg.is_active ? 'Activo' : 'Oculto'}</span>
                                    </label>
                                    <span className={`inline-block px-2 py-1 text-xs font-bold ${pkg.checkout_ready ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-800'}`}>
                                        {checkoutLabel}
                                    </span>
                                    {!pkg.checkout_ready && missingDurations.length > 0 && (
                                        <div className="font-mono text-xs text-yellow-800">
                                            Faltan precios: {missingDurations.join(', ')}
                                        </div>
                                    )}
                                </td>
                                <td className="p-3 align-top text-right space-y-2">
                                    <button
                                        onClick={() => void savePackage(pkg)}
                                        disabled={savingId === pkg.id}
                                        className="block w-full px-3 py-2 bg-[#006064] text-white font-bold uppercase text-xs disabled:opacity-50"
                                    >
                                        {savingId === pkg.id ? '...' : 'Guardar'}
                                    </button>
                                    <button
                                        onClick={() => void syncStripe(pkg)}
                                        disabled={syncingId === pkg.id}
                                        className="block w-full px-3 py-2 border-2 border-[#006064] text-[#006064] font-bold uppercase text-xs disabled:opacity-50"
                                    >
                                        {syncingId === pkg.id ? '...' : 'Stripe'}
                                    </button>
                                </td>
                            </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            <div className="border-2 border-[#006064] bg-white p-5">
                <h2 className="font-display text-xl text-[#006064] uppercase mb-4">Nuevo paquete</h2>
                <div className="grid grid-cols-1 lg:grid-cols-6 gap-3">
                    <input
                        value={newPackage.name}
                        onChange={(event) => setNewPackage((current) => ({ ...current, name: event.target.value }))}
                        className="border border-[#006064]/30 p-3 text-[#006064]"
                        placeholder="clave"
                        aria-label="Clave"
                    />
                    {(['es', 'en', 'ru'] as const).map((lang) => (
                        <input
                            key={lang}
                            value={newPackage.displayName[lang]}
                            onChange={(event) => setNewPackage((current) => ({
                                ...current,
                                displayName: { ...current.displayName, [lang]: event.target.value },
                            }))}
                            className="border border-[#006064]/30 p-3 text-[#006064]"
                            placeholder={`nombre ${lang}`}
                            aria-label={`Nombre ${lang}`}
                        />
                    ))}
                    <input
                        type="number"
                        min="1"
                        step="0.01"
                        value={newPackage.priceMonthlyEur}
                        onChange={(event) => setNewPackage((current) => ({ ...current, priceMonthlyEur: event.target.value }))}
                        className="border border-[#006064]/30 p-3 text-[#006064]"
                        placeholder="EUR"
                        aria-label="Precio mensual"
                    />
                    <input
                        type="number"
                        min="1"
                        max="200"
                        value={newPackage.sessionsPerMonth}
                        onChange={(event) => setNewPackage((current) => ({ ...current, sessionsPerMonth: event.target.value }))}
                        className="border border-[#006064]/30 p-3 text-[#006064]"
                        placeholder="clases"
                        aria-label="Clases al mes"
                    />
                </div>
                <div className="mt-4 flex flex-wrap items-center gap-4">
                    <label className="flex items-center gap-2 text-[#006064]">
                        <input
                            type="checkbox"
                            checked={newPackage.hasGroupSession}
                            onChange={(event) => setNewPackage((current) => ({ ...current, hasGroupSession: event.target.checked }))}
                            className="h-4 w-4 accent-[#006064]"
                        />
                        Grupo
                    </label>
                    <label className="flex items-center gap-2 text-[#006064]">
                        <input
                            type="checkbox"
                            checked={newPackage.hasDualTeacher}
                            onChange={(event) => setNewPackage((current) => ({ ...current, hasDualTeacher: event.target.checked }))}
                            className="h-4 w-4 accent-[#006064]"
                        />
                        Doble profesor
                    </label>
                    <label className="flex items-center gap-2 text-[#006064]">
                        <input
                            type="checkbox"
                            checked={newPackage.isActive}
                            onChange={(event) => setNewPackage((current) => ({ ...current, isActive: event.target.checked }))}
                            className="h-4 w-4 accent-[#006064]"
                        />
                        Activo
                    </label>
                    <button
                        onClick={() => void createPackage()}
                        className="ml-auto px-5 py-3 bg-[#006064] text-white font-bold uppercase text-xs"
                    >
                        Crear
                    </button>
                </div>
            </div>
        </div>
    );
}
