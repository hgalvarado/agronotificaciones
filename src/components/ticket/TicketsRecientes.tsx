'use client'

/**
 * Los tickets RECIENTES de una sola vez, agrupados por día: todo el mes en curso y, en los cambios de mes, al
 * menos los últimos 10 días (el 3 de diciembre se ven también los del 23 al 30 de noviembre).
 *
 * Pedido del usuario: «el del mes tiene que salir de una sola vez, es lo que más importancia tiene en ese momento».
 * Antes había que abrir mes → proceso → ticket (acordeón de dos niveles). Los meses anteriores siguen en el
 * historial por mes, debajo (ArbolTickets).
 *
 * Usa la misma función de la base que el historial (`fn_tickets_pagina`, RLS manda), un mes a la vez, todas las
 * páginas. Se actualiza solo (useConsultaViva: al volver a la ventana y con avisos de la base).
 */

import { useCallback, useEffect, useMemo } from 'react'
import { Alerta, Esqueleto } from '@/components/ui/Primitivos'
import { useConsultaViva } from '@/lib/datos/useConsultaViva'
import { leerPagina, cursorDe } from '@/lib/tickets/repositorio'
import type { FilaTicket, FiltrosTickets } from '@/lib/tickets/tipos'
import { hoyIso, instanteDeFecha, primerDiaDelMes, sumarDias, ZONA } from '@/lib/fechas'

/** Días hacia atrás que siempre se ven, aunque sean del mes anterior. */
const DIAS_MINIMOS = 10
const POR_PAGINA = 200

/** Desde cuándo: el día 1 del mes, o 10 días atrás si eso es antes. */
export function inicioRecientes(): string {
  const primero = primerDiaDelMes()
  const diezAtras = sumarDias(hoyIso(), -DIAS_MINIMOS)
  return diezAtras < primero ? diezAtras : primero
}

function mesesEntre(desde: string, hasta: string): string[] {
  const meses: string[] = []
  let m = desde.slice(0, 7)
  while (m <= hasta.slice(0, 7)) {
    meses.push(m)
    const [a, mm] = m.split('-').map(Number)
    m = mm === 12 ? `${a + 1}-01` : `${a}-${String(mm + 1).padStart(2, '0')}`
  }
  return meses
}

function tituloDia(iso: string, hoy: string): string {
  if (iso === hoy) return 'Hoy'
  if (iso === sumarDias(hoy, -1)) return 'Ayer'
  const t = instanteDeFecha(iso).toLocaleDateString('es-HN', {
    timeZone: ZONA, weekday: 'long', day: 'numeric', month: 'short',
  })
  return t.charAt(0).toUpperCase() + t.slice(1)
}

export function TicketsRecientes({
  filtros,
  revision,
  fila,
  onFilasCargadas,
  accionDia,
}: {
  filtros: FiltrosTickets
  /** Sube cuando el servidor vuelve a contar (un ticket cambió): se vuelve a consultar. */
  revision: number
  fila: (t: FilaTicket) => React.ReactNode
  onFilasCargadas?: (filas: FilaTicket[]) => void
  /** Algo a la derecha del título de cada día (p. ej. «Seleccionar el día»). */
  accionDia?: (tickets: FilaTicket[]) => React.ReactNode
}) {
  const desde = inicioRecientes()
  const hoy = hoyIso()
  const huella = JSON.stringify({ u: filtros.usuarios, e: filtros.estados, b: filtros.busqueda })

  const leer = useCallback(async () => {
    const f = JSON.parse(huella) as { u: string[]; e: string[]; b: string }
    const filtro: FiltrosTickets = { meses: [], procesos: [], usuarios: f.u, estados: f.e, busqueda: f.b }
    const todas: FilaTicket[] = []
    for (const mes of mesesEntre(desde, hoy)) {
      let cursor = null as ReturnType<typeof cursorDe>
      // Todas las páginas del mes (un mes son a lo sumo unos cientos de tickets)
      for (let vuelta = 0; vuelta < 20; vuelta++) {
        const { filas, error } = await leerPagina(mes, null, filtro, cursor, POR_PAGINA)
        if (error) return { datos: [], error }
        todas.push(...filas)
        if (filas.length < POR_PAGINA) break
        cursor = cursorDe(filas)
      }
    }
    return { datos: todas.filter((t) => t.fecha >= desde), error: null }
  }, [huella, desde, hoy])

  const { filas, cargando, error, recargar } = useConsultaViva<FilaTicket>({
    clave: `tickets-recientes:${desde}:${huella}`,
    leer,
    tablas: ['tickets'],
  })

  // Un cambio de proceso o estado hecho desde esta pantalla: volver a consultar en silencio
  useEffect(() => {
    if (revision > 0) void recargar(true)
  }, [revision, recargar])

  useEffect(() => {
    if (filas) onFilasCargadas?.(filas)
  }, [filas, onFilasCargadas])

  const porDia = useMemo(() => {
    const procesos = new Set(filtros.procesos)
    const visibles = (filas ?? []).filter((t) => procesos.size === 0 || procesos.has(t.proceso))
    const dias = new Map<string, FilaTicket[]>()
    for (const t of [...visibles].sort((a, b) => b.fecha.localeCompare(a.fecha))) {
      dias.set(t.fecha, [...(dias.get(t.fecha) ?? []), t])
    }
    return [...dias.entries()]
  }, [filas, filtros.procesos])

  if (error) return <Alerta>{error}</Alerta>
  if (cargando && !filas) {
    return (
      <div className="flex flex-col gap-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Esqueleto key={i} className="h-16 w-full" />
        ))}
      </div>
    )
  }
  if (porDia.length === 0) {
    return <p className="px-1 py-4 text-sm text-slate-400">Sin tickets desde el {desde.split('-').reverse().join('/')}.</p>
  }

  return (
    <div className="flex flex-col gap-3" data-tickets-recientes>
      {porDia.map(([dia, tickets]) => (
        <section key={dia} aria-label={tituloDia(dia, hoy)} data-dia={dia}>
          <div className="sticky top-0 z-[1] flex items-center gap-2 bg-slate-50/95 px-1 py-1.5 backdrop-blur-sm">
            <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500">{tituloDia(dia, hoy)}</h3>
            <span className="text-xs text-slate-400">· {tickets.length}</span>
            <span className="ml-auto">{accionDia?.(tickets)}</span>
          </div>
          <div className="flex flex-col gap-1.5">{tickets.map((t) => fila(t))}</div>
        </section>
      ))}
    </div>
  )
}
