import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const resendMock = vi.hoisted(() => ({
    constructor: vi.fn(function ResendClient(this: { apiKey: string; emails: { send: ReturnType<typeof vi.fn> } }, apiKey: string) {
        this.apiKey = apiKey;
        this.emails = { send: vi.fn() };
    }),
}));

const runtimeEnvMock = vi.hoisted(() => ({
    readRuntimeEnv: vi.fn(),
}));

vi.mock('resend', () => ({
    Resend: resendMock.constructor,
}));

vi.mock('../../src/lib/runtime-env', () => runtimeEnvMock);

describe('email and Google runtime config helpers', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.resetModules();
        runtimeEnvMock.readRuntimeEnv.mockReturnValue(undefined);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('getEmailFrom prefers EMAIL_FROM, then RESEND_FROM_EMAIL, then the branded fallback', async () => {
        const { getEmailFrom } = await import('../../src/lib/email/client');

        runtimeEnvMock.readRuntimeEnv.mockImplementation((key: string) => (
            key === 'EMAIL_FROM' ? 'Primary <primary@example.com>' : 'Secondary <secondary@example.com>'
        ));
        expect(getEmailFrom()).toBe('Primary <primary@example.com>');

        runtimeEnvMock.readRuntimeEnv.mockImplementation((key: string) => (
            key === 'RESEND_FROM_EMAIL' ? 'Secondary <secondary@example.com>' : undefined
        ));
        expect(getEmailFrom()).toBe('Secondary <secondary@example.com>');

        runtimeEnvMock.readRuntimeEnv.mockReturnValue(undefined);
        expect(getEmailFrom()).toBe('Español Honesto <alejandro@espanolhonesto.com>');
    });

    it('getResend caches by API key and warns once when missing', async () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const { getResend } = await import('../../src/lib/email/client');

        runtimeEnvMock.readRuntimeEnv.mockReturnValue(undefined);
        const first = getResend();
        const second = getResend();
        expect(first).toBe(second);
        expect(resendMock.constructor).toHaveBeenCalledTimes(1);
        expect(resendMock.constructor).toHaveBeenCalledWith('dummy_key');
        expect(warnSpy).toHaveBeenCalledTimes(1);

        runtimeEnvMock.readRuntimeEnv.mockReturnValue('real-key');
        const third = getResend();
        expect(third).not.toBe(first);
        expect(resendMock.constructor).toHaveBeenLastCalledWith('real-key');
    });

    it('normalizes Google private-key newlines and validates required config', async () => {
        const fakePrivateKey = ['-----BEGIN ', 'PRIVATE KEY-----\\nabc\\n-----END ', 'PRIVATE KEY-----'].join('');
        runtimeEnvMock.readRuntimeEnv.mockImplementation((key: string) => ({
            GOOGLE_SERVICE_ACCOUNT_EMAIL: 'service@example.iam.gserviceaccount.com',
            GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: fakePrivateKey,
            GOOGLE_ADMIN_EMAIL: 'admin@example.com',
            GOOGLE_DRIVE_ROOT_FOLDER_ID: 'drive-root',
            GOOGLE_TEMPLATE_DOC_ID: 'template-doc',
        })[key]);

        const { getGoogleConfig, validateGoogleConfig } = await import('../../src/lib/google/config');
        const config = getGoogleConfig();

        expect(config.serviceAccountPrivateKey).toContain('\nabc\n');
        expect(config.adminEmail).toBe('admin@example.com');
        expect(config.scopes).toEqual(expect.arrayContaining([
            'https://www.googleapis.com/auth/drive',
            'https://www.googleapis.com/auth/calendar.events',
            'https://www.googleapis.com/auth/documents',
        ]));
        expect(validateGoogleConfig(config)).toEqual({ valid: true, missing: [] });
    });

    it('fails closed when required Google runtime fields are missing', async () => {
        const { getGoogleConfig, validateGoogleConfig } = await import('../../src/lib/google/config');

        const runtimeConfig = getGoogleConfig();
        expect(runtimeConfig.adminEmail).toBe('');

        expect(validateGoogleConfig({
            serviceAccountEmail: '',
            serviceAccountPrivateKey: '',
            adminEmail: '',
            driveRootFolderId: '',
            templateDocId: '',
            scopes: [],
        })).toEqual({
            valid: false,
            missing: [
                'GOOGLE_SERVICE_ACCOUNT_EMAIL',
                'GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY',
                'GOOGLE_ADMIN_EMAIL',
                'GOOGLE_DRIVE_ROOT_FOLDER_ID',
                'GOOGLE_TEMPLATE_DOC_ID',
            ],
        });
    });

    it('summarizes Google provider errors without forwarding sensitive messages', async () => {
        const { describeGoogleError } = await import('../../src/lib/google/logging');
        const error = Object.assign(
            new Error('teacher@example.com https://meet.google.com/secret file-id-123'),
            { response: { status: 403 } },
        );

        const summary = describeGoogleError(error);

        expect(summary).toBe('Error (status 403)');
        expect(summary).not.toContain('teacher@example.com');
        expect(summary).not.toContain('meet.google.com');
        expect(summary).not.toContain('file-id-123');
    });

    it('does not interpolate Google identifiers or personal data into provider logs', () => {
        const files = [
            'auth.ts',
            'calendar.ts',
            'class-document.ts',
            'drive.ts',
            'student-folder.ts',
        ];
        const logCalls = files.flatMap((file) => {
            const source = readFileSync(path.join(process.cwd(), 'src', 'lib', 'google', file), 'utf8');
            return source.match(/console\.(?:log|warn|error)\([\s\S]*?\);/g) ?? [];
        }).join('\n');

        expect(logCalls).not.toMatch(/\$\{[^}]*(?:email|name|link|id|summary)[^}]*\}/i);
        expect(logCalls).not.toContain('.message');
        expect(logCalls).not.toMatch(/,\s*(?:error|indexError)\s*\)/);
    });
});
