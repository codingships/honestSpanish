# Backlog Unico de Hallazgos (`DOC-xxx`)

Estado por defecto: `OPEN`

| ID | Severidad | Dominio | Resumen |
|---|---|---|---|
| DOC-001 | MEDIUM | routing/i18n | README referencia `src/i18n/ui.ts`, codigo usa `translations.ts`. |
| DOC-002 | HIGH | routing/i18n | Docs afirman `es` sin prefijo; app redirige `/` a `/es/`. |
| DOC-003 | MEDIUM | auth/routing | Guardias documentados como `/campus/*`; implementacion opera en `/{lang}/campus/*`. |
| DOC-004 | MEDIUM | auth/rbac | Middleware documentado como unica puerta; tambien hay guardias en paginas y APIs. |
| DOC-005 | HIGH | render/legal | Docs legales dicen SSG; archivos legales actuales usan SSR (`prerender=false`). |
| DOC-006 | MEDIUM | render/legal | Se documenta `terminos.astro`; archivo no existe. |
| DOC-007 | HIGH | checkout/routing | Documentado `/[lang]/checkout/*`; implementado en `/api/create-checkout`. |
| DOC-008 | HIGH | env/email | `FROM_EMAIL` en docs vs `EMAIL_FROM` en codigo y ausente en `.env.example`. |
| DOC-009 | MEDIUM | google/apis | Docs ubican creacion de carpetas en `drive.ts`; hoy vive en `student-folder.ts` + endpoint `google/`. |
| DOC-010 | HIGH | google/integracion | Se documenta `src/lib/google/recordings.ts`; modulo inexistente. |
| DOC-011 | MEDIUM | testing | Conteos de tests en AGENTS/CLAUDE desactualizados. |
| DOC-012 | LOW | testing | Umbrales de cobertura en docs (`14/13/15/14`) no coinciden con config (`14/13/14/14`). |
| DOC-013 | HIGH | sql/schema | No hay fuente SQL canonica explicita; coexisten varios artefactos de esquema. |
| DOC-014 | HIGH | governance/docs | AGENTS y CLAUDE duplican contenido y se desincronizan. |
