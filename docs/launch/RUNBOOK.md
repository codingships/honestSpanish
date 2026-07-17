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

### Backup Lógico Post-Cierre Del RC

Estado: pendiente de ejecutarse una sola vez después de integrar el `RC_BASE_SHA` técnico en `main`. Es distinto del backup histórico previo al cleanup/rollout y no autoriza ninguna escritura en Supabase.

1. Desde `main` limpio, demostrar `HEAD = origin/main = RC_BASE_SHA` y CI verde.
2. Renovar `pnpm launch:production-inert-final-readonly -- --capture-readonly` mediante las dos consultas SQL `READ ONLY` y el GET Auth intermedio; usar ese receipt fresco, no el Auth receipt histórico del rollout.
3. Ejecutar primero el plan y después la ejecución aprobada de `pnpm launch:supabase-production-post-closure-backup` con un destino absoluto nuevo dentro del directorio EFS externo al repositorio.
4. El runner comprueba target production exacto, Auth inerte, inventario live antes/después, las 22 tablas públicas actuales, `auth.users`, EFS, hash y `pg_restore --list`. Rechaza `public.jobs`, `staging_integration_smoke_runs`, `staging_integration_smoke_leases`, rutas dentro del repo y cualquier destino ya existente.
5. La creación del archivo usa apertura exclusiva (`wx`) y vuelca `pg_dump` por stdout; nunca usa `--file` después de una comprobación separada. Si falla, el parcial no se reutiliza ni se sobrescribe: se conserva para diagnóstico seguro o se elimina manualmente fuera de este runner y se elige otro nombre.
6. El receipt nuevo se liga a `RC_BASE_SHA`, al SHA de la atestación inerte, a `databaseStateSha256`, al inventario y al hash del dump. No contiene la ruta ni credenciales. `pg_restore --list` es un tabletop de restauración, no una restauración real.

Consultar `docs/launch/SUPABASE_BACKUP_RUNBOOK.md` para la aprobación exacta y las limitaciones. El runner histórico `launch:supabase-production-logical-backup` permanece reservado a la trazabilidad pre-rollout y no debe reutilizarse para este snapshot mínimo post-cierre.

### Rollout Supabase Production Inerte

Estado: ejecutado y verificado el 2026-07-17. Este procedimiento se conserva para auditoría, recuperación y trazabilidad; no debe repetirse para renovar evidencias temporales. El cierre histórico incluye cleanup público, 25 migraciones en siete olas, Auth mínimo admin+profesor, cinco franjas de disponibilidad y atestación final DB/Auth. Antes de una futura escritura solo se renuevan las lecturas pre-write exigidas por el runner.

Objetivo: llevar `espanol-honesto` (`vkkahxsybhbutszerawz`) al esquema RC sin abrir checkout y sin ocultar el historial divergente.

Estado de partida histórico previo al rollout: production contenía 24 entradas y tenía pendientes las 25 migraciones RC del allowlist; staging contenía el RC completo más `20260710150000_staging_integration_smoke_runs.sql` y `20260713161300_allow_staging_custom_hostname.sql`, ambas staging-only. El receipt final del 2026-07-17 prueba 49 entradas, las 25 migraciones aplicadas y cero staging-only en production.

Contrato historico ejecutado: cada backup, cleanup y rollout exigio `pnpm launch:supabase-auth-preflight -- production` por Management API GET y un `auth-inert-receipt.json` fresco para el target exacto, con `disable_signup=true`, `mailer_autoconfirm=false` y `externalWritePerformed=false`. Para una escritura futura se genera otro receipt y se liga por SHA-256; el vencimiento del anterior no reabre ni autoriza repetir el rollout ya cerrado.

1. Ejecutar `pnpm launch:supabase-production-readonly-preflight`. Debe confirmar el ref exacto, usar `default_transaction_read_only=on`, terminar sin ambiguedades y no seleccionar identificadores, emails, IDs Stripe, payloads ni secretos. Conservar su `summary.json`; caduca a las 24 horas para este flujo.
2. Capturar inmediatamente antes del plan el manifiesto historico fresco con `pnpm launch:supabase-production-history-reconciliation -- --capture-readonly`. El comando valida por separado que `PUBLIC_SUPABASE_URL` y `SUPABASE_DB_URL` identifican exactamente `vkkahxsybhbutszerawz`, fija el SHA-256 del unico SQL permitido, fuerza `default_transaction_read_only=on` y ese SQL abre ademas `BEGIN READ ONLY`. El snapshot existe solo en memoria: no persiste URL, SQL crudo, statements remotos ni archivo temporal; escribe unicamente el manifiesto agregado y su resumen. El manifiesto caduca a los 15 minutos y su ruta explicita debe pasarse como `--history-reconciliation-manifest <immutable-review-manifest.json>` tanto a `pnpm launch:supabase-production-rollout-plan` como a `pnpm launch:supabase-production-rollout`. Revisar ambos planes antes de continuar. El segundo comando no conecta en su modo por defecto: fija los 25 hashes, las siete olas, los efectos que se verificaran y la exclusion de `20260710150000_staging_integration_smoke_runs.sql` y `20260713161300_allow_staging_custom_hostname.sql`, ambas exclusivas de staging. `fixture-preservation-policy.template.json` debe completarse contra `scripts/launch/production-fixture-cleanup-contract-v3.json`: las 18 clases, conteos y decisiones deben coincidir exactamente y la aprobacion caduca a las 24 horas. La politica no autoriza por si sola ninguna escritura.
3. Crear el backup con `pnpm launch:supabase-production-logical-backup -- plan --destination <ruta-absoluta-nueva.dump> --auth-inert-evidence <auth-inert-receipt.json>` y despues su ejecucion aprobada con la misma evidencia aun fresca. El directorio debe estar fuera del repositorio y cifrado con Windows EFS, verificado por `cipher.exe`; el archivo incluye solo `public` y `auth`. No continuar sin `backup-receipt.json` fresco, verificado y vinculado al SHA-256 Auth. Conservar la ruta fuera de evidencias: se vuelve a pasar solo como `--backup-artifact <la-misma-ruta.dump>` a cada runner destructivo para revalidar existencia, SHA-256, EFS y TOC. El dump contiene PII y hashes de contrasena: nunca guardarlo en el repo, outputs, capturas o logs.
4. Ejecutar primero el preview de `pnpm launch:supabase-production-fixture-cleanup -- preview`. La ejecucion aprobada exige ademas `--auth-inert-evidence <auth-inert-receipt.json>` y `--preservation-policy <fixture-preservation-policy.json>`. El runner revalida inmediatamente proyecto, snapshot, hash del contrato v3, fecha, conjunto exacto de 18 clases, conteos y decisiones; liga el SHA-256 de la politica a la frase de aprobacion, gate SQL, marcador terminal y receipt. En una unica transaccion elimina exactamente 111 filas de la tabla legacy `public.jobs`, la elimina sin `CASCADE`, elimina los 2 `support_tickets` y el resto de fixtures publicos, conserva solo `group`, `standard`, `hybrid` y `bootcamp`, y limpia sus referencias Stripe locales. Debe emitir `public-cleanup-receipt.json` vinculado a los SHA-256 Auth y de politica; Auth, Storage, Stripe y Google quedan fuera de esta transaccion.
5. Con el backup y el recibo publico, usar `pnpm launch:supabase-production-auth-cleanup` para el preflight y la fase `delete`. Debe conservar solo admin/profesor, borrar los 136 alumnos fixture, revocar refresh sessions, rotar credenciales sin conservarlas y emitir `auth-reduced-quarantined-receipt.json` con `auth=2`, `profiles=0`. Mantener production sin trafico durante la cuarentena.
6. Cerrar por separado los 110 folders fixture de la raiz Drive production: `pnpm launch:google-production-fixture-cleanup` solo puede mover a papelera los hijos directos del snapshot exacto y verificar raiz activa vacia; nunca borra permanentemente. Si se difiere deliberadamente, aportar evidencia explicita aprobada con el mismo conteo. Ninguna de las dos rutas autoriza Calendar, permisos, la raiz o staging.
7. Aplicar y verificar primero en staging, y en este orden, `20260712112000`, `20260712114000`, `20260712114500`, `20260712115000` y `20260712195500` con `pnpm launch:supabase-staging-hardening`. El runner acepta solo un prefijo exacto ya aplicado y escribe exclusivamente la cola pendiente. El post-check debe cerrar `leads` (enum, obligatoriedad y defaults), ausencia de `public.is_admin`, `reminder_sent`, `sessions.status` obligatorio/default/check, las 13 policies de identidad limitadas a `authenticated` con `auth.uid()` cacheable, grants Data API exactos 1/63/0, RLS 18/18 en tablas concedidas y defaults globales/de `public` fail-closed, indices, duraciones 30/40/50, trigger/solapes y politica 18+. Production solo acepta un summary real `APPLIED_AND_VERIFIED`, no plan ni una afirmacion de que ya estaba aplicado. Para Sentry, Supabase consume exclusivamente un `sentry-production-hardening-receipt.json` v2 fresco y rollout-eligible. Si el hardening aun no existe se usa la ejecucion aprobada. Si ya existe y el receipt ejecutado ha caducado, usar `pnpm launch:sentry-production-hardening -- --reattest-existing --source-receipt <receipt-ejecutado.json>`: esta ruta hace solo GET, exige las huellas POST originales de ambos workflow IDs, detector y owner, dos readbacks estables, scrubbing IP y definiciones exactas, y bloquea ante cualquier recurso extra o deriva.
8. Mientras la cuarentena Auth siga activa, con al menos 15 minutos restantes al iniciar, y checkout continúe desactivado, ejecutar `pnpm launch:supabase-production-rollout -- --execute-approved --checkout-disabled-confirmed --through deferred_rc_hardening` con las rutas explicitas de preflight, `--auth-inert-evidence <auth-inert-receipt.json>`, `--backup-receipt <backup-receipt.json>`, `--backup-artifact <la-misma-ruta.dump>`, `--preservation-policy <fixture-preservation-policy.json>`, limpieza publica, Auth reducido, politica Google, hardening staging y `--sentry-hardening-evidence <sentry-production-hardening-receipt.json>`. Cuando la evidencia Sentry sea una reatestacion, pasar ademas `--sentry-hardening-source-receipt <receipt-ejecutado-original.json>`: el runner recalcula su SHA-256, valida su prueba de escritura y propiedad POST y la liga tanto a la reatestacion como a la aprobacion exacta; un source ausente, fabricado o alterado bloquea antes de conectar. Para cualquier ola que dependa del hardening staging, `SUPABASE_STAGING_DB_URL` debe identificar exactamente `mzjyvmlxfpzdfdjzxxyj`; antes de abrir el preflight production o ejecutar un write, el runner repite el post-verify completo de staging bajo `BEGIN READ ONLY` y bloquea con `BLOCKED_LIVE_STAGING_HARDENING` ante cualquier deriva. Inmediatamente antes del primer write vuelve a comprobar el dump sin guardar su ruta, revalida la politica de preservacion exacta y repite el GET Auth inerte. El runner aplica las 25 migraciones en siete transacciones/olas: `processed_at_small_fix`, `base_model_reconciliation`, `application_schema`, `runtime_and_policy`, `billing_contract`, `fulfillment_ledger` y `deferred_rc_hardening`. Registra el source exacto en historial, comprueba que la cuarentena no expire entre olas y hace verificacion read-only despues de cada una. `supabase db push` y `supabase migration repair` estan prohibidos.
9. Solo tras `production-rollout-receipt.json`, y una vez vencida la cuarentena, ejecutar el preflight y `finalize` de `pnpm launch:supabase-production-auth-cleanup`. Debe crear exclusivamente los dos perfiles minimos admin/profesor y sus dos filas privadas, y emitir `auth-policy-receipt.json`. Hasta entonces production sigue inerte.
10. Con ese receipt final, ejecutar primero `pnpm launch:production-availability -- --preflight-readonly --auth-policy-receipt <auth-policy-receipt.json>` y despues su ejecucion aprobada. Antes de escribir, el runner vuelve a probar exactamente dos usuarios Auth, perfiles admin+profesor, cero sesiones y refresh tokens, las 25 migraciones production y ausencia de disponibilidad previa; la transaccion toma locks de lectura sobre las tablas Auth para impedir deriva durante el insert. Solo puede crear para el profesor preservado las cinco franjas L-V 09:00-18:00 `Europe/Madrid`, vuelve a verificar todo el posture y emite `production-availability-receipt.json` con los conteos Auth cero; signup y checkout siguen desactivados.
11. Inmediatamente despues de disponibilidad, ejecutar `pnpm launch:production-inert-final-readonly -- --capture-readonly --rollout-receipt <production-rollout-receipt.json> --auth-policy-receipt <auth-policy-receipt.json> --availability-receipt <production-availability-receipt.json>`. El runner liga por SHA-256 los tres receipts y genera la atestacion final renovable de Supabase/Auth mediante Management API `GET` entre dos lecturas SQL `READ ONLY`. Cada lectura vuelve a exigir: exactamente 2 usuarios y 2 perfiles/private minimos, un admin y un profesor ligados a las mismas identidades por un hash que incluye el rol, 0 sesiones y 0 refresh tokens; `public.jobs` ausente; 0 filas en las tablas transaccionales, CRM, billing y fulfillment inertes (`subscriptions`, `student_teachers`, `sessions`, `payments`, `leads`, `processed_webhook_events`, `fulfillment_jobs`, `support_tickets`, `admin_audit_log`, `crm_contacts`, `crm_opportunities`, `crm_tasks`, `crm_activities`, `crm_consents`, `package_prices`, `checkout_intents`, `email_recipient_budget_usage` y `fulfillment_effects`); exactamente los paquetes `group`, `standard`, `hybrid` y `bootcamp`, cuyo hash canonico debe coincidir con `canonicalPackages.catalogSha256` de `scripts/launch/production-fixture-cleanup-manifest.json`. Ese hash cubre para cada paquete el identificador, `display_name` localizado, precio mensual en centimos EUR, sesiones mensuales, flags de sesion grupal y doble profesor, y estado activo; ademas, los cuatro deben tener `catalog_version=1` y `stripe_product_id`/`stripe_price_1m`/`stripe_price_3m`/`stripe_price_6m` nulos. Tambien exige 0 objetos Storage con propietario; las cinco franjas L-V 09:00-18:00 del profesor; las 25 migraciones RC exactas por version, nombre y SHA-256 del statement, 0 migraciones staging-only y un historial total cerrado de 49 entradas. El `GET` intermedio debe mantener `disable_signup=true` y `mailer_autoconfirm=false`, y ambos readbacks SQL deben coincidir. El receipt caduca como maximo a los 15 minutos y no persiste identidades ni PII.

    La captura real requiere localmente `TEST_ADMIN_EMAIL` y `TEST_TEACHER_EMAIL`, distintos, y prueba que cada email esperado coincide con su rol tanto en `auth.users` como en `public.profiles`; esos valores solo se pasan a la consulta y nunca se persisten en receipt, resumen ni logs. Antes de iniciar las lecturas live escribe un `summary.json` durable con `CAPTURE_IN_PROGRESS`; solo al completar y ligar el SHA-256 del receipt pasa a `PRODUCTION_INERT_FINAL_READONLY_VERIFIED`. Si el intento real mas reciente queda `CAPTURE_FAILED` o `CAPTURE_IN_PROGRESS`, el consumidor bloquea y no puede recurrir a un exito anterior todavia fresco. Sin `--capture-readonly` el comando solo genera `PLAN_ONLY_NO_NETWORK`, no toca red y ese plan se ignora al seleccionar el ultimo intento real. No reutilizar como cierre final el receipt Auth historico que autorizo fases anteriores.
12. Si falta el marcador de commit o falla una verificacion, no reintentar. Mantener checkout y fulfillment inertes, generar preflight fresco y elegir un fix-forward revisado. Si hace falta restaurar, hacerlo en un proyecto Supabase aislado, verificarlo y pedir otra aprobacion para cambiar conexiones; ningun runner restaura o conmuta automaticamente. El backup no incluye Storage ni objetos externos Stripe/Google.

#### Recuperacion Del Cleanup Google Drive Production

`pnpm launch:google-production-fixture-cleanup` solo puede iniciar una limpieza nueva cuando la lectura live contiene exactamente los 110 hijos directos canónicos y todos son carpetas. Execute exige `GOOGLE_PRODUCTION_CLEANUP_RECOVERY_DIR` con una ruta absoluta fuera del repositorio; sin ella bloquea antes de Google. Antes del primer `files.update(trashed=true)` y antes de cada write posterior, persiste allí una cadena append-only de estados ligada por checksums. Cada estado contiene únicamente la huella de la raíz, la huella agregada original y 110 huellas de identidad de hijos; nunca nombres, owners, IDs raw, credenciales ni permisos. No borrar, mover ni editar ese directorio mientras el rollout production siga abierto.

Reglas de reanudación fail-closed:

- Si la raíz activa tiene entre 1 y 109 hijos y no existe una cadena durable válida que pruebe el baseline original de 110, el runner termina `PARTIAL_STATE_UNATTESTED`: no genera una aprobación nueva para el subconjunto y no escribe.
- Si la raíz ya está vacía pero falta esa cadena, termina `ALREADY_CLEAN_UNATTESTED`: cero writes y cero `google-fixture-policy-evidence.json`. Una raíz vacía por sí sola no demuestra qué 110 carpetas se movieron.
- Si existe la cadena válida, cada hijo activo debe pertenecer exactamente al allowlist original de 110 huellas. Cualquier hijo nuevo, cambio de metadata de identidad, raíz distinta, salto de secuencia, estado manipulado o no-folder bloquea writes y receipts.
- Una reanudación conserva la frase, count y fingerprint de la aprobación original de 110; nunca solicita aprobar solo los hijos restantes. Ejecutar primero en modo plan y exigir `RECOVERY_PLAN_READY` antes de una nueva aprobación de write.
- Si el proceso cae después de mover uno o todos los hijos pero antes de actualizar el summary o emitir el receipt, la siguiente ejecución read-only reconcilia el conjunto activo live contra la cadena. Cuando confirma cero activos, persiste `EMPTY_VERIFIED` y emite un `google-fixture-policy-evidence.json` fresco `schemaVersion=2` con `observedActiveRootChildrenBefore=110`, `observedFoldersBefore=110`, `activeRootChildrenAfter=0`, `permanentlyDeleted=0`, `rootIdStored=false`, `baselineFingerprintSha256`, `recoveryStateSha256` y `recoveredAfterInterruptedRun`; ese es el único cierre `TRASHED_AND_VERIFIED` consumible por el rollout Supabase. El formato legado queda reservado a una deferral explícita y nunca prueba una limpieza ejecutada.

El estado durable no es autorización. Toda reanudación que todavía necesite mover carpetas exige de nuevo `--execute-approved` y las tres variables exactas mostradas por el `approval-gate.md`, ligadas siempre al baseline original. El runner no restaura carpetas, no vacía la papelera y no toca raíz, plantilla, permisos, Calendar ni staging.

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

# Si la ventana de 65 minutos queda demasiado corta: preflight separado read-only.
pnpm launch:supabase-production-auth-requarantine:preflight -- \
  --backup-receipt <backup-receipt.json> \
  --public-cleanup-receipt <public-cleanup-receipt.json> \
  --auth-reduced-receipt <auth-reduced-o-auth-requarantined-receipt.json>

# Re-quarantine exact-gated: cero deletes, cero emails y cero otros servicios.
pnpm launch:supabase-production-auth-requarantine -- \
  --backup-receipt <backup-receipt.json> \
  --public-cleanup-receipt <public-cleanup-receipt.json> \
  --auth-reduced-receipt <auth-reduced-o-auth-requarantined-receipt.json> \
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

El preflight toma `PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` y `SUPABASE_DB_URL` de variables de proceso o `.env`, y resuelve exclusivamente `TEST_ADMIN_EMAIL`/`TEST_TEACHER_EMAIL` desde proceso o `.env.test`. Nunca lee sus passwords. Para la API de Management, los runners leen automáticamente la credencial `Supabase CLI:supabase` del Administrador de credenciales de Windows: no se copia al portapapeles, no se guarda en `.env`, no se persiste en el repositorio y solo se expone a un cliente temporal limitado al endpoint Auth del proyecto autorizado. Cada write exige además el valor exacto de `SUPABASE_PRODUCTION_AUTH_INERT_CONFIRMATION` y uno de cinco envs de aprobacion independientes (`..._DELETE_APPROVAL`, `..._RESUME_DELETE_APPROVAL`, `..._FINALIZE_APPROVAL`, `..._RESUME_FINALIZE_APPROVAL`, `..._REQUARANTINE_APPROVAL`). Copiar esos valores de aprobación desde `exact-approval-required.txt`, no reconstruirlos manualmente.

La ruta `re-quarantine` solo es admisible tras validar el receipt Auth anterior contra el mismo backup y cleanup publico y volver a observar live `auth=2`, `candidates=0`, `profiles=0`, `profiles_private=0`, signup desactivado, freeze intacto, cero fixtures y cero ownership Storage. La ejecución exige `SUPABASE_PRODUCTION_AUTH_REQUARANTINE_LEDGER_DIR` en variables de proceso: debe ser una ruta absoluta que resuelva físicamente fuera del repositorio. Allí consume de forma atómica y permanente la pareja `evidenceSha256 + priorReceiptSha256`; limpiar `outputs` no reabre la aprobación. Persiste además un checkpoint write-ahead antes de cada una de las dos rotaciones aleatorias no retenidas; `externalWritePerformed=true` nunca vuelve a `unknown` y `pendingWriteAttempt` registra por separado una llamada ambigua. No borra usuarios, no genera links/reset y no toca Storage, Stripe, Google ni otros servicios. Solo emite `auth-requarantined-receipt.json` si el post-check conserva exactamente los dos IDs agregados y demuestra que `auth.sessions=0` y `auth.refresh_tokens=0`; el receipt declara ausencia verificada tras la rotación, no una revocación causal por API. El receipt nuevo incluye el SHA-256 del preflight, del receipt previo, del backup y del cleanup publico y abre otra ventana `JWT TTL + 5 minutos`. Ante fallo parcial no hay autoretry del mismo par: preflight fresco, nueva aprobación exacta y, tras un cierre correcto, el último receipt debe ser el nuevo predecesor.

Un fallo parcial termina el proceso y deja `auth-cleanup-checkpoint.json` solo con conteos y hashes agregados. No reejecutar el mismo comando: generar un preflight nuevo con `--checkpoint`, revisar el estado y usar `resume-delete` o `resume-finalize` con otra aprobacion. Se bloquea si aparece un usuario posterior al freeze, si los dos preservados no son exactos, si hay ownership en Supabase Storage, si signup no esta desactivado, si JWT supera una hora, si queda cualquier fixture o si el receipt de las 25 migraciones en siete olas no coincide. No envia reset ni ningun otro email, no toca Stripe y deja expresamente intactas las 110 carpetas fixture observadas en Google Drive.

### Credenciales Locales Cifradas

Cloudflare se da de alta con `pnpm exec wrangler login --use-keyring`, se atestigua con `pnpm exec wrangler auth keyring` y `pnpm exec wrangler whoami --json`, y se rota con `pnpm exec wrangler logout` seguido de un login nuevo. No ejecutar manualmente `wrangler auth token --json`: el proveedor es la unica frontera autorizada para leerlo y desactiva los logs de disco de Wrangler durante todo su alcance. Supabase se da de alta con `supabase login`, se comprueba mediante el destino de Windows Credential Manager `Supabase CLI:supabase` y un preflight GET, y se rota con `supabase logout` seguido de un login nuevo. Nunca sustituir un fallo de estos almacenes por tokens en portapapeles, `.env`, argumentos, logs u outputs.

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

Secuencia canónica:

La única secuencia vigente de activación es `docs/launch/FINAL_CLOSURE.md`, sección `Secuencia Exacta De Activación Ligada A LAUNCH_SHA`. No mantener ni ejecutar una segunda lista desde este runbook.

La preparación inerte C-D-E ya quedó ejecutada y atestiguada el 2026-07-17. Fulfillment production vigente es `c4854b76-a245-4afd-b42c-8ce6a8b5a36c` y web production vigente es `8087b6dc-ff94-4af0-8de0-2a923e58e99f`, ambos HMAC-only/bootstrap. Los comandos de creación/bootstrap se conservan solo como trazabilidad y recuperación; no se repiten por caducidad de un GET.

La ventana final empieza desde ese baseline inerte y exige `LAUNCH_SHA`, preflight fresco y aprobaciones separadas para secrets activos, web activo con checkout cerrado, enable fulfillment, tráfico/domains, Auth production, catálogo Stripe Live, signup, checkout y una única compra propia. Si falta una de esas fronteras o su rollback, `integration_readiness` permanece pendiente.

Rollback financiero inmediato:

1. Fijar `CHECKOUT_ENABLED_OVERRIDE=false` en el Worker production; esto oculta el checkout y hace que la API devuelva 403 antes de Supabase/Stripe.
2. Si todavía no hubo cobros, se puede compensar a bootstrap. Si ya hubo un cobro, mantener webhook y la última versión activa segura de fulfillment para terminar/reconciliar; no desactivar jobs pendientes ciegamente.
3. No borrar Prices, clientes ni eventos; investigar y reembolsar desde Stripe cuando corresponda.
4. Seguir el orden completo y las condiciones de dominio/Auth/tráfico de `docs/launch/FINAL_CLOSURE.md`; no abrir tráfico antes del smoke propio satisfactorio.

### Smoke Integral Staging Y Smoke Minimo Production

El arnés `scripts/smoke/real-env-smoke.ts`, el ciclo billing Stripe test y el rehearsal integral son exclusivos de staging y quedaron ejecutados/cerrados el 2026-07-12. Sus evidencias prueban checkout test, webhook, billing, seis emails allowlisted, Drive/Docs/Calendar/Meet, scheduling, jobs y cleanup con checkout desplegado cerrado. No repetirlos por antigüedad de la evidencia; solo una deriva material de código/configuración y otra autorización exacta justificarían una nueva ejecución.

En production no ejecutar ese arnés. Usar únicamente `production-minimal-smoke-checklist.md` sobre `LAUNCH_SHA`, después de cerrar los otros cuatro gates finales y bajo la frontera temporal de tráfico definida en `docs/launch/FINAL_CLOSURE.md`. La comprobación cubre páginas/legales, login admin/profesor recuperado, Auth redirects, salud de proveedores, catálogo Live, signup tras Go/No-Go y una sola compra propia aprobada. Checkout no se hace público hasta que esa compra termine y se verifiquen webhook, Supabase, contrato, fulfillment, email, Drive/Calendar y Portal.

## Deploy

### Flujo Normal

1. Crear cambios en una rama corta y abrir PR hacia `main`.
2. CI debe pasar: typecheck, lint, tests, build, E2E publico y secrets-check.
3. Para staging, seleccionar la definición `main` y ejecutar manualmente `Deploy Cloudflare staging` con el SHA completo del commit verde. El workflow rechaza otra `github.ref`, refs candidatas simbólicas y SHAs sin `build-and-test=success`; serializa despliegues y usa el environment `staging`, cuya deployment branch policy debe admitir solo `main`.
4. GitHub Actions valida cuenta Cloudflare y, mediante GETs sin mutación, Supabase `mzjyvmlxfpzdfdjzxxyj` y Stripe Sandbox `acct_1TruqOC22M3erP0j` España/EUR. El build recibe solo credenciales públicas reales y placeholders no sensibles; los secretos runtime se preservan en Cloudflare y no se exponen a Vite/Astro.
5. Tras ambos dry-runs despliega primero el Cloudflare Fulfillment Worker staging y después el Astro Worker staging con `FULFILLMENT_SERVICE` apuntando al target ya existente. Si el segundo falla, detener retries y reconciliar el estado mixto con el runbook/rollback de staging.
6. Exigir `launch:staging-operations -- --include-wrangler` y el probe final `403 Checkout is disabled`; después validar el ciclo billing canónico y el smoke integral staging con checkout cerrado, preflight read-only, evidencia explícita y cleanup completo.
7. Revisar la PR y fusionar a `main` solo cuando el Release Candidate esté aprobado. No existe ni se necesita una rama permanente `staging`.
8. Production no se despliega por push ni desde el workflow de staging. El baseline bootstrap inerte y C-D-E ya están cerrados; al comenzar la ventana final se reatestan en modo read-only Cloudflare y Supabase y, sin repetir esos writes, se ejecutan bajo aprobaciones separadas secrets activos, enable fulfillment y dominios. Los dominios se mueven desde Pages legado solo después del probe directo y la aprobación de cutover.

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

# Producción no se ejecuta desde esta lista. C-D-E ya está cerrado.
# Seguir únicamente docs/launch/FINAL_CLOSURE.md sobre LAUNCH_SHA;
# el runner de secrets fulfillment debe endurecerse antes de poder usarse.
```

Antes de provisionar, ejecutar `wrangler whoami`, `wrangler queues list` y
`wrangler deployments status --config workers/fulfillment/wrangler.toml --env staging --json`;
declarar la cuenta, comprobar que los dos nombres no existen y capturar la versión activa.
No crear, enlazar ni desplegar recursos Queue de production dentro de este procedimiento.

Simulacro controlado de rollback del Fulfillment Worker staging:

```bash
# Por defecto: Wrangler + API Cloudflare GET + /health; cero writes.
# Usa la sesion OAuth cifrada de Wrangler; no acepta token por env, archivo o portapapeles.
pnpm launch:cloudflare-staging-fulfillment-rollback-drill

# Solo con la frase exacta generada en exact-approval-required.txt.
pnpm launch:cloudflare-staging-fulfillment-rollback-drill -- --execute-approved
```

El runner fija cuenta, Worker, Queue, Queue ID y URL directa; exige backlog cero, productor y
consumidor exactos, Cron horario exacto, versiones actual/anterior al 100 %, handlers, bindings y
las once variables plaintext staging con sus valores contractuales. Wrangler no expone
`delivery_paused`, por lo que ese estado se lee por API y su ausencia nunca equivale a `false`.
Antes del primer write repite todo el preflight y la aprobación queda ligada al hash semántico,
ambas versiones, los siete writes normales y los dos writes condicionales de compensación. La
secuencia desactiva primero el Cron, normaliza y pausa la Queue, prueba el rollback y restaura
versión, Cron y Queue. Cada write tiene receipt write-ahead; un lock durable sobrevive a un corte y
solo desaparece si el recorrido completo y los tres estados finales quedan verificados. Cualquier
fallo conserva el lock y deja reconciliación manual explícita en el receipt. Si falla la restauración de la versión,
se revalida por GET que Cron siga OFF, Queue pausada y backlog a cero. Si Cron o Queue no quedan
restaurados, la compensación vuelve a desactivar Cron y pausar Queue, con receipts separados y la
misma verificación read-only final. Nunca llama endpoints de jobs, purga/borra/reconfigura consumidores, toca secretos,
dominios, DNS, Pages o production. El checklist sigue abierto hasta una ejecución aprobada con
estado `DRILL_EXECUTED_AND_CURRENT_RESTORED`.

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

La secuencia completa está en `docs/launch/CLOUDFLARE_PRODUCTION.md` y el orden canónico de activación/rollback está únicamente en `docs/launch/FINAL_CLOSURE.md`. Bootstrap, HMAC mínimo de fulfillment, web y HMAC mínimo web son cierres históricos; no se repiten. Secrets activos finales y enable fulfillment requieren aprobaciones distintas. Antes de usar el runner de secrets fulfillment hay que añadir lock/checkpoint write-ahead y reconciliación GET ante timeout/ambigüedad; hasta entonces `integration_readiness` permanece pendiente. El runner enable es el único que despliega `--env production` y activa runtime/email/cron; antes de cualquier cobro un fallo puede restaurar bootstrap, pero después de un cobro se debe mantener la última versión activa segura para reconciliar. Todas las fases deben terminar con atestación autenticada de identidad, versión Cloudflare, modo operativo y ref Supabase exactos.

## Cutover Del Dominio Staging

`https://staging.espanolhonesto.com` es el origen público canónico. La secuencia, con aprobaciones externas explícitas y checkout desactivado, es:

1. Confirmar por GET la cuenta Cloudflare `d1a22bcf6477ff2ff31d2bfb83084e44`, la zona `137264d6df2c82a7ccaf3f2d2e2464e4`, la ausencia de DNS/Custom Domain/Route en conflicto y el Worker `espanolhonesto-staging`.
2. Crear únicamente el Custom Domain `staging.espanolhonesto.com` para ese Worker y verificar DNS, TLS y respuesta del mismo runtime. No renombrar el subdominio global `workers.dev`.
3. Aplicar en Supabase staging la migración de compatibilidad de hostname y, en una aprobación separada, fijar Auth `site_url` y las seis redirecciones exactas al dominio custom.
4. Desplegar únicamente los Workers web y fulfillment de staging con `PUBLIC_SITE_URL=https://staging.espanolhonesto.com`, checkout desactivado y Preview URLs web desactivadas; comprobar atestación y probe 403.
5. Migrar el webhook Stripe test y validar firma/entrega, Turnstile, correos, alta, recuperación y smokes sobre el dominio canónico.
6. Solo después, desactivar `workers.dev` del Worker web. El host directo permanece disponible durante la transición para rollback y para no interrumpir el webhook test vigente.

No proteger todo staging con Cloudflare Access sin políticas de bypass diseñadas: bloquearía callbacks de Auth y el webhook de Stripe. La URL predecible no es un secreto ni un control de acceso.

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
4. Antes del smoke Auth, ejecutar `pnpm launch:supabase-auth-staging-callbacks` en modo plan. Con una aprobación externa separada, su ejecución debe fijar `site_url=https://staging.espanolhonesto.com`, añadir exactamente las confirmaciones `/api/auth/confirm?lang=es|en|ru` y las recuperaciones `/{es|en|ru}/reset-password`, conservar solo entradas exactas existentes, quedar `OK` con `wildcardPolicy=exact_only` y bloquear antes de escribir si el baseline contiene comodines amplios. La verificación y el rollback abarcan tanto `site_url` como `uri_allow_list`. No usar un wildcard de dominio o ruta para simplificar staging.
5. Ejecutar smoke staging: alta nueva con confirmación, recuperación de contraseña, login, checkout test si aplica, webhook test, Worker `/health`, job seguro, Resend test, Turnstile y logs. La alta y la recuperación usan una cuenta controlada y cleanup explícito; no reutilizar ni borrar las cuentas operativas de admin/profesor/alumno sin un plan aprobado.
6. Actualizar consumidores de production: Cloudflare Astro Worker, Cloudflare Fulfillment Worker y GitHub environment `Production`.
7. Ejecutar comprobaciones locales y de cierre:

```bash
pnpm secrets:check
pnpm launch:security
pnpm launch:operations
pnpm launch:final-readiness
pnpm launch:status
```

8. Ejecutar solo el smoke minimo/manual production antes de aceptar trafico publico; no repetir el arnes staging ni crear datos sinteticos masivos.
9. Revocar claves antiguas y registrar evidencia no secreta en `docs/launch/MANUAL_EVIDENCE.local.json`.

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

- Usar el historial de versiones del Astro Worker de Cloudflare para volver a la ultima versión estable.
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

1. Identificar la versión estable anterior del Astro Worker de Cloudflare.
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
