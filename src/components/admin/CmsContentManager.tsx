import { useCallback, useEffect, useMemo, useState } from 'react';
import {
    cmsHomeContentSchema,
    type CmsHomeContent,
    type CmsHomeLocale,
} from '../../lib/cms-home-content';

type CmsSurface = {
    locale: CmsHomeLocale;
    effective_payload: CmsHomeContent;
    document: null | {
        id: string;
        current_version: number;
        published_at: string | null;
        updated_at: string;
        published_valid: boolean;
    };
    draft: null | {
        id: string;
        base_version: number;
        revision: number;
        status: 'draft';
        payload: CmsHomeContent | null;
        payload_valid: boolean;
        created_at: string;
        updated_at: string;
    };
    history: Array<{
        id: string;
        version: number;
        published_at: string;
    }>;
};

type CmsState = {
    surfaces: CmsSurface[];
    can_write: boolean;
};

const localeLabels: Record<CmsHomeLocale, string> = {
    es: 'Español',
    en: 'English',
    ru: 'Русский',
};

const navFields = [
    { key: 'brand', label: 'Marca', maxLength: 80 },
    { key: 'method', label: 'Método', maxLength: 40 },
    { key: 'progress', label: 'Progreso', maxLength: 40 },
    { key: 'plans', label: 'Planes', maxLength: 40 },
    { key: 'team', label: 'Equipo', maxLength: 40 },
    { key: 'faq', label: 'Preguntas frecuentes', maxLength: 40 },
    { key: 'blog', label: 'Blog', maxLength: 40 },
    { key: 'login', label: 'Acceso', maxLength: 40 },
] as const satisfies ReadonlyArray<{
    key: keyof CmsHomeContent['nav'];
    label: string;
    maxLength: number;
}>;

const heroFields = [
    { key: 'headline1', label: 'Titular · línea 1', maxLength: 60 },
    { key: 'headline2', label: 'Titular · línea 2', maxLength: 60 },
    { key: 'headline3', label: 'Titular · línea 3', maxLength: 60 },
    { key: 'manifesto', label: 'Manifiesto breve', maxLength: 160 },
    { key: 'subtitle', label: 'Subtítulo', maxLength: 500, multiline: true },
    { key: 'ready', label: 'Texto previo al botón', maxLength: 100 },
    { key: 'cta', label: 'Botón principal', maxLength: 80 },
] as const satisfies ReadonlyArray<{
    key: keyof CmsHomeContent['hero'];
    label: string;
    maxLength: number;
    multiline?: boolean;
}>;

function cloneContent(content: CmsHomeContent): CmsHomeContent {
    return structuredClone(content);
}

function Field(props: {
    label: string;
    value: string;
    onChange: (value: string) => void;
    multiline?: boolean;
    disabled?: boolean;
    maxLength: number;
}) {
    const className = 'mt-1 w-full border-2 border-[#006064] bg-white px-3 py-2 text-[#006064] focus:outline-none focus:ring-4 focus:ring-[#006064]/30 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:opacity-70';
    return (
        <label className="block text-sm font-bold text-[#006064]">
            <span className="flex items-baseline justify-between gap-3">
                <span>{props.label}</span>
                <span className="font-mono text-[0.68rem] font-normal">
                    {props.value.length}/{props.maxLength}
                </span>
            </span>
            {props.multiline ? (
                <textarea
                    className={`${className} min-h-24`}
                    disabled={props.disabled}
                    maxLength={props.maxLength}
                    required
                    value={props.value}
                    onChange={(event) => props.onChange(event.target.value)}
                />
            ) : (
                <input
                    className={className}
                    disabled={props.disabled}
                    maxLength={props.maxLength}
                    required
                    value={props.value}
                    onChange={(event) => props.onChange(event.target.value)}
                />
            )}
        </label>
    );
}

export default function CmsContentManager() {
    const [state, setState] = useState<CmsState | null>(null);
    const [locale, setLocale] = useState<CmsHomeLocale>('en');
    const [form, setForm] = useState<CmsHomeContent | null>(null);
    const [dirty, setDirty] = useState(false);
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState('');
    const [error, setError] = useState('');

    const load = useCallback(async () => {
        setBusy(true);
        setError('');
        try {
            const response = await fetch('/api/admin/content', {
                headers: { Accept: 'application/json' },
            });
            const body = await response.json() as CmsState & { error?: string };
            if (!response.ok) throw new Error(body.error || 'No se pudo cargar el contenido');
            setState(body);
        } catch (loadError) {
            setError(loadError instanceof Error ? loadError.message : 'No se pudo cargar el contenido');
        } finally {
            setBusy(false);
        }
    }, []);

    useEffect(() => {
        void load();
    }, [load]);

    const surface = useMemo(
        () => state?.surfaces.find((candidate) => candidate.locale === locale) ?? null,
        [locale, state],
    );

    useEffect(() => {
        if (!surface) return;
        setForm(cloneContent(surface.draft?.payload ?? surface.effective_payload));
        setDirty(false);
    }, [surface]);

    useEffect(() => {
        if (!dirty) return;
        const warnBeforeUnload = (event: BeforeUnloadEvent) => {
            event.preventDefault();
            event.returnValue = '';
        };
        globalThis.addEventListener('beforeunload', warnBeforeUnload);
        return () => globalThis.removeEventListener('beforeunload', warnBeforeUnload);
    }, [dirty]);

    const perform = useCallback(async (action: Record<string, unknown>) => {
        setBusy(true);
        setError('');
        setMessage('');
        try {
            const response = await fetch('/api/admin/content', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                body: JSON.stringify(action),
            });
            const body = await response.json() as Omit<CmsState, 'can_write'> & { error?: string };
            if (!response.ok) throw new Error(body.error || 'La operación no pudo completarse');
            setState((current) => ({
                surfaces: body.surfaces,
                can_write: current?.can_write ?? false,
            }));
            setDirty(false);
            return true;
        } catch (operationError) {
            setError(operationError instanceof Error ? operationError.message : 'La operación no pudo completarse');
            return false;
        } finally {
            setBusy(false);
        }
    }, []);

    const change = useCallback((mutate: (draft: CmsHomeContent) => void) => {
        setForm((current) => {
            if (!current) return current;
            const next = cloneContent(current);
            mutate(next);
            return next;
        });
        setDirty(true);
    }, []);

    if (!state || !surface || !form) {
        return (
            <section className="border-2 border-[#006064] bg-white p-6 text-[#006064]" aria-live="polite">
                {error || (busy ? 'Cargando contenido…' : 'Contenido no disponible.')}
                {error && <button type="button" onClick={() => void load()} className="ml-4 underline">Reintentar</button>}
            </section>
        );
    }

    const createDraft = async () => {
        if (await perform({ action: 'create_draft', locale })) {
            setMessage('Borrador preparado.');
        }
    };
    const saveDraft = async () => {
        if (!surface.draft) return;
        const parsed = cmsHomeContentSchema.safeParse(form);
        if (!parsed.success) {
            const field = parsed.error.issues[0]?.path.join('.') || 'contenido';
            setMessage('');
            setError(`Revisa el campo «${field}»: no puede estar vacío ni superar su límite.`);
            return;
        }
        if (await perform({
            action: 'update_draft',
            draftId: surface.draft.id,
            expectedRevision: surface.draft.revision,
            payload: parsed.data,
        })) setMessage('Borrador guardado.');
    };
    const publishDraft = async () => {
        if (!surface.draft || dirty) return;
        if (await perform({
            action: 'publish_draft',
            draftId: surface.draft.id,
            expectedRevision: surface.draft.revision,
        })) setMessage('Versión publicada.');
    };
    const discardDraft = async () => {
        if (!surface.draft) return;
        if (await perform({
            action: 'discard_draft',
            draftId: surface.draft.id,
            expectedRevision: surface.draft.revision,
        })) setMessage('Borrador descartado.');
    };
    const rollback = async (sourceVersion: number) => {
        if (!surface.document || surface.draft) return;
        if (await perform({
            action: 'rollback',
            documentId: surface.document.id,
            sourceVersion,
            expectedCurrentVersion: surface.document.current_version,
            operationId: crypto.randomUUID(),
        })) setMessage(`La versión ${sourceVersion} se ha republicado como una versión nueva.`);
    };

    const writable = state.can_write && !busy;
    const selectLocale = (candidate: CmsHomeLocale) => {
        if (candidate === locale) return;
        if (dirty && !globalThis.confirm('Hay cambios sin guardar. ¿Cambiar de idioma y descartarlos?')) {
            return;
        }
        setLocale(candidate);
    };

    return (
        <section className="space-y-6" aria-busy={busy}>
            <div className="flex flex-wrap items-center gap-3 border-2 border-[#006064] bg-white p-4">
                {(['en', 'es', 'ru'] as const).map((candidate) => (
                    <button
                        key={candidate}
                        type="button"
                        onClick={() => selectLocale(candidate)}
                        aria-pressed={locale === candidate}
                        className={`border-2 border-[#006064] px-4 py-2 font-mono text-xs font-bold uppercase ${locale === candidate ? 'bg-[#006064] text-white' : 'bg-white text-[#006064]'}`}
                    >
                        {localeLabels[candidate]}
                    </button>
                ))}
                <span className="ml-auto font-mono text-xs text-[#006064]">
                    Publicada: v{surface.document?.current_version ?? 0} · {surface.draft ? `borrador r${surface.draft.revision}` : 'sin borrador'}
                </span>
            </div>

            {(message || error) && (
                <div
                    className={`border-2 p-3 font-bold ${error ? 'border-red-800 bg-red-50 text-red-900' : 'border-emerald-800 bg-emerald-50 text-emerald-900'}`}
                    role={error ? 'alert' : 'status'}
                >
                    {error || message}
                </div>
            )}

            {!surface.draft ? (
                <div className="border-2 border-[#006064] bg-white p-6">
                    <p className="text-[#006064]">La web pública usa la versión publicada o, si todavía no existe, el contenido integrado en código.</p>
                    <button
                        type="button"
                        disabled={!writable}
                        onClick={() => void createDraft()}
                        className="mt-4 border-2 border-[#006064] bg-[#006064] px-5 py-3 font-bold text-white disabled:opacity-50"
                    >
                        Crear borrador desde la versión vigente
                    </button>
                </div>
            ) : (
                <>
                    <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
                        <fieldset className="space-y-4 border-2 border-[#006064] bg-white p-5">
                            <legend className="px-2 font-display text-xl uppercase text-[#006064]">SEO</legend>
                            <Field disabled={!writable} maxLength={100} label="Título" value={form.seo.title} onChange={(value) => change((draft) => { draft.seo.title = value; })} />
                            <Field disabled={!writable} maxLength={320} label="Descripción" multiline value={form.seo.description} onChange={(value) => change((draft) => { draft.seo.description = value; })} />
                        </fieldset>

                        <fieldset className="grid grid-cols-1 gap-4 border-2 border-[#006064] bg-white p-5 sm:grid-cols-2">
                            <legend className="px-2 font-display text-xl uppercase text-[#006064]">Navegación</legend>
                            {navFields.map((field) => (
                                <Field disabled={!writable} key={field.key} label={field.label} maxLength={field.maxLength} value={form.nav[field.key]} onChange={(value) => change((draft) => { draft.nav[field.key] = value; })} />
                            ))}
                        </fieldset>

                        <fieldset className="grid grid-cols-1 gap-4 border-2 border-[#006064] bg-white p-5 sm:grid-cols-2 xl:col-span-2">
                            <legend className="px-2 font-display text-xl uppercase text-[#006064]">Hero</legend>
                            {heroFields.map((field) => (
                                <Field
                                    key={field.key}
                                    label={field.label}
                                    multiline={'multiline' in field && field.multiline}
                                    disabled={!writable}
                                    maxLength={field.maxLength}
                                    value={form.hero[field.key]}
                                    onChange={(value) => change((draft) => { draft.hero[field.key] = value; })}
                                />
                            ))}
                        </fieldset>
                    </div>

                    <fieldset className="space-y-4 border-2 border-[#006064] bg-white p-5">
                        <legend className="px-2 font-display text-xl uppercase text-[#006064]">FAQ</legend>
                        <Field disabled={!writable} maxLength={120} label="Título" value={form.faq.headline} onChange={(value) => change((draft) => { draft.faq.headline = value; })} />
                        {form.faq.items.map((item, index) => (
                            <div key={index} className="grid grid-cols-1 gap-3 border border-[#006064]/40 bg-[#E0F7FA]/40 p-4 lg:grid-cols-[1fr_2fr_auto]">
                                <Field disabled={!writable} maxLength={240} label={`Pregunta ${index + 1}`} value={item.question} onChange={(value) => change((draft) => { draft.faq.items[index].question = value; })} />
                                <Field disabled={!writable} maxLength={2000} label="Respuesta" multiline value={item.answer} onChange={(value) => change((draft) => { draft.faq.items[index].answer = value; })} />
                                <button
                                    type="button"
                                    disabled={!writable || form.faq.items.length <= 1}
                                    onClick={() => change((draft) => { draft.faq.items.splice(index, 1); })}
                                    className="self-end border-2 border-red-800 px-3 py-2 text-sm font-bold text-red-900 disabled:opacity-40"
                                >
                                    Quitar
                                </button>
                            </div>
                        ))}
                        <button
                            type="button"
                            disabled={!writable || form.faq.items.length >= 12}
                            onClick={() => change((draft) => { draft.faq.items.push({ question: 'Nueva pregunta', answer: 'Nueva respuesta' }); })}
                            className="border-2 border-[#006064] px-4 py-2 font-bold text-[#006064] disabled:opacity-40"
                        >
                            Añadir pregunta
                        </button>
                    </fieldset>

                    <div className="flex flex-wrap gap-3 border-2 border-[#006064] bg-white p-5">
                        <button type="button" disabled={!writable || !dirty} onClick={() => void saveDraft()} className="border-2 border-[#006064] bg-[#006064] px-5 py-3 font-bold text-white disabled:opacity-40">
                            Guardar borrador
                        </button>
                        <a
                            href={`/${locale}/campus/admin/content/preview/${surface.draft.id}`}
                            target="_blank"
                            rel="noreferrer"
                            aria-disabled={dirty}
                            onClick={(event) => { if (dirty) event.preventDefault(); }}
                            className={`border-2 border-[#006064] px-5 py-3 font-bold text-[#006064] ${dirty ? 'cursor-not-allowed opacity-40' : ''}`}
                        >
                            Vista previa real
                        </a>
                        <button type="button" disabled={!writable || dirty} onClick={() => void publishDraft()} className="border-2 border-emerald-900 bg-emerald-700 px-5 py-3 font-bold text-white disabled:opacity-40">
                            Publicar versión
                        </button>
                        <button
                            type="button"
                            disabled={!writable}
                            onClick={() => {
                                if (globalThis.confirm('¿Descartar este borrador y perder sus cambios?')) {
                                    void discardDraft();
                                }
                            }}
                            className="ml-auto border-2 border-red-800 px-5 py-3 font-bold text-red-900 disabled:opacity-40"
                        >
                            Descartar borrador
                        </button>
                        {dirty && <p className="w-full text-sm font-bold text-amber-900">Guarda el borrador antes de previsualizar o publicar.</p>}
                    </div>
                </>
            )}

            {surface.history.length > 0 && (
                <div className="border-2 border-[#006064] bg-white p-5">
                    <h2 className="font-display text-xl uppercase text-[#006064]">Historial publicado</h2>
                    <ul className="mt-4 divide-y divide-[#006064]/20">
                        {surface.history.map((version) => (
                            <li key={version.id} className="flex flex-wrap items-center gap-3 py-3 text-[#006064]">
                                <span className="font-mono text-sm font-bold">v{version.version}</span>
                                <span className="text-sm">{new Date(version.published_at).toLocaleString()}</span>
                                {version.version === surface.document?.current_version ? (
                                    <span className="ml-auto text-xs font-bold uppercase">Actual</span>
                                ) : (
                                    <button
                                        type="button"
                                        disabled={!writable || Boolean(surface.draft)}
                                        onClick={() => {
                                            if (globalThis.confirm(`¿Republicar la versión ${version.version} como una versión nueva?`)) {
                                                void rollback(version.version);
                                            }
                                        }}
                                        className="ml-auto border border-[#006064] px-3 py-2 text-xs font-bold uppercase disabled:opacity-40"
                                    >
                                        Republicar esta versión
                                    </button>
                                )}
                            </li>
                        ))}
                    </ul>
                    {surface.draft && <p className="mt-3 text-sm text-[#006064]">Descarta o publica el borrador antes de usar rollback.</p>}
                </div>
            )}
        </section>
    );
}
