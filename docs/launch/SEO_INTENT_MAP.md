# SEO Intent Map

Estado: activo para Release Candidate. Este mapa no cierra `seo_llm_final`; solo define que paginas publicas existen, a que intencion responden y como convierten sin prometer legal, pagos live, reviews, Telegram, comunidad publica activa o prueba de nivel definitiva.

La estrategia comercial completa del lanzamiento queda en `docs/launch/LAUNCH_MARKETING_PLAN.md`; este mapa es solo la parte SEO/LLM.

## Cliente Principal

Adulto o profesional de mas de 30 anos, nivel aproximado A2/B1 o superior, poder adquisitivo medio-alto y curiosidad cultural real. Quiere vivir Espana con conversacion, cultura, criterio, contacto real con el pais y una comunidad que se construya con encaje, no comprar clases baratas ni repetir dialogos genericos.

## Decisiones Confirmadas

- El cliente principal del lanzamiento es adulto/profesional +30, culturalmente curioso, medio-alto y normalmente A2/B1+.
- La promesa gira alrededor de vivir Espana con conversacion, cultura y criterio, con contacto real y comunidad como direccion, no como promesa cerrada.
- No se compite por "clases baratas"; el copy debe filtrar y educar.
- La accion principal es solicitar plaza antes de comprar.
- La prueba de nivel puede tener una parte automatica gratuita, pero la revision humana queda para solicitudes serias o despues de compra.
- Las paginas prioritarias del RC son la home y tres paginas SEO especificas: vivir en Espana, profesionales y conversacion A2/B1+; no se crean paginas locales por ciudad hasta tener contenido real suficiente.
- Madrid, Oviedo, Toledo/Castilla-La Mancha y Barcelona son identidad cultural y contexto de posicionamiento, no promesa local presencial.

## Reglas

- La home es la pagina de marca y oferta general.
- Las paginas de segmento atacan una intencion concreta y deben enlazarse desde la home para no quedar huerfanas.
- La accion principal es solicitar plaza. La compra directa y Stripe live quedan para el cierre final.
- La prueba de nivel definitiva sigue pospuesta; el formulario actual recoge nivel aproximado, objetivo y disponibilidad. Una prueba automatica ligera puede existir como filtro gratuito, pero la valoracion humana se reserva para solicitudes serias o alumnos.
- Las ciudades Madrid, Oviedo, Toledo/Castilla-La Mancha y Barcelona son identidad cultural y contexto de posicionamiento, no promesa local presencial.
- La comunidad se comunica como contacto y emparejamiento compatible, no como canal publico ya operativo.
- La home incluye un bloque visible de comunidad honesta: contacto con Espana, materiales compartidos y practica con otros alumnos solo si existe compatibilidad real.
- No se publican reviews, Telegram ni telemetria mientras sigan pospuestos.

## Matriz De Intencion

| Persona | Busqueda probable | Pagina | Promesa | CTA | Evidencia actual |
| --- | --- | --- | --- | --- | --- |
| Adulto que vive o quiere vivir en Espana | espanol para vivir en espana, clases de espanol para expatriados, aprender espanol para integrarse en espana | `/es/espanol-para-vivir-en-espana` | Entrar en la vida del pais con conversacion, cultura, criterio y contacto real. | Solicitar plaza | Pagina en sitemap, `llms.txt` y enlace interno desde `/es`. |
| Profesional extranjero en Espana | espanol para profesionales, espanol para trabajo en espana, clases de espanol para reuniones | `/es/espanol-para-profesionales` | Hablar con confianza en reuniones, trabajo, ciudad y vida diaria. | Solicitar plaza | Pagina en sitemap, `llms.txt` y enlace interno desde `/es`. |
| Alumno A2/B1+ bloqueado al hablar | clases de conversacion en espanol online, mejorar conversacion en espanol, espanol b1 conversacion | `/es/clases-de-conversacion-en-espanol` | Pasar de entender a participar con correccion, vocabulario activo, materiales y seguimiento. | Solicitar plaza | Pagina en sitemap, `llms.txt` y enlace interno desde `/es`. |
| Alumno culturalmente curioso | espanol cultura espana, aprender espanol con cultura espanola, conversacion sobre espana | `/es/espanol-para-vivir-en-espana` | Usar Madrid, Oviedo, Toledo/Castilla-La Mancha y Barcelona como contexto cultural. | Solicitar plaza | Copy de segmento y `llms.txt`. |

## Paginas No Creadas Aun

Estas ideas no entran al RC salvo decision explicita:

| Idea | Motivo para posponer |
| --- | --- |
| Paginas por ciudad, como Madrid, Oviedo, Toledo o Barcelona | La oferta es online y cultural; crear paginas locales sin contenido suficiente podria parecer doorway SEO. |
| Pagina de prueba de nivel | Falta decidir formato, rubrica, video/audio, privacidad y retencion. |
| Pagina de comunidad o Telegram | El canal publico y la operacion comunitaria siguen pospuestos; la comunidad solo se promete cuando haya grupo compatible y mantenimiento real. |
| Pagina de reviews | No hay testimonios reales autorizados. |

## Siguiente Expansion Recomendada

No crear ahora paginas locales separadas para Madrid, Oviedo, Toledo/Castilla-La Mancha o Barcelona. La expansion inmediata aplicada en el RC es reforzar las paginas de segmento existentes con contenido propio y crear solo URLs con intencion clara.

Orden recomendado:

1. Hecho en RC: reforzar `/es/espanol-para-vivir-en-espana` con ejemplos culturales concretos de Madrid, Oviedo, Toledo/Castilla-La Mancha y Barcelona, siempre como contexto online y no como promesa presencial.
2. Hecho en RC: reforzar `/es/espanol-para-profesionales` con situaciones profesionales reales: reuniones, clientes, entrevistas, burocracia, ciudad y small talk.
3. Hecho en RC: crear `/es/clases-de-conversacion-en-espanol` para la intencion A2/B1+ de conversacion, bloqueo al hablar y paso de espanol pasivo a espanol usable.
4. Mantener Telegram, reviews, prueba de nivel definitiva y telemetria fuera del RC hasta que existan operacion, consentimiento y evidencia real.

Una pagina nueva se publica solo si cumple estos criterios:

- Responde una busqueda concreta distinta de las paginas actuales.
- Tiene ejemplos propios y no una lista generica de ciudades.
- Convierte a solicitud de plaza, no a compra inmediata.
- No promete grupo, comunidad, reviews, prueba humana ni presencia local si no estan operativos.
- Puede entrar en sitemap, `llms.txt`, tests y `pnpm launch:seo` sin warnings.

## AEO/LLM Blocks

Las tres paginas de segmento del RC incluyen bloques de respuestas rapidas, contextos concretos y `FAQPage` JSON-LD para que buscadores y asistentes puedan extraer informacion autocontenida sin depender de la home.

Cobertura actual:

- Que es Espanol Honesto.
- Para quien encaja.
- Que incluye el curso.
- Como funciona la solicitud de plaza.
- Que pasa si no hay grupo compatible.
- Conversacion A2/B1+: bloqueo al hablar, correccion util, vocabulario activo, small talk, opinion, reparacion y cultura.
- Contextos de uso: Madrid, Oviedo, Toledo/Castilla-La Mancha, Barcelona, reuniones, clientes, entrevistas, tramites, ciudad y small talk.
- Que no se promete: clases baratas, fluidez milagro, grupos sin compatibilidad, comunidad publica ya operativa o comunidad artificial.
- La home refuerza que no se venden grupos de relleno ni comunidad artificial.

Esto no cierra `seo_llm_final`. Antes del Go/No-Go hay que revisar otra vez con dominio, copy, legal y modo de pagos definitivos.

## Criterio De Verificacion RC

- `/es` enlaza a las tres paginas de segmento.
- `/sitemap-public.xml` incluye las tres paginas de segmento y no incluye campus, API, demo ni login.
- `/llms.txt` enumera las paginas publicas y excluye rutas privadas.
- Las paginas de segmento tienen respuestas rapidas, contextos concretos y `FAQPage` JSON-LD.
- `pnpm launch:seo` pasa sin warnings.
- `tests/unit/seo-surface.test.ts` y `tests/unit/landing-public-content.test.ts` protegen el mapa minimo.
