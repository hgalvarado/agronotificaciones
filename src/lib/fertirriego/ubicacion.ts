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
    const estado = await navigator.permissions?.query({ name: 'geolocation' as PermissionName })
    return estado?.state === 'denied'
  } catch {
    return false
  }
}

export function obtenerUbicacion(espera = 8000): Promise<ResultadoUbicacion> {
  return new Promise((resolver) => {
    if (!('geolocation' in navigator)) return resolver({ tipo: 'sin_ubicacion' })
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
