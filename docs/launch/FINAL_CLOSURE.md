# Final Closure Runbook

Estado: final-only. No ejecutar esta secuencia hasta que Alin decida entrar en ventana real de Go/No-Go.

Este documento une los cierres que no deben bloquear el Release Candidate pero si bloquean el lanzamiento publico: legal real, pagos/Stripe, activación de integraciones production ya preparadas en modo inerte, rotacion de claves, backup/export final, fuente rusa premium, SEO/LLM final y smoke end-to-end.

## Criterio De Entrada

Entrar en cierre final solo cuando:

- El Release Candidate esta congelado y `pnpm launch:rc` devuelve `RC_READY_WITH_FINAL_BLOCKERS`.
- Fase 1 esta limpia en `pnpm launch:status`.
- `production_inert_preparation` está cerrada: Workers production en bootstrap, Supabase production migrado/limpio, Auth inerte, disponibilidad verificada y checkout desactivado; todavía sin proveedores activos, DNS ni tráfico.
- Ya no quedan cambios de producto/copy/posicionamiento que puedan alterar legal, precios, SEO o pagos.
- `docs/launch/LAUNCH_MARKETING_PLAN.md` esta congelado y representa la promesa final: adulto/profesional +30, conversacion, cultura, criterio, comunidad y solicitud de plaza/prueba como accion principal.
- Alin confirma si se lanzara con pagos reales o sin aceptar pagos reales.
- Alin confirma si se compra/licencia la fuente oficial con soporte cirilico o si acepta mantener el fallback actual para el lanzamiento.
- Hay tiempo para rotar claves, validar staging, validar production y hacer rollback si algo falla.

La preparación técnica inerte quedó ejecutada y atestiguada el 2026-07-17. No repetir Cloudflare C-D-E, el rollout, Auth ni disponibilidad para refrescar un TTL. Tras integrar el RC en `main`, el cierre técnico canónico consiste únicamente y en este orden en: renovar `pnpm launch:production-inert-final-readonly -- --capture-readonly` mediante Management API `GET` entre dos consultas SQL `READ ONLY`; generar el backup lógico fresco post-cierre ligado a esa atestación y al SHA; renovar la atestación Cloudflare con GET/readbacks; y ejecutar `pnpm launch:status`/`pnpm launch:rc` sobre el SHA limpio. La atestación Supabase/Auth demuestra el estado inerte completo: dos perfiles mínimos con roles admin/profesor ligados a sus identidades por hash de rol; tablas transaccionales/CRM/billing/fulfillment vacías; exactamente cuatro paquetes cuyo hash de catálogo coincide con el `catalogSha256` aprobado, todos con `catalog_version=1` y referencias Stripe locales nulas; cero objetos Storage con propietario; cinco franjas del profesor; y las 25 migraciones RC exactas dentro de un historial cerrado de 49 entradas. El vencimiento de estas lecturas renovables bloquea una futura escritura, pero no invalida los cierres históricos.

Cada captura real requiere en el entorno local `TEST_ADMIN_EMAIL` y `TEST_TEACHER_EMAIL`, distintos entre si, para probar que el email esperado de cada rol coincide simultaneamente en `auth.users` y `public.profiles`; los valores se descartan y nunca se persisten en la atestacion, resumen ni logs. La captura deja primero un resumen durable. Si el intento real mas reciente queda `CAPTURE_FAILED` o `CAPTURE_IN_PROGRESS`, invalida cualquier exito anterior aunque este siga dentro de su TTL; hay que reconciliar y ejecutar una captura nueva. Un plan local `PLAN_ONLY_NO_NETWORK` se ignora para esta precedencia y nunca sustituye una captura real.

## Dos SHA Y Dos Cierres Distintos

- `RC_BASE_SHA` es el commit técnico canónico que se integra ahora en `main`: código, tests, documentación y producción inerte reconciliados. El goal RC puede terminar con los cinco gates deliberadamente finales todavía abiertos: `legal_owner_controller`, `legal_human_review`, `integration_readiness`, `seo_llm_final` y `final_smoke`.
- `LAUNCH_SHA` será un descendiente de `RC_BASE_SHA` creado después de sustituir la identidad legal de ejemplo y aplicar cualquier cambio SEO/contenido final. Es el único SHA que puede desplegarse como versión pública activa.
- Toda aprobación de la ventana final debe nombrar `LAUNCH_SHA`, demostrar `HEAD = origin/main = GitHub main`, CI verde y worktree limpio. Una aprobación ligada a `RC_BASE_SHA` no autoriza activar un descendiente ni reutilizar un bundle anterior.
- El build production continúa bloqueado mientras `LEGAL_IDENTITY_MODE` no sea `verified`; por tanto, terminar el RC técnico no equivale a aceptar alumnos todavía.

## No Hacer En Esta Secuencia

- No pegar secretos, claves, tokens, payloads de webhook, datos de alumnos ni datos de pago en docs, outputs, capturas o `.codex-ops`.
- No marcar manual evidence como `pass` con pruebas antiguas o parciales.
- No cerrar `READY` si `pnpm launch:gate` o `pnpm launch:secondary-review` siguen bloqueados.
- No activar telemetria sin revisar legal/cookies/consentimiento.
- No publicar reviews sin consentimiento real.
- No sustituir la tipografia rusa por una fuente parecida si la decision final exige la misma familia oficial con cirilico; comprar/licenciar o mantener el fallback actual como decision explicita.
- No guardar fuentes comerciales sin licencia, facturas ni datos fiscales en el repo, `outputs/` o `.codex-ops`.
- No activar una prueba de nivel definitiva sin seguir `docs/launch/LEVEL_CHECK.md`, revisar privacidad/consentimiento/retencion/canal de envio y reejecutar los checks afectados.

## Decision De Prueba De Nivel

El Release Candidate usa solicitud de plaza, no una prueba de nivel definitiva. En la ventana final hay que confirmar una de estas dos rutas:

| Ruta | Condicion | Evidencia |
| --- | --- | --- |
| Mantener pospuesta | La web sigue recogiendo nivel aproximado, objetivo, disponibilidad, interes, plan de interes y pagina de origen. | Nota en evidencia manual o decision de Alin; `docs/launch/LEVEL_CHECK.md` queda como backlog operativo. |
| Incluir en launch | Existe formato asincrono, canal de envio, texto de consentimiento, finalidad, retencion, acceso, borrado y rubrica manual. | `docs/launch/LEVEL_CHECK.md` actualizado, legal revisado, `pnpm launch:content`, `pnpm launch:accessibility` si cambia UI y `pnpm launch:legal` si cambia privacidad. |

No usar documentos, audio o video de nivel en evidencias del repo, capturas, outputs o `.codex-ops`. Si entra en launch, tratarlo como cambio de producto y privacidad antes del Go/No-Go.

## Responsables Y Cadencia

La ventana final debe tratarse como una checklist con responsables, orden y hora relativa. Si cambia el alcance, actualizar esta tabla antes de ejecutar el Gate.

| Momento | Responsable | Accion | Bloquea |
| --- | --- | --- | --- |
| T-48h | Alin | Congelar copy publico, paquetes, `docs/launch/LAUNCH_MARKETING_PLAN.md` y la decision ya tomada de pagos reales desde el primer dia. | Legal, SEO/LLM, Stripe y smoke final. |
| T-48h | Alin | Confirmar que no entran reviews, Telegram, telemetria ni prueba de nivel definitiva salvo decision nueva documentada. | Checklist y evidencia manual. |
| T-48h | Alin | Confirmar fuente rusa premium: comprar/licenciar la familia oficial con cirilico o aceptar mantener fallback actual. | `seo_llm_final`, `final_smoke`. |
| T-24h | Alin | Completar datos legales reales y revision humana legal. | `legal_owner_controller`, `legal_human_review`. |
| Tras integrar `RC_BASE_SHA` | Codex | Generar el backup lógico post-cierre desde `main` limpio y ligado al SHA; verificar EFS, hash, TOC e inventario. | Cierre técnico RC. |
| T-24h | Alin/Codex | Repetir el backup solo si Supabase cambió después del backup post-cierre, o confirmar upgrade Pro/accepted risk. | `database_readiness`, Go/No-Go. |
| T-12h | Alin/Codex | Rotar claves finales y validar secretos en Cloudflare, Supabase, Stripe, Google, Resend, Turnstile y Sentry. | `security_external`, `integration_readiness`. |
| T-6h | Codex | Ejecutar checks locales: `pnpm secrets:check`, `pnpm launch:security`, `pnpm launch:operations`, `pnpm launch:payments`, `pnpm launch:seo`, `pnpm launch:final-readiness`. | Evidencia manual final. |
| T-3h | Alin/Codex | Usar la evidencia integral staging ya cerrada salvo deriva de código/configuración; ejecutar el smoke production final sobre `LAUNCH_SHA` y servicios reales. | `final_smoke`. |
| T-1h | Alin | Revisar `docs/launch/MANUAL_EVIDENCE.local.json`, aceptar riesgos no criticos si los hay y decidir Go/No-Go. | `launchDecision`. |
| T-0 | Codex | Ejecutar `pnpm launch:gate`, `pnpm launch:secondary-review` y `pnpm launch:status`. | Declarar `READY` o `NO-GO`. |

## Orden De Cierre

### 1. Congelar Decision De Pagos

La ruta de lanzamiento esta fijada; el modo sin pagos queda como rollback:

| Ruta | Condicion | Evidencia |
| --- | --- | --- |
| Pagos reales activos | Stripe live, Price IDs live, webhook live, portal, aviso de renovacion, confirmacion contractual y reembolso/reconciliacion verificados. | `payments_staging` e `integration_readiness` pasan con evidencia Stripe no secreta. |
| Rollback sin nuevos cobros | `CHECKOUT_ENABLED_OVERRIDE=false` oculta checkout y bloquea la API; webhook y fulfillment siguen procesando operaciones ya cobradas. | Probe 403, nota de incidente y plan de recuperacion. |

En rollback, Checkout desactivado, oculto o bloqueado significa que no se crean nuevas sesiones, pero no se eliminan Prices ni se interrumpe la reconciliacion de pagos existentes.

No mezclar Stripe test con promesa de pago real.

### 2. Completar Legal Real

Usar `docs/launch/LEGAL_INPUTS_REQUIRED.md`.

Actualizar:

- `src/pages/[lang]/legal/aviso-legal.astro`
- `src/pages/[lang]/legal/privacidad.astro`
- cookies, terminos y subprocesadores si cambian.

Ejecutar:

```bash
pnpm launch:legal
pnpm launch:verify
```

Evidencia manual:

- `legal_owner_controller`
- `legal_human_review`

### 3. Backup/Export Final De Supabase

Usar `docs/launch/SUPABASE_BACKUP_RUNBOOK.md`.

Como production está en Supabase Free, el cierre de `RC_BASE_SHA` genera un dump post-cierre nuevo desde `main` limpio. Antes de deploy público, migración destructiva o Go/No-Go:

- Ejecutar `pnpm launch:supabase-production-post-closure-backup` con el destino EFS nuevo, la atestación inerte fresca y el SHA canónico, o
- Subir a Pro si se quiere backup programado gestionado.

Evidencia aceptable:

- Receipt no secreto ligado al SHA, atestación inerte, hash del artefacto, inventario exacto y comprobación `pg_restore --list`.
- Nota explícita de que esta comprobación es tabletop y no una restauración completa.

No guardar dumps, rutas privadas ni credenciales en el repo. El contrato post-cierre exige las 22 tablas públicas actuales y `auth.users`, rechaza `public.jobs` y las dos tablas exclusivas de staging, y nunca sobrescribe un destino existente.

Inventario reconciliado del RC a 2026-07-17:

- Supabase tiene dos proyectos separados activos: `espanol-staging` y `espanol-honesto`.
- Production partía de 24 entradas históricas y aplicó/verificó las 25 migraciones RC incluidas en el allowlist; contiene exactamente 49 entradas. Staging contiene el RC completo y, además, `20260710150000_staging_integration_smoke_runs.sql` y `20260713161300_allow_staging_custom_hostname.sql`; esas dos migraciones son staging-only y están excluidas deliberadamente de production.
- Las tablas críticas existen con RLS activado en ambos proyectos. La limpieza production retiró `public.jobs` sin `CASCADE` y la atestación final confirmó `legacy_jobs_absent=true`.
- Supabase Advisor marca `btree_gist` instalado en `public` en ambos proyectos y leaked password protection desactivado. Antes del lanzamiento publico, habilitar leaked password protection o registrar riesgo aceptado; mover `btree_gist` fuera de `public` solo con migracion probada, o dejarlo como backlog/riesgo aceptado si no bloquea el lanzamiento.

### 4. Rotacion Final De Claves

Seguir `docs/launch/RUNBOOK.md` y `docs/launch/ENVIRONMENT.md`.

Rotar y actualizar, segun aplique:

- Supabase anon/service role/JWT posture.
- Stripe secret/publishable/webhook.
- Cloudflare Pages/Worker secrets.
- Google service account key.
- Resend API key.
- Turnstile secret/site key si cambia.
- Sentry auth token si se usa para sourcemaps.
- GitHub/Cloudflare deploy token.
- `INTERNAL_JOB_SECRET` y `CRON_SECRET` por entorno.

Ejecutar despues:

```bash
pnpm secrets:check
pnpm launch:security
pnpm launch:operations
pnpm launch:final-readiness
pnpm launch:status
```

Evidencia manual:

- `security_external` si se repite el baseline final.
- `integration_readiness` para claves/servicios finales.

### 5. Validar Integraciones Production

Revisar dashboards y endpoints reales sin exponer secretos:

- Cloudflare Pages production.
- Cloudflare Fulfillment Worker production `/health`.
- Cloudflare Worker legacy `espanol-honesto-reminders`: conservar como cierre histórico neutralizado (Cron vacío, `workers.dev=false`, Preview URLs desactivadas, sin dominios ni rutas); no reabrirlo salvo deriva demostrada por GET.
- Supabase production, RLS, migraciones y tablas criticas.
- Google Drive root folder, template, Calendar/Meet, admin email y decision de cuenta en `docs/launch/GOOGLE_CALENDAR_ACCOUNT.md`.
- Resend domain/sender y entrega.
- Turnstile dominios reales.
- Sentry alerts/issues.
- Cron y Workers Logs.

Antecedentes read-only:

- Cloudflare lista `espanol-honesto-fulfillment-staging` con cron horario y secretos esperados por nombre, sin valores expuestos.
- La lectura antigua del 2026-06-12 encontró Cron en `espanol-honesto-reminders`; el recurso fue neutralizado y verificado el 2026-07-14 con Cron vacío, `workers.dev=false`, Preview URLs desactivadas, cero custom domains y cero Worker Routes. La evidencia antigua no representa el estado vigente.
- Stripe autentica la cuenta `espanolhonesto`, pero los listados del MCP de Stripe fallaron con `Unknown tool`. El cierre de pagos no debe depender de esos listados; usar dashboard Stripe, flujo checkout test/live segun decision, webhook delivery y reconciliacion Supabase como evidencia.

Evidencia manual:

- `integration_readiness`
- `operations_external` si hay cambios finales de operacion.
- `database_readiness` si hubo migraciones, backup o cambios de Supabase.

### 5.1. Secuencia Exacta De Activación Ligada A `LAUNCH_SHA`

No iniciar esta secuencia hasta que `integration_readiness` documente y pruebe las fronteras todavía no automatizadas: hardening del runner de secrets fulfillment con lock/checkpoint write-ahead y reconciliación GET ante ambigüedad; configuración production de `site_url`/redirects Auth; recuperación deliberada del acceso admin/profesor; sincronización de los cuatro paquetes y doce ofertas Stripe Live; movimiento Pages → Worker; apertura/cierre de checkout; una frontera temporal de tráfico que permita el smoke propio sin aceptar alumnos antes de tiempo; y evidencia Cloudflare compatible con estado activo.

1. Integrar identidad legal real y SEO final; congelar `LAUNCH_SHA`; exigir `main` limpio, remoto idéntico y CI verde.
2. Con todo inerte, renovar Supabase/Auth y Cloudflare mediante lecturas, verificar backup vigente, credenciales por nombre, Stripe Live/Portal/webhook, Turnstile y redirects Auth production.
3. Solo después de endurecer y validar su runner, cargar los secretos activos de fulfillment manteniendo el runtime bootstrap. Ante timeout o ambigüedad, el checkpoint queda abierto: detenerse y reconciliar por GET antes de cualquier reintento.
4. Desplegar el Worker web activo desde `LAUNCH_SHA` con checkout todavía `false`; verificar versión, HMAC, Supabase production y probes directos.
5. Habilitar fulfillment y verificar Queue/DLQ, productor/consumidor, Cron horario, email y HMAC. Cualquier fallo debe compensar a bootstrap y bloquear compras.
6. Mover los dominios al Worker con checkout y signup todavía cerrados y con una frontera temporal de tráfico/operador que impida aceptar alumnos antes del smoke; verificar propietario, TLS, rutas, webhook, canonical y hreflang. Si esa frontera no existe, `integration_readiness` sigue pendiente y el cutover se pospone.
7. Recuperar de forma deliberada el acceso del admin y profesor mediante sus dos correos y confirmar ambos logins sin persistir contraseñas en el repo/evidencias.
8. Sincronizar desde Admin los cuatro paquetes y doce ofertas Stripe Live bajo una aprobación ligada al hash de catálogo; verificar cuenta, modo live, EUR y referencias en Supabase.
9. Ejecutar revisión legal/SEO/live-domain/readiness con signup y checkout todavía cerrados.
10. Celebrar Go/No-Go; solo entonces activar signup con el runner final y verificar `site_url` y todos los redirects production sin retirar todavía la frontera temporal de tráfico.
11. Como última escritura de capacidad de cobro, cambiar únicamente el override de checkout a `true`; comprobar que desaparece el bloqueo 403 solo para el operador autorizado, no para tráfico público aún.
12. Ejecutar una única compra propia aprobada y verificar webhook, Supabase, confirmación contractual, fulfillment, email, Drive/Calendar y Portal. Solo después de ese éxito se retira la frontera de tráfico, se cierra `final_smoke` y se aceptan alumnos.

La preparación inerte C-D-E, el rollout/Auth/disponibilidad Supabase, Stripe test, el smoke integral staging y el simulacro de rollback son antecedentes cerrados: no forman parte de esta secuencia salvo que exista deriva demostrada.

### 5.2. Orden De Rollback

1. Antes de la primera compra, mantener checkout y signup cerrados; si falla el cutover, devolver el dominio a Pages y conservar Workers inertes.
2. Si falla Auth después de abrir signup, cerrar signup primero y reconciliar por lectura antes de reintentar.
3. Si falla el Worker web antes de pagos, usar su compensación a bootstrap. Después de aceptar pagos, cerrar primero checkout y volver solo a una versión activa conocida; no usar bootstrap como destino mientras haya operaciones por procesar.
4. Si falla fulfillment antes de cualquier cobro, cerrar checkout y aceptar la compensación a bootstrap. Si ya existe un cobro, cerrar checkout pero mantener webhook y la última versión activa conocida de fulfillment para drenar/reconciliar; no compensar ciegamente a bootstrap ni detener jobs pendientes. Escalar a reconciliación manual bajo otra aprobación si no existe una versión activa segura.
5. Si el catálogo es incorrecto, cerrar checkout, retirar/resincronizar ofertas bajo nueva aprobación y no borrar Prices inmutables.
6. Después de una compra real, no devolver el dominio a Pages salvo que el webhook se mueva simultáneamente a un endpoint Worker seguro. Preservar recibos, logs y jobs para la reconciliación.

### 6. Cerrar SEO/LLM Final

Usar `docs/launch/SEO_LLM_FINAL.md` y comparar sus snippets, `llms.txt`, paginas de segmento y respuestas esperadas contra `docs/launch/LAUNCH_MARKETING_PLAN.md`.

Antes de cerrar `seo_llm_final`, resolver la fuente rusa premium:

| Ruta | Condicion | Evidencia |
| --- | --- | --- |
| Comprar/licenciar | Alin compra/licencia la familia oficial con soporte cirilico. | Nota no secreta con nombre de familia, proveedor, alcance de licencia y rutas revisadas; no guardar factura ni datos fiscales. |
| Mantener fallback | El ruso se lee correctamente y Alin acepta que la familia visual no sea identica hasta post-launch. | Riesgo aceptado o nota de decision con owner y seguimiento. |

Si se compra la fuente, instalarla solo con archivos/licencia permitidos, preferiblemente self-hosted o proveedor oficial, y verificar que `/ru` usa la misma familia visual que ES/EN sin fallback inesperado. No usar una fuente "parecida" como cierre de este punto si la decision final exige la familia oficial.

Ejecutar:

```bash
pnpm launch:live-domain-readonly -- --base-url https://espanolhonesto.com --host-variant https://www.espanolhonesto.com
pnpm launch:seo
pnpm launch:verify
pnpm launch:status
```

Revisar el summary de `launch:live-domain-readonly`, dominio final, robots, sitemap, canonical/hreflang, snippets, JSON-LD, `llms.txt`, Search Console o riesgo aceptado, Core Web Vitals o riesgo aceptado, exclusiones de campus/API/demo/private y la fila `marketing plan parity` de la worksheet SEO/LLM.

Evidencia manual:

- `seo_llm_final`
- `final_smoke` si la sustitucion de fuente cambia assets, layout o render visible.

### 7. Smoke Final

Ejecutar en staging primero si se tocaron secretos o integraciones. Ejecutar production solo cuando sea la decision final.

Cubrir:

- Registro/login.
- Checkout o bloqueo de checkout si no hay pagos reales.
- Webhook si hay pagos.
- Drive folder.
- Email.
- Reserva.
- Doc.
- Calendar/Meet.
- Recordatorio.
- Cancelacion.
- Retry/cancelacion de job desde Admin > Jobs.

Evidencia manual:

- `final_smoke`

No incluir emails privados, payloads completos, tarjetas ni URLs sensibles.

### 8. Gate Final Y Revision Secundaria

Cuando la evidencia manual final este actualizada:

```bash
pnpm launch:manual-evidence
pnpm launch:gate
pnpm launch:secondary-review
pnpm launch:status
```

Resultado aceptable:

- `READY`, o
- `READY_WITH_ACCEPTED_RISKS` si Alin acepta riesgos documentados no criticos.

Resultado no aceptable:

- Cualquier `BLOCKED`.
- Go/No-Go abierto sin evidencia.
- Legal, pagos, integraciones, SEO/LLM o smoke con evidencia indirecta.

## Evidencia Manual Final

Los checks que deben quedar cerrados o tener riesgo aceptado explicitamente:

- `legal_owner_controller`
- `legal_human_review`
- `payments_staging`
- `integration_readiness`
- `seo_llm_final`
- `final_smoke`

Segun cambios realizados durante la ventana final, repetir tambien:

- `security_external`
- `operations_external`
- `database_readiness`

## Decision De Alin

Antes de declarar `READY`, Alin debe confirmar:

- Si se aceptan pagos reales o no.
- Que legal esta revisado.
- Que la rotacion final de claves se ejecuto o se acepta un riesgo documentado.
- Que el backup/export final o upgrade Pro esta hecho si production sigue en Supabase Free.
- Que el smoke final representa el flujo real que se va a lanzar.

## Salida

El goal técnico de `RC_BASE_SHA` termina cuando el commit canónico está en `main`, CI está verde, el backup post-cierre y las reatestaciones inertes son válidos y `launch:status` enumera únicamente los cinco gates finales. No requiere ni autoriza ejecutar esta ventana de activación.

El lanzamiento público de `LAUNCH_SHA` solo puede cerrarse cuando:

- `pnpm launch:gate` pasa sin bloqueos o con riesgos aceptados explicitamente.
- `pnpm launch:secondary-review` pasa.
- `pnpm launch:status` muestra Fase 1, RC y Fase 3 sin abiertos incompatibles con `READY`.
- La checklist y `docs/launch/MANUAL_EVIDENCE.local.json` contienen evidencia no secreta y actual.
