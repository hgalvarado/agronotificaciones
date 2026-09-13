// =====================================================================
// Lectura y escritura de hojas de cálculo SIN dependencias externas
// =====================================================================
// Por qué a mano y no con una librería:
//
//   1. Ya perdimos una tarde con `npm install` en la máquina de Windows
//      (el binario nativo de Turbopack). Cada dependencia nueva es un
//      riesgo de que el proyecto no arranque en la red corporativa.
//   2. Las dos librerías populares no convencen: `xlsx` (SheetJS) en npm
//      está congelada en 0.18.5 con un aviso de seguridad sin corregir, y
//      `exceljs` arrastra polyfills de `stream`/`buffer` en el navegador.
//   3. Un .xlsx es un ZIP con XML dentro. El navegador ya trae todo lo
//      necesario: `DecompressionStream` para descomprimir y `DOMParser`
//      para leer el XML. No hace falta traer un megabyte de código.
//
// Al escribir se guarda sin comprimir (método "store"): Excel lo abre sin
// problema y así no hace falta ni comprimir.
// =====================================================================

/* ------------------------------------------------------------------ */
/* CRC32 — lo exige la cabecera del ZIP                                */
/* ------------------------------------------------------------------ */

let tablaCrc: Uint32Array | null = null

function obtenerTablaCrc() {
  if (tablaCrc) return tablaCrc
  const tabla = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    tabla[i] = c >>> 0
  }
  tablaCrc = tabla
  return tabla
}

function crc32(datos: Uint8Array) {
  const tabla = obtenerTablaCrc()
  let c = 0xffffffff
  for (let i = 0; i < datos.length; i++) c = tabla[(c ^ datos[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/* ------------------------------------------------------------------ */
/* Utilidades binarias                                                 */
/* ------------------------------------------------------------------ */

const codificador = new TextEncoder()

function escaparXml(texto: string) {
  return texto
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    // Excel rechaza el archivo completo si aparece un carácter de control.
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
}

/** Índice de columna (0) a letra de Excel: 0 → A, 26 → AA. */
export function letraColumna(indice: number) {
  let n = indice + 1
  let letra = ''
  while (n > 0) {
    const resto = (n - 1) % 26
    letra = String.fromCharCode(65 + resto) + letra
    n = Math.floor((n - 1) / 26)
  }
  return letra
}

/** Letra de Excel a índice base 0: 'A' → 0, 'AA' → 26. */
function indiceColumna(letra: string) {
  let n = 0
  for (const ch of letra) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n - 1
}

/* ------------------------------------------------------------------ */
/* ESCRITURA                                                           */
/* ------------------------------------------------------------------ */

export type CeldaHoja = string | number | boolean | null | undefined

type EntradaZip = { nombre: string; datos: Uint8Array }

function armarZip(entradas: EntradaZip[]) {
  const locales: Uint8Array[] = []
  const central: Uint8Array[] = []
  let desplazamiento = 0

  for (const entrada of entradas) {
    const nombre = codificador.encode(entrada.nombre)
    const crc = crc32(entrada.datos)
    const tamano = entrada.datos.length

    // Cabecera local
    const local = new Uint8Array(30 + nombre.length)
    const vl = new DataView(local.buffer)
    vl.setUint32(0, 0x04034b50, true) // firma
    vl.setUint16(4, 20, true) // versión necesaria
    vl.setUint16(6, 0x0800, true) // nombres en UTF-8
    vl.setUint16(8, 0, true) // método 0 = sin comprimir
    vl.setUint32(14, crc, true)
    vl.setUint32(18, tamano, true)
    vl.setUint32(22, tamano, true)
    vl.setUint16(26, nombre.length, true)
    local.set(nombre, 30)

    locales.push(local, entrada.datos)

    // Entrada del directorio central
    const dir = new Uint8Array(46 + nombre.length)
    const vd = new DataView(dir.buffer)
    vd.setUint32(0, 0x02014b50, true)
    vd.setUint16(4, 20, true)
    vd.setUint16(6, 20, true)
    vd.setUint16(8, 0x0800, true)
    vd.setUint16(10, 0, true)
    vd.setUint32(16, crc, true)
    vd.setUint32(20, tamano, true)
    vd.setUint32(24, tamano, true)
    vd.setUint16(28, nombre.length, true)
    vd.setUint32(42, desplazamiento, true)
    dir.set(nombre, 46)
    central.push(dir)

    desplazamiento += local.length + tamano
  }

  const tamanoCentral = central.reduce((a, b) => a + b.length, 0)
  const fin = new Uint8Array(22)
  const vf = new DataView(fin.buffer)
  vf.setUint32(0, 0x06054b50, true)
  vf.setUint16(8, entradas.length, true)
  vf.setUint16(10, entradas.length, true)
  vf.setUint32(12, tamanoCentral, true)
  vf.setUint32(16, desplazamiento, true)

  const partes = [...locales, ...central, fin]
  const total = partes.reduce((a, b) => a + b.length, 0)
  const salida = new Uint8Array(total)
  let p = 0
  for (const parte of partes) {
    salida.set(parte, p)
    p += parte.length
  }
  return salida
}

/**
 * Una validación de datos: la lista desplegable que Excel muestra en un
 * rango de celdas.
 *
 * `nombreLista` es un NOMBRE DEFINIDO del libro, no un rango escrito a
 * mano. Excel moderno acepta `Listas!$A$2:$A$40` dentro de `formula1`,
 * pero las versiones de escritorio más viejas —y las que hay instaladas
 * en la finca— sólo aceptan referencias a otra hoja a través de un
 * nombre definido. Con el nombre funciona en todas.
 */
type Validacion = {
  /** Rango de la hoja de datos, en notación de Excel: 'B2:B501'. */
  sqref: string
  nombreLista: string
  /**
   * Si es true, Excel RECHAZA cualquier valor que no esté en la lista.
   * En false sólo ofrece el desplegable y deja escribir otra cosa: es lo
   * que hace falta en las columnas donde caben varios valores separados
   * por coma, porque «Arado, Rastreo» nunca va a estar en la lista y
   * bloquearlo dejaría la columna inservible.
   */
  bloquear: boolean
}

type HojaLibro = {
  nombre: string
  filas: CeldaHoja[][]
  validaciones?: Validacion[]
}

function hojaXml(filas: CeldaHoja[][], validaciones: Validacion[] = []) {
  const cuerpo = filas
    .map((fila, f) => {
      const celdas = fila
        .map((valor, c) => {
          if (valor === null || valor === undefined || valor === '') return ''
          const ref = `${letraColumna(c)}${f + 1}`
          if (typeof valor === 'number' && Number.isFinite(valor)) {
            return `<c r="${ref}"><v>${valor}</v></c>`
          }
          const texto = typeof valor === 'boolean' ? (valor ? 'SI' : 'NO') : String(valor)
          // La primera fila es el encabezado: se marca con el estilo 1 (negrita).
          const estilo = f === 0 ? ' s="1"' : ''
          return `<c r="${ref}"${estilo} t="inlineStr"><is><t xml:space="preserve">${escaparXml(texto)}</t></is></c>`
        })
        .join('')
      return `<row r="${f + 1}">${celdas}</row>`
    })
    .join('')

  const anchos = (filas[0] ?? [])
    .map((_, c) => `<col min="${c + 1}" max="${c + 1}" width="22" customWidth="1"/>`)
    .join('')

  // `dataValidations` va DESPUÉS de `sheetData`: el esquema de
  // SpreadsheetML fija el orden de los elementos y Excel rechaza el
  // archivo completo —«contenido ilegible»— si se pone antes.
  //
  // `showDropDown` no se escribe a propósito: el atributo está invertido
  // en el formato y ponerlo en 1 ESCONDE la flechita del desplegable.
  const validacion =
    validaciones.length === 0
      ? ''
      : `<dataValidations count="${validaciones.length}">${validaciones
          .map(
            (v) =>
              `<dataValidation type="list" allowBlank="1" showInputMessage="1"` +
              ` showErrorMessage="${v.bloquear ? 1 : 0}"` +
              (v.bloquear
                ? ` errorStyle="stop" errorTitle="Valor no válido"` +
                  ` error="Elige uno de la lista. Si de verdad es nuevo, agrégalo primero en su catálogo."`
                : '') +
              ` sqref="${v.sqref}"><formula1>${v.nombreLista}</formula1></dataValidation>`
          )
          .join('')}</dataValidations>`

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cols>${anchos}</cols><sheetData>${cuerpo}</sheetData>${validacion}</worksheet>`
}

/** Nombre de hoja aceptable para Excel: sin : \ / ? * [ ] y máx. 31. */
function limpiarNombreHoja(nombre: string) {
  return (nombre || 'Hoja1').replace(/[:\\/?*[\]]/g, '-').slice(0, 31)
}

/**
 * Núcleo compartido: arma el ZIP de un libro con una o varias hojas y,
 * si hace falta, con nombres definidos (los que usan las validaciones).
 */
function construirLibro(
  hojas: HojaLibro[],
  definidos: { nombre: string; formula: string }[] = []
): Blob {
  const nombres = hojas.map((h) => limpiarNombreHoja(h.nombre))

  const contentTypes = hojas
    .map(
      (_, i) =>
        `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
    )
    .join('')

  const listaHojas = nombres
    .map((n, i) => `<sheet name="${escaparXml(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
    .join('')

  // `definedNames` va después de `sheets`, otra vez por el orden que
  // exige el esquema.
  const nombresDefinidos =
    definidos.length === 0
      ? ''
      : `<definedNames>${definidos
          .map(
            (d) => `<definedName name="${escaparXml(d.nombre)}">${escaparXml(d.formula)}</definedName>`
          )
          .join('')}</definedNames>`

  // Los estilos van en el rId siguiente al de la última hoja.
  const ridEstilos = `rId${hojas.length + 1}`
  const relacionesHojas = hojas
    .map(
      (_, i) =>
        `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`
    )
    .join('')

  const archivos: { nombre: string; texto: string }[] = [
    {
      nombre: '[Content_Types].xml',
      texto: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${contentTypes}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
    },
    {
      nombre: '_rels/.rels',
      texto: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    },
    {
      nombre: 'xl/workbook.xml',
      texto: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${listaHojas}</sheets>${nombresDefinidos}</workbook>`,
    },
    {
      nombre: 'xl/_rels/workbook.xml.rels',
      texto: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relacionesHojas}<Relationship Id="${ridEstilos}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    },
    {
      // Dos estilos: 0 normal y 1 negrita, para el encabezado.
      nombre: 'xl/styles.xml',
      texto: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="1"><fill><patternFill patternType="none"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`,
    },
    ...hojas.map((h, i) => ({
      nombre: `xl/worksheets/sheet${i + 1}.xml`,
      texto: hojaXml(h.filas, h.validaciones),
    })),
  ]

  const zip = armarZip(
    archivos.map((a) => ({ nombre: a.nombre, datos: codificador.encode(a.texto) }))
  )
  return new Blob([zip.buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}

/** Una columna de la plantilla que se llena eligiendo de una lista. */
export type ListaPlantilla = {
  /** Índice de la columna (base 0) de la hoja de datos. */
  columna: number
  /** Encabezado que lleva la lista en la hoja «Listas». */
  titulo: string
  valores: string[]
  /**
   * Si la celda admite varios valores separados por coma. En ese caso el
   * desplegable se ofrece pero no se obliga.
   */
  varios?: boolean
}

/**
 * Plantilla de importación con listas desplegables ya configuradas.
 *
 * «La plantilla debe contener validación de datos (listas desplegables)
 *  preconfiguradas para categorías, tareas e implementos.»
 *
 * Sale un libro de dos hojas: la de datos, con sólo el encabezado, y una
 * hoja «Listas» con los valores válidos —visible a propósito, para que se
 * pueda consultar y copiar de ahí— a la que apuntan las validaciones.
 */
export function construirXlsxPlantilla(
  nombreHoja: string,
  encabezados: string[],
  listas: ListaPlantilla[],
  /** Hasta qué fila de la hoja de datos alcanza el desplegable. */
  filasValidas = 500
): Blob {
  const utiles = listas.filter((l) => l.valores.length > 0)

  // La hoja «Listas» es una columna por lista. Se rellena en forma de
  // matriz porque el escritor recorre filas, no columnas.
  const alto = utiles.reduce((m, l) => Math.max(m, l.valores.length), 0)
  const filasListas: CeldaHoja[][] = [utiles.map((l) => l.titulo)]
  for (let f = 0; f < alto; f++) {
    filasListas.push(utiles.map((l) => l.valores[f] ?? ''))
  }

  const definidos = utiles.map((l, i) => {
    const col = letraColumna(i)
    return {
      nombre: `lista_${i + 1}`,
      // Desde la fila 2 —la 1 es el encabezado— hasta el último valor
      // de ESTA lista, no del alto total: si el rango se pasara, el
      // desplegable saldría con renglones vacíos al final.
      formula: `Listas!$${col}$2:$${col}$${l.valores.length + 1}`,
    }
  })

  const validaciones: Validacion[] = utiles.map((l, i) => {
    const col = letraColumna(l.columna)
    return {
      sqref: `${col}2:${col}${filasValidas + 1}`,
      nombreLista: definidos[i].nombre,
      bloquear: !l.varios,
    }
  })

  const hojas: HojaLibro[] = [
    { nombre: nombreHoja, filas: [encabezados], validaciones },
  ]
  if (utiles.length > 0) hojas.push({ nombre: 'Listas', filas: filasListas })

  return construirLibro(hojas, definidos)
}

/**
 * Arma un .xlsx de una sola hoja. Devuelve un Blob listo para descargar.
 * Sin dependencias: es un ZIP sin comprimir con los cinco XML mínimos que
 * Excel exige.
 */
export function construirXlsx(nombreHoja: string, filas: CeldaHoja[][]): Blob {
  return construirLibro([{ nombre: nombreHoja, filas }])
}

/** Dispara la descarga de un Blob con el nombre dado. */
export function descargar(blob: Blob, nombreArchivo: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = nombreArchivo
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Se libera después del clic; hacerlo de inmediato cancela la descarga
  // en algunos navegadores.
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}

/** CSV con BOM: sin el BOM, Excel en Windows rompe los acentos. */
export function construirCsv(filas: CeldaHoja[][]) {
  const texto = filas
    .map((fila) =>
      fila
        .map((v) => {
          const s = v === null || v === undefined ? '' : String(v)
          return /[",;\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
        })
        .join(';')
    )
    .join('\r\n')
  return new Blob(['\ufeff' + texto], { type: 'text/csv;charset=utf-8;' })
}

/* ------------------------------------------------------------------ */
/* LECTURA                                                            */
/* ------------------------------------------------------------------ */

type ArchivoZip = { nombre: string; datos: Uint8Array }

async function inflar(datos: Uint8Array): Promise<Uint8Array> {
  // deflate-raw es el método 8 del ZIP. Lo trae el navegador desde 2023;
  // si faltara, el error se convierte en un mensaje entendible más arriba.
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('Este navegador no puede descomprimir el archivo. Guarda la hoja como CSV.')
  }
  // OJO: `datos` casi siempre es una vista (subarray) sobre el buffer del
  // archivo completo, así que `datos.buffer` apuntaría a TODO el .xlsx y no
  // al miembro que toca descomprimir. `new Uint8Array(vista)` copia sólo el
  // tramo y devuelve un buffer del tamaño exacto.
  const exacto = new Uint8Array(datos)
  const flujo = new Blob([exacto.buffer])
    .stream()
    .pipeThrough(new DecompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(flujo).arrayBuffer())
}

/** Abre el ZIP leyendo el directorio central (no las cabeceras locales). */
async function abrirZip(buffer: ArrayBuffer): Promise<ArchivoZip[]> {
  const bytes = new Uint8Array(buffer)
  const vista = new DataView(buffer)

  // El "end of central directory" está al final, pero puede llevar un
  // comentario detrás, así que se busca la firma hacia atrás.
  let fin = -1
  for (let i = bytes.length - 22; i >= 0 && i > bytes.length - 65558; i--) {
    if (vista.getUint32(i, true) === 0x06054b50) {
      fin = i
      break
    }
  }
  if (fin < 0) throw new Error('El archivo no parece ser un .xlsx válido.')

  const cantidad = vista.getUint16(fin + 10, true)
  let p = vista.getUint32(fin + 16, true)
  const archivos: ArchivoZip[] = []
  const decodificador = new TextDecoder()

  for (let i = 0; i < cantidad; i++) {
    if (vista.getUint32(p, true) !== 0x02014b50) break
    const metodo = vista.getUint16(p + 10, true)
    const tamanoComprimido = vista.getUint32(p + 20, true)
    const largoNombre = vista.getUint16(p + 28, true)
    const largoExtra = vista.getUint16(p + 30, true)
    const largoComentario = vista.getUint16(p + 32, true)
    const inicioLocal = vista.getUint32(p + 42, true)
    const nombre = decodificador.decode(bytes.subarray(p + 46, p + 46 + largoNombre))

    // Los datos empiezan después de la cabecera local, cuyos campos
    // variables pueden diferir de los del directorio central.
    const largoNombreLocal = vista.getUint16(inicioLocal + 26, true)
    const largoExtraLocal = vista.getUint16(inicioLocal + 28, true)
    const inicioDatos = inicioLocal + 30 + largoNombreLocal + largoExtraLocal
    const crudo = bytes.subarray(inicioDatos, inicioDatos + tamanoComprimido)

    // Sólo se descomprimen las partes que interesan: descomprimir las
    // imágenes o los temas de un libro grande sería tiempo perdido.
    const interesa =
      nombre === 'xl/sharedStrings.xml' ||
      nombre === 'xl/workbook.xml' ||
      nombre.startsWith('xl/worksheets/sheet')
    if (interesa) {
      const datos = metodo === 0 ? crudo.slice() : await inflar(crudo)
      archivos.push({ nombre, datos })
    }

    p += 46 + largoNombre + largoExtra + largoComentario
  }
  return archivos
}

function parsearXml(datos: Uint8Array) {
  const texto = new TextDecoder().decode(datos)
  const doc = new DOMParser().parseFromString(texto, 'application/xml')
  if (doc.getElementsByTagName('parsererror').length > 0) {
    throw new Error('El contenido del archivo está dañado.')
  }
  return doc
}

/**
 * Lee la primera hoja de un .xlsx y devuelve una matriz de texto.
 * Todo se devuelve como string: quien llama decide qué convertir a número,
 * porque el destino real es una columna de Postgres con su propio tipo.
 */
export async function leerXlsx(archivo: File): Promise<string[][]> {
  const archivos = await abrirZip(await archivo.arrayBuffer())

  const hojas = archivos
    .filter((a) => /^xl\/worksheets\/sheet\d+\.xml$/.test(a.nombre))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, undefined, { numeric: true }))
  if (hojas.length === 0) throw new Error('El archivo no tiene ninguna hoja de cálculo.')

  // Cadenas compartidas: Excel guarda los textos repetidos una sola vez y
  // en la celda deja el índice (t="s").
  const compartidas: string[] = []
  const partesCompartidas = archivos.find((a) => a.nombre === 'xl/sharedStrings.xml')
  if (partesCompartidas) {
    const doc = parsearXml(partesCompartidas.datos)
    const items = doc.getElementsByTagName('si')
    for (let i = 0; i < items.length; i++) {
      // Un <si> puede venir partido en varios <t> (texto con formatos).
      const ts = items[i].getElementsByTagName('t')
      let texto = ''
      for (let j = 0; j < ts.length; j++) texto += ts[j].textContent ?? ''
      compartidas.push(texto)
    }
  }

  const doc = parsearXml(hojas[0].datos)
  const filasXml = doc.getElementsByTagName('row')
  const filas: string[][] = []

  for (let i = 0; i < filasXml.length; i++) {
    const celdasXml = filasXml[i].getElementsByTagName('c')
    const fila: string[] = []
    for (let j = 0; j < celdasXml.length; j++) {
      const celda = celdasXml[j]
      const ref = celda.getAttribute('r') ?? ''
      const letra = ref.replace(/[0-9]/g, '')
      const columna = letra ? indiceColumna(letra) : j
      const tipo = celda.getAttribute('t')

      let valor = ''
      if (tipo === 's') {
        const v = celda.getElementsByTagName('v')[0]?.textContent ?? ''
        valor = compartidas[Number(v)] ?? ''
      } else if (tipo === 'inlineStr') {
        const ts = celda.getElementsByTagName('t')
        for (let k = 0; k < ts.length; k++) valor += ts[k].textContent ?? ''
      } else {
        valor = celda.getElementsByTagName('v')[0]?.textContent ?? ''
      }

      while (fila.length < columna) fila.push('')
      fila[columna] = valor.trim()
    }
    filas.push(fila)
  }

  return filas
}

/** Separa texto pegado desde Excel (tabulaciones) o un CSV (; o ,). */
export function partirTextoTabular(texto: string): string[][] {
  const lineas = texto.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
  const utiles = lineas.filter((l) => l.trim() !== '')
  if (utiles.length === 0) return []

  // El separador se deduce de la primera línea: gana el que más aparezca.
  const muestra = utiles[0]
  const candidatos: [string, number][] = [
    ['\t', (muestra.match(/\t/g) ?? []).length],
    [';', (muestra.match(/;/g) ?? []).length],
    [',', (muestra.match(/,/g) ?? []).length],
  ]
  candidatos.sort((a, b) => b[1] - a[1])
  const separador = candidatos[0][1] > 0 ? candidatos[0][0] : '\t'

  return utiles.map((linea) =>
    linea.split(separador).map((c) => c.trim().replace(/^"(.*)"$/, '$1'))
  )
}

/** Lee un archivo subido, sea .xlsx, .csv o .txt. */
export async function leerArchivoTabular(archivo: File): Promise<string[][]> {
  const nombre = archivo.name.toLowerCase()
  if (nombre.endsWith('.xlsx')) return leerXlsx(archivo)
  if (nombre.endsWith('.xls')) {
    throw new Error(
      'El formato .xls antiguo no se puede leer. Ábrelo en Excel y guárdalo como .xlsx o .csv.'
    )
  }
  return partirTextoTabular(await archivo.text())
}
