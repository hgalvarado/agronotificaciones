'use client'

/**
 * El selector de los filtros: con buscador y con interruptor de modo.
 *
 * Es el control de arriba, el que acota toda la pantalla. Un
 * `<select multiple>` del navegador obliga a tener Ctrl pulsado para
 * marcar dos cosas, y esta pantalla se usa desde el celular: aquí se
 * marca tocando.
 *
 * ── El interruptor ───────────────────────────────────────────────────
 *
 * Arranca en ÚNICA, que es cómo se filtra el 90% de las veces: se toca
 * un valor y el panel se cierra, sin el paso extra de cerrarlo a mano.
 * El interruptor de «Varios» convierte las filas en casillas y deja
 * acumular. Va DENTRO del panel, junto al buscador, porque es del
 * selector y no de la pantalla.
 *
 * Con dos o más valores ya marcados arranca en VARIOS: bajar a única
 * tirando en silencio lo que el usuario había marcado sería peor que
 * abrir en el modo que ya estaba usando.
 *
 * Hacia fuera siempre habla igual: una lista de valores, de largo 1 en
 * modo única. Así ninguna pantalla tiene que saber en qué modo está.
 *
 * Nada marcado significa TODOS. Un filtro que no recorta nada es lo
 * mismo que no tener filtro, y eso deja el estado limpio.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { IconCheck, IconChevronDown, IconSearch } from './Icons'

export type OpcionSelector = { valor: string; etiqueta: string }

export type ModoSelector = 'unica' | 'varios'

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
  // Única por omisión. Si al abrir ya hay varios marcados, se respeta lo
  // que el usuario tenía en vez de tirárselo.
  const [modo, setModo] = useState<ModoSelector>(valores.length > 1 ? 'varios' : 'unica')
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

  /** Bajar a única deja sólo el primero: dos valores en modo único mienten. */
  function cambiarModo(nuevo: ModoSelector) {
    setModo(nuevo)
    if (nuevo === 'unica' && valores.length > 1) onCambiar([valores[0]])
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
        aria-haspopup="listbox"
        aria-expanded={posicion !== null}
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
          modo={modo}
          onModo={cambiarModo}
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
  modo,
  onModo,
  onCambiar,
  onCerrar,
}: {
  posicion: { left: number; top: number }
  anclaje: React.RefObject<HTMLButtonElement | null>
  etiqueta: string
  opciones: OpcionSelector[]
  marcados: Set<string>
  modo: ModoSelector
  onModo: (modo: ModoSelector) => void
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

  function elegir(valor: string) {
    // En única, tocar el valor que ya estaba puesto lo quita: es la forma
    // de volver a «Todos» sin bajar al pie del panel.
    if (modo === 'unica') {
      onCambiar(marcados.has(valor) && marcados.size === 1 ? [] : [valor])
      return onCerrar()
    }
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

      <div className="flex flex-col gap-2 p-2">
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

        {/* El interruptor de modo. Va aquí, con el buscador, porque es del
            selector: la pantalla no sabe ni tiene que saber en qué modo
            está. */}
        <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-0.5">
          {(
            [
              ['unica', 'Uno solo'],
              ['varios', 'Varios'],
            ] as [ModoSelector, string][]
          ).map(([valor, texto]) => (
            <button
              key={valor}
              type="button"
              role="radio"
              aria-checked={modo === valor}
              onClick={() => onModo(valor)}
              className={`flex-1 rounded-md px-2 py-1 text-xs font-semibold transition-colors ${
                modo === valor
                  ? 'bg-white text-brand-700 shadow-[var(--shadow-card)]'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {texto}
            </button>
          ))}
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
            onClick={() => elegir(o.valor)}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-slate-600 hover:bg-slate-50"
          >
            {/* En única la marca es redonda y en varios cuadrada: la forma
                dice si al tocar se suma o se reemplaza, sin leer nada. */}
            <span
              className={`flex h-4 w-4 shrink-0 items-center justify-center border ${
                modo === 'unica' ? 'rounded-full' : 'rounded'
              } ${
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
