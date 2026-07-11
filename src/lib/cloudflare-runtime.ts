import type { APIContext } from 'astro';

type WaitUntilFn = (promise: Promise<unknown>) => void;
type CloudflareLocals = {
    cfContext?: { waitUntil?: WaitUntilFn };
};

function getWaitUntil(context: APIContext): WaitUntilFn | null {
    const cfContext = (context.locals as CloudflareLocals | undefined)?.cfContext;

    return typeof cfContext?.waitUntil === 'function'
        ? cfContext.waitUntil.bind(cfContext)
        : null;
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
