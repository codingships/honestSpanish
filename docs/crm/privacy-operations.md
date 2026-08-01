# CRM Privacy Operations Runbook

Estado: operativo-tecnico, pendiente de revision legal humana antes de produccion real.

Este documento no sustituye asesoramiento legal. Convierte los requisitos habituales de proteccion de datos en controles tecnicos y tareas de operacion para el CRM custom.

Fuentes oficiales de referencia:

- AEPD: [Ejerce tus derechos](https://www.aepd.es/derechos-y-deberes/ejerce-tus-derechos)
- Comision Europea: [Data protection](https://commission.europa.eu/law/law-topic/data-protection_en)
- EDPB: [SME data protection guide - respect individuals' rights](https://www.edpb.europa.eu/sme-data-protection-guide/respect-individuals-rights_en)

## Principios Operativos

- Minimizacion: guardar solo los datos necesarios para relacion comercial, docencia, soporte, pagos y cumplimiento.
- Separacion de dominios: `profiles`, pagos, sesiones y soporte siguen siendo fuente de verdad de su area; CRM guarda memoria relacional.
- Acceso limitado: CRM es admin-only mediante RLS y APIs servidor/admin. No exponer service role al cliente.
- Trazabilidad: cambios de CRM importantes escriben `admin_audit_log`; memoria de relacion escribe `crm_activities`.
- Consentimiento granular: canal + finalidad + base legal viven en `crm_consents`.
- Opt-out duro: una fila con `opted_out_at` bloquea contacto saliente comercial/marketing por ese canal/finalidad.
- Revision manual: si falta base legal o esta marcada como `manual_review_required`, no hay automatizacion; los logs manuales exigen motivo explicito.
- No campanas antiguas: importacion de emails antiguos y envios masivos siguen fuera de alcance.

## Datos CRM

Datos personales gestionados por CRM:

- Identidad/contacto: nombre, email, telefono, idioma, pais, zona horaria.
- Relacion comercial: etapa lifecycle, oportunidades, interes, nivel, objetivo, disponibilidad, paquete preferido.
- Operacion: tareas, follow-ups, soporte vinculado, pagos fallidos, renovaciones, clases relevantes.
- Comunicacion: notas internas y logs manuales de email, llamada o WhatsApp.
- Consentimiento/procedencia: canal, finalidad, base legal, origen, prueba, version de aviso, opt-out.
- Atribucion minima: ruta local, clase de referidor, host externo o ruta interna reducidos, idioma y los cinco UTM permitidos, siempre enlazados a una conversion real.

Datos que no deben guardarse en CRM:

- Secretos, claves, tokens, contrasenas o claves API.
- Documentos privados completos si basta con referencia operativa.
- Datos academicos sensibles que pertenezcan a notas docentes privadas.
- Listas antiguas importadas sin procedencia y revision legal.
- URLs completas, queries sin filtrar, click IDs publicitarios, IP, user-agent o identificadores persistentes dentro de la atribucion.

## Derechos De Personas

El CRM debe poder responder a estos derechos con procedimiento manual verificable:

- Informacion: indicar responsable, finalidades, bases legales, destinatarios/proveedores, retencion y canal de derechos.
- Acceso/exportacion: localizar contacto por email/perfil y exportar JSON/CSV con `crm_contacts`, oportunidades, tareas, actividades, consentimientos y referencias operativas.
- Rectificacion: corregir datos de `crm_contacts` y, si aplica, `profiles`; registrar nota/audit cuando el cambio sea material.
- Supresion: borrar o anonimizar solo cuando no exista obligacion operativa, contractual, fiscal, contable o de defensa de reclamaciones. Si no se puede borrar todo, restringir contacto y documentar razon.
- Limitacion: marcar consentimiento como `manual_review_required` u opt-out, pausar tareas abiertas y evitar nuevos contactos salientes.
- Portabilidad: entregar datos aportados por la persona en formato comun y legible por maquina.
- Oposicion/retirada: registrar opt-out por canal/finalidad y cerrar tareas comerciales incompatibles.
- No automatizacion: no hay decisiones automatizadas significativas en CRM v1.

## Procedimiento Manual

1. Recibir la solicitud por el canal legal/de privacidad aprobado; si aún no está definido, detenerse según `docs/PRODUCT.md`.
2. Verificar identidad sin pedir mas datos de los necesarios.
3. Buscar por email normalizado en `crm_contacts.primary_email` y `profiles.email`.
4. Crear una tarea CRM de tipo `admin` con prioridad alta y vencimiento interno.
5. Exportar o revisar datos segun derecho solicitado.
6. Aplicar cambios con APIs/admin UI, nunca con scripts ad hoc sobre produccion sin backup.
7. Registrar resultado en `admin_audit_log` y, si aporta contexto relacional, en `crm_activities`.
8. Responder por el canal autorizado y guardar solo evidencia minima.

## Estado Tecnico Actual

Implementado:

- RLS habilitado en `crm_contacts`, `crm_opportunities`, `crm_tasks`, `crm_activities` y `crm_consents`.
- Politicas admin-only para gestionar tablas CRM.
- `crm_consents` con canal, finalidad, base legal, prueba, version de aviso y opt-out.
- `admin_audit_log` separado de `crm_activities`.
- Acciones admin para crear notas, tareas, consentimientos, opt-out y comunicaciones manuales.
- Comunicaciones salientes de ventas/marketing comprueban el ultimo consentimiento por canal/finalidad.
- Opt-out bloquea comunicacion saliente de ventas/marketing.
- Falta o revision manual de base legal exige motivo explicito para log manual.
- Atribucion append-only solo en solicitud, diagnostico o checkout; no usa cookies, `localStorage` ni `sessionStorage` de marketing y no bloquea la operacion principal.
- UTM, ruta y referidor se normalizan en cliente y de nuevo en servidor; el referidor externo conserva solo el host.

Pendiente antes de produccion real:

- Revision legal de responsable, bases legales, textos de privacidad y plazos de conservacion.
- UI o script controlado para exportar datos de un contacto.
- Procedimiento controlado de borrado/anonimizacion con lista de tablas afectadas.
- Retention policy confirmada por tipo de dato.
- Registro de subprocesadores definitivo en politica de privacidad.
- Decision sobre analitica/cookies si se activa medicion adicional.
- Inclusion de `acquisition_attribution_events` en exportacion, supresion/anonimizacion y plazos concretos de retencion.

## Retencion

Hasta revision legal, no aplicar borrados automaticos. Usar estos estados operativos:

- Lead no convertido: mantener mientras exista interes razonable o base legal; revisar periodicamente.
- Alumno activo/cliente: mantener datos operativos necesarios para prestar servicio.
- Alumno antiguo: conservar historial minimo de relacion y pagos segun obligaciones aplicables; restringir marketing si no hay base legal.
- Soporte/pagos: conservar segun necesidades contractuales, contables, antifraude o reclamaciones.
- Consentimiento/opt-out: conservar evidencia minima para demostrar preferencia y no volver a contactar indebidamente.

La politica final debe fijar plazos concretos por categoria y pais aplicable.
