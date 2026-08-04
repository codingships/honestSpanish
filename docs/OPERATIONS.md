# Operaciones

## Tarea normal

1. Actualizar `main` y comprobar que coincide con `origin/main` y está limpio.
2. Crear una rama/worktree para un resultado y fijar hasta tres criterios de aceptación.
3. Implementar y ejecutar pruebas focales.
4. Revisar el diff y abrir una PR.
5. Dejar que `quality-gate` exija una vez las superficies seleccionadas por el diff.
6. Integrar y retirar la rama/worktree.

No se crean documentos de traspaso ni carpetas de evidencia. El estado observable vive en el issue/tarea, el diff, la PR, CI y el despliegue. `docs/READINESS.md` solo los indexa cuando una capacidad cambia de estado.

## CI proporcional

`classify-changes` calcula las superficies afectadas a partir del diff del evento. La clasificación es cerrada y conservadora:

- `repository-safety` siempre busca secretos en archivos versionados o no ignorados.
- `database-contract` se ejecuta para migraciones, esquema consolidado o pruebas SQL.
- `build-and-test` se ejecuta para código, configuración o tooling y agrupa tipos, lint, unitarias, Worker y build.
- `public-browser` se ejecuta para superficies que pueden cambiar el runtime público y corre en paralelo con `build-and-test`.
- `quality-gate` se ejecuta siempre, falla si la clasificación no es válida o cualquier superficie seleccionada no termina correctamente, y es el único check requerido por `main` y staging.

Un dispatch manual, un diff vacío o un cambio en workflows/clasificador fuerza todas las superficies. Las pruebas focales siguen haciéndose durante la implementación; no se repite la CI completa localmente ni varias veces por rutina.

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

El total pendiente es un registro interno de obligaciones, no una orden de pago. El flujo de liquidación mensual referencia el ledger sin reescribirlo:

1. Antes de cerrar un mes, reconciliar ciclos, sesiones liquidables y trabajo obligatorio. Los meses se cierran cronológicamente por profesor y según `Europe/Madrid`.
2. El cierre crea una instantánea inmutable de cada fuente y sus totales. No admite un mes abierto, fuentes anteriores sin liquidar ni obligaciones cuyo resultado todavía no se haya reconciliado.
3. El profesor o administración puede descargar el CSV del periodo. La factura y la transferencia se realizan fuera de la plataforma.
4. Después de la transferencia, administración registra fecha real, referencia, factura opcional y nota. Esto documenta el pago completo; no mueve dinero ni admite pagos parciales.
5. Una marca de pago equivocada se anula mediante otro evento inmutable y auditado; nunca se edita ni borra. La liquidación vuelve a pendiente y puede registrarse de nuevo con la evidencia correcta.

Un ajuste de trabajo pertenece al mes del trabajo original y se rechaza después de cerrar ese mes. Una corrección descubierta tras el cierre requiere una compensación operativa posterior; no se altera la instantánea. Ni el ledger ni la liquidación sustituyen facturas, retenciones, tratamiento fiscal o la comprobación bancaria del pago.

## Contribución operativa provisional

La superficie de rentabilidad es administrativa y no ejecuta pagos. Su operación normal es:

1. Crear una campaña con una identidad interna. Si la campaña usa atribución observada, conservar exactamente `utm_source`, `utm_medium` y `utm_campaign`; una campaña manual no finge UTM.
2. Registrar cada gasto real de captación o coste directo con importe en céntimos, fecha, descripción y una petición idempotente.
3. Cuando exista un primer ciclo Checkout V2 pagado, asignar explícitamente al alumno la parte acordada del gasto. No dividir el gasto automáticamente por el número actual de alumnos. La vía observada exige el evento de checkout coherente; la vía manual exige motivo.
4. Corregir errores solo mediante un contramovimiento enlazado. El saldo de un coste o asignación nunca puede quedar por debajo de cero, y el total asignado de una campaña nunca puede superar su gasto neto registrado.
5. Interpretar por separado la fila del alumno, la campaña y la cartera. El alumno descuenta solo captación asignada; campaña y cartera descuentan todo el gasto, incluido el todavía no asignado.

La fórmula de cartera es `cobros - devoluciones - obligación docente devengada - costes directos registrados - gasto total de captación`. Es una contribución provisional: no contiene comisiones de Stripe sin conciliar, costes compartidos, reserva, impuestos, pago efectivo de obligaciones, trabajo fundador no docente ni reparto. Un cobro confirmado sigue visible aunque la materialización de sus clases esté pendiente o haya fallado. Un saldo sin asignar o un dato ausente se muestra; no se transforma en cero por conveniencia.

## Operación del catálogo V2

- Crear, editar, previsualizar y descartar borradores no llama a Stripe. No se editan directamente `packages`, `package_prices`, `package_catalog_drafts` ni `checkout_v2_price_snapshots`.
- Publicar exige `catalog.write`, verifica la cuenta y el modo de Stripe y crea o recupera el mismo Product y la misma pareja de Prices mediante claves idempotentes. Si Stripe termina pero la respuesta de base de datos es incierta, se reintenta el mismo borrador y revisión; no se crean precios manuales paralelos.
- Una oferta solo se marca pública cuando la interfaz indica `Compatible con checkout actual`. `Checkout pendiente` significa que puede conservarse como oferta interna, pero compra, agenda y ciclo académico aún no ejecutan esos términos.
- Retirar desactiva primero la oferta local y después intenta archivar Prices y Product. Si la limpieza de Stripe falla, el checkout permanece cerrado y la interfaz informa de una limpieza técnica pendiente; nunca se reactiva la base de datos para compensar el fallo externo.
- Cada publicación y retirada conserva versiones y auditoría. Corregir un error significa crear otra versión o retirar la oferta, no modificar snapshots históricos.

## Operación del contenido público

- `Contenido` exige `content.read`; crear, guardar, publicar, descartar o republicar exige además `content.write`. No se editan directamente las tablas `cms_*`.
- Cada idioma tiene su propio documento y como máximo un borrador abierto. Un borrador nace de la versión publicada o, si todavía no existe, del fallback integrado en código.
- Guardar usa la revisión observada. Un conflicto significa que otra operación avanzó el borrador: se recarga y se decide sobre el estado nuevo; no se fuerza ni se sobrescribe.
- La vista previa protegida renderiza el borrador guardado con la home real, `noindex` y `no-store`. Los cambios locales sin guardar no se previsualizan ni se publican.
- Publicar crea una versión inmutable y actualiza la proyección pública en la misma transacción. La caché pública puede conservar la versión anterior durante un máximo de cinco minutos.
- Descartar cierra solo el borrador; no cambia la web. Republicar una versión histórica crea otra versión y queda auditado. Si existe un borrador abierto, primero se publica o descarta.
- Si la lectura server-only o la validación del payload fallan, la home usa el contenido integrado. Eso mantiene servicio, pero requiere revisar Sentry y el historial antes de volver a publicar.

## Recuperación de la garantía Checkout V2

La referencia operativa es una única fila de `checkout_v2_guarantee_operations`. Repetir una petición o una acción administrativa reanuda esa operación; nunca se cambia su importe, PaymentIntent, suscripción de Stripe ni identificadores congelados, y nunca se crea una devolución manual paralela.

- `processing`: comprobar la operación existente y reanudarla; el lease evita dos escritores simultáneos.
- `refund_pending`: esperar o reconciliar el mismo refund mediante webhook/lectura de Stripe. No se crea otro refund.
- `retryable`: reintentar la misma operación desde administración después de comprobar la identidad y el modo de Stripe.
- `manual_review`: trabajar desde el ticket enlazado y comparar el snapshot local con Stripe. Si existe un refund ID, administración solo puede reconciliar ese refund mediante lecturas y `observe`; un refund `failed` o `canceled` exige una decisión financiera manual y nunca dispara un segundo refund. Si todavía no existe refund, la misma operación solo puede volver a `retryable` después de cerrar el ticket y registrar un motivo auditado; entonces se reanuda sin cambiar el snapshot.
- `refunded`: estado terminal. Verificar que el importe coincide exactamente con la suma inmutable de las sesiones no consumidas del ciclo, que la suscripción está cancelada, que solo esas sesiones se han invalidado y que los jobs están deduplicados; no repetir efectos financieros.

Una cancelación tardía o no-show de cualquier sesión materializada solo se puede excusar desde administración, con un motivo obligatorio, mediante el ledger inmutable de incidencias. La acción no cambia el estado histórico de la sesión ni la reprograma. Toda corrección distinta pasa por soporte y una decisión explícita.

Los fallos posteriores de Calendar, email o CRM se recuperan en `fulfillment_jobs`; no justifican revertir ni repetir la devolución. Antes de probar este flujo en staging se hace el preflight exacto de Supabase y Stripe Sandbox y se usan exclusivamente datos de prueba.

## Producción

La única realidad operativa de producción es Cloudflare Pages, según `docs/ENVIRONMENTS.md`. Este repositorio no ofrece aliases, builds, validadores ni entornos Wrangler para Workers o colas de producción.

Los Workers y colas de producción que ya existen están reservados fuera de alcance: no se despliegan, validan, reutilizan ni eliminan por continuidad implícita. Un cambio futuro de arquitectura exigiría una decisión nueva de producto e infraestructura y una tarea explícita que reconstruya las garantías necesarias.

Cualquier cambio de Pages, Supabase, Stripe live, DNS, email live o datos reales exige autorización explícita, preflight de identidad, alcance, verificación y recuperación. Una aprobación de staging no se extiende a producción.
