# Supabase Backup Runbook

Estado: final-only. No ejecutar ahora.

Este runbook existe porque production seguira en Supabase Free. En Free no contamos con backups programados nativos para cerrar Go/No-Go, asi que antes de un deploy publico, una migracion destructiva o el cierre final hay que elegir una de estas rutas:

| Ruta | Cuándo usarla | Resultado |
| --- | --- | --- |
| Backup logico/manual | Supabase sigue en Free y no se quiere pagar Pro. | Dump/export guardado fuera del repo y evidencia no secreta. |
| Upgrade Pro | Se quiere backup gestionado y restauracion mas comoda. | Confirmar backups programados en dashboard y registrar evidencia. |
| accepted_risk | Solo si Alin decide lanzar sin backup completo. | Riesgo aceptado con owner, motivo, rollbackPlan y fecha. |

## Reglas

- No guardar dumps en el repo, `.codex-ops`, `outputs`, capturas, logs ni documentos versionados.
- No pegar connection strings, passwords, service role keys, JWT secrets ni URLs con credenciales.
- No ejecutar migraciones destructivas sin backup/export o accepted_risk firmado por Alin.
- Guardar el dump en almacenamiento cifrado o gestionado fuera del proyecto.
- En el repo solo se registra metadata no secreta: entorno, metodo, timestamp, responsable, resultado y decision.

## Preflight Manual

Antes del backup/export:

1. Confirmar entorno: staging o production.
2. Confirmar proyecto Supabase correcto y que no se estan mezclando proyectos separados.
3. Confirmar ultima migracion esperada contra `supabase/migrations/` y `db/schema.sql`.
4. Confirmar que RLS sigue activo en tablas criticas.
5. Confirmar que no hay cambios destructivos pendientes sin decision explicita.
6. Confirmar donde se guardara el backup fuera del repo.

## Opcion A: Backup Logico Manual

Ejecutar desde una terminal local controlada, con la connection string obtenida desde un gestor de secretos o dashboard, sin imprimirla.

Ejemplo con placeholders:

```bash
pg_dump "$SUPABASE_DATABASE_URL" --format=custom --no-owner --no-acl --file "<SECURE_BACKUP_DIR>/espanol-honesto-production-YYYYMMDD-HHMM.dump"
```

Comprobacion minima del dump, tambien fuera del repo:

```bash
pg_restore --list "<SECURE_BACKUP_DIR>/espanol-honesto-production-YYYYMMDD-HHMM.dump" > "<SECURE_BACKUP_DIR>/espanol-honesto-production-YYYYMMDD-HHMM.manifest.txt"
```

Opcionalmente calcular checksum fuera del repo:

```bash
sha256sum "<SECURE_BACKUP_DIR>/espanol-honesto-production-YYYYMMDD-HHMM.dump"
```

No pegar el checksum si revela ruta privada o convenciones sensibles. Basta una nota agregada.

## Opcion B: Upgrade Pro

Si Alin decide usar Pro:

1. Confirmar coste en Supabase antes de cambiar el plan.
2. Activar plan y backups gestionados desde dashboard.
3. Confirmar retention y restore path.
4. Registrar evidencia no secreta en `database_readiness`.

## Restore Drill O Tabletop

Ideal:

- Restaurar el dump en un proyecto/DB separada de staging o throwaway.
- Ejecutar checks basicos: tablas criticas, migraciones, RLS, login test, lead test y flujo admin minimo.
- No restaurar nunca sobre production para probar.

Si no hay entorno throwaway:

- Ejecutar `pg_restore --list` sobre el dump.
- Revisar manifest, fecha, tamano aproximado y tablas criticas.
- Registrar que es tabletop, no restore real.

## Evidencia Manual

Registrar en `docs/launch/MANUAL_EVIDENCE.local.json` para `database_readiness` algo equivalente a:

```json
{
  "id": "database_readiness",
  "status": "pass",
  "owner": "Alin",
  "environment": "production",
  "summary": "Supabase Free backup/export final preparado y verificado fuera del repo.",
  "evidence": [
    {
      "type": "manual_note",
      "value": "Backup logico production ejecutado el <fecha>. Dump guardado fuera del repo en almacenamiento seguro. pg_restore --list revisado. Sin secretos ni datos personales en evidencia.",
      "note": "No incluir connection strings, rutas privadas completas ni dump."
    }
  ]
}
```

Si se acepta riesgo en vez de backup:

```json
{
  "id": "database_readiness",
  "status": "accepted_risk",
  "owner": "Alin",
  "environment": "production",
  "summary": "Supabase Free sin backup final completo antes de launch.",
  "riskAcceptedBy": "Alin",
  "riskAcceptedAt": "<fecha>",
  "rollbackPlan": "No ejecutar migraciones destructivas; rollback de app por Cloudflare/Git; backup/export pendiente inmediato post-launch."
}
```

## Checks Despues

Tras completar backup/export, upgrade Pro o accepted_risk:

```bash
pnpm launch:operations
pnpm launch:status
```

El comando no prueba que el backup exista; solo confirma que el procedimiento y la evidencia estan conectados. La comprobacion real de Supabase es manual y pertenece a `database_readiness`.
