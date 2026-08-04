import { reportOperationalFailure } from './operational-error';

export type CampusQueryResult<T> = {
    data: T | null;
    error: unknown | null;
};

export type CampusQueryState<T> =
    | { status: 'ready'; data: T; error: null }
    | { status: 'empty'; data: null; error: null }
    | { status: 'error'; data: null; error: unknown };

export type CampusCollectionState<T> =
    | { status: 'ready'; data: T[]; error: null }
    | { status: 'empty'; data: []; error: null }
    | { status: 'error'; data: null; error: unknown };

/**
 * Required rows still expose `empty` separately from a database error so the
 * caller can fail closed without reporting a legitimate missing row as an
 * infrastructure failure.
 */
export function resolveRequiredCampusQuery<T>(
    result: CampusQueryResult<T>,
): CampusQueryState<T> {
    return resolveCampusQuery(result);
}

/**
 * Optional rows use `empty` for the legitimate no-row case. They never turn a
 * Supabase error into an absent business entity.
 */
export function resolveOptionalCampusQuery<T>(
    result: CampusQueryResult<T>,
): CampusQueryState<T> {
    return resolveCampusQuery(result);
}

export function resolveCampusCollectionQuery<T>(
    result: CampusQueryResult<T[]>,
): CampusCollectionState<T> {
    if (result.error !== null) {
        return { status: 'error', data: null, error: result.error };
    }

    if (result.data === null) {
        return {
            status: 'error',
            data: null,
            error: { code: 'CAMPUS_COLLECTION_DATA_MISSING' },
        };
    }

    if (result.data.length === 0) {
        return { status: 'empty', data: [], error: null };
    }

    return { status: 'ready', data: result.data, error: null };
}

function resolveCampusQuery<T>(result: CampusQueryResult<T>): CampusQueryState<T> {
    if (result.error !== null) {
        return { status: 'error', data: null, error: result.error };
    }

    if (result.data === null) {
        return { status: 'empty', data: null, error: null };
    }

    return { status: 'ready', data: result.data, error: null };
}

const SAFE_DIAGNOSTIC_PART = /^[a-zA-Z0-9_.:-]{1,80}$/;

function sanitizeDiagnosticPart(value: string, fallback: string): string {
    return SAFE_DIAGNOSTIC_PART.test(value) ? value : fallback;
}

function readErrorCode(error: unknown): string {
    if (
        typeof error === 'object'
        && error !== null
        && 'code' in error
        && typeof error.code === 'string'
    ) {
        return sanitizeDiagnosticPart(error.code, 'unknown');
    }

    return 'unknown';
}

/**
 * Reports only stable diagnostic identifiers. Error messages, query details,
 * hints and user data are deliberately excluded.
 */
export function reportCampusReadError(surface: string, error: unknown, requestId?: string): void {
    if (error === null || error === undefined) {
        return;
    }

    reportOperationalFailure({
        surface: `campus.${sanitizeDiagnosticPart(surface, 'unknown')}`,
        code: readErrorCode(error),
        error,
        requestId,
    });
}
