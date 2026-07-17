# CRM Verification Evidence

Fecha: 2026-06-24.

## Estado Del Alcance

Implementado dentro del admin existente:

- Guardarrailes visuales del admin: tokens, style guard y snapshots admin.
- Modelo CRM v1: contactos, oportunidades, tareas, actividades, consentimientos y enlaces con leads/perfiles.
- Dashboard admin como centro diario: tareas, nuevos leads, soporte, pagos fallidos, renovaciones, clases y riesgo de retencion/pago.
- CRM Leads como pipeline operativo con resumen de conversion por fuente/etapa.
- Ficha central de contacto y ficha de alumno con pipeline, tareas, consentimiento y timeline unificado.
- Acciones manuales: notas internas, tareas, etapas, recuperacion de pagos, renovaciones, soporte rapido, consentimiento, opt-out y comunicacion manual email/llamada/WhatsApp.
- Privacidad operativa: runbook CRM, opt-out duro, revision manual, fuentes oficiales enlazadas y test de contrato.

Fuera de alcance por decision actual:

- Cambio a HubSpot/Salesforce.
- Campanas masivas.
- Importacion de emails antiguos.
- Automatizaciones de secuencias.
- Envio real de emails/WhatsApps desde CRM.

Pendiente no bloqueante para CRM v1, pero necesario antes de produccion real:

- Revision legal humana de responsable, bases legales, subprocesadores y plazos de conservacion.
- Herramienta dedicada de exportacion/borrado/anonimizacion de datos.
- Filtro de owner/equipo cuando el socio use el admin con regularidad.

## Comandos Ejecutados

Pasaron:

```bash
pnpm --config.verify-deps-before-run=false exec vitest run tests/api/admin-leads.test.ts tests/api/admin-support-tickets.test.ts tests/api/admin-crm-contact-actions.test.ts tests/unit/crm-activity-sync.test.ts tests/unit/crm-admin-dashboard.test.ts tests/unit/crm-contact-detail.test.ts tests/unit/crm-consent-manager.test.tsx tests/unit/crm-contact-actions.test.tsx tests/unit/crm-opportunity-list.test.tsx tests/unit/crm-task-list.test.tsx tests/unit/lead-manager-source.test.ts tests/unit/payment-recovery-actions.test.tsx tests/unit/subscription-renewal-actions.test.tsx tests/unit/support-ticket-quick-actions.test.tsx tests/unit/database-schema-invariants.test.ts tests/unit/crm-privacy-operations.test.ts --coverage=false
pnpm --config.verify-deps-before-run=false exec vitest run tests/api/admin-crm-contact-actions.test.ts tests/unit/crm-contact-actions.test.tsx --coverage=false
pnpm --config.verify-deps-before-run=false exec vitest run tests/api/admin-crm-contact-actions.test.ts tests/unit/crm-contact-actions.test.tsx tests/unit/crm-privacy-operations.test.ts --coverage=false
pnpm --config.verify-deps-before-run=false typecheck
pnpm --config.verify-deps-before-run=false style:admin
pnpm --config.verify-deps-before-run=false build
pnpm --config.verify-deps-before-run=false test:e2e:admin-visual
pnpm --config.verify-deps-before-run=false exec playwright test tests/e2e/admin.admin.spec.ts --project=admin --no-deps --workers=1
git diff --check
```

Notas:

- `git diff --check` no mostro errores de whitespace; solo avisos CRLF de Windows en archivos ya presentes.
- `pnpm typecheck` sin override fallo por `ERR_PNPM_VERIFY_DEPS_BEFORE_RUN` debido a estado lockfile/node_modules del repo. Los checks se ejecutaron con `--config.verify-deps-before-run=false` para verificar el cambio sin tocar dependencias.
- `pnpm test:e2e:admin-visual` completo paso despues de reintento: `admin-setup` autentico y las cuatro capturas admin pasaron.

## Evidencia De Cobertura

- API CRM: `tests/api/admin-crm-contact-actions.test.ts`
- UI acciones contacto: `tests/unit/crm-contact-actions.test.tsx`
- Privacidad operativa: `tests/unit/crm-privacy-operations.test.ts`
- Invariantes DB CRM: `tests/unit/database-schema-invariants.test.ts`
- Visual admin: `tests/e2e/admin-visual.admin.spec.ts`
- E2E admin funcional: `tests/e2e/admin.admin.spec.ts`

## Riesgos Aceptados

- El CRM registra comunicaciones manuales; no envia comunicaciones.
- Las bases legales finales y plazos de retencion requieren revision humana.
- La herramienta dedicada de exportacion/borrado/anonimizacion queda como mejora futura antes de produccion real.
