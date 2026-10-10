'use client'

/**
 * Los dos gráficos del tablero de desinfección, en SVG escrito a mano.
 *
 * Sin librerías, por lo mismo que en rotación, trasplante y el reporte:
 * el tablero se abre desde el teléfono y se IMPRIME. Un gráfico que sólo
 * existe mientras corre JavaScript no sale en el papel, y uno que
 * necesita el ratón encima para decir su número no sirve en una hoja que
 * se firma. Por eso **cada valor está escrito al lado de su forma**.
 *
 *   · **Costo por manzana, turno a turno** — barras horizontales. La
 *     pregunta es «cuál me salió caro», que es una comparación de
 *     magnitudes entre nombres: barras, y horizontales porque los
 *     nombres de turno no caben debajo de una barra en un teléfono.
 *
 *   · **De qué está hecho el costo** — una dona. Es la única forma que
 *     se usa aquí para proporciones, y se usa porque son TRES piezas de
 *     un todo conocido; con más de cinco una dona deja de leerse y habría
 *     que volver a las barras.
 */

import { n2 } from '@/lib/trasplante/formato'

/**
 * Los tres colores del costo.
 *
 * **Validados, no elegidos a ojo**: pasan la banda de luminosidad, el
 * piso de croma, el contraste contra la superficie y —lo que más cuesta—
 * el piso de separación para visión normal, en claro y en oscuro. Los
 * del reporte viejo (`#047857` con `#0369a1`) quedaban en ΔE 14, por
 * debajo del piso de 15: dos series que un lector con visión plena
 * confunde.
 *
 * Su separación para daltonismo cae en la banda 6–8, que **sólo es
 * legal con un segundo canal**. Por eso cada pieza lleva su nombre y su
 * número escritos al lado, y las porciones van separadas por un hueco de
 * la superficie: el color nunca es lo único que distingue.
 */
const QUIMICO = '#0369a1'
const PERSONAL = '#16a34a'
const LOGISTICA = '#c2410c'

/** Tinta recesiva: rejilla y ejes no compiten con los datos. */
const EJE = '#e2e8f0'

const ANCHO = 640

/* ================================================================== */
/* Costo por manzana, turno a turno                                    */
/* ================================================================== */

export type BarraTurno = { etiqueta: string; valor: number; detalle?: string }

const ALTO_FILA = 32
const ANCHO_ETIQUETA = 150
const ANCHO_VALOR = 86

export function GraficoCostoPorTurno({
  filas,
  tope = 12,
  unidad = 'L/mz',
}: {
  filas: BarraTurno[]
  tope?: number
  unidad?: string
}) {
  const conDatos = filas.filter((f) => f.valor > 0)
  if (conDatos.length === 0) {
    return (
      <p className="py-6 text-center text-xs text-slate-400">
        Todavía no hay turnos con costo en lo que seleccionaste.
      </p>
    )
  }

  // Ordenado de mayor a menor: la pregunta es «cuál me salió caro», y esa
  // se contesta leyendo de arriba abajo sin buscar.
  const visibles = [...conDatos].sort((a, b) => b.valor - a.valor).slice(0, tope)
  const escondidas = conDatos.length - visibles.length

  const maximo = Math.max(...visibles.map((f) => f.valor), 1)
  const anchoBarra = ANCHO - ANCHO_ETIQUETA - ANCHO_VALOR
  const alto = visibles.length * ALTO_FILA + 10

  return (
    <figure className="flex flex-col gap-1">
      <svg
        viewBox={`0 0 ${ANCHO} ${alto}`}
        className="w-full [-webkit-print-color-adjust:exact] [print-color-adjust:exact]"
        style={{ maxHeight: alto * 1.2 }}
        role="img"
        aria-label={`Costo por manzana de ${visibles.length} turnos, de mayor a menor`}
      >
        {visibles.map((f, i) => {
          const y = i * ALTO_FILA + 4
          const ancho = Math.max((f.valor / maximo) * anchoBarra, 2)
          return (
            <g key={`${f.etiqueta}-${i}`}>
              <text
                x={ANCHO_ETIQUETA - 8}
                y={y + 15}
                textAnchor="end"
                fontSize="11"
                fill="#475569"
              >
                {f.etiqueta.length > 24 ? `${f.etiqueta.slice(0, 23)}…` : f.etiqueta}
              </text>
              {/* La barra, fina y con el extremo redondeado sólo del lado
                  del dato: el otro queda anclado a la línea base. */}
              <rect
                x={ANCHO_ETIQUETA}
                y={y + 5}
                width={ancho}
                height={14}
                rx={4}
                fill={QUIMICO}
              />
              {/* El valor SIEMPRE escrito: en papel no hay ratón que
                  pueda preguntar. */}
              <text
                x={ANCHO_ETIQUETA + ancho + 8}
                y={y + 16}
                fontSize="11"
                fontWeight="600"
                fill="#0f172a"
              >
                {n2(f.valor)}
              </text>
              {f.detalle && (
                <text x={ANCHO_ETIQUETA} y={y + 30} fontSize="9" fill="#94a3b8">
                  {f.detalle}
                </text>
              )}
            </g>
          )
        })}
        <line
          x1={ANCHO_ETIQUETA}
          y1={2}
          x2={ANCHO_ETIQUETA}
          y2={alto - 4}
          stroke={EJE}
          strokeWidth={1}
        />
      </svg>
      <figcaption className="px-1 text-[11px] text-slate-400">
        En {unidad}, de mayor a menor.
        {escondidas > 0 && ` Se dibujan los ${tope} más altos; hay ${escondidas} más.`}
      </figcaption>
    </figure>
  )
}

/* ================================================================== */
/* De qué está hecho el costo                                          */
/* ================================================================== */

export type Porcion = { etiqueta: string; valor: number; color: string }

export const COLORES_COMPOSICION = {
  quimico: QUIMICO,
  personal: PERSONAL,
  logistica: LOGISTICA,
}

const RADIO = 70
const GROSOR = 26
const CENTRO = 80

/**
 * Una dona de tres porciones.
 *
 * Se dibuja con `<path>` y arcos porque es lo único que un SVG a mano
 * sabe hacer sin librería: un arco por porción, con su hueco de
 * separación para que dos colores nunca se toquen —es el segundo canal
 * que la separación para daltonismo exige—.
 *
 * El total va en el centro, que es lo que una dona hace mejor que unas
 * barras: enseñar la proporción y el total a la vez.
 */
export function GraficoComposicionCosto({ porciones }: { porciones: Porcion[] }) {
  const conDatos = porciones.filter((p) => p.valor > 0)
  const total = conDatos.reduce((a, p) => a + p.valor, 0)

  if (total <= 0) {
    return (
      <p className="py-6 text-center text-xs text-slate-400">
        Todavía no hay costos que repartir en lo que seleccionaste.
      </p>
    )
  }

  // Un hueco de dos grados entre porciones: es el «respiro» que separa
  // dos colores vecinos sin depender de que se distingan.
  const HUECO = conDatos.length > 1 ? 2 : 0

  // El ángulo de arranque de cada porción es la suma de las anteriores.
  // Se calcula con `reduce` y no acumulando una variable suelta: una
  // variable que se reasigna durante el dibujo sobrevive al render y
  // la siguiente vuelta empieza donde acabó la anterior.
  const arcos = conDatos.map((p, i) => {
    const previas = conDatos.slice(0, i).reduce((a, x) => a + x.valor, 0)
    const inicio = -90 + (previas / total) * 360
    const desde = inicio + HUECO / 2
    const hasta = desde + Math.max((p.valor / total) * 360 - HUECO, 0.5)
    return { ...p, d: arco(desde, hasta), porcentaje: (p.valor / total) * 100 }
  })

  return (
    <figure className="flex flex-col items-center gap-3 sm:flex-row sm:items-center sm:gap-5">
      <svg
        viewBox={`0 0 ${CENTRO * 2} ${CENTRO * 2}`}
        className="w-40 shrink-0 [-webkit-print-color-adjust:exact] [print-color-adjust:exact]"
        role="img"
        aria-label={`Composición del costo: ${arcos
          .map((a) => `${a.etiqueta} ${a.porcentaje.toFixed(0)} por ciento`)
          .join(', ')}`}
      >
        {arcos.map((a) => (
          <path
            key={a.etiqueta}
            d={a.d}
            fill="none"
            stroke={a.color}
            strokeWidth={GROSOR}
            strokeLinecap="butt"
          />
        ))}
        <text
          x={CENTRO}
          y={CENTRO - 2}
          textAnchor="middle"
          fontSize="15"
          fontWeight="700"
          fill="#0f172a"
        >
          L {n2(total)}
        </text>
        <text x={CENTRO} y={CENTRO + 14} textAnchor="middle" fontSize="9" fill="#94a3b8">
          total
        </text>
      </svg>

      {/* La leyenda lleva el nombre Y el número: con tres colores en la
          banda 6–8 de separación para daltonismo, el color no puede ser
          lo único que identifica la porción. */}
      <figcaption className="flex w-full flex-col gap-1.5">
        {arcos.map((a) => (
          <span key={a.etiqueta} className="flex items-center gap-2 text-xs">
            <span
              aria-hidden
              className="h-2.5 w-2.5 shrink-0 rounded-sm"
              style={{ backgroundColor: a.color }}
            />
            <span className="min-w-0 flex-1 truncate text-slate-600">{a.etiqueta}</span>
            <span className="shrink-0 font-semibold tabular-nums text-slate-900">
              L {n2(a.valor)}
            </span>
            <span className="w-10 shrink-0 text-right tabular-nums text-slate-400">
              {a.porcentaje.toFixed(0)}%
            </span>
          </span>
        ))}
      </figcaption>
    </figure>
  )
}

/** Un arco de la dona, en coordenadas de reloj (0° arriba). */
function arco(desde: number, hasta: number): string {
  const r = RADIO - GROSOR / 2
  const a = punto(desde, r)
  const b = punto(hasta, r)
  const grande = hasta - desde > 180 ? 1 : 0
  // Un círculo completo no se puede dibujar con un solo arco —el punto
  // de inicio y el de fin coinciden y SVG no sabe por dónde ir—, así que
  // se parte en dos medios.
  if (hasta - desde >= 359.9) {
    const medio = punto(desde + 180, r)
    return `M ${a.x} ${a.y} A ${r} ${r} 0 1 1 ${medio.x} ${medio.y} A ${r} ${r} 0 1 1 ${a.x} ${a.y}`
  }
  return `M ${a.x} ${a.y} A ${r} ${r} 0 ${grande} 1 ${b.x} ${b.y}`
}

function punto(grados: number, r: number) {
  const rad = (grados * Math.PI) / 180
  return { x: CENTRO + r * Math.cos(rad), y: CENTRO + r * Math.sin(rad) }
}
