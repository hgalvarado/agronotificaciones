/**
 * Lo que la pantalla necesita de un motor de la estación, ya calculado sin red: saldo del tanque, horas para el mantenimiento
 * (con las estimadas aparte) y los semáforos con «qué toca ahora». Une estado.ts (lo bajado + lo pendiente) y senales.ts (las reglas).
 */

import { saldoTanqueLocal, type EstadoMotores, type MotorEstacion, type OperacionPendienteMotor } from './estado'
import { ayudaLocal, fechaUltimaLocal, horasMantDetalle, type AyudaLocal } from './senales'

export type VistaMotor = {
  motor: MotorEstacion
  saldo: number | null
  horas: number
  estimadas: number
  fechaUltima: string | null
  ayuda: AyudaLocal
}

export function vistaMotor(motor: MotorEstacion, estado: EstadoMotores, pendientes: OperacionPendienteMotor[], hoy: string): VistaMotor {
  const saldo = motor.tanque ? saldoTanqueLocal(motor.tanque.id, estado, pendientes) : null
  const { horas, estimadas } = horasMantDetalle(motor, estado.registros, pendientes)
  const fechaUltima = fechaUltimaLocal(motor, pendientes)
  return { motor, saldo, horas, estimadas, fechaUltima, ayuda: ayudaLocal({ motor, saldoTanque: saldo, horasDesdeMant: horas, horasEstimadas: estimadas, fechaUltima, hoy }) }
}
