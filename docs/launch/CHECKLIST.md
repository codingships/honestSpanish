# Launch Checklist

Estado: no hay prisa. Prioridad: producto robusto, limpio y operable sin intervencion tecnica diaria.

## Launch Gate

Estado actual: `BLOCKED`.

No se declara `READY` solo porque los comandos pasen. Para lanzar hacen falta dos capas:

1. Verificacion primaria con evidencias generadas por `pnpm launch:verify`.
2. Revision secundaria de evidencias, checklist, riesgos aceptados y smoke staging/production.

Estados permitidos:

- `BLOCKED`: hay bloqueadores tecnicos, legales, operativos o de evidencia.
- `READY_WITH_ACCEPTED_RISKS`: no hay bloqueadores, pero quedan riesgos documentados y aceptados por Alin.
- `READY`: no hay bloqueadores ni riesgos relevantes abiertos; la segunda revision lo confirma.

Regla de evidencia:

- Cada item marcado como hecho debe tener evidencia: comando, captura, URL, log, migracion, decision documentada o prueba manual fechada.
- Si la evidencia es indirecta, antigua o no cubre el requisito completo, el item sigue abierto.
- La demo y cualquier herramienta dev/test deben quedar fuera del runtime normal de launch salvo activacion explicita; con la bandera apagada, las rutas demo deben fallar cerrado con `404` y `noindex`.

Comando completo del Launch Gate:

```bash
pnpm launch:gate
```

Comandos internos, utiles para depurar cada capa:

```bash
pnpm launch:verify
pnpm launch:phase1
pnpm launch:sequence
pnpm launch:cleanup
pnpm launch:seo
pnpm launch:public-visual
pnpm launch:legal
pnpm launch:final-readiness
pnpm launch:manual-evidence:init
pnpm launch:manual-evidence:record
pnpm launch:manual-evidence
pnpm launch:secondary-review
pnpm launch:status
```

`launch:gate` ejecuta `launch:verify`, `launch:phase1`, `launch:secondary-review` y `launch:status` en orden, escribe evidencias en `outputs/launch-gate/<timestamp>/`, genera `evidence-index.json` con primaria, Fase 1 y evidencia manual para validar la corrida actual, y sale con error mientras el gate este bloqueado. `launch:verify` escribe evidencias en `outputs/launch-verification/<timestamp>/` y solo puede producir candidato a READY. `launch:phase1` escribe evidencias en `outputs/launch-phase-1/<timestamp>/`, ejecuta solo soporte inmediato (`launch:cleanup`, `launch:worktree`, `launch:content`, `launch:accessibility`, `launch:operations`, `launch:operations-external-closure`, `launch:staging-db-rollout`, `launch:supabase-security-rollout`, `launch:security`, `launch:manual-evidence` y `launch:status`) y sale con error mientras queden pendientes inmediatos de Fase 1 o hallazgos `SEC-*` abiertos en el tracker estricto; no toca legal real, Stripe live, rotacion final de claves, smoke de produccion ni writes externos de Supabase. `launch:rc` escribe evidencias en `outputs/launch-rc/<timestamp>/`, ejecuta `launch:phase1`, `launch:payments`, `launch:no-real-payments` y `launch:status`, y evalua solo Release Candidate: puede pasar con bloqueos final-only abiertos, pero debe fallar mientras queden pendientes de Fase 1 o pagos/no-cobros no sean coherentes; `payments_staging` queda final-only mientras no se acepten pagos reales. `launch:sequence` escribe evidencias en `outputs/launch-sequence/<timestamp>/` y audita que la secuencia de trabajo distinga tareas de ahora, bloqueos final-only y condiciones de READY. `launch:cleanup` audita sin borrar archivos que los historicos obsoletos no sigan vivos, que los artefactos locales esten ignorados y que `.agent/.agents` dependan de una decision humana registrada. `launch:seo` escribe evidencias en `outputs/launch-seo/<timestamp>/`, audita crawlability, sitemap/robots, canonical/hreflang, JSON-LD y `/llms.txt`, y genera una worksheet de cierre final SEO/LLM sin sustituir Search Console, Core Web Vitals ni revision final de copy/legal. `launch:public-visual` escribe evidencias en `outputs/launch-public-visual/<timestamp>/`, abre la home ES y las tres landings SEO en desktop/mobile, guarda capturas y bloquea si detecta mojibake, texto publico antiguo sin acentos, overflow horizontal, enlaces publicos a demo/campus/API o falta de CTA `solicitar plaza`. `launch:legal` escribe evidencias en `outputs/launch-legal/<timestamp>/`, detecta placeholders legales, subprocesadores, cookies, decision de terminos y flujo de evidencia legal; no sustituye revision humana ni asesoria legal. `launch:final-readiness` escribe evidencias en `outputs/launch-final-readiness/<timestamp>/` y genera worksheets para `integration_readiness` y `final_smoke` sin activar Stripe live ni ejecutar humo de produccion. `launch:manual-evidence:init` crea el archivo local si falta y permite `--sync-missing --dry-run` para comprobar checks nuevos sin sobrescribir evidencia existente. `launch:manual-evidence:record` ayuda a registrar checks locales en dry run por defecto y solo escribe con `--write`; no sustituye la comprobacion humana. `launch:manual-evidence` valida el formato y frescura de `docs/launch/MANUAL_EVIDENCE.local.json`, que no se versiona, y genera `manual-evidence-index.md`, `next-actions.md`, `phase-1-closure-pack.md` y pendientes accionables agrupados por fase. `launch:secondary-review` revisa la evidencia, esta checklist, `Current Evidence` y el ultimo audit manual; exige que la checklist, el indice de evidencia del gate o el ultimo `launch:status` apunten al ultimo primario, la ultima Fase 1 y el ultimo audit manual, verifica que `manual-evidence-index.md`, `next-actions.md`, `phase-1-closure-pack.md`, `final-closure-pack.md` y `launch:status` preserven los 12 checks manuales por fase, y bloquea mientras queden Go/No-Go blockers, evidencia manual fallida o revision secundaria sin cerrar. `launch:status` resume tambien la ultima corrida de `launch:gate`, con pasos fallidos, `Current Evidence`, `Urgency Summary`, `Release Candidate Readiness`, `Phase 1 Focus`, pendientes manuales agrupados por fase y `final-closure-pack.md`, para evitar que el dashboard oculte que el Gate completo no paso o que mezcle tareas inmediatas con bloqueos final-only.

Actualizacion de gates RC: `launch:phase1` tambien ejecuta `launch:operations-external-closure`, `launch:staging-db-rollout` y `launch:supabase-security-rollout`, y bloquea si `strict-qa-results.json` mantiene `SEC-*` abiertos. `launch:rc` tambien ejecuta `launch:functional-rc`, `launch:staging-no-real-payments-remediation` y `launch:rc-external-closure` antes de `launch:status`.

Evidencia vigente:

- `pnpm launch:status` es el dashboard vivo. Su tabla `Current Evidence` apunta a la verificacion primaria, Fase 1, evidencia manual, revision secundaria, auditoria legal y gate completo mas recientes.
- Cada corrida de `pnpm launch:status` genera `final-closure-pack.md` en `outputs/launch-status/<timestamp>/` con el orden actual de cierre final, worksheets vigentes y evidencias minimas sin secretos.
- La seccion `Release Candidate Readiness` indica si el RC esta bloqueado por Fase 1, por checks propios de RC, o si ya estaria tecnicamente listo con bloqueos finales deliberados.
- `pnpm launch:rc` es la puerta especifica de Release Candidate: falla por Fase 1, pero no por legal real, `payments_staging`, integraciones finales o smoke final mientras no se acepten pagos reales.
- No actualices timestamps manualmente en esta checklist para aparentar frescura. Si una corrida nueva importa, ejecuta `pnpm launch:status` y usa `Current Evidence`.
- Si se ejecutan comandos sueltos despues del gate completo, `launch:status` marca `Full Launch Gate` como `STALE` hasta que `pnpm launch:gate` se reruntee antes de Go/No-Go.
- La revision secundaria acepta como evidencia fresca la checklist, el `evidence-index.json` del gate o la tabla `Current Evidence` del ultimo `launch:status`.
- Estado esperado mientras Alin no cierre evidencia manual/legal: `BLOCKED`, sin warnings tecnicos, con `pnpm launch:legal` fallando por placeholders reales y `pnpm launch:manual-evidence` fallando por checks humanos pendientes.
- Los artefactos manuales vigentes viven en el ultimo `manual-evidence-index.md`, `next-actions.md`, `phase-1-closure-pack.md` y `final-closure-pack.md` enlazados desde `pnpm launch:status`.

resumen por urgencia/final-only: Fase 1 cierra limpieza, contenido, accesibilidad, seguridad, operacion y base de datos; Fase 2 congela el RC sin aceptar pagos reales; Fase 3 conserva legal real, Stripe/payments, integraciones finales y smoke final hasta el cierre deliberado.

## Ownership And Cadence

Launch tier: major public launch.

Target basis: no fixed calendar launch date is defined. Targets are relative to release candidate freeze, production deploy and final Go/No-Go.

Final decision owner: Alin. Codex can prepare evidence, run checks and flag contradictions, but cannot accept legal, financial or external operational risk on Alin's behalf.

Launch sequence: `docs/launch/LAUNCH_SEQUENCE.md` separates work to close now from final-only blockers. Final closure runbook: `docs/launch/FINAL_CLOSURE.md`. Legal real data, Stripe live, final API key rotation, final Supabase backup/export, fuente rusa premium, SEO/LLM final and production smoke remain deliberate final blockers, not surprises to solve during cleanup.

Review cadence: update this checklist after each launch verification run; review open Go/No-Go blockers daily once a release candidate is chosen; rerun `pnpm launch:gate` immediately before any Go/No-Go decision.

Rollback source: `docs/launch/RUNBOOK.md`, section `Rollback`. Rollback must be tested or explicitly accepted as risk in `docs/launch/MANUAL_EVIDENCE.local.json` before production launch.

| Blocker area | Owner | Target | Evidence |
| --- | --- | --- | --- |
| Gate automation | Codex prepares; Alin approves launch decision | Immediately before Go/No-Go | `pnpm launch:gate` plus `pnpm launch:verify`, `pnpm launch:manual-evidence`, `pnpm launch:secondary-review`, `pnpm launch:status` |
| Final closure runbook | Alin owns final decision; Codex prepares and verifies evidence | During final Go/No-Go window | `docs/launch/FINAL_CLOSURE.md` |
| Phase 1 closure | Alin provides external evidence; Codex validates support audits | Before release candidate freeze | `pnpm launch:phase1`, `outputs/launch-phase-1/<timestamp>/summary.md`, `phase-1-closure-pack.md` |
| Manual evidence file | Alin provides; Codex validates format and freshness | Before secondary review | `docs/launch/MANUAL_EVIDENCE.local.json`, `docs/launch/MANUAL_EVIDENCE_RUNBOOK.md` |
| Cleanup decision | Alin | Before release candidate freeze | `docs/launch/CLEANUP.md` and `cleanup_agents_decision` manual evidence |
| Legal | Alin, plus legal advisor if used | Before public launch | Legal pages plus `legal_owner_controller` and `legal_human_review` manual evidence |
| Accessibility manual | Alin with Codex-assisted checklist | Before release candidate signoff | `accessibility_manual` manual evidence |
| Security external | Alin with Supabase, Cloudflare, Stripe and Sentry dashboards | Before release candidate freeze for baseline; repeat before production deploy for final rotation/live-domain review | `security_external` manual evidence |
| Payments staging | Alin | Before production deploy | `payments_staging` manual evidence |
| Operations external | Alin | Before release candidate freeze for staging baseline; repeat before production deploy for final Worker/smoke/backup action | `operations_external` manual evidence |
| Content review | Alin | Before public launch | `content_review` manual evidence |
| Database readiness | Alin | Before release candidate freeze for separation/RLS/Free backup posture; repeat before production deploy or destructive migration for backup/export | `database_readiness` manual evidence |
| Integrations readiness | Alin | Before production deploy | `integration_readiness` manual evidence |
| SEO/LLM final | Alin with Codex-assisted audit | Before public launch, after final domain/copy/legal/payment mode and font decision | `seo_llm_final` manual evidence plus `pnpm launch:seo` |
| Final smoke | Alin with Codex-assisted run | Launch day, before accepting public traffic | `final_smoke` manual evidence |

## Go/No-Go Blockers

- [ ] `pnpm launch:gate` pasa sin fallos. Evidencia vigente via `pnpm launch:status` -> `Current Evidence` -> `Full Launch Gate`; debe bloquear mientras `launch:verify`, `launch:phase1` o `launch:secondary-review` fallen por blockers reales.
- [ ] `pnpm launch:verify` pasa sin fallos. Evidencia vigente via `pnpm launch:status` -> `Current Evidence` -> `Primary Verification`; debe bloquear por `pnpm launch:legal` hasta completar datos legales reales.
- [x] `pnpm launch:sequence` pasa sin fallos. Evidencia: `outputs/launch-sequence/2026-06-05T21-58-30-838Z/summary.md`.
- [ ] `pnpm launch:manual-evidence` pasa sin fallos. Evidencia vigente via `pnpm launch:status` -> `Current Evidence` -> `Manual Evidence Audit`; bloquea mientras `docs/launch/MANUAL_EVIDENCE.local.json` mantenga checks humanos en `pending`. Plantilla: `docs/launch/MANUAL_EVIDENCE.example.json`; guia: `docs/launch/MANUAL_EVIDENCE.md`; runbook: `docs/launch/MANUAL_EVIDENCE_RUNBOOK.md`.
- [ ] `pnpm launch:secondary-review` pasa sin fallos. Evidencia vigente via `pnpm launch:status` -> `Current Evidence` -> `Secondary Review`; bloquea mientras el primario este bloqueado, la evidencia manual falle o queden Go/No-Go abiertos.
- [x] Revision secundaria confirma evidencias, no contradice el resultado primario y conserva los 12 checks manuales agrupados por fase. Evidencia actual via `pnpm launch:status` -> `Current Evidence` -> `Secondary Review`.
- [x] Demo/dev/test aislados del runtime normal de produccion, navegacion publica, sitemap y robots; las rutas demo fallan cerrado con `404`/`noindex` cuando la bandera esta apagada. Evidencia actual via `pnpm launch:status` -> `Current Evidence` -> `Primary Verification`.
- [x] Limpieza automatica no destructiva pasa sin fallos ni warnings. Evidencia: `outputs/launch-cleanup/2026-06-05T21-58-31-269Z/summary.md`, `outputs/launch-cleanup/2026-06-05T21-58-31-269Z/agent-tooling-decision-worksheet.md`.
- [x] Limpieza de archivos obsoletos decidida: `.agent/` y `.agents/` se mantienen versionados hasta launch y se revisan despues. Evidencia: `docs/launch/MANUAL_EVIDENCE.local.json` (`cleanup_agents_decision`) y `docs/launch/CLEANUP.md`.
- [ ] `pnpm launch:legal` pasa sin fallos. Evidencia vigente via `pnpm launch:status` -> `Current Evidence` -> `Legal Audit`; falla hasta que Alin complete titular/controlador y cierre revision legal humana.
- [ ] Legal: titular, privacidad, cookies, terminos y subprocesadores revisados. Bloqueo automatico actual: placeholders de titular/controlador en paginas legales. Inputs requeridos en `docs/launch/LEGAL_INPUTS_REQUIRED.md`; auditoria automatica: `pnpm launch:legal`.
- [x] Accesibilidad automatica: WCAG 2.2 AA smoke en paginas publicas, paginas de segmento SEO, login, legal, redireccion campus sin sesion y campus autenticado critico. Evidencia vigente via `pnpm launch:status` -> `Current Evidence`; revalidado con `outputs/launch-accessibility/2026-06-12T14-20-42-919Z/summary.md`.
- [x] Accesibilidad manual: teclado, foco visible, lectura con screen reader, zoom 200%, mobile real y formularios criticos revisados. Evidencia: `docs/launch/MANUAL_EVIDENCE.local.json` (`accessibility_manual`).
- [x] Seguridad automatica: RLS/RBAC, secretos, webhooks, Turnstile, endpoints internos, regresiones conocidas y worksheet de revision externa auditados. Evidencia: `outputs/launch-security/2026-06-05T21-58-32-972Z/summary.md`, `outputs/launch-security/2026-06-05T21-58-32-972Z/security-external-worksheet.md`.
- [x] Seguridad manual/externa: baseline RC cerrado sin rotar claves finales. RLS en Supabase real verificado por SQL; `support_tickets` queda sin lectura directa desde cliente, `pg_graphql` fue retirado al no usarse, y las policies admin usan `private.is_admin()` scoped a `authenticated`; Worker staging rechaza rutas internas sin autenticacion; Turnstile validado contra secret configurado con fake token rechazado; Cloudflare Turnstile/Worker logs visibles en capturas. Quedan para cierre final: rotacion de claves, live-domain review y activar leaked password protection en Supabase Auth. `btree_gist` en `public` permanece como riesgo aceptado/backlog segun `DECISIONS.md`, no como decision abierta. La tabla legacy `public.jobs` ya esta inventariada por forma, constraints, indexes, dependencias y 111 filas fixture; su borrado sin `CASCADE` queda en el cleanup v2 pendiente de ejecucion aprobada. Evidencia: `docs/launch/MANUAL_EVIDENCE.local.json` (`security_external`), `supabase/migrations/013_harden_support_tickets_access.sql`, `supabase/migrations/014_harden_database_api_surface.sql`, `supabase/migrations/015_drop_unused_pg_graphql.sql`, `supabase/migrations/016_move_is_admin_to_private_schema.sql`, `supabase/migrations/017_scope_admin_policies_to_authenticated.sql`, `outputs/launch-user-evidence/2026-06-11-screenshots/cloudflare-turnstile-landing-analytics.png`, `outputs/launch-user-evidence/2026-06-11-screenshots/cloudflare-worker-staging-settings-cron-observability.png`.
- [x] Pagos automaticos: checkout, webhook, portal, catalogo, schema, tests, smokes, docs y worksheet de Stripe test staging auditados. Evidencia: `outputs/launch-payments/2026-06-05T21-58-33-837Z/summary.md`, `outputs/launch-payments/2026-06-05T21-58-33-837Z/payments-staging-worksheet.md`.
- [x] Pagos/no-cobros RC: checkout publico sigue application-first, Cloudflare Pages staging tiene `CHECKOUT_ENABLED=false`, `/api/create-checkout` devuelve `403 Checkout is disabled` antes de Supabase/Stripe y el build local Pages contiene el guard. Stripe test/live completo, webhook delivery real, portal y reconciliacion quedan final-only si se decide habilitar pagos. Evidencia vigente: `docs/launch/MANUAL_EVIDENCE.local.json` (`payments_staging`), `outputs/launch-no-real-payments/2026-06-27T00-08-48-552Z/summary.md`, `outputs/launch-staging-no-real-payments-remediation/2026-06-27T00-08-48-547Z/pages-staging-build-manifest.json`.
- [x] Operacion automatica: CI/deploy, Cloudflare Fulfillment Worker, fulfillment jobs, recuperacion admin, entorno, runbook y worksheets de revision manual auditados. Evidencia actual via `pnpm launch:status` -> `Current Evidence` -> `Primary Verification`.
- [x] Operacion manual/externa RC refrescada: `operations_external` queda cerrado para RC sin cobros reales. Cloudflare Worker staging tiene Logs enabled y sampling 100% en captura de dashboard; Resend staging tiene visibilidad read-only OK de dominios/logs/emails con salida agregada; Admin Jobs staging UI/runtime carga con admin, `/es/campus/admin/jobs` observa API 200, controles de recuperacion y tabla/empty state visibles, sin retry/cancel/process. Cron config, deployment staging y secret-name evidence quedan cubiertos por `pnpm launch:staging-operations -- --include-wrangler`. Worker production, Google Drive final y backup/export final quedan en cierre final. Evidencia: `docs/launch/MANUAL_EVIDENCE.local.json` (`operations_external`), `outputs/launch-user-evidence/2026-06-27-screenshots/cloudflare-worker-staging-observability.png`, `outputs/resend-readonly-evidence/2026-06-27T19-27-10-052Z/summary.md`, `outputs/admin-jobs-staging-runtime/2026-06-27T19-30-04-644Z/summary.md`, `outputs/launch-rc-external-closure/2026-06-27T19-32-59-975Z/summary.md`.
- [x] Preparacion final automatica: integraciones finales y smoke final tienen worksheets generadas y validadas. Evidencia: `outputs/launch-final-readiness/2026-06-05T21-58-34-283Z/summary.md`, `outputs/launch-final-readiness/2026-06-05T21-58-34-283Z/integration-readiness-worksheet.md`, `outputs/launch-final-readiness/2026-06-05T21-58-34-283Z/final-smoke-worksheet.md`.
- [x] Contenido: ES/EN/RU, precios, emails, estados vacios y errores revisados. Evidencia: `docs/launch/MANUAL_EVIDENCE.local.json` (`content_review`) y auditoria automatica `pnpm launch:content`.
- [x] Campus local sin mojibake visible en sidebar/header de alumno, profesor y admin. Evidencia: Playwright local 2026-06-11 con `tests/e2e/.auth/student.json`, `tests/e2e/.auth/teacher.json` y `tests/e2e/.auth/admin.json`; screenshots `outputs/visual-checks/campus-encoding-2026-06-11/student.png`, `outputs/visual-checks/campus-encoding-2026-06-11/teacher.png` y `outputs/visual-checks/campus-encoding-2026-06-11/admin.png`; `tests/unit/i18n.test.ts` cubre labels criticos y `tests/unit/i18n-encoding.test.ts` recorre traducciones ES/EN/RU, valida labels criticos por codepoint Unicode y protege el render de marca/titulo en `src/layouts/CampusLayout.astro`.
- [x] SEO tecnico: sitemap, robots, canonical, hreflang, noindex privado, exclusion demo, OG y JSON-LD revisados. Evidencia: `outputs/launch-verification/2026-06-05T21-58-04-246Z/summary.md`; revalidado 2026-06-11 con JSON-LD de landings generado desde paquetes activos, `/llms.txt` publico y `tests/unit/seo-surface.test.ts` cubriendo `robots.txt`, `llms.txt`, sitemap publico, layout SEO/noindex y rutas demo.
- [x] Mapa SEO/LLM de intencion RC definido y enlazado desde la home ES: tres paginas prioritarias, `/es/espanol-para-vivir-en-espana`, `/es/espanol-para-profesionales` y `/es/clases-de-conversacion-en-espanol`, quedan en sitemap, `llms.txt`, docs y enlace interno desde `/es`; paginas por ciudad, reviews, Telegram y prueba de nivel definitiva siguen pospuestas. Evidencia: `docs/launch/SEO_INTENT_MAP.md`, `src/components/LandingPage.astro`, `src/pages/sitemap-public.xml.ts`, `public/llms.txt`, `tests/unit/landing-public-content.test.ts`, `tests/unit/seo-surface.test.ts`, `outputs/visual-checks/home-seo-links-2026-06-12T11-16-26-477Z/summary.json`.
- [x] Estrategia comercial de lanzamiento sintetizada: cliente principal adulto/profesional +30, promesa de vivir Espana con conversacion/cultura/criterio, solicitud de plaza como CTA, plan grupal condicionado por compatibilidad, plan hibrido como posicionamiento premium, idiomas/mercados, metricas de primera semana y final-only delimitado. Evidencia: `docs/launch/LAUNCH_MARKETING_PLAN.md`.
- [x] Smoke visual publico RC repetible: `pnpm launch:public-visual` comprueba home ES y las tres landings SEO en desktop/mobile, guarda capturas y detecta mojibake, copy antiguo sin acentos, overflow horizontal, enlaces publicos a demo/campus/API y ausencia de CTA. Evidencia vigente: `outputs/launch-public-visual/<timestamp>/summary.md`.
- [x] Arquitectura de conversion publica RC definida: la accion principal es solicitar plaza, recoger datos de encaje, revisar en admin CRM y dejar compra directa/pagos live para cierre final. Evidencia: `docs/launch/CONVERSION_ARCHITECTURE.md`, `src/components/LeadCaptureForm.tsx`, `src/pages/api/subscribe.ts`, `src/pages/api/admin/leads.ts`, `src/components/admin/LeadManager.tsx`, `tests/api/subscribe.test.ts`, `tests/api/admin-leads.test.ts`, `tests/e2e/lead-magnet.public.spec.ts`.
- [ ] SEO/LLM final: cerrar `seo_llm_final` despues de copy/legal/dominio/modo de pagos y decision de fuente rusa premium finales para confirmar que buscadores y LLMs vean el contenido correcto, que `/ru` use la familia cirilica oficial comprada/licenciada o un fallback aceptado explicitamente, no indexen campus/demo/private/API, y que snippets/canonicals/hreflang/robots/sitemap sigan alineados con dominio final. Runbook estable: `docs/launch/SEO_LLM_FINAL.md`. Parcial RC: `public/llms.txt` creado, JSON-LD de `/es`, `/en` y `/ru` renderiza paquetes reales, las paginas `/es/espanol-para-vivir-en-espana`, `/es/espanol-para-profesionales` y `/es/clases-de-conversacion-en-espanol` tienen respuestas AEO/FAQ, contextos concretos y `FAQPage`, `tests/unit/seo-surface.test.ts` protege la separacion public/private y `pnpm launch:seo` genera `outputs/launch-seo/<timestamp>/seo-llm-final-worksheet.md`.

## Engineering

- [x] Cloudflare no importa Google SDK en `src/pages/api`. Evidencia: `outputs/launch-verification/2026-06-05T21-58-04-246Z/summary.md`.
- [x] Cloudflare Fulfillment Worker creado en `workers/fulfillment`.
- [x] Admin Jobs UI creada. Evidencia: `src/pages/[lang]/campus/admin/jobs.astro`, `src/components/admin/FulfillmentJobsManager.tsx`, `src/pages/api/admin/fulfillment-jobs.ts`.
- [x] Admin Emails UI creada para preview/envio de pruebas. Evidencia: `src/pages/[lang]/campus/admin/emails.astro`, `src/components/admin/EmailTemplateManager.tsx`, `src/lib/email/previews.ts`.
- [x] Banner staging/test creado.
- [x] Script Google staging creado.
- [x] CI preparado para `staging` y `main`. Evidencia: `.github/workflows/ci.yml`.
- [x] Pipeline staging preparado para deploy automático tras CI; `main` production solo hace build y dry-runs, nunca despliega automáticamente. La secuencia production exige gates manuales: fulfillment bootstrap inerte -> HMAC-only fulfillment -> web bootstrap -> HMAC-only web -> secrets activos finales -> atestación dual fresca -> enable fulfillment. Evidencia: `.github/workflows/ci.yml`, `wrangler.toml`, `workers/fulfillment/wrangler.toml`, `docs/launch/CLOUDFLARE_PRODUCTION.md`.
- [x] CI de fulfillment usa `--config workers/fulfillment/wrangler.toml`, un solo `--env`, dry-run previo y deploy posterior; ya no concatena `--env staging` con otro entorno.
- [x] Los nombres base Wrangler son sinks seguros (`espanolhonesto-env-required` y `espanol-honesto-fulfillment-env-required`); Astro web selecciona production durante el build y despliega solo el `dist/server/wrangler.json` resuelto, mientras fulfillment selecciona `--env production` explícitamente.
- [x] Build production separado y fail-closed: `pnpm build:production:release` exige `PUBLIC_APP_ENV=production`, ref Supabase production y `PUBLIC_SITE_URL=https://espanolhonesto.com`; el flujo normal `pnpm build` sigue siendo staging.
- [x] El build production fija `CLOUDFLARE_INCLUDE_PROCESS_ENV=false` y rechaza/elimina cualquier `.dev.vars` generado dentro de `dist`; los secretos runtime quedan solo como bindings Cloudflare.
- [x] Typecheck app pasa; revalidado localmente el 2026-07-12.
- [x] Typecheck fulfillment Worker pasa; revalidado localmente el 2026-07-12.
- [x] `pnpm lint` pasa. Evidencia: `outputs/launch-verification/2026-06-05T21-58-04-246Z/pnpm-lint.log`; revalidado localmente el 2026-07-12.
- [x] `pnpm test:run` pasa. Evidencia fresca: `outputs/launch-verification/2026-07-12T12-44-05-796Z/pnpm-test-run.log`; 160 archivos y 1.134 tests pasan.
- [x] `pnpm build` pasa. Evidencia fresca: `outputs/launch-verification/2026-07-12T12-44-05-796Z/pnpm-build.log`; revalidado localmente el 2026-07-12.
- [x] Build local no sube sourcemaps a Sentry salvo CI o bandera explicita. Evidencia: `astro.config.mjs`, `.env.example`, `docs/launch/ENVIRONMENT.md`; `pnpm build` local 2026-06-11 pasa sin upload Sentry tras exigir `CI=true` o `SENTRY_UPLOAD_SOURCEMAPS=true`.
- [x] `pnpm launch:sequence` pasa sin fallos ni warnings. Evidencia: `outputs/launch-verification/2026-06-05T21-58-04-246Z/pnpm-launch-sequence.log` y `outputs/launch-sequence/2026-06-05T21-58-30-838Z/summary.md`.
- [x] `pnpm launch:cleanup` pasa sin fallos ni warnings. Evidencia fresca: `outputs/launch-cleanup/2026-07-12T12-54-13-484Z/summary.md`; `dist/` local fue retirado despues de la verificacion y cualquier deploy debe reconstruirlo con el entorno objetivo explicito.
- [x] `pnpm launch:content` pasa sin fallos ni warnings. Evidencia fresca: `outputs/launch-content/2026-07-12T12-45-08-888Z/summary.md`.
- [x] `pnpm launch:seo` pasa sin fallos ni warnings y genera worksheet final SEO/LLM. Evidencia fresca: `outputs/launch-seo/2026-07-12T12-45-09-434Z/summary.md`; rerun antes de Go/No-Go con dominio/copy/legal definitivos.
- [x] `pnpm launch:public-visual` pasa sin fallos y genera capturas desktop/mobile de la home ES y landings SEO prioritarias. Evidencia fresca: `outputs/launch-public-visual/2026-07-12T12-45-10-647Z/summary.md`; rerun antes de Go/No-Go con copy final congelado.
- [ ] `pnpm launch:legal` pasa. Evidencia fresca: `outputs/launch-legal/2026-07-12T12-47-04-333Z/summary.md`; el unico fallo es el modo de ejemplo de titular/controlador, reservado para el cierre legal final.
- [x] `pnpm launch:security` pasa sin fallos ni warnings. Evidencia actual: `outputs/launch-security/2026-07-12T12-47-05-093Z/summary.md`.
- [x] `pnpm launch:operations` pasa sin fallos ni warnings. Evidencia actual: `outputs/launch-operations/2026-07-12T12-47-06-079Z/summary.md`.
- [x] `pnpm launch:payments` pasa sin fallos ni warnings. Evidencia actual: `outputs/launch-payments/2026-07-12T12-47-06-532Z/summary.md`.
- [x] `pnpm launch:final-readiness` pasa sin fallos ni warnings. Evidencia actual: `outputs/launch-final-readiness/2026-07-12T12-47-07-014Z/summary.md`.
- [x] `pnpm launch:accessibility` pasa. Evidencia vigente via `pnpm launch:status` -> `Current Evidence`; ultima revalidacion automatica: `outputs/launch-accessibility/2026-07-12T12-47-08-273Z/summary.md`. La evidencia humana de lector real y movil sigue siendo un gate separado.
- [ ] `pnpm launch:manual-evidence` pasa. Evidencia vigente via `pnpm launch:status` -> `Current Evidence` -> `Manual Evidence Audit`; debe seguir fallando mientras queden checks humanos/final-only en `pending`. No usar conteos antiguos como fuente de verdad: revisar `manual-evidence-index.md`, `next-actions.md`, `phase-1-closure-pack.md` y `final-closure-pack.md` enlazados por el ultimo `pnpm launch:status`.
- [x] `pnpm secrets:check` pasa; revalidado localmente el 2026-07-12 sin secretos obvios en archivos tracked/unignored.
- [x] Deploy Pages staging legado verificado en `https://espanol-honesto-staging.pages.dev` y deployment `https://a2e6f14b.espanol-honesto-staging.pages.dev`; no es el target SSR vigente.
- [x] Cloudflare Astro Worker staging `espanolhonesto-staging` configurado y atestiguado. Evidencia read-only 2026-07-12: versión `2336d565-99cc-449a-b874-4be1bd728222` al 100 %, 18 bindings secretos presentes por nombre, checkout 403 y atestación dual web/fulfillment coincidente; el smoke integral de ciclo completo se controla por separado más abajo.
- [x] Deploy Cloudflare Fulfillment Worker staging verificado. Evidencia 2026-07-12: versión `73047896-82cd-48bd-8f0d-87a638e8f12f` al 100 %; `espanol-honesto-fulfillment-staging` responde `/health` con 200, rechaza rutas internas sin autenticacion con 401, acepta autenticacion interna y expone cron `0 * * * *`; ver tambien `docs/launch/MANUAL_EVIDENCE.local.json` (`operations_external`).
- [ ] Deploy Cloudflare produccion verificado.
- [ ] Deploy Cloudflare Fulfillment Worker production verificado en dos estados: primero `production_bootstrap` con jobs/email/cron desactivados y bloqueo operativo 503; después `production` activo mediante aprobación final separada.
- [ ] Ejecutar bajo aprobaciones separadas y en orden: `pnpm launch:cloudflare-production-fulfillment-bootstrap`, `pnpm launch:cloudflare-production-fulfillment-bootstrap-secrets`, `pnpm launch:cloudflare-production-worker-phase1`, `pnpm launch:cloudflare-production-worker-bootstrap-secrets`; dejar `pnpm launch:cloudflare-production-worker-secrets`, `pnpm launch:cloudflare-production-fulfillment-secrets` y `pnpm launch:cloudflare-production-fulfillment-enable` para la ventana final. Cada runner debe validar las fases previas; los bootstrap atestiguan providers ausentes y las fases activas atestiguan identidad, versión, modo operativo y Supabase. Evidencia canónica: `docs/launch/CLOUDFLARE_PRODUCTION.md`.
- [x] GitHub environment `staging` creado.
- [x] GitHub environment production creado con aprobacion manual (`Production` en GitHub).
- [ ] Branch `staging` creada desde el codigo valido actual.
- [x] Cloudflare Pages project staging legado creado (`espanol-honesto-staging`).
- [x] Cloudflare Pages project production legado creado (`espanolhonesto`) y conserva temporalmente los dominios finales.
- [x] Cloudflare staging KV `SESSION` configurado.
- [x] Secrets basicos del Pages staging legado configurados; esto no demuestra la configuracion del Astro Worker staging.
- [ ] Dominio custom opcional `staging.espanolhonesto.com` no configurado; no bloquea el uso de `https://espanolhonesto-staging.alindev95.workers.dev` como staging estable.
- [ ] GitHub secret `CLOUDFLARE_API_TOKEN` configurado.
- [ ] GitHub secret `FULFILLMENT_WORKER_URL` configurado por entorno.
- [ ] `INTERNAL_JOB_SECRET` configurado igual en Cloudflare Astro Worker y Cloudflare Fulfillment Worker por entorno. Staging quedó verificado criptográficamente contra los Workers vigentes el 2026-07-11; falta production.
- [x] Cloudflare Fulfillment Worker staging creado (`espanol-honesto-fulfillment-staging`, `https://espanol-honesto-fulfillment-staging.alindev95.workers.dev`).
- [ ] Cloudflare Fulfillment Worker production creado.

## Database

- [x] Baseline billing de `database_readiness` reconciliado en staging. Evidencia 2026-07-10: las migraciones `20260710205031`, `20260710215712`, `20260710221846` y `20260710223900` se validaron primero en transaccion con `ROLLBACK`, cada dry-run propuso solo la siguiente migracion, se aplicaron a `mzjyvmlxfpzdfdjzxxyj` y `supabase db lint --schema public --level error` termino sin hallazgos. El cierre vigente de `database_readiness` sigue pendiente de las cuatro migraciones de la fila 207; production no se ha tocado.
- [x] Historial de migraciones staging reconciliado hasta `20260711192817`; no se uso `migration repair` ni se marcaron versiones manualmente.
- [x] Ledger durable de efectos de fulfillment aplicado y verificado en staging mediante `20260711192817_fulfillment_effect_ledger.sql`: tabla vacia, RLS activo, trigger y RPC presentes, sin permisos para `anon`/`authenticated` y acceso exclusivo de `service_role`.
- [x] Supabase staging inicializado con `db/schema.sql`.
- [x] Trigger `handle_new_user` corregido con `search_path = public`. Evidencia: `db/schema.sql`, `supabase/migrations/011_fix_auth_user_trigger_search_path.sql`.
- [x] Usuarios de prueba staging creados.
- [x] Asignacion teacher-student staging creada. Evidencia: consulta read-only Supabase staging 2026-06-10 (`student_teachers=1`).
- [x] Suscripcion activa staging creada para student. Evidencia: consulta read-only Supabase staging 2026-06-10 (`subscriptions.status=active`, count 1).
- [x] Aplicar migraciones hasta `010_node_fulfillment_runtime.sql` en production antes de launch; tambien aplicada `011_fix_auth_user_trigger_search_path.sql`. Evidencia: consulta read-only production 2026-06-10 (`latest_migration=011`, `session_cancellation` habilitado, `handle_new_user` con `search_path=public`).
- [x] Confirmar RLS de tablas sensibles. Evidencia: consulta read-only staging/production 2026-06-10 confirma RLS activo en `profiles`, `profiles_private`, `payments`, `subscriptions`, `sessions`, `student_teachers`, `fulfillment_jobs` y `admin_audit_log`.
- [x] Confirmar postura de backups Supabase Free: production esta en Free y no tiene backups programados nativos; para RC queda aceptado como restriccion documentada. Antes de production deploy, migracion destructiva o Go/No-Go publico se hara backup logico/manual fuera del repo o upgrade a Pro. Evidencia: `outputs/launch-user-evidence/2026-06-11-screenshots/supabase-production-free-plan-no-scheduled-backups.png`, `docs/launch/DECISIONS.md`.
- [x] Confirmar `admin_audit_log`. Evidencia: tabla presente con RLS activo en staging/production; staging registra cancelacion de job desde Admin > Jobs y production contiene entradas de auditoria.
- [x] Confirmar `fulfillment_jobs` visible desde Admin > Jobs. Evidencia: smoke staging 2026-06-10 inserto un job seguro, Worker lo proceso como fallo controlado, Admin > Jobs lo mostro en `failed`, la UI admin lo cancelo y luego aparecio en `cancelled`.
- [x] Aplicar y verificar `support_tickets` con RLS en staging/production. Evidencia: `supabase/migrations/012_support_tickets_and_class_duration.sql`, `supabase/migrations/013_harden_support_tickets_access.sql`; verificacion SQL 2026-06-11 en staging `mzjyvmlxfpzdfdjzxxyj` y production `vkkahxsybhbutszerawz` confirma RLS activo, `anon_select=false`, `authenticated_select=false`, `authenticated_insert=true`, `authenticated_update=false`.
- [x] Hardening de superficie DB/API aplicado en staging/production: `pg_graphql` retirado, helpers admin movidos a `private.is_admin()`, policies admin scoped a `authenticated`, funciones criticas con `search_path` fijado. Evidencia: `supabase/migrations/014_harden_database_api_surface.sql`, `supabase/migrations/015_drop_unused_pg_graphql.sql`, `supabase/migrations/016_move_is_admin_to_private_schema.sql`, `supabase/migrations/017_scope_admin_policies_to_authenticated.sql`; advisors Supabase 2026-06-11 quedan sin findings criticos de GraphQL/admin helper.
- [x] Preflight y plan production fail-closed regenerados tras el hash final del contrato de grants: `pnpm launch:supabase-production-readonly-preflight` confirmó por lectura DB el target exacto `vkkahxsybhbutszerawz`, 24 migraciones semánticas pendientes, `20260710150000` excluida y cero ambigüedades; `pnpm launch:supabase-production-rollout-plan` cerró `PLAN_ONLY_READY` con los 24 hashes en siete olas y cero writes. `supabase db push` y `supabase migration repair` siguen prohibidos. Evidencia fresca: `outputs/launch-supabase-production-readonly-preflight/2026-07-12T17-53-24-443Z/summary.md` y `outputs/launch-supabase-production-rollout-plan/2026-07-12T17-53-30-941Z/summary.md`. El runner ejecutable permanece correctamente `PLAN_ONLY_BLOCKED_BY_EVIDENCE` hasta backup, limpiezas, Auth en cuarentena, staging aplicado y Sentry: `outputs/launch-supabase-production-rollout-runner/2026-07-12T17-53-38-622Z/summary.json`.
- [x] Runner Auth production preparado y probado sin ejecutar production: plan por defecto sin red/writes; preflight agregado sin emails/UUID; borrado secuencial reanudable de 136 usuarios; preservacion exacta de admin/profesor; rotacion aleatoria no retenida; cero refresh sessions; cuarentena por JWT; finalize bloqueado hasta receipt de las 24 migraciones en siete olas y expiracion; cuatro aprobaciones separadas; cero emails/Storage/Stripe/Google. Evidencia local fresca con contador 24: `outputs/launch-supabase-production-auth-cleanup/2026-07-12T17-53-43-579Z/summary.json` (`PLAN_ONLY_READY`, sin red ni writes).
- [ ] Crear y verificar un backup production `public` + `auth` con `pnpm launch:supabase-production-logical-backup`: ruta nueva fuera del repo, directorio Windows EFS confirmado, hash y `backup-receipt.json` fresco. No guardar el dump, PII o hashes de contrasena en el repositorio/evidencias.
- [ ] Ejecutar la limpieza publica v2 con aprobacion exacta: revalidar freeze/snapshot, borrar 111 jobs legacy y `DROP TABLE public.jobs` sin `CASCADE`, borrar 2 tickets y los fixtures dependientes, eliminar `essential`, conservar cuatro paquetes sin referencias Stripe locales y obtener `public-cleanup-receipt.json`. Auth, Storage, Stripe y Google quedan intactos.
- [ ] Reducir Auth con el runner separado: borrar los 136 alumnos fixture, revocar refresh sessions, rotar sin retener credenciales de admin/profesor y obtener `auth-reduced-quarantined-receipt.json` con `auth=2`, `profiles=0`. Mantener production inerte durante la cuarentena.
- [ ] Cerrar los 110 folders fixture de Drive production mediante traslado recuperable a papelera y verificacion, o registrar una deferencia explicita aprobada. Cero borrados permanentes; no tocar raiz, plantilla, permisos, Calendar ni staging.
- [ ] Aplicar realmente y verificar en Supabase staging, en orden, `20260712112000`, `20260712114000`, `20260712114500` y `20260712115000`; production exige cierre `APPLIED_AND_VERIFIED`, no plan ni `ALREADY_APPLIED`. Verificar `leads` obligatorio/defaults, helper admin, `reminder_sent`, las 13 policies de identidad limitadas a `authenticated` con `auth.uid()` cacheable, matriz Data API exacta 1 anon/63 authenticated/0 PUBLIC, RLS 18/18 en tablas concedidas, cero grants sobre tablas sin RLS, defaults globales/de `public` fail-closed, indices, duraciones 30/40/50, trigger/solapes y signup 18+. El plan local fresco está `PLAN_ONLY_READY`, con allowlist/hashes exactos y cero conexiones/writes: `outputs/launch-supabase-staging-hardening-runner/2026-07-12T17-53-19-077Z/summary.md`.
- [ ] Ejecutar y verificar Sentry production hardening: `honestspanish/espanol-honesto-astro`, scrubbing IP y dos workflows exactos, con summary fresco `HARDENED_AND_VERIFIED`. El rollout final vincula el hash de esa evidencia.
- [ ] Aplicar production con `pnpm launch:supabase-production-rollout` y todos sus receipts: `processed_at_small_fix` (1), `base_model_reconciliation` (1), `application_schema` (7), `runtime_and_policy` (7), `billing_contract` (4), `fulfillment_ledger` (1) y `deferred_rc_hardening` (3). Verificar cada ola y el recibo final manteniendo checkout desactivado. No usar el runner legacy `launch:supabase-processed-at-cleanup-runner`: staging ya esta cerrado y ese runner permanece fail-closed para escrituras.
- [ ] Tras las 24 migraciones en siete olas y el vencimiento de la cuarentena, finalizar Auth: crear solo los perfiles/private de admin y profesor y obtener `auth-policy-receipt.json`. No abrir trafico antes.
- [ ] Tras Auth final, ejecutar `pnpm launch:production-availability`: target production exacto, mismo profesor preservado, L-V 09:00-18:00 `Europe/Madrid`, cinco filas verificadas y `production-availability-receipt.json`. Mantener signup/checkout inertes.

## Producto

- [x] Catalogo separado por responsabilidad: `packages` editable/publico, `package_prices` contractual e inmutable, Stripe ejecutor y punteros activos escritos por RPC; frontend lee Supabase y `llms.txt` ya no duplica importes. Evidencia: migraciones billing `20260710205031` a `20260710223900`, `ARCHITECTURE.md`, `docs/launch/PRODUCTS.md`, `public/llms.txt`.
- [x] CRM de paquetes/precios/cuotas. Evidencia: `src/components/admin/ProductCatalogManager.tsx`, `src/pages/api/admin/packages.ts`, `src/pages/[lang]/campus/admin/packages.astro`.
- [x] Onboarding minimo de alumno en dashboard. Evidencia: `src/pages/[lang]/campus/index.astro`, `outputs/launch-accessibility/2026-06-05T21-58-35-434Z/summary.md`.
- [x] Soporte minimo dentro del campus. Evidencia: `src/pages/[lang]/campus/support.astro`, `outputs/launch-accessibility/2026-06-05T21-58-35-434Z/summary.md`.
- [x] Tickets de soporte operativos: alumno/profesor/admin pueden enviar aviso desde tarjetas, queda guardado y admin puede revisarlo/cerrarlo. Evidencia: `src/pages/api/support/alert.ts`, `src/pages/api/admin/support-tickets.ts`, `src/pages/[lang]/campus/support.astro`, `src/pages/[lang]/campus/admin/support.astro`, `tests/api/support-alert.test.ts`, `tests/api/admin-support-tickets.test.ts`, smoke local Playwright 2026-06-11 con ticket `1f95e448-dd98-4ade-a782-b416bf653d92` creado y cerrado, screenshots `outputs/visual-checks/support-smoke-student.png` y `outputs/visual-checks/support-smoke-admin.png`; revalidado con `pnpm test:run` 2026-06-11.
- [x] Duraciones comerciales actualizadas a 30/40/50 minutos con default 50. Evidencia: `src/lib/class-duration.ts`, `supabase/migrations/012_support_tickets_and_class_duration.sql`, `docs/launch/PRODUCTS.md`.
- [x] Landing publica incluye que incluye el curso, a quien va dirigido, comunidad con encaje sin grupos garantizados e IRENE como profesora con su retrato definitivo de staging. Evidencia: `src/components/LandingPage.astro`, `src/assets/avatar_irene.jpg` y smoke visual de la URL estable 2026-07-10.
- [x] Cambios de precio afectan solo nuevas compras. Evidencia: `docs/launch/DECISIONS.md`, `src/pages/api/admin/packages.ts`.
- [x] Copia publica ES/EN/RU reconciliada para RC con paquetes reales. Evidencia: `docs/launch/MANUAL_EVIDENCE.local.json` (`content_review`) y `pnpm launch:status` 2026-06-11 indica Fase 1 clara. Relectura SEO/LLM queda abierta tras copy/legal finales.
- [x] Blog publico sin articulos incompletos indexables: los borradores con notas de redactor quedan excluidos de listado, detalle, RSS, sitemap y OG. Evidencia: `src/content.config.ts`, `src/lib/blog-routes.ts`, `src/pages/[lang]/blog/[slug].astro`, `src/pages/[lang]/blog/index.astro`, `src/pages/[lang]/blog/rss.xml.ts`, `src/pages/sitemap-public.xml.ts`, `src/pages/og/[slug].png.ts`, `scripts/launch/content-audit.ts` y `tests/unit/seo-surface.test.ts`.
- [x] Solicitud de plaza previa a compra directa enriquecida con plan de interes, nivel aproximado, objetivo, disponibilidad y pagina de origen; el endpoint actualiza por email en vez de fallar con duplicados, el CRM admin filtra por estado, muestra los datos de encaje y registra cambios en `admin_audit_log`, y el email automatico confirma revision de encaje antes de compra. Evidencia: `src/components/LeadCaptureForm.tsx`, `src/pages/api/subscribe.ts`, `src/pages/api/admin/leads.ts`, `src/components/admin/LeadManager.tsx`, `src/lib/email/templates.ts`, `supabase/migrations/018_enrich_leads_for_application.sql`, `supabase/migrations/019_capture_preferred_package_on_leads.sql`, `tests/api/subscribe.test.ts`, `tests/api/admin-leads.test.ts`, `tests/unit/email-templates.test.ts`, `tests/unit/lead-manager-source.test.ts`, `tests/e2e/lead-magnet.public.spec.ts`, `outputs/visual-checks/lead-application-2026-06-12T10-44-12-915Z/summary.json`, `outputs/visual-checks/admin-leads-2026-06-12T11-08-24-260Z/summary.json`.
- [x] Checkout UI/API exige alumno, email confirmado, aprobacion CRM exacta, intent unico, catalogo contractual completo y cuenta/modo Stripe coincidentes; la home nunca compra directamente. Evidencia: `src/pages/api/create-checkout.ts`, `src/lib/checkout-approval.ts`, `src/components/account/ApprovedCheckoutCard.tsx` y pruebas dirigidas.
- [x] Politica 18+ aplicada en solicitud, diagnostico, registro, perfil servidor, campus y checkout; checkout conserva version/fecha en Stripe, el perfil no puede falsificarse desde cliente y el alumno sin declaración queda bloqueado en `/[lang]/adult-confirmation`. Evidencia: `src/lib/legal-policy.ts`, `src/lib/adult-account.ts`, formularios/API, middleware y migraciones `20260710120000_enforce_adult_lead_attestation.sql` y `20260710144000_enforce_adult_account_attestation.sql`.
- [x] Cancelacion/caducidad/no-show alineados con terminos: 24 h restaura, <24 h consume, no-show desde +15 min y ninguna reserva posterior a `ends_at`; la cancelación y la restitución de cuota son atómicas e idempotentes. Evidencia: APIs de calendario, `20260710143000_cancel_scheduled_session_atomically.sql` y pruebas unitarias/concurrentes.
- [x] Confirmacion post-pago incluye resumen contractual, renovacion, cuota, fechas, politica de clases, version de terminos y enlaces de soporte/desistimiento; la solicitud de inicio durante desistimiento se acepta por separado en checkout. Evidencia: `src/lib/email/templates.ts`, payload de fulfillment, webhook y checkout.
- [x] Contrato 1/3/6 coherente con runtime: el total se cobra al inicio y concede un banco flexible de `sesiones/mes × meses`, sin tope mensual y con caducidad al final; checkout, términos y email muestran el total del periodo. Evidencia: `src/components/PricingModal.tsx`, `src/pages/[lang]/legal/terminos.astro`, `docs/launch/PRODUCTS.md` y pruebas dirigidas.
- [x] `group` y `hybrid` quedan application-only: pueden solicitarse y sincronizarse como catálogo, pero Admin/API bloquean aprobación y checkout. `group` espera roster/agenda/cuota grupal; `hybrid` espera además un alta verificable con dos profesores. El lanzamiento cobrable inicial queda limitado a `standard` y `bootcamp`. Evidencia: `src/lib/package-pricing.ts`, `src/pages/api/admin/leads.ts`, `src/pages/api/create-checkout.ts`, UI Admin y pruebas.
- [ ] Checkout listo en staging. Parcial 2026-07-11: Sandbox dedicado `espanolhonesto-staging` creado como España/EUR, sus 4 Products/12 Prices sincronizados, Portal fijado, webhook exacto configurado y runtime remoto atestiguado; falta completar y conciliar la compra test y su ciclo real. Live se hace solo en la ventana final.
- [x] Supabase staging reconciliado hasta `20260710223900_harden_checkout_customer_and_snapshot_immutability.sql`; RLS, grants, RPC de Customer exacto, evidencia legal inmutable, serializacion por alumno, recuperacion huérfana, conversion CRM exacta y columnas contractuales verificados por SQL, tipos locales alineados y `db lint` sin errores. El catalogo tiene 12 `package_prices` activas vinculadas al Sandbox correcto.
- [ ] Resolver suscripciones Stripe heredadas antes del rollout billing production. Evidencia read-only 2026-07-10: staging tiene `0` suscripciones Stripe sin `package_price_id`; production, antes de tener esa columna, conserva `27` IDs Stripe del entorno test antiguo (`26` canceladas `essential` de 3 meses y `1` activa `standard` de 6 meses). Confirmar que son fixtures y limpiarlas con respaldo/evidencia, o reconstruir su contrato inmutable; no aplicar billing production ni habilitar webhook live mientras quede alguna sin vinculo.
- [ ] Revisar advisors de seguridad/rendimiento de Supabase despues del cambio billing; el conector instalado no tiene permiso sobre `mzjyvmlxfpzdfdjzxxyj`, por lo que este control no se da por cerrado con el linter SQL.
- [ ] Flujo registro antes de pago validado de extremo a extremo con alta nueva. Parcial: login real de admin/profesor y bloqueo 18+ del alumno validados en la URL estable de staging el 2026-07-10; falta completar un alta nueva deliberada.

## Operacion

- [x] Jobs con reintento/cancelacion desde admin. Evidencia: `src/components/admin/FulfillmentJobsManager.tsx`, `src/pages/api/admin/fulfillment-jobs.ts`.
- [ ] Runbook validado con un incidente simulado. Parcial: incidente controlado de `fulfillment_jobs` staging procesado/cancelado desde Admin > Jobs; guion de `Simulacro De Incidente Y Rollback` documentado en `docs/launch/RUNBOOK.md` y protegido por `pnpm launch:operations`; falta recorrerlo manualmente y ejecutar rollback real o aceptar riesgo explicitamente.
- [ ] Sentry alerts configuradas. Parcial: politica minima de observabilidad y alertas documentada en `docs/launch/OBSERVABILITY.md` y protegida por `pnpm launch:operations`; falta revisar/configurar el dashboard real, owner/canal, privacy scrubbing y prueba segura o riesgo aceptado.
- [x] Proceso de soporte definido: tickets en Supabase/campus admin, email como notificacion, Sentry solo para excepciones tecnicas. Evidencia: `docs/launch/DECISIONS.md`, `src/pages/[lang]/campus/support.astro`, `src/components/admin/SupportTicketsManager.tsx`.
- [x] Proceso de rotacion de claves definido. Evidencia: `docs/launch/RUNBOOK.md` (`Rotacion Final De Claves`), `docs/launch/ENVIRONMENT.md` (`Rotacion Final De Claves`) y `docs/launch/DECISIONS.md`; la ejecucion real de la rotacion sigue final-only antes de Go/No-Go.
- [ ] Proceso de rollback probado. Parcial: historial de deployments revisado en Cloudflare Pages staging/production y Worker staging; guion tabletop en `docs/launch/RUNBOOK.md`; falta ejecutar rollback real o aceptar riesgo explicitamente.

## Integraciones

- [ ] Stripe test staging con compra, webhook, confirmacion contractual, portal, cancelacion y reembolso/reconciliacion.
- [x] Arnes integral limitado a staging: exige primero `--preflight-only`, usa solo las tres cuentas `TEST_*`/allowlist existentes, crea cero usuarios Auth, no depende del buzon del alumno y limpia sesiones/suscripcion de scheduling, disponibilidad temporal del profesor, Google artifacts y job/audits temporales, restaurando el perfil y preservando la evidencia Checkout/CRM/pagos y los IDs reutilizables. Si el profesor no tiene huecos reales, crea una sola fila temporal con UUID preasignado y exige borrado verificado en `finally`. Evidencia: `scripts/smoke/real-env-smoke.ts`, `scripts/smoke/real-env-smoke-safety.ts`, `scripts/launch/staging-smoke-rehearsal-runner.ts` y `tests/unit/real-env-smoke-safety.test.ts`.
- [x] Gate de checkout staging: `CHECKOUT_ENABLED_OVERRIDE=false` se mantuvo durante todo el smoke; cuenta `d1a22bcf6477ff2ff31d2bfb83084e44`, Worker `espanolhonesto-staging`, versiones desplegadas y probe 403 quedaron atestiguados antes de writes. El runner no cambio Cloudflare. Evidencia: `outputs/launch-staging-smoke-rehearsal-runner/2026-07-12T08-49-24-788Z/summary.md`.
- [x] Checkout test completado y reutilizado: el smoke valido una sesion real completada y su reconciliacion, sin crear ni expirar otra Checkout. Evidencia combinada: `outputs/launch-staging-billing-lifecycle/2026-07-12T08-15-09-474Z/summary.json` y `outputs/real-env-smoke/2026-07-12T08-49-35-568Z/summary.json`.
- [x] Ciclo billing canonico staging: `pnpm launch:staging-billing-lifecycle:preflight` paso y la ejecucion gated reanudada termino `OK`, checkpoint `complete`, renovacion/fallo/recuperacion/cancelacion, reembolso parcial y total verificados, con pago inicial y warm-up preservados. Evidencia: `outputs/launch-staging-billing-lifecycle/2026-07-12T08-15-09-474Z/summary.json`.
- [x] Smoke integral staging ejecutado con `SMOKE_COMPLETED_CHECKOUT_SESSION_ID` y `SMOKE_BILLING_LIFECYCLE_EVIDENCE_PATH` del mismo ciclo, precondiciones antes del primer write, seis destinatarios Resend exactos, scheduling/cancelacion/rebook/completada/no-show/reminder, Drive/Docs/Calendar/Meet, paneles profesor/admin y retry/cancel de Admin Jobs. Resultado child `ok`, 0 secciones fallidas y cleanup `ok`; el runner termino sin timeout duro. La auditoria independiente read-only confirmo presupuesto 6/dia y 9/mes, 0 sesiones/suscripciones/availability/jobs/audits/effects temporales y perfil/asignacion restaurados. Evidencia: `outputs/launch-staging-smoke-rehearsal-runner/2026-07-12T08-49-24-788Z/summary.md` y `outputs/real-env-smoke/2026-07-12T08-49-35-568Z/summary.json`.
- [ ] Configurar la disponibilidad operativa real del profesor antes de abrir reservas. Hallazgo 2026-07-12: staging tenia cero filas `teacher_availability`; el smoke pudo validar el flujo con una fila temporal eliminada, pero eso no sustituye el horario real de production ni el de staging para demos/reservas manuales.
- [x] Smoke production separado: `scripts/smoke/real-env-smoke.ts` esta prohibido en production; el launch day usa `production-minimal-smoke-checklist.md` manual, sin usuarios sinteticos ni repetir la matriz Drive/Calendar/email. Evidencia: `scripts/launch/final-smoke-execution-pack.ts`, `scripts/launch/final-readiness-audit.ts` y `docs/launch/RUNBOOK.md`.
- [x] Aviso de renovación implementado localmente: `invoice.upcoming` encola `renewal_notice` durable e idempotente y envía fecha, importe, periodo, plazo/canales y consecuencia en ES/EN/RU mediante la pasarela de email.
- [ ] Gate externo. Parcial 2026-07-11: webhook staging configurado con exactamente los ocho eventos requeridos por `src/lib/stripe-webhook-events.ts`, incluido `checkout.session.expired`; `Upcoming renewal events` quedó guardado y reverificado en 15 días en la Sandbox staging `acct_1TruqOC22M3erP0j`. Falta cerrar la entrega real en el siguiente periodo del Test Clock y repetir la misma configuración/evidencia en Stripe live antes de habilitar cobros.
- [ ] Stripe live production en la ventana final: el lanzamiento aceptara pagos reales desde el primer dia; mantener default y override `false` hasta Go/No-Go.
- [x] Google folders/templates staging. Revalidado en el smoke integral 2026-07-12: DWD, root, plantilla, carpeta persistente, Docs, Calendar, Meet, permiso publico y permiso explicito temporal funcionaron. La auditoria posterior confirmo 0 archivos activos nuevos, los 4 hijos previos intactos, permiso temporal del profesor eliminado y 0 eventos activos; los 4 eventos de prueba quedaron solo como tombstones `cancelled`, comportamiento esperado de Calendar.
- [ ] Guardar IDs Google staging en KeePassXC.
- [ ] Google folders/templates produccion.
- [x] Resend staging/test. Evidencia integral 2026-07-12: exactamente 6 emails individuales allowlisted, 3 al alumno y 3 al profesor, desglosados en 2 confirmaciones, 2 recordatorios y 2 cancelaciones; los 6 estan `delivered`, con exactamente 6 `POST /emails` 200, 0 destinatarios externos y presupuesto final 6/dia, 9/mes. No fue necesario acceder al buzon del alumno.
- [ ] Resend produccion.
- [ ] Turnstile dominios reales.
- [x] Cloudflare Fulfillment Worker con service binding privado `FULFILLMENT_SERVICE`, `FULFILLMENT_WORKER_URL`, `PUBLIC_SITE_URL`, `INTERNAL_JOB_SECRET` y `CRON_SECRET`: staging separado y atestiguado; `espanolhonesto-staging` ejecuta `2336d565-99cc-449a-b874-4be1bd728222` y `espanol-honesto-fulfillment-staging` ejecuta `73047896-82cd-48bd-8f0d-87a638e8f12f`, ambos al 100 %, checkout cerrado e identidad de versión verificada el 2026-07-12. `espanol-honesto-fulfillment-staging-queue` tiene productor/consumidor exactos, batch/concurrencia 1, cinco reintentos, 30 s y DLQ `espanol-honesto-fulfillment-staging-dlq`; un sentinel sin alumno/paquete probó productor y consumidor con un único intento, 0 variación del presupuesto Resend y cleanup final `cancelled`. El preflight posterior quedó `OK` 0/0 y el trigger horario `0 * * * *` sigue sincronizado. Production Worker, Queue production, secretos live y smoke final quedan fuera de este cierre de staging.

## Legal

- [ ] Datos reales del titular. Ahora hay datos visibles de ejemplo centralizados y marcados; `LEGAL_IDENTITY_MODE='example'` bloquea gate y build production hasta sustituirlos por datos verificados.
- [ ] Privacidad revisada. ES/EN/RU ya comparten estructura, politica 18+ y subprocesadores; falta validacion legal humana del texto completo y transferencias/retencion.
- [ ] Cookies revisada.
- [ ] Terminos revisados. Ya reflejan 18+, recurrencia 1/3/6, caducidad, 24 h, no-show +15 min, desistimiento, devoluciones y modelo; falta asesoria y validacion externa de aviso de renovacion/portal/reembolso.
- [ ] Fiscalidad/facturación confirmada antes de live: un asesor debe validar si los importes públicos son precios finales con impuestos incluidos o si el servicio está exento/usa otro tratamiento, y qué datos debe recoger la factura. El checkout actual falla cerrado a importe EUR exacto y no añade impuestos automáticamente; no crear Prices live ni abrir cobros hasta documentar esta decisión.
- [ ] Subprocesadores revisados: Supabase, Stripe, Google, Resend, Sentry, Cloudflare.

## Marketing/SEO

- [x] Sitemap. Evidencia estatica: `outputs/launch-verification/2026-06-05T21-58-04-246Z/summary.md`; local 2026-06-11 `/sitemap-public.xml` responde 200 y no contiene campus/demo ni legal mientras legal siga con `noindex`.
- [x] Robots. Evidencia estatica: `outputs/launch-verification/2026-06-05T21-58-04-246Z/summary.md`; local 2026-06-11 `/robots.txt` responde 200 y bloquea API/campus/login/demo; `tests/unit/seo-surface.test.ts` protege reglas public/private.
- [x] Canonical/hreflang. Evidencia estatica: `outputs/launch-verification/2026-06-05T21-58-04-246Z/summary.md`; `tests/unit/seo-surface.test.ts` protege canonical, hreflang ES/EN/RU/x-default y `noindex`.
- [x] OG images. Evidencia estatica: `outputs/launch-verification/2026-06-05T21-58-04-246Z/summary.md`; `tests/unit/seo-surface.test.ts` protege primitivos OG en `src/layouts/BaseLayout.astro`.
- [x] JSON-LD de landings alineado con paquetes reales. Evidencia: `src/lib/landing-schema.ts`, `src/lib/landing-data.ts`; smoke local 2026-06-11 confirma `/es`, `/en` y `/ru` con 4 cursos reales, precios 50/145/150/345 y sin claves legacy `essential`/`premium` en HTML.
- [x] Mapa LLM publico creado. Evidencia: `public/llms.txt`; local 2026-06-11 `/llms.txt` responde 200 y enumera fuentes publicas, paquetes actuales y rutas privadas que no deben usarse; `tests/unit/seo-surface.test.ts` protege paquetes actuales y excluye planes legacy.
- [ ] SEO/LLM final con dominio/copy/legal definitivos (`seo_llm_final`): snippets, indexabilidad publica, exclusiones privadas/demo/API, fuente rusa premium/fallback, datos estructurados si aplica, Search Console cuando este disponible y contenido consumible por buscadores y asistentes. Runbook: `docs/launch/SEO_LLM_FINAL.md`. Worksheet generada por `pnpm launch:seo`: `outputs/launch-seo/<timestamp>/seo-llm-final-worksheet.md`.
- [x] Copy ES/EN/RU para RC. Automatico: claves criticas, placeholders, codificacion visible y paridad i18n OK en `outputs/launch-content/2026-06-05T21-58-31-819Z/summary.md`; revision humana de calidad, precios y tono cerrada en `docs/launch/MANUAL_EVIDENCE.local.json` (`content_review`). Relectura final queda dentro de SEO/LLM tras legal/copy definitivos.
- [x] Analitica/telemetria decidida para RC: pospuesta deliberadamente. Si se activa mas adelante, revisar legal/cookies/consentimiento, retencion y privacidad antes de publicar. Evidencia: `docs/launch/POST_LAUNCH_BACKLOG.md`.
- [x] Reviews reales decididas para RC: pospuestas hasta tener testimonios reales y permiso. No inventar prueba social. Evidencia: `docs/launch/POST_LAUNCH_BACKLOG.md`.
- [x] Canal publico de Telegram decidido para RC: pospuesto hasta crear canal, politica editorial/moderacion y mantenimiento real. Evidencia: `docs/launch/POST_LAUNCH_BACKLOG.md`.
- [x] Prueba de nivel definitiva decidida para RC: pospuesta, no prometida como evaluacion humana gratuita universal, y documentada como formato asincrono recomendado con documento breve + video/audio de habla, rubricado manualmente solo para solicitudes serias o alumnos. Evidencia: `docs/launch/LEVEL_CHECK.md`, `docs/launch/CONVERSION_ARCHITECTURE.md`, `src/components/LeadCaptureForm.tsx`, `tests/unit/landing-public-content.test.ts`.
- [x] Backlog post-launch revisado para el alcance RC actual: fuente viva en `docs/launch/POST_LAUNCH_BACKLOG.md`; si cambia el alcance, reabrir el item correspondiente y rerun `pnpm launch:gate`.

## Smoke Final

- [ ] Registro.
- [ ] Checkout.
- [ ] Webhook.
- [ ] Confirmacion contractual por email.
- [ ] Cancelacion de renovacion en Stripe Portal.
- [ ] Reembolso parcial y total en Stripe test, reconciliacion en `payments` y ejecución del procedimiento manual de cancelación/acceso/cuota/reservas sin repetir el reembolso.
- [ ] Drive bienvenida.
- [ ] Email bienvenida.
- [ ] Reserva clase.
- [ ] Doc.
- [ ] Calendar/Meet.
- [ ] Confirmaciones email.
- [ ] Recordatorio.
- [ ] Cancelacion.
- [ ] Reintento job fallido.

## Revision Secundaria

La segunda revision debe ejecutarse despues de `pnpm launch:verify` y antes de cualquier decision de lanzamiento.

- [x] Revisar `outputs/launch-verification/<timestamp>/summary.md`. Evidencia: `outputs/launch-secondary-review/2026-06-05T22-32-08-362Z/secondary-review.md`.
- [x] Abrir logs fallidos o warnings y confirmar si son bloqueadores. Evidencia: `outputs/launch-secondary-review/2026-06-05T22-32-08-362Z/secondary-review.md` confirma bloqueo legal, evidencia manual fallida, frescura OK y 0 warnings primarios.
- [x] Confirmar que los checks estaticos cubren la frontera demo/dev/SEO, pnpm-only, Cloudflare/Google, legal detectable mediante `pnpm launch:legal`, secuencia launch, SEO privado/publico, limpieza no destructiva, contenido/i18n/codificacion, seguridad automatica, operacion automatica, pagos automaticos, preparacion final automatica, accesibilidad automatica, launch gate automation y documentacion de entorno. Evidencia: `outputs/launch-verification/2026-06-05T21-58-04-246Z/summary.md`.
- [x] Confirmar que los checks automaticos no sustituyen smoke real de Stripe, Google, Resend y Cloudflare Fulfillment Worker. Evidencia: `outputs/launch-secondary-review/2026-06-05T22-32-08-362Z/secondary-review.md` mantiene Go/No-Go operativos abiertos.
- [x] Confirmar que la revision secundaria detecta evidencia obsoleta, rutas de evidencia inexistentes, dashboard sin `launch:gate`, marcas `[x]` sin prueba explicita y perdida del agrupado por fases. Evidencia: `outputs/launch-secondary-review/2026-06-05T22-32-08-362Z/secondary-review.md`.
- [x] Confirmar que cada item legal/operativo marcado como hecho tiene evidencia externa o decision humana. Evidencia: `outputs/launch-secondary-review/2026-06-05T22-32-08-362Z/secondary-review.md`.
- [x] Confirmar que la revision secundaria exige audit de evidencia manual antes de declarar READY. Evidencia: `outputs/launch-secondary-review/2026-06-05T22-32-08-362Z/secondary-review.md`.
- [x] Emitir decision: `BLOCKED`, `READY_WITH_ACCEPTED_RISKS` o `READY`. Decision actual: `BLOCKED`, evidencia: `outputs/launch-secondary-review/2026-06-05T22-32-08-362Z/secondary-review.md`.

## Cleanup Gate

Candidatos revisados antes de launch:

- [x] `pnpm launch:cleanup` pasa y es no destructivo. Evidencia: `outputs/launch-cleanup/2026-06-05T21-58-31-269Z/summary.md`.
- [x] `tmp/`: scripts historicos obsoletos eliminados; `tmp/` queda ignorado y puede existir como carpeta local de logs/temp. Evidencia: `outputs/launch-cleanup/2026-06-05T21-58-31-269Z/summary.md`, `docs/launch/CLEANUP.md`.
- [x] `outputs/demo-runs/`: evidencias locales de demo eliminadas o absorbidas por `outputs/`. Evidencia: `docs/launch/CLEANUP.md` y `outputs/launch-cleanup/2026-06-05T21-58-31-269Z/summary.md`.
- [x] `db/audit_fixes.sql`: eliminado; su contenido ya esta absorbido por `db/schema.sql` y migraciones 006/007. Evidencia: `outputs/launch-cleanup/2026-06-05T21-58-31-269Z/summary.md`.
- [x] `docs/launch/CURRENT_STATUS.md`: eliminado para evitar estado paralelo; pendientes vigentes quedan en esta checklist. Evidencia: `outputs/launch-cleanup/2026-06-05T21-58-31-269Z/summary.md`.
- [x] Backups/temp versionados detectables estan documentados. Evidencia: `outputs/launch-cleanup/2026-06-05T21-58-31-269Z/summary.md` registra `.agents/skills/cloudflare/references/r2-sql/SKILL.md.backup`.
- [x] `.agent/` y `.agents/`: se mantienen versionadas hasta launch y se revisan despues. Evidencia: `docs/launch/CLEANUP.md`, `docs/launch/MANUAL_EVIDENCE.local.json` (`cleanup_agents_decision`), `outputs/launch-cleanup/2026-06-05T21-58-31-269Z/summary.md`, `outputs/launch-cleanup/2026-06-05T21-58-31-269Z/agent-tooling-inventory.md`, `outputs/launch-cleanup/2026-06-05T21-58-31-269Z/agent-tooling-decision-worksheet.md`.
