# Products And Pricing

Fuente runtime: Supabase `packages`, gestionado desde `/es/campus/admin/packages`.

## Reglas

- No editar DB, Stripe y copy publica por separado.
- Guardar cambios en CRM antes de sincronizar Stripe.
- Stripe Price IDs son inmutables.
- Si cambia el precio mensual, el CRM borra los Price IDs guardados.
- Un paquete activo sin `stripe_price_1m`, `stripe_price_3m` y `stripe_price_6m` no esta listo para checkout.
- El checkout inicial acepta tarjeta y mantiene los códigos promocionales desactivados para que el importe contratado y renovado coincida con el resumen contractual probado.
- Cambios de precio/cuota afectan solo nuevas compras.
- Mientras Stripe siga en modo prueba, no aceptar pagos reales. Para un soft launch sin pagos, checkout debe quedar desactivado, oculto o bloqueado por datos/configuracion, y la decision debe quedar como riesgo aceptado en `docs/launch/MANUAL_EVIDENCE.local.json`.
- La entrada comercial recomendada antes de pagos reales es `solicitar plaza`: el formulario publico recoge plan de interes, interes, nivel aproximado, objetivo, disponibilidad y pagina de origen en `leads`, y el email automatico confirma que primero se revisa encaje antes de comprar.
- Las landings publicas usan `PricingSection` en modo `application`; los Price IDs pueden existir para pruebas, pero el CTA publico no debe abrir checkout hasta que se active explicitamente el modo `checkout`.
- `/api/create-checkout` falla cerrado salvo que `CHECKOUT_ENABLED=true`. Mantener `CHECKOUT_ENABLED=false` para operar sin cobros reales aunque existan Price IDs en Supabase.
- El admin de paquetes muestra `checkout_ready`, avisa si un paquete activo no tiene todos los Price IDs y detalla las duraciones pendientes antes de activar checkout.

## Catalogo Actual

| Key | Precio mensual | Sesiones/mes | Tipo | Grupo | Doble profesor |
|---|---:|---:|---|---|---|
| `group` | 50 EUR | 4 | Sesiones grupales guiadas si hay grupo compatible | Solo si hay compatibilidad de nivel, intereses y ritmo | No |
| `standard` | 145 EUR | 4 | Clases privadas | No | No |
| `hybrid` | 150 EUR | 4 | Clases privadas + grupo compatible | Solo si hay compatibilidad de nivel, intereses y ritmo | Si |
| `bootcamp` | 345 EUR | 20 | Clases privadas intensivas | No | No |

El plan `group` no incluye clases privadas. Existe para practica guiada con otros alumnos de la academia cuando el equipo pueda emparejar alumnos compatibles; si no hay grupo adecuado, se recomienda otra ruta o se espera. No debe venderse como sustituto barato de una clase privada ni como comunidad garantizada antes de conocer a los alumnos.

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
