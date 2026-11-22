/**
 * AgroMétricas sin señal: lo guardado va primero al teléfono (IndexedDB, por usuario; ver almacen.ts) y se envía
 * cuando hay conexión. Cada registro lleva su UUID: reenviar no duplica (sql/109 es idempotente). Un registro NO
 * sale de la cola hasta que la base confirma o lo rechaza por una razón que no se arregla reintentando (permiso,
 * dato inválido): entonces pasa a «rechazados» con el mensaje, para que la persona lo vea; nunca se pierde en silencio.
 * Las fotos de calicata se guardan como Blob aparte (no como texto dentro de la cola).
 */

import { createClient } from '@/lib/supabase/client'
import * as Almacen from './almacen'
import { agregarPorId, blobADataUrl, dataUrlABlob, procesarCola, type Pendiente, type Rechazado } from './colaPura'
import { podar, type EntradaHistorial } from './historialPura'

export type { Pendiente, Rechazado }

const FUNCIONES = { parametros: 'fn_agm_guardar_parametros', clima: 'fn_agm_guardar_clima', calicata: 'fn_agm_guardar_calicata' } as const

const ordenados = (l: Pendiente[]) => [...l].sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0))

export const pendientes = async (usuario: string) => ordenados(await Almacen.leerTodo<Pendiente>(usuario, 'cola'))
export const rechazados = (usuario: string) => Almacen.leerTodo<Rechazado>(usuario, 'rechazados')
export const datosGuardados = <T,>(usuario: string) => Almacen.leerDato<T>(usuario, 'turnos')
export const ultimoEnvio = (usuario: string) => Almacen.leerDato<string>(usuario, 'ultimo_envio')

export async function guardarDatos(usuario: string, datos: unknown): Promise<boolean> {
  try { await Almacen.guardarDato(usuario, 'turnos', datos); return true } catch { return false }
}

/**
 * Agrega (o reemplaza, mismo id) un registro a la cola del teléfono, con su foto (data URL comprimida) si trae.
 * -> true solo cuando el navegador confirmó la escritura.
 */
export async function encolar(usuario: string, p: Omit<Pendiente, 'tieneFoto' | 'orden' | 'creado_en'>, fotoDataUrl?: string | null): Promise<boolean> {
  try {
    const foto = fotoDataUrl ? dataUrlABlob(fotoDataUrl) : null
    if (fotoDataUrl && !foto) return false
    const actuales = await Almacen.leerTodo<Pendiente>(usuario, 'cola')
    const lista = agregarPorId(actuales, { ...p, tieneFoto: foto ? true : undefined })
    const nuevo = lista.find((x) => x.id === p.id)!
    nuevo.creado_en ??= new Date().toISOString()
    await Almacen.guardarPendiente(usuario, nuevo, foto)
    return true
  } catch {
    return false   // sin espacio o sin IndexedDB
  }
}

/** Lo que la base confirmó desde este teléfono (resumen en texto), ya podado. Nunca lanza: sin almacén, lista vacía. */
export async function historial(usuario: string): Promise<EntradaHistorial[]> {
  try {
    const todo = await Almacen.leerTodo<EntradaHistorial>(usuario, 'historial')
    const { conservar, quitar } = podar(todo, Date.now())
    if (quitar.length) Almacen.quitarHistorial(usuario, quitar).catch(() => {})
    return conservar
  } catch {
    return []
  }
}

/** Guarda el resumen de un registro confirmado y poda (14 días / 200). Mejor esfuerzo. */
async function registrarConfirmado(usuario: string, p: Pendiente): Promise<void> {
  if (!p.vista) return   // registros viejos de la cola: no hay resumen que guardar
  const ahora = new Date().toISOString()
  await Almacen.guardarHistorial(usuario, { id: p.id, tipo: p.tipo, vista: p.vista, creado_en: p.creado_en ?? ahora, enviado_en: ahora } satisfies EntradaHistorial)
  await historial(usuario)   // poda
}

export async function descartarRechazado(usuario: string, id: string): Promise<void> {
  await Almacen.quitarRechazado(usuario, id)
}

/** Respaldo en texto (JSON) de lo que está en cola y de lo rechazado, con las fotos incluidas. */
export async function exportarPendientes(usuario: string): Promise<string> {
  const [cola, rech] = await Promise.all([pendientes(usuario), rechazados(usuario)])
  const conFotos = await Promise.all(cola.map(async (p) => {
    const blob = p.tieneFoto ? await Almacen.leerFoto(usuario, p.id) : null
    return { ...p, foto: blob ? await blobADataUrl(blob) : undefined }
  }))
  return JSON.stringify({ exportado_en: new Date().toISOString(), usuario, pendientes: conFotos, rechazados: rech }, null, 2)
}

/** Pide almacenamiento persistente (el navegador no borra los datos por falta de espacio). null = no disponible. */
export async function pedirPersistente(): Promise<boolean | null> {
  try {
    if (!navigator.storage?.persist) return null
    if (await navigator.storage.persisted?.()) return true
    return await navigator.storage.persist()
  } catch {
    return null
  }
}

let enviando: Promise<number> | null = null

/** Envía la cola en orden. Se detiene al primer error de red (se reintenta luego). -> cuántos se enviaron */
export function enviar(usuario: string): Promise<number> {
  enviando ??= (async () => {
    const supabase = createClient()
    const lista = await pendientes(usuario)
    const n = await procesarCola(lista, {
      subirFoto: async (p) => {
        // Misma ruta para el mismo registro: reintentar no duplica
        const ruta = `calicatas/${p.datos.turno_ciclo_id}/${p.datos.fecha}_${p.id}.jpg`
        const blob = await Almacen.leerFoto(usuario, p.id)
        if (!blob) throw Object.assign(new Error('La foto ya no está en el teléfono.'), { status: 400 })
        const { error } = await supabase.storage.from('agrometricas').upload(ruta, blob, { upsert: true, contentType: 'image/jpeg' })
        if (error) throw error
        return ruta
      },
      guardar: async (p, datos) => {
        const { error } = await supabase.rpc(FUNCIONES[p.tipo], { p: datos })
        return error
      },
      quitar: (id) => Almacen.quitarPendiente(usuario, id),
      rechazar: (r) => Almacen.guardarRechazado(usuario, r),
      quitarFoto: (id) => Almacen.quitarFoto(usuario, id),
      confirmado: (p) => registrarConfirmado(usuario, p),
    })
    if (n) await Almacen.guardarDato(usuario, 'ultimo_envio', new Date().toISOString())
    return n
  })().catch(() => 0).finally(() => { enviando = null })
  return enviando
}
