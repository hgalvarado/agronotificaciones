'use client'

/**
 * Las tres vistas del módulo en una sola pantalla: el cuadre, lo
 * capturado y el plan. Este componente sólo enruta entre ellas y lleva
 * los filtros de temporada y fechas; cada pestaña se dibuja sola.
 */

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Campo, Entrada, Selector, Tarjeta } from '@/components/ui/Primitivos'
import { AvancePorUt } from './AvancePorUt'
import { GridRecepcion } from './GridRecepcion'
import { GridSiembras } from './GridSiembras'
import { PanelLiquidacion } from './PanelLiquidacion'
import { PlanSiembra } from './PlanSiembra'
import type {
  FilaAvanceUt,
  FilaLiquidacion,
  FilaPlanSiembra,
  FilaRecepcion,
  FilaSiembra,
  LoteOpcion,
  Variedad,
} from '@/lib/trasplante/tipos'

type Pestana = 'avance' | 'diaria' | 'plan' | 'recepcion'

export function TrasplanteTabs({
  temporadas,
  temporadaId,
  desde,
  hasta,
  avance,
  siembras,
  plan,
  recepciones,
  liquidacion,
  lotes,
  variedades,
  puedeEditar,
  puedeEliminar,
}: {
  temporadas: { id: string; nombre: string; activa: boolean }[]
  temporadaId: string
  desde: string
  hasta: string
  avance: FilaAvanceUt[]
  siembras: FilaSiembra[]
  plan: FilaPlanSiembra[]
  recepciones: FilaRecepcion[]
  liquidacion: FilaLiquidacion[]
  lotes: LoteOpcion[]
  variedades: Variedad[]
  puedeEditar: boolean
  puedeEliminar: boolean
}) {
  const router = useRouter()
  const [pestana, setPestana] = useState<Pestana>('avance')
  const [d, setD] = useState(desde)
  const [h, setH] = useState(hasta)

  function navegar(cambios: Record<string, string>) {
    const p = new URLSearchParams({ temporada: temporadaId, desde: d, hasta: h, ...cambios })
    router.push(`/trasplante?${p.toString()}`)
  }

  return (
    <div className="flex flex-col gap-4">
      <Tarjeta className="p-4">
        <div className="flex flex-wrap items-end gap-3">
          <Campo etiqueta="Temporada" className="min-w-[160px] flex-1">
            <Selector value={temporadaId} onChange={(e) => navegar({ temporada: e.target.value })}>
              {temporadas.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.nombre}
                  {t.activa ? ' (activa)' : ''}
                </option>
              ))}
            </Selector>
          </Campo>

          <Campo etiqueta="Siembras desde" className="min-w-[140px]">
            <Entrada type="date" value={d} onChange={(e) => setD(e.target.value)} />
          </Campo>
          <Campo etiqueta="Hasta" className="min-w-[140px]">
            <Entrada type="date" value={h} onChange={(e) => setH(e.target.value)} />
          </Campo>
          <button
            type="button"
            onClick={() => navegar({ desde: d, hasta: h })}
            className="h-11 rounded-xl bg-slate-900 px-4 text-sm font-semibold text-white transition-colors hover:bg-slate-800"
          >
            Consultar
          </button>
        </div>
        <p className="mt-3 border-t border-slate-100 pt-3 text-xs text-slate-400">
          El plan y el cuadre son acumulados de toda la temporada; las fechas sólo recortan la lista
          de siembras capturadas.
        </p>
      </Tarjeta>

      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {(
          [
            ['avance', 'Avance por UT'],
            ['diaria', 'Siembra diaria'],
            ['plan', 'Plan de siembra'],
            ['recepcion', 'Recepción de plántulas'],
          ] as const
        ).map(([valor, etiqueta]) => (
          <button
            key={valor}
            onClick={() => setPestana(valor)}
            className={`shrink-0 rounded-full px-3.5 py-2 text-sm font-semibold transition-all ${
              pestana === valor
                ? 'bg-brand-700 text-white shadow-[var(--shadow-raised)]'
                : 'bg-white text-slate-500 ring-1 ring-inset ring-slate-200 hover:text-slate-900'
            }`}
          >
            {etiqueta}
          </button>
        ))}
      </div>

      {pestana === 'avance' && <AvancePorUt filas={avance} />}
      {pestana === 'diaria' && (
        <GridSiembras
          temporadaId={temporadaId}
          filas={siembras}
          lotes={lotes}
          variedades={variedades}
          puedeEditar={puedeEditar}
          puedeEliminar={puedeEliminar}
        />
      )}
      {pestana === 'plan' && (
        <PlanSiembra
          temporadaId={temporadaId}
          filas={plan}
          lotes={lotes}
          variedades={variedades}
          puedeEditar={puedeEditar}
          puedeEliminar={puedeEliminar}
        />
      )}
      {pestana === 'recepcion' && (
        <div className="flex flex-col gap-4">
          <GridRecepcion
            key={`${temporadaId}-${recepciones.length}`}
            temporadaId={temporadaId}
            filas={recepciones}
            variedades={variedades}
            puedeEditar={puedeEditar}
          />
          <PanelLiquidacion filas={liquidacion} />
        </div>
      )}
    </div>
  )
}
