# Anexo: AuthN/AuthZ y RBAC

## Hallazgos

| ID | Fuente documental | Afirmacion | Evidencia en codigo | Veredicto | Severidad | Accion propuesta | Confianza |
|---|---|---|---|---|---|---|---|
| DOC-004 | `AGENTS.md:50`, `CLAUDE.md:50` | `src/middleware.ts` es la unica puerta para rutas protegidas | Middleware existe (`src/middleware.ts:17`), pero hay guardias adicionales en paginas y APIs: `src/pages/[lang]/campus/admin/index.astro:13`, `src/pages/api/admin/users.ts:12` | divergencia | MEDIUM | Cambiar texto a "puerta primaria para campus localizado; APIs/paginas tambien aplican controles" | alta |
| DOC-003 | `AGENTS.md:53`, `CLAUDE.md:53` | Paths de guardias sin prefijo de idioma | `src/middleware.ts:49` valida `campus` despues de extraer `lang` | divergencia | MEDIUM | Documentar paths reales con `/{lang}` | alta |

## Confirmaciones (alineado)

- `supabase.auth.getUser()` en middleware: `src/middleware.ts:8`.
- Lectura de `role` desde `profiles`: `src/middleware.ts:25`.
- Redireccion por rol en campus admin/teacher existe en paginas SSR y middleware.

## Riesgo operativo

- El riesgo no es tanto de implementacion RBAC, sino de guias desactualizadas que pueden inducir pruebas o runbooks incorrectos.
