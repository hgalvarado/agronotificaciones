/**
 * Las dos gráficas del reporte de rotación: el anillo de cumplimiento y
 * las barras por zona o variedad.
 *
 * SVG a mano y no una librería, por lo mismo que en el trasplante: el
 * módulo se abre desde el campo en teléfono, y el reporte se IMPRIME.
 * Un gráfico que sólo existe cuando corre JavaScript no sale en el papel,
 * y uno que necesita el ratón encima para decir su número no sirve en una
 * hoja que se firma.
 *
 * Por eso cada valor está escrito al lado de su forma: la figura da la
 * proporción de un vistazo y el texto da la cifra exacta. Ninguna de las
 * dos depende de la otra.
 *
 * Son componentes de servidor: no llevan `'use client'` porque no tienen
 * ni estado ni eventos. Así el reporte llega pintado desde el servidor y
 * la impresión no espera a que hidrate nada.
 */

import { AZUL, n2, pct } from '@/lib/trasplante/formato'

const GRIS = '#e2e8f0'
const VERDE = '#047857'
const AMBAR = '#b45309'

/** El color dice de un vistazo si se va bien, regular o mal. */
function tono(valor: number | null): string {
  if (valor === null) return AZUL
  if (valor >= 99) return VERDE
  if (valor >= 50) return AZUL
  return AMBAR
}

/* ================================================================== */
/* Anillo de cumplimiento                                              */
/* ================================================================== */

const RADIO = 54
const GROSOR = 22
const PERIMETRO = 2 * Math.PI * RADIO

/**
 * El «pastel» del % de avance.
 *
 * Anillo y no pastel macizo: el número grande va en el centro, que es lo
 * que la gente lee primero, y el hueco lo deja sitio sin tener que
 * ponerlo fuera con una línea guía.
 *
 * Se dibuja con `stroke-dasharray` sobre un círculo en vez de con arcos:
 * un arco de exactamente 100 % en `path` degenera —el punto final
 * coincide con el inicial y el navegador no pinta nada—, que es
 * justamente el caso que más importa enseñar bien.
 */
export function AnilloAvance({
  porcentaje,
  plan,
  real,
}: {
  porcentaje: number | null
  plan: number
  real: number
}) {
  const valor = Math.max(0, Math.min(100, Number(porcentaje ?? 0)))
  const color = tono(porcentaje)

  return (
    <figure className="flex flex-col items-center gap-2">
      <svg
        viewBox="0 0 140 140"
        className="h-36 w-36 [-webkit-print-color-adjust:exact] [print-color-adjust:exact]"
        role="img"
        aria-label={`Avance ${pct(porcentaje)}`}
      >
        <circle cx="70" cy="70" r={RADIO} fill="none" stroke={GRIS} strokeWidth={GROSOR} />
        {valor > 0 && (
          <circle
            cx="70"
            cy="70"
            r={RADIO}
            fill="none"
            stroke={color}
            strokeWidth={GROSOR}
            strokeLinecap="butt"
            strokeDasharray={`${(valor / 100) * PERIMETRO} ${PERIMETRO}`}
            // Arranca arriba y gira como un reloj, que es como se lee un
            // avance. Sin esto empezaría a las tres.
            transform="rotate(-90 70 70)"
          />
        )}
        <text
          x="70"
          y="68"
          textAnchor="middle"
          className="fill-slate-900 text-[22px] font-bold"
          style={{ fontSize: 22, fontWeight: 700 }}
        >
          {pct(porcentaje)}
        </text>
        <text
          x="70"
          y="86"
          textAnchor="middle"
          className="fill-slate-400"
          style={{ fontSize: 10 }}
        >
          de avance
        </text>
      </svg>

      <figcaption className="text-center text-[11px] text-slate-500">
        <strong className="text-slate-900">{n2(real)}</strong> de {n2(plan)} mz
      </figcaption>
    </figure>
  )
}

/* ================================================================== */
/* Barras: plan contra real                                            */
/* ================================================================== */

export type Barra = {
  etiqueta: string
  detalle?: string | null
  plan: number
  real: number
}

const ALTO_FILA = 34
const ANCHO_ETIQUETA = 130

/**
 * Plan y real, uno encima de otro, en una escala COMÚN.
 *
 * Si cada fila se normalizara a lo suyo, una zona al 40 % se vería igual
 * de llena que una al 100 % y la comparación —que es lo único que se
 * busca— sería mentira.
 */
export function BarrasPlanReal({
  filas,
  tope = 10,
  unidad = 'mz',
}: {
  filas: Barra[]
  tope?: number
  unidad?: string
}) {
  const conDatos = filas.filter((f) => Number(f.plan) > 0 || Number(f.real) > 0)
  if (conDatos.length === 0) {
    return <p className="py-6 text-center text-xs text-slate-400">Todavía no hay nada que medir.</p>
  }

  // Las de más peso primero: veinte barras de ocho píxeles no se leen, y
  // las que importan son las grandes.
  const visibles = [...conDatos]
    .sort((a, b) => Math.max(b.plan, b.real) - Math.max(a.plan, a.real))
    .slice(0, tope)
  const escondidas = conDatos.length - visibles.length

  const maximo = Math.max(...visibles.map((f) => Math.max(f.plan, f.real)), 1)
  const alto = visibles.length * ALTO_FILA + 18

  return (
    <figure className="flex flex-col gap-1">
      <svg
        viewBox={`0 0 640 ${alto}`}
        className="w-full [-webkit-print-color-adjust:exact] [print-color-adjust:exact]"
        style={{ maxHeight: alto * 1.1 }}
        role="img"
        aria-label="Plan contra real"
      >
        {visibles.map((f, i) => {
          const y = i * ALTO_FILA + 4
          const anchoPlan = (Number(f.plan) / maximo) * (640 - ANCHO_ETIQUETA - 70)
          const anchoReal = (Number(f.real) / maximo) * (640 - ANCHO_ETIQUETA - 70)
          const porcentaje = Number(f.plan) > 0 ? (Number(f.real) / Number(f.plan)) * 100 : null

          return (
            <g key={f.etiqueta}>
              <text x="0" y={y + 11} style={{ fontSize: 11, fontWeight: 600 }} className="fill-slate-700">
                {f.etiqueta.length > 20 ? `${f.etiqueta.slice(0, 19)}…` : f.etiqueta}
              </text>
              {f.detalle && (
                <text x="0" y={y + 23} style={{ fontSize: 9 }} className="fill-slate-400">
                  {f.detalle.length > 24 ? `${f.detalle.slice(0, 23)}…` : f.detalle}
                </text>
              )}

              {/* Plan detrás, en gris; real delante, en color. */}
              <rect x={ANCHO_ETIQUETA} y={y} width={Math.max(anchoPlan, 1)} height={11} rx={2} fill={GRIS} />
              <rect
                x={ANCHO_ETIQUETA}
                y={y + 13}
                width={Math.max(anchoReal, 1)}
                height={11}
                rx={2}
                fill={tono(porcentaje)}
              />

              <text
                x={ANCHO_ETIQUETA + Math.max(anchoPlan, anchoReal) + 6}
                y={y + 17}
                style={{ fontSize: 10 }}
                className="fill-slate-500"
              >
                {n2(f.real)} / {n2(f.plan)}
              </text>
            </g>
          )
        })}
      </svg>

      <figcaption className="flex flex-wrap items-center gap-3 text-[10px] text-slate-400">
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-4 rounded-sm" style={{ backgroundColor: GRIS }} />
          Planificado ({unidad})
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-4 rounded-sm" style={{ backgroundColor: AZUL }} />
          Ejecutado ({unidad})
        </span>
        {escondidas > 0 && <span>· {escondidas} más en la tabla</span>}
      </figcaption>
    </figure>
  )
}
