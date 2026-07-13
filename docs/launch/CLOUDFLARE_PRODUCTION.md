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
2. Crear, bajo aprobación exacta separada, primero `espanol-honesto-fulfillment-production-dlq` y después `espanol-honesto-fulfillment-production-queue` con `pnpm launch:cloudflare-production-queues`. Esta fase solo crea las dos Queues: no despliega Workers ni añade consumidores manualmente. Mientras fulfillment siga en `production_bootstrap`, las Queues quedan inertes y sin bindings.
3. Desplegar primero `espanol-honesto-fulfillment-production` con `pnpm launch:cloudflare-production-fulfillment-bootstrap`: entorno `production_bootstrap`, runtime `bootstrap`, email `disabled`, cuotas cero y `crons=[]`. Verificar `/health` y `503 FULFILLMENT_DISABLED` en una ruta operativa.
4. Cargar únicamente `INTERNAL_JOB_SECRET` con `pnpm launch:cloudflare-production-fulfillment-bootstrap-secrets` contra `production_bootstrap`; la lista remota debe contener exactamente ese nombre y la atestación debe demostrar Supabase, Google, Resend, remitente y cron-secret ausentes, además de runtime/email inertes, bloqueo `503` y cero Cron Triggers.
5. Solo con fulfillment todavía inerte, `pnpm launch:cloudflare-production-worker-phase1` construye `production_bootstrap`, valida el `dist/server/wrangler.json` resuelto y despliega el web sin rutas ni cron. Inmediatamente antes exige una versión fresca de fulfillment con salud `bootstrap`, bloqueo `503`, HMAC exacta y schedules vacíos; inmediatamente después exige salud web bootstrap y 503 en rutas públicas, campus, API, `robots.txt` y assets (incluido `/_astro/*`).
6. Cargar únicamente `INTERNAL_JOB_SECRET` con `pnpm launch:cloudflare-production-worker-bootstrap-secrets`; solo autentica y firma la atestación HMAC. El wrapper no necesita Supabase URL/anon para salud ni atestación, así que esos valores también se reservan para el gate activo final. El runner rechaza cualquier otro nombre y vuelve a probar todas las rutas 503.
7. Atestiguar por HMAC la versión web recién leída con `WEB_RUNTIME_MODE=bootstrap` y fingerprints ausentes para Supabase URL/anon/service role, Stripe, Resend, Turnstile, cron y level-check.
8. Dejar para la ventana final el build activo `pnpm build:production:release` y los runners completos `pnpm launch:cloudflare-production-worker-secrets` y `pnpm launch:cloudflare-production-fulfillment-secrets`; estas rutas distintas cargan los providers finales y siguen exigiendo identidad legal final, Stripe Live y aprobaciones exactas.
9. Antes de la habilitación, ejecutar por separado `pnpm launch:cloudflare-production-queues -- --verify-existing` en modo read-only y confirmar que las dos Queues production exactas existen una sola vez. Después, ya dentro del proceso de enable e inmediatamente antes del write, volver a paginar el inventario completo, ejecutar `queues info` para Queue y DLQ, consultar Stripe Live read-only, listar las versiones remotas exactas de fulfillment y web activo y atestiguar por HMAC ambas configuraciones. Los resúmenes locales son evidencia auxiliar, nunca sustituyen estas lecturas frescas.
10. Habilitar fulfillment únicamente con la aprobación distinta de `pnpm launch:cloudflare-production-fulfillment-enable`. Solo este runner despliega `--env production`, conecta productor/consumidor a las Queues ya creadas y activa runtime, email live y cron.
11. Exigir la comprobación directa posterior de identidad, nueva versión Cloudflare, modo activo, HMAC y cron remoto para fulfillment; el inventario de Queues queda probado por el doble gate read-only temprano y fresco del paso 9, separado de la atestación runtime.
12. Solo después, solicitar una aprobación distinta para mover los dominios.
13. El smoke con emails, Google, jobs, Supabase o pagos es otra fase y necesita su propia aprobación.

El orden es una dependencia técnica, no una preferencia: `wrangler.toml` liga `FULFILLMENT_SERVICE` al Worker production exacto. Por ello el target inerte debe existir, tener solo el HMAC compartido y quedar atestiguado sin providers sobre una versión remota recién leída antes de desplegar el web Worker.

Las Queues son también una dependencia previa del enable activo: `production_bootstrap` no declara bindings y por eso sigue inerte aunque los dos recursos ya existan; `env.production` sí declara el productor, consumidor y DLQ. Si cualquiera de los nombres exactos ya existe antes de provisionar, el runner se detiene y no lo reutiliza ni modifica.

Plan y ejecución separada:

```bash
pnpm launch:cloudflare-production-queues
# solo tras revisar el inventario read-only y aprobar literalmente el alcance emitido:
pnpm launch:cloudflare-production-queues -- --execute-approved
# una vez creadas, verificación read-only separada antes del enable final:
pnpm launch:cloudflare-production-queues -- --verify-existing
```

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

## Gate Web Final: Secrets Y Transición Activa

El runner final `pnpm launch:cloudflare-production-worker-secrets` permanece separado y no se llama durante el bootstrap. Con `--execute-approved`, la aprobación exacta solo se acepta desde el entorno inicial del proceso: el fichero dotenv seguro aporta valores, pero nunca consentimiento. Además, un gate canónico estable bloquea cualquier reinicio si existe un lock o checkpoint pendiente de una ejecución anterior. Antes del primer `wrangler secret put` final debe validar:

- aprobación exacta y cuenta Cloudflare `d1a22bcf6477ff2ff31d2bfb83084e44` tanto localmente como mediante `wrangler whoami --json`;
- Worker exacto `espanolhonesto` y una versión desplegada obtenida read-only;
- Supabase ref `vkkahxsybhbutszerawz` en URL y ref esperado;
- `PUBLIC_APP_ENV=production`, `WORKER_IDENTITY=espanolhonesto` y sitio canónico;
- claves Stripe `sk_live_`/`pk_live_`, cuenta `acct_` explícita y checkout todavía cerrado;
- modo email `live` con topes máximos 80 destinatarios/día y 2400/mes;
- URL directa exacta `https://espanolhonesto.alindev95.workers.dev`.
- evidencia phase-1 realmente ejecutada y probada, no un plan;
- inventario remoto bootstrap exactamente `INTERNAL_JOB_SECRET`, la versión remota exacta sin ninguno de los cinco bindings Google y bootstrap probado por salud + 503 + HMAC.

Si falla cualquier comparación, no empieza ninguna escritura.

Antes del primer secret write, el mismo runner ejecuta `build:production:release` desde un `dist` vacío con la subida de sourcemaps a Sentry desactivada, valida el `dist/server/wrangler.json` resuelto (`production`, `WEB_RUNTIME_MODE=active`, service binding exacto, checkout falso, sin routes/crons) y hace `wrangler deploy --config dist/server/wrangler.json --dry-run`. Justo antes de mutar adquiere un lock exclusivo estable. Cada `secret put`, deploy activo y deploy compensatorio registra y fuerza a disco un checkpoint write-ahead atómico antes de invocar al provider. Timeout, error de spawn y salida no cero quedan como resultado desconocido, nunca como `false`, y prohíben reintentar hasta una conciliación read-only.

Después de los secrets se exige el inventario exacto completo, `versions view` de la versión exacta sin ningún binding Google y bootstrap probado de nuevo antes del deploy activo. La atestación schema 5 liga por HMAC fingerprints SHA-256 no reversibles e independientes de `PUBLIC_SENTRY_DSN`, `ADMIN_EMAIL`, `SUPPORT_ALERT_EMAIL` y `RESEND_FROM_EMAIL`; este último se prueba aunque `EMAIL_FROM` domine como remitente efectivo. El mismo inventario exacto, inspección de versión sin Google y atestación se repiten tras el deploy activo y tras cualquier compensación. Solo la prueba exacta mueve los checkpoints canónicos de `pending` a `resolved`; solo cuando no queda ninguno se libera el lock.

Si el proceso se interrumpe, el modo normal queda bloqueado y no se borran archivos a mano. La recuperación se ejecuta en el mismo runner con `--reconcile-approved` y la frase exacta separada que muestra su plan. Esa aprobación debe llegar en `CLOUDFLARE_WORKER_SECRETS_RECONCILIATION_APPROVAL` desde el entorno inicial. Los locks son directorios con owner canónico (`lockId`, `runId`, host y PID): solo su owner exacto puede liberarlos mediante rename atómico, y el modo normal también queda bloqueado mientras exista el lock secundario. Recovery solo adopta el lock primario original si pertenece al mismo host y su PID está definitivamente muerto; revalida ambos owners antes de cualquier write compensatorio y antes de liberarlos. Un lock exclusivo impide dos recuperaciones concurrentes.

La recuperación no hace `secret put`: primero repite `whoami`, deployment/version, inventario allowlisted, ausencia total de bindings Google y salud/HMAC; clasifica `active` o `bootstrap`. Si ya había empezado una compensación o el runtime no queda probado, solo puede generar y desplegar el bootstrap inerte. Tras probar el estado seguro, mueve los checkpoints pendientes a `resolved` conservando como desconocido cualquier resultado histórico que no pueda demostrarse, y libera primero el lock primario mientras el secundario sigue bloqueando entradas normales; después libera el secundario por owner-CAS.

El cierre exige una versión nueva, rutas modernas accesibles en la URL `workers.dev` y atestación HMAC `WEB_RUNTIME_MODE=active` con `CHECKOUT_ENABLED=false`. Si el deploy activo falla, expira o su readback queda ambiguo, la misma autorización cubre únicamente la compensación automática: build limpio `production_bootstrap`, deploy de su config resuelta y prueba de nueva versión + salud bootstrap + 503 + HMAC. Si tampoco puede probarse la compensación, el estado remoto queda ambiguo y el lanzamiento se detiene.

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

Antes de invocarla, el operador debe ejecutar `pnpm launch:cloudflare-production-queues -- --verify-existing` en modo read-only como evidencia operativa temprana. El runner de enable no crea, borra ni adopta Queues, pero ya no confía solo en ese summary: inmediatamente antes del write pagina el inventario remoto completo, exige una única Queue y DLQ con los nombres exactos y ejecuta `queues info` para ambas.

`pnpm launch:cloudflare-production-fulfillment-enable` es el único camino que despliega `--env production`. En modo plan no llama a Cloudflare. La ejecución aprobada se niega a escribir si falta cualquiera de estas pruebas:

- cuenta y URL directa exactas;
- una nueva lectura de la versión bootstrap, con salud `bootstrap`, bloqueo operativo `503`, HMAC exacta y cero Cron Triggers;
- una nueva lectura de la versión desplegada del Worker web `espanolhonesto`, con HMAC exacta de su configuración;
- todos los secret names requeridos;
- inventario e `info` frescos de `espanol-honesto-fulfillment-production-queue` y `espanol-honesto-fulfillment-production-dlq`;
- una consulta Stripe Live fresca y read-only que pruebe cuenta ES/EUR, charges+payouts, Portal y webhook exactos;
- ambas atestaciones ejecutadas en este mismo proceso inmediatamente antes del write; ningún summary local basta por sí solo;
- dry-run activo correcto.

Estas pruebas se guardan en `enable-prewrite-evidence.json`, sin secretos, con schema/target/timestamps/versiones y SHA-256 de la aprobación exacta. Debe tener menos de cinco minutos y validarse de nuevo antes de fijar `externalWriteAttempted=true`.

La aprobación exacta `CLOUDFLARE_FULFILLMENT_ENABLE_APPROVAL` debe llegar en el entorno inicial del proceso. Se captura antes de cargar `.env.production`; el fichero puede aportar configuración y secretos, pero nunca autoriza el enable. La identidad se acepta únicamente si el JSON estructurado de `wrangler whoami --json` contiene exactamente una coincidencia con la cuenta aprobada.

Solo entonces el runner persiste atómicamente el checkpoint durable `outputs/launch-cloudflare-production-fulfillment-enable/checkpoint.json` con estado `pending`, revisión monotónica, hash de la aprobación y hash de la evidencia. Cada transición usa CAS: relee la revisión y el contenido esperado antes del rename y no permite que un intento nuevo reemplace un checkpoint `pending`, `ambiguous` o `proven`. Después fija `externalWriteAttempted=true` y lanza el deploy que activa `FULFILLMENT_RUNTIME_MODE=active`, `EMAIL_DELIVERY_MODE=live`, límites 80/día y 2400/mes, y cron `0 * * * *`. Desde `pending`, `externalWritePerformed` se considera `unknown` hasta demostrar una versión activa (`proven`) o un bootstrap compensado (`compensated`).

Toda la reconciliación y el enable se ejecutan bajo el lock canónico `outputs/launch-cloudflare-production-fulfillment-enable/execution.lock`, creado de forma exclusiva con owner UUID, PID, hostname y target exacto. Otro proceso del mismo checkout no puede leer-modificar-escribir el lifecycle ni llamar a Wrangler. El lock solo se recupera automáticamente si su owner es válido, pertenece al mismo host, ha superado el umbral de seguridad y el PID está definitivamente muerto; owner corrupto, host distinto o liveness inconclusa bloquean el proceso. Ownership se revalida antes de cada CAS, deploy activo y compensación. El lock es deliberadamente local al checkout compartido: no sustituye coordinación remota entre máquinas distintas.

Si el comando activo falla, expira o devuelve una respuesta que no permite saber si Cloudflare aplicó el write, o si falla cualquier verificación posterior de versión, salud, HMAC o cron, el runner ejecuta automáticamente un deploy compensatorio de `production_bootstrap`. El rollback solo se considera probado si una versión nueva recién listada demuestra a la vez modo `bootstrap`, bloqueo operativo `503`, HMAC/configuración exacta y lista remota de schedules vacía. Si no puede probar las cuatro condiciones, persiste `ambiguous`, mantiene el lanzamiento bloqueado y exige intervención manual.

Al arrancar, un checkpoint `pending` o `ambiguous` bloquea cualquier intento nuevo. Bajo una aprobación exacta nueva, el runner reconcilia primero el estado remoto: si `compensationAttempted=false` todavía puede probar activo y marcar `proven`; si la compensación ya empezó, nunca acepta active y avanza exclusivamente hasta desplegar y probar bootstrap `compensated`. No se debe borrar ni editar el checkpoint para saltarse la reconciliación; tras una compensación probada, una ejecución aprobada posterior puede iniciar un intento nuevo.

Un checkpoint histórico `proven` tampoco se acepta por sí solo. Cada ejecución vuelve a listar la versión remota y exige coincidencia exacta con `activeVersionId`, salud active, atestación HMAC ligada a esa versión y Cron horario. Cualquier divergencia se persiste primero como `ambiguous`, bloquea el éxito y solo permite la compensación porque esta misma ejecución ya superó la aprobación exacta y la identidad Cloudflare. Si el CAS de `ambiguous` falla, no comienza la compensación.

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
- Parar el enable si el preflight temprano o la comprobación fresca interna detectan Queue/DLQ ausente, duplicada, con nombre distinto o `info` ilegible. El runner no crea, borra ni reutiliza Queues.
- Parar antes de dominios si falla cualquier atestación.
- Mantener los dominios en Pages y `CHECKOUT_ENABLED=false` durante toda la preparación.
- Si falla una carga de secreto, corregir solo ese nombre bajo una nueva aprobación exacta; no borrar Workers ni Pages.
- Si el deploy activo falla o su verificación posterior no cierra, el runner intenta inmediatamente restaurar `production_bootstrap` y lo prueba por versión + salud + 503 + HMAC + schedules vacíos.
- Si el rollback compensatorio no queda completamente probado, tratar el estado remoto como ambiguo: no activar dominios, checkout, smoke ni jobs; inspeccionar Cloudflare y ejecutar una recuperación manual aprobada antes de continuar.
