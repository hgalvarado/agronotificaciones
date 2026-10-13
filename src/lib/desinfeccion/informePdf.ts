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
  piezasDe,
  porcentajeDe,
  productosDe,
  retrasoDias,
  conSigno,
  type FilaInforme,
} from './informe'

/** Los mismos tres colores de la pantalla, en 0..1 por canal. */
const COLOR: Record<'quimico' | 'personal' | 'logistica', Rgb> = {
  quimico: { r: 0.01, g: 0.41, b: 0.63 },
  personal: { r: 0.09, g: 0.64, b: 0.29 },
  logistica: { r: 0.76, g: 0.25, b: 0.05 },
}

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
  op: { negrita?: boolean; color?: Rgb; ancho?: number } = {}
): void {
  p.texto(x, y, etiqueta.toUpperCase(), { tamano: 6.5, gris: 0.5 })
  p.texto(x, y + 9, valor, {
    tamano: op.negrita ? 10.5 : 9.5,
    negrita: op.negrita,
    color: op.color,
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
  y = bloque(p, y, 76, 'Contexto del lote')
  const col = UTIL / 4
  dato(p, MARGEN + 14, y, 'Zona', fila.zona_nombre ?? '—')
  dato(p, MARGEN + 14 + col, y, 'Temporada', fila.temporada_nombre ?? '—')
  dato(p, MARGEN + 14 + col * 2, y, 'Variedad', fila.variedad ?? '—')
  dato(p, MARGEN + 14 + col * 3, y, 'Manzanas regadas', `${num(fila.mz_regadas)} mz`)
  y += 30

  const retraso = retrasoDias(fila)
  dato(p, MARGEN + 14, y, 'Preriego', `${fecha(fila.fecha_preriego)}  (${fila.ddt_preriego ?? '—'} DDT)`)
  dato(p, MARGEN + 14 + col, y, 'Aplicación', `${fecha(fila.fecha_aplicacion)}  (${fila.ddt_aplicacion ?? '—'} DDT)`)
  dato(
    p,
    MARGEN + 14 + col * 2,
    y,
    fila.origen_siembra === 'real' ? 'Siembra' : 'Siembra prevista',
    fecha(fila.fecha_siembra)
  )
  dato(
    p,
    MARGEN + 14 + col * 3,
    y,
    'Contra el plan',
    retraso === null ? 'Sin plan' : `${conSigno(retraso, 0)} días`,
    { color: retraso !== null && retraso > 7 ? ROJO : undefined }
  )
  y += 40

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
    { color: desviacionColor(fila.delta_dosis_pct) }
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
  const piezas = piezasDe(fila)
  y = bloque(p, y, 150, 'Análisis financiero')

  dato(p, MARGEN + 14, y, 'Costo planificado', fila.costo_plan === null ? 'Sin plan' : `L ${num(fila.costo_plan)}`)
  dato(p, MARGEN + 14 + col, y, 'Costo real', `L ${num(fila.costo_total)}`, { negrita: true })
  dato(
    p,
    MARGEN + 14 + col * 2,
    y,
    'Desviación',
    fila.delta_costo === null
      ? 'Sin plan'
      : `L ${conSigno(fila.delta_costo)}  (${conSigno(fila.delta_costo_pct, 1)}%)`,
    { color: desviacionColor(fila.delta_costo_pct) }
  )
  dato(p, MARGEN + 14 + col * 3, y, 'Costo por manzana', `L ${num(fila.costo_mz)}`, {
    negrita: true,
  })
  y += 40

  /* La barra del reparto. Dibujada y no listada: en una hoja, tres
     cifras en columna no dicen cuál pesa más hasta que se restan. */
  const total = piezas.reduce((a, q) => a + q.valor, 0)
  const anchoBarra = UTIL - 28
  if (total > 0) {
    let x = MARGEN + 14
    for (const q of piezas) {
      const w = (q.valor / total) * anchoBarra
      p.rectangulo(x, y, Math.max(w - 2, 1), 16, { color: COLOR[q.clave] })
      x += w
    }
    y += 26

    for (const q of piezas) {
      p.rectangulo(MARGEN + 14, y - 1, 7, 7, { color: COLOR[q.clave] })
      p.texto(MARGEN + 26, y - 2, q.etiqueta, { tamano: 9 })
      p.texto(MARGEN + 150, y - 2, `L ${num(q.valor)}`, { tamano: 9, alineacion: 'derecha' })
      p.texto(MARGEN + 190, y - 2, `${porcentajeDe(q, piezas).toFixed(0)}%`, {
        tamano: 9,
        gris: 0.45,
        alineacion: 'derecha',
      })
      y += 15
    }
  }

  /* La fase más cara, dicha con palabras. Es la pregunta que más se
     repite en gerencia y la barra no la contesta: el acarreo y el
     químico no son fases, son conceptos. */
  const faseY = y - (piezas.length * 15 + 26) + 4
  if (fila.fase_mas_cara) {
    p.texto(ANCHO / 2 + 10, faseY, 'FASE MÁS CARA DE LA CUADRILLA', { tamano: 6.5, gris: 0.5 })
    p.texto(ANCHO / 2 + 10, faseY + 11, fila.fase_mas_cara, { tamano: 13, negrita: true })
    p.texto(
      ANCHO / 2 + 10,
      faseY + 28,
      `Preriego L ${num(fila.costo_personal_preriego)}  ·  ` +
        `Aplicación L ${num(fila.costo_personal_aplicacion)}`,
      { tamano: 8.5, gris: 0.4 }
    )
  }

  /* ------------------------- El pie ------------------------------ */
  p.linea({ x: MARGEN, y: ALTO - 46 }, { x: ANCHO - MARGEN, y: ALTO - 46 }, 0.85, 0.5)
  p.texto(MARGEN, ALTO - 40, `${EMPRESA} · AgroNotificaciones`, { tamano: 7.5, gris: 0.5 })
  p.texto(
    ANCHO - MARGEN,
    ALTO - 40,
    `${lote} · ciclo ${fila.ciclo} · emitido el ${hoy}`,
    { tamano: 7.5, gris: 0.5, alineacion: 'derecha' }
  )

  return construirPdf([p], `Informe ejecutivo · ${lote}`)
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
