# Espanol Honesto

Plataforma para academia online de espanol: web publica multilingue, campus privado, pagos, reservas de clases, Google Workspace, emails transaccionales y CRM admin.

## Stack

- Astro 6 SSR en Cloudflare Workers.
- React islands para UI interactiva.
- Supabase Auth/Postgres/RLS.
- Stripe Checkout, Portal y webhooks.
- Cloudflare Fulfillment Worker para jobs Google/Resend.
- Google Workspace con service account y domain-wide delegation.
- Resend para emails.
- Cloudflare Turnstile.
- Sentry.
- pnpm 10.33.0 como unico gestor de paquetes.

## Comandos

```bash
pnpm dev
pnpm build
pnpm preview
pnpm deploy
pnpm deploy:production
pnpm typecheck
pnpm lint
pnpm test:run
pnpm test:e2e --project=public
pnpm fulfillment:dev
pnpm fulfillment:typecheck
pnpm google:setup-staging
pnpm dev:demo
pnpm demo:local
pnpm demo:tunnel
pnpm launch:cleanup
pnpm launch:sequence
pnpm launch:content
pnpm launch:seo
pnpm launch:legal
pnpm launch:security
pnpm launch:operations
pnpm launch:payments
pnpm launch:final-readiness
pnpm launch:accessibility
pnpm launch:manual-evidence:init
pnpm launch:manual-evidence:record
pnpm launch:manual-evidence
pnpm launch:phase1
pnpm launch:verify
pnpm launch:secondary-review
pnpm launch:status
pnpm launch:rc
pnpm launch:gate
```

## Demo Guiada

La demo guiada esta aislada del runtime normal. Solo aparece si `DEMO_GUIDE_ENABLED=true`; `pnpm dev:demo` activa esa bandera y redirige `/demo` a `/es?demo=launcher&demoStart=1`. Con la bandera apagada, `/demo` y `/:lang/demo` devuelven `404` con `noindex` en vez de redirigir a paginas publicas. La guia tiene 40 pasos, panel movible, modo compacto y login automatico local mediante `/api/demo/login`. Las rutas demo quedan excluidas del sitemap y deshabilitadas en `robots.txt`.

Para prepararla en local, crea `.env.test` desde `.env.test.example` con los usuarios de prueba. Luego usa:

```bash
pnpm dev:demo
pnpm demo:tunnel
pnpm demo:local
pnpm demo:report
```

`pnpm dev:demo` carga `.env` y despues `.env.test`, arranca Astro en modo test y habilita la demo y su login solo en hosts permitidos. `pnpm demo:tunnel` publica el servidor local con Cloudflare Tunnel si `cloudflared` esta instalado.

## Launch Gate

El lanzamiento usa una secuencia reproducible de verificacion:

```bash
pnpm launch:gate
```

`launch:gate` ejecuta, en orden, `launch:verify`, `launch:phase1`, `launch:secondary-review` y `launch:status`, escribe un resumen en `outputs/launch-gate/`, genera un `evidence-index.json` con primaria, Fase 1 y evidencia manual para que la secundaria valide la corrida actual, y sale con error mientras el gate este bloqueado. `launch:phase1` ejecuta la evidencia manual dentro de su propia secuencia, asi que los comandos individuales siguen disponibles para depurar sin duplicar conceptos. Si se ejecutan comandos sueltos despues del gate, `launch:status` marca `Full Launch Gate` como `STALE` hasta que se vuelva a ejecutar `pnpm launch:gate` antes de Go/No-Go.

`launch:sequence` audita que `docs/launch/LAUNCH_SEQUENCE.md` exista, este enlazado y mantenga separadas las tareas de ahora de los bloqueos final-only sin desbloquear `READY`. `launch:cleanup` audita de forma no destructiva archivos historicos, artefactos locales ignorados y la decision pendiente sobre `.agent/.agents`. `launch:accessibility` ejecuta un smoke Playwright/axe de paginas publicas, login, legales, paginas de segmento SEO y redireccion privada sin sesion. `launch:content` audita i18n, placeholders, codificacion rota visible y rutas localizadas criticas. `launch:seo` audita crawlability, sitemap/robots, canonical/hreflang, JSON-LD, `/llms.txt` y genera `outputs/launch-seo/<timestamp>/seo-llm-final-worksheet.md`; no sustituye Search Console, Core Web Vitals ni revision final de copy/legal. `launch:legal` audita paginas legales, placeholders de titular/controlador, subprocesadores, cookies, decision de terminos y flujo de evidencia legal; no sustituye asesoria legal ni revision humana. `launch:security` audita invariantes estaticas de RLS, RBAC, secretos, webhooks, Turnstile e integraciones internas. `launch:operations` audita CI/deploy, Cloudflare Fulfillment Worker, fulfillment jobs, recuperacion admin, entorno y runbook. `launch:payments` audita invariantes estaticas de checkout, Stripe webhook, portal, catalogo, schema, tests, smokes y docs; no sustituye una compra Stripe test real ni validacion live. `launch:final-readiness` genera worksheets de cierre para `integration_readiness` y `final_smoke` sin activar servicios live. `launch:manual-evidence:init` crea o sincroniza en modo seguro `docs/launch/MANUAL_EVIDENCE.local.json` sin sobrescribir evidencia existente. `launch:manual-evidence:record` registra checks locales en dry run por defecto y solo escribe con `--write`; no sustituye la comprobacion humana ni debe contener secretos. `launch:manual-evidence` valida el formato y frescura de las evidencias humanas/externas registradas en `docs/launch/MANUAL_EVIDENCE.local.json` y genera `manual-evidence-index.md`, `next-actions.md` y `phase-1-closure-pack.md` con los pendientes accionables agrupados por fase. `launch:phase1` ejecuta solo las auditorias de apoyo inmediatas y escribe `outputs/launch-phase-1/`; sale con error mientras queden pendientes de limpieza, contenido, accesibilidad manual, base de datos, operacion o seguridad externa. `launch:verify` ejecuta checks automaticos, incluidos esos smokes, y escribe evidencias en `outputs/launch-verification/`. `launch:secondary-review` revisa esas evidencias contra `docs/launch/CHECKLIST.md`, el indice de evidencia del gate o el ultimo `launch:status`, valida `Current Evidence`, exige evidencia manual valida y bloquea el launch mientras queden Go/No-Go blockers o revision secundaria sin cerrar. `launch:status` resume la ultima corrida de `launch:gate`, una tabla `Current Evidence`, un `Urgency Summary`, `Release Candidate Readiness`, `Phase 1 Focus`, los pendientes manuales agrupados por fase, siguientes acciones y `final-closure-pack.md`; no sustituye los checks del Gate. `launch:rc` evalua solo readiness de Release Candidate, puede pasar con bloqueos final-only abiertos y debe fallar mientras queden pendientes de Fase 1; Stripe/payment smoke queda final-only mientras no se acepten pagos reales.

La secuencia de trabajo esta en `docs/launch/LAUNCH_SEQUENCE.md`: separa tareas para cerrar ahora de bloqueos final-only como datos legales reales, Stripe live, rotacion final de API keys y smoke de produccion.

## Arquitectura Operativa

La app principal vive en un Cloudflare Astro Worker. Las rutas API de la app no importan Google SDKs ni procesan jobs pesados.

El trabajo pesado se delega a `workers/fulfillment`, desplegado como Cloudflare Worker:

- Procesa `fulfillment_jobs`.
- Crea carpetas Drive, documentos, eventos Calendar y Meet.
- Envia emails Resend.
- Filtra disponibilidad contra Google Calendar.
- Ejecuta recordatorios.

El Astro Worker y el Fulfillment Worker se comunican con `FULFILLMENT_WORKER_URL` y `INTERNAL_JOB_SECRET`.

## Entornos Y Deploy

- `dev`: local, `http://localhost:4321`.
- `staging`: rama `staging`, `https://staging.espanolhonesto.com`.
- `production`: rama `main`, `https://espanolhonesto.com`.

CI valida typecheck, lint, tests, build, E2E publico y secrets-check. En `push` a `staging` o `main`, despliega el Cloudflare Astro Worker y el Cloudflare Fulfillment Worker solo si la validacion pasa. El environment `production` de GitHub debe requerir aprobacion manual.

Para E2E, ejecuta proyectos Playwright de forma secuencial o en una unica invocacion con varios `--project`. No lances dos procesos `playwright test` separados a la vez en el mismo workspace, porque comparten `test-results/artifacts`. Playwright usa un worker por defecto para que el dev server y el estado de autenticacion sean deterministas; usa `PLAYWRIGHT_WORKERS=<n>` solo para diagnosticos explicitos de paralelismo.

## Fuentes De Verdad

- Arquitectura: `ARCHITECTURE.md`
- Base de datos: `db/schema.sql`
- Migraciones aplicables: `supabase/migrations/`
- Productos/precios: Supabase `packages`, gestionado desde `/es/campus/admin/packages`
- Decisiones de lanzamiento: `docs/launch/DECISIONS.md`
- Secuencia de launch: `docs/launch/LAUNCH_SEQUENCE.md`
- Runbook: `docs/launch/RUNBOOK.md`
- Variables de entorno: `docs/launch/ENVIRONMENT.md`

No uses documentos historicos como referencia de estado actual.
