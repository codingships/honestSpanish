# Producto objetivo

Este documento recoge las decisiones duraderas de producto de Español Honesto. Si una tarea propone cambiar precio, oferta, promesa pública, proveedor, política de datos o comportamiento de negocio, se detiene para que el propietario decida y se actualizan código y documento en la misma PR.

El código integrado todavía implementa parte de la oferta anterior en superficies no acreditadas. Staging abre el checkout Sandbox (`CHECKOUT_ENABLED=true`) solo para acreditar el contrato; producción permanece cerrada hasta autorización explícita.

## Propuesta y público

Español Honesto ofrece clases individuales de español para adultos, orientadas a conversación, cultura y uso real del idioma. El alumno compra una plaza semanal concreta con un profesor identificado; no compra un banco anónimo de horas ni entra en un marketplace.

La captación inicial se realiza en inglés y se dirige a adultos que viven, trabajan o van a trasladarse a España. El español funciona como idioma de apoyo, no como mercado principal de adquisición. El ruso queda limitado a un piloto medido: solo se amplía si sus resultados justifican dedicarle contenido o publicidad. La web puede conservar rutas en español, inglés y ruso, pero todas deben describir el mismo producto.

El servicio es exclusivamente para mayores de 18 años. Registro y compra exigen una declaración expresa de mayoría de edad; no se recoge fecha de nacimiento ni existe un flujo para menores.

## Oferta inicial única

| Propiedad | Decisión |
|---|---|
| Clave contractual | `individual_4x50_28d` |
| Precio de trabajo | 259 EUR por ciclo, impuestos incluidos según la conclusión fiscal final |
| Sesiones | 4 clases individuales |
| Duración | 50 minutos por clase |
| Periodo | 28 días literales |
| Renovación | Automática por otros 28 días hasta que se cancele |
| Profesor | Identificado antes de pagar |
| Horario | Franja semanal, zona horaria y primera fecha identificadas antes de pagar |
| Compra | Directa B2C; revisión manual solo como excepción o recuperación |

Los primeros 259 EUR se cobran al reservar la plaza. Antes de confirmar la compra se muestran las cuatro fechas previstas —días 0, 7, 14 y 21 desde la primera clase— y la fecha exacta de la siguiente renovación, que se cobra 28 días después de esa primera clase. Si el alumno cambia la primera fecha mediante autoservicio dentro del plazo permitido antes de empezar, se desplazan el ancla y las cuatro fechas. Un cambio excepcional gestionado por soporte fuera de ese plazo no mueve automáticamente el ancla; una vez comenzada la primera clase, el ancla queda fija. El cobro del ciclo no se prorratea ni usa fechas implícitas distintas de lo comunicado; la devolución proporcional de sesiones no consumidas se rige exclusivamente por la garantía siguiente.

Un cambio futuro de precio o condiciones crea una versión contractual nueva. Nunca reescribe compras, sesiones o obligaciones históricas.

## Capacidad inicial

Las primeras cinco plazas vendibles son tres de Álex y dos de Irene. Cada plaza representa capacidad real con profesor, franja semanal, zona horaria, primera fecha y estado.

Una plaza se retiene temporalmente durante checkout y se libera si el pago no termina. No se cobra cuando no existe capacidad y dos compradores no pueden adquirir la misma plaza. La disponibilidad pública debe proceder del inventario real, no de un contador o texto decorativo.

## Reprogramación, cancelaciones y sustituciones

- Con al menos 24 horas de antelación, el alumno puede reprogramar y conserva la clase.
- Antes de impartir la primera clase, el autoservicio puede desplazar la primera fecha —y con ella las cuatro sesiones y el siguiente cobro— hasta un máximo inclusivo de 28 días desde la primera fecha originalmente comprada. Más allá requiere soporte y no mueve automáticamente el ancla de renovación.
- Con menos de 24 horas o en caso de no-show, la clase se considera consumida y el profesor se paga. Soporte puede documentar una incidencia justificada y reclasificarla para restituir el crédito del alumno o evaluar la garantía, pero esa excepción no borra el hecho histórico ni revierte la obligación docente ya generada. La redacción jurídica final puede ajustar su presentación sin exigir rehacer el modelo.
- Si cancela la academia o el profesor, el alumno conserva la clase.
- La academia puede proponer un sustituto y el alumno puede rechazarlo.
- Reprogramar es una única operación: la nueva reserva y la liberación de la anterior no pueden duplicar ni perder el crédito.

## Garantía proporcional por clases no consumidas

En cualquier paquete y ciclo ya cobrado, después de consumir una o más clases y antes de comenzar la siguiente, el alumno puede terminar el servicio y solicitar la devolución del valor contractual de todas las clases todavía no consumidas. Las clases completadas permanecen pagadas. Una cancelación tardía o un no-show que soporte no haya reclasificado cuenta como clase consumida; reprogramar con al menos 24 horas conserva la posibilidad de solicitar la devolución antes de la nueva fecha.

El importe se calcula exclusivamente desde el snapshot contractual de ese ciclo, nunca desde el catálogo vigente ni mediante un importe fijo de la interfaz. El snapshot asigna en céntimos el valor de cada clase y garantiza que la suma coincide exactamente con el precio cobrado, incluido cualquier resto de redondeo. La devolución es la suma de las clases no consumidas.

Para la versión actual de 259 EUR y cuatro clases de 64,75 EUR, la referencia es: 194,25 EUR después de consumir una clase; 129,50 EUR después de dos; 64,75 EUR después de tres; y 0 EUR cuando las cuatro se han consumido. Una devolución invalida únicamente las sesiones pendientes de ese ciclo, cancela todas las renovaciones futuras y no puede ejecutarse dos veces sobre las mismas unidades contractuales.

La resolución de una incidencia modifica la clasificación de consumo y, cuando corresponda, el crédito del alumno. No borra el hecho histórico ni revierte una remuneración docente ya devengada. La revisión jurídica final confirmará desistimiento y consentimiento para comenzar antes de catorce días sin alterar esta regla comercial salvo decisión expresa del propietario.

## Profesor y remuneración operativa

- Fundadores: 40 EUR por clase de 50 minutos.
- Profesor externo: 20 EUR por clase al comenzar.
- La tarifa externa sube a 25 EUR desde el primer ciclo posterior al primero de estos dos hitos: alcanzar diez alumnos activos o cumplir 90 días desde que el primer ciclo inicial de Checkout V2 queda listo.
- A estos efectos, un alumno activo es un alumno distinto con una suscripción Checkout V2 en estado `active` y su ciclo inicial en estado `ready`. Alcanzar diez se registra una sola vez y es irreversible aunque el número de alumnos activos descienda después.
- El ciclo que causa el hito de diez alumnos conserva la tarifa externa de 20 EUR. Solo los ciclos que comienzan después del hito aplican 25 EUR; la misma regla de posterioridad se aplica al hito de 90 días.
- Formación y reuniones obligatorias: 15 EUR por hora real para cualquier profesor, equivalentes a 25 céntimos por minuto real registrado.
- Ese trabajo obligatorio se registra separado de las clases y solo comprende formación o reuniones exigidas por la academia. La preparación ordinaria, el marketing, el mantenimiento y las demás tareas fundadoras no se convierten en trabajo docente por esta vía.
- Una corrección no reescribe el registro original: añade una entrada compensatoria identificada y auditada.
- La tarifa docente incluye preparación ordinaria, clase, nota breve, deberes normales y mensajes ordinarios.
- Cancelaciones tardías y no-show liquidables generan obligación docente; cancelaciones de la academia no trasladan el coste al alumno.
- El piloto con Irene se basa en confianza y control de calidad poco intrusivo: sin grabación, transcripción ni observación permanente.

El trabajo docente, el trabajo no docente real y el beneficio distribuible se registran por separado. La plataforma debe permitir conocer ingresos, devoluciones, coste docente, captación, costes directos, reserva y margen por alumno; no convierte un reparto informal en una categoría contable.

Hasta que se decidan la reserva, los costes compartidos, la fiscalidad y el reparto, la cifra operativa se denomina **contribución provisional**, no beneficio neto ni distribuible. Los cobros y devoluciones proceden del ledger de pagos, el coste docente de las obligaciones ya devengadas y los costes directos de movimientos expresamente registrados. El gasto de captación se asigna a un alumno una sola vez y mediante una decisión administrativa trazable; nunca se reparte automáticamente entre conversiones. La vista de cartera descuenta también el gasto de campaña todavía no asignado, mientras que la vista individual solo descuenta la parte asignada a ese alumno.

## Entrada comercial y CRM

Mientras el checkout de producción permanece cerrado, la captación pública es por contacto: el CTA principal apunta a `#contacto`, el precio de 259 EUR sigue visible como ancla y no se ofrece compra directa en la web. Staging mantiene `CHECKOUT_ENABLED=true` para acreditar el contrato Sandbox; al abrir el pago, el CTA vuelve a plazas y Stripe Checkout.

Cuando el checkout está habilitado, el recorrido principal es oferta → profesor y franja → cuenta/datos imprescindibles → condiciones → Stripe Checkout. El diagnóstico, los objetivos y las preferencias no constituyen una aprobación manual ni bloquean una plaza por criterio comercial; su ubicación exacta en el recorrido se resolverá al diseñar la experiencia sin alterar la compra directa.

Con el pago cerrado, el formulario de contacto es la vía primaria para dudas, orientación y disponibilidad. Con el pago abierto, el contacto queda como vía secundaria para lista de espera o casos que requieran intervención y no bloquea la compra directa.

El CRM es propio y vive dentro del admin Astro/Supabase. El contacto es el registro central de la relación; Stripe, sesiones, perfiles y soporte conservan sus fuentes operativas. La atribución mínima conserva landing, referrer y UTM desde la entrada hasta compra, renovación o devolución sin almacenar información excesiva.

## Pagos y proveedores

- Supabase conserva catálogo, capacidad, snapshots contractuales y operación.
- Stripe cobra 259 EUR al reservar y programa la recurrencia para 28 días después de la primera clase. La implementación puede separar el pago inicial de la suscripción futura, pero para el alumno forman un único contrato y nunca dos cobros iniciales.
- Checkout, webhooks, renovaciones, devoluciones y trabajos externos son idempotentes.
- El portal permite gestionar método de pago y cancelación según la política vigente; no ofrece planes retirados.
- Staging acredita el checkout Sandbox con `CHECKOUT_ENABLED=true`. Producción permanece en `CHECKOUT_ENABLED=false` hasta revisión final y autorización explícita.
- Activar pagos reales, cambiar proveedor o abrir checkout de producción exige un gate explícito.

Stack confirmado: Cloudflare Workers, Supabase, Stripe, Google Workspace, Resend, Turnstile y Sentry. Los recursos exactos están en `docs/ENVIRONMENTS.md`; no se sustituye uno por otro aunque una cuenta contenga otros proyectos.

## Confianza, contenido y datos

- No se publican reseñas o testimonios sin fuente real y permiso.
- No se anuncian grupos, comunidad, Telegram, híbrido, intensivo ni servicios inexistentes.
- No se prometen plazos universales de fluidez o resultados no demostrables.
- El método se explica mediante acciones concretas y expectativas de trabajo, no adjetivos.
- Imágenes, perfiles, experiencia y credenciales deben ser verificables y tener licencia o autorización.
- No se activa telemetría rica sin decidir minimización, consentimiento, cookies, retención y privacidad. Sentry queda limitado a errores técnicos sin información personal innecesaria.

## Fuera de la oferta inicial

- Grupos, híbrido e intensivo.
- Clases de 30 o 40 minutos.
- Descuentos o compromisos de tres y seis meses.
- Marketplace de profesores y matching automático.
- Menores de edad.
- Segundo procesador de pagos.
- Aplicación móvil nativa.

Estos elementos no permanecen visibles como ofertas “próximamente”. Solo se reconsideran con datos reales y una nueva decisión de producto.

## Gates humanos pendientes

No son un bloqueo general; detienen únicamente la tarea que dependa de ellos:

- Confirmación fiscal/jurídica final del precio de 259 EUR, vendedor, facturación, IVA/IRPF y remuneraciones.
- Cinco franjas concretas de Álex e Irene antes de publicar disponibilidad.
- Canal y compromiso realista de soporte antes de cobrar.
- Textos legales, desistimiento, cancelación tardía, privacidad, cookies y retención antes de producción real.
- Stripe live, producción, DNS y dinero real siempre requieren autorización explícita.
