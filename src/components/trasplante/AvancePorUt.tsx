/**
 * Avance por UT: el cuadre de plan contra real, agrupado por zona, lote y
 * variedad. Sólo dibuja: agrupar es de `servicio` y sumar, de la base.
 */

import { agruparAvancePorZona } from '@/lib/trasplante/servicio'
import { n0, n2, pct } from '@/lib/trasplante/formato'
import type { FilaAvanceUt } from '@/lib/trasplante/tipos'

export function AvancePorUt({ filas }: { filas: FilaAvanceUt[] }) {
  if (filas.length === 0) {
    return (
      <p className="rounded-2xl border border-slate-200 bg-white px-4 py-10 text-center text-sm text-slate-400">
        Todavía no hay plan ni siembra en esta temporada.
      </p>
    )
  }

  const zonas = agruparAvancePorZona(filas)

  return (
    <div className="flex flex-col gap-4">
      {zonas.map(({ zona, encargado, lotes }) => {
        const todas = lotes.flatMap(([, f]) => f)
        const plan = todas.reduce((a, f) => a + Number(f.area_plan), 0)
        const real = todas.reduce((a, f) => a + Number(f.area_real), 0)

        return (
          <section
            key={zona}
            className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[var(--shadow-card)]"
          >
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
              <div>
                <h2 className="text-sm font-bold text-slate-900">{zona}</h2>
                <p className="text-xs text-slate-400">{encargado ?? 'Sin encargado'}</p>
              </div>
              <p className="text-sm tabular-nums text-slate-500">
                {n2(real)} / {n2(plan)} mz
                <span className="ml-2 font-bold text-slate-900">
                  {pct(plan > 0 ? (real / plan) * 100 : null)}
                </span>
              </p>
            </div>

            <div className="scroll-suave overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/60 text-left text-[11px] font-bold uppercase tracking-wide text-slate-500">
                    <th className="px-3 py-2">UT</th>
                    <th className="px-3 py-2">Lote</th>
                    <th className="px-3 py-2">Ciclo</th>
                    <th className="px-3 py-2">Variedad</th>
                    <th className="px-3 py-2 text-right">Plan</th>
                    <th className="px-3 py-2 text-right">Ejecutado</th>
                    <th className="px-3 py-2 text-right">%</th>
                    <th className="px-3 py-2 text-right">Plantas</th>
                    <th className="px-3 py-2">Última siembra</th>
                  </tr>
                </thead>
                <tbody>
                  {lotes.map(([ut, deEsteLote]) =>
                    deEsteLote.map((f, i) => (
                      <tr key={`${ut}-${f.ciclo}-${f.variedad}`} className="border-b border-slate-50">
                        <td className="whitespace-nowrap px-3 py-1.5 font-semibold text-slate-800">
                          {i === 0 ? ut : ''}
                        </td>
                        <td className="px-3 py-1.5 text-slate-500">
                          {i === 0 ? (f.lote_nombre ?? '—') : ''}
                        </td>
                        <td className="px-3 py-1.5 text-slate-500">{f.ciclo}</td>
                        <td className="px-3 py-1.5 text-slate-700">{f.variedad}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-slate-600">
                          {n2(f.area_plan)}
                        </td>
                        <td className="px-3 py-1.5 text-right font-semibold tabular-nums text-slate-900">
                          {n2(f.area_real)}
                        </td>
                        <td className="px-3 py-1.5 text-right tabular-nums">
                          <Porcentaje valor={f.pct} />
                        </td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-slate-500">
                          {n0(f.plantas)}
                        </td>
                        <td className="whitespace-nowrap px-3 py-1.5 text-slate-500">
                          {f.ultima_fecha ?? '—'}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )
      })}
    </div>
  )
}

export function Porcentaje({ valor }: { valor: number | null }) {
  if (valor === null || valor === undefined) return <span className="text-slate-300">—</span>
  const v = Number(valor)
  const tono =
    v >= 99
      ? 'bg-emerald-100 text-emerald-800'
      : v >= 50
        ? 'bg-brand-50 text-brand-800'
        : 'bg-amber-100 text-amber-800'
  return (
    <span className={`rounded px-1.5 py-0.5 text-xs font-bold tabular-nums ${tono}`}>
      {v.toFixed(0)}%
    </span>
  )
}
