/**
 * Devolver diésel de un tanque a bodega (sql/155): la misma devolución de Fertirriego (destinos, chofer, vehículo, motivo), pero
 * sale del TANQUE y en galones. Pura: ni React, ni IndexedDB, ni red. La base (`_mot_op_diesel_devolver`) vuelve a validar todo.
 */

// Solo el tipo (se borra al compilar): así las pruebas con Node cargan este archivo suelto. Los nombres para mostrar salen de
// DESTINOS_DEVOLUCION (Fertirriego); la base valida la misma lista.
import type { DestinoDevolucion } from '@/lib/fertirriego/devolucionBodega'

const DESTINOS: readonly string[] = ['SUMINISTROS', 'BODEGA', 'TALLER'] satisfies DestinoDevolucion[]

export function armarDevolucionDiesel(args: {
  estacionId: string
  tanqueId: string
  galones: number
  /** Saldo del tanque contando lo pendiente de enviar (no se devuelve más de lo que hay). */
  disponible: number
  destino: DestinoDevolucion | ''
  motivo: string
  fechaHora: string
  choferId: string
  vehiculoId: string
  /** Tipo del catálogo de vehículos (obligatorio, como en Fertirriego). */
  vehiculoTipo?: string | null
}): { datos: Record<string, unknown> } | { error: string } {
  if (!args.tanqueId) return { error: 'Elige el tanque.' }
  if (!DESTINOS.includes(args.destino)) return { error: 'Elige a dónde se devuelve (Suministros, Bodega o Taller).' }
  const g = Number(args.galones)
  if (!Number.isFinite(g) || g <= 0) return { error: 'Indica los galones que se devuelven.' }
  if (g > args.disponible + 0.005) return { error: `No puedes devolver más de lo que hay: en el tanque hay ${Math.round(args.disponible * 100) / 100} gal.` }
  const motivo = (args.motivo ?? '').trim()
  if (!motivo) return { error: 'Escribe el motivo de la devolución.' }
  if (!args.choferId) return { error: 'Indica quién retiró el diésel (chofer o persona).' }
  if (!args.vehiculoId) return { error: 'Indica en qué vehículo se llevan el diésel (placa o identificación).' }
  if (!(args.vehiculoTipo ?? '').trim()) return { error: 'El vehículo no tiene tipo (camión, carro, tractor...) en el catálogo: complétalo en Administración › Choferes y catálogos de campo.' }
  return {
    datos: {
      estacion_id: args.estacionId,
      tanque_id: args.tanqueId,
      galones: Math.round(g * 100) / 100,
      fecha_hora: args.fechaHora,
      destino: args.destino,
      motivo,
      chofer_id: args.choferId,
      vehiculo_id: args.vehiculoId,
    },
  }
}
