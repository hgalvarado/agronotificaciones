'use client'

/**
 * Control de labores: una línea por lote trabajado, que es la unidad que
 * se notifica a SAP.
 *
 * Se escribe SOBRE la tabla. Y cada línea se edita SOLA: la tarea, la
 * labor y el implemento viven en `registros`, que puede tener varios
 * lotes colgando, así que cambiarlos aquí se los cambiaría a todos. La
 * base separa la línea cuando hace falta (`fn_editar_linea_labor`); desde
 * aquí sólo se pide el cambio.
 *
 * La fecha NO se edita: la manda el ticket, y un disparador la vuelve a
 * poner. Se corrige en el ticket de origen.
 */

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Alerta, Boton, Campo, Esqueleto, Insignia, Selector, Tarjeta } from '@/components/ui/Primitivos'
import { DataGrid } from '@/components/ui/DataGrid'
import { BotonFila } from '@/components/ui/BotonFila'
import { GestorVistas, aplicarVista } from '@/components/ui/GestorVistas'
import { Modal } from '@/components/ui/Modal'
import { PanelFiltros } from '@/components/ui/PanelFiltros'
import { SelectorMultiple } from '@/components/ui/SelectorMultiple'
import { EditarLaborModal, type CatalogosEdicion, type FilaEditable } from './EditarLaborModal'
import type { ColumnaGrid } from '@/lib/grid/tipos'
import type { ColumnaVista } from '@/lib/grid/vistas'
import { editarLinea, eliminarLineas, type CampoLinea } from '@/lib/registro/repositorioLinea'
import { mesEnCurso } from '@/lib/fechas'
import { mensajeDeError } from '@/lib/errores'
import { procesoInfo } from '@/lib/estados'
import type { ProcesoTicket, TurnoTipo } from '@/lib/types'

type FilaLabor = {
  detalle_id: string
  registro_id: string
  ticket_id: string
  horometro_id: string
  fecha: string
  lote_temporada_id: string
  ut: string
  lote_nombre: string | null
  tarea_id: string
  tarea_codigo: string
  tarea_nombre: string
  ciclo: number
  avance_mz: number | null
  labor_id: string
  labor_nombre: string
  categoria_labor: string | null
  equipo_codigo: string
  turno: TurnoTipo
  horas_maquina: number
  horas_notificadas: number | null
  horas_costeadas: number | null
  horas_hombre: number | null
  operador_codigo: string | null
  operador_nombre: string | null
  implemento_id: string | null
  implemento_codigo: string | null
  implemento_nombre: string | null
  puesto_implemento: string | null
  operacion_implemento: number | null
  puesto_equipo: string | null
  operacion_equipo: number | null
  descripcion_equipo: string | null
  ticket_codigo: string
  ticket_proceso: ProcesoTicket
  ticket_estado: 'ABIERTO' | 'CERRADO'
  departamento: string | null
  usuario_id: string | null
  usuario_nombre: string | null
  lotes_del_registro: number
  temporada_id?: string | null
  temporada_nombre?: string | null
  lote_id?: string | null
  implemento_fisico_id?: string | null
  codigo_implemento?: string | null
  etapa?: number | null
  con_moto?: boolean | null
  proveedor_plastico_id?: string | null
  proveedor_plastico?: string | null
  proveedor_manguera_id?: string | null
  proveedor_manguera?: string | null
  detalle_comentarios?: string | null
  detalle_fecha?: string | null
  equipo_id?: string | null
  operador_id?: string | null
  horometro_inicial?: number | null
  horometro_final?: number | null
  registros_del_horometro?: number | null
  comentarios?: string | null
}

type Fila = FilaLabor & { id: string }

export type TemporadaOpcion = { id: string; nombre: string; activa: boolean }

const VACIOS = {
  labores: [] as string[],
  lotes: [] as string[],
  ciclos: [] as string[],
  equipos: [] as string[],
  turnos: [] as string[],
}

/** La operación SAP como en su Excel: cuatro dígitos con ceros. */
const oper = (n: number | null | undefined) =>
  n === null || n === undefined ? '' : String(n).padStart(4, '0')

const n2 = (v: number | null | undefined) =>
  v === null || v === undefined ? '' : String(Math.round(Number(v) * 100) / 100)

const distintos = (valores: (string | null | undefined)[]) =>
  [...new Set(valores.filter((v): v is string => Boolean(v)))]
    .sort((a, b) => a.localeCompare(b, 'es', { numeric: true }))
    .map((v) => ({ valor: v, etiqueta: v }))

export function ControlLabores({
  temporadas = [],
  catalogosEdicion,
  puedeEditar,
  puedeEliminar,
  esAdmin,
}: {
  temporadas?: TemporadaOpcion[]
  catalogosEdicion: CatalogosEdicion
  puedeEditar: boolean
  puedeEliminar: boolean
  esAdmin: boolean
}) {
  const supabase = createClient()

  const [filas, setFilas] = useState<FilaLabor[] | null>(null)
  const [editando, setEditando] = useState<FilaLabor | null>(null)
  const [enTemporada, setEnTemporada] = useState<string[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [vista, setVista] = useState<ColumnaVista[] | null>(null)

  const inicial = useMemo(() => ({ ...mesEnCurso(), temporada_id: '' }), [])
  const [rango, setRango] = useState(inicial)
  const [consulta, setConsulta] = useState(inicial)
  const [externos, setExternos] = useState(VACIOS)

  const leer = useCallback(async () => {
    let q = supabase
      .from('v_labores_control')
      .select('*')
      .gte('fecha', consulta.desde)
      .lte('fecha', consulta.hasta)
      .order('fecha', { ascending: true })
      .limit(5000)
    if (consulta.temporada_id) q = q.eq('temporada_id', consulta.temporada_id)
    return q
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [consulta.desde, consulta.hasta, consulta.temporada_id])

  const recargar = useCallback(async () => {
    const { data, error: e } = await leer()
    if (e) {
      setError(e.message)
      setFilas([])
      return
    }
    setError(null)
    setFilas((data as FilaLabor[]) ?? [])
  }, [leer])

  useEffect(() => {
    let vivo = true
    async function cargar() {
      const { data, error: e } = await leer()
      if (!vivo) return
      if (e) {
        setError(e.message)
        setFilas([])
        return
      }
      setError(null)
      setFilas((data as FilaLabor[]) ?? [])
    }
    cargar()
    return () => {
      vivo = false
    }
  }, [leer])

  // El DataGrid identifica la fila por `id`; aquí la línea es el detalle:
  // una labor con tres lotes son tres líneas, y cada una se edita y se
  // elimina por separado.
  const cargadas = useMemo<Fila[]>(
    () => (filas ?? []).map((f) => ({ ...f, id: f.detalle_id })),
    [filas]
  )

  /* ------------------ Filtros globales de la pantalla ------------------ */

  const opciones = useMemo(
    () => ({
      labores: distintos(cargadas.map((f) => f.labor_nombre)),
      lotes: distintos(cargadas.map((f) => f.ut)),
      ciclos: distintos(cargadas.map((f) => String(f.ciclo))),
      equipos: distintos(cargadas.map((f) => f.equipo_codigo)),
      turnos: [
        { valor: 'DIURNO', etiqueta: 'Diurno' },
        { valor: 'NOCTURNO', etiqueta: 'Nocturno' },
      ],
    }),
    [cargadas]
  )

  const lista = useMemo(() => {
    const la = new Set(externos.labores)
    const lo = new Set(externos.lotes)
    const ci = new Set(externos.ciclos)
    const eq = new Set(externos.equipos)
    const tu = new Set(externos.turnos)
    return cargadas.filter((f) => {
      if (la.size && !la.has(f.labor_nombre)) return false
      if (lo.size && !lo.has(f.ut)) return false
      if (ci.size && !ci.has(String(f.ciclo))) return false
      if (eq.size && !eq.has(f.equipo_codigo)) return false
      if (tu.size && !tu.has(f.turno)) return false
      return true
    })
  }, [cargadas, externos])

  const activos = Object.values(externos).filter((v) => v.length > 0).length

  const resumen = useMemo(
    () => ({
      total: lista.length,
      mz: Math.round(lista.reduce((a, f) => a + Number(f.avance_mz ?? 0), 0) * 100) / 100,
      lotes: new Set(lista.map((f) => f.ut)).size,
      sinPuesto: lista.filter((f) => !f.puesto_equipo).length,
    }),
    [lista]
  )

  const hayTemporada = cargadas.some((f) => f.temporada_nombre !== undefined)

  /* ------------------------------ Columnas ----------------------------- */

  const columnas = useMemo<ColumnaGrid<Fila>[]>(() => {
    const cols: ColumnaGrid<Fila>[] = [
      // La fecha es de sólo lectura: la manda el ticket.
      { campo: 'fecha', label: 'Fecha', tipo: 'fecha', valor: (f) => f.fecha },
      {
        campo: 'ut',
        label: 'UT',
        tipo: 'seleccion',
        valor: (f) => f.ut,
        editable: true,
        editor: 'seleccion',
        valorEdicion: (f) => f.lote_temporada_id,
        opciones: catalogosEdicion.lotes.map((l) => ({
          value: l.lote_temporada_id,
          label: l.nomenclatura,
        })),
        render: (f) => <span className="font-semibold text-slate-800">{f.ut}</span>,
      },
      { campo: 'lote_nombre', label: 'Lote', tipo: 'seleccion', valor: (f) => f.lote_nombre },
      {
        campo: 'tarea_codigo',
        label: 'Tarea',
        tipo: 'seleccion',
        valor: (f) => f.tarea_codigo,
        etiqueta: (f) => `${f.tarea_codigo} · ${f.tarea_nombre}`,
        editable: true,
        editor: 'seleccion',
        valorEdicion: (f) => f.tarea_id,
        opciones: catalogosEdicion.tareasSap.map((t) => ({
          value: t.id,
          label: `${t.codigo} · ${t.nombre}`,
        })),
        render: (f) => (
          <span title={f.tarea_nombre} className="font-medium text-slate-700">
            {f.tarea_codigo}
          </span>
        ),
      },
      {
        campo: 'labor_nombre',
        label: 'Labor',
        tipo: 'seleccion',
        valor: (f) => f.labor_nombre,
        editable: true,
        editor: 'seleccion',
        valorEdicion: (f) => f.labor_id,
        opciones: catalogosEdicion.labores.map((l) => ({ value: l.id, label: l.nombre })),
      },
      {
        campo: 'categoria_labor',
        label: 'Categoría',
        tipo: 'seleccion',
        valor: (f) => f.categoria_labor,
      },
      { campo: 'ciclo', label: 'Ciclo', tipo: 'seleccion', numero: true, valor: (f) => f.ciclo },
      {
        campo: 'avance_mz',
        label: 'Mz',
        tipo: 'numero',
        numero: true,
        valor: (f) => (f.avance_mz === null ? null : Number(f.avance_mz)),
        etiqueta: (f) => n2(f.avance_mz),
        editable: true,
        editor: 'numero',
      },
      { campo: 'equipo_codigo', label: 'Equipo', tipo: 'seleccion', valor: (f) => f.equipo_codigo },
      {
        campo: 'horas_maquina',
        label: 'H. máquina',
        tipo: 'numero',
        numero: true,
        valor: (f) => Number(f.horas_maquina),
        etiqueta: (f) => n2(f.horas_maquina),
      },
      {
        campo: 'horas_costeadas',
        label: 'H. notificadas',
        tipo: 'numero',
        numero: true,
        valor: (f) => Number(f.horas_costeadas ?? f.horas_maquina),
        etiqueta: (f) => n2(f.horas_costeadas ?? f.horas_maquina),
        render: (f) => (
          <span className="font-bold text-brand-700">
            {n2(f.horas_costeadas ?? f.horas_maquina)}
          </span>
        ),
      },
      {
        campo: 'puesto_equipo',
        label: 'Puesto',
        tipo: 'seleccion',
        valor: (f) => f.puesto_equipo,
        render: (f) =>
          f.puesto_equipo ? (
            <span className="text-xs">{f.puesto_equipo}</span>
          ) : (
            <span className="text-xs font-semibold text-red-600">Sin puesto</span>
          ),
      },
      {
        campo: 'operacion_equipo',
        label: 'Oper.',
        tipo: 'seleccion',
        valor: (f) => f.operacion_equipo,
        etiqueta: (f) => oper(f.operacion_equipo),
      },
      {
        campo: 'implemento_codigo',
        label: 'Implemento',
        tipo: 'seleccion',
        valor: (f) => f.implemento_codigo,
        editable: true,
        editor: 'seleccion',
        valorEdicion: (f) => f.implemento_id ?? '',
        opciones: catalogosEdicion.implementos.map((i) => ({
          value: i.id,
          label: `${i.codigo} · ${i.nombre}`,
        })),
      },
      {
        campo: 'operacion_implemento',
        label: 'Oper. impl.',
        tipo: 'seleccion',
        valor: (f) => f.operacion_implemento,
        etiqueta: (f) => oper(f.operacion_implemento),
      },
      {
        campo: 'operador_nombre',
        label: 'Operador',
        tipo: 'seleccion',
        valor: (f) => f.operador_nombre,
        etiqueta: (f) => [f.operador_codigo, f.operador_nombre].filter(Boolean).join(' '),
        render: (f) => (
          <span className="block max-w-[170px] truncate">
            {[f.operador_codigo, f.operador_nombre].filter(Boolean).join(' ') || '—'}
          </span>
        ),
      },
      {
        campo: 'turno',
        label: 'Turno',
        tipo: 'seleccion',
        valor: (f) => f.turno,
        etiqueta: (f) => (f.turno === 'DIURNO' ? 'Diurno' : 'Nocturno'),
      },
      {
        campo: 'ticket_codigo',
        label: 'Ticket',
        tipo: 'texto',
        valor: (f) => f.ticket_codigo,
        render: (f) => (
          <Link
            href={`/tickets/${f.ticket_id}`}
            className="text-xs font-medium text-brand-700 hover:underline"
          >
            {f.ticket_codigo}
          </Link>
        ),
      },
      {
        campo: 'ticket_proceso',
        label: 'Proceso',
        tipo: 'seleccion',
        valor: (f) => f.ticket_proceso,
        etiqueta: (f) =>
          `${procesoInfo(f.ticket_proceso).numero} · ${procesoInfo(f.ticket_proceso).etiqueta}`,
        render: (f) => (
          <Insignia tono={procesoInfo(f.ticket_proceso).tono}>
            {procesoInfo(f.ticket_proceso).numero} · {procesoInfo(f.ticket_proceso).etiqueta}
          </Insignia>
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
    ]

    // La columna de temporada sólo existe con la migración 17 corrida.
    if (hayTemporada) {
      cols.splice(1, 0, {
        campo: 'temporada_nombre',
        label: 'Temporada',
        tipo: 'seleccion',
        valor: (f) => f.temporada_nombre ?? null,
      })
    }
    return cols
  }, [hayTemporada, catalogosEdicion])

  const visibles = useMemo(() => aplicarVista(columnas, vista), [columnas, vista])

  /* ------------------------------ Escritura ---------------------------- */

  const CAMPOS: Record<string, CampoLinea> = {
    tarea_codigo: 'tarea_id',
    labor_nombre: 'labor_id',
    implemento_codigo: 'implemento_id',
    avance_mz: 'avance_mz',
    ut: 'lote_temporada_id',
  }

  async function editarCelda(fila: Fila, campo: string, valor: unknown) {
    const cual = CAMPOS[campo]
    if (!cual) return

    setError(null)
    const { error: e } = await editarLinea(fila.detalle_id, cual, valor)
    if (e) {
      return setError(
        mensajeDeError(
          e,
          'No se pudo guardar el cambio. Si dice que no existe «fn_editar_linea_labor», falta correr la migración 30.'
        )
      )
    }
    if (Number(fila.lotes_del_registro ?? 1) > 1 && cual !== 'avance_mz' && cual !== 'lote_temporada_id') {
      setAviso(
        `Esa línea se separó del ticket ${fila.ticket_codigo}: los demás lotes se quedaron como estaban.`
      )
    }
    await recargar()
  }

  async function eliminar(aBorrar: Fila[], limpiar: () => void) {
    if (aBorrar.length === 0) return

    const porRegistro = new Map<string, number>()
    for (const f of aBorrar) {
      porRegistro.set(f.registro_id, (porRegistro.get(f.registro_id) ?? 0) + 1)
    }
    const completos = new Set(
      aBorrar
        .filter((f) => (porRegistro.get(f.registro_id) ?? 0) >= Number(f.lotes_del_registro ?? 1))
        .map((f) => f.registro_id)
    )

    const n = aBorrar.length
    if (
      !confirm(
        `Se van a eliminar ${n} ${n === 1 ? 'línea' : 'líneas'} de labor.` +
          (completos.size > 0
            ? ` ${completos.size} ${
                completos.size === 1
                  ? 'labor se elimina completa'
                  : 'labores se eliminan completas'
              } porque se queda sin lotes.`
            : '') +
          ' Esto no se puede deshacer. ¿Continuar?'
      )
    ) {
      return
    }

    setOcupado(true)
    setAviso(null)
    const { error: e } = await eliminarLineas(
      aBorrar.filter((f) => !completos.has(f.registro_id)).map((f) => f.detalle_id),
      [...completos]
    )
    setOcupado(false)
    if (e) return setError(mensajeDeError(e, 'No se pudieron eliminar las líneas.'))
    limpiar()
    setAviso(`${n} ${n === 1 ? 'línea eliminada' : 'líneas eliminadas'}.`)
    await recargar()
  }

  async function editarEnMasa(ids: string[], limpiar: () => void, campo: CampoLinea, valor: unknown) {
    setOcupado(true)
    setError(null)
    // Una llamada por línea, a propósito: cada una decide sola si hay que
    // separarla del registro padre, y eso no se puede hacer en bloque.
    for (const id of ids) {
      const { error: e } = await editarLinea(id, campo, valor)
      if (e) {
        setOcupado(false)
        return setError(mensajeDeError(e, 'No se pudieron guardar todos los cambios.'))
      }
    }
    setOcupado(false)
    limpiar()
    setAviso(`${ids.length} ${ids.length === 1 ? 'línea actualizada' : 'líneas actualizadas'}.`)
    await recargar()
  }

  async function reasignarTemporada(detalleIds: string[], temporadaId: string) {
    const { data, error: e } = await supabase.rpc('fn_reasignar_temporada_detalle', {
      p_detalle_ids: detalleIds,
      p_temporada_id: temporadaId,
    })
    if (e) {
      throw new Error(
        mensajeDeError(
          e,
          'No se pudo cambiar la temporada. Si dice que la función no existe, falta correr la migración 17 en el SQL Editor de Supabase.'
        )
      )
    }
    const fila = (data as { movidos: number; sin_cambio: number; faltantes: string[] }[] | null)?.[0]
    await recargar()
    return fila ?? { movidos: 0, sin_cambio: 0, faltantes: [] }
  }

  const puedeCambiarTemporada = puedeEditar && temporadas.length > 1 && hayTemporada

  /* -------------------------------- Vista ------------------------------ */

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tarjeta className="px-3.5 py-3">
          <p className="text-xl font-bold tracking-tight text-slate-900">{resumen.total}</p>
          <p className="text-[11px] font-medium text-slate-400">Líneas</p>
        </Tarjeta>
        <Tarjeta className="px-3.5 py-3">
          <p className="text-xl font-bold tracking-tight text-brand-700">{resumen.mz}</p>
          <p className="text-[11px] font-medium text-slate-400">Manzanas</p>
        </Tarjeta>
        <Tarjeta className="px-3.5 py-3">
          <p className="text-xl font-bold tracking-tight text-slate-900">{resumen.lotes}</p>
          <p className="text-[11px] font-medium text-slate-400">Lotes</p>
        </Tarjeta>
        <Tarjeta className="px-3.5 py-3">
          <p
            className={`text-xl font-bold tracking-tight ${
              resumen.sinPuesto > 0 ? 'text-red-600' : 'text-slate-900'
            }`}
          >
            {resumen.sinPuesto}
          </p>
          <p className="text-[11px] font-medium text-slate-400">Sin puesto SAP</p>
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
          columnas={visibles}
          titulo="Labores"
          nombreArchivo={`labores-${consulta.desde}-a-${consulta.hasta}`}
          ordenInicial={{ campo: 'fecha', direccion: 'asc' }}
          minAncho="2000px"
          puedeEditarCelda={puedeEditar}
          onEditarCelda={editarCelda}
          vacio={{
            titulo: 'Sin labores',
            descripcion: 'Ajusta el rango de fechas y vuelve a consultar.',
          }}
          resaltar={(f) => (f.puesto_equipo ? null : 'bg-red-50/60')}
          acciones={
            <GestorVistas
              pantalla="labores"
              columnas={columnas}
              vista={vista}
              onVista={setVista}
              esAdmin={esAdmin}
            />
          }
          filtrosExternos={
            <PanelFiltros
              desde={rango.desde}
              hasta={rango.hasta}
              onDesde={(v) => setRango({ ...rango, desde: v })}
              onHasta={(v) => setRango({ ...rango, hasta: v })}
              onConsultar={() => setConsulta({ ...rango })}
              activos={activos}
              onLimpiar={() => setExternos(VACIOS)}
              ayuda="Al entrar se carga el mes en curso. Amplía el rango sólo cuando necesites mirar atrás."
            >
              <SelectorMultiple
                etiqueta="Labor"
                opciones={opciones.labores}
                valores={externos.labores}
                onCambiar={(v) => setExternos({ ...externos, labores: v })}
              />
              <SelectorMultiple
                etiqueta="Lote"
                opciones={opciones.lotes}
                valores={externos.lotes}
                onCambiar={(v) => setExternos({ ...externos, lotes: v })}
              />
              <SelectorMultiple
                etiqueta="Ciclo"
                opciones={opciones.ciclos}
                valores={externos.ciclos}
                onCambiar={(v) => setExternos({ ...externos, ciclos: v })}
              />
              <SelectorMultiple
                etiqueta="Equipo"
                opciones={opciones.equipos}
                valores={externos.equipos}
                onCambiar={(v) => setExternos({ ...externos, equipos: v })}
              />
              <SelectorMultiple
                etiqueta="Turno"
                opciones={opciones.turnos}
                valores={externos.turnos}
                onCambiar={(v) => setExternos({ ...externos, turnos: v })}
              />
              {temporadas.length > 0 && (
                <Campo etiqueta="Temporada">
                  <Selector
                    value={rango.temporada_id}
                    onChange={(e) => setRango({ ...rango, temporada_id: e.target.value })}
                  >
                    <option value="">Todas</option>
                    {temporadas.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.nombre}
                        {t.activa ? ' (activa)' : ''}
                      </option>
                    ))}
                  </Selector>
                </Campo>
              )}
            </PanelFiltros>
          }
          accionesSeleccion={(ids, limpiar) => (
            <>
              {puedeEditar && (
                <>
                  <select
                    aria-label="Tarea en masa"
                    defaultValue=""
                    onChange={(e) => {
                      if (!e.target.value) return
                      editarEnMasa(ids, limpiar, 'tarea_id', e.target.value)
                      e.target.value = ''
                    }}
                    className="h-9 max-w-[200px] rounded-lg border border-brand-300 bg-white px-2 text-sm font-medium text-brand-800 focus:outline-none"
                  >
                    <option value="">Cambiar tarea…</option>
                    {catalogosEdicion.tareasSap.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.codigo} · {t.nombre}
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label="Labor en masa"
                    defaultValue=""
                    onChange={(e) => {
                      if (!e.target.value) return
                      editarEnMasa(ids, limpiar, 'labor_id', e.target.value)
                      e.target.value = ''
                    }}
                    className="h-9 max-w-[200px] rounded-lg border border-brand-300 bg-white px-2 text-sm font-medium text-brand-800 focus:outline-none"
                  >
                    <option value="">Cambiar labor…</option>
                    {catalogosEdicion.labores.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.nombre}
                      </option>
                    ))}
                  </select>
                </>
              )}
              {puedeCambiarTemporada && (
                <Boton variante="secundario" tamano="sm" onClick={() => setEnTemporada(ids)}>
                  Cambiar temporada
                </Boton>
              )}
              {puedeEliminar && (
                <Boton
                  variante="peligro"
                  tamano="sm"
                  disabled={ocupado}
                  onClick={() =>
                    eliminar(
                      lista.filter((f) => ids.includes(f.id)),
                      limpiar
                    )
                  }
                >
                  Eliminar {ids.length}
                </Boton>
              )}
            </>
          )}
          accionFila={
            puedeEditar
              ? (f) => <BotonFila onClick={() => setEditando(f)}>Editar todo</BotonFila>
              : undefined
          }
        />
      )}

      <EditarLaborModal
        fila={editando as FilaEditable | null}
        catalogos={catalogosEdicion}
        onCerrar={() => setEditando(null)}
        onGuardado={async () => {
          await recargar()
          setAviso('Labor actualizada.')
        }}
      />

      <ModalTemporada
        ids={enTemporada}
        temporadas={temporadas}
        onCerrar={() => setEnTemporada(null)}
        onAplicar={async (temporadaId) => {
          const r = await reasignarTemporada(enTemporada ?? [], temporadaId)
          setEnTemporada(null)
          return r
        }}
      />

      <div className="flex flex-col gap-1 px-1 text-xs text-slate-400">
        <p>
          Las filas en rojo no se pueden notificar todavía: al equipo le falta familia con puesto de
          trabajo, o al implemento le falta su puesto. Se corrigen en Catálogos.
        </p>
        <p>
          Cada fila es un LOTE de la labor y se edita sola: cambiarle la tarea a un lote NO se la
          cambia a los demás lotes del mismo ticket. La fecha se corrige en el ticket.
        </p>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Cambio de temporada en masa                                         */
/* ------------------------------------------------------------------ */

function ModalTemporada({
  ids,
  temporadas,
  onCerrar,
  onAplicar,
}: {
  ids: string[] | null
  temporadas: TemporadaOpcion[]
  onCerrar: () => void
  onAplicar: (
    temporadaId: string
  ) => Promise<{ movidos: number; sin_cambio: number; faltantes: string[] }>
}) {
  const [temporadaId, setTemporadaId] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [resultado, setResultado] = useState<string | null>(null)

  async function aplicar() {
    if (!temporadaId) return setError('Elige la temporada de destino.')
    setError(null)
    setGuardando(true)
    try {
      const r = await onAplicar(temporadaId)
      setResultado(
        `${r.movidos} ${r.movidos === 1 ? 'línea movida' : 'líneas movidas'}` +
          (r.sin_cambio > 0 ? `, ${r.sin_cambio} ya estaban ahí` : '') +
          (r.faltantes.length > 0
            ? `. Estos lotes no están en la temporada de destino: ${r.faltantes.join(', ')}.`
            : '.')
      )
    } catch (e) {
      setError(mensajeDeError(e, 'No se pudo cambiar la temporada.'))
    } finally {
      setGuardando(false)
    }
  }

  function cerrar() {
    setTemporadaId('')
    setResultado(null)
    setError(null)
    onCerrar()
  }

  return (
    <Modal
      abierto={ids !== null}
      onCerrar={cerrar}
      titulo="Cambiar temporada"
      pie={
        <div className="flex gap-2">
          <Boton variante="secundario" className="flex-1" onClick={cerrar} disabled={guardando}>
            Cancelar
          </Boton>
          <Boton className="flex-1" onClick={aplicar} disabled={guardando || !temporadaId}>
            {guardando ? 'Guardando…' : 'Guardar'}
          </Boton>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        {error && <Alerta>{error}</Alerta>}
        {resultado && <Alerta tono="azul">{resultado}</Alerta>}

        <p className="text-sm text-slate-500">
          Se van a mover {ids?.length ?? 0} {(ids?.length ?? 0) === 1 ? 'línea' : 'líneas'}. El lote
          tiene que estar asignado a la temporada de destino; si no lo está, cópialo desde Lotes de
          la temporada.
        </p>

        <Campo etiqueta="Temporada de destino" requerido>
          <Selector value={temporadaId} onChange={(e) => setTemporadaId(e.target.value)} autoFocus>
            <option value="">Selecciona…</option>
            {temporadas.map((t) => (
              <option key={t.id} value={t.id}>
                {t.nombre}
                {t.activa ? ' (activa)' : ''}
              </option>
            ))}
          </Selector>
        </Campo>
      </div>
    </Modal>
  )
}
