import 'server-only'
import { createClient } from '@/lib/supabase/server'

/**
 * Los accesos de una persona (roles, «Todas las zonas», zonas) se guardan con la SESIÓN de quien edita
 * (migración 93): así la base aplica la delegación —un jefe de zona solo da sus zonas y roles delegables— y el
 * historial anota quién fue. Sin la 93 (código publicado antes de correr el SQL) devuelve `sinMigracion` y la API
 * usa el camino anterior.
 */

const FALTA_FUNCION = /PGRST202|schema cache|does not exist|Could not find the function/i

export type ResultadoAccesos = { ok: true } | { ok: false; error: string; sinMigracion?: boolean }

export async function guardarAccesos(
  perfilId: string,
  datos: { roles?: number[]; principal?: number; todas?: boolean; zonas?: string[] }
): Promise<ResultadoAccesos> {
  const supabase = await createClient()
  const { error } = await supabase.rpc('fn_guardar_accesos_persona', {
    p_perfil: perfilId,
    p_roles: datos.roles ?? null,
    p_principal: datos.principal ?? null,
    p_todas: datos.todas ?? null,
    p_zonas: datos.zonas ?? null,
  })
  if (!error) return { ok: true }
  if (FALTA_FUNCION.test(`${error.code} ${error.message}`)) return { ok: false, error: error.message, sinMigracion: true }
  return { ok: false, error: error.message }
}

/** ¿Puede dar estos accesos? null = sí. Sin la 93: null (rige lo de antes: solo la matriz). */
export async function motivoNoAsignar(roles: number[], todas: boolean, zonas: string[]): Promise<string | null> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('fn_motivo_no_asignar', { p_roles: roles, p_todas: todas, p_zonas: zonas })
  if (error) return FALTA_FUNCION.test(`${error.code} ${error.message}`) ? null : error.message
  return (data as string | null) ?? null
}

/** ¿Puede editar a esta persona? Sin la 93: true (rige lo de antes). */
export async function puedoEditarPersona(perfilId: string): Promise<boolean> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('fn_puedo_editar_persona', { p_perfil: perfilId, p_solo_ver: false })
  if (error) return FALTA_FUNCION.test(`${error.code} ${error.message}`)
  return Boolean(data)
}

/** Las personas que puede ver (null = todas: administra todo, o falta la 93). */
export async function personasVisibles(): Promise<Set<string> | null> {
  const supabase = await createClient()
  const { data: todo, error: e1 } = await supabase.rpc('fn_administra_todo_usuarios', { p_accion: 'ver' })
  if (e1 || todo) return null
  const { data, error } = await supabase.rpc('fn_personas_visibles')
  if (error) return null
  return new Set(((data as string[] | null) ?? []).map(String))
}
