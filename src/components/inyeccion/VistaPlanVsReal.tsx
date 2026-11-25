'use client'

/**
 * Plan contra real: por producto y lote, lo que el plan pedía (DDT, fecha, dosis, cantidad) contra lo realmente
 * aplicado (DDT real, fecha, cantidad), con la diferencia en cantidad y en días y su estado (icono + texto). Jerarquía:
 * producto y dosis (grande) > lote, cantidad, DDT y fecha > área, quién y objetivo (pequeño y gris).
 */

import { cantidad } from '@/lib/fertirriego/calculos'
import type { FilaCumplimiento } from '@/lib/inyeccion/cumplimiento'
import { InsigniasCumplimiento } from './InsigniasCumplimiento'

const fechaCorta = (iso: string | null) => (iso ? new Date(`${iso}T12:00:00Z`).toLocaleDateString('es-HN', { day: 'numeric', month: 'short', timeZone: 'UTC' }) : 'sin fecha')

export function VistaPlanVsReal({
  filas,
  producto,
  unidad,
  rotuloLote,
  quien,
}: {
  filas: FilaCumplimiento[]
  producto: (id: string) => string
  unidad: (id: string) => string
  rotuloLote: (lote: string) => string
  quien: (id: string | null) => string | null
}) {
  if (filas.length === 0) {
    return (
      <p className="rounded-xl bg-slate-50 p-4 text-center text-sm text-slate-500 ring-1 ring-inset ring-slate-200" data-plan-vs-real-vacio>
        No hay filas del plan con estos filtros.
      </p>
    )
  }
  return (
    <div className="flex flex-col gap-2" data-plan-vs-real>
      {filas.map((f) => {
        const u = unidad(f.material_id)
        const personas = [...new Set(f.aplicaciones.map((a) => quien(a.registrado_por)).filter(Boolean))].join(', ')
        const objetivos = [...new Set(f.aplicaciones.flatMap((a) => a.objetivos))].join(', ')
        const dosisReal = f.aplicaciones.find((a) => a.dosis_mz !== null)?.dosis_mz ?? null
        return (
          <div key={f.clave} className="rounded-xl bg-white p-3 ring-1 ring-inset ring-slate-200" data-fila-plan-real={f.tiempo}>
            <div className="flex flex-wrap items-baseline justify-between gap-x-3">
              <p className="text-base font-extrabold text-slate-900">{producto(f.material_id)}</p>
              <p className="text-base font-bold tabular-nums text-slate-900">
                {dosisReal !== null ? cantidad(dosisReal) : f.dosis_plan !== null ? cantidad(f.dosis_plan) : '—'} {u}/mz
              </p>
            </div>
            <p className="mt-0.5 text-sm font-semibold text-slate-700">{rotuloLote(f.lote)}</p>
            <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
              <div className="rounded-lg bg-slate-50 p-2 ring-1 ring-inset ring-slate-200" data-columna-plan>
                <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Plan</p>
                <p className="font-semibold tabular-nums text-slate-800">
                  {cantidad(f.cantidad_plan)} {u}
                </p>
                <p className="text-xs text-slate-600">
                  DDT {f.ddt ?? '—'} · {f.fecha_estimada ? '≈ ' : ''}
                  {fechaCorta(f.fecha_plan)}
                </p>
                {f.dosis_plan !== null && (
                  <p className="text-xs text-slate-500">
                    {cantidad(f.dosis_plan)} {u}/mz · {cantidad(f.area_plan)} mz
                  </p>
                )}
              </div>
              <div className="rounded-lg bg-slate-50 p-2 ring-1 ring-inset ring-slate-200" data-columna-real>
                <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Real</p>
                {f.aplicaciones.length === 0 ? (
                  <p className="font-semibold text-slate-500">Sin aplicar</p>
                ) : (
                  <>
                    <p className="font-semibold tabular-nums text-slate-800">
                      {cantidad(f.cantidad_real)} {u}
                    </p>
                    <p className="text-xs text-slate-600">
                      DDT {f.ddt_real ?? '—'} · {fechaCorta(f.fecha_real)}
                    </p>
                    {f.aplicaciones.length > 1 && <p className="text-xs text-slate-500">{f.aplicaciones.length} aplicaciones</p>}
                  </>
                )}
              </div>
            </div>
            <div className="mt-2">
              <InsigniasCumplimiento fila={f} unidad={u} />
            </div>
            {(personas || objetivos) && (
              <p className="mt-1.5 text-xs text-slate-500">
                {personas ? `Aplicó: ${personas}` : ''}
                {personas && objetivos ? ' · ' : ''}
                {objetivos ? `Objetivo: ${objetivos}` : ''}
              </p>
            )}
          </div>
        )
      })}
    </div>
  )
}
