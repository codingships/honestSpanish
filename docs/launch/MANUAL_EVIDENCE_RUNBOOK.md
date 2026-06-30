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
- Cada corrida de `pnpm launch:phase1` genera `outputs/launch-phase-1/<timestamp>/summary.md` con el estado de los seis checks inmediatos sin mezclar legal real, Stripe live ni smoke final.
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
2. Completar los inputs de `docs/launch/LEGAL_INPUTS_REQUIRED.md`.
3. Aplicar los datos a las paginas legales ES/EN/RU.
4. Ejecutar `pnpm launch:legal`.
5. Ejecutar `pnpm launch:verify`.
6. Confirmar que la auditoria legal y la verificacion primaria ya no fallan por placeholders.

Evidencia aceptable:

- `path`: `LEGAL_INPUTS_REQUIRED.md`
- `command_output`: `../../outputs/launch-legal/<timestamp>/summary.md`
- `command_output`: `../../outputs/launch-verification/<timestamp>/summary.md`
- `manual_note`: alcance de paginas revisadas.

## legal_human_review

Objetivo: confirmar revision humana de aviso legal, privacidad, cookies, terminos y subprocesadores.

Pasos:

1. Ejecutar `pnpm launch:legal` y abrir `outputs/launch-legal/<timestamp>/legal-closure-worksheet.md`.
2. Revisar las paginas legales en los idiomas publicados.
3. Confirmar que Stripe, Supabase, Google, Resend, Sentry y Cloudflare aparecen como corresponde.
4. Ejecutar `pnpm launch:legal` como apoyo automatizado.
5. Registrar quien reviso, fecha, alcance y observaciones.
6. Si hay riesgo aceptado, documentar mitigacion y rollback.

Evidencia aceptable:

- `manual_note`: responsable, fecha y alcance.
- `document`: nota local de revision legal.
- `path`: rutas legales revisadas si se usa un documento local.
- `command_output`: `../../outputs/launch-legal/<timestamp>/summary.md`

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
5. Confirmar `payments`, `subscriptions` y estado de paquete en Supabase.
6. Confirmar acceso al portal de Stripe.
7. Si no se van a activar pagos, confirmar que checkout queda desactivado, oculto o bloqueado por configuracion/datos.
8. Registrar reconciliacion o decision sin pagos sin datos completos de tarjeta ni payloads con secretos.

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
2. Ejecutar `pnpm launch:staging-db-rollout` y revisar `outputs/launch-staging-database-rollout/<timestamp>/rollout-plan.md` y `outputs/launch-staging-database-rollout/<timestamp>/staging-migration-manifest.json`.
3. Confirmar que staging y production son proyectos separados dentro de la misma cuenta.
4. Confirmar que `db/schema.sql` coincide con migraciones aplicadas.
5. Revisar migraciones en Supabase staging/production, incluyendo la decision sobre historial de migraciones en staging.
6. Verificar RLS, postura Supabase Free sin backups programados, `admin_audit_log` y `fulfillment_jobs`.
7. Dejar documentado que antes de production deploy, migracion destructiva o Go/No-Go publico se ejecutara backup logico/manual fuera del repo o se subira a Pro.
8. Revisar Supabase Advisor: leaked password protection, extension `btree_gist` en `public`, tablas legacy como `public.jobs` y diferencias de historial de migraciones entre staging y production.
9. Probar asignaciones/suscripciones con datos de staging.
10. Registrar entorno, fecha y resultado.

Evidencia aceptable:

- `dashboard`: Supabase migrations/RLS/plan de backups revisados.
- `manual_note`: tablas y flujos verificados.
- `path`: `../../db/schema.sql` como referencia, no como prueba externa unica.
- `command_output`: `../../outputs/launch-operations/<timestamp>/summary.md` como apoyo automatico.
- `command_output`: `../../outputs/launch-staging-database-rollout/<timestamp>/rollout-plan.md` como paquete de rollout staging.
- `command_output`: `../../outputs/launch-staging-database-rollout/<timestamp>/staging-migration-manifest.json` como manifest estructurado de target, hashes, bundle y scope prohibido.

## integration_readiness

Objetivo: confirmar integraciones externas antes de launch.

Pasos:

1. Ejecutar `pnpm launch:final-readiness` y abrir `outputs/launch-final-readiness/<timestamp>/integration-readiness-worksheet.md`.
2. Revisar Stripe live y webhooks si se van a aceptar pagos reales; si no, confirmar checkout bloqueado/desactivado por configuracion o datos.
3. Revisar Google Drive root folder, template doc y admin account.
4. Revisar Google Calendar/Meet.
5. Revisar Resend sender/domain.
6. Revisar Turnstile domains.
7. Revisar fulfillment/reminder worker, `CRON_SECRET`, `INTERNAL_JOB_SECRET`, `FULFILLMENT_WORKER_URL` y `PUBLIC_SITE_URL`.
8. Confirmar que no queda ningun Cloudflare Worker legacy con cron activo que interfiera con `workers/fulfillment`, incluyendo `espanol-honesto-reminders`.
9. Si el conector Stripe no permite listar productos/precios, usar dashboard Stripe y evidencia de checkout/webhook/reconciliacion en vez del MCP.
10. Registrar dashboards y resultados sin secretos.

Evidencia aceptable:

- `dashboard`: panel revisado y estado.
- `manual_note`: integraciones revisadas.
- `screenshot`: captura redaccionada.
- `command_output`: `../../outputs/launch-final-readiness/<timestamp>/summary.md` como apoyo automatico.

## seo_llm_final

Objetivo: cerrar SEO, tipografia rusa y discoverability para buscadores/LLMs tras copy, legal, dominio y modo de pagos definitivos.

Pasos:

1. Abrir `docs/launch/SEO_LLM_FINAL.md`.
2. Ejecutar `pnpm launch:seo` y abrir `outputs/launch-seo/<timestamp>/seo-llm-final-worksheet.md`.
3. Revisar robots, sitemap, canonical/hreflang y URLs indexables en el dominio final.
4. Revisar JSON-LD, snippets, OG/social previews y Core Web Vitals si aplica.
5. Decidir la politica de indexacion de paginas legales y alinear sitemap/noindex.
6. Revisar Search Console o herramienta equivalente si esta disponible: sitemap enviado, URLs clave inspeccionadas y errores de cobertura conocidos.
7. Revisar `llms.txt` y confirmar que campus, API, demo y rutas privadas no se usen como fuentes publicas.
8. Revisar `/ru` y confirmar fuente oficial con soporte cirilico tras compra/licencia, o registrar que Alin acepta el fallback actual para launch.
9. Registrar resultado, URLs revisadas y cualquier riesgo aceptado sin secretos ni datos personales.

Evidencia aceptable:

- `command_output`: `../../outputs/launch-seo/<timestamp>/summary.md` como apoyo automatico.
- `dashboard`: Search Console o equivalente con sitemap/URL inspection revisados.
- `manual_note`: URLs, fecha, entorno y decision de indexacion legal.
- `manual_note`: decision de tipografia rusa premium/fallback, rutas revisadas y seguimiento si aplica.
- `screenshot`: captura redaccionada sin tokens ni datos privados.

## final_smoke

Objetivo: cerrar el circuito real justo antes de aceptar trafico publico.

Pasos:

1. Ejecutar `pnpm launch:final-readiness` y abrir `outputs/launch-final-readiness/<timestamp>/final-smoke-worksheet.md`.
2. Registro/login.
3. Checkout.
4. Webhook.
5. Drive folder.
6. Email.
7. Reserva.
8. Documento.
9. Calendar/Meet.
10. Recordatorio.
11. Cancelacion.
12. Retry de job fallido.
13. Production smoke minimo en launch day antes de aceptar trafico publico.

Evidencia aceptable:

- `manual_note`: entorno, timestamp, cuenta test y resultado de cada paso.
- `command_output`: resumen local de smoke si existe.
- `command_output`: `../../outputs/launch-final-readiness/<timestamp>/summary.md` como apoyo automatico.
- `screenshot`: capturas sin datos sensibles.

## Cierre

Cuando todos los checks esten completos:

1. Actualizar `docs/launch/MANUAL_EVIDENCE.local.json`.
2. Ejecutar `pnpm launch:manual-evidence`.
3. Ejecutar `pnpm launch:gate`.
4. Ejecutar `pnpm launch:secondary-review` si la checklist se actualizo despues del Gate.
5. Ejecutar `pnpm launch:status`.
6. Revisar que `docs/launch/CHECKLIST.md` no tenga Go/No-Go abiertos antes de declarar `READY`.
