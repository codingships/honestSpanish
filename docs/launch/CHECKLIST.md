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
- [x] Seguridad manual/externa: baseline RC cerrado sin rotar claves finales. RLS en Supabase real verificado por SQL; `support_tickets` queda sin lectura directa desde cliente, `pg_graphql` fue retirado al no usarse, y las policies admin usan `private.is_admin()` scoped a `authenticated`; Worker staging rechaza rutas internas sin autenticacion; Turnstile validado contra secret configurado con fake token rechazado; Cloudflare Turnstile/Worker logs visibles en capturas. Quedan para cierre final: rotacion de claves, live-domain review, activar leaked password protection en Supabase Auth, decidir si mover `btree_gist` fuera de `public` y revisar la tabla legacy `public.jobs` de production. Evidencia: `docs/launch/MANUAL_EVIDENCE.local.json` (`security_external`), `supabase/migrations/013_harden_support_tickets_access.sql`, `supabase/migrations/014_harden_database_api_surface.sql`, `supabase/migrations/015_drop_unused_pg_graphql.sql`, `supabase/migrations/016_move_is_admin_to_private_schema.sql`, `supabase/migrations/017_scope_admin_policies_to_authenticated.sql`, `outputs/launch-user-evidence/2026-06-11-screenshots/cloudflare-turnstile-landing-analytics.png`, `outputs/launch-user-evidence/2026-06-11-screenshots/cloudflare-worker-staging-settings-cron-observability.png`.
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
- [x] Pipeline preparado para deploy del Cloudflare Astro Worker y del Fulfillment Worker tras CI. Evidencia: `.github/workflows/ci.yml`, `wrangler.toml`, `workers/fulfillment/wrangler.toml`.
- [x] Typecheck app pasa.
- [x] Typecheck fulfillment Worker pasa.
- [x] `pnpm lint` pasa. Evidencia: `outputs/launch-verification/2026-06-05T21-58-04-246Z/pnpm-lint.log`; revalidado localmente el 2026-06-11.
- [x] `pnpm test:run` pasa. Evidencia: `outputs/launch-verification/2026-06-05T21-58-04-246Z/pnpm-test-run.log`; revalidado localmente el 2026-06-11 con 147 tests.
- [x] `pnpm build` pasa. Evidencia: `outputs/launch-verification/2026-06-05T21-58-04-246Z/pnpm-build.log`; revalidado localmente el 2026-06-11 con warnings no bloqueantes de Sentry sourcemaps.
- [x] Build local no sube sourcemaps a Sentry salvo CI o bandera explicita. Evidencia: `astro.config.mjs`, `.env.example`, `docs/launch/ENVIRONMENT.md`; `pnpm build` local 2026-06-11 pasa sin upload Sentry tras exigir `CI=true` o `SENTRY_UPLOAD_SOURCEMAPS=true`.
- [x] `pnpm launch:sequence` pasa sin fallos ni warnings. Evidencia: `outputs/launch-verification/2026-06-05T21-58-04-246Z/pnpm-launch-sequence.log` y `outputs/launch-sequence/2026-06-05T21-58-30-838Z/summary.md`.
- [x] `pnpm launch:cleanup` pasa sin fallos ni warnings. Evidencia: `outputs/launch-verification/2026-06-05T21-58-04-246Z/pnpm-launch-cleanup.log`, `outputs/launch-cleanup/2026-06-05T21-58-31-269Z/summary.md` y `outputs/launch-cleanup/2026-06-05T21-58-31-269Z/agent-tooling-decision-worksheet.md`.
- [x] `pnpm launch:content` pasa sin fallos ni warnings. Evidencia: `outputs/launch-verification/2026-06-05T21-58-04-246Z/pnpm-launch-content.log` y `outputs/launch-content/2026-06-05T21-58-31-819Z/summary.md`.
- [x] `pnpm launch:seo` pasa sin fallos ni warnings y genera worksheet final SEO/LLM. Evidencia: `outputs/launch-seo/<timestamp>/summary.md` y `outputs/launch-seo/<timestamp>/seo-llm-final-worksheet.md`; rerun antes de Go/No-Go con dominio/copy/legal definitivos.
- [x] `pnpm launch:public-visual` pasa sin fallos y genera capturas desktop/mobile de la home ES y landings SEO prioritarias. Evidencia: `outputs/launch-public-visual/<timestamp>/summary.md`; rerun antes de Go/No-Go con copy final congelado.
- [ ] `pnpm launch:legal` pasa. Ultima evidencia: `outputs/launch-legal/2026-06-05T21-58-32-287Z/summary.md` falla por datos legales reales pendientes.
- [x] `pnpm launch:security` pasa sin fallos ni warnings. Evidencia: `outputs/launch-verification/2026-06-05T21-58-04-246Z/pnpm-launch-security.log` y `outputs/launch-security/2026-06-05T21-58-32-972Z/summary.md`.
- [x] `pnpm launch:operations` pasa sin fallos ni warnings. Evidencia: `outputs/launch-verification/2026-06-05T21-58-04-246Z/pnpm-launch-operations.log` y `outputs/launch-operations/2026-06-05T21-58-33-421Z/summary.md`.
- [x] `pnpm launch:payments` pasa sin fallos ni warnings. Evidencia: `outputs/launch-verification/2026-06-05T21-58-04-246Z/pnpm-launch-payments.log` y `outputs/launch-payments/2026-06-05T21-58-33-837Z/summary.md`.
- [x] `pnpm launch:final-readiness` pasa sin fallos ni warnings. Evidencia: `outputs/launch-verification/2026-06-05T21-58-04-246Z/pnpm-launch-final-readiness.log` y `outputs/launch-final-readiness/2026-06-05T21-58-34-283Z/summary.md`.
- [x] `pnpm launch:accessibility` pasa. Evidencia vigente via `pnpm launch:status` -> `Current Evidence`; ultima revalidacion local conocida: `outputs/launch-accessibility/2026-06-12T14-20-42-919Z/summary.md`.
- [ ] `pnpm launch:manual-evidence` pasa. Evidencia vigente via `pnpm launch:status` -> `Current Evidence` -> `Manual Evidence Audit`; debe seguir fallando mientras queden checks humanos/final-only en `pending`. No usar conteos antiguos como fuente de verdad: revisar `manual-evidence-index.md`, `next-actions.md`, `phase-1-closure-pack.md` y `final-closure-pack.md` enlazados por el ultimo `pnpm launch:status`.
- [x] `pnpm secrets:check` pasa. Evidencia: `outputs/launch-verification/2026-06-05T21-58-04-246Z/pnpm-secrets-check.log`.
- [x] Deploy Pages staging legado verificado en `https://espanol-honesto-staging.pages.dev` y deployment `https://a2e6f14b.espanol-honesto-staging.pages.dev`; no es el target SSR vigente.
- [ ] Cloudflare Astro Worker staging `espanolhonesto-staging` configurado con secretos por nombre y smoke directo completo. El Worker existe, pero el preflight read-only de 2026-07-10 devuelve cero secretos para el Worker web.
- [x] Deploy Cloudflare Fulfillment Worker staging verificado. Evidencia: `espanol-honesto-fulfillment-staging` responde `/health` con 200, rechaza rutas internas sin autenticacion con 401, acepta autenticacion interna y expone cron `0 * * * *`; ver tambien `docs/launch/MANUAL_EVIDENCE.local.json` (`operations_external`).
- [ ] Deploy Cloudflare produccion verificado.
- [ ] Deploy Cloudflare Fulfillment Worker produccion verificado.
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
- [ ] `INTERNAL_JOB_SECRET` configurado igual en Cloudflare Astro Worker y Cloudflare Fulfillment Worker por entorno. Staging debe verificarse de nuevo en los Workers vigentes; falta production.
- [x] Cloudflare Fulfillment Worker staging creado (`espanol-honesto-fulfillment-staging`, `https://espanol-honesto-fulfillment-staging.alindev95.workers.dev`).
- [ ] Cloudflare Fulfillment Worker production creado.

## Database

- [ ] `database_readiness` RC cerrado con hosted schema actual. El dry-run real de 2026-07-10 contra staging `mzjyvmlxfpzdfdjzxxyj` se nego a escribir porque 16 versiones remotas no existen localmente; `20260710120000` y `20260710123000` siguen solo en local. Reconciliar el historial sin `migration repair` automatico, volver a ejecutar dry-run y aplicar/verificar staging antes de tocar production.
- [ ] Historial de migraciones staging reconciliado: documentar la equivalencia de las 16 versiones remotas sin archivo local y de las migraciones locales antiguas ausentes del historial remoto. No marcar versiones como applied/reverted sin revisar su SQL/esquema real.
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

## Producto

- [x] Fuente runtime de productos: Supabase `packages`. Evidencia: `docs/launch/DECISIONS.md`, `src/components/LandingPage.astro`, `src/pages/api/create-checkout.ts`.
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
- [x] Checkout UI/API listo solo en paquetes activos con Stripe IDs completos. Evidencia: `outputs/launch-payments/2026-06-05T21-58-33-837Z/summary.md`.
- [x] Politica 18+ aplicada en solicitud, diagnostico, registro, perfil servidor, campus y checkout; checkout conserva version/fecha en Stripe, el perfil no puede falsificarse desde cliente y el alumno sin declaración queda bloqueado en `/[lang]/adult-confirmation`. Evidencia: `src/lib/legal-policy.ts`, `src/lib/adult-account.ts`, formularios/API, middleware y migraciones `20260710120000_enforce_adult_lead_attestation.sql` y `20260710144000_enforce_adult_account_attestation.sql`.
- [x] Cancelacion/caducidad/no-show alineados con terminos: 24 h restaura, <24 h consume, no-show desde +15 min y ninguna reserva posterior a `ends_at`; la cancelación y la restitución de cuota son atómicas e idempotentes. Evidencia: APIs de calendario, `20260710143000_cancel_scheduled_session_atomically.sql` y pruebas unitarias/concurrentes.
- [x] Confirmacion post-pago incluye resumen contractual, renovacion, cuota, fechas, politica de clases, version de terminos y enlaces de soporte/desistimiento; la solicitud de inicio durante desistimiento se acepta por separado en checkout. Evidencia: `src/lib/email/templates.ts`, payload de fulfillment, webhook y checkout.
- [ ] Checkout listo en datos reales de staging/live: paquetes activos tienen Stripe IDs del modo correcto y compra test completada.
- [x] Supabase staging reconciliado y verificado hasta `20260710150000_staging_integration_smoke_runs.sql`, incluidas mayoría de edad, refunds, cancelación atómica y arnés cercado de smoke. Replay limpio independiente 37/37, RLS/grants comprobados y `db push --dry-run` posterior sin pendientes el 2026-07-10. Production solo tras backup/preflight y aprobación exacta.
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
- [x] Aviso de renovación implementado localmente: `invoice.upcoming` encola `renewal_notice` durable e idempotente y envía fecha, importe, periodo, plazo/canales y consecuencia en ES/EN/RU mediante la pasarela de email.
- [ ] Gate externo: configurar `invoice.upcoming` a 15 días en los webhooks Stripe test/live y verificar una entrega real en staging antes de habilitar cobros.
- [ ] Stripe live production en la ventana final: el lanzamiento aceptara pagos reales desde el primer dia; mantener default y override `false` hasta Go/No-Go.
- [x] Google folders/templates staging. Root, plantilla, Docs, Calendar y Meet quedaron verificados en el smoke cercado del 2026-07-10 después de compartir el calendario externo de `TEST_TEACHER_EMAIL` con `GOOGLE_ADMIN_EMAIL` usando “ver solo libre/ocupado”. El ensayo creó y verificó carpeta, documento, evento y Meet, añadió deberes, envió exactamente un email allowlisted y terminó con `cleanup=ok` y `result=ok`; la cuenta del alumno no compartió calendario ni concedió permisos.
- [ ] Guardar IDs Google staging en KeePassXC.
- [ ] Google folders/templates produccion.
- [x] Resend staging/test. Evidencia: envio directo de smoke a `TEST_ADMIN_EMAIL` devolvio HTTP 200; no se usaron destinatarios de alumnos ni contenido privado.
- [ ] Resend produccion.
- [ ] Turnstile dominios reales.
- [x] Cloudflare Fulfillment Worker con service binding privado `FULFILLMENT_SERVICE`, `FULFILLMENT_WORKER_URL`, `PUBLIC_SITE_URL`, `INTERNAL_JOB_SECRET` y `CRON_SECRET`: staging separado y atestiguado; `espanolhonesto-staging` ejecuta `e28549c4-f35d-45cc-ac8f-0da8ab80fdfb` y `espanol-honesto-fulfillment-staging` ejecuta `9be2ea8f-427d-4834-b7fb-311c5d1e4c50`, ambos al 100 %, checkout cerrado e identidad de versión verificada el 2026-07-10. El candidato web pasó el smoke integral antes de promoción y la URL estable pasó el preflight posterior; el trigger horario `0 * * * *` sigue sincronizado en fulfillment staging. Production Worker, binding production, secretos live y smoke final quedan fuera de este cierre de staging.

## Legal

- [ ] Datos reales del titular. Ahora hay datos visibles de ejemplo centralizados y marcados; `LEGAL_IDENTITY_MODE='example'` bloquea gate y build production hasta sustituirlos por datos verificados.
- [ ] Privacidad revisada. ES/EN/RU ya comparten estructura, politica 18+ y subprocesadores; falta validacion legal humana del texto completo y transferencias/retencion.
- [ ] Cookies revisada.
- [ ] Terminos revisados. Ya reflejan 18+, recurrencia 1/3/6, caducidad, 24 h, no-show +15 min, desistimiento, devoluciones y modelo; falta asesoria y validacion externa de aviso de renovacion/portal/reembolso.
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
- [ ] Reembolso test y reconciliacion en `payments`.
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
