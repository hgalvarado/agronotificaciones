'use client'

/**
 * Los planes con su costo en la moneda que se pida ver.
 *
 * Arriba, la lectura: una tarjeta por plan con el costo convertido según
 * el interruptor. Abajo, el catálogo editable: se escribe el costo en su
 * moneda (`costo_origen` + `moneda`) y la base calcula el lempira.
 */

import { CatalogoTable } from '@/components/catalogos/CatalogoTable'
import { Tarjeta } from '@/components/ui/Primitivos'
import { costoEn, textoMoneda, type Moneda, type PlanTelecom } from '@/lib/telecom/tipos'
import { ToggleMoneda } from './Moneda'

export function PanelPlanes({
  planes,
  moneda,
  onMoneda,
  tasa,
  puedeEditar,
  puedeEliminar,
}: {
  planes: PlanTelecom[]
  moneda: Moneda
  onMoneda: (m: Moneda) => void
  tasa: number | null
  puedeEditar: boolean
  puedeEliminar: boolean
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-sm font-bold text-slate-900">Planes</h2>
          <p className="text-xs text-slate-400">
            Lo que cuesta cada línea al mes. Se escribe en su moneda; el lempira lo calcula la base.
          </p>
        </div>
        <ToggleMoneda valor={moneda} onCambiar={onMoneda} tasa={tasa} />
      </div>

      {planes.length > 0 && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {planes.map((p) => (
            <Tarjeta key={p.id} className="flex flex-col gap-0.5 px-3 py-2.5">
              <span className="truncate text-xs font-semibold text-slate-600">{p.nombre}</span>
              <span className="text-lg font-bold tabular-nums tracking-tight text-slate-900">
                {textoMoneda(moneda, costoEn(moneda, p.costo_mensual, p, tasa))}
              </span>
              <span className="text-[11px] text-slate-400">
                Escrito en {p.moneda ?? 'HNL'}
                {p.es_retencion ? ' · retención' : ''}
              </span>
            </Tarjeta>
          ))}
        </div>
      )}

      <CatalogoTable
        tabla="telecom_planes"
        titulo="Planes"
        clave="nombre"
        soloLectura={!puedeEditar}
        permisos={{ editar: puedeEditar, eliminar: puedeEliminar }}
        campos={[
          { key: 'nombre', label: 'Plan', tipo: 'text', requerido: true },
          {
            key: 'moneda',
            label: 'Moneda',
            tipo: 'select',
            opciones: [
              { value: 'HNL', label: 'HNL' },
              { value: 'USD', label: 'USD' },
            ],
          },
          { key: 'costo_origen', label: 'Costo (su moneda)', tipo: 'number' },
          { key: 'costo_mensual', label: 'Costo L (calculado)', tipo: 'number' },
          { key: 'proveedor', label: 'Proveedor', tipo: 'text' },
          { key: 'es_retencion', label: 'Es Plan $1', tipo: 'checkbox' },
          { key: 'activo', label: 'Activo', tipo: 'checkbox' },
        ]}
        filas={planes as unknown as Record<string, string | number | boolean | null>[]}
      />
      <p className="px-1 text-[11px] text-slate-400">
        Si se corrige directamente el «Costo L», el plan pasa a lempiras con ese valor: lo último
        que se escribe manda.
      </p>
    </div>
  )
}
