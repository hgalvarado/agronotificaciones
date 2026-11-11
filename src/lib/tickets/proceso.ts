'use client'

/**
 * Mover el PROCESO de tickets (0 Registrado → 1 Revisando → 2 Pendiente aprobación → 3 Notificado).
 *
 * Quién puede: la casilla «Mover proceso» de Tickets en la matriz (sql/86); «Aprobar» y «Notificar» además
 * para los pasos 2 y 3. Ningún rol escrito aquí: todo sale de las reglas. La base vuelve a validar.
 */

import { createClient } from '@/lib/supabase/client'
import { canExecuteAction, type Reglas } from '@/lib/permisos/clientABAC'
import { PROCESOS } from '@/lib/estados'
import type { ProcesoTicket } from '@/lib/types'

export type InfoProceso = (typeof PROCESOS)[number]

/** Qué llave extra pide cada destino (igual que la base). */
const LLAVE_DESTINO: Partial<Record<ProcesoTicket, string>> = {
  PENDIENTE_APROBACION: 'aprobar',
  NOTIFICADO: 'notificar',
}

export function puedeMoverProceso(reglas: Reglas): boolean {
  return canExecuteAction(reglas, 'tickets', 'mover_proceso')
}

/** Los procesos a los que esta persona puede mover tickets (vacío = ninguno). */
export function destinosPermitidos(reglas: Reglas): InfoProceso[] {
  if (!puedeMoverProceso(reglas)) return []
  return PROCESOS.filter((p) => {
    const llave = LLAVE_DESTINO[p.valor]
    return !llave || canExecuteAction(reglas, 'tickets', llave)
  })
}

/** ¿Puede mover ESTE ticket (alcance sobre el dueño, nunca uno notificado)? */
export function puedeMoverTicket(
  reglas: Reglas,
  t: { usuario_id?: string | null; proceso: ProcesoTicket; estado?: string | null },
  usuarioId: string | null
): boolean {
  return canExecuteAction(
    reglas,
    'tickets',
    'mover_proceso',
    { duenoId: t.usuario_id, proceso: t.proceso },
    { usuarioId }
  )
}

/** El siguiente paso del flujo, si esta persona puede darlo. */
export function siguientePaso(reglas: Reglas, actual: ProcesoTicket): InfoProceso | null {
  const i = PROCESOS.findIndex((p) => p.valor === actual)
  const sig = PROCESOS[i + 1]
  return sig && destinosPermitidos(reglas).some((d) => d.valor === sig.valor) ? sig : null
}

/** Mueve los tickets en una sola llamada. Devuelve cuántos cambió la base. */
export async function moverTickets(
  ids: string[],
  destino: ProcesoTicket
): Promise<{ hechos: number; error: string | null }> {
  if (ids.length === 0) return { hechos: 0, error: null }
  const { data, error } = await createClient().rpc('actualizar_tickets_masivo', {
    p_ticket_ids: ids,
    p_estado: null,
    p_proceso: destino,
  })
  return { hechos: Number(data ?? 0), error: error?.message ?? null }
}

/** «2 tickets pasaron a «1 · Revisando». 1 no se tocó…» */
export function mensajeMovidos(pedidos: number, hechos: number, destino: InfoProceso): string {
  const fuera = pedidos - hechos
  return (
    `${hechos} ${hechos === 1 ? 'ticket pasó' : 'tickets pasaron'} a «${destino.numero} · ${destino.etiqueta}».` +
    (fuera > 0 ? ` ${fuera} no se ${fuera === 1 ? 'tocó' : 'tocaron'} (fuera de tu permiso o ya notificados).` : '')
  )
}

/** Notificado deja todo de sólo lectura: es el único paso que se confirma. */
export function confirmarDestino(destino: ProcesoTicket, cuantos: number): boolean {
  if (destino !== 'NOTIFICADO') return true
  return confirm(
    `Marcar ${cuantos === 1 ? 'el ticket' : `${cuantos} tickets`} como «3 · Notificado» (ya liquidado en SAP).\n\n` +
      'Quedan de sólo lectura para todos. ¿Continuar?'
  )
}
