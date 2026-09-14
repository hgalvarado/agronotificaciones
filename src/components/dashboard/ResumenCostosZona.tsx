'use client'

/**
 * El pie del tablero: en qué se fue el dinero, por zona.
 *
 * Es otra pregunta que la de arriba —no «cómo va el avance» sino «cuánto
 * costó»— y por eso es su propio módulo y no una columna más. Va en
 * acordeón porque la respuesta corta es una cifra por zona; el desglose
 * por lote sólo estorba hasta que alguien lo pide.
 *
 * Sólo dibuja: el reparto lo hace `lib/tablero/agrupacion`.
 */

import { useState } from 'react'
import { Tarjeta } from '@/components/ui/Primitivos'
import { IconChevronRight } from '@/components/ui/Icons'
import { dinero } from '@/lib/tablero/formato'
import type { ResumenZona } from '@/lib/tablero/agrupacion'

export function ResumenCostosZona({ zonas }: { zonas: ResumenZona[] }) {
  const [abierta, setAbierta] = useState<string | null>(null)

  if (zonas.length === 0) return null

  const total = zonas.reduce((a, z) => a + z.gasto, 0)

  return (
    <Tarjeta>
      <div className="flex items-baseline justify-between gap-3 border-b border-slate-100 px-4 py-3">
        <div>
          <h2 className="text-sm font-bold text-slate-900">Resumen de costos por zona</h2>
          <p className="text-xs text-slate-400">
            Con los mismos filtros. Toca una zona para ver en qué lotes se gastó.
          </p>
        </div>
        <p className="shrink-0 text-sm font-bold tabular-nums text-slate-900">{dinero(total)}</p>
      </div>

      <div className="divide-y divide-slate-50">
        {zonas.map((z) => {
          const abierto = abierta === z.zona
          // El porcentaje se calcula sobre el total filtrado: dice qué
          // parte del gasto se lleva cada zona, que es lo que se está
          // preguntando al abrir este módulo.
          const parte = total > 0 ? (z.gasto * 100) / total : 0

          return (
            <div key={z.zona}>
              <button
                type="button"
                onClick={() => setAbierta(abierto ? null : z.zona)}
                className="flex w-full items-center gap-2 px-4 py-3 text-left transition-colors hover:bg-slate-50"
              >
                <IconChevronRight
                  className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${
                    abierto ? 'rotate-90' : ''
                  }`}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-slate-800">
                    {z.zona}
                  </span>
                  <span className="block truncate text-[11px] text-slate-400">
                    {z.encargado ?? 'Sin encargado'} · {z.lotes.length} lote
                    {z.lotes.length === 1 ? '' : 's'}
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="block text-sm font-bold tabular-nums text-slate-900">
                    {dinero(z.gasto)}
                  </span>
                  <span className="block text-[11px] tabular-nums text-slate-400">
                    {parte.toFixed(0)}% del total
                  </span>
                </span>
              </button>

              {abierto && (
                <div className="bg-slate-50/60 px-4 pb-3">
                  <table className="w-full text-sm">
                    <tbody>
                      {z.lotes.map((l) => (
                        <tr key={l.lote_temporada_id} className="border-t border-slate-200/60">
                          <td className="py-1.5 pr-2">
                            <span className="block font-medium text-slate-700">{l.ut}</span>
                            {l.lote_nombre && (
                              <span className="block truncate text-[11px] text-slate-400">
                                {l.lote_nombre}
                              </span>
                            )}
                          </td>
                          <td className="whitespace-nowrap py-1.5 text-right tabular-nums text-slate-700">
                            {dinero(l.gasto)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </Tarjeta>
  )
}
