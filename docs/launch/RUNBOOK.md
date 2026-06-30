# Operations Runbook

## Flujo Critico

1. Usuario se registra.
2. Usuario compra con Stripe Checkout.
3. Webhook crea `subscriptions` y `payments`.
4. Webhook encola `welcome_fulfillment`.
5. Cloudflare Fulfillment Worker procesa jobs y crea Drive/email.
6. Admin/teacher reserva clase.
7. Cloudflare encola `session_fulfillment`.
8. Cloudflare Fulfillment Worker crea Doc, Calendar, Meet y emails.
9. Cron llama `/api/cron/send-reminders`.
10. Cloudflare Pages delega recordatorios al Cloudflare Fulfillment Worker.

## Incidentes

### Pago completado sin suscripcion

Revisar:

- Stripe event delivery.
- `processed_webhook_events`.
- Logs webhook en Cloudflare/Sentry.
- `subscriptions` y `payments`.

Recuperacion:

- Confirmar pago en Stripe.
- Crear/reconciliar suscripcion manualmente solo si no existe.
- Encolar fulfillment si falta.

### Suscripcion sin Drive/email

Revisar:

- `profiles_private.drive_folder_id`.
- `fulfillment_jobs` con `welcome_fulfillment`.
- Logs Cloudflare Fulfillment Worker.
- Google credentials/scopes.
- Resend logs.

Recuperacion:

- Admin > Jobs > Reintentar.
- Admin > Jobs > Procesar pendientes.
- Si el Cloudflare Fulfillment Worker esta caido, revisar `/health`, secrets y deploy.

### Clase sin Meet/Doc/email

Revisar:

- `sessions.calendar_event_id`.
- `sessions.meet_link`.
- `sessions.drive_doc_id`.
- `sessions.drive_doc_url`.
- `fulfillment_jobs` de la clase.
- Logs Cloudflare Fulfillment Worker.

Recuperacion:

- Reintentar job desde Admin > Jobs.
- Si Google falla por permisos, corregir scopes/env y reintentar.
- Como ultimo recurso, crear Meet/Doc manual y actualizar la clase.

### Recordatorio no enviado

Revisar:

- `sessions.reminder_sent`.
- Worker `workers/fulfillment`.
- `/api/cron/send-reminders`.
- Logs Cloudflare Fulfillment Worker.
- Resend delivery.

Recuperacion:

- Ejecutar cron manual con bearer.
- Reintentar desde Admin > Jobs si habia jobs pendientes.

### Paquete activo sin checkout

Revisar:

- `/es/campus/admin/packages`.
- `stripe_price_1m`, `stripe_price_3m`, `stripe_price_6m`.
- Modo Stripe correcto.

Recuperacion:

- Guardar paquete.
- Sincronizar Stripe desde CRM.
- Confirmar que vuelve a estar checkout-ready.

### Launch sin pagos reales

Si se decide abrir una version publica sin activar Stripe live, revisar:

- Paquetes activos y Price IDs por entorno.
- Que la UI publica no prometa compra real si checkout no esta disponible.
- Que `/api/create-checkout` no pueda crear sesiones live accidentalmente.
- Que la decision este documentada como riesgo aceptado en `docs/launch/MANUAL_EVIDENCE.local.json`.

Recuperacion:

- Desactivar paquetes o borrar Price IDs incorrectos desde `/es/campus/admin/packages`.
- Mantener Stripe en test hasta completar `payments_staging` e `integration_readiness`.

## Deploy

### Flujo Normal

1. Crear cambios en una rama de trabajo.
2. Abrir PR hacia `staging`.
3. CI debe pasar: typecheck, lint, tests, build, E2E publico y secrets-check.
4. Merge a `staging`.
5. GitHub Actions despliega Cloudflare Pages staging y Cloudflare Fulfillment Worker staging.
6. Validar smoke staging.
7. Abrir PR de `staging` hacia `main`.
8. CI debe pasar.
9. Merge a `main`.
10. Aprobar el environment `production` en GitHub Actions.
11. GitHub Actions despliega Cloudflare Pages production y Cloudflare Fulfillment Worker production.

### Deploy Manual Local

```bash
pnpm typecheck
pnpm fulfillment:typecheck
pnpm lint
pnpm test:run
pnpm build
pnpm secrets:check
```

Cloudflare local:

```bash
pnpm deploy
```

Cloudflare Fulfillment Worker local:

```bash
pnpm fulfillment:dev
```

## Rotacion Final De Claves

La rotacion final se hace solo en la ventana previa al lanzamiento real, despues de cerrar copy/legal y antes del smoke final. No es requisito para congelar el Release Candidate mientras Stripe siga en test y no haya trafico real.

Reglas:

- No guardar valores secretos en el repo, `.codex-ops`, outputs, capturas, tickets ni docs.
- Guardar los valores definitivos solo en KeePassXC y en los secret managers de cada proveedor.
- Rotar primero staging cuando el proveedor lo permita, validar, y despues production.
- Mantener claves antiguas activas solo hasta que el smoke del entorno pase; revocarlas inmediatamente despues.
- Si una clave pudo filtrarse, no usar rollback a la clave anterior: pausar checkout/jobs, generar una nueva y redeployar.

Orden recomendado:

1. Preparar entradas KeePassXC por entorno: Dev, Staging, Production y GitHub CI. Registrar fecha de rotacion, origen, permisos y responsable, sin pegar valores en docs.
2. Generar o rotar secretos en el proveedor original: Supabase, Stripe, Cloudflare, Google, Resend, Turnstile, Sentry y GitHub.
3. Actualizar consumidores de staging: Cloudflare Pages, Cloudflare Fulfillment Worker y GitHub environment `staging`.
4. Ejecutar smoke staging: auth, checkout test si aplica, webhook test, Worker `/health`, job seguro, Resend test, Turnstile y logs.
5. Actualizar consumidores de production: Cloudflare Pages, Cloudflare Fulfillment Worker y GitHub environment `Production`.
6. Ejecutar comprobaciones locales y de cierre:

```bash
pnpm secrets:check
pnpm launch:security
pnpm launch:operations
pnpm launch:final-readiness
pnpm launch:status
```

7. Ejecutar smoke production antes de aceptar trafico publico.
8. Revocar claves antiguas y registrar evidencia no secreta en `docs/launch/MANUAL_EVIDENCE.local.json`.

Notas por proveedor:

- Supabase: staging y production usan proyectos separados. Si se rota el JWT secret o claves anon/service role, planificar una ventana de mantenimiento porque puede invalidar tokens existentes. Actualizar todas las referencias antes de aceptar trafico.
- Stripe: mantener test y live separados. Rotar `STRIPE_SECRET_KEY`, `PUBLIC_STRIPE_PUBLISHABLE_KEY` y `STRIPE_WEBHOOK_SECRET` por entorno. Los Price IDs no son secretos, pero deben pertenecer al modo correcto.
- Cloudflare: actualizar secrets de Pages y Worker por entorno. `INTERNAL_JOB_SECRET` y `CRON_SECRET` deben coincidir entre Pages/Worker solo dentro del mismo entorno y ser distintos entre staging y production.
- Google: crear una clave nueva para la service account, actualizar Worker, validar Drive/Calendar/Docs/Meet y borrar la clave antigua. Revisar scopes de domain-wide delegation.
- Resend: crear API key con permisos minimos, validar envio y revocar la anterior.
- Turnstile: si cambia site key, actualizar tambien la variable publica y revisar dominios permitidos.
- Sentry: rotar token de auth usado para sourcemaps. El DSN publico puede permanecer salvo decision contraria.
- GitHub/Cloudflare deploy: rotar `CLOUDFLARE_API_TOKEN` con permisos minimos y actualizar los environments.

### Rollback

Cloudflare:

- Usar el dashboard de Cloudflare Pages para volver al ultimo deployment estable.
- Si el error viene de variables, corregir secrets/env vars y redeploy.

Cloudflare Fulfillment Worker:

- Usar el dashboard de Cloudflare Workers o `wrangler rollback` para volver a una version estable.
- Si el error viene de variables, corregir env vars y redeploy.

Base de datos:

- No aplicar migraciones irreversibles sin plan de rollback.
- Antes de cambios destructivos, confirmar backup Supabase. Si production sigue en Free, ejecutar backup logico/manual fuera del repo o subir a Pro antes del cambio.

## Simulacro De Incidente Y Rollback

Objetivo: validar que el equipo sabe detectar, contener, recuperar y documentar un incidente de lanzamiento sin improvisar en produccion.

Este simulacro puede cerrarse como tabletop antes del Go/No-Go si no hay ventana segura para ejecutar un rollback real. No sustituye el smoke final, pero si prueba el procedimiento y los puntos de decision.

### Escenario Minimo RC

Usar un escenario que no toque datos reales ni secretos:

1. Un `fulfillment_job` de staging falla o queda pendiente.
2. El alumno avisa desde Soporte.
3. Admin revisa Admin > Jobs y Admin > Tickets soporte.
4. Se decide si reintentar, cancelar o pausar el flujo afectado.
5. Se revisan logs de Cloudflare Worker y Sentry si esta disponible.
6. Se registra una nota no secreta con hora, entorno, decision y resultado.

Evidencia aceptable:

- Ruta o captura redactada de Admin > Jobs.
- Ruta o captura redactada de Admin > Tickets soporte.
- Nota manual con entorno, recurso afectado, accion tomada y resultado.
- Salida de `pnpm launch:operations` y `pnpm launch:status`.

### Escenario De Rollback Tabletop

Usar este guion si no se ejecuta un rollback real:

1. Identificar el deployment estable anterior de Cloudflare Pages.
2. Identificar la version estable anterior del Cloudflare Fulfillment Worker.
3. Decidir si el incidente requiere rollback, pausa de checkout, desactivacion de paquetes, pausa de cron o reintento de jobs.
4. Confirmar quien aprueba la accion: Alin para Go/No-Go, Codex solo prepara evidencia.
5. Confirmar datos afectados y si hace falta comunicacion a alumnos.
6. Definir verificacion posterior: pagina publica, `/health`, job seguro, email, checkout test si aplica y `pnpm launch:status`.

Evidencia aceptable:

- Nota manual con deployment objetivo, accion elegida y motivo.
- Captura redactada del historial de deployments o dashboard.
- Riesgo aceptado con `riskAcceptedBy`, `riskRationale` y `rollbackPlan` si no se ejecuta rollback real antes del lanzamiento.

### Criterio De Cierre Del Simulacro

El simulacro se puede considerar validado cuando:

- Hay un propietario y una decision documentada.
- El flujo de deteccion, contencion, recuperacion y verificacion esta recorrido.
- El rollback real se ha probado o queda explicitamente aceptado como riesgo con plan concreto.
- No se han pegado secretos, datos personales, pagos, tokens ni capturas sensibles en el repo.
- `pnpm launch:operations` y `pnpm launch:status` se han rerunteeado despues de actualizar la evidencia.

## Go/No-Go Tecnico

- App Cloudflare responde paginas publicas ES/EN/RU.
- Fulfillment Worker `/health` responde 200.
- `/api/create-checkout` crea Stripe Checkout URL.
- Stripe webhook encola fulfillment.
- Admin > Jobs ve y procesa jobs.
- Compra test completa crea Drive/email.
- Reserva test crea Doc/Meet/email.
- Recordatorio test marca `reminder_sent`.
