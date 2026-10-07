/**
 * Quién puede tocar lo que cuelga de un ticket.
 *
 * Es el reflejo exacto de `fn_puede_escribir_en_ticket` en la base. Vive
 * aquí para que la PANTALLA esconda lo mismo que la base rechaza: si la
 * regla se escribe dos veces con matices distintos, el usuario ve un
 * botón que al pulsarlo da un error de permisos, o —peor— no ve un botón
 * que sí le correspondía.
 *
 * ── Ya NO pregunta por una casilla aparte ────────────────────────────
 *
 * Hasta la 52 el candado del proceso se levantaba con una acción propia,
 * `tickets:editar_en_revision`. La 53 la borró y la convirtió en la
 * CONDICIÓN del permiso de editar. Esto siguió preguntando por la acción
 * vieja un tiempo, y como ya no existe contestaba que no SIEMPRE: los
 * tickets en revisión quedaban congelados para todo el mundo, incluido
 * quien tenía el permiso. Ahora lee la condición, que es donde vive.
 *
 * Y antes de eso preguntaba `rol === 'ADMIN' || rol === 'TORRE_CONTROL'`,
 * que era el mismo problema una vuelta más atrás: la matriz decía una
 * cosa y esto otra, así que marcar una casilla no cambiaba nada.
 *
 * El estado del ticket tampoco decide por sí solo: cerrar un ticket es
 * una marca de avance, no un candado. El único tope absoluto es
 * NOTIFICADO.
 *
 * Funciones puras. No consultan nada.
 */

import type { ProcesoTicket } from '@/lib/types'
import { canExecuteAction, estaNotificado, nivelDeProceso, type Reglas } from './clientABAC'

export { estaNotificado, nivelDeProceso }

/**
 * ¿El ticket ya salió de «0. Registrado»?
 *
 * A partir del paso 1 el ticket está en manos de quien revisa y se
 * congela: lo que se revisó el lunes tiene que ser lo que se liquida el
 * martes. Es el reflejo de `fn_ticket_en_revision` en la base.
 */
export function enRevision(proceso: ProcesoTicket | null | undefined): boolean {
  return proceso != null && proceso !== 'REGISTRADO'
}

/**
 * ¿A esta persona se le levanta el candado del proceso para `pantalla`?
 *
 * Sale de la CONDICIÓN de su permiso de editar, no de una casilla
 * aparte: `sin_restriccion` quiere decir que puede en cualquier momento
 * del proceso. NOTIFICADO no lo abre ni así.
 */
export function puedeEditarEnRevision(reglas: Reglas, pantalla = 'tickets'): boolean {
  return canExecuteAction(reglas, pantalla, 'editar', {
    // Un ticket en revisión y abierto: si con eso contesta que sí, es
    // que su condición no le pone el candado del proceso.
    proceso: 'REVISANDO',
    estado: 'ABIERTO',
  })
}

/**
 * ¿Se puede hacer `accion` sobre lo que cuelga de este ticket?
 *
 * `pantalla` es la del dato que se va a tocar —`horometros`, `labores`,
 * `tickets`— y `accion` la de la matriz: `editar`, `eliminar`, `crear`.
 */
export function puedeEnTicket(
  reglas: Reglas,
  pantalla: string,
  accion: string,
  proceso?: ProcesoTicket | null,
  estado?: string | null
): boolean {
  return canExecuteAction(reglas, pantalla, accion, { proceso, estado })
}
