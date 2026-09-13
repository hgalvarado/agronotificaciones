/**
 * Reglas de negocio al guardar la configuración del reporte público.
 *
 * El componente de pantalla no valida ni habla con la base: llama aquí y
 * recibe un resultado ya traducido a un mensaje. Ese es todo el trabajo
 * de esta capa —encadenar validación, persistencia y notificación— y por
 * eso cabe en treinta líneas.
 */

'use client'

import { validarConfiguracion, type EntradaConfiguracion } from './validacion'
import { guardarConfiguracionEnBase } from './repositorioConfig'
import { MENSAJES_CONFIG, avisoDeError } from './notificaciones'

export type ResultadoGuardado =
  | { ok: true; mensaje: string }
  | { ok: false; mensaje: string }

export async function guardarConfiguracion(
  entrada: EntradaConfiguracion,
  usuarioId: string | null
): Promise<ResultadoGuardado> {
  const validado = validarConfiguracion(entrada)
  if (!validado.ok) return { ok: false, mensaje: validado.error }

  const { error } = await guardarConfiguracionEnBase(validado.valor, usuarioId)
  if (error) return { ok: false, mensaje: avisoDeError(error) }

  return { ok: true, mensaje: MENSAJES_CONFIG.guardado }
}
