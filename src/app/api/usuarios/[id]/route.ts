import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getPerfilActual } from '@/lib/auth'
import { ahoraIso } from '@/lib/fechas'

async function exigirAdmin() {
  const { perfil, rol } = await getPerfilActual()
  if (!perfil || !perfil.activo || rol?.codigo !== 'ADMIN') {
    return {
      denegado: NextResponse.json(
        { error: 'Sólo el Administrador puede gestionar usuarios.' },
        { status: 403 }
      ),
      yo: null,
    }
  }
  return { denegado: null, yo: perfil.id }
}

/* ------------------------------------------------------------------ */
/* PATCH · actualizar datos, rol, estado o contraseña                  */
/* ------------------------------------------------------------------ */
export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { denegado, yo } = await exigirAdmin()
  if (denegado) return denegado

  const { id } = await context.params

  try {
    const body = await request.json()
    const { nombre, rol_id, departamento, whatsapp, activo, password, zonas } = body

    const admin = createAdminClient()

    // Candado de seguridad: el admin no puede desactivarse ni degradarse a
    // sí mismo. Si lo hiciera, el sistema podría quedarse sin ningún
    // administrador y habría que arreglarlo a mano en Supabase.
    if (id === yo) {
      if (activo === false) {
        return NextResponse.json(
          { error: 'No puedes desactivar tu propia cuenta.' },
          { status: 400 }
        )
      }
      if (rol_id !== undefined && Number(rol_id) !== 1) {
        return NextResponse.json(
          { error: 'No puedes quitarte a ti mismo el rol de Administrador.' },
          { status: 400 }
        )
      }
    }

    // 1) Cambios en el perfil
    const cambios: Record<string, unknown> = {}
    if (nombre !== undefined) cambios.nombre = nombre
    if (rol_id !== undefined) cambios.rol_id = rol_id
    if (departamento !== undefined) cambios.departamento = departamento || null
    if (whatsapp !== undefined) cambios.whatsapp = whatsapp || null
    if (activo !== undefined) cambios.activo = activo

    if (Object.keys(cambios).length > 0) {
      cambios.updated_at = ahoraIso()
      const { error } = await admin.from('perfiles').update(cambios).eq('id', id)
      if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    }

    // 1b) Zonas asignadas. Se reemplazan enteras: diferenciar altas y
    //     bajas desde el navegador es cómo se acaba con una zona pegada
    //     que nadie sabe de dónde salió. Una lista vacía DESRESTRINGE:
    //     el usuario vuelve a ver toda la finca.
    if (Array.isArray(zonas)) {
      const { error } = await admin.from('perfiles_zonas').delete().eq('perfil_id', id)
      // Si la migración 41 no está corrida la tabla no existe: se ignora
      // en vez de tumbar el guardado del resto del perfil.
      if (error && !/does not exist|schema cache/i.test(error.message)) {
        return NextResponse.json({ error: error.message }, { status: 400 })
      }
      if (!error && zonas.length > 0) {
        const { error: e2 } = await admin
          .from('perfiles_zonas')
          .insert(zonas.map((z: string) => ({ perfil_id: id, zona_id: z })))
        if (e2) return NextResponse.json({ error: e2.message }, { status: 400 })
      }
    }

    // 2) Bloqueo real en Auth al desactivar.
    //    Marcar `activo = false` sólo apaga la interfaz; el token de sesión
    //    seguiría siendo válido. El ban en Auth corta el acceso de verdad.
    if (activo !== undefined) {
      const { error } = await admin.auth.admin.updateUserById(id, {
        ban_duration: activo ? 'none' : '876000h', // ~100 años
      })
      if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    }

    // 3) Reseteo de contraseña
    if (password) {
      if (String(password).length < 8) {
        return NextResponse.json(
          { error: 'La contraseña debe tener al menos 8 caracteres.' },
          { status: 400 }
        )
      }
      const { error } = await admin.auth.admin.updateUserById(id, { password })
      if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    }

    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Error inesperado.' },
      { status: 500 }
    )
  }
}
