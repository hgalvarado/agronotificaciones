'use client'

/**
 * `useMemoria`: como `useState`, pero lo que el usuario deja puesto se RECUERDA por pantalla y por usuario.
 *
 *   const [rango, setRango, lista] = useMemoria('horometros:rango', mesEnCurso())
 *
 * Seguro con la hidratación (ver `lib/ui/hidratado`): el servidor y la primera pintura del navegador usan el valor
 * inicial —el HTML calza y React no re-pinta la pantalla entera— y lo guardado entra justo después. `lista` avisa
 * cuándo ya se leyó lo guardado: una consulta que depende de un filtro recordado debe esperar a `lista` para no
 * pedir primero el mes en curso y luego el rango recordado (dos consultas por una).
 *
 * El usuario lo da `<MemoriaUsuario>`, que envuelve la aplicación en el layout.
 */

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { useHidratado } from '@/lib/ui/hidratado'
import { guardarMemoria, leerMemoria, olvidarMemoria } from './almacen'

const Usuario = createContext('')

export function MemoriaUsuario({ usuarioId, children }: { usuarioId: string; children: ReactNode }) {
  return <Usuario.Provider value={usuarioId}>{children}</Usuario.Provider>
}

type Fijar<T> = (valor: T | ((previo: T) => T)) => void

export function useMemoria<T>(pantalla: string, inicial: T): [T, Fijar<T>, boolean] {
  const usuario = useContext(Usuario)
  const hidratado = useHidratado()
  // Lo que el usuario cambió en ESTA visita. Mientras no cambie nada, manda lo guardado (o el inicial)
  const [propio, setPropio] = useState<{ valor: T } | null>(null)
  // `pantalla` vacía = sin memoria (se comporta como useState): así un componente compartido la usa solo si se pide
  const recordar = pantalla !== ''
  const guardado = useMemo(
    () => (hidratado && recordar ? leerMemoria<T>(usuario, pantalla) : undefined),
    [hidratado, recordar, usuario, pantalla]
  )
  const valor = propio ? propio.valor : guardado !== undefined ? guardado : inicial

  const fijar = useCallback<Fijar<T>>(
    (nuevo) => {
      setPropio((previo) => {
        const recordado = pantalla ? leerMemoria<T>(usuario, pantalla) : undefined
        const base = previo ? previo.valor : (recordado ?? inicial)
        const siguiente = typeof nuevo === 'function' ? (nuevo as (p: T) => T)(base) : nuevo
        if (pantalla) guardarMemoria(usuario, pantalla, siguiente)
        return { valor: siguiente }
      })
    },
    // `inicial` puede ser un objeto nuevo en cada render: solo importa como respaldo
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [usuario, pantalla]
  )

  return [valor, fijar, hidratado]
}

/** Para «Restablecer»: olvida lo guardado de varias claves de una pantalla. */
export function useOlvidarMemoria() {
  const usuario = useContext(Usuario)
  return useCallback((pantallas: string[]) => pantallas.forEach((p) => olvidarMemoria(usuario, p)), [usuario])
}
