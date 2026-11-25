'use client'

/** Chips de categoría con banda de color (como en el plan foliar de referencia) para filtrar por tipo de producto. */

import { BandaLateral } from '@/components/ui/Banda'
import type { CategoriaInyeccion } from '@/lib/inyeccion/estado'

const PUNTOS = ['bg-emerald-500', 'bg-sky-500', 'bg-amber-500', 'bg-violet-500', 'bg-rose-500', 'bg-teal-500', 'bg-orange-500', 'bg-indigo-500']

export const etiquetaCategoria = (c: CategoriaInyeccion) => c.etiqueta ?? c.categoria ?? c.clave

/** Color estable del punto de una categoría según su lugar en el catálogo. */
export const puntoCategoria = (categorias: CategoriaInyeccion[], clave: string | null) => {
  const i = clave ? categorias.findIndex((c) => c.clave === clave) : -1
  return i < 0 ? 'bg-slate-400' : PUNTOS[i % PUNTOS.length]
}

export function ChipsCategoria({
  categorias,
  elegidas,
  onCambiar,
  disponibles,
}: {
  categorias: CategoriaInyeccion[]
  elegidas: string[]
  onCambiar: (claves: string[]) => void
  /** Claves que sí aparecen en los datos (las demás no se muestran). */
  disponibles: Set<string>
}) {
  const lista = categorias.filter((c) => disponibles.has(c.clave))
  if (lista.length < 2) return null
  return (
    <div className="flex flex-wrap gap-x-1.5" role="group" aria-label="Categoría del producto" data-chips-categoria>
      {lista.map((c) => {
        const on = elegidas.includes(c.clave)
        return (
          <button
            key={c.clave}
            type="button"
            aria-pressed={on}
            data-chip-categoria={c.clave}
            onClick={() => onCambiar(on ? elegidas.filter((x) => x !== c.clave) : [...elegidas, c.clave])}
            className="inline-flex min-h-11 items-center"
          >
            <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${on ? 'bg-slate-100 text-slate-900 ring-slate-500' : 'text-slate-700 ring-slate-300'}`}>
              <span className="flex h-3 w-1"><BandaLateral clase={puntoCategoria(categorias, c.clave)} /></span>
              {etiquetaCategoria(c)}
            </span>
          </button>
        )
      })}
    </div>
  )
}
