import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

// Cliente para Server Components / Server Actions / Route Handlers.
// Lee y escribe las cookies de sesión de Supabase Auth.
export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // Se puede ignorar si setAll se llama desde un Server Component:
            // el middleware ya se encarga de refrescar la sesión.
          }
        },
      },
    }
  )
}
