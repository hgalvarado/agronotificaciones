'use client'

/**
 * El formulario de entrada. Sólo eso.
 *
 * Hotfix de emergencia (2026-10-27): entrar es `signInWithPassword` y,
 * si sale bien, `window.location.href = '/'`. Una carga COMPLETA del
 * navegador: la primera petición HTTP ya lleva las cookies que Supabase
 * acaba de escribir. Nada de `router.push`/`replace`/`refresh` —su fetch
 * `?_rsc=` es el que llegaba al middleware y rebotaba—, ni esperas, ni
 * limpiezas previas: si algo falla, el botón se libera y se dice por qué.
 *
 * La página que lo envuelve es de servidor y le pasa si se llegó por
 * sesión expirada, sólo para el aviso.
 */

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Alerta, Boton, Campo, Entrada } from '@/components/ui/Primitivos'

export function FormularioLogin({ sesionExpirada = false }: { sesionExpirada?: boolean }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [cargando, setCargando] = useState(false)
  // El aviso de sesión expirada se va en cuanto el usuario escribe.
  const [avisoVisible, setAvisoVisible] = useState(sesionExpirada)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (cargando) return
    setError(null)
    setCargando(true)

    try {
      const { error: authError } = await createClient().auth.signInWithPassword({
        email: email.trim(),
        password,
      })
      if (authError) {
        setCargando(false)
        setError(
          authError.code === 'invalid_credentials' || authError.status === 400
            ? 'Usuario o contraseña incorrectos.'
            : `No se pudo entrar: ${authError.message}`
        )
        return
      }
      // Carga completa a propósito (ver cabecera): el fetch `?_rsc=` de la
      // navegación de Next es justo lo que fallaba. `cargando` se queda en
      // true: la página se va.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.href = '/'
    } catch (err) {
      setCargando(false)
      setError(
        `No se pudo entrar: ${err instanceof Error ? err.message : 'error de red'}. Revisa la conexión.`
      )
    }
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
