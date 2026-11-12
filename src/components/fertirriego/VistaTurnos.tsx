'use client'

/**
 * «Por turno»: la temporada y el ciclo de cada turno de la estación, y sus días: plan contra lo aplicado por
 * producto (lo pendiente de enviar aparte) y las horas de la bitácora de riego. Desde cada día se aplica o se
 * completan las horas.
 */

import { useState } from 'react'
import { hoyIso, sumarDias } from '@/lib/fechas/zona'
import { cantidad, diasDelTurno } from '@/lib/fertirriego/calculos'
import type { EstadoCampo, Estacion, Operacion } from '@/lib/fertirriego/tipos'

const DIA = new Intl.DateTimeFormat('es-HN', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' })

export function VistaTurnos({
  estado,
  cola,
  estacion,
  onAplicar,
  onHoras,
}: {
  estado: EstadoCampo
  cola: Operacion[]
  estacion: Estacion
  onAplicar: (turnoId: string, fecha: string) => void
  onHoras: (turnoId: string, fecha: string) => void
}) {
  const turnos = estado.turnos.filter((t) => t.estacion_id === estacion.id)
  const [abierto, setAbierto] = useState<string | null>(turnos.length === 1 ? turnos[0].id : null)
  const [todo, setTodo] = useState(false)
  const material = (id: string) => estado.materiales.find((m) => m.id === id)
  const hoy = hoyIso()

  const grupos = new Map<string, typeof turnos>()
  for (const t of turnos) {
    const k = `${t.temporada} · ${t.ciclo ?? 'sin ciclo'}`
    grupos.set(k, [...(grupos.get(k) ?? []), t])
  }

  if (turnos.length === 0) {
    return <p className="py-8 text-center text-sm text-slate-400">La estación no tiene turnos activos publicados desde AGL.</p>
  }

  return (
    <div className="flex flex-col gap-4">
      {[...grupos.entries()].map(([grupo, lista]) => (
        <div key={grupo}>
          <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-400">{grupo}</p>
          <div className="flex flex-col gap-2">
            {lista.map((t) => {
              const dias = diasDelTurno(estado, cola, t.id).filter((d) => todo || (d.fecha >= sumarDias(hoy, -14) && d.fecha <= sumarDias(hoy, 3)))
              return (
                <div key={t.id} className="overflow-hidden rounded-xl bg-white ring-1 ring-inset ring-slate-200" data-turno={t.turno}>
                  <button type="button" onClick={() => setAbierto(abierto === t.id ? null : t.id)} aria-expanded={abierto === t.id} className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left">
                    <span>
                      <span className="block text-sm font-bold text-slate-800">{t.turno}</span>
                      <span className="block text-[11px] text-slate-500">
                        Siembra {t.fecha_siembra ?? '—'} · {t.area_mz ? `${cantidad(t.area_mz)} mz` : ''} {t.orden_sap ? `· orden ${t.orden_sap}` : ''}
                      </span>
                    </span>
                    <span className="text-xs text-slate-400">{abierto === t.id ? '▾' : '▸'}</span>
                  </button>
                  {abierto === t.id && (
                    <div className="border-t border-slate-100">
                      {dias.length === 0 && <p className="px-3 py-3 text-sm text-slate-400">Sin plan ni aplicaciones en estos días.</p>}
                      {dias.map((d) => {
                        const mats = new Set([...d.plan.keys(), ...d.aplicado.keys(), ...d.pendiente.keys()])
                        return (
                          <div key={d.fecha} className={`border-b border-slate-50 px-3 py-2 ${d.fecha === hoy ? 'bg-brand-50/50' : ''}`} data-dia-turno={d.fecha}>
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <p className="text-xs font-bold text-slate-700">
                                {DIA.format(new Date(`${d.fecha}T12:00:00Z`))}
                                {d.ddt !== null && <span className="font-normal text-slate-400"> · DDT {d.ddt}</span>}
                              </p>
                              <span className="flex gap-2">
                                {d.fecha <= hoy && estacion.permisos.aplicar && (
                                  <>
                                    <button type="button" onClick={() => onAplicar(t.id, d.fecha)} className="text-xs font-bold text-brand-700" data-aplicar-dia>
                                      Aplicar
                                    </button>
                                    <button type="button" onClick={() => onHoras(t.id, d.fecha)} className="text-xs font-bold text-slate-600" data-horas-dia>
                                      Horas
                                    </button>
                                  </>
                                )}
                              </span>
                            </div>
                            <ul className="mt-1 text-xs">
                              {[...mats].map((m) => {
                                const p = d.plan.get(m) ?? 0
                                const a = d.aplicado.get(m) ?? 0
                                const pe = d.pendiente.get(m) ?? 0
                                const total = a + pe
                                const ok = p > 0 && Math.abs(total - p) / p <= 0.05
                                return (
                                  <li key={m} className="flex justify-between gap-2">
                                    <span className="truncate text-slate-600">{material(m)?.descripcion ?? '—'}</span>
                                    <span className="shrink-0 tabular-nums">
                                      <span className="text-slate-400">plan {cantidad(p)}</span>
                                      {' · '}
                                      <span className={total === 0 ? 'text-slate-400' : ok ? 'font-semibold text-brand-700' : 'font-semibold text-amber-700'}>
                                        aplicado {cantidad(a)}
                                        {pe ? ` (+${cantidad(pe)} por enviar)` : ''}
                                      </span>
                                    </span>
                                  </li>
                                )
                              })}
                            </ul>
                            {(d.horasRiego !== null || d.horasFertilizacion !== null) && (
                              <p className="mt-0.5 text-[11px] text-slate-500">
                                Horas: fertilización {d.horasFertilizacion ?? '—'} · riego {d.horasRiego ?? '—'}
                              </p>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      ))}
      <button type="button" onClick={() => setTodo((v) => !v)} className="w-fit text-xs font-semibold text-slate-500 underline">
        {todo ? 'Ver solo las últimas dos semanas' : 'Ver todo el ciclo'}
      </button>
    </div>
  )
}
