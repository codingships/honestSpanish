# Observability And Alerts

Estado: politica de lanzamiento. La configuracion real de dashboards/alertas se verifica en evidencia manual; no guardar tokens, capturas con secretos ni datos personales en el repo.

## Separacion De Responsabilidades

- Sentry es para excepciones tecnicas, regresiones de runtime, errores de API, errores de build/deploy y diagnostico de estabilidad.
- Los problemas normales de alumno se gestionan como tickets en Supabase y campus admin.
- La telemetria de producto, funnels, heatmaps o eventos de uso sigue pospuesta hasta revisar legal, cookies, consentimiento, retencion y privacidad.
- Cloudflare Workers Logs, Cloudflare Pages deployments, Supabase logs, Stripe dashboard y Resend logs complementan Sentry; ninguno sustituye el smoke final.

## Alertas Minimas Sentry

Antes del Go/No-Go, revisar que Sentry tenga alertas o reglas equivalentes para:

| Area | Que debe avisar | Owner inicial | Evidencia no secreta |
| --- | --- | --- | --- |
| New production issue | Nueva excepcion en production, especialmente en rutas publicas, checkout, webhook, soporte, campus admin o cron. | Alin | Nombre de regla, proyecto y canal revisado. |
| Regressed issue | Issue resuelto que reaparece despues de deploy. | Alin | Nota o captura redactada de regla activa. |
| Spike de errores | Aumento brusco de errores en ventana corta durante launch o tras deploy. | Alin | Umbral o regla revisada, sin datos personales. |
| Stripe/webhook | Error en `/api/stripe-webhook`, idempotencia, firma, price mode o reconciliacion. | Alin/Codex | Regla o query guardada; no pegar payloads. |
| Fulfillment/cron | Error en Worker, `/internal/jobs/process`, `/internal/reminders/send`, Google, Resend o jobs agotados. | Alin/Codex | Regla Sentry o decision de cubrirlo con Cloudflare logs + Admin > Jobs. |
| Support alert failure | Fallo enviando email de aviso aunque el ticket quede guardado. | Alin | Regla o busqueda guardada para `[SupportAlert] Ticket created but email alert failed`. |
| Sourcemaps | Si `SENTRY_UPLOAD_SOURCEMAPS=true` en CI/deploy, confirmar que sourcemaps llegan al proyecto correcto. | Alin/Codex | Nota de deploy; nunca `SENTRY_AUTH_TOKEN`. |

## Checks De Dashboard

Verificar en staging o production segun fase:

1. Proyecto/organizacion Sentry correctos para Espanol Honesto.
2. `PUBLIC_SENTRY_DSN` configurado solo donde debe capturar errores.
3. `SENTRY_AUTH_TOKEN` disponible solo en CI/deploy o secret manager cuando se suben sourcemaps.
4. `SENTRY_UPLOAD_SOURCEMAPS` no esta activado localmente por accidente.
5. `SENTRY_CAPTURE_LOCAL=false` por defecto para que dev/QA local no contamine production.
6. `SENTRY_ENVIRONMENT` solo se usa como override deliberado; si falta, captura local opt-in debe ir a `local-<NODE_ENV>` y deploys deben usar `PUBLIC_APP_ENV`.
7. Alertas tienen owner y canal revisado.
8. Privacy/scrubbing: no capturar tokens, cookies, passwords, payloads de pago, service role, datos privados de alumnos ni URLs con secretos.
9. Release/deploy tags o contexto suficiente para saber que version fallo.
10. Si Sentry no esta disponible en la fase actual, registrar accepted risk con owner, motivo, fallback y plan de revision.

El preflight reproducible es `pnpm launch:sentry-readonly -- --env-file .env --environment production --time-range 14d --limit 50`. Ademas de issues agregados, comprueba scrubbing, release, reglas/workflows, detector y ownership sin guardar eventos, titulos, miembros ni IDs sin hash.

Si el proyecto exacto no tiene alertas, `pnpm launch:sentry-production-hardening` prepara un plan GET-only. Su modo aprobado habilita exclusivamente scrub de IP y crea dos workflows `production`: email ante issue nuevo/regresado y email ante 10 eventos del mismo issue en 5 minutos. Exige hashes exactos de detector/owner, autorizacion literal y `--execute-approved`; no cambia issues. Las incidencias historicas se tratan despues con `pnpm launch:sentry-issue-triage-runner`, nunca dentro del hardening.

## Fallback Sin Sentry Completo

Si el dashboard de Sentry no esta listo antes del RC, el RC puede seguir bloqueado o avanzar solo con riesgo aceptado si:

- Cloudflare Worker logs estan visibles.
- Cloudflare Pages deployment logs estan visibles.
- Admin > Jobs permite ver/reintentar/cancelar jobs.
- Admin > Tickets soporte permite ver incidencias de alumnos.
- Resend y Stripe tienen dashboard revisable.
- Hay owner claro y plan de revisar Sentry antes de production o justo despues de launch si Alin acepta ese riesgo.

## Evidencia Manual Aceptable

Usar `manual_note`, `dashboard` o captura redactada. La evidencia debe decir:

- Entorno revisado.
- Proyecto Sentry o herramienta equivalente.
- Alertas/reglas revisadas.
- Canal/owner.
- Resultado.
- Riesgos aceptados, si los hay, con `riskAcceptedBy`, `riskRationale` y `rollbackPlan`.

No incluir:

- Tokens, DSN privados, URLs con query secrets o bearer headers.
- Emails privados de alumnos.
- Payloads completos de Stripe, Supabase, Google, Resend o Sentry.
- Capturas con claves, cuentas innecesarias o datos personales.

## Criterio De Cierre

`Sentry alerts configuradas` se puede marcar como hecho cuando:

- Las alertas minimas estan configuradas o hay equivalente aceptado.
- Hay owner/canal para launch.
- Se ha revisado scrubbing/privacidad.
- Se ha probado una alerta segura o se ha documentado por que no se prueba antes del Go/No-Go.
- La evidencia esta registrada sin secretos.
- `pnpm launch:operations`, `pnpm launch:security` y `pnpm launch:status` se han rerunteeado despues.
- El resumen ejecutado de `pnpm launch:sentry-production-hardening -- --execute-approved` acredita `HARDENED_AND_VERIFIED`, o existe un equivalente manual explicitamente aceptado.
