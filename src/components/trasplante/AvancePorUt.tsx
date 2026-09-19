'use client'

/**
 * Avance por UT: el cuadre de plan contra real.
 *
 * Se agrupa por CICLO y, dentro, por lote. Antes agrupaba por zona, y con
 * dos ciclos en marcha el mismo lote aparecía dos veces en la misma
 * sección sin que se viera cuál de las dos era la siembra de ahora. El
 * ciclo es lo primero que hay que saber para leer un porcentaje.
 *
 * Cada lote lleva su interruptor de «Terminado»: un lote al 92 % puede
 * estar cerrado porque el resto no se sembró y no se va a sembrar, y sin
 * esa marca el pendiente de la temporada nunca baja de cero.
 */

import { useMemo, useState } from 'react'
import { Alerta } from '@/components/ui/Primitivos'
import { SelectorMultiple } from '@/components/ui/SelectorMultiple'
import { IconCheck } from '@/components/ui/Icons'
import { Porcentaje } from './Porcentaje'
import { mensajeDeError } from '@/lib/errores'
import { marcarSiembraTerminada } from '@/lib/trasplante/repositorioCliente'
import { n0, n2, pct } from '@/lib/trasplante/formato'
import {
  porCiclo,
  SIN_FILTROS_AVANCE,
  type FilaAvanceUt,
  type FiltrosAvance,
} from '@/lib/trasplante/tipos'

export function AvancePorUt({
  filas,
  puedeEditar = false,
  onCambio,
}: {
  filas: FilaAvanceUt[]
  puedeEditar?: boolean
  /** Se avisa al marcar un lote para que la pantalla vuelva a leer. */
  onCambio?: () => void
}) {
  const [filtros, setFiltros] = useState<FiltrosAvance>(SIN_FILTROS_AVANCE)
  const [error, setError] = useState<string | null>(null)

  const opciones = useMemo(
    () => ({
      lotes: [...new Set(filas.map((f) => f.ut))]
        .sort((a, b) => a.localeCompare(b, 'es', { numeric: true }))
        .map((v) => ({ valor: v, etiqueta: v })),
      ciclos: [...new Set(filas.map((f) => String(f.ciclo)))]
        .sort()
        .map((v) => ({ valor: v, etiqueta: `Ciclo ${v}` })),
    }),
    [filas]
  )

  const lista = useMemo(() => {
    const lo = new Set(filtros.lotes)
    const ci = new Set(filtros.ciclos)
    return filas.filter(
      (f) => (!lo.size || lo.has(f.ut)) && (!ci.size || ci.has(String(f.ciclo)))
    )
  }, [filas, filtros])

  const ciclos = useMemo(() => porCiclo(lista), [lista])
  const puestos = filtros.lotes.length + filtros.ciclos.length

  async function alternarTerminado(loteTemporadaId: string, ciclo: number, terminado: boolean) {
    setError(null)
    const { error: e } = await marcarSiembraTerminada(loteTemporadaId, ciclo, terminado)
    if (e) {
      return setError(
        mensajeDeError(
          e,
          'No se pudo marcar el lote. Si dice que no existe «fn_marcar_siembra_terminada», falta correr la migración 46.'
        )
      )
    }
    onCambio?.()
  }

  if (filas.length === 0) {
    return (
      <p className="rounded-2xl border border-slate-200 bg-white px-4 py-10 text-center text-sm text-slate-400">
        Todavía no hay plan ni siembra en esta temporada.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {error && <Alerta>{error}</Alerta>}

      <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-slate-200/80 bg-white p-3 shadow-[var(--shadow-card)]">
        <SelectorMultiple
          etiqueta="Lote"
          opciones={opciones.lotes}
          valores={filtros.lotes}
          onCambiar={(v) => setFiltros({ ...filtros, lotes: v })}
          className="min-w-[160px] flex-1"
        />
        <SelectorMultiple
          etiqueta="Ciclo"
          opciones={opciones.ciclos}
          valores={filtros.ciclos}
          onCambiar={(v) => setFiltros({ ...filtros, ciclos: v })}
          className="min-w-[140px] flex-1"
        />
        {puestos > 0 && (
          <button
            type="button"
            onClick={() => setFiltros(SIN_FILTROS_AVANCE)}
            className="h-11 rounded-xl px-3 text-sm font-semibold text-slate-500 transition-colors hover:bg-slate-100"
          >
            Limpiar {puestos}
          </button>
        )}
      </div>

      {ciclos.length === 0 && (
        <p className="rounded-2xl border border-slate-200 bg-white px-4 py-10 text-center text-sm text-slate-400">
          Ningún lote pasa los filtros.
        </p>
      )}

      {ciclos.map(({ ciclo, lotes }) => {
        const todas = lotes.flatMap((l) => l.filas)
        const plan = todas.reduce((a, f) => a + Number(f.area_plan), 0)
        const real = todas.reduce((a, f) => a + Number(f.area_real), 0)
        const cerrados = lotes.filter((l) => l.terminado).length

        return (
          <section
            key={ciclo}
            className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[var(--shadow-card)]"
          >
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-slate-50/70 px-4 py-3">
              <div>
                <h2 className="text-sm font-bold text-slate-900">Ciclo {ciclo}</h2>
                <p className="text-xs text-slate-400">
                  {lotes.length} {lotes.length === 1 ? 'lote' : 'lotes'}
                  {cerrados > 0 && ` · ${cerrados} terminado${cerrados === 1 ? '' : 's'}`}
                </p>
              </div>
              <p className="text-sm tabular-nums text-slate-500">
                {n2(real)} / {n2(plan)} mz
                <span className="ml-2 font-bold text-slate-900">
                  {pct(plan > 0 ? (real / plan) * 100 : null)}
                </span>
              </p>
            </div>

            <div className="scroll-suave overflow-x-auto">
              <table className="w-full min-w-[820px] text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-left text-[11px] font-bold uppercase tracking-wide text-slate-500">
                    <th className="px-3 py-2">UT</th>
                    <th className="px-3 py-2">Lote</th>
                    <th className="px-3 py-2">Zona</th>
                    <th className="px-3 py-2">Variedad</th>
                    <th className="px-3 py-2 text-right">Plan</th>
                    <th className="px-3 py-2 text-right">Ejecutado</th>
                    <th className="px-3 py-2 text-right">%</th>
                    <th className="px-3 py-2 text-right">Plantas</th>
                    <th className="px-3 py-2">Última siembra</th>
                    <th className="px-3 py-2 text-right">Siembra</th>
                  </tr>
                </thead>
                <tbody>
                  {lotes.map((l) =>
                    l.filas.map((f, i) => (
                      <tr
                        key={`${l.lote_temporada_id}-${f.variedad}`}
                        className={`border-b border-slate-50 ${
                          l.terminado ? 'bg-emerald-50/40' : ''
                        }`}
                      >
                        <td className="whitespace-nowrap px-3 py-1.5 font-semibold text-slate-800">
                          {i === 0 ? l.ut : ''}
                        </td>
                        <td className="px-3 py-1.5 text-slate-500">
                          {i === 0 ? (l.nombre ?? '—') : ''}
                        </td>
                        <td className="px-3 py-1.5 text-slate-500">
                          {i === 0 ? (l.zona ?? '—') : ''}
                        </td>
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
                        <td className="whitespace-nowrap px-3 py-1.5 text-right">
                          {i === 0 && (
                            <Interruptor
                              terminado={l.terminado}
                              editable={puedeEditar}
                              onCambiar={(v) => alternarTerminado(l.lote_temporada_id, ciclo, v)}
                            />
                          )}
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

      <p className="px-1 text-xs text-slate-400">
        <strong>Terminado</strong> significa que ese lote ya no recibe más siembra en ese ciclo,
        aunque no haya llegado al 100 %. El mismo lote puede estar terminado en el ciclo 1 y abierto
        en el 2.
      </p>
    </div>
  )
}

/**
 * El interruptor de fin de siembra.
 *
 * `role="switch"` con `aria-checked`, no un botón a secas: es un estado
 * de sí o no y un lector de pantalla tiene que poder decir en cuál está.
 */
function Interruptor({
  terminado,
  editable,
  onCambiar,
}: {
  terminado: boolean
  editable: boolean
  onCambiar: (valor: boolean) => void
}) {
  if (!editable) {
    return terminado ? (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-800">
        <IconCheck className="h-3 w-3" />
        Terminado
      </span>
    ) : (
      <span className="text-[11px] text-slate-300">En siembra</span>
    )
  }

  return (
    <button
      type="button"
      role="switch"
      aria-checked={terminado}
      onClick={() => onCambiar(!terminado)}
      title={
        terminado
          ? 'Marcado como terminado: no recibe más siembra en este ciclo'
          : 'Marcar el lote como terminado en este ciclo'
      }
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[11px] font-bold transition-colors ${
        terminado
          ? 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200'
          : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
      }`}
    >
      <span
        className={`flex h-3.5 w-3.5 items-center justify-center rounded border transition-all ${
          terminado ? 'border-emerald-700 bg-emerald-700 text-white' : 'border-slate-300 bg-white'
        }`}
      >
        {terminado && <IconCheck className="h-2.5 w-2.5" />}
      </span>
      {terminado ? 'Terminado' : 'Terminar'}
    </button>
  )
}

