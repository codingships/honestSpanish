/// <reference path="../.astro/types.d.ts" />
/// <reference types="astro/client" />

interface ImportMetaEnv {
    readonly DEV: boolean;
    readonly MODE: string;
    readonly PUBLIC_SITE_URL?: string;
    readonly PUBLIC_URL?: string;
    readonly SITE?: string;
    readonly EMAIL_FROM?: string;
    readonly RESEND_FROM_EMAIL?: string;
    readonly ADMIN_EMAIL?: string;
    readonly SUPPORT_ALERT_EMAIL?: string;
    readonly TEST_STUDENT_EMAIL?: string;
    readonly TEST_STUDENT_PASSWORD?: string;
    readonly TEST_TEACHER_EMAIL?: string;
    readonly TEST_TEACHER_PASSWORD?: string;
    readonly TEST_ADMIN_EMAIL?: string;
    readonly TEST_ADMIN_PASSWORD?: string;
    readonly DEMO_GUIDE_ENABLED?: string;
    readonly DEMO_GUIDE_LOGIN_ENABLED?: string;
    readonly FULFILLMENT_WORKER_URL?: string;
    readonly INTERNAL_JOB_SERVICE_URL?: string;
    readonly INTERNAL_JOB_SECRET?: string;
    readonly CRON_SECRET?: string;
    readonly PUBLIC_TURNSTILE_SITE_KEY: string;
    readonly TURNSTILE_SECRET_KEY: string;
}

interface ImportMeta {
    readonly env: ImportMetaEnv;
}
