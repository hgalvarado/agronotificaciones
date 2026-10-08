'use client'

/**
 * Pestaña 1 · Planificación.
 *
 * Qué se va a aplicar, lote por lote, con su costo previsto. Las columnas
 * calculadas —fecha de aplicación y los tres totales— se enseñan pero no
 * se editan: son columnas generadas de la base, y dejar escribir encima
 * sería prometer un guardado que Postgres rechaza.
 *
 * Aquí vive el botón **Sincronizar**, que vuelve a copiar la fecha de
 * siembra real sobre las líneas elegidas. Es a mano y sobre una
 * selección, no automático: congelar la fecha es la regla del módulo, y
 * descongelarla es una decisión de quien planifica.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alerta, Boton } from '@/components/ui/Primitivos'
import { DataGrid } from '@/components/ui/DataGrid'
import { IconPlus } from '@/components/ui/Icons'
import type { ColumnaGrid } from '@/lib/grid/tipos'
import { formatearFecha } from '@/lib/estados'
import { n2 } from '@/lib/trasplante/formato'
import { canExecuteAction, type Reglas } from '@/lib/permisos/clientABAC'
import {
  editarCampoPlan,
  eliminarPlanes,
  guardarPlan,
  leerPlan,
  sincronizarSiembra,
} from '@/lib/desinfeccion/repositorioCliente'
import {
  PLAN_VACIO,
  type CatalogosDesinfeccion,
  type EntradaPlan,
  type FilaPlan,
  type LoteDesinfeccion,
} from '@/lib/desinfeccion/tipos'
import { PlanModal } from './PlanModal'

export function GridPlan({
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
  const [filas, setFilas] = useState<FilaPlan[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [entrada, setEntrada] = useState<EntradaPlan | null>(null)

  const ctx = useMemo(() => ({ usuarioId, zonas }), [usuarioId, zonas])
  const puedeCrear = canExecuteAction(reglas, 'desinfeccion', 'crear')
  const puedeEditar = canExecuteAction(reglas, 'desinfeccion', 'editar')
  const puedeEliminar = canExecuteAction(reglas, 'desinfeccion', 'eliminar')

  const puedeEditarFila = useCallback(
    (f: FilaPlan) =>
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
    (f: FilaPlan) =>
      canExecuteAction(
        reglas,
        'desinfeccion',
        'eliminar',
        { duenoId: f.usuario_id, zonaId: f.zona_id },
        ctx
      ),
    [reglas, ctx]
  )

  const recargar = useCallback(async () => {
    setCargando(true)
    const { datos, error: e } = await leerPlan(temporadaId || null)
    setCargando(false)
    if (e) {
      onSinMigracion(true)
      setError(null)
      setFilas([])
      return
    }
    setError(null)
    setFilas(datos)
  }, [temporadaId, onSinMigracion])

  useEffect(() => {
    let vivo = true
    async function cargar() {
      setCargando(true)
      const { datos, error: e } = await leerPlan(temporadaId || null)
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

  const columnas = useMemo<ColumnaGrid<FilaPlan>[]>(
    () => [
      {
        campo: 'lote_nomenclatura',
        label: 'Lote',
        tipo: 'seleccion',
        ancho: '9rem',
        valor: (f) => f.lote_nomenclatura,
        editable: puedeEditarFila,
        editor: 'seleccion',
        valorEdicion: (f) => f.lote_temporada_id,
        opciones: lotes.map((l) => ({
          value: l.lote_temporada_id,
          label: `${l.nomenclatura}${l.nombre ? ` · ${l.nombre}` : ''}`,
        })),
        render: (f) => <span className="font-bold text-slate-900">{f.lote_nomenclatura}</span>,
      },
      { campo: 'lote_nombre', label: 'Nombre', tipo: 'seleccion', valor: (f) => f.lote_nombre },
      { campo: 'zona_nombre', label: 'Zona', tipo: 'seleccion', valor: (f) => f.zona_nombre },
      {
        campo: 'ciclo',
        label: 'Ciclo',
        tipo: 'seleccion',
        numero: true,
        valor: (f) => f.ciclo,
        etiqueta: (f) => `Ciclo ${f.ciclo}`,
        editable: puedeEditarFila,
        editor: 'numero',
        valorEdicion: (f) => String(f.ciclo),
      },
      {
        campo: 'fecha_siembra_congelada',
        label: 'Siembra (congelada)',
        tipo: 'fecha',
        ancho: '10rem',
        valor: (f) => f.fecha_siembra_congelada,
        etiqueta: (f) => formatearFecha(f.fecha_siembra_congelada),
        editable: puedeEditarFila,
        editor: 'fecha',
        valorEdicion: (f) => f.fecha_siembra_congelada,
        render: (f) => <span className="text-xs">{formatearFecha(f.fecha_siembra_congelada)}</span>,
      },
      {
        campo: 'dias_aplicacion',
        label: 'Días',
        tipo: 'numero',
        numero: true,
        valor: (f) => Number(f.dias_aplicacion),
        editable: puedeEditarFila,
        editor: 'numero',
        valorEdicion: (f) => String(f.dias_aplicacion),
      },
      {
        campo: 'fecha_aplicacion',
        label: 'Aplicación',
        tipo: 'fecha',
        ancho: '10rem',
        valor: (f) => f.fecha_aplicacion,
        etiqueta: (f) => formatearFecha(f.fecha_aplicacion),
        render: (f) => (
          <span className="text-xs font-semibold text-brand-700" title="La calcula la base: siembra + días.">
            {formatearFecha(f.fecha_aplicacion)}
          </span>
        ),
      },
      {
        campo: 'variedad_nombre',
        label: 'Variedad',
        tipo: 'seleccion',
        valor: (f) => f.variedad_nombre,
        editable: puedeEditarFila,
        editor: 'seleccion',
        valorEdicion: (f) => f.variedad_id ?? '',
        opciones: [
          { value: '', label: 'Sin variedad' },
          ...catalogos.variedades.map((v) => ({ value: v.id, label: v.nombre })),
        ],
      },
      {
        campo: 'producto_nombre',
        label: 'Producto',
        tipo: 'seleccion',
        ancho: '12rem',
        valor: (f) => f.producto_nombre,
        editable: puedeEditarFila,
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
        campo: 'dosis_mz',
        label: 'Dosis/mz (L)',
        tipo: 'numero',
        numero: true,
        valor: (f) => Number(f.dosis_mz),
        etiqueta: (f) => n2(f.dosis_mz),
        editable: puedeEditarFila,
        editor: 'numero',
        valorEdicion: (f) => String(f.dosis_mz),
      },
      {
        campo: 'area_planificada_mz',
        label: 'Área (mz)',
        tipo: 'numero',
        numero: true,
        valor: (f) => Number(f.area_planificada_mz),
        etiqueta: (f) => n2(f.area_planificada_mz),
        editable: puedeEditarFila,
        editor: 'numero',
        valorEdicion: (f) => String(f.area_planificada_mz),
      },
      {
        campo: 'costo_litro',
        label: 'Costo/L',
        tipo: 'numero',
        numero: true,
        valor: (f) => Number(f.costo_litro),
        etiqueta: (f) => n2(f.costo_litro),
        editable: puedeEditarFila,
        editor: 'numero',
        valorEdicion: (f) => String(f.costo_litro),
      },
      {
        campo: 'total_litros',
        label: 'Litros',
        tipo: 'numero',
        numero: true,
        valor: (f) => Number(f.total_litros),
        etiqueta: (f) => n2(f.total_litros),
      },
      {
        campo: 'total_costo',
        label: 'Costo total',
        tipo: 'numero',
        numero: true,
        valor: (f) => Number(f.total_costo),
        etiqueta: (f) => n2(f.total_costo),
        render: (f) => (
          <span className="font-bold tabular-nums text-slate-900">{n2(f.total_costo)}</span>
        ),
      },
      {
        campo: 'costo_mz',
        label: 'Costo/mz',
        tipo: 'numero',
        numero: true,
        valor: (f) => Number(f.costo_mz),
        etiqueta: (f) => n2(f.costo_mz),
      },
      {
        campo: 'comentarios',
        label: 'Comentarios',
        tipo: 'texto',
        valor: (f) => f.comentarios,
        editable: puedeEditarFila,
        editor: 'texto',
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
    [catalogos, lotes, puedeEditarFila]
  )

  /* ------------------------------ Acciones ----------------------------- */

  function nuevo() {
    setEntrada({ ...PLAN_VACIO, temporadaId })
  }

  function editar(f: FilaPlan) {
    setEntrada({
      id: f.id,
      temporadaId: f.temporada_id,
      loteTemporadaId: f.lote_temporada_id,
      ciclo: String(f.ciclo),
      fechaSiembraCongelada: f.fecha_siembra_congelada,
      diasAplicacion: String(f.dias_aplicacion),
      variedadId: f.variedad_id ?? '',
      productoId: f.producto_id ?? '',
      dosisMz: String(f.dosis_mz),
      areaPlanificadaMz: String(f.area_planificada_mz),
      costoLitro: String(f.costo_litro),
      comentarios: f.comentarios ?? '',
    })
  }

  async function guardar() {
    if (!entrada) return
    setOcupado(true)
    const r = await guardarPlan(entrada)
    setOcupado(false)
    if (!r.ok) return setError(r.mensaje)
    setEntrada(null)
    setError(null)
    setAviso(r.mensaje)
    await recargar()
  }

  async function editarCelda(fila: FilaPlan, campo: string, valor: unknown) {
    setError(null)
    const r = await editarCampoPlan(fila.id, campo, valor)
    if (!r.ok) setError(r.mensaje)
    // Se recarga pase lo que pase: los tres totales y la fecha de
    // aplicación los recalcula la base, así que parchear la fila en
    // memoria dejaría la tabla enseñando totales viejos. Y si el cambio
    // se rechazó, la celda tiene que volver a lo que de verdad hay.
    await recargar()
  }

  async function eliminar(ids: string[], limpiar: () => void) {
    if (!window.confirm(`¿Eliminar ${ids.length} línea(s) del plan?`)) return
    setOcupado(true)
    const r = await eliminarPlanes(ids)
    setOcupado(false)
    if (!r.ok) return setError(r.mensaje)
    limpiar()
    setError(null)
    setAviso(r.mensaje)
    await recargar()
  }

  async function sincronizar(ids: string[], limpiar: () => void) {
    const elegidas = filas.filter((f) => ids.includes(f.id))
    if (elegidas.length === 0) return
    if (
      !window.confirm(
        `La fecha de siembra del plan está congelada a propósito.\n\n` +
          `Sincronizar vuelve a copiar la siembra REAL sobre ${elegidas.length} línea(s), ` +
          `y eso mueve su fecha de aplicación. ¿Continuar?`
      )
    ) {
      return
    }
    setOcupado(true)
    const r = await sincronizarSiembra(elegidas)
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

      <DataGrid<FilaPlan>
        filas={filas}
        cargando={cargando}
        columnas={columnas}
        titulo="Plan de desinfección"
        nombreArchivo="desinfeccion-plan"
        ordenInicial={{ campo: 'fecha_aplicacion', direccion: 'asc' }}
        minAncho="1800px"
        seleccionable={puedeEditar || puedeEliminar}
        puedeEditarCelda={puedeEditar}
        onEditarCelda={editarCelda}
        puedeExportar={canExecuteAction(reglas, 'desinfeccion', 'exportar')}
        vacio={{
          titulo: 'Sin plan de desinfección',
          descripcion: 'Crea la primera línea: un lote, su fecha de siembra y los días a la aplicación.',
        }}
        resumen={(visibles) => (
          <span className="text-xs text-slate-500">
            <strong className="text-slate-900">{n2(visibles.reduce((a, f) => a + Number(f.area_planificada_mz), 0))}</strong>{' '}
            mz planificadas · L{' '}
            <strong className="text-slate-900">{n2(visibles.reduce((a, f) => a + Number(f.total_costo), 0))}</strong>
          </span>
        )}
        acciones={
          puedeCrear ? (
            <Boton onClick={nuevo}>
              <IconPlus className="h-4 w-4" />
              Nuevo
            </Boton>
          ) : null
        }
        accionFila={(f) =>
          puedeEditarFila(f) ? (
            <Boton variante="secundario" onClick={() => editar(f)}>
              Editar
            </Boton>
          ) : null
        }
        accionesSeleccion={(marcadas, limpiar) => {
          // Lo que esta persona no puede tocar se cae de la selección
          // ANTES de mandar nada: si no, la base rechazaría esas filas a
          // mitad del bucle y el cambio quedaría hecho a medias.
          const editables = marcadas.filter((id) =>
            filas.some((f) => f.id === id && puedeEditarFila(f))
          )
          const borrables = marcadas.filter((id) =>
            filas.some((f) => f.id === id && puedeEliminarFila(f))
          )
          return (
            <>
              {puedeEditar && (
                <Boton
                  variante="secundario"
                  disabled={ocupado || editables.length === 0}
                  onClick={() => void sincronizar(editables, limpiar)}
                  title="Vuelve a copiar la fecha de siembra real sobre el plan."
                >
                  Sincronizar {editables.length}
                </Boton>
              )}
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
        <PlanModal
          entrada={entrada}
          catalogos={catalogos}
          lotes={lotes}
          guardando={ocupado}
          onCambiar={setEntrada}
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
