import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

// Refresca la sesión de Supabase en cada request y protege las rutas de
// la app: si no hay usuario autenticado, redirige a /login.
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

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const ruta = request.nextUrl.pathname
  const isAuthRoute = ruta.startsWith('/login')

  // Rutas que existen para quien NO tiene usuario. El reporte de
  // maquinaria se publica hacia afuera y lo que enseña lo decide la
  // configuración del Administrador, no la sesión: pedirle login aquí
  // sería contradecir lo único que hace esa pantalla.
  const esPublica = ruta.startsWith('/reporte-maquinaria')

  if (!user && !isAuthRoute && !esPublica) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  if (user && isAuthRoute) {
    const url = request.nextUrl.clone()
    url.pathname = '/tickets'
    return NextResponse.redirect(url)
  }

  return supabaseResponse
}
