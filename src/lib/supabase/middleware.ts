import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { cookiesDeSesion, esSesionMuerta, limpiarSesion } from './sesion'

// Refresca la sesión de Supabase en cada request y protege las rutas de
// la app: si no hay usuario autenticado, redirige a /login.
//
// Aquí y en ningún otro sitio se decide qué pasa con una sesión que ya no
// vale. El middleware es el único que corre ANTES que todo y el único que
// puede escribir cookies en cualquier respuesta; hacerlo desde una página
// o desde un Server Action llega tarde y a medias.
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

  // Rutas que existen para quien NO tiene usuario. El reporte de
  // maquinaria se publica hacia afuera y lo que enseña lo decide la
  // configuración del Administrador, no la sesión: pedirle login aquí
  // sería contradecir lo único que hace esa pantalla.
  const esPublica = ruta.startsWith('/reporte-maquinaria')

  // Si el navegador no trae cookies de sesión, «no hay usuario» es el
  // caso normal de un visitante y no una sesión que se echó a perder.
  const habiaCookies = cookiesDeSesion(request).length > 0

  // `getUser` va dentro de un try: si Supabase no contesta —red caída,
  // proyecto pausado— el middleware NO puede reventar, porque reventar
  // aquí deja la aplicación entera en un error 500.
  let usuario = null
  let sesionMuerta = false
  try {
    const { data, error } = await supabase.auth.getUser()
    usuario = data.user
    sesionMuerta = esSesionMuerta(error, habiaCookies)
  } catch (e) {
    sesionMuerta = esSesionMuerta(e, habiaCookies)
  }

  // La cookie existe pero su token de refresco ya no vale. Se borra y se
  // manda a entrar de nuevo: sin esto, cada petición repite el intento
  // fallido, llena la terminal de `refresh_token_not_found` y deja al
  // servidor creyendo que no hay nadie, con las pantallas en blanco y
  // sin un solo mensaje que lo explique.
  if (sesionMuerta) {
    if (isAuthRoute || esPublica) {
      return limpiarSesion(request, NextResponse.next({ request }))
    }
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    // El login lo lee para decir «tu sesión expiró» en vez de dejar al
    // usuario pensando que se equivocó de contraseña.
    url.searchParams.set('sesion', 'expirada')
    return limpiarSesion(request, NextResponse.redirect(url))
  }

  if (!usuario && !isAuthRoute && !esPublica) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  if (usuario && isAuthRoute) {
    const url = request.nextUrl.clone()
    url.pathname = '/tickets'
    return NextResponse.redirect(url)
  }

  return supabaseResponse
}
