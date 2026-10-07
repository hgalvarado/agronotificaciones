/**
 * Los totales del pie de la cuadrícula.
 *
 * «Al final de la columna "H. NOTIFICADAS" deberías poder hacer clic,
 *  elegir "Suma", y ver el cálculo actualizarse si aplicas un filtro por
 *  un equipo o lote.»
 *
 * Dos decisiones que no son de adorno:
 *
 *   · Se calcula sobre lo que SE VE —las filas que pasaron los filtros y
 *     la búsqueda—, no sobre lo que trajo la consulta. Un total que no
 *     reacciona al filtro contesta a una pregunta que nadie hizo, y es
 *     peor que no tener total: parece que sí.
 *
 *   · La columna no declara qué agregación lleva. La elige quien mira, y
 *     cada quien mira una cosa distinta: el de campo quiere la SUMA de
 *     manzanas, el de taller el MÁXIMO de horas. Por eso no hay un
 *     `agregacion: 'suma'` en la definición de la columna; hay un menú.
 *
 * Puro: recibe filas y devuelve números. Sin React, sin DOM.
 */

import type { ColumnaGrid } from './tipos'

export type TipoAgregacion = 'ninguna' | 'suma' | 'promedio' | 'minimo' | 'maximo' | 'contar'

export const AGREGACIONES: { valor: TipoAgregacion; nombre: string; detalle: string }[] = [
  { valor: 'ninguna', nombre: 'Ninguno', detalle: 'El pie de esta columna se queda vacío.' },
  { valor: 'suma', nombre: 'Suma', detalle: 'Todo lo que hay en la columna, sumado.' },
  { valor: 'promedio', nombre: 'Promedio', detalle: 'La media de las filas que traen dato.' },
  { valor: 'minimo', nombre: 'Mínimo', detalle: 'El valor más bajo.' },
  { valor: 'maximo', nombre: 'Máximo', detalle: 'El valor más alto.' },
  { valor: 'contar', nombre: 'Contar', detalle: 'Cuántas filas traen dato en esta columna.' },
]

/** Qué agregaciones ofrece una columna según lo que la columna ES. */
export function agregacionesDe<T>(columna: ColumnaGrid<T>): TipoAgregacion[] {
  // En una columna de texto, sumar no quiere decir nada; contar sí
  // —«¿en cuántas filas hay operador anotado?»— y es justo lo que se
  // pregunta cuando se mira una columna que viene a medias.
  if (!columna.numero) return ['ninguna', 'contar']
  return ['ninguna', 'suma', 'promedio', 'minimo', 'maximo', 'contar']
}

/** El número de una celda, o `null` si ahí no hay número. */
function numeroDe<T>(fila: T, columna: ColumnaGrid<T>): number | null {
  const v = columna.valor(fila)
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

/** ¿Esta celda trae dato? Para `contar`, que también vale en texto. */
function tieneDato<T>(fila: T, columna: ColumnaGrid<T>): boolean {
  const v = columna.valor(fila)
  return v !== null && v !== undefined && v !== ''
}

export type Resultado = { valor: number; decimales: boolean } | null

/**
 * El total de una columna sobre las filas dadas.
 *
 * Devuelve `null` cuando no hay nada que decir —sin agregación, o sin una
 * sola fila con dato—. Un «0» ahí sería mentira: no es que la suma dé
 * cero, es que no hay nada que sumar.
 */
export function calcular<T>(
  filas: T[],
  columna: ColumnaGrid<T>,
  tipo: TipoAgregacion
): Resultado {
  if (tipo === 'ninguna') return null

  if (tipo === 'contar') {
    return { valor: filas.reduce((n, f) => n + (tieneDato(f, columna) ? 1 : 0), 0), decimales: false }
  }

  const numeros: number[] = []
  for (const f of filas) {
    const n = numeroDe(f, columna)
    if (n !== null) numeros.push(n)
  }
  if (numeros.length === 0) return null

  switch (tipo) {
    case 'suma':
      return { valor: numeros.reduce((a, b) => a + b, 0), decimales: true }
    case 'promedio':
      return { valor: numeros.reduce((a, b) => a + b, 0) / numeros.length, decimales: true }
    case 'minimo':
      return { valor: Math.min(...numeros), decimales: true }
    case 'maximo':
      return { valor: Math.max(...numeros), decimales: true }
    default:
      return null
  }
}

/**
 * Cómo se lee el número.
 *
 * Se enseñan hasta dos decimales y se quitan los que no hacen falta: una
 * suma de horas que da 40 se lee «40», no «40.00», y 40.5 se lee «40.5».
 * El separador de miles entra porque estas columnas llegan a cientos de
 * miles de plántulas y sin él no se distingue 52500 de 525000.
 */
export function formatearTotal(r: Resultado): string {
  if (r === null) return ''
  if (!r.decimales) return r.valor.toLocaleString('es-HN')
  return r.valor.toLocaleString('es-HN', { maximumFractionDigits: 2 })
}

export type Agregaciones = Record<string, TipoAgregacion>

/* ------------------------------------------------------------------ */
/* Memoria                                                             */
/* ------------------------------------------------------------------ */

/**
 * Lo elegido se recuerda, por tabla y por columna.
 *
 * Quien abre Labores todas las mañanas para ver la suma de horas no
 * tiene por qué volver a elegirla cada vez. Va en `localStorage` y no en
 * la base porque es una preferencia de quien mira, no un dato de la
 * empresa: si se guardara en la base, cambiarla se la cambiaría a todos.
 *
 * Todo va en try/catch: en una ventana privada o con las cookies
 * bloqueadas `localStorage` LANZA al tocarlo, y una preferencia de
 * presentación no puede tumbar la tabla.
 */
function llave(tabla: string): string {
  return `agro.agregaciones.${tabla}`
}

export function leerAgregaciones(tabla: string): Agregaciones {
  try {
    const crudo = localStorage.getItem(llave(tabla))
    if (!crudo) return {}
    const datos = JSON.parse(crudo) as unknown
    if (typeof datos !== 'object' || datos === null) return {}

    // Se filtra lo que no reconozcamos: un valor viejo o manipulado no
    // puede meter una agregación que `calcular` no sepa resolver.
    const validas = new Set(AGREGACIONES.map((a) => a.valor))
    const salida: Agregaciones = {}
    for (const [campo, tipo] of Object.entries(datos as Record<string, unknown>)) {
      if (typeof tipo === 'string' && validas.has(tipo as TipoAgregacion)) {
        salida[campo] = tipo as TipoAgregacion
      }
    }
    return salida
  } catch {
    return {}
  }
}

export function guardarAgregaciones(tabla: string, valor: Agregaciones): void {
  try {
    // Las columnas en «Ninguno» no se guardan: es el valor por omisión y
    // guardarlo sólo engorda el registro.
    const limpio: Agregaciones = {}
    for (const [campo, tipo] of Object.entries(valor)) {
      if (tipo !== 'ninguna') limpio[campo] = tipo
    }
    if (Object.keys(limpio).length === 0) localStorage.removeItem(llave(tabla))
    else localStorage.setItem(llave(tabla), JSON.stringify(limpio))
  } catch {
    // Sin memoria se sigue pudiendo elegir; sólo no se recuerda.
  }
}
