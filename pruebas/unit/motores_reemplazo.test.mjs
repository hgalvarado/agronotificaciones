import { test } from 'node:test'
import assert from 'node:assert/strict'
import { armarReemplazoMotor } from '../../src/lib/motores/registroDiario.ts'
import { candidatosReemplazo, normalizarEstado, reemplazosDeEstacion } from '../../src/lib/motores/estado.ts'

const base = { equipoId: 'D', estacionId: 'E1', fechaHora: '2026-11-27T10:00:00-06:00', horometro: 100, horometroOtro: 50 }

test('inicio: REEMPLAZO con sustituto y horómetros en su lugar', () => {
  const a = armarReemplazoMotor({ ...base, modo: 'inicio', sustitutoId: 'S', motivo: ' bomba ' })
  assert.equal(a.operacion, 'motor_asignar')
  assert.equal(a.datos.tipo, 'REEMPLAZO')
  assert.equal(a.datos.sustituto_id, 'S')
  assert.equal(a.datos.horometro, 100)
  assert.equal(a.datos.horometro_danado, 50)
  assert.equal(a.datos.horometro_sustituto, undefined)
  assert.equal(a.datos.motivo, 'bomba')
})

test('inicio: sin sustituto o el mismo motor da error', () => {
  assert.ok('error' in armarReemplazoMotor({ ...base, modo: 'inicio', sustitutoId: null }))
  assert.ok('error' in armarReemplazoMotor({ ...base, modo: 'inicio', sustitutoId: 'D' }))
})

test('fin: REEMPLAZO_FIN sin sustituto; el horómetro del otro es del sustituto', () => {
  const a = armarReemplazoMotor({ ...base, modo: 'fin' })
  assert.equal(a.datos.tipo, 'REEMPLAZO_FIN')
  assert.equal(a.datos.sustituto_id, undefined)
  assert.equal(a.datos.horometro_sustituto, 50)
})

test('horómetro negativo da error', () => {
  assert.ok('error' in armarReemplazoMotor({ ...base, modo: 'fin', horometro: -1 }))
})

const motor = (id, estado, estacion) => ({ equipo_id: id, codigo: id, nombre: id, modelo: null, estado, estacion_id: estacion, tanque: null, horo_ultimo: null, visor_ultimo: null, fecha_ultimo: null, intervalo_horas: null, aviso_horas: null, horas_desde_mant: 0, horas_para_mant: null })

test('candidatos: de repuesto y de otra estación; nunca en reparación ni de la misma estación', () => {
  const e = normalizarEstado({
    servidor_en: '', permisos: { ver: true, registrar: true, anular: false, configurar: false }, material_diesel_id: null,
    motores: [motor('A', 'EN_ESTACION', 'E1'), motor('R', 'SIN_ASIGNAR', null), motor('T', 'TALLER', null), motor('X', 'RETIRADO', null)],
    otras_estaciones: [{ equipo_id: 'O', codigo: 'O', nombre: 'O', modelo: null, estado: 'EN_ESTACION', estacion_id: 'E2', estacion_nombre: 'Pozo 2' }],
    tanques_sin_motor: [], registros: [], recepciones: [], mantenimientos: [], asignaciones: [],
    reemplazos: [{ id: 'r1', estacion_id: 'E1', tanque_id: 't', motor_danado: 'T', motor_sustituto: 'A', desde: '2026-11-27T10:00:00Z' }],
  })
  const ids = candidatosReemplazo(e, 'E1', () => null).map((m) => m.equipo_id).sort()
  assert.deepEqual(ids, ['O', 'R', 'X'])
  assert.equal(reemplazosDeEstacion(e, 'E1').length, 1)
  assert.equal(reemplazosDeEstacion(e, 'E2').length, 0)
  assert.equal(reemplazosDeEstacion(e, 'E1')[0].origen_estacion, null)
})
