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
9. El cron horario del Fulfillment Worker procesa como maximo 5 jobs pendientes/reintentos y despues envia recordatorios.
10. Los endpoints internos/manuales permiten procesar o recuperar jobs sin esperar al siguiente cron.

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
- Si la llamada interna devuelve 404/1042 sin aparecer en logs del Fulfillment Worker, comprobar que el Astro Worker declara `FULFILLMENT_SERVICE` hacia el Worker del mismo entorno. No habilitar `global_fetch_strictly_public` como sustituto.

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

### Desistimiento o reembolso

El inicio del reembolso es una operación humana en Stripe Dashboard; el webhook `charge.refunded` reconcilia después el importe y estado del pago local, pero no decide por sí solo si debe terminar la suscripción ni cuánto acceso corresponde conservar.

1. Abrir o vincular el ticket de soporte y verificar comprador, pago, versión contractual, fecha de contratación, solicitud de inicio, clases ya prestadas y fundamento del reembolso.
2. Calcular y documentar el importe total o proporcional con revisión humana. No pegar datos de tarjeta ni secretos en CRM, logs o evidencias.
3. Si debe cesar la renovación, cancelarla en Stripe antes de reembolsar. Si procede suspender acceso inmediato, pausar/cancelar la suscripción local y revisar las reservas futuras; no asumir que el reembolso lo hará automáticamente.
4. Ejecutar el reembolso sobre el cargo correcto en Stripe Dashboard y conservar solo identificadores abreviados en la evidencia.
5. Confirmar entrega de `charge.refunded` y verificar en `payments` `amount_refunded`, `stripe_refund_id`, `refunded_at` y `status` (`succeeded` para parcial, `refunded` para total).
6. Reconciliar manualmente suscripción, saldo, reservas y cualquier excepción aprobada. Registrar quién decidió, cuándo, importe, motivo y resultado.
7. Si el webhook falla, no repetir el reembolso: recuperar/reintentar el evento y comprobar Stripe antes de cualquier segunda acción.

Antes del lanzamiento debe ensayarse en Stripe test un reembolso parcial y uno total, incluida la cancelación de renovación y la reconciliación de acceso/cuota.

### Launch sin pagos reales

Si se decide abrir una version publica sin activar Stripe live, revisar:

- Paquetes activos y Price IDs por entorno.
- Que la UI publica no prometa compra real si checkout no esta disponible.
- Que `/api/create-checkout` no pueda crear sesiones live accidentalmente.
- Que la decision este documentada como riesgo aceptado en `docs/launch/MANUAL_EVIDENCE.local.json`.

Recuperacion:

- Desactivar paquetes o borrar Price IDs incorrectos desde `/es/campus/admin/packages`.
- Mantener Stripe en test hasta completar `payments_staging` e `integration_readiness`.

Este modo ya no es la postura comercial final: queda como rollback inmediato si Stripe live, legal, webhook, portal o fulfillment presentan un incidente.

### Activacion Stripe Live En La Ventana Final

Objetivo: aceptar pagos reales desde el primer dia sin depender de editar `wrangler.toml` segundos antes.

Precondiciones obligatorias:

1. `LEGAL_IDENTITY_MODE='verified'`, revision humana registrada y build production desbloqueada.
2. Migraciones aplicadas en staging y production, incluida la atestacion 18+.
3. Compra Stripe test staging completa: checkout, webhook idempotente, suscripcion/cuota, email contractual, Drive, portal, cancelacion y reembolso reconciliado.
4. Confirmar en esa compra que el alcance inicial sigue siendo tarjeta, sin códigos promocionales, y que el importe de la renovación coincide con el resumen contractual.
5. Worker web `espanolhonesto` y Fulfillment Worker `espanol-honesto-fulfillment-production` creados, conectados mediante `FULFILLMENT_SERVICE` y probados por URL directa sin mover aun el dominio.
6. Keys, Price IDs y webhook secret live pertenecen todos al mismo modo/cuenta; webhook live apunta al Worker production.
7. Stripe Portal permite cancelar al final del periodo; aviso de renovacion y canal de desistimiento estan operativos.

Secuencia:

1. Ejecutar preflight read-only y declarar la cuenta Cloudflare, Worker `espanolhonesto`, cuenta/mode Stripe live y proyecto Supabase production que se van a tocar.
2. Mantener `CHECKOUT_ENABLED=false` en config y `CHECKOUT_ENABLED_OVERRIDE=false` mientras se cargan/verifican secrets.
3. Sincronizar paquetes production con Prices live y verificar que ningun ID empieza en test/mode incorrecto.
4. Probar por URL directa production con checkout cerrado, luego fijar el secret runtime `CHECKOUT_ENABLED_OVERRIDE=true` solo en el Worker `espanolhonesto` con aprobacion exacta.
5. Confirmar que la landing muestra checkout, que falta de aceptaciones devuelve 400 y que una compra real controlada recorre webhook, confirmacion y fulfillment.
6. Registrar evidencia no secreta y abrir trafico. No imprimir keys, Checkout URLs privadas, emails, IDs de Google ni payloads completos.

Rollback financiero inmediato:

1. Fijar `CHECKOUT_ENABLED_OVERRIDE=false` en el Worker production; esto oculta el checkout y hace que la API devuelva 403 antes de Supabase/Stripe.
2. Mantener webhook y fulfillment activos para terminar/reconciliar compras ya cobradas.
3. No borrar Prices, clientes ni eventos; investigar y reembolsar desde Stripe cuando corresponda.
4. Si el problema es fulfillment, pausar nuevas compras, recuperar jobs desde Admin &gt; Jobs y mantener trazabilidad de pagos.

## Deploy

### Flujo Normal

1. Crear cambios en una rama de trabajo.
2. Abrir PR hacia `staging`.
3. CI debe pasar: typecheck, lint, tests, build, E2E publico y secrets-check.
4. Merge a `staging`.
5. GitHub Actions despliega primero el Cloudflare Fulfillment Worker staging y después el Astro Worker staging con `FULFILLMENT_SERVICE` apuntando al target ya existente.
6. Validar smoke staging.
7. Abrir PR de `staging` hacia `main`.
8. CI debe pasar.
9. Merge a `main`.
10. Aprobar el environment `production` en GitHub Actions.
11. GitHub Actions despliega primero el Cloudflare Fulfillment Worker production y después el Astro Worker production con su binding. Los dominios se mueven desde Pages legado solo despues del probe directo y la aprobacion de cutover.

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
# Staging es el destino seguro por defecto.
pnpm deploy

# Solo en la ventana production aprobada.
pnpm deploy:production
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
3. Actualizar consumidores de staging: Cloudflare Astro Worker, Cloudflare Fulfillment Worker y GitHub environment `staging`.
4. Ejecutar smoke staging: auth, checkout test si aplica, webhook test, Worker `/health`, job seguro, Resend test, Turnstile y logs.
5. Actualizar consumidores de production: Cloudflare Astro Worker, Cloudflare Fulfillment Worker y GitHub environment `Production`.
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
- Cloudflare: actualizar secrets de Pages y Worker por entorno. `INTERNAL_JOB_SECRET` debe coincidir entre Pages y Fulfillment Worker dentro del mismo entorno. `CRON_SECRET` debe mantenerse separado de `INTERNAL_JOB_SECRET`; ambos deben ser distintos entre staging y production.
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
