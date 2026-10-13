'use client'

/**
 * Las dos piezas dibujadas del informe ejecutivo: el cronograma y la
 * radiografía del costo.
 *
 * SVG escrito a mano, como el resto del sistema. No es ahorro de
 * kilobytes: el informe se **imprime** y se lleva a una reunión, y un
 * gráfico que sólo existe mientras corre JavaScript no sale en el papel.
 * Por eso **cada valor está escrito al lado de su forma** y no detrás
 * del ratón.
 *
 * Los colores son los mismos tres de la 67, y son los mismos a
 * propósito: el tablero de costos y este informe hablan de las mismas
 * tres piezas, y que «químico» sea azul en una pantalla y verde en la
 * otra obligaría a releer la leyenda cada vez.
 */

import { n2 } from '@/lib/trasplante/formato'
import { porcentajeDe, type Hito, type Pieza } from '@/lib/desinfeccion/informe'

/**
 * Los tres colores del costo.
 *
 * **Validados con el script de paletas, no elegidos a ojo**: pasan la
 * banda de luminosidad, el piso de croma, el contraste contra la
 * superficie y el piso de separación para visión normal, en claro y en
 * oscuro. Su separación para daltonismo cae en la banda 6–8, que sólo es
 * legal con un segundo canal: por eso cada pieza lleva su nombre y su
 * número escritos al lado.
 */
export const COLOR = {
  quimico: '#0369a1',
  personal: '#16a34a',
  logistica: '#c2410c',
} as const

/** Tinta recesiva: la rejilla y los ejes no compiten con los datos. */
const EJE = '#cbd5e1'

/* ================================================================== */
/* El cronograma                                                       */
/* ================================================================== */

const ANCHO = 680
const ALTO_CRONO = 96

/**
 * La línea de tiempo del lote, del primer hito al último.
 *
 * ── Por qué los hitos van a escala y no repartidos ──────────────────
 *
 * Porque el dato es **cuánto tiempo pasó entre uno y otro**. Repartirlos
 * a distancias iguales dibujaría igual un preriego dos días antes de la
 * aplicación que uno dos meses antes, y esa distancia es justo lo que se
 * viene a mirar: la desinfección se aplica ~70 días antes de sembrar, y
 * ver ese hueco es ver el ciclo.
 *
 * Con un solo hito no hay escala posible y se dibuja centrado: una línea
 * de tiempo de un punto no miente, simplemente no dice nada más.
 */
export function Cronograma({ hitos }: { hitos: Hito[] }) {
  if (hitos.length === 0) {
    return (
      <p className="py-6 text-center text-xs text-slate-400">
        Todavía no hay fechas que ordenar en una línea de tiempo.
      </p>
    )
  }

  const dias = (iso: string | null) =>
    iso ? Date.parse(`${iso}T12:00:00Z`) / 86_400_000 : 0

  const valores = hitos.map((h) => dias(h.fecha))
  const min = Math.min(...valores)
  const max = Math.max(...valores)
  const margen = 70
  const util = ANCHO - margen * 2

  const x = (h: Hito) =>
    max === min ? ANCHO / 2 : margen + ((dias(h.fecha) - min) / (max - min)) * util

  return (
    <figure className="flex flex-col gap-1">
      <svg
        viewBox={`0 0 ${ANCHO} ${ALTO_CRONO}`}
        className="w-full [-webkit-print-color-adjust:exact] [print-color-adjust:exact]"
        role="img"
        aria-label={`Cronograma del lote: ${hitos
          .map((h) => `${h.etiqueta} el ${h.fecha}`)
          .join(', ')}`}
      >
        <line x1={margen} y1={46} x2={ANCHO - margen} y2={46} stroke={EJE} strokeWidth={2} />

        {hitos.map((h, i) => {
          const cx = x(h)
          // Las etiquetas se alternan arriba y abajo: con cuatro hitos en
          // dos meses, dos de ellos caen casi en el mismo sitio y los
          // textos se pisarían.
          const arriba = i % 2 === 0
          return (
            <g key={h.clave}>
              {/* Lo previsto va hueco y lo ocurrido relleno: es el
                  segundo canal que distingue un plan de un hecho sin
                  depender del color. */}
              <circle
                cx={cx}
                cy={46}
                r={7}
                fill={h.previsto ? '#ffffff' : COLOR.quimico}
                stroke={COLOR.quimico}
                strokeWidth={2}
                strokeDasharray={h.previsto ? '3 2' : undefined}
              />
              <text
                x={cx}
                y={arriba ? 22 : 72}
                textAnchor="middle"
                fontSize="10"
                fontWeight="600"
                fill="#334155"
              >
                {h.etiqueta}
              </text>
              <text
                x={cx}
                y={arriba ? 34 : 84}
                textAnchor="middle"
                fontSize="9"
                fill="#94a3b8"
              >
                {h.fecha}
                {h.ddt !== null && h.clave !== 'siembra' ? ` · ${h.ddt} DDT` : ''}
              </text>
            </g>
          )
        })}
      </svg>
      <figcaption className="px-1 text-[11px] text-slate-400">
        A escala de días. El círculo hueco es lo previsto; el relleno, lo que ocurrió. El DDT se
        cuenta contra la siembra: negativo quiere decir que todavía faltaba para trasplantar.
      </figcaption>
    </figure>
  )
}

/* ================================================================== */
/* La radiografía del costo                                            */
/* ================================================================== */

const ALTO_BARRA = 26

/**
 * En qué se fue el dinero, en una barra apilada.
 *
 * ── Por qué una barra y no una dona ─────────────────────────────────
 *
 * Porque aquí la pregunta no es sólo «qué proporción», es «cuál pesa
 * más». Una barra apilada ordenada de mayor a menor contesta las dos de
 * un vistazo y además cabe en el ancho de una tarjeta, que es donde
 * tiene que vivir. La dona del tablero de la 67 contesta otra pregunta
 * —la composición de un periodo entero— y por eso sigue allí.
 */
export function RadiografiaCosto({ piezas }: { piezas: Pieza[] }) {
  const total = piezas.reduce((a, p) => a + p.valor, 0)

  if (total <= 0) {
    return (
      <p className="py-6 text-center text-xs text-slate-400">
        Todavía no hay costos que repartir en este lote.
      </p>
    )
  }

  // El arranque de cada tramo es la suma de los anteriores. Se calcula
  // con `reduce` y no acumulando una variable suelta: una variable que se
  // reasigna durante el dibujo sobrevive al render y la siguiente vuelta
  // empieza donde acabó la anterior.
  const tramos = piezas.map((p, i) => {
    const previas = piezas.slice(0, i).reduce((a, x) => a + x.valor, 0)
    return {
      ...p,
      x: (previas / total) * ANCHO,
      ancho: (p.valor / total) * ANCHO,
      pct: porcentajeDe(p, piezas),
    }
  })

  return (
    <figure className="flex flex-col gap-2">
      <svg
        viewBox={`0 0 ${ANCHO} ${ALTO_BARRA}`}
        className="w-full [-webkit-print-color-adjust:exact] [print-color-adjust:exact]"
        style={{ maxHeight: 34 }}
        role="img"
        aria-label={`Reparto del costo: ${tramos
          .map((t) => `${t.etiqueta} ${t.pct.toFixed(0)} por ciento`)
          .join(', ')}`}
      >
        {tramos.map((t) => (
          <rect
            key={t.clave}
            x={t.x}
            y={0}
            // Un hueco de 2 px entre tramos: es el respiro que separa dos
            // colores vecinos sin depender de que se distingan.
            width={Math.max(t.ancho - 2, 1)}
            height={ALTO_BARRA}
            rx={4}
            fill={COLOR[t.clave]}
          />
        ))}
      </svg>

      {/* La leyenda lleva el nombre Y el número: con tres colores en la
          banda 6–8 de separación para daltonismo, el color no puede ser
          lo único que identifica el tramo. */}
      <figcaption className="flex flex-col gap-1">
        {tramos.map((t) => (
          <span key={t.clave} className="flex items-center gap-2 text-xs">
            <span
              aria-hidden
              className="h-2.5 w-2.5 shrink-0 rounded-sm"
              style={{ backgroundColor: COLOR[t.clave] }}
            />
            <span className="min-w-0 flex-1 truncate text-slate-600">{t.etiqueta}</span>
            <span className="shrink-0 font-semibold tabular-nums text-slate-900">
              L {n2(t.valor)}
            </span>
            <span className="w-10 shrink-0 text-right tabular-nums text-slate-400">
              {t.pct.toFixed(0)}%
            </span>
          </span>
        ))}
      </figcaption>
    </figure>
  )
}
