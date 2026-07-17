# Launch Sequence

Este documento separa lo que conviene cerrar ahora de lo que se deja deliberadamente para el final. El estado `BLOCKED` del Launch Gate es correcto mientras falten datos legales reales, evidencia manual o servicios externos finales.

## Decisiones actuales

- Los datos reales legales los completara Alin manualmente al final. No se inventan ni se rellenan con datos temporales.
- Stripe se mantiene en modo prueba por ahora. Stripe live y los precios live se validan al final, justo antes de pagos reales.
- Todas las API keys se rotaran antes del lanzamiento real. La evidencia final de seguridad debe generarse despues de esa rotacion.
- Supabase se mantiene en Free para el RC. Esto implica que no hay backups programados nativos. El rollout inerte de production exige primero un backup lógico EFS fresco; la ventana final exige además confirmar un backup/export vigente o subir a Pro antes del Go/No-Go público.
- SEO para buscadores y LLMs queda como cierre final despues de estabilizar copy, legal y dominios.
- Reviews, canal publico de Telegram, telemetria de uso y prueba de nivel definitiva quedan fuera del RC salvo decision posterior explicita.
- El backlog de piezas aplazadas vive en `docs/launch/POST_LAUNCH_BACKLOG.md`; si una tarea de ese backlog entra en launch, debe moverse a esta secuencia, checklist y evidencia antes del siguiente Gate.
- La secuencia operativa de cierre final vive en `docs/launch/FINAL_CLOSURE.md`; se usa solo cuando Alin decida entrar en ventana real de Go/No-Go.
- La telemetria no se activa hasta tener base legal/cookies/consentimiento revisados.
- Las incidencias normales de soporte se guardan como tickets en Supabase/campus admin; Sentry queda para excepciones tecnicas.
- La demo queda en segundo plano: puede existir como herramienta dev/test, pero no debe interferir en runtime normal, navegacion publica, SEO, build ni deploy. Con la bandera apagada, las rutas demo fallan cerrado con `404` y `noindex`.
- Antes de declarar `READY`, deben pasar `pnpm launch:gate`, evidencia manual, revision secundaria y smoke final.

## Fase 1: ordenar ahora

Objetivo: dejar el proyecto limpio, verificable y sin deuda confusa antes de tocar legal real o Stripe live.

Hacer ahora:

- Decidir que pasa con `.agent/` y `.agents/`: mantener en repo, mover fuera del repo o borrar tras copiar lo util.
- Revisar contenido humano ES/EN/RU: precios, tono, formularios, emails, estados vacios y errores.
- Hacer accesibilidad manual: teclado, foco, lector de pantalla, zoom 200%, mobile real o equivalente.
- Revisar baseline de seguridad externa sin cerrar claves definitivas: Supabase RLS, ubicacion de service role, Turnstile/WAF actual, Sentry/Cloudflare logs y permisos visibles que afecten al RC.
- Validar servicios staging que no dependan de pagos live: Supabase separado de production, Cloudflare Fulfillment Worker staging, Resend staging, Workers Logs/observability, postura Supabase Free sin backups programados, rollback y recuperacion de jobs. Cron config, deployment staging y secret-name evidence quedan cubiertos por el preflight read-only de staging.
- Ejecutar `pnpm launch:operations-external-closure` para reunir la evidencia local y los huecos manuales de `operations_external`.
- Mantener `docs/launch/MANUAL_EVIDENCE.local.json` actualizado con evidencia real, sin secretos.
- Ejecutar `pnpm launch:phase1` hasta que no queden blockers de Fase 1; puede seguir fallando el Launch Gate completo por legal, Stripe live o smoke final.

No hace falta cerrar ahora:

- Datos reales del titular/controlador legal.
- Stripe live.
- Rotacion final de todas las API keys.
- Backup logico/manual de la ventana final o upgrade a Pro. El backup EFS previo al rollout production inerte pertenece a Fase 2 y no se aplaza.
- SEO/LLM final.
- Smoke final de produccion.
- Reviews reales.
- Canal publico de Telegram.
- Telemetria de uso.
- Prueba de nivel definitiva.
- Articulos de blog incompletos: deben permanecer con `draft: true` hasta quitar notas de redactor, plantillas vacias y lorem ipsum.

## Fase 2: release candidate

Objetivo: llegar a un candidato que tecnicamente funcione y solo conserve bloqueos finales conscientes.

Condiciones esperadas:

- `pnpm typecheck`, `pnpm fulfillment:typecheck`, `pnpm lint`, `pnpm test:run`, `pnpm build` pasan.
- `pnpm launch:worktree` no detecta archivos no versionables; `WARNING` es aceptable mientras existan cambios pendientes sin commit.
- `pnpm launch:cleanup`, `pnpm launch:content`, `pnpm launch:seo`, `pnpm launch:public-visual`, `pnpm launch:security`, `pnpm launch:operations`, `pnpm launch:payments` y `pnpm launch:accessibility` pasan sin warnings relevantes.
- `pnpm launch:functional-rc` pasa para demostrar solicitud, CRM, emails, diagnostico, onboarding, seguridad sin cobros reales y soporte con tests locales/mock.
- El simulacro de incidente, las alertas Sentry y la prueba/aceptacion explicita del rollback estan cerrados con evidencia no secreta; son bloqueadores RC aunque las integraciones production activas sigan final-only.
- `pnpm launch:no-real-payments -- --deployed-url <staging-url>` pasa para confirmar que el entorno desplegado responde 403 temprano en `/api/create-checkout`; sin URL puede quedar solo con warning de confirmacion manual. No debe haber ningun camino publico que abra Stripe Checkout sin decision explicita.
- Si el probe desplegado devuelve `400 priceId is required`, ejecutar `pnpm launch:staging-no-real-payments-remediation` y corregir Cloudflare Pages staging antes de cerrar no-cobros.
- `pnpm launch:rc-external-closure` genera la hoja unica `outputs/launch-rc-external-closure/<timestamp>/rc-external-closure-pack.md` para Cloudflare checkout blocking, Supabase staging rollout y operations evidence antes de pedir writes externos.
- `pnpm launch:phase1` ya no bloquea por checks inmediatos.
- Cloudflare production queda preparado, pero no activo: Queue/DLQ sin consumidores, Fulfillment y web en bootstrap, un único HMAC interno compartido, cero Cron, cero proveedores activos, sin rutas/DNS y checkout desactivado.
- Supabase production completa las 25 migraciones allowlisted por olas después de Auth inerte, backup EFS, limpieza/preservación aprobada y reconciliación de fixtures; después quedan exactamente admin + profesor y cinco filas de disponibilidad L-V 09:00-18:00 `Europe/Madrid`.
- `pnpm launch:rc` pasa cuando Fase 1 y `production_inert_preparation` están cerradas. Stripe Live, proveedores activos, dominios, datos legales y smoke siguen final-only.
- `pnpm launch:legal` puede seguir fallando solo por datos legales reales pendientes.
- `pnpm launch:manual-evidence` puede seguir fallando solo por checks final-only documentados.
- `pnpm launch:secondary-review` confirma que no hay contradicciones entre checklist, evidencia y estado real.

La decision vigente es aceptar pagos reales desde el primer dia. El modo sin pagos reales queda como rollback: checkout debe quedar desactivado, oculto o bloqueado por `CHECKOUT_ENABLED_OVERRIDE=false` sin desactivar webhook ni reconciliacion de cobros ya realizados.

## Fase 3: cierre final

Objetivo: sustituir los bloqueos deliberados por evidencia real.

Runbook operativo: `docs/launch/FINAL_CLOSURE.md`.

Orden recomendado:

1. Congelar copy publico, paquetes, dominio y la activacion ya decidida de pagos reales desde el primer dia.
2. Completar los datos legales reales en `src/lib/legal-identity.ts`, cambiar el modo a `verified` y comprobar aviso/privacidad/terminos en ES/EN/RU.
3. Revisar aviso legal, privacidad, cookies, terminos y subprocesadores con criterio humano.
4. Stripe live: completar primero compra/cancelacion/reembolso test staging; despues configurar keys, Prices, webhook y Portal live manteniendo `CHECKOUT_ENABLED_OVERRIDE=false` hasta el Go/No-Go.
5. Ejecutar backup logico/manual de Supabase fuera del repo o subir a Pro si se necesita backup gestionado antes de production/destructivo.
6. Rotar claves solo despues de congelar copy, legal, pagos y dominio definitivos; configurar secretos definitivos por entorno.
7. Verificar Cloudflare Astro Worker, Cloudflare Fulfillment Worker, Supabase, Google, Resend, Turnstile, Sentry y cron en entorno real.
8. Ejecutar `pnpm launch:seo` y `pnpm launch:public-visual`; revisar SEO/LLM final: sitemap, robots, canonical/hreflang, structured data si aplica, snippets, contenido indexable, paginas que no deben indexarse y render visual desktop/mobile de la superficie publica.
9. Decidir reviews, Telegram, telemetria y prueba de nivel definitiva solo si entran en launch; si se activa telemetria, actualizar legal/cookies/consentimiento antes.
10. Ejecutar smoke final: registro 18+, checkout con aceptaciones, webhook, confirmacion contractual, Drive, email, reserva, Doc, Calendar/Meet, recordatorio, cancelacion, reembolso/reconciliacion y retry de job.
11. Ejecutar `pnpm launch:gate`.
12. Si la checklist se actualiza despues del Gate, ejecutar `pnpm launch:secondary-review` y `pnpm launch:status`.

## Evidencia manual por momento

| Check | Momento recomendado | Que demuestra |
| --- | --- | --- |
| `cleanup_agents_decision` | Fase 1 | Decision sobre `.agent/` y `.agents/`. |
| `content_review` | Fase 1 | Copy, precios, emails y estados revisados por humano. |
| `accessibility_manual` | Fase 1 | UX accesible mas alla de axe/Playwright. |
| `security_external` | Fase 1 y repetir en Fase 3 | Baseline RC de RLS, WAF/Turnstile actual, logs y permisos visibles; rotacion final queda para Fase 3. |
| `operations_external` | Fase 1 y repetir en Fase 3 | Worker staging, jobs, Resend staging, Workers Logs/observability, postura Supabase Free y rollback baseline; cron config/deployment/secret-name evidence por preflight staging. |
| `database_readiness` | Fase 1 y repetir en Fase 3 | Supabase staging/production separados, migraciones, RLS, tablas criticas y postura Free sin backups programados. |
| `payments_staging` | Fase 3 | Stripe test end-to-end en staging antes de activar live: checkout, webhook, Portal, confirmacion contractual, cancelacion y reembolso/reconciliacion. |
| `legal_owner_controller` | Fase 3 | Datos legales reales aplicados sin placeholders. |
| `legal_human_review` | Fase 3 | Texto legal y subprocesadores revisados por humano. |
| `integration_readiness` | Fase 3 | Stripe live para pagos desde el primer dia y rollback cerrado, Cloudflare Astro Worker, Cloudflare Fulfillment Worker, Supabase, Google, Resend, Turnstile, Sentry, cron y observabilidad reales. |
| `seo_llm_final` | Fase 3 | SEO/LLM final con dominio/copy/legal definitivos, fuente rusa premium/fallback, Search Console si esta disponible y exclusion de rutas privadas/demo/API. |
| `final_smoke` | Fase 3 | Flujo real completo antes de aceptar trafico publico. |

## Urgente vs final-only

Urgente ahora:

- Que la demo siga aislada.
- Que no haya historicos obsoletos confundiendo el estado real.
- Que `.agent/.agents` tenga una decision humana.
- Que contenido, accesibilidad, seguridad externa y operacion staging se revisen antes de acumular cambios finales.

Puede quedar para el final:

- Datos legales reales.
- Stripe live y precios live.
- Rotacion final de API keys.
- Backup logico/manual final o upgrade Pro si se requiere backup gestionado.
- SEO/LLM final.
- Smoke de produccion.
- Reviews reales.
- Canal publico de Telegram.
- Telemetria de uso.
- Prueba de nivel definitiva.
- Backlog post-launch de marketing/operacion mientras no cambie la decision de alcance.

No debe quedar para despues del launch:

- Legal real si la pagina acepta trafico publico comercial.
- Stripe live para pagos reales desde el primer dia, tras ensayo test staging y con rollback del checkout.
- RLS, backup/export final, secretos definitivos y Worker production.
- SEO/LLM si se declara el sitio acabado/publicable.
- Rollback operativo.
