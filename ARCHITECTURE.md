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
- Billing: `checkout_intents`, `package_prices`, ciclos Checkout V2, Stripe Checkout y webhooks.
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
- `checkout_v2_billing_state`, `checkout_v2_cycles`
- `checkout_v2_guarantee_operations`, `checkout_v2_session_incident_resolutions`
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

## Garantía del primer ciclo

La garantía de Checkout V2 es una saga financiera duradera, no una suma calculada por el navegador ni una devolución aislada en Stripe. PostgreSQL decide la elegibilidad bajo bloqueo y congela en `checkout_v2_guarantee_operations` la compra, el ciclo inicial, las cuatro sesiones, el PaymentIntent y el importe contractual de 19.425 céntimos. Solo puede existir una operación por suscripción.

El orden irreversible es: validar el contrato local y remoto, cancelar inmediatamente la suscripción de Stripe, reflejar la terminación local e invalidar las sesiones 2–4, y crear la devolución parcial con una clave de idempotencia estable. Los webhooks de refund y `charge.refunded` reconcilian la misma operación; nunca crean una segunda. Los estados pendientes quedan visibles y los resultados ambiguos pasan a revisión manual con ticket de soporte.

Una excepción de soporte a una cancelación tardía o no-show de la segunda sesión se registra por separado en `checkout_v2_session_incident_resolutions`. Ese ledger es inmutable y auditado: reclasifica la incidencia para evaluar la garantía, pero no reabre ni reprograma una clase.

Tras confirmar Stripe la devolución, un único trabajo `guarantee_refund` envía la confirmación transaccional y registra el efecto en CRM. Las cancelaciones de Calendar de las tres sesiones restantes son trabajos deduplicados independientes; un fallo de Google o correo no altera el resultado financiero ya confirmado.
