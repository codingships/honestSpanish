# Entornos y recursos

Los identificadores explícitos de este documento son la lista permitida. Antes de escribir fuera del repositorio se comprueba por lectura que la identidad autenticada, el recurso y el entorno coinciden exactamente. Un recurso parecido no es intercambiable.

Los identificadores confidenciales viven una sola vez en el GitHub Environment o en el gestor del proveedor. El repositorio fija su nombre de binding y las invariantes verificables; nunca copia el valor como una segunda fuente de verdad. El estado vivo indicado abajo se comprobó el 31 de julio de 2026 y debe releerse antes de cualquier escritura.

## Repositorio

- GitHub: `codingships/honestSpanish`.
- Rama integrada: `main`.
- CI requerida: check agregado `quality-gate` de GitHub Actions (`app_id 15368`).
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
- Webhook Stripe: el endpoint de staging debe entregar `checkout.session.completed`, `checkout.session.expired`, `invoice.paid`, `invoice.payment_failed`, `invoice.upcoming`, `charge.refunded`, `refund.created`, `refund.updated`, `refund.failed`, `customer.subscription.updated` y `customer.subscription.deleted`.
- Turnstile: site key pública de test `1x00000000000000000000AA` y secret always-pass de test `1x0000000000000000000000000000000AA`; el secret nunca se documenta fuera de este identificador de prueba. El backend admite los campos de respuesta dummy documentados solo fuera de producción y rechaza esa site key en producción.
- Google Workspace: tenant `espanolhonesto.com`; los bindings `GOOGLE_*` deben resolver la carpeta `STAGING - Espanol Honesto` y la plantilla `STAGING - Plantilla de clase`.
- Resend: remitente bajo `espanolhonesto.com`, binding `RESEND_FROM_EMAIL`, modo allowlist.
- Sentry: proyecto `honestspanish/espanol-honesto-astro`, host DSN `o4510912289701888.ingest.de.sentry.io`, project ID `4510917714444368`; el build de staging no consulta credenciales ni sube sourcemaps.
- Checkout: habilitado en Sandbox (`CHECKOUT_ENABLED=true` / `CHECKOUT_ENABLED_OVERRIDE=true`). Producción permanece cerrada.
- Cron fulfillment: `0 * * * *`.

## Producción

- URL web: `https://espanolhonesto.com`.
- Cuenta Cloudflare: `d1a22bcf6477ff2ff31d2bfb83084e44`.
- Único runtime público y canónico: Pages project `espanolhonesto`, dominios `espanolhonesto.com` y `www.espanolhonesto.com`.
- Deploy público observado: Pages deployment `3bd00cbf-7abe-465b-a809-821e8fd721d5`, asociado al commit `060b029ef5326cb390b69a8932940191cfd87034`, de 8 de marzo de 2026.
- Supabase: ref `vkkahxsybhbutszerawz`.
- Cloudflare Web Analytics: instalación automática habilitada para el Pages project `espanolhonesto`; la recepción de datos todavía debe acreditarse después de un despliegue autorizado.
- DNS público comprobado por lectura el 4 de septiembre de 2026: la zona está activa y contiene un TXT de verificación de Google, SPF/DKIM para Google Workspace y SPF/DKIM para Resend. No se observó un registro DMARC en `_dmarc.espanolhonesto.com`; debe definirse y validarse antes de usar correo transaccional real. Esta lectura no acredita por sí sola que la propiedad esté dada de alta en Search Console.
- Google Search Console: la propiedad `sc-domain:espanolhonesto.com` está verificada y el acceso OAuth de usuario de solo lectura quedó validado en vivo el 4 de septiembre de 2026. El MCP local respondió desde una tarea nueva de Codex con ping, listado de sitemaps, Search Analytics e inspección de URL. La portada canónica inspeccionada fue `https://espanolhonesto.com/es`; `https://espanolhonesto.com/` figura como página con redirección.
- Google Cloud: el informe de la cuenta de facturación `010386-61B339-CDC1E7` está filtrado al proyecto `stunning-tract-481609-p7` de la organización `750769867979`, muestra un único proyecto en el filtro y coste acumulado de 0,00 EUR. Esto acredita el contexto de facturación observado, no un tope de gasto futuro; la vinculación exacta se confirma en Administración de cuenta antes de conservarla o retirarla.
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

Para staging, el GitHub Environment `staging` es la fuente de los secretos esperados. El workflow construye para cada Worker un archivo temporal con su allowlist exacto, lo pasa a `versions upload --secrets-file` y lo elimina sin imprimir valores. `keep_vars=false` y `unsafe.metadata.keep_bindings=[]` impiden heredar bindings de una versión anterior. Antes de activar, `versions view` debe coincidir exactamente en nombres, tipos y destinos o valores no secretos; después, el smoke exige los dos IDs activados y verifica por HMAC la configuración atestada contra GitHub.

Secrets requeridos por el contrato:

- Acceso: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`.
- Supabase y seguridad interna: `PUBLIC_SUPABASE_URL`, `PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`, `INTERNAL_JOB_SECRET`, `LEVEL_CHECK_TOKEN_SECRET`.
- Stripe y protección del checkout: `PUBLIC_STRIPE_PUBLISHABLE_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PORTAL_CONFIGURATION_ID`, `PUBLIC_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`, `CHECKOUT_HOLD_FINGERPRINT_SECRET`. Este último debe ser aleatorio, de al menos 32 bytes, distinto de los demás secretos y exclusivo del Worker web; permite limitar reservas simultáneas por dirección IPv4 o red IPv6 `/64` sin almacenar la IP.
- Google y email: `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`, `GOOGLE_ADMIN_EMAIL`, `GOOGLE_DRIVE_ROOT_FOLDER_ID`, `GOOGLE_TEMPLATE_DOC_ID`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `EMAIL_RECIPIENT_ALLOWLIST`. El workflow deriva `EMAIL_FROM` de `RESEND_FROM_EMAIL`; no existe un segundo secret de remitente.
- Identidad operativa: `ADMIN_EMAIL`, `SUPPORT_ALERT_EMAIL`, `TEST_STUDENT_EMAIL`, `TEST_TEACHER_EMAIL`, `TEST_ADMIN_EMAIL`, `PUBLIC_SENTRY_DSN`.

URLs, Workers, modos, límites, ref de Supabase y la cuenta Stripe `acct_1TruqOC22M3erP0j` son constantes no secretas fijadas en el workflow y en este documento.

La ausencia de una credencial detiene el despliegue. No se copia una clave de otro proyecto, no se inventa una segunda ruta de acceso y no se imprime el valor para diagnosticarla.

## Perfil Codex del proyecto

`.codex/config.toml` es un override local y versionado. No desinstala ni modifica plugins, skills, OAuth, hooks, conectores o MCP del perfil global, por lo que los demás proyectos conservan sus capacidades.

El único override que este repositorio define actualmente es `espanolhonesto_searchconsole`. Apunta al servidor local de `tools/searchconsole-mcp`, está habilitado y limita la superficie a cuatro herramientas de lectura: ping, Search Analytics, inspección de URL y listado de sitemaps. No contiene credenciales; solo pasa al proceso la ruta local del ADC privado almacenado fuera del repositorio. El servidor fija la propiedad `sc-domain:espanolhonesto.com`, exige ADC de tipo `authorized_user` con `webmasters.readonly` y no puede enviar ni borrar sitemaps. El 4 de septiembre de 2026 superó typecheck, 11/11 pruebas, handshake y una prueba live desde una tarea nueva de Codex: ping correcto, un sitemap sin errores ni advertencias, Analytics con datos e inspección de la portada. El cliente OAuth y el ADC permanecen fuera del repositorio.

Google Drive, Docs, Sheets, GitHub, Cloudflare, Sentry, Supabase, Stripe y los demás conectores se gobiernan en el perfil global y por su autorización en cada proveedor. Su presencia en una tarea no acredita la identidad ni autoriza escrituras. El conector de Google Drive está operativo con `alejandro@espanolhonesto.com`; no se observaron unidades compartidas, y la raíz y plantilla del campus permanecen en My Drive. Los cambios de permisos siguen sujetos al gate de Visitor Sharing y a una prueba externa.

El conector de Resend se comprobó por lectura el 4 de septiembre de 2026: muestra `espanolhonesto.com` verificado en `eu-west-1`, con envío habilitado, recepción deshabilitada y seguimiento de aperturas y clics desactivado. El grant de ChatGPT tiene alcance amplio; cualquier envío o cambio administrativo conserva el preflight y la aprobación manual por recurso exacto.

El perfil reduce errores de contexto, pero no puede limitar por sí mismo GitHub, Stripe o Cloudflare a una única cuenta. Antes de escribir siguen siendo obligatorios los preflights de este documento: GitHub `codingships/honestSpanish`, Stripe `acct_1TruqOC22M3erP0j` con `livemode=false` y Cloudflare `d1a22bcf6477ff2ff31d2bfb83084e44`. El aislamiento fuerte depende además de permisos OAuth o tokens limitados en el proveedor.

Recuperación y reutilización:

- Para retirar el MCP local se elimina su sección `mcp_servers.*` y se abre una tarea nueva de Codex.
- La ruta ejecutable es local a este equipo; si se clona el repositorio en otro host se ajustan `command`, `args` y `cwd` antes de habilitarlo.
- Git conserva el perfil anterior y cada cambio posterior. No se mantiene una segunda configuración global ni una copia con secretos.
