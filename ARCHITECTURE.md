# Arquitectura

## Principio

Modular monolith pragmatico: una app Astro para web/API transaccional y un Cloudflare Worker separado para jobs operativos. La prioridad es mantener limites claros por dominio sin redisenar todo el stack de golpe.

## Runtimes

### Cloudflare Astro Worker

Responsable de:

- Web publica ES/EN/RU.
- Campus student/teacher/admin.
- Auth SSR con Supabase.
- API transaccional: checkout, webhook Stripe, CRM, reservas, cancelaciones.
- Encolar trabajo en `fulfillment_jobs`.
- Delegar disponibilidad/Drive/Docs/Calendar/Resend al Cloudflare Fulfillment Worker.

La delegación desplegada usa el service binding privado `FULFILLMENT_SERVICE`. `FULFILLMENT_WORKER_URL` se mantiene como URL canónica y fallback local, mientras `INTERNAL_JOB_SECRET` autentica cada petición; staging y production no recurren a `fetch()` público entre Workers de la misma cuenta.

Regla: `src/pages/api/**` no debe importar `src/lib/google/**` ni `src/lib/fulfillment/jobs.ts`.

### Cloudflare Fulfillment Worker

Paquete: `workers/fulfillment`.

Responsable de:

- `POST /internal/jobs/process`: en staging publica una senal pequena en Cloudflare Queues y responde sin ejecutar Google/Resend dentro de la ventana HTTP. Production conserva la ejecucion inline hasta que su Queue tenga una aprobacion separada.
- `POST /internal/reminders/send`
- `POST /internal/google/availability`
- `POST /internal/google/filter-available-slots`
- `POST /internal/drive/append-homework`
- `POST /internal/account/link-google-drive`
- `POST /internal/google/create-student-folder`
- `GET /health`

Todas las rutas internas requieren `Authorization: Bearer INTERNAL_JOB_SECRET`.

En staging, `espanol-honesto-fulfillment-staging` produce y consume
`espanol-honesto-fulfillment-staging-queue`; los mensajes agotados pasan a
`espanol-honesto-fulfillment-staging-dlq`. La Queue solo transporta la senal
`process_due`: Supabase `fulfillment_jobs` sigue siendo la fuente de verdad,
con batch y concurrencia limitados a uno para proteger Google, Resend y la base.

## Dominios

- Auth/RBAC: `src/middleware.ts`, Supabase SSR client y `profiles.role`.
- Billing: aprobacion CRM, `checkout_intents`, Stripe Checkout/webhooks, `packages`, `package_prices`, `subscriptions` y `payments`.
- Scheduling: `sessions`, disponibilidad, quotas y acciones de clase.
- Fulfillment: `fulfillment_jobs`, Google Workspace y Resend.
- Notifications: emails transaccionales y recordatorios.
- Admin CRM: usuarios, leads, paquetes, precios, jobs y recuperacion operativa.
- Content/SEO: landing, blog, RSS, OG images.

## Base De Datos

Fuente oficial: `db/schema.sql`.

Tablas clave:

- `profiles`
- `packages`
- `package_prices`
- `checkout_intents`
- `subscriptions`
- `sessions`
- `student_teachers`
- `payments`
- `leads`
- `profiles_private`
- `processed_webhook_events`
- `fulfillment_jobs`
- `admin_audit_log`

Supabase RLS protege datos por rol. Las operaciones admin/worker usan service role y deben quedar en codigo server-only.

## Fulfillment

Flujo de pago:

1. El admin aprueba un paquete concreto en CRM; la web publica siempre mantiene `solicitar plaza`.
2. El alumno autenticado elige 1/3/6 meses y Supabase reclama un unico `checkout_intent` atomico.
3. La app verifica proyecto Supabase, cuenta/modo Stripe y la oferta inmutable antes de crear una unica Checkout Session idempotente.
4. El webhook exige el intent y el Price realmente cobrado, consume la aprobacion y crea `subscription`/`payment` con snapshot contractual.
5. Webhook encola `welcome_fulfillment`, pide procesamiento por Queue y el consumidor del Worker crea Drive y envia la confirmacion contractual fuera del limite HTTP.

Flujo de clase:

1. Teacher/admin crea una clase.
2. Cloudflare valida rol, quota y disponibilidad.
3. Cloudflare inserta `sessions`.
4. Cloudflare encola `session_fulfillment` o `bulk_session_fulfillment`.
5. Cloudflare Fulfillment Worker crea Doc, Calendar, Meet y emails.

Cancelacion:

1. Cloudflare cambia estado y devuelve quota.
2. Cloudflare encola `session_cancellation`.
3. Cloudflare Fulfillment Worker cancela Calendar y envia emails.

## Productos Y Precios

El modelo tiene responsabilidades distintas, no cuatro copias editables:

- `packages`: catalogo comercial editable y proyeccion publica.
- `package_prices`: ofertas 1/3/6 inmutables, con importe, cuota, Product/Price, cuenta y modo; es la fuente contractual de checkout y renovacion.
- Stripe: ejecuta el cobro; cada objeto se verifica contra `package_prices`.
- `packages.stripe_price_*`: punteros denormalizados a las ofertas activas, escritos solo por `activate_package_price`.

El CRM admin sincroniza Stripe en el orden crear/verificar -> activar atomicamente en Supabase -> archivar el Price anterior.

Regla comercial actual:

- Cambios de precio/cuota afectan solo a nuevas compras.
- Stripe Price IDs son inmutables.
- Al cambiar datos contractuales, las ofertas activas se retiran, se limpian punteros y el paquete deja de estar checkout-ready hasta sincronizar las tres duraciones.
- Suscripciones guardan `package_price_id` y `contracted_sessions_per_period`; una edicion futura no cambia contratos existentes.

## Google Workspace

Decision vigente: mantener service account con domain-wide delegation.

Decision vigente: mantener acceso Drive "anyone with link" para reducir friccion operativa. Cuando el alumno vincula una cuenta Google se puede anadir permiso directo, pero no se revoca automaticamente el acceso por enlace mientras esta decision siga vigente.

Meet no se corta automaticamente. Las duraciones comerciales disponibles son 30, 40 y 50 minutos; la duracion por defecto es 50 minutos y se usa para agenda/disponibilidad.

## Entornos

Debe haber staging y produccion separados:

- Cloudflare Astro Worker.
- Cloudflare Fulfillment Worker.
- Supabase con proyectos separados para staging y production dentro de la misma cuenta, sin branching.
- Stripe test/live.
- Google folders/templates.
- Resend sender/domain.
- Sentry environment.

## Calidad

Minimo antes de deploy:

```bash
pnpm typecheck
pnpm fulfillment:typecheck
pnpm lint
pnpm test:run
pnpm build
pnpm secrets:check
```
