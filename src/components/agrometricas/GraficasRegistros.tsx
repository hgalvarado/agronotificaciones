'use client'

/**
 * Pestaña «Gráficas»: por turno elegido, una gráfica por parámetro clave (líneas por DDT, una línea por lectura).
 * Deja un espacio para el intervalo de confianza (IC) que vendrá después: `intervalos` por clave de grupo.
 */

import { useMemo, useState } from 'react'
import { Insignia, Tarjeta } from '@/components/ui/Primitivos'
import { SelectorMultiple } from '@/components/ui/SelectorMultiple'
import { GRUPOS, seriesPorDdt, turnosDe, type IntervaloPunto, type Registro } from '@/lib/agrometricas/registrosPura'
import { GraficaLinea, colorLeyenda } from './GraficaLinea'

export function GraficasRegistros({ registros, intervalos = {} }: {
  registros: Registro[]
  /** Futuro: franja del IC por grupo (`ce`, `ph`, `tensiometros`, `cloro`, `horas`) y turno. */
  intervalos?: Record<string, IntervaloPunto[]>
}) {
  const turnos = useMemo(() => turnosDe(registros), [registros])
  const [sel, setSel] = useState<string[]>([])
  const validos = sel.filter((t) => turnos.some((x) => x.turno === t))
  const elegidos = validos.length ? validos : turnos.slice(0, 1).map((t) => t.turno)

  if (!turnos.length) return <p className="text-sm text-slate-500">No hay registros para graficar con estos filtros.</p>

  return (
    <div className="flex flex-col gap-3" data-graficas>
      <SelectorMultiple etiqueta="Turno de las gráficas" valores={validos} onCambiar={setSel}
        opciones={turnos.map((t) => ({ valor: t.turno, etiqueta: `${t.turno} (${t.n})` }))} />
      <p className="text-xs text-slate-500">Mostrando: {elegidos.join(', ')}. Punto rojo = fuera de rango al guardar. Línea punteada = 24 cm.</p>
      {elegidos.map((turno) => {
        const delTurno = registros.filter((r) => r.turno === turno)
        return (
          <section key={turno} className="flex flex-col gap-3" data-turno-grafica={turno}>
            <h2 className="text-sm font-semibold text-slate-900">{turno}</h2>
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              {GRUPOS.map((g) => {
                const { series, sinDdt } = seriesPorDdt(delTurno, g)
                if (!series.length && g.clave === 'horas') return null
                return (
                  <Tarjeta key={g.clave} className="p-3.5">
                    <div data-grafica={g.clave}>
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <h3 className="text-sm font-semibold text-slate-800">{g.etiqueta}{g.unidad ? ` (${g.unidad})` : ''}</h3>
                        {(intervalos[`${g.clave}:${turno}`] ?? intervalos[g.clave])?.length
                          ? <Insignia tono="azul">Con intervalo</Insignia>
                          : <span className="text-xs text-slate-400" data-ic-pendiente>Intervalo (IC): próximamente</span>}
                      </div>
                      {series.length ? (
                        <>
                          <GraficaLinea series={series} unidad={g.unidad} etiqueta={`${g.etiqueta} por DDT, turno ${turno}`}
                            intervalo={intervalos[`${g.clave}:${turno}`] ?? intervalos[g.clave] ?? []} />
                          <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                            {series.map((s) => (
                              <li key={s.campo} className="flex items-center gap-1.5 text-xs text-slate-600">
                                <svg width="10" height="10" aria-hidden><circle cx="5" cy="5" r="4" className={colorLeyenda(s.campo)} /></svg>{s.etiqueta}
                              </li>
                            ))}
                          </ul>
                        </>
                      ) : <p className="text-sm text-slate-400">Sin lecturas.</p>}
                      {sinDdt > 0 && <p className="mt-1 text-xs text-amber-700">{sinDdt} registros sin DDT no se grafican.</p>}
                    </div>
                  </Tarjeta>
                )
              })}
            </div>
          </section>
        )
      })}
    </div>
  )
}
