/**
 * Google APIs Configuration
 * Centralized configuration for Google Drive and Calendar APIs
 */
import { readRuntimeEnv } from '../runtime-env';

export interface GoogleConfig {
    serviceAccountEmail: string;
    serviceAccountPrivateKey: string;
    adminEmail: string;
    driveRootFolderId: string;
    templateDocId: string;
    scopes: string[];
}

export function getGoogleConfig(): GoogleConfig {
    return {
        // Service Account credentials
        serviceAccountEmail: readRuntimeEnv('GOOGLE_SERVICE_ACCOUNT_EMAIL') || '',
        serviceAccountPrivateKey: (readRuntimeEnv('GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY') || '').replace(/\\n/g, '\n'),

        // Admin email to impersonate (owner of all resources)
        adminEmail: readRuntimeEnv('GOOGLE_ADMIN_EMAIL') || '',

        // Drive configuration
        driveRootFolderId: readRuntimeEnv('GOOGLE_DRIVE_ROOT_FOLDER_ID') || '',
        templateDocId: readRuntimeEnv('GOOGLE_TEMPLATE_DOC_ID') || '',

        // OAuth Scopes
        scopes: [
            'https://www.googleapis.com/auth/drive',
            'https://www.googleapis.com/auth/calendar',
            'https://www.googleapis.com/auth/calendar.events',
            'https://www.googleapis.com/auth/documents',
        ],
    };
}

export const googleConfig = new Proxy({} as GoogleConfig, {
    get(_target, property) {
        return getGoogleConfig()[property as keyof GoogleConfig];
    },
});

/**
 * Validate that all required Google config is present
 */
export function validateGoogleConfig(config = getGoogleConfig()): { valid: boolean; missing: string[] } {
    const required = [
        { key: 'serviceAccountEmail', env: 'GOOGLE_SERVICE_ACCOUNT_EMAIL' },
        { key: 'serviceAccountPrivateKey', env: 'GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY' },
        { key: 'adminEmail', env: 'GOOGLE_ADMIN_EMAIL' },
        { key: 'driveRootFolderId', env: 'GOOGLE_DRIVE_ROOT_FOLDER_ID' },
        { key: 'templateDocId', env: 'GOOGLE_TEMPLATE_DOC_ID' },
    ];

    const missing: string[] = [];

    for (const { key, env } of required) {
        if (!config[key as keyof GoogleConfig]) {
            missing.push(env);
        }
    }

    return { valid: missing.length === 0, missing };
}
