'use client'

/**
 * Turnos de riego: la cuadrícula.
 *
 * Una fila es un LOTE de un turno, con su cabecera repetida. Se eligió
 * así y no «una fila por turno con los lotes dentro» porque es como se
 * lee el Excel de campo y como se filtra de verdad: «qué se riega en el
 * lote 1001-040» es la pregunta, y con los lotes escondidos habría que
 * abrir turno por turno para contestarla.
 *
 * Sólo pantalla. Las reglas están en `lib/riego/validacion` y la
 * persistencia en `lib/riego/repositorioCliente`.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alerta, Boton, Campo, Esqueleto, Insignia, Selector, Tarjeta } from '@/components/ui/Primitivos'
import { DataGrid } from '@/components/ui/DataGrid'
import { PanelFiltros } from '@/components/ui/PanelFiltros'
import { SelectorMultiple } from '@/components/ui/SelectorMultiple'
import { IconPlus } from '@/components/ui/Icons'
import type { ColumnaGrid } from '@/lib/grid/tipos'
import { formatearFecha } from '@/lib/estados'
import { TurnoRiegoModal } from './TurnoRiegoModal'
import { ImportarTurnos } from './ImportarTurnos'
import {
  AVISO_SIN_MIGRACION,
  actualizarTurnos,
  editarCampo,
  eliminarLineas,
  leerLotesRegables,
  faltaMigracion,
  guardarTurno,
  leerTurnos,
} from '@/lib/riego/repositorioCliente'
import {
  CICLOS_RIEGO,
  campoGuardado,
  ESTADOS_TURNO,
  FUENTES_AGUA,
  LINEA_VACIA,
  TURNO_VACIO,
  type CatalogosRiego,
  type EntradaTurno,
  type EstadoTurno,
  type FilaTurnoRiego,
  type LineaTurno,
  type LoteRegable,
} from '@/lib/riego/tipos'

type Fila = FilaTurnoRiego & { id: string }

const VACIOS = { zonas: [] as string[], turnos: [] as string[], estados: [] as string[], planes: [] as string[] }

const n2 = (v: number | null | undefined) =>
  v === null || v === undefined ? '' : Number(v).toFixed(2)

const distintos = (valores: (string | null | undefined)[]) =>
  [...new Set(valores.filter((v): v is string => Boolean(v)))]
    .sort((a, b) => a.localeCompare(b, 'es', { numeric: true }))
    .map((v) => ({ valor: v, etiqueta: v }))

const etiquetaEstado = (e: EstadoTurno) =>
  ESTADOS_TURNO.find((x) => x.valor === e) ?? ESTADOS_TURNO[0]

export function ControlTurnosRiego({
  catalogos,
  puedeCrear,
  puedeEditar,
  puedeEliminar,
}: {
  catalogos: CatalogosRiego
  puedeCrear: boolean
  puedeEditar: boolean
  puedeEliminar: boolean
}) {
  const [filas, setFilas] = useState<Fila[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [sinMigracion, setSinMigracion] = useState(false)
  const [ocupado, setOcupado] = useState(false)
  const [importando, setImportando] = useState(false)

  const [entrada, setEntrada] = useState<EntradaTurno | null>(null)
  const [lineas, setLineas] = useState<LineaTurno[]>([{ ...LINEA_VACIA }])

  // El riego se organiza por CICLO DE CULTIVO, no por mes: un turno con
  // fecha de siembra en enero se programa en septiembre. Por eso aquí no
  // hay «Desde – Hasta»: un rango sobre la fecha de siembra escondía
  // justo lo que se acababa de capturar. Manda la temporada.
  const temporadaActiva = catalogos.temporadas.find((t) => t.activa)?.id ?? ''
  const [temporadaId, setTemporadaId] = useState(temporadaActiva)
  const [ciclo, setCiclo] = useState('')
  const [externos, setExternos] = useState(VACIOS)
  // Los lotes con su saldo, para el desplegable de la columna. Se piden
  // aparte de las filas porque el saldo depende del plan de siembra, no
  // de lo que haya en pantalla.
  const [lotes, setLotes] = useState<LoteRegable[]>([])

  const recargar = useCallback(async () => {
    const { datos, error: e } = await leerTurnos(temporadaId || null, ciclo ? Number(ciclo) : null)
    if (e) {
      setSinMigracion(faltaMigracion(e))
      setError(faltaMigracion(e) ? null : e)
      setFilas([])
      return
    }
    setSinMigracion(false)
    setError(null)
    setFilas(datos.map((d) => ({ ...d, id: d.detalle_id })))
  }, [temporadaId, ciclo])

  useEffect(() => {
    // La consulta va DENTRO del efecto y el estado se toca después del
    // await: llamarlo en seco es el error `set-state-in-effect` de React
    // 19. `vivo` evita escribir en un componente ya desmontado cuando el
    // usuario cambia de filtro antes de que conteste la primera consulta.
    let vivo = true
    async function cargar() {
      const { datos, error: e } = await leerTurnos(temporadaId || null, ciclo ? Number(ciclo) : null)
      if (!vivo) return
      if (e) {
        setSinMigracion(faltaMigracion(e))
        setError(faltaMigracion(e) ? null : e)
        setFilas([])
        return
      }
      setSinMigracion(false)
      setError(null)
      setFilas(datos.map((d) => ({ ...d, id: d.detalle_id })))
    }
    void cargar()
    return () => {
      vivo = false
    }
  }, [temporadaId, ciclo])

  useEffect(() => {
    let vivo = true
    async function cargar() {
      if (!temporadaId) {
        setLotes([])
        return
      }
      const { datos } = await leerLotesRegables(temporadaId, null, null)
      if (vivo) setLotes(datos)
    }
    void cargar()
    return () => {
      vivo = false
    }
  }, [temporadaId])

  /* ------------------------------ Filtros ------------------------------ */

  const opciones = useMemo(() => {
    const f = filas ?? []
    return {
      zonas: distintos(f.map((x) => x.zona)),
      turnos: distintos(f.map((x) => x.turno)),
      planes: distintos(f.map((x) => x.plan_nutricional)),
      estados: ESTADOS_TURNO.map((e) => ({ valor: e.valor, etiqueta: e.etiqueta })),
    }
  }, [filas])

  const lista = useMemo(() => {
    const f = filas ?? []
    const z = new Set(externos.zonas)
    const t = new Set(externos.turnos)
    const e = new Set(externos.estados)
    const p = new Set(externos.planes)
    return f.filter((x) => {
      if (z.size && !z.has(x.zona)) return false
      if (t.size && !t.has(x.turno)) return false
      if (e.size && !e.has(x.estado)) return false
      if (p.size && !p.has(x.plan_nutricional ?? '')) return false
      return true
    })
  }, [filas, externos])

  const activos =
    (externos.zonas.length ? 1 : 0) +
    (externos.turnos.length ? 1 : 0) +
    (externos.estados.length ? 1 : 0) +
    (externos.planes.length ? 1 : 0)

  const resumen = useMemo(() => {
    const turnos = new Set(lista.map((f) => f.turno_id))
    return {
      turnos: turnos.size,
      lotes: lista.length,
      mz: Math.round(lista.reduce((a, f) => a + Number(f.area_turno ?? 0), 0) * 100) / 100,
      sinOrden: new Set(lista.filter((f) => !f.orden_sap).map((f) => f.turno_id)).size,
    }
  }, [lista])

  /* ------------------------------ Columnas ----------------------------- */

  const columnas = useMemo<ColumnaGrid<Fila>[]>(
    () => [
      { campo: 'temporada_nombre', label: 'Temporada', tipo: 'seleccion', valor: (f) => f.temporada_nombre },
      {
        campo: 'ciclo',
        label: 'Ciclo',
        tipo: 'seleccion',
        valor: (f) => String(f.ciclo),
        etiqueta: (f) => `Ciclo ${f.ciclo}`,
        editable: puedeEditar,
        editor: 'seleccion',
        valorEdicion: (f) => String(f.ciclo),
        opciones: CICLOS_RIEGO.map((c) => ({ value: String(c), label: `Ciclo ${c}` })),
      },
      {
        campo: 'fecha_siembra',
        label: 'Fecha siembra',
        tipo: 'fecha',
        valor: (f) => f.fecha_siembra,
        etiqueta: (f) => formatearFecha(f.fecha_siembra),
        editable: puedeEditar,
        editor: 'fecha',
        valorEdicion: (f) => f.fecha_siembra,
        render: (f) => <span className="text-xs">{formatearFecha(f.fecha_siembra)}</span>,
      },
      {
        campo: 'ut',
        label: 'Ubicación técnica',
        tipo: 'seleccion',
        ancho: '14rem',
        valor: (f) => f.ut,
        editable: puedeEditar,
        editor: 'seleccion',
        valorEdicion: (f) => f.lote_temporada_id,
        opciones: lotes.map((l) => ({
          value: l.lote_temporada_id,
          label: `${l.ut} — ${l.area_disponible.toFixed(2)} mz libres`,
        })),
        render: (f) => <span className="font-bold text-slate-900">{f.ut}</span>,
      },
      { campo: 'nomenclatura', label: 'Nomenclatura', tipo: 'seleccion', valor: (f) => f.nomenclatura },
      {
        campo: 'zona',
        label: 'Zona',
        tipo: 'seleccion',
        valor: (f) => f.zona,
        editable: puedeEditar,
        editor: 'seleccion',
        valorEdicion: (f) => f.zona_id,
        opciones: catalogos.zonas.map((z) => ({ value: z.id, label: z.nombre })),
      },
      {
        campo: 'turno',
        label: 'Turno',
        tipo: 'seleccion',
        // El código del turno es la clave con la que se habla en campo:
        // cortado a «T1001-T…» no sirve de nada.
        ancho: '9rem',
        valor: (f) => f.turno,
        // Elegir el turno arrastra su zona, igual que en el formulario:
        // la regla vive en la base y se aplica en los dos sitios.
        editable: puedeEditar && catalogos.turnos.length > 0,
        editor: 'seleccion',
        valorEdicion: (f) => f.turno_catalogo_id ?? '',
        opciones: catalogos.turnos.map((t) => ({ value: t.id, label: t.codigo })),
        render: (f) => <span className="font-mono text-xs text-slate-700">{f.turno}</span>,
      },
      {
        campo: 'area_turno',
        label: 'Área turno',
        tipo: 'numero',
        numero: true,
        valor: (f) => Number(f.area_turno),
        etiqueta: (f) => n2(f.area_turno),
        // El área se corrige sobre la tabla, pero la sigue validando el
        // disparador de la base: si no cabe, el cambio se rechaza y la
        // pantalla lo dice con el lote y el tope.
        editable: puedeEditar,
        editor: 'numero',
        // Con los dos decimales que enseña la celda: si al tocarla el
        // 2.40 se volviera 2.4, parecería que el sistema cambió algo.
        valorEdicion: (f) => n2(f.area_turno),
        render: (f) => <span className="font-bold text-brand-700">{n2(f.area_turno)}</span>,
      },
      {
        campo: 'variedad',
        label: 'Variedad',
        tipo: 'seleccion',
        valor: (f) => f.variedad,
        editable: puedeEditar,
        editor: 'seleccion',
        valorEdicion: (f) => f.variedad_id ?? '',
        opciones: [
          { value: '', label: 'Sin variedad' },
          ...catalogos.variedades.map((v) => ({ value: v.id, label: v.nombre })),
        ],
      },
      {
        campo: 'plan_nutricional',
        label: 'Plan nutricional',
        tipo: 'seleccion',
        valor: (f) => f.plan_nutricional,
        editable: puedeEditar,
        editor: 'seleccion',
        valorEdicion: (f) => f.plan_nutricional_id ?? '',
        opciones: [
          { value: '', label: 'Sin plan' },
          ...catalogos.planes.map((p) => ({ value: p.id, label: p.nombre })),
        ],
      },
      {
        campo: 'responsable',
        label: 'Responsable',
        tipo: 'seleccion',
        valor: (f) => f.responsable,
        editable: puedeEditar,
        editor: 'texto',
      },
      {
        campo: 'estacion_riego',
        label: 'Estación riego',
        tipo: 'seleccion',
        valor: (f) => f.estacion_riego,
        editable: puedeEditar && catalogos.estaciones.length > 0,
        editor: 'seleccion',
        valorEdicion: (f) => f.estacion_riego_id ?? '',
        opciones: [
          { value: '', label: 'Sin estación' },
          ...catalogos.estaciones.map((e) => ({ value: e.id, label: e.nombre })),
        ],
      },
      {
        campo: 'fuente_agua',
        label: 'Fuente de agua',
        tipo: 'seleccion',
        valor: (f) => f.fuente_agua,
        etiqueta: (f) => FUENTES_AGUA.find((x) => x.valor === f.fuente_agua)?.etiqueta ?? '',
        editable: puedeEditar,
        editor: 'seleccion',
        valorEdicion: (f) => f.fuente_agua ?? '',
        opciones: [
          { value: '', label: 'Sin especificar' },
          ...FUENTES_AGUA.map((x) => ({ value: x.valor, label: x.etiqueta })),
        ],
      },
      {
        campo: 'orden_sap',
        label: 'Orden SAP',
        tipo: 'texto',
        valor: (f) => f.orden_sap,
        editable: puedeEditar,
        editor: 'texto',
        render: (f) =>
          f.orden_sap ? (
            <span className="font-mono text-xs">{f.orden_sap}</span>
          ) : (
            <span className="text-xs text-slate-300">—</span>
          ),
      },
      {
        campo: 'ddt_actual',
        label: 'DDT actual',
        tipo: 'numero',
        numero: true,
        valor: (f) => (f.ddt_actual === null ? null : Number(f.ddt_actual)),
        // Se recalcula solo cada día contra la hora de Honduras, así que
        // en negativo significa que la siembra todavía está por delante.
        render: (f) => (
          <span
            className={`font-bold tabular-nums ${
              f.ddt_actual === null
                ? 'text-slate-300'
                : f.ddt_actual < 0
                  ? 'text-slate-400'
                  : 'text-slate-900'
            }`}
            title={
              f.ddt_actual !== null && f.ddt_actual < 0
                ? `Faltan ${Math.abs(f.ddt_actual)} días para la siembra`
                : 'Días desde la siembra'
            }
          >
            {f.ddt_actual ?? '—'}
          </span>
        ),
      },
      {
        campo: 'estado',
        label: 'Estado',
        tipo: 'seleccion',
        valor: (f) => f.estado,
        etiqueta: (f) => etiquetaEstado(f.estado).etiqueta,
        editable: puedeEditar,
        editor: 'seleccion',
        valorEdicion: (f) => f.estado,
        opciones: ESTADOS_TURNO.map((e) => ({ value: e.valor, label: e.etiqueta })),
        render: (f) => (
          <Insignia tono={etiquetaEstado(f.estado).tono}>{etiquetaEstado(f.estado).etiqueta}</Insignia>
        ),
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
    [catalogos, lotes, puedeEditar]
  )

  /* ------------------------------ Acciones ----------------------------- */

  function nuevo() {
    setEntrada({ ...TURNO_VACIO, temporadaId: temporadaId || temporadaActiva, ciclo: ciclo || '1' })
    setLineas([{ ...LINEA_VACIA }])
  }

  function editar(fila: Fila) {
    // Se cargan TODOS los lotes del turno, no sólo la fila tocada: el
    // formulario guarda el turno entero y enseñar un lote de tres haría
    // que guardar borrara los otros dos.
    const delTurno = (filas ?? []).filter((f) => f.turno_id === fila.turno_id)
    setEntrada({
      turnoId: fila.turno_id,
      turnoCatalogoId: fila.turno_catalogo_id ?? '',
      estacionRiegoId: fila.estacion_riego_id ?? '',
      temporadaId: fila.temporada_id,
      ciclo: String(fila.ciclo),
      fechaSiembra: fila.fecha_siembra,
      zonaId: fila.zona_id,
      turno: fila.turno,
      planNutricionalId: fila.plan_nutricional_id ?? '',
      responsable: fila.responsable ?? '',
      estacionRiego: fila.estacion_riego ?? '',
      fuenteAgua: fila.fuente_agua ?? '',
      ordenSap: fila.orden_sap ?? '',
      estado: fila.estado,
      comentarios: fila.turno_comentarios ?? '',
    })
    setLineas(
      delTurno.map((f) => ({
        loteTemporadaId: f.lote_temporada_id,
        areaTurno: String(f.area_turno),
        variedadId: f.variedad_id ?? '',
      }))
    )
  }

  async function guardar() {
    if (!entrada) return
    setOcupado(true)
    setError(null)
    const r = await guardarTurno(entrada, lineas)
    setOcupado(false)
    if (!r.ok) return setError(r.mensaje)
    setEntrada(null)
    setAviso(r.mensaje)
    await recargar()
  }

  /**
   * Guardar una celda.
   *
   * Después de guardar se vuelve a consultar entero y no se parchea la
   * fila en memoria: cambiar el área mueve el saldo de OTROS lotes, y
   * cambiar el estado o la orden SAP toca todas las filas del mismo
   * turno. Parchear sólo la fila tocada dejaría la pantalla mintiendo.
   */
  async function editarCelda(fila: Fila, campo: string, valor: unknown) {
    setError(null)
    // La columna se llama como lo que se lee («Zona»); la base guarda el
    // id del catálogo (`zona_id`). La traducción vive en `lib/riego/tipos`.
    const r = await editarCampo(fila.detalle_id, campoGuardado(campo), valor)
    if (!r.ok) {
      setError(r.mensaje)
      // Se recarga igual: la celda tiene que volver a lo que de verdad
      // hay guardado, no quedarse con lo que se escribió y se rechazó.
      await recargar()
      return
    }
    await recargar()
  }

  async function cambiarEstado(ids: string[], estado: EstadoTurno, limpiar: () => void) {
    const turnos = [...new Set((filas ?? []).filter((f) => ids.includes(f.id)).map((f) => f.turno_id))]
    setOcupado(true)
    const r = await actualizarTurnos(turnos, { estado })
    setOcupado(false)
    if (!r.ok) return setError(r.mensaje)
    limpiar()
    setAviso(r.mensaje)
    await recargar()
  }

  async function eliminar(ids: string[], limpiar: () => void) {
    const marcadas = (filas ?? []).filter((f) => ids.includes(f.id))

    // Un turno al que se le quitan TODOS sus lotes se va entero: una
    // cabecera que no riega nada sigue apareciendo en los conteos y nadie
    // sabe después qué era.
    const porTurno = new Map<string, number>()
    for (const f of filas ?? []) porTurno.set(f.turno_id, (porTurno.get(f.turno_id) ?? 0) + 1)
    const quitadasPorTurno = new Map<string, number>()
    for (const f of marcadas) {
      quitadasPorTurno.set(f.turno_id, (quitadasPorTurno.get(f.turno_id) ?? 0) + 1)
    }

    const completos = [...quitadasPorTurno.entries()]
      .filter(([t, n]) => n >= (porTurno.get(t) ?? 0))
      .map(([t]) => t)
    const sueltas = marcadas.filter((f) => !completos.includes(f.turno_id)).map((f) => f.id)

    const texto =
      completos.length > 0
        ? `Se eliminarán ${marcadas.length} lote(s). ${completos.length} turno(s) se quedan sin lotes y se eliminan completos. ¿Continuar?`
        : `¿Eliminar ${marcadas.length} lote(s) del turno?`
    if (!window.confirm(texto)) return

    setOcupado(true)
    const r = await eliminarLineas(sueltas, completos)
    setOcupado(false)
    if (!r.ok) return setError(r.mensaje)
    limpiar()
    setAviso(r.mensaje)
    await recargar()
  }

  /* -------------------------------- Vista ------------------------------ */

  if (sinMigracion) return <Alerta tono="ambar">{AVISO_SIN_MIGRACION}</Alerta>

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tarjeta className="px-3.5 py-3">
          <p className="text-xl font-bold tracking-tight text-slate-900">{resumen.turnos}</p>
          <p className="text-[11px] font-medium text-slate-400">Turnos</p>
        </Tarjeta>
        <Tarjeta className="px-3.5 py-3">
          <p className="text-xl font-bold tracking-tight text-slate-900">{resumen.lotes}</p>
          <p className="text-[11px] font-medium text-slate-400">Lotes</p>
        </Tarjeta>
        <Tarjeta className="px-3.5 py-3">
          <p className="text-xl font-bold tracking-tight text-brand-700">{resumen.mz}</p>
          <p className="text-[11px] font-medium text-slate-400">Manzanas</p>
        </Tarjeta>
        <Tarjeta className="px-3.5 py-3">
          <p
            className={`text-xl font-bold tracking-tight ${
              resumen.sinOrden > 0 ? 'text-amber-600' : 'text-slate-900'
            }`}
          >
            {resumen.sinOrden}
          </p>
          <p className="text-[11px] font-medium text-slate-400">Sin orden SAP</p>
        </Tarjeta>
      </div>

      {error && <Alerta>{error}</Alerta>}
      {aviso && <Alerta tono="azul">{aviso}</Alerta>}

      {filas === null ? (
        <Tarjeta className="flex flex-col gap-2 p-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Esqueleto key={i} className="h-8 w-full" />
          ))}
        </Tarjeta>
      ) : (
        <DataGrid<Fila>
          filas={lista}
          columnas={columnas}
          titulo="Turnos de riego"
          nombreArchivo="turnos-riego"
          ordenInicial={{ campo: 'fecha_siembra', direccion: 'desc' }}
          minAncho="1700px"
          seleccionable={puedeEditar || puedeEliminar}
          puedeEditarCelda={puedeEditar}
          onEditarCelda={editarCelda}
          vacio={{
            titulo: 'Sin turnos de riego',
            descripcion: 'Crea el primero, o carga la programación completa desde Excel.',
          }}
          acciones={
            <>
              {puedeCrear && (
                <Boton onClick={nuevo}>
                  <IconPlus className="h-4 w-4" />
                  Nuevo turno
                </Boton>
              )}
              {puedeCrear && (
                <Boton variante="secundario" onClick={() => setImportando(true)}>
                  Importar
                </Boton>
              )}
            </>
          }
          accionFila={(f) =>
            puedeEditar ? (
              <Boton variante="secundario" onClick={() => editar(f)}>
                Editar
              </Boton>
            ) : null
          }
          accionesSeleccion={(ids, limpiar) => (
            <>
              {puedeEditar &&
                ESTADOS_TURNO.map((e) => (
                  <Boton
                    key={e.valor}
                    variante="secundario"
                    disabled={ocupado}
                    onClick={() => void cambiarEstado(ids, e.valor, limpiar)}
                  >
                    {e.etiqueta}
                  </Boton>
                ))}
              {puedeEliminar && (
                <Boton variante="secundario" disabled={ocupado} onClick={() => void eliminar(ids, limpiar)}>
                  Eliminar {ids.length}
                </Boton>
              )}
            </>
          )}
          filtrosExternos={
            <PanelFiltros
              activos={activos}
              onLimpiar={() => setExternos(VACIOS)}
              ayuda="El riego se organiza por ciclo de cultivo, no por mes: por eso aquí manda la temporada y no un rango de fechas."
            >
              <Campo etiqueta="Temporada" className="min-w-[190px]">
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
              <Campo etiqueta="Ciclo" className="min-w-[130px]">
                <Selector value={ciclo} onChange={(e) => setCiclo(e.target.value)}>
                  <option value="">Todos</option>
                  {CICLOS_RIEGO.map((c) => (
                    <option key={c} value={String(c)}>
                      Ciclo {c}
                    </option>
                  ))}
                </Selector>
              </Campo>
              <SelectorMultiple
                etiqueta="Zona"
                opciones={opciones.zonas}
                valores={externos.zonas}
                onCambiar={(v) => setExternos({ ...externos, zonas: v })}
              />
              <SelectorMultiple
                etiqueta="Turno"
                opciones={opciones.turnos}
                valores={externos.turnos}
                onCambiar={(v) => setExternos({ ...externos, turnos: v })}
              />
              <SelectorMultiple
                etiqueta="Plan nutricional"
                opciones={opciones.planes}
                valores={externos.planes}
                onCambiar={(v) => setExternos({ ...externos, planes: v })}
              />
              <SelectorMultiple
                etiqueta="Estado"
                opciones={opciones.estados}
                valores={externos.estados}
                onCambiar={(v) => setExternos({ ...externos, estados: v })}
              />
            </PanelFiltros>
          }
        />
      )}

      {entrada && (
        <TurnoRiegoModal
          entrada={entrada}
          lineas={lineas}
          catalogos={catalogos}
          guardando={ocupado}
          onCambiarEntrada={setEntrada}
          onCambiarLineas={setLineas}
          onGuardar={() => void guardar()}
          onCerrar={() => {
            setEntrada(null)
            setError(null)
          }}
        />
      )}

      <ImportarTurnos
        abierto={importando}
        onCerrar={() => setImportando(false)}
        catalogos={catalogos}
        onImportado={() => void recargar()}
      />
    </div>
  )
}
