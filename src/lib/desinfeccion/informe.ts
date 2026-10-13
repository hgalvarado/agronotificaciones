/**
 * El informe ejecutivo de un lote: tipos y cuentas puras.
 *
 * Nada de React ni de Supabase. Lo que vive aquí lo usan **dos**
 * consumidores —la pantalla y el PDF— y ésa es la razón de que exista:
 * un informe que dice en el papel algo distinto de lo que dice en la
 * pantalla es peor que no tener informe, porque quien lo lleva a una
 * reunión no sabe cuál de los dos defender.
 */

/** Un químico aplicado, tal como lo arma la vista en su `jsonb`. */
export type ProductoInforme = {
  codigo: string | null
  nombre: string | null
  concentracion: string | null
  objetivos: string[] | null
  litros: number | null
  dosis_mz: number | null
  ppm: number | null
  costo: number | null
}

/**
 * Una fila de `v_desinfeccion_informe_ejecutivo`: un lote en un ciclo,
 * con su flujo entero.
 */
export type FilaInforme = {
  lote_temporada_id: string
  ciclo: number
  lote_nomenclatura: string
  lote_nombre: string | null
  zona_id: string | null
  zona_nombre: string | null
  temporada_id: string
  temporada_nombre: string | null

  /* Tiempos */
  fecha_siembra_plan: string | null
  fecha_aplicacion_plan: string | null
  fecha_preriego: string | null
  fecha_aplicacion: string | null
  fecha_siembra: string | null
  /** `real` = ya se sembró. `plan` = todavía es lo previsto. */
  origen_siembra: 'real' | 'plan' | null
  variedad: string | null
  ddt_preriego: number | null
  ddt_aplicacion: number | null
  ddt_plan: number | null

  /* Agronomía */
  mz_regadas: number | null
  mz_planificadas: number | null
  dosis_mz_plan: number | null
  dosis_mz_real: number | null
  caudal_agua: number | null
  horas_riego: number | null
  ppm_principal: number | null
  objetivos_control: string[] | null
  /** La vista lo agrega por ejecución, así que llega anidado. */
  productos: ProductoInforme[][] | null
  estado: string | null

  /* Finanzas */
  costo_quimico: number | null
  costo_personal: number | null
  costo_personal_preriego: number | null
  costo_personal_aplicacion: number | null
  costo_logistica: number | null
  costo_plan: number | null
  costo_total: number | null
  costo_mz: number | null
  delta_costo: number | null
  delta_costo_pct: number | null
  delta_dosis: number | null
  delta_dosis_pct: number | null
  fase_mas_cara: string | null
}

const n = (v: number | null | undefined): number => Number(v ?? 0)

/**
 * Los químicos de la fila, en una sola lista.
 *
 * La vista los agrupa por ejecución —un lote puede regarse en dos
 * turnos—, así que llegan anidados. Aquí se aplanan y se juntan los que
 * son el mismo producto: en el informe interesa cuánto se aplicó EN
 * TOTAL de cada químico, no en cuántas pasadas.
 */
export function productosDe(fila: FilaInforme): ProductoInforme[] {
  const planos = (fila.productos ?? []).flat().filter(Boolean)
  const porCodigo = new Map<string, ProductoInforme>()

  for (const p of planos) {
    const llave = p.codigo ?? p.nombre ?? '—'
    const antes = porCodigo.get(llave)
    if (!antes) {
      porCodigo.set(llave, { ...p, objetivos: [...(p.objetivos ?? [])] })
      continue
    }
    porCodigo.set(llave, {
      ...antes,
      litros: n(antes.litros) + n(p.litros),
      costo: n(antes.costo) + n(p.costo),
      dosis_mz: n(antes.dosis_mz) + n(p.dosis_mz),
      // Las ppm NO se suman: se queda la del que más litros llevó, que
      // es la que se discute. Una media de ppm no significa nada.
      ppm: n(antes.litros) >= n(p.litros) ? antes.ppm : p.ppm,
      objetivos: [...new Set([...(antes.objetivos ?? []), ...(p.objetivos ?? [])])].sort(),
    })
  }

  return [...porCodigo.values()].sort((a, b) => n(b.litros) - n(a.litros))
}

/* ------------------------------------------------------------------ */
/* Las desviaciones                                                     */
/* ------------------------------------------------------------------ */

/**
 * Cómo se lee una desviación.
 *
 * `null` cuando no hay plan contra el que comparar: eso **no es cero**.
 * Un cero diría «clavado», y lo que pasa es que no había plan.
 */
export type Tono = 'bien' | 'alerta' | 'malo' | 'neutro'

/**
 * El tono de una desviación de COSTO o de DOSIS.
 *
 * ── Por qué una banda y no un signo ─────────────────────────────────
 *
 * Pintar de rojo cualquier número por encima del plan haría que todo
 * saliera rojo: un turno nunca clava la dosis al decimal. Un informe
 * donde todo está en rojo no señala nada.
 *
 * La banda del ±5 % es «esto es ruido de campo». Fuera de ella, por
 * arriba, es gasto de más; por abajo, ahorro —o un lote al que le faltó
 * producto, que también hay que mirar, y por eso se marca en ámbar y no
 * en verde cuando se queda muy corto—.
 */
export function tonoDelta(pct: number | null | undefined): Tono {
  if (pct === null || pct === undefined || !Number.isFinite(pct)) return 'neutro'
  if (Math.abs(pct) <= 5) return 'bien'
  if (pct > 20) return 'malo'
  if (pct > 5) return 'alerta'
  // Muy por debajo del plan no es una buena noticia automática: puede
  // ser ahorro y puede ser que al lote le faltara producto.
  if (pct < -20) return 'alerta'
  return 'bien'
}

/**
 * El número con su signo delante, que es la mitad del dato.
 *
 * Se formatea con el MISMO separador de miles que el resto del sistema.
 * Escribía `+8000.00` mientras la pantalla decía `+8,000.00`, así que el
 * papel y el tablero discrepaban en la forma del mismo número: quien
 * lleva el informe a una reunión no tiene por qué explicar por qué.
 */
export function conSigno(v: number | null | undefined, decimales = 2): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—'
  const s = new Intl.NumberFormat('es-HN', {
    minimumFractionDigits: decimales,
    maximumFractionDigits: decimales,
  }).format(v)
  return v > 0 ? `+${s}` : s
}

/* ------------------------------------------------------------------ */
/* El cronograma                                                        */
/* ------------------------------------------------------------------ */

export type Hito = {
  clave: 'plan' | 'preriego' | 'aplicacion' | 'siembra'
  etiqueta: string
  fecha: string | null
  /** Días contra la siembra. Negativo = todavía falta para trasplantar. */
  ddt: number | null
  /** La siembra prevista se dibuja distinta de la ya capturada. */
  previsto: boolean
}

/**
 * Los cuatro hitos del lote, en orden de calendario.
 *
 * El orden lo da la FECHA y no el nombre: un preriego que se adelantó al
 * plan tiene que salir antes que el plan en la línea de tiempo, porque
 * la línea cuenta lo que pasó y no lo que se esperaba.
 *
 * Los hitos sin fecha se quedan fuera: una línea de tiempo con huecos
 * marcados «—» obliga a leer cuatro veces para descubrir que sólo hay
 * dos datos.
 */
export function hitosDe(fila: FilaInforme): Hito[] {
  const todos: Hito[] = [
    {
      clave: 'plan',
      etiqueta: 'Aplicación planificada',
      fecha: fila.fecha_aplicacion_plan,
      ddt: fila.ddt_plan,
      previsto: true,
    },
    {
      clave: 'preriego',
      etiqueta: 'Preriego',
      fecha: fila.fecha_preriego,
      ddt: fila.ddt_preriego,
      previsto: false,
    },
    {
      clave: 'aplicacion',
      etiqueta: 'Aplicación',
      fecha: fila.fecha_aplicacion,
      ddt: fila.ddt_aplicacion,
      previsto: false,
    },
    {
      clave: 'siembra',
      etiqueta: fila.origen_siembra === 'real' ? 'Siembra' : 'Siembra prevista',
      fecha: fila.fecha_siembra,
      ddt: 0,
      previsto: fila.origen_siembra !== 'real',
    },
  ]

  return todos
    .filter((h) => Boolean(h.fecha))
    .sort((a, b) => (a.fecha ?? '').localeCompare(b.fecha ?? ''))
}

/**
 * Cuántos días de retraso llevó la aplicación contra su plan.
 *
 * Positivo = se aplicó después de lo previsto. `null` si falta alguna de
 * las dos fechas: comparar contra un hueco da un número inventado.
 */
export function retrasoDias(fila: FilaInforme): number | null {
  if (!fila.fecha_aplicacion || !fila.fecha_aplicacion_plan) return null
  const a = Date.parse(`${fila.fecha_aplicacion}T12:00:00Z`)
  const b = Date.parse(`${fila.fecha_aplicacion_plan}T12:00:00Z`)
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null
  return Math.round((a - b) / 86_400_000)
}

/* ------------------------------------------------------------------ */
/* La radiografía financiera                                            */
/* ------------------------------------------------------------------ */

export type Pieza = { clave: 'quimico' | 'personal' | 'logistica'; etiqueta: string; valor: number }

/** Las tres piezas del costo, de mayor a menor. */
export function piezasDe(fila: FilaInforme): Pieza[] {
  return (
    [
      { clave: 'quimico', etiqueta: 'Químicos', valor: n(fila.costo_quimico) },
      { clave: 'personal', etiqueta: 'Mano de obra', valor: n(fila.costo_personal) },
      { clave: 'logistica', etiqueta: 'Acarreo', valor: n(fila.costo_logistica) },
    ] as Pieza[]
  )
    .filter((p) => p.valor > 0)
    .sort((a, b) => b.valor - a.valor)
}

/** Qué porcentaje del total es cada pieza. */
export function porcentajeDe(pieza: Pieza, piezas: Pieza[]): number {
  const total = piezas.reduce((a, p) => a + p.valor, 0)
  return total > 0 ? (pieza.valor * 100) / total : 0
}
