# Public Conversion Architecture

Estado: activo para Release Candidate.

La estrategia comercial completa del lanzamiento queda en `docs/launch/LAUNCH_MARKETING_PLAN.md`; este documento concreta la conversion publica y el flujo de solicitud.

## Objetivo

Convertir visitantes cualificados en solicitudes de plaza revisables, no empujar compra inmediata a personas que no encajan. La compra directa, Stripe live y pagos reales quedan para el cierre final.

## Jerarquia De Accion

1. Solicitar plaza.
2. Revisar plan de interes, nivel aproximado, objetivo, disponibilidad y pagina de origen.
3. Responder con plan recomendado, prueba automatica ligera o siguiente paso humano.
4. Comprar o activar pago solo cuando haya encaje y el modo de pagos este cerrado.

## Nivel Y Prueba De Nivel En RC

La solicitud de plaza no es una prueba de nivel definitiva. En el Release Candidate solo recoge senales de encaje: plan de interes, nivel aproximado declarado, objetivo, disponibilidad, interes y pagina de origen.

Despues de revisar la solicitud, el equipo puede responder con una de estas salidas:

- Plan recomendado si el encaje es claro.
- Preguntas de aclaracion o una prueba automatica ligera si falta contexto.
- Siguiente paso humano si el alumno parece serio y hay disponibilidad.
- No avanzar si no hay grupo compatible, disponibilidad o encaje suficiente.

La prueba de nivel definitiva queda pospuesta. La parte automatica puede ser gratuita y servir para orientar nivel, pero no debe presentarse como evaluacion humana completa. La direccion recomendada para una prueba seria es asincrona: documento breve + video o audio de habla, rubricado manualmente solo cuando haya solicitud seria o compra. El criterio operativo esta en `docs/launch/LEVEL_CHECK.md`. Si entra en launch, antes hay que cerrar consentimiento, privacidad, retencion, canal de envio y evidencia en `docs/launch/CHECKLIST.md`.

## Superficie Publica

Las paginas de segmento muestran un bloque visible "Despues de solicitar plaza" para explicar el flujo: revision de encaje, posible pregunta o prueba automatica ligera, y plan/pago solo cuando haya encaje. Esto reduce dudas sin prometer compra inmediata, grupo garantizado ni prueba de nivel humana universal.

La home muestra el mismo criterio junto al formulario de solicitud: primero revision de encaje, despues aclaracion de nivel si hace falta, y solo despues propuesta de plan, grupo compatible si existe y pago.

La home tambien muestra comunidad como criterio de encaje: contacto real con Espana, materiales compartidos y practica con otros alumnos solo cuando hay compatibilidad. No se usa como promesa de Telegram, grupo garantizado ni comunidad publica ya operativa.

| Superficie | Funcion | CTA |
| --- | --- | --- |
| `/es` | Marca, oferta general, equipo, que incluye, planes y rutas de entrada. | Solicitar plaza |
| `/es/espanol-para-vivir-en-espana` | Intencion cultural y vida en Espana. | Solicitar plaza |
| `/es/espanol-para-profesionales` | Intencion profesional, trabajo y ciudad. | Solicitar plaza |
| `/es/clases-de-conversacion-en-espanol` | Intencion de conversacion A2/B1+, bloqueo al hablar y paso de espanol pasivo a usable. | Solicitar plaza |
| Blog publico | Descubrimiento por problemas concretos y autoridad editorial; indice y posts enlazan al formulario de solicitud. | Solicitar plaza |
| Planes | Transparencia de precio y formato, sin fingir disponibilidad de grupo. | Solicitar plaza; checkout solo si se activa explicitamente el modo de pagos |

## Planes Y Checkout

Las landings publicas renderizan `PricingSection` en modo `application`: los botones de planes llevan al formulario de solicitud de plaza aunque existan Price IDs de Stripe en Supabase. El plan pulsado se guarda como `preferred_package` en la solicitud para revisar intencion comercial sin abrir checkout ni activar telemetria rica. Esto evita que el RC empuje compra inmediata antes de revisar encaje.

La copia publica de planes y errores no debe prometer "continuar al pago" mientras el modo publico sea de solicitud. Si por error se intenta llamar a `/api/create-checkout`, el backend falla cerrado salvo que `CHECKOUT_ENABLED=true`.

El modo `checkout` queda reservado para la ventana final o para flujos donde Alin decida aceptar pagos. Antes de activarlo, hay que cerrar `payments_staging`, definir si se aceptan pagos reales o solo test, poner `CHECKOUT_ENABLED=true` de forma deliberada y registrar evidencia no secreta de checkout, webhook, portal y reconciliacion.

## Datos Que Recoge La Solicitud

- Nombre y email.
- Interes.
- Plan de interes.
- Nivel aproximado.
- Objetivo de aprendizaje.
- Disponibilidad.
- Idioma y pagina de origen.
- Consentimiento de privacidad.

## Revision Admin

El admin debe poder filtrar solicitudes por estado:

- `new`: pendiente de revisar.
- `contacted`: ya se ha respondido o iniciado contacto.
- `discarded`: no encaja o queda fuera del momento actual.

Cada cambio de estado debe quedar auditado en `admin_audit_log`.

## Aprendizaje Sin Telemetria Rica

El primer ciclo de aprendizaje de clientes se apoya en datos ya necesarios para la solicitud de plaza, no en cookies analiticas nuevas:

- `sourcePath`: ruta desde la que llega la solicitud.
- `interest`: interes declarado.
- `preferred_package`: plan pulsado antes de enviar la solicitud.
- `currentLevel`: nivel aproximado declarado.
- `learningGoal`: objetivo escrito por la persona.
- `availability`: disponibilidad aproximada.

El panel de solicitudes muestra un resumen agregado de rutas que convierten, intereses, planes y niveles para comparar si el trafico que llega coincide con el cliente principal. Esto sirve para SEO y LLM discoverability sin exportar datos personales ni activar telemetria de producto.

## Lo Que No Se Promete En RC

- Prueba de nivel humana gratuita universal.
- Prueba de nivel automatica como diagnostico definitivo.
- Grupo compatible si todavia no conocemos a los alumnos.
- Comunidad publica activa sin canal y moderacion definidos.
- Reviews o testimonios sin permiso real.
- Pagos live antes del cierre final.

## Evidencia De Implementacion

- `src/components/LeadCaptureForm.tsx`
- `src/pages/api/subscribe.ts`
- `src/pages/api/admin/leads.ts`
- `src/components/admin/LeadManager.tsx`
- `src/components/LandingPage.astro`
- `docs/launch/SEO_INTENT_MAP.md`
- `tests/api/subscribe.test.ts`
- `tests/api/admin-leads.test.ts`
- `tests/e2e/lead-magnet.public.spec.ts`
- `tests/unit/landing-public-content.test.ts`
- `tests/unit/lead-manager-source.test.ts`
