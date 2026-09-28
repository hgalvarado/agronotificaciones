/**
 * Reporte gerencial de cultivos de rotación.
 *
 * Sólo dibuja: los cuatro bloques ya vienen sumados de la base. Es el
 * mismo lenguaje visual del reporte de trasplante —mismo azul, mismos
 * encabezados numerados, mismas reglas de impresión— porque los dos
 * llegan al mismo escritorio y leerlos no debería ser dos aprendizajes.
 *
 * Componente de servidor: sin estado ni eventos, para que la hoja llegue
 * pintada y la impresión no espere a que hidrate nada.
 */

import { AnilloAvance, BarrasPlanReal, type Barra } from './Graficos'
import { AZUL, fechaCorta, fechaLarga, n0, n2, pct } from '@/lib/trasplante/formato'
import { etiquetaTipoSiembra, etiquetaUmb } from '@/lib/rotacion/tipos'
import type {
  Estadisticas,
  FilaAvance,
  FilaPorLote,
  FilaPorTipoSiembra,
  FilaPorVariedad,
  FilaPorZona,
} from '@/lib/rotacion/tipos'

export function ReporteRotacion({
  temporada,
  desde,
  hasta,
  estadisticas,
  avance,
  porVariedad,
  porZona,
  porLote,
  porTipo,
}: {
  temporada: string
  desde: string
  hasta: string
  estadisticas: Estadisticas | null
  avance: FilaAvance[]
  porVariedad: FilaPorVariedad[]
  porZona: FilaPorZona[]
  porLote: FilaPorLote[]
  porTipo: FilaPorTipoSiembra[]
}) {
  const esRango = desde !== hasta
  const total: Estadisticas = estadisticas ?? {
    area_plan: 0,
    area_real: 0,
    pendiente: 0,
    pct: null,
    lotes_plan: 0,
    lotes_real: 0,
    gasto_semilla: 0,
    costo_total: 0,
  }

  const dias = agruparPorFecha(avance)
  const totalDiario = avance.reduce((a, f) => a + Number(f.avance_mz), 0)
  const costoDiario = avance.reduce((a, f) => a + Number(f.costo_total ?? 0), 0)

  const barrasZona: Barra[] = porZona.map((z) => ({
    etiqueta: z.zona,
    detalle: z.encargado,
    plan: Number(z.area_plan),
    real: Number(z.area_real),
  }))

  const barrasVariedad: Barra[] = porVariedad.map((v) => ({
    etiqueta: v.variedad,
    detalle: v.producto,
    plan: Number(v.area_plan),
    real: Number(v.area_real),
  }))

  return (
    <article className="hoja-reporte flex flex-col gap-5 rounded-2xl border border-slate-200 bg-white p-4 shadow-[var(--shadow-card)] sm:p-6 print:rounded-none print:border-0 print:p-0 print:shadow-none">
      {/* ========================== MEMBRETE ============================ */}
      <header className="border-b-2 pb-3 text-center" style={{ borderColor: AZUL }}>
        <p className="text-lg font-bold uppercase tracking-tight sm:text-xl" style={{ color: AZUL }}>
          Agropecuaria Montelíbano S.A.
        </p>
        <p
          className="mt-0.5 text-sm font-bold uppercase tracking-tight sm:text-base"
          style={{ color: AZUL }}
        >
          Reporte avance diario: Cultivos de rotación
          {esRango ? ` del ${fechaLarga(desde)} al ${fechaLarga(hasta)}` : ` · ${fechaLarga(hasta)}`}
        </p>
        <p className="mt-0.5 text-xs font-semibold uppercase tracking-widest text-slate-600">
          Torre Control Finca Santa Rosa
        </p>
        <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">
          Temporada {temporada}
        </p>
      </header>

      {/* ====================== TABLERO Y GRÁFICAS ====================== */}
      <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto]">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-2">
          <Widget etiqueta="Área planificada" valor={`${n2(total.area_plan)} mz`}
            detalle={`${n0(total.lotes_plan)} ${Number(total.lotes_plan) === 1 ? 'lote' : 'lotes'}`} />
          <Widget
            etiqueta="Área ejecutada"
            valor={`${n2(total.area_real)} mz`}
            detalle={`${n0(total.lotes_real)} ${Number(total.lotes_real) === 1 ? 'lote' : 'lotes'}`}
            color={AZUL}
          />
          {/* Pendiente negativo = se sembró de más, y se dice: esconderlo
              con un `greatest(…, 0)` sería contar una mentira cómoda. */}
          <Widget
            etiqueta={Number(total.pendiente) < 0 ? 'Sembrado de más' : 'Pendiente'}
            valor={`${n2(Math.abs(Number(total.pendiente)))} mz`}
          />
          <Widget etiqueta="% Avance" valor={pct(total.pct)} />
        </div>

        <AnilloAvance
          porcentaje={total.pct}
          plan={Number(total.area_plan)}
          real={Number(total.area_real)}
        />
      </section>

      <section className="grid gap-5 lg:grid-cols-2">
        <div>
          <Titulo numero={1}>Avance por zona</Titulo>
          <BarrasPlanReal filas={barrasZona} />
        </div>
        <div>
          <Titulo numero={2}>Avance por variedad</Titulo>
          <BarrasPlanReal filas={barrasVariedad} />
        </div>
      </section>

      {/* ======================= 1 · AVANCE DIARIO ====================== */}
      <section>
        <Titulo numero={3}>
          Avance diario{esRango ? ` · del ${fechaCorta(desde)} al ${fechaCorta(hasta)}` : ''}
        </Titulo>

        {dias.length === 0 ? (
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-500">
            No hay siembra de rotación registrada{' '}
            {esRango ? 'en el rango' : `el ${fechaLarga(hasta)}`}.
          </p>
        ) : (
          <div className="scroll-suave overflow-x-auto">
            <table className="w-full min-w-[980px] border-collapse text-sm">
              <Encabezado>
                <th className="px-2 py-1.5 text-left">Fecha</th>
                <th className="px-2 py-1.5 text-left">Lote</th>
                <th className="px-2 py-1.5 text-left">Zona</th>
                <th className="px-2 py-1.5 text-left">Variedad</th>
                <th className="px-2 py-1.5 text-left">Producto</th>
                <th className="px-2 py-1.5 text-right">Avance mz</th>
                <th className="px-2 py-1.5 text-right">Semilla</th>
                <th className="px-2 py-1.5 text-right">Semilla/mz</th>
                <th className="px-2 py-1.5 text-left">Tipo</th>
                <th className="px-2 py-1.5 text-right">Costo</th>
              </Encabezado>
              <tbody>
                {dias.map(([fecha, delDia]) => {
                  const mz = delDia.reduce((a, f) => a + Number(f.avance_mz), 0)
                  const costo = delDia.reduce((a, f) => a + Number(f.costo_total ?? 0), 0)
                  const cuerpo = delDia.map((f, i) => (
                    <tr key={f.id} className="border-b border-slate-100">
                      <td className="whitespace-nowrap px-2 py-1 text-slate-500">
                        {i === 0 ? fechaCorta(fecha) : ''}
                      </td>
                      <td className="whitespace-nowrap px-2 py-1 font-semibold text-slate-800">
                        {f.ut}
                      </td>
                      <td className="px-2 py-1 text-slate-500">{f.zona ?? '—'}</td>
                      <td className="px-2 py-1 text-slate-700">{f.variedad}</td>
                      <td className="px-2 py-1 text-slate-500">{f.producto ?? '—'}</td>
                      <td className="px-2 py-1 text-right font-semibold tabular-nums text-slate-900">
                        {n2(f.avance_mz)}
                      </td>
                      <td className="px-2 py-1 text-right tabular-nums text-slate-600">
                        {n2(f.gasto_semilla)} {etiquetaUmb(f.umb)}
                      </td>
                      <td className="px-2 py-1 text-right tabular-nums text-slate-600">
                        {n2(f.semilla_mz)}
                      </td>
                      <td className="px-2 py-1 text-xs text-slate-500">
                        {etiquetaTipoSiembra(f.tipo_siembra)}
                      </td>
                      <td className="px-2 py-1 text-right tabular-nums text-slate-600">
                        {n2(f.costo_total)}
                      </td>
                    </tr>
                  ))
                  // Con un solo día el subtotal repetiría el total general.
                  return esRango
                    ? cuerpo.concat(
                        <tr
                          key={`${fecha}-sub`}
                          className="border-b border-slate-300 bg-slate-50 font-bold print:bg-white"
                        >
                          <td className="px-2 py-1" colSpan={5}>
                            Subtotal {fechaLarga(fecha)}
                          </td>
                          <td className="px-2 py-1 text-right tabular-nums">{n2(mz)}</td>
                          <td className="px-2 py-1" colSpan={3} />
                          <td className="px-2 py-1 text-right tabular-nums">{n2(costo)}</td>
                        </tr>
                      )
                    : cuerpo
                })}
                <tr className="border-t-2 text-sm font-bold" style={{ borderColor: AZUL }}>
                  <td className="px-2 py-1.5" colSpan={5}>
                    Total general
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{n2(totalDiario)}</td>
                  <td className="px-2 py-1.5" colSpan={3} />
                  <td className="px-2 py-1.5 text-right tabular-nums">{n2(costoDiario)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ================= 2 · AVANCE POR ZONA Y LOTE =================== */}
      {porLote.length > 0 && (
        <section>
          <Titulo numero={4}>Avance por zona y lote · acumulado al {fechaLarga(hasta)}</Titulo>
          <div className="scroll-suave overflow-x-auto">
            <table className="w-full min-w-[940px] border-collapse text-sm">
              <Encabezado>
                <th className="px-2 py-1.5 text-left">Zona</th>
                <th className="px-2 py-1.5 text-left">Lote</th>
                <th className="px-2 py-1.5 text-left">Nomenclatura</th>
                <th className="px-2 py-1.5 text-left">Variedad planificada</th>
                <th className="px-2 py-1.5 text-left">Variedad sembrada</th>
                <th className="px-2 py-1.5 text-right">Plan</th>
                <th className="px-2 py-1.5 text-right">Real</th>
                <th className="px-2 py-1.5 text-right">%</th>
                <th className="px-2 py-1.5 text-right">Costo</th>
              </Encabezado>
              <tbody>
                {agruparPorZona(porLote).map(([zona, lotes]) => {
                  const plan = lotes.reduce((a, f) => a + Number(f.area_plan), 0)
                  const real = lotes.reduce((a, f) => a + Number(f.area_real), 0)
                  const costo = lotes.reduce((a, f) => a + Number(f.costo_total), 0)
                  return lotes
                    .map((f, i) => (
                      <tr key={f.lote_temporada_id} className="border-b border-slate-100">
                        <td className="px-2 py-1 font-semibold text-slate-800">
                          {i === 0 ? zona : ''}
                        </td>
                        <td className="whitespace-nowrap px-2 py-1 font-semibold text-slate-700">
                          {f.ut}
                        </td>
                        <td className="px-2 py-1 text-slate-500">{f.lote_nombre ?? '—'}</td>
                        <td className="px-2 py-1 text-slate-500">{f.variedad_plan ?? '—'}</td>
                        {/* La diferencia se dice en la celda y no sólo con
                            color: en el papel el color se pierde y la
                            diferencia es justo lo que se va a revisar. */}
                        <td className="px-2 py-1 text-slate-700">
                          {f.variedad_real ?? '—'}
                          {f.coincide === false && (
                            <span className="ml-1 text-[10px] font-bold uppercase text-amber-700">
                              cambió
                            </span>
                          )}
                        </td>
                        <td className="px-2 py-1 text-right tabular-nums">{n2(f.area_plan)}</td>
                        <td className="px-2 py-1 text-right font-semibold tabular-nums text-slate-900">
                          {n2(f.area_real)}
                        </td>
                        <td className="px-2 py-1 text-right tabular-nums">{pct(f.pct)}</td>
                        <td className="px-2 py-1 text-right tabular-nums text-slate-600">
                          {n2(f.costo_total)}
                        </td>
                      </tr>
                    ))
                    .concat(
                      <tr
                        key={`${zona}-total`}
                        className="border-b-2 border-slate-300 bg-slate-50 font-bold print:bg-white"
                      >
                        <td className="px-2 py-1" colSpan={5}>
                          Total {zona}
                        </td>
                        <td className="px-2 py-1 text-right tabular-nums">{n2(plan)}</td>
                        <td className="px-2 py-1 text-right tabular-nums">{n2(real)}</td>
                        <td className="px-2 py-1 text-right tabular-nums">
                          {pct(plan > 0 ? (real / plan) * 100 : null)}
                        </td>
                        <td className="px-2 py-1 text-right tabular-nums">{n2(costo)}</td>
                      </tr>
                    )
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ============== 3 · RESUMEN POR VARIEDAD Y CULTIVO ============== */}
      {porVariedad.length > 0 && (
        <section>
          <Titulo numero={5}>Resumen por variedad y cultivo</Titulo>
          <div className="scroll-suave overflow-x-auto">
            <table className="w-full min-w-[820px] border-collapse text-sm">
              <Encabezado>
                <th className="px-2 py-1.5 text-left">Variedad</th>
                <th className="px-2 py-1.5 text-left">Producto (cultivo)</th>
                <th className="px-2 py-1.5 text-right">Plan</th>
                <th className="px-2 py-1.5 text-right">Real</th>
                <th className="px-2 py-1.5 text-right">%</th>
                <th className="px-2 py-1.5 text-right">Semilla usada</th>
                <th className="px-2 py-1.5 text-right">Semilla/mz</th>
                <th className="px-2 py-1.5 text-right">Costo</th>
              </Encabezado>
              <tbody>
                {porVariedad.map((v) => (
                  <tr key={v.variedad} className="border-b border-slate-100">
                    <td className="px-2 py-1 font-semibold text-slate-800">{v.variedad}</td>
                    <td className="px-2 py-1 text-slate-500">{v.producto ?? '—'}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{n2(v.area_plan)}</td>
                    <td className="px-2 py-1 text-right font-semibold tabular-nums text-slate-900">
                      {n2(v.area_real)}
                    </td>
                    <td className="px-2 py-1 text-right tabular-nums">{pct(v.pct)}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{n2(v.gasto_semilla)}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{n2(v.semilla_mz)}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{n2(v.costo_total)}</td>
                  </tr>
                ))}
                <tr className="border-t-2 text-sm font-bold" style={{ borderColor: AZUL }}>
                  <td className="px-2 py-1.5" colSpan={2}>
                    Total general
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    {n2(porVariedad.reduce((a, v) => a + Number(v.area_plan), 0))}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    {n2(porVariedad.reduce((a, v) => a + Number(v.area_real), 0))}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{pct(total.pct)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    {n2(porVariedad.reduce((a, v) => a + Number(v.gasto_semilla), 0))}
                  </td>
                  <td className="px-2 py-1.5" />
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    {n2(porVariedad.reduce((a, v) => a + Number(v.costo_total), 0))}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ============== 4 · TIPO DE SIEMBRA Y COSTOS ==================== */}
      {porTipo.length > 0 && (
        <section>
          <Titulo numero={6}>Tipo de siembra y costos</Titulo>
          <div className="scroll-suave overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-sm">
              <Encabezado>
                <th className="px-2 py-1.5 text-left">Tipo de siembra</th>
                <th className="px-2 py-1.5 text-right">Registros</th>
                <th className="px-2 py-1.5 text-right">Área mz</th>
                <th className="px-2 py-1.5 text-right">% del área</th>
                <th className="px-2 py-1.5 text-right">Costo / mz</th>
                <th className="px-2 py-1.5 text-right">Costo total</th>
              </Encabezado>
              <tbody>
                {porTipo.map((t) => (
                  <tr key={t.tipo_siembra} className="border-b border-slate-100">
                    <td className="px-2 py-1 font-semibold text-slate-800">
                      {etiquetaTipoSiembra(t.tipo_siembra)}
                    </td>
                    <td className="px-2 py-1 text-right tabular-nums">{n0(t.lineas)}</td>
                    <td className="px-2 py-1 text-right font-semibold tabular-nums text-slate-900">
                      {n2(t.area_real)}
                    </td>
                    <td className="px-2 py-1 text-right tabular-nums">{pct(t.pct_area)}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{n2(t.costo_mz)}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{n2(t.costo_total)}</td>
                  </tr>
                ))}
                <tr className="border-t-2 text-sm font-bold" style={{ borderColor: AZUL }}>
                  <td className="px-2 py-1.5">Total general</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    {n0(porTipo.reduce((a, t) => a + Number(t.lineas), 0))}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    {n2(porTipo.reduce((a, t) => a + Number(t.area_real), 0))}
                  </td>
                  <td className="px-2 py-1.5" />
                  {/* El costo/mz del total sale del total entre las
                      manzanas: promediar los costos unitarios de cada
                      tipo daría otra cifra, y equivocada. */}
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    {n2(costoPorManzana(porTipo))}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    {n2(porTipo.reduce((a, t) => a + Number(t.costo_total), 0))}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      )}
    </article>
  )
}

/* ------------------------------------------------------------------ */
/* Piezas y acomodo                                                    */
/* ------------------------------------------------------------------ */

function Widget({
  etiqueta,
  valor,
  detalle,
  color,
}: {
  etiqueta: string
  valor: string
  detalle?: string
  color?: string
}) {
  return (
    <div className="rounded-xl border border-slate-200 px-3 py-2.5 print:border-slate-300">
      <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{etiqueta}</p>
      <p className="text-lg font-bold tracking-tight" style={color ? { color } : undefined}>
        {valor}
      </p>
      {detalle && <p className="text-[10px] text-slate-400">{detalle}</p>}
    </div>
  )
}

function Encabezado({ children }: { children: React.ReactNode }) {
  return (
    <thead className="table-header-group">
      <tr
        className="text-[10px] font-bold uppercase tracking-wide text-white [-webkit-print-color-adjust:exact] [print-color-adjust:exact]"
        style={{ backgroundColor: AZUL }}
      >
        {children}
      </tr>
    </thead>
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

/** El detalle diario, por día, del más reciente al más viejo. */
function agruparPorFecha(filas: FilaAvance[]): [string, FilaAvance[]][] {
  const mapa = new Map<string, FilaAvance[]>()
  for (const f of filas) mapa.set(f.fecha, [...(mapa.get(f.fecha) ?? []), f])
  return [...mapa.entries()].sort((a, b) => b[0].localeCompare(a[0]))
}

/** Los lotes, agrupados por su zona. */
function agruparPorZona(filas: FilaPorLote[]): [string, FilaPorLote[]][] {
  const mapa = new Map<string, FilaPorLote[]>()
  for (const f of filas) {
    const zona = f.zona ?? 'Sin zona'
    mapa.set(zona, [...(mapa.get(zona) ?? []), f])
  }
  return [...mapa.entries()].sort((a, b) => a[0].localeCompare(b[0], 'es'))
}

function costoPorManzana(filas: FilaPorTipoSiembra[]): number | null {
  const area = filas.reduce((a, t) => a + Number(t.area_real), 0)
  if (area <= 0) return null
  return filas.reduce((a, t) => a + Number(t.costo_total), 0) / area
}
