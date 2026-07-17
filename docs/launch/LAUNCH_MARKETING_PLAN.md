# Launch Marketing Plan

Estado: activo para Release Candidate. Este documento traduce las respuestas de posicionamiento de Alin en criterios operativos para web publica, SEO, LLM, oferta, solicitudes de plaza y aprendizaje post-launch. No cierra legal real, Stripe live, rotacion de claves, Search Console ni smoke final.

## Cliente Principal

El lanzamiento debe hablar primero a adultos y profesionales de mas de 30 anos, con poder adquisitivo medio-alto, curiosidad cultural real y nivel aproximado A2/B1 o superior. El alumno ideal quiere vivir Espana desde dentro, ya sea desde fuera o viviendo aqui: conversacion, trabajo, ciudad, cultura, burocracia, humor, historia, relaciones y criterio.

No buscamos atraer por volumen a quien solo compara precio, busca milagros o no tiene interes real por el contenido. Puede entrar cualquier persona con ganas y esfuerzo, pero el copy debe filtrar a quien espera clases baratas, atajos o grupos sin compatibilidad.

## Promesa

Promesa guia:

> Espanol para entrar en Espana de verdad: conversacion, cultura y criterio.

Variantes utiles para copy:

- Vive Espana con mas conversacion, cultura y criterio.
- Habla espanol para participar, no solo para sobrevivir.
- Clases de espanol para adultos que quieren una relacion real con Espana.
- Conversacion interesante, materiales buenos y seguimiento honesto.

Lo que no se promete:

- Fluidez sin trabajo.
- Grupo garantizado.
- Comunidad publica ya activa.
- Prueba humana gratuita universal.
- Clases baratas como posicionamiento principal.
- Presencia local fisica en Madrid, Oviedo, Toledo/Castilla-La Mancha o Barcelona.

## Oferta Y Planes

La entrada comercial principal es solicitar plaza, no comprar a ciegas. La solicitud recoge nivel aproximado, objetivo, disponibilidad, interes y plan preferido para revisar encaje antes de proponer pago.

Jerarquia recomendada:

| Funcion | Opcion | Motivo |
| --- | --- | --- |
| Accion principal | Solicitar plaza | Filtra encaje, disponibilidad y nivel antes de vender. |
| Plan operativo base | Mensual estandar | Clases privadas semanales; es el formato mas estable si no hay grupo compatible. |
| Plan principal de posicionamiento | Hibrido mensual | Representa mejor la promesa premium: privadas, posible grupo compatible y doble mirada docente. |
| Plan condicionado | Grupal externo | Solo existe si hay alumnos compatibles por nivel, intereses y ritmo. No incluye clases privadas. |
| Plan intensivo | Bootcamp | Para objetivos concretos y urgencia real. |

El plan grupal no debe funcionar como "entrada barata". Sirve para practicar con otros alumnos de la academia y un profesor cuando el equipo ya conoce a los alumnos y puede emparejarlos bien. Si no hay grupo compatible, se propone otra ruta o se espera.

Capacidad inicial: se puede absorber un bloque de unos 10 alumnos nuevos sin estres, con una capacidad teorica mucho mayor en horas semanales entre el equipo. La web puede mencionar plazas revisadas o disponibilidad limitada por encaje, pero no debe crear escasez artificial.

## Prueba De Nivel

El Release Candidate mantiene solicitud de plaza, no prueba de nivel definitiva.

Ruta recomendada:

1. Parte automatica o formulario breve: puede ser gratuita y servir para orientar nivel sin carga humana.
2. Revision humana: solo para solicitudes serias, alumnos aceptados o despues de compra.
3. Formato futuro si entra en launch: documento breve mas audio o video asincrono, con rubrica, consentimiento, privacidad, retencion, canal de envio y derecho de acceso/borrado definidos en `docs/launch/LEVEL_CHECK.md`.

La web no debe vender una prueba de nivel humana gratis si eso genera trabajo no pagado.

## SEO Y LLM

Paginas RC activas:

- `/es`
- `/es/espanol-para-vivir-en-espana`
- `/es/espanol-para-profesionales`
- `/es/clases-de-conversacion-en-espanol`
- Blog publico y `/llms.txt`

No crear ahora paginas locales separadas por Madrid, Oviedo, Toledo/Castilla-La Mancha o Barcelona. Esas ciudades son identidad cultural y contexto conversacional, no sedes ni promesa presencial. Crear paginas por ciudad solo tendria sentido mas adelante con contenido real suficiente para evitar doorway SEO.

Busquedas deseadas de partida:

- espanol para vivir en espana
- clases de espanol para profesionales
- espanol para trabajar en espana
- clases de conversacion en espanol b1
- mejorar conversacion en espanol
- aprender espanol con cultura espanola
- espanol para expatriados en espana

Busquedas que podemos captar educando, pero no perseguir como posicionamiento principal:

- clases de espanol baratas
- aprender espanol rapido
- hablar espanol en 3 meses
- profesor barato de espanol

## Idiomas Y Mercados

No conviene cerrar la marca a un unico mercado antes del primer aprendizaje real. Recomendacion:

- Espanol: idioma de marca y autoridad cultural.
- Ingles: idioma practico para captar adultos/profesionales internacionales.
- Ruso/Europa del Este: posible via diferenciada, pero como linea de contenido y captacion posterior, no como renuncia al posicionamiento general.
- Checo, frances y lengua de signos espanola: por ahora senales de confianza en el perfil de Irene. Convertirlos en mercados solo si se crean paginas, materiales y soporte especificos.

## Confianza Sin Reviews

Hasta tener testimonios reales autorizados, usar:

- Fotos reales del equipo.
- Perfil y formacion docente.
- Que incluye el curso.
- Materiales, worksheets y ejemplos anonimizados.
- Metodo: clase invertida, practica guiada, seguimiento, correccion y spacing effect.
- Flujo claro despues de solicitar plaza.
- Limites honestos: no milagros, no grupos de relleno, no comunidad artificial.

No publicar reviews de prueba como si fueran reales. Si se usan placeholders internos, no deben llegar a la web publica.

## Aprendizaje De La Primera Semana

Sin activar telemetria rica ni cookies nuevas, mirar:

| Metrica | Fuente | Para que sirve |
| --- | --- | --- |
| Solicitudes por ruta | `leads.source_path` | Saber que pagina atrae mejor. |
| Plan preferido | `leads.preferred_package` | Entender si el posicionamiento empuja al plan adecuado. |
| Nivel declarado | Solicitud de plaza | Ver si llegan A2/B1+ o demasiados principiantes. |
| Objetivo escrito | Solicitud de plaza | Detectar lenguaje real de clientes. |
| Disponibilidad | Solicitud de plaza | Medir capacidad y encaje operativo. |
| Tiempo de respuesta | CRM/admin | Evitar que leads buenos se enfrien. |
| Motivos de descarte | CRM/admin | Aprender que no encaja y ajustar copy. |
| Tickets/errores | Soporte, Sentry si aplica | Detectar fallos de onboarding o campus. |

Si mas adelante se activa telemetria de producto, antes hay que revisar consentimiento, privacidad, cookies, minimizacion de datos y opt-out.

## Riesgos Y Criterios De Pausa

Aunque el objetivo sea lanzar, estos casos deberian pausar el Go/No-Go o quedar como riesgo aceptado por escrito:

- El formulario de solicitud no guarda leads o no envia confirmacion.
- El admin no puede revisar solicitudes.
- Hay mojibake visible o roturas graves en la home/campus.
- `robots.txt`, sitemap, canonical/hreflang o `llms.txt` excluyen paginas publicas importantes.
- Se activa checkout real sin comprobar Stripe, webhook, reconciliacion y modo live/test.
- Hay placeholders legales reales en paginas publicas.
- Integraciones de Google/Resend/Worker fallan en el flujo que se prometa publicamente.
- Se promete prueba de nivel, comunidad, Telegram, reviews o grupo garantizado sin operacion real.

## Final-Only

Queda deliberadamente para el ultimo tramo:

- Datos legales reales y revision humana legal.
- Stripe live o decision final de aceptar pagos.
- Rotacion de claves.
- Backup/export Supabase Free antes de rotar claves.
- Search Console, Core Web Vitals y revision SEO/LLM final con dominio/copy/legal/pagos congelados.
- Smoke final de produccion.
- Reviews reales autorizadas.
- Canal publico de Telegram, si se decide mantenerlo.
- Prueba de nivel definitiva si entra en launch.
