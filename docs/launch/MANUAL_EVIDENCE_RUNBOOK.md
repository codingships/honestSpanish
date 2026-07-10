# Manual Evidence Runbook

Este runbook convierte los checks de `docs/launch/MANUAL_EVIDENCE.local.json` en pasos ejecutables. No sustituye `pnpm launch:manual-evidence`: solo explica como reunir evidencia suficiente sin copiar secretos.

Reglas:

- No pegar API keys, private keys, webhook secrets, service role keys, recovery codes ni datos completos de tarjetas/pagos.
- No pegar URLs con tokens, credenciales embebidas, query params sensibles, JWTs, URLs de base de datos con password ni cabeceras Bearer.
- Preferir referencias no sensibles: capturas sin secretos, paths locales, URLs de dashboards sin tokens, IDs parciales o notas manuales concretas.
- Cada check debe registrar `owner`, `verifiedAt`, `environment`, `summary` y al menos un item en `evidence`.
- Mantener `launchDecision` en `blocked` mientras cualquier check requerido este `pending` o `blocked`.
- Usar `accepted_risk` solo con `riskAcceptedBy`, `riskRationale` y `rollbackPlan`; no usarlo para cerrar Fase 1.
- Despues de actualizar evidencia de Fase 1, ejecutar `pnpm launch:phase1`; para cierre completo ejecutar despues `pnpm launch:manual-evidence`, `pnpm launch:secondary-review` y `pnpm launch:status`.
- Para priorizar, usar `docs/launch/LAUNCH_SEQUENCE.md`: separa checks que conviene cerrar ahora de legal/Stripe/keys/smoke final.
- Para la ventana real de Go/No-Go, usar `docs/launch/FINAL_CLOSURE.md`: ordena pagos, legal, backup/export, rotacion, integraciones, SEO/LLM, smoke final, gate y revision secundaria.
- Para el bloqueo RC actual, usar `docs/launch/RC_EVIDENCE_REFRESH.md`: concentra solo `database_readiness` y `operations_external`, sin tocar final-only.
- Cada corrida de `pnpm launch:status` genera `final-closure-pack.md` en `outputs/launch-status/<timestamp>/` con los blockers final-only actuales, worksheets vigentes, orden de cierre y reglas de evidencia sin secretos.
- Cada corrida de `pnpm launch:manual-evidence` genera `manual-evidence-index.md` en `outputs/launch-manual-evidence/<timestamp>/` para ver en una sola matriz la fase, comando, worksheet y evidencia minima de cada check.
- Cada corrida de `pnpm launch:manual-evidence` genera `phase-1-worksheet.md` en `outputs/launch-manual-evidence/<timestamp>/` para ejecutar primero los checks de Fase 1 sin crear otro documento de estado.
- Cada corrida de `pnpm launch:manual-evidence` genera `phase-1-closure-pack.md` en `outputs/launch-manual-evidence/<timestamp>/` para cerrar Fase 1 con comandos, reglas de privacidad y esqueletos JSON seguros. Si ya existen auditorias de apoyo, el pack rellena `Latest support summary`, `Latest worksheet` y `command_output` con rutas reales relativas a `docs/launch/`.
- Cada corrida de `pnpm launch:phase1` genera `outputs/launch-phase-1/<timestamp>/summary.md` con el estado de los seis checks inmediatos y los `SEC-*` abiertos del tracker estricto, sin mezclar legal real, Stripe live, smoke final ni writes externos de Supabase.
- `pnpm launch:manual-evidence:record -- ...` ayuda a registrar un check sin editar JSON a mano y recalcula `launchDecision` segun los estados restantes. Por defecto es dry run; usar `--write` solo despues de revisar el cambio impreso. No sustituye la comprobacion humana ni permite pegar secretos.

## Orden recomendado de Fase 1

1. `cleanup_agents_decision`: cerrar la decision `.agent/.agents`.
2. `content_review`: revisar copy, precios, emails y estados visibles.
3. `accessibility_manual`: probar teclado, foco, lector, zoom y mobile.
4. `database_readiness`: revisar separacion Supabase staging/production, datos staging, migraciones, RLS y postura Supabase Free sin backups programados.
5. `operations_external`: revisar baseline RC de Cloudflare Fulfillment Worker staging, jobs, Resend staging, Workers Logs/observability, postura Supabase Free y rollback. Cron config, deployment staging y secret-name evidence quedan cubiertos por `pnpm launch:staging-operations -- --include-wrangler`. Para Resend, preferir `pnpm launch:resend-readonly -- --env-file <staging-env-file>` con clave valida de staging/read-only; el script solo lista dominios/logs/emails agregados y no envia correos ni guarda destinatarios, asuntos, cuerpos, ids completos, payloads privados ni claves.
6. `security_external`: revisar baseline RC de RLS, WAF/Turnstile, logs y permisos visibles; rotacion final queda para cierre final.

## cleanup_agents_decision

Objetivo: decidir si `.agent/` y `.agents/` se mantienen versionados, se borran o se mueven fuera del repo.

Pasos:

1. Ejecutar `pnpm launch:cleanup` y abrir `outputs/launch-cleanup/<timestamp>/agent-tooling-decision-worksheet.md`.
2. Revisar `docs/launch/CLEANUP.md` y `outputs/launch-cleanup/<timestamp>/agent-tooling-inventory.md`.
3. Decidir `keep`, `delete` o `move`.
4. Si se decide `move`, copiar primero las skills/workflows utiles a una ubicacion global recuperable.
5. Registrar la decision y fecha en `docs/launch/MANUAL_EVIDENCE.local.json`.

Evidencia aceptable:

- `path`: `CLEANUP.md`
- `command_output`: `../../outputs/launch-cleanup/<timestamp>/summary.md`
- `path`: `../../outputs/launch-cleanup/<timestamp>/agent-tooling-decision-worksheet.md`
- `manual_note`: decision concreta y motivo.

## legal_owner_controller

Objetivo: eliminar placeholders legales con datos reales del titular/controlador.

Pasos:

1. Ejecutar `pnpm launch:legal` y abrir `outputs/launch-legal/<timestamp>/legal-closure-worksheet.md`.
2. Ejecutar `pnpm launch:legal-final-inputs` y abrir `outputs/launch-legal-final-inputs/<timestamp>/legal-final-inputs-package.md` y `outputs/launch-legal-final-inputs/<timestamp>/legal-final-inputs-manifest.json`.
3. Completar los inputs de `docs/launch/LEGAL_INPUTS_REQUIRED.md`.
4. Aplicar los datos a las paginas legales ES/EN/RU.
5. Ejecutar `pnpm launch:legal` y `pnpm launch:legal-final-inputs` de nuevo.
6. Ejecutar `pnpm launch:verify`.
7. Confirmar que la auditoria legal y la verificacion primaria ya no fallan por placeholders y que el manifest legal generado tiene `placeholderCount: 0`.

Evidencia aceptable:

- `path`: `LEGAL_INPUTS_REQUIRED.md`
- `command_output`: `../../outputs/launch-legal/<timestamp>/summary.md`
- `command_output`: `../../outputs/launch-legal-final-inputs/<timestamp>/legal-final-inputs-package.md`
- `command_output`: `../../outputs/launch-legal-final-inputs/<timestamp>/legal-final-inputs-manifest.json`
- `command_output`: `../../outputs/launch-verification/<timestamp>/summary.md`
- `manual_note`: alcance de paginas revisadas.

## legal_human_review

Objetivo: confirmar revision humana de aviso legal, privacidad, cookies, terminos y subprocesadores.

Pasos:

1. Ejecutar `pnpm launch:legal` y abrir `outputs/launch-legal/<timestamp>/legal-closure-worksheet.md`.
2. Ejecutar `pnpm launch:legal-final-inputs` y revisar `outputs/launch-legal-final-inputs/<timestamp>/legal-final-inputs-package.md`.
3. Revisar las paginas legales en los idiomas publicados.
4. Confirmar que Stripe, Supabase, Google, Resend, Sentry y Cloudflare aparecen como corresponde.
5. Ejecutar `pnpm launch:legal` como apoyo automatizado.
6. Registrar quien reviso, fecha, alcance y observaciones.
7. Si hay riesgo aceptado, documentar mitigacion y rollback.

Evidencia aceptable:

- `manual_note`: responsable, fecha y alcance.
- `document`: nota local de revision legal.
- `path`: rutas legales revisadas si se usa un documento local.
- `command_output`: `../../outputs/launch-legal/<timestamp>/summary.md`
- `command_output`: `../../outputs/launch-legal-final-inputs/<timestamp>/legal-final-inputs-package.md`

## accessibility_manual

Objetivo: cubrir accesibilidad que axe/Playwright no puede demostrar por completo.

Pasos:

1. Ejecutar `pnpm launch:accessibility` y abrir `outputs/launch-accessibility/<timestamp>/accessibility-manual-worksheet.md`.
2. Probar navegacion solo con teclado en home, pricing, login, legal, campus y formularios criticos.
3. Verificar foco visible, orden de tabulacion, labels y mensajes de error.
4. Probar zoom 200%.
5. Probar con lector de pantalla al menos en login, checkout entry y dashboard.
6. Probar mobile real o dispositivo equivalente.
7. Registrar fallos corregidos o riesgos aceptados.

Evidencia aceptable:

- `screenshot`: capturas de mobile/foco sin datos privados.
- `manual_note`: rutas, navegador/dispositivo y resultado.
- `command_output`: salida de `pnpm launch:accessibility` como apoyo, no como sustituto.

## security_external

Objetivo: revisar seguridad real fuera del codigo local.

Pasos:

1. Ejecutar `pnpm launch:security` y abrir `outputs/launch-security/<timestamp>/security-external-worksheet.md`.
2. Revisar RLS en Supabase real.
3. Revisar ubicacion de service role y dejar constancia de que la rotacion final queda para cierre final.
4. Revisar permisos visibles de Cloudflare, Stripe, Google, Resend y Sentry cuando afecten al RC; limpieza profunda queda para cierre final si no bloquea seguridad actual.
5. Revisar Turnstile/WAF actual, dominios disponibles para RC, logs, alertas e incident response; el dominio final queda para cierre final.
6. Registrar dashboards revisados sin valores secretos.

Evidencia aceptable:

- `dashboard`: panel revisado y resultado.
- `manual_note`: lista de sistemas y hallazgos.
- `screenshot`: captura redaccionada, sin secretos.
- `command_output`: `../../outputs/launch-security/<timestamp>/summary.md` como apoyo automatico.

## payments_staging

Objetivo: demostrar que Stripe staging/test funciona de extremo a extremo antes de activar pagos reales, o dejar documentado que el lanzamiento sigue sin pagos y checkout queda desactivado, oculto o bloqueado.

Pasos:

1. Ejecutar `pnpm launch:payments` y abrir `outputs/launch-payments/<timestamp>/payments-staging-worksheet.md`.
2. Confirmar que staging usa Stripe test mode, Price IDs test y URLs de staging.
3. Si se van a activar pagos, ejecutar una compra de prueba en staging con tarjeta test.
4. Confirmar webhook delivery en Stripe.
5. Si `pnpm launch:stripe-readonly` avisa de host antiguo o inesperado, ejecutar `pnpm launch:stripe-webhook-cutover-pack` y `pnpm launch:stripe-webhook-cutover-runner`; revisar `outputs/launch-stripe-webhook-cutover-pack/<timestamp>/approval-request.md`, `verification-checklist.md`, `rollback-plan.md`, `outputs/launch-stripe-webhook-cutover-runner/<timestamp>/approval-gate.md` y `rollback-after-webhook-cutover.md` antes de tocar Stripe.
6. Confirmar `payments`, `subscriptions` y estado de paquete en Supabase.
7. Confirmar acceso al portal de Stripe.
8. Si no se van a activar pagos, confirmar que checkout queda desactivado, oculto o bloqueado por configuracion/datos.
9. Registrar reconciliacion o decision sin pagos sin datos completos de tarjeta ni payloads con secretos.

Evidencia aceptable:

- `url`: evento test de Stripe dashboard.
- `dashboard`: referencia a webhook/subscription revisados.
- `manual_note`: flujo, usuario test y resultado.
- `command_output`: `../../outputs/launch-payments/<timestamp>/summary.md` como apoyo automatico.

## operations_external

Objetivo: confirmar que operacion real esta lista.

Pasos:

1. Ejecutar `pnpm launch:operations` y abrir `outputs/launch-operations/<timestamp>/operations-readiness-worksheet.md`.
2. Ejecutar `pnpm launch:staging-operations` para health/auth Worker staging, cron/observability local y abrir `outputs/launch-staging-operations-preflight/<timestamp>/summary.md`.
3. Si se necesita evidencia Cloudflare ampliada y solo de lectura, ejecutar `pnpm launch:staging-operations -- --include-wrangler` para account, deployment status/list y nombres de secretos.
4. Ejecutar `pnpm launch:operations-external-closure` y abrir `outputs/launch-operations-external-closure/<timestamp>/operations-external-closure-pack.md` y `outputs/launch-operations-external-closure/<timestamp>/operations-external-evidence-manifest.json`.
5. Revisar servicio Cloudflare Fulfillment Worker staging; production Worker queda en cierre final salvo decision contraria.
6. Confirmar health checks, deploy settings, secretos por nombre y Pages-to-Worker URL alignment.
7. Confirmar procesamiento de `fulfillment_jobs`.
8. Probar ruta de recuperacion admin para jobs despues de cerrar `database_readiness`; si Supabase staging sigue con drift, registrar solo una aceptacion RC explicita del sustituto local UI/API/tests.
9. Ejecutar `pnpm launch:resend-readonly -- --env-file <staging-env-file>` o revisar Resend staging por dashboard/captura redacted. Si el script devuelve 401/403, no cerrar Resend con esa evidencia: usarla solo para demostrar que la clave local no sirve.
10. Revisar Resend staging, Workers Logs/observability visibles en Cloudflare, postura Supabase Free sin backups programados, rollback e incidentes. Cron config, deployment staging y secret-name evidence deben venir del preflight read-only; Google Drive/template final queda en cierre final si no esta claro o puede tocar datos reales.
11. Confirmar que `docs/launch/RUNBOOK.md` sigue aplicando.

Evidencia aceptable:

- `dashboard`: Cloudflare/Supabase/Resend/Google revisados.
- `path`: `RUNBOOK.md`
- `command_output`: `../../outputs/launch-operations/<timestamp>/summary.md` como apoyo automatico.
- `command_output`: `../../outputs/launch-staging-operations-preflight/<timestamp>/summary.md` como apoyo automatico.
- `command_output`: `../../outputs/launch-operations-external-closure/<timestamp>/operations-external-closure-pack.md` como checklist final de cierre.
- `command_output`: `../../outputs/launch-operations-external-closure/<timestamp>/operations-external-evidence-manifest.json` como manifest estructurado de targets read-only, side effects y scope prohibido.
- `command_output`: `../../outputs/resend-readonly-evidence/<timestamp>/summary.md` si esta `OK`; si esta `FAILED`/`WARNING`, solo demuestra intento fallido y no cierra Resend.
- `manual_note`: resultado por sistema.

## content_review

Objetivo: aprobar contenido humano en ES/EN/RU.

Pasos:

1. Ejecutar `pnpm launch:content` y abrir `outputs/launch-content/<timestamp>/content-review-worksheet.md`.
2. Revisar home, pricing, niveles, metodo, login, legal y campus.
3. Revisar precios, nombres de paquetes y cuotas.
4. Revisar emails transaccionales y preview admin.
5. Revisar estados vacios y errores.
6. Registrar cambios pendientes o aprobacion.

Evidencia aceptable:

- `manual_note`: rutas revisadas y decision.
- `screenshot`: capturas de pricing/copy sin datos privados.
- `document`: documento local de aprobacion de copy.
- `command_output`: `../../outputs/launch-content/<timestamp>/summary.md` como apoyo automatico.

## database_readiness

Objetivo: comprobar base de datos real para launch.

Pasos:

1. Ejecutar `pnpm launch:operations` y abrir `outputs/launch-operations/<timestamp>/database-readiness-worksheet.md`.
2. Ejecutar `pnpm launch:staging-db-rollout` para el paquete de schema/CRM y revisar `outputs/launch-staging-database-rollout/<timestamp>/rollout-plan.md` y `outputs/launch-staging-database-rollout/<timestamp>/staging-migration-manifest.json`.
3. Ejecutar `pnpm launch:supabase-security-rollout` para `SEC-014`/`SEC-015` y revisar `outputs/launch-supabase-security-rollout/<timestamp>/summary.md`, `outputs/launch-supabase-security-rollout/<timestamp>/supabase-security-rollout-manifest.json`, `outputs/launch-supabase-security-rollout/<timestamp>/approval-request.md`, `outputs/launch-supabase-security-rollout/<timestamp>/post-apply-verification.sql` y `outputs/launch-supabase-security-rollout/<timestamp>/rollback.sql`.
4. Ejecutar `pnpm launch:supabase-processed-at-cleanup` para el P3 `ERR-QA-SUPABASE-PROCESSED-AT-DEFAULT-149` y revisar `outputs/launch-supabase-processed-at-cleanup/<timestamp>/summary.md`, `outputs/launch-supabase-processed-at-cleanup/<timestamp>/supabase-processed-at-cleanup-manifest.json`, `outputs/launch-supabase-processed-at-cleanup/<timestamp>/approval-request.md`, `outputs/launch-supabase-processed-at-cleanup/<timestamp>/preflight.sql`, `outputs/launch-supabase-processed-at-cleanup/<timestamp>/post-apply-verification.sql` y `outputs/launch-supabase-processed-at-cleanup/<timestamp>/rollback.sql`. Refrescar el estado remoto con `pnpm launch:supabase-processed-at-readonly-preflight` y revisar `outputs/supabase-processed-at-readonly-preflight/<timestamp>/summary.md`. Ejecutar `pnpm launch:supabase-processed-at-cleanup-runner` en modo plan y abrir `outputs/launch-supabase-processed-at-cleanup-runner/<timestamp>/summary.md`, `processed-at-cleanup-command-manifest.json`, `processed-at-cleanup-execution-plan.md`, `approval-gate.md` y `rollback-after-cleanup.md`: confirmar `externalWritePerformed=false`, `PLAN_ONLY_READY`, `SUPABASE_PROCESSED_AT_CLEANUP_APPROVAL`, `--execute-approved`, staging-first, production-second y forbidden scope. No aplicar nada sin aprobacion explicita.
5. Confirmar que staging y production son proyectos separados dentro de la misma cuenta.
6. Confirmar que `db/schema.sql` coincide con migraciones aplicadas.
7. Revisar migraciones en Supabase staging/production, incluyendo la decision sobre historial de migraciones en staging.
8. Verificar RLS, postura Supabase Free sin backups programados, `admin_audit_log` y `fulfillment_jobs`.
9. Dejar documentado que antes de production deploy, migracion destructiva o Go/No-Go publico se ejecutara backup logico/manual fuera del repo o se subira a Pro.
10. Revisar Supabase Advisor: leaked password protection, extension `btree_gist` en `public`, tablas legacy como `public.jobs` y diferencias de historial de migraciones entre staging y production.
11. Probar asignaciones/suscripciones con datos de staging.
12. Registrar entorno, fecha y resultado.

Evidencia aceptable:

- `dashboard`: Supabase migrations/RLS/plan de backups revisados.
- `manual_note`: tablas y flujos verificados.
- `path`: `../../db/schema.sql` como referencia, no como prueba externa unica.
- `command_output`: `../../outputs/launch-operations/<timestamp>/summary.md` como apoyo automatico.
- `command_output`: `../../outputs/launch-staging-database-rollout/<timestamp>/rollout-plan.md` como paquete de rollout staging.
- `command_output`: `../../outputs/launch-staging-database-rollout/<timestamp>/staging-migration-manifest.json` como manifest estructurado de target, hashes, bundle y scope prohibido.
- `command_output`: `../../outputs/launch-supabase-security-rollout/<timestamp>/summary.md` como paquete local-only de `SEC-014`/`SEC-015`.
- `command_output`: `../../outputs/launch-supabase-security-rollout/<timestamp>/supabase-security-rollout-manifest.json` como manifest estructurado de target, hashes, verification SQL, rollback y scope prohibido.
- `command_output`: `../../outputs/launch-supabase-processed-at-cleanup/<timestamp>/summary.md` como paquete local-only del cleanup `processed_at`.
- `command_output`: `../../outputs/launch-supabase-processed-at-cleanup/<timestamp>/supabase-processed-at-cleanup-manifest.json` como manifest de target, hash, preflight, verification SQL, rollback y scope prohibido.

## integration_readiness

Objetivo: confirmar integraciones externas antes de launch.

Pasos:

1. Ejecutar `pnpm launch:final-readiness` y abrir `outputs/launch-final-readiness/<timestamp>/integration-readiness-worksheet.md`.
2. Revisar la ruta ya decidida: Stripe test completo en staging y Stripe live/webhooks para aceptar pagos reales desde el primer dia; comprobar `CHECKOUT_ENABLED_OVERRIDE=false` antes del Go/No-Go y como rollback.
3. Ejecutar `pnpm launch:cloudflare-production-runtime-readonly` y abrir `outputs/launch-cloudflare-production-runtime-readonly/<timestamp>/summary.md`: confirmar cuenta, Pages project, dominios, Worker staging, production Worker y secret names sin valores. Este comando solo lista/lee con Wrangler; parar si una herramienta intenta crear, desplegar, borrar, mover dominios o escribir secrets.
4. Ejecutar `pnpm launch:cloudflare-production-runtime-cutover-preflight` y abrir `outputs/launch-cloudflare-production-runtime-cutover-preflight/<timestamp>/summary.md` y `cloudflare-production-worker-variable-matrix.md`: confirmar build local, `wrangler deploy --env production --dry-run`, `CHECKOUT_ENABLED=false`, sin adjuntar dominios, limpieza de `dist` y matriz de nombres sin valores.
5. Ejecutar `pnpm launch:cloudflare-production-runtime-cutover` y abrir `outputs/launch-cloudflare-production-runtime-cutover/<timestamp>/cloudflare-production-runtime-cutover-manifest.json`, `approval-request-phase-1-worker.md`, `approval-request-worker-secrets.md`, `approval-request-domain-move.md`, `verification-checklist.md` y `rollback-plan.md`.
6. Ejecutar `pnpm launch:cloudflare-production-worker-phase1` en modo plan y abrir `outputs/launch-cloudflare-production-worker-phase1/<timestamp>/summary.md`, `phase1-command-manifest.json`, `phase1-execution-plan.md`, `approval-gate.md` y `rollback-after-phase1.md`: confirmar `externalWritePerformed=false`, `PLAN_ONLY_READY`, `CLOUDFLARE_PHASE1_APPROVAL`, `--execute-approved`, `CHECKOUT_ENABLED=false`, sin mover dominios, sin DNS, sin Pages delete, sin secrets y sin pagos reales.
7. Ejecutar `pnpm launch:cloudflare-production-worker-secrets` en modo plan y abrir `outputs/launch-cloudflare-production-worker-secrets/<timestamp>/summary.md`, `cloudflare-worker-secrets-command-manifest.json`, `cloudflare-worker-secrets-execution-plan.md`, `approval-gate.md` y `rollback-after-worker-secrets.md`: confirmar `externalWritePerformed=false`, `PLAN_ONLY_READY`, `CLOUDFLARE_WORKER_SECRETS_APPROVAL`, `--execute-approved`, `CLOUDFLARE_WORKER_DIRECT_URL` opcional, nombres sin valores, sin mover dominios, sin DNS, sin Pages delete y sin pagos reales.
8. Revisar `outputs/019f1a5e-2745-7c43-870d-544e6ba4e0b1/strict-qa-v2/cloudflare-domain-worker-preflight.md`: confirmar Cloudflare Pages-vs-Worker/domain ownership, production Worker `espanolhonesto` si se usa Workers, production Worker secret-name posture, probes no destructivos de URL directa y mover `espanolhonesto.com`/`www.espanolhonesto.com` solo con aprobacion separada.
9. Revisar Google Drive root folder, template doc y admin account.
10. Revisar Google Calendar/Meet.
11. Revisar Resend sender/domain.
12. Revisar Sentry production unresolved issues.
   Ejecutar `pnpm launch:sentry-readonly` como evidencia agregada. Si avisa por issues no resueltos, ejecutar `pnpm launch:sentry-triage-pack` y `pnpm launch:sentry-issue-triage-runner` en modo plan; revisar `outputs/launch-sentry-triage-pack/<timestamp>/approval-request.md`, `triage-checklist.md`, `alert-ownership-checklist.md`, `manual-evidence-dry-run-accepted-risk.txt`, `manual-evidence-dry-run-pass.txt`, `outputs/launch-sentry-issue-triage-runner/<timestamp>/approval-gate.md` y `rollback-after-sentry-issue-triage.md` antes de cualquier triage dashboard, API status change o aceptacion de riesgo.
13. Revisar Turnstile domains.
   Ejecutar `pnpm launch:turnstile-readonly -- --env-file <env-file>` como apoyo automatico: esto solo demuestra que las claves runtime tienen forma esperada y que `siteverify` rechaza un token invalido sin error de secreto. Si avisa por falta de Cloudflare API/widget listing, ejecutar `pnpm launch:turnstile-domain-closure-pack` y `pnpm launch:turnstile-domain-closure-runner`; revisar `outputs/launch-turnstile-domain-closure-pack/<timestamp>/approval-request.md`, `dashboard-evidence-checklist.md`, `verification-checklist.md`, `rollback-plan.md`, `outputs/launch-turnstile-domain-closure-runner/<timestamp>/approval-gate.md` y `rollback-after-turnstile-domain-closure.md`. No basta para marcar `integration_readiness` como `pass` si no hay tambien dashboard/API evidence del widget.
14. Revisar fulfillment/reminder worker, `CRON_SECRET`, `INTERNAL_JOB_SECRET`, `FULFILLMENT_WORKER_URL` y `PUBLIC_SITE_URL`.
15. Confirmar que no queda ningun Cloudflare Worker legacy con cron activo que interfiera con `workers/fulfillment`, incluyendo `espanol-honesto-reminders`.
16. En Cloudflare Turnstile, confirmar que el widget asociado a `PUBLIC_TURNSTILE_SITE_KEY` cubre `espanolhonesto.com`, `www.espanolhonesto.com`, staging y Pages preview aplicable. Si se usa API, registrar solo site key parcial, dominios y modo; nunca secret key.
17. Si el conector Stripe no permite listar productos/precios, usar dashboard Stripe y evidencia de checkout/webhook/reconciliacion en vez del MCP.
18. Si Stripe read-only mantiene un warning por host de webhook, ejecutar `pnpm launch:stripe-webhook-cutover-pack` y revisar su aprobacion exacta, verificacion read-only y rollback antes de cualquier cambio dashboard.
19. Ejecutar `pnpm launch:integration-final-package` y revisar `outputs/launch-integration-final-package/<timestamp>/integration-final-package.md`, `integration-final-manifest.json`, `service-evidence-matrix.md` y `approval-checklist.md`; este paquete no despliega, no escribe servicios externos, no rota claves y no sustituye dashboards finales.
20. Registrar dashboards y resultados sin secretos.

Evidencia aceptable:

- `dashboard`: panel revisado y estado.
- `manual_note`: integraciones revisadas.
- `screenshot`: captura redaccionada.
- `command_output`: `../../outputs/launch-final-readiness/<timestamp>/summary.md` como apoyo automatico.
- `command_output`: `../../outputs/019f1a5e-2745-7c43-870d-544e6ba4e0b1/strict-qa-v2/cloudflare-domain-worker-preflight.md` como paquete de preflight/cierre Cloudflare Pages-vs-Worker.
- `command_output`: `../../outputs/launch-cloudflare-production-runtime-readonly/<timestamp>/summary.md` como snapshot read-only actual de cuenta Cloudflare, Pages project, dominios, Workers y secret names sin valores.
- `command_output`: `../../outputs/launch-cloudflare-production-runtime-cutover-preflight/<timestamp>/summary.md` como preflight no-write de build local, Wrangler production dry-run, `CHECKOUT_ENABLED=false`, no custom-domain attachment y limpieza de `dist`.
- `command_output`: `../../outputs/launch-cloudflare-production-runtime-cutover-preflight/<timestamp>/cloudflare-production-worker-variable-matrix.md` como matriz de nombres/vars/secrets sin valores antes de cargar Cloudflare Worker secrets.
- `command_output`: `../../outputs/launch-cloudflare-production-runtime-cutover/<timestamp>/cloudflare-production-runtime-cutover-manifest.json` como manifest local-only de fases Cloudflare, secret names, aprobaciones separadas y rollback.
- `command_output`: `../../outputs/launch-cloudflare-production-runtime-cutover/<timestamp>/manual-evidence-dry-run.txt` como plantilla de registro despues de reemplazar placeholders con evidencia real no secreta.
- `command_output`: `../../outputs/launch-cloudflare-production-worker-phase1/<timestamp>/summary.md`, `../../outputs/launch-cloudflare-production-worker-phase1/<timestamp>/phase1-command-manifest.json`, `../../outputs/launch-cloudflare-production-worker-phase1/<timestamp>/approval-gate.md` y `../../outputs/launch-cloudflare-production-worker-phase1/<timestamp>/rollback-after-phase1.md` como runner gated de Worker phase 1; en modo plan debe mostrar `externalWritePerformed=false`.
- `command_output`: `../../outputs/launch-cloudflare-production-worker-secrets/<timestamp>/summary.md`, `../../outputs/launch-cloudflare-production-worker-secrets/<timestamp>/cloudflare-worker-secrets-command-manifest.json`, `../../outputs/launch-cloudflare-production-worker-secrets/<timestamp>/approval-gate.md` y `../../outputs/launch-cloudflare-production-worker-secrets/<timestamp>/rollback-after-worker-secrets.md` como runner gated de Worker secret names y direct Worker probes; en modo plan debe mostrar `externalWritePerformed=false`.
- `command_output`: `../../outputs/launch-supabase-processed-at-cleanup-runner/<timestamp>/summary.md`, `../../outputs/launch-supabase-processed-at-cleanup-runner/<timestamp>/processed-at-cleanup-command-manifest.json`, `../../outputs/launch-supabase-processed-at-cleanup-runner/<timestamp>/approval-gate.md` y `../../outputs/launch-supabase-processed-at-cleanup-runner/<timestamp>/rollback-after-cleanup.md` como runner gated de Supabase processed_at cleanup; en modo plan debe mostrar `externalWritePerformed=false`.
- `command_output`: `../../outputs/launch-integration-final-package/<timestamp>/integration-final-package.md`, `../../outputs/launch-integration-final-package/<timestamp>/integration-final-manifest.json` y `../../outputs/launch-integration-final-package/<timestamp>/service-evidence-matrix.md` como matriz unica de cierre `integration_readiness`.
- `command_output`: `../../outputs/launch-sentry-triage-pack/<timestamp>/sentry-triage-manifest.json`, `../../outputs/launch-sentry-triage-pack/<timestamp>/triage-checklist.md` y `../../outputs/launch-sentry-triage-pack/<timestamp>/alert-ownership-checklist.md` como apoyo local-only de triage Sentry o aceptacion de riesgo sin secretos.
- `command_output`: `../../outputs/launch-sentry-issue-triage-runner/<timestamp>/summary.md`, `../../outputs/launch-sentry-issue-triage-runner/<timestamp>/sentry-issue-triage-command-manifest.json`, `../../outputs/launch-sentry-issue-triage-runner/<timestamp>/approval-gate.md` y `../../outputs/launch-sentry-issue-triage-runner/<timestamp>/rollback-after-sentry-issue-triage.md` como runner gated de Sentry issue status; en modo plan debe mostrar `externalWritePerformed=false`.
- `command_output`: `../../outputs/launch-turnstile-domain-closure-pack/<timestamp>/turnstile-domain-closure-manifest.json`, `../../outputs/launch-turnstile-domain-closure-pack/<timestamp>/dashboard-evidence-checklist.md` y `../../outputs/launch-turnstile-domain-closure-pack/<timestamp>/verification-checklist.md` como apoyo local-only de cierre Turnstile widget/domain sin secretos.
- `command_output`: `../../outputs/launch-turnstile-domain-closure-runner/<timestamp>/summary.md`, `../../outputs/launch-turnstile-domain-closure-runner/<timestamp>/turnstile-domain-closure-command-manifest.json`, `../../outputs/launch-turnstile-domain-closure-runner/<timestamp>/approval-gate.md` y `../../outputs/launch-turnstile-domain-closure-runner/<timestamp>/rollback-after-turnstile-domain-closure.md` como runner gated de Turnstile domains; en modo plan debe mostrar `externalWritePerformed=false`.
- `command_output`: `../../outputs/launch-turnstile-readonly-evidence/<timestamp>/summary.md` como apoyo de runtime; si esta en `WARNING` por falta de Cloudflare API/widget listing, no cierra dominios por si solo.
- `dashboard`: Turnstile widget con site key parcial y dominios permitidos revisados, sin secret values.

## seo_llm_final

Objetivo: cerrar SEO, tipografia rusa y discoverability para buscadores/LLMs tras copy, legal, dominio y modo de pagos definitivos.

Pasos:

1. Abrir `docs/launch/SEO_LLM_FINAL.md`.
2. Ejecutar `pnpm launch:live-domain-readonly -- --base-url https://espanolhonesto.com --host-variant https://www.espanolhonesto.com` y revisar `outputs/launch-live-domain-readonly-evidence/<timestamp>/summary.md`.
3. Ejecutar `pnpm launch:seo` y abrir `outputs/launch-seo/<timestamp>/seo-llm-final-worksheet.md`.
4. Ejecutar `pnpm launch:seo-llm-final-package` y revisar `outputs/launch-seo-llm-final-package/<timestamp>/seo-llm-final-package.md`, `seo-llm-final-manifest.json`, `review-checklist.md` y `domain-parity-gap.md`; este paquete no despliega, no escribe servicios externos, no compra/guarda fuentes y no sustituye Search Console/Core Web Vitals.
5. Revisar robots, sitemap, canonical/hreflang y URLs indexables en el dominio final.
6. Revisar JSON-LD, snippets, OG/social previews y Core Web Vitals si aplica.
7. Decidir la politica de indexacion de paginas legales y alinear sitemap/noindex.
8. Revisar Search Console o herramienta equivalente si esta disponible: sitemap enviado, URLs clave inspeccionadas y errores de cobertura conocidos.
9. Revisar `llms.txt` y confirmar que campus, API, demo y rutas privadas no se usen como fuentes publicas.
10. Revisar `/ru` y confirmar fuente oficial con soporte cirilico tras compra/licencia, o registrar que Alin acepta el fallback actual para launch.
11. Registrar resultado, URLs revisadas y cualquier riesgo aceptado sin secretos ni datos personales.

Evidencia aceptable:

- `command_output`: `../../outputs/launch-seo/<timestamp>/summary.md` como apoyo automatico.
- `command_output`: `../../outputs/launch-live-domain-readonly-evidence/<timestamp>/summary.md` como evidencia automatica de dominio real.
- `command_output`: `../../outputs/launch-seo-llm-final-package/<timestamp>/seo-llm-final-package.md`, `../../outputs/launch-seo-llm-final-package/<timestamp>/seo-llm-final-manifest.json`, `../../outputs/launch-seo-llm-final-package/<timestamp>/review-checklist.md` y `../../outputs/launch-seo-llm-final-package/<timestamp>/domain-parity-gap.md` como apoyo de cierre final SEO/LLM.
- `dashboard`: Search Console o equivalente con sitemap/URL inspection revisados.
- `manual_note`: URLs, fecha, entorno y decision de indexacion legal.
- `manual_note`: decision de tipografia rusa premium/fallback, rutas revisadas y seguimiento si aplica.
- `screenshot`: captura redaccionada sin tokens ni datos privados.

## final_smoke

Objetivo: cerrar el circuito real justo antes de aceptar trafico publico.

Pasos:

1. Ejecutar `pnpm launch:final-readiness` y abrir `outputs/launch-final-readiness/<timestamp>/final-smoke-worksheet.md`.
2. Ejecutar `pnpm launch:final-smoke-execution-pack` y abrir `outputs/launch-final-smoke-execution-pack/<timestamp>/final-smoke-execution-manifest.json`, `approval-request-final-smoke.md`, `approval-request-staging-smoke.md`, `preflight-checklist.md`, `staging-preflight-checklist.md` y `rollback-and-cleanup-plan.md`; este paquete no ejecuta writes ni sustituye la aprobacion exacta. `approval-request-staging-smoke.md` permite un staging rehearsal con Stripe test y proveedores reales de prueba aunque legal final, SEO live-domain y dominio de produccion sigan pendientes; ese rehearsal no cierra `final_smoke`.
3. Ejecutar `pnpm launch:staging-smoke-rehearsal-runner` en modo plan y abrir `outputs/launch-staging-smoke-rehearsal-runner/<timestamp>/summary.md`, `staging-smoke-command-manifest.json`, `staging-smoke-execution-plan.md`, `approval-gate.md` y `rollback-after-staging-smoke.md`; confirmar `PLAN_ONLY_READY`, `externalWriteCommandStarted=false`, `STAGING_SMOKE_REHEARSAL_APPROVAL`, `--execute-approved`, Stripe test mode y que no imprime valores secretos. Solo despues de la frase exacta y en la ventana aprobada, ejecutar el mismo runner con `--execute-approved`.
4. Confirmar que `scripts/smoke/real-env-smoke.ts` usa `SMOKE_BASE_URL`, `SMOKE_EXTERNAL_WRITES_CONFIRMATION`, `SMOKE_ADMIN_EMAIL`, `SMOKE_ADMIN_PASSWORD`, `SMOKE_TEACHER_EMAIL` y `SMOKE_TEACHER_PASSWORD`; `SMOKE_EXTERNAL_WRITES_CONFIRMATION` debe ser `writes-ok:<host>` para el host exacto de `SMOKE_BASE_URL`, y el script no debe resetear contrasenas de admin/profesor ni usar credenciales hardcodeadas.
5. Registro/login.
6. Checkout.
7. Webhook.
8. Drive folder.
9. Email.
10. Reserva.
11. Documento.
12. Calendar/Meet.
13. Recordatorio.
14. Cancelacion.
15. Retry de job fallido.
16. Production smoke minimo en launch day antes de aceptar trafico publico.

Evidencia aceptable:

- `manual_note`: entorno, timestamp, cuenta test y resultado de cada paso.
- `command_output`: resumen local de smoke si existe.
- `command_output`: `../../outputs/launch-final-readiness/<timestamp>/summary.md` como apoyo automatico.
- `command_output`: `../../outputs/launch-final-smoke-execution-pack/<timestamp>/approval-request-final-smoke.md`, `../../outputs/launch-final-smoke-execution-pack/<timestamp>/final-smoke-execution-manifest.json`, `../../outputs/launch-final-smoke-execution-pack/<timestamp>/preflight-checklist.md` y `../../outputs/launch-final-smoke-execution-pack/<timestamp>/rollback-and-cleanup-plan.md` como apoyo de aprobacion, limites y rollback.
- `command_output`: `../../outputs/launch-final-smoke-execution-pack/<timestamp>/approval-request-staging-smoke.md` y `../../outputs/launch-final-smoke-execution-pack/<timestamp>/staging-preflight-checklist.md` como apoyo de staging rehearsal previo; usarlo para QA tecnica, no para marcar `final_smoke` como pass.
- `command_output`: `../../outputs/launch-staging-smoke-rehearsal-runner/<timestamp>/summary.md`, `../../outputs/launch-staging-smoke-rehearsal-runner/<timestamp>/staging-smoke-command-manifest.json`, `../../outputs/launch-staging-smoke-rehearsal-runner/<timestamp>/approval-gate.md` y `../../outputs/launch-staging-smoke-rehearsal-runner/<timestamp>/rollback-after-staging-smoke.md` como runner gated de staging; en modo plan debe mostrar `externalWriteCommandStarted=false`.
- `command_output`: `../../outputs/real-env-smoke/<timestamp>/summary.md` solo despues de ejecutar el harness real con aprobacion exacta y evidencia redactada.
- `screenshot`: capturas sin datos sensibles.

## Cierre

Cuando todos los checks esten completos:

1. Actualizar `docs/launch/MANUAL_EVIDENCE.local.json`.
2. Ejecutar `pnpm launch:manual-evidence`.
3. Ejecutar `pnpm launch:gate`.
4. Ejecutar `pnpm launch:secondary-review` si la checklist se actualizo despues del Gate.
5. Ejecutar `pnpm launch:status`.
6. Revisar que `docs/launch/CHECKLIST.md` no tenga Go/No-Go abiertos antes de declarar `READY`.
