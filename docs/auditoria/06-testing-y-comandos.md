# Anexo: Testing, cobertura y comandos

## Hallazgos

| ID | Fuente documental | Afirmacion | Evidencia | Veredicto | Severidad | Accion propuesta | Confianza |
|---|---|---|---|---|---|---|---|
| DOC-011 | `AGENTS.md:17`, `CLAUDE.md:17` | `~87 tests` en unit+api | Conteo actual por parser local: `api:44`, `unit:55`, `total:99` | divergencia | MEDIUM | Evitar numero fijo o actualizar periodicamente con script | media |
| DOC-011A | `AGENTS.md:23-26`, `CLAUDE.md:23-26` | E2E por proyecto: `5/12/8/7` | Conteo actual por `test()` en specs: `public:10`, `student:13`, `teacher:9`, `admin:8` | divergencia | MEDIUM | Sustituir por "aprox" o comando de conteo reproducible | media |
| DOC-012 | `AGENTS.md:110`, `CLAUDE.md:110` | Umbrales `14/13/15/14` | `vitest.config.ts:58-61` define `14/13/14/14` | divergencia | LOW | Corregir valor de `functions` en docs | alta |
| DOC-017 | `README.md:85`, `AGENTS.md:18` | Comando sugerido de unit test no uniforme (`test` vs `test:run`) | `package.json` soporta ambos (`test` y `test:run`) | ambiguo | LOW | Estandarizar recomendacion principal en todos los docs | alta |

## Metodo de conteo usado en esta sesion

- Unit/API: contar ocurrencias de `it(` y `test(` en `tests/api` + `tests/unit`.
- E2E: contar `test(` en `tests/e2e/*.spec.ts` agrupado por sufijo `.public/.student/.teacher/.admin`.

Nota:
- El conteo por parser no sustituye un reporte oficial del runner, pero detecta drift documental con buena señal.
