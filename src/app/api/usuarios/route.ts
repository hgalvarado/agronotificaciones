import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { exigirPermiso } from '@/lib/permisos/portero'
import { leerRoles, rolesPorPerfil, sincronizarRoles, validarRoles } from '@/lib/usuarios/rolesPerfil'

/* ------------------------------------------------------------------ */
/* GET · listar usuarios (perfil + correo de Supabase Auth)            */
/* ------------------------------------------------------------------ */
export async function GET() {
  // Quien pueda VER la pantalla de Usuarios puede listar. Antes exigía el
  // rol ADMIN a mano y la matriz no decidía nada.
  const { denegado } = await exigirPermiso('usuarios', 'ver')
  if (denegado) return denegado

  try {
    const admin = createAdminClient()

    const [
      { data: perfiles, error: errPerfiles },
      { data: authData, error: errAuth },
      { data: asignadas },
      rolesPorPerfilMapa,
      { data: estacionesAsignadas },
    ] = await Promise.all([
      // La relación se nombra: con la 92 hay más de un camino entre perfiles y roles para quien mire
      admin.from('perfiles').select('*, roles!perfiles_rol_id_fkey(*)').order('nombre'),
      admin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
      admin.from('perfiles_zonas').select('perfil_id, zona_id'),
      // Migración 92 (varios roles) y 91 (estaciones). Sin ellas: un rol y sin estaciones.
      rolesPorPerfil(admin),
      admin.from('perfiles_estaciones').select('perfil_id, estacion_id'),
    ])

    if (errPerfiles) throw errPerfiles
    if (errAuth) throw errAuth

    const agrupar = (filas: Record<string, unknown>[] | null, campo: string) => {
      const m = new Map<string, (string | number)[]>()
      for (const f of filas ?? []) {
        const id = f.perfil_id as string
        m.set(id, [...(m.get(id) ?? []), f[campo] as string | number])
      }
      return m
    }
    const zonasPorPerfil = agrupar(asignadas, 'zona_id') as Map<string, string[]>
    const estacionesPorPerfil = agrupar(estacionesAsignadas, 'estacion_id') as Map<string, string[]>

    // El correo vive en auth.users, no en perfiles: se cruzan por id.
    const correos = new Map(authData.users.map((u) => [u.id, u.email ?? '']))
    const baneados = new Map(
      authData.users.map((u) => [
        u.id,
        // banned_until viene del Admin API; si es futuro, está bloqueado.
        Boolean(
          (u as { banned_until?: string }).banned_until &&
            new Date((u as { banned_until?: string }).banned_until!) > new Date()
        ),
      ])
    )

    const usuarios = (perfiles ?? []).map((p) => ({
      ...p,
      email: correos.get(p.id) ?? '',
      bloqueado: baneados.get(p.id) ?? false,
      zonas: zonasPorPerfil.get(p.id) ?? [],
      // Sin la 92: su único rol; y «todas» como se comportaba antes (sin zonas = todas)
      roles_ids: rolesPorPerfilMapa.get(p.id) ?? [p.rol_id],
      todas_las_zonas: p.todas_las_zonas ?? !(zonasPorPerfil.get(p.id)?.length ?? 0),
      estaciones: estacionesPorPerfil.get(p.id) ?? [],
    }))

    return NextResponse.json({ usuarios })
  } catch (e) {
    return NextResponse.json({ error: mensajeError(e) }, { status: 500 })
  }
}

/* ------------------------------------------------------------------ */
/* POST · crear usuario (Auth + perfil)                                */
/* ------------------------------------------------------------------ */
export async function POST(request: NextRequest) {
  const { denegado } = await exigirPermiso('usuarios', 'crear')
  if (denegado) return denegado

  try {
    const body = await request.json()
    const { email, password, nombre, departamento, whatsapp, zonas, todas_las_zonas } = body
    const roles = leerRoles(body)

    if (!email || !password || !nombre || !roles?.roles.length) {
      return NextResponse.json(
        { error: 'Correo, contraseña, nombre y rol son obligatorios.' },
        { status: 400 }
      )
    }
    if (String(password).length < 8) {
      return NextResponse.json(
        { error: 'La contraseña debe tener al menos 8 caracteres.' },
        { status: 400 }
      )
    }

    const admin = createAdminClient()
    const problemaRoles = await validarRoles(admin, roles)
    if (problemaRoles) return NextResponse.json({ error: problemaRoles }, { status: 400 })

    // 1) Crear el usuario en Supabase Auth, ya confirmado (no hay correo
    //    de verificación que el personal de campo tenga que abrir).
    const { data: creado, error: errAuth } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    })

    if (errAuth || !creado.user) {
      return NextResponse.json(
        { error: errAuth?.message ?? 'No se pudo crear el usuario en Auth.' },
        { status: 400 }
      )
    }

    // 2) Crear su perfil (rol, departamento). Si esto falla hay que
    //    deshacer el usuario de Auth, o quedaría un huérfano que no
    //    puede entrar y que bloquea volver a usar ese correo.
    const perfil: Record<string, unknown> = {
      id: creado.user.id,
      nombre,
      rol_id: roles.principal,
      departamento: departamento || null,
      whatsapp: whatsapp || null,
      activo: true,
      // Migración 92: explícito. Si no lo mandan, como antes: sin zonas marcadas = todas
      todas_las_zonas: todas_las_zonas ?? !(Array.isArray(zonas) && zonas.length > 0),
    }
    let { error: errPerfil } = await admin.from('perfiles').insert(perfil)
    if (errPerfil && /todas_las_zonas/.test(errPerfil.message)) {
      delete perfil.todas_las_zonas   // código publicado antes de correr la 92
      ;({ error: errPerfil } = await admin.from('perfiles').insert(perfil))
    }

    if (errPerfil) {
      await admin.auth.admin.deleteUser(creado.user.id)
      return NextResponse.json({ error: errPerfil.message }, { status: 400 })
    }

    // Los demás roles (el principal ya lo puso el trigger de la 92)
    const problema = await sincronizarRoles(admin, creado.user.id, roles)
    if (problema) return NextResponse.json({ error: problema }, { status: 400 })

    // Las zonas van después del perfil porque apuntan a él.
    if (Array.isArray(zonas) && zonas.length > 0) {
      await admin
        .from('perfiles_zonas')
        .insert(zonas.map((z: string) => ({ perfil_id: creado.user.id, zona_id: z })))
    }

    return NextResponse.json({ ok: true, id: creado.user.id })
  } catch (e) {
    return NextResponse.json({ error: mensajeError(e) }, { status: 500 })
  }
}

function mensajeError(e: unknown) {
  return e instanceof Error ? e.message : 'Error inesperado.'
}
