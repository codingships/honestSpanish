# Environment

No commitear valores reales. Los archivos `.env*` reales estan ignorados por Git; solo se pueden commitear `.env.example` y `.env.*.example`.

## Entornos

| Entorno | Uso | URL | Rama | Datos |
| --- | --- | --- | --- | --- |
| dev | Trabajo local | `http://localhost:4321` | ramas locales | Puede apuntar a staging o a servicios de prueba |
| staging | Pruebas reales antes de publicar | `https://espanolhonesto-staging.alindev95.workers.dev` | `staging` | Datos y servicios de prueba |
| production | Servicio real | `https://espanolhonesto.com` | `main` | Datos, pagos y alumnos reales |

## Mapa Operativo Actual (2026-07-10)

| Capa | Staging confirmado | Production confirmado | Estado/accion |
| --- | --- | --- | --- |
| Web Cloudflare objetivo | Worker `espanolhonesto-staging` en `https://espanolhonesto-staging.alindev95.workers.dev` | Worker objetivo `espanolhonesto` | Staging existe. El Worker production aun no existe. |
| Web Cloudflare legado | Pages `espanol-honesto-staging` | Pages `espanolhonesto`, todavia asociado a los dominios finales | No borrar ni mover dominios hasta probar el Worker production por URL directa y aprobar el cutover. |
| Fulfillment | Worker `espanol-honesto-fulfillment-staging`, conectado al web por `FULFILLMENT_SERVICE` | Worker objetivo `espanol-honesto-fulfillment-production` y binding production pendiente | Staging existe, tiene cron/secrets y pasó el smoke integral. Production aun no existe. |
| Supabase | Proyecto `mzjyvmlxfpzdfdjzxxyj` | Proyecto `vkkahxsybhbutszerawz` | Proyectos separados. Aplicar y verificar migraciones staging primero; la nueva atestacion 18+ requiere `20260710120000_enforce_adult_lead_attestation.sql`. |
| Stripe | Test mode | Live mode en ventana final | No mezclar keys, Prices, clientes ni webhook secrets. El default queda cerrado y `CHECKOUT_ENABLED_OVERRIDE` abre/cierra UI y API. |
| Google | Carpeta `STAGING - Espanol Honesto` y plantilla `STAGING - Plantilla de clase`, confirmadas sin crearlas de nuevo | Raiz/plantilla production existentes | Drive/template separados. Calendar usa el mismo modelo `primary` de `GOOGLE_ADMIN_EMAIL`; no existe calendar ID por entorno. |
| Resend | Credencial staging local presente; debe operar solo en `allowlist` | Pendiente de verificacion production | Pasarela unica fail-closed y presupuesto persistente pendientes de desplegar con `20260710083915_enforce_resend_recipient_budget.sql`. Reserva staging 10 destinatarios/dia y 100/mes; production 80/dia y 2.400/mes. |
| Sentry | `.env.staging` local no captura; CI/deploy necesita DSN y `SENTRY_ORG`/`SENTRY_PROJECT` | Pendiente de alertas y scrubbing final | Sin org/project no se suben sourcemaps aunque exista token. |
| Turnstile | Pendiente verificar widget y dominios staging | Pendiente verificar dominios finales | Site key y secret separados por entorno cuando sea posible. |

Gate externo obligatorio de renovación: en cada endpoint webhook de Stripe (test en staging y live en production), habilitar `invoice.upcoming` y configurar el aviso de factura próxima a 15 días. Confirmar con entrega real de prueba que el evento llega al endpoint correcto antes de activar cobros; el código local no puede cerrar este gate del Dashboard de Stripe.

El entorno local por defecto es staging: `pnpm dev` sincroniza primero un `.dev.vars.staging` allowlisted desde `.env.staging`, fija `CLOUDFLARE_ENV=staging` y arranca Astro con `--mode staging`. `astro.config.mjs` rechaza staging local si falta ese archivo. `pnpm dev:production-data` fija `CLOUDFLARE_ENV=production` mediante un runner separado y nunca es el comando normal de QA. La antigua `.dev.vars` raiz no debe existir porque `@astrojs/cloudflare` la carga siempre en `process.env`; los valores production locales viven en `.dev.vars.production`. El sync staging copia solo Supabase y claves web opcionales que esten explicitamente en `.env.staging`, exige Stripe test si aparece y excluye Google, Resend, DB URLs y usuarios de test. `.env.staging` apunta al proyecto staging y conserva los recursos Google para el Fulfillment Worker, no para el Worker web.

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

- Cloudflare Astro Worker: secretos de la app Astro/SSR.
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
| Supabase | `PUBLIC_SUPABASE_URL`, `PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_EXPECTED_PROJECT_REF`, `SUPABASE_DB_URL` operativo | Cloudflare Astro Worker, Fulfillment Worker, GitHub, migraciones locales | El guard compara build, runtime y ref esperada; cualquier mezcla falla cerrada. |
| Stripe | `STRIPE_SECRET_KEY`, `PUBLIC_STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_EXPECTED_ACCOUNT_ID`, `STRIPE_PORTAL_CONFIGURATION_ID`, `CHECKOUT_ENABLED`, `CHECKOUT_ENABLED_OVERRIDE`, `STRIPE_EXPECTED_WEBHOOK_HOSTS` | Cloudflare Astro Worker, GitHub | Test y live separados; live solo en production. Portal fijado por ID, sin cambios de plan y cancelacion al final del periodo. |
| Cloudflare internals | binding `FULFILLMENT_SERVICE`, `FULFILLMENT_WORKER_URL`, `INTERNAL_JOB_SECRET`, `CRON_SECRET` | Astro Worker, Fulfillment Worker, GitHub | El binding no es secreto y debe apuntar al Worker del mismo entorno. `INTERNAL_JOB_SECRET`/`CRON_SECRET` deben ser distintos por entorno. |
| Google | `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`, `GOOGLE_ADMIN_EMAIL`, `GOOGLE_DRIVE_ROOT_FOLDER_ID`, `GOOGLE_TEMPLATE_DOC_ID` | Fulfillment Worker | Crear clave nueva, validar, borrar antigua. |
| Resend | `RESEND_API_KEY`, `EMAIL_FROM`, `RESEND_FROM_EMAIL`, `EMAIL_DELIVERY_MODE`, `EMAIL_RECIPIENT_ALLOWLIST`, limites de destinatarios | Astro Worker y Fulfillment Worker | Validar envio antes de revocar. Cada destinatario consume una unidad; staging y production comparten el margen del plan si usan la misma cuenta Resend. |
| Turnstile | `PUBLIC_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | Cloudflare Astro Worker | Revisar dominios permitidos si cambia site key. |
| Sentry | `PUBLIC_SENTRY_DSN`, `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_CAPTURE_LOCAL`, `SENTRY_ENVIRONMENT`, `SENTRY_MAX_UNRESOLVED_ISSUES`, `SENTRY_UPLOAD_SOURCEMAPS` | App build, GitHub/CI | Token de auth es secreto; DSN es publico pero entorno-especifico. `SENTRY_ORG`/`SENTRY_PROJECT` hacen determinista la auditoria read-only y la subida de sourcemaps. `SENTRY_CAPTURE_LOCAL=false` evita que dev/QA local contamine Sentry production; `SENTRY_ENVIRONMENT` es override opcional. `SENTRY_MAX_UNRESOLVED_ISSUES` solo controla el umbral local de warning en `pnpm launch:sentry-readonly`; no modifica Sentry. |
| GitHub/Cloudflare deploy | `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | GitHub Environments | Token con permisos minimos y aprobacion production. |

## Cloudflare Astro Worker

Crear dos Workers desde `wrangler.toml`:

El nombre base es deliberadamente `espanolhonesto-env-required`; nunca es production. Todo comando remoto debe seleccionar `--env staging` o `--env production`, de modo que un deploy accidental sin entorno no pueda sobrescribir `espanolhonesto`.

- `espanolhonesto-staging`
  - `CLOUDFLARE_ENV=staging`
  - URL estable del Worker: `https://espanolhonesto-staging.alindev95.workers.dev`
  - Custom domain futuro opcional: `staging.espanolhonesto.com` (no configurado)
- `espanolhonesto`
  - `CLOUDFLARE_ENV=production`
  - Custom domain: `espanolhonesto.com`

Variables por entorno:

- `PUBLIC_SITE_URL`
- `PUBLIC_APP_ENV`
- `PUBLIC_SUPABASE_URL`
- `PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_EXPECTED_PROJECT_REF` (`mzjyvmlxfpzdfdjzxxyj` staging; `vkkahxsybhbutszerawz` production)
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `PUBLIC_STRIPE_PUBLISHABLE_KEY`
- `STRIPE_EXPECTED_ACCOUNT_ID`
- `STRIPE_PORTAL_CONFIGURATION_ID`
- `STRIPE_EXPECTED_WEBHOOK_HOSTS` opcional para sobrescribir el host esperado. Sin override, el auditor exige `espanolhonesto-staging.alindev95.workers.dev` en staging y el canonico `espanolhonesto.com` en production; no se configura un webhook duplicado en `www`.
- `CHECKOUT_ENABLED=false` hasta decidir pagos reales o checkout test deliberado.
- `CHECKOUT_ENABLED_OVERRIDE=false` o ausente hasta la activacion exacta; `true` solo despues del Go/No-Go y `false` como rollback inmediato.
- `PUBLIC_TURNSTILE_SITE_KEY`
- `TURNSTILE_SECRET_KEY`
- `PUBLIC_SENTRY_DSN`
- `SENTRY_AUTH_TOKEN` solo en CI/build/herramientas; no cargarlo como secret del Worker web de request runtime.
- `SENTRY_ORG` y `SENTRY_PROJECT` opcionales para `pnpm launch:sentry-readonly`, recomendados para CI/deploy y sourcemaps.
- `SENTRY_CAPTURE_LOCAL=false` por defecto; poner `true` solo para depurar captura local deliberada sin mezclarla con production.
- `SENTRY_ENVIRONMENT` opcional; si falta, captura local opt-in usa `local-<NODE_ENV>` y entornos desplegados usan `PUBLIC_APP_ENV`.
- `SENTRY_MAX_UNRESOLVED_ISSUES=0` por defecto para que cualquier issue sin resolver en el entorno auditado deje warning QA; subirlo solo con aceptacion explicita de riesgo.
- `pnpm launch:sentry-production-hardening` usa el token solo para un preflight de proyecto/workflows/detector/owner. Sin aprobacion literal es GET-only; su ejecucion aprobada se limita a scrub de IP y dos workflows email en `production` y no persiste IDs, miembros ni tokens.
- `SENTRY_UPLOAD_SOURCEMAPS` opcional; solo `true` para subidas locales intencionales. En CI/deploy se permite por `CI=true`.
- `CRON_SECRET`
- `FULFILLMENT_WORKER_URL`
- `INTERNAL_JOB_SECRET`
- Service binding `FULFILLMENT_SERVICE` al Fulfillment Worker del mismo entorno. Debe existir en staging y production; el target se despliega primero.
- `SUPPORT_ALERT_EMAIL` opcional; si falta, soporte usa `ADMIN_EMAIL` y despues `alejandro@espanolhonesto.com`.
- `RESEND_API_KEY`, `EMAIL_FROM`/`RESEND_FROM_EMAIL` para los emails de lead, soporte y previews que salen desde el Astro Worker.
- `EMAIL_DELIVERY_MODE`: ausente/`disabled` falla cerrado; staging solo puede usar `allowlist`; `live` solo funciona con `PUBLIC_APP_ENV=production`.
- `EMAIL_RECIPIENT_ALLOWLIST`: destinatarios separados por coma o punto y coma para staging; no guardar esta lista en el repo si contiene direcciones reales.
- La allowlist de staging queda limitada a las tres cuentas propias de prueba ya definidas como `TEST_ADMIN_EMAIL`, `TEST_TEACHER_EMAIL` y `TEST_STUDENT_EMAIL`. Sus valores se copian al secreto `EMAIL_RECIPIENT_ALLOWLIST` de ambos Workers staging, nunca al repositorio.
- El smoke integral mapea esas mismas cuentas a `SMOKE_ADMIN_*`, `SMOKE_TEACHER_*` y `SMOKE_STUDENT_*`; no acepta aliases/destinatarios `example.com`, no crea usuarios y no necesita acceso al buzon del alumno. La comprobacion de email usa respuesta/estado del proveedor.
- `EMAIL_DAILY_RECIPIENT_LIMIT` y `EMAIL_MONTHLY_RECIPIENT_LIMIT`: staging tiene techo 10/100 y production 80/2.400, aunque se configuren cifras superiores.

Cloudflare Astro Worker no necesita claves Google si ninguna ruta API importa Google SDK. En Cloudflare debe usar `FULFILLMENT_SERVICE.fetch(...)`; el fallback por URL queda reservado a local y los entornos desplegados fallan cerrados si falta el binding.

## Cloudflare Fulfillment Worker

- `FULFILLMENT_RUNTIME_MODE`: cualquier valor distinto de `active` bloquea rutas operativas y eventos scheduled. `production_bootstrap` usa `bootstrap`; staging y la habilitación final production usan `active` explícitamente.

Crear dos Workers desde `workers/fulfillment/wrangler.toml`:

El nombre base es `espanol-honesto-fulfillment-env-required`; nunca es production. El config y el `--env` deben ser explicitos en todo dry-run/deploy/secret command.

- `espanol-honesto-fulfillment-staging`
  - Health check: `/health`
  - Queue: `espanol-honesto-fulfillment-staging-queue`
  - DLQ: `espanol-honesto-fulfillment-staging-dlq`
- `espanol-honesto-fulfillment-production`
  - Health check: `/health`

El Fulfillment Worker activo declara un cron horario (`0 * * * *`) para reconciliar jobs pendientes y recordatorios. En staging, `FULFILLMENT_QUEUE` publica señales `process_due` y el mismo Worker las consume con batch/concurrencia uno, cinco reintentos y DLQ; así Google/Resend no dependen de los 30 segundos posteriores a una respuesta HTTP. Supabase `fulfillment_jobs` conserva el estado durable. Staging se despliega activo antes del Astro Worker. Production se crea primero con el entorno `production_bootstrap`: `FULFILLMENT_RUNTIME_MODE=bootstrap`, email desactivado, cuotas cero, `crons=[]` y rutas operativas bloqueadas con 503. Después se despliega el Astro Worker que declara `FULFILLMENT_SERVICE`, se cargan secrets mientras fulfillment sigue inerte y solo un gate final separado despliega `--env production`. La Queue production no se crea ni se vincula durante staging. No usar `fetch()` público entre Workers de la misma cuenta.

Despliegue:

```bash
pnpm fulfillment:typecheck
pnpm exec wrangler deploy --config workers/fulfillment/wrangler.toml --env staging --dry-run
pnpm exec wrangler deploy --config workers/fulfillment/wrangler.toml --env staging --keep-vars
pnpm exec wrangler deploy --config workers/fulfillment/wrangler.toml --env production_bootstrap --dry-run
pnpm exec wrangler deploy --config workers/fulfillment/wrangler.toml --env production --dry-run
pnpm launch:cloudflare-production-fulfillment-bootstrap
pnpm launch:cloudflare-production-fulfillment-bootstrap-secrets
pnpm launch:cloudflare-production-fulfillment-secrets
pnpm launch:cloudflare-production-fulfillment-enable
```

No usar `pnpm --filter ... run deploy -- --env ...`: el script del paquete ya selecciona staging y produciria dos `--env`. CI ejecuta primero dry-run y después un único deploy inequívoco solo para staging. En production no hay deploy automático ni comando raw documentado: se usan los tres gates anteriores.

Para production, el bootstrap inerte se despliega antes del web Worker. `pnpm launch:cloudflare-production-fulfillment-bootstrap-secrets` carga solo `INTERNAL_JOB_SECRET`, rechaza nombres de providers y atestigua su ausencia con salud/bootstrap/bloqueo 503 y cron vacío. `pnpm launch:cloudflare-production-fulfillment-secrets` queda para la ventana final y carga Supabase/Google/Resend mientras el runtime aún está inerte. `pnpm launch:cloudflare-production-fulfillment-enable` es la aprobación distinta que, tras probar web + secrets + atestación, activa runtime, email live 80/día y 2.400/mes y cron horario. Ver `docs/launch/CLOUDFLARE_PRODUCTION.md`.

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
- `EMAIL_DELIVERY_MODE`
- `EMAIL_RECIPIENT_ALLOWLIST`
- `EMAIL_DAILY_RECIPIENT_LIMIT`
- `EMAIL_MONTHLY_RECIPIENT_LIMIT`
- `INTERNAL_JOB_SECRET`
- `CRON_SECRET`

`INTERNAL_JOB_SECRET` debe ser igual en Cloudflare Astro Worker y Cloudflare Fulfillment Worker para el mismo entorno, y distinto entre staging y production.

Resend usa una sola pasarela para todos los envios de ambos Workers. Antes de llamar al proveedor reserva de forma atomica el numero de destinatarios en Supabase para el dia y el mes UTC; ambos Workers comparten contador y todos los runtimes distintos de production comparten el scope `nonproduction`, sin override configurable. Si falta la migracion, la configuracion, la allowlist o el servicio de presupuesto, no envia. Una reserva no se devuelve cuando Resend rechaza el correo: el conteo conservador evita reintentos que excedan la cuota. Si staging y production usan la misma cuenta Free, sus asignaciones maximas combinadas son 90 destinatarios/dia y 2.500/mes, dejando margen bajo 100/3.000.

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
- `SENTRY_ORG`
- `SENTRY_PROJECT`
- `CRON_SECRET`
- `FULFILLMENT_WORKER_URL`
- `INTERNAL_JOB_SECRET`
- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

Variables por environment:

- `PUBLIC_SITE_URL`
- `PUBLIC_APP_ENV`
- `CHECKOUT_ENABLED=false` hasta cierre deliberado de pagos.
- `CHECKOUT_ENABLED_OVERRIDE=false` o ausente hasta la ventana de activacion.
- `CLOUDFLARE_STAGING_URL`
- `CLOUDFLARE_WORKERS_STAGING_URL` opcional si se quiere separar el nombre de la URL publica.

Valores actuales:

- Worker staging: `espanolhonesto-staging`
- Worker production: `espanolhonesto`
- URL staging preferida para probes RC/no-real-payments: `https://espanolhonesto-staging.alindev95.workers.dev`
- Dominio custom staging opcional futuro: `https://staging.espanolhonesto.com`. No esta configurado y no debe usarse en probes ni comandos hasta verificar DNS, SSL y routing.

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

Production Supabase se prepara con runners separados y fail-closed:

- `pnpm launch:supabase-production-readonly-preflight` consulta exclusivamente `espanol-honesto` (`vkkahxsybhbutszerawz`, `eu-west-1`) con `default_transaction_read_only=on`; inventaria versiones/nombres remotos, hashes y orden local, y guarda solo metadatos y conteos agregados.
- `pnpm launch:supabase-production-rollout-plan` es local/plan-only: no conecta a Supabase, no genera SQL de limpieza ni bundles de aplicacion, separa autorizaciones y produce manifiesto, plantillas de backup/preservacion, frases exactas, verificacion y rollback.
- `pnpm launch:supabase-production-logical-backup` crea, solo con aprobacion exacta, un dump custom `public` + `auth` fuera del repositorio en un directorio Windows EFS verificado. Su recibo no contiene la ruta ni credenciales.
- `pnpm launch:supabase-production-fixture-cleanup` previsualiza y ejecuta el manifiesto v2 vinculado al backup: borra fixtures publicos exactos, elimina `public.jobs` sin `CASCADE`, conserva cuatro paquetes y no toca Auth, Storage ni proveedores externos.
- `pnpm launch:supabase-production-auth-cleanup` separa reduccion/cuarentena y finalizacion: primero deja dos Auth sin perfiles; despues de las 23 migraciones en siete olas y del vencimiento de la cuarentena crea los dos perfiles minimos.
- `pnpm launch:production-availability` solo se habilita despues de un `auth-policy-receipt.json` cerrado: fija el profesor preservado y crea L-V 09:00-18:00 en `Europe/Madrid`, con preflight y verificacion exactos.
- `pnpm launch:supabase-production-rollout` es plan-only por defecto. Su ejecucion final exige evidencia fresca y vinculada de preflight, backup, limpieza publica, Auth en cuarentena, politica Google, hardening staging y Sentry production `HARDENED_AND_VERIFIED`, mas aprobacion exacta y atestacion de checkout desactivado.

El inventario read-only de 2026-07-12 encontro 45 migraciones locales actuales y 24 entradas remotas. La reconciliacion nueva `20260712112000_reconcile_database_model_contract.sql` eleva a 23 las migraciones semanticas pendientes para production, excluyendo `20260710150000_staging_integration_smoke_runs.sql`, que es exclusivamente staging y nunca se aplica a production. Primero debe pasar en staging junto con `20260712114000` y `20260712114500`, en ese orden exacto; el mismo receipt cierra modelo, disponibilidad y signup 18+ antes de autorizar production.

No usar `supabase db push` contra este historial divergente ni `supabase migration repair` para igualarlo visualmente. Los aliases y el choque de nombre se verifican por efectos de esquema; no se reaplican a ciegas. La primera ola contiene solo `20260703211451_drop_processed_webhook_processed_at_default.sql`; la segunda es `base_model_reconciliation` y las otras cinco conservan su orden de dependencias. Las seis posteriores a `processed_at_small_fix` exigen backup y cierre de fixtures previo. El runner verifica cada ola y emite el recibo final solo tras las 23 migraciones. La migracion staging-only permanece ausente y checkout permanece desactivado durante todo el rollout.

El runner historico `pnpm launch:supabase-processed-at-cleanup-runner` esta retirado para escrituras y falla antes de red/SQL aunque se pase `--execute-approved`. Staging ya registra `20260703211451`; el cierre pendiente es exclusivamente production y se hace con `pnpm launch:supabase-production-rollout -- --through processed_at_small_fix --preflight <summary.json>`, o dentro del rollout completo de 23 migraciones. Solo se marca el P3 como `Fixed` despues del receipt de la ola y de un preflight read-only fresco con ambos defaults `NULL` y agregados webhook limpios.

La pasarela de email requiere aplicar `supabase/migrations/20260710083915_enforce_resend_recipient_budget.sql` primero en staging y despues en production. La tabla solo contiene contadores agregados, tiene RLS y la funcion de reserva es ejecutable exclusivamente por `service_role`.

## Stripe

- Staging: Sandbox general dedicado `espanolhonesto-staging`, creado desde cero y configurado como España/EUR, siempre con `sk_test_` y `STRIPE_EXPECTED_ACCOUNT_ID` exacto. La activacion comercial de la cuenta no se exige para pruebas. No reutilizar el test mode clasico `acct_1SnNnoFhBCkSD61w` (Estados Unidos/USD) ni sus objetos antiguos/smoke.
- Production: live mode, activado solo en la ventana final porque se aceptaran pagos reales desde el primer dia.
- `CHECKOUT_ENABLED=false` sigue siendo el default versionado. `CHECKOUT_ENABLED_OVERRIDE=true` es el interruptor final; devolverlo a `false` bloquea tanto la UI como `/api/create-checkout` antes de Supabase o Stripe.
- Para el smoke staging, `CHECKOUT_ENABLED_OVERRIDE=false` es obligatorio durante toda la ejecucion. `launch:staging-smoke-rehearsal-runner` atestigua el runtime cerrado y exige el probe 403; no escribe Cloudflare.
- El smoke reutiliza una Checkout test ya completada y reconciliada. El bootstrap estrecho no forma parte del flujo activo. `scripts/smoke-checkout.ts --bootstrap-preserve-open --manual-exception` queda solo como herramienta excepcional: no cambia Cloudflare y exige que un propietario externo abra temporalmente el gate, asuma su rollback y restaure/verifique `CHECKOUT_ENABLED_OVERRIDE=false` con probe 403 antes de usar la URL.
- El rehearsal integral consulta primero `/api/calendar/available-slots`. Si las cuentas de staging no tienen ningun hueco canonico, puede crear una sola fila temporal `teacher_availability` con UUID generado antes del insert y debe borrarla y verificar su ausencia en `finally`; esto sirve solo para probar el flujo y no sustituye configurar el horario operativo real antes de abrir reservas.
- El subprocess con writes no usa timeout duro del runner: debe devolver control despues de ejecutar su cleanup en `finally`. Si un operador lo termina a la fuerza, el resultado queda fallido/ambiguo y requiere conciliacion manual.
- Ciclo billing canonico: `STAGING_BILLING_CHECKOUT_SESSION_ID=cs_test_...` selecciona la compra; `STAGING_BILLING_LIFECYCLE_CONFIRMATION=I_CONFIRM_STAGING_BILLING_LIFECYCLE:<same-session>` es el gate exacto de mutacion. Usar `pnpm launch:staging-billing-lifecycle:preflight`, despues `pnpm launch:staging-billing-lifecycle` y solo ante interrupcion con checkpoint valido `pnpm launch:staging-billing-lifecycle:resume`. Los checkpoints atomicos viven en `outputs/launch-staging-billing-lifecycle/checkpoints/<session>.json`; no se editan ni borran para forzar una repeticion.
- Variables manuales del rehearsal integral: `SMOKE_COMPLETED_CHECKOUT_SESSION_ID=cs_test_...` y `SMOKE_BILLING_LIFECYCLE_EVIDENCE_PATH=outputs/launch-staging-billing-lifecycle/<timestamp>/summary.json`. La ruta de evidencia debe ser explicita, estar bajo el workspace y demostrar `OK`, cuenta/proyecto/test, sesion exacta, checkpoint `complete`, mutacion autorizada, estados terminales y revalidacion viva; sustituye cualquier confirmacion manual no verificable. El subprocess `real-env-smoke.ts --preflight-only` valida ambas, catalogo, cuenta/modo, roles/allowlist y gate antes de cualquier write.
- `scripts/smoke/real-env-smoke.ts` es staging-only (Supabase `mzjyvmlxfpzdfdjzxxyj`, Stripe `sk_test_`, host Worker exacto). Production usa un smoke minimo/manual y nunca este arnes.
- Antes de activar: cuenta live española con datos, cobros y payouts habilitados; tres ofertas live por paquete en `package_prices`; Customers vinculados a cuenta/modo; webhook live; Portal live fijado por `STRIPE_PORTAL_CONFIGURATION_ID`; avisos, compra y reembolso probados.
- Webhook secret diferente por entorno.
- `pnpm launch:stripe-readonly` audita production y `pnpm launch:stripe-readonly:staging` combina Stripe test con Supabase staging de forma explicita. Ambos exigen cuenta España/EUR, project ref exacto, Portal fijado con historial de facturas/actualizacion de pago/cancelacion al final del periodo y exactamente un webhook habilitado en el host esperado con exactamente los ocho eventos de `src/lib/stripe-webhook-events.ts`; un host antiguo o eventos incompletos dejan el auditor en `FAILED`, igual que un duplicado, un evento extra o uno ausente. Una cuenta test sin cobros/payouts puede quedar en `WARNING`, pero en production tambien deja el auditor en `FAILED`.
- `packages` guarda punteros activos; `package_prices` conserva el contrato y el historico. No reutilizar Customers, Products, Prices, webhooks ni configuraciones Portal entre test/live.

## Google

Staging y production deben tener carpetas y templates diferenciados.

Estado confirmado 2026-07-10: la carpeta `STAGING - Espanol Honesto` y la plantilla `STAGING - Plantilla de clase` ya existen y se descubrieron con `--discover-only`; `.env.staging` fue actualizado localmente sin imprimir IDs. El Worker staging lista los cinco secretos Google requeridos por nombre, pero sus valores son opacos: antes del smoke hay que reestablecer explicitamente los dos IDs staging o probarlos mediante un smoke con cleanup.

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

Riesgo aceptado actual: se mantiene service account con domain-wide delegation para esta fase. Los controles compensatorios son no guardar claves en repo/docs/outputs/logs, guardar secretos solo en KeePassXC y secret managers, aislar Google SDK en el Fulfillment Worker, separar carpetas/templates por entorno, rotar la clave antes del Go/No-Go publico y revisar scopes delegados durante esa rotacion. Si una clave puede haberse filtrado, no se vuelve a una clave vieja: se pausa el flujo afectado, se rota la clave, se revoca la anterior, se redepliega el Worker y se valida Drive/Calendar/Docs/Meet.

## Local/E2E

- `.env` puede apuntar a servicios reales o staging, pero no se commitea.
- `pnpm dev` carga `.env.staging` por defecto. Usar `pnpm dev:production-data` exige intencion expresa y no forma parte de la QA normal.
- `.env.test` debe usar usuarios de prueba y tampoco se commitea.
- `E2E_DISABLE_EXTERNAL_INTEGRATIONS=true` evita side effects Google/Resend en pruebas locales de booking.
- `DEMO_GUIDE_ENABLED=false` y `DEMO_GUIDE_LOGIN_ENABLED=false` deben quedar apagados en `.env.test` y en `.env.test.example` para los flujos normales.
- `pnpm dev:demo` es el unico arranque local que activa `DEMO_GUIDE_ENABLED=true` y `DEMO_GUIDE_LOGIN_ENABLED=true`; `pnpm dev`, tests y launch verification no deben cargar la demo por defecto.
- Con `DEMO_GUIDE_ENABLED=false`, `/demo` y `/:lang/demo` deben fallar cerrado con `404` y `noindex` para no redirigir trafico de lanzamiento a paginas publicas.
