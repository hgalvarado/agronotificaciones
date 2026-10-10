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
import { Acordeon } from '@/components/ui/Acordeon'
import { Alerta, Boton, Campo, Entrada, Insignia, Selector } from '@/components/ui/Primitivos'
import { IconCheck, IconLock, IconPlus, IconTrash } from '@/components/ui/Icons'
import { n2 } from '@/lib/trasplante/formato'
import { hoyIso } from '@/lib/fechas'
import { crearJornal, precioMaterial } from '@/lib/desinfeccion/repositorioCliente'
import {
  SECCIONES,
  costoCuadrilla,
  costoPersonal,
  costoProducto,
  costoQuimicos,
  dosisPorMz,
  horasInyeccion,
  horasLavado,
  horasPreriego,
  horasPresurizacion,
  mzDeLotes,
  salarioDe,
  seccionLlena,
  siguienteSeccion,
  textoDdt,
  totalHorasRiego,
  validarEjecucion,
  type SeccionEjecucion,
} from '@/lib/desinfeccion/calculo'
import {
  CICLOS,
  JORNADAS,
  LECTURA_VACIA,
  LINEA_LOTE_VACIA,
  LINEA_PRODUCTO_VACIA,
  PUESTOS_CUADRILLA,
  PUESTO_OTRO,
  TIPOS_ENVASE,
  etiquetaFase,
  lineaPersonalVacia,
  type CatalogosDesinfeccion,
  type EntradaEjecucion,
  type FasePersonal,
  type JornadaTipo,
  type LecturaTensiometro,
  type LineaLote,
  type LineaPersonal,
  type LineaProducto,
  type LoteDesinfeccion,
} from '@/lib/desinfeccion/tipos'

const TITULOS: Record<SeccionEjecucion, string> = {
  lotes: '0 · Lotes y manzanas',
  preriego: '1 · Preriego',
  lecturas: '2 · Lecturas de tensiómetro',
  aplicacion: '3 · Aplicación y químicos',
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
  /** Qué secciones venían llenas AL CARGAR. Es lo único que bloquea. */
  seccionesGuardadas,
  minimo,
  guardando,
  buscando,
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
  seccionesGuardadas: SeccionEjecucion[]
  /** El salario mínimo vigente de la fecha de la fase. Lo trae la cuadrícula. */
  minimo: number | null
  guardando: boolean
  buscando: boolean
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
  const [error, setError] = useState<string | null>(null)
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
    [guardadas, desbloqueadas]
  )

  function desbloquear(s: SeccionEjecucion) {
    setDesbloqueadas((prev) => new Set(prev).add(s))
    setAbierta(s)
  }

  const cambiar = useCallback(
    (cambios: Partial<EntradaEjecucion>) => onCambiarEntrada({ ...entrada, ...cambios }),
    [entrada, onCambiarEntrada]
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
  const quimico = useMemo(() => costoQuimicos(productos), [productos])
  const obraPreriego = useMemo(
    () => costoCuadrilla(personal, minimo, '1_Preriego'),
    [personal, minimo]
  )
  const obraAplicacion = useMemo(
    () => costoCuadrilla(personal, minimo, '3_Aplicacion'),
    [personal, minimo]
  )
  const duracionPreriego = horasPreriego(entrada)
  const presurizacion = horasPresurizacion(entrada)
  const inyeccion = horasInyeccion(entrada)
  const lavado = horasLavado(entrada)
  const totalHoras = totalHorasRiego(entrada)

  const ddtPreriego = textoDdt(fechasSiembra, entrada.fechaPreriego)
  const ddtLecturas = textoDdt(fechasSiembra, entrada.fechaLecturas)
  const ddtAplicacion = textoDdt(fechasSiembra, entrada.fechaAplicacion)
  const haySiembra = fechasSiembra.length > 0

  const granTotal = (obraPreriego ?? 0) + (obraAplicacion ?? 0) + quimico
  const costoMz = mz > 0 ? granTotal / mz : null

  /* ------------------------------ Acciones ----------------------------- */

  function guardar() {
    const problema = validarEjecucion(entrada, lotes, personal, productos, salarioPorOmision)
    if (problema) {
      setError(problema)
      if (/lote|manzana/i.test(problema)) setAbierta('lotes')
      else if (/preriego/i.test(problema)) setAbierta('preriego')
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
   * Se pide por la FECHA DE APLICACIÓN, no por la de hoy: un turno de
   * marzo se costea con el precio de marzo aunque se capture en mayo. Es
   * la misma función (`fn_precio_material`) que usa el disparador al
   * guardar, así que el número que se ve mientras se teclea y el que
   * queda guardado son el mismo.
   *
   * Sólo rellena si el costo está VACÍO. Hay compras puntuales a otro
   * precio, y pisar un número escrito sería cambiarle el dato a quien lo
   * escribió sin decírselo —la misma regla de la sugerencia de manzanas—.
   */
  async function elegirProducto(i: number, productoId: string) {
    const vacio = (productos[i]?.costoLitro ?? '').trim() === ''
    cambiarProducto(i, { productoId })
    if (!productoId || !vacio) return
    const precio = await precioMaterial(productoId, entrada.fechaAplicacion || hoyIso())
    // Sin precio en el historial se deja vacío: la base lo resolverá al
    // guardar, y un cero en pantalla parecería un dato.
    if (precio === null) return
    onCambiarProductos(
      productos.map((q, j) =>
        j === i ? { ...q, productoId, costoLitro: String(precio) } : q
      )
    )
  }

  /* ------------------------- La cuadrilla, por fase -------------------- */

  const cambiarPersona = (i: number, c: Partial<LineaPersonal>) =>
    onCambiarPersonal(personal.map((p, j) => (i === j ? { ...p, ...c } : p)))

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

  const campoDdt = (texto: string) => (
    <Campo
      etiqueta="DDT (días antes del trasplante)"
      ayuda={
        haySiembra
          ? 'Siembra de los lotes del turno menos el día de esta fase.'
          : 'Hará falta la siembra del lote en Trasplante para calcularlo.'
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
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
              <Pie etiqueta="M. obra preriego" valor={obraPreriego} />
              <Pie etiqueta="M. obra aplicación" valor={obraAplicacion} />
              <Pie etiqueta="Químicos" valor={quimico} />
              <Pie etiqueta="Costo / mz" valor={costoMz} destacado />
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
        {error && <Alerta>{error}</Alerta>}

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
              descripcion="Qué lotes tocó el turno. Sin esto no hay entre qué repartir el costo."
              resumen={resumenDe(
                'lotes',
                `${lotes.filter((l) => l.loteTemporadaId).length} lotes · ${n2(mz)} mz`
              )}
              abierto={abierta === 'lotes'}
              onAlternar={() => alternar('lotes')}
            >
              {candado('lotes')}

              <div className="flex flex-col gap-2">
                {lotes.map((l, i) => {
                  const lote = lotesDisponibles.find(
                    (d) => d.lote_temporada_id === l.loteTemporadaId
                  )
                  return (
                    <div
                      key={i}
                      className="rounded-xl bg-slate-50 p-2.5 ring-1 ring-inset ring-slate-200"
                    >
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_7rem_2.5rem] sm:items-start">
                        <Selector
                          value={l.loteTemporadaId}
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
                          Planeadas {n2(lote.mz_planeadas)} · ya desinfectadas{' '}
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
                  descripcion="El día, las horas y la cuadrilla que lo trabajó."
                  resumen={resumenDe(
                    'preriego',
                    duracionPreriego > 0 ? `${n2(duracionPreriego)} h · ${ddtPreriego}` : ddtPreriego
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
                    <Campo
                      etiqueta="Duración"
                      ayuda="Fin menos inicio, cruzando la medianoche. La calcula la base."
                    >
                      <Entrada value={`${n2(duracionPreriego)} h`} readOnly disabled />
                    </Campo>
                    {campoDdt(ddtPreriego)}
                    <Campo etiqueta="Hora de inicio">
                      <Entrada
                        type="time"
                        value={entrada.horaInicioPreriego}
                        onChange={(e) => cambiar({ horaInicioPreriego: e.target.value })}
                        disabled={bloqueada('preriego')}
                      />
                    </Campo>
                    <Campo etiqueta="Hora de fin" ayuda="Puede ser del día siguiente.">
                      <Entrada
                        type="time"
                        value={entrada.horaFinPreriego}
                        onChange={(e) => cambiar({ horaFinPreriego: e.target.value })}
                        disabled={bloqueada('preriego')}
                      />
                    </Campo>
                    <Campo etiqueta="Observaciones" className="sm:col-span-2">
                      <Entrada
                        value={entrada.obsPreriego}
                        onChange={(e) => cambiar({ obsPreriego: e.target.value })}
                        disabled={bloqueada('preriego')}
                      />
                    </Campo>
                  </div>

                  <CuadrillaFase
                    fase="1_Preriego"
                    cerrado={bloqueada('preriego')}
                    personal={personal}
                    operadores={catalogos.operadores}
                    minimo={minimo}
                    subtotal={obraPreriego}
                    onCambiar={cambiarPersona}
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
                  descripcion="El día en que se midió, que no tiene por qué ser el del preriego."
                  resumen={resumenDe(
                    'lecturas',
                    `${lecturas.filter((l) => l.lectura.trim() !== '').length} lecturas · ${ddtLecturas}`
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
                  descripcion="Tiempos, conductividad, químicos y la cuadrilla que aplicó."
                  resumen={resumenDe(
                    'aplicacion',
                    quimico > 0 ? `L ${n2(quimico)} · ${ddtAplicacion}` : ddtAplicacion
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

                    {/* Las cuatro fases del riego se capturan IGUAL desde la
                        62: con reloj. La presurización era la última que se
                        escribía a mano y por eso la única que no cruzaba la
                        medianoche. */}
                    <Campo etiqueta="Inicio de presurización">
                      <Entrada
                        type="time"
                        value={entrada.inicioPresurizacion}
                        onChange={(e) => cambiar({ inicioPresurizacion: e.target.value })}
                        disabled={bloqueada('aplicacion')}
                      />
                    </Campo>
                    <Campo etiqueta="Fin de presurización" ayuda="Puede ser del día siguiente.">
                      <Entrada
                        type="time"
                        value={entrada.finPresurizacion}
                        onChange={(e) => cambiar({ finPresurizacion: e.target.value })}
                        disabled={bloqueada('aplicacion')}
                      />
                    </Campo>

                    <Campo etiqueta="Inicio de inyección">
                      <Entrada
                        type="time"
                        value={entrada.horaInicioIny}
                        onChange={(e) => cambiar({ horaInicioIny: e.target.value })}
                        disabled={bloqueada('aplicacion')}
                      />
                    </Campo>
                    <Campo etiqueta="Fin de inyección" ayuda="Puede ser del día siguiente.">
                      <Entrada
                        type="time"
                        value={entrada.horaFinIny}
                        onChange={(e) => cambiar({ horaFinIny: e.target.value })}
                        disabled={bloqueada('aplicacion')}
                      />
                    </Campo>

                    <Campo etiqueta="Inicio de lavado">
                      <Entrada
                        type="time"
                        value={entrada.horaInicioLavado}
                        onChange={(e) => cambiar({ horaInicioLavado: e.target.value })}
                        disabled={bloqueada('aplicacion')}
                      />
                    </Campo>
                    <Campo etiqueta="Fin de lavado">
                      <Entrada
                        type="time"
                        value={entrada.horaFinLavado}
                        onChange={(e) => cambiar({ horaFinLavado: e.target.value })}
                        disabled={bloqueada('aplicacion')}
                      />
                    </Campo>

                    <Campo etiqueta="Horas de presurización" ayuda="Fin menos inicio.">
                      <Entrada value={`${n2(presurizacion)} h`} readOnly disabled />
                    </Campo>
                    <Campo etiqueta="Horas de inyección" ayuda="Fin menos inicio.">
                      <Entrada value={`${n2(inyeccion)} h`} readOnly disabled />
                    </Campo>
                    <Campo etiqueta="Horas de lavado" ayuda="Fin menos inicio.">
                      <Entrada value={`${n2(lavado)} h`} readOnly disabled />
                    </Campo>

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

                    <Campo etiqueta="ppm" ayuda="A mano: la fórmula depende del caudal.">
                      <Entrada
                        inputMode="decimal"
                        value={entrada.ppm}
                        onChange={(e) => cambiar({ ppm: e.target.value })}
                        disabled={bloqueada('aplicacion')}
                      />
                    </Campo>
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
                    <Campo etiqueta="Calibración entrada">
                      <Entrada
                        inputMode="decimal"
                        value={entrada.calibracionEntrada}
                        onChange={(e) => cambiar({ calibracionEntrada: e.target.value })}
                        disabled={bloqueada('aplicacion')}
                      />
                    </Campo>
                    <Campo etiqueta="Calibración salida">
                      <Entrada
                        inputMode="decimal"
                        value={entrada.calibracionSalida}
                        onChange={(e) => cambiar({ calibracionSalida: e.target.value })}
                        disabled={bloqueada('aplicacion')}
                      />
                    </Campo>
                    <Campo etiqueta="Calibración campo">
                      <Entrada
                        inputMode="decimal"
                        value={entrada.calibracionCampo}
                        onChange={(e) => cambiar({ calibracionCampo: e.target.value })}
                        disabled={bloqueada('aplicacion')}
                      />
                    </Campo>
                  </div>

                  {/* ------------------- Los químicos ------------------ */}
                  <div className="mt-4 flex items-start justify-between gap-3 border-t border-slate-100 pt-3">
                    <div className="min-w-0">
                      <h3 className="text-sm font-semibold text-slate-900">Químicos aplicados</h3>
                      <p className="text-xs text-slate-400">
                        Se anota el TOTAL aplicado; la dosis sale de las {n2(mz)} mz del turno. El
                        costo lo toma del catálogo si lo dejas vacío.
                      </p>
                    </div>
                    <span className="shrink-0 text-sm font-bold tabular-nums text-brand-700">
                      L {n2(quimico)}
                    </span>
                  </div>

                  <div className="mt-2 flex flex-col gap-2">
                    {productos.map((q, i) => {
                      const dosis = dosisPorMz(q.totalLitros, mz)
                      const material = catalogos.materiales.find((m) => m.id === q.productoId)
                      return (
                        <div
                          key={i}
                          className="rounded-xl bg-slate-50 p-2.5 ring-1 ring-inset ring-slate-200"
                        >
                          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_2.5rem] sm:items-start">
                            <Selector
                              value={q.productoId}
                              buscable
                              onChange={(e) => void elegirProducto(i, e.target.value)}
                              disabled={bloqueada('aplicacion')}
                              className="w-full min-w-0"
                            >
                              <option value="">Elige el producto…</option>
                              {catalogos.materiales.map((m) => (
                                <option key={m.id} value={m.id}>
                                  {m.codigo}
                                  {m.descripcion ? ` · ${m.descripcion}` : ''}
                                  {m.ingrediente_activo ? ` — ${m.ingrediente_activo}` : ''}
                                </option>
                              ))}
                            </Selector>
                            <button
                              type="button"
                              aria-label={`Eliminar químico ${i + 1}`}
                              onClick={() =>
                                onCambiarProductos(productos.filter((_, j) => j !== i))
                              }
                              disabled={bloqueada('aplicacion')}
                              className="flex h-11 w-full shrink-0 items-center justify-center rounded-xl text-slate-400 transition-colors hover:bg-white hover:text-red-600 disabled:opacity-30 sm:w-10"
                            >
                              <IconTrash className="h-4 w-4" />
                              <span className="ml-1.5 text-sm font-semibold sm:hidden">
                                Eliminar
                              </span>
                            </button>
                          </div>

                          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                            <Campo etiqueta="Total (L)">
                              <Entrada
                                inputMode="decimal"
                                value={q.totalLitros}
                                onChange={(e) =>
                                  cambiarProducto(i, { totalLitros: e.target.value })
                                }
                                disabled={bloqueada('aplicacion')}
                                placeholder="0.00"
                              />
                            </Campo>
                            <Campo etiqueta="Costo/L">
                              <Entrada
                                inputMode="decimal"
                                value={q.costoLitro}
                                onChange={(e) => cambiarProducto(i, { costoLitro: e.target.value })}
                                disabled={bloqueada('aplicacion')}
                                placeholder="Del catálogo"
                              />
                            </Campo>
                            <Campo etiqueta="Envases">
                              <Entrada
                                inputMode="numeric"
                                value={q.cantidadEnvases}
                                onChange={(e) =>
                                  cambiarProducto(i, { cantidadEnvases: e.target.value })
                                }
                                disabled={bloqueada('aplicacion')}
                                placeholder="0"
                              />
                            </Campo>
                            <Campo etiqueta="Tipo de envase">
                              <Selector
                                value={q.tipoEnvase}
                                onChange={(e) =>
                                  cambiarProducto(i, { tipoEnvase: e.target.value })
                                }
                                disabled={bloqueada('aplicacion')}
                              >
                                <option value="">Sin especificar</option>
                                {TIPOS_ENVASE.map((t) => (
                                  <option key={t} value={t}>
                                    {t}
                                  </option>
                                ))}
                              </Selector>
                            </Campo>
                          </div>

                          <div className="mt-2 grid grid-cols-2 gap-2">
                            <Campo etiqueta="Dosis/mz">
                              <Entrada value={dosis === null ? '—' : n2(dosis)} readOnly disabled />
                            </Campo>
                            <Campo etiqueta="Costo total">
                              <Entrada value={n2(costoProducto(q))} readOnly disabled />
                            </Campo>
                          </div>

                          {material?.ingrediente_activo && (
                            <p className="mt-1.5 px-0.5 text-[11px] text-slate-400">
                              {material.ingrediente_activo}
                              {material.concentracion ? ` · ${material.concentracion}` : ''}
                            </p>
                          )}
                        </div>
                      )
                    })}
                  </div>

                  <button
                    type="button"
                    onClick={() => onCambiarProductos([...productos, { ...LINEA_PRODUCTO_VACIA }])}
                    disabled={bloqueada('aplicacion')}
                    className="mt-2 flex items-center gap-1.5 rounded-lg px-1 py-1.5 text-sm font-semibold text-brand-700 transition-colors hover:text-brand-800 disabled:opacity-40"
                  >
                    <IconPlus className="h-4 w-4" />
                    Agregar químico
                  </button>

                  <CuadrillaFase
                    fase="3_Aplicacion"
                    cerrado={bloqueada('aplicacion')}
                    personal={personal}
                    operadores={catalogos.operadores}
                    minimo={minimo}
                    subtotal={obraAplicacion}
                    onCambiar={cambiarPersona}
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

                {SECCIONES.every((s) => seccionLlena(s, entrada, lotes, lecturas)) && (
                  <Alerta tono="azul">
                    El turno está completo: las cuatro secciones tienen lo suyo.
                  </Alerta>
                )}
              </>
            )}
          </>
        )}
      </div>
    </Modal>
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
function CuadrillaFase({
  fase,
  cerrado,
  personal,
  operadores,
  minimo,
  subtotal,
  onCambiar,
  onQuitar,
  onAgregar,
  onCrear,
}: {
  fase: FasePersonal
  cerrado: boolean
  personal: LineaPersonal[]
  operadores: CatalogosDesinfeccion['operadores']
  minimo: number | null
  subtotal: number | null
  onCambiar: (indice: number, cambios: Partial<LineaPersonal>) => void
  onQuitar: (indice: number) => void
  onAgregar: () => void
  onCrear: (indice: number, texto: string) => Promise<string>
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
          Todavía sin cuadrilla. Se agrega cuando toque: el trabajo de campo va por días, y un
          turno se guarda sin ella.
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
                <Campo etiqueta="Personas">
                  <Entrada
                    inputMode="numeric"
                    value={p.cantidadPersonas}
                    onChange={(e) => onCambiar(i, { cantidadPersonas: e.target.value })}
                    disabled={cerrado}
                  />
                </Campo>
                <Campo etiqueta="Salario">
                  <Entrada
                    inputMode="decimal"
                    value={p.salario}
                    onChange={(e) => onCambiar(i, { salario: e.target.value })}
                    placeholder="Escríbelo"
                    disabled={cerrado}
                  />
                </Campo>
                <Campo etiqueta="Horas extras">
                  <Entrada
                    inputMode="decimal"
                    value={p.horasExtras}
                    onChange={(e) => onCambiar(i, { horasExtras: e.target.value })}
                    disabled={cerrado}
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
                  <Campo etiqueta="¿Cuál?" requerido>
                    <Entrada
                      value={p.puestoOtro}
                      onChange={(e) => onCambiar(i, { puestoOtro: e.target.value })}
                      placeholder="Escribe el puesto"
                      disabled={cerrado}
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
