'use client'

/**
 * La celda del pie de una columna.
 *
 * Enseña el total y, al tocarla, abre el menú para elegir qué total.
 * Es el mismo patrón que `CeldaPermiso` y que el filtro de columna: el
 * panel va por `createPortal` sobre `document.body` con
 * `position: fixed`, y dónde cabe lo decide `anclarPanel`. Dentro de una
 * tabla con `overflow-x-auto` cualquier otra cosa queda recortada — y el
 * pie es el peor sitio de todos, porque está pegado al borde de abajo.
 */

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { anclarA, type Anclaje } from '@/lib/ui/anclaje'
import { IconCheck, IconChevronDown } from './Icons'
import {
  AGREGACIONES,
  formatearTotal,
  type Resultado,
  type TipoAgregacion,
} from '@/lib/grid/agregacion'

const ANCHO = 230

export function PieAgregacion({
  etiqueta,
  tipo,
  opciones,
  resultado,
  alinearDerecha,
  onElegir,
}: {
  /** El nombre de la columna. Encabeza el menú. */
  etiqueta: string
  tipo: TipoAgregacion
  /** Qué agregaciones ofrece ESTA columna. */
  opciones: TipoAgregacion[]
  resultado: Resultado
  alinearDerecha: boolean
  onElegir: (tipo: TipoAgregacion) => void
}) {
  const [posicion, setPosicion] = useState<Anclaje | null>(null)
  const boton = useRef<HTMLButtonElement>(null)

  // La posición se calcula en el CLIC: leer `ref.current` durante el
  // render es lo que prohíbe `react-hooks/refs`.
  function alternar(e: React.MouseEvent<HTMLButtonElement>) {
    if (posicion) return setPosicion(null)
    setPosicion(anclarA(e.currentTarget, { ancho: ANCHO, altoDeseado: 300 }))
  }

  const texto = formatearTotal(resultado)
  const nombre = AGREGACIONES.find((a) => a.valor === tipo)?.nombre ?? ''

  return (
    <>
      <button
        ref={boton}
        type="button"
        onClick={alternar}
        aria-haspopup="dialog"
        aria-expanded={posicion !== null}
        aria-label={
          tipo === 'ninguna'
            ? `Elegir total de ${etiqueta}`
            : `${nombre} de ${etiqueta}: ${texto}`
        }
        title={tipo === 'ninguna' ? 'Elegir un total para esta columna' : `${nombre} de ${etiqueta}`}
        className={`flex w-full items-center gap-1 rounded px-1 py-0.5 text-xs transition-colors hover:bg-slate-200/70 ${
          alinearDerecha ? 'justify-end' : 'justify-start'
        }`}
      >
        {tipo === 'ninguna' ? (
          // Sin total elegido no se deja la celda muerta: una flecha
          // tenue dice que ahí se puede tocar. Sin ella, nadie descubre
          // que el pie hace algo.
          <IconChevronDown className="h-3.5 w-3.5 text-slate-300" />
        ) : (
          <>
            <span className="truncate text-[10px] font-medium uppercase tracking-wide text-slate-400">
              {nombre}
            </span>
            <span className="font-bold tabular-nums text-slate-700">{texto || '—'}</span>
          </>
        )}
      </button>

      {posicion && (
        <Menu
          posicion={posicion}
          anclaje={boton}
          etiqueta={etiqueta}
          tipo={tipo}
          opciones={opciones}
          onCerrar={() => setPosicion(null)}
          onElegir={(t) => {
            setPosicion(null)
            onElegir(t)
          }}
        />
      )}
    </>
  )
}

function Menu({
  posicion,
  anclaje,
  etiqueta,
  tipo,
  opciones,
  onCerrar,
  onElegir,
}: {
  posicion: Anclaje
  anclaje: React.RefObject<HTMLButtonElement | null>
  etiqueta: string
  tipo: TipoAgregacion
  opciones: TipoAgregacion[]
  onCerrar: () => void
  onElegir: (tipo: TipoAgregacion) => void
}) {
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

  const lista = AGREGACIONES.filter((a) => opciones.includes(a.valor))

  return createPortal(
    <div
      ref={panel}
      role="dialog"
      aria-label={`Total de ${etiqueta}`}
      style={{
        left: posicion.left,
        top: posicion.top,
        width: posicion.ancho,
        maxHeight: posicion.maxAlto,
      }}
      className="scroll-suave fixed z-50 flex flex-col overflow-y-auto overscroll-contain rounded-xl border border-slate-200 bg-white text-left normal-case shadow-[var(--shadow-raised)]"
    >
      <div className="sticky top-0 border-b border-slate-100 bg-white px-3 py-2">
        <p className="truncate text-xs font-bold uppercase tracking-wide text-slate-400">
          Total de {etiqueta}
        </p>
      </div>

      {lista.map((a) => (
        <button
          key={a.valor}
          type="button"
          onClick={() => onElegir(a.valor)}
          className="flex w-full items-start gap-2 px-3 py-1.5 text-left hover:bg-slate-50"
        >
          <span
            className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border transition-all ${
              tipo === a.valor
                ? 'border-brand-700 bg-brand-700 text-white'
                : 'border-slate-300 bg-white'
            }`}
          >
            {tipo === a.valor && <IconCheck className="h-2.5 w-2.5" />}
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-slate-800">{a.nombre}</span>
            <span className="block text-xs leading-snug text-slate-400">{a.detalle}</span>
          </span>
        </button>
      ))}

      <p className="border-t border-slate-100 px-3 py-2 text-[11px] leading-snug text-slate-400">
        Se calcula sobre las filas que estás viendo: si filtras por un equipo o un lote, el total
        cambia con el filtro.
      </p>
    </div>,
    document.body
  )
}
