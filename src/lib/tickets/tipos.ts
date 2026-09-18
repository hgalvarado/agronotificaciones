/**
 * Contratos del historial de tickets.
 *
 * Sólo nombres de formas y el nombre del mes. No sabe de React ni de
 * Supabase: lo comparten el repositorio, la lista y el panel de filtros.
 */

import { ZONA } from '@/lib/fechas'
import { PROCESOS } from '@/lib/estados'
import type { EstadoTicket, ProcesoTicket } from '@/lib/types'

/** Un bloque del árbol: un mes y un proceso, con su cuenta. */
export type BloqueTickets = {
  /** `YYYY-MM`. Es la fecha de la JORNADA, que ya es un día de Honduras. */
  mes: string
  proceso: ProcesoTicket
  cuantos: number
  abiertos: number
  primera: string
  ultima: string
}

/** Una fila de la lista. Es lo mínimo que la lista dibuja. */
export type FilaTicket = {
  id: string
  codigo: string
  fecha: string
  estado: EstadoTicket
  proceso: ProcesoTicket
  departamento: string | null
  usuario_id: string
  usuario_nombre: string | null
}

export type Capturador = { usuario_id: string; nombre: string; cuantos: number }

/** Lo que acota la consulta. Listas vacías significan «no filtres por eso». */
export type FiltrosTickets = {
  meses: string[]
  usuarios: string[]
  procesos: string[]
  estados: string[]
  busqueda: string
}

export const SIN_FILTROS: FiltrosTickets = {
  meses: [],
  usuarios: [],
  procesos: [],
  estados: [],
  busqueda: '',
}

/** Cuántos filtros están puestos. Es el contador del botón. */
export function cuantosFiltros(f: FiltrosTickets): number {
  return (
    f.meses.length +
    f.usuarios.length +
    f.procesos.length +
    f.estados.length +
    (f.busqueda.trim() ? 1 : 0)
  )
}

/**
 * «2026-03» → «Marzo 2026».
 *
 * Se ancla al día 15 y al mediodía a propósito: con el día 1 a medianoche,
 * cualquier reloj al oeste de Honduras lo correría al mes anterior y el
 * bloque saldría con el nombre equivocado. El día 15 está lejos de las dos
 * fronteras del mes.
 */
export function nombreDelMes(mes: string): string {
  const [anio, m] = mes.split('-').map(Number)
  if (!anio || !m) return mes
  const d = new Date(Date.UTC(anio, m - 1, 15, 12, 0, 0))
  const texto = d.toLocaleDateString('es-HN', {
    timeZone: ZONA,
    month: 'long',
    year: 'numeric',
  })
  return texto.charAt(0).toUpperCase() + texto.slice(1)
}

/** La llave de un bloque, para saber cuál está abierto y qué se cargó. */
export function llaveBloque(mes: string, proceso: string): string {
  return `${mes}|${proceso}`
}

/** El árbol que dibuja la lista: un mes con sus procesos dentro. */
export type MesConProcesos = {
  mes: string
  nombre: string
  cuantos: number
  bloques: BloqueTickets[]
}

/**
 * Agrupa los bloques planos que devuelve la base en meses.
 *
 * La base devuelve una fila por (mes, proceso) porque es lo que sabe
 * agregar de una pasada; el nivel de mes se arma aquí, que es puro
 * acomodo y no merece otra consulta.
 */
export function porMes(bloques: BloqueTickets[]): MesConProcesos[] {
  const meses = new Map<string, MesConProcesos>()
  for (const b of bloques) {
    const actual = meses.get(b.mes) ?? {
      mes: b.mes,
      nombre: nombreDelMes(b.mes),
      cuantos: 0,
      bloques: [],
    }
    actual.cuantos += Number(b.cuantos)
    actual.bloques.push(b)
    meses.set(b.mes, actual)
  }

  // Dentro del mes, los procesos van 0, 1, 2, 3: es el orden del flujo
  // hacia SAP y el que la gente tiene en la cabeza. Ordenarlos por el
  // nombre del enum dejaría «Notificado» de primero.
  const orden = new Map(PROCESOS.map((p) => [p.valor, p.numero]))
  for (const m of meses.values()) {
    m.bloques.sort((a, b) => (orden.get(a.proceso) ?? 9) - (orden.get(b.proceso) ?? 9))
  }
  // Del más reciente al más viejo: el trabajo de esta semana primero, y
  // el historial se baja desplazándose.
  return [...meses.values()].sort((a, b) => b.mes.localeCompare(a.mes))
}
