'use client'

/**
 * Selector de varios valores, con buscador.
 *
 * Es el control de los filtros de arriba, los que acotan toda la
 * pantalla. Un `<select multiple>` del navegador obliga a tener la tecla
 * Ctrl pulsada para marcar dos cosas, y esta pantalla se usa desde el
 * celular: aquí se marca tocando.
 *
 * Nada marcado significa TODOS. Un filtro que no recorta nada es lo mismo
 * que no tener filtro, y eso deja el estado limpio.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { IconCheck, IconChevronDown, IconSearch } from './Icons'

export type OpcionSelector = { valor: string; etiqueta: string }

const ANCHO = 260

export function SelectorMultiple({
  etiqueta,
  opciones,
  valores,
  onCambiar,
  className = '',
}: {
  etiqueta: string
  opciones: OpcionSelector[]
  valores: string[]
  onCambiar: (valores: string[]) => void
  className?: string
}) {
  // La posición se calcula en el CLIC: leer `ref.current` durante el
  // render es lo que prohíbe `react-hooks/refs`.
  const [posicion, setPosicion] = useState<{ left: number; top: number } | null>(null)
  const boton = useRef<HTMLButtonElement>(null)

  const marcados = useMemo(() => new Set(valores), [valores])
  const resumen =
    marcados.size === 0
      ? 'Todos'
      : marcados.size === 1
        ? (opciones.find((o) => o.valor === valores[0])?.etiqueta ?? '1 seleccionado')
        : `${marcados.size} seleccionados`

  function abrir(e: React.MouseEvent<HTMLButtonElement>) {
    if (posicion) return setPosicion(null)
    const caja = e.currentTarget.getBoundingClientRect()
    setPosicion({
      left: Math.max(8, Math.min(caja.left, window.innerWidth - ANCHO - 8)),
      top: caja.bottom + 6,
    })
  }

  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {etiqueta}
      </span>
      <button
        ref={boton}
        type="button"
        onClick={abrir}
        className={`flex h-11 items-center justify-between gap-2 rounded-xl border px-3 text-left text-sm transition-colors ${
          marcados.size > 0
            ? 'border-brand-300 bg-brand-50/60 font-semibold text-brand-800'
            : 'border-slate-200 bg-white text-slate-600'
        }`}
      >
        <span className="truncate">{resumen}</span>
        <IconChevronDown className="h-4 w-4 shrink-0 text-slate-400" />
      </button>

      {posicion && (
        <Panel
          posicion={posicion}
          anclaje={boton}
          etiqueta={etiqueta}
          opciones={opciones}
          marcados={marcados}
          onCambiar={onCambiar}
          onCerrar={() => setPosicion(null)}
        />
      )}
    </div>
  )
}

function Panel({
  posicion,
  anclaje,
  etiqueta,
  opciones,
  marcados,
  onCambiar,
  onCerrar,
}: {
  posicion: { left: number; top: number }
  anclaje: React.RefObject<HTMLButtonElement | null>
  etiqueta: string
  opciones: OpcionSelector[]
  marcados: Set<string>
  onCambiar: (valores: string[]) => void
  onCerrar: () => void
}) {
  const [busqueda, setBusqueda] = useState('')
  const panel = useRef<HTMLDivElement>(null)

  const listadas = useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    return q ? opciones.filter((o) => o.etiqueta.toLowerCase().includes(q)) : opciones
  }, [opciones, busqueda])

  useEffect(() => {
    const fuera = (e: MouseEvent) => {
      if (panel.current?.contains(e.target as Node)) return
      if (anclaje.current?.contains(e.target as Node)) return
      onCerrar()
    }
    const tecla = (e: KeyboardEvent) => e.key === 'Escape' && onCerrar()
    document.addEventListener('mousedown', fuera)
    document.addEventListener('keydown', tecla)
    return () => {
      document.removeEventListener('mousedown', fuera)
      document.removeEventListener('keydown', tecla)
    }
  }, [anclaje, onCerrar])

  function alternar(valor: string) {
    const copia = new Set(marcados)
    if (copia.has(valor)) copia.delete(valor)
    else copia.add(valor)
    onCambiar([...copia])
  }

  if (typeof document === 'undefined') return null

  return createPortal(
    <div
      ref={panel}
      style={{ left: posicion.left, top: posicion.top, width: ANCHO }}
      className="fixed z-50 overflow-hidden rounded-xl border border-slate-200 bg-white text-left shadow-[var(--shadow-raised)]"
    >
      <div className="border-b border-slate-100 px-3 py-2">
        <p className="truncate text-xs font-bold uppercase tracking-wide text-slate-400">
          {etiqueta}
        </p>
      </div>

      <div className="p-2">
        <div className="relative">
          <IconSearch className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-300" />
          <input
            autoFocus
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar…"
            className="w-full rounded-lg border border-slate-200 py-1.5 pl-8 pr-2 text-sm focus:border-brand-600 focus:outline-none"
          />
        </div>
      </div>

      <div className="scroll-suave max-h-60 overflow-y-auto overscroll-contain border-t border-slate-100">
        {listadas.length === 0 && (
          <p className="px-3 py-4 text-center text-xs text-slate-400">Ningún valor coincide.</p>
        )}
        {listadas.map((o) => (
          <button
            key={o.valor}
            type="button"
            onClick={() => alternar(o.valor)}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-slate-600 hover:bg-slate-50"
          >
            <span
              className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                marcados.has(o.valor)
                  ? 'border-brand-700 bg-brand-700 text-white'
                  : 'border-slate-300 bg-white'
              }`}
            >
              {marcados.has(o.valor) && <IconCheck className="h-3 w-3" />}
            </span>
            <span className="truncate">{o.etiqueta}</span>
          </button>
        ))}
      </div>

      <div className="flex items-center justify-between border-t border-slate-100 px-3 py-2 text-xs">
        <span className="text-slate-400">
          {marcados.size === 0 ? 'Sin filtrar' : `${marcados.size} de ${opciones.length}`}
        </span>
        <button
          type="button"
          onClick={() => onCambiar([])}
          className="font-semibold text-brand-700 hover:underline"
        >
          Limpiar
        </button>
      </div>
    </div>,
    document.body
  )
}
