'use client'

/**
 * Plan contra real en filas compactas agrupadas por DDT: producto y dosis (grande) > lote, plan → real y fecha >
 * detalle (se abre al tocar la fila: plan y real lado a lado, área, quién y objetivo). Chips de categoría opcionales.
 */

import { useMemo, useState } from 'react'
import { cantidad } from '@/lib/fertirriego/calculos'
import type { FilaCumplimiento } from '@/lib/inyeccion/cumplimiento'
import type { CategoriaInyeccion } from '@/lib/inyeccion/estado'
import { BandaLateral } from '@/components/ui/Banda'
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
  const [ciclo, setCiclo] = useState<string>('') // '' = todos los ciclos
  const [abiertas, setAbiertas] = useState<Set<string>>(new Set())
  const disponibles = useMemo(() => new Set(filas.map((f) => f.categoria_clave).filter((x): x is string => Boolean(x))), [filas])
  const ciclos = useMemo(() => [...new Set(filas.map((f) => f.ciclo ?? ''))].sort((a, b) => a.localeCompare(b, 'es', { numeric: true })), [filas])
  const visibles = useMemo(
    () => filas.filter((f) => (!cats.length || (f.categoria_clave && cats.includes(f.categoria_clave))) && (!ciclo || (f.ciclo ?? '') === ciclo)),
    [filas, cats, ciclo]
  )
  const mostradas = agrupar ? visibles.slice(0, limite) : visibles
  const grupos = useMemo(() => {
    const m = new Map<string, FilaCumplimiento[]>()
    for (const f of mostradas) {
      const k = `${f.ciclo ?? ''}§${f.tiempo === 'sin_plan' ? 'sp' : f.ddt === null ? 'x' : String(f.ddt)}`
      m.set(k, [...(m.get(k) ?? []), f])
    }
    const orden = (k: string) => (k === 'sp' ? 99999 : k === 'x' ? 9999 : Number(k))
    const partes = (k: string) => { const i = k.indexOf('§'); return [k.slice(0, i), k.slice(i + 1)] as const }
    return [...m.entries()].sort((a, b) => partes(a[0])[0].localeCompare(partes(b[0])[0], 'es', { numeric: true }) || orden(partes(a[0])[1]) - orden(partes(b[0])[1]))
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
          className="flex min-h-14 w-full items-stretch gap-2.5 px-3 py-2 text-left"
        >
          <BandaLateral clase={punto} />
          <span className="min-w-0 flex-1">
            <span className="flex items-baseline justify-between gap-2">
              <span className="min-w-0 truncate text-[15px] font-medium leading-tight text-slate-900">{producto(f.material_id)}</span>
              <span className="shrink-0 text-[15px] font-semibold leading-tight tabular-nums text-slate-900">{dosis !== null ? `${cantidad(dosis)} ${u}/mz` : '—'}</span>
            </span>
            <span className="flex items-center justify-between gap-2">
              <span className="min-w-0 truncate text-xs tabular-nums text-slate-600">
                <span className="text-[13px] font-medium text-slate-800">{rotuloLote(f.lote)}</span> · {f.aplicaciones.length > 0 ? `${cantidad(f.cantidad_real)}${f.tiempo === 'sin_plan' ? '' : ` / ${cantidad(f.cantidad_plan)}`} ${u}` : `${cantidad(f.cantidad_plan)} ${u}`}
              </span>
              <EstadoCompacto fila={f} />
            </span>
          </span>
        </button>
        {abierta && (
          <div className="px-3 pb-3 pl-8">
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="rounded-lg bg-slate-50 p-2 ring-1 ring-inset ring-slate-200" data-columna-plan>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Plan</p>
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
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Real</p>
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
      {ciclos.length > 1 && (
        <div className="flex flex-wrap items-center gap-2" data-plan-real-ciclos>
          {['', ...ciclos].map((c) => (
            <button
              key={c || 'todos'}
              type="button"
              onClick={() => setCiclo(c)}
              aria-pressed={ciclo === c}
              className={`min-h-11 rounded-full px-4 text-sm font-semibold ring-1 ring-inset ${ciclo === c ? 'bg-brand-600 text-white ring-brand-600' : 'text-slate-700 ring-slate-300'}`}
              data-plan-real-ciclo={c || 'todos'}
            >
              {c === '' ? 'Todos los ciclos' : c || 'Sin ciclo'}
            </button>
          ))}
        </div>
      )}
      {grupos.map(([clave, fs], i) => {
        const f0 = fs.find((f) => f.fecha_plan)
        const sep = clave.indexOf('§')
        const cicloG = clave.slice(0, sep)
        const k = clave.slice(sep + 1)
        const tituloCiclo = ciclos.length > 1 && (i === 0 || grupos[i - 1][0].slice(0, grupos[i - 1][0].indexOf('§')) !== cicloG)
        return (
          <div key={clave} className="flex flex-col gap-2">
          {tituloCiclo && <h3 className="pt-1 text-base font-semibold text-brand-700" data-plan-real-ciclo-titulo>{cicloG || 'Sin ciclo'}</h3>}
          <section className="overflow-hidden rounded-xl bg-white ring-1 ring-inset ring-slate-200" data-plan-real-ddt={k}>
            <h3 className="sticky top-0 z-[1] flex items-baseline justify-between bg-slate-100 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-slate-600">
              <span>{k === 'sp' ? 'Sin plan' : k === 'x' ? 'DDT sin dato' : `DDT ${k}`}{f0 ? ` · ${f0.fecha_estimada ? '≈ ' : ''}${fechaCorta(f0.fecha_plan)}` : ''}</span>
              <span className="font-semibold normal-case">{fs.length}</span>
            </h3>
            <div className="divide-y divide-slate-100">{fs.map((f) => fila(f, false))}</div>
          </section>
          </div>
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
