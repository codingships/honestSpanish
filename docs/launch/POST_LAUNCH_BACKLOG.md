# Post Launch Backlog

Estado: backlog vivo para piezas deliberadamente fuera del Release Candidate.

Este documento no desbloquea el Launch Gate. Sirve para que las tareas aplazadas no se mezclen con Go/No-Go, legal, pagos live, rotacion de claves o smoke final.

## Antes De Go/No-Go Solo Si Cambia La Decision

Estas tareas no son bloqueantes mientras se mantenga la decision actual. Si se activan antes del lanzamiento publico, pasan a requerir revision de contenido, legal, privacidad o integraciones.

| Tarea | Estado | Condicion para moverla a launch |
| --- | --- | --- |
| Reviews/testimonios | Pospuesta | Tener resenas reales y permiso para publicarlas; revisar copy y evidencia. |
| Canal publico de Telegram | Pospuesta | Crear canal, decidir politica editorial/moderacion y enlazar solo si hay mantenimiento. |
| Telemetria de uso | Pospuesta | Definir herramienta, eventos minimos, base legal, cookies/consentimiento, retencion y politica de privacidad. No confundir con Sentry: Sentry queda para errores tecnicos, no analitica de producto. |
| Prueba de nivel definitiva | Pospuesta | La solicitud de plaza no es una prueba de nivel definitiva; solo recoge nivel aproximado y contexto de encaje. Si se activa una prueba formal, seguir `docs/launch/LEVEL_CHECK.md`: documento breve + video/audio asincrono revisado manualmente. Antes de publicarla, revisar privacidad, consentimiento, retencion, canal de envio y rubricacion. |
| Stripe live | Final-only | Activar solo si se aceptan pagos reales; cerrar `payments_staging` e `integration_readiness`. |
| Rotacion final de claves | Final-only | Ejecutar justo antes de Go/No-Go y registrar evidencia no secreta. |
| Fuente rusa premium | Final-only | Comprar/licenciar la familia oficial con soporte cirilico o aceptar fallback antes de cerrar `seo_llm_final`; no guardar fuentes comerciales sin licencia, facturas ni datos fiscales en el repo. |
| SEO/LLM final | Final-only | Cerrar tras dominio, legal, copy y modo de pagos definitivos usando `docs/launch/SEO_LLM_FINAL.md`. |

## Contenido Y Marketing

| Tarea | Estado | Notas |
| --- | --- | --- |
| Comprar fuente y factura | Final-only | No afecta al runtime mientras el ruso sea legible y Alin acepte el fallback para RC; antes de Go/No-Go, comprar/licenciar la familia oficial con soporte cirilico o registrar fallback aceptado. No guardar factura ni datos fiscales en el repo. |
| Foto de Alex | Revisada parcialmente | Si el problema era resolucion, queda hecho; si se quiere cambio estetico, tratar como contenido final. |
| Blog profesional ES | Draft | Los articulos incompletos con notas de redactor quedan con `draft: true` y fuera de blog/RSS/sitemap/rutas publicas. |
| Resenas | Pospuesta | No inventar prueba social; usar solo testimonios reales con autorizacion. |

## Operacion E Integraciones

| Tarea | Estado | Notas |
| --- | --- | --- |
| Calendar de `fernandialejandro@gmail.com` | Decision documentada, configuracion final pendiente | Seguir `docs/launch/GOOGLE_CALENDAR_ACCOUNT.md`: si basta con usarlo como `profiles.email`, no hace falta cambio de codigo; si debe ser distinto del login/perfil, crear `calendar_email` con migracion y pruebas antes de production. Probar en staging antes de production. |
| Google Drive/template final | Final-only | Validar con smoke real antes de production; no usar datos reales durante RC si no hace falta. |
| Production Workers activos | Final-only | El RC prepara Fulfillment y web en bootstrap inerte. Secretos de proveedores, Cron, runtime activo, rutas/DNS y smoke real se validan solo en la ventana final. |
| Backup/export Supabase Free final | Final-only | El backup EFS previo al rollout production inerte es un requisito RC separado. En la ventana final, seguir `docs/launch/SUPABASE_BACKUP_RUNBOOK.md` para confirmar un backup/export vigente fuera del repo, upgrade Pro o accepted risk antes de la publicación definitiva. |
| Cloudflare Worker legacy `espanol-honesto-reminders` | Cerrado/neutralizado | El 2026-07-14 se retiró su Cron y se desactivaron `workers.dev` y Preview URLs; conserva Worker, versiones y bindings, sin rutas ni dominios. No requiere otra decisión salvo que se quiera eliminarlo después del lanzamiento. |
| Supabase leaked password protection | Recomendado antes de launch | Supabase Advisor lo marca desactivado en staging y production. Activarlo desde Auth si no rompe el flujo, o registrar accepted risk con seguimiento. |
| Supabase extension `btree_gist` en `public` | Backlog/riesgo aceptado | Supabase Advisor recomienda mover extensiones fuera de `public`. Hacerlo solo con migracion probada; si no se toca antes de launch, registrar riesgo o backlog. |
| Stripe MCP listados | No bloqueante | La cuenta Stripe autentica, pero los listados desde el MCP fallan con `Unknown tool`. Cerrar pagos con dashboard, checkout test/live, webhook delivery y reconciliacion Supabase, no con este conector. |

## Reglas

- No activar telemetria sin revisar legal/cookies/consentimiento.
- No publicar reviews sin fuente real y permiso.
- No enlazar Telegram si no hay canal y politica minima de moderacion.
- No reactivar articulos draft hasta eliminar notas de redactor, plantillas vacias y lorem ipsum.
- Si una tarea de este backlog entra al lanzamiento, actualizar `docs/launch/CHECKLIST.md`, ejecutar el comando de soporte correspondiente y volver a correr `pnpm launch:gate`.
