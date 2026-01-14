/**
 * Google Auth with Service Account and Domain-Wide Delegation
 * Impersonates admin email for all API calls
 */

import { JWT } from 'google-auth-library';
import { googleConfig, validateGoogleConfig } from './config';

let cachedClient: JWT | null = null;

/**
 * Get authenticated JWT client with impersonation
 * Uses Service Account with Domain-Wide Delegation
 */
export function getAuthClient(): JWT {
    if (cachedClient) {
        return cachedClient;
    }

    const { valid, missing } = validateGoogleConfig();
    if (!valid) {
        throw new Error(`Missing Google config: ${missing.join(', ')}`);
    }

    try {
        cachedClient = new JWT({
            email: googleConfig.serviceAccountEmail,
            key: googleConfig.serviceAccountPrivateKey,
            scopes: googleConfig.scopes,
            subject: googleConfig.adminEmail, // Impersonate admin
        });

        return cachedClient;
    } catch (error) {
        console.error('[Google Auth] Failed to create JWT client:', error instanceof Error ? error.message : 'Unknown error');
        throw new Error('Failed to initialize Google authentication');
    }
}

/**
 * Clear cached client (useful for testing or credential rotation)
 */
export function clearAuthCache(): void {
    cachedClient = null;
}

/**
 * Test authentication by attempting to get access token
 */
export async function testAuth(): Promise<boolean> {
    try {
        const client = getAuthClient();
        await client.authorize();
        console.log('[Google Auth] Authentication successful');
        return true;
    } catch (error) {
        console.error('[Google Auth] Authentication test failed:', error instanceof Error ? error.message : 'Unknown error');
        return false;
    }
}
