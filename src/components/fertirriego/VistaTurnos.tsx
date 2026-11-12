'use client'

/**
 * «Por turno»: la temporada y el ciclo de cada turno de la estación y, por turno, una tarjeta por DDT del plan:
 * DDT plan / DDT real, fecha plan / fecha real y, por producto, Plan · Real · Variación (lo pendiente de enviar
 * cuenta en lo real y se marca). Las aplicaciones extra (o viejas sin DDT del plan) van en su propia tarjeta.
 * Desde cada tarjeta se aplica o se completan las horas. Piloto 1, punto 7 (pensado para un teléfono de 360 px).
 */

import { useState } from 'react'
import { hoyIso, sumarDias } from '@/lib/fechas/zona'
import { cantidad } from '@/lib/fertirriego/calculos'
import { aplicacionesDelTurno, ddtsDelTurno, tarjetasDelTurno, type ProductoTarjeta, type TarjetaDdt } from '@/lib/fertirriego/ddt'
import type { EstadoCampo, Estacion, Material, Operacion } from '@/lib/fertirriego/tipos'

const DIA = new Intl.DateTimeFormat('es-HN', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' })
const dia = (iso: string) => DIA.format(new Date(`${iso}T12:00:00Z`))

/** Variación dentro del ±5 % del plan = bien (verde); fuera = ámbar; sin plan = gris. */
function tonoVariacion(p: ProductoTarjeta): string {
  if (p.plan <= 0) return 'text-slate-500'
  if (p.real + p.pendiente === 0) return 'text-slate-400'
  return Math.abs(p.variacion) / p.plan <= 0.05 ? 'text-brand-700' : 'text-amber-700'
}

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
  const material = (id: string): Material | undefined => estado.materiales.find((m) => m.id === id)
  const hoy = hoyIso()
  const desde = sumarDias(hoy, -14)
  const hasta = sumarDias(hoy, 3)

  const grupos = new Map<string, typeof turnos>()
  for (const t of turnos) {
    const k = `${t.temporada} · ${t.ciclo ?? 'sin ciclo'}`
    grupos.set(k, [...(grupos.get(k) ?? []), t])
  }

  if (turnos.length === 0) {
    return <p className="py-8 text-center text-sm text-slate-400">La estación no tiene turnos activos publicados desde AGL.</p>
  }

  /** Fertilizantes (los del análisis) primero; después por nombre. */
  const ordenarProductos = (ps: ProductoTarjeta[]) =>
    [...ps].sort(
      (a, b) =>
        Number(Boolean(material(b.material_id)?.analisis)) - Number(Boolean(material(a.material_id)?.analisis)) ||
        (material(a.material_id)?.descripcion ?? '').localeCompare(material(b.material_id)?.descripcion ?? '', 'es')
    )

  const enVentana = (c: TarjetaDdt) => todo || (c.fecha >= desde && c.fecha <= hasta) || c.fechasReales.some((f) => f >= desde && f <= hasta)

  return (
    <div className="flex flex-col gap-4">
      {[...grupos.entries()].map(([grupo, lista]) => (
        <div key={grupo}>
          <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-400">{grupo}</p>
          <div className="flex flex-col gap-2">
            {lista.map((t) => {
              const tarjetas = tarjetasDelTurno(ddtsDelTurno(estado.plan, t.id), aplicacionesDelTurno(estado.aplicaciones, cola, t.id, t.fecha_siembra)).filter(enVentana)
              const horasDe = (fecha: string) => estado.bitacora_riego.find((b) => b.turno_ciclo_id === t.id && b.fecha === fecha) ?? null
              return (
                <div key={t.id} className="overflow-hidden rounded-xl bg-white ring-1 ring-inset ring-slate-200" data-turno={t.turno}>
                  <button type="button" onClick={() => setAbierto(abierto === t.id ? null : t.id)} aria-expanded={abierto === t.id} className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left">
                    <span className="min-w-0">
                      <span className="block text-sm font-bold text-slate-800">{t.turno}</span>
                      <span className="block truncate text-[11px] text-slate-500">
                        Siembra {t.fecha_siembra ?? '—'} {t.area_mz ? `· ${cantidad(t.area_mz)} mz` : ''} {t.orden_sap ? `· orden ${t.orden_sap}` : ''}
                      </span>
                    </span>
                    <span className="text-xs text-slate-400">{abierto === t.id ? '▾' : '▸'}</span>
                  </button>
                  {abierto === t.id && (
                    <div className="flex flex-col gap-2 border-t border-slate-100 bg-slate-50/60 p-2">
                      {tarjetas.length === 0 && <p className="px-1 py-2 text-sm text-slate-400">Sin plan ni aplicaciones en estos días.</p>}
                      {tarjetas.map((c) => {
                        const fechaHoras = c.fechasReales[0] ?? c.fecha
                        const horas = horasDe(fechaHoras)
                        const esHoy = c.fecha === hoy || c.fechasReales.includes(hoy)
                        const hayPendiente = c.aplicaciones.some((a) => a.pendiente)
                        return (
                          <div
                            key={c.clave}
                            className={`rounded-xl bg-white p-2.5 ring-1 ring-inset ${c.tipo === 'extra' ? 'ring-amber-200' : esHoy ? 'ring-brand-300' : 'ring-slate-200'}`}
                            data-dia-turno={c.fecha}
                            data-tarjeta-ddt={c.tipo === 'extra' ? 'extra' : c.ddtPlan}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                {c.tipo === 'plan' ? (
                                  <p className="text-sm font-bold text-slate-800">
                                    DDT plan {c.ddtPlan}
                                    <span className="font-semibold text-slate-500"> · DDT real {c.ddtsReales.length ? c.ddtsReales.join(', ') : '—'}</span>
                                  </p>
                                ) : (
                                  <p className="text-sm font-bold text-amber-800">
                                    {c.declarada ? 'Extra' : 'Sin DDT del plan'}
                                    <span className="font-semibold text-slate-500"> · DDT real {c.ddtsReales.length ? c.ddtsReales.join(', ') : '—'}</span>
                                  </p>
                                )}
                                <p className="text-[11px] text-slate-500">
                                  {c.fechaPlan && <>Fecha plan {dia(c.fechaPlan)} · </>}
                                  Fecha real {c.fechasReales.length ? c.fechasReales.map(dia).join(', ') : 'sin aplicar'}
                                </p>
                              </div>
                              {estacion.permisos.aplicar && (
                                <span className="flex shrink-0 flex-col items-end gap-1">
                                  {c.tipo === 'plan' && c.fecha <= hoy && (
                                    <button type="button" onClick={() => onAplicar(t.id, c.fecha)} className="text-xs font-bold text-brand-700" data-aplicar-dia>
                                      Aplicar
                                    </button>
                                  )}
                                  {fechaHoras <= hoy && (
                                    <button type="button" onClick={() => onHoras(t.id, fechaHoras)} className="text-xs font-bold text-slate-600" data-horas-dia>
                                      Horas
                                    </button>
                                  )}
                                </span>
                              )}
                            </div>

                            {c.productos.length > 0 && (
                              <table className="mt-1.5 w-full table-fixed text-xs">
                                <thead>
                                  <tr className="text-[10px] uppercase tracking-wide text-slate-400">
                                    <th className="py-0.5 text-left font-semibold">Producto</th>
                                    <th className="w-14 py-0.5 text-right font-semibold">Plan</th>
                                    <th className="w-14 py-0.5 text-right font-semibold">Real</th>
                                    <th className="w-14 py-0.5 text-right font-semibold">Var.</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {ordenarProductos(c.productos).map((p) => (
                                    <tr key={p.material_id} className="border-t border-slate-100" data-producto-tarjeta={material(p.material_id)?.codigo}>
                                      <td className="truncate py-1 pr-1 text-slate-700">{material(p.material_id)?.descripcion ?? '—'}</td>
                                      <td className="py-1 text-right tabular-nums text-slate-500">{c.tipo === 'plan' ? cantidad(p.plan) : '—'}</td>
                                      <td className="py-1 text-right font-semibold tabular-nums text-slate-800">
                                        {cantidad(p.real + p.pendiente)}
                                        {p.pendiente > 0 && <span className="block text-[9px] font-normal text-sky-700">{cantidad(p.pendiente)} por enviar</span>}
                                      </td>
                                      <td className={`py-1 text-right font-bold tabular-nums ${tonoVariacion(p)}`}>
                                        {c.tipo === 'plan' ? `${p.variacion > 0 ? '+' : ''}${cantidad(p.variacion)}` : '—'}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            )}
                            {hayPendiente && <p className="mt-1 text-[10px] text-sky-700">Hay aplicaciones por enviar (cuentan en lo real).</p>}
                            {horas && (horas.horas_riego !== null || horas.horas_fertilizacion !== null || horas.ppm_cloro_cabezal != null || horas.ppm_cloro_campo != null) && (
                              <p className="mt-1 text-[11px] text-slate-500">
                                Horas: fertilización {horas.horas_fertilizacion ?? '—'} · riego {horas.horas_riego ?? '—'}
                                {(horas.ppm_cloro_cabezal != null || horas.ppm_cloro_campo != null) && (
                                  <> · cloro ppm cabezal {horas.ppm_cloro_cabezal ?? '—'} · campo {horas.ppm_cloro_campo ?? '—'}</>
                                )}
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
