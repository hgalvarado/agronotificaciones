/**
 * Interoperabilidad por portapapeles con SAP, Excel y Outlook.
 *
 * SAP GUI, Excel y Google Sheets copian un rango como TSV: columnas
 * separadas por tabulador y filas por salto de línea (CRLF en Windows).
 * Excel además entrecomilla la celda que lleva tabulador, salto o
 * comillas dentro. Esto es puro —sin DOM ni React— para que cualquier
 * cuadrícula de captura, actual o futura, lo use igual.
 */

import type { ColumnaGrid } from './tipos'

/* ------------------------------------------------------------------ */
/* TSV                                                                 */
/* ------------------------------------------------------------------ */

/** Texto del portapapeles → matriz de celdas. Respeta las comillas de Excel. */
export function parsearTsv(texto: string): string[][] {
  const t = texto.replace(/\r\n?/g, '\n')
  const filas: string[][] = []
  let fila: string[] = []
  let celda = ''
  let entreComillas = false
  let inicioCelda = true

  for (let i = 0; i < t.length; i++) {
    const c = t[i]
    if (entreComillas) {
      if (c === '"') {
        if (t[i + 1] === '"') {
          celda += '"'
          i++
        } else {
          entreComillas = false
        }
      } else {
        celda += c
      }
      continue
    }
    if (c === '"' && inicioCelda) {
      entreComillas = true
      inicioCelda = false
      continue
    }
    if (c === '\t') {
      fila.push(celda)
      celda = ''
      inicioCelda = true
      continue
    }
    if (c === '\n') {
      fila.push(celda)
      filas.push(fila)
      fila = []
      celda = ''
      inicioCelda = true
      continue
    }
    celda += c
    inicioCelda = false
  }
  // Excel termina el rango con un salto: no es una fila vacía más.
  if (celda !== '' || fila.length > 0) {
    fila.push(celda)
    filas.push(fila)
  }
  return filas
}

/** Matriz → TSV que Excel y SAP pegan celda a celda. */
export function aTsv(matriz: (string | number | null | undefined)[][]): string {
  return matriz
    .map((fila) =>
      fila
        .map((v) => {
          const s = v === null || v === undefined ? '' : String(v)
          return /[\t\n\r"]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
        })
        .join('\t')
    )
    .join('\r\n')
}

/** ¿El texto es un rango (más de una celda) o un valor suelto? */
export function esRango(matriz: string[][]): boolean {
  return matriz.length > 1 || (matriz[0]?.length ?? 0) > 1
}

/* ------------------------------------------------------------------ */
/* Conversión de lo pegado al tipo de la columna                       */
/* ------------------------------------------------------------------ */

/**
 * «1.234,56» (SAP en español), «1,234.56» (inglés), «1234,5», «12 %»,
 * «L 1,500.00» → número. Null si no es un número.
 *
 * El separador decimal es el ÚLTIMO de los dos que aparezca; con uno
 * solo repetido (1.234.567) es de miles; con uno solo y tres cifras
 * detrás (1,234) se toma como miles, que es como lo copia SAP.
 */
export function numeroPegado(texto: string): number | null {
  let s = texto.trim().replace(/[^\d.,\-]/g, '')
  if (!s || !/\d/.test(s)) return null
  // SAP pone el signo detrás: «150,00-».
  const negativo = s.startsWith('-') || s.endsWith('-')
  s = s.replace(/-/g, '')
  const punto = s.lastIndexOf('.')
  const coma = s.lastIndexOf(',')
  if (punto >= 0 && coma >= 0) {
    const dec = punto > coma ? '.' : ','
    const miles = dec === '.' ? ',' : '.'
    s = s.split(miles).join('').replace(dec, '.')
  } else if (punto >= 0 || coma >= 0) {
    const sep = punto >= 0 ? '.' : ','
    const partes = s.split(sep)
    if (partes.length > 2 || (partes[1]?.length === 3 && partes[0] !== '0' && partes[0] !== '')) {
      s = partes.join('')
    } else {
      s = partes.join('.')
    }
  }
  const n = Number(s)
  if (!Number.isFinite(n)) return null
  return negativo ? -n : n
}

/** «27.10.2026» (SAP), «27/10/2026», «2026-10-27» → ISO. Null si no cuadra. */
export function fechaPegada(texto: string): string | null {
  const s = texto.trim()
  let a: number, m: number, d: number
  let r = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s)
  if (r) {
    a = +r[1]
    m = +r[2]
    d = +r[3]
  } else {
    r = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/.exec(s)
    if (!r) return null
    d = +r[1]
    m = +r[2]
    a = +r[3] < 100 ? 2000 + +r[3] : +r[3]
  }
  const f = new Date(Date.UTC(a, m - 1, d))
  if (f.getUTCFullYear() !== a || f.getUTCMonth() !== m - 1 || f.getUTCDate() !== d) return null
  return `${a}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

const plano = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase()

/**
 * Lo pegado, convertido a lo que guardaría la celda. `undefined` = no
 * se puede usar (texto en una columna numérica, opción que no existe):
 * esa celda se salta y se cuenta, no se guarda basura.
 */
export function valorPegado<T>(columna: ColumnaGrid<T>, texto: string): unknown {
  const s = texto.trim()
  if (s === '') return null
  switch (columna.editor) {
    case 'numero': {
      const n = numeroPegado(s)
      return n === null ? undefined : n
    }
    case 'fecha':
      return fechaPegada(s) ?? undefined
    case 'seleccion': {
      const ops = columna.opciones ?? []
      const p = plano(s)
      const o =
        ops.find((x) => x.value === s) ??
        ops.find((x) => plano(x.label) === p) ??
        // «T1001 - Arado» contra «T1001»: el código antes del guion.
        ops.find((x) => plano(x.label.split(' - ')[0] ?? '') === p)
      return o ? o.value : undefined
    }
    default:
      return s
  }
}

/** El valor que la celda tiene hoy, como texto de edición. */
export function valorActual<T>(columna: ColumnaGrid<T>, fila: T): string {
  if (columna.valorEdicion) return columna.valorEdicion(fila)
  const v = columna.valor(fila)
  return v === null || v === undefined ? '' : String(v)
}

/* ------------------------------------------------------------------ */
/* Reparto del pegado sobre la cuadrícula                              */
/* ------------------------------------------------------------------ */

export type CambioPegado<T> = { fila: T; columna: ColumnaGrid<T>; valor: unknown }

export type PlanPegado<T> = {
  cambios: CambioPegado<T>[]
  /** Celdas de sólo lectura o fuera de la tabla. */
  saltadas: number
  /** Celdas con un valor que la columna no admite. */
  invalidas: number
}

/**
 * Reparte la matriz desde la celda activa hacia la derecha y hacia abajo,
 * como Excel. Las columnas de sólo lectura NO desplazan lo pegado: si en
 * SAP se copiaron seis columnas, la tercera de la plataforma recibe la
 * tercera de SAP aunque la segunda no se pueda escribir.
 */
export function planearPegado<T>(
  matriz: string[][],
  filas: T[],
  columnas: ColumnaGrid<T>[],
  inicioFila: number,
  inicioColumna: number,
  sePuedeEditar: (fila: T, columna: ColumnaGrid<T>) => boolean
): PlanPegado<T> {
  const plan: PlanPegado<T> = { cambios: [], saltadas: 0, invalidas: 0 }
  matriz.forEach((valores, i) => {
    const fila = filas[inicioFila + i]
    valores.forEach((texto, j) => {
      const columna = columnas[inicioColumna + j]
      if (!fila || !columna || !sePuedeEditar(fila, columna)) {
        plan.saltadas++
        return
      }
      const valor = valorPegado(columna, texto)
      if (valor === undefined) {
        plan.invalidas++
        return
      }
      const actual = valorActual(columna, fila)
      if ((valor === null ? '' : String(valor)) === actual) return
      plan.cambios.push({ fila, columna, valor })
    })
  })
  return plan
}

/** Rango de celdas → matriz de texto tal como se lee en la tabla. */
export function matrizDeRango<T>(
  filas: T[],
  columnas: ColumnaGrid<T>[],
  texto: (fila: T, columna: ColumnaGrid<T>) => string
): string[][] {
  return filas.map((f) => columnas.map((c) => texto(f, c)))
}
