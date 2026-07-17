# Legal Inputs Required

Estado: launch blocker deliberado. Las paginas usan datos inequívocos de ejemplo desde `src/lib/legal-identity.ts`; `LEGAL_IDENTITY_MODE='example'` mantiene `pnpm launch:legal` y cualquier build con `PUBLIC_APP_ENV=production` bloqueados. Sustituirlos por datos reales solo en la ventana final y despues de revision humana.

Ejemplo visible actual:

- Titular: `EJEMPLO — titular pendiente de confirmar`.
- Identificador fiscal: `EJEMPLO — NIF/CIF pendiente de confirmar`.
- Domicilio: `EJEMPLO — domicilio pendiente de confirmar, Madrid, España`.
- Estos valores no son validos para facturar, publicar production ni aceptar pagos reales.

## Datos del titular

- Tipo de titular: persona fisica, autonomo o sociedad.
- Nombre completo o razon social exacta.
- NIF, NIE o CIF.
- Domicilio fiscal o direccion legal que debe aparecer en el aviso legal.
- Email legal/de privacidad.
- Telefono, si se quiere publicar.
- Registro mercantil u otro registro, si aplica.

## Privacidad

- Responsable del tratamiento: debe coincidir con el titular.
- Base legal para: alumnos, leads, pagos, soporte, emails, calendario y analitica/monitorizacion.
- Plazos de conservacion por tipo de dato.
- Derechos RGPD y canal para ejercerlos.
- Menores: decision cerrada en 18+. No se aceptan alumnos menores y no existe flujo de consentimiento parental. Solicitud, diagnostico, registro y checkout exigen atestacion de mayoria de edad.

## Subprocesadores a revisar

- Supabase: autenticacion, base de datos y almacenamiento operativo.
- Stripe: pagos, facturacion y fraude.
- Google Workspace: Drive, Docs, Calendar y Meet.
- Resend: email transaccional.
- Sentry: monitorizacion de errores.
- Cloudflare: hosting, CDN, seguridad y Turnstile si aplica.

## Cookies y tecnologias similares

- Cookies tecnicas de sesion/autenticacion.
- Stripe y checkout.
- Supabase auth.
- Cloudflare/Turnstile.
- Sentry.
- Analitica, solo si se decide activarla.

## Terminos comerciales

- Condiciones de compra: cuenta antes de pagar; las opciones 1/3/6 meses son suscripciones recurrentes por el mismo periodo.
- Cancelaciones y reprogramaciones: al menos 24 horas restaura saldo; menos de 24 horas consume salvo excepcion justificada; si cancela la academia se restaura siempre.
- Politica ante no-show: solo desde 15 minutos despues del inicio; consume saldo salvo excepcion justificada.
- Duracion de bonos/suscripciones: el saldo caduca en `ends_at`, no se reserva despues y no se acumula en renovacion.
- Devoluciones y desistimiento: 14 dias naturales cuando resulte aplicable; inicio anticipado solo con solicitud expresa; mismo medio de pago y descuento proporcional de lo ya prestado cuando proceda.
- Pendiente humano/externo: validar redaccion con asesoria, configurar aviso de renovacion, verificar cancelacion en Stripe Portal y ejecutar un reembolso test con reconciliacion.

## Regla de cierre

Cuando los datos reales esten confirmados por Alin o asesoria, actualizar exclusivamente `src/lib/legal-identity.ts`, cambiar el modo a `verified`, revisar aviso, privacidad, cookies y terminos en ES/EN/RU, y volver a ejecutar:

```bash
pnpm launch:legal
pnpm launch:verify
pnpm launch:secondary-review
```
