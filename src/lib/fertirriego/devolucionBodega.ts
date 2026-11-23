/**
 * Devolución a bodega (Campo, bloque 1): salida del inventario de la estación hacia suministros, bodega o taller.
 * Pura: ni React, ni IndexedDB, ni red. La base (`_fert_op_devolucion_bodega`) vuelve a validar todo.
 */

import type { DevolucionBodega, EstadoCampo, Operacion } from './tipos'

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
  /** Quién retiró (chofer o persona del catálogo de campo) y en qué vehículo: obligatorios. */
  choferId: string
  vehiculoId: string
  /** Tipo del catálogo de vehículos (no hay lista aparte). Solo para mostrar sin señal; la base copia el suyo. */
  vehiculoTipo?: string | null
  /** Nombres tal como se eligieron: viajan para mostrar el detalle aun sin señal (la base guarda los suyos). */
  choferNombre?: string
  vehiculoPlaca?: string
}): { datos: Record<string, unknown> } | { error: string } {
  if (!DESTINOS_DEVOLUCION.some((d) => d.id === args.destino)) return { error: 'Elige a dónde se devuelve (Suministros, Bodega o Taller).' }
  const motivo = (args.motivo ?? '').trim()
  if (!motivo) return { error: 'Escribe el motivo de la devolución.' }
  if (!args.choferId) return { error: 'Indica quién retiró el producto (chofer o persona).' }
  if (!args.vehiculoId) return { error: 'Indica en qué vehículo se llevan el producto (placa o identificación).' }
  if (!(args.vehiculoTipo ?? '').trim()) return { error: 'El vehículo no tiene tipo (camión, carro, tractor...) en el catálogo: complétalo en Administración › Choferes y catálogos de campo.' }
  const lineas = (args.lineas ?? []).filter((l) => l.material_id && Number.isFinite(Number(l.cantidad)) && Number(l.cantidad) > 0)
  if (lineas.length === 0) return { error: SIN_PRODUCTOS_DEVOLUCION }
  return {
    datos: {
      estacion_id: args.estacionId,
      fecha_hora: args.fechaHora,
      destino: args.destino,
      motivo,
      chofer_id: args.choferId,
      vehiculo_id: args.vehiculoId,
      vehiculo_tipo: args.vehiculoTipo ?? null,
      chofer_nombre: args.choferNombre ?? null,
      vehiculo_placa: args.vehiculoPlaca ?? null,
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

/* ------------------------- Detalle para mostrar (servidor o cola sin señal) ------------------------- */

export const SIN_DATO_ANTERIOR = 'sin dato (registro anterior)'

const nombreDestino = (d: string | null | undefined) => DESTINOS_DEVOLUCION.find((x) => x.id === d)?.nombre ?? null

/** Rótulo de la fila de la bitácora: el destino CONCRETO, nunca los tres juntos. */
export function rotuloDevolucion(destino: string | null | undefined): string {
  const n = nombreDestino(destino)
  return n ? `Devuelto a ${n.toUpperCase()}` : 'Devuelto a bodega (destino sin dato)'
}

export type VistaDevolucion = {
  origen: 'servidor' | 'local'
  id: string
  destino: string | null
  motivo: string | null
  fecha_hora: string | null
  registrado_por: string | null
  registrado_por_nombre: string | null
  /** null = el registro es anterior a la 131 (se muestra SIN_DATO_ANTERIOR). */
  chofer: string | null
  vehiculo: string | null
  vehiculo_tipo: string | null
  anulado_at: string | null
  anulado_por_nombre: string | null
  motivo_anulacion: string | null
  operacion: DevolucionBodega['operacion'] | null
  lineas: { material_id: string; cantidad: number; saldo_antes: number | null; saldo_despues: number | null }[]
}

/** «retiró: Juan · camión ABC123» (segunda línea de la bitácora). */
export function lineaRetiro(v: Pick<VistaDevolucion, 'chofer' | 'vehiculo' | 'vehiculo_tipo'>): string {
  const quien = v.chofer ?? SIN_DATO_ANTERIOR
  const veh = [v.vehiculo_tipo?.toLowerCase(), v.vehiculo].filter(Boolean).join(' ')
  return `retiró: ${quien} · ${veh || SIN_DATO_ANTERIOR}`
}

/**
 * La devolución como la ve el teléfono: la del servidor (sql/131) o, si todavía está en cola sin señal, lo que la
 * operación local ya trae (sin esperar al servidor). Null si no es una devolución a bodega conocida.
 */
export function vistaDevolucion(
  estado: Pick<EstadoCampo, 'devoluciones_bodega' | 'yo'>,
  cola: Operacion[],
  id: string,
  nombrePersona?: (id: string | null | undefined) => string | null
): VistaDevolucion | null {
  const s = (estado.devoluciones_bodega ?? []).find((d) => d.id === id)
  if (s) {
    return {
      origen: 'servidor',
      id,
      destino: s.destino,
      motivo: s.motivo,
      fecha_hora: s.fecha_hora,
      registrado_por: s.registrado_por,
      registrado_por_nombre: s.registrado_por_nombre ?? nombrePersona?.(s.registrado_por) ?? null,
      chofer: s.chofer ?? null,
      vehiculo: s.vehiculo ?? null,
      vehiculo_tipo: s.vehiculo_tipo ?? null,
      anulado_at: s.anulado_at,
      anulado_por_nombre: s.anulado_por_nombre ?? nombrePersona?.(s.anulado_por) ?? null,
      motivo_anulacion: s.motivo_anulacion,
      operacion: s.operacion ?? null,
      lineas: (s.lineas ?? []).map((l) => ({
        material_id: l.material_id,
        cantidad: Number(l.cantidad),
        saldo_antes: l.saldo_antes ?? null,
        saldo_despues: l.saldo_despues ?? null,
      })),
    }
  }
  const op = cola.find((o) => o.id === id && o.tipo === 'devolucion_bodega')
  if (!op) return null
  const d = op.datos
  const quien = op.en_nombre_de ?? estado.yo?.id ?? null
  return {
    origen: 'local',
    id,
    destino: (d.destino as string) ?? null,
    motivo: (d.motivo as string) ?? null,
    fecha_hora: String(d.fecha_hora ?? op.creado_en),
    registrado_por: quien,
    registrado_por_nombre: nombrePersona?.(quien) ?? estado.yo?.nombre ?? null,
    chofer: (d.chofer_nombre as string) ?? null,
    vehiculo: (d.vehiculo_placa as string) ?? null,
    vehiculo_tipo: (d.vehiculo_tipo as string) ?? null,
    anulado_at: null,
    anulado_por_nombre: null,
    motivo_anulacion: null,
    operacion: {
      creado_en: op.creado_en,
      recibido_en: null,
      lat: op.ubicacion?.lat ?? null,
      lon: op.ubicacion?.lon ?? null,
      observaciones: op.observaciones ?? null,
    },
    lineas: ((d.lineas as { material_id: string; cantidad: number }[] | undefined) ?? [])
      .filter((l) => Number(l.cantidad) > 0)
      .map((l) => ({ material_id: l.material_id, cantidad: Number(l.cantidad), saldo_antes: null, saldo_despues: null })),
  }
}
