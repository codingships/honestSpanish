/// <reference path="../.astro/types.d.ts" />
/// <reference types="astro/client" />

interface ImportMetaEnv {
    readonly PUBLIC_SITE_URL?: string;
    readonly PUBLIC_URL?: string;
    readonly SITE?: string;
    readonly EMAIL_FROM?: string;
    readonly RESEND_FROM_EMAIL?: string;
    readonly ADMIN_EMAIL?: string;
    readonly PUBLIC_TURNSTILE_SITE_KEY: string;
    readonly TURNSTILE_SECRET_KEY: string;
}

interface ImportMeta {
    readonly env: ImportMetaEnv;
}
