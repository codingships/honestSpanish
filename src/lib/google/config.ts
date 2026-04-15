/**
 * Google APIs Configuration
 * Centralized configuration for Google Drive and Calendar APIs
 */

// Fallback loader to support both Astro and raw Node.js
const getEnv = (key: string): string => {
    if (typeof process !== 'undefined' && process.env[key]) return process.env[key] as string;
    if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env[key]) return import.meta.env[key];
    return '';
};

export const googleConfig = {
    // Service Account credentials
    serviceAccountEmail: getEnv('GOOGLE_SERVICE_ACCOUNT_EMAIL') || '',
    serviceAccountPrivateKey: (getEnv('GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY') || '').replace(/\\n/g, '\n'),

    // Admin email to impersonate (owner of all resources)
    adminEmail: getEnv('GOOGLE_ADMIN_EMAIL') || 'alejandro@espanolhonesto.com',

    // Drive configuration
    driveRootFolderId: getEnv('GOOGLE_DRIVE_ROOT_FOLDER_ID') || '',
    templateDocId: getEnv('GOOGLE_TEMPLATE_DOC_ID') || '',

    // OAuth Scopes
    scopes: [
        'https://www.googleapis.com/auth/drive',
        'https://www.googleapis.com/auth/calendar',
        'https://www.googleapis.com/auth/calendar.events',
        'https://www.googleapis.com/auth/documents',
    ],
};

/**
 * Validate that all required Google config is present
 */
export function validateGoogleConfig(): { valid: boolean; missing: string[] } {
    const required = [
        { key: 'serviceAccountEmail', env: 'GOOGLE_SERVICE_ACCOUNT_EMAIL' },
        { key: 'serviceAccountPrivateKey', env: 'GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY' },
        { key: 'adminEmail', env: 'GOOGLE_ADMIN_EMAIL' },
    ];

    const missing: string[] = [];

    for (const { key, env } of required) {
        if (!googleConfig[key as keyof typeof googleConfig]) {
            missing.push(env);
        }
    }

    return { valid: missing.length === 0, missing };
}
