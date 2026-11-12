import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { exigirPermiso } from '@/lib/permisos/portero'
import { ahoraIso } from '@/lib/fechas'
import { leerRoles, sincronizarRoles, validarRoles } from '@/lib/usuarios/rolesPerfil'

/* ------------------------------------------------------------------ */
/* PATCH · actualizar datos, rol, estado o contraseña                  */
/* ------------------------------------------------------------------ */
export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { denegado, yo } = await exigirPermiso('usuarios', 'editar')
  if (denegado) return denegado

  const { id } = await context.params

  try {
    const body = await request.json()
    const { nombre, departamento, whatsapp, activo, password, zonas, todas_las_zonas } = body
    const roles = leerRoles(body)

    const admin = createAdminClient()

    // Candado de seguridad: nadie se desactiva ni se quita a sí mismo el acceso total. Si lo hiciera, el
    // sistema podría quedarse sin administrador. Se pregunta a la bandera del rol, no a un número.
    if (id === yo && activo === false) {
      return NextResponse.json({ error: 'No puedes desactivar tu propia cuenta.' }, { status: 400 })
    }
    if (roles) {
      const problema = await validarRoles(admin, roles, { debeConservarAccesoTotal: id === yo })
      if (problema) return NextResponse.json({ error: problema }, { status: 400 })
    }

    // 1) Cambios en el perfil
    const cambios: Record<string, unknown> = {}
    if (nombre !== undefined) cambios.nombre = nombre
    if (departamento !== undefined) cambios.departamento = departamento || null
    if (whatsapp !== undefined) cambios.whatsapp = whatsapp || null
    if (activo !== undefined) cambios.activo = activo
    // Migración 92: «Todas las zonas» es una casilla, ya no una lista vacía
    if (todas_las_zonas !== undefined) cambios.todas_las_zonas = Boolean(todas_las_zonas)

    if (Object.keys(cambios).length > 0) {
      cambios.updated_at = ahoraIso()
      let { error } = await admin.from('perfiles').update(cambios).eq('id', id)
      // Código publicado antes de correr la 92: la columna aún no existe; se guarda lo demás
      if (error && /todas_las_zonas/.test(error.message)) {
        delete cambios.todas_las_zonas
        ;({ error } = await admin.from('perfiles').update(cambios).eq('id', id))
      }
      if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    }

    // 1a) Roles (varios; el principal primero)
    if (roles) {
      const problema = await sincronizarRoles(admin, id, roles)
      if (problema) return NextResponse.json({ error: problema }, { status: 400 })
    }

    // 1b) Zonas asignadas. Se reemplazan enteras: diferenciar altas y
    //     bajas desde el navegador es cómo se acaba con una zona pegada
    //     que nadie sabe de dónde salió. Desde la 92, ver todas es la
    //     casilla «Todas las zonas», no una lista vacía.
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
