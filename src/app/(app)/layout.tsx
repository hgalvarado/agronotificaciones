import { redirect } from 'next/navigation'
import { getNavegacion, getPerfilActual, getPermisos, getUsuarioActual } from '@/lib/auth'
import { AppShell } from '@/components/ui/AppShell'
import { LogoutButton } from '@/components/ui/LogoutButton'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // Ambas llamadas están memorizadas con cache(): getUsuarioActual() se
  // resuelve una vez por request aunque getPerfilActual() también lo use.
  const user = await getUsuarioActual()
  if (!user) redirect('/login')

  const [{ perfil, rol }, permisos, navegacion] = await Promise.all([
    getPerfilActual(),
    getPermisos(),
    getNavegacion(),
  ])

  if (!perfil) {
    return (
      <AvisoCuenta
        titulo="Cuenta pendiente de activación"
        mensaje="Tu usuario existe pero todavía no tiene un perfil asignado. Pide al Administrador que te dé de alta desde el panel de usuarios."
      />
    )
  }

  if (!perfil.activo) {
    return (
      <AvisoCuenta
        titulo="Cuenta desactivada"
        mensaje="Tu acceso fue desactivado por el Administrador. Si crees que es un error, comunícate con Torre de Control."
      />
    )
  }

  return (
    <AppShell
      nombre={perfil.nombre}
      rolNombre={rol?.nombre ?? 'Sin rol'}
      esAdmin={rol?.codigo === 'ADMIN'}
      esTorreControl={rol?.codigo === 'TORRE_CONTROL'}
      permisos={[...permisos]}
      navegacion={navegacion}
    >
      {children}
    </AppShell>
  )
}

function AvisoCuenta({ titulo, mensaje }: { titulo: string; mensaje: string }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-100 text-xl">
        ⏳
      </div>
      <h1 className="text-lg font-semibold text-slate-900">{titulo}</h1>
      <p className="max-w-sm text-sm text-slate-500">{mensaje}</p>
      <LogoutButton />
    </div>
  )
}
