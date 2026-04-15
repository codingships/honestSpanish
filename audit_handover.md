# 🕵️‍♂️ Instrucciones de Auditoría de Código (Handover para Agente)

## Contexto del Proyecto
El proyecto es una academia de idiomas ("Español Honesto") construida con **Astro**, **React**, **Supabase** (PostgreSQL + Auth), **Stripe** y APIs de **Google Workspace**. Estamos a punto de desplegar a producción y necesitamos una auditoría exhaustiva y paranoica ("clean room audit").

## 🎯 Objetivo de la Auditoría
Tu tarea es buscar vulnerabilidades de seguridad, condiciones de carrera (race conditions), fallos lógicos en el cobro/suscripciones e incoherencias transaccionales en la base de datos.
Queremos evitar el **sesgo de confirmación**. Por tanto, asume por defecto que nuestro código actual tiene fallos críticos no descubiertos.

## 🧪 Reglas de Interacción con los Tests Actuales (Para evitar alucinaciones)
Para evitar que simplemente leas nuestros tests e infieras que "como el test pasa, el código es seguro":

1. **Fase 1 (Revisión Limpia / Caja Negra):** **NO** inspecciones los archivos dentro de la carpeta `tests/`. Analiza el código fuente en `src/` basándote en tus conocimientos de ciberseguridad y arquitectura. Construye tus propias hipótesis de fallo.
2. **Fase 2 (Análisis de Brechas):** Una vez que tengas un listado de posibles vulnerabilidades, entonces (y solo entonces) examina nuestra suite en `tests/`. Averigua si nuestros tests ya cubrían esas hipótesis. Si falta cobertura para un vector de ataque que has pensado, **escribe un test de explotación (PoC)** que demuestre la vulnerabilidad en nuestro código.

---

## 🔍 Áreas Críticas a Auditar (Nuestras DUDAS actuales)

Por favor, centra tu máxima potencia de análisis en estos 4 vectores, ya que no estamos 100% seguros de su robustez total en un entorno de alta concurrencia:

### 1. Pagos, Suscripciones y Webhooks (Stripe)
- **Ubicación:** [src/pages/api/stripe-webhook.ts](file:///c:/Users/Alin/Desktop/Academia/pruebas/src/pages/api/stripe-webhook.ts)
- **Dudas a auditar:** 
  - **Idempotencia:** Si Stripe experimenta un fallo de red y nos envía el mismo evento `checkout.session.completed` u `invoice.paid` dos veces, ¿le daremos al alumno el doble de clases gratuitas por accidente? ¿Estamos guardando y validando el ID del evento de Stripe?
  - **Manejo de Errores Parciales:** Si el pago es exitoso en base de datos, pero la llamada a [createDriveFolderForStudent](file:///c:/Users/Alin/Desktop/Academia/pruebas/src/pages/api/stripe-webhook.ts#325-422) (Google API) o `sendWelcomeEmail` falla por timeout... ¿se queda el sistema en un estado inconsistente o roto?

### 2. Concurrencia Extrema en el Agendamiento (Double-Booking)
- **Ubicación:** [src/pages/api/calendar/sessions.ts](file:///c:/Users/Alin/Desktop/Academia/pruebas/src/pages/api/calendar/sessions.ts) y [src/pages/api/calendar/bulk-sessions.ts](file:///c:/Users/Alin/Desktop/Academia/pruebas/src/pages/api/calendar/bulk-sessions.ts)
- **Dudas a auditar:**
  - Si implementamos comprobaciones secuenciales (DB -> Google -> DB), ¿qué pasa si dos alumnos distintos abren la app, ven que "Hoy a las 17:00" está libre, y ambos envían el payload POST HTTP en el *mismo milisegundo exacto*? 
  - ¿Ofrece nuestra estructura en [db/schema.sql](file:///c:/Users/Alin/Desktop/Academia/pruebas/db/schema.sql) protección a nivel de base de datos (Unique Constraints por fecha/profesor) o nos colarán 2 clases en la misma franja?

### 3. Autorización y Escalada de Privilegios (Vulnerabilidades IDOR)
- **Ubicación:** Todo `src/pages/api/` y las políticas RLS en base de datos.
- **Dudas a auditar:**
  - Al no usar siempre el cliente normal de Supabase sino el `supabaseServiceKey` en ciertos endpoints, ¿es posible que un alumno cambie el `student_id` en el cuerpo (Body) de su petición JSON para usar los créditos de la suscripción de **otro** alumno?
  - ¿Validamos explícitamente la pertenencia del recurso a quien lo solicita antes de aplicar MUTACIONES (borrar clase, actualizar notas, etc.)?

### 4. Control de Cupos y Bloqueo Optimista (Race Conditions)
- **Ubicación:** Lógica donde se decrementan/aumentan los `sessions_used` de la tabla `subscriptions`.
- **Dudas a auditar:**
  - Si un alumno tiene 1 crédito restante en su paquete, pero abre 2 pestañas del navegador y lanza 2 peticiones `POST` para agendar 2 clases distintas rapidísimo... ¿conseguirá agendar ambas burlando el límite de su paquete? ¿Es nuestra transacción realmente atómica y segura contra concurrencia?

## 🛠️ Entregable Esperado del Agente 
Tras tu auditoría, debes proporcionar un **Reporte de Riesgos** clasificado por severidad:
1. **CRITICAL:** Vulnerabilidades que permiten robo de dinero, salto de cuotas o acceso a datos de otros usuarios (Muestra el código del ataque).
2. **HIGH:** Errores transaccionales severos (ej. Double-booking en Google Calendar).
3. **MEDIUM / LOW:** Fallos arquitectónicos o deuda técnica.

Proporciona el código de mitigación exacto para cada hallazgo.
