import React, { useEffect, useMemo, useState } from 'react';
import type { EmailPreviewType } from '../../lib/email/previews';

type EmailPreview = {
    type: EmailPreviewType;
    subject: string;
    html: string;
};

type EmailPreviewResponse = Partial<EmailPreview> & {
    error?: string;
    message?: string;
};

const templateOptions: Array<{ value: EmailPreviewType; label: string; description: string }> = [
    { value: 'welcome', label: 'Bienvenida alumno', description: 'Alta de plan y acceso al campus.' },
    { value: 'confirmation', label: 'Confirmacion clase', description: 'Clase programada con Meet y documento.' },
    { value: 'reminder', label: 'Recordatorio clase', description: 'Aviso previo a la clase.' },
    { value: 'cancelled', label: 'Cancelacion clase', description: 'Clase cancelada con motivo.' },
    { value: 'lead', label: 'Lead publico', description: 'Respuesta al formulario de contacto.' },
    { value: 'level-check', label: 'Diagnostico ligero', description: 'Invitacion manual a preguntas de nivel.' },
    { value: 'missing-info', label: 'Falta informacion', description: 'Pide contexto antes de recomendar plan.' },
    { value: 'proposal-next-step', label: 'Propuesta / siguiente paso', description: 'Confirma encaje antes de pago.' },
    { value: 'support-received', label: 'Soporte recibido', description: 'Acuse al usuario tras crear ticket.' },
    { value: 'support-updated', label: 'Soporte actualizado', description: 'Aviso al usuario tras respuesta o cambio de estado.' },
];

interface Props {
    adminEmail: string;
}

export default function EmailTemplateManager({ adminEmail }: Props) {
    const [selectedType, setSelectedType] = useState<EmailPreviewType>('welcome');
    const [recipientEmail, setRecipientEmail] = useState(adminEmail);
    const [preview, setPreview] = useState<EmailPreview | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [isSending, setIsSending] = useState(false);
    const [message, setMessage] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const selectedTemplate = useMemo(
        () => templateOptions.find((item) => item.value === selectedType) ?? templateOptions[0],
        [selectedType],
    );

    useEffect(() => {
        const controller = new AbortController();
        let isActive = true;

        async function loadPreview() {
            setIsLoading(true);
            setError(null);
            setMessage(null);

            try {
                const response = await fetch(`/api/email/send-test?type=${selectedType}`, {
                    signal: controller.signal,
                });
                const data = await response.json() as EmailPreviewResponse;
                if (!isActive) return;
                if (!response.ok) throw new Error(data.error || 'No se pudo cargar la plantilla');
                setPreview(data.type && data.subject && data.html ? data as EmailPreview : null);
            } catch (err) {
                if (isActive && (err as Error).name !== 'AbortError') {
                    setError(err instanceof Error ? err.message : 'No se pudo cargar la plantilla');
                    setPreview(null);
                }
            } finally {
                if (isActive) setIsLoading(false);
            }
        }

        void loadPreview();
        return () => {
            isActive = false;
            controller.abort();
        };
    }, [selectedType]);

    const sendTestEmail = async () => {
        const email = recipientEmail.trim();
        if (!email) return;

        setIsSending(true);
        setError(null);
        setMessage(null);

        try {
            const response = await fetch('/api/email/send-test', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ type: selectedType, email }),
            });
            const data = await response.json() as EmailPreviewResponse;
            if (!response.ok) throw new Error(data.error || 'No se pudo enviar el email');
            setMessage(data.message || 'Email enviado');
        } catch (err) {
            setError(err instanceof Error ? err.message : 'No se pudo enviar el email');
        } finally {
            setIsSending(false);
        }
    };

    return (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
            <section className="space-y-4 border-2 border-[#006064] bg-white p-5 shadow-[4px_4px_0px_0px_#006064]">
                <div>
                    <h2 className="font-display text-2xl uppercase text-[#006064]">Plantillas</h2>
                    <p className="mt-1 font-mono text-xs text-[#006064]/70">
                        Previsualiza el HTML y envia pruebas reales via Resend.
                    </p>
                </div>

                <label className="block">
                    <span className="mb-2 block font-mono text-xs font-bold uppercase text-[#006064]">Tipo</span>
                    <select
                        value={selectedType}
                        onChange={(event) => setSelectedType(event.target.value as EmailPreviewType)}
                        className="w-full border-2 border-[#006064] bg-white p-3 font-bold text-[#006064]"
                    >
                        {templateOptions.map((option) => (
                            <option key={option.value} value={option.value}>
                                {option.label}
                            </option>
                        ))}
                    </select>
                </label>

                <div className="border border-[#006064]/20 bg-[#E0F7FA] p-3 text-sm text-[#006064]">
                    <p className="font-bold">{selectedTemplate.label}</p>
                    <p className="mt-1 opacity-80">{selectedTemplate.description}</p>
                </div>

                <label className="block">
                    <span className="mb-2 block font-mono text-xs font-bold uppercase text-[#006064]">
                        Destinatario prueba
                    </span>
                    <input
                        type="email"
                        value={recipientEmail}
                        onChange={(event) => setRecipientEmail(event.target.value)}
                        className="w-full border-2 border-[#006064] p-3 text-[#006064]"
                    />
                </label>

                <div className="border-2 border-yellow-500 bg-yellow-50 p-3 font-mono text-xs text-yellow-900">
                    Esto envia un email real si Resend esta configurado en el entorno actual.
                </div>

                {(message || error) && (
                    <div role={error ? 'alert' : 'status'} className={`border-2 p-3 font-mono text-xs ${error ? 'border-red-500 bg-red-50 text-red-700' : 'border-green-600 bg-green-50 text-green-700'}`}>
                        {error || message}
                    </div>
                )}

                <button
                    type="button"
                    onClick={() => void sendTestEmail()}
                    disabled={isSending || isLoading || !recipientEmail.trim()}
                    className="w-full border-2 border-[#006064] bg-[#006064] px-4 py-3 text-sm font-bold uppercase text-white hover:bg-[#004d40] disabled:cursor-not-allowed disabled:opacity-50"
                >
                    {isSending ? 'Enviando...' : 'Enviar prueba'}
                </button>
            </section>

            <section className="min-w-0 border-2 border-[#006064] bg-white p-5 shadow-[4px_4px_0px_0px_#006064]">
                <div className="mb-4 flex flex-col gap-2 border-b-2 border-[#006064] pb-4 md:flex-row md:items-end md:justify-between">
                    <div>
                        <h2 className="font-display text-2xl uppercase text-[#006064]">Preview</h2>
                        <p className="mt-1 font-mono text-xs text-[#006064]/70">
                            {preview?.subject || 'Cargando asunto...'}
                        </p>
                    </div>
                    <span className="inline-block border border-[#006064] px-2 py-1 font-mono text-xs uppercase text-[#006064]">
                        {selectedType}
                    </span>
                </div>

                {isLoading ? (
                    <div className="flex h-[640px] items-center justify-center bg-[#E0F7FA] font-mono text-[#006064]">
                        Cargando...
                    </div>
                ) : preview ? (
                    <iframe
                        title="Email preview"
                        sandbox=""
                        srcDoc={preview.html}
                        className="h-[640px] w-full border border-[#006064]/30 bg-white"
                    />
                ) : (
                    <div className="flex h-[640px] items-center justify-center bg-red-50 font-mono text-red-700">
                        No hay preview disponible
                    </div>
                )}
            </section>
        </div>
    );
}
