'use client'

/**
 * El formulario de entrada. Sólo eso.
 *
 * La página que lo envuelve es de servidor y es la que lee la dirección
 * —para saber si se llegó aquí porque la sesión expiró—; este componente
 * recibe ese dato ya resuelto. Leerlo desde el navegador obligaría a
 * pintar primero sin el aviso y después con él, que es como se rompe la
 * hidratación.
 */

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Alerta, Boton, Campo, Entrada } from '@/components/ui/Primitivos'

export function FormularioLogin({ sesionExpirada = false }: { sesionExpirada?: boolean }) {
  const router = useRouter()
  const supabase = createClient()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [cargando, setCargando] = useState(false)
  // El aviso de sesión expirada se va en cuanto el usuario escribe: ya lo
  // leyó, y dejarlo mientras teclea parece que el error es de ahora.
  const [avisoVisible, setAvisoVisible] = useState(sesionExpirada)

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
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-4 rounded-2xl border border-slate-200/80 bg-white/90 p-6 shadow-[var(--shadow-float)] backdrop-blur-sm"
    >
      {avisoVisible && !error && (
        <Alerta tono="ambar">
          Tu sesión expiró y se cerró por seguridad. Vuelve a entrar.
        </Alerta>
      )}

      <Campo etiqueta="Correo" requerido>
        <Entrada
          type="email"
          name="email"
          autoComplete="username"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value)
            setAvisoVisible(false)
          }}
          placeholder="tucorreo@agrolibano.com"
          required
        />
      </Campo>

      <Campo etiqueta="Contraseña" requerido>
        <Entrada
          type="password"
          name="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value)
            setAvisoVisible(false)
          }}
          placeholder="••••••••"
          required
        />
      </Campo>

      {error && <Alerta>{error}</Alerta>}

      <Boton type="submit" tamano="lg" className="mt-1 w-full" disabled={cargando}>
        {cargando ? 'Ingresando…' : 'Ingresar'}
      </Boton>
    </form>
  )
}
