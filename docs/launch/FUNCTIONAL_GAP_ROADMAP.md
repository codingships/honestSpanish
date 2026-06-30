# Functional Gap Roadmap

Estado: plan de trabajo. Este documento convierte dudas abiertas de producto en defaults recomendados y tareas ejecutables.

## Avance Implementado 2026-06-27, Centesimo Vigesimo Primer Corte

Centesimo vigesimo primer corte integrado: operaciones externas reforzadas con evidencia Wrangler read-only de la version activa del Worker staging.

Archivos/evidencia:

- `scripts/launch/staging-operations-preflight.ts`
- `scripts/launch/operations-external-closure.ts`
- `docs/launch/RC_EVIDENCE_REFRESH.md`
- `docs/launch/MANUAL_EVIDENCE.local.json`
- `tests/unit/operations-runbook.test.ts`
- `outputs/launch-staging-operations-preflight/2026-06-27T00-48-12-529Z/summary.md`
- `outputs/launch-staging-operations-preflight/2026-06-27T00-48-12-529Z/wrangler_version_view.log`
- `outputs/launch-operations-external-closure/2026-06-27T00-50-17-644Z/summary.md`
- `outputs/launch-staging-database-rollout/2026-06-27T00-50-18-134Z/summary.md`

Revision:

- `launch:staging-operations -- --include-wrangler` queda OK, 0 fallos y 0 warnings.
- El preflight ahora incluye `wrangler_version_view`: lee la version activa de `espanol-honesto-fulfillment-staging` y guarda solo version id/numero y bindings por nombre/tipo, sin valores de secretos ni codigo fuente.
- `operations-external-closure` queda WARNING con 0 fallos y 1 warning manual: sigue faltando Resend staging delivery/suppression y Admin Jobs staging UI/runtime despues de `database_readiness`, o un sustituto RC aceptado explicitamente. Resend ahora tiene herramienta repetible: `corepack pnpm launch:resend-readonly -- --env-file <staging-env-file>`, que solo guarda agregados de dominios/logs/emails y no envia correo.
- `launch:phase1` vuelve a quedar BLOCKED esperado solo por `database_readiness` y `operations_external`; todos los support audits de Phase 1 pasan.
- `docs/launch/MANUAL_EVIDENCE.local.json` se actualizo con rutas frescas, manteniendo esos checks en `pending`.
- No se hizo deploy, rollback, tail de logs, envio de email, trigger de cron, mutacion de jobs, SQL remoto, lectura de filas privadas, cambio de secretos ni cambios en production/Stripe/legal/dominio/Search Console/smoke real.

Siguiente movimiento real:

1. Aprobacion explicita de `supabase_staging_schema_rollout` para cerrar `database_readiness`.
2. Tras Supabase staging, revisar Admin Jobs staging UI/runtime y cerrar Resend staging con evidencia de dashboard/API valida (`launch:resend-readonly` en `OK`) o aprobacion separada para un test email staging.

## Avance Implementado 2026-06-27, Centesimo Vigesimo Corte

Centesimo vigesimo corte integrado: higiene Git/worktree refrescada y el plan de paquetes ya no trata Cloudflare Pages staging no-real-payments como bloqueo vivo.

Archivos/evidencia:

- `scripts/launch/worktree-audit.ts`
- `docs/launch/GIT_WORKTREE_PLAN.md`
- `tests/unit/operations-runbook.test.ts`
- `outputs/launch-cleanup/2026-06-27T00-42-48-612Z/summary.md`
- `outputs/launch-worktree/2026-06-27T00-44-08-326Z/summary.md`
- `outputs/launch-worktree/2026-06-27T00-44-08-326Z/commit-package-plan.md`
- `outputs/launch-worktree/2026-06-27T00-44-08-326Z/rc-staging-package.md`

Revision:

- `launch:cleanup` queda OK, 0 fallos y 0 warnings.
- `secrets:check` queda OK, sin secretos obvios en archivos trackeados/no ignorados.
- `git diff --check` queda OK; solo avisa de normalizacion CRLF/LF.
- `launch:worktree` queda WARNING esperado por 347 items en el arbol, con 0 failed risks y 0 warnings.
- El plan de worktree mantiene la advertencia correcta: `HEAD` aun no contiene todo el guard no-real-payments, asi que futuros redeploys/source-based RC review deben empaquetar la slice exacta antes de confiar en `CHECKOUT_ENABLED=false`.
- El mismo plan ya no afirma que Cloudflare Pages staging seguira sirviendo el comportamiento viejo; la evidencia vigente ya prueba `403 Checkout is disabled` y solo hay que revalidar si se redepliega o cambia runtime/config de checkout.
- `tests/unit/operations-runbook.test.ts` pasa con 15 tests.
- No se hizo staging, commit, deploy, SQL remoto, envio de email, job mutation, cambio de secretos ni cambios en production/Stripe/legal/dominio/Search Console/smoke real.

Siguiente movimiento real:

1. Mantener el arbol Git grande como paquetes revisables; no congelar RC hasta cerrar `database_readiness` y `operations_external`.
2. Aprobacion explicita de `supabase_staging_schema_rollout` para resolver Supabase staging.

## Avance Implementado 2026-06-27, Centesimo Decimonoveno Corte

Centesimo decimonoveno corte integrado: evidencia funcional local y hoja RC externa refrescadas despues de verificar Cloudflare Pages staging/no-real-payments, sin ampliar permisos externos.

Archivos/evidencia:

- `outputs/launch-functional-rc/2026-06-27T00-40-36-653Z/summary.md`
- `outputs/launch-rc-external-closure/2026-06-27T00-40-59-907Z/summary.md`
- `outputs/launch-rc-external-closure/2026-06-27T00-40-59-907Z/next-approval.md`
- `outputs/launch-status/2026-06-27T00-39-28-100Z/summary.md`
- `docs/launch/MANUAL_EVIDENCE.local.json`
- `docs/launch/FUNCTIONAL_GAP_ROADMAP.md`

Revision:

- `launch:functional-rc` vuelve a quedar OK y cubre solicitud comercial, CRM, emails transaccionales, diagnostico ligero, onboarding post-pago sin pagos reales, calendario/disponibilidad, no-real-payments y soporte/recuperacion.
- `launch:rc-external-closure` queda WARNING esperado con 0 fallos y 2 pendientes reales: `supabase_staging_schema_rollout` y `operations_external_evidence`.
- Cloudflare Pages staging no-real-payments queda OK en la hoja RC externa: `espanol-honesto-staging` sigue sirviendo checkout bloqueado antes de Stripe/Supabase.
- La siguiente aprobacion atomica sigue siendo Supabase staging: `espanol-staging` (`mzjyvmlxfpzdfdjzxxyj`), aplicar/verificar solo la secuencia preparada y registrar evidencia no secreta.
- `docs/launch/MANUAL_EVIDENCE.local.json` se actualizo con evidencias frescas de pagos/no-real-payments, operaciones y paquete Supabase staging, pero mantiene `database_readiness` y `operations_external` en `pending`.
- `dist/` sigue ausente tras los builds/checks locales.
- No se aplico SQL, no se escribio en Supabase, no se envio email, no se disparo cron, no se proceso/reintento/cancelo ningun job, no se cambiaron secretos/config externa y no se toco produccion, Stripe live, legal real, dominio/Search Console ni smoke real.

Siguiente movimiento real:

1. Aprobacion explicita de `supabase_staging_schema_rollout` para aplicar/verificar solo las migraciones preparadas en Supabase staging.
2. Despues de Supabase staging, cerrar `operations_external` con evidencia no secreta de Resend staging, Workers Logs/observability y Admin Jobs staging UI/runtime, o con un sustituto RC aceptado explicitamente.

## Avance Implementado 2026-06-27, Centesimo Decimoctavo Corte

Centesimo decimoctavo corte integrado: verificacion local amplia refrescada tras cerrar Cloudflare Pages staging no-real-payments, sin writes externos.

Archivos/evidencia:

- `outputs/launch-worktree/2026-06-26T22-28-57-069Z/summary.md`
- `outputs/launch-phase-1/2026-06-26T22-30-22-849Z/summary.md`
- `outputs/launch-staging-database-rollout/2026-06-26T22-31-31-423Z/summary.md`
- `outputs/launch-operations-external-closure/2026-06-26T22-31-30-944Z/summary.md`
- `outputs/launch-rc-external-closure/2026-06-26T22-31-52-314Z/next-approval.md`
- `outputs/launch-no-real-payments/2026-06-26T22-32-27-718Z/no-real-payments-closure-pack.md`
- `outputs/launch-status/2026-06-26T22-32-38-482Z/summary.md`
- `docs/launch/FUNCTIONAL_GAP_ROADMAP.md`

Revision:

- Goal nativo y goal durable Ops estan alineados con el objetivo actual sin cobros reales; el goal sigue activo, no completo.
- `launch:worktree` queda WARNING esperado por arbol sucio grande, con 346 items, 0 failed risks y 0 warnings.
- Verificaciones locales pasan: `typecheck`, `lint`, `test:run` (65 archivos, 402 tests), `build`, `fulfillment:typecheck`, `secrets:check` y `git diff --check`.
- El `build` uso `.dev.vars` como es normal en local; despues se elimino `dist/` para no dejar artefactos generados con posible config privada embebida.
- `launch:no-real-payments -- --deployed-url https://espanol-honesto-staging.pages.dev` queda OK, 0 fallos y 0 warnings; staging sigue bloqueando checkout antes de Stripe/Supabase.
- `launch:phase1` queda BLOCKED esperado solo por `database_readiness` y `operations_external`; todos los support audits de Phase 1 pasan.
- `launch:rc-external-closure` queda WARNING con 2 pendientes: `supabase_staging_schema_rollout` y `operations_external_evidence`; la siguiente aprobacion atomica apunta al paquete Supabase staging fresco `2026-06-26T22-31-31-423Z`.
- `launch:status` queda BLOCKED con 9 blockers, 0 warnings y 9 Open Go/No-Go. Phase 1 mantiene 2 abiertos; RC propio mantiene 0 abiertos; final-only mantiene 6 checks deliberados.
- No se aplico SQL, no se escribio en Supabase, no se envio email, no se disparo cron, no se proceso/reintento/cancelo ningun job, no se cambiaron secretos/config externa y no se toco produccion, Stripe live, legal real, dominio/Search Console ni smoke real.

Siguiente movimiento real:

1. Aprobacion explicita de `supabase_staging_schema_rollout` para aplicar/verificar solo las 7 migraciones preparadas en Supabase staging.
2. Evidencia externa/no secreta de `operations_external`: cron/log visibility en Cloudflare Worker staging, Resend staging delivery/suppression y Admin Jobs staging UI/runtime.

## Avance Implementado 2026-06-27, Centesimo Decimoseptimo Corte

Centesimo decimoseptimo corte integrado: operaciones externas quedan refrescadas en modo read-only y las guias ya no tratan Cloudflare Pages no-real-payments como bloqueo vivo.

Archivos/evidencia:

- `outputs/launch-staging-operations-preflight/2026-06-26T22-23-21-497Z/summary.md`
- `outputs/launch-operations-external-closure/2026-06-26T22-24-11-865Z/summary.md`
- `outputs/launch-operations-external-closure/2026-06-26T22-24-11-865Z/operations-external-closure-pack.md`
- `outputs/launch-operations-external-closure/2026-06-26T22-24-11-865Z/manual-evidence-dry-run.txt`
- `outputs/launch-rc-external-closure/2026-06-26T22-24-11-876Z/summary.md`
- `outputs/launch-rc-external-closure/2026-06-26T22-24-11-876Z/next-approval.md`
- `outputs/launch-status/2026-06-26T22-24-21-933Z/summary.md`
- `docs/launch/RC_EVIDENCE_REFRESH.md`
- `docs/launch/GIT_WORKTREE_PLAN.md`

Revision:

- El goal nativo sigue activo con el objetivo correcto: dejar Espanol Honesto operativo sin cobros reales y dejar legal real, Stripe live, fuente rusa premium, production secrets/integrations, dominio/Search Console y smoke real como final-only.
- `launch:staging-operations -- --include-wrangler` vuelve a quedar OK: Worker staging responde `/health` con 200, rechaza ruta interna sin autenticacion con 401, mantiene config local de cron/observability y Wrangler aporta evidencia read-only de cuenta, deployments/status y nombres de secretos.
- Wrangler 4.97.0 muestra que `wrangler triggers` en este entorno es para aplicar triggers, no para listar cron en lectura; no se uso para evitar writes.
- `launch:operations-external-closure` queda WARNING esperado: el soporte tecnico esta preparado, pero faltan evidencias no secretas de cron/log visibility, Resend staging delivery/suppression y Admin Jobs staging UI/runtime.
- `launch:rc-external-closure` queda WARNING con Cloudflare Pages no-real-payments en OK y dos pendientes reales: `supabase_staging_schema_rollout` y `operations_external_evidence`.
- `launch:status` sigue `BLOCKED`, 9 blockers, 0 warnings y 9 Open Go/No-Go. Phase 1 abierta solo por `database_readiness` y `operations_external`; RC propio sin checks abiertos; final-only mantiene legal, pagos, integraciones, SEO/LLM y smoke final.
- Se corrigieron `docs/launch/RC_EVIDENCE_REFRESH.md` y `docs/launch/GIT_WORKTREE_PLAN.md` para reflejar que `no_real_payments_staging` esta cerrado mientras el deployed probe siga devolviendo `403 Checkout is disabled`.
- No se aplicaron migraciones, no se envio email, no se proceso ni reintento ningun job, no se hizo tail persistente, no se tocaron secretos, no se escribio en Cloudflare/Supabase/Resend/Google/Stripe/Sentry y no se toco produccion.

Siguiente movimiento real:

1. Aprobacion exacta de Supabase staging para aplicar/verificar solo las 7 migraciones preparadas en `espanol-staging` (`mzjyvmlxfpzdfdjzxxyj`), o dejar ese scope pausado.
2. Evidencia externa/manual no secreta para `operations_external`: dashboard/logs de Cloudflare Worker staging, Resend staging delivery/suppression y Admin Jobs staging UI/runtime.

## Avance Implementado 2026-06-27, Centesimo Decimosexto Corte

Centesimo decimosexto corte integrado: Supabase staging queda preparado con preflight read-only fresca, sin aplicar migraciones.

Archivos/evidencia:

- `outputs/launch-staging-database-rollout/2026-06-26T22-15-05-233Z/summary.md`
- `outputs/launch-staging-database-rollout/2026-06-26T22-15-05-233Z/staging-migration-manifest.json`
- `outputs/launch-staging-database-rollout/2026-06-26T22-15-05-233Z/approval-request.md`
- `outputs/supabase-staging-readonly-preflight/2026-06-27T00-18-00/summary.md`
- `outputs/launch-rc-external-closure/2026-06-26T22-18-43-278Z/summary.md`
- `outputs/launch-rc-external-closure/2026-06-26T22-18-43-278Z/next-approval.md`
- `docs/launch/FUNCTIONAL_GAP_ROADMAP.md`

Revision:

- Se consulto el changelog oficial de Supabase antes de trabajar este frente; el cambio reciente relevante a vigilar es `pg_graphql` 1.6.0, alineado con mantener `015_drop_unused_pg_graphql.sql` como parte del historico previo ya detectado.
- Se regenero `corepack pnpm launch:staging-db-rollout`: OK, 0 fallos, 0 warnings.
- El paquete fresco mantiene exactamente los mismos hashes de bundle, SQL de verificacion y 7 migraciones que el paquete anterior; no se amplio el alcance.
- Preflight read-only con Supabase confirmo proyectos separados:
  - staging: `espanol-staging` / `mzjyvmlxfpzdfdjzxxyj` / `ACTIVE_HEALTHY` / Postgres `17.6.1.063`.
  - produccion: `espanol-honesto` / `vkkahxsybhbutszerawz` / `ACTIVE_HEALTHY`.
- La historia de migraciones en staging llega hasta `scope_admin_policies_to_authenticated`; las 7 migraciones del paquete siguen pendientes de aplicar/verificar remotamente.
- El SQL de metadata hosted contra staging devolvio `critical_missing_count=5`.
- El resumen de objetos faltantes muestra ausencia consistente con el rollout: tablas publicas CRM, columnas CRM, RLS/policies/grants/indices CRM, y columnas/indices de enriquecimiento de leads, idiomas y diagnostico de nivel.
- `launch:rc-external-closure` queda WARNING con 2 pendientes: `supabase_staging_schema_rollout` y `operations_external_evidence`; Cloudflare Pages no-real-payments permanece OK.
- No se aplico SQL, no se modifico Supabase, no se tocaron secretos, no se leyeron filas de aplicacion, no se toco produccion, Stripe, legal, dominio/Search Console ni smoke real.

Siguiente aprobacion exacta:

```text
I approve the staging-only action supabase_staging_schema_rollout for Supabase project espanol-staging (mzjyvmlxfpzdfdjzxxyj).
Codex may perform the read-only preflight described here, then perform only this action: Apply or verify the prepared staging migration sequence, then rerun the hosted schema check and staging data-flow checks. Production remains separate and later.
Codex may record only non-secret evidence described here: Record non-secret evidence: project id/name, migration versions applied or already present, hosted schema check output path and staging-only data-flow result.
This approval excludes production resources, Stripe live mode, real checkout enablement, legal real data, final secrets, domain/Search Console changes and production smoke.
```

## Avance Implementado 2026-06-26, Centesimo Decimoquinto Corte

Centesimo decimoquinto corte integrado: Cloudflare Pages staging queda desplegado y verificado en modo no-real-payments.

Archivos:

- `scripts/launch/staging-no-real-payments-remediation.ts`
- `scripts/launch/rc-external-closure.ts`
- `scripts/launch/worktree-audit.ts`
- `scripts/demo/shared.ts`
- `package.json`
- `docs/launch/NO_REAL_PAYMENTS.md`
- `docs/launch/RC_EVIDENCE_REFRESH.md`
- `docs/launch/GIT_WORKTREE_PLAN.md`
- `docs/launch/FUNCTIONAL_GAP_ROADMAP.md`

Revision:

- Se ejecuto la accion externa aprobada solo para Cloudflare Pages project `espanol-honesto-staging`.
- Preflight confirmo cuenta Cloudflare `alindev95@gmail.com`, project `espanol-honesto-staging`, rama `staging` y deployment previo `bb19b410`.
- El deploy directo desde `dist` fallo antes de subir porque Wrangler leia `dist/server/wrangler.json` y Pages rechaza declarar el binding reservado `ASSETS`.
- Se preparo un paquete Pages advanced limpio: assets publicos en `site/`, Worker en `site/_worker.js`, `site/_worker.js/wrangler.json` eliminado e `index.js` reexportando `entry.mjs`.
- Se detecto que builds locales con `.dev.vars`, `.env` o variables privadas heredadas podian embeber secretos en `dist`; esos artefactos generados se borraron y el build final se hizo ocultando `.dev.vars`/`.env*`, limpiando variables privadas conocidas y permitiendo solo `PUBLIC_*` y `CHECKOUT_ENABLED=false`.
- El paquete final paso scan de patrones de secretos y validacion local con `wrangler pages functions build`.
- El deploy se hizo desde una copia temporal fuera del repo para evitar que Wrangler heredase el `wrangler.toml` raiz y volviese a `dist/server/wrangler.json`.
- Cloudflare devolvio deployment `a2e6f14b-6c7f-426e-b506-2d98b55ba612`, URL `https://a2e6f14b.espanol-honesto-staging.pages.dev`; el dominio estable `https://espanol-honesto-staging.pages.dev` tambien responde con el deployment actualizado.
- `launch:no-real-payments` queda OK contra el deployment hash y contra el dominio estable, con `/api/create-checkout` devolviendo `403` y `Checkout is disabled`.
- `launch:staging-no-real-payments-remediation` ya no falla; queda en WARNING solo por `local_deployment_gap`, esperado mientras el arbol Git siga sucio y `HEAD` no contenga el guard.
- `launch:rc-external-closure` baja a 2 warnings: Supabase staging schema rollout y operations external evidence. Cloudflare no-real-payments queda OK.
- No se toco produccion, Stripe live, real checkout, Supabase remoto, legal real, dominio/Search Console ni production smoke.

Evidencia:

- Deploy Cloudflare Pages staging: `https://a2e6f14b.espanol-honesto-staging.pages.dev`, project `espanol-honesto-staging`, branch `staging`.
- `outputs/cloudflare-pages-staging-package/2026-06-27T00-03-40/package-summary.json`: paquete Pages advanced limpio, `CHECKOUT_ENABLED=false`, `workerConfigRemovedFromDeployPackage=true`.
- `corepack pnpm launch:no-real-payments -- --deployed-url https://a2e6f14b.espanol-honesto-staging.pages.dev`: OK, `outputs/launch-no-real-payments/2026-06-26T22-05-43-923Z/summary.md`.
- `corepack pnpm launch:no-real-payments -- --deployed-url https://espanol-honesto-staging.pages.dev`: OK, `outputs/launch-no-real-payments/2026-06-26T22-08-11-444Z/summary.md`.
- `outputs/launch-staging-no-real-payments-remediation/2026-06-26T22-09-01-053Z/summary.md`: WARNING, 0 fallos, 1 warning por `local_deployment_gap`; `deployed_checkout_probe` OK.
- `outputs/launch-rc-external-closure/2026-06-26T22-10-09-241Z/summary.md`: WARNING, Cloudflare OK, pendientes Supabase staging y operations external.
- `outputs/launch-rc-external-closure/2026-06-26T22-10-09-241Z/next-approval.md`: siguiente aprobacion recomendada `supabase_staging_schema_rollout`.

## Avance Implementado 2026-06-26, Centesimo Decimocuarto Corte

Centesimo decimocuarto corte integrado: verificacion primaria, revision secundaria y Launch Gate completo se refrescaron tras Phase 1/RC, sin writes externos.

Archivos:

- `docs/launch/FUNCTIONAL_GAP_ROADMAP.md`
- `docs/launch/GIT_WORKTREE_PLAN.md`

Revision:

- El goal nativo y el goal durable siguen alineados.
- `launch:verify` quedo `BLOCKED` con un unico fallo: `pnpm launch:legal`, esperado por legal real final-only.
- Dentro de `launch:verify`, `git diff --check`, `typecheck`, `fulfillment:typecheck`, `lint`, `test:run`, `build`, `launch:sequence`, `launch:cleanup`, `launch:content`, `launch:seo`, `launch:public-visual`, `launch:security`, `launch:operations`, `launch:payments`, `launch:final-readiness`, `launch:accessibility`, `manual-evidence:init --dry-run` y `secrets:check` quedaron OK.
- `launch:secondary-review` quedo `BLOCKED` por evidencia primaria bloqueada, Go/No-Go abiertos y evidencia manual pendiente.
- `launch:gate` quedo `BLOCKED` con 3 pasos fallidos: `launch:verify`, `launch:phase1` y `launch:secondary-review`.
- El `launch:status` generado por el gate queda `BLOCKED`, 9 blockers, 0 warnings y 9 Open Go/No-Go.
- No se persiguio un bucle de freshness entre RC y gate: el status ya deja visible que el full gate es fresco y que el RC queda bloqueado por Phase 1.
- No se hizo deploy, no se aplicaron migraciones Supabase, no se enviaron emails, no se procesaron jobs, no se tocaron secretos y no se cambio ningun servicio externo.

Evidencia:

- RunLayer `launch:verify`: BLOCKED esperado (`command-2026-06-26T21-27-08-651152-00-00`).
- `outputs/launch-verification/2026-06-26T21-24-50-008Z/summary.md`: bloqueo unico en `pnpm launch:legal`.
- `outputs/launch-verification/2026-06-26T21-27-25-628Z/summary.md`: verificacion primaria fresca usada por el gate.
- RunLayer `launch:secondary-review`: BLOCKED esperado (`command-2026-06-26T21-27-25-677502-00-00`).
- `outputs/launch-secondary-review/2026-06-26T21-31-46-535Z/secondary-review.md`: revision secundaria fresca usada por el gate/status.
- RunLayer `launch:gate`: BLOCKED esperado (`command-2026-06-26T21-31-47-644406-00-00`).
- `outputs/launch-gate/2026-06-26T21-27-25-187Z/summary.md`: gate completo bloqueado por 3 pasos.
- `outputs/launch-status/2026-06-26T21-31-47-316Z/summary.md`: dashboard final fresco con 9 blockers, 0 warnings y 9 Open Go/No-Go.
- `outputs/launch-manual-evidence/2026-06-26T21-31-44-923Z/phase-1-closure-pack.md`: paquete fresco para cerrar `database_readiness` y `operations_external`.
- `outputs/launch-staging-database-rollout/2026-06-26T21-31-43-976Z/summary.md`: paquete local Supabase staging OK.
- `outputs/launch-operations-external-closure/2026-06-26T21-31-43-524Z/summary.md`: WARNING esperado por evidencia externa pendiente.

## Avance Implementado 2026-06-26, Centesimo Decimotercer Corte

Centesimo decimotercer corte integrado: Phase 1 y RC se refrescaron tras la validacion local amplia, sin writes externos.

Archivos:

- `docs/launch/FUNCTIONAL_GAP_ROADMAP.md`
- `docs/launch/GIT_WORKTREE_PLAN.md`

Revision:

- El goal nativo y el goal durable siguen alineados.
- `launch:phase1` se ejecuto de nuevo y quedo `BLOCKED` solo por `database_readiness` y `operations_external`.
- `launch:rc` se ejecuto de nuevo y quedo `RC_BLOCKED_BY_PHASE_1`.
- Dentro del RC, `launch:functional-rc`, `launch:payments` y `launch:no-real-payments` quedaron OK.
- `launch:staging-no-real-payments-remediation` sigue fallando de forma esperada porque Cloudflare Pages staging devuelve `400 priceId is required`.
- `launch:rc-external-closure` sigue fallando de forma esperada con Cloudflare Pages staging como accion siguiente; Supabase staging y operations external siguen pendientes de aprobacion/evidencia.
- `launch:status` se regenero y ya apunta a Phase 1 y RC frescos.
- No se hizo deploy, no se aplicaron migraciones Supabase, no se enviaron emails, no se procesaron jobs, no se tocaron secretos y no se cambio ningun servicio externo.

Evidencia:

- RunLayer `launch:phase1`: BLOCKED esperado (`command-2026-06-26T21-21-50-708934-00-00`).
- `outputs/launch-phase-1/2026-06-26T21-20-29-663Z/summary.md`: Phase 1 abierto por 2 checks.
- `outputs/launch-phase-1/2026-06-26T21-20-30-094Z/summary.md`: Phase 1 fresco usado por el RC/status posterior.
- RunLayer `launch:rc`: RC_BLOCKED_BY_PHASE_1 esperado (`command-2026-06-26T21-22-22-578787-00-00`).
- `outputs/launch-rc/2026-06-26T21-20-29-677Z/summary.md`: RC bloqueado por `database_readiness` y `operations_external`; RC open `no_real_payments_staging`.
- `outputs/launch-functional-rc/2026-06-26T21-21-51-162Z/summary.md`: OK.
- `outputs/launch-payments/2026-06-26T21-22-12-935Z/summary.md`: OK.
- `outputs/launch-staging-database-rollout/2026-06-26T21-21-48-432Z/summary.md`: OK.
- `outputs/launch-operations-external-closure/2026-06-26T21-21-47-952Z/summary.md`: WARNING esperado.
- `outputs/launch-staging-no-real-payments-remediation/2026-06-26T21-22-13-430Z/summary.md`: FAILED esperado, staging checkout no bloqueado.
- `outputs/launch-rc-external-closure/2026-06-26T21-22-21-658Z/summary.md`: FAILED esperado.
- `outputs/launch-rc-external-closure/2026-06-26T21-22-21-658Z/next-approval.md`: siguiente aprobacion externa acotada.
- RunLayer `launch:status`: BLOCKED esperado (`command-2026-06-26T21-22-32-396627-00-00`).
- `outputs/launch-status/2026-06-26T21-22-32-275Z/summary.md`: 9 blockers, 0 warnings y 9 Open Go/No-Go.

## Avance Implementado 2026-06-26, Centesimo Duodecimo Corte

Centesimo duodecimo corte integrado: validacion local amplia posterior al paquete RC externo, sin escribir en servicios externos.

Archivos:

- `docs/launch/FUNCTIONAL_GAP_ROADMAP.md`
- `docs/launch/GIT_WORKTREE_PLAN.md`

Revision:

- Se confirmo que el native Codex Goal y el goal durable de `.codex-ops` siguen alineados con el objetivo operativo sin cobros reales.
- `fulfillment:typecheck`, `lint`, `typecheck`, `test:run` completo y `build` pasan.
- El test suite completo cubre 65 archivos y 402 tests.
- `launch:functional-rc` queda OK y mantiene prueba local mocked del circuito comercial, CRM, email transaccional, diagnostico de nivel, onboarding, calendario, no-real-payments y soporte.
- `launch:payments` queda OK, sin fallos ni warnings.
- `launch:rc-external-closure` se regenero y falla de forma esperada: Cloudflare Pages staging sigue siendo el failed principal; Supabase staging y operations external quedan como warnings pendientes de aprobacion/evidencia.
- `launch:status` se regenero con estado `BLOCKED`, 9 blockers, 0 warnings y 9 Open Go/No-Go.
- No se hizo deploy, no se aplicaron migraciones Supabase, no se enviaron emails, no se tocaron Stripe/Cloudflare/Supabase/Resend production y no se cambiaron secretos.

Evidencia:

- RunLayer `fulfillment:typecheck`: PASS (`command-2026-06-26T21-12-26-433940-00-00`).
- RunLayer `lint`: PASS (`command-2026-06-26T21-12-28-219939-00-00`).
- RunLayer `typecheck`: PASS (`command-2026-06-26T21-12-29-640646-00-00`).
- RunLayer `test:run`: PASS, 65 archivos y 402 tests (`command-2026-06-26T21-12-55-908413-00-00`).
- RunLayer `build`: PASS (`command-2026-06-26T21-15-30-782681-00-00`).
- RunLayer `launch:payments`: OK (`command-2026-06-26T21-15-42-726943-00-00`).
- `outputs/launch-payments/2026-06-26T21-15-42-698Z/summary.md`: OK, 0 fallos y 0 warnings.
- RunLayer `launch:functional-rc`: OK (`command-2026-06-26T21-16-01-889869-00-00`).
- `outputs/launch-functional-rc/2026-06-26T21-15-42-683Z/summary.md`: OK, 0 failed groups.
- RunLayer `launch:rc-external-closure`: FAILED esperado (`command-2026-06-26T21-16-08-044167-00-00`).
- `outputs/launch-rc-external-closure/2026-06-26T21-16-07-856Z/summary.md`: 1 failed y 2 warnings.
- `outputs/launch-rc-external-closure/2026-06-26T21-16-07-856Z/next-approval.md`: siguiente aprobacion acotada a una accion externa.
- RunLayer `launch:status`: BLOCKED esperado (`command-2026-06-26T21-16-15-524647-00-00`).
- `outputs/launch-status/2026-06-26T21-16-15-367Z/summary.md`: 9 blockers, 0 warnings y 9 Open Go/No-Go.
- RunLayer `git diff --check`: PASS, solo warnings de normalizacion CRLF ya existentes (`command-2026-06-26T21-17-49-696477-00-00`).
- RunLayer tests de runbook: PASS, 3 archivos y 15 tests (`command-2026-06-26T21-17-51-632323-00-00`).
- RunLayer `launch:worktree`: WARNING esperado por arbol sucio, 346 items, 0 failed risks y 0 warnings internos (`command-2026-06-26T21-18-08-080812-00-00`).
- `outputs/launch-worktree/2026-06-26T21-18-07-795Z/summary.md`: inventario Git fresco posterior a la actualizacion documental.

## Avance Implementado 2026-06-26, Centesimo Undecimo Corte

Centesimo undecimo corte integrado: `database_readiness` queda localmente preparado con paquete Supabase staging fresco, sin escribir en Supabase.

Archivos:

- `docs/launch/FUNCTIONAL_GAP_ROADMAP.md`
- `docs/launch/GIT_WORKTREE_PLAN.md`

Revision:

- Se reviso el paquete de rollout Supabase staging para `espanol-staging` (`mzjyvmlxfpzdfdjzxxyj`).
- Se regenero `launch:operations` para refrescar el SQL de hosted schema check y despues se regenero `launch:staging-db-rollout` para copiar ese SQL nuevo.
- El manifest staging mantiene `readyForStagingApproval=true`.
- El bundle de migraciones sigue sin patrones destructivos amplios.
- Las tablas publicas CRM nuevas tienen RLS, policies y grants explicitos para Data API/client usage.
- Las pruebas enfocadas de schema, CRM, lead intake y diagnostico pasan.
- `rc-external-closure` y `launch:status` se regeneraron para que la warning `supabase_staging_schema_rollout` apunte al rollout de las 21:10.
- No se ejecuto `supabase db push`, no se abrio URL de base de datos, no se aplico SQL remoto, no se tocaron secretos y production Supabase queda fuera.

Evidencia:

- RunLayer `launch:operations`: OK (`command-2026-06-26T21-10-03-223814-00-00`).
- RunLayer `launch:staging-db-rollout`: OK final (`command-2026-06-26T21-10-11-885870-00-00`).
- `outputs/launch-staging-database-rollout/2026-06-26T21-10-11-840Z/summary.md`: OK, 0 fallos y 0 warnings.
- `outputs/launch-staging-database-rollout/2026-06-26T21-10-11-840Z/staging-migration-manifest.json`: `readyForStagingApproval=true`.
- RunLayer tests DB/CRM/diagnostico: OK, 7 archivos y 46 tests (`command-2026-06-26T21-09-35-086437-00-00`).
- RunLayer `launch:rc-external-closure`: FAILED esperado, 1 failed y 2 warnings (`command-2026-06-26T21-10-22-843266-00-00`).
- `outputs/launch-rc-external-closure/2026-06-26T21-10-22-651Z/summary.md`: Supabase warning apunta al rollout fresco.
- RunLayer `launch:status`: BLOCKED esperado (`command-2026-06-26T21-10-30-696598-00-00`).
- `outputs/launch-status/2026-06-26T21-10-30-576Z/summary.md`: 9 blockers, 0 warnings y 9 Open Go/No-Go.

## Avance Implementado 2026-06-26, Centesimo Decimo Corte

Centesimo decimo corte integrado: no-real-payments, codificacion i18n y paquete Cloudflare Pages staging se revalidaron antes de pedir aprobacion externa.

Archivos:

- `docs/launch/FUNCTIONAL_GAP_ROADMAP.md`
- `docs/launch/GIT_WORKTREE_PLAN.md`

Revision:

- Se reviso la slice minima de checkout bloqueado: `src/pages/api/create-checkout.ts`, `src/lib/runtime-env.ts`, `wrangler.toml`, tests y runbook.
- La sospecha de mojibake en checkout/RU era salida de consola de PowerShell; lectura UTF-8 confirma `suscripción` y `ОСТАВИТЬ ЗАЯВКУ` correctamente codificados.
- Las pruebas enfocadas de checkout, no-real-payments e i18n encoding pasan.
- `launch:content` queda OK, 0 fallos y 0 warnings.
- `launch:no-real-payments` queda en WARNING esperado, 0 fallos: falta desplegado staging, no codigo local.
- `launch:staging-no-real-payments-remediation` sigue fallando de forma esperada: staging responde `400 priceId is required`; el build local contiene `Checkout is disabled` y `CHECKOUT_ENABLED=false`.
- `launch:worktree` refresco `rc-staging-package`: working tree guard listo, HEAD guard no listo, runtime files presentes.
- `rc-external-closure` y `launch:status` se regeneraron para que `next-approval` apunte a la remediacion y worktree mas recientes.
- No se hizo deploy, no se cambiaron variables Cloudflare, no se tocaron Stripe/Supabase/secretos y no se registro evidencia manual falsa.

Evidencia:

- RunLayer tests enfocados: OK, 4 archivos y 29 tests (`command-2026-06-26T21-05-38-323788-00-00`).
- RunLayer `launch:content`: OK (`command-2026-06-26T21-05-47-368491-00-00`).
- RunLayer `launch:no-real-payments`: WARNING esperado (`command-2026-06-26T21-05-50-103351-00-00`).
- RunLayer `launch:staging-no-real-payments-remediation`: FAILED esperado (`command-2026-06-26T21-06-03-941740-00-00`).
- `outputs/launch-staging-no-real-payments-remediation/2026-06-26T21-05-56-775Z/summary.md`: staging devuelve `400 priceId is required`.
- RunLayer `launch:worktree`: WARNING esperado por arbol sucio, 346 items, 0 failed risks y 0 warnings (`command-2026-06-26T21-06-34-372028-00-00`).
- `outputs/launch-worktree/2026-06-26T21-06-34-091Z/rc-staging-package.md`: working tree guard ready `yes`, current HEAD guard ready `no`.
- RunLayer `launch:rc-external-closure`: FAILED esperado (`command-2026-06-26T21-06-43-686852-00-00`).
- `outputs/launch-rc-external-closure/2026-06-26T21-06-43-509Z/next-approval.md`: aprobacion siguiente acotada a Cloudflare Pages project `espanol-honesto-staging`.
- RunLayer `launch:status`: BLOCKED esperado (`command-2026-06-26T21-06-52-704427-00-00`).
- `outputs/launch-status/2026-06-26T21-06-52-578Z/summary.md`: 9 blockers, 0 warnings y 9 Open Go/No-Go.

## Avance Implementado 2026-06-26, Centesimo Noveno Corte

Centesimo noveno corte integrado: `operations_external` se refresco con preflight read-only actual de Cloudflare Fulfillment Worker staging.

Archivos:

- `docs/launch/FUNCTIONAL_GAP_ROADMAP.md`
- `docs/launch/GIT_WORKTREE_PLAN.md`

Revision:

- Se ejecuto el preflight staging del Fulfillment Worker con Wrangler read-only y quedo OK, sin fallos ni warnings.
- El Worker staging responde `/health` con 200 y el endpoint interno rechaza llamadas no autenticadas con 401.
- La config local del Worker mantiene staging name, cron horario y observabilidad activada.
- Wrangler read-only devolvio evidencia no secreta de cuenta, deployment status/list y nombres de secretos; no se registraron valores.
- `operations_external` queda mejor sustentado, pero sigue sin poder marcarse `pass`: faltan cron/log visibility de dashboard, Resend staging delivery/suppression y Admin Jobs staging UI/runtime.
- `rc-external-closure` se refresco y mantiene el orden correcto: primero Cloudflare Pages staging no-real-payments; despues Supabase staging; despues evidencia operations.
- No se hizo deploy, no se tailaron logs, no se enviaron emails, no se procesaron jobs, no se cambio Cloudflare/Supabase/Resend y no se tocaron secretos.

Evidencia:

- RunLayer `launch:staging-operations -- --include-wrangler`: OK (`command-2026-06-26T21-01-21-784620-00-00`).
- `outputs/launch-staging-operations-preflight/2026-06-26T21-01-08-022Z/summary.md`: OK, 0 fallos y 0 warnings.
- RunLayer `launch:operations-external-closure`: WARNING esperado (`command-2026-06-26T21-01-37-886672-00-00`).
- `outputs/launch-operations-external-closure/2026-06-26T21-01-37-850Z/summary.md`: WARNING por evidencia manual pendiente.
- RunLayer `launch:rc-external-closure`: FAILED esperado, 1 failed y 2 warnings (`command-2026-06-26T21-02-07-384179-00-00`).
- `outputs/launch-rc-external-closure/2026-06-26T21-02-07-189Z/next-approval.md`: siguiente aprobacion acotada a Cloudflare Pages project `espanol-honesto-staging`.
- RunLayer `launch:status`: BLOCKED esperado (`command-2026-06-26T21-02-14-809571-00-00`).
- `outputs/launch-status/2026-06-26T21-02-14-687Z/summary.md`: 9 blockers, 0 warnings y 9 Open Go/No-Go.

## Avance Implementado 2026-06-26, Centesimo Octavo Corte

Centesimo octavo corte integrado: RC, Cloudflare Pages staging y status se refrescaron con evidencia read-only nueva.

Archivos:

- `docs/launch/FUNCTIONAL_GAP_ROADMAP.md`
- `docs/launch/GIT_WORKTREE_PLAN.md`

Revision:

- `launch:rc` se reejecuto y sigue correctamente bloqueado por Fase 1: `database_readiness` y `operations_external`.
- `launch:staging-no-real-payments-remediation` se reejecuto dentro del RC y confirma el bloqueo real de staging: Cloudflare Pages staging sigue devolviendo `400 priceId is required` en `/api/create-checkout`, por lo que aun no prueba `403 Checkout is disabled`.
- El build local de Pages contiene el guard de checkout desactivado y el manifiesto marca `readyForStagingDeployPackage=true`.
- El worktree actual tiene la slice minima lista en working tree, pero `HEAD` no contiene aun todo el guard: hay que empaquetar/commitear o desplegar exactamente la slice antes de confiar en `CHECKOUT_ENABLED=false` en staging.
- El siguiente permiso externo queda acotado a una sola accion: Cloudflare Pages project `espanol-honesto-staging`, staging-only, sin production, sin Stripe live, sin secretos y sin pagos reales.
- No se hizo deploy, no se cambio ninguna variable Cloudflare, no se aplicaron migraciones Supabase y no se tocaron secretos.

Evidencia:

- `corepack pnpm --config.verify-deps-before-run=false launch:rc`: `RC_BLOCKED_BY_PHASE_1` esperado (`outputs/launch-rc/2026-06-26T20-54-27-266Z/summary.md`).
- `corepack pnpm --config.verify-deps-before-run=false launch:status`: `BLOCKED`, 9 blockers, 0 warnings y 9 Open Go/No-Go (`outputs/launch-status/2026-06-26T20-58-38-671Z/summary.md`).
- Cloudflare staging no-real-payments: `FAILED` esperado por `400 priceId is required` (`outputs/launch-staging-no-real-payments-remediation/2026-06-26T20-56-02-026Z/summary.md`).
- RC external next approval fresco: `outputs/launch-rc-external-closure/2026-06-26T20-56-10-116Z/next-approval.md`.
- Worktree/RC package fresco: `outputs/launch-worktree/2026-06-26T20-54-28-726Z/rc-staging-package.md`.

## Avance Implementado 2026-06-26, Centesimo Septimo Corte

Centesimo septimo corte integrado: validacion local amplia reejecutada y contrato de `RC_EVIDENCE_REFRESH.md` corregido.

Archivos:

- `docs/launch/RC_EVIDENCE_REFRESH.md`
- `docs/launch/FUNCTIONAL_GAP_ROADMAP.md`

Cambio:

- `RC_EVIDENCE_REFRESH.md` ya no copia timestamps concretos de `outputs/launch-status`, `outputs/launch-manual-evidence` ni `outputs/launch-operations`; usa `<timestamp>` para evitar evidencia obsoleta.
- Se corrigio el fallo de `tests/unit/operations-runbook.test.ts`, que protege precisamente esa regla.
- Se registro `CORR-006`: RunLayer puede fallar capturando `pnpm test:run` completo en Windows por Unicode/cp1252; para ese comando usar ejecucion directa y registrar evidencia manual.
- No se tocaron servicios externos, no se hizo deploy, no se aplicaron migraciones y no se cambiaron secretos.

Evidencia:

- RunLayer `typecheck`: OK (`command-2026-06-26T20-42-29-379696-00-00`).
- RunLayer `lint`: OK (`command-2026-06-26T20-42-40-908270-00-00`).
- RunLayer `fulfillment:typecheck`: OK (`command-2026-06-26T20-42-50-132711-00-00`).
- `corepack pnpm --config.verify-deps-before-run=false exec vitest run --coverage=false --reporter=dot tests/unit/operations-runbook.test.ts`: OK, 1 archivo y 13 tests.
- `corepack pnpm --config.verify-deps-before-run=false test:run`: OK, 65 archivos y 402 tests.
- RunLayer `build`: OK (`command-2026-06-26T20-45-16-030125-00-00`).
- `corepack pnpm --config.verify-deps-before-run=false launch:status`: BLOCKED esperado, 9 blockers, 0 warnings y 9 Open Go/No-Go (`outputs/launch-status/2026-06-26T20-45-37-187Z/summary.md`).
- `git diff --check -- docs/launch/RC_EVIDENCE_REFRESH.md docs/launch/FUNCTIONAL_GAP_ROADMAP.md`: OK.

## Avance Implementado 2026-06-26, Centesimo Sexto Corte

Centesimo sexto corte integrado: no-real-payments local, secuencia y contenido revalidados antes de pedir permiso Cloudflare staging.

Archivos:

- `docs/launch/FUNCTIONAL_GAP_ROADMAP.md`

Revision:

- La regresion de checkout sin cobros reales pasa: el endpoint falla cerrado antes de Supabase/Stripe cuando `CHECKOUT_ENABLED` no esta activado.
- `launch:no-real-payments` queda en `WARNING` esperado con 0 fallos: el codigo, tests, docs y auditoria de pagos prueban el modo local; falta confirmar el entorno desplegado.
- `launch:sequence` queda OK: el lanzamiento sin pagos reales esta documentado como decision deliberada y final-only sigue explicitado.
- `launch:content` queda OK: no hay placeholders, mojibake ni desalineacion de traducciones/posicionamiento en ES/EN/RU.
- No se hizo probe contra Cloudflare staging, no se desplego, no se cambio `CHECKOUT_ENABLED`, no se tocaron Stripe/Supabase/secretos.

Evidencia:

- `corepack pnpm --config.verify-deps-before-run=false exec vitest run --coverage=false --reporter=dot tests/api/create-checkout.test.ts tests/unit/no-real-payments-runbook.test.ts`: OK, 2 archivos y 6 tests.
- `corepack pnpm --config.verify-deps-before-run=false launch:no-real-payments`: WARNING esperado, 0 fallos y 1 warning (`outputs/launch-no-real-payments/2026-06-26T20-40-35-521Z/no-real-payments-closure-pack.md`).
- `corepack pnpm --config.verify-deps-before-run=false launch:sequence`: OK, 0 fallos y 0 warnings (`outputs/launch-sequence/2026-06-26T20-40-35-548Z/summary.md`).
- `corepack pnpm --config.verify-deps-before-run=false launch:content`: OK, 0 fallos y 0 warnings (`outputs/launch-content/2026-06-26T20-40-35-609Z/summary.md`).

## Avance Implementado 2026-06-26, Centesimo Quinto Corte

Centesimo quinto corte integrado: higiene tecnica de secretos, cleanup e ignorados refrescada.

Archivos:

- `docs/launch/CLEANUP.md`
- `docs/launch/FUNCTIONAL_GAP_ROADMAP.md`

Cambio:

- Se ejecuto `secrets:check`; no encontro secretos obvios en archivos trackeados/no ignorados.
- Se ejecuto `launch:cleanup`; queda OK con 0 fallos y 0 warnings.
- `CLEANUP.md` se actualizo con la evidencia fresca y con el matiz Git de archivos historicamente trackeados que ahora aparecen como eliminados: `supabase/.temp/cli-latest`, `tmp/check-roles.ts`, `tmp/fix-roles.ts` y `tmp/update-email.ts`.
- `.gitignore` ya cubre `.env`, `.env.*` salvo ejemplos, `.dev.vars`, `tmp/`, `supabase/.temp/`, `outputs/`, `docs/launch/MANUAL_EVIDENCE.local.json` y `.codex-ops/`.
- No se borro nada adicional, no se stageo, no se commiteo y no se tocaron servicios externos.

Evidencia:

- `corepack pnpm --config.verify-deps-before-run=false secrets:check`: OK, sin secretos obvios.
- `corepack pnpm --config.verify-deps-before-run=false launch:cleanup`: OK, 0 fallos y 0 warnings (`outputs/launch-cleanup/2026-06-26T20-38-37-256Z/summary.md`).
- `git ls-files outputs .codex-ops docs/launch/MANUAL_EVIDENCE.local.json tmp supabase/.temp .env .env.local .dev.vars`: solo lista los 4 archivos historicos pendientes de eliminacion versionada.
- `git status --short -- outputs .codex-ops docs/launch/MANUAL_EVIDENCE.local.json tmp supabase/.temp .env .env.local .dev.vars`: solo muestra esos 4 `D`.

## Avance Implementado 2026-06-26, Centesimo Cuarto Corte

Centesimo cuarto corte integrado: higiene Git refrescada con inventario actual del arbol y slice Cloudflare staging.

Archivos:

- `docs/launch/GIT_WORKTREE_PLAN.md`
- `docs/launch/FUNCTIONAL_GAP_ROADMAP.md`

Cambio:

- Se ejecuto `launch:worktree` sin stagear, commitear, borrar, mover ni desplegar.
- `GIT_WORKTREE_PLAN.md` queda actualizado con branch `main`, HEAD `f05719c`, 346 items, 0 failed risks y 0 warnings internos.
- Se enlazan las rutas frescas de `summary.md`, `commit-package-plan.md`, `package-file-lists/`, `rc-staging-package.md`, `rc-staging-package-files.txt`, `rc-staging-runtime-diff.patch` y `rc-staging-runtime-manifest.json`.
- La slice Cloudflare Pages staging queda explicitada: working tree guard listo, HEAD guard no listo y runtime files presentes.
- La lectura operativa sigue siendo la misma: antes de cerrar `no_real_payments_staging`, el paquete/deploy staging debe contener `src/pages/api/create-checkout.ts`, `src/lib/runtime-env.ts` y `wrangler.toml`; una variable sola no basta si el deploy no contiene el guard.

Evidencia:

- `corepack pnpm --config.verify-deps-before-run=false launch:worktree`: WARNING esperado, 346 items, 0 failed risks y 0 warnings (`outputs/launch-worktree/2026-06-26T20-36-19-344Z/summary.md`).

## Avance Implementado 2026-06-26, Centesimo Tercer Corte

Centesimo tercer corte integrado: auditoria local de trabajo a medias en CRM, emails, diagnostico de nivel y onboarding post-pago.

Archivos:

- `docs/launch/FUNCTIONAL_GAP_ROADMAP.md`

Revision:

- Se busco deuda explicita (`TODO`, `FIXME`, `placeholder`, `not implemented`, mocks accidentales) en codigo de produccion de CRM, emails, fulfillment, diagnostico, admin y APIs relacionadas.
- No aparecieron `TODO/FIXME` funcionales en esas rutas criticas; los `placeholder` detectados son placeholders normales de UI o checks deliberados de scripts de launch/legal.
- La unica fila `Pendiente` relevante en `docs/launch/EMAIL_MATRIX.md` es `Pago pendiente / instrucciones de pago`, marcada correctamente como final-only hasta Stripe live o enlace manual confirmado.
- El flujo de diagnostico conserva la regla acordada: formulario ligero, resumen CRM, retencion cruda temporal en `leads.level_check_context` y limpieza al revisar/descartar.
- El onboarding post-pago conserva actividad CRM, tarea compartida SLA 24h, materiales antes de la primera clase, reintentos sin duplicar trabajo y cierre al completar primera clase.
- No se tocaron servicios externos ni se marco ninguna evidencia manual como pass.

Evidencia:

- `corepack pnpm --config.verify-deps-before-run=false exec vitest run --coverage=false --reporter=dot tests/api/admin-leads.test.ts tests/api/level-check.test.ts tests/unit/crm-level-check.test.ts tests/unit/crm-onboarding.test.ts tests/unit/fulfillment-jobs.test.ts tests/unit/email-templates.test.ts tests/unit/crm-class-email.test.ts`: OK, 7 archivos y 52 tests.

## Avance Implementado 2026-06-26, Centesimo Segundo Corte

Centesimo segundo corte integrado: `RC_EVIDENCE_REFRESH.md` actualizado para reflejar los tres scopes inmediatos reales del RC.

Archivos:

- `docs/launch/RC_EVIDENCE_REFRESH.md`
- `docs/launch/FUNCTIONAL_GAP_ROADMAP.md`

Cambio:

- Se anadio el corte actual `2026-06-26T20:24Z` con las rutas frescas de status, manual evidence, phase1, Supabase staging rollout, operations external closure, no-real-payments staging y next approval.
- La guia separa explicitamente los tres permisos actuales: Cloudflare Pages staging, Supabase staging y operations evidence read-only.
- La seccion de verificacion ya no sugiere que bastan dos evidencias de Fase 1; exige cerrar tambien `no_real_payments_staging` antes de esperar `RC_READY_WITH_FINAL_BLOCKERS`.
- La comprobacion posterior incluye `launch:no-real-payments -- --deployed-url ...` y `launch:rc-external-closure` antes de `launch:rc`.
- No se hicieron escrituras externas ni se marco evidencia manual como pass.

Evidencia:

- `git diff --check -- docs/launch/RC_EVIDENCE_REFRESH.md docs/launch/FUNCTIONAL_GAP_ROADMAP.md`: OK.
- `Select-String -Pattern '[ \t]$'` sobre `docs/launch/RC_EVIDENCE_REFRESH.md`: OK, sin trailing whitespace.

## Avance Implementado 2026-06-26, Centesimo Primer Corte

Centesimo primer corte integrado: goal reanudado, alineacion verificada y dashboard fresco generado sin escrituras externas.

Archivos:

- `docs/launch/FUNCTIONAL_GAP_ROADMAP.md`

Evidencia generada:

- `codex_ops.py goal align`: `aligned`; el Codex Goal visible y el goal durable `launch-viable-espanol-honesto` tienen el mismo objetivo operativo sin cobros reales.
- `corepack pnpm --config.verify-deps-before-run=false launch:status`: BLOCKED esperado, 9 blockers, 0 warnings y 9 Open Go/No-Go (`outputs/launch-status/2026-06-26T20-24-07-213Z/summary.md`).
- `outputs/launch-manual-evidence/2026-06-26T20-20-40-300Z/summary.md`: FAILED esperado; Fase 1 queda con 2 pendientes (`database_readiness`, `operations_external`) y Fase 3 mantiene 6 final-only.
- `outputs/launch-phase-1/2026-06-26T20-17-50-133Z/summary.md`: BLOCKED esperado por los mismos 2 checks de Fase 1.
- `outputs/launch-staging-database-rollout/2026-06-26T20-20-39-282Z/summary.md`: OK; paquete local listo para `espanol-staging` (`mzjyvmlxfpzdfdjzxxyj`) con 7 migraciones y `readyForStagingApproval=true`.
- `outputs/launch-operations-external-closure/2026-06-26T20-20-38-809Z/summary.md`: WARNING esperado; `readyForManualEvidenceReview=true` y `wranglerReadOnlyIncluded=true`.

Lectura operativa:

- No hay que crear otro goal ni reiniciar el plan: el objetivo persistente esta alineado.
- El trabajo local que quedaba por preparar esta esencialmente empaquetado: Supabase staging tiene bundle/manifest/post-verify SQL, y operaciones externas tiene closure pack/manifest.
- El siguiente movimiento real ya requiere evidencia externa o aprobacion explicita: aplicar/verificar migraciones solo en Supabase staging, cerrar cron/log visibility de Cloudflare Worker staging, comprobar Resend staging delivery/suppression y probar Admin Jobs en staging UI/runtime.
- `no_real_payments_staging` sigue bloqueando RC porque Cloudflare Pages staging todavia devuelve `400 priceId is required`; debe actualizarse el deployment/config para que devuelva `403 Checkout is disabled`.
- No se hizo deploy, no se aplicaron migraciones, no se tocaron secretos, no se envio email real, no se activo Stripe y no se escribio en servicios externos.

## Avance Implementado 2026-06-26, Centesimo Corte

Centesimo corte integrado: `operations_external` refrescado con Wrangler read-only incluido.

Archivos:

- `docs/launch/FUNCTIONAL_GAP_ROADMAP.md`

Evidencia generada:

- `corepack pnpm --config.verify-deps-before-run=false launch:staging-operations -- --include-wrangler`: OK, 0 fallos y 0 warnings (`outputs/launch-staging-operations-preflight/2026-06-26T20-15-16-532Z/summary.md`).
- El preflight confirma health 200 del Worker staging, rechazo 401 de ruta interna sin auth, cron/observability local, `wrangler whoami`, deployments status/list y secret-name list en modo read-only.
- `corepack pnpm --config.verify-deps-before-run=false launch:operations-external-closure`: WARNING esperado, 0 fallos y 1 warning (`outputs/launch-operations-external-closure/2026-06-26T20-15-35-488Z/summary.md`).
- `operations-external-evidence-manifest.json` marca `readyForManualEvidenceReview=true` y `wranglerReadOnlyIncluded=true`.
- `corepack pnpm --config.verify-deps-before-run=false launch:rc-external-closure`: FAILED esperado, 1 fallo y 2 warnings; `operations_external_evidence` apunta al operations pack nuevo (`outputs/launch-rc-external-closure/2026-06-26T20-15-54-567Z/rc-external-closure-pack.md`).
- `corepack pnpm --config.verify-deps-before-run=false launch:status`: BLOCKED esperado, 9 blockers, 0 warnings y 9 Open Go/No-Go (`outputs/launch-status/2026-06-26T20-16-00-354Z/summary.md`).

Lectura operativa:

- El error intermedio anterior era falta de `--include-wrangler`; queda corregido en la evidencia actual.
- `operations_external` ya no falla por preflight tecnico, pero sigue pendiente de evidencia manual/no secreta: cron/log visibility, Resend staging delivery/suppression y Admin Jobs staging UI/runtime.
- No se desplego, no se hizo tail de logs, no se envio email, no se proceso ningun job y no se cambio configuracion externa.

## Avance Implementado 2026-06-26, Nonagesimo Noveno Corte

Nonagesimo noveno corte integrado: Supabase staging rollout refrescado con manifest actual.

Archivos:

- `docs/launch/FUNCTIONAL_GAP_ROADMAP.md`

Evidencia generada:

- `corepack pnpm --config.verify-deps-before-run=false launch:staging-db-rollout`: OK, 0 fallos y 0 warnings (`outputs/launch-staging-database-rollout/2026-06-26T20-12-21-331Z/summary.md`).
- `staging-migration-manifest.json` marca `readyForStagingApproval=true` para `espanol-staging` (`mzjyvmlxfpzdfdjzxxyj`), con bundle SHA-256 `a1d7b46cd6932507b797e06e0b203ea82b76493058d6970651c19742a0474722`.
- El bundle incluye 7 migraciones: `018_enrich_leads_for_application.sql`, `019_capture_preferred_package_on_leads.sql`, `020_enforce_profile_role_links.sql`, `20260624163423_add_crm_core.sql`, `20260624185757_add_crm_task_related_entity.sql`, `20260625213116_capture_lead_languages.sql` y `20260625215008_add_lightweight_level_check_to_leads.sql`.
- Checks OK: migraciones presentes, SQL post-verify copiado, scan destructivo limpio y tablas CRM publicas con RLS/policies/Data API grants explicitos.
- `corepack pnpm --config.verify-deps-before-run=false launch:rc-external-closure`: FAILED esperado, 1 fallo y 2 warnings; `supabase_staging_schema_rollout` apunta al rollout nuevo (`outputs/launch-rc-external-closure/2026-06-26T20-12-45-221Z/rc-external-closure-pack.md`).
- `corepack pnpm --config.verify-deps-before-run=false launch:status`: BLOCKED esperado, 9 blockers, 0 warnings y 9 Open Go/No-Go (`outputs/launch-status/2026-06-26T20-12-51-509Z/summary.md`).

Lectura operativa:

- El paquete Supabase staging esta listo para pedir aprobacion separada, pero no se ha aplicado nada.
- Production Supabase sigue fuera: requiere aprobacion separada, backup/export, Pro upgrade o accepted risk segun cierre final.
- La hoja RC sigue priorizando Cloudflare staging porque `cloudflare_pages_no_real_payments` es el primer fallo; Supabase staging queda como siguiente warning preparado.

## Avance Implementado 2026-06-26, Nonagesimo Octavo Corte

Nonagesimo octavo corte integrado: Cloudflare Pages staging no-real-payments refrescado con preflight read-only actual.

Archivos:

- `docs/launch/FUNCTIONAL_GAP_ROADMAP.md`

Evidencia generada:

- `corepack pnpm --config.verify-deps-before-run=false launch:staging-no-real-payments-remediation`: FAILED esperado, 1 fallo y 2 warnings (`outputs/launch-staging-no-real-payments-remediation/2026-06-26T20-10-00-470Z/summary.md`).
- `deployed_checkout_probe` sigue devolviendo `400 priceId is required` en `https://bb19b410.espanol-honesto-staging.pages.dev/api/create-checkout`.
- `local_build_package_guard` sigue OK: `pages-staging-build-manifest.json` muestra `readyForStagingDeployPackage=true`, `checkoutEnabledDefault=false`, `nodejsCompat=true`, `fileCount=205`, `maxFileBytes=987792`, `withinPagesFileCountLimit=true` y `withinPagesFileSizeLimit=true`.
- `corepack pnpm --config.verify-deps-before-run=false launch:rc-external-closure`: FAILED esperado, 1 fallo y 2 warnings; el nuevo `next-approval.md` apunta a `outputs/launch-staging-no-real-payments-remediation/2026-06-26T20-10-00-470Z/approval-request.md`.
- `corepack pnpm --config.verify-deps-before-run=false launch:status`: BLOCKED esperado, 9 blockers, 0 warnings y 9 Open Go/No-Go (`outputs/launch-status/2026-06-26T20-10-33-176Z/summary.md`).

Lectura operativa:

- La comprobacion externa read-only confirma que el entorno desplegado sigue sin estar cerrado para no-cobros.
- El paquete local `dist` esta preparado para un despliegue staging controlado, pero el deployment remoto debe actualizarse o seguir devolvera `400`.
- Siguiente accion real: aprobacion explicita limitada a Cloudflare Pages project `espanol-honesto-staging`, sin production, Stripe live, `CHECKOUT_ENABLED=true`, secretos finales ni dominio/Search Console.

## Avance Implementado 2026-06-26, Nonagesimo Septimo Corte

Nonagesimo septimo corte integrado: pagos/no-real-payments locales refrescados y diferenciados del fallo desplegado.

Archivos:

- `docs/launch/FUNCTIONAL_GAP_ROADMAP.md`

Evidencia generada:

- `corepack pnpm --config.verify-deps-before-run=false launch:no-real-payments`: WARNING esperado, 0 fallos y 1 warning por confirmacion desplegada pendiente (`outputs/launch-no-real-payments/2026-06-26T20-07-56-809Z/summary.md`).
- `corepack pnpm --config.verify-deps-before-run=false launch:payments`: OK, 0 fallos y 0 warnings (`outputs/launch-payments/2026-06-26T20-07-56-809Z/summary.md`).
- El propio `launch:no-real-payments` ejecuto `launch:payments` dentro de su flujo y dejo la evidencia usada por `launch:status` en `outputs/launch-payments/2026-06-26T20-08-00-426Z/summary.md`.
- `corepack pnpm --config.verify-deps-before-run=false launch:status`: BLOCKED esperado, 9 blockers, 0 warnings y 9 Open Go/No-Go (`outputs/launch-status/2026-06-26T20-08-22-240Z/summary.md`).

Lectura operativa:

- `No-Real-Payments Audit` esta en WARNING local, no FAILED: el codigo, tests, docs, pagos y RC funcional prueban el modo sin cobros.
- El fallo que bloquea RC sigue siendo `Staging No-Real-Payments Remediation`: Cloudflare Pages staging todavia devuelve `400 priceId is required` y debe devolver `403 Checkout is disabled`.
- `payments_staging` sigue final-only/manual hasta que se decida no-checkout/staging test/live y se registre evidencia no secreta.

## Avance Implementado 2026-06-26, Nonagesimo Sexto Corte

Nonagesimo sexto corte integrado: worktree/RC package refrescado para el proximo permiso Cloudflare staging.

Archivos:

- `docs/launch/FUNCTIONAL_GAP_ROADMAP.md`

Evidencia generada:

- `corepack pnpm --config.verify-deps-before-run=false launch:worktree`: WARNING esperado, 0 failed risks y 0 warnings; genera `outputs/launch-worktree/2026-06-26T20-06-15-474Z/rc-staging-package.md`, `rc-staging-package-files.txt`, `rc-staging-runtime-diff.patch` y `rc-staging-runtime-manifest.json`.
- `rc-staging-package.md` confirma `Working tree guard ready: yes`, `Current HEAD guard ready: no` y `Required runtime files present: yes`.
- `rc-staging-package-files.txt` limita la slice runtime a `src/pages/api/create-checkout.ts`, `src/lib/runtime-env.ts` y `wrangler.toml`, con soporte de `.env.example`, tests y runbooks no-real-payments.
- `corepack pnpm --config.verify-deps-before-run=false launch:rc-external-closure`: FAILED esperado, 1 fallo y 2 warnings; el nuevo `next-approval.md` apunta al worktree `2026-06-26T20-06-15-474Z`.
- `corepack pnpm --config.verify-deps-before-run=false launch:status`: BLOCKED esperado, 9 blockers, 0 warnings y 9 Open Go/No-Go (`outputs/launch-status/2026-06-26T20-06-50-650Z/summary.md`).

Lectura operativa:

- Cloudflare Pages staging no se arregla con una variable sola si el deployment sigue apuntando a HEAD sin guard. El proximo permiso debe permitir desplegar/empaquetar la slice actual o publicar el build actual verificado antes de depender de `CHECKOUT_ENABLED=false`.
- Production Pages, Stripe live, `CHECKOUT_ENABLED=true`, cobros reales, Supabase writes, legal real, secretos finales, dominio/Search Console y smoke production siguen fuera de este permiso.

## Avance Implementado 2026-06-26, Nonagesimo Quinto Corte

Nonagesimo quinto corte integrado: `launch:status` obliga a revisar el manifest de build Pages en la decision de Cloudflare staging.

Archivos:

- `scripts/launch/status.ts`
- `tests/unit/operations-runbook.test.ts`
- `docs/launch/FUNCTIONAL_GAP_ROADMAP.md`

Cambio:

- La decision siguiente de `launch:status` para `no_real_payments_staging` ahora nombra tambien `pages-staging-build-manifest.json`, junto con `rc-staging-package.md`, `rc-staging-package-files.txt`, `rc-staging-runtime-diff.patch` y `rc-staging-runtime-manifest.json`.
- Si Fase 1 queda limpia pero `no_real_payments_staging` sigue abierto, el texto de cierre exige `readyForStagingDeployPackage=true` cuando se use `dist` local.
- El test de runbook protege que ese requisito siga apareciendo en el dashboard.

Evidencia:

- `corepack pnpm --config.verify-deps-before-run=false exec vitest run --coverage=false tests/unit/operations-runbook.test.ts`: PASS, 13 tests.
- `corepack pnpm --config.verify-deps-before-run=false typecheck`: PASS.
- `corepack pnpm --config.verify-deps-before-run=false launch:status`: BLOCKED esperado, 9 blockers, 0 warnings y 9 Open Go/No-Go (`outputs/launch-status/2026-06-26T20-05-13-147Z/summary.md`).

## Avance Implementado 2026-06-26, Nonagesimo Cuarto Corte

Nonagesimo cuarto corte integrado: el RC funcional deja contrato estructurado en JSON, no solo resumen Markdown.

Archivos:

- `scripts/launch/functional-rc.ts`
- `tests/unit/functional-rc-runbook.test.ts`
- `docs/launch/FUNCTIONAL_RC.md`
- `docs/launch/FUNCTIONAL_GAP_ROADMAP.md`

Cambio:

- `outputs/launch-functional-rc/<timestamp>/summary.json` ahora incluye `contract` con alcance, contrato de flujo comercial, contrato de activacion post-pago, dependencias externas excluidas, exclusiones final-only y reglas de uso de evidencia.
- `summary.md` avisa que el contrato vive tambien en JSON para auditorias sin parsear prosa.
- La guia `FUNCTIONAL_RC.md` documenta que el comando no cierra evidencia externa ni final-only.

Evidencia:

- `corepack pnpm --config.verify-deps-before-run=false exec vitest run --coverage=false tests/unit/functional-rc-runbook.test.ts`: PASS, 1 test.
- `corepack pnpm --config.verify-deps-before-run=false typecheck`: PASS.
- `corepack pnpm --config.verify-deps-before-run=false launch:functional-rc`: OK, 0 grupos fallidos (`outputs/launch-functional-rc/2026-06-26T20-01-18-184Z/summary.md` y `summary.json` con `contract`).
- `corepack pnpm --config.verify-deps-before-run=false launch:rc-external-closure`: FAILED esperado, 1 fallo y 2 warnings; genera `outputs/launch-rc-external-closure/2026-06-26T20-02-56-705Z/next-approval.md`.
- `corepack pnpm --config.verify-deps-before-run=false launch:status`: BLOCKED esperado, 9 blockers, 0 warnings y 9 Open Go/No-Go (`outputs/launch-status/2026-06-26T20-03-01-579Z/summary.md`).

## Avance Implementado 2026-06-26, Nonagesimo Tercer Corte

Nonagesimo tercer corte integrado: el manifest de build Pages valida estructura deployable basica, no solo snippets del guard.

Archivos:

- `scripts/launch/staging-no-real-payments-remediation.ts`
- `tests/unit/no-real-payments-runbook.test.ts`
- `docs/launch/NO_REAL_PAYMENTS.md`
- `docs/launch/FUNCTIONAL_GAP_ROADMAP.md`

Cambio:

- `pages-staging-build-manifest.json` ahora incluye `pagesPackage`: `dist/server/wrangler.json`, `dist/server/entry.mjs`, `dist/client`, binding `ASSETS`, `CHECKOUT_ENABLED=false`, `nodejs_compat`, conteo total de ficheros, tamano total, fichero mayor y checks de limites Pages.
- `readyForStagingDeployPackage` exige guard compilado y estructura Pages basica antes de usar un build local para Cloudflare Pages staging.
- `launch:staging-no-real-payments-remediation` reporta `fileCount`, `maxFileBytes` y `checkoutEnabledDefault` dentro del check `local_build_package_guard`.

Evidencia:

- `corepack pnpm --config.verify-deps-before-run=false launch:staging-no-real-payments-remediation`: FAILED esperado, 1 fallo y 2 warnings; `local_build_package_guard` OK con `fileCount=205`, `maxFileBytes=987792`, `checkoutEnabledDefault=false`; `pages-staging-build-manifest.json` muestra `readyForStagingDeployPackage=true`, `wranglerJsonExists=true`, `serverEntryExists=true`, `clientAssetsExists=true`, `assetsBinding=ASSETS`, `nodejsCompat=true`, `withinPagesFileCountLimit=true` y `withinPagesFileSizeLimit=true`. Falla esperado en `deployed_checkout_probe` porque staging remoto sigue devolviendo `400 priceId is required`.
- `corepack pnpm --config.verify-deps-before-run=false launch:rc-external-closure`: FAILED esperado, 1 fallo y 2 warnings.
- `corepack pnpm --config.verify-deps-before-run=false launch:status`: BLOCKED esperado, 9 blockers, 0 warnings y 9 Open Go/No-Go (`outputs/launch-status/2026-06-26T19-36-13-937Z/summary.md`).
- `corepack pnpm --config.verify-deps-before-run=false exec vitest run --coverage=false tests/unit/no-real-payments-runbook.test.ts tests/unit/operations-runbook.test.ts`: PASS, 14 tests.
- `corepack pnpm --config.verify-deps-before-run=false typecheck`: PASS.
- `git diff --check`: PASS con avisos CRLF heredados.

## Avance Implementado 2026-06-26, Nonagesimo Segundo Corte

Nonagesimo segundo corte integrado: Cloudflare Pages staging no-real-payments tiene manifest de build local antes de deploy.

Archivos:

- `scripts/launch/staging-no-real-payments-remediation.ts`
- `scripts/launch/rc-external-closure.ts`
- `scripts/launch/status.ts`
- `tests/unit/no-real-payments-runbook.test.ts`
- `tests/unit/operations-runbook.test.ts`
- `docs/launch/NO_REAL_PAYMENTS.md`
- `docs/launch/RC_EVIDENCE_REFRESH.md`
- `docs/launch/FUNCTIONAL_GAP_ROADMAP.md`

Cambio:

- `launch:staging-no-real-payments-remediation` genera `pages-staging-build-manifest.json` con `readyForStagingDeployPackage`, snippets del guard encontrados en `dist`, rutas, hashes SHA-256, post-deploy proof requerido y scope prohibido.
- El approval Cloudflare staging exige revisar ese manifest si se usa build local como fuente de deploy.
- `launch:rc-external-closure` y `next-approval.md` enlazan el build manifest junto con `rc-staging-package.md`, `rc-staging-package-files.txt`, `rc-staging-runtime-diff.patch` y `rc-staging-runtime-manifest.json`.
- `launch:status` muestra `Staging No-Real-Payments Build Manifest` como fuente disponible.

Evidencia:

- `corepack pnpm --config.verify-deps-before-run=false build`: PASS; genera `dist`.
- `corepack pnpm --config.verify-deps-before-run=false launch:staging-no-real-payments-remediation`: FAILED esperado, 1 fallo y 2 warnings; `local_build_package_guard` OK y `pages-staging-build-manifest.json` muestra `readyForStagingDeployPackage=true`; falla `deployed_checkout_probe` porque staging devuelve `400 priceId is required`.
- `corepack pnpm --config.verify-deps-before-run=false launch:rc-external-closure`: FAILED esperado, 1 fallo y 2 warnings; `next-approval.md` enlaza `pages-staging-build-manifest.json`.
- `corepack pnpm --config.verify-deps-before-run=false launch:status`: BLOCKED esperado, 9 blockers, 0 warnings y 9 Open Go/No-Go (`outputs/launch-status/2026-06-26T19-31-53-978Z/summary.md`).
- `corepack pnpm --config.verify-deps-before-run=false exec vitest run --coverage=false tests/unit/no-real-payments-runbook.test.ts tests/unit/operations-runbook.test.ts`: PASS, 14 tests.
- `corepack pnpm --config.verify-deps-before-run=false typecheck`: PASS.
- `git diff --check`: PASS con avisos CRLF heredados.

## Avance Implementado 2026-06-26, Nonagesimo Primer Corte

Nonagesimo primer corte integrado: `operations_external` tiene manifest estructurado de evidencia read-only y side-effect gates.

Archivos:

- `scripts/launch/operations-external-closure.ts`
- `scripts/launch/rc-external-closure.ts`
- `scripts/launch/status.ts`
- `tests/unit/operations-runbook.test.ts`
- `docs/launch/RC_EVIDENCE_REFRESH.md`
- `docs/launch/MANUAL_EVIDENCE_RUNBOOK.md`
- `docs/launch/FUNCTIONAL_GAP_ROADMAP.md`

Cambio:

- `launch:operations-external-closure` genera `operations-external-evidence-manifest.json` con soporte local/read-only, target Worker staging, checks, evidencia manual pendiente, targets read-only, side effects que requieren aprobacion separada, reglas de evidencia y scope prohibido.
- `launch:rc-external-closure` enlaza el manifest en el preflight de `operations_external_evidence`.
- `launch:status` muestra `Operations External Evidence Manifest` como fuente disponible.
- Las guias de RC y evidencia manual piden revisar el manifest junto con el closure pack, approval request y dry-run.

Evidencia:

- `corepack pnpm --config.verify-deps-before-run=false launch:staging-operations -- --include-wrangler`: OK, 0 fallos y 0 warnings; evidencia read-only fresca en `outputs/launch-staging-operations-preflight/2026-06-26T19-24-04-031Z/summary.md`.
- `corepack pnpm --config.verify-deps-before-run=false launch:operations-external-closure`: WARNING esperado, 0 fallos y 1 warning por evidencia manual pendiente; genera `outputs/launch-operations-external-closure/2026-06-26T19-24-24-194Z/operations-external-evidence-manifest.json`.
- `corepack pnpm --config.verify-deps-before-run=false launch:rc-external-closure`: FAILED esperado, 1 fallo y 2 warnings; el pack enlaza el manifest de operations.
- `corepack pnpm --config.verify-deps-before-run=false launch:status`: BLOCKED esperado, 9 blockers, 0 warnings y 9 Open Go/No-Go (`outputs/launch-status/2026-06-26T19-24-44-738Z/summary.md`).
- `corepack pnpm --config.verify-deps-before-run=false exec vitest run --coverage=false tests/unit/operations-runbook.test.ts`: PASS, 13 tests.
- `corepack pnpm --config.verify-deps-before-run=false typecheck`: PASS.
- `git diff --check`: PASS con avisos CRLF heredados.

## Avance Implementado 2026-06-26, Nonagesimo Corte

Nonagesimo corte integrado: el rollout local de Supabase staging tiene manifest estructurado de migraciones antes de pedir writes externos.

Archivos:

- `scripts/launch/staging-database-rollout.ts`
- `scripts/launch/rc-external-closure.ts`
- `tests/unit/operations-runbook.test.ts`
- `docs/launch/RC_EVIDENCE_REFRESH.md`
- `docs/launch/MANUAL_EVIDENCE_RUNBOOK.md`
- `docs/launch/FUNCTIONAL_GAP_ROADMAP.md`

Cambio:

- `launch:staging-db-rollout` genera `staging-migration-manifest.json` separado del `summary.json`, con target `espanol-staging`, hashes SHA-256 de migraciones, hash/tamano del bundle SQL, preflight requerido, post-checks, reglas de evidencia y scope prohibido.
- `launch:rc-external-closure` enlaza el manifest en el preflight de `supabase_staging_schema_rollout`.
- Las guias RC y evidencia manual exigen revisar el manifest junto con `rollout-plan.md`, `approval-request.md`, `staging-migration-bundle.sql` y `manual-evidence-dry-run.txt`.

Evidencia:

- `corepack pnpm --config.verify-deps-before-run=false exec vitest run --coverage=false tests/unit/operations-runbook.test.ts`: PASS, 13 tests.
- `corepack pnpm --config.verify-deps-before-run=false typecheck`: PASS.
- `corepack pnpm --config.verify-deps-before-run=false launch:staging-db-rollout`: OK, 0 fallos y 0 warnings; genera `outputs/launch-staging-database-rollout/2026-06-26T19-18-19-441Z/staging-migration-manifest.json`.
- `corepack pnpm --config.verify-deps-before-run=false launch:rc-external-closure`: FAILED esperado, 1 fallo y 2 warnings; el pack enlaza el manifest Supabase y el `next-approval.md` sigue priorizando Cloudflare staging sin cobros.
- `corepack pnpm --config.verify-deps-before-run=false launch:status`: BLOCKED esperado, 9 blockers, 0 warnings y 9 Open Go/No-Go (`outputs/launch-status/2026-06-26T19-18-58-472Z/summary.md`).
- `git diff --check`: PASS con avisos CRLF heredados.

## Avance Implementado 2026-06-26, Octogesimo Noveno Corte

Octogesimo noveno corte integrado: el paquete runtime de Cloudflare staging tiene manifest estructurado con hashes y estado de guard.

Archivos:

- `scripts/launch/worktree-audit.ts`
- `scripts/launch/rc-external-closure.ts`
- `scripts/launch/status.ts`
- `tests/unit/operations-runbook.test.ts`
- `docs/launch/GIT_WORKTREE_PLAN.md`
- `docs/launch/RC_EVIDENCE_REFRESH.md`
- `docs/launch/FUNCTIONAL_GAP_ROADMAP.md`

Cambio:

- `launch:worktree` genera `rc-staging-runtime-manifest.json` con hashes SHA-256 de working tree y `HEAD`, estado `workingTreeGuardReady`/`headGuardReady`, snippets del guard y forbidden scope.
- `launch:rc-external-closure` exige revisar el manifest junto con `rc-staging-package.md`, `rc-staging-package-files.txt` y `rc-staging-runtime-diff.patch`.
- `launch:status` muestra el manifest como parte del trio/cuarteto que debe revisarse antes de confiar en `CHECKOUT_ENABLED=false`.

Evidencia:

- `corepack pnpm --config.verify-deps-before-run=false exec vitest run --coverage=false tests/unit/operations-runbook.test.ts`: PASS, 13 tests.
- `corepack pnpm --config.verify-deps-before-run=false typecheck`: PASS.
- `corepack pnpm --config.verify-deps-before-run=false launch:worktree`: WARNING esperado, 346 items, 0 failed risks, 0 warnings; genera `outputs/launch-worktree/2026-06-26T19-07-35-516Z/rc-staging-runtime-manifest.json` con `workingTreeGuardReady=true`, `headGuardReady=false` y `requiredRuntimeFilesPresent=true`.
- `corepack pnpm --config.verify-deps-before-run=false launch:rc-external-closure`: FAILED esperado, 1 failed y 2 warnings; `next-approval.md` apunta al manifest nuevo.
- `corepack pnpm --config.verify-deps-before-run=false launch:status`: BLOCKED esperado, 9 blockers, 0 warnings y 9 Open Go/No-Go (`outputs/launch-status/2026-06-26T19-08-04-574Z/summary.md`).

## Avance Implementado 2026-06-26, Octogesimo Octavo Corte

Octogesimo octavo corte integrado: el paquete local para Cloudflare staging sin cobros ahora incluye un diff runtime de revision.

Archivos:

- `scripts/launch/worktree-audit.ts`
- `scripts/launch/rc-external-closure.ts`
- `scripts/launch/status.ts`
- `tests/unit/operations-runbook.test.ts`
- `docs/launch/GIT_WORKTREE_PLAN.md`
- `docs/launch/RC_EVIDENCE_REFRESH.md`
- `docs/launch/FUNCTIONAL_GAP_ROADMAP.md`

Cambio:

- `launch:worktree` genera `rc-staging-runtime-diff.patch`, limitado a los archivos runtime requeridos para que Cloudflare Pages staging pueda bloquear checkout: `src/pages/api/create-checkout.ts`, `src/lib/runtime-env.ts` y `wrangler.toml`.
- El diff queda marcado como review-only: no stagea, no commitea, no despliega, no aplica cambios y no autoriza writes externos.
- `launch:rc-external-closure` y `next-approval.md` enlazan el nuevo diff junto a `rc-staging-package.md` y `rc-staging-package-files.txt`.
- `launch:status` nombra el trio completo antes de confiar en `CHECKOUT_ENABLED=false`.

Evidencia:

- `corepack pnpm --config.verify-deps-before-run=false exec vitest run --coverage=false tests/unit/operations-runbook.test.ts`: PASS, 13 tests.
- `corepack pnpm --config.verify-deps-before-run=false typecheck`: PASS.
- `corepack pnpm --config.verify-deps-before-run=false launch:worktree`: WARNING esperado, 346 items, 0 failed risks, 0 warnings; genera `outputs/launch-worktree/2026-06-26T19-02-52-430Z/rc-staging-runtime-diff.patch`.
- `corepack pnpm --config.verify-deps-before-run=false launch:rc-external-closure`: FAILED esperado, 1 failed y 2 warnings; `next-approval.md` apunta al worktree `2026-06-26T19-02-52-430Z`.
- `corepack pnpm --config.verify-deps-before-run=false launch:status`: BLOCKED esperado, 9 blockers, 0 warnings y 9 Open Go/No-Go (`outputs/launch-status/2026-06-26T19-03-10-230Z/summary.md`).

## Avance Implementado 2026-06-26, Octogesimo Septimo Corte

Octogesimo septimo corte integrado: la aprobacion externa siguiente incluye checklist de ejecucion y condiciones de parada.

Archivos:

- `scripts/launch/rc-external-closure.ts`
- `tests/unit/operations-runbook.test.ts`
- `docs/launch/RC_EVIDENCE_REFRESH.md`
- `docs/launch/FUNCTIONAL_GAP_ROADMAP.md`

Cambio:

- `next-approval.md` conserva el scope atomico de un solo recurso, pero ahora incluye `Execution Checklist After Approval` y `Stop Conditions`.
- Para `cloudflare_pages_no_real_payments`, el checklist exige revisar `rc-staging-package.md`, confirmar cuenta/proyecto/entorno staging, empaquetar/deployar la slice si `Current HEAD guard ready` es `no`, verificar solo `CHECKOUT_ENABLED=false` y comprobar 403.
- Las stop conditions bloquean una variable-only fix si el deploy no contiene el guard, cualquier expansion a production/Stripe live/cobros reales, evidencia con secretos o un post-check que siga devolviendo `400 priceId is required`.

Evidencia:

- `corepack pnpm --config.verify-deps-before-run=false exec vitest run --coverage=false tests/unit/operations-runbook.test.ts`: PASS, 13 tests.
- `corepack pnpm --config.verify-deps-before-run=false typecheck`: PASS.
- `corepack pnpm --config.verify-deps-before-run=false launch:rc-external-closure`: FAILED esperado, 1 failed y 2 warnings; genera `outputs/launch-rc-external-closure/2026-06-26T18-57-17-486Z/next-approval.md` con checklist y stop conditions.
- `corepack pnpm --config.verify-deps-before-run=false launch:status`: BLOCKED esperado, 9 blockers, 0 warnings y 9 Open Go/No-Go (`outputs/launch-status/2026-06-26T18-57-34-484Z/summary.md`).

## Avance Implementado 2026-06-26, Octogesimo Sexto Corte

Octogesimo sexto corte integrado: el cierre externo RC ahora genera una aprobacion siguiente, atomica y de un solo recurso.

Archivos:

- `scripts/launch/rc-external-closure.ts`
- `scripts/launch/status.ts`
- `tests/unit/operations-runbook.test.ts`
- `docs/launch/RC_EVIDENCE_REFRESH.md`
- `docs/launch/FUNCTIONAL_GAP_ROADMAP.md`

Cambio:

- `launch:rc-external-closure` sigue generando el pack consolidado y el approval general, pero ahora tambien genera `next-approval.md`.
- `next-approval.md` elige el primer item abierto, priorizando fallos antes que warnings, para que la aprobacion externa no mezcle Cloudflare, Supabase y operations.
- `launch:status` enlaza `RC External Next Approval` y lo muestra en `Next Actions`.
- La siguiente aprobacion recomendada queda acotada a `cloudflare_pages_no_real_payments` para Cloudflare Pages project `espanol-honesto-staging`.

Evidencia:

- `corepack pnpm --config.verify-deps-before-run=false exec vitest run --coverage=false tests/unit/operations-runbook.test.ts`: PASS, 13 tests.
- `corepack pnpm --config.verify-deps-before-run=false typecheck`: PASS.
- `corepack pnpm --config.verify-deps-before-run=false launch:rc-external-closure`: FAILED esperado, 1 failed y 2 warnings; genera `outputs/launch-rc-external-closure/2026-06-26T18-52-45-084Z/next-approval.md`.
- `corepack pnpm --config.verify-deps-before-run=false launch:status`: BLOCKED esperado, 9 blockers, 0 warnings y 9 Open Go/No-Go; enlaza `outputs/launch-rc-external-closure/2026-06-26T18-52-45-084Z/next-approval.md`.

## Avance Implementado 2026-06-26, Octogesimo Quinto Corte

Octogesimo quinto corte integrado: la guia RC ya no arrastra rutas antiguas en el bloque de ultimo refresh y queda alineada con la hoja unica de cierres externos.

Archivos:

- `docs/launch/RC_EVIDENCE_REFRESH.md`
- `docs/launch/FUNCTIONAL_GAP_ROADMAP.md`

Cambio:

- `RC_EVIDENCE_REFRESH.md` mantiene el estado actual, pero remite a los ultimos `outputs/launch-*/*` generados en vez de fijar artefactos antiguos como fuente de verdad.
- La hoja unica `launch:rc-external-closure` queda confirmada como el mapa operativo de aprobaciones externas: Cloudflare Pages staging sin cobros, Supabase staging schema rollout y operations evidence.
- No se ha tocado producto, pagos, Supabase, Cloudflare, Resend, Google, Stripe ni secretos.

Evidencia:

- `corepack pnpm --config.verify-deps-before-run=false exec vitest run --coverage=false tests/unit/operations-runbook.test.ts`: PASS, 13 tests.
- `corepack pnpm --config.verify-deps-before-run=false launch:rc-external-closure`: FAILED esperado, 1 failed y 2 warnings (`outputs/launch-rc-external-closure/2026-06-26T18-47-03-827Z/summary.md`).
- `corepack pnpm --config.verify-deps-before-run=false launch:status`: BLOCKED esperado, 9 blockers, 0 warnings y 9 Open Go/No-Go (`outputs/launch-status/2026-06-26T18-47-10-463Z/summary.md`).
- `git diff --check`: OK con avisos CRLF solamente.

## Avance Implementado 2026-06-26, Octogesimo Cuarto Corte

Octogesimo cuarto corte integrado: los gates Fase 1/RC quedan refrescados despues de la tanda amplia local y el checklist deja de copiar rutas fechadas antiguas.

Archivos:

- `docs/launch/CHECKLIST.md`
- `docs/launch/FUNCTIONAL_GAP_ROADMAP.md`

Cambio:

- `launch:phase1` y `launch:rc` se reejecutan con evidencia local fresca.
- El resultado sigue siendo el esperado: Fase 1 bloqueada solo por `database_readiness` y `operations_external`; RC bloqueado por Fase 1 y `no_real_payments_staging`.
- `launch:rc-external-closure` se regenera despues de esos gates y enlaza los packs frescos de Cloudflare staging, Supabase staging y operations evidence.
- `CHECKLIST.md` ya no fija timestamps antiguos para `operations_external` ni `database_readiness`; usa `Current Evidence` y rutas `<timestamp>` para evitar que `launch:status` copie referencias obsoletas.

Evidencia:

- `corepack pnpm launch:phase1`: BLOCKED esperado, 2 checks abiertos (`outputs/launch-phase-1/2026-06-26T18-35-41-084Z/summary.md`).
- `corepack pnpm launch:rc`: RC_BLOCKED_BY_PHASE_1 esperado (`outputs/launch-rc/2026-06-26T18-35-41-448Z/summary.md`).
- `corepack pnpm launch:rc-external-closure`: FAILED esperado por `cloudflare_pages_no_real_payments`; warnings esperados en `supabase_staging_schema_rollout` y `operations_external_evidence` (`outputs/launch-rc-external-closure/2026-06-26T18-38-32-084Z/summary.md`).
- `corepack pnpm launch:status`: BLOCKED esperado, 9 blockers, 0 warnings y 9 Open Go/No-Go (`outputs/launch-status/2026-06-26T18-40-01-479Z/summary.md`).
- `git diff --check` en los documentos tocados: OK con aviso CRLF solamente.

## Avance Implementado 2026-06-26, Octogesimo Tercer Corte

Octogesimo tercer corte integrado: deps/config/CI y base de launch quedan verificados con la tanda amplia local.

Archivos verificados:

- `outputs/launch-worktree/2026-06-26T18-25-30-431Z/package-file-lists/deps_config_ci.txt`
- `outputs/launch-worktree/2026-06-26T18-25-30-431Z/package-file-lists/base_launch_cleanup.txt`

Cambio:

- Se ejecuta la validacion amplia del repo: test suite completa, lint, build Cloudflare/Astro, secret scan local, cleanup audit y sequence audit.
- El build completa correctamente; el secret scan no encuentra secretos obvios en archivos trackeados/no ignorados.
- `git diff --check` no encuentra errores; solo avisa de normalizacion CRLF pendiente cuando Git toque algunos archivos.
- Esto no cierra los blockers externos ni final-only, pero reduce el riesgo de que haya trabajo local roto por debajo del RC.

Evidencia:

- `corepack pnpm test:run`: OK, 65 archivos y 402 tests.
- `corepack pnpm lint`: OK.
- `corepack pnpm build`: OK.
- `corepack pnpm secrets:check`: OK, no obvious secrets found in tracked/unignored files.
- `corepack pnpm launch:cleanup`: OK, 0 failed, 0 warnings (`outputs/launch-cleanup/2026-06-26T18-33-36-983Z/summary.md`).
- `corepack pnpm launch:sequence`: OK, 0 failed, 0 warnings (`outputs/launch-sequence/2026-06-26T18-33-36-983Z/summary.md`).
- `git diff --check`: OK con avisos CRLF solamente.

## Avance Implementado 2026-06-26, Octogesimo Segundo Corte

Octogesimo segundo corte integrado: superficie publica/SEO, calendario/campus y pagos bloqueados quedan verificados por paquete.

Archivos verificados:

- `outputs/launch-worktree/2026-06-26T18-25-30-431Z/package-file-lists/public_seo_conversion.txt`
- `outputs/launch-worktree/2026-06-26T18-25-30-431Z/package-file-lists/calendar_teachers_campus.txt`
- `outputs/launch-worktree/2026-06-26T18-25-30-431Z/package-file-lists/payments_worker_no_real_payments.txt`

Cambio:

- Se ejecutan validaciones enfocadas recomendadas por `launch:worktree` para landings/SEO/contenido, calendario/sesiones/campus y pagos bloqueados/Worker fulfillment.
- El modo local sin cobros reales sigue fail-closed y auditado; el unico warning de `launch:no-real-payments` es la falta de confirmacion desplegada de Cloudflare Pages staging.
- Calendario mantiene reglas de disponibilidad, sesiones, duraciones 30/40/50 y flujos de estudiante/profesor/admin cubiertos por tests.
- SEO/contenido sigue sin fallos ni warnings en la superficie publica RC.

Evidencia:

- `corepack pnpm exec vitest run --coverage=false tests/unit/landing-public-content.test.ts tests/unit/seo-surface.test.ts tests/unit/landing-schema.test.ts`: OK, 3 archivos y 36 tests.
- `corepack pnpm launch:seo`: OK, 0 failed, 0 warnings (`outputs/launch-seo/2026-06-26T18-31-10-202Z/summary.md`).
- `corepack pnpm launch:content`: OK, 0 failed, 0 warnings (`outputs/launch-content/2026-06-26T18-31-10-208Z/summary.md`).
- `corepack pnpm exec vitest run --coverage=false tests/api/sessions-create.test.ts tests/api/session-action.test.ts tests/api/available-slots.test.ts tests/api/bulk-sessions.test.ts tests/api/recurring-sessions.test.ts tests/api/teacher-availability.test.ts tests/unit/StudentClassList.test.tsx tests/unit/TeacherCalendar.test.tsx`: OK, 8 archivos y 77 tests.
- `corepack pnpm launch:no-real-payments`: WARNING esperado, 0 failed, 1 warning por confirmacion desplegada pendiente (`outputs/launch-no-real-payments/2026-06-26T18-31-24-517Z/no-real-payments-closure-pack.md`).
- `corepack pnpm launch:payments`: OK, 0 failed, 0 warnings (`outputs/launch-payments/2026-06-26T18-31-24-519Z/summary.md`).
- `corepack pnpm exec vitest run --coverage=false tests/api/create-checkout.test.ts tests/unit/no-real-payments-runbook.test.ts tests/api/admin-fulfillment-jobs.test.ts tests/unit/internal-job-service.test.ts tests/unit/payment-recovery-actions.test.tsx tests/unit/subscription-renewal-actions.test.tsx`: OK, 6 archivos y 19 tests.
- `corepack pnpm fulfillment:typecheck`: OK.

## Avance Implementado 2026-06-26, Octogesimo Primer Corte

Octogesimo primer corte integrado: CRM/diagnostico y emails/onboarding quedan verificados por paquete, no solo por el resumen funcional RC.

Archivos verificados:

- `outputs/launch-worktree/2026-06-26T18-25-30-431Z/package-file-lists/crm_requests_diagnostic.txt`
- `outputs/launch-worktree/2026-06-26T18-25-30-431Z/package-file-lists/emails_support_onboarding.txt`

Cambio:

- Se ejecutan las validaciones enfocadas recomendadas por `launch:worktree` para los paquetes de CRM/solicitud/diagnostico y emails/soporte/onboarding.
- Esto refuerza que el flujo comercial local, trazabilidad CRM, diagnostico ligero, emails transaccionales, soporte y onboarding post-pago estan cubiertos por tests especificos.
- No sustituye Supabase hosted, Resend real, Cloudflare staging ni evidencias manuales externas; esas siguen en `database_readiness`, `operations_external` y final-only.

Evidencia:

- `corepack pnpm exec vitest run --coverage=false tests/api/subscribe.test.ts tests/api/level-check.test.ts tests/api/admin-leads.test.ts tests/unit/crm-lead-capture.test.ts tests/unit/crm-contact-detail.test.ts tests/unit/crm-task-list.test.tsx tests/unit/crm-opportunity-list.test.tsx`: OK, 7 archivos y 38 tests.
- `corepack pnpm exec vitest run --coverage=false tests/unit/email-templates.test.ts tests/api/email-send-test.test.ts tests/api/support-alert.test.ts tests/api/admin-support-tickets.test.ts tests/unit/crm-onboarding.test.ts tests/unit/crm-class-email.test.ts tests/unit/session-fulfillment.test.ts`: OK, 7 archivos y 38 tests.
- `corepack pnpm fulfillment:typecheck`: OK.
- `corepack pnpm typecheck`: OK.

## Avance Implementado 2026-06-26, Octogesimo Corte

Octogesimo corte integrado: el dashboard vivo de launch apunta tambien a la lista plana de la slice Cloudflare staging.

Archivos:

- `scripts/launch/status.ts`
- `docs/launch/RC_EVIDENCE_REFRESH.md`
- `tests/unit/operations-runbook.test.ts`

Cambio:

- `launch:status` ya recomienda revisar tanto `rc-staging-package.md` como `rc-staging-package-files.txt` antes de confiar en `CHECKOUT_ENABLED=false`.
- `RC_EVIDENCE_REFRESH.md` incluye la lista plana en rutas utiles y en la instruccion previa al approval Cloudflare.
- Esto mantiene alineados el dashboard, el pack RC externo y el audit del worktree para cerrar `no_real_payments_staging` sin desplegar mas archivos de los necesarios.

Evidencia:

- `corepack pnpm exec vitest run tests/unit/operations-runbook.test.ts tests/unit/no-real-payments-runbook.test.ts --coverage=false`: OK, 14 tests.
- `corepack pnpm launch:status`: BLOCKED esperado, 9 blockers, 0 warnings y 9 Open Go/No-Go (`outputs/launch-status/2026-06-26T18-27-55-813Z/summary.md`).
- `corepack pnpm typecheck`: OK.
- `git diff --check` en archivos tocados: OK.

## Avance Implementado 2026-06-26, Septuagesimo Noveno Corte

Septuagesimo noveno corte integrado: la higiene del arbol Git queda mas operativa para separar commits/paquetes sin tocar staging ni servicios externos.

Archivos:

- `scripts/launch/worktree-audit.ts`
- `docs/launch/GIT_WORKTREE_PLAN.md`
- `tests/unit/operations-runbook.test.ts`

Cambio:

- `launch:worktree` genera ahora `package-file-lists/` con una lista plana por paquete funcional.
- `summary.json` expone `fileListPath` por paquete, y `summary.md` enlaza cada lista en la tabla de paquetes.
- Cada lista incluye validaciones recomendadas y rutas con estado Git para revisar/commitear por paquete sin mezclar runtime, launch docs, CRM, emails, calendario, pagos, CI ni tooling de agente.
- El comando sigue siendo read-only respecto al repo: no hace staging, commits, deploys, movimientos ni borrados.
- La slice especial `rc-staging-package-files.txt` se mantiene separada para Cloudflare Pages staging/no-cobros.

Evidencia:

- `corepack pnpm launch:worktree`: WARNING esperado, 346 items, 0 failed risks, 0 warnings (`outputs/launch-worktree/2026-06-26T18-25-30-431Z/summary.md`).
- Listas generadas: `outputs/launch-worktree/2026-06-26T18-25-30-431Z/package-file-lists/`.
- `corepack pnpm exec vitest run tests/unit/operations-runbook.test.ts tests/unit/no-real-payments-runbook.test.ts --coverage=false`: OK, 14 tests.
- `corepack pnpm typecheck`: OK.
- `git diff --check` en archivos tocados: OK.

## Avance Implementado 2026-06-26, Septuagesimo Octavo Corte

Septuagesimo octavo corte integrado: el checklist vuelve a reflejar el estado vivo de RC en vez de conservar evidencia externa antigua como cerrada.

Archivos:

- `docs/launch/CHECKLIST.md`
- `docs/launch/FUNCTIONAL_GAP_ROADMAP.md`

Cambio:

- `operations_external` queda reabierto en el checklist porque la evidencia historica de 2026-06-11 ya no basta para congelar RC.
- `database_readiness` queda visible como check abierto de RC por drift real entre Supabase alojado y las migraciones actuales de leads/CRM/idiomas/diagnostico.
- El checklist enlaza los packs frescos de cierre externo y rollout staging, sin tocar servicios externos ni rellenar evidencia manual.
- `launch:status` ahora muestra 9 Open Go/No-Go porque el checklist ya no oculta `operations_external`; los blockers siguen siendo 9 y los warnings siguen en 0.

Evidencia:

- `corepack pnpm exec vitest run tests/unit/operations-runbook.test.ts tests/unit/no-real-payments-runbook.test.ts tests/unit/functional-rc-runbook.test.ts --coverage=false`: OK, 15 tests.
- `corepack pnpm launch:functional-rc`: OK, 0 grupos fallidos (`outputs/launch-functional-rc/2026-06-26T18-18-49-955Z/summary.md`).
- `corepack pnpm launch:status`: BLOCKED esperado, 9 blockers, 0 warnings y 9 Open Go/No-Go (`outputs/launch-status/2026-06-26T18-18-49-959Z/summary.md`).
- `git diff --check` en los archivos tocados: OK.

## Avance Implementado 2026-06-26, Septuagesimo Septimo Corte

Septuagesimo septimo corte integrado: el flujo comercial inicial queda expresado como contrato operativo de RC.

Archivos:

- `src/lib/crm/lead-capture.ts`
- `tests/unit/crm-lead-capture.test.ts`
- `scripts/launch/functional-rc.ts`
- `tests/unit/functional-rc-runbook.test.ts`
- `docs/launch/FUNCTIONAL_RC.md`

Cambio:

- La tarea CRM creada por una solicitud de plaza conserva SLA de 24h para primera respuesta humana.
- La tarea queda marcada como cola compartida de fundadores con asignacion manual requerida.
- La metadata conserva contexto comercial util: fuente, interes, nivel, plan preferido, disponibilidad, lenguas e indicador rusofono.
- El resumen de `launch:functional-rc` y la guia de RC describen el contrato: solicitud -> contacto/oportunidad/consentimiento/actividad/tarea -> decision de propuesta, posponer, perder o ganar.
- Los emails comerciales manuales siguen separados del consentimiento de marketing y trazados en CRM.

Evidencia:

- `corepack pnpm exec vitest run tests/unit/crm-lead-capture.test.ts tests/unit/functional-rc-runbook.test.ts --coverage=false`: OK.
- `corepack pnpm typecheck`: OK.
- `corepack pnpm lint`: OK.
- `corepack pnpm launch:functional-rc`: OK, 0 grupos fallidos.
- `corepack pnpm test:run`: OK, 65 archivos y 402 tests.
- `corepack pnpm build`: OK.
- `corepack pnpm fulfillment:typecheck`: OK.
- `corepack pnpm launch:cleanup`: OK.
- `corepack pnpm launch:content`: OK.
- `corepack pnpm launch:seo`: OK.
- `corepack pnpm launch:payments`: OK.
- `corepack pnpm launch:status`: BLOCKED esperado por 9 blockers externos/final-only y 0 warnings.
- `corepack pnpm launch:worktree`: WARNING esperado por arbol amplio, 346 items, 0 failed risks y 0 warnings.
- `corepack pnpm launch:phase1`: BLOCKED esperado solo por `database_readiness` y `operations_external`.
- `corepack pnpm launch:rc-external-closure`: FAILED esperado por `cloudflare_pages_no_real_payments`; warnings esperados en `supabase_staging_schema_rollout` y `operations_external_evidence`.

## Avance Implementado 2026-06-26, Septuagesimo Sexto Corte

Septuagesimo sexto corte integrado: el diagnostico ligero protege mejor la privacidad al sincronizar con CRM.

Archivos:

- `src/lib/crm/level-check.ts`
- `tests/unit/crm-level-check.test.ts`
- `docs/launch/LEVEL_CHECK.md`

Cambio:

- La actividad y la tarea CRM del diagnostico ligero sanitizan metadata antes de guardarla.
- La tarea `Review lightweight level check` conserva resumen, flags de encaje, nivel/contexto operativo y referencia a `leads.level_check_context`.
- La muestra escrita, contexto crudo, enlaces de audio/documento/video y claves equivalentes no se copian a metadata CRM.
- La muestra cruda sigue viviendo solo temporalmente en `leads.level_check_context`, con limpieza al revisar, descartar o convertir la oportunidad.

Evidencia:

- `corepack pnpm exec vitest run --coverage=false tests/api/level-check.test.ts tests/unit/crm-level-check.test.ts`: OK.
- `corepack pnpm typecheck`: OK.
- `corepack pnpm lint`: OK.
- `corepack pnpm launch:functional-rc`: OK.
- `corepack pnpm launch:status`: BLOCKED esperado por 9 blockers externos/final-only y 0 warnings.

## Avance Implementado 2026-06-26, Septuagesimo Quinto Corte

Septuagesimo quinto corte integrado: el onboarding post-pago tiene contrato de activacion explicito.

Archivos:

- `src/lib/email/templates.ts`
- `docs/launch/EMAIL_MATRIX.md`
- `docs/launch/FUNCTIONAL_RC.md`
- `scripts/launch/functional-rc.ts`
- `tests/unit/email-templates.test.ts`
- `tests/unit/functional-rc-runbook.test.ts`

Cambio:

- La bienvenida post-pago pide abrir campus/materiales y responder con limites de disponibilidad antes de la primera clase.
- La confirmacion de clase mantiene la duracion 30/40/50, pero aclara que la llamada no se corta automaticamente al llegar al minuto previsto.
- `EMAIL_MATRIX.md`, `FUNCTIONAL_RC.md` y el artefacto de `launch:functional-rc` definen activacion post-pago como email aceptado, campus accesible, materiales listos, primera clase coordinada manualmente, tarea CRM SLA 24h y cierre de onboarding al completar primera clase.
- Esto no activa pagos reales, no toca Resend real, Google, Supabase alojado, Cloudflare ni evidencia manual.

Evidencia:

- `corepack pnpm exec vitest run --coverage=false tests/unit/email-templates.test.ts tests/unit/functional-rc-runbook.test.ts`: OK.
- `corepack pnpm launch:functional-rc`: OK.
- `corepack pnpm typecheck`: OK.
- `corepack pnpm lint`: OK.

## Avance Implementado 2026-06-26, Septuagesimo Cuarto Corte

Septuagesimo cuarto corte integrado: el modo sin cobros reales tiene gate propio.

Archivos:

- `scripts/launch/no-real-payments.ts`
- `docs/launch/NO_REAL_PAYMENTS.md`
- `docs/launch/LAUNCH_SEQUENCE.md`
- `package.json`
- `tests/unit/no-real-payments-runbook.test.ts`

Cambio:

- `corepack pnpm launch:no-real-payments` comprueba que `.env.example` mantiene `CHECKOUT_ENABLED=false`, que `/api/create-checkout` falla cerrado, que las landings publicas usan `checkoutMode="application"` y que `launch:payments` pasa.
- El comando ejecuta tests de checkout fail-closed y pricing publico application-first.
- El resultado esperado ahora es `WARNING` si solo falta confirmar el entorno desplegado: el codigo esta protegido, pero Cloudflare Pages/env real no se puede dar por probado desde el repo.
- Genera `outputs/launch-no-real-payments/<timestamp>/no-real-payments-closure-pack.md` y `manual-evidence-dry-run.txt` para registrar `payments_staging` como cerrado en modo sin pagos reales si Alin confirma el entorno.
- No contacta Stripe, no crea Checkout Sessions, no lee secretos desplegados y no edita evidencia manual.

Evidencia:

- `corepack pnpm launch:no-real-payments`: WARNING esperado, 0 fallos y 1 warning por confirmacion manual de entorno desplegado.
- `corepack pnpm exec vitest run --coverage=false --reporter=dot tests/unit/no-real-payments-runbook.test.ts tests/unit/functional-rc-runbook.test.ts tests/unit/operations-runbook.test.ts tests/unit/database-schema-invariants.test.ts`: OK, 4 archivos y 22 tests.
- `corepack pnpm typecheck`: OK.
- `corepack pnpm lint`: OK.
- `corepack pnpm launch:content`: OK.

## Avance Implementado 2026-06-26, Septuagesimo Tercer Corte

Septuagesimo tercer corte integrado: el RC sin cobros reales tiene una verificacion funcional unica.

Archivos:

- `scripts/launch/functional-rc.ts`
- `docs/launch/FUNCTIONAL_RC.md`
- `docs/launch/LAUNCH_SEQUENCE.md`
- `package.json`
- `tests/unit/functional-rc-runbook.test.ts`

Cambio:

- `corepack pnpm launch:functional-rc` agrupa tests existentes en seis bloques: solicitud/CRM, emails transaccionales, diagnostico ligero, onboarding post-pago sin pagos live, seguridad no-real-payments y soporte/recuperacion.
- El comando genera `outputs/launch-functional-rc/<timestamp>/summary.md` y logs por grupo.
- La guia `FUNCTIONAL_RC.md` deja claro que esto prueba la parte funcional local/mock del RC, no Supabase alojado, operaciones externas, legal real, Stripe live, fuente premium rusa, secretos/servicios production, dominio/Search Console ni smoke production.
- `LAUNCH_SEQUENCE.md` incluye esta verificacion como condicion de Fase 2.

Evidencia:

- `corepack pnpm launch:functional-rc`: OK, 0 grupos fallidos.
- `corepack pnpm exec vitest run --coverage=false --reporter=dot tests/unit/functional-rc-runbook.test.ts tests/unit/operations-runbook.test.ts tests/unit/database-schema-invariants.test.ts`: OK, 3 archivos y 21 tests.
- `corepack pnpm typecheck`: OK.
- `corepack pnpm lint`: OK.
- `corepack pnpm launch:content`: OK.

## Avance Implementado 2026-06-26, Septuagesimo Segundo Corte

Septuagesimo segundo corte integrado: `operations_external` ya tiene un pack de cierre que separa evidencia automatica fresca de evidencia manual real.

Archivos:

- `scripts/launch/operations-external-closure.ts`
- `package.json`
- `scripts/launch/manual-evidence-audit.ts`
- `docs/launch/RC_EVIDENCE_REFRESH.md`
- `docs/launch/MANUAL_EVIDENCE_RUNBOOK.md`
- `tests/unit/operations-runbook.test.ts`

Cambio:

- `corepack pnpm launch:operations-external-closure` genera `outputs/launch-operations-external-closure/<timestamp>/operations-external-closure-pack.md`.
- El pack valida que existen `launch:operations` y `launch:staging-operations -- --include-wrangler` frescos.
- El pack genera `manual-evidence-dry-run.txt` con un comando seguro para registrar `operations_external` cuando Alin haya revisado los tres puntos externos pendientes.
- El estado esperado es `WARNING`, no fallo: todavia faltan Cloudflare cron/log visibility, Resend staging delivery/suppression y Admin Jobs staging UI/runtime antes de marcar pass.
- No llama APIs externas, no despliega, no hace tail, no envia email, no procesa jobs y no edita `MANUAL_EVIDENCE.local.json`.

Evidencia:

- `corepack pnpm launch:staging-operations -- --include-wrangler`: OK, 0 fallos y 0 warnings.
- `corepack pnpm launch:operations`: OK.
- `corepack pnpm launch:operations-external-closure`: WARNING esperado, 0 fallos y 1 warning por evidencia manual pendiente.
- `corepack pnpm exec vitest run --coverage=false --reporter=dot tests/unit/operations-runbook.test.ts tests/unit/database-schema-invariants.test.ts`: OK, 2 archivos y 20 tests.
- `corepack pnpm typecheck`: OK.
- `corepack pnpm lint`: OK.
- `corepack pnpm launch:content`: OK.

## Avance Implementado 2026-06-26, Septuagesimo Primer Corte

Septuagesimo primer corte integrado: `database_readiness` ya tiene un paquete local de rollout staging, sin escritura remota.

Archivos:

- `scripts/launch/staging-database-rollout.ts`
- `package.json`
- `scripts/launch/operations-audit.ts`
- `docs/launch/RC_EVIDENCE_REFRESH.md`
- `docs/launch/MANUAL_EVIDENCE_RUNBOOK.md`
- `tests/unit/operations-runbook.test.ts`

Cambio:

- `corepack pnpm launch:staging-db-rollout` genera `outputs/launch-staging-database-rollout/<timestamp>/rollout-plan.md`.
- El pack genera un `staging-migration-bundle.sql` de fallback, un `manifest.json` con hashes y una copia de `post-write-hosted-schema-check.sql`.
- El orden de migraciones staging ahora incluye tambien `020_enforce_profile_role_links.sql`, porque si el remoto va por `017` esa migracion forma parte de la paridad actual del schema.
- El plan separa ruta preferida de migraciones completas de ruta fallback SQL, y recuerda que no conecta con Supabase ni autoriza writes.
- `operations-audit` y las guias de evidencia apuntan al pack de rollout para cerrar `database_readiness` con staging primero.

Evidencia:

- `corepack pnpm install --ignore-scripts`: OK, reconcilia `pnpm` sin ejecutar lifecycle scripts.
- `corepack pnpm launch:staging-db-rollout`: OK, 0 fallos y 0 warnings.
- `corepack pnpm exec vitest run --coverage=false --reporter=dot tests/unit/operations-runbook.test.ts tests/unit/database-schema-invariants.test.ts`: OK, 2 archivos y 19 tests.
- `corepack pnpm launch:operations`: OK.
- `corepack pnpm typecheck`: OK.
- `corepack pnpm lint`: OK.
- `corepack pnpm launch:content`: OK.

## Avance Implementado 2026-06-26, Septuagesimo Corte

Septuagesimo corte integrado: `operations_external` tiene ahora un preflight reproducible de staging que no depende de copiar notas manuales.

Archivos:

- `scripts/launch/staging-operations-preflight.ts`
- `package.json`
- `docs/launch/RC_EVIDENCE_REFRESH.md`
- `docs/launch/MANUAL_EVIDENCE_RUNBOOK.md`
- `tests/unit/operations-runbook.test.ts`

Cambio:

- `corepack pnpm launch:staging-operations` comprueba `GET /health` del Worker staging y que `/internal/jobs/process` rechaza llamadas anonimas con 401.
- `corepack pnpm launch:staging-operations -- --include-wrangler` anade comandos Wrangler solo de lectura: identidad, deployments staging y nombres de secretos.
- El script escribe `summary.json` y `summary.md` en `outputs/launch-staging-operations-preflight/<timestamp>/`.
- El alcance queda explicitamente limitado: no deploy, no rollback, no escritura de secretos, no tail, no email, no procesar jobs y no tocar Supabase.
- Sigue pendiente la evidencia manual externa de cron/logs, Resend staging y Admin Jobs en staging/UI/runtime antes de marcar `operations_external` como `pass`.

Evidencia:

- `corepack pnpm install --ignore-scripts`: OK, reconcilia el bloqueo de `verify-deps-before-run` sin ejecutar lifecycle scripts.
- `corepack pnpm launch:staging-operations`: OK, 0 fallos y 0 warnings.
- `corepack pnpm launch:staging-operations -- --include-wrangler`: OK, 0 fallos y 0 warnings.
- `corepack pnpm exec vitest run --coverage=false --reporter=dot tests/unit/operations-runbook.test.ts tests/unit/database-schema-invariants.test.ts`: OK, 2 archivos y 18 tests.
- `corepack pnpm typecheck`: OK.
- `corepack pnpm lint`: OK.
- `corepack pnpm launch:content`: OK.
- `corepack pnpm launch:operations`: OK.

## Avance Implementado 2026-06-26, Sexagesimo Noveno Corte

Sexagesimo noveno corte integrado: la parte local de recuperacion Admin Jobs/fulfillment queda verificada como apoyo de `operations_external`.

Archivos:

- `docs/launch/MANUAL_EVIDENCE.local.json`
- `docs/launch/RC_EVIDENCE_REFRESH.md`

Cambio:

- Se verifican tests locales de API admin de jobs, procesamiento de `fulfillment_jobs`, cliente interno Worker y fulfillment de sesiones.
- La evidencia queda registrada como apoyo local, no como cierre: sigue pendiente probar cron/logs, Resend staging y Admin Jobs en staging/UI/runtime.

Evidencia:

- `corepack pnpm exec vitest run --coverage=false --reporter=dot tests/api/admin-fulfillment-jobs.test.ts tests/unit/fulfillment-jobs.test.ts tests/unit/internal-job-service.test.ts tests/unit/session-fulfillment.test.ts`: OK, 4 archivos y 18 tests.

## Avance Implementado 2026-06-26, Sexagesimo Octavo Corte

Sexagesimo octavo corte integrado: `operations_external` avanza con health/auth basica fresca del Worker staging, sin marcarlo como cerrado.

Archivos:

- `docs/launch/MANUAL_EVIDENCE.local.json`
- `docs/launch/RC_EVIDENCE_REFRESH.md`

Cambio:

- `GET /health` en `espanol-honesto-fulfillment-staging` devuelve 200 con `ok: true`, servicio `fulfillment-worker` y runtime `cloudflare-workers`.
- `GET /internal/jobs/process` sin autenticacion devuelve 401.
- La evidencia local sigue en `pending`: faltan cron/log visibility, Resend staging delivery/suppression y recuperacion Admin Jobs.
- No se leyeron secretos ni se hicieron deploys, rollbacks, tails persistentes ni escrituras externas.

Evidencia:

- `corepack pnpm launch:manual-evidence`: FAILED esperado, 8 pendientes manual/final-only y 0 warnings.
- `corepack pnpm launch:status`: BLOCKED esperado, 9 blockers, 0 warnings, 8 Go/No-Go abiertos.

## Avance Implementado 2026-06-26, Sexagesimo Septimo Corte

Sexagesimo septimo corte integrado: las migraciones que desbloquean `database_readiness` quedan mas robustas antes de tocar Supabase staging.

Archivos:

- `db/schema.sql`
- `supabase/migrations/20260624163423_add_crm_core.sql`
- `scripts/launch/operations-audit.ts`
- `tests/unit/database-schema-invariants.test.ts`
- `tests/unit/operations-runbook.test.ts`
- `docs/launch/RC_EVIDENCE_REFRESH.md`

Cambio:

- La migracion CRM declara grants explicitos para `authenticated` y `service_role` en `leads` y tablas CRM, bajo RLS admin-only, para no depender de la exposicion automatica de Supabase Data API.
- La migracion CRM revoca acceso anon/publico a `leads` y CRM, mantiene las policies admin, y puede reintentarse mejor porque elimina policies antes de recrearlas.
- El backfill de actividades CRM evita duplicados si una aplicacion parcial obliga a reejecutar la migracion.
- El SQL generado por `launch:operations` ahora comprueba privilegios de `authenticated` y `service_role`, ademas de tablas, columnas, indices, RLS y policies.

Evidencia:

- `corepack pnpm exec vitest run --coverage=false --reporter=dot tests/unit/database-schema-invariants.test.ts tests/unit/operations-runbook.test.ts`: OK, 2 archivos y 17 tests.
- `corepack pnpm launch:operations`: OK; genero `hosted-schema-check.sql` con privilegios `authenticated` y `service_role`.
- `corepack pnpm typecheck`: OK.
- `corepack pnpm lint`: OK.
- `corepack pnpm launch:content`: OK.
- `corepack pnpm launch:manual-evidence`: FAILED esperado, 8 pendientes manual/final-only.
- `corepack pnpm launch:phase1`: BLOCKED esperado, 2 checks abiertos (`database_readiness`, `operations_external`).
- `corepack pnpm launch:rc`: RC_BLOCKED_BY_PHASE_1 esperado.
- `corepack pnpm launch:status`: BLOCKED esperado, 9 blockers, 0 warnings, 8 Go/No-Go abiertos.

## Avance Implementado 2026-06-26, Sexagesimo Sexto Corte

Sexagesimo sexto corte integrado: `operations_external` ya tiene preflight read-only fresca de Cloudflare staging, pero sigue pendiente de runtime/logs/Resend/Admin Jobs.

Archivos:

- `docs/launch/MANUAL_EVIDENCE.local.json`
- `docs/launch/RC_EVIDENCE_REFRESH.md`
- `scripts/launch/operations-audit.ts`
- `scripts/launch/manual-evidence-audit.ts`
- `tests/unit/operations-runbook.test.ts`

Cambio:

- Wrangler read-only confirma acceso a la cuenta Cloudflare y lista deployments/versiones de `espanol-honesto-fulfillment-staging`.
- El deployment actual de staging apunta 100% a la version `025d4f6b-a46e-4ec6-8311-ca1cd2d6d726`, creada el `2026-06-10T20:29:40.963366Z`.
- `wrangler secret list --env staging` confirma nombres esperados sin leer valores: cron, internal job secret, Supabase, Google y Resend.
- La evidencia local marca esto como preflight parcial, no como `pass`: faltan `/health` o runtime check actual, cron/log visibility actual, Resend staging actual y recuperacion Admin Jobs.
- No se hizo deploy, rollback, secret write/delete ni tail persistente.

Evidencia:

- `corepack pnpm launch:operations`: OK.
- `corepack pnpm exec vitest run --coverage=false --reporter=dot tests/unit/operations-runbook.test.ts`: OK, 1 archivo y 7 tests.
- `corepack pnpm typecheck`: OK.
- `corepack pnpm lint`: OK.
- `corepack pnpm launch:manual-evidence`: FAILED esperado, 8 fallos manual/final-only; ya sin fallo de formato ni secreto.
- `corepack pnpm launch:phase1`: BLOCKED esperado, 2 checks abiertos (`database_readiness`, `operations_external`).
- `corepack pnpm launch:content`: OK, 0 fallos y 0 warnings.
- `corepack pnpm launch:status`: BLOCKED esperado, 9 blockers, 0 warnings, 8 Go/No-Go abiertos.

## Avance Implementado 2026-06-26, Sexagesimo Quinto Corte

Sexagesimo quinto corte integrado: la revision read-only de Supabase confirma que el drift de schema afecta a staging y production, no solo a production.

Archivos:

- `docs/launch/MANUAL_EVIDENCE.local.json`
- `docs/launch/RC_EVIDENCE_REFRESH.md`
- `scripts/launch/operations-audit.ts`
- `scripts/launch/manual-evidence-audit.ts`
- `scripts/launch/status.ts`
- `tests/unit/operations-runbook.test.ts`

Cambio:

- Supabase MCP read-only lista dos proyectos separados y sanos: `espanol-staging` (`mzjyvmlxfpzdfdjzxxyj`) y `espanol-honesto` (`vkkahxsybhbutszerawz`), ambos en Postgres `17.6.1.063`.
- Migration history alojado no contiene todavia las migraciones actuales de lead enrichment, CRM core, CRM task related entity, lead languages ni lightweight level-check.
- Metadata alojada confirma que staging y production tienen `public.leads` con columnas legacy y no tienen tablas CRM.
- Production logs muestran errores recientes repetidos por `leads.current_level` y `leads.level_check_status`.
- El cierre de `database_readiness` pasa a ser staging-first: aplicar/verificar migraciones en staging, ejecutar el SQL read-only de metadata, probar flujos sin cobro, y solo despues considerar production con confirmacion explicita y backup posture.
- `operations_external` queda explicitamente pendiente por frescura: la evidencia anterior existe pero es de 2026-06-11 y supera la ventana de 14 dias.
- No se ejecuta ningun write remoto, no se aplican migraciones y no se guardan secretos.

Evidencia:

- `corepack pnpm launch:operations`: OK; genera `hosted-schema-closure-plan.md` con staging-first.
- `corepack pnpm exec vitest run --coverage=false --reporter=dot tests/unit/operations-runbook.test.ts`: OK, 1 archivo y 7 tests.
- `corepack pnpm typecheck`: OK.
- `corepack pnpm lint`: OK.
- `corepack pnpm launch:manual-evidence`: FAILED esperado, 8 fallos manual/final-only.
- `corepack pnpm launch:phase1`: BLOCKED esperado, 2 checks abiertos (`database_readiness`, `operations_external`).
- `corepack pnpm launch:status`: BLOCKED esperado, 9 blockers, 0 warnings, 8 Go/No-Go abiertos.

## Avance Implementado 2026-06-26, Sexagesimo Cuarto Corte

Sexagesimo cuarto corte integrado: la verificacion de drift de Supabase alojado ya cubre tambien la postura de acceso propia de Supabase, no solo columnas.

Archivos:

- `scripts/launch/operations-audit.ts`
- `tests/unit/operations-runbook.test.ts`
- `docs/launch/RC_EVIDENCE_REFRESH.md`

Cambio:

- `launch:operations` genera ahora `hosted-schema-check.sql` con comprobaciones de `information_schema`, `pg_indexes`, `pg_class`, `pg_policies` y privilegios de tabla.
- La SQL sigue siendo read-only y no consulta filas de alumnos, leads, pagos ni CRM.
- El check detecta RLS ausente en tablas launch-critical, policies admin ausentes para `leads`/CRM y privilegios `service_role` necesarios para los flujos server-side de CRM, diagnostico y jobs.
- El runbook RC pide registrar evidencia agregada de tablas, columnas, indices, RLS, policies y privilegios, teniendo en cuenta que Supabase puede no exponer tablas nuevas al Data API automaticamente.
- No se toca Supabase remoto, no se aplican migraciones y no se guardan secretos.

Evidencia:

- `corepack pnpm launch:operations`: OK; genera `hosted-schema-check.sql` con RLS/policies/privilegios.
- `corepack pnpm exec vitest run --coverage=false --reporter=dot tests/unit/operations-runbook.test.ts`: OK, 1 archivo y 7 tests.
- `corepack pnpm typecheck`: OK.
- `corepack pnpm lint`: OK.
- `corepack pnpm launch:phase1`: BLOCKED esperado; support audits OK y quedan solo `database_readiness` y `operations_external` como manual/external.

## Defaults Recomendados

### Objetivo Real De Este Bloque

- Dejar cerrado todo lo que se pueda cerrar antes de la ventana final.
- No aceptar cobros reales todavia.
- No depender de la fuente rusa premium comprada todavia.
- No cerrar textos legales reales todavia.
- El resultado esperado es un sistema operativo: solicitud, CRM, emails, diagnostico, onboarding, soporte y evidencia tecnica funcionando sin final-only.

### Orden General

- Resolver primero lo que afecta al producto escrito y al flujo operativo: emails, CRM, diagnostico de nivel y ruso.
- Dejar para la ventana final todo lo que necesita datos reales, dinero real, secretos reales, dominio final o verificacion externa.
- No usar Stripe live como requisito para cerrar el producto funcional; Stripe real pertenece al Go/No-Go final.
- Separar "listo para operar en local/staging" de "listo para vender con dinero real".

### Flujo Comercial

- Usar solicitud de plaza como entrada principal, no checkout publico abierto.
- Promesa operativa: respuesta humana en menos de 24 horas; normalmente antes si Alin o el socio ven la notificacion.
- Owner: cola compartida Alin + socio.
- Las tareas automaticas entran sin owner individual y se pueden reclamar manualmente desde CRM para dejar constancia de quien toma el seguimiento.
- Mantener el circuito abierto y reversible: no forzar compra ni rechazar automaticamente.
- Flujo recomendado:
  1. Solicitud de plaza.
  2. Confirmacion automatica al lead.
  3. Notificacion interna y tarea CRM para revisar.
  4. Diagnostico ligero de nivel/encaje si falta informacion.
  5. Respuesta humana con propuesta o espera.
  6. Checkout/enlace de pago solo cuando haya encaje o decision explicita de venta directa.

### Criterios De Encaje

- Prioridad comercial: adultos/profesionales, rusofonos, cierto nivel academico/laboral implicito, experiencia previa con idiomas o capacidad de defenderse en situaciones basicas, motivacion cultural real por Espana y deseo de salir del plateau.
- La solicitud debe permitir indicar que el lead es rusofono y tambien otras lenguas relevantes. Ruso es la prioridad comercial, pero no debe ser el unico idioma recogido.
- Posponer o derivar cuando:
  - no se pueden defender en una situacion basica;
  - no tienen idiomas previos ni interes cultural por Espana;
  - no hay disponibilidad compatible;
  - no hay grupo compatible;
  - el objetivo requiere otro servicio;
  - presupuesto o expectativas chocan con el modelo.
- No presentar el rechazo como fallo del estudiante: usar "mejor momento", "mejor formato" o "lista de espera".

### Estados CRM Recomendados

- Nuevo.
- Contactado.
- Esperando respuesta.
- Diagnostico recomendado.
- Diagnostico enviado.
- Diagnostico recibido.
- En revision.
- Propuesta enviada.
- Propuesta manual enviada.
- Pendiente de pago.
- Ganado.
- Pospuesto.
- Perdido / no encaja.
- Sin respuesta.

Regla SLA:

- Si un lead sigue nuevo o sin owner despues de 24 horas, crear o escalar una tarea interna visible. No hace falta alarmismo; el objetivo es que no quede olvidado.
- Si un lead se pospone, debe quedar en `nurture`/`Pospuesta` con una tarea de seguimiento fechada y asignada a quien lo pospone.

### Emails

- Primera version: emails transaccionales impecables y trazables.
- Idioma recomendado: ingles por defecto para clientes internacionales.
- Voz: humana, directa y sobria; nada pegajoso, hiperpromocional ni con tono de IA.
- Todo email enviado por el sistema debe poder dejar rastro en CRM o en una tabla/evento de comunicacion.
- Emails internos: aviso por email y reflejo en CRM/dashboard cuando haya accion humana pendiente.
- Los follow-ups comerciales manuales deben verificar `crm_consents` antes de salir: no enviar con opt-out, consentimiento ausente o `manual_review_required`.
- Marketing/campanas quedan fuera hasta cerrar consentimiento, opt-out y entregabilidad.

Emails imprescindibles v1:

- Confirmacion de solicitud recibida.
- Aviso interno de nuevo lead.
- Seguimiento si falta informacion.
- Envio de diagnostico ligero cuando proceda.
- Propuesta / siguiente paso.
- Pago pendiente o instrucciones de pago, sin Stripe live hasta final-only.
- Bienvenida post-pago para cuando el modo real exista.
- Recordatorio de clase.
- Cancelacion o reprogramacion.
- Soporte recibido.

### Prueba De Nivel

- No construir un examen formal en la primera version.
- Crear diagnostico ligero de nivel aproximado solo cuando aporte decision: si el lead ya encaja claramente, se puede responder/proponer sin obligarle a hacer prueba.
- Usarlo especialmente para leads rusofonos, niveles dudosos, alumnos del plateau o casos donde falte contexto.
- Formato:
  - preguntas cerradas breves;
  - texto escrito corto;
  - audio opcional solo si el alumno quiere;
  - intereses, trasfondo y objetivos como senal principal.
- Salida recomendada:
  - nivel aproximado;
  - confianza de la evaluacion;
  - recomendacion de plan;
  - flags de encaje;
  - siguiente accion CRM.
- Evaluacion: Alin y el socio.
- No guardar textos/audios de leads rechazados. Para v1, guardar en CRM el resumen y la decision; muestras completas solo si el alumno entra y hay consentimiento/retencion definidos.
- Recomendacion/propuesta final: manual por ahora, con constancia en CRM.

### Ruso Y Tipografia

- Ruso es prioritario.
- Diagnostico tecnico: el archivo Boldonse que carga Google Fonts no cubre cirilico; Unbounded y Pretendard si cubren ruso.
- Decision de producto: no usar una fuente parecida para ruso como solucion final. Comprar la fuente oficial/premium con soporte Cyrillic y licencia web.
- Trabajo final: sustituir la carga webfont por la fuente comprada, verificar ES/EN/RU, Open Graph y mobile.

### Stripe Y Servicios Reales

- Stripe live, precios reales finales, webhook live, customer portal real y reconciliacion real quedan para el final.
- Antes del final basta con que el codigo, los tests, el modo staging/test y el runbook esten preparados.
- Lo mismo aplica a secretos finales, dominios finales, fuente premium rusa, Search Console, Turnstile production, Sentry production, backup/export Supabase y smoke production.
- Ninguno de esos pasos debe ejecutarse sin preflight read-only y confirmacion explicita de Alin.

## Decision: Tipografia Rusa Final-Only

La tipografia rusa no se cierra ahora con una fuente alternativa. Queda para el cierre final junto con Stripe live.

Done means:

- Comprar/obtener la misma fuente oficial con soporte Cyrillic real.
- Confirmar licencia web y formatos servibles en la web.
- Sustituir la carga actual de Google Fonts si la version gratuita sigue sin cirilico.
- Verificar paginas RU desktop/mobile y Open Graph.
- Confirmar que no aparece fallback tipografico distinto en textos rusos.

## Roadmap

| ID | Tarea | Owner | Integracion | Validacion |
| --- | --- | --- | --- | --- |
| FG-01 | Auditar mapa funcional end-to-end | agent | `docs/launch`, CRM/workflows existentes | tabla lead -> pago -> clase -> renovacion con gaps y responsables |
| FG-02 | Definir matriz completa de emails | hybrid | `src/lib/email`, `docs/launch` | matriz evento/destinatario/idioma/template/trigger/CRM/opt-out |
| FG-03 | Corregir encoding y copy base de emails | agent | `src/lib/email/templates.ts`, `src/lib/email/previews.ts`, tests | tests anti-mojibake y previews limpias |
| FG-04 | Disenar contrato de logging de emails en CRM | agent | `src/lib/crm`, posible schema/API | decision: `crm_activities` suficiente o tabla `email_events` |
| FG-05 | Implementar emails transaccionales v1 cerrados | agent | Resend/Worker/API existentes | tests de envio mock, preview admin, smoke staging |
| FG-06 | Disenar diagnostico ligero de nivel | hybrid | `docs/launch/LEVEL_CHECK.md`, CRM lead model | campos, consentimiento, retencion, rubric y decision de salida |
| FG-07 | Implementar diagnostico de nivel v1 | agent | formulario, API, CRM, admin review | tests API/UI y evidencia visual |
| FG-08 | Preparar cierre final de tipografia rusa premium | hybrid | `BaseLayout`, `tailwind.config.js`, OG font loading | fuente comprada/licenciada, screenshots RU desktop/mobile y prueba de glifos |
| FG-09 | Revisar onboarding post-pago | agent | campus dashboard, emails, fulfillment | checklist de primera clase y time-to-value |
| FG-10 | Cerrar higiene Git/deps antes de commit | agent | `pnpm-lock.yaml`, `.gitignore`, `.codex-ops` decision | comandos normales sin bypass y status Git agrupado |
| FG-11 | Ejecutar cierre final Go/No-Go | hybrid | `docs/launch/FINAL_CLOSURE.md` | legal, pagos, integraciones, backup, SEO/LLM y smoke final |

## Avance Implementado 2026-06-25

Primer corte integrado: solicitud de plaza -> CRM operativo.

Archivos:

- `src/pages/api/subscribe.ts`
- `src/lib/crm/lead-capture.ts`
- `src/lib/email/send.ts`
- `tests/api/subscribe.test.ts`
- `tests/unit/crm-lead-capture.test.ts`
- `supabase/migrations/20260625213116_capture_lead_languages.sql`
- `src/components/LeadCaptureForm.tsx`
- `src/components/admin/LeadManager.tsx`
- `docs/launch/EMAIL_MATRIX.md`

Queda hecho:

- Despues de guardar una solicitud, `/api/subscribe` recarga el lead y lo sincroniza con CRM.
- La solicitud crea o actualiza `crm_contacts` sin degradar contactos existentes de ciclo de vida avanzado.
- La solicitud crea o actualiza `crm_opportunities` enlazada al lead.
- La solicitud registra consentimiento de seguimiento comercial por email cuando el formulario trae consentimiento.
- La solicitud crea actividad CRM `Solicitud de plaza recibida`.
- La solicitud crea una tarea compartida de revision con SLA 24h: `Revisar solicitud de plaza en menos de 24h`.
- El email automatico `lead_welcome` se registra como `email_out` en CRM solo si el envio devuelve exito.
- Si el CRM aun no esta migrado o falla una parte no critica, la captura del lead no se pierde.
- El formulario recoge lenguas del lead, calcula `is_russian_speaker` y permite indicar otras lenguas.
- La lista admin muestra la marca rusofona y las lenguas declaradas.
- Las plantillas transaccionales base usan ingles por defecto: solicitud, bienvenida post-pago, confirmacion, recordatorio y cancelacion de clase.
- La matriz de emails v1 separa implementado, trazabilidad pendiente y marketing diferido.

Evidencia:

- `corepack pnpm --config.verify-deps-before-run=false exec vitest run --coverage=false tests/unit/email-templates.test.ts tests/api/email-send-test.test.ts tests/unit/fulfillment-jobs.test.ts tests/api/sessions-create.test.ts tests/api/subscribe.test.ts tests/unit/crm-lead-capture.test.ts tests/unit/i18n-encoding.test.ts tests/unit/lead-manager-source.test.ts`
- `corepack pnpm --config.verify-deps-before-run=false typecheck`
- `corepack pnpm --config.verify-deps-before-run=false lint`

Estado:

- FG-01: en progreso; ya hay evidencia concreta de lead -> CRM.
- FG-04: primera decision implementada; `crm_activities` sirve para trazabilidad de emails transaccionales v1.
- FG-05: parcialmente iniciado; templates base en ingles y matriz v1 creada; falta completar diagnostico/propuesta/soporte y trazabilidad de todos los triggers.
- FG-06: contrato de diagnostico ligero definido en `docs/launch/LEVEL_CHECK.md`.

Gaps que siguen abiertos tras este corte:

- Faltan templates/trigger para falta de informacion, propuesta manual, instrucciones de pago y soporte recibido.
- Falta cerrar instrucciones de pago manuales solo si se decide operar antes de Stripe live.
- En ese momento quedaba pendiente ejecutar higiene Git/deps para normalizar `pnpm` sin `--config.verify-deps-before-run=false`; queda cerrado en el noveno corte.

## Avance Implementado 2026-06-25, Segundo Corte

Segundo corte integrado: diagnostico ligero de nivel -> lead -> CRM.

Archivos:

- `src/pages/[lang]/diagnostico.astro`
- `src/components/LevelCheckForm.tsx`
- `src/pages/api/level-check.ts`
- `src/lib/crm/level-check.ts`
- `src/components/admin/LeadManager.tsx`
- `src/lib/email/templates.ts`
- `src/lib/email/send.ts`
- `src/lib/email/previews.ts`
- `supabase/migrations/20260625215008_add_lightweight_level_check_to_leads.sql`
- `db/schema.sql`
- `src/types/database.types.ts`
- `docs/launch/LEVEL_CHECK.md`
- `docs/launch/EMAIL_MATRIX.md`

Queda hecho:

- Existe una pagina no indexable `/{lang}/diagnostico`.
- El formulario recoge email, nivel aproximado, comprension, bloqueo principal, contexto de uso, texto escrito y opcion de audio posterior.
- No hay subida de archivos ni audio en v1.
- `/api/level-check` valida Turnstile y consentimiento antes de escribir.
- Si el lead existe, actualiza su diagnostico; si no existe, crea un lead minimo.
- El diagnostico guarda contexto crudo temporal en `leads.level_check_context` y resumen operativo en `leads.level_check_summary`.
- El CRM registra actividad `Lightweight level check received`.
- El CRM crea tarea `Review lightweight level check` con SLA 24h.
- El admin de leads muestra estado, resumen, flags y limpieza de contexto.
- El admin puede marcar el diagnostico como revisado, cerrar la tarea CRM y limpiar `level_check_context` sin descartar el lead.
- Al descartar un lead desde estado o oportunidad perdida, se vacia `level_check_context` y se marca `level_check_raw_cleared_at`.
- Existe template transaccional `levelCheckInviteTemplate` y envio `sendLevelCheckInviteEmail`.
- El admin de solicitudes puede enviar/re-enviar el diagnostico con la accion `send_level_check`.
- El envio admin de diagnostico queda registrado como `crm_activities.email_out` con template `level_check_invite`.

Estado:

- FG-06: implementado como diagnostico ligero v1, no como prueba formal.
- FG-07: implementado a nivel formulario/API/CRM/admin; falta smoke visual amplio y uso operativo en staging.

## Avance Implementado 2026-06-26, Tercer Corte

Tercer corte integrado: bienvenida post-pago -> fulfillment -> CRM onboarding.

Archivos:

- `src/lib/crm/onboarding.ts`
- `src/lib/fulfillment/queue.ts`
- `src/lib/fulfillment/jobs.ts`
- `src/pages/api/stripe-webhook.ts`
- `tests/unit/crm-onboarding.test.ts`
- `tests/unit/fulfillment-jobs.test.ts`
- `tests/api/stripe-webhook.test.ts`
- `docs/launch/EMAIL_MATRIX.md`
- `docs/launch/FUNCTIONAL_GAP_ROADMAP.md`

Queda hecho:

- `checkout.session.completed` crea suscripcion/pago y encola `welcome_fulfillment` con `subscriptionId` local.
- `welcome_fulfillment` prepara carpeta Drive si falta, envia bienvenida y solo despues registra onboarding en CRM.
- El CRM crea o reutiliza contacto, lo promueve a `customer`, registra actividad `Post-payment onboarding started` y actualiza `next_follow_up_at`.
- Se crea una tarea admin de alta prioridad con SLA 24h para coordinar primera clase y materiales.
- La tarea y la actividad son idempotentes por suscripcion/perfil para evitar duplicados en reintentos.
- No se activa Stripe live ni ningun servicio production; el cierre real queda final-only.

Estado:

- FG-09: implementado v1 a nivel fulfillment/CRM/email con mocks.
- En ese momento seguia pendiente la senal de primera clase completada; queda cerrada en el septimo corte.

## Avance Implementado 2026-06-26, Cuarto Corte

Cuarto corte integrado: emails de clase -> timeline CRM.

Archivos:

- `src/lib/crm/class-email.ts`
- `src/lib/fulfillment/session-fulfillment.ts`
- `src/lib/fulfillment/jobs.ts`
- `workers/fulfillment/src/index.ts`
- `tests/unit/crm-class-email.test.ts`
- `tests/unit/session-fulfillment.test.ts`
- `docs/launch/EMAIL_MATRIX.md`
- `docs/launch/FUNCTIONAL_GAP_ROADMAP.md`

Queda hecho:

- Confirmacion de clase registra `crm_activities.email_out` en el contacto del alumno despues de que Resend acepte email de alumno y profesor.
- Recordatorio de clase registra `crm_activities.email_out` despues de marcar `sessions.reminder_sent`.
- Cancelacion de clase mantiene la actividad `class` del flujo de sesion y anade `email_out` de cancelacion cuando se envian los emails.
- La deduplicacion usa `related_entity_type` distinto por template: confirmacion, recordatorio y cancelacion no se pisan entre si.
- El timeline se guarda en el alumno, no en el profesor, para no convertir profesores internos en leads CRM.

Estado:

- FG-05: emails transaccionales de clase implementados v1 con trazabilidad CRM.
- En ese momento seguian pendientes los follow-ups comerciales; quedan cerrados en el quinto corte.
- En ese momento seguia pendiente la senal explicita de primera clase completada; queda cerrada en el septimo corte.

## Avance Implementado 2026-06-26, Quinto Corte

Quinto corte integrado: follow-up comercial manual -> emails -> CRM.

Archivos:

- `src/lib/email/templates.ts`
- `src/lib/email/send.ts`
- `src/lib/email/index.ts`
- `src/lib/email/previews.ts`
- `src/components/admin/EmailTemplateManager.tsx`
- `src/pages/api/admin/leads.ts`
- `src/components/admin/LeadManager.tsx`
- `tests/unit/email-templates.test.ts`
- `tests/api/email-send-test.test.ts`
- `tests/api/admin-leads.test.ts`
- `docs/launch/EMAIL_MATRIX.md`
- `docs/launch/FUNCTIONAL_GAP_ROADMAP.md`

Queda hecho:

- Existe email `missing_info` para pedir contexto adicional sin forzar compra.
- Existe email `proposal_next_step` para proponer el siguiente paso antes de pago.
- Ambos se disparan manualmente desde solicitudes admin con accion `send_sales_email`.
- El envio marca el lead como `contacted`, registra `crm_activities.email_out`, actualiza seguimiento a 24h y sincroniza oportunidad CRM.
- `proposal_next_step` mueve la oportunidad a `proposal`; `missing_info` la mantiene en `contacted`.
- El gestor admin de previews incluye diagnostico, falta de informacion y propuesta.
- La matriz corrige soporte recibido: ya hay ticket, actividad CRM y alerta interna.

Estado:

- FG-02: matriz de emails mucho mas cerrada; queda pendiente decision de pago manual/final-only.
- FG-05: emails transaccionales v1 cubren solicitud, diagnostico, follow-up comercial, bienvenida post-pago, clase, recordatorio, cancelacion y soporte interno.
- En ese momento seguia pendiente el acuse automatico al usuario al crear ticket de soporte; queda cerrado en el octavo corte.

## Avance Implementado 2026-06-26, Sexto Corte

Sexto corte integrado: higiene tecnica minima antes de cierre.

Archivos:

- `package.json`
- `supabase/.temp/cli-latest`
- `.agents/skills/playwright-skill/.temp-execution-1781276714818.js`
- `docs/launch/CLEANUP.md`

Queda hecho:

- `pnpm fulfillment:typecheck` ya funciona desde el script normal porque usa `corepack pnpm --filter ...`.
- `supabase/.temp/cli-latest` queda eliminado del arbol versionado; la carpeta `supabase/.temp/` ya esta en `.gitignore`.
- Se elimina el archivo temporal `.temp-execution-1781276714818.js` generado dentro de la skill de Playwright.
- No se borran `.agent/` ni `.agents/` de forma amplia: siguen pendientes de decision humana separada porque pueden contener herramientas utiles del proyecto.

Estado:

- FG-10: parcialmente cerrado. En ese momento quedaba decidir si `.agent/`, `.agents/` y `.codex-ops/` debian quedarse versionados, moverse fuera del repo o eliminarse en un commit separado; la normalizacion de `pnpm` queda cerrada en el noveno corte.

## Avance Implementado 2026-06-26, Septimo Corte

Septimo corte integrado: primera clase completada -> activacion CRM.

Archivos:

- `src/lib/crm/onboarding.ts`
- `src/pages/api/calendar/session-action.ts`
- `tests/unit/crm-onboarding.test.ts`
- `tests/api/session-action.test.ts`
- `docs/launch/FUNCTIONAL_GAP_ROADMAP.md`

Queda hecho:

- Al completar una clase desde calendario, el sistema mantiene la actividad CRM `Clase completada`.
- Ademas registra una actividad unica `First class completed` con `activation_goal: first_class_completed`.
- Cierra tareas abiertas/snoozed de onboarding post-pago relacionadas con la suscripcion o perfil.
- Limpia `next_follow_up_at` del contacto para que el SLA de primera clase no quede vencido tras activacion.
- La activacion queda asociada a `subscription_activation` cuando hay suscripcion, o a `profile_activation` como fallback.

Estado:

- FG-09: cerrado v1 a nivel CRM/fulfillment/calendario con mocks.
- Queda pendiente solo revision operativa en staging/manual, no una pieza funcional de codigo para primera clase.

## Avance Implementado 2026-06-26, Octavo Corte

Octavo corte integrado: ticket de soporte -> acuse usuario -> CRM.

Archivos:

- `src/lib/email/templates.ts`
- `src/lib/email/send.ts`
- `src/lib/email/index.ts`
- `src/lib/email/previews.ts`
- `src/components/admin/EmailTemplateManager.tsx`
- `src/pages/api/support/alert.ts`
- `tests/unit/email-templates.test.ts`
- `tests/api/email-send-test.test.ts`
- `tests/api/support-alert.test.ts`
- `docs/launch/EMAIL_MATRIX.md`
- `docs/launch/FUNCTIONAL_GAP_ROADMAP.md`

Queda hecho:

- Al crear un ticket de soporte, el usuario recibe acuse transaccional `support_ticket_received`.
- Si Resend acepta el acuse, se registra `crm_activities.email_out` relacionado con `support_ticket_acknowledgement`.
- La alerta interna a Alin/socio se mantiene y se expone separada como `internalAlertSent`.
- La respuesta conserva `emailSent` como compatibilidad para la alerta interna y anade `userEmailSent`.
- El gestor admin de previews incluye la plantilla de soporte recibido.

Estado:

- FG-05: emails transaccionales v1 quedan cubiertos para solicitud, diagnostico, follow-up comercial, bienvenida post-pago, clases y soporte.
- Sigue pendiente solo pago manual/final-only si se decide operar antes de Stripe live.

## Avance Implementado 2026-06-26, Noveno Corte

Noveno corte integrado: pnpm normalizado -> limpieza verificable.

Archivos:

- `pnpm-lock.yaml`
- `tests/unit/landing-public-content.test.ts`
- `docs/launch/CLEANUP.md`
- `docs/launch/FUNCTIONAL_GAP_ROADMAP.md`

Queda hecho:

- `pnpm-lock.yaml` se sincroniza con los `overrides` actuales.
- La instalacion local se sincroniza con `corepack pnpm install --ignore-scripts`, sin ejecutar lifecycle scripts.
- Los comandos normales vuelven a funcionar sin `--config.verify-deps-before-run=false`.
- El test de contenido publico se actualiza para el estado real de `docs/launch/LEVEL_CHECK.md`: diagnostico ligero v1 implementado y prueba formal definitiva fuera del RC.
- `launch:cleanup` confirma 0 fallos y 0 warnings y genera inventario no destructivo de herramientas de agente.

Evidencia:

- `corepack pnpm exec vitest run --coverage=false tests/unit/landing-public-content.test.ts`
- `corepack pnpm test:run`
- `corepack pnpm typecheck`
- `corepack pnpm lint`
- `corepack pnpm fulfillment:typecheck`
- `corepack pnpm build`
- `corepack pnpm launch:cleanup`
- `outputs/launch-cleanup/2026-06-26T08-12-04-377Z/summary.md`

Estado:

- FG-10: cerrado para dependencias y comandos `pnpm` normales.
- Sigue pendiente una decision humana separada sobre `.agent/`, `.agents/` y `.codex-ops/`: mantener en repo, mover fuera o borrar despues de backup.

## Avance Implementado 2026-06-26, Decimo Corte

Decimo corte integrado: checkout fail-closed -> operacion sin cobros reales.

Archivos:

- `src/pages/api/create-checkout.ts`
- `src/lib/runtime-env.ts`
- `.env.example`
- `tests/api/create-checkout.test.ts`
- `scripts/launch/payments-audit.ts`
- `docs/launch/PRODUCTS.md`
- `docs/launch/ENVIRONMENT.md`
- `docs/launch/FUNCTIONAL_GAP_ROADMAP.md`

Queda hecho:

- `/api/create-checkout` falla cerrado con `403` salvo que `CHECKOUT_ENABLED=true`.
- El bloqueo sucede antes de leer Supabase y antes de llamar a Stripe.
- Las landings publicas ya siguen en modo `application`; este corte anade proteccion backend aunque existan Price IDs validos.
- `.env.example` deja `CHECKOUT_ENABLED=false` por defecto.
- `launch:payments` comprueba que el guard de `CHECKOUT_ENABLED` y la documentacion existen.

Evidencia:

- `corepack pnpm exec vitest run --coverage=false tests/api/create-checkout.test.ts`
- `corepack pnpm typecheck`
- `corepack pnpm launch:payments`
- `outputs/launch-payments/2026-06-26T08-16-59-033Z/summary.md`

Estado:

- Objetivo "sin posibilidad de aceptar cobros reales": reforzado a nivel backend y documentacion.
- Stripe live, smoke de pago real/test staging deliberado y `CHECKOUT_ENABLED=true` siguen final-only o decision explicita de Alin.

## Avance Implementado 2026-06-26, Undecimo Corte

Undecimo corte integrado: arbol Git clasificable -> higiene de commit.

Archivos:

- `.gitignore`
- `docs/launch/GIT_WORKTREE_PLAN.md`
- `docs/launch/CLEANUP.md`
- `docs/launch/FUNCTIONAL_GAP_ROADMAP.md`

Queda hecho:

- `.codex-ops/` queda ignorado para que el estado local de agente no ensucie el arbol Git.
- Se crea una guia de paquetes de revision/commit para separar base launch, superficie publica, CRM/diagnostico, emails/soporte/onboarding, pagos bloqueados, calendario/campus, dependencias/CI y herramientas de agente.
- Se mantiene la decision de `.agent/` y `.agents/` como humana/separada: no se borran ni se mezclan con runtime.
- Se documenta que lo estable del proyecto vive en `docs/launch/*`, no en el estado local de Codex Ops.

Evidencia:

- `git check-ignore -v .codex-ops/ops.sqlite`
- `corepack pnpm launch:cleanup`
- `corepack pnpm exec vitest run --coverage=false tests/unit/landing-public-content.test.ts tests/unit/operations-runbook.test.ts`
- `outputs/launch-cleanup/2026-06-26T08-20-45-664Z/summary.md`

Estado:

- FG-10: cerrado para dependencias, comandos `pnpm`, artefactos temporales y clasificacion del arbol Git.
- Sigue pendiente solo la decision humana de herramientas de agente antes de un commit final si Alin quiere limpiar `.agent/`/`.agents/`.

## Avance Implementado 2026-06-26, Duodecimo Corte

Duodecimo corte integrado: gates de RC/Fase 1 usan pnpm correcto -> evidencia honesta.

Archivos:

- `scripts/launch/phase-one.ts`
- `scripts/launch/release-candidate.ts`
- `docs/launch/FUNCTIONAL_GAP_ROADMAP.md`

Queda hecho:

- `launch:phase1` y `launch:rc` dejan de invocar `pnpm.cmd` global.
- Ambos scripts ejecutan subcomandos con `corepack pnpm`, respetando `packageManager: pnpm@10.33.0`.
- El fallo anterior `ERR_PNPM_UNSUPPORTED_ENGINE` desaparece.
- `launch:phase1` ahora muestra el bloqueo real: no hay fallos en cleanup/content/accessibility/operations/security; quedan abiertas por frescura manual `database_readiness` y `operations_external`.
- `launch:rc` ya puede distinguir entre fallo de tooling, pagos OK y bloqueo de Fase 1 por evidencia manual caducada.

Evidencia:

- `corepack pnpm launch:phase1`
- `outputs/launch-phase-1/2026-06-26T08-23-19-632Z/summary.md`
- `corepack pnpm launch:rc`
- `outputs/launch-rc/2026-06-26T08-22-33-030Z/summary.md`
- `corepack pnpm launch:status`
- `outputs/launch-status/2026-06-26T08-25-50-754Z/summary.md`

Estado:

- Tooling de launch corregido.
- Fase 1 ya no esta bloqueada por codigo ni por support audits; queda pendiente refrescar evidencia manual real/no secreta de `database_readiness` y `operations_external`.
- No se ha marcado evidencia manual como pass sin verificarla.
- El RC queda correctamente bloqueado por Fase 1 hasta refrescar esas dos evidencias; los demas bloqueos siguen en cierre final.

## Avance Implementado 2026-06-26, Decimotercer Corte

Decimotercer corte integrado: refresco RC documentado -> dos evidencias accionables.

Archivos:

- `docs/launch/RC_EVIDENCE_REFRESH.md`
- `docs/launch/MANUAL_EVIDENCE_RUNBOOK.md`
- `docs/launch/GIT_WORKTREE_PLAN.md`
- `docs/launch/FUNCTIONAL_GAP_ROADMAP.md`

Queda hecho:

- Se crea una guia estable para refrescar solo los dos bloqueos de Fase 1: `database_readiness` y `operations_external`.
- La guia separa evidencia local de apoyo (`launch:operations`, worksheets, runbooks) de la revision externa/humana que no se debe inventar.
- Incluye comandos dry-run de `launch:manual-evidence:record` para registrar evidencia no secreta cuando Alin revise dashboards/estado real.
- Enlaza la guia desde el runbook de evidencia manual y el plan de arbol Git.

Estado:

- Fase 1 sigue bloqueada hasta revisar y registrar evidencia real/no secreta.
- No se ha escrito `MANUAL_EVIDENCE.local.json` ni se ha marcado ningun check como `pass` sin revisar.

## Avance Implementado 2026-06-26, Decimocuarto Corte

Decimocuarto corte integrado: runners de launch/demo usan `corepack pnpm` de forma consistente.

Archivos:

- `scripts/launch/gate.ts`
- `scripts/launch/verify.ts`
- `scripts/launch/accessibility-smoke.ts`
- `scripts/launch/public-visual-smoke.ts`
- `scripts/demo/dev.ts`
- `docs/launch/CLEANUP.md`
- `docs/launch/GIT_WORKTREE_PLAN.md`
- `docs/launch/FUNCTIONAL_GAP_ROADMAP.md`

Queda hecho:

- `launch:gate` ejecuta sus pasos con `corepack pnpm`.
- `launch:verify` ejecuta sus checks de `pnpm` con `corepack pnpm`.
- Los smokes `launch:public-visual` y `launch:accessibility` arrancan Astro con `corepack pnpm exec astro dev`.
- `dev:demo` arranca Astro con `corepack pnpm exec astro dev`.
- El arbol ya no contiene invocaciones funcionales a `pnpm.cmd` ni helper `pnpmCommand()` en `scripts`.

Estado:

- Se reduce el riesgo de falsos bloqueos por pnpm global incompatible.
- No cambia ningun bloqueo de producto: `database_readiness` y `operations_external` siguen requiriendo evidencia manual real, y final-only sigue fuera de esta fase.

Evidencia:

- `rg -n "pnpm\\.cmd|function pnpmCommand|pnpmCommand\\(" scripts`: sin resultados.
- `corepack pnpm typecheck`: OK.
- `corepack pnpm lint`: OK.
- `corepack pnpm launch:sequence`: OK, `outputs/launch-sequence/2026-06-26T08-42-32-082Z/summary.md`.
- `corepack pnpm launch:public-visual`: OK, `outputs/launch-public-visual/2026-06-26T08-34-01-356Z/summary.md`.
- `corepack pnpm launch:gate`: BLOCKED esperado, `outputs/launch-gate/2026-06-26T08-37-10-842Z/summary.md`.
- `corepack pnpm launch:verify`: ejecutado dentro de gate, `outputs/launch-verification/2026-06-26T08-37-11-289Z/summary.md`; pasan typecheck, lint, tests, build, SEO, visual, accesibilidad, seguridad, operaciones, pagos bloqueados y secrets; falla solo `launch:legal` por datos legales reales pendientes.
- `corepack pnpm launch:rc`: RC_BLOCKED_BY_PHASE_1 esperado, `outputs/launch-rc/2026-06-26T08-44-52-922Z/summary.md`.
- `corepack pnpm launch:status`: BLOCKED esperado, `outputs/launch-status/2026-06-26T08-49-29-873Z/summary.md`.

## Avance Implementado 2026-06-26, Decimoquinto Corte

Decimoquinto corte integrado: dashboard de launch mas honesto y accionable.

Archivos:

- `scripts/launch/status.ts`
- `docs/launch/FUNCTIONAL_GAP_ROADMAP.md`

Queda hecho:

- `Release Candidate Readiness` ya no pide cerrar `security_external` cuando ese check aparece como claro.
- `Next Decision` se genera desde los checks realmente abiertos de Fase 1.
- Las filas abiertas copiadas de `docs/launch/CHECKLIST.md` se muestran como objetivos pendientes, no como afirmaciones de que el comando ya paso.
- `launch:status` sigue bloqueando correctamente: Fase 1 mantiene `database_readiness` y `operations_external`; final-only mantiene legal, pagos, integraciones, SEO/LLM y smoke final.

Evidencia:

- `corepack pnpm typecheck`: OK.
- `corepack pnpm lint`: OK.
- `corepack pnpm launch:rc`: RC_BLOCKED_BY_PHASE_1 esperado, `outputs/launch-rc/2026-06-26T08-44-52-922Z/summary.md`.
- `corepack pnpm launch:status`: BLOCKED esperado, `outputs/launch-status/2026-06-26T08-49-29-873Z/summary.md`.

## Avance Implementado 2026-06-26, Decimosexto Corte

Decimosexto corte integrado: Fase 1 Focus y guia RC ya separan accion real de checks claros.

Archivos:

- `scripts/launch/status.ts`
- `docs/launch/RC_EVIDENCE_REFRESH.md`
- `docs/launch/FUNCTIONAL_GAP_ROADMAP.md`
- `docs/launch/GIT_WORKTREE_PLAN.md`

Queda hecho:

- La tabla `Phase 1 Focus` de `launch:status` muestra "sin accion ahora para RC" en checks claros.
- `database_readiness` y `operations_external` siguen siendo los unicos checks de Fase 1 que piden accion.
- `security_external` queda visible como claro, con rotacion final/live-domain/deep permissions mantenidos en final-only.
- `RC_EVIDENCE_REFRESH.md` apunta a evidencias frescas de operations/manual-evidence/status y conserva dry-runs sin `--write`.

Evidencia:

- `corepack pnpm typecheck`: OK.
- `corepack pnpm lint`: OK.
- `corepack pnpm launch:manual-evidence`: FAILED esperado, `outputs/launch-manual-evidence/2026-06-26T08-49-21-988Z/summary.md`.
- `corepack pnpm launch:status`: BLOCKED esperado, `outputs/launch-status/2026-06-26T08-49-29-873Z/summary.md`.

## Avance Implementado 2026-06-26, Decimoseptimo Corte

Decimoseptimo corte integrado: copia publica de planes neutralizada para operar sin cobros reales.

Archivos:

- `src/components/PricingSection.tsx`
- `src/components/PricingModal.tsx`
- `src/i18n/translations.ts`
- `src/pages/es/espanol-para-vivir-en-espana.astro`
- `src/pages/es/espanol-para-profesionales.astro`
- `src/pages/es/clases-de-conversacion-en-espanol.astro`
- `tests/unit/landing-public-content.test.ts`
- `docs/launch/CONVERSION_ARCHITECTURE.md`
- `docs/launch/RC_EVIDENCE_REFRESH.md`
- `docs/launch/FUNCTIONAL_GAP_ROADMAP.md`

Queda hecho:

- La UI publica mantiene `checkoutMode="application"` y no empuja compra directa.
- Las traducciones del modal dejan de decir "Continuar al pago", "Continue to payment" o equivalente ruso mientras el flujo sea solicitud.
- Los errores publicos dejan de hablar de "checkout" y usan copia neutra de continuidad.
- La pagina de profesionales reemplaza "despues pago" por "despues propuesta".
- El test de contenido publico prohibe que reaparezcan esas cadenas en home, pricing y paginas SEO de segmento.
- La proteccion backend de `CHECKOUT_ENABLED=false` sigue siendo la barrera real contra cobros aunque hubiera Price IDs validos.

Evidencia:

- `corepack pnpm exec vitest run --coverage=false tests/unit/landing-public-content.test.ts tests/api/create-checkout.test.ts`: OK, 2 archivos y 21 tests.
- `corepack pnpm typecheck`: OK.
- `corepack pnpm lint`: OK.
- `corepack pnpm launch:content`: OK, `outputs/launch-content/2026-06-26T08-55-23-656Z/summary.md`.
- `corepack pnpm launch:status`: BLOCKED esperado por final-only/Fase 1 manual, `outputs/launch-status/2026-06-26T08-55-29-492Z/summary.md`.

Estado:

- Objetivo "operativo sin cobros reales": reforzado en superficie publica, tests y backend.
- El siguiente desbloqueo de RC no es codigo de pago: sigue siendo evidencia manual real/no secreta de `database_readiness` y `operations_external`.

## Avance Implementado 2026-06-26, Decimoctavo Corte

Decimoctavo corte integrado: ownership manual de tareas CRM compartidas.

Archivos:

- `src/pages/api/admin/crm/contact-actions.ts`
- `src/components/admin/CrmTaskList.tsx`
- `src/lib/crm/admin-dashboard.ts`
- `src/lib/crm/contact-detail.ts`
- `tests/api/admin-crm-contact-actions.test.ts`
- `tests/unit/crm-task-list.test.tsx`
- `docs/launch/FUNCTIONAL_GAP_ROADMAP.md`

Queda hecho:

- Las tareas automaticas de lead, diagnostico u onboarding pueden seguir entrando como cola compartida.
- Un admin puede reclamar una tarea con `claim_task`; la tarea queda con `assigned_to` igual al admin actual.
- La accion escribe actividad CRM `Tarea asignada` y auditoria `crm_task.claim`.
- El listado de tareas muestra si la tarea esta en `Cola compartida` o `Asignada`.
- La UI solo muestra `Asignarme` en tareas activas sin owner.
- Las consultas de dashboard y ficha CRM traen `assigned_to` para que la UI pueda decidir sin inferencias.

Evidencia:

- `corepack pnpm exec vitest run --coverage=false tests/api/admin-crm-contact-actions.test.ts`: OK, 15 tests.
- `corepack pnpm exec vitest run --coverage=false tests/unit/crm-task-list.test.tsx`: OK, 4 tests.
- `corepack pnpm typecheck`: OK.
- `corepack pnpm lint`: OK.

Estado:

- Flujo comercial: mejor cerrado para trabajo real entre Alin y socio. La asignacion sigue siendo manual y reversible.
- No automatiza aceptacion, rechazo, diagnostico ni propuesta.

## Avance Implementado 2026-06-26, Decimonoveno Corte

Decimonoveno corte integrado: leads pospuestos con seguimiento real.

Archivos:

- `src/pages/api/admin/leads.ts`
- `src/pages/api/admin/crm/contact-actions.ts`
- `src/pages/[lang]/campus/admin/index.astro`
- `src/components/admin/LeadManager.tsx`
- `src/components/admin/CrmOpportunityList.tsx`
- `tests/api/admin-leads.test.ts`
- `tests/api/admin-crm-contact-actions.test.ts`
- `tests/unit/crm-opportunity-list.test.tsx`
- `docs/launch/FUNCTIONAL_GAP_ROADMAP.md`

Queda hecho:

- La etapa CRM interna `nurture` se muestra como `Pospuesta`.
- Al mover una oportunidad a `nurture`, el contacto recibe `next_follow_up_at` a 7 dias.
- Se crea o reutiliza una tarea `Revisar lead pospuesto` asociada a la oportunidad.
- La tarea queda asignada al admin que decide posponer, con metadata `nurture_follow_up`.
- La actividad de cambio de etapa incluye `next_follow_up_at`.
- La regla funciona tanto desde la lista de solicitudes como desde la ficha CRM.

Evidencia:

- `corepack pnpm exec vitest run --coverage=false tests/api/admin-leads.test.ts`: OK, 11 tests.
- `corepack pnpm exec vitest run --coverage=false tests/api/admin-crm-contact-actions.test.ts`: OK, 16 tests.
- `corepack pnpm typecheck`: OK.

Estado:

- Flujo comercial: posponer ya no significa dejar el lead en una etiqueta ambigua; queda una accion futura visible.
- Sigue siendo manual y reversible.

## Avance Implementado 2026-06-26, Vigesimo Corte

Vigesimo corte integrado: cierre de diagnostico ligero sin conservar contexto crudo.

Archivos:

- `src/pages/api/admin/leads.ts`
- `src/components/admin/LeadManager.tsx`
- `tests/api/admin-leads.test.ts`
- `tests/unit/lead-manager-source.test.ts`
- `docs/launch/LEVEL_CHECK.md`
- `docs/launch/FUNCTIONAL_GAP_ROADMAP.md`

Queda hecho:

- Nueva accion admin `review_level_check` para diagnosticos recibidos.
- Al revisar, `level_check_status` pasa a `reviewed`.
- `level_check_context` se vacia y se marcan `level_check_raw_cleared_at` y `level_check_reviewed_at`.
- Se cierra la tarea CRM `level_check` abierta o aplazada.
- Se registra actividad CRM `Lightweight level check reviewed` con metadata de limpieza.
- La lista de solicitudes muestra `Revisar y limpiar` cuando el diagnostico esta recibido.
- El resumen operativo, nivel estimado, flags y recomendacion se conservan; la muestra cruda no.

Evidencia:

- `corepack pnpm exec vitest run --coverage=false tests/api/admin-leads.test.ts tests/unit/lead-manager-source.test.ts`: OK, 18 tests.
- `corepack pnpm typecheck`: OK.

Estado:

- Diagnostico de nivel v1 queda mas alineado con privacidad y operacion real: hay revision humana sin convertir el texto escrito en almacenamiento indefinido.

## Avance Implementado 2026-06-26, Vigesimo Primer Corte

Vigesimo primer corte integrado: follow-up comercial respeta consentimiento y opt-out.

Archivos:

- `src/lib/crm/lead-capture.ts`
- `src/pages/api/admin/leads.ts`
- `tests/unit/crm-lead-capture.test.ts`
- `tests/api/admin-leads.test.ts`
- `docs/launch/EMAIL_MATRIX.md`
- `docs/launch/FUNCTIONAL_GAP_ROADMAP.md`

Queda hecho:

- La sincronizacion de lead a CRM ya no recrea consentimiento activo de `sales_follow_up` si el ultimo consentimiento esta opt-out.
- `send_sales_email` sincroniza/usa CRM antes de enviar `missing_info` o `proposal_next_step`.
- El envio comercial manual verifica `crm_consents` para `email` + `sales_follow_up`.
- Se bloquea el envio si el contacto tiene opt-out.
- Se bloquea el envio si no hay base permitida o queda `manual_review_required`.
- Si CRM/consentimiento no esta migrado o no se puede verificar, el follow-up falla cerrado en vez de enviar.

Evidencia:

- `corepack pnpm exec vitest run --coverage=false tests/api/admin-leads.test.ts`: OK, 13 tests.
- `corepack pnpm exec vitest run --coverage=false tests/unit/crm-lead-capture.test.ts`: OK, 4 tests.
- `corepack pnpm typecheck`: OK.

Estado:

- Emails comerciales manuales quedan separados de marketing masivo, pero ya respetan opt-out y revision de consentimiento.

## Avance Implementado 2026-06-26, Vigesimo Segundo Corte

Vigesimo segundo corte integrado: onboarding post-pago visible en campus del alumno.

Archivos:

- `src/pages/[lang]/campus/index.astro`
- `tests/unit/student-onboarding-source.test.ts`
- `docs/launch/FUNCTIONAL_GAP_ROADMAP.md`

Queda hecho:

- La checklist de campus del alumno ya cubre profesor asignado, carpeta Drive/materiales, primera clase, Meet/documento y soporte.
- El campus lee la asignacion `student_teachers` para mostrar si ya hay profesor; si no esta disponible, la pantalla sigue cargando y deja la asignacion como pendiente operativo.
- La primera clase pendiente se presenta como coordinacion manual de disponibilidad, no como automatismo ni reserva libre del alumno.
- El soporte queda enlazado desde la checklist, no solo desde navegacion.
- Los CTA de alumno sin plan vuelven a `#contacto`/solicitud de plaza en vez de empujar a `#pricing`, manteniendo checkout real como final-only.

Evidencia:

- `corepack pnpm exec vitest run --coverage=false tests/unit/student-onboarding-source.test.ts tests/unit/crm-onboarding.test.ts`: OK, 5 tests.
- `corepack pnpm exec vitest run --coverage=false tests/unit/student-onboarding-source.test.ts tests/unit/crm-onboarding.test.ts tests/unit/i18n-encoding.test.ts`: OK, 10 tests.
- `corepack pnpm typecheck`: OK.
- `corepack pnpm lint`: OK.
- `corepack pnpm launch:content`: OK, resumen `outputs/launch-content/2026-06-26T09-21-57-268Z/summary.md`.
- `corepack pnpm launch:status`: BLOCKED esperado por 9 blockers final-only/manuales, resumen `outputs/launch-status/2026-06-26T09-21-23-559Z/summary.md`.

Estado:

- FG-09 queda cerrado a nivel de producto local/staging: el alumno ve el camino post-pago sin depender de Stripe live, Google real ni texto legal final.

## Avance Implementado 2026-06-26, Vigesimo Tercer Corte

Vigesimo tercer corte integrado: pulso operativo en el centro de mando admin.

Archivos:

- `src/lib/crm/admin-dashboard.ts`
- `src/pages/[lang]/campus/admin/index.astro`
- `tests/unit/crm-admin-dashboard.test.ts`
- `docs/launch/FUNCTIONAL_GAP_ROADMAP.md`

Queda hecho:

- El resumen admin incorpora `commercialPulse` para que el flujo comercial no dependa solo de listas repartidas.
- Se cuentan leads nuevos con mas de 24h, diagnosticos enviados, diagnosticos recibidos, oportunidades en propuesta, oportunidades pospuestas y primera clase pendiente.
- La primera clase pendiente se deriva de tareas CRM abiertas/aplazadas con `related_entity_type` `subscription_onboarding` o `profile_onboarding`.
- Si las tablas CRM aun no estan migradas, el dashboard conserva los contadores basados en `leads` y deja los contadores CRM en cero.
- La portada admin muestra el pulso operativo junto a urgencias, riesgo de retencion, tareas, leads, soporte, pagos, renovaciones y clases de hoy.

Evidencia:

- `corepack pnpm exec vitest run --coverage=false tests/unit/crm-admin-dashboard.test.ts`: OK, 3 tests.
- `corepack pnpm exec vitest run --coverage=false tests/unit/crm-admin-dashboard.test.ts tests/unit/student-onboarding-source.test.ts tests/unit/crm-onboarding.test.ts`: OK, 8 tests.
- `corepack pnpm typecheck`: OK.
- `corepack pnpm lint`: OK.
- `corepack pnpm launch:content`: OK, resumen `outputs/launch-content/2026-06-26T09-26-11-915Z/summary.md`.
- `corepack pnpm launch:status`: BLOCKED esperado por 9 blockers final-only/manuales, resumen `outputs/launch-status/2026-06-26T09-26-25-446Z/summary.md`.

Estado:

- El dashboard recomendado queda mas cerrado para uso diario: ahora cubre envejecimiento de leads, diagnostico, propuesta/posposicion y onboarding de primera clase sin depender de Stripe live ni servicios reales.

## Avance Implementado 2026-06-26, Vigesimo Cuarto Corte

Vigesimo cuarto corte integrado: refresco de guia RC/Fase 1 sin evidencias caducadas copiadas.

Archivos:

- `docs/launch/RC_EVIDENCE_REFRESH.md`
- `tests/unit/operations-runbook.test.ts`
- `docs/launch/FUNCTIONAL_GAP_ROADMAP.md`

Queda hecho:

- La guia de refresco de RC ya no copia timestamps fijos como si fueran la fuente viva.
- Los comandos de `launch:manual-evidence:record` usan `<timestamp>` y obligan a tomar la ultima salida real de `launch:operations`.
- La guia distingue mejor que Codex puede preparar audits y documentacion, pero Alin debe revisar dashboards/estado real antes de usar `--write` o marcar `pass`.
- La prueba documental protege que `RC_EVIDENCE_REFRESH.md` siga enfocado en `database_readiness` y `operations_external`, con placeholders de evidencia actual y sin rutas de outputs fechadas dentro del propio runbook.

Evidencia:

- `corepack pnpm exec vitest run --coverage=false tests/unit/operations-runbook.test.ts`: OK, 7 tests.
- `corepack pnpm typecheck`: OK.
- `corepack pnpm lint`: OK.
- `corepack pnpm launch:content`: OK, resumen `outputs/launch-content/2026-06-26T09-35-00-595Z/summary.md`.
- `corepack pnpm launch:operations`: OK, resumen `outputs/launch-operations/2026-06-26T09-28-14-275Z/summary.md`.
- `corepack pnpm launch:manual-evidence`: FAILED esperado, resumen `outputs/launch-manual-evidence/2026-06-26T09-28-33-212Z/summary.md`.
- `corepack pnpm launch:status`: BLOCKED esperado por Fase 1 manual/final-only, resumen `outputs/launch-status/2026-06-26T09-35-39-926Z/summary.md`.

Estado:

- El siguiente desbloqueo de RC sigue siendo evidencia manual real/no secreta de `database_readiness` y `operations_external`.
- No se ha inventado evidencia manual ni se ha tocado legal real, Stripe live, fuente premium, secretos production, servicios production, dominio/Search Console ni smoke production.

## Avance Implementado 2026-06-26, Vigesimo Quinto Corte

Vigesimo quinto corte integrado: frontera dura de disponibilidad para crear clases.

Archivos:

- `src/lib/calendar/availability.ts`
- `src/pages/api/calendar/sessions.ts`
- `src/pages/api/calendar/bulk-sessions.ts`
- `src/pages/api/calendar/recurring-sessions.ts`
- `tests/unit/calendar-availability.test.ts`
- `tests/api/sessions-create.test.ts`
- `tests/api/bulk-sessions.test.ts`
- `tests/unit/api-query-construction.test.ts`
- `docs/launch/FUNCTIONAL_GAP_ROADMAP.md`

Queda hecho:

- Los endpoints que crean clases ya no dependen solo de que la UI haya mostrado slots correctos.
- `sessions`, `bulk-sessions` y `recurring-sessions` verifican contra el RPC canonico `get_available_slots` antes de insertar.
- Si una hora no aparece en `teacher_availability` o ya no esta disponible, la API devuelve `409` y no inserta la clase.
- La duracion normalizada sigue usando el set soportado 30/40/50 minutos, con 50 como default.
- La comprobacion se agrupa por fecha local de Europe/Madrid, que es la misma base operativa usada por `get_available_slots`.

Evidencia:

- `corepack pnpm exec vitest run --coverage=false tests/unit/calendar-availability.test.ts tests/api/sessions-create.test.ts tests/api/bulk-sessions.test.ts tests/unit/api-query-construction.test.ts`: OK, 22 tests.
- `corepack pnpm typecheck`: OK.

Estado:

- El calendario queda mas consistente para onboarding post-pago y primera clase: no se puede crear por API una clase fuera de la disponibilidad del profesor solo porque el usuario evite la UI.
- No se toca Google real ni Calendar production; la verificacion externa sigue final-only/operativa segun `operations_external` e `integration_readiness`.

## Avance Implementado 2026-06-26, Vigesimo Sexto Corte

Vigesimo sexto corte integrado: recurrencias ancladas al calendario de Madrid.

Archivos:

- `src/lib/calendar/madrid-time.ts`
- `src/lib/calendar/availability.ts`
- `src/pages/api/calendar/recurring-sessions.ts`
- `tests/unit/madrid-time.test.ts`
- `tests/unit/api-query-construction.test.ts`
- `docs/launch/FUNCTIONAL_GAP_ROADMAP.md`

Queda hecho:

- Las clases recurrentes ya no dependen de la zona horaria del runtime con `Date.setHours`.
- `startDate` y `endDate` se normalizan como fechas de calendario Madrid.
- La hora `HH:mm` se convierte explicitamente desde Europe/Madrid a UTC antes de guardar la sesion.
- La conversion cubre invierno y verano: `10:00` Madrid se guarda como `09:00Z` en febrero y `08:00Z` en julio.
- La generacion semanal usa suma de dias sobre `YYYY-MM-DD`, no el timezone local del servidor.

Evidencia:

- `corepack pnpm exec vitest run --coverage=false tests/unit/madrid-time.test.ts tests/unit/calendar-availability.test.ts tests/unit/api-query-construction.test.ts tests/api/recurring-sessions.test.ts tests/api/bulk-sessions.test.ts tests/api/sessions-create.test.ts`: OK, 30 tests.
- `corepack pnpm typecheck`: OK.
- `corepack pnpm lint`: OK.
- `corepack pnpm launch:content`: OK, resumen `outputs/launch-content/2026-06-26T09-48-09-766Z/summary.md`.
- `corepack pnpm launch:status`: BLOCKED esperado por Fase 1 manual/final-only, resumen `outputs/launch-status/2026-06-26T09-48-16-168Z/summary.md`.

Estado:

- La coordinacion manual de primera clase y tandas recurrentes queda mas fiable para alumnos y profesores en Espana, incluso si el runtime ejecuta en UTC.
- No se toca Google real ni Calendar production; esto solo corrige la frontera local/API.

## Avance Implementado 2026-06-26, Vigesimo Septimo Corte

Vigesimo septimo corte integrado: tandas de clases sin solapes internos.

Archivos:

- `src/lib/calendar/availability.ts`
- `tests/unit/calendar-availability.test.ts`
- `tests/api/bulk-sessions.test.ts`
- `docs/launch/FUNCTIONAL_GAP_ROADMAP.md`

Queda hecho:

- La comprobacion de disponibilidad detecta duplicados y solapes dentro del propio payload antes de consultar slots o insertar.
- Una tanda con dos clases que se pisan, por ejemplo `10:00` y `10:30` para duracion de 50 minutos, devuelve `409`.
- El endpoint masivo aborta antes de `insert` y antes de `get_available_slots` si el payload ya es incoherente.
- Esto evita depender solo de la constraint SQL o de un fallo tardio para descubrir errores de agendamiento manual.

Evidencia:

- `corepack pnpm exec vitest run --coverage=false tests/unit/calendar-availability.test.ts tests/api/bulk-sessions.test.ts tests/api/sessions-create.test.ts tests/api/recurring-sessions.test.ts tests/unit/madrid-time.test.ts tests/unit/api-query-construction.test.ts`: OK, 33 tests.
- `corepack pnpm typecheck`: OK.
- `corepack pnpm lint`: OK.
- `corepack pnpm launch:content`: OK, resumen `outputs/launch-content/2026-06-26T09-51-02-375Z/summary.md`.
- `corepack pnpm launch:status`: BLOCKED esperado por Fase 1 manual/final-only, resumen `outputs/launch-status/2026-06-26T09-51-10-127Z/summary.md`.

Estado:

- La programacion manual de primeras clases y tandas ya tiene tres fronteras locales coherentes: disponibilidad canonica, zona horaria Madrid y rechazo temprano de solapes internos.
- No se toca Google real ni Calendar production.

## Avance Implementado 2026-06-26, Vigesimo Octavo Corte

Vigesimo octavo corte integrado: soporte cerrado como flujo transaccional completo.

Archivos:

- `src/lib/email/templates.ts`
- `src/lib/email/send.ts`
- `src/lib/email/index.ts`
- `src/lib/email/previews.ts`
- `src/pages/api/admin/support-tickets.ts`
- `tests/unit/email-templates.test.ts`
- `tests/api/admin-support-tickets.test.ts`
- `docs/launch/EMAIL_MATRIX.md`
- `docs/launch/FUNCTIONAL_GAP_ROADMAP.md`

Queda hecho:

- Al actualizar un ticket desde admin, si cambia el estado o hay una nota visible nueva, el alumno recibe un email transaccional de actualizacion.
- El aviso al alumno es fail-soft: si Resend no acepta el email, el ticket, audit log y actividad de soporte quedan guardados igualmente.
- El email usa `preferred_language` para apuntar al soporte del campus en `es`, `en` o `ru`, con ingles como fallback operativo.
- Si el email sale aceptado, se registra `crm_activities.email_out` con template `support_ticket_updated`, `purpose: transactional` y relacion `support_ticket_update_email`.
- La matriz de emails ya distingue soporte recibido, soporte actualizado y alerta interna de nuevo ticket.

Evidencia:

- `corepack pnpm exec vitest run --coverage=false tests/unit/email-templates.test.ts tests/api/admin-support-tickets.test.ts tests/api/support-alert.test.ts`: OK, 17 tests.
- `corepack pnpm typecheck`: OK.
- `corepack pnpm lint`: OK.
- `corepack pnpm launch:content`: OK, resumen `outputs/launch-content/2026-06-26T09-57-58-902Z/summary.md`.
- `corepack pnpm launch:status`: BLOCKED esperado por Fase 1 manual/final-only, resumen `outputs/launch-status/2026-06-26T09-57-58-964Z/summary.md`.

Estado:

- El circuito de soporte ya no queda mudo despues de que Alin o el socio actuen desde admin.
- No se toca Resend production ni ningun servicio externo real.

## Avance Implementado 2026-06-26, Vigesimo Noveno Corte

Vigesimo noveno corte integrado: comunicacion manual CRM sincroniza pipeline comercial.

Archivos:

- `src/pages/api/admin/crm/contact-actions.ts`
- `tests/api/admin-crm-contact-actions.test.ts`
- `docs/launch/FUNCTIONAL_GAP_ROADMAP.md`

Queda hecho:

- Una comunicacion manual saliente con finalidad `sales_follow_up` ya no deja el lead como si siguiera sin tocar.
- Si la comunicacion se registra con una oportunidad en `new` o `to_contact`, la oportunidad pasa a `contacted`.
- Si la oportunidad viene de un lead legacy, el lead tambien pasa a `contacted`.
- El contacto actualiza `last_contacted_at` y agenda `next_follow_up_at` a 24h desde el registro.
- La actividad de comunicacion conserva metadata de consentimiento, proximo seguimiento y etapa antes/despues de la oportunidad.
- La regla no afecta comunicaciones entrantes, soporte, transaccionales ni marketing.

Evidencia:

- `corepack pnpm exec vitest run --coverage=false tests/api/admin-crm-contact-actions.test.ts`: OK, 16 tests.
- `corepack pnpm typecheck`: OK.
- `corepack pnpm lint`: OK.
- `corepack pnpm launch:content`: OK, resumen `outputs/launch-content/2026-06-26T10-02-41-146Z/summary.md`.
- `corepack pnpm launch:status`: BLOCKED esperado por Fase 1 manual/final-only, resumen `outputs/launch-status/2026-06-26T10-02-41-187Z/summary.md`.

Estado:

- El CRM queda mas coherente para operacion real entre Alin y el socio: si alguien registra que ha escrito o llamado comercialmente, el pipeline y el SLA de seguimiento se mueven con esa accion.
- No se envia ningun email real ni se toca ningun servicio externo.

## Avance Implementado 2026-06-26, Trigesimo Corte

Trigesimo corte integrado: no-show de clase crea seguimiento operativo.

Archivos:

- `src/lib/crm/onboarding.ts`
- `src/pages/api/calendar/session-action.ts`
- `tests/unit/crm-onboarding.test.ts`
- `tests/api/session-action.test.ts`
- `docs/launch/FUNCTIONAL_GAP_ROADMAP.md`

Queda hecho:

- Cuando una clase pasada se marca como `no_show`, el CRM ya no guarda solo una actividad informativa.
- Se crea o reactiva una tarea compartida `Follow up after missed class` con prioridad alta y vencimiento a 24h.
- La tarea queda relacionada con `session_no_show`, con metadata de sesion, suscripcion, profesor, fecha prevista y hora del no-show.
- El contacto conserva lifecycle `customer` y actualiza `next_follow_up_at` al mismo SLA de 24h.
- Se registra actividad de sistema `No-show follow-up task created` para que la accion sea visible en timeline.
- Si la tabla CRM no existe en un entorno viejo, el registro de no-show no se bloquea; el helper falla de forma segura.

Evidencia:

- `corepack pnpm exec vitest run --coverage=false tests/unit/crm-onboarding.test.ts tests/api/session-action.test.ts`: OK, 15 tests.
- `corepack pnpm typecheck`: OK.
- `corepack pnpm lint`: OK.
- `corepack pnpm launch:content`: OK, resumen `outputs/launch-content/2026-06-26T10-06-15-384Z/summary.md`.
- `corepack pnpm launch:status`: BLOCKED esperado por Fase 1 manual/final-only, resumen `outputs/launch-status/2026-06-26T10-06-15-777Z/summary.md`.

Estado:

- El onboarding post-pago queda mas robusto ante la primera incidencia real: una ausencia ya genera trabajo accionable para Alin/socio.
- No se envia ningun email real ni se toca Google/Calendar production.

## Avance Implementado 2026-06-26, Trigesimo Primer Corte

Trigesimo primer corte integrado: ventana de cancelacion de alumno protegida en API.

Archivos:

- `src/pages/api/calendar/session-action.ts`
- `tests/api/session-action.test.ts`
- `docs/launch/FUNCTIONAL_GAP_ROADMAP.md`

Queda hecho:

- La regla comercial de 24h para cancelaciones de alumnos ya no vive solo en la UI.
- Si un alumno intenta cancelar por API una clase con menos de 24h de antelacion, la respuesta es `409` y no se actualiza la sesion.
- La accion se bloquea antes de tocar `sessions.update`, antes de devolver sesiones al paquete y antes de registrar actividad CRM.
- Profesores y admins conservan capacidad de intervencion manual para casos internos.

Evidencia:

- `corepack pnpm exec vitest run --coverage=false tests/api/session-action.test.ts`: OK, 12 tests.
- `corepack pnpm typecheck`: OK.
- `corepack pnpm lint`: OK.
- `corepack pnpm launch:content`: OK, resumen `outputs/launch-content/2026-06-26T10-08-31-566Z/summary.md`.
- `corepack pnpm launch:status`: BLOCKED esperado por Fase 1 manual/final-only, resumen `outputs/launch-status/2026-06-26T10-08-31-826Z/summary.md`.

Estado:

- La politica publica "menos de 24h, la clase se pierde" queda aplicada en la frontera de servidor.
- No se toca Google/Calendar production ni servicios externos.

## Avance Implementado 2026-06-26, Trigesimo Segundo Corte

Trigesimo segundo corte integrado: el enlace de Meet no desaparece durante una prorroga razonable.

Archivos:

- `src/lib/class-access.ts`
- `src/components/calendar/StudentClassList.tsx`
- `src/components/calendar/NextClassCard.tsx`
- `tests/unit/class-access.test.ts`
- `tests/unit/StudentClassList.test.tsx`
- `docs/launch/FUNCTIONAL_GAP_ROADMAP.md`

Queda hecho:

- La ventana de union a clase ya usa una regla compartida: duracion normalizada de la clase mas 120 minutos de margen posterior.
- Una clase de 50 minutos mantiene el enlace visible si se alarga razonablemente, en vez de ocultarlo por un corte fijo de 60 minutos desde el inicio.
- El listado de clases del alumno y la tarjeta de proxima clase usan la misma logica.
- Fechas de clase invalidas no abren la ventana de union.

Evidencia:

- `corepack pnpm exec vitest run --coverage=false tests/unit/class-access.test.ts tests/unit/StudentClassList.test.tsx`: OK, 20 tests.
- `corepack pnpm typecheck`: OK.
- `corepack pnpm lint`: OK.
- `corepack pnpm launch:content`: OK, resumen `outputs/launch-content/2026-06-26T10-14-54-237Z/summary.md`.
- `corepack pnpm launch:status`: BLOCKED esperado por Fase 1 manual/final-only, resumen `outputs/launch-status/2026-06-26T10-14-54-266Z/summary.md`.

Estado:

- La UI deja de cortar el acceso visual al Meet durante una prorroga razonable.
- No se toca Google Calendar, Google Meet production ni ningun servicio externo.

## Avance Implementado 2026-06-26, Trigesimo Tercer Corte

Trigesimo tercer corte integrado: el modo de lanzamiento sin cobros reales queda auditado.

Archivos:

- `scripts/launch/payments-audit.ts`
- `tests/unit/landing-public-content.test.ts`
- `docs/launch/FUNCTIONAL_GAP_ROADMAP.md`

Queda hecho:

- `corepack pnpm launch:payments` ahora comprueba explicitamente el modo `no-real-payments launch mode`.
- La auditoria verifica que `.env.example` mantiene `CHECKOUT_ENABLED=false`.
- La auditoria verifica que las CTAs publicas de landing y paginas de segmento siguen en modo solicitud de plaza, no checkout directo.
- La auditoria verifica que `/api/create-checkout` falla cerrado con `403` antes de tocar Supabase o Stripe si `CHECKOUT_ENABLED` no es `true`.
- La worksheet de pagos distingue dos cierres validos: compra Stripe test staging si se van a activar pagos, o lanzamiento sin pagos reales con checkout desactivado/oculto/bloqueado si Stripe queda para el final.

Evidencia:

- `corepack pnpm exec vitest run --coverage=false tests/unit/landing-public-content.test.ts`: OK, 17 tests.
- `corepack pnpm typecheck`: OK.
- `corepack pnpm lint`: OK.
- `corepack pnpm launch:payments`: OK, resumen `outputs/launch-payments/2026-06-26T10-18-02-422Z/summary.md`.
- `corepack pnpm launch:content`: OK, resumen `outputs/launch-content/2026-06-26T10-18-29-488Z/summary.md`.
- `corepack pnpm launch:status`: BLOCKED esperado por Fase 1 manual/final-only, resumen `outputs/launch-status/2026-06-26T10-18-29-522Z/summary.md`.

Estado:

- Stripe live y la prueba real con datos reales siguen final-only.
- La parte operativa previa queda mas segura: el proyecto puede funcionar con solicitudes/manual CRM sin abrir cobros reales por accidente.
- No se toca Stripe, Supabase remoto, Cloudflare ni ningun servicio externo.

## Avance Implementado 2026-06-26, Trigesimo Cuarto Corte

Trigesimo cuarto corte integrado: descartar/rechazar un lead cierra tambien la revision pendiente del diagnostico.

Archivos:

- `src/pages/api/admin/leads.ts`
- `tests/api/admin-leads.test.ts`
- `docs/launch/FUNCTIONAL_GAP_ROADMAP.md`

Queda hecho:

- Al marcar un lead como `discarded`, se sigue limpiando `leads.level_check_context` y ahora se cierran las tareas CRM abiertas/snoozed relacionadas con `level_check`.
- Al mover una oportunidad CRM a `lost`, el lead legado pasa a descartado, se limpia el contexto crudo del diagnostico y se cierra tambien la tarea de revision.
- La tarea `Review lightweight level check` ya no queda abierta cuando la muestra temporal se elimina por descarte o perdida.
- Si las tablas CRM no existen todavia, la limpieza sigue siendo fail-soft; si existe un error real de tareas CRM, el endpoint lo comunica como fallo parcial.

Evidencia:

- `corepack pnpm exec vitest run --coverage=false tests/api/admin-leads.test.ts`: OK, 14 tests.
- `corepack pnpm typecheck`: OK.
- `corepack pnpm lint`: OK.
- `corepack pnpm launch:content`: OK, resumen `outputs/launch-content/2026-06-26T10-22-21-182Z/summary.md`.
- `corepack pnpm launch:status`: BLOCKED esperado por Fase 1 manual/final-only, resumen `outputs/launch-status/2026-06-26T10-22-21-425Z/summary.md`.

Estado:

- La privacidad del diagnostico y el CRM quedan mas sincronizados: no se conserva trabajo pendiente sobre una muestra que ya no debe revisarse.
- No se toca Supabase remoto ni ningun servicio externo.

## Avance Implementado 2026-06-26, Trigesimo Quinto Corte

Trigesimo quinto corte integrado: los emails comerciales crean seguimiento accionable en CRM.

Archivos:

- `src/pages/api/admin/leads.ts`
- `tests/api/admin-leads.test.ts`
- `docs/launch/FUNCTIONAL_GAP_ROADMAP.md`

Queda hecho:

- Al enviar un email comercial manual desde admin leads, el sistema mantiene el registro de email enviado y ahora crea o reactiva una tarea CRM `lead_sales_follow_up`.
- La propuesta `proposal_next_step` crea tarea `Follow up after proposal email`, tipo `email`, prioridad `high`, con vencimiento a 24 horas y asignada al admin que envio el email.
- El email `missing_info` queda cubierto por el mismo mecanismo con tarea `Follow up after missing-info email` y prioridad `normal`.
- Si ya existe una tarea abierta o snoozed para ese lead/contacto, se reabre y actualiza en vez de duplicarse.
- La cobertura API confirma tambien el caso `missing_info` con tarea existente: el sistema actualiza la tarea y mantiene el historial de email, contacto, oportunidad y auditoria.
- Si falla la creacion/actualizacion de la tarea, el endpoint devuelve fallo parcial explicito despues del envio para no perder el problema operativo.

Evidencia:

- `corepack pnpm exec vitest run --coverage=false tests/api/admin-leads.test.ts`: OK, 15 tests.
- `corepack pnpm typecheck`: OK.
- `corepack pnpm lint`: OK.
- `corepack pnpm launch:content`: OK, resumen `outputs/launch-content/2026-06-26T10-26-59-011Z/summary.md`.
- `corepack pnpm launch:status`: BLOCKED esperado por Fase 1 manual/final-only, resumen `outputs/launch-status/2026-06-26T10-26-59-023Z/summary.md`.

Estado:

- El seguimiento comercial ya no vive solo como `next_follow_up_at` en el contacto: tambien aparece como tarea en `crm_tasks`, que alimenta la cola accionable del dashboard CRM.
- No se toca Resend real, Supabase remoto ni ningun servicio externo.

## Avance Implementado 2026-06-26, Trigesimo Sexto Corte

Trigesimo sexto corte integrado: la bienvenida post-pago apunta al login correcto por idioma.

Archivos:

- `src/lib/fulfillment/jobs.ts`
- `tests/unit/fulfillment-jobs.test.ts`
- `docs/launch/EMAIL_MATRIX.md`
- `docs/launch/FUNCTIONAL_GAP_ROADMAP.md`

Queda hecho:

- `welcome_fulfillment` lee `profiles.preferred_language` al preparar la bienvenida post-pago.
- El enlace de login del email de bienvenida usa `/{lang}/login` para `es`, `en` o `ru`.
- Si el perfil no tiene idioma valido, el fallback operativo es ingles, coherente con la decision de usar ingles como idioma preferente de emails v1.
- El flujo sigue creando/reutilizando carpeta Drive, enviando bienvenida y registrando onboarding en CRM sin tocar Stripe live ni servicios reales durante los tests.

Evidencia:

- `corepack pnpm exec vitest run --coverage=false tests/unit/fulfillment-jobs.test.ts`: OK, 8 tests.
- `corepack pnpm typecheck`: OK.
- `corepack pnpm lint`: OK.
- `corepack pnpm launch:content`: OK, resumen `outputs/launch-content/2026-06-26T10-32-50-989Z/summary.md`.
- `corepack pnpm launch:status`: BLOCKED esperado por Fase 1 manual/final-only, resumen `outputs/launch-status/2026-06-26T10-32-51-143Z/summary.md`.

Estado:

- La primera experiencia post-pago queda mas consistente: un email en ingles ya no empuja por defecto al login espanol si el alumno no ha definido otro idioma.
- No se toca Google Drive real, Resend real, Supabase remoto ni ningun servicio externo.

## Avance Implementado 2026-06-26, Trigesimo Septimo Corte

Trigesimo septimo corte integrado: reenvios del diagnostico ligero vuelven a crear trabajo accionable.

Archivos:

- `src/lib/crm/level-check.ts`
- `tests/unit/crm-level-check.test.ts`
- `tests/api/level-check.test.ts`
- `docs/launch/LEVEL_CHECK.md`
- `docs/launch/FUNCTIONAL_GAP_ROADMAP.md`

Queda hecho:

- La tarea CRM `Review lightweight level check` solo se reutiliza si esta abierta o snoozed.
- La actividad CRM `Lightweight level check received` se refresca con el ultimo resumen y fecha de recepcion si el lead reenvia el diagnostico.
- Si el lead reenvia el diagnostico mientras la tarea sigue abierta, se refresca a `open`, se actualiza el vencimiento a 24h y se guarda el resumen nuevo.
- Si una revision anterior ya estaba cerrada, una nueva entrega crea una nueva tarea de revision en vez de apuntar a trabajo ya completado.
- La metadata de la tarea incluye `received_at`, email normalizado, SLA 24h y resumen operativo, sin copiar la muestra escrita cruda.

Evidencia:

- `corepack pnpm exec vitest run --coverage=false tests/unit/crm-level-check.test.ts tests/api/level-check.test.ts`: OK, 2 archivos y 5 tests.
- `corepack pnpm typecheck`: OK.
- `corepack pnpm lint`: OK.
- `corepack pnpm launch:content`: OK, resumen `outputs/launch-content/2026-06-26T10-40-14-482Z/summary.md`.
- `corepack pnpm launch:status`: BLOCKED esperado por Fase 1 manual/final-only, resumen `outputs/launch-status/2026-06-26T10-40-14-710Z/summary.md`.

Estado:

- El diagnostico queda mejor conectado al CRM: una segunda entrega no se pierde detras de una tarea antigua ya cerrada.
- No se toca Supabase remoto, Resend, Turnstile production ni ningun servicio externo.

## Avance Implementado 2026-06-26, Trigesimo Octavo Corte

Trigesimo octavo corte integrado: el dashboard admin ya distingue trabajo comercial accionable.

Archivos:

- `src/lib/crm/admin-dashboard.ts`
- `src/pages/[lang]/campus/admin/index.astro`
- `tests/unit/crm-admin-dashboard.test.ts`
- `docs/launch/FUNCTIONAL_GAP_ROADMAP.md`

Queda hecho:

- El pulso operativo cuenta tareas CRM abiertas/snoozed de `lead_sales_follow_up`.
- El pulso operativo cuenta tareas CRM abiertas/snoozed de `level_check`.
- La pantalla admin muestra "Seguimientos ventas" y "Revisiones diagnostico" junto a leads >24h, diagnosticos, propuestas, pospuestos y primera clase pendiente.
- La prueba del dashboard fija que ambos contadores filtran por `related_entity_type`, no por texto visible ni por memoria humana.

Evidencia:

- `corepack pnpm exec vitest run --coverage=false tests/unit/crm-admin-dashboard.test.ts`: OK, 1 archivo y 3 tests.
- `corepack pnpm typecheck`: OK.
- `corepack pnpm lint`: OK.
- `corepack pnpm launch:content`: OK, resumen `outputs/launch-content/2026-06-26T10-45-42-229Z/summary.md`.
- `corepack pnpm launch:status`: BLOCKED esperado por Fase 1 manual/final-only, resumen `outputs/launch-status/2026-06-26T10-45-42-231Z/summary.md`.

Estado:

- Las tareas que generan el flujo comercial y el diagnostico ligero quedan visibles en el centro de mando admin.
- No se toca Supabase remoto, Resend, Stripe, Turnstile production ni ningun servicio externo.

## Avance Implementado 2026-06-26, Trigesimo Noveno Corte

Trigesimo noveno corte integrado: el dashboard admin separa totales reales de previews.

Archivos:

- `src/lib/crm/admin-dashboard.ts`
- `src/pages/[lang]/campus/admin/index.astro`
- `tests/unit/crm-admin-dashboard.test.ts`
- `docs/launch/FUNCTIONAL_GAP_ROADMAP.md`

Queda hecho:

- Las tarjetas de leads nuevos, soporte abierto, pagos fallidos y clases de hoy usan contadores exactos.
- Las listas siguen limitadas como previews ligeras para no convertir el dashboard en una pantalla infinita.
- `urgentQueueCount` usa los totales reales de leads/soporte/pagos, no solo los primeros 5 elementos cargados.
- Las consultas reutilizan `count: 'exact'` en las mismas queries de preview, sin anadir una tanda extra de llamadas.

Evidencia:

- `corepack pnpm exec vitest run --coverage=false tests/unit/crm-admin-dashboard.test.ts`: OK, 1 archivo y 3 tests.

Estado:

- El centro de mando ya no infracuenta la carga operativa cuando hay mas elementos que los previews visibles.
- No se toca Supabase remoto, Resend, Stripe, Turnstile production ni ningun servicio externo.

## Avance Implementado 2026-06-26, Cuadragesimo Corte

Cuadragesimo corte integrado: cierre de tareas CRM cuando el lead deja de requerir trabajo comercial inicial.

Archivos:

- `src/pages/api/admin/leads.ts`
- `tests/api/admin-leads.test.ts`
- `docs/launch/FUNCTIONAL_GAP_ROADMAP.md`

Queda hecho:

- Al marcar un lead como `contacted`, se cierra la tarea inicial `lead` de revision de solicitud.
- Al mover una oportunidad a `proposal`, `qualified`, `contacted` o `nurture`, se cierra la revision inicial del lead heredado.
- Al descartar un lead o marcar una oportunidad como `lost`, se cierran tareas activas/snoozed vinculadas al lead: revision inicial, revision de diagnostico y follow-up comercial.
- Al marcar una oportunidad como `won`, tambien se cierran las tareas terminales del lead para que el dashboard no siga mostrando trabajo comercial antiguo.
- La limpieza sigue fallando cerrado solo ante errores CRM reales; si las tablas CRM aun no existen, el flujo legacy no se rompe.

Evidencia:

- `corepack pnpm exec vitest run --coverage=false --reporter=dot tests/api/admin-leads.test.ts`: OK, 1 archivo y 16 tests.
- `corepack pnpm typecheck`: OK.
- `corepack pnpm lint`: OK.
- `corepack pnpm launch:content`: OK, resumen `outputs/launch-content/2026-06-26T10-53-07-762Z/summary.md`.
- `corepack pnpm launch:status`: BLOCKED esperado por Fase 1 manual/final-only, resumen `outputs/launch-status/2026-06-26T10-53-07-772Z/summary.md`.

Estado:

- El flujo comercial queda mas consistente: actuar, perder o ganar un lead ya no deja tareas antiguas contaminando la cola compartida.
- No se toca Supabase remoto, Resend, Stripe, Turnstile production ni ningun servicio externo.

## Avance Implementado 2026-06-26, Cuadragesimo Primer Corte

Cuadragesimo primer corte integrado: primera clase agendada actualiza onboarding y materiales.

Archivos:

- `src/lib/crm/onboarding.ts`
- `src/pages/api/calendar/sessions.ts`
- `tests/unit/crm-onboarding.test.ts`
- `tests/api/sessions-create.test.ts`
- `docs/launch/FUNCTIONAL_GAP_ROADMAP.md`

Queda hecho:

- Al programar una clase, el endpoint registra ademas el estado de onboarding `first_class_scheduled`.
- La tarea de onboarding abierta pasa a `Prepare materials before first class`.
- La tarea conserva contexto anterior y anade `session_id`, `teacher_id`, `scheduled_at`, `subscription_id` y `materials_before_first_class`.
- Si la tarea de onboarding no existia, se crea una tarea de materiales vinculada a `subscription_onboarding` o `profile_onboarding`.
- El contacto CRM mantiene `next_follow_up_at` alineado con la fecha limite de preparacion de materiales.
- El flujo sigue siendo tolerante si CRM no esta migrado: la programacion de clase no se rompe.

Evidencia:

- `corepack pnpm exec vitest run --coverage=false --reporter=dot tests/unit/crm-onboarding.test.ts tests/api/sessions-create.test.ts`: OK, 2 archivos y 15 tests.
- `corepack pnpm typecheck`: OK.
- `corepack pnpm lint`: OK.
- `corepack pnpm launch:content`: OK, resumen `outputs/launch-content/2026-06-26T10-57-18-565Z/summary.md`.
- `corepack pnpm launch:status`: BLOCKED esperado por Fase 1 manual/final-only, resumen `outputs/launch-status/2026-06-26T10-57-18-702Z/summary.md`.

Estado:

- Onboarding post-pago queda mejor cerrado: despues de pagar y antes de la primera clase, el CRM ya sabe si la clase esta agendada y que materiales siguen pendientes.
- No se toca Google Calendar/Meet real, Resend, Stripe, Supabase remoto ni ningun servicio externo.

## Avance Implementado 2026-06-26, Cuadragesimo Segundo Corte

Cuadragesimo segundo corte integrado: cancelacion con antelacion deja evidencia de cuota restaurada.

Archivos:

- `src/pages/api/calendar/session-action.ts`
- `tests/api/session-action.test.ts`
- `docs/launch/FUNCTIONAL_GAP_ROADMAP.md`

Queda hecho:

- Al cancelar una sesion programada con suscripcion asociada, la respuesta incluye `quotaRestored`.
- La actividad CRM `Clase cancelada` registra si se intento restaurar cuota, si se restauro, `previous_sessions_used` y `next_sessions_used`.
- La regla de menos de 24h para alumnos sigue bloqueando antes de tocar la sesion o CRM.
- Completar clase y no-show siguen consumiendo la sesion ya programada; no se cambia esa regla.

Evidencia:

- `corepack pnpm exec vitest run --coverage=false --reporter=dot tests/api/session-action.test.ts`: OK, 1 archivo y 12 tests.
- `corepack pnpm typecheck`: OK.
- `corepack pnpm lint`: OK.
- `corepack pnpm launch:content`: OK, resumen `outputs/launch-content/2026-06-26T11-00-24-222Z/summary.md`.
- `corepack pnpm launch:status`: BLOCKED esperado por Fase 1 manual/final-only, resumen `outputs/launch-status/2026-06-26T11-00-24-217Z/summary.md`.

Estado:

- La politica comercial de cancelacion queda mas auditable: si se cancela a tiempo, queda constancia local de que la clase vuelve al saldo.
- No se toca Google Calendar/Meet real, Resend, Stripe, Supabase remoto ni ningun servicio externo.

## Avance Implementado 2026-06-26, Cuadragesimo Tercer Corte

Cuadragesimo tercer corte integrado: sesiones en bloque y recurrentes tambien actualizan onboarding de primera clase.

Archivos:

- `src/pages/api/calendar/bulk-sessions.ts`
- `src/pages/api/calendar/recurring-sessions.ts`
- `tests/api/bulk-sessions.test.ts`
- `tests/api/recurring-sessions.test.ts`
- `docs/launch/FUNCTIONAL_GAP_ROADMAP.md`

Queda hecho:

- La creacion simple, en bloque y recurrente de sesiones queda alineada con el mismo circuito CRM/onboarding.
- Al crear una tanda de sesiones, el sistema identifica la clase mas temprana creada y registra `first_class_scheduled`.
- La tarea interna de materiales antes de la primera clase ya no depende de que la clase se haya creado por el endpoint simple.
- Las sesiones recurrentes recuperan datos del alumno/profesor en el `select` para que la actividad CRM y el onboarding tengan email, nombre y contexto humano.
- El cambio sigue siendo tolerante: si CRM/onboarding falla, la programacion de clases no se rompe.

Evidencia:

- `corepack pnpm exec vitest run --coverage=false --reporter=dot tests/api/bulk-sessions.test.ts tests/api/recurring-sessions.test.ts`: OK, 2 archivos y 15 tests.
- `corepack pnpm typecheck`: OK.
- `corepack pnpm lint`: OK.
- `corepack pnpm launch:content`: OK, resumen `outputs/launch-content/2026-06-26T11-09-16-051Z/summary.md`.
- `corepack pnpm launch:status`: BLOCKED esperado por Fase 1 manual/final-only, resumen `outputs/launch-status/2026-06-26T11-09-16-073Z/summary.md`.

Estado:

- Onboarding post-pago queda mas consistente: ya no hay una ruta paralela de agenda que deje sin preparar materiales antes de la primera clase.
- No se toca Google Calendar/Meet real, Resend, Stripe, Supabase remoto ni ningun servicio externo.

## Avance Implementado 2026-06-26, Cuadragesimo Cuarto Corte

Cuadragesimo cuarto corte integrado: emails transaccionales de soporte escapan campos renderizados en HTML.

Archivos:

- `src/lib/email/templates.ts`
- `tests/unit/email-templates.test.ts`
- `docs/launch/FUNCTIONAL_GAP_ROADMAP.md`

Queda hecho:

- El acuse de ticket recibido ya no inserta `recipientName`, `issueTitle` ni `ticketId` como HTML crudo.
- Los enlaces de soporte en emails de soporte se normalizan y solo se renderizan si usan `http` o `https`.
- El email de soporte actualizado mantiene escapados nombre, asunto, ticket, estado y nota visible.
- Se anade una prueba de regresion con campos maliciosos para evitar HTML/script crudo en emails de soporte.
- La trazabilidad CRM de soporte no cambia: solo se endurece la capa de presentacion del email transaccional.

Evidencia:

- `corepack pnpm exec vitest run --coverage=false --reporter=dot tests/unit/email-templates.test.ts`: OK, 1 archivo y 8 tests.
- `corepack pnpm exec vitest run --coverage=false --reporter=dot tests/api/support-alert.test.ts tests/api/admin-support-tickets.test.ts`: OK, 2 archivos y 10 tests; incluye stderr esperado de un test que simula fallo del proveedor de email.
- `corepack pnpm typecheck`: OK.
- `corepack pnpm lint`: OK.
- `corepack pnpm launch:content`: OK, resumen `outputs/launch-content/2026-06-26T11-13-59-943Z/summary.md`.
- `corepack pnpm launch:status`: BLOCKED esperado por Fase 1 manual/final-only, resumen `outputs/launch-status/2026-06-26T11-14-00-067Z/summary.md`.

Estado:

- Emails de soporte quedan mas seguros y consistentes con la promesa de emails transaccionales sobrios, humanos y trazables.
- No se toca Resend real, Supabase remoto, secretos ni servicios externos.

## Avance Implementado 2026-06-26, Cuadragesimo Quinto Corte

Cuadragesimo quinto corte integrado: plantillas transaccionales principales escapan campos dinamicos y URLs.

Archivos:

- `src/lib/email/templates.ts`
- `tests/unit/email-templates.test.ts`
- `docs/launch/FUNCTIONAL_GAP_ROADMAP.md`

Queda hecho:

- Bienvenida post-pago escapa nombre de alumno y nombre de plan antes de renderizar HTML.
- Clase confirmada, recordatorio y cancelacion escapan nombres, fechas, horas, otra parte y motivo de cancelacion.
- Solicitud recibida, follow-up de falta de informacion, propuesta/siguiente paso y diagnostico ligero escapan nombres y recomendaciones visibles.
- Los enlaces dinamicos de campus, Drive/materiales, Meet, documento, soporte y diagnostico solo se renderizan si son `http` o `https`.
- Se amplia la prueba anti-inyeccion para cubrir onboarding/email de clase/lead/follow-up/diagnostico, no solo soporte.

Evidencia:

- `corepack pnpm exec vitest run --coverage=false --reporter=dot tests/unit/email-templates.test.ts`: OK, 1 archivo y 9 tests.
- `corepack pnpm exec vitest run --coverage=false --reporter=dot tests/api/subscribe.test.ts tests/api/admin-leads.test.ts tests/api/support-alert.test.ts tests/api/admin-support-tickets.test.ts tests/api/email-send-test.test.ts`: OK, 5 archivos y 36 tests; incluye stderr esperado de un test que simula fallo del proveedor de email.
- `corepack pnpm typecheck`: OK.
- `corepack pnpm lint`: OK.
- `corepack pnpm launch:content`: OK, resumen `outputs/launch-content/2026-06-26T11-18-25-774Z/summary.md`.
- `corepack pnpm launch:status`: BLOCKED esperado por Fase 1 manual/final-only, resumen `outputs/launch-status/2026-06-26T11-18-25-928Z/summary.md`.

Estado:

- La matriz de emails v1 queda mas defendible para datos reales: los correos siguen siendo transaccionales y trazables, pero ya no confian en HTML procedente de formularios, CRM o integraciones.
- No se toca Resend real, Supabase remoto, secretos ni servicios externos.

## Avance Implementado 2026-06-26, Cuadragesimo Sexto Corte

Cuadragesimo sexto corte integrado: diagnostico ligero limpia contexto crudo tambien al ganar oportunidad.

Archivos:

- `src/pages/api/admin/leads.ts`
- `tests/api/admin-leads.test.ts`
- `docs/launch/LEVEL_CHECK.md`
- `docs/launch/FUNCTIONAL_GAP_ROADMAP.md`

Queda hecho:

- La limpieza de `leads.level_check_context` ya cubria revision manual, lead descartado y oportunidad perdida.
- Ahora tambien se limpia al mover una oportunidad a `won`, porque el lead deja de estar en revision activa y pasa al circuito de cliente.
- La marca `level_check_raw_cleared_at` se rellena en esa conversion para dejar evidencia temporal sin conservar el texto escrito crudo.
- Las tareas terminales del lead se siguen cerrando como antes.
- La documentacion de diagnostico ligero deja explicita esta regla de retencion.

Evidencia:

- `corepack pnpm exec vitest run --coverage=false --reporter=dot tests/api/admin-leads.test.ts`: OK, 1 archivo y 16 tests.
- `corepack pnpm exec vitest run --coverage=false --reporter=dot tests/api/level-check.test.ts tests/unit/crm-level-check.test.ts`: OK, 2 archivos y 5 tests.
- `corepack pnpm typecheck`: OK.
- `corepack pnpm lint`: OK.
- `corepack pnpm launch:content`: OK, resumen `outputs/launch-content/2026-06-26T11-22-00-364Z/summary.md`.
- `corepack pnpm launch:status`: BLOCKED esperado por Fase 1 manual/final-only, resumen `outputs/launch-status/2026-06-26T11-22-00-407Z/summary.md`.

Estado:

- Diagnostico de nivel queda mas alineado con la necesidad expresada: no conservar muestras crudas mas alla de la revision/decision comercial activa.
- No se toca Supabase remoto, secretos ni servicios externos.

## Avance Implementado 2026-06-26, Cuadragesimo Septimo Corte

Cuadragesimo septimo corte integrado: tareas de no-show conservan metadata operativa al refrescarse.

Archivos:

- `src/lib/crm/onboarding.ts`
- `tests/unit/crm-onboarding.test.ts`
- `docs/launch/FUNCTIONAL_GAP_ROADMAP.md`

Queda hecho:

- El completado de primera clase ya cerraba tareas de onboarding y registraba activacion.
- El no-show ya creaba tarea compartida de follow-up con SLA 24h.
- Ahora, si la tarea de no-show ya existe y se refresca, tambien se actualiza su metadata: sesion, suscripcion, profesor, fecha programada, fecha de no-show, SLA y cola compartida.
- La actividad CRM de no-show sigue incluyendo `task_id` y contexto para auditoria.
- No cambia la regla de negocio: no-show sigue consumiendo la sesion ya programada y requiere seguimiento humano.

Evidencia:

- `corepack pnpm exec vitest run --coverage=false --reporter=dot tests/unit/crm-onboarding.test.ts tests/api/session-action.test.ts`: OK, 2 archivos y 19 tests.
- `corepack pnpm typecheck`: OK.
- `corepack pnpm lint`: OK.
- `corepack pnpm launch:content`: OK, resumen `outputs/launch-content/2026-06-26T11-27-50-601Z/summary.md`.
- `corepack pnpm launch:status`: BLOCKED esperado por Fase 1 manual/final-only, resumen `outputs/launch-status/2026-06-26T11-27-51-416Z/summary.md`.

Estado:

- Onboarding post-pago queda mas accionable ante ausencias: la tarea CRM no solo existe, tambien conserva contexto actualizado para que Alin o su socio sepan que revisar.
- No se toca Supabase remoto, Google/Meet, Resend, secretos ni servicios externos.

## Avance Implementado 2026-06-26, Cuadragesimo Octavo Corte

Cuadragesimo octavo corte integrado: fallback de precio sin checkout deja de depender de texto espanol.

Archivos:

- `src/components/PricingSection.tsx`
- `tests/unit/landing-public-content.test.ts`
- `docs/launch/FUNCTIONAL_GAP_ROADMAP.md`

Queda hecho:

- `PricingSection` ya no decide si mostrar el sufijo mensual comparando contra el literal `Consultar`.
- El fallback de precio devuelve `label` y `hasPrice`, de modo que ingles/ruso no muestran por accidente un texto tipo "consultar / al mes" cuando falta precio o checkout no procede.
- Se mantiene el modo publico `application`: los planes siguen llevando a solicitud de plaza y el checkout real sigue final-only.
- El test de contenido publico protege que no vuelva la comparacion hardcodeada con `Consultar`.

Evidencia:

- `corepack pnpm exec vitest run --coverage=false --reporter=dot tests/unit/landing-public-content.test.ts`: OK, 1 archivo y 17 tests.
- `corepack pnpm launch:payments`: OK, resumen `outputs/launch-payments/2026-06-26T11-39-24-296Z/summary.md`.

Estado:

- La frontera publica "sin cobros reales" queda un poco mas robusta tambien a nivel i18n: no depende de un texto espanol para comportarse correctamente.
- No se toca Stripe, Supabase remoto, secretos ni servicios externos.

## Avance Implementado 2026-06-26, Cuadragesimo Noveno Corte

Cuadragesimo noveno corte integrado: nota accesible de solicitud antes de pago queda localizada.

Archivos:

- `src/components/PricingSection.tsx`
- `src/i18n/translations.ts`
- `tests/unit/landing-public-content.test.ts`
- `docs/launch/FUNCTIONAL_GAP_ROADMAP.md`

Queda hecho:

- El texto `sr-only` enlazado a los botones de planes en modo `application` ya no queda solo en espanol para EN/RU.
- `ui[lang].pricing.applicationNote` define la nota en ES/EN/RU.
- `PricingSection` usa `copy.applicationNote` y mantiene fallback por idioma si una pagina antigua no trae la clave.
- La UI publica sigue sin abrir checkout: los botones de planes continuan llevando a solicitud de plaza.

Evidencia:

- `corepack pnpm exec vitest run --coverage=false --reporter=dot tests/unit/landing-public-content.test.ts tests/unit/i18n.test.ts tests/unit/i18n-encoding.test.ts`: OK, 3 archivos y 40 tests.
- `corepack pnpm launch:content`: OK, resumen `outputs/launch-content/2026-06-26T11-41-57-788Z/summary.md`.
- `corepack pnpm typecheck`: OK.
- `corepack pnpm lint`: OK.

Estado:

- La promesa "solicitud revisada antes de compra/pago" queda mas consistente tambien para lectores de pantalla en ingles y ruso.
- No se toca Stripe, Supabase remoto, secretos ni servicios externos.

## Avance Implementado 2026-06-26, Quincuagesimo Corte

Quincuagesimo corte integrado: las oportunidades reactivadas cierran tareas antiguas de posposicion.

Archivos:

- `src/pages/api/admin/leads.ts`
- `src/pages/api/admin/crm/contact-actions.ts`
- `tests/api/admin-leads.test.ts`
- `tests/api/admin-crm-contact-actions.test.ts`
- `docs/launch/FUNCTIONAL_GAP_ROADMAP.md`

Queda hecho:

- Si una oportunidad estaba en `nurture` y se mueve a otra etapa, se cierran las tareas abiertas/snoozed de posposicion asociadas a esa oportunidad.
- El cierre se aplica tanto desde la API de solicitudes admin como desde la API de ficha CRM/contacto.
- Las tareas terminales del lead siguen cerrandose al ganar/perder, y la tarea de posposicion sigue creandose o reactivandose cuando la nueva etapa es `nurture`.
- Esto evita que Alin o su socio vean una tarea "Revisar lead pospuesto" cuando el lead ya volvio a propuesta, gano o se perdio.

Evidencia:

- `corepack pnpm exec vitest run --coverage=false --reporter=dot tests/api/admin-leads.test.ts tests/api/admin-crm-contact-actions.test.ts`: OK, 2 archivos y 34 tests.
- `corepack pnpm typecheck`: OK.
- `corepack pnpm lint`: OK.
- `git diff --check -- src/pages/api/admin/leads.ts src/pages/api/admin/crm/contact-actions.ts tests/api/admin-leads.test.ts tests/api/admin-crm-contact-actions.test.ts`: OK.

Estado:

- El flujo comercial queda mas limpio para operacion diaria: posponer ya genera seguimiento, pero reactivar la oportunidad tambien limpia ese seguimiento pendiente.
- No se toca Supabase remoto, Stripe, secretos ni servicios externos.

## Avance Implementado 2026-06-26, Quincuagesimo Primer Corte

Quincuagesimo primer corte integrado: la ficha CRM/contacto ya limpia leads y tareas con la misma politica que la pantalla de solicitudes.

Archivos:

- `src/pages/api/admin/crm/contact-actions.ts`
- `tests/api/admin-crm-contact-actions.test.ts`
- `docs/launch/FUNCTIONAL_GAP_ROADMAP.md`

Queda hecho:

- Al cambiar una oportunidad desde la ficha CRM, el lead legado se sincroniza con el mismo constructor de estado que usa `admin/leads`.
- Si la oportunidad se marca como `won`, el lead queda `contacted`, se borra `level_check_context`, se registra `level_check_raw_cleared_at` y se cierran tareas terminales del lead.
- Si la oportunidad se marca como `lost`, el lead queda `discarded` y pasa por la misma limpieza de contexto crudo de diagnostico.
- Si la oportunidad avanza a una etapa comercial activa, se cierra la tarea inicial de revision del lead.
- Se mantiene la limpieza de tareas de oportunidad pospuesta cuando una oportunidad sale de `nurture`.

Evidencia:

- `corepack pnpm exec vitest run --coverage=false --reporter=dot tests/api/admin-crm-contact-actions.test.ts`: OK, 18 tests.
- `corepack pnpm exec vitest run --coverage=false --reporter=dot tests/api/admin-leads.test.ts tests/api/admin-crm-contact-actions.test.ts`: OK, 2 archivos y 35 tests.
- `corepack pnpm typecheck`: OK.
- `corepack pnpm lint`: OK.
- `corepack pnpm launch:content`: OK, 0 failed y 0 warnings.
- `git diff --check -- src/pages/api/admin/crm/contact-actions.ts tests/api/admin-crm-contact-actions.test.ts`: OK.
- `corepack pnpm launch:status`: BLOCKED esperado, 9 blockers, 0 warnings y 8 Open Go/No-Go por evidencias/final-only.

Estado:

- El riesgo de operar desde dos pantallas distintas queda reducido: cambiar etapa desde Leads o desde la ficha CRM ya no deja diagnosticos crudos ni tareas terminales abiertas de forma inconsistente.
- No se toca Supabase remoto, Stripe, secretos ni servicios externos.

## Avance Implementado 2026-06-26, Quincuagesimo Segundo Corte

Quincuagesimo segundo corte integrado: cancelacion de primera clase pendiente refresca el onboarding CRM.

Archivos:

- `src/lib/crm/onboarding.ts`
- `src/pages/api/calendar/session-action.ts`
- `tests/unit/crm-onboarding.test.ts`
- `tests/api/session-action.test.ts`
- `docs/launch/FUNCTIONAL_GAP_ROADMAP.md`

Queda hecho:

- Si una sesion pendiente de primera clase se cancela antes de la activacion, la tarea abierta de onboarding pasa a `Reschedule first class and materials`.
- La tarea queda con SLA 24h, conserva contexto anterior y registra `first_class_cancelled`, `reschedule_required`, `cancelled_session_id`, `cancelled_by`, `cancellation_reason`, profesor, hora prevista y suscripcion.
- La actualizacion solo ocurre cuando la tarea abierta de onboarding corresponde a esa sesion o aun no tenia `session_id`; si la clase cancelada no es la primera clase rastreada, no se reescribe el onboarding.
- El endpoint de cancelacion de sesiones llama a este circuito despues de registrar la actividad CRM de clase cancelada y restaurar cuota cuando corresponde.

Evidencia:

- `corepack pnpm exec vitest run --coverage=false --reporter=dot tests/unit/crm-onboarding.test.ts tests/api/session-action.test.ts`: OK, 2 archivos y 21 tests.
- `corepack pnpm typecheck`: OK.
- `corepack pnpm lint`: OK.
- `corepack pnpm launch:content`: OK, 0 failed y 0 warnings.
- `git diff --check -- src/lib/crm/onboarding.ts src/pages/api/calendar/session-action.ts tests/unit/crm-onboarding.test.ts tests/api/session-action.test.ts`: OK, solo warning conocido de CRLF/LF en `tests/api/session-action.test.ts`.
- `corepack pnpm launch:status`: BLOCKED esperado, 9 blockers, 0 warnings y 8 Open Go/No-Go por evidencias/final-only.

Estado:

- El onboarding post-pago queda mas resistente ante un caso muy probable: primera clase agendada, materiales en preparacion y cancelacion antes de activacion.
- No se toca Supabase remoto, Stripe, secretos ni servicios externos.

## Avance Implementado 2026-06-26, Quincuagesimo Tercer Corte

Quincuagesimo tercer corte integrado: el gestor admin de emails ya expone todos los previews transaccionales v1.

Archivos:

- `src/components/admin/EmailTemplateManager.tsx`
- `tests/api/email-send-test.test.ts`
- `tests/unit/email-templates.test.ts`
- `docs/launch/FUNCTIONAL_GAP_ROADMAP.md`

Queda hecho:

- La pantalla admin de emails incluye `support-updated`, que ya existia en backend y en la matriz de emails pero no aparecia en el selector.
- El componente deja de duplicar manualmente la union de tipos y usa `EmailPreviewType` como type-only import desde `src/lib/email/previews.ts`.
- El test del endpoint `/api/email/send-test` cubre envio de prueba de `support-updated`.
- El test unitario de templates comprueba que todo tipo definido en `emailPreviewTypes` este expuesto en el gestor admin.

Evidencia:

- `corepack pnpm exec vitest run --coverage=false --reporter=dot tests/unit/email-templates.test.ts tests/api/email-send-test.test.ts`: OK, 2 archivos y 15 tests.
- `corepack pnpm typecheck`: OK.
- `corepack pnpm lint`: OK.
- `corepack pnpm launch:content`: OK, 0 failed y 0 warnings.
- `git diff --check -- src/components/admin/EmailTemplateManager.tsx tests/api/email-send-test.test.ts tests/unit/email-templates.test.ts`: OK.
- `corepack pnpm launch:status`: BLOCKED esperado, 9 blockers, 0 warnings y 8 Open Go/No-Go por evidencias/final-only.

Estado:

- Emails transaccionales v1 quedan mejor verificables desde admin: solicitud, bienvenida, clase, recordatorio, cancelacion, diagnostico, follow-up comercial y soporte recibido/actualizado.
- No se toca Resend real, secretos ni servicios externos.

## Avance Implementado 2026-06-26, Quincuagesimo Cuarto Corte

Quincuagesimo cuarto corte integrado: la ficha CRM separa operacion v1 de marketing diferido.

Archivos:

- `src/components/admin/CrmContactActions.tsx`
- `tests/unit/crm-contact-actions.test.tsx`
- `docs/launch/FUNCTIONAL_GAP_ROADMAP.md`

Queda hecho:

- La comunicacion manual de la ficha CRM permite ventas, soporte y transaccional, pero ya no ofrece `Marketing` como finalidad operativa v1.
- El sistema conserva consentimiento/opt-out de marketing en CRM para cumplimiento y futuro, pero la UI diaria no sugiere campanas ni comunicaciones marketing mientras esa capa siga diferida.
- La prueba de `CrmContactActions` protege que `Marketing` no vuelva al selector operativo por accidente.

Evidencia:

- `corepack pnpm exec vitest run --coverage=false --reporter=dot tests/unit/crm-contact-actions.test.tsx tests/unit/crm-consent-manager.test.tsx`: OK, 2 archivos y 4 tests.
- `corepack pnpm typecheck`: OK.
- `corepack pnpm lint`: OK.
- `corepack pnpm launch:content`: OK, 0 failed y 0 warnings.
- `git diff --check -- src/components/admin/CrmContactActions.tsx tests/unit/crm-contact-actions.test.tsx`: OK.
- `corepack pnpm launch:status`: BLOCKED esperado, 9 blockers, 0 warnings y 8 Open Go/No-Go por evidencias/final-only.

Estado:

- La separacion entre transaccional, soporte, sales follow-up y marketing queda menos ambigua para uso diario.
- No se toca Resend real, secretos, campanas ni servicios externos.

## Onboarding Post-Pago Recomendado

Aunque Stripe live quede para el final, el camino post-pago debe quedar disenado y probado con mocks/staging:

- Acceso al campus inmediatamente.
- Carpeta/materiales creados antes de la primera clase.
- Email de bienvenida claro, humano y breve.
- Tarea interna para asignar profesor y revisar disponibilidad.
- Primera clase agendada manualmente, respetando disponibilidad real.
- Clases largas: 50 minutos por defecto. La llamada puede durar algo mas, pero nunca debe cortarse automaticamente.
- Recordatorio antes de clase.
- Soporte visible desde campus.
- Senal CRM de "primera clase pendiente" y despues "primera clase completada".

Primeras 24 horas ideales:

- El alumno sabe que su plaza esta recibida/activada.
- Tiene acceso al campus.
- Sabe que la primera clase se coordina manualmente.
- Tiene carpeta/materiales iniciales o confirmacion de que se preparan antes de clase.
- Puede escribir a soporte sin buscar contacto.

## Manual Vs Automatico

Automatizar ahora:

- Confirmaciones transaccionales.
- Avisos internos.
- Creacion de tareas CRM.
- Registro de actividad.
- Recordatorios.
- Estados derivados obvios.

Mantener humano ahora:

- Aceptar/rechazar/posponer leads.
- Recomendar plan final.
- Evaluar diagnostico.
- Asignar profesor.
- Agendar primera clase.
- Enviar propuesta personalizada si hay matices.

No automatizar sin revision humana:

- Rechazos definitivos.
- Diagnosticos de nivel como decision final.
- Cambios de precio/oferta.
- Comunicaciones sensibles o conflictivas.
- Acciones con datos personales sensibles.
- Cobros reales.

## Metric Dashboard Recomendado

- Leads nuevos.
- Leads sin respuesta >24h.
- Leads por estado.
- Diagnosticos enviados y recibidos.
- Seguimientos comerciales pendientes.
- Revisiones de diagnostico pendientes.
- Propuestas enviadas.
- Leads ganados/perdidos/pospuestos.
- Primera clase pendiente.
- Clases proximas.
- Pagos fallidos, cuando Stripe real exista.
- Soporte abierto.

## Final-Only Deliberado

Estos elementos no deben bloquear el trabajo funcional previo, pero si deben bloquear el lanzamiento real:

- Legal real: datos del titular/controlador, textos finales y revision humana.
- Stripe live: modo real, productos/precios definitivos, webhook live, customer portal y prueba con dinero real si se decide.
- Fuente premium rusa: comprar/instalar la misma fuente con soporte Cyrillic y verificar que no hay fallback visual.
- Secretos y servicios externos: claves reales, Worker production, Google Workspace production, Resend production, Turnstile production y Sentry production.
- Dominio/SEO final: Search Console, indexacion real, Core Web Vitals reales y revision de snippets tras copy/legal/pagos.
- Supabase final: advisor review, backup/export o upgrade si procede.
- Smoke production: recorrido final con dominio real y servicios reales.

## Preguntas Que Quedan, No Bloqueantes Para Empezar

- Que nivel minimo se acepta para el programa principal: A2, B1 u otro.
- Si el checkout debe ser totalmente privado/invite-only hasta cerrar encaje.
- Si las muestras de nivel se guardan solo para alumnos aceptados o tambien para leads.
- Si los emails criticos para RU deben salir en ruso desde el lanzamiento o si ingles sirve como v1.
- Si Alin y el socio necesitan owner asignado desde ya o si basta con cola compartida.

## Primer Corte Recomendado

Ejecutar FG-01 a FG-04 antes de escribir mas UI grande. Esos cuatro pasos definen el sistema operativo: que pasa, quien lo recibe, que se envia, que queda registrado y que no debe automatizarse todavia.

## Avance Implementado 2026-06-26, Quincuagesimo Quinto Corte

Quincuagesimo quinto corte integrado: los no-shows pendientes ya son visibles en el pulso operativo admin.

Archivos:

- `src/lib/crm/admin-dashboard.ts`
- `src/pages/[lang]/campus/admin/index.astro`
- `tests/unit/crm-admin-dashboard.test.ts`

Cambio:

- Las tareas CRM abiertas o pospuestas relacionadas con `session_no_show` ya se cuentan como `noShowFollowUpPending`.
- El centro de mando admin muestra el contador "No-shows pendientes" junto al resto del pulso comercial y operativo.
- La prueba del dashboard valida que la consulta filtra `crm_tasks.status IN ('open', 'snoozed')` y `related_entity_type = 'session_no_show'`.
- No se cambia la regla de negocio: el no-show sigue consumiendo la sesion ya programada y requiere seguimiento humano.
- No se toca Supabase remoto, Stripe, secretos ni servicios externos.

Evidencia:

- `corepack pnpm exec vitest run --coverage=false --reporter=dot tests/unit/crm-admin-dashboard.test.ts`: OK, 1 archivo y 3 tests.
- `corepack pnpm exec vitest run --coverage=false --reporter=dot tests/unit/crm-admin-dashboard.test.ts tests/unit/crm-onboarding.test.ts`: OK, 2 archivos y 12 tests.
- `corepack pnpm typecheck`: OK.
- `corepack pnpm lint`: OK.
- `corepack pnpm launch:content`: OK, 0 fallos y 0 warnings.
- `corepack pnpm launch:status`: BLOCKED esperado, 9 blockers final-only/manuales, 0 warnings y 8 Go/No-Go abiertos.

## Avance Implementado 2026-06-26, Sexagesimo Primer Corte

Sexagesimo primer corte integrado: el bloqueo de `database_readiness` ya no se trata como simple evidencia caducada, sino como drift real de Supabase production.

Archivos:

- `docs/launch/MANUAL_EVIDENCE.local.json`
- `docs/launch/RC_EVIDENCE_REFRESH.md`
- `docs/launch/FUNCTIONAL_GAP_ROADMAP.md`
- `scripts/launch/operations-audit.ts`
- `scripts/launch/status.ts`
- `tests/unit/operations-runbook.test.ts`

Cambio:

- Se hizo revision read-only con el conector de Supabase, sin escribir SQL ni tocar datos.
- Se confirmaron dos proyectos separados y activos: `espanol-staging` y `espanol-honesto`.
- Los logs Postgres recientes de production `espanol-honesto` muestran errores por columnas ausentes en `public.leads`: `current_level` y `level_check_status`.
- El codigo actual espera esas columnas en solicitud de plaza, diagnostico ligero, CRM admin y dashboard.
- La evidencia local deja `database_readiness` como `pending` con el motivo real, en vez de conservar un `pass` viejo/caducado.
- `RC_EVIDENCE_REFRESH.md` ahora advierte que no basta refrescar `verifiedAt`: hay que aplicar/verificar migraciones o decidir explicitamente que production queda fuera del RC.
- `launch:operations` genera ahora `hosted-schema-drift-worksheet.md` y `hosted-schema-check.sql`, una comprobacion de solo metadata contra `information_schema`/`pg_indexes` para detectar tablas, columnas e indices criticos que falten en Supabase alojado sin leer filas privadas.
- `launch:status` ya no afirma que Supabase/Cloudflare estan plenamente verificados cuando `database_readiness` u `operations_external` siguen abiertos; ahora el texto de "Already proven" queda condicionado al estado real.
- La prueba de runbook protege que la guia RC siga mencionando el drift de `leads.current_level` y `leads.level_check_status`, que apunte a la SQL segura generada y que el dashboard conserve esos textos condicionados.
- No se aplican migraciones, no se escribe en Supabase remoto, no se tocan secretos y no se alteran datos alojados.

Evidencia:

- Supabase project list read-only: `espanol-staging` (`mzjyvmlxfpzdfdjzxxyj`) y `espanol-honesto` (`vkkahxsybhbutszerawz`) aparecen `ACTIVE_HEALTHY`.
- Supabase Postgres logs read-only de production: errores recientes `column leads.current_level does not exist` y `column leads.level_check_status does not exist`.
- Migraciones locales relacionadas: `supabase/migrations/018_enrich_leads_for_application.sql` y `supabase/migrations/20260625215008_add_lightweight_level_check_to_leads.sql`.
- `corepack pnpm launch:operations`: OK y genera `hosted-schema-drift-worksheet.md` / `hosted-schema-check.sql`.
- `corepack pnpm exec vitest run --coverage=false --reporter=dot tests/unit/operations-runbook.test.ts`: OK, 1 archivo y 7 tests.
- `corepack pnpm typecheck`: OK.
- `corepack pnpm launch:content`: OK.

Consecuencia:

- El siguiente desbloqueo real de RC no es codigo de producto ni Stripe: es ejecutar la SQL segura contra el proyecto elegido, cerrar drift de Supabase production si procede con confirmacion explicita de escritura remota, backup/postura Supabase Free y verificacion posterior.
- `operations_external` sigue pendiente de refresco manual/no secreto de Cloudflare Fulfillment Worker staging, Resend staging, cron/logs, job recovery y rollback.

## Avance Implementado 2026-06-26, Sexagesimo Segundo Corte

Sexagesimo segundo corte integrado: los gates de Fase 1 ya guian el desbloqueo de Supabase hacia la SQL segura de schema alojado.

Archivos:

- `scripts/launch/status.ts`
- `scripts/launch/manual-evidence-audit.ts`
- `tests/unit/operations-runbook.test.ts`
- `docs/launch/FUNCTIONAL_GAP_ROADMAP.md`

Cambio:

- `launch:status` ya no propone solo documentar backup/postura Free para `database_readiness`; ahora pide ejecutar `hosted-schema-check.sql` contra el proyecto Supabase elegido, resolver o explicar objetos criticos ausentes y despues registrar backup/migraciones/RLS.
- `launch:manual-evidence` y su `phase-1-closure-pack.md` incluyen como next action la SQL generada por `launch:operations`.
- La evidencia recomendada ya incluye `hosted-schema-drift-worksheet.md` y una nota de resultado agregada, sin filas privadas ni secretos.
- La prueba de runbook protege que el dashboard conserve ese siguiente paso.
- No se escribe en Supabase remoto ni se aplican migraciones.

Evidencia:

- `corepack pnpm exec vitest run --coverage=false --reporter=dot tests/unit/operations-runbook.test.ts`: OK, 1 archivo y 7 tests.
- `corepack pnpm typecheck`: OK.
- `corepack pnpm lint`: OK.
- `corepack pnpm launch:manual-evidence`: FAILED esperado, 8 fallos por checks manuales/final-only; `database_readiness` ahora lista `hosted-schema-check.sql` como accion.
- `corepack pnpm launch:phase1`: BLOCKED esperado, 2 checks abiertos (`database_readiness`, `operations_external`).
- `corepack pnpm launch:status`: BLOCKED esperado, 9 blockers, 0 warnings y 8 Go/No-Go abiertos.

## Avance Implementado 2026-06-26, Sexagesimo Tercer Corte

Sexagesimo tercer corte integrado: el cierre de drift Supabase tiene plan de aplicacion/verificacion, no solo deteccion.

Archivos:

- `scripts/launch/operations-audit.ts`
- `tests/unit/operations-runbook.test.ts`
- `docs/launch/RC_EVIDENCE_REFRESH.md`
- `docs/launch/FUNCTIONAL_GAP_ROADMAP.md`

Cambio:

- `launch:operations` genera ahora `hosted-schema-closure-plan.md`.
- El plan incluye guardrails, preflight read-only, orden candidato de migraciones, verificacion posterior y plantilla de evidencia no secreta.
- La guia RC apunta al plan con placeholder de timestamp para no fijar rutas caducables.
- La prueba de runbook exige que el audit y la guia mantengan `hosted-schema-check.sql`, `hosted-schema-drift-worksheet.md` y `hosted-schema-closure-plan.md`.
- No se escribe en Supabase remoto ni se aplican migraciones.

Evidencia:

- `corepack pnpm launch:operations`: OK, genera `hosted-schema-closure-plan.md`.
- `corepack pnpm exec vitest run --coverage=false --reporter=dot tests/unit/operations-runbook.test.ts`: OK, 1 archivo y 7 tests.
- `corepack pnpm typecheck`: OK.
- `corepack pnpm lint`: OK.
- `corepack pnpm launch:manual-evidence`: FAILED esperado, 8 fallos por checks manuales/final-only.
- `corepack pnpm launch:phase1`: BLOCKED esperado, 2 checks abiertos.
- `corepack pnpm launch:status`: BLOCKED esperado, 9 blockers, 0 warnings y 8 Go/No-Go abiertos.

## Avance Implementado 2026-06-26, Quincuagesimo Noveno Corte

Quincuagesimo noveno corte integrado: higiene tecnica automatica revalidada sin limpieza destructiva.

Archivos:

- `docs/launch/CLEANUP.md`
- `docs/launch/FUNCTIONAL_GAP_ROADMAP.md`

Cambio:

- `launch:cleanup` se reejecuto y queda documentado con evidencia fresca.
- `secrets:check` pasa sin secretos obvios en archivos trackeados/no ignorados.
- La decision sobre `.agent/` y `.agents/` sigue explicitamente humana: mantener durante launch o mover/borrar despues con backup/commit separado.
- No se borra, mueve ni revierte trabajo del arbol Git sucio.
- No se toca ningun servicio externo ni secreto real.

Evidencia:

- `corepack pnpm launch:cleanup`: OK, 0 fallos y 0 warnings.
- `corepack pnpm secrets:check`: OK.
- `corepack pnpm launch:content`: OK, 0 fallos y 0 warnings.

## Avance Implementado 2026-06-26, Sexagesimo Corte

Sexagesimo corte integrado: la agenda manual ya solo registra onboarding de primera clase cuando la suscripcion aun no tenia sesiones usadas.

Archivos:

- `src/pages/api/calendar/sessions.ts`
- `src/pages/api/calendar/bulk-sessions.ts`
- `src/pages/api/calendar/recurring-sessions.ts`
- `tests/api/sessions-create.test.ts`

Cambio:

- Las rutas de agenda individual, bulk y recurrente calculan `shouldRecordFirstClass` desde `sessions_used === 0`.
- Si la suscripcion ya tenia sesiones usadas, la clase se agenda, consume cuota y registra actividad CRM normal, pero no reabre ni crea trabajo de "primera clase".
- Si es la primera sesion de la suscripcion, se mantiene el comportamiento esperado: CRM onboarding se refresca con la sesion agendada.
- El flujo sigue siendo manual y reversible: no se toca Google/Resend real si las integraciones externas estan deshabilitadas.
- No se toca Supabase remoto, Stripe, secretos ni servicios externos.

Evidencia:

- `corepack pnpm exec vitest run --coverage=false --reporter=dot tests/api/sessions-create.test.ts tests/api/bulk-sessions.test.ts tests/api/recurring-sessions.test.ts`: OK, 3 archivos y 25 tests.
- `corepack pnpm typecheck`: OK.
- `corepack pnpm lint`: OK.
- `corepack pnpm launch:content`: OK, 0 fallos y 0 warnings.
- `corepack pnpm launch:status`: BLOCKED esperado, 9 blockers final-only/manuales, 0 warnings y 8 Go/No-Go abiertos.
- `corepack pnpm exec vitest run --coverage=false --reporter=dot tests/unit/operations-runbook.test.ts`: OK, 1 archivo y 7 tests.
- `corepack pnpm typecheck`: OK.
- `corepack pnpm lint`: OK.
- `corepack pnpm launch:content`: OK, 0 fallos y 0 warnings.

## Avance Implementado 2026-06-26, Quincuagesimo Octavo Corte

Quincuagesimo octavo corte integrado: los enlaces reales de diagnostico enviados desde admin pre-rellenan el email del lead.

Archivos:

- `src/pages/api/admin/leads.ts`
- `tests/api/admin-leads.test.ts`
- `docs/launch/EMAIL_MATRIX.md`
- `docs/launch/LEVEL_CHECK.md`

Cambio:

- `buildDiagnosticUrl` ahora genera `/{lang}/diagnostico?email=...` usando el email normalizado del lead.
- La invitacion de diagnostico y el email de "falta informacion" usan ese enlace pre-rellenado.
- Esto reduce friccion para el lead y evita duplicar solicitudes si escribe mal o con otra capitalizacion el email.
- El formulario ya soportaba leer `email` desde querystring; ahora el trigger real queda alineado con ese comportamiento.
- No se cambia el flujo de retencion: el crudo sigue en `leads.level_check_context` solo hasta revision/descarte/ganado.
- No se toca Supabase remoto, Resend real, Stripe, secretos ni servicios externos.

Evidencia:

- `corepack pnpm exec vitest run --coverage=false --reporter=dot tests/api/admin-leads.test.ts tests/api/level-check.test.ts tests/unit/crm-level-check.test.ts`: OK, 3 archivos y 22 tests.
- `corepack pnpm typecheck`: OK.
- `corepack pnpm lint`: OK.
- `corepack pnpm launch:content`: OK, 0 fallos y 0 warnings.
- `corepack pnpm launch:status`: BLOCKED esperado, 9 blockers final-only/manuales, 0 warnings y 8 Go/No-Go abiertos.

## Avance Implementado 2026-06-26, Quincuagesimo Septimo Corte

Quincuagesimo septimo corte integrado: los retries de bienvenida post-pago refrescan el onboarding CRM sin duplicar trabajo ni degradar tareas avanzadas.

Archivos:

- `src/lib/crm/onboarding.ts`
- `tests/unit/crm-onboarding.test.ts`

Cambio:

- Si ya existe una tarea abierta de onboarding post-pago, el helper la reutiliza y refresca `due_at`, `status`, `updated_at` y metadata operativa.
- La metadata previa se conserva y se completa con paquete, carpeta Drive, email de bienvenida, materiales antes de clase y cola compartida.
- Si la tarea ya estaba avanzada a "primera clase programada", un retry de bienvenida no la rebaja a "coordinar primera clase"; conserva el vencimiento de materiales antes de clase.
- No se duplica actividad CRM ya existente.
- No se toca Google real, Resend real, Supabase remoto, Stripe, secretos ni servicios externos.

Evidencia:

- `corepack pnpm exec vitest run --coverage=false --reporter=dot tests/unit/crm-onboarding.test.ts tests/unit/fulfillment-jobs.test.ts`: OK, 2 archivos y 18 tests.
- `corepack pnpm typecheck`: OK.
- `corepack pnpm lint`: OK.
- `corepack pnpm launch:content`: OK, 0 fallos y 0 warnings.
- `corepack pnpm launch:status`: BLOCKED esperado, 9 blockers final-only/manuales, 0 warnings y 8 Go/No-Go abiertos.

## Avance Implementado 2026-06-26, Quincuagesimo Sexto Corte

Quincuagesimo sexto corte integrado: el panel admin de leads ya muestra errores accionables devueltos por la API.

Archivos:

- `src/components/admin/LeadManager.tsx`
- `tests/unit/lead-manager-source.test.ts`

Cambio:

- Las acciones admin de leads leen el campo `error` de la respuesta JSON cuando la API devuelve fallo.
- Esto evita ocultar motivos operativos importantes como opt-out, consentimiento ausente, CRM no listo, fallo de diagnostico o error al mover etapa CRM.
- La regla de negocio no cambia: la API sigue bloqueando emails comerciales si no puede verificar consentimiento de `sales_follow_up`.
- No se toca Resend real, Supabase remoto, Stripe, secretos ni servicios externos.

Evidencia:

- `corepack pnpm exec vitest run --coverage=false --reporter=dot tests/unit/lead-manager-source.test.ts tests/api/admin-leads.test.ts`: OK, 2 archivos y 24 tests.
- `corepack pnpm typecheck`: OK.
- `corepack pnpm lint`: OK.
- `corepack pnpm launch:content`: OK, 0 fallos y 0 warnings.
- `corepack pnpm launch:status`: BLOCKED esperado, 9 blockers final-only/manuales, 0 warnings y 8 Go/No-Go abiertos.
