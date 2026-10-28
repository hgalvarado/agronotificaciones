/**
 * Reporte gerencial de trasplante.
 *
 * Sólo dibuja: los cinco bloques ya vienen resueltos de la base y
 * agrupados por el servicio.
 *
 * 79 · Rediseño en tarjetas: indicadores globales y por ciclo con barra,
 * zonas como tarjetas, y el avance diario con plan contra real (variedad
 * y manzanas) que trae `v_siembras` desde la migración 79. Las tablas que
 * quedan son las que de verdad son tablas: el detalle diario, la matriz
 * por variedad y la semanal.
 */

import { Fragment } from 'react'
import { GraficoSemanas } from './GraficoSemanas'
import { Porcentaje } from './Porcentaje'
import {
  agruparZonas,
  resumirVariedades,
  semanasParaGrafico,
  totalGeneral,
  type CeldaCiclo,
} from '@/lib/trasplante/servicio'
import { AZUL, COLOR_SEMAFORO, CORP, ETIQUETA_CICLO, semaforo, fechaCorta, fechaLarga, n0, n2, pct } from '@/lib/trasplante/formato'
import type {
  FilaAvanceDiario,
  FilaEstadistica,
  FilaSemana,
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
  diario,
}: {
  temporada: string
  desde: string
  hasta: string
  estadisticas: FilaEstadistica[]
  variedades: FilaVariedad[]
  zonas: FilaZona[]
  semanas: FilaSemana[]
  /** Cruce maestro plan ⟷ real del rango (migración 82). */
  diario: FilaAvanceDiario[]
}) {
  const esRango = desde !== hasta
  const total = totalGeneral(estadisticas)
  const dias = agruparDiario(diario)
  const zonasAgrupadas = agruparZonas(zonas)
  const puntos = semanasParaGrafico(semanas)
  const porVariedad = resumirVariedades(variedades)
  // Dos columnas de texto más tres por ciclo más las tres del total.
  const anchoVariedad = `${260 + (porVariedad.ciclos.length + 1) * 180}px`
  const totalReal = suma(diario, (f) => f.mz_real)
  const totalPlan = suma(diario, (f) => f.mz_plan)
  const totalPlantas = suma(diario, (f) => f.plantas)

  // Membrete institucional (guía 82): el nombre de la empresa en Azul
  // Marino y serif de titulares (Merriweather/Playfair si están
  // instaladas), el título del reporte en Verde Agrícola, y dos líneas de
  // marca —marino y verde— separando la cabecera del cuerpo.
  const membrete = (
    <div className="text-center">
      <p
        className="text-xl font-black tracking-tight sm:text-2xl"
        style={{ color: CORP.marino, fontFamily: 'var(--font-display)' }}
      >
        Agropecuaria Montelíbano S.A.
      </p>
      <p className="text-[10px] font-semibold uppercase tracking-[0.25em]" style={{ color: CORP.marino }}>
        Grupo Agrolíbano
      </p>
      <p
        className="mt-2 text-base font-bold sm:text-lg"
        style={{ color: AZUL, fontFamily: 'var(--font-display)' }}
      >
        Reporte de avance diario de trasplante
      </p>
      <p className="text-sm font-semibold" style={{ color: CORP.marino }}>
        Del {fechaLarga(desde)} al {fechaLarga(hasta)}
      </p>
      <p className="mt-1 text-xs font-semibold uppercase tracking-widest text-slate-500">
        Torre Control Finca Santa Rosa · {temporada}
      </p>
    </div>
  )

  return (
    <article className="hoja-reporte flex flex-col gap-5">
      {/* El membrete va una vez arriba, en pantalla y en papel. */}
      <header className="overflow-hidden rounded-xl bg-white shadow-[var(--shadow-card)] [-webkit-print-color-adjust:exact] [print-color-adjust:exact] print:rounded-none print:shadow-none">
        <div className="h-1.5" style={{ backgroundColor: CORP.verde }} />
        <div className="px-4 py-4">{membrete}</div>
        <div className="h-0.5" style={{ backgroundColor: CORP.marino }} />
      </header>

      {/* ==================== 1 · ESTADÍSTICAS GLOBALES =================== */}
      <Bloque numero={1} titulo={`Estadísticas globales · al ${fechaLarga(hasta)}`}>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Kpi etiqueta="Área planificada" valor={`${n2(total.area_plan)} mz`} />
          <Kpi etiqueta="Área sembrada" valor={`${n2(total.area_real)} mz`} fuerte />
          <Kpi etiqueta="Pendiente" valor={`${n2(total.pendiente)} mz`} />
          <Kpi etiqueta="% Avance" valor={pct(total.pct)} barra={total.pct} fuerte />
        </div>

        {estadisticas.length > 0 && (
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {estadisticas.map((e) => (
              <div
                key={e.ciclo}
                className="rounded-xl border border-slate-200 bg-white p-3 [-webkit-print-color-adjust:exact] [print-color-adjust:exact]"
                style={{ borderLeft: `4px solid ${CORP.lima}` }}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-sm font-bold text-slate-800">{ETIQUETA_CICLO(e.ciclo)}</span>
                  <Porcentaje valor={e.pct} />
                </div>
                <Barra valor={e.pct} />
                <dl className="mt-2 grid grid-cols-2 gap-2 text-[11px] sm:grid-cols-4">
                  <Dato etiqueta="Plan" valor={n2(e.area_plan)} />
                  <Dato etiqueta="Sembrado" valor={n2(e.area_real)} fuerte />
                  <Dato etiqueta="Pendiente" valor={n2(e.pendiente)} />
                  <Dato etiqueta="Lotes" valor={n0(e.lotes)} />
                </dl>
              </div>
            ))}
          </div>
        )}
      </Bloque>

      {/* ============ 2 · AVANCE DIARIO · CRUCE PLAN ⟷ REAL (82) ========== */}
      {/* Una fila por día, ciclo, lote y variedad: lo planificado que no se
          sembró y lo sembrado fuera de plan salen en filas propias, no
          colgados de otra. */}
      <Bloque
        numero={2}
        titulo={`Avance diario · real contra plan${esRango ? ` · del ${fechaCorta(desde)} al ${fechaCorta(hasta)}` : ''}`}
        extra={
          dias.length > 0 ? (
            <span className="text-xs" style={{ color: CORP.marino }}>
              Real <strong>{n2(totalReal)} mz</strong> · Plan <strong>{n2(totalPlan)} mz</strong> ·
              Dif.{' '}
              <strong style={{ color: colorDif(totalReal - totalPlan) }}>
                {conSigno(totalReal - totalPlan)} mz
              </strong>
            </span>
          ) : undefined
        }
      >
        {dias.length === 0 ? (
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-500">
            Ni siembra ni plan {esRango ? 'en el rango' : `el ${fechaLarga(hasta)}`}.
          </p>
        ) : (
          <div className="scroll-suave -mx-1 overflow-x-auto">
            <table className="w-full min-w-[980px] border-collapse text-sm">
              <thead className="table-header-group">
                <tr
                  className="text-left text-[10px] font-semibold uppercase tracking-wide text-white [-webkit-print-color-adjust:exact] [print-color-adjust:exact]"
                  style={{ backgroundColor: CORP.verde }}
                >
                  <th className="px-2 py-1.5">Fecha</th>
                  <th className="px-2 py-1.5">Sem.</th>
                  <th className="px-2 py-1.5">Lote</th>
                  <th className="px-2 py-1.5">Zona</th>
                  <th className="px-2 py-1.5">Ciclo</th>
                  <th className="px-2 py-1.5">Variedad</th>
                  <th className="px-2 py-1.5 text-right">Mz real</th>
                  <th className="px-2 py-1.5 text-right">Mz plan</th>
                  <th className="px-2 py-1.5 text-right">Dif real vs plan</th>
                  <th className="px-2 py-1.5 text-right">Plantas</th>
                </tr>
              </thead>
              <tbody>
                {dias.map(([fecha, delDia]) => {
                  const cuerpo = delDia.map((f, i) => (
                    <tr
                      key={f.id}
                      className="border-b even:bg-[#FAFAFA]"
                      style={{ borderColor: '#E2E8F0', color: CORP.marino }}
                    >
                      <td className="whitespace-nowrap px-2 py-1 text-slate-500">
                        {i === 0 ? fechaCorta(fecha) : ''}
                      </td>
                      <td className="px-2 py-1 text-slate-400">{i === 0 ? f.semana : ''}</td>
                      <td className="whitespace-nowrap px-2 py-1">
                        <span className="block font-semibold">{f.ut}</span>
                        {f.lote_nombre && (
                          <span className="block text-[11px] text-slate-400">{f.lote_nombre}</span>
                        )}
                      </td>
                      <td className="px-2 py-1 text-slate-500">{f.zona ?? '—'}</td>
                      <td className="px-2 py-1 text-slate-500">{f.ciclo}</td>
                      <td className="px-2 py-1">
                        {f.variedad}
                        {f.origen !== 'ambos' && <Origen origen={f.origen} />}
                      </td>
                      <td className="px-2 py-1 text-right font-semibold tabular-nums">
                        {f.mz_real === null ? '—' : n2(f.mz_real)}
                      </td>
                      <td className="px-2 py-1 text-right tabular-nums text-slate-500">
                        {f.mz_plan === null ? '—' : n2(f.mz_plan)}
                      </td>
                      <td className="px-2 py-1 text-right">
                        <Diferencia valor={Number(f.diferencia)} />
                      </td>
                      <td className="px-2 py-1 text-right tabular-nums text-slate-600">
                        {f.plantas === null ? '—' : n0(f.plantas)}
                      </td>
                    </tr>
                  ))
                  if (!esRango) return cuerpo
                  const real = suma(delDia, (f) => f.mz_real)
                  const plan = suma(delDia, (f) => f.mz_plan)
                  return cuerpo.concat(
                    <tr
                      key={`${fecha}-sub`}
                      className="border-b font-bold [-webkit-print-color-adjust:exact] [print-color-adjust:exact]"
                      style={{ backgroundColor: '#F4F6F8', borderColor: '#E2E8F0', color: CORP.marino }}
                    >
                      <td className="px-2 py-1" colSpan={6}>
                        Subtotal {fechaLarga(fecha)}
                      </td>
                      <td className="px-2 py-1 text-right tabular-nums">{n2(real)}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{n2(plan)}</td>
                      <td className="px-2 py-1 text-right">
                        <Diferencia valor={real - plan} />
                      </td>
                      <td className="px-2 py-1 text-right tabular-nums">
                        {n0(suma(delDia, (f) => f.plantas))}
                      </td>
                    </tr>
                  )
                })}
                <tr
                  className="border-t-2 text-sm font-bold"
                  style={{ borderColor: CORP.verde, color: CORP.marino }}
                >
                  <td className="px-2 py-1.5" colSpan={6}>
                    Total general
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{n2(totalReal)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{n2(totalPlan)}</td>
                  <td className="px-2 py-1.5 text-right">
                    <Diferencia valor={totalReal - totalPlan} />
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{n0(totalPlantas)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-2 text-[11px] text-slate-500">
          <span style={{ color: CORP.naranja }}>▼</span> sembrado por debajo del plan ·{' '}
          <span style={{ color: CORP.lima }}>▲</span> por encima · «Sin siembra»: el plan lo fechaba
          y no se sembró · «Fuera de plan»: se sembró sin plan para ese día. El plan sin fecha no
          entra.
        </p>
      </Bloque>

      {/* =================== 3 · CUMPLIMIENTO POR VARIEDAD ================ */}
      {/*
          Acumulado desde el inicio de la temporada HASTA LA FECHA DE CORTE,
          los dos lados. Tabla jerárquica: un bloque por ciclo y el TOTAL de
          la variedad a la derecha. Los ciclos sin nada no se dibujan.
      */}
      {porVariedad.variedades.length > 0 && (
        <Bloque numero={3} titulo={`Cumplimiento por variedad · acumulado al ${fechaLarga(hasta)}`}>
          <div className="scroll-suave -mx-1 overflow-x-auto">
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
            <p className="mt-2 text-[11px]" style={{ color: CORP.naranja }}>
              Hay {n2(porVariedad.planSinFecha)} mz planificadas sin fecha prevista de siembra: no
              se pueden situar antes o después del corte, así que no entran en la columna Plan.
              Cárgales la fecha en el plan de siembra para que el cumplimiento sea exacto.
            </p>
          )}
        </Bloque>
      )}

      {/* ===================== 4 · CUMPLIMIENTO POR ZONA ================== */}
      {zonasAgrupadas.length > 0 && (
        <Bloque numero={4} titulo="Cumplimiento por zona">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {zonasAgrupadas.map(([zona, filas]) => {
              const plan = filas.reduce((a, f) => a + Number(f.area_plan), 0)
              const real = filas.reduce((a, f) => a + Number(f.area_real), 0)
              const avance = plan > 0 ? (real / plan) * 100 : null
              return (
                <div
                  key={zona}
                  className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-3 break-inside-avoid [-webkit-print-color-adjust:exact] [print-color-adjust:exact]"
                  style={{ borderLeft: `4px solid ${CORP.verde}` }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-slate-900">{zona}</p>
                      <p className="truncate text-[11px] text-slate-400">
                        {filas[0]?.encargado ?? 'Sin encargado'}
                      </p>
                    </div>
                    <Porcentaje valor={avance} />
                  </div>
                  <Barra valor={avance} />
                  <p className="text-[11px] text-slate-500">
                    <strong className="text-slate-900">{n2(real)}</strong> de {n2(plan)} mz
                  </p>
                  <ul className="flex flex-col gap-1 border-t border-slate-100 pt-2">
                    {filas.map((f) => (
                      <li key={f.ciclo} className="flex items-center gap-2 text-[11px]">
                        <span className="w-12 shrink-0 font-semibold text-slate-600">C{f.ciclo}</span>
                        <span className="min-w-0 flex-1">
                          <Barra valor={f.pct} fina />
                        </span>
                        <span className="w-24 shrink-0 text-right tabular-nums text-slate-500">
                          {n2(f.area_real)}/{n2(f.area_plan)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )
            })}
          </div>
        </Bloque>
      )}

      {/* ==================== 5 · CUMPLIMIENTO POR SEMANA ================= */}
      {puntos.length > 0 && (
        <Bloque numero={5} titulo="Cumplimiento por semana">
          <GraficoSemanas puntos={puntos} />

          <div className="scroll-suave -mx-1 mt-3 overflow-x-auto">
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
                      className="px-2 py-1 text-right font-semibold tabular-nums"
                      style={{ color: p.brecha < 0 ? CORP.naranja : CORP.verde }}
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
        </Bloque>
      )}
      {/* Pie institucional: las ondas entrelazadas del logo de Agrolíbano
          (verde vibrante, turquesa, naranja) como ancla al final. */}
      <footer className="mt-2 break-inside-avoid [-webkit-print-color-adjust:exact] [print-color-adjust:exact]">
        <svg viewBox="0 0 1200 60" preserveAspectRatio="none" className="block h-10 w-full" aria-hidden>
          <path d="M0 40 C 200 10, 400 60, 600 32 S 1000 8, 1200 30 L1200 60 L0 60 Z" fill={CORP.lima} opacity="0.9" />
          <path d="M0 46 C 220 22, 430 64, 640 40 S 1020 20, 1200 42 L1200 60 L0 60 Z" fill={CORP.turquesa} opacity="0.85" />
          <path d="M0 54 C 240 38, 460 66, 680 50 S 1040 36, 1200 52 L1200 60 L0 60 Z" fill={CORP.naranja} opacity="0.9" />
        </svg>
        <p className="mt-1 text-center text-[10px]" style={{ color: CORP.marino }}>
          Agropecuaria Montelíbano S.A. · Grupo Agrolíbano · AgroNotificaciones
        </p>
      </footer>
    </article>
  )
}

/** Suma de una columna que puede venir nula. */
function suma(filas: FilaAvanceDiario[], de: (f: FilaAvanceDiario) => number | null): number {
  return filas.reduce((a, f) => a + Number(de(f) ?? 0), 0)
}

/** El cruce agrupado por día, del más reciente al más antiguo. */
function agruparDiario(filas: FilaAvanceDiario[]): [string, FilaAvanceDiario[]][] {
  const mapa = new Map<string, FilaAvanceDiario[]>()
  for (const f of filas) mapa.set(f.fecha, [...(mapa.get(f.fecha) ?? []), f])
  return [...mapa.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([fecha, lista]) => [
      fecha,
      lista.sort(
        (x, y) =>
          x.ut.localeCompare(y.ut, 'es', { numeric: true }) ||
          x.ciclo - y.ciclo ||
          x.variedad.localeCompare(y.variedad, 'es')
      ),
    ])
}

const conSigno = (v: number) => `${v > 0.004 ? '+' : ''}${n2(v)}`

/** Naranja si falta, verde vibrante si sobra, marino si cuadra. */
function colorDif(v: number): string {
  if (v < -0.004) return CORP.naranja
  if (v > 0.004) return CORP.lima
  return CORP.marino
}

/** La diferencia real − plan con su flecha de alerta. */
function Diferencia({ valor }: { valor: number }) {
  const cuadra = Math.abs(valor) <= 0.004
  return (
    <span
      className="inline-flex items-center justify-end gap-1 font-semibold tabular-nums"
      style={{ color: cuadra ? '#94A3B8' : valor < 0 ? CORP.naranja : '#4F7A1F' }}
      title={cuadra ? 'Cuadra con el plan' : valor < 0 ? 'Por debajo del plan' : 'Por encima del plan'}
    >
      {!cuadra && <span aria-hidden>{valor < 0 ? '▼' : '▲'}</span>}
      {cuadra ? '0,00' : conSigno(valor)}
    </span>
  )
}

/** Marca de las filas que sólo existen de un lado del cruce. */
function Origen({ origen }: { origen: 'real' | 'plan' }) {
  const plan = origen === 'plan'
  return (
    <span
      className="ml-1.5 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase [-webkit-print-color-adjust:exact] [print-color-adjust:exact]"
      style={{
        backgroundColor: plan ? `${CORP.naranja}1F` : `${CORP.lima}2E`,
        color: plan ? '#B0480D' : '#44621C',
      }}
    >
      {plan ? 'Sin siembra' : 'Fuera de plan'}
    </span>
  )
}

/** Una sección del reporte como tarjeta, con su número y su título. */
function Bloque({
  numero,
  titulo,
  extra,
  children,
}: {
  numero: number
  titulo: string
  extra?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="rounded-xl border bg-white p-4 shadow-[var(--shadow-card)] sm:p-5 print:rounded-none print:border-0 print:p-0 print:shadow-none" style={{ borderColor: CORP.borde }}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <Titulo numero={numero}>{titulo}</Titulo>
        {extra}
      </div>
      {children}
    </section>
  )
}

function Kpi({
  etiqueta,
  valor,
  barra,
  fuerte,
}: {
  etiqueta: string
  valor: string
  barra?: number | null
  fuerte?: boolean
}) {
  return (
    <div
      className="flex flex-col gap-1 rounded-xl border border-slate-200 bg-white p-3 [-webkit-print-color-adjust:exact] [print-color-adjust:exact]"
      style={{ borderTop: `3px solid ${fuerte ? CORP.verde : CORP.lima}` }}
    >
      <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{etiqueta}</span>
      <span
        className="text-lg font-bold tabular-nums tracking-tight sm:text-xl"
        style={{ color: fuerte ? AZUL : undefined }}
      >
        {valor}
      </span>
      {barra !== undefined && <Barra valor={barra} />}
    </div>
  )
}

function Dato({ etiqueta, valor, fuerte }: { etiqueta: string; valor: string; fuerte?: boolean }) {
  return (
    <div>
      <dt className="text-slate-400">{etiqueta}</dt>
      <dd className={`tabular-nums ${fuerte ? 'font-bold text-slate-900' : 'text-slate-600'}`}>
        {valor}
      </dd>
    </div>
  )
}

/** Barra de avance. Se corta en 100 % para dibujar; el número dice el resto. */
function Barra({ valor, fina }: { valor: number | null | undefined; fina?: boolean }) {
  const v = valor === null || valor === undefined ? 0 : Math.max(0, Math.min(100, Number(valor)))
  // Semáforo de la guía con el valor SIN recortar: 120 % sigue siendo
  // «excelente» aunque la barra se dibuje llena.
  const s = semaforo(valor)
  const tono = s ? COLOR_SEMAFORO[s] : CORP.borde
  return (
    <div
      className={`${fina ? 'h-1.5' : 'mt-1 h-2'} w-full overflow-hidden rounded-full bg-slate-100 [-webkit-print-color-adjust:exact] [print-color-adjust:exact]`}
    >
      <div className="h-full rounded-full" style={{ width: `${v}%`, backgroundColor: tono }} />
    </div>
  )
}

function Encabezado({ children }: { children: React.ReactNode }) {
  return (
    <thead>
      <tr
        className="text-[10px] font-semibold uppercase tracking-wide text-white [-webkit-print-color-adjust:exact] [print-color-adjust:exact]"
        style={{ backgroundColor: CORP.verde }}
      >
        {children}
      </tr>
    </thead>
  )
}

function Titulo({ numero, children }: { numero: number; children: React.ReactNode }) {
  return (
    <h2
      className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wide"
      style={{ color: CORP.marino }}
    >
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
