/**
 * Plan contra real de Inyección (cuentas puras; ni React, ni red). Una fila por (lote, DDT, producto) del plan de la
 * estación con lo que realmente se aplicó (aplicaciones del servidor, sin las anuladas), y una fila «sin plan» por cada
 * línea aplicada que no corresponde a ningún plan. Misma llave de «hecho» que el resto de Inyección (`marcaHecho`).
 *
 * Estados (siempre se muestran con icono y texto):
 *   tiempo:   a_tiempo | tarde | temprano | vencido (ya tocaba y no se hizo) | pendiente (aún no toca) | sin_plan | sin_fecha
 *   cantidad: exacto | de_mas | de_menos
 * `tags` = lo que se usa para el filtro «Estado del cumplimiento».
 */

import type { FilaPlanInyeccion } from './aplicarLote'
import type { AplicacionInyeccion } from './estado'
import { marcaHecho } from './planGeneral'

/** Días de diferencia que se aceptan como «a tiempo» y fracción de cantidad que se acepta como «exacto». */
export const TOLERANCIA_DIAS = 1
export const TOLERANCIA_CANTIDAD = 0.05

export type Tiempo = 'a_tiempo' | 'tarde' | 'temprano' | 'vencido' | 'pendiente' | 'sin_plan' | 'sin_fecha'
export type EstadoCantidad = 'exacto' | 'de_mas' | 'de_menos'
export type EtiquetaCumplimiento = 'a_tiempo' | 'tarde' | 'temprano' | 'de_mas' | 'de_menos' | 'sin_aplicar' | 'sin_plan'

export const ETIQUETAS_CUMPLIMIENTO: [EtiquetaCumplimiento, string][] = [
  ['a_tiempo', 'A tiempo'],
  ['tarde', 'Tarde'],
  ['temprano', 'Temprano'],
  ['de_mas', 'De más'],
  ['de_menos', 'De menos'],
  ['sin_aplicar', 'Sin aplicar'],
  ['sin_plan', 'Sin plan'],
]

export type AplicacionDeFila = {
  id: string
  fecha: string
  fecha_hora: string
  cantidad: number
  dosis_mz: number | null
  area_mz: number
  registrado_por: string | null
  objetivos: string[]
}

export type FilaCumplimiento = {
  clave: string
  lote: string
  ddt: number | null
  ciclo: string | null
  material_id: string
  /** Categoría del plan (clave del catálogo de categorías); null en las filas «sin plan». */
  categoria_clave: string | null
  fecha_plan: string | null
  fecha_estimada: boolean
  dosis_plan: number | null
  area_plan: number
  cantidad_plan: number
  aplicaciones: AplicacionDeFila[]
  cantidad_real: number
  /** Primera aplicación de esa fila (día en hora de Honduras). */
  fecha_real: string | null
  /** DDT en que de verdad se aplicó: DDT del plan + días de diferencia. */
  ddt_real: number | null
  /** Días reales − días del plan (positivo = tarde). */
  dias: number | null
  dif_cantidad: number | null
  dif_pct: number | null
  tiempo: Tiempo
  cantidad: EstadoCantidad | null
  tags: EtiquetaCumplimiento[]
}

const DIA_MS = 86_400_000
const dia = (iso: string) => iso.slice(0, 10)
const diasEntre = (a: string, b: string) => Math.round((Date.parse(`${dia(a)}T12:00:00Z`) - Date.parse(`${dia(b)}T12:00:00Z`)) / DIA_MS)
const redondear = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d
const num = (v: unknown) => Number(v ?? 0) || 0

function aplicacionDe(a: AplicacionInyeccion, l: AplicacionInyeccion['lineas'][number]): AplicacionDeFila {
  return {
    id: a.id,
    fecha: a.fecha ?? dia(a.fecha_hora),
    fecha_hora: a.fecha_hora,
    cantidad: num(l.cantidad),
    dosis_mz: l.dosis_mz ?? null,
    area_mz: num(a.area_mz),
    registrado_por: a.registrado_por,
    objetivos: l.objetivos && l.objetivos.length > 0 ? l.objetivos : a.objetivos,
  }
}

function completar(base: Omit<FilaCumplimiento, 'cantidad_real' | 'fecha_real' | 'ddt_real' | 'dias' | 'dif_cantidad' | 'dif_pct' | 'tiempo' | 'cantidad' | 'tags'>, hoy: string, sinPlan: boolean): FilaCumplimiento {
  const apps = [...base.aplicaciones].sort((x, y) => x.fecha_hora.localeCompare(y.fecha_hora))
  const real = redondear(apps.reduce((s, x) => s + x.cantidad, 0), 4)
  const fechaReal = apps[0]?.fecha ?? null
  const dias = fechaReal && base.fecha_plan ? diasEntre(fechaReal, base.fecha_plan) : null
  let tiempo: Tiempo
  if (sinPlan) tiempo = 'sin_plan'
  else if (apps.length === 0) tiempo = base.fecha_plan && base.fecha_plan < hoy ? 'vencido' : 'pendiente'
  else if (dias === null) tiempo = 'sin_fecha'
  else tiempo = Math.abs(dias) <= TOLERANCIA_DIAS ? 'a_tiempo' : dias > 0 ? 'tarde' : 'temprano'

  let cantidad: EstadoCantidad | null = null
  let dif: number | null = null
  let pct: number | null = null
  if (!sinPlan && apps.length > 0 && base.cantidad_plan > 0) {
    dif = redondear(real - base.cantidad_plan, 4)
    pct = redondear((dif / base.cantidad_plan) * 100, 1)
    cantidad = Math.abs(dif) <= base.cantidad_plan * TOLERANCIA_CANTIDAD ? 'exacto' : dif > 0 ? 'de_mas' : 'de_menos'
  }

  const tags: EtiquetaCumplimiento[] = []
  if (tiempo === 'a_tiempo' || tiempo === 'tarde' || tiempo === 'temprano') tags.push(tiempo)
  if (cantidad === 'de_mas' || cantidad === 'de_menos') tags.push(cantidad)
  if (tiempo === 'vencido' || tiempo === 'pendiente') tags.push('sin_aplicar')
  if (tiempo === 'sin_plan') tags.push('sin_plan')

  return {
    ...base,
    aplicaciones: apps,
    cantidad_real: real,
    fecha_real: fechaReal,
    ddt_real: dias !== null && base.ddt !== null ? base.ddt + dias : null,
    dias,
    dif_cantidad: dif,
    dif_pct: pct,
    tiempo,
    cantidad,
    tags,
  }
}

/**
 * `plan`: las líneas del plan de la estación (ya filtradas por estación y categorías activas, ver `planDeEstacion`).
 * `aplicaciones`: las de la estación (las anuladas se ignoran). `hoy`: AAAA-MM-DD en hora de Honduras.
 */
export function comparativaPlanReal(plan: FilaPlanInyeccion[], aplicaciones: AplicacionInyeccion[], hoy: string): FilaCumplimiento[] {
  const grupos = new Map<string, FilaPlanInyeccion[]>()
  for (const f of plan) {
    const k = marcaHecho(f.lote, f.ddt, f.material_id)
    grupos.set(k, [...(grupos.get(k) ?? []), f])
  }
  const aplicadas = new Map<string, AplicacionDeFila[]>()
  const sueltas: FilaCumplimiento[] = []
  for (const a of aplicaciones) {
    if (a.anulado_at) continue
    for (const l of a.lineas) {
      const k = l.ddt_plan !== null && l.ddt_plan !== undefined ? marcaHecho(a.lote, l.ddt_plan, l.material_id) : null
      if (k && grupos.has(k)) aplicadas.set(k, [...(aplicadas.get(k) ?? []), aplicacionDe(a, l)])
      else
        sueltas.push(
          completar(
            {
              clave: `sp-${a.id}-${l.material_id}`,
              lote: a.lote,
              ddt: l.ddt_plan ?? null,
              ciclo: a.ciclo,
              material_id: l.material_id,
              categoria_clave: null,
              fecha_plan: null,
              fecha_estimada: false,
              dosis_plan: null,
              area_plan: 0,
              cantidad_plan: 0,
              aplicaciones: [aplicacionDe(a, l)],
            },
            hoy,
            true
          )
        )
    }
  }
  const filas: FilaCumplimiento[] = []
  for (const [k, fs] of grupos) {
    const fechas = fs.map((f) => f.fecha_plan).filter((x): x is string => Boolean(x)).sort()
    const dosis = fs.map((f) => f.dosis_mz).find((d) => d !== null && d !== undefined) ?? null
    filas.push(
      completar(
        {
          clave: k,
          lote: fs[0].lote,
          ddt: fs[0].ddt,
          ciclo: fs[0].ciclo ?? null,
          material_id: fs[0].material_id,
          categoria_clave: fs[0].categoria_clave ?? null,
          fecha_plan: fechas[0] ?? null,
          fecha_estimada: fs.some((f) => f.fecha_estimada),
          dosis_plan: dosis,
          area_plan: redondear(fs.reduce((s, f) => s + num(f.area_mz), 0)),
          cantidad_plan: redondear(fs.reduce((s, f) => s + num(f.cantidad_plan), 0), 4),
          aplicaciones: aplicadas.get(k) ?? [],
        },
        hoy,
        false
      )
    )
  }
  return [...filas, ...sueltas].sort(
    (a, b) => (b.fecha_real ?? b.fecha_plan ?? '').localeCompare(a.fecha_real ?? a.fecha_plan ?? '') || a.lote.localeCompare(b.lote, 'es', { numeric: true })
  )
}

/** Índice «idAplicacion|material» → su fila de cumplimiento (para mostrar el estado de cada línea del historial). */
export function indicePorAplicacion(filas: FilaCumplimiento[]): Map<string, FilaCumplimiento> {
  const m = new Map<string, FilaCumplimiento>()
  for (const f of filas) for (const a of f.aplicaciones) m.set(`${a.id}|${f.material_id}`, f)
  return m
}

/** Texto corto de un estado de tiempo (con el número de días cuando lo hay). */
export function textoTiempo(f: Pick<FilaCumplimiento, 'tiempo' | 'dias'>): string {
  const d = Math.abs(f.dias ?? 0)
  switch (f.tiempo) {
    case 'a_tiempo':
      return 'A tiempo'
    case 'tarde':
      return `Tarde ${d} día${d === 1 ? '' : 's'}`
    case 'temprano':
      return `Temprano ${d} día${d === 1 ? '' : 's'}`
    case 'vencido':
      return 'Ya tocaba y no se aplicó'
    case 'pendiente':
      return 'Aún no toca'
    case 'sin_plan':
      return 'Sin plan'
    default:
      return 'Sin fecha de plan'
  }
}
