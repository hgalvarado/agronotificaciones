/**
 * Tendencia de siembra semanal: lo planeado, lo real y la brecha.
 *
 * SVG a mano y no una librería de gráficos: el reporte se IMPRIME, así
 * que hacen falta etiquetas fijas sobre el papel, no tooltips que sólo
 * existen con el ratón encima. Una librería además añadiría 40 kB al
 * primer pintado de una pantalla que se abre desde el campo.
 *
 * Las dos líneas comparten escala —si no, «arriba» no significaría lo
 * mismo en las dos y la brecha se vería del revés.
 */

import { AZUL, n2 } from '@/lib/trasplante/formato'
import type { PuntoSemana } from '@/lib/trasplante/servicio'

const ANCHO = 720
const ALTO = 260
const MARGEN = { arriba: 26, derecha: 16, abajo: 52, izquierda: 46 }

const GRIS = '#94a3b8'
const ROJO = '#b91c1c'
const VERDE = '#047857'

export function GraficoSemanas({ puntos }: { puntos: PuntoSemana[] }) {
  if (puntos.length === 0) return null

  const x0 = MARGEN.izquierda
  const x1 = ANCHO - MARGEN.derecha
  const y0 = ALTO - MARGEN.abajo
  const y1 = MARGEN.arriba

  const maximo = Math.max(...puntos.flatMap((p) => [p.plan, p.area]), 1)

  // Con una sola semana no hay línea que trazar: se centra el punto en
  // vez de dividir entre cero.
  const px = (i: number) =>
    puntos.length === 1 ? (x0 + x1) / 2 : x0 + (i / (puntos.length - 1)) * (x1 - x0)
  const py = (v: number) => y0 - (v / maximo) * (y0 - y1)

  const linea = (f: (p: PuntoSemana) => number) =>
    puntos.map((p, i) => `${i === 0 ? 'M' : 'L'} ${px(i).toFixed(1)} ${py(f(p)).toFixed(1)}`).join(' ')

  // Con muchas semanas las etiquetas se pisan: sólo se rotulan los datos
  // cuando caben, y el eje enseña una de cada n.
  const salto = Math.ceil(puntos.length / 12)
  const rotular = puntos.length <= 14

  const totalPlan = puntos.reduce((a, p) => a + p.plan, 0)
  const totalReal = puntos.reduce((a, p) => a + p.area, 0)
  const brechaTotal = Math.round((totalReal - totalPlan) * 100) / 100

  return (
    <figure className="flex flex-col gap-2">
      <svg
        viewBox={`0 0 ${ANCHO} ${ALTO}`}
        className="h-auto w-full"
        role="img"
        aria-label="Manzanas planeadas contra sembradas por semana"
      >
        {[0, 0.25, 0.5, 0.75, 1].map((f) => (
          <g key={f}>
            <line
              x1={x0}
              x2={x1}
              y1={y0 - f * (y0 - y1)}
              y2={y0 - f * (y0 - y1)}
              stroke="#e2e8f0"
              strokeWidth="1"
            />
            <text x={x0 - 6} y={y0 - f * (y0 - y1) + 3} textAnchor="end" fontSize="9" fill="#94a3b8">
              {n2(maximo * f)}
            </text>
          </g>
        ))}

        {/* La brecha, dibujada: el hueco vertical entre plan y real. */}
        {puntos.map((p, i) => (
          <line
            key={`brecha-${p.semana}`}
            x1={px(i)}
            x2={px(i)}
            y1={py(p.plan)}
            y2={py(p.area)}
            stroke={p.brecha < 0 ? ROJO : VERDE}
            strokeWidth="1"
            strokeDasharray="2 2"
            opacity="0.5"
          />
        ))}

        {/* Planeado detrás y punteado: es la referencia, no el logro. */}
        <path
          d={linea((p) => p.plan)}
          fill="none"
          stroke={GRIS}
          strokeWidth="2"
          strokeDasharray="5 3"
        />
        <path d={linea((p) => p.area)} fill="none" stroke={AZUL} strokeWidth="2.5" />

        {puntos.map((p, i) => (
          <g key={p.semana}>
            <circle cx={px(i)} cy={py(p.plan)} r="2.5" fill={GRIS} />
            <circle cx={px(i)} cy={py(p.area)} r="3" fill={AZUL} />

            {rotular && (
              <>
                {/* Real arriba del punto, planeado debajo del suyo: así no
                    se tapan aunque las dos líneas se crucen. */}
                <text
                  x={px(i)}
                  y={py(p.area) - 7}
                  textAnchor="middle"
                  fontSize="8.5"
                  fontWeight="bold"
                  fill={AZUL}
                >
                  {n2(p.area)}
                </text>
                <text x={px(i)} y={py(p.plan) + 13} textAnchor="middle" fontSize="8" fill={GRIS}>
                  {n2(p.plan)}
                </text>
              </>
            )}

            {i % salto === 0 && (
              <>
                <text x={px(i)} y={ALTO - 30} textAnchor="middle" fontSize="9" fill="#64748b">
                  {p.semana.slice(-3)}
                </text>
                {/* La diferencia, siempre visible, al pie de su semana. */}
                <text
                  x={px(i)}
                  y={ALTO - 18}
                  textAnchor="middle"
                  fontSize="8.5"
                  fontWeight="bold"
                  fill={p.brecha < 0 ? ROJO : VERDE}
                >
                  {p.brecha > 0 ? '+' : ''}
                  {n2(p.brecha)}
                </text>
              </>
            )}
          </g>
        ))}

        <text x={x0} y={12} fontSize="9" fill="#94a3b8">
          Manzanas
        </text>
      </svg>

      <figcaption className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-500">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4" style={{ backgroundColor: AZUL }} />
          Real ({n2(totalReal)} mz)
        </span>
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block h-0.5 w-4"
            style={{ backgroundImage: `repeating-linear-gradient(90deg, ${GRIS} 0 5px, transparent 5px 8px)` }}
          />
          Planeado ({n2(totalPlan)} mz)
        </span>
        <span
          className="font-bold"
          style={{ color: brechaTotal < 0 ? ROJO : VERDE }}
        >
          Diferencia: {brechaTotal > 0 ? '+' : ''}
          {n2(brechaTotal)} mz {brechaTotal < 0 ? '(atraso)' : '(adelanto)'}
        </span>
      </figcaption>

      {totalPlan === 0 && (
        <p className="text-[10px] text-amber-700">
          El plan no tiene fechas de siembra cargadas, así que no hay línea de referencia. Cárgalas
          en el plan de siembra para ver la brecha.
        </p>
      )}
    </figure>
  )
}
