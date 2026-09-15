/**
 * Lectura de la hoja de turnos de riego. Puro: entra texto de celdas,
 * sale una línea con forma conocida o un error en castellano.
 *
 * El Excel de campo viene PLANO —una fila por lote, con la cabecera
 * repetida— porque así se lee y así se llena. Aquí se interpreta fila a
 * fila y `agrupar` vuelve a montar la cabecera con sus lotes: un turno es
 * todo lo que comparte temporada, ciclo, fecha, zona y turno, que es
 * exactamente lo que la base considera el mismo turno.
 */

import { aFecha, aNumero, normalizar, resolver, type ColumnaHoja } from '@/lib/importacion'
import { CICLOS_RIEGO, FUENTES_AGUA, type FuenteAgua } from './tipos'

export const COLUMNAS_RIEGO: ColumnaHoja[] = [
  { clave: 'temporada', alias: ['Temporada'] },
  { clave: 'ciclo', alias: ['Ciclo'] },
  { clave: 'fecha_siembra', alias: ['Fecha Siembra', 'Feccha Siembra', 'Fecha de siembra'] },
  { clave: 'ut', alias: ['Ubicacion Tecnica', 'Ubicación Técnica', 'UT', 'Lote'] },
  { clave: 'nomenclatura', alias: ['Nomenclatura'] },
  { clave: 'zona', alias: ['Zona'] },
  { clave: 'turno', alias: ['Turno'] },
  { clave: 'area_turno', alias: ['Area Turno', 'Área Turno', 'Area'] },
  { clave: 'variedad', alias: ['Variedad'] },
  { clave: 'plan_nutricional', alias: ['Plan Nutricional', 'Plan'] },
  { clave: 'responsable', alias: ['Responsible', 'Responsable'] },
  { clave: 'estacion_riego', alias: ['Estacion Riego', 'Estación Riego', 'Estacion'] },
  { clave: 'fuente_agua', alias: ['Fuente Agua', 'Fuente de agua'] },
  { clave: 'orden_sap', alias: ['Orden SAP', 'Orden'] },
  { clave: 'estado', alias: ['Estado', 'Proceso'] },
]

/** Una fila de la hoja, ya entendida. */
export type LineaImportada = {
  temporada: string
  ciclo: number
  fechaSiembra: string
  ut: string
  zona: string
  turno: string
  areaTurno: number
  variedad: string
  planNutricional: string
  responsable: string
  estacionRiego: string
  fuenteAgua: FuenteAgua | null
  ordenSap: string
  estado: string
}

const FUENTE_POR_TEXTO = new Map<string, FuenteAgua>([
  ['rio', 'RIO'],
  ['pozo', 'POZO'],
  ['rioypozo', 'RIO_Y_POZO'],
  ['riopozo', 'RIO_Y_POZO'],
  ['rioypozos', 'RIO_Y_POZO'],
])

export function aFuenteAgua(bruto: string): FuenteAgua | null {
  const t = normalizar(bruto ?? '')
  if (!t) return null
  return FUENTE_POR_TEXTO.get(t) ?? (FUENTES_AGUA.find((f) => normalizar(f.valor) === t)?.valor ?? null)
}

/**
 * Interpreta una fila. Devuelve el error de la PRIMERA cosa que está mal,
 * en el orden en que se llena la hoja: así quien la corrige va de
 * izquierda a derecha en vez de dar saltos.
 */
export function interpretarFila(
  celdas: Record<string, string>
): { ok: true; valor: LineaImportada } | { ok: false; error: string } {
  const texto = (k: string) => (celdas[k] ?? '').trim()

  const fecha = aFecha(texto('fecha_siembra'))
  if (!fecha) return { ok: false, error: 'Fecha de siembra vacía o ilegible.' }

  const ciclo = aNumero(texto('ciclo')) ?? 1
  if (!CICLOS_RIEGO.includes(ciclo as 1 | 2 | 3)) {
    return { ok: false, error: 'El ciclo debe ser 1, 2 o 3.' }
  }

  if (!texto('ut')) return { ok: false, error: 'Falta la ubicación técnica (el lote).' }
  if (!texto('zona')) return { ok: false, error: 'Falta la zona.' }
  if (!texto('turno')) return { ok: false, error: 'Falta el turno.' }

  const area = aNumero(texto('area_turno'))
  if (area === null) return { ok: false, error: 'Área del turno vacía o ilegible.' }
  if (area <= 0) return { ok: false, error: 'El área del turno tiene que ser mayor que cero.' }

  return {
    ok: true,
    valor: {
      temporada: texto('temporada'),
      ciclo: ciclo as 1 | 2 | 3,
      fechaSiembra: fecha,
      // El código del lote viene a veces como «1001-040 · Guanacaste».
      ut: texto('ut').split(/\s*[·|—–]\s*/)[0].trim(),
      zona: texto('zona'),
      turno: texto('turno'),
      areaTurno: area,
      variedad: texto('variedad'),
      planNutricional: texto('plan_nutricional'),
      responsable: texto('responsable'),
      estacionRiego: texto('estacion_riego'),
      fuenteAgua: aFuenteAgua(texto('fuente_agua')),
      ordenSap: texto('orden_sap'),
      estado: texto('estado'),
    },
  }
}

/** Qué hace que dos renglones sean el MISMO turno. Igual que en la base. */
export function llaveDeTurno(l: LineaImportada): string {
  return [l.ciclo, l.fechaSiembra, normalizar(l.zona), normalizar(l.turno)].join('|')
}

export type TurnoAgrupado = { cabecera: LineaImportada; lotes: LineaImportada[] }

/**
 * Vuelve a montar cabecera y detalle desde la hoja plana.
 *
 * La cabecera es la del PRIMER renglón del grupo: si la hoja repite el
 * plan nutricional en cinco filas y una lo trae distinto por un error de
 * tecleo, mandan las cinco y no la rara. Se conserva el orden de
 * aparición para que la vista previa se lea como el archivo.
 */
export function agrupar(lineas: LineaImportada[]): TurnoAgrupado[] {
  const grupos = new Map<string, TurnoAgrupado>()

  for (const l of lineas) {
    const k = llaveDeTurno(l)
    const grupo = grupos.get(k)
    if (grupo) grupo.lotes.push(l)
    else grupos.set(k, { cabecera: l, lotes: [l] })
  }

  return [...grupos.values()]
}

export { resolver }
