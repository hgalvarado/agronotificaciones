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
  canExecuteAction,
  filtrarPorZona,
  zonasParaCrear,
  type ReglasPlanas,
} from '@/lib/permisos/clientABAC'
import {
  AVISO_SIN_MIGRACION,
  leerJornales,
  leerLotes,
  leerObjetivosControl,
} from '@/lib/desinfeccion/repositorioCliente'
import { recortarDejandoSinZona } from '@/lib/desinfeccion/calculo'
import type {
  CatalogosDesinfeccion,
  LoteDesinfeccion,
  ObjetivoControl,
} from '@/lib/desinfeccion/tipos'
import { GridPlan } from './GridPlan'
import { GridEjecucion } from './GridEjecucion'
import { GridLogistica } from './GridLogistica'
import { DesinfeccionDashboard } from './DesinfeccionDashboard'
import { InformeEjecutivo } from './InformeEjecutivo'

type Pestana = 'plan' | 'ejecucion' | 'logistica' | 'reporte'

/**
 * Cada pestaña con SU pantalla de permisos.
 *
 * Hasta la 66 las cuatro compartían el identificador `desinfeccion`, y
 * con eso no se podía dar la captura sin dar el reporte de costos —que
 * es justo el reparto que la finca necesita—. Ahora son cuatro llaves
 * distintas y esta tabla es el único sitio donde se dice cuál va con
 * cuál.
 */
const PESTANAS: { valor: Pestana; etiqueta: string; pantalla: string }[] = [
  { valor: 'plan', etiqueta: 'Planificación', pantalla: 'desinfeccion_plan' },
  { valor: 'ejecucion', etiqueta: 'Ejecución', pantalla: 'desinfeccion_ejecucion' },
  { valor: 'logistica', etiqueta: 'Logística', pantalla: 'desinfeccion_logistica' },
  { valor: 'reporte', etiqueta: 'Reporte', pantalla: 'desinfeccion_reporte' },
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

  /**
   * Las pestañas que esta persona puede ver, y SÓLO ésas.
   *
   * No se dibujan en gris: no se dibujan. Una pestaña visible que al
   * pulsarla contesta «no tienes permiso» enseña el mapa del módulo a
   * quien no tiene que verlo, y encima parece un fallo.
   */
  const visibles = useMemo(
    () => PESTANAS.filter((p) => canExecuteAction(reglas, p.pantalla, 'ver')),
    [reglas]
  )

  const temporadaActiva =
    catalogos.temporadas.find((t) => t.activa)?.id ?? catalogos.temporadas[0]?.id ?? ''
  const [temporadaId, setTemporadaId] = useState(temporadaActiva)
  // Se abre por la Ejecución, que es donde se trabaja a diario… salvo
  // que no se tenga, en cuyo caso por la primera que sí.
  const [pestana, setPestana] = useState<Pestana>('ejecucion')
  /** Qué mirada de Reportes está puesta. El informe primero: es el nuevo. */
  const [vista, setVista] = useState<'informe' | 'tablero'>('informe')
  const activa: Pestana | null =
    visibles.find((p) => p.valor === pestana)?.valor ?? visibles[0]?.valor ?? null
  const [sinMigracion, setSinMigracion] = useState(false)
  const [causaMigracion, setCausaMigracion] = useState<string | null>(null)
  const [lotes, setLotes] = useState<LoteDesinfeccion[]>([])
  /**
   * Los operadores, en estado y no sólo en la prop.
   *
   * El selector de cuadrilla deja crear un jornal sin salir del
   * formulario, y recargar la página entera para verlo en la lista sería
   * perder lo que se llevaba escrito.
   */
  const [operadores, setOperadores] = useState(catalogos.operadores)

  const catalogosVivos = useMemo(
    () => ({ ...catalogos, operadores }),
    [catalogos, operadores]
  )

  const recargarJornales = useCallback(async () => {
    setOperadores(await leerJornales())
  }, [])

  /*
   * El catálogo de objetivos de control (migración 75).
   *
   * Vive AQUÍ y no en la página de servidor por la misma razón que los
   * jornales: se puede dar de alta uno desde la captura, y volver a
   * bajarlo tiene que poder hacerse sin `router.refresh()` —que vuelve
   * a montar el formulario y se lleva por delante el turno a medio
   * llenar—.
   */
  const [objetivos, setObjetivos] = useState<ObjetivoControl[]>([])
  const recargarObjetivos = useCallback(async () => {
    setObjetivos(await leerObjetivosControl())
  }, [])

  // El mismo patrón que la carga de lotes: la bandera `vivo` evita
  // escribir el estado de una petición que ya no interesa, y el
  // `setState` queda dentro de la callback y no en el cuerpo del efecto.
  useEffect(() => {
    let vivo = true
    async function cargar() {
      const datos = await leerObjetivosControl()
      if (vivo) setObjetivos(datos)
    }
    void cargar()
    return () => {
      vivo = false
    }
  }, [])

  /*
   * El aviso de instalación, con su causa.
   *
   * Antes era un booleano suelto y el texto estaba escrito en la
   * pantalla: cualquier fallo de lectura —un permiso, la caché de
   * esquema de PostgREST, la red— acababa diciendo «corre las
   * migraciones 59 y 60», que para quien ya las tenía puestas es un
   * diagnóstico falso y un callejón sin salida. Ahora quien detecta el
   * fallo manda también el texto, y sólo lo manda cuando la base dice
   * que la relación no existe.
   */
  const avisarMigracion = useCallback((falta: boolean, causa: string | null = null) => {
    setSinMigracion(falta)
    setCausaMigracion(causa)
  }, [])

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

  /*
   * Los tres selectores del módulo, recortados por zona.
   *
   * Con alcance zonal al CREAR, lote, turno y estación sólo ofrecen lo
   * asignado: dejar elegir una zona ajena es dejar llenar el formulario
   * entero para que la base lo rechace al guardar. Va AQUÍ y no en cada
   * formulario para que el alta y la edición no acaben ofreciendo listas
   * distintas.
   *
   * La diferencia entre las tres no es un descuido:
   *
   *   · Lote y turno SIEMPRE tienen zona, así que lo que no cae en las
   *     permitidas se cae de la lista.
   *   · La estación de riego ganó zona en la 60 y nace NULA. Una estación
   *     sin asignar la sigue viendo todo el mundo — si no, el día que se
   *     instala la migración no habría ninguna estación utilizable.
   */
  const zonasPermitidas = useMemo(
    () => zonasParaCrear(reglas, 'desinfeccion_ejecucion', zonasDelPerfil),
    [reglas, zonasDelPerfil]
  )

  const lotesVisibles = useMemo(
    () => filtrarPorZona(lotes, (l) => l.zona_id, zonasPermitidas),
    [lotes, zonasPermitidas]
  )

  const turnosVisibles = useMemo(
    () => filtrarPorZona(catalogos.turnos, (t) => t.zona_id, zonasPermitidas),
    [catalogos.turnos, zonasPermitidas]
  )

  const estacionesVisibles = useMemo(
    () => recortarDejandoSinZona(catalogos.estaciones, (e) => e.zona_id, zonasPermitidas),
    [catalogos.estaciones, zonasPermitidas]
  )

  if (sinMigracion)
    return <Alerta tono="ambar">{causaMigracion ?? AVISO_SIN_MIGRACION}</Alerta>

  if (visibles.length === 0) {
    return (
      <Alerta tono="ambar">
        No tienes permiso sobre ninguna parte de Desinfección. Si crees que sí deberías, pídele al
        Administrador que lo revise en Permisos.
      </Alerta>
    )
  }

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

      {activa === 'plan' && (
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

      {activa === 'ejecucion' && (
        <GridEjecucion
          temporadaId={temporadaId}
          catalogos={catalogosVivos}
          lotes={lotesVisibles}
          turnos={turnosVisibles}
          estaciones={estacionesVisibles}
          onJornalCreado={() => void recargarJornales()}
          reglas={reglas}
          usuarioId={usuarioId}
          zonas={zonasDelPerfil}
          onSinMigracion={avisarMigracion}
          objetivos={objetivos}
          recargarObjetivos={() => void recargarObjetivos()}
        />
      )}

      {activa === 'logistica' && (
        <GridLogistica
          temporadaId={temporadaId}
          catalogos={catalogos}
          reglas={reglas}
          usuarioId={usuarioId}
          zonas={zonasDelPerfil}
          onSinMigracion={avisarMigracion}
        />
      )}

      {/*
        Dos miradas, y son dos preguntas distintas (migración 71):

          · El INFORME baja a un lote y cuenta su historia entera —cuándo,
            si se cumplió, dónde se fue el dinero, contra qué se aplicó—.
            Es lo que se lleva a una reunión.
          · El TABLERO de la 67 mira el periodo completo: cuál se me fue
            de precio, cuántas manzanas llevo. Es lo que se mira a diario.

        Juntarlas en una pantalla haría que ninguna de las dos se
        contestara bien, así que conviven con un interruptor.
      */}
      {activa === 'reporte' && (
        <div className="flex flex-col gap-3">
          <div className="flex gap-1 rounded-xl bg-slate-100 p-1">
            {(
              [
                ['informe', 'Informe por lote'],
                ['tablero', 'Tablero del periodo'],
              ] as const
            ).map(([v, texto]) => (
              <button
                key={v}
                type="button"
                onClick={() => setVista(v)}
                className={`flex-1 rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors ${
                  vista === v
                    ? 'bg-white text-slate-900 shadow-[var(--shadow-card)]'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                {texto}
              </button>
            ))}
          </div>

          {vista === 'informe' ? (
            <InformeEjecutivo
              temporadaId={temporadaId}
              zonas={catalogos.zonas}
              reglas={reglas}
              onSinMigracion={avisarMigracion}
            />
          ) : (
            <DesinfeccionDashboard
              temporadaId={temporadaId}
              zonas={catalogos.zonas}
              reglas={reglas}
              onSinMigracion={avisarMigracion}
            />
          )}
        </div>
      )}
    </div>
  )
}
