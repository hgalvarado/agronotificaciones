'use client'

/**
 * Control de horómetros: el correlativo por equipo que destapa las horas
 * trabajadas sin notificar.
 *
 * Se escribe SOBRE la tabla, como en una hoja de cálculo. Abrir un modal
 * para corregir una lectura de tres cifras era el doble de clics que
 * corregirla en su sitio, y estas correcciones vienen de cincuenta en
 * cincuenta cuando se cuadra el mes.
 *
 * La fecha NO se edita aquí: la manda el ticket, y un disparador de la
 * base la vuelve a poner. Se corrige en el ticket de origen.
 *
 * Aquí sólo se declaran las columnas y las acciones; la mecánica de la
 * tabla es la estándar (`DataGrid`).
 */

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Alerta, Boton, Esqueleto, Insignia, Tarjeta } from '@/components/ui/Primitivos'
import { DataGrid } from '@/components/ui/DataGrid'
import { PanelFiltros } from '@/components/ui/PanelFiltros'
import { SelectorMultiple } from '@/components/ui/SelectorMultiple'
import type { ColumnaGrid } from '@/lib/grid/tipos'
import { mesEnCurso } from '@/lib/fechas'
import { mensajeDeError } from '@/lib/errores'
import { filasHorometrosSap } from '@/lib/sap/exportacion'
import { BotonExportarSap } from '@/components/ui/BotonExportarSap'
import { validarHorasHombre } from '@/lib/horometro/validacion'
import { PROCESOS, procesoInfo } from '@/lib/estados'
import type { Equipo, Operador, ProcesoTicket, TurnoTipo } from '@/lib/types'

export type FilaControl = {
  id: string
  ticket_id: string
  fecha: string
  turno: TurnoTipo
  equipo_id: string
  equipo_codigo: string
  equipo_nombre: string
  familia: string | null
  horometro_inicial: number
  horometro_final: number
  horas_maquina: number
  horas_hombre: number | null
  operador_id: string | null
  operador_codigo: string | null
  operador_nombre: string | null
  ticket_codigo: string
  ticket_estado: 'ABIERTO' | 'CERRADO'
  ticket_proceso: ProcesoTicket
  departamento: string | null
  comentario: string | null
  horometro_final_anterior: number | null
  comparativo: number | null
  usuario_id: string | null
  /** Llega con la migración 30; sin ella el filtro de usuario no aparece. */
  usuario_nombre?: string | null
  /** Llegan con la migración 38. Sin ella la columna no se dibuja. */
  contador_sap?: string | null
  /** La fila estrena tablero: no hay contra qué compararla, y es distinto
   *  de ser la primera jornada del equipo. */
  inicio_contador?: boolean | null
}

const VACIOS = {
  equipos: [] as string[],
  familias: [] as string[],
  operadores: [] as string[],
  usuarios: [] as string[],
  procesos: [] as string[],
}

/**
 * ¿Esta jornada ya se liquidó en SAP?
 *
 * El proceso 3 —Notificado— la cierra: corregirla aquí dejaría la base
 * diciendo una cosa y SAP otra. Se corrige devolviendo el ticket a un
 * proceso anterior. El Administrador sí puede, porque alguien tiene que
 * poder arreglar una notificación mal hecha.
 */
function liquidada(f: { ticket_proceso: ProcesoTicket }): boolean {
  return f.ticket_proceso === 'NOTIFICADO'
}

const n2 = (v: number | null | undefined) =>
  v === null || v === undefined ? '' : String(Math.round(Number(v) * 100) / 100)

const distintos = (valores: (string | null | undefined)[]) =>
  [...new Set(valores.filter((v): v is string => Boolean(v)))]
    .sort((a, b) => a.localeCompare(b, 'es', { numeric: true }))
    .map((v) => ({ valor: v, etiqueta: v }))

export function ControlHorometros({
  equipos,
  operadores,
  puedeEditar,
  puedeEliminar,
}: {
  equipos: Equipo[]
  operadores: Operador[]
  puedeEditar: boolean
  puedeEliminar: boolean
}) {
  const supabase = createClient()

  const [filas, setFilas] = useState<FilaControl[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)

  const inicial = useMemo(mesEnCurso, [])
  const [rango, setRango] = useState(inicial)
  const [consulta, setConsulta] = useState(inicial)
  const [externos, setExternos] = useState(VACIOS)

  const leer = useCallback(async () => {
    return supabase
      .from('v_horometros_control')
      .select('*')
      .gte('fecha', consulta.desde)
      .lte('fecha', consulta.hasta)
      .order('equipo_codigo', { ascending: true })
      .order('fecha', { ascending: true })
      // El mismo desempate que usa la vista para encadenar: dentro de un
      // día el diurno va antes que el nocturno. Sin esto la pantalla
      // ordenaba distinto que el cálculo y las filas parecían saltadas.
      .order('turno', { ascending: true })
      .limit(5000)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [consulta.desde, consulta.hasta])

  const recargar = useCallback(async () => {
    const { data, error: e } = await leer()
    if (e) {
      setError(e.message)
      setFilas([])
      return
    }
    setError(null)
    setFilas((data as FilaControl[]) ?? [])
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
      setFilas((data as FilaControl[]) ?? [])
    }
    cargar()
    return () => {
      vivo = false
    }
  }, [leer])

  const cargadas = useMemo(() => filas ?? [], [filas])

  /* ------------------ Filtros globales de la pantalla ------------------ */

  const opciones = useMemo(
    () => ({
      equipos: distintos(cargadas.map((f) => f.equipo_codigo)),
      familias: distintos(cargadas.map((f) => f.familia)),
      operadores: distintos(
        cargadas.map((f) => [f.operador_codigo, f.operador_nombre].filter(Boolean).join(' ') || null)
      ),
      usuarios: distintos(cargadas.map((f) => f.usuario_nombre ?? null)),
      // Del catálogo y no de las filas: se filtra por «Notificado»
      // también cuando no hay ninguna todavía, que es justo cuando se
      // quiere comprobar que no quedó nada sin notificar.
      procesos: PROCESOS.map((p) => ({
        valor: p.valor,
        etiqueta: `${p.numero}. ${p.etiqueta}`,
      })),
    }),
    [cargadas]
  )

  const lista = useMemo(() => {
    const eq = new Set(externos.equipos)
    const fa = new Set(externos.familias)
    const op = new Set(externos.operadores)
    const us = new Set(externos.usuarios)
    const pr = new Set(externos.procesos)
    return cargadas.filter((f) => {
      if (pr.size && !pr.has(f.ticket_proceso)) return false
      if (eq.size && !eq.has(f.equipo_codigo)) return false
      if (fa.size && !fa.has(f.familia ?? '')) return false
      if (
        op.size &&
        !op.has([f.operador_codigo, f.operador_nombre].filter(Boolean).join(' '))
      ) {
        return false
      }
      if (us.size && !us.has(f.usuario_nombre ?? '')) return false
      return true
    })
  }, [cargadas, externos])

  const activos = Object.values(externos).filter((v) => v.length > 0).length

  const resumen = useMemo(() => {
    const conDesfase = lista.filter((f) => f.comparativo != null && Number(f.comparativo) !== 0)
    return {
      total: lista.length,
      horas: Math.round(lista.reduce((a, f) => a + Number(f.horas_maquina ?? 0), 0) * 100) / 100,
      conDesfase: conDesfase.length,
      horasNoNotificadas:
        Math.round(
          conDesfase.reduce((a, f) => a + Math.max(Number(f.comparativo ?? 0), 0), 0) * 100
        ) / 100,
    }
  }, [lista])

  // La columna de contador sólo tiene sentido si hay contadores que
  // enseñar. Se deduce de lo que llegó, no de una bandera de migración:
  // si la vista todavía no trae el campo, la respuesta es la misma.
  const hayContadores = useMemo(
    () => (filas ?? []).some((f) => Boolean(f.contador_sap)),
    [filas]
  )

  /* ------------------------------ Columnas ----------------------------- */

  const columnas = useMemo<ColumnaGrid<FilaControl>[]>(
    () => [
      // La fecha es de sólo lectura: la manda el ticket.
      { campo: 'fecha', label: 'Fecha', tipo: 'fecha', valor: (f) => f.fecha },
      {
        campo: 'equipo_codigo',
        label: 'Equipo',
        tipo: 'seleccion',
        valor: (f) => f.equipo_codigo,
        editable: (f: FilaControl) => !liquidada(f),
        editor: 'seleccion',
        valorEdicion: (f) => f.equipo_id,
        opciones: equipos.map((e) => ({ value: e.id, label: e.codigo })),
        render: (f) => <span className="font-bold text-slate-900">{f.equipo_codigo}</span>,
      },
      { campo: 'familia', label: 'Familia', tipo: 'seleccion', valor: (f) => f.familia },
      {
        campo: 'horometro_inicial',
        label: 'HI',
        tipo: 'numero',
        numero: true,
        valor: (f) => Number(f.horometro_inicial),
        editable: (f: FilaControl) => !liquidada(f),
        editor: 'numero',
      },
      {
        campo: 'horometro_final',
        label: 'HF',
        tipo: 'numero',
        numero: true,
        valor: (f) => Number(f.horometro_final),
        editable: (f: FilaControl) => !liquidada(f),
        editor: 'numero',
      },
      {
        campo: 'turno',
        label: 'Turno',
        tipo: 'seleccion',
        valor: (f) => f.turno,
        etiqueta: (f) => (f.turno === 'DIURNO' ? 'Diurno' : 'Nocturno'),
        editable: (f: FilaControl) => !liquidada(f),
        editor: 'seleccion',
        valorEdicion: (f) => f.turno,
        opciones: [
          { value: 'DIURNO', label: 'Diurno' },
          { value: 'NOCTURNO', label: 'Nocturno' },
        ],
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
        campo: 'operador_nombre',
        label: 'Operador',
        tipo: 'seleccion',
        valor: (f) => f.operador_nombre,
        etiqueta: (f) => [f.operador_codigo, f.operador_nombre].filter(Boolean).join(' '),
        editable: (f: FilaControl) => !liquidada(f),
        editor: 'seleccion',
        valorEdicion: (f) => f.operador_id ?? '',
        opciones: operadores.map((o) => ({
          value: o.id,
          label: [o.codigo, o.nombre].filter(Boolean).join(' '),
        })),
        render: (f) => (
          <span className="block max-w-[180px] truncate">
            {[f.operador_codigo, f.operador_nombre].filter(Boolean).join(' ') || '—'}
          </span>
        ),
      },
      {
        campo: 'horas_maquina',
        label: 'Horas',
        tipo: 'numero',
        numero: true,
        valor: (f) => Number(f.horas_maquina),
        render: (f) => <span className="font-bold text-brand-700">{n2(f.horas_maquina)}</span>,
      },
      {
        campo: 'horas_hombre',
        label: 'H. hombre',
        tipo: 'numero',
        numero: true,
        valor: (f) => (f.horas_hombre === null ? null : Number(f.horas_hombre)),
        etiqueta: (f) => n2(f.horas_hombre),
        editable: (f: FilaControl) => !liquidada(f),
        editor: 'numero',
      },
      {
        campo: 'comentario',
        label: 'Comentario',
        tipo: 'texto',
        valor: (f) => f.comentario,
        editable: (f: FilaControl) => !liquidada(f),
        editor: 'texto',
      },
      {
        campo: 'usuario_nombre',
        label: 'Capturó',
        tipo: 'seleccion',
        valor: (f) => f.usuario_nombre ?? null,
        render: (f) => (
          <span className="block max-w-[150px] truncate text-xs text-slate-400">
            {f.usuario_nombre ?? '—'}
          </span>
        ),
      },
      // Sólo aparece cuando la migración 38 está corrida Y hay al menos
      // un equipo con contador registrado: en una finca que nunca ha
      // cambiado un tablero es una columna vacía que estorba.
      ...(hayContadores
        ? [
            {
              campo: 'contador_sap',
              label: 'Contador',
              tipo: 'seleccion' as const,
              valor: (f: FilaControl) => f.contador_sap ?? null,
              render: (f: FilaControl) => (
                <span className="font-mono text-xs text-slate-500">{f.contador_sap ?? '—'}</span>
              ),
            },
          ]
        : []),
      {
        campo: 'comparativo',
        label: 'Comparativo',
        tipo: 'numero',
        numero: true,
        valor: (f) => (f.comparativo === null ? null : Number(f.comparativo)),
        etiqueta: (f) => n2(f.comparativo),
        render: (f) => (
          <Comparativo
            valor={f.comparativo === null ? null : Number(f.comparativo)}
            inicioContador={f.inicio_contador === true}
          />
        ),
      },
    ],
    [equipos, operadores, hayContadores]
  )

  /* ------------------------------ Escritura ---------------------------- */

  // Se guarda y se vuelve a consultar: cambiar una lectura recalcula el
  // comparativo de la fila siguiente del mismo equipo, así que no basta
  // con tocar la fila editada.
  async function editarCelda(fila: FilaControl, campo: string, valor: unknown) {
    const columna =
      campo === 'equipo_codigo'
        ? 'equipo_id'
        : campo === 'operador_nombre'
          ? 'operador_id'
          : campo

    setError(null)

    // Las horas hombre pasan por la MISMA regla que el formulario de
    // alta. Vaciar la celda dejaba la columna en nulo, y de ahí sale el
    // costo de mano de obra: un nulo se suma como cero sin que nadie lo
    // note, que es justo lo que se está cerrando.
    if (columna === 'horas_hombre') {
      const revisado = validarHorasHombre(valor === null || valor === undefined ? '' : String(valor))
      if (!revisado.ok) {
        setError(revisado.error)
        await recargar()
        return
      }
      valor = revisado.valor
    }
    const { error: e } = await supabase
      .from('horometros')
      .update({ [columna]: valor })
      .eq('id', fila.id)

    if (e) return setError(mensajeDeError(e, 'No se pudo guardar el cambio.'))
    await recargar()
  }

  async function editarEnMasa(ids: string[], limpiar: () => void, campos: Record<string, unknown>) {
    setOcupado(true)
    setError(null)
    const { error: e } = await supabase.from('horometros').update(campos).in('id', ids)
    setOcupado(false)
    if (e) return setError(mensajeDeError(e, 'No se pudieron guardar los cambios.'))
    limpiar()
    setAviso(`${ids.length} ${ids.length === 1 ? 'horómetro actualizado' : 'horómetros actualizados'}.`)
    await recargar()
  }

  async function eliminar(ids: string[], limpiar: () => void) {
    if (ids.length === 0) return
    if (
      !confirm(
        `Se van a eliminar ${ids.length} ${
          ids.length === 1 ? 'horómetro' : 'horómetros'
        } con TODAS sus labores. Esto no se puede deshacer. ¿Continuar?`
      )
    ) {
      return
    }
    setOcupado(true)
    setAviso(null)
    const { error: e } = await supabase.from('horometros').delete().in('id', ids)
    setOcupado(false)
    if (e) return setError(mensajeDeError(e, 'No se pudieron eliminar los horómetros.'))
    limpiar()
    setAviso(`${ids.length} ${ids.length === 1 ? 'horómetro eliminado' : 'horómetros eliminados'}.`)
    await recargar()
  }

  /* -------------------------------- Vista ------------------------------ */

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tarjeta className="px-3.5 py-3">
          <p className="text-xl font-bold tracking-tight text-slate-900">{resumen.total}</p>
          <p className="text-[11px] font-medium text-slate-400">Registros</p>
        </Tarjeta>
        <Tarjeta className="px-3.5 py-3">
          <p className="text-xl font-bold tracking-tight text-brand-700">{resumen.horas}</p>
          <p className="text-[11px] font-medium text-slate-400">Horas máquina</p>
        </Tarjeta>
        <Tarjeta className="px-3.5 py-3">
          <p
            className={`text-xl font-bold tracking-tight ${
              resumen.conDesfase > 0 ? 'text-amber-600' : 'text-slate-900'
            }`}
          >
            {resumen.conDesfase}
          </p>
          <p className="text-[11px] font-medium text-slate-400">Con desfase</p>
        </Tarjeta>
        <Tarjeta className="px-3.5 py-3">
          <p
            className={`text-xl font-bold tracking-tight ${
              resumen.horasNoNotificadas > 0 ? 'text-red-600' : 'text-slate-900'
            }`}
          >
            {resumen.horasNoNotificadas}
          </p>
          <p className="text-[11px] font-medium text-slate-400">Horas sin notificar</p>
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
        <DataGrid<FilaControl>
          filas={lista}
          columnas={columnas}
          titulo="Horometros"
          nombreArchivo={`horometros-${consulta.desde}-a-${consulta.hasta}`}
          ordenInicial={{ campo: 'fecha', direccion: 'asc' }}
          minAncho="1560px"
          puedeEditarCelda={puedeEditar}
          onEditarCelda={editarCelda}
          vacio={{
            titulo: 'Sin registros',
            descripcion: 'Ajusta el rango de fechas y vuelve a consultar.',
          }}
          exportacionesExtra={(visibles) => (
            <BotonExportarSap
              nombreArchivo={`horometros-sap-${consulta.desde}-a-${consulta.hasta}`}
              hoja="Horometros"
              filas={() => filasHorometrosSap(visibles)}
              deshabilitado={visibles.length === 0}
            />
          )}
          // El desfase tiene que saltar a la vista al recorrer la tabla:
          // es una hora de máquina sin explicar, y antes era un tinte tan
          // suave que había que buscarlo. Fondo ámbar sólido y una barra
          // en el borde izquierdo, que es lo que se ve al hojear.
          resaltar={(f) =>
            f.comparativo != null && Number(f.comparativo) !== 0
              ? 'bg-amber-100/80 shadow-[inset_4px_0_0_0_var(--color-amber-500)] hover:bg-amber-100'
              : null
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
              ayuda="Al entrar se carga el mes en curso. Amplía el rango sólo cuando necesites mirar atrás: cada mes de más son miles de filas."
            >
              <SelectorMultiple
                etiqueta="Equipo"
                opciones={opciones.equipos}
                valores={externos.equipos}
                onCambiar={(v) => setExternos({ ...externos, equipos: v })}
              />
              <SelectorMultiple
                etiqueta="Familia"
                opciones={opciones.familias}
                valores={externos.familias}
                onCambiar={(v) => setExternos({ ...externos, familias: v })}
              />
              <SelectorMultiple
                etiqueta="Operador"
                opciones={opciones.operadores}
                valores={externos.operadores}
                onCambiar={(v) => setExternos({ ...externos, operadores: v })}
              />
              <SelectorMultiple
                etiqueta="Proceso"
                opciones={opciones.procesos}
                valores={externos.procesos}
                onCambiar={(v) => setExternos({ ...externos, procesos: v })}
              />
              <SelectorMultiple
                etiqueta="Usuario"
                opciones={opciones.usuarios}
                valores={externos.usuarios}
                onCambiar={(v) => setExternos({ ...externos, usuarios: v })}
              />
            </PanelFiltros>
          }
          accionesSeleccion={(marcadas, limpiar) => {
            // Lo ya notificado se cae de la selección antes de cualquier
            // acción en masa: si no, la base rechazaría esas filas a
            // mitad del bucle y el cambio quedaría a medias.
            const ids = marcadas.filter(
              (id) => !lista.some((f) => f.id === id && liquidada(f))
            )
            const fuera = marcadas.length - ids.length
            return (
            <>
              {fuera > 0 && (
                <span className="text-xs font-semibold text-slate-400">
                  {fuera} ya {fuera === 1 ? 'notificada' : 'notificadas'}: no se{' '}
                  {fuera === 1 ? 'toca' : 'tocan'}
                </span>
              )}
              {puedeEditar && ids.length > 0 && (
                <>
                  <select
                    aria-label="Turno en masa"
                    defaultValue=""
                    onChange={(e) => {
                      if (!e.target.value) return
                      editarEnMasa(ids, limpiar, { turno: e.target.value })
                      e.target.value = ''
                    }}
                    className="h-9 rounded-lg border border-brand-300 bg-white px-2 text-sm font-medium text-brand-800 focus:outline-none"
                  >
                    <option value="">Cambiar turno…</option>
                    <option value="DIURNO">Diurno</option>
                    <option value="NOCTURNO">Nocturno</option>
                  </select>
                  <select
                    aria-label="Operador en masa"
                    defaultValue=""
                    onChange={(e) => {
                      if (!e.target.value) return
                      editarEnMasa(ids, limpiar, {
                        operador_id: e.target.value === '__ninguno__' ? null : e.target.value,
                      })
                      e.target.value = ''
                    }}
                    className="h-9 max-w-[190px] rounded-lg border border-brand-300 bg-white px-2 text-sm font-medium text-brand-800 focus:outline-none"
                  >
                    <option value="">Cambiar operador…</option>
                    <option value="__ninguno__">— Sin operador —</option>
                    {operadores.map((o) => (
                      <option key={o.id} value={o.id}>
                        {[o.codigo, o.nombre].filter(Boolean).join(' ')}
                      </option>
                    ))}
                  </select>
                </>
              )}
              {puedeEliminar && ids.length > 0 && (
                <Boton
                  variante="peligro"
                  tamano="sm"
                  disabled={ocupado}
                  onClick={() => eliminar(ids, limpiar)}
                >
                  Eliminar {ids.length}
                </Boton>
              )}
            </>
            )
          }}
        />
      )}

      <div className="flex flex-wrap items-center gap-3 px-1 text-xs text-slate-400">
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-sm bg-amber-100 shadow-[inset_3px_0_0_0_var(--color-amber-500)] ring-1 ring-amber-400" />
          Fila con desfase
        </span>
        <span className="flex items-center gap-1.5">
          <span className="font-bold text-red-600">+n</span> horas trabajadas sin notificar
        </span>
        <span className="flex items-center gap-1.5">
          <span className="font-bold text-violet-600">-n</span> traslape entre registros
        </span>
        {hayContadores && (
          <span className="flex items-center gap-1.5">
            <span className="rounded-sm bg-sky-100 px-1 font-bold text-sky-800 ring-1 ring-sky-400">
              Tablero nuevo
            </span>
            estrena contador: la secuencia arranca ahí
          </span>
        )}
        <span>La fecha se corrige en el ticket, no aquí.</span>
      </div>
    </div>
  )
}

function Comparativo({
  valor,
  inicioContador = false,
}: {
  valor: number | null
  /** La fila estrena tablero: la cadena empieza de cero a propósito. */
  inicioContador?: boolean
}) {
  const tono =
    valor === null
      ? 'text-slate-300'
      : valor === 0
        ? 'text-slate-400'
        : valor > 0
          ? 'text-red-600'
          : 'text-violet-600'
  // Un guion sin explicación se lee como «falta el dato». Estrenar
  // contador y ser la primera jornada del equipo se ven igual y no son lo
  // mismo: el primero es una decisión registrada, el segundo un límite.
  const titulo =
    valor === null
      ? inicioContador
        ? 'Primera jornada con el contador nuevo: la secuencia arranca aquí, sin comparar contra el tablero anterior'
        : 'Primer registro de este equipo'
      : valor > 0
        ? `Faltan ${valor} horas por notificar entre este registro y el anterior`
        : valor < 0
          ? `Traslape de ${Math.abs(valor)} horas con el registro anterior`
          : 'La secuencia calza'

  // Con desfase deja de ser un número de color y pasa a ser una
  // insignia: en una tabla de mil filas, un dígito rojo se pierde.
  if (valor !== null && valor !== 0) {
    return (
      <span
        title={titulo}
        className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-xs font-bold ring-1 ring-inset tabular-nums ${
          valor > 0
            ? 'bg-red-100 text-red-800 ring-red-400'
            : 'bg-violet-100 text-violet-800 ring-violet-400'
        }`}
      >
        {valor > 0 ? `+${valor}` : valor}
      </span>
    )
  }

  if (valor === null && inicioContador) {
    return (
      <span
        title={titulo}
        className="inline-flex items-center rounded-md bg-sky-100 px-1.5 py-0.5 text-xs font-bold text-sky-800 ring-1 ring-inset ring-sky-400"
      >
        Tablero nuevo
      </span>
    )
  }

  return (
    <span className={`font-bold ${tono}`} title={titulo}>
      {valor === null ? '—' : '0'}
    </span>
  )
}
