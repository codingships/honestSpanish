# Anexo: SQL, esquema y fuente canonica

## Hallazgos

| ID | Fuente documental | Afirmacion | Evidencia en codigo/sql | Veredicto | Severidad | Accion propuesta | Confianza |
|---|---|---|---|---|---|---|---|
| DOC-013 | `README.md:30`, `ARCHITECTURE.md:30`, `AGENTS.md:62` | `db/schema.sql` representa el esquema completo/canonico | Coexisten `db/schema.sql`, parches en `db/*.sql`, migraciones en `supabase/migrations/*.sql`, y dump `esquema_nube.sql` | ambiguo | HIGH | Definir fuente canonica unica (recomendado: `supabase/migrations`) y politica de regeneracion de artefactos | alta |
| DOC-013A | `audit_handover.md:32` | Referencia principal a `esquema_nube.sql` | Otras docs apuntan a `db/schema.sql`; hay dos "fuentes" documentales activas | divergencia | MEDIUM | Unificar referencia a una fuente oficial y documentar rol del dump cloud | alta |
| DOC-013B | `AGENTS.md:62` (implica consistencia schema/tipos) | Tipos reflejan esquema actual | `db/schema.sql:129` usa `processed_webhook_events.processed_at`; `src/types/database.types.ts:158` define `created_at` | divergencia | HIGH | Regenerar `src/types/database.types.ts` desde esquema canonico y anadir chequeo en CI | alta |

## Inventario de artefactos SQL detectados

- `db/schema.sql`
- `db/add_status_to_leads.sql`
- `db/audit_fixes.sql`
- `db/create_leads_table.sql`
- `db/prevent_role_escalation.sql`
- `db/rls_security_patch.sql`
- `supabase/migrations/000_initial_schema.sql`
- `supabase/migrations/001_calendar_system.sql`
- `supabase/migrations/002_sessions_drive_columns.sql`
- `supabase/migrations/003_sessions_calendar_columns.sql`
- `supabase/migrations/004_sessions_report_column.sql`
- `esquema_nube.sql`

## Decision pendiente para proximo bloque

- Elegir "source of truth" oficial y reglas de sincronizacion:
  - opcion A: `supabase/migrations` (recomendado)
  - opcion B: `db/schema.sql`
  - opcion C: dual con contrato explicito y job de validacion
