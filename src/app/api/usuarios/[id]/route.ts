import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { exigirPermiso } from '@/lib/permisos/portero'
import { ahoraIso } from '@/lib/fechas'
import { accesosSinMigracion93, leerRoles, validarRoles } from '@/lib/usuarios/rolesPerfil'
import { guardarAccesos, puedoEditarPersona } from '@/lib/usuarios/accesos'

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

    // Delegación (93): un jefe de zona solo edita a personas de sus zonas. La base lo decide.
    if (!(await puedoEditarPersona(id))) {
      return NextResponse.json(
        { error: 'No puedes editar a esta persona: no es de tus zonas o tiene roles que no administras.' },
        { status: 403 }
      )
    }

    // 1) Accesos (roles, «Todas las zonas», zonas): con la sesión de quien edita, en una sola transacción, con
    //    las reglas de delegación y anotado en el historial (93).
    const tocaAccesos = Boolean(roles) || todas_las_zonas !== undefined || Array.isArray(zonas)
    if (tocaAccesos) {
      const r = await guardarAccesos(id, {
        roles: roles?.roles,
        principal: roles?.principal,
        todas: todas_las_zonas === undefined ? undefined : Boolean(todas_las_zonas),
        zonas: Array.isArray(zonas) ? zonas : undefined,
      })
      if (!r.ok && !r.sinMigracion) return NextResponse.json({ error: r.error }, { status: 400 })
      if (!r.ok && r.sinMigracion) {
        const problema = await accesosSinMigracion93(admin, id, roles, todas_las_zonas, zonas)
        if (problema) return NextResponse.json({ error: problema }, { status: 400 })
      }
    }

    // 2) Datos del perfil
    const cambios: Record<string, unknown> = {}
    if (nombre !== undefined) cambios.nombre = nombre
    if (departamento !== undefined) cambios.departamento = departamento || null
    if (whatsapp !== undefined) cambios.whatsapp = whatsapp || null
    if (activo !== undefined) cambios.activo = activo

    if (Object.keys(cambios).length > 0) {
      cambios.updated_at = ahoraIso()
      const { error } = await admin.from('perfiles').update(cambios).eq('id', id)
      if (error) return NextResponse.json({ error: error.message }, { status: 400 })
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
