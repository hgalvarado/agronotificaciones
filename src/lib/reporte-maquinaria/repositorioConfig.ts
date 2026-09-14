/**
 * Persistencia de la configuración del reporte público.
 *
 * Separada del repositorio de lectura porque es la otra mitad del
 * módulo y tiene otro cliente: la lectura pública corre en el servidor
 * sin sesión, y esto corre en el navegador del Administrador, con la
 * suya. Mezclarlas obligaría a un archivo a ser cliente y servidor a la
 * vez, que en Next no existe.
 *
 * Igual que la otra: trae o escribe, no decide.
 */

'use client'

import { createClient } from '@/lib/supabase/client'
import type { ConfiguracionPublica, EstadoTicketPublico, ProcesoTicket } from './tipos'

type FilaConfig = {
  activo: boolean
  procesos: string[] | null
  estados: string[] | null
  todos_departamentos: boolean
  departamentos: string[] | null
}

export type GuardarConfig = {
  activo: boolean
  procesos: ProcesoTicket[]
  estados: EstadoTicketPublico[]
  todosDepartamentos: boolean
  departamentos: string[]
}

export async function guardarConfiguracionEnBase(
  entrada: GuardarConfig,
  usuarioId: string | null
): Promise<{ error: string | null }> {
  const supabase = createClient()
  const { error } = await supabase
    .from('reporte_publico_config')
    .update({
      activo: entrada.activo,
      procesos: entrada.procesos,
      estados: entrada.estados,
      todos_departamentos: entrada.todosDepartamentos,
      departamentos: entrada.departamentos,
      actualizado_por: usuarioId,
      updated_at: new Date().toISOString(),
    })
    .eq('id', true)
  return { error: error?.message ?? null }
}

export async function releerConfiguracion(): Promise<{
  datos: Omit<ConfiguracionPublica, 'temporadaActiva'> | null
  error: string | null
}> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('reporte_publico_config')
    .select('activo, procesos, estados, todos_departamentos, departamentos')
    .eq('id', true)
    .maybeSingle()

  if (error) return { datos: null, error: error.message }
  const fila = data as FilaConfig | null
  if (!fila) return { datos: null, error: null }

  return {
    datos: {
      activo: fila.activo,
      procesos: (fila.procesos ?? []) as ProcesoTicket[],
      estados: (fila.estados ?? []) as EstadoTicketPublico[],
      todosDepartamentos: fila.todos_departamentos,
      departamentos: fila.departamentos ?? [],
    },
    error: null,
  }
}
