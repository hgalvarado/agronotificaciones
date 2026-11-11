/**
 * Memoria de pantalla: dónde se guarda lo que el usuario dejó puesto (filtros, rango de fechas, búsqueda, orden)
 * para encontrarlo igual al volver, aunque cambie de pantalla, cierre la pestaña o reinicie el teléfono.
 *
 * Se guarda en el navegador (localStorage), por USUARIO y por pantalla: en un equipo compartido cada quien ve lo
 * suyo, y nada de esto viaja al servidor. Si el almacenamiento está bloqueado (modo privado, cuota llena), la
 * pantalla funciona igual: solo no recuerda.
 *
 * Puro: sin React. El gancho que lo usa vive en `useMemoria`.
 */

const PREFIJO = 'an:memoria:v1'

const llave = (usuario: string, pantalla: string) => `${PREFIJO}:${usuario || 'anonimo'}:${pantalla}`

export function leerMemoria<T>(usuario: string, pantalla: string): T | undefined {
  try {
    const crudo = localStorage.getItem(llave(usuario, pantalla))
    return crudo === null ? undefined : (JSON.parse(crudo) as T)
  } catch {
    return undefined
  }
}

export function guardarMemoria<T>(usuario: string, pantalla: string, valor: T): void {
  try {
    localStorage.setItem(llave(usuario, pantalla), JSON.stringify(valor))
  } catch {
    // Sin almacenamiento: dura mientras la pantalla esté abierta
  }
}

/** Borra lo recordado de una pantalla (botón «Restablecer filtros»). */
export function olvidarMemoria(usuario: string, pantalla: string): void {
  try {
    localStorage.removeItem(llave(usuario, pantalla))
  } catch {
    // nada que borrar
  }
}
