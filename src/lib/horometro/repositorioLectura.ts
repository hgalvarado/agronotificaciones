'use client'

/**
 * Última lectura del horómetro de un equipo ANTES de la jornada que se captura (continuidad).
 *
 * Sólo lee: no decide si se propone ni cómo se avisa (eso es del formulario). Va primero por la RPC
 * `fn_ultima_lectura_equipo` (sql/85, security definer: ve las lecturas de otros capturadores). Si la migración
 * todavía no está corrida, cae a un `select` normal, que con RLS ve sólo lo que el usuario puede ver: menos
 * completo, pero sigue sirviendo (casi siempre el equipo lo capturó la misma persona).
 */

import { createClient } from '@/lib/supabase/client'
import type { TurnoTipo } from '@/lib/types'

export type LecturaAnterior = { final: number; fecha: string; turno: TurnoTipo }

type Fila = { horometro_final: number | string; fecha: string; turno: string }

const aLectura = (f: Fila | undefined): LecturaAnterior | null =>
  f && f.horometro_final !== null && f.horometro_final !== undefined
    ? { final: Number(f.horometro_final), fecha: f.fecha, turno: f.turno as TurnoTipo }
    : null

export async function ultimaLecturaDeEquipo(
  equipoId: string,
  fecha: string,
  turno: TurnoTipo,
  excluirId?: string
): Promise<LecturaAnterior | null> {
  if (!equipoId || !fecha) return null
  const supabase = createClient()

  const rpc = await supabase.rpc('fn_ultima_lectura_equipo', {
    p_equipo_id: equipoId,
    p_fecha: fecha,
    p_turno: turno,
    p_excluir: excluirId ?? null,
  })
  if (!rpc.error) return aLectura((rpc.data as Fila[] | null)?.[0])

  // Respaldo sin migración: mismas reglas de «anterior», resueltas aquí
  let q = supabase
    .from('horometros')
    .select('horometro_final, fecha, turno, created_at')
    .eq('equipo_id', equipoId)
    .lte('fecha', fecha)
    .order('fecha', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(6)
  if (excluirId) q = q.neq('id', excluirId)
  const { data, error } = await q
  if (error || !data) return null
  const anteriores = (data as (Fila & { created_at: string })[]).filter(
    (h) => h.fecha < fecha || (turno === 'NOCTURNO' && h.turno === 'DIURNO')
  )
  // Del mismo día, el nocturno va después del diurno
  const peso = (h: Fila) => `${h.fecha}|${h.turno === 'NOCTURNO' ? 1 : 0}`
  anteriores.sort((a, b) => (peso(a) < peso(b) ? 1 : peso(a) > peso(b) ? -1 : 0))
  return aLectura(anteriores[0])
}
