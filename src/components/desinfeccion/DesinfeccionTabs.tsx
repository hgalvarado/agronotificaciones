'use client'

/**
 * Las cuatro vistas del módulo en una sola pantalla.
 *
 * Este componente no sabe de negocio: enruta entre pestañas, lleva el
 * único filtro global —la temporada— y baja el catálogo de lotes, que es
 * lo único que depende de ella. Cada pestaña consulta lo suyo.
 *
 * Las pestañas siguen el orden del proceso, no el de las tablas: se
 * planifica, se ejecuta, se carga el acarreo y al final se mira lo que
 * costó. Quien entra por primera vez puede recorrerlas de izquierda a
 * derecha sin que nadie se lo explique.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alerta, Campo, Selector, Tarjeta } from '@/components/ui/Primitivos'
import {
  armarReglas,
  filtrarPorZona,
  zonasParaCrear,
  type ReglasPlanas,
} from '@/lib/permisos/clientABAC'
import { AVISO_SIN_MIGRACION, leerLotes } from '@/lib/desinfeccion/repositorioCliente'
import type { CatalogosDesinfeccion, LoteDesinfeccion } from '@/lib/desinfeccion/tipos'
import { GridPlan } from './GridPlan'
import { GridEjecucion } from './GridEjecucion'
import { GridLogistica } from './GridLogistica'
import { ReporteCostos } from './ReporteCostos'

type Pestana = 'plan' | 'ejecucion' | 'logistica' | 'reporte'

const PESTANAS: [Pestana, string][] = [
  ['plan', 'Planificación'],
  ['ejecucion', 'Ejecución'],
  ['logistica', 'Logística'],
  ['reporte', 'Reporte'],
]

export function DesinfeccionTabs({
  catalogos,
  reglas: reglasPlanas,
  usuarioId,
  zonas,
}: {
  catalogos: CatalogosDesinfeccion
  /** Las reglas con sus tres ejes: cada cuadrícula decide POR FILA. */
  reglas: ReglasPlanas
  usuarioId: string | null
  /** Las zonas asignadas. Vacío quiere decir «sin recorte zonal». */
  zonas: string[]
}) {
  const reglas = useMemo(() => armarReglas(reglasPlanas), [reglasPlanas])
  const zonasDelPerfil = useMemo(() => new Set(zonas), [zonas])

  const temporadaActiva =
    catalogos.temporadas.find((t) => t.activa)?.id ?? catalogos.temporadas[0]?.id ?? ''
  const [temporadaId, setTemporadaId] = useState(temporadaActiva)
  const [pestana, setPestana] = useState<Pestana>('ejecucion')
  const [sinMigracion, setSinMigracion] = useState(false)
  const [lotes, setLotes] = useState<LoteDesinfeccion[]>([])

  const avisarMigracion = useCallback((falta: boolean) => setSinMigracion(falta), [])

  useEffect(() => {
    let vivo = true
    async function cargar() {
      const datos = await leerLotes(temporadaId)
      if (vivo) setLotes(datos)
    }
    void cargar()
    return () => {
      vivo = false
    }
  }, [temporadaId])

  // Con alcance zonal al CREAR, los selectores de lote sólo ofrecen lo
  // asignado. Va aquí y no en cada formulario para que el alta y la
  // edición no acaben ofreciendo listas distintas.
  const lotesVisibles = useMemo(
    () =>
      filtrarPorZona(
        lotes,
        (l) => l.zona_id,
        zonasParaCrear(reglas, 'desinfeccion', zonasDelPerfil)
      ),
    [lotes, reglas, zonasDelPerfil]
  )

  if (sinMigracion) return <Alerta tono="ambar">{AVISO_SIN_MIGRACION}</Alerta>

  return (
    <div className="flex flex-col gap-4">
      <Tarjeta className="p-4">
        <Campo
          etiqueta="Temporada"
          ayuda="Todo el módulo —plan, ejecución, acarreo y costos— es de la temporada que elijas."
        >
          <Selector value={temporadaId} onChange={(e) => setTemporadaId(e.target.value)}>
            <option value="">Todas</option>
            {catalogos.temporadas.map((t) => (
              <option key={t.id} value={t.id}>
                {t.nombre}
                {t.activa ? ' (activa)' : ''}
              </option>
            ))}
          </Selector>
        </Campo>
      </Tarjeta>

      {/* Se desplaza de lado en el teléfono en vez de partirse en dos
          renglones: con cuatro pestañas, dos renglones comen la mitad de
          lo que se ve antes de empezar a leer. */}
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

      {pestana === 'plan' && (
        <GridPlan
          temporadaId={temporadaId}
          catalogos={catalogos}
          lotes={lotesVisibles}
          reglas={reglas}
          usuarioId={usuarioId}
          zonas={zonasDelPerfil}
          onSinMigracion={avisarMigracion}
        />
      )}

      {pestana === 'ejecucion' && (
        <GridEjecucion
          temporadaId={temporadaId}
          catalogos={catalogos}
          lotes={lotesVisibles}
          reglas={reglas}
          usuarioId={usuarioId}
          zonas={zonasDelPerfil}
          onSinMigracion={avisarMigracion}
        />
      )}

      {pestana === 'logistica' && (
        <GridLogistica
          temporadaId={temporadaId}
          catalogos={catalogos}
          reglas={reglas}
          usuarioId={usuarioId}
          zonas={zonasDelPerfil}
          onSinMigracion={avisarMigracion}
        />
      )}

      {pestana === 'reporte' && (
        <ReporteCostos
          temporadaId={temporadaId}
          reglas={reglas}
          onSinMigracion={avisarMigracion}
        />
      )}
    </div>
  )
}
