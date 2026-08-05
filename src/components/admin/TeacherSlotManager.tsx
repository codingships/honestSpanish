import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import AvailabilityManager, { type AvailabilitySlot } from '../calendar/AvailabilityManager';

type Lang = 'es' | 'en' | 'ru';
type EngagementKind = 'founder' | 'external';
type SlotStatus = 'draft' | 'available' | 'paused' | 'sold' | 'retired';
type SlotTransition = 'publish' | 'resume' | 'pause' | 'retire';

type Availability = {
    id: string;
    dayOfWeek: number;
    startTime: string;
    endTime: string;
};

type Teacher = {
    id: string;
    fullName: string | null;
    email: string;
    currentEngagement: { engagementKind?: EngagementKind | null; effectiveFrom?: string } | EngagementKind | null;
    availability: Availability[];
};

type Occurrence = {
    index?: number;
    occurrenceIndex?: number;
    occurrence_index?: number;
    startsAt?: string;
    starts_at?: string;
};

type BookableSlot = {
    id: string;
    publicId: string;
    teacherId: string;
    status: SlotStatus;
    weekday: number;
    localStartTime: string;
    firstOccurrenceAt: string;
    occurrences: Occurrence[];
    hasLiveHold: boolean;
};

type TeachersSlotsResponse = {
    error?: string | { code?: string; message?: string };
    package?: unknown;
    teachers?: Teacher[];
    slots?: BookableSlot[];
};

type StaffInvitationResponse = {
    auditDegraded?: boolean;
    error?: string;
    state?: 'existing_pending' | 'existing_verified' | 'sent';
};

const COPY = {
    es: {
        intro: 'Declara cuándo puede trabajar cada profesor y publica por separado las plazas concretas que un alumno puede comprar.',
        inviteTitle: 'Invitar nuevo profesor',
        inviteIntro: 'Envía el acceso desde el panel. La invitación no concede el rol de profesor: después de verificar el email y completar el perfil, actívalo expresamente abajo.',
        fullName: 'Nombre completo', invite: 'Enviar invitación', inviting: 'Enviando…',
        invited: 'Invitación enviada. Activa la cuenta cuando la persona haya confirmado el email y completado su perfil.',
        existingPending: 'La cuenta ya existe y está pendiente de confirmar el email. No se ha enviado otra invitación.',
        existingVerified: 'La cuenta ya está verificada. Puedes activarla abajo.',
        activateTitle: 'Activar profesor existente',
        activateIntro: 'Esta acción no crea una cuenta. Activa como profesor una cuenta existente identificada exactamente por su email.',
        email: 'Email de la cuenta',
        engagement: 'Vínculo',
        founder: 'Fundador',
        external: 'Externo',
        effectiveFrom: 'Efectivo desde',
        reason: 'Motivo documentado',
        confirmExisting: 'Confirmo que esta cuenta ya existe y que he verificado el email.',
        activate: 'Activar profesor',
        configureEngagement: 'Configurar nuevo vínculo',
        configureEngagementIntro: 'Programa el siguiente vínculo económico de este profesor. La fecha debe ser posterior a cualquier vínculo ya configurado.',
        engagementConfigured: 'Nuevo vínculo configurado correctamente.',
        latestEngagement: 'Último vínculo configurado',
        teachers: 'Profesores',
        noTeachers: 'Todavía no hay profesores activos. Puedes activar una cuenta existente arriba.',
        selectTeacher: 'Seleccionar profesor',
        availabilityTitle: 'Disponibilidad semanal',
        availabilityIntro: 'Indica cuándo puede trabajar. Esto no publica ninguna plaza de venta.',
        slotsTitle: 'Plazas vendibles',
        slotsIntro: 'Cada plaza corresponde a cuatro clases concretas. Primero se crea como borrador y después se publica de forma explícita.',
        createTitle: 'Crear plaza en borrador',
        firstClassDate: 'Fecha de la primera clase',
        localStartTime: 'Hora semanal',
        timezone: 'Zona horaria fija: Europe/Madrid',
        preview: 'Vista previa de las cuatro clases',
        createDraft: 'Crear borrador',
        noSlots: 'Este profesor todavía no tiene plazas.',
        status: 'Estado',
        schedule: 'Horario',
        firstClass: 'Primera clase',
        actions: 'Acciones',
        publicId: 'Referencia pública',
        liveHold: 'Reservada temporalmente',
        draft: 'Borrador',
        available: 'Disponible',
        paused: 'Pausada',
        sold: 'Vendida',
        retired: 'Retirada',
        publish: 'Publicar',
        resume: 'Reanudar',
        pause: 'Pausar',
        retire: 'Retirar',
        confirmAction: 'Confirmar acción',
        confirmPublish: 'Al publicar, esta plaza será comprable y sus cuatro fechas quedarán fijadas.',
        confirmTransition: 'Confirma el cambio de estado de esta plaza.',
        confirm: 'Confirmar',
        cancel: 'Cancelar',
        loadError: 'No se pudieron cargar los profesores y las plazas.',
        retry: 'Reintentar',
        loading: 'Cargando profesores y plazas…',
        saving: 'Guardando…',
        activated: 'Profesor activado correctamente.',
        draftCreated: 'Plaza creada como borrador. Revísala antes de publicarla.',
        transitionDone: 'Estado de la plaza actualizado.',
        genericError: 'No se pudo completar la operación.',
        reasonPlaceholder: 'Explica brevemente por qué se realiza esta acción',
        requiredReason: 'El motivo debe tener al menos 5 caracteres.',
        packageLabel: 'Oferta asociada',
        placesAvailable: 'disponibles',
        placesDraft: 'en borrador',
        noAvailability: 'Sin disponibilidad semanal',
        availabilityConfigured: 'Disponibilidad configurada',
        holdBlocked: 'No puede pausarse ni retirarse mientras exista una reserva temporal.',
        days: ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'],
        addSlot: 'Añadir horario', removeSlot: 'Eliminar', from: 'Desde', to: 'Hasta', save: 'Guardar',
        cancelAvailability: 'Cancelar', noAvailabilitySlots: 'Sin horarios', day: 'Día',
        slotAdded: 'Horario añadido correctamente.', slotRemoved: 'Horario eliminado.',
        errorAdding: 'No se pudo añadir el horario.', errorRemoving: 'No se pudo eliminar el horario.',
        invalidTimeRange: 'La hora final debe ser posterior a la inicial.',
        timezoneNotice: 'La disponibilidad se introduce y se muestra en Europe/Madrid.',
    },
    en: {
        intro: 'Define when each teacher can work and separately publish the specific places a student can buy.',
        inviteTitle: 'Invite a new teacher',
        inviteIntro: 'Send access from the panel. An invitation does not grant the teacher role: after the email is verified and the profile is complete, activate it explicitly below.',
        fullName: 'Full name', invite: 'Send invitation', inviting: 'Sending…',
        invited: 'Invitation sent. Activate the account after the person verifies the email and completes the profile.',
        existingPending: 'The account already exists and is waiting for email verification. No duplicate invitation was sent.',
        existingVerified: 'The account is already verified. You can activate it below.',
        activateTitle: 'Activate an existing teacher',
        activateIntro: 'This action does not create an account. It activates an existing account as a teacher using its exact email.',
        email: 'Account email', engagement: 'Engagement', founder: 'Founder', external: 'External',
        effectiveFrom: 'Effective from', reason: 'Documented reason',
        confirmExisting: 'I confirm this account already exists and I verified the email.', activate: 'Activate teacher',
        configureEngagement: 'Configure new engagement',
        configureEngagementIntro: 'Schedule this teacher’s next compensation engagement. Its date must be later than any engagement already configured.',
        engagementConfigured: 'New engagement configured.',
        latestEngagement: 'Latest configured engagement',
        teachers: 'Teachers', noTeachers: 'There are no active teachers yet. You can activate an existing account above.',
        selectTeacher: 'Select teacher', availabilityTitle: 'Weekly availability',
        availabilityIntro: 'Define when this teacher can work. This does not publish a place for sale.',
        slotsTitle: 'Bookable places',
        slotsIntro: 'Each place represents four specific classes. It is created as a draft first and published separately.',
        createTitle: 'Create draft place', firstClassDate: 'First class date', localStartTime: 'Weekly time',
        timezone: 'Fixed time zone: Europe/Madrid', preview: 'Preview of the four classes', createDraft: 'Create draft',
        noSlots: 'This teacher does not have any places yet.', status: 'Status', schedule: 'Schedule',
        firstClass: 'First class', actions: 'Actions', publicId: 'Public reference', liveHold: 'Temporarily reserved',
        draft: 'Draft', available: 'Available', paused: 'Paused', sold: 'Sold', retired: 'Retired',
        publish: 'Publish', resume: 'Resume', pause: 'Pause', retire: 'Retire',
        confirmAction: 'Confirm action', confirmPublish: 'Publishing makes this place purchasable and fixes its four class dates.',
        confirmTransition: 'Confirm this place status change.', confirm: 'Confirm', cancel: 'Cancel',
        loadError: 'Teachers and places could not be loaded.', retry: 'Retry', loading: 'Loading teachers and places…',
        saving: 'Saving…', activated: 'Teacher activated.',
        draftCreated: 'Place created as a draft. Review it before publishing.', transitionDone: 'Place status updated.',
        genericError: 'The operation could not be completed.', reasonPlaceholder: 'Briefly explain why this action is being performed',
        requiredReason: 'The reason must contain at least 5 characters.', packageLabel: 'Associated offer',
        placesAvailable: 'available', placesDraft: 'draft', noAvailability: 'No weekly availability',
        availabilityConfigured: 'Availability configured', holdBlocked: 'It cannot be paused or retired while a temporary reservation exists.',
        days: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
        addSlot: 'Add availability', removeSlot: 'Remove', from: 'From', to: 'To', save: 'Save',
        cancelAvailability: 'Cancel', noAvailabilitySlots: 'No availability', day: 'Day',
        slotAdded: 'Availability added.', slotRemoved: 'Availability removed.',
        errorAdding: 'Availability could not be added.', errorRemoving: 'Availability could not be removed.',
        invalidTimeRange: 'The end time must be later than the start time.',
        timezoneNotice: 'Availability is entered and shown in Europe/Madrid.',
    },
    ru: {
        intro: 'Укажите, когда каждый преподаватель может работать, и отдельно публикуйте конкретные места, доступные для покупки.',
        inviteTitle: 'Пригласить нового преподавателя',
        inviteIntro: 'Отправьте доступ из панели. Приглашение не выдаёт роль преподавателя: после подтверждения email и заполнения профиля активируйте аккаунт ниже.',
        fullName: 'Полное имя', invite: 'Отправить приглашение', inviting: 'Отправляем…',
        invited: 'Приглашение отправлено. Активируйте аккаунт после подтверждения email и заполнения профиля.',
        existingPending: 'Аккаунт уже существует и ожидает подтверждения email. Повторное приглашение не отправлялось.',
        existingVerified: 'Аккаунт уже подтверждён. Его можно активировать ниже.',
        activateTitle: 'Активировать существующего преподавателя',
        activateIntro: 'Это действие не создаёт аккаунт. Оно активирует существующий аккаунт преподавателя по точному email.',
        email: 'Email аккаунта', engagement: 'Тип сотрудничества', founder: 'Основатель', external: 'Внешний преподаватель',
        effectiveFrom: 'Действует с', reason: 'Документированная причина',
        confirmExisting: 'Подтверждаю, что аккаунт уже существует и email проверен.', activate: 'Активировать преподавателя',
        configureEngagement: 'Настроить новое сотрудничество',
        configureEngagementIntro: 'Запланируйте следующий тип оплаты преподавателя. Дата должна быть позже любого уже настроенного сотрудничества.',
        engagementConfigured: 'Новое сотрудничество настроено.',
        latestEngagement: 'Последнее настроенное сотрудничество',
        teachers: 'Преподаватели', noTeachers: 'Активных преподавателей пока нет. Вы можете активировать существующий аккаунт выше.',
        selectTeacher: 'Выбрать преподавателя', availabilityTitle: 'Еженедельная доступность',
        availabilityIntro: 'Укажите, когда преподаватель может работать. Это не публикует место для продажи.',
        slotsTitle: 'Места для продажи',
        slotsIntro: 'Каждое место соответствует четырём конкретным занятиям. Сначала создаётся черновик, затем место публикуется отдельно.',
        createTitle: 'Создать черновик места', firstClassDate: 'Дата первого занятия', localStartTime: 'Еженедельное время',
        timezone: 'Фиксированный часовой пояс: Europe/Madrid', preview: 'Предпросмотр четырёх занятий', createDraft: 'Создать черновик',
        noSlots: 'У этого преподавателя пока нет мест.', status: 'Статус', schedule: 'Расписание',
        firstClass: 'Первое занятие', actions: 'Действия', publicId: 'Публичная ссылка', liveHold: 'Временно зарезервировано',
        draft: 'Черновик', available: 'Доступно', paused: 'Приостановлено', sold: 'Продано', retired: 'Снято',
        publish: 'Опубликовать', resume: 'Возобновить', pause: 'Приостановить', retire: 'Снять',
        confirmAction: 'Подтвердить действие', confirmPublish: 'После публикации место можно будет купить, а четыре даты занятий будут зафиксированы.',
        confirmTransition: 'Подтвердите изменение статуса места.', confirm: 'Подтвердить', cancel: 'Отмена',
        loadError: 'Не удалось загрузить преподавателей и места.', retry: 'Повторить', loading: 'Загружаем преподавателей и места…',
        saving: 'Сохраняем…', activated: 'Преподаватель активирован.',
        draftCreated: 'Место создано как черновик. Проверьте его перед публикацией.', transitionDone: 'Статус места обновлён.',
        genericError: 'Не удалось выполнить операцию.', reasonPlaceholder: 'Кратко объясните причину действия',
        requiredReason: 'Причина должна содержать не менее 5 символов.', packageLabel: 'Связанное предложение',
        placesAvailable: 'доступно', placesDraft: 'черновиков', noAvailability: 'Нет еженедельной доступности',
        availabilityConfigured: 'Доступность настроена', holdBlocked: 'Нельзя приостановить или снять место, пока действует временная резервация.',
        days: ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'],
        addSlot: 'Добавить время', removeSlot: 'Удалить', from: 'С', to: 'До', save: 'Сохранить',
        cancelAvailability: 'Отмена', noAvailabilitySlots: 'Нет времени', day: 'День',
        slotAdded: 'Время добавлено.', slotRemoved: 'Время удалено.',
        errorAdding: 'Не удалось добавить время.', errorRemoving: 'Не удалось удалить время.',
        invalidTimeRange: 'Время окончания должно быть позже времени начала.',
        timezoneNotice: 'Доступность вводится и отображается в Europe/Madrid.',
    },
} as const;

const STATUS_STYLES: Record<SlotStatus, string> = {
    draft: 'border-gray-500 bg-gray-100 text-gray-800',
    available: 'border-green-700 bg-green-50 text-green-800',
    paused: 'border-amber-700 bg-amber-50 text-amber-900',
    sold: 'border-blue-700 bg-blue-50 text-blue-800',
    retired: 'border-slate-500 bg-slate-100 text-slate-700',
};

const TRANSITIONS: Record<SlotStatus, SlotTransition[]> = {
    draft: ['publish', 'retire'],
    available: ['pause', 'retire'],
    paused: ['resume', 'retire'],
    sold: [],
    retired: [],
};

function makeRequestId(): string {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (character) => {
        const random = Math.floor(Math.random() * 16);
        const value = character === 'x' ? random : (random & 0x3) | 0x8;
        return value.toString(16);
    });
}

function teacherLabel(teacher: Teacher): string {
    return teacher.fullName?.trim() || teacher.email;
}

function engagementKind(teacher: Teacher): EngagementKind | null {
    if (typeof teacher.currentEngagement === 'string') return teacher.currentEngagement;
    return teacher.currentEngagement?.engagementKind ?? null;
}

function engagementEffectiveFrom(teacher: Teacher): string | null {
    return typeof teacher.currentEngagement === 'object'
        ? teacher.currentEngagement?.effectiveFrom ?? null
        : null;
}

function addDays(dateKey: string, days: number): string {
    const [year, month, day] = dateKey.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day + days));
    return date.toISOString().slice(0, 10);
}

function responseError(payload: TeachersSlotsResponse | null, fallback: string): string {
    if (typeof payload?.error === 'string') return payload.error;
    if (payload?.error && typeof payload.error.message === 'string') return payload.error.message;
    return fallback;
}

function packageLabel(value: unknown, lang: Lang): string {
    if (!value || typeof value !== 'object') return '—';
    const pkg = value as Record<string, unknown>;
    const display = pkg.displayName ?? pkg.display_name;
    if (typeof display === 'string') return display;
    if (display && typeof display === 'object') {
        const labels = display as Record<string, unknown>;
        const first = labels[lang] ?? labels.es ?? labels.en ?? labels.ru;
        if (typeof first === 'string') return first;
    }
    return typeof pkg.name === 'string' ? pkg.name : '—';
}

function formatInstant(value: string, lang: Lang): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat(lang, {
        timeZone: 'Europe/Madrid',
        dateStyle: 'medium',
        timeStyle: 'short',
    }).format(date);
}

function occurrenceInstant(occurrence: Occurrence): string | null {
    return occurrence.startsAt ?? occurrence.starts_at ?? null;
}

export default function TeacherSlotManager({ lang }: { lang: Lang }) {
    const t = COPY[lang];
    const [data, setData] = useState<{ package?: unknown; teachers: Teacher[]; slots: BookableSlot[] }>({ teachers: [], slots: [] });
    const [selectedTeacherId, setSelectedTeacherId] = useState('');
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [workingKey, setWorkingKey] = useState<string | null>(null);
    const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
    const [invitation, setInvitation] = useState({ fullName: '', email: '', reason: '' });
    const [activation, setActivation] = useState({
        email: '', engagementKind: 'external' as EngagementKind, effectiveFrom: '', reason: '', confirmed: false,
    });
    const [engagement, setEngagement] = useState({ engagementKind: 'external' as EngagementKind, effectiveFrom: '', reason: '' });
    const [draft, setDraft] = useState({ firstClassDate: '', localStartTime: '09:00', reason: '' });
    const [pendingTransition, setPendingTransition] = useState<{ slot: BookableSlot; transition: SlotTransition } | null>(null);
    const [transitionReason, setTransitionReason] = useState('');
    const requestIds = useRef(new Map<string, { id: string; payload: string }>());

    const load = useCallback(async (signal?: AbortSignal) => {
        setLoading(true);
        setLoadError(null);
        try {
            const response = await fetch('/api/admin/teachers-slots', { signal, headers: { Accept: 'application/json' } });
            const payload = await response.json().catch(() => null) as TeachersSlotsResponse | null;
            if (!response.ok) throw new Error(responseError(payload, t.loadError));
            const teachers = payload?.teachers ?? [];
            setData({ package: payload?.package, teachers, slots: payload?.slots ?? [] });
            setSelectedTeacherId((current) => teachers.some((teacher) => teacher.id === current) ? current : teachers[0]?.id ?? '');
        } catch (error) {
            if (error instanceof DOMException && error.name === 'AbortError') return;
            setLoadError(error instanceof Error ? error.message : t.loadError);
        } finally {
            if (!signal?.aborted) setLoading(false);
        }
    }, [t.loadError]);

    useEffect(() => {
        const controller = new AbortController();
        void load(controller.signal);
        return () => controller.abort();
    }, [load]);

    const postAction = async (body: Record<string, unknown>, key: string, success: string): Promise<boolean> => {
        setWorkingKey(key);
        setMessage(null);
        const serializedPayload = JSON.stringify(body);
        const existingRequest = requestIds.current.get(key);
        const logicalRequest = existingRequest?.payload === serializedPayload
            ? existingRequest
            : { id: makeRequestId(), payload: serializedPayload };
        requestIds.current.set(key, logicalRequest);
        try {
            const response = await fetch('/api/admin/teachers-slots', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                body: JSON.stringify({ ...body, requestId: logicalRequest.id }),
            });
            requestIds.current.delete(key);
            const payload = await response.json().catch(() => null) as TeachersSlotsResponse | null;
            if (!response.ok) throw new Error(responseError(payload, t.genericError));
            setMessage({ type: 'success', text: success });
            await load();
            return true;
        } catch (error) {
            setMessage({ type: 'error', text: error instanceof Error ? error.message : t.genericError });
            return false;
        } finally {
            setWorkingKey(null);
        }
    };

    const selectedTeacher = data.teachers.find((teacher) => teacher.id === selectedTeacherId) ?? null;
    const selectedSlots = useMemo(
        () => data.slots.filter((slot) => slot.teacherId === selectedTeacherId),
        [data.slots, selectedTeacherId],
    );
    const previewDates = draft.firstClassDate
        ? [0, 7, 14, 21].map((days) => addDays(draft.firstClassDate, days))
        : [];
    const availableCount = data.slots.filter((slot) => slot.status === 'available').length;
    const draftCount = data.slots.filter((slot) => slot.status === 'draft').length;
    const isMutating = workingKey !== null;

    const submitActivation = async (event: FormEvent) => {
        event.preventDefault();
        if (!activation.confirmed || activation.reason.trim().length < 5) return;
        const succeeded = await postAction({
            action: 'activate_teacher',
            email: activation.email.trim(),
            engagementKind: activation.engagementKind,
            effectiveFrom: new Date(activation.effectiveFrom).toISOString(),
            reason: activation.reason.trim(),
        }, 'activate_teacher', t.activated);
        if (succeeded) setActivation({ email: '', engagementKind: 'external', effectiveFrom: '', reason: '', confirmed: false });
    };

    const submitInvitation = async (event: FormEvent) => {
        event.preventDefault();
        if (
            invitation.fullName.trim().length < 2
            || !invitation.email.includes('@')
            || invitation.reason.trim().length < 5
        ) return;

        const key = 'invite_teacher';
        const body = {
            target: 'teacher',
            fullName: invitation.fullName.trim(),
            email: invitation.email.trim(),
            lang,
            reason: invitation.reason.trim(),
        };
        const serializedPayload = JSON.stringify(body);
        const existingRequest = requestIds.current.get(key);
        const logicalRequest = existingRequest?.payload === serializedPayload
            ? existingRequest
            : { id: makeRequestId(), payload: serializedPayload };
        requestIds.current.set(key, logicalRequest);
        setWorkingKey(key);
        setMessage(null);
        try {
            const response = await fetch('/api/admin/staff-invitations', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                body: JSON.stringify({ ...body, requestId: logicalRequest.id }),
            });
            const payload = await response.json().catch(() => null) as StaffInvitationResponse | null;
            if (!response.ok) throw new Error(payload?.error || t.genericError);
            requestIds.current.delete(key);
            setMessage({
                type: payload?.auditDegraded ? 'error' : 'success',
                text: payload?.state === 'existing_verified'
                    ? t.existingVerified
                    : payload?.state === 'existing_pending'
                        ? t.existingPending
                        : t.invited,
            });
            setActivation((current) => ({ ...current, email: invitation.email.trim() }));
            setInvitation({ fullName: '', email: '', reason: '' });
        } catch (error) {
            setMessage({ type: 'error', text: error instanceof Error ? error.message : t.genericError });
        } finally {
            setWorkingKey(null);
        }
    };

    const submitEngagement = async (event: FormEvent) => {
        event.preventDefault();
        if (!selectedTeacher || engagement.reason.trim().length < 5 || !engagement.effectiveFrom) return;
        const succeeded = await postAction({
            action: 'configure_engagement',
            teacherId: selectedTeacher.id,
            engagementKind: engagement.engagementKind,
            effectiveFrom: new Date(engagement.effectiveFrom).toISOString(),
            reason: engagement.reason.trim(),
        }, `configure_engagement:${selectedTeacher.id}`, t.engagementConfigured);
        if (succeeded) setEngagement({ engagementKind: engagement.engagementKind, effectiveFrom: '', reason: '' });
    };

    const submitDraft = async (event: FormEvent) => {
        event.preventDefault();
        if (!selectedTeacher || draft.reason.trim().length < 5) return;
        const succeeded = await postAction({
            action: 'create_slot',
            teacherId: selectedTeacher.id,
            firstClassDate: draft.firstClassDate,
            localStartTime: draft.localStartTime,
            reason: draft.reason.trim(),
        }, 'create_slot', t.draftCreated);
        if (succeeded) setDraft({ firstClassDate: '', localStartTime: draft.localStartTime, reason: '' });
    };

    const submitTransition = async () => {
        if (!pendingTransition || transitionReason.trim().length < 5) return;
        const succeeded = await postAction({
            action: 'transition_slot',
            slotId: pendingTransition.slot.id,
            transition: pendingTransition.transition,
            reason: transitionReason.trim(),
        }, `transition:${pendingTransition.slot.id}`, t.transitionDone);
        if (succeeded) {
            setPendingTransition(null);
            setTransitionReason('');
        }
    };

    return (
        <div className="space-y-8">
            <header className="border-2 border-[#006064] bg-white p-5 shadow-[4px_4px_0px_0px_#006064] sm:p-7">
                <p className="max-w-4xl text-sm leading-6 text-[#006064]">{t.intro}</p>
                <dl className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <div className="border border-[#006064] bg-[#E0F7FA] p-3"><dt className="text-xs font-bold uppercase text-[#006064]">{t.teachers}</dt><dd className="font-display text-2xl text-[#006064]">{data.teachers.length}</dd></div>
                    <div className="border border-[#006064] bg-[#E0F7FA] p-3"><dt className="text-xs font-bold uppercase text-[#006064]">{t.placesAvailable}</dt><dd className="font-display text-2xl text-[#006064]">{availableCount}</dd></div>
                    <div className="border border-[#006064] bg-[#E0F7FA] p-3"><dt className="text-xs font-bold uppercase text-[#006064]">{t.placesDraft}</dt><dd className="font-display text-2xl text-[#006064]">{draftCount}</dd></div>
                    <div className="border border-[#006064] bg-[#E0F7FA] p-3"><dt className="text-xs font-bold uppercase text-[#006064]">{t.packageLabel}</dt><dd className="mt-1 text-sm font-bold text-[#006064]">{packageLabel(data.package, lang)}</dd></div>
                </dl>
            </header>

            {message && <div aria-live="polite" role={message.type === 'error' ? 'alert' : 'status'} className={`border-2 p-4 font-bold ${message.type === 'error' ? 'border-red-700 bg-red-50 text-red-800' : 'border-green-700 bg-green-50 text-green-800'}`}>{message.text}</div>}

            <section aria-labelledby="invite-teacher-heading" className="space-y-4">
                <header><h2 id="invite-teacher-heading" className="font-display text-2xl uppercase text-[#006064]">{t.inviteTitle}</h2><p className="mt-1 max-w-3xl text-sm text-[#006064]">{t.inviteIntro}</p></header>
                <form onSubmit={submitInvitation} className="grid gap-4 border-2 border-[#006064] bg-[#E0F7FA] p-5 md:grid-cols-2">
                    <label className="text-sm font-bold text-[#006064]">{t.fullName}<input required minLength={2} maxLength={120} value={invitation.fullName} onChange={(event) => setInvitation({ ...invitation, fullName: event.target.value })} disabled={isMutating} className="mt-1 block w-full border-2 border-[#006064] bg-white p-3" /></label>
                    <label className="text-sm font-bold text-[#006064]">{t.email}<input type="email" required maxLength={320} autoComplete="email" value={invitation.email} onChange={(event) => setInvitation({ ...invitation, email: event.target.value })} disabled={isMutating} className="mt-1 block w-full border-2 border-[#006064] bg-white p-3" /></label>
                    <label className="text-sm font-bold text-[#006064] md:col-span-2">{t.reason}<input required minLength={5} maxLength={1000} value={invitation.reason} onChange={(event) => setInvitation({ ...invitation, reason: event.target.value })} placeholder={t.reasonPlaceholder} disabled={isMutating} className="mt-1 block w-full border-2 border-[#006064] bg-white p-3" /></label>
                    <button type="submit" disabled={isMutating || invitation.fullName.trim().length < 2 || !invitation.email.includes('@') || invitation.reason.trim().length < 5} aria-busy={workingKey === 'invite_teacher'} className="w-fit border-2 border-[#006064] bg-white px-5 py-3 text-sm font-bold uppercase text-[#006064] disabled:opacity-50">{workingKey === 'invite_teacher' ? t.inviting : t.invite}</button>
                </form>
            </section>

            <section aria-labelledby="activate-teacher-heading" className="space-y-4">
                <header><h2 id="activate-teacher-heading" className="font-display text-2xl uppercase text-[#006064]">{t.activateTitle}</h2><p className="mt-1 max-w-3xl text-sm text-[#006064]">{t.activateIntro}</p></header>
                <form onSubmit={submitActivation} className="grid gap-4 border-2 border-[#006064] bg-white p-5 md:grid-cols-2">
                    <label className="text-sm font-bold text-[#006064]">{t.email}<input type="email" required value={activation.email} onChange={(event) => setActivation({ ...activation, email: event.target.value })} disabled={isMutating} className="mt-1 block w-full border-2 border-[#006064] p-3" /></label>
                    <label className="text-sm font-bold text-[#006064]">{t.engagement}<select value={activation.engagementKind} onChange={(event) => setActivation({ ...activation, engagementKind: event.target.value as EngagementKind })} disabled={isMutating} className="mt-1 block w-full border-2 border-[#006064] p-3"><option value="founder">{t.founder}</option><option value="external">{t.external}</option></select></label>
                    <label className="text-sm font-bold text-[#006064]">{t.effectiveFrom}<input type="datetime-local" required value={activation.effectiveFrom} onChange={(event) => setActivation({ ...activation, effectiveFrom: event.target.value })} disabled={isMutating} className="mt-1 block w-full border-2 border-[#006064] p-3" /></label>
                    <label className="text-sm font-bold text-[#006064]">{t.reason}<input required minLength={5} maxLength={1000} value={activation.reason} onChange={(event) => setActivation({ ...activation, reason: event.target.value })} placeholder={t.reasonPlaceholder} disabled={isMutating} className="mt-1 block w-full border-2 border-[#006064] p-3" /></label>
                    <label className="flex items-start gap-3 text-sm font-bold text-[#006064] md:col-span-2"><input type="checkbox" checked={activation.confirmed} onChange={(event) => setActivation({ ...activation, confirmed: event.target.checked })} disabled={isMutating} className="mt-1 h-5 w-5 accent-[#006064]" /><span>{t.confirmExisting}</span></label>
                    <button type="submit" disabled={isMutating || !activation.confirmed || activation.reason.trim().length < 5} aria-busy={workingKey === 'activate_teacher'} className="w-fit border-2 border-[#006064] bg-[#006064] px-5 py-3 text-sm font-bold uppercase text-white disabled:opacity-50">{workingKey === 'activate_teacher' ? t.saving : t.activate}</button>
                </form>
            </section>

            {loading ? (
                <p role="status" className="border-2 border-[#006064] bg-white p-6 font-mono text-[#006064]">{t.loading}</p>
            ) : loadError ? (
                <div role="alert" className="border-2 border-red-700 bg-red-50 p-5 text-red-800"><p className="font-bold">{loadError}</p><button type="button" onClick={() => void load()} className="mt-3 border-2 border-red-800 bg-white px-4 py-2 text-sm font-bold uppercase">{t.retry}</button></div>
            ) : data.teachers.length === 0 ? (
                <p role="status" className="border-2 border-[#006064] bg-white p-6 text-[#006064]">{t.noTeachers}</p>
            ) : selectedTeacher ? (
                <>
                    <section aria-labelledby="teacher-selection-heading" className="border-2 border-[#006064] bg-white p-5">
                        <label id="teacher-selection-heading" htmlFor="teacher-selection" className="block text-sm font-bold uppercase text-[#006064]">{t.selectTeacher}</label>
                        <select id="teacher-selection" value={selectedTeacherId} onChange={(event) => { setSelectedTeacherId(event.target.value); setPendingTransition(null); setTransitionReason(''); }} disabled={isMutating} className="mt-2 w-full border-2 border-[#006064] p-3 sm:max-w-xl">
                            {data.teachers.map((teacher) => <option key={teacher.id} value={teacher.id}>{teacherLabel(teacher)} · {engagementKind(teacher) === 'founder' ? t.founder : engagementKind(teacher) === 'external' ? t.external : '—'}</option>)}
                        </select>
                        <p className={`mt-3 text-sm font-bold ${selectedTeacher.availability.length ? 'text-green-800' : 'text-amber-900'}`}>{selectedTeacher.availability.length ? t.availabilityConfigured : t.noAvailability}</p>
                    </section>

                    <section aria-labelledby="engagement-heading" className="space-y-4">
                        <header><h2 id="engagement-heading" className="font-display text-2xl uppercase text-[#006064]">{t.configureEngagement}</h2><p className="mt-1 text-sm font-bold text-[#006064]">{t.configureEngagementIntro}</p></header>
                        <p className="border-2 border-[#006064] bg-[#E0F7FA] p-4 text-sm font-bold text-[#006064]">{t.latestEngagement}: {engagementKind(selectedTeacher) === 'founder' ? t.founder : engagementKind(selectedTeacher) === 'external' ? t.external : '—'}{engagementEffectiveFrom(selectedTeacher) ? ` · ${formatInstant(engagementEffectiveFrom(selectedTeacher) as string, lang)}` : ''}</p>
                        <form onSubmit={submitEngagement} className="grid gap-4 border-2 border-[#006064] bg-white p-5 md:grid-cols-2">
                            <label className="text-sm font-bold text-[#006064]">{t.engagement}<select value={engagement.engagementKind} onChange={(event) => setEngagement({ ...engagement, engagementKind: event.target.value as EngagementKind })} disabled={isMutating} className="mt-1 block w-full border-2 border-[#006064] p-3"><option value="founder">{t.founder}</option><option value="external">{t.external}</option></select></label>
                            <label className="text-sm font-bold text-[#006064]">{t.effectiveFrom}<input type="datetime-local" required value={engagement.effectiveFrom} onChange={(event) => setEngagement({ ...engagement, effectiveFrom: event.target.value })} disabled={isMutating} className="mt-1 block w-full border-2 border-[#006064] p-3" /></label>
                            <label className="text-sm font-bold text-[#006064] md:col-span-2">{t.reason}<input required minLength={5} maxLength={1000} value={engagement.reason} onChange={(event) => setEngagement({ ...engagement, reason: event.target.value })} placeholder={t.reasonPlaceholder} disabled={isMutating} className="mt-1 block w-full border-2 border-[#006064] p-3" /></label>
                            <button type="submit" disabled={isMutating || !engagement.effectiveFrom || engagement.reason.trim().length < 5} aria-busy={workingKey === `configure_engagement:${selectedTeacher.id}`} className="w-fit border-2 border-[#006064] bg-[#006064] px-5 py-3 text-sm font-bold uppercase text-white disabled:opacity-50">{workingKey === `configure_engagement:${selectedTeacher.id}` ? t.saving : t.configureEngagement}</button>
                        </form>
                    </section>

                    <section aria-labelledby="availability-heading" className="space-y-4">
                        <header><h2 id="availability-heading" className="font-display text-2xl uppercase text-[#006064]">{t.availabilityTitle}</h2><p className="mt-1 text-sm font-bold text-[#006064]">{t.availabilityIntro}</p></header>
                        <AvailabilityManager
                            key={selectedTeacher.id}
                            initialAvailability={selectedTeacher.availability.map((slot) => ({
                                id: slot.id,
                                day_of_week: slot.dayOfWeek,
                                start_time: slot.startTime,
                                end_time: slot.endTime,
                                is_active: true,
                            }))}
                            teacherId={selectedTeacher.id}
                            onAvailabilityChange={(nextAvailability: AvailabilitySlot[]) => {
                                setData((current) => ({
                                    ...current,
                                    teachers: current.teachers.map((teacher) => teacher.id === selectedTeacher.id ? {
                                        ...teacher,
                                        availability: nextAvailability.map((slot) => ({
                                            id: slot.id,
                                            dayOfWeek: slot.day_of_week,
                                            startTime: slot.start_time,
                                            endTime: slot.end_time,
                                        })),
                                    } : teacher),
                                }));
                            }}
                            lang={lang}
                            translations={{
                                dayNames: [...t.days], addSlot: t.addSlot, removeSlot: t.removeSlot, from: t.from, to: t.to,
                                save: t.save, cancel: t.cancelAvailability, noSlots: t.noAvailabilitySlots, day: t.day,
                                slotAdded: t.slotAdded, slotRemoved: t.slotRemoved, errorAdding: t.errorAdding,
                                errorRemoving: t.errorRemoving, invalidTimeRange: t.invalidTimeRange, timezoneNotice: t.timezoneNotice,
                            }}
                        />
                    </section>

                    <section aria-labelledby="bookable-slots-heading" className="space-y-5">
                        <header><h2 id="bookable-slots-heading" className="font-display text-2xl uppercase text-[#006064]">{t.slotsTitle}</h2><p className="mt-1 max-w-3xl text-sm font-bold text-[#006064]">{t.slotsIntro}</p></header>

                        <form onSubmit={submitDraft} className="grid gap-4 border-2 border-[#006064] bg-white p-5 md:grid-cols-2">
                            <h3 className="font-display text-xl uppercase text-[#006064] md:col-span-2">{t.createTitle}</h3>
                            <label className="text-sm font-bold text-[#006064]">{t.firstClassDate}<input type="date" required value={draft.firstClassDate} onChange={(event) => setDraft({ ...draft, firstClassDate: event.target.value })} disabled={isMutating} className="mt-1 block w-full border-2 border-[#006064] p-3" /></label>
                            <label className="text-sm font-bold text-[#006064]">{t.localStartTime}<input type="time" required value={draft.localStartTime} onChange={(event) => setDraft({ ...draft, localStartTime: event.target.value })} disabled={isMutating} className="mt-1 block w-full border-2 border-[#006064] p-3" /><span className="mt-1 block text-xs">{t.timezone}</span></label>
                            <label className="text-sm font-bold text-[#006064] md:col-span-2">{t.reason}<input required minLength={5} maxLength={1000} value={draft.reason} onChange={(event) => setDraft({ ...draft, reason: event.target.value })} placeholder={t.reasonPlaceholder} disabled={isMutating} className="mt-1 block w-full border-2 border-[#006064] p-3" /></label>
                            {previewDates.length > 0 && <fieldset className="border-2 border-[#006064] bg-[#E0F7FA] p-4 md:col-span-2"><legend className="px-2 text-xs font-bold uppercase text-[#006064]">{t.preview}</legend><ol className="grid gap-2 sm:grid-cols-2">{previewDates.map((date, index) => <li key={date} className="font-mono text-sm text-[#006064]">{index + 1}. {date} · {draft.localStartTime}</li>)}</ol></fieldset>}
                            <button type="submit" disabled={isMutating || !draft.firstClassDate || draft.reason.trim().length < 5} aria-busy={workingKey === 'create_slot'} className="w-fit border-2 border-[#006064] bg-[#006064] px-5 py-3 text-sm font-bold uppercase text-white disabled:opacity-50">{workingKey === 'create_slot' ? t.saving : t.createDraft}</button>
                        </form>

                        {pendingTransition && <section aria-labelledby="transition-heading" className="border-4 border-amber-800 bg-amber-50 p-5 text-amber-950 shadow-[4px_4px_0px_0px_currentColor]"><h3 id="transition-heading" className="font-display text-xl uppercase text-amber-950">{t.confirmAction}: {t[pendingTransition.transition]}</h3><p className="mt-2 font-mono text-sm font-bold text-amber-950">{t.publicId}: {pendingTransition.slot.publicId}</p><p className="mt-2 text-sm text-amber-950">{pendingTransition.transition === 'publish' ? t.confirmPublish : t.confirmTransition}</p><label className="mt-4 block text-sm font-bold text-amber-950">{t.reason}<input autoFocus required minLength={5} maxLength={1000} value={transitionReason} onChange={(event) => setTransitionReason(event.target.value)} className="mt-1 block w-full border-2 border-amber-900 bg-white p-3" /></label>{transitionReason.length > 0 && transitionReason.trim().length < 5 && <p role="alert" className="mt-2 text-sm font-bold text-red-800">{t.requiredReason}</p>}<div className="mt-4 flex flex-wrap gap-3"><button type="button" onClick={() => void submitTransition()} disabled={isMutating || transitionReason.trim().length < 5} className="border-2 border-amber-950 bg-amber-950 px-4 py-2 text-sm font-bold uppercase text-white disabled:opacity-50">{isMutating ? t.saving : t.confirm}</button><button type="button" onClick={() => { setPendingTransition(null); setTransitionReason(''); }} disabled={isMutating} className="border-2 border-amber-950 bg-white px-4 py-2 text-sm font-bold uppercase text-amber-950">{t.cancel}</button></div></section>}

                        {selectedSlots.length === 0 ? <p role="status" className="border-2 border-[#006064] bg-white p-6 text-[#006064]">{t.noSlots}</p> : (
                            <div className="overflow-x-auto border-2 border-[#006064] bg-white" tabIndex={0} aria-label={t.slotsTitle}>
                                <table className="w-full min-w-[920px] text-left text-sm"><thead className="bg-[#006064] text-white"><tr><th className="p-3">{t.status}</th><th className="p-3">{t.schedule}</th><th className="p-3">{t.firstClass}</th><th className="p-3">{t.publicId}</th><th className="p-3">{t.actions}</th></tr></thead><tbody className="divide-y divide-[#006064]/20">{selectedSlots.map((slot) => {
                                    const actions = TRANSITIONS[slot.status];
                                    return <tr key={slot.id}><td className="p-3 align-top"><span className={`inline-flex border px-2 py-1 text-xs font-bold uppercase ${STATUS_STYLES[slot.status]}`}>{t[slot.status]}</span>{slot.hasLiveHold && <span className="mt-2 block w-fit border border-violet-700 bg-violet-50 px-2 py-1 text-xs font-bold text-violet-900">{t.liveHold}</span>}</td><td className="p-3 align-top font-bold text-[#006064]">{t.days[slot.weekday]} · {slot.localStartTime.slice(0, 5)}<ol className="mt-2 space-y-1 font-mono text-xs font-normal">{[...slot.occurrences].sort((a, b) => (a.index ?? a.occurrenceIndex ?? a.occurrence_index ?? 0) - (b.index ?? b.occurrenceIndex ?? b.occurrence_index ?? 0)).map((occurrence, index) => { const instant = occurrenceInstant(occurrence); return <li key={`${slot.id}-${index}`}>{index + 1}. {instant ? formatInstant(instant, lang) : '—'}</li>; })}</ol></td><td className="p-3 align-top text-[#006064]">{formatInstant(slot.firstOccurrenceAt, lang)}</td><td className="p-3 align-top font-mono text-xs text-[#006064]">{slot.publicId}</td><td className="p-3 align-top"><div className="flex flex-wrap gap-2">{actions.map((transition) => { const blockedByHold = slot.hasLiveHold && (transition === 'pause' || transition === 'retire'); return <button key={transition} type="button" onClick={() => { setPendingTransition({ slot, transition }); setTransitionReason(''); }} disabled={isMutating || blockedByHold} title={blockedByHold ? t.holdBlocked : undefined} className="border-2 border-[#006064] px-3 py-2 text-xs font-bold uppercase text-[#006064] disabled:cursor-not-allowed disabled:opacity-40">{t[transition]}</button>; })}</div>{slot.hasLiveHold && actions.some((action) => action === 'pause' || action === 'retire') && <p className="mt-2 max-w-xs text-xs font-bold text-violet-900">{t.holdBlocked}</p>}</td></tr>;
                                })}</tbody></table>
                            </div>
                        )}
                    </section>
                </>
            ) : null}
        </div>
    );
}
