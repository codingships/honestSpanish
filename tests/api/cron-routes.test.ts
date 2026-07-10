import { beforeEach, describe, expect, it, vi } from 'vitest';

const internalJobServiceMock = vi.hoisted(() => ({
    processFulfillmentJobs: vi.fn(),
    sendDueReminders: vi.fn(),
}));

const runtimeEnvMock = vi.hoisted(() => ({
    readRuntimeEnv: vi.fn(),
}));

vi.mock('../../src/lib/internal-job-service', () => internalJobServiceMock);

vi.mock('../../src/lib/runtime-env', () => runtimeEnvMock);

const makeContext = (authorization?: string) => ({
    request: {
        headers: {
            get: vi.fn((header: string) => header.toLowerCase() === 'authorization' ? authorization ?? null : null),
        },
        url: 'http://localhost:4321/api/cron/test',
    },
    locals: { runtime: { env: {} } },
});

describe('cron API routes', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.resetModules();
        runtimeEnvMock.readRuntimeEnv.mockReturnValue('cron-secret');
        internalJobServiceMock.sendDueReminders.mockResolvedValue({ success: true, sent: 2 });
        internalJobServiceMock.processFulfillmentJobs.mockResolvedValue({ success: true, processed: 3 });
    });

    it('send-reminders fails closed when CRON_SECRET is missing', async () => {
        runtimeEnvMock.readRuntimeEnv.mockReturnValue('');

        const { GET } = await import('../../src/pages/api/cron/send-reminders');
        const response = await GET(makeContext('Bearer cron-secret') as any);

        expect(response.status).toBe(500);
        await expect(response.json()).resolves.toEqual({ error: 'Server misconfiguration' });
        expect(internalJobServiceMock.sendDueReminders).not.toHaveBeenCalled();
    });

    it('send-reminders rejects invalid bearer tokens before calling the worker client', async () => {
        const { GET } = await import('../../src/pages/api/cron/send-reminders');
        const response = await GET(makeContext('Bearer wrong') as any);

        expect(response.status).toBe(401);
        await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' });
        expect(internalJobServiceMock.sendDueReminders).not.toHaveBeenCalled();
    });

    it('send-reminders delegates with valid cron auth and maps service failures to 503', async () => {
        const { GET, POST } = await import('../../src/pages/api/cron/send-reminders');
        const context = makeContext('Bearer cron-secret');
        const response = await GET(context as any);

        expect(POST).toBe(GET);
        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({ success: true, sent: 2 });
        expect(internalJobServiceMock.sendDueReminders).toHaveBeenCalledWith(context);

        internalJobServiceMock.sendDueReminders.mockRejectedValue(new Error('worker down'));
        const failed = await GET(makeContext('Bearer cron-secret') as any);
        expect(failed.status).toBe(503);
        await expect(failed.json()).resolves.toEqual({
            success: false,
            error: 'Internal reminder service failed',
        });
    });

    it('process-fulfillment rejects missing or invalid cron auth', async () => {
        const { POST } = await import('../../src/pages/api/cron/process-fulfillment');

        runtimeEnvMock.readRuntimeEnv.mockReturnValueOnce('');
        expect((await POST(makeContext('Bearer cron-secret') as any)).status).toBe(401);

        runtimeEnvMock.readRuntimeEnv.mockReturnValueOnce('cron-secret');
        expect((await POST(makeContext('Bearer wrong') as any)).status).toBe(401);

        expect(internalJobServiceMock.processFulfillmentJobs).not.toHaveBeenCalled();
    });

    it('process-fulfillment delegates with a bounded job limit', async () => {
        const { GET, POST } = await import('../../src/pages/api/cron/process-fulfillment');
        const context = makeContext('Bearer cron-secret');
        const response = await POST(context as any);

        expect(GET).toBe(POST);
        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({ success: true, processed: 3 });
        expect(internalJobServiceMock.processFulfillmentJobs).toHaveBeenCalledWith(context, 20);
    });
});
