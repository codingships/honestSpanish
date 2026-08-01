import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import StudentRescheduleModal, {
    type StudentRescheduleTarget,
} from '../../src/components/calendar/StudentRescheduleModal';
import { useTranslations } from '../../src/i18n/utils';

const sessionId = '30000000-0000-4000-8000-000000000003';
const requestId = '20000000-0000-4000-8000-000000000002';
const secondRequestId = '20000000-0000-4000-8000-000000000004';
const selectedDate = '2099-08-10';
const targetAt = '2099-08-10T08:00:00.000Z';
const secondTargetAt = '2099-08-10T09:00:00.000Z';
const storageKey = `checkout-v2-reschedule:${sessionId}`;

const translations = {
    with: 'Con',
    cancel: 'Volver',
    rescheduleTitle: 'Reprogramar clase',
    rescheduleIntro: 'Elige una fecha y un horario.',
    rescheduleDateLabel: 'Nueva fecha',
    rescheduleTargetsLabel: 'Horarios disponibles',
    rescheduleChooseTarget: 'Elegir horario',
    rescheduleLoadingTargets: 'Buscando horarios validos',
    rescheduleNoTargets: 'No hay horarios validos',
    rescheduleAffectedDates: 'Clases que cambiaran',
    rescheduleProvisionalWarning: 'Se moveran cuatro clases y el ancla del cobro.',
    reschedulePendingNotice: 'Solo puedes reintentar exactamente el mismo cambio.',
    rescheduleConfirm: 'Confirmar cambio',
    rescheduleRetry: 'Reintentar el mismo cambio',
    rescheduleSubmitting: 'Procesando',
    rescheduleClose: 'Cerrar reprogramacion',
    rescheduleTargetsError: 'No se pudieron consultar los horarios.',
    rescheduleNetworkError: 'No se pudo confirmar el resultado.',
    rescheduleConflict: 'El horario ya no esta disponible.',
    rescheduleReview: 'La solicitud necesita revision.',
    rescheduleRetryable: 'Reintenta exactamente la misma solicitud.',
    rescheduleForbidden: 'No tienes permiso.',
    rescheduleNotFound: 'La clase ya no esta disponible.',
    rescheduleSessionExpired: 'Tu sesion ha caducado.',
    rescheduleInvalid: 'La solicitud no es valida.',
    rescheduleStorageError: 'No se pudo guardar la solicitud.',
};

const singleTarget = (overrides: Partial<StudentRescheduleTarget> = {}): StudentRescheduleTarget => ({
    scheduledAt: targetAt,
    operationKind: 'single_session',
    affectedScheduledAts: [targetAt],
    ...overrides,
});

const session = {
    id: sessionId,
    scheduled_at: '2099-08-08T08:00:00.000Z',
    duration_minutes: 50,
    teacher: {
        id: '10000000-0000-4000-8000-000000000001',
        full_name: 'Maria Garcia',
        email: 'maria@example.com',
    },
};

const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    session,
    lang: 'es',
    translations,
    onSuccess: vi.fn(),
};

const deferred = <T,>() => {
    let resolve!: (value: T | PromiseLike<T>) => void;
    const promise = new Promise<T>((res) => {
        resolve = res;
    });
    return { promise, resolve };
};

const renderModal = (props: Partial<typeof defaultProps> = {}) => render(
    <StudentRescheduleModal {...defaultProps} {...props} />,
);

const chooseDateAndFirstTarget = async () => {
    fireEvent.change(screen.getByLabelText(translations.rescheduleDateLabel), {
        target: { value: selectedDate },
    });
    const targetButton = await screen.findByRole('button', { name: /Elegir horario/ });
    fireEvent.click(targetButton);
    return targetButton;
};

const postCalls = (fetchMock: ReturnType<typeof vi.fn>) => fetchMock.mock.calls.filter((call) => (
    (call[1] as RequestInit | undefined)?.method === 'POST'
));
const getCalls = (fetchMock: ReturnType<typeof vi.fn>) => fetchMock.mock.calls.filter((call) => (
    (call[1] as RequestInit | undefined)?.method !== 'POST'
));

describe('StudentRescheduleModal', () => {
    beforeEach(() => {
        window.sessionStorage.clear();
        vi.clearAllMocks();
        vi.stubGlobal('fetch', vi.fn());
        vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue(requestId);
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
        window.sessionStorage.clear();
    });

    it('loads targets for the selected Madrid date and renders an accessible selection', async () => {
        const fetchMock = vi.fn().mockResolvedValue(Response.json({ targets: [singleTarget()] }));
        vi.stubGlobal('fetch', fetchMock);
        renderModal();

        expect(screen.getByRole('dialog', { name: translations.rescheduleTitle })).toHaveAttribute('aria-modal', 'true');
        expect(screen.getByRole('button', { name: translations.rescheduleClose })).toHaveAttribute('type', 'button');
        expect(screen.getByText(/Maria Garcia/)).toBeInTheDocument();

        await chooseDateAndFirstTarget();

        const requestUrl = new URL(String(fetchMock.mock.calls[0][0]), window.location.origin);
        expect(requestUrl.pathname).toBe('/api/calendar/reschedule-v2');
        expect(requestUrl.searchParams.get('sessionId')).toBe(sessionId);
        expect(requestUrl.searchParams.get('from')).toBe('2099-08-09T22:00:00.000Z');
        expect(requestUrl.searchParams.get('to')).toBe('2099-08-10T22:00:00.000Z');
        expect(screen.getByText(translations.rescheduleAffectedDates)).toBeInTheDocument();
        expect(screen.queryByText(translations.rescheduleProvisionalWarning)).toBeNull();
    });

    it('shows every affected date and the billing-anchor warning for a provisional first class', async () => {
        const affectedScheduledAts = [
            '2099-08-10T08:00:00.000Z',
            '2099-08-17T08:00:00.000Z',
            '2099-08-24T08:00:00.000Z',
            '2099-08-31T08:00:00.000Z',
        ];
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({
            targets: [singleTarget({ operationKind: 'provisional_anchor', affectedScheduledAts })],
        })));
        renderModal();

        await chooseDateAndFirstTarget();

        const summary = screen.getByText(translations.rescheduleAffectedDates).parentElement;
        expect(summary).not.toBeNull();
        expect(within(summary as HTMLElement).getAllByRole('time')).toHaveLength(4);
        expect(screen.getByText(translations.rescheduleProvisionalWarning)).toBeInTheDocument();
    });

    it('persists the literal payload before POST, blocks duplicate actions, then clears and succeeds', async () => {
        const pendingPost = deferred<Response>();
        const fetchMock = vi.fn((_: RequestInfo | URL, init?: RequestInit) => {
            if (init?.method === 'POST') return pendingPost.promise;
            return Promise.resolve(Response.json({ targets: [singleTarget()] }));
        });
        vi.stubGlobal('fetch', fetchMock);
        const onSuccess = vi.fn();
        renderModal({ onSuccess });
        await chooseDateAndFirstTarget();

        const confirmButton = screen.getByRole('button', { name: translations.rescheduleConfirm });
        fireEvent.click(confirmButton);
        fireEvent.click(confirmButton);

        await waitFor(() => expect(postCalls(fetchMock)).toHaveLength(1));
        const persisted = JSON.parse(String(window.sessionStorage.getItem(storageKey)));
        expect(persisted.payload).toEqual({
            requestId,
            sessionId,
            newScheduledAt: targetAt,
        });
        expect(JSON.parse(String(postCalls(fetchMock)[0][1]?.body))).toEqual(persisted.payload);
        expect(screen.getByRole('dialog')).toHaveAttribute('aria-busy', 'true');
        expect(screen.getByRole('button', { name: translations.rescheduleClose })).toBeDisabled();
        expect(screen.getByRole('button', { name: translations.cancel })).toBeDisabled();

        pendingPost.resolve(Response.json({ success: true, replayed: false }));

        await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
        expect(window.sessionStorage.getItem(storageKey)).toBeNull();
    });

    it('restores an uncertain request after close/reload and retries the exact same payload', async () => {
        let postAttempt = 0;
        const fetchMock = vi.fn((_: RequestInfo | URL, init?: RequestInit) => {
            if (init?.method === 'POST') {
                postAttempt += 1;
                if (postAttempt === 1) return Promise.reject(new Error('network lost'));
                return Promise.resolve(Response.json({ success: true }));
            }
            return Promise.resolve(Response.json({ targets: [singleTarget()] }));
        });
        vi.stubGlobal('fetch', fetchMock);
        const firstRender = renderModal();
        await chooseDateAndFirstTarget();
        fireEvent.click(screen.getByRole('button', { name: translations.rescheduleConfirm }));

        expect(await screen.findByRole('alert')).toHaveTextContent(translations.rescheduleNetworkError);
        const firstPayload = JSON.parse(String(postCalls(fetchMock)[0][1]?.body));
        expect(window.sessionStorage.getItem(storageKey)).not.toBeNull();
        firstRender.unmount();

        vi.mocked(globalThis.crypto.randomUUID).mockReturnValue(secondRequestId);
        const onSuccess = vi.fn();
        renderModal({ onSuccess });

        expect(await screen.findByRole('button', { name: translations.rescheduleRetry })).toBeEnabled();
        expect(screen.getByLabelText(translations.rescheduleDateLabel)).toBeDisabled();
        expect(getCalls(fetchMock)).toHaveLength(1);
        fireEvent.click(screen.getByRole('button', { name: translations.rescheduleRetry }));

        await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
        expect(postCalls(fetchMock)).toHaveLength(2);
        expect(JSON.parse(String(postCalls(fetchMock)[1][1]?.body))).toEqual(firstPayload);
        expect(firstPayload.requestId).toBe(requestId);
    });

    it.each([
        { status: 503, errorCode: 'RESCHEDULE_RETRYABLE', message: translations.rescheduleRetryable },
        { status: 409, errorCode: 'RESCHEDULE_REQUIRES_REVIEW', message: translations.rescheduleReview },
    ])('preserves and exactly retries $errorCode', async ({ status, errorCode, message }) => {
        let postAttempt = 0;
        const fetchMock = vi.fn((_: RequestInfo | URL, init?: RequestInit) => {
            if (init?.method === 'POST') {
                postAttempt += 1;
                return Promise.resolve(postAttempt === 1
                    ? Response.json({ errorCode }, { status })
                    : Response.json({ success: true }));
            }
            return Promise.resolve(Response.json({ targets: [singleTarget()] }));
        });
        vi.stubGlobal('fetch', fetchMock);
        const onSuccess = vi.fn();
        renderModal({ onSuccess });
        await chooseDateAndFirstTarget();
        fireEvent.click(screen.getByRole('button', { name: translations.rescheduleConfirm }));

        expect(await screen.findByRole('alert')).toHaveTextContent(message);
        const firstBody = String(postCalls(fetchMock)[0][1]?.body);
        fireEvent.click(screen.getByRole('button', { name: translations.rescheduleRetry }));

        await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
        expect(String(postCalls(fetchMock)[1][1]?.body)).toBe(firstBody);
        expect(JSON.parse(firstBody).requestId).toBe(requestId);
    });

    it('clears a conflict, refreshes targets and creates a new request ID only for the new time', async () => {
        let getAttempt = 0;
        let postAttempt = 0;
        const fetchMock = vi.fn((_: RequestInfo | URL, init?: RequestInit) => {
            if (init?.method === 'POST') {
                postAttempt += 1;
                return Promise.resolve(postAttempt === 1
                    ? Response.json({ errorCode: 'RESCHEDULE_CONFLICT' }, { status: 409 })
                    : Response.json({ success: true }));
            }
            getAttempt += 1;
            return Promise.resolve(Response.json({
                targets: [singleTarget({ scheduledAt: getAttempt === 1 ? targetAt : secondTargetAt, affectedScheduledAts: [getAttempt === 1 ? targetAt : secondTargetAt] })],
            }));
        });
        vi.stubGlobal('fetch', fetchMock);
        vi.mocked(globalThis.crypto.randomUUID)
            .mockReturnValueOnce(requestId)
            .mockReturnValueOnce(secondRequestId);
        const onSuccess = vi.fn();
        renderModal({ onSuccess });
        await chooseDateAndFirstTarget();
        fireEvent.click(screen.getByRole('button', { name: translations.rescheduleConfirm }));

        expect(await screen.findByRole('alert')).toHaveTextContent(translations.rescheduleConflict);
        expect(window.sessionStorage.getItem(storageKey)).toBeNull();
        const refreshedTarget = await screen.findByRole('button', { name: /11:00/ });
        fireEvent.click(refreshedTarget);
        fireEvent.click(screen.getByRole('button', { name: translations.rescheduleConfirm }));

        await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
        const bodies = postCalls(fetchMock).map((call) => JSON.parse(String(call[1]?.body)));
        expect(bodies).toEqual([
            { requestId, sessionId, newScheduledAt: targetAt },
            { requestId: secondRequestId, sessionId, newScheduledAt: secondTargetAt },
        ]);
    });

    it.each([
        { status: 403, errorCode: 'RESCHEDULE_FORBIDDEN', message: translations.rescheduleForbidden },
        { status: 404, errorCode: 'RESCHEDULE_NOT_FOUND', message: translations.rescheduleNotFound },
    ])('clears and closes $errorCode as a terminal outcome', async ({ status, errorCode, message }) => {
        const fetchMock = vi.fn((_: RequestInfo | URL, init?: RequestInit) => Promise.resolve(
            init?.method === 'POST'
                ? Response.json({ errorCode }, { status })
                : Response.json({ targets: [singleTarget()] }),
        ));
        vi.stubGlobal('fetch', fetchMock);
        renderModal();
        await chooseDateAndFirstTarget();
        fireEvent.click(screen.getByRole('button', { name: translations.rescheduleConfirm }));

        expect(await screen.findByRole('alert')).toHaveTextContent(message);
        expect(window.sessionStorage.getItem(storageKey)).toBeNull();
        expect(screen.getByRole('button', { name: translations.rescheduleConfirm })).toBeDisabled();
    });

    it('keeps the exact request when authentication expires', async () => {
        const fetchMock = vi.fn((_: RequestInfo | URL, init?: RequestInit) => Promise.resolve(
            init?.method === 'POST'
                ? Response.json({ error: 'Unauthorized' }, { status: 401 })
                : Response.json({ targets: [singleTarget()] }),
        ));
        vi.stubGlobal('fetch', fetchMock);
        renderModal();
        await chooseDateAndFirstTarget();
        fireEvent.click(screen.getByRole('button', { name: translations.rescheduleConfirm }));

        expect(await screen.findByRole('alert')).toHaveTextContent(translations.rescheduleSessionExpired);
        expect(window.sessionStorage.getItem(storageKey)).not.toBeNull();
        expect(screen.getByRole('button', { name: translations.rescheduleRetry })).toBeEnabled();
    });

    it.each(['es', 'en', 'ru'] as const)('provides complete visible reschedule copy in %s', (lang) => {
        const t = useTranslations(lang);
        const keys = [
            'rescheduleClass',
            'rescheduleTitle',
            'rescheduleDateLabel',
            'rescheduleAffectedDates',
            'rescheduleProvisionalWarning',
            'reschedulePendingNotice',
            'rescheduleConflict',
            'rescheduleReview',
            'rescheduleRetryable',
            'rescheduleSessionExpired',
            'rescheduleStorageError',
        ];

        for (const key of keys) {
            const path = `campus.student.classes.${key}`;
            expect(t(path)).not.toBe(path);
            expect(t(path).trim()).not.toBe('');
        }
    });

    it.each([
        { lang: 'es' as const, expected: /cuando se imparta la primera clase/i },
        { lang: 'en' as const, expected: /when the first class is taught/i },
        { lang: 'ru' as const, expected: /после проведения первого занятия/i },
    ])('explains in $lang that the renewal anchor fixes only after the first class', ({ lang, expected }) => {
        const t = useTranslations(lang);
        expect(t('campus.student.classes.rescheduleProvisionalWarning')).toMatch(expected);
        expect(t('campus.student.classes.rescheduleProvisionalWarning')).toContain('28');
    });
});
