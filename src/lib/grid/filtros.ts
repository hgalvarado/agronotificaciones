/**
 * Orden y filtros de la cuadrícula estándar.
 *
 * Aritmética pura sobre listas: ni React ni base de datos. Genérico sobre
 * la fila, porque la regla —qué es «mayor», qué cae dentro de un rango,
 * qué valores ofrece una columna— es la misma para una siembra, un
 * horómetro y una labor. Lo único que cambia es de dónde se saca el valor,
 * y eso lo dice la columna.
 */

import { VACIO, type ColumnaGrid, type Filtro, type Filtros, type Orden } from './tipos'

/* ------------------------------------------------------------------ */
/* Lo que hay en una celda                                             */
/* ------------------------------------------------------------------ */

function crudo<T>(fila: T, col: ColumnaGrid<T>): string | number | null {
  const v = col.valor(fila)
  if (v === null || v === undefined || v === '') return null
  return v
}

/** El texto que se lee: la etiqueta de la columna, o el valor crudo. */
export function textoDe<T>(fila: T, col: ColumnaGrid<T>): string {
  if (col.etiqueta) return col.etiqueta(fila)
  const v = crudo(fila, col)
  return v === null ? '' : String(v)
}

/* ------------------------------------------------------------------ */
/* Estado de un filtro                                                 */
/* ------------------------------------------------------------------ */

export function filtroVacio(tipo: ColumnaGrid<unknown>['tipo']): Filtro {
  switch (tipo) {
    case 'texto':
      return { tipo: 'texto', texto: '' }
    case 'fecha':
      return { tipo: 'fecha', desde: '', hasta: '' }
    case 'numero':
      return { tipo: 'numero', min: '', max: '' }
    default:
      return { tipo: 'seleccion', valores: [] }
  }
}

/** Un filtro que no recorta nada es lo mismo que no tener filtro. */
export function estaActivo(f: Filtro | undefined): boolean {
  if (!f) return false
  switch (f.tipo) {
    case 'seleccion':
      return f.valores.length > 0
    case 'texto':
      return f.texto.trim() !== ''
    case 'fecha':
      return f.desde !== '' || f.hasta !== ''
    case 'numero':
      return f.min.trim() !== '' || f.max.trim() !== ''
  }
}

/** Lo que se enseña bajo el encabezado para no tener que abrir el panel. */
export function resumenFiltro(f: Filtro | undefined): string | null {
  if (!estaActivo(f) || !f) return null
  switch (f.tipo) {
    case 'seleccion':
      return f.valores.length === 1 ? f.valores[0] : `${f.valores.length} valores`
    case 'texto':
      return `«${f.texto.trim()}»`
    case 'fecha':
      if (f.desde && f.hasta) return `${f.desde} → ${f.hasta}`
      return f.desde ? `desde ${f.desde}` : `hasta ${f.hasta}`
    case 'numero':
      if (f.min && f.max) return `${f.min} – ${f.max}`
      return f.min ? `≥ ${f.min}` : `≤ ${f.max}`
  }
}

export function contarFiltros(filtros: Filtros): number {
  return Object.values(filtros).filter(estaActivo).length
}

function numero(bruto: string): number | null {
  const t = bruto.trim().replace(/,/g, '')
  if (!t) return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

/* ------------------------------------------------------------------ */
/* Filtrar                                                             */
/* ------------------------------------------------------------------ */

/** ¿Esta fila pasa este filtro de esta columna? */
export function pasa<T>(fila: T, col: ColumnaGrid<T>, f: Filtro): boolean {
  if (!estaActivo(f)) return true

  switch (f.tipo) {
    case 'seleccion': {
      const v = crudo(fila, col)
      return f.valores.includes(v === null && !col.etiqueta ? VACIO : textoDe(fila, col) || VACIO)
    }

    case 'texto': {
      const t = textoDe(fila, col)
      if (!t) return false
      return t.toLowerCase().includes(f.texto.trim().toLowerCase())
    }

    case 'fecha': {
      const v = crudo(fila, col)
      if (v === null) return false
      // Las fechas vienen en ISO, y en ISO comparar como texto es
      // comparar como fecha. No hace falta construir un Date por celda.
      const iso = String(v).slice(0, 10)
      if (f.desde && iso < f.desde) return false
      if (f.hasta && iso > f.hasta) return false
      return true
    }

    case 'numero': {
      const v = crudo(fila, col)
      if (v === null) return false
      const n = Number(v)
      if (!Number.isFinite(n)) return false
      const min = numero(f.min)
      const max = numero(f.max)
      if (min !== null && n < min) return false
      if (max !== null && n > max) return false
      return true
    }
  }
}

export function filtrar<T>(
  filas: T[],
  columnas: ColumnaGrid<T>[],
  filtros: Filtros
): T[] {
  const activos = columnas
    .map((c) => [c, filtros[c.campo]] as const)
    .filter((par): par is [ColumnaGrid<T>, Filtro] => estaActivo(par[1]))

  if (activos.length === 0) return filas
  return filas.filter((fila) => activos.every(([col, f]) => pasa(fila, col, f)))
}

/**
 * Los valores que ofrece la lista de casillas de una columna.
 *
 * Se calculan sobre las filas que pasan TODOS LOS DEMÁS filtros, menos el
 * de esta columna. Es como se comporta el autofiltro de Excel y es lo
 * correcto: filtrada la zona NORTE, la lista de lotes debe enseñar los
 * lotes del norte —ofrecer los demás es ofrecer un filtro que devuelve
 * cero filas— pero la propia lista no puede encogerse con cada casilla
 * que se marca, o sería imposible marcar la segunda.
 */
export function opcionesDe<T>(
  filas: T[],
  columnas: ColumnaGrid<T>[],
  filtros: Filtros,
  campo: string
): string[] {
  const col = columnas.find((c) => c.campo === campo)
  if (!col) return []

  const otros: Filtros = { ...filtros }
  delete otros[campo]

  const set = new Set<string>()
  for (const f of filtrar(filas, columnas, otros)) set.add(textoDe(f, col) || VACIO)

  // El vacío siempre al final: es una categoría de servicio, no un valor.
  return [...set].sort((a, b) => {
    if (a === VACIO) return 1
    if (b === VACIO) return -1
    return a.localeCompare(b, 'es', { numeric: true })
  })
}

/* ------------------------------------------------------------------ */
/* Ordenar                                                             */
/* ------------------------------------------------------------------ */

/**
 * Ordena sin tocar la lista original.
 *
 * Los nulos van siempre al final, suba o baje el orden: una celda vacía
 * no es «la más pequeña», es «no se sabe», y dejarla arriba al ordenar
 * descendente esconde justo las filas que interesan.
 */
export function ordenar<T>(filas: T[], columnas: ColumnaGrid<T>[], orden: Orden | null): T[] {
  if (!orden) return filas
  const col = columnas.find((c) => c.campo === orden.campo)
  if (!col) return filas

  const dir = orden.direccion === 'asc' ? 1 : -1
  return [...filas].sort((a, b) => {
    const va = crudo(a, col)
    const vb = crudo(b, col)
    if (va === null && vb === null) return 0
    if (va === null) return 1
    if (vb === null) return -1
    if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir
    return String(va).localeCompare(String(vb), 'es', { numeric: true }) * dir
  })
}

/** Filtrar y ordenar, en ese orden. */
export function prepararFilas<T>(
  filas: T[],
  columnas: ColumnaGrid<T>[],
  filtros: Filtros,
  orden: Orden | null
): T[] {
  return ordenar(filtrar(filas, columnas, filtros), columnas, orden)
}

/** Busca en todas las columnas a la vez, para la caja de arriba. */
export function buscar<T>(filas: T[], columnas: ColumnaGrid<T>[], texto: string): T[] {
  const q = texto.trim().toLowerCase()
  if (!q) return filas
  return filas.filter((f) => columnas.some((c) => textoDe(f, c).toLowerCase().includes(q)))
}
