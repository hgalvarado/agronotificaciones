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

import type { Etapa } from '@/lib/desinfeccion/informe'

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

/** El lienzo, en unidades de `viewBox`. El SVG escala al contenedor. */
const ANCHO = 680

/*
 * El cronograma de UNA RECTA se retiró en la 76.
 *
 * Apilaba los hitos sobre una sola línea y alternaba las etiquetas
 * arriba y abajo para que no chocaran. Con seis etapas —y con un
 * preriego y unas lecturas a dos días uno del otro— los textos se
 * montaban justo en la parte que más se mira. Lo sustituye
 * `CronogramaEtapas`, donde cada etapa tiene su propia banda y la
 * colisión es imposible por construcción.
 *
 * La BARRA APILADA del costo se retiró por lo mismo: decía «98 %
 * químico» y ahí se acababa, sin contestar de dónde salía cada lempira.
 * La sustituyen los tres paneles de detalle del informe.
 */

/* ================================================================== */
/* El cronograma por etapas (migración 76)                             */
/* ================================================================== */

/** Una banda por etapa. Nada de etiquetas sueltas sobre una recta. */
const CANAL = 34
const GUTTER = 150
const MARGEN_DER = 22
const ALTO_EJE = 26

/**
 * Plan contra real, una etapa por fila.
 *
 * ── Por qué así y no sobre una recta ────────────────────────────────
 *
 * El cronograma anterior apilaba seis hitos sobre una sola línea y
 * alternaba las etiquetas arriba y abajo para que no chocaran. Con un
 * preriego y unas lecturas separados por dos días, los textos se montan
 * y el gráfico se vuelve ilegible justo en la parte que más se mira.
 *
 * Con una banda por etapa **la colisión es imposible**: los nombres
 * viven en una columna fija a la izquierda y nunca comparten espacio.
 * Y queda sitio para dibujar la pareja plan–real de cada etapa unida por
 * su segmento, que es lo que convierte la figura en una comparación y no
 * en una lista de puntos.
 *
 * El hueco también informa: una etapa sin fechas se dibuja vacía y dice
 * «esto todavía no se ha hecho», que es un dato.
 */
export function CronogramaEtapas({ etapas }: { etapas: Etapa[] }) {
  const conFecha = etapas.filter((e) => e.plan || e.real)

  if (conFecha.length === 0) {
    return (
      <p className="py-6 text-center text-xs text-slate-400">
        Todavía no hay fechas que ordenar en un cronograma.
      </p>
    )
  }

  const dias = (iso: string | null) => (iso ? Date.parse(`${iso}T12:00:00Z`) / 86_400_000 : null)

  const valores = conFecha
    .flatMap((e) => [dias(e.plan), dias(e.real)])
    .filter((v): v is number => v !== null)
  const min = Math.min(...valores)
  const max = Math.max(...valores)
  const util = ANCHO - GUTTER - MARGEN_DER

  const x = (iso: string | null) => {
    const d = dias(iso)
    if (d === null) return null
    return max === min ? GUTTER + util / 2 : GUTTER + ((d - min) / (max - min)) * util
  }

  const alto = etapas.length * CANAL + ALTO_EJE

  const corto = (iso: string | null) => (iso ? iso.slice(5) : '')

  return (
    <figure className="flex flex-col gap-1">
      <svg
        viewBox={`0 0 ${ANCHO} ${alto}`}
        className="w-full [-webkit-print-color-adjust:exact] [print-color-adjust:exact]"
        role="img"
        aria-label={`Cronograma por etapas: ${conFecha
          .map(
            (e) =>
              `${e.etiqueta}, plan ${e.plan ?? 'sin plan'}, real ${e.real ?? 'sin ejecutar'}`,
          )
          .join('; ')}`}
      >
        {etapas.map((e, i) => {
          const y = i * CANAL + CANAL / 2
          const xp = x(e.plan)
          const xr = x(e.real)
          const hay = xp !== null || xr !== null

          return (
            <g key={e.clave}>
              {/* La banda alterna un gris muy claro: separa las filas sin
                  una línea más, que competiría con los datos. */}
              {i % 2 === 1 && (
                <rect x={0} y={i * CANAL} width={ANCHO} height={CANAL} fill="#f8fafc" />
              )}

              <text x={6} y={y + 4} fontSize="11" fontWeight="600" fill="#334155">
                {e.etiqueta}
              </text>

              {/* El carril, siempre dibujado: da el renglón aunque la
                  etapa no tenga fechas. */}
              <line
                x1={GUTTER}
                y1={y}
                x2={ANCHO - MARGEN_DER}
                y2={y}
                stroke={EJE}
                strokeWidth={1}
                strokeDasharray="2 3"
              />

              {!hay && (
                <text x={GUTTER + 4} y={y + 4} fontSize="10" fill="#cbd5e1">
                  sin registrar
                </text>
              )}

              {/* El segmento que une plan y real: su LARGO es el desfase,
                  que es el dato que se viene a buscar. */}
              {xp !== null && xr !== null && (
                <line
                  x1={xp}
                  y1={y}
                  x2={xr}
                  y2={y}
                  stroke={e.desfase !== null && Math.abs(e.desfase) > 7 ? '#b45309' : '#94a3b8'}
                  strokeWidth={3}
                  strokeLinecap="round"
                />
              )}

              {/* Previsto: hueco y punteado. Real: relleno. El segundo
                  canal que distingue plan de hecho sin usar el color. */}
              {xp !== null && (
                <>
                  <circle
                    cx={xp}
                    cy={y}
                    r={6}
                    fill="#ffffff"
                    stroke={COLOR.quimico}
                    strokeWidth={2}
                    strokeDasharray="3 2"
                  />
                  <text
                    x={xp}
                    y={y - 11}
                    textAnchor="middle"
                    fontSize="9"
                    fill="#94a3b8"
                  >
                    {corto(e.plan)}
                    {e.ddtPlan !== null ? ` · ${e.ddtPlan} DDT` : ''}
                  </text>
                </>
              )}

              {xr !== null && (
                <>
                  <circle cx={xr} cy={y} r={6} fill={COLOR.quimico} />
                  <text
                    x={xr}
                    y={y + 18}
                    textAnchor="middle"
                    fontSize="9"
                    fontWeight="600"
                    fill="#334155"
                  >
                    {corto(e.real)}
                    {e.ddtReal !== null ? ` · ${e.ddtReal} DDT` : ''}
                  </text>
                </>
              )}
            </g>
          )
        })}

        {/* El eje: sólo los dos extremos. Más marcas obligarían a
            repartir texto en un ancho que ya está ocupado. */}
        <line
          x1={GUTTER}
          y1={etapas.length * CANAL + 1}
          x2={ANCHO - MARGEN_DER}
          y2={etapas.length * CANAL + 1}
          stroke={EJE}
          strokeWidth={2}
        />
        <text x={GUTTER} y={etapas.length * CANAL + 16} fontSize="9" fill="#94a3b8">
          {conFecha.length > 0 ? new Date(min * 86_400_000).toISOString().slice(0, 10) : ''}
        </text>
        <text
          x={ANCHO - MARGEN_DER}
          y={etapas.length * CANAL + 16}
          textAnchor="end"
          fontSize="9"
          fill="#94a3b8"
        >
          {conFecha.length > 0 ? new Date(max * 86_400_000).toISOString().slice(0, 10) : ''}
        </text>
      </svg>

      <figcaption className="px-1 text-[11px] text-slate-400">
        Una fila por etapa, a escala de días. El círculo hueco y punteado es lo previsto; el relleno,
        lo que ocurrió. El trazo que los une es el desfase, y se pinta en ámbar cuando pasa de una
        semana. El DDT va al lado de cada fecha y se cuenta contra la siembra: negativo quiere decir
        que todavía faltaba para trasplantar.
      </figcaption>
    </figure>
  )
}
