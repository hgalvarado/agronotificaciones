/**
 * Avisos push en ESTE teléfono (solo navegador). Sin React: se prueba aparte la parte pura.
 * Estados: 'no_soportado' | 'instalar_ios' | 'bloqueado' | 'inactivo' | 'activo'.
 */

import { createClient } from '@/lib/supabase/client'

export type EstadoPush = 'cargando' | 'no_soportado' | 'instalar_ios' | 'bloqueado' | 'inactivo' | 'activo'

/** Llave pública VAPID (base64url) → bytes, como la pide `pushManager.subscribe`. */
export function llaveABytes(base64: string): Uint8Array<ArrayBuffer> {
  const relleno = '='.repeat((4 - (base64.length % 4)) % 4)
  const b64 = (base64 + relleno).replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(b64)
  const salida = new Uint8Array(new ArrayBuffer(bin.length))
  for (let i = 0; i < bin.length; i++) salida[i] = bin.charCodeAt(i)
  return salida
}

/** iPhone/iPad: el push solo existe con la app instalada en la pantalla de inicio (iOS 16.4 o más). */
export function esIos(ua: string): boolean {
  return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && typeof document !== 'undefined' && 'ontouchend' in document)
}

export function estaInstalada(): boolean {
  if (typeof window === 'undefined') return false
  const nav = window.navigator as Navigator & { standalone?: boolean }
  return window.matchMedia?.('(display-mode: standalone)').matches || nav.standalone === true
}

export async function estadoPushActual(): Promise<EstadoPush> {
  if (typeof window === 'undefined') return 'cargando'
  const tieneApis = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
  if (!tieneApis) return esIos(navigator.userAgent) && !estaInstalada() ? 'instalar_ios' : 'no_soportado'
  if (Notification.permission === 'denied') return 'bloqueado'
  try {
    const reg = await navigator.serviceWorker.getRegistration('/')
    const sub = await reg?.pushManager.getSubscription()
    return sub && Notification.permission === 'granted' ? 'activo' : 'inactivo'
  } catch {
    return 'inactivo'
  }
}

/** Pide permiso, registra el service worker, suscribe y guarda la suscripción en la base. Lanza Error con texto corto. */
export async function activarPush(): Promise<void> {
  const publica = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  if (!publica) throw new Error('Los avisos aún no están configurados en el servidor.')
  const permiso = await Notification.requestPermission()
  if (permiso !== 'granted') throw new Error('No diste permiso. Actívalo en los ajustes del navegador.')
  await navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' })
  const reg = await navigator.serviceWorker.ready
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: llaveABytes(publica) }))
  const j = sub.toJSON()
  const { error } = await createClient().rpc('fn_push_suscribir', {
    p_endpoint: sub.endpoint,
    p_p256dh: j.keys?.p256dh ?? '',
    p_auth: j.keys?.auth ?? '',
    p_user_agent: navigator.userAgent,
  })
  if (error) throw new Error('No se pudo guardar el aviso. Intenta con señal.')
}

export async function desactivarPush(): Promise<void> {
  const reg = await navigator.serviceWorker.getRegistration('/')
  const sub = await reg?.pushManager.getSubscription()
  if (!sub) return
  await createClient().rpc('fn_push_desactivar', { p_endpoint: sub.endpoint })
  await sub.unsubscribe()
}
