/**
 * El acta de entrega: qué dice y cómo se dibuja en PDF.
 *
 * Es el papel que se imprime, se firma y se archiva cuando se le entrega
 * un teléfono a alguien. Tiene que poder leerse dentro de dos años sin la
 * aplicación al lado: por eso lleva impreso TODO lo que identifica lo
 * entregado —IMEI, número, correo, memoria— y no una referencia a un
 * registro que puede haberse corregido después.
 *
 * QUÉ DICE el acta vive en `bloquesActa`, y CÓMO se dibuja, en cada
 * medio: aquí abajo en PDF y en `ActaPreview` en pantalla. Separarlo es
 * lo que evita que la vista previa y el PDF enseñen cosas distintas, que
 * es el peor resultado posible para un documento que se firma.
 */

import { ANCHO, Pagina, anchoTexto, construirPdf } from '@/lib/pdf/documento'
import { instanteDeFecha, ZONA } from '@/lib/fechas'
import { accesorios, etiquetaCentro, type FilaAsignacion } from './tipos'

const MARGEN = 54
const DERECHA = ANCHO - MARGEN
const ANCHO_UTIL = DERECHA - MARGEN
const CENTRO = ANCHO / 2

/** El membrete, palabra por palabra. Lo fija la empresa, no el código. */
export const ENCABEZADO = {
  empresa: 'Agropecuaria Montelíbano S.A.',
  documento: 'Acta de Entrega',
  unidad: 'Torre Control - Distrito Valle',
} as const

export const DECLARACION =
  'Declaro haber recibido en buen estado los bienes descritos en esta acta, que son propiedad de ' +
  ENCABEZADO.empresa +
  ', y me comprometo a darles el uso adecuado para el desempeño de mis funciones y a devolverlos ' +
  'en las mismas condiciones cuando me sea requerido o al terminar mi relación laboral.'

/**
 * Las dos firmas.
 *
 * Sin nombres impresos: el acta se firma A MANO y poner el nombre ya
 * escrito invita a archivarla sin firma, que es justo lo que la deja sin
 * valor el día que hay que reclamar un equipo.
 */
export const FIRMAS = ['Firma de quien entrega', 'Firma de quien recibe'] as const

export function fechaLarga(iso: string | null): string {
  if (!iso) return '—'
  return instanteDeFecha(iso).toLocaleDateString('es-HN', {
    timeZone: ZONA,
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  })
}

/** El nombre del archivo: quien lo reciba por correo tiene que saber qué es. */
export function nombreActa(a: FilaAsignacion): string {
  const quien = a.empleado
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, '-')
  return `acta-entrega-${quien}-${a.fecha_entrega}.pdf`.toLowerCase()
}

export type BloquesActa = {
  fecha: string
  colaborador: [string, string][]
  equipo: [string, string][]
  accesorios: string[]
  devolucion: string | null
  observaciones: string | null
  folio: string
}

/**
 * QUÉ dice el acta. Una sola fuente para el PDF y para la vista previa.
 *
 * Los campos vacíos salen como raya y no se esconden: un acta con el
 * hueco a la vista deja claro que ahí no se entregó nada, y una a la que
 * le faltan filas deja la duda de si se olvidó ponerlas.
 */
export function bloquesActa(a: FilaAsignacion): BloquesActa {
  return {
    fecha: fechaLarga(a.fecha_entrega),
    colaborador: [
      ['Nombre', a.empleado],
      ['Código', a.codigo_empleado ?? '—'],
      ['Puesto', a.puesto ?? '—'],
      ['Departamento', a.departamento ?? '—'],
      // «1020 - Agrícola» y no «1020»: el acta la lee gerencia dentro de
      // dos años y el código solo no dice nada.
      [
        'Centro de costo',
        a.centro_costo_etiqueta ||
          etiquetaCentro(a.centro_costo, a.centro_costo_nombre) ||
          '—',
      ],
      ['Correo asignado', a.correo_asignado ?? '—'],
    ],
    equipo: [
      ['Marca y modelo', a.marca_modelo ?? 'No se entrega equipo'],
      ['IMEI', a.equipo_imei ?? '—'],
      ['Memoria RAM', a.ram ?? '—'],
      ['Almacenamiento', a.almacenamiento ?? '—'],
      ['Teléfono asignado', a.linea_numero ?? 'No se entrega línea'],
      ['Plan / proveedor', [a.plan_nombre, a.linea_proveedor].filter(Boolean).join(' · ') || '—'],
    ],
    accesorios: accesorios(a.accesorios_entregados),
    devolucion: a.fecha_devolucion_programada
      ? `Entrega temporal. Fecha pactada de devolución: ${fechaLarga(a.fecha_devolucion_programada)}.`
      : null,
    observaciones: a.observaciones,
    folio: a.id.slice(0, 8).toUpperCase(),
  }
}

/* ================================================================== */
/* El PDF                                                             */
/* ================================================================== */

export function construirActa(a: FilaAsignacion): Blob {
  const b = bloquesActa(a)
  const p = new Pagina()
  let y = MARGEN

  /* ----------------------------- Membrete ------------------------------ */
  // Centrado y en tres líneas: es el encabezado con el que la empresa
  // archiva sus documentos, no un título de pantalla.

  p.texto(CENTRO, y, ENCABEZADO.empresa, { tamano: 15, negrita: true, alineacion: 'centro' })
  y += 22
  p.texto(CENTRO, y, ENCABEZADO.documento, { tamano: 13, negrita: true, alineacion: 'centro' })
  y += 19
  p.texto(CENTRO, y, ENCABEZADO.unidad, { tamano: 10.5, alineacion: 'centro', gris: 0.35 })
  y += 20

  p.linea({ x: MARGEN, y }, { x: DERECHA, y }, 0.25, 1.2)
  y += 16
  p.texto(DERECHA, y, `Fecha de entrega: ${b.fecha}`, {
    tamano: 10,
    alineacion: 'derecha',
    gris: 0.35,
  })
  y += 24

  /* ------------------------- Colaborador y equipo ---------------------- */

  y = bloque(p, y, 'Datos del colaborador', b.colaborador)
  y = bloque(p, y, 'Datos del equipo entregado', b.equipo)

  /* ----------------------------- Accesorios ---------------------------- */

  p.texto(MARGEN, y, 'Accesorios entregados', { tamano: 9, negrita: true, gris: 0.35 })
  y += 16

  if (b.accesorios.length === 0) {
    p.texto(MARGEN, y, 'Ninguno.', { tamano: 10, gris: 0.45 })
    y += 18
  } else {
    // En dos columnas: ocho accesorios en una sola lista vertical se
    // comen media hoja y dejan las firmas en la segunda página.
    const mitad = Math.ceil(b.accesorios.length / 2)
    const columnas = [b.accesorios.slice(0, mitad), b.accesorios.slice(mitad)]
    let maximo = y
    columnas.forEach((columna, i) => {
      let cursor = y
      const x = MARGEN + i * (ANCHO_UTIL / 2)
      for (const item of columna) {
        // La casilla marcada: se entregó, y el papel lo dice sin que
        // haya que confiar en la lista de al lado.
        p.rectangulo(x, cursor + 1.5, 8, 8, { gris: 0.45 })
        p.texto(x + 1.9, cursor + 2.2, 'X', { tamano: 6.5, negrita: true, gris: 0.15 })
        p.texto(x + 14, cursor, item, { tamano: 10 })
        cursor += 15
      }
      maximo = Math.max(maximo, cursor)
    })
    y = maximo + 4
  }

  y += 8

  /* ---------------------------- Devolución ----------------------------- */

  if (b.devolucion) {
    p.rectangulo(MARGEN, y, ANCHO_UTIL, 30, { relleno: 0.95 })
    p.texto(MARGEN + 10, y + 10, b.devolucion, { tamano: 10, negrita: true })
    y += 42
  }

  if (b.observaciones) {
    p.texto(MARGEN, y, 'Observaciones', { tamano: 9, negrita: true, gris: 0.35 })
    y += 14
    y = p.parrafo(MARGEN, y, ANCHO_UTIL, b.observaciones, { tamano: 10 }) + 8
  }

  p.parrafo(MARGEN, y, ANCHO_UTIL, DECLARACION, { tamano: 9, gris: 0.3 })

  /* ------------------------------ Firmas ------------------------------- */

  // Ancladas al pie y no debajo del texto: dos actas con distinta
  // cantidad de accesorios tienen que poder archivarse juntas.
  const yFirmas = 665
  const anchoFirma = 210
  const columnas: [number, string][] = [
    [MARGEN, FIRMAS[0]],
    [DERECHA - anchoFirma, FIRMAS[1]],
  ]

  for (const [x, rotulo] of columnas) {
    // La raya se dibuja con guiones bajos y no con una línea vectorial:
    // así el hueco para firmar se ve igual en el papel y en la pantalla,
    // que es como lo pidió quien archiva estas actas.
    p.texto(x + anchoFirma / 2, yFirmas, '_________________________', {
      tamano: 11,
      alineacion: 'centro',
      gris: 0.25,
    })
    p.texto(x + anchoFirma / 2, yFirmas + 20, rotulo, {
      tamano: 9.5,
      negrita: true,
      alineacion: 'centro',
      gris: 0.25,
    })
  }

  /* ------------------------------- Pie --------------------------------- */

  p.linea({ x: MARGEN, y: 740 }, { x: DERECHA, y: 740 }, 0.8, 0.5)
  p.texto(MARGEN, 746, `Acta ${b.folio}`, { tamano: 8, gris: 0.55 })
  p.texto(DERECHA, 746, `${ENCABEZADO.empresa} · ${ENCABEZADO.unidad}`, {
    tamano: 8,
    alineacion: 'derecha',
    gris: 0.55,
  })

  return construirPdf([p], `${ENCABEZADO.documento} · ${a.empleado}`)
}

/**
 * Un bloque de datos en dos columnas de «etiqueta: valor».
 *
 * Devuelve la Y en la que terminó. Que lo calcule el bloque y no quien lo
 * llama es lo que permite añadir un campo sin recolocar el resto del acta
 * a mano.
 */
function bloque(p: Pagina, y: number, titulo: string, filas: [string, string][]): number {
  p.texto(MARGEN, y, titulo, { tamano: 9, negrita: true, gris: 0.35 })
  y += 16

  const anchoColumna = ANCHO_UTIL / 2
  const anchoValor = anchoColumna - 104
  const ALTO_FILA = 17

  // Cuántas líneas ocupa la fila más alta de cada renglón: un puesto
  // largo o un correo corporativo no se RECORTAN —un acta con el correo
  // cortado no sirve para nada— sino que bajan a la línea siguiente, y
  // entonces el renglón entero crece.
  const renglones = Math.ceil(filas.length / 2)
  const altos: number[] = []
  for (let r = 0; r < renglones; r++) {
    const delRenglon = filas.slice(r * 2, r * 2 + 2)
    altos.push(Math.max(...delRenglon.map(([, v]) => lineasQueOcupa(v, anchoValor)), 1))
  }

  const arranque: number[] = []
  let cursor = y
  for (let r = 0; r < renglones; r++) {
    arranque.push(cursor)
    cursor += altos[r] * (ALTO_FILA - 4) + 4
  }

  filas.forEach(([etiqueta, valor], i) => {
    const columna = i % 2
    const renglon = Math.floor(i / 2)
    const x = MARGEN + columna * anchoColumna
    const yFila = arranque[renglon]

    p.texto(x, yFila, `${etiqueta}:`, { tamano: 9, gris: 0.5 })
    p.parrafo(x + 100, yFila, anchoValor, valor, {
      tamano: 10,
      negrita: true,
      interlineado: ALTO_FILA - 4,
    })
  })

  return cursor + 10
}

/** Cuántas líneas de 10 pt ocupa un texto dentro de un ancho dado. */
function lineasQueOcupa(texto: string, ancho: number): number {
  let lineas = 1
  let actual = ''
  for (const palabra of texto.split(/\s+/).filter(Boolean)) {
    const prueba = actual ? `${actual} ${palabra}` : palabra
    if (anchoTexto(prueba, 10, true) > ancho && actual) {
      lineas++
      actual = palabra
    } else {
      actual = prueba
    }
  }
  return lineas
}
