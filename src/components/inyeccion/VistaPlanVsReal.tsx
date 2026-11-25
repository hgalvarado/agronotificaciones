'use client'

/**
 * Plan contra real en filas compactas agrupadas por DDT: producto y dosis (grande) > lote, plan → real y fecha >
 * detalle (se abre al tocar la fila: plan y real lado a lado, área, quién y objetivo). Chips de categoría opcionales.
 */

import { useMemo, useState } from 'react'
import { cantidad } from '@/lib/fertirriego/calculos'
import type { FilaCumplimiento } from '@/lib/inyeccion/cumplimiento'
import type { CategoriaInyeccion } from '@/lib/inyeccion/estado'
import { ChipsCategoria, puntoCategoria } from './ChipsCategoria'
import { EstadoCompacto, InsigniasCumplimiento, PUNTO_TONO, TONO_TIEMPO } from './InsigniasCumplimiento'

const fechaCorta = (iso: string | null) => (iso ? new Date(`${iso}T12:00:00Z`).toLocaleDateString('es-HN', { day: 'numeric', month: 'short', timeZone: 'UTC' }) : 'sin fecha')

export function VistaPlanVsReal({
  filas,
  producto,
  unidad,
  rotuloLote,
  quien,
  categorias = [],
  agrupar = true,
}: {
  filas: FilaCumplimiento[]
  producto: (id: string) => string
  unidad: (id: string) => string
  rotuloLote: (lote: string) => string
  quien: (id: string | null) => string | null
  categorias?: CategoriaInyeccion[]
  /** false = una sola fila ya abierta, sin cabecera de DDT (detalle del Calendario por lote). */
  agrupar?: boolean
}) {
  const [cats, setCats] = useState<string[]>([])
  const [limite, setLimite] = useState(40)
  const [abiertas, setAbiertas] = useState<Set<string>>(new Set())
  const disponibles = useMemo(() => new Set(filas.map((f) => f.categoria_clave).filter((x): x is string => Boolean(x))), [filas])
  const visibles = useMemo(() => (cats.length ? filas.filter((f) => f.categoria_clave && cats.includes(f.categoria_clave)) : filas), [filas, cats])
  const mostradas = agrupar ? visibles.slice(0, limite) : visibles
  const grupos = useMemo(() => {
    const m = new Map<string, FilaCumplimiento[]>()
    for (const f of mostradas) {
      const k = f.tiempo === 'sin_plan' ? 'sp' : f.ddt === null ? 'x' : String(f.ddt)
      m.set(k, [...(m.get(k) ?? []), f])
    }
    const orden = (k: string) => (k === 'sp' ? 99999 : k === 'x' ? 9999 : Number(k))
    return [...m.entries()].sort((a, b) => orden(a[0]) - orden(b[0]))
  }, [mostradas])

  if (filas.length === 0) {
    return (
      <p className="rounded-xl bg-slate-50 p-4 text-center text-sm text-slate-500 ring-1 ring-inset ring-slate-200" data-plan-vs-real-vacio>
        No hay filas del plan con estos filtros.
      </p>
    )
  }

  const fila = (f: FilaCumplimiento, abiertaFija: boolean) => {
    const u = unidad(f.material_id)
    const abierta = abiertaFija || abiertas.has(f.clave)
    const personas = [...new Set(f.aplicaciones.map((a) => quien(a.registrado_por)).filter(Boolean))].join(', ')
    const objetivos = [...new Set(f.aplicaciones.flatMap((a) => a.objetivos))].join(', ')
    const dosisReal = f.aplicaciones.find((a) => a.dosis_mz !== null)?.dosis_mz ?? null
    const dosis = dosisReal ?? f.dosis_plan
    const punto = f.categoria_clave && categorias.length > 0 ? puntoCategoria(categorias, f.categoria_clave) : PUNTO_TONO[TONO_TIEMPO[f.tiempo].tono]
    return (
      <div key={f.clave} data-fila-plan-real={f.tiempo}>
        <button
          type="button"
          aria-expanded={abierta}
          onClick={() => !abiertaFija && setAbiertas((p) => { const n = new Set(p); if (n.has(f.clave)) n.delete(f.clave); else n.add(f.clave); return n })}
          className="grid min-h-14 w-full grid-cols-[0.75rem_1fr] items-start gap-2 px-3 py-2 text-left"
        >
          <span className={`mt-1.5 h-2.5 w-2.5 rounded-full ${punto}`} aria-hidden="true" />
          <span className="min-w-0">
            <span className="flex items-baseline justify-between gap-2">
              <span className="min-w-0 truncate text-[15px] font-bold leading-tight text-slate-900">{producto(f.material_id)}</span>
              <span className="shrink-0 text-[15px] font-bold leading-tight tabular-nums text-slate-900">{dosis !== null ? `${cantidad(dosis)} ${u}/mz` : '—'}</span>
            </span>
            <span className="flex items-center justify-between gap-2">
              <span className="min-w-0 truncate text-xs tabular-nums text-slate-600">
                {rotuloLote(f.lote)} · {f.aplicaciones.length > 0 ? `${cantidad(f.cantidad_real)}${f.tiempo === 'sin_plan' ? '' : ` / ${cantidad(f.cantidad_plan)}`} ${u}` : `${cantidad(f.cantidad_plan)} ${u}`}
              </span>
              <EstadoCompacto fila={f} />
            </span>
          </span>
        </button>
        {abierta && (
          <div className="px-3 pb-3 pl-8">
            <div className="grid grid-cols-2 gap-2 text-sm">
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
        )}
      </div>
    )
  }

  if (!agrupar) return <div className="rounded-xl bg-white ring-1 ring-inset ring-slate-200" data-plan-vs-real>{visibles.map((f) => fila(f, true))}</div>

  return (
    <div className="flex flex-col gap-2" data-plan-vs-real>
      <ChipsCategoria categorias={categorias} elegidas={cats} onCambiar={setCats} disponibles={disponibles} />
      {grupos.map(([k, fs]) => {
        const f0 = fs.find((f) => f.fecha_plan)
        return (
          <section key={k} className="overflow-hidden rounded-xl bg-white ring-1 ring-inset ring-slate-200" data-plan-real-ddt={k}>
            <h3 className="sticky top-0 z-[1] flex items-baseline justify-between bg-slate-100 px-3 py-1 text-xs font-bold uppercase tracking-wide text-slate-600">
              <span>{k === 'sp' ? 'Sin plan' : k === 'x' ? 'DDT sin dato' : `DDT ${k}`}{f0 ? ` · ${f0.fecha_estimada ? '≈ ' : ''}${fechaCorta(f0.fecha_plan)}` : ''}</span>
              <span className="font-semibold normal-case">{fs.length}</span>
            </h3>
            <div className="divide-y divide-slate-100">{fs.map((f) => fila(f, false))}</div>
          </section>
        )
      })}
      {visibles.length > mostradas.length && (
        <button type="button" onClick={() => setLimite((l) => l + 40)} className="min-h-11 rounded-xl bg-white text-sm font-semibold text-brand-700 ring-1 ring-inset ring-slate-300" data-ver-mas-plan>
          Ver más ({visibles.length - mostradas.length})
        </button>
      )}
    </div>
  )
}
