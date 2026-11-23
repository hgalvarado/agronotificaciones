/**
 * Lo que el teléfono sabe de Motores y combustible (respuesta de fn_mot_estado_campo, sql/130) y las cuentas puras
 * sobre eso. Ni React, ni IndexedDB, ni red. Motor = fila de `equipos` (catálogo existente), estación = `estaciones_riego`,
 * diésel = `materiales`: aquí solo viajan sus ids.
 */

import type { Operacion } from '@/lib/fertirriego/tipos'

export type EstadoMotor = 'SIN_ASIGNAR' | 'EN_ESTACION' | 'TALLER' | 'RETIRADO'

export type TanqueMotor = { id: string; nombre: string; capacidad_gal: number | null; saldo_gal: number }

export type MotorEstacion = {
  equipo_id: string
  codigo: string
  nombre: string
  modelo: string | null
  estado: EstadoMotor
  estacion_id: string | null
  tanque: TanqueMotor | null
  horo_ultimo: number | null
  visor_ultimo: number | null
  fecha_ultimo: string | null
  intervalo_horas: number | null
  aviso_horas: number | null
  horas_desde_mant: number
  horas_para_mant: number | null
}

export type TanqueEstacion = { id: string; nombre: string; estacion_id: string | null; capacidad_gal: number | null; saldo_gal: number }

export type RegistroMotor = {
  id: string
  equipo_id: string
  estacion_id: string
  tanque_id: string
  fecha: string
  horo_ini: number
  horo_fin: number
  horas: number
  visor_ini: number
  visor_fin: number
  recibido_gal: number
  gastado_gal: number
  rendimiento_gal_h: number | null
  rpm: number | null
  horo_cambiado: boolean
  visor_cambiado: boolean
  comentario: string | null
  registrado_por: string | null
  fecha_hora: string
  anulado_at: string | null
  motivo_anulacion: string | null
  observaciones: string[] | null
}

export type RecepcionMotor = {
  id: string
  tanque_id: string
  estacion_id: string
  galones: number
  chofer_id: string | null
  vehiculo_id: string | null
  fecha_hora: string
  comentario: string | null
  registrado_por: string | null
  anulado_at: string | null
  motivo_anulacion: string | null
}

export type MantenimientoMotor = {
  id: string
  equipo_id: string
  estacion_id: string | null
  fecha_hora: string
  horometro: number | null
  tipo: 'PREVENTIVO' | 'CORRECTIVO'
  nota: string | null
  horas_antes: number | null
}

export type AsignacionMotor = {
  id: string
  equipo_id: string
  tipo: 'INSTALADO' | 'TRASLADADO' | 'RETIRADO' | 'AL_TALLER' | 'DE_VUELTA'
  estacion_origen: string | null
  estacion_destino: string | null
  tanque_id: string | null
  fecha_hora: string
  motivo: string
  motivo_codigo: string | null
  destino_saldo: string | null
  destino_devolucion: string | null
  saldo_gal: number | null
  anulado_at: string | null
}

export type EstadoMotores = {
  servidor_en: string
  permisos: { ver: boolean; registrar: boolean; anular: boolean; configurar: boolean }
  material_diesel_id: string | null
  motores: MotorEstacion[]
  tanques_sin_motor: TanqueEstacion[]
  registros: RegistroMotor[]
  recepciones: RecepcionMotor[]
  mantenimientos: MantenimientoMotor[]
  asignaciones: AsignacionMotor[]
}

/** Lo mínimo que se necesita de una operación pendiente (sirve también para las pruebas sin React). */
export type OperacionPendienteMotor = Pick<Operacion, 'id' | 'tipo' | 'estado_local' | 'datos'> & { creado_en?: string }

const num = (v: unknown): number => {
  const n = Number(String(v ?? '').replace(',', '.'))
  return Number.isFinite(n) ? n : 0
}

/** Día (AAAA-MM-DD) en Honduras (UTC-6) de un instante ISO. */
export function diaLocal(iso: string): string {
  const t = Date.parse(iso)
  return Number.isFinite(t) ? new Date(t - 6 * 3600_000).toISOString().slice(0, 10) : iso.slice(0, 10)
}

/**
 * Saldo del tanque contando lo pendiente de enviar: saldo bajado + recepciones pendientes − consumos pendientes.
 * El consumo de un registro pendiente es `gastado_local` (lo calculó el teléfono al guardar) o, si falta, visor inicial − final.
 * No reproduce el ajuste por visor de la base (esa es la verdad al sincronizar); es solo para que el nivel baje sin señal.
 */
export function saldoTanqueLocal(tanqueId: string, estado: EstadoMotores, pendientes: OperacionPendienteMotor[]): number {
  const motor = estado.motores.find((m) => m.tanque?.id === tanqueId)
  const base = motor?.tanque?.saldo_gal ?? estado.tanques_sin_motor.find((t) => t.id === tanqueId)?.saldo_gal ?? 0
  let saldo = base
  for (const op of pendientes) {
    if (op.estado_local !== 'PENDIENTE') continue
    const d = op.datos
    if (op.tipo === 'diesel_recibir' && d.tanque_id === tanqueId) saldo += num(d.galones)
    if (op.tipo === 'motor_registro_diario') {
      const delMotor = estado.motores.find((m) => m.equipo_id === d.equipo_id)
      const tanque = (d.tanque_id as string | undefined) ?? delMotor?.tanque?.id
      if (tanque === tanqueId) saldo -= Math.max(d.gastado_local !== undefined ? num(d.gastado_local) : num(d.visor_ini) - num(d.visor_fin), 0)
    }
  }
  return Math.round(saldo * 100) / 100
}

/** Los motores de una estación (instalados ahí), por código. */
export function motoresDeEstacion(estado: EstadoMotores, estacionId: string): MotorEstacion[] {
  return estado.motores.filter((m) => m.estado === 'EN_ESTACION' && m.estacion_id === estacionId).sort((a, b) => a.codigo.localeCompare(b.codigo, 'es', { numeric: true }))
}

/** Motores fuera de una estación (taller, retirados, sin asignar): solo los ve quien tiene «configurar». */
export function motoresSinEstacion(estado: EstadoMotores): MotorEstacion[] {
  return estado.motores.filter((m) => m.estado !== 'EN_ESTACION').sort((a, b) => a.codigo.localeCompare(b.codigo, 'es', { numeric: true }))
}
