import * as Sentry from '@sentry/astro';

const SAFE_IDENTIFIER = /^[A-Za-z0-9_.:-]{1,100}$/;

function safeIdentifier(value: string | undefined, fallback: string): string {
    return value && SAFE_IDENTIFIER.test(value) ? value : fallback;
}

function safeErrorCode(error: unknown, fallback: string): string {
    if (typeof error === 'object' && error !== null && 'code' in error) {
        const code = (error as { code?: unknown }).code;
        if (typeof code === 'string') return safeIdentifier(code, fallback);
    }
    return fallback;
}

function safeStackError(surface: string, code: string, error: unknown): Error {
    const sanitized = new Error(`Operational failure: ${surface}:${code}`);
    if (error instanceof Error && error.stack) {
        const frames = error.stack.split('\n').slice(1).join('\n');
        if (frames) sanitized.stack = `${sanitized.name}: ${sanitized.message}\n${frames}`;
    }
    return sanitized;
}

export function reportOperationalFailure(input: {
    surface: string;
    error?: unknown;
    code?: string;
    requestId?: string;
}): void {
    const surface = safeIdentifier(input.surface, 'unknown');
    const code = safeIdentifier(
        input.code,
        safeErrorCode(input.error, 'UNCLASSIFIED_FAILURE'),
    );
    const requestId = safeIdentifier(input.requestId, 'unavailable');

    console.error(JSON.stringify({
        event: 'operational_failure',
        surface,
        code,
        requestId,
    }));

    if (!Sentry.isEnabled()) return;
    Sentry.withScope((scope) => {
        scope.setLevel('error');
        scope.setTag('operational.surface', surface);
        scope.setTag('operational.code', code);
        scope.setTag('request_id', requestId);
        Sentry.captureException(safeStackError(surface, code, input.error));
    });
}
