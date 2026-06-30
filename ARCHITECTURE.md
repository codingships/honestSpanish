# Arquitectura

## Principio

Modular monolith pragmatico: una app Astro para web/API transaccional y un Cloudflare Worker separado para jobs operativos. La prioridad es mantener limites claros por dominio sin redisenar todo el stack de golpe.

## Runtimes

### Cloudflare Pages

Responsable de:

- Web publica ES/EN/RU.
- Campus student/teacher/admin.
- Auth SSR con Supabase.
- API transaccional: checkout, webhook Stripe, CRM, reservas, cancelaciones.
- Encolar trabajo en `fulfillment_jobs`.
- Delegar disponibilidad/Drive/Docs/Calendar/Resend al Cloudflare Fulfillment Worker.

Regla: `src/pages/api/**` no debe importar `src/lib/google/**` ni `src/lib/fulfillment/jobs.ts`.

### Cloudflare Fulfillment Worker

Paquete: `workers/fulfillment`.

Responsable de:

- `POST /internal/jobs/process`
- `POST /internal/reminders/send`
- `POST /internal/google/availability`
- `POST /internal/google/filter-available-slots`
- `POST /internal/drive/append-homework`
- `POST /internal/account/link-google-drive`
- `POST /internal/google/create-student-folder`
- `GET /health`

Todas las rutas internas requieren `Authorization: Bearer INTERNAL_JOB_SECRET`.

## Dominios

- Auth/RBAC: `src/middleware.ts`, Supabase SSR client y `profiles.role`.
- Billing: Stripe checkout/webhook, `packages`, `subscriptions`, `payments`.
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

1. Usuario autenticado inicia checkout.
2. Stripe webhook crea `subscription` y `payment`.
3. Webhook encola `welcome_fulfillment`.
4. Cloudflare Fulfillment Worker crea carpeta Drive y envia bienvenida.

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

Supabase `packages` es la fuente runtime. El CRM admin sincroniza Stripe.

Regla comercial actual:

- Cambios de precio/cuota afectan solo a nuevas compras.
- Stripe Price IDs son inmutables.
- Al cambiar precio, se limpian Price IDs y el paquete deja de estar checkout-ready hasta sincronizar.

## Google Workspace

Decision vigente: mantener service account con domain-wide delegation.

Decision vigente: mantener acceso Drive "anyone with link" para reducir friccion operativa. Cuando el alumno vincula una cuenta Google se puede anadir permiso directo, pero no se revoca automaticamente el acceso por enlace mientras esta decision siga vigente.

Meet no se corta automaticamente. Las duraciones comerciales disponibles son 30, 40 y 50 minutos; la duracion por defecto es 50 minutos y se usa para agenda/disponibilidad.

## Entornos

Debe haber staging y produccion separados:

- Cloudflare Pages.
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
