# Operations Runbook

## Flujo Critico

1. Usuario adulto se registra y confirma su email.
2. Admin revisa la solicitud y aprueba una oportunidad CRM para un paquete contractual sincronizado.
3. Campus reclama un `checkout_intent` unico y abre Stripe Checkout para esa oferta inmutable.
4. Webhook real completa el intent, crea/reconcilia `subscriptions` y `payments` y convierte la oportunidad exacta.
5. Webhook encola `welcome_fulfillment` con el snapshot contractual.
6. El endpoint interno publica `process_due`; Cloudflare Queue entrega la señal al Fulfillment Worker, que procesa jobs y crea Drive/email fuera de la ventana HTTP.
7. Admin/teacher reserva clase.
8. Cloudflare encola `session_fulfillment`.
9. Cloudflare Fulfillment Worker crea Doc, Calendar, Meet y emails.
10. El cron horario del Fulfillment Worker procesa como maximo 5 jobs pendientes/reintentos y despues envia recordatorios.
11. Los endpoints internos/manuales permiten procesar o recuperar jobs sin esperar al siguiente cron.

## Incidentes

### Receipt ambiguo tras una escritura externa

Los runners de Turnstile domains y Stripe webhook escriben `external-write-receipt.json` antes de iniciar el PUT/update. Si la llamada expira, pierde la conexion o lanza una excepcion despues de empezar, el receipt debe quedar con `externalWriteAttempted=true`, `externalWritePerformed=unknown`, `externalWriteOutcome=ambiguous_needs_readonly_reconciliation` y el comando debe fallar.

No reintentar la escritura. Hacer primero una lectura remota fresca del mismo widget/endpoint, comparar el estado con la captura anterior y el objetivo aprobado, y decidir si se acepta el cambio ya aplicado o si hace falta un rollback con aprobacion independiente. Solo despues de cerrar esa reconciliacion se puede generar un nuevo intento y una nueva aprobacion exacta.

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
- Queue `espanol-honesto-fulfillment-staging-queue` y su DLQ en staging.
- Logs Cloudflare Fulfillment Worker.
- Google credentials/scopes.
- Resend logs.

Recuperacion:

- Admin > Jobs > Reintentar.
- Admin > Jobs > Procesar pendientes.
- Si el Cloudflare Fulfillment Worker esta caido, revisar `/health`, secrets y deploy.
- Si el job sigue pendiente, comprobar productor `FULFILLMENT_QUEUE`, consumidor, backlog/reintentos y DLQ antes de reintentarlo manualmente.
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

### Rollout Supabase Production Inerte

Objetivo: llevar `espanol-honesto` (`vkkahxsybhbutszerawz`) al esquema RC sin abrir checkout y sin ocultar el historial divergente.

1. Ejecutar `pnpm launch:supabase-production-readonly-preflight`. Debe confirmar el ref exacto, usar `default_transaction_read_only=on`, terminar sin ambiguedades y no seleccionar identificadores, emails, IDs Stripe, payloads ni secretos. Conservar su `summary.json`; caduca a las 24 horas para este flujo.
2. Revisar `pnpm launch:supabase-production-rollout-plan` y generar el paquete ejecutable en modo local con `pnpm launch:supabase-production-rollout`. El segundo comando no conecta en su modo por defecto: fija los 23 hashes, las siete olas, los efectos que se verificaran y la exclusion de `20260710150000_staging_integration_smoke_runs.sql`. Los artefactos historicos `backup-evidence-receipt.template.json` y `fixture-preservation-policy.template.json` del plan sirven para revisar las decisiones; la ejecucion v2 exige los receipts verificados descritos en los pasos siguientes.
3. Crear el backup con `pnpm launch:supabase-production-logical-backup -- plan --destination <ruta-absoluta-nueva.dump>` y despues su ejecucion aprobada. El directorio debe estar fuera del repositorio y cifrado con Windows EFS, verificado por `cipher.exe`; el archivo incluye solo `public` y `auth`. No continuar sin `backup-receipt.json` fresco y verificado. El dump contiene PII y hashes de contrasena: nunca guardarlo en el repo, outputs, capturas o logs.
4. Ejecutar primero el preview de `pnpm launch:supabase-production-fixture-cleanup -- preview`. La ejecucion aprobada vuelve a comprobar el snapshot v2 y, en una unica transaccion, elimina exactamente 111 filas de la tabla legacy `public.jobs`, la elimina sin `CASCADE`, elimina los 2 `support_tickets` y el resto de fixtures publicos, conserva solo `group`, `standard`, `hybrid` y `bootcamp`, y limpia sus referencias Stripe locales. Debe emitir `public-cleanup-receipt.json`; Auth, Storage, Stripe y Google quedan fuera de esta transaccion.
5. Con el backup y el recibo publico, usar `pnpm launch:supabase-production-auth-cleanup` para el preflight y la fase `delete`. Debe conservar solo admin/profesor, borrar los 136 alumnos fixture, revocar refresh sessions, rotar credenciales sin conservarlas y emitir `auth-reduced-quarantined-receipt.json` con `auth=2`, `profiles=0`. Mantener production sin trafico durante la cuarentena.
6. Cerrar por separado los 110 folders fixture de la raiz Drive production: `pnpm launch:google-production-fixture-cleanup` solo puede mover a papelera los hijos directos del snapshot exacto y verificar raiz activa vacia; nunca borra permanentemente. Si se difiere deliberadamente, aportar evidencia explicita aprobada con el mismo conteo. Ninguna de las dos rutas autoriza Calendar, permisos, la raiz o staging.
7. Aplicar y verificar primero en staging, y en este orden, `20260712112000`, `20260712114000` y `20260712114500` con `pnpm launch:supabase-staging-hardening`. El post-check debe cerrar `leads` (enum, obligatoriedad, defaults y grants), ausencia de `public.is_admin`, `reminder_sent`, policy alumno -> profesor, indices, duraciones 30/40/50, trigger/solapes y politica 18+. Production solo acepta un summary real `APPLIED_AND_VERIFIED`, no plan ni una afirmacion de que ya estaba aplicado. Cerrar tambien `pnpm launch:sentry-production-hardening` con ejecucion aprobada: el summary debe ser fresco, apuntar a `honestspanish/espanol-honesto-astro` production y quedar `HARDENED_AND_VERIFIED` con scrubbing IP y los dos workflows exactos.
8. Mientras la cuarentena Auth siga activa, con al menos 15 minutos restantes al iniciar, y checkout continúe desactivado, ejecutar `pnpm launch:supabase-production-rollout -- --execute-approved --checkout-disabled-confirmed --through deferred_rc_hardening` con las rutas explicitas de preflight, backup, limpieza publica, Auth reducido, politica Google, hardening staging y `--sentry-hardening-evidence <summary.json>`. El runner aplica las 23 migraciones en siete transacciones/olas: `processed_at_small_fix`, `base_model_reconciliation`, `application_schema`, `runtime_and_policy`, `billing_contract`, `fulfillment_ledger` y `deferred_rc_hardening`. Registra el source exacto en historial, comprueba que la cuarentena no expire entre olas y hace verificacion read-only despues de cada una. `supabase db push` y `supabase migration repair` estan prohibidos.
9. Solo tras `production-rollout-receipt.json`, y una vez vencida la cuarentena, ejecutar el preflight y `finalize` de `pnpm launch:supabase-production-auth-cleanup`. Debe crear exclusivamente los dos perfiles minimos admin/profesor y sus dos filas privadas, y emitir `auth-policy-receipt.json`. Hasta entonces production sigue inerte.
10. Con ese receipt final, ejecutar primero `pnpm launch:production-availability -- --preflight-readonly --auth-policy-receipt <auth-policy-receipt.json>` y despues su ejecucion aprobada. Solo puede crear para el profesor preservado las cinco franjas L-V 09:00-18:00 `Europe/Madrid`, verificar el conjunto exacto y emitir `production-availability-receipt.json`; signup y checkout siguen desactivados.
11. Si falta el marcador de commit o falla una verificacion, no reintentar. Mantener checkout y fulfillment inertes, generar preflight fresco y elegir un fix-forward revisado. Si hace falta restaurar, hacerlo en un proyecto Supabase aislado, verificarlo y pedir otra aprobacion para cambiar conexiones; ningun runner restaura o conmuta automaticamente. El backup no incluye Storage ni objetos externos Stripe/Google.

Subflujo Auth exacto, siempre con rutas explicitas y sin copiar secretos a la linea de comandos:

```bash
# Local: no red ni writes.
pnpm launch:supabase-production-auth-cleanup

# Read-only: genera preflight-evidence.json y exact-approval-required.txt.
pnpm launch:supabase-production-auth-cleanup -- preflight \
  --backup-receipt <backup-receipt.json> \
  --public-cleanup-receipt <public-cleanup-receipt.json>

# Write inicial. Usar literalmente la aprobacion dinamica emitida por el preflight.
pnpm launch:supabase-production-auth-cleanup -- delete \
  --backup-receipt <backup-receipt.json> \
  --public-cleanup-receipt <public-cleanup-receipt.json> \
  --evidence <preflight-evidence.json> \
  --execute-approved

# Tras production-rollout-receipt.json y quarantineUntil: preflight final read-only.
pnpm launch:supabase-production-auth-cleanup -- preflight \
  --backup-receipt <backup-receipt.json> \
  --public-cleanup-receipt <public-cleanup-receipt.json> \
  --auth-reduced-receipt <auth-reduced-quarantined-receipt.json> \
  --rollout-receipt <production-rollout-receipt.json>

# Write final, con una aprobacion distinta.
pnpm launch:supabase-production-auth-cleanup -- finalize \
  --backup-receipt <backup-receipt.json> \
  --public-cleanup-receipt <public-cleanup-receipt.json> \
  --auth-reduced-receipt <auth-reduced-quarantined-receipt.json> \
  --rollout-receipt <production-rollout-receipt.json> \
  --evidence <preflight-evidence.json> \
  --execute-approved
```

El preflight toma `PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` y `SUPABASE_DB_URL` de variables de proceso o `.env`; `SUPABASE_ACCESS_TOKEN` solo de proceso; y resuelve exclusivamente `TEST_ADMIN_EMAIL`/`TEST_TEACHER_EMAIL` desde proceso o `.env.test`. Nunca lee sus passwords. Cada write exige además el valor exacto de `SUPABASE_PRODUCTION_AUTH_INERT_CONFIRMATION` y uno de cuatro envs de aprobacion independientes (`..._DELETE_APPROVAL`, `..._RESUME_DELETE_APPROVAL`, `..._FINALIZE_APPROVAL`, `..._RESUME_FINALIZE_APPROVAL`). Copiar esos valores desde `exact-approval-required.txt`, no reconstruirlos manualmente.

Un fallo parcial termina el proceso y deja `auth-cleanup-checkpoint.json` solo con conteos y hashes agregados. No reejecutar el mismo comando: generar un preflight nuevo con `--checkpoint`, revisar el estado y usar `resume-delete` o `resume-finalize` con otra aprobacion. Se bloquea si aparece un usuario posterior al freeze, si los dos preservados no son exactos, si hay ownership en Supabase Storage, si signup no esta desactivado, si JWT supera una hora, si queda cualquier fixture o si el receipt de las 23 migraciones en siete olas no coincide. No envia reset ni ningun otro email, no toca Stripe y deja expresamente intactas las 110 carpetas fixture observadas en Google Drive.

### Activacion Stripe Live En La Ventana Final

Objetivo: aceptar pagos reales desde el primer dia sin depender de editar `wrangler.toml` segundos antes.

Precondiciones obligatorias:

1. `LEGAL_IDENTITY_MODE='verified'`, revision humana registrada y build production desbloqueada.
2. Migraciones aplicadas en staging y production, incluidas las cuatro migraciones billing desde `20260710205031_harden_billing_catalog_and_checkout_approval.sql` hasta `20260710223900_harden_checkout_customer_and_snapshot_immutability.sql`; `SUPABASE_EXPECTED_PROJECT_REF` coincide en ambos Workers. En production solo se aplican mediante el rollout por olas despues del backup EFS, `public-cleanup-receipt.json` y `auth-reduced-quarantined-receipt.json`, que cierran las 27 suscripciones test heredadas antes de billing.
3. Compra Stripe test staging completa mediante aprobacion CRM e intent real: checkout, webhook idempotente, suscripcion/cuota, email contractual, Drive, portal, cancelacion y reembolso reconciliado.
4. Confirmar en esa compra que el alcance inicial sigue siendo tarjeta, sin códigos promocionales, y que el importe de la renovación coincide con el resumen contractual.
5. Fulfillment Worker `espanol-honesto-fulfillment-production` creado primero en bootstrap inerte; antes del web recibe solo `INTERNAL_JOB_SECRET` y se atestigua sin providers. Después se despliega el Worker web `espanolhonesto` conectado mediante `FULFILLMENT_SERVICE` y recibe también solo el HMAC. Supabase/Google/Resend y los secrets web activos se cargan en la ventana final; la habilitación de fulfillment se aprueba por separado y ambos se prueban por URL directa sin mover aún el dominio.
6. Keys, Customers, Products, Prices y webhook secret live pertenecen a la cuenta exacta `STRIPE_EXPECTED_ACCOUNT_ID`; la cuenta es espanola y tiene details/charges/payouts habilitados.
7. `STRIPE_PORTAL_CONFIGURATION_ID` es live, permite actualizar pago/ver facturas/cancelar al final del periodo y no permite cambiar de plan; aviso de renovacion y desistimiento estan operativos.
8. Fiscalidad y facturación validadas: los importes públicos tienen tratamiento documentado como precio final, el asesor ha confirmado impuestos/exención y datos de factura, y Stripe no puede añadir un total inesperado que el webhook rechazaría.

Secuencia:

1. Ejecutar preflight read-only y declarar la cuenta Cloudflare, ambos Workers, cuenta/mode Stripe live y proyecto Supabase production que se van a tocar.
2. Crear primero fulfillment inerte con `pnpm launch:cloudflare-production-fulfillment-bootstrap -- --execute-approved`; verificar `operationMode=bootstrap`, `crons=[]` y `503 FULFILLMENT_DISABLED`.
3. Cargar/verificar únicamente `INTERNAL_JOB_SECRET` con `pnpm launch:cloudflare-production-fulfillment-bootstrap-secrets -- --execute-approved`; debe rechazar cualquier provider secret y atestiguar Supabase/Google/Resend/cron ausentes.
4. Desplegar después el Worker web con `pnpm launch:cloudflare-production-worker-phase1 -- --execute-approved`, que revalida inmediatamente el bootstrap HMAC-only, manteniendo `CHECKOUT_ENABLED=false` y `CHECKOUT_ENABLED_OVERRIDE=false`; luego cargar solo su HMAC con `pnpm launch:cloudflare-production-worker-bootstrap-secrets -- --execute-approved`.
5. En la ventana final, cargar los secrets activos con los runners separados de web y fulfillment; habilitar fulfillment solo con `pnpm launch:cloudflare-production-fulfillment-enable -- --execute-approved`, que exige bootstrap, web, secret names y atestación antes de activar runtime/email live/cron.
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

El cleanup del harness integral elimina unicamente su disponibilidad temporal de profesor, suscripcion/sesiones de scheduling, Docs/eventos y job/audits temporales; restaura notas, enlace Google y asignaciones; conserva el usuario/folder reutilizable y preserva la Checkout, oportunidad, intent, suscripcion y pagos que constituyen la evidencia real. Cualquier fallo de cleanup deja el smoke fallido. Si el proceso se interrumpe a la fuerza, la conciliacion manual debe incluir las filas `teacher_availability` creadas dentro de la ventana exacta del runner, sin borrar disponibilidad preexistente de forma amplia. Esto evita acumular usuarios y filas temporales en Supabase Free.

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

# Primera provision de Queue staging: DLQ primero y Queue despues.
pnpm exec wrangler queues create espanol-honesto-fulfillment-staging-dlq
pnpm exec wrangler queues create espanol-honesto-fulfillment-staging-queue
pnpm exec wrangler queues info espanol-honesto-fulfillment-staging-dlq
pnpm exec wrangler queues info espanol-honesto-fulfillment-staging-queue

# Desplegar solo el Fulfillment Worker staging con sus bindings declarados.
pnpm exec wrangler deploy --config workers/fulfillment/wrangler.toml --env staging --keep-vars --strict

# Producción: plan primero; cada write exige su aprobación exacta separada.
pnpm launch:cloudflare-production-fulfillment-bootstrap
pnpm launch:cloudflare-production-fulfillment-secrets
pnpm launch:cloudflare-production-worker-phase1
pnpm launch:cloudflare-production-worker-secrets
pnpm launch:cloudflare-production-fulfillment-enable
```

Antes de provisionar, ejecutar `wrangler whoami`, `wrangler queues list` y
`wrangler deployments status --config workers/fulfillment/wrangler.toml --env staging --json`;
declarar la cuenta, comprobar que los dos nombres no existen y capturar la versión activa.
No crear, enlazar ni desplegar recursos Queue de production dentro de este procedimiento.

Rollback compuesto de Queue staging:

1. Pausar delivery con `pnpm exec wrangler queues pause-delivery espanol-honesto-fulfillment-staging-queue` para conservar los mensajes sin entregarlos al código anterior.
2. Volver a la versión capturada con `pnpm exec wrangler rollback <version-id> --config workers/fulfillment/wrangler.toml --env staging --yes`.
3. Verificar `/health`, identidad/runtime y la versión activa.
4. Si se abandona el consumidor Queue, retirarlo con `pnpm exec wrangler queues consumer remove espanol-honesto-fulfillment-staging-queue espanol-honesto-fulfillment-staging`.
5. Conservar Queue, DLQ y mensajes para diagnóstico; no borrar ni purgar. En Workers Free la retención es 24 horas no configurables, también durante una pausa, por lo que hay que exportar la evidencia operativa antes de que expire. Reanudar delivery solo después de redesplegar una versión compatible y verificar el consumidor.

Un job marcado `STALE_PROCESSING_REQUIRES_RECONCILIATION` o
`POST_EFFECT_FINALIZATION_REQUIRES_RECONCILIATION` queda en cuarentena y no se
reejecuta automáticamente: revisar primero Drive, Calendar y Resend, y usar
Admin > Jobs > Reintentar solo cuando se haya descartado o corregido un efecto duplicado.

La secuencia completa está en `docs/launch/CLOUDFLARE_PRODUCTION.md`. Bootstrap, HMAC mínimo de fulfillment, web, HMAC mínimo web, secrets activos finales y enable fulfillment son aprobaciones distintas. El runner de web se niega a desplegar sin un bootstrap ejecutado, con exactamente el HMAC compartido y providers ausentes, verificado de nuevo contra su versión remota actual. El runner completo de secrets fulfillment se reserva para la ventana final y mantiene `production_bootstrap`; no envía emails ni procesa jobs. El runner enable es el único que despliega `--env production` y activa runtime/email/cron; si el resultado es fallido o ambiguo, restaura y verifica el bootstrap inerte. Las fases deben terminar con atestación autenticada de identidad, versión Cloudflare, modo operativo y ref Supabase exactos.

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
