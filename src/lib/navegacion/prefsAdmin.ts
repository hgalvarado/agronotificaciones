'use client'

/**
 * Preferencias del árbol de Administración (grupos abiertos, favoritos y
 * recientes), guardadas en el navegador POR USUARIO.
 *
 * `localStorage` puede faltar o lanzar (ventana privada, datos bloqueados):
 * todo va en try/catch y, si no se puede guardar, se conserva en memoria
 * mientras la pestaña viva. Se lee con `useSyncExternalStore`, así el primer
 * pintado del servidor y el del navegador coinciden (preferencias vacías) y
 * luego se completa sin avisos de hidratación.
 */

import { useCallback, useSyncExternalStore } from 'react'
import { PREFS_VACIAS, normalizarPrefs, type PrefsNav } from './arbolAdmin'

type Guardado = { raw: string | null; val: PrefsNav; soloMemoria: boolean }
const memoria = new Map<string, Guardado>()
const oyentes = new Set<() => void>()

const clavePara = (usuarioId: string) => `agro.admin.nav.v1.${usuarioId}`

function leer(clave: string): PrefsNav {
  let raw: string | null = null
  try {
    raw = localStorage.getItem(clave)
  } catch {
    return memoria.get(clave)?.val ?? PREFS_VACIAS
  }
  const m = memoria.get(clave)
  if (m?.soloMemoria) return m.val
  if (m && m.raw === raw) return m.val
  let val = PREFS_VACIAS
  if (raw) {
    try {
      val = normalizarPrefs(JSON.parse(raw))
    } catch {
      val = PREFS_VACIAS
    }
  }
  memoria.set(clave, { raw, val, soloMemoria: false })
  return val
}

function guardar(clave: string, val: PrefsNav) {
  const raw = JSON.stringify(val)
  let soloMemoria = false
  try {
    localStorage.setItem(clave, raw)
  } catch {
    soloMemoria = true
  }
  memoria.set(clave, { raw, val, soloMemoria })
  oyentes.forEach((f) => f())
}

function suscribir(f: () => void) {
  oyentes.add(f)
  window.addEventListener('storage', f)
  return () => {
    oyentes.delete(f)
    window.removeEventListener('storage', f)
  }
}

export function usePrefsAdmin(usuarioId: string) {
  const clave = clavePara(usuarioId)
  const prefs = useSyncExternalStore(
    suscribir,
    () => leer(clave),
    () => PREFS_VACIAS
  )
  const cambiar = useCallback(
    (f: (p: PrefsNav) => PrefsNav) => {
      const antes = leer(clave)
      const despues = f(antes)
      if (despues !== antes) guardar(clave, despues)
    },
    [clave]
  )
  return { prefs, cambiar }
}
