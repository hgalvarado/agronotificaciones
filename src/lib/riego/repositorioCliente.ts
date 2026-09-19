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
import { leerTodo } from '@/lib/supabase/paginar'
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

/**
 * Los turnos de una temporada y, si se pide, de un ciclo.
 *
 * No hay rango de fechas a propósito: el riego se organiza por ciclo de
 * cultivo, no por mes. Un turno con fecha de siembra en enero se
 * programa en septiembre, así que un «desde/hasta» sobre la fecha de
 * siembra escondía justo lo que se acababa de capturar.
 */
export async function leerTurnos(
  temporadaId: string | null,
  ciclo: number | null
): Promise<{ datos: FilaTurnoRiego[]; error: string | null }> {
  const { datos, error } = await leerTodo<FilaTurnoRiego>((desde, hasta) => {
    let q = createClient()
      .from('v_turnos_riego')
      .select('*')
      .order('fecha_siembra', { ascending: false })
      .order('turno', { ascending: true })
      .order('ut', { ascending: true })
      .order('detalle_id', { ascending: true })
      .range(desde, hasta)

    if (temporadaId) q = q.eq('temporada_id', temporadaId)
    if (ciclo) q = q.eq('ciclo', ciclo)
    return q
  })
  return { datos, error }
}

/**
 * Corrige UN campo sobre la cuadrícula.
 *
 * Pasa por `fn_editar_turno_riego` y no por un `update` suelto porque
 * hay campos que son del lote y otros del turno entero, y porque el área
 * la sigue validando el disparador de siempre: escribirla con un update
 * directo se saltaría el aviso de «no cabe».
 */
export async function editarCampo(
  detalleId: string,
  campo: string,
  valor: unknown
): Promise<Resultado> {
  const { error } = await createClient().rpc('fn_editar_turno_riego', {
    p_detalle_id: detalleId,
    p_campo: campo,
    p_valor: valor === null || valor === undefined ? '' : String(valor),
  })

  if (error) return { ok: false, mensaje: mensajeDeError(error, 'No se pudo guardar el cambio.') }
  return { ok: true, mensaje: '' }
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
    p_turno_catalogo_id: e.turnoCatalogoId || null,
    p_estacion_riego_id: e.estacionRiegoId || null,
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
