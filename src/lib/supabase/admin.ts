import 'server-only'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'

// ⚠️  Cliente con SERVICE ROLE: ignora por completo RLS y puede crear
// usuarios en Supabase Auth. NUNCA debe llegar al navegador.
//
// Tres candados para que eso no pase por accidente:
//   1. `import 'server-only'` — el build FALLA si algún componente
//      cliente llega a importar este archivo.
//   2. La variable NO lleva el prefijo NEXT_PUBLIC_, así que Next.js no
//      la expone al bundle del navegador.
//   3. Sólo se usa dentro de Route Handlers que verifican que quien
//      llama sea Administrador.
export function createAdminClient() {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!serviceKey) {
    throw new Error(
      'Falta SUPABASE_SERVICE_ROLE_KEY en .env.local. ' +
        'Cópiala de Supabase → Settings → API → service_role. ' +
        'No le pongas el prefijo NEXT_PUBLIC_.'
    )
  }

  return createSupabaseClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}
