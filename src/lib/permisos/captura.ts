/**
 * Quién puede tocar lo que cuelga de un ticket.
 *
 * Es el reflejo exacto de `fn_puede_escribir_en_ticket` en la base. Vive
 * aquí para que la PANTALLA esconda lo mismo que la base rechaza: si la
 * regla se escribe dos veces con matices distintos, el usuario ve un
 * botón que al pulsarlo da un error de permisos, o —peor— no ve un botón
 * que sí le correspondía.
 *
 * Función pura. No consulta nada: recibe el rol, el estado y el proceso.
 */

import type { EstadoTicket, ProcesoTicket, RolCodigo } from '@/lib/types'

/** Los dos roles que mandan sobre cualquier ticket, en cualquier estado. */
export function mandaSobreTodo(rol: RolCodigo | null | undefined): boolean {
  return rol === 'ADMIN' || rol === 'TORRE_CONTROL'
}

/**
 * ¿Ya se liquidó en SAP?
 *
 * El proceso 3 —Notificado— cierra el ticket para todo el mundo menos
 * para el Administrador. Antes el proceso no era un candado: era sólo el
 * avance hacia SAP. Se cambió porque corregir una línea ya notificada
 * deja la base diciendo una cosa y SAP otra, y nadie se enteraba hasta
 * el cierre de mes. Se corrige devolviendo el ticket a un proceso
 * anterior, que es una decisión de Torre de Control y no un cambio de
 * celda.
 */
export function estaNotificado(proceso: ProcesoTicket | null | undefined): boolean {
  return proceso === 'NOTIFICADO'
}

/**
 * ¿Se pueden agregar, editar o quitar horómetros y labores de este ticket?
 *
 * «Administrador y Torre de Control pueden editar cualquier registro,
 *  labor u horómetro en cualquier momento. NO deben requerir cambiar el
 *  estado del ticket a abierto.» Eso se mantiene; lo que se agrega es el
 *  tope de arriba: ya notificado, sólo el Administrador.
 */
export function puedeCapturar(
  rol: RolCodigo | null | undefined,
  estado: EstadoTicket | null | undefined,
  proceso?: ProcesoTicket | null
): boolean {
  if (rol === 'ADMIN') return true
  if (estaNotificado(proceso)) return false
  return mandaSobreTodo(rol) || estado === 'ABIERTO'
}
