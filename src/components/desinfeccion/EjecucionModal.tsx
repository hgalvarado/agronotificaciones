'use client'

/**
 * El embudo de captura de un turno de desinfección.
 *
 * **El activador va fuera del acordeón.** Lo primero es TURNO y CICLO:
 * con esos dos o se abre el turno que ya existe o se empieza uno. Sin
 * ese paso, capturar el preriego el lunes y la aplicación el jueves
 * creaba dos turnos distintos y el costo se partía en dos.
 *
 *   0 · Lotes y manzanas   ← bloquea a las demás
 *   1 · Preriego           + su cuadrilla
 *   2 · Lecturas
 *   3 · Aplicación         + sus químicos y su cuadrilla
 *
 * **La cuadrilla vive DENTRO de su fase** desde la 61. Antes era una
 * sección aparte al final y había que recordar de qué día era cada
 * renglón; ahora la del preriego se captura con el preriego y la de la
 * aplicación con la aplicación, que es como se trabaja.
 *
 * **El candado se decide al CARGAR, no mientras se escribe.** Es el
 * arreglo de la fricción que reportó campo: la versión anterior miraba
 * el estado vivo, así que la sección se cerraba sola en cuanto se
 * terminaba de llenar —a media captura, con el dedo todavía en el
 * teclado—. Ahora sólo se bloquea lo que ya venía guardado de la base.
 */

import { useCallback, useMemo, useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { DesglosePpmModal } from './DesglosePpmModal'
import { CAMPOS_PERSONAL, FormularioCatalogo } from '@/components/catalogos/FormularioCatalogo'
import { Acordeon } from '@/components/ui/Acordeon'
import {
  Alerta,
  Boton,
  Campo,
  Entrada,
  Grupo,
  Insignia,
  Selector,
  bordeError,
} from '@/components/ui/Primitivos'
import { EntradaReloj } from '@/components/ui/EntradaReloj'
import { IconCheck, IconLock, IconPlus, IconTrash } from '@/components/ui/Icons'
import { n2 } from '@/lib/trasplante/formato'
import { hoyIso } from '@/lib/fechas'
import {
  crearJornal,
  crearObjetivoControl,
  precioMaterial,
  textoMotivoPrecio,
} from '@/lib/desinfeccion/repositorioCliente'
import {
  SECCIONES,
  costoCuadrilla,
  costoPersonal,
  costoProducto,
  costoQuimicos,
  dosisPorMz,
  horasInyeccion,
  aguaTotal,
  desglosePpm,
  horasLavado,
  horasPreriego,
  horasPresurizacion,
  ppmDe,
  mzDeLotes,
  salarioDe,
  seccionLlena,
  siguienteSeccion,
  validarFormularioDetallado,
  textoDdt,
  totalHorasRiego,
  validarEjecucion,
  type SeccionEjecucion,
} from '@/lib/desinfeccion/calculo'
import { SelectorMultiple } from '@/components/ui/SelectorMultiple'
import {
  CICLOS,
  EQUIPOS_APLICACION,
  EQUIPO_OTROS,
  JORNADAS,
  LECTURA_VACIA,
  LINEA_LOTE_VACIA,
  PUESTOS_CUADRILLA,
  PUESTO_OTRO,
  TIPOS_ENVASE,
  etiquetaFase,
  lineaPersonalVacia,
  lineaProductoVacia,
  type CatalogosDesinfeccion,
  type EntradaEjecucion,
  type FasePersonal,
  type FaseProducto,
  type JornadaTipo,
  type LecturaTensiometro,
  type LineaLote,
  type LineaPersonal,
  type LineaProducto,
  type LoteDesinfeccion,
  type ObjetivoControl,
} from '@/lib/desinfeccion/tipos'

const TITULOS: Record<SeccionEjecucion, string> = {
  lotes: '0 · Lotes y manzanas',
  preriego: '1 · Preriego',
  lecturas: '2 · Lecturas de tensiómetro',
  aplicacion: '3 · Aplicación y químicos',
  lavado: '4 · Lavado de cinta',
}

export function EjecucionModal({
  entrada,
  lecturas,
  lotes,
  personal,
  productos,
  catalogos,
  lotesDisponibles,
  turnosDisponibles,
  estacionesDisponibles,
  fechasSiembra,
  siembraPrevista,
  /** Qué secciones venían llenas AL CARGAR. Es lo único que bloquea. */
  seccionesGuardadas,
  minimo,
  guardando,
  buscando,
  /** Lo que contestó la base al intentar guardar, si contestó mal. */
  errorGuardado,
  /** El catálogo de objetivos de control (migración 75). */
  objetivos,
  onObjetivoCreado,
  onActivar,
  onCambiarEntrada,
  onCambiarLecturas,
  onCambiarLotes,
  onCambiarPersonal,
  onCambiarProductos,
  onJornalCreado,
  onGuardar,
  onCerrar,
}: {
  entrada: EntradaEjecucion
  lecturas: LecturaTensiometro[]
  lotes: LineaLote[]
  personal: LineaPersonal[]
  productos: LineaProducto[]
  catalogos: CatalogosDesinfeccion
  lotesDisponibles: LoteDesinfeccion[]
  turnosDisponibles: CatalogosDesinfeccion['turnos']
  estacionesDisponibles: CatalogosDesinfeccion['estaciones']
  fechasSiembra: string[]
  /** Si esas fechas salen del PLAN de trasplante y no de una siembra ya hecha. */
  siembraPrevista: boolean
  seccionesGuardadas: SeccionEjecucion[]
  /** El salario mínimo vigente de la fecha de la fase. Lo trae la cuadrícula. */
  minimo: number | null
  guardando: boolean
  buscando: boolean
  errorGuardado?: { mensaje: string; detalle?: string | null } | null
  objetivos: ObjetivoControl[]
  onObjetivoCreado: () => void
  onActivar: (turnoId: string, ciclo: string) => void
  onCambiarEntrada: (e: EntradaEjecucion) => void
  onCambiarLecturas: (l: LecturaTensiometro[]) => void
  onCambiarLotes: (l: LineaLote[]) => void
  onCambiarPersonal: (p: LineaPersonal[]) => void
  onCambiarProductos: (q: LineaProducto[]) => void
  onJornalCreado: () => void
  onGuardar: () => void
  onCerrar: () => void
}) {
  /** Lo que la VALIDACIÓN tiene que decir. El fallo de la base llega por props. */
  const [error, setError] = useState<string | null>(null)
  /** Por qué el costo del químico se quedó en blanco, si se quedó. */
  const [avisoPrecio, setAvisoPrecio] = useState<string | null>(null)
  /** Qué línea de químico tiene abierto su desglose de ppm. */
  const [desgloseAbierto, setDesgloseAbierto] = useState<number | null>(null)
  const [abierta, setAbierta] = useState<SeccionEjecucion | null>(null)
  /** Las secciones que se han reabierto a mano para corregirlas. */
  const [desbloqueadas, setDesbloqueadas] = useState<Set<SeccionEjecucion>>(new Set())

  const activado = entrada.turnoId !== '' && entrada.ciclo !== ''
  const esNuevo = !entrada.id
  const mz = useMemo(() => mzDeLotes(lotes), [lotes])
  const lotesListos = mz > 0

  /* ----------------------- Por dónde se sigue ------------------------- */
  const huella = `${entrada.id}|${entrada.turnoId}|${entrada.ciclo}`
  const [huellaPrevia, setHuellaPrevia] = useState<string | null>(null)
  if (activado && huella !== huellaPrevia) {
    setHuellaPrevia(huella)
    setAbierta(siguienteSeccion(entrada, lotes, lecturas) ?? null)
    setDesbloqueadas(new Set())
  }

  /**
   * Guardada en la base y no reabierta a mano: se mira, no se toca.
   *
   * Mira `seccionesGuardadas` —una foto del momento de cargar— y NO el
   * estado vivo. Con el estado vivo, terminar de escribir la fecha y la
   * hora cerraba la sección en la cara de quien estaba capturando.
   */
  const guardadas = useMemo(() => new Set(seccionesGuardadas), [seccionesGuardadas])
  const bloqueada = useCallback(
    (s: SeccionEjecucion) => guardadas.has(s) && !desbloqueadas.has(s),
    [guardadas, desbloqueadas],
  )

  function desbloquear(s: SeccionEjecucion) {
    setDesbloqueadas((prev) => new Set(prev).add(s))
    setAbierta(s)
  }

  const cambiar = useCallback(
    (cambios: Partial<EntradaEjecucion>) => onCambiarEntrada({ ...entrada, ...cambios }),
    [entrada, onCambiarEntrada],
  )

  /**
   * El salario que se ESCRIBE en cada renglón de cuadrilla nuevo.
   *
   * Desde la 62 es un valor de verdad en el input y no un *placeholder*:
   * el texto gris parecía un número puesto y no lo era, así que quien no
   * lo tocaba guardaba un vacío. Lo calcula la cuadrícula, que es también
   * quien lo necesita al guardar para distinguir un renglón intacto de
   * uno tocado.
   */
  const salarioPorOmision = minimo === null ? '' : String(minimo)

  /* ------------------------------ Cuentas ------------------------------ */
  // Los químicos de CADA fase, y el total. El lavado se paga igual que
  // la inyección: lo que cambia es que no se mide en ppm.
  const quimicoAplicacion = useMemo(() => costoQuimicos(productos, '3_Aplicacion'), [productos])
  const quimicoLavado = useMemo(() => costoQuimicos(productos, '4_Lavado'), [productos])
  const quimico = quimicoAplicacion + quimicoLavado
  const obraPreriego = useMemo(
    () => costoCuadrilla(personal, minimo, '1_Preriego'),
    [personal, minimo],
  )
  const obraAplicacion = useMemo(
    () => costoCuadrilla(personal, minimo, '3_Aplicacion'),
    [personal, minimo],
  )
  const obraLavado = useMemo(() => costoCuadrilla(personal, minimo, '4_Lavado'), [personal, minimo])
  const duracionPreriego = horasPreriego(entrada)
  const presurizacion = horasPresurizacion(entrada)
  const inyeccion = horasInyeccion(entrada)
  const lavado = horasLavado(entrada)
  const totalHoras = totalHorasRiego(entrada)
  const agua = aguaTotal(entrada)

  const ddtPreriego = textoDdt(fechasSiembra, entrada.fechaPreriego)
  const ddtLecturas = textoDdt(fechasSiembra, entrada.fechaLecturas)
  const ddtAplicacion = textoDdt(fechasSiembra, entrada.fechaAplicacion)
  const ddtLavado = textoDdt(fechasSiembra, entrada.fechaLavado)
  const haySiembra = fechasSiembra.length > 0

  const granTotal = (obraPreriego ?? 0) + (obraAplicacion ?? 0) + (obraLavado ?? 0) + quimico
  const costoMz = mz > 0 ? granTotal / mz : null

  /* --------------------- El diagnóstico, en vivo ----------------------- */
  /*
   * Se recalcula en cada tecla y NO sólo al guardar.
   *
   * Es puro y barato —recorre cuatro listas cortas—, así que el borde
   * rojo y el distintivo de la cabecera aparecen mientras se escribe,
   * que es cuando la persona todavía tiene el dato en la cabeza. Un
   * error que sólo sale al pulsar Guardar llega cinco minutos tarde.
   */
  const diagnostico = useMemo(
    () => validarFormularioDetallado(entrada, lotes, personal, productos, lecturas),
    [entrada, lotes, personal, productos, lecturas],
  )

  /** Lo que el usuario YA intentó guardar: antes de eso no se le grita. */
  const [intentado, setIntentado] = useState(false)

  /**
   * Qué corregir en un campo.
   *
   * Hasta el primer intento de guardar sólo se señalan los errores de
   * FORMATO —letras en un campo numérico—, que son los que la persona
   * ve mientras teclea. Lo que falta por escribir no se marca todavía:
   * un formulario que nace en rojo enseña a ignorar el rojo.
   */
  const errorDe = useCallback(
    (campo: string): string | undefined => {
      const e = diagnostico.campos[campo]
      if (!e) return undefined
      if (intentado) return e
      return /tiene que ser un número/.test(e) ? e : undefined
    },
    [diagnostico, intentado],
  )

  /** ¿Esta sección tiene algo que revisar? Para el distintivo plegado. */
  const avisoSeccion = useCallback(
    (s: SeccionEjecucion): string | null => {
      if (!intentado) return null
      return diagnostico.secciones.find((x) => x.seccion === s)?.mensajes[0] ?? null
    },
    [diagnostico, intentado],
  )

  /* ------------------------------ Acciones ----------------------------- */

  function guardar() {
    setIntentado(true)

    /*
     * **Prohibido volver en silencio.**
     *
     * Antes, un problema que ninguna de las tres expresiones reconocía
     * dejaba el formulario igual: se pulsaba Guardar y no pasaba nada,
     * que para quien está en campo es la aplicación colgada.
     *
     * Ahora se abre la PRIMERA sección con problema y el banner dice en
     * cuál está y qué hay que corregir. El detallado va primero porque
     * sabe señalar el campo; `validarEjecucion` queda como la red de
     * seguridad para lo que sólo él comprueba —el ciclo, el turno, las
     * manzanas del paso 0—.
     */
    if (diagnostico.hay) {
      const s = diagnostico.secciones[0]
      setAbierta(s.seccion)
      setError(`${s.nombre}: ${s.mensajes[0]}`)
      return
    }

    const problema = validarEjecucion(entrada, lotes, personal, productos, salarioPorOmision)
    if (problema) {
      setError(problema)
      if (/lote|manzana/i.test(problema)) setAbierta('lotes')
      else if (/preriego/i.test(problema)) setAbierta('preriego')
      else if (/lavado/i.test(problema)) setAbierta('lavado')
      else if (/producto|litro|químico|quimico|cuadrilla|puesto|salario/i.test(problema)) {
        setAbierta('aplicacion')
      }
      return
    }
    setError(null)
    onGuardar()
  }

  const alternar = (s: SeccionEjecucion) => setAbierta((a) => (a === s ? null : s))

  const cambiarLectura = (i: number, c: Partial<LecturaTensiometro>) =>
    onCambiarLecturas(lecturas.map((l, j) => (i === j ? { ...l, ...c } : l)))
  const cambiarLote = (i: number, c: Partial<LineaLote>) =>
    onCambiarLotes(lotes.map((l, j) => (i === j ? { ...l, ...c } : l)))
  const cambiarProducto = (i: number, c: Partial<LineaProducto>) =>
    onCambiarProductos(productos.map((q, j) => (i === j ? { ...q, ...c } : q)))

  /**
   * Elegir el lote sugiere sus manzanas pendientes.
   *
   * Se SUGIERE, no se impone, y sólo si el renglón está vacío: el que
   * está en el lote sabe mejor que el plan cuántas manzanas regó, y
   * pisarle un número escrito sería cambiarle el dato sin decírselo.
   */
  function elegirLote(i: number, loteTemporadaId: string) {
    const lote = lotesDisponibles.find((l) => l.lote_temporada_id === loteTemporadaId)
    const vacio = (lotes[i]?.mzCubiertas ?? '').trim() === ''
    cambiarLote(i, {
      loteTemporadaId,
      ...(lote && vacio && lote.mz_restantes > 0
        ? { mzCubiertas: lote.mz_restantes.toFixed(2) }
        : {}),
    })
  }

  /**
   * Elegir el químico trae su precio vigente del historial.
   *
   * Se pide por la FECHA DE APLICACIÓN y por la TEMPORADA del turno, no
   * por la de hoy: un turno de marzo se costea con el precio de marzo y
   * con la tasa de cambio de SU temporada, aunque se capture en mayo. Es
   * la misma función que usa el disparador al guardar, así que el número
   * que se ve mientras se teclea y el que queda guardado son el mismo.
   *
   * Sólo rellena si el costo está VACÍO. Hay compras puntuales a otro
   * precio, y pisar un número escrito sería cambiarle el dato a quien lo
   * escribió sin decírselo —la misma regla de la sugerencia de manzanas—.
   *
   * **Y cuando no hay precio, lo DICE.** Ésa era la queja: la celda se
   * quedaba en blanco sin explicar si faltaba el precio, si la fecha
   * caía fuera de su vigencia o si estaba en dólares y faltaba la tasa.
   * Tres arreglos distintos y el mismo silencio para los tres.
   */
  async function elegirProducto(i: number, productoId: string) {
    const vacio = (productos[i]?.costoLitro ?? '').trim() === ''
    // La lista se actualiza DESDE la que había al entrar aquí, y el
    // resultado del `await` se aplica sobre esa misma: usar `productos`
    // después de esperar sería leer una foto vieja.
    const base = productos.map((q, j) => (j === i ? { ...q, productoId } : q))
    onCambiarProductos(base)
    setAvisoPrecio(null)
    if (!productoId || !vacio) return

    const r = await precioMaterial(
      productoId,
      entrada.fechaAplicacion || hoyIso(),
      entrada.temporadaId,
    )
    if (r.precio === null) {
      // Un cero en pantalla parecería un dato; el hueco con su motivo es
      // una tarea que alguien puede cerrar.
      setAvisoPrecio(textoMotivoPrecio(r.motivo))
      return
    }
    onCambiarProductos(base.map((q, j) => (j === i ? { ...q, costoLitro: String(r.precio) } : q)))
  }

  /* ------------------------- La cuadrilla, por fase -------------------- */

  const cambiarPersona = (i: number, c: Partial<LineaPersonal>) =>
    onCambiarPersonal(personal.map((p, j) => (i === j ? { ...p, ...c } : p)))

  /**
   * El renglón que está esperando a que se dé de alta a alguien.
   *
   * Se guarda el ÍNDICE y no sólo «está abierto»: cuando el alta termina
   * hay que meter a la persona en el renglón desde el que se pidió, no
   * en el último, que es donde acabaría si sólo se guardara una bandera.
   */
  const [altaPersonal, setAltaPersonal] = useState<{ indice: number } | null>(null)

  /*
   * Las opciones del selector de objetivos.
   *
   * La etiqueta lleva el GRUPO al lado —«Nematodos · Nematodos», «Mosca
   * Blanca · Insectos»— porque con veinte objetivos en una lista plana
   * nadie encuentra el suyo, y el grupo es lo que la gente de campo usa
   * para orientarse.
   */
  const opcionesObjetivo = useMemo(
    () =>
      objetivos.map((o) => ({
        valor: o.nombre,
        etiqueta: o.grupo ? `${o.nombre} · ${o.grupo}` : o.nombre,
      })),
    [objetivos]
  )

  /**
   * Dar de alta un objetivo sin salir de la captura.
   *
   * **Sin `router.refresh()`**, igual que el alta de personal: refrescar
   * la ruta vuelve a montar el formulario y se pierde el turno a medio
   * llenar. La lista se recarga por su cuenta y el recién creado se
   * marca en el químico desde el que se pidió.
   */
  async function crearObjetivo(texto: string): Promise<string | null> {
    const r = await crearObjetivoControl(texto)
    if ('error' in r) {
      setError(r.error)
      return null
    }
    onObjetivoCreado()
    return r.nombre
  }

  async function crearYElegir(indice: number, texto: string): Promise<string> {
    const r = await crearJornal(texto)
    if ('error' in r) {
      setError(r.error)
      return ''
    }
    cambiarPersona(indice, { operadorId: r.id })
    onJornalCreado()
    return r.id
  }

  const fase = etiquetaFase(entrada.estado)

  const resumenDe = (s: SeccionEjecucion, texto: string) => (
    <span className="flex items-center gap-1.5">
      {seccionLlena(s, entrada, lotes, lecturas) && (
        <IconCheck className="h-3.5 w-3.5 text-brand-700" />
      )}
      {bloqueada(s) && <IconLock className="h-3.5 w-3.5 text-slate-400" />}
      <span>{texto}</span>
    </span>
  )

  /**
   * El DDT de una fase.
   *
   * El número es `fecha de la fase − fecha de siembra`, así que **sale
   * negativo** mientras falte para trasplantar, que es el caso normal al
   * desinfectar: −69 quiere decir que faltan 69 días. La ayuda dice de
   * dónde salió la fecha, porque una siembra prevista todavía se puede
   * mover y una capturada ya no.
   */
  const campoDdt = (texto: string) => (
    <Campo
      etiqueta="DDT (días desde el trasplante)"
      ayuda={
        !haySiembra
          ? 'Hará falta la siembra del lote, o su plan en Trasplante, para calcularlo.'
          : siembraPrevista
            ? 'Contra la siembra PREVISTA del plan. Negativo = faltan días para trasplantar.'
            : 'Contra la siembra ya capturada. Negativo = faltan días para trasplantar.'
      }
    >
      <Entrada value={texto} readOnly disabled />
    </Campo>
  )

  const candado = (s: SeccionEjecucion) =>
    bloqueada(s) ? (
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-50 px-3 py-2.5 ring-1 ring-inset ring-slate-200">
        <p className="text-xs text-slate-500">
          Esta parte ya venía guardada. Se deja bloqueada para no cambiarla sin querer.
        </p>
        <Boton variante="secundario" tamano="sm" onClick={() => desbloquear(s)}>
          Editar
        </Boton>
      </div>
    ) : null

  return (
    <Modal
      abierto
      ancho="ancho"
      onCerrar={onCerrar}
      titulo={esNuevo ? 'Nueva ejecución' : 'Ejecución del turno'}
      pie={
        <div className="flex flex-col gap-2">
          {/* Los subtotales, siempre a la vista al pie. */}
          {activado && lotesListos && (
            // Cinco tarjetas desde la 74: la cuadrilla del lavado va
            // aparte de la de la aplicación, que es lo que permite
            // contestar cuánto cuesta CERRAR un turno. «Químicos» suma
            // las dos fases, y «Costo / mz» lo refleja.
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-5">
              <Pie etiqueta="M. obra preriego" valor={obraPreriego} />
              <Pie etiqueta="M. obra aplicación" valor={obraAplicacion} />
              <Pie etiqueta="M. obra lavado" valor={obraLavado} />
              <Pie etiqueta="Químicos" valor={quimico} />
              <Pie etiqueta="Costo / mz" valor={costoMz} destacado />
            </div>
          )}

          {/* El BANNER de diagnóstico, encima de los botones y no arriba
              del todo: es donde está la mano cuando se pulsa Guardar, y
              un aviso que aparece fuera de la vista es un aviso que no
              existe. */}
          {(error || errorGuardado) && (
            <div
              role="alert"
              className="rounded-xl bg-red-50 px-3.5 py-2.5 text-sm text-red-700 ring-1 ring-inset ring-red-600/15"
            >
              <p className="font-semibold">No se pudo guardar</p>
              <p className="mt-0.5">{errorGuardado?.mensaje ?? error}</p>
              {intentado && diagnostico.secciones.length > 1 && (
                <p className="mt-1 text-xs text-red-600">
                  También hay algo que revisar en{' '}
                  {diagnostico.secciones
                    .slice(1)
                    .map((x) => x.nombre)
                    .join(', ')}
                  .
                </p>
              )}
              {errorGuardado?.detalle && (
                // Para el supervisor, no para quien captura: el código y
                // el texto crudo de la base son lo único con lo que se
                // puede arreglar una regla de seguridad o un constraint.
                <p className="mt-1.5 font-mono text-[11px] text-red-500">
                  Detalle técnico para supervisor: {errorGuardado.detalle}
                </p>
              )}
            </div>
          )}

          <div className="flex gap-2">
            <Boton variante="secundario" className="flex-1" onClick={onCerrar} disabled={guardando}>
              Cancelar
            </Boton>
            <Boton className="flex-1" onClick={guardar} disabled={guardando || !activado}>
              {guardando ? 'Guardando…' : 'Guardar'}
            </Boton>
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        {/* ===================== EL ACTIVADOR ======================== */}
        <div className="rounded-xl bg-brand-50 p-3.5 ring-1 ring-inset ring-brand-600/15">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Campo etiqueta="Temporada" requerido>
              <Selector
                value={entrada.temporadaId}
                onChange={(e) => cambiar({ temporadaId: e.target.value })}
                disabled={!esNuevo}
              >
                <option value="">Elige la temporada…</option>
                {catalogos.temporadas.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.nombre}
                    {t.activa ? ' (activa)' : ''}
                  </option>
                ))}
              </Selector>
            </Campo>

            <Campo etiqueta="Turno de riego" requerido>
              <Selector
                value={entrada.turnoId}
                onChange={(e) => onActivar(e.target.value, entrada.ciclo)}
              >
                <option value="">Elige el turno…</option>
                {turnosDisponibles.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.codigo}
                  </option>
                ))}
              </Selector>
            </Campo>

            <Campo etiqueta="Ciclo" requerido>
              <Selector
                value={entrada.ciclo}
                onChange={(e) => onActivar(entrada.turnoId, e.target.value)}
              >
                {CICLOS.map((c) => (
                  <option key={c} value={String(c)}>
                    Ciclo {c}
                  </option>
                ))}
              </Selector>
            </Campo>
          </div>

          <p className="mt-2 text-xs text-brand-900">
            {buscando
              ? 'Buscando el turno…'
              : !activado
                ? 'Elige el turno y el ciclo: con esos dos se abre el que ya existe o se empieza uno.'
                : esNuevo
                  ? 'Este turno todavía no tiene ejecución: se está empezando una.'
                  : 'Se cargó la ejecución que ya existía de este turno y ciclo.'}
          </p>
        </div>

        {!activado ? null : (
          <>
            {/* La fase es una consecuencia de lo capturado, no algo que
                se elija: el selector de arriba sólo servía para
                contradecir a los datos. Se enseña, y punto. */}
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Fase
              </span>
              <Insignia tono={fase.tono}>{fase.etiqueta}</Insignia>
            </div>

            {/* ================ 0 · LOTES Y MANZANAS ================= */}
            <Acordeon
              titulo={TITULOS.lotes}
              aviso={avisoSeccion('lotes')}
              descripcion="Qué lotes tocó el turno. Sin esto no hay entre qué repartir el costo."
              resumen={resumenDe(
                'lotes',
                `${lotes.filter((l) => l.loteTemporadaId).length} lotes · ${n2(mz)} mz`,
              )}
              abierto={abierta === 'lotes'}
              onAlternar={() => alternar('lotes')}
            >
              {candado('lotes')}

              <div className="flex flex-col gap-2">
                {lotes.map((l, i) => {
                  const lote = lotesDisponibles.find(
                    (d) => d.lote_temporada_id === l.loteTemporadaId,
                  )
                  return (
                    <div
                      key={i}
                      className="rounded-xl bg-slate-50 p-2.5 ring-1 ring-inset ring-slate-200"
                    >
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_7rem_2.5rem] sm:items-start">
                        {/* `buscable` fuerza el panel con buscador, y ese
                            panel va al `body` con un portal, colocado por
                            `anclarPanel` (migración 71). Dentro del modal,
                            la rueda nativa quedaba recortada por el
                            `overflow` del acordeón: no es cuestión de
                            `z-index`, el recorte lo hace el padre. Y con
                            treinta lotes, un buscador vale más que una
                            lista. */}
                        <Selector
                          value={l.loteTemporadaId}
                          buscable
                          onChange={(e) => elegirLote(i, e.target.value)}
                          disabled={bloqueada('lotes')}
                          className="w-full min-w-0"
                        >
                          <option value="">Elige el lote…</option>
                          {lotesDisponibles.map((d) => (
                            <option key={d.lote_temporada_id} value={d.lote_temporada_id}>
                              {d.nomenclatura}
                              {d.nombre ? ` · ${d.nombre}` : ''} [{n2(d.mz_planeadas)} −{' '}
                              {n2(d.mz_ejecutadas)}]
                            </option>
                          ))}
                        </Selector>
                        <Entrada
                          inputMode="decimal"
                          value={l.mzCubiertas}
                          onChange={(e) => cambiarLote(i, { mzCubiertas: e.target.value })}
                          placeholder="mz"
                          disabled={bloqueada('lotes')}
                          className="w-full min-w-0"
                        />
                        <button
                          type="button"
                          aria-label={`Eliminar lote ${i + 1}`}
                          onClick={() => onCambiarLotes(lotes.filter((_, j) => j !== i))}
                          disabled={bloqueada('lotes') || lotes.length === 1}
                          className="flex h-11 w-full shrink-0 items-center justify-center rounded-xl text-slate-400 transition-colors hover:bg-white hover:text-red-600 disabled:opacity-30 sm:w-10"
                        >
                          <IconTrash className="h-4 w-4" />
                          <span className="ml-1.5 text-sm font-semibold sm:hidden">Eliminar</span>
                        </button>
                      </div>

                      {lote && (
                        // Lo que queda es una SUGERENCIA. Si escriben
                        // más, se guarda más: el que está en el lote
                        // sabe mejor que el plan.
                        <p className="mt-1.5 px-0.5 text-[11px] text-slate-400">
                          {/* **Del ciclo de la cabecera, no de la
                              temporada** (migración 72). Se dice cuál
                              es: el mismo lote se siembra dos veces al
                              año y un número sin ciclo al lado no se
                              puede revisar. */}
                          Planeadas {n2(lote.mz_planeadas)}
                          {entrada.ciclo ? ` en el ciclo ${entrada.ciclo}` : ''} · ya desinfectadas{' '}
                          {n2(lote.mz_ejecutadas)} ·{' '}
                          <strong className="text-slate-600">
                            quedan {n2(lote.mz_restantes)} mz
                          </strong>
                        </p>
                      )}
                    </div>
                  )
                })}
              </div>

              <button
                type="button"
                onClick={() => onCambiarLotes([...lotes, { ...LINEA_LOTE_VACIA }])}
                disabled={bloqueada('lotes')}
                className="mt-2 flex items-center gap-1.5 rounded-lg px-1 py-1.5 text-sm font-semibold text-brand-700 transition-colors hover:text-brand-800 disabled:opacity-40"
              >
                <IconPlus className="h-4 w-4" />
                Agregar lote
              </button>

              <p className="mt-2 text-right text-sm font-bold tabular-nums text-brand-700">
                {n2(mz)} mz en total
              </p>
            </Acordeon>

            {!lotesListos && (
              <Alerta tono="ambar">
                Empieza por los lotes: el químico y la cuadrilla se reparten entre ellos por
                manzanas, así que lo demás se abre cuando haya al menos uno.
              </Alerta>
            )}

            {lotesListos && (
              <>
                {/* =================== 1 · PRERIEGO =================== */}
                <Acordeon
                  titulo={TITULOS.preriego}
                  aviso={avisoSeccion('preriego')}
                  descripcion="El día, las horas y la cuadrilla que lo trabajó."
                  resumen={resumenDe(
                    'preriego',
                    duracionPreriego > 0
                      ? `${n2(duracionPreriego)} h · ${ddtPreriego}`
                      : ddtPreriego,
                  )}
                  abierto={abierta === 'preriego'}
                  onAlternar={() => alternar('preriego')}
                >
                  {candado('preriego')}

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <Campo etiqueta="Fecha del preriego" requerido>
                      <Entrada
                        type="date"
                        value={entrada.fechaPreriego}
                        onChange={(e) => cambiar({ fechaPreriego: e.target.value })}
                        disabled={bloqueada('preriego')}
                      />
                    </Campo>
                    {campoDdt(ddtPreriego)}
                    <Campo etiqueta="Observaciones" className="sm:col-span-2">
                      <Entrada
                        value={entrada.obsPreriego}
                        onChange={(e) => cambiar({ obsPreriego: e.target.value })}
                        disabled={bloqueada('preriego')}
                      />
                    </Campo>
                  </div>

                  <Reloj
                    titulo="Riego del preriego"
                    ayuda="Fin menos inicio, cruzando la medianoche. La duración la calcula la base."
                    inicio={entrada.horaInicioPreriego}
                    fin={entrada.horaFinPreriego}
                    total={duracionPreriego}
                    bloqueado={bloqueada('preriego')}
                    onInicio={(v) => cambiar({ horaInicioPreriego: v })}
                    onFin={(v) => cambiar({ horaFinPreriego: v })}
                  />

                  <CuadrillaFase
                    fase="1_Preriego"
                    cerrado={bloqueada('preriego')}
                    personal={personal}
                    operadores={catalogos.operadores}
                    minimo={minimo}
                    subtotal={obraPreriego}
                    errorDe={errorDe}
                    onCambiar={cambiarPersona}
                    onNuevo={(i) => setAltaPersonal({ indice: i })}
                    onQuitar={(i) => onCambiarPersonal(personal.filter((_, j) => j !== i))}
                    onAgregar={() =>
                      onCambiarPersonal([
                        ...personal,
                        lineaPersonalVacia('1_Preriego', salarioPorOmision),
                      ])
                    }
                    onCrear={crearYElegir}
                  />
                </Acordeon>

                {/* =================== 2 · LECTURAS =================== */}
                <Acordeon
                  titulo={TITULOS.lecturas}
                  aviso={avisoSeccion('lecturas')}
                  descripcion="El día en que se midió, que no tiene por qué ser el del preriego."
                  resumen={resumenDe(
                    'lecturas',
                    `${lecturas.filter((l) => l.lectura.trim() !== '').length} lecturas · ${ddtLecturas}`,
                  )}
                  abierto={abierta === 'lecturas'}
                  onAlternar={() => alternar('lecturas')}
                >
                  {candado('lecturas')}

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <Campo etiqueta="Fecha de las lecturas" requerido>
                      <Entrada
                        type="date"
                        value={entrada.fechaLecturas}
                        onChange={(e) => cambiar({ fechaLecturas: e.target.value })}
                        disabled={bloqueada('lecturas')}
                      />
                    </Campo>
                    {campoDdt(ddtLecturas)}
                  </div>

                  <div className="mt-3 flex flex-col gap-2">
                    {lecturas.map((l, i) => (
                      <div
                        key={i}
                        className="rounded-xl bg-slate-50 p-2.5 ring-1 ring-inset ring-slate-200"
                      >
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_6rem_6rem_2.5rem] sm:items-start">
                          <Entrada
                            value={l.punto}
                            onChange={(e) => cambiarLectura(i, { punto: e.target.value })}
                            placeholder="Punto"
                            disabled={bloqueada('lecturas')}
                            className="w-full min-w-0"
                          />
                          <Entrada
                            inputMode="decimal"
                            value={l.lectura}
                            onChange={(e) => cambiarLectura(i, { lectura: e.target.value })}
                            placeholder="cbar"
                            disabled={bloqueada('lecturas')}
                            className="w-full min-w-0"
                          />
                          <Entrada
                            type="time"
                            value={l.hora}
                            onChange={(e) => cambiarLectura(i, { hora: e.target.value })}
                            disabled={bloqueada('lecturas')}
                            className="w-full min-w-0"
                          />
                          <button
                            type="button"
                            aria-label={`Eliminar lectura ${i + 1}`}
                            onClick={() => onCambiarLecturas(lecturas.filter((_, j) => j !== i))}
                            disabled={bloqueada('lecturas')}
                            className="flex h-11 w-full shrink-0 items-center justify-center rounded-xl text-slate-400 transition-colors hover:bg-white hover:text-red-600 disabled:opacity-30 sm:w-10"
                          >
                            <IconTrash className="h-4 w-4" />
                            <span className="ml-1.5 text-sm font-semibold sm:hidden">Eliminar</span>
                          </button>
                        </div>
                        <Entrada
                          value={l.nota}
                          onChange={(e) => cambiarLectura(i, { nota: e.target.value })}
                          placeholder="Nota (opcional)"
                          disabled={bloqueada('lecturas')}
                          className="mt-2 w-full"
                        />
                      </div>
                    ))}
                  </div>

                  <button
                    type="button"
                    onClick={() => onCambiarLecturas([...lecturas, { ...LECTURA_VACIA }])}
                    disabled={bloqueada('lecturas')}
                    className="mt-2 flex items-center gap-1.5 rounded-lg px-1 py-1.5 text-sm font-semibold text-brand-700 transition-colors hover:text-brand-800 disabled:opacity-40"
                  >
                    <IconPlus className="h-4 w-4" />
                    Agregar lectura
                  </button>
                </Acordeon>

                {/* ================== 3 · APLICACIÓN ================== */}
                <Acordeon
                  titulo={TITULOS.aplicacion}
                  aviso={avisoSeccion('aplicacion')}
                  descripcion="Tiempos, conductividad, químicos y la cuadrilla que aplicó."
                  resumen={resumenDe(
                    'aplicacion',
                    quimico > 0 ? `L ${n2(quimico)} · ${ddtAplicacion}` : ddtAplicacion,
                  )}
                  abierto={abierta === 'aplicacion'}
                  onAlternar={() => alternar('aplicacion')}
                >
                  {candado('aplicacion')}

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <Campo etiqueta="Fecha de aplicación" requerido>
                      <Entrada
                        type="date"
                        value={entrada.fechaAplicacion}
                        onChange={(e) => cambiar({ fechaAplicacion: e.target.value })}
                        disabled={bloqueada('aplicacion')}
                      />
                    </Campo>
                    {campoDdt(ddtAplicacion)}

                    <Campo etiqueta="Estación de riego">
                      <Selector
                        value={entrada.estacionRiegoId}
                        onChange={(e) => cambiar({ estacionRiegoId: e.target.value })}
                        disabled={bloqueada('aplicacion')}
                      >
                        <option value="">Sin estación</option>
                        {estacionesDisponibles.map((x) => (
                          <option key={x.id} value={x.id}>
                            {x.nombre}
                          </option>
                        ))}
                      </Selector>
                    </Campo>

                    {/* Con qué se aplicó (migración 75). No se guardaba
                        en ningún sitio, y es lo primero que se pregunta
                        cuando un turno sale raro. */}
                    <Campo
                      etiqueta="Equipo de aplicación"
                      ayuda="Con qué se metió el químico. Si fue otra cosa, hay que decir cuál: «Otros» a secas no contesta nada dentro de un año."
                    >
                      <Selector
                        value={entrada.equipoAplicacion}
                        onChange={(e) =>
                          cambiar({
                            equipoAplicacion: e.target.value,
                            // Cambiar de opción limpia el detalle: dejarlo
                            // colgando de una opción que ya no es «Otros»
                            // es basura que alguien leería como buena. La
                            // base hace lo mismo con su disparador.
                            ...(e.target.value === EQUIPO_OTROS
                              ? {}
                              : { equipoAplicacionOtro: '' }),
                          })
                        }
                        disabled={bloqueada('aplicacion')}
                      >
                        <option value="">Sin anotar</option>
                        {EQUIPOS_APLICACION.map((x) => (
                          <option key={x} value={x}>
                            {x}
                          </option>
                        ))}
                      </Selector>
                    </Campo>

                    {entrada.equipoAplicacion === EQUIPO_OTROS && (
                      <Campo
                        etiqueta="¿Cuál equipo usaron?"
                        requerido
                        error={errorDe('ejecucion.equipoAplicacionOtro')}
                      >
                        <Entrada
                          value={entrada.equipoAplicacionOtro}
                          onChange={(e) => cambiar({ equipoAplicacionOtro: e.target.value })}
                          placeholder="Bomba de mochila, aspersora…"
                          disabled={bloqueada('aplicacion')}
                          className={bordeError(errorDe('ejecucion.equipoAplicacionOtro'))}
                        />
                      </Campo>
                    )}

                    <Campo
                      etiqueta="Total de horas de riego"
                      ayuda="Presurización + inyección + lavado. La calcula la base."
                    >
                      <Entrada
                        value={`${n2(totalHoras)} h`}
                        readOnly
                        disabled
                        className="font-bold"
                      />
                    </Campo>

                    {/* El caudal va aquí, pegado a las horas, porque es su
                        compañero: horas × caudal es el agua que pasó, y el
                        agua es el divisor de las ppm. */}
                    <Campo etiqueta="Caudal (m³/h)" ayuda="De la estación. 20 por omisión.">
                      <Entrada
                        inputMode="decimal"
                        value={entrada.caudalAgua}
                        onChange={(e) => cambiar({ caudalAgua: e.target.value })}
                        disabled={bloqueada('aplicacion')}
                        placeholder="20"
                      />
                    </Campo>

                    <Campo
                      etiqueta="Agua con producto (m³)"
                      ayuda="Inyección × caudal. Es el divisor de las ppm; el lavado es agua limpia y no entra."
                    >
                      <Entrada value={n2(agua)} readOnly disabled className="font-bold" />
                    </Campo>
                  </div>

                  {/* ------------------- Los tres relojes ---------------- */}
                  {/*
                    Cada fase del riego va en su marco, con **inicio, fin y
                    total en la misma fila** (migración 71). Antes los seis
                    relojes y los tres totales caían en una rejilla de dos
                    columnas y salían en este orden: inicio y fin de
                    presurización, inicio y fin de inyección, inicio y fin
                    de lavado, y los tres totales al final, lejos de la
                    fase a la que pertenecen. En el teléfono eran nueve
                    filas y había que desplazar para comprobar si el total
                    de la presurización cuadraba con lo que se acababa de
                    escribir.

                    Juntos, el total se lee al lado de los dos relojes que
                    lo producen: si sale un número raro, se ve en el acto
                    cuál de los dos está mal tecleado.
                  */}
                  <Reloj
                    titulo="Presurización"
                    ayuda="Desde que se abre hasta que la línea toma presión. Puede cruzar la medianoche."
                    inicio={entrada.inicioPresurizacion}
                    fin={entrada.finPresurizacion}
                    total={presurizacion}
                    bloqueado={bloqueada('aplicacion')}
                    onInicio={(v) => cambiar({ inicioPresurizacion: v })}
                    onFin={(v) => cambiar({ finPresurizacion: v })}
                  />
                  <Reloj
                    titulo="Inyección"
                    ayuda="Mientras entra el químico. Es la única que cuenta para las ppm."
                    inicio={entrada.horaInicioIny}
                    fin={entrada.horaFinIny}
                    total={inyeccion}
                    bloqueado={bloqueada('aplicacion')}
                    onInicio={(v) => cambiar({ horaInicioIny: v })}
                    onFin={(v) => cambiar({ horaFinIny: v })}
                  />
                  <Reloj
                    titulo="Lavado"
                    ayuda="Agua limpia para sacar el químico de la tubería. No diluye: no entra en las ppm."
                    inicio={entrada.horaInicioLavado}
                    fin={entrada.horaFinLavado}
                    total={lavado}
                    bloqueado={bloqueada('aplicacion')}
                    onInicio={(v) => cambiar({ horaInicioLavado: v })}
                    onFin={(v) => cambiar({ horaFinLavado: v })}
                  />

                  {/* ------------------ Las calibraciones --------------- */}
                  {/* Agrupadas desde la 68. Los seis números iban en una
                      sola rejilla con las CE, y en el teléfono salían en
                      una columna donde «Calibración salida» quedaba
                      pegada a «CE después»: dos medidas de cosas
                      distintas, con unidades distintas, leyéndose como
                      si fueran la misma serie. */}
                  <Grupo
                    titulo="Calibraciones"
                    ayuda="Las dos del equipo y la que se toma en el lote."
                  >
                    <Campo etiqueta="Presión de entrada">
                      <Entrada
                        inputMode="decimal"
                        value={entrada.calibracionEntrada}
                        onChange={(e) => cambiar({ calibracionEntrada: e.target.value })}
                        disabled={bloqueada('aplicacion')}
                      />
                    </Campo>
                    <Campo etiqueta="Presión de salida">
                      <Entrada
                        inputMode="decimal"
                        value={entrada.calibracionSalida}
                        onChange={(e) => cambiar({ calibracionSalida: e.target.value })}
                        disabled={bloqueada('aplicacion')}
                      />
                    </Campo>
                    <Campo etiqueta="Calibración del turno (campo)">
                      <Entrada
                        inputMode="decimal"
                        value={entrada.calibracionCampo}
                        onChange={(e) => cambiar({ calibracionCampo: e.target.value })}
                        disabled={bloqueada('aplicacion')}
                      />
                    </Campo>
                  </Grupo>

                  {/* ------------- La conductividad eléctrica ----------- */}
                  <Grupo
                    titulo="Lecturas de la conductividad eléctrica (CE)"
                    ayuda="Las tres del mismo turno: antes de inyectar, durante y después."
                  >
                    <Campo etiqueta="CE antes">
                      <Entrada
                        inputMode="decimal"
                        value={entrada.ceAntes}
                        onChange={(e) => cambiar({ ceAntes: e.target.value })}
                        disabled={bloqueada('aplicacion')}
                      />
                    </Campo>
                    <Campo etiqueta="CE durante">
                      <Entrada
                        inputMode="decimal"
                        value={entrada.ceDurante}
                        onChange={(e) => cambiar({ ceDurante: e.target.value })}
                        disabled={bloqueada('aplicacion')}
                      />
                    </Campo>
                    <Campo etiqueta="CE después">
                      <Entrada
                        inputMode="decimal"
                        value={entrada.ceDespues}
                        onChange={(e) => cambiar({ ceDespues: e.target.value })}
                        disabled={bloqueada('aplicacion')}
                      />
                    </Campo>
                  </Grupo>

                  <BloqueQuimicos
                    fase="3_Aplicacion"
                    productos={productos}
                    materiales={catalogos.materiales}
                    entrada={entrada}
                    mz={mz}
                    subtotal={quimicoAplicacion}
                    cerrado={bloqueada('aplicacion')}
                    avisoPrecio={avisoPrecio}
                    errorDe={errorDe}
                    opcionesObjetivo={opcionesObjetivo}
                    onCrearObjetivo={crearObjetivo}
                    onElegir={elegirProducto}
                    onCambiar={cambiarProducto}
                    onQuitar={(i) => onCambiarProductos(productos.filter((_, j) => j !== i))}
                    onAgregar={() =>
                      onCambiarProductos([...productos, lineaProductoVacia('3_Aplicacion')])
                    }
                    onDesglose={setDesgloseAbierto}
                  />

                  <CuadrillaFase
                    fase="3_Aplicacion"
                    cerrado={bloqueada('aplicacion')}
                    personal={personal}
                    operadores={catalogos.operadores}
                    minimo={minimo}
                    subtotal={obraAplicacion}
                    errorDe={errorDe}
                    onCambiar={cambiarPersona}
                    onNuevo={(i) => setAltaPersonal({ indice: i })}
                    onQuitar={(i) => onCambiarPersonal(personal.filter((_, j) => j !== i))}
                    onAgregar={() =>
                      onCambiarPersonal([
                        ...personal,
                        lineaPersonalVacia('3_Aplicacion', salarioPorOmision),
                      ])
                    }
                    onCrear={crearYElegir}
                  />
                </Acordeon>

                {/* ================= 4 · LAVADO DE CINTA ================= */}
                <Acordeon
                  titulo={TITULOS.lavado}
                  descripcion="Fecha, químicos de lavado y la cuadrilla que cerró el proceso."
                  aviso={avisoSeccion('lavado')}
                  resumen={resumenDe(
                    'lavado',
                    entrada.fechaLavado
                      ? `${entrada.fechaLavado}${ddtLavado ? ` · ${ddtLavado}` : ''}`
                      : 'Sin fecha',
                  )}
                  abierto={abierta === 'lavado'}
                  onAlternar={() => alternar('lavado')}
                >
                  {candado('lavado')}

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <Campo
                      etiqueta="Fecha de lavado"
                      ayuda="El día en que se lavó la cinta. Puede ser posterior a la aplicación: con ella se costea la cuadrilla de esta fase."
                      error={errorDe('ejecucion.fechaLavado')}
                    >
                      <Entrada
                        type="date"
                        value={entrada.fechaLavado}
                        onChange={(e) => cambiar({ fechaLavado: e.target.value })}
                        disabled={bloqueada('lavado')}
                        className={bordeError(errorDe('ejecucion.fechaLavado'))}
                      />
                    </Campo>
                    {campoDdt(ddtLavado)}
                  </div>

                  <BloqueQuimicos
                    fase="4_Lavado"
                    productos={productos}
                    materiales={catalogos.materiales}
                    entrada={entrada}
                    mz={mz}
                    subtotal={quimicoLavado}
                    cerrado={bloqueada('lavado')}
                    avisoPrecio={avisoPrecio}
                    errorDe={errorDe}
                    opcionesObjetivo={opcionesObjetivo}
                    onCrearObjetivo={crearObjetivo}
                    onElegir={elegirProducto}
                    onCambiar={cambiarProducto}
                    onQuitar={(i) => onCambiarProductos(productos.filter((_, j) => j !== i))}
                    onAgregar={() =>
                      onCambiarProductos([...productos, lineaProductoVacia('4_Lavado')])
                    }
                    onDesglose={setDesgloseAbierto}
                  />

                  <CuadrillaFase
                    fase="4_Lavado"
                    cerrado={bloqueada('lavado')}
                    personal={personal}
                    operadores={catalogos.operadores}
                    minimo={minimo}
                    subtotal={obraLavado}
                    errorDe={errorDe}
                    onCambiar={cambiarPersona}
                    onNuevo={(i) => setAltaPersonal({ indice: i })}
                    onQuitar={(i) => onCambiarPersonal(personal.filter((_, j) => j !== i))}
                    onAgregar={() =>
                      onCambiarPersonal([
                        ...personal,
                        lineaPersonalVacia('4_Lavado', salarioPorOmision),
                      ])
                    }
                    onCrear={crearYElegir}
                  />
                </Acordeon>

                {SECCIONES.every((s) => seccionLlena(s, entrada, lotes, lecturas)) && (
                  <Alerta tono="azul">
                    El turno está completo: las cinco secciones tienen lo suyo.
                  </Alerta>
                )}
              </>
            )}
          </>
        )}
      </div>

      {/* El desglose va FUERA del acordeón y encima del formulario: se
          abre para discutir un número, no para corregirlo, y plegar la
          sección mientras se mira sería perder de vista el contexto. */}
      {desgloseAbierto !== null && productos[desgloseAbierto] && (
        <DesglosePpmModal
          desglose={desglosePpm(
            productos[desgloseAbierto],
            catalogos.materiales.find((m) => m.id === productos[desgloseAbierto].productoId),
            entrada,
            mz,
          )}
          onCerrar={() => setDesgloseAbierto(null)}
        />
      )}

      {/* El alta de personal, con el MISMO formulario de Catálogos. No
          es una copia reducida: si mañana la ficha de una persona gana
          un campo obligatorio, lo gana aquí también.

          `recargarRuta={false}` no es un detalle: un `router.refresh()`
          en medio de una captura rehace el árbol y se lleva por delante
          lo que se llevaba escrito. La lista se recarga por su cuenta
          con `onJornalCreado`. */}
      {altaPersonal && (
        <FormularioCatalogo
          abierto
          tabla="operadores"
          titulo="Personal"
          campos={CAMPOS_PERSONAL}
          valoresIniciales={{ es_jornal: true, activo: true }}
          recargarRuta={false}
          onCerrar={() => setAltaPersonal(null)}
          onCreado={(id) => {
            // Queda ELEGIDA en el renglón desde el que se pidió. Crearla
            // y dejar el campo vacío obliga a buscarla en una lista que
            // todavía no se ha recargado.
            cambiarPersona(altaPersonal.indice, { operadorId: id })
            onJornalCreado()
          }}
        />
      )}
    </Modal>
  )
}

/**
 * Una fase del riego, con sus dos relojes y su total.
 *
 * ── Por qué los tres juntos (migración 71) ──────────────────────────
 *
 * Los seis relojes del turno y los tres totales caían en una rejilla de
 * dos columnas, y los totales quedaban al final, lejos de la fase a la
 * que pertenecen. En el teléfono eran nueve filas, y comprobar si el
 * total de la presurización cuadraba con lo tecleado obligaba a
 * desplazar arriba y abajo.
 *
 * Juntos, el total se lee al lado de los dos relojes que lo producen: si
 * sale un número raro, se ve en el acto cuál de los dos está mal
 * tecleado. Tres columnas en pantalla ancha; en el teléfono los dos
 * relojes comparten fila —son dos campos cortos— y el total va debajo,
 * que es el orden en que se escriben.
 *
 * Las horas se teclean con `EntradaReloj` y no con la rueda nativa:
 * seis ruedas a pantalla completa por turno es medio minuto de gestos
 * para algo que se teclea con una mano en diez segundos.
 */
function Reloj({
  titulo,
  ayuda,
  inicio,
  fin,
  total,
  bloqueado,
  onInicio,
  onFin,
}: {
  titulo: string
  ayuda: string
  inicio: string
  fin: string
  total: number
  bloqueado: boolean
  onInicio: (hora: string) => void
  onFin: (hora: string) => void
}) {
  return (
    <Grupo titulo={titulo} ayuda={ayuda} columnas="grid-cols-2 sm:grid-cols-3">
      <Campo etiqueta="Inicio">
        <EntradaReloj
          value={inicio}
          onChange={onInicio}
          disabled={bloqueado}
          aria-label={`Inicio de ${titulo.toLowerCase()}`}
        />
      </Campo>
      <Campo etiqueta="Fin" ayuda="Puede ser del día siguiente.">
        <EntradaReloj
          value={fin}
          onChange={onFin}
          disabled={bloqueado}
          aria-label={`Fin de ${titulo.toLowerCase()}`}
        />
      </Campo>
      {/* El total ocupa la fila entera en el teléfono: es el que se mira
          para comprobar, y partido en media columna se lee peor. */}
      <Campo etiqueta="Total" className="col-span-2 sm:col-span-1">
        <Entrada value={`${n2(total)} h`} readOnly disabled className="font-bold" />
      </Campo>
    </Grupo>
  )
}

/**
 * La cuadrilla de UNA fase.
 *
 * Vive fuera del componente padre y no dentro: un componente declarado
 * en el render se vuelve a crear en cada pulsación, y React le reinicia
 * el estado —el buscador del selector se cerraba solo a media palabra—.
 *
 * Recibe la lista ENTERA y filtra por fase, en vez de recibir ya
 * filtrada, porque los índices con los que se cambia y se quita son los
 * de la lista entera: filtrar fuera obligaría a traducirlos de vuelta.
 */
/**
 * Los químicos de UNA fase.
 *
 * ── Por qué es un componente y no dos bloques ───────────────────────
 *
 * Desde la 74 hay químico en dos sitios: la inyección y el lavado de
 * cinta. Son el mismo gesto —elegir producto, anotar litros, ver lo que
 * cuesta— con una diferencia: **el lavado no se mide en ppm**. No se
 * aplica contra una plaga, se enjuaga una tubería.
 *
 * Copiar el bloque y borrarle cuatro campos habría dejado dos sitios
 * donde arreglar el próximo fallo del precio, y la experiencia dice que
 * sólo se arregla uno. Lo que cambia es QUÉ SE ENSEÑA, así que la fase
 * es un parámetro y no una copia.
 *
 * En `'4_Lavado'` se esconden, estrictamente: envases, tipo de envase,
 * objetivos de control, ppm y el botón de ver el cálculo. Lo que queda
 * es producto, litros, costo por litro, dosis por manzana y costo total.
 */
function BloqueQuimicos({
  fase,
  productos,
  materiales,
  entrada,
  mz,
  subtotal,
  cerrado,
  avisoPrecio,
  errorDe,
  opcionesObjetivo,
  onCrearObjetivo,
  onElegir,
  onCambiar,
  onQuitar,
  onAgregar,
  onDesglose,
}: {
  fase: FaseProducto
  /** La lista ENTERA: los índices tienen que seguir siendo los de verdad. */
  productos: LineaProducto[]
  materiales: CatalogosDesinfeccion['materiales']
  entrada: EntradaEjecucion
  mz: number
  subtotal: number
  cerrado: boolean
  avisoPrecio: string | null
  errorDe: (campo: string) => string | undefined
  opcionesObjetivo: { valor: string; etiqueta: string }[]
  /** Da de alta un objetivo nuevo y devuelve su nombre, o `null` si falló. */
  onCrearObjetivo: (texto: string) => Promise<string | null>
  onElegir: (indice: number, productoId: string) => void | Promise<void>
  onCambiar: (indice: number, cambios: Partial<LineaProducto>) => void
  onQuitar: (indice: number) => void
  onAgregar: () => void
  onDesglose: (indice: number) => void
}) {
  const esLavado = fase === '4_Lavado'
  // Se filtra conservando el ÍNDICE REAL: los `onCambiar` van contra la
  // lista entera, y un índice del sub-arreglo editaría el químico
  // equivocado en cuanto las dos fases tuvieran renglones.
  const suyos = productos
    .map((q, i) => ({ q, i }))
    .filter((x) => (x.q.fase ?? '3_Aplicacion') === fase)

  return (
    <div className="mt-4 border-t border-slate-100 pt-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-slate-900">
            {esLavado ? 'Químicos del lavado' : 'Químicos aplicados'}
          </h3>
          <p className="text-xs text-slate-400">
            {esLavado
              ? `Lo que se usó para enjuagar la cinta. No lleva ppm: no se aplica contra una plaga. La dosis sale de las ${n2(mz)} mz del turno.`
              : `Se anota el TOTAL aplicado; la dosis sale de las ${n2(mz)} mz del turno. El costo lo toma del catálogo si lo dejas vacío.`}
          </p>
        </div>
        <span className="shrink-0 text-sm font-bold tabular-nums text-brand-700">
          L {n2(subtotal)}
        </span>
      </div>

      {/* El costo se quedó en blanco y aquí se dice POR QUÉ. Antes la
          celda se quedaba muda y las tres causas —sin precios, fuera de
          vigencia, sin tasa— tenían el mismo aspecto y tres arreglos. */}
      {avisoPrecio && !esLavado && (
        <p className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800 ring-1 ring-inset ring-amber-200">
          {avisoPrecio}
        </p>
      )}

      {suyos.length === 0 && (
        <p className="mt-2 rounded-xl bg-slate-50 px-3 py-2.5 text-xs text-slate-500 ring-1 ring-inset ring-slate-200">
          {esLavado
            ? 'Todavía sin químico de lavado. A veces se enjuaga sólo con agua: el turno se guarda igual.'
            : 'Todavía sin químico.'}
        </p>
      )}

      <div className="mt-2 flex flex-col gap-2">
        {suyos.map(({ q, i }) => {
          const dosis = dosisPorMz(q.totalLitros, mz)
          const material = materiales.find((m) => m.id === q.productoId)
          const ppm = esLavado ? null : ppmDe(q.totalLitros, material?.concentracion, entrada, mz)
          const eProducto = errorDe(`producto.${i}.productoId`)
          const eLitros = errorDe(`producto.${i}.totalLitros`)
          const eCosto = errorDe(`producto.${i}.costoLitro`)
          const eEnvases = errorDe(`producto.${i}.cantidadEnvases`)
          return (
            <div key={i} className="rounded-xl bg-slate-50 p-2.5 ring-1 ring-inset ring-slate-200">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_2.5rem] sm:items-start">
                {/* **El selector NO va dentro de un `Campo`.** `Campo`
                    es un `<label>`, y `Selector` dibuja un `<button>`:
                    dentro de una etiqueta, el navegador le da a ese
                    botón el nombre de la etiqueta y el campo se queda
                    sin nombre accesible. Es la trampa que ya costó una
                    vuelta con el icono de ayuda. El error va debajo,
                    como hermano. */}
                <div className="min-w-0">
                  <Selector
                    value={q.productoId}
                    buscable
                    onChange={(e) => void onElegir(i, e.target.value)}
                    disabled={cerrado}
                    className={`w-full min-w-0 ${bordeError(eProducto)}`}
                  >
                    <option value="">Elige el producto…</option>
                    {materiales.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.codigo}
                        {m.descripcion ? ` · ${m.descripcion}` : ''}
                        {m.ingrediente_activo ? ` — ${m.ingrediente_activo}` : ''}
                      </option>
                    ))}
                  </Selector>
                  {eProducto && (
                    <p
                      aria-live="polite"
                      className="mt-1.5 flex items-start gap-1 text-xs font-medium text-red-600"
                    >
                      <span aria-hidden="true">⚠</span>
                      <span>{eProducto}</span>
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  aria-label={`Eliminar químico ${i + 1}`}
                  onClick={() => onQuitar(i)}
                  disabled={cerrado}
                  className="flex h-11 w-full shrink-0 items-center justify-center rounded-xl text-slate-400 transition-colors hover:bg-white hover:text-red-600 disabled:opacity-30 sm:w-10"
                >
                  <IconTrash className="h-4 w-4" />
                  <span className="ml-1.5 text-sm font-semibold sm:hidden">Eliminar</span>
                </button>
              </div>

              <div
                className={`mt-2 grid grid-cols-2 gap-2 ${esLavado ? 'sm:grid-cols-2' : 'sm:grid-cols-4'}`}
              >
                <Campo etiqueta="Total (L)" error={eLitros}>
                  <Entrada
                    inputMode="decimal"
                    value={q.totalLitros}
                    onChange={(e) => onCambiar(i, { totalLitros: e.target.value })}
                    disabled={cerrado}
                    placeholder="0.00"
                    className={bordeError(eLitros)}
                  />
                </Campo>
                <Campo etiqueta="Costo/L" error={eCosto}>
                  <Entrada
                    inputMode="decimal"
                    value={q.costoLitro}
                    onChange={(e) => onCambiar(i, { costoLitro: e.target.value })}
                    disabled={cerrado}
                    placeholder="Del catálogo"
                    className={bordeError(eCosto)}
                  />
                </Campo>
                {/* **Estrictamente ocultos en el lavado.** El envase no
                    se controla al enjuagar: se usa lo que haya abierto. */}
                {!esLavado && (
                  <>
                    <Campo etiqueta="Envases" error={eEnvases}>
                      <Entrada
                        inputMode="numeric"
                        value={q.cantidadEnvases}
                        onChange={(e) => onCambiar(i, { cantidadEnvases: e.target.value })}
                        disabled={cerrado}
                        placeholder="0"
                        className={bordeError(eEnvases)}
                      />
                    </Campo>
                    <Campo etiqueta="Tipo de envase">
                      <Selector
                        value={q.tipoEnvase}
                        onChange={(e) => onCambiar(i, { tipoEnvase: e.target.value })}
                        disabled={cerrado}
                      >
                        <option value="">Sin especificar</option>
                        {TIPOS_ENVASE.map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </Selector>
                    </Campo>
                  </>
                )}
              </div>

              {/* Contra qué se aplicó ESTE día (migración 71). En el
                  lavado NO se pregunta y la base lo vacía: enjuagar una
                  tubería no es aplicar contra nematodos, y heredar el
                  objetivo del catálogo sería afirmarlo en el informe. */}
              {!esLavado && (
                <div className="mt-2">
                  {/* **Lista cerrada con alta in-situ** (migración 75).
                      Era texto libre: «Nematodos» y «nematodos» acababan
                      siendo dos objetivos distintos en el informe, que
                      es la deuda que la 71 dejó anotada. Cerrarla a
                      secas habría traído el problema contrario —el día
                      que aparece una plaga sin dar de alta, se elige lo
                      más parecido y el dato queda mal—, así que se crea
                      desde el mismo buscador.

                      NO va dentro de un `Campo`: `Campo` es un `<label>`
                      y el selector dibuja un `<button>` que le robaría
                      el nombre accesible. */}
                  <SelectorMultiple
                    etiqueta="Objetivos de control"
                    opciones={opcionesObjetivo}
                    valores={q.objetivosControl}
                    onCambiar={(v) => onCambiar(i, { objetivosControl: v })}
                    onCrear={cerrado ? undefined : onCrearObjetivo}
                  />
                  <p className="mt-1 px-0.5 text-[11px] text-slate-400">
                    Contra qué se aplicó HOY. Nace con lo que dice la etiqueta del producto y se
                    puede cambiar. Si falta uno, se crea desde el buscador.
                  </p>
                </div>
              )}

              <div className={`mt-2 grid gap-2 ${esLavado ? 'grid-cols-2' : 'grid-cols-3'}`}>
                <Campo etiqueta="Dosis/mz">
                  <Entrada value={dosis === null ? '—' : n2(dosis)} readOnly disabled />
                </Campo>
                <Campo etiqueta="Costo total">
                  <Entrada value={n2(costoProducto(q))} readOnly disabled />
                </Campo>
                {/* Las ppm de ESTE químico. Son por producto y no por
                    turno: el ácido y el desinfectante llevan
                    concentraciones distintas y un solo número sería de
                    ninguno de los dos. */}
                {!esLavado && (
                  <Campo etiqueta="ppm">
                    <Entrada
                      value={ppm === null ? '—' : n2(ppm)}
                      readOnly
                      disabled
                      className="font-bold"
                    />
                  </Campo>
                )}
              </div>

              <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2">
                {material?.ingrediente_activo ? (
                  <p className="px-0.5 text-[11px] text-slate-400">
                    {material.ingrediente_activo}
                    {material.concentracion ? ` · ${material.concentracion}` : ''}
                  </p>
                ) : (
                  <span />
                )}
                {!esLavado && (
                  <button
                    type="button"
                    onClick={() => onDesglose(i)}
                    className="rounded-lg px-1 py-1 text-xs font-semibold text-brand-700 underline-offset-2 hover:underline"
                  >
                    Ver cálculo PPM
                  </button>
                )}
              </div>

              {/* Sin concentración en el catálogo no hay ppm que valgan,
                  y callarlo deja un «—» que parece un fallo de la
                  pantalla en vez de un hueco del catálogo. */}
              {!esLavado && q.productoId !== '' && material && !material.concentracion && (
                <p className="mt-1 px-0.5 text-[11px] text-amber-700">
                  Sin concentración en el catálogo: las ppm no se pueden calcular.
                </p>
              )}
            </div>
          )
        })}
      </div>

      <button
        type="button"
        onClick={onAgregar}
        disabled={cerrado}
        className="mt-2 flex items-center gap-1.5 rounded-lg px-1 py-1.5 text-sm font-semibold text-brand-700 transition-colors hover:text-brand-800 disabled:opacity-40"
      >
        <IconPlus className="h-4 w-4" />
        {esLavado ? 'Agregar químico de lavado' : 'Agregar químico'}
      </button>
    </div>
  )
}

function CuadrillaFase({
  fase,
  cerrado,
  personal,
  operadores,
  minimo,
  subtotal,
  errorDe,
  onCambiar,
  onQuitar,
  onAgregar,
  onCrear,
  onNuevo,
}: {
  fase: FasePersonal
  cerrado: boolean
  personal: LineaPersonal[]
  operadores: CatalogosDesinfeccion['operadores']
  minimo: number | null
  subtotal: number | null
  errorDe: (campo: string) => string | undefined
  onCambiar: (indice: number, cambios: Partial<LineaPersonal>) => void
  onQuitar: (indice: number) => void
  onAgregar: () => void
  onCrear: (indice: number, texto: string) => Promise<string>
  /** Abre el alta completa de Personal para ESE renglón. */
  onNuevo: (indice: number, texto: string) => void
}) {
  const suyas = personal.map((p, i) => ({ p, i })).filter((x) => x.p.fase === fase)

  return (
    <div className="mt-4 border-t border-slate-100 pt-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-slate-900">Cuadrilla de esta fase</h3>
          <p className="text-xs text-slate-400">
            {minimo === null
              ? 'No hay salario mínimo vigente marcado en Puestos de trabajo: escríbelo en cada renglón.'
              : `Cada renglón nace con el mínimo vigente (L ${n2(minimo)}) ya puesto y se puede cambiar. La hora extra se calcula sobre base de ocho horas.`}
          </p>
        </div>
        <span className="shrink-0 text-sm font-bold tabular-nums text-brand-700">
          {subtotal === null ? '—' : `L ${n2(subtotal)}`}
        </span>
      </div>

      {suyas.length === 0 && (
        <p className="mt-2 rounded-xl bg-slate-50 px-3 py-2.5 text-xs text-slate-500 ring-1 ring-inset ring-slate-200">
          Todavía sin cuadrilla. Se agrega cuando toque: el trabajo de campo va por días, y un turno
          se guarda sin ella.
        </p>
      )}

      <div className="mt-2 flex flex-col gap-2">
        {suyas.map(({ p, i }) => {
          const salario = salarioDe(p, minimo)
          const costo = costoPersonal(p, salario)
          return (
            <div key={i} className="rounded-xl bg-slate-50 p-2.5 ring-1 ring-inset ring-slate-200">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_2.5rem] sm:items-start">
                <Selector
                  value={p.operadorId}
                  onChange={(e) => onCambiar(i, { operadorId: e.target.value })}
                  onCrear={(texto) => onCrear(i, texto)}
                  onNuevo={(texto) => onNuevo(i, texto)}
                  disabled={cerrado}
                  className="w-full min-w-0"
                >
                  <option value="">Sin nombre (se cuenta por puesto)</option>
                  {operadores
                    .filter((o) => o.es_jornal)
                    .map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.codigo ? `${o.codigo} - ${o.nombre}` : o.nombre}
                      </option>
                    ))}
                </Selector>
                <button
                  type="button"
                  aria-label={`Eliminar renglón de cuadrilla ${i + 1}`}
                  onClick={() => onQuitar(i)}
                  disabled={cerrado}
                  className="flex h-11 w-full shrink-0 items-center justify-center rounded-xl text-slate-400 transition-colors hover:bg-white hover:text-red-600 disabled:opacity-30 sm:w-10"
                >
                  <IconTrash className="h-4 w-4" />
                  <span className="ml-1.5 text-sm font-semibold sm:hidden">Eliminar</span>
                </button>
              </div>

              <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {/* **Admite fracciones desde la 74.** Un estacionero
                    repartido entre tres turnos pone 0.33 en cada uno.
                    `inputMode="decimal"` saca el teclado con punto, y la
                    coma se normaliza al escribir porque en el teléfono
                    de campo la coma es lo que sale primero. */}
                <Campo
                  etiqueta="Personas"
                  ayuda="Admite fracciones: 0.33 es una persona repartida entre tres turnos."
                  error={errorDe(`personal.${i}.cantidadPersonas`)}
                >
                  <Entrada
                    inputMode="decimal"
                    value={p.cantidadPersonas}
                    onChange={(e) =>
                      onCambiar(i, { cantidadPersonas: e.target.value.replace(',', '.') })
                    }
                    disabled={cerrado}
                    placeholder="1"
                    className={bordeError(errorDe(`personal.${i}.cantidadPersonas`))}
                  />
                </Campo>
                <Campo etiqueta="Salario" error={errorDe(`personal.${i}.salario`)}>
                  <Entrada
                    inputMode="decimal"
                    value={p.salario}
                    onChange={(e) => onCambiar(i, { salario: e.target.value.replace(',', '.') })}
                    placeholder="Escríbelo"
                    disabled={cerrado}
                    className={bordeError(errorDe(`personal.${i}.salario`))}
                  />
                </Campo>
                <Campo etiqueta="Horas extras" error={errorDe(`personal.${i}.horasExtras`)}>
                  <Entrada
                    inputMode="decimal"
                    value={p.horasExtras}
                    onChange={(e) =>
                      onCambiar(i, { horasExtras: e.target.value.replace(',', '.') })
                    }
                    disabled={cerrado}
                    className={bordeError(errorDe(`personal.${i}.horasExtras`))}
                  />
                </Campo>
                <Campo etiqueta="Jornada">
                  <Selector
                    value={p.jornadaTipo}
                    onChange={(e) => onCambiar(i, { jornadaTipo: e.target.value as JornadaTipo })}
                    disabled={cerrado}
                  >
                    {JORNADAS.map((j) => (
                      <option key={j.valor} value={j.valor}>
                        {j.etiqueta}
                      </option>
                    ))}
                  </Selector>
                </Campo>
              </div>

              <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                <Campo etiqueta="Puesto">
                  <Selector
                    value={p.puesto}
                    onChange={(e) => onCambiar(i, { puesto: e.target.value })}
                    disabled={cerrado}
                  >
                    {PUESTOS_CUADRILLA.map((x) => (
                      <option key={x} value={x}>
                        {x}
                      </option>
                    ))}
                  </Selector>
                </Campo>
                {p.puesto === PUESTO_OTRO && (
                  <Campo etiqueta="¿Cuál?" requerido error={errorDe(`personal.${i}.puestoOtro`)}>
                    <Entrada
                      value={p.puestoOtro}
                      onChange={(e) => onCambiar(i, { puestoOtro: e.target.value })}
                      placeholder="Escribe el puesto"
                      disabled={cerrado}
                      className={bordeError(errorDe(`personal.${i}.puestoOtro`))}
                    />
                  </Campo>
                )}
              </div>

              <p className="mt-1.5 px-0.5 text-[11px] text-slate-400">
                {salario === null
                  ? 'No hay salario mínimo vigente para esta fecha: escribe el salario.'
                  : `Salario L ${n2(salario)} · hora extra L ${n2(salario / 8)} × ${
                      JORNADAS.find((j) => j.valor === p.jornadaTipo)?.factor ?? 1.25
                    } → `}
                {salario !== null && <strong className="text-slate-700">L {n2(costo)}</strong>}
              </p>
            </div>
          )
        })}
      </div>

      <button
        type="button"
        onClick={onAgregar}
        disabled={cerrado}
        className="mt-2 flex items-center gap-1.5 rounded-lg px-1 py-1.5 text-sm font-semibold text-brand-700 transition-colors hover:text-brand-800 disabled:opacity-40"
      >
        <IconPlus className="h-4 w-4" />
        Agregar personal
      </button>
    </div>
  )
}

function Pie({
  etiqueta,
  valor,
  destacado = false,
}: {
  etiqueta: string
  valor: number | null
  destacado?: boolean
}) {
  return (
    <div className="rounded-lg bg-slate-50 px-2 py-1.5 text-center ring-1 ring-inset ring-slate-200">
      <p
        className={`text-sm font-bold tabular-nums ${
          destacado ? 'text-brand-700' : 'text-slate-900'
        }`}
      >
        {valor === null ? '—' : `L ${n2(valor)}`}
      </p>
      <p className="text-[10px] font-medium text-slate-400">{etiqueta}</p>
    </div>
  )
}
