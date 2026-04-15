# Anexo: Routing, i18n y Render

## Hallazgos

| ID | Fuente documental | Afirmacion | Evidencia en codigo | Veredicto | Severidad | Accion propuesta | Confianza |
|---|---|---|---|---|---|---|---|
| DOC-001 | `README.md:16` | i18n usa `src/i18n/ui.ts` | `src/i18n/utils.ts:1` importa `./translations`; `src/i18n/translations.ts` existe; `src/i18n/ui.ts` no existe | divergencia | MEDIUM | Actualizar README a `src/i18n/translations.ts` | alta |
| DOC-002 | `AGENTS.md:47`, `CLAUDE.md:47` | `es` no lleva prefijo y sirve contenido en `/`, `/campus/` | `src/pages/index.astro:6` redirige `"/"` a `"/es/"`; `src/middleware.ts:17` valida primer segmento `es/en/ru` | divergencia | HIGH | Documentar comportamiento real o alinear implementacion con lo documentado | alta |
| DOC-003 | `AGENTS.md:53`, `CLAUDE.md:53` | Guardias en `/campus/teacher` y `/campus/admin` | `src/middleware.ts:49`, `:58`, `:65` aplican sobre rutas localizadas (`/{lang}/campus/...`) | divergencia | MEDIUM | Corregir paths en docs a `/{lang}/campus/teacher` y `/{lang}/campus/admin` | alta |
| DOC-005 | `ARCHITECTURE.md:117-118` | Legales en SSG multilenguaje | `src/pages/[lang]/legal/aviso-legal.astro:2`, `cookies.astro:2`, `privacidad.astro:2` usan `prerender = false` | divergencia | HIGH | Corregir docs o cambiar render de esas rutas | alta |
| DOC-006 | `ARCHITECTURE.md:122` | Existe `terminos.astro` | `Test-Path src/pages/[lang]/legal/terminos.astro => False` | divergencia | MEDIUM | Quitar referencia o crear ruta faltante | alta |
| DOC-007 | `ARCHITECTURE.md:23` | Existe `/[lang]/checkout/*` SSR | `Test-Path src/pages/[lang]/checkout => False`; endpoint real: `src/pages/api/create-checkout.ts:94` | divergencia | HIGH | Actualizar documentacion del flujo de checkout | alta |

## Notas de implementacion documental

- Este dominio concentra las divergencias mas visibles para QA, SEO y onboarding tecnico.
- Cerrar primero `DOC-002`, `DOC-005`, `DOC-007`.
