import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { exigirPermiso } from '@/lib/permisos/portero'
import { accesosSinMigracion93, leerRoles, rolesPorPerfil, validarRoles } from '@/lib/usuarios/rolesPerfil'
import { guardarAccesos, motivoNoAsignar, personasVisibles } from '@/lib/usuarios/accesos'

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
    // Delegación (93): un jefe de zona solo ve a las personas de sus zonas
    const visibles = await personasVisibles()

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

    const usuarios = (perfiles ?? []).filter((p) => !visibles || visibles.has(p.id)).map((p) => ({
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

    // Delegación (93): antes de crear nada, ¿puede dar estos accesos? (un jefe: sus zonas, roles delegables)
    const listaZonas: string[] = Array.isArray(zonas) ? zonas : []
    const todas = todas_las_zonas === undefined ? listaZonas.length === 0 : Boolean(todas_las_zonas)
    const motivo = await motivoNoAsignar(roles.roles, todas, listaZonas)
    if (motivo) return NextResponse.json({ error: motivo }, { status: 403 })

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
    }
    const { error: errPerfil } = await admin.from('perfiles').insert(perfil)

    if (errPerfil) {
      await admin.auth.admin.deleteUser(creado.user.id)
      return NextResponse.json({ error: errPerfil.message }, { status: 400 })
    }

    // Accesos (roles, «Todas las zonas», zonas) con la sesión de quien crea: reglas de delegación + historial.
    // Si la base los rechaza, se deshace el alta entera (no queda una cuenta a medias).
    const r = await guardarAccesos(creado.user.id, { roles: roles.roles, principal: roles.principal, todas, zonas: listaZonas })
    const problema = r.ok
      ? null
      : r.sinMigracion
        ? await accesosSinMigracion93(admin, creado.user.id, roles, todas, listaZonas)
        : r.error
    if (problema) {
      await admin.auth.admin.deleteUser(creado.user.id)
      return NextResponse.json({ error: problema }, { status: 400 })
    }

    return NextResponse.json({ ok: true, id: creado.user.id })
  } catch (e) {
    return NextResponse.json({ error: mensajeError(e) }, { status: 500 })
  }
}

function mensajeError(e: unknown) {
  return e instanceof Error ? e.message : 'Error inesperado.'
}
