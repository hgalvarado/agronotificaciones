/**
 * Persistencia del reporte público.
 *
 * Es la ÚNICA capa que habla con Supabase para este módulo. Devuelve
 * datos crudos o un error; no decide nada, no formatea nada y no sabe qué
 * se hará con lo que trae. Cambiar de base de datos mañana se queda
 * dentro de este archivo.
 *
 * Todo pasa por las funciones `security definer` de la migración 23: son
 * las únicas que el visitante sin sesión puede ejecutar, y ya vienen con
 * las reglas del Administrador aplicadas dentro.
 */

import { createClient } from '@/lib/supabase/server'
import type {
  ConfiguracionPublica,
  FilaDetalle,
  FilaHorometro,
  FiltrosReporte,
  EstadoTicketPublico,
  ProcesoTicket,
} from './tipos'

export type Respuesta<T> = { datos: T; error: string | null }

type FilaConfig = {
  activo: boolean
  procesos: string[] | null
  estados: string[] | null
  todos_departamentos: boolean
  departamentos: string[] | null
  temporada_activa: string | null
}

const CONFIG_APAGADA: ConfiguracionPublica = {
  activo: false,
  procesos: [],
  estados: [],
  todosDepartamentos: false,
  departamentos: [],
  temporadaActiva: null,
}

export async function leerConfiguracionPublica(): Promise<Respuesta<ConfiguracionPublica>> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('fn_reporte_publico_config')

  if (error) return { datos: CONFIG_APAGADA, error: error.message }

  const fila = (data as FilaConfig[] | null)?.[0]
  if (!fila) return { datos: CONFIG_APAGADA, error: null }

  return {
    datos: {
      activo: fila.activo,
      procesos: (fila.procesos ?? []) as ProcesoTicket[],
      estados: (fila.estados ?? []) as EstadoTicketPublico[],
      todosDepartamentos: fila.todos_departamentos,
      departamentos: fila.departamentos ?? [],
      temporadaActiva: fila.temporada_activa,
    },
    error: null,
  }
}

/** Los argumentos que esperan las tres funciones del día. */
function argumentos(f: FiltrosReporte) {
  return {
    p_fecha: f.fecha,
    p_departamento: f.departamento,
    p_usuario_id: f.usuarioId,
    p_ticket_id: f.ticketId,
  }
}

export async function leerDetalle(filtros: FiltrosReporte): Promise<Respuesta<FilaDetalle[]>> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('fn_reporte_maquinaria_detalle', argumentos(filtros))
  return { datos: (data as FilaDetalle[] | null) ?? [], error: error?.message ?? null }
}

export async function leerHorometros(
  filtros: FiltrosReporte
): Promise<Respuesta<FilaHorometro[]>> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc(
    'fn_reporte_maquinaria_horometros',
    argumentos(filtros)
  )
  return { datos: (data as FilaHorometro[] | null) ?? [], error: error?.message ?? null }
}

export type FilaOpcion = { tipo: string; valor: string; etiqueta: string }

export async function leerOpcionesFiltro(fecha: string): Promise<Respuesta<FilaOpcion[]>> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('fn_reporte_maquinaria_filtros', { p_fecha: fecha })
  return { datos: (data as FilaOpcion[] | null) ?? [], error: error?.message ?? null }
}
