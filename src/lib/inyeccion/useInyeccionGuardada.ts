'use client'

/**
 * Lo último de Inyección que ya bajó este teléfono (el mismo que guarda `useInyeccion`), SOLO de lectura y sin red: sirve
 * para dar el detalle de un movimiento de Inyección en la bitácora de Fertirriego sin hacer otra consulta. Si la persona
 * nunca abrió Inyección en este teléfono, devuelve null y la bitácora muestra lo básico.
 */

import { useEffect, useState } from 'react'
import { AlmacenLocal } from '@/lib/fertirriego/almacenLocal'
import type { EstadoInyeccion } from './estado'

const CLAVE = 'iny_estado'

export function useInyeccionGuardada(usuarioId: string, huella?: unknown): EstadoInyeccion | null {
  const [estado, setEstado] = useState<EstadoInyeccion | null>(null)
  useEffect(() => {
    let vivo = true
    void (async () => {
      try {
        const a = await AlmacenLocal.abrir(usuarioId)
        const guardado = await a.leerPreferencia<EstadoInyeccion>(CLAVE)
        if (vivo && guardado) setEstado(guardado)
      } catch {
        // sin almacén: la bitácora muestra lo básico
      }
    })()
    return () => {
      vivo = false
    }
  }, [usuarioId, huella])
  return estado
}
