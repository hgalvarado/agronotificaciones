/**
 * Qué columnas lleva cada hoja SAP y en qué orden, por preferencia del
 * navegador. Puro salvo `leer`/`guardar`, que tocan `localStorage` dentro
 * de try/catch: sin almacenamiento (modo privado) se exporta completo.
 *
 * La configuración se guarda por NOMBRE de columna, no por índice: si
 * mañana `exportacion.ts` añade una columna, la nueva aparece activa al
 * final en vez de desplazar a todas las demás.
 */

import type { CeldaHoja } from '@/lib/hojas'

export type ColumnaConfig = { nombre: string; activa: boolean }
export type ConfigHoja = ColumnaConfig[]
export type ConfigSap = Record<string, ConfigHoja>

const PREFIJO = 'agn.sap.columnas.'

/** Concilia lo guardado con las columnas que existen hoy. */
export function conciliar(guardada: ConfigHoja | null | undefined, actuales: readonly string[]): ConfigHoja {
  const existen = new Set(actuales)
  const vistas = new Set<string>()
  const out: ConfigHoja = []
  for (const c of guardada ?? []) {
    if (existen.has(c.nombre) && !vistas.has(c.nombre)) {
      out.push({ nombre: c.nombre, activa: c.activa !== false })
      vistas.add(c.nombre)
    }
  }
  for (const n of actuales) if (!vistas.has(n)) out.push({ nombre: n, activa: true })
  return out
}

/**
 * Recorta y reordena una matriz cuya primera fila es el encabezado.
 * Si la configuración apagara todo, se exporta completo: un archivo sin
 * columnas no le sirve a nadie y SAP lo rechaza igual.
 */
export function aplicarConfig(filas: CeldaHoja[][], config: ConfigHoja | null | undefined): CeldaHoja[][] {
  if (filas.length === 0 || !config) return filas
  const encabezado = filas[0].map((c) => String(c ?? ''))
  const indices = config
    .filter((c) => c.activa)
    .map((c) => encabezado.indexOf(c.nombre))
    .filter((i) => i >= 0)
  if (indices.length === 0) return filas
  return filas.map((f) => indices.map((i) => f[i]))
}

export function mover(config: ConfigHoja, desde: number, hacia: number): ConfigHoja {
  if (hacia < 0 || hacia >= config.length || desde === hacia) return config
  const copia = [...config]
  const [x] = copia.splice(desde, 1)
  copia.splice(hacia, 0, x)
  return copia
}

export function leerConfig(clave: string): ConfigSap {
  try {
    const crudo = globalThis.localStorage?.getItem(PREFIJO + clave)
    const v = crudo ? JSON.parse(crudo) : null
    return v && typeof v === 'object' ? (v as ConfigSap) : {}
  } catch {
    return {}
  }
}

export function guardarConfig(clave: string, config: ConfigSap): void {
  try {
    globalThis.localStorage?.setItem(PREFIJO + clave, JSON.stringify(config))
  } catch {
    // Sin almacenamiento la preferencia dura lo que la pestaña.
  }
}
