import type { APIContext } from 'astro';

type WaitUntilFn = (promise: Promise<unknown>) => void;
type RuntimeLocals = {
    runtime?: { ctx?: { waitUntil?: WaitUntilFn } };
};

function getWaitUntil(context: APIContext): WaitUntilFn | null {
    const runtime = (context.locals as RuntimeLocals | undefined)?.runtime;

    return runtime?.ctx?.waitUntil ?? null;
}

export function runAfterResponse(context: APIContext, work: Promise<unknown>): void {
    const guardedWork = work.catch((error) => {
        console.error('[Background] Unhandled background task error:', error);
    });

    const waitUntil = getWaitUntil(context);
    if (waitUntil) {
        waitUntil(guardedWork);
        return;
    }

    void guardedWork;
}
