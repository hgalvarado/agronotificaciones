/**
 * Devolución a bodega (Campo, bloque 1): salida del inventario de la estación hacia suministros, bodega o taller.
 * Pura: ni React, ni IndexedDB, ni red. La base (`_fert_op_devolucion_bodega`) vuelve a validar todo.
 */

export type DestinoDevolucion = 'SUMINISTROS' | 'BODEGA' | 'TALLER'

export const DESTINOS_DEVOLUCION: { id: DestinoDevolucion; nombre: string }[] = [
  { id: 'SUMINISTROS', nombre: 'Suministros' },
  { id: 'BODEGA', nombre: 'Bodega' },
  { id: 'TALLER', nombre: 'Taller' },
]

export const SIN_PRODUCTOS_DEVOLUCION = 'Indica al menos un producto'

/**
 * Arma los `datos` de la operación `devolucion_bodega`. Las líneas con cantidad 0 (o negativa/no numérica) se
 * descartan como líneas vacías; si no queda ninguna, error.
 */
export function armarDevolucionBodega(args: {
  estacionId: string
  destino: DestinoDevolucion
  motivo: string
  lineas: { material_id: string; cantidad: number }[]
  fechaHora: string
}): { datos: Record<string, unknown> } | { error: string } {
  if (!DESTINOS_DEVOLUCION.some((d) => d.id === args.destino)) return { error: 'Elige a dónde se devuelve (Suministros, Bodega o Taller).' }
  const motivo = (args.motivo ?? '').trim()
  if (!motivo) return { error: 'Escribe el motivo de la devolución.' }
  const lineas = (args.lineas ?? []).filter((l) => l.material_id && Number.isFinite(Number(l.cantidad)) && Number(l.cantidad) > 0)
  if (lineas.length === 0) return { error: SIN_PRODUCTOS_DEVOLUCION }
  return {
    datos: {
      estacion_id: args.estacionId,
      fecha_hora: args.fechaHora,
      destino: args.destino,
      motivo,
      lineas: lineas.map((l) => ({ material_id: l.material_id, cantidad: Number(l.cantidad) })),
    },
  }
}

/** Primer producto cuya cantidad supera el saldo disponible (para avisar antes de enviar), o null. */
export function primerExceso(
  lineas: { material_id: string; cantidad: number }[],
  saldos: Map<string, number>
): { material_id: string; disponible: number } | null {
  for (const l of lineas) {
    const disponible = saldos.get(l.material_id) ?? 0
    if (l.cantidad > disponible) return { material_id: l.material_id, disponible }
  }
  return null
}

/** Tipos de documento que el detalle ofrece anular (relevo y traslado tienen su propio camino). */
export const TIPOS_ANULABLES = ['recepcion', 'aplicacion', 'conteo', 'devolucion', 'devolucion_bodega', 'aplicacion_lote']

export function esDocumentoAnulable(tipo: string): boolean {
  return TIPOS_ANULABLES.includes(tipo)
}
