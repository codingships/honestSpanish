# Operaciones

## Tarea normal

1. Actualizar `main` y comprobar que coincide con `origin/main` y está limpio.
2. Crear una rama/worktree para un resultado y fijar hasta tres criterios de aceptación.
3. Implementar y ejecutar pruebas focales.
4. Revisar el diff y abrir una PR.
5. Dejar que `build-and-test` ejecute la verificación completa una vez.
6. Integrar y retirar la rama/worktree.

No se crean documentos de traspaso ni carpetas de evidencia. El estado observable vive en el issue/tarea, el diff, la PR, CI y el despliegue.

## Staging

Staging solo se alinea con un SHA integrado de `main` que tenga CI verde:

1. Preflight de solo lectura de GitHub, Cloudflare y Supabase contra `docs/ENVIRONMENTS.md`.
2. Confirmar que no hay una rotación concurrente de credenciales ni trabajos en cola que hagan peligroso el cambio.
3. Despachar `Deploy Cloudflare staging` desde `main`; GitHub fija el SHA automáticamente, sin entrada manual.
4. El workflow exige primero el contrato completo del GitHub Environment, valida identidades y paquetes, captura las versiones activas y despliega fulfillment y web con el mismo SHA.
5. El smoke exige los dos IDs exactos activados, verifica por HMAC todos los fingerprints de configuración contra GitHub y mantiene probes inocuos de health, checkout cerrado y rechazo de rutas internas sin autorización. No crea alumnos, pagos, emails, documentos ni filas.

El workflow sube versiones y después asigna el 100 % del tráfico a la versión exacta identificada por SHA y ejecución. No ejecuta `wrangler triggers deploy` ni modifica rutas, dominios, cron o consumidores de colas. Cualquier cambio de esos recursos exige una tarea de infraestructura explícita con su propio preflight, autorización y recuperación.

`--keep-vars` conserva en Cloudflare la copia runtime ya provisionada; el workflow no usa el despliegue de código como gestor de secretos. GitHub Environment conserva la expectativa y la atestación HMAC demuestra que la copia runtime coincide, incluidos valores que nunca se muestran.

Para validar localmente el contrato cargado sin hacer red:

```bash
pnpm run verify:staging-runtime -- --preflight
```

El smoke remoto completo requiere además `STAGING_EXPECTED_WEB_VERSION_ID` y `STAGING_EXPECTED_FULFILLMENT_VERSION_ID`; el workflow los toma de las versiones que acaba de activar. La ausencia de cualquier secret del contrato, incluido `CLOUDFLARE_API_TOKEN`, detiene la ejecución antes de escribir. No se despliega desde una sesión local como atajo.

## Recuperación de staging

Antes de la primera escritura se capturan las versiones activas de ambos Workers. Si web falla después de desplegar fulfillment, se revierte fulfillment. Si falla el smoke después de desplegar ambos, se revierte primero web y después fulfillment.

La reversión solo actúa si la versión activa pertenece a la ejecución actual; si detecta una escritura concurrente se detiene. Después se repite el smoke.

Los dos Workers de staging tienen una única vía soportada de escritura: este workflow. Una escritura por Dashboard, Wrangler local u otro workflow rompe la garantía de ownership y obliga a reconciliar manualmente antes de continuar.

El rollback es de mejor esfuerzo: una cancelación forzada, caída del runner, revocación del token o indisponibilidad de Cloudflare puede impedirlo. Los IDs baseline quedan en el resumen de la ejecución para una recuperación explícita.

Un rollback de Workers no revierte base de datos, pagos, emails ni documentos. Por eso el smoke estándar es inocuo y una tarea con efectos reales debe definir antes su recuperación específica.

## Base de datos

Toda evolución de esquema es una migración nueva en `supabase/migrations/`. No se reescribe una migración aplicada ni se mantiene SQL suelto como versión alternativa. `db/schema.sql` se actualiza como vista consolidada.

Antes de una migración destructiva o producción se decide explícitamente backup, rollback y recurso exacto. Un despliegue de código sin cambios de esquema no ejecuta `db push`, repair ni migraciones por inercia.

## Producción

La única realidad operativa de producción es Cloudflare Pages, según `docs/ENVIRONMENTS.md`. Este repositorio no ofrece aliases, builds, validadores ni entornos Wrangler para Workers o colas de producción.

Los Workers y colas de producción que ya existen están reservados fuera de alcance: no se despliegan, validan, reutilizan ni eliminan por continuidad implícita. Un cambio futuro de arquitectura exigiría una decisión nueva de producto e infraestructura y una tarea explícita que reconstruya las garantías necesarias.

Cualquier cambio de Pages, Supabase, Stripe live, DNS, email live o datos reales exige autorización explícita, preflight de identidad, alcance, verificación y recuperación. Una aprobación de staging no se extiende a producción.
