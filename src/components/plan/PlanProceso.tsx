'use client'

import { Fragment, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Alerta, Boton, Campo, Entrada, Selector, Tarjeta } from '@/components/ui/Primitivos'
import { IconSend } from '@/components/ui/Icons'
import { TablaAvanzada, type ColumnaTabla, type FilaTabla } from '@/components/ui/TablaAvanzada'
import { construirXlsx, descargar, type CeldaHoja } from '@/lib/hojas'
import { formatearFecha } from '@/lib/estados'
import { ImportarPlan } from './ImportarPlan'
import { mensajeDeError } from '@/lib/errores'
import type {
  AvanceRow,
  FilaPlan,
  FilaProveedor,
  FilaProveedorLote,
  LaborDelProceso,
  LineaDiaria,
  Proceso,
  Temporada,
  ZonaRow,
} from './tipos'

const num = new Intl.NumberFormat('es-HN', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})
const ETAPAS = [1, 2, 3] as const

type Pestana = 'avance' | 'diario' | 'proveedor' | 'plan'

export function PlanProceso({
  proceso,
  temporadas,
  temporadaId,
  labores,
  laborId,
  filas,
  avance,
  porZona,
  diario,
  proveedores,
  proveedorLote,
  desde,
  hasta,
  puedeEditar,
  puedeCrear,
  puedeEliminar,
  puedeDescargar,
}: {
  proceso: Proceso
  temporadas: Temporada[]
  temporadaId: string
  labores: LaborDelProceso[]
  laborId: string | null
  filas: FilaPlan[]
  avance: AvanceRow[]
  porZona: ZonaRow[]
  diario: LineaDiaria[]
  proveedores: FilaProveedor[]
  proveedorLote: FilaProveedorLote[]
  desde: string
  hasta: string
  puedeEditar: boolean
  puedeCrear: boolean
  puedeEliminar: boolean
  puedeDescargar: boolean
}) {
  const supabase = createClient()
  const router = useRouter()
  const [pestana, setPestana] = useState<Pestana>('avance')
  const [error, setError] = useState<string | null>(null)
  const [dDesde, setDDesde] = useState(desde)
  const [dHasta, setDHasta] = useState(hasta)
  const [abrirImportar, setAbrirImportar] = useState(false)

  const labor = labores.find((l) => l.labor_id === laborId)

  function navegar(cambios: Record<string, string>) {
    const p = new URLSearchParams({
      temporada: temporadaId,
      desde: dDesde,
      hasta: dHasta,
      ...cambios,
    })
    router.push(`/plan/${proceso.codigo}?${p.toString()}`)
  }

  /* ------------------------- Edición del plan ------------------------ */

  async function guardarPlan(loteTemporadaId: string, cambios: Record<string, unknown>) {
    const fila = filas.find((f) => f.id === loteTemporadaId)
    if (!fila) return

    const nuevo: Record<string, unknown> = {
      etapa: fila.etapa,
      area_plan: fila.area_plan,
      con_moto: fila.con_moto,
      ...cambios,
    }

    // Área en blanco = el lote sale del plan.
    if (nuevo.area_plan === null || nuevo.area_plan === undefined || nuevo.area_plan === '') {
      if (fila.plan_id) {
        const { error: e } = await supabase.from('planes').delete().eq('id', fila.plan_id)
        if (e) throw new Error(e.message)
      }
      return
    }

    const cuerpo = {
      temporada_id: temporadaId,
      lote_temporada_id: loteTemporadaId,
      proceso_id: proceso.id,
      etapa: Number(nuevo.etapa ?? 1),
      area_plan: Number(nuevo.area_plan),
      con_moto: (nuevo.con_moto as boolean | null) ?? null,
    }

    const { error: e } = fila.plan_id
      ? await supabase.from('planes').update(cuerpo).eq('id', fila.plan_id)
      : await supabase.from('planes').insert(cuerpo)
    if (e) throw new Error(e.message)
  }

  async function editarCelda(id: string, key: string, valor: unknown) {
    try {
      setError(null)
      await guardarPlan(id, { [key]: valor })
      router.refresh()
    } catch (e) {
      setError(mensajeDeError(e, 'No se pudo guardar el plan.'))
    }
  }

  async function editarMasivo(ids: string[], cambios: Record<string, unknown>) {
    setError(null)
    for (const id of ids) await guardarPlan(id, cambios)
    router.refresh()
  }

  async function quitarDelPlan(ids: string[]) {
    const planIds = filas.filter((f) => ids.includes(f.id) && f.plan_id).map((f) => f.plan_id!)
    if (planIds.length === 0) return
    const { error: e } = await supabase.from('planes').delete().in('id', planIds)
    if (e) throw new Error(e.message)
    router.refresh()
  }

  const columnasPlan: ColumnaTabla[] = useMemo(
    () => [
      {
        key: 'ut',
        label: 'UT',
        render: (f) => (
          <div className="min-w-0">
            <p className="font-semibold text-slate-800">{String(f.ut)}</p>
            {f.nombre ? <p className="text-xs text-slate-400">{String(f.nombre)}</p> : null}
          </div>
        ),
      },
      { key: 'zona', label: 'Zona', tipo: 'texto' },
      { key: 'area_bruta', label: 'Á. bruta', tipo: 'numero', alinear: 'derecha' },
      { key: 'area_neta', label: 'Á. neta', tipo: 'numero', alinear: 'derecha' },
      {
        key: 'etapa',
        label: 'Etapa',
        tipo: 'seleccion',
        editable: puedeEditar,
        opciones: ETAPAS.map((e) => ({ value: String(e), label: `Etapa ${e}` })),
      },
      {
        key: 'area_plan',
        label: 'Á. planificada',
        tipo: 'numero',
        editable: puedeEditar,
        alinear: 'derecha',
      },
      { key: 'con_moto', label: 'Con moto', tipo: 'booleano', editable: puedeEditar },
    ],
    [puedeEditar]
  )

  const totalPlan = filas.reduce((a, f) => a + Number(f.area_plan ?? 0), 0)
  const conPlan = filas.filter((f) => f.area_plan !== null).length

  /* --------------------------- Vista general ------------------------- */

  // `fn_plan_avance_lote` devuelve `lote_temporada_id`, no `id`. La tabla
  // genérica necesita `id` para las keys de React, así que se le agrega
  // aquí; sin esto React se queda sin key y avisa por consola.
  const avanceFilas = useMemo(
    () => avance.map((r) => ({ ...r, id: r.lote_temporada_id })) as unknown as FilaTabla[],
    [avance]
  )

  const totales = useMemo(() => {
    const plan = avance.reduce((a, r) => a + Number(r.area_plan ?? 0), 0)
    const hecho = avance.reduce((a, r) => a + Number(r.mz_avance ?? 0), 0)
    const pend = avance.reduce((a, r) => a + Number(r.mz_pendiente ?? 0), 0)
    return { plan, hecho, pend, pct: plan > 0 ? (hecho / plan) * 100 : null }
  }, [avance])

  const porEtapa = useMemo(() => {
    const mapa = new Map<number, { plan: number; hecho: number }>()
    for (const r of porZona) {
      if (r.etapa === null) continue
      const g = mapa.get(r.etapa) ?? { plan: 0, hecho: 0 }
      g.plan += Number(r.area_plan)
      g.hecho += Number(r.mz_avance)
      mapa.set(r.etapa, g)
    }
    return [...mapa.entries()].sort((a, b) => a[0] - b[0])
  }, [porZona])

  const zonasAgrupadas = useMemo(() => {
    const mapa = new Map<string, { encargado: string | null; filas: ZonaRow[] }>()
    for (const r of porZona) {
      const clave = r.zona ?? '(sin zona)'
      const g = mapa.get(clave) ?? { encargado: r.encargado, filas: [] }
      g.filas.push(r)
      mapa.set(clave, g)
    }
    return [...mapa.entries()].sort((a, b) => a[0].localeCompare(b[0], 'es', { numeric: true }))
  }, [porZona])

  const diarioPorFecha = useMemo(() => {
    const mapa = new Map<string, LineaDiaria[]>()
    for (const l of diario) {
      const lista = mapa.get(l.fecha) ?? []
      lista.push(l)
      mapa.set(l.fecha, lista)
    }
    return [...mapa.entries()].sort((a, b) => b[0].localeCompare(a[0]))
  }, [diario])

  const totalDiario = diario.reduce((a, l) => a + Number(l.avance_mz ?? 0), 0)
  const totalProveedor = proveedores.reduce((a, p) => a + Number(p.mz ?? 0), 0)

  /* ---------------------------- Excel ------------------------------- */

  function exportarAvance() {
    const filasXlsx: CeldaHoja[][] = [
      ['Elemento PEP', 'UT', 'Nomenclatura', 'Zona', 'Encargado', 'Area Bruta', 'Area Neta',
       'Etapa', 'Area Planificada', 'Area Ejecutada', 'Area Pendiente', '% Avance', 'Motos',
       'Prov. Plastico', 'Prov. Manguera', 'Fecha Inicio'],
      ...avance.map(
        (r) =>
          [
            r.elemento_pep, r.ut, r.nomenclatura ?? '', r.zona ?? '', r.encargado ?? '',
            r.area_bruta ?? '', r.area_neta ?? '', r.etapa_plan ?? '', r.area_plan ?? '',
            r.mz_avance, r.mz_pendiente, r.pct_avance ?? '',
            r.uso_moto === null ? 'N/E' : r.uso_moto ? 'Con Moto' : 'Sin Moto',
            r.proveedor_plastico ?? '', r.proveedor_manguera ?? '', r.fecha_inicio ?? '',
          ] as CeldaHoja[]
      ),
    ]
    descargar(
      construirXlsx('Resumen por lote', filasXlsx),
      `resumen-emplasticado-${proceso.codigo}.xlsx`
    )
  }

  function exportarDiario() {
    // Sin columna «Labor»: todas las filas son de la misma.
    const filasXlsx: CeldaHoja[][] = [
      ['Fecha', 'UT', 'Nomenclatura', 'Zona', 'Etapa', 'Tarea', 'Equipo', 'Operador',
       'Prov. Plastico', 'Prov. Manguera', 'Avance Mz', 'Ticket', 'Capturo'],
      ...diario.map(
        (l) =>
          [
            l.fecha, l.ut, l.nomenclatura ?? '', l.zona ?? '', l.etapa ?? '',
            l.tarea_codigo ?? '', l.equipo_codigo, l.operador_nombre ?? '',
            l.proveedor_plastico ?? '', l.proveedor_manguera ?? '', l.avance_mz, l.ticket_codigo,
            l.usuario_nombre ?? '',
          ] as CeldaHoja[]
      ),
    ]
    descargar(construirXlsx('Avance diario', filasXlsx), `avance-diario-${desde}-a-${hasta}.xlsx`)
  }

  function exportarProveedores() {
    const filasXlsx: CeldaHoja[][] = [
      ['UT', 'Nomenclatura', 'Zona', 'Prov. Plastico', 'Prov. Manguera', 'Mz', 'Ultima fecha'],
      ...proveedorLote.map(
        (r) =>
          [
            r.ut, r.nomenclatura ?? '', r.zona ?? '', r.proveedor_plastico,
            r.proveedor_manguera, r.mz, r.fecha ?? '',
          ] as CeldaHoja[]
      ),
    ]
    descargar(
      construirXlsx('Area por proveedor', filasXlsx),
      `area-por-proveedor-${proceso.codigo}.xlsx`
    )
  }

  /* ----------------------------- Render ------------------------------ */

  return (
    <div className="flex flex-col gap-4">
      {/* ----------------------------- Temporada -------------------------- */}
      {/* Este módulo es SÓLO de emplasticado: no hay selector de labor, ni
          columnas ni métricas de otras labores. La labor la decide la
          bandera «Seguimiento de emplasticado» del catálogo. */}
      <Tarjeta className="p-4">
        <div className="flex flex-wrap items-end gap-3">
          <Campo etiqueta="Temporada" className="min-w-[150px] flex-1">
            <Selector value={temporadaId} onChange={(e) => navegar({ temporada: e.target.value })}>
              {temporadas.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.nombre}
                  {t.activa ? ' (activa)' : ''}
                </option>
              ))}
            </Selector>
          </Campo>

          {labor && (
            <div className="min-w-[180px] flex-1">
              <p className="text-[11px] font-medium text-slate-400">Labor</p>
              <p className="mt-1 text-sm font-semibold text-slate-800">{labor.labor_nombre}</p>
            </div>
          )}
        </div>

        <p className="mt-3 border-t border-slate-100 pt-3 text-xs text-slate-400">
          <strong className="text-slate-600">
            {proceso.codigo} · {proceso.nombre}
          </strong>
          {proceso.momento ? ` · ${proceso.momento}` : ''}
          {proceso.descripcion ? ` — ${proceso.descripcion}` : ''}
        </p>
      </Tarjeta>

      {error && <Alerta>{error}</Alerta>}

      {!laborId && (
        <Alerta tono="ambar">
          No hay ninguna labor marcada como «Seguimiento de emplasticado» con avance en{' '}
          {proceso.codigo}. Márcala en Catálogos → Labores y revisa que sus tareas SAP tengan
          proceso asignado: sin eso el avance no entra en el plan.
        </Alerta>
      )}

      <div className="flex justify-end">
        <Link
          href={`/plan/${proceso.codigo}/reporte?temporada=${temporadaId}`}
          className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2 text-sm font-semibold text-white transition-colors hover:bg-slate-800"
        >
          Ver reporte para gerencia
        </Link>
      </div>

      {/* ------------------------------ Totales --------------------------- */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metrica etiqueta="Planificado" valor={`${num.format(totales.plan)} mz`} />
        <Metrica etiqueta="Ejecutado" valor={`${num.format(totales.hecho)} mz`} destacado />
        <Metrica etiqueta="Pendiente" valor={`${num.format(totales.pend)} mz`} />
        <Metrica
          etiqueta="% Avance"
          valor={totales.pct !== null ? `${totales.pct.toFixed(1)}%` : '—'}
          destacado
        />
      </div>

      {/* ------------------------------ Pestañas -------------------------- */}
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {(
          [
            ['avance', 'Plan vs avance'],
            ['diario', 'Avance diario'],
            ['proveedor', 'Por proveedor'],
            ['plan', 'Editar el plan'],
          ] as const
        ).map(([valor, etiqueta]) => (
          <button
            key={valor}
            onClick={() => setPestana(valor)}
            className={`shrink-0 rounded-full px-3.5 py-2 text-sm font-semibold transition-all ${
              pestana === valor
                ? 'bg-brand-700 text-white shadow-[var(--shadow-raised)]'
                : 'bg-white text-slate-500 ring-1 ring-inset ring-slate-200 hover:text-slate-900'
            }`}
          >
            {etiqueta}
          </button>
        ))}
      </div>

      {/* ============================ PLAN VS AVANCE ====================== */}
      {pestana === 'avance' && (
        <div className="flex flex-col gap-4">
          {totales.plan === 0 && (
            <Alerta tono="ambar">
              Todavía no hay plan cargado para {proceso.nombre.toLowerCase()}. Ve a «Editar el
              plan» e impórtalo desde Excel.
            </Alerta>
          )}

          {zonasAgrupadas.length > 0 && (
            <Tarjeta>
              <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
                <h2 className="text-sm font-semibold text-slate-900">Avance por zona y etapa</h2>
                {puedeDescargar && (
                  <Boton variante="secundario" tamano="sm" onClick={exportarAvance}>
                    <IconSend className="h-4 w-4" />
                    Exportar
                  </Boton>
                )}
              </div>
              <div className="scroll-suave overflow-x-auto">
                <table className="w-full min-w-[560px] text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 bg-slate-50/60 text-left text-[11px] font-bold uppercase tracking-wide text-slate-500">
                      <th className="px-3 py-2">Encargado</th>
                      <th className="px-3 py-2">Zona</th>
                      <th className="px-3 py-2">Etapa</th>
                      <th className="px-3 py-2 text-right">Plan</th>
                      <th className="px-3 py-2 text-right">Avance</th>
                      <th className="px-3 py-2 text-right">%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {zonasAgrupadas.map(([zona, g]) => {
                      const sPlan = g.filas.reduce((a, r) => a + Number(r.area_plan), 0)
                      const sHecho = g.filas.reduce((a, r) => a + Number(r.mz_avance), 0)
                      return (
                        <Fragment key={zona}>
                          {g.filas.map((r, i) => (
                            <tr key={`${zona}-${r.etapa}`} className="border-b border-slate-50">
                              <td className="px-3 py-1.5 text-slate-600">
                                {i === 0 ? (g.encargado ?? '—') : ''}
                              </td>
                              <td className="px-3 py-1.5 font-semibold text-slate-700">
                                {i === 0 ? zona : ''}
                              </td>
                              <td className="px-3 py-1.5 text-slate-500">Etapa {r.etapa}</td>
                              <td className="px-3 py-1.5 text-right tabular-nums text-slate-600">
                                {num.format(Number(r.area_plan))}
                              </td>
                              <td className="px-3 py-1.5 text-right tabular-nums text-slate-800">
                                {num.format(Number(r.mz_avance))}
                              </td>
                              <td className="px-3 py-1.5 text-right tabular-nums">
                                <Porcentaje valor={r.pct_avance} />
                              </td>
                            </tr>
                          ))}
                          <tr className="border-b-2 border-slate-200 bg-slate-50/70 font-bold">
                            <td className="px-3 py-1.5" />
                            <td className="px-3 py-1.5 text-slate-700">Total {zona}</td>
                            <td className="px-3 py-1.5" />
                            <td className="px-3 py-1.5 text-right tabular-nums">
                              {num.format(sPlan)}
                            </td>
                            <td className="px-3 py-1.5 text-right tabular-nums">
                              {num.format(sHecho)}
                            </td>
                            <td className="px-3 py-1.5 text-right tabular-nums">
                              <Porcentaje
                                valor={sPlan > 0 && laborId ? (sHecho / sPlan) * 100 : null}
                              />
                            </td>
                          </tr>
                        </Fragment>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </Tarjeta>
          )}

          {porEtapa.length > 0 && (
            <Tarjeta>
              <div className="border-b border-slate-100 px-4 py-3">
                <h2 className="text-sm font-semibold text-slate-900">Avance por etapa</h2>
              </div>
              <div className="divide-y divide-slate-50">
                {porEtapa.map(([etapa, g]) => {
                  const pct = g.plan > 0 ? (g.hecho / g.plan) * 100 : 0
                  return (
                    <div key={etapa} className="px-4 py-3">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm font-semibold text-slate-800">Etapa {etapa}</p>
                        <p className="text-sm tabular-nums text-slate-500">
                          {num.format(g.hecho)} / {num.format(g.plan)} mz
                          <span className="ml-2 font-bold text-slate-900">{pct.toFixed(1)}%</span>
                        </p>
                      </div>
                      <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-slate-100">
                        <div
                          className={`h-full rounded-full ${
                            pct >= 99 ? 'bg-emerald-500' : pct >= 50 ? 'bg-brand-600' : 'bg-amber-500'
                          }`}
                          style={{ width: `${Math.min(pct, 100)}%` }}
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            </Tarjeta>
          )}

          <TablaAvanzada
            titulo={`Resumen ${proceso.codigo}`}
            minAncho="900px"
            seleccionable={false}
            permisos={{ editar: false, eliminar: false, descargar: puedeDescargar }}
            vacio={{
              titulo: 'Sin lotes planificados ni trabajados',
              descripcion: 'Carga el plan en la pestaña «Editar el plan».',
            }}
            filas={avanceFilas}
            columnas={[
              { key: 'ut', label: 'UT' },
              { key: 'nomenclatura', label: 'Nomenclatura' },
              { key: 'zona', label: 'Zona' },
              { key: 'etapa_plan', label: 'Etapa', tipo: 'numero', alinear: 'derecha' },
              { key: 'area_plan', label: 'Planificada', tipo: 'numero', alinear: 'derecha' },
              { key: 'mz_avance', label: 'Ejecutada', tipo: 'numero', alinear: 'derecha' },
              { key: 'mz_pendiente', label: 'Pendiente', tipo: 'numero', alinear: 'derecha' },
              {
                key: 'pct_avance',
                label: '% Avance',
                tipo: 'numero',
                alinear: 'derecha',
                render: (f) => <Porcentaje valor={f.pct_avance as number | null} />,
              },
              {
                key: 'proveedor_plastico',
                label: 'Prov. plástico',
                render: (f) => (
                  <span className="text-xs text-slate-500">
                    {(f.proveedor_plastico as string | null) ?? '—'}
                  </span>
                ),
              },
              {
                key: 'fecha_inicio',
                label: 'Inicio',
                render: (f) =>
                  f.fecha_inicio ? (
                    <span className="whitespace-nowrap text-slate-500">
                      {formatearFecha(String(f.fecha_inicio))}
                    </span>
                  ) : (
                    <span className="text-slate-300">—</span>
                  ),
              },
            ]}
          />
        </div>
      )}

      {/* ============================ AVANCE DIARIO ======================= */}
      {pestana === 'diario' && (
        <div className="flex flex-col gap-4">
          <Tarjeta className="p-4">
            <div className="flex flex-wrap items-end gap-3">
              <Campo etiqueta="Desde" className="min-w-[140px] flex-1">
                <Entrada type="date" value={dDesde} onChange={(e) => setDDesde(e.target.value)} />
              </Campo>
              <Campo etiqueta="Hasta" className="min-w-[140px] flex-1">
                <Entrada type="date" value={dHasta} onChange={(e) => setDHasta(e.target.value)} />
              </Campo>
              <Boton onClick={() => navegar({ desde: dDesde, hasta: dHasta })}>Consultar</Boton>
              {puedeDescargar && (
                <Boton variante="secundario" onClick={exportarDiario} disabled={diario.length === 0}>
                  <IconSend className="h-4 w-4" />
                  Exportar
                </Boton>
              )}
            </div>
          </Tarjeta>

          <div className="grid grid-cols-2 gap-3">
            <Metrica
              etiqueta="Avance del período"
              valor={`${num.format(totalDiario)} mz`}
              destacado
            />
            <Metrica etiqueta="Días con registro" valor={String(diarioPorFecha.length)} />
          </div>

          {diarioPorFecha.length === 0 ? (
            <Tarjeta className="px-4 py-10 text-center text-sm text-slate-400">
              No hay avance de {proceso.codigo} registrado en este rango.
            </Tarjeta>
          ) : (
            diarioPorFecha.map(([fecha, lineas]) => {
              const total = lineas.reduce((a, l) => a + Number(l.avance_mz ?? 0), 0)
              return (
                <Tarjeta key={fecha}>
                  <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
                    <p className="text-sm font-bold text-slate-800">{formatearFecha(fecha)}</p>
                    <p className="text-sm font-bold tabular-nums text-brand-700">
                      {num.format(total)} mz
                    </p>
                  </div>
                  <div className="scroll-suave overflow-x-auto">
                    <table className="w-full min-w-[680px] text-sm">
                      <thead>
                        <tr className="text-left text-[11px] font-bold uppercase tracking-wide text-slate-400">
                          <th className="px-3 py-2">UT</th>
                          <th className="px-3 py-2">Nomenclatura</th>
                          <th className="px-3 py-2">Zona</th>
                          <th className="px-3 py-2">Tarea</th>
                          <th className="px-3 py-2">Proveedores</th>
                          <th className="px-3 py-2 text-right">Avance</th>
                        </tr>
                      </thead>
                      <tbody>
                        {lineas.map((l) => (
                          <tr key={l.detalle_id} className="border-t border-slate-50">
                            <td className="px-3 py-1.5 font-semibold text-slate-700">{l.ut}</td>
                            <td className="px-3 py-1.5 text-slate-600">{l.nomenclatura ?? '—'}</td>
                            <td className="px-3 py-1.5 text-slate-500">{l.zona ?? '—'}</td>
                            <td className="px-3 py-1.5 text-slate-500">{l.tarea_codigo ?? '—'}</td>
                            <td className="max-w-[200px] px-3 py-1.5 text-xs text-slate-400">
                              {[l.proveedor_plastico, l.proveedor_manguera]
                                .filter(Boolean)
                                .join(' · ') || '—'}
                            </td>
                            <td className="px-3 py-1.5 text-right font-bold tabular-nums text-slate-900">
                              {num.format(Number(l.avance_mz))}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Tarjeta>
              )
            })
          )}
        </div>
      )}

      {/* ============================ POR PROVEEDOR ======================= */}
      {pestana === 'proveedor' && (
        <div className="flex flex-col gap-4">
          <Alerta tono="azul">
            Cuando un lote lleva dos o tres proveedores, el digitador captura una línea por
            proveedor con su área. Aquí se ve cuánto hizo cada uno.
          </Alerta>

          <div className="flex items-center justify-between">
            <Metrica etiqueta="Total repartido" valor={`${num.format(totalProveedor)} mz`} destacado />
            {puedeDescargar && (
              <Boton
                variante="secundario"
                tamano="sm"
                onClick={exportarProveedores}
                disabled={proveedorLote.length === 0}
              >
                <IconSend className="h-4 w-4" />
                Exportar
              </Boton>
            )}
          </div>

          {proveedores.length === 0 ? (
            <Tarjeta className="px-4 py-10 text-center text-sm text-slate-400">
              Todavía no hay área capturada con proveedor. Se registra al capturar la labor, en la
              línea de cada lote.
            </Tarjeta>
          ) : (
            <>
              <Tarjeta>
                <div className="border-b border-slate-100 px-4 py-3">
                  <h2 className="text-sm font-semibold text-slate-900">Área por proveedor</h2>
                </div>
                <div className="scroll-suave overflow-x-auto">
                  <table className="w-full min-w-[620px] text-sm">
                    <thead>
                      <tr className="border-b border-slate-100 bg-slate-50/60 text-left text-[11px] font-bold uppercase tracking-wide text-slate-500">
                        <th className="px-3 py-2">Plástico</th>
                        <th className="px-3 py-2">Manguera</th>
                        <th className="px-3 py-2 text-right">Mz</th>
                        <th className="px-3 py-2 text-right">% del total</th>
                        <th className="px-3 py-2 text-right">Lotes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {proveedores.map((p, i) => {
                        const pct =
                          totalProveedor > 0 ? (Number(p.mz) / totalProveedor) * 100 : 0
                        return (
                          <tr
                            key={`${p.proveedor_plastico}-${p.proveedor_manguera}-${i}`}
                            className="border-b border-slate-50 last:border-0"
                          >
                            <td className="px-3 py-2 font-semibold text-slate-700">
                              {p.proveedor_plastico}
                            </td>
                            <td className="px-3 py-2 text-slate-600">{p.proveedor_manguera}</td>
                            <td className="px-3 py-2 text-right font-bold tabular-nums text-slate-900">
                              {num.format(Number(p.mz))}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums text-slate-500">
                              {pct.toFixed(1)}%
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums text-slate-500">
                              {p.lotes}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </Tarjeta>

              <TablaAvanzada
                titulo={`Proveedor por lote ${proceso.codigo}`}
                minAncho="720px"
                seleccionable={false}
                permisos={{ editar: false, eliminar: false, descargar: puedeDescargar }}
                filas={
                  proveedorLote.map((r, i) => ({
                    ...r,
                    // Estas filas vienen agregadas, no tienen id propio: se
                    // arma uno estable con lo que las identifica.
                    id: `${r.ut}|${r.proveedor_plastico}|${r.proveedor_manguera}|${i}`,
                  })) as unknown as FilaTabla[]
                }
                columnas={[
                  { key: 'ut', label: 'UT' },
                  { key: 'nomenclatura', label: 'Nomenclatura' },
                  { key: 'zona', label: 'Zona' },
                  { key: 'proveedor_plastico', label: 'Plástico' },
                  { key: 'proveedor_manguera', label: 'Manguera' },
                  { key: 'mz', label: 'Mz', tipo: 'numero', alinear: 'derecha' },
                ]}
              />
            </>
          )}
        </div>
      )}

      {/* ============================= EDITAR PLAN ======================== */}
      {pestana === 'plan' && (
        <div className="flex flex-col gap-3">
          <Alerta tono="azul">
            Escribe las manzanas que se van a emplasticar en cada lote. Es un número aparte del
            área neta: el área neta es el lote físico, esto es lo que de verdad se va a emplasticar.
            Deja el área en blanco para sacar un lote del plan.
          </Alerta>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            <Metrica etiqueta="Lotes en el plan" valor={`${conPlan} de ${filas.length}`} />
            <Metrica etiqueta="Total planificado" valor={`${num.format(totalPlan)} mz`} destacado />
            <Metrica
              etiqueta="Área neta total"
              valor={`${num.format(filas.reduce((a, f) => a + Number(f.area_neta ?? 0), 0))} mz`}
            />
          </div>

          <TablaAvanzada
            titulo={`Plan ${proceso.codigo}`}
            minAncho="820px"
            columnas={columnasPlan}
            filas={filas as unknown as FilaTabla[]}
            permisos={{
              editar: puedeEditar,
              eliminar: puedeEliminar,
              descargar: puedeDescargar,
            }}
            vacio={{
              titulo: 'La temporada no tiene lotes',
              descripcion: 'Asígnalos primero en Catálogos → Lotes.',
            }}
            onEditarCelda={puedeEditar ? editarCelda : undefined}
            onEditarMasivo={puedeEditar || puedeCrear ? editarMasivo : undefined}
            onEliminar={puedeEliminar ? quitarDelPlan : undefined}
            acciones={
              (puedeCrear || puedeEditar) && (
                <Boton tamano="sm" onClick={() => setAbrirImportar(true)}>
                  Importar
                </Boton>
              )
            }
          />

          <p className="px-1 text-xs text-slate-400">
            Con «Cambiar en masa» puedes poner la misma etapa a todos los lotes de una zona: filtra
            por zona en el encabezado, selecciona todo y cambia el campo Etapa de una sola vez.
            «Eliminar» saca del plan los lotes seleccionados; el lote sigue existiendo, lo que se
            elimina es su línea de plan.
          </p>
        </div>
      )}

      <ImportarPlan
        abierto={abrirImportar}
        onCerrar={() => setAbrirImportar(false)}
        temporadaId={temporadaId}
        proceso={proceso}
        filas={filas}
      />
    </div>
  )
}

/* ------------------------------------------------------------------ */

function Porcentaje({ valor }: { valor: number | null }) {
  if (valor === null || valor === undefined) return <span className="text-slate-300">—</span>
  const v = Number(valor)
  const tono =
    v >= 99
      ? 'bg-emerald-100 text-emerald-800'
      : v >= 50
        ? 'bg-brand-50 text-brand-800'
        : 'bg-amber-100 text-amber-800'
  return (
    <span className={`rounded px-1.5 py-0.5 text-xs font-bold tabular-nums ${tono}`}>
      {v.toFixed(0)}%
    </span>
  )
}

function Metrica({
  etiqueta,
  valor,
  destacado = false,
}: {
  etiqueta: string
  valor: string
  destacado?: boolean
}) {
  return (
    <div className="rounded-xl border border-slate-200/80 bg-white px-3.5 py-3 shadow-[var(--shadow-card)]">
      <p className="text-[11px] font-medium text-slate-400">{etiqueta}</p>
      <p
        className={`mt-0.5 text-lg font-bold tracking-tight tabular-nums ${
          destacado ? 'text-brand-800' : 'text-slate-900'
        }`}
      >
        {valor}
      </p>
    </div>
  )
}
