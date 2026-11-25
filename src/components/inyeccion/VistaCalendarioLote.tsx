'use client'

/**
 * Calendario por lote: se elige UN lote y se ve, DDT por DDT, qué producto toca y qué pasó (✔ aplicado, ◐ de menos,
 * ✖ ya tocaba y no se hizo, ○ aún no toca). Una fila por DDT con la fecha del plan y un chip por producto. Tocar un
 * chip abre el detalle (plan contra real). Todo el lote cabe en una pantalla con desplazamiento interno.
 */

import { useMemo, useRef, useState } from 'react'
import { SelectorBuscable } from '@/components/ui/SelectorBuscable'
import { cantidad } from '@/lib/fertirriego/calculos'
import type { FilaCumplimiento } from '@/lib/inyeccion/cumplimiento'
import { normLote } from '@/lib/inyeccion/lotes'
import { textoCorto } from './InsigniasCumplimiento'
import { VistaPlanVsReal } from './VistaPlanVsReal'

const fechaCorta = (iso: string | null) => (iso ? new Date(`${iso}T12:00:00Z`).toLocaleDateString('es-HN', { day: 'numeric', month: 'short', timeZone: 'UTC' }) : 'sin fecha')

type Marca = { icono: string; clase: string; nombre: string }
function marcaDe(f: FilaCumplimiento): Marca {
  const aplicada = f.aplicaciones.length > 0
  if (f.tiempo === 'vencido') return { icono: '✖', clase: 'text-red-800 ring-red-600/30', nombre: 'sin aplicar' }
  if (f.tiempo === 'pendiente') return { icono: '○', clase: 'text-slate-600 ring-slate-300', nombre: 'aún no toca' }
  if (aplicada && f.cantidad === 'de_menos') return { icono: '◐', clase: 'text-amber-800 ring-amber-600/30', nombre: 'de menos' }
  if (f.tiempo === 'tarde') return { icono: '✔', clase: 'text-amber-800 ring-amber-600/30', nombre: 'tarde' }
  if (f.tiempo === 'temprano') return { icono: '✔', clase: 'text-sky-800 ring-sky-600/30', nombre: 'temprano' }
  return { icono: '✔', clase: 'text-emerald-800 ring-emerald-600/30', nombre: 'aplicado' }
}

export function VistaCalendarioLote({
  filas,
  lotes,
  producto,
  unidad,
  rotuloLote,
  quien,
}: {
  /** Plan contra real completo de la estación (sin filtrar por lote). */
  filas: FilaCumplimiento[]
  /** Lotes con plan o aplicaciones: id = nomenclatura, titulo = «Nombre · código». */
  lotes: { id: string; titulo: string }[]
  producto: (id: string) => string
  unidad: (id: string) => string
  rotuloLote: (lote: string) => string
  quien: (id: string | null) => string | null
}) {
  const [elegido, setElegido] = useState('')
  const [abierta, setAbierta] = useState<string | null>(null)
  const lote = elegido && lotes.some((l) => l.id === elegido) ? elegido : (lotes[0]?.id ?? '')
  // `producto` llega como función nueva en cada dibujo del padre: se guarda en una ref para no invalidar los memos
  const refProducto = useRef(producto)
  refProducto.current = producto
  const porLote = useMemo(() => {
    const m = new Map<string, FilaCumplimiento[]>()
    for (const f of filas) {
      const k = normLote(f.lote)
      const l = m.get(k)
      if (l) l.push(f)
      else m.set(k, [f])
    }
    return m
  }, [filas])
  const delLote = useMemo(() => porLote.get(normLote(lote)) ?? [], [porLote, lote])
  const dias = useMemo(() => {
    const producto = refProducto.current
    const m = new Map<string, FilaCumplimiento[]>()
    for (const f of delLote) {
      const k = f.ddt === null ? 'x' : String(f.ddt)
      m.set(k, [...(m.get(k) ?? []), f])
    }
    return [...m.entries()]
      .map(([k, fs]) => ({ ddt: k === 'x' ? null : Number(k), filas: fs.sort((a, b) => producto(a.material_id).localeCompare(producto(b.material_id), 'es')) }))
      .sort((a, b) => (a.ddt ?? 9999) - (b.ddt ?? 9999))
  }, [delLote])

  const conPlan = delLote.filter((f) => f.tiempo !== 'sin_plan')
  const aplicados = conPlan.filter((f) => f.aplicaciones.length > 0).length
  const faltan = delLote.filter((f) => f.tiempo === 'vencido').length
  const deMas = delLote.filter((f) => f.cantidad === 'de_mas').length
  const porVenir = delLote.filter((f) => f.tiempo === 'pendiente').length
  const pct = conPlan.length > 0 ? Math.round((aplicados / conPlan.length) * 100) : 0
  const sel = abierta ? (delLote.find((f) => f.clave === abierta) ?? null) : null

  if (lotes.length === 0) {
    return (
      <p className="rounded-xl bg-slate-50 p-4 text-center text-sm text-slate-500 ring-1 ring-inset ring-slate-200" data-calendario-vacio>
        No hay lotes con plan o aplicaciones en esta estación.
      </p>
    )
  }

  const resumen: [string, string][] = [
    [`${pct} %`, 'aplicado'],
    [String(aplicados), 'aplicados'],
    [String(faltan), 'faltan'],
    [String(deMas), 'de más'],
  ]

  return (
    <div className="flex flex-col gap-2" data-calendario-lote>
      <div data-selector-lote-calendario>
        <SelectorBuscable
          valor={lote}
          opciones={lotes}
          onCambiar={(v) => {
            setElegido(v)
            setAbierta(null)
          }}
          placeholder="Elegir lote…"
          etiquetaBusqueda="Buscar lote"
          permitirVacio={false}
        />
      </div>
      <div className="grid grid-cols-4 divide-x divide-slate-200 overflow-hidden rounded-xl bg-white text-center ring-1 ring-inset ring-slate-200" data-calendario-resumen>
        {resumen.map(([v, t]) => (
          <div key={t} className="px-1 py-1.5">
            <p className="text-base font-semibold tabular-nums leading-tight text-slate-900">{v}</p>
            <p className="text-[11px] leading-tight text-slate-500">{t}</p>
          </div>
        ))}
      </div>
      <p className="text-[11px] text-slate-500" data-calendario-leyenda>
        ✔ aplicado · ◐ de menos · ✖ ya tocaba y no se hizo · ○ aún no toca{porVenir > 0 ? ` (${porVenir})` : ''}
      </p>
      {dias.length === 0 ? (
        <p className="rounded-xl bg-slate-50 p-4 text-center text-sm text-slate-500 ring-1 ring-inset ring-slate-200">Este lote no tiene plan ni aplicaciones.</p>
      ) : (
        <div className="max-h-[32rem] divide-y divide-slate-100 overflow-y-auto rounded-xl bg-white ring-1 ring-inset ring-slate-200" data-calendario-cuerpo>
          {dias.map((d) => {
            const fecha = d.filas.find((f) => f.fecha_plan)
            return (
              <div key={d.ddt ?? 'x'} className="grid grid-cols-[3.5rem_1fr] gap-2 px-2 py-0.5" data-calendario-ddt={d.ddt ?? ''}>
                <div className="py-2">
                  <p className="text-sm font-semibold leading-tight text-slate-900">DDT {d.ddt ?? '—'}</p>
                  <p className="text-[11px] leading-tight text-slate-500">
                    {fecha?.fecha_estimada ? '≈ ' : ''}
                    {fechaCorta(fecha?.fecha_plan ?? null)}
                  </p>
                </div>
                <div className="flex flex-wrap gap-x-1.5">
                  {d.filas.map((f) => {
                    const m = marcaDe(f)
                    const u = unidad(f.material_id)
                    const dosis = f.aplicaciones.find((a) => a.dosis_mz !== null)?.dosis_mz ?? f.dosis_plan
                    const extra = f.tiempo === 'tarde' || f.tiempo === 'temprano' ? ` ${textoCorto(f)}` : ''
                    return (
                      <button
                        key={f.clave}
                        type="button"
                        onClick={() => setAbierta(abierta === f.clave ? null : f.clave)}
                        aria-pressed={abierta === f.clave}
                        aria-label={`${producto(f.material_id)}: ${m.nombre}`}
                        className="inline-flex min-h-11 items-center"
                        data-calendario-chip={f.tiempo}
                      >
                        <span className={`inline-flex max-w-full items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium leading-tight ring-1 ring-inset ${m.clase} ${abierta === f.clave ? 'outline outline-2 outline-brand-600' : ''}`}>
                          <span aria-hidden="true">{m.icono}</span>
                          <span className="text-left">
                            {producto(f.material_id)}
                            <span className="font-normal opacity-80">
                              {dosis !== null && dosis !== undefined ? ` · ${cantidad(dosis)} ${u}/mz` : ''}
                              {extra}
                            </span>
                          </span>
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      )}
      {sel && (
        <div data-calendario-detalle>
          <VistaPlanVsReal filas={[sel]} producto={producto} unidad={unidad} rotuloLote={rotuloLote} quien={quien} agrupar={false} />
        </div>
      )}
    </div>
  )
}
