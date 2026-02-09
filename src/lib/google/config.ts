/**
 * Google APIs Configuration
 * Centralized configuration for Google Drive and Calendar APIs
 */

export const googleConfig = {
    // Service Account credentials
    serviceAccountEmail: import.meta.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '',
    serviceAccountPrivateKey: (import.meta.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || '').replace(/\\n/g, '\n'),

    // Admin email to impersonate (owner of all resources)
    adminEmail: import.meta.env.GOOGLE_ADMIN_EMAIL || 'alejandro@espanolhonesto.com',

    // Drive configuration
    driveRootFolderId: import.meta.env.GOOGLE_DRIVE_ROOT_FOLDER_ID || '',
    templateDocId: import.meta.env.GOOGLE_TEMPLATE_DOC_ID || '',

    // OAuth Scopes
    scopes: [
        'https://www.googleapis.com/auth/drive',
        'https://www.googleapis.com/auth/calendar',
        'https://www.googleapis.com/auth/calendar.events',
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
