import { useState } from 'react';
import type { CrmConsentRecord } from '../../lib/crm/contact-detail';

type Channel = 'email' | 'phone' | 'whatsapp';
type Purpose = 'transactional' | 'support' | 'marketing' | 'sales_follow_up';
type LegalBasis = 'consent' | 'contract' | 'prior_customer_similar_services' | 'legitimate_interest' | 'manual_review_required';

interface CrmConsentManagerProps {
    contactId: string;
    consents: CrmConsentRecord[];
}

const channelLabels: Record<Channel, string> = {
    email: 'Email',
    phone: 'Telefono',
    whatsapp: 'WhatsApp',
};

const purposeLabels: Record<Purpose, string> = {
    transactional: 'Transaccional',
    support: 'Soporte',
    marketing: 'Marketing',
    sales_follow_up: 'Seguimiento comercial',
};

const legalBasisLabels: Record<LegalBasis, string> = {
    consent: 'Consentimiento',
    contract: 'Contrato',
    prior_customer_similar_services: 'Cliente previo similar',
    legitimate_interest: 'Interes legitimo',
    manual_review_required: 'Revision manual',
};

function formatDateTime(date: string | null) {
    if (!date) return 'Sin fecha';
    return new Date(date).toLocaleString('es-ES', {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
    });
}

export default function CrmConsentManager({ contactId, consents }: CrmConsentManagerProps) {
    const [channel, setChannel] = useState<Channel>('email');
    const [purpose, setPurpose] = useState<Purpose>('sales_follow_up');
    const [legalBasis, setLegalBasis] = useState<LegalBasis>('manual_review_required');
    const [source, setSource] = useState('admin_review');
    const [proof, setProof] = useState('');
    const [noticeVersion, setNoticeVersion] = useState('privacy-v1');
    const [capturedAt, setCapturedAt] = useState('');
    const [saving, setSaving] = useState<string | null>(null);
    const [message, setMessage] = useState<string | null>(null);

    const postAction = async (payload: Record<string, unknown>) => {
        const response = await fetch('/api/admin/crm/contact-actions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });

        if (!response.ok) {
            const body = await response.json().catch(() => null);
            throw new Error(body?.error || 'CRM consent action failed');
        }
    };

    const reloadSoon = () => {
        window.setTimeout(() => window.location.reload(), 350);
    };

    const saveConsent = async () => {
        setSaving('upsert');
        setMessage(null);

        try {
            await postAction({
                action: 'upsert_consent',
                contactId,
                channel,
                purpose,
                legalBasis,
                source: source.trim() || null,
                proof: proof.trim() || null,
                noticeVersion: noticeVersion.trim() || null,
                capturedAt: capturedAt ? new Date(capturedAt).toISOString() : null,
            });
            setMessage('Base legal guardada.');
            setProof('');
            reloadSoon();
        } catch (error) {
            setMessage(error instanceof Error ? error.message : 'No se pudo guardar la base legal.');
        } finally {
            setSaving(null);
        }
    };

    const optOut = async (consentId: string) => {
        setSaving(`optout-${consentId}`);
        setMessage(null);

        try {
            await postAction({
                action: 'opt_out_consent',
                consentId,
                reason: 'Opt-out registrado desde ficha CRM',
            });
            setMessage('Opt-out registrado.');
            reloadSoon();
        } catch (error) {
            setMessage(error instanceof Error ? error.message : 'No se pudo registrar el opt-out.');
        } finally {
            setSaving(null);
        }
    };

    return (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_1.2fr]">
            <div>
                <h3 className="font-display text-lg uppercase text-[#006064]">Consentimiento y contacto</h3>
                {consents.length > 0 ? (
                    <div className="mt-3 divide-y divide-[#006064]/10">
                        {consents.map((consent) => {
                            const isActive = !consent.opted_out_at;
                            return (
                                <div key={consent.id} className="py-3 first:pt-0">
                                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                                        <div>
                                            <p className="text-sm font-bold text-[#006064]">
                                                {channelLabels[consent.channel as Channel] || consent.channel} / {purposeLabels[consent.purpose as Purpose] || consent.purpose}
                                            </p>
                                            <p className="mt-1 text-xs text-[#006064]/70">
                                                {legalBasisLabels[consent.legal_basis as LegalBasis] || consent.legal_basis}
                                                {' - '}
                                                {consent.source || 'Sin origen'}
                                            </p>
                                        </div>
                                        <span className={`inline-flex w-fit border px-2 py-1 text-xs font-bold uppercase ${
                                            isActive
                                                ? 'border-[#006064] bg-[#E0F7FA] text-[#006064]'
                                                : 'border-[#6A131C] text-[#6A131C]'
                                        }`}>
                                            {isActive ? 'Activo' : 'Opt-out'}
                                        </span>
                                    </div>
                                    <p className="mt-2 text-xs font-mono text-[#006064]/60">
                                        {isActive ? formatDateTime(consent.captured_at) : formatDateTime(consent.opted_out_at)}
                                    </p>
                                    {consent.proof && (
                                        <p className="mt-2 text-xs text-[#006064]/70">{consent.proof}</p>
                                    )}
                                    {isActive && (
                                        <button
                                            type="button"
                                            onClick={() => optOut(consent.id)}
                                            disabled={saving !== null}
                                            className="mt-3 border border-[#6A131C] px-3 py-1 text-xs font-bold uppercase text-[#6A131C] transition-colors hover:bg-[#6A131C] hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                                        >
                                            {saving === `optout-${consent.id}` ? 'Guardando...' : 'Registrar opt-out'}
                                        </button>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                ) : (
                    <p className="mt-3 text-sm font-mono text-[#006064]/60">Sin base legal registrada.</p>
                )}
            </div>

            <div>
                <h3 className="font-display text-lg uppercase text-[#006064]">Guardar base legal</h3>
                <div className="mt-3 grid grid-cols-1 gap-3">
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                        <select
                            aria-label="Canal"
                            value={channel}
                            onChange={(event) => setChannel(event.target.value as Channel)}
                            className="border-2 border-[#006064] bg-white p-3 text-sm text-[#006064]"
                        >
                            <option value="email">Email</option>
                            <option value="phone">Telefono</option>
                            <option value="whatsapp">WhatsApp</option>
                        </select>
                        <select
                            aria-label="Finalidad"
                            value={purpose}
                            onChange={(event) => setPurpose(event.target.value as Purpose)}
                            className="border-2 border-[#006064] bg-white p-3 text-sm text-[#006064]"
                        >
                            <option value="sales_follow_up">Seguimiento comercial</option>
                            <option value="transactional">Transaccional</option>
                            <option value="support">Soporte</option>
                            <option value="marketing">Marketing</option>
                        </select>
                        <select
                            aria-label="Base legal"
                            value={legalBasis}
                            onChange={(event) => setLegalBasis(event.target.value as LegalBasis)}
                            className="border-2 border-[#006064] bg-white p-3 text-sm text-[#006064]"
                        >
                            <option value="manual_review_required">Revision manual</option>
                            <option value="consent">Consentimiento</option>
                            <option value="contract">Contrato</option>
                            <option value="prior_customer_similar_services">Cliente previo similar</option>
                            <option value="legitimate_interest">Interes legitimo</option>
                        </select>
                    </div>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                        <input
                            aria-label="Origen"
                            value={source}
                            onChange={(event) => setSource(event.target.value)}
                            placeholder="admin_review"
                            className="border-2 border-[#006064] p-3 text-sm text-[#006064] placeholder-[#006064]/40 focus:outline-none focus:ring-2 focus:ring-[#006064]/20"
                        />
                        <input
                            aria-label="Aviso"
                            value={noticeVersion}
                            onChange={(event) => setNoticeVersion(event.target.value)}
                            placeholder="privacy-v1"
                            className="border-2 border-[#006064] p-3 text-sm text-[#006064] placeholder-[#006064]/40 focus:outline-none focus:ring-2 focus:ring-[#006064]/20"
                        />
                        <input
                            aria-label="Fecha"
                            type="datetime-local"
                            value={capturedAt}
                            onChange={(event) => setCapturedAt(event.target.value)}
                            className="border-2 border-[#006064] p-3 text-sm text-[#006064]"
                        />
                    </div>
                    <textarea
                        aria-label="Prueba"
                        value={proof}
                        onChange={(event) => setProof(event.target.value)}
                        placeholder="Ej. Acepto politica de privacidad en formulario de lead."
                        className="h-24 w-full resize-none border-2 border-[#006064] p-3 text-sm text-[#006064] placeholder-[#006064]/40 focus:outline-none focus:ring-2 focus:ring-[#006064]/20"
                    />
                </div>
                <button
                    type="button"
                    onClick={saveConsent}
                    disabled={saving !== null}
                    className="mt-3 border-2 border-[#006064] bg-[#006064] px-4 py-2 text-xs font-bold uppercase text-white transition-colors hover:bg-[#004d40] disabled:cursor-not-allowed disabled:opacity-50"
                >
                    {saving === 'upsert' ? 'Guardando...' : 'Guardar base legal'}
                </button>
                {message && <p className="mt-3 font-mono text-xs text-[#006064]">{message}</p>}
            </div>
        </div>
    );
}
