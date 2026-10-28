import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { esSesionMuerta, limpiarSesion } from './sesion'

/**
 * Middleware de sesión: el patrón estándar de `@supabase/ssr`, sin más.
 *
 *   · `getUser()` valida (y, si hace falta, refresca UNA vez y escribe las
 *     cookies nuevas en la respuesta).
 *   · Con usuario: se avanza. En `/login`, se manda a la portada.
 *   · Sin usuario: a `/login`. Nada de parámetros ni cortafuegos.
 *
 * Hotfix de emergencia (2026-10-27): se quitaron el refresco anticipado,
 * el cortafuegos por `?sesion=expirada` y el borrado de cookies «inútiles».
 * Este último era el que sacaba al usuario recién entrado: si `getUser`
 * tardaba o fallaba por red (la petición `?_rsc=` que se colgó 10 s), la
 * cookie RECIÉN escrita se trataba como basura, se borraba y se
 * redirigía a `/login?sesion=expirada`.
 *
 * Única excepción, y sólo por CÓDIGO explícito de Supabase
 * (`refresh_token_not_found`, `…already_used`, `session_not_found`…): esa
 * cookie ya no puede servir nunca y se borra al mandar al login, porque si
 * no cada petición repetiría el mismo refresco condenado.
 */
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const ruta = request.nextUrl.pathname
  const isAuthRoute = ruta.startsWith('/login')
  // El reporte de maquinaria es público: lo que enseña lo decide la
  // configuración del Administrador, no la sesión.
  const esPublica = ruta.startsWith('/reporte-maquinaria')

  let usuario = null
  let muerta = false
  try {
    const { data, error } = await supabase.auth.getUser()
    usuario = data.user
    // Sólo por código explícito: un corte de red NO es una sesión muerta.
    muerta = !usuario && Boolean(error?.code) && esSesionMuerta(error)
  } catch {
    // Supabase no contestó: no se toca ninguna cookie.
    usuario = null
  }

  if (!usuario && !isAuthRoute && !esPublica) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    url.search = ''
    const redireccion = NextResponse.redirect(url)
    return muerta ? limpiarSesion(request, redireccion) : redireccion
  }

  if (usuario && isAuthRoute) {
    const url = request.nextUrl.clone()
    url.pathname = '/'
    url.search = ''
    return NextResponse.redirect(url)
  }

  return supabaseResponse
}
