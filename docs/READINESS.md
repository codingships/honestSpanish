# Estado verificable del producto

Este archivo es un índice, no una segunda fuente de verdad. Código, migraciones, pruebas, GitHub y el comportamiento del SHA desplegado siguen siendo la evidencia. Se actualiza solo cuando una PR cambia realmente una capacidad.

## Cómo leerlo

- `PENDIENTE`: la capacidad aún no existe.
- `PARCIAL`: existe una parte útil, pero no satisface el recorrido completo.
- `IMPLEMENTADO`: existe en código o configuración y tiene verificación focal.
- `VERIFICADO`: además está integrado y la evidencia enlazada identifica un SHA concreto.
- `DESCONOCIDO`: falta una medición o comprobación necesaria para afirmarlo.
- `GATE HUMANO`: exige una decisión o validación que no debe automatizarse.

Una fila solo usa `VERIFICADO` cuando nombra evidencia para el mismo SHA. Los detalles viven en la PR, el job, la prueba, la migración o el runbook enlazados; no se copian aquí.

## Línea base acreditada

- Repositorio: `codingships/honestSpanish`.
- Último `main` y staging acreditados antes de este programa: `21c1f21373454526f43ee653075ab50d082f7f5f`.
- Evidencia: [CI, despliegue y smoke exactos](https://github.com/codingships/honestSpanish/actions/runs/30764154143).
- Producción no forma parte de esta acreditación.

## Capacidades

| ID | Capacidad | Estado | Evidencia nativa | Falta para cerrar |
|---|---|---|---|---|
| R01 | Autoridad de `origin/main` y despliegue del SHA exacto | VERIFICADO | [`AGENTS.md`](../AGENTS.md), [`deploy-staging.yml`](../.github/workflows/deploy-staging.yml), [run `21c1f213`](https://github.com/codingships/honestSpanish/actions/runs/30764154143) | Mantener el mismo contrato en cada despliegue. |
| R02 | CI proporcional con gate único | IMPLEMENTADO | [`ci.yml`](../.github/workflows/ci.yml), [`classify-changes.ts`](../scripts/ci/classify-changes.ts), [pruebas](../tests/unit/ci-change-classifier.test.ts) | Acreditar la PR en GitHub y hacer requerido `quality-gate`. |
| R03 | Historial pequeño y recuperable de capacidades | IMPLEMENTADO | Este archivo y [plantilla de PR](../.github/pull_request_template.md) | Registrar solo cambios reales, sin crear informes paralelos. |
| P01 | Oferta inicial 1:1 de 4 × 50 min, 259 EUR, ciclo de 28 días | IMPLEMENTADO | [`PRODUCT.md`](PRODUCT.md), [`package-pricing.ts`](../src/lib/package-pricing.ts), [contrato SQL](../tests/sql/checkout-v2-billing-foundation.sql) | Verificar compra pública normal de extremo a extremo en Sandbox. |
| P02 | Catálogo versionado y snapshots históricos | IMPLEMENTADO | [`ARCHITECTURE.md`](../ARCHITECTURE.md), [`package_prices`](../db/schema.sql), [API de paquetes](../src/pages/api/admin/packages.ts) | La administración V2 todavía no permite gestionar la oferta vigente. |
| P03 | Catálogo V2 manejable sin programar | PENDIENTE | La [API actual](../src/pages/api/admin/packages.ts) limita edición y sincronización a V1 | Crear borrador, validación, preview, publicación y retirada versionada. |
| P04 | Garantía proporcional para cualquier paquete/ciclo | PARCIAL | Regla objetivo en [`PRODUCT.md`](PRODUCT.md); implementación actual en [`checkout-v2-guarantee.ts`](../src/lib/checkout-v2-guarantee.ts) | Sustituir la ventana e importe fijos por unidades no consumidas del snapshot y verificar todas las posiciones. |
| C01 | CMS estructurado para páginas, SEO, navegación y FAQ | PENDIENTE | El contenido público permanece principalmente en [`translations.ts`](../src/i18n/translations.ts) y componentes | Añadir borrador, preview, publicación, rollback y medios seguros. |
| C02 | Blog editable y conectado al producto | PARCIAL | [Configuración Keystatic](../keystatic.config.ts), [páginas de blog](../src/pages/[lang]/blog) | Sustituir almacenamiento local para editores, integrar navegación y medir conversión. |
| C03 | Emails editables de forma segura | PARCIAL | [Plantillas](../src/lib/email/templates.ts), [gestor administrativo](../src/components/admin/EmailTemplateManager.tsx) | Versionado, permisos, preview real y publicación; hoy el gestor no edita. |
| A01 | Autenticación y roles básicos | IMPLEMENTADO | [`middleware.ts`](../src/middleware.ts), [`profiles.role`](../db/schema.sql), [pruebas auth/RBAC](../tests/unit) | Revisar autorización completa de rutas y sesiones expiradas. |
| A02 | Permisos administrativos granulares | PENDIENTE | El modelo actual distingue `student`, `teacher` y `admin` | Separar owner, contenido, catálogo, operaciones, finanzas y lectura. |
| A03 | Historial administrativo visible | PARCIAL | [`admin_audit_log`](../db/schema.sql) | Cubrir mutaciones relevantes y ofrecer consulta/filtrado en admin. |
| U01 | UX/UI pública coherente en escritorio y móvil | PARCIAL | [Componentes públicos](../src/components), [E2E público](../tests/e2e) | Corregir menú móvil, jerarquía, formulario sin JS, confianza y estados. |
| U02 | Tipografía coherente ES/EN/RU | PARCIAL | [Fuentes y estilos](../src/styles), [`translations.ts`](../src/i18n/translations.ts) | Corregir cobertura cirílica y fallbacks; comprobar visualmente las plantillas. |
| U03 | Accesibilidad WCAG 2.2 AA proporcional | DESCONOCIDO | Axe está disponible en dependencias y existen pruebas públicas | Completar teclado, foco, reflow, contraste, errores, idiomas y lector de pantalla mínimo. |
| U04 | Rendimiento con presupuesto basado en medición | PARCIAL | [Aplicación Astro](../astro.config.mjs), [workflow de CI](../.github/workflows/ci.yml) | Optimizar fuentes e imágenes y conservar Lighthouse reproducible; faltan datos de campo. |
| S01 | SEO técnico e internacionalización | PARCIAL | [`public-seo.ts`](../src/lib/public-seo.ts), [sitemap/RSS](../src/pages) | Conectar captación inglesa, canonicals/hreflang y validar indexabilidad de producción. |
| B01 | Checkout público, duplicados y fallos de pago | PARCIAL | [`create-checkout.ts`](../src/pages/api/create-checkout.ts), [`stripe-webhook.ts`](../src/pages/api/stripe-webhook.ts), [pruebas](../tests/unit) | Diferenciar y acreditar compra pública normal frente al checkout sintético privilegiado. |
| B02 | Renovación anclada a la primera clase | IMPLEMENTADO | [`PRODUCT.md`](PRODUCT.md), [contrato Checkout V2](../src/lib/checkout-v2.ts), [contrato SQL](../tests/sql/checkout-v2-billing-foundation.sql) | Verificar cambio de primera fecha y renovación completa en Sandbox. |
| B03 | Reprogramación, cancelación tardía y no-show | IMPLEMENTADO | [API de calendario](../src/pages/api/calendar), [progreso de ciclo](../tests/sql/checkout-v2-cycle-progress.sql) | Acreditar recorridos completos y correcciones de soporte en staging. |
| O01 | Alta, disponibilidad y asignación de profesores | IMPLEMENTADO | [API de profesores/plazas](../src/pages/api/admin/teachers-slots.ts), [contratos SQL](../tests/sql/admin-teacher-bookable-slot-operations.sql) | Mejorar permisos y validar operación humana completa. |
| O02 | Fulfillment duradero, Queue y DLQ | VERIFICADO | [`ARCHITECTURE.md`](../ARCHITECTURE.md), [Worker](../workers/fulfillment), [run `21c1f213`](https://github.com/codingships/honestSpanish/actions/runs/30764154143) | Añadir señales y alertas operativas accionables. |
| O03 | Soporte y recuperación de efectos parciales | IMPLEMENTADO | [API de soporte](../src/pages/api/admin/support-tickets.ts), [contrato SQL](../tests/sql/support-operations.sql), [`OPERATIONS.md`](OPERATIONS.md) | Completar runbooks y simulacros de incidentes principales. |
| O04 | Obligación y liquidación docente | IMPLEMENTADO | [API de compensación](../src/pages/api/admin/teacher-compensation.ts), [contratos SQL](../tests/sql/teacher-compensation-settlements.sql) | Validar flujo humano de factura/transferencia; no ejecutar pagos desde la plataforma. |
| O05 | Rentabilidad por alumno y campaña | PARCIAL | [vistas económicas](../db/schema.sql), [contrato SQL](../tests/sql/provisional-unit-economics.sql) | Añadir comisiones conciliadas y costes acordados sin fingir contabilidad fiscal. |
| M01 | Captación, UTM y conversión mínima | IMPLEMENTADO | [`acquisition_attribution_events`](../db/schema.sql), [contrato SQL](../tests/sql/acquisition-attribution-foundation.sql) | Verificar funnel/consentimiento y reporting accionable antes de campañas. |
| R04 | Observabilidad y alertas accionables | PARCIAL | [Sentry](../astro.config.mjs), [`OPERATIONS.md`](OPERATIONS.md), [fulfillment](../workers/fulfillment) | Acreditar alertas, responsables, correlación y ausencia de PII. |
| R05 | Backup y restauración ensayada | DESCONOCIDO | Reglas generales en [`OPERATIONS.md`](OPERATIONS.md) | Documentar RPO/RTO y ejecutar restauración inocua en staging. |
| R06 | Capacidad para 1.000 alumnos activos | DESCONOCIDO | Existen lotes y límites en [`ARCHITECTURE.md`](../ARCHITECTURE.md) | Medir carga realista, margen, límites y coste; no inferir capacidad. |
| G01 | Producción, Stripe live, DNS, correo real y primer alumno | GATE HUMANO | [`ENVIRONMENTS.md`](ENVIRONMENTS.md), [`OPERATIONS.md`](OPERATIONS.md) | Revisión jurídica/fiscal, checklist live y autorización explícita de producción. |

## Hitos integrados

| Resultado | PR | SHA integrado | Staging |
|---|---|---|---|
| Baseline técnico recuperado y despliegue seguro acreditado | [#60](https://github.com/codingships/honestSpanish/pull/60) | `21c1f21373454526f43ee653075ab50d082f7f5f` | [CI + despliegue + smoke](https://github.com/codingships/honestSpanish/actions/runs/30764154143) |

El siguiente hito se añade cuando la PR esté integrada y, si cambia runtime, cuando el mismo SHA quede acreditado en staging. GitHub conserva el detalle; esta tabla no lo duplica.
