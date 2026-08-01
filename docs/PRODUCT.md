# Producto objetivo

Este documento recoge las decisiones duraderas de producto de Español Honesto. Si una tarea propone cambiar precio, oferta, promesa pública, proveedor, política de datos o comportamiento de negocio, se detiene para que el propietario decida y se actualizan código y documento en la misma PR.

El código integrado todavía implementa parte de la oferta anterior. Mientras dure la transición, `CHECKOUT_ENABLED=false` y `CHECKOUT_ENABLED_OVERRIDE=false` impiden aceptar dinero por un contrato que aún no esté implementado y verificado de extremo a extremo.

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

Los primeros 259 EUR se cobran al reservar la plaza. Antes de confirmar la compra se muestran las cuatro fechas previstas —días 0, 7, 14 y 21 desde la primera clase— y la fecha exacta de la siguiente renovación, que se cobra 28 días después de esa primera clase. Si la primera fecha cambia antes de empezar, se desplazan el ancla y las cuatro fechas; una vez comenzada la primera clase, el ancla queda fija. No se aceptan prorratas ni fechas implícitas distintas de lo comunicado al alumno.

Un cambio futuro de precio o condiciones crea una versión contractual nueva. Nunca reescribe compras, sesiones o obligaciones históricas.

## Capacidad inicial

Las primeras cinco plazas vendibles son tres de Álex y dos de Irene. Cada plaza representa capacidad real con profesor, franja semanal, zona horaria, primera fecha y estado.

Una plaza se retiene temporalmente durante checkout y se libera si el pago no termina. No se cobra cuando no existe capacidad y dos compradores no pueden adquirir la misma plaza. La disponibilidad pública debe proceder del inventario real, no de un contador o texto decorativo.

## Reprogramación, cancelaciones y sustituciones

- Con al menos 24 horas de antelación, el alumno puede reprogramar y conserva la clase.
- Con menos de 24 horas o en caso de no-show, la clase se considera consumida y el profesor se paga. Si soporte documenta una incidencia justificada y la reclasifica, deja de ser una cancelación tardía o no-show a todos los efectos; sin esa reclasificación, la regla se aplica íntegramente. La redacción jurídica final puede ajustar su presentación sin exigir rehacer el modelo.
- Si cancela la academia o el profesor, el alumno conserva la clase.
- La academia puede proponer un sustituto y el alumno puede rechazarlo.
- Reprogramar es una única operación: la nueva reserva y la liberación de la anterior no pueden duplicar ni perder el crédito.

## Garantía

Después de completar la primera clase y antes de comenzar la segunda, el alumno puede solicitar la devolución del valor contractual de las tres clases restantes. La primera clase queda pagada. Reprogramar la segunda con al menos 24 horas conserva esta ventana hasta que comience la nueva sesión; una cancelación tardía o un no-show que soporte no haya reclasificado consume la segunda clase y cierra la ventana.

Para la versión de 259 EUR, el importe de referencia de las tres clases es 194,25 EUR. El cálculo se realiza desde el snapshot contractual de la compra, no desde el catálogo vigente. Una devolución invalida las tres sesiones restantes, cancela las renovaciones futuras y no puede ejecutarse dos veces. La revisión jurídica final confirmará desistimiento y consentimiento para comenzar antes de catorce días sin alterar esta regla comercial salvo decisión expresa del propietario.

## Profesor y remuneración operativa

- Fundadores: 40 EUR por clase de 50 minutos.
- Profesor externo: 20 EUR por clase al comenzar.
- La tarifa externa sube a 25 EUR desde el primer ciclo posterior a alcanzar diez alumnos activos o 90 días desde la primera venta, lo que ocurra antes.
- Formación y reuniones obligatorias: 15 EUR por hora real.
- La tarifa docente incluye preparación ordinaria, clase, nota breve, deberes normales y mensajes ordinarios.
- Cancelaciones tardías y no-show liquidables generan obligación docente; cancelaciones de la academia no trasladan el coste al alumno.
- El piloto con Irene se basa en confianza y control de calidad poco intrusivo: sin grabación, transcripción ni observación permanente.

El trabajo docente, el trabajo no docente real y el beneficio distribuible se registran por separado. La plataforma debe permitir conocer ingresos, devoluciones, coste docente, captación, costes directos, reserva y margen por alumno; no convierte un reparto informal en una categoría contable.

## Entrada comercial y CRM

El recorrido principal es oferta → profesor y franja → cuenta/datos imprescindibles → condiciones → Stripe Checkout. El diagnóstico, los objetivos y las preferencias no constituyen una aprobación manual ni bloquean una plaza por criterio comercial; su ubicación exacta en el recorrido se resolverá al diseñar la experiencia sin alterar la compra directa.

El formulario de contacto se mantiene como vía secundaria para dudas, lista de espera o casos que requieran intervención. Un contacto no bloquea la compra directa.

El CRM es propio y vive dentro del admin Astro/Supabase. El contacto es el registro central de la relación; Stripe, sesiones, perfiles y soporte conservan sus fuentes operativas. La atribución mínima conserva landing, referrer y UTM desde la entrada hasta compra, renovación o devolución sin almacenar información excesiva.

## Pagos y proveedores

- Supabase conserva catálogo, capacidad, snapshots contractuales y operación.
- Stripe cobra 259 EUR al reservar y programa la recurrencia para 28 días después de la primera clase. La implementación puede separar el pago inicial de la suscripción futura, pero para el alumno forman un único contrato y nunca dos cobros iniciales.
- Checkout, webhooks, renovaciones, devoluciones y trabajos externos son idempotentes.
- El portal permite gestionar método de pago y cancelación según la política vigente; no ofrece planes retirados.
- `CHECKOUT_ENABLED=false` y `CHECKOUT_ENABLED_OVERRIDE=false` siguen siendo el estado normal hasta superar Stripe test, revisión final y autorización de producción.
- Activar pagos reales, cambiar proveedor o abrir checkout exige un gate explícito.

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
