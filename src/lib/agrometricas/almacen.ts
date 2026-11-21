/**
 * Almacén del teléfono para AgroMétricas (IndexedDB, sin librerías; mismo enfoque que Fertirriego).
 * En el navegador no hay SQLite nativo: IndexedDB es la base local transaccional que sí existe y aguanta fotos.
 *
 * Una base por persona (`agn-agrometricas-<usuario>`):
 *   - `cola`       : pendientes de enviar (llave = id UUID del registro).
 *   - `rechazados` : lo que la base rechazó de forma definitiva (se ve en pantalla hasta quitarlo).
 *   - `datos`      : clave/valor: catálogo de turnos y rangos (`turnos`) y hora del último envío (`ultimo_envio`).
 *   - `fotos`      : Blob JPEG de la calicata (llave = id del pendiente al que pertenece).
 * Al abrir se migra lo viejo de localStorage; se borra de allí solo tras confirmar la escritura.
 */

import { claveLocal, migrarLocal, type Pendiente, type Rechazado } from './colaPura'

const VERSION = 1
type Almacen = 'cola' | 'rechazados' | 'datos' | 'fotos'

const abiertas = new Map<string, Promise<IDBDatabase>>()

function abrirBase(usuario: string): Promise<IDBDatabase> {
  return new Promise((resolver, rechazar) => {
    const s = indexedDB.open(`agn-agrometricas-${usuario}`, VERSION)
    s.onupgradeneeded = () => {
      const db = s.result
      if (!db.objectStoreNames.contains('cola')) db.createObjectStore('cola', { keyPath: 'id' })
      if (!db.objectStoreNames.contains('rechazados')) db.createObjectStore('rechazados', { keyPath: 'id' })
      if (!db.objectStoreNames.contains('datos')) db.createObjectStore('datos')
      if (!db.objectStoreNames.contains('fotos')) db.createObjectStore('fotos', { keyPath: 'id' })
    }
    s.onsuccess = () => resolver(s.result)
    s.onerror = () => rechazar(s.error)
    s.onblocked = () => rechazar(new Error('IndexedDB bloqueada'))
  })
}

/** Corre varias operaciones en UNA transacción; resuelve cuando el navegador confirma que se escribió. */
function transaccion<T>(db: IDBDatabase, almacenes: Almacen[], modo: IDBTransactionMode, accion: (s: Record<Almacen, IDBObjectStore>) => IDBRequest<T> | void): Promise<T | undefined> {
  return new Promise((resolver, rechazar) => {
    const tx = db.transaction(almacenes, modo)
    const mapa = Object.fromEntries(almacenes.map((a) => [a, tx.objectStore(a)])) as Record<Almacen, IDBObjectStore>
    const req = accion(mapa)
    tx.oncomplete = () => resolver(req ? (req as IDBRequest<T>).result : undefined)
    tx.onerror = () => rechazar(tx.error)
    tx.onabort = () => rechazar(tx.error)
  })
}

/** Pasa lo viejo de localStorage a IndexedDB y lo borra de allí SOLO si ya se leyó de vuelta completo. */
async function migrar(db: IDBDatabase, usuario: string): Promise<void> {
  let m
  try { m = migrarLocal(usuario, (k) => localStorage.getItem(k)) } catch { return }   // sin localStorage: nada que migrar
  if (!m.claves.length) return
  await transaccion(db, ['cola', 'rechazados', 'datos', 'fotos'], 'readwrite', (s) => {
    for (const p of m.cola) s.cola.put(p)
    for (const r of m.rechazados) s.rechazados.put(r)
    for (const f of m.fotos) s.fotos.put(f)
    if (m.datos != null) s.datos.put(m.datos, 'turnos')
  })
  // Confirmar leyendo de vuelta antes de borrar lo viejo
  const [cola, rech, fotos] = await Promise.all([
    transaccion<Pendiente[]>(db, ['cola'], 'readonly', (s) => s.cola.getAll()),
    transaccion<Rechazado[]>(db, ['rechazados'], 'readonly', (s) => s.rechazados.getAll()),
    transaccion<{ id: string }[]>(db, ['fotos'], 'readonly', (s) => s.fotos.getAll()),
  ])
  const ids = new Set((cola ?? []).map((x) => x.id))
  const idsR = new Set((rech ?? []).map((x) => x.id))
  const idsF = new Set((fotos ?? []).map((x) => x.id))
  const completo = m.cola.every((p) => ids.has(p.id)) && m.rechazados.every((r) => idsR.has(r.id)) && m.fotos.every((f) => idsF.has(f.id))
  if (!completo) return   // se reintenta en la próxima apertura; lo viejo sigue en localStorage
  for (const k of [claveLocal(usuario, 'cola'), claveLocal(usuario, 'rechazados'), claveLocal(usuario, 'datos')]) {
    try { localStorage.removeItem(k) } catch { /* nada */ }
  }
}

/** Abre (y migra la primera vez) la base de la persona. Una sola apertura por pestaña. */
export function abrir(usuario: string): Promise<IDBDatabase> {
  let p = abiertas.get(usuario)
  if (!p) {
    p = abrirBase(usuario).then(async (db) => {
      try { await migrar(db, usuario) } catch { /* lo viejo se queda en localStorage; se reintenta luego */ }
      return db
    })
    p.catch(() => abiertas.delete(usuario))
    abiertas.set(usuario, p)
  }
  return p
}

export const leerTodo = async <T,>(usuario: string, almacen: 'cola' | 'rechazados' | 'fotos'): Promise<T[]> =>
  ((await transaccion<T[]>(await abrir(usuario), [almacen], 'readonly', (s) => s[almacen].getAll())) ?? [])

export const leerDato = async <T,>(usuario: string, clave: string): Promise<T | null> =>
  ((await transaccion<T>(await abrir(usuario), ['datos'], 'readonly', (s) => s.datos.get(clave))) ?? null) as T | null

export async function guardarDato(usuario: string, clave: string, valor: unknown): Promise<void> {
  await transaccion(await abrir(usuario), ['datos'], 'readwrite', (s) => s.datos.put(valor, clave))
}

/** Guarda el pendiente y su foto en la MISMA transacción: o entran los dos o ninguno. */
export async function guardarPendiente(usuario: string, p: Pendiente, foto?: Blob | null): Promise<void> {
  await transaccion(await abrir(usuario), ['cola', 'fotos'], 'readwrite', (s) => {
    s.cola.put(p)
    if (foto) s.fotos.put({ id: p.id, blob: foto })
  })
}

export async function leerFoto(usuario: string, id: string): Promise<Blob | null> {
  const f = await transaccion<{ id: string; blob: Blob }>(await abrir(usuario), ['fotos'], 'readonly', (s) => s.fotos.get(id))
  return f?.blob ?? null
}

export async function quitarFoto(usuario: string, id: string): Promise<void> {
  await transaccion(await abrir(usuario), ['fotos'], 'readwrite', (s) => s.fotos.delete(id))
}

/** Quita el pendiente (y su foto) de la cola. Solo se llama cuando la base confirmó o rechazó. */
export async function quitarPendiente(usuario: string, id: string): Promise<void> {
  await transaccion(await abrir(usuario), ['cola', 'fotos'], 'readwrite', (s) => { s.cola.delete(id); s.fotos.delete(id) })
}

export async function guardarRechazado(usuario: string, r: Rechazado): Promise<void> {
  await transaccion(await abrir(usuario), ['rechazados'], 'readwrite', (s) => s.rechazados.put(r))
}

export async function quitarRechazado(usuario: string, id: string): Promise<void> {
  await transaccion(await abrir(usuario), ['rechazados'], 'readwrite', (s) => s.rechazados.delete(id))
}
