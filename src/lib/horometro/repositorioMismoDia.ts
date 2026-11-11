'use client'

/**
 * Otras lecturas del mismo equipo en la misma fecha (para avisar de un registro repetido).
 *
 * Primero la RPC `fn_horometros_mismo_dia` (sql/88, ve también lo que capturó otra persona). Si la migración no
 * está corrida, cae a un `select` con RLS: sólo lo que el usuario ve, que cubre el caso más común (el mismo
 * capturador vuelve a registrar el equipo en su ticket).
 */

import { createClient } from '@/lib/supabase/client'
import type { LecturaDelDia } from './repetido'

type FilaRpc = {
  id: string
  ticket_id: string
  turno: string
  horometro_inicial: number | string
  horometro_final: number | string
  operador_nombre: string | null
  labores: number
  es_mio: boolean
  capturo: string | null
}

export async function lecturasMismoDia(
  equipoId: string,
  fecha: string,
  excluirId?: string
): Promise<LecturaDelDia[]> {
  if (!equipoId || !fecha) return []
  const supabase = createClient()
  const rpc = await supabase.rpc('fn_horometros_mismo_dia', {
    p_equipo_id: equipoId,
    p_fecha: fecha,
    p_excluir: excluirId ?? null,
  })
  if (!rpc.error) {
    return ((rpc.data as FilaRpc[] | null) ?? []).map((f) => ({
      id: f.id,
      ticketId: f.ticket_id,
      turno: f.turno,
      inicial: Number(f.horometro_inicial),
      final: Number(f.horometro_final),
      operador: f.operador_nombre,
      labores: Number(f.labores ?? 0),
      esMio: Boolean(f.es_mio),
      capturo: f.capturo,
    }))
  }

  // Respaldo sin la migración 88
  let q = supabase
    .from('horometros')
    .select('id, ticket_id, turno, horometro_inicial, horometro_final, operadores(nombre), registros(count), tickets(usuario_id)')
    .eq('equipo_id', equipoId)
    .eq('fecha', fecha)
    .limit(20)
  if (excluirId) q = q.neq('id', excluirId)
  const [{ data }, { data: sesion }] = await Promise.all([q, supabase.auth.getSession()])
  const usuarioId = sesion.session?.user.id ?? null
  type FilaSel = {
    id: string
    ticket_id: string
    turno: string
    horometro_inicial: number
    horometro_final: number
    operadores: { nombre: string } | null
    registros: { count: number }[] | null
    tickets: { usuario_id: string } | null
  }
  return ((data as unknown as FilaSel[] | null) ?? []).map((f) => ({
    id: f.id,
    ticketId: f.ticket_id,
    turno: f.turno,
    inicial: Number(f.horometro_inicial),
    final: Number(f.horometro_final),
    operador: f.operadores?.nombre ?? null,
    labores: f.registros?.[0]?.count ?? 0,
    esMio: f.tickets?.usuario_id === usuarioId,
    capturo: null,
  }))
}
