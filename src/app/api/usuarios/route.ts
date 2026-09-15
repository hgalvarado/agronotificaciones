import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getPerfilActual } from '@/lib/auth'

// Portero: toda ruta de este módulo exige que quien llama sea Administrador.
// Se verifica contra la BASE DE DATOS con la sesión del usuario, no contra
// nada que venga en el request — un usuario no puede auto-declararse admin.
async function exigirAdmin() {
  const { perfil, rol } = await getPerfilActual()
  if (!perfil || !perfil.activo || rol?.codigo !== 'ADMIN') {
    return NextResponse.json(
      { error: 'Sólo el Administrador puede gestionar usuarios.' },
      { status: 403 }
    )
  }
  return null
}

/* ------------------------------------------------------------------ */
/* GET · listar usuarios (perfil + correo de Supabase Auth)            */
/* ------------------------------------------------------------------ */
export async function GET() {
  const denegado = await exigirAdmin()
  if (denegado) return denegado

  try {
    const admin = createAdminClient()

    const [
      { data: perfiles, error: errPerfiles },
      { data: authData, error: errAuth },
      { data: asignadas },
    ] = await Promise.all([
      admin.from('perfiles').select('*, roles(*)').order('nombre'),
      admin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
      // Llega con la migración 41. Sin ella, `asignadas` viene nulo y
      // todos salen sin zonas, que es exactamente «ven todo»: el
      // comportamiento de siempre.
      admin.from('perfiles_zonas').select('perfil_id, zona_id'),
    ])

    if (errPerfiles) throw errPerfiles
    if (errAuth) throw errAuth

    const zonasPorPerfil = new Map<string, string[]>()
    for (const f of asignadas ?? []) {
      const id = f.perfil_id as string
      zonasPorPerfil.set(id, [...(zonasPorPerfil.get(id) ?? []), f.zona_id as string])
    }

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
  const denegado = await exigirAdmin()
  if (denegado) return denegado

  try {
    const body = await request.json()
    const { email, password, nombre, rol_id, departamento, whatsapp, zonas } = body

    if (!email || !password || !nombre || !rol_id) {
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
    const { error: errPerfil } = await admin.from('perfiles').insert({
      id: creado.user.id,
      nombre,
      rol_id,
      departamento: departamento || null,
      whatsapp: whatsapp || null,
      activo: true,
    })

    if (errPerfil) {
      await admin.auth.admin.deleteUser(creado.user.id)
      return NextResponse.json({ error: errPerfil.message }, { status: 400 })
    }

    // Las zonas van después del perfil porque apuntan a él. Una lista
    // vacía no inserta nada, y eso es lo correcto: sin zonas asignadas
    // el usuario ve toda la finca.
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
