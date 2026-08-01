# Operaciones

## Tarea normal

1. Actualizar `main` y comprobar que coincide con `origin/main` y está limpio.
2. Crear una rama/worktree para un resultado y fijar hasta tres criterios de aceptación.
3. Implementar y ejecutar pruebas focales.
4. Revisar el diff y abrir una PR.
5. Dejar que `build-and-test` ejecute la verificación completa una vez.
6. Integrar y retirar la rama/worktree.

No se crean documentos de traspaso ni carpetas de evidencia. El estado observable vive en el issue/tarea, el diff, la PR, CI y el despliegue.

## Entorno Codex

El perfil versionado de `.codex/config.toml` solo se aplica a este repositorio confiable. Mantiene intacto el perfil global, cierra apps ajenas, limita Supabase al staging `mzjyvmlxfpzdfdjzxxyj` en modo de solo lectura y Sentry a la inspección del proyecto canónico, y deja disponibles GitHub, Cloudflare y Browser. Stripe permanece cerrado hasta una tarea dedicada de pagos de prueba. Los IDs y límites completos están en `docs/ENVIRONMENTS.md`.

Las skills permanecen instaladas porque se cargan de forma progresiva solo cuando una tarea las activa. No se crean agentes persistentes: el agente principal ejecuta el trabajo y usa como máximo tres subagentes para superficies realmente independientes.

Una tarea ya abierta puede conservar el catálogo anterior. La comprobación funcional consiste en abrir una tarea nueva en este repositorio, confirmar por lectura las identidades y modos permitidos sin mostrar secretos, y abrir otra tarea en un proyecto distinto para comprobar que su catálogo global no cambió. El rollback es `git revert` del commit del perfil y una tarea nueva.

## Staging

Staging solo se alinea con un SHA integrado de `main` que tenga CI verde:

1. Preflight de solo lectura de GitHub, Cloudflare y Supabase contra `docs/ENVIRONMENTS.md`.
2. Confirmar que no hay una rotación concurrente de credenciales ni trabajos en cola que hagan peligroso el cambio.
3. Despachar `Deploy Cloudflare staging` desde `main`; GitHub fija el SHA automáticamente, sin entrada manual.
4. El workflow exige primero el contrato completo del GitHub Environment, valida identidades y paquetes, captura las versiones activas, autentica su contrato inmutable de rollback y despliega fulfillment y web con el mismo SHA, allowlists separados e inventarios de bindings verificados antes de activarlos.
5. El smoke exige los dos IDs exactos activados, verifica por HMAC todos los fingerprints de configuración contra GitHub y mantiene probes inocuos de health, checkout cerrado y rechazo de rutas internas sin autorización. No crea alumnos, pagos, emails, documentos ni filas.

El workflow sube versiones y después asigna el 100 % del tráfico a la versión exacta identificada por SHA y ejecución. No ejecuta `wrangler triggers deploy` ni modifica rutas, dominios, cron o consumidores de colas. Cualquier cambio de esos recursos exige una tarea de infraestructura explícita con su propio preflight, autorización y recuperación.

El workflow materializa en cada versión el allowlist completo de secretos de cada Worker desde GitHub Environment mediante archivos temporales con permisos `0600`, y los elimina al terminar. `keep_vars=false` y `unsafe.metadata.keep_bindings=[]` impiden conservar bindings anteriores; antes de asignar tráfico, el workflow rechaza cualquier nombre, tipo, destino o valor no secreto inesperado. La atestación HMAC comprueba después que el runtime activado coincide con la expectativa sin mostrar valores.

Para validar localmente el contrato cargado sin hacer red:

```bash
pnpm run verify:staging-runtime -- --preflight
```

El smoke remoto completo requiere además `STAGING_EXPECTED_WEB_VERSION_ID` y `STAGING_EXPECTED_FULFILLMENT_VERSION_ID`; el workflow los toma de las versiones que acaba de activar. La ausencia de cualquier secret del contrato, incluido `CLOUDFLARE_API_TOKEN`, detiene la ejecución antes de escribir. No se despliega desde una sesión local como atajo.

El checkout directo exige `CHECKOUT_HOLD_FINGERPRINT_SECRET` únicamente en el Worker web. Debe ser un valor aleatorio de al menos 32 bytes, distinto de los demás secretos. Se usa solo como clave HMAC para derivar un identificador temporal: dirección exacta en IPv4 y prefijo de red `/64` en IPv6. La IP no se persiste y el identificador se elimina al cerrar el hold. No se rota mientras exista ningún hold con estado `held`; primero se cierra o reconcilia el inventario vivo para evitar que una misma conexión obtenga dos huellas simultáneas.

## Recuperación de staging

Antes de la primera escritura se capturan las versiones activas de ambos Workers y se autentica un contrato inmutable de rollback. Ante un fallo o cancelación desde el primer intento de mutación, se procesa primero web si su intento comenzó y después fulfillment; cada Worker se fuerza a su baseline incluso si ya parece activo, para restaurar también los secretos asociados a la versión.

La reversión solo continúa si la versión activa es el baseline capturado o pertenece a la ejecución actual; cualquier otra versión se trata como escritura concurrente y detiene la recuperación. Después exige una ventana acotada de estabilidad, los dos IDs baseline exactos y el smoke autenticado con el schema capturado. Un baseline legado schema 5 o 6 se reconstruye con su contrato histórico y no relaja el smoke normal, que exige el schema actual 7.

Los dos Workers de staging tienen una única vía soportada de escritura: este workflow. Una escritura por Dashboard, Wrangler local u otro workflow rompe la garantía de ownership y obliga a reconciliar manualmente antes de continuar.

El rollback es de mejor esfuerzo: una cancelación forzada, caída del runner, revocación del token o indisponibilidad de Cloudflare puede impedirlo. Los IDs baseline quedan en el resumen de la ejecución para una recuperación explícita.

Un rollback de Workers no revierte base de datos, pagos, emails ni documentos. Por eso el smoke estándar es inocuo y una tarea con efectos reales debe definir antes su recuperación específica.

## Base de datos

Toda evolución de esquema es una migración nueva en `supabase/migrations/`. No se reescribe una migración aplicada ni se mantiene SQL suelto como versión alternativa. `db/schema.sql` se actualiza como vista consolidada.

Antes de una migración destructiva o producción se decide explícitamente backup, rollback y recurso exacto. Un despliegue de código sin cambios de esquema no ejecuta `db push`, repair ni migraciones por inercia.

## Remuneración docente

Antes de publicar una plaza se comprueba que su profesor tiene un vínculo y unos términos efectivos para la fecha del ciclo. No se publica una plaza sin términos, no se infiere fundador o externo por nombre y no se crea una obligación de importe cero como sustituto de una configuración ausente.

Antes de habilitar checkout tras instalar el ledger en una base que ya contenga ciclos Checkout V2, se consulta por una vía server-only `teacher_compensation_milestones.ten_active_history_state`. El estado `requires_confirmation` es un gate obligatorio: se mantiene checkout detenido y un administrador contrasta el histórico real, sin inferirlo de los alumnos que continúan activos. La confirmación se registra una sola vez mediante `confirm_teacher_compensation_ten_active_history`, con un `request_id` único, motivo y uno de estos resultados:

- `not_reached`, sin ciclo ni recuento, solo cuando nunca se alcanzaron diez alumnos simultáneamente.
- `reached`, con el ciclo inicial listo que causó el hito y el recuento observado, que debe ser al menos diez.

Después se verifica que el estado sea `tracking`. Cada ciclo listo anterior a la migración se prepara explícitamente y en orden cronológico mediante `reconcile_teacher_compensation_cycle`; esto crea únicamente su snapshot económico. Solo las sesiones históricas realmente liquidables se materializan después mediante `reconcile_teacher_compensation_session`. No se habilita tráfico si permanece `requires_confirmation`, hay ciclos listos sin snapshot o falta el vínculo de alguno de sus profesores.

La operación normal es:

1. Registrar los términos antes de activar la plaza.
2. Congelar en cada ciclo la tarifa aplicable según el tipo de profesor y los hitos duraderos. El ciclo que alcanza diez alumnos activos conserva 20 EUR para externos y los ciclos posteriores aplican 25 EUR; el hito no se revierte si después baja el número de alumnos.
3. Materializar de forma idempotente una obligación por clase completada, cancelación tardía del alumno o no-show liquidable.
4. Registrar por separado cada intervalo real de formación o reunión obligatoria. Debe pertenecer por completo a un único vínculo efectivo y expresarse en minutos enteros; si cruza un cambio de vínculo se divide en dos entradas.
5. Ejecutar una reconciliación explícita antes de preparar cualquier resumen operativo y después de recuperar una incidencia. La reconciliación busca sesiones liquidables sin entrada, duplicados, ciclos sin snapshot y términos ausentes; crea solo lo que falta de forma idempotente y no recalcula entradas históricas ya congeladas.

Las entradas de remuneración no se editan ni se borran. La formación y las reuniones obligatorias se registran a 25 céntimos por minuto real mediante una petición idempotente. Si hay que corregir sus minutos, se añade una compensación enlazada y el saldo acumulado nunca puede quedar por debajo de cero. No se reconstruye trabajo histórico desde Calendar ni se incluyen preparación ordinaria, marketing, mantenimiento o administración fundadora. Resolver una incidencia de garantía no crea una compensación: la cancelación tardía o el no-show continúan siendo liquidables al profesor aunque cambie el crédito o la elegibilidad del alumno.

El total pendiente es un registro interno de obligaciones, no una orden de pago. Esta operativa no transfiere dinero, no marca obligaciones como pagadas y no sustituye facturas, retenciones ni decisiones fiscales. Cualquier liquidación futura se añadirá como un flujo separado que referencie el ledger sin reescribirlo.

## Recuperación de la garantía Checkout V2

La referencia operativa es una única fila de `checkout_v2_guarantee_operations`. Repetir una petición o una acción administrativa reanuda esa operación; nunca se cambia su importe, PaymentIntent, suscripción de Stripe ni identificadores congelados, y nunca se crea una devolución manual paralela.

- `processing`: comprobar la operación existente y reanudarla; el lease evita dos escritores simultáneos.
- `refund_pending`: esperar o reconciliar el mismo refund mediante webhook/lectura de Stripe. No se crea otro refund.
- `retryable`: reintentar la misma operación desde administración después de comprobar la identidad y el modo de Stripe.
- `manual_review`: trabajar desde el ticket enlazado y comparar el snapshot local con Stripe. Si existe un refund ID, administración solo puede reconciliar ese refund mediante lecturas y `observe`; un refund `failed` o `canceled` exige una decisión financiera manual y nunca dispara un segundo refund. Si todavía no existe refund, la misma operación solo puede volver a `retryable` después de cerrar el ticket y registrar un motivo auditado; entonces se reanuda sin cambiar el snapshot.
- `refunded`: estado terminal. Verificar 19.425 céntimos en EUR, suscripción cancelada, una sesión consumida, tres invalidadas y jobs deduplicados; no repetir efectos financieros.

Una cancelación tardía o no-show de la segunda sesión solo se puede excusar desde administración, con un motivo obligatorio, mediante el ledger inmutable de incidencias. La acción no cambia el estado histórico de la sesión ni la reprograma. Toda corrección distinta pasa por soporte y una decisión explícita.

Los fallos posteriores de Calendar, email o CRM se recuperan en `fulfillment_jobs`; no justifican revertir ni repetir la devolución. Antes de probar este flujo en staging se hace el preflight exacto de Supabase y Stripe Sandbox y se usan exclusivamente datos de prueba.

## Producción

La única realidad operativa de producción es Cloudflare Pages, según `docs/ENVIRONMENTS.md`. Este repositorio no ofrece aliases, builds, validadores ni entornos Wrangler para Workers o colas de producción.

Los Workers y colas de producción que ya existen están reservados fuera de alcance: no se despliegan, validan, reutilizan ni eliminan por continuidad implícita. Un cambio futuro de arquitectura exigiría una decisión nueva de producto e infraestructura y una tarea explícita que reconstruya las garantías necesarias.

Cualquier cambio de Pages, Supabase, Stripe live, DNS, email live o datos reales exige autorización explícita, preflight de identidad, alcance, verificación y recuperación. Una aprobación de staging no se extiende a producción.
