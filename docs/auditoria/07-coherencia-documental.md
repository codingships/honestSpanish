# Anexo: Coherencia entre documentos

## Hallazgos de coherencia cruzada

| ID | Documento A | Documento B | Divergencia | Severidad | Accion propuesta |
|---|---|---|---|---|---|
| DOC-014 | `AGENTS.md` | `CLAUDE.md` | Contenido casi duplicado; deriva con facilidad en detalles operativos | HIGH | Mantener una base unica y generar wrappers especificos por herramienta |
| DOC-018 | `README.md:16` | `AGENTS.md:47` / `CLAUDE.md:47` | Ruta de i18n no coincide (`ui.ts` vs `translations.ts`) | MEDIUM | Consolidar seccion i18n en una fuente primaria |
| DOC-019 | `README.md:54` | `.env.example` + `AGENTS.md:125` | Variables de email inconsistentes/missing (`FROM_EMAIL`, `EMAIL_FROM`) | HIGH | Publicar tabla canonica de env vars en un solo documento fuente |
| DOC-020 | `README.md:30` | `audit_handover.md:32` | Referencias SQL principales diferentes (`db/schema.sql` vs `esquema_nube.sql`) | HIGH | Definir fuente SQL canonica y rol de cada artefacto |
| DOC-021 | `README.md:113` ("Biblia tecnica") | `AGENTS.md`/`CLAUDE.md` con arquitectura paralela | Multiples "fuentes maestras" sobre arquitectura | HIGH | Definir "source of truth by topic" y enlazar en vez de duplicar texto |

## Regla de gobierno recomendada

1. Un documento canonico por dominio (routing, auth, sql, env, testing).
2. Documentos secundarios solo resumen y enlazan al canonico.
3. Prohibir numeros de tests hardcodeados en docs.
4. Cualquier ruta o variable de entorno debe estar respaldada por referencia de codigo.
