import Link from 'next/link'
import { Logo } from '@/components/ui/Logo'
import { FormularioLogin } from '@/components/auth/FormularioLogin'
import { SelectorTema } from '@/components/ui/SelectorTema'

// De servidor a propósito: aquí se lee la dirección para saber si el
// middleware nos mandó porque la sesión había caducado, y el formulario
// —que sí es de navegador— recibe el dato ya resuelto.
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ sesion?: string }>
}) {
  const { sesion } = await searchParams

  return (
    <div className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden px-6">
      {/* El tema se puede cambiar antes de entrar: quien captura de noche
          llega aquí primero. */}
      <div className="absolute right-4 top-4">
        <SelectorTema compacto />
      </div>

      {/* Fondo con degradado suave de marca */}
      <div className="pointer-events-none absolute inset-0 -z-10 bg-gradient-to-br from-brand-50 via-white to-slate-100" />
      <div className="pointer-events-none absolute -left-24 -top-24 -z-10 h-72 w-72 rounded-full bg-brand-200/40 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-24 -right-24 -z-10 h-72 w-72 rounded-full bg-brand-300/30 blur-3xl" />

      <div className="anim-aparecer w-full max-w-sm">
        <div className="mb-7 flex flex-col items-center text-center">
          <Logo tamano={56} className="rounded-2xl shadow-[var(--shadow-float)]" />
          <h1 className="mt-4 text-2xl font-bold tracking-tight text-slate-900">
            AgroNotificaciones
          </h1>
          <p className="mt-1 text-sm text-slate-500">Control operativo de maquinaria agrícola</p>
        </div>

        <FormularioLogin sesionExpirada={sesion === 'expirada'} />

        {/* Sale del login a propósito: el reporte de maquinaria es
            público y quien lo consulta no siempre tiene usuario. */}
        <Link
          href="/reporte-maquinaria"
          className="mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white/90 text-sm font-semibold text-slate-700 shadow-[var(--shadow-card)] transition-colors hover:border-slate-300 hover:bg-white"
        >
          Ver Reporte Maquinaria
        </Link>

        <p className="mt-6 text-center text-xs text-slate-400">
          ¿No tienes cuenta? Pídele al Administrador que te dé de alta.
        </p>
      </div>
    </div>
  )
}
