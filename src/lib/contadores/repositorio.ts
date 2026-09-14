'use client'

/**
 * Persistencia del historial de contadores. Sólo lee y escribe.
 *
 * Registrar un cambio de tablero NO se hace con un insert: son dos
 * hechos —se cerró un contador y empezó otro— y separarlos es como se
 * acaba con un historial lleno de huecos. Eso lo resuelve la función
 * `fn_cambiar_contador` de la base, y aquí sólo se la llama.
 *
 * Editar o eliminar un periodo sí es una tabla normal: ahí se está
 * corrigiendo lo que ya se registró, no documentando un hecho nuevo.
 */

import { createClient } from '@/lib/supabase/client'
import { mensajeDeError } from '@/lib/errores'
import { deEntradaLocal } from '@/lib/fechas'
import type { EntradaCambio, EntradaPeriodo, FilaContador } from './tipos'

export type Resultado = { ok: boolean; mensaje: string }

/** Falta la migración 38: la pantalla lo dice en vez de salir vacía. */
export const AVISO_SIN_MIGRACION =
  'El historial de contadores todavía no está instalado. Corre la migración 38 en el SQL Editor de Supabase.'

export function faltaMigracion(mensaje: string | null | undefined): boolean {
  const t = (mensaje ?? '').toLowerCase()
  return t.includes('does not exist') || t.includes('schema cache')
}

export async function leerContadores(): Promise<{
  datos: FilaContador[]
  error: string | null
}> {
  const { data, error } = await createClient()
    .from('v_contadores_equipo')
    .select('*')
    .order('equipo_codigo', { ascending: true })
    .order('vigente_desde', { ascending: false })
    .limit(2000)

  if (error) return { datos: [], error: error.message }
  return { datos: (data as FilaContador[]) ?? [], error: null }
}

export async function registrarCambio(e: EntradaCambio): Promise<Resultado> {
  const { error } = await createClient().rpc('fn_cambiar_contador', {
    p_equipo_id: e.equipoId,
    p_contador_nuevo: e.contadorNuevo.trim(),
    p_desde: deEntradaLocal(e.desde),
    p_motivo: e.motivo.trim() || null,
    p_contador_viejo: e.contadorViejo.trim() || null,
  })

  if (error) return { ok: false, mensaje: mensajeDeError(error, 'No se pudo registrar el cambio.') }
  return { ok: true, mensaje: 'Cambio de tablero registrado.' }
}

export async function guardarPeriodo(id: string, e: EntradaPeriodo): Promise<Resultado> {
  const { error } = await createClient()
    .from('contadores_equipo')
    .update({
      contador: e.contador.trim(),
      contador_anterior: e.contadorAnterior.trim() || null,
      motivo: e.motivo.trim() || null,
      vigente_desde: deEntradaLocal(e.desde),
      // Vaciar el campo devuelve el periodo a «es el de hoy», que es una
      // corrección legítima cuando alguien lo cerró por error.
      vigente_hasta: e.hasta ? deEntradaLocal(e.hasta) : null,
    })
    .eq('id', id)

  if (error) return { ok: false, mensaje: mensajeDeError(error) }
  return { ok: true, mensaje: 'Periodo guardado.' }
}

export async function eliminarPeriodos(ids: string[]): Promise<Resultado> {
  if (ids.length === 0) return { ok: true, mensaje: '' }

  const { error } = await createClient().from('contadores_equipo').delete().in('id', ids)

  if (error) return { ok: false, mensaje: mensajeDeError(error, 'No se pudo eliminar.') }
  return {
    ok: true,
    mensaje:
      ids.length === 1
        ? 'Periodo eliminado. Las jornadas que cubría vuelven al contador anterior.'
        : `${ids.length} periodos eliminados.`,
  }
}
