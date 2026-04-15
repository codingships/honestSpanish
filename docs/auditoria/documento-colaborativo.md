# Documento Colaborativo de Auditoria

Este es el documento unico de entrada para trabajo colaborativo.
Todos los hallazgos detallados y anexos se organizan alrededor de este archivo.

## Estado actual

- Fecha de corte: 2026-03-31
- Total hallazgos: 14
- HIGH: 7
- MEDIUM: 5
- LOW: 2

## Top prioridades

1. DOC-002 (routing i18n)
2. DOC-005 (legal SSG vs SSR)
3. DOC-007 (checkout route mismatch)
4. DOC-008 (env var email mismatch)
5. DOC-010 (google recordings inexistente)
6. DOC-013 (source-of-truth SQL)
7. DOC-014 (duplicacion AGENTS/CLAUDE)

## Navegacion del paquete

- Resumen ejecutivo: `00-resumen-ejecutivo.md`
- Backlog completo: `01-backlog-doc-ids.md`
- Routing/i18n/render: `02-routing-i18n-render.md`
- Auth/RBAC: `03-auth-rbac.md`
- SQL/schema: `04-sql-source-of-truth.md`
- APIs/env/integraciones: `05-apis-integraciones-env.md`
- Testing/comandos: `06-testing-y-comandos.md`
- Coherencia entre docs: `07-coherencia-documental.md`

## Uso sugerido en siguientes conversaciones

1. Seleccionar 2-3 IDs HIGH.
2. Confirmar evidencia en codigo.
3. Registrar decision (actualizar doc, actualizar codigo, o aclarar contrato).
4. Cambiar estado en `01-backlog-doc-ids.md`.
