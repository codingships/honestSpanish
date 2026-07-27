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
3. Despachar `Deploy Cloudflare staging` desde `main` con el SHA completo.
4. El workflow valida identidades y paquetes, captura las versiones activas, despliega fulfillment y web con el mismo SHA y ejecuta un smoke inocuo.
5. El smoke comprueba health, identidad/entorno, checkout cerrado y rechazo de rutas internas sin autorización. No crea alumnos, pagos, emails, documentos ni filas.

Para ejecutar solo el smoke contra el staging ya desplegado:

```bash
pnpm run verify:staging-runtime
```

El workflow necesita `CLOUDFLARE_API_TOKEN` en el entorno GitHub `staging`. Si falta, se detiene; no se despliega desde una sesión local como atajo.

## Recuperación de staging

Antes de la primera escritura se capturan las versiones activas de ambos Workers. Si web falla después de desplegar fulfillment, se revierte fulfillment. Si falla el smoke después de desplegar ambos, se revierte primero web y después fulfillment.

La reversión solo actúa si la versión activa pertenece a la ejecución actual; si detecta una escritura concurrente se detiene. Después se repite el smoke.

Un rollback de Workers no revierte base de datos, pagos, emails ni documentos. Por eso el smoke estándar es inocuo y una tarea con efectos reales debe definir antes su recuperación específica.

## Base de datos

Toda evolución de esquema es una migración nueva en `supabase/migrations/`. No se reescribe una migración aplicada ni se mantiene SQL suelto como versión alternativa. `db/schema.sql` se actualiza como vista consolidada.

Antes de una migración destructiva o producción se decide explícitamente backup, rollback y recurso exacto. Un despliegue de código sin cambios de esquema no ejecuta `db push`, repair ni migraciones por inercia.

## Producción

Producción no se despliega automáticamente. Cualquier cambio de Workers, Supabase, Stripe live, DNS, email live o datos reales exige una tarea con autorización explícita, preflight de identidad, alcance, verificación y recuperación. Una aprobación de staging no se extiende a producción.
