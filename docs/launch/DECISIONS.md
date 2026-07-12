# Launch Decisions

Estado: activo. Este documento sustituye a auditorias antiguas.

## Arquitectura

Decision: Cloudflare Astro Worker para web/API y un Cloudflare Fulfillment Worker separado para jobs Google/Resend. El proyecto Pages `espanolhonesto` es legado y conserva temporalmente los dominios finales hasta que el Worker production se pruebe por URL directa y se apruebe el cutover.

Pros:
- Mantiene Cloudflare para la web SSR y la API transaccional.
- Evita anadir un proveedor extra.
- Mantiene jobs, health checks y logs dentro de Cloudflare.
- Conserva el limite entre el Astro Worker transaccional y Google/Resend.

Contras:
- Requiere `nodejs_compat` y validar las librerias Google/Resend en Workers.
- Requiere secreto interno y dos despliegues Worker separados.
- Requiere un cutover final controlado desde el Pages legado, sin borrar Pages antes de verificar el Worker production y su rollback.

## Entornos

Decision: mantener tres entornos: dev local, staging online y production online.

Decision operativa desde 2026-07-10: `pnpm dev` arranca en modo staging. El acceso local deliberado a datos production queda en `pnpm dev:production-data` y no se usa para QA normal.

Pros:
- Permite probar flujos reales sin tocar alumnos, pagos, Drive ni emails reales.
- Reduce el riesgo de mezclar datos de prueba con datos de produccion.
- Facilita validar migraciones, Stripe, Google y Resend antes de publicar.

Contras:
- Requiere duplicar configuracion en Supabase, Cloudflare, Google, Resend, Stripe y Sentry.
- Hay mas secretos que rotar y mantener.

Decision: Supabase staging y production seran proyectos separados dentro de la misma cuenta, no branching.

Pros:
- Aisla datos, service role keys, backups y migraciones de production.
- Encaja mejor con un launch con pagos/Google/Resend separados por entorno.
- Evita depender de una feature de branching para la operacion normal.

Contras:
- Hay que aplicar migraciones y revisar RLS/backups en dos proyectos.
- Requiere mantener dos juegos de keys y URLs.

Decision: mantener Supabase en plan Free durante el Release Candidate.

Pros:
- Evita sumar coste y cambios operativos antes de cerrar producto, legal, SEO/LLM, Stripe y despliegue final.
- Permite validar separacion staging/production, RLS, migraciones, datos de prueba y flujos de jobs sin cambiar de arquitectura.
- Hace explicita la restriccion real: Free no aporta backups programados nativos.

Contras:
- Antes de un deploy production, una migracion destructiva o una activacion publica definitiva, hay que ejecutar backup logico/manual fuera del repo o subir a Pro.
- No se puede usar "backups Supabase programados verificados" como evidencia de RC mientras el proyecto siga en Free.
- La recuperacion queda apoyada en migraciones, exports manuales y rollback de Cloudflare hasta que se contrate backup gestionado.

## Base De Datos Y API Surface

Decision: `support_tickets` se escribe desde el cliente autenticado, pero no se lee ni se gestiona directamente desde el cliente.

Pros:
- Permite que alumnos/profesores creen avisos sin exponer otros tickets.
- Mantiene la revision/cierre en APIs server-side con service role y RBAC admin.
- Reduce impacto si una policy de lectura se interpreta de forma demasiado amplia.

Contras:
- La API debe generar el ID del ticket antes de insertar y devolverlo sin hacer `select`.
- Cualquier vista futura de "mis tickets" requerira una policy nueva y pruebas dedicadas.

Decision: no usar `pg_graphql` en Supabase para este lanzamiento; la extension se retira porque la app no usa GraphQL.

Pros:
- Elimina avisos de exposicion GraphQL que no aportaban valor funcional.
- Reduce superficie publica de API.

Contras:
- Si en el futuro se quiere GraphQL, habra que reinstalar/configurar la extension y revisar permisos/RLS desde cero.

Decision: las comprobaciones admin de RLS usan `private.is_admin()` y las policies admin quedan scoped a `authenticated`.

Pros:
- Evita exponer helpers SECURITY DEFINER en el schema publico.
- Evita que roles anonimos evalueran funciones privadas en policies admin.
- Mantiene el patron de Supabase recomendado: grants limitan superficie y RLS limita filas.

Contras:
- Las policies admin dependen del schema `private` y de grants correctos para `authenticated`.
- Cualquier nueva tabla admin debe seguir este patron y probarse en staging/production.

Decision: reconciliar el contrato base del modelo con `20260712112000_reconcile_database_model_contract.sql` antes de las olas de esquema de aplicacion y del hardening RC.

Pros:
- Fija `leads.updated_at`, `lead_status`, `status`/`created_at` obligatorios, defaults y grants con el mismo contrato en staging y production.
- Elimina el helper residual `public.is_admin()` sin `CASCADE` y conserva exclusivamente `private.is_admin()`.
- Retira columnas legacy de sesiones solo despues de preservar sus valores en las columnas canonicas.
- Absorbe en el historial deployable `sessions.reminder_sent`, sus indices operativos, `idx_profiles_role` y la policy autenticada alumno -> profesor que antes solo existian en hosted/SQL manual.
- Reconstruye las 13 policies de identidad del campus con destino explicito `authenticated` y `(select auth.uid())`, conservando permisos y evitando evaluacion por fila o sobre roles publicos.
- La migracion de hardening posterior hace cumplir tambien en PostgreSQL las duraciones 30/40/50, ademas de impedir solapes activos de disponibilidad.
- Permite que el rollout verifique por efectos el modelo base antes de crear CRM, billing y los indices finales.

Contras:
- Staging debe aplicar y verificar juntas, en orden, `20260712112000`, `20260712114000`, `20260712114500` y `20260712115000` antes de autorizar production.
- Production incorpora una ola dedicada `base_model_reconciliation`; su hash y receipt deben regenerarse si cambia el SQL.

Decision: fijar explicitamente los grants de tablas de Data API con `20260712115000_harden_data_api_table_grants.sql`.

Pros:
- Elimina `TRUNCATE`, `REFERENCES` y `TRIGGER` heredados de defaults historicos, operaciones que RLS no protege.
- Alinea grants y policies: un `SELECT` anonimo para `packages`, 63 grants autenticados exactos y cero superficie cliente en seis tablas service-only.
- Revoca los defaults globales y los de `public` para tablas creadas por `postgres`, de modo que futuras tablas fallen cerradas hasta declarar su contrato Data API.
- Reafirma RLS en las 18 tablas que reciben algun grant cliente y el post-check exige 18/18 con RLS, cero tablas concedidas sin RLS y cero ACL cliente globales o de `public`.

Contras:
- Toda tabla publica futura que deba exponerse requerira grants explicitos ademas de RLS.
- Los default ACL administrados por `supabase_admin` pertenecen a la plataforma; el runner verifica los de `postgres`, propietario de las migraciones de la aplicacion.

Decision: la base de datos actua como ultima barrera semantica para relaciones alumno/profesor en operaciones de campus.

Pros:
- Impide que `student_teachers`, `sessions`, `subscriptions`, `payments`, `fulfillment_jobs` o `teacher_availability` guarden perfiles con rol incorrecto aunque el write venga de service role, seed, script o futura pantalla admin.
- Complementa las validaciones API sin crear roles nuevos.
- Reduce riesgo de corrupcion operacional en asignaciones, clases, pagos y jobs.

Contras:
- La migracion `020_enforce_profile_role_links.sql` debe aplicarse en entornos reales antes de confiar en esta barrera fuera del codigo local.
- Si ya existieran datos historicos con roles incoherentes, habria que limpiarlos antes o durante la aplicacion de la migracion.
- Cualquier flujo futuro que use perfiles no-estudiante/no-profesor en estas tablas tendra que redisenarse de forma explicita.

Decision: mantener `btree_gist` en `public` de momento.

Pros:
- Evita tocar la constraint de solape de sesiones justo antes del RC.
- Deja el advisor como deuda de hardening conocida, no como fallo oculto.

Contras:
- Supabase seguira avisando de extension en schema publico.
- Si se decide moverla, hay que planificarlo como migracion DB con backup/export previo.

## Deploy

Decision: `staging` despliega staging y `main` despliega production.

Decision: production requiere aprobacion manual desde GitHub Environments al principio.

Pros:
- Staging se mantiene siempre actualizado para validar.
- Production no cambia sin una decision explicita.
- CI bloquea despliegues si fallan typecheck, lint, tests, build o secrets-check.

Contras:
- El flujo tiene mas pasos que desplegar directo desde una rama.
- Puede requerir una aprobacion extra por cada deploy production.

## Google Workspace

Decision: mantener service account con domain-wide delegation.

Decision: no se crea un calendario separado de staging para este lanzamiento. Calendar crea eventos en `primary` de `GOOGLE_ADMIN_EMAIL` y la disponibilidad del profesor depende de `profiles.email`; ese acoplamiento se acepta y se verifica en el smoke. Drive y la plantilla si se separan por entorno. Staging usa exactamente `STAGING - Espanol Honesto` y `STAGING - Plantilla de clase`.

Pros:
- Encaja con la operativa actual.
- No exige OAuth por profesor/alumno.
- Permite automatizar Drive, Calendar, Docs y Meet.

Contras:
- Acceso privilegiado amplio.
- Requiere rotacion y control de scopes.

Riesgo aceptado para la fase actual:

- Alin acepta mantener este modelo de service account con domain-wide delegation para el lanzamiento actual porque no se puede cambiar a otro modelo de autenticacion antes de cerrar la version.
- Controles compensatorios: la clave privada no se guarda en repo, docs, outputs, capturas ni logs; los secretos viven solo en KeePassXC y secret managers; el acceso Google SDK sigue aislado en el Cloudflare Fulfillment Worker; el Astro Worker/API no importa Google SDK; staging y production usan carpetas/templates separados; la rotacion final de clave se ejecuta antes del Go/No-Go publico; los scopes delegados se revisan en esa rotacion; y queda una revision post-launch para migrar a scopes/OAuth mas estrechos cuando sea viable.
- Contencion si se sospecha compromiso: pausar checkout/jobs si hace falta, generar clave nueva, revocar la antigua, actualizar y redeplegar el Worker, validar Drive/Calendar/Docs/Meet y reintentar jobs desde Admin > Jobs.

## Drive

Decision: mantener carpetas accesibles con "anyone with link can view".

Pros:
- Baja friccion para alumnos sin Google al inicio.
- Compatible con la forma actual de dar clases.

Contras:
- Cualquier persona con enlace puede ver.
- Hay que evitar material sensible mientras el acceso sea por enlace.

## Productos Y Precios

Decision: Supabase `packages` es el catalogo comercial editable; `package_prices` es la fuente contractual inmutable de ofertas y Stripe ejecuta el cobro verificado. Los punteros Stripe de `packages` son una proyeccion escrita solo por RPC; CRM admin sincroniza el conjunto.

Decision: cambios de precio/cuota afectan solo nuevas compras.

Pros:
- No rompe condiciones existentes.
- Menos riesgo legal/soporte.
- Stripe Price IDs historicos se mantienen trazables.

Contras:
- Si se quiere migrar alumnos existentes, hara falta flujo manual o herramienta futura.

## Registro Y Pago

Decision: cuenta antes de pagar.

Decision: no existe compra publica directa. El admin aprueba un paquete concreto; Supabase emite un unico `checkout_intent` por alumno/aprobacion y Stripe Checkout es idempotente. El webhook no provisiona sin intent, Price real y snapshot coincidentes.

Decision: Español Honesto no acepta alumnos menores de 18 años. Solicitud, diagnóstico, registro y checkout exigen declaración expresa de mayoría de edad; leads, perfiles de alumno y checkout conservan versión y fecha de la declaración. El campus bloquea a alumnos sin declaración persistida y les ofrece un flujo de confirmación dedicado; administradores y profesores quedan fuera de ese bloqueo por rol. No se recoge fecha de nacimiento.

Decision de redirecciones Auth staging: `uri_allow_list` debe contener rutas exactas, sin `*`, `**`, clases, llaves, escapes ni equivalentes codificados. Se permiten únicamente las tres confirmaciones localizadas `/api/auth/confirm?lang=es|en|ru` y las tres recuperaciones `/{es|en|ru}/reset-password`, además de entradas exactas ya existentes. El runner bloquea antes de cualquier PATCH si el baseline o la lista requerida contiene un comodín amplio; no lo conserva ni lo elimina sin una autorización distinta.

Pros:
- Webhooks simples.
- Pago queda vinculado a usuario Supabase.
- Mejor recuperacion desde admin.

Contras:
- Mas friccion comercial.

Decision: el lanzamiento aceptará pagos reales desde el primer día. Stripe permanece en test durante staging y cambia a live únicamente en la ventana final, después del smoke test, los datos legales reales y el Go/No-Go.

Decision de aislamiento Stripe staging: usar un Sandbox general dedicado llamado `espanolhonesto-staging`, creado desde cero y configurado como España/EUR. El test mode clásico de la cuenta `acct_1SnNnoFhBCkSD61w`, configurada históricamente como Estados Unidos/USD, queda solo como referencia y no se enlaza a Supabase staging: contiene objetos antiguos/smoke y metadatos de paquetes con UUID que no corresponden al proyecto staging actual. La cuenta live receptora también debe verificarse como España/EUR antes de introducir claves live o activar cobros.

Decisión de alcance inicial del checkout: tarjeta mediante Stripe Checkout y sin códigos promocionales. Se podrán añadir otros métodos o promociones cuando su confirmación, reembolso, renovación, fiscalidad y copy contractual tengan pruebas específicas.

Decision fiscal provisional: staging trata los importes EUR publicados como el total exacto que Stripe debe cobrar y mantiene `automatic_tax` y Adaptive Pricing desactivados para evitar importes o monedas no reconciliables. Esta decisión técnica no determina por sí sola IVA/exención ni obligaciones de factura. Un asesor debe confirmar el tratamiento fiscal y los datos de facturación antes de crear Prices live o habilitar cobros reales.

Pros:
- Permite validar checkout, webhook, portal, reembolsos y reconciliación en test antes de aceptar dinero real.
- Mantiene el cambio a live como una operación pequeña, reversible y auditable mediante `CHECKOUT_ENABLED_OVERRIDE` mientras el default permanece cerrado.
- Evita mezclar Price IDs, webhook secrets o clientes test con live.

Contras:
- El lanzamiento no puede abrir tráfico de compra hasta que Stripe live, legal real, webhook, portal y smoke estén probados.
- Cualquier deploy posterior conserva el override; el runbook debe incluir rollback inmediato a `false`.

Decision comercial: las opciones de 1, 3 y 6 meses son suscripciones recurrentes por ese mismo periodo. El total se cobra al inicio; la renovación repite periodo e importe hasta cancelación. Cada compra concede un banco total de `sesiones_por_mes × meses` utilizable durante todo el periodo, sin tope mensual; la cifra mensual de la landing es una referencia comercial. La cuota no usada caduca al final y no pasa al periodo siguiente, sin perjuicio de derechos legales o excepciones aprobadas.

Decision operativa de grupos: `group` y `hybrid` se mantienen como opciones de solicitud, pero no pueden aprobarse ni comprarse en el lanzamiento. `group` requiere que el campus modele asistentes, agenda y consumo de cuota para una sesión grupal; `hybrid` requiere además un alta postpago que garantice y verifique dos profesores. El lanzamiento cobrable inicial se limita a `standard` y `bootcamp`; cada bloqueo se retira de forma independiente con una nueva versión contractual y pruebas del flujo prometido.

Decision de clases: cancelación del alumno con al menos 24 horas restaura la sesión; con menos antelación consume la sesión salvo excepción justificada. Un no-show solo puede marcarse desde 15 minutos después del inicio y consume la sesión. Ninguna reserva puede quedar después de `subscriptions.ends_at`.

Decision legal operativa: el consumidor dispone del desistimiento legal aplicable; si solicita inicio durante ese plazo, solo se descuenta la parte proporcional ya prestada cuando corresponda. Checkout recoge por separado mayoría de edad, términos/privacidad y solicitud de inicio. La confirmación de bienvenida incluye resumen contractual y enlaces permanentes.

## Launch Gate Y Riesgos

Decision: no aceptar riesgos en Fase 1; los checks inmediatos deben quedar en `pass`, no en `accepted_risk`.

Pros:
- Evita usar el Launch Gate para esconder deuda antes del release candidate.
- Mantiene claro que limpieza, contenido, accesibilidad, DB, operacion y seguridad externa son trabajo real.
- Reduce la probabilidad de READY falso.

Contras:
- Exige mas comprobaciones humanas antes de congelar RC.
- Puede retrasar el cierre de Fase 1.

Decision: Alin revisa manualmente contenido ES/EN/RU; Codex puede asistir con auditorias y hallazgos, pero la aprobacion final de tono, precios, emails y estados es humana.

Pros:
- Mantiene criterio de marca y oferta en manos de Alin.
- Evita que una auditoria automatica sustituya una revision editorial real.

Contras:
- Requiere tiempo humano antes de cerrar `content_review`.

Decision: Codex hara la parte automatizable de accesibilidad; teclado real, lector de pantalla, zoom, mobile real y formularios criticos quedan como tareas humanas de Alin antes de cerrar `accessibility_manual`.

Pros:
- Axe/Playwright cubren regresiones mecanicas y rutas criticas.
- Las comprobaciones que requieren percepcion humana o dispositivo real no se fingen.

Contras:
- `accessibility_manual` sigue bloqueado hasta completar esa pasada humana.

## Operacion

Decision: automatizacion completa con recovery UI.

Admin debe poder:

- Gestionar paquetes/precios/cuotas.
- Sincronizar Stripe.
- Ver jobs.
- Reintentar o cancelar jobs.
- Procesar pendientes manualmente.
- Gestionar alumnos, profesores, asignaciones, clases y pagos.

Decision: las incidencias normales de soporte se gestionan como tickets en Supabase y campus admin; Sentry se reserva para excepciones tecnicas.

Pros:
- El campus queda como fuente de verdad operativa para avisos de alumnos/profesores.
- El email a `alejandro@espanolhonesto.com` funciona como notificacion, no como unico registro.
- Sentry no se llena de incidencias que no son errores de software.

Contras:
- Requiere mantener tabla, RLS, vista admin y proceso de cierre de tickets.
- Las alertas por email pueden fallar aunque el ticket quede guardado.

Decision: la rotacion final de claves queda como accion final-only, con proceso definido en `docs/launch/RUNBOOK.md` y `docs/launch/ENVIRONMENT.md`.

Pros:
- Evita cambiar secretos varias veces antes de estabilizar legal, dominios, Stripe y smoke final.
- Mantiene el Release Candidate bloqueado por evidencia real, no por una rotacion prematura.
- Deja un orden auditable para rotar staging, production, validar y revocar claves antiguas.

Contras:
- El lanzamiento publico no puede declararse `READY` hasta ejecutar la rotacion y registrar evidencia no secreta.
- La ventana final requiere disciplina operativa: actualizar consumidores, validar smoke y revocar claves antiguas.

Decision: reviews, canal publico de Telegram, telemetria de uso y prueba de nivel definitiva quedan para el cierre final o post-RC.

Pros:
- Evita bloquear el RC con piezas de marketing/analitica todavia no decididas.
- La telemetria se decide despues de revisar privacidad, cookies y consentimiento.
- La prueba de nivel se puede definir con mas criterio cuando este cerrado el contenido comercial.

Contras:
- La landing puede lanzarse inicialmente sin prueba social real ni canal comunitario publico.
- Si se quiere telemetria rica, hara falta actualizar legal/cookies antes de activarla.

Decision: el backlog post-launch vive en `docs/launch/POST_LAUNCH_BACKLOG.md` y no desbloquea el Launch Gate.

Pros:
- Evita mezclar tareas aplazadas con bloqueos Go/No-Go.
- Mantiene visibles reviews, Telegram, telemetria, prueba de nivel, fuente, fotos, Google final, Stripe live y rotacion de claves sin fingir que estan listas.
- Permite mover cualquier tarea al launch de forma explicita si cambia el alcance.

Contras:
- Requiere revisar el backlog cuando cambie producto, legal, marketing o integraciones.
- Si se activa una tarea aplazada antes del lanzamiento, hay que actualizar checklist, evidencias y volver a ejecutar el Gate.

Decision: la solicitud de plaza publica recoge datos minimos de encaje antes de compra directa: interes, nivel aproximado, objetivo, disponibilidad y pagina de origen. No es una prueba de nivel definitiva. El CRM admin filtra solicitudes por estado y registra los cambios de estado en `admin_audit_log`. El email automatico confirma que primero se revisa encaje/nivel/disponibilidad y no empuja a comprar. La prueba de nivel definitiva sigue aplazada hasta decidir formato/rubrica, privacidad, consentimiento, retencion y canal de envio.

Pros:
- Permite revisar si el alumno encaja sin obligarle a pagar primero.
- Da contexto suficiente para responder con prueba automatica, diagnostico humano o plan recomendado.
- Evita que un email repetido rompa el formulario: el lead se actualiza por email y vuelve a estado `new`.
- Deja trazabilidad de seguimiento comercial basico sin incorporar un CRM externo antes del lanzamiento.

Contras:
- Requiere mantener la tabla `leads`, el CRM admin y la migracion `018_enrich_leads_for_application.sql`.
- No sustituye una prueba de nivel real con rubrica, audio/video o revision humana.

Decision: la arquitectura publica de conversion del RC queda documentada en `docs/launch/CONVERSION_ARCHITECTURE.md`.

Pros:
- Evita que la landing empuje pagos a ciegas antes de verificar encaje.
- Alinea home, paginas SEO, formulario, email automatico y CRM admin.
- Permite abrir el lanzamiento con un flujo comercial humano aunque Stripe live quede final-only.

Contras:
- Puede reducir compras impulsivas.
- Requiere responder solicitudes con criterio y mantener el estado del CRM al dia.

Decision: las subidas de sourcemaps a Sentry se permiten solo en CI/deploy o con `SENTRY_UPLOAD_SOURCEMAPS=true`.

Pros:
- Evita escrituras externas accidentales al ejecutar `pnpm build` local con `.dev.vars`.
- Mantiene sourcemaps disponibles en despliegues controlados.

Contras:
- Si se quiere depurar una build local en Sentry, hay que activar la bandera de forma explicita.

## Marketing, SEO Y LLM

Decision: el posicionamiento de lanzamiento prioriza adultos/profesionales +30, nivel A2/B1 o superior, poder adquisitivo medio-alto y curiosidad cultural real por vivir Espana con conversacion, cultura, criterio y comunidad.

Pros:
- Diferencia la oferta de clases genericas, baratas o milagrosas.
- Alinea SEO, landing, planes y prueba de nivel con un alumno que valora profundidad, materiales y seguimiento.
- Permite filtrar mejor antes de aceptar plazas y evita vender grupos si no hay compatibilidad real.

Contras:
- Reduce deliberadamente el volumen de leads de bajo compromiso.
- Exige copy mas especifico y paginas SEO por intencion, no solo una landing generica.
- La parte de comunidad debe crecer con cuidado para no prometer algo que aun no esta operativo.

Decision: anadir `/llms.txt` como mapa publico opcional para asistentes y motores AI, sin sustituir `robots.txt`, sitemap, canonical/hreflang ni JSON-LD.

Pros:
- Da a modelos y asistentes una fuente breve con paginas publicas, paquetes actuales y limites claros.
- Reduce la probabilidad de que campus, API, demo o rutas privadas se interpreten como contenido publico.
- Es barato de mantener mientras el catalogo publico sea pequeno.

Contras:
- `llms.txt` es una propuesta emergente, no una garantia de indexacion ni ranking.
- Hay que revisarlo cuando cambien paquetes, copy, legal o rutas publicas.

Decision: JSON-LD de landings debe generarse desde paquetes activos, no desde copy legacy hardcodeada.

Pros:
- Evita que buscadores y LLMs lean precios/planes obsoletos.
- Mantiene coherencia entre UI, Supabase `packages` y datos estructurados.

Contras:
- La landing depende de Supabase para renderizar datos estructurados completos.
- Si Supabase falla, el schema no debe inventar cursos/precios de fallback.

Decision: el Release Candidate usa tres paginas SEO de intencion, no paginas locales por ciudad: `/es/espanol-para-vivir-en-espana`, `/es/espanol-para-profesionales` y `/es/clases-de-conversacion-en-espanol`.

Pros:
- Cubre las tres busquedas con mas encaje inmediato: vivir Espana con profundidad, espanol profesional para trabajo/ciudad y conversacion A2/B1+ para desbloquear habla.
- Evita crear paginas doorway por Madrid, Oviedo, Toledo/Castilla-La Mancha o Barcelona sin contenido local suficiente.
- Mantiene el CTA en solicitar plaza y la prueba de nivel definitiva fuera del RC.
- Deja una arquitectura clara para buscadores y LLMs: home de marca, tres paginas de intencion, blog y `llms.txt`.

Contras:
- No explota todavia busquedas locales por ciudad.
- El crecimiento SEO posterior dependera de contenido real, reviews autorizadas, Search Console y aprendizaje post-launch.

Decision: mantener un unico goal de lanzamiento y usar `docs/launch/LAUNCH_MARKETING_PLAN.md` como criterio comercial canonico antes de nuevos cambios de copy, oferta o SEO.

Pros:
- Evita abrir goals paralelos para marketing, SEO y cierre tecnico cuando el lanzamiento sigue siendo un sistema unico.
- Deja por escrito que el plan hibrido es el principal de posicionamiento, el estandar es el formato operativo mas estable y el grupal solo se vende si hay compatibilidad real.
- Aclara que idiomas, ciudades, prueba de nivel, Telegram, reviews y telemetria no deben convertirse en promesas publicas sin operacion y evidencia.

Contras:
- El documento requiere mantenimiento cuando cambien precios, paginas, mercado prioritario o modo de pago.
- Algunas decisiones comerciales siguen siendo hipotesis hasta tener solicitudes reales.

## Documentacion

Decision: borrar documentos historicos tras extraer decisiones vigentes. Mantener solo docs canonicos actuales.
