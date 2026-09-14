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
  /** Horas ya prorrateadas a ESTA línea de lote. */
  horas_maquina: number
  equipo_codigo: string
  operacion_equipo: number | null
  /** El fierro concreto (ROMSR-01); si no hay, el tipo SAP. */
  codigo_implemento?: string | null
  implemento_codigo?: string | null
  operacion_implemento: number | null
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
 * Dos filas por línea de labor: la del tractor y la del implemento.
 *
 * «Por cada registro de labor, el Excel debe generar dos filas
 *  independientes: una para notificar la operación del Tractor y otra
 *  para la del Implemento.»
 *
 * Las dos llevan las MISMAS horas, y eso es correcto: en SAP son dos
 * puestos de trabajo que estuvieron ocupados el mismo tiempo, no una hora
 * partida en dos. Sumar esta columna da el doble de la jornada, que es lo
 * que SAP espera de este layout.
 *
 * La fila del implemento se omite cuando la línea no llevaba ninguno:
 * mandar una operación en blanco crea en SAP una notificación huérfana.
 */
export function filasLaboresSap(lineas: LineaLaborSap[]): CeldaHoja[][] {
  const filas: CeldaHoja[][] = [[...COLUMNAS_LABORES_SAP]]

  for (const l of lineas) {
    const comunes = [l.fecha, l.ticket_codigo, soloCodigo(l.ut), soloCodigo(l.tarea_codigo)]
    const cola = [num(l.horas_maquina), l.labor_nombre, l.ciclo]

    filas.push([...comunes, operacion(l.operacion_equipo), l.equipo_codigo, ...cola])

    const implemento = l.codigo_implemento || l.implemento_codigo
    if (implemento) {
      filas.push([...comunes, operacion(l.operacion_implemento), implemento, ...cola])
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
