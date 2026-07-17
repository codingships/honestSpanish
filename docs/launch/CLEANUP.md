# Cleanup Decisions

Estado: propuesta operativa para launch; requiere confirmacion de Alin antes de borrar o mover herramientas de agente versionadas.

## Ya eliminado o ignorado

- `tmp/`: los scripts historicos obsoletos fueron eliminados; la carpeta puede existir como artefacto local ignorado para logs/temp.
- `outputs/demo-runs/`: eliminado; las salidas generadas quedan bajo `outputs/`, ignorado.
- `db/audit_fixes.sql`: eliminado; el contenido vigente esta absorbido por `db/schema.sql` y migraciones 006/007.
- `docs/launch/CURRENT_STATUS.md`: eliminado para evitar estado paralelo.
- Documentos historicos de auditoria/status: eliminados o marcados como no fuente de verdad; el estado actual vive en `docs/launch/CHECKLIST.md`.
- `supabase/.temp/cli-latest`: eliminado del working tree; como estaba trackeado, sigue apareciendo como `D` hasta que se haga el commit de limpieza. `supabase/.temp/` ya esta ignorado y no debe volver a viajar en commits.
- `.agents/skills/playwright-skill/.temp-execution-1781276714818.js`: eliminado como artefacto temporal de ejecucion.
- Scripts root de fulfillment actualizados para invocar `corepack pnpm --filter ...`, evitando que `pnpm fulfillment:typecheck` use una version global incompatible.
- Runners internos de launch/demo actualizados para invocar subcomandos con `corepack pnpm`, evitando que `launch:gate`, `launch:verify`, los smokes visual/accesibilidad o `dev:demo` dependan de una version global incompatible.
- `pnpm-lock.yaml` y `node_modules` sincronizados con `corepack pnpm install --lockfile-only --ignore-scripts` y `corepack pnpm install --ignore-scripts`; los comandos normales vuelven a ejecutarse sin `--config.verify-deps-before-run=false`.
- `corepack pnpm --config.verify-deps-before-run=false launch:cleanup` pasa con 0 fallos y 0 warnings. Evidencia local reciente: `outputs/launch-cleanup/2026-06-26T20-38-37-256Z/summary.md`.
- `corepack pnpm launch:worktree` genera inventario fresco del arbol Git y agrupa cambios en paquetes de revision/commit sin hacer staging ni borrar nada.
- `corepack pnpm --config.verify-deps-before-run=false secrets:check` pasa sin secretos obvios en archivos trackeados/no ignorados.
- `tmp/check-roles.ts`, `tmp/fix-roles.ts` y `tmp/update-email.ts` tambien siguen como `D` hasta commit porque estaban trackeados historicamente; `tmp/` ya esta ignorado para que no vuelvan a entrar artefactos temporales.
- `.codex-ops/` queda ignorado en Git: es estado local de planificacion/evidencia del agente, no runtime ni documentacion estable. El estado estable vive en `docs/launch/*`.
- `docs/launch/GIT_WORKTREE_PLAN.md` agrupa el arbol actual en paquetes recomendados de revision/commit para no mezclar producto, launch docs, dependencias y herramientas de agente.
- Evidencia fresca de runners `corepack pnpm`: `outputs/launch-verification/2026-06-26T08-37-11-289Z/summary.md` confirma `launch:public-visual`, `launch:accessibility`, `launch:payments`, `launch:operations`, `launch:security`, `typecheck`, `lint`, `test:run` y `build` sin fallos; solo bloquea `launch:legal` por datos legales reales pendientes.

## Artefactos de build local

- `dist/` es artefacto generado e ignorado. No es fuente de verdad y no debe viajar en commits.
- Astro/Cloudflare pueden leer `.dev.vars` o `.env*` durante un build local. Si `dist/` se genero con esos ficheros visibles, tratarlo como paquete local sensible: revisar lo minimo, registrar solo rutas/hashes y delete `dist/` al terminar.
- Para usar un build local como paquete de Cloudflare Pages staging, reconstruir en sanitized env, ejecutar `corepack pnpm launch:staging-no-real-payments-remediation`, exigir `readyForStagingDeployPackage=true`, ejecutar `corepack pnpm secrets:check` y delete `dist/` despues de desplegar/verificar.
- `pnpm launch:cleanup` avisa si ve `dist/` junto a `.dev.vars` o `.env*`. Ese warning no implica que se haya filtrado un secreto; obliga a regenerar o borrar el artefacto antes de usarlo como evidencia o paquete.

## Mantener

- `scripts/demo/*`: mantener como herramienta dev/demo aislada. No entra en runtime normal y `pnpm dev:demo` activa flags explicitamente.
- `scripts/launch/*`: mantener. Son la puerta automatica de evidencia para launch.
- `.env.test.example`: mantener. Documenta flags test/demo por defecto en `false` y usuarios de prueba sin secretos reales.
- `outputs/`: mantener ignorado. Guarda evidencias locales generadas por `launch:verify` y `launch:secondary-review`.

## Decision pendiente

- `.agent/` y `.agents/`: no son runtime del producto ni deben afectar Cloudflare Pages/Worker, pero estan versionados y contienen 339 archivos, 1.46 MB.
- Propuesta conservadora: mantenerlos hasta cerrar launch si Alin quiere que las skills viajen con el repo; si son herramientas personales, mover las skills utiles al entorno global de Codex y borrar del repo en un commit separado.
- Candidato obvio dentro de esa decision: `.agents/skills/cloudflare/references/r2-sql/SKILL.md.backup`; es un archivo de backup versionado y deberia eliminarse si se decide limpiar herramientas de agente.
- Cada corrida de `pnpm launch:cleanup` genera `outputs/launch-cleanup/<timestamp>/agent-tooling-inventory.md` con conteo, tamano, skills/workflows y opciones de decision. Tambien genera `agent-tooling-decision-worksheet.md` con snippets seguros para registrar `keep`, `move` o `delete after backup` en la evidencia manual local. La revision secundaria exige ese inventario como evidencia no destructiva antes de declarar READY.

## Coste-beneficio de `.agent/` y `.agents/`

| Opcion | Beneficio | Coste/riesgo | Cuando elegirla |
| --- | --- | --- | --- |
| Mantener en repo | Reproducibilidad para agentes, skills del proyecto cerca del codigo, menos trabajo antes del launch. | Mas ruido en diffs, herramientas personales mezcladas con producto, backup versionado pendiente. | Si esas skills son parte real del modo de trabajar del proyecto y quieres que viajen con el repo. |
| Mover fuera del repo | Repo mas limpio, herramientas personales reutilizables en otros proyectos, menor superficie de mantenimiento. | Hay que copiar primero lo util a ubicacion global y verificar que Codex sigue encontrandolo. | Si son herramientas tuyas/agenticas, no artefactos del producto. |
| Borrar | Menos archivos y menos ruido inmediatamente. | Riesgo de perder workflows o referencias utiles si no se ha hecho copia. | Solo si confirmas que no se usan o que ya estan respaldados. |

Recomendacion actual: mantenerlos durante el cierre de launch y tomar la decision en un commit separado. Si se limpian, mover primero las skills utiles y borrar como minimo `.agents/skills/cloudflare/references/r2-sql/SKILL.md.backup`.

Para staging/commits, seguir `docs/launch/GIT_WORKTREE_PLAN.md`.

## Regla

No borrar herramientas de agente versionadas sin confirmacion humana o sin haberlas copiado primero a un lugar global recuperable.
