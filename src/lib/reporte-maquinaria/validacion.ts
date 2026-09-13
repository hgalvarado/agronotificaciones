/**
 * Validación. Funciones puras: entra texto de fuera, sale un valor con
 * forma conocida o un error. No toca la red, ni la base, ni React.
 *
 * Está separada porque lo que llega a un visor público llega de la barra
 * de direcciones, y la barra de direcciones la escribe cualquiera.
 */

import { NIVELES_PROCESO, type FiltrosReporte, type NivelProceso } from './tipos'

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
  nivelProceso: string
  todosDepartamentos: boolean
  departamentos: string[]
}

export type ResultadoValidacion =
  | { ok: true; valor: Omit<EntradaConfiguracion, 'nivelProceso'> & { nivelProceso: NivelProceso } }
  | { ok: false; error: string }

const NIVELES_VALIDOS = new Set<string>(NIVELES_PROCESO.map((n) => n.valor))

/**
 * Valida la configuración del Administrador.
 *
 * La regla que de verdad importa: publicar el reporte sin elegir ningún
 * departamento dejaría una página en blanco y parecería un fallo. Se
 * rechaza aquí y no en la base, que no sabe explicar por qué.
 */
export function validarConfiguracion(entrada: EntradaConfiguracion): ResultadoValidacion {
  if (!NIVELES_VALIDOS.has(entrada.nivelProceso)) {
    return { ok: false, error: 'El nivel de proceso elegido no existe.' }
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
      nivelProceso: entrada.nivelProceso as NivelProceso,
      todosDepartamentos: entrada.todosDepartamentos,
      departamentos,
    },
  }
}
