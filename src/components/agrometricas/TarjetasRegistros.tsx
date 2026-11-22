'use client'

/** Vista rápida: tarjetas por día y turno con los 5 parámetros clave y su sparkline por DDT del turno. */

import { useMemo } from 'react'
import { Insignia, Tarjeta } from '@/components/ui/Primitivos'
import { ayerIso, hoyIso } from '@/lib/fechas/zona'
import { GRUPOS, agruparPorDia, grupoFuera, indexarSparks, valorGrupo, type Registro } from '@/lib/agrometricas/registrosPura'
import { GraficaLinea } from './GraficaLinea'

export function TarjetasRegistros({ registros, onAbrir }: { registros: Registro[]; onAbrir: (r: Registro) => void }) {
  const grupos = useMemo(() => agruparPorDia(registros, hoyIso(), ayerIso()), [registros])
  const sparks = useMemo(() => indexarSparks(registros), [registros])

  return (
    <div className="flex flex-col gap-4" data-tarjetas>
      {grupos.map((g) => (
        <section key={g.dia} data-dia={g.dia} className="flex flex-col gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{g.etiqueta} · {g.registros.length}</h2>
          <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
            {g.registros.map((r) => (
              <button key={r.id} type="button" onClick={() => onAbrir(r)} data-registro={r.id}
                className="block rounded-2xl text-left transition active:scale-[.99] focus-visible:outline-2 focus-visible:outline-emerald-600">
                <Tarjeta className="h-full p-3.5 hover:border-emerald-300">
                  <div className="flex items-start justify-between gap-2">
                    <p className="min-w-0 text-sm font-semibold text-slate-900">
                      {r.turno}{r.ddt != null ? ` · DDT ${r.ddt}` : ''}
                    </p>
                    <span className="flex shrink-0 items-center gap-1.5">
                      {r.fuera_rango?.length > 0 && <Insignia tono="rojo">Fuera de rango</Insignia>}
                      {r.puede_editar && <Insignia tono="gris">Editable</Insignia>}
                    </span>
                  </div>
                  <p className="mb-2 text-xs text-slate-500">
                    {[r.estacion, r.zona, r.creado_por_nombre ? String(r.creado_por_nombre) : ''].filter(Boolean).join(' · ')}
                  </p>
                  <ul className="flex flex-col divide-y divide-slate-100">
                    {GRUPOS.map((gr) => {
                      const v = valorGrupo(r, gr)
                      const puntos = sparks.get(r.turno)?.[gr.clave] ?? []
                      const fuera = grupoFuera(r, gr)
                      return (
                        <li key={gr.clave} className="flex min-h-11 items-center justify-between gap-2 py-1">
                          <span className="text-sm text-slate-600">{gr.etiqueta}</span>
                          <span className="flex items-center gap-2">
                            {puntos.length > 1 && (
                              <GraficaLinea compacta etiqueta={`${gr.etiqueta} por DDT, turno ${r.turno}`}
                                series={[{ campo: gr.campos[0].clave, etiqueta: gr.etiqueta, puntos: puntos.map((p) => ({ x: p.x, y: p.y, fecha: '', fuera: false })) }]} />
                            )}
                            <span className={`min-w-14 text-right text-sm font-semibold tabular-nums ${fuera ? 'text-red-700' : 'text-slate-900'}`}>
                              {v === null ? '—' : `${v}${gr.unidad ? ` ${gr.unidad}` : ''}`}
                            </span>
                          </span>
                        </li>
                      )
                    })}
                  </ul>
                </Tarjeta>
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
