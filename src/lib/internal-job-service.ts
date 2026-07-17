import type { APIContext } from 'astro';
import { env as cloudflareEnv } from 'cloudflare:workers';
import { runAfterResponse } from './cloudflare-runtime';
import { readRuntimeEnv } from './runtime-env';

type JsonObject = Record<string, unknown>;

type InternalJobServiceOptions = {
    context?: Pick<APIContext, 'locals'>;
    method?: 'GET' | 'POST';
};

type InternalServiceBinding = {
    fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
};

function getServiceBinding(): InternalServiceBinding | null {
    const candidate = (cloudflareEnv as { FULFILLMENT_SERVICE?: unknown }).FULFILLMENT_SERVICE;
    if (!candidate || typeof candidate !== 'object' || !('fetch' in candidate)) {
        return null;
    }

    return typeof (candidate as InternalServiceBinding).fetch === 'function'
        ? candidate as InternalServiceBinding
        : null;
}

function requiresServiceBinding(context?: Pick<APIContext, 'locals'>): boolean {
    const appEnvironment = readRuntimeEnv('PUBLIC_APP_ENV', context);
    return appEnvironment === 'staging' || appEnvironment === 'production';
}

function getServiceUrl(context?: Pick<APIContext, 'locals'>): string | null {
    const value = readRuntimeEnv('FULFILLMENT_WORKER_URL', context)
        ?? readRuntimeEnv('INTERNAL_JOB_SERVICE_URL', context);

    return value ? value.replace(/\/+$/, '') : null;
}

function getInternalSecret(context?: Pick<APIContext, 'locals'>): string | null {
    return readRuntimeEnv('INTERNAL_JOB_SECRET', context) ?? null;
}

export function isInternalJobServiceConfigured(context?: Pick<APIContext, 'locals'>): boolean {
    const baseConfigured = Boolean(getServiceUrl(context) && getInternalSecret(context));
    return baseConfigured && (!requiresServiceBinding(context) || Boolean(getServiceBinding()));
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

    const serviceBinding = getServiceBinding();
    if (!serviceBinding && requiresServiceBinding(options.context)) {
        throw new Error('Internal job service binding is not configured');
    }

    const requestUrl = `${baseUrl}${path}`;
    const requestInit: RequestInit = {
        method: options.method ?? 'POST',
        headers: {
            Authorization: `Bearer ${secret}`,
            'Content-Type': 'application/json',
        },
        body: options.method === 'GET' ? undefined : JSON.stringify(body),
    };
    const response = serviceBinding
        ? await serviceBinding.fetch(requestUrl, requestInit)
        : await fetch(requestUrl, requestInit);

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
