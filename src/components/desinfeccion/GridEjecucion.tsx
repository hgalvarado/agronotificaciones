'use client'

/**
 * Pestaña 2 · Ejecución de turnos. La cuadrícula principal del módulo.
 *
 * Una fila es un TURNO completo, con su resumen de lo que cuelga —cuántos
 * lotes, cuántas manzanas, cuánto costó la cuadrilla—, que la vista ya
 * trae sumado. El detalle renglón por renglón se abre en el formulario:
 * una celda no puede guardar una lista de lotes.
 *
 * El candado de fase —un turno en Aplicación no se corrige de pasada— es
 * convención de PANTALLA, no de RLS: está explicado en `faseCerrada`.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alerta, Boton, Insignia } from '@/components/ui/Primitivos'
import { DataGrid } from '@/components/ui/DataGrid'
import { IconPlus } from '@/components/ui/Icons'
import type { ColumnaGrid } from '@/lib/grid/tipos'
import { formatearFecha } from '@/lib/estados'
import { n2 } from '@/lib/trasplante/formato'
import { canExecuteAction, type Reglas } from '@/lib/permisos/clientABAC'
import { faseCerrada } from '@/lib/desinfeccion/calculo'
import {
  cambiarFase,
  editarCampoEjecucion,
  eliminarEjecuciones,
  guardarEjecucion,
  leerDetalle,
  leerEjecuciones,
} from '@/lib/desinfeccion/repositorioCliente'
import {
  EJECUCION_VACIA,
  FASES,
  LINEA_LOTE_VACIA,
  LINEA_PERSONAL_VACIA,
  etiquetaFase,
  type CatalogosDesinfeccion,
  type EntradaEjecucion,
  type FilaEjecucion,
  type LecturaTensiometro,
  type LineaLote,
  type LineaPersonal,
  type LoteDesinfeccion,
} from '@/lib/desinfeccion/tipos'
import { EjecucionModal } from './EjecucionModal'

const t = (v: string | null | undefined) => (v ?? '').slice(0, 5)

export function GridEjecucion({
  temporadaId,
  catalogos,
  lotes,
  reglas,
  usuarioId,
  zonas,
  onSinMigracion,
}: {
  temporadaId: string
  catalogos: CatalogosDesinfeccion
  lotes: LoteDesinfeccion[]
  reglas: Reglas
  usuarioId: string | null
  zonas: Set<string>
  onSinMigracion: (falta: boolean) => void
}) {
  const [filas, setFilas] = useState<FilaEjecucion[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)

  const [entrada, setEntrada] = useState<EntradaEjecucion | null>(null)
  const [lecturas, setLecturas] = useState<LecturaTensiometro[]>([])
  const [lineasLote, setLineasLote] = useState<LineaLote[]>([{ ...LINEA_LOTE_VACIA }])
  const [lineasPersonal, setLineasPersonal] = useState<LineaPersonal[]>([
    { ...LINEA_PERSONAL_VACIA },
  ])

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
            {f.hora_inicio_preriego && (
              <span className="ml-1 text-slate-400">
                {t(f.hora_inicio_preriego)}–{t(f.hora_fin_preriego)}
              </span>
            )}
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
          ...catalogos.estaciones.map((e) => ({ value: e.id, label: e.nombre })),
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
        valor: (f) => (f.total_horas_riego === null ? null : Number(f.total_horas_riego)),
        etiqueta: (f) => n2(f.total_horas_riego),
        editable: celdaEditable,
        editor: 'numero',
        valorEdicion: (f) => String(f.total_horas_riego ?? ''),
      },
      {
        campo: 'ppm',
        label: 'ppm',
        tipo: 'numero',
        numero: true,
        valor: (f) => (f.ppm === null ? null : Number(f.ppm)),
        etiqueta: (f) => n2(f.ppm),
        editable: celdaEditable,
        editor: 'numero',
        valorEdicion: (f) => String(f.ppm ?? ''),
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
        campo: 'producto_nombre',
        label: 'Producto',
        tipo: 'seleccion',
        ancho: '12rem',
        valor: (f) => f.producto_nombre,
        editable: celdaEditable,
        editor: 'seleccion',
        valorEdicion: (f) => f.producto_id ?? '',
        opciones: [
          { value: '', label: 'Sin producto' },
          ...catalogos.materiales.map((m) => ({
            value: m.id,
            label: `${m.codigo}${m.descripcion ? ` · ${m.descripcion}` : ''}`,
          })),
        ],
      },
      {
        campo: 'litros_acido',
        label: 'Litros ácido',
        tipo: 'numero',
        numero: true,
        valor: (f) => Number(f.litros_acido ?? 0),
        etiqueta: (f) => n2(f.litros_acido),
        editable: celdaEditable,
        editor: 'numero',
        valorEdicion: (f) => String(f.litros_acido ?? ''),
      },
      {
        campo: 'costo_acido',
        label: 'Costo químico',
        tipo: 'numero',
        numero: true,
        valor: (f) => Number(f.costo_acido ?? 0),
        etiqueta: (f) => n2(f.costo_acido),
        render: (f) => (
          <span className="font-bold tabular-nums text-slate-900">{n2(f.costo_acido)}</span>
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
    [catalogos, celdaEditable, puedeEditarFila]
  )

  /* ------------------------------ Acciones ----------------------------- */

  function nuevo() {
    setEntrada({ ...EJECUCION_VACIA, temporadaId })
    setLecturas([])
    setLineasLote([{ ...LINEA_LOTE_VACIA }])
    setLineasPersonal([{ ...LINEA_PERSONAL_VACIA }])
  }

  async function editar(f: FilaEjecucion) {
    setOcupado(true)
    const { lotes: ls, personal: ps, error: e } = await leerDetalle(f.id)
    setOcupado(false)
    if (e) return setError(e)

    setEntrada({
      id: f.id,
      temporadaId: f.temporada_id,
      turnoId: f.turno_id,
      estado: f.estado,
      fechaPreriego: f.fecha_preriego ?? '',
      horaInicioPreriego: t(f.hora_inicio_preriego),
      horaFinPreriego: t(f.hora_fin_preriego),
      obsPreriego: f.obs_preriego ?? '',
      fechaAplicacion: f.fecha_aplicacion ?? '',
      estacionRiegoId: f.estacion_riego_id ?? '',
      horasPresurizacion: String(f.horas_presurizacion ?? ''),
      horaInicioIny: t(f.hora_inicio_iny),
      horaFinIny: t(f.hora_fin_iny),
      horasLavado: String(f.horas_lavado ?? ''),
      totalHorasRiego: String(f.total_horas_riego ?? ''),
      ppm: String(f.ppm ?? ''),
      ceAntes: String(f.ce_antes ?? ''),
      ceDurante: String(f.ce_durante ?? ''),
      ceDespues: String(f.ce_despues ?? ''),
      calibracionEntrada: String(f.calibracion_entrada ?? ''),
      calibracionSalida: String(f.calibracion_salida ?? ''),
      calibracionCampo: String(f.calibracion_campo ?? ''),
      productoId: f.producto_id ?? '',
      litrosAcido: String(f.litros_acido ?? ''),
      costoLitroAcido: String(f.costo_litro_acido ?? ''),
    })

    // El JSONB viene como venga: si alguien guardó otra cosa ahí, se
    // ignora en vez de tumbar el formulario.
    setLecturas(Array.isArray(f.lecturas_tensiometro) ? f.lecturas_tensiometro : [])
    setLineasLote(
      ls.length > 0
        ? ls.map((l) => ({
            id: l.id,
            loteTemporadaId: l.lote_temporada_id,
            mzCubiertas: String(l.mz_cubiertas),
          }))
        : [{ ...LINEA_LOTE_VACIA }]
    )
    setLineasPersonal(
      ps.length > 0
        ? ps.map((p) => ({
            id: p.id,
            puestoId: p.puesto_id,
            operadorId: p.operador_id ?? '',
            cantidadPersonas: String(p.cantidad_personas),
            jornadas: String(p.jornadas),
            horasExtras: String(p.horas_extras),
            jornadaTipo: p.jornada_tipo,
          }))
        : [{ ...LINEA_PERSONAL_VACIA }]
    )
  }

  async function guardar() {
    if (!entrada) return
    setOcupado(true)
    const r = await guardarEjecucion(entrada, lecturas, lineasLote, lineasPersonal)
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
        `¿Eliminar ${ids.length} ejecución(es)? Se van con ellas sus lotes regados y su cuadrilla.`
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
        minAncho="2100px"
        seleccionable={puedeEditar || puedeEliminar}
        puedeEditarCelda={puedeEditar}
        onEditarCelda={editarCelda}
        puedeExportar={canExecuteAction(reglas, 'desinfeccion', 'exportar')}
        vacio={{
          titulo: 'Sin turnos ejecutados',
          descripcion: 'Registra el primero: preriego, lecturas y aplicación van en el mismo turno.',
        }}
        resumen={(visibles) => (
          <span className="text-xs text-slate-500">
            <strong className="text-slate-900">{n2(visibles.reduce((a, f) => a + Number(f.mz_regadas), 0))}</strong>{' '}
            mz regadas · químico L{' '}
            <strong className="text-slate-900">{n2(visibles.reduce((a, f) => a + Number(f.costo_acido ?? 0), 0))}</strong>{' '}
            · mano de obra L{' '}
            <strong className="text-slate-900">{n2(visibles.reduce((a, f) => a + Number(f.costo_personal), 0))}</strong>
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
          catalogos={catalogos}
          lotesDisponibles={lotes}
          guardando={ocupado}
          onCambiarEntrada={setEntrada}
          onCambiarLecturas={setLecturas}
          onCambiarLotes={setLineasLote}
          onCambiarPersonal={setLineasPersonal}
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
