/**
 * AgroMétricas · lógica PURA de la cola sin señal (sin IndexedDB, sin Supabase, sin React): migración desde
 * localStorage, cola idempotente por id y el recorrido de envío con las llamadas inyectadas. Así se prueba con
 * `node --test` (pruebas/unit/agrometricas_cola.test.mjs). El almacenamiento real vive en almacen.ts y el
 * pegamento con Supabase en cola.ts.
 */

/** Pantallas de AgroMétricas que el service worker guarda para abrir sin señal (deben estar en RUTAS_CAMPO de public/sw.js). */
import type { Vista } from './historialPura'

export const RUTAS_SIN_SENAL = ['/agrometricas', '/agrometricas/parametros']

export type Pendiente = {
  id: string
  tipo: 'parametros' | 'clima' | 'calicata'
  datos: Record<string, unknown>
  resumen: string
  /** Hay una foto (Blob JPEG) guardada aparte en el almacén `fotos`, con este mismo id. */
  tieneFoto?: boolean
  /** Orden de llegada (el envío respeta el orden en que se registró). */
  orden?: number
  /** Cuándo se guardó en el teléfono (ISO). Opcional: lo viejo no lo trae. */
  creado_en?: string
  /** Resumen corto para «Mis registros» (opcional: lo viejo no lo trae). */
  vista?: Vista
}
export type Rechazado = Pendiente & { mensaje: string }

/** Formato VIEJO de localStorage: la foto iba como data URL dentro del pendiente. */
export type PendienteViejo = Omit<Pendiente, 'tieneFoto' | 'orden'> & { foto?: string }

export type MigracionLocal = {
  cola: Pendiente[]
  rechazados: Rechazado[]
  datos: unknown
  /** Fotos extraídas de la cola vieja (id del pendiente -> Blob). */
  fotos: { id: string; blob: Blob }[]
  /** Claves de localStorage que había (se borran SOLO después de confirmar la escritura en IndexedDB). */
  claves: string[]
}

export const claveLocal = (usuario: string, que: 'cola' | 'rechazados' | 'datos') => `agm_${que}_${usuario}`

function parsear<T>(crudo: string | null, defecto: T): T {
  if (!crudo) return defecto
  try { return JSON.parse(crudo) as T } catch { return defecto }
}

/** data:image/jpeg;base64,XXXX -> Blob. Devuelve null si no es un data URL válido. */
export function dataUrlABlob(dataUrl: string): Blob | null {
  const m = /^data:([^;,]+)?(;base64)?,([\s\S]*)$/.exec(dataUrl ?? '')
  if (!m) return null
  try {
    const tipo = m[1] || 'image/jpeg'
    if (!m[2]) return new Blob([decodeURIComponent(m[3])], { type: tipo })
    const bin = atob(m[3])
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    return new Blob([bytes], { type: tipo })
  } catch {
    return null
  }
}

/** Blob -> data URL (solo para el respaldo «Exportar pendientes»). */
export async function blobADataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return `data:${blob.type || 'image/jpeg'};base64,${btoa(bin)}`
}

/**
 * Convierte lo viejo de localStorage al formato nuevo. `leer(clave)` devuelve el texto crudo o null.
 * Nunca descarta un pendiente: si la foto no se puede decodificar, el pendiente pasa igual (sin foto) y el
 * registro NO se pierde; los ids repetidos se quedan con el último.
 */
export function migrarLocal(usuario: string, leer: (clave: string) => string | null): MigracionLocal {
  const kCola = claveLocal(usuario, 'cola')
  const kRech = claveLocal(usuario, 'rechazados')
  const kDatos = claveLocal(usuario, 'datos')
  const claves = [kCola, kRech, kDatos].filter((k) => leer(k) != null)
  const viejos = parsear<PendienteViejo[]>(leer(kCola), [])
  const fotos: { id: string; blob: Blob }[] = []
  const cola: Pendiente[] = []
  const vistos = new Map<string, number>()
  ;(Array.isArray(viejos) ? viejos : []).forEach((v, i) => {
    if (!v || typeof v.id !== 'string') return
    const { foto, ...resto } = v
    const p: Pendiente = { ...resto, orden: i }
    if (foto) {
      const blob = dataUrlABlob(foto)
      if (blob) { fotos.push({ id: v.id, blob }); p.tieneFoto = true }
    }
    const antes = vistos.get(v.id)
    if (antes != null) { cola[antes] = p } else { vistos.set(v.id, cola.length); cola.push(p) }
  })
  const rech = parsear<(Rechazado & { foto?: string })[]>(leer(kRech), [])
  const rechazados = (Array.isArray(rech) ? rech : []).filter((r) => r && typeof r.id === 'string').map((r) => {
    const { foto: _foto, ...resto } = r
    void _foto
    return resto as Rechazado
  })
  return { cola, rechazados, datos: parsear<unknown>(leer(kDatos), null), fotos, claves }
}

/** Agrega o reemplaza (mismo id) conservando el orden original del que ya estaba. Idempotente. */
export function agregarPorId(lista: Pendiente[], p: Pendiente): Pendiente[] {
  const previo = lista.find((x) => x.id === p.id)
  const siguiente = lista.reduce((m, x) => Math.max(m, x.orden ?? 0), 0) + 1
  const nuevo = { ...p, orden: previo?.orden ?? p.orden ?? siguiente }
  return [...lista.filter((x) => x.id !== p.id), nuevo].sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0))
}

/**
 * Errores que NO se arreglan reintentando: permiso, dato inválido o fuera de tamaño, fecha mal escrita o un
 * mensaje de la propia base. Esos pasan a «rechazados» para no trabar la cola.
 */
export const DEFINITIVOS = ['42501', '22023', '22P02', '23503', '22003', '22007', '22008', 'P0001']
export const esDefinitivo = (codigo?: string | null) => DEFINITIVOS.includes(codigo ?? '')

/** La foto la rechazó Storage (permiso, tamaño, tipo): 4xx que no es de espera. Sin red no hay `status`. */
export function fotoRechazada(e: unknown): boolean {
  const o = e as { status?: number | string; statusCode?: number | string } | null
  const s = Number(o?.status ?? o?.statusCode)
  return s >= 400 && s < 500 && s !== 408 && s !== 429
}

/** Los errores de Postgres que no traen mensaje propio (los de la 109/110 ya vienen en español). */
export const MENSAJES: Record<string, string> = {
  '22003': 'un número es demasiado grande para guardarse. Revisa la lectura.',
  '22P02': 'un dato no es válido. Revisa lo escrito.',
  '22007': 'la fecha no es válida.',
  '22008': 'la fecha no es válida.',
  '23503': 'el turno o la zona ya no existe. Actualiza la pantalla.',
}

export type OperacionesEnvio = {
  /** Sube la foto del pendiente. Lanza si falla. -> ruta en el bucket */
  subirFoto: (p: Pendiente) => Promise<string>
  /** Llama a la función de la base. Lanza solo si NO hubo red. */
  guardar: (p: Pendiente, datos: Record<string, unknown>) => Promise<{ code?: string; message: string } | null>
  /** Quita de la cola (y su foto) SOLO tras confirmar la base o rechazo definitivo. */
  quitar: (id: string) => Promise<void>
  rechazar: (r: Rechazado) => Promise<void>
  quitarFoto?: (id: string) => Promise<void>
  /** Aviso (mejor esfuerzo) de que la base CONFIRMÓ el registro, antes de quitarlo de la cola: alimenta «Mis registros». */
  confirmado?: (p: Pendiente) => Promise<void>
}

/**
 * Envía la cola en orden. Se detiene al primer error de red o de servidor (se reintenta luego); un registro solo
 * sale de la cola cuando la base confirma o la rechaza de forma definitiva. -> cuántos se enviaron
 */
export async function procesarCola(pendientes: Pendiente[], op: OperacionesEnvio): Promise<number> {
  let enviados = 0
  for (const p of pendientes) {
    let datos = p.datos
    if (p.tieneFoto) {
      try {
        datos = { ...p.datos, foto_calicata: await op.subirFoto(p) }
      } catch (e) {
        if (!fotoRechazada(e)) break   // sin red: luego
        // La foto no entra (permiso, tamaño…): los números se guardan igual y la foto queda avisada
        const { tieneFoto: _t, ...sinFoto } = p
        void _t
        await op.rechazar({ ...sinFoto, id: `${p.id}-foto`, resumen: `la foto de ${p.resumen}`, mensaje: (e as Error)?.message || 'la base no aceptó la foto.' })
        await op.quitarFoto?.(p.id)
      }
    }
    let error: { code?: string; message: string } | null
    try {
      error = await op.guardar(p, datos)
    } catch {
      break   // sin red
    }
    if (error && !esDefinitivo(error.code)) break   // red / servidor: luego
    if (error) await op.rechazar({ ...p, mensaje: MENSAJES[error.code ?? ''] ?? error.message })
    else { try { await op.confirmado?.(p) } catch { /* el historial es opcional: nunca frena la cola */ } }
    await op.quitar(p.id)
    if (!error) enviados++
  }
  return enviados
}
