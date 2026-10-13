/**
 * ¿Falta la migración, o es otra cosa?
 *
 * ── Por qué existe ──────────────────────────────────────────────────
 *
 * Cada módulo tiene un aviso amarillo del estilo «corre las migraciones
 * 59 y 60». Hasta ahora lo encendía CUALQUIER error de lectura:
 *
 *     if (error) { onSinMigracion(true); return }
 *
 * Y eso es un diagnóstico inventado. Un permiso que falta, una vista a
 * la que no se le concedió `select`, la caché de esquema de PostgREST
 * sin recargar, la red caída —todos acababan diciendo lo mismo: «no está
 * instalado». El usuario corría unas migraciones que ya tenía puestas,
 * no pasaba nada, y la pantalla seguía amarilla sin una sola pista.
 *
 * Aquí se separa lo uno de lo otro. **Sólo falta la migración cuando la
 * base dice que la relación o la columna no existen.** Todo lo demás es
 * un error que hay que ENSEÑAR, con su texto, para que se pueda
 * arreglar.
 *
 * ── Los códigos ─────────────────────────────────────────────────────
 *
 *   · `42P01` · Postgres: la tabla o la vista no existe.
 *   · `42703` · Postgres: la columna no existe.
 *   · `42883` · Postgres: la función no existe —una RPC sin migrar—.
 *   · `PGRST202` · PostgREST no encuentra la función en su caché.
 *   · `PGRST204` · PostgREST no encuentra la columna en su caché.
 *   · `PGRST205` · PostgREST no encuentra la tabla en su caché.
 *
 * Los tres de PostgREST llevan trampa: también salen cuando la relación
 * **sí existe** pero la caché de esquema no se ha recargado todavía. Por
 * eso el aviso que se enseña en ese caso dice las dos cosas, y no sólo
 * «corre la migración».
 */

import { mensajeDeError } from '@/lib/errores'

export type ErrorDeLectura = {
  message?: string | null
  code?: string | null
}

/** Los códigos que de verdad significan «esto no está en la base». */
const SIN_MIGRAR = new Set([
  '42P01',
  '42703',
  '42883',
  'PGRST202',
  'PGRST204',
  'PGRST205',
])

/** Los que vienen de la caché de PostgREST y pueden ser un falso positivo. */
const SOLO_CACHE = new Set(['PGRST202', 'PGRST204', 'PGRST205'])

/**
 * ¿Este error significa que falta una migración?
 *
 * Sin código —una red caída, un `fetch` abortado— la respuesta es NO: un
 * módulo instalado no deja de estarlo porque se cayera el wifi, y
 * encender el aviso de instalación ahí manda a la persona a ejecutar SQL
 * que no necesita.
 */
export function faltaLaMigracion(e: ErrorDeLectura | string | null | undefined): boolean {
  if (!e) return false
  if (typeof e === 'string') {
    // Respaldo para quien sólo conserva el texto. PostgREST escribe
    // «relation "x" does not exist» y «Could not find the table ... in
    // the schema cache».
    return /does not exist|schema cache/i.test(e)
  }
  if (e.code && SIN_MIGRAR.has(e.code)) return true
  return faltaLaMigracion(e.message ?? '')
}

/**
 * El aviso que se enseña, con la causa dicha.
 *
 * @param aviso   El texto del módulo («corre las migraciones 59 y 60…»).
 * @param e       Lo que devolvió la base.
 */
export function avisoDeInstalacion(aviso: string, e: ErrorDeLectura | string | null): string {
  const codigo = typeof e === 'object' && e ? (e.code ?? '') : ''
  if (SOLO_CACHE.has(codigo)) {
    return (
      `${aviso} Si ya las corriste, la base todavía no ha recargado su catálogo: ` +
      `ejecuta «notify pgrst, 'reload schema';» en el SQL Editor y vuelve a entrar.`
    )
  }
  return aviso
}

/**
 * El veredicto completo de una lectura que falló.
 *
 * Existe para que las seis pantallas del módulo no repitan —y por tanto
 * no puedan divergir en— la misma decisión de tres líneas. Devuelve las
 * dos cosas que la pantalla necesita, y **sólo una de ellas viene
 * llena**:
 *
 *   · `avisoModulo` · el amarillo de «falta instalar», que tapa el
 *     módulo entero porque sin las tablas no hay nada que enseñar.
 *   · `mensaje` · cualquier otro fallo, con el texto de la base. El
 *     módulo sigue utilizable: que un tablero no cargue no es razón
 *     para esconder la captura.
 */
export function diagnosticarLectura(
  aviso: string,
  e: ErrorDeLectura | string | null
): { falta: boolean; avisoModulo: string | null; mensaje: string | null } {
  const falta = faltaLaMigracion(e)
  return {
    falta,
    avisoModulo: falta ? avisoDeInstalacion(aviso, e) : null,
    mensaje: falta ? null : mensajeDeError(e, 'No se pudo leer de la base.'),
  }
}
