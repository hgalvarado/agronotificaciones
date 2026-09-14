import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { getPermisos, puede } from '@/lib/auth'
import { Alerta } from '@/components/ui/Primitivos'
import { IconChevronLeft } from '@/components/ui/Icons'
import { BotonImprimir } from '@/components/plan/BotonImprimir'
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

/**
 * Azul del encabezado de sus tablas de Excel. Se escribe a mano y no con
 * un color de Tailwind porque el reporte se imprime y se envía por
 * correo a gerencia: tiene que salir igual al que ellos ya reconocen.
 */
const AZUL = '#1f3864'

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

  return (
    <div className="mx-auto max-w-4xl p-4 lg:p-6 print:max-w-none print:p-0">
      {/* Nada de esto sale impreso */}
      <div className="mb-4 flex flex-col gap-3 print:hidden">
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
          className="flex flex-wrap items-end gap-2 rounded-2xl border border-slate-200/80 bg-white p-3 shadow-[var(--shadow-card)]"
          action={`/plan/${codigo}/reporte`}
        >
          <input type="hidden" name="temporada" value={temporada.id} />

          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
              Del
            </span>
            <input
              type="date"
              name="desde"
              defaultValue={desde}
              max={hoyIso}
              className="rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm focus:border-brand-600 focus:outline-none focus:ring-4 focus:ring-brand-600/10"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Al</span>
            <input
              type="date"
              name="hasta"
              defaultValue={hasta}
              max={hoyIso}
              className="rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm focus:border-brand-600 focus:outline-none focus:ring-4 focus:ring-brand-600/10"
            />
          </label>

          <button
            type="submit"
            className="rounded-lg bg-slate-900 px-3.5 py-2 text-sm font-semibold text-white transition-colors hover:bg-slate-800"
          >
            Ver
          </button>

          {(hasta !== hoyIso || esRango) && (
            <Link
              href={`/plan/${codigo}/reporte?temporada=${temporada.id}&desde=${hoyIso}&hasta=${hoyIso}`}
              className="rounded-lg px-2.5 py-2 text-sm font-semibold text-brand-700 transition-colors hover:bg-brand-50"
            >
              Volver a hoy
            </Link>
          )}
        </form>
      </div>

      {/* En celular las tablas se deslizan dentro de su caja. Se avisa una
          vez, arriba, en vez de repetirlo en cada tabla. */}
      <p className="mb-2 text-[11px] text-slate-400 sm:hidden print:hidden">
        Las tablas se deslizan de lado con el dedo para ver el resto de las columnas.
      </p>

      <article className="flex flex-col gap-5 rounded-2xl border border-slate-200 bg-white p-4 shadow-[var(--shadow-card)] sm:p-6 print:rounded-none print:border-0 print:p-0 print:shadow-none">
        {/* ---------------------------- Portada --------------------------- */}
        {/* Las cuatro líneas van tal cual él las dicta: es el encabezado
            que gerencia ya reconoce del correo diario. */}
        <header className="border-b-2 pb-3 text-center" style={{ borderColor: AZUL }}>
          <h1
            className="text-lg font-bold uppercase tracking-tight sm:text-xl"
            style={{ color: AZUL }}
          >
            Agropecuaria Montelíbano S.A.
          </h1>
          <p
            className="mt-0.5 text-sm font-bold uppercase tracking-tight sm:text-base"
            style={{ color: AZUL }}
          >
            Reporte avance diario: Emplasticado del {fechaLarga(desde)} al {fechaLarga(hasta)}
          </p>
          <p className="mt-0.5 text-xs font-semibold uppercase tracking-widest text-slate-600">
            Torre Control Finca Santa Rosa
          </p>
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">
            {temporada.nombre}
          </p>
          {hasta !== hoyIso && (
            <span className="mt-1 inline-block rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-bold text-amber-800 print:hidden">
              reporte retroactivo
            </span>
          )}
        </header>

        {/* ------------------------- Lo que importa ----------------------- */}
        <section>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Kpi etiqueta="Área planificada" valor={`${num.format(plan)} mz`} />
            <Kpi etiqueta="Área ejecutada" valor={`${num.format(hecho)} mz`} />
            <Kpi etiqueta="Pendiente" valor={`${num.format(pendiente)} mz`} />
            <Kpi etiqueta="% Avance" valor={`${pct.toFixed(1)}%`} grande />
          </div>

          <div className="mt-3 h-3 w-full overflow-hidden rounded-full bg-slate-100 print:border print:border-slate-300">
            <div
              className="h-full rounded-full"
              style={{ width: `${Math.min(pct, 100)}%`, backgroundColor: AZUL }}
            />
          </div>

          <p className="mt-1.5 text-[11px] text-slate-400">
            Acumulado desde el inicio de la temporada
            {temporada.fecha_inicio ? ` (${fechaLarga(temporada.fecha_inicio)})` : ''} hasta el{' '}
            {fechaLarga(hasta)}.
          </p>
        </section>

        {/* ========================= 1 · AVANCE DIARIO ===================== */}
        <section>
          <Titulo numero={1}>
            Avance diario{esRango ? ` · del ${fechaCorta(desde)} al ${fechaCorta(hasta)}` : ''}
          </Titulo>

          {dias.length === 0 ? (
            <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-500">
              No hay avance registrado{' '}
              {esRango ? 'en el rango seleccionado' : `el ${fechaLarga(hasta)}`}.
            </p>
          ) : (
            <div className="scroll-suave overflow-x-auto">
              <table className="w-full min-w-[680px] border-collapse text-sm">
                <Encabezado>
                  <th className="px-2 py-1.5 text-left">Fecha</th>
                  <th className="px-2 py-1.5 text-left">UT</th>
                  <th className="px-2 py-1.5 text-left">Nomenclatura</th>
                  <th className="px-2 py-1.5 text-left">Zona</th>
                  <th className="px-2 py-1.5 text-left">Proveedores</th>
                  <th className="px-2 py-1.5 text-right">Avance</th>
                </Encabezado>
                <tbody>
                  {dias.map(([fecha, filas]) => {
                    const total = filas.reduce((a, l) => a + Number(l.avance_mz), 0)
                    const cuerpo = filas.map((l, i) => (
                      <tr
                        key={`${fecha}-${l.lote_temporada_id}`}
                        className="border-b border-slate-100"
                      >
                        <td className="whitespace-nowrap px-2 py-1 text-slate-500">
                          {i === 0 ? fechaCorta(fecha) : ''}
                        </td>
                        <td className="whitespace-nowrap px-2 py-1 font-semibold text-slate-700">
                          {l.ut}
                        </td>
                        <td className="px-2 py-1 text-slate-600">{l.nomenclatura ?? '—'}</td>
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
                          <tr
                            key={`${fecha}-sub`}
                            className="border-b border-slate-300 bg-slate-50 font-bold print:bg-white"
                          >
                            <td className="px-2 py-1" colSpan={5}>
                              Subtotal {fechaLarga(fecha)}
                            </td>
                            <td className="px-2 py-1 text-right tabular-nums">
                              {num.format(total)}
                            </td>
                          </tr>,
                        )
                      : cuerpo
                  })}
                  <TotalGeneral colSpan={5}>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {num.format(totalDiario)}
                    </td>
                  </TotalGeneral>
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* ===================== 2 · POR ZONA Y ENCARGADO ================== */}
        {zonasAgrupadas.size > 0 && (
          <section>
            <Titulo numero={2}>Avance por zona y encargado</Titulo>
            <div className="scroll-suave overflow-x-auto">
              <table className="w-full min-w-[520px] border-collapse text-sm">
                <Encabezado>
                  <th className="px-2 py-1.5 text-left">Encargado</th>
                  <th className="px-2 py-1.5 text-left">Zona</th>
                  <th className="px-2 py-1.5 text-left">Etapa</th>
                  <th className="px-2 py-1.5 text-right">Plan</th>
                  <th className="px-2 py-1.5 text-right">Avance</th>
                  <th className="px-2 py-1.5 text-right">%</th>
                </Encabezado>
                <tbody>
                  {[...zonasAgrupadas.entries()]
                    .sort((a, b) => a[0].localeCompare(b[0], 'es', { numeric: true }))
                    .map(([zona, filas]) => {
                      const sPlan = filas.reduce((a, r) => a + Number(r.area_plan), 0)
                      const sHecho = filas.reduce((a, r) => a + Number(r.mz_avance), 0)
                      const sPct = sPlan > 0 ? (sHecho / sPlan) * 100 : 0
                      return filas
                        .map((r, i) => (
                          <tr key={`${zona}-${r.etapa}`} className="border-b border-slate-100">
                            <td className="px-2 py-1 text-slate-600">
                              {i === 0 ? (r.encargado ?? '—') : ''}
                            </td>
                            <td className="px-2 py-1 font-semibold text-slate-700">
                              {i === 0 ? zona : ''}
                            </td>
                            <td className="px-2 py-1 text-slate-500">Etapa {r.etapa}</td>
                            <td className="px-2 py-1 text-right tabular-nums">
                              {num.format(Number(r.area_plan))}
                            </td>
                            <td className="px-2 py-1 text-right tabular-nums">
                              {num.format(Number(r.mz_avance))}
                            </td>
                            <td className="px-2 py-1 text-right font-semibold tabular-nums">
                              {r.pct_avance !== null ? `${Number(r.pct_avance).toFixed(0)}%` : '—'}
                            </td>
                          </tr>
                        ))
                        .concat(
                          <tr
                            key={`${zona}-total`}
                            className="border-b-2 border-slate-300 bg-slate-50 font-bold print:bg-white"
                          >
                            <td className="px-2 py-1" />
                            <td className="px-2 py-1">Total {zona}</td>
                            <td className="px-2 py-1" />
                            <td className="px-2 py-1 text-right tabular-nums">
                              {num.format(sPlan)}
                            </td>
                            <td className="px-2 py-1 text-right tabular-nums">
                              {num.format(sHecho)}
                            </td>
                            <td className="px-2 py-1 text-right tabular-nums">
                              {sPct.toFixed(0)}%
                            </td>
                          </tr>,
                        )
                    })}
                  <TotalGeneral colSpan={3}>
                    <td className="px-2 py-1.5 text-right tabular-nums">{num.format(plan)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{num.format(hecho)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{pct.toFixed(1)}%</td>
                  </TotalGeneral>
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* ========================= 3 · POR ETAPA ========================= */}
        {porEtapa.size > 0 && (
          <section>
            <Titulo numero={3}>Avance por etapa</Titulo>
            <div className="flex flex-col gap-2">
              {[...porEtapa.entries()]
                .sort((a, b) => a[0] - b[0])
                .map(([etapa, g]) => {
                  const p = g.plan > 0 ? (g.hecho / g.plan) * 100 : 0
                  return (
                    <div key={etapa} className="flex items-center gap-3">
                      <span className="w-16 shrink-0 text-sm font-semibold text-slate-700">
                        Etapa {etapa}
                      </span>
                      <div className="h-4 flex-1 overflow-hidden rounded bg-slate-100 print:border print:border-slate-300">
                        <div
                          className={`h-full ${
                            p >= 99 ? 'bg-emerald-600' : p >= 50 ? '' : 'bg-amber-500'
                          }`}
                          style={{
                            width: `${Math.min(p, 100)}%`,
                            ...(p < 99 && p >= 50 ? { backgroundColor: AZUL } : {}),
                          }}
                        />
                      </div>
                      <span className="w-40 shrink-0 text-right text-xs tabular-nums text-slate-500">
                        {num.format(g.hecho)} / {num.format(g.plan)} mz
                        <strong className="ml-1.5 text-slate-900">{p.toFixed(0)}%</strong>
                      </span>
                    </div>
                  )
                })}
            </div>
          </section>
        )}

        {/* ====================== 4 · LOTES EJECUTADOS ===================== */}
        <section>
          <Titulo numero={4}>
            Lotes ejecutados ({ejecutados.length} {ejecutados.length === 1 ? 'lote' : 'lotes'})
          </Titulo>

          {ejecutados.length === 0 ? (
            <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-500">
              Al {fechaLarga(hasta)} no hay ningún lote con avance registrado.
            </p>
          ) : (
            <div className="scroll-suave overflow-x-auto">
              <table className="w-full min-w-[720px] border-collapse text-sm">
                <Encabezado>
                  <th className="px-2 py-1.5 text-left">UT</th>
                  <th className="px-2 py-1.5 text-left">Nomenclatura</th>
                  <th className="px-2 py-1.5 text-left">Zona</th>
                  <th className="px-2 py-1.5 text-right">Plan</th>
                  <th className="px-2 py-1.5 text-right">Ejecutado</th>
                  <th className="px-2 py-1.5 text-right">%</th>
                  <th className="px-2 py-1.5 text-left">Fecha inicio</th>
                  <th className="px-2 py-1.5 text-left">Última fecha</th>
                </Encabezado>
                <tbody>
                  {ejecutados.map((r) => (
                    <tr key={r.lote_temporada_id} className="border-b border-slate-100">
                      <td className="whitespace-nowrap px-2 py-1 font-semibold text-slate-700">
                        {r.ut}
                      </td>
                      <td className="px-2 py-1 text-slate-600">{r.nomenclatura ?? '—'}</td>
                      <td className="px-2 py-1 text-slate-500">{r.zona ?? '—'}</td>
                      <td className="px-2 py-1 text-right tabular-nums">
                        {num.format(Number(r.area_plan ?? 0))}
                      </td>
                      <td className="px-2 py-1 text-right font-semibold tabular-nums">
                        {num.format(Number(r.mz_avance ?? 0))}
                      </td>
                      <td className="px-2 py-1 text-right font-semibold tabular-nums">
                        {r.pct_avance !== null ? `${Number(r.pct_avance).toFixed(0)}%` : '—'}
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
                    <td className="px-2 py-1.5 text-right tabular-nums">{pct.toFixed(1)}%</td>
                    <td className="px-2 py-1.5" colSpan={2} />
                  </TotalGeneral>
                </tbody>
              </table>
            </div>
          )}

          {sinTocar > 0 && (
            <p className="mt-1.5 text-[11px] text-slate-400">
              {sinTocar === 1 ? 'Queda 1 lote' : `Quedan ${sinTocar} lotes`} del plan sin registrar
              avance. No se listan aquí a propósito: este cuadro es lo ejecutado.
            </p>
          )}
        </section>

        <footer className="border-t border-slate-200 pt-3 text-[11px] text-slate-400">
          Generado por AgroNotificaciones · acumulado al {fechaLarga(hasta)}
          {hasta !== hoyIso ? ` (impreso el ${fechaLarga(hoyIso)})` : ''}. El área planificada sale
          del plan de mecanización y el avance de las labores capturadas en campo; ambos se
          actualizan solos. El seguimiento de plan y etapas corresponde
          {labor ? ` a ${labor.labor_nombre}` : ' al emplasticado'}.
        </footer>
      </article>
    </div>
  )
}

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

/** Encabezado azul, como en las tablas de Excel que él ya manda. */
function Encabezado({ children }: { children: React.ReactNode }) {
  return (
    <thead>
      <tr
        className="text-[11px] font-bold uppercase tracking-wide text-white [-webkit-print-color-adjust:exact] [print-color-adjust:exact]"
        style={{ backgroundColor: AZUL }}
      >
        {children}
      </tr>
    </thead>
  )
}

/** La fila de «Total general», en negrita y con línea gruesa arriba. */
function TotalGeneral({ colSpan, children }: { colSpan: number; children: React.ReactNode }) {
  return (
    <tr className="border-t-2 text-sm font-bold" style={{ borderColor: AZUL }}>
      <td className="px-2 py-1.5" colSpan={colSpan}>
        Total general
      </td>
      {children}
    </tr>
  )
}

function Titulo({ numero, children }: { numero: number; children: React.ReactNode }) {
  return (
    <h2 className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-slate-500">
      <span
        className="flex h-5 w-5 items-center justify-center rounded text-[11px] font-bold text-white [-webkit-print-color-adjust:exact] [print-color-adjust:exact]"
        style={{ backgroundColor: AZUL }}
      >
        {numero}
      </span>
      {children}
    </h2>
  )
}

function Kpi({
  etiqueta,
  valor,
  grande = false,
}: {
  etiqueta: string
  valor: string
  grande?: boolean
}) {
  return (
    <div className="rounded-xl border border-slate-200 px-3 py-2.5">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{etiqueta}</p>
      <p
        className={`mt-0.5 font-bold tracking-tight tabular-nums ${
          grande ? 'text-3xl' : 'text-xl text-slate-900'
        }`}
        style={grande ? { color: AZUL } : undefined}
      >
        {valor}
      </p>
    </div>
  )
}
