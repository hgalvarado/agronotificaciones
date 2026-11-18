'use client'

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'

/**
 * Cuántos registros tiene cada catálogo. Los trae la página de Catálogos y
 * los pinta el árbol del riel, que vive en el layout: por eso un contexto
 * que envuelve a los dos. Fuera de esa página el árbol sigue mostrando lo
 * último que se supo.
 */
type Valor = { conteos: Record<string, number>; registrar: (c: Record<string, number>) => void }

const Ctx = createContext<Valor>({ conteos: {}, registrar: () => {} })

export function ContextoAdmin({ children }: { children: ReactNode }) {
  const [conteos, setConteos] = useState<Record<string, number>>({})
  const registrar = useCallback((nuevos: Record<string, number>) => {
    setConteos((prev) => {
      const claves = Object.keys(nuevos)
      if (claves.every((k) => prev[k] === nuevos[k])) return prev
      return { ...prev, ...nuevos }
    })
  }, [])
  const valor = useMemo(() => ({ conteos, registrar }), [conteos, registrar])
  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>
}

export const useConteosAdmin = () => useContext(Ctx)
