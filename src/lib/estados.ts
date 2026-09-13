import type { Tono } from '@/components/ui/Primitivos'
import type { EstadoTicket, ProcesoTicket } from '@/lib/types'

// Etiquetas y colores de los dos ejes del ticket. Centralizado aquí para
// que la lista, el detalle y el formulario de edición siempre coincidan.

export const PROCESOS: {
  valor: ProcesoTicket
  numero: number
  etiqueta: string
  tono: Tono
  descripcion: string
}[] = [
  {
    valor: 'REGISTRADO',
    numero: 0,
    etiqueta: 'Registrado',
    tono: 'ambar',
    descripcion: 'Capturado en campo, aún no enviado a Torre de Control.',
  },
  {
    valor: 'REVISANDO',
    numero: 1,
    etiqueta: 'Revisando',
    tono: 'azul',
    descripcion: 'Torre de Control está validando la información.',
  },
  {
    valor: 'PENDIENTE_APROBACION',
    numero: 2,
    etiqueta: 'Pendiente Aprobación',
    tono: 'violeta',
    descripcion: 'Revisado, esperando visto bueno para notificar.',
  },
  {
    valor: 'NOTIFICADO',
    numero: 3,
    etiqueta: 'Notificado',
    tono: 'verde',
    descripcion: 'Ya cargado y liquidado en SAP.',
  },
]

export function procesoInfo(proceso: ProcesoTicket | null | undefined) {
  return PROCESOS.find((p) => p.valor === proceso) ?? PROCESOS[0]
}

export function estadoInfo(estado: EstadoTicket): { etiqueta: string; tono: Tono } {
  return estado === 'ABIERTO'
    ? { etiqueta: 'Activo', tono: 'verde' }
    : { etiqueta: 'Cerrado', tono: 'gris' }
}

export function formatearFecha(fecha: string) {
  // Las fechas vienen como 'YYYY-MM-DD' (date de Postgres). Se le agrega la
  // hora para que el navegador no la interprete en UTC y reste un día.
  return new Date(fecha + 'T00:00:00').toLocaleDateString('es-HN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

export function formatearFechaHora(iso: string) {
  return new Date(iso).toLocaleString('es-HN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** Ciclos de cultivo válidos. Lista cerrada: la base también la valida. */
export const CICLOS = [1, 2, 3] as const
