export {};

declare global {
    type JsonBody = {
        error?: string;
        success?: boolean;
        quotaRestored?: boolean;
        quotaConsumed?: boolean;
        session?: { id?: string };
        result?: unknown;
        job?: unknown;
        teachers?: unknown;
        students?: unknown;
    };
}
