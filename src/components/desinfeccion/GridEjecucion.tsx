'use client'

/**
 * Pestaña 2 · Ejecución de turnos. La cuadrícula principal del módulo.
 *
 * Una fila es un TURNO completo de un ciclo, con su resumen de lo que
 * cuelga —cuántos lotes, cuántas manzanas, cuánto costó la cuadrilla y
 * cuánto el químico—, que la vista ya trae sumado. El detalle renglón por
 * renglón se abre en el formulario: una celda no puede guardar una lista
 * de lotes ni una de químicos.
 *
 * Aquí vive también la BÚSQUEDA del activador: el formulario pregunta
 * turno y ciclo y esta pantalla, que es la que sabe hablar con la base,
 * trae la ejecución que ya exista con todo lo que cuelga de ella.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alerta, Boton, Insignia } from '@/components/ui/Primitivos'
import { DataGrid } from '@/components/ui/DataGrid'
import { IconPlus } from '@/components/ui/Icons'
import type { ColumnaGrid } from '@/lib/grid/tipos'
import { formatearFecha } from '@/lib/estados'
import { n2 } from '@/lib/trasplante/formato'
import { canExecuteAction, type Reglas } from '@/lib/permisos/clientABAC'
import {
  SECCIONES,
  faseCerrada,
  limpiarLotes,
  limpiarPersonal,
  limpiarProductos,
  seccionLlena,
  type SeccionEjecucion,
} from '@/lib/desinfeccion/calculo'
import {
  buscarEjecucion,
  cambiarFase,
  editarCampoEjecucion,
  eliminarEjecuciones,
  guardarEjecucion,
  leerDetalle,
  leerEjecuciones,
  leerLotes,
  salarioMinimo,
  siembrasDeLotes,
} from '@/lib/desinfeccion/repositorioCliente'
import { hoyIso } from '@/lib/fechas'
import {
  CAUDAL_POR_OMISION,
  CICLOS,
  EJECUCION_VACIA,
  PUESTOS_CUADRILLA,
  PUESTO_OTRO,
  FASES,
  LINEA_LOTE_VACIA,
  LINEA_PRODUCTO_VACIA,
  etiquetaFase,
  lecturasPorOmision,
  type CatalogosDesinfeccion,
  type EntradaEjecucion,
  type FilaEjecucion,
  type LecturaTensiometro,
  type LineaLote,
  type LineaPersonal,
  type LineaProducto,
  type LoteDesinfeccion,
} from '@/lib/desinfeccion/tipos'
import { EjecucionModal } from './EjecucionModal'

/** `time` de Postgres llega como HH:MM:SS; el input quiere HH:MM. */
const t = (v: string | null | undefined) => (v ?? '').slice(0, 5)

export function GridEjecucion({
  temporadaId,
  catalogos,
  lotes,
  turnos,
  estaciones,
  reglas,
  usuarioId,
  zonas,
  onSinMigracion,
  onJornalCreado,
}: {
  temporadaId: string
  catalogos: CatalogosDesinfeccion
  /** Ya recortados por zona por la pestaña. */
  lotes: LoteDesinfeccion[]
  turnos: CatalogosDesinfeccion['turnos']
  estaciones: CatalogosDesinfeccion['estaciones']
  reglas: Reglas
  usuarioId: string | null
  zonas: Set<string>
  onSinMigracion: (falta: boolean) => void
  /** Un jornal creado desde el selector: hay que recargar el catálogo. */
  onJornalCreado: () => void
}) {
  const [filas, setFilas] = useState<FilaEjecucion[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [buscando, setBuscando] = useState(false)

  const [entrada, setEntrada] = useState<EntradaEjecucion | null>(null)
  const [lecturas, setLecturas] = useState<LecturaTensiometro[]>([])
  const [lineasLote, setLineasLote] = useState<LineaLote[]>([{ ...LINEA_LOTE_VACIA }])
  const [lineasPersonal, setLineasPersonal] = useState<LineaPersonal[]>([])
  /**
   * Qué secciones venían LLENAS al cargar.
   *
   * Es lo único que bloquea el acordeón. Antes el candado miraba el
   * estado vivo y la sección se cerraba sola a media captura, con el
   * dedo todavía en el teclado; ésta es la foto del momento de abrir.
   */
  const [seccionesGuardadas, setSeccionesGuardadas] = useState<SeccionEjecucion[]>([])
  const [lineasProducto, setLineasProducto] = useState<LineaProducto[]>([
    { ...LINEA_PRODUCTO_VACIA },
  ])
  /** Las siembras de los lotes del turno, para el DDT de las tres fases. */
  const [fechasSiembra, setFechasSiembra] = useState<string[]>([])
  /**
   * Si alguna de esas fechas es del PLAN y no de una siembra capturada.
   *
   * La desinfección se aplica ~70 días antes de trasplantar, así que lo
   * normal es que TODAS lo sean. Hay que decirlo en la pantalla: un plan
   * y un hecho no se leen igual, y el plan todavía se puede mover.
   */
  const [siembraPrevista, setSiembraPrevista] = useState(false)
  /**
   * Los lotes con sus manzanas, recalculados para el turno abierto.
   *
   * Se vuelven a pedir con el identificador de la ejecución para que lo
   * suyo no cuente como ya gastado: sin eso, corregir 9.99 a 10.00
   * parecería que al lote no le queda nada.
   */
  const [lotesTurno, setLotesTurno] = useState<LoteDesinfeccion[]>(lotes)

  const ctx = useMemo(() => ({ usuarioId, zonas }), [usuarioId, zonas])
  const puedeCrear = canExecuteAction(reglas, 'desinfeccion', 'crear')
  const puedeEditar = canExecuteAction(reglas, 'desinfeccion', 'editar')
  const puedeEliminar = canExecuteAction(reglas, 'desinfeccion', 'eliminar')

  const puedeEditarFila = useCallback(
    (f: FilaEjecucion) =>
      canExecuteAction(
        reglas,
        'desinfeccion',
        'editar',
        { duenoId: f.usuario_id, zonaId: f.zona_id },
        ctx
      ),
    [reglas, ctx]
  )
  const puedeEliminarFila = useCallback(
    (f: FilaEjecucion) =>
      canExecuteAction(
        reglas,
        'desinfeccion',
        'eliminar',
        { duenoId: f.usuario_id, zonaId: f.zona_id },
        ctx
      ),
    [reglas, ctx]
  )

  /** Editar EN LA CELDA pide las dos cosas: permiso y fase abierta. */
  const celdaEditable = useCallback(
    (f: FilaEjecucion) => puedeEditarFila(f) && !faseCerrada(f.estado),
    [puedeEditarFila]
  )

  const recargar = useCallback(async () => {
    setCargando(true)
    const { datos, error: e } = await leerEjecuciones(temporadaId || null)
    setCargando(false)
    if (e) {
      onSinMigracion(true)
      setFilas([])
      return
    }
    setFilas(datos)
  }, [temporadaId, onSinMigracion])

  useEffect(() => {
    let vivo = true
    async function cargar() {
      setCargando(true)
      const { datos, error: e } = await leerEjecuciones(temporadaId || null)
      if (!vivo) return
      setCargando(false)
      if (e) {
        onSinMigracion(true)
        setFilas([])
        return
      }
      onSinMigracion(false)
      setFilas(datos)
    }
    void cargar()
    return () => {
      vivo = false
    }
  }, [temporadaId, onSinMigracion])

  /* ------------------------------ Columnas ----------------------------- */

  const columnas = useMemo<ColumnaGrid<FilaEjecucion>[]>(
    () => [
      {
        campo: 'turno_codigo',
        label: 'Turno',
        tipo: 'seleccion',
        ancho: '9rem',
        valor: (f) => f.turno_codigo ?? f.turno_nombre,
        render: (f) => (
          <span className="font-mono text-xs font-bold text-slate-900">
            {f.turno_codigo ?? f.turno_nombre ?? '—'}
          </span>
        ),
      },
      {
        campo: 'ciclo',
        label: 'Ciclo',
        tipo: 'seleccion',
        numero: true,
        valor: (f) => f.ciclo,
        etiqueta: (f) => `Ciclo ${f.ciclo}`,
        editable: celdaEditable,
        editor: 'seleccion',
        valorEdicion: (f) => String(f.ciclo),
        opciones: CICLOS.map((c) => ({ value: String(c), label: `Ciclo ${c}` })),
      },
      { campo: 'zona_nombre', label: 'Zona', tipo: 'seleccion', valor: (f) => f.zona_nombre },
      {
        campo: 'estado',
        label: 'Fase',
        tipo: 'seleccion',
        ancho: '9rem',
        valor: (f) => f.estado,
        etiqueta: (f) => etiquetaFase(f.estado).etiqueta,
        // La fase SÍ se cambia en la celda aunque el turno esté cerrado:
        // es justamente la forma de devolverlo atrás para corregirlo.
        editable: puedeEditarFila,
        editor: 'seleccion',
        valorEdicion: (f) => f.estado,
        opciones: FASES.map((x) => ({ value: x.valor, label: x.etiqueta })),
        render: (f) => (
          <Insignia tono={etiquetaFase(f.estado).tono}>{etiquetaFase(f.estado).etiqueta}</Insignia>
        ),
      },
      {
        campo: 'fecha_preriego',
        label: 'Preriego',
        tipo: 'fecha',
        ancho: '9rem',
        valor: (f) => f.fecha_preriego,
        etiqueta: (f) => (f.fecha_preriego ? formatearFecha(f.fecha_preriego) : ''),
        editable: celdaEditable,
        editor: 'fecha',
        valorEdicion: (f) => f.fecha_preriego ?? '',
        render: (f) => (
          <span className="text-xs">
            {f.fecha_preriego ? formatearFecha(f.fecha_preriego) : '—'}
            {f.horas_preriego !== null && Number(f.horas_preriego) > 0 && (
              <span className="ml-1 text-slate-400">{n2(f.horas_preriego)} h</span>
            )}
          </span>
        ),
      },
      {
        campo: 'fecha_lecturas',
        label: 'Lecturas',
        tipo: 'fecha',
        ancho: '9rem',
        valor: (f) => f.fecha_lecturas,
        etiqueta: (f) => (f.fecha_lecturas ? formatearFecha(f.fecha_lecturas) : ''),
        editable: celdaEditable,
        editor: 'fecha',
        valorEdicion: (f) => f.fecha_lecturas ?? '',
        render: (f) => (
          <span className="text-xs">
            {f.fecha_lecturas ? formatearFecha(f.fecha_lecturas) : '—'}
          </span>
        ),
      },
      {
        campo: 'fecha_aplicacion',
        label: 'Aplicación',
        tipo: 'fecha',
        ancho: '9rem',
        valor: (f) => f.fecha_aplicacion,
        etiqueta: (f) => (f.fecha_aplicacion ? formatearFecha(f.fecha_aplicacion) : ''),
        editable: celdaEditable,
        editor: 'fecha',
        valorEdicion: (f) => f.fecha_aplicacion ?? '',
        render: (f) => (
          <span className="text-xs">
            {f.fecha_aplicacion ? formatearFecha(f.fecha_aplicacion) : '—'}
          </span>
        ),
      },
      {
        campo: 'estacion_riego_nombre',
        label: 'Estación',
        tipo: 'seleccion',
        valor: (f) => f.estacion_riego_nombre,
        editable: celdaEditable,
        editor: 'seleccion',
        valorEdicion: (f) => f.estacion_riego_id ?? '',
        opciones: [
          { value: '', label: 'Sin estación' },
          ...estaciones.map((e) => ({ value: e.id, label: e.nombre })),
        ],
      },
      {
        campo: 'lotes_regados',
        label: 'Lotes',
        tipo: 'numero',
        numero: true,
        valor: (f) => Number(f.lotes_regados),
      },
      {
        campo: 'mz_regadas',
        label: 'Mz regadas',
        tipo: 'numero',
        numero: true,
        valor: (f) => Number(f.mz_regadas),
        etiqueta: (f) => n2(f.mz_regadas),
        render: (f) => <span className="font-bold text-brand-700">{n2(f.mz_regadas)}</span>,
      },
      {
        campo: 'total_horas_riego',
        label: 'Horas riego',
        tipo: 'numero',
        numero: true,
        // Columna generada desde la 60: se mira, no se escribe. Dejarla
        // editable sería ofrecer un campo que la base rechaza siempre.
        valor: (f) => (f.total_horas_riego === null ? null : Number(f.total_horas_riego)),
        etiqueta: (f) => n2(f.total_horas_riego),
      },
      {
        // Las del producto que más pesa del turno. Desde la 65 NO se
        // escriben: la columna manual se retiró y ésta la calcula la
        // base con la misma fórmula que la pantalla.
        campo: 'ppm_principal',
        label: 'ppm',
        tipo: 'numero',
        numero: true,
        valor: (f) => (f.ppm_principal === null ? null : Number(f.ppm_principal)),
        etiqueta: (f) => n2(f.ppm_principal),
      },
      {
        campo: 'ce_antes',
        label: 'CE antes',
        tipo: 'numero',
        numero: true,
        valor: (f) => (f.ce_antes === null ? null : Number(f.ce_antes)),
        etiqueta: (f) => n2(f.ce_antes),
        editable: celdaEditable,
        editor: 'numero',
        valorEdicion: (f) => String(f.ce_antes ?? ''),
      },
      {
        campo: 'ce_durante',
        label: 'CE durante',
        tipo: 'numero',
        numero: true,
        valor: (f) => (f.ce_durante === null ? null : Number(f.ce_durante)),
        etiqueta: (f) => n2(f.ce_durante),
        editable: celdaEditable,
        editor: 'numero',
        valorEdicion: (f) => String(f.ce_durante ?? ''),
      },
      {
        campo: 'ce_despues',
        label: 'CE después',
        tipo: 'numero',
        numero: true,
        valor: (f) => (f.ce_despues === null ? null : Number(f.ce_despues)),
        etiqueta: (f) => n2(f.ce_despues),
        editable: celdaEditable,
        editor: 'numero',
        valorEdicion: (f) => String(f.ce_despues ?? ''),
      },
      {
        campo: 'productos_nombres',
        label: 'Químicos',
        tipo: 'texto',
        ancho: '14rem',
        // Ya no es UN producto: una aplicación lleva los que haga falta,
        // así que la columna enseña cuántos y cuáles.
        valor: (f) => f.productos_nombres,
        render: (f) =>
          f.productos > 0 ? (
            <span className="block max-w-[200px] truncate text-xs" title={f.productos_nombres ?? ''}>
              <strong className="text-slate-900">{f.productos}</strong>{' '}
              <span className="text-slate-400">{f.productos_nombres}</span>
            </span>
          ) : (
            <span className="text-xs text-slate-300">—</span>
          ),
      },
      {
        campo: 'costo_quimico',
        label: 'Costo químico',
        tipo: 'numero',
        numero: true,
        valor: (f) => Number(f.costo_quimico ?? 0),
        etiqueta: (f) => n2(f.costo_quimico),
        render: (f) => (
          <span className="font-bold tabular-nums text-slate-900">{n2(f.costo_quimico)}</span>
        ),
      },
      {
        campo: 'costo_personal',
        label: 'Mano de obra',
        tipo: 'numero',
        numero: true,
        valor: (f) => Number(f.costo_personal),
        etiqueta: (f) => n2(f.costo_personal),
      },
      {
        campo: 'usuario_nombre',
        label: 'Capturó',
        tipo: 'seleccion',
        valor: (f) => f.usuario_nombre,
        render: (f) => (
          <span className="block max-w-[140px] truncate text-xs text-slate-400">
            {f.usuario_nombre ?? '—'}
          </span>
        ),
      },
    ],
    [estaciones, celdaEditable, puedeEditarFila]
  )

  /* ------------------------- Cargar un turno --------------------------- */

  /** Deja el formulario como está la ejecución que llega (o vacío). */
  const cargarEnFormulario = useCallback(
    async (f: FilaEjecucion | null, base: EntradaEjecucion) => {
      if (!f) {
        setEntrada(base)
        setLecturas(lecturasPorOmision())
        setLineasLote([{ ...LINEA_LOTE_VACIA }])
        // La cuadrilla arranca VACÍA desde la 62. El renglón de fábrica
        // «1 persona» sugería un dato que nadie había escrito, y en la
        // mitad de los turnos —los que se capturan por fases, un día cada
        // una— había que borrarlo antes de guardar.
        setLineasPersonal([])
        setLineasProducto([{ ...LINEA_PRODUCTO_VACIA }])
        // Un turno nuevo no tiene nada guardado: nada se bloquea.
        setSeccionesGuardadas([])
        return
      }

      const { lotes: ls, personal: ps, productos: qs, error: e } = await leerDetalle(f.id)
      if (e) setError(e)

      const cargada: EntradaEjecucion = {
        id: f.id,
        temporadaId: f.temporada_id,
        turnoId: f.turno_id,
        ciclo: String(f.ciclo),
        estado: f.estado,
        fechaPreriego: f.fecha_preriego ?? '',
        horaInicioPreriego: t(f.hora_inicio_preriego),
        horaFinPreriego: t(f.hora_fin_preriego),
        obsPreriego: f.obs_preriego ?? '',
        fechaLecturas: f.fecha_lecturas ?? '',
        fechaAplicacion: f.fecha_aplicacion ?? '',
        estacionRiegoId: f.estacion_riego_id ?? '',
        // El caudal guardado, o el de siempre si la fila es anterior a
        // la 64: un turno viejo no tiene caudal y sin él las ppm no se
        // pueden calcular ni hacia atrás.
        caudalAgua: String(f.caudal_agua ?? CAUDAL_POR_OMISION),
        inicioPresurizacion: t(f.inicio_presurizacion),
        finPresurizacion: t(f.fin_presurizacion),
        horaInicioIny: t(f.hora_inicio_iny),
        horaFinIny: t(f.hora_fin_iny),
        horaInicioLavado: t(f.hora_inicio_lavado),
        horaFinLavado: t(f.hora_fin_lavado),
        ceAntes: String(f.ce_antes ?? ''),
        ceDurante: String(f.ce_durante ?? ''),
        ceDespues: String(f.ce_despues ?? ''),
        calibracionEntrada: String(f.calibracion_entrada ?? ''),
        calibracionSalida: String(f.calibracion_salida ?? ''),
        calibracionCampo: String(f.calibracion_campo ?? ''),
      }
      setEntrada(cargada)

      const leidas = Array.isArray(f.lecturas_tensiometro) ? f.lecturas_tensiometro : []
      const lecturasCargadas = leidas.length > 0 ? leidas : lecturasPorOmision()
      setLecturas(lecturasCargadas)

      const lotesCargados =
        ls.length > 0
          ? ls.map((l) => ({
              id: l.id,
              loteTemporadaId: l.lote_temporada_id,
              mzCubiertas: String(l.mz_cubiertas),
            }))
          : [{ ...LINEA_LOTE_VACIA }]
      setLineasLote(lotesCargados)

      // Una fase sin cuadrilla guardada abre VACÍA desde la 62: el
      // renglón de fábrica parecía un dato y había que borrarlo.
      const porFase = (fase: '1_Preriego' | '3_Aplicacion') => {
        const suyas = ps.filter((p) => p.fase === fase)
        return suyas.map((p) => ({
          id: p.id,
          fase: p.fase,
          operadorId: p.operador_id ?? '',
          cantidadPersonas: String(p.cantidad_personas),
          salario: String(p.salario_base_manual ?? p.tarifa_dia ?? ''),
          horasExtras: String(p.horas_extras),
          jornadaTipo: p.jornada_tipo,
          puesto: PUESTOS_CUADRILLA.includes(
            (p.puesto_texto ?? '') as (typeof PUESTOS_CUADRILLA)[number]
          )
            ? (p.puesto_texto as string)
            : PUESTO_OTRO,
          puestoOtro: PUESTOS_CUADRILLA.includes(
            (p.puesto_texto ?? '') as (typeof PUESTOS_CUADRILLA)[number]
          )
            ? ''
            : (p.puesto_texto ?? ''),
        }))
      }
      setLineasPersonal([...porFase('1_Preriego'), ...porFase('3_Aplicacion')])

      setLineasProducto(
        qs.length > 0
          ? qs.map((q) => ({
              id: q.id,
              productoId: q.producto_id,
              totalLitros: String(q.total_litros),
              costoLitro: String(q.costo_litro),
              cantidadEnvases: String(q.cantidad_envases ?? ''),
              tipoEnvase: q.tipo_envase ?? '',
            }))
          : [{ ...LINEA_PRODUCTO_VACIA }]
      )

      // La foto del candado se toma AQUÍ, con lo que acaba de llegar de
      // la base, y no se vuelve a mirar mientras se escribe.
      setSeccionesGuardadas(
        SECCIONES.filter((sec) => seccionLlena(sec, cargada, lotesCargados, lecturasCargadas))
      )
    },
    []
  )

  /**
   * El activador: turno + ciclo.
   *
   * Busca si ese turno ya tiene ejecución en ese ciclo y, si la tiene, la
   * carga entera. Es lo que impide que capturar el preriego el lunes y la
   * aplicación el jueves acabe en dos turnos distintos.
   */
  async function activar(turnoId: string, ciclo: string) {
    const base: EntradaEjecucion = {
      ...EJECUCION_VACIA,
      ...(entrada ?? {}),
      id: '',
      temporadaId: entrada?.temporadaId || temporadaId,
      turnoId,
      ciclo,
    }
    if (!turnoId || !base.temporadaId) {
      setEntrada(base)
      return
    }

    setBuscando(true)
    const { fila, error: e } = await buscarEjecucion(base.temporadaId, turnoId, Number(ciclo) || 1)
    if (e) setError(e)
    await cargarEnFormulario(fila, { ...EJECUCION_VACIA, temporadaId: base.temporadaId, turnoId, ciclo })
    setBuscando(false)
  }

  /* ---------------- Las siembras, para el DDT de cada fase -------------- */
  // Se piden TODAS las del turno y se pasan enteras: un turno riega varios
  // lotes y pueden no haberse sembrado el mismo día, así que quedarse con
  // una sola sería enseñar un número que no vale para los demás lotes. Con
  // todas, la pantalla puede decir un rango.
  const ejecucionAbierta = entrada?.id ?? ''
  useEffect(() => {
    let vivo = true
    async function cargar() {
      if (!temporadaId) {
        setLotesTurno(lotes)
        return
      }
      const datos = await leerLotes(temporadaId, ejecucionAbierta || null)
      if (vivo) setLotesTurno(datos.length > 0 ? datos : lotes)
    }
    void cargar()
    return () => {
      vivo = false
    }
  }, [temporadaId, ejecucionAbierta, lotes])

  const lotesDelTurno = useMemo(
    () => lineasLote.map((l) => l.loteTemporadaId).filter(Boolean).sort().join(','),
    [lineasLote]
  )
  const cicloActual = entrada?.ciclo ?? ''

  useEffect(() => {
    let vivo = true
    async function cargar() {
      const ids = lotesDelTurno ? lotesDelTurno.split(',') : []
      if (ids.length === 0) {
        setFechasSiembra([])
        setSiembraPrevista(false)
        return
      }
      const mapa = await siembrasDeLotes(ids, Number(cicloActual) || null)
      if (!vivo) return
      const datos = [...mapa.values()]
      setFechasSiembra(datos.map((v) => v.fecha).sort())
      setSiembraPrevista(datos.some((v) => v.origen === 'plan'))
    }
    void cargar()
    return () => {
      vivo = false
    }
  }, [lotesDelTurno, cicloActual])

  /* ------------------------- El salario mínimo ------------------------- */
  /**
   * Vive AQUÍ y no en el formulario porque hacen falta dos cosas con él y
   * sólo una es de pantalla: el formulario lo ESCRIBE en cada renglón de
   * cuadrilla nuevo, y el guardado tiene que saber con qué valor se
   * escribió para distinguir un renglón intacto de uno tocado. Con el
   * número en dos sitios, un día dirían cosas distintas y se guardarían
   * renglones que nadie llenó.
   *
   * Se pide por la fecha de la fase: una jornada de marzo se paga con el
   * mínimo de marzo aunque se capture en mayo.
   */
  const fechaSalario = entrada?.fechaAplicacion || entrada?.fechaPreriego || hoyIso()
  const [minimo, setMinimo] = useState<number | null>(null)

  useEffect(() => {
    let vivo = true
    async function cargar() {
      const v = await salarioMinimo(fechaSalario)
      if (vivo) setMinimo(v)
    }
    void cargar()
    return () => {
      vivo = false
    }
  }, [fechaSalario])

  const salarioPorOmision = minimo === null ? '' : String(minimo)

  /* ------------------------------ Acciones ----------------------------- */

  function nuevo() {
    setEntrada({ ...EJECUCION_VACIA, temporadaId })
    setLecturas(lecturasPorOmision())
    setLineasLote([{ ...LINEA_LOTE_VACIA }])
    setLineasPersonal([])
    setLineasProducto([{ ...LINEA_PRODUCTO_VACIA }])
    setSeccionesGuardadas([])
  }

  async function editar(f: FilaEjecucion) {
    setOcupado(true)
    await cargarEnFormulario(f, { ...EJECUCION_VACIA, temporadaId })
    setOcupado(false)
  }

  async function guardar() {
    if (!entrada) return
    setOcupado(true)
    // Los renglones que nadie tocó no viajan: son el hueco donde escribir,
    // no un dato. Es la MISMA regla con la que valida `validarEjecucion`,
    // para que no pueda pasar que una fila bloquee el guardado y otra
    // distinta llegue a la base.
    const r = await guardarEjecucion(
      entrada,
      lecturas,
      limpiarLotes(lineasLote),
      limpiarPersonal(lineasPersonal, salarioPorOmision),
      limpiarProductos(lineasProducto)
    )
    setOcupado(false)
    if (!r.ok) return setError(r.mensaje)
    setEntrada(null)
    setError(null)
    setAviso(r.mensaje)
    await recargar()
  }

  async function editarCelda(fila: FilaEjecucion, campo: string, valor: unknown) {
    setError(null)
    const r = await editarCampoEjecucion(fila.id, campo, valor)
    if (!r.ok) setError(r.mensaje)
    await recargar()
  }

  async function moverFase(ids: string[], estado: string, limpiar: () => void) {
    setOcupado(true)
    const r = await cambiarFase(ids, estado)
    setOcupado(false)
    if (!r.ok) return setError(r.mensaje)
    limpiar()
    setError(null)
    setAviso(r.mensaje)
    await recargar()
  }

  async function eliminar(ids: string[], limpiar: () => void) {
    if (
      !window.confirm(
        `¿Eliminar ${ids.length} ejecución(es)? Se van con ellas sus lotes, sus químicos y su cuadrilla.`
      )
    ) {
      return
    }
    setOcupado(true)
    const r = await eliminarEjecuciones(ids)
    setOcupado(false)
    if (!r.ok) return setError(r.mensaje)
    limpiar()
    setError(null)
    setAviso(r.mensaje)
    await recargar()
  }

  /* -------------------------------- Vista ------------------------------ */

  return (
    <div className="flex flex-col gap-3">
      {error && <Alerta>{error}</Alerta>}
      {aviso && <Alerta tono="azul">{aviso}</Alerta>}

      <DataGrid<FilaEjecucion>
        filas={filas}
        cargando={cargando}
        columnas={columnas}
        titulo="Ejecución de turnos"
        nombreArchivo="desinfeccion-ejecucion"
        ordenInicial={{ campo: 'fecha_aplicacion', direccion: 'desc' }}
        minAncho="2300px"
        seleccionable={puedeEditar || puedeEliminar}
        puedeEditarCelda={puedeEditar}
        onEditarCelda={editarCelda}
        puedeExportar={canExecuteAction(reglas, 'desinfeccion', 'exportar')}
        vacio={{
          titulo: 'Sin turnos ejecutados',
          descripcion: 'Registra el primero: elige turno y ciclo, y el formulario abre el que haya.',
        }}
        resumen={(visibles) => (
          <span className="text-xs text-slate-500">
            <strong className="text-slate-900">
              {n2(visibles.reduce((a, f) => a + Number(f.mz_regadas), 0))}
            </strong>{' '}
            mz regadas · químico L{' '}
            <strong className="text-slate-900">
              {n2(visibles.reduce((a, f) => a + Number(f.costo_quimico ?? 0), 0))}
            </strong>{' '}
            · mano de obra L{' '}
            <strong className="text-slate-900">
              {n2(visibles.reduce((a, f) => a + Number(f.costo_personal), 0))}
            </strong>
          </span>
        )}
        acciones={
          puedeCrear ? (
            <Boton onClick={nuevo}>
              <IconPlus className="h-4 w-4" />
              Nueva ejecución
            </Boton>
          ) : null
        }
        accionFila={(f) =>
          puedeEditarFila(f) ? (
            <Boton variante="secundario" disabled={ocupado} onClick={() => void editar(f)}>
              Editar
            </Boton>
          ) : null
        }
        accionesSeleccion={(marcadas, limpiar) => {
          const editables = marcadas.filter((id) =>
            filas.some((f) => f.id === id && puedeEditarFila(f))
          )
          const borrables = marcadas.filter((id) =>
            filas.some((f) => f.id === id && puedeEliminarFila(f))
          )
          return (
            <>
              {puedeEditar &&
                FASES.map((x) => (
                  <Boton
                    key={x.valor}
                    variante="secundario"
                    disabled={ocupado || editables.length === 0}
                    onClick={() => void moverFase(editables, x.valor, limpiar)}
                  >
                    {x.etiqueta}
                  </Boton>
                ))}
              {puedeEliminar && (
                <Boton
                  variante="secundario"
                  disabled={ocupado || borrables.length === 0}
                  onClick={() => void eliminar(borrables, limpiar)}
                >
                  Eliminar {borrables.length}
                </Boton>
              )}
            </>
          )
        }}
      />

      {entrada && (
        <EjecucionModal
          entrada={entrada}
          lecturas={lecturas}
          lotes={lineasLote}
          personal={lineasPersonal}
          productos={lineasProducto}
          catalogos={catalogos}
          lotesDisponibles={lotesTurno}
          turnosDisponibles={turnos}
          estacionesDisponibles={estaciones}
          fechasSiembra={fechasSiembra}
          siembraPrevista={siembraPrevista}
          seccionesGuardadas={seccionesGuardadas}
          minimo={minimo}
          guardando={ocupado}
          buscando={buscando}
          onActivar={(turnoId, ciclo) => void activar(turnoId, ciclo)}
          onCambiarEntrada={setEntrada}
          onCambiarLecturas={setLecturas}
          onCambiarLotes={setLineasLote}
          onCambiarPersonal={setLineasPersonal}
          onCambiarProductos={setLineasProducto}
          onJornalCreado={onJornalCreado}
          onGuardar={() => void guardar()}
          onCerrar={() => {
            setEntrada(null)
            setError(null)
          }}
        />
      )}
    </div>
  )
}
