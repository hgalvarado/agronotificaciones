'use client'

/**
 * «Por lote»: se elige un lote de la estación y se ve qué le toca, DDT por DDT: fecha del plan, cuántos días faltan o
 * pasaron, productos con dosis, cantidad, qué controlan y las observaciones del LTP; si ya se aplicó o sigue pendiente, y
 * un botón para aplicarlo. Solo lotes de las zonas de la persona (la base ya recorta el plan).
 */

import { useMemo, useState } from 'react'
import { Boton, Insignia } from '@/components/ui/Primitivos'
import { SelectorBuscable } from '@/components/ui/SelectorBuscable'
import { hoyIso } from '@/lib/fechas/zona'
import { cantidad } from '@/lib/fertirriego/calculos'
import type { Operacion } from '@/lib/fertirriego/tipos'
import { formatearFechaHora } from '@/lib/estados'
import { lotesConPlan, objetivosDeLinea, planesAplicados, type EstadoInyeccion } from '@/lib/inyeccion/estado'
import { lotesDelPlan, planDeEstacion, planDeLote, siguientePlanDeLote, type EstadoPlanLote } from '@/lib/inyeccion/planGeneral'
import { normLote } from '@/lib/inyeccion/lotes'

const fechaCorta = (iso: string | null) => (iso ? new Date(`${iso}T12:00:00Z`).toLocaleDateString('es-HN', { day: 'numeric', month: 'short', timeZone: 'UTC' }) : 'sin fecha')

const ETIQUETA: Record<EstadoPlanLote, { tono: 'verde' | 'rojo' | 'ambar' | 'gris'; texto: (dias: number | null) => string }> = {
  hecho: { tono: 'verde', texto: () => 'Aplicado' },
  atrasado: { tono: 'rojo', texto: (d) => `Atrasado ${Math.abs(d ?? 0)} día(s)` },
  hoy: { tono: 'ambar', texto: () => 'Toca hoy' },
  proximo: { tono: 'gris', texto: (d) => `En ${d} día(s)` },
  sin_fecha: { tono: 'gris', texto: () => 'Sin fecha' },
}

export function VistaPorLote({
  estado,
  cola,
  estacionId,
  puedeRegistrar,
  onAplicar,
}: {
  estado: EstadoInyeccion
  cola: Operacion[]
  estacionId: string
  puedeRegistrar: boolean
  onAplicar: (lote: string, categoria: string) => void
}) {
  const hoy = hoyIso()
  const activas = useMemo(() => new Set(estado.categorias.map((c) => c.clave)), [estado.categorias])
  const lineas = useMemo(() => planDeEstacion(estado.plan, estacionId, activas), [estado.plan, estacionId, activas])
  const hechos = useMemo(() => planesAplicados(lineas, estado.aplicaciones, cola), [lineas, estado.aplicaciones, cola])
  const lotes = useMemo(() => lotesDelPlan(lineas), [lineas])
  // El lote que se abre solo: el primero con algo pendiente (mismo orden que usa la pantalla principal)
  const sugerido = useMemo(() => lotesConPlan(estado, cola, estacionId, hoy)[0]?.lote ?? lotes[0] ?? '', [estado, cola, estacionId, hoy, lotes])
  const [elegido, setElegido] = useState('')
  const lote = elegido && lotes.includes(elegido) ? elegido : sugerido
  const planes = useMemo(() => (lote ? planDeLote(lineas, lote, hechos, hoy) : []), [lineas, lote, hechos, hoy])
  const siguiente = useMemo(() => siguientePlanDeLote(planes), [planes])
  const nombre = (id: string) => estado.materiales.find((m) => m.id === id)?.descripcion ?? estado.materiales.find((m) => m.id === id)?.codigo ?? 'Producto'
  const unidad = (id: string) => estado.materiales.find((m) => m.id === id)?.unidad ?? ''
  const categoriaDe = (turno: string, ddt: number | null) => lineas.find((l) => l.turno_agl_id === turno && l.ddt === ddt)?.categoria_clave ?? ''
  const aplicaciones = useMemo(
    () => estado.aplicaciones.filter((a) => a.estacion_id === estacionId && !a.anulado_at && normLote(a.lote) === normLote(lote)).sort((a, b) => b.fecha_hora.localeCompare(a.fecha_hora)),
    [estado.aplicaciones, estacionId, lote]
  )

  if (lotes.length === 0) {
    return (
      <p className="rounded-xl bg-slate-50 p-4 text-center text-sm text-slate-500 ring-1 ring-inset ring-slate-200" data-por-lote-vacio>
        Esta estación no tiene lotes con plan de inyección en tus zonas.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-3" data-por-lote>
      <div data-selector-lote-plan>
        <SelectorBuscable
          valor={lote}
          opciones={lotes.map((l) => ({ id: l, titulo: l }))}
          onCambiar={setElegido}
          placeholder="Elegir lote…"
          etiquetaBusqueda="Buscar lote"
          permitirVacio={false}
        />
      </div>
      {siguiente && siguiente.estado !== 'hecho' && (
        <p className="text-sm text-slate-700" data-por-lote-resumen>
          {siguiente.estado === 'atrasado' ? 'Pendiente' : 'Sigue'}: <strong>DDT {siguiente.ddt ?? '—'}</strong> · {fechaCorta(siguiente.fecha_plan)} ({ETIQUETA[siguiente.estado].texto(siguiente.dias).toLowerCase()})
        </p>
      )}
      {planes.map((p) => {
        const e = ETIQUETA[p.estado]
        return (
          <div key={`${p.turno_agl_id}|${p.ddt}`} className="rounded-xl bg-white p-3 ring-1 ring-inset ring-slate-200" data-plan-lote-ddt={p.ddt ?? ''} data-estado-plan={p.estado}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-base font-bold text-slate-900">
                DDT {p.ddt ?? '—'} <span className="text-sm font-semibold text-slate-500">· {fechaCorta(p.fecha_plan)}</span>
              </p>
              <Insignia tono={e.tono}>{e.texto(p.dias)}</Insignia>
            </div>
            {(p.turno || p.variedad) && <p className="text-xs text-slate-500">{[p.turno, p.variedad].filter(Boolean).join(' · ')}</p>}
            <ul className="mt-2 flex flex-col gap-2">
              {p.productos.map((x) => (
                <li key={x.material_id} className="text-sm text-slate-800">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                    <strong>{nombre(x.material_id)}</strong>
                    <span className="tabular-nums">
                      {x.dosis_mz !== null ? `${cantidad(x.dosis_mz)} ${unidad(x.material_id)}/mz · ` : ''}
                      {cantidad(x.cantidad_plan)} {unidad(x.material_id)}
                    </span>
                  </div>
                  {x.controla && <p className="text-xs text-slate-600">Controla: {x.controla}</p>}
                  {x.observaciones && <p className="mt-0.5 rounded-lg bg-amber-50 px-2 py-1 text-xs text-amber-900 ring-1 ring-inset ring-amber-600/20">{x.observaciones}</p>}
                </li>
              ))}
            </ul>
            {puedeRegistrar && p.estado !== 'hecho' && (
              <Boton className="mt-2 min-h-11 w-full" variante="secundario" onClick={() => onAplicar(lote, categoriaDe(p.turno_agl_id, p.ddt))} data-aplicar-este-ddt>
                Aplicar este lote
              </Boton>
            )}
          </div>
        )
      })}
      <div data-por-lote-aplicado>
        <p className="mb-1 text-xs font-bold uppercase tracking-wide text-slate-500">Lo aplicado en este lote</p>
        {aplicaciones.length === 0 ? (
          <p className="text-sm text-slate-500">Todavía no se ha registrado nada en este lote.</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {aplicaciones.slice(0, 6).map((a) => (
              <li key={a.id} className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-700 ring-1 ring-inset ring-slate-200">
                <strong>{formatearFechaHora(a.fecha_hora)}</strong> · {cantidad(a.area_mz)} mz
                {a.lineas.map((l) => (
                  <span key={l.material_id} className="block">
                    {nombre(l.material_id)}: {cantidad(l.cantidad)} {unidad(l.material_id)}
                    {objetivosDeLinea(a, l).length > 0 ? ` · ${objetivosDeLinea(a, l).join(', ')}` : ''}
                  </span>
                ))}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
