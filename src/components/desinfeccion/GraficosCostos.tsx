'use client'

/**
 * Los dos gráficos del reporte de desinfección, en SVG escrito a mano.
 *
 * Sin librerías, por lo mismo que en rotación y trasplante: el reporte se
 * abre desde el teléfono y se IMPRIME. Un gráfico que sólo existe mientras
 * corre JavaScript no sale en el papel, y uno que necesita el ratón encima
 * para decir su número no sirve en una hoja que se firma. Por eso cada
 * valor está escrito al lado de su forma.
 *
 *   · **Composición** — de qué está hecho el costo de cada lote. Es una
 *     barra apilada y no tres barras sueltas porque la pregunta es «de
 *     este costo, cuánto es químico», y eso se lee en la proporción.
 *
 *   · **Plan contra real** — lo que se presupuestó frente a lo que llevó.
 *     En escala COMÚN: si cada fila se normalizara a lo suyo, un lote al
 *     40 % se vería igual de lleno que uno al 100 %.
 */

import { n2 } from '@/lib/trasplante/formato'

const QUIMICO = '#0369a1'
const PERSONAL = '#047857'
const LOGISTICA = '#b45309'
const GRIS = '#e2e8f0'
const ROJO = '#b91c1c'

const ALTO_FILA = 30
const ANCHO_ETIQUETA = 120
const ANCHO = 640
const ANCHO_BARRA = ANCHO - ANCHO_ETIQUETA - 80

export type BarraComposicion = {
  etiqueta: string
  quimico: number
  personal: number
  logistica: number
}

export function GraficoComposicion({ filas, tope = 10 }: { filas: BarraComposicion[]; tope?: number }) {
  const conDatos = filas.filter((f) => f.quimico + f.personal + f.logistica > 0)
  if (conDatos.length === 0) {
    return <p className="py-6 text-center text-xs text-slate-400">Todavía no hay costos que repartir.</p>
  }

  const visibles = [...conDatos]
    .sort((a, b) => b.quimico + b.personal + b.logistica - (a.quimico + a.personal + a.logistica))
    .slice(0, tope)
  const escondidas = conDatos.length - visibles.length

  const maximo = Math.max(...visibles.map((f) => f.quimico + f.personal + f.logistica), 1)
  const alto = visibles.length * ALTO_FILA + 12

  return (
    <figure className="flex flex-col gap-1">
      <svg
        viewBox={`0 0 ${ANCHO} ${alto}`}
        className="w-full [-webkit-print-color-adjust:exact] [print-color-adjust:exact]"
        style={{ maxHeight: alto * 1.15 }}
        role="img"
        aria-label="De qué está hecho el costo de cada lote"
      >
        {visibles.map((f, i) => {
          const y = i * ALTO_FILA + 6
          const total = f.quimico + f.personal + f.logistica
          const w = (v: number) => (v / maximo) * ANCHO_BARRA
          const xPersonal = ANCHO_ETIQUETA + w(f.quimico)
          const xLogistica = xPersonal + w(f.personal)

          return (
            <g key={f.etiqueta}>
              <text x="0" y={y + 13} style={{ fontSize: 11, fontWeight: 600 }} className="fill-slate-700">
                {f.etiqueta.length > 18 ? `${f.etiqueta.slice(0, 17)}…` : f.etiqueta}
              </text>
              <rect x={ANCHO_ETIQUETA} y={y} width={Math.max(w(f.quimico), 0)} height={16} fill={QUIMICO} />
              <rect x={xPersonal} y={y} width={Math.max(w(f.personal), 0)} height={16} fill={PERSONAL} />
              <rect x={xLogistica} y={y} width={Math.max(w(f.logistica), 0)} height={16} fill={LOGISTICA} />
              <text
                x={ANCHO_ETIQUETA + w(total) + 6}
                y={y + 12}
                style={{ fontSize: 10 }}
                className="fill-slate-500"
              >
                {n2(total)}
              </text>
            </g>
          )
        })}
      </svg>

      <figcaption className="flex flex-wrap items-center gap-3 text-[10px] text-slate-400">
        <Clave color={QUIMICO} texto="Químico" />
        <Clave color={PERSONAL} texto="Mano de obra" />
        <Clave color={LOGISTICA} texto="Logística absorbida" />
        {escondidas > 0 && <span>· {escondidas} más en la tabla</span>}
      </figcaption>
    </figure>
  )
}

export type BarraPlanReal = {
  etiqueta: string
  plan: number
  real: number
}

export function GraficoPlanReal({
  filas,
  tope = 10,
  unidad = 'L',
}: {
  filas: BarraPlanReal[]
  tope?: number
  unidad?: string
}) {
  const conDatos = filas.filter((f) => f.plan > 0 || f.real > 0)
  if (conDatos.length === 0) {
    return (
      <p className="py-6 text-center text-xs text-slate-400">
        Todavía no hay con qué comparar: hace falta plan y ejecución del mismo lote.
      </p>
    )
  }

  const visibles = [...conDatos]
    .sort((a, b) => Math.max(b.plan, b.real) - Math.max(a.plan, a.real))
    .slice(0, tope)
  const escondidas = conDatos.length - visibles.length

  const maximo = Math.max(...visibles.map((f) => Math.max(f.plan, f.real)), 1)
  const alto = visibles.length * (ALTO_FILA + 6) + 12

  return (
    <figure className="flex flex-col gap-1">
      <svg
        viewBox={`0 0 ${ANCHO} ${alto}`}
        className="w-full [-webkit-print-color-adjust:exact] [print-color-adjust:exact]"
        style={{ maxHeight: alto * 1.15 }}
        role="img"
        aria-label="Costo planificado contra costo real"
      >
        {visibles.map((f, i) => {
          const y = i * (ALTO_FILA + 6) + 4
          const anchoPlan = (f.plan / maximo) * ANCHO_BARRA
          const anchoReal = (f.real / maximo) * ANCHO_BARRA
          // Pasarse del plan es la única noticia mala del gráfico, así que
          // es la única que cambia de color.
          const excedido = f.plan > 0 && f.real > f.plan

          return (
            <g key={f.etiqueta}>
              <text x="0" y={y + 11} style={{ fontSize: 11, fontWeight: 600 }} className="fill-slate-700">
                {f.etiqueta.length > 18 ? `${f.etiqueta.slice(0, 17)}…` : f.etiqueta}
              </text>
              <rect x={ANCHO_ETIQUETA} y={y} width={Math.max(anchoPlan, 1)} height={11} rx={2} fill={GRIS} />
              <rect
                x={ANCHO_ETIQUETA}
                y={y + 13}
                width={Math.max(anchoReal, 1)}
                height={11}
                rx={2}
                fill={excedido ? ROJO : PERSONAL}
              />
              <text
                x={ANCHO_ETIQUETA + Math.max(anchoPlan, anchoReal) + 6}
                y={y + 17}
                style={{ fontSize: 10 }}
                className={excedido ? 'fill-red-700' : 'fill-slate-500'}
              >
                {n2(f.real)} / {n2(f.plan)}
              </text>
            </g>
          )
        })}
      </svg>

      <figcaption className="flex flex-wrap items-center gap-3 text-[10px] text-slate-400">
        <Clave color={GRIS} texto={`Planificado (${unidad})`} />
        <Clave color={PERSONAL} texto={`Real (${unidad})`} />
        <Clave color={ROJO} texto="Pasado del plan" />
        {escondidas > 0 && <span>· {escondidas} más en la tabla</span>}
      </figcaption>
    </figure>
  )
}

function Clave({ color, texto }: { color: string; texto: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className="inline-block h-2 w-4 rounded-sm" style={{ backgroundColor: color }} />
      {texto}
    </span>
  )
}
