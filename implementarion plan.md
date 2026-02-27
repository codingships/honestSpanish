Fase 10: Expandiendo el Core del Negocio (Propuesta)
La aplicación ha alcanzado un grado de madurez alto en cuanto a UI Pública, SEO, y Flujos de Autenticación. El embudo de ventas (Stripe -> Emails -> Tablero de Estudiante) está blindado con SSR y RLS.

Basado en la 
Auditoría Técnica
 y los huecos restantes del proyecto, propongo 3 caminos distintos para la Fase 10. Necesito que elijas cuál tiene más prioridad de negocio para ti ahora mismo:

Opción A: Visibilidad y Analítica Avanzada (Marketing)
Actualmente, la plataforma es invisible al trackeo. Si inviertes en anuncios o SEO, no sabrás qué convierte.

Implementación de Plausible o Google Analytics: Inyección de scripts respetuosos con GDPR en 
BaseLayout.astro
.
Rastreo de Conversión: Disparar un evento genérico ('Lead_Generated') cuando el Turnstile da el OK en la API.
Webhook de Stripe a Slack/Discord: Una alerta en tiempo real cuando un alumno compra un paquete.
Opción B: Pulido de Dashboards Internos (Operaciones)
Los paneles de Profesor y Administrador funcionan, pero tienen pequeñas grietas heredadas de las fases rápidas.

Localización Completa (i18n): Eliminar textos harcodeados en español (ej. Objetivo de Facturación, No hay Pagos) en 
admin/index.astro
.
Panel de Profesores Real: Conectar la métrica fantasma (—) del total de sesiones completadas de los verdaderos alumnos (ahora mismo está a cero, ver línea 142 de 
teacher/index.astro
). En el reporte de auditoría también vimos la falta de funcionalidad real para Notas.
Gestión de Leads (Min-CRM): Una pestaña en el panel de Admin para ver todos los correos capturados por el Lead Magnet en una tabla interactiva, con botón de "Marcar como Contactado".
Opción C: Robustez de la Infraestructura y Testing E2E
Como vimos hace unas horas, el Server Side Rendering tiene la ventaja de la seguridad pero está expuesto a caídas críticas (Supabase Cookies).

Integración de Sentry o Logtail: Capturar cualquier error 500 silencioso y mandarlo a tu correo al instante.
Tests End-to-End con Playwright (Skill Automático): Instalar el Framework y crear 3 tests automáticos que simulen a un jugador fantasma local haciendo (1) Login, (2) Intento de Compra (Stripe Test), y (3) Rellenado de Formulario Lead. Si uno falla, el test de GitHub rechaza la subida a Cloudflare.
Seeding de BBDD: Crear un script local que te genere 10 perfiles (Admins, Profes, Alumnos con subs caducadas) para poder prototipar sin depender de tu propia base de datos remota real de Supabase.
IMPORTANT

Tu Decisión Requerida: Responde con "A", "B" o "C" (o solicita una combinación de tareas) para generar la checklist final en 
task.md
 y empezar a teclear el código.