'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { Alerta, Boton, Campo, Entrada } from '@/components/ui/Primitivos'
import { Logo } from '@/components/ui/Logo'

export default function LoginPage() {
  const router = useRouter()
  const supabase = createClient()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [cargando, setCargando] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setCargando(true)

    const { error: authError } = await supabase.auth.signInWithPassword({ email, password })

    setCargando(false)
    if (authError) {
      setError('Usuario o contraseña incorrectos.')
      return
    }
    router.push('/tickets')
    router.refresh()
  }

  return (
    <div className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden px-6">
      {/* Fondo con degradado suave de marca */}
      <div className="pointer-events-none absolute inset-0 -z-10 bg-gradient-to-br from-brand-50 via-white to-slate-100" />
      <div className="pointer-events-none absolute -left-24 -top-24 -z-10 h-72 w-72 rounded-full bg-brand-200/40 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-24 -right-24 -z-10 h-72 w-72 rounded-full bg-brand-300/30 blur-3xl" />

      <div className="anim-aparecer w-full max-w-sm">
        <div className="mb-7 flex flex-col items-center text-center">
          <Logo tamano={56} className="rounded-2xl shadow-[var(--shadow-float)]" />
          <h1 className="mt-4 text-2xl font-bold tracking-tight text-slate-900">AgroNotificaciones</h1>
          <p className="mt-1 text-sm text-slate-500">Control operativo de maquinaria agrícola</p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="flex flex-col gap-4 rounded-2xl border border-slate-200/80 bg-white/90 p-6 shadow-[var(--shadow-float)] backdrop-blur-sm"
        >
          <Campo etiqueta="Correo" requerido>
            <Entrada
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="tucorreo@agrolibano.com"
              required
            />
          </Campo>

          <Campo etiqueta="Contraseña" requerido>
            <Entrada
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
            />
          </Campo>

          {error && <Alerta>{error}</Alerta>}

          <Boton type="submit" tamano="lg" className="mt-1 w-full" disabled={cargando}>
            {cargando ? 'Ingresando…' : 'Ingresar'}
          </Boton>
        </form>

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
