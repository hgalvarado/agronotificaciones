'use client'

/**
 * Las cuatro vistas del módulo en una sola pantalla, con el tablero
 * arriba. Este componente sólo enruta entre ellas y lleva el filtro de
 * temporada; cada pestaña se dibuja sola.
 *
 * El filtro de «Siembras desde–hasta» se quitó. La TEMPORADA es el
 * recorte natural del trasplante —el plan, el cuadre y la liquidación
 * siempre fueron de la temporada entera— y tener encima un rango de
 * fechas que sólo afectaba a una de las cuatro pestañas hacía que los
 * totales de la tabla no cuadraran con los de arriba sin que se viera
 * por qué. Ahora la temporada manda todo y se elige de un clic.
 */

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Campo, Selector, Tarjeta } from '@/components/ui/Primitivos'
import { AvancePorUt } from './AvancePorUt'
import { GridRecepcion } from './GridRecepcion'
import { GridSiembras } from './GridSiembras'
import { PanelEstadisticas } from './PanelEstadisticas'
import { PanelLiquidacion } from './PanelLiquidacion'
import { PlanSiembra } from './PlanSiembra'
import type {
  FilaAvanceUt,
  FilaEstadistica,
  FilaLiquidacion,
  FilaPlanSiembra,
  FilaRecepcion,
  FilaSemana,
  FilaSiembra,
  FilaVariedad,
  LoteOpcion,
  Material,
  Variedad,
} from '@/lib/trasplante/tipos'

type Pestana = 'avance' | 'diaria' | 'plan' | 'recepcion'

export function TrasplanteTabs({
  temporadas,
  temporadaId,
  avance,
  estadisticas,
  variedadesCuadre,
  semanas,
  siembras,
  plan,
  recepciones,
  liquidacion,
  lotes,
  variedades,
  materiales,
  puedeEditar,
  puedeEliminar,
}: {
  temporadas: { id: string; nombre: string; activa: boolean }[]
  temporadaId: string
  avance: FilaAvanceUt[]
  estadisticas: FilaEstadistica[]
  variedadesCuadre: FilaVariedad[]
  semanas: FilaSemana[]
  siembras: FilaSiembra[]
  plan: FilaPlanSiembra[]
  recepciones: FilaRecepcion[]
  liquidacion: FilaLiquidacion[]
  lotes: LoteOpcion[]
  variedades: Variedad[]
  materiales: Material[]
  puedeEditar: boolean
  puedeEliminar: boolean
}) {
  const router = useRouter()
  const [pestana, setPestana] = useState<Pestana>('avance')

  return (
    <div className="flex flex-col gap-4">
      <Tarjeta className="p-4">
        <Campo
          etiqueta="Temporada"
          ayuda="Todo el módulo —tablero, cuadre, siembra diaria, plan y liquidación— es de la temporada que elijas, completa."
        >
          {/* Cambia la dirección en vez de guardar estado local: así la
              temporada que se está viendo se puede compartir por chat y la
              página se vuelve a pedir al servidor con sus datos. */}
          <Selector
            value={temporadaId}
            onChange={(e) => router.push(`/trasplante?temporada=${e.target.value}`)}
          >
            {temporadas.map((t) => (
              <option key={t.id} value={t.id}>
                {t.nombre}
                {t.activa ? ' (activa)' : ''}
              </option>
            ))}
          </Selector>
        </Campo>
      </Tarjeta>

      <PanelEstadisticas
        estadisticas={estadisticas}
        variedades={variedadesCuadre}
        semanas={semanas}
        avance={avance}
      />

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

      {pestana === 'avance' && (
        <AvancePorUt
          filas={avance}
          puedeEditar={puedeEditar}
          onCambio={() => router.refresh()}
        />
      )}
      {pestana === 'diaria' && (
        <GridSiembras
          temporadaId={temporadaId}
          filas={siembras}
          lotes={lotes}
          variedades={variedades}
          materiales={materiales}
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
