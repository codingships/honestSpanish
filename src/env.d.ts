/// <reference path="../.astro/types.d.ts" />
/// <reference types="astro/client" />

interface ImportMetaEnv {
    readonly PUBLIC_TURNSTILE_SITE_KEY: string;
    readonly TURNSTILE_SECRET_KEY: string;
}

interface ImportMeta {
    readonly env: ImportMetaEnv;
}
