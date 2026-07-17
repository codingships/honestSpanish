# Supabase Backup Runbook

Estado: cierre técnico post-RC. Ejecutar una sola vez después de integrar `RC_BASE_SHA` en `main`, con production todavía inerte. Repetir antes del lanzamiento únicamente si Supabase cambia después de ese snapshot.

Production sigue en Supabase Free, sin backup programado nativo. La ruta canónica actual es un dump lógico `public + auth`, cifrado con Windows EFS, verificado contra el estado mínimo live y guardado fuera del repositorio.

## Fronteras

- El runner lee Supabase y escribe un archivo local cifrado; no escribe en la base de datos ni en servicios externos.
- El backup histórico `launch:supabase-production-logical-backup` pertenece al cleanup/rollout ya cerrado. No reutilizarlo para el estado mínimo post-cierre.
- El nuevo receipt es `supabase_production_post_closure_logical_backup`; no contiene la ruta, connection string, emails, IDs de usuario ni secretos.
- Nunca guardar dumps en el repo, `.codex-ops`, `outputs`, capturas, logs o documentación versionada.
- Nunca usar un destino existente. Si una ejecución falla, no reutilizar ni sobrescribir el parcial: elegir otro destino y obtener una aprobación nueva.
- `pg_restore --list` demuestra que el archivo se puede inventariar; es un tabletop, no una restauración completa.

## Precondiciones

1. Rama `main`, worktree limpio y `HEAD = origin/main =` SHA canónico de 40 caracteres.
2. PR/CI verde para ese mismo SHA.
3. Production continúa inerte: signup, checkout, email, Cron, Queues productoras/consumidoras, dominios y Stripe Live sin activar.
4. El último intento real —no `plan-only`— de `pnpm launch:production-inert-final-readonly -- --capture-readonly` terminó con éxito y produjo `production-inert-final-receipt.json`. Un intento real posterior fallido o incompleto invalida receipts anteriores. El runner valida hashes summary/receipt, target y `databaseStateSha256`; exige al menos 5 minutos de TTL restante inmediatamente antes del dump y vuelve a exigir que el receipt siga vigente en la comprobación final.
5. `.env` contiene `SUPABASE_DB_URL` para `vkkahxsybhbutszerawz`; el valor no se imprime ni se pasa por argumentos.
6. Windows Credential Manager contiene la sesión Supabase CLI segura usada por los runners del proyecto.
7. `psql`, `pg_dump` y `pg_restore` están disponibles.
8. El directorio padre del destino existe fuera del repo y `cipher.exe` confirma EFS.

## Contrato Del Snapshot

El dump debe contener `auth.users`, todas las demás tablas base live gestionadas por `auth` y exactamente estas 22 tablas públicas:

`admin_audit_log`, `checkout_intents`, `crm_activities`, `crm_consents`, `crm_contacts`, `crm_opportunities`, `crm_tasks`, `email_recipient_budget_usage`, `fulfillment_effects`, `fulfillment_jobs`, `leads`, `package_prices`, `packages`, `payments`, `processed_webhook_events`, `profiles`, `profiles_private`, `sessions`, `student_teachers`, `subscriptions`, `support_tickets` y `teacher_availability`.

El contrato rechaza expresamente `public.jobs`, `public.staging_integration_smoke_runs`, `public.staging_integration_smoke_leases` y cualquier otra tabla pública no esperada.

## Plan Sin Red

El plan exige ya el destino, el receipt fresco y el SHA; no acepta un plan incompleto:

```powershell
pnpm launch:supabase-production-post-closure-backup plan `
  --destination "<RUTA_ABSOLUTA_NUEVA.dump>" `
  --production-inert-evidence "<production-inert-final-receipt.json>" `
  --canonical-sha "<RC_BASE_SHA>"
```

Revisar:

- `outputs/launch-supabase-production-post-closure-backup/<timestamp>/summary.json`
- `outputs/launch-supabase-production-post-closure-backup/<timestamp>/exact-approval-required.txt`

El plan debe mostrar `PLAN_ONLY_READY`, `networkAccessPerformed=false`, `databaseWritePerformed=false`, `externalServiceWritePerformed=false`, `localBackupWritten=false`, target/SHA/receipt/estado/contrato/destino ligados por hashes y protección EFS válida.

## Ejecución Aprobada

Copiar literalmente la frase generada en la variable de proceso `SUPABASE_PRODUCTION_POST_CLOSURE_BACKUP_APPROVAL`, sin guardarla en `.env` ni en el repo. Ejecutar una sola vez:

```powershell
pnpm launch:supabase-production-post-closure-backup execute `
  --destination "<LA_MISMA_RUTA_ABSOLUTA_NUEVA.dump>" `
  --production-inert-evidence "<EL_MISMO_production-inert-final-receipt.json>" `
  --canonical-sha "<EL_MISMO_RC_BASE_SHA>" `
  --execute-approved `
  --restore-procedure-reviewed
```

Antes de abrir red, el runner vuelve a comprobar `HEAD = origin/main =` SHA, rama, worktree, último intento real/receipt, TTL, destino ausente, EFS y aprobación exacta. Solo entonces carga `.env` con `override=false`, valida la URL production y ejecuta la primera lectura SQL exacta del estado mínimo bajo `default_transaction_read_only=on`; su hash debe coincidir con `databaseStateSha256`. Después realiza el primer GET Auth seguro.

El archivo se crea con apertura exclusiva `wx`; `pg_dump --no-owner --no-privileges` escribe por stdout y nunca usa `--file` después de una comprobación separada. Tras el dump, el runner realiza una segunda lectura SQL exacta y un segundo GET Auth, exige que ambos estados sigan coincidiendo con el receipt, revalida el TTL y verifica EFS, `pg_restore --list`, inventario live estable, contrato exacto y SHA-256. Al omitir owner/ACL, el snapshot preserva datos y esquema lógico pero no demuestra la restauración de ownership/privilegios; estos deben reaplicarse y verificarse en un restore aislado.

## Resultado Aceptable

El summary debe indicar `POST_CLOSURE_BACKUP_CREATED_AND_ARCHIVE_VERIFIED` y el receipt debe incluir, sin ruta:

- `canonicalGitSha`, SHA del receipt inerte y `databaseStateSha256`.
- SHA del contrato y binding del destino.
- Hash/tamaño del artefacto e inventario live.
- 22 tablas públicas y al menos `auth.users`.
- Dos lecturas SQL exactas del row-state y dos GET Auth estables alrededor del dump, todos ligados a `databaseStateSha256`.
- `atRestProtectionVerified=true`.
- `archiveMatchesPostClosureContract=true` y `archiveMatchesFullLiveInventory=true`.
- `restorePerformed=false`, `restoreValidation=tabletop_pg_restore_list_only`.
- `databaseWritePerformed=false` y `externalServiceWritePerformed=false`.

## Revalidación Local Posterior

Para comprobar más adelante que el dump no ha cambiado, sin abrir red ni leer credenciales:

```powershell
pnpm launch:supabase-production-post-closure-backup:verify `
  --artifact "<RUTA_ABSOLUTA_DEL_MISMO.dump>" `
  --receipt "<post-closure-backup-receipt.json>"
```

El revalidador exige un `.dump` ordinario no symlink fuera del repositorio, el receipt canónico exacto, el mismo binding de destino, EFS, tamaño, SHA-256, `pg_restore --list`, las 22 tablas `public`, `auth.users`, el inventario `auth` completo registrado y el mismo TOC. Solo genera evidencia sin rutas ni secretos y declara `networkAccessPerformed=false`, `credentialEnvironmentRead=false` y `databaseReadPerformed=false`.

## Fallo O Ambigüedad

- Detenerse sin reintentar.
- No borrar ni sobrescribir automáticamente un parcial.
- No emitir ni aceptar receipt si fallan Auth, inventario, EFS, dump, TOC, hash o estabilidad.
- Si Supabase cambió, generar primero otra atestación inerte y otro plan; no reutilizar la aprobación.
- Una restauración de prueba solo puede hacerse en una base/proyecto aislado bajo otro alcance. Nunca restaurar sobre production para comprobar el dump.

## Alternativas

- Upgrade Pro: confirmar coste, retención y procedimiento de restauración antes de cambiar el plan.
- Riesgo aceptado: solo si Alin decide expresamente lanzar sin snapshot vigente; registrar owner, fecha, motivo y rollback. No es la ruta prevista para este RC.

## Después

Con el backup válido y production todavía inerte:

```bash
pnpm launch:cloudflare-production-runtime-readonly
pnpm launch:operations
pnpm launch:status
pnpm launch:rc
```

Registrar el receipt no secreto como soporte de `database_readiness`; el artefacto y su ruta permanecen fuera de la evidencia.

La reatestación Cloudflare es GET-only. No repetir Cloudflare C-D-E, rollout/Auth/disponibilidad Supabase, Stripe test, smoke staging ni el simulacro de rollback por caducidad de evidencias.
