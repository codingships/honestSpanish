# Entornos y recursos

Los identificadores explícitos de este documento son la lista permitida. Antes de escribir fuera del repositorio se comprueba por lectura que la identidad autenticada, el recurso y el entorno coinciden exactamente. Un recurso parecido no es intercambiable.

Los identificadores confidenciales viven una sola vez en el GitHub Environment o en el gestor del proveedor. El repositorio fija su nombre de binding y las invariantes verificables; nunca copia el valor como una segunda fuente de verdad. El estado vivo indicado abajo se comprobó el 27 de julio de 2026 y debe releerse antes de cualquier escritura.

## Repositorio

- GitHub: `codingships/honestSpanish`.
- Rama integrada: `main`.
- CI requerida: check `build-and-test`.
- Entorno de despliegue de staging: `staging`.
- Entorno protegido de producción: `Production`.

## Staging

- URL web: `https://staging.espanolhonesto.com`.
- Cuenta Cloudflare: `d1a22bcf6477ff2ff31d2bfb83084e44`.
- Worker web: `espanolhonesto-staging`.
- Worker fulfillment: `espanol-honesto-fulfillment-staging`.
- Queue: `espanol-honesto-fulfillment-staging-queue`.
- DLQ: `espanol-honesto-fulfillment-staging-dlq`.
- Supabase: proyecto `espanol-staging`, ref `mzjyvmlxfpzdfdjzxxyj`, región `eu-central-1`.
- Stripe: Sandbox España/EUR, cuenta `acct_1TruqOC22M3erP0j`; las claves deben ser de test.
- Turnstile: site key pública de test `1x00000000000000000000AA`; el secret nunca se documenta.
- Google Workspace: tenant `espanolhonesto.com`; los bindings `GOOGLE_*` deben resolver la carpeta `STAGING - Espanol Honesto` y la plantilla `STAGING - Plantilla de clase`.
- Resend: remitente bajo `espanolhonesto.com`, binding `RESEND_FROM_EMAIL`, modo allowlist.
- Sentry: proyecto `honestspanish/espanol-honesto-astro`, host DSN `o4510912289701888.ingest.de.sentry.io`, project ID `4510917714444368`; el build de staging no consulta credenciales ni sube sourcemaps.
- Checkout: desactivado.
- Cron fulfillment: `0 * * * *`.

## Producción

- URL web: `https://espanolhonesto.com`.
- Cuenta Cloudflare: `d1a22bcf6477ff2ff31d2bfb83084e44`.
- Único runtime público y canónico: Pages project `espanolhonesto`, dominios `espanolhonesto.com` y `www.espanolhonesto.com`.
- Deploy público observado: Pages deployment `3bd00cbf-7abe-465b-a809-821e8fd721d5`, asociado al commit `060b029ef5326cb390b69a8932940191cfd87034`, de 8 de marzo de 2026.
- Supabase: ref `vkkahxsybhbutszerawz`.
- El repositorio no contiene configuración, build ni validación ejecutable para desplegar Workers o colas de producción.
- Producción no se modifica desde el workflow de staging ni por continuidad implícita de una tarea.

Los recursos Cloudflare `espanolhonesto`, `espanol-honesto-fulfillment-production`, `espanol-honesto-fulfillment-production-queue` y `espanol-honesto-fulfillment-production-dlq` existen como recursos reservados fuera de alcance. No son runtime público, target, fallback ni continuación técnica de staging. Un posible cambio de Pages a Workers sería una decisión nueva de producto e infraestructura, con configuración nueva, preflight exacto y autorización explícita.

## Recursos históricos fuera de alcance

- Pages project `espanol-honesto-staging`: conserva solo su dominio `pages.dev`; no es el staging canónico.
- Worker `espanolhonesto-staging-staging`: duplicado inactivo, sin subdominio, dominio ni cron.
- Worker `espanol-honesto-reminders`: legado inactivo, sin subdominio ni cron.

No son targets, fallback ni fuentes de verdad. Una tarea que apunte a ellos se detiene. Tampoco se borran por inferencia: su eliminación exige una tarea de limpieza externa con preflight propio.

## Local

`.env.staging` contiene exclusivamente los recursos de staging y genera `.dev.vars.staging`; ambos son locales e ignorados. `.env.test` contiene solo las tres cuentas de rol para demo o seed explícitos. La suite pública de Playwright no lee ninguno de ellos. Un archivo local `.env` no forma parte del flujo soportado. `.env.example` y los archivos `*.example` solo documentan nombres y valores no secretos.

`SENTRY_CAPTURE_LOCAL=false` es el valor normal. `SENTRY_ENVIRONMENT` separa cada runtime. No local telemetry is sent to Sentry unless capture is enabled deliberately.

## Secretos

Los valores viven en GitHub Environments o en el gestor del proveedor, nunca en Git. El workflow de staging requiere, entre otros, `CLOUDFLARE_API_TOKEN` y `CLOUDFLARE_ACCOUNT_ID`; el token debe estar restringido a esta cuenta y a los permisos necesarios de Workers/Queues.

Para staging, el GitHub Environment `staging` es la fuente de la configuración esperada. Cloudflare conserva una copia runtime de variables y secretos; `versions upload --keep-vars` evita reescribirla durante un despliegue de código. Esto no permite divergencia silenciosa: antes de mutar se exige el contrato completo y, después, ambos Workers firman por HMAC sus IDs de versión y los fingerprints de toda la configuración atestada. El smoke recalcula la firma desde GitHub y rechaza cualquier ausencia o diferencia sin imprimir valores.

Secrets requeridos por el contrato:

- Acceso: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`.
- Supabase y seguridad interna: `PUBLIC_SUPABASE_URL`, `PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`, `INTERNAL_JOB_SECRET`, `LEVEL_CHECK_TOKEN_SECRET`.
- Stripe y Turnstile: `PUBLIC_STRIPE_PUBLISHABLE_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PORTAL_CONFIGURATION_ID`, `PUBLIC_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`.
- Google y email: `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`, `GOOGLE_ADMIN_EMAIL`, `GOOGLE_DRIVE_ROOT_FOLDER_ID`, `GOOGLE_TEMPLATE_DOC_ID`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `EMAIL_FROM`, `EMAIL_RECIPIENT_ALLOWLIST`.
- Identidad operativa: `ADMIN_EMAIL`, `SUPPORT_ALERT_EMAIL`, `TEST_STUDENT_EMAIL`, `TEST_TEACHER_EMAIL`, `TEST_ADMIN_EMAIL`, `PUBLIC_SENTRY_DSN`.

URLs, Workers, modos, límites, ref de Supabase y la cuenta Stripe `acct_1TruqOC22M3erP0j` son constantes no secretas fijadas en el workflow y en este documento.

La ausencia de una credencial detiene el despliegue. No se copia una clave de otro proyecto, no se inventa una segunda ruta de acceso y no se imprime el valor para diagnosticarla.

## Perfil Codex del proyecto

`.codex/config.toml` es un override local y versionado. No desinstala ni modifica plugins, skills, OAuth, hooks o MCP del perfil global, por lo que los demás proyectos conservan todas sus capacidades.

Para el desarrollo normal de HonestSpanish quedan habilitados Browser, GitHub, Cloudflare y un MCP de Supabase restringido a `mzjyvmlxfpzdfdjzxxyj`, de solo lectura y con lista de herramientas. Stripe permanece deshabilitado hasta una tarea dedicada de pagos de prueba que verifique primero `acct_1TruqOC22M3erP0j` y `livemode=false`. Todas las demás apps quedan cerradas por defecto, incluido el conector Supabase genérico. `sentry-p2` también queda deshabilitado porque apunta a otro proyecto; Sentry solo se habilitará tras comprobar `honestspanish/espanol-honesto-astro`.

El perfil reduce errores de contexto, pero no puede limitar por sí mismo GitHub, Stripe o Cloudflare a una única cuenta. Antes de escribir siguen siendo obligatorios los preflights de este documento: GitHub `codingships/honestSpanish`, Stripe `acct_1TruqOC22M3erP0j` con `livemode=false` y Cloudflare `d1a22bcf6477ff2ff31d2bfb83084e44`. El aislamiento fuerte depende además de permisos OAuth o tokens limitados en el proveedor.

Recuperación y reutilización:

- Para volver al comportamiento global, se retiran de `.codex/config.toml` las secciones `apps.*`, `plugins.*` y `mcp_servers.*` y se abre una tarea nueva de Codex.
- Para aplicar el mismo aislamiento a otro repositorio, se copia el perfil y se sustituyen sus allowlists e identidades por las de ese proyecto.
- Git conserva el perfil anterior y cada cambio posterior. No se mantiene una segunda configuración global ni una copia con secretos.
