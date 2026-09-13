'use client'

/**
 * Liquidación de plántulas: lo que el vivero facturó contra lo que la
 * siembra diaria consumió, por variedad.
 *
 * Lo pendiente puede salir NEGATIVO y eso no es un error de la pantalla:
 * significa que en campo se sembraron más plántulas de las facturadas, y
 * es precisamente lo que hay que ver antes de cerrar la factura.
 */

import { Tarjeta } from '@/components/ui/Primitivos'
import { n0, n2, pct } from '@/lib/trasplante/formato'
import type { FilaLiquidacion } from '@/lib/trasplante/tipos'

export function PanelLiquidacion({ filas }: { filas: FilaLiquidacion[] }) {
  if (filas.length === 0) {
    return (
      <Tarjeta className="px-4 py-8 text-center text-sm text-slate-400">
        Sin recepciones ni siembras que liquidar en esta temporada.
      </Tarjeta>
    )
  }

  const total = filas.reduce(
    (a, f) => ({
      facturadas: a.facturadas + Number(f.facturadas),
      enviadas: a.enviadas + Number(f.enviadas),
      consumidas: a.consumidas + Number(f.consumidas),
      pendientes: a.pendientes + Number(f.pendientes),
      costo: a.costo + Number(f.costo_total),
    }),
    { facturadas: 0, enviadas: 0, consumidas: 0, pendientes: 0, costo: 0 }
  )
  const pctTotal = total.facturadas > 0 ? (total.consumidas / total.facturadas) * 100 : null

  return (
    <Tarjeta className="overflow-hidden">
      <div className="border-b border-slate-100 px-4 py-3">
        <h2 className="text-sm font-semibold text-slate-900">Liquidación de plántulas</h2>
        <p className="text-xs text-slate-400">
          Facturadas por el vivero contra las consumidas en la siembra diaria.
        </p>
      </div>

      <div className="scroll-suave overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50/60 text-left text-[11px] font-bold uppercase tracking-wide text-slate-500">
              <th className="px-3 py-2">Variedad</th>
              <th className="px-3 py-2">Cultivo</th>
              <th className="px-3 py-2 text-right">Enviadas</th>
              <th className="px-3 py-2 text-right">Facturadas</th>
              <th className="px-3 py-2 text-right">Consumidas</th>
              <th className="px-3 py-2 text-right">Pendientes</th>
              <th className="px-3 py-2 text-right">% Liquidación</th>
              <th className="px-3 py-2 text-right">Costo</th>
            </tr>
          </thead>
          <tbody>
            {filas.map((f) => (
              <tr key={f.variedad} className="border-b border-slate-50 last:border-0">
                <td className="px-3 py-1.5 font-semibold text-slate-800">{f.variedad}</td>
                <td className="px-3 py-1.5 text-slate-500">{f.cultivo ?? '—'}</td>
                <td className="px-3 py-1.5 text-right tabular-nums text-slate-500">
                  {n0(f.enviadas)}
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums text-slate-700">
                  {n0(f.facturadas)}
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums text-slate-700">
                  {n0(f.consumidas)}
                </td>
                <td
                  className={`px-3 py-1.5 text-right font-semibold tabular-nums ${
                    Number(f.pendientes) < 0 ? 'text-red-700' : 'text-slate-900'
                  }`}
                >
                  {n0(f.pendientes)}
                </td>
                <td className="px-3 py-1.5 text-right">
                  <Semaforo valor={f.pct === null ? null : Number(f.pct)} />
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums text-slate-600">
                  {n2(f.costo_total)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-slate-200 bg-slate-50/80 font-bold text-slate-900">
              <td className="px-3 py-2" colSpan={2}>
                Total
              </td>
              <td className="px-3 py-2 text-right tabular-nums">{n0(total.enviadas)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{n0(total.facturadas)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{n0(total.consumidas)}</td>
              <td
                className={`px-3 py-2 text-right tabular-nums ${
                  total.pendientes < 0 ? 'text-red-700' : ''
                }`}
              >
                {n0(total.pendientes)}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">{pct(pctTotal)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{n2(total.costo)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {filas.some((f) => Number(f.pendientes) < 0) && (
        <p className="border-t border-slate-100 bg-amber-50/60 px-4 py-2 text-xs text-amber-800">
          Las variedades en rojo tienen más plántulas sembradas que facturadas: falta registrar esa
          recepción o hay una siembra sobrecontada.
        </p>
      )}
    </Tarjeta>
  )
}

function Semaforo({ valor }: { valor: number | null }) {
  if (valor === null) return <span className="text-slate-300">—</span>
  const tono =
    valor > 105
      ? 'bg-red-100 text-red-800'
      : valor >= 95
        ? 'bg-emerald-100 text-emerald-800'
        : valor >= 60
          ? 'bg-brand-50 text-brand-800'
          : 'bg-amber-100 text-amber-800'
  return (
    <span className={`rounded px-1.5 py-0.5 text-xs font-bold tabular-nums ${tono}`}>
      {pct(valor)}
    </span>
  )
}
