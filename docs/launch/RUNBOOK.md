# Operations Runbook

## Flujo Critico

1. Usuario adulto se registra y confirma su email.
2. Admin revisa la solicitud y aprueba una oportunidad CRM para un paquete contractual sincronizado.
3. Campus reclama un `checkout_intent` unico y abre Stripe Checkout para esa oferta inmutable.
4. Webhook real completa el intent, crea/reconcilia `subscriptions` y `payments` y convierte la oportunidad exacta.
5. Webhook encola `welcome_fulfillment` con el snapshot contractual.
6. Cloudflare Fulfillment Worker procesa jobs y crea Drive/email.
7. Admin/teacher reserva clase.
8. Cloudflare encola `session_fulfillment`.
9. Cloudflare Fulfillment Worker crea Doc, Calendar, Meet y emails.
10. El cron horario del Fulfillment Worker procesa como maximo 5 jobs pendientes/reintentos y despues envia recordatorios.
11. Los endpoints internos/manuales permiten procesar o recuperar jobs sin esperar al siguiente cron.

## Incidentes

### Pago completado sin suscripcion

Revisar:

- Stripe event delivery.
- `processed_webhook_events`.
- Logs webhook en Cloudflare/Sentry.
- `subscriptions` y `payments`.

Recuperacion:

- Confirmar en Stripe la Session, factura, suscripcion, Price, importe, cuenta y modo exactos.
- Confirmar en Supabase el `checkout_intent`, `package_price`, oportunidad CRM y estado de `processed_webhook_events`.
- Reenviar/reintentar el mismo evento real desde Stripe; el lease y las escrituras idempotentes deben recuperar el flujo.
- No insertar manualmente una suscripcion, pago o conversion CRM: eso saltaria el contrato inmutable y puede duplicar cobros/cuota. Si el evento real sigue fallando, bloquear nuevos checkouts y preparar una reconciliacion transaccional especifica con revision y evidencia.
- Encolar fulfillment solo despues de verificar que la suscripcion y el pago locales corresponden exactamente a la factura.

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
- Tres punteros `stripe_price_1m/3m/6m` y tres filas `package_prices` activas de la version actual.
- `stripe_account_id`, `stripe_livemode`, Product, importe EUR, intervalo y cuota coincidentes.

Recuperacion:

- Guardar paquete.
- Sincronizar Stripe desde CRM.
- Confirmar que la activacion RPC termina antes de archivar Prices retirados y que vuelve a estar checkout-ready.

No usar scripts que escriban directamente `packages.stripe_*`; la unica ruta soportada es Admin > Paquetes, que verifica la cuenta y llama `activate_package_price`.

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
2. Migraciones aplicadas en staging y production, incluidas las cuatro migraciones billing desde `20260710205031_harden_billing_catalog_and_checkout_approval.sql` hasta `20260710223900_harden_checkout_customer_and_snapshot_immutability.sql`; `SUPABASE_EXPECTED_PROJECT_REF` coincide en ambos Workers. En production solo se aplican después de resolver las 27 suscripciones test heredadas y hacer backup lógico/manual.
3. Compra Stripe test staging completa mediante aprobacion CRM e intent real: checkout, webhook idempotente, suscripcion/cuota, email contractual, Drive, portal, cancelacion y reembolso reconciliado.
4. Confirmar en esa compra que el alcance inicial sigue siendo tarjeta, sin códigos promocionales, y que el importe de la renovación coincide con el resumen contractual.
5. Fulfillment Worker `espanol-honesto-fulfillment-production` creado primero en bootstrap inerte; sus secrets se cargan y reatestiguan mientras sigue inerte; después se despliega el Worker web `espanolhonesto` conectado mediante `FULFILLMENT_SERVICE`, se cargan sus secrets y se realiza una atestación dual fresca; la habilitación final de fulfillment se aprueba por separado y ambos se prueban por URL directa sin mover aún el dominio.
6. Keys, Customers, Products, Prices y webhook secret live pertenecen a la cuenta exacta `STRIPE_EXPECTED_ACCOUNT_ID`; la cuenta es espanola y tiene details/charges/payouts habilitados.
7. `STRIPE_PORTAL_CONFIGURATION_ID` es live, permite actualizar pago/ver facturas/cancelar al final del periodo y no permite cambiar de plan; aviso de renovacion y desistimiento estan operativos.
8. Fiscalidad y facturación validadas: los importes públicos tienen tratamiento documentado como precio final, el asesor ha confirmado impuestos/exención y datos de factura, y Stripe no puede añadir un total inesperado que el webhook rechazaría.

Secuencia:

1. Ejecutar preflight read-only y declarar la cuenta Cloudflare, ambos Workers, cuenta/mode Stripe live y proyecto Supabase production que se van a tocar.
2. Crear primero fulfillment inerte con `pnpm launch:cloudflare-production-fulfillment-bootstrap -- --execute-approved`; verificar `operationMode=bootstrap`, `crons=[]` y `503 FULFILLMENT_DISABLED`.
3. Cargar/verificar primero los secrets de fulfillment con `pnpm launch:cloudflare-production-fulfillment-secrets -- --execute-approved`; usa `production_bootstrap` y debe seguir atestiguando email/jobs/cron inertes.
4. Desplegar después el Worker web con `pnpm launch:cloudflare-production-worker-phase1 -- --execute-approved`, que revalida inmediatamente el bootstrap completo, manteniendo `CHECKOUT_ENABLED=false` y `CHECKOUT_ENABLED_OVERRIDE=false`; luego cargar/verificar los secrets web con su runner separado.
5. Habilitar fulfillment solo con `pnpm launch:cloudflare-production-fulfillment-enable -- --execute-approved`, que exige bootstrap, web, secret names y atestación antes de activar runtime/email live/cron.
6. Sincronizar desde Admin los paquetes production con Prices live; verificar las 12 ofertas `package_prices` (4 x 3), account/mode y snapshots de Customer separados de staging.
7. Probar por URL directa production con checkout cerrado, luego fijar el secret runtime `CHECKOUT_ENABLED_OVERRIDE=true` solo en el Worker `espanolhonesto` con aprobacion exacta.
8. Confirmar que la landing sigue en `solicitar plaza`; aprobar un alumno/plan controlado y comprobar que solo Campus abre checkout, que falta de aceptaciones devuelve 400 y que la compra recorre intent, webhook, confirmacion y fulfillment.
9. Registrar evidencia no secreta y abrir trafico. No imprimir keys, Checkout URLs privadas, emails, IDs de Google ni payloads completos.

Rollback financiero inmediato:

1. Fijar `CHECKOUT_ENABLED_OVERRIDE=false` en el Worker production; esto oculta el checkout y hace que la API devuelva 403 antes de Supabase/Stripe.
2. Mantener webhook y fulfillment activos para terminar/reconciliar compras ya cobradas.
3. No borrar Prices, clientes ni eventos; investigar y reembolsar desde Stripe cuando corresponda.
4. Si el problema es fulfillment, pausar nuevas compras, recuperar jobs desde Admin &gt; Jobs y mantener trazabilidad de pagos.

### Smoke Integral Staging Y Smoke Minimo Production

El arnes `scripts/smoke/real-env-smoke.ts` es exclusivo de staging. Reutiliza las tres cuentas existentes `TEST_ADMIN_EMAIL`, `TEST_TEACHER_EMAIL` y `TEST_STUDENT_EMAIL`; `EMAIL_RECIPIENT_ALLOWLIST` debe contener exactamente esas tres direcciones. No crea usuarios Auth, no resetea contrasenas, no usa destinatarios `example.com` y no requiere abrir el buzon del alumno.

Antes del primer write, `pnpm launch:staging-smoke-rehearsal-runner -- --execute-approved` ejecuta un subprocess `--preflight-only` que comprueba Supabase staging, Stripe test, catalogo contractual, roles/allowlist, un `SMOKE_COMPLETED_CHECKOUT_SESSION_ID` real, su `SMOKE_BILLING_LIFECYCLE_EVIDENCE_PATH` canonica, la revalidacion terminal viva y el gate desplegado. Si falla algo, el comando de writes no comienza.

Checkout staging permanece cerrado durante todo el smoke. El runner atestigua en read-only la cuenta/Worker y los runtimes web/fulfillment con `CHECKOUT_ENABLED_OVERRIDE=false`, exige `403 Checkout is disabled`, reutiliza la Checkout completada y no realiza escrituras Cloudflare. El child con writes no tiene timeout duro impuesto por el runner para que su `finally` complete el cleanup; una interrupcion forzada exige conciliacion manual. El bootstrap estrecho queda fuera del flujo activo y solo puede usarse como excepcion manual con un propietario externo que abra y restaure/verifique el gate, porque ese script no escribe Cloudflare.

Antes del smoke integral, el ciclo Stripe test canonico se ejecuta y conserva por separado. Con `STAGING_BILLING_CHECKOUT_SESSION_ID=cs_test_...`, ejecutar primero `pnpm launch:staging-billing-lifecycle:preflight`. Si pasa, autorizar el write fijando exactamente `STAGING_BILLING_LIFECYCLE_CONFIRMATION=I_CONFIRM_STAGING_BILLING_LIFECYCLE:<same-session>` y ejecutar `pnpm launch:staging-billing-lifecycle`. Este runner solo acepta la Sandbox Espana/EUR y Supabase staging exactos; avanza el Test Clock exclusivo, verifica `invoice.upcoming`, fallo y recuperacion de renovacion, cancelacion al final del periodo y reembolso parcial+completo unicamente de la renovacion recuperada, preservando el pago inicial.

La evidencia canonica es `outputs/launch-staging-billing-lifecycle/<timestamp>/summary.json`. Debe terminar `status=OK`, checkpoint `phase=complete`, mutacion autorizada, cuenta/sesion exactas, estados terminales y revalidacion final. Pasar su ruta explicita mediante `SMOKE_BILLING_LIFECYCLE_EVIDENCE_PATH`; esa evidencia validada sustituye cualquier frase manual de “eventos revisados”. Si el proceso se interrumpe despues de crear `outputs/launch-staging-billing-lifecycle/checkpoints/<session>.json`, no borrar ni editar el checkpoint: revisar el summary fallido y usar `pnpm launch:staging-billing-lifecycle:resume` con la misma sesion y confirmacion de mutacion. `--resume` falla cerrado sin un checkpoint valido y ligado a los mismos recursos.

El cleanup del harness integral elimina unicamente su suscripcion/sesiones de scheduling, Docs/eventos y job/audits temporales; restaura notas, enlace Google y asignaciones; conserva el usuario/folder reutilizable y preserva la Checkout, oportunidad, intent, suscripcion y pagos que constituyen la evidencia real. Cualquier fallo de cleanup deja el smoke fallido. Esto evita acumular usuarios y filas temporales en Supabase Free.

En production no ejecutar este arnes. Usar `production-minimal-smoke-checklist.md`: paginas publicas/legales, login con cuentas existentes, salud de proveedores, estado intencional del checkout y, solo con aprobacion Stripe live separada, una unica compra deliberadamente propia.

## Deploy

### Flujo Normal

1. Crear cambios en una rama de trabajo.
2. Abrir PR hacia `staging`.
3. CI debe pasar: typecheck, lint, tests, build, E2E publico y secrets-check.
4. Merge a `staging`.
5. GitHub Actions despliega primero el Cloudflare Fulfillment Worker staging y después el Astro Worker staging con `FULFILLMENT_SERVICE` apuntando al target ya existente.
6. Validar el ciclo billing canonico y despues el smoke integral staging con checkout cerrado, preflight read-only, evidencia explicita y cleanup completo; ninguno de estos runners cambia Cloudflare.
7. Abrir PR de `staging` hacia `main`.
8. CI debe pasar.
9. Merge a `main`.
10. Aprobar el environment `production` en GitHub Actions.
11. GitHub Actions en `main` solo construye y ejecuta dry-runs production; no hace writes. Ejecutar manualmente los gates en orden: fulfillment bootstrap inerte, secrets fulfillment aún inertes, web, secrets web, atestación dual fresca y enable fulfillment. Los dominios se mueven desde Pages legado solo después del probe directo y la aprobación de cutover.

La secuencia Cloudflare completa, sus nombres base seguros y los gates separados de web/fulfillment estan en `docs/launch/CLOUDFLARE_PRODUCTION.md`. Astro 6 fija el entorno web durante el build: un deploy web que no use el `dist/server/wrangler.json` generado y validado no es un comando válido. Fulfillment sigue exigiendo su config y `--env` explícitos; los nombres base `espanolhonesto-env-required` y `espanol-honesto-fulfillment-env-required` mantienen los comandos ambiguos en fallo cerrado.

### Deploy Manual Local

```bash
pnpm typecheck
pnpm fulfillment:typecheck
pnpm lint
pnpm test:run
pnpm secrets:check
```

Cloudflare local:

```bash
# Staging es el destino seguro por defecto.
pnpm build
pnpm run deploy

# Solo en la ventana production aprobada. No sustituir por `pnpm build`.
pnpm build:production:release
pnpm exec wrangler deploy --config dist/server/wrangler.json --dry-run
pnpm run deploy:production # alias de dry-run; nunca escribe production
```

Cloudflare Fulfillment Worker local:

```bash
pnpm fulfillment:dev

# Producción: plan primero; cada write exige su aprobación exacta separada.
pnpm launch:cloudflare-production-fulfillment-bootstrap
pnpm launch:cloudflare-production-fulfillment-secrets
pnpm launch:cloudflare-production-worker-phase1
pnpm launch:cloudflare-production-worker-secrets
pnpm launch:cloudflare-production-fulfillment-enable
```

La secuencia completa está en `docs/launch/CLOUDFLARE_PRODUCTION.md`. Bootstrap, secrets fulfillment, web, secrets web y enable fulfillment son aprobaciones distintas. El runner de web se niega a desplegar sin un bootstrap ejecutado, con secrets completos y verificado de nuevo contra su versión remota actual. El runner de secrets fulfillment mantiene `production_bootstrap`; no envía emails ni procesa jobs. El runner enable es el único que despliega `--env production` y activa runtime/email/cron; si el resultado es fallido o ambiguo, restaura y verifica el bootstrap inerte. Las fases deben terminar con atestación autenticada de identidad, versión Cloudflare, modo operativo y ref Supabase exactos.

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

7. Ejecutar solo el smoke minimo/manual production antes de aceptar trafico publico; no repetir el arnes staging ni crear datos sinteticos masivos.
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
