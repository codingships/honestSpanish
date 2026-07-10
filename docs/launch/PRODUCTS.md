# Products And Pricing

Fuentes con una sola responsabilidad, gestionadas desde `/es/campus/admin/packages`:

- Supabase `packages`: catalogo comercial editable y datos publicos.
- Supabase `package_prices`: version contractual inmutable de cada oferta 1/3/6 meses.
- Stripe: ejecutor del cobro, siempre verificado contra esa oferta.
- `packages.stripe_price_*`: punteros de compatibilidad a las tres ofertas activas; no se editan a mano.

## Reglas

- No editar DB, Stripe y copy publica por separado; el cambio empieza en `packages` y termina con la sincronizacion admin.
- `public/llms.txt` describe los planes pero no duplica importes; remite a la seccion publica de planes, que lee Supabase. La tabla de este documento es evidencia operativa, no una fuente runtime.
- Guardar cambios en CRM antes de sincronizar Stripe.
- Stripe Price IDs son inmutables.
- Si cambia precio, cuota, nombre o prestaciones contractuales, la version sube y las ofertas anteriores quedan retiradas pero trazables.
- Tener tres punteros no basta: checkout-ready exige tres `package_prices` activas de la version actual, misma cuenta/modo/Product y cantidades EUR exactas.
- El checkout inicial acepta tarjeta y mantiene los códigos promocionales desactivados para que el importe contratado y renovado coincida con el resumen contractual probado.
- Cambios de precio/cuota afectan solo nuevas compras.
- Mientras Stripe siga en modo prueba, no aceptar pagos reales. Para un soft launch sin pagos, checkout debe quedar desactivado, oculto o bloqueado por datos/configuracion, y la decision debe quedar como riesgo aceptado en `docs/launch/MANUAL_EVIDENCE.local.json`.
- La entrada comercial recomendada antes de pagos reales es `solicitar plaza`: el formulario publico recoge plan de interes, interes, nivel aproximado, objetivo, disponibilidad y pagina de origen en `leads`, y el email automatico confirma que primero se revisa encaje antes de comprar.
- Las landings publicas siempre usan `PricingSection` en modo `application`; solo un alumno autenticado con una aprobacion CRM exacta ve el pago en Campus.
- `/api/create-checkout` falla cerrado salvo que `CHECKOUT_ENABLED=true`. Mantener `CHECKOUT_ENABLED=false` para operar sin cobros reales aunque existan Price IDs en Supabase.
- Una aprobacion solo puede emitirse para un paquete cuyo catalogo contractual completo este sincronizado.

## Catalogo Actual

| Key | Precio mensual | Sesiones/mes | Tipo | Grupo | Doble profesor |
|---|---:|---:|---|---|---|
| `group` | 50 EUR | 4 | Sesiones grupales guiadas si hay grupo compatible | Solo si hay compatibilidad de nivel, intereses y ritmo | No |
| `standard` | 145 EUR | 4 | Clases privadas | No | No |
| `hybrid` | 150 EUR | 4 | Clases privadas + grupo compatible | Solo si hay compatibilidad de nivel, intereses y ritmo | Si |
| `bootcamp` | 345 EUR | 20 | Clases privadas intensivas | No | No |

El plan `group` no incluye clases privadas. Existe para practica guiada con otros alumnos de la academia cuando el equipo pueda emparejar alumnos compatibles; si no hay grupo adecuado, se recomienda otra ruta o se espera. No debe venderse como sustituto barato de una clase privada ni como comunidad garantizada antes de conocer a los alumnos.

En el lanzamiento, `group` y `hybrid` permanecen visibles como solicitudes de plaza pero están bloqueados para aprobación y checkout. El campus solo descuenta créditos de sesiones individuales y todavía no tiene roster/cuota de sesión grupal; `hybrid` tampoco garantiza todavía un alta verificable con dos profesores. Sus ofertas pueden existir sincronizadas en Stripe para validar catálogo, pero no son vendibles hasta retirar deliberadamente cada bloqueo con pruebas del flujo prometido. El lanzamiento cobrable inicial queda limitado a `standard` y `bootcamp`.

## Jerarquia Comercial Recomendada

- Entrada principal: `solicitar plaza`.
- Base operativa estable: `standard`, porque no depende de grupo compatible.
- Plan principal de posicionamiento: `hybrid`, porque expresa mejor la promesa premium de clases privadas, grupo compatible cuando exista y doble mirada docente.
- Plan condicionado: `group`, solo si el equipo ya puede emparejar alumnos por nivel, intereses y ritmo.
- Plan intensivo: `bootcamp`, para objetivos concretos y urgencia real.

La estrategia completa queda en `docs/launch/LAUNCH_MARKETING_PLAN.md`.

## Duraciones

| Duracion | Regla |
|---|---|
| 1 mes | 100% |
| 3 meses | 10% descuento |
| 6 meses | 20% descuento |

La compra de 3 o 6 meses concede un banco contractual total de `sesiones/mes × meses`, utilizable de forma flexible hasta `subscriptions.ends_at`; no existe un tope mensual. Las sesiones no usadas no pasan a la renovación siguiente. Checkout y email contractual deben mostrar el total exacto del periodo para que la referencia mensual de la landing no se interprete como una restricción distinta.

## Clases

Duraciones comerciales disponibles: 30, 40 y 50 minutos.

Duracion comercial por defecto: 50 minutos.

La plataforma no corta Google Meet automaticamente.

## Pendiente

- Mantener copy publica ES/EN/RU alineada con solicitud de plaza, grupo compatible y no competir por clases baratas.
- Definir prueba de nivel definitiva si se quiere algo mas formal que la solicitud de plaza enriquecida.
- Repetir sincronizacion con Stripe live antes de pagos reales.
- Activar `CHECKOUT_ENABLED=true` solo durante smoke Stripe test deliberado o cuando Alin decida aceptar pagos reales.
- Registrar evidencia de `payments_staging` antes de activar pagos reales y de Stripe live en `integration_readiness` solo si se van a aceptar pagos reales.
