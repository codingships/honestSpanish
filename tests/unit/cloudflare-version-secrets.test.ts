import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
    FULFILLMENT_VERSION_SECRET_NAMES,
    WEB_VERSION_SECRET_NAMES,
    writeCloudflareVersionSecrets,
} from '../../scripts/ci/write-cloudflare-version-secrets';

const directories: string[] = [];
const allSecretNames = [...new Set([
    ...WEB_VERSION_SECRET_NAMES,
    ...FULFILLMENT_VERSION_SECRET_NAMES,
])];

function fixture() {
    const runnerTemp = mkdtempSync(join(tmpdir(), 'cloudflare-version-secrets-'));
    directories.push(runnerTemp);
    return {
        env: Object.fromEntries(allSecretNames.map((name) => [name, `value-for-${name}`])),
        outputPath: join(runnerTemp, 'worker.json'),
        role: 'web' as const,
        runnerTemp,
    };
}

afterEach(() => {
    for (const directory of directories.splice(0)) {
        rmSync(directory, { force: true, recursive: true });
    }
});

describe('version-scoped Cloudflare Worker secrets', () => {
    it('writes exact role-specific allowlists without printing or mixing boundaries', () => {
        const webInput = fixture();
        const fulfillmentInput = {
            ...fixture(),
            role: 'fulfillment' as const,
        };

        writeCloudflareVersionSecrets(webInput);
        writeCloudflareVersionSecrets(fulfillmentInput);

        const web = JSON.parse(readFileSync(webInput.outputPath, 'utf8')) as Record<string, string>;
        const fulfillment = JSON.parse(readFileSync(fulfillmentInput.outputPath, 'utf8')) as Record<string, string>;
        expect(Object.keys(web)).toEqual(WEB_VERSION_SECRET_NAMES);
        expect(Object.keys(fulfillment)).toEqual(FULFILLMENT_VERSION_SECRET_NAMES);
        expect(web.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY).toBeUndefined();
        expect(fulfillment.STRIPE_SECRET_KEY).toBeUndefined();
        expect(web.PUBLIC_TURNSTILE_SITE_KEY).toBeUndefined();
        expect(web.STRIPE_EXPECTED_ACCOUNT_ID).toBe('value-for-STRIPE_EXPECTED_ACCOUNT_ID');
        expect(web.EMAIL_FROM).toBeUndefined();
        expect(fulfillment.EMAIL_FROM).toBe('value-for-EMAIL_FROM');
        expect(fulfillment.CRON_SECRET).toBe('value-for-CRON_SECRET');
        expect(fulfillment.SUPPORT_ALERT_EMAIL).toBe('value-for-SUPPORT_ALERT_EMAIL');
        expect(web.STRIPE_SECRET_KEY).toBe('value-for-STRIPE_SECRET_KEY');
        expect(web.CHECKOUT_HOLD_FINGERPRINT_SECRET)
            .toBe('value-for-CHECKOUT_HOLD_FINGERPRINT_SECRET');
        expect(fulfillment.CHECKOUT_HOLD_FINGERPRINT_SECRET).toBeUndefined();
        expect(fulfillment.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY)
            .toBe('value-for-GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY');

        if (process.platform !== 'win32') {
            expect(statSync(webInput.outputPath).mode & 0o777).toBe(0o600);
            expect(statSync(fulfillmentInput.outputPath).mode & 0o777).toBe(0o600);
        }
    });

    it('fails before writing when any required secret is absent', () => {
        const input = fixture();
        delete input.env.LEVEL_CHECK_TOKEN_SECRET;

        expect(() => writeCloudflareVersionSecrets(input)).toThrow(
            'Missing version-scoped Worker secrets: LEVEL_CHECK_TOKEN_SECRET',
        );
        expect(existsSync(input.outputPath)).toBe(false);
    });

    it('refuses a checkout hold fingerprint secret shorter than the runtime minimum', () => {
        const input = fixture();
        input.env.CHECKOUT_HOLD_FINGERPRINT_SECRET = 'too-short';

        expect(() => writeCloudflareVersionSecrets(input)).toThrow(
            'CHECKOUT_HOLD_FINGERPRINT_SECRET must contain at least 32 UTF-8 bytes',
        );
        expect(existsSync(input.outputPath)).toBe(false);
    });

    it('only writes new JSON files directly inside RUNNER_TEMP', () => {
        const input = fixture();

        expect(() => writeCloudflareVersionSecrets({
            ...input,
            runnerTemp: '',
        })).toThrow('RUNNER_TEMP must be an absolute path');
        expect(() => writeCloudflareVersionSecrets({
            ...input,
            outputPath: join(input.runnerTemp, 'nested', 'web.json'),
        })).toThrow('web secrets file must be one JSON file directly inside RUNNER_TEMP');

        writeCloudflareVersionSecrets(input);
        expect(() => writeCloudflareVersionSecrets(input)).toThrow(/EEXIST|file already exists/iu);
    });
});
