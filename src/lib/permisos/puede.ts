/**
 * La pregunta «¿puede?», y nada más.
 *
 * Vive sola, sin importar nada, porque la hacen los dos lados: las
 * páginas del servidor —que además van a leer los permisos— y los
 * componentes de cliente que dibujan o esconden un botón. Estaba dentro
 * de `lib/auth`, que abre el cliente de Supabase del servidor, así que
 * un componente `'use client'` que la importara arrastraba media capa de
 * servidor al navegador y la compilación fallaba.
 *
 * Función pura sobre el conjunto que devuelve `getPermisos()`, con las
 * claves `"pantalla:accion"` que escribe la matriz de Permisos.
 */

/**
 * `__sin_migracion__` es el caso en que `fn_mis_permisos` todavía no
 * existe: se concede todo en vez de dejar a la empresa sin poder
 * trabajar por una migración pendiente. Es deliberadamente permisivo, y
 * la base sigue rechazando lo que no corresponda.
 */
export const SIN_MIGRACION = '__sin_migracion__'

export function puede(
  permisos: Set<string> | string[],
  pantalla: string,
  accion: string
): boolean {
  const set = Array.isArray(permisos) ? new Set(permisos) : permisos
  return set.has(SIN_MIGRACION) || set.has(`${pantalla}:${accion}`)
}
