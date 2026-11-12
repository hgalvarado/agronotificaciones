/**
 * Ubicación del registro (decisión del usuario: obligatoria).
 *
 * - Permiso DENEGADO: no se deja registrar (se le explica cómo activarlo). Es la parte «obligatoria».
 * - Sin respuesta del GPS a tiempo (bajo techo, sin cielo): se guarda igual y la base lo marca «sin ubicación».
 *   Regla de oro: el trabajo del campo no se pierde por un GPS lento.
 * El GPS funciona sin internet.
 */

import type { Ubicacion } from './tipos'

export type ResultadoUbicacion =
  | { tipo: 'ok'; ubicacion: Ubicacion }
  | { tipo: 'sin_ubicacion' }
  | { tipo: 'denegado' }

export async function permisoDenegado(): Promise<boolean> {
  try {
    // Con límite: algunos navegadores no responden la consulta mientras el permiso está «pendiente»
    const consulta = navigator.permissions?.query({ name: 'geolocation' as PermissionName })
    const estado = await Promise.race([consulta, new Promise<undefined>((r) => setTimeout(() => r(undefined), 2000))])
    return estado?.state === 'denied'
  } catch {
    return false
  }
}

export function obtenerUbicacion(espera = 8000): Promise<ResultadoUbicacion> {
  return new Promise((resolver) => {
    if (!('geolocation' in navigator)) return resolver({ tipo: 'sin_ubicacion' })
    // El «timeout» del GPS no corre mientras el permiso espera respuesta: sin este límite, Guardar se quedaba
    // «Guardando…» para siempre (lo vio la QA 2026-11-12). Pasado el límite se guarda «sin ubicación».
    setTimeout(() => resolver({ tipo: 'sin_ubicacion' }), espera + 2000)
    navigator.geolocation.getCurrentPosition(
      (p) =>
        resolver({
          tipo: 'ok',
          ubicacion: {
            lat: Number(p.coords.latitude.toFixed(6)),
            lon: Number(p.coords.longitude.toFixed(6)),
            precision: Math.round(p.coords.accuracy),
          },
        }),
      (e) => resolver(e.code === e.PERMISSION_DENIED ? { tipo: 'denegado' } : { tipo: 'sin_ubicacion' }),
      { enableHighAccuracy: true, timeout: espera, maximumAge: 60_000 }
    )
  })
}

export const MENSAJE_UBICACION_DENEGADA =
  'Para registrar hay que permitir la ubicación. Actívala en el candado de la barra de direcciones (o en Ajustes → Aplicaciones → navegador → Permisos → Ubicación) y vuelve a intentarlo.'
