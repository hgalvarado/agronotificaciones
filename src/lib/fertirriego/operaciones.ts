/**
 * Arma un registro del campo (el «sobre») con su identificador hecho en el teléfono.
 * Puro salvo por el reloj y el identificador aleatorio.
 */

import { ahoraIso } from '@/lib/fechas/zona'
import type { Operacion, TipoOperacion, Ubicacion } from './tipos'

export function nuevoId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  // Navegadores viejos: UUID v4 con getRandomValues
  const b = crypto.getRandomValues(new Uint8Array(16))
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

function dispositivo(): string {
  if (typeof navigator === 'undefined') return 'desconocido'
  const ua = navigator.userAgent
  const so = /Android [\d.]+/.exec(ua)?.[0] ?? /iPhone OS [\d_]+/.exec(ua)?.[0] ?? /Windows NT [\d.]+/.exec(ua)?.[0] ?? 'otro'
  return `${so} · ${navigator.language}`.slice(0, 200)
}

export function crearOperacion(
  tipo: TipoOperacion,
  datos: Record<string, unknown>,
  opciones: { ubicacion: Ubicacion | null; enNombreDe?: string | null; resumen: string; id?: string }
): Operacion {
  return {
    id: opciones.id ?? nuevoId(),
    tipo,
    creado_en: ahoraIso(),
    dispositivo: dispositivo(),
    ubicacion: opciones.ubicacion,
    en_nombre_de: opciones.enNombreDe ?? null,
    datos,
    estado_local: 'PENDIENTE',
    intentos: 0,
    resumen: opciones.resumen,
  }
}

/** Observaciones que se muestran: «sin ubicación» no se enseña (pedido del usuario 2026-11-22; la base la sigue guardando). */
export function observacionesVisibles(lista: string[] | null | undefined): string[] {
  return (lista ?? []).filter((o) => o !== 'SIN_UBICACION')
}

export const NOMBRE_OBSERVACION: Record<string, string> = {
  RELOJ: 'hora del teléfono distinta',
  FUERA_DE_CUSTODIA: 'la estación no estaba a su cargo',
  SALDO_NEGATIVO: 'dejó el saldo en negativo',
  FUERA_DE_PLAN: 'producto fuera del plan',
  OTRA_ESTACION: 'turno de otra estación',
  DIFERENCIA_RELEVO: 'diferencia en el relevo',
  DIFERENCIA_TRASLADO: 'llegó menos de lo enviado',
  CUSTODIA_POSTERIOR: 'el jefe asignó la estación después',
  DDT_SIN_PLAN: 'el DDT elegido no está en el plan',
  POSIBLE_DUPLICADO: 'posible duplicado (ya había una aplicación igual ese día)',
  HOROMETRO_NO_CONTINUA: 'el horómetro inicial no continuaba el registro anterior',
  VISOR_NO_CONTINUA: 'el visor inicial no coincidía con el final anterior',
  VISOR_SUBE_SIN_RECEPCION: 'el visor subió y no había diésel recibido',
  CONSUMO_SIN_HORAS: 'gastó diésel sin horas de trabajo',
  SIN_REGISTRO_PREVIO: 'primer registro del motor',
  FUERA_DE_ORDEN: 'registro de un día anterior a otros ya hechos',
  MOTOR_NO_ASIGNADO_EN_FECHA: 'el motor no estaba asignado a la estación en esa fecha (registro histórico)',
  MOTOR_EN_TALLER_EN_FECHA: 'el motor estaba en el taller en esa fecha',
  MOTOR_RETIRADO_EN_FECHA: 'el motor estaba retirado en esa fecha',
  ACEPTADO_POR_ADMIN: 'lo aceptó el administrador aunque la base lo había rechazado',
  REGISTRO_HISTORICO: 'registro histórico (no movió el inventario ni el diésel)',
}
