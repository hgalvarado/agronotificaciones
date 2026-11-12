'use client'

/**
 * Lista de casillas con buscador (zonas y estaciones de una persona).
 *
 * Toda la fila es un botón (en el teléfono el blanco es del tamaño del dedo). No guarda nada: recibe lo
 * marcado y avisa los cambios. «Marcar visibles» actúa sobre lo que deja el buscador.
 */

import { useState } from 'react'
import { IconCheck, IconSearch } from '@/components/ui/Icons'

export type OpcionCasillaBuscable = { valor: string; etiqueta: string; detalle?: string | null }

export function ListaCasillasBuscable({
  opciones,
  marcados,
  onCambiar,
  disabled = false,
  vacio = 'No hay opciones.',
  nombre,
}: {
  opciones: OpcionCasillaBuscable[]
  marcados: string[]
  onCambiar: (valores: string[]) => void
  disabled?: boolean
  vacio?: string
  /** Para el buscador y los atributos de prueba: «zonas», «estaciones». */
  nombre: string
}) {
  const [q, setQ] = useState('')
  const texto = q.trim().toLowerCase()
  const visibles = opciones.filter(
    (o) => !texto || o.etiqueta.toLowerCase().includes(texto) || (o.detalle ?? '').toLowerCase().includes(texto)
  )
  const set = new Set(marcados)
  const todasVisibles = visibles.length > 0 && visibles.every((o) => set.has(o.valor))

  return (
    <div className="flex flex-col gap-1.5" data-lista={nombre}>
      {opciones.length > 6 && (
        <div className="relative">
          <IconSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-300" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={`Buscar ${nombre}…`}
            aria-label={`Buscar ${nombre}`}
            className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm placeholder:text-slate-300 focus:border-brand-600 focus:outline-none"
          />
        </div>
      )}
      <div className="max-h-48 overflow-y-auto rounded-xl ring-1 ring-inset ring-slate-200">
        {visibles.length === 0 ? (
          <p className="px-3 py-3 text-sm text-slate-400">{opciones.length ? 'Nada coincide.' : vacio}</p>
        ) : (
          visibles.map((o, i) => {
            const marcada = set.has(o.valor)
            return (
              <button
                key={o.valor}
                type="button"
                role="checkbox"
                aria-checked={marcada}
                disabled={disabled}
                data-opcion={o.etiqueta}
                onClick={() => onCambiar(marcada ? marcados.filter((x) => x !== o.valor) : [...marcados, o.valor])}
                className={`flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition-colors disabled:opacity-50 ${
                  i > 0 ? 'border-t border-slate-100' : ''
                } ${marcada ? 'bg-brand-50' : 'hover:bg-slate-50'}`}
              >
                <span
                  className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                    marcada ? 'border-brand-700 bg-brand-700 text-white' : 'border-slate-300 bg-white'
                  }`}
                >
                  {marcada && <IconCheck className="h-3 w-3" />}
                </span>
                <span className="truncate text-sm text-slate-700">{o.etiqueta}</span>
                {o.detalle && <span className="ml-auto truncate text-xs text-slate-400">{o.detalle}</span>}
              </button>
            )
          })
        )}
      </div>
      {visibles.length > 1 && !disabled && (
        <button
          type="button"
          onClick={() =>
            onCambiar(
              todasVisibles
                ? marcados.filter((v) => !visibles.some((o) => o.valor === v))
                : [...new Set([...marcados, ...visibles.map((o) => o.valor)])]
            )
          }
          className="w-fit rounded-lg px-1 py-0.5 text-xs font-semibold text-slate-400 transition-colors hover:text-slate-900"
        >
          {todasVisibles ? 'Desmarcar las visibles' : 'Marcar las visibles'}
        </button>
      )}
    </div>
  )
}
