/**
 * Las dos hojas que SAP espera. Funciones puras: entran las filas que ya
 * está viendo el usuario, sale una matriz de celdas.
 *
 * Vive aparte de las pantallas porque el formato lo manda SAP, no la
 * cuadrícula: el orden de las columnas, el que se exporte el código y no
 * la descripción, y el que cada labor se parta en dos filas son reglas de
 * la notificación, no de cómo se ve la tabla. Si mañana SAP pide otra
 * columna, se cambia aquí y no en un componente de 700 líneas.
 *
 * No sabe descargar nada: de eso se encarga `lib/hojas`.
 */

import type { CeldaHoja } from '@/lib/hojas'

/* ------------------------------------------------------------------ */
/* Utilidades de formato                                               */
/* ------------------------------------------------------------------ */

/**
 * El CÓDIGO y nada más.
 *
 * Las pantallas enseñan «1002-110 · La Ceiba» o «T103 — Preparación»
 * porque a una persona le sirve el nombre. A SAP no: si le llega el
 * nombre pegado, rechaza la línea. Se corta por el primer separador que
 * aparezca —punto medio, guión largo o barra— y se respeta el guión
 * corto, que sí forma parte de los códigos de lote.
 */
export function soloCodigo(valor: string | null | undefined): string {
  if (!valor) return ''
  return valor.split(/\s*[·|—–/]\s*/)[0].trim()
}

/** La operación SAP como en su Excel: cuatro dígitos con ceros delante. */
export function operacion(n: number | null | undefined): string {
  if (n === null || n === undefined) return ''
  return String(n).padStart(4, '0')
}

/** «OP-01 Juan Pérez». Sin código, sólo el nombre; sin nombre, nada. */
export function operadorCompleto(
  codigo: string | null | undefined,
  nombre: string | null | undefined
): string {
  return [codigo, nombre].filter(Boolean).join(' ').trim()
}

function num(v: number | null | undefined): number | null {
  return v === null || v === undefined ? null : Number(v)
}

/* ------------------------------------------------------------------ */
/* Labores                                                             */
/* ------------------------------------------------------------------ */

/** Lo que la exportación necesita de una línea de labor. */
export type LineaLaborSap = {
  fecha: string
  ticket_codigo: string
  ut: string
  tarea_codigo: string
  labor_nombre: string
  ciclo: number
  /**
   * Las horas de ESTE lote, ya prorrateadas (`horas_linea` de la vista).
   * Las dos alternativas son respaldo para cuando la migración 35 aún no
   * está corrida; ninguna es la correcta y por eso van después.
   */
  horas_linea?: number | null
  horas_costeadas?: number | null
  horas_maquina: number
  /** El equipo del horómetro. Es el que va en las DOS filas. */
  equipo_codigo: string
  operacion_equipo: number | null
  operacion_implemento: number | null
}

/** Las horas que se notifican por esta línea, con sus respaldos. */
function horasDeLinea(l: LineaLaborSap): number {
  if (l.horas_linea !== null && l.horas_linea !== undefined) return Number(l.horas_linea)
  if (l.horas_costeadas !== null && l.horas_costeadas !== undefined) return Number(l.horas_costeadas)
  return Number(l.horas_maquina)
}

export const COLUMNAS_LABORES_SAP = [
  'Fecha',
  'Ticket',
  'Ubicación Técnica',
  'Tarea',
  'Operación',
  'Equipo',
  'Horas Notificadas',
  'Labor',
  'Ciclo',
] as const

/**
 * Dos filas por línea de lote: la operación del tractor y la del
 * implemento.
 *
 *     1001-010; T101; 0050; T6603-A98; 3.6
 *     1001-010; T101; 0300; T6603-A98; 3.6
 *     1001-020; T101; 0050; T6603-A98; 2.4
 *     1001-020; T101; 0300; T6603-A98; 2.4
 *
 * Dos cosas que parecen detalles y no lo son:
 *
 *   · El EQUIPO es el mismo en las dos filas, y siempre es el del
 *     horómetro. Lo que distingue una notificación de la otra es la
 *     OPERACIÓN —0050 el tractor, 0300 el implemento—, no la máquina.
 *     Poner ahí el código del implemento hacía que SAP buscara un equipo
 *     que en su maestro no existe y rechazara la línea.
 *
 *   · Las dos llevan las MISMAS horas, las del lote. Son dos puestos de
 *     trabajo ocupados el mismo tiempo, no una hora partida en dos.
 *
 * La fila del implemento se omite cuando la línea no llevaba ninguno:
 * una operación en blanco crea en SAP una notificación huérfana.
 */
export function filasLaboresSap(lineas: LineaLaborSap[]): CeldaHoja[][] {
  const filas: CeldaHoja[][] = [[...COLUMNAS_LABORES_SAP]]

  for (const l of lineas) {
    const antes = [l.fecha, l.ticket_codigo, soloCodigo(l.ut), soloCodigo(l.tarea_codigo)]
    const despues = [l.equipo_codigo, horasDeLinea(l), l.labor_nombre, l.ciclo]

    filas.push([...antes, operacion(l.operacion_equipo), ...despues])

    if (l.operacion_implemento !== null && l.operacion_implemento !== undefined) {
      filas.push([...antes, operacion(l.operacion_implemento), ...despues])
    }
  }

  return filas
}

/* ------------------------------------------------------------------ */
/* Horómetros                                                          */
/* ------------------------------------------------------------------ */

export type LineaHorometroSap = {
  fecha: string
  equipo_codigo: string
  horometro_inicial: number
  horometro_final: number
  turno: string
  ticket_codigo: string
  departamento: string | null
  operador_codigo: string | null
  operador_nombre: string | null
}

export const COLUMNAS_HOROMETROS_SAP = [
  'Fecha',
  'Equipo',
  'Horómetro Inicial',
  'Horómetro Final',
  'Turno',
  'Ticket',
  'Departamento',
  'Operador',
] as const

export function filasHorometrosSap(lineas: LineaHorometroSap[]): CeldaHoja[][] {
  return [
    [...COLUMNAS_HOROMETROS_SAP],
    ...lineas.map((h) => [
      h.fecha,
      h.equipo_codigo,
      num(h.horometro_inicial),
      num(h.horometro_final),
      h.turno,
      h.ticket_codigo,
      h.departamento ?? '',
      operadorCompleto(h.operador_codigo, h.operador_nombre),
    ]),
  ]
}
