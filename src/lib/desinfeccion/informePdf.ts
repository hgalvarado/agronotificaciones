/**
 * El informe ejecutivo, en papel.
 *
 * ── Qué NO es ───────────────────────────────────────────────────────
 *
 * No es un volcado de la tabla. Un PDF que repite la cuadrícula de la
 * pantalla no sirve para lo que se usa: llevarlo a una reunión donde
 * nadie va a abrir la aplicación. Por eso se maqueta como un documento:
 * encabezado, tres bloques con su marco, y un reparto del costo dibujado
 * en vez de listado.
 *
 * ── Por qué a mano ──────────────────────────────────────────────────
 *
 * El proyecto no tiene una sola dependencia de terceros, y un informe de
 * una página no justifica meter trescientos kilobytes de librería en el
 * paquete que baja un teléfono en la finca. `lib/pdf/documento` sabe
 * escribir texto, rayas y recuadros; un informe es exactamente eso.
 *
 * Las cuentas NO se hacen aquí: salen de `lib/desinfeccion/informe`, las
 * mismas que usa la pantalla. Un papel que dice algo distinto de lo que
 * dice el tablero es peor que no tener papel.
 */

import { ANCHO, ALTO, Pagina, construirPdf, type Rgb } from '@/lib/pdf/documento'
import { n2 } from '@/lib/trasplante/formato'
import {
  cuadrillaDe,
  dossierDe,
  planContraReal,
  ejecucionesDe,
  etapasDe,
  logisticaDe,
  nombreFase,
  productosDe,
  retrasoDias,
  conSigno,
  type FilaInforme,
} from './informe'

/*
 * Los tres colores del costo se fueron con la barra apilada (migración
 * 76). El desglose es ahora tres listas con su total, y una lista de
 * números no necesita color para leerse: lo identifica su título.
 */
const MARCA: Rgb = { r: 0.01, g: 0.31, b: 0.22 }
const ROJO: Rgb = { r: 0.72, g: 0.11, b: 0.11 }
const VERDE: Rgb = { r: 0.09, g: 0.5, b: 0.24 }

const MARGEN = 46
const UTIL = ANCHO - MARGEN * 2

const EMPRESA = 'Agropecuaria Montelíbano'
const LEMA = 'Control operativo de maquinaria agrícola'

const num = (v: number | null | undefined) => (v === null || v === undefined ? '—' : n2(v))
const fecha = (v: string | null | undefined) => v || '—'

/* ------------------------------------------------------------------ */
/* Las piezas del documento                                            */
/* ------------------------------------------------------------------ */

/** El encabezado corporativo. Devuelve la Y en la que queda el cursor. */
function encabezado(p: Pagina, titulo: string, subtitulo: string): number {
  p.rectangulo(0, 0, ANCHO, 64, { color: MARCA })
  p.texto(MARGEN, 18, EMPRESA, { tamano: 15, negrita: true, color: { r: 1, g: 1, b: 1 } })
  p.texto(MARGEN, 38, LEMA, { tamano: 8.5, color: { r: 0.8, g: 0.88, b: 0.85 } })
  p.texto(ANCHO - MARGEN, 18, titulo, {
    tamano: 11,
    negrita: true,
    alineacion: 'derecha',
    color: { r: 1, g: 1, b: 1 },
  })
  p.texto(ANCHO - MARGEN, 36, subtitulo, {
    tamano: 8.5,
    alineacion: 'derecha',
    color: { r: 0.8, g: 0.88, b: 0.85 },
  })
  return 86
}

/**
 * Un bloque con su marco y su título.
 *
 * El título va SOBRE la línea superior, mordiendo el marco, que es como
 * se lee un bloque de un formulario: el marco dice dónde empieza y
 * dónde acaba una idea, y sin él tres listas seguidas se leen como una
 * sola de quince renglones.
 */
function bloque(p: Pagina, y: number, alto: number, titulo: string): number {
  p.rectangulo(MARGEN, y, UTIL, alto, { gris: 0.78, grosor: 0.8 })
  // Se tapa el trozo de línea donde va el título, para que el texto no
  // quede atravesado por el marco.
  p.rectangulo(MARGEN + 10, y - 5, titulo.length * 5.2 + 10, 10, { relleno: 1 })
  p.texto(MARGEN + 16, y - 9, titulo.toUpperCase(), {
    tamano: 8,
    negrita: true,
    color: MARCA,
  })
  return y + 16
}

/** Una pareja etiqueta/valor, en columna. */
function dato(
  p: Pagina,
  x: number,
  y: number,
  etiqueta: string,
  valor: string,
  op: { negrita?: boolean; color?: Rgb; ancho?: number } = {},
): void {
  p.texto(x, y, etiqueta.toUpperCase(), { tamano: 6.5, gris: 0.5 })
  p.texto(x, y + 9, valor, {
    tamano: op.negrita ? 10.5 : 9.5,
    negrita: op.negrita,
    color: op.color,
  })
}

/**
 * Un panel del desglose: líneas con su detalle fino y un total al pie.
 *
 * Es el equivalente en papel de los tres paneles de la pantalla, y sale
 * de los mismos datos: el informe impreso y el de la pantalla no pueden
 * decir cosas distintas, porque quien lo lleva a una reunión no sabría
 * cuál de los dos defender.
 */
function panelPdf(
  p: Pagina,
  y: number,
  titulo: string,
  lineas: { titulo: string; detalle: string; valor: number }[],
  total: number,
  vacio: string,
): number {
  const alto = 30 + Math.max(lineas.length, 1) * 20 + 16
  let cursor = bloque(p, y, alto, titulo)

  if (lineas.length === 0) {
    p.texto(MARGEN + 14, cursor, vacio, { tamano: 9, gris: 0.55 })
    cursor += 20
  }

  for (const l of lineas) {
    p.texto(MARGEN + 14, cursor, l.titulo, { tamano: 9, negrita: true })
    p.texto(MARGEN + 14, cursor + 9, l.detalle, { tamano: 7.5, gris: 0.45 })
    p.texto(ANCHO - MARGEN - 14, cursor, `L ${num(l.valor)}`, {
      tamano: 9.5,
      negrita: true,
      alineacion: 'derecha',
    })
    cursor += 20
  }

  p.linea({ x: MARGEN + 14, y: cursor }, { x: ANCHO - MARGEN - 14, y: cursor }, 0.85, 0.5)
  cursor += 10
  p.texto(MARGEN + 14, cursor, 'TOTAL', { tamano: 7, gris: 0.5 })
  p.texto(ANCHO - MARGEN - 14, cursor, `L ${num(total)}`, {
    tamano: 10.5,
    negrita: true,
    alineacion: 'derecha',
  })

  return cursor + 22
}

/** El pie, igual en todas las páginas. */
function pie(p: Pagina, lote: string, ciclo: number, hoy: string): void {
  p.linea({ x: MARGEN, y: ALTO - 46 }, { x: ANCHO - MARGEN, y: ALTO - 46 }, 0.85, 0.5)
  p.texto(MARGEN, ALTO - 40, `${EMPRESA} · AgroNotificaciones`, { tamano: 7.5, gris: 0.5 })
  p.texto(ANCHO - MARGEN, ALTO - 40, `${lote} · ciclo ${ciclo} · emitido el ${hoy}`, {
    tamano: 7.5,
    gris: 0.5,
    alineacion: 'derecha',
  })
}

/* ------------------------------------------------------------------ */
/* El documento                                                        */
/* ------------------------------------------------------------------ */

export function informeEjecutivoPdf(fila: FilaInforme, hoy: string): Blob {
  const p = new Pagina()
  const lote = `${fila.lote_nomenclatura}${fila.lote_nombre ? ` · ${fila.lote_nombre}` : ''}`

  let y = encabezado(p, 'Informe ejecutivo de desinfección', `Emitido el ${hoy}`)

  /* ------------------------- El lote ----------------------------- */
  p.texto(MARGEN, y, lote, { tamano: 17, negrita: true })
  p.texto(ANCHO - MARGEN, y + 4, `Ciclo ${fila.ciclo}`, {
    tamano: 10,
    alineacion: 'derecha',
    gris: 0.4,
  })
  y += 26

  /* ------------------ 1 · Contexto del lote ---------------------- */
  y = bloque(p, y, 46, 'Contexto del lote')
  const col = UTIL / 4
  dato(p, MARGEN + 14, y, 'Zona', fila.zona_nombre ?? '—')
  dato(p, MARGEN + 14 + col, y, 'Temporada', fila.temporada_nombre ?? '—')
  dato(p, MARGEN + 14 + col * 2, y, 'Variedad', fila.variedad ?? '—')
  dato(p, MARGEN + 14 + col * 3, y, 'Manzanas regadas', `${num(fila.mz_regadas)} mz`)
  y += 40

  /*
   * ── 2 · El cronograma, en filas y no en columnas ──────────────────
   *
   * La versión anterior repartía los hitos en columnas calculadas a
   * mano y se pisaban en cuanto aparecía uno más: con la fase 4, la
   * siembra y «Contra el plan» salieron superpuestas en el papel, que
   * no es un aviso de consola sino un informe ilegible en una reunión.
   *
   * Una ETAPA POR RENGLÓN lo hace imposible por construcción, y de paso
   * cabe el plan al lado de lo real, que es la comparación que se viene
   * a hacer. Las seis etapas salen siempre: una vacía dice «esto no se
   * ha hecho», y eso también es un dato.
   */
  const etapas = etapasDe(fila)
  const retraso = retrasoDias(fila)
  y = bloque(p, y, 32 + etapas.length * 15, 'Cronograma · plan vs. real')

  p.texto(MARGEN + 14, y, 'ETAPA', { tamano: 6.5, gris: 0.5 })
  p.texto(MARGEN + 175, y, 'PLANIFICADO', { tamano: 6.5, gris: 0.5 })
  p.texto(MARGEN + 300, y, 'REAL', { tamano: 6.5, gris: 0.5 })
  p.texto(ANCHO - MARGEN - 14, y, 'DESFASE', {
    tamano: 6.5,
    gris: 0.5,
    alineacion: 'derecha',
  })
  y += 9
  p.linea({ x: MARGEN + 14, y }, { x: ANCHO - MARGEN - 14, y }, 0.85, 0.5)
  y += 10

  for (const e of etapas) {
    p.texto(MARGEN + 14, y, e.etiqueta, { tamano: 9, negrita: true })
    // El DDT va pegado a SU fecha: separarlos en otra columna obligaría
    // a cruzar la vista para saber a cuál de las dos pertenece.
    p.texto(
      MARGEN + 175,
      y,
      `${fecha(e.plan)}${e.ddtPlan !== null ? `  (${e.ddtPlan} DDT)` : ''}`,
      { tamano: 9, gris: e.plan ? 0.25 : 0.6 },
    )
    p.texto(
      MARGEN + 300,
      y,
      `${fecha(e.real)}${e.ddtReal !== null ? `  (${e.ddtReal} DDT)` : ''}`,
      { tamano: 9, gris: e.real ? 0.1 : 0.6 },
    )
    p.texto(
      ANCHO - MARGEN - 14,
      y,
      e.desfase === null ? '—' : `${conSigno(e.desfase, 0)} d`,
      {
        tamano: 9,
        alineacion: 'derecha',
        color: e.desfase !== null && Math.abs(e.desfase) > 7 ? ROJO : undefined,
      },
    )
    y += 15
  }
  y += 10

  if (retraso !== null) {
    p.texto(
      MARGEN + 14,
      y,
      retraso === 0
        ? 'La aplicación se hizo el día planificado.'
        : `La aplicación se hizo ${Math.abs(retraso)} días ${
            retraso > 0 ? 'después' : 'antes'
          } de lo planificado.`,
      { tamano: 8.5, gris: 0.45 },
    )
    y += 16
  }

  /* ---------------- 2 · Análisis agronómico ---------------------- */
  const productos = productosDe(fila)
  const altoAgro = 56 + Math.max(productos.length, 1) * 24
  y = bloque(p, y, altoAgro, 'Análisis agronómico')

  dato(p, MARGEN + 14, y, 'Dosis planificada', `${num(fila.dosis_mz_plan)} L/mz`)
  dato(p, MARGEN + 14 + col, y, 'Dosis aplicada', `${num(fila.dosis_mz_real)} L/mz`, {
    negrita: true,
  })
  dato(
    p,
    MARGEN + 14 + col * 2,
    y,
    'Desviación',
    fila.delta_dosis === null
      ? 'Sin plan'
      : `${conSigno(fila.delta_dosis)} L/mz  (${conSigno(fila.delta_dosis_pct, 1)}%)`,
    { color: desviacionColor(fila.delta_dosis_pct) },
  )
  dato(p, MARGEN + 14 + col * 3, y, 'Caudal', `${num(fila.caudal_agua)} m³/h`)
  y += 30

  // La cabecera de los químicos.
  p.texto(MARGEN + 14, y, 'QUÍMICO', { tamano: 6.5, gris: 0.5 })
  p.texto(MARGEN + 14 + col * 1.4, y, 'OBJETIVOS DE CONTROL', { tamano: 6.5, gris: 0.5 })
  p.texto(ANCHO - MARGEN - 110, y, 'L/MZ', { tamano: 6.5, gris: 0.5, alineacion: 'derecha' })
  p.texto(ANCHO - MARGEN - 60, y, 'PPM', { tamano: 6.5, gris: 0.5, alineacion: 'derecha' })
  p.texto(ANCHO - MARGEN - 14, y, 'COSTO', { tamano: 6.5, gris: 0.5, alineacion: 'derecha' })
  y += 10
  p.linea({ x: MARGEN + 14, y }, { x: ANCHO - MARGEN - 14, y }, 0.85, 0.5)
  y += 8

  if (productos.length === 0) {
    p.texto(MARGEN + 14, y, 'Sin químicos anotados en este lote.', { tamano: 9, gris: 0.5 })
    y += 16
  }
  for (const q of productos) {
    p.texto(MARGEN + 14, y, `${q.codigo ?? ''} ${q.nombre ?? ''}`.trim() || '—', {
      tamano: 9,
      negrita: true,
    })
    const objetivos = (q.objetivos ?? []).join(' · ')
    p.texto(MARGEN + 14 + col * 1.4, y, objetivos || 'Sin objetivo anotado', {
      tamano: 8.5,
      gris: objetivos ? 0.25 : 0.55,
    })
    p.texto(ANCHO - MARGEN - 110, y, num(q.dosis_mz), { tamano: 9, alineacion: 'derecha' })
    p.texto(ANCHO - MARGEN - 60, y, num(q.ppm), { tamano: 9, alineacion: 'derecha' })
    p.texto(ANCHO - MARGEN - 14, y, `L ${num(q.costo)}`, { tamano: 9, alineacion: 'derecha' })
    y += 22
  }
  y += 14

  /* ---------------- 3 · Análisis financiero ---------------------- */
  /*
   * ── Por qué ya no hay barra apilada ──────────────────────────────
   *
   * Decía «98 % químico, 2 % acarreo» y ahí se acababa. Con tres
   * conceptos de los que uno se lleva casi todo, la proporción no es la
   * pregunta —ya se sabe que el químico manda—: lo que nadie podía
   * contestar mirando esa barra era DE DÓNDE salió cada lempira. Tres
   * listas con su total al pie contestan las dos cosas.
   */
  y = bloque(p, y, 64, 'Análisis financiero')

  dato(
    p,
    MARGEN + 14,
    y,
    'Plan (sólo químico)',
    fila.costo_plan === null ? 'Sin plan' : `L ${num(fila.costo_plan)}`,
  )
  dato(
    p,
    MARGEN + 14 + col,
    y,
    'Químico de aplicación',
    `L ${num(fila.costo_quimico_aplicacion)}`,
    { negrita: true },
  )
  dato(
    p,
    MARGEN + 14 + col * 2,
    y,
    'Desviación',
    fila.delta_costo === null
      ? 'Sin plan'
      : `L ${conSigno(fila.delta_costo)}  (${conSigno(fila.delta_costo_pct, 1)}%)`,
    { color: desviacionColor(fila.delta_costo_pct) },
  )
  dato(p, MARGEN + 14 + col * 3, y, 'Costo por manzana', `L ${num(fila.costo_mz)}`, {
    negrita: true,
  })
  y += 32

  p.texto(
    MARGEN + 14,
    y,
    `Costo total del lote L ${num(fila.costo_total)}  ·  químico L ${num(
      fila.costo_quimico,
    )}  ·  mano de obra L ${num(fila.costo_personal)}  ·  acarreo L ${num(fila.costo_logistica)}`,
    { tamano: 8.5, gris: 0.4 },
  )
  y += 26

  /* ---------- La segunda página: el expediente del lote ---------- */
  const p2 = new Pagina()
  let y2 = encabezado(p2, 'Detalle operativo del lote', `${lote} · ciclo ${fila.ciclo}`)

  y2 = panelPdf(p2, y2, 'Detalle de químicos (prorrateado al lote)', [
    ...productos.map((q) => ({
      titulo: `${q.codigo ?? ''} ${q.nombre ?? ''}`.trim() || '—',
      detalle: [
        q.fase ? nombreFase(q.fase) : null,
        `${num(q.dosis_mz)} L/mz`,
        q.litros_turno !== null && q.litros_turno !== undefined
          ? `${num(q.litros_lote ?? q.litros)} de ${num(q.litros_turno)} L del turno`
          : `${num(q.litros)} L`,
        q.ppm ? `${num(q.ppm)} ppm` : null,
      ]
        .filter(Boolean)
        .join('  ·  '),
      valor: Number(q.costo_lote ?? q.costo ?? 0),
    })),
  ], Number(fila.costo_quimico ?? 0), 'Sin químicos anotados en este lote.')

  y2 = panelPdf(
    p2,
    y2,
    'Detalle de mano de obra por fase',
    cuadrillaDe(fila).map((c) => ({
      titulo: c.puesto_texto ?? c.operador_nombre ?? 'Sin puesto',
      detalle: [
        nombreFase(c.fase),
        `${num(c.cantidad_personas)} personas`,
        c.jornada_tipo ?? null,
        Number(c.horas_extras ?? 0) > 0 ? `${num(c.horas_extras)} h extra` : null,
        `turno L ${num(c.costo_turno)}`,
      ]
        .filter(Boolean)
        .join('  ·  '),
      valor: Number(c.costo_lote ?? 0),
    })),
    Number(fila.costo_personal ?? 0),
    'No se anotó cuadrilla en este lote.',
  )

  y2 = panelPdf(
    p2,
    y2,
    'Detalle de logística y acarreo',
    logisticaDe(fila).map((a) => ({
      titulo: a.equipo_nombre ?? 'Equipo sin nombre',
      detalle: [
        a.fecha ?? '—',
        a.tipo_cargo === 'lote' ? 'cargo al lote' : 'cargo a zona',
        `${num(a.horas_trabajo)} h`,
        a.implemento_nombre ?? null,
        a.operador_nombre ?? null,
        `turno L ${num(a.costo_total)}`,
      ]
        .filter(Boolean)
        .join('  ·  '),
      valor: Number(a.costo_lote ?? 0),
    })),
    Number(fila.costo_logistica ?? 0),
    'No hay acarreos que le toquen a este lote.',
  )

  /* ---------- Las cuatro fases, con todo lo operativo ------------ */
  const fases = dossierDe(fila)
  const etapas2 = etapasDe(fila)
  const pares = planContraReal(fila)
  const turnos = ejecucionesDe(fila)

  const DDT_DE: Record<string, string> = {
    '1_Preriego': 'preriego',
    '2_Lecturas': 'lecturas',
    '3_Aplicacion': 'aplicacion',
    '4_Lavado': 'lavado',
  }

  const altoFases =
    26 +
    fases.reduce(
      (a, f) =>
        a +
        18 +
        Math.ceil(f.datos.length / 2) * 11 +
        (f.productos.length + f.cuadrilla.length) * 11 +
        (f.clave === '3_Aplicacion' ? (pares.length + 2) * 11 : 0),
      0,
    )

  y2 = bloque(p2, y2, altoFases, 'Detalle operativo del lote por fase (plan vs. real)')

  for (const f of fases) {
    const etapa = etapas2.find((e) => e.clave === DDT_DE[f.clave])
    p2.texto(MARGEN + 14, y2, f.etiqueta, { tamano: 9, negrita: true })
    p2.texto(
      ANCHO - MARGEN - 14,
      y2,
      f.vacia
        ? 'No se registró'
        : [
            etapa && (etapa.ddtPlan !== null || etapa.ddtReal !== null)
              ? `DDT ${etapa.ddtPlan ?? '—'} / ${etapa.ddtReal ?? '—'}`
              : null,
            `químico L ${num(f.costoQuimico)}`,
            `cuadrilla L ${num(f.costoCuadrilla)}`,
          ]
            .filter(Boolean)
            .join('  ·  '),
      { tamano: 8, gris: 0.4, alineacion: 'derecha' },
    )
    y2 += 12

    if (f.vacia) {
      y2 += 5
      continue
    }

    // Lo operativo, en dos columnas: el reloj, el agua, la CE y la
    // calibración. Es lo que se discute cuando un turno sale raro.
    f.datos.forEach((d, i) => {
      const x = MARGEN + 26 + (i % 2) * ((UTIL - 40) / 2)
      const fila_ = Math.floor(i / 2)
      p2.texto(x, y2 + fila_ * 11, `${d.etiqueta}:`, { tamano: 7.5, gris: 0.5 })
      p2.texto(x + (UTIL - 40) / 2 - 16, y2 + fila_ * 11, d.valor, {
        tamano: 7.5,
        gris: 0.2,
        alineacion: 'derecha',
      })
    })
    y2 += Math.ceil(f.datos.length / 2) * 11

    // **El plan sólo en la fase 3**: es la única que presupuesta.
    if (f.clave === '3_Aplicacion') {
      p2.texto(MARGEN + 26, y2, 'QUÍMICOS · PLAN CONTRA REAL', { tamano: 6.5, gris: 0.5 })
      p2.texto(ANCHO - MARGEN - 100, y2, 'DOSIS P/R', {
        tamano: 6.5, gris: 0.5, alineacion: 'derecha',
      })
      p2.texto(ANCHO - MARGEN - 14, y2, 'COSTO P/R', {
        tamano: 6.5, gris: 0.5, alineacion: 'derecha',
      })
      y2 += 11
      if (pares.length === 0) {
        p2.texto(MARGEN + 26, y2, 'Sin plan: no hay contra qué medirlo.', {
          tamano: 8, gris: 0.55,
        })
        y2 += 11
      }
      for (const x of pares) {
        p2.texto(MARGEN + 26, y2, `· ${x.codigo}`, { tamano: 8, gris: 0.3 })
        p2.texto(
          ANCHO - MARGEN - 100,
          y2,
          `${x.dosisPlan === null ? '—' : num(x.dosisPlan)} / ${
            x.dosisReal === null ? '—' : num(x.dosisReal)
          }`,
          { tamano: 8, gris: 0.3, alineacion: 'derecha' },
        )
        p2.texto(
          ANCHO - MARGEN - 14,
          y2,
          `${x.costoPlan === null ? '—' : num(x.costoPlan)} / ${
            x.costoReal === null ? '—' : num(x.costoReal)
          }`,
          { tamano: 8, gris: 0.3, alineacion: 'derecha' },
        )
        y2 += 11
      }
    } else {
      for (const q of f.productos) {
        p2.texto(MARGEN + 26, y2, `· ${q.codigo ?? q.nombre ?? '—'}`, { tamano: 8, gris: 0.3 })
        p2.texto(
          ANCHO - MARGEN - 14,
          y2,
          `${num(q.litros_lote ?? q.litros)} L  ·  L ${num(q.costo_lote ?? q.costo)}`,
          { tamano: 8, gris: 0.3, alineacion: 'derecha' },
        )
        y2 += 11
      }
    }

    for (const c of f.cuadrilla) {
      p2.texto(
        MARGEN + 26,
        y2,
        `· ${c.puesto_texto ?? c.operador_nombre ?? 'Sin puesto'}`,
        { tamano: 8, gris: 0.3 },
      )
      p2.texto(
        ANCHO - MARGEN - 14,
        y2,
        `${num(c.cantidad_personas)} p  ·  ${c.jornada_tipo ?? '—'}  ·  L ${num(c.costo_lote)}`,
        { tamano: 8, gris: 0.3, alineacion: 'derecha' },
      )
      y2 += 11
    }
    y2 += 6
  }
  y2 += 10

  /* ---------- Los turnos: lo que permite auditar el reparto ------ */
  if (turnos.length > 0) {
    y2 = bloque(p2, y2, 28 + turnos.length * 13, 'Turnos que regaron este lote')
    for (const t of turnos) {
      p2.texto(MARGEN + 14, y2, `${t.turno_codigo ?? ''} ${t.turno_nombre ?? ''}`.trim() || '—', {
        tamano: 8.5,
        negrita: true,
      })
      p2.texto(
        ANCHO - MARGEN - 14,
        y2,
        `${num(t.mz_cubiertas)} de ${num(t.mz_total_turno)} mz  ·  factor ${Number(
          t.factor_lote ?? 0,
        ).toFixed(4)}  ·  ${fecha(t.fecha_aplicacion)}`,
        { tamano: 8.5, gris: 0.35, alineacion: 'derecha' },
      )
      y2 += 13
    }
    p2.texto(
      MARGEN + 14,
      y2 + 4,
      'El factor es las manzanas del lote entre las del turno: con él se reparten litros y costos.',
      { tamano: 7.5, gris: 0.5 },
    )
  }

  pie(p2, lote, fila.ciclo, hoy)

  /* ------------------------- El pie ------------------------------ */
  pie(p, lote, fila.ciclo, hoy)

  return construirPdf([p, p2], `Informe ejecutivo · ${lote}`)
}

/**
 * De qué color se escribe una desviación.
 *
 * La misma banda que usa la pantalla (`tonoDelta`): dentro del ±5 % es
 * ruido de campo y se deja en negro. Pintar de rojo cualquier número por
 * encima del plan haría que todo saliera rojo, y un informe donde todo
 * está en rojo no señala nada.
 */
function desviacionColor(pct: number | null | undefined): Rgb | undefined {
  if (pct === null || pct === undefined || !Number.isFinite(pct)) return undefined
  if (Math.abs(pct) <= 5) return undefined
  if (pct > 5) return ROJO
  return VERDE
}

/** El nombre del archivo, legible y ordenable. */
export function nombreInforme(fila: FilaInforme): string {
  return `informe-${fila.lote_nomenclatura}-c${fila.ciclo}.pdf`
}
