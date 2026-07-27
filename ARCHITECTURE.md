# Arquitectura

## Contrato vigente

La aplicación es un monolito modular Astro con Supabase como sistema de datos. La topología de ejecución depende del entorno:

- **Producción canónica:** Cloudflare Pages, proyecto `espanolhonesto`.
- **Staging canónico:** Worker web `espanolhonesto-staging`, Worker de fulfillment `espanol-honesto-fulfillment-staging` y Queue `espanol-honesto-fulfillment-staging-queue`, con su DLQ.
- Los Workers y colas de producción que todavía existen en Cloudflare están reservados y fuera de alcance. No son arquitectura vigente, fallback ni ruta de migración desde Pages.

Los identificadores concretos y las reglas de acceso están en `docs/ENVIRONMENTS.md`. Cambiar la topología de producción requiere una decisión nueva, configuración nueva y autorización explícita.

## Aplicación

Astro contiene:

- Web pública ES/EN/RU.
- Campus de alumno, profesor y administración.
- Auth SSR y RBAC con Supabase.
- API transaccional para CRM, reservas, cancelaciones, checkout y webhooks.
- Creación de trabajos duraderos en `fulfillment_jobs`.
- Contenido, blog, RSS e imágenes sociales.

Los límites principales son:

- Auth y RBAC: `src/middleware.ts`, clientes Supabase SSR y `profiles.role`.
- Billing: `checkout_intents`, `package_prices`, Stripe Checkout y webhooks.
- Scheduling: `sessions`, disponibilidad y cuotas.
- Fulfillment: `fulfillment_jobs`, Google Workspace y Resend.
- Administración: CRM, usuarios, ofertas, pagos, sesiones y recuperación operativa.

Las rutas de `src/pages/api/**` no importan directamente implementaciones de Google ni el procesador de jobs. Acceden a esos efectos mediante la capa de servicio interna.

## Fulfillment de staging

El Worker de fulfillment expone operaciones internas autenticadas con `INTERNAL_JOB_SECRET`. El Worker web lo invoca mediante el binding privado `FULFILLMENT_SERVICE`; `FULFILLMENT_WORKER_URL` queda para desarrollo local y comprobaciones explícitas.

En staging, una petición de procesamiento publica una señal `process_due` en la Queue. Supabase `fulfillment_jobs` sigue siendo la fuente de verdad; la Queue no contiene el estado contractual del trabajo. El consumidor procesa con concurrencia limitada y envía los mensajes agotados a la DLQ.

Esta topología describe staging. No implica que producción Pages use actualmente esos Workers o colas.

## Datos

La cadena de cambios de base de datos es `supabase/migrations/`. `db/schema.sql` representa el esquema desplegable acumulado y `src/types/database.types.ts` se genera desde el Supabase de staging, que contiene el superset actual.

Tablas centrales:

- `profiles`, `profiles_private`
- `packages`, `package_prices`, `checkout_intents`
- `subscriptions`, `payments`
- `sessions`, `student_teachers`
- `leads`
- `fulfillment_jobs`
- `processed_webhook_events`
- `admin_audit_log`

RLS protege el acceso por rol. Las operaciones administrativas y de fulfillment usan la service role únicamente en código server-only.

## Integraciones

- Stripe ejecuta cobros; `package_prices` conserva la oferta contractual inmutable.
- Google Workspace aporta Drive, Docs, Calendar y Meet mediante una service account con delegación de dominio.
- Resend envía correo transaccional.
- Turnstile protege formularios públicos.
- Sentry registra errores técnicos según el entorno.

Cada entorno usa sus propios recursos y credenciales. Un recurso de otro proyecto o de otro entorno nunca se usa como sustituto.
