import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { getPermisos, puede } from '@/lib/auth'
import { Alerta } from '@/components/ui/Primitivos'
import { IconChevronLeft } from '@/components/ui/Icons'
import { BotonImprimir } from '@/components/plan/BotonImprimir'
import { Porcentaje } from '@/components/trasplante/Porcentaje'
import {
  Barra,
  Bloque,
  CLASE_FILA,
  CLASE_SUBTOTAL,
  CORP,
  Dato,
  ESTILO_FILA,
  ESTILO_SUBTOTAL,
  Encabezado,
  IMPRESION_REPORTE,
  Kpi,
  Membrete,
  PieOndas,
  TotalGeneral,
} from '@/components/reporte/Corporativo'
import type { AvanceRow, LaborDelProceso, Proceso, ZonaRow } from '@/components/plan/tipos'
import { hoyIso as hoyEnHonduras, instanteDeFecha, ZONA } from '@/lib/fechas'

/**
 * Una fila del avance diario: UN lote en UN día, con el desglose de
 * proveedores ya armado. Lo agrupa la base (`fn_avance_diario_emplasticado`)
 * porque un lote puede llevar varios rollos el mismo día y él lee el
 * reporte por lote, no por línea de captura.
 */
type FilaDiaria = {
  fecha: string
  lote_temporada_id: string
  ut: string
  nomenclatura: string | null
  zona: string | null
  encargado: string | null
  proveedores: string | null
  lineas: number
  avance_mz: number
}

/** Lo que devuelve la vista cruda, para el respaldo sin migración 21. */
type LineaCruda = {
  fecha: string
  lote_temporada_id: string
  ut: string
  nomenclatura: string | null
  zona: string | null
  encargado: string | null
  avance_mz: number
  proveedor_plastico: string | null
  proveedor_manguera: string | null
}

const num = new Intl.NumberFormat('es-HN', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

function fechaLarga(iso: string) {
  return instanteDeFecha(iso).toLocaleDateString('es-HN', {
    timeZone: ZONA,
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  })
}

function fechaCorta(iso: string) {
  return instanteDeFecha(iso).toLocaleDateString('es-HN', {
    timeZone: ZONA,
    day: '2-digit',
    month: 'short',
  })
}

const ES_FECHA = /^\d{4}-\d{2}-\d{2}$/

/** Permiso de pantalla que corresponde a cada proceso. */
const PANTALLA: Record<string, string> = {
  APS: 'plan_aps',
}

/*
 * Identidad visual: gemelo del reporte de Trasplante (guía Agrolíbano).
 * Las piezas —membrete, tarjetas, encabezado verde, pie con ondas— vienen
 * de `components/reporte/Corporativo`; el azul #1f3864 del Excel viejo
 * quedó retirado.
 */

export default async function ReportePage({
  params: rutaParams,
  searchParams,
}: {
  params: Promise<{ proceso: string }>
  searchParams: Promise<{
    temporada?: string
    desde?: string
    hasta?: string
  }>
}) {
  const [{ proceso: codigoProceso }, params] = await Promise.all([rutaParams, searchParams])
  const codigo = codigoProceso.toUpperCase()
  const pantalla = PANTALLA[codigo] ?? 'plan'
  const supabase = await createClient()
  const permisos = await getPermisos()

  if (!puede(permisos, pantalla, 'ver') && !puede(permisos, 'plan', 'ver')) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <Alerta tono="ambar">No tienes acceso al plan de mecanización.</Alerta>
      </div>
    )
  }

  const [{ data: temporadas }, { data: procesoData }] = await Promise.all([
    supabase
      .from('temporadas')
      .select('id, nombre, activa, fecha_inicio, fecha_fin')
      .order('fecha_inicio', { ascending: false }),
    supabase
      .from('procesos_sap')
      .select('id, codigo, nombre, descripcion, momento')
      .eq('codigo', codigo)
      .maybeSingle(),
  ])

  type T = {
    id: string
    nombre: string
    activa: boolean
    fecha_inicio: string | null
    fecha_fin: string | null
  }
  const lt = (temporadas as T[] | null) ?? []
  const proceso = procesoData as Proceso | null

  const temporada = lt.find((t) => t.id === params.temporada) ?? lt.find((t) => t.activa) ?? lt[0]

  if (!temporada || !proceso) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <Alerta tono="ambar">
          {!proceso
            ? 'Ese proceso no existe. Si falta el catálogo, corre la migración 13.'
            : 'Falta crear la temporada.'}
        </Alerta>
      </div>
    )
  }

  // La labor del reporte ya no se elige: el plan y las etapas son sólo
  // del emplasticado, así que se toma la que lleva la bandera del
  // catálogo. Si ninguna la tiene (migración 21 sin correr) se usa la de
  // más manzanas, que es lo que hacía antes el valor por defecto.
  const { data: laboresData } = await supabase.rpc('fn_labores_del_proceso', {
    p_temporada_id: temporada.id,
    p_proceso_id: proceso.id,
  })
  const labores = (laboresData as LaborDelProceso[] | null) ?? []
  const labor = labores.find((l) => l.seguimiento) ?? labores[0] ?? null

  /* ----------------------- Fechas del reporte ------------------------ */
  //
  // «El reporte debe calcular la información acumulada desde el inicio de
  //  la temporada seleccionada hasta las fechas del filtro.»
  //
  // Así que hay dos ventanas distintas y conviene no confundirlas:
  //   · los totales, las zonas, las etapas y los lotes ejecutados se
  //     acumulan desde que arrancó la temporada hasta `hasta`;
  //   · la tabla de avance diario es sólo del rango `desde`–`hasta`.
  //
  // `hasta` es además el corte: el reporte dice lo que decía ESE día, no
  // lo que dice hoy. Sin eso, reimprimir el correo del martes daría
  // números distintos a los que se enviaron el martes.
  const hoyIso = hoyEnHonduras()
  const hasta = params.hasta && ES_FECHA.test(params.hasta) ? params.hasta : hoyIso
  const desdePedido = params.desde && ES_FECHA.test(params.desde) ? params.desde : hasta
  const desde = desdePedido > hasta ? hasta : desdePedido
  const esRango = desde !== hasta

  const [{ data: avance }, { data: porZona }, diariaRpc] = await Promise.all([
    supabase.rpc('fn_plan_avance_lote', {
      p_temporada_id: temporada.id,
      p_proceso_id: proceso.id,
      p_labor_id: labor?.labor_id ?? null,
      p_hasta: hasta,
    }),
    supabase.rpc('fn_avance_por_zona_etapa', {
      p_temporada_id: temporada.id,
      p_proceso_id: proceso.id,
      p_labor_id: labor?.labor_id ?? null,
      p_hasta: hasta,
    }),
    supabase.rpc('fn_avance_diario_emplasticado', {
      p_temporada_id: temporada.id,
      p_labor_id: labor?.labor_id ?? null,
      p_desde: desde,
      p_hasta: hasta,
    }),
  ])

  // Respaldo mientras la migración 21 no esté corrida: se leen las líneas
  // sueltas de la vista y se agrupan aquí igual que las agruparía la
  // función. El reporte sale bien de todos modos; sólo se hace en la
  // pantalla lo que debería hacer la base.
  let lineas = (diariaRpc.data as FilaDiaria[] | null) ?? []
  if (diariaRpc.error) {
    const { data: crudas } = await supabase
      .from('v_avance_diario')
      .select(
        'fecha, lote_temporada_id, ut, nomenclatura, zona, encargado, avance_mz, proveedor_plastico, proveedor_manguera',
      )
      .eq('temporada_id', temporada.id)
      .eq('proceso_id', proceso.id)
      .eq('labor_id', labor?.labor_id ?? '')
      .gte('fecha', desde)
      .lte('fecha', hasta)
    lineas = agrupar((crudas as LineaCruda[] | null) ?? [])
  }

  const lotes = (avance as AvanceRow[] | null) ?? []
  const zonas = (porZona as ZonaRow[] | null) ?? []

  /* ------------------------------ Números ----------------------------- */

  const plan = lotes.reduce((a, r) => a + Number(r.area_plan ?? 0), 0)
  const hecho = lotes.reduce((a, r) => a + Number(r.mz_avance ?? 0), 0)
  const pendiente = Math.max(plan - hecho, 0)
  const pct = plan > 0 ? (hecho / plan) * 100 : 0

  const porEtapa = new Map<number, { plan: number; hecho: number }>()
  for (const z of zonas) {
    if (z.etapa === null) continue
    const g = porEtapa.get(z.etapa) ?? { plan: 0, hecho: 0 }
    g.plan += Number(z.area_plan)
    g.hecho += Number(z.mz_avance)
    porEtapa.set(z.etapa, g)
  }

  // Se muestra lo que se hizo, no lo que falta. Un lote entra si tiene
  // manzanas registradas al corte; los que no se han tocado se cuentan en
  // una línea y ya, para no perder la referencia de cuántos son.
  const ejecutados = lotes
    .filter((r) => Number(r.mz_avance ?? 0) > 0.009)
    .sort((a, b) => Number(b.mz_avance) - Number(a.mz_avance))
  const sinTocar = lotes.length - ejecutados.length

  const porFecha = new Map<string, FilaDiaria[]>()
  for (const l of lineas) {
    porFecha.set(l.fecha, [...(porFecha.get(l.fecha) ?? []), l])
  }
  const dias = [...porFecha.entries()].sort((a, b) => b[0].localeCompare(a[0]))

  const zonasAgrupadas = new Map<string, ZonaRow[]>()
  for (const z of zonas) {
    const clave = z.zona ?? '(sin zona)'
    zonasAgrupadas.set(clave, [...(zonasAgrupadas.get(clave) ?? []), z])
  }

  const totalDiario = lineas.reduce((a, l) => a + Number(l.avance_mz ?? 0), 0)

  const etapas = [...porEtapa.entries()].sort((a, b) => a[0] - b[0])
  const zonasOrdenadas = [...zonasAgrupadas.entries()].sort((a, b) =>
    a[0].localeCompare(b[0], 'es', { numeric: true }),
  )
  const pctNum = (v: number | string | null | undefined) =>
    v === null || v === undefined ? null : Number(v)

  return (
    <div className="mx-auto max-w-[1400px] p-4 lg:p-6 print:max-w-none print:p-0">
      <style dangerouslySetInnerHTML={{ __html: IMPRESION_REPORTE }} />

      {/* Nada de esto sale impreso */}
      <div className="no-imprimir mb-4 flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link
            href={`/plan/${codigo}`}
            className="inline-flex items-center gap-1 text-sm font-medium text-slate-500 hover:text-slate-800"
          >
            <IconChevronLeft className="h-4 w-4" />
            Volver al plan
          </Link>
          <BotonImprimir />
        </div>

        {/* Es un formulario GET para que el reporte siga siendo una página
            de servidor: la dirección lleva las fechas, así que se puede
            guardar o mandar por chat y el otro ve el mismo reporte. */}
        <form
          className="flex flex-wrap items-end gap-2 rounded-2xl border bg-white p-3 shadow-[var(--shadow-card)]"
          style={{ borderColor: CORP.borde }}
          action={`/plan/${codigo}/reporte`}
        >
          <input type="hidden" name="temporada" value={temporada.id} />

          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Del</span>
            <input type="date" name="desde" defaultValue={desde} max={hoyIso} className={CLASE_FECHA} />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Al</span>
            <input type="date" name="hasta" defaultValue={hasta} max={hoyIso} className={CLASE_FECHA} />
          </label>

          <button
            type="submit"
            className="rounded-lg bg-brand-700 px-3.5 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-800"
          >
            Ver
          </button>

          {(hasta !== hoyIso || esRango) && (
            <Link
              href={`/plan/${codigo}/reporte?temporada=${temporada.id}&desde=${hoyIso}&hasta=${hoyIso}`}
              className="rounded-lg border border-brand-700 bg-white px-2.5 py-2 text-sm font-semibold text-brand-700 transition-colors hover:bg-brand-50"
            >
              Volver a hoy
            </Link>
          )}
        </form>

        {/* En celular las tablas se deslizan dentro de su caja. */}
        <p className="text-[11px] text-slate-400 sm:hidden">
          Las tablas se deslizan de lado con el dedo para ver el resto de las columnas.
        </p>
      </div>

      <article className="hoja-reporte flex flex-col gap-5">
        <Membrete
          titulo="Reporte de avance diario de emplasticado"
          subtitulo={`Del ${fechaLarga(desde)} al ${fechaLarga(hasta)}`}
          lineas={[`Torre Control Finca Santa Rosa · ${temporada.nombre}`]}
          marca={
            hasta !== hoyIso ? (
              <span className="mt-1 inline-block rounded bg-naranja-100 px-1.5 py-0.5 text-[11px] font-bold text-naranja-800 print:hidden">
                reporte retroactivo
              </span>
            ) : undefined
          }
        />

        {/* ==================== 1 · ESTADÍSTICAS GLOBALES =================== */}
        <Bloque numero={1} titulo={`Estadísticas globales · al ${fechaLarga(hasta)}`}>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi etiqueta="Área planificada" valor={`${num.format(plan)} mz`} />
            <Kpi etiqueta="Área ejecutada" valor={`${num.format(hecho)} mz`} fuerte />
            <Kpi
              etiqueta="Pendiente"
              valor={`${num.format(pendiente)} mz`}
              tono={pendiente > 0.009 ? 'alerta' : 'ok'}
            />
            <Kpi etiqueta="% Avance" valor={`${pct.toFixed(1)}%`} barra={plan > 0 ? pct : null} fuerte />
          </div>

          {etapas.length > 0 && (
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {etapas.map(([etapa, g]) => {
                const p = g.plan > 0 ? (g.hecho / g.plan) * 100 : null
                const falta = Math.max(g.plan - g.hecho, 0)
                return (
                  <div
                    key={etapa}
                    className="rounded-xl border bg-white p-3 [-webkit-print-color-adjust:exact] [print-color-adjust:exact]"
                    style={{ borderColor: CORP.borde, borderLeft: `4px solid ${CORP.lima}` }}
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-sm font-bold" style={{ color: CORP.marino }}>
                        Etapa {etapa}
                      </span>
                      <Porcentaje valor={p} />
                    </div>
                    <Barra valor={p} />
                    <dl className="mt-2 grid grid-cols-3 gap-2 text-[11px]">
                      <Dato etiqueta="Plan" valor={num.format(g.plan)} />
                      <Dato etiqueta="Ejecutado" valor={num.format(g.hecho)} fuerte />
                      <Dato etiqueta="Pendiente" valor={num.format(falta)} alerta={falta > 0.009} />
                    </dl>
                  </div>
                )
              })}
            </div>
          )}

          <p className="mt-2 text-[11px] text-slate-500">
            Acumulado desde el inicio de la temporada
            {temporada.fecha_inicio ? ` (${fechaLarga(temporada.fecha_inicio)})` : ''} hasta el{' '}
            {fechaLarga(hasta)}.
          </p>
        </Bloque>

        {/* ========================= 2 · AVANCE DIARIO ===================== */}
        <Bloque
          numero={2}
          titulo={`Avance diario${esRango ? ` · del ${fechaCorta(desde)} al ${fechaCorta(hasta)}` : ''}`}
          extra={
            dias.length > 0 ? (
              <span className="text-xs" style={{ color: CORP.marino }}>
                Ejecutado en el rango <strong>{num.format(totalDiario)} mz</strong>
              </span>
            ) : undefined
          }
        >
          {dias.length === 0 ? (
            <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-500">
              No hay avance registrado {esRango ? 'en el rango seleccionado' : `el ${fechaLarga(hasta)}`}.
            </p>
          ) : (
            <div className="scroll-suave -mx-1 overflow-x-auto">
              <table className="w-full min-w-[680px] border-collapse text-sm">
                <Encabezado>
                  <th className="px-2 py-1.5">Fecha</th>
                  <th className="px-2 py-1.5">UT</th>
                  <th className="px-2 py-1.5">Nomenclatura</th>
                  <th className="px-2 py-1.5">Zona</th>
                  <th className="px-2 py-1.5">Proveedores</th>
                  <th className="px-2 py-1.5 text-right">Avance (mz)</th>
                </Encabezado>
                <tbody>
                  {dias.map(([fecha, filas]) => {
                    const total = filas.reduce((a, l) => a + Number(l.avance_mz), 0)
                    const cuerpo = filas.map((l, i) => (
                      <tr key={`${fecha}-${l.lote_temporada_id}`} className={CLASE_FILA} style={ESTILO_FILA}>
                        <td className="whitespace-nowrap px-2 py-1 text-slate-500">
                          {i === 0 ? fechaCorta(fecha) : ''}
                        </td>
                        <td className="whitespace-nowrap px-2 py-1 font-semibold">{l.ut}</td>
                        <td className="px-2 py-1">{l.nomenclatura ?? '—'}</td>
                        <td className="px-2 py-1 text-slate-500">{l.zona ?? '—'}</td>
                        <td className="px-2 py-1 text-slate-500">{l.proveedores ?? '—'}</td>
                        <td className="px-2 py-1 text-right font-semibold tabular-nums">
                          {num.format(Number(l.avance_mz))}
                        </td>
                      </tr>
                    ))
                    // «Si se selecciona un rango de fechas, debe generar un
                    //  subtotalizador al final de cada día.» Con un solo día
                    //  el subtotal repetiría el total general.
                    return esRango
                      ? cuerpo.concat(
                          <tr key={`${fecha}-sub`} className={CLASE_SUBTOTAL} style={ESTILO_SUBTOTAL}>
                            <td className="px-2 py-1" colSpan={5}>
                              Subtotal {fechaLarga(fecha)}
                            </td>
                            <td className="px-2 py-1 text-right tabular-nums">{num.format(total)}</td>
                          </tr>,
                        )
                      : cuerpo
                  })}
                  <TotalGeneral colSpan={5}>
                    <td className="px-2 py-1.5 text-right tabular-nums">{num.format(totalDiario)}</td>
                  </TotalGeneral>
                </tbody>
              </table>
            </div>
          )}
        </Bloque>

        {/* ===================== 3 · POR ZONA Y ENCARGADO ================== */}
        {zonasOrdenadas.length > 0 && (
          <Bloque numero={3} titulo="Avance por zona y encargado">
            <div className="scroll-suave -mx-1 overflow-x-auto">
              <table className="w-full min-w-[560px] border-collapse text-sm">
                <Encabezado>
                  <th className="px-2 py-1.5">Encargado</th>
                  <th className="px-2 py-1.5">Zona</th>
                  <th className="px-2 py-1.5">Etapa</th>
                  <th className="px-2 py-1.5 text-right">Plan (mz)</th>
                  <th className="px-2 py-1.5 text-right">Avance (mz)</th>
                  <th className="px-2 py-1.5 text-right">%</th>
                </Encabezado>
                <tbody>
                  {zonasOrdenadas.map(([zona, filas]) => {
                    const sPlan = filas.reduce((a, r) => a + Number(r.area_plan), 0)
                    const sHecho = filas.reduce((a, r) => a + Number(r.mz_avance), 0)
                    const sPct = sPlan > 0 ? (sHecho / sPlan) * 100 : null
                    return filas
                      .map((r, i) => (
                        <tr key={`${zona}-${r.etapa}`} className={CLASE_FILA} style={ESTILO_FILA}>
                          <td className="px-2 py-1">{i === 0 ? (r.encargado ?? '—') : ''}</td>
                          <td className="px-2 py-1 font-semibold">{i === 0 ? zona : ''}</td>
                          <td className="px-2 py-1 text-slate-500">Etapa {r.etapa}</td>
                          <td className="px-2 py-1 text-right tabular-nums text-slate-500">
                            {num.format(Number(r.area_plan))}
                          </td>
                          <td className="px-2 py-1 text-right font-semibold tabular-nums">
                            {num.format(Number(r.mz_avance))}
                          </td>
                          <td className="px-2 py-1 text-right">
                            <Porcentaje valor={pctNum(r.pct_avance)} />
                          </td>
                        </tr>
                      ))
                      .concat(
                        <tr key={`${zona}-total`} className={CLASE_SUBTOTAL} style={ESTILO_SUBTOTAL}>
                          <td className="px-2 py-1" />
                          <td className="px-2 py-1">Total {zona}</td>
                          <td className="px-2 py-1" />
                          <td className="px-2 py-1 text-right tabular-nums">{num.format(sPlan)}</td>
                          <td className="px-2 py-1 text-right tabular-nums">{num.format(sHecho)}</td>
                          <td className="px-2 py-1 text-right">
                            <Porcentaje valor={sPct} />
                          </td>
                        </tr>,
                      )
                  })}
                  <TotalGeneral colSpan={3}>
                    <td className="px-2 py-1.5 text-right tabular-nums">{num.format(plan)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{num.format(hecho)}</td>
                    <td className="px-2 py-1.5 text-right">
                      <Porcentaje valor={plan > 0 ? pct : null} />
                    </td>
                  </TotalGeneral>
                </tbody>
              </table>
            </div>
          </Bloque>
        )}

        {/* ====================== 4 · LOTES EJECUTADOS ===================== */}
        <Bloque
          numero={4}
          titulo={`Lotes ejecutados (${ejecutados.length} ${ejecutados.length === 1 ? 'lote' : 'lotes'})`}
        >
          {ejecutados.length === 0 ? (
            <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-500">
              Al {fechaLarga(hasta)} no hay ningún lote con avance registrado.
            </p>
          ) : (
            <div className="scroll-suave -mx-1 overflow-x-auto">
              <table className="w-full min-w-[760px] border-collapse text-sm">
                <Encabezado>
                  <th className="px-2 py-1.5">UT</th>
                  <th className="px-2 py-1.5">Nomenclatura</th>
                  <th className="px-2 py-1.5">Zona</th>
                  <th className="px-2 py-1.5 text-right">Plan (mz)</th>
                  <th className="px-2 py-1.5 text-right">Ejecutado (mz)</th>
                  <th className="px-2 py-1.5 text-right">%</th>
                  <th className="px-2 py-1.5">Fecha inicio</th>
                  <th className="px-2 py-1.5">Última fecha</th>
                </Encabezado>
                <tbody>
                  {ejecutados.map((r) => (
                    <tr key={r.lote_temporada_id} className={CLASE_FILA} style={ESTILO_FILA}>
                      <td className="whitespace-nowrap px-2 py-1 font-semibold">{r.ut}</td>
                      <td className="px-2 py-1">{r.nomenclatura ?? '—'}</td>
                      <td className="px-2 py-1 text-slate-500">{r.zona ?? '—'}</td>
                      <td className="px-2 py-1 text-right tabular-nums text-slate-500">
                        {num.format(Number(r.area_plan ?? 0))}
                      </td>
                      <td className="px-2 py-1 text-right font-semibold tabular-nums">
                        {num.format(Number(r.mz_avance ?? 0))}
                      </td>
                      <td className="px-2 py-1 text-right">
                        <Porcentaje valor={pctNum(r.pct_avance)} />
                      </td>
                      <td className="whitespace-nowrap px-2 py-1 text-slate-500">
                        {r.fecha_inicio ? fechaCorta(r.fecha_inicio) : '—'}
                      </td>
                      <td className="whitespace-nowrap px-2 py-1 text-slate-500">
                        {r.fecha_ultima ? fechaCorta(r.fecha_ultima) : '—'}
                      </td>
                    </tr>
                  ))}
                  <TotalGeneral colSpan={3}>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {num.format(ejecutados.reduce((a, r) => a + Number(r.area_plan ?? 0), 0))}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {num.format(ejecutados.reduce((a, r) => a + Number(r.mz_avance ?? 0), 0))}
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      <Porcentaje valor={plan > 0 ? pct : null} />
                    </td>
                    <td className="px-2 py-1.5" colSpan={2} />
                  </TotalGeneral>
                </tbody>
              </table>
            </div>
          )}

          {sinTocar > 0 && (
            <p className="mt-1.5 text-[11px]" style={{ color: CORP.naranja }}>
              {sinTocar === 1 ? 'Queda 1 lote' : `Quedan ${sinTocar} lotes`} del plan sin registrar
              avance. No se listan aquí a propósito: este cuadro es lo ejecutado.
            </p>
          )}
        </Bloque>

        <PieOndas>
          <p className="mt-1 text-center text-[10px] text-slate-500">
            Generado por AgroNotificaciones · acumulado al {fechaLarga(hasta)}
            {hasta !== hoyIso ? ` (impreso el ${fechaLarga(hoyIso)})` : ''}. El área planificada sale
            del plan de mecanización y el avance de las labores capturadas en campo. El seguimiento de
            plan y etapas corresponde{labor ? ` a ${labor.labor_nombre}` : ' al emplasticado'}.
          </p>
        </PieOndas>
      </article>
    </div>
  )
}

const CLASE_FECHA =
  'rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm focus:border-brand-600 focus:outline-none focus:ring-4 focus:ring-brand-600/10'

/* ------------------------------------------------------------------ */

/**
 * Respaldo sin migración 21: junta las líneas sueltas de la vista en una
 * fila por lote y día, con el mismo texto de proveedores que arma la
 * función en la base (el área de cada uno sólo cuando hay más de uno).
 */
function agrupar(crudas: LineaCruda[]): FilaDiaria[] {
  const mapa = new Map<string, { fila: FilaDiaria; partes: { texto: string; mz: number }[] }>()

  for (const c of crudas) {
    const clave = `${c.fecha}|${c.lote_temporada_id}`
    const texto =
      [
        c.proveedor_plastico,
        c.proveedor_manguera !== c.proveedor_plastico ? c.proveedor_manguera : null,
      ]
        .filter(Boolean)
        .join(' / ') || 'Sin proveedor'

    const actual = mapa.get(clave)
    if (actual) {
      actual.fila.lineas += 1
      actual.fila.avance_mz += Number(c.avance_mz ?? 0)
      actual.partes.push({ texto, mz: Number(c.avance_mz ?? 0) })
    } else {
      mapa.set(clave, {
        fila: {
          fecha: c.fecha,
          lote_temporada_id: c.lote_temporada_id,
          ut: c.ut,
          nomenclatura: c.nomenclatura,
          zona: c.zona,
          encargado: c.encargado,
          proveedores: null,
          lineas: 1,
          avance_mz: Number(c.avance_mz ?? 0),
        },
        partes: [{ texto, mz: Number(c.avance_mz ?? 0) }],
      })
    }
  }

  return [...mapa.values()]
    .map(({ fila, partes }) => ({
      ...fila,
      proveedores: partes
        .sort((a, b) => b.mz - a.mz)
        .map((p) => (partes.length > 1 ? `${p.texto} ${num.format(p.mz)} mz` : p.texto))
        .join(' · '),
    }))
    .sort(
      (a, b) => b.fecha.localeCompare(a.fecha) || a.ut.localeCompare(b.ut, 'es', { numeric: true }),
    )
}
