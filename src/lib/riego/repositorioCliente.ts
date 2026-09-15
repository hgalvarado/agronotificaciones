'use client'

/**
 * Persistencia de los turnos de riego desde el navegador. Sólo lee y
 * escribe; no valida y no decide nada.
 *
 * Guardar NO es un insert: cabecera y lotes van en una sola llamada a
 * `fn_guardar_turno_riego`. Medio turno guardado descuadra el área contra
 * el plan de siembra, y eso no se ve hasta que alguien cuadra el mes.
 */

import { createClient } from '@/lib/supabase/client'
import { mensajeDeError } from '@/lib/errores'
import { lineasParaGuardar } from './validacion'
import type { EntradaTurno, FilaTurnoRiego, LineaTurno, LoteRegable } from './tipos'

export type Resultado = { ok: boolean; mensaje: string }

export const AVISO_SIN_MIGRACION =
  'El módulo de riego todavía no está instalado. Corre la migración 40 en el SQL Editor de Supabase.'

export function faltaMigracion(mensaje: string | null | undefined): boolean {
  const t = (mensaje ?? '').toLowerCase()
  return t.includes('does not exist') || t.includes('schema cache')
}

export async function leerTurnos(
  temporadaId: string | null,
  desde: string,
  hasta: string
): Promise<{ datos: FilaTurnoRiego[]; error: string | null }> {
  let q = createClient()
    .from('v_turnos_riego')
    .select('*')
    .gte('fecha_siembra', desde)
    .lte('fecha_siembra', hasta)
    .order('fecha_siembra', { ascending: false })
    .order('turno', { ascending: true })
    .order('ut', { ascending: true })
    .limit(5000)

  if (temporadaId) q = q.eq('temporada_id', temporadaId)

  const { data, error } = await q
  if (error) return { datos: [], error: error.message }
  return { datos: (data as FilaTurnoRiego[]) ?? [], error: null }
}

/**
 * Cuánta área queda libre en cada lote.
 *
 * `turnoId` se manda al editar: sin él, el área que el propio turno tiene
 * puesta contaría como ocupada y corregir 8.99 a 9.00 parecería un exceso.
 */
export async function leerLotesRegables(
  temporadaId: string,
  zonaId: string | null,
  turnoId: string | null
): Promise<{ datos: LoteRegable[]; error: string | null }> {
  const { data, error } = await createClient().rpc('fn_lotes_regables', {
    p_temporada_id: temporadaId,
    p_zona_id: zonaId || null,
    p_turno_id: turnoId || null,
  })

  if (error) return { datos: [], error: error.message }
  return { datos: (data as LoteRegable[]) ?? [], error: null }
}

export async function guardarTurno(e: EntradaTurno, lineas: LineaTurno[]): Promise<Resultado> {
  const { error } = await createClient().rpc('fn_guardar_turno_riego', {
    p_turno_id: e.turnoId,
    p_temporada_id: e.temporadaId,
    p_ciclo: Number(e.ciclo),
    p_fecha_siembra: e.fechaSiembra,
    p_zona_id: e.zonaId,
    p_turno: e.turno.trim(),
    p_plan_nutricional_id: e.planNutricionalId || null,
    p_estacion_riego: e.estacionRiego.trim() || null,
    p_fuente_agua: e.fuenteAgua || null,
    p_orden_sap: e.ordenSap.trim() || null,
    p_estado: e.estado,
    p_responsable: e.responsable.trim() || null,
    p_comentarios: e.comentarios.trim() || null,
    p_lotes: lineasParaGuardar(lineas),
  })

  if (error) return { ok: false, mensaje: mensajeDeError(error, 'No se pudo guardar el turno.') }
  return { ok: true, mensaje: e.turnoId ? 'Turno guardado.' : 'Turno creado.' }
}

/** Cambios en masa sobre la CABECERA: estado y orden SAP, que es lo que se hace de a veinte. */
export async function actualizarTurnos(
  turnoIds: string[],
  cambios: Record<string, unknown>
): Promise<Resultado> {
  if (turnoIds.length === 0) return { ok: true, mensaje: '' }

  const { error } = await createClient()
    .from('turnos_riego')
    .update(cambios)
    .in('id', [...new Set(turnoIds)])

  if (error) return { ok: false, mensaje: mensajeDeError(error) }
  return { ok: true, mensaje: `${new Set(turnoIds).size} turnos actualizados.` }
}

/**
 * Eliminar LOTES de un turno.
 *
 * Quitarle a un turno su último lote deja una cabecera que no riega nada,
 * así que ese turno se elimina entero. Es la misma regla de /labores con
 * las líneas, y el aviso de la pantalla lo dice antes de hacerlo.
 */
export async function eliminarLineas(
  detalleIds: string[],
  turnosCompletos: string[]
): Promise<Resultado> {
  const supabase = createClient()

  if (turnosCompletos.length > 0) {
    const { error } = await supabase.from('turnos_riego').delete().in('id', turnosCompletos)
    if (error) return { ok: false, mensaje: mensajeDeError(error, 'No se pudo eliminar.') }
  }
  if (detalleIds.length > 0) {
    const { error } = await supabase.from('turnos_riego_detalle').delete().in('id', detalleIds)
    if (error) return { ok: false, mensaje: mensajeDeError(error, 'No se pudo eliminar.') }
  }

  const n = detalleIds.length + turnosCompletos.length
  return { ok: true, mensaje: n === 1 ? 'Eliminado.' : `${n} registros eliminados.` }
}
