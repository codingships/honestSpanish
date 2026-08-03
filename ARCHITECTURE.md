# Arquitectura

## Contrato vigente

La aplicación es un monolito modular Astro con Supabase como sistema de datos. La topología de ejecución depende del entorno:

- **Producción canónica:** Cloudflare Pages, proyecto `espanolhonesto`.
- **Staging canónico:** Worker web `espanolhonesto-staging`, Worker de fulfillment `espanol-honesto-fulfillment-staging` y Queue `espanol-honesto-fulfillment-staging-queue`, con su DLQ.
- Los Workers y colas de producción que todavía existen en Cloudflare están reservados y fuera de alcance. No son arquitectura vigente, fallback ni ruta de migración desde Pages.

Los identificadores concretos y las reglas de acceso están en `docs/ENVIRONMENTS.md`. Cambiar la topología de producción requiere una decisión nueva, configuración nueva y autorización explícita.

## Aplicación

Astro contiene:

- Web pública ES/EN/RU.
- Campus de alumno, profesor y administración.
- Auth SSR y RBAC con Supabase.
- API transaccional para CRM, reservas, cancelaciones, checkout y webhooks.
- Creación de trabajos duraderos en `fulfillment_jobs`.
- Contenido, blog, RSS e imágenes sociales.

Los límites principales son:

- Auth y RBAC: `src/middleware.ts`, clientes Supabase SSR y `profiles.role`.
- Billing: `checkout_intents`, `package_prices`, ciclos Checkout V2, Stripe Checkout y webhooks.
- Scheduling: `sessions`, disponibilidad y cuotas.
- Fulfillment: `fulfillment_jobs`, Google Workspace y Resend.
- Administración: CRM, usuarios, ofertas, pagos, sesiones y recuperación operativa.

Las rutas de `src/pages/api/**` no importan directamente implementaciones de Google ni el procesador de jobs. Acceden a esos efectos mediante la capa de servicio interna.

## Fulfillment de staging

El Worker de fulfillment expone operaciones internas autenticadas con `INTERNAL_JOB_SECRET`. El Worker web lo invoca mediante el binding privado `FULFILLMENT_SERVICE`; `FULFILLMENT_WORKER_URL` queda para desarrollo local y comprobaciones explícitas.

En staging, una petición de procesamiento publica una señal `process_due` en la Queue. Supabase `fulfillment_jobs` sigue siendo la fuente de verdad; la Queue no contiene el estado contractual del trabajo. El consumidor procesa con concurrencia limitada y envía los mensajes agotados a la DLQ.

Esta topología describe staging. No implica que producción Pages use actualmente esos Workers o colas.

## Datos

La cadena de cambios de base de datos es `supabase/migrations/`. `db/schema.sql` representa el esquema desplegable acumulado y `src/types/database.types.ts` se genera desde el Supabase de staging, que contiene el superset actual.

Tablas centrales:

- `profiles`, `profiles_private`
- `packages`, `package_prices`, `checkout_intents`
- `subscriptions`, `payments`
- `checkout_v2_billing_state`, `checkout_v2_cycles`
- `checkout_v2_guarantee_operations`, `checkout_v2_session_incident_resolutions`
- `checkout_v2_session_credit_adjustments` y las vistas de progreso de ciclo
- `sessions`, `student_teachers`
- `leads`
- `acquisition_attribution_events`
- `fulfillment_jobs`
- `processed_webhook_events`
- `admin_audit_log`

RLS protege el acceso académico por rol y el acceso administrativo directo por capacidad efectiva. Las operaciones administrativas y de fulfillment que usan la service role viven únicamente en código server-only.

## Acceso administrativo y auditoría

Supabase Auth conserva la identidad y `profiles.role` conserva el rol académico (`student`, `teacher`, `admin`). Los permisos operativos no se obtienen de metadatos del token: `admin_role_assignments` permite acumular `owner`, contenido, catálogo, operaciones, finanzas o lectura sobre un perfil que ya es administrador. Los administradores existentes reciben `owner` al aplicar la migración; después, los cambios pasan por RPC server-only, son idempotentes y no permiten retirar el último owner.

`src/middleware.ts` aplica un mapa central de capacidades a páginas y APIs administrativas y falla cerrado si la comprobación no está disponible. La misma separación se aplica en las políticas RLS de catálogo, operaciones, finanzas y acceso para que una sesión autenticada no pueda eludir la aplicación mediante la Data API. Los cambios de rol académico, email y atestación de adulto continúan siendo server-only incluso para un administrador. El panel global, que mezcla datos operativos y financieros, queda reservado a `owner` y `viewer`; los roles especializados se redirigen a su primera superficie permitida y la navegación solo muestra capacidades efectivas. La promoción o invitación de un perfil nuevo a administrador no forma parte todavía de este flujo.

`admin_audit_log` es append-only para acciones directas y solo admite la pseudonimización del actor provocada por la eliminación de su perfil. La vista administrativa de historial exige `access.read`, permite filtrar metadatos y no devuelve los snapshots `before`/`after`; ampliar la cobertura de auditoría a cada mutación del producto sigue siendo trabajo incremental.

El progreso de Checkout V2 se deriva de los hechos de `sessions` por ciclo; `subscriptions.sessions_used` conserva su significado operativo de cuota reservada y no representa clases consumidas. `checkout_v2_session_consumption` clasifica cada posición materializada y `checkout_v2_cycle_progress` solo publica contadores de consumo cuando existen exactamente las cuatro posiciones y el ciclo está listo. Un ciclo pendiente o inconsistente conserva su estado explícito y no se presenta como un progreso real de 0/4.

`checkout_v2_session_credit_adjustments` es un ledger append-only para decisiones administrativas que restauran crédito tras un no-show o una cancelación tardía del alumno. La restauración no altera el hecho original ni `teacher_compensation_ledger`. Todavía no existe una RPC de escritura: restaurar crédito sin materializar de forma atómica la sesión de reemplazo dejaría el contrato incompleto, por lo que esa operación se añadirá cuando se diseñe conjuntamente la reposición. Las lecturas masivas usan `get_checkout_v2_subscriptions_progress(UUID[])`, que deduplica y devuelve únicamente el ciclo con mayor `cycle_number` de cada suscripción. La aplicación la invoca en lotes de 500 para no depender de límites de URL o filas de PostgREST; la RPC rechaza más de 5.000 identificadores por llamada.

## Atribución de adquisición

La atribución inicial registra únicamente un origen observado cuando ocurre una conversión verificable: solicitud de plaza, diagnóstico válido o inicio de checkout. No instala analítica de navegación ni crea un identificador persistente del visitante. El navegador reduce la entrada a ruta local, idioma, clase de referidor y los cinco parámetros UTM permitidos; el servidor vuelve a normalizarla antes de escribir.

`acquisition_attribution_events` es un ledger append-only e idempotente enlazado al contacto y al `lead` o `checkout_intent` que valida el evento. `crm_contacts.source` y `source_path` permanecen como compatibilidad operativa, pero no son la fuente de verdad para reporting porque son mutables. La ficha CRM denomina primer y último origen a los primeros y últimos eventos realmente capturados, no a una visita histórica que el sistema no observa.

No se duplican compras, renovaciones ni devoluciones en este dominio. La atribución del checkout se relaciona con `subscriptions.checkout_intent_id`, ciclos y pagos existentes para calcular después ingresos, devoluciones y margen. Los UTM no se envían a Stripe y esta medición nunca bloquea una solicitud o una compra si falta o falla.

## Contribución operativa provisional

La medición económica interna conserva hechos y asignaciones explícitas sin convertirlos en contabilidad fiscal. `acquisition_campaigns` da una identidad estable a cada campaña y conserva, cuando existen, los UTM exactos usados para observarla. `operational_cost_ledger` registra gasto de captación o costes directos por alumno mediante movimientos append-only; cualquier corrección es un contramovimiento enlazado. `acquisition_cost_allocation_ledger` distribuye una parte del gasto de una campaña a un único alumno adquirido y congela su primer ciclo Checkout V2 pagado. Una asignación basada en checkout exige coincidencia exacta de los cinco UTM con el evento observado; una asignación manual no reclama un evento, puede referirse a cualquier campaña y exige un motivo auditado.

Las agregaciones separan sus fuentes antes de unirlas para evitar productos cartesianos. El ingreso bruto y las devoluciones proceden una sola vez de `payments`; el precio contractual del ciclo y la operación de garantía no se vuelven a sumar o restar. El coste docente procede una sola vez de `teacher_compensation_ledger`. Las renovaciones aumentan el ingreso acumulado del alumno, pero no crean de nuevo su coste de adquisición.

`student_unit_economics` muestra cobros, devoluciones, obligación docente devengada, costes directos registrados, captación asignada y contribución provisional. `acquisition_campaign_unit_economics` descuenta todo el gasto de la campaña aunque parte siga sin asignar, y `portfolio_unit_economics` hace lo mismo para la cartera completa. Estas vistas no incluyen comisiones de Stripe hasta disponer de una fuente autoritativa por movimiento, ni costes compartidos, reserva, fiscalidad, pago efectivo al profesor, remuneración fundadora no docente o reparto de beneficios.

## Remuneración docente

La remuneración docente es un dominio interno separado de los cobros de alumnos, las devoluciones, el trabajo no docente y el beneficio distribuible. Su modelo se divide en estas superficies:

- Una política versionada conserva las tarifas aprobadas y su moneda.
- Un vínculo efectivo entre profesor y academia identifica si actúa como fundador o externo y qué términos le corresponden, sin inferirlo de su nombre ni de una sesión aislada.
- Un hito duradero conserva la primera fecha en que se alcanzan diez alumnos activos y la referencia de 90 días desde el primer ciclo inicial listo. El hito de diez no se deshace por bajas posteriores.
- Cada ciclo congela la versión de política y el escalón externo de 20/25 EUR. El ciclo que causa el hito conserva 20 EUR para un profesor externo; solo un ciclo que comienza después aplica 25 EUR.
- Un ledger append-only registra cada obligación por clase con el profesor que realmente la imparte, su vínculo efectivo, sesión, alumno, suscripción, ciclo, tarifa y momento de origen. Esto permite una sustitución aceptada antes de la clase sin reescribir el ciclo; después de devengar, esa asignación económica queda congelada. Reintentos y reconciliaciones convergen sobre una sola entrada.
- Un segundo ledger append-only registra únicamente formación y reuniones obligatorias por su intervalo real, congela el vínculo y la política aplicables y calcula 25 céntimos por minuto entero. Sus correcciones son entradas compensatorias enlazadas; nunca editan ni borran el original.

Para este cálculo, alumno activo significa un alumno distinto con suscripción Checkout V2 `active` y ciclo inicial `ready`. La formación o reunión obligatoria no se atribuye a un alumno ni se disfraza como clase, preparación ordinaria, marketing, mantenimiento o trabajo fundador. Una cancelación tardía o no-show genera obligación docente; una resolución de incidencia de garantía no la revierte porque solo cambia la elegibilidad de la garantía o el crédito del alumno.

Este dominio calcula y conserva obligaciones pendientes. No ejecuta transferencias, no marca pagos a profesores y no modela facturas, retenciones, IVA, IRPF ni reparto de beneficios. Esas superficies requieren una decisión fiscal y una operativa de liquidación posteriores.

## Integraciones

- Stripe ejecuta cobros; `package_prices` conserva la oferta contractual inmutable.
- Google Workspace aporta Drive, Docs, Calendar y Meet mediante una service account con delegación de dominio.
- Resend envía correo transaccional.
- Turnstile protege formularios públicos.
- Sentry registra errores técnicos según el entorno.

Cada entorno usa sus propios recursos y credenciales. Un recurso de otro proyecto o de otro entorno nunca se usa como sustituto.

## Garantía del primer ciclo

La garantía de Checkout V2 es una saga financiera duradera, no una suma calculada por el navegador ni una devolución aislada en Stripe. PostgreSQL decide la elegibilidad bajo bloqueo y congela en `checkout_v2_guarantee_operations` la compra, el ciclo inicial, las cuatro sesiones, el PaymentIntent y el importe contractual de 19.425 céntimos. Solo puede existir una operación por suscripción.

El orden irreversible es: validar el contrato local y remoto, cancelar inmediatamente la suscripción de Stripe, reflejar la terminación local e invalidar las sesiones 2–4, y crear la devolución parcial con una clave de idempotencia estable. Los webhooks de refund y `charge.refunded` reconcilian la misma operación; nunca crean una segunda. Los estados pendientes quedan visibles y los resultados ambiguos pasan a revisión manual con ticket de soporte.

Una excepción de soporte a una cancelación tardía o no-show de la segunda sesión se registra por separado en `checkout_v2_session_incident_resolutions`. Ese ledger es inmutable y auditado: reclasifica la incidencia para evaluar la garantía, pero no reabre ni reprograma una clase.

Tras confirmar Stripe la devolución, un único trabajo `guarantee_refund` envía la confirmación transaccional y registra el efecto en CRM. Las cancelaciones de Calendar de las tres sesiones restantes son trabajos deduplicados independientes; un fallo de Google o correo no altera el resultado financiero ya confirmado.
