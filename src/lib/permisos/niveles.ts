/**
 * Niveles rápidos y nombres del alcance para la pantalla de Permisos (migración 92).
 *
 * Un módulo nuevo (combustible, parámetros de campo…) solo declara en la base sus acciones con su
 * `nivel` y, si quiere, cómo se llama el alcance en su mundo («Sus estaciones»). Esta lógica no sabe de
 * ningún módulo en particular: por eso escala.
 *
 * Puro: ni React ni Supabase.
 */

import type { Alcance, ConfigPermiso } from './abac'

/** 0 = sin acceso. 1 Ver · 2 Operar · 3 Supervisar · 4 Administrar (columna `acciones.nivel`). */
export type Nivel = 0 | 1 | 2 | 3 | 4

export const NIVELES: { valor: Nivel; nombre: string; detalle: string }[] = [
  { valor: 0, nombre: 'Sin acceso', detalle: 'No ve la pantalla.' },
  { valor: 1, nombre: 'Ver', detalle: 'Consulta y exporta.' },
  { valor: 2, nombre: 'Operar', detalle: 'Además registra y corrige su trabajo.' },
  { valor: 3, nombre: 'Supervisar', detalle: 'Además aprueba, anula, elimina o registra por otros.' },
  { valor: 4, nombre: 'Todo', detalle: 'Además administra y configura.' },
]

export type AccionNivel = { codigo: string; nivel?: number | null }

export function nivelDeAccion(a: AccionNivel): Nivel {
  const n = Number(a.nivel ?? (a.codigo === 'ver' || a.codigo === 'exportar' ? 1 : 2))
  return (n >= 1 && n <= 4 ? n : 2) as Nivel
}

/** Los niveles que tienen sentido en una pantalla (no se ofrece «Todo» si no hay nada de nivel 4). */
export function nivelesDisponibles(acciones: AccionNivel[]): Nivel[] {
  const max = Math.max(1, ...acciones.map(nivelDeAccion))
  return NIVELES.map((n) => n.valor).filter((v) => v <= max)
}

/** Qué acciones quedan encendidas con un nivel. */
export function accionesDelNivel(acciones: AccionNivel[], nivel: Nivel): Set<string> {
  return new Set(acciones.filter((a) => nivel > 0 && nivelDeAccion(a) <= nivel).map((a) => a.codigo))
}

/**
 * El nivel que describe exactamente lo encendido, o `null` si es una combinación a la medida
 * (p. ej. puede eliminar pero no exportar). La pantalla lo muestra como «A la medida».
 */
export function nivelActual(acciones: AccionNivel[], encendidas: Set<string>): Nivel | null {
  for (const n of nivelesDisponibles(acciones)) {
    const esperado = accionesDelNivel(acciones, n)
    if (esperado.size === encendidas.size && [...esperado].every((c) => encendidas.has(c))) return n
  }
  return null
}

/* ------------------------------ Alcance ------------------------------ */

const NOMBRE_ALCANCE: Record<Alcance, string> = {
  global: 'Todo',
  zonal: 'Sus zonas',
  propietario: 'Solo lo suyo',
}

const DETALLE_ALCANCE: Record<Alcance, string> = {
  global: 'Sin recorte: toda la empresa.',
  zonal: 'Lo de las zonas que tenga asignadas (o todas, si en Usuarios tiene «Todas las zonas»), más lo que registró.',
  propietario: 'Únicamente lo que registró él (o, en módulos por estación, sus estaciones asignadas).',
}

export const ORDEN_ALCANCES: Alcance[] = ['propietario', 'zonal', 'global']

/** Cómo se llama el alcance en esta pantalla: `pantallas.etiquetas_alcance` o el nombre de siempre. */
export function nombreAlcance(
  alcance: Alcance,
  etiquetas?: Partial<Record<Alcance, string>> | null
): string {
  return etiquetas?.[alcance] || NOMBRE_ALCANCE[alcance]
}

export function detalleAlcance(alcance: Alcance): string {
  return DETALLE_ALCANCE[alcance]
}

/** El alcance que manda en una pantalla: el más común entre lo encendido (o global si no hay nada). */
export function alcanceDominante(configs: ConfigPermiso[]): Alcance {
  const encendidas = configs.filter((c) => c.permitido)
  if (encendidas.length === 0) return 'global'
  const cuenta = new Map<Alcance, number>()
  for (const c of encendidas) cuenta.set(c.alcance, (cuenta.get(c.alcance) ?? 0) + 1)
  return [...cuenta.entries()].sort((a, b) => b[1] - a[1])[0][0]
}

/** ¿Hay acciones encendidas con alcances distintos? Entonces el selector del módulo dice «Mixto». */
export function alcanceMixto(configs: ConfigPermiso[]): boolean {
  return new Set(configs.filter((c) => c.permitido).map((c) => c.alcance)).size > 1
}
