import { MINIMUM_CUSTOMER_AGE } from './legal-policy';
import {
    INITIAL_INDIVIDUAL_OFFER,
    PACKAGE_CURRENCY_CODE,
} from './package-pricing';
import { fetchPublicAvailability } from './public-availability-client';
import type { PublicBookableSlot } from './public-bookable-slots';
import type { PublicAvailabilityResponse } from './public-checkout-ui';

export const ACADEMY_WEBMCP_TOOL_NAMES = [
    'get_academy_offer',
    'check_fit',
    'list_bookable_slots',
    'draft_learning_brief',
    'prepare_booking_review',
    'clear_booking_draft',
] as const;

export type AcademyWebMcpToolName = typeof ACADEMY_WEBMCP_TOOL_NAMES[number];
export type LearningLevel = 'not_sure' | 'a1' | 'a2' | 'b1' | 'b2' | 'c1_plus';

export interface LearningBriefDraft {
    currentLevel: LearningLevel;
    goal: string;
    context: string;
    timezone: string;
}

export interface AcademyWebMcpBridge {
    draftLearningBrief(brief: LearningBriefDraft): boolean | Promise<boolean>;
    prepareBookingReview(slot: PublicBookableSlot): boolean | Promise<boolean>;
    clearBookingDraft(): boolean | Promise<boolean>;
}

interface WebMcpToolAnnotations {
    readOnlyHint: boolean;
    untrustedContentHint?: boolean;
}

export interface WebMcpExecutionContext {
    signal?: AbortSignal;
}

export interface WebMcpToolDefinition {
    name: AcademyWebMcpToolName;
    description: string;
    inputSchema: Record<string, unknown>;
    annotations: WebMcpToolAnnotations;
    execute(input?: unknown, context?: WebMcpExecutionContext): Promise<Record<string, unknown>>;
}

export interface WebMcpModelContext {
    registerTool(tool: WebMcpToolDefinition, options: { signal: AbortSignal }): void | Promise<void>;
}

export interface WebMcpDocumentLike {
    modelContext?: WebMcpModelContext;
    location?: { href: string };
    documentElement?: { dataset?: { appEnvironment?: string } };
}

interface CreateAcademyWebMcpToolsOptions {
    getBridge: () => AcademyWebMcpBridge | null;
    isActive?: () => boolean;
    loadAvailability?: (signal?: AbortSignal) => Promise<PublicAvailabilityResponse>;
    now?: () => number;
    getPageUrl?: () => string;
    getAppEnvironment?: () => string | undefined;
}

interface RegisterAcademyWebMcpToolsOptions {
    document: WebMcpDocumentLike;
    bridge: AcademyWebMcpBridge;
    loadAvailability?: (signal?: AbortSignal) => Promise<PublicAvailabilityResponse>;
    now?: () => number;
}

export interface AcademyWebMcpRegistration {
    supported: boolean;
    toolNames: readonly AcademyWebMcpToolName[];
    release(): Promise<void>;
}

type WebMcpErrorCode =
    | 'AVAILABILITY_UNAVAILABLE'
    | 'CURSOR_STALE'
    | 'INVALID_INPUT'
    | 'OFFER_UNAVAILABLE'
    | 'REQUEST_ABORTED'
    | 'SENSITIVE_INPUT_REJECTED'
    | 'SLOT_STALE'
    | 'UI_UNAVAILABLE'
    | 'WEBMCP_INACTIVE';

type FitAgeGroup = 'adult_18_plus' | 'under_18' | 'unknown';
type FitTargetLanguage = 'spanish' | 'other' | 'unknown';
type FitLessonFormat = 'individual' | 'group' | 'either' | 'unknown';

interface FitInput {
    ageGroup: FitAgeGroup;
    targetLanguage: FitTargetLanguage;
    lessonFormat: FitLessonFormat;
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const learningLevels = new Set<LearningLevel>(['not_sure', 'a1', 'a2', 'b1', 'b2', 'c1_plus']);
const fitAgeGroups = new Set<FitAgeGroup>(['adult_18_plus', 'under_18', 'unknown']);
const fitTargetLanguages = new Set<FitTargetLanguage>(['spanish', 'other', 'unknown']);
const fitLessonFormats = new Set<FitLessonFormat>(['individual', 'group', 'either', 'unknown']);
const emailPattern = /\b[^\s@]+@[^\s@]+\.[^\s@]+\b/u;
const paymentCardPattern = /(?:\d[\s-]?){13,19}/u;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
    const allowedKeys = new Set(allowed);
    return Object.keys(value).every((key) => allowedKeys.has(key));
}

function noInput(value: unknown): boolean {
    return value === undefined || (isRecord(value) && Object.keys(value).length === 0);
}

function observedAt(now: () => number): string {
    const value = now();
    return new Date(Number.isFinite(value) ? value : Date.now()).toISOString();
}

function safePageUrl(getPageUrl: () => string): string | null {
    try {
        const url = new URL(getPageUrl());
        const localHttpHost = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
        if (url.protocol !== 'https:' && !(url.protocol === 'http:' && localHttpHost)) return null;
        url.username = '';
        url.password = '';
        url.search = '';
        url.hash = '';
        return url.toString();
    } catch {
        return null;
    }
}

function runtimeDisclosure(getAppEnvironment: () => string | undefined) {
    const appEnvironment = getAppEnvironment()?.trim().toLowerCase();
    const sandboxEnvironments = new Set(['dev', 'development', 'local', 'test', 'staging']);
    if (appEnvironment && sandboxEnvironments.has(appEnvironment)) {
        return {
            kind: 'sandbox',
        };
    }
    if (appEnvironment === 'production') {
        return {
            kind: 'production',
        };
    }

    return {
        kind: 'unknown',
    };
}

function availabilitySource(getPageUrl: () => string, timestamp: string) {
    const pageUrl = safePageUrl(getPageUrl);
    let url: string | null = null;
    try {
        if (pageUrl) url = new URL('/api/bookable-slots', pageUrl).toString();
    } catch {
        url = null;
    }
    return {
        kind: 'live_public_availability',
        url,
        observedAt: timestamp,
    };
}

function toolError(code: WebMcpErrorCode, message: string, timestamp: string, retryable = false) {
    return {
        ok: false,
        error: { code, message, retryable },
        observedAt: timestamp,
    };
}

function inactiveResult(now: () => number) {
    return toolError(
        'WEBMCP_INACTIVE',
        'The page no longer provides this site tool. Reopen the academy page and try again.',
        observedAt(now),
    );
}

function formatLocalDateTime(iso: string, timeZone: string): string {
    const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone,
        weekday: 'short',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
    }).formatToParts(new Date(iso));
    const values = new Map(parts.map((part) => [part.type, part.value]));
    return `${values.get('weekday')} ${values.get('year')}-${values.get('month')}-${values.get('day')} ${values.get('hour')}:${values.get('minute')}`;
}

function serializeSlot(slot: PublicBookableSlot, viewTimezone = slot.timezoneName) {
    return {
        publicId: slot.publicId,
        teacherName: slot.teacherName,
        weekday: slot.weekday,
        localStartTime: slot.localStartTime,
        sourceTimezone: slot.timezoneName,
        viewTimezone,
        firstOccurrenceLocal: formatLocalDateTime(slot.firstClassAt, viewTimezone),
        occurrences: slot.occurrences.map((occurrence) => ({
            startsAt: occurrence.startsAt,
            local: formatLocalDateTime(occurrence.startsAt, viewTimezone),
        })),
        renewalAt: slot.renewalAt,
        renewalLocal: formatLocalDateTime(slot.renewalAt, viewTimezone),
    };
}

function parseListInput(value: unknown): { cursor: string | null; timezone: string | null } | null {
    if (value === undefined) return { cursor: null, timezone: null };
    if (!isRecord(value) || !hasOnlyKeys(value, ['cursor', 'timezone'])) return null;
    if (value.cursor !== undefined && (typeof value.cursor !== 'string' || !uuidPattern.test(value.cursor))) return null;
    if (value.timezone !== undefined && (typeof value.timezone !== 'string' || !isValidTimeZone(value.timezone))) return null;
    return {
        cursor: typeof value.cursor === 'string' ? value.cursor : null,
        timezone: typeof value.timezone === 'string' ? value.timezone : null,
    };
}

function parseFitInput(value: unknown): FitInput | null {
    if (!isRecord(value) || !hasOnlyKeys(value, ['ageGroup', 'targetLanguage', 'lessonFormat'])) return null;
    if (
        typeof value.ageGroup !== 'string'
        || typeof value.targetLanguage !== 'string'
        || typeof value.lessonFormat !== 'string'
        || !fitAgeGroups.has(value.ageGroup as FitAgeGroup)
        || !fitTargetLanguages.has(value.targetLanguage as FitTargetLanguage)
        || !fitLessonFormats.has(value.lessonFormat as FitLessonFormat)
    ) return null;
    return {
        ageGroup: value.ageGroup as FitAgeGroup,
        targetLanguage: value.targetLanguage as FitTargetLanguage,
        lessonFormat: value.lessonFormat as FitLessonFormat,
    };
}

function isValidTimeZone(value: string): boolean {
    if (!value || value.length > 64) return false;
    try {
        new Intl.DateTimeFormat('en', { timeZone: value }).format(new Date(0));
        return true;
    } catch {
        return false;
    }
}

function normalizeBriefText(value: unknown, maxLength: number, required: boolean): string | null {
    if (typeof value !== 'string') return null;
    const normalized = value.trim();
    if ((required && !normalized) || normalized.length > maxLength) return null;
    const hasProhibitedControlCharacter = [...normalized].some((character) => {
        const codePoint = character.codePointAt(0) ?? 0;
        return codePoint <= 8
            || codePoint === 11
            || codePoint === 12
            || (codePoint >= 14 && codePoint <= 31)
            || codePoint === 127;
    });
    if (hasProhibitedControlCharacter) return null;
    return normalized;
}

function parseLearningBrief(value: unknown): LearningBriefDraft | 'sensitive' | null {
    if (!isRecord(value) || !hasOnlyKeys(value, ['currentLevel', 'goal', 'context', 'timezone'])) return null;
    if (typeof value.currentLevel !== 'string' || !learningLevels.has(value.currentLevel as LearningLevel)) return null;
    const goal = normalizeBriefText(value.goal, 240, true);
    const context = normalizeBriefText(value.context, 500, false);
    const timezone = normalizeBriefText(value.timezone, 64, true);
    if (goal === null || context === null || timezone === null || !isValidTimeZone(timezone)) return null;
    if (emailPattern.test(`${goal} ${context}`) || paymentCardPattern.test(`${goal} ${context}`)) return 'sensitive';
    return {
        currentLevel: value.currentLevel as LearningLevel,
        goal,
        context,
        timezone,
    };
}

async function safelyUseBridge(
    operation: () => boolean | Promise<boolean>,
): Promise<boolean> {
    try {
        return await operation();
    } catch {
        return false;
    }
}

export function createAcademyWebMcpTools({
    getBridge,
    isActive = () => true,
    loadAvailability = (signal) => fetchPublicAvailability({ signal }),
    now = () => Date.now(),
    getPageUrl = () => (typeof window === 'undefined' ? 'https://localhost/' : window.location.href),
    getAppEnvironment = () => undefined,
}: CreateAcademyWebMcpToolsOptions): WebMcpToolDefinition[] {
    const requireActive = (): Record<string, unknown> | null => (
        isActive() ? null : inactiveResult(now)
    );

    const readAvailability = async (
        signal?: AbortSignal,
    ): Promise<PublicAvailabilityResponse | 'aborted' | null> => {
        if (signal?.aborted) return 'aborted';
        try {
            const availability = await loadAvailability(signal);
            return signal?.aborted ? 'aborted' : availability;
        } catch {
            return signal?.aborted ? 'aborted' : null;
        }
    };

    return [
        {
            name: 'get_academy_offer',
            description: 'Read the academy\'s canonical one-to-one Spanish offer and human checkout boundaries. This does not reserve or purchase anything.',
            inputSchema: {
                type: 'object',
                properties: {},
                additionalProperties: false,
            },
            annotations: { readOnlyHint: true },
            execute: async (input) => {
                const inactive = requireActive();
                if (inactive) return inactive;
                const timestamp = observedAt(now);
                if (!noInput(input)) return toolError('INVALID_INPUT', 'This tool does not accept input.', timestamp);
                return {
                    ok: true,
                    environment: runtimeDisclosure(getAppEnvironment),
                    offer: {
                        packageKey: INITIAL_INDIVIDUAL_OFFER.packageKey,
                        format: 'individual_online_spanish',
                        audience: { minimumAge: MINIMUM_CUSTOMER_AGE, adultOnly: true },
                        price: {
                            amountCents: INITIAL_INDIVIDUAL_OFFER.amountCents,
                            currency: PACKAGE_CURRENCY_CODE,
                            chargedWhenPlaceIsReserved: true,
                        },
                        cycle: {
                            sessions: INITIAL_INDIVIDUAL_OFFER.sessionsPerPeriod,
                            classDurationMinutes: INITIAL_INDIVIDUAL_OFFER.classDurationMinutes,
                            intervalUnit: INITIAL_INDIVIDUAL_OFFER.billingIntervalUnit,
                            intervalCount: INITIAL_INDIVIDUAL_OFFER.billingIntervalCount,
                            automaticRenewal: true,
                        },
                        selectionBeforePayment: ['teacher', 'weekly_time', 'timezone', 'four_class_dates', 'renewal_date'],
                    },
                    fitBoundaries: {
                        supports: ['adults_18_plus', 'spanish', 'individual_lessons'],
                        doesNotSupport: ['minors', 'group_only_lessons', 'languages_other_than_spanish'],
                    },
                    checkoutBoundaries: {
                        accountRequired: true,
                        humanAdultAttestationRequired: true,
                        humanLegalAcceptanceRequired: true,
                        humanSecurityCheckRequired: true,
                        humanPaymentAuthorizationRequired: true,
                    },
                    guarantee: {
                        kind: 'proportional_unconsumed_classes',
                        appliesTo: 'any_paid_cycle',
                        requestWindow: 'after_at_least_one_consumed_class_and_before_the_next_class',
                        effect: 'refund_unconsumed_classes_and_cancel_future_renewals',
                    },
                    source: {
                        kind: 'canonical_application_contract',
                        pageUrl: safePageUrl(getPageUrl),
                        observedAt: timestamp,
                    },
                };
            },
        },
        {
            name: 'check_fit',
            description: 'Check explicit academy fit boundaries without scoring, persuasion, or reserving a place.',
            inputSchema: {
                type: 'object',
                properties: {
                    ageGroup: { type: 'string', enum: ['adult_18_plus', 'under_18', 'unknown'] },
                    targetLanguage: { type: 'string', enum: ['spanish', 'other', 'unknown'] },
                    lessonFormat: { type: 'string', enum: ['individual', 'group', 'either', 'unknown'] },
                },
                required: ['ageGroup', 'targetLanguage', 'lessonFormat'],
                additionalProperties: false,
            },
            annotations: { readOnlyHint: true },
            execute: async (input) => {
                const inactive = requireActive();
                if (inactive) return inactive;
                const timestamp = observedAt(now);
                const parsed = parseFitInput(input);
                if (!parsed) return toolError('INVALID_INPUT', 'Use only the documented fit fields and values.', timestamp);

                const reasons: Array<{ code: string; explanation: string }> = [];
                if (parsed.ageGroup === 'under_18') {
                    reasons.push({ code: 'UNDER_18_NOT_SUPPORTED', explanation: 'The academy serves adults aged 18 or over only.' });
                }
                if (parsed.targetLanguage === 'other') {
                    reasons.push({ code: 'SPANISH_ONLY', explanation: 'The academy teaches Spanish only.' });
                }
                if (parsed.lessonFormat === 'group') {
                    reasons.push({ code: 'INDIVIDUAL_ONLY', explanation: 'The current offer contains individual lessons, not group lessons.' });
                }

                const missing = [
                    parsed.ageGroup === 'unknown' ? 'ageGroup' : null,
                    parsed.targetLanguage === 'unknown' ? 'targetLanguage' : null,
                    parsed.lessonFormat === 'unknown' ? 'lessonFormat' : null,
                ].filter((field): field is string => Boolean(field));
                const fit = reasons.length > 0 ? 'not_fit' : missing.length > 0 ? 'needs_information' : 'fit';
                return {
                    ok: true,
                    environment: runtimeDisclosure(getAppEnvironment),
                    fit,
                    reasons,
                    missing,
                    observedAt: timestamp,
                };
            },
        },
        {
            name: 'list_bookable_slots',
            description: 'Read one current public weekly place in a requested IANA timezone. Use nextCursor to continue. This returns teacher and schedule data but does not create a hold.',
            inputSchema: {
                type: 'object',
                properties: {
                    cursor: { type: 'string', pattern: uuidPattern.source },
                    timezone: { type: 'string', minLength: 1, maxLength: 64 },
                },
                additionalProperties: false,
            },
            annotations: { readOnlyHint: true, untrustedContentHint: true },
            execute: async (input, execution) => {
                const inactive = requireActive();
                if (inactive) return inactive;
                const timestamp = observedAt(now);
                const parsed = parseListInput(input);
                if (!parsed) return toolError('INVALID_INPUT', 'Use only a returned cursor and a valid IANA timezone.', timestamp);
                const availability = await readAvailability(execution?.signal);
                if (availability === 'aborted') {
                    return toolError('REQUEST_ABORTED', 'The availability request was cancelled. No page state changed.', timestamp, true);
                }
                if (!availability) {
                    return toolError('AVAILABILITY_UNAVAILABLE', 'Current public availability could not be verified. Try again later.', timestamp, true);
                }
                const startIndex = parsed.cursor === null
                    ? 0
                    : availability.slots.findIndex((slot) => slot.publicId === parsed.cursor) + 1;
                if (parsed.cursor !== null && startIndex === 0) {
                    return toolError('CURSOR_STALE', 'Availability changed and this cursor is no longer current. Restart the listing.', timestamp, true);
                }
                const page = availability.slots.slice(startIndex, startIndex + 1);
                const hasMore = startIndex + page.length < availability.slots.length;
                return {
                    ok: true,
                    environment: runtimeDisclosure(getAppEnvironment),
                    slots: page.map((slot) => serializeSlot(slot, parsed.timezone ?? slot.timezoneName)),
                    totalAvailable: availability.slots.length,
                    hasMore,
                    nextCursor: hasMore ? page.at(-1)?.publicId ?? null : null,
                    checkoutState: availability.checkoutEnabled ? 'open' : 'closed',
                    source: availabilitySource(getPageUrl, timestamp),
                };
            },
        },
        {
            name: 'draft_learning_brief',
            description: 'Populate the visible, editable learning brief on this page. Keep it to learning context; email addresses and payment-card-like numbers are rejected. Nothing is submitted.',
            inputSchema: {
                type: 'object',
                properties: {
                    currentLevel: { type: 'string', enum: [...learningLevels] },
                    goal: { type: 'string', minLength: 1, maxLength: 240 },
                    context: { type: 'string', maxLength: 500 },
                    timezone: { type: 'string', minLength: 1, maxLength: 64 },
                },
                required: ['currentLevel', 'goal', 'context', 'timezone'],
                additionalProperties: false,
            },
            annotations: { readOnlyHint: false, untrustedContentHint: true },
            execute: async (input, execution) => {
                const inactive = requireActive();
                if (inactive) return inactive;
                const timestamp = observedAt(now);
                if (execution?.signal?.aborted) {
                    return toolError('REQUEST_ABORTED', 'The learning-brief update was cancelled. No page state changed.', timestamp, true);
                }
                const parsed = parseLearningBrief(input);
                if (parsed === 'sensitive') {
                    return toolError('SENSITIVE_INPUT_REJECTED', 'Remove email addresses and payment-card-like numbers. The brief is for learning context only.', timestamp);
                }
                if (!parsed) return toolError('INVALID_INPUT', 'Provide a valid level, concise goal and context, and an IANA timezone.', timestamp);
                const bridge = getBridge();
                if (!bridge) return toolError('UI_UNAVAILABLE', 'The editable learning brief is not available on this page.', timestamp);
                const visible = await safelyUseBridge(() => bridge.draftLearningBrief(parsed));
                if (!visible) return toolError('UI_UNAVAILABLE', 'The editable learning brief could not be updated.', timestamp);
                return {
                    ok: true,
                    environment: runtimeDisclosure(getAppEnvironment),
                    brief: parsed,
                    visibleInPage: true,
                    submitted: false,
                    observedAt: timestamp,
                };
            },
        },
        {
            name: 'prepare_booking_review',
            description: 'Revalidate one public slot and open it in the existing visible review or login flow. This never holds the slot, accepts terms, solves the security check, creates checkout, or authorizes payment.',
            inputSchema: {
                type: 'object',
                properties: {
                    publicSlotId: { type: 'string', pattern: uuidPattern.source },
                    timezone: { type: 'string', minLength: 1, maxLength: 64 },
                },
                required: ['publicSlotId'],
                additionalProperties: false,
            },
            annotations: { readOnlyHint: false, untrustedContentHint: true },
            execute: async (input, execution) => {
                const inactive = requireActive();
                if (inactive) return inactive;
                const timestamp = observedAt(now);
                if (
                    !isRecord(input)
                    || !hasOnlyKeys(input, ['publicSlotId', 'timezone'])
                    || typeof input.publicSlotId !== 'string'
                    || !uuidPattern.test(input.publicSlotId)
                    || (input.timezone !== undefined && (typeof input.timezone !== 'string' || !isValidTimeZone(input.timezone)))
                ) return toolError('INVALID_INPUT', 'Provide one current public slot ID and, optionally, a valid IANA timezone.', timestamp);
                const availability = await readAvailability(execution?.signal);
                if (availability === 'aborted') {
                    return toolError('REQUEST_ABORTED', 'The booking review request was cancelled. No page state changed.', timestamp, true);
                }
                if (!availability) {
                    return toolError('AVAILABILITY_UNAVAILABLE', 'The place could not be revalidated. Booking review was not opened.', timestamp, true);
                }
                const slot = availability.slots.find((candidate) => candidate.publicId === input.publicSlotId);
                if (!slot) return toolError('SLOT_STALE', 'That place is no longer in current public availability. List the slots again.', timestamp, true);
                if (execution?.signal?.aborted) {
                    return toolError('REQUEST_ABORTED', 'The booking review request was cancelled. No page state changed.', timestamp, true);
                }
                const bridge = getBridge();
                if (!bridge) return toolError('UI_UNAVAILABLE', 'The shared booking interface is not available on this page.', timestamp);
                const visible = await safelyUseBridge(() => bridge.prepareBookingReview(slot));
                if (!visible) return toolError('OFFER_UNAVAILABLE', 'The existing checkout review cannot be opened on this page.', timestamp);
                return {
                    ok: true,
                    environment: runtimeDisclosure(getAppEnvironment),
                    selectedSlot: serializeSlot(slot, typeof input.timezone === 'string' ? input.timezone : slot.timezoneName),
                    checkoutState: availability.checkoutEnabled ? 'open' : 'closed',
                    visibleInPage: true,
                    nextHumanSteps: availability.checkoutEnabled
                        ? ['sign_in_if_required', 'review_terms', 'complete_security_check', 'authorize_payment']
                        : ['review_checkout_closed_notice'],
                    source: availabilitySource(getPageUrl, timestamp),
                };
            },
        },
        {
            name: 'clear_booking_draft',
            description: 'Clear the editable learning brief, close the visible booking review, and restore the neutral page. This creates no server effect.',
            inputSchema: {
                type: 'object',
                properties: {},
                additionalProperties: false,
            },
            annotations: { readOnlyHint: false },
            execute: async (input, execution) => {
                const inactive = requireActive();
                if (inactive) return inactive;
                const timestamp = observedAt(now);
                if (!noInput(input)) return toolError('INVALID_INPUT', 'This tool does not accept input.', timestamp);
                if (execution?.signal?.aborted) {
                    return toolError('REQUEST_ABORTED', 'The clear action was cancelled. No page state changed.', timestamp, true);
                }
                const bridge = getBridge();
                if (!bridge) return toolError('UI_UNAVAILABLE', 'There is no shared booking state to clear on this page.', timestamp);
                const cleared = await safelyUseBridge(() => bridge.clearBookingDraft());
                if (!cleared) return toolError('UI_UNAVAILABLE', 'The page state could not be cleared.', timestamp);
                return {
                    ok: true,
                    environment: runtimeDisclosure(getAppEnvironment),
                    cleared: true,
                    visibleInPage: true,
                    observedAt: timestamp,
                };
            },
        },
    ];
}

interface RegistrationEntry {
    context: WebMcpModelContext;
    controller: AbortController;
    bridge: AcademyWebMcpBridge;
    active: boolean;
    references: number;
    tools: WebMcpToolDefinition[];
    ready: Promise<void>;
}

const registrations = new WeakMap<object, RegistrationEntry>();

function registerToolOnDocument(
    document: WebMcpDocumentLike,
    expectedContext: WebMcpModelContext,
    tool: WebMcpToolDefinition,
    signal: AbortSignal,
) {
    if (document.modelContext !== expectedContext) {
        throw new Error('document.modelContext changed during WebMCP registration');
    }
    return document.modelContext.registerTool(tool, { signal });
}

function registrationHandle(entry: RegistrationEntry): AcademyWebMcpRegistration {
    let released = false;
    return {
        supported: true,
        toolNames: ACADEMY_WEBMCP_TOOL_NAMES,
        release: async () => {
            if (released) return;
            released = true;
            entry.references = Math.max(0, entry.references - 1);
            await Promise.resolve();
            if (entry.references > 0) return;

            entry.active = false;
            await entry.ready.catch(() => undefined);
            if (entry.references > 0) {
                entry.active = true;
                return;
            }
            entry.controller.abort();
            registrations.delete(entry.context as object);
        },
    };
}

export async function registerAcademyWebMcpTools({
    document,
    bridge,
    loadAvailability,
    now,
}: RegisterAcademyWebMcpToolsOptions): Promise<AcademyWebMcpRegistration> {
    const context = document.modelContext;
    if (!context || typeof context.registerTool !== 'function') {
        return {
            supported: false,
            toolNames: [],
            release: async () => undefined,
        };
    }

    const existing = registrations.get(context as object);
    if (existing) {
        existing.bridge = bridge;
        existing.active = true;
        existing.references += 1;
        await existing.ready;
        return registrationHandle(existing);
    }

    const entry: RegistrationEntry = {
        context,
        controller: new AbortController(),
        bridge,
        active: true,
        references: 1,
        tools: [],
        ready: Promise.resolve(),
    };
    registrations.set(context as object, entry);
    const initialAppEnvironment = document.documentElement?.dataset?.appEnvironment;
    entry.tools = createAcademyWebMcpTools({
        getBridge: () => (entry.active ? entry.bridge : null),
        isActive: () => entry.active,
        ...(loadAvailability ? { loadAvailability } : {}),
        ...(now ? { now } : {}),
        getPageUrl: () => document.location?.href ?? 'https://localhost/',
        getAppEnvironment: () => initialAppEnvironment,
    });
    entry.ready = (async () => {
        try {
            for (const tool of entry.tools) {
                await registerToolOnDocument(document, context, tool, entry.controller.signal);
            }
        } catch (error) {
            entry.active = false;
            entry.controller.abort();
            registrations.delete(context as object);
            throw error;
        }
    })();
    await entry.ready;
    return registrationHandle(entry);
}
