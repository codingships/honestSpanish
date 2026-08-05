# Estado verificable del producto

Este archivo es un Ã­ndice, no una segunda fuente de verdad. CÃ³digo, migraciones, pruebas, GitHub y el comportamiento del SHA desplegado siguen siendo la evidencia. Se actualiza solo cuando una PR cambia realmente una capacidad.

## CÃ³mo leerlo

- `PENDIENTE`: la capacidad aÃºn no existe.
- `PARCIAL`: existe una parte Ãºtil, pero no satisface el recorrido completo.
- `IMPLEMENTADO`: existe en cÃ³digo o configuraciÃ³n y tiene verificaciÃ³n focal.
- `VERIFICADO`: ademÃ¡s estÃ¡ integrado y la evidencia enlazada identifica un SHA concreto.
- `DESCONOCIDO`: falta una mediciÃ³n o comprobaciÃ³n necesaria para afirmarlo.
- `GATE HUMANO`: exige una decisiÃ³n o validaciÃ³n que no debe automatizarse.

Una fila solo usa `VERIFICADO` cuando nombra evidencia para el mismo SHA. Los detalles viven en la PR, el job, la prueba, la migraciÃ³n o el runbook enlazados; no se copian aquÃ­.

## LÃ­nea base acreditada

- Repositorio: `codingships/honestSpanish`.
- `origin/main` estÃ¡ en `c8597388c5ba854e92930725aa6a37094634d204`. Su Ãºltimo cambio solo aÃ±ade cobertura del checkout pÃºblico; el Ãºltimo Ã¡rbol de runtime es `3c0f5e55076f80067b2ce377b697569d2cc4cb07`.
- Ãšltimo staging acreditado: `3c0f5e55076f80067b2ce377b697569d2cc4cb07`, con [despliegue y verificaciÃ³n exactos](https://github.com/codingships/honestSpanish/actions/runs/30999777634) en los Workers web y fulfillment al 100 %. La migraciÃ³n `20260805085007` estÃ¡ aplicada Ãºnicamente en Supabase staging.
- El Checkout V2 privilegiado de staging se verificÃ³ sobre el ancestro `1b85baa5d6ac8d75b8cc344e7104e302007bdc89`: reintento idempotente, rechazo, correcciÃ³n, pago Sandbox de 259 EUR, cuatro sesiones, ciclo de 28 dÃ­as y fulfillment. La [PR #89](https://github.com/codingships/honestSpanish/pull/89) protege ademÃ¡s el recorrido de interfaz pÃºblica con integraciones interceptadas; una compra pÃºblica normal contra Stripe Sandbox sigue pendiente y producciÃ³n no forma parte de esta acreditaciÃ³n.

## Capacidades

| ID | Capacidad | Estado | Evidencia nativa | Falta para cerrar |
|---|---|---|---|---|
| R01 | Autoridad de `origin/main` y despliegue del SHA exacto | VERIFICADO | [`AGENTS.md`](../AGENTS.md), [`deploy-staging.yml`](../.github/workflows/deploy-staging.yml), [run del SHA `3c0f5e5`](https://github.com/codingships/honestSpanish/actions/runs/30999777634) | Mantener el mismo contrato en cada despliegue. |
| R02 | CI proporcional con gate Ãºnico | VERIFICADO | [`ci.yml`](../.github/workflows/ci.yml), [`classify-changes.ts`](../scripts/ci/classify-changes.ts), [CI de la PR #89](https://github.com/codingships/honestSpanish/actions/runs/31004602400); `main` exige `quality-gate` | Mantener la clasificaciÃ³n alineada al aÃ±adir superficies nuevas. |
| R03 | Historial pequeÃ±o y recuperable de capacidades | VERIFICADO | Este archivo, [plantilla de PR](../.github/pull_request_template.md) y [PR #61](https://github.com/codingships/honestSpanish/pull/61) | Registrar solo cambios reales, sin crear informes paralelos. |
| P01 | Oferta inicial 1:1 de 4 Ã— 50 min, 259 EUR, ciclo de 28 dÃ­as | IMPLEMENTADO | [`PRODUCT.md`](PRODUCT.md), [`package-pricing.ts`](../src/lib/package-pricing.ts), [contrato SQL](../tests/sql/checkout-v2-billing-foundation.sql) | Verificar compra pÃºblica normal de extremo a extremo en Sandbox. |
| P02 | CatÃ¡logo versionado y snapshots histÃ³ricos | IMPLEMENTADO | [`ARCHITECTURE.md`](../ARCHITECTURE.md), [`package_prices`](../db/schema.sql), [contrato SQL V2](../tests/sql/catalog-v2-admin.sql) | Acreditar la publicaciÃ³n y retirada sobre staging. |
| P03 | CatÃ¡logo V2 manejable sin programar | IMPLEMENTADO | [PR #63](https://github.com/codingships/honestSpanish/pull/63), [gestor V2](../src/components/admin/VersionedCatalogManager.tsx), [API administrada](../src/pages/api/admin/catalog-v2.ts), [migraciÃ³n](../supabase/migrations/20260803171044_catalog_v2_admin_drafts.sql), [pruebas focales](../tests/api/admin-catalog-v2.test.ts) y [staging del descendiente `1706b98`](https://github.com/codingships/honestSpanish/actions/runs/30901236505) | Validar el recorrido humano de publicaciÃ³n y retirada antes de marcarlo `VERIFICADO`. |
| P04 | GarantÃ­a proporcional para cualquier paquete/ciclo | VERIFICADO | [PR #69](https://github.com/codingships/honestSpanish/pull/69), [migraciÃ³n](../supabase/migrations/20260804074456_proportional_checkout_v2_guarantee.sql), [contrato SQL](../tests/sql/checkout-v2-guarantee.sql) y [staging del SHA exacto](https://github.com/codingships/honestSpanish/actions/runs/30901236505) | Acreditar despuÃ©s la devoluciÃ³n completa contra una compra pÃºblica normal en Stripe Sandbox. |
| C01 | CMS estructurado inicial para la home, SEO, navegaciÃ³n y FAQ | PARCIAL | [PR #64](https://github.com/codingships/honestSpanish/pull/64), [gestor](../src/components/admin/CmsContentManager.tsx), [API](../src/pages/api/admin/content.ts), [migraciÃ³n versionada](../supabase/migrations/20260803182652_cms_home_content_workflow.sql), [contrato SQL](../tests/sql/cms-content-workflow.sql) y [staging del descendiente `1706b98`](https://github.com/codingships/honestSpanish/actions/runs/30901236505) | Validar publicaciÃ³n/rollback humano y extender el contrato al resto de pÃ¡ginas y a medios seguros. Blog y emails conservan sus filas separadas. |
| C02 | Blog editable y conectado al producto | PARCIAL | [ConfiguraciÃ³n Keystatic](../keystatic.config.ts), [pÃ¡ginas de blog](../src/pages/[lang]/blog), navegaciÃ³n integrada por [PR #65](https://github.com/codingships/honestSpanish/pull/65) | Sustituir almacenamiento local para editores y medir conversiÃ³n. |
| C03 | Emails editables de forma segura | PARCIAL | [Plantillas](../src/lib/email/templates.ts), [gestor administrativo](../src/components/admin/EmailTemplateManager.tsx) | Versionado, permisos, preview real y publicaciÃ³n; hoy el gestor no edita. |
| A01 | AutenticaciÃ³n y roles bÃ¡sicos | IMPLEMENTADO | [`middleware.ts`](../src/middleware.ts), [`profiles.role`](../db/schema.sql), [retorno compatible con el rol](../src/lib/auth-return-to.ts), [recuperaciÃ³n de sesiÃ³n](../src/lib/campus-session-recovery.ts) y [pruebas auth/RBAC](../tests/unit) | La autorizaciÃ³n privilegiada y la recuperaciÃ³n de sesiÃ³n tienen cobertura focal; falta acreditarlas con una sesiÃ³n expirada real en staging. |
| A02 | Permisos administrativos granulares y alta de personal | IMPLEMENTADO | [`admin-access.ts`](../src/lib/admin-access.ts), [invitaciÃ³n server-only](../src/pages/api/admin/staff-invitations.ts), [gestor](../src/components/admin/AdminAccessManager.tsx), [migraciÃ³n aplicada](../supabase/migrations/20260805085007_secure_staff_promotion.sql), [contrato SQL](../tests/sql/admin-staff-promotion.sql) y [staging exacto `3c0f5e5`](https://github.com/codingships/honestSpanish/actions/runs/30999777634) | La invitaciÃ³n sintÃ©tica al sumidero, la promociÃ³n dentro de una transacciÃ³n revertida y la limpieza pasaron. Falta acreditar una activaciÃ³n persistente completa junto con disponibilidad y publicaciÃ³n de plaza. |
| A03 | Historial administrativo visible | VERIFICADO | Ledger inmutable en [`db/schema.sql`](../db/schema.sql), [API redactada](../src/pages/api/admin/audit.ts), [vista filtrable](../src/components/admin/AdminAuditHistory.tsx) y [staging del SHA `71d7eb7`](https://github.com/codingships/honestSpanish/actions/runs/30834746304) | Ampliar cobertura a nuevas mutaciones cuando se incorporen; la vista Ã­ndice no expone snapshots con PII. |
| U01 | UX/UI pÃºblica coherente en escritorio y mÃ³vil | PARCIAL | [PR #65](https://github.com/codingships/honestSpanish/pull/65), [PR #75](https://github.com/codingships/honestSpanish/pull/75), [E2E pÃºblico](../tests/e2e), [aviso accesible de sesiÃ³n expirada](../src/layouts/CampusLayout.astro), [pruebas focales](../tests/unit/campus-session-recovery.test.ts), [PR #89](https://github.com/codingships/honestSpanish/pull/89) y [staging exacto `3c0f5e5`](https://github.com/codingships/honestSpanish/actions/runs/30999777634) | ES/EN/RU escritorio y ES mÃ³vil no mostraron overflow ni controles ocultos; menÃº, blog y formulario sin JavaScript pasaron. La sesiÃ³n caducada ya conserva un retorno compatible con el rol, pendiente de acreditaciÃ³n en staging; faltan los demÃ¡s recorridos autenticados y sus estados completos. |
| U02 | TipografÃ­a coherente ES/EN/RU | PARCIAL | [PR #66](https://github.com/codingships/honestSpanish/pull/66), [PR #75](https://github.com/codingships/honestSpanish/pull/75), [fuentes autocontenidas](../src/styles/fonts.css), [prueba pÃºblica](../tests/e2e/typography.public.spec.ts) y [staging exacto `3c0f5e5`](https://github.com/codingships/honestSpanish/actions/runs/30999777634) | ES/EN cargan Boldonse; RU carga deliberadamente Unbounded porque la distribuciÃ³n oficial de Boldonse no contiene cirÃ­lico. Igualar exactamente esa voz exige una fuente o extensiÃ³n cirÃ­lica licenciada, no una correcciÃ³n de carga. |
| U03 | Accesibilidad WCAG 2.2 AA proporcional | PARCIAL | [PR #79](https://github.com/codingships/honestSpanish/pull/79), [gate Axe + reflow de siete plantillas](../tests/e2e/accessibility.public.spec.ts), pruebas de teclado/foco en [E2E pÃºblico](../tests/e2e) | El escaneo automÃ¡tico no certifica WCAG: faltan teclado completo de recorridos autenticados, zoom alto y una prueba mÃ­nima con lector de pantalla. |
| U04 | Rendimiento con presupuesto basado en mediciÃ³n | PARCIAL | [PR #88](https://github.com/codingships/honestSpanish/pull/88), [workflow](../.github/workflows/performance-audit.yml) y [artefacto CI del mismo Ã¡rbol](https://github.com/codingships/honestSpanish/actions/runs/30998391469): Worker compilado mÃ³vil, 1 ejecuciÃ³n, Performance 99, LCP 2,06 s, CLS 0,01, TBT 0 ms y 460 KiB | Es un smoke reproducible, no la matriz solicitada. Falta medir 3â€“5 ejecuciones de las plantillas principales sobre el mismo SHA en staging y, cuando exista trÃ¡fico, datos de campo al p75. El runner local fallÃ³ con `ERR_ABORTED`/`EBUSY`; esos ceros no son mÃ©tricas del producto. |
| S01 | SEO tÃ©cnico e internacionalizaciÃ³n | PARCIAL | [`public-seo.ts`](../src/lib/public-seo.ts), [sitemap/RSS](../src/pages) | Conectar captaciÃ³n inglesa, canonicals/hreflang y validar indexabilidad de producciÃ³n. |
| B01 | Checkout pÃºblico, duplicados y fallos de pago | PARCIAL | [`create-checkout.ts`](../src/pages/api/create-checkout.ts), [`stripe-webhook.ts`](../src/pages/api/stripe-webhook.ts), [PR #74](https://github.com/codingships/honestSpanish/pull/74), [staging `1b85baa`](https://github.com/codingships/honestSpanish/actions/runs/30928772960), [PR #89](https://github.com/codingships/honestSpanish/pull/89) y su [CI verde](https://github.com/codingships/honestSpanish/actions/runs/31004602400) | El checkout privilegiado acredita servicios y la prueba pÃºblica acredita la UI con dobles. Falta una compra pÃºblica normal contra Stripe Sandbox sin permiso interno. |
| B02 | RenovaciÃ³n anclada a la primera clase | IMPLEMENTADO | [`PRODUCT.md`](PRODUCT.md), [contrato Checkout V2](../src/lib/checkout-v2.ts), [contrato SQL](../tests/sql/checkout-v2-billing-foundation.sql) | Verificar cambio de primera fecha y renovaciÃ³n completa en Sandbox. |
| B03 | ReprogramaciÃ³n, cancelaciÃ³n tardÃ­a y no-show | IMPLEMENTADO | [API de calendario](../src/pages/api/calendar), [progreso de ciclo](../tests/sql/checkout-v2-cycle-progress.sql) | Acreditar recorridos completos y correcciones de soporte en staging. |
| O01 | Alta, disponibilidad y asignaciÃ³n de profesores | IMPLEMENTADO | [invitaciÃ³n server-only](../src/pages/api/admin/staff-invitations.ts), [API de profesores/plazas](../src/pages/api/admin/teachers-slots.ts), [gestor](../src/components/admin/TeacherSlotManager.tsx), [migraciÃ³n aplicada](../supabase/migrations/20260805085007_secure_staff_promotion.sql) y [contratos SQL](../tests/sql/admin-teacher-bookable-slot-operations.sql) | InvitaciÃ³n y promociÃ³n transaccional sintÃ©ticas pasaron y se limpiaron. Falta acreditar activaciÃ³n persistente, vÃ­nculo, disponibilidad y publicaciÃ³n de una plaza sintÃ©tica. |
| O02 | Fulfillment duradero, Queue y DLQ | VERIFICADO | [`ARCHITECTURE.md`](../ARCHITECTURE.md), [Worker](../workers/fulfillment), [run `21c1f213`](https://github.com/codingships/honestSpanish/actions/runs/30764154143) | AÃ±adir seÃ±ales y alertas operativas accionables. |
| O03 | Soporte y recuperaciÃ³n de efectos parciales | IMPLEMENTADO | [API de soporte](../src/pages/api/admin/support-tickets.ts), [contrato SQL](../tests/sql/support-operations.sql), [`OPERATIONS.md`](OPERATIONS.md) | Completar runbooks y simulacros de incidentes principales. |
| O04 | ObligaciÃ³n y liquidaciÃ³n docente | IMPLEMENTADO | [API de compensaciÃ³n](../src/pages/api/admin/teacher-compensation.ts), [contratos SQL](../tests/sql/teacher-compensation-settlements.sql) | Validar flujo humano de factura/transferencia; no ejecutar pagos desde la plataforma. |
| O05 | Rentabilidad provisional por alumno y campaÃ±a | VERIFICADO | [PR #71](https://github.com/codingships/honestSpanish/pull/71), [migraciÃ³n](../supabase/migrations/20260804144402_stripe_fee_reconciliation.sql), [contrato SQL](../tests/sql/provisional-unit-economics.sql) y [staging del SHA exacto](https://github.com/codingships/honestSpanish/actions/runs/30918352248) | Mantener separados reparto, reserva y fiscalidad: no son beneficio neto ni se infieren desde esta vista. |
| M01 | CaptaciÃ³n, UTM y conversiÃ³n mÃ­nima | IMPLEMENTADO | [`acquisition_attribution_events`](../db/schema.sql), [contrato SQL](../tests/sql/acquisition-attribution-foundation.sql) | Verificar funnel/consentimiento y reporting accionable antes de campaÃ±as. |
| R04 | Observabilidad y alertas accionables | PARCIAL | [Sentry minimizado](../src/lib/sentry-privacy.ts), [fallos operativos correlacionables](../src/lib/operational-error.ts), [`X-Request-ID`](../src/middleware.ts), [pruebas focales](../tests/unit/sentry-privacy.test.ts) y [preflight de reglas](OPERATIONS.md#triaje-y-alertas): dos alertas de producciÃ³n habilitadas con email al operador canÃ³nico, sin disparos; cero eventos de staging en 30 dÃ­as | Enviar un evento sintÃ©tico sin PII, comprobar recepciÃ³n real y confirmar continuidad de acceso a la bandeja. La regla configurada no demuestra por sÃ­ sola la entrega. |
| R05 | Backup y restauraciÃ³n ensayada | PARCIAL | [Runbook y objetivo provisional](OPERATIONS.md#capacidad-y-recuperaciÃ³n); preflight de solo lectura del 4 de agosto de 2026: staging devolviÃ³ `pitr_enabled=false` y ninguna copia disponible | Antes de guardar datos reales: activar copia diaria en el proyecto canÃ³nico o una alternativa externa equivalente y restaurar una copia en un destino inocuo. El plan gratuito actual no satisface el gate. |
| R06 | Capacidad para 1.000 alumnos activos | PARCIAL | [Ensayo local aislado](../scripts/diagnostics~yëËh‘éì¶»§q«^wJNÂˆ^Xİ
[ØÚÜËœœÊKÒ]™P™Y[“Ø[YÚ]
‹	ÙÙ]Û^WØYZ[—ØØ\Xš[]Y\ÉÊNÂˆ^Xİ
™^
K››İÒ]™P™Y[Ø[Y

NÂˆJNÂ‚ˆ]
	ÚÙY\ÈHÚ\™YØ[[™\ˆ›İ]H]˜Z[X›HÈHİY[XİÜ‰Ë\Ş[˜È

HOˆÂˆÛÛœİÈÛ”™\]Y\İHH]ØZ][\Ü
	Ë‹‹Ë‹‹ÜÜ˜ËÛZY]Ø\™IÊNÂˆÛÛœİÛÛ^HZY]Ø\™PÛÛ^
	ËØ\KØØ[[™\‹ÜÙ\ÜÚ[ÛœÉÊNÂˆÛÛœİ™^HšK™›Š
K›[ØÚÔ™\ÛÛ™Y˜[YJ™]È™\ÜÛœÙJ	ŞßIÊJNÂ‚ˆÛÛœİ™\ÜÛœÙHH]ØZ]Û”™\]Y\İ
ÛÛ^\È[K™^
H\È™\ÜÛœÙNÂ‚ˆ^Xİ
™\ÜÛœÙKœİ]\ÊKĞ™JŒ
NÂˆ^Xİ
™^
KÒ]™P™Y[Ø[YÛ˜ÙJ
NÂˆ^Xİ
[ØÚÜËœœÊK››İÒ]™P™Y[Ø[Y

NÂˆJNÂ‚ˆ]
	Ü™\]Z\™\ÈÜ\˜][ÛœËœ™XYÚ[ˆHØ[YHÚ\™YØ[[™\ˆ›İ]H\È\ÙYH[ˆYZ[‰Ë\Ş[˜È

HOˆÂˆ[ØÚÜËœÚ[™ÛK›[ØÚÔ™\ÛÛ™Y˜[YJÈ]NˆÈ›ÛNˆ	ØYZ[‰ÈK\œ›Üˆ[JNÂˆ[ØÚÜËœœË›[ØÚÔ™\ÛÛ™Y˜[YJÈ]Nˆ˜[ÙK\œ›Üˆ[JNÂˆÛÛœİÈÛ”™\]Y\İHH]ØZ][\Ü
	Ë‹‹Ë‹‹ÜÜ˜ËÛZY]Ø\™IÊNÂˆÛÛœİÛÛ^HZY]Ø\™PÛÛ^
	ËØ\KØØ[[™\‹ÜÙ\ÜÚ[ÛœÉÊNÂˆÛÛœİ™^HšK™›Š
NÂ‚ˆÛÛœİ™\ÜÛœÙHH]ØZ]Û”™\]Y\İ
ÛÛ^\È[K™^
H\È™\ÜÛœÙNÂ‚ˆ^Xİ
™\ÜÛœÙKœİ]\ÊKĞ™JÊNÂˆ^Xİ
[ØÚÜËœœÊKÒ]™P™Y[Ø[YÚ]
	Ú\×Û^WØYZ[—ØØ\Xš[]IËÂˆØØ\Xš[]Nˆ	ÛÜ\˜][ÛœËœ™XY	ËˆJNÂˆ^Xİ
™^
K››İÒ]™P™Y[Ø[Y

NÂˆJNÂ‚ˆ]
	Ø›ØÚÜÈ]™\H\XØ][Ûˆ›İ]HÚ[H›ÙXİ[Ûˆ\È[ˆ›Ûİİ˜\[ÙIË\Ş[˜È

HOˆÂˆØš™Xİ˜\ÜÚYÛŠ[ØÚÜËœ[[YQ[‹ÂˆP“P×ĞTÑS•ˆ	Ü›ÙXİ[Û‰ËˆÑP—Ô•S•SQWÓSÑNˆ	Ø›Ûİİ˜\	ËˆJNÂˆÛÛœİÈÛ”™\]Y\İHH]ØZ][\Ü
	Ë‹‹Ë‹‹ÜÜ˜ËÛZY]Ø\™IÊNÂˆÛÛœİÛÛ^HZY]Ø\™PÛÛ^
	ËÙ\ËÛÙÚ[‰ÊNÂˆÛÛœİ™^HšK™›Š
NÂ‚ˆÛÛœİ™\ÜÛœÙHH]ØZ]Û”™\]Y\İ
ÛÛ^\È[K™^
H\È™\ÜÛœÙNÂ‚ˆ^Xİ
™\ÜÛœÙKœİ]\ÊKĞ™JLÊNÂˆ^Xİ
™\ÜÛœÙKšXY\œË™Ù]
	ÖT›Ø›İËUYÉÊJKĞÛÛZ[Š	Û›Ú[™^	ÊNÂˆ]ØZ]^Xİ
™\ÜÛœÙKšœÛÛŠ
JKœ™\ÛÛ™\ËÑ\]X[
È\œ›ÜÛÙNˆ	ÕÑP—Ô•S•SQWĞ“ÓÕÕT	ÈJNÂˆ^Xİ
™^
K››İÒ]™P™Y[Ø[Y

NÂˆ^Xİ
[ØÚÜË™Ù]\Ù\ŠK››İÒ]™P™Y[Ø[Y

NÂˆJNÂ‚ˆ]™XXÚ
ÉËÚX[	Ë	ËØ\KÚ[\›˜[Ü[[YKX]\İ][Û‰×JJˆ	Ø[İÜÈÛ›HH›Ûİİ˜\XYÛ›ÜİXÈ›İ]H	\ÉËˆ\Ş[˜È
]
HOˆÂˆØš™Xİ˜\ÜÚYÛŠ[ØÚÜËœ[[YQ[‹ÂˆP“P×ĞTÑS•ˆ	Ü›ÙXİ[Û‰ËˆÑP—Ô•S•SQWÓSÑNˆ	Ø›Ûİİ˜\	ËˆJNÂˆÛÛœİÈÛ”™\]Y\İHH]ØZ][\Ü
	Ë‹‹Ë‹‹ÜÜ˜ËÛZY]Ø\™IÊNÂˆÛÛœİÛÛ^HZY]Ø\™PÛÛ^
]
NÂˆÛÛœİ™^HšK™›Š
K›[ØÚÔ™\ÛÛ™Y˜[YJ™]È™\ÜÛœÙJ	ÙXYÛ›ÜİXÉÊJNÂ‚ˆÛÛœİ™\ÜÛœÙHH]ØZ]Û”™\]Y\İ
ÛÛ^\È[K™^
H\È™\ÜÛœÙNÂ‚ˆ^Xİ
™\ÜÛœÙKœİ]\ÊKĞ™JŒ
NÂˆ^Xİ
™^
KÒ]™P™Y[Ø[YÛ˜ÙJ
NÂˆ^Xİ
[ØÚÜË™Ù]\Ù\ŠK››İÒ]™P™Y[Ø[Y

NÂˆKˆ
NÂ‚ˆ]
	ØYÈHÛØ˜[›Ø›İÈXY\ˆÈHX›XÈİYÚ[™È™\ÜÛœÙIË\Ş[˜È

HOˆÂˆØš™Xİ˜\ÜÚYÛŠ[ØÚÜËœ[[YQ[‹ÂˆP“P×ĞTÑS•ˆ	ÜİYÚ[™ÉËˆÑP—Ô•S•SQWÓSÑNˆ	ØXİ]™IËˆJNÂˆÛÛœİÈÛ”™\]Y\İHH]ØZ][\Ü
	Ë‹‹Ë‹‹ÜÜ˜ËÛZY]Ø\™IÊNÂˆÛÛœİÛÛ^HZY]Ø\™PÛÛ^
	ËÙ\ÉÊNÂˆÛÛœİ™^HšK™›Š
K›[ØÚÔ™\ÛÛ™Y˜[YJ™]È™\ÜÛœÙJ	Ï[Ú[‰ËÂˆXY\œÎˆÈ	ĞÛÛ[U\IÎˆ	İ^Ú[ÈÚ\œÙ]]]‹N	ÈKˆJJNÂ‚ˆÛÛœİ™\ÜÛœÙHH]ØZ]Û”™\]Y\İ
ÛÛ^\È[K™^
H\È™\ÜÛœÙNÂ‚ˆ^Xİ
™\ÜÛœÙKœİ]\ÊKĞ™JŒ
NÂˆ^Xİ
™\ÜÛœÙKšXY\œË™Ù]
	ÖT›Ø›İËUYÉÊJKĞ™J	Û›Ú[™^›Ù›ÛİË›Ø\˜Ú]™IÊNÂˆ^Xİ
™\ÜÛœÙKšXY\œË™Ù]
	ÖPÛÛ[U\KSÜ[ÛœÉÊJKĞ™J	Û›ÜÛšY™‰ÊNÂˆ^Xİ
™\ÜÛœÙKšXY\œË™Ù]
	ÖQœ˜[YKSÜ[ÛœÉÊJKĞ™J	ÑS–IÊNÂˆ^Xİ
™\ÜÛœÙKšXY\œË™Ù]
	ÔİšXİU˜[œÜÜTÙXİ\š]IÊJKĞ™J	ÛX^XYÙOLÌMLÍŒ	ÊNÂˆ^Xİ
™\ÜÛœÙKšXY\œË™Ù]
	ÖT™\]Y\İRQ	ÊJKÓX]Ú
×–ÌNXKY‹W^ÌÍŸIÊNÂˆ^Xİ
™\ÜÛœÙKšXY\œË™Ù]
	ĞÛÛ[TÙXİ\š]KTÛXŞIÊJKĞÛÛZ[Š™œ˜[YKX[˜Ù\İÜœÈ	Û›Û™IÈŠNÂˆ^Xİ
™^
KÒ]™P™Y[Ø[YÛ˜ÙJ
NÂˆ^Xİ
[ØÚÜË™Ù]\Ù\ŠK››İÒ]™P™Y[Ø[Y

NÂˆ^Xİ
™\ÜÛœÙKšXY\œË™Ù]
	ĞØXÚKPÛÛ›Û	ÊJKĞ™J	ÜX›XËX^XYÙOLË[X^YÙOLÌ]\İ\™]˜[Y]IÊNÂˆJNÂ‚ˆ]
	ÙÙ[™\˜]\È]ÈİÛˆ™\]Y\İQ[œİXYÙˆ\İ[™ÈHØ[\ˆ˜[YIË\Ş[˜È

HOˆÂˆØš™Xİ˜\ÜÚYÛŠ[ØÚÜËœ[[YQ[‹ÂˆP“P×ĞTÑS•ˆ	ÜİYÚ[™ÉËˆÑP—Ô•S•SQWÓSÑNˆ	ØXİ]™IËˆJNÂˆÛÛœİÛÛ^HZY]Ø\™PÛÛ^
	ËÙ\ÉÊNÂˆÛÛ^œ™\]Y\İH™]È™\]Y\İ
	ÚÎ‹ËÙ^[\K˜ÛÛKÙ\ÉËÂˆXY\œÎˆÈ	ÖT™\]Y\İRQ	Îˆ	ØØ[\‹XÛÛ›ÛY	ÈKˆJNÂˆÛÛœİÈÛ”™\]Y\İHH]ØZ][\Ü
	Ë‹‹Ë‹‹ÜÜ˜ËÛZY]Ø\™IÊNÂ‚ˆÛÛœİ™\ÜÛœÙHH]ØZ]Û”™\]Y\İ
ˆÛÛ^\È[KˆšK™›Š
K›[ØÚÔ™\ÛÛ™Y˜[YJ™]È™\ÜÛœÙJ	ÛÚÉÊJKˆ
H\È™\ÜÛœÙNÂ‚ˆ^Xİ
™\ÜÛœÙKšXY\œË™Ù]
	ÖT™\]Y\İRQ	ÊJKÓX]Ú
×–ÌNXKY‹W^ÌÍŸIÊNÂˆ^Xİ
™\ÜÛœÙKšXY\œË™Ù]
	ÖT™\]Y\İRQ	ÊJK››İĞ™J	ØØ[\‹XÛÛ›ÛY	ÊNÂˆ^Xİ
ÛÛ^›ØØ[Ëœ™\]Y\İY
KĞ™J™\ÜÛœÙKšXY\œË™Ù]
	ÖT™\]Y\İRQ	ÊJNÂˆJNÂ‚ˆ]
	ØYÈHÛØ˜[›Ø›İÈXY\ˆÈHİYÚ[™È™Y\™XİÜ™X]YHH]]Ø]IË\Ş[˜È

HOˆÂˆØš™Xİ˜\ÜÚYÛŠ[ØÚÜËœ[[YQ[‹ÂˆP“P×ĞTÑS•ˆ	ÜİYÚ[™ÉËˆÑP—Ô•S•SQWÓSÑNˆ	ØXİ]™IËˆJNÂˆ[ØÚÜË™Ù]\Ù\‹›[ØÚÔ™\ÛÛ™Y˜[YJÈ]NˆÈ\Ù\ˆ[K\œ›Üˆ[JNÂˆÛÛœİÈÛ”™\]Y\İHH]ØZ][\Ü
	Ë‹‹Ë‹‹ÜÜ˜ËÛZY]Ø\™IÊNÂˆÛÛœİÛÛ^HZY]Ø\™PÛÛ^
	ËÙ\ËØØ[\\ÉÊNÂˆÛÛœİ™^HšK™›Š
NÂ‚ˆÛÛœİ™\ÜÛœÙHH]ØZ]Û”™\]Y\İ
ÛÛ^\È[K™^
H\È™\ÜÛœÙNÂ‚ˆ^Xİ
™\ÜÛœÙKœİ]\ÊKĞ™JÌŠNÂˆ^Xİ
™\ÜÛœÙKšXY\œË™Ù]
	ÓØØ][Û‰ÊJKĞ™JˆÙ\ËÛÙÚ[Ü™]\›•ÏIÙ[˜ÛÙUT’PÛÛ\Û™[
	ËÙ\ËØØ[\\ÉÊ_Xˆ
NÂˆ^Xİ
™\ÜÛœÙKšXY\œË™Ù]
	ÖT›Ø›İËUYÉÊJKĞ™J	Û›Ú[™^›Ù›ÛİË›Ø\˜Ú]™IÊNÂˆ^Xİ
™^
K››İÒ]™P™Y[Ø[Y

NÂˆJNÂ‚ˆ]
	ÙÙ\È›İYHİYÚ[™È›Ø›İÈXY\ˆÈXİ]™H›ÙXİ[Ûˆ™\ÜÛœÙ\ÉË\Ş[˜È

HOˆÂˆØš™Xİ˜\ÜÚYÛŠ[ØÚÜËœ[[YQ[‹ÂˆP“P×ĞTÑS•ˆ	Ü›ÙXİ[Û‰ËˆÑP—Ô•S•SQWÓSÑNˆ	ØXİ]™IËˆJNÂˆÛÛœİÈÛ”™\]Y\İHH]ØZ][\Ü
	Ë‹‹Ë‹‹ÜÜ˜ËÛZY]Ø\™IÊNÂˆÛÛœİÛÛ^HZY]Ø\™PÛÛ^
	ËÙ\ÉÊNÂˆÛÛœİ™^HšK™›Š
K›[ØÚÔ™\ÛÛ™Y˜[YJ™]È™\ÜÛœÙJ	Ï[Ú[‰ËÂˆXY\œÎˆÈ	ĞÛÛ[U\IÎˆ	İ^Ú[ÈÚ\œÙ]]]‹N	ÈKˆJJNÂ‚ˆÛÛœİ™\ÜÛœÙHH]ØZ]Û”™\]Y\İ
ÛÛ^\È[K™^
H\È™\ÜÛœÙNÂ‚ˆ^Xİ
™\ÜÛœÙKœİ]\ÊKĞ™JŒ
NÂˆ^Xİ
™\ÜÛœÙKšXY\œËš\Ê	ÖT›Ø›İËUYÉÊJKĞ™J˜[ÙJNÂˆ^Xİ
™\ÜÛœÙKšXY\œË™Ù]
	ÖPÛÛ[U\KSÜ[ÛœÉÊJKĞ™J	Û›ÜÛšY™‰ÊNÂˆ^Xİ
™\ÜÛœÙKšXY\œË™Ù]
	ĞÛÛ[TÙXİ\š]KTÛXŞIÊJKĞÛÛZ[Š™œ˜[YKX[˜Ù\İÜœÈ	Û›Û™IÈŠNÂˆ^Xİ
™^
KÒ]™P™Y[Ø[YÛ˜ÙJ
NÂˆ^Xİ
[ØÚÜË™Ù]\Ù\ŠK››İÒ]™P™Y[Ø[Y

NÂˆJNÂ‚ˆ]
	Ù›Ü˜Ù\È›Ë\İÜ™HØXÚ[™ÈÛˆÜİYTH™\ÜÛœÙ\ÉË\Ş[˜È

HOˆÂˆØš™Xİ˜\ÜÚYÛŠ[ØÚÜËœ[[YQ[‹ÂˆP“P×ĞTÑS•ˆ	Ü›ÙXİ[Û‰ËˆÑP—Ô•S•SQWÓSÑNˆ	ØXİ]™IËˆJNÂˆÛÛœİÈÛ”™\]Y\İHH]ØZ][\Ü
	Ë‹‹Ë‹‹ÜÜ˜ËÛZY]Ø\™IÊNÂˆÛÛœİÛÛ^HZY]Ø\™PÛÛ^
	ËØ\KÙ^[\IÊNÂˆÛÛœİ™^HšK™›Š
K›[ØÚÔ™\ÛÛ™Y˜[YJ™]È™\ÜÛœÙJ	ŞßIËÂˆXY\œÎˆÈ	ĞØXÚKPÛÛ›Û	Îˆ	ÜX›XËX^XYÙOLÍŒ	ÈKˆJJNÂ‚ˆÛÛœİ™\ÜÛœÙHH]ØZ]Û”™\]Y\İ
ÛÛ^\È[K™^
H\È™\ÜÛœÙNÂ‚ˆ^Xİ
™\ÜÛœÙKšXY\œË™Ù]
	ĞØXÚKPÛÛ›Û	ÊJKĞ™J	Û›Ë\İÜ™K›ËXØXÚK]\İ\™]˜[Y]IÊNÂˆ^Xİ
™\ÜÛœÙKšXY\œË™Ù]
	ÖPÛÛ[U\KSÜ[ÛœÉÊJKĞ™J	Û›ÜÛšY™‰ÊNÂˆJNÂ‚ˆ]
	Ù›Ü˜Ù\Èš]˜]H›Ë\İÜ™HØXÚ[™ÈÛˆ]][XØ]Y[™™XÛİ™\HYÙ\ÉË\Ş[˜È

HOˆÂˆØš™Xİ˜\ÜÚYÛŠ[ØÚÜËœ[[YQ[‹ÂˆP“P×ĞTÑS•ˆ	Ü›ÙXİ[Û‰ËˆÑP—Ô•S•SQWÓSÑNˆ	ØXİ]™IËˆJNÂˆ[ØÚÜË™Ù]\Ù\‹›[ØÚÔ™\ÛÛ™Y˜[YJÈ]NˆÈ\Ù\ˆ[K\œ›Üˆ[JNÂˆÛÛœİÈÛ”™\]Y\İHH]ØZ][\Ü
	Ë‹‹Ë‹‹ÜÜ˜ËÛZY]Ø\™IÊNÂˆÛÛœİÛÛ^HZY]Ø\™PÛÛ^
	ËÙ\ËØØ[\\ÉÊNÂ‚ˆÛÛœİ™\ÜÛœÙHH]ØZ]Û”™\]Y\İ
ÛÛ^\È[KšK™›Š
JH\È™\ÜÛœÙNÂ‚ˆ^Xİ
™\ÜÛœÙKœİ]\ÊKĞ™JÌŠNÂˆ^Xİ
™\ÜÛœÙKšXY\œË™Ù]
	ĞØXÚKPÛÛ›Û	ÊJKĞ™J	Üš]˜]K›Ë\İÜ™IÊNÂˆ^Xİ
™\ÜÛœÙKšXY\œË™Ù]
	ĞÛÛ[TÙXİ\š]KTÛXŞIÊJKĞÛÛZ[Š™œ˜[YKX[˜Ù\İÜœÈ	Û›Û™IÈŠNÂˆJNÂ‚ˆ]
	Û›Ü›X[^™\ÈH›ÙXİ[Ûˆ[š\›Û›Y[™Y›Ü™H[™›Ü˜Ú[™È›Ûİİ˜\[ÙIË\Ş[˜È

HOˆÂˆØš™Xİ˜\ÜÚYÛŠ[ØÚÜËœ[[YQ[‹ÂˆP“P×ĞTÑS•ˆ	È›ÙXİ[Ûˆ	ËˆÑP—Ô•S•SQWÓSÑNˆ	Ø›Ûİİ˜\	ËˆJNÂˆÛÛœİÈÛ”™\]Y\İHH]ØZ][\Ü
	Ë‹‹Ë‹‹ÜÜ˜ËÛZY]Ø\™IÊNÂˆÛÛœİ™^HšK™›Š
NÂ‚ˆÛÛœİ™\ÜÛœÙHH]ØZ]Û”™\]Y\İ
ZY]Ø\™PÛÛ^
	ËÙ\ÉÊH\È[K™^
H\È™\ÜÛœÙNÂ‚ˆ^Xİ
™\ÜÛœÙKœİ]\ÊKĞ™JLÊNÂˆ]ØZ]^Xİ
™\ÜÛœÙKšœÛÛŠ
JKœ™\ÛÛ™\ËÑ\]X[
È\œ›ÜÛÙNˆ	ÕÑP—Ô•S•SQWĞ“ÓÕÕT	ÈJNÂˆ^Xİ
™^
K››İÒ]™P™Y[Ø[Y

NÂˆJNÂ‚ˆ]™XXÚ
İ[™Yš[™Y	Ü›Ùİ][Û‰×JJˆ	Ù˜Z[ÈÛÜÙYÚ[ˆHÜİY[š\›Û›Y[ÛÛ˜Xİ\È[˜[Y
	\ÊIËˆ\Ş[˜È
\[š\›Û›Y[
HOˆÂˆYˆ
\[š\›Û›Y[
H[ØÚÜËœ[[YQ[‹”P“P×ĞTÑS•ˆH\[š\›Û›Y[Âˆ[ÙH[]H[ØÚÜËœ[[YQ[‹”P“P×ĞTÑS•ÂˆÛÛœİÈÛ”™\]Y\İHH]ØZ][\Ü
	Ë‹‹Ë‹‹ÜÜ˜ËÛZY]Ø\™IÊNÂˆÛÛœİ™^HšK™›Š
NÂ‚ˆÛÛœİ™\ÜÛœÙHH]ØZ]Û”™\]Y\İ
ZY]Ø\™PÛÛ^
	ËÙ\ÉÊH\È[K™^
H\È™\ÜÛœÙNÂ‚ˆ^Xİ
™\ÜÛœÙKœİ]\ÊKĞ™JLÊNÂˆ]ØZ]^Xİ
™\ÜÛœÙKšœÛÛŠ
JKœ™\ÛÛ™\ËÑ\]X[
È\œ›ÜÛÙNˆ	ÔP“P×ĞTÑS•—ÒS•SQ	ÈJNÂˆ^Xİ
™\ÜÛœÙKšXY\œË™Ù]
	ĞÛÛ[TÙXİ\š]KTÛXŞIÊJKĞÛÛZ[Š™œ˜[YKX[˜Ù\İÜœÈ	Û›Û™IÈŠNÂˆ^Xİ
™\ÜÛœÙKšXY\œË™Ù]
	ĞØXÚKPÛÛ›Û	ÊJKĞÛÛZ[Š	Û›Ë\İÜ™IÊNÂˆ^Xİ
™^
K››İÒ]™P™Y[Ø[Y

NÂˆKˆ
NÂ‚ˆ]™XXÚ
ÉËÙ\ËËÛÙÚ[‰Ë	ËËÙ\ËÛÙÚ[‰×JJˆ	ÚÙY\È›Ü›X[^™YÙÚ[ˆ™Y\™XİÈš]˜]H[™›Û‹XØXÚXX›H›Üˆ	\ÉËˆ\Ş[˜È
]
HOˆÂˆØš™Xİ˜\ÜÚYÛŠ[ØÚÜËœ[[YQ[‹ÂˆP“P×ĞTÑS•ˆ	Ü›ÙXİ[Û‰ËˆÑP—Ô•S•SQWÓSÑNˆ	ØXİ]™IËˆJNÂˆ[ØÚÜËœÚ[™ÛK›[ØÚÔ™\ÛÛ™Y˜[YJÂˆ]NˆÂˆ›ÛNˆ	ØYZ[‰ËˆY[ØÛÛ™š\›YYˆ˜[ÙKˆY[ØÛÛ™š\›YYØ]ˆ[ˆYÙWÜÛXŞWİ™\œÚ[Ûˆ[ˆKˆ\œ›Üˆ[ˆJNÂˆÛÛœİÈÛ”™\]Y\İHH]ØZ][\Ü
	Ë‹‹Ë‹‹ÜÜ˜ËÛZY]Ø\™IÊNÂ‚ˆÛÛœİ™\ÜÛœÙHH]ØZ]Û”™\]Y\İ
ZY]Ø\™PÛÛ^
]
H\È[KšK™›Š
JH\È™\ÜÛœÙNÂ‚ˆ^Xİ
™\ÜÛœÙKœİ]\ÊKĞ™JÌŠNÂˆ^Xİ
™\ÜÛœÙKšXY\œË™Ù]
	ÓØØ][Û‰ÊJKĞ™J	ËÙ\ËØØ[\\ËØYZ[‰ÊNÂˆ^Xİ
™\ÜÛœÙKšXY\œË™Ù]
	ĞØXÚKPÛÛ›Û	ÊJKĞ™J	Üš]˜]K›Ë\İÜ™IÊNÂˆKˆ
NÂ‚ˆ]
	ÙÙ\È›İ™X]HÛ™Ù\ˆ[šÛ›İÛˆ]\ÈHÙÚ[ˆYÙIË\Ş[˜È

HOˆÂˆØš™Xİ˜\ÜÚYÛŠ[ØÚÜËœ[[YQ[‹ÂˆP“P×ĞTÑS•ˆ	Ü›ÙXİ[Û‰ËˆÑP—Ô•S•SQWÓSÑNˆ	ØXİ]™IËˆJNÂˆÛÛœİÈÛ”™\]Y\İHH]ØZ][\Ü
	Ë‹‹Ë‹‹ÜÜ˜ËÛZY]Ø\™IÊNÂˆÛÛœİ™^HšK™›Š
K›[ØÚÔ™\ÛÛ™Y˜[YJ™]È™\ÜÛœÙJ	Û›İ›İ[™	ËÈİ]\ÎˆJJNÂ‚ˆÛÛœİ™\ÜÛœÙHH]ØZ]Û”™\]Y\İ
ZY]Ø\™PÛÛ^
	ËÙ\ËÛÙÚ[‹Ù^˜IÊH\È[K™^
H\È™\ÜÛœÙNÂ‚ˆ^Xİ
™\ÜÛœÙKœİ]\ÊKĞ™J
NÂˆ^Xİ
™^
KÒ]™P™Y[Ø[YÛ˜ÙJ
NÂˆ^Xİ
[ØÚÜË™Ù]\Ù\ŠK››İÒ]™P™Y[Ø[Y

NÂˆ^Xİ
™\ÜÛœÙKšXY\œËš\Ê	ĞØXÚKPÛÛ›Û	ÊJKĞ™J˜[ÙJNÂˆJNÂ‚ˆ]
	ÙÙ\È›İ][˜ÛÙYØØ[^™Y›İ]HÙYÛY[È\\ÜÈH]][XØ][ÛˆØ]IË\Ş[˜È

HOˆÂˆØš™Xİ˜\ÜÚYÛŠ[ØÚÜËœ[[YQ[‹ÂˆP“P×ĞTÑS•ˆ	Ü›ÙXİ[Û‰ËˆÑP—Ô•S•SQWÓSÑNˆ	ØXİ]™IËˆJNÂˆ[ØÚÜË™Ù]\Ù\‹›[ØÚÔ™\ÛÛ™Y˜[YJÈ]NˆÈ\Ù\ˆ[K\œ›Üˆ[JNÂˆÛÛœİÈÛ”™\]Y\İHH]ØZ][\Ü
	Ë‹‹Ë‹‹ÜÜ˜ËÛZY]Ø\™IÊNÂˆÛÛœİ™^HšK™›Š
NÂ‚ˆÛÛœİ™\ÜÛœÙHH]ØZ]Û”™\]Y\İ
ˆZY]Ø\™PÛÛ^
	ËÙ\ËÉMŒØ[\\ËØYZ[‰ÊH\È[Kˆ™^ˆ
H\È™\ÜÛœÙNÂ‚ˆ^Xİ
™\ÜÛœÙKœİ]\ÊKĞ™JÌŠNÂˆ^Xİ
™\ÜÛœÙKšXY\œË™Ù]
	ÓØØ][Û‰ÊJKĞ™J	ËÙ\ËÛÙÚ[‰ÊNÂˆ^Xİ
™^
K››İÒ]™P™Y[Ø[Y

NÂˆJNÂ‚ˆ]
	ÙÙ\È›İXÛÙHHØØ[^™Y›İ]HÙYÛY[ÚXÙIË\Ş[˜È

HOˆÂˆØš™Xİ˜\ÜÚYÛŠ[ØÚÜËœ[[YQ[‹ÂˆP“P×ĞTÑS•ˆ	Ü›ÙXİ[Û‰ËˆÑP—Ô•S•SQWÓSÑNˆ	ØXİ]™IËˆJNÂˆÛÛœİÈÛ”™\]Y\İHH]ØZ][\Ü
	Ë‹‹Ë‹‹ÜÜ˜ËÛZY]Ø\™IÊNÂˆÛÛœİ™^HšK™›Š
K›[ØÚÔ™\ÛÛ™Y˜[YJ™]È™\ÜÛœÙJ	Û›İ›İ[™	ËÈİ]\ÎˆJJNÂ‚ˆÛÛœİ™\ÜÛœÙHH]ØZ]Û”™\]Y\İ
ˆZY]Ø\™PÛÛ^
	ËÙ\ËÉLMŒØ[\\ËØYZ[‰ÊH\È[Kˆ™^ˆ
H\È™\ÜÛœÙNÂ‚ˆ^Xİ
™\ÜÛœÙKœİ]\ÊKĞ™J
NÂˆ^Xİ
™^
KÒ]™P™Y[Ø[YÛ˜ÙJ
NÂˆ^Xİ
[ØÚÜË™Ù]\Ù\ŠK››İÒ]™P™Y[Ø[Y

NÂˆ^Xİ
™\ÜÛœÙKšXY\œËš\Ê	ĞØXÚKPÛÛ›Û	ÊJKĞ™J˜[ÙJNÂˆJNÂ‚ˆ]
	Ø\Y\ÈTHØXÚHÛÛ›ÛÈÈ[˜ÛÙY›İ]HÙYÛY[ÉË\Ş[˜È

HOˆÂˆØš™Xİ˜\ÜÚYÛŠ[ØÚÜËœ[[YQ[‹ÂˆP“P×ĞTÑS•ˆ	Ü›ÙXİ[Û‰ËˆÑP—Ô•S•SQWÓSÑNˆ	ØXİ]™IËˆJNÂˆÛÛœİÈÛ”™\]Y\İHH]ØZ][\Ü
	Ë‹‹Ë‹‹ÜÜ˜ËÛZY]Ø\™IÊNÂˆÛÛœİ™^HšK™›Š
K›[ØÚÔ™\ÛÛ™Y˜[YJ™]È™\ÜÛœÙJ	ŞßIÊJNÂ‚ˆÛÛœİ™\ÜÛœÙHH]ØZ]Û”™\]Y\İ
ˆZY]Ø\™PÛÛ^
	ËÉMŒ\KÙ^[\IÊH\È[Kˆ™^ˆ
H\È™\ÜÛœÙNÂ‚ˆ^Xİ
™\ÜÛœÙKšXY\œË™Ù]
	ĞØXÚKPÛÛ›Û	ÊJKĞ™J	Û›Ë\İÜ™K›ËXØXÚK]\İ\™]˜[Y]IÊNÂˆJNÂ‚ˆ]
	Ü™\Ù\™\ÈH\ÛÛ]YØ[YK[ÜšYÚ[ˆÛXŞH›ÜˆH]][XØ]Y[XZ[™]šY]Èœ˜[YIË\Ş[˜È

HOˆÂˆØš™Xİ˜\ÜÚYÛŠ[ØÚÜËœ[[YQ[‹ÂˆP“P×ĞTÑS•ˆ	Ü›ÙXİ[Û‰ËˆÑP—Ô•S•SQWÓSÑNˆ	ØXİ]™IËˆJNÂˆÛÛœİÈÛ”™\]Y\İHH]ØZ][\Ü
	Ë‹‹Ë‹‹ÜÜ˜ËÛZY]Ø\™IÊNÂˆÛÛœİ™^HšK™›Š
K›[ØÚÔ™\ÛÛ™Y˜[YJ™]È™\ÜÛœÙJ	Ï[Ú[‰ËÂˆXY\œÎˆÂˆ	ĞØXÚKPÛÛ›Û	Îˆ	Üš]˜]K›Ë\İÜ™IËˆ	Ô™Y™\œ™\‹TÛXŞIÎˆ	Û›Ë\™Y™\œ™\‰ËˆKˆJJNÂ‚ˆÛÛœİ™\ÜÛœÙHH]ØZ]Û”™\]Y\İ
ˆZY]Ø\™PÛÛ^
	ËØ\KÙ[XZ[Ü™]šY]ËYœ˜[YOİ\O]Ù[ÛÛYIÊH\È[Kˆ™^ˆ
H\È™\ÜÛœÙNÂ‚ˆ^Xİ
™\ÜÛœÙKšXY\œË™Ù]
	ÖQœ˜[YKSÜ[ÛœÉÊJKĞ™J	ÔĞSQSÔ’QÒS‰ÊNÂˆ^Xİ
™\ÜÛœÙKšXY\œË™Ù]
	Ô™Y™\œ™\‹TÛXŞIÊJKĞ™J	Û›Ë\™Y™\œ™\‰ÊNÂˆ^Xİ
™\ÜÛœÙKšXY\œË™Ù]
	ĞØXÚKPÛÛ›Û	ÊJKĞ™J	Üš]˜]K›Ë\İÜ™K›ËXØXÚK]\İ\™]˜[Y]IÊNÂˆ^Xİ
™\ÜÛœÙKšXY\œË™Ù]
	ĞÛÛ[TÙXİ\š]KTÛXŞIÊJKĞÛÛZ[Š™œ˜[YKX[˜Ù\İÜœÈ	ÜÙ[‰ÈŠNÂˆ^Xİ
™\ÜÛœÙKšXY\œË™Ù]
	ĞÛÛ[TÙXİ\š]KTÛXŞIÊJKĞÛÛZ[Šœİ[K\Ü˜È	İ[œØY™KZ[›[™IÈŠNÂˆJNÂŸJNÂ