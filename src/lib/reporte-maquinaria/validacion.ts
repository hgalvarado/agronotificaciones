/**
 * Validación. Funciones puras: entra texto de fuera, sale un valor con
 * forma conocida o un error. No toca la red, ni la base, ni React.
 *
 * Está separada porque lo que llega a un visor público llega de la barra
 * de direcciones, y la barra de direcciones la escribe cualquiera.
 */

import { PROCESOS_TICKET, type FiltrosReporte, type ProcesoTicket } from './tipos'

const ES_FECHA = /^\d{4}-\d{2}-\d{2}$/
const ES_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Hoy en formato ISO, sin arrastrar la hora ni la zona. */
export function hoyIso(): string {
  return new Date().toISOString().slice(0, 10)
}

function texto(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const limpio = v.trim()
  return limpio === '' ? null : limpio
}

function uuid(v: unknown): string | null {
  const t = texto(v)
  return t && ES_UUID.test(t) ? t : null
}

/**
 * Normaliza lo que venga en la dirección. Nunca falla: un valor inválido
 * se descarta y se cae al valor por defecto, que en un reporte público es
 * mejor que una pantalla de error.
 */
export function validarFiltros(entrada: Record<string, unknown>): FiltrosReporte {
  const fecha = texto(entrada.fecha)
  return {
    fecha: fecha && ES_FECHA.test(fecha) ? fecha : hoyIso(),
    departamento: texto(entrada.departamento),
    usuarioId: uuid(entrada.usuario),
    ticketId: uuid(entrada.ticket),
  }
}

/** Lo que el Administrador manda desde el panel, antes de guardarse. */
export type EntradaConfiguracion = {
  activo: boolean
  procesos: string[]
  todosDepartamentos: boolean
  departamentos: string[]
}

export type ResultadoValidacion =
  | { ok: true; valor: Omit<EntradaConfiguracion, 'procesos'> & { procesos: ProcesoTicket[] } }
  | { ok: false; error: string }

const ORDEN_PROCESO = new Map<string, number>(PROCESOS_TICKET.map((p, i) => [p.valor, i]))

/**
 * Deja la lista de procesos en limpio: sin repetidos, sin inventados y
 * en el orden en que ocurren, para que la pantalla los vuelva a leer
 * siempre igual.
 */
export function normalizarProcesos(procesos: string[]): ProcesoTicket[] {
  return [...new Set(procesos)]
    .filter((p): p is ProcesoTicket => ORDEN_PROCESO.has(p))
    .sort((a, b) => (ORDEN_PROCESO.get(a) ?? 0) - (ORDEN_PROCESO.get(b) ?? 0))
}

/**
 * Valida la configuración del Administrador.
 *
 * Las dos reglas que de verdad importan: publicar el reporte sin ningún
 * proceso marcado, o sin ningún departamento, deja una página en blanco
 * y parece un fallo del sistema. Se rechaza aquí y no en la base, que no
 * sabe explicar por qué.
 */
export function validarConfiguracion(entrada: EntradaConfiguracion): ResultadoValidacion {
  const procesos = normalizarProcesos(entrada.procesos)

  if (entrada.activo && procesos.length === 0) {
    return {
      ok: false,
      error:
        'Marca al menos un proceso. Publicar el reporte sin ninguno no enseña ni un ticket.',
    }
  }

  const departamentos = [...new Set(entrada.departamentos.map((d) => d.trim()).filter(Boolean))]

  if (entrada.activo && !entrada.todosDepartamentos && departamentos.length === 0) {
    return {
      ok: false,
      error:
        'Elige al menos un departamento visible, o marca «todos». Publicar el reporte sin departamentos lo deja en blanco.',
    }
  }

  return {
    ok: true,
    valor: {
      activo: entrada.activo,
      procesos,
      todosDepartamentos: entrada.todosDepartamentos,
      departamentos,
    },
  }
}
