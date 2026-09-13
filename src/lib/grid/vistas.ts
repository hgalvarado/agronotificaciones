/**
 * Vistas de tabla: qué columnas se ven y en qué orden.
 *
 * Puro. La persistencia está en `repositorioVistas` y el selector en
 * `GestorVistas`; aquí sólo vive la regla de cómo se combina lo guardado
 * con lo que el código ofrece hoy.
 */

import type { ColumnaGrid } from './tipos'

/** Una columna dentro de una vista: su sitio en la lista es su orden. */
export type ColumnaVista = { campo: string; visible: boolean }

export type VistaTabla = {
  id: string
  pantalla: string
  nombre: string
  es_estandar: boolean
  usuario_id: string | null
  columnas: ColumnaVista[]
}

/** La vista de fábrica: todas las columnas, en el orden del código. */
export function vistaDeFabrica<T>(columnas: ColumnaGrid<T>[]): ColumnaVista[] {
  return columnas.map((c) => ({ campo: c.campo, visible: true }))
}

/**
 * Combina lo guardado con lo que el código ofrece HOY.
 *
 * Dos casos que hay que resolver y que no son simétricos:
 *
 *   · Una columna guardada que ya no existe en el código se descarta. Si
 *     no, la tabla intentaría dibujar una columna fantasma.
 *   · Una columna nueva del código que la vista no conoce se AÑADE AL
 *     FINAL y visible. Esconderla sería que una función nueva no llegara
 *     nunca a quien ya se guardó su vista; meterla en medio movería las
 *     columnas de sitio sin que nadie lo haya pedido.
 */
export function fusionar<T>(columnas: ColumnaGrid<T>[], vista: ColumnaVista[]): ColumnaVista[] {
  const existen = new Set(columnas.map((c) => c.campo))
  const guardadas = vista.filter((v) => existen.has(v.campo))
  const conocidas = new Set(guardadas.map((v) => v.campo))
  const nuevas = columnas
    .filter((c) => !conocidas.has(c.campo))
    .map((c) => ({ campo: c.campo, visible: true }))
  return [...guardadas, ...nuevas]
}

/** Las columnas que la tabla va a dibujar, ya ordenadas y filtradas. */
export function aplicarVista<T>(
  columnas: ColumnaGrid<T>[],
  vista: ColumnaVista[] | null
): ColumnaGrid<T>[] {
  if (!vista || vista.length === 0) return columnas
  const porCampo = new Map(columnas.map((c) => [c.campo, c]))
  return fusionar(columnas, vista)
    .filter((v) => v.visible)
    .map((v) => porCampo.get(v.campo))
    .filter((c): c is ColumnaGrid<T> => c !== undefined)
}

/** Sube o baja una columna dentro de la vista, sin salirse de la lista. */
export function mover(vista: ColumnaVista[], campo: string, pasos: number): ColumnaVista[] {
  const i = vista.findIndex((v) => v.campo === campo)
  if (i < 0) return vista
  const destino = Math.min(Math.max(i + pasos, 0), vista.length - 1)
  if (destino === i) return vista
  const copia = [...vista]
  const [sacada] = copia.splice(i, 1)
  copia.splice(destino, 0, sacada)
  return copia
}

export function alternarVisible(vista: ColumnaVista[], campo: string): ColumnaVista[] {
  return vista.map((v) => (v.campo === campo ? { ...v, visible: !v.visible } : v))
}

/** ¿La vista de trabajo se apartó de la que está guardada? */
export function hayCambios(actual: ColumnaVista[], guardada: ColumnaVista[] | null): boolean {
  if (!guardada) return false
  if (actual.length !== guardada.length) return true
  return actual.some(
    (v, i) => v.campo !== guardada[i].campo || v.visible !== guardada[i].visible
  )
}

export function contarVisibles(vista: ColumnaVista[]): number {
  return vista.filter((v) => v.visible).length
}
