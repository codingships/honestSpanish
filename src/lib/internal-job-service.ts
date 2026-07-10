import type { APIContext } from 'astro';
import { runAfterResponse } from './cloudflare-runtime';
import { readRuntimeEnv } from './runtime-env';

type JsonObject = Record<string, unknown>;

type InternalJobServiceOptions = {
    context?: Pick<APIContext, 'locals'>;
    method?: 'GET' | 'POST';
};

function getServiceUrl(context?: Pick<APIContext, 'locals'>): string | null {
    const value = readRuntimeEnv('FULFILLMENT_WORKER_URL', context)
        ?? readRuntimeEnv('INTERNAL_JOB_SERVICE_URL', context);

    return value ? value.replace(/\/+$/, '') : null;
}

function getInternalSecret(context?: Pick<APIContext, 'locals'>): string | null {
    return readRuntimeEnv('INTERNAL_JOB_SECRET', context) ?? null;
}

export function isInternalJobServiceConfigured(context?: Pick<APIContext, 'locals'>): boolean {
    return Boolean(getServiceUrl(context) && getInternalSecret(context));
}

export async function callInternalJobService<T = JsonObject>(
    path: string,
    body: JsonObject = {},
    options: InternalJobServiceOptions = {}
): Promise<T> {
    const baseUrl = getServiceUrl(options.context);
    const secret = getInternalSecret(options.context);

    if (!baseUrl || !secret) {
        throw new Error('Internal job service is not configured');
    }

    const response = await fetch(`${baseUrl}${path}`, {
        method: options.method ?? 'POST',
        headers: {
            Authorization: `Bearer ${secret}`,
            'Content-Type': 'application/json',
        },
        body: options.method === 'GET' ? undefined : JSON.stringify(body),
    });

    const text = await response.text();
    let data: JsonObject = {};
    if (text) {
        try {
            data = JSON.parse(text) as JsonObject;
        } catch {
            if (response.ok) {
                throw new Error('Internal job service returned a non-JSON response');
            }
        }
    }

    if (!response.ok) {
        const message =
            'error' in data && typeof data.error === 'string'
                ? data.error
                : `Internal job service returned ${response.status}`;
        throw new Error(message);
    }

    return data as T;
}

export function triggerFulfillmentProcessing(context: APIContext, limit = 20): void {
    if (!isInternalJobServiceConfigured(context)) {
        console.warn('[Fulfillment] Internal job service is not configured; queued jobs will wait');
        return;
    }

    runAfterResponse(
        context,
        callInternalJobService('/internal/jobs/process', { limit }, { context })
            .catch((error) => {
                console.error('[Fulfillment] Could not trigger internal job service:', error);
            })
    );
}

export async function processFulfillmentJobs(context: Pick<APIContext, 'locals'>, limit = 20) {
    return callInternalJobService('/internal/jobs/process', { limit }, { context });
}

export async function sendDueReminders(context: Pick<APIContext, 'locals'>) {
    return callInternalJobService('/internal/reminders/send', {}, { context });
}

export async function checkTeacherAvailabilityViaInternalService(
    context: Pick<APIContext, 'locals'>,
    input: { teacherEmail: string; startTime: string; endTime: string }
): Promise<boolean> {
    const result = await callInternalJobService<{ available: boolean }>(
        '/internal/google/availability',
        input,
        { context }
    );

    return result.available;
}

export async function filterSlotsAgainstGoogleViaInternalService<TSlot extends { slot_start: string; slot_end: string }>(
    context: Pick<APIContext, 'locals'>,
    input: { teacherEmail: string; slots: TSlot[] }
): Promise<TSlot[]> {
    const result = await callInternalJobService<{ slots: TSlot[] }>(
        '/internal/google/filter-available-slots',
        input,
        { context }
    );

    return result.slots;
}
