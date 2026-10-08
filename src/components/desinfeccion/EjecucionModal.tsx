'use client'

/**
 * El embudo de captura de un turno de desinfección.
 *
 * **El activador va fuera del acordeón.** Lo primero que se pregunta es
 * TURNO y CICLO, porque con esos dos datos o se abre el turno que ya
 * existe o se empieza uno. Sin ese paso, capturar el preriego el lunes y
 * la aplicación el jueves creaba dos turnos distintos y el costo se
 * partía en dos sin que nadie lo notara. La llave única de la 60 es lo
 * que garantiza que la búsqueda devuelva uno o ninguno.
 *
 * Después, cuatro secciones en orden de proceso:
 *
 *   0 · Lotes y manzanas   ← bloquea a las demás
 *   1 · Preriego
 *   2 * Lecturas
 *   3 · Aplicación y químicos
 *
 * **El paso 0 bloquea** y no es una formalidad: el químico y la cuadrilla
 * se reparten entre los lotes del turno por manzanas, así que sin
 * manzanas no hay entre qué repartir y el costo se queda en el aire.
 *
 * **Lo ya capturado se abre plegado y bloqueado**, con su propio botón
 * de Editar. Quien vuelve al día siguiente no viene a mirar lo que ya
 * hizo: viene a seguir donde lo dejó, y el acordeón se abre solo por la
 * primera sección vacía.
 *
 * La cuadrilla se queda como estaba, a la espera.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Acordeon } from '@/components/ui/Acordeon'
import { Alerta, Boton, Campo, Entrada, Insignia, Selector } from '@/components/ui/Primitivos'
import { IconCheck, IconLock, IconPlus, IconTrash } from '@/components/ui/Icons'
import { n2 } from '@/lib/trasplante/formato'
import { hoyIso } from '@/lib/fechas'
import { tarifaPuesto } from '@/lib/desinfeccion/repositorioCliente'
import {
  SECCIONES,
  costoCuadrilla,
  costoPersonal,
  costoProducto,
  costoQuimicos,
  ddt,
  dosisPorMz,
  horasInyeccion,
  horasPreriego,
  mzDeLotes,
  seccionLlena,
  siguienteSeccion,
  totalHorasRiego,
  validarEjecucion,
  type SeccionEjecucion,
} from '@/lib/desinfeccion/calculo'
import {
  CICLOS,
  FASES,
  JORNADAS,
  LECTURA_VACIA,
  LINEA_LOTE_VACIA,
  LINEA_PERSONAL_VACIA,
  LINEA_PRODUCTO_VACIA,
  etiquetaFase,
  type CatalogosDesinfeccion,
  type EntradaEjecucion,
  type EstadoDesinfeccion,
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
  /** La siembra del lote más temprano del turno, para el DDT. */
  fechaSiembra,
  guardando,
  buscando,
  onActivar,
  onCambiarEntrada,
  onCambiarLecturas,
  onCambiarLotes,
  onCambiarPersonal,
  onCambiarProductos,
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
  fechaSiembra: string | null
  guardando: boolean
  buscando: boolean
  /** Turno + ciclo: el padre busca si ya existe y carga lo que haya. */
  onActivar: (turnoId: string, ciclo: string) => void
  onCambiarEntrada: (e: EntradaEjecucion) => void
  onCambiarLecturas: (l: LecturaTensiometro[]) => void
  onCambiarLotes: (l: LineaLote[]) => void
  onCambiarPersonal: (p: LineaPersonal[]) => void
  onCambiarProductos: (q: LineaProducto[]) => void
  onGuardar: () => void
  onCerrar: () => void
}) {
  const [error, setError] = useState<string | null>(null)
  const [abierta, setAbierta] = useState<SeccionEjecucion | 'cuadrilla' | null>(null)
  /** Las secciones que se han vuelto a abrir a mano para corregirlas. */
  const [desbloqueadas, setDesbloqueadas] = useState<Set<SeccionEjecucion>>(new Set())

  const activado = entrada.turnoId !== '' && entrada.ciclo !== ''
  const esNuevo = !entrada.id
  const mz = useMemo(() => mzDeLotes(lotes), [lotes])
  const lotesListos = mz > 0

  /* ----------------------- Por dónde se sigue ------------------------- */
  // Al entrar —y cada vez que se carga otro turno— se abre la PRIMERA
  // sección vacía. El identificador de la ejecución es la señal: cambia
  // cuando el activador trae otro turno.
  const huella = `${entrada.id}|${entrada.turnoId}|${entrada.ciclo}`
  const [huellaPrevia, setHuellaPrevia] = useState<string | null>(null)
  if (activado && huella !== huellaPrevia) {
    setHuellaPrevia(huella)
    setAbierta(siguienteSeccion(entrada, lotes, lecturas) ?? null)
    setDesbloqueadas(new Set())
  }

  /** Guardada y no reabierta a mano: se mira, no se toca. */
  const bloqueada = useCallback(
    (s: SeccionEjecucion) =>
      !esNuevo && seccionLlena(s, entrada, lotes, lecturas) && !desbloqueadas.has(s),
    [esNuevo, entrada, lotes, lecturas, desbloqueadas]
  )

  function desbloquear(s: SeccionEjecucion) {
    setDesbloqueadas((prev) => new Set(prev).add(s))
    setAbierta(s)
  }

  const cambiar = useCallback(
    (cambios: Partial<EntradaEjecucion>) => onCambiarEntrada({ ...entrada, ...cambios }),
    [entrada, onCambiarEntrada]
  )

  /* ----------------------- Las tarifas del personal ------------------- */
  const fechaTarifa = entrada.fechaAplicacion || entrada.fechaPreriego || hoyIso()
  const [tarifas, setTarifas] = useState<Record<string, number | null>>({})
  const puestosPedidos = useMemo(
    () => [...new Set(personal.map((p) => p.puestoId).filter(Boolean))].sort().join(','),
    [personal]
  )

  useEffect(() => {
    let vivo = true
    async function cargar() {
      const puestos = puestosPedidos ? puestosPedidos.split(',') : []
      if (puestos.length === 0) return
      const pares = await Promise.all(
        puestos.map(async (id) => [id, await tarifaPuesto(id, fechaTarifa)] as const)
      )
      if (!vivo) return
      setTarifas(Object.fromEntries(pares))
    }
    void cargar()
    return () => {
      vivo = false
    }
  }, [puestosPedidos, fechaTarifa])

  const tarifaDe = useCallback((puestoId: string) => tarifas[puestoId] ?? null, [tarifas])

  /* ------------------------------ Cuentas ------------------------------ */
  const quimico = useMemo(() => costoQuimicos(productos), [productos])
  const manoObra = useMemo(() => costoCuadrilla(personal, tarifaDe), [personal, tarifaDe])
  const duracionPreriego = horasPreriego(entrada)
  const inyeccion = horasInyeccion(entrada)
  const totalHoras = totalHorasRiego(entrada)
  const diasAlTrasplante = ddt(fechaSiembra, entrada.fechaLecturas)

  /* ------------------------------ Acciones ----------------------------- */

  function guardar() {
    const problema = validarEjecucion(entrada, lotes, personal, productos)
    if (problema) {
      setError(problema)
      // Llevar a la sección del problema ahorra buscarlo a ojo entre
      // cuatro secciones plegadas.
      if (/lote|manzana/i.test(problema)) setAbierta('lotes')
      else if (/preriego/i.test(problema)) setAbierta('preriego')
      else if (/producto|litro|químico|quimico/i.test(problema)) setAbierta('aplicacion')
      return
    }
    setError(null)
    onGuardar()
  }

  const alternar = (s: SeccionEjecucion | 'cuadrilla') =>
    setAbierta((a) => (a === s ? null : s))

  const cambiarLectura = (i: number, c: Partial<LecturaTensiometro>) =>
    onCambiarLecturas(lecturas.map((l, j) => (i === j ? { ...l, ...c } : l)))
  const cambiarLote = (i: number, c: Partial<LineaLote>) =>
    onCambiarLotes(lotes.map((l, j) => (i === j ? { ...l, ...c } : l)))
  const cambiarPersona = (i: number, c: Partial<LineaPersonal>) =>
    onCambiarPersonal(personal.map((p, j) => (i === j ? { ...p, ...c } : p)))
  const cambiarProducto = (i: number, c: Partial<LineaProducto>) =>
    onCambiarProductos(productos.map((q, j) => (i === j ? { ...q, ...c } : q)))

  const fase = etiquetaFase(entrada.estado)

  /** El encabezado de cada sección: tilde si está hecha, candado si está cerrada. */
  const resumenDe = (s: SeccionEjecucion, texto: string) => (
    <span className="flex items-center gap-1.5">
      {seccionLlena(s, entrada, lotes, lecturas) && (
        <IconCheck className="h-3.5 w-3.5 text-brand-700" />
      )}
      {bloqueada(s) && <IconLock className="h-3.5 w-3.5 text-slate-400" />}
      <span>{texto}</span>
    </span>
  )

  /** El aviso y el botón de reabrir, dentro de una sección bloqueada. */
  const candado = (s: SeccionEjecucion) =>
    bloqueada(s) ? (
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-50 px-3 py-2.5 ring-1 ring-inset ring-slate-200">
        <p className="text-xs text-slate-500">
          Esta parte ya se capturó. Se deja bloqueada para no cambiarla sin querer.
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
        <div className="flex gap-2">
          <Boton variante="secundario" className="flex-1" onClick={onCerrar} disabled={guardando}>
            Cancelar
          </Boton>
          <Boton className="flex-1" onClick={guardar} disabled={guardando || !activado}>
            {guardando ? 'Guardando…' : 'Guardar'}
          </Boton>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        {error && <Alerta>{error}</Alerta>}

        {/* ===================== EL ACTIVADOR ======================== */}
        {/* Fuera del acordeón a propósito: es la pregunta que decide si
            se abre un turno que ya existe o se empieza uno. */}
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
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Insignia tono={fase.tono}>{fase.etiqueta}</Insignia>
              <Campo etiqueta="Fase" className="w-44">
                <Selector
                  value={entrada.estado}
                  onChange={(e) => cambiar({ estado: e.target.value as EstadoDesinfeccion })}
                >
                  {FASES.map((f) => (
                    <option key={f.valor} value={f.valor}>
                      {f.etiqueta}
                    </option>
                  ))}
                </Selector>
              </Campo>
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
                {lotes.map((l, i) => (
                  <div key={i} className="rounded-xl bg-slate-50 p-2.5 ring-1 ring-inset ring-slate-200">
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_7rem_2.5rem] sm:items-start">
                      <Selector
                        value={l.loteTemporadaId}
                        onChange={(e) => cambiarLote(i, { loteTemporadaId: e.target.value })}
                        disabled={bloqueada('lotes')}
                        className="w-full min-w-0"
                      >
                        <option value="">Elige el lote…</option>
                        {lotesDisponibles.map((d) => (
                          <option key={d.lote_temporada_id} value={d.lote_temporada_id}>
                            {d.nomenclatura}
                            {d.nombre ? ` · ${d.nombre}` : ''} — {n2(d.area_neta)} mz
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
                  </div>
                ))}
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
                  descripcion="El día y las horas en que se regó antes de aplicar."
                  resumen={resumenDe(
                    'preriego',
                    duracionPreriego > 0 ? `${n2(duracionPreriego)} h` : '—'
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
                      ayuda="Fin menos inicio. La calcula la base; aquí sólo se ve."
                    >
                      <Entrada value={`${n2(duracionPreriego)} h`} readOnly disabled />
                    </Campo>
                    <Campo etiqueta="Hora de inicio">
                      <Entrada
                        type="time"
                        value={entrada.horaInicioPreriego}
                        onChange={(e) => cambiar({ horaInicioPreriego: e.target.value })}
                        disabled={bloqueada('preriego')}
                      />
                    </Campo>
                    <Campo etiqueta="Hora de fin">
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
                </Acordeon>

                {/* =================== 2 · LECTURAS =================== */}
                <Acordeon
                  titulo={TITULOS.lecturas}
                  descripcion="El día en que se midió, que no tiene por qué ser el del preriego."
                  resumen={resumenDe(
                    'lecturas',
                    `${lecturas.filter((l) => l.lectura.trim() !== '').length} lecturas`
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
                    <Campo
                      etiqueta="DAT (días antes del trasplante)"
                      // Sale de la siembra del lote más temprano del turno.
                      // Si ese lote no tiene siembra capturada todavía, no
                      // se inventa un número: se dice que falta.
                      ayuda={
                        fechaSiembra
                          ? 'Siembra del lote más temprano menos el día de la lectura.'
                          : 'Hará falta la siembra del lote en Trasplante para calcularlo.'
                      }
                    >
                      <Entrada
                        value={diasAlTrasplante === null ? '—' : `${diasAlTrasplante} días`}
                        readOnly
                        disabled
                      />
                    </Campo>
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
                  descripcion="Tiempos, conductividad, calibración y los químicos."
                  resumen={resumenDe(
                    'aplicacion',
                    quimico > 0 ? `L ${n2(quimico)}` : totalHoras > 0 ? `${n2(totalHoras)} h` : '—'
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

                    <Campo etiqueta="Horas de presurización">
                      <Entrada
                        inputMode="decimal"
                        value={entrada.horasPresurizacion}
                        onChange={(e) => cambiar({ horasPresurizacion: e.target.value })}
                        disabled={bloqueada('aplicacion')}
                        placeholder="0.00"
                      />
                    </Campo>
                    <Campo etiqueta="Horas de lavado">
                      <Entrada
                        inputMode="decimal"
                        value={entrada.horasLavado}
                        onChange={(e) => cambiar({ horasLavado: e.target.value })}
                        disabled={bloqueada('aplicacion')}
                        placeholder="0.00"
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
                    <Campo etiqueta="Fin de inyección">
                      <Entrada
                        type="time"
                        value={entrada.horaFinIny}
                        onChange={(e) => cambiar({ horaFinIny: e.target.value })}
                        disabled={bloqueada('aplicacion')}
                      />
                    </Campo>

                    <Campo etiqueta="Horas de inyección" ayuda="Fin menos inicio.">
                      <Entrada value={`${n2(inyeccion)} h`} readOnly disabled />
                    </Campo>
                    <Campo
                      etiqueta="Total de horas de riego"
                      // Columna generada desde la 60: no se puede escribir
                      // ni aquí ni por ningún otro camino.
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
                        Se anota el TOTAL aplicado; la dosis por manzana sale de las {n2(mz)} mz del
                        turno.
                      </p>
                    </div>
                    <span className="shrink-0 text-sm font-bold tabular-nums text-brand-700">
                      L {n2(quimico)}
                    </span>
                  </div>

                  <div className="mt-2 flex flex-col gap-2">
                    {productos.map((q, i) => {
                      const dosis = dosisPorMz(q.totalLitros, mz)
                      return (
                        <div
                          key={i}
                          className="rounded-xl bg-slate-50 p-2.5 ring-1 ring-inset ring-slate-200"
                        >
                          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_2.5rem] sm:items-start">
                            <Selector
                              value={q.productoId}
                              onChange={(e) => cambiarProducto(i, { productoId: e.target.value })}
                              disabled={bloqueada('aplicacion')}
                              className="w-full min-w-0"
                            >
                              <option value="">Elige el producto…</option>
                              {catalogos.materiales.map((m) => (
                                <option key={m.id} value={m.id}>
                                  {m.codigo}
                                  {m.descripcion ? ` · ${m.descripcion}` : ''}
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
                                placeholder="0.0000"
                              />
                            </Campo>
                            <Campo etiqueta="Dosis/mz">
                              <Entrada
                                value={dosis === null ? '—' : n2(dosis)}
                                readOnly
                                disabled
                              />
                            </Campo>
                            <Campo etiqueta="Costo total">
                              <Entrada value={n2(costoProducto(q))} readOnly disabled />
                            </Campo>
                          </div>
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
                </Acordeon>

                {/* ==================== CUADRILLA ===================== */}
                {/* Se queda como estaba: el encargo la deja pendiente. */}
                <Acordeon
                  titulo="Cuadrilla"
                  descripcion="Quién trabajó el turno. La tarifa sale del puesto y de la fecha."
                  resumen={manoObra === null ? '—' : `L ${n2(manoObra)}`}
                  abierto={abierta === 'cuadrilla'}
                  onAlternar={() => alternar('cuadrilla')}
                >
                  <div className="flex flex-col gap-2">
                    {personal.map((p, i) => {
                      const tarifa = tarifaDe(p.puestoId)
                      const costo = costoPersonal(p, tarifa)
                      return (
                        <div
                          key={i}
                          className="rounded-xl bg-slate-50 p-2.5 ring-1 ring-inset ring-slate-200"
                        >
                          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_2.5rem] sm:items-start">
                            <Selector
                              value={p.puestoId}
                              onChange={(e) => cambiarPersona(i, { puestoId: e.target.value })}
                              className="w-full min-w-0"
                            >
                              <option value="">Elige el puesto…</option>
                              {catalogos.puestos.map((x) => (
                                <option key={x.id} value={x.id}>
                                  {x.codigo}
                                  {x.descripcion ? ` · ${x.descripcion}` : ''}
                                </option>
                              ))}
                            </Selector>
                            <Selector
                              value={p.operadorId}
                              onChange={(e) => cambiarPersona(i, { operadorId: e.target.value })}
                              className="w-full min-w-0"
                            >
                              <option value="">Sin nombre (se cuenta por puesto)</option>
                              {catalogos.operadores.map((o) => (
                                <option key={o.id} value={o.id}>
                                  {o.nombre}
                                </option>
                              ))}
                            </Selector>
                            <button
                              type="button"
                              aria-label={`Eliminar renglón de personal ${i + 1}`}
                              onClick={() => onCambiarPersonal(personal.filter((_, j) => j !== i))}
                              disabled={personal.length === 1}
                              className="flex h-11 w-full shrink-0 items-center justify-center rounded-xl text-slate-400 transition-colors hover:bg-white hover:text-red-600 disabled:opacity-30 sm:w-10"
                            >
                              <IconTrash className="h-4 w-4" />
                              <span className="ml-1.5 text-sm font-semibold sm:hidden">
                                Eliminar
                              </span>
                            </button>
                          </div>

                          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                            <Campo etiqueta="Personas">
                              <Entrada
                                inputMode="numeric"
                                value={p.cantidadPersonas}
                                onChange={(e) =>
                                  cambiarPersona(i, { cantidadPersonas: e.target.value })
                                }
                              />
                            </Campo>
                            <Campo etiqueta="Jornadas">
                              <Entrada
                                inputMode="decimal"
                                value={p.jornadas}
                                onChange={(e) => cambiarPersona(i, { jornadas: e.target.value })}
                              />
                            </Campo>
                            <Campo etiqueta="Horas extras">
                              <Entrada
                                inputMode="decimal"
                                value={p.horasExtras}
                                onChange={(e) => cambiarPersona(i, { horasExtras: e.target.value })}
                              />
                            </Campo>
                            <Campo etiqueta="Jornada">
                              <Selector
                                value={p.jornadaTipo}
                                onChange={(e) =>
                                  cambiarPersona(i, { jornadaTipo: e.target.value as JornadaTipo })
                                }
                              >
                                {JORNADAS.map((j) => (
                                  <option key={j.valor} value={j.valor}>
                                    {j.etiqueta}
                                  </option>
                                ))}
                              </Selector>
                            </Campo>
                          </div>

                          <p className="mt-1.5 px-0.5 text-[11px] text-slate-400">
                            {!p.puestoId
                              ? 'Elige el puesto para ver lo que cuesta.'
                              : tarifa === null
                                ? 'Ese puesto todavía no tiene tarifa vigente en esta fecha: el costo lo pondrá la base en cero hasta que la tenga.'
                                : `Jornada L ${n2(tarifa)} · hora extra L ${n2(tarifa / 8)} × ${
                                    JORNADAS.find((j) => j.valor === p.jornadaTipo)?.factor ?? 1.25
                                  } → `}
                            {tarifa !== null && p.puestoId && (
                              <strong className="text-slate-700">L {n2(costo)}</strong>
                            )}
                          </p>
                        </div>
                      )
                    })}
                  </div>

                  <button
                    type="button"
                    onClick={() => onCambiarPersonal([...personal, { ...LINEA_PERSONAL_VACIA }])}
                    className="mt-2 flex items-center gap-1.5 rounded-lg px-1 py-1.5 text-sm font-semibold text-brand-700 transition-colors hover:text-brand-800"
                  >
                    <IconPlus className="h-4 w-4" />
                    Agregar personal
                  </button>
                </Acordeon>

                {/* El resumen del turno, siempre a la vista. */}
                <div className="grid grid-cols-4 gap-2">
                  <Resumen etiqueta="Manzanas" valor={n2(mz)} />
                  <Resumen etiqueta="Horas riego" valor={n2(totalHoras)} />
                  <Resumen etiqueta="Químico" valor={`L ${n2(quimico)}`} />
                  <Resumen
                    etiqueta="Mano de obra"
                    valor={manoObra === null ? '—' : `L ${n2(manoObra)}`}
                  />
                </div>

                {SECCIONES.every((s) => seccionLlena(s, entrada, lotes, lecturas)) && (
                  <Alerta tono="azul">El turno está completo: las cuatro secciones tienen lo suyo.</Alerta>
                )}
              </>
            )}
          </>
        )}
      </div>
    </Modal>
  )
}

function Resumen({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <div className="rounded-xl bg-slate-50 px-2 py-2.5 text-center ring-1 ring-inset ring-slate-200">
      <p className="text-sm font-bold tabular-nums text-slate-900">{valor}</p>
      <p className="text-[10px] font-medium text-slate-400">{etiqueta}</p>
    </div>
  )
}
