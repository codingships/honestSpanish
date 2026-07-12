# Cloudflare Production Runtime

Este documento es la ruta canónica para publicar los dos Workers de producción. No autoriza ninguna escritura externa y no contiene valores secretos.

## Identidades Fijas

| Recurso | Config | Nombre base seguro | Entorno explícito de producción |
| --- | --- | --- | --- |
| Web Astro bootstrap | `wrangler.toml` | `espanolhonesto-env-required` | `espanolhonesto`, seleccionado con `production_bootstrap` durante `build:production:bootstrap`; todas las rutas de aplicación quedan en 503 |
| Web Astro activo final | `wrangler.toml` | `espanolhonesto-env-required` | `espanolhonesto`, seleccionado con `production` durante `build:production:release`; mantiene los gates legales y Stripe Live finales |
| Fulfillment | `workers/fulfillment/wrangler.toml` | `espanol-honesto-fulfillment-env-required` | `espanol-honesto-fulfillment-production` con `--env production` |

Los nombres base terminados en `env-required` son deliberados. En Astro 6 el entorno web se elige durante el build, no durante `wrangler deploy`: por eso todo deploy web debe usar únicamente el `dist/server/wrangler.json` generado y validado para la fase actual. El comando raíz sin ese paquete no tiene entrypoint y falla cerrado. Fulfillment sí debe incluir `--config workers/fulfillment/wrangler.toml` y seleccionar explícitamente `production_bootstrap` o `production` según la fase.

## Build Y Dry-Run

El primer build web de producción es el bootstrap inerte:

```bash
pnpm run build:production:bootstrap
pnpm exec wrangler deploy --config dist/server/wrangler.json --dry-run
```

Este build fija `CLOUDFLARE_ENV=production_bootstrap`, `WEB_RUNTIME_MODE=bootstrap`, checkout falso, email desactivado y cuotas cero. No exige todavía la identidad legal final ni Stripe Live, y elimina del proceso de build las credenciales de service role, Stripe, Resend, Turnstile, cron y level-check. Eso no relaja el build activo: la ruta final sigue siendo:

Antes de aceptar el paquete, el runner limpia `dist` de forma segura, usa un directorio de entorno aislado, escanea el bundle nuevo contra valores/patrones de credenciales y reemplaza el entrypoint por `bootstrap-entry.mjs`. El config final debe fijar `assets.run_worker_first=true`, de modo que el wrapper responde antes que Astro y antes que `ASSETS`: solo deja pasar `/health` y `/api/internal/runtime-attestation`; cualquier otra URL —incluidos HTML prerenderizado, `robots.txt`, sitemap, favicon y `/_astro/*`— responde `503 WEB_RUNTIME_BOOTSTRAP`, `Cache-Control: no-store` y `X-Robots-Tag: noindex`.

```bash
pnpm run build:production:release
pnpm exec wrangler deploy --config dist/server/wrangler.json --dry-run
```

El runner activo fija `CLOUDFLARE_ENV=production`, `WEB_RUNTIME_MODE=active`, `NODE_ENV=production` y modo Astro `production`; Astro serializa esa selección en `dist/server/wrangler.json`, y el despliegue no vuelve a resolver el entorno con `--env`. El runner activo rechaza el build si no coinciden a la vez:

- `PUBLIC_APP_ENV=production`;
- `SUPABASE_EXPECTED_PROJECT_REF=vkkahxsybhbutszerawz`;
- el ref de `PUBLIC_SUPABASE_URL`;
- `PUBLIC_SITE_URL=https://espanolhonesto.com`.

Ambos fijan `CLOUDFLARE_INCLUDE_PROCESS_ENV=false`: los secretos runtime son bindings de Cloudflare y no se serializan en `dist/server/.dev.vars`. El build falla y elimina cualquier `.dev.vars` que el adaptador llegase a generar dentro de `dist`.

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
3. Cargar únicamente `INTERNAL_JOB_SECRET` con `pnpm launch:cloudflare-production-fulfillment-bootstrap-secrets` contra `production_bootstrap`; la lista remota debe contener exactamente ese nombre y la atestación debe demostrar Supabase, Google, Resend, remitente y cron-secret ausentes, además de runtime/email inertes, bloqueo `503` y cero Cron Triggers.
4. Solo con fulfillment todavía inerte, `pnpm launch:cloudflare-production-worker-phase1` construye `production_bootstrap`, valida el `dist/server/wrangler.json` resuelto y despliega el web sin rutas ni cron. Inmediatamente antes exige una versión fresca de fulfillment con salud `bootstrap`, bloqueo `503`, HMAC exacta y schedules vacíos; inmediatamente después exige salud web bootstrap y 503 en rutas públicas, campus, API, `robots.txt` y assets (incluido `/_astro/*`).
5. Cargar únicamente `INTERNAL_JOB_SECRET` con `pnpm launch:cloudflare-production-worker-bootstrap-secrets`; solo autentica y firma la atestación HMAC. El wrapper no necesita Supabase URL/anon para salud ni atestación, así que esos valores también se reservan para el gate activo final. El runner rechaza cualquier otro nombre y vuelve a probar todas las rutas 503.
6. Atestiguar por HMAC la versión web recién leída con `WEB_RUNTIME_MODE=bootstrap` y fingerprints ausentes para Supabase URL/anon/service role, Stripe, Resend, Turnstile, cron y level-check.
7. Dejar para la ventana final el build activo `pnpm build:production:release` y los runners completos `pnpm launch:cloudflare-production-worker-secrets` y `pnpm launch:cloudflare-production-fulfillment-secrets`; estas rutas distintas cargan los providers finales y siguen exigiendo identidad legal final, Stripe Live y aprobaciones exactas.
8. En el mismo proceso y justo antes de la habilitación, volver a listar las versiones remotas exactas de fulfillment y web activo y atestiguar por HMAC ambas configuraciones. Los resúmenes locales son evidencia auxiliar, nunca sustituyen esta doble prueba fresca.
9. Habilitar fulfillment únicamente con la aprobación distinta de `pnpm launch:cloudflare-production-fulfillment-enable`. Solo este runner despliega `--env production`, que activa runtime, email live y cron.
10. Exigir la comprobación directa posterior de identidad, nueva versión Cloudflare, modo activo, HMAC y cron remoto para fulfillment.
11. Solo después, solicitar una aprobación distinta para mover los dominios.
12. El smoke con emails, Google, jobs, Supabase o pagos es otra fase y necesita su propia aprobación.

El orden es una dependencia técnica, no una preferencia: `wrangler.toml` liga `FULFILLMENT_SERVICE` al Worker production exacto. Por ello el target inerte debe existir, tener solo el HMAC compartido y quedar atestiguado sin providers sobre una versión remota recién leída antes de desplegar el web Worker.

## Gate Fresco Antes Del Deploy Web

La ejecución aprobada de `pnpm launch:cloudflare-production-worker-phase1` carga primero el fichero seguro ignorado indicado por `CLOUDFLARE_FULFILLMENT_ENV_FILE` (por defecto `.env.production`). Después del build y del dry-run web, pero inmediatamente antes del deploy, debe:

- obtener una lista nueva de deployments de `espanol-honesto-fulfillment-production`;
- fijar la versión exacta recién leída como entrada de la atestación;
- comprobar `/health` con identidad exacta y modo `bootstrap`;
- comprobar `503 FULFILLMENT_DISABLED` en una ruta operativa;
- verificar por HMAC toda la configuración esperada contra esa versión;
- consultar la API de schedules de Cloudflare y exigir una lista vacía.

La evidencia histórica del bootstrap o de la carga HMAC mínima sigue siendo requisito de secuencia, pero no autoriza el deploy por sí sola.

El build ejecutado aquí es exclusivamente `pnpm build:production:bootstrap`. No consulta la identidad legal final ni Stripe Live; ambos gates pertenecen al build activo posterior.

## Gate De Secrets Mínimos Del Bootstrap Web

Primero se genera el plan sin escrituras:

```bash
pnpm launch:cloudflare-production-worker-bootstrap-secrets
```

La ejecución aprobada valida cuenta, Worker, versión remota, salud bootstrap y 503 antes del primer write. Solo permite un nombre:

- `INTERNAL_JOB_SECRET`, necesario exclusivamente para autenticar y firmar la atestación HMAC.

La lista posterior debe contener exactamente ese nombre. Quedan explícitamente fuera: `PUBLIC_SUPABASE_URL`, `PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, todas las claves Stripe y Resend, remitentes/allowlists, Turnstile, cron y level-check. Después de la carga se obtiene una versión nueva, se repiten las pruebas 503 y se verifica por HMAC `WEB_RUNTIME_MODE=bootstrap`, checkout/email inertes y fingerprints ausentes para todos esos valores.

## Gate Web Activo Final Antes Del Primer Secret Put

El runner final `pnpm launch:cloudflare-production-worker-secrets` permanece separado y no se llama durante el bootstrap. Con `--execute-approved`, antes del primer `wrangler secret put` final debe validar:

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

## Gate HMAC Mínimo Del Bootstrap Fulfillment

Primero se genera el plan local, sin Cloudflare:

```bash
pnpm launch:cloudflare-production-fulfillment-bootstrap-secrets
```

La ejecución aprobada permite exclusivamente `INTERNAL_JOB_SECRET`. Antes del write exige cuenta, Worker y versión exactos, salud `bootstrap`, bloqueo operativo `503`, secret list vacía o ya HMAC-only y schedules remotos vacíos. Después exige exactamente un secret name y una atestación HMAC ligada a la versión nueva con fingerprints ausentes para Supabase URL/service role, Google, Resend, remitente y `CRON_SECRET`.

Los providers completos no forman parte del bootstrap. Permanecen reservados para `pnpm launch:cloudflare-production-fulfillment-secrets` en la ventana final, inmediatamente antes de la activación.

## Ruta Final Separada De Secrets Fulfillment

Ejecutar primero en modo plan:

```bash
pnpm launch:cloudflare-production-fulfillment-secrets
```

Este runner no se ejecuta antes del web bootstrap. En la ventana final cubre exclusivamente `espanol-honesto-fulfillment-production` y los nombres necesarios para Supabase service role, secreto interno, Google Workspace, Resend y remitente. Los escribe mientras el código sigue en `production_bootstrap` y valida:

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
- Parar el web deploy si fulfillment no tiene exactamente `INTERNAL_JOB_SECRET`, si aparece cualquier provider secret o si la versión recién listada no prueba salud bootstrap, `503 FULFILLMENT_DISABLED`, HMAC provider-free y cero schedules remotos.
- Parar el bootstrap web si el paquete resuelto no selecciona `production_bootstrap`, si no fija `assets.run_worker_first=true`, si contiene rutas/cron/bindings activos o si cualquier ruta representativa (incluidos `robots.txt` y `/_astro/*`) deja de devolver `503 WEB_RUNTIME_BOOTSTRAP`.
- Parar antes del primer secret mínimo si la lista remota contiene algo distinto de `INTERNAL_JOB_SECRET`; este runner no elimina ni reutiliza secretos activos inesperados.
- Parar después de la carga mínima si HMAC no demuestra la nueva versión, `WEB_RUNTIME_MODE=bootstrap` y ausencia de Supabase URL/anon/service role, Stripe, Resend, Turnstile, cron y level-check.
- Parar la habilitación final si las versiones recién listadas de fulfillment y web no superan ambas atestaciones HMAC en el mismo proceso, o falta cualquier secret name.
- Parar antes de dominios si falla cualquier atestación.
- Mantener los dominios en Pages y `CHECKOUT_ENABLED=false` durante toda la preparación.
- Si falla una carga de secreto, corregir solo ese nombre bajo una nueva aprobación exacta; no borrar Workers ni Pages.
- Si el deploy activo falla o su verificación posterior no cierra, el runner intenta inmediatamente restaurar `production_bootstrap` y lo prueba por versión + salud + 503 + HMAC + schedules vacíos.
- Si el rollback compensatorio no queda completamente probado, tratar el estado remoto como ambiguo: no activar dominios, checkout, smoke ni jobs; inspeccionar Cloudflare y ejecutar una recuperación manual aprobada antes de continuar.
