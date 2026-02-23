import * as Sentry from "@sentry/astro";
import type { APIRoute } from "astro";

export const GET: APIRoute = async () => {
    try {
        throw new Error("🚀 Sentry Test Error from Astro + Cloudflare");
    } catch (e) {
        Sentry.captureException(e);

        // IMPORTANT for Cloudflare Workers: await flush to ensure sending before the process goes idle
        await Sentry.flush(2000);

        return new Response(
            JSON.stringify({
                message: "Test error sent to Sentry. Check your dashboard.",
                success: true
            }),
            {
                status: 200,
                headers: {
                    "Content-Type": "application/json"
                }
            }
        );
    }
};
