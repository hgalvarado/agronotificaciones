/**
 * Quién puede tocar lo que cuelga de un ticket.
 *
 * Es el reflejo exacto de `fn_puede_capturar_en_ticket` en la base. Vive
 * aquí para que la PANTALLA esconda lo mismo que la base rechaza: si la
 * regla se escribe dos veces con matices distintos, el usuario ve un
 * botón que al pulsarlo da un error de permisos, o —peor— no ve un botón
 * que sí le correspondía.
 *
 * Función pura. No consulta nada: recibe el rol y el estado.
 */

import type { EstadoTicket, RolCodigo } from '@/lib/types'

/** Los dos roles que mandan sobre cualquier ticket, en cualquier estado. */
export function mandaSobreTodo(rol: RolCodigo | null | undefined): boolean {
  return rol === 'ADMIN' || rol === 'TORRE_CONTROL'
}

/**
 * ¿Se pueden agregar, editar o quitar horómetros y labores de este ticket?
 *
 * «Administrador y Torre de Control pueden editar cualquier registro,
 *  labor u horómetro en cualquier momento. NO deben requerir cambiar el
 *  estado del ticket a abierto ni importar el estado del proceso.»
 *
 * De ahí que el proceso —Registrado, Revisando, Notificado— no aparezca
 * en esta función: no decide nada sobre quién puede editar. Es el avance
 * hacia SAP, no un candado.
 */
export function puedeCapturar(
  rol: RolCodigo | null | undefined,
  estado: EstadoTicket | null | undefined
): boolean {
  return mandaSobreTodo(rol) || estado === 'ABIERTO'
}
