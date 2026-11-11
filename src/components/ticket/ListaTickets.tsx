'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useMemoria } from '@/lib/memoria/useMemoria'
import { MiTrabajo } from './MiTrabajo'
import { useAvisosCambios } from '@/lib/datos/useAvisosCambios'
import { useParams } from 'next/navigation'
import { Alerta, Boton, Insignia } from '@/components/ui/Primitivos'
import { Modal } from '@/components/ui/Modal'
import { createClient } from '@/lib/supabase/client'
import { mensajeDeError } from '@/lib/errores'
import { hoyIso } from '@/lib/fechas'
import { useRouter } from 'next/navigation'
import { IconCheck, IconPlus, IconSearch, IconX } from '@/components/ui/Icons'
import { PROCESOS, estadoInfo, formatearFecha, procesoInfo } from '@/lib/estados'
import { NuevoTicketModal, type UsuarioTicket } from './NuevoTicketModal'
import { ArbolTickets } from './ArbolTickets'
import { BotonFiltros } from './FiltrosTickets'
import { leerCapturadores, leerResumen } from '@/lib/tickets/repositorio'
import {
  SIN_FILTROS,
  cuantosFiltros,
  type BloqueTickets,
  type Capturador,
  type FilaTicket as FilaTicketDato,
  type FiltrosTickets,
} from '@/lib/tickets/tipos'
import type { EstadoTicket } from '@/lib/types'
import { armarReglas, canExecuteAction, type ReglasPlanas } from '@/lib/permisos/clientABAC'
import { TicketsRecientes, inicioRecientes } from './TicketsRecientes'
import { BotonesProceso } from './BotonesProceso'
import {
  confirmarDestino,
  destinosPermitidos,
  mensajeMovidos,
  moverTickets,
  puedeMoverTicket,
  siguientePaso,
  type InfoProceso,
} from '@/lib/tickets/proceso'

export function ListaTickets({
  resumenInicial = [],
  capturadoresIniciales = [],
  usuarioId,
  nombreUsuario,
  departamento,
  temporadaActivaId,
  usuarios = [],
  temporadas = [],
  reglas: reglasPlanas,
  puedeOtroUsuario = false,
}: {
  /**
   * El árbol mes → proceso que el servidor ya trajo. Es una consulta
   * agregada de unas cien filas, no los tickets: los de cada bloque se
   * bajan al abrirlo.
   */
  resumenInicial?: BloqueTickets[]
  capturadoresIniciales?: Capturador[]
  usuarioId: string
  nombreUsuario: string
  departamento: string | null
  temporadaActivaId: string | null
  /** Para el ticket histórico: a nombre de quién se puede crear. */
  usuarios?: UsuarioTicket[]
  temporadas?: { id: string; nombre: string; activa: boolean }[]
  /**
   * Las reglas del usuario con sus tres ejes.
   *
   * Las acciones en masa se deciden TICKET POR TICKET: el alcance mira
   * quién lo capturó y la condición en qué paso del proceso está. Un
   * booleano de pantalla no sirve, que es justo lo que había aquí.
   */
  reglas: ReglasPlanas
  /** Si puede crear un ticket a nombre de otra persona. */
  puedeOtroUsuario?: boolean
}) {
  const params = useParams<{ ticketId?: string }>()
  const supabase = createClient()
  const router = useRouter()
  const reglas = useMemo(() => armarReglas(reglasPlanas), [reglasPlanas])

  // Mover el proceso: sólo quien tiene «Mover proceso» en la matriz (sql/86)
  const destinos = useMemo(() => destinosPermitidos(reglas), [reglas])
  // A nivel de PANTALLA: ¿tiene sentido ofrecer el modo selección?
  const puedeLotes = canExecuteAction(reglas, 'tickets', 'editar') || destinos.length > 0

  const atributos = useCallback(
    (t: FilaTicketDato) => ({
      duenoId: t.usuario_id,
      proceso: t.proceso,
      estado: t.estado,
    }),
    []
  )
  const puedeEditarTicket = useCallback(
    (t: FilaTicketDato) =>
      canExecuteAction(reglas, 'tickets', 'editar', atributos(t), { usuarioId }),
    [reglas, usuarioId, atributos]
  )
  const puedeEliminarTicket = useCallback(
    (t: FilaTicketDato) =>
      canExecuteAction(reglas, 'tickets', 'eliminar', atributos(t), { usuarioId }),
    [reglas, usuarioId, atributos]
  )
  const [abrirNuevo, setAbrirNuevo] = useState(false)
  const [modoSeleccion, setModoSeleccion] = useState(false)
  const [marcados, setMarcados] = useState<Set<string>>(new Set())
  const [abrirLote, setAbrirLote] = useState(false)

  // Lo que se ha bajado hasta ahora. La selección vive aquí porque el
  // árbol no sabe de acciones en masa, y «seleccionar todos» tiene que
  // significar algo honesto: lo que la persona abrió, no los cinco mil
  // del historial que nadie ha mirado.
  //
  // Guarda la FILA entera y no sólo el identificador: para decidir si una
  // acción en masa alcanza a un ticket hay que mirar quién lo capturó, en
  // qué paso del proceso está y si sigue abierto. Con un `Set` de ids no
  // se podía preguntar nada de eso.
  const [cargadas, setCargadas] = useState<Map<string, FilaTicketDato>>(new Map())
  const anotarCargadas = useCallback((filas: FilaTicketDato[]) => {
    setCargadas((antes) => {
      const copia = new Map(antes)
      for (const f of filas) copia.set(f.id, f)
      return copia
    })
  }, [])

  /* ------------------ Lo que la acción en masa alcanza ---------------- */
  //
  // Se recorta ANTES de mandar nada: cada ticket marcado pasa por
  // `canExecuteAction` con sus propios atributos, igual que hace la base.
  // Mandar los cinco mil y que RLS rechace tres mil deja el cambio a
  // medias —unos movidos y otros no— y sin forma de saber cuáles.
  const editables = useMemo(
    () => [...marcados].filter((id) => {
      const t = cargadas.get(id)
      return t ? puedeEditarTicket(t) : false
    }),
    [marcados, cargadas, puedeEditarTicket]
  )
  const borrables = useMemo(
    () => [...marcados].filter((id) => {
      const t = cargadas.get(id)
      return t ? puedeEliminarTicket(t) : false
    }),
    [marcados, cargadas, puedeEliminarTicket]
  )
  const movibles = useMemo(
    () => [...marcados].filter((id) => {
      const t = cargadas.get(id)
      return t ? puedeMoverTicket(reglas, t, usuarioId) : false
    }),
    [marcados, cargadas, reglas, usuarioId]
  )
  const omitidos = marcados.size - Math.max(editables.length, movibles.length)

  const [borrando, setBorrando] = useState(false)
  const [moviendo, setMoviendo] = useState(false)
  const [errorLote, setErrorLote] = useState<string | null>(null)
  const [avisoLote, setAvisoLote] = useState<string | null>(null)
  const [verAnteriores, setVerAnteriores] = useState(false)

  /** Mueve de proceso (un toque): los marcados o un ticket suelto. Luego se vuelve a consultar todo. */
  async function mover(ids: string[], destino: InfoProceso) {
    const aMover = ids.filter((id) => cargadas.get(id)?.proceso !== destino.valor)
    if (aMover.length === 0) return setAvisoLote(`Ya están en «${destino.numero} · ${destino.etiqueta}».`)
    if (!confirmarDestino(destino.valor, aMover.length)) return
    setMoviendo(true)
    setErrorLote(null)
    const { hechos, error: e } = await moverTickets(aMover, destino.valor)
    setMoviendo(false)
    if (e) return setErrorLote(e)
    setAvisoLote(mensajeMovidos(aMover.length, hechos, destino))
    setMarcados(new Set())
    setRevision((r) => r + 1)
  }

  async function eliminarEnMasa() {
    if (borrables.length === 0) return
    if (
      !window.confirm(
        `¿Eliminar ${borrables.length} ${borrables.length === 1 ? 'ticket' : 'tickets'}? ` +
          'Se van también sus horómetros y sus labores.'
      )
    ) {
      return
    }

    setBorrando(true)
    setErrorLote(null)
    const { error: e } = await supabase.from('tickets').delete().in('id', borrables)
    setBorrando(false)
    if (e) return setErrorLote(mensajeDeError(e, 'No se pudieron eliminar los tickets.'))
    salirDeSeleccion()
    router.refresh()
  }

  // Filtros y búsqueda se RECUERDAN por usuario (lib/memoria): al volver a Tickets siguen como se dejaron
  const [filtros, setFiltros] = useMemoria<FiltrosTickets>('tickets:filtros', SIN_FILTROS)
  const [bloques, setBloques] = useState<BloqueTickets[]>(resumenInicial)
  const [capturadores, setCapturadores] = useState<Capturador[]>(capturadoresIniciales)
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // El texto se escribe seguido, así que la consulta espera a que la
  // persona termine: sin esto serían ocho viajes para escribir «TK-1024».
  const [texto, setTexto] = useMemoria('tickets:texto', '')
  useEffect(() => {
    const t = setTimeout(() => {
      setFiltros((antes) => (antes.busqueda === texto ? antes : { ...antes, busqueda: texto }))
    }, 350)
    return () => clearTimeout(t)
  }, [texto, setFiltros])

  // Los CONTEOS se ponen al día solos (al volver a la ventana o cuando cambia un ticket), sin cerrar los meses
  // ni los bloques que la persona tiene abiertos: solo se reemplazan los números del resumen
  const ultimaCuenta = useRef(0)
  const recontar = useCallback(async () => {
    ultimaCuenta.current = Date.now()
    const { bloques: b, error: e } = await leerResumen(filtros)
    if (!e) setBloques(b)
  }, [filtros])
  const ultimaVezCuenta = useCallback(() => ultimaCuenta.current, [])
  useAvisosCambios({ tablas: ['tickets'], alCambiar: () => void recontar(), ultima: ultimaVezCuenta })

  /**
   * Cuántas veces el servidor ha vuelto a contar.
   *
   * El árbol se armaba una sola vez con lo que trajo el servidor y no
   * volvía a mirarlo: cambiar el proceso de un ticket, cerrarlo o
   * eliminarlo llamaba a `router.refresh()`, el layout volvía a
   * consultar… y esta lista seguía enseñando el conteo viejo hasta que
   * alguien recargaba la página a mano.
   *
   * Un `resumenInicial` nuevo es exactamente «el servidor volvió a
   * contar». No se adopta tal cual —con un filtro puesto, lo que el
   * servidor trae es el resumen SIN filtrar—: se sube la revisión y se
   * vuelve a pedir lo que esta pantalla está mirando de verdad.
   *
   * Va en el render y no en un efecto: es el patrón que React documenta
   * para reajustar estado cuando cambia una prop.
   */
  const [resumenPrevio, setResumenPrevio] = useState(resumenInicial)
  const [revision, setRevision] = useState(0)
  if (resumenInicial !== resumenPrevio) {
    setResumenPrevio(resumenInicial)
    setRevision((r) => r + 1)
  }

  const huella = JSON.stringify(filtros)
  useEffect(() => {
    let vivo = true
    async function cargar() {
      setCargando(true)
      const { bloques: b, error: e } = await leerResumen(JSON.parse(huella) as FiltrosTickets)
      if (!vivo) return
      setBloques(b)
      setError(e)
      setCargando(false)
      // Con otro filtro —o después de una modificación—, lo bajado y lo
      // marcado dejan de valer.
      setCargadas(new Map())
      setMarcados(new Set())
    }
    cargar()
    return () => {
      vivo = false
    }
  }, [huella, revision])

  useEffect(() => {
    if (capturadoresIniciales.length > 0) return
    let vivo = true
    async function cargar() {
      const c = await leerCapturadores()
      if (vivo) setCapturadores(c)
    }
    cargar()
    return () => {
      vivo = false
    }
  }, [capturadoresIniciales.length])

  const meses = useMemo(
    () => [...new Set(bloques.map((b) => b.mes))].sort((a, b) => b.localeCompare(a)),
    [bloques]
  )
  const total = useMemo(() => bloques.reduce((a, b) => a + Number(b.cuantos), 0), [bloques])


  const hoyMes = hoyIso().slice(0, 7)

  /** Cada ticket; quien puede mover el proceso tiene en la fila el botón del siguiente paso (un toque). */
  const dibujarFila = (t: FilaTicketDato) => {
    const sig = !modoSeleccion && puedeMoverTicket(reglas, t, usuarioId) ? siguientePaso(reglas, t.proceso) : null
    return (
      <FilaTicket
        key={t.id}
        ticket={t}
        seleccionado={params?.ticketId === t.id}
        modoSeleccion={modoSeleccion}
        marcado={marcados.has(t.id)}
        onMarcar={() => alternarMarcado(t.id)}
        accionRapida={
          sig ? (
            <button
              type="button"
              disabled={moviendo}
              data-paso-rapido={sig.valor}
              onClick={() => void mover([t.id], sig)}
              title={`Pasar a ${sig.numero} · ${sig.etiqueta}`}
              className="shrink-0 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-brand-700 ring-1 ring-inset ring-brand-200 hover:bg-brand-50 disabled:opacity-50"
            >
              → {sig.numero} · {sig.etiqueta}
            </button>
          ) : null
        }
      />
    )
  }

  function alternarMarcado(id: string) {
    setMarcados((prev) => {
      const copia = new Set(prev)
      if (copia.has(id)) copia.delete(id)
      else copia.add(id)
      return copia
    })
  }

  function salirDeSeleccion() {
    setModoSeleccion(false)
    setMarcados(new Set())
  }

  return (
    <>
      <div className="sticky top-0 z-10 border-b border-slate-200 bg-white/90 px-4 py-3 backdrop-blur-md lg:px-4">
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-base font-bold text-slate-900">
            {modoSeleccion ? `${marcados.size} seleccionados` : 'Tickets'}
          </h1>
          <div className="flex items-center gap-1.5">
            {!modoSeleccion && (
              <BotonFiltros
                filtros={filtros}
                meses={meses}
                capturadores={capturadores}
                onCambiar={setFiltros}
              />
            )}
            {puedeLotes &&
              (modoSeleccion ? (
                <button
                  onClick={salirDeSeleccion}
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-sm font-semibold text-slate-500 hover:bg-slate-100"
                >
                  <IconX className="h-4 w-4" />
                  Salir
                </button>
              ) : (
                <button
                  onClick={() => setModoSeleccion(true)}
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-sm font-semibold text-slate-500 hover:bg-slate-100"
                  title="Seleccionar varios"
                >
                  <IconCheck className="h-4 w-4" />
                  Varios
                </button>
              ))}

            {!modoSeleccion && (
              <button
                onClick={() => setAbrirNuevo(true)}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-brand-700 px-3 text-sm font-semibold text-white shadow-[var(--shadow-raised)] transition-all hover:bg-brand-800 active:scale-[0.98]"
              >
                <IconPlus className="h-4 w-4" />
                Nuevo
              </button>
            )}
          </div>
        </div>

        {modoSeleccion && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5" data-seleccion-rapida>
            {/* Seleccionar por paso: «todos los que siguen en 0 · Registrado» es lo que se manda a revisión */}
            {PROCESOS.map((p) => {
              const ids = [...cargadas.values()].filter((t) => t.proceso === p.valor).map((t) => t.id)
              if (ids.length === 0) return null
              return (
                <button
                  key={p.valor}
                  type="button"
                  data-seleccionar-proceso={p.valor}
                  onClick={() => setMarcados(new Set(ids))}
                  className="rounded-full px-2.5 py-1 text-xs font-semibold text-brand-700 ring-1 ring-inset ring-brand-200 hover:bg-brand-50"
                >
                  Todos en {p.numero} · {p.etiqueta} ({ids.length})
                </button>
              )
            })}
            <button
              onClick={() => setMarcados(new Set(cargadas.keys()))}
              className="rounded-md px-2 py-1 text-xs font-semibold text-brand-700 hover:bg-brand-50"
            >
              Todos los visibles ({cargadas.size})
            </button>
            {marcados.size > 0 && (
              <button
                onClick={() => setMarcados(new Set())}
                className="rounded-md px-2 py-1 text-xs font-semibold text-slate-500 hover:bg-slate-100"
              >
                Limpiar
              </button>
            )}
          </div>
        )}

        <div className="relative mt-3">
          <IconSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-300" />
          <input
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder="Buscar en todo el historial…"
            className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-sm transition-colors placeholder:text-slate-300 focus:border-brand-600 focus:bg-white focus:outline-none focus:ring-4 focus:ring-brand-600/10"
          />
        </div>
      </div>

      <div className="scroll-suave flex-1 overflow-y-auto px-3 py-3 lg:px-3">
        {/* Lo primero en el teléfono: el ticket de hoy y lo pendiente. Se oculta al buscar o filtrar, que es
            cuando se viene a consultar el historial */}
        {!modoSeleccion && cuantosFiltros(filtros) === 0 && (
          <MiTrabajo usuarioId={usuarioId} onNuevo={() => setAbrirNuevo(true)} />
        )}

        {avisoLote && (
          <div className="mb-3" data-aviso-lote>
            <Alerta tono="azul">{avisoLote}</Alerta>
          </div>
        )}

        {filtros.meses.length === 0 ? (
          <>
            {/* Lo reciente de una sola vez, por día: el mes en curso (y en cambio de mes, los últimos 10 días) */}
            <h2 className="px-1 pb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
              Recientes · desde el {inicioRecientes().split('-').reverse().slice(0, 2).join('/')}
            </h2>
            <TicketsRecientes
              filtros={filtros}
              revision={revision}
              fila={dibujarFila}
              onFilasCargadas={anotarCargadas}
              accionDia={(tickets) =>
                modoSeleccion ? (
                  <button
                    type="button"
                    data-seleccionar-dia
                    onClick={() => setMarcados((m) => new Set([...m, ...tickets.map((t) => t.id)]))}
                    className="rounded-md px-2 py-0.5 text-xs font-semibold text-brand-700 hover:bg-brand-50"
                  >
                    Seleccionar el día
                  </button>
                ) : null
              }
            />

            <button
              type="button"
              onClick={() => setVerAnteriores((v) => !v)}
              aria-expanded={verAnteriores}
              data-ver-anteriores
              className="mt-4 flex w-full items-center justify-between rounded-xl bg-white px-3 py-2.5 text-sm font-semibold text-slate-600 ring-1 ring-inset ring-slate-200/80 hover:bg-slate-50"
            >
              <span>Meses anteriores</span>
              <span className="text-xs text-slate-400">{verAnteriores ? 'Ocultar' : 'Ver por mes ›'}</span>
            </button>
            {verAnteriores && (
              <div className="mt-2">
                <ArbolTickets
                  bloques={bloques.filter((b) => b.mes < hoyMes)}
                  filtros={filtros}
                  cargandoResumen={cargando && bloques.length === 0}
                  error={error}
                  revision={revision}
                  onFilasCargadas={anotarCargadas}
                  fila={dibujarFila}
                />
              </div>
            )}
          </>
        ) : (
          <>
            <h2 className="px-1 pb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
              Historial · {total} {total === 1 ? 'ticket' : 'tickets'}
            </h2>
            <ArbolTickets
              bloques={bloques}
              filtros={filtros}
              cargandoResumen={cargando && bloques.length === 0}
              error={error}
              revision={revision}
              onFilasCargadas={anotarCargadas}
              fila={dibujarFila}
            />
          </>
        )}
      </div>

      {modoSeleccion && marcados.size > 0 && (
        <div className="sticky bottom-0 z-10 flex flex-col gap-2 border-t border-slate-200 bg-white/95 p-3 backdrop-blur-md">
          {/* Lo que el permiso de esta persona NO alcanza se dice ANTES
              de pulsar, no después: pulsar y que la base rechace la
              mitad deja el cambio a medias y sin explicación. */}
          {omitidos > 0 && (
            <p className="text-xs text-slate-500">
              <strong>{omitidos}</strong> de los {marcados.size} seleccionados quedan fuera: o ya
              están notificados, o tu permiso no alcanza a ellos.
            </p>
          )}

          {/* Un toque por destino: «Pasar a 1 · Revisando», etc. (antes: botón → ventana → lista → aplicar) */}
          {movibles.length > 0 && (
            <BotonesProceso
              destinos={destinos}
              ocupado={moviendo}
              resaltar={(() => {
                const pasos = new Set(movibles.map((id) => cargadas.get(id)?.proceso))
                const unico = pasos.size === 1 ? [...pasos][0] : null
                return unico ? (siguientePaso(reglas, unico)?.valor ?? null) : null
              })()}
              onElegir={(d) => void mover(movibles, d)}
              prefijo={`${movibles.length} ${movibles.length === 1 ? 'ticket' : 'tickets'} a`}
              grande
            />
          )}

          {editables.length > 0 && (
            <button
              type="button"
              onClick={() => setAbrirLote(true)}
              className="self-start text-xs font-semibold text-slate-500 hover:underline"
            >
              Activar o cerrar {editables.length}…
            </button>
          )}

          {borrables.length > 0 && (
            <Boton
              variante="peligro"
              className="w-full"
              disabled={borrando}
              onClick={() => void eliminarEnMasa()}
            >
              {borrando ? 'Eliminando…' : `Eliminar ${borrables.length}`}
            </Boton>
          )}

          {errorLote && <Alerta>{errorLote}</Alerta>}
        </div>
      )}

      <AccionesLoteModal
        abierto={abrirLote}
        cantidad={editables.length}
        ticketIds={editables}
        onCerrar={() => setAbrirLote(false)}
        onListo={salirDeSeleccion}
      />

      <NuevoTicketModal
        abierto={abrirNuevo}
        onCerrar={() => setAbrirNuevo(false)}
        usuarioId={usuarioId}
        nombreUsuario={nombreUsuario}
        departamento={departamento}
        temporadaActivaId={temporadaActivaId}
        usuarios={usuarios}
        temporadas={temporadas}
        puedeOtroUsuario={puedeOtroUsuario}
      />
    </>
  )
}

function FilaTicket({
  ticket,
  seleccionado,
  modoSeleccion,
  marcado,
  onMarcar,
  accionRapida,
}: {
  ticket: FilaTicketDato
  seleccionado: boolean
  modoSeleccion: boolean
  marcado: boolean
  onMarcar: () => void
  /** Botón de un toque (p. ej. «→ 1 · Revisando») para quien puede mover el proceso. */
  accionRapida?: React.ReactNode
}) {
  const estado = estadoInfo(ticket.estado)
  const proceso = procesoInfo(ticket.proceso)

  const clases = `group block rounded-xl border px-3.5 py-3 transition-all ${
    marcado
      ? 'border-brand-600 bg-brand-50 shadow-[var(--shadow-card)]'
      : seleccionado
        ? 'border-brand-600/30 bg-brand-50 shadow-[var(--shadow-card)]'
        : 'border-slate-200/80 bg-white hover:border-slate-300 hover:shadow-[var(--shadow-card)]'
  }`

  // En modo selección la fila deja de navegar y sólo marca/desmarca.
  const contenido = (
    <>
      <div className="flex items-start justify-between gap-2">
        {/* Quién y qué día: el código largo va pequeño (se usa para buscar y en SAP) */}
        <p
          className={`truncate text-sm font-semibold ${
            seleccionado ? 'text-brand-900' : 'text-slate-900'
          }`}
        >
          {ticket.usuario_nombre ?? formatearFecha(ticket.fecha)}
          <span className="block truncate text-[11px] font-normal text-slate-400">{ticket.codigo}</span>
        </p>
        <span
          className={`mt-1 h-2 w-2 shrink-0 rounded-full ${
            ticket.estado === 'ABIERTO' ? 'bg-brand-500' : 'bg-slate-300'
          }`}
          title={estado.etiqueta}
        />
      </div>

      <div className="mt-1.5 flex items-center gap-2 text-xs text-slate-400">
        <span>{formatearFecha(ticket.fecha)}</span>
        {ticket.departamento && (
          <>
            <span className="text-slate-200">·</span>
            <span className="truncate">{ticket.departamento}</span>
          </>
        )}
      </div>

      <div className="mt-2 flex items-center gap-1.5">
        <Insignia tono={proceso.tono}>
          {proceso.numero} · {proceso.etiqueta}
        </Insignia>
        {ticket.estado !== 'ABIERTO' && <Insignia tono={estado.tono}>{estado.etiqueta}</Insignia>}
      </div>
    </>
  )

  if (modoSeleccion) {
    return (
      <button type="button" onClick={onMarcar} className={`${clases} w-full text-left`}>
        <div className="flex items-start gap-2.5">
          <span
            className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-all ${
              marcado ? 'border-brand-700 bg-brand-700 text-white' : 'border-slate-300 bg-white'
            }`}
          >
            {marcado && <IconCheck className="h-3.5 w-3.5" />}
          </span>
          <span className="min-w-0 flex-1">{contenido}</span>
        </div>
      </button>
    )
  }

  return (
    // El botón rápido va FUERA del enlace (un botón dentro de un <a> no es válido), encima de su esquina
    <div className="relative">
      <Link href={`/tickets/${ticket.id}`} className={clases}>
        {contenido}
      </Link>
      {accionRapida && <div className="absolute bottom-2.5 right-3">{accionRapida}</div>}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Cambio de estado y proceso en bloque                                */
/* ------------------------------------------------------------------ */
/* Activar o cerrar en bloque (el proceso se mueve con los botones)    */
/* ------------------------------------------------------------------ */

function AccionesLoteModal({
  abierto,
  cantidad,
  ticketIds,
  onCerrar,
  onListo,
}: {
  abierto: boolean
  cantidad: number
  ticketIds: string[]
  onCerrar: () => void
  onListo: () => void
}) {
  const supabase = createClient()
  const router = useRouter()
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function aplicar(estado: EstadoTicket) {
    setError(null)
    setGuardando(true)
    const { error: e } = await supabase.rpc('actualizar_tickets_masivo', {
      p_ticket_ids: ticketIds,
      p_estado: estado,
      p_proceso: null,
    })
    setGuardando(false)
    if (e) return setError(e.message)
    onCerrar()
    onListo()
    router.refresh()
  }

  return (
    <Modal abierto={abierto} onCerrar={onCerrar} titulo={`Activar o cerrar ${cantidad} tickets`}>
      <div className="flex flex-col gap-4">
        <p className="text-sm text-slate-500">
          El estado marca si el ticket se sigue capturando. El proceso se cambia con los botones de la barra.
        </p>
        <div className="grid grid-cols-2 gap-2">
          <Boton variante="secundario" disabled={guardando} onClick={() => void aplicar('ABIERTO')}>
            Activar
          </Boton>
          <Boton variante="secundario" disabled={guardando} onClick={() => void aplicar('CERRADO')}>
            Cerrar
          </Boton>
        </div>
        {error && <Alerta>{error}</Alerta>}
      </div>
    </Modal>
  )
}