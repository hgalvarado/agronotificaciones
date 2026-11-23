'use client'

/**
 * «Plan» de Inyección de la estación, agrupado por DDT como en AGL › Plan general: por cada DDT, sus productos con la
 * dosis por mz, qué controla, las observaciones del LTP, las variedades con su % de aplicación del LTP y los lotes (con cuántos ya se
 * aplicaron). Para decidir en campo qué toca y qué falta. «Expandir todo / Contraer todo»; sin gráficas ni tablas.
 * Solo trae lo de las zonas de la persona (la base ya lo recorta).
 */

import { useMemo, useState } from 'react'
import { Insignia } from '@/components/ui/Primitivos'
import { cantidad } from '@/lib/fertirriego/calculos'
import { planesAplicados, type EstadoInyeccion } from '@/lib/inyeccion/estado'
import { planDeEstacion, planGeneralPorDdt, type GrupoDdt } from '@/lib/inyeccion/planGeneral'
import type { Operacion } from '@/lib/fertirriego/tipos'

const fechaCorta = (iso: string | null) => (iso ? new Date(`${iso}T12:00:00Z`).toLocaleDateString('es-HN', { day: 'numeric', month: 'short', timeZone: 'UTC' }) : '')

export function VistaPlanGeneral({
  estado,
  cola,
  estacionId,
  onFicha,
}: {
  estado: EstadoInyeccion
  cola: Operacion[]
  estacionId: string
  /** Abre la ficha técnica de un producto. */
  onFicha: (materialId: string) => void
}) {
  const [ciclo, setCiclo] = useState<string>('')   // '' = todos los ciclos
  const todos = useMemo<GrupoDdt[]>(() => {
    const activas = new Set(estado.categorias.map((c) => c.clave))
    const plan = planDeEstacion(estado.plan, estacionId, activas)
    return planGeneralPorDdt(plan, planesAplicados(plan, estado.aplicaciones, cola))
  }, [estado, cola, estacionId])
  const ciclos = useMemo(() => [...new Set(todos.map((g) => g.ciclo ?? ''))], [todos])
  const grupos = useMemo(() => (ciclo ? todos.filter((g) => (g.ciclo ?? '') === ciclo) : todos), [todos, ciclo])
  const claveDe = (g: GrupoDdt) => `${g.ciclo ?? ''}|${g.ddt}`
  const material = (id: string) => estado.materiales.find((m) => m.id === id)
  // Por defecto: con pocos grupos todos abiertos; con muchos, solo el primero que aún tiene lotes por aplicar
  const primero = grupos.findIndex((g) => !g.completo)
  const inicial = useMemo(() => new Set(grupos.filter((g, i) => grupos.length <= 3 || i === Math.max(primero, 0)).map((g) => `${g.ciclo ?? ''}|${g.ddt}`)), [grupos, primero])
  const [abiertos, setAbiertos] = useState<Set<string> | null>(null)
  const actual = abiertos ?? inicial

  if (grupos.length === 0) {
    return (
      <p className="rounded-xl bg-slate-50 p-4 text-center text-sm text-slate-500 ring-1 ring-inset ring-slate-200" data-plan-vacio>
        Esta estación no tiene plan de inyección publicado para tus zonas.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-2" data-plan-general>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => setAbiertos(new Set(grupos.map(claveDe)))} className="min-h-11 rounded-lg px-3 text-sm font-semibold text-brand-700 ring-1 ring-inset ring-brand-600/30" data-plan-expandir>
          Expandir todo
        </button>
        <button type="button" onClick={() => setAbiertos(new Set())} className="min-h-11 rounded-lg px-3 text-sm font-semibold text-slate-700 ring-1 ring-inset ring-slate-300" data-plan-contraer>
          Contraer todo
        </button>
        <span className="text-xs text-slate-500">
          {grupos.length} DDT · {actual.size} abierto(s)
        </span>
      </div>
      {ciclos.length > 1 && (
        <div className="flex flex-wrap items-center gap-2" data-plan-ciclos>
          {['', ...ciclos].map((c) => (
            <button
              key={c || 'todos'}
              type="button"
              onClick={() => setCiclo(c)}
              aria-pressed={ciclo === c}
              className={`min-h-11 rounded-full px-4 text-sm font-semibold ring-1 ring-inset ${ciclo === c ? 'bg-brand-600 text-white ring-brand-600' : 'text-slate-700 ring-slate-300'}`}
              data-plan-ciclo={c || 'todos'}
            >
              {c === '' ? 'Todos los ciclos' : c || 'Sin ciclo'}
            </button>
          ))}
        </div>
      )}
      {grupos.map((g, i) => {
        const clave = claveDe(g)
        const encabezadoCiclo = ciclos.length > 1 && (i === 0 || (grupos[i - 1].ciclo ?? '') !== (g.ciclo ?? ''))
        const fechas = g.fecha_desde ? `${g.fecha_estimada ? '≈ ' : ''}${g.fecha_desde === g.fecha_hasta ? fechaCorta(g.fecha_desde) : `${fechaCorta(g.fecha_desde)} – ${fechaCorta(g.fecha_hasta)}`}` : ''
        return (
          <div key={clave} className="flex flex-col gap-2">
          {encabezadoCiclo && <h3 className="pt-1 text-base font-extrabold text-brand-700" data-plan-ciclo-titulo>{g.ciclo ?? 'Sin ciclo'}</h3>}
          <details
            open={actual.has(clave)}
            onToggle={(e) => {
              const abierto = (e.currentTarget as HTMLDetailsElement).open
              setAbiertos((prev) => {
                const base = new Set(prev ?? inicial)
                if (abierto) base.add(clave)
                else base.delete(clave)
                return base
              })
            }}
            className="rounded-xl bg-white ring-1 ring-inset ring-slate-200"
            data-plan-ddt={g.ddt}
          >
            <summary className="flex min-h-11 cursor-pointer list-none flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 py-2">
              <span className="text-base font-bold text-slate-900">DDT {g.ddt ?? 'sin dato'}</span>
              <span className="flex flex-wrap items-center gap-1.5">
                {g.completo ? <Insignia tono="verde">Todo aplicado</Insignia> : <Insignia tono="ambar">{g.n_lotes - g.n_lotes_hechos} por aplicar</Insignia>}
              </span>
              <span className="w-full text-xs text-slate-500">
                {fechas ? `${fechas} · ` : ''}
                {g.productos.length} producto(s) · {g.n_lotes} lote(s) · {cantidad(g.area_mz)} mz
              </span>
            </summary>
            <div className="flex flex-col gap-3 border-t border-slate-100 p-3">
              {g.productos
                .map((p) => ({ p, m: material(p.material_id) }))
                .sort((a, b) => (a.m?.descripcion ?? a.m?.codigo ?? '').localeCompare(b.m?.descripcion ?? b.m?.codigo ?? '', 'es'))
                .map(({ p, m }) => {
                  const controla = p.controla ?? m?.plagas_controla ?? null
                  return (
                    <div key={p.material_id} className="flex flex-col gap-1" data-plan-producto={p.material_id}>
                      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                        <p className="text-sm font-bold text-slate-800">{m?.descripcion ?? m?.codigo ?? 'Producto'}</p>
                        <p className="text-sm tabular-nums text-slate-700">
                          {p.dosis_mz !== null ? (
                            <>
                              <strong>{cantidad(p.dosis_mz)}</strong> {m?.unidad ?? ''}/mz
                            </>
                          ) : (
                            'sin dosis'
                          )}
                        </p>
                      </div>
                      <p className="text-xs text-slate-500">
                        {cantidad(p.area_mz)} mz · {cantidad(p.cantidad)} {m?.unidad ?? ''} en total · {p.lotes.length} lote(s)
                        {p.lotes_hechos > 0 ? ` (${p.lotes_hechos} ya aplicado(s))` : ''}
                      </p>
                      {controla && <p className="text-xs text-slate-700">Controla: {controla}</p>}
                      {p.observaciones.map((o) => (
                        <p key={o} className="rounded-lg bg-amber-50 px-2 py-1 text-xs text-amber-900 ring-1 ring-inset ring-amber-600/20" data-plan-observacion>
                          {o}
                        </p>
                      ))}
                      <div className="flex flex-wrap gap-1.5" data-plan-variedades>
                        {p.variedades.map((v) => (
                          <span key={v.variedad} className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">
                            {v.variedad}{' '}
                            {v.pct === null ? 'sin % en el LTP' : v.pct_max !== null && v.pct_max !== v.pct ? `${cantidad(v.pct)}–${cantidad(v.pct_max)} % del área` : `${cantidad(v.pct)} % del área`}
                          </span>
                        ))}
                      </div>
                      <p className="text-xs text-slate-500">
                        Lotes: {p.lotes.slice(0, 8).join(', ')}
                        {p.lotes.length > 8 ? ` y ${p.lotes.length - 8} más` : ''}
                      </p>
                      {m && (
                        <button type="button" onClick={() => onFicha(p.material_id)} className="min-h-11 w-fit rounded-lg px-1 text-sm font-semibold text-brand-700 underline" data-plan-ver-ficha>
                          Ver ficha técnica
                        </button>
                      )}
                    </div>
                  )
                })}
            </div>
          </details>
          </div>
        )
      })}
    </div>
  )
}
