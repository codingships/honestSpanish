# Google Calendar Account Decision

Estado: decision operativa para RC y cierre final. No se ha tocado Google ni ningun secreto al crear este documento.

## Comportamiento Actual Del Codigo

- `GOOGLE_ADMIN_EMAIL` es la cuenta impersonada por la service account.
- Los eventos de clase se crean en el calendario `primary` de `GOOGLE_ADMIN_EMAIL`.
- El alumno y el profesor se anaden como asistentes del evento.
- La disponibilidad se comprueba contra el email del profesor guardado en `profiles.email`.
- El campus guarda `sessions.calendar_event_id` y `sessions.meet_link` cuando el fulfillment crea el evento.
- Cancelar una clase intenta borrar el evento de Calendar y limpiar los campos de la sesion.

## Decision Para `fernandialejandro@gmail.com`

Si `fernandialejandro@gmail.com` debe ser el calendario operativo del profesor, hay dos caminos:

1. Usar ese email como `profiles.email` del profesor en staging/production.
   - Beneficio: no requiere cambio de codigo ni migracion.
   - Coste: el email de login/perfil y el calendario operativo quedan acoplados.
   - Riesgo: si el profesor quiere iniciar sesion con otro email, el calendario no se puede separar.

2. Crear un campo separado, por ejemplo `profiles_private.calendar_email`.
   - Beneficio: permite login con una cuenta y disponibilidad/invitaciones con otra.
   - Coste: requiere migracion, tipos, admin UI/API, pruebas de permisos y smoke real.
   - Riesgo: mas superficie de datos personales y una regla nueva que proteger con RLS/API.

Para RC, no se hace el cambio de modelo. Si el calendario operativo y el email de login son distintos, crear una tarea tecnica antes de production.

## Requisitos De Google Antes De Production

- `GOOGLE_ADMIN_EMAIL` debe poder crear eventos con Meet.
- La service account debe tener domain-wide delegation y scopes de Calendar/Drive/Docs necesarios.
- Si el calendario del profesor es una cuenta Gmail externa, debe compartir disponibilidad con la cuenta impersonada o aceptar invitaciones de la cuenta que crea eventos.
- La prueba final debe confirmar que FreeBusy ve conflictos reales del profesor.
- La prueba final debe confirmar que el evento y Meet aparecen para las partes esperadas.
- No usar datos de alumnos reales en staging.

## Smoke Final

El cierre final debe probar:

1. Crear una clase test con `autoCreateMeeting=true`.
2. Confirmar que se crea `sessions.calendar_event_id`.
3. Confirmar que se crea `sessions.meet_link`.
4. Confirmar que el profesor recibe o ve el evento esperado.
5. Confirmar que un conflicto real en el calendario del profesor bloquea el slot.
6. Cancelar la clase y confirmar que el evento queda eliminado o ausente.
7. Registrar evidencia no secreta en `docs/launch/MANUAL_EVIDENCE.local.json`.

## No Guardar

No guardar en el repo:

- Capturas con eventos reales, emails de alumnos o enlaces privados de Meet.
- IDs completos de calendarios privados si no son necesarios.
- Claves de Google, JSON de service account o tokens.
- Grabaciones, documentos o carpetas de alumnos.

## Criterio De Cierre

Para launch viable, esta decision queda cerrada si:

- El comportamiento actual esta documentado.
- Alin decide si `profiles.email` basta o si hay que crear `calendar_email`.
- El smoke final cubre Calendar/Meet en el entorno real de lanzamiento.
- Cualquier cambio de modelo queda en tarea separada antes de production, no mezclado con legal, Stripe o rotacion de claves.
