/**
 * Frenos de seguridad contra tormentas de consultas (puro, sin React ni red; probado en pruebas/unit/frenos.test.mjs).
 *
 * Motivo (2026-11-22): un bucle de reconsultas llegó a ~11 llamadas/s a fn_tickets_pagina desde teléfonos.
 *  - Intervalo mínimo: dos consultas AUTOMÁTICAS de la misma clave no van más seguidas que `minimoMs`; las que sobran se
 *    juntan en UNA pendiente (`esperar` con los ms que faltan).
 *  - Disyuntor: más de `maxEnVentana` consultas (de cualquier origen) en `ventanaMs` pausan las automáticas `pausaMs`;
 *    `avisar` es true UNA sola vez (para el console.warn).
 * Lo manual («Recargar») y los guardados propios NO se frenan: solo se anotan con `anotar` para que el disyuntor las vea.
 */

export type DecisionFreno =
  | { accion: 'ejecutar' }
  | { accion: 'esperar'; enMs: number }
  | { accion: 'pausado'; enMs: number; avisar: boolean }

export type OpcionesFreno = { minimoMs?: number; ventanaMs?: number; maxEnVentana?: number; pausaMs?: number }

export function crearFreno({ minimoMs = 15_000, ventanaMs = 60_000, maxEnVentana = 6, pausaMs = 120_000 }: OpcionesFreno = {}) {
  let ultimaAuto = Number.NEGATIVE_INFINITY
  let marcas: number[] = []
  let pausadoHasta = 0
  let avisado = false

  function anotar(ahora: number) {
    marcas = marcas.filter((m) => ahora - m < ventanaMs)
    marcas.push(ahora)
    if (marcas.length > maxEnVentana && ahora >= pausadoHasta) {
      pausadoHasta = ahora + pausaMs
      marcas = []
    }
  }

  /** ¿Puede ir ahora una consulta automática? Si `ejecutar`, ya queda anotada. */
  function autorizar(ahora: number): DecisionFreno {
    if (ahora < pausadoHasta) {
      const avisar = !avisado
      avisado = true
      return { accion: 'pausado', enMs: pausadoHasta - ahora, avisar }
    }
    const falta = ultimaAuto + minimoMs - ahora
    if (falta > 0) return { accion: 'esperar', enMs: falta }
    ultimaAuto = ahora
    anotar(ahora)
    // Esta misma anotación pudo abrir el disyuntor: la consulta actual sí va, las siguientes esperan
    return { accion: 'ejecutar' }
  }

  return { anotar, autorizar, enPausa: (ahora: number) => ahora < pausadoHasta }
}

/**
 * Deduplicación de errores enviados al buzón: la misma huella como mucho una vez por `ventanaMs` y un máximo de
 * `maxSesion` envíos por sesión (carga de la página).
 */
export function crearDedupe({ ventanaMs = 60_000, maxSesion = 20 }: { ventanaMs?: number; maxSesion?: number } = {}) {
  const ultimo = new Map<string, number>()
  let total = 0
  return (huella: string, ahora: number): boolean => {
    if (total >= maxSesion) return false
    const antes = ultimo.get(huella)
    if (antes !== undefined && ahora - antes < ventanaMs) return false
    ultimo.set(huella, ahora)
    total++
    return true
  }
}

/**
 * Sondeo periódico compartido (p. ej. la campana de avisos): como mucho una consulta cada `minimoMs`, nunca con la
 * pestaña oculta ni sin red, y el intento se anota ANTES de pedir (un fallo no provoca reintento inmediato).
 */
export function crearSondeo(minimoMs = 120_000) {
  let ultima = Number.NEGATIVE_INFINITY
  return (ahora: number, visible: boolean, enLinea: boolean): boolean => {
    if (!visible || !enLinea) return false
    if (ahora - ultima < minimoMs) return false
    ultima = ahora
    return true
  }
}

/**
 * Caché en memoria con vigencia, por clave (p. ej. el menú de una persona). `invalidar()` la vacía (cambio de
 * usuario o de permisos). Solo para datos de PRESENTACIÓN: los permisos reales nunca se cachean entre peticiones.
 */
export function crearCacheTtl<T>(ttlMs = 60_000) {
  const guardado = new Map<string, { valor: T; hasta: number }>()
  return {
    leer(clave: string, ahora: number): T | undefined {
      const g = guardado.get(clave)
      if (!g) return undefined
      if (ahora >= g.hasta) {
        guardado.delete(clave)
        return undefined
      }
      return g.valor
    },
    guardar(clave: string, valor: T, ahora: number) {
      guardado.set(clave, { valor, hasta: ahora + ttlMs })
    },
    invalidar(clave?: string) {
      if (clave === undefined) guardado.clear()
      else guardado.delete(clave)
    },
  }
}
