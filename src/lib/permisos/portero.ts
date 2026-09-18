import 'server-only'

/**
 * El portero de las rutas de API.
 *
 * Las rutas que usan la llave de servicio se saltan RLS por completo, así
 * que aquí no hay red de seguridad debajo: lo que este archivo deje pasar,
 * pasa. Por eso comprueba contra la BASE con la sesión del usuario —nunca
 * contra nada que venga en el request— y por eso vive aparte de las
 * rutas: una sola puerta, y no una comprobación copiada en cada handler
 * con un matiz distinto.
 *
 * Y comprueba la MATRIZ, no el nombre del rol. Antes decía
 * `rol?.codigo !== 'ADMIN'`, y era lo mismo que pasaba en las policies:
 * la pantalla de Permisos decía una cosa y el backend otra. El
 * Administrador sigue pasando porque `fn_mis_permisos` le concede todo,
 * no porque se llame así.
 */

import { NextResponse } from 'next/server'
import { getPerfilActual, getPermisos, puede } from '@/lib/auth'

export type Portero = {
  /** La respuesta 403 ya armada, o `null` si puede pasar. */
  denegado: NextResponse | null
  /** El id de quien llama, para las reglas que necesitan saberlo. */
  yo: string | null
}

/**
 * Exige una acción de una pantalla.
 *
 * `pantalla` y `accion` son las mismas que la matriz de Permisos escribe,
 * así que marcar la casilla es lo único que hace falta para conceder.
 */
export async function exigirPermiso(pantalla: string, accion: string): Promise<Portero> {
  const [{ perfil }, permisos] = await Promise.all([getPerfilActual(), getPermisos()])

  if (!perfil || !perfil.activo) {
    return {
      denegado: NextResponse.json(
        { error: 'Tu cuenta no está activa. Comunícate con quien administra el sistema.' },
        { status: 403 }
      ),
      yo: null,
    }
  }

  if (!puede(permisos, pantalla, accion)) {
    return {
      denegado: NextResponse.json(
        {
          error: `Tu rol no tiene «${accion}» en la pantalla de ${pantalla}. Se configura en Permisos.`,
        },
        { status: 403 }
      ),
      yo: perfil.id,
    }
  }

  return { denegado: null, yo: perfil.id }
}
