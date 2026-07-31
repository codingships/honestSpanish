# Contrato de trabajo

Este repositorio contiene la única metodología propia del proyecto. No se reconstruye el trabajo desde conversaciones, ramas abandonadas, carpetas de agentes ni documentos históricos.

## Autoridad

En caso de contradicción, manda este orden:

1. La tarea actual y sus criterios de aceptación describen el resultado buscado.
2. `origin/main` contiene el producto integrado; una rama solo contiene una propuesta.
3. El código, las migraciones y la configuración ejecutable describen el comportamiento real.
4. `docs/PRODUCT.md`, `docs/ENVIRONMENTS.md`, `docs/OPERATIONS.md` y `ARCHITECTURE.md` contienen decisiones duraderas.
5. Las pruebas protegen comportamiento, pero no crean decisiones de producto.

Staging sirve para verificar un SHA; no es una fuente alternativa. El historial de Git sirve para recuperar, no para dirigir tareas nuevas.

## Ciclo normal

1. Partir de un `origin/main` limpio y verificado.
2. Usar una rama y un worktree aislados para un único resultado observable.
3. Escribir de uno a tres criterios de aceptación antes de implementar.
4. Inspeccionar solo el código y los recursos relevantes.
5. Resolver autónomamente las decisiones técnicas dentro del alcance.
6. Ejecutar pruebas focales durante el trabajo. Ejecutar la CI completa una vez en la PR.
7. Revisar el diff, integrar en `main` y retirar rama/worktree cuando termine.
8. Si cambia el runtime, desplegar ese SHA exacto en staging y ejecutar un único smoke inocuo.

GitHub conserva commits, PR, revisión y CI. No se crean handoffs, evidence packs, gates documentales, informes de estado ni scripts que vuelvan a probar documentos.

## Contexto y agentes

`AGENTS.md` se aplica automáticamente. No se releen todos los documentos al empezar cada tarea:

- Oferta, precio o copy: `docs/PRODUCT.md`.
- Proveedor, credenciales o despliegue: `docs/ENVIRONMENTS.md` y `docs/OPERATIONS.md`.
- Cambio estructural: `ARCHITECTURE.md`.
- Datos: migraciones, `db/schema.sql` y el código afectado.
- CRM o privacidad: únicamente los documentos de `docs/crm/` pertinentes.

El agente principal resuelve directamente una tarea acotada. Se usan subagentes solo cuando hay dos o más investigaciones o implementaciones independientes que pueden verificarse por separado; nunca para que varios agentes modifiquen la misma superficie. El límite del proyecto es tres subagentes concurrentes. Un subagente entrega hallazgos o un diff delimitado y termina; no crea metodología, handoffs ni documentación de estado.

Las skills se cargan únicamente cuando la tarea las activa. Tener una skill instalada no obliga a usarla. Los plugins y conectores habilitados para este repositorio se fijan en `.codex/config.toml`; el perfil global del usuario no se modifica.

## Cuándo detenerse

Detenerse y pedir decisión del propietario si aparece cualquiera de estos casos:

- Cambia la oferta, precio, promesa pública, proveedor, política de datos o comportamiento de negocio.
- Hay dos recursos externos plausibles y no se puede identificar el correcto de forma inequívoca.
- Se requiere producción, pagos reales, DNS, borrado externo, migración destructiva o un efecto difícil de revertir.
- Falta una credencial o una decisión que no puede inferirse del repositorio.
- Los criterios de aceptación convergen en resultados de producto incompatibles.

No pedir permiso para decisiones técnicas reversibles, edición de código, pruebas, commits, ramas, PR o respaldo normal en GitHub dentro del alcance acordado.

## Recursos externos

Antes de cualquier escritura externa, hacer un preflight de solo lectura y declarar cuenta, proyecto y recurso exactos. Usar únicamente los identificadores de `docs/ENVIRONMENTS.md`. Si un identificador no coincide, detenerse.

- Staging se despliega solo mediante `.github/workflows/deploy-staging.yml` despachado desde `main`; el workflow fija el SHA del evento y exige CI verde para ese mismo commit.
- Producción siempre exige autorización explícita en la tarea actual.
- No guardar secretos en Git, documentos, capturas, logs ni resultados de pruebas.
- Las migraciones viven en `supabase/migrations/`; `db/schema.sql` es el esquema consolidado, no un segundo historial.

## Herramientas y verificación

Usar exclusivamente `pnpm` para Node.js. No sustituir el stack ni añadir Docker salvo que una necesidad técnica concreta lo justifique.

Elegir la verificación proporcional al cambio:

- Documentación: enlaces, referencias y diff; no ejecutar la suite completa salvo que cambie un contrato ejecutable.
- Código: typecheck/lint y la prueba focal relevante.
- Cambio transversal: pruebas unitarias afectadas y build.
- Runtime o despliegue: CI completa una vez, despliegue del mismo SHA y `pnpm run verify:staging-runtime`.
- Cobertura y suites de navegadores adicionales son diagnósticos explícitos, no pasos predeterminados.

La tarea termina cuando los criterios son observables, el diff está revisado y la verificación proporcional pasa. No termina por cantidad de documentación ni por repetir pruebas.
