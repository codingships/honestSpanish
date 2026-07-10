# Manual Launch Evidence

Este documento define como registrar los checks que no puede demostrar un test local: legal, accesibilidad manual, Stripe real, Cloudflare Fulfillment Worker, Google, Resend, seguridad externa, contenido humano y smoke final.

## Archivo Local

La evidencia real vive en:

```bash
docs/launch/MANUAL_EVIDENCE.local.json
```

Ese archivo esta ignorado por git porque puede contener URLs internas, nombres de cuentas, capturas o notas operativas. No debe contener secretos.

`pnpm launch:manual-evidence` escanea ese archivo local contra patrones comunes de secretos y datos peligrosos: Stripe secret/webhook keys, Supabase service keys, JWTs, Google/Resend keys, private keys, URLs de base de datos con password, credenciales embebidas en URLs, tokens Bearer y query params sensibles. El audit no imprime los valores detectados, solo el tipo de hallazgo y el archivo.

Para prepararlo:

```bash
pnpm launch:manual-evidence:init
pnpm launch:manual-evidence
pnpm launch:phase1
```

`pnpm launch:manual-evidence:init` crea `docs/launch/MANUAL_EVIDENCE.local.json` solo si falta. Si el archivo ya existe, no lo sobrescribe ni imprime su contenido. Si en el futuro la plantilla versionada incorpora checks nuevos, se pueden anadir sin tocar evidencias existentes:

```bash
pnpm launch:manual-evidence:init -- --sync-missing
```

Cada corrida escribe:

- `outputs/launch-manual-evidence/<timestamp>/summary.md`: resultado formal del audit.
- `outputs/launch-manual-evidence/<timestamp>/summary.json`: resultado estructurado, incluyendo `manualEvidencePhaseSummary` y `manualEvidenceByPhase` para que `launch:status` y la revision secundaria no reconstruyan las fases a mano.
- `outputs/launch-manual-evidence/<timestamp>/manual-evidence-index.md`: matriz generada que conecta cada check requerido con su fase, comando de apoyo, worksheet y evidencia minima.
- `outputs/launch-manual-evidence/<timestamp>/next-actions.md`: lista accionable por fase de checks pendientes, evidencia aceptable y campos JSON que hay que completar.
- `outputs/launch-manual-evidence/<timestamp>/phase-1-worksheet.md`: hoja de trabajo para cerrar primero `cleanup_agents_decision`, `accessibility_manual`, `security_external`, `operations_external`, `content_review` y `database_readiness` sin tocar legal real ni Stripe live.
- `outputs/launch-manual-evidence/<timestamp>/phase-1-closure-pack.md`: paquete generado para cerrar Fase 1 con orden recomendado, reglas de privacidad, comandos de verificacion y esqueletos JSON seguros para `docs/launch/MANUAL_EVIDENCE.local.json`. Cuando ya existen auditorias de apoyo, el pack incluye `Latest support summary`, `Latest worksheet`, `Latest manual evidence dry run` cuando existe `manual-evidence-dry-run.txt`, y esqueletos `command_output` con rutas reales relativas a `docs/launch/` para reducir sustituciones manuales.
- `outputs/launch-phase-1/<timestamp>/summary.md`: resumen generado por `pnpm launch:phase1` para comprobar solo Fase 1 despues de actualizar evidencia local; no ejecuta legal real, Stripe live ni smoke final.
- `outputs/launch-cleanup/<timestamp>/agent-tooling-inventory.md`: inventario generado por `pnpm launch:cleanup` para decidir si `.agent/` y `.agents/` se mantienen, se mueven o se borran.
- `outputs/launch-cleanup/<timestamp>/agent-tooling-decision-worksheet.md`: hoja generada por `pnpm launch:cleanup` para cerrar `cleanup_agents_decision` con una decision `keep`, `move` o `delete` sin borrar nada automaticamente.
- `outputs/launch-legal/<timestamp>/legal-closure-worksheet.md`: hoja generada por `pnpm launch:legal` para cerrar al final `legal_owner_controller` y `legal_human_review` sin inventar datos.
- `outputs/launch-legal-final-inputs/<timestamp>/legal-final-inputs-package.md`: paquete generado por `pnpm launch:legal-final-inputs` con inventario actual de placeholders, inputs humanos requeridos, estado de terminos/cookies/subprocesadores, dry-runs de evidencia y regla de no guardar documentos privados.
- `outputs/launch-legal-final-inputs/<timestamp>/legal-final-inputs-manifest.json`: manifest generado por `pnpm launch:legal-final-inputs`; para cerrar `legal_owner_controller` debe mostrar `placeholderCount: 0`.
- `outputs/launch-content/<timestamp>/content-review-worksheet.md`: hoja generada por `pnpm launch:content` para revisar copy ES/EN/RU, precios, emails, estados vacios y errores antes de marcar `content_review`.
- `outputs/launch-seo/<timestamp>/seo-llm-final-worksheet.md`: hoja generada por `pnpm launch:seo` para cerrar SEO/LLM final tras copy, legal, dominios y modo de pagos definitivos. Runbook estable: `docs/launch/SEO_LLM_FINAL.md`.
- `outputs/launch-seo-llm-final-package/<timestamp>/seo-llm-final-package.md`: paquete generado por `pnpm launch:seo-llm-final-package`; consolida la diferencia entre `launch:seo` local, dominio real, Search Console/CWV, `llms.txt`, exclusion privada y decision de tipografia rusa.
- `outputs/launch-seo-llm-final-package/<timestamp>/seo-llm-final-manifest.json`: manifest generado por `pnpm launch:seo-llm-final-package`; demuestra que el paquete no despliega, no escribe servicios externos, no compra/guarda fuentes y resume el estado `seoClosureStatus`.
- `outputs/launch-seo-llm-final-package/<timestamp>/domain-parity-gap.md`: evidencia generada del gap de dominio real; debe estar resuelta o aceptada explicitamente antes de cerrar `seo_llm_final`.
- `outputs/launch-accessibility/<timestamp>/accessibility-manual-worksheet.md`: hoja generada por `pnpm launch:accessibility` para revisar teclado, foco, lector de pantalla, zoom 200%, mobile real y formularios antes de marcar `accessibility_manual`.
- `outputs/launch-security/<timestamp>/security-external-worksheet.md`: hoja generada por `pnpm launch:security` para revisar baseline de seguridad RC: Supabase RLS real, ubicacion de service role, Turnstile/WAF actual, logs, alertas, incidentes y permisos visibles antes de marcar `security_external`. La rotacion final de claves, live-domain review y limpieza profunda de permisos quedan en cierre final.
- `outputs/launch-payments/<timestamp>/payments-staging-worksheet.md`: hoja generada por `pnpm launch:payments` para revisar compra Stripe test staging, webhook delivery, `subscriptions`, `payments`, portal, reconciliacion y rollback antes de marcar `payments_staging`; queda para cierre final mientras no se acepten pagos reales.
- `outputs/launch-operations/<timestamp>/operations-readiness-worksheet.md`: hoja generada por `pnpm launch:operations` para revisar baseline operativo RC: Cloudflare Fulfillment Worker staging, jobs, Resend staging, Workers Logs/observability, postura Supabase Free, rollback e incidentes antes de marcar `operations_external`. La configuracion de cron, deployment staging y nombres de secrets quedan cubiertos por `pnpm launch:staging-operations -- --include-wrangler`; Worker production, Google Drive final y backup/export final quedan en cierre final.
- `outputs/resend-readonly-evidence/<timestamp>/summary.md`: evidencia opcional generada por `pnpm launch:resend-readonly -- --env-file <staging-env-file>` para Resend staging. Debe estar `OK` para apoyar delivery/suppression sin captura manual; si esta `FAILED` o `WARNING`, no cierra Resend por si sola.
- `outputs/launch-operations/<timestamp>/database-readiness-worksheet.md`: hoja generada por `pnpm launch:operations` para revisar separacion Supabase staging/production, migraciones, RLS, staging assignments, suscripciones, postura Supabase Free sin backups programados, auditabilidad y service role antes de marcar `database_readiness`.
- `outputs/launch-final-readiness/<timestamp>/integration-readiness-worksheet.md`: hoja generada por `pnpm launch:final-readiness` para revisar Stripe test/live y su rollback, Cloudflare Pages-vs-Worker/domain ownership, production Worker secret-name posture, Google Drive/Calendar/Meet, Resend, Turnstile, fulfillment/reminder worker, `CRON_SECRET`, `PUBLIC_SITE_URL` y rotacion final antes de marcar `integration_readiness`. Apoyar el cierre Cloudflare con `outputs/019f1a5e-2745-7c43-870d-544e6ba4e0b1/strict-qa-v2/cloudflare-domain-worker-preflight.md`, el snapshot `pnpm launch:cloudflare-production-runtime-readonly` en `outputs/launch-cloudflare-production-runtime-readonly/<timestamp>/summary.md`, el preflight `pnpm launch:cloudflare-production-runtime-cutover-preflight` en `outputs/launch-cloudflare-production-runtime-cutover-preflight/<timestamp>/summary.md`, la matriz `outputs/launch-cloudflare-production-runtime-cutover-preflight/cloudflare-production-worker-variable-matrix.md`, `pnpm launch:cloudflare-production-runtime-cutover`, cuyo manifest queda en `outputs/launch-cloudflare-production-runtime-cutover/<timestamp>/cloudflare-production-runtime-cutover-manifest.json`, `pnpm launch:cloudflare-production-worker-phase1`, cuyo summary queda en `outputs/launch-cloudflare-production-worker-phase1/<timestamp>/summary.md` con `externalWritePerformed=false` en modo plan, y `pnpm launch:cloudflare-production-worker-secrets`, cuyo summary queda en `outputs/launch-cloudflare-production-worker-secrets/<timestamp>/summary.md` con nombres/direct probe separados de dominio.
- `outputs/launch-integration-final-package/<timestamp>/integration-final-package.md`: paquete generado por `pnpm launch:integration-final-package`; consolida Cloudflare, Supabase, Stripe, Google, Resend, Turnstile, Sentry, SEO/domain, smoke final, legacy Worker, processed_at drift y matriz de evidencia de servicios sin conectar ni escribir servicios externos.
- `outputs/launch-integration-final-package/<timestamp>/integration-final-manifest.json`: manifest generado por `pnpm launch:integration-final-package`; muestra `integrationClosureStatus`, evidencias faltantes/warning y confirma que el paquete no despliega, no escribe servicios externos y registra solo nombres/paths no secretos.
- `outputs/launch-integration-final-package/<timestamp>/service-evidence-matrix.md`: matriz generada para decidir si `integration_readiness` puede pasar o necesita accepted-risk por servicio/proveedor.
- `outputs/launch-sentry-triage-pack/<timestamp>/sentry-triage-manifest.json`: manifest generado por `pnpm launch:sentry-triage-pack`; prepara triage Sentry o accepted-risk desde evidencia read-only, sin llamar a Sentry, sin cambiar issue status, sin alert-rule writes y sin guardar titles, event IDs, stack traces ni raw payloads.
- `outputs/launch-sentry-triage-pack/<timestamp>/triage-checklist.md` y `outputs/launch-sentry-triage-pack/<timestamp>/alert-ownership-checklist.md`: checklists locales para cerrar issues visibles o documentar owner, monitor, rollback y accepted risk antes de marcar `integration_readiness`.
- `outputs/launch-sentry-issue-triage-runner/<timestamp>/summary.md`: runner generado por `pnpm launch:sentry-issue-triage-runner`; en modo plan no llama a Sentry y muestra `externalWritePerformed=false`; en modo aprobado exige `SENTRY_TRIAGE_APPROVAL`, `SENTRY_TRIAGE_ACTION`, `SENTRY_TRIAGE_SHORT_IDS`, preflight read-only vivo y frase exacta antes de cambiar solo status de issue.
- `outputs/launch-sentry-issue-triage-runner/<timestamp>/sentry-issue-triage-command-manifest.json`, `approval-gate.md` y `rollback-after-sentry-issue-triage.md`: evidencia no secreta del alcance API Sentry, approval gate y rollback; no guarda tokens, DSN secrets, titles, event IDs, stack traces ni raw payloads.
- `outputs/launch-turnstile-domain-closure-pack/<timestamp>/turnstile-domain-closure-manifest.json`: manifest generado por `pnpm launch:turnstile-domain-closure-pack`; prepara cierre Turnstile widget/domain desde evidencia read-only, sin llamar a Cloudflare, sin cambiar widgets, DNS, Workers, Pages, WAF, secrets ni dominios.
- `outputs/launch-turnstile-domain-closure-pack/<timestamp>/dashboard-evidence-checklist.md` y `outputs/launch-turnstile-domain-closure-pack/<timestamp>/verification-checklist.md`: checklists locales para registrar account, widget name, site key prefix y dominios permitidos sin secret values antes de marcar `integration_readiness`.
- `outputs/launch-final-readiness/<timestamp>/final-smoke-worksheet.md`: hoja generada por `pnpm launch:final-readiness` para revisar registration, checkout, webhook, Drive, email, booking, Doc, Calendar/Meet, reminder, cancellation, retry y production smoke antes de marcar `final_smoke`.
- `outputs/launch-final-smoke-execution-pack/<timestamp>/final-smoke-execution-manifest.json`: manifest generado por `pnpm launch:final-smoke-execution-pack`; demuestra que el paquete local no ejecuto writes, documenta `SMOKE_EXTERNAL_WRITES_CONFIRMATION=writes-ok:<host>`, separa `readyForStagingApproval` de `readyForApproval` final y fija el limite de aprobacion para el smoke real.
- `outputs/launch-final-smoke-execution-pack/<timestamp>/approval-request-final-smoke.md`: frase exacta de aprobacion para ejecutar el smoke final con writes externos en staging/production; no es permiso por si sola.
- `outputs/launch-final-smoke-execution-pack/<timestamp>/approval-request-staging-smoke.md` y `outputs/launch-final-smoke-execution-pack/<timestamp>/staging-preflight-checklist.md`: frase exacta y checklist para ejecutar un staging rehearsal con Stripe test y proveedores reales de prueba sin cerrar `final_smoke`, sin esperar a legal final, live-domain SEO o dominio de produccion.
- `outputs/launch-staging-smoke-rehearsal-runner/<timestamp>/summary.md`, `outputs/launch-staging-smoke-rehearsal-runner/<timestamp>/staging-smoke-command-manifest.json`, `outputs/launch-staging-smoke-rehearsal-runner/<timestamp>/staging-smoke-execution-plan.md`, `outputs/launch-staging-smoke-rehearsal-runner/<timestamp>/approval-gate.md` y `outputs/launch-staging-smoke-rehearsal-runner/<timestamp>/rollback-after-staging-smoke.md`: runner gated generado por `pnpm launch:staging-smoke-rehearsal-runner`; en modo plan no ejecuta smoke ni escribe servicios externos, y en modo aprobado exige `STAGING_SMOKE_REHEARSAL_APPROVAL`, `--execute-approved`, `SMOKE_BASE_URL=https://staging.espanolhonesto.com`, `SMOKE_EXTERNAL_WRITES_CONFIRMATION=writes-ok:staging.espanolhonesto.com`, Stripe test mode y evidencia redactada.
- `outputs/launch-final-smoke-execution-pack/<timestamp>/preflight-checklist.md` y `outputs/launch-final-smoke-execution-pack/<timestamp>/rollback-and-cleanup-plan.md`: checklist y rollback/cleanup que deben revisarse antes de cerrar `final_smoke`.

Guia versionada para ejecutar los checks: `docs/launch/MANUAL_EVIDENCE_RUNBOOK.md`.

Prioridad y orden recomendado: `docs/launch/LAUNCH_SEQUENCE.md`. Cierre final operativo: `docs/launch/FINAL_CLOSURE.md`. Legal real, Stripe staging/live si se van a activar pagos, rotacion final de API keys, backup/export final, SEO/LLM final y smoke de produccion pueden quedar abiertos hasta la fase final, pero siguen bloqueando `READY`.

Para registrar una evidencia sin editar JSON a mano se puede usar:

```bash
pnpm launch:manual-evidence:record -- --id cleanup_agents_decision --status pass --summary "Decision: keep .agent/.agents through launch; review after release." --evidence "manual_note=Decision recorded by Alin." --evidence "path=CLEANUP.md"
```

Por defecto es un dry run: imprime el check que cambiaria y no modifica `docs/launch/MANUAL_EVIDENCE.local.json`. Para escribir, anadir `--write`. Esta utilidad no demuestra que la revision humana se haya hecho; solo ayuda a registrar una decision o comprobacion ya realizada, exige evidencia explicita para `pass`/`accepted_risk`, recalcula `launchDecision` segun los estados restantes, rechaza patrones comunes de secretos y mantiene el archivo local ignorado.

Tambien se puede usar otro archivo:

```bash
pnpm launch:manual-evidence -- --evidence C:\ruta\a\evidencia.json
```

## Estados

- `pass`: requisito verificado con evidencia suficiente.
- `accepted_risk`: riesgo aceptado explicitamente. Requiere `riskAcceptedBy`, `riskRationale` y `rollbackPlan`.
- `pending`: falta ejecutar o aportar evidencia.
- `blocked`: hay un bloqueo real.

## Decision Manual

`launchDecision` debe ser coherente con los checks:

- `blocked`: obligatorio mientras cualquier check requerido este `pending` o `blocked`.
- `ready_with_accepted_risks`: obligatorio si no quedan checks `pending`/`blocked`, pero al menos uno esta en `accepted_risk`.
- `ready`: solo si todos los checks requeridos estan en `pass`.

El audit falla si la decision dice `ready` con riesgos aceptados, si dice `ready_with_accepted_risks` sin riesgos documentados, o si sigue en `blocked` cuando todos los checks ya estan completos.

## Tipos De Evidencia

- `url`: dashboard, pagina publicada, Stripe, Cloudflare, Supabase, Sentry, etc.
- `path`: archivo local existente.
- `screenshot`: captura local existente.
- `command_output`: log local existente.
- `dashboard`: referencia descriptiva a un panel revisado.
- `document`: documento local existente.
- `manual_note`: nota manual concreta.

Para `path`, `screenshot`, `command_output` y `document`, el archivo referenciado debe existir. Los paths relativos se resuelven desde `docs/launch/`.

## Checks Requeridos

| Check | Evidencia minima |
| --- | --- |
| `cleanup_agents_decision` | Decision concreta sobre mantener, borrar o mover `.agent/` y `.agents/`; si se mueven, indicar destino recuperable. |
| `legal_owner_controller` | Datos reales del titular/controlador aplicados en paginas legales, `pnpm launch:legal` sin placeholders y `pnpm launch:legal-final-inputs` con `placeholderCount: 0`. |
| `legal_human_review` | Revision humana de privacidad, cookies, terminos y subprocesadores; indicar responsable, alcance revisado y evidencia de apoyo de `pnpm launch:legal` y `pnpm launch:legal-final-inputs`. |
| `accessibility_manual` | Teclado, foco visible, lector de pantalla, zoom 200%, mobile real y formularios criticos revisados. |
| `security_external` | Baseline de seguridad RC revisado: Supabase RLS real, service role, WAF/Turnstile actual, logs y permisos visibles; rotacion final queda en cierre final. |
| `payments_staging` | Compra Stripe test staging, webhook delivery, subscription/payment, portal y reconciliacion verificados antes de activar pagos reales; si se lanza sin pagos, checkout queda desactivado/oculto/bloqueado hasta cierre final. |
| `operations_external` | Baseline operativo RC verificado: Worker staging, `fulfillment_jobs`, Resend staging, Workers Logs/observability, postura Supabase Free y rollback; cron config/deployment/secret-name evidence cubierto por preflight staging; Admin Jobs staging UI/runtime se revisa despues de `database_readiness` o se acepta explicitamente como sustituto RC local. |
| `content_review` | Copy ES/EN/RU, precios, emails, estados vacios y errores revisados por humano. |
| `database_readiness` | Separacion Supabase staging/production, asignaciones/suscripciones staging, migraciones/RLS/audit tables y postura Free sin backups programados verificados. |
| `integration_readiness` | Stripe test ensayado y Stripe live preparado para pagos reales desde el primer dia, con `CHECKOUT_ENABLED_OVERRIDE=false` hasta Go/No-Go y rollback probado; paquete `pnpm launch:integration-final-package`, Stripe webhook test-mode con `pnpm launch:stripe-webhook-cutover-runner`, Turnstile dominios con `pnpm launch:turnstile-domain-closure-runner`, Sentry issue triage con `pnpm launch:sentry-issue-triage-runner`, Cloudflare Pages-vs-Worker/domain ownership, snapshot `pnpm launch:cloudflare-production-runtime-readonly`, preflight `pnpm launch:cloudflare-production-runtime-cutover-preflight`, `cloudflare-production-worker-variable-matrix.md`, production Worker secret-name posture, cutover Cloudflare generado por `pnpm launch:cloudflare-production-runtime-cutover`, runner gated `pnpm launch:cloudflare-production-worker-phase1`, runner gated `pnpm launch:cloudflare-production-worker-secrets`, Supabase processed_at drift con `pnpm launch:supabase-processed-at-cleanup-runner`, Google, Resend, Sentry y fulfillment/reminder worker revisados/configurados. |
| `seo_llm_final` | SEO/LLM final con dominio/copy/legal definitivos: sitemap, robots, canonical/hreflang, JSON-LD, snippets, `llms.txt`, paquete `pnpm launch:seo-llm-final-package`, tipografia rusa premium/fallback, Search Console si esta disponible y exclusion de rutas privadas/demo/API revisados. |
| `final_smoke` | Registro, checkout, webhook, Drive, email, reserva, Doc, Calendar/Meet, recordatorio, cancelacion y retry end-to-end. Usar `pnpm launch:final-smoke-execution-pack` antes de cualquier smoke con writes y adjuntar evidencia redactada de `outputs/real-env-smoke/<timestamp>/summary.md` si se ejecuta el harness real. |

## Criterio De Launch

Antes de declarar `READY`:

1. `pnpm launch:gate` debe pasar.
2. `pnpm launch:verify` no debe fallar.
3. `pnpm launch:manual-evidence` debe ser `OK`, o `WARNING` solo con riesgos aceptados explicitamente.
4. `pnpm launch:secondary-review` debe pasar.
5. La checklist no debe tener Go/No-Go blockers abiertos.
