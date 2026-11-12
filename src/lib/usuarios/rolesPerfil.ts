import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Los roles de una persona (migración 92: varios roles; `perfiles.rol_id` es el principal).
 *
 * Vive aparte de las rutas de la API porque lo usan el alta y la edición, y porque la regla de seguridad
 * —nadie se quita a sí mismo el acceso total— no puede depender de un número de rol escrito a mano: se
 * pregunta a la tabla `roles` por su bandera.
 */

export type EntradaRoles = { roles: number[]; principal: number }

/** Normaliza lo que manda el navegador. Acepta el formato viejo (solo `rol_id`). */
export function leerRoles(body: { roles?: unknown; rol_id?: unknown }): EntradaRoles | null {
  const lista = Array.isArray(body.roles)
    ? [...new Set(body.roles.map(Number).filter((n) => Number.isInteger(n) && n > 0))]
    : body.rol_id !== undefined
      ? [Number(body.rol_id)]
      : null
  if (!lista) return null
  const principal = body.rol_id !== undefined && lista.includes(Number(body.rol_id)) ? Number(body.rol_id) : lista[0]
  return { roles: lista, principal }
}

export async function validarRoles(
  admin: SupabaseClient,
  entrada: EntradaRoles,
  opciones: { debeConservarAccesoTotal?: boolean } = {}
): Promise<string | null> {
  if (entrada.roles.length === 0) return 'Elige al menos un rol.'
  const { data, error } = await admin.from('roles').select('id, acceso_total').in('id', entrada.roles)
  if (error) return error.message
  if ((data ?? []).length !== entrada.roles.length) return 'Uno de los roles ya no existe. Recarga la página.'
  if (opciones.debeConservarAccesoTotal && !(data ?? []).some((r) => r.acceso_total)) {
    return 'No puedes quitarte a ti mismo el rol con acceso total.'
  }
  return null
}

/**
 * Deja exactamente esos roles (fn_asignar_roles, migración 92). La tabla de roles por persona vive en un
 * esquema que la API no expone —si estuviera en «public», `perfiles?select=*,roles(*)` se volvería ambiguo y
 * nadie podría entrar—, así que solo se toca por la función.
 * Sin la 92 (código publicado antes de correr el SQL): se guarda el rol principal, como antes.
 */
export async function sincronizarRoles(
  admin: SupabaseClient,
  perfilId: string,
  entrada: EntradaRoles
): Promise<string | null> {
  const { error } = await admin.rpc('fn_asignar_roles', {
    p_perfil: perfilId,
    p_roles: entrada.roles,
    p_principal: entrada.principal,
  })
  if (!error) return null
  if (!/fn_asignar_roles|PGRST202|schema cache/i.test(`${error.code} ${error.message}`)) return error.message

  const { error: e2 } = await admin.from('perfiles').update({ rol_id: entrada.principal }).eq('id', perfilId)
  return e2 ? e2.message : null
}

/**
 * El camino anterior a la 93 (código publicado antes de correr el SQL): roles, «Todas las zonas» y zonas con la
 * llave de servicio, como lo hacía la API. Tolera que tampoco esté la 92.
 */
export async function accesosSinMigracion93(
  admin: SupabaseClient,
  perfilId: string,
  roles: EntradaRoles | null,
  todas: unknown,
  zonas: unknown
): Promise<string | null> {
  if (roles) {
    const problema = await sincronizarRoles(admin, perfilId, roles)
    if (problema) return problema
  }
  if (todas !== undefined) {
    const { error } = await admin.from('perfiles').update({ todas_las_zonas: Boolean(todas) }).eq('id', perfilId)
    if (error && !/todas_las_zonas/.test(error.message)) return error.message
  }
  if (Array.isArray(zonas)) {
    const { error } = await admin.from('perfiles_zonas').delete().eq('perfil_id', perfilId)
    if (error && !/does not exist|schema cache/i.test(error.message)) return error.message
    if (!error && zonas.length > 0) {
      const { error: e2 } = await admin
        .from('perfiles_zonas')
        .insert(zonas.map((z: string) => ({ perfil_id: perfilId, zona_id: z })))
      if (e2) return e2.message
    }
  }
  return null
}

/** {perfil → sus roles}. Sin la 92: vacío (cada quien con su rol principal). */
export async function rolesPorPerfil(admin: SupabaseClient): Promise<Map<string, number[]>> {
  const m = new Map<string, number[]>()
  const { data, error } = await admin.rpc('fn_roles_de_perfiles')
  if (error) return m
  for (const f of (data as { perfil_id: string; rol_id: number }[] | null) ?? []) {
    m.set(f.perfil_id, [...(m.get(f.perfil_id) ?? []), Number(f.rol_id)])
  }
  return m
}
