/**
 * Reglas del trasplante que no son consulta ni pantalla.
 *
 * Casi todo el cuadre lo hace la base —las cinco funciones de la
 * migración 26— porque es la misma idea repetida y en JavaScript serían
 * cinco sitios donde dejar de coincidir. Aquí queda lo que la base no
 * debe decidir: cómo se agrupa para mirarlo y qué totales generales se
 * enseñan.
 */

import type {
  FilaAvanceUt,
  FilaEstadistica,
  FilaSemana,
  FilaSiembra,
  FilaVariedad,
  FilaZona,
} from './tipos'

/** El total general: la suma de todos los ciclos. */
export function totalGeneral(filas: FilaEstadistica[]): FilaEstadistica {
  const suma = (f: (x: FilaEstadistica) => number) => filas.reduce((a, x) => a + f(x), 0)
  const plan = suma((x) => Number(x.area_plan))
  const real = suma((x) => Number(x.area_real))
  const plantas = suma((x) => Number(x.plantas))
  return {
    ciclo: 0,
    area_plan: plan,
    area_real: real,
    pendiente: Math.max(plan - real, 0),
    pct: plan > 0 ? Math.round((real / plan) * 1000) / 10 : null,
    plantas,
    plantas_mz: real > 0 ? Math.round((plantas / real) * 100) / 100 : null,
    // Los lotes NO se suman entre ciclos: el mismo lote puede sembrarse
    // en dos ciclos y se contaría dos veces.
    lotes: Math.max(...filas.map((f) => Number(f.lotes)), 0),
  }
}

/** Avance por UT agrupado por zona y, dentro, por lote. */
export function agruparAvancePorZona(filas: FilaAvanceUt[]) {
  const zonas = new Map<string, Map<string, FilaAvanceUt[]>>()
  for (const f of filas) {
    const zona = f.zona ?? '(sin zona)'
    const lotes = zonas.get(zona) ?? new Map<string, FilaAvanceUt[]>()
    lotes.set(f.ut, [...(lotes.get(f.ut) ?? []), f])
    zonas.set(zona, lotes)
  }
  return [...zonas.entries()]
    .sort((a, b) => a[0].localeCompare(b[0], 'es', { numeric: true }))
    .map(([zona, lotes]) => ({
      zona,
      encargado: filas.find((f) => (f.zona ?? '(sin zona)') === zona)?.encargado ?? null,
      lotes: [...lotes.entries()].sort((a, b) => a[0].localeCompare(b[0], 'es', { numeric: true })),
    }))
}

/** Siembras agrupadas por día, para los subtotales del reporte. */
export function agruparPorFecha(filas: FilaSiembra[]) {
  const mapa = new Map<string, FilaSiembra[]>()
  for (const f of filas) mapa.set(f.fecha_siembra, [...(mapa.get(f.fecha_siembra) ?? []), f])
  return [...mapa.entries()].sort((a, b) => b[0].localeCompare(a[0]))
}

/** Las zonas del cuadre, con una fila por zona y sus ciclos dentro. */
export function agruparZonas(filas: FilaZona[]) {
  const mapa = new Map<string, FilaZona[]>()
  for (const f of filas) mapa.set(f.zona, [...(mapa.get(f.zona) ?? []), f])
  return [...mapa.entries()].sort((a, b) => a[0].localeCompare(b[0], 'es', { numeric: true }))
}

export type PuntoSemana = {
  semana: string
  /** Manzanas previstas para esa semana según el plan. */
  plan: number
  /** Manzanas efectivamente sembradas. */
  area: number
  /** Real menos plan: negativo es atraso. */
  brecha: number
  plantas: number
  acumulado: number
  acumuladoPlan: number
}

const dos = (v: number) => Math.round(v * 100) / 100

/**
 * Las semanas, sumadas entre ciclos y con sus acumulados recalculados.
 *
 * La función de la base devuelve una fila por semana Y ciclo, que es lo
 * que necesita la tabla; el gráfico quiere una línea por semana. Los
 * acumulados se rehacen aquí en vez de sumar los de la base, que están
 * partidos por ciclo y sumarlos daría cualquier cosa.
 *
 * La brecha se calcula, no se guarda: es lo que gerencia lee primero y
 * tenerla en dos sitios es tenerla mal en uno de los dos.
 */
export function semanasParaGrafico(filas: FilaSemana[]): PuntoSemana[] {
  const mapa = new Map<string, { semana: string; plan: number; area: number; plantas: number }>()
  for (const f of filas) {
    const x = mapa.get(f.semana) ?? { semana: f.semana, plan: 0, area: 0, plantas: 0 }
    x.plan += Number(f.area_plan ?? 0)
    x.area += Number(f.area_real)
    x.plantas += Number(f.plantas)
    mapa.set(f.semana, x)
  }

  let acumulado = 0
  let acumuladoPlan = 0
  return [...mapa.values()]
    .sort((a, b) => a.semana.localeCompare(b.semana))
    .map((x) => {
      acumulado += x.area
      acumuladoPlan += x.plan
      return {
        semana: x.semana,
        plan: dos(x.plan),
        area: dos(x.area),
        brecha: dos(x.area - x.plan),
        plantas: x.plantas,
        acumulado: dos(acumulado),
        acumuladoPlan: dos(acumuladoPlan),
      }
    })
}

/* ------------------------------------------------------------------ */
/* Cumplimiento por variedad, con su total entre ciclos                */
/* ------------------------------------------------------------------ */

export type CeldaCiclo = { area_plan: number; area_real: number; pct: number | null }

export type ResumenVariedad = {
  variedad: string
  cultivo: string | null
  /** Una entrada por ciclo con datos; las demás no existen. */
  porCiclo: Map<number, CeldaCiclo>
  /** Ciclo 1 + Ciclo 2 + … de esa variedad. */
  total: CeldaCiclo
}

function porcentaje(plan: number, real: number): number | null {
  return plan > 0 ? Math.round((real / plan) * 1000) / 10 : null
}

/**
 * Reorganiza el cumplimiento por variedad para leerlo de un vistazo.
 *
 * La función de la base devuelve una fila por variedad Y ciclo, que es
 * como se calcula; gerencia lee por VARIEDAD, y el número que busca
 * primero es el total de la variedad entre todos sus ciclos. Poner esa
 * suma en una tabla plana obligaba a sumar mentalmente dos filas
 * separadas por diez.
 *
 * Los ciclos que devuelve son sólo los que tienen algo —plan vigente a la
 * fecha o siembra hecha—: una columna «Ciclo 2» llena de ceros en
 * septiembre no informa de nada y hace creer que se va atrasado.
 */
export function resumirVariedades(filas: FilaVariedad[]): {
  ciclos: number[]
  variedades: ResumenVariedad[]
  total: CeldaCiclo
  totalPorCiclo: Map<number, CeldaCiclo>
  planSinFecha: number
} {
  const conDatos = (f: FilaVariedad) => Number(f.area_plan) > 0 || Number(f.area_real) > 0

  const ciclos = [...new Set(filas.filter(conDatos).map((f) => Number(f.ciclo)))].sort(
    (a, b) => a - b
  )

  const mapa = new Map<string, ResumenVariedad>()
  const totalPorCiclo = new Map<number, CeldaCiclo>()
  const total: CeldaCiclo = { area_plan: 0, area_real: 0, pct: null }
  let planSinFecha = 0

  for (const f of filas) {
    planSinFecha += Number(f.plan_sin_fecha ?? 0)
    if (!conDatos(f)) continue

    const ciclo = Number(f.ciclo)
    const plan = Number(f.area_plan)
    const real = Number(f.area_real)

    const v = mapa.get(f.variedad) ?? {
      variedad: f.variedad,
      cultivo: f.cultivo,
      porCiclo: new Map<number, CeldaCiclo>(),
      total: { area_plan: 0, area_real: 0, pct: null },
    }
    const celda = v.porCiclo.get(ciclo) ?? { area_plan: 0, area_real: 0, pct: null }
    celda.area_plan += plan
    celda.area_real += real
    celda.pct = porcentaje(celda.area_plan, celda.area_real)
    v.porCiclo.set(ciclo, celda)

    v.total.area_plan += plan
    v.total.area_real += real
    v.total.pct = porcentaje(v.total.area_plan, v.total.area_real)
    mapa.set(f.variedad, v)

    const pie = totalPorCiclo.get(ciclo) ?? { area_plan: 0, area_real: 0, pct: null }
    pie.area_plan += plan
    pie.area_real += real
    pie.pct = porcentaje(pie.area_plan, pie.area_real)
    totalPorCiclo.set(ciclo, pie)

    total.area_plan += plan
    total.area_real += real
  }
  total.pct = porcentaje(total.area_plan, total.area_real)

  const redondear = (c: CeldaCiclo) => {
    c.area_plan = Math.round(c.area_plan * 100) / 100
    c.area_real = Math.round(c.area_real * 100) / 100
  }
  for (const v of mapa.values()) {
    v.porCiclo.forEach(redondear)
    redondear(v.total)
  }
  totalPorCiclo.forEach(redondear)
  redondear(total)

  return {
    ciclos,
    variedades: [...mapa.values()].sort((a, b) => a.variedad.localeCompare(b.variedad, 'es')),
    total,
    totalPorCiclo,
    planSinFecha: Math.round(planSinFecha * 100) / 100,
  }
}
