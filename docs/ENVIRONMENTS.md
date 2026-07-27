# Entornos y recursos

Los nombres de esta tabla son una lista permitida. Antes de escribir fuera del repositorio se comprueba por lectura que la identidad autenticada y el recurso coinciden exactamente. Un recurso parecido no es intercambiable.

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
- Stripe: Sandbox España/EUR; las claves deben ser de test.
- Email: Resend en modo allowlist.
- Checkout: desactivado.
- Cron fulfillment: `0 * * * *`.

## Producción

- URL web: `https://espanolhonesto.com`.
- Cuenta Cloudflare: `d1a22bcf6477ff2ff31d2bfb83084e44`.
- Worker web: `espanolhonesto`.
- Worker fulfillment: `espanol-honesto-fulfillment-production`.
- Queue: `espanol-honesto-fulfillment-production-queue`.
- DLQ: `espanol-honesto-fulfillment-production-dlq`.
- Supabase: ref `vkkahxsybhbutszerawz`.
- Producción no se modifica desde el workflow de staging ni por continuidad implícita de una tarea.

## Local

`.env.staging` y `.dev.vars.staging` son locales e ignorados. `.env.example` y los archivos `*.example` solo documentan nombres y valores no secretos.

`SENTRY_CAPTURE_LOCAL=false` es el valor normal. `SENTRY_ENVIRONMENT` separa cada runtime. No local telemetry is sent to Sentry unless capture is enabled deliberately.

## Secretos

Los valores viven en GitHub Environments o en el gestor del proveedor, nunca en Git. El workflow de staging requiere, entre otros, `CLOUDFLARE_API_TOKEN` y `CLOUDFLARE_ACCOUNT_ID`; el token debe estar restringido a esta cuenta y a los permisos necesarios de Workers/Queues.

La ausencia de una credencial detiene el despliegue. No se copia una clave de otro proyecto, no se inventa una segunda ruta de acceso y no se imprime el valor para diagnosticarla.
