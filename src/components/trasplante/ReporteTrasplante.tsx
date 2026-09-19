/**
 * Reporte gerencial de trasplante.
 *
 * Sólo dibuja: los cinco bloques ya vienen resueltos de la base y
 * agrupados por el servicio. El membrete va dentro del `<thead>` del
 * detalle diario para que se repita en cada hoja impresa.
 */

import { Fragment } from 'react'
import { GraficoSemanas } from './GraficoSemanas'
import { Porcentaje } from './Porcentaje'
import {
  agruparPorFecha,
  agruparZonas,
  resumirVariedades,
  semanasParaGrafico,
  totalGeneral,
  type CeldaCiclo,
} from '@/lib/trasplante/servicio'
import { AZUL, ETIQUETA_CICLO, fechaCorta, fechaLarga, n0, n2, pct } from '@/lib/trasplante/formato'
import type {
  FilaEstadistica,
  FilaSemana,
  FilaSiembra,
  FilaVariedad,
  FilaZona,
} from '@/lib/trasplante/tipos'

export function ReporteTrasplante({
  temporada,
  desde,
  hasta,
  estadisticas,
  variedades,
  zonas,
  semanas,
  siembras,
}: {
  temporada: string
  desde: string
  hasta: string
  estadisticas: FilaEstadistica[]
  variedades: FilaVariedad[]
  zonas: FilaZona[]
  semanas: FilaSemana[]
  siembras: FilaSiembra[]
}) {
  const esRango = desde !== hasta
  const total = totalGeneral(estadisticas)
  const dias = agruparPorFecha(siembras)
  const zonasAgrupadas = agruparZonas(zonas)
  const puntos = semanasParaGrafico(semanas)
  const porVariedad = resumirVariedades(variedades)
  // Dos columnas de texto más tres por ciclo más las tres del total.
  const anchoVariedad = `${260 + (porVariedad.ciclos.length + 1) * 180}px`
  const totalDiario = siembras.reduce((a, f) => a + Number(f.avance_mz), 0)

  const membrete = (
    <div className="text-center">
      <p className="text-lg font-bold uppercase tracking-tight sm:text-xl" style={{ color: AZUL }}>
        Agropecuaria Montelíbano S.A.
      </p>
      <p
        className="mt-0.5 text-sm font-bold uppercase tracking-tight sm:text-base"
        style={{ color: AZUL }}
      >
        Reporte avance diario: Trasplante del {fechaLarga(desde)} al {fechaLarga(hasta)}
      </p>
      <p className="mt-0.5 text-xs font-semibold uppercase tracking-widest text-slate-600">
        Torre Control Finca Santa Rosa
      </p>
      <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">{temporada}</p>
    </div>
  )

  return (
    <article className="hoja-reporte flex flex-col gap-5 rounded-2xl border border-slate-200 bg-white p-4 shadow-[var(--shadow-card)] sm:p-6 print:rounded-none print:border-0 print:p-0 print:shadow-none">
      {/* El membrete va una vez arriba, en pantalla y en papel. Repetirlo
          por hoja sólo funciona metido en el `thead` de UNA tabla, y este
          reporte son cinco secciones: puesto en la primera saldría dos
          veces en la primera página. Lo que sí se repite en cada hoja son
          los títulos de columna de cada tabla. */}
      <header className="border-b-2 pb-3" style={{ borderColor: AZUL }}>
        {membrete}
      </header>

      {/* ==================== 1 · ESTADÍSTICAS GLOBALES =================== */}
      <section>
        <Titulo numero={1}>Estadísticas globales</Titulo>
        <div className="scroll-suave overflow-x-auto">
          <table className="w-full min-w-[620px] border-collapse text-sm">
            <Encabezado>
              <th className="px-2 py-1.5 text-left">Ciclo</th>
              <th className="px-2 py-1.5 text-right">Área planificada</th>
              <th className="px-2 py-1.5 text-right">Área sembrada</th>
              <th className="px-2 py-1.5 text-right">Pendiente</th>
              <th className="px-2 py-1.5 text-right">% Avance</th>
              <th className="px-2 py-1.5 text-right">Plantas</th>
              <th className="px-2 py-1.5 text-right">Plantas/mz</th>
              <th className="px-2 py-1.5 text-right">Lotes</th>
            </Encabezado>
            <tbody>
              {estadisticas.map((e) => (
                <tr key={e.ciclo} className="border-b border-slate-100">
                  <td className="px-2 py-1 font-semibold text-slate-700">
                    {ETIQUETA_CICLO(e.ciclo)}
                  </td>
                  <td className="px-2 py-1 text-right tabular-nums">{n2(e.area_plan)}</td>
                  <td className="px-2 py-1 text-right font-semibold tabular-nums text-slate-900">
                    {n2(e.area_real)}
                  </td>
                  <td className="px-2 py-1 text-right tabular-nums">{n2(e.pendiente)}</td>
                  <td className="px-2 py-1 text-right tabular-nums">
                    <Porcentaje valor={e.pct} />
                  </td>
                  <td className="px-2 py-1 text-right tabular-nums">{n0(e.plantas)}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{n2(e.plantas_mz)}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{n0(e.lotes)}</td>
                </tr>
              ))}
              <tr className="border-t-2 text-sm font-bold" style={{ borderColor: AZUL }}>
                <td className="px-2 py-1.5">Total general</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{n2(total.area_plan)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{n2(total.area_real)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{n2(total.pendiente)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{pct(total.pct)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{n0(total.plantas)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{n2(total.plantas_mz)}</td>
                <td className="px-2 py-1.5" />
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* ======================= 2 · AVANCE DIARIO ======================== */}
      <section>
        <Titulo numero={2}>
          Avance diario{esRango ? ` · del ${fechaCorta(desde)} al ${fechaCorta(hasta)}` : ''}
        </Titulo>

        {dias.length === 0 ? (
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-500">
            No hay siembra registrada {esRango ? 'en el rango' : `el ${fechaLarga(hasta)}`}.
          </p>
        ) : (
          <div className="scroll-suave overflow-x-auto">
            <table className="w-full min-w-[900px] border-collapse text-sm">
              <thead className="table-header-group">
                <tr
                  className="text-left text-[10px] font-bold uppercase tracking-wide text-white [-webkit-print-color-adjust:exact] [print-color-adjust:exact]"
                  style={{ backgroundColor: AZUL }}
                >
                  <th className="px-2 py-1.5">Fecha</th>
                  <th className="px-2 py-1.5">Semana</th>
                  <th className="px-2 py-1.5">UT</th>
                  <th className="px-2 py-1.5">Zona</th>
                  <th className="px-2 py-1.5">Ciclo</th>
                  <th className="px-2 py-1.5">Variedad</th>
                  <th className="px-2 py-1.5">Lote variedad</th>
                  <th className="px-2 py-1.5 text-right">Avance mz</th>
                  <th className="px-2 py-1.5 text-right">Plantas</th>
                </tr>
              </thead>
              <tbody>
                {dias.map(([fecha, delDia]) => {
                  const mz = delDia.reduce((a, f) => a + Number(f.avance_mz), 0)
                  const cuerpo = delDia.map((f, i) => (
                    <tr key={f.id} className="border-b border-slate-100">
                      <td className="whitespace-nowrap px-2 py-1 text-slate-500">
                        {i === 0 ? fechaCorta(fecha) : ''}
                      </td>
                      <td className="px-2 py-1 text-slate-400">{i === 0 ? f.semana : ''}</td>
                      <td className="whitespace-nowrap px-2 py-1 font-semibold text-slate-800">
                        {f.ut}
                      </td>
                      <td className="px-2 py-1 text-slate-500">{f.zona ?? '—'}</td>
                      <td className="px-2 py-1 text-slate-500">{f.ciclo}</td>
                      <td className="px-2 py-1 text-slate-700">{f.variedad}</td>
                      <td className="px-2 py-1 text-xs text-slate-400">{f.lote_variedad ?? '—'}</td>
                      <td className="px-2 py-1 text-right font-semibold tabular-nums text-slate-900">
                        {n2(f.avance_mz)}
                      </td>
                      <td className="px-2 py-1 text-right tabular-nums text-slate-600">
                        {n0(f.plantas_reportadas)}
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
                          <td className="px-2 py-1" colSpan={7}>
                            Subtotal {fechaLarga(fecha)}
                          </td>
                          <td className="px-2 py-1 text-right tabular-nums">{n2(mz)}</td>
                          <td className="px-2 py-1 text-right tabular-nums">
                            {n0(delDia.reduce((a, f) => a + Number(f.plantas_reportadas ?? 0), 0))}
                          </td>
                        </tr>
                      )
                    : cuerpo
                })}
                <tr className="border-t-2 text-sm font-bold" style={{ borderColor: AZUL }}>
                  <td className="px-2 py-1.5" colSpan={7}>
                    Total general
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{n2(totalDiario)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    {n0(siembras.reduce((a, f) => a + Number(f.plantas_reportadas ?? 0), 0))}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* =================== 3 · CUMPLIMIENTO POR VARIEDAD ================ */}
      {/*
          Acumulado desde el inicio de la temporada HASTA LA FECHA DE CORTE,
          los dos lados: el plan cuenta lo que tocaba sembrar hasta ese día,
          no el de la temporada entera. Comparar lo sembrado al 15 de
          septiembre contra el plan de toda la campaña daba un cumplimiento
          del 20 % donde el avance real era del 89 %.

          La tabla es jerárquica: un bloque por ciclo y, a la derecha y
          separado, el TOTAL de la variedad. Los ciclos sin nada —ni plan
          vigente ni siembra— no se dibujan: una columna de ceros hace creer
          que se va atrasado en algo que todavía no empieza.
      */}
      {porVariedad.variedades.length > 0 && (
        <section>
          <Titulo numero={3}>
            Cumplimiento por variedad · acumulado al {fechaLarga(hasta)}
          </Titulo>
          <div className="scroll-suave overflow-x-auto">
            <table className="w-full border-collapse text-sm" style={{ minWidth: anchoVariedad }}>
              <thead>
                <tr style={{ backgroundColor: AZUL, color: 'white' }} className="[-webkit-print-color-adjust:exact] [print-color-adjust:exact]">
                  <th rowSpan={2} className="border-r border-white/20 px-2 py-1.5 text-left">
                    Variedad
                  </th>
                  <th rowSpan={2} className="border-r border-white/20 px-2 py-1.5 text-left">
                    Cultivo
                  </th>
                  {porVariedad.ciclos.map((c) => (
                    <th
                      key={c}
                      colSpan={3}
                      className="border-r border-white/20 px-2 py-1.5 text-center"
                    >
                      Ciclo {c}
                    </th>
                  ))}
                  <th colSpan={3} className="bg-black/15 px-2 py-1.5 text-center">
                    Total variedad
                  </th>
                </tr>
                <tr
                  style={{ backgroundColor: AZUL, color: 'white' }}
                  className="text-[11px] [-webkit-print-color-adjust:exact] [print-color-adjust:exact]"
                >
                  {porVariedad.ciclos.map((c) => (
                    <Fragment key={c}>
                      <th className="px-2 py-1 text-right font-semibold">Plan</th>
                      <th className="px-2 py-1 text-right font-semibold">Real</th>
                      <th className="border-r border-white/20 px-2 py-1 text-right font-semibold">
                        %
                      </th>
                    </Fragment>
                  ))}
                  <th className="bg-black/15 px-2 py-1 text-right font-semibold">Plan</th>
                  <th className="bg-black/15 px-2 py-1 text-right font-semibold">Real</th>
                  <th className="bg-black/15 px-2 py-1 text-right font-semibold">%</th>
                </tr>
              </thead>

              <tbody>
                {porVariedad.variedades.map((v) => (
                  <tr key={v.variedad} className="border-b border-slate-100">
                    <td className="px-2 py-1 font-semibold text-slate-800">{v.variedad}</td>
                    <td className="px-2 py-1 text-slate-500">{v.cultivo ?? '—'}</td>
                    {porVariedad.ciclos.map((c) => (
                      <CeldasCiclo key={c} celda={v.porCiclo.get(c)} />
                    ))}
                    <CeldasCiclo celda={v.total} destacado />
                  </tr>
                ))}
              </tbody>

              <tfoot>
                <tr className="border-t-2 border-slate-300 bg-slate-50 font-bold text-slate-900">
                  <td className="px-2 py-1.5" colSpan={2}>
                    Total general
                  </td>
                  {porVariedad.ciclos.map((c) => (
                    <CeldasCiclo key={c} celda={porVariedad.totalPorCiclo.get(c)} />
                  ))}
                  <CeldasCiclo celda={porVariedad.total} destacado />
                </tr>
              </tfoot>
            </table>
          </div>

          {porVariedad.planSinFecha > 0 && (
            <p className="mt-2 text-[11px] text-amber-700">
              Hay {n2(porVariedad.planSinFecha)} mz planificadas sin fecha prevista de siembra: no
              se pueden situar antes o después del corte, así que no entran en la columna Plan.
              Cárgales la fecha en el plan de siembra para que el cumplimiento sea exacto.
            </p>
          )}
        </section>
      )}

      {/* ===================== 4 · CUMPLIMIENTO POR ZONA ================== */}
      {zonasAgrupadas.length > 0 && (
        <section>
          <Titulo numero={4}>Cumplimiento por zona</Titulo>
          <div className="scroll-suave overflow-x-auto">
            <table className="w-full min-w-[560px] border-collapse text-sm">
              <Encabezado>
                <th className="px-2 py-1.5 text-left">Zona</th>
                <th className="px-2 py-1.5 text-left">Encargado</th>
                <th className="px-2 py-1.5 text-left">Ciclo</th>
                <th className="px-2 py-1.5 text-right">Plan</th>
                <th className="px-2 py-1.5 text-right">Sembrado</th>
                <th className="px-2 py-1.5 text-right">%</th>
              </Encabezado>
              <tbody>
                {zonasAgrupadas.map(([zona, filas]) => {
                  const plan = filas.reduce((a, f) => a + Number(f.area_plan), 0)
                  const real = filas.reduce((a, f) => a + Number(f.area_real), 0)
                  return filas
                    .map((f, i) => (
                      <tr key={`${zona}-${f.ciclo}`} className="border-b border-slate-100">
                        <td className="px-2 py-1 font-semibold text-slate-800">
                          {i === 0 ? zona : ''}
                        </td>
                        <td className="px-2 py-1 text-slate-500">
                          {i === 0 ? (f.encargado ?? '—') : ''}
                        </td>
                        <td className="px-2 py-1 text-slate-500">Ciclo {f.ciclo}</td>
                        <td className="px-2 py-1 text-right tabular-nums">{n2(f.area_plan)}</td>
                        <td className="px-2 py-1 text-right tabular-nums">{n2(f.area_real)}</td>
                        <td className="px-2 py-1 text-right">
                          <Porcentaje valor={f.pct} />
                        </td>
                      </tr>
                    ))
                    .concat(
                      <tr
                        key={`${zona}-total`}
                        className="border-b-2 border-slate-300 bg-slate-50 font-bold print:bg-white"
                      >
                        <td className="px-2 py-1" colSpan={3}>
                          Total {zona}
                        </td>
                        <td className="px-2 py-1 text-right tabular-nums">{n2(plan)}</td>
                        <td className="px-2 py-1 text-right tabular-nums">{n2(real)}</td>
                        <td className="px-2 py-1 text-right tabular-nums">
                          {pct(plan > 0 ? (real / plan) * 100 : null)}
                        </td>
                      </tr>
                    )
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ==================== 5 · CUMPLIMIENTO POR SEMANA ================= */}
      {puntos.length > 0 && (
        <section>
          <Titulo numero={5}>Cumplimiento por semana</Titulo>
          <GraficoSemanas puntos={puntos} />

          <div className="scroll-suave mt-3 overflow-x-auto">
            <table className="w-full min-w-[480px] border-collapse text-sm">
              <Encabezado>
                <th className="px-2 py-1.5 text-left">Semana</th>
                <th className="px-2 py-1.5 text-right">Planeado</th>
                <th className="px-2 py-1.5 text-right">Real</th>
                <th className="px-2 py-1.5 text-right">Diferencia</th>
                <th className="px-2 py-1.5 text-right">Acum. plan</th>
                <th className="px-2 py-1.5 text-right">Acum. real</th>
                <th className="px-2 py-1.5 text-right">Plantas</th>
              </Encabezado>
              <tbody>
                {puntos.map((p) => (
                  <tr key={p.semana} className="border-b border-slate-100">
                    <td className="px-2 py-1 font-semibold text-slate-700">{p.semana}</td>
                    <td className="px-2 py-1 text-right tabular-nums text-slate-500">
                      {n2(p.plan)}
                    </td>
                    <td className="px-2 py-1 text-right font-semibold tabular-nums text-slate-900">
                      {n2(p.area)}
                    </td>
                    <td
                      className={`px-2 py-1 text-right font-semibold tabular-nums ${
                        p.brecha < 0 ? 'text-red-700' : 'text-emerald-700'
                      }`}
                    >
                      {p.brecha > 0 ? '+' : ''}
                      {n2(p.brecha)}
                    </td>
                    <td className="px-2 py-1 text-right tabular-nums text-slate-400">
                      {n2(p.acumuladoPlan)}
                    </td>
                    <td className="px-2 py-1 text-right tabular-nums text-slate-500">
                      {n2(p.acumulado)}
                    </td>
                    <td className="px-2 py-1 text-right tabular-nums text-slate-600">
                      {n0(p.plantas)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </article>
  )
}

function Encabezado({ children }: { children: React.ReactNode }) {
  return (
    <thead>
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

/**
 * Las tres celdas de un bloque —plan, real y porcentaje—, que se repiten
 * por cada ciclo y otra vez en el total.
 *
 * Un ciclo sin datos para esa variedad enseña rayas y no ceros: cero
 * planificado y cero sembrado no es lo mismo que «aquí no toca nada».
 */
function CeldasCiclo({ celda, destacado }: { celda?: CeldaCiclo; destacado?: boolean }) {
  const fondo = destacado ? 'bg-slate-100/70' : ''
  if (!celda) {
    return (
      <>
        <td className={`px-2 py-1 text-right text-slate-300 ${fondo}`}>—</td>
        <td className={`px-2 py-1 text-right text-slate-300 ${fondo}`}>—</td>
        <td className={`border-r border-slate-100 px-2 py-1 text-right text-slate-300 ${fondo}`}>
          —
        </td>
      </>
    )
  }
  return (
    <>
      <td className={`px-2 py-1 text-right tabular-nums text-slate-500 ${fondo}`}>
        {n2(celda.area_plan)}
      </td>
      <td className={`px-2 py-1 text-right font-semibold tabular-nums text-slate-900 ${fondo}`}>
        {n2(celda.area_real)}
      </td>
      <td className={`border-r border-slate-100 px-2 py-1 text-right ${fondo}`}>
        <Porcentaje valor={celda.pct} />
      </td>
    </>
  )
}
