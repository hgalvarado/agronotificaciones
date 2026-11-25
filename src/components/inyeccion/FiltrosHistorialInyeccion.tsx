'use client'

/**
 * Filtros del historial de Inyección, contraídos por defecto con el contador de activos (mismo patrón que los filtros de
 * «Registros de la temporada» de AgroMétricas). Selectores con búsqueda y «Única / Varios». Solo presentación.
 */

import { useState } from 'react'
import { Campo, Entrada, Tarjeta } from '@/components/ui/Primitivos'
import { SelectorMultiple, type OpcionSelector } from '@/components/ui/SelectorMultiple'
import { ETIQUETAS_CUMPLIMIENTO, type EtiquetaCumplimiento } from '@/lib/inyeccion/cumplimiento'
import { SIN_FILTROS_INY, filtrosActivosIny, type FiltrosInyeccion } from '@/lib/inyeccion/filtrosInyeccion'

export function FiltrosHistorialInyeccion({
  filtros,
  onCambiar,
  productos,
  lotes,
  personas,
}: {
  filtros: FiltrosInyeccion
  onCambiar: (f: FiltrosInyeccion) => void
  productos: OpcionSelector[]
  lotes: OpcionSelector[]
  personas: OpcionSelector[]
}) {
  const [abierto, setAbierto] = useState(false) // contraídos por defecto: no ocupan pantalla
  const activos = filtrosActivosIny(filtros)
  const poner = (c: Partial<FiltrosInyeccion>) => onCambiar({ ...filtros, ...c })
  return (
    <Tarjeta className="p-3" >
      <button
        type="button"
        onClick={() => setAbierto((a) => !a)}
        aria-expanded={abierto}
        data-filtros-iny-alternar
        className="flex min-h-11 w-full items-center justify-between gap-2 text-left"
      >
        <span className="flex items-center gap-2 text-base font-bold text-slate-900">
          Filtros
          {activos > 0 && (
            <span className="rounded-full bg-brand-600 px-2 py-0.5 text-xs font-bold text-white" data-filtros-iny-activos>
              {activos} activo{activos === 1 ? '' : 's'}
            </span>
          )}
        </span>
        <span className="text-sm font-semibold text-brand-700">{abierto ? 'Ocultar ▲' : 'Mostrar ▼'}</span>
      </button>
      <div hidden={!abierto} className="mt-3 flex flex-col gap-3" data-filtros-iny>
        <div className="grid grid-cols-2 gap-3">
          <Campo etiqueta="Aplicado desde">
            <Entrada type="date" value={filtros.desde} max={filtros.hasta || undefined} onChange={(e) => poner({ desde: e.target.value })} data-filtro-iny-desde />
          </Campo>
          <Campo etiqueta="Aplicado hasta">
            <Entrada type="date" value={filtros.hasta} min={filtros.desde || undefined} onChange={(e) => poner({ hasta: e.target.value })} data-filtro-iny-hasta />
          </Campo>
          <Campo etiqueta="DDT desde">
            <Entrada inputMode="numeric" placeholder="Ej. 3" value={filtros.ddtDesde} onChange={(e) => poner({ ddtDesde: e.target.value.replace(/[^\d-]/g, '') })} data-filtro-iny-ddt-desde />
          </Campo>
          <Campo etiqueta="DDT hasta">
            <Entrada inputMode="numeric" placeholder="Ej. 20" value={filtros.ddtHasta} onChange={(e) => poner({ ddtHasta: e.target.value.replace(/[^\d-]/g, '') })} data-filtro-iny-ddt-hasta />
          </Campo>
        </div>
        <SelectorMultiple etiqueta="Producto" opciones={productos} valores={filtros.productos} onCambiar={(v) => poner({ productos: v })} />
        <SelectorMultiple etiqueta="Lote" opciones={lotes} valores={filtros.lotes} onCambiar={(v) => poner({ lotes: v })} />
        <SelectorMultiple
          etiqueta="Estado del cumplimiento"
          opciones={ETIQUETAS_CUMPLIMIENTO.map(([valor, etiqueta]) => ({ valor, etiqueta }))}
          valores={filtros.estados}
          onCambiar={(v) => poner({ estados: v as EtiquetaCumplimiento[] })}
        />
        <SelectorMultiple etiqueta="Quién aplicó" opciones={personas} valores={filtros.personas} onCambiar={(v) => poner({ personas: v })} />
        {activos > 0 && (
          <button
            type="button"
            data-filtros-iny-quitar
            className="inline-flex min-h-11 items-center self-start px-2 text-sm font-semibold text-brand-700 underline"
            onClick={() => onCambiar(SIN_FILTROS_INY)}
          >
            Quitar filtros
          </button>
        )}
      </div>
    </Tarjeta>
  )
}
