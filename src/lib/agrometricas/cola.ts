/**
 * AgroMétricas sin señal: lo guardado va primero al teléfono (localStorage, por usuario) y se envía cuando hay
 * conexión. Cada registro lleva su UUID: reenviar no duplica (sql/109 es idempotente). Lo que la base rechaza por una
 * razón que no se arregla reintentando (permiso, dato inválido) pasa a «rechazados» con el mensaje, para que la
 * persona lo vea; nunca se pierde en silencio.
 */

import { createClient } from '@/lib/supabase/client'

export type Pendiente = {
  id: string
  tipo: 'parametros' | 'clima' | 'calicata'
  datos: Record<string, unknown>
  resumen: string
  /** Foto del día (data URL JPEG comprimida): se sube a Storage antes de enviar el registro. */
  foto?: string
}

const FUNCIONES = { parametros: 'fn_agm_guardar_parametros', clima: 'fn_agm_guardar_clima', calicata: 'fn_agm_guardar_calicata' } as const

/** Sube la foto (misma ruta para el mismo registro: reintentar no duplica). -> ruta en el bucket */
async function subirFoto(supabase: ReturnType<typeof createClient>, p: Pendiente): Promise<string> {
  const ruta = `calicatas/${p.datos.turno_ciclo_id}/${p.datos.fecha}_${p.id}.jpg`
  const archivo = await (await fetch(p.foto!)).blob()
  const { error } = await supabase.storage.from('agrometricas').upload(ruta, archivo, { upsert: true, contentType: 'image/jpeg' })
  if (error) throw error
  return ruta
}
export type Rechazado = Pendiente & { mensaje: string }

const k = (usuario: string, que: string) => `agm_${que}_${usuario}`

function leer<T>(clave: string, defecto: T): T {
  try {
    const v = localStorage.getItem(clave)
    return v ? (JSON.parse(v) as T) : defecto
  } catch {
    return defecto
  }
}
function escribir(clave: string, valor: unknown): boolean {
  try { localStorage.setItem(clave, JSON.stringify(valor)); return true } catch { return false }   // sin espacio
}

export const pendientes = (usuario: string) => leer<Pendiente[]>(k(usuario, 'cola'), [])
export const rechazados = (usuario: string) => leer<Rechazado[]>(k(usuario, 'rechazados'), [])
export const datosGuardados = <T,>(usuario: string) => leer<T | null>(k(usuario, 'datos'), null)
export const guardarDatos = (usuario: string, datos: unknown) => escribir(k(usuario, 'datos'), datos)

/** Agrega (o reemplaza, mismo id) un registro a la cola del teléfono. */
export function encolar(usuario: string, p: Pendiente): boolean {
  return escribir(k(usuario, 'cola'), [...pendientes(usuario).filter((x) => x.id !== p.id), p])
}

export function descartarRechazado(usuario: string, id: string) {
  escribir(k(usuario, 'rechazados'), rechazados(usuario).filter((x) => x.id !== id))
}

let enviando: Promise<number> | null = null

/** Envía la cola en orden. Se detiene al primer error de red (se reintenta luego). -> cuántos se enviaron */
export function enviar(usuario: string): Promise<number> {
  enviando ??= (async () => {
    const supabase = createClient()
    let enviados = 0
    for (const p of pendientes(usuario)) {
      let error: { code?: string; message: string } | null = null
      try {
        const datos = p.foto ? { ...p.datos, foto_calicata: await subirFoto(supabase, p) } : p.datos
        ;({ error } = await supabase.rpc(FUNCIONES[p.tipo], { p: datos }))
      } catch {
        break   // sin red
      }
      if (error && !['42501', '22023', '22P02', '23503'].includes(error.code ?? '')) break   // red / servidor: luego
      escribir(k(usuario, 'cola'), pendientes(usuario).filter((x) => x.id !== p.id))
      if (error) escribir(k(usuario, 'rechazados'), [...rechazados(usuario), { ...p, mensaje: error.message }])
      else enviados++
    }
    return enviados
  })().finally(() => { enviando = null })
  return enviando
}
