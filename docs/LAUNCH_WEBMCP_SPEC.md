# Lanzamiento de Español Honesto: alcance, tareas y criterio de cierre

## Propósito

Este documento define el trabajo restante para abrir Español Honesto a compras reales y operar sus primeras cinco plazas. Es el documento único del goal de lanzamiento solicitado por el propietario el 5 de septiembre de 2026. Sustituye la lista anterior de tareas H/E/D/V; no crea una segunda cola ni un sistema de seguimiento paralelo.

El progreso se expresa mediante tareas terminadas y resultados comprobados. No se asignan porcentajes globales ni se estima el cierre por tiempo. El código, las migraciones, las PR, CI y las comprobaciones de proveedor siguen siendo la evidencia; este documento conserva alcance, dependencias y criterios de aceptación.

WebMCP es una mejora progresiva de la web. Debe reutilizar la oferta, la disponibilidad, la interfaz, la autenticación y las reglas de negocio existentes. La web completa debe seguir funcionando en navegadores sin WebMCP.

## Autoridad

- El código, las migraciones, la configuración ejecutable y las pruebas describen el comportamiento real.
- docs/PRODUCT.md es la autoridad sobre oferta, precio, políticas y experiencia del alumno.
- docs/ENVIRONMENTS.md y docs/OPERATIONS.md son la autoridad sobre proveedores, recursos, despliegue, recuperación y operaciones.
- ARCHITECTURE.md es la autoridad sobre límites estructurales.
- Esta especificación define los requisitos de lanzamiento y su orden de dependencia. La petición explícita del propietario autoriza mantener aquí este plan, como excepción concreta a la prohibición general de crear sistemas persistentes de planificación. No autoriza otros tableros, informes periódicos, handoffs ni carpetas de evidencia.
- Un cambio de precio, oferta, política, proveedor, tratamiento legal o comportamiento de negocio exige decisión del propietario y actualización coordinada del código y de la documentación.

## Objetivo y definición de terminado

**Goal:** completar las tareas obligatorias T01–T23 para publicar el candidato integrado de Español Honesto en la arquitectura de producción aprobada, abrir la oferta real de cuatro clases individuales de 50 minutos por 259 EUR cada 28 días, preparar las cinco plazas iniciales de Álex e Irene y acreditar compra, acceso, prestación, incidencias, renovación, devolución, remuneración y conciliación. El resultado conserva WebMCP como mejora progresiva, descubrimiento técnico, soporte y recuperación. Las escrituras externas y el dinero real se ejecutan únicamente después de la autorización específica correspondiente.

El lanzamiento está completo cuando:

- espanolhonesto.com sirve la misma versión certificada en escritorio y móvil, con HTTPS, rutas canónicas y un flujo humano de compra funcional.
- La oferta pública, la disponibilidad, las fechas, la renovación, la garantía, los textos legales, Stripe, los correos, los datos estructurados, llms.txt y WebMCP cuentan la misma verdad.
- Google puede rastrear las páginas canónicas elegidas; sitemap.xml responde correctamente, Search Console permite inspeccionar la propiedad y el sitemap está enviado. Una URL nueva todavía pendiente de indexación no impide el cierre si la comprobación en vivo acredita que es rastreable y el envío fue aceptado.
- Los agentes pueden descubrir herramientas WebMCP al visitar la página, consultar la oferta y las plazas, preparar un brief y abrir una plaza en la revisión visible.
- La persona conserva la autenticación, las declaraciones legales, Turnstile y la autorización de pago.
- Cada alumno recibe material individual de Google Drive con acceso nominal, incluso si su correo no es Gmail, sin depender de enlaces públicos.
- La observabilidad, el soporte, la recuperación y el rollback han sido probados antes de aceptar dinero real.
- No se incurre en gasto de infraestructura o publicidad sin una decisión explícita y un control de coste apropiado.

El goal solo termina cuando T01–T23 están cerradas: candidato integrado y verificado, producción operativa, inventario inicial comprobado, checkout abierto con autorización, compra y devolución controladas conciliadas y sin incidencias críticas pendientes. Preparar un documento, pasar pruebas locales, desplegar con checkout apagado o quedarse a la espera de una autorización no completa el goal.

La renovación y las excepciones se acreditan en Sandbox antes de abrir dinero real. La comprobación live confirma la configuración y el primer recorrido autorizado; no exige esperar un cobro automático futuro ni fabricar una renovación real. Preparar cinco plazas no exige conseguir cinco compradores: tras la prueba, el inventario debe reflejar correctamente las plazas disponibles, ocupadas o retiradas según el resultado autorizado.

Conseguir alumnos, observar la primera renovación real, mejorar CAC o retención y obtener posiciones o citas en buscadores pertenecen al piloto posterior. No se prolonga este goal para esperar demanda, indexación, tráfico o resultados comerciales.

## Punto de partida comprobado el 5 de septiembre de 2026

| Superficie | Comprobado | Qué no acredita |
|---|---|---|
| Código local | Typecheck de aplicación y fulfillment, build y lint pasan; lint conserva dos avisos. Pasan las 2.073 pruebas de 241 archivos con dos procesos, las 11 del MCP y 53 pruebas públicas de navegador sobre el Worker compilado; tres casos de modos desactivados se omiten. Auditoría de dependencias de producción: cero vulnerabilidades reportadas | El navegador usa proveedores aislados o simulados; no certifica cuentas reales, integración remota ni cambios futuros |
| Integración | GitHub main y staging corresponden a `ecf3d691abf53ea7575763f2ff04f0256425f580`; despliegue de staging correcto | Astro 7.3.1, WebMCP, fotografía y otros cambios locales aún necesitan integración |
| Producción web | Pages `espanolhonesto`, despliegue del 8 de marzo de 2026 | No contiene el candidato actual; el adaptador moderno de Astro no admite ese destino para la aplicación dinámica |
| Datos | Staging registra las 76 migraciones del repositorio. Producción no registra las 28 del nuevo bloque de negocio desde finales de julio y carece de las tablas principales de Checkout V2 | El historial antiguo de producción requiere reconciliación; no se aplica una diferencia de nombres a ciegas |
| Capacidad | Staging tiene cero plazas disponibles; solo plazas históricas vendidas o retiradas | No existen aún cinco plazas reales acreditadas para el lanzamiento |
| Materiales | El flujo integrado crea acceso `anyone/reader` | No acredita privacidad nominal ni acceso de visitante completo |
| Medición | Search Console y su MCP de lectura constan verificados el 4 de septiembre | No demuestra indexación de URLs nuevas, tráfico, conversión ni recepción actual de analítica |

Esta es una referencia inicial, no una certificación permanente. Solo se repiten comprobaciones cuando el candidato, la configuración, los permisos o el resultado anterior lo justifiquen. No se reconstruye el estado contando casillas de issues históricos.

## Decisiones de producto para el lanzamiento

### Oferta

La oferta inicial es la definida en docs/PRODUCT.md: cuatro clases individuales online de 50 minutos por 259 EUR cada 28 días, para personas adultas, con profesor, franja semanal, cuatro fechas y siguiente renovación visibles antes del pago.

La disponibilidad pública procede del inventario real. Una herramienta, texto estático o contador no puede afirmar que una plaza está libre sin consultarlo y revalidarlo.

### Reserva asistida por agentes

“Reservar con un agente” significa que el agente puede realizar la parte informativa y preparatoria en la misma página que ve la persona:

1. explicar la oferta y sus límites;
2. comprobar el encaje declarado;
3. consultar y comparar plazas actuales en la zona horaria solicitada;
4. preparar un brief editable;
5. seleccionar una plaza y abrir la revisión visible.

La persona debe identificarse, declarar la mayoría de edad, aceptar las condiciones y el inicio del servicio cuando corresponda, superar el control antiabuso y autorizar Stripe Checkout. Una herramienta no puede simular, ocultar ni completar esas decisiones.

Una futura acción transaccional solo podrá estudiarse después de una decisión de producto que actualice `docs/PRODUCT.md`. Además tendría que usar el mismo backend, declarar su efecto como consecuente, presentar una confirmación humana específica y conservar las garantías de autenticación, inventario, idempotencia y pago. No es necesaria para el primer lanzamiento.

### Material de clase en Google Drive

Este es el contrato objetivo, todavía pendiente de desarrollo y acreditación. El flujo integrado actual crea acceso `anyone/reader`, solo añade lectores nominales sobre la raíz y no implementa aún roles por documento ni revocación completa:

- Los originales y plantillas canónicas permanecen restringidos al equipo.
- Cada alumno recibe una copia o carpeta individual compartida con la dirección de correo de su matrícula.
- El rol predeterminado para documentos de trabajo es editor; los materiales de referencia usan comentarista o lector según la actividad.
- El alumno puede abrir el documento durante la sesión, interactuar según su rol y descargar archivos individuales.
- Los correos sin cuenta de Google usan Visitor Sharing con PIN si la política de Workspace lo permite.
- El acceso de visitante se vuelve a verificar periódicamente; el alumno conserva el correo de invitación para renovar la sesión cuando Google lo solicite.
- El estado objetivo no contiene permisos “cualquiera con el enlace” en carpetas de alumnos.
- La migración de permisos debe crear primero el acceso nominal, probarlo con una identidad externa y retirar después el permiso público. No se realiza un corte masivo sin prueba y rollback.

## Límites del primer lanzamiento

Quedan fuera:

- menores, grupos, híbrido, intensivos, marketplace docente y duraciones o descuentos distintos;
- un motor de reservas exclusivo para WebMCP;
- aceptación autónoma de condiciones, resolución de Turnstile o autorización autónoma de pago;
- acceso WebMCP al campus, documentos privados, CRM, pagos o datos internos;
- Meta Ads, Google Ads y cualquier campaña pagada antes de disponer de una página estable, medición mínima y un presupuesto aprobado;
- Google Ad Manager, porque el proyecto no vende inventario publicitario de un sitio editorial;
- publicación de un MCP remoto para clientes antes de estabilizar la web y las herramientas de página.

## Preparación del entorno

### Conectores de lanzamiento y ampliaciones

| Sistema | Uso de lanzamiento | Acceso objetivo |
|---|---|---|
| GitHub | Código, revisión y CI | Lectura y escrituras de repositorio con revisión |
| Cloudflare Pages, DNS, Turnstile y Web Analytics | Web pública, protección y medición básica | Producción canónica: Pages project `espanolhonesto`; lectura ordinaria y gate manual antes de despliegue, DNS o cambios |
| Cloudflare Workers y colas | Fulfillment acreditado en staging | Los recursos de producción están reservados fuera de alcance hasta una decisión de arquitectura y configuración ejecutable propias |
| Supabase | Auth, datos, inventario y operación | Lectura ordinaria; gate manual antes de DDL o datos de producción |
| Stripe | Checkout, suscripción, portal y devoluciones | Sandbox durante desarrollo; gate separado para live |
| Google Drive | Material de campus | Acceso nominal por alumno; gate antes de cambiar permisos |
| Google Calendar | Sesiones y operación docente | Mínimo alcance necesario |
| Gmail y Resend | Mensajes operativos | Identidad exacta verificada antes de enviar |
| Sentry | Errores de producción | Lectura y datos minimizados |
| Search Console | Indexación, rendimiento y diagnóstico SEO | MCP local de solo lectura limitado a sc-domain:espanolhonesto.com |
| Bing Webmaster Tools | Ampliación de indexación y citas después del cierre comercial | Verificación posterior autorizada; no requiere MCP ni bloquea T23 |

No hace falta un conector de Google Workspace Admin para el trabajo cotidiano. La política de Visitor Sharing es una comprobación administrativa puntual.

### MCP de Search Console

El MCP de Search Console debe ser propiedad del proyecto y tener una superficie mínima:

- transporte local stdio;
- OAuth de usuario mediante Application Default Credentials;
- único scope webmasters.readonly;
- propiedad fija sc-domain:espanolhonesto.com;
- herramientas de ping, Search Analytics, inspección de URL y listado de sitemaps;
- sin enumeración de propiedades, Indexing API ni operaciones de alta, envío o borrado;
- inspección limitada a HTTPS y a espanolhonesto.com o sus subdominios;
- esquemas estrictos, errores saneados y ausencia de tokens o cuerpos de Google en logs.

El navegador solo se usa una vez para que el propietario otorgue el consentimiento OAuth. Después Codex utiliza el MCP para lecturas; no se gestiona Search Console haciendo clic en el navegador. Enviar o retirar un sitemap sigue siendo una acción administrativa manual y autorizada fuera de este MCP.

### Gasto

- Search Console y su API son gratuitos y no necesitan una cuenta de facturación vinculada.
- Antes de mantener facturación vinculada a un proyecto de Google Cloud se inspeccionan sus servicios y recursos activos.
- Un presupuesto de alertas de Google Cloud avisa, pero no impide el gasto.
- Se aplican cuotas, restricciones de API y controles propios de cada servicio. Google Cloud no ofrece un tope duro universal que cubra todos sus productos, y los Spend Caps solo están disponibles para servicios compatibles.
- Si solo se usan APIs gratuitas que no requieren facturación, la opción de menor riesgo es no vincular facturación.
- Cloudflare, Supabase y Stripe se mantienen en sus planes o modos actuales hasta que un cambio necesario tenga preflight de coste y aprobación.
- Ningún MCP recibe permiso para crear campañas publicitarias o elevar presupuestos en el primer lanzamiento.

### Medición inicial

- Search Console mide descubrimiento orgánico en Google: consultas, impresiones, clics, páginas, países, dispositivos e indexación. No mide por sí solo reservas ni pagos.
- Cloudflare Web Analytics es la base inicial para páginas vistas y Core Web Vitals porque está disponible sin cookies y Cloudflare declara que no recopila ni usa datos personales de los visitantes. El preflight confirma que la instalación automática está habilitada para el Pages project de producción `espanolhonesto`; ese ajuste no demuestra por sí solo que el beacon ya reciba datos. Antes de usar sus datos para decidir se comprueban la recepción real, la configuración y el texto de privacidad aplicable.
- Las conversiones proceden de eventos first-party del CRM/Supabase y del estado confirmado de Stripe; Cloudflare Web Analytics no convierte una página vista en una reserva acreditada.
- Sentry cubre errores técnicos con datos minimizados.
- GA4 no es requisito de lanzamiento. Se reevalúa cuando haya campañas pagadas o una necesidad de atribución que no cubra la medición inicial. Si se activa, se revisan consentimiento y privacidad y se usa el MCP oficial experimental de Google Analytics en modo de solo lectura y limitado a la propiedad exacta.

## Descubrimiento en Google y por agentes

### Google Search

La versión candidata debe:

- responder 200 en las páginas canónicas que se quieran indexar;
- redirigir de forma única y coherente entre variantes con y sin barra final;
- usar canonical y hreflang coherentes con el sitemap;
- servir sitemap.xml desde la raíz con URLs absolutas canónicas;
- anunciar ese sitemap en robots.txt;
- no aplicar noindex, X-Robots-Tag o bloqueos involuntarios a producción;
- mantener staging y rutas privadas en noindex y fuera del sitemap;
- incluir datos estructurados que describan únicamente la oferta real;
- publicar contenido útil y original para adultos interesados en español, empezando por la captación en inglés para Estados Unidos;
- evitar páginas a escala que solo reformulen contenido sin aportar valor;
- enviar el sitemap manualmente en Search Console mediante una acción administrativa autorizada y comprobar portada, oferta, páginas de captación y artículos representativos con el MCP de solo lectura.

Search Console es la fuente de verdad para impresiones, clics, consultas, páginas, países y dispositivos en Google. La medición dentro de la web puede hacerse con una herramienta separada y respetuosa con el consentimiento.

### Bing y descubrimiento por IA

Este bloque queda después del cierre comercial definido en T23; no condiciona la apertura de pagos. Se conserva como ampliación de descubrimiento, separada del requisito de rastreabilidad y medición mínima.

- Después de verificar Search Console y cerrar el lanzamiento comercial, se añade el dominio a Bing Webmaster Tools, preferiblemente importando la propiedad y el sitemap ya verificados.
- En ese trabajo posterior se implementa IndexNow para avisar de URLs canónicas nuevas, modificadas o eliminadas después de un despliegue correcto. IndexNow complementa el rastreo de los motores participantes; no sustituye el sitemap ni envía señales a Google. Solo producción puede emitir avisos y únicamente después de un preflight del host/clave y autorización de envío.
- Bing Webmaster Tools sirve también para observar, mientras permanezca en public preview, el informe AI Performance cuando haya datos: citas, páginas citadas y consultas de grounding en Copilot y superficies compatibles.
- Para esta fase no hace falta un MCP de Bing. La integración ligera es la verificación del sitio, el sitemap e IndexNow; se reconsidera una API o MCP solo cuando exista una tarea operativa repetitiva que lo justifique.

### Agentes

- llms.txt resume fuentes canónicas, oferta, políticas y límites, sin datos privados ni afirmaciones de disponibilidad estática.
- Las páginas públicas entregan HTML útil, títulos, descripciones, enlaces internos y datos estructurados aun sin JavaScript.
- OAI-SearchBot y otros rastreadores deseados se deciden explícitamente en robots.txt.
- WebMCP permite acciones cuando el agente ya visita una página compatible; no garantiza descubrimiento desde una conversación vacía ni posicionamiento.
- La misma información pública debe poder verificarse en la interfaz ordinaria.

## Contrato WebMCP inicial

Las herramientas se registran en la página de nivel superior mediante document.modelContext.registerTool y se eliminan al desmontar la página. Los navegadores sin soporte conservan toda la experiencia humana.

| Herramienta | Efecto permitido |
|---|---|
| get_academy_offer | Leer la oferta canónica y sus límites |
| check_fit | Evaluar solo las condiciones explícitas declaradas por la persona |
| list_bookable_slots | Leer disponibilidad pública paginada y convertir fechas a la zona horaria solicitada |
| draft_learning_brief | Actualizar un brief local, visible y editable, sin enviarlo al CRM |
| prepare_booking_review | Revalidar una plaza y abrirla en la revisión o el login visibles |
| clear_booking_draft | Limpiar el brief, la selección y la revisión visibles |

Requisitos:

- nombres y descripciones precisos, breves y sin presión comercial;
- argumentos validados en runtime, con esquemas que no admiten propiedades adicionales;
- señal de cancelación propagada a las consultas de red;
- fecha, fuente y entorno incluidos en resultados volátiles;
- contenido de profesores, usuarios o proveedores marcado como no confiable;
- anotación de solo lectura únicamente para herramientas que no cambian estado;
- cambios de interfaz visibles, reversibles y anunciados de forma accesible;
- ninguna herramienta puede acceder a campus, credenciales, IDs internos, datos de pago o datos personales innecesarios;
- ninguna herramienta puede afirmar que una plaza está retenida o comprada sin confirmación del backend;
- descripciones y resultados con un tamaño acotado.

## Criterio para clasificar y cerrar tareas

Una tarea es obligatoria si protege dinero o datos, hace ejecutable una promesa del producto inicial, permite operar sus cinco plazas o acredita el candidato publicado. Una mejora de captación o escala que no cumpla ese criterio no bloquea la apertura. WebMCP mantiene sus seis herramientas porque ya forma parte de la experiencia acordada; no se amplía su alcance.

Estados permitidos: `pendiente`, `en curso`, `preparada para autorización` y `cerrada`. Solo se marca `cerrada` si se cumplen todos sus criterios sobre el código integrado y, cuando proceda, en el recurso exacto. Una implementación local, un mock o un preflight no se presentan como una operación externa terminada.

Cada cierre incorpora una referencia breve a la PR/commit, ejecución nativa o resultado de proveedor que lo acredita, sin copiar logs, secretos, datos personales ni crear un informe paralelo. Si un cambio posterior invalida un criterio se reabre únicamente la tarea afectada. No se repiten suites completas ni acreditaciones independientes por rutina.

Las dependencias siguientes son de cierre: se permite preparar código, propuestas y pruebas locales antes de recibir un input humano o cerrar otra tarea. Una autorización pendiente detiene exclusivamente las acciones dependientes, no el trabajo independiente del goal.

## Tareas obligatorias

### Base técnica y producción

#### T01 — Integrar el trabajo local y fijar la base del candidato

Estado: en curso; candidato local preparado en `codex/launch-candidate`, pendiente de revisión e integración remotas. Responsable: Codex. Depende de: ninguna.

- Clasificar los cambios existentes, conservar trabajo ajeno y excluir credenciales y artefactos locales. Integrar Astro, WebMCP, fotografía y demás cambios aceptados en cambios revisables, sin reinstalar Search Console por inercia.
- Mantener pnpm, lockfile e integraciones coherentes; revisar vulnerabilidades aplicables. Resolver las moderadas/altas de Astro que motivaron la migración y cualquier vulnerabilidad explotable en la superficie pública o de privilegios del candidato.
- Cerrar con PR revisada, integración autorizada y CI requerida verde. El commit integrado será la base; los cambios posteriores también se integrarán antes de T19.

Comprobaciones locales del 5 de septiembre: `pnpm run typecheck`, `pnpm run fulfillment:typecheck`, `pnpm run lint` y `pnpm run build` correctos; `pnpm run test:run -- --maxWorkers=2 --silent --reporter=dot`: 2.073 pruebas; `pnpm run test:e2e`: 53 correctas y tres omitidas por configuración; `pnpm --filter @espanol-honesto/searchconsole-mcp test`: 11 correctas; `pnpm audit --prod --json`: cero vulnerabilidades reportadas; `pnpm run secrets:check` y `git diff --check`: correctos. Los dos avisos de lint corresponden a exportaciones de `ResponsiveTurnstile.tsx`. La CI incorpora ahora la compilación y las pruebas del MCP, que no cubrían el typecheck ni Vitest de la aplicación.

La PR [#115, CTA público a Contactar mientras el checkout está cerrado](https://github.com/codingships/honestSpanish/pull/115), sigue abierta y GitHub la presenta sin posibilidad de merge directo. Se revisará su intención frente al producto actual antes de adaptarla o proponer su cierre; no se mezcla por inercia con el candidato. La publicación de la nueva rama y su PR requieren el gate manual de GitHub para `codingships/honestSpanish`.

#### T02 — Resolver y aprobar la arquitectura productiva

Estado: propuesta preparada; pendiente de decisión y acreditación del coste contratado. Responsable: Codex prepara; propietario decide. Depende de: ninguna.

- Presentar una propuesta concreta compatible con Astro actual: runtime web, procesamiento de trabajos, colas si corresponden, dominios, analítica, costes y recuperación. Recomendación inicial: evaluar Workers por compatibilidad con el adaptador y la arquitectura ya comprobada en staging.
- La decisión identifica cada recurso nuevo o existente y las acciones autorizadas. Hasta aprobarla, Pages sigue siendo la producción canónica y los Workers de producción reservados siguen fuera de alcance.
- Actualizar juntos el mapa de entornos, operaciones y arquitectura tras la decisión. No se considera decidido por haber escrito esta recomendación.

##### Propuesta concreta sometida a decisión

Usar Cloudflare Workers para la aplicación Astro y sus assets, con un segundo Worker para fulfillment, una cola de señales y su DLQ. Supabase conserva Auth y los datos; `fulfillment_jobs` sigue siendo la fuente de verdad del trabajo, por lo que perder o repetir una señal no autoriza duplicar una operación. Es la topología ya ensayada en staging. El adaptador actual de Astro [ha retirado el soporte de Cloudflare Pages](https://docs.astro.build/en/guides/integrations-guide/cloudflare/#removed-cloudflare-pages-support); mantener Pages exigiría otro candidato técnico y una nueva comprobación de seguridad y compatibilidad.

El preflight de lectura del 5 de septiembre identifica la cuenta Cloudflare `d1a22bcf6477ff2ff31d2bfb83084e44`, de `Alindev95@gmail.com`, y la zona `espanolhonesto.com` (`137264d6df2c82a7ccaf3f2d2e2464e4`). Recursos de la propuesta:

| Recurso exacto | Estado observado | Acción propuesta, todavía no autorizada |
|---|---|---|
| Pages project `espanolhonesto` | Producción canónica actual, con los dominios raíz y www | Conservar proyecto y versión; trasladar sus dominios al runtime aprobado solo en T20 |
| Worker `espanolhonesto` | Reservado; tiene binding al Worker de fulfillment y carece de custom domains públicos | Reutilizar para el candidato web con configuración y secretos completos propios de producción |
| Worker `espanol-honesto-fulfillment-production` | Reservado; no muestra binding de cola en sus ajustes | Reutilizar como servicio privado y consumidor; habilitar cron y efectos únicamente tras validar datos, configuración y permisos |
| Queue `espanol-honesto-fulfillment-production-queue` (`f00c0885eadb475cb9b513a4a7a8fcff`) | Cero productores y consumidores registrados | Conectar productor/consumidor con concurrencia limitada e idempotencia |
| Queue `espanol-honesto-fulfillment-production-dlq` (`e59a210ecfe243ddba945accee9f4b5a`) | Cero productores y consumidores registrados | Configurar como destino de mensajes agotados y ensayar su recuperación |
| `espanolhonesto.com` y `www.espanolhonesto.com` | Permanecen en Pages; el único custom domain de Workers observado es staging | Transferir ambos en el cambio autorizado, conservando un único origen canónico, HTTPS y redirección de www |
| Supabase `vkkahxsybhbutszerawz` | Proyecto productivo existente con esquema anterior | Conservar proyecto; actualizar datos solo mediante T04/T05/T20 y su autorización específica |

El servicio interno usaría `FULFILLMENT_SERVICE`; no se abriría un endpoint público de fulfillment. Los secretos se cargarían desde los gestores autorizados y no se heredarían de los Workers reservados ni de staging. La aplicación se desplegaría primero con checkout apagado. T03 debe preparar el build por entorno, los guards de identidad y el procedimiento exacto de cambio de dominios conforme a la [guía de migración de Cloudflare](https://developers.cloudflare.com/workers/static-assets/migration-guides/migrate-from-pages/).

La analítica necesita configuración explícita y prueba de recepción en el nuevo runtime: la activación automática del proyecto Pages no acredita Workers. Se conserva Cloudflare Web Analytics como medición pública, eventos confirmados de aplicación/Stripe para conversión y Sentry para errores; T18 verifica el resultado y la CSP.

**Coste pendiente de acreditar en la cuenta.** La consulta de suscripciones no fue autorizada por el proveedor; leer ajustes de Workers y colas sí fue posible. `usage_model=standard` no demuestra por sí solo el plan contratado ni su coste incremental. Como referencia pública consultada el 5 de septiembre, [Workers Paid](https://developers.cloudflare.com/workers/platform/pricing/) parte de 5 USD al mes por cuenta e incluye 10 millones de peticiones y 30 millones de milisegundos de CPU; los excesos tienen coste. [Queues](https://developers.cloudflare.com/queues/platform/pricing/) incluye un millón de operaciones mensuales en Paid y cobra 0,40 USD por millón adicional; normalmente una entrega consume tres operaciones. Estos importes no son una oferta cerrada para el proyecto ni incluyen el resto de proveedores. Antes de activar se acredita el plan, el consumo compartido, el coste incremental y sus límites; no se contrata ni amplía un plan con esta propuesta.

**Reversión propuesta.** Antes de abrir pagos, conservar Pages permite preparar una restitución del sitio informativo, condicionada a verificar compatibilidad y a autorizar los cambios de dominios. Después de aceptar compras, Pages antiguo no sirve como rollback transaccional: se cierra checkout, se preservan los eventos y se vuelve a una versión Worker compatible con el esquema, o se mantiene el servicio detenido de forma controlada hasta recuperar. Rollback de código no revierte Stripe, correos, permisos de Drive ni migraciones. T03/T05 deben ensayar ese procedimiento.

La decisión inicial permite preparar configuración local para esta topología. Reutilizar los cuatro recursos Cloudflare, desplegar, cambiar dominios, activar cron o colas, enviar mensajes y abrir pagos siguen necesitando autorización explícita sobre la acción concreta cuando esté preparada y sea revisable.

#### T03 — Preparar el despliegue de producción y su reversión

Estado: pendiente. Responsable: Codex. Depende de: T01, T02.

- Implementar build y validación para la arquitectura aprobada, separación de staging/live y permisos mínimos, sin incluir secretos en el paquete.
- El despliegue exige el commit integrado exacto con CI verde, identidad de recursos, checkout apagado, baseline compatible y comprobaciones posteriores; un fallo puede detenerse y recuperarse sin repetir efectos financieros.
- Validar localmente y en entorno de prueba autorizado. Preparar el cambio de proveedor revisable; la activación productiva pertenece a T20.

#### T04 — Preparar y ensayar la actualización de datos

Estado: pendiente. Responsable: Codex. Depende de: T01.

- Comparar esquema e historial reales de producción con el repositorio, distinguiendo migraciones equivalentes con nombres diferentes de cambios que faltan. No ejecutar una diferencia mecánica de nombres.
- Preparar migraciones nuevas cuando hagan falta, sin reescribir las aplicadas; comprobar el esquema desde cero y la actualización desde la base productiva en un destino aislado autorizado.
- Acreditar contratos, grants/RLS, datos históricos e idempotencia de plazas, ciclos, pagos, soporte, contenido y remuneración. Dejar revisión y recuperación listas para T20.

#### T05 — Acreditar backup y restauración

Estado: pendiente. Responsable: Codex; propietario autoriza destino y coste si existe. Depende de: T02, T04.

- Disponer de recuperación mínima aprobada para datos productivos, con objetivo ya definido de RPO de 24 horas y RTO de 4 horas, y cobertura explícita de Auth, roles, Storage y configuración externa al dump.
- Restaurar una copia en un destino inocuo autorizado y comprobar integridad y acceso. No sustituir la restauración por comprobar que existe un botón o un backup listado.
- Establecer qué se reconstruye desde Stripe/otros proveedores y qué no revierte un rollback de código. T20 debe capturar una copia válida inmediatamente antes de modificar producción.

### Contrato, seguridad y prestación

#### T06 — Cerrar las decisiones legales y fiscales

Estado: pendiente de input humano. Responsable: propietario y asesor competente. Depende de: ninguna.

- Confirmar vendedor, identidad pública, tratamiento fiscal, facturación, precio final y remuneraciones.
- Aprobar condiciones B2C, desistimiento/inicio anticipado, renovación, cancelaciones, garantía proporcional, privacidad, cookies y retención.
- Resolver cualquier cambio de política de forma explícita. Codex prepara preguntas y textos revisables; no inventa una conclusión jurídica ni sustituye la decisión profesional.

#### T07 — Llevar las decisiones al producto ejecutable

Estado: pendiente. Responsable: Codex. Depende de: T06.

- Actualizar identidad verificada y presentar los mismos términos en ES/EN/RU, checkout, correo, campus, datos estructurados y WebMCP; retirar los marcadores de ejemplo.
- Versionar los cambios contractuales sin modificar compras históricas. Probar fechas, 28 días literales, garantía por unidades no consumidas y consentimientos.
- Comprobar que la identidad válida no abre pagos por sí sola: checkout conserva un control de activación separado.

#### T08 — Cerrar el acceso administrativo y el aislamiento de datos

Estado: pendiente. Responsable: Codex. Depende de: T01.

- Implementar y probar segundo factor obligatorio para administración, recuperación de acceso controlada y rechazo server-side de sesiones sin el nivel requerido.
- Probar alumno propio/ajeno, profesor asignado/no asignado y capacidades administrativas tanto en endpoints como en RLS/RPC; incluir cambios de rol e invitaciones.
- Revisar avisos de seguridad de Supabase y dependencias por su efecto real. Cerrar exposición no autorizada, escalada de permisos y filtración de secretos; los avisos informativos intencionales no se corrigen abriendo permisos innecesarios.

#### T09 — Implementar materiales privados por alumno

Estado: pendiente. Responsable: Codex. Depende de: T01.

- Mantener originales restringidos al equipo y generar el árbol individual con acceso nominal. La raíz concede como máximo lectura; documentos de trabajo editor, observaciones comentarista y referencias lector según actividad.
- Implementar invitación, revocación de destinatarios anteriores y retirada ordenada de acceso público, conservando recuperación e idempotencia.
- Probar con dobles locales los fallos parciales y la separación de alumnos. Conservar My Drive como base actual; no migrar a unidad compartida sin una decisión adicional.

#### T10 — Acreditar Google Drive con identidades externas

Estado: pendiente de preparación e input humano. Responsable: Codex y superadministrador/persona de prueba. Depende de: T09.

- Verificar la política de Visitor Sharing y disponer de una dirección externa controlada sin cuenta de Google. El usuario realiza los pasos que requieran su identidad o PIN.
- Sobre una carpeta de prueba autorizada, comprobar invitación, apertura, edición/comentario, descarga, reverificación y rechazo de originales o árboles ajenos.
- Crear y probar acceso nominal antes de retirar `anyone` o permisos antiguos. Verificar también cambio de destinatario y recuperación; no hacer una retirada masiva. La configuración productiva se acredita en T20 antes de asignar materiales reales.

#### T11 — Preparar las cinco plazas iniciales

Estado: pendiente de horarios reales. Responsable: propietario/profesores confirman; Codex prepara. Depende de: T06.

- Confirmar tres franjas de Álex y dos de Irene, primeras fechas, permiso para el perfil público, disponibilidad y términos efectivos. Convertir horarios para el público de Estados Unidos y revisar cambios de horario estacional.
- Preparar altas, perfiles, Calendar y las cuatro fechas de cada plaza sin inventar demanda ni disponibilidad. Las cuentas de ensayo son sintéticas; no se invita a personas reales en staging.
- Ensayar la consola de alta/publicación/pausa y el rechazo de plazas sin términos o con conflicto. La carga real y publicación se cierran en T22.

#### T12 — Preparar la prestación docente y el soporte del piloto

Estado: pendiente de acreditación. Responsable: profesores y operador, con apoyo de Codex. Depende de: T10, T11.

- Tener materiales y una primera sesión utilizables para los perfiles que admite la oferta, diagnóstico/objetivos, nota breve, deberes y continuidad del ciclo. Los profesores validan la suficiencia pedagógica.
- Ensayar acceso a Meet y documentos desde alumno y profesor, incidencia de acceso, cancelación docente y continuidad de atención.
- Acreditar el canal de email/tickets ya acordado, lectura móvil de avisos, revisión diaria y relevo de guardia. No inventar atención 24/7 ni nuevos canales o compromisos públicos.

#### T13 — Completar y probar las excepciones del ciclo

Estado: pendiente; gran parte del flujo ordinario ya existe. Responsable: Codex; propietario decide si cambia una política. Depende de: T07, T08.

- Completar la restitución excepcional de crédito junto con su clase de reemplazo en una operación atómica y auditada, sin borrar el hecho histórico ni la remuneración ya devengada.
- Acreditar reprogramación, primera fecha/ancla, cancelación temprana/tardía, no-show, cancelación docente, sustitución y rechazo, impago y garantía proporcional conforme al contrato.
- Un operador puede recuperar fallos de jobs, pagos y devoluciones desde las superficies previstas, sin SQL improvisado ni operaciones financieras paralelas. Una política sin implementación no se marca resuelta por existir un texto explicativo.

### Proveedores, experiencia y medición

#### T14 — Preparar Auth y correo entregable

Estado: pendiente de verificación del candidato. Responsable: Codex y operador autorizado. Depende de: T07.

- Verificar identidad de remitente, SMTP/Auth, URLs permitidas, SPF, DKIM y DMARC de Workspace/Resend; presentar por separado los cambios de DNS o alias que necesiten autorización.
- Probar alta, confirmación, recuperación, invitación, expiración y avisos operativos en destinatarios de prueba autorizados. Las pruebas no envían a alumnos o miembros reales del equipo por inferencia.
- Reintentos, límites de envío y recuperación no duplican mensajes ni abren acceso. Repetir las comprobaciones dependientes del entorno live durante T20/T22.

#### T15 — Preparar observabilidad, recuperación de proveedores y costes

Estado: pendiente de verificación del candidato; existen mecanismos previos. Responsable: Codex y operador. Depende de: T02.

- Acreditar errores correlacionados y minimizados, recepción de alertas y capacidad de localizar una incidencia. Reutilizar acreditaciones vigentes si el cambio no las invalida.
- Probar rechazo de rutas internas, proveedor caído, trabajo reintentable y agotado, inspección/recuperación de DLQ y bloqueo de checkout cuando el estado sea incierto.
- Identificar recursos y planes exactos, límites y gastos previstos; aprobar cualquier coste necesario. No confundir coste observado cero o presupuesto de alertas con un tope de gasto. Verificar configuración final en T20.

#### T16 — Cerrar la experiencia pública y su verdad comercial

Estado: pendiente; existen cambios locales. Responsable: Codex; propietario valida afirmaciones y autorizaciones de contenido. Depende de: T07, T11.

- Oferta, precio, cuatro fechas, profesor, zona horaria, renovación y garantía coinciden en todos los idiomas y superficies. Biografías, imágenes y afirmaciones tienen fuente o permiso; no hay testimonios inventados ni servicios retirados.
- En móvil y escritorio funcionan navegación, contacto, diagnóstico, disponibilidad, login y checkout, incluidos vacío, proveedor caído y sesión expirada. Comprobar teclado, foco, errores y ausencia de bloqueos de accesibilidad en el recorrido crítico.
- HTML público útil, canonicals/hreflang, redirecciones, sitemap, robots, metadatos y enlaces son coherentes; staging/privado no se indexan. La lectura fallida de Supabase no derriba el contenido público que dispone de fallback.

#### T17 — Integrar y acreditar las seis herramientas WebMCP

Estado: pendiente; implementación y pruebas locales existentes. Responsable: Codex. Depende de: T01, T16.

- Reutilizar oferta, disponibilidad y revisión humana; comprobar las seis herramientas de este documento en un navegador compatible y su ciclo de registro/cancelación.
- Probar input no confiable, plaza obsoleta, error de red, privacidad, cambios visibles y reversibles; ninguna herramienta autentica, acepta condiciones, supera Turnstile ni autoriza pagos.
- El mismo recorrido funciona cuando WebMCP no existe o falla. No ampliar herramientas ni construir un backend de reservas alternativo.

#### T18 — Preparar medición y descubrimiento mínimos

Estado: pendiente de verificación; Search Console ya está instalado y autorizado según la comprobación anterior. Responsable: Codex; operador autoriza envíos externos. Depende de: T02, T07, T16.

- Verificar el MCP existente de solo lectura y la propiedad fija; preparar sitemap y muestra de URLs para T20 sin reinstalar ni pedir OAuth si el acceso sigue vigente.
- Acreditar recepción de analítica compatible con la arquitectura aprobada y privacidad, y continuidad de atribución hasta compra, renovación y devolución. Los pagos vienen de Stripe/ledger; una página vista no cuenta como venta.
- La administración puede reconciliar cobro, devolución, comisiones, obligación docente y captación registrada; muestra ausencias explícitas y contribución provisional, nunca beneficio neto inventado. No exige alcanzar tráfico ni un CAC objetivo para cerrar.

### Certificación y apertura

#### T19 — Certificar el candidato completo en staging

Estado: pendiente. Responsable: Codex y personas de prueba autorizadas. Depende de: T01, T04, T07, T08, T10, T12, T13, T14, T15, T16, T17, T18.

- Integrar todos los cambios del candidato, exigir CI verde y desplegar ese commit exacto por el workflow de staging tras su autorización. Esta tarea incluye expresamente la comprobación de runtime de staging.
- Ejecutar la matriz de aceptación de este documento con alumno/profesor/admin sintéticos y proveedores Sandbox autorizados; verificar limpieza o conservación justificada de datos de prueba. El ensayo académico usa sesiones de prueba controladas, sin falsificar clases reales impartidas.
- Pasan navegador, móvil, accesibilidad y auditoría de rendimiento prevista en operaciones. Todo defecto que impida contratar, acceder, operar, proteger datos o recuperar dinero se corrige antes del cierre. Cambiar código o configuración relevante reabre la parte afectada y la certificación del candidato.

#### T20 — Desplegar y acreditar producción con checkout apagado

Estado: pendiente de T02 y autorizaciones concretas. Responsable: Codex; propietario autoriza recursos y acciones. Depende de: T02, T03, T04, T05, T19.

- Presentar commit exacto, recursos permitidos, diferencias de configuración/esquema, copia vigente, coste y recuperación; obtener autorización para cada escritura necesaria. Provisionar solo recursos aprobados; un recurso Cloudflare existente no se reutiliza ni borra por inferencia.
- Aplicar el cambio aprobado y comprobar runtime, migraciones, Auth, acceso, materiales privados, correo, Calendar, jobs, alertas y analítica productivos. El build corresponde al mismo commit certificado, con configuración de producción identificada; no se promueven secretos de staging.
- Verificar desde fuera HTTPS, rutas públicas, canonicales, sitemap y noindex privado; enviar el sitemap tras autorización e inspeccionar URLs. Checkout permanece cerrado y existe un baseline compatible recuperable.

#### T21 — Configurar Stripe Live manteniendo checkout cerrado

Estado: pendiente de autorización específica. Responsable: Codex y propietario de Stripe. Depende de: T06, T07, T15, T20.

- Verificar vendedor/cuenta/mode live y preparar catálogo contractual, precios inicial/recurrente, portal, webhook, secretos y facturación correctos; no reutilizar identificadores de Sandbox.
- Acreditar configuración de 259 EUR, cuatro clases y renovación 28 días después de la primera clase, eventos necesarios y mecanismos de cancelación/devolución/conciliación; no provocar cobros para comprobar configuración.
- Mantener checkout apagado. Cualquier precio final distinto exige volver a T06/T07 y a las verificaciones afectadas.

#### T22 — Dar de alta la operación real y publicar las cinco plazas

Estado: pendiente de autorización para datos, invitaciones y publicación reales. Responsable: operador y profesores; Codex ejecuta lo autorizado. Depende de: T11, T12, T14, T20, T21.

- Invitar y activar a las personas correctas, con permisos y términos efectivos; comprobar aceptación, agenda, materiales y capacidad de atención. No dar acceso por el mero envío de una invitación.
- Crear y revisar tres plazas de Álex y dos de Irene con primeras fechas futuras y sin conflicto. Publicar tras confirmación de sus profesores, sin identidades ni fechas sintéticas.
- La API y la interfaz muestran exactamente ese inventario y el contrato live correcto. Checkout sigue cerrado hasta T23.

#### T23 — Abrir, comprobar dinero real y cerrar el goal

Estado: pendiente de autorización de apertura y transacciones. Responsable: propietario autoriza; persona compradora controla identidad/consentimiento/pago; Codex verifica y ejecuta solo efectos autorizados. Depende de: T20, T21, T22.

- Presentar el go/no-go concreto del candidato y obtener autorización de apertura, importe, identidad de prueba, compra, devolución y recuperación. Activar checkout solo para el alcance autorizado; la persona completa los actos de consentimiento y pago.
- Acreditar compra live controlada, una sola plaza ocupada, ciclo y cuatro sesiones, comunicaciones/accesos, renovación futura correctamente anclada, portal y devolución controlada de acuerdo con los términos y alcance aprobados. No marcar una clase real como impartida para abrir artificialmente una garantía; su regla proporcional ya se habrá probado en Sandbox.
- Conciliar Stripe y ledger, inventario, sesiones, remuneración que corresponda y jobs. Resolver toda incidencia crítica; confirmar apertura pública, soporte, alertas y recuperación disponibles. Adjuntar referencias nativas, marcar T01–T23 cerradas y solo entonces completar el goal.

## Matriz de aceptación del lanzamiento

| Recorrido | Verificación antes de abrir | Comprobación live final |
|---|---|---|
| Compra y capacidad | Dos compradores compiten por la misma plaza, retención expira, consentimiento ausente y sesión expirada; nunca doble venta ni cobro sin capacidad | Compra autorizada única y variación correcta del inventario |
| Alta y clase | Confirmación/Auth, alumno correcto, profesor correcto, cuatro fechas, Meet, documento privado, nota y deberes de una sesión de prueba | Acceso y preparación correctos; el ensayo no inventa docencia real |
| Reprogramación y excepciones | Plazos, ancla preinicio, reemplazo, no-show, cancelación docente, sustitución/rechazo y recuperación parcial preservan crédito e historial | Configuración y herramientas disponibles; no se ejecutan cambios reales adicionales sin alcance |
| Renovación e impago | Ciclo de renovación Sandbox, duplicados, eventos fuera de orden y recuperación de impago producen un único resultado coherente | Fecha, importe y método/portal correctos; no se espera 28 días ni se adelanta un cargo real |
| Garantía y dinero | Devolución proporcional por snapshot y cancelación futura; un fallo/reintento no duplica dinero ni elimina obligación docente histórica | Compra/devolución explícitamente autorizadas y conciliadas según su caso válido |
| Operación y economía | Admin resuelve ticket/job; docente ve lo propio; cierre/exportación y contribución reconcilian con hechos y costes registrados | Identidades, permisos, canal de soporte y movimientos del ensayo consistentes |
| Datos y recuperación | Acceso cruzado denegado, segundo factor admin, secretos ausentes, backup restaurado, proveedor fallido recuperable | Recursos exactos, baseline/copia disponibles y ninguna incidencia crítica abierta |
| Web pública y agentes | Móvil/escritorio, teclado, errores, oferta coherente, seis herramientas y fallback sin WebMCP | Rutas indexables elegidas, sitemap enviado, herramientas y recorrido humano accesibles |

## Trabajo después del cierre de este goal

Estas tareas mantienen su valor, pero no son prerrequisitos de T23:

- Verificar/importar Bing Webmaster Tools, añadir IndexNow y observar AI Performance cuando haya datos. Son ampliaciones de descubrimiento: no se declara que posicionamiento o citas estén logrados por instalarlas.
- Captar los primeros compradores y observar primera clase, primer ciclo de 28 días, renovación real, satisfacción, devoluciones, carga de soporte y contribución económica.
- Autorizar publicidad solo con página estable, atribución comprobada y presupuesto explícito; decidir continuidad por adquisición y retención observadas.
- Ampliar contenido útil, idiomas, automatizaciones o capacidad por fricciones y demanda medidas. No se construyen nuevos planes, marketplace ni infraestructura para miles de alumnos como condición de la primera venta.

## Orden de ejecución y decisiones humanas

Comenzar por T01 y preparar las propuestas de T02, T04, T06, T09, T11 y T15. Trabajar después sobre las dependencias de cierre indicadas; no ejecutar todo en serie ni crear subagentes por inercia. La preparación de T03, T05, T07, T08 y T13–T18 puede avanzar donde existan inputs suficientes. La secuencia final es T19 → T20 → T21 → T22 → T23.

| Decisión/input | Necesario para | Trabajo que se presenta antes de pedirlo |
|---|---|---|
| Arquitectura productiva y coste | T02/T03/T05/T15/T20 | Propuesta de runtime, recursos exactos, cambios, coste, comprobación y recuperación |
| Identidad, fiscalidad y contrato aprobados | T06/T07/T21 | Lista precisa de campos y cuestiones abiertas, textos y efecto de cada decisión |
| Cinco horarios y validación docente | T11/T12/T22 | Formato de plaza con profesor, cuatro fechas, zona horaria, renovación y materiales |
| Visitor Sharing e identidad externa | T10 | Código y carpeta de ensayo preparados; operaciones de permisos y comprobaciones delimitadas |
| Invitaciones, correo, DNS, datos y despliegues | T10/T14/T19/T20/T22 | Preflight de cuenta/recurso y operación concreta lista para revisión |
| Stripe Live, apertura, compra y devolución | T21/T23 | Candidato certificado, configuración exacta, importe, identidad, efectos y recuperación |

Una autorización ya concedida sigue siendo válida dentro de su alcance; no se vuelve a pedir por rutina. Solicitar este goal autoriza su preparación y ejecución técnica local, pero no identifica por sí solo recursos Cloudflare que se puedan modificar ni autoriza cualquier envío, despliegue o movimiento de dinero. Las restricciones se aplican a la acción concreta y el trabajo independiente continúa.

## Gates de verificación

### Ingeniería

- pruebas del contrato de oferta, disponibilidad, reserva y WebMCP;
- pruebas negativas de autenticación, consentimiento, Turnstile, pago, datos privados, input no confiable y plaza obsoleta;
- typecheck, lint, secretos, build y validación del paquete;
- revisión de dependencias y vulnerabilidades con severidad acordada;
- accesibilidad y navegación por teclado en los estados principales.

### Staging

- el mismo SHA se construye, despliega y comprueba;
- staging permanece noindex y usa datos y pagos de prueba claramente identificados;
- una persona completa el flujo ordinario sin WebMCP;
- un agente usa las seis herramientas y todos los cambios son visibles y reversibles;
- el fallback funciona cuando document.modelContext no existe.

### Producción

- identidad, legal, soporte, profesores y franjas están aprobados;
- los recursos exactos coinciden con docs/ENVIRONMENTS.md;
- la recuperación ha sido probada;
- checkout se despliega apagado y se activa al final;
- Stripe está en la cuenta y modo correctos;
- sitemap, robots, canonicals, hreflang, JSON-LD y llms.txt se comprueban desde fuera;
- errores, correo, calendario, webhooks, colas y soporte son observables;
- existe un baseline compatible para rollback.

## Go/no-go

No se abre el checkout real si:

- la identidad o el tratamiento legal y fiscal no están cerrados;
- precio, fechas, renovación, garantía o condiciones se contradicen;
- Stripe, Supabase, Cloudflare, Google, Resend o Sentry apuntan a una cuenta o recurso distinto;
- faltan cinco plazas reales o permiso de los profesores;
- Auth, RLS, recuperación, webhooks, conciliación o rollback no están verificados;
- alguna herramienta puede aceptar condiciones, sortear Turnstile, ocultar una retención, autorizar pago o leer datos privados;
- una URL esencial falla, está bloqueada o contradice la fuente canónica;
- no se puede observar o detener el sistema con seguridad.

La publicación orgánica puede avanzar con checkout apagado cuando las páginas son veraces y ofrecen una vía de contacto funcional. Las campañas pagadas se reconsideran después de tener una página estable y medición de conversión.

## Despliegue y rollback

El orden obligatorio de cierre es T19 (candidato completo en staging), T20 (datos y runtime de producción con checkout cerrado), T21 (Stripe Live configurado sin abrir pagos), T22 (personas y cinco plazas reales) y T23 (apertura y operaciones live expresamente autorizadas). T05 acredita restauración antes de T20. Se prepara el paquete concreto de cada escritura antes de solicitar su autorización.

El mismo commit integrado se certifica en staging y se construye para producción; cada entorno tiene configuración y secretos propios identificados. No se exige reutilizar el binario de staging si el adaptador necesita construir por entorno.

Ante precio, disponibilidad, consentimiento, pago, Auth, datos o efectos operativos inciertos:

1. apagar checkout;
2. desregistrar o desactivar WebMCP si está implicado;
3. detener nuevos efectos sin borrar registros financieros u operativos;
4. volver al baseline compatible capturado;
5. reparar datos hacia delante o restaurar solo mediante el procedimiento aprobado;
6. conciliar sesiones, pagos, suscripciones, webhooks, retenciones, colas, correo y calendario;
7. reabrir únicamente cuando vuelva a pasar el gate que falló.

## Condiciones de parada para agentes

Un agente detiene solo la rama afectada cuando:

- cambia la identidad de cuenta, proyecto, entorno, modo o recurso respecto al mapa aprobado;
- una escritura externa, despliegue, DNS, permiso, campaña o gasto carece de autorización;
- se requieren credenciales en chat, repositorio, logs o capturas;
- falta una decisión legal, fiscal, de identidad, de permiso docente o de soporte;
- el trabajo exigiría eludir autenticación, consentimiento, Turnstile, control de inventario o pago;
- el candidato no tiene una prueba, rollback o criterio de cierre verificable.
