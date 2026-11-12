/**
 * Almacén del teléfono para Fertirriego (IndexedDB, sin librerías: la red corporativa complica instalar paquetes).
 *
 * Una base por persona (`agn-fertirriego-<usuario>`): si dos personas usan el mismo teléfono, no se mezclan sus
 * registros pendientes. Dos almacenes:
 *   - `kv`   : el último estado descargado del servidor y la hora de la última sincronización.
 *   - `cola` : los registros hechos en el teléfono (pendientes, rechazados). Llave = id del registro (UUID).
 */

import type { EstadoCampo, Operacion } from './tipos'

const VERSION = 1

function abrir(usuarioId: string): Promise<IDBDatabase> {
  return new Promise((resolver, rechazar) => {
    const solicitud = indexedDB.open(`agn-fertirriego-${usuarioId}`, VERSION)
    solicitud.onupgradeneeded = () => {
      const db = solicitud.result
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv')
      if (!db.objectStoreNames.contains('cola')) db.createObjectStore('cola', { keyPath: 'id' })
    }
    solicitud.onsuccess = () => resolver(solicitud.result)
    solicitud.onerror = () => rechazar(solicitud.error)
  })
}

function enTransaccion<T>(
  db: IDBDatabase,
  almacen: 'kv' | 'cola',
  modo: IDBTransactionMode,
  accion: (s: IDBObjectStore) => IDBRequest<T> | void
): Promise<T | undefined> {
  return new Promise((resolver, rechazar) => {
    const tx = db.transaction(almacen, modo)
    const req = accion(tx.objectStore(almacen))
    tx.oncomplete = () => resolver(req ? (req as IDBRequest<T>).result : undefined)
    tx.onerror = () => rechazar(tx.error)
    tx.onabort = () => rechazar(tx.error)
  })
}

export class AlmacenLocal {
  private constructor(private db: IDBDatabase) {}

  static async abrir(usuarioId: string): Promise<AlmacenLocal> {
    return new AlmacenLocal(await abrir(usuarioId))
  }

  async leerEstado(): Promise<{ estado: EstadoCampo | null; sincronizadoEn: string | null }> {
    const [estado, sincronizadoEn] = await Promise.all([
      enTransaccion<EstadoCampo>(this.db, 'kv', 'readonly', (s) => s.get('estado')),
      enTransaccion<string>(this.db, 'kv', 'readonly', (s) => s.get('sincronizado_en')),
    ])
    return { estado: estado ?? null, sincronizadoEn: sincronizadoEn ?? null }
  }

  async guardarEstado(estado: EstadoCampo, sincronizadoEn: string): Promise<void> {
    await enTransaccion(this.db, 'kv', 'readwrite', (s) => {
      s.put(estado, 'estado')
      s.put(sincronizadoEn, 'sincronizado_en')
    })
  }

  async leerPreferencia<T>(clave: string): Promise<T | null> {
    return ((await enTransaccion<T>(this.db, 'kv', 'readonly', (s) => s.get(`pref:${clave}`))) ?? null) as T | null
  }

  async guardarPreferencia<T>(clave: string, valor: T): Promise<void> {
    await enTransaccion(this.db, 'kv', 'readwrite', (s) => s.put(valor, `pref:${clave}`))
  }

  /** La cola en el orden en que se registró (el orden importa: un chofer nuevo va antes que su recepción). */
  async listarCola(): Promise<Operacion[]> {
    const todas = (await enTransaccion<Operacion[]>(this.db, 'cola', 'readonly', (s) => s.getAll())) ?? []
    return todas.sort((a, b) => a.creado_en.localeCompare(b.creado_en))
  }

  async guardarOperacion(op: Operacion): Promise<void> {
    await enTransaccion(this.db, 'cola', 'readwrite', (s) => s.put(op))
  }

  async borrarOperacion(id: string): Promise<void> {
    await enTransaccion(this.db, 'cola', 'readwrite', (s) => s.delete(id))
  }
}
