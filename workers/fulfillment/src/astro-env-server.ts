/**
 * Worker-compatible implementation for the Astro runtime-secret module.
 *
 * The fulfillment Worker shares server libraries with the Astro Worker, but it
 * is bundled directly by Wrangler. With `nodejs_compat` and this Worker's
 * compatibility date, Cloudflare exposes text vars and secrets through
 * `process.env`, so the shared runtime-env helper can keep one API at both
 * runtime boundaries without copying secrets into mutable global state.
 */
export function getSecret(key: string): string | undefined {
    const value = process.env[key];
    return value === '' ? undefined : value;
}
