'use client'

import { useState } from 'react'
import { CatalogoTable, type CampoCatalogo } from './CatalogoTable'
import type { RelacionCatalogo } from './ImportarExcel'

export type PestanaCatalogo = {
  key: string
  label: string
  tabla: string
  campos: CampoCatalogo[]
  filas: Record<string, string | number | boolean | null>[]
  /** Campo natural con el que el importador reconoce filas repetidas. */
  clave?: string
  /** Vinculaciones de muchos a muchos que el importador puede cargar. */
  relaciones?: RelacionCatalogo[]
}

export function TabsCatalogos({
  pestanas,
  soloLectura,
}: {
  pestanas: PestanaCatalogo[]
  soloLectura: boolean
}) {
  const [activa, setActiva] = useState(pestanas[0]?.key)
  const pestanaActiva = pestanas.find((p) => p.key === activa)

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {pestanas.map((p) => (
          <button
            key={p.key}
            onClick={() => setActiva(p.key)}
            className={`shrink-0 rounded-full px-3.5 py-2 text-sm font-semibold transition-all ${
              activa === p.key
                ? 'bg-brand-700 text-white shadow-[var(--shadow-raised)]'
                : 'bg-white text-slate-500 ring-1 ring-inset ring-slate-200 hover:text-slate-900'
            }`}
          >
            {p.label}
            <span className="ml-1.5 text-xs opacity-60">{p.filas.length}</span>
          </button>
        ))}
      </div>

      {pestanaActiva && (
        <CatalogoTable
          key={pestanaActiva.key}
          tabla={pestanaActiva.tabla}
          titulo={pestanaActiva.label}
          campos={pestanaActiva.campos}
          filas={pestanaActiva.filas}
          clave={pestanaActiva.clave}
          relaciones={pestanaActiva.relaciones}
          soloLectura={soloLectura}
        />
      )}
    </div>
  )
}
