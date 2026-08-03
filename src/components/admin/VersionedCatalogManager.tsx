import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    buildGuaranteeSchedule,
    isCurrentCheckoutRuntimeCompatible,
    type CatalogV2IntervalUnit,
    type CatalogV2LocalizedText,
} from '../../lib/catalog-v2';

type GuaranteeStep = ReturnType<typeof buildGuaranteeSchedule>[number];

type DraftDto = {
    id: string;
    package_id: string;
    package_key: string;
    base_catalog_version: number;
    revision: number;
    status: 'draft' | 'published' | 'discarded';
    display_name: CatalogV2LocalizedText;
    amount_cents: number;
    currency: string;
    billing_interval_unit: CatalogV2IntervalUnit;
    billing_interval_count: number;
    sessions_per_period: number;
    class_duration_minutes: number;
    has_group_session: boolean;
    has_dual_teacher: boolean;
    is_publicly_listed: boolean;
    checkout_compatible: boolean;
    guarantee_schedule: GuaranteeStep[];
    updated_at: string;
};

type CatalogPackageDto = {
    id: string;
    package_key: string;
    catalog_version: number;
    display_name: CatalogV2LocalizedText;
    amount_cents: number | null;
    currency: string;
    billing_interval_unit: CatalogV2IntervalUnit | null;
    billing_interval_count: number | null;
    sessions_per_period: number | null;
    class_duration_minutes: number | null;
    has_group_session: boolean;
    has_dual_teacher: boolean;
    is_active: boolean;
    is_publicly_listed: boolean;
    checkout_compatible: boolean;
    sellable_now: boolean;
    stripe_product: string | null;
    active_price: {
        id: string;
        catalog_version: number;
        recurring_stripe_price: string | null;
        initial_stripe_price: string | null;
    } | null;
    draft: DraftDto | null;
    history: Array<{
        id: string;
        catalog_version: number;
        amount_cents: number;
        billing_interval_unit: string | null;
        billing_interval_count: number | null;
        sessions_per_period: number;
        class_duration_minutes: number | null;
        status: string;
        activated_at: string;
        retired_at: string | null;
    }>;
};

type CatalogResponse = {
    can_write?: boolean;
    packages?: CatalogPackageDto[];
    error?: string;
    code?: string;
    operation?: { changed?: boolean; warnings?: string[] };
};

type EditableTerms = {
    displayName: CatalogV2LocalizedText;
    amountEur: string;
    billingIntervalUnit: CatalogV2IntervalUnit;
    billingIntervalCount: string;
    sessionsPerPeriod: string;
    classDurationMinutes: string;
    hasGroupSession: boolean;
    hasDualTeacher: boolean;
    isPubliclyListed: boolean;
};

type DraftEditor = EditableTerms & {
    draftId: string;
    packageKey: string;
    revision: number;
    savedFingerprint: string;
};

const emptyNames: CatalogV2LocalizedText = { es: '', en: '', ru: '' };
const intervalLabels: Record<CatalogV2IntervalUnit, string> = {
    day: 'días',
    week: 'semanas',
    month: 'meses',
    year: 'años',
};

function centsToInput(value: number): string {
    return (value / 100).toFixed(2).replace(/\.00$/, '');
}

function inputToCents(value: string): number {
    return Math.round(Number(value.replace(',', '.')) * 100);
}

function formatCurrency(value: number): string {
    return new Intl.NumberFormat('es-ES', {
        style: 'currency',
        currency: 'EUR',
    }).format(value / 100);
}

function editorFingerprint(value: EditableTerms): string {
    return JSON.stringify({
        displayName: {
            es: value.displayName.es.trim(),
            en: value.displayName.en.trim(),
            ru: value.displayName.ru.trim(),
        },
        amountEur: value.amountEur,
        billingIntervalUnit: value.billingIntervalUnit,
        billingIntervalCount: value.billingIntervalCount,
        sessionsPerPeriod: value.sessionsPerPeriod,
        classDurationMinutes: value.classDurationMinutes,
        hasGroupSession: value.hasGroupSession,
        hasDualTeacher: value.hasDualTeacher,
        isPubliclyListed: value.isPubliclyListed,
    });
}

function draftToEditor(draft: DraftDto): DraftEditor {
    const terms: EditableTerms = {
        displayName: { ...draft.display_name },
        amountEur: centsToInput(draft.amount_cents),
        billingIntervalUnit: draft.billing_interval_unit,
        billingIntervalCount: String(draft.billing_interval_count),
        sessionsPerPeriod: String(draft.sessions_per_period),
        classDurationMinutes: String(draft.class_duration_minutes),
        hasGroupSession: draft.has_group_session,
        hasDualTeacher: draft.has_dual_teacher,
        isPubliclyListed: draft.is_publicly_listed,
    };
    return {
        ...terms,
        draftId: draft.id,
        packageKey: draft.package_key,
        revision: draft.revision,
        savedFingerprint: editorFingerprint(terms),
    };
}

function editorNumbers(value: EditableTerms) {
    return {
        amountCents: inputToCents(value.amountEur),
        billingIntervalCount: Number(value.billingIntervalCount),
        sessionsPerPeriod: Number(value.sessionsPerPeriod),
        classDurationMinutes: Number(value.classDurationMinutes),
    };
}

function isEditorValid(value: EditableTerms): boolean {
    const numbers = editorNumbers(value);
    const maximum = value.billingIntervalUnit === 'day'
        ? 1095
        : value.billingIntervalUnit === 'week'
            ? 156
            : value.billingIntervalUnit === 'month'
                ? 36
                : 3;
    return Object.values(value.displayName).every((name) => name.trim().length >= 1 && name.trim().length <= 120)
        && Number.isInteger(numbers.amountCents)
        && numbers.amountCents >= numbers.sessionsPerPeriod
        && numbers.amountCents <= 1_000_000
        && Number.isInteger(numbers.billingIntervalCount)
        && numbers.billingIntervalCount >= 1
        && numbers.billingIntervalCount <= maximum
        && Number.isInteger(numbers.sessionsPerPeriod)
        && numbers.sessionsPerPeriod >= 1
        && numbers.sessionsPerPeriod <= 200
        && Number.isInteger(numbers.classDurationMinutes)
        && numbers.classDurationMinutes >= 15
        && numbers.classDurationMinutes <= 240;
}

function checkoutCompatible(packageKey: string, value: EditableTerms): boolean {
    if (!isEditorValid(value)) return false;
    const numbers = editorNumbers(value);
    return isCurrentCheckoutRuntimeCompatible({
        packageKey,
        amountCents: numbers.amountCents,
        currency: 'eur',
        billingIntervalUnit: value.billingIntervalUnit,
        billingIntervalCount: numbers.billingIntervalCount,
        sessionsPerPeriod: numbers.sessionsPerPeriod,
        classDurationMinutes: numbers.classDurationMinutes,
        hasGroupSession: value.hasGroupSession,
        hasDualTeacher: value.hasDualTeacher,
    });
}

function termsPayload(value: EditableTerms) {
    const numbers = editorNumbers(value);
    return {
        displayName: {
            es: value.displayName.es.trim(),
            en: value.displayName.en.trim(),
            ru: value.displayName.ru.trim(),
        },
        ...numbers,
        billingIntervalUnit: value.billingIntervalUnit,
        hasGroupSession: value.hasGroupSession,
        hasDualTeacher: value.hasDualTeacher,
        isPubliclyListed: value.isPubliclyListed,
    };
}

function CheckoutBadge({ compatible, sellable }: { compatible: boolean; sellable?: boolean }) {
    const label = sellable
        ? 'Vendible ahora'
        : compatible
            ? 'Compatible con checkout actual'
            : 'Checkout pendiente';
    const color = sellable
        ? 'bg-green-100 text-green-800 border-green-600'
        : compatible
            ? 'bg-blue-50 text-blue-800 border-blue-500'
            : 'bg-amber-50 text-amber-900 border-amber-500';
    return <span className={`inline-flex border px-2 py-1 text-xs font-bold ${color}`}>{label}</span>;
}

function DraftFields(props: {
    packageKey: string;
    value: EditableTerms;
    disabled: boolean;
    onChange: (patch: Partial<EditableTerms>) => void;
}) {
    const { packageKey, value, disabled, onChange } = props;
    const compatible = checkoutCompatible(packageKey, value);
    const numbers = editorNumbers(value);
    const schedule = isEditorValid(value)
        ? buildGuaranteeSchedule(numbers.amountCents, numbers.sessionsPerPeriod)
        : [];
    const visibleSchedule = schedule.length <= 7
        ? schedule
        : [...schedule.slice(0, 6), schedule[schedule.length - 1]!];

    return (
        <div className="space-y-5">
            <fieldset disabled={disabled} className="space-y-4 disabled:opacity-60">
                <legend className="sr-only">Condiciones del paquete</legend>
                <div className="grid gap-3 md:grid-cols-3">
                    {(['es', 'en', 'ru'] as const).map((language) => (
                        <label key={language} className="block text-xs font-mono uppercase text-[#006064]">
                            Nombre {language}
                            <input
                                value={value.displayName[language]}
                                onChange={(event) => onChange({
                                    displayName: { ...value.displayName, [language]: event.target.value },
                                })}
                                className="mt-1 w-full border border-[#006064]/35 bg-white p-2 text-base normal-case text-[#006064]"
                                maxLength={120}
                                required
                            />
                        </label>
                    ))}
                </div>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <label className="text-xs font-mono uppercase text-[#006064]">
                        Precio por ciclo (EUR)
                        <input
                            type="number"
                            min="0.01"
                            max="10000"
                            step="0.01"
                            value={value.amountEur}
                            onChange={(event) => onChange({ amountEur: event.target.value })}
                            className="mt-1 w-full border border-[#006064]/35 bg-white p-2 text-base normal-case"
                        />
                    </label>
                    <label className="text-xs font-mono uppercase text-[#006064]">
                        Renovación cada
                        <span className="mt-1 flex">
                            <input
                                type="number"
                                min="1"
                                value={value.billingIntervalCount}
                                onChange={(event) => onChange({ billingIntervalCount: event.target.value })}
                                className="min-w-0 flex-1 border border-r-0 border-[#006064]/35 bg-white p-2 text-base normal-case"
                            />
                            <select
                                value={value.billingIntervalUnit}
                                onChange={(event) => onChange({ billingIntervalUnit: event.target.value as CatalogV2IntervalUnit })}
                                className="border border-[#006064]/35 bg-white p-2 text-sm normal-case"
                                aria-label="Unidad del periodo de renovación"
                            >
                                {Object.entries(intervalLabels).map(([unit, label]) => (
                                    <option key={unit} value={unit}>{label}</option>
                                ))}
                            </select>
                        </span>
                    </label>
                    <label className="text-xs font-mono uppercase text-[#006064]">
                        Clases por ciclo
                        <input
                            type="number"
                            min="1"
                            max="200"
                            value={value.sessionsPerPeriod}
                            onChange={(event) => onChange({ sessionsPerPeriod: event.target.value })}
                            className="mt-1 w-full border border-[#006064]/35 bg-white p-2 text-base normal-case"
                        />
                    </label>
                    <label className="text-xs font-mono uppercase text-[#006064]">
                        Minutos por clase
                        <input
                            type="number"
                            min="15"
                            max="240"
                            value={value.classDurationMinutes}
                            onChange={(event) => onChange({ classDurationMinutes: event.target.value })}
                            className="mt-1 w-full border border-[#006064]/35 bg-white p-2 text-base normal-case"
                        />
                    </label>
                </div>
                <div className="flex flex-wrap gap-x-6 gap-y-3 text-sm text-[#006064]">
                    <label className="flex items-center gap-2">
                        <input
                            type="checkbox"
                            checked={value.hasGroupSession}
                            onChange={(event) => onChange({ hasGroupSession: event.target.checked })}
                            className="h-4 w-4 accent-[#006064]"
                        />
                        Incluye grupo
                    </label>
                    <label className="flex items-center gap-2">
                        <input
                            type="checkbox"
                            checked={value.hasDualTeacher}
                            onChange={(event) => onChange({ hasDualTeacher: event.target.checked })}
                            className="h-4 w-4 accent-[#006064]"
                        />
                        Doble profesor
                    </label>
                    <label className="flex items-center gap-2">
                        <input
                            type="checkbox"
                            checked={value.isPubliclyListed}
                            onChange={(event) => onChange({ isPubliclyListed: event.target.checked })}
                            disabled={disabled || (!compatible && !value.isPubliclyListed)}
                            className="h-4 w-4 accent-[#006064]"
                        />
                        Mostrar públicamente
                    </label>
                </div>
            </fieldset>

            <section className="border border-[#006064]/30 bg-[#f5ffff] p-4" aria-label="Vista previa del paquete">
                <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                        <p className="font-mono text-xs uppercase tracking-wide text-[#006064]/65">Vista previa</p>
                        <h3 className="mt-1 text-xl font-bold text-[#006064]">{value.displayName.es || 'Nombre del paquete'}</h3>
                        {isEditorValid(value) && (
                            <p className="mt-1 text-sm text-[#006064]">
                                {numbers.sessionsPerPeriod} clases de {numbers.classDurationMinutes} min · {formatCurrency(numbers.amountCents)} cada {numbers.billingIntervalCount} {intervalLabels[value.billingIntervalUnit]}
                            </p>
                        )}
                    </div>
                    <CheckoutBadge compatible={compatible} />
                </div>
                {!compatible && (
                    <p className="mt-3 border-l-4 border-amber-500 pl-3 text-sm text-amber-900">
                        Se puede guardar y publicar como oferta interna, pero no marcarla como pública: compra, agenda y ciclo académico todavía solo admiten 4×50 min, 259 € y renovación cada 28 días.
                    </p>
                )}
                {visibleSchedule.length > 0 && (
                    <details className="mt-4">
                        <summary className="cursor-pointer font-mono text-xs font-bold uppercase text-[#006064]">
                            Garantía proporcional por clase
                        </summary>
                        <div className="mt-2 overflow-x-auto">
                            <table className="min-w-full text-left text-sm">
                                <thead>
                                    <tr className="border-b border-[#006064]/25">
                                        <th className="py-2 pr-4">Tras consumir</th>
                                        <th className="py-2 pr-4">Valor consumido</th>
                                        <th className="py-2">Máximo restante</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {visibleSchedule.map((step, index) => (
                                        <tr key={step.consumedSessions} className="border-b border-[#006064]/10">
                                            <td className="py-2 pr-4">
                                                {step.consumedSessions} clase{step.consumedSessions === 1 ? '' : 's'}
                                                {schedule.length > 7 && index === visibleSchedule.length - 1 ? ' (última)' : ''}
                                            </td>
                                            <td className="py-2 pr-4">{formatCurrency(step.consumedAmountCents)}</td>
                                            <td className="py-2 font-bold">{formatCurrency(step.refundableAmountCents)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </details>
                )}
            </section>
        </div>
    );
}

export default function VersionedCatalogManager() {
    const [packages, setPackages] = useState<CatalogPackageDto[]>([]);
    const [editors, setEditors] = useState<Record<string, DraftEditor>>({});
    const [canWrite, setCanWrite] = useState(false);
    const [loading, setLoading] = useState(true);
    const [mutation, setMutation] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [message, setMessage] = useState<string | null>(null);
    const [creatingNew, setCreatingNew] = useState(false);
    const [newPackageKey, setNewPackageKey] = useState('');
    const [newTerms, setNewTerms] = useState<EditableTerms>({
        displayName: { ...emptyNames },
        amountEur: '259',
        billingIntervalUnit: 'day',
        billingIntervalCount: '28',
        sessionsPerPeriod: '4',
        classDurationMinutes: '50',
        hasGroupSession: false,
        hasDualTeacher: false,
        isPubliclyListed: false,
    });

    const applyCatalog = useCallback((data: CatalogResponse) => {
        const nextPackages = data.packages ?? [];
        setPackages(nextPackages);
        setEditors(Object.fromEntries(
            nextPackages
                .filter((pkg) => pkg.draft)
                .map((pkg) => [pkg.id, draftToEditor(pkg.draft!)]),
        ));
        if (typeof data.can_write === 'boolean') setCanWrite(data.can_write);
    }, []);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const response = await fetch('/api/admin/catalog-v2');
            const data = await response.json() as CatalogResponse;
            if (!response.ok) throw new Error(data.error || 'No se pudo cargar el catálogo versionado');
            applyCatalog(data);
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : 'No se pudo cargar el catálogo versionado');
        } finally {
            setLoading(false);
        }
    }, [applyCatalog]);

    useEffect(() => {
        void load();
    }, [load]);

    const mutate = async (key: string, payload: Record<string, unknown>, success: string) => {
        if (mutation) return false;
        setMutation(key);
        setError(null);
        setMessage(null);
        try {
            const response = await fetch('/api/admin/catalog-v2', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            const data = await response.json() as CatalogResponse;
            if (!response.ok) throw new Error(data.error || 'La operación no se pudo completar');
            applyCatalog(data);
            const warning = data.operation?.warnings?.length
                ? ' El catálogo y el checkout quedaron seguros, pero Stripe tiene recursos antiguos pendientes de limpieza técnica.'
                : '';
            setMessage(`${success}.${warning}`);
            return true;
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : 'La operación no se pudo completar');
            return false;
        } finally {
            setMutation(null);
        }
    };

    const updateEditor = (packageId: string, patch: Partial<EditableTerms>) => {
        setEditors((current) => ({
            ...current,
            [packageId]: { ...current[packageId]!, ...patch },
        }));
    };

    const activeSellable = useMemo(() => packages.filter((pkg) => pkg.sellable_now).length, [packages]);
    const mutating = mutation !== null;

    if (loading) {
        return <div role="status" className="border-2 border-[#006064] bg-white p-6 font-mono text-[#006064]">Cargando catálogo versionado…</div>;
    }

    return (
        <section className="space-y-6" aria-labelledby="catalog-v2-title">
            <div className="border-2 border-[#006064] bg-[#eaffff] p-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                        <p className="font-mono text-xs font-bold uppercase tracking-widest text-[#006064]/65">Flujo recomendado</p>
                        <h2 id="catalog-v2-title" className="mt-1 font-display text-2xl uppercase text-[#006064]">Catálogo versionado</h2>
                        <p className="mt-2 max-w-3xl text-sm text-[#006064]/80">
                            Borrador → vista previa → publicación. Guardar nunca toca Stripe; publicar crea snapshots inmutables y retirar oculta la venta sin borrar el historial.
                        </p>
                    </div>
                    <div className="font-mono text-xs text-[#006064]">
                        <strong className="text-lg">{activeSellable}</strong> oferta(s) vendible(s) ahora
                    </div>
                </div>
            </div>

            {!canWrite && (
                <div role="status" className="border-2 border-blue-500 bg-blue-50 p-4 text-sm text-blue-900">
                    Vista de solo lectura. Hace falta el permiso <code>catalog.write</code> para crear, publicar o retirar.
                </div>
            )}
            {error && <div role="alert" className="border-2 border-red-500 bg-red-50 p-4 text-sm text-red-800">{error}</div>}
            {message && <div role="status" aria-live="polite" className="border-2 border-green-600 bg-green-50 p-4 text-sm text-green-800">{message}</div>}

            <div className="space-y-5">
                {packages.length === 0 && (
                    <div className="border-2 border-dashed border-[#006064]/50 bg-white p-6 text-center text-[#006064]/70">No hay paquetes versionados.</div>
                )}
                {packages.map((pkg) => {
                    const editor = editors[pkg.id];
                    const dirty = editor ? editorFingerprint(editor) !== editor.savedFingerprint : false;
                    const valid = editor ? isEditorValid(editor) : false;
                    const compatible = editor ? checkoutCompatible(editor.packageKey, editor) : pkg.checkout_compatible;
                    return (
                        <article key={pkg.id} className="border-2 border-[#006064] bg-white">
                            <header className="flex flex-wrap items-start justify-between gap-4 border-b border-[#006064]/20 p-5">
                                <div>
                                    <div className="flex flex-wrap items-center gap-2">
                                        <h3 className="font-display text-xl uppercase text-[#006064]">{pkg.display_name.es || pkg.package_key}</h3>
                                        <span className="bg-[#006064] px-2 py-1 font-mono text-xs text-white">v{pkg.catalog_version}</span>
                                        <CheckoutBadge compatible={pkg.checkout_compatible} sellable={pkg.sellable_now} />
                                    </div>
                                    <p className="mt-1 font-mono text-xs text-[#006064]/65">{pkg.package_key}</p>
                                    <p className="mt-2 text-sm text-[#006064]">
                                        {pkg.amount_cents ? formatCurrency(pkg.amount_cents) : 'Sin precio'} · {pkg.sessions_per_period ?? '—'} clases de {pkg.class_duration_minutes ?? '—'} min · cada {pkg.billing_interval_count ?? '—'} {pkg.billing_interval_unit ? intervalLabels[pkg.billing_interval_unit] : ''}
                                    </p>
                                </div>
                                <div className="flex flex-wrap gap-2 text-xs font-bold">
                                    <span className={`border px-2 py-1 ${pkg.is_active ? 'border-green-600 bg-green-50 text-green-800' : 'border-gray-400 bg-gray-50 text-gray-700'}`}>
                                        {pkg.is_active ? 'Publicado' : 'Retirado'}
                                    </span>
                                    <span className={`border px-2 py-1 ${pkg.is_publicly_listed ? 'border-blue-500 bg-blue-50 text-blue-800' : 'border-gray-400 bg-gray-50 text-gray-700'}`}>
                                        {pkg.is_publicly_listed ? 'Visible' : 'No listado'}
                                    </span>
                                </div>
                            </header>

                            <div className="p-5">
                                {!editor ? (
                                    <div className="flex flex-wrap items-center justify-between gap-3">
                                        <p className="text-sm text-[#006064]/75">No hay cambios pendientes. La versión publicada no se modifica directamente.</p>
                                        <div className="flex flex-wrap gap-2">
                                            <button
                                                type="button"
                                                disabled={!canWrite || mutating}
                                                onClick={() => void mutate(`draft:${pkg.id}`, {
                                                    action: 'create_draft',
                                                    packageId: pkg.id,
                                                }, 'Nueva versión creada como borrador')}
                                                className="border-2 border-[#006064] px-4 py-2 text-xs font-bold uppercase text-[#006064] disabled:opacity-50"
                                            >
                                                {mutation === `draft:${pkg.id}` ? 'Creando…' : 'Crear nueva versión'}
                                            </button>
                                            {(pkg.is_active || pkg.is_publicly_listed) && (
                                                <button
                                                    type="button"
                                                    disabled={!canWrite || mutating}
                                                    onClick={() => {
                                                        if (window.confirm('¿Retirar esta oferta? Se ocultará y conservará todo el historial.')) {
                                                            void mutate(`retire:${pkg.id}`, {
                                                                action: 'retire_package',
                                                                packageId: pkg.id,
                                                            }, 'Oferta retirada')
                                                        }
                                                    }}
                                                    className="border-2 border-red-600 px-4 py-2 text-xs font-bold uppercase text-red-700 disabled:opacity-50"
                                                >
                                                    {mutation === `retire:${pkg.id}` ? 'Retirando…' : 'Retirar'}
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                ) : (
                                    <div className="space-y-5">
                                        <div className="flex flex-wrap items-center justify-between gap-2">
                                            <div>
                                                <span className="bg-amber-100 px-2 py-1 font-mono text-xs font-bold text-amber-900">Borrador r{editor.revision}</span>
                                                {dirty && <span className="ml-2 text-xs font-bold text-amber-800">Cambios sin guardar</span>}
                                            </div>
                                            <span className="font-mono text-xs text-[#006064]/60">Publicará v{pkg.catalog_version + 1}</span>
                                        </div>
                                        <DraftFields
                                            packageKey={editor.packageKey}
                                            value={editor}
                                            disabled={!canWrite || mutating}
                                            onChange={(patch) => updateEditor(pkg.id, patch)}
                                        />
                                        <div className="flex flex-wrap justify-end gap-2 border-t border-[#006064]/20 pt-4">
                                            <button
                                                type="button"
                                                disabled={!canWrite || mutating}
                                                onClick={() => {
                                                    if (window.confirm('¿Descartar este borrador? El evento quedará en el historial de auditoría.')) {
                                                        void mutate(`discard:${pkg.id}`, {
                                                            action: 'discard_draft',
                                                            draftId: editor.draftId,
                                                            expectedRevision: editor.revision,
                                                        }, 'Borrador descartado')
                                                    }
                                                }}
                                                className="mr-auto border border-red-600 px-4 py-2 text-xs font-bold uppercase text-red-700 disabled:opacity-50"
                                            >
                                                Descartar
                                            </button>
                                            <button
                                                type="button"
                                                disabled={!canWrite || mutating || !valid || !dirty || (editor.isPubliclyListed && !compatible)}
                                                onClick={() => void mutate(`save:${pkg.id}`, {
                                                    action: 'update_draft',
                                                    draftId: editor.draftId,
                                                    expectedRevision: editor.revision,
                                                    ...termsPayload(editor),
                                                }, 'Borrador guardado')}
                                                className="border-2 border-[#006064] px-4 py-2 text-xs font-bold uppercase text-[#006064] disabled:opacity-50"
                                            >
                                                {mutation === `save:${pkg.id}` ? 'Guardando…' : 'Guardar borrador'}
                                            </button>
                                            <button
                                                type="button"
                                                disabled={!canWrite || mutating || !valid || dirty || (editor.isPubliclyListed && !compatible)}
                                                onClick={() => {
                                                    if (window.confirm('¿Publicar esta versión? Esta acción creará precios inmutables en Stripe.')) {
                                                        void mutate(`publish:${pkg.id}`, {
                                                            action: 'publish_draft',
                                                            draftId: editor.draftId,
                                                            expectedRevision: editor.revision,
                                                        }, compatible ? 'Versión publicada y lista para el checkout actual' : 'Versión publicada como oferta interna')
                                                    }
                                                }}
                                                className="bg-[#006064] px-5 py-2 text-xs font-bold uppercase text-white disabled:opacity-50"
                                            >
                                                {mutation === `publish:${pkg.id}` ? 'Publicando…' : 'Publicar'}
                                            </button>
                                        </div>
                                    </div>
                                )}

                                {pkg.history.length > 0 && (
                                    <details className="mt-5 border-t border-[#006064]/15 pt-4">
                                        <summary className="cursor-pointer font-mono text-xs font-bold uppercase text-[#006064]">Historial ({pkg.history.length})</summary>
                                        <ul className="mt-3 space-y-2 text-sm text-[#006064]/80">
                                            {pkg.history.map((version) => (
                                                <li key={version.id} className="flex flex-wrap justify-between gap-2 border-b border-[#006064]/10 pb-2">
                                                    <span>v{version.catalog_version} · {formatCurrency(version.amount_cents)} · {version.sessions_per_period}×{version.class_duration_minutes} min</span>
                                                    <strong>{version.status === 'active' ? 'Activa' : 'Retirada'}</strong>
                                                </li>
                                            ))}
                                        </ul>
                                    </details>
                                )}
                            </div>
                        </article>
                    );
                })}
            </div>

            <div className="border-2 border-dashed border-[#006064] bg-white p-5">
                <button
                    type="button"
                    onClick={() => setCreatingNew((value) => !value)}
                    disabled={!canWrite || mutating}
                    className="font-display text-lg uppercase text-[#006064] disabled:opacity-50"
                    aria-expanded={creatingNew}
                >
                    {creatingNew ? '− Cerrar nuevo paquete' : '+ Crear paquete nuevo'}
                </button>
                {creatingNew && (
                    <div className="mt-5 space-y-5">
                        <label className="block max-w-md text-xs font-mono uppercase text-[#006064]">
                            Clave estable
                            <input
                                value={newPackageKey}
                                onChange={(event) => setNewPackageKey(event.target.value.toLowerCase())}
                                placeholder="por_ejemplo_8x50_28d"
                                pattern="[a-z0-9][a-z0-9_-]{1,48}"
                                maxLength={49}
                                className="mt-1 w-full border border-[#006064]/35 p-2 text-base normal-case"
                                disabled={mutating}
                            />
                            <span className="mt-1 block normal-case text-[#006064]/60">No cambia después; el nombre visible sí.</span>
                        </label>
                        <DraftFields
                            packageKey={newPackageKey}
                            value={newTerms}
                            disabled={mutating}
                            onChange={(patch) => setNewTerms((current) => ({ ...current, ...patch }))}
                        />
                        <div className="flex justify-end">
                            <button
                                type="button"
                                disabled={
                                    mutating
                                    || !/^[a-z0-9][a-z0-9_-]{1,48}$/.test(newPackageKey)
                                    || !isEditorValid(newTerms)
                                    || (newTerms.isPubliclyListed && !checkoutCompatible(newPackageKey, newTerms))
                                }
                                onClick={async () => {
                                    const created = await mutate('create:new', {
                                        action: 'create_draft',
                                        packageKey: newPackageKey,
                                        ...termsPayload(newTerms),
                                    }, 'Paquete creado como borrador; Stripe sigue intacto');
                                    if (created) {
                                        setCreatingNew(false);
                                        setNewPackageKey('');
                                    }
                                }}
                                className="bg-[#006064] px-5 py-3 text-xs font-bold uppercase text-white disabled:opacity-50"
                            >
                                {mutation === 'create:new' ? 'Creando…' : 'Crear borrador'}
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </section>
    );
}
