'use client'

import { useState } from 'react'
import { CatalogoTable, type CampoCatalogo } from './CatalogoTable'

export type PestanaCatalogo = {
  key: string
  label: string
  tabla: string
  campos: CampoCatalogo[]
  filas: Record<string, string | number | boolean | null>[]
}

export function TabsCatalogos({ pestanas, soloLectura }: { pestanas: PestanaCatalogo[]; soloLectura: boolean }) {
  const [activa, setActiva] = useState(pestanas[0]?.key)
  const pestanaActiva = pestanas.find((p) => p.key === activa)

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-1 overflow-x-auto">
        {pestanas.map((p) => (
          <button
            key={p.key}
            onClick={() => setActiva(p.key)}
            className={`shrink-0 rounded-full px-3 py-1.5 text-sm font-medium ${
              activa === p.key ? 'bg-emerald-700 text-white' : 'bg-slate-100 text-slate-600'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>
      {pestanaActiva && (
        <CatalogoTable
          tabla={pestanaActiva.tabla}
          campos={pestanaActiva.campos}
          filas={pestanaActiva.filas}
          soloLectura={soloLectura}
        />
      )}
    </div>
  )
}
