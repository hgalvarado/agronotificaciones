/**
 * AgroMétricas sin señal: lo guardado va primero al teléfono (localStorage, por usuario) y se envía cuando hay
 * conexión. Cada registro lleva su UUID: reenviar no duplica (sql/109 es idempotente). Lo que la base rechaza por una
 * razón que no se arregla reintentando (permiso, dato inválido) pasa a «rechazados» con el mensaje, para que la
 * persona lo vea; nunca se pierde en silencio.
 */

import { createClient } from '@/lib/supabase/client'

export type Pendiente = { id: string; tipo: 'parametros' | 'clima'; datos: Record<string, unknown>; resumen: string }
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
function escribir(clave: string, valor: unknown) {
  try { localStorage.setItem(clave, JSON.stringify(valor)) } catch { /* sin espacio: la pantalla avisa al no ver el registro */ }
}

export const pendientes = (usuario: string) => leer<Pendiente[]>(k(usuario, 'cola'), [])
export const rechazados = (usuario: string) => leer<Rechazado[]>(k(usuario, 'rechazados'), [])
export const datosGuardados = <T,>(usuario: string) => leer<T | null>(k(usuario, 'datos'), null)
export const guardarDatos = (usuario: string, datos: unknown) => escribir(k(usuario, 'datos'), datos)

/** Agrega (o reemplaza, mismo id) un registro a la cola del teléfono. */
export function encolar(usuario: string, p: Pendiente) {
  escribir(k(usuario, 'cola'), [...pendientes(usuario).filter((x) => x.id !== p.id), p])
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
      const funcion = p.tipo === 'parametros' ? 'fn_agm_guardar_parametros' : 'fn_agm_guardar_clima'
      let error: { code?: string; message: string } | null = null
      try {
        ;({ error } = await supabase.rpc(funcion, { p: p.datos }))
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
