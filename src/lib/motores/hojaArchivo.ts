/**
 * Exporta el historial de los motores a ARCHIVO (sin abrir la impresora): un PDF A4 horizontal con las columnas de la hoja
 * FTR_F-MA-103 (compacto, con encabezado repetido en cada página) y un Excel con una hoja por motor. Usa el escritor de PDF y de
 * Excel del proyecto (sin librerías). Puro salvo `descargarHoja`, que usa el DOM.
 */

import { ALTO_A4, ANCHO_A4, Pagina, anchoTexto, construirPdf } from '@/lib/pdf/documento'
import { construirXlsxHojas, descargar, type CeldaHoja } from '@/lib/hojas'
import { ddmmaa, numHoja, totalesHoja, type FilaHoja } from './hoja'

export type SeccionArchivo = { motor: string; estacion: string | null; zona: string | null; tanque: string | null; filas: FilaHoja[] }
export type ArgsArchivo = { secciones: SeccionArchivo[]; desde?: string; hasta?: string; generadoPor: string; generadoEn: string }

const ENCABEZADOS = ['Fecha', 'Horóm. inicial', 'Horóm. final', 'Horas', 'Horas est.', 'Gal. iniciales', 'Gal. finales', 'Gal. gastados', 'Rend. gal/h', 'Rev. motor', 'Suministro comb.', 'Firma (entregó)', 'Caudal inicial', 'Caudal final']
const PESOS = [46, 56, 56, 38, 40, 46, 46, 48, 44, 38, 54, 150, 46, 46]
const COL_FIRMA = 11

function periodo(a: ArgsArchivo): string {
  return a.desde || a.hasta ? `${a.desde ? ddmmaa(a.desde) : 'inicio'} al ${a.hasta ? ddmmaa(a.hasta) : 'hoy'}` : 'todo el historial disponible'
}

const cortar = (t: string, ancho: number, tam: number): string => {
  if (anchoTexto(t, tam) <= ancho) return t
  let x = t
  while (x.length > 1 && anchoTexto(`${x}…`, tam) > ancho) x = x.slice(0, -1)
  return `${x}…`
}

function celdasFila(f: FilaHoja): string[] {
  if (f.soloSuministro) return [ddmmaa(f.fecha), '', '', '', '', '', '', '', '', '', numHoja(f.suministro), f.operador ?? '', '', '']
  return [
    ddmmaa(f.fecha), numHoja(f.horoIni), numHoja(f.horoFin), numHoja(f.horas), f.horasEst ? numHoja(f.horasEst) : '', numHoja(f.visorIni), numHoja(f.visorFin), numHoja(f.gastado),
    numHoja(f.rendimiento, 2), numHoja(f.rpm, 0), f.suministro > 0 ? numHoja(f.suministro) : '', f.operador ?? '',
    f.caudalIni === null ? '' : numHoja(f.caudalIni), f.caudalFin === null ? '' : numHoja(f.caudalFin),
  ]
}

/** PDF A4 horizontal, una sección por motor, encabezado de la tabla repetido en cada página. */
export function pdfHoja(a: ArgsArchivo): Blob {
  const M = 20
  const ancho = ANCHO_A4 - M * 2
  const suma = PESOS.reduce((x, y) => x + y, 0)
  const cols = PESOS.map((p) => (p * ancho) / suma)
  const x0: number[] = []
  cols.reduce((acc, w) => {
    x0.push(acc)
    return acc + w
  }, M)
  const ALTO_FILA = 12.5
  const TAM = 7.5
  const paginas: Pagina[] = []
  const nueva = () => {
    const pg = new Pagina(true)
    paginas.push(pg)
    pg.texto(M, ALTO_A4 - 18, `Generado por ${a.generadoPor} · ${a.generadoEn} (hora de Honduras, UTC-6)`, { tamano: 7, gris: 0.35 })
    return pg
  }

  const encabezado = (pg: Pagina, y: number): number => {
    pg.rectangulo(M, y, ancho, 22, { relleno: 0.9, gris: 0.5 })
    ENCABEZADOS.forEach((h, i) => {
      const corte = h.indexOf(' ')
      const partes = h.length > 9 && corte > 0 ? [h.slice(0, corte), h.slice(corte + 1)] : [h]
      partes.forEach((t, k) => pg.texto(x0[i] + cols[i] / 2, y + (partes.length === 1 ? 7 : 3 + k * 9), t, { tamano: 6.5, negrita: true, alineacion: 'centro' }))
    })
    return y + 22
  }

  const secciones = a.secciones.length ? a.secciones : [{ motor: '', estacion: null, zona: null, tanque: null, filas: [] as FilaHoja[] }]
  for (const s of secciones) {
    let pg = nueva()
    pg.texto(M, 18, 'Agropecuaria Montelibano S.A. de C.V.', { tamano: 10, negrita: true })
    pg.texto(M, 31, 'FTR_F-MA-103 · Control de consumo de horas y combustible de bombas de riego', { tamano: 8 })
    pg.texto(M, 44, `Bomba: ${s.motor}    Estación: ${s.estacion || '—'}    Zona: ${s.zona || '—'}    Tanque: ${s.tanque || '—'}    Periodo: ${periodo(a)}`, { tamano: 8, negrita: true })
    let y = encabezado(pg, 54)
    const limite = ALTO_A4 - 30
    for (const f of s.filas) {
      if (y + ALTO_FILA > limite) {
        pg = nueva()
        y = encabezado(pg, 24)
      }
      celdasFila(f).forEach((t, i) => {
        const txt = cortar(t, cols[i] - 4, TAM)
        if (!txt) return
        if (i === COL_FIRMA) pg.texto(x0[i] + 2, y + 2.5, txt, { tamano: TAM })
        else pg.texto(x0[i] + cols[i] - 2, y + 2.5, txt, { tamano: TAM, alineacion: 'derecha' })
      })
      pg.linea({ x: M, y: y + ALTO_FILA }, { x: M + ancho, y: y + ALTO_FILA }, 0.8, 0.4)
      y += ALTO_FILA
    }
    if (s.filas.length === 0) pg.texto(M, y + 10, 'Sin registros en el periodo.', { tamano: 8 })
    const t = totalesHoja(s.filas)
    if (y + ALTO_FILA * 2 > limite) {
      pg = nueva()
      y = 24
    }
    pg.rectangulo(M, y, ancho, ALTO_FILA + 1, { relleno: 0.95, gris: 0.5 })
    const izq: [number, string][] = [[0, 'Totales'], [1, `${t.dias} día(s)`]]
    const der: [number, string][] = [[3, numHoja(t.horas)], [4, t.horasEst ? numHoja(t.horasEst) : ''], [7, numHoja(t.gastado)], [8, numHoja(t.rendimiento, 2)], [10, numHoja(t.suministro)]]
    izq.forEach(([i, txt]) => pg.texto(x0[i] + 2, y + 3, txt, { tamano: TAM, negrita: true }))
    der.forEach(([i, txt]) => txt && pg.texto(x0[i] + cols[i] - 2, y + 3, txt, { tamano: TAM, negrita: true, alineacion: 'derecha' }))
    pg.texto(x0[COL_FIRMA] + 2, y + 3.5, `Horas proyectadas (horómetro + estimadas): ${numHoja(t.horasProy)} h`, { tamano: 6.5 })
  }
  return construirPdf(paginas, 'Control de consumo de horas y combustible')
}

const nombreHojaExcel = (t: string, usados: Set<string>): string => {
  const base = (t.replace(/[\\/?*[\]:]/g, ' ').trim() || 'Motor').slice(0, 28)
  let n = base
  for (let i = 2; usados.has(n.toLowerCase()); i++) n = `${base.slice(0, 26)} ${i}`
  usados.add(n.toLowerCase())
  return n
}

/** Excel: una hoja por motor con encabezado, las columnas de la hoja de campo (números como números) y los totales. */
export function excelHoja(a: ArgsArchivo): Blob {
  const usados = new Set<string>()
  const secciones = a.secciones.length ? a.secciones : [{ motor: 'Motor', estacion: null, zona: null, tanque: null, filas: [] as FilaHoja[] }]
  const n = (v: number | null | undefined): CeldaHoja => (v === null || v === undefined ? '' : v)
  const hojas = secciones.map((s) => {
    const t = totalesHoja(s.filas)
    const filas: CeldaHoja[][] = [
      ['Agropecuaria Montelibano S.A. de C.V.'],
      ['FTR_F-MA-103 · Control de consumo de horas y combustible de bombas de riego'],
      [`Bomba: ${s.motor}`, `Estación: ${s.estacion || '—'}`, `Zona: ${s.zona || '—'}`, `Tanque: ${s.tanque || '—'}`, `Periodo: ${periodo(a)}`],
      [],
      ENCABEZADOS,
      ...s.filas.map((f): CeldaHoja[] =>
        f.soloSuministro
          ? [f.fecha, '', '', '', '', '', '', '', '', '', f.suministro, f.operador ?? '', '', '']
          : [f.fecha, f.horoIni, f.horoFin, f.horas, n(f.horasEst), f.visorIni, f.visorFin, f.gastado, n(f.rendimiento), n(f.rpm), f.suministro > 0 ? f.suministro : '', f.operador ?? '', n(f.caudalIni), n(f.caudalFin)]
      ),
      ['Totales', `${t.dias} día(s)`, '', t.horas, t.horasEst || '', '', '', t.gastado, n(t.rendimiento), '', t.suministro],
      ['Horas proyectadas (horómetro + estimadas)', '', '', t.horasProy],
      [],
      [`Generado por ${a.generadoPor} · ${a.generadoEn} (hora de Honduras, UTC-6)`],
    ]
    return { nombre: nombreHojaExcel(s.motor, usados), filas }
  })
  return construirXlsxHojas(hojas)
}

/** Baja el archivo (PDF o Excel) directo, sin abrir la impresora. Solo cliente. */
export function descargarHoja(formato: 'pdf' | 'excel', a: ArgsArchivo, nombreBase: string): void {
  const limpio = nombreBase.replace(/[^\p{L}\p{N}_-]+/gu, '_').replace(/^_+|_+$/g, '') || 'Motores'
  const dia = new Date(Date.now() - 6 * 3600_000).toISOString().slice(0, 10)
  if (formato === 'pdf') descargar(pdfHoja(a), `${limpio}_${dia}.pdf`)
  else descargar(excelHoja(a), `${limpio}_${dia}.xlsx`)
}
