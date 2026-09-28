'use client'

/**
 * Las cuatro vistas del módulo en una sola pantalla.
 *
 * Este componente sólo enruta entre ellas y lleva los dos filtros
 * globales —temporada y fecha de corte—; cada pestaña se dibuja sola.
 *
 * Los dos filtros cambian la DIRECCIÓN en vez de guardar estado local:
 * así lo que se está mirando se puede mandar por chat y la página se
 * vuelve a pedir al servidor con esos datos. Con estado local, «mira
 * esto» obliga a explicar antes qué había que elegir.
 */

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Campo, Selector, Tarjeta } from '@/components/ui/Primitivos'
import { Entrada } from '@/components/ui/Primitivos'
import { GridAvance } from './GridAvance'
import { GridPlan } from './GridPlan'
import { PanelResumen } from './PanelResumen'
import { Reportes } from './Reportes'
import type {
  Estadisticas,
  FilaAvance,
  FilaPlan,
  FilaPorLote,
  FilaPorTipoSiembra,
  FilaPorVariedad,
  FilaPorZona,
  LoteRotacion,
  VariedadRotacion,
} from '@/lib/rotacion/tipos'

type Pestana = 'tablero' | 'plan' | 'avance' | 'reportes'

const PESTANAS: [Pestana, string][] = [
  ['tablero', 'Dashboard'],
  ['plan', 'Plan'],
  ['avance', 'Avance diario'],
  ['reportes', 'Reportes'],
]

export function RotacionTabs({
  temporadas,
  temporadaId,
  corte,
  estadisticas,
  plan,
  avance,
  porVariedad,
  porZona,
  porLote,
  porTipo,
  lotes,
  variedades,
  puedeEditar,
  puedeEliminar,
}: {
  temporadas: { id: string; nombre: string; activa: boolean }[]
  temporadaId: string
  corte: string
  estadisticas: Estadisticas | null
  plan: FilaPlan[]
  avance: FilaAvance[]
  porVariedad: FilaPorVariedad[]
  porZona: FilaPorZona[]
  porLote: FilaPorLote[]
  porTipo: FilaPorTipoSiembra[]
  lotes: LoteRotacion[]
  variedades: VariedadRotacion[]
  puedeEditar: boolean
  puedeEliminar: boolean
}) {
  const router = useRouter()
  const [pestana, setPestana] = useState<Pestana>('tablero')

  const ir = (t: string, c: string) => router.push(`/controles/rotacion?temporada=${t}&corte=${c}`)

  return (
    <div className="flex flex-col gap-4">
      <Tarjeta className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2">
        <Campo
          etiqueta="Temporada"
          ayuda="Todo el módulo —plan, avance y resúmenes— es de la temporada que elijas."
        >
          <Selector value={temporadaId} onChange={(e) => ir(e.target.value, corte)}>
            {temporadas.map((t) => (
              <option key={t.id} value={t.id}>
                {t.nombre}
                {t.activa ? ' (activa)' : ''}
              </option>
            ))}
          </Selector>
        </Campo>

        <Campo
          etiqueta="Fecha de corte"
          // Decirlo importa: el plan de rotación no lleva fecha prevista
          // —se siembra cuando el lote queda libre—, así que mover el
          // corte mueve lo real y deja el plan quieto. Sin esta línea, el
          // porcentaje al día 5 parece un desastre y nadie entiende por
          // qué.
          ayuda="Corta el AVANCE hasta ese día. El plan no lleva fecha prevista, así que se compara siempre contra el plan completo de la temporada."
        >
          <Entrada
            type="date"
            value={corte}
            onChange={(e) => e.target.value && ir(temporadaId, e.target.value)}
          />
        </Campo>
      </Tarjeta>

      <PanelResumen datos={estadisticas} />

      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {PESTANAS.map(([valor, etiqueta]) => (
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

      {/* El tablero y los reportes enseñan lo mismo: los cinco resúmenes.
          Uno es la puerta de entrada y el otro el sitio donde se busca
          algo concreto, así que no hay dos maneras de contar lo mismo. */}
      {(pestana === 'tablero' || pestana === 'reportes') && (
        <Reportes
          avance={avance}
          porVariedad={porVariedad}
          porZona={porZona}
          porLote={porLote}
          porTipo={porTipo}
          corte={corte}
        />
      )}

      {pestana === 'plan' && (
        <GridPlan
          temporadaId={temporadaId}
          filas={plan}
          lotes={lotes}
          variedades={variedades}
          puedeEditar={puedeEditar}
          puedeEliminar={puedeEliminar}
        />
      )}

      {pestana === 'avance' && (
        <GridAvance
          temporadaId={temporadaId}
          filas={avance}
          lotes={lotes}
          variedades={variedades}
          puedeEditar={puedeEditar}
          puedeEliminar={puedeEliminar}
        />
      )}
    </div>
  )
}
