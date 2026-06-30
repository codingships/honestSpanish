# Final Closure Runbook

Estado: final-only. No ejecutar esta secuencia hasta que Alin decida entrar en ventana real de Go/No-Go.

Este documento une los cierres que no deben bloquear el Release Candidate pero si bloquean el lanzamiento publico: legal real, pagos/Stripe, integraciones production, rotacion de claves, backup/export final, fuente rusa premium, SEO/LLM final y smoke end-to-end.

## Criterio De Entrada

Entrar en cierre final solo cuando:

- El Release Candidate esta congelado y `pnpm launch:rc` devuelve `RC_READY_WITH_FINAL_BLOCKERS`.
- Fase 1 esta limpia en `pnpm launch:status`.
- Ya no quedan cambios de producto/copy/posicionamiento que puedan alterar legal, precios, SEO o pagos.
- `docs/launch/LAUNCH_MARKETING_PLAN.md` esta congelado y representa la promesa final: adulto/profesional +30, conversacion, cultura, criterio, comunidad y solicitud de plaza/prueba como accion principal.
- Alin confirma si se lanzara con pagos reales o sin aceptar pagos reales.
- Alin confirma si se compra/licencia la fuente oficial con soporte cirilico o si acepta mantener el fallback actual para el lanzamiento.
- Hay tiempo para rotar claves, validar staging, validar production y hacer rollback si algo falla.

## No Hacer En Esta Secuencia

- No pegar secretos, claves, tokens, payloads de webhook, datos de alumnos ni datos de pago en docs, outputs, capturas o `.codex-ops`.
- No marcar manual evidence como `pass` con pruebas antiguas o parciales.
- No cerrar `READY` si `pnpm launch:gate` o `pnpm launch:secondary-review` siguen bloqueados.
- No activar telemetria sin revisar legal/cookies/consentimiento.
- No publicar reviews sin consentimiento real.
- No sustituir la tipografia rusa por una fuente parecida si la decision final exige la misma familia oficial con cirilico; comprar/licenciar o mantener el fallback actual como decision explicita.
- No guardar fuentes comerciales sin licencia, facturas ni datos fiscales en el repo, `outputs/` o `.codex-ops`.
- No activar una prueba de nivel definitiva sin seguir `docs/launch/LEVEL_CHECK.md`, revisar privacidad/consentimiento/retencion/canal de envio y reejecutar los checks afectados.

## Decision De Prueba De Nivel

El Release Candidate usa solicitud de plaza, no una prueba de nivel definitiva. En la ventana final hay que confirmar una de estas dos rutas:

| Ruta | Condicion | Evidencia |
| --- | --- | --- |
| Mantener pospuesta | La web sigue recogiendo nivel aproximado, objetivo, disponibilidad, interes, plan de interes y pagina de origen. | Nota en evidencia manual o decision de Alin; `docs/launch/LEVEL_CHECK.md` queda como backlog operativo. |
| Incluir en launch | Existe formato asincrono, canal de envio, texto de consentimiento, finalidad, retencion, acceso, borrado y rubrica manual. | `docs/launch/LEVEL_CHECK.md` actualizado, legal revisado, `pnpm launch:content`, `pnpm launch:accessibility` si cambia UI y `pnpm launch:legal` si cambia privacidad. |

No usar documentos, audio o video de nivel en evidencias del repo, capturas, outputs o `.codex-ops`. Si entra en launch, tratarlo como cambio de producto y privacidad antes del Go/No-Go.

## Responsables Y Cadencia

La ventana final debe tratarse como una checklist con responsables, orden y hora relativa. Si cambia el alcance, actualizar esta tabla antes de ejecutar el Gate.

| Momento | Responsable | Accion | Bloquea |
| --- | --- | --- | --- |
| T-48h | Alin | Congelar copy publico, paquetes, `docs/launch/LAUNCH_MARKETING_PLAN.md`, modo de pagos y decision de lanzar con o sin pagos reales. | Legal, SEO/LLM, Stripe y smoke final. |
| T-48h | Alin | Confirmar que no entran reviews, Telegram, telemetria ni prueba de nivel definitiva salvo decision nueva documentada. | Checklist y evidencia manual. |
| T-48h | Alin | Confirmar fuente rusa premium: comprar/licenciar la familia oficial con cirilico o aceptar mantener fallback actual. | `seo_llm_final`, `final_smoke`. |
| T-24h | Alin | Completar datos legales reales y revision humana legal. | `legal_owner_controller`, `legal_human_review`. |
| T-24h | Alin/Codex | Ejecutar backup/export Supabase fuera del repo o confirmar upgrade Pro/accepted risk. | `database_readiness`, Go/No-Go. |
| T-12h | Alin/Codex | Rotar claves finales y validar secretos en Cloudflare, Supabase, Stripe, Google, Resend, Turnstile y Sentry. | `security_external`, `integration_readiness`. |
| T-6h | Codex | Ejecutar checks locales: `pnpm secrets:check`, `pnpm launch:security`, `pnpm launch:operations`, `pnpm launch:payments`, `pnpm launch:seo`, `pnpm launch:final-readiness`. | Evidencia manual final. |
| T-3h | Alin/Codex | Ejecutar smoke final staging/production segun decision de pagos y servicios reales. | `final_smoke`. |
| T-1h | Alin | Revisar `docs/launch/MANUAL_EVIDENCE.local.json`, aceptar riesgos no criticos si los hay y decidir Go/No-Go. | `launchDecision`. |
| T-0 | Codex | Ejecutar `pnpm launch:gate`, `pnpm launch:secondary-review` y `pnpm launch:status`. | Declarar `READY` o `NO-GO`. |

## Orden De Cierre

### 1. Congelar Decision De Pagos

Elegir una de dos rutas:

| Ruta | Condicion | Evidencia |
| --- | --- | --- |
| Pagos reales activos | Stripe live, Price IDs live, webhook live, portal y reconciliacion verificados. | `payments_staging` e `integration_readiness` pasan con evidencia Stripe no secreta. |
| Lanzamiento sin pagos reales | Checkout desactivado, oculto o bloqueado por configuracion/datos; la web no promete compra real inmediata. | `payments_staging` registra decision sin pagos y prueba de bloqueo. |

No mezclar Stripe test con promesa de pago real.

### 2. Completar Legal Real

Usar `docs/launch/LEGAL_INPUTS_REQUIRED.md`.

Actualizar:

- `src/pages/[lang]/legal/aviso-legal.astro`
- `src/pages/[lang]/legal/privacidad.astro`
- cookies, terminos y subprocesadores si cambian.

Ejecutar:

```bash
pnpm launch:legal
pnpm launch:verify
```

Evidencia manual:

- `legal_owner_controller`
- `legal_human_review`

### 3. Backup/Export Final De Supabase

Usar `docs/launch/SUPABASE_BACKUP_RUNBOOK.md`.

Como production esta en Supabase Free, antes de deploy publico, migracion destructiva o Go/No-Go:

- Ejecutar backup logico/manual fuera del repo, o
- Subir a Pro si se quiere backup programado gestionado.

Evidencia aceptable:

- Nota con fecha, proyecto, metodo y responsable.
- Captura redactada sin connection strings ni tokens.

No guardar dumps en el repo.

Preflight read-only 2026-06-12:

- Supabase tiene dos proyectos separados activos: `espanol-staging` y `espanol-honesto`.
- Production mantiene historial completo de migraciones; staging muestra solo migraciones recientes 012-017. Antes de Go/No-Go, confirmar si ese historial parcial de staging es una decision aceptada o si se recrea staging desde migraciones completas.
- Las tablas criticas existen con RLS activado en ambos proyectos, pero production conserva `public.jobs` como tabla legacy con RLS sin policies. Confirmar que no forma parte del runtime actual o decidir limpieza/accepted risk.
- Supabase Advisor marca `btree_gist` instalado en `public` en ambos proyectos y leaked password protection desactivado. Antes del lanzamiento publico, habilitar leaked password protection o registrar riesgo aceptado; mover `btree_gist` fuera de `public` solo con migracion probada, o dejarlo como backlog/riesgo aceptado si no bloquea el lanzamiento.

### 4. Rotacion Final De Claves

Seguir `docs/launch/RUNBOOK.md` y `docs/launch/ENVIRONMENT.md`.

Rotar y actualizar, segun aplique:

- Supabase anon/service role/JWT posture.
- Stripe secret/publishable/webhook.
- Cloudflare Pages/Worker secrets.
- Google service account key.
- Resend API key.
- Turnstile secret/site key si cambia.
- Sentry auth token si se usa para sourcemaps.
- GitHub/Cloudflare deploy token.
- `INTERNAL_JOB_SECRET` y `CRON_SECRET` por entorno.

Ejecutar despues:

```bash
pnpm secrets:check
pnpm launch:security
pnpm launch:operations
pnpm launch:final-readiness
pnpm launch:status
```

Evidencia manual:

- `security_external` si se repite el baseline final.
- `integration_readiness` para claves/servicios finales.

### 5. Validar Integraciones Production

Revisar dashboards y endpoints reales sin exponer secretos:

- Cloudflare Pages production.
- Cloudflare Fulfillment Worker production `/health`.
- Cloudflare Workers legacy: confirmar que `espanol-honesto-reminders` no interfiere con el Worker actual o desactivarlo/eliminarlo en ventana controlada.
- Supabase production, RLS, migraciones y tablas criticas.
- Google Drive root folder, template, Calendar/Meet, admin email y decision de cuenta en `docs/launch/GOOGLE_CALENDAR_ACCOUNT.md`.
- Resend domain/sender y entrega.
- Turnstile dominios reales.
- Sentry alerts/issues.
- Cron y Workers Logs.

Preflight read-only 2026-06-12:

- Cloudflare lista `espanol-honesto-fulfillment-staging` con cron horario y secretos esperados por nombre, sin valores expuestos.
- Cloudflare lista `espanol-honesto-reminders` con cron horario y sin secrets listados. Tratarlo como recurso legacy hasta que se decida mantener/desactivar/eliminar.
- Stripe autentica la cuenta `espanolhonesto`, pero los listados del MCP de Stripe fallaron con `Unknown tool`. El cierre de pagos no debe depender de esos listados; usar dashboard Stripe, flujo checkout test/live segun decision, webhook delivery y reconciliacion Supabase como evidencia.

Evidencia manual:

- `integration_readiness`
- `operations_external` si hay cambios finales de operacion.
- `database_readiness` si hubo migraciones, backup o cambios de Supabase.

### 6. Cerrar SEO/LLM Final

Usar `docs/launch/SEO_LLM_FINAL.md` y comparar sus snippets, `llms.txt`, paginas de segmento y respuestas esperadas contra `docs/launch/LAUNCH_MARKETING_PLAN.md`.

Antes de cerrar `seo_llm_final`, resolver la fuente rusa premium:

| Ruta | Condicion | Evidencia |
| --- | --- | --- |
| Comprar/licenciar | Alin compra/licencia la familia oficial con soporte cirilico. | Nota no secreta con nombre de familia, proveedor, alcance de licencia y rutas revisadas; no guardar factura ni datos fiscales. |
| Mantener fallback | El ruso se lee correctamente y Alin acepta que la familia visual no sea identica hasta post-launch. | Riesgo aceptado o nota de decision con owner y seguimiento. |

Si se compra la fuente, instalarla solo con archivos/licencia permitidos, preferiblemente self-hosted o proveedor oficial, y verificar que `/ru` usa la misma familia visual que ES/EN sin fallback inesperado. No usar una fuente "parecida" como cierre de este punto si la decision final exige la familia oficial.

Ejecutar:

```bash
pnpm launch:seo
pnpm launch:verify
pnpm launch:status
```

Revisar dominio final, robots, sitemap, canonical/hreflang, snippets, JSON-LD, `llms.txt`, Search Console o riesgo aceptado, Core Web Vitals o riesgo aceptado, exclusiones de campus/API/demo/private y la fila `marketing plan parity` de la worksheet SEO/LLM.

Evidencia manual:

- `seo_llm_final`
- `final_smoke` si la sustitucion de fuente cambia assets, layout o render visible.

### 7. Smoke Final

Ejecutar en staging primero si se tocaron secretos o integraciones. Ejecutar production solo cuando sea la decision final.

Cubrir:

- Registro/login.
- Checkout o bloqueo de checkout si no hay pagos reales.
- Webhook si hay pagos.
- Drive folder.
- Email.
- Reserva.
- Doc.
- Calendar/Meet.
- Recordatorio.
- Cancelacion.
- Retry/cancelacion de job desde Admin > Jobs.

Evidencia manual:

- `final_smoke`

No incluir emails privados, payloads completos, tarjetas ni URLs sensibles.

### 8. Gate Final Y Revision Secundaria

Cuando la evidencia manual final este actualizada:

```bash
pnpm launch:manual-evidence
pnpm launch:gate
pnpm launch:secondary-review
pnpm launch:status
```

Resultado aceptable:

- `READY`, o
- `READY_WITH_ACCEPTED_RISKS` si Alin acepta riesgos documentados no criticos.

Resultado no aceptable:

- Cualquier `BLOCKED`.
- Go/No-Go abierto sin evidencia.
- Legal, pagos, integraciones, SEO/LLM o smoke con evidencia indirecta.

## Evidencia Manual Final

Los checks que deben quedar cerrados o tener riesgo aceptado explicitamente:

- `legal_owner_controller`
- `legal_human_review`
- `payments_staging`
- `integration_readiness`
- `seo_llm_final`
- `final_smoke`

Segun cambios realizados durante la ventana final, repetir tambien:

- `security_external`
- `operations_external`
- `database_readiness`

## Decision De Alin

Antes de declarar `READY`, Alin debe confirmar:

- Si se aceptan pagos reales o no.
- Que legal esta revisado.
- Que la rotacion final de claves se ejecuto o se acepta un riesgo documentado.
- Que el backup/export final o upgrade Pro esta hecho si production sigue en Supabase Free.
- Que el smoke final representa el flujo real que se va a lanzar.

## Salida

El goal solo puede cerrarse cuando:

- `pnpm launch:gate` pasa sin bloqueos o con riesgos aceptados explicitamente.
- `pnpm launch:secondary-review` pasa.
- `pnpm launch:status` muestra Fase 1, RC y Fase 3 sin abiertos incompatibles con `READY`.
- La checklist y `docs/launch/MANUAL_EVIDENCE.local.json` contienen evidencia no secreta y actual.
