'use client'

/** Filtros de «Registros de la temporada»: selectores con búsqueda y Única/Varios, fechas y texto. Solo presentación. */

import { useRef, useState } from 'react'
import { Campo, Entrada, Tarjeta } from '@/components/ui/Primitivos'
import { SelectorMultiple, type OpcionSelector } from '@/components/ui/SelectorMultiple'
import type { FiltrosRegistros } from '@/lib/agrometricas/registrosPura'

export interface OpcionesFiltros {
  temporadas: OpcionSelector[]
  zonas: OpcionSelector[]
  turnos: OpcionSelector[]
  lotes: OpcionSelector[]
}

export function FiltrosRegistrosPanel({ filtros, opciones, onCambiar, turnosDeLotes }: {
  filtros: FiltrosRegistros
  opciones: OpcionesFiltros
  onCambiar: (cambio: Partial<FiltrosRegistros>) => void
  /** Turnos que contienen los lotes elegidos (aviso «verás los registros de todos estos turnos»). */
  turnosDeLotes: string[]
}) {
  const [texto, setTexto] = useState(filtros.texto)
  const espera = useRef<ReturnType<typeof setTimeout> | null>(null)
  const escribir = (v: string) => {
    setTexto(v)
    if (espera.current) clearTimeout(espera.current)
    espera.current = setTimeout(() => onCambiar({ texto: v }), 400)
  }
  const hayFiltros = Boolean(filtros.temporada.length || filtros.zona.length || filtros.turno.length || filtros.lotes.length || filtros.desde || filtros.hasta || filtros.texto)

  return (
    <Tarjeta className="p-3.5" >
      <div data-filtros className="flex flex-col gap-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <SelectorMultiple etiqueta="Temporada" opciones={opciones.temporadas} valores={filtros.temporada} onCambiar={(v) => onCambiar({ temporada: v })} />
          <SelectorMultiple etiqueta="Zona" opciones={opciones.zonas} valores={filtros.zona} onCambiar={(v) => onCambiar({ zona: v })} />
          <SelectorMultiple etiqueta="Turno" opciones={opciones.turnos} valores={filtros.turno} onCambiar={(v) => onCambiar({ turno: v })} />
          <SelectorMultiple etiqueta="Lote" opciones={opciones.lotes} valores={filtros.lotes} onCambiar={(v) => onCambiar({ lotes: v })} />
        </div>
        {filtros.lotes.length > 0 && turnosDeLotes.length > 0 && (
          <p className="text-xs text-slate-500" data-turnos-del-lote>Se muestran los registros de todos los turnos que contienen el lote: {turnosDeLotes.join(', ')}.</p>
        )}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Campo etiqueta="Desde"><Entrada type="date" value={filtros.desde} max={filtros.hasta || undefined} onChange={(e) => onCambiar({ desde: e.target.value })} /></Campo>
          <Campo etiqueta="Hasta"><Entrada type="date" value={filtros.hasta} min={filtros.desde || undefined} onChange={(e) => onCambiar({ hasta: e.target.value })} /></Campo>
          <Campo etiqueta="Buscar" className="col-span-2"><Entrada type="search" value={texto} placeholder="Turno, estación, persona, comentario…" onChange={(e) => escribir(e.target.value)} data-buscar /></Campo>
        </div>
        {hayFiltros && (
          <button type="button" data-limpiar
            className="self-start inline-flex min-h-11 items-center px-2 text-sm font-semibold text-brand-700 underline"
            onClick={() => { setTexto(''); onCambiar({ temporada: [], zona: [], turno: [], lotes: [], desde: '', hasta: '', texto: '' }) }}>
            Quitar filtros
          </button>
        )}
      </div>
    </Tarjeta>
  )
}
