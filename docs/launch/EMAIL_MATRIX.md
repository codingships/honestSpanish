# Email Matrix

Estado: fuente operativa v1 para emails transaccionales. Marketing queda fuera hasta cerrar consentimiento, opt-out y entregabilidad.

## Principios

- Idioma por defecto: ingles.
- Mientras una familia siga English-first en v1, sus fechas usan `en-GB` y sus horas muestran tambien la abreviatura CET/CEST de `Europe/Madrid`; no se mezclan etiquetas o fallbacks españoles dentro del cuerpo ingles ni se deja la zona horaria implicita.
- Voz: humana, directa y sobria.
- Los emails transaccionales no requieren opt-out de marketing, pero deben ser necesarios para la solicitud, pago, clase, soporte o cuenta.
- Los emails de seguimiento comercial manual (`sales_follow_up`) no son campanas de marketing, pero deben respetar opt-out y base legal/revision en CRM antes de enviarse.
- Los emails de marketing o nurturing masivo no se activan en v1.
- Cuando el email afecta al flujo comercial, debe dejar rastro en CRM o generar una tarea/actividad equivalente.

## Matriz V1

| Evento | Destinatario | Template/funcion | Trigger actual | CRM/trazabilidad | Estado |
| --- | --- | --- | --- | --- | --- |
| Solicitud de plaza recibida | Lead | `leadWelcomeTemplate` / `sendLeadWelcomeEmail` | `src/pages/api/subscribe.ts` | `crm_activities.email_out` si Resend devuelve exito; solicitud y tarea SLA 24h en CRM | Implementado |
| Nuevo lead pendiente | Alin/socio | Email interno HTML en `src/pages/api/subscribe.ts` | `src/pages/api/subscribe.ts` | Contacto, oportunidad, actividad y tarea compartida SLA 24h | Implementado |
| Bienvenida post-pago | Alumno | `welcomeEmailTemplate` / `sendWelcomeEmail` | `src/lib/fulfillment/jobs.ts` tras `welcome_fulfillment` | CRM onboarding: actividad, tarea admin SLA 24h, `next_follow_up_at` y contacto `customer` tras email aceptado; login localizado por `preferred_language` con fallback ingles; email pide abrir campus/materiales y responder si hay limites de disponibilidad antes de primera clase | Implementado v1 |
| Clase confirmada | Alumno/profesor | `classConfirmationTemplate` / `sendClassConfirmation` | `src/lib/fulfillment/session-fulfillment.ts` | `crm_activities.email_out` en timeline del alumno tras aceptar ambos emails; el email mantiene duracion 30/40/50 sin prometer corte automatico de Meet | Implementado v1 |
| Recordatorio de clase | Alumno/profesor | `classReminderTemplate` / `sendClassReminder` | `workers/fulfillment/src/index.ts` | `crm_activities.email_out` en timeline del alumno tras marcar `reminder_sent` | Implementado v1 |
| Clase cancelada | Alumno/profesor | `classCancelledTemplate` / `sendClassCancelled` | `src/lib/fulfillment/jobs.ts` | Actividad `class` de cancelacion + `email_out` de cancelacion en timeline del alumno | Implementado v1 |
| Email de prueba admin | Admin | `buildEmailPreview` / `sendEmailPreview` | `src/pages/api/email/send-test.ts` | No aplica; herramienta interna de verificacion; bienvenida y renovacion se revisan en ES/EN/RU, la bienvenida muestra el bloque contractual completo y las familias de clase muestran CET/CEST; las demas conservan el English-first v1 | Implementado |
| Diagnostico ligero | Lead | `levelCheckInviteTemplate` / `sendLevelCheckInviteEmail` | Accion admin `send_level_check` desde solicitudes; enlace a `/{lang}/diagnostico?email=...` para evitar duplicados por typo | Envio registrado como `crm_activities.email_out`; al recibir formulario: actividad `level_check` refrescada con el ultimo resumen, tarea review SLA 24h creada o refrescada si esta abierta/snoozed, nueva tarea si la anterior ya se cerro, resumen en lead y limpieza de contexto crudo al descartar | Implementado |
| Falta informacion | Lead | `missingInfoEmailTemplate` / `sendMissingInfoEmail` | Accion admin `send_sales_email` desde solicitudes | Verifica `crm_consents` antes de enviar; bloquea opt-out/manual-review; despues registra `crm_activities.email_out`, lead `contacted`, oportunidad `contacted` y crea/reactiva tarea `crm_tasks.lead_sales_follow_up` a 24h | Implementado v1 |
| Propuesta manual / siguiente paso | Lead | `proposalNextStepEmailTemplate` / `sendProposalNextStepEmail` | Accion admin `send_sales_email` desde solicitudes | Verifica `crm_consents` antes de enviar; bloquea opt-out/manual-review; despues registra `crm_activities.email_out`, lead `contacted`, oportunidad `proposal` y crea/reactiva tarea `crm_tasks.lead_sales_follow_up` a 24h | Implementado v1 |
| Pago pendiente / instrucciones de pago | Lead/alumno | Pendiente | Final-only hasta Stripe live o enlace manual confirmado | Debe quedar en oportunidad CRM | Pendiente |
| Soporte recibido | Usuario | `supportTicketReceivedTemplate` / `sendSupportTicketReceivedEmail` | `src/pages/api/support/alert.ts` tras crear ticket | `crm_activities.email_out` si Resend acepta el acuse | Implementado v1 |
| Soporte actualizado | Usuario | `supportTicketUpdatedTemplate` / `sendSupportTicketUpdatedEmail` | `src/pages/api/admin/support-tickets.ts` al cambiar estado o nota visible | Actualizacion `support`, audit log admin y `crm_activities.email_out` si Resend acepta el aviso | Implementado v1 |
| Nuevo ticket soporte | Alin/socio | Email interno HTML en `src/pages/api/support/alert.ts` | `src/pages/api/support/alert.ts` | Crea `support_tickets`, actividad CRM `support` y alerta interna | Implementado v1 |

## Proximo Trabajo

- Decidir si `crm_activities` basta para todos los emails o si hace falta `email_events` para entrega/rebote cuando Resend production este activo.
- Separar claramente transaccional, soporte, sales follow-up y marketing antes de cualquier campana. Sales follow-up v1 ya falla cerrado si no puede verificar consentimiento CRM.
- Definir instrucciones de pago manuales solo si se decide operar antes de Stripe live.

## Contrato De Activacion Post-Pago

Post-pago no se considera activado solo por crear una compra o cuenta. Para el RC sin cobros reales, la activacion operativa requiere:

- Email de bienvenida aceptado por Resend o mock equivalente.
- Campus accesible con siguiente accion clara.
- Carpeta/materiales preparados antes de la primera clase.
- Primera clase coordinada manualmente con disponibilidad real.
- Tarea CRM compartida con SLA 24h hasta que la primera clase este programada o haya que reprogramar.
- Actividad CRM que cierre onboarding cuando la primera clase se complete.
