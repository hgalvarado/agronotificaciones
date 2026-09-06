'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export default function LoginPage() {
  const router = useRouter()
  const supabase = createClient()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const { error } = await supabase.auth.signInWithPassword({ email, password })

    setLoading(false)
    if (error) {
      setError('Usuario o contraseña incorrectos.')
      return
    }
    router.push('/tickets')
    router.refresh()
  }

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-slate-50 px-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold text-emerald-800">AgroNotificaciones</h1>
          <p className="mt-1 text-sm text-slate-500">Control operativo de maquinaria agrícola</p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4 rounded-2xl bg-white p-6 shadow-sm">
          <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
            Correo
            <input
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="rounded-lg border border-slate-300 px-3 py-3 text-base"
              required
            />
          </label>

          <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
            Contraseña
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="rounded-lg border border-slate-300 px-3 py-3 text-base"
              required
            />
          </label>

          {error && (
            <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="mt-2 rounded-xl bg-emerald-700 px-4 py-4 text-base font-semibold text-white shadow active:scale-[0.98] disabled:opacity-50"
          >
            {loading ? 'Ingresando…' : 'Ingresar'}
          </button>
        </form>

        <p className="mt-6 text-center text-xs text-slate-400">
          ¿No tienes cuenta? Pídele al Administrador que te dé de alta desde Supabase.
        </p>
      </div>
    </div>
  )
}
