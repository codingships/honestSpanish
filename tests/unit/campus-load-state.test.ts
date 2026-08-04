import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    reportCampusReadError,
    resolveCampusCollectionQuery,
    resolveOptionalCampusQuery,
    resolveRequiredCampusQuery,
} from '../../src/lib/campus-load-state';

describe('campus load state', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('resolves a required row without changing its data', () => {
        const profile = { id: 'profile-1', role: 'student' };

        expect(resolveRequiredCampusQuery({ data: profile, error: null })).toEqual({
            status: 'ready',
            data: profile,
            error: null,
        });
    });

    it('keeps a missing required row distinct from a query error', () => {
        expect(resolveRequiredCampusQuery({ data: null, error: null })).toEqual({
            status: 'empty',
            data: null,
            error: null,
        });

        const error = { code: 'PGRST500', message: 'private detail' };
        expect(resolveRequiredCampusQuery({ data: null, error })).toEqual({
            status: 'error',
            data: null,
            error,
        });
    });

    it('represents an absent optional row as empty', () => {
        expect(resolveOptionalCampusQuery({ data: null, error: null })).toEqual({
            status: 'empty',
            data: null,
            error: null,
        });
    });

    it('does not expose partial optional data when Supabase also returned an error', () => {
        const error = { code: '42501', message: 'permission denied' };

        expect(resolveOptionalCampusQuery({
            data: { id: 'untrusted-row' },
            error,
        })).toEqual({
            status: 'error',
            data: null,
            error,
        });
    });

    it('distinguishes empty and failed collections', () => {
        expect(resolveCampusCollectionQuery({ data: [], error: null })).toEqual({
            status: 'empty',
            data: [],
            error: null,
        });

        const error = { code: 'PGRST_TIMEOUT' };
        expect(resolveCampusCollectionQuery({ data: null, error })).toEqual({
            status: 'error',
            data: null,
            error,
        });

        expect(resolveCampusCollectionQuery({ data: null, error: null })).toEqual({
            status: 'error',
            data: null,
            error: { code: 'CAMPUS_COLLECTION_DATA_MISSING' },
        });
    });

    it('keeps a non-empty collection ready', () => {
        const sessions = [{ id: 'session-1' }];

        expect(resolveCampusCollectionQuery({ data: sessions, error: null })).toEqual({
            status: 'ready',
            data: sessions,
            error: null,
        });
    });

    it('logs only safe stable identifiers instead of partially exposing unsafe values', () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

        reportCampusReadError(
            'subscription student@example.com',
            {
                code: 'PGRST 500/alice@example.com',
                message: 'query failed for alice@example.com',
                details: 'select * from profiles_private',
            },
        );

        expect(consoleError).toHaveBeenCalledOnce();
        expect(JSON.parse(String(consoleError.mock.calls[0]?.[0]))).toEqual({
            event: 'operational_failure',
            surface: 'campus.unknown',
            code: 'unknown',
            requestId: 'unavailable',
        });

        const serializedCall = JSON.stringify(consoleError.mock.calls[0]);
        expect(serializedCall).not.toContain('query failed for');
        expect(serializedCall).not.toContain('profiles_private');
        expect(serializedCall).not.toContain('example.com');
    });

    it('preserves safe surface and Supabase codes', () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

        reportCampusReadError('student_dashboard.subscription', { code: 'PGRST116' });

        expect(JSON.parse(String(consoleError.mock.calls[0]?.[0]))).toEqual({
            event: 'operational_failure',
            surface: 'campus.student_dashboard.subscription',
            code: 'PGRST116',
            requestId: 'unavailable',
        });
    });

    it('uses a stable unknown code and ignores absent errors', () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

        reportCampusReadError('', new Error('secret message'));
        reportCampusReadError('session', null);

        expect(consoleError).toHaveBeenCalledOnce();
        expect(JSON.parse(String(consoleError.mock.calls[0]?.[0]))).toEqual({
            event: 'operational_failure',
            surface: 'campus.unknown',
            code: 'unknown',
            requestId: 'unavailable',
        });
    });
});
