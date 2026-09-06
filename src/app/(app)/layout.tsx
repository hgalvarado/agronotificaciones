import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getPerfilActual } from '@/lib/auth'
import { LogoutButton } from '@/components/ui/LogoutButton'
import { BottomNav } from '@/components/ui/BottomNav'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const { perfil, rol } = await getPerfilActual()

  if (!perfil) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-slate-50 px-6 text-center">
        <h1 className="text-lg font-semibold text-slate-900">Cuenta pendiente de activación</h1>
        <p className="max-w-sm text-sm text-slate-500">
          Tu usuario existe en Supabase Auth pero todavía no tiene un perfil (rol/departamento)
          asignado en la tabla <code>perfiles</code>. Pide al Administrador que te agregue.
        </p>
        <LogoutButton />
      </div>
    )
  }

  return (
    <div className="flex min-h-dvh flex-col bg-slate-50">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3">
        <div>
          <p className="text-sm font-semibold text-slate-900">{perfil.nombre}</p>
          <p className="text-xs text-slate-500">{rol?.nombre ?? 'Sin rol'}</p>
        </div>
        <LogoutButton />
      </header>

      <main className="flex-1 overflow-y-auto pb-24">{children}</main>

      <BottomNav esAdmin={rol?.codigo === 'ADMIN'} esTorreControl={rol?.codigo === 'TORRE_CONTROL'} />
    </div>
  )
}
