import { createBrowserClient } from '@supabase/ssr'

// Cliente para Client Components ('use client'). Usa la anon key (segura
// para el navegador) — toda la seguridad real la hace RLS en Postgres.
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}
