# Environment

No commitear valores reales. Los archivos `.env*` reales estan ignorados por Git; solo se pueden commitear `.env.example` y `.env.*.example`.

## Entornos

| Entorno | Uso | URL | Rama | Datos |
| --- | --- | --- | --- | --- |
| dev | Trabajo local | `http://localhost:4321` | ramas locales | Puede apuntar a staging o a servicios de prueba |
| staging | Pruebas reales antes de publicar | `https://staging.espanolhonesto.com` | `staging` | Datos y servicios de prueba |
| production | Servicio real | `https://espanolhonesto.com` | `main` | Datos, pagos y alumnos reales |

## Filosofia

- El codigo es el mismo entre staging y production.
- Los efectos son distintos: base de datos, Stripe, Google Drive, Resend, Sentry, Cloudflare Worker y secretos por entorno.
- Staging debe parecerse a production, pero no tocar alumnos, pagos, Drive ni emails reales.
- Production se despliega solo tras validar staging.

## Almacenamiento De Secretos

Inventario humano:

- KeePassXC: guardar la base cifrada del proyecto.
- Entradas recomendadas:
  - `Espanol Honesto / Dev`
  - `Espanol Honesto / Staging`
  - `Espanol Honesto / Production`
  - `Espanol Honesto / GitHub CI`
- Guardar tambien fecha de rotacion, origen de la clave y notas de permisos.

Runtime:

- Cloudflare Pages: secretos de la app Astro/SSR.
- Cloudflare Fulfillment Worker: secretos de Google/Resend y jobs internos.
- GitHub Environments: secretos de deploy/CI, no como almacen principal.
- Supabase/Stripe/Google/Resend/Sentry: rotar y consultar claves en su propio panel.

## Rotacion Final De Claves

La rotacion final es una tarea de cierre final, no un bloqueo del Release Candidate. Se ejecuta justo antes de production deploy/Go-No-Go y despues de que legal, copy, SEO/LLM final, Stripe mode y dominios esten decididos.

Checklist operativo:

- Confirmar que KeePassXC tiene entradas separadas para Dev, Staging, Production y GitHub CI.
- Crear claves nuevas en cada proveedor sin copiar valores a docs, tickets, capturas ni outputs.
- Actualizar staging primero cuando sea posible.
- Ejecutar smoke staging y revisar logs.
- Actualizar production.
- Ejecutar `pnpm secrets:check`, `pnpm launch:security`, `pnpm launch:operations`, `pnpm launch:final-readiness` y `pnpm launch:status`.
- Ejecutar smoke production.
- Revocar claves antiguas cuando el smoke pase.
- Registrar solo evidencia no secreta en `docs/launch/MANUAL_EVIDENCE.local.json`.

Inventario de rotacion por entorno:

| Proveedor | Secretos/valores | Donde se consumen | Nota |
| --- | --- | --- | --- |
| Supabase | `PUBLIC_SUPABASE_URL`, `PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_URL` operativo | Cloudflare Pages, Worker, GitHub, migraciones locales | Rotar JWT/keys con ventana de mantenimiento si invalida sesiones. |
| Stripe | `STRIPE_SECRET_KEY`, `PUBLIC_STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`, `CHECKOUT_ENABLED` | Cloudflare Pages, GitHub | Test y live separados; Price IDs no son secretos. `CHECKOUT_ENABLED` debe quedarse `false` salvo decision explicita de aceptar checkout. |
| Cloudflare internals | `FULFILLMENT_WORKER_URL`, `INTERNAL_JOB_SECRET`, `CRON_SECRET` | Pages, Worker, GitHub | `INTERNAL_JOB_SECRET`/`CRON_SECRET` deben ser distintos por entorno. |
| Google | `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`, `GOOGLE_ADMIN_EMAIL`, `GOOGLE_DRIVE_ROOT_FOLDER_ID`, `GOOGLE_TEMPLATE_DOC_ID` | Fulfillment Worker | Crear clave nueva, validar, borrar antigua. |
| Resend | `RESEND_API_KEY`, `EMAIL_FROM`, `RESEND_FROM_EMAIL` | Fulfillment Worker | Validar envio antes de revocar. |
| Turnstile | `PUBLIC_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | Cloudflare Pages | Revisar dominios permitidos si cambia site key. |
| Sentry | `PUBLIC_SENTRY_DSN`, `SENTRY_AUTH_TOKEN`, `SENTRY_UPLOAD_SOURCEMAPS` | App build, GitHub/CI | Token de auth es secreto; DSN es publico pero entorno-especifico. |
| GitHub/Cloudflare deploy | `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | GitHub Environments | Token con permisos minimos y aprobacion production. |

## Cloudflare Pages

Crear dos Pages projects:

- `espanol-honesto-staging`
  - Production branch: `staging`
  - Custom domain: `staging.espanolhonesto.com`
- `espanolhonesto`
  - Production branch: `main`
  - Custom domain: `espanolhonesto.com`

Variables por entorno:

- `PUBLIC_SITE_URL`
- `PUBLIC_APP_ENV`
- `PUBLIC_SUPABASE_URL`
- `PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `PUBLIC_STRIPE_PUBLISHABLE_KEY`
- `CHECKOUT_ENABLED=false` hasta decidir pagos reales o checkout test deliberado.
- `PUBLIC_TURNSTILE_SITE_KEY`
- `TURNSTILE_SECRET_KEY`
- `PUBLIC_SENTRY_DSN`
- `SENTRY_AUTH_TOKEN`
- `SENTRY_UPLOAD_SOURCEMAPS` opcional; solo `true` para subidas locales intencionales. En CI/deploy se permite por `CI=true`.
- `CRON_SECRET`
- `FULFILLMENT_WORKER_URL`
- `INTERNAL_JOB_SECRET`
- `SUPPORT_ALERT_EMAIL` opcional; si falta, soporte usa `ADMIN_EMAIL` y despues `alejandro@espanolhonesto.com`.

Cloudflare Pages no necesita claves Google si ninguna ruta API importa Google SDK.

## Cloudflare Fulfillment Worker

Crear dos Workers desde `workers/fulfillment/wrangler.toml`:

- `espanol-honesto-fulfillment-staging`
  - Health check: `/health`
- `espanol-honesto-fulfillment-production`
  - Health check: `/health`

El Worker declara un cron horario (`0 * * * *`) para procesar jobs pendientes y recordatorios. Las rutas internas siguen disponibles para disparos manuales o desde Cloudflare Pages.

Despliegue:

```bash
pnpm fulfillment:typecheck
pnpm --filter @espanol-honesto/fulfillment-worker run deploy -- --env staging
pnpm --filter @espanol-honesto/fulfillment-worker run deploy -- --env production
```

Variables:

- `PUBLIC_SITE_URL`
- `PUBLIC_APP_ENV`
- `PUBLIC_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `GOOGLE_SERVICE_ACCOUNT_EMAIL`
- `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`
- `GOOGLE_ADMIN_EMAIL`
- `GOOGLE_DRIVE_ROOT_FOLDER_ID`
- `GOOGLE_TEMPLATE_DOC_ID`
- `RESEND_API_KEY`
- `EMAIL_FROM`
- `RESEND_FROM_EMAIL`
- `INTERNAL_JOB_SECRET`
- `CRON_SECRET`

`INTERNAL_JOB_SECRET` debe ser igual en Cloudflare Pages y Cloudflare Fulfillment Worker para el mismo entorno, y distinto entre staging y production.

## GitHub Environments

Crear dos environments:

- `staging`
- `Production`

En `production`, activar aprobacion manual antes de deploy.

Secrets por environment:

- `PUBLIC_SUPABASE_URL`
- `PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `PUBLIC_STRIPE_PUBLISHABLE_KEY`
- `PUBLIC_TURNSTILE_SITE_KEY`
- `TURNSTILE_SECRET_KEY`
- `PUBLIC_SENTRY_DSN`
- `SENTRY_AUTH_TOKEN`
- `CRON_SECRET`
- `FULFILLMENT_WORKER_URL`
- `INTERNAL_JOB_SECRET`
- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

Variables por environment:

- `PUBLIC_SITE_URL`
- `PUBLIC_APP_ENV`
- `CHECKOUT_ENABLED=false` hasta cierre deliberado de pagos.
- `CLOUDFLARE_PAGES_PROJECT_STAGING`
- `CLOUDFLARE_PAGES_PROJECT_PRODUCTION`

Valores actuales:

- `CLOUDFLARE_PAGES_PROJECT_STAGING=espanol-honesto-staging`
- `CLOUDFLARE_PAGES_PROJECT_PRODUCTION=espanolhonesto`

## Supabase

Recomendado:

- `espanol-staging`: staging
- `espanol-honesto`: production

Decision vigente: usar dos proyectos separados dentro de la misma cuenta de Supabase, no Supabase branching. Staging y production deben tener URLs, anon keys, service role keys y datos separados. Mientras production siga en Supabase Free, la postura de backup es manual/final: no hay backups programados nativos y antes de production deploy, Go/No-Go publico o migracion destructiva se hara backup logico/manual fuera del repo o upgrade a Pro.

Runtime:

- `PUBLIC_SUPABASE_URL`
- `PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

Operativo:

- `SUPABASE_DB_URL`

Usar `SUPABASE_DB_URL` solo para migraciones/SQL. No lo usa la app.

## Stripe

- Staging: test mode.
- Production: live mode.
- Webhook secret diferente por entorno.
- Los Price IDs viven en Supabase `packages`.

## Google

Staging y production deben tener carpetas y templates diferenciados.

Decision de cuenta de calendario: `docs/launch/GOOGLE_CALENDAR_ACCOUNT.md`. El codigo actual crea eventos en el calendario `primary` de `GOOGLE_ADMIN_EMAIL` y usa `profiles.email` del profesor para disponibilidad/invitaciones. Si el calendario operativo debe ser distinto del email de login/perfil, hay que crear un cambio de modelo separado antes de production.

Staging se puede preparar con:

```bash
pnpm google:setup-staging
```

El script crea o reutiliza:

- carpeta raiz staging bajo `GOOGLE_DRIVE_ROOT_FOLDER_ID`
- documento plantilla staging copiado desde `GOOGLE_TEMPLATE_DOC_ID`

Los IDs resultantes se guardan en KeePassXC y se configuran en Cloudflare Fulfillment Worker staging.

Mantener documentado fuera del repo:

- Proyecto Google Cloud.
- Service account.
- Scopes delegados.
- Email impersonado.
- Proceso de rotacion.

## Local/E2E

- `.env` puede apuntar a servicios reales o staging, pero no se commitea.
- `.env.test` debe usar usuarios de prueba y tampoco se commitea.
- `E2E_DISABLE_EXTERNAL_INTEGRATIONS=true` evita side effects Google/Resend en pruebas locales de booking.
- `DEMO_GUIDE_ENABLED=false` y `DEMO_GUIDE_LOGIN_ENABLED=false` deben quedar apagados en `.env.test` y en `.env.test.example` para los flujos normales.
- `pnpm dev:demo` es el unico arranque local que activa `DEMO_GUIDE_ENABLED=true` y `DEMO_GUIDE_LOGIN_ENABLED=true`; `pnpm dev`, tests y launch verification no deben cargar la demo por defecto.
- Con `DEMO_GUIDE_ENABLED=false`, `/demo` y `/:lang/demo` deben fallar cerrado con `404` y `noindex` para no redirigir trafico de lanzamiento a paginas publicas.
