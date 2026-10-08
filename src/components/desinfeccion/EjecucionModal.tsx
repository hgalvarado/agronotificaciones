'use client'

/**
 * El embudo de captura de un turno de desinfección.
 *
 * Son más de treinta campos y cuatro bloques distintos, así que **no es
 * un formulario plano**: es un acordeón de cuatro secciones, apiladas en
 * una sola columna. En el teléfono —que es donde se captura esto, en
 * campo— eso significa que nunca hay que desplazarse de lado para leer
 * una etiqueta, y que se ve el índice completo del turno de un vistazo.
 *
 *   A · Datos base y preriego
 *   B · Lecturas de tensiómetro        (va a JSONB)
 *   C · Aplicación                      (tiempos, CE, presurización, químico)
 *   D · Lotes regados y cuadrilla       (las dos sub-tablas)
 *
 * Qué sección se abre sola lo decide la FASE del turno: quien entra a uno
 * que está en preriego viene a capturar el preriego, no a mirar las
 * calibraciones.
 *
 * **La vista previa del costo del personal no es el costo.** El costo lo
 * pone el disparador de la base con la tarifa vigente; esto es el mismo
 * cálculo hecho con la tarifa que devuelve `fn_tarifa_puesto`, para que
 * quien captura vea lo que va a costar antes de guardar. Después de
 * guardar manda el número de la base.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Acordeon } from '@/components/ui/Acordeon'
import { Alerta, Boton, Campo, Entrada, Insignia, Selector } from '@/components/ui/Primitivos'
import { IconPlus, IconTrash } from '@/components/ui/Icons'
import { n2 } from '@/lib/trasplante/formato'
import { hoyIso } from '@/lib/fechas'
import { tarifaPuesto } from '@/lib/desinfeccion/repositorioCliente'
import {
  aNumeroCero,
  costoAcido,
  costoCuadrilla,
  costoPersonal,
  faseCerrada,
  horasSugeridas,
  mzDeLotes,
  nivelDeFase,
  validarEjecucion,
} from '@/lib/desinfeccion/calculo'
import {
  FASES,
  JORNADAS,
  LECTURA_VACIA,
  LINEA_LOTE_VACIA,
  LINEA_PERSONAL_VACIA,
  etiquetaFase,
  type CatalogosDesinfeccion,
  type EntradaEjecucion,
  type EstadoDesinfeccion,
  type JornadaTipo,
  type LecturaTensiometro,
  type LineaLote,
  type LineaPersonal,
  type LoteDesinfeccion,
} from '@/lib/desinfeccion/tipos'

type Seccion = 'base' | 'lecturas' | 'aplicacion' | 'detalle'

/** Qué sección se abre sola según en qué fase está el turno. */
function seccionDeFase(estado: EstadoDesinfeccion): Seccion {
  if (estado === '2_Lecturas') return 'lecturas'
  if (estado === '3_Aplicacion') return 'aplicacion'
  return 'base'
}

export function EjecucionModal({
  entrada,
  lecturas,
  lotes,
  personal,
  catalogos,
  lotesDisponibles,
  guardando,
  onCambiarEntrada,
  onCambiarLecturas,
  onCambiarLotes,
  onCambiarPersonal,
  onGuardar,
  onCerrar,
}: {
  entrada: EntradaEjecucion
  lecturas: LecturaTensiometro[]
  lotes: LineaLote[]
  personal: LineaPersonal[]
  catalogos: CatalogosDesinfeccion
  lotesDisponibles: LoteDesinfeccion[]
  guardando: boolean
  onCambiarEntrada: (e: EntradaEjecucion) => void
  onCambiarLecturas: (l: LecturaTensiometro[]) => void
  onCambiarLotes: (l: LineaLote[]) => void
  onCambiarPersonal: (p: LineaPersonal[]) => void
  onGuardar: () => void
  onCerrar: () => void
}) {
  const [error, setError] = useState<string | null>(null)
  const [abierta, setAbierta] = useState<Seccion | null>(() => seccionDeFase(entrada.estado))
  // El candado de fase se abre a mano y se dice que se abrió. Ver
  // `faseCerrada` en `calculo.ts`: es convención de pantalla, no RLS.
  const [desbloqueado, setDesbloqueado] = useState(false)

  const cerrado = faseCerrada(entrada.estado) && !desbloqueado
  const esNuevo = !entrada.id

  const cambiar = useCallback(
    (cambios: Partial<EntradaEjecucion>) => onCambiarEntrada({ ...entrada, ...cambios }),
    [entrada, onCambiarEntrada]
  )

  /* ----------------------- Las tarifas, para la vista previa ----------- */
  // La fecha de la ejecución manda sobre la tarifa, igual que en el
  // disparador: una jornada de marzo se paga con la tarifa de marzo
  // aunque se capture en mayo.
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

  /* ------------------------------ Totales ------------------------------ */
  const mz = useMemo(() => mzDeLotes(lotes), [lotes])
  const quimico = costoAcido(entrada)
  const manoObra = useMemo(() => costoCuadrilla(personal, tarifaDe), [personal, tarifaDe])
  const sugeridas = horasSugeridas(entrada)

  /* ------------------------------ Acciones ----------------------------- */

  function cambiarTurno(turnoId: string) {
    cambiar({ turnoId })
  }

  function guardar() {
    const problema = validarEjecucion(entrada, lotes, personal)
    if (problema) return setError(problema)
    setError(null)
    onGuardar()
  }

  const alternar = (s: Seccion) => setAbierta((a) => (a === s ? null : s))

  const cambiarLectura = (i: number, c: Partial<LecturaTensiometro>) =>
    onCambiarLecturas(lecturas.map((l, j) => (i === j ? { ...l, ...c } : l)))
  const cambiarLote = (i: number, c: Partial<LineaLote>) =>
    onCambiarLotes(lotes.map((l, j) => (i === j ? { ...l, ...c } : l)))
  const cambiarPersona = (i: number, c: Partial<LineaPersonal>) =>
    onCambiarPersonal(personal.map((p, j) => (i === j ? { ...p, ...c } : p)))

  const fase = etiquetaFase(entrada.estado)

  return (
    <Modal
      abierto
      ancho="ancho"
      onCerrar={onCerrar}
      titulo={esNuevo ? 'Nueva ejecución' : 'Editar ejecución'}
      pie={
        <div className="flex gap-2">
          <Boton variante="secundario" className="flex-1" onClick={onCerrar} disabled={guardando}>
            Cancelar
          </Boton>
          <Boton className="flex-1" onClick={guardar} disabled={guardando}>
            {guardando ? 'Guardando…' : 'Guardar'}
          </Boton>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        {error && <Alerta>{error}</Alerta>}

        {faseCerrada(entrada.estado) && (
          <div className="rounded-xl bg-amber-50 px-3.5 py-3 ring-1 ring-inset ring-amber-600/10">
            <p className="text-sm font-semibold text-amber-900">
              Este turno ya está en fase de Aplicación.
            </p>
            <p className="mt-0.5 text-xs text-amber-800">
              Los campos quedan bloqueados para no corregirlo de pasada creyendo que es el de hoy.
            </p>
            <label className="mt-2 flex items-center gap-2 text-xs font-semibold text-amber-900">
              <input
                type="checkbox"
                checked={desbloqueado}
                onChange={(e) => setDesbloqueado(e.target.checked)}
                className="h-4 w-4 rounded border-amber-400 text-amber-700"
              />
              Corregir de todos modos
            </label>
          </div>
        )}

        {/* ======================= A · Datos base ======================= */}
        <Acordeon
          titulo="A · Datos base y preriego"
          descripcion="De qué turno es, y la primera fase."
          resumen={<Insignia tono={fase.tono}>{fase.etiqueta}</Insignia>}
          abierto={abierta === 'base'}
          onAlternar={() => alternar('base')}
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Campo etiqueta="Temporada" requerido>
              <Selector
                value={entrada.temporadaId}
                onChange={(e) => cambiar({ temporadaId: e.target.value })}
                disabled={cerrado}
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

            <Campo etiqueta="Turno de riego" requerido ayuda="El turno es la unidad con la que se riega.">
              <Selector
                value={entrada.turnoId}
                onChange={(e) => cambiarTurno(e.target.value)}
                disabled={cerrado}
              >
                <option value="">Elige el turno…</option>
                {catalogos.turnos.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.codigo}
                  </option>
                ))}
              </Selector>
            </Campo>

            <Campo etiqueta="Fase" ayuda="Avanza conforme se va capturando.">
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

            <Campo etiqueta="Fecha de preriego">
              <Entrada
                type="date"
                value={entrada.fechaPreriego}
                onChange={(e) => cambiar({ fechaPreriego: e.target.value })}
                disabled={cerrado}
              />
            </Campo>

            <Campo etiqueta="Hora de inicio">
              <Entrada
                type="time"
                value={entrada.horaInicioPreriego}
                onChange={(e) => cambiar({ horaInicioPreriego: e.target.value })}
                disabled={cerrado}
              />
            </Campo>

            <Campo etiqueta="Hora de fin">
              <Entrada
                type="time"
                value={entrada.horaFinPreriego}
                onChange={(e) => cambiar({ horaFinPreriego: e.target.value })}
                disabled={cerrado}
              />
            </Campo>

            <Campo etiqueta="Observaciones del preriego" className="sm:col-span-2">
              <Entrada
                value={entrada.obsPreriego}
                onChange={(e) => cambiar({ obsPreriego: e.target.value })}
                disabled={cerrado}
              />
            </Campo>
          </div>
        </Acordeon>

        {/* ======================= B · Lecturas ======================== */}
        <Acordeon
          titulo="B · Lecturas de tensiómetro"
          descripcion="Dónde, a qué profundidad y cuánto marcó."
          resumen={`${lecturas.filter((l) => l.lectura.trim() !== '').length} lecturas`}
          abierto={abierta === 'lecturas'}
          onAlternar={() => alternar('lecturas')}
        >
          <div className="flex flex-col gap-2">
            {lecturas.length === 0 && (
              <p className="py-2 text-center text-xs text-slate-400">
                Todavía no hay lecturas. Agrega la primera.
              </p>
            )}
            {lecturas.map((l, i) => (
              <div key={i} className="rounded-xl bg-slate-50 p-2.5 ring-1 ring-inset ring-slate-200">
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_6rem_6rem_6rem_2.5rem] sm:items-start">
                  <Entrada
                    value={l.punto}
                    onChange={(e) => cambiarLectura(i, { punto: e.target.value })}
                    placeholder="Punto (lote, cabezal…)"
                    disabled={cerrado}
                    className="w-full min-w-0"
                  />
                  <Entrada
                    inputMode="decimal"
                    value={l.profundidad}
                    onChange={(e) => cambiarLectura(i, { profundidad: e.target.value })}
                    placeholder="Prof. cm"
                    disabled={cerrado}
                    className="w-full min-w-0"
                  />
                  <Entrada
                    inputMode="decimal"
                    value={l.lectura}
                    onChange={(e) => cambiarLectura(i, { lectura: e.target.value })}
                    placeholder="cbar"
                    disabled={cerrado}
                    className="w-full min-w-0"
                  />
                  <Entrada
                    type="time"
                    value={l.hora}
                    onChange={(e) => cambiarLectura(i, { hora: e.target.value })}
                    disabled={cerrado}
                    className="w-full min-w-0"
                  />
                  <button
                    type="button"
                    aria-label={`Eliminar lectura ${i + 1}`}
                    onClick={() => onCambiarLecturas(lecturas.filter((_, j) => j !== i))}
                    disabled={cerrado}
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
                  disabled={cerrado}
                  className="mt-2 w-full"
                />
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={() => onCambiarLecturas([...lecturas, { ...LECTURA_VACIA }])}
            disabled={cerrado}
            className="mt-2 flex items-center gap-1.5 rounded-lg px-1 py-1.5 text-sm font-semibold text-brand-700 transition-colors hover:text-brand-800 disabled:opacity-40"
          >
            <IconPlus className="h-4 w-4" />
            Agregar lectura
          </button>
        </Acordeon>

        {/* ====================== C · Aplicación ======================= */}
        <Acordeon
          titulo="C · Aplicación"
          descripcion="Tiempos, conductividad, calibración y el químico."
          resumen={quimico > 0 ? `L ${n2(quimico)}` : null}
          abierto={abierta === 'aplicacion'}
          onAlternar={() => alternar('aplicacion')}
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Campo etiqueta="Fecha de aplicación">
              <Entrada
                type="date"
                value={entrada.fechaAplicacion}
                onChange={(e) => cambiar({ fechaAplicacion: e.target.value })}
                disabled={cerrado}
              />
            </Campo>

            <Campo etiqueta="Estación de riego">
              <Selector
                value={entrada.estacionRiegoId}
                onChange={(e) => cambiar({ estacionRiegoId: e.target.value })}
                disabled={cerrado}
              >
                <option value="">Sin estación</option>
                {catalogos.estaciones.map((x) => (
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
                disabled={cerrado}
                placeholder="0.00"
              />
            </Campo>

            <Campo etiqueta="Horas de lavado">
              <Entrada
                inputMode="decimal"
                value={entrada.horasLavado}
                onChange={(e) => cambiar({ horasLavado: e.target.value })}
                disabled={cerrado}
                placeholder="0.00"
              />
            </Campo>

            <Campo etiqueta="Inicio de inyección">
              <Entrada
                type="time"
                value={entrada.horaInicioIny}
                onChange={(e) => cambiar({ horaInicioIny: e.target.value })}
                disabled={cerrado}
              />
            </Campo>

            <Campo etiqueta="Fin de inyección">
              <Entrada
                type="time"
                value={entrada.horaFinIny}
                onChange={(e) => cambiar({ horaFinIny: e.target.value })}
                disabled={cerrado}
              />
            </Campo>

            <Campo
              etiqueta="Total de horas de riego"
              // Se SUGIERE, no se impone: hay turnos en que el riego sigue
              // después de lavar, y sobrescribir lo que escribieron sería
              // cambiarles el dato sin decirlo.
              ayuda={
                sugeridas !== null
                  ? `Presurización + inyección + lavado dan ${n2(sugeridas)} h.`
                  : undefined
              }
            >
              <Entrada
                inputMode="decimal"
                value={entrada.totalHorasRiego}
                onChange={(e) => cambiar({ totalHorasRiego: e.target.value })}
                disabled={cerrado}
                placeholder="0.00"
              />
            </Campo>

            <Campo etiqueta="ppm" ayuda="A mano: la fórmula depende del caudal, que todavía no se captura.">
              <Entrada
                inputMode="decimal"
                value={entrada.ppm}
                onChange={(e) => cambiar({ ppm: e.target.value })}
                disabled={cerrado}
              />
            </Campo>

            <Campo etiqueta="CE antes">
              <Entrada
                inputMode="decimal"
                value={entrada.ceAntes}
                onChange={(e) => cambiar({ ceAntes: e.target.value })}
                disabled={cerrado}
              />
            </Campo>
            <Campo etiqueta="CE durante">
              <Entrada
                inputMode="decimal"
                value={entrada.ceDurante}
                onChange={(e) => cambiar({ ceDurante: e.target.value })}
                disabled={cerrado}
              />
            </Campo>
            <Campo etiqueta="CE después">
              <Entrada
                inputMode="decimal"
                value={entrada.ceDespues}
                onChange={(e) => cambiar({ ceDespues: e.target.value })}
                disabled={cerrado}
              />
            </Campo>

            <Campo etiqueta="Calibración entrada">
              <Entrada
                inputMode="decimal"
                value={entrada.calibracionEntrada}
                onChange={(e) => cambiar({ calibracionEntrada: e.target.value })}
                disabled={cerrado}
              />
            </Campo>
            <Campo etiqueta="Calibración salida">
              <Entrada
                inputMode="decimal"
                value={entrada.calibracionSalida}
                onChange={(e) => cambiar({ calibracionSalida: e.target.value })}
                disabled={cerrado}
              />
            </Campo>
            <Campo etiqueta="Calibración campo">
              <Entrada
                inputMode="decimal"
                value={entrada.calibracionCampo}
                onChange={(e) => cambiar({ calibracionCampo: e.target.value })}
                disabled={cerrado}
              />
            </Campo>

            <Campo etiqueta="Producto (ácido)" className="sm:col-span-2">
              <Selector
                value={entrada.productoId}
                onChange={(e) => cambiar({ productoId: e.target.value })}
                disabled={cerrado}
              >
                <option value="">Sin producto</option>
                {catalogos.materiales.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.codigo}
                    {m.descripcion ? ` · ${m.descripcion}` : ''}
                  </option>
                ))}
              </Selector>
            </Campo>

            <Campo etiqueta="Litros de ácido">
              <Entrada
                inputMode="decimal"
                value={entrada.litrosAcido}
                onChange={(e) => cambiar({ litrosAcido: e.target.value })}
                disabled={cerrado}
                placeholder="0.00"
              />
            </Campo>

            <Campo etiqueta="Costo por litro">
              <Entrada
                inputMode="decimal"
                value={entrada.costoLitroAcido}
                onChange={(e) => cambiar({ costoLitroAcido: e.target.value })}
                disabled={cerrado}
                placeholder="0.0000"
              />
            </Campo>
          </div>

          <div className="mt-3 rounded-xl bg-slate-50 px-3.5 py-3 ring-1 ring-inset ring-slate-200">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              Costo del químico
            </p>
            <p className="mt-0.5 text-sm font-bold tabular-nums text-slate-900">L {n2(quimico)}</p>
            <p className="mt-1 text-[11px] text-slate-400">
              Lo calcula la base. Se reparte entre los lotes de este turno, por manzanas.
            </p>
          </div>
        </Acordeon>

        {/* ================= D · Lotes y cuadrilla ===================== */}
        <Acordeon
          titulo="D · Lotes regados y cuadrilla"
          descripcion="Qué lotes tocó el turno, y quién lo trabajó."
          resumen={`${lotes.filter((l) => l.loteTemporadaId).length} lotes · ${n2(mz)} mz`}
          abierto={abierta === 'detalle'}
          onAlternar={() => alternar('detalle')}
        >
          {/* ------------------------- Lotes ------------------------- */}
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-slate-900">Lotes regados</h3>
              <p className="text-xs text-slate-400">
                Un turno riega varios lotes. El químico y la cuadrilla se reparten entre ellos por
                manzanas.
              </p>
            </div>
            <span className="shrink-0 text-sm font-bold tabular-nums text-brand-700">
              {n2(mz)} mz
            </span>
          </div>

          <div className="mt-2 flex flex-col gap-2">
            {lotes.map((l, i) => (
              <div key={i} className="rounded-xl bg-slate-50 p-2.5 ring-1 ring-inset ring-slate-200">
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_7rem_2.5rem] sm:items-start">
                  <Selector
                    value={l.loteTemporadaId}
                    onChange={(e) => cambiarLote(i, { loteTemporadaId: e.target.value })}
                    disabled={cerrado}
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
                    disabled={cerrado}
                    className="w-full min-w-0"
                  />
                  <button
                    type="button"
                    aria-label={`Eliminar lote ${i + 1}`}
                    onClick={() => onCambiarLotes(lotes.filter((_, j) => j !== i))}
                    disabled={cerrado || lotes.length === 1}
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
            disabled={cerrado}
            className="mt-2 flex items-center gap-1.5 rounded-lg px-1 py-1.5 text-sm font-semibold text-brand-700 transition-colors hover:text-brand-800 disabled:opacity-40"
          >
            <IconPlus className="h-4 w-4" />
            Agregar lote
          </button>

          {/* ------------------------ Personal ----------------------- */}
          <div className="mt-4 flex items-start justify-between gap-3 border-t border-slate-100 pt-3">
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-slate-900">Cuadrilla</h3>
              <p className="text-xs text-slate-400">
                La tarifa sale del puesto y de la fecha del turno. La hora extra se calcula sobre
                base de ocho horas.
              </p>
            </div>
            <span className="shrink-0 text-sm font-bold tabular-nums text-brand-700">
              {manoObra === null ? '—' : `L ${n2(manoObra)}`}
            </span>
          </div>

          <div className="mt-2 flex flex-col gap-2">
            {personal.map((p, i) => {
              const tarifa = tarifaDe(p.puestoId)
              const costo = costoPersonal(p, tarifa)
              return (
                <div key={i} className="rounded-xl bg-slate-50 p-2.5 ring-1 ring-inset ring-slate-200">
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_2.5rem] sm:items-start">
                    <Selector
                      value={p.puestoId}
                      onChange={(e) => cambiarPersona(i, { puestoId: e.target.value })}
                      disabled={cerrado}
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
                      disabled={cerrado}
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
                      disabled={cerrado || personal.length === 1}
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
                        onChange={(e) => cambiarPersona(i, { cantidadPersonas: e.target.value })}
                        disabled={cerrado}
                      />
                    </Campo>
                    <Campo etiqueta="Jornadas">
                      <Entrada
                        inputMode="decimal"
                        value={p.jornadas}
                        onChange={(e) => cambiarPersona(i, { jornadas: e.target.value })}
                        disabled={cerrado}
                      />
                    </Campo>
                    <Campo etiqueta="Horas extras">
                      <Entrada
                        inputMode="decimal"
                        value={p.horasExtras}
                        onChange={(e) => cambiarPersona(i, { horasExtras: e.target.value })}
                        disabled={cerrado}
                      />
                    </Campo>
                    <Campo etiqueta="Jornada">
                      <Selector
                        value={p.jornadaTipo}
                        onChange={(e) =>
                          cambiarPersona(i, { jornadaTipo: e.target.value as JornadaTipo })
                        }
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
            disabled={cerrado}
            className="mt-2 flex items-center gap-1.5 rounded-lg px-1 py-1.5 text-sm font-semibold text-brand-700 transition-colors hover:text-brand-800 disabled:opacity-40"
          >
            <IconPlus className="h-4 w-4" />
            Agregar personal
          </button>
        </Acordeon>

        {/* El resumen del turno, siempre a la vista. */}
        <div className="grid grid-cols-3 gap-2">
          <Resumen etiqueta="Manzanas" valor={n2(mz)} />
          <Resumen etiqueta="Químico" valor={`L ${n2(quimico)}`} />
          <Resumen
            etiqueta="Mano de obra"
            valor={manoObra === null ? '—' : `L ${n2(manoObra)}`}
          />
        </div>

        {nivelDeFase(entrada.estado) >= 2 && aNumeroCero(entrada.totalHorasRiego) === 0 && (
          <Alerta tono="ambar">
            El turno está en Aplicación y no lleva horas de riego anotadas.
          </Alerta>
        )}
      </div>
    </Modal>
  )
}

function Resumen({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <div className="rounded-xl bg-slate-50 px-3 py-2.5 text-center ring-1 ring-inset ring-slate-200">
      <p className="text-sm font-bold tabular-nums text-slate-900">{valor}</p>
      <p className="text-[10px] font-medium text-slate-400">{etiqueta}</p>
    </div>
  )
}
