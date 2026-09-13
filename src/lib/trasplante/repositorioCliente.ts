'use client'

/**
 * Escrituras del trasplante desde el navegador.
 *
 * El único sitio del módulo que escribe. No valida ni decide: recibe
 * valores ya limpios y los manda. Está separado de `repositorio.ts`
 * —que lee en el servidor— porque usan clientes distintos y en Next un
 * archivo no puede ser las dos cosas.
 */

import { createClient } from '@/lib/supabase/client'

export type CamposSiembra = {
  fecha_siembra?: string
  lote_temporada_id?: string
  variedad_id?: string
  ciclo?: number
  lote_variedad?: string | null
  avance_mz?: number
  plantas_reportadas?: number | null
  observaciones?: string | null
}

export async function guardarSiembra(id: string, campos: CamposSiembra) {
  const supabase = createClient()
  const { error } = await supabase.from('siembras').update(campos).eq('id', id)
  return { error: error?.message ?? null }
}

/**
 * El mismo cambio a muchas filas de una vez.
 *
 * Un solo `update ... in (...)`: si se cortara la red a media lista, con
 * llamadas sueltas quedaría la mitad cambiada y la otra no.
 */
export async function guardarSiembrasEnMasa(ids: string[], campos: CamposSiembra) {
  if (ids.length === 0) return { error: null }
  const supabase = createClient()
  const { error } = await supabase.from('siembras').update(campos).in('id', ids)
  return { error: error?.message ?? null }
}

export async function borrarSiembras(ids: string[]) {
  if (ids.length === 0) return { error: null }
  const supabase = createClient()
  const { error } = await supabase.from('siembras').delete().in('id', ids)
  return { error: error?.message ?? null }
}

export type SiembraNueva = {
  temporada_id: string
  lote_temporada_id: string
  variedad_id: string
  fecha_siembra: string
  ciclo: number
  lote_variedad: string | null
  avance_mz: number
  plantas_reportadas: number | null
  observaciones: string | null
}

/**
 * Alta masiva de siembras.
 *
 * `usuario_id` no viaja en el archivo: quien importa es quien firma, y
 * eso lo sabe la sesión, no el Excel.
 */
export async function insertarSiembras(filas: SiembraNueva[]) {
  if (filas.length === 0) return { error: null }
  const supabase = createClient()
  const { data: sesion } = await supabase.auth.getUser()
  const usuarioId = sesion.user?.id
  if (!usuarioId) return { error: 'La sesión expiró. Vuelve a entrar para importar.' }

  const { error } = await supabase
    .from('siembras')
    .insert(filas.map((f) => ({ ...f, usuario_id: usuarioId })))
  return { error: error?.message ?? null }
}

export type CamposPlanSiembra = {
  lote_temporada_id?: string
  variedad_id?: string
  ciclo?: number
  area_plan?: number
  fecha_siembra?: string | null
  distancia_siembra?: string | null
}

export async function guardarPlanSiembra(id: string, campos: CamposPlanSiembra) {
  const supabase = createClient()
  const { error } = await supabase.from('planes_siembra').update(campos).eq('id', id)
  return { error: error?.message ?? null }
}

/**
 * El mismo cambio a muchas líneas del plan de una vez.
 *
 * Un solo `update ... in (...)`: si se cortara la red a media lista, con
 * llamadas sueltas quedaría la mitad cambiada y la otra no.
 */
export async function guardarPlanesSiembraEnMasa(ids: string[], campos: CamposPlanSiembra) {
  if (ids.length === 0) return { error: null }
  const supabase = createClient()
  const { error } = await supabase.from('planes_siembra').update(campos).in('id', ids)
  return { error: error?.message ?? null }
}

export type PlanSiembraNuevo = {
  temporada_id: string
  lote_temporada_id: string
  ciclo: number
  variedad_id: string
  fecha_siembra: string | null
  area_plan: number
  distancia_siembra: string | null
}

/**
 * Carga del plan: reemplaza el plan de los lotes que trae el archivo.
 *
 * No es un `upsert`. Un lote PUEDE repetir variedad y ciclo —se siembra
 * en dos fechas, o con dos distancias— así que no hay llave por la que
 * decidir si una fila es «la misma» que otra, y un `on conflict` sobre
 * esas tres columnas además revienta cuando el archivo trae dos líneas
 * iguales en la misma carga.
 *
 * Lo que sí tiene sentido es el documento: volver a subir el archivo deja
 * el plan de ESOS lotes exactamente como dice el archivo, y no toca el de
 * los demás. El borrado y la inserción los hace la base en una sola
 * transacción: si se cortara en medio, esos lotes se quedarían sin plan.
 */
export async function guardarPlanesEnMasa(temporadaId: string, filas: PlanSiembraNuevo[]) {
  if (filas.length === 0) return { error: null, guardadas: 0 }
  const supabase = createClient()
  const { data, error } = await supabase.rpc('fn_cargar_plan_siembra', {
    p_temporada_id: temporadaId,
    p_filas: filas.map((f) => ({
      lote_temporada_id: f.lote_temporada_id,
      ciclo: f.ciclo,
      variedad_id: f.variedad_id,
      fecha_siembra: f.fecha_siembra ?? '',
      area_plan: f.area_plan,
      distancia_siembra: f.distancia_siembra ?? '',
    })),
  })
  return { error: error?.message ?? null, guardadas: Number(data ?? 0) }
}

export type FilaRecepcionNueva = {
  temporada_id: string
  variedad_id: string
  fecha: string
  plantulas_enviadas: number | null
  plantulas_facturadas: number
  costo_unitario: number
  numero_factura: string | null
  lote_semilla: string | null
  bandejas_enviadas: number | null
  documento_sap: string | null
  observaciones: string | null
}

export async function guardarRecepciones(
  nuevas: FilaRecepcionNueva[],
  cambiadas: { id: string; campos: Omit<FilaRecepcionNueva, 'temporada_id'> }[],
  borradas: string[]
) {
  const supabase = createClient()

  if (borradas.length > 0) {
    const { error } = await supabase.from('recepcion_plantulas').delete().in('id', borradas)
    if (error) return { error: error.message }
  }
  if (nuevas.length > 0) {
    const { error } = await supabase.from('recepcion_plantulas').insert(nuevas)
    if (error) return { error: error.message }
  }
  for (const c of cambiadas) {
    const { error } = await supabase
      .from('recepcion_plantulas')
      .update(c.campos)
      .eq('id', c.id)
    if (error) return { error: error.message }
  }
  return { error: null }
}
