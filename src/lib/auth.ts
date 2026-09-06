import { createClient } from '@/lib/supabase/server'
import type { Perfil, Rol } from '@/lib/types'

// Trae el perfil (rol, departamento) del usuario autenticado en el server.
// Si el usuario no tiene fila en `perfiles` todavía (recién creado en
// Supabase Auth pero sin vincular), retorna null y la UI debe mostrar un
// aviso de "cuenta pendiente de activación" en vez de romper.
export async function getPerfilActual(): Promise<{
  perfil: Perfil | null
  rol: Rol | null
}> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return { perfil: null, rol: null }

  const { data: perfil } = await supabase
    .from('perfiles')
    .select('*')
    .eq('id', user.id)
    .single()

  if (!perfil) return { perfil: null, rol: null }

  const { data: rol } = await supabase
    .from('roles')
    .select('*')
    .eq('id', perfil.rol_id)
    .single()

  return { perfil: perfil as Perfil, rol: rol as Rol | null }
}
