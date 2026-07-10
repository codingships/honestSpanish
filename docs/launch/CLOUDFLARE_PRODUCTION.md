# Cloudflare Production Runtime

Este documento es la ruta canónica para publicar los dos Workers de producción. No autoriza ninguna escritura externa y no contiene valores secretos.

## Identidades Fijas

| Recurso | Config | Nombre base seguro | Entorno explícito de producción |
| --- | --- | --- | --- |
| Web Astro | `wrangler.toml` | `espanolhonesto-env-required` | `espanolhonesto`, seleccionado durante `build:production:release` y fijado en `dist/server/wrangler.json` |
| Fulfillment | `workers/fulfillment/wrangler.toml` | `espanol-honesto-fulfillment-env-required` | `espanol-honesto-fulfillment-production` con `--env production` |

Los nombres base terminados en `env-required` son deliberados. En Astro 6 el entorno web se elige durante el build, no durante `wrangler deploy`: por eso todo deploy web debe usar únicamente el `dist/server/wrangler.json` generado y validado para la fase actual. El comando raíz sin ese paquete no tiene entrypoint y falla cerrado. Fulfillment sí debe incluir `--config workers/fulfillment/wrangler.toml` y seleccionar explícitamente `production_bootstrap` o `production` según la fase.

## Build Y Dry-Run

El build web de producción se ejecuta únicamente con:

```bash
pnpm run build:production:release
pnpm exec wrangler deploy --config dist/server/wrangler.json --dry-run
```

El runner fija `CLOUDFLARE_ENV=production`, `NODE_ENV=production` y modo Astro `production`; Astro serializa esa selección en `dist/server/wrangler.json`, y el despliegue no vuelve a resolver el entorno con `--env`. El runner rechaza el build si no coinciden a la vez:

- `PUBLIC_APP_ENV=production`;
- `SUPABASE_EXPECTED_PROJECT_REF=vkkahxsybhbutszerawz`;
- el ref de `PUBLIC_SUPABASE_URL`;
- `PUBLIC_SITE_URL=https://espanolhonesto.com`.

También fija `CLOUDFLARE_INCLUDE_PROCESS_ENV=false`: los secretos runtime son bindings de Cloudflare y no se serializan en `dist/server/.dev.vars`. El build falla y elimina cualquier `.dev.vars` que el adaptador llegase a generar dentro de `dist`.

No se debe sustituir este comando por `pnpm build`, porque ese comando es el flujo normal de staging.

El Worker fulfillment tiene dos dry-runs distintos. El primero es el bootstrap inerte y el segundo es el paquete activo final:

```bash
pnpm exec wrangler deploy --config workers/fulfillment/wrangler.toml --env production_bootstrap --dry-run
pnpm exec wrangler deploy --config workers/fulfillment/wrangler.toml --env production --dry-run
```

CI ejecuta ambos dry-runs en `main`, pero no despliega ningún Worker de producción. Los pushes a `staging` sí conservan su deploy automático explícito. Toda escritura production pasa por los runners manuales con aprobación exacta; así un push a `main` no puede crear fulfillment con email/cron activos.

## Fases Separadas

1. Ejecutar los preflights read-only y revisar cuenta, recursos y configuración.
2. Desplegar primero `espanol-honesto-fulfillment-production` con `pnpm launch:cloudflare-production-fulfillment-bootstrap`: entorno `production_bootstrap`, runtime `bootstrap`, email `disabled`, cuotas cero y `crons=[]`. Verificar `/health` y `503 FULFILLMENT_DISABLED` en una ruta operativa.
3. Cargar los secrets de fulfillment con `pnpm launch:cloudflare-production-fulfillment-secrets` contra `production_bootstrap`; la atestación posterior debe seguir demostrando runtime/email inertes, bloqueo operativo `503` y cero Cron Triggers mediante la API remota de schedules.
4. Solo con esos secrets ya cargados pero todavía inertes, construir el Worker web. Inmediatamente antes de escribir, `pnpm launch:cloudflare-production-worker-phase1` vuelve a listar la versión remota de fulfillment y exige para esa versión exacta salud `bootstrap`, bloqueo `503`, HMAC/configuración completa y cero Cron Triggers. Si cualquiera falla, no despliega el web.
5. Configurar los secretos/vars del Worker web con `pnpm launch:cloudflare-production-worker-secrets`; su aprobación no cubre fulfillment.
6. En el mismo proceso y justo antes de la habilitación, volver a listar las versiones remotas exactas de fulfillment y web y atestiguar por HMAC ambas configuraciones. Los resúmenes locales son evidencia auxiliar, nunca sustituyen esta doble prueba fresca.
7. Habilitar fulfillment únicamente con la aprobación distinta de `pnpm launch:cloudflare-production-fulfillment-enable`. Solo este runner despliega `--env production`, que activa runtime, email live y cron.
8. Exigir la comprobación directa posterior de identidad, nueva versión Cloudflare, modo activo, HMAC y cron remoto para fulfillment.
9. Solo después, solicitar una aprobación distinta para mover los dominios.
10. El smoke con emails, Google, jobs, Supabase o pagos es otra fase y necesita su propia aprobación.

El orden es una dependencia técnica, no una preferencia: `wrangler.toml` liga `FULFILLMENT_SERVICE` al Worker production exacto. Por ello el target inerte debe existir, tener sus secrets y quedar atestiguado sobre una versión remota recién leída antes de desplegar el web Worker.

## Gate Fresco Antes Del Deploy Web

La ejecución aprobada de `pnpm launch:cloudflare-production-worker-phase1` carga primero el fichero seguro ignorado indicado por `CLOUDFLARE_FULFILLMENT_ENV_FILE` (por defecto `.env.production`). Después del build y del dry-run web, pero inmediatamente antes del deploy, debe:

- obtener una lista nueva de deployments de `espanol-honesto-fulfillment-production`;
- fijar la versión exacta recién leída como entrada de la atestación;
- comprobar `/health` con identidad exacta y modo `bootstrap`;
- comprobar `503 FULFILLMENT_DISABLED` en una ruta operativa;
- verificar por HMAC toda la configuración esperada contra esa versión;
- consultar la API de schedules de Cloudflare y exigir una lista vacía.

La evidencia histórica del bootstrap o de la carga de secrets sigue siendo requisito de secuencia, pero no autoriza el deploy por sí sola.

## Gate Web Antes Del Primer Secret Put

El runner web permanece local en modo plan. Con `--execute-approved`, antes del primer `wrangler secret put` debe validar:

- aprobación exacta y cuenta Cloudflare `d1a22bcf6477ff2ff31d2bfb83084e44` tanto localmente como mediante `wrangler whoami --json`;
- Worker exacto `espanolhonesto` y una versión desplegada obtenida read-only;
- Supabase ref `vkkahxsybhbutszerawz` en URL y ref esperado;
- `PUBLIC_APP_ENV=production`, `WORKER_IDENTITY=espanolhonesto` y sitio canónico;
- claves Stripe `sk_live_`/`pk_live_`, cuenta `acct_` explícita y checkout todavía cerrado;
- modo email `live` con topes máximos 80 destinatarios/día y 2400/mes;
- URL directa exacta `https://espanolhonesto.alindev95.workers.dev`.

Si falla cualquier comparación, no empieza ninguna escritura.

Los valores se cargan desde el fichero seguro ignorado seleccionado por `CLOUDFLARE_WORKER_ENV_FILE` (por defecto `.env.production`), con las variables de proceso como override deliberado. El runner de fulfillment usa su selector separado, pero ambos deben recibir el mismo `INTERNAL_JOB_SECRET` de producción para conservar el canal interno.

## Bootstrap Inerte De Fulfillment

El primer write de producción es:

```bash
pnpm launch:cloudflare-production-fulfillment-bootstrap
# solo tras revisar el paquete y aprobar exactamente:
pnpm launch:cloudflare-production-fulfillment-bootstrap -- --execute-approved
```

Este runner usa `--env production_bootstrap`. Cloudflare reemplaza los Cron Triggers existentes por el array configurado; por eso `crons=[]` es obligatorio y no se puede sustituir por omitir la clave. Además, el Worker bloquea en código toda ruta operativa y todo evento scheduled salvo que `FULFILLMENT_RUNTIME_MODE=active`. El bootstrap expone solo salud y atestación, sin capacidad de jobs/email/Google.

## Ruta Separada De Secrets Fulfillment

Ejecutar primero en modo plan:

```bash
pnpm launch:cloudflare-production-fulfillment-secrets
```

El runner cubre exclusivamente `espanol-honesto-fulfillment-production` y los nombres necesarios para Supabase service role, secreto interno, Google Workspace, Resend y remitente. Escribe los secrets mediante `--env production_bootstrap` y valida:

- identidad y ref production;
- `PUBLIC_SITE_URL=https://espanolhonesto.com`;
- `FULFILLMENT_RUNTIME_MODE=bootstrap`;
- `EMAIL_DELIVERY_MODE=disabled` y límites cero;
- `crons=[]`;
- checkout cerrado.

La ejecución aprobada usa un fichero seguro ignorado seleccionado por `CLOUDFLARE_FULFILLMENT_ENV_FILE` (por defecto `.env.production`), stdin para `wrangler secret put`, comandos con `--config workers/fulfillment/wrangler.toml --env production_bootstrap` y salidas sanitizadas. No envía emails, no crea eventos/Docs, no procesa jobs y no escribe Supabase.

## Habilitación Final Separada

`pnpm launch:cloudflare-production-fulfillment-enable` es el único camino que despliega `--env production`. En modo plan no llama a Cloudflare. La ejecución aprobada se niega a escribir si falta cualquiera de estas pruebas:

- cuenta y URL directa exactas;
- una nueva lectura de la versión bootstrap, con salud `bootstrap`, bloqueo operativo `503`, HMAC exacta y cero Cron Triggers;
- una nueva lectura de la versión desplegada del Worker web `espanolhonesto`, con HMAC exacta de su configuración;
- todos los secret names requeridos;
- ambas atestaciones ejecutadas en este mismo proceso inmediatamente antes del write; ningún summary local basta por sí solo;
- dry-run activo correcto.

Solo entonces el deploy final activa `FULFILLMENT_RUNTIME_MODE=active`, `EMAIL_DELIVERY_MODE=live`, límites 80/día y 2400/mes, y cron `0 * * * *`. La salida registra `externalWriteAttempted=true` antes de invocar Wrangler para que un timeout no se confunda con «no hubo intento».

Si el comando activo falla, expira o devuelve una respuesta que no permite saber si Cloudflare aplicó el write, o si falla cualquier verificación posterior de versión, salud, HMAC o cron, el runner ejecuta automáticamente un deploy compensatorio de `production_bootstrap`. El rollback solo se considera probado si una versión nueva recién listada demuestra a la vez modo `bootstrap`, bloqueo operativo `503`, HMAC/configuración exacta y lista remota de schedules vacía. Si no puede probar las cuatro condiciones, registra `active_deploy_state_ambiguous=true`, mantiene el lanzamiento bloqueado y exige intervención manual.

## Prueba Directa Obligatoria

Una respuesta HTTP 200 de páginas o `/health` no demuestra por sí sola qué build ni qué base de datos está sirviendo. Tras cargar los nombres, cada runner debe llamar a `/internal/runtime-attestation` con el secreto interno y verificar criptográficamente:

- `WORKER_IDENTITY` exacta;
- ID de versión obtenido con un nuevo `wrangler deployments list` después de la última carga de secretos, porque esa operación puede crear/desplegar una versión nueva;
- configuración esperada, incluido `SUPABASE_EXPECTED_PROJECT_REF=vkkahxsybhbutszerawz` y fingerprints de las credenciales esperadas.

Los artefactos guardan únicamente el resultado, identidad, coincidencia de versión y ref público. No guardan el proof, bearer, claves ni cuerpos de respuesta.

## Stop Y Rollback

- Parar antes del primer write si cuenta, Worker, ref, modo, sitio, entorno o URL directa no coincide.
- Parar el web deploy si fulfillment no tiene sus secrets todavía inertes o si la versión recién listada no prueba salud bootstrap, `503 FULFILLMENT_DISABLED`, HMAC exacta y cero schedules remotos.
- Parar la habilitación final si las versiones recién listadas de fulfillment y web no superan ambas atestaciones HMAC en el mismo proceso, o falta cualquier secret name.
- Parar antes de dominios si falla cualquier atestación.
- Mantener los dominios en Pages y `CHECKOUT_ENABLED=false` durante toda la preparación.
- Si falla una carga de secreto, corregir solo ese nombre bajo una nueva aprobación exacta; no borrar Workers ni Pages.
- Si el deploy activo falla o su verificación posterior no cierra, el runner intenta inmediatamente restaurar `production_bootstrap` y lo prueba por versión + salud + 503 + HMAC + schedules vacíos.
- Si el rollback compensatorio no queda completamente probado, tratar el estado remoto como ambiguo: no activar dominios, checkout, smoke ni jobs; inspeccionar Cloudflare y ejecutar una recuperación manual aprobada antes de continuar.
