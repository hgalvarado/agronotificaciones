/**
 * Lógica de negocio del reporte público.
 *
 * Orquesta: pide a validación que limpie lo que llegó, a persistencia que
 * traiga los datos y a notificaciones el texto de lo que no salió. Lo que
 * decide aquí —y sólo aquí— es qué significa lo que vino: si hay reporte,
 * quiénes son los notificadores y cuánto suma el día.
 *
 * No conoce React ni Supabase.
 */

import {
  leerConfiguracionPublica,
  leerDetalle,
  leerHorometros,
  leerOpcionesFiltro,
  type FilaOpcion,
} from './repositorio'
import { AVISOS, avisoDeError } from './notificaciones'
import type { FiltrosReporte, OpcionesFiltro, Reporte } from './tipos'

const SIN_OPCIONES: OpcionesFiltro = { departamentos: [], usuarios: [], tickets: [] }

function repartirOpciones(filas: FilaOpcion[]): OpcionesFiltro {
  const vacio: OpcionesFiltro = { departamentos: [], usuarios: [], tickets: [] }
  for (const f of filas) {
    const opcion = { valor: f.valor, etiqueta: f.etiqueta }
    if (f.tipo === 'departamento') vacio.departamentos.push(opcion)
    else if (f.tipo === 'usuario') vacio.usuarios.push(opcion)
    else if (f.tipo === 'ticket') vacio.tickets.push(opcion)
  }
  return vacio
}

/**
 * «Notificador: [Nombre de Usuario]».
 *
 * Un día lo puede capturar más de una persona, así que se listan todos
 * los que aparecen, sin repetir y en el orden en que salen.
 */
function notificadoresDe(nombres: (string | null)[]): string[] {
  return [...new Set(nombres.filter((n): n is string => Boolean(n)))]
}

function sumar(valores: (number | null)[]): number {
  return valores.reduce((a: number, v) => a + Number(v ?? 0), 0)
}

/**
 * Arma el reporte completo de un día.
 *
 * Si la configuración dice que no, se corta antes de pedir datos: no
 * tiene sentido consultar tres veces para tirar el resultado, y así el
 * visor apagado no toca la base.
 */
export async function obtenerReporte(filtros: FiltrosReporte): Promise<Reporte> {
  const config = await leerConfiguracionPublica()

  const base: Omit<Reporte, 'aviso'> = {
    configuracion: config.datos,
    filtros,
    opciones: SIN_OPCIONES,
    detalle: [],
    horometros: [],
    notificadores: [],
    totales: { horasMaquina: 0, avanceMz: 0, horasHombre: 0 },
  }

  if (config.error) return { ...base, aviso: avisoDeError(config.error) }
  if (!config.datos.activo) return { ...base, aviso: AVISOS.inactivo }
  if (config.datos.procesos.length === 0) return { ...base, aviso: AVISOS.sinProcesos }
  if (config.datos.estados.length === 0) return { ...base, aviso: AVISOS.sinEstados }
  if (!config.datos.todosDepartamentos && config.datos.departamentos.length === 0) {
    return { ...base, aviso: AVISOS.sinDepartamentos }
  }

  const [detalle, horometros, opciones] = await Promise.all([
    leerDetalle(filtros),
    leerHorometros(filtros),
    leerOpcionesFiltro(filtros.fecha),
  ])

  const errorDatos = detalle.error ?? horometros.error ?? opciones.error

  return {
    ...base,
    opciones: repartirOpciones(opciones.datos),
    detalle: detalle.datos,
    horometros: horometros.datos,
    notificadores: notificadoresDe(detalle.datos.map((d) => d.usuario_nombre)),
    totales: {
      // Las horas NO se suman del detalle: una misma pasada aparece una
      // vez por labor y se contaría dos o tres veces. Salen del resumen
      // de horómetros, que ya viene deduplicado. Las manzanas sí salen
      // del detalle: cada línea es un lote distinto de verdad.
      horasMaquina: sumar(horometros.datos.map((h) => h.horas_maquina)),
      avanceMz: sumar(detalle.datos.map((d) => d.avance_mz)),
      horasHombre: sumar(horometros.datos.map((h) => h.horas_hombre)),
    },
    aviso: errorDatos
      ? avisoDeError(errorDatos)
      : detalle.datos.length === 0
        ? AVISOS.sinDatos
        : null,
  }
}
