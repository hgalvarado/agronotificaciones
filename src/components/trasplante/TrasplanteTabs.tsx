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

import { useState, useMemo } from 'react'
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
import { armarReglas, canExecuteAction, type ReglasPlanas } from '@/lib/permisos/clientABAC'

type Pestana = 'avance' | 'diaria' | 'plan' | 'recepcion'

/**
 * Cada pestaña con SU pantalla de permisos (migración 66).
 *
 * El plan de siembra y la siembra diaria son dos permisos distintos: el
 * plan lo arma la jefatura una vez por temporada y la captura diaria la
 * hace quien está en el campo. Con un solo identificador había que dar
 * las dos o ninguna.
 *
 * El avance por UT y la recepción de plántulas leen lo que la siembra
 * diaria captura, así que cuelgan de ella.
 */
const PESTANAS: { valor: Pestana; etiqueta: string; pantalla: string }[] = [
  { valor: 'avance', etiqueta: 'Avance por UT', pantalla: 'trasplante_diario' },
  { valor: 'diaria', etiqueta: 'Siembra diaria', pantalla: 'trasplante_diario' },
  { valor: 'plan', etiqueta: 'Plan de siembra', pantalla: 'trasplante_plan' },
  { valor: 'recepcion', etiqueta: 'Recepción de plántulas', pantalla: 'trasplante_diario' },
]

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
  reglas,
  usuarioId,
  zonas,
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
  /** Las reglas del usuario con sus tres ejes. Los hijos deciden por fila. */
  reglas: ReglasPlanas
  usuarioId: string | null
  zonas?: string[]
}) {
  // Esta capa sólo decide pestañas y modales, que son de pantalla.
  // El recorte por fila lo hace cada cuadrícula con las mismas reglas.
  const reglasAbac = useMemo(() => armarReglas(reglas), [reglas])
  // El avance por UT y la recepción son lectura/edición de lo que la
  // siembra diaria captura: su permiso es el de ella.
  const puedeEditar = canExecuteAction(reglasAbac, 'trasplante_diario', 'editar')

  /** Sólo las pestañas que esta persona puede ver. Las demás no se dibujan. */
  const visibles = useMemo(
    () => PESTANAS.filter((p) => canExecuteAction(reglasAbac, p.pantalla, 'ver')),
    [reglasAbac]
  )

  const router = useRouter()
  const [pestana, setPestana] = useState<Pestana>('avance')
  const activa: Pestana | null =
    visibles.find((p) => p.valor === pestana)?.valor ?? visibles[0]?.valor ?? null

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
        {visibles.map(({ valor, etiqueta }) => (
          <button
            key={valor}
            onClick={() => setPestana(valor)}
            className={`shrink-0 rounded-full px-3.5 py-2 text-sm font-semibold transition-all ${
              activa === valor
                ? 'bg-brand-700 text-white shadow-[var(--shadow-raised)]'
                : 'bg-white text-slate-500 ring-1 ring-inset ring-slate-200 hover:text-slate-900'
            }`}
          >
            {etiqueta}
          </button>
        ))}
      </div>

      {activa === 'avance' && (
        <AvancePorUt
          filas={avance}
          puedeEditar={puedeEditar}
          onCambio={() => router.refresh()}
        />
      )}
      {activa === 'diaria' && (
        <GridSiembras
          temporadaId={temporadaId}
          filas={siembras}
          lotes={lotes}
          variedades={variedades}
          materiales={materiales}
          reglas={reglas}
          usuarioId={usuarioId}
          zonas={zonas}
        />
      )}
      {activa === 'plan' && (
        <PlanSiembra
          temporadaId={temporadaId}
          filas={plan}
          lotes={lotes}
          variedades={variedades}
          reglas={reglas}
          usuarioId={usuarioId}
          zonas={zonas}
        />
      )}
      {activa === 'recepcion' && (
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
