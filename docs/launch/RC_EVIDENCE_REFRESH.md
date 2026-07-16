# RC Evidence Refresh

Estado: histórico. Esta guía conserva el cierre de los antiguos scopes de staging `database_readiness` y `operations_external`; no es una fuente de estado actual ni debe reutilizar sus conteos, URLs Pages o aprobaciones.

Fuente viva: ejecutar `pnpm launch:status` y seguir `production_inert_preparation`. Desde 2026-07-16 Fase 1/staging están cerrados; el trabajo RC restante es Cloudflare production en bootstrap inerte más Supabase production/Auth/disponibilidad. Legal real, Stripe Live, proveedores activos, DNS, SEO/LLM y smoke siguen final-only.

Estado que debe comprobarse antes de cerrar:

- `corepack pnpm launch:phase1`: `BLOCKED` por 2 evidencias manuales/externas abiertas.
- `corepack pnpm launch:rc`: `RC_BLOCKED_BY_PHASE_1`.
- `corepack pnpm launch:status`: usar la ultima salida real como fuente de verdad; el refresh estricto de 2026-07-03 queda en `BLOCKED`, 6 blockers, 0 warnings, 7 Open Go/No-Go.
- RC no se puede congelar mientras sigan abiertos `database_readiness` u `operations_external`.
- `no_real_payments_staging` esta cerrado en Cloudflare Pages staging mientras el deployed probe siga probando `403 Checkout is disabled`; si se redepliega o cambia runtime/config, repetir la verificacion. Si vuelve `400 priceId is required`, un guard local o un cambio sin desplegar no basta para cerrar RC.
- Revision Supabase read-only de 2026-06-26: staging `espanol-staging` y production `espanol-honesto` estan activos, pero ambos schemas alojados van por detras del codigo actual; production ademas muestra logs Postgres recientes por drift de schema en `public.leads` (`current_level` y `level_check_status` no existen).
- La fuente de verdad no es esta lista copiada: es la ultima salida real de `corepack pnpm launch:status` y el ultimo `phase-1-closure-pack.md` generado por `corepack pnpm launch:manual-evidence`.

## Corte Actual

Este corte resume la forma actual de leer el estado al reanudar el goal. No debe copiar timestamps concretos como fuente de verdad; ejecutar los comandos y usar el ultimo `<timestamp>` impreso por cada uno.

- Goal visible y goal durable `launch-viable-espanol-honesto`: alineados.
- `outputs/launch-status/<timestamp>/summary.md`: debe indicar `BLOCKED` hasta cerrar los scopes externos/final-only; en el refresh estricto de 2026-07-03 quedan 6 blockers, 0 warnings y 7 Open Go/No-Go.
- `outputs/launch-manual-evidence/<timestamp>/summary.md`: `FAILED` esperado mientras Fase 1 mantenga `database_readiness`/`operations_external` o Fase 3 mantenga checks final-only; en el refresh estricto de 2026-07-03 quedan 5 final-only.
- `outputs/launch-phase-1/<timestamp>/summary.md`: `BLOCKED` esperado por `database_readiness` y `operations_external`.
- `outputs/launch-staging-database-rollout/<timestamp>/summary.md`: debe quedar `OK` para el paquete local de schema/CRM staging, con `readyForStagingApproval=true` si ese scope sigue pendiente.
- `outputs/launch-supabase-security-rollout/<timestamp>/summary.md`: debe quedar `OK`; paquete local-only de `SEC-014`/`SEC-015` listo para approval, con manifest, bundle, SQL de verificacion y rollback.
- `outputs/launch-operations-external-closure/<timestamp>/summary.md`: `WARNING` esperado hasta revisar evidencia manual; requiere `readyForManualEvidenceReview=true` y `wranglerReadOnlyIncluded=true`.
- `outputs/launch-staging-no-real-payments-remediation/<timestamp>/summary.md`: `WARNING` aceptable por `local_deployment_gap` mientras el deployed probe siga OK con `403 Checkout is disabled`; `FAILED` reabre el scope.
- `outputs/launch-rc-external-closure/<timestamp>/next-approval.md`: siguiente approval atomico recomendado, actualmente `supabase_staging_schema_rollout` si Cloudflare Pages sigue OK.

Permisos separados, ninguno implicito:

- Cloudflare Pages staging: `outputs/launch-staging-no-real-payments-remediation/<timestamp>/approval-request.md`.
- Supabase schema/CRM staging: `outputs/launch-staging-database-rollout/<timestamp>/approval-request.md`.
- Supabase security `SEC-014`/`SEC-015`: `outputs/launch-supabase-security-rollout/<timestamp>/approval-request.md`.
- Operations evidence read-only: `outputs/launch-operations-external-closure/<timestamp>/approval-request.md`.

## Ultimo Refresh Local

Refresh local de apoyo ejecutado el 2026-06-26 despues de endurecer el contrato comercial y consolidar los bloqueos externos RC:

- `corepack pnpm typecheck`: OK.
- `corepack pnpm lint`: OK.
- `corepack pnpm test:run`: OK, 65 archivos y 402 tests.
- `corepack pnpm build`: OK.
- `corepack pnpm fulfillment:typecheck`: OK.
- `corepack pnpm launch:cleanup`: OK.
- `corepack pnpm launch:content`: OK.
- `corepack pnpm launch:seo`: OK.
- `corepack pnpm launch:payments`: OK.
- `corepack pnpm launch:functional-rc`: OK, 0 grupos fallidos. Usar el ultimo `outputs/launch-functional-rc/<timestamp>/summary.md`.
- `corepack pnpm launch:no-real-payments -- --deployed-url https://espanol-honesto-staging.pages.dev`: OK; staging devuelve `403 Checkout is disabled`.
- `corepack pnpm launch:staging-no-real-payments-remediation`: WARNING aceptable si solo queda `local_deployment_gap`; cerrar o mantener este warning depende de versionar/empaquetar la slice runtime antes de futuros redeploys. Usar el ultimo `outputs/launch-staging-no-real-payments-remediation/<timestamp>/staging-no-real-payments-remediation-pack.md`.
- `corepack pnpm launch:phase1`: BLOCKED esperado solo por `database_readiness` y `operations_external` hasta que haya evidencia externa fresca. Usar el ultimo `outputs/launch-phase-1/<timestamp>/summary.md`.
- `corepack pnpm launch:supabase-security-rollout`: OK esperado; genera el paquete local-only para `SEC-014`/`SEC-015`. Usar el ultimo `outputs/launch-supabase-security-rollout/<timestamp>/summary.md`.
- `corepack pnpm launch:rc-external-closure`: WARNING esperado con Cloudflare Pages OK y pendientes Supabase/operations si esos scopes siguen abiertos. Usar el ultimo `outputs/launch-rc-external-closure/<timestamp>/rc-external-closure-pack.md`.
- `corepack pnpm launch:status`: BLOCKED esperado mientras los final-only y externos sigan abiertos; usar el ultimo `outputs/launch-status/<timestamp>/summary.md` y no los numeros copiados en esta guia.

Este refresh prueba que el codigo local y el RC funcional mockeado siguen coherentes; no cierra por si solo ninguna evidencia externa.

## Bloqueos Antes De Congelar RC

Quedan dos checks inmediatos antes de congelar RC:

| Check | Motivo | Support audit |
| --- | --- | --- |
| `database_readiness` | Bloqueo real: staging y production Supabase no reflejan las migraciones actuales de leads/CRM/idiomas/diagnostico; production ya falla en logs. | `corepack pnpm launch:operations` OK, pero no sustituye migraciones remotas |
| `operations_external` | `verifiedAt` tiene mas de 14 dias. | `corepack pnpm launch:operations` OK |

Los support audits ya pasan. Para `operations_external`, lo que falta sigue siendo refrescar evidencia manual/no secreta de que el estado externo continua revisado. Para `database_readiness`, ya no basta refrescar evidencia: primero hay que resolver o explicar el drift de Supabase production.

Codex puede ejecutar los support audits y mantener esta guia alineada. Alin debe revisar los dashboards/estado real y decidir si la evidencia manual puede escribirse. No usar `--write` ni marcar `pass` si la revision externa concreta no se ha hecho.

## Que No Hay Que Tocar

- No activar Stripe live.
- No poner `CHECKOUT_ENABLED=true` salvo decision explicita.
- No rotar secretos.
- No escribir en Cloudflare, Supabase, Resend, Google, Stripe ni Sentry.
- No pegar claves, tokens, payloads, datos privados, screenshots con secretos ni URLs con parametros sensibles.
- No marcar `pass` sin revisar el dashboard/estado real correspondiente.

## Evidencia Local De Apoyo

Estos comandos son apoyo automatico; no sustituyen la revision externa:

```bash
corepack pnpm launch:operations
corepack pnpm launch:staging-operations
corepack pnpm launch:operations-external-closure
corepack pnpm launch:staging-db-rollout
corepack pnpm launch:supabase-security-rollout
corepack pnpm launch:staging-no-real-payments-remediation
corepack pnpm launch:rc-external-closure
corepack pnpm launch:security
corepack pnpm launch:cleanup
```

Para ampliar el preflight de operaciones con Wrangler en modo lectura:

```bash
corepack pnpm launch:staging-operations -- --include-wrangler
```

Rutas utiles despues de ejecutar los comandos:

- `outputs/launch-operations/<timestamp>/summary.md`
- `outputs/launch-operations/<timestamp>/database-readiness-worksheet.md`
- `outputs/launch-operations/<timestamp>/hosted-schema-drift-worksheet.md`
- `outputs/launch-operations/<timestamp>/hosted-schema-check.sql`
- `outputs/launch-operations/<timestamp>/hosted-schema-closure-plan.md`
- `outputs/launch-operations/<timestamp>/operations-readiness-worksheet.md`
- `outputs/launch-staging-operations-preflight/<timestamp>/summary.md`
- `outputs/launch-operations-external-closure/<timestamp>/operations-external-closure-pack.md`
- `outputs/launch-operations-external-closure/<timestamp>/operations-external-evidence-manifest.json`
- `outputs/launch-operations-external-closure/<timestamp>/manual-evidence-dry-run.txt`
- `outputs/resend-readonly-evidence/<timestamp>/summary.md` si se ejecuta `corepack pnpm launch:resend-readonly -- --env-file <staging-env-file>` con clave valida de staging/read-only.
- `outputs/launch-staging-database-rollout/<timestamp>/rollout-plan.md`
- `outputs/launch-staging-database-rollout/<timestamp>/staging-migration-bundle.sql`
- `outputs/launch-staging-database-rollout/<timestamp>/staging-migration-manifest.json`
- `outputs/launch-staging-database-rollout/<timestamp>/manual-evidence-dry-run.txt`
- `outputs/launch-supabase-security-rollout/<timestamp>/summary.md`
- `outputs/launch-supabase-security-rollout/<timestamp>/supabase-security-rollout-manifest.json`
- `outputs/launch-supabase-security-rollout/<timestamp>/supabase-security-migration-bundle.sql`
- `outputs/launch-supabase-security-rollout/<timestamp>/approval-request.md`
- `outputs/launch-supabase-security-rollout/<timestamp>/post-apply-verification.sql`
- `outputs/launch-supabase-security-rollout/<timestamp>/rollback.sql`
- `outputs/launch-supabase-security-rollout/<timestamp>/manual-evidence-dry-run.txt`
- `outputs/launch-staging-no-real-payments-remediation/<timestamp>/staging-no-real-payments-remediation-pack.md`
- `outputs/launch-staging-no-real-payments-remediation/<timestamp>/pages-staging-build-manifest.json`
- `outputs/launch-rc-external-closure/<timestamp>/rc-external-closure-pack.md`
- `outputs/launch-rc-external-closure/<timestamp>/approval-request.md`
- `outputs/launch-rc-external-closure/<timestamp>/next-approval.md`
- `outputs/launch-worktree/<timestamp>/rc-staging-package.md`
- `outputs/launch-worktree/<timestamp>/rc-staging-package-files.txt`
- `outputs/launch-worktree/<timestamp>/rc-staging-runtime-diff.patch`
- `outputs/launch-worktree/<timestamp>/rc-staging-runtime-manifest.json`
- `outputs/launch-manual-evidence/<timestamp>/phase-1-closure-pack.md`
- `outputs/launch-status/<timestamp>/summary.md`

Usar siempre el ultimo `<timestamp>` impreso por cada comando. Si se ejecuta una corrida nueva, no copiar evidencias antiguas solo porque aparezcan en este documento.

## Hoja Unica De Cierres Externos RC

Ejecutar:

```bash
corepack pnpm launch:rc-external-closure
```

Esto genera `outputs/launch-rc-external-closure/<timestamp>/rc-external-closure-pack.md`, `approval-request.md` y `next-approval.md`. Es local-only: no despliega, no cambia variables de Cloudflare, no aplica migraciones Supabase, no envia emails, no llama Stripe, no actualiza evidencia manual y no escribe secretos.

El pack consolida los objetivos staging-only de RC. En el estado actual, Cloudflare Pages debe aparecer `ok`; Supabase staging y operations evidence siguen pendientes:

- `cloudflare_pages_no_real_payments`: Cloudflare Pages project `espanol-honesto-staging`; cerrado con deployed probe `403 Checkout is disabled`. Si el manifiesto dice que `HEAD/deploy` no contiene el guard o se prepara un nuevo redeploy, revisar la slice minima, `pages-staging-build-manifest.json` y volver a comprobar con `corepack pnpm launch:no-real-payments -- --deployed-url https://espanol-honesto-staging.pages.dev`.
- `supabase_staging_schema_rollout`: Supabase `espanol-staging` (`mzjyvmlxfpzdfdjzxxyj`); aplicar/verificar migraciones de schema/CRM staging y repetir hosted schema check si ese scope sigue pendiente.
- `supabase_security_rollout`: Supabase `espanol-staging` (`mzjyvmlxfpzdfdjzxxyj`) primero y `espanol-honesto` (`vkkahxsybhbutszerawz`) solo despues de staging OK; aplicar/verificar `021`, `022` y `20260702124757` para `SEC-014`/`SEC-015`.
- `operations_external_evidence`: Worker fulfillment staging, Resend staging y Admin Jobs staging UI/runtime; cerrar con evidencia externa/no secreta. Admin Jobs staging UI/runtime depende de `database_readiness`: revisarlo despues de cerrar Supabase staging o registrar una aceptacion RC explicita de que la evidencia local UI/API/tests sustituye temporalmente esa comprobacion.

La hoja RC enlaza los packs especificos cuando existen: `outputs/launch-staging-no-real-payments-remediation/<timestamp>/approval-request.md` para Cloudflare checkout staging, `outputs/launch-staging-database-rollout/<timestamp>/approval-request.md` para Supabase schema/CRM staging, `outputs/launch-supabase-security-rollout/<timestamp>/approval-request.md` para `SEC-014`/`SEC-015` y `outputs/launch-operations-external-closure/<timestamp>/approval-request.md` para operations evidence. Si un approval especifico existe, usarlo como texto principal; el approval RC consolidado sirve para ver el mapa completo y evitar mezclar scopes. Para operations, revisar tambien `outputs/launch-operations-external-closure/<timestamp>/operations-external-evidence-manifest.json` antes de registrar evidencia manual.

Usar `outputs/launch-rc-external-closure/<timestamp>/next-approval.md` cuando se quiera avanzar de una accion en una accion: el archivo elige el primer item abierto, priorizando fallos antes que warnings, produce un texto de approval de un solo recurso y anade checklist de ejecucion con condiciones de parada.

Cada objetivo tiene su propio scope de aprobacion. Una aprobacion para Cloudflare Pages staging no autoriza Supabase, y una aprobacion para Supabase staging no autoriza operations evidence. `operations_external_evidence` es read-only por defecto; pedir permiso aparte antes de enviar un email de prueba, disparar un job o cambiar configuracion.

Antes de pedir approval Cloudflare, abrir el ultimo `outputs/launch-worktree/<timestamp>/rc-staging-package.md`, su lista plana `outputs/launch-worktree/<timestamp>/rc-staging-package-files.txt`, el diff review-only `outputs/launch-worktree/<timestamp>/rc-staging-runtime-diff.patch`, el manifest `outputs/launch-worktree/<timestamp>/rc-staging-runtime-manifest.json` y, si se va a desplegar build local, `outputs/launch-staging-no-real-payments-remediation/<timestamp>/pages-staging-build-manifest.json`: si `Current HEAD guard ready` es `no`, la accion correcta es empaquetar/deployar la slice minima antes de confiar en la variable `CHECKOUT_ENABLED=false`; si `readyForStagingDeployPackage` no es `true`, reconstruir antes de usar ese build.

Esta hoja no congela RC por si sola. Despues de cerrar el scope seleccionado, volver a ejecutar el comando de verificacion correspondiente y luego `corepack pnpm launch:phase1`, `corepack pnpm launch:rc` y `corepack pnpm launch:status`.

Confirmar solo el recurso exacto que se vaya a tocar. Quedan prohibidos desde este pack: writes o migraciones en Supabase production, cambios o deploys Cloudflare production, Stripe live, habilitar checkout real, legal real, secretos finales, dominio/Search Console y smoke production. Registrar solo evidencia agregada/no secreta: recurso, entorno, timestamp, resultado y path local; nunca claves, tokens, URLs privadas, filas privadas, payloads de email ni screenshots con datos personales.

## Refrescar `database_readiness`

Estado actual: bloqueado por drift de schema en staging y production.

Lectura de solo lectura hecha el 2026-06-26:

- `espanol-staging` (`mzjyvmlxfpzdfdjzxxyj`): proyecto separado, `ACTIVE_HEALTHY`, Postgres `17.6.1.063`.
- `espanol-honesto` (`vkkahxsybhbutszerawz`): proyecto separado, `ACTIVE_HEALTHY`, Postgres `17.6.1.063`.
- Migration history alojado:
  - staging muestra solo `012_support_tickets_and_class_duration` a `scope_admin_policies_to_authenticated`.
  - production muestra `000_initial_schema` a `scope_admin_policies_to_authenticated`.
- Metadata alojada:
  - staging `public.leads` mantiene solo columnas legacy y no tiene tablas CRM.
  - production `public.leads` mantiene solo columnas legacy y no tiene tablas CRM.
- Logs Postgres production recientes: errores repetidos `column leads.current_level does not exist` y `column leads.level_check_status does not exist`.
- El codigo actual espera esas columnas y tablas en solicitud, diagnostico, admin CRM, emails comerciales, onboarding post-pago, dashboard y tareas.
- El CLI local de Supabase existe (`2.107.0`), pero este repo no tiene `supabase/config.toml`; no hay proyecto linked. Cualquier `migration list`, `db push` o SQL remoto debe hacerse eligiendo explicitamente el proyecto/connection string fuera del repo y sin imprimir secretos.
- Las migraciones locales relacionadas son:
  - `supabase/migrations/018_enrich_leads_for_application.sql`
  - `supabase/migrations/019_capture_preferred_package_on_leads.sql`
  - `supabase/migrations/020_enforce_profile_role_links.sql`
  - `supabase/migrations/20260624163423_add_crm_core.sql`
  - `supabase/migrations/20260624185757_add_crm_task_related_entity.sql`
  - `supabase/migrations/20260625213116_capture_lead_languages.sql`
  - `supabase/migrations/20260625215008_add_lightweight_level_check_to_leads.sql`

Antes de marcar `database_readiness` como `pass`, hay que:

1. Confirmar explicitamente que se permite escribir primero en Supabase staging `espanol-staging` (`mzjyvmlxfpzdfdjzxxyj`) para el scope concreto que se vaya a tocar.
2. Ejecutar `corepack pnpm launch:staging-db-rollout` y revisar `outputs/launch-staging-database-rollout/<timestamp>/rollout-plan.md`, `outputs/launch-staging-database-rollout/<timestamp>/staging-migration-manifest.json`, `outputs/launch-staging-database-rollout/<timestamp>/approval-request.md` y `outputs/launch-staging-database-rollout/<timestamp>/manual-evidence-dry-run.txt`.
3. Ejecutar `corepack pnpm launch:supabase-security-rollout` y revisar `outputs/launch-supabase-security-rollout/<timestamp>/summary.md`, `outputs/launch-supabase-security-rollout/<timestamp>/supabase-security-rollout-manifest.json`, `outputs/launch-supabase-security-rollout/<timestamp>/approval-request.md`, `outputs/launch-supabase-security-rollout/<timestamp>/post-apply-verification.sql` y `outputs/launch-supabase-security-rollout/<timestamp>/rollback.sql` antes de tocar `SEC-014`/`SEC-015`.
4. Confirmar historial remoto con `supabase migration list --db-url <STAGING_DATABASE_URL>` o dashboard, manteniendo el URL fuera del repo. Si se usa CLI, hacer antes `supabase db push --dry-run --db-url <STAGING_DATABASE_URL>` y parar si quiere aplicar migraciones fuera de la lista del pack aprobado.
5. Aplicar/verificar en staging las migraciones completas en orden, no fragmentos sueltos, salvo que una inspeccion read-only demuestre que solo falta una reparacion idempotente estrecha.
6. Ejecutar la SQL de solo lectura generada en `outputs/launch-operations/<timestamp>/hosted-schema-check.sql` o copiada en `outputs/launch-staging-database-rollout/<timestamp>/post-write-hosted-schema-check.sql` contra staging. Para `SEC-014`/`SEC-015`, ejecutar ademas `outputs/launch-supabase-security-rollout/<timestamp>/post-apply-verification.sql`. Esas SQL solo consultan metadata (`information_schema`, `pg_indexes`, `pg_class`, `pg_policies`, `pg_proc`, triggers y privilegios), no datos de alumnos/leads.
7. Rerun de la app/checks en staging: solicitud, CRM admin, diagnostico ligero, emails comerciales mock/staging y onboarding post-pago sin cobros reales.
8. Confirmar explicitamente si production entra en el RC. Si entra, confirmar backup/export, Pro upgrade o riesgo aceptado segun `docs/launch/SUPABASE_BACKUP_RUNBOOK.md` antes de cualquier cambio destructivo o deployment production.
9. Aplicar/verificar production solo despues de esa confirmacion, rerun de la SQL read-only y comprobacion de logs sin errores `leads.current_level` / `leads.level_check_status`; para `SEC-014`/`SEC-015`, production solo despues de staging OK.
10. Seguir `outputs/launch-operations/<timestamp>/hosted-schema-closure-plan.md`, `outputs/launch-staging-database-rollout/<timestamp>/rollout-plan.md` y `outputs/launch-supabase-security-rollout/<timestamp>/summary.md` para decidir si se aplican migraciones completas en orden, una reparacion idempotente mas estrecha o si el entorno queda fuera del RC.

Revisar:

- Supabase staging y production son proyectos separados.
- Migraciones esperadas de `supabase/migrations/` estan aplicadas o la diferencia esta explicada.
- `db/schema.sql` sigue siendo la fuente oficial del schema.
- RLS revisado para tablas criticas: `profiles`, `profiles_private`, `payments`, `subscriptions`, `sessions`, `student_teachers`, `fulfillment_jobs`, `admin_audit_log`, `leads` y tablas CRM.
- Policies admin y privilegios `authenticated`/`service_role` revisados para tablas nuevas de CRM/diagnostico, teniendo en cuenta que Supabase puede no exponer tablas nuevas al Data API automaticamente.
- El pack `launch:staging-db-rollout` debe pasar `data_api_rls_grants_scan`: las tablas nuevas en `public` tienen RLS, policies y grants explicitos antes de pedir write externo.
- El pack `launch:supabase-security-rollout` debe pasar OK 0/0: confirma que `021`, `022` y `20260702124757` tienen scope estrecho, hashes, approval, verification SQL y rollback antes de pedir write externo para `SEC-014`/`SEC-015`.
- El `staging-migration-manifest.json` debe coincidir con el plan: target `espanol-staging`, hashes SHA-256, bundle hash, preflight, post-checks y scope prohibido. Si falta o no coincide, no pedir approval.
- `admin_audit_log` y `fulfillment_jobs` sirven para recuperacion/admin.
- Supabase Free no tiene backups programados nativos; backup/export final, Pro upgrade o accepted risk quedan para cierre final antes de cambios destructivos/production.
- Advisors frescos 2026-06-26: production mantiene `public.jobs` legacy con RLS sin policies, `btree_gist` en `public` y leaked-password protection desactivado; staging mantiene `btree_gist` en `public` y leaked-password protection desactivado. Clasificar cada item como fix ahora, accepted risk o post-launch/final-only antes de Go/No-Go.

Dry run para registrar evidencia despues de revisar:

Usar el `manual-evidence-dry-run.txt` generado por `launch:staging-db-rollout` como base del registro de `database_readiness`; ese dry run enlaza tambien el `staging-migration-manifest.json`. Para `SEC-014`/`SEC-015`, usar ademas el `manual-evidence-dry-run.txt` generado por `launch:supabase-security-rollout` y enlazar su manifest/verification SQL. Anadir `--write` solo despues de revisar el dry run, sustituir la nota generica por una nota concreta y confirmar que ya no hay drift de columnas en `public.leads` ni drift de RLS/trigger/webhook-state en los proyectos aprobados.

## Refrescar `operations_external`

Preflight read-only hecha el 2026-06-26:

- `corepack pnpm launch:staging-operations` deja un preflight reproducible de salud Worker staging, rechazo 401 de ruta interna sin autenticacion y configuracion local de cron/observability.
- `corepack pnpm launch:staging-operations -- --include-wrangler` anade, solo si se ejecuta explicitamente, `wrangler whoami`, `wrangler deployments status --env staging --json`, `wrangler versions view <active-version> --env staging --json`, `wrangler deployments list --env staging --json` y `wrangler secret list --env staging`, guardando logs redaccionados.
- `wrangler versions view <active-version> --env staging --json` se resume en evidencia no secreta: version activa y bindings por nombre/tipo, sin codigo fuente del Worker ni valores de secretos.
- Wrangler autenticado contra la cuenta Cloudflare de Alin y usado solo en modo lectura.
- `espanol-honesto-fulfillment-staging` lista deployments/versiones y tiene deployment actual 100% a version `025d4f6b-a46e-4ec6-8311-ca1cd2d6d726`, creado `2026-06-10T20:29:40.963366Z`.
- `wrangler secret list --env staging` confirma nombres esperados: `CRON_SECRET`, Google service/admin/folder/template, `INTERNAL_JOB_SECRET`, `PUBLIC_SITE_URL`, `PUBLIC_SUPABASE_URL`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `SUPABASE_SERVICE_ROLE_KEY`, `EMAIL_FROM`.
- `GET https://espanol-honesto-fulfillment-staging.alindev95.workers.dev/health` devuelve 200 con `ok: true`, `service: fulfillment-worker` y `runtime: cloudflare-workers`.
- `GET https://espanol-honesto-fulfillment-staging.alindev95.workers.dev/internal/jobs/process` sin autenticacion devuelve 401.
- Tests locales 2026-06-26 de recuperacion/admin jobs pasan para API admin, procesamiento de `fulfillment_jobs`, cliente interno Worker y fulfillment de sesiones.
- No se leyeron valores de secretos, no se hizo deploy, rollback, secret write/delete ni tail persistente.
- Esto es apoyo parcial: prueba configuracion local de cron, estado/deployments read-only y nombres de secrets, pero todavia no sustituye evidencia dashboard de Workers Logs/observability actual, Resend staging actual ni recuperacion Admin Jobs en staging/UI/runtime.

Revisar:

- Ejecutar `corepack pnpm launch:staging-operations` como apoyo reproducible y conservar el ultimo `outputs/launch-staging-operations-preflight/<timestamp>/summary.md`.
- Ejecutar `corepack pnpm launch:operations-external-closure` para reunir el cierre de `operations_external` y abrir `outputs/launch-operations-external-closure/<timestamp>/operations-external-closure-pack.md`, `outputs/launch-operations-external-closure/<timestamp>/operations-external-evidence-manifest.json`, `outputs/launch-operations-external-closure/<timestamp>/approval-request.md` y `outputs/launch-operations-external-closure/<timestamp>/manual-evidence-dry-run.txt`.
- Cloudflare Fulfillment Worker staging: servicio, deploy settings, secretos por nombre, logs y Pages-to-Worker URL alignment.
- `fulfillment_jobs`: procesamiento, retry/cancel/admin recovery y audit log. La comprobacion de Admin Jobs en staging UI/runtime debe hacerse despues de cerrar `database_readiness`; si Supabase staging sigue con drift, no marcarla como pass salvo aceptacion RC explicita del sustituto local.
- Resend staging: sender/domain, envio de prueba o evento visible, bounces/suppression si aplica.
- Para Resend por API, ejecutar `corepack pnpm launch:resend-readonly -- --env-file <staging-env-file>` antes de pedir captura manual. El script solo lista dominios/logs/emails agregados; no envia correos ni guarda claves, destinatarios, asuntos, cuerpos, ids completos ni payloads privados. Si devuelve 401/403 o `WARNING`, conservarlo como intento fallido y cerrar Resend con dashboard/captura redacted o aprobacion separada para test email.
- Cron/logs: `CRON_SECRET`, `INTERNAL_JOB_SECRET`, `FULFILLMENT_WORKER_URL`, site URL, trigger visible y logs visibles.
- Rollback: `docs/launch/RUNBOOK.md` sigue aplicando.
- Google Drive/template final y production Worker quedan final-only si tocarlos implica datos reales o production.

Separar permisos:

- Read-only por defecto: revisar Cloudflare Worker staging, Workers Logs/observability, Resend staging dashboard, Admin Jobs UI/runtime, Supabase Free posture y rollback baseline. Cron config/deployment/secret-name evidence queda cubierta por el preflight staging.
- Pedir permiso aparte antes de enviar un email de prueba, disparar cron, llamar rutas internas autenticadas, procesar/reintentar/cancelar jobs o cambiar config/variables/secrets/deployments.
- Parar si el recurso no es staging o si la evidencia expondria secretos, tokens, filas privadas, payloads de email o screenshots con datos personales.

Dry run para registrar evidencia despues de revisar:

Usar el `manual-evidence-dry-run.txt` generado por `launch:operations-external-closure` como base del registro de `operations_external`; ese dry run enlaza tambien `operations-external-evidence-manifest.json`. Anadir `--write` solo despues de revisar el dry run y sustituir la nota generica por una nota concreta de Cloudflare Workers Logs/observability, Resend staging y Admin Jobs staging UI/runtime despues de `database_readiness`, o por una aceptacion RC explicita del sustituto local si staging DB sigue no disponible.

## Verificacion Despues De Cerrar Scopes

Despues de cerrar los scopes inmediatos, con evidencia real/no secreta:

1. Cloudflare Pages staging sigue probando `403 Checkout is disabled` para `/api/create-checkout`.
2. `database_readiness` tiene Supabase staging aplicado/verificado y hosted schema check sin missing critico.
3. `operations_external` tiene Workers Logs/observability, Resend staging y Admin Jobs staging UI/runtime revisados o aceptados con alcance RC; cron config/deployment/secret-name evidence viene del preflight staging.
4. El tracker estricto no mantiene `SEC-*` abiertos; si `SEC-014` o `SEC-015` siguen abiertos, `launch:phase1` y `launch:rc` deben seguir bloqueados aunque la evidencia manual de Fase 1 este limpia.

Ejecutar:

```bash
corepack pnpm launch:manual-evidence
corepack pnpm launch:phase1
corepack pnpm launch:no-real-payments -- --deployed-url https://espanol-honesto-staging.pages.dev
corepack pnpm launch:rc-external-closure
corepack pnpm launch:rc
corepack pnpm launch:status
```

Resultado esperado:

- `launch:phase1`: `PHASE_1_READY` solo si no quedan `SEC-*` abiertos en `strict-qa-results.json`; con `SEC-014`/`SEC-015` abiertos debe quedar `BLOCKED`.
- `launch:no-real-payments`: sin fallo desplegado de staging; `/api/create-checkout` devuelve `403`.
- `launch:rc-external-closure`: sin fallo de `cloudflare_pages_no_real_payments` y sin warnings pendientes de Supabase/operations si ya se cerraron.
- `launch:rc`: `RC_READY_WITH_FINAL_BLOCKERS` solo despues de cerrar `SEC-*`; mientras sigan abiertos debe quedar `RC_BLOCKED_BY_PHASE_1`.
- `launch:status`: bloqueado solo por cierre final deliberado despues de cerrar `SEC-*`; antes debe listar `SEC-014`/`SEC-015` como blockers de Fase 1.

## Si No Se Puede Revisar Ahora

No marcar `pass`. Mantener el RC bloqueado y dejar estas tareas como trabajo inmediato:

- `database_readiness`
- `operations_external`
- `SEC-014` y `SEC-015` si el tracker estricto los conserva abiertos

El producto puede seguir avanzando en local/staging, pero no conviene declarar RC congelable hasta refrescar esta evidencia y cerrar/verificar los `SEC-*` del tracker canonico.
