/**
 * Un PDF de una página, escrito a mano.
 *
 * El proyecto no tiene ni una dependencia de terceros —el Excel también
 * se escribe byte a byte en `lib/hojas`— y un acta de entrega no
 * justifica meter trescientos kilobytes de librería en el paquete que
 * baja un teléfono en la finca. Un acta es texto, rayas y recuadros:
 * eso es exactamente lo que un PDF sabe hacer sin ayuda.
 *
 * Qué genera: un PDF 1.4 con las dos Helvetica de siempre —normal y
 * negrita— que van DENTRO de todo lector desde hace treinta años, así
 * que no hay que incrustar ninguna fuente.
 *
 * Coordenadas: aquí la Y se cuenta DESDE ARRIBA, que es como se piensa
 * una hoja. El PDF la cuenta desde abajo; la conversión está en un solo
 * sitio (`aPdf`) y no se reparte por el documento que se dibuja.
 *
 * Codificación: WinAnsi (Latin-1), que cubre el español entero —tildes,
 * ñ, ü, ¿, ¡—. Un carácter fuera de ese juego se sustituye en vez de
 * romper el archivo: un acta con un guion raro convertido en guion
 * normal se entrega igual; una que no abre, no.
 */

export type Punto = { x: number; y: number }

export type OpcionesTexto = {
  /** En puntos. 10 es el cuerpo normal de un acta. */
  tamano?: number
  negrita?: boolean
  /** Gris en 0..1. 0 es negro. */
  gris?: number
  alineacion?: 'izquierda' | 'derecha' | 'centro'
}

/** Carta, en puntos. Es el tamaño en el que se imprime en Honduras. */
export const ANCHO = 612
export const ALTO = 792

/** Anchos de la Helvetica, en milésimas de em, para poder centrar. */
const ANCHOS_HELVETICA: Record<string, number> = {
  ' ': 278, '!': 278, '"': 355, '#': 556, $: 556, '%': 889, '&': 667, "'": 191,
  '(': 333, ')': 333, '*': 389, '+': 584, ',': 278, '-': 333, '.': 278, '/': 278,
  '0': 556, '1': 556, '2': 556, '3': 556, '4': 556, '5': 556, '6': 556, '7': 556,
  '8': 556, '9': 556, ':': 278, ';': 278, '<': 584, '=': 584, '>': 584, '?': 556,
  '@': 1015, A: 667, B: 667, C: 722, D: 722, E: 667, F: 611, G: 778, H: 722,
  I: 278, J: 500, K: 667, L: 556, M: 833, N: 722, O: 778, P: 667, Q: 778, R: 722,
  S: 667, T: 611, U: 722, V: 667, W: 944, X: 667, Y: 667, Z: 611,
  '[': 278, '\\': 278, ']': 278, '^': 469, _: 556, '`': 333,
  a: 556, b: 556, c: 500, d: 556, e: 556, f: 278, g: 556, h: 556, i: 222, j: 222,
  k: 500, l: 222, m: 833, n: 556, o: 556, p: 556, q: 556, r: 333, s: 500, t: 278,
  u: 556, v: 500, w: 722, x: 500, y: 500, z: 500,
  '{': 334, '|': 260, '}': 334, '~': 584,
}

/** Lo ancho que sale un texto, en puntos. Las tildes miden como su letra. */
export function anchoTexto(texto: string, tamano: number, negrita = false): number {
  let milesimas = 0
  for (const c of quitarAcentosParaMedir(texto)) {
    milesimas += ANCHOS_HELVETICA[c] ?? 556
  }
  // La negrita de Helvetica es un 4 % más ancha de media. Es una
  // aproximación a propósito: se usa para centrar y para no salirse del
  // recuadro, no para justificar tipografía.
  return (milesimas / 1000) * tamano * (negrita ? 1.04 : 1)
}

function quitarAcentosParaMedir(texto: string): string {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '')
}

/** Latin-1, con los paréntesis y la barra escapados, que es lo que pide el PDF. */
function aCadenaPdf(texto: string): string {
  let out = ''
  for (const c of texto) {
    const punto = c.codePointAt(0) ?? 63
    // Fuera de Latin-1 no hay byte que lo represente: se cae al
    // equivalente sin acento y, si tampoco lo hay, a un interrogante.
    const usable =
      punto <= 255 ? c : (quitarAcentosParaMedir(c).codePointAt(0) ?? 63) <= 255
        ? quitarAcentosParaMedir(c)
        : '?'
    for (const u of usable) {
      if (u === '(' || u === ')' || u === '\\') out += '\\' + u
      else out += u
    }
  }
  return out
}

const dos = (n: number) => (Math.round(n * 100) / 100).toString()

/**
 * El lienzo de una página.
 *
 * Acumula órdenes de dibujo y al final las cierra en un PDF. No sabe de
 * actas ni de asignaciones: recibe dónde va cada cosa.
 */
export class Pagina {
  private ordenes: string[] = []

  /** De «Y desde arriba» a la Y que entiende el PDF. */
  private aPdf(y: number): number {
    return ALTO - y
  }

  texto(x: number, y: number, texto: string, op: OpcionesTexto = {}): this {
    const tamano = op.tamano ?? 10
    const fuente = op.negrita ? '/F2' : '/F1'
    const gris = op.gris ?? 0

    let izquierda = x
    if (op.alineacion === 'derecha') izquierda = x - anchoTexto(texto, tamano, op.negrita)
    if (op.alineacion === 'centro') izquierda = x - anchoTexto(texto, tamano, op.negrita) / 2

    this.ordenes.push(
      `BT ${dos(gris)} g ${fuente} ${dos(tamano)} Tf ` +
        `1 0 0 1 ${dos(izquierda)} ${dos(this.aPdf(y) - tamano)} Tm ` +
        `(${aCadenaPdf(texto)}) Tj ET`
    )
    return this
  }

  /**
   * Texto que se parte solo para caber en un ancho.
   *
   * Devuelve la Y en la que quedó, para poder seguir escribiendo debajo
   * sin adivinar cuántas líneas ocupó.
   */
  parrafo(
    x: number,
    y: number,
    ancho: number,
    texto: string,
    op: OpcionesTexto & { interlineado?: number } = {}
  ): number {
    const tamano = op.tamano ?? 10
    const alto = op.interlineado ?? tamano * 1.35
    let linea = ''
    let cursor = y

    for (const palabra of texto.split(/\s+/).filter(Boolean)) {
      const prueba = linea ? `${linea} ${palabra}` : palabra
      if (anchoTexto(prueba, tamano, op.negrita) > ancho && linea) {
        this.texto(x, cursor, linea, op)
        cursor += alto
        linea = palabra
      } else {
        linea = prueba
      }
    }
    if (linea) {
      this.texto(x, cursor, linea, op)
      cursor += alto
    }
    return cursor
  }

  linea(desde: Punto, hasta: Punto, gris = 0.6, grosor = 0.6): this {
    this.ordenes.push(
      `${dos(gris)} G ${dos(grosor)} w ${dos(desde.x)} ${dos(this.aPdf(desde.y))} m ` +
        `${dos(hasta.x)} ${dos(this.aPdf(hasta.y))} l S`
    )
    return this
  }

  /** Un recuadro. `relleno` en 0..1 lo pinta; sin él sólo se traza el borde. */
  rectangulo(
    x: number,
    y: number,
    ancho: number,
    alto: number,
    op: { gris?: number; relleno?: number; grosor?: number } = {}
  ): this {
    const yPdf = this.aPdf(y + alto)
    if (op.relleno !== undefined) {
      this.ordenes.push(
        `${dos(op.relleno)} g ${dos(x)} ${dos(yPdf)} ${dos(ancho)} ${dos(alto)} re f`
      )
    }
    if (op.gris !== undefined) {
      this.ordenes.push(
        `${dos(op.gris)} G ${dos(op.grosor ?? 0.6)} w ` +
          `${dos(x)} ${dos(yPdf)} ${dos(ancho)} ${dos(alto)} re S`
      )
    }
    return this
  }

  contenido(): string {
    return this.ordenes.join('\n')
  }
}

/**
 * Cierra las páginas en un PDF completo.
 *
 * La tabla `xref` guarda el byte exacto en el que empieza cada objeto, y
 * por eso se van midiendo mientras se escriben: calcularla después
 * obligaría a recorrer el archivo otra vez.
 */
export function construirPdf(paginas: Pagina[], titulo = 'Documento'): Blob {
  const objetos: string[] = []
  const n = paginas.length

  // 1: catálogo · 2: páginas · 3..: una página y su contenido · luego fuentes.
  const idPagina = (i: number) => 3 + i * 2
  const idContenido = (i: number) => 4 + i * 2
  const idF1 = 3 + n * 2
  const idF2 = idF1 + 1

  objetos.push('<< /Type /Catalog /Pages 2 0 R >>')
  objetos.push(
    `<< /Type /Pages /Count ${n} /Kids [${paginas
      .map((_, i) => `${idPagina(i)} 0 R`)
      .join(' ')}] >>`
  )

  for (let i = 0; i < n; i++) {
    objetos.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${ANCHO} ${ALTO}] ` +
        `/Resources << /Font << /F1 ${idF1} 0 R /F2 ${idF2} 0 R >> >> ` +
        `/Contents ${idContenido(i)} 0 R >>`
    )
    const flujo = paginas[i].contenido()
    objetos.push(`<< /Length ${flujo.length} >>\nstream\n${flujo}\nendstream`)
  }

  objetos.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>')
  objetos.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>')

  let archivo = '%PDF-1.4\n'
  const posiciones: number[] = []
  objetos.forEach((cuerpo, i) => {
    posiciones.push(archivo.length)
    archivo += `${i + 1} 0 obj\n${cuerpo}\nendobj\n`
  })

  const inicioXref = archivo.length
  archivo += `xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n`
  for (const pos of posiciones) {
    archivo += `${String(pos).padStart(10, '0')} 00000 n \n`
  }
  archivo +=
    `trailer\n<< /Size ${objetos.length + 1} /Root 1 0 R ` +
    `/Info << /Title (${aCadenaPdf(titulo)}) /Producer (AgroNotificaciones) >> >>\n` +
    `startxref\n${inicioXref}\n%%EOF`

  // Un byte por carácter: todo lo escrito está en Latin-1, así que el
  // desplazamiento en caracteres que guarda `xref` ES el desplazamiento
  // en bytes. Con UTF-8 no lo sería y el archivo no abriría.
  const bytes = new Uint8Array(archivo.length)
  for (let i = 0; i < archivo.length; i++) bytes[i] = archivo.charCodeAt(i) & 0xff

  return new Blob([bytes], { type: 'application/pdf' })
}
