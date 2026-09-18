/**
 * Quién puede tocar lo que cuelga de un ticket.
 *
 * Es el reflejo exacto de `fn_puede_escribir_en_ticket` en la base. Vive
 * aquí para que la PANTALLA esconda lo mismo que la base rechaza: si la
 * regla se escribe dos veces con matices distintos, el usuario ve un
 * botón que al pulsarlo da un error de permisos, o —peor— no ve un botón
 * que sí le correspondía.
 *
 * ── Ya NO recibe el rol ──────────────────────────────────────────────
 *
 * Antes preguntaba `rol === 'ADMIN' || rol === 'TORRE_CONTROL'`, y era
 * justo el problema: la pantalla de Permisos podía decir una cosa y esto
 * otra, así que marcar o desmarcar una casilla no cambiaba nada. Ahora
 * recibe el CONJUNTO DE PERMISOS del usuario, que es lo mismo que la
 * base consulta.
 *
 * Y el estado del ticket tampoco decide: cerrar un ticket es una marca
 * de avance, no un candado. Quien tenga la acción en la matriz la tiene
 * también sobre un ticket cerrado. El único tope es NOTIFICADO.
 *
 * Funciones puras. No consultan nada.
 */

import type { ProcesoTicket } from '@/lib/types'
import { puede } from './puede'

/**
 * ¿Ya se liquidó en SAP?
 *
 * El proceso 3 —Notificado— cierra el ticket para todo el mundo. Se
 * corrige devolviéndolo a un proceso anterior, que es una decisión de
 * quien revisa y no un cambio de celda. Sólo el Administrador escribe
 * encima, y eso lo decide la base: la pantalla se limita a esconder.
 */
export function estaNotificado(proceso: ProcesoTicket | null | undefined): boolean {
  return proceso === 'NOTIFICADO'
}

/**
 * ¿Se puede hacer `accion` sobre lo que cuelga de este ticket?
 *
 * `pantalla` es la del dato que se va a tocar —`horometros`, `labores`,
 * `tickets`— y `accion` la de la matriz: `editar`, `eliminar`, `crear`.
 */
export function puedeEnTicket(
  permisos: Set<string>,
  pantalla: string,
  accion: string,
  proceso?: ProcesoTicket | null
): boolean {
  if (estaNotificado(proceso)) return false
  return puede(permisos, pantalla, accion)
}
