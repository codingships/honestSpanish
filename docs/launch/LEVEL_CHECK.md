# Async Level Check

Estado: diagnostico ligero v1 implementado; prueba formal definitiva sigue fuera del RC. La solicitud de plaza sigue siendo la accion principal.

## Decision

- La solicitud de plaza recoge senales de encaje: nivel declarado, objetivo, disponibilidad, interes, plan de interes y pagina de origen.
- El diagnostico ligero puede enviarse solo cuando falte informacion o convenga orientar nivel/encaje.
- La revision humana se reserva para solicitudes serias, alumnos aceptados o personas que ya han comprado.
- Si se activa una prueba formal, el formato recomendado es asincrono: documento breve + video/audio de habla + rubrica manual.
- No se presenta como certificado, examen oficial ni garantia de grupo compatible.

## Diagnostico Ligero V1 Implementado

Ruta publica no indexable:

- `/{lang}/diagnostico`
- API: `/api/level-check`
- Formulario: `src/components/LevelCheckForm.tsx`

Datos que recoge:

- Email.
- Nivel aproximado declarado.
- Comodidad al escuchar espanol real.
- Bloqueo principal al hablar.
- Contexto de uso.
- Texto escrito corto en espanol.
- Indicador opcional de si podria enviar audio despues.
- Consentimiento para revisar nivel y encaje.

Datos que no recoge:

- No sube archivos.
- No guarda audio.
- No automatiza aceptacion, rechazo ni plan final.
- No sustituye una evaluacion humana.

Integracion operativa:

- Guarda el estado en `leads.level_check_status`.
- El enlace enviado desde admin incluye `?email=...` para pre-rellenar el formulario y evitar duplicados por typos.
- Guarda respuestas crudas temporales en `leads.level_check_context`.
- Guarda resumen seguro en `leads.level_check_summary`.
- Crea actividad CRM `Lightweight level check received`.
- Crea tarea CRM `Review lightweight level check` con SLA 24h, resumen seguro, flags de encaje y referencia a `leads.level_check_context`, sin copiar la muestra escrita cruda a la tarea.
- Si el lead vuelve a enviar un diagnostico, se refresca la actividad CRM con el resumen mas reciente.
- Si el lead vuelve a enviar un diagnostico mientras hay tarea abierta o snoozed, se refresca esa tarea con nuevo vencimiento y resumen.
- Si la revision anterior ya estaba cerrada, una nueva entrega crea una nueva tarea de revision en vez de reutilizar trabajo cerrado.
- Muestra estado/resumen del diagnostico en el admin de solicitudes.
- Al marcar el diagnostico como revisado, limpia `level_check_context`, marca `level_check_reviewed_at` y `level_check_raw_cleared_at`, cierra la tarea de revision y deja actividad CRM.
- Al descartar un lead, tambien limpia `level_check_context` y marca `level_check_raw_cleared_at`.
- Al convertir una oportunidad en ganada, tambien limpia `level_check_context` y marca `level_check_raw_cleared_at`; el alumno ya no debe conservar muestras crudas de lead en el circuito comercial.

Regla de retencion:

- V1 puede conservar temporalmente el texto escrito mientras hay revision activa.
- Si el diagnostico se revisa, el lead se descarta o la oportunidad se gana, se elimina el contexto crudo y queda solo el resumen/decision operativa.
- No guardar muestras completas de leads rechazados fuera de `leads.level_check_context`.

## Flujo RC

1. La persona solicita plaza desde la landing o una pagina de segmento.
2. El equipo revisa nivel declarado, objetivo, disponibilidad, plan pulsado y pagina de origen.
3. Si el encaje es claro, se responde con plan recomendado o siguiente paso humano.
4. Si falta contexto, se puede enviar el enlace al diagnostico ligero.
5. La compra, el pago y la evaluacion humana completa llegan solo despues de confirmar encaje.

## Formato Recomendado Si Entra En Launch

### Documento Breve

Pedir 10-15 minutos de escritura guiada:

- Presentate y explica por que quieres mejorar tu espanol ahora.
- Describe una situacion real en Espana que te resulte dificil.
- Escribe un mensaje formal o semi-formal que podrias necesitar.
- Explica un tema cultural, laboral o cotidiano que te interese.

### Video O Audio

Pedir 2-4 minutos de habla:

- Que entiendes bien pero te cuesta decir.
- Una conversacion que te gustaria poder mantener.
- Una experiencia real con espanol en trabajo, ciudad, familia, tramites o cultura.

Video es util si la persona quiere mostrar comunicacion no verbal, pero audio basta para orientar nivel. No obligar a camara salvo que Alin lo decida.

### Rubrica Manual

La rubrica debe devolver una recomendacion operativa, no una etiqueta absoluta:

- Banda aproximada: A2, B1, B2 o C1+.
- Fluidez y bloqueo al hablar.
- Correccion prioritaria: gramatica, tiempos, concordancia, preposiciones o estructura.
- Vocabulario activo y precision.
- Estrategias de reparacion: pedir aclaracion, reformular, ganar tiempo.
- Pronunciacion/inteligibilidad si afecta a comunicacion.
- Escritura funcional si el documento lo muestra.
- Siguiente paso recomendado: plan privado, conversacion compatible, bootcamp, preguntas extra o no avanzar.

## Privacidad Y Operacion

Antes de recoger documentos, audio o video hay que decidir:

- Canal de envio: email, formulario, Drive, Supabase Storage u otra herramienta.
- Texto de consentimiento y finalidad.
- Periodo de retencion.
- Quien puede acceder.
- Como se borra si la persona lo pide.
- Si las grabaciones se usan solo para evaluacion o tambien para seguimiento.
- Si la politica de privacidad necesita cambios antes de publicarlo.

No guardar documentos, audios, videos, enlaces privados ni datos personales en el repo, capturas, outputs o `.codex-ops`.

No mantener `leads.level_check_context` mas alla de la revision activa; usar el resumen operativo y limpiar el crudo desde admin.

## Condiciones Para Mover Prueba Formal A Launch

Solo mover esta prueba a lanzamiento si se cumplen todas:

- El canal de envio esta decidido y probado.
- Hay texto legal/privacidad revisado.
- La rubrica existe y se puede aplicar de forma consistente.
- El campus/admin o el proceso manual indica donde queda cada solicitud.
- La web explica que es orientativa y asincrona.
- `docs/launch/CHECKLIST.md`, `docs/launch/CONVERSION_ARCHITECTURE.md` y tests se actualizan.
- Se ejecutan al menos `pnpm launch:content`, `pnpm launch:accessibility` si cambia UI, y `pnpm launch:legal` si cambia privacidad.

## Estado Para Go/No-Go

Para el lanzamiento viable, este check queda cerrado si:

- La web no promete una prueba de nivel definitiva.
- La solicitud de plaza recoge el contexto minimo para revisar encaje.
- La decision de posponer la prueba formal esta documentada.
- El backlog conserva la ruta para implementarla despues sin bloquear el RC.
