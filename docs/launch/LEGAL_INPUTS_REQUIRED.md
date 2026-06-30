# Legal Inputs Required

Estado: launch blocker. No completar con datos inventados. Sentry y Cloudflare ya estan incluidos como subprocesadores; siguen pendientes los datos reales del titular/controlador y la revision legal humana.

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
- Si hay menores: edad minima, consentimiento parental y proceso operativo.

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

- Condiciones de compra.
- Cancelaciones y reprogramaciones de clases.
- Devoluciones y desistimiento.
- Duracion de bonos/suscripciones.
- Politica ante no-show.
- Soporte y canales oficiales.

## Regla de cierre

Cuando estos datos esten confirmados por Alin o asesoria, actualizar `src/pages/[lang]/legal/aviso-legal.astro` y `src/pages/[lang]/legal/privacidad.astro`, eliminar placeholders, revisar el texto completo de privacidad/cookies/terminos, y volver a ejecutar:

```bash
pnpm launch:legal
pnpm launch:verify
pnpm launch:secondary-review
```
