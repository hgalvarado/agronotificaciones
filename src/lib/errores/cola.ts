/**
 * Cola local de la bitácora de errores (pura: recibe el «almacén» como parámetro, así se prueba sin navegador).
 *
 * Nada se pierde: lo que no se puede enviar (sin señal, sin sesión, error del servidor) se queda aquí y se manda al
 * volver. Límites para no llenar el teléfono: 100 elementos (rota los más viejos y menos graves primero), repetidos
 * se suman en un solo elemento (contador).
 */

export type AlmacenSimple = { getItem(k: string): string | null; setItem(k: string, v: string): void }

export type Severidad = 'info' | 'aviso' | 'error' | 'critico'

export type ItemError = {
  tipo: 'error'
  id: string
  huella: string
  /** Persona que tenía la sesión cuando ocurrió (la base guarda a nombre de quien envía: solo se envía con la misma). */
  usuario: string | null
  origen: string
  modulo: string | null
  ruta: string | null
  severidad: Severidad
  codigo: string | null
  mensaje: string
  detalle: Record<string, unknown>
  repeticiones: number
  cuando: string
  ultima: string
}

export type ItemLatido = { tipo: 'latido'; usuario: string | null; [k: string]: unknown }

export const CLAVE_COLA = 'agn-errores-cola-v1'
export const LIMITE_COLA = 100
const PESO: Record<Severidad, number> = { info: 0, aviso: 1, error: 2, critico: 3 }

export function leerCola(almacen: AlmacenSimple): ItemError[] {
  try {
    const crudo = almacen.getItem(CLAVE_COLA)
    const lista = crudo ? JSON.parse(crudo) : []
    return Array.isArray(lista) ? (lista as ItemError[]).filter((x) => x && typeof x.mensaje === 'string') : []
  } catch {
    return []
  }
}

function guardarCola(almacen: AlmacenSimple, cola: ItemError[]): boolean {
  let lista = cola
  // Si el almacenamiento está lleno, se va recortando hasta que quepa (el registrador nunca debe romper nada)
  for (let intento = 0; intento < 4; intento++) {
    try {
      almacen.setItem(CLAVE_COLA, JSON.stringify(lista))
      return true
    } catch {
      lista = lista.slice(Math.ceil(lista.length / 2))
    }
  }
  return false
}

/** Agrega (o suma a un repetido) y rota si pasa del límite. Devuelve la cola resultante. */
export function encolar(almacen: AlmacenSimple, item: Omit<ItemError, 'tipo' | 'repeticiones' | 'ultima'> & { repeticiones?: number; ultima?: string }): ItemError[] {
  const cola = leerCola(almacen)
  const igual = cola.find((x) => x.huella === item.huella && x.usuario === item.usuario)
  if (igual) {
    igual.repeticiones += item.repeticiones ?? 1
    igual.ultima = item.ultima ?? item.cuando
    igual.detalle = item.detalle
    if (PESO[item.severidad] > PESO[igual.severidad]) igual.severidad = item.severidad
  } else {
    cola.push({ ...item, tipo: 'error', repeticiones: item.repeticiones ?? 1, ultima: item.ultima ?? item.cuando })
  }
  if (cola.length > LIMITE_COLA) {
    // Sale primero lo menos grave y, entre iguales, lo más viejo
    cola.sort((a, b) => PESO[b.severidad] - PESO[a.severidad] || b.ultima.localeCompare(a.ultima))
    cola.length = LIMITE_COLA
  }
  guardarCola(almacen, cola)
  return cola
}

/** El siguiente lote a enviar para esta persona (o sin dueño conocido), máximo n. */
export function tomarLote(almacen: AlmacenSimple, usuario: string, n = 50): ItemError[] {
  return leerCola(almacen)
    .filter((x) => x.usuario === usuario || x.usuario === null)
    .slice(0, n)
}

/** Quita de la cola lo ya enviado. */
export function confirmar(almacen: AlmacenSimple, ids: string[]): void {
  const fuera = new Set(ids)
  guardarCola(almacen, leerCola(almacen).filter((x) => !fuera.has(x.id)))
}

/** Espera antes del reintento n (1, 2, 3…): 5 s, 10 s, 20 s… tope 5 min. */
export function esperaMs(intentos: number): number {
  return Math.min(5 * 60_000, 5_000 * 2 ** Math.max(0, intentos - 1))
}

/** Errores que no se arreglan reintentando (el lote se descarta en vez de reintentar para siempre). */
export function esDefinitivo(codigo: string | null | undefined): boolean {
  return codigo === '22P02' || codigo === '22023' || codigo === '23514' || codigo === 'PGRST202'
}

/**
 * Anti-bucle: si el mismo error se reporta más de `max` veces en `ventanaMs`, se ignora (un bucle de renders no debe
 * llenar la cola ni gastar batería).
 */
export function crearLimitador(max = 20, ventanaMs = 60_000) {
  const vistos = new Map<string, number[]>()
  return (huella: string, ahora = Date.now()): boolean => {
    const marcas = (vistos.get(huella) ?? []).filter((m) => ahora - m < ventanaMs)
    if (marcas.length >= max) {
      vistos.set(huella, marcas)
      return false
    }
    marcas.push(ahora)
    vistos.set(huella, marcas)
    return true
  }
}
