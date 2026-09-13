'use client'

/**
 * El embudo de una columna: abre el panel y dibuja el filtro que esa
 * columna sabe usar.
 *
 * No conoce los datos ni sabe filtrar. Recibe el filtro que hay, las
 * opciones que existen y devuelve el filtro nuevo; toda la regla está en
 * `lib/grid/filtros`. Por eso sirve igual a las siembras, a los
 * horómetros y a las labores.
 *
 * El panel va en un PORTAL al body. El encabezado es `sticky` y la tabla
 * tiene `overflow`, así que un panel colocado dentro quedaría recortado
 * por el propio contenedor de la tabla, que es el problema que ya nos
 * costó los modales.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Boton } from './Primitivos'
import { IconCheck, IconChevronDown, IconSearch } from './Icons'
import { estaActivo, filtroVacio, resumenFiltro } from '@/lib/grid/filtros'
import { VACIO, type Filtro, type TipoFiltro } from '@/lib/grid/tipos'

const ANCHO = 268

export function FiltroColumna({
  tipo,
  etiqueta,
  filtro,
  opciones,
  onCambiar,
}: {
  tipo: TipoFiltro
  etiqueta: string
  filtro: Filtro
  /** Valores distintos de la columna; sólo los usa el filtro de casillas. */
  opciones: string[]
  onCambiar: (f: Filtro) => void
}) {
  // La posición se calcula en el CLIC, no al dibujar: leer `ref.current`
  // durante el render es lo que prohíbe `react-hooks/refs`, y con razón,
  // porque en ese momento el DOM todavía puede no estar donde quedará.
  const [posicion, setPosicion] = useState<{ left: number; top: number } | null>(null)
  const boton = useRef<HTMLButtonElement>(null)
  const activo = estaActivo(filtro)

  function alternar(e: React.MouseEvent<HTMLButtonElement>) {
    if (posicion) return setPosicion(null)
    const caja = e.currentTarget.getBoundingClientRect()
    setPosicion({
      left: Math.max(8, Math.min(caja.left - 40, window.innerWidth - ANCHO - 8)),
      top: caja.bottom + 6,
    })
  }

  return (
    <>
      <button
        ref={boton}
        type="button"
        onClick={alternar}
        title={resumenFiltro(filtro) ?? `Filtrar ${etiqueta}`}
        aria-label={`Filtrar ${etiqueta}`}
        className={`rounded p-0.5 transition-colors ${
          activo ? 'text-brand-700' : 'text-slate-300 hover:text-slate-600'
        }`}
      >
        <IconChevronDown className="h-3.5 w-3.5" />
      </button>

      {posicion && (
        <Panel
          posicion={posicion}
          anclaje={boton}
          tipo={tipo}
          etiqueta={etiqueta}
          filtro={filtro}
          opciones={opciones}
          onCerrar={() => setPosicion(null)}
          onAplicar={(f) => {
            onCambiar(f)
            setPosicion(null)
          }}
        />
      )}
    </>
  )
}

function Panel({
  posicion,
  anclaje,
  tipo,
  etiqueta,
  filtro,
  opciones,
  onCerrar,
  onAplicar,
}: {
  posicion: { left: number; top: number }
  anclaje: React.RefObject<HTMLButtonElement | null>
  tipo: TipoFiltro
  etiqueta: string
  filtro: Filtro
  opciones: string[]
  onCerrar: () => void
  onAplicar: (f: Filtro) => void
}) {
  const [borrador, setBorrador] = useState<Filtro>(filtro)
  const panel = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const fuera = (e: MouseEvent) => {
      // Aquí sí se puede leer `.current`: es un manejador de eventos, no
      // el cuerpo del render.
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

  if (typeof document === 'undefined') return null

  return createPortal(
    <div
      ref={panel}
      style={{ left: posicion.left, top: posicion.top, width: ANCHO }}
      className="fixed z-50 overflow-hidden rounded-xl border border-slate-200 bg-white text-left normal-case shadow-[var(--shadow-raised)]"
      onKeyDown={(e) => {
        if (e.key === 'Enter') onAplicar(borrador)
      }}
    >
      <div className="border-b border-slate-100 px-3 py-2">
        <p className="truncate text-xs font-bold uppercase tracking-wide text-slate-400">
          {etiqueta}
        </p>
      </div>

      {borrador.tipo === 'seleccion' && (
        <Casillas
          opciones={opciones}
          marcados={borrador.valores}
          onCambiar={(valores) => setBorrador({ tipo: 'seleccion', valores })}
        />
      )}

      {borrador.tipo === 'texto' && (
        <div className="p-3">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              Contiene el texto
            </span>
            <input
              autoFocus
              type="text"
              value={borrador.texto}
              onChange={(e) => setBorrador({ tipo: 'texto', texto: e.target.value })}
              placeholder="Escribe parte del valor…"
              className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm focus:border-brand-600 focus:outline-none"
            />
          </label>
        </div>
      )}

      {borrador.tipo === 'fecha' && (
        <div className="flex flex-col gap-2 p-3">
          <Rango
            etiquetaA="Desde"
            etiquetaB="Hasta"
            tipo="date"
            a={borrador.desde}
            b={borrador.hasta}
            onCambiar={(desde, hasta) => setBorrador({ tipo: 'fecha', desde, hasta })}
          />
          <p className="text-[11px] text-slate-400">
            Deja un extremo vacío para no acotarlo por ese lado.
          </p>
        </div>
      )}

      {borrador.tipo === 'numero' && (
        <div className="flex flex-col gap-2 p-3">
          <Rango
            etiquetaA="Mínimo"
            etiquetaB="Máximo"
            tipo="number"
            a={borrador.min}
            b={borrador.max}
            onCambiar={(min, max) => setBorrador({ tipo: 'numero', min, max })}
          />
          <p className="text-[11px] text-slate-400">
            Los dos extremos se incluyen. Las celdas sin dato no pasan.
          </p>
        </div>
      )}

      <div className="flex gap-2 border-t border-slate-100 p-2">
        <Boton
          variante="secundario"
          tamano="sm"
          className="flex-1"
          onClick={() => onAplicar(filtroVacio(tipo))}
        >
          Limpiar
        </Boton>
        <Boton tamano="sm" className="flex-1" onClick={() => onAplicar(borrador)}>
          Aplicar
        </Boton>
      </div>
    </div>,
    document.body
  )
}

/* ------------------------------------------------------------------ */
/* Las tres formas de filtrar                                          */
/* ------------------------------------------------------------------ */

function Casillas({
  opciones,
  marcados,
  onCambiar,
}: {
  opciones: string[]
  marcados: string[]
  onCambiar: (valores: string[]) => void
}) {
  const [busqueda, setBusqueda] = useState('')

  const listadas = useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    return q ? opciones.filter((o) => o.toLowerCase().includes(q)) : opciones
  }, [opciones, busqueda])

  const juego = useMemo(() => new Set(marcados), [marcados])
  // Sin nada marcado el filtro no aplica: es lo mismo que «todos».
  const todos = juego.size === 0 || juego.size === opciones.length

  function alternar(valor: string) {
    const copia = new Set(juego)
    if (copia.has(valor)) copia.delete(valor)
    else copia.add(valor)
    onCambiar([...copia])
  }

  return (
    <>
      <div className="p-2">
        <div className="relative">
          <IconSearch className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-300" />
          <input
            autoFocus
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar valor…"
            className="w-full rounded-lg border border-slate-200 py-1.5 pl-8 pr-2 text-sm focus:border-brand-600 focus:outline-none"
          />
        </div>
      </div>

      <button
        type="button"
        onClick={() => onCambiar(todos ? [] : [...opciones])}
        className="flex w-full items-center gap-2 border-y border-slate-100 px-3 py-2 text-left text-sm font-semibold text-slate-700 hover:bg-slate-50"
      >
        <Casilla marcada={todos} />
        (Seleccionar todo)
      </button>

      <div className="scroll-suave max-h-56 overflow-y-auto overscroll-contain">
        {listadas.length === 0 && (
          <p className="px-3 py-4 text-center text-xs text-slate-400">Ningún valor coincide.</p>
        )}
        {listadas.map((valor) => (
          <button
            key={valor}
            type="button"
            onClick={() => alternar(valor)}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-slate-600 hover:bg-slate-50"
          >
            <Casilla marcada={juego.has(valor)} />
            <span className={`truncate ${valor === VACIO ? 'italic text-slate-400' : ''}`}>
              {valor}
            </span>
          </button>
        ))}
      </div>

      {juego.size > 0 && (
        <p className="border-t border-slate-100 px-3 py-1.5 text-[11px] text-slate-400">
          {juego.size} de {opciones.length} marcados
        </p>
      )}
    </>
  )
}

function Rango({
  etiquetaA,
  etiquetaB,
  tipo,
  a,
  b,
  onCambiar,
}: {
  etiquetaA: string
  etiquetaB: string
  tipo: 'date' | 'number'
  a: string
  b: string
  onCambiar: (a: string, b: string) => void
}) {
  const clase =
    'rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm focus:border-brand-600 focus:outline-none'
  return (
    <div className="grid grid-cols-2 gap-2">
      <label className="flex flex-col gap-1">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
          {etiquetaA}
        </span>
        <input
          autoFocus
          type={tipo}
          inputMode={tipo === 'number' ? 'decimal' : undefined}
          value={a}
          onChange={(e) => onCambiar(e.target.value, b)}
          className={clase}
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
          {etiquetaB}
        </span>
        <input
          type={tipo}
          inputMode={tipo === 'number' ? 'decimal' : undefined}
          value={b}
          onChange={(e) => onCambiar(a, e.target.value)}
          className={clase}
        />
      </label>
    </div>
  )
}

function Casilla({ marcada }: { marcada: boolean }) {
  return (
    <span
      className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-all ${
        marcada ? 'border-brand-700 bg-brand-700 text-white' : 'border-slate-300 bg-white'
      }`}
    >
      {marcada && <IconCheck className="h-3 w-3" />}
    </span>
  )
}
