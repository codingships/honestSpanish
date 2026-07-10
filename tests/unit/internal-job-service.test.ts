import { afterEach, describe, expect, it, vi } from 'vitest';
import { env as cloudflareEnv } from 'cloudflare:workers';
import {
    callInternalJobService,
    isInternalJobServiceConfigured,
    processFulfillmentJobs,
} from '../../src/lib/internal-job-service';

const mutableCloudflareEnv = cloudflareEnv as unknown as Record<string, unknown>;

const makeContext = (env: Record<string, string | undefined>) => {
    for (const key of [
        'FULFILLMENT_WORKER_URL',
        'INTERNAL_JOB_SERVICE_URL',
        'INTERNAL_JOB_SECRET',
        'CRON_SECRET',
        'PUBLIC_APP_ENV',
    ]) {
        vi.stubEnv(key, env[key] ?? '');
    }

    return { locals: {} };
};

describe('internal job service client', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.unstubAllEnvs();
        vi.restoreAllMocks();
        delete mutableCloudflareEnv.FULFILLMENT_SERVICE;
    });

    it('detects whether service URL and secret are configured', () => {
        expect(isInternalJobServiceConfigured(makeContext({}) as any)).toBe(false);
        expect(isInternalJobServiceConfigured(makeContext({
            FULFILLMENT_WORKER_URL: 'https://jobs.example.com',
            CRON_SECRET: 'cron-only',
        }) as any)).toBe(false);
        expect(isInternalJobServiceConfigured(makeContext({
            FULFILLMENT_WORKER_URL: 'https://jobs.example.com',
            INTERNAL_JOB_SECRET: 'secret',
        }) as any)).toBe(true);
    });

    it('calls the configured service with bearer auth and JSON body', async () => {
        const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
        vi.stubGlobal('fetch', fetchMock);

        const result = await callInternalJobService('/internal/test', { value: 1 }, {
            context: makeContext({
                FULFILLMENT_WORKER_URL: 'https://jobs.example.com/',
                INTERNAL_JOB_SECRET: 'secret',
            }) as any,
        });

        expect(result).toEqual({ ok: true });
        expect(fetchMock).toHaveBeenCalledWith('https://jobs.example.com/internal/test', expect.objectContaining({
            method: 'POST',
            headers: expect.objectContaining({
                Authorization: 'Bearer secret',
                'Content-Type': 'application/json',
            }),
            body: JSON.stringify({ value: 1 }),
        }));
    });

    it('uses the private service binding in hosted environments', async () => {
        const bindingFetch = vi.fn().mockResolvedValue(
            new Response(JSON.stringify({ ok: true }), { status: 200 }),
        );
        mutableCloudflareEnv.FULFILLMENT_SERVICE = { fetch: bindingFetch };
        const publicFetch = vi.fn();
        vi.stubGlobal('fetch', publicFetch);

        await expect(callInternalJobService('/internal/test', { value: 1 }, {
            context: makeContext({
                FULFILLMENT_WORKER_URL: 'https://jobs.example.com',
                INTERNAL_JOB_SECRET: 'secret',
                PUBLIC_APP_ENV: 'staging',
            }) as any,
        })).resolves.toEqual({ ok: true });

        expect(bindingFetch).toHaveBeenCalledWith(
            'https://jobs.example.com/internal/test',
            expect.objectContaining({
                method: 'POST',
                headers: expect.objectContaining({ Authorization: 'Bearer secret' }),
            }),
        );
        expect(publicFetch).not.toHaveBeenCalled();
    });

    it('fails closed in hosted environments when the service binding is missing', async () => {
        const context = makeContext({
            FULFILLMENT_WORKER_URL: 'https://jobs.example.com',
            INTERNAL_JOB_SECRET: 'secret',
            PUBLIC_APP_ENV: 'staging',
        }) as any;

        expect(isInternalJobServiceConfigured(context)).toBe(false);
        await expect(callInternalJobService('/internal/test', {}, { context }))
            .rejects.toThrow('Internal job service binding is not configured');
    });

    it('throws a clear error when the service is not configured', async () => {
        await expect(callInternalJobService('/internal/test', {}, {
            context: makeContext({}) as any,
        })).rejects.toThrow('Internal job service is not configured');
    });

    it('uses API error messages from non-2xx responses', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
            new Response(JSON.stringify({ error: 'Fulfillment worker unavailable' }), { status: 503 })
        ));

        await expect(callInternalJobService('/internal/test', {}, {
            context: makeContext({
                INTERNAL_JOB_SERVICE_URL: 'https://jobs.example.com',
                INTERNAL_JOB_SECRET: 'secret',
            }) as any,
        })).rejects.toThrow('Fulfillment worker unavailable');
    });

    it('uses status fallback when an internal error response is not JSON', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
            new Response('worker crashed', { status: 502 })
        ));

        await expect(callInternalJobService('/internal/test', {}, {
            context: makeContext({
                INTERNAL_JOB_SERVICE_URL: 'https://jobs.example.com',
                INTERNAL_JOB_SECRET: 'secret',
            }) as any,
        })).rejects.toThrow('Internal job service returned 502');
    });

    it('fails clearly when a successful internal response is not JSON', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
            new Response('ok', { status: 200 })
        ));

        await expect(callInternalJobService('/internal/test', {}, {
            context: makeContext({
                FULFILLMENT_WORKER_URL: 'https://jobs.example.com',
                INTERNAL_JOB_SECRET: 'secret',
            }) as any,
        })).rejects.toThrow('Internal job service returned a non-JSON response');
    });

    it('processFulfillmentJobs delegates to the expected endpoint', async () => {
        const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ processed: 2 }), { status: 200 }));
        vi.stubGlobal('fetch', fetchMock);

        await expect(processFulfillmentJobs(makeContext({
            FULFILLMENT_WORKER_URL: 'https://jobs.example.com',
            INTERNAL_JOB_SECRET: 'secret',
        }) as any, 2)).resolves.toEqual({ processed: 2 });

        expect(fetchMock).toHaveBeenCalledWith('https://jobs.example.com/internal/jobs/process', expect.objectContaining({
            body: JSON.stringify({ limit: 2 }),
        }));
    });
});
