import { isAuthApiError, isAuthSessionMissingError } from '@supabase/supabase-js';

const UNAUTHENTICATED_AUTH_CODES = new Set([
    'bad_jwt',
    'no_authorization',
    'refresh_token_already_used',
    'refresh_token_not_found',
    'session_expired',
    'session_not_found',
    'unexpected_audience',
    'user_banned',
    'user_not_found',
]);

export function isUnauthenticatedAuthError(error: unknown): boolean {
    return isAuthSessionMissingError(error)
        || (
            isAuthApiError(error)
            && (error.status === 401 || error.status === 403)
            && typeof error.code === 'string'
            && UNAUTHENTICATED_AUTH_CODES.has(error.code)
        );
}
