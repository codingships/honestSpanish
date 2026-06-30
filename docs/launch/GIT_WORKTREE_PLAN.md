# Git Worktree Plan

Estado: guia de revision antes de staging/commit. No sustituye `git status`; agrupa el arbol actual para evitar commits mezclados.

Gate operativo:

- Ejecutar `corepack pnpm launch:worktree` para generar un inventario fresco bajo `outputs/launch-worktree/<timestamp>/`.
- El comando no hace staging, commit, borrados ni movimientos. Solo lee `git status` y escribe `summary.md`, `worktree-inventory.md`, `commit-package-plan.md`, `package-file-lists/`, `rc-staging-package.md`, `rc-staging-package-files.txt`, `rc-staging-runtime-diff.patch` y `rc-staging-runtime-manifest.json`.
- `summary.json` incluye `fileListPath` por paquete para que las listas planas sean consumibles sin parsear Markdown.
- Estado `WARNING` es normal si hay cambios pendientes; estado `FAILED` indica que se ha colado algo que no deberia versionarse, como `.env`, `outputs/`, `tmp/`, locks ajenos o logs.

## Regla Principal

- Versionar codigo, tests, migraciones, scripts de launch y documentacion estable.
- No versionar evidencia local, secretos, outputs generados ni estado interno de agente.
- Hacer commits por paquete funcional, no por orden accidental de archivos.
- Usar `outputs/launch-worktree/<timestamp>/package-file-lists/` como listas planas de revision por paquete; no son comandos automaticos de staging.

## No Versionar

- `.codex-ops/`: estado local de Codex Ops OS. Queda ignorado en `.gitignore`; no es runtime ni fuente de verdad del producto.
- `outputs/`: evidencias generadas por comandos de launch; ya esta ignorado.
- `docs/launch/MANUAL_EVIDENCE.local.json`: evidencia humana/local, ya ignorada.
- `.env`, `.env.*`, `.dev.vars`: secretos o configuracion local, ya ignorados salvo ejemplos.
- Archivos temporales bajo `tmp/` o `supabase/.temp/`.

## Decision De Herramientas De Agente

`.agent/` y `.agents/` siguen siendo decision humana separada.

Recomendacion para este proyecto:

- Mantener `.agents/skills/*` durante el cierre, porque Alin quiere que las skills utiles vivan dentro del proyecto.
- Revisar en commit separado si `.agent/` historico sigue aportando algo o se puede retirar.
- Eliminar solo candidatos claramente temporales/backup despues de confirmacion, por ejemplo `.agents/skills/cloudflare/references/r2-sql/SKILL.md.backup`.
- No mezclar cambios de herramientas de agente con el producto runtime.

Inventario vigente:

- `.agent/`: 6 archivos, 8.9 KB.
- `.agents/`: 335 archivos, 1.46 MB.
- Evidencia: `outputs/launch-cleanup/2026-06-26T08-12-04-377Z/agent-tooling-inventory.md`.

## Paquetes De Commit Recomendados

## Precondiciones Para Congelar RC

No congelar release candidate mientras sigan abiertos:

- `database_readiness`.
- `operations_external`.

Primero hay que cerrar esos checks con evidencia fresca y sin secretos. Despues ejecutar:

- `corepack pnpm launch:phase1`
- `corepack pnpm launch:rc`
- `corepack pnpm launch:status`

Para staging no basta con que el guard exista localmente. El paquete desplegado en Cloudflare Pages staging debe incluir los archivos runtime de la slice minima y demostrar que `/api/create-checkout` queda bloqueado con `403 Checkout is disabled`, no con `400 priceId is required`.

Estado actual: Cloudflare Pages staging `espanol-honesto-staging` ya fue desplegado y verificado con `403 Checkout is disabled`. Si se vuelve a redesplegar staging o se cambia runtime/config de checkout, repetir `corepack pnpm launch:no-real-payments -- --deployed-url https://espanol-honesto-staging.pages.dev` antes de congelar RC.

Si `launch:staging-no-real-payments-remediation` marca `local_deployment_gap`, no tratar `CHECKOUT_ENABLED=false` como arreglo suficiente por si solo. Primero hay que empaquetar/commitear o desplegar exactamente los archivos que implementan el guard; solo despues la variable puede servir como evidencia de que checkout queda bloqueado.

El archivo generado `rc-staging-package.md` resume esa slice minima, compara working tree contra `HEAD` y deja visible si el guard ya esta listo localmente pero todavia no forma parte del source que podria desplegar Cloudflare. El archivo `rc-staging-package-files.txt` deja la misma slice como lista plana para revisar los archivos exactos antes de empaquetar/deployar staging. El archivo `rc-staging-runtime-diff.patch` es un diff review-only de los archivos runtime requeridos; no aplicarlo a ciegas ni tratarlo como aprobacion para desplegar. El archivo `rc-staging-runtime-manifest.json` deja hashes y estado de snippets del guard para comparar la slice de runtime sin parsear Markdown.

Este plan no autoriza writes externos ni final-only: no autoriza Cloudflare, Supabase, Stripe live, production Pages, `CHECKOUT_ENABLED=true`, pagos reales, secretos finales, legal real, dominio/Search Console ni smoke production.

Mantener `.agent/` y `.agents/` como decision separada de tooling. No mezclar herramientas de agente con commits de runtime/producto.

## Slice Minimo RC Sin Cobros Reales

Antes de redesplegar staging o revalidar `no_real_payments_staging`, revisar esta slice transversal. No sustituye los paquetes de commit; existe porque el bloqueo de Cloudflare staging depende de archivos repartidos entre pagos, runtime/config y launch docs.

Aunque el deployed probe actual este cerrado con `403 Checkout is disabled`, un `HEAD` sin el guard no sirve como evidencia de source control para futuros redeploys. Si se cambia runtime/config de checkout, hay que empaquetar o commitear esta slice exacta antes de confiar en `CHECKOUT_ENABLED=false`.

Requeridos para que staging pueda servir el guard:

- `src/pages/api/create-checkout.ts`: devuelve `403 Checkout is disabled` antes de parsear body, Supabase o Stripe salvo que `CHECKOUT_ENABLED=true`.
- `src/lib/runtime-env.ts`: lectura correcta de variables runtime en Cloudflare/Astro.
- `wrangler.toml`: default no secreto `CHECKOUT_ENABLED = "false"` para Pages.

Evidencia y runbook que deben viajar cerca del cambio:

- `.env.example`: postura documentada `CHECKOUT_ENABLED=false`.
- `tests/api/create-checkout.test.ts`: regresion fail-closed antes de Supabase/Stripe.
- `tests/unit/no-real-payments-runbook.test.ts`: contrato de runbook.
- `scripts/launch/no-real-payments.ts`: prueba local y probe desplegado.
- `scripts/launch/staging-no-real-payments-remediation.ts`: diagnostico read-only de Cloudflare staging y `local_deployment_gap`.
- `docs/launch/NO_REAL_PAYMENTS.md`: interpretacion de `403` vs `400` y scope de aprobacion.

Validacion minima:

- `corepack pnpm exec vitest run --coverage=false tests/api/create-checkout.test.ts tests/unit/no-real-payments-runbook.test.ts`
- `corepack pnpm launch:no-real-payments`
- Despues de deploy/config staging aprobado: `corepack pnpm launch:no-real-payments -- --deployed-url https://espanol-honesto-staging.pages.dev`
- Si staging sigue fallando: `corepack pnpm launch:staging-no-real-payments-remediation`

Artefactos utiles:

- `rc-staging-package.md`: manifiesto humano de readiness local vs `HEAD`.
- `rc-staging-package-files.txt`: lista plana de runtime + evidencia.
- `rc-staging-runtime-diff.patch`: diff review-only limitado a `src/pages/api/create-checkout.ts`, `src/lib/runtime-env.ts` y `wrangler.toml`.
- `rc-staging-runtime-manifest.json`: hashes SHA-256 y estado `workingTreeGuardReady`/`headGuardReady` de la slice runtime.

No autoriza Supabase writes, production Pages, Stripe live, `CHECKOUT_ENABLED=true`, pagos reales ni final secrets.

### 1. Base De Launch Y Limpieza Historica

Incluye:

- `AGENTS.md`, `README.md`, `ARCHITECTURE.md`, `CLAUDE.md`.
- Eliminacion de auditorias/status historicos obsoletos.
- `docs/launch/*` base: checklist, decisiones, entorno, runbook, final closure, manual evidence, cleanup.
- `scripts/launch/*`.
- `public/robots.txt`, `public/llms.txt`, SEO/sitemap/llms.

Validacion minima:

- `corepack pnpm launch:worktree`
- `corepack pnpm launch:cleanup`
- `corepack pnpm launch:sequence`
- `corepack pnpm launch:status`

### 2. Superficie Publica, SEO Y Conversion

Incluye:

- Landing ES/EN/RU y paginas SEO de segmento.
- `src/components/LandingPage.astro`, `src/components/PricingSection.tsx`, `src/components/LeadCaptureForm.tsx`.
- `src/lib/landing-data.ts`, `src/lib/landing-schema.ts`, `src/pages/sitemap-public.xml.ts`.
- Tests de contenido publico, SEO, i18n y E2E de solicitud de plaza.

Validacion minima:

- `corepack pnpm exec vitest run --coverage=false tests/unit/landing-public-content.test.ts tests/unit/seo-surface.test.ts tests/unit/landing-schema.test.ts tests/e2e/lead-magnet.public.spec.ts`
- `corepack pnpm launch:seo`
- `corepack pnpm launch:public-visual` si hay servidor/navegador disponible.

### 3. CRM, Solicitudes Y Diagnostico De Nivel

Incluye:

- `src/lib/crm/*`.
- `src/pages/api/subscribe.ts`, `src/pages/api/level-check.ts`, `src/components/LevelCheckForm.tsx`.
- Admin CRM/leads/contactos/tareas/oportunidades.
- Migraciones CRM y lead diagnostics.
- `docs/launch/LEVEL_CHECK.md`, `docs/launch/FUNCTIONAL_GAP_ROADMAP.md`.

Validacion minima:

- `corepack pnpm exec vitest run --coverage=false tests/api/subscribe.test.ts tests/api/level-check.test.ts tests/api/admin-leads.test.ts tests/unit/crm-lead-capture.test.ts tests/unit/crm-contact-detail.test.ts tests/unit/crm-task-list.test.tsx tests/unit/crm-opportunity-list.test.tsx`
- `corepack pnpm typecheck`

### 4. Emails, Soporte Y Onboarding

Incluye:

- `src/lib/email/*`.
- `src/pages/api/support/*`, campus support/admin support.
- Fulfillment onboarding, class emails, first-class activation.
- Admin email previews.
- `docs/launch/EMAIL_MATRIX.md`.

Validacion minima:

- `corepack pnpm exec vitest run --coverage=false tests/unit/email-templates.test.ts tests/api/email-send-test.test.ts tests/api/support-alert.test.ts tests/api/admin-support-tickets.test.ts tests/unit/crm-onboarding.test.ts tests/unit/crm-class-email.test.ts tests/unit/session-fulfillment.test.ts`
- `corepack pnpm fulfillment:typecheck`

### 5. Pagos Bloqueados, Stripe Test Y Worker Fulfillment

Incluye:

- `src/pages/api/create-checkout.ts`, `src/pages/api/stripe-webhook.ts`.
- `src/lib/fulfillment/*`, `workers/fulfillment/*`.
- `CHECKOUT_ENABLED=false` por defecto.
- Admin packages/payments/jobs.
- `scripts/launch/payments-audit.ts`.

Validacion minima:

- `corepack pnpm exec vitest run --coverage=false tests/api/create-checkout.test.ts tests/api/stripe-webhook.test.ts tests/unit/fulfillment-jobs.test.ts tests/api/admin-packages.test.ts tests/api/admin-fulfillment-jobs.test.ts`
- `corepack pnpm launch:payments`
- `corepack pnpm fulfillment:typecheck`

### 6. Calendario, Profesores Y Campus

Incluye:

- APIs de calendario, disponibilidad, sesiones recurrentes/bulk.
- Componentes de calendario y dashboard campus.
- Reglas de duracion 30/40/50 y Meet no cortado automaticamente.

Validacion minima:

- `corepack pnpm exec vitest run --coverage=false tests/api/sessions-create.test.ts tests/api/session-action.test.ts tests/api/available-slots.test.ts tests/api/bulk-sessions.test.ts tests/api/recurring-sessions.test.ts tests/api/teacher-availability.test.ts tests/unit/StudentClassList.test.tsx tests/unit/TeacherCalendar.test.tsx`

### 7. Dependencias, Configuracion Y CI

Incluye:

- `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`.
- `.github/workflows/ci.yml`, `.gitignore`, `.env.example`, `.env.test.example`.
- Configuracion Astro/Tailwind/content.

Validacion minima:

- `corepack pnpm launch:worktree`
- `corepack pnpm test:run`
- `corepack pnpm typecheck`
- `corepack pnpm lint`
- `corepack pnpm build`
- `git diff --check`

### 8. Herramientas De Agente

Commit separado y opcional.

Incluye:

- `.agent/`
- `.agents/`
- `.agents/skills/thermo-nuclear-action-plan/`

Decision recomendada:

- Mantener las skills de proyecto que se usan.
- Eliminar backups obvios solo con confirmacion.
- No mezclar con runtime ni launch docs.

## Estado Operativo Actual

Ultima evidencia fuerte de higiene Git:

- Branch actual: `main`.
- HEAD actual: `f05719c`.
- `corepack pnpm --config.verify-deps-before-run=false launch:worktree`: `WARNING` esperado por arbol sucio, 346 items, 0 failed risks y 0 warnings internos.
- Inventario fresco: `outputs/launch-worktree/2026-06-26T21-18-07-795Z/summary.md`.
- Plan de paquetes fresco: `outputs/launch-worktree/2026-06-26T21-18-07-795Z/commit-package-plan.md`.
- Listas planas por paquete: `outputs/launch-worktree/2026-06-26T21-18-07-795Z/package-file-lists/`.
- Slice Cloudflare Pages staging: `outputs/launch-worktree/2026-06-26T21-18-07-795Z/rc-staging-package.md`.
- Resultado de slice: `Working tree guard ready: yes`, `Current HEAD guard ready: no`, `Required runtime files present: yes`.
- Implicacion: el arbol local tiene el guard sin cobros reales, pero el `HEAD` que podria desplegar Cloudflare no lo contiene completo; `src/pages/api/create-checkout.ts`, `src/lib/runtime-env.ts` y `wrangler.toml` deben viajar en el paquete/deploy staging antes de confiar en `CHECKOUT_ENABLED=false`.

Ultima evidencia operativa de launch:

- Ultima validacion runtime local:
  - `corepack pnpm --config.verify-deps-before-run=false fulfillment:typecheck`: PASS (`command-2026-06-26T21-12-26-433940-00-00`).
  - `corepack pnpm --config.verify-deps-before-run=false lint`: PASS (`command-2026-06-26T21-12-28-219939-00-00`).
  - `corepack pnpm --config.verify-deps-before-run=false typecheck`: PASS (`command-2026-06-26T21-12-29-640646-00-00`).
  - `corepack pnpm --config.verify-deps-before-run=false test:run`: PASS, 65 archivos y 402 tests (`command-2026-06-26T21-12-55-908413-00-00`).
  - `corepack pnpm --config.verify-deps-before-run=false build`: PASS (`command-2026-06-26T21-15-30-782681-00-00`).
- `corepack pnpm --config.verify-deps-before-run=false launch:status`: `BLOCKED`, 9 blockers, 0 warnings y 9 Open Go/No-Go.
- Estado fresco: `outputs/launch-status/2026-06-26T22-24-21-933Z/summary.md`.
- Full Launch Gate fresco: `outputs/launch-gate/2026-06-26T21-27-25-187Z/summary.md`, `BLOCKED` con 3 pasos fallidos.
- Primary verification fresco: `outputs/launch-verification/2026-06-26T21-27-25-628Z/summary.md`, `BLOCKED` por `pnpm launch:legal`.
- Secondary review fresco: `outputs/launch-secondary-review/2026-06-26T21-31-46-535Z/secondary-review.md`, `BLOCKED`.
- RC fresco: `outputs/launch-rc/2026-06-26T21-20-29-677Z/summary.md`, `RC_BLOCKED_BY_PHASE_1`. El status puede marcarlo stale porque el gate posterior regenero Phase 1/manual evidence; no perseguir ese ping-pong salvo antes de re-freeze RC.
- Fase 1 fresca: `outputs/launch-phase-1/2026-06-26T21-30-37-606Z/summary.md`, bloqueada por `database_readiness` y `operations_external`.
- Manual evidence fresco: `outputs/launch-manual-evidence/2026-06-26T21-31-44-923Z/summary.md`, Fase 1 con 2 abiertos y Fase 3 con 6 final-only.
- Functional RC fresco: `outputs/launch-functional-rc/2026-06-26T21-21-51-162Z/summary.md`, OK y 0 failed groups.
- Payments audit fresco: `outputs/launch-payments/2026-06-26T22-08-14-270Z/summary.md`, OK, 0 fallos y 0 warnings.
- Operations audit fresco: `outputs/launch-operations/2026-06-26T21-31-43-057Z/summary.md`, OK y con hosted schema check SQL fresco.
- Supabase staging rollout fresco: `outputs/launch-staging-database-rollout/2026-06-26T22-15-05-233Z/summary.md`, paquete local OK y `readyForStagingApproval=true`.
- Staging operations preflight fresco: `outputs/launch-staging-operations-preflight/2026-06-26T22-23-21-497Z/summary.md`, OK con Wrangler read-only incluido.
- Operations external fresco: `outputs/launch-operations-external-closure/2026-06-26T22-24-11-865Z/summary.md`, `WARNING` esperado por evidencia manual pendiente.
- No-real-payments desplegado fresco: `outputs/launch-no-real-payments/2026-06-26T22-08-11-444Z/summary.md`, OK contra `https://espanol-honesto-staging.pages.dev`.
- Cloudflare Pages staging no-real-payments fresco: `outputs/launch-staging-no-real-payments-remediation/2026-06-26T22-09-01-053Z/summary.md`, `WARNING` esperado solo por `local_deployment_gap`; `deployed_checkout_probe` OK.
- RC external closure fresco: `outputs/launch-rc-external-closure/2026-06-26T22-24-11-876Z/summary.md`, `WARNING` esperado con Cloudflare OK y pendientes Supabase staging/operations evidence.
- RC external next approval fresco: `outputs/launch-rc-external-closure/2026-06-26T22-24-11-876Z/next-approval.md`, acotado a `supabase_staging_schema_rollout`.
- Guia de refresco: `docs/launch/RC_EVIDENCE_REFRESH.md`.

Bloqueos restantes:

- Legal real.
- Evidencia final de pagos o decision sin pagos.
- Integraciones production.
- SEO/LLM final con dominio/copy/legal/pagos definitivos.
- Smoke production/final.
- Fuente rusa premium.
- Decision separada sobre herramientas de agente.
- Resolver/verificar `database_readiness` con staging primero y evidencia no secreta; el paquete Supabase staging local esta fresco y listo para aprobacion contra `espanol-staging`.
- Cerrar `operations_external` con cron/logs, Resend staging y Admin Jobs staging UI/runtime; el preflight Worker/Wrangler staging ya esta fresco y OK.
