'use client'

/**
 * Pestaña 3 · Logística zonal.
 *
 * La bolsa de acarreo: el movimiento de equipo que no es de ningún lote
 * en particular. Se captura por ZONA y se reparte al LEER, en la vista de
 * costos, entre las manzanas regadas de esa zona en la temporada.
 *
 * Por eso la tabla enseña un pie por zona y no un total general: el total
 * general de la bolsa no se le carga a nadie entero, y verlo solo invita
 * a cuadrarlo contra algo que no existe.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alerta, Boton, Tarjeta } from '@/components/ui/Primitivos'
import { DataGrid } from '@/components/ui/DataGrid'
import { IconPlus } from '@/components/ui/Icons'
import type { ColumnaGrid } from '@/lib/grid/tipos'
import { formatearFecha } from '@/lib/estados'
import { n2 } from '@/lib/trasplante/formato'
import { canExecuteAction, zonasParaCrear, type Reglas } from '@/lib/permisos/clientABAC'
import {
  AVISO_SIN_MIGRACION,
  editarCampoLogistica,
  eliminarLogistica,
  guardarLogistica,
  leerLogistica,
} from '@/lib/desinfeccion/repositorioCliente'
import { diagnosticarLectura } from '@/lib/supabase/instalacion'
import {
  LOGISTICA_VACIA,
  type CatalogosDesinfeccion,
  type EntradaLogistica,
  type FilaLogistica,
  type LoteDesinfeccion,
} from '@/lib/desinfeccion/tipos'
import { LogisticaModal } from './LogisticaModal'

export function GridLogistica({
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
  /** Ya recortados por zona: el cargo directo elige de aquí. */
  lotes: LoteDesinfeccion[]
  reglas: Reglas
  usuarioId: string | null
  zonas: Set<string>
  onSinMigracion: (falta: boolean, causa?: string | null) => void
}) {
  const [filas, setFilas] = useState<FilaLogistica[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [entrada, setEntrada] = useState<EntradaLogistica | null>(null)

  const ctx = useMemo(() => ({ usuarioId, zonas }), [usuarioId, zonas])
  const puedeCrear = canExecuteAction(reglas, 'desinfeccion_logistica', 'crear')
  const puedeEditar = canExecuteAction(reglas, 'desinfeccion_logistica', 'editar')
  const puedeEliminar = canExecuteAction(reglas, 'desinfeccion_logistica', 'eliminar')

  // Al CREAR con alcance zonal, el selector sólo ofrece lo asignado: dejar
  // elegir una zona ajena es dejar llenar el formulario entero para que la
  // base lo rechace al guardar.
  const zonasPermitidas = useMemo(
    () => zonasParaCrear(reglas, 'desinfeccion_logistica', zonas),
    [reglas, zonas]
  )

  const puedeEditarFila = useCallback(
    (f: FilaLogistica) =>
      canExecuteAction(
        reglas,
        'desinfeccion_logistica',
        'editar',
        { duenoId: f.usuario_id, zonaId: f.zona_id },
        ctx
      ),
    [reglas, ctx]
  )
  const puedeEliminarFila = useCallback(
    (f: FilaLogistica) =>
      canExecuteAction(
        reglas,
        'desinfeccion_logistica',
        'eliminar',
        { duenoId: f.usuario_id, zonaId: f.zona_id },
        ctx
      ),
    [reglas, ctx]
  )

  /**
   * Qué significa que una lectura falle.
   *
   * **No todo error es una migración que falta.** Antes cualquier fallo
   * —un permiso, un `select` sin conceder, la caché de esquema de
   * PostgREST sin recargar, la red— encendía «corre las migraciones 59
   * y 60». Quien ya las tenía puestas las volvía a correr, no pasaba
   * nada, y la pantalla seguía amarilla sin una sola pista. La decisión
   * vive en un solo sitio para que las seis pantallas del módulo no
   * puedan contestar cosas distintas al mismo error.
   */
  const diagnosticar = useCallback(
    (mensaje: string, codigo?: string | null) => {
      const d = diagnosticarLectura(AVISO_SIN_MIGRACION, { message: mensaje, code: codigo })
      onSinMigracion(d.falta, d.avisoModulo)
      setError(d.mensaje)
    },
    [onSinMigracion]
  )

  const recargar = useCallback(async () => {
    setCargando(true)
    const { datos, error: e, codigo } = await leerLogistica(temporadaId || null)
    setCargando(false)
    if (e) {
      diagnosticar(e, codigo)
      setFilas([])
      return
    }
    setFilas(datos)
  }, [temporadaId, diagnosticar])

  useEffect(() => {
    let vivo = true
    async function cargar() {
      setCargando(true)
      const { datos, error: e, codigo } = await leerLogistica(temporadaId || null)
      if (!vivo) return
      setCargando(false)
      if (e) {
        diagnosticar(e, codigo)
        setFilas([])
        return
      }
      onSinMigracion(false, null)
      setError(null)
      setFilas(datos)
    }
    void cargar()
    return () => {
      vivo = false
    }
  }, [temporadaId, onSinMigracion, diagnosticar])

  /** La bolsa, por zona. Es la unidad con la que de verdad se reparte. */
  const porZona = useMemo(() => {
    const m = new Map<string, { zona: string; costo: number; horas: number }>()
    for (const f of filas) {
      const llave = f.zona_nombre ?? '—'
      const a = m.get(llave) ?? { zona: llave, costo: 0, horas: 0 }
      a.costo += Number(f.costo_total)
      a.horas += Number(f.horas_trabajo)
      m.set(llave, a)
    }
    return [...m.values()].sort((a, b) => b.costo - a.costo)
  }, [filas])

  const columnas = useMemo<ColumnaGrid<FilaLogistica>[]>(
    () => [
      {
        campo: 'fecha',
        label: 'Fecha',
        tipo: 'fecha',
        ancho: '9rem',
        valor: (f) => f.fecha,
        etiqueta: (f) => formatearFecha(f.fecha),
        editable: puedeEditarFila,
        editor: 'fecha',
        valorEdicion: (f) => f.fecha,
        render: (f) => <span className="text-xs">{formatearFecha(f.fecha)}</span>,
      },
      {
        campo: 'ciclo',
        label: 'Ciclo',
        tipo: 'numero',
        numero: true,
        ancho: '5.5rem',
        valor: (f) => Number(f.ciclo),
        etiqueta: (f) => String(f.ciclo),
        editable: puedeEditarFila,
        editor: 'numero',
        valorEdicion: (f) => String(f.ciclo),
        render: (f) => (
          <span className="font-mono text-xs font-bold text-slate-900">{f.ciclo}</span>
        ),
      },
      {
        // **A quién se le cobra.** No se edita en la cuadrícula: cambiar
        // de «zona» a «lote» sin decir QUÉ lotes dejaría un cargo que no
        // se le cobra a nadie. Eso se hace en el formulario.
        campo: 'tipo_cargo',
        label: 'Cargo',
        tipo: 'seleccion',
        ancho: '11rem',
        valor: (f) => f.tipo_cargo,
        etiqueta: (f) => (f.tipo_cargo === 'lote' ? `Lote: ${f.lotes_nombres ?? '—'}` : 'Zona'),
        render: (f) =>
          f.tipo_cargo === 'lote' ? (
            <span className="text-xs">
              <span className="font-semibold text-amber-700">Lote</span>{' '}
              <span className="text-slate-400">{f.lotes_nombres ?? '—'}</span>
            </span>
          ) : (
            <span className="text-xs font-semibold text-slate-500">Zona</span>
          ),
      },
      {
        campo: 'zona_nombre',
        label: 'Zona',
        tipo: 'seleccion',
        valor: (f) => f.zona_nombre,
        editable: puedeEditarFila,
        editor: 'seleccion',
        valorEdicion: (f) => f.zona_id,
        opciones: catalogos.zonas.map((z) => ({ value: z.id, label: z.nombre })),
        render: (f) => <span className="font-semibold text-slate-900">{f.zona_nombre ?? '—'}</span>,
      },
      {
        campo: 'equipo_nombre',
        label: 'Equipo',
        tipo: 'seleccion',
        ancho: '12rem',
        valor: (f) => f.equipo_nombre,
        etiqueta: (f) => `${f.equipo_codigo ?? ''} ${f.equipo_nombre ?? ''}`.trim(),
        editable: puedeEditarFila,
        editor: 'seleccion',
        valorEdicion: (f) => f.equipo_id,
        opciones: catalogos.equipos.map((e) => ({ value: e.id, label: `${e.codigo} · ${e.nombre}` })),
        render: (f) => (
          <span className="text-xs">
            <span className="font-mono font-bold text-slate-900">{f.equipo_codigo}</span>{' '}
            <span className="text-slate-400">{f.equipo_nombre}</span>
          </span>
        ),
      },
      {
        campo: 'implemento_nombre',
        label: 'Implemento',
        tipo: 'seleccion',
        valor: (f) => f.implemento_nombre,
        editable: puedeEditarFila,
        editor: 'seleccion',
        valorEdicion: (f) => f.implemento_id ?? '',
        opciones: [
          { value: '', label: 'Sin implemento' },
          ...catalogos.implementos.map((i) => ({ value: i.id, label: `${i.codigo} · ${i.nombre}` })),
        ],
      },
      {
        campo: 'operador_nombre',
        label: 'Operador',
        tipo: 'seleccion',
        valor: (f) => f.operador_nombre,
        editable: puedeEditarFila,
        editor: 'seleccion',
        valorEdicion: (f) => f.operador_id ?? '',
        opciones: [
          { value: '', label: 'Sin operador' },
          ...catalogos.operadores.map((o) => ({ value: o.id, label: o.nombre })),
        ],
      },
      {
        campo: 'horas_trabajo',
        label: 'Horas',
        tipo: 'numero',
        numero: true,
        valor: (f) => Number(f.horas_trabajo),
        etiqueta: (f) => n2(f.horas_trabajo),
        editable: puedeEditarFila,
        editor: 'numero',
        valorEdicion: (f) => String(f.horas_trabajo),
      },
      {
        // **Las tres patas, separadas.** El costo total es la suma y no
        // se edita: lo recalcula el disparador. Lo que se corrige es la
        // pata que esté mal, y ahí se ve cuál.
        campo: 'costo_hora_equipo',
        label: 'Equipo L/h',
        tipo: 'numero',
        numero: true,
        valor: (f) => Number(f.costo_hora_equipo),
        etiqueta: (f) => n2(f.costo_hora_equipo),
        editable: puedeEditarFila,
        editor: 'numero',
        valorEdicion: (f) => String(f.costo_hora_equipo),
      },
      {
        campo: 'costo_hora_implemento',
        label: 'Implemento L/h',
        tipo: 'numero',
        numero: true,
        valor: (f) => Number(f.costo_hora_implemento),
        etiqueta: (f) => n2(f.costo_hora_implemento),
        editable: puedeEditarFila,
        editor: 'numero',
        valorEdicion: (f) => String(f.costo_hora_implemento),
      },
      {
        campo: 'salario_operador',
        label: 'Jornal operador',
        tipo: 'numero',
        numero: true,
        valor: (f) => Number(f.salario_operador),
        etiqueta: (f) => n2(f.salario_operador),
        editable: puedeEditarFila,
        editor: 'numero',
        valorEdicion: (f) => String(f.salario_operador),
      },
      {
        campo: 'costo_total',
        label: 'Costo total',
        tipo: 'numero',
        numero: true,
        valor: (f) => Number(f.costo_total),
        etiqueta: (f) => n2(f.costo_total),
        render: (f) => (
          <span className="font-bold tabular-nums text-slate-900">{n2(f.costo_total)}</span>
        ),
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
    [catalogos, puedeEditarFila]
  )

  /* ------------------------------ Acciones ----------------------------- */

  function nuevo() {
    setEntrada({ ...LOGISTICA_VACIA, temporadaId })
  }

  function editar(f: FilaLogistica) {
    setEntrada({
      id: f.id,
      temporadaId: f.temporada_id,
      ciclo: String(f.ciclo ?? 1),
      tipoCargo: f.tipo_cargo === 'lote' ? 'lote' : 'zona',
      zonaId: f.zona_id,
      lotesIds: f.lotes_ids ?? [],
      fecha: f.fecha,
      equipoId: f.equipo_id,
      implementoId: f.implemento_id ?? '',
      operadorId: f.operador_id ?? '',
      horasTrabajo: String(f.horas_trabajo),
      costoHoraEquipo: String(f.costo_hora_equipo ?? ''),
      costoHoraImplemento: String(f.costo_hora_implemento ?? ''),
      salarioOperador: String(f.salario_operador ?? ''),
      comentarios: f.comentarios ?? '',
    })
  }

  async function guardar() {
    if (!entrada) return
    setOcupado(true)
    const r = await guardarLogistica(entrada)
    setOcupado(false)
    if (!r.ok) return setError(r.mensaje)
    setEntrada(null)
    setError(null)
    setAviso(r.mensaje)
    await recargar()
  }

  async function editarCelda(fila: FilaLogistica, campo: string, valor: unknown) {
    setError(null)
    const r = await editarCampoLogistica(fila.id, campo, valor)
    if (!r.ok) setError(r.mensaje)
    // El costo total lo recalcula el disparador: hay que volver a leerlo.
    await recargar()
  }

  async function eliminar(ids: string[], limpiar: () => void) {
    if (!window.confirm(`¿Eliminar ${ids.length} acarreo(s)?`)) return
    setOcupado(true)
    const r = await eliminarLogistica(ids)
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

      {porZona.length > 0 && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {porZona.slice(0, 4).map((z) => (
            <Tarjeta key={z.zona} className="px-3.5 py-3">
              <p className="text-xl font-bold tracking-tight text-slate-900 tabular-nums">
                L {n2(z.costo)}
              </p>
              <p className="text-[11px] font-medium text-slate-400">
                {z.zona} · {n2(z.horas)} h
              </p>
            </Tarjeta>
          ))}
        </div>
      )}

      <DataGrid<FilaLogistica>
        filas={filas}
        cargando={cargando}
        columnas={columnas}
        titulo="Logística zonal"
        nombreArchivo="desinfeccion-logistica"
        ordenInicial={{ campo: 'fecha', direccion: 'desc' }}
        minAncho="1900px"
        seleccionable={puedeEliminar}
        puedeEditarCelda={puedeEditar}
        onEditarCelda={editarCelda}
        puedeExportar={canExecuteAction(reglas, 'desinfeccion_logistica', 'exportar')}
        vacio={{
          titulo: 'Sin acarreos registrados',
          descripcion: 'La bolsa de la zona se reparte entre sus lotes al leer el reporte de costos.',
        }}
        acciones={
          puedeCrear ? (
            <Boton onClick={nuevo}>
              <IconPlus className="h-4 w-4" />
              Nuevo acarreo
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
          const borrables = marcadas.filter((id) =>
            filas.some((f) => f.id === id && puedeEliminarFila(f))
          )
          return puedeEliminar ? (
            <Boton
              variante="secundario"
              disabled={ocupado || borrables.length === 0}
              onClick={() => void eliminar(borrables, limpiar)}
            >
              Eliminar {borrables.length}
            </Boton>
          ) : null
        }}
      />

      {entrada && (
        <LogisticaModal
          entrada={entrada}
          catalogos={catalogos}
          lotes={lotes}
          zonasPermitidas={zonasPermitidas}
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
