# Resumen Ejecutivo

Fecha: 2026-03-31
Estado: Bloque 1 completado (inventario + deteccion de divergencias)

## Resultado global

- Hallazgos `HIGH`: 7
- Hallazgos `MEDIUM`: 5
- Hallazgos `LOW`: 2
- Total: 14

## Riesgos principales (HIGH)

1. `DOC-002`: Estrategia de rutas/i18n documentada no coincide con comportamiento real (`/` redirige a `/es/`).
2. `DOC-005`: Documentacion legal afirma SSG, implementacion actual usa SSR (`prerender = false`).
3. `DOC-007`: Se documenta `/[lang]/checkout/*`; implementacion real usa `/api/create-checkout`.
4. `DOC-008`: Variables de email desalineadas (`FROM_EMAIL` en docs vs `EMAIL_FROM` en codigo).
5. `DOC-010`: Se documenta modulo `src/lib/google/recordings.ts` que no existe.
6. `DOC-013`: Fuente de verdad SQL ambigua (`db/schema.sql` vs `db/*.sql` vs `supabase/migrations` vs `esquema_nube.sql`).
7. `DOC-014`: Duplicacion AGENTS/CLAUDE provoca drift recurrente.

## Evidencia minima verificada en esta sesion

- `src/pages/index.astro:6` redirige `"/"` a `"/es/"`.
- `src/i18n/utils.ts:1` importa `./translations` (no `ui.ts`).
- `src/lib/email/client.ts:15` usa `EMAIL_FROM`.
- `src/pages/[lang]/legal/aviso-legal.astro:2` tiene `prerender = false`.
- `src/pages/api/create-checkout.ts:94` define `siteUrl`; no existe carpeta `src/pages/[lang]/checkout`.
- `src/lib/google/recordings.ts` no existe.
- `src/types/database.types.ts:158` usa `processed_webhook_events.created_at` mientras `db/schema.sql:129` define `processed_at`.

## Recomendacion de orden para siguiente bloque

1. Cerrar `DOC-002`, `DOC-005`, `DOC-007` (routing/render/checkout).
2. Cerrar `DOC-008` y `DOC-010` (integraciones/env).
3. Cerrar `DOC-013` (politica de fuente SQL canonica).
4. Cerrar `DOC-014` (gobierno documental).
