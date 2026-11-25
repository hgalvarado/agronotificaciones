/**
 * Detalle de un movimiento de Inyección para la bitácora de Fertirriego (cuentas puras). El movimiento del libro
 * (APLICACION_LOTE, documento `aplicacion_lote`) solo trae producto y cantidad; el resto (lote con nombre, dosis, área,
 * DDT del plan contra el DDT real, fecha del plan contra la de aplicación, objetivo) sale de lo que ya bajó
 * `fn_iny_estado_campo` (aplicaciones + plan) o, si todavía está por enviar, de la operación de la cola. Sin red.
 * Si Inyección nunca se abrió en este teléfono (no hay estado guardado), devuelve null y la bitácora muestra lo básico.
 */

import type { Operacion } from '@/lib/fertirriego/tipos'
import { lineasDelPlan } from './aplicarLote'
import { planDeEstacion } from './planGeneral'
import { comparativaPlanReal, indicePorAplicacion, type FilaCumplimiento } from './cumplimiento'
import type { EstadoInyeccion } from './estado'
import { rotuloLote } from './lotes'

export type DetalleIny = {
  lote: string
  loteRotulo: string
  fecha: string
  fecha_hora: string
  area_mz: number | null
  registrado_por: string | null
  comentario: string | null
  anulada: boolean
  pendiente: boolean
  /** La línea de ese producto (si se pidió producto). */
  linea: {
    material_id: string
    cantidad: number
    dosis_mz: number | null
    ddt_plan: number | null
    ddt_real: number | null
    fecha_plan: string | null
    dias: number | null
    objetivos: string[]
    en_plan: boolean
  } | null
}

const DIA_MS = 86_400_000
const dia = (iso: string) => iso.slice(0, 10)
const diasEntre = (a: string, b: string) => Math.round((Date.parse(`${dia(a)}T12:00:00Z`) - Date.parse(`${dia(b)}T12:00:00Z`)) / DIA_MS)

/** El índice «aplicación|producto» → cumplimiento de la estación (una sola vez por pantalla). */
export function indiceDeCumplimiento(inyeccion: EstadoInyeccion | null, estacionId: string, hoy: string): Map<string, FilaCumplimiento> {
  if (!inyeccion) return new Map()
  const plan = planDeEstacion(inyeccion.plan, estacionId, new Set(inyeccion.categorias.map((c) => c.clave)))
  const apps = inyeccion.aplicaciones.filter((a) => a.estacion_id === estacionId)
  return indicePorAplicacion(comparativaPlanReal(plan, apps, hoy))
}

export function detalleAplicacion(
  inyeccion: EstadoInyeccion | null,
  indice: Map<string, FilaCumplimiento>,
  cola: Operacion[],
  documentoId: string,
  materialId: string | null,
  estacionId: string
): DetalleIny | null {
  const a = inyeccion?.aplicaciones.find((x) => x.id === documentoId)
  if (inyeccion && a) {
    const l = materialId ? a.lineas.find((x) => x.material_id === materialId) : undefined
    const fila = l ? indice.get(`${a.id}|${l.material_id}`) : undefined
    return {
      lote: a.lote,
      loteRotulo: rotuloLote(inyeccion.lotes, a.lote),
      fecha: a.fecha ?? dia(a.fecha_hora),
      fecha_hora: a.fecha_hora,
      area_mz: a.area_mz,
      registrado_por: a.registrado_por,
      comentario: a.comentario,
      anulada: Boolean(a.anulado_at),
      pendiente: false,
      linea: l
        ? {
            material_id: l.material_id,
            cantidad: Number(l.cantidad),
            dosis_mz: l.dosis_mz ?? null,
            ddt_plan: l.ddt_plan ?? null,
            ddt_real: fila?.ddt_real ?? l.ddt_plan ?? null,
            fecha_plan: fila?.fecha_plan ?? null,
            dias: fila?.dias ?? null,
            objetivos: l.objetivos && l.objetivos.length > 0 ? l.objetivos : a.objetivos,
            en_plan: l.en_plan,
          }
        : null,
    }
  }

  // Todavía por enviar: se arma con lo que se escribió en el teléfono
  const op = cola.find((o) => o.id === documentoId && o.tipo === 'aplicacion_lote')
  if (!op) return null
  const d = op.datos
  const lote = String(d.lote ?? '')
  const fechaHora = String(d.fecha_hora ?? op.creado_en)
  const area = Number(d.area_mz ?? 0) || null
  const lineas = (d.lineas as { material_id?: string; cantidad?: number | string; objetivos?: { nombre: string }[] }[] | undefined) ?? []
  const l = materialId ? lineas.find((x) => String(x.material_id) === materialId) : undefined
  const objetivosOp = (d.objetivos as { nombre: string }[] | undefined) ?? []
  let linea: DetalleIny['linea'] = null
  if (l && materialId) {
    const plan = inyeccion ? planDeEstacion(inyeccion.plan, estacionId, new Set(inyeccion.categorias.map((c) => c.clave))) : []
    const g = lineasDelPlan(plan, { lote, categoriaClave: (d.categoria_clave as string | null) ?? null, fecha: dia(fechaHora) }).find((x) => x.material_id === materialId)
    const cant = Number(l.cantidad) || 0
    const dias = g?.fecha_plan ? diasEntre(dia(fechaHora), g.fecha_plan) : null
    linea = {
      material_id: materialId,
      cantidad: cant,
      dosis_mz: area ? Math.round((cant / area) * 10000) / 10000 : null,
      ddt_plan: g?.ddt ?? null,
      ddt_real: g && g.ddt !== null && dias !== null ? g.ddt + dias : (g?.ddt ?? null),
      fecha_plan: g?.fecha_plan ?? null,
      dias,
      objetivos: (l.objetivos && l.objetivos.length > 0 ? l.objetivos : objetivosOp).map((o) => o.nombre),
      en_plan: Boolean(g),
    }
  }
  return {
    lote,
    loteRotulo: rotuloLote(inyeccion?.lotes, lote),
    fecha: dia(fechaHora),
    fecha_hora: fechaHora,
    area_mz: area,
    registrado_por: op.en_nombre_de ?? null,
    comentario: (d.comentario as string | null) ?? null,
    anulada: false,
    pendiente: true,
    linea,
  }
}
