import { cache } from 'react'
import { createClient } from '@/lib/supabase/server'
import type { Perfil, Rol } from '@/lib/types'

// `cache()` de React deduplica dentro de UN MISMO request: aunque el
// layout, la página y un componente anidado llamen a getPerfilActual(),
// se ejecuta una sola vez. Antes se hacían hasta 4 viajes a Supabase por
// pantalla (getUser + perfil + rol, repetidos en layout y página).
export const getUsuarioActual = cache(async () => {
  const supabase = await createClient()
  // Va en un try porque una sesión caducada hace que `getUser` LANCE, no
  // que devuelva error, y una excepción aquí tumba la pantalla entera con
  // un 500 en vez de mandar a entrar de nuevo. De limpiar la cookie y
  // redirigir se encarga el middleware, que corre antes; esto sólo evita
  // que el camino intermedio reviente.
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser()
    return user
  } catch {
    return null
  }
})

// Una sola consulta con JOIN embebido en vez de dos secuenciales.
export const getPerfilActual = cache(async (): Promise<{
  perfil: Perfil | null
  rol: Rol | null
}> => {
  const user = await getUsuarioActual()
  if (!user) return { perfil: null, rol: null }

  const supabase = await createClient()
  const { data } = await supabase
    .from('perfiles')
    .select('*, roles(*)')
    .eq('id', user.id)
    .maybeSingle()

  if (!data) return { perfil: null, rol: null }

  const { roles, ...perfil } = data as Perfil & { roles: Rol | Rol[] | null }
  const rol = Array.isArray(roles) ? (roles[0] ?? null) : roles

  return { perfil: perfil as Perfil, rol }
})

/**
 * Permisos efectivos del usuario, como un conjunto de claves
 * `"pantalla:accion"` (por ejemplo `"costos:ver"`).
 *
 * Sale de `fn_mis_permisos()`, que ya resuelve el caso del Administrador
 * devolviéndole todas las combinaciones. Va con `cache()` como los otros:
 * el layout lo pide para dibujar el menú y cada página lo vuelve a pedir
 * para esconder botones, y así se consulta una sola vez por request.
 */
export const getPermisos = cache(async (): Promise<Set<string>> => {
  const user = await getUsuarioActual()
  if (!user) return new Set()

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('fn_mis_permisos')

  // Si la migración 12 todavía no se ha corrido, la función no existe. En
  // vez de dejar la app sin menú, se cae al comportamiento anterior: el
  // rol manda. Así actualizar el código y correr el SQL pueden ir en
  // momentos distintos sin que nadie se quede sin poder trabajar.
  if (error) return new Set(['__sin_migracion__'])

  const filas = (data as { recurso: string; accion: string }[] | null) ?? []
  return new Set(filas.map((f) => `${f.recurso}:${f.accion}`))
})

/**
 * Qué accesos quiere el Administrador en la barra del teléfono para el
 * rol de este usuario, ya en orden.
 *
 * Devuelve una lista vacía cuando no hay nada configurado O cuando la
 * migración 39 todavía no se ha corrido: en los dos casos la barra vuelve
 * al orden del código, que es exactamente lo que había antes. Una
 * preferencia de presentación nunca puede dejar a nadie sin menú.
 */
export const getNavegacion = cache(async (): Promise<string[]> => {
  const user = await getUsuarioActual()
  if (!user) return []

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('fn_mi_navegacion')
  if (error) return []

  const filas = (data as { pantalla: string }[] | null) ?? []
  return filas.map((f) => f.pantalla)
})

// `puede` vive en `lib/permisos/puede` —sin ninguna importación— porque
// también la usan componentes de cliente, y este archivo abre el cliente
// de Supabase del servidor. Se reexporta para no cambiar los cien sitios
// que la importan de aquí.
export { puede } from '@/lib/permisos/puede'
